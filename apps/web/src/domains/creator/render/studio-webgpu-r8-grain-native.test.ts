import { describe, expect, it, vi } from "vitest";

import { StudioBrushR8GrainRegistry } from "../brush/studio-brush-r8-grain-runtime";
import { sha256HexPortable } from "../studio-sha256";

import {
  StudioWebGpuR8GrainTextureCache,
  packStudioWebGpuR8GrainNativeUniform,
  planStudioWebGpuR8GrainNative,
  sampleStudioWebGpuR8GrainNativeCpu,
  studioWebGpuR8GrainDabCenterUv,
  studioWebGpuR8GrainNativeWgsl,
  type StudioWebGpuR8GrainNativeInput,
} from "./studio-webgpu-r8-grain-native";

import type { StudioBrushR8TextureGrainSource } from "../brush/studio-brush-r8-grain-asset-contract";
import type { StudioBrushR8GrainTransferSnapshotEntry } from "../brush/studio-brush-r8-grain-runtime";

interface FakeTexture {
  readonly descriptor: GPUTextureDescriptor;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeGpu {
  readonly device: GPUDevice;
  readonly textures: FakeTexture[];
  readonly samplerDescriptors: GPUSamplerDescriptor[];
  readonly uploads: Array<{
    readonly destination: GPUTexelCopyTextureInfo;
    readonly bytes: Uint8Array;
    readonly layout: GPUTexelCopyBufferLayout;
    readonly size: GPUExtent3DStrict;
  }>;
}

function fakeGpu(maxTextureDimension2D = 16_384): FakeGpu {
  const textures: FakeTexture[] = [];
  const samplerDescriptors: GPUSamplerDescriptor[] = [];
  const uploads: FakeGpu["uploads"] = [];
  const device = {
    limits: { maxTextureDimension2D },
    lost: new Promise<GPUDeviceLostInfo>(() => undefined),
    queue: {
      writeTexture: vi.fn((
        destination: GPUTexelCopyTextureInfo,
        source: AllowSharedBufferSource,
        layout: GPUTexelCopyBufferLayout,
        size: GPUExtent3DStrict,
      ) => {
        const view = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
          : new Uint8Array(source);
        uploads.push({
          destination,
          bytes: new Uint8Array(view),
          layout,
          size,
        });
      }),
    },
    createSampler: vi.fn((descriptor: GPUSamplerDescriptor) => {
      samplerDescriptors.push(descriptor);
      return { descriptor } as unknown as GPUSampler;
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      const texture = {
        descriptor,
        destroy,
        createView: vi.fn(() => ({ descriptor })),
      } as unknown as GPUTexture;
      textures.push({ descriptor, destroy });
      return texture;
    }),
  } as unknown as GPUDevice;
  return { device, textures, samplerDescriptors, uploads };
}

function sourceFixture(
  bytes: Uint8Array,
  overrides: Partial<StudioBrushR8TextureGrainSource["asset"]> = {},
): Readonly<StudioBrushR8TextureGrainSource> {
  const width = overrides.width ?? bytes.length;
  const height = overrides.height ?? 1;
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: overrides.assetId ?? "paper.native-r8.v1",
      encodedSha256:
        overrides.encodedSha256
        ?? "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      decodedSha256:
        overrides.decodedSha256
        ?? `sha256:${sha256HexPortable(bytes)}`,
      byteLength: overrides.byteLength ?? 128,
      mediaType: "image/png",
      width,
      height,
      channel: overrides.channel ?? "alpha",
      encoding: "r8-unorm",
    },
  };
}

function nativeInput(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  overrides: Partial<StudioWebGpuR8GrainNativeInput> = {},
): StudioWebGpuR8GrainNativeInput {
  return {
    source,
    space: "canvas-fixed",
    scale: 7.25,
    amount: 0.76,
    contrast: 0.42,
    seed: 0x1234_5678,
    strokeOriginX: 91.25,
    strokeOriginY: -38.75,
    strokeSeed: 0xdead_beef,
    ...overrides,
  };
}

function readyPlan(input: StudioWebGpuR8GrainNativeInput) {
  const result = planStudioWebGpuR8GrainNative(input);
  if (result.status !== "ready") throw new Error(result.status);
  return result.plan;
}

describe("native WebGPU R8 grain plan", () => {
  it("matches the verified CPU sampler for alpha/luminance and both anchor spaces", () => {
    const bytes = new Uint8Array([
      0, 31, 127,
      191, 223, 255,
    ]);
    const positions = [
      [-17.75, -2.5],
      [0, 0],
      [2.25, 4.75],
      [91.25, -38.75],
      [310.125, 97.875],
    ] as const;

    for (const channel of ["alpha", "luminance"] as const) {
      for (const space of ["canvas-fixed", "stroke-fixed"] as const) {
        const source = sourceFixture(bytes, {
          assetId: `paper.${channel}.${space}`,
          width: 3,
          height: 2,
          channel,
        });
        const registry = new StudioBrushR8GrainRegistry();
        expect(registry.hydrate(source, bytes).status).toBe("ready");
        const sampler = registry.resolve(source);
        expect(sampler).not.toBeNull();
        const input = nativeInput(source, { space });
        const plan = readyPlan(input);
        const snapshot = registry.snapshotForTransfer(source);
        expect(snapshot).not.toBeNull();
        for (const [x, y] of positions) {
          const expected = sampler!.sampleAlphaMultiplierAt({
            x,
            y,
            strokeOriginX: input.strokeOriginX,
            strokeOriginY: input.strokeOriginY,
            strokeSeed: input.strokeSeed,
            space,
            scale: input.scale,
            amount: input.amount,
            contrast: input.contrast,
            seed: input.seed,
          });
          const actual = sampleStudioWebGpuR8GrainNativeCpu(
            plan,
            snapshot!.decodedBytes,
            x,
            y,
          );
          expect(actual).toBeCloseTo(expected, 6);
        }
        snapshot!.decodedBytes.fill(0);
      }
    }
  });

  it("pins stroke-fixed grain to the stroke while canvas-fixed grain remains in document space", () => {
    const bytes = new Uint8Array([0, 63, 127, 191, 223, 255]);
    const source = sourceFixture(bytes, { width: 3, height: 2 });
    const stroke = readyPlan(nativeInput(source, { space: "stroke-fixed" }));
    const canvas = readyPlan(nativeInput(source, { space: "canvas-fixed" }));
    const start = sampleStudioWebGpuR8GrainNativeCpu(stroke, bytes, 95.5, -29.25);
    const translated = readyPlan(nativeInput(source, {
      space: "stroke-fixed",
      strokeOriginX: 131.25,
      strokeOriginY: -18.75,
    }));
    expect(sampleStudioWebGpuR8GrainNativeCpu(
      translated,
      bytes,
      135.5,
      -9.25,
    )).toBeCloseTo(start, 12);
    expect(sampleStudioWebGpuR8GrainNativeCpu(
      canvas,
      bytes,
      135.5,
      -9.25,
    )).not.toBeCloseTo(
      sampleStudioWebGpuR8GrainNativeCpu(canvas, bytes, 95.5, -29.25),
      3,
    );
  });

  it("emits an exact 32-byte uniform and collision-checked WGSL declarations", () => {
    const bytes = new Uint8Array([0, 255, 64, 192]);
    const plan = readyPlan(nativeInput(sourceFixture(bytes, { width: 2, height: 2 })));
    const uniform = packStudioWebGpuR8GrainNativeUniform(plan.parameters);
    expect(uniform).toHaveLength(8);
    expect(uniform.byteLength).toBe(32);
    expect([...uniform]).toEqual([
      Math.fround(plan.parameters.anchorX),
      Math.fround(plan.parameters.anchorY),
      Math.fround(plan.parameters.phaseX),
      Math.fround(plan.parameters.phaseY),
      Math.fround(plan.parameters.scale),
      Math.fround(plan.parameters.amount),
      Math.fround(plan.parameters.contrast),
      1,
    ]);
    const wgsl = studioWebGpuR8GrainNativeWgsl({
      group: 2,
      textureBinding: 0,
      samplerBinding: 1,
      uniformBinding: 2,
      prefix: "paper_grain",
    });
    expect(wgsl).toContain("@group(2) @binding(0)");
    expect(wgsl).toContain("textureSample(paper_grain_texture");
    expect(wgsl).toContain(
      "dab_center_uv + document_offset_from_dab_center / scale",
    );
    expect(
      wgsl?.match(/document_offset_from_dab_center: vec2f/gu),
    ).toHaveLength(1);
    expect(wgsl).toContain("contrast * 4.0");
    expect(wgsl).toContain("1.0 - amount * (1.0 - contrasted)");
    expect(studioWebGpuR8GrainNativeWgsl({
      group: 0,
      textureBinding: 1,
      samplerBinding: 1,
      uniformBinding: 2,
    })).toBeNull();
    expect(studioWebGpuR8GrainNativeWgsl({
      group: 0,
      textureBinding: 0,
      samplerBinding: 1,
      uniformBinding: 2,
      prefix: "bad-prefix",
    })).toBeNull();
  });

  it("wraps a large-coordinate dab centre in f64 before WebGPU f32 packing", () => {
    const bytes = new Uint8Array([0, 255]);
    const strokeOriginX = 999_999.91;
    const strokeOriginY = -999_999.89;
    const plan = readyPlan(nativeInput(sourceFixture(bytes), {
      space: "stroke-fixed",
      scale: 0.3,
      strokeOriginX,
      strokeOriginY,
    }));
    const centerX = strokeOriginX - 0.09;
    const centerY = strokeOriginY + 0.11;
    const uv = studioWebGpuR8GrainDabCenterUv(
      plan.parameters,
      centerX,
      centerY,
    );
    const wrap = (value: number) => ((value % 1) + 1) % 1;
    expect(uv).not.toBeNull();
    expect(plan.parameters.anchorX).toBe(strokeOriginX);
    expect(plan.parameters.anchorY).toBe(strokeOriginY);
    expect(uv![0]).toBeCloseTo(
      wrap(
        (centerX - plan.parameters.anchorX) / plan.parameters.scale
          + plan.parameters.phaseX,
      ),
      6,
    );
    expect(uv![1]).toBeCloseTo(
      wrap(
        (centerY - plan.parameters.anchorY) / plan.parameters.scale
          + plan.parameters.phaseY,
      ),
      6,
    );
    const lossyFragmentUv =
      (Math.fround(centerX) - Math.fround(plan.parameters.anchorX))
        / plan.parameters.scale
      + plan.parameters.phaseX;
    expect(
      Math.abs(wrap(lossyFragmentUv) - uv![0]),
    ).toBeGreaterThan(0.05);
  });

  it("fails closed for unknown fields, URL injection, accessors, invalid ranges, and zero amount", () => {
    const bytes = new Uint8Array([0, 255]);
    const source = sourceFixture(bytes);
    expect(planStudioWebGpuR8GrainNative({
      ...nativeInput(source),
      url: "https://unverified.invalid/paper.png",
    })).toEqual({ status: "rejected", reason: "invalid-input" });

    const poisoned = nativeInput(source) as unknown as Record<string, unknown>;
    const sourceGetter = vi.fn();
    Object.defineProperty(poisoned, "source", {
      enumerable: true,
      get: sourceGetter,
    });
    expect(planStudioWebGpuR8GrainNative(poisoned)).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    expect(sourceGetter).not.toHaveBeenCalled();
    expect(planStudioWebGpuR8GrainNative(nativeInput(source, { scale: 0 }))).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    expect(planStudioWebGpuR8GrainNative(nativeInput(source, { amount: 0 }))).toEqual({
      status: "inactive",
    });
  });
});

describe("native WebGPU R8 grain texture cache", () => {
  it("fails closed for invalid explicit constructor budgets", () => {
    const device = fakeGpu().device;
    for (const options of [
      { maxEntries: -1 },
      { maxEntries: Number.NaN },
      { maxEntries: 1.5 },
      { maxTextureDimension2D: 0 },
      { maxTextureDimension2D: Number.POSITIVE_INFINITY },
      { maxTextureByteLength: -1 },
      { maxResidentBytes: Number.NaN },
      { maxResidentBytes: -1 },
      { maxStagingBytes: 1.5 },
    ]) {
      expect(() => new StudioWebGpuR8GrainTextureCache({
        device,
        ...options,
      })).toThrow(/WebGPU R8 cache budget/u);
    }
  });

  it("uploads one verified r8unorm texture, keeps registry bytes private, and reuses it across dabs", () => {
    const gpu = fakeGpu();
    const bytes = new Uint8Array([
      0, 32, 96,
      160, 224, 255,
    ]);
    const source = sourceFixture(bytes, { width: 3, height: 2, channel: "luminance" });
    const registry = new StudioBrushR8GrainRegistry();
    expect(registry.hydrate(source, bytes).status).toBe("ready");
    let transferred: Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null = null;
    const cache = new StudioWebGpuR8GrainTextureCache({
      device: gpu.device,
      snapshotForTransfer: (candidate) => {
        transferred = registry.snapshotForTransfer(candidate);
        return transferred;
      },
    });

    const first = cache.acquire(nativeInput(source));
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    expect(first.lease.format).toBe("r8unorm");
    expect(first.lease.channel).toBe("luminance");
    expect(first.lease.createUniformData()).toHaveLength(8);
    expect(gpu.textures).toHaveLength(1);
    expect(gpu.textures[0]!.descriptor.format).toBe("r8unorm");
    expect(gpu.uploads).toHaveLength(1);
    expect(gpu.uploads[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(gpu.uploads[0]!.bytes).toHaveLength(512);
    expect(gpu.uploads[0]!.bytes.slice(0, 3)).toEqual(bytes.slice(0, 3));
    expect(gpu.uploads[0]!.bytes.slice(256, 259)).toEqual(bytes.slice(3, 6));
    expect(transferred).not.toBeNull();
    expect([...(transferred as unknown as StudioBrushR8GrainTransferSnapshotEntry).decodedBytes])
      .toEqual([0, 0, 0, 0, 0, 0]);

    const registryCopy = registry.snapshotForTransfer(source);
    expect(registryCopy?.decodedBytes).toEqual(bytes);
    registryCopy?.decodedBytes.fill(0);
    const second = cache.acquire(nativeInput(source, {
      amount: 0.3,
      contrast: 0.8,
      strokeSeed: 9,
    }));
    expect(second.status).toBe("ready");
    expect(gpu.textures).toHaveLength(1);
    expect(gpu.uploads).toHaveLength(1);
    expect(cache.stats()).toMatchObject({
      entries: 1,
      uploads: 1,
      hits: 1,
      misses: 1,
      activeLeases: 2,
    });
    first.lease.release();
    first.lease.release();
    if (second.status === "ready") second.lease.release();
    expect(cache.stats().activeLeases).toBe(0);
    cache.dispose();
    expect(gpu.textures[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("pins active textures and evicts only released LRU entries within resident budgets", () => {
    const gpu = fakeGpu();
    const firstBytes = new Uint8Array([0, 64, 128, 255]);
    const secondBytes = new Uint8Array([255, 128, 64, 0]);
    const firstSource = sourceFixture(firstBytes, {
      assetId: "paper.first",
      width: 2,
      height: 2,
    });
    const secondSource = sourceFixture(secondBytes, {
      assetId: "paper.second",
      width: 2,
      height: 2,
    });
    const registry = new StudioBrushR8GrainRegistry();
    registry.hydrate(firstSource, firstBytes);
    registry.hydrate(secondSource, secondBytes);
    const cache = new StudioWebGpuR8GrainTextureCache({
      device: gpu.device,
      maxEntries: 1,
      maxResidentBytes: 512,
      snapshotForTransfer: (source) => registry.snapshotForTransfer(source),
    });
    const first = cache.acquire(nativeInput(firstSource));
    expect(first.status).toBe("ready");
    expect(cache.acquire(nativeInput(secondSource))).toEqual({
      status: "rejected",
      reason: "resident-budget",
    });
    if (first.status === "ready") first.lease.release();
    const second = cache.acquire(nativeInput(secondSource));
    expect(second.status).toBe("ready");
    expect(gpu.textures).toHaveLength(2);
    expect(gpu.textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({
      entries: 1,
      residentBytes: 512,
      evictions: 1,
    });
    if (second.status === "ready") second.lease.release();
  });

  it("rejects missing, aliased, corrupted, and over-budget snapshots before GPU upload", () => {
    const bytes = new Uint8Array([0, 64, 128, 255]);
    const source = sourceFixture(bytes, { width: 2, height: 2 });

    const missingGpu = fakeGpu();
    const missing = new StudioWebGpuR8GrainTextureCache({
      device: missingGpu.device,
      snapshotForTransfer: () => null,
    });
    expect(missing.acquire(nativeInput(source))).toEqual({
      status: "rejected",
      reason: "asset-not-hydrated",
    });
    expect(missing.acquire(nativeInput(source), {
      maxResidentBytes: Number.NaN,
    })).toEqual({
      status: "rejected",
      reason: "resident-budget",
    });
    expect(missing.acquire(nativeInput(source), {
      maxResidentBytes: -1,
    })).toEqual({
      status: "rejected",
      reason: "resident-budget",
    });
    expect(missing.trimToResidentBytes(Number.POSITIVE_INFINITY)).toBe(false);
    expect(missingGpu.textures).toHaveLength(0);

    const corruptGpu = fakeGpu();
    const corrupt = new StudioWebGpuR8GrainTextureCache({
      device: corruptGpu.device,
      snapshotForTransfer: () => ({
        sourceKey: JSON.stringify(source),
        source,
        decodedBytes: new Uint8Array([1, 64, 128, 255]),
      }),
    });
    expect(corrupt.acquire(nativeInput(source))).toEqual({
      status: "rejected",
      reason: "decoded-hash-mismatch",
    });
    expect(corruptGpu.textures).toHaveLength(0);

    const registry = new StudioBrushR8GrainRegistry();
    registry.hydrate(source, bytes);
    const budgetGpu = fakeGpu();
    const budget = new StudioWebGpuR8GrainTextureCache({
      device: budgetGpu.device,
      maxTextureByteLength: 3,
      snapshotForTransfer: (candidate) => registry.snapshotForTransfer(candidate),
    });
    expect(budget.acquire(nativeInput(source))).toEqual({
      status: "rejected",
      reason: "texture-byte-budget",
    });
    expect(budgetGpu.textures).toHaveLength(0);
  });
});
