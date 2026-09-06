/**
 * Konva binding for the live transform preview — the only renderer-aware piece.
 *
 * Applies the engine-agnostic attrs from `studio-live-transform-preview.ts` onto the stroke's
 * draggable wrapper node imperatively: zero React commits per pointer frame, the same hot-path
 * discipline the drag mirrors in `studio-selection-chrome-mirror.ts` follow. A future non-Konva
 * scene backend replaces this file and keeps the math module untouched.
 */
import { STUDIO_LIVE_TRANSFORM_PREVIEW_NEUTRAL_ATTRS } from "./studio-live-transform-preview";

import type { StudioLiveTransformPreviewNodeAttrs } from "./studio-live-transform-preview";
import type Konva from "konva";

export function applyStudioLiveTransformPreviewNodeAttrs(
  node: Konva.Node,
  attrs: StudioLiveTransformPreviewNodeAttrs
): void {
  node.position({ x: attrs.x, y: attrs.y });
  node.rotation(attrs.rotationDeg);
  node.scale({ x: attrs.scaleX, y: attrs.scaleY });
  node.offset({ x: attrs.offsetX, y: attrs.offsetY });
}

export function resetStudioLiveTransformPreviewNodeAttrs(node: Konva.Node): void {
  applyStudioLiveTransformPreviewNodeAttrs(
    node,
    STUDIO_LIVE_TRANSFORM_PREVIEW_NEUTRAL_ATTRS
  );
}

/**
 * A preview target under a cached ancestor (BlendIsolationGroup / ClipMaskGroup flatten their
 * subtree to a bitmap) must fall back to commit-at-release: mutating attrs below a cache never
 * repaints, so the gesture would look dead while actually rearming a stale raster.
 */
/**
 * Does this element also exist as a CACHED second copy somewhere in the scene?
 *
 * `clipBelow` renders the stroke twice: the visible node, and a copy inside a cached
 * `ClipMaskGroup` acting as the upper element's mask. The preview drives the visible node only,
 * so the mask copy would keep the old geometry — the clipped artwork above would not follow the
 * ink, then snap to a different result at commit once both copies re-render from the new points.
 * Our attrs can never repaint a cached subtree, so the honest answer is to skip the preview and
 * let this gesture commit at release.
 */
export function studioLiveTransformPreviewHasCachedDuplicate(
  stage: Konva.Stage,
  elementId: string,
  previewNode: Konva.Node
): boolean {
  return stage
    .find((node: Konva.Node) => node.getAttr("studioElementId") === elementId)
    .some((node) => node !== previewNode && !studioLiveTransformPreviewEligible(node));
}

/**
 * Attr the document layer sets on a wrapper whose commit cannot reproduce an affine preview.
 *
 * Today that means symmetry: copies are generated about world axes and the model stores no axis
 * angle, so the preview's `A ∘ S` and the commit's `S ∘ A` diverge whenever the two do not
 * commute. Marked at render time, where the element is in hand, and read here.
 */
export const STUDIO_LIVE_TRANSFORM_PREVIEW_BLOCKED_ATTR =
  "studioLiveTransformPreviewBlocked";

export function studioLiveTransformPreviewEligible(node: Konva.Node): boolean {
  let current: Konva.Node | null = node;
  while (current) {
    if (current.isCached()) return false;
    if (current.getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_BLOCKED_ATTR) === true) return false;
    current = current.getParent();
  }
  return true;
}
