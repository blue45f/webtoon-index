import type { DrawEl } from "../studio-element-model";
import type {
  StudioCanonicalVNextDryMediaCanvasAuthority,
  StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority,
  StudioCanonicalVNextDryMediaCanvasUnavailableAuthority,
} from "../StudioCanonicalVNextDryMediaCanvas";

export interface StudioCanonicalDryMediaViewportAuthority {
  readonly active: StudioCanonicalVNextDryMediaCanvasAuthority | null;
  readonly authorized: StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority | null;
  readonly unavailable: StudioCanonicalVNextDryMediaCanvasUnavailableAuthority | null;
  readonly canvasVisible: boolean;
  readonly hiddenElementId: string | null;
}

/**
 * A selected specialist keeps document pixel authority after failure only when it carries an exact
 * snapshot of the last receipted WebGPU frame for the same immutable DrawEl **in the same layout**.
 * An unavailable preflight with no such frame is observable but never hides the ordinary document
 * element.
 *
 * The envelope's `layoutKey` is stamped at publish time, so it always equals the current layout and
 * cannot tell whether the retained bitmap is stale. The snapshot's own `lastPresented.layoutKey`
 * can: a frame receipted at a previous surface size, scale, flip or device pixel ratio must not be
 * stretched into the current bounds (the "old frame lingers after resize" symptom).
 */
export function resolveStudioCanonicalDryMediaViewportAuthority(
  authority: StudioCanonicalVNextDryMediaCanvasAuthority | null,
  candidate: DrawEl | null,
  layoutKey: string,
): StudioCanonicalDryMediaViewportAuthority {
  const active = authority !== null
    && candidate !== null
    && authority.element === candidate
    && authority.layoutKey === layoutKey
    ? authority
    : null;
  const authorized = active?.status === "authorized" ? active : null;
  const unavailable = active?.status === "unavailable" ? active : null;
  const retainsExactLastGood = unavailable?.retainsLastGoodFrame === true
    && unavailable.lastPresented?.element === candidate
    && unavailable.lastPresented.layoutKey === layoutKey;
  const ownsDocumentPixels = authorized !== null || retainsExactLastGood;
  return Object.freeze({
    active,
    authorized,
    unavailable,
    canvasVisible: ownsDocumentPixels,
    hiddenElementId: ownsDocumentPixels ? candidate?.id ?? null : null,
  });
}

/** Shared document-layer guard: exactly one pixel owner may paint a promoted dry-media element. */
export function studioCanonicalDryMediaOwnsDocumentElement(
  elementId: string,
  hiddenElementId: string | null,
): boolean {
  return hiddenElementId !== null && elementId === hiddenElementId;
}
