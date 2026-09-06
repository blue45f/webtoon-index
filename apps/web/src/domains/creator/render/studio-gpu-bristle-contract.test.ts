import { describe, expect, it } from "vitest";

import {
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_FLUID_PAINT_RYB_CUBE,
} from "../brush/studio-fluid-paint-reference";

import {
  STUDIO_FLUID_PAINT_BRUSH as CONTRACT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY as CONTRACT_DISPLAY,
  STUDIO_FLUID_PAINT_RYB_CUBE as CONTRACT_RYB,
  STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT,
  STUDIO_GPU_BRISTLE_CONTRACT_VERSION,
  STUDIO_GPU_BRISTLE_LIMITS,
  STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS,
  STUDIO_GPU_BRISTLE_SPLAT_LAYOUT,
  STUDIO_GPU_BRISTLE_STATION_LAYOUT,
  STUDIO_GPU_BRISTLE_TOLERANCES,
  STUDIO_GPU_BRISTLE_TUFT_LAYOUT,
  StudioGpuBristleContractError,
  clampStudioGpuBristleCount,
  clampStudioGpuBristleStationDtMs,
  createStudioGpuBristleTuftUniform,
  readStudioGpuBristleTuftUniform,
  studioGpuBristleHash32,
  studioGpuBristleSplatCapacity,
  studioGpuBristleSplatSlot,
  studioGpuBristleUnitHash,
  writeStudioGpuBristleTuftUniform,
  type StudioGpuBristleTuftUniform,
} from "./studio-gpu-bristle-contract";

const SAMPLE: StudioGpuBristleTuftUniform = {
  bristleCount: 44,
  verticesPerBristle: 10,
  iterations: 20,
  stationCount: 7,
  dt: 1 / 120,
  gravity: 30,
  damping: 0.75,
  stiffnessVariation: 0.3,
  bristleLength: 4.5,
  jitter: 0.5,
  baseRadiusPx: 15,
  zThreshold: 0.13333,
  headX: 120.5,
  headY: -40.25,
  brushHeight: 2,
  filteredSpeed: 812.5,
};

describe("studio-gpu-bristle-contract layout tables", () => {
  it("pins the WGSL struct sizes the runtime allocates against", () => {
    expect(STUDIO_GPU_BRISTLE_CONTRACT_VERSION).toBe("studio-gpu-bristle-contract-v1");
    expect(STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.sizeOf).toBe(336);
    expect(STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.arrayStride).toBe(336);
    expect(STUDIO_GPU_BRISTLE_STATION_LAYOUT.sizeOf).toBe(32);
    expect(STUDIO_GPU_BRISTLE_SPLAT_LAYOUT.sizeOf).toBe(48);
    expect(STUDIO_GPU_BRISTLE_TUFT_LAYOUT.sizeOf).toBe(64);
    expect(STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE).toBe(84);
    expect(STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION).toBe(8);
    expect(STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT).toBe(12);
    expect(STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT).toBe(16);
  });

  it("keeps every struct a whole number of 16-byte lanes so array stride cannot surprise", () => {
    for (const layout of [
      STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT,
      STUDIO_GPU_BRISTLE_STATION_LAYOUT,
      STUDIO_GPU_BRISTLE_SPLAT_LAYOUT,
      STUDIO_GPU_BRISTLE_TUFT_LAYOUT,
    ]) {
      expect(layout.alignOf).toBe(16);
      expect(layout.sizeOf % 16).toBe(0);
      expect(layout.arrayStride).toBe(layout.sizeOf);
      for (const member of Object.values(layout.members)) {
        // vec4 lanes only. A scalar or vec3 member here is the WGSL alignment trap the whole
        // contract exists to prevent, and it silently breaks gate G2's byte-identical packer check.
        expect(member.offset % 16).toBe(0);
        expect(member.components).toBe(4);
        expect(member.size).toBe(member.count * 16);
      }
      const members = Object.values(layout.members);
      const tail = members[members.length - 1]!;
      expect(tail.offset + tail.size).toBe(layout.sizeOf);
    }
  });

  it("lays the bristle record out as pos | prev | params with no padding", () => {
    const { pos, prev, params } = STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.members;
    expect(pos!.offset).toBe(0);
    expect(pos!.count).toBe(STUDIO_GPU_BRISTLE_LIMITS.verticesPerBristle);
    expect(prev!.offset).toBe(pos!.offset + pos!.size);
    expect(prev!.count).toBe(STUDIO_GPU_BRISTLE_LIMITS.verticesPerBristle);
    expect(params!.offset).toBe(prev!.offset + prev!.size);
    expect(params!.count).toBe(1);
  });
});

describe("studio-gpu-bristle-contract dli numbers", () => {
  it("re-exports the MIT-attributed transcription rather than re-typing any constant", () => {
    expect(CONTRACT_BRUSH).toBe(STUDIO_FLUID_PAINT_BRUSH);
    expect(CONTRACT_DISPLAY).toBe(STUDIO_FLUID_PAINT_DISPLAY);
    expect(CONTRACT_RYB).toBe(STUDIO_FLUID_PAINT_RYB_CUBE);
  });

  it("sources every dli-owned physics default from that transcription", () => {
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.gravity).toBe(STUDIO_FLUID_PAINT_BRUSH.gravity);
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.damping).toBe(STUDIO_FLUID_PAINT_BRUSH.damping);
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.iterations).toBe(
      STUDIO_FLUID_PAINT_BRUSH.constraintIterations,
    );
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.bristleLength).toBe(
      STUDIO_FLUID_PAINT_BRUSH.bristleLength,
    );
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.bristleJitter).toBe(
      STUDIO_FLUID_PAINT_BRUSH.bristleJitter,
    );
    expect(STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.stiffnessVariation).toBe(
      STUDIO_FLUID_PAINT_BRUSH.stiffnessVariation,
    );
    expect(STUDIO_GPU_BRISTLE_LIMITS.verticesPerBristle).toBe(
      STUDIO_FLUID_PAINT_BRUSH.verticesPerBristle,
    );
  });

  it("keeps the tuft inside one compute workgroup", () => {
    expect(STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount).toBeLessThanOrEqual(
      STUDIO_GPU_BRISTLE_LIMITS.workgroupSize,
    );
    // 128 is inside the universal maxComputeInvocationsPerWorkgroup floor of 256.
    expect(STUDIO_GPU_BRISTLE_LIMITS.workgroupSize).toBeLessThanOrEqual(256);
  });
});

describe("studio-gpu-bristle-contract tuft uniform packer", () => {
  it("writes vec4u counts and vec4f lanes into the exact bytes the GPU is handed", () => {
    const packed = writeStudioGpuBristleTuftUniform(createStudioGpuBristleTuftUniform(), SAMPLE);
    const counts = new Uint32Array(packed.buffer, packed.byteOffset, 4);
    expect(Array.from(counts)).toEqual([44, 10, 20, 7]);
    expect(Array.from(packed.subarray(4, 8))).toEqual([
      Math.fround(1 / 120),
      30,
      0.75,
      Math.fround(0.3),
    ]);
    expect(Array.from(packed.subarray(8, 12))).toEqual([4.5, 0.5, 15, Math.fround(0.13333)]);
    expect(Array.from(packed.subarray(12, 16))).toEqual([120.5, -40.25, 2, 812.5]);
  });

  it("round-trips through the reader", () => {
    const packed = writeStudioGpuBristleTuftUniform(createStudioGpuBristleTuftUniform(), SAMPLE);
    const read = readStudioGpuBristleTuftUniform(packed);
    expect(read.bristleCount).toBe(SAMPLE.bristleCount);
    expect(read.stationCount).toBe(SAMPLE.stationCount);
    expect(read.dt).toBe(Math.fround(SAMPLE.dt));
    expect(read.headX).toBe(SAMPLE.headX);
    expect(read.filteredSpeed).toBe(SAMPLE.filteredSpeed);
  });

  it("packs into a shared buffer at an offset without disturbing its neighbours", () => {
    const shared = new Float32Array(48);
    shared.fill(-1);
    const view = shared.subarray(16, 32);
    writeStudioGpuBristleTuftUniform(view, SAMPLE);
    expect(shared[15]).toBe(-1);
    expect(shared[32]).toBe(-1);
    expect(readStudioGpuBristleTuftUniform(view).bristleCount).toBe(44);
  });

  it("refuses a short target, a non-integer count and a non-finite lane", () => {
    expect(() => writeStudioGpuBristleTuftUniform(new Float32Array(15), SAMPLE)).toThrow(
      StudioGpuBristleContractError,
    );
    expect(() =>
      writeStudioGpuBristleTuftUniform(createStudioGpuBristleTuftUniform(), {
        ...SAMPLE,
        bristleCount: 2.5,
      }),
    ).toThrow(StudioGpuBristleContractError);
    expect(() =>
      writeStudioGpuBristleTuftUniform(createStudioGpuBristleTuftUniform(), {
        ...SAMPLE,
        headX: Number.NaN,
      }),
    ).toThrow(StudioGpuBristleContractError);
  });
});

describe("studio-gpu-bristle-contract deterministic hash", () => {
  it("pins concrete values so the WGSL transcription has fixtures to match", () => {
    expect(studioGpuBristleHash32(0, 0, 0)).toBe(3348245848);
    expect(studioGpuBristleHash32(1, 0, 1)).toBe(2366707307);
    expect(studioGpuBristleHash32(1, 1, 2)).toBe(837750123);
    expect(studioGpuBristleHash32(7, 43, 4)).toBe(1800344674);
    expect(studioGpuBristleHash32(-3, 5, 9)).toBe(129748821);
  });

  it("never returns zero for the all-zero input", () => {
    // An avalanche of zero is zero; bristle 0 of seed 0 would draw a degenerate layout.
    expect(studioGpuBristleHash32(0, 0, 0)).not.toBe(0);
  });

  it("stays inside u32 and maps into [0, 1)", () => {
    for (let index = 0; index < 256; index += 1) {
      const raw = studioGpuBristleHash32(11, index, 3);
      expect(Number.isInteger(raw)).toBe(true);
      expect(raw).toBeGreaterThanOrEqual(0);
      expect(raw).toBeLessThan(2 ** 32);
      const unit = studioGpuBristleUnitHash(11, index, 3);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it("decorrelates neighbouring bristle indices", () => {
    const samples: number[] = [];
    for (let index = 0; index < 512; index += 1) {
      samples.push(studioGpuBristleUnitHash(5, index, 1));
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.42);
    expect(mean).toBeLessThan(0.58);
    expect(new Set(samples).size).toBe(samples.length);
  });
});

describe("studio-gpu-bristle-contract splat slots", () => {
  it("is station-major so slot order survives any batch chunking", () => {
    const bristleCount = 3;
    const whole = [0, 1].flatMap((station) =>
      [0, 1, 2].map((bristle) => studioGpuBristleSplatSlot(bristle, station, bristleCount)),
    );
    expect(whole).toEqual([0, 1, 2, 3, 4, 5]);

    // Two one-station batches, concatenated in arrival order, must yield the same sequence of
    // (bristle, station) pairs — that is what makes an incremental solve blend-order identical to
    // a from-scratch replay under `blend {one, one}`.
    const chunked = [0, 1].flatMap((station) =>
      [0, 1, 2].map(
        (bristle) =>
          station * bristleCount + studioGpuBristleSplatSlot(bristle, 0, bristleCount),
      ),
    );
    expect(chunked).toEqual(whole);
  });

  it("sizes capacity as bristles × stations, with no reserved stride", () => {
    expect(studioGpuBristleSplatCapacity(44, 100)).toBe(4400);
    expect(studioGpuBristleSplatCapacity(1, 1)).toBe(1);
  });
});

describe("studio-gpu-bristle-contract clamps", () => {
  it("keeps hair counts inside the lane's supported range", () => {
    expect(clampStudioGpuBristleCount(0)).toBe(STUDIO_GPU_BRISTLE_LIMITS.minBristleCount);
    expect(clampStudioGpuBristleCount(44)).toBe(44);
    expect(clampStudioGpuBristleCount(10_000)).toBe(STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount);
    expect(clampStudioGpuBristleCount(Number.NaN)).toBeGreaterThan(0);
  });

  it("keeps a stalled pointer from exploding the integrator", () => {
    expect(clampStudioGpuBristleStationDtMs(1000 / 120)).toBeCloseTo(1000 / 120, 10);
    expect(clampStudioGpuBristleStationDtMs(5000)).toBe(STUDIO_GPU_BRISTLE_LIMITS.maxStationDtMs);
    expect(clampStudioGpuBristleStationDtMs(0)).toBe(
      STUDIO_GPU_BRISTLE_LIMITS.retainedStationDtMs,
    );
    expect(clampStudioGpuBristleStationDtMs(Number.NaN)).toBe(
      STUDIO_GPU_BRISTLE_LIMITS.retainedStationDtMs,
    );
  });
});

describe("studio-gpu-bristle-contract tolerances", () => {
  it("declares every G3 threshold so no test may inline one", () => {
    expect(Object.keys(STUDIO_GPU_BRISTLE_TOLERANCES).sort()).toEqual([
      "constraintSlack",
      "impastoChannelLsb",
      "pigmentConservation",
      "splayRecoveryTau",
      "staticEquilibrium",
      "terminalLoadKs",
      "tipLagBand",
    ]);
    for (const value of Object.values(STUDIO_GPU_BRISTLE_TOLERANCES)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});
