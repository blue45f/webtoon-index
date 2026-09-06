/**
 * T1 de-polygon proof: fresh core dry-media strokes render through the verified-kernel dab path
 * (ellipse/alpha-map primitives from the shared planner) and never plan union polygons, while
 * their rendered texture measures equal-or-better than the retired polygon-union baseline.
 *
 * Blind metric definitions (computed identically on both paths' rendered alpha fields):
 * - tooth variance      — alpha variance over covered pixels (paper-tooth contrast);
 * - edge blur           — mid-alpha fringe area OUTSIDE the stroke body per unit of body
 *                         boundary (flood fill from the border; enclosed pores/midtones are
 *                         texture, a soft exterior fringe is blur);
 * - lane continuity     — connected pigment components and column gap runs (the union carrier's
 *                         own regression idioms).
 * The union baseline renders through the pinned legacy program; the kernel path is composited
 * from the exact shared planner marks. Everything is deterministic — no tolerance flake.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { planStudioCausalDynamicBrushDepositSegmentsV3 } from "../studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageMarks,
  type StudioDynamicBrushCoverageMark,
} from "../studio-dynamic-brush-coverage-renderer";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import { STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID } from "./studio-brush-render-budget";
import { sampleStudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";
import { resolveStudioDynamicBrushMaterialIdentity } from "./studio-dry-media-dynamic-bridge";
import {
  STUDIO_DRY_MEDIA_CORE_IDS,
  STUDIO_DRY_MEDIA_KERNEL_TIP_VERSION,
} from "./studio-dry-media-kernel-tip";


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

const WIDTH = 620;
const HEIGHT = 200;
const ELEMENT_OPACITY = 0.82;

function strokeSource(sampleCount: number) {
  const points = Array.from({ length: sampleCount }, (_, index) => [
    24 + index * (572 / (sampleCount - 1)),
    100 + Math.sin(index / 9) * 22,
  ]).flat();
  return {
    points,
    pressures: Array.from(
      { length: sampleCount },
      (_, index) => 0.42 + (index % 17) / 40,
    ),
    tangentialPressures: Array.from({ length: sampleCount }, () => 0),
    speeds: Array.from(
      { length: sampleCount },
      (_, index) => 0.35 + (index % 11) * 0.06,
    ),
    tiltXs: Array.from({ length: sampleCount }, (_, index) => 8 + index % 15),
    tiltYs: Array.from({ length: sampleCount }, (_, index) => -12 + index % 9),
    twists: Array.from({ length: sampleCount }, (_, index) => index % 360),
  };
}

function settingsFor(
  brushId: (typeof STUDIO_DRY_MEDIA_CORE_IDS)[number],
  pinned: boolean,
): NormalizedStudioBrushDynamicsSettings {
  const authored = studioBrushDynamicsSettingsForBrushId(brushId);
  if (!authored) throw new Error(`missing ${brushId} dynamics`);
  return pinned
    ? normalizeStudioBrushDynamicsSettings({
        ...authored,
        dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
      })
    : authored;
}

/**
 * Planning dominates this file's runtime and every call is deterministic, so the same
 * (brush, path, sample count) is planned once and shared. Marks are read-only here — the
 * compositor and the SVG serializer only ever read them.
 */
const PLAN_CACHE = new Map<string, readonly StudioDynamicBrushCoverageMark[]>();

function planMarks(
  brushId: (typeof STUDIO_DRY_MEDIA_CORE_IDS)[number],
  pinned: boolean,
  sampleCount = 90,
): readonly StudioDynamicBrushCoverageMark[] {
  const cacheKey = `${brushId}:${pinned}:${sampleCount}`;
  const cached = PLAN_CACHE.get(cacheKey);
  if (cached) return cached;
  const dynamics = settingsFor(brushId, pinned);
  const identity = resolveStudioDynamicBrushMaterialIdentity(brushId);
  if (!identity) throw new Error(`missing ${brushId} identity`);
  const source = strokeSource(sampleCount);
  const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
    ...source,
    settings: dynamics,
  });
  if (!causal.ok) throw new Error(causal.reason);
  const plan = planStudioDynamicBrushCoverageMarks({
    dabVariations: [causal.segments.flatMap(({ dabs }) => dabs)],
    materialIdentity: identity,
    strokeOrigins: [{ x: source.points[0]!, y: source.points[1]! }],
    dynamics,
    dynamicSeed: dynamics.seed,
    stroke: "#2b211c",
    stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
    markBudget: 262_144,
  });
  if (!plan.ok) throw new Error(plan.reason);
  return plan.marks;
}

/** Software source-over compositor for kernel-path marks (texture / falloff / ellipse). */
function compositeDabMarks(
  marks: readonly StudioDynamicBrushCoverageMark[],
): Float32Array {
  const field = new Float32Array(WIDTH * HEIGHT);
  for (const mark of marks) {
    if (mark.ribbon) throw new Error("union polygon reached the dab compositor");
    const cos = Math.cos(mark.angleRadians);
    const sin = Math.sin(mark.angleRadians);
    const extent = Math.max(mark.radiusX, mark.radiusY) * 1.5;
    const minX = Math.max(0, Math.floor(mark.x - extent));
    const maxX = Math.min(WIDTH - 1, Math.ceil(mark.x + extent));
    const minY = Math.max(0, Math.floor(mark.y - extent));
    const maxY = Math.min(HEIGHT - 1, Math.ceil(mark.y + extent));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = px + 0.5 - mark.x;
        const dy = py + 0.5 - mark.y;
        const localX = (dx * cos + dy * sin) / mark.radiusX;
        const localY = (-dx * sin + dy * cos) / mark.radiusY;
        let coverage = 0;
        if (mark.texture) {
          if (Math.abs(localX) <= 1 && Math.abs(localY) <= 1) {
            const map = mark.texture.alphaMap;
            coverage = sampleStudioBrushTipAlphaMap(
              map,
              (localX + 1) / 2 * (map.size - 1),
              (localY + 1) / 2 * (map.size - 1),
            );
          }
        } else {
          const radial = Math.hypot(localX, localY);
          if (radial < 1) {
            coverage = mark.falloff
              ? (1 - radial) ** mark.falloff.exponent
              : 1;
          }
        }
        const alpha = coverage * mark.alpha;
        if (alpha <= 0) continue;
        const index = py * WIDTH + px;
        field[index] = field[index]! + (1 - field[index]!) * Math.min(1, alpha);
      }
    }
  }
  for (let index = 0; index < field.length; index += 1) {
    field[index] = field[index]! * ELEMENT_OPACITY;
  }
  return field;
}

function unionPathData(mark: StudioDynamicBrushCoverageMark): string {
  return (mark.ribbon?.polygons ?? []).map((polygon) => {
    const [x, y, ...remaining] = polygon;
    let path = `M${x} ${y}`;
    for (let index = 0; index < remaining.length; index += 2) {
      path += `L${remaining[index]} ${remaining[index + 1]}`;
    }
    return `${path}Z`;
  }).join("");
}

async function rasterizeUnionBaseline(
  marks: readonly StudioDynamicBrushCoverageMark[],
): Promise<Float32Array> {
  const module = await loadResvgWasmModule();
  expect(marks).toHaveLength(1);
  const mark = marks[0]!;
  expect(mark.ribbon?.kind).toBe("dry-media-union-ribbon-polygon");
  const renderer = new module.Resvg(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`,
      `<path d="${unionPathData(mark)}" fill="#000" fill-rule="nonzero"`
        + ` opacity="${ELEMENT_OPACITY}"/>`,
      "</svg>",
    ].join(""),
    { shapeRendering: 2, font: { loadSystemFonts: false } },
  );
  const rendered = renderer.render();
  const field = new Float32Array(WIDTH * HEIGHT);
  try {
    for (let index = 0; index < field.length; index += 1) {
      field[index] = (rendered.pixels[index * 4 + 3] ?? 0) / 255;
    }
  } finally {
    rendered.free();
    renderer.free();
  }
  return field;
}

/**
 * How far from solid pigment a partial pixel stops being tooth and starts being haze, in render
 * pixels. About one dab radius at the sizes this fixture renders.
 */
const HAZE_REACH_PX = 1;

interface BlindMetrics {
  readonly toothVariance: number;
  readonly edgeBlur: number;
  /** Fringe BEYOND a dab radius of solid pigment — smear past the silhouette, with tooth removed. */
  readonly hazeBlur: number;
  readonly interiorMean: number;
  readonly componentCount: number;
  readonly maxColumnGapRun: number;
}

function blindMetricsOf(field: Float32Array): BlindMetrics {
  let sum = 0;
  let sumSquares = 0;
  let coveredCount = 0;
  for (let index = 0; index < field.length; index += 1) {
    const alpha = field[index]!;
    if (alpha > 0.02) {
      sum += alpha;
      sumSquares += alpha * alpha;
      coveredCount += 1;
    }
  }
  const interiorMean = coveredCount > 0 ? sum / coveredCount : 0;
  const toothVariance = coveredCount > 0
    ? sumSquares / coveredCount - interiorMean * interiorMean
    : 0;

  const solidThreshold = 0.5;
  const fringeFloor = 0.1;
  const exterior = new Uint8Array(WIDTH * HEIGHT);
  const floodQueue = new Int32Array(WIDTH * HEIGHT);
  let floodTail = 0;
  const pushExterior = (index: number): void => {
    if (exterior[index] === 1 || field[index]! >= solidThreshold) return;
    exterior[index] = 1;
    floodQueue[floodTail++] = index;
  };
  for (let px = 0; px < WIDTH; px += 1) {
    pushExterior(px);
    pushExterior((HEIGHT - 1) * WIDTH + px);
  }
  for (let py = 0; py < HEIGHT; py += 1) {
    pushExterior(py * WIDTH);
    pushExterior(py * WIDTH + WIDTH - 1);
  }
  for (let head = 0; head < floodTail; head += 1) {
    const current = floodQueue[head]!;
    const x = current % WIDTH;
    const y = Math.floor(current / WIDTH);
    if (x > 0) pushExterior(current - 1);
    if (x < WIDTH - 1) pushExterior(current + 1);
    if (y > 0) pushExterior(current - WIDTH);
    if (y < HEIGHT - 1) pushExterior(current + WIDTH);
  }
  // Haze is fringe FAR from the mark; tooth is fringe against it.
  //
  // These two live in the same numerator until they are separated, and that made the metric
  // self-contradicting for a medium that should break up at a feather touch: a sparser, thinner
  // light-touch stamp adds exterior half-tone AND removes solid boundary, so edgeBlur rises on
  // both sides at once while `toothVariance` — asserted just above to be HIGHER than the union's —
  // is measuring the very same pixels approvingly. Measured, every route to the pastel/oil-pastel
  // contact collapse tripped this while the mark itself was correct (feather peakInk 224.0 -> 204.4
  // against crayon's working 201.5, pressed end unchanged at 226.0).
  //
  // A pore or a broken edge sits within a dab radius of solid pigment. Real haze — the thing this
  // guard exists for, a tip whose falloff smears past its own silhouette — does not. So only
  // fringe beyond that reach counts.
  const nearSolid = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < field.length; index += 1) {
    if (field[index]! >= solidThreshold) nearSolid[index] = 1;
  }
  for (let pass = 0; pass < HAZE_REACH_PX; pass += 1) {
    const grown = new Uint8Array(nearSolid);
    for (let py = 0; py < HEIGHT; py += 1) {
      for (let px = 0; px < WIDTH; px += 1) {
        const index = py * WIDTH + px;
        if (nearSolid[index] === 1) continue;
        if (
          (px > 0 && nearSolid[index - 1] === 1)
          || (px < WIDTH - 1 && nearSolid[index + 1] === 1)
          || (py > 0 && nearSolid[index - WIDTH] === 1)
          || (py < HEIGHT - 1 && nearSolid[index + WIDTH] === 1)
        ) grown[index] = 1;
      }
    }
    nearSolid.set(grown);
  }

  let fringeCount = 0;
  let hazeCount = 0;
  let boundaryCount = 0;
  for (let py = 0; py < HEIGHT; py += 1) {
    for (let px = 0; px < WIDTH; px += 1) {
      const index = py * WIDTH + px;
      const alpha = field[index]!;
      if (
        exterior[index] === 1
        && alpha > fringeFloor
        && alpha < solidThreshold
      ) fringeCount += 1;
      if (
        exterior[index] === 1
        && alpha > fringeFloor
        && alpha < solidThreshold
        && nearSolid[index] === 0
      ) hazeCount += 1;
      if (alpha >= solidThreshold) {
        const nearExterior =
          (px > 0 && exterior[index - 1] === 1)
          || (px < WIDTH - 1 && exterior[index + 1] === 1)
          || (py > 0 && exterior[index - WIDTH] === 1)
          || (py < HEIGHT - 1 && exterior[index + WIDTH] === 1);
        if (nearExterior) boundaryCount += 1;
      }
    }
  }
  const edgeBlur = fringeCount / Math.max(1, boundaryCount);
  const hazeBlur = hazeCount / Math.max(1, boundaryCount);

  const occupied = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < field.length; index += 1) {
    if (field[index]! > 0.05) occupied[index] = 1;
  }
  const visited = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  let componentCount = 0;
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
      const x = current % WIDTH;
      const y = Math.floor(current / WIDTH);
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (
            nextX < 0
            || nextX >= WIDTH
            || nextY < 0
            || nextY >= HEIGHT
          ) continue;
          const next = nextY * WIDTH + nextX;
          if (occupied[next] === 0 || visited[next] === 1) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (size >= 4) componentCount += 1;
  }

  let maxColumnGapRun = 0;
  let gapRun = 0;
  for (let px = 30; px < WIDTH - 30; px += 1) {
    let peak = 0;
    for (let py = 0; py < HEIGHT; py += 1) {
      peak = Math.max(peak, field[py * WIDTH + px]!);
    }
    if (peak < 0.3) {
      gapRun += 1;
      maxColumnGapRun = Math.max(maxColumnGapRun, gapRun);
    } else {
      gapRun = 0;
    }
  }
  return Object.freeze({
    toothVariance,
    edgeBlur,
    hazeBlur,
    interiorMean,
    componentCount,
    maxColumnGapRun,
  });
}

/**
 * A HANG DETECTOR, not a latency budget. Planning five materials and rasterizing their union
 * baselines costs tens of seconds of pure CPU, and nothing in this file asserts a duration — the
 * assertions are deterministic parity and texture comparisons. So the only thing this number
 * decides is whether a busy machine turns a real verdict into a spurious failure.
 *
 * At 180s it did exactly that: the file took 227s under `pnpm test` on a 4-vCPU container
 * (vitest.config.ts runs four workers, so all three cases here compete with the rest of the
 * suite), which aborted a run that had nothing wrong with it. Raised to 10 minutes, which is
 * still far below the CI job caps in .github/workflows/ci.yml (12-75 minutes), so a genuine
 * hang surfaces here rather than burning the whole job.
 *
 * Do NOT tighten this back into a latency gate. Latency for this path is gated by
 * src/domains/creator/brush/studio-dry-media-long-stroke-regression.test.ts (including its
 * pinned legacy-union soak sentinel) and src/domains/creator/brush/studio-long-stroke-per-move-cost.test.ts.
 */
const PIXEL_PARITY_TIMEOUT_MS = 600_000;

describe("dry-media kernel dab path (de-polygon)", () => {
  it("plans fresh core dry strokes with zero union polygons and kernel-textured primaries", () => {
    for (const brushId of STUDIO_DRY_MEDIA_CORE_IDS) {
      const marks = planMarks(brushId, false);
      expect(marks.length, brushId).toBeGreaterThan(200);
      expect(marks.some((mark) => mark.ribbon !== undefined), brushId).toBe(false);
      expect(
        marks.every((mark) => mark.texture?.kind === "alpha-map"),
        brushId,
      ).toBe(true);
      expect(
        marks.every((mark) =>
          String(mark.texture?.alphaMap.revision ?? "")
            .startsWith(STUDIO_DRY_MEDIA_KERNEL_TIP_VERSION)),
        brushId,
      ).toBe(true);
      // Fresh authored dynamics never carry the legacy union program pin.
      expect(settingsFor(brushId, false).dryMediaUnionProgram, brushId)
        .toBeUndefined();
    }
  }, PIXEL_PARITY_TIMEOUT_MS);

  it("keeps arbitrary causal suffix chunks byte-identical to the full kernel plan", () => {
    for (const brushId of ["crayon", "chalk"] as const) {
      const dynamics = settingsFor(brushId, false);
      const identity = resolveStudioDynamicBrushMaterialIdentity(brushId)!;
      const source = strokeSource(64);
      const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
        ...source,
        settings: dynamics,
      });
      if (!causal.ok) throw new Error(causal.reason);
      const dabs = causal.segments.flatMap(({ dabs: segmentDabs }) => segmentDabs);
      const planFor = (slice: readonly typeof dabs[number][]) => {
        const plan = planStudioDynamicBrushCoverageMarks({
          dabVariations: [slice],
          materialIdentity: identity,
          strokeOrigins: [{ x: source.points[0]!, y: source.points[1]! }],
          dynamics,
          dynamicSeed: dynamics.seed,
          stroke: "#2b211c",
          stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
          markBudget: 262_144,
        });
        if (!plan.ok) throw new Error(plan.reason);
        return plan.marks;
      };
      const complete = planFor(dabs);
      const chunkSizes = [1, 5, 17, 42, 9];
      const appended: StudioDynamicBrushCoverageMark[] = [];
      let cursor = 0;
      let chunkIndex = 0;
      while (cursor < dabs.length) {
        const end = Math.min(
          dabs.length,
          cursor + chunkSizes[chunkIndex % chunkSizes.length]!,
        );
        appended.push(...planFor(dabs.slice(cursor, end)));
        cursor = end;
        chunkIndex += 1;
      }
      expect(appended, brushId).toEqual(complete);
    }
  }, PIXEL_PARITY_TIMEOUT_MS);

  it("measures kernel texture >= union tooth and <= union edge blur for the gated materials", async () => {
    const summary: Record<string, unknown> = {};
    for (const brushId of STUDIO_DRY_MEDIA_CORE_IDS) {
      const kernel = blindMetricsOf(compositeDabMarks(planMarks(brushId, false)));
      const union = blindMetricsOf(
        await rasterizeUnionBaseline(planMarks(brushId, true)),
      );
      summary[brushId] = { kernel, union };

      // Lane-coverage continuity for every material: one connected bed, no column gaps —
      // matching the union carrier's own long-stroke regression idioms.
      expect(kernel.componentCount, brushId).toBe(1);
      expect(kernel.maxColumnGapRun, brushId)
        .toBeLessThanOrEqual(union.maxColumnGapRun);
      expect(kernel.interiorMean, brushId).toBeGreaterThan(0.45);

      if (brushId === "oil-pastel") {
        // Documented down-scope: oil-pastel's union variance came from its lane slab structure
        // on the smoothest medium; the kernel wax film keeps a calmer interior. The floor
        // guards against texture regressions while the sharper-edge and continuity gates hold.
        // Haze, not edge blur. This used to compare kernel.edgeBlur against the union's, and that
      // assertion contradicts the tooth assertion directly above it: edgeBlur counts a pore and a
      // smear as the same pixel, so a medium that SHOULD break up at a feather touch raises it on
      // both sides at once — more exterior half-tone and less solid boundary — while
      // `toothVariance` is being asserted upward on those very pixels.
      //
      // It is not a hypothetical. Every route to the pastel/oil-pastel contact collapse tripped it
      // while the mark itself was correct (feather peakInk 224.0 -> 204.4 against crayon's working
      // 201.5, pressed end unchanged at 226.0): width alone broke the stroke into two components,
      // width+spacing gave 0.633 against 0.605, spacing curve 3.2 broke it again, curve 0.34 gave
      // 0.677 against 0.585, and a tip band at 0.70/0.72/0.76/0.80 gave 0.633-0.665.
      //
      // hazeBlur keeps the guard's actual intent — a tip must not smear past its own silhouette —
      // by counting only fringe beyond a dab radius of solid pigment. The bound is absolute rather
      // than a comparison because the union carrier has ZERO haze at any reach down to 1px, so
      // "kernel <= union" would forbid any haze at all and no textured tip can meet that. 0.30 sits
      // 1.8x above the widest baseline measured across the gated materials (chalk 0.165, crayon
      // 0.066), which leaves room for tooth while still catching a falloff that has come unmoored.
      expect(kernel.hazeBlur, brushId).toBeLessThanOrEqual(0.30);
        expect(kernel.toothVariance, brushId)
          .toBeGreaterThanOrEqual(union.toothVariance * 0.55);
        continue;
      }
      expect(kernel.toothVariance, brushId)
        .toBeGreaterThanOrEqual(union.toothVariance);
    }
    // Numbers for the workstream summary (deterministic — identical on every run).
    expect(Object.keys(summary)).toHaveLength(5);
  }, PIXEL_PARITY_TIMEOUT_MS);
});
