import { beforeEach, describe, expect, it } from "vitest";

import {
  planStudioWebGpuR8GrainNative,
  sampleStudioWebGpuR8GrainNativeCpu,
} from "../render/studio-webgpu-r8-grain-native";
import { renderStudioProceduralMediaSurfaceCpuOracle } from "../studio-procedural-media-surface-provider";

import { resetStudioBrushR8GrainRegistry } from "./studio-brush-r8-grain-runtime";
import { createStudioPaperSubstrateRecipeV1 } from "./studio-paper-substrate-recipe-v1";
import {
  bakeStudioPaperSubstrateTileV1,
  clearStudioPaperSubstrateTileCacheV1,
  registerStudioPaperSubstrateTileV1,
  STUDIO_PAPER_SUBSTRATE_ASSET_ID_PREFIX_V1,
} from "./studio-paper-substrate-tile-v1";

// 64² keeps the suite fast; the physics under test is scale-free.
const SIZE = 64;
const SEED = 0x0f0f_1234;

beforeEach(() => {
  clearStudioPaperSubstrateTileCacheV1();
  resetStudioBrushR8GrainRegistry();
});

describe("studio paper substrate tile", () => {
  it("bakes a signed 4-channel surface and an R8 mirror of its height", () => {
    const tile = bakeStudioPaperSubstrateTileV1({ kind: "rough", seed: SEED, size: SIZE });
    expect(tile).not.toBeNull();
    if (!tile) return;
    expect(tile.artifact.heightField.length).toBe(SIZE * SIZE);
    expect(tile.artifact.absorbency.length).toBe(SIZE * SIZE);
    expect(tile.artifact.grain.length).toBe(SIZE * SIZE);
    expect(tile.artifact.flow.length).toBe(SIZE * SIZE * 2);
    expect(tile.decodedBytes.byteLength).toBe(SIZE * SIZE);
    // R8 texel = round((h * 0.5 + 0.5) * 255): 128 is the contact-neutral plane.
    for (let index = 0; index < tile.decodedBytes.length; index += 97) {
      const expected = Math.round(
        Math.min(1, Math.max(0, tile.artifact.heightField[index]! * 0.5 + 0.5)) * 255,
      );
      expect(tile.decodedBytes[index]).toBe(expected);
    }
  });

  it("tiles with an exactly zero seam — the integer Fourier torus, not a crossfade", () => {
    const recipe = createStudioPaperSubstrateRecipeV1("charcoal", SEED, {
      seamlessPeriod: SIZE,
    });
    expect(recipe).not.toBeNull();
    if (!recipe) return;
    const core = renderStudioProceduralMediaSurfaceCpuOracle(recipe, {
      originX: 0, originY: 0, width: SIZE, height: SIZE, halo: 0,
    });
    const wrapped = renderStudioProceduralMediaSurfaceCpuOracle(recipe, {
      originX: SIZE, originY: 0, width: 1, height: SIZE, halo: 0,
    });
    let worst = 0;
    for (let y = 0; y < SIZE; y += 1) {
      worst = Math.max(worst, Math.abs(wrapped.heightField[y]! - core.heightField[y * SIZE]!));
    }
    expect(worst).toBe(0);
  });

  it("gives every sheet a distinct tile — the artist's choice reaches the bytes", () => {
    const rough = bakeStudioPaperSubstrateTileV1({ kind: "rough", seed: SEED, size: SIZE });
    const smooth = bakeStudioPaperSubstrateTileV1({ kind: "hot-press", seed: SEED, size: SIZE });
    expect(rough?.source.asset.decodedSha256).not.toBe(smooth?.source.asset.decodedSha256);
    expect(rough?.source.asset.assetId).toContain(
      `${STUDIO_PAPER_SUBSTRATE_ASSET_ID_PREFIX_V1}.rough.${SIZE}.`,
    );
  });

  it("honours the document seed — two seeds are two different sheets of the same paper", () => {
    const a = bakeStudioPaperSubstrateTileV1({ kind: "cold-press", seed: 11, size: SIZE });
    const b = bakeStudioPaperSubstrateTileV1({ kind: "cold-press", seed: 12, size: SIZE });
    expect(a?.source.asset.decodedSha256).not.toBe(b?.source.asset.decodedSha256);
  });

  it("hydrates into the shared R8 registry the WebGPU lane already reads", () => {
    const tile = bakeStudioPaperSubstrateTileV1({ kind: "washi", seed: SEED, size: SIZE });
    expect(tile).not.toBeNull();
    if (!tile) return;
    const result = registerStudioPaperSubstrateTileV1(tile);
    expect(result.status).toBe("ready");
  });

  it("plans onto the in-production native R8 lane and mirrors it bit for bit on the CPU", () => {
    const tile = bakeStudioPaperSubstrateTileV1({ kind: "canvas", seed: SEED, size: SIZE });
    expect(tile).not.toBeNull();
    if (!tile) return;
    const planned = planStudioWebGpuR8GrainNative({
      source: tile.source,
      space: "canvas-fixed",
      scale: SIZE,
      amount: 0.85,
      contrast: 0.4,
      seed: SEED >>> 0,
      strokeOriginX: 0,
      strokeOriginY: 0,
      strokeSeed: 0,
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(planned.plan.textureFormat).toBe("r8unorm");
    expect(planned.plan.sampler).toBe("repeat-bilinear");

    // The sampler the GPU shader mirrors: a document-space read that repeats every `scale` px.
    // Reading at (x) and (x + scale) must be identical — this is the property that makes the
    // GPU texture cache and the CPU fallback interchangeable.
    for (const x of [0, 3.5, 17.25, 63.9]) {
      const near = sampleStudioPaperSample(planned.plan, tile.decodedBytes, x, 7.5);
      const far = sampleStudioPaperSample(planned.plan, tile.decodedBytes, x + SIZE, 7.5);
      expect(far).toBeCloseTo(near, 12);
    }

    // A real sheet must actually modulate: a flat multiplier would mean the paper does nothing.
    const samples = Array.from({ length: 64 }, (_, index) =>
      sampleStudioPaperSample(planned.plan, tile.decodedBytes, index * 0.97, index * 1.31),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.05);
  });
});

function sampleStudioPaperSample(
  plan: Parameters<typeof sampleStudioWebGpuR8GrainNativeCpu>[0],
  bytes: Uint8Array,
  x: number,
  y: number,
): number {
  return sampleStudioWebGpuR8GrainNativeCpu(plan, bytes, x, y);
}
