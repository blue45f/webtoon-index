// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioBg3dEngineRuntime } from "./useStudioBg3dEngineRuntime";

import type { StudioBg3dEnginePreference } from "./studio-bg3d-engine-selection";
import type {
  StudioBg3dWebGpuProbeResult,
  StudioBg3dWebGpuProbeSignals,
} from "./studio-bg3d-webgpu-capability";
import type { UseStudioBg3dEngineRuntimeOptions } from "./useStudioBg3dEngineRuntime";

const TIMEOUT: StudioBg3dWebGpuProbeResult = {
  supported: false, reason: "timeout", computeSupported: false,
  timestampQuerySupported: false, limits: {},
};
const SUPPORTED: StudioBg3dWebGpuProbeResult = {
  supported: true, reason: "available", computeSupported: true,
  timestampQuerySupported: false, limits: {},
};
const loadPreference = async (): Promise<StudioBg3dEnginePreference> => "webgpu";
const savePreference = async () => undefined;

function harness() {
  const signals: StudioBg3dWebGpuProbeSignals[] = [];
  const probe = vi.fn(async (request: StudioBg3dWebGpuProbeSignals) => {
    signals.push(request);
    return TIMEOUT;
  });
  const options: UseStudioBg3dEngineRuntimeOptions = {
    enabled: true, deviceProfile: "desktop", antialias: true,
    probe, loadPreference, savePreference,
  };
  const emit = (index: number, result = SUPPORTED) => signals[index]?.onLateResult?.(result);
  return { options, signals, probe, emit };
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
  });
  window.isSecureContext = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BG3D late adapter session and preference ownership", () => {
  it("admits a real late capability result without another request or backend substitution", async () => {
    const h = harness();
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(h.options));
    await waitFor(() => expect(result.current.probe.reason).toBe("timeout"));
    expect(result.current.glFactory).toBeNull();
    act(() => h.emit(0));
    expect(result.current.plan).toMatchObject({ backend: "webgpu", status: "available" });
    expect(result.current.glFactory).toBeTypeOf("function");
    expect(h.probe).toHaveBeenCalledOnce();
  });

  it("keeps a newer explicit WebGL2 choice while recording late WebGPU availability", async () => {
    const h = harness();
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(h.options));
    await waitFor(() => expect(result.current.probe.reason).toBe("timeout"));
    act(() => result.current.setPreference("webgl2"));
    const key = result.current.canvasKey;
    act(() => h.emit(0));
    expect(result.current.probe.supported).toBe(true);
    expect(result.current.plan.backend).toBe("webgl2");
    expect(result.current.canvasKey).toBe(key);
    expect(result.current.glFactory).toBeNull();
  });

  it("does not mount ahead of storage or overwrite a late result with the earlier timeout", async () => {
    const h = harness();
    let release!: (value: StudioBg3dEnginePreference) => void;
    const stored = new Promise<StudioBg3dEnginePreference>((resolve) => { release = resolve; });
    const options = { ...h.options, loadPreference: () => stored };
    const { result } = renderHook(() => useStudioBg3dEngineRuntime(options));
    act(() => h.emit(0));
    expect(result.current.phase).toBe("probing");
    expect(result.current.glFactory).toBeNull();
    await act(async () => { release("webgl2"); await stored; });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.probe.supported).toBe(true);
    expect(result.current.preference).toBe("webgl2");
    expect(result.current.glFactory).toBeNull();
  });

  it("ignores closed and previous-session observers even when the injected observer ignores abort", async () => {
    const h = harness();
    const { result, rerender } = renderHook(
      ({ enabled }) => useStudioBg3dEngineRuntime({ ...h.options, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.probe.reason).toBe("timeout"));
    rerender({ enabled: false });
    expect(h.signals[0]?.signal?.aborted).toBe(true);
    act(() => h.emit(0));
    expect(result.current.glFactory).toBeNull();
    expect(result.current.probe.reason).toBe("timeout");
    rerender({ enabled: true });
    await waitFor(() => expect(h.probe).toHaveBeenCalledTimes(2));
    act(() => h.emit(1));
    expect(result.current.probe.supported).toBe(true);
    act(() => h.emit(0, TIMEOUT));
    expect(result.current.probe.supported).toBe(true);
  });
});
