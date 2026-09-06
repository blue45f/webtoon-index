import { Camera, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  installStudioBg3dFrameBackpressure,
  type StudioBg3dFrameQueueRenderer,
} from "./studio-bg3d-frame-backpressure";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(webgpu = true) {
  let target: unknown = null;
  const completions: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const fence = vi.fn(() => new Promise<void>((resolve, reject) => {
    completions.push({ resolve, reject });
  }));
  const poses: number[] = [];
  const clear = vi.fn();
  const render = vi.fn((scene: Object3D) => { poses.push(scene.userData.pose as number); });
  const renderer: StudioBg3dFrameQueueRenderer = {
    isWebGPURenderer: webgpu,
    backend: { isWebGPUBackend: webgpu, device: { queue: { onSubmittedWorkDone: fence } } },
    getRenderTarget: () => target,
    clear,
    render,
  };
  const scene = new Object3D();
  scene.userData.pose = 0;
  const camera = new Camera();
  const requestFrame = vi.fn();
  const release = installStudioBg3dFrameBackpressure(renderer, requestFrame);
  const draw = () => { renderer.clear(true, true, true); renderer.render(scene, camera); };
  return { renderer, scene, camera, poses, clear, render, fence, completions, requestFrame,
    release, draw, setTarget: (value: unknown) => { target = value; } };
}

describe("BG3D live WebGPU frame backpressure", () => {
  it("leaves WebGL methods and submission behavior untouched", async () => {
    const f = fixture(false);
    expect(f.renderer.render).toBe(f.render);
    expect(f.renderer.clear).toBe(f.clear);
    f.draw(); f.draw(); await flush();
    expect(f.render).toHaveBeenCalledTimes(2);
    expect(f.fence).not.toHaveBeenCalled();
    f.release();
  });

  it("keeps the full clear and all four Views in one submitted frame", async () => {
    const f = fixture();
    f.renderer.clear(true, true, true);
    for (let i = 0; i < 4; i += 1) f.renderer.render(f.scene, f.camera);
    expect(f.clear).toHaveBeenCalledWith(true, true, true);
    expect(f.render).toHaveBeenCalledTimes(4);
    expect(f.fence).not.toHaveBeenCalled();
    await flush();
    expect(f.fence).toHaveBeenCalledTimes(1);
    f.release();
  });

  it("coalesces 24 pointer frames and paints the latest pose, not an old replay", async () => {
    const f = fixture(); f.draw(); await flush();
    for (let pose = 1; pose <= 24; pose += 1) {
      f.scene.userData.pose = pose; f.draw(); await flush();
    }
    expect(f.poses).toEqual([0]);
    expect(f.clear).toHaveBeenCalledTimes(1);
    expect(f.fence).toHaveBeenCalledTimes(1);
    f.completions[0]!.resolve(); await flush();
    expect(f.requestFrame).toHaveBeenCalledTimes(1);
    f.draw(); await flush();
    expect(f.poses).toEqual([0, 24]);
    expect(f.fence).toHaveBeenCalledTimes(2);
    f.release();
  });

  it("never creates a continuous idle loop after a clean frame", async () => {
    const f = fixture(); f.draw(); await flush();
    f.completions[0]!.resolve(); await flush();
    expect(f.requestFrame).not.toHaveBeenCalled();
    f.release();
  });

  it("does not drop offscreen artifact or thumbnail passes while a live frame is pending", async () => {
    const f = fixture(); f.draw(); await flush();
    f.setTarget({ capture: true });
    f.scene.userData.pose = 17; f.draw(); await flush();
    expect(f.poses).toEqual([0, 17]);
    expect(f.clear).toHaveBeenCalledTimes(2);
    expect(f.fence).toHaveBeenCalledTimes(1);
    f.setTarget(null); f.draw(); await flush();
    expect(f.poses).toEqual([0, 17]);
    f.completions[0]!.resolve(); await flush();
    expect(f.requestFrame).toHaveBeenCalledTimes(1);
    f.release();
  });

  it("does not install another wrapper or tear down a remaining owner's lease", async () => {
    const f = fixture(); const wrapper = f.renderer.render; const other = vi.fn();
    const releaseOther = installStudioBg3dFrameBackpressure(f.renderer, other);
    expect(f.renderer.render).toBe(wrapper);
    f.draw(); await flush(); f.draw(); await flush();
    f.release(); f.release();
    expect(f.renderer.render).toBe(wrapper);
    f.completions[0]!.resolve(); await flush();
    expect(f.requestFrame).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    releaseOther();
    expect(f.renderer.render).toBe(f.render);
    expect(f.renderer.clear).toBe(f.clear);
  });

  it("does not wake a disposed owner or confuse its fence with a new mount", async () => {
    const f = fixture(); f.draw(); await flush(); f.draw(); await flush(); f.release();
    const other = vi.fn(); const releaseOther = installStudioBg3dFrameBackpressure(f.renderer, other);
    f.draw(); await flush(); f.draw(); await flush();
    f.completions[0]!.resolve(); await flush();
    expect(f.requestFrame).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
    f.completions[1]!.resolve(); await flush(); expect(other).toHaveBeenCalledTimes(1);
    releaseOther();
  });

  it("cancels a not-yet-submitted fence on cleanup", async () => {
    const f = fixture(); f.draw(); f.release(); await flush();
    expect(f.fence).not.toHaveBeenCalled(); expect(f.requestFrame).not.toHaveBeenCalled();
  });

  it.each(["rejected", "thrown"])("surfaces a %s GPU fence instead of claiming frozen-frame success", async (kind) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fixture();
    try {
      if (kind === "thrown") f.fence.mockImplementationOnce(() => { throw new Error("device lost"); });
      f.draw(); await flush();
      if (kind === "rejected") { f.completions[0]!.reject(new Error("device lost")); await flush(); }
      f.draw(); await flush();
      expect(error).toHaveBeenCalledTimes(1);
      expect(f.requestFrame).not.toHaveBeenCalled();
      expect(f.poses).toEqual([0]);
    } finally { f.release(); error.mockRestore(); }
  });

  it("does not overwrite a later instrumented method during cleanup", () => {
    const f = fixture(); const later = vi.fn(); f.renderer.render = later; f.release();
    expect(f.renderer.render).toBe(later);
  });
});
