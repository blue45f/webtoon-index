/**
 * Drei View renders with a positive frame priority and temporarily disables autoClear. That also
 * suppresses R3F's root render, so the shared canvas needs one explicit clear before any View draws.
 * A negative priority keeps the callback ahead of every View without taking over the render loop.
 */
export const STUDIO_BG3D_VIEW_FRAME_CLEAR_PRIORITY = -100;

export interface StudioBg3dViewFrameClearRenderer {
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  setScissorTest(enabled: boolean): void;
}

export function clearStudioBg3dViewFrame(renderer: StudioBg3dViewFrameClearRenderer): void {
  // A previous View leaves its viewport in place. Disabling scissor makes this clear cover the
  // complete shared framebuffer in both the single-view and four-view layouts.
  renderer.setScissorTest(false);
  renderer.clear(true, true, true);
}
