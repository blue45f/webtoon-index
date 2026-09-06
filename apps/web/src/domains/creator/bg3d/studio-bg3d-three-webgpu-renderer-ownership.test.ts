import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioBg3dThreeWebGpuRenderer } from "./studio-bg3d-three-webgpu-renderer";

const state = vi.hoisted(() => ({
  constructs: vi.fn(),
  initializes: vi.fn(),
  disposes: vi.fn(),
  backendDisposes: vi.fn(),
  ready: null as Promise<void> | null,
  lost: undefined as Promise<{ reason: string; message: string }> | undefined,
  failure: null as Error | null,
}));

vi.mock("three/webgpu", () => ({
  WebGPURenderer: class {
    _getFallback: unknown = () => undefined;
    readonly backend = {
      isWebGPUBackend: true,
      dispose: state.backendDisposes,
      device: { lost: state.lost },
    };
    constructor(parameters: unknown) { state.constructs(parameters); }
    async init() {
      state.initializes();
      if (state.failure) throw state.failure;
      await state.ready;
    }
    dispose() { state.disposes(); }
  },
}));

class CanvasMock {}
function canvas(): HTMLCanvasElement {
  vi.stubGlobal("HTMLCanvasElement", CanvasMock);
  return new CanvasMock() as HTMLCanvasElement;
}
function pendingInitialization() {
  let resolve!: () => void;
  state.ready = new Promise<void>((accept) => { resolve = accept; });
  return resolve;
}

afterEach(() => {
  state.constructs.mockReset();
  state.initializes.mockReset();
  state.disposes.mockReset();
  state.backendDisposes.mockReset();
  state.ready = null;
  state.lost = undefined;
  state.failure = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BG3D canvas WebGPU ownership", () => {
  it("shares the pending factory during a re-entrant R3F configure call", async () => {
    const finish = pendingInitialization();
    const target = canvas();
    const first = createStudioBg3dThreeWebGpuRenderer(target);
    const second = createStudioBg3dThreeWebGpuRenderer(target);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(state.constructs).toHaveBeenCalledOnce();
    expect(state.initializes).toHaveBeenCalledOnce();
    finish();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);
    expect(left.renderer).toBe(right.renderer);
    expect(await createStudioBg3dThreeWebGpuRenderer(target)).toBe(left);
    await left.dispose();
  });

  it("does not share devices between different canvases", async () => {
    const finish = pendingInitialization();
    const first = createStudioBg3dThreeWebGpuRenderer(canvas());
    const second = createStudioBg3dThreeWebGpuRenderer(canvas());
    await Promise.resolve();
    expect(state.constructs).toHaveBeenCalledTimes(2);
    finish();
    const [left, right] = await Promise.all([first, second]);
    expect(left.renderer).not.toBe(right.renderer);
    await left.dispose();
    await right.dispose();
  });

  it("keeps the first owner's options and loss callback for a re-entrant request", async () => {
    let lose!: (loss: { reason: string; message: string }) => void;
    state.lost = new Promise((resolve) => { lose = resolve; });
    const target = canvas();
    const ownerLoss = vi.fn();
    const laterLoss = vi.fn();
    const owner = createStudioBg3dThreeWebGpuRenderer(target, {
      antialias: false, alpha: false, onDeviceLost: ownerLoss,
    });
    const later = createStudioBg3dThreeWebGpuRenderer(target, {
      antialias: true, alpha: true, onDeviceLost: laterLoss,
    });
    const runtime = await owner;
    expect(await later).toBe(runtime);
    expect(state.constructs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      canvas: target, antialias: false, alpha: false,
    }));
    lose({ reason: "unknown", message: "device reset" });
    await Promise.resolve();
    await Promise.resolve();
    expect(ownerLoss).toHaveBeenCalledOnce();
    expect(laterLoss).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("releases direct host disposal once and does not let an old handle erase its replacement", async () => {
    const target = canvas();
    const original = await createStudioBg3dThreeWebGpuRenderer(target);
    original.renderer.dispose();
    original.renderer.dispose();
    expect(state.disposes).toHaveBeenCalledOnce();
    const replacement = await createStudioBg3dThreeWebGpuRenderer(target);
    expect(replacement.renderer).not.toBe(original.renderer);
    await original.dispose();
    original.renderer.dispose();
    expect(await createStudioBg3dThreeWebGpuRenderer(target)).toBe(replacement);
    expect(state.constructs).toHaveBeenCalledTimes(2);
    await replacement.dispose();
    expect(state.disposes).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed target failed and permits an explicit new-canvas retry", async () => {
    state.failure = new Error("native initialization failed");
    const target = canvas();
    const first = createStudioBg3dThreeWebGpuRenderer(target);
    const second = createStudioBg3dThreeWebGpuRenderer(target);
    expect(first).toBe(second);
    await expect(first).rejects.toMatchObject({ code: "initialization-failed" });
    state.failure = null;
    expect(createStudioBg3dThreeWebGpuRenderer(target)).toBe(first);
    await expect(second).rejects.toMatchObject({ code: "initialization-failed" });
    const recovered = await createStudioBg3dThreeWebGpuRenderer(canvas());
    expect(state.constructs).toHaveBeenCalledTimes(2);
    expect(state.backendDisposes).toHaveBeenCalledOnce();
    await recovered.dispose();
  });

  it("never lets a timed-out old initialization race a new device on the same canvas", async () => {
    vi.useFakeTimers();
    const finish = pendingInitialization();
    const target = canvas();
    const first = createStudioBg3dThreeWebGpuRenderer(target, { initializationTimeoutMs: 25 });
    const rejected = expect(first).rejects.toMatchObject({ code: "initialization-failed" });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(createStudioBg3dThreeWebGpuRenderer(target)).toBe(first);
    expect(state.constructs).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.backendDisposes).toHaveBeenCalledTimes(2);
    expect(createStudioBg3dThreeWebGpuRenderer(target)).toBe(first);
  });
});
