/**
 * Sole production lazy entry for Babylon Studio code.
 *
 * Callers must import this file dynamically. Babylon deep ESM imports intentionally remain in this
 * entry's static closure so the bundle boundary can prove that opening Studio does not load them.
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";

import { executeStudioBg3dBabylonCapture } from "./studio-bg3d-babylon-artifact-capture";
import {
  createStudioBg3dBabylonSpecialistRuntime,
  sanitizeStudioBg3dBabylonAdapterDiagnostic,
  STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC,
  STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL,
  type StudioBg3dBabylonEngineHandle,
  type StudioBg3dBabylonEngineInitializationControl,
  type StudioBg3dBabylonEngineSettings,
  type StudioBg3dBabylonRuntimeBindings,
  type StudioBg3dBabylonSpecialistRuntime,
  type StudioBg3dBabylonSpecialistRuntimeOptions,
} from "./studio-bg3d-babylon-specialist-runtime";

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type StudioBg3dBabylonSpecialistEntryOptions = Omit<
  StudioBg3dBabylonSpecialistRuntimeOptions,
  "loadBindings"
>;

/** ToonSpectrum owns loss recovery by disposing and recreating the whole specialist runtime. */
export const STUDIO_BG3D_BABYLON_DELEGATES_CONTEXT_LOSS_TO_RUNTIME = true;

export function attachStudioBg3dBabylonDeviceLossSignal(
  engine: StudioBg3dBabylonEngineHandle,
  deviceLost: PromiseLike<unknown>,
  adapterInfo?: unknown,
  fallbackAdapterValue?: unknown,
): StudioBg3dBabylonEngineHandle {
  if (!deviceLost || typeof deviceLost.then !== "function") {
    throw new TypeError("A valid GPUDevice.lost promise is required.");
  }
  Object.defineProperty(engine, STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL, {
    configurable: false,
    enumerable: false,
    value: deviceLost,
    writable: false,
  });
  Object.defineProperty(engine, STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC, {
    configurable: false,
    enumerable: false,
    value: sanitizeStudioBg3dBabylonAdapterDiagnostic(
      adapterInfo,
      fallbackAdapterValue,
    ),
    writable: false,
  });
  return engine;
}

function webGpuAdapterInfo(engine: WebGPUEngine): unknown {
  // Babylon keeps the complete GPUAdapterInfo snapshot internally while getInfo() aliases three
  // legacy fields. Prefer the complete snapshot, with the public projection as a safe fallback.
  const internal = engine as unknown as { readonly _adapterInfo?: unknown };
  if (internal._adapterInfo !== undefined) return internal._adapterInfo;
  try {
    return engine.getInfo();
  } catch {
    return undefined;
  }
}

function webGpuFallbackAdapter(engine: WebGPUEngine): unknown {
  // GPUAdapterInfo does not carry this bit in every Chromium generation. Babylon retains the
  // originating GPUAdapter privately, so copy only its scalar fallback receipt while the engine
  // is alive instead of retaining the native adapter in diagnostics.
  try {
    const adapter = Reflect.get(engine as unknown as object, "_adapter") as unknown;
    if ((typeof adapter !== "object" && typeof adapter !== "function") || adapter === null) {
      return undefined;
    }
    return Reflect.get(adapter, "isFallbackAdapter");
  } catch {
    return undefined;
  }
}

export async function initializeStudioBg3dBabylonWebGpuEngine(
  engine: WebGPUEngine,
  disposeEngine: () => void = () => engine.dispose(),
  signal?: AbortSignal,
): Promise<StudioBg3dBabylonEngineHandle> {
  const disposeAfterAbort = () => {
    try {
      disposeEngine();
    } catch {
      // The initialization/abort result remains authoritative over best-effort cleanup.
    }
  };
  if (signal?.aborted) {
    disposeAfterAbort();
    throw new DOMException("Babylon WebGPU initialization was aborted.", "AbortError");
  }
  signal?.addEventListener("abort", disposeAfterAbort, { once: true });
  try {
    await engine.initAsync();
    if (signal?.aborted) {
      throw new DOMException("Babylon WebGPU initialization was aborted.", "AbortError");
    }
    return attachStudioBg3dBabylonDeviceLossSignal(
      engine as StudioBg3dBabylonEngineHandle,
      engine._device.lost,
      webGpuAdapterInfo(engine),
      webGpuFallbackAdapter(engine),
    );
  } catch (error) {
    // The runtime has no engine handle until this promise resolves. Dispose here so both an
    // initAsync rejection and a post-init diagnostic-binding failure release the GPU device.
    try {
      disposeEngine();
    } catch {
      // Preserve the authoritative initialization/binding failure when a partially initialized
      // Babylon engine also rejects its best-effort cleanup.
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", disposeAfterAbort);
  }
}

/**
 * Babylon's partial WebGPUEngine.dispose() can throw before requestDevice() has populated the
 * managers/device it dereferences. Treat only a completed public dispose as terminal: if the
 * asynchronous initialization settles later, another call can release resources created after the
 * first partial attempt. An already-acquired private device is still destroyed as a fallback.
 */
export function createStudioBg3dBabylonPartialEngineDisposer(
  engine: WebGPUEngine,
): () => void {
  let fullyDisposed = false;
  return () => {
    if (fullyDisposed) return;
    try {
      engine.dispose();
      fullyDisposed = true;
      return;
    } catch {
      // A WebGPUEngine can be cancelled before all of its private managers exist.
    }
    try {
      const device = Reflect.get(engine as unknown as object, "_device") as {
        destroy?: () => void;
      } | undefined;
      device?.destroy?.();
    } catch {
      // The runtime's timeout/abort result remains authoritative over best-effort cleanup.
    }
  };
}

const BABYLON_RUNTIME_BINDINGS: StudioBg3dBabylonRuntimeBindings = Object.freeze({
  createWebGlEngine(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    settings: StudioBg3dBabylonEngineSettings,
  ) {
    return new Engine(canvas, settings.antialias, {
      adaptToDeviceRatio: settings.adaptToDeviceRatio,
      audioEngine: false,
      deterministicLockstep: settings.deterministicLockstep,
      doNotHandleContextLost: STUDIO_BG3D_BABYLON_DELEGATES_CONTEXT_LOSS_TO_RUNTIME,
      failIfMajorPerformanceCaveat: settings.failIfMajorPerformanceCaveat,
      lockstepMaxSteps: settings.lockstepMaxSteps,
      loseContextOnDispose: true,
      powerPreference: settings.powerPreference,
      premultipliedAlpha: settings.premultipliedAlpha,
      preserveDrawingBuffer: settings.preserveDrawingBuffer,
      stencil: settings.stencil,
      timeStep: settings.timeStepSeconds,
      useHighPrecisionMatrix: true,
    }) as StudioBg3dBabylonEngineHandle;
  },
  async createWebGpuEngine(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    settings: StudioBg3dBabylonEngineSettings,
    initialization: StudioBg3dBabylonEngineInitializationControl,
  ) {
    const engine = new WebGPUEngine(canvas, {
      adaptToDeviceRatio: settings.adaptToDeviceRatio,
      audioEngine: false,
      deterministicLockstep: settings.deterministicLockstep,
      doNotHandleContextLost: STUDIO_BG3D_BABYLON_DELEGATES_CONTEXT_LOSS_TO_RUNTIME,
      lockstepMaxSteps: settings.lockstepMaxSteps,
      powerPreference: settings.powerPreference,
      premultipliedAlpha: settings.premultipliedAlpha,
      stencil: settings.stencil,
      timeStep: settings.timeStepSeconds,
      useHighPrecisionMatrix: true,
    });
    const disposeEngine = createStudioBg3dBabylonPartialEngineDisposer(engine);
    initialization.registerPartialEngine(
      engine as StudioBg3dBabylonEngineHandle,
      disposeEngine,
    );
    return initializeStudioBg3dBabylonWebGpuEngine(
      engine,
      disposeEngine,
      initialization.signal,
    );
  },
  createScene(engine: StudioBg3dBabylonEngineHandle) {
    return new Scene(engine as AbstractEngine);
  },
});

/**
 * The explicit binding loader remains asynchronous even though its ESM closure is already loaded.
 * This keeps engine construction lazy and makes the runtime's initialization seam testable.
 */
export async function loadStudioBg3dBabylonRuntimeBindings():
  Promise<StudioBg3dBabylonRuntimeBindings> {
  return BABYLON_RUNTIME_BINDINGS;
}

export function createStudioBg3dBabylonSpecialist(
  options: StudioBg3dBabylonSpecialistEntryOptions,
): StudioBg3dBabylonSpecialistRuntime {
  return createStudioBg3dBabylonSpecialistRuntime({
    ...options,
    execute: options.execute ?? executeStudioBg3dBabylonCapture,
    loadBindings: loadStudioBg3dBabylonRuntimeBindings,
  });
}

export type {
  StudioBg3dBabylonAdapterDiagnostic,
  StudioBg3dBabylonAdapterReadyDiagnostic,
  StudioBg3dBabylonBackend,
  StudioBg3dBabylonDeviceLossDiagnostic,
  StudioBg3dBabylonDeviceLostDiagnostic,
  StudioBg3dBabylonDiagnostic,
  StudioBg3dBabylonDiagnosticListener,
  StudioBg3dBabylonSpecialistExecutionContext,
  StudioBg3dBabylonSpecialistExecutor,
  StudioBg3dBabylonSpecialistRuntime,
  StudioBg3dBabylonSpecialistRuntimeState,
} from "./studio-bg3d-babylon-specialist-runtime";

export {
  StudioBg3dBabylonDeviceLostError,
} from "./studio-bg3d-babylon-specialist-runtime";
