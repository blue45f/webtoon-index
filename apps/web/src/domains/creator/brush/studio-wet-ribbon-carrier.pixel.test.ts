import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { planCausalWatercolorBrushDabs } from "../studio-causal-watercolor-brush";

import {
  applyStudioBrushAliasWatercolorMaterial,
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasWatercolorPlanSettings,
} from "./studio-brush-alias-profile";
import {
  planStudioWetRibbonCarrier,
  studioWetRibbonCarrierBatchPathData,
} from "./studio-wet-ribbon-carrier";

let resvgModulePromise: Promise<typeof import("@resvg/resvg-wasm")> | null = null;

function loadResvgModule() {
  resvgModulePromise ??= (async () => {
    const module = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await module.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );
    return module;
  })();
  return resvgModulePromise;
}

function luminance(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): number {
  const offset = (y * width + x) * 4;
  const red = pixels[offset] ?? 255;
  const green = pixels[offset + 1] ?? 255;
  const blue = pixels[offset + 2] ?? 255;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function bilinearLuminance(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const boundedX = Math.min(width - 1, Math.max(0, x));
  const boundedY = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(boundedX);
  const y0 = Math.floor(boundedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = boundedX - x0;
  const ty = boundedY - y0;
  const top = luminance(pixels, width, x0, y0) * (1 - tx)
    + luminance(pixels, width, x1, y0) * tx;
  const bottom = luminance(pixels, width, x0, y1) * (1 - tx)
    + luminance(pixels, width, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function curveCrossSectionMeanLuminance(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  slope: number,
): number {
  const inverseLength = 1 / Math.hypot(slope, 1);
  const normalX = -slope * inverseLength;
  const normalY = inverseLength;
  let sum = 0;
  let count = 0;
  for (let offset = -6; offset <= 6; offset += 1) {
    sum += bilinearLuminance(
      pixels,
      width,
      height,
      x + normalX * offset,
      y + normalY * offset,
    );
    count += 1;
  }
  return sum / Math.max(1, count);
}

describe("Studio wet ribbon long-stroke raster quality", () => {
  it("keeps causal station coverage continuous along a long wash", async () => {
    const module = await loadResvgModule();
    const curveY = (x: number) => (
      80 + Math.sin(((x - 20) / 504) * Math.PI * 2) * 18
    );
    const curveSlope = (x: number) => (
      Math.cos(((x - 20) / 504) * Math.PI * 2) * 18 * Math.PI * 2 / 504
    );
    const sourceXs = Array.from({ length: 33 }, (_, index) => 20 + index * 15.75);
    const sourcePoints = sourceXs.flatMap((x) => [x, curveY(x)]);
    const dabs = planCausalWatercolorBrushDabs({
      points: sourcePoints,
      pressures: sourceXs.map(() => 0.55),
      baseWidth: 24,
      spacing: 8,
      seed: 441,
      diffuse: true,
      maxDabs: 8_192,
    }, true);
    const carrier = planStudioWetRibbonCarrier(dabs, { seed: 441 });
    const paths = carrier.batches.map((batch) => (
      `<path d="${studioWetRibbonCarrierBatchPathData(batch)}" fill="#111" fill-rule="nonzero" opacity="${batch.opacity}"/>`
    )).join("");
    const renderer = new module.Resvg(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="544" height="160">',
        '<rect width="544" height="160" fill="#fff"/>',
        paths,
        "</svg>",
      ].join(""),
      {
        shapeRendering: 2,
        font: { loadSystemFonts: false },
      },
    );
    const rendered = renderer.render();
    try {
      const samples = Array.from(
        { length: 481 },
        (_, index) => {
          const x = 32 + index;
          return curveCrossSectionMeanLuminance(
            rendered.pixels,
            rendered.width,
            rendered.height,
            x,
            curveY(x),
            curveSlope(x),
          );
        },
      );
      const adjacentDeltas = samples.slice(1).map(
        (value, index) => Math.abs(value - samples[index]!),
      );

      // The former midpoint-per-segment carrier measured a 10-level cross-section jump at many
      // station boundaries. Endpoint interpolation, causal grain correlation and a tapered
      // threshold edge keep this real curved raster below four 8-bit luminance levels.
      expect(Math.max(...adjacentDeltas)).toBeLessThanOrEqual(4);
    } finally {
      rendered.free();
      renderer.free();
    }
  });

  it("keeps the real 30px Studio ink-wash path free of station-frequency crossbars", async () => {
    const module = await loadResvgModule();
    const pointCount = 81;
    const settings = resolveStudioBrushAliasWatercolorPlanSettings(
      "ink-wash",
      30,
    )!;
    const points = Array.from(
      { length: pointCount },
      (_, index) => [20 + index * 5, 80],
    ).flat();
    const pressures = mapStudioBrushAliasPressureSamples(
      "ink-wash",
      Array.from({ length: pointCount }, () => 0.5),
      pointCount,
      0.55,
    );
    const dabs = applyStudioBrushAliasWatercolorMaterial(
      "ink-wash",
      planCausalWatercolorBrushDabs({
        points,
        pressures,
        baseWidth: settings.baseWidth,
        spacing: settings.spacing,
        seed: 441,
        diffuse: true,
        maxDabs: 8_192,
      }, true),
    );
    const carrier = planStudioWetRibbonCarrier(dabs, { seed: 441 });
    const paths = carrier.batches.map((batch) => (
      `<path d="${studioWetRibbonCarrierBatchPathData(batch)}" fill="#735be7" opacity="${batch.opacity * 0.5}"/>`
    )).join("");
    // 480 / 452.8302 = 1.06, matching the fractional Studio zoom which exposed coincident
    // station-edge antialiasing in Canvas.
    const renderer = new module.Resvg(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180" ',
        'viewBox="0 0 452.8302 169.8113">',
        '<rect width="452.8302" height="169.8113" fill="#fff"/>',
        paths,
        "</svg>",
      ].join(""),
      {
        shapeRendering: 2,
        font: { loadSystemFonts: false },
      },
    );
    const rendered = renderer.render();
    try {
      const scale = 1.06;
      const samples = Array.from(
        { length: 381 },
        (_, index) => luminance(
          rendered.pixels,
          rendered.width,
          Math.round((30 + index) * scale),
          Math.round(80 * scale),
        ),
      );
      const adjacentDeltas = samples.slice(1).map(
        (value, index) => value - samples[index]!,
      );
      const curvature = adjacentDeltas.slice(1).map(
        (value, index) => value - adjacentDeltas[index]!,
      );

      // A broad causal pigment envelope may change tone, but it must not alternate at the 5.8px
      // station spacing. The old independent station hash produced dozens of high-frequency
      // reversals; after contour joining and correlated material noise only a few threshold
      // crossings remain across the full 380px sample.
      expect(adjacentDeltas.filter((value) => Math.abs(value) > 1).length)
        .toBeLessThanOrEqual(4);
      expect(curvature.filter((value) => Math.abs(value) > 1).length)
        .toBeLessThanOrEqual(8);
      expect(
        carrier.batches
          .filter(({ layer }) => layer === "core")
          .every((batch) => (
            (studioWetRibbonCarrierBatchPathData(batch).match(/M/g) ?? [])
              .length <= 2
          )),
      ).toBe(true);
    } finally {
      rendered.free();
      renderer.free();
    }
  });

  it("shapes pressure thresholds as a material contour instead of a full-width crossbar", async () => {
    const module = await loadResvgModule();
    const carrier = planStudioWetRibbonCarrier([
      { x: 20, y: 80, radius: 18, opacity: 0.2, role: "core" },
      { x: 140, y: 80, radius: 18, opacity: 0.8, role: "core" },
    ], { seed: 441 });
    const thresholdBatch = carrier.batches.find((batch) => (
      batch.layer === "core" && batch.coverageCeiling === 0.5
    ))!;
    const renderer = new module.Resvg(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">',
        '<rect width="160" height="160" fill="#fff"/>',
        `<path d="${studioWetRibbonCarrierBatchPathData(thresholdBatch)}" fill="#000"/>`,
        "</svg>",
      ].join(""),
      {
        shapeRendering: 2,
        font: { loadSystemFonts: false },
      },
    );
    const rendered = renderer.render();
    try {
      const rows = [64, 68, 72, 76, 80, 84, 88, 92, 96];
      const boundaryXs = rows.map((y) => {
        for (let x = 20; x <= 140; x += 1) {
          if (luminance(rendered.pixels, rendered.width, x, y) < 128) {
            return x;
          }
        }
        return 140;
      });
      const first = boundaryXs[0]!;
      const last = boundaryXs.at(-1)!;
      const maximumLinearResidual = Math.max(
        ...boundaryXs.map((x, index) => {
          const linear = first
            + (last - first) * index / (boundaryXs.length - 1);
          return Math.abs(x - linear);
        }),
      );

      expect(Math.max(...boundaryXs) - Math.min(...boundaryXs))
        .toBeGreaterThanOrEqual(3);
      expect(maximumLinearResidual).toBeGreaterThanOrEqual(1);
      expect(thresholdBatch.polygons.some(({ points }) => points.length > 8))
        .toBe(true);
    } finally {
      rendered.free();
      renderer.free();
    }
  });

  it("renders one crossing at max local coverage while separate strokes still glaze", async () => {
    const module = await loadResvgModule();
    const sourceDabs = (
      points: readonly (readonly [number, number])[],
    ) => points.map(([x, y]) => ({
      x,
      y,
      radius: 8,
      opacity: 0.6,
      role: "core" as const,
    }));
    const pathMarkup = (
      plan: ReturnType<typeof planStudioWetRibbonCarrier>,
    ) => plan.batches.map((batch) => (
      `<path d="${studioWetRibbonCarrierBatchPathData(batch)}" fill="#111" opacity="${batch.opacity}"/>`
    )).join("");
    const selfCrossing = planStudioWetRibbonCarrier(sourceDabs([
      [20, 20],
      [140, 140],
      [20, 140],
      [140, 20],
    ]), { seed: 41 });
    const separateCrossingMarkup = [
      planStudioWetRibbonCarrier(sourceDabs([
        [20, 20],
        [140, 140],
      ]), { seed: 41 }),
      planStudioWetRibbonCarrier(sourceDabs([
        [20, 140],
        [140, 20],
      ]), { seed: 41 }),
    ].map(pathMarkup).join("");
    const render = (paths: string) => {
      const renderer = new module.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">',
          '<rect width="160" height="160" fill="#fff"/>',
          paths,
          "</svg>",
        ].join(""),
        {
          shapeRendering: 2,
          font: { loadSystemFonts: false },
        },
      );
      return { renderer, rendered: renderer.render() };
    };
    const single = render(pathMarkup(selfCrossing));
    const separate = render(separateCrossingMarkup);
    try {
      const selfCrossingLuminance = luminance(
        single.rendered.pixels,
        single.rendered.width,
        80,
        80,
      );
      const selfArmLuminance = luminance(
        single.rendered.pixels,
        single.rendered.width,
        50,
        50,
      );
      const separateCrossingLuminance = luminance(
        separate.rendered.pixels,
        separate.rendered.width,
        80,
        80,
      );

      expect(selfCrossingLuminance).toBe(selfArmLuminance);
      expect(separateCrossingLuminance)
        .toBeLessThan(selfCrossingLuminance - 40);
    } finally {
      single.rendered.free();
      single.renderer.free();
      separate.rendered.free();
      separate.renderer.free();
    }
  });

  it.each([
    ["one reversal", [20, 50, 20]],
    ["repeated reversal", [20, 50, 20, 50]],
  ] as const)(
    "does not cancel pigment on an out-and-back %s",
    async (_label, sourceXs) => {
      const module = await loadResvgModule();
      const plan = planStudioWetRibbonCarrier(
        sourceXs.map((x) => ({
          x,
          y: 30,
          radius: 5,
          opacity: 0.5,
          role: "core" as const,
        })),
        { seed: 41 },
      );
      const paths = plan.batches.map((batch) => (
        `<path d="${studioWetRibbonCarrierBatchPathData(batch)}" fill="#111" opacity="${batch.opacity}"/>`
      )).join("");
      const renderer = new module.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="70" height="60">',
          '<rect width="70" height="60" fill="#fff"/>',
          paths,
          "</svg>",
        ].join(""),
        {
          shapeRendering: 2,
          font: { loadSystemFonts: false },
        },
      );
      const rendered = renderer.render();
      try {
        const nearLuminance = luminance(
          rendered.pixels,
          rendered.width,
          30,
          30,
        );
        const farLuminance = luminance(
          rendered.pixels,
          rendered.width,
          40,
          30,
        );
        expect(nearLuminance).toBeLessThan(160);
        expect(farLuminance).toBeLessThan(160);
        expect(Math.abs(nearLuminance - farLuminance)).toBeLessThanOrEqual(1);
      } finally {
        rendered.free();
        renderer.free();
      }
    },
  );
});
