import { describe, expect, it, vi } from "vitest";

import { resolveStudioBg3dCaptureFrame } from "./studio-bg3d-capture-frame-geometry";
import {
  applyStudioBg3dCaptureFrameViewOffset,
  type StudioBg3dCaptureFrameCameraView,
  type StudioBg3dCaptureFrameViewCamera,
} from "./studio-bg3d-capture-frame-view-offset";

const VIEWPORT = Object.freeze({ width: 1_600, height: 900 });

function captureFrame(aspectRatio?: number) {
  const frame = resolveStudioBg3dCaptureFrame({
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    aspectRatio,
  });
  if (!frame) throw new Error("Test capture frame should resolve.");
  return frame;
}

function cameraWithView(view: StudioBg3dCaptureFrameCameraView | null = null) {
  const camera = {
    isCamera: true,
    aspect: VIEWPORT.width / VIEWPORT.height,
    view,
    setViewOffset: vi.fn(),
    clearViewOffset: vi.fn(),
    updateProjectionMatrix: vi.fn(),
  } satisfies StudioBg3dCaptureFrameViewCamera;
  camera.setViewOffset.mockImplementation((fullWidth, fullHeight) => {
    // Mirror Three PerspectiveCamera's otherwise surprising side effect.
    camera.aspect = fullWidth / fullHeight;
  });
  return camera;
}

describe("applyStudioBg3dCaptureFrameViewOffset", () => {
  it("leaves an exact frame untouched even when no camera is available", () => {
    const release = applyStudioBg3dCaptureFrameViewOffset(
      null,
      captureFrame(),
      VIEWPORT,
    );

    expect(release).toBeTypeOf("function");
    expect(() => release?.()).not.toThrow();
  });

  it("fails closed when a cropped frame cannot be applied", () => {
    expect(
      applyStudioBg3dCaptureFrameViewOffset(null, captureFrame(1), VIEWPORT),
    ).toBeNull();
    expect(
      applyStudioBg3dCaptureFrameViewOffset(
        { isCamera: true },
        captureFrame(1),
        VIEWPORT,
      ),
    ).toBeNull();
    expect(
      applyStudioBg3dCaptureFrameViewOffset(
        {
          isCamera: true,
          aspect: VIEWPORT.width / VIEWPORT.height,
          setViewOffset: vi.fn(),
          clearViewOffset: vi.fn(),
        },
        captureFrame(1),
        VIEWPORT,
      ),
    ).toBeNull();
  });

  it("applies a centred crop without letting Three overwrite the live aspect", () => {
    const camera = cameraWithView();
    const originalAspect = camera.aspect;
    const release = applyStudioBg3dCaptureFrameViewOffset(
      camera,
      captureFrame(1),
      VIEWPORT,
    );

    expect(release).toBeTypeOf("function");
    expect(camera.setViewOffset).toHaveBeenCalledOnce();
    expect(camera.setViewOffset).toHaveBeenCalledWith(
      1_000,
      1_000,
      218.75,
      0,
      562.5,
      1_000,
    );
    expect(camera.aspect).toBe(originalAspect);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledOnce();

    release?.();
    expect(camera.clearViewOffset).toHaveBeenCalledOnce();
    expect(camera.setViewOffset).toHaveBeenCalledOnce();
    expect(camera.aspect).toBe(originalAspect);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(2);
  });

  it("composes with and exactly restores an existing camera view", () => {
    const previous = Object.freeze({
      enabled: true,
      fullWidth: 1_000,
      fullHeight: 1_000,
      offsetX: 100,
      offsetY: 50,
      width: 800,
      height: 900,
    });
    const camera = cameraWithView(previous);
    const originalAspect = camera.aspect;
    const release = applyStudioBg3dCaptureFrameViewOffset(
      camera,
      captureFrame(1),
      VIEWPORT,
    );

    expect(camera.setViewOffset).toHaveBeenNthCalledWith(
      1,
      1_000,
      1_000,
      275,
      50,
      450,
      900,
    );

    release?.();
    expect(camera.setViewOffset).toHaveBeenNthCalledWith(
      2,
      previous.fullWidth,
      previous.fullHeight,
      previous.offsetX,
      previous.offsetY,
      previous.width,
      previous.height,
    );
    expect(camera.clearViewOffset).not.toHaveBeenCalled();
    expect(camera.aspect).toBe(originalAspect);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(2);
  });
});
