import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioBg3dThreeWebGpuRenderer,
  StudioBg3dWebGpuRendererError,
} from "./studio-bg3d-three-webgpu-renderer";

const rendererMock = vi.hoisted(() => ({
  backendIsWebGpu: true,
  initError: null as Error | null,
  initPromise: null as Promise<void> | null,
  dispose: vi.fn(),
  backendDispose: vi.fn(),
  fallbackAtInit: undefined as unknown,
  rendererParameters: null as Record<string, unknown> | null,
  deviceLost: undefined as PromiseLike<unknown> | undefined,
  omitFallbackHook: false,
}));

vi.mock("three/webgpu", () => ({
  WebGPURenderer: class WebGPURendererMock {
    _getFallback: null | (() => void) | undefined = rendererMock.omitFallbackHook
      ? undefined
      : vi.fn();

    readonly backend = {
      ...(rendererMock.backendIsWebGpu ? { isWebGPUBackend: true } : {}),
      dispose: rendererMock.backendDispose,
      device: { lost: rendererMock.deviceLost },
    };

    constructor(parameters: Record<string, unknown>) {
      rendererMock.rendererParameters = parameters;
    }

    async init() {
      rendererMock.fallbackAtInit = this._getFallback;
      if (rendererMock.initError) throw rendererMock.initError;
      if (rendererMock.initPromise) await rendererMock.initPromise;
    }

    dispose() {
      rendererMock.dispose();
    }
  },
}));

class CanvasMock {}

function stubCanvas(): HTMLCanvasElement {
  vi.stubGlobal("HTMLCanvasElement", CanvasMock);
  return new CanvasMock() as HTMLCanvasElement;
}

describe("Studio BG3D Three WebGPU renderer", () => {
  afterEach(() => {
    rendererMock.backendIsWebGpu = true;
    rendererMock.initError = null;
    rendererMock.initPromise = null;
    rendererMock.dispose.mockReset();
    rendererMock.backendDispose.mockReset();
    rendererMock.fallbackAtInit = undefined;
    rendererMock.rendererParameters = null;
    rendererMock.deviceLost = undefined;
    rendererMock.omitFallbackHook = false;
    vi.unstubAllGlobals();
  });

  it("refuses a target that is not a canvas before importing the WebGPU graph", async () => {
    vi.stubGlobal("HTMLCanvasElement", CanvasMock);
    await expect(createStudioBg3dThreeWebGpuRenderer({} as HTMLCanvasElement))
      .rejects.toMatchObject({ code: "invalid-canvas" });
    expect(rendererMock.rendererParameters).toBeNull();
  });

  it("removes Three's silent WebGL fallback and requests the editor's minimum limits", async () => {
    const canvas = stubCanvas();
    const runtime = await createStudioBg3dThreeWebGpuRenderer(canvas);

    expect(rendererMock.fallbackAtInit).toBeNull();
    expect(rendererMock.rendererParameters).toMatchObject({
      powerPreference: "high-performance",
      requiredLimits: {
        maxBufferSize: 128 * 1024 * 1024,
        maxStorageBufferBindingSize: 32 * 1024 * 1024,
      },
    });

    await runtime.dispose();
    await runtime.dispose();
    expect(rendererMock.dispose).toHaveBeenCalledOnce();
    expect(rendererMock.backendDispose).not.toHaveBeenCalled();
  });

  it("refuses a Three version that no longer exposes the fallback contract", async () => {
    rendererMock.omitFallbackHook = true;
    const canvas = stubCanvas();
    await expect(createStudioBg3dThreeWebGpuRenderer(canvas))
      .rejects.toMatchObject({ code: "version-contract-unsupported" });
    expect(rendererMock.backendDispose).toHaveBeenCalledOnce();
  });

  it("admits only a real WebGPU backend", async () => {
    rendererMock.backendIsWebGpu = false;
    const canvas = stubCanvas();

    await expect(createStudioBg3dThreeWebGpuRenderer(canvas))
      .rejects.toMatchObject({ code: "backend-unavailable" });
    expect(rendererMock.dispose).toHaveBeenCalledOnce();
    expect(rendererMock.backendDispose).not.toHaveBeenCalled();
  });

  it("disposes a partially initialized renderer and keeps the initialization cause", async () => {
    const cause = new Error("device-lost-during-init");
    rendererMock.initError = cause;
    const canvas = stubCanvas();

    const rejection = await createStudioBg3dThreeWebGpuRenderer(canvas).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(StudioBg3dWebGpuRendererError);
    expect(rejection).toMatchObject({ code: "initialization-failed", cause });
    expect(rendererMock.dispose).not.toHaveBeenCalled();
    expect(rendererMock.backendDispose).toHaveBeenCalledOnce();
  });

  it("bounds a WebGPU initialization that never settles", async () => {
    vi.useFakeTimers();
    try {
      rendererMock.initPromise = new Promise<void>(() => undefined);
      const canvas = stubCanvas();
      const pending = createStudioBg3dThreeWebGpuRenderer(canvas, {
        initializationTimeoutMs: 25,
      });
      const rejection = expect(pending).rejects.toMatchObject({
        code: "initialization-failed",
      });

      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(rendererMock.backendDispose).toHaveBeenCalledOnce();
      expect(rendererMock.dispose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a device loss once and stays silent after the editor disposes the renderer", async () => {
    let resolveLost: (value: { reason?: string; message?: string }) => void = () => undefined;
    rendererMock.deviceLost = new Promise<{ reason?: string; message?: string }>((resolve) => {
      resolveLost = resolve;
    });
    const canvas = stubCanvas();
    const onDeviceLost = vi.fn();
    const runtime = await createStudioBg3dThreeWebGpuRenderer(canvas, { onDeviceLost });

    resolveLost({ reason: "destroyed", message: "adapter reset" });
    await Promise.resolve();
    await Promise.resolve();
    expect(onDeviceLost).toHaveBeenCalledWith({ reason: "destroyed", message: "adapter reset" });

    await runtime.dispose();
    expect(onDeviceLost).toHaveBeenCalledOnce();
  });

  it("does not report a device loss that only settles after disposal", async () => {
    let resolveLost: (value: { reason?: string }) => void = () => undefined;
    rendererMock.deviceLost = new Promise<{ reason?: string }>((resolve) => {
      resolveLost = resolve;
    });
    const canvas = stubCanvas();
    const onDeviceLost = vi.fn();
    const runtime = await createStudioBg3dThreeWebGpuRenderer(canvas, { onDeviceLost });

    await runtime.dispose();
    resolveLost({ reason: "destroyed" });
    await Promise.resolve();
    await Promise.resolve();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("treats disposal by the host renderer as teardown, not as a device loss", async () => {
    let resolveLost: (value: { reason?: string }) => void = () => undefined;
    rendererMock.deviceLost = new Promise<{ reason?: string }>((resolve) => {
      resolveLost = resolve;
    });
    const canvas = stubCanvas();
    const onDeviceLost = vi.fn();
    const runtime = await createStudioBg3dThreeWebGpuRenderer(canvas, { onDeviceLost });

    // React Three Fiber disposes the renderer directly on unmount, not through our runtime handle.
    (runtime.renderer as unknown as { dispose: () => unknown }).dispose();
    resolveLost({ reason: "destroyed" });
    await Promise.resolve();
    await Promise.resolve();

    expect(onDeviceLost).not.toHaveBeenCalled();
    expect(rendererMock.dispose).toHaveBeenCalledOnce();
    // The runtime handle stays idempotent after a host disposal.
    await runtime.dispose();
    expect(rendererMock.dispose).toHaveBeenCalledOnce();
  });
});
