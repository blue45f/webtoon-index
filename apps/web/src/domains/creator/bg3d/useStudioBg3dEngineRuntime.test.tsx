// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_DEVICE_LOSS_NOTICE_MS,
  useStudioBg3dEngineRuntime,
} from "./useStudioBg3dEngineRuntime";

import type { StudioBg3dEnginePreference } from "./studio-bg3d-engine-selection";
import type { StudioBg3dWebGpuProbeResult } from "./studio-bg3d-webgpu-capability";
import type { UseStudioBg3dEngineRuntimeOptions } from "./useStudioBg3dEngineRuntime";

const SUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: true,
  reason: "available",
  computeSupported: true,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});
const UNSUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: false,
  reason: "adapter-unavailable",
  computeSupported: false,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/133 Safari/537.36";
const defaultProbe = async () => SUPPORTED_PROBE;
const defaultLoadPreference = async (): Promise<StudioBg3dEnginePreference> => "webgpu";
const defaultSavePreference = async () => undefined;

function options(
  overrides: Partial<UseStudioBg3dEngineRuntimeOptions> = {},
): UseStudioBg3dEngineRuntimeOptions {
  return {
    enabled: true,
    deviceProfile: "desktop",
    antialias: true,
    probe: defaultProbe,
    loadPreference: defaultLoadPreference,
    savePreference: defaultSavePreference,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { userAgent: DESKTOP_USER_AGENT, hardwareConcurrency: 8 });
  window.isSecureContext = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useStudioBg3dEngineRuntime", () => {
  it("starts without a renderer and admits the explicit WebGPU selection after probing", async () => {
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options()));

    expect(result.current.phase).toBe("probing");
    expect(result.current.plan).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
    });
    expect(result.current.glFactory).toBeNull();

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.plan).toMatchObject({
      backend: "webgpu",
      status: "available",
      reason: "user-webgpu-override",
    });
    expect(result.current.glFactory).toBeTypeOf("function");
  });

  it("normalizes a legacy persisted auto preference to explicit WebGPU", async () => {
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      loadPreference: async () => "auto" as StudioBg3dEnginePreference,
    })));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.preference).toBe("webgpu");
    expect(result.current.plan.backend).toBe("webgpu");
  });

  it("never probes or exposes a renderer while the editor is closed", async () => {
    const probe = vi.fn(async () => SUPPORTED_PROBE);
    const { result } = renderHook(() =>
      useStudioBg3dEngineRuntime(options({ enabled: false, probe })));

    await Promise.resolve();
    expect(probe).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("probing");
    expect(result.current.glFactory).toBeNull();
  });

  it("restores and persists an independent explicit WebGL2 choice", async () => {
    const savePreference = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      loadPreference: async () => "webgl2",
      savePreference,
    })));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.plan).toMatchObject({ backend: "webgl2", status: "available" });
    expect(result.current.glFactory).toBeNull();

    act(() => result.current.setPreference("webgpu"));
    await waitFor(() => expect(result.current.plan.backend).toBe("webgpu"));
    expect(savePreference).toHaveBeenCalledWith("webgpu");
  });

  it("does not make explicit WebGL2 wait for the independent WebGPU probe", async () => {
    let releaseProbe: (value: StudioBg3dWebGpuProbeResult) => void = () => undefined;
    const probe = vi.fn(() => new Promise<StudioBg3dWebGpuProbeResult>((resolve) => {
      releaseProbe = resolve;
    }));
    const loadPreference = async (): Promise<StudioBg3dEnginePreference> => "webgl2";
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      loadPreference,
      probe,
    })));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.plan).toMatchObject({ backend: "webgl2", status: "available" });
    expect(result.current.glFactory).toBeNull();
    expect(probe).toHaveBeenCalledOnce();

    await act(async () => {
      releaseProbe(UNSUPPORTED_PROBE);
      await Promise.resolve();
    });
    expect(result.current.plan).toMatchObject({ backend: "webgl2", status: "available" });
  });

  it("changes the canvas key only for an engine switch or an explicit failed retry", async () => {
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options()));
    await waitFor(() => expect(result.current.plan.status).toBe("available"));
    expect(result.current.canvasKey).toBe("webgpu#0");

    act(() => result.current.setPreference("webgl2"));
    expect(result.current.canvasKey).toBe("webgl2#0");
    act(() => result.current.setPreference("webgl2"));
    expect(result.current.canvasKey).toBe("webgl2#0");
  });

  it("keeps WebGPU selected and failed when renderer initialization fails", async () => {
    const createWebGpuRenderer = vi.fn(async () => {
      throw new Error("device-lost-during-init");
    });
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      createWebGpuRenderer: createWebGpuRenderer as never,
    })));
    await waitFor(() => expect(result.current.glFactory).toBeTypeOf("function"));

    await act(async () => {
      await result.current.glFactory!({ canvas: document.createElement("canvas") })
        .catch(() => undefined);
    });

    await waitFor(() => expect(result.current.plan.status).toBe("failed"));
    expect(result.current.plan).toMatchObject({
      backend: "webgpu",
      reason: "webgpu-runtime-failed",
    });
    expect(result.current.canvasKey).toBe("webgpu#0");
    expect(result.current.glFactory).toBeNull();
    expect(result.current.deviceLostMessage).toContain("WebGL2를 직접 선택");
    expect(result.current.deviceLostMessage).not.toContain("전환");

    act(() => result.current.setPreference("webgpu"));
    await waitFor(() => expect(result.current.plan.status).toBe("available"));
    expect(result.current.canvasKey).toBe("webgpu#1");
    expect(result.current.glFactory).toBeTypeOf("function");
  });

  it("marks a live device loss failed without mounting WebGL2", async () => {
    const createWebGpuRenderer = vi.fn(async (
      _canvas: HTMLCanvasElement,
      rendererOptions?: { onDeviceLost?: (loss: { reason: string; message: string }) => void },
    ) => {
      queueMicrotask(() => rendererOptions?.onDeviceLost?.({
        reason: "unknown",
        message: "GPU 프로세스가 종료되었습니다.",
      }));
      return { renderer: { render: () => undefined }, dispose: async () => undefined };
    });
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      createWebGpuRenderer: createWebGpuRenderer as never,
    })));
    await waitFor(() => expect(result.current.glFactory).toBeTypeOf("function"));

    await act(async () => {
      await result.current.glFactory!({ canvas: document.createElement("canvas") });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.plan.status).toBe("failed"));
    expect(result.current.plan.backend).toBe("webgpu");
    expect(result.current.deviceLostMessage).toContain("GPU 프로세스가 종료되었습니다");
    expect(result.current.glFactory).toBeNull();
  });

  it("keeps an unavailable WebGPU selection when the probe refuses the host", async () => {
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      probe: async () => UNSUPPORTED_PROBE,
    })));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.plan).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "webgpu-probe-unsupported",
    });
    expect(result.current.canvasKey).toBe("webgpu#0");
    expect(result.current.glFactory).toBeNull();
  });

  it("does not auto-demote an opt-in in-app browser", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15; wv) Mobile Safari/537.36 KAKAOTALK 10.6.5",
    });
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options()));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.inApp).toMatchObject({ id: "kakaotalk", isInApp: true });
    expect(result.current.plan).toMatchObject({ backend: "webgpu", status: "available" });
    expect(result.current.plan.diagnostics).toContain("inapp-browser-opt-in-required");
  });

  it("keeps a choice made while restored storage is still loading", async () => {
    let releaseRestored: (value: StudioBg3dEnginePreference) => void = () => undefined;
    const loadPreference = vi.fn(() => new Promise<StudioBg3dEnginePreference>((resolve) => {
      releaseRestored = resolve;
    }));
    const savePreference = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      loadPreference,
      savePreference,
    })));

    act(() => result.current.setPreference("webgl2"));
    await act(async () => {
      releaseRestored("webgpu");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.preference).toBe("webgl2");
    expect(savePreference).toHaveBeenCalledWith("webgl2");
  });

  it("expires the detailed loss banner but retains the failed selection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createWebGpuRenderer = vi.fn(async () => {
      throw new Error("device-lost-during-init");
    });
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options({
      createWebGpuRenderer: createWebGpuRenderer as never,
    })));
    await waitFor(() => expect(result.current.glFactory).toBeTypeOf("function"));
    await act(async () => {
      await result.current.glFactory!({ canvas: document.createElement("canvas") })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.deviceLostMessage).not.toBeNull());

    await act(async () => {
      vi.advanceTimersByTime(STUDIO_BG3D_DEVICE_LOSS_NOTICE_MS + 1);
    });
    expect(result.current.deviceLostMessage).toBeNull();
    expect(result.current.plan).toMatchObject({ backend: "webgpu", status: "failed" });
  });

  it("makes WebGPU unavailable for a latched requirement until WebGL2 is chosen", async () => {
    const { result, rerender } = renderHook(
      (props: { vrm: boolean }) => useStudioBg3dEngineRuntime(options({
        observedWebglOnlyFeatures: { vrmCharacters: props.vrm },
      })),
      { initialProps: { vrm: false } },
    );
    await waitFor(() => expect(result.current.plan.status).toBe("available"));

    rerender({ vrm: true });
    await waitFor(() => expect(result.current.plan.status).toBe("unavailable"));
    expect(result.current.plan).toMatchObject({
      backend: "webgpu",
      reason: "webgl-only-vrm-character",
    });
    expect(result.current.canvasKey).toBe("webgpu#0");
    expect(result.current.glFactory).toBeNull();

    act(() => result.current.setPreference("webgl2"));
    expect(result.current.plan).toMatchObject({ backend: "webgl2", status: "available" });
  });
});
