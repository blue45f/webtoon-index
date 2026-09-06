/**
 * Renderer-neutral application boundary for a capture frame's camera view window.
 *
 * The camera contract is structural so Three's current camera and future renderer adapters can use
 * the same safe-frame application and exact restoration policy without importing a renderer.
 */

import {
  resolveStudioBg3dCaptureViewOffset,
  type StudioBg3dCaptureFrame,
} from "./studio-bg3d-capture-frame-geometry";

export interface StudioBg3dCaptureFrameCameraView {
  readonly enabled: boolean;
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dCaptureFrameViewCamera {
  readonly isCamera: boolean;
  /**
   * Three PerspectiveCamera mutates this value to fullWidth/fullHeight inside setViewOffset().
   * Keep it writable so the capture wrapper can preserve the live viewport projection.
   */
  aspect?: number;
  readonly view?: StudioBg3dCaptureFrameCameraView | null;
  setViewOffset?: (
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  clearViewOffset?: () => void;
  updateProjectionMatrix?: () => void;
}

/**
 * 캡처 프레임을 카메라의 view 창으로 잡고, 되돌리는 함수를 돌려준다. 크롭을 적용할 수 없으면
 * null을 돌려준다 — 호출자는 늘어난 래스터를 삽입하는 대신 트랜잭션을 실패시켜야 한다.
 *
 * 뷰포트와 같은 프레임(자동/일치)이면 카메라를 전혀 건드리지 않는다. 크롭이 있을 때만 이전 view를
 * 스냅샷해 두었다가 정확히 같은 상태로 복원하므로, 렌즈 시프트 같은 기존 설정이 살아남는다.
 */
export function applyStudioBg3dCaptureFrameViewOffset(
  camera: StudioBg3dCaptureFrameViewCamera | null,
  frame: StudioBg3dCaptureFrame,
  viewport: { readonly width: number; readonly height: number },
): (() => void) | null {
  if (frame.fit === "exact") return () => {};
  const target = camera as StudioBg3dCaptureFrameViewCamera | null;
  if (
    !target ||
    typeof target.setViewOffset !== "function" ||
    typeof target.clearViewOffset !== "function"
  ) {
    return null;
  }
  const previousAspect =
    typeof target.aspect === "number" &&
    Number.isFinite(target.aspect) &&
    target.aspect > 0
      ? target.aspect
      : null;
  // PerspectiveCamera.setViewOffset() overwrites `aspect` with fullWidth/fullHeight. The capture
  // geometry intentionally uses a square normalized coordinate system, so failing to restore the
  // live viewport aspect would apply the crop twice. A perspective-like camera without a
  // projection refresh hook therefore cannot be used safely.
  if (previousAspect !== null && typeof target.updateProjectionMatrix !== "function") {
    return null;
  }
  const previous = target.view && target.view.enabled ? { ...target.view } : null;
  const offset = resolveStudioBg3dCaptureViewOffset({
    frame,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    baseWindow: previous && previous.fullWidth > 0 && previous.fullHeight > 0
      ? {
          offsetX: previous.offsetX / previous.fullWidth,
          offsetY: previous.offsetY / previous.fullHeight,
          width: previous.width / previous.fullWidth,
          height: previous.height / previous.fullHeight,
        }
      : null,
  });
  if (!offset) return null;
  target.setViewOffset(
    offset.fullWidth,
    offset.fullHeight,
    offset.offsetX,
    offset.offsetY,
    offset.width,
    offset.height,
  );
  if (previousAspect !== null) {
    target.aspect = previousAspect;
    target.updateProjectionMatrix?.();
  }
  return () => {
    if (previous) {
      target.setViewOffset?.(
        previous.fullWidth,
        previous.fullHeight,
        previous.offsetX,
        previous.offsetY,
        previous.width,
        previous.height,
      );
    } else {
      target.clearViewOffset?.();
    }
    if (previousAspect !== null) {
      target.aspect = previousAspect;
      target.updateProjectionMatrix?.();
    }
  };
}
