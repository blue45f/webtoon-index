import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";
import {
  planStudioDynamicBrushCoverageMarks,
  type StudioDynamicBrushCoverageMark,
} from "../studio-dynamic-brush-coverage-renderer";

import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  studioDryMediaUnionComposableProgramPin,
} from "./studio-brush-dynamics";
import { STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID } from "./studio-brush-render-budget";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";
import {
  resolveStudioDynamicBrushMaterialIdentity,
} from "./studio-dry-media-dynamic-bridge";

type ResvgWasmModule = typeof import("@resvg/resvg-wasm");

let resvgWasmModulePromise: Promise<ResvgWasmModule> | null = null;

function loadResvgWasmModule(): Promise<ResvgWasmModule> {
  resvgWasmModulePromise ??= (async () => {
    const module = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await module.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );
    return module;
  })();
  return resvgWasmModulePromise;
}

function plannedMark(
  brushId: "crayon" | "chalk" | "charcoal" | "pastel" | "oil-pastel",
  points: readonly number[],
): StudioDynamicBrushCoverageMark {
  const preset = BRUSH_PRESETS.find(({ id }) => id === brushId)!;
  const selection = studioCoreBrushCatalogSelection(preset);
  // Legacy-replay raster QA: the union carrier is now reached through the explicit program pin
  // (fresh unpinned strokes render via the kernel dab path and never plan union polygons).
  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...selection.brushDynamics!,
    dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
  });
  const dabs = planNormalizedStudioDynamicBrushDabs({
    points,
    pressures: Array.from(
      { length: points.length / 2 },
      (_, index) => 0.48 + (index % 5) * 0.08,
    ),
    baseWidth: selection.defaultWidth,
    baseOpacity: 1,
    seed: dynamics.seed,
    maxDabs: 4_096,
  }, dynamics);
  const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(brushId);
  if (!materialIdentity) throw new Error("missing dry-media identity");
  const plan = planStudioDynamicBrushCoverageMarks({
    dabVariations: [dabs],
    dynamics,
    materialIdentity,
    dynamicSeed: dynamics.seed,
    stroke: "#35241d",
    stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
    markBudget: 65_536,
  });
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.marks).toHaveLength(1);
  expect(plan.marks[0]?.ribbon?.kind).toBe(
    "dry-media-union-ribbon-polygon",
  );
  return plan.marks[0]!;
}

function pathFor(mark: StudioDynamicBrushCoverageMark): string {
  return (mark.ribbon?.polygons ?? []).map((polygon) => {
    const [x, y, ...remaining] = polygon;
    let path = `M${x} ${y}`;
    for (let index = 0; index < remaining.length; index += 2) {
      path += `L${remaining[index]} ${remaining[index + 1]}`;
    }
    return `${path}Z`;
  }).join("");
}

function polygonSignedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]!
      - points[next]! * points[index + 1]!;
  }
  return area / 2;
}

function minimumLuminance(
  pixels: Uint8Array,
  width: number,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  let minimum = 255;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const offset = (y * width + x) * 4;
      minimum = Math.min(
        minimum,
        (pixels[offset] ?? 255) * 0.2126
          + (pixels[offset + 1] ?? 255) * 0.7152
          + (pixels[offset + 2] ?? 255) * 0.0722,
      );
    }
  }
  return minimum;
}

function pigmentConnectedComponentSizes(
  pixels: Uint8Array,
  width: number,
  height: number,
): number[] {
  const occupied = new Uint8Array(width * height);
  for (let index = 0; index < occupied.length; index += 1) {
    const offset = index * 4;
    const luminance = (pixels[offset] ?? 255) * 0.2126
      + (pixels[offset + 1] ?? 255) * 0.7152
      + (pixels[offset + 2] ?? 255) * 0.0722;
    if ((pixels[offset + 3] ?? 0) > 0 && luminance < 242) occupied[index] = 1;
  }

  const visited = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  const sizes: number[] = [];
  for (let origin = 0; origin < occupied.length; origin += 1) {
    if (occupied[origin] === 0 || visited[origin] === 1) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail++] = origin;
    visited[origin] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (
            nextX < 0
            || nextX >= width
            || nextY < 0
            || nextY >= height
          ) continue;
          const next = nextY * width + nextX;
          if (occupied[next] === 0 || visited[next] === 1) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (size >= 4) sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}

function horizontalPigmentGapRuns(
  pixels: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  toX: number,
): number[] {
  const runs: number[] = [];
  let currentRun = 0;
  for (let x = fromX; x <= toX; x += 1) {
    let occupied = false;
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      const luminance = (pixels[offset] ?? 255) * 0.2126
        + (pixels[offset + 1] ?? 255) * 0.7152
        + (pixels[offset + 2] ?? 255) * 0.0722;
      if ((pixels[offset + 3] ?? 0) > 0 && luminance < 242) {
        occupied = true;
        break;
      }
    }
    if (occupied) {
      if (currentRun > 0) runs.push(currentRun);
      currentRun = 0;
    } else {
      currentRun += 1;
    }
  }
  if (currentRun > 0) runs.push(currentRun);
  return runs;
}

describe("dry-media one-fill crossing raster quality", () => {
  it("embeds only fine opposite-winding paper grain inside one continuous pigment bed", () => {
    const points = Array.from({ length: 97 }, (_, index) => [
      12 + index * 3.8,
      70 + Math.sin(index / 11) * 16,
    ]).flat();
    const signatures: string[] = [];

    for (const brushId of [
      "crayon",
      "chalk",
      "charcoal",
      "pastel",
      "oil-pastel",
    ] as const) {
      const mark = plannedMark(brushId, points);
      const polygons = mark.ribbon?.polygons ?? [];
      const positiveAreas = polygons
        .map(polygonSignedArea)
        .filter((area) => area > 0);
      const negativeAreas = polygons
        .map(polygonSignedArea)
        .filter((area) => area < 0)
        .map(Math.abs);
      const negativePolygons = polygons.filter(
        (polygon) => polygonSignedArea(polygon) < 0,
      );
      const totalBodyArea = positiveAreas.reduce((sum, area) => sum + area, 0);
      const totalGrainArea = negativeAreas.reduce((sum, area) => sum + area, 0);

      expect(positiveAreas.length, brushId).toBeGreaterThan(200);
      expect(negativeAreas.length, brushId).toBeGreaterThan(20);
      // Paper tooth is a rounded, elongated pore. Four-corner rectangles were
      // visible as square tiles in crayon/chalk/pastel at high zoom.
      expect(
        negativePolygons.every((polygon) => polygon.length >= 20),
        brushId,
      ).toBe(true);
      expect(Math.max(...negativeAreas), brushId).toBeLessThan(1.5);
      expect(totalGrainArea / totalBodyArea, brushId).toBeGreaterThan(0.001);
      expect(totalGrainArea / totalBodyArea, brushId).toBeLessThan(0.12);
      signatures.push([
        negativeAreas.length,
        (totalGrainArea / totalBodyArea).toFixed(5),
        Math.max(...negativeAreas).toFixed(5),
      ].join(":"));
    }

    // Material policies are not opacity aliases: wax, carbon, mineral, powder and oil-wax expose
    // measurably different pore density/geometry while using the same continuous transport.
    expect(new Set(signatures).size).toBe(5);
  });

  it("keeps every core dry medium at one stroke-local crossing alpha", async () => {
    const module = await loadResvgWasmModule();
    for (const brushId of [
      "crayon",
      "chalk",
      "charcoal",
      "pastel",
      "oil-pastel",
    ] as const) {
      for (const points of [
        [14, 14, 86, 86, 14, 86, 86, 14],
        [12, 50, 88, 50, 12, 50, 88, 50],
      ]) {
        const mark = plannedMark(brushId, points);
        const renderer = new module.Resvg(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">',
            '<rect width="100" height="100" fill="#fff"/>',
            `<path d="${pathFor(mark)}" fill="${mark.color}" fill-rule="nonzero" opacity=".55"/>`,
            "</svg>",
          ].join(""),
          { shapeRendering: 2, font: { loadSystemFonts: false } },
        );
        const rendered = renderer.render();
        try {
          const crossing = minimumLuminance(
            rendered.pixels,
            rendered.width,
            50,
            50,
            4,
          );
          const arm = minimumLuminance(
            rendered.pixels,
            rendered.width,
            points[0] === 14 ? 31 : 34,
            points[0] === 14 ? 31 : 50,
            4,
          );
          // One path fill can occupy more paper at a crossing, but a covered pixel never receives
          // a second alpha deposit. The darkest covered pixels therefore remain identical.
          expect(Math.abs(crossing - arm), brushId).toBeLessThanOrEqual(2);
          expect(crossing, brushId).toBeLessThan(210);
        } finally {
          rendered.free();
          renderer.free();
        }
      }
    }
  });

  it("keeps long pressure-varying fibres connected without periodic stamp gaps", async () => {
    const module = await loadResvgWasmModule();
    const points = Array.from({ length: 81 }, (_, index) => [
      20 + index * 7,
      90 + Math.sin(index * 0.34) * 24 + Math.sin(index * 0.91) * 5,
    ]).flat();

    for (const brushId of [
      "crayon",
      "chalk",
      "charcoal",
      "pastel",
      "oil-pastel",
    ] as const) {
      const mark = plannedMark(brushId, points);
      const renderer = new module.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180">',
          '<rect width="600" height="180" fill="#fff"/>',
          `<path d="${pathFor(mark)}" fill="${mark.color}" fill-rule="nonzero" opacity=".82"/>`,
          "</svg>",
        ].join(""),
        { shapeRendering: 2, font: { loadSystemFonts: false } },
      );
      const rendered = renderer.render();
      try {
        const components = pigmentConnectedComponentSizes(
          rendered.pixels,
          rendered.width,
          rendered.height,
        );
        const gapRuns = horizontalPigmentGapRuns(
          rendered.pixels,
          rendered.width,
          rendered.height,
          20,
          580,
        );
        // Three or five material lanes may remain visually independent, but a station may never
        // create another isolated square/diamond component. This bound catches the old behaviour,
        // which produced hundreds of components as seeded offsets changed along a long stroke.
        expect(components.length, `${brushId}: ${components.slice(0, 16)}`).toBeLessThanOrEqual(8);
        expect(Math.max(0, ...gapRuns), `${brushId}: ${gapRuns}`).toBeLessThanOrEqual(1);
        expect(gapRuns.length, `${brushId}: ${gapRuns}`).toBeLessThanOrEqual(2);
      } finally {
        rendered.free();
        renderer.free();
      }
    }
  });
});
