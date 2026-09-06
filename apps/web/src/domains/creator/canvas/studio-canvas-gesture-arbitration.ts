export type StudioCanvasGestureDisposition =
  | "consume-owned"
  | "pass-suppressed"
  | "pass-view-tools-hud"
  | "handle-canvas";

export interface StudioCanvasGestureArbitrationInput {
  /** A drawing/editing contact currently owns the canvas view transform. */
  readonly gestureOwned: boolean;
  /** Export/capture/save temporarily disables application view transforms. */
  readonly viewTransformSuppressed: boolean;
  /** The event belongs to the independently scrollable View Tools HUD. */
  readonly viewToolsHudTarget: boolean;
}

/**
 * Resolves wheel/touch ownership before target-specific pass-through rules.
 *
 * Once an edit owns the contact stream, every descendant target must preserve the same immutable
 * document transform until that edit ends. In the idle state, capture suppression and the View
 * Tools HUD keep their existing native/pass-through behavior.
 */
export function resolveStudioCanvasGestureDisposition({
  gestureOwned,
  viewTransformSuppressed,
  viewToolsHudTarget,
}: StudioCanvasGestureArbitrationInput): StudioCanvasGestureDisposition {
  if (gestureOwned) return "consume-owned";
  if (viewTransformSuppressed) return "pass-suppressed";
  if (viewToolsHudTarget) return "pass-view-tools-hud";
  return "handle-canvas";
}
