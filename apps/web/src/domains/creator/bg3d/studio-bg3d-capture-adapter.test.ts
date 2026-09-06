import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
  acquireStudioBg3dCaptureAdapterAfterViewTransition,
  captureStudioBg3dRaster,
  getStudioBg3dCaptureBackendIdentity,
  getStudioBg3dCaptureSourceSize,
  type StudioBg3dCaptureAdapter,
  type StudioBg3dCapturedRaster,
  type StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";
import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";

const REQUEST: StudioBg3dCaptureRequest = {
  width: 2,
  height: 2,
  background: { color: "#123abc", alpha: 0 },
  includeDepth: true,
};

function validRaster(): StudioBg3dCapturedRaster {
  return {
    width: 2,
    height: 2,
    rgba: new Uint8ClampedArray(16),
    depth: Float32Array.from([0, 0.25, 0.75, 1]),
  };
}

function adapter(
  capture: StudioBg3dCaptureAdapter["capture"] = async () => validRaster(),
  getSourceSize: StudioBg3dCaptureAdapter["getSourceSize"] = () => ({ width: 1280, height: 720 }),
): StudioBg3dCaptureAdapter {
  return {
    backend: "three-webgl",
    engineId: "three",
    engineVersion: "184",
    implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
    graphicsApi: "webgl2",
    profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
    getSourceSize,
    capture,
  };
}

describe("Studio 3D capture adapter contract", () => {
  it("binds the replacement single-View adapter only after its framebuffer is stable", async () => {
    const quadAdapter = adapter();
    const singleViewAdapter = adapter();
    let currentAdapter: StudioBg3dCaptureAdapter | null = quadAdapter;
    let paintCount = 0;
    const readAdapter = vi.fn(() => currentAdapter);

    const acquired = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
      isActive: () => true,
      readAdapter,
      waitForPaintFrame: async () => {
        paintCount += 1;
        if (paintCount === 1) currentAdapter = singleViewAdapter;
      },
    });

    expect(paintCount).toBe(4);
    expect(readAdapter).toHaveBeenCalledTimes(3);
    expect(acquired).toBe(singleViewAdapter);
    expect(acquired).not.toBe(quadAdapter);
  });

  it("waits through delayed ResizeObserver framebuffer changes before returning", async () => {
    const sizes = [
      { width: 960, height: 540 },
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
    ];
    const getSourceSize = vi.fn(() => sizes.shift() ?? { width: 1280, height: 720 });
    const settledAdapter = adapter(async () => validRaster(), getSourceSize);
    let paintCount = 0;

    const acquired = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
      isActive: () => true,
      readAdapter: () => settledAdapter,
      waitForPaintFrame: async () => {
        paintCount += 1;
      },
    });

    expect(acquired).toBe(settledAdapter);
    expect(getSourceSize).toHaveBeenCalledTimes(4);
    expect(paintCount).toBe(5);
    expect(getStudioBg3dCaptureSourceSize(acquired!)).toEqual({ width: 1280, height: 720 });
  });

  it("restarts stabilization when the renderer replaces its adapter", async () => {
    const firstAdapter = adapter();
    const replacementAdapter = adapter();
    const adapters = [firstAdapter, replacementAdapter, replacementAdapter, replacementAdapter];
    const readAdapter = vi.fn(() => adapters.shift() ?? replacementAdapter);
    let paintCount = 0;

    const acquired = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
      isActive: () => true,
      readAdapter,
      waitForPaintFrame: async () => {
        paintCount += 1;
      },
    });

    expect(acquired).toBe(replacementAdapter);
    expect(readAdapter).toHaveBeenCalledTimes(4);
    expect(paintCount).toBe(5);
  });

  it("fails closed after a bounded number of unstable framebuffer samples", async () => {
    let sizeReadCount = 0;
    const unstableAdapter = adapter(async () => validRaster(), () => {
      sizeReadCount += 1;
      return { width: sizeReadCount % 2 === 0 ? 1280 : 1279, height: 720 };
    });
    let paintCount = 0;

    const acquired = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
      isActive: () => true,
      readAdapter: () => unstableAdapter,
      waitForPaintFrame: async () => {
        paintCount += 1;
      },
    });

    expect(acquired).toBeNull();
    expect(sizeReadCount).toBe(12);
    expect(paintCount).toBe(13);
  });

  it("does not read a replacement adapter after the editor session closes", async () => {
    const readAdapter = vi.fn(() => adapter());

    await expect(
      acquireStudioBg3dCaptureAdapterAfterViewTransition({
        isActive: () => false,
        readAdapter,
        waitForPaintFrame: async () => undefined,
      })
    ).resolves.toBeNull();
    expect(readAdapter).not.toHaveBeenCalled();
  });

  it("awaits a backend and returns validated Studio-owned raster copies", async () => {
    const backendRaster = validRaster();
    const capture = vi.fn(async (request: StudioBg3dCaptureRequest) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.background)).toBe(true);
      return backendRaster;
    });
    const result = await captureStudioBg3dRaster(adapter(capture), REQUEST);

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(REQUEST);
    expect(result).toEqual(backendRaster);
    expect(result).not.toBe(backendRaster);
    expect(result.rgba).not.toBe(backendRaster.rgba);
    expect(result.depth).not.toBe(backendRaster.depth);
    expect(Object.isFrozen(result)).toBe(true);

    backendRaster.rgba[0] = 255;
    backendRaster.depth![0] = 1;
    expect(result.rgba[0]).toBe(0);
    expect(result.depth?.[0]).toBe(0);
  });

  it("validates the result against an immutable request snapshot", async () => {
    const mutableRequest: StudioBg3dCaptureRequest = {
      ...REQUEST,
      background: { ...REQUEST.background },
    };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const capture = vi.fn(async () => {
      await pending;
      return validRaster();
    });

    const resultPromise = captureStudioBg3dRaster(adapter(capture), mutableRequest);
    (mutableRequest as { width: number }).width = 1;
    (mutableRequest.background as { color: string }).color = "#ffffff";
    release();

    await expect(resultPromise).resolves.toEqual(validRaster());
    expect(capture).toHaveBeenCalledWith(REQUEST);
  });

  it("returns an immutable source-size snapshot instead of an engine-owned object", () => {
    const source = { width: 640, height: 360 };
    const captureAdapter = adapter();
    captureAdapter.getSourceSize = () => source;

    const result = getStudioBg3dCaptureSourceSize(captureAdapter);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { ...REQUEST, width: 0 },
    { ...REQUEST, height: 1.5 },
    { ...REQUEST, includeDepth: "yes" },
    { ...REQUEST, background: null },
    { ...REQUEST, background: { color: "red", alpha: 1 } },
    { ...REQUEST, background: { color: "#123abc", alpha: -0.1 } },
    {
      ...REQUEST,
      width: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1,
      height: 1,
    },
  ])("rejects an invalid request before invoking the engine: %#", async (request) => {
    const capture = vi.fn(async () => validRaster());

    await expect(
      captureStudioBg3dRaster(adapter(capture), request as StudioBg3dCaptureRequest)
    ).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    { ...validRaster(), width: 1 },
    { ...validRaster(), rgba: new Uint16Array(16) },
    { ...validRaster(), rgba: new Uint8Array(15) },
    { ...validRaster(), depth: undefined },
    { ...validRaster(), depth: new Float32Array(3) },
    { ...validRaster(), depth: Float32Array.from([0, 0.5, Number.NaN, 1]) },
    { ...validRaster(), depth: Float32Array.from([0, 0.5, 1.1, 1]) },
  ])("rejects a malformed engine result: %#", async (raster) => {
    await expect(
      captureStudioBg3dRaster(
        adapter(async () => raster as unknown as StudioBg3dCapturedRaster),
        REQUEST
      )
    ).rejects.toThrow();
  });

  it("requires the backend to omit depth when it was not requested", async () => {
    await expect(
      captureStudioBg3dRaster(adapter(), { ...REQUEST, includeDepth: false })
    ).rejects.toThrow(/unrequested depth/u);
  });

  it("forwards asynchronous backend failures without replacing their cause", async () => {
    const failure = new Error("device lost");

    await expect(
      captureStudioBg3dRaster(
        adapter(async () => {
          throw failure;
        }),
        REQUEST
      )
    ).rejects.toBe(failure);
  });

  it("releases callers on abort or timeout even when an engine phase never settles", async () => {
    const never = new Promise<StudioBg3dCapturedRaster>(() => undefined);
    const controller = new AbortController();
    const aborted = captureStudioBg3dRaster(
      adapter(() => never),
      REQUEST,
      { signal: controller.signal },
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    const preAbortedController = new AbortController();
    preAbortedController.abort();
    const capture = vi.fn(() => never);
    await expect(captureStudioBg3dRaster(
      adapter(capture),
      REQUEST,
      { signal: preAbortedController.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(capture).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const timedOut = captureStudioBg3dRaster(
        adapter(() => never),
        REQUEST,
        { timeoutMs: 250 },
      );
      const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(250);
      await timeoutExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsupported adapters and malformed source dimensions", async () => {
    const unsupported = { ...adapter(), backend: "unknown" } as unknown as StudioBg3dCaptureAdapter;
    const inconsistentIdentity = {
      ...adapter(),
      engineId: "babylon",
    } as unknown as StudioBg3dCaptureAdapter;
    const invalidSource = { ...adapter(), getSourceSize: () => ({ width: 0, height: 1 }) };

    await expect(captureStudioBg3dRaster(unsupported, REQUEST)).rejects.toThrow(/backend/u);
    await expect(captureStudioBg3dRaster(inconsistentIdentity, REQUEST)).rejects.toThrow(/identity/u);
    expect(() => getStudioBg3dCaptureSourceSize(invalidSource)).toThrow(/width/u);
  });

  it("keeps backend identity tuples immutable across untrusted callers", () => {
    const identity = getStudioBg3dCaptureBackendIdentity("three-webgl");
    expect(identity).toEqual(["three", "webgl2"]);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Reflect.set(identity as object, 0, "babylon")).toBe(false);
    expect(getStudioBg3dCaptureBackendIdentity("three-webgl")).toEqual(["three", "webgl2"]);
  });
});
