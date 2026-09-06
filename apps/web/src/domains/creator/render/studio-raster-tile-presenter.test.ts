import { describe, expect, it, vi } from "vitest";

import {
  buildStudioRasterTileVertices,
  packStudioRasterGpuUpload,
  planStudioRasterTilePresentation,
  StudioRasterTilePresenter,
  verifyStudioRasterTilePlanHashes,
  type StudioRasterTileFrameRequest,
  type StudioRasterTilePresentationPlan,
} from "./studio-raster-tile-presenter";

import type { StudioRasterImmutableTileFrame } from "../live/studio-crdt-raster-replay-runtime";

import {
  STUDIO_RASTER_CRDT_VERSION,
  type StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";

const surface = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 300,
  height: 260,
  tileSize: 128,
} as const;

function tileDimensions(
  currentSurface: StudioRasterSurfaceSpec,
  tileX: number,
  tileY: number
): { width: number; height: number } {
  return {
    width: Math.min(currentSurface.tileSize, currentSurface.width - tileX * currentSurface.tileSize),
    height: Math.min(currentSurface.tileSize, currentSurface.height - tileY * currentSurface.tileSize),
  };
}

function tile(
  currentSurface: StudioRasterSurfaceSpec,
  tileX: number,
  tileY: number,
  options: {
    sha256?: string;
    pixels?: Uint8ClampedArray;
    copy?: () => Uint8ClampedArray;
  } = {}
): StudioRasterImmutableTileFrame {
  const { width, height } = tileDimensions(currentSurface, tileX, tileY);
  const pixels = options.pixels ?? new Uint8ClampedArray(width * height * 4).fill(tileY + tileX + 1);
  const copy = options.copy ?? vi.fn(() => Uint8ClampedArray.from(pixels));
  return {
    surfaceId: currentSurface.surfaceId,
    tileX,
    tileY,
    width,
    height,
    byteLength: width * height * 4,
    sha256: options.sha256 ?? "a".repeat(64),
    get rgba() {
      return Uint8ClampedArray.from(pixels);
    },
    copyRgba: copy,
  };
}

function request(
  tiles: readonly StudioRasterImmutableTileFrame[],
  overrides: Partial<StudioRasterTileFrameRequest> = {}
): StudioRasterTileFrameRequest {
  return {
    generation: 1,
    surface,
    tiles,
    viewport: {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      flipX: false,
      surfaceBounds: { left: 0, top: 0, width: surface.width, height: surface.height },
      devicePixelRatio: 2,
    },
    ...overrides,
  };
}

function ready(
  tiles: readonly StudioRasterImmutableTileFrame[],
  overrides: Partial<StudioRasterTileFrameRequest> = {}
): StudioRasterTilePresentationPlan {
  const plan = planStudioRasterTilePresentation(request(tiles, overrides));
  if (plan.status !== "ready") throw new Error(`expected ready plan, got ${plan.reason}`);
  return plan;
}

async function sha256(bytes: Uint8Array | Uint8ClampedArray): Promise<string> {
  const owned = Uint8Array.from(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned.buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

interface FakeCanvasContext {
  readonly save: ReturnType<typeof vi.fn>;
  readonly restore: ReturnType<typeof vi.fn>;
  readonly setTransform: ReturnType<typeof vi.fn>;
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly createImageData: ReturnType<typeof vi.fn>;
  readonly putImageData: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  globalCompositeOperation: GlobalCompositeOperation;
}

function fakeContext(): FakeCanvasContext {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
    globalCompositeOperation: "source-over",
  };
}

function fakePresentationCanvases() {
  const canvas2dContext = fakeContext();
  const scratchContext = fakeContext();
  const ownerDocument = {
    createElement: vi.fn(() => ({
      width: 1,
      height: 1,
      style: {},
      ownerDocument,
      getContext: () => scratchContext,
    })),
  };
  const canvas2dCanvas = {
    width: 1,
    height: 1,
    style: {},
    ownerDocument,
    getContext: () => canvas2dContext,
  } as unknown as HTMLCanvasElement;
  const gpuCanvas = {
    width: 1,
    height: 1,
    style: {},
    ownerDocument,
    getContext: vi.fn(() => null),
  } as unknown as HTMLCanvasElement;
  return { canvas2dCanvas, canvas2dContext, gpuCanvas };
}

function fakeWebGpuPresenterHarness(options: { readonly failSubmit?: boolean } = {}) {
  const canvases = fakePresentationCanvases();
  let resolveDeviceLost!: (info: GPUDeviceLostInfo) => void;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveDeviceLost = resolve;
  });
  const context = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
  };
  canvases.gpuCanvas.getContext = vi.fn((kind: string) => (
    kind === "webgpu" ? context : null
  )) as unknown as HTMLCanvasElement["getContext"];
  const renderPass = {
    setPipeline: vi.fn(),
    setVertexBuffer: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const vertexBuffer = {
    getMappedRange: vi.fn(() => new ArrayBuffer(24 * 4)),
    unmap: vi.fn(),
    destroy: vi.fn(),
  };
  const texture = {
    createView: vi.fn(() => ({})),
    destroy: vi.fn(),
  };
  const device = {
    lost,
    queue: {
      writeTexture: vi.fn(),
      submit: options.failSubmit
        ? vi.fn(() => { throw new Error("submit failed"); })
        : vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(() => texture),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => vertexBuffer),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => renderPass),
      finish: vi.fn(() => ({})),
    })),
    destroy: vi.fn(),
  };
  const requestDevice = vi.fn(async () => device as unknown as GPUDevice);
  const requestAdapter = vi.fn(async () => ({ requestDevice }) as unknown as GPUAdapter);
  const gpu = { requestAdapter } as unknown as GPU;
  return {
    ...canvases,
    context,
    device,
    gpu,
    requestAdapter,
    resolveDeviceLost,
  };
}

describe("studio raster tile presentation planner", () => {
  it("sorts sparse tiles deterministically and plans exact edge dimensions and backing pixels", () => {
    const plan = ready([
      tile(surface, 2, 2),
      tile(surface, 0, 0),
      tile(surface, 1, 0),
    ]);

    expect(plan.physicalWidth).toBe(600);
    expect(plan.physicalHeight).toBe(520);
    expect(plan.tiles.map(({ tileX, tileY }) => [tileX, tileY])).toEqual([
      [0, 0],
      [1, 0],
      [2, 2],
    ]);
    expect(plan.tiles[2]).toMatchObject({
      width: 44,
      height: 4,
      documentX: 256,
      documentY: 256,
      cssRect: { left: 256, top: 256, width: 44, height: 4 },
      bytesPerRow: 176,
      uploadBytesPerRow: 256,
    });
  });

  it("materializes only visible rows of a tall surface and never reads hidden RGBA", () => {
    const tallSurface = {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: "surface-tall",
      width: 128,
      height: 4_096,
      tileSize: 128,
    } as const;
    const copies = new Map<number, ReturnType<typeof vi.fn<() => Uint8ClampedArray>>>();
    const make = (row: number) => {
      const copy = vi.fn<() => Uint8ClampedArray>(
        () => new Uint8ClampedArray(128 * 128 * 4).fill(row)
      );
      copies.set(row, copy);
      return tile(tallSurface, 0, row, { copy });
    };
    const tiles = [make(0), make(7), make(8), make(9), make(10), make(31)];
    const plan = ready(tiles, {
      surface: tallSurface,
      viewport: {
        scaleX: 1,
        scaleY: 16,
        offsetX: 0,
        offsetY: -16_384,
        flipX: false,
        surfaceBounds: { left: 0, top: 1_024, width: 128, height: 256 },
        devicePixelRatio: 1,
      },
    });

    expect(plan.tiles.map(({ tileY }) => tileY)).toEqual([8, 9]);
    expect(copies.get(8)).toHaveBeenCalledOnce();
    expect(copies.get(9)).toHaveBeenCalledOnce();
    expect(copies.get(0)).not.toHaveBeenCalled();
    expect(copies.get(7)).not.toHaveBeenCalled();
    expect(copies.get(10)).not.toHaveBeenCalled();
    expect(copies.get(31)).not.toHaveBeenCalled();
  });

  it("mirrors document geometry while keeping UVs attached to their original tile pixels", () => {
    const flippedSurface = {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: "surface-flipped",
      width: 256,
      height: 128,
      tileSize: 128,
    } as const;
    const plan = ready([tile(flippedSurface, 1, 0), tile(flippedSurface, 0, 0)], {
      surface: flippedSurface,
      viewport: {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: true,
        surfaceBounds: { left: 0, top: 0, width: 256, height: 128 },
        devicePixelRatio: 1,
      },
    });
    const vertices = buildStudioRasterTileVertices(plan);

    expect(plan.tiles.map(({ tileX, cssRect }) => ({ tileX, left: cssRect.left }))).toEqual([
      { tileX: 0, left: 128 },
      { tileX: 1, left: 0 },
    ]);
    expect([...vertices.slice(0, 8)]).toEqual([
      1, 1, 0, 0,
      0, 1, 1, 0,
    ]);
  });

  it("pads GPU upload rows to 256 bytes without changing straight RGBA row contents", () => {
    const narrowSurface = {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: "surface-narrow",
      width: 70,
      height: 2,
      tileSize: 128,
    } as const;
    const pixels = new Uint8ClampedArray(70 * 2 * 4);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = index % 251;
    const plan = ready([tile(narrowSurface, 0, 0, { pixels })], {
      surface: narrowSurface,
      viewport: {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: false,
        surfaceBounds: { left: 0, top: 0, width: 70, height: 2 },
        devicePixelRatio: 1,
      },
    });
    const upload = packStudioRasterGpuUpload(plan.tiles[0]!);

    expect(upload.bytesPerRow).toBe(512);
    expect(upload.rowsPerImage).toBe(2);
    expect(upload.bytes).toHaveLength(1_024);
    expect(upload.bytes.slice(0, 280)).toEqual(Uint8Array.from(pixels.slice(0, 280)));
    expect(upload.bytes.slice(280, 512).every((value) => value === 0)).toBe(true);
    expect(upload.bytes.slice(512, 792)).toEqual(Uint8Array.from(pixels.slice(280)));
  });

  it("rejects surface, identity, dimensions, byte length, hash, type and duplicate corruption", () => {
    const base = tile(surface, 0, 0);
    const cases: Array<readonly [string, readonly StudioRasterImmutableTileFrame[]]> = [
      ["surface", [{ ...base, surfaceId: "other" }]],
      ["width", [{ ...base, width: 127 }]],
      ["bytes", [{ ...base, byteLength: base.byteLength - 4 }]],
      ["hash", [{ ...base, sha256: "A".repeat(64) }]],
      ["address", [{ ...base, tileX: 99 }]],
      ["duplicate", [base, tile(surface, 0, 0)]],
      ["throwing-copy", [{ ...base, copyRgba: () => { throw new Error("corrupt"); } }]],
      ["wrong-type", [{
        ...base,
        copyRgba: (() => new Uint8Array(base.byteLength)) as unknown as () => Uint8ClampedArray,
      }]],
    ];

    for (const [label, tiles] of cases) {
      expect(planStudioRasterTilePresentation(request(tiles)), label).toMatchObject({
        status: "rejected",
      });
    }
  });

  it("rejects malformed viewport, unsafe backing size, and invalid generation before tile copies", () => {
    const copy = vi.fn(() => new Uint8ClampedArray(128 * 128 * 4));
    const frame = tile(surface, 0, 0, { copy });
    expect(planStudioRasterTilePresentation(request([frame], {
      generation: -1,
    }))).toEqual({ status: "rejected", reason: "invalid-generation" });
    expect(planStudioRasterTilePresentation(request([frame], {
      viewport: {
        scaleX: 0,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: false,
        surfaceBounds: { left: 0, top: 0, width: 300, height: 260 },
      },
    }))).toEqual({ status: "rejected", reason: "invalid-viewport" });
    expect(planStudioRasterTilePresentation(request([frame], {
      viewport: {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: false,
        surfaceBounds: { left: 0, top: 0, width: 10_000, height: 10_000 },
        devicePixelRatio: 2,
      },
    }))).toEqual({ status: "rejected", reason: "backing-size-limit" });
    expect(copy).not.toHaveBeenCalled();
  });

  it("produces the same plan and vertices regardless of replay tile input order", () => {
    const first = tile(surface, 0, 0);
    const second = tile(surface, 1, 0);
    const third = tile(surface, 2, 2);
    const left = ready([third, first, second]);
    const right = ready([second, third, first]);

    expect(left.tiles.map(({ key }) => key)).toEqual(right.tiles.map(({ key }) => key));
    expect(buildStudioRasterTileVertices(left)).toEqual(buildStudioRasterTileVertices(right));
  });

  it("cryptographically verifies visible raw RGBA and rejects stale/tampered frames", async () => {
    const pixels = new Uint8ClampedArray(128 * 128 * 4).fill(17);
    const digest = await sha256(pixels);
    const valid = ready([tile(surface, 0, 0, { pixels, sha256: digest })]);
    const controller = new AbortController();

    await expect(verifyStudioRasterTilePlanHashes(valid, controller.signal)).resolves.toEqual({
      status: "verified",
    });

    const tampered = ready([tile(surface, 0, 0, { pixels, sha256: "f".repeat(64) })]);
    await expect(verifyStudioRasterTilePlanHashes(tampered, controller.signal)).resolves.toMatchObject({
      status: "rejected",
      reason: "sha256-mismatch",
    });
    await expect(verifyStudioRasterTilePlanHashes(
      valid,
      controller.signal,
      async () => "NOT-A-DIGEST"
    )).resolves.toMatchObject({ status: "rejected", reason: "invalid-sha256-result" });
  });

  it("aborts hash verification before any digest work", async () => {
    const plan = ready([tile(surface, 0, 0)]);
    const controller = new AbortController();
    const digest = vi.fn(async () => "a".repeat(64));
    controller.abort();

    await expect(verifyStudioRasterTilePlanHashes(plan, controller.signal, digest))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(digest).not.toHaveBeenCalled();
  });

  it("renders through Canvas2D only when it is explicitly selected at construction", async () => {
    const canvases = fakePresentationCanvases();
    const onFrameReady = vi.fn();
    const onBackendChange = vi.fn();
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas: canvases.gpuCanvas,
      canvas2dCanvas: canvases.canvas2dCanvas,
      gpu: null,
      sha256: async () => "a".repeat(64),
      onFrameReady,
      onBackendChange,
    });

    await expect(presenter.present(request([tile(surface, 0, 0)]))).resolves.toEqual({
      status: "ready",
      generation: 1,
      backend: "canvas2d",
      visibleTileCount: 1,
    });

    expect(canvases.canvas2dCanvas.width).toBe(600);
    expect(canvases.canvas2dCanvas.height).toBe(520);
    expect(canvases.canvas2dContext.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(canvases.canvas2dContext.imageSmoothingEnabled).toBe(false);
    expect(canvases.canvas2dContext.drawImage).toHaveBeenCalledOnce();
    expect(canvases.canvas2dCanvas.style.visibility).toBe("visible");
    expect(canvases.gpuCanvas.style.visibility).toBe("hidden");
    expect(onBackendChange).toHaveBeenCalledWith("canvas2d");
    expect(onFrameReady).toHaveBeenCalledExactlyOnceWith(1);
    presenter.dispose();
  });

  it("keeps WebGPU selected and unavailable without executing Canvas2D during retry cooldown", async () => {
    const canvases = fakePresentationCanvases();
    let now = 1_000;
    const requestAdapter = vi.fn(async () => null);
    const onFrameInvalid = vi.fn();
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas: canvases.gpuCanvas,
      canvas2dCanvas: canvases.canvas2dCanvas,
      gpu: { requestAdapter } as unknown as GPU,
      sha256: async () => "a".repeat(64),
      now: () => now,
      onFrameInvalid,
    });

    await expect(presenter.present(request([tile(surface, 0, 0)]))).resolves.toMatchObject({
      status: "rejected",
      reason: "webgpu-unavailable",
    });
    now += 29_999;
    await expect(presenter.present(request([tile(surface, 0, 0)], { generation: 2 })))
      .resolves.toMatchObject({ status: "rejected", reason: "webgpu-unavailable" });
    expect(requestAdapter).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(presenter.present(request([tile(surface, 0, 0)], { generation: 3 })))
      .resolves.toMatchObject({ status: "rejected", reason: "webgpu-unavailable" });
    expect(requestAdapter).toHaveBeenCalledTimes(2);

    now += 119_999;
    await presenter.present(request([tile(surface, 0, 0)], { generation: 4 }));
    expect(requestAdapter).toHaveBeenCalledTimes(2);
    now += 1;
    await presenter.present(request([tile(surface, 0, 0)], { generation: 5 }));
    expect(requestAdapter).toHaveBeenCalledTimes(3);
    expect(requestAdapter).toHaveBeenLastCalledWith();
    expect(presenter.getBackend()).toBe("unavailable");
    expect(onFrameInvalid).toHaveBeenCalledWith(1, "webgpu-unavailable");
    expect(canvases.canvas2dContext.drawImage).not.toHaveBeenCalled();
    expect(canvases.canvas2dCanvas.style.visibility).toBe("hidden");
    presenter.dispose();
  });

  it("fails closed after a WebGPU render error without drawing the frame through Canvas2D", async () => {
    const harness = fakeWebGpuPresenterHarness({ failSubmit: true });
    const onFrameInvalid = vi.fn();
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas: harness.gpuCanvas,
      canvas2dCanvas: harness.canvas2dCanvas,
      gpu: harness.gpu,
      sha256: async () => "a".repeat(64),
      onFrameInvalid,
    });

    await expect(presenter.present(request([tile(surface, 0, 0)]))).resolves.toEqual({
      status: "rejected",
      generation: 1,
      reason: "presentation-failed",
    });
    expect(presenter.getBackend()).toBe("unavailable");
    expect(onFrameInvalid).toHaveBeenCalledWith(1, "presentation-failed");
    expect(harness.canvas2dContext.drawImage).not.toHaveBeenCalled();
    expect(harness.canvas2dCanvas.style.visibility).toBe("hidden");
    presenter.dispose();
  });

  it("marks a presented WebGPU frame unavailable on device loss without Canvas2D re-execution", async () => {
    const harness = fakeWebGpuPresenterHarness();
    const onFrameInvalid = vi.fn();
    const onDeviceLost = vi.fn();
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas: harness.gpuCanvas,
      canvas2dCanvas: harness.canvas2dCanvas,
      gpu: harness.gpu,
      sha256: async () => "a".repeat(64),
      onFrameInvalid,
      onDeviceLost,
    });

    await expect(presenter.present(request([tile(surface, 0, 0)]))).resolves.toMatchObject({
      status: "ready",
      backend: "webgpu",
    });
    harness.resolveDeviceLost({ reason: "unknown", message: "test loss" } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(presenter.getBackend()).toBe("unavailable"));

    expect(onDeviceLost).toHaveBeenCalledTimes(1);
    expect(onFrameInvalid).toHaveBeenCalledWith(1, "device-lost");
    expect(harness.gpuCanvas.style.visibility).toBe("hidden");
    expect(harness.canvas2dCanvas.style.visibility).toBe("hidden");
    expect(harness.canvas2dContext.drawImage).not.toHaveBeenCalled();
    presenter.dispose();
  });

  it("never reveals a superseded async generation after the newer frame is complete", async () => {
    const canvases = fakePresentationCanvases();
    const onFrameReady = vi.fn();
    let resolveFirst!: (value: string) => void;
    const firstDigest = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    let digestCall = 0;
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas: canvases.gpuCanvas,
      canvas2dCanvas: canvases.canvas2dCanvas,
      gpu: null,
      sha256: async () => {
        digestCall += 1;
        return digestCall === 1 ? firstDigest : "a".repeat(64);
      },
      onFrameReady,
    });
    const first = presenter.present(request([tile(surface, 0, 0)], { generation: 1 }));
    const second = presenter.present(request([tile(surface, 0, 0)], { generation: 2 }));

    await expect(second).resolves.toMatchObject({ status: "ready", generation: 2 });
    resolveFirst("a".repeat(64));
    await expect(first).resolves.toEqual({ status: "stale", generation: 1, reason: "stale" });
    expect(onFrameReady).toHaveBeenCalledTimes(1);
    expect(onFrameReady).toHaveBeenCalledWith(2);
    presenter.dispose();
  });
});
