import type Konva from "konva";

export function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function readStageDevicePixelRatio(): number {
  const ratio = globalThis.devicePixelRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/*
 * Two frozen style objects rather than an inline literal, so React only ever writes the Stage
 * container's style when the clip actually turns on or off. The clip *offset* is written straight
 * to `style.transform` by the scroll follower, and `transform` appears in neither object — React
 * therefore never clears it out from under the follower.
 *
 * Drawing owns the contact stream; browser panning would otherwise cancel a fast finger stroke. The
 * wrap's explicit two-finger pinch handler still receives bubbled touch events.
 */
export const STUDIO_STAGE_DOCUMENT_STYLE = { touchAction: "none" } as const;
export const STUDIO_STAGE_CLIPPED_STYLE = {
  touchAction: "none",
  position: "absolute",
  left: 0,
  top: 0,
} as const;

export function liveNodeDisplayBounds(
  node: Konva.Node | null | undefined,
  layer: Konva.Layer | null,
  fallback: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (!node || !layer) return fallback;
  try {
    const rect = node.getClientRect({ relativeTo: layer });
    if (
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height)
    ) {
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    }
  } catch {
    // A node can detach between React render and Konva reconciliation. Document bounds stay safe.
  }
  return fallback;
}
