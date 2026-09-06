import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_VRM_TEXTURE_PAINT_FULL_UPLOAD_THRESHOLD,
  STUDIO_VRM_TEXTURE_PAINT_GPU_ROW_ALIGNMENT,
  STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS,
  createStudioVrmTexturePaintGpuUploadPlan,
  executeStudioVrmTexturePaintGpuUpload,
  type StudioVrmTexturePaintGpuDeviceLike,
  type StudioVrmTexturePaintGpuQueueLike,
  type StudioVrmTexturePaintGpuUploadPlan,
} from "./studio-vrm-texture-paint-gpu-upload";

function rgba(width: number, height: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(width * height * 4);
  for (let index = 0; index < value.length; index += 1) {
    value[index] = (index * 17 + 3) % 251;
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plan(
  generation = 1,
): StudioVrmTexturePaintGpuUploadPlan {
  return createStudioVrmTexturePaintGpuUploadPlan({
    rgba: rgba(16, 16),
    textureWidth: 16,
    textureHeight: 16,
    dirtyRect: { x: 4, y: 5, width: 3, height: 2 },
    generation,
  });
}

describe("studio VRM texture-paint WebGPU upload", () => {
  it("packs a partial RGBA8 dirty rect into deterministic 256-byte-aligned staging rows", async () => {
    const source = rgba(100, 4);
    const original = Uint8Array.from(source);
    const uploadPlan = createStudioVrmTexturePaintGpuUploadPlan({
      rgba: source,
      textureWidth: 100,
      textureHeight: 4,
      dirtyRect: { x: 3, y: 1, width: 10, height: 2 },
      generation: 7,
    });
    source.fill(0);

    expect(uploadPlan).toMatchObject({
      mode: "partial",
      bytesPerRow: 256,
      rowsPerImage: 2,
      byteLength: 512,
      requestedRect: { x: 3, y: 1, width: 10, height: 2 },
      uploadRect: { x: 3, y: 1, width: 10, height: 2 },
      fullUploadThreshold: DEFAULT_STUDIO_VRM_TEXTURE_PAINT_FULL_UPLOAD_THRESHOLD,
    });
    expect(uploadPlan.bytesPerRow % STUDIO_VRM_TEXTURE_PAINT_GPU_ROW_ALIGNMENT).toBe(0);
    expect(Object.isFrozen(uploadPlan)).toBe(true);
    expect("data" in uploadPlan).toBe(false);
    expect("rgba" in uploadPlan).toBe(false);

    const calls: Array<{
      destination: unknown;
      data: Uint8Array;
      layout: unknown;
      size: unknown;
    }> = [];
    const queue: StudioVrmTexturePaintGpuQueueLike = {
      writeTexture(destination, data, layout, size) {
        calls.push({
          destination,
          data: Uint8Array.from(data),
          layout,
          size,
        });
      },
    };
    const result = await executeStudioVrmTexturePaintGpuUpload(uploadPlan, {
      device: { queue },
      texture: { label: "face-base-color" },
      getCurrentGeneration: () => 7,
    });

    expect(result).toEqual({
      status: "uploaded",
      mode: "partial",
      generation: 7,
      byteLength: 512,
      uploadRect: { x: 3, y: 1, width: 10, height: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      destination: {
        texture: { label: "face-base-color" },
        mipLevel: 0,
        origin: { x: 3, y: 1, z: 0 },
        aspect: "all",
      },
      layout: {
        offset: 0,
        bytesPerRow: 256,
        rowsPerImage: 2,
      },
      size: {
        width: 10,
        height: 2,
        depthOrArrayLayers: 1,
      },
    });
    const staged = calls[0]!.data;
    const firstSourceOffset = (1 * 100 + 3) * 4;
    const secondSourceOffset = (2 * 100 + 3) * 4;
    expect(staged.subarray(0, 40)).toEqual(
      original.subarray(firstSourceOffset, firstSourceOffset + 40),
    );
    expect(staged.subarray(40, 256).every((byte) => byte === 0)).toBe(true);
    expect(staged.subarray(256, 296)).toEqual(
      original.subarray(secondSourceOffset, secondSourceOffset + 40),
    );
    expect(staged.subarray(296).every((byte) => byte === 0)).toBe(true);
  });

  it("promotes an expensive dirty upload to a full upload at the configured threshold", () => {
    const uploadPlan = createStudioVrmTexturePaintGpuUploadPlan({
      rgba: rgba(100, 10),
      textureWidth: 100,
      textureHeight: 10,
      dirtyRect: { x: 10, y: 0, width: 80, height: 10 },
      generation: 2,
    }, {
      fullUploadThreshold: 0.75,
    });

    expect(uploadPlan).toMatchObject({
      mode: "full",
      uploadRect: { x: 0, y: 0, width: 100, height: 10 },
      bytesPerRow: 512,
      rowsPerImage: 10,
      byteLength: 5_120,
      dirtyPixelRatio: 0.8,
      stagingByteRatio: 1,
      fullUploadThreshold: 0.75,
    });
  });

  it("rejects malformed dimensions, dirty rects, byte lengths, generations, thresholds, and budgets", () => {
    const base = {
      rgba: rgba(4, 4),
      textureWidth: 4,
      textureHeight: 4,
      dirtyRect: { x: 0, y: 0, width: 1, height: 1 },
      generation: 1,
    };

    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      ...base,
      rgba: new Uint8Array(63),
    })).toThrow(expect.objectContaining({ code: "BYTE_LENGTH_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      ...base,
      textureWidth: 4_097,
    })).toThrow(expect.objectContaining({ code: "DIMENSION_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      ...base,
      dirtyRect: { x: 3, y: 0, width: 2, height: 1 },
    })).toThrow(expect.objectContaining({ code: "DIRTY_RECT_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      ...base,
      dirtyRect: { x: 0.5, y: 0, width: 1, height: 1 },
    })).toThrow(expect.objectContaining({ code: "DIRTY_RECT_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      ...base,
      generation: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(expect.objectContaining({ code: "GENERATION_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan(base, {
      fullUploadThreshold: 0,
    })).toThrow(expect.objectContaining({ code: "THRESHOLD_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan(base, {
      limits: {
        maxDimension: STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS.maxDimension + 1,
      },
    })).toThrow(expect.objectContaining({ code: "LIMIT_INVALID" }));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan(base, {
      limits: { maxStagingBytes: 128 },
    })).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  it("rejects a SharedArrayBuffer-backed source instead of accepting concurrently mutable bytes", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    expect(() => createStudioVrmTexturePaintGpuUploadPlan({
      rgba: shared,
      textureWidth: 1,
      textureHeight: 1,
      dirtyRect: { x: 0, y: 0, width: 1, height: 1 },
      generation: 1,
    })).toThrow(expect.objectContaining({ code: "SOURCE_INVALID" }));
  });

  it("returns explicit unsupported results without relying on WebGPU global types", async () => {
    const uploadPlan = plan();
    await expect(executeStudioVrmTexturePaintGpuUpload(uploadPlan, {
      device: null,
      texture: {},
      getCurrentGeneration: () => 1,
    })).resolves.toEqual({
      status: "unsupported",
      reason: "webgpu-unavailable",
    });
    await expect(executeStudioVrmTexturePaintGpuUpload(uploadPlan, {
      device: { queue: {} as StudioVrmTexturePaintGpuQueueLike },
      texture: {},
      getCurrentGeneration: () => 1,
    })).resolves.toEqual({
      status: "unsupported",
      reason: "webgpu-unavailable",
    });

    const source = readFileSync(
      new URL("./studio-vrm-texture-paint-gpu-upload.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bGPU(?:Device|Queue|Texture)\b/u);
  });

  it("rejects pre-aborted and pre-stale work before queue.writeTexture", async () => {
    const writeTexture = vi.fn();
    const device: StudioVrmTexturePaintGpuDeviceLike = {
      queue: { writeTexture },
    };
    const controller = new AbortController();
    controller.abort();

    await expect(executeStudioVrmTexturePaintGpuUpload(plan(8), {
      device,
      texture: {},
      getCurrentGeneration: () => 8,
      signal: controller.signal,
    })).resolves.toEqual({ status: "rejected", reason: "aborted" });
    await expect(executeStudioVrmTexturePaintGpuUpload(plan(8), {
      device,
      texture: {},
      getCurrentGeneration: () => 9,
    })).resolves.toEqual({
      status: "rejected",
      reason: "stale-generation",
    });
    expect(writeTexture).not.toHaveBeenCalled();
  });

  it("rejects an already-lost device before enqueue", async () => {
    const writeTexture = vi.fn();
    const device: StudioVrmTexturePaintGpuDeviceLike = {
      queue: { writeTexture },
      lost: Promise.resolve({ reason: "destroyed" }),
    };

    await expect(executeStudioVrmTexturePaintGpuUpload(plan(), {
      device,
      texture: {},
      getCurrentGeneration: () => 1,
    })).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
    });
    expect(writeTexture).not.toHaveBeenCalled();
  });

  it("fails closed when the device is lost after enqueue but before queue completion", async () => {
    const lost = deferred<unknown>();
    const work = deferred<void>();
    const writeTexture = vi.fn();
    const device: StudioVrmTexturePaintGpuDeviceLike = {
      queue: {
        writeTexture,
        onSubmittedWorkDone: () => work.promise,
      },
      lost: lost.promise,
    };

    const pending = executeStudioVrmTexturePaintGpuUpload(plan(12), {
      device,
      texture: {},
      getCurrentGeneration: () => 12,
    });
    await vi.waitFor(() => expect(writeTexture).toHaveBeenCalledOnce());
    lost.resolve({ reason: "unknown" });

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "device-lost",
    });
  });

  it("rejects a generation that becomes stale or an abort that arrives after enqueue", async () => {
    const firstWork = deferred<void>();
    let generation = 20;
    const firstWrite = vi.fn();
    const stalePending = executeStudioVrmTexturePaintGpuUpload(plan(20), {
      device: {
        queue: {
          writeTexture: firstWrite,
          onSubmittedWorkDone: () => firstWork.promise,
        },
      },
      texture: {},
      getCurrentGeneration: () => generation,
    });
    await vi.waitFor(() => expect(firstWrite).toHaveBeenCalledOnce());
    generation = 21;
    firstWork.resolve();
    await expect(stalePending).resolves.toEqual({
      status: "rejected",
      reason: "stale-generation",
    });

    const secondWork = deferred<void>();
    const controller = new AbortController();
    const secondWrite = vi.fn();
    const abortPending = executeStudioVrmTexturePaintGpuUpload(plan(30), {
      device: {
        queue: {
          writeTexture: secondWrite,
          onSubmittedWorkDone: () => secondWork.promise,
        },
      },
      texture: {},
      getCurrentGeneration: () => 30,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(secondWrite).toHaveBeenCalledOnce());
    controller.abort();
    await expect(abortPending).resolves.toEqual({
      status: "rejected",
      reason: "aborted",
    });
  });

  it("maps invalid plans, generation failures, write failures, and queue failures to rejected results", async () => {
    const validPlan = plan();
    const device = {
      queue: {
        writeTexture: vi.fn(),
      },
    };
    await expect(executeStudioVrmTexturePaintGpuUpload(
      { ...validPlan } as StudioVrmTexturePaintGpuUploadPlan,
      {
        device,
        texture: {},
        getCurrentGeneration: () => 1,
      },
    )).resolves.toEqual({ status: "rejected", reason: "invalid-plan" });
    await expect(executeStudioVrmTexturePaintGpuUpload(validPlan, {
      device,
      texture: {},
      getCurrentGeneration: () => Number.NaN,
    })).resolves.toEqual({
      status: "rejected",
      reason: "generation-check-failed",
    });
    await expect(executeStudioVrmTexturePaintGpuUpload(validPlan, {
      device: {
        queue: {
          writeTexture() {
            throw new Error("validation");
          },
        },
      },
      texture: {},
      getCurrentGeneration: () => 1,
    })).resolves.toEqual({ status: "rejected", reason: "upload-failed" });
    await expect(executeStudioVrmTexturePaintGpuUpload(validPlan, {
      device: {
        queue: {
          writeTexture: vi.fn(),
          onSubmittedWorkDone: () => Promise.reject(new Error("queue")),
        },
      },
      texture: {},
      getCurrentGeneration: () => 1,
    })).resolves.toEqual({ status: "rejected", reason: "upload-failed" });
  });
});
