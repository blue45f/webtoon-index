import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_TOLERANCES,
  studioGpuBristleSplatCapacity,
} from "./studio-gpu-bristle-contract";
import {
  judgeStudioGpuBristleConstraintSatisfaction,
  judgeStudioGpuBristlePigmentConservation,
  judgeStudioGpuBristleTerminalLoadDistribution,
  judgeStudioGpuBristleTipLag,
  studioGpuBristleSplatCoverage,
  studioGpuBristleStandardDeviation,
  studioGpuBristleTerminalLoads,
  studioGpuBristleTipLag,
  type StudioGpuBristleStateShape,
} from "./studio-gpu-bristle-metrics";
import {
  STUDIO_GPU_BRISTLE_REFERENCE_VERSION,
  advanceStudioGpuBristleReference,
  createStudioGpuBristleReference,
  packStudioGpuBristleState,
  resetStudioGpuBristleReference,
  resolveStudioGpuBristleConfig,
  StudioGpuBristleReferenceError,
  studioGpuBristleLayoutDraw,
  type StudioGpuBristleReference,
  type StudioGpuBristleStation,
  type StudioGpuBristleTuftOptions,
} from "./studio-gpu-bristle-reference";

const BASE_OPTIONS: StudioGpuBristleTuftOptions = {
  baseRadiusPx: 15,
  bristleCount: 44,
  seed: 7,
  ink: [0.9, 0.2, 0.1],
};

/** A 90° corner: 150 stations east, then 150 stations south. */
function cornerStroke(count: number, pressure: number): StudioGpuBristleStation[] {
  const stations: StudioGpuBristleStation[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    stations.push({
      x: t < 0.5 ? 40 + t * 2 * 200 : 240,
      y: t < 0.5 ? 60 : 60 + (t - 0.5) * 2 * 200,
      pressure,
      dtMs: 1000 / 120,
    });
  }
  return stations;
}

function straightStroke(count: number, pressure: number): StudioGpuBristleStation[] {
  const stations: StudioGpuBristleStation[] = [];
  for (let index = 0; index < count; index += 1) {
    stations.push({ x: 40 + index, y: 60, pressure, dtMs: 1000 / 120 });
  }
  return stations;
}

function shapeOf(reference: StudioGpuBristleReference): StudioGpuBristleStateShape {
  return {
    bristleCount: reference.config.bristleCount,
    verticesPerBristle: reference.config.verticesPerBristle,
    restLengths: reference.restLengths,
  };
}

function runWhole(
  options: StudioGpuBristleTuftOptions,
  stations: readonly StudioGpuBristleStation[],
) {
  const reference = createStudioGpuBristleReference(options);
  const result = advanceStudioGpuBristleReference(reference, stations, {
    trace: true,
    traceBristle: 3,
  });
  return { reference, result };
}

describe("studio-gpu-bristle-reference determinism", () => {
  it("is a pure function of its inputs", () => {
    const stations = cornerStroke(120, 0.6);
    const first = runWhole(BASE_OPTIONS, stations);
    const second = runWhole(BASE_OPTIONS, stations);
    expect(Array.from(second.reference.bristleState)).toEqual(
      Array.from(first.reference.bristleState),
    );
    expect(Array.from(second.result.splats)).toEqual(Array.from(first.result.splats));
  });

  it("uses no clock and no Math.random", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./studio-gpu-bristle-reference.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).toContain("STUDIO_GPU_BRISTLE_REFERENCE_VERSION");
    // Call sites only — the header prose names all three as forbidden.
    expect(source).not.toContain("Math.random(");
    expect(source).not.toContain("Date.now(");
    expect(source).not.toContain("performance.now(");
    expect(STUDIO_GPU_BRISTLE_REFERENCE_VERSION).toBe("studio-gpu-bristle-reference-v1");
  });

  it("draws the tuft layout from the seed alone", () => {
    const config = resolveStudioGpuBristleConfig(BASE_OPTIONS);
    const other = resolveStudioGpuBristleConfig({ ...BASE_OPTIONS, seed: 8 });
    expect(studioGpuBristleLayoutDraw(config, 5)).toEqual(studioGpuBristleLayoutDraw(config, 5));
    expect(studioGpuBristleLayoutDraw(other, 5)).not.toEqual(
      studioGpuBristleLayoutDraw(config, 5),
    );
  });

  it("carries dt in the station rather than deriving it from the station index", () => {
    const slow = runWhole(
      BASE_OPTIONS,
      straightStroke(60, 0.6).map((station) => ({ ...station, dtMs: 32 })),
    );
    const fast = runWhole(
      BASE_OPTIONS,
      straightStroke(60, 0.6).map((station) => ({ ...station, dtMs: 4 })),
    );
    expect(Array.from(fast.reference.bristleState)).not.toEqual(
      Array.from(slow.reference.bristleState),
    );
  });
});

describe("studio-gpu-bristle-reference gate G1 — self parity under suffix chunking", () => {
  const stations = cornerStroke(320, 0.65);
  // Fixed seeded chunk sizes, exactly as the design specifies: 1, 4, 17, 3, 256, …
  const chunkSizes = [1, 4, 17, 3, 256, 40, 79, 2, 128];

  it("replays chunk-by-chunk to the byte-identical bristle state", () => {
    const whole = runWhole(BASE_OPTIONS, stations);
    const incremental = createStudioGpuBristleReference(BASE_OPTIONS);
    let cursor = 0;
    let chunk = 0;
    while (cursor < stations.length) {
      const size = Math.min(chunkSizes[chunk % chunkSizes.length]!, stations.length - cursor);
      advanceStudioGpuBristleReference(incremental, stations.slice(cursor, cursor + size));
      cursor += size;
      chunk += 1;
    }
    expect(incremental.consumedStationCount).toBe(stations.length);
    for (let index = 0; index < whole.reference.bristleState.length; index += 1) {
      expect(
        Object.is(incremental.bristleState[index], whole.reference.bristleState[index]),
      ).toBe(true);
    }
  });

  it("emits a byte-identical splat stream, which is what fixes the blend order", () => {
    const whole = runWhole(BASE_OPTIONS, stations);
    const incremental = createStudioGpuBristleReference(BASE_OPTIONS);
    const parts: Float64Array[] = [];
    let cursor = 0;
    let chunk = 0;
    while (cursor < stations.length) {
      const size = Math.min(chunkSizes[chunk % chunkSizes.length]!, stations.length - cursor);
      parts.push(
        advanceStudioGpuBristleReference(incremental, stations.slice(cursor, cursor + size))
          .splats,
      );
      cursor += size;
      chunk += 1;
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const concatenated = new Float64Array(total);
    let offset = 0;
    for (const part of parts) {
      concatenated.set(part, offset);
      offset += part.length;
    }
    expect(concatenated.length).toBe(whole.result.splats.length);
    for (let index = 0; index < concatenated.length; index += 1) {
      expect(Object.is(concatenated[index], whole.result.splats[index])).toBe(true);
    }
  });

  it("recovers a prefix break by replaying from station 0", () => {
    const whole = runWhole(BASE_OPTIONS, stations);
    const broken = createStudioGpuBristleReference(BASE_OPTIONS);
    advanceStudioGpuBristleReference(broken, cornerStroke(97, 0.2));
    resetStudioGpuBristleReference(broken);
    advanceStudioGpuBristleReference(broken, stations);
    expect(Array.from(broken.bristleState)).toEqual(Array.from(whole.reference.bristleState));
  });

  it("sizes the splat buffer at bristles × stations with no reserved stride", () => {
    const { reference, result } = runWhole(BASE_OPTIONS, stations);
    expect(result.splatCapacity).toBe(
      studioGpuBristleSplatCapacity(reference.config.bristleCount, stations.length),
    );
    expect(result.splats.length).toBe(
      result.splatCapacity * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
    );
  });
});

describe("studio-gpu-bristle-reference gate G2 — static equilibrium", () => {
  it("settles a jitter-free, gravity-free tuft to an exactly straight chain", () => {
    const options: StudioGpuBristleTuftOptions = {
      baseRadiusPx: 12,
      bristleCount: 8,
      seed: 3,
      bristleJitter: 0,
      stiffnessVariation: 0,
      gravity: 0,
    };
    const { reference, result } = runWhole(options, straightStroke(40, 0).map((station) => ({
      ...station,
      x: 50,
      y: 50,
    })));
    let worstLateral = 0;
    let worstDepth = 0;
    for (let bristle = 0; bristle < reference.config.bristleCount; bristle += 1) {
      const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
      const rootX = reference.bristleState[base]!;
      const rootY = reference.bristleState[base + 1]!;
      const rootZ = reference.bristleState[base + 2]!;
      const rest = reference.restLengths[bristle]!;
      for (let vertex = 0; vertex < reference.config.verticesPerBristle; vertex += 1) {
        const slot = base + vertex * 4;
        worstLateral = Math.max(
          worstLateral,
          Math.hypot(reference.bristleState[slot]! - rootX, reference.bristleState[slot + 1]! - rootY),
        );
        worstDepth = Math.max(
          worstDepth,
          Math.abs(reference.bristleState[slot + 2]! - (rootZ - vertex * rest)),
        );
      }
    }
    const scale = reference.config.bristleLength * reference.config.baseRadiusPx;
    expect(worstLateral / scale).toBeLessThan(STUDIO_GPU_BRISTLE_TOLERANCES.staticEquilibrium);
    expect(worstDepth / scale).toBeLessThan(STUDIO_GPU_BRISTLE_TOLERANCES.staticEquilibrium);
    // A perfectly straight tuft that only grazes the paper has nothing to deposit — a
    // zero-pressure touch must feather to nothing, not lay a full-strength mark.
    expect(result.depositedSplatCount).toBe(0);
  });
});

describe("studio-gpu-bristle-reference gate G3 — invariants on the chaotic part", () => {
  const stations = cornerStroke(300, 0.6);

  it("satisfies the chain length constraint after the solve", () => {
    const { reference } = runWhole(BASE_OPTIONS, stations);
    const judgement = judgeStudioGpuBristleConstraintSatisfaction(
      reference.bristleState,
      shapeOf(reference),
    );
    expect(judgement.pass).toBe(true);
    expect(judgement.value).toBeLessThan(STUDIO_GPU_BRISTLE_TOLERANCES.constraintSlack);
  });

  it("fails that gate when the iteration count is gutted", () => {
    const { reference } = runWhole({ ...BASE_OPTIONS, iterations: 1 }, stations);
    expect(
      judgeStudioGpuBristleConstraintSatisfaction(reference.bristleState, shapeOf(reference)).pass,
    ).toBe(false);
  });

  it("produces a tip lag far above the degenerate-chain floor", () => {
    const { reference, result } = runWhole(BASE_OPTIONS, stations);
    const lag = studioGpuBristleTipLag(result.trace!.root, result.trace!.tip);
    const bristleLengthPx = reference.config.bristleLength * reference.config.baseRadiusPx;
    expect(judgeStudioGpuBristleTipLag(lag, lag, bristleLengthPx).pass).toBe(true);
    expect(lag).toBeGreaterThan(bristleLengthPx * 0.1);
  });

  it("spreads terminal ink load across the tuft instead of reading as a uniform rake", () => {
    const { reference } = runWhole(BASE_OPTIONS, stations);
    const loads = studioGpuBristleTerminalLoads(reference.bristleState, shapeOf(reference));
    expect(studioGpuBristleStandardDeviation(loads)).toBeGreaterThan(0.01);
    expect(Math.min(...loads)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...loads)).toBeLessThanOrEqual(1);
  });

  it("catches BRISTLE_JITTER and STIFFNESS_VARIATION being dropped together", () => {
    const { reference: baseline } = runWhole(BASE_OPTIONS, stations);
    const { reference: flattened } = runWhole(
      { ...BASE_OPTIONS, bristleJitter: 0, stiffnessVariation: 0 },
      stations,
    );
    const judgement = judgeStudioGpuBristleTerminalLoadDistribution(
      studioGpuBristleTerminalLoads(flattened.bristleState, shapeOf(flattened)),
      studioGpuBristleTerminalLoads(baseline.bristleState, shapeOf(baseline)),
    );
    expect(judgement.pass).toBe(false);
  });

  it("catches STIFFNESS_VARIATION, BRISTLE_JITTER, bending and the rest-pose recall individually", () => {
    const { result: baseline } = runWhole(BASE_OPTIONS, stations);
    const mutations: readonly [string, Partial<StudioGpuBristleTuftOptions>][] = [
      ["stiffnessVariation", { stiffnessVariation: 0 }],
      ["bristleJitter", { bristleJitter: 0 }],
      ["bendStiffnessRatio", { bendStiffnessRatio: 0 }],
      ["restPoseStiffnessRatio", { restPoseStiffnessRatio: 0 }],
    ];
    for (const [name, mutation] of mutations) {
      const { result } = runWhole({ ...BASE_OPTIONS, ...mutation }, stations);
      const judgement = judgeStudioGpuBristlePigmentConservation(
        result.splats,
        baseline.splats,
      );
      expect(judgement.pass, `${name} must move deposited coverage`).toBe(false);
    }
  });

  it("agrees with itself inside the conservation tolerance", () => {
    const first = runWhole(BASE_OPTIONS, stations);
    const second = runWhole(BASE_OPTIONS, stations);
    expect(
      judgeStudioGpuBristlePigmentConservation(second.result.splats, first.result.splats).pass,
    ).toBe(true);
  });
});

describe("studio-gpu-bristle-reference paints, and paints more with pressure", () => {
  it("deposits a monotonically heavier mark as pressure rises", () => {
    const rates = [0, 0.25, 0.5, 1].map((pressure) => {
      const { result } = runWhole(BASE_OPTIONS, straightStroke(100, pressure));
      return result.depositedSplatCount / result.splatCapacity;
    });
    expect(rates[0]!).toBeGreaterThan(0);
    expect(rates[0]!).toBeLessThan(rates[1]!);
    expect(rates[1]!).toBeLessThan(rates[2]!);
    expect(rates[2]!).toBeLessThanOrEqual(rates[3]!);
    expect(rates[3]!).toBeCloseTo(1, 2);
  });

  it("lays real capsule geometry rather than an empty buffer", () => {
    const { result } = runWhole(BASE_OPTIONS, straightStroke(100, 0.7));
    expect(studioGpuBristleSplatCoverage(result.splats)).toBeGreaterThan(0);
    let travelled = 0;
    for (
      let slot = 0;
      slot < result.splats.length;
      slot += STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT
    ) {
      if (!(result.splats[slot + 7]! > 0)) continue;
      travelled += Math.hypot(
        result.splats[slot + 2]! - result.splats[slot]!,
        result.splats[slot + 3]! - result.splats[slot + 1]!,
      );
      expect(result.splats[slot + 8]!).toBeGreaterThan(0);
    }
    // A capsule whose ends coincide everywhere would mean the tip never moved.
    expect(travelled).toBeGreaterThan(0);
  });

  it("depletes ink as the stroke runs", () => {
    const short = runWhole(BASE_OPTIONS, straightStroke(20, 0.8));
    const long = runWhole(BASE_OPTIONS, straightStroke(400, 0.8));
    const shortLoads = studioGpuBristleTerminalLoads(
      short.reference.bristleState,
      shapeOf(short.reference),
    );
    const longLoads = studioGpuBristleTerminalLoads(
      long.reference.bristleState,
      shapeOf(long.reference),
    );
    const mean = (values: Float64Array) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(longLoads)).toBeLessThan(mean(shortLoads));
  });
});

describe("studio-gpu-bristle-reference packing and validation", () => {
  it("packs the f64 twin into the f32 byte layout the GPU holds", () => {
    const { reference } = runWhole(BASE_OPTIONS, straightStroke(30, 0.5));
    const packed = packStudioGpuBristleState(reference);
    expect(packed.length).toBe(reference.bristleState.length);
    expect(packed[0]).toBe(Math.fround(reference.bristleState[0]!));
    expect(() => packStudioGpuBristleState(reference, new Float32Array(3))).toThrow(
      StudioGpuBristleReferenceError,
    );
  });

  it("rejects a nonsensical tuft rather than producing silent nonsense", () => {
    expect(() => createStudioGpuBristleReference({ baseRadiusPx: 0 })).toThrow(
      StudioGpuBristleReferenceError,
    );
    expect(() => createStudioGpuBristleReference({ baseRadiusPx: 12, iterations: 0 })).toThrow(
      StudioGpuBristleReferenceError,
    );
    expect(() =>
      createStudioGpuBristleReference({ baseRadiusPx: 12, damping: Number.NaN }),
    ).toThrow(StudioGpuBristleReferenceError);
  });

  it("clamps a requested hair count into the lane ceiling", () => {
    const reference = createStudioGpuBristleReference({ baseRadiusPx: 12, bristleCount: 4096 });
    expect(reference.config.bristleCount).toBe(128);
    expect(reference.bristleState.length).toBe(128 * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE);
  });
});
