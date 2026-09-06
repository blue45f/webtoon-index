// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { cleanup, render } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioBg3dViewFrame,
  STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY,
  type StudioBg3dViewFrameClearRenderer,
} from "./studio-bg3d-view-frame-clear";
import { StudioBg3dViewFrameClear } from "./StudioBg3dViewFrameClear";

const { useFrameMock, state } = vi.hoisted(() => ({
  useFrameMock: vi.fn(),
  state: { gl: {} as unknown, invalidate: vi.fn() },
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: useFrameMock,
  useThree: (select: (value: typeof state) => unknown) => select(state),
}));

const require = createRequire(import.meta.url);
const viewportSource = readFileSync(require.resolve("./StudioBg3dEditorViewport.tsx"), "utf8");
beforeEach(() => { state.gl = {}; useFrameMock.mockReset(); });
afterEach(() => cleanup());

describe("Studio BG3D View framebuffer clear", () => {
  it("registers the actual frame callback at the pre-View priority and clears its current renderer", () => {
    const mounted = render(createElement(StudioBg3dViewFrameClear));
    expect(mounted.container.childNodes).toHaveLength(0);
    expect(useFrameMock).toHaveBeenCalledOnce();
    expect(useFrameMock).toHaveBeenCalledWith(
      expect.any(Function),
      STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY,
    );
    const callback = useFrameMock.mock.calls[0]?.[0] as
      | ((value: { gl: StudioBg3dViewFrameClearRenderer }) => void)
      | undefined;
    const setScissorTest = vi.fn();
    const clear = vi.fn();
    callback?.({ gl: { clear, setScissorTest } });
    expect(setScissorTest).toHaveBeenCalledWith(false);
    expect(clear).toHaveBeenCalledWith(true, true, true);
  });

  it.each([false, true])("owns and releases the real WebGPU queue wrappers (StrictMode: %s)", (strict) => {
    const clear = vi.fn();
    const draw = vi.fn();
    const gl = {
      isWebGPURenderer: true,
      backend: { isWebGPUBackend: true, device: {
        queue: { onSubmittedWorkDone: () => Promise.resolve() },
      } },
      getRenderTarget: () => null,
      clear,
      render: draw,
    };
    state.gl = gl;
    const child = createElement(StudioBg3dViewFrameClear);
    const mounted = render(strict ? createElement(StrictMode, null, child) : child);
    expect(gl.render).not.toBe(draw);
    expect(gl.clear).not.toBe(clear);
    mounted.unmount();
    expect(gl.render).toBe(draw);
    expect(gl.clear).toBe(clear);
  });

  it("clears color, depth, and stencil on every requested frame", () => {
    const setScissorTest = vi.fn();
    const clear = vi.fn();
    const renderer: StudioBg3dViewFrameClearRenderer = { clear, setScissorTest };
    clearStudioBg3dViewFrame(renderer);
    clearStudioBg3dViewFrame(renderer);
    expect(setScissorTest.mock.calls).toEqual([[false], [false]]);
    expect(clear.mock.calls).toEqual([
      [true, true, true],
      [true, true, true],
    ]);
  });

  it("runs before Drei View takes over the shared render loop", () => {
    expect(STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY).toBeLessThanOrEqual(0);
    const clearOwner = viewportSource.indexOf("<StudioBg3dViewFrameClear />");
    const firstView = viewportSource.indexOf("<View track={viewTopRef");
    const mainView = viewportSource.indexOf(
      '<View\n                    key="studio-bg3d-main-view"',
    );
    expect(clearOwner).toBeGreaterThan(viewportSource.indexOf("<Canvas"));
    expect(clearOwner).toBeLessThan(firstView);
    expect(clearOwner).toBeLessThan(mainView);
  });
});
