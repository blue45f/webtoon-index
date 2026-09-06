import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
} from "./studio-bg3d-artifact-capture-v2";
import {
  STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC,
  STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL,
  StudioBg3dBabylonDeviceLostError,
  StudioBg3dBabylonSpecialistError,
  createStudioBg3dBabylonSpecialistRuntime,
  sanitizeStudioBg3dBabylonAdapterDiagnostic,
  sanitizeStudioBg3dBabylonDeviceLossDiagnostic,
  sanitizeStudioBg3dBabylonSpecialistResult,
  type StudioBg3dBabylonDiagnostic,
  type StudioBg3dBabylonEngineHandle,
  type StudioBg3dBabylonEngineInitializationControl,
  type StudioBg3dBabylonEngineSettings,
  type StudioBg3dBabylonObservableLike,
  type StudioBg3dBabylonRuntimeBindings,
  type StudioBg3dBabylonSceneHandle,
} from "./studio-bg3d-babylon-specialist-runtime";
import {
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeAdapterJob,
  type StudioBg3dSpecialistRequest,
} from "./studio-bg3d-runtime-adapter";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

class FakeCanvas extends EventTarget {
  width = 64;
  height = 64;
}

class FakeObservable implements StudioBg3dBabylonObservableLike {
  readonly callbacks = new Set<() => void>();

  add(callback: () => void): unknown {
    this.callbacks.add(callback);
    return callback;
  }

  remove(observer: unknown): unknown {
    return this.callbacks.delete(observer as () => void);
  }

  emit(): void {
    for (const callback of [...this.callbacks]) callback();
  }
}

class FakeEngine implements StudioBg3dBabylonEngineHandle {
  readonly [STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC] = Object.freeze({
    architecture: "swiftshader",
    description: "Chromium test adapter",
    device: "0xffff",
    isFallbackAdapter: true,
    vendor: "Google",
  });
  readonly deviceLoss = deferred<unknown>();
  readonly [STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL] = this.deviceLoss.promise;
  readonly onContextLostObservable = new FakeObservable();
  readonly onContextRestoredObservable = new FakeObservable();
  readonly dispose = vi.fn();
}

class FakeScene implements StudioBg3dBabylonSceneHandle {
  readonly dispose = vi.fn();
}

interface BindingHarness {
  readonly bindings: StudioBg3dBabylonRuntimeBindings;
  readonly engines: FakeEngine[];
  readonly scenes: FakeScene[];
  readonly webGl: ReturnType<typeof vi.fn>;
  readonly webGpu: ReturnType<typeof vi.fn>;
}

function bindingHarness(): BindingHarness {
  const engines: FakeEngine[] = [];
  const scenes: FakeScene[] = [];
  const webGl = vi.fn(() => {
    const engine = new FakeEngine();
    engines.push(engine);
    return engine;
  });
  const webGpu = vi.fn(async (
    _canvas: HTMLCanvasElement | OffscreenCanvas,
    _settings: StudioBg3dBabylonEngineSettings,
    initialization: StudioBg3dBabylonEngineInitializationControl,
  ) => {
    const engine = new FakeEngine();
    engines.push(engine);
    let disposed = false;
    initialization.registerPartialEngine(engine, () => {
      if (disposed) return;
      disposed = true;
      engine.dispose();
    });
    return engine;
  });
  return {
    engines,
    scenes,
    webGl,
    webGpu,
    bindings: {
      createWebGlEngine: webGl,
      createWebGpuEngine: webGpu,
      createScene() {
        const scene = new FakeScene();
        scenes.push(scene);
        return scene;
      },
    },
  };
}

const snapshot = createStudioBg3dRuntimeSnapshot(
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  new Map(),
);

function job(
  id: string,
  request: StudioBg3dSpecialistRequest = { kind: "runtime-metrics" },
  signal: AbortSignal = new AbortController().signal,
): StudioBg3dRuntimeAdapterJob {
  return { id, request, signal, snapshot };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("Studio Babylon isolated specialist runtime", () => {
  it("loads bindings and creates its WebGL engine only on the first serialized job", async () => {
    const harness = bindingHarness();
    const loadBindings = vi.fn(async () => harness.bindings);
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings,
    });

    expect(runtime.runtimeId).toBe("babylon-webgl-lab");
    expect(loadBindings).not.toHaveBeenCalled();
    expect(runtime.getState()).toMatchObject({
      engineInitialized: false,
      epoch: 0,
      status: "idle",
    });

    await expect(runtime.runIsolated(job("first"))).resolves.toEqual({
      kind: "metrics",
      values: {
        backend: "webgl2",
        engine: "babylon",
        epoch: 1,
        initialized: true,
      },
    });
    await expect(runtime.runIsolated(job("second"))).resolves.toMatchObject({
      kind: "metrics",
      values: { epoch: 2 },
    });

    expect(loadBindings).toHaveBeenCalledOnce();
    expect(harness.webGl).toHaveBeenCalledOnce();
    expect(harness.webGl).toHaveBeenCalledWith(
      expect.any(FakeCanvas),
      expect.objectContaining({ failIfMajorPerformanceCaveat: true }),
    );
    expect(harness.webGpu).not.toHaveBeenCalled();
    expect(harness.scenes).toHaveLength(2);
    expect(harness.scenes.every((scene) => scene.dispose.mock.calls.length === 1)).toBe(true);

    await runtime.dispose();
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("allows only an explicit caller to relax the major-performance-caveat diagnostic gate", async () => {
    const harness = bindingHarness();
    const canvas = new FakeCanvas() as unknown as HTMLCanvasElement;
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas,
      loadBindings: async () => harness.bindings,
      settings: { failIfMajorPerformanceCaveat: false },
    });

    await runtime.runIsolated(job("software-diagnostic"));

    expect(harness.webGl).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({ failIfMajorPerformanceCaveat: false }),
    );
    await runtime.dispose();
  });

  it("uses the separately identified WebGPU initialization path only when explicitly requested", async () => {
    const harness = bindingHarness();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
    });

    expect(runtime.runtimeId).toBe("babylon-webgpu-lab");
    await expect(runtime.runIsolated(job("webgpu"))).resolves.toMatchObject({
      kind: "metrics",
      values: { backend: "webgpu" },
    });
    expect(harness.webGpu).toHaveBeenCalledOnce();
    expect(harness.webGl).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("fails closed when a WebGPU binding omits the direct GPUDevice.lost signal", async () => {
    const harness = bindingHarness();
    const engine: StudioBg3dBabylonEngineHandle = {
      onContextLostObservable: new FakeObservable(),
      onContextRestoredObservable: new FakeObservable(),
      dispose: vi.fn(),
    };
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => ({
        ...harness.bindings,
        createWebGpuEngine: async () => engine,
      }),
    });

    await expect(runtime.runIsolated(job("missing-device-loss-signal"))).rejects.toMatchObject({
      cause: { message: "Babylon WebGPU binding did not expose GPUDevice.lost." },
      code: "engine-init-failed",
    });
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(runtime.getState()).toMatchObject({ engineInitialized: false, status: "idle" });
    await runtime.dispose();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it("aborts a pending WebGPU initialization and disposes a late engine result", async () => {
    const harness = bindingHarness();
    const initialization = deferred<StudioBg3dBabylonEngineHandle>();
    const partialEngine = new FakeEngine();
    harness.webGpu.mockImplementationOnce((
      _canvas: HTMLCanvasElement | OffscreenCanvas,
      _settings: StudioBg3dBabylonEngineSettings,
      control: StudioBg3dBabylonEngineInitializationControl,
    ) => {
      let disposed = false;
      control.registerPartialEngine(partialEngine, () => {
        if (disposed) return;
        disposed = true;
        partialEngine.dispose();
      });
      return initialization.promise;
    });
    const controller = new AbortController();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
    });

    const pending = runtime.runIsolated(job(
      "webgpu-abort",
      { kind: "runtime-metrics" },
      controller.signal,
    ));
    await vi.waitFor(() => expect(harness.webGpu).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(partialEngine.dispose).toHaveBeenCalledOnce();

    initialization.resolve(partialEngine);
    await Promise.resolve();
    expect(partialEngine.dispose).toHaveBeenCalledOnce();
    expect(runtime.getState().engineInitialized).toBe(false);
    await runtime.dispose();
  });

  it("bounds an explicit engine initialization budget and disposes a result that arrives late", async () => {
    const harness = bindingHarness();
    const initialization = deferred<StudioBg3dBabylonEngineHandle>();
    const partialEngine = new FakeEngine();
    harness.webGpu.mockImplementationOnce((
      _canvas: HTMLCanvasElement | OffscreenCanvas,
      _settings: StudioBg3dBabylonEngineSettings,
      control: StudioBg3dBabylonEngineInitializationControl,
    ) => {
      let disposed = false;
      control.registerPartialEngine(partialEngine, () => {
        if (disposed) return;
        disposed = true;
        partialEngine.dispose();
      });
      return initialization.promise;
    });

    expect(() => createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      engineInitializationTimeoutMs: 999,
      loadBindings: async () => harness.bindings,
    })).toThrow(RangeError);
    expect(() => createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      engineInitializationTimeoutMs: 60_001,
      loadBindings: async () => harness.bindings,
    })).toThrow(RangeError);

    vi.useFakeTimers();
    try {
      const runtime = createStudioBg3dBabylonSpecialistRuntime({
        backend: "webgpu",
        canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
        engineInitializationTimeoutMs: 1_000,
        loadBindings: async () => harness.bindings,
      });
      const pending = runtime.runIsolated(job("bounded-webgpu-initialization"));
      await vi.advanceTimersByTimeAsync(999);
      expect(harness.webGpu).toHaveBeenCalledOnce();

      const rejection = expect(pending).rejects.toMatchObject({
        code: "engine-init-failed",
        cause: {
          message: "Babylon engine initialization exceeded 1000 milliseconds.",
          name: "TimeoutError",
        },
      });
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(runtime.getState()).toMatchObject({
        engineInitialized: false,
        status: "idle",
      });
      expect(partialEngine.dispose).toHaveBeenCalledOnce();

      initialization.resolve(partialEngine);
      await vi.advanceTimersByTimeAsync(0);
      expect(partialEngine.dispose).toHaveBeenCalledOnce();
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the timeout authoritative when a partial-engine disposer throws", async () => {
    const harness = bindingHarness();
    const initialization = deferred<StudioBg3dBabylonEngineHandle>();
    const partialEngine = new FakeEngine();
    const cleanupFailure = new Error("partial Babylon cleanup failed");
    harness.webGpu.mockImplementationOnce((
      _canvas: HTMLCanvasElement | OffscreenCanvas,
      _settings: StudioBg3dBabylonEngineSettings,
      control: StudioBg3dBabylonEngineInitializationControl,
    ) => {
      control.registerPartialEngine(partialEngine, () => {
        partialEngine.dispose();
        throw cleanupFailure;
      });
      return initialization.promise;
    });

    vi.useFakeTimers();
    try {
      const runtime = createStudioBg3dBabylonSpecialistRuntime({
        backend: "webgpu",
        canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
        engineInitializationTimeoutMs: 1_000,
        loadBindings: async () => harness.bindings,
      });
      const pending = runtime.runIsolated(job("throwing-partial-cleanup"));
      const rejection = expect(pending).rejects.toMatchObject({
        code: "engine-init-failed",
        cause: {
          message: "Babylon engine initialization exceeded 1000 milliseconds.",
          name: "TimeoutError",
        },
      });
      await vi.advanceTimersByTimeAsync(1_000);

      await rejection;
      expect(partialEngine.dispose).toHaveBeenCalledOnce();
      await runtime.dispose();
    } finally {
      initialization.reject(cleanupFailure);
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it("disposes a partial WebGPU engine when runtime disposal races initialization", async () => {
    const harness = bindingHarness();
    const initialization = deferred<StudioBg3dBabylonEngineHandle>();
    const partialEngine = new FakeEngine();
    harness.webGpu.mockImplementationOnce((
      _canvas: HTMLCanvasElement | OffscreenCanvas,
      _settings: StudioBg3dBabylonEngineSettings,
      control: StudioBg3dBabylonEngineInitializationControl,
    ) => {
      let disposed = false;
      control.registerPartialEngine(partialEngine, () => {
        if (disposed) return;
        disposed = true;
        partialEngine.dispose();
      });
      return initialization.promise;
    });
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
    });

    const pending = runtime.runIsolated(job("dispose-during-webgpu-initialization"));
    await vi.waitFor(() => expect(harness.webGpu).toHaveBeenCalledOnce());
    const disposal = runtime.dispose();

    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await disposal;
    expect(partialEngine.dispose).toHaveBeenCalledOnce();
    initialization.resolve(partialEngine);
    await Promise.resolve();
    expect(partialEngine.dispose).toHaveBeenCalledOnce();
  });

  it("serializes direct adapter calls and gives each fresh scene a monotonic epoch", async () => {
    const harness = bindingHarness();
    const firstRelease = deferred<void>();
    const epochs: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      async execute(context) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        epochs.push(context.epoch);
        if (context.job.id === "first") await firstRelease.promise;
        active -= 1;
        return { kind: "metrics", values: { id: context.job.id } };
      },
    });

    const first = runtime.runIsolated(job("first"));
    const second = runtime.runIsolated(job("second"));
    await vi.waitFor(() => expect(runtime.getState().activeJobId).toBe("first"));
    expect(runtime.getState().queuedJobs).toBe(2);
    expect(harness.scenes).toHaveLength(1);

    firstRelease.resolve();
    await expect(first).resolves.toMatchObject({ values: { id: "first" } });
    await expect(second).resolves.toMatchObject({ values: { id: "second" } });
    expect(maximumActive).toBe(1);
    expect(epochs).toEqual([1, 2]);
    expect(harness.scenes).toHaveLength(2);
    await runtime.dispose();
  });

  it("does not initialize for pre-aborted work and aborts an active scene without leaking it", async () => {
    const harness = bindingHarness();
    const loadBindings = vi.fn(async () => harness.bindings);
    const started = deferred<void>();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings,
      execute(context) {
        started.resolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(runtime.runIsolated(job(
      "pre-aborted",
      { kind: "runtime-metrics" },
      preAborted.signal,
    ))).rejects.toMatchObject({ code: "aborted" });
    expect(loadBindings).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pending = runtime.runIsolated(job(
      "active",
      { kind: "runtime-metrics" },
      controller.signal,
    ));
    await started.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(harness.scenes[0]?.dispose).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("blocks WebGL work after canvas loss, disposes the invalid engine, and recreates after restore", async () => {
    const canvas = new FakeCanvas();
    const harness = bindingHarness();
    const diagnostics: StudioBg3dBabylonDiagnostic[] = [];
    const started = deferred<void>();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas: canvas as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      execute(context) {
        if (context.job.id === "after-restore") {
          return { kind: "metrics", values: { restored: true } };
        }
        started.resolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("context lost", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pending = runtime.runIsolated(job("during-loss"));
    await started.promise;
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "context-lost" });
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
    expect(runtime.getState()).toMatchObject({
      contextLost: true,
      engineInitialized: false,
      status: "context-lost",
    });
    await expect(runtime.runIsolated(job("blocked"))).rejects.toMatchObject({
      code: "context-lost",
    });

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await expect(runtime.runIsolated(job("after-restore"))).resolves.toMatchObject({
      values: { restored: true },
    });
    expect(harness.webGl).toHaveBeenCalledTimes(2);
    expect(diagnostics).toEqual([]);
    await runtime.dispose();
  });

  it("uses direct WebGPU loss exactly once and preserves its payload across observable races", async () => {
    const harness = bindingHarness();
    const diagnostics: StudioBg3dBabylonDiagnostic[] = [];
    const events: string[] = [];
    const started = deferred<void>();
    const observedAbort = deferred<void>();
    const releaseAfterLoss = deferred<void>();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
        events.push(`diagnostic:${diagnostic.kind}`);
      },
      async execute(context) {
        if (context.job.id === "retry") {
          return { kind: "metrics", values: { retried: true } };
        }
        started.resolve();
        context.signal.addEventListener("abort", () => {
          events.push("signal:abort");
          observedAbort.resolve();
        }, { once: true });
        await releaseAfterLoss.promise;
        throw new DOMException("device lost", "AbortError");
      },
    });

    const first = runtime.runIsolated(job("device-loss"));
    await started.promise;
    expect(diagnostics.map(({ kind }) => kind)).toEqual(["adapter-ready"]);
    harness.engines[0]?.onContextLostObservable.emit();
    expect(runtime.getState()).toMatchObject({
      activeJobId: "device-loss",
      contextLost: false,
      engineInitialized: true,
      status: "running",
    });
    expect(diagnostics.map(({ kind }) => kind)).toEqual(["adapter-ready"]);

    harness.engines[0]?.deviceLoss.resolve({
      message: "GPU process reset at command buffer 7",
      reason: "unknown",
    });
    await observedAbort.promise;
    expect(events).toEqual([
      "diagnostic:adapter-ready",
      "diagnostic:device-lost",
      "signal:abort",
    ]);
    const stateAtLoss = runtime.getState();
    expect(stateAtLoss).toMatchObject({
      activeJobId: "device-loss",
      contextLost: true,
      engineInitialized: false,
      status: "context-lost",
    });
    expect(harness.engines[0]?.dispose).not.toHaveBeenCalled();
    harness.engines[0]?.onContextLostObservable.emit();
    expect(runtime.getState().epoch).toBe(stateAtLoss.epoch);
    expect(diagnostics.map(({ kind }) => kind)).toEqual([
      "adapter-ready",
      "device-lost",
    ]);

    const adapterDiagnostic = diagnostics[0];
    const lossDiagnostic = diagnostics[1];
    expect(adapterDiagnostic).toMatchObject({
      adapter: {
        architecture: "swiftshader",
        description: "Chromium test adapter",
        device: "0xffff",
        isFallbackAdapter: true,
        vendor: "Google",
      },
      backend: "webgpu",
      epoch: 1,
      kind: "adapter-ready",
      runtimeId: "babylon-webgpu-lab",
      version: 1,
    });
    expect(lossDiagnostic).toMatchObject({
      activeJobId: "device-loss",
      adapter: adapterDiagnostic?.adapter,
      backend: "webgpu",
      kind: "device-lost",
      loss: {
        message: "GPU process reset at command buffer 7",
        reason: "unknown",
      },
      runtimeId: "babylon-webgpu-lab",
      version: 1,
    });
    expect(Object.isFrozen(adapterDiagnostic)).toBe(true);
    expect(Object.isFrozen(adapterDiagnostic?.adapter)).toBe(true);
    expect(Object.isFrozen(lossDiagnostic)).toBe(true);
    expect(Object.isFrozen(lossDiagnostic?.adapter)).toBe(true);
    expect(lossDiagnostic?.kind === "device-lost" && Object.isFrozen(lossDiagnostic.loss))
      .toBe(true);
    expect(structuredClone(adapterDiagnostic)).toEqual(adapterDiagnostic);
    expect(structuredClone(lossDiagnostic)).toEqual(lossDiagnostic);

    releaseAfterLoss.resolve();
    const failure = await first.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StudioBg3dBabylonSpecialistError);
    expect(failure).toMatchObject({
      cause: {
        code: "device-lost",
        diagnostic: lossDiagnostic,
        message:
          "Babylon WebGPU device lost (reason: unknown): " +
          "GPU process reset at command buffer 7",
      },
      code: "device-lost",
    });
    expect((failure as { readonly cause?: unknown }).cause)
      .toBeInstanceOf(StudioBg3dBabylonDeviceLostError);
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
    expect(runtime.getState()).toMatchObject({
      contextLost: false,
      engineInitialized: false,
      status: "idle",
    });

    await expect(runtime.runIsolated(job("retry"))).resolves.toMatchObject({
      values: { retried: true },
    });
    expect(harness.webGpu).toHaveBeenCalledTimes(2);
    expect(diagnostics.map(({ kind }) => kind)).toEqual([
      "adapter-ready",
      "device-lost",
      "adapter-ready",
    ]);
    await runtime.dispose();
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
    expect(harness.engines[1]?.dispose).toHaveBeenCalledOnce();

    const epochAfterDispose = runtime.getState().epoch;
    harness.engines[1]?.deviceLoss.resolve({
      message: "destroyed by expected runtime disposal",
      reason: "destroyed",
    });
    await Promise.resolve();
    expect(runtime.getState()).toMatchObject({
      disposed: true,
      epoch: epochAfterDispose,
      status: "disposed",
    });
    expect(harness.engines[1]?.dispose).toHaveBeenCalledOnce();
    expect(diagnostics.map(({ kind }) => kind)).toEqual([
      "adapter-ready",
      "device-lost",
      "adapter-ready",
    ]);
  });

  it("keeps diagnostic listener failures non-authoritative during adapter and loss events", async () => {
    const harness = bindingHarness();
    const started = deferred<void>();
    const listener = vi.fn(() => {
      throw new Error("diagnostic sink unavailable");
    });
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      onDiagnostic: listener,
      execute(context) {
        started.resolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("device lost", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pending = runtime.runIsolated(job("throw-safe-diagnostic"));
    await started.promise;
    expect(listener).toHaveBeenCalledOnce();
    harness.engines[0]?.deviceLoss.resolve({
      message: "device removed",
      reason: "unknown",
    });

    await expect(pending).rejects.toMatchObject({
      cause: { message: "Babylon WebGPU device lost (reason: unknown): device removed" },
      code: "device-lost",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("keeps the authoritative device-loss cause when a diagnostic listener re-enters disposal", async () => {
    const harness = bindingHarness();
    const started = deferred<void>();
    const diagnostics: StudioBg3dBabylonDiagnostic[] = [];
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        if (diagnostic.kind === "device-lost") void runtime.dispose();
      },
      execute(context) {
        started.resolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("device lost", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pending = runtime.runIsolated(job("reentrant-device-loss"));
    await started.promise;
    harness.engines[0]?.deviceLoss.resolve({
      message: "Dawn reset during readback",
      reason: "unknown",
    });

    await expect(pending).rejects.toMatchObject({
      cause: {
        code: "device-lost",
        message:
          "Babylon WebGPU device lost (reason: unknown): Dawn reset during readback",
      },
      code: "device-lost",
    });
    await runtime.dispose();
    expect(diagnostics.map(({ kind }) => kind)).toEqual([
      "adapter-ready",
      "device-lost",
    ]);
    expect(runtime.getState()).toMatchObject({ disposed: true, status: "disposed" });
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("ignores a late direct-loss signal from a retired WebGPU engine", async () => {
    const canvas = new FakeCanvas();
    const harness = bindingHarness();
    const diagnostics: StudioBg3dBabylonDiagnostic[] = [];
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      backend: "webgpu",
      canvas: canvas as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await runtime.runIsolated(job("first-engine"));
    const firstEngine = harness.engines[0];
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await runtime.runIsolated(job("replacement-engine"));
    expect(harness.webGpu).toHaveBeenCalledTimes(2);

    firstEngine?.deviceLoss.resolve({
      message: "stale engine loss",
      reason: "unknown",
    });
    await Promise.resolve();
    expect(runtime.getState()).toMatchObject({
      contextLost: false,
      engineInitialized: true,
      status: "idle",
    });
    expect(diagnostics.map(({ kind }) => kind)).toEqual([
      "adapter-ready",
      "adapter-ready",
    ]);
    await runtime.dispose();
  });

  it("aborts active work on idempotent disposal and rejects every later job", async () => {
    const harness = bindingHarness();
    const started = deferred<void>();
    const runtime = createStudioBg3dBabylonSpecialistRuntime({
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      loadBindings: async () => harness.bindings,
      execute(context) {
        started.resolve();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("disposed", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const pending = runtime.runIsolated(job("active"));
    await started.promise;
    const firstDispose = runtime.dispose();
    const secondDispose = runtime.dispose();
    expect(secondDispose).toBe(firstDispose);
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await firstDispose;
    expect(runtime.getState()).toMatchObject({ disposed: true, status: "disposed" });
    expect(harness.scenes[0]?.dispose).toHaveBeenCalledOnce();
    expect(harness.engines[0]?.dispose).toHaveBeenCalledOnce();
    await expect(runtime.runIsolated(job("late"))).rejects.toMatchObject({ code: "disposed" });
  });
});

describe("Studio Babylon WebGPU diagnostics sanitizer", () => {
  it("copies, bounds, freezes, and makes adapter/loss values structured-clone safe", () => {
    const adapterSource = {
      architecture: `swift\n${"a".repeat(300)}`,
      description: "software adapter",
      device: "0xffff",
      isFallbackAdapter: true,
      vendor: "Google",
    };
    const lossSource = {
      message: `fatal\r${"m".repeat(3_000)}`,
      reason: "future-reason",
    };
    const adapter = sanitizeStudioBg3dBabylonAdapterDiagnostic(adapterSource);
    const loss = sanitizeStudioBg3dBabylonDeviceLossDiagnostic(lossSource);
    adapterSource.vendor = "mutated";
    lossSource.message = "mutated";

    expect(adapter).toMatchObject({
      description: "software adapter",
      device: "0xffff",
      isFallbackAdapter: true,
      vendor: "Google",
    });
    expect(adapter.architecture).not.toContain("\n");
    expect(adapter.architecture).toHaveLength(256);
    expect(loss.message).not.toContain("\r");
    expect(loss.message).toHaveLength(512);
    expect(loss.reason).toBe("unknown");
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(loss)).toBe(true);
    expect(structuredClone(adapter)).toEqual(adapter);
    expect(structuredClone(loss)).toEqual(loss);
  });

  it("preserves only the WebGPU device-loss reason enum and explicit fallback receipt", () => {
    expect(sanitizeStudioBg3dBabylonDeviceLossDiagnostic({ reason: "destroyed" })).toEqual({
      message: "",
      reason: "destroyed",
    });
    expect(sanitizeStudioBg3dBabylonDeviceLossDiagnostic({ reason: "vendor-extension" })).toEqual({
      message: "",
      reason: "unknown",
    });
    expect(sanitizeStudioBg3dBabylonAdapterDiagnostic(
      { isFallbackAdapter: false },
      true,
    ).isFallbackAdapter).toBe(true);
  });

  it("contains hostile accessors and returns portable fallback fields", () => {
    const hostile = Object.defineProperties({}, {
      architecture: { get: () => { throw new Error("blocked"); } },
      message: { get: () => { throw new Error("blocked"); } },
      reason: { get: () => { throw new Error("blocked"); } },
      vendor: { get: () => { throw new Error("blocked"); } },
    });

    expect(sanitizeStudioBg3dBabylonAdapterDiagnostic(hostile)).toEqual({
      architecture: "unknown",
      description: "unknown",
      device: "unknown",
      isFallbackAdapter: null,
      vendor: "unknown",
    });
    expect(sanitizeStudioBg3dBabylonDeviceLossDiagnostic(hostile)).toEqual({
      message: "",
      reason: "unknown",
    });
  });
});

describe("Studio Babylon portable result sanitizer", () => {
  it("admits only the exact requested v2 artifact set and returns defensive owned buffers", () => {
    const source = Uint8Array.from([1, 2, 3, 4]);
    const request = {
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 1,
      height: 1,
      artifacts: [{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }],
    } as const;
    const value = {
      kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
      width: 1,
      height: 1,
      artifacts: [{
        kind: "beauty",
        profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
        width: 1,
        height: 1,
        data: source,
      }],
    } as const;
    const result = sanitizeStudioBg3dBabylonSpecialistResult(value, request);
    source[0] = 255;

    expect(result).toMatchObject({
      kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
      width: 1,
      height: 1,
      artifacts: [{ kind: "beauty", data: Uint8Array.from([1, 2, 3, 4]) }],
    });
    expect(() => sanitizeStudioBg3dBabylonSpecialistResult(
      value,
      {
        ...request,
        artifacts: [{ kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE }],
      },
    )).toThrow(StudioBg3dBabylonSpecialistError);
    expect(() => sanitizeStudioBg3dBabylonSpecialistResult(
      { ...value, width: 2 },
      request,
    )).toThrow(StudioBg3dBabylonSpecialistError);
  });

  it("copies capture buffers, validates depth, and normalizes transform quaternions", () => {
    const rgba = Uint8Array.from([1, 2, 3, 4]);
    const depth = Float32Array.from([0.25]);
    const capture = sanitizeStudioBg3dBabylonSpecialistResult(
      { kind: "capture", width: 1, height: 1, rgba, depthFloat32: depth },
      { kind: "capture", width: 1, height: 1 },
    );
    rgba[0] = 255;
    depth[0] = 1;

    expect(capture).toEqual({
      kind: "capture",
      width: 1,
      height: 1,
      rgba: Uint8Array.from([1, 2, 3, 4]),
      depthFloat32: Float32Array.from([0.25]),
    });
    expect(sanitizeStudioBg3dBabylonSpecialistResult(
      {
        kind: "transforms",
        samples: [{ nodeId: "prop", position: [1, 2, 3], rotation: [0, 0, 0, 2] }],
      },
      {
        kind: "physics-preview",
        durationSeconds: 1,
        stepSeconds: 1 / 60,
        gravity: [0, -9.8, 0],
      },
    )).toEqual({
      kind: "transforms",
      samples: [{ nodeId: "prop", position: [1, 2, 3], rotation: [0, 0, 0, 1] }],
    });
  });

  it("rejects aliased, mismatched, non-finite, accessor-backed, and unknown results", () => {
    const request = { kind: "capture", width: 1, height: 1 } as const;
    const mismatched = () => sanitizeStudioBg3dBabylonSpecialistResult(
      { kind: "capture", width: 2, height: 1, rgba: new Uint8Array(8) },
      request,
    );
    const badDepth = () => sanitizeStudioBg3dBabylonSpecialistResult(
      {
        kind: "capture",
        width: 1,
        height: 1,
        rgba: new Uint8Array(4),
        depthFloat32: Float32Array.from([Number.NaN]),
      },
      request,
    );
    const accessor = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        return "metrics";
      },
    });

    expect(mismatched).toThrow(StudioBg3dBabylonSpecialistError);
    expect(badDepth).toThrow(StudioBg3dBabylonSpecialistError);
    expect(() => sanitizeStudioBg3dBabylonSpecialistResult(accessor, request))
      .toThrow(StudioBg3dBabylonSpecialistError);
    expect(() => sanitizeStudioBg3dBabylonSpecialistResult({ kind: "other" }, request))
      .toThrow(StudioBg3dBabylonSpecialistError);
  });
});
