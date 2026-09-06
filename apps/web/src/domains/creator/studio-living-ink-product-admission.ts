export interface StudioLivingInkProductAdmissionState {
  readonly busy: boolean;
  readonly finalizing: boolean;
  readonly hasActiveStroke: boolean;
  readonly hasCanonicalHandoff: boolean;
}

export interface StudioLivingInkAcceptedAuthority {
  readonly pageId: string;
  readonly replayToken: string;
  readonly canonicalSrc: string;
}

export type StudioLivingInkScope = "all" | "selection";

/**
 * Selection scope is only authoritative while the selected canonical image and its pixel mask are
 * both still available. Callers must use this same effective scope for the UI, pointer admission,
 * and Fix/Clear actions so a stale `selection` preference cannot silently route one path
 * differently from another.
 */
export function studioLivingInkEffectiveScope(
  requestedScope: StudioLivingInkScope,
  selectionAvailable: boolean,
): StudioLivingInkScope {
  return requestedScope === "selection" && selectionAvailable ? "selection" : "all";
}

export function studioLivingInkCanReuseAcceptedAuthority(input: Readonly<{
  accepted: StudioLivingInkAcceptedAuthority | null;
  pageId: string;
  replayToken: string;
  canonicalSrc: string;
  coordinatorPageId: string | null;
  coordinatorState: "failed" | "loading" | "ready" | "unavailable";
}>): boolean {
  return input.coordinatorState === "ready"
    && input.coordinatorPageId === input.pageId
    && input.accepted?.pageId === input.pageId
    && input.accepted.replayToken === input.replayToken
    && input.accepted.canonicalSrc === input.canonicalSrc;
}

/**
 * A Living Ink failure is terminal for the selected provider. The retained DrawEl is an input
 * journal, not permission to publish the stroke through Konva or another renderer.
 */
export function studioLivingInkFailureDisposition(
  _mode: "ink" | "water",
): "preserve-document-noop" {
  return "preserve-document-noop";
}

/**
 * A canonical PNG handoff is part of the authoring transaction, not a cosmetic decode. Keeping
 * admission closed until its exact-byte image receipt arrives prevents a delayed Clear/Stroke
 * image from releasing or covering a newer pointer session.
 */
export function studioLivingInkProductAdmissionBlocked(
  state: StudioLivingInkProductAdmissionState,
): boolean {
  return state.busy
    || state.finalizing
    || state.hasActiveStroke
    || state.hasCanonicalHandoff;
}
