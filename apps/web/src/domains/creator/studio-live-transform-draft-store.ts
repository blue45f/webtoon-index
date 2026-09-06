/**
 * External store for the exact, model-backed half of a live draw transform.
 *
 * A separately certified renderer may stay on a retained node. Current admitted ink engines all
 * contain absolute-pixel spacing, quantization or topology rules and therefore use this exact
 * lane even for uniform scale/rotation. The store publishes the transformed DrawEls to an isolated
 * React-Konva root at most once per animation frame without putting that draft into
 * document/history/CRDT state.
 *
 * One claim owns a SET of elements, not a single one, because a multi-selection resize is one
 * gesture with one commit: `planStudioGroupUniformResize` maps every selected element through the
 * same frame and `commit` publishes them atomically. Splitting that into per-element claims would
 * let a partially superseded selection present a mix of two frames, and a handoff could retire one
 * stroke's hidden source while its neighbour's stayed hidden. The set is therefore the ownership
 * unit end to end: claimed together, presented together, handed off together, acknowledged only
 * when EVERY member's authoritative element matches.
 */

import { canonicalJson } from "@toonspectrum/studio-project-model";

import type { DrawEl, El } from "./studio-element-model";
import type { StudioLiveTransformClipRect } from "./studio-live-transform-clip-tracking";

/**
 * One drafted element and the panel clip it must be drawn inside.
 *
 * The clip is per entry rather than per snapshot: a multi-selection can straddle panels, and a
 * union clip would let a stroke paint outside the panel that owns it.
 */
export interface StudioLiveTransformDraftEntry {
  readonly element: DrawEl;
  readonly clip: StudioLiveTransformClipRect | null;
}

export interface StudioLiveTransformDraftSnapshot {
  readonly scope: string;
  readonly entries: readonly StudioLiveTransformDraftEntry[];
  readonly phase: "active" | "handoff";
  readonly revision: number;
}

export type StudioLiveTransformDraftPresentation = readonly StudioLiveTransformDraftEntry[];

export interface StudioLiveTransformDraftClaim {
  readonly generation: number;
  readonly scope: string;
  /** The claimed set, in the order every presentation and handoff must repeat. */
  readonly elementIds: readonly string[];
  /** True only after this exact generation no longer owns the store. */
  readonly isReleased: () => boolean;
  /** O(1) generation-local proof that this claim currently owns visible exact draft authority. */
  readonly hasPresentation: () => boolean;
  /** Replace the latest exact preview. This is called from the rAF renderer seam, never pointermove. */
  readonly present: (presentation: StudioLiveTransformDraftPresentation) => void;
  /** Remove an active preview immediately. False retains a handoff whose source recovery failed. */
  readonly clear: () => boolean;
  /** End this generation. False keeps a failed handoff owned and retryable. */
  readonly release: () => boolean;
  /**
   * Retain the terminal preview until the authoritative document renders the same element.
   * `onRelease` restores the hidden source wrapper after receipt or timeout.
   */
  readonly handoff: (expected: readonly DrawEl[], onRelease: () => void) => boolean;
}

export interface StudioLiveTransformDraftStore {
  readonly getSnapshot: () => StudioLiveTransformDraftSnapshot | null;
  readonly subscribe: (listener: () => void) => () => void;
  /** One generation owns mutation rights; stale cleanup from an older gesture becomes a no-op. */
  readonly claim: (
    scope: string,
    elementIds: readonly string[],
  ) => StudioLiveTransformDraftClaim | null;
  /** Called after an authoritative document render; clears only an exact terminal receipt. */
  readonly acknowledgeAuthoritative: (scope: string, elements: readonly El[]) => boolean;
  /** Release an active/handoff owner only when it belongs to this document scope. */
  readonly releaseScope: (scope: string) => boolean;
}

export interface CreateStudioLiveTransformDraftStoreOptions {
  /** Safety valve for an interrupted/unmounted authoritative render. */
  readonly handoffTimeoutMs?: number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancelTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_HANDOFF_TIMEOUT_MS = 3_000;

/** Model payloads are JSON-safe; equality is evaluated only at pointer-up receipt, not per frame. */
export function studioLiveTransformDraftReceipt(element: DrawEl): string {
  // CRDT restoration materializes fields in schema order rather than preserving the producer's
  // insertion order. Canonical JSON makes a semantic payload receipt independent of that order,
  // including nested records, while keeping arrays ordered because sample order is meaningful.
  return canonicalJson(element);
}

/**
 * Receipt for a whole claimed set.
 *
 * Element order is the claim's own, which every presentation and handoff repeats, so the join is
 * stable without sorting. The separator cannot occur inside canonical JSON of a DrawEl, so no pair
 * of distinct sets can collide on one string.
 */
function studioLiveTransformDraftSetReceipt(elements: readonly DrawEl[]): string {
  return elements.map(studioLiveTransformDraftReceipt).join("\u0000");
}

function sameIdSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function createStudioLiveTransformDraftStore(
  options: CreateStudioLiveTransformDraftStoreOptions = {},
): StudioLiveTransformDraftStore {
  const listeners = new Set<() => void>();
  const scheduleTimeout = options.scheduleTimeout ?? globalThis.setTimeout.bind(globalThis);
  const cancelTimeout = options.cancelTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const handoffTimeoutMs = options.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS;
  let snapshot: StudioLiveTransformDraftSnapshot | null = null;
  let revision = 0;
  let expectedReceipt: string | null = null;
  let releaseSource: (() => void) | null = null;
  let releaseSourceInProgress = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let nextGeneration = 0;
  let ownerGeneration: number | null = null;
  let ownerScope: string | null = null;
  let ownerElementIds: readonly string[] | null = null;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken observer cannot strand a renderer claim. React will retry from getSnapshot.
      }
    }
  };

  const cancelHandoffTimeout = (): void => {
    if (timeoutHandle === null) return;
    // Detach ownership before invoking an injectable host timer. Even a throwing canceller cannot
    // make a later release skip the source-restoration callback or retain a stale handle forever.
    const handle = timeoutHandle;
    timeoutHandle = null;
    try {
      cancelTimeout(handle);
    } catch {
      // The generation guard makes a late timer callback harmless after owner state is cleared.
    }
  };

  const releaseHandoff = (): boolean => {
    const callback = releaseSource;
    if (callback) {
      if (releaseSourceInProgress) return false;
      releaseSourceInProgress = true;
      try {
        callback();
      } catch {
        // The exact draft remains the only proven raster authority. Keep every handoff token so a
        // later authoritative receipt, scope release, timeout or superseding claim can retry.
        return false;
      } finally {
        releaseSourceInProgress = false;
      }
    }
    releaseSource = null;
    expectedReceipt = null;
    cancelHandoffTimeout();
    return true;
  };

  const clearOwned = (): boolean => {
    const hadSnapshot = snapshot !== null;
    if (!releaseHandoff()) return false;
    snapshot = null;
    ownerGeneration = null;
    ownerScope = null;
    ownerElementIds = null;
    if (hadSnapshot) notify();
    return true;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    claim: (scope, elementIds) => {
      if (!scope) return null;
      // An empty or duplicated set has no coherent presentation contract: `present` could not tell
      // which entry a repeated id belongs to, and a handoff could retire a source twice.
      // `Array.isArray` first: a bare string spreads into characters, which would then be graded
      // by the duplicate and emptiness rules below and accepted or refused for accidental reasons.
      if (!Array.isArray(elementIds)) return null;
      const claimedIds = [...elementIds];
      if (claimedIds.length === 0) return null;
      if (new Set(claimedIds).size !== claimedIds.length) return null;
      if (claimedIds.some((id) => typeof id !== "string" || id.length === 0)) return null;
      if (ownerGeneration !== null && snapshot?.phase !== "handoff") return null;
      // A newer user gesture may start before React acknowledges the previous commit. Its exact
      // draft supersedes that already-durable handoff and restores the old hidden wrapper first.
      if (ownerGeneration !== null && !clearOwned()) return null;
      // A release subscriber may synchronously claim the now-restored store. Preserve that newer
      // generation instead of overwriting it from this older supersession attempt.
      if (ownerGeneration !== null) return null;
      const generation = ++nextGeneration;
      ownerGeneration = generation;
      ownerScope = scope;
      ownerElementIds = claimedIds;
      const owns = (): boolean =>
        ownerGeneration === generation
        && ownerScope === scope
        && ownerElementIds === claimedIds;
      const clear = (): boolean => {
        if (!owns()) return false;
        const hadSnapshot = snapshot !== null;
        if (!releaseHandoff()) return false;
        snapshot = null;
        if (hadSnapshot) notify();
        return true;
      };
      const releaseClaim = (): boolean => {
        if (!owns()) return false;
        return clearOwned();
      };
      return {
        generation,
        scope,
        elementIds: claimedIds,
        isReleased: () => !owns(),
        hasPresentation: () => owns() && snapshot !== null,
        present: (entries) => {
          if (!owns()) return;
          // The presentation must be the claimed set, in the claimed order. A partial or reordered
          // publication would leave some sources hidden with nothing drawn in their place.
          if (!sameIdSequence(entries.map((entry) => entry.element.id), claimedIds)) return;
          if (!releaseHandoff()) return;
          snapshot = {
            scope,
            entries: [...entries],
            phase: "active",
            revision: ++revision,
          };
          notify();
        },
        clear,
        release: releaseClaim,
        handoff: (expected, onRelease) => {
          // Bound before the guard so the null check narrows it for the spread below; reading
          // `snapshot` again there would hand TypeScript a fresh, un-narrowed `let`.
          const active = snapshot;
          const presented = active?.entries ?? null;
          if (
            !owns()
            || active === null
            || presented === null
            || !sameIdSequence(expected.map((element) => element.id), claimedIds)
            || !sameIdSequence(
              presented.map((entry) => entry.element.id),
              expected.map((element) => element.id),
            )
          ) {
            try {
              onRelease();
            } catch {
              // No handoff tokens exist on this rejected path; the caller owns fallback recovery.
            }
            return false;
          }
          // The normal path hands off the exact objects just published by exactPresentation. Avoid
          // serializing a potentially 1.8MB, 100k-sample payload merely to compare it with itself;
          // a non-identical test/adapter candidate still receives semantic canonical validation.
          const terminalReceipt = studioLiveTransformDraftSetReceipt(expected);
          if (
            presented.some((entry, index) => entry.element !== expected[index])
            && studioLiveTransformDraftSetReceipt(presented.map((entry) => entry.element))
              !== terminalReceipt
          ) {
            try {
              onRelease();
            } catch {
              // No handoff tokens exist on this rejected path; the caller owns fallback recovery.
            }
            return false;
          }
          if (!releaseHandoff()) return false;
          expectedReceipt = terminalReceipt;
          releaseSource = onRelease;
          snapshot = { ...active, phase: "handoff", revision: ++revision };
          let scheduled: ReturnType<typeof setTimeout>;
          try {
            scheduled = scheduleTimeout(releaseClaim, handoffTimeoutMs);
          } catch {
            // A terminal preview without either an authoritative receipt or a safety timer may
            // never retain the hidden source. Roll back synchronously and report no handoff.
            clearOwned();
            return false;
          }
          // A hostile/test scheduler may invoke the callback synchronously before returning.
          // Do not resurrect its handle after that callback already released this generation.
          if (!owns() || snapshot?.phase !== "handoff") {
            try {
              cancelTimeout(scheduled);
            } catch {
              // The generation is already released; a late callback is a no-op.
            }
            return false;
          }
          timeoutHandle = scheduled;
          notify();
          return true;
        },
      };
    },
    acknowledgeAuthoritative: (scope, elements) => {
      const handedOff = snapshot;
      if (
        handedOff?.phase !== "handoff"
        || handedOff.scope !== scope
        || ownerScope !== scope
        || expectedReceipt === null
      ) {
        return false;
      }
      // Every member has to have landed. A commit that republished one stroke of a pair and left
      // the other stale would otherwise retire both hidden sources, dropping the un-landed one.
      const byId = new Map(elements.map((element) => [element.id, element]));
      const authoritative: DrawEl[] = [];
      for (const entry of handedOff.entries) {
        const element = byId.get(entry.element.id);
        if (element?.type !== "draw") return false;
        authoritative.push(element);
      }
      if (studioLiveTransformDraftSetReceipt(authoritative) !== expectedReceipt) return false;
      return clearOwned();
    },
    releaseScope: (scope) => {
      if (ownerScope !== scope) return false;
      return clearOwned();
    },
  };
}
