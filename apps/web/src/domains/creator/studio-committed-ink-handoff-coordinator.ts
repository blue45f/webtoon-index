/**
 * Pure FIFO coordinator for promoting settled live ink to the committed scene surface.
 *
 * A settled surface is the last visible copy of a stroke until the authoritative scene has both
 * accepted the stroke and, for the visible page, produced a synchronous draw receipt. Releasing a
 * later handoff before an unresolved head would remove the wrong Canvas/GPU FIFO prefix, so every
 * transition below classifies exactly one queue head. Callers may drain additional heads by
 * invoking the transition again with the returned queue.
 */

export interface StudioCommittedInkSurfaceCounts {
  readonly overlay: number;
  readonly draft: number;
  readonly gpu: number;
}

export interface StudioCommittedInkSurfaceHandoff {
  readonly pageId: string;
  readonly strokeIds: readonly string[];
  readonly overlaySettledCount: number;
  readonly draftSettledCount: number;
  readonly gpuSettledCount: number;
  /** Scene revision observed when the handoff was queued. This baseline never changes. */
  readonly queuedRevision: number;
  /** Number of newer scene revisions that still lacked conclusive topology evidence. */
  readonly missingPasses: number;
  /** Failed visible draw attempts in drawAttemptRevision. */
  readonly drawFailures: number;
  /** Draw failures are bounded independently for each authoritative scene revision. */
  readonly drawAttemptRevision: number;
}

export interface StudioCommittedInkStrokeReparentEvidence {
  readonly fromPageId: string;
  readonly toPageId: string;
}

export interface StudioCommittedInkAuthorityEvidence {
  /** Monotonic scene/projection revision. */
  readonly revision: number;
  /** Page whose committed scene is currently composited, or null when no page is visible. */
  readonly visiblePageId: string | null;
  /** Pages present in the authoritative scene projection. */
  readonly pageIds: ReadonlySet<string>;
  /** Current authoritative parent page for each committed stroke. */
  readonly strokePageIds: ReadonlyMap<string, string>;
  /** Explicit durable page removals. Absence alone is never a tombstone. */
  readonly pageTombstoneIds: ReadonlySet<string>;
  /** Explicit durable stroke removals. Tombstones win over stale projected membership. */
  readonly strokeTombstoneIds: ReadonlySet<string>;
  /** Explicit durable stroke moves. Reparents win over stale membership on the source page. */
  readonly strokeReparents: ReadonlyMap<string, StudioCommittedInkStrokeReparentEvidence>;
}

export interface StudioCommittedInkVisibleDrawRequest {
  /** Exact request identity. A receipt from another head/revision/attempt is ignored. */
  readonly token: string;
  readonly pageId: string;
  readonly revision: number;
  readonly attempt: number;
  readonly strokeIds: readonly string[];
}

export interface StudioCommittedInkVisibleDrawReceipt {
  readonly token: string;
  readonly outcome: "drawn" | "failed";
}

export interface StudioCommittedInkSurfaceAccounting {
  readonly queuedBefore: StudioCommittedInkSurfaceCounts;
  readonly released: StudioCommittedInkSurfaceCounts;
  readonly queuedAfter: StudioCommittedInkSurfaceCounts;
}

interface StudioCommittedInkHandoffResultBase {
  readonly head: StudioCommittedInkSurfaceHandoff;
  readonly queue: readonly StudioCommittedInkSurfaceHandoff[];
  readonly accounting: StudioCommittedInkSurfaceAccounting;
}

export interface StudioCommittedInkHandoffReadyResult
  extends StudioCommittedInkHandoffResultBase {
  readonly status: "ready";
  readonly reason: "committed-offscreen" | "visible-draw-receipted";
  readonly visibleCommittedStrokeIds: readonly string[];
  readonly drawReceiptRequired: false;
}

export interface StudioCommittedInkHandoffDiscardResult
  extends StudioCommittedInkHandoffResultBase {
  readonly status: "authoritative-discard";
  readonly reason: "page-tombstoned" | "strokes-tombstoned-or-reparented";
  readonly removedStrokeIds: readonly string[];
  readonly drawReceiptRequired: false;
}

export type StudioCommittedInkHandoffWaitReason =
  | "empty-stroke-set"
  | "awaiting-authoritative-topology"
  | "visible-draw-receipt-required"
  | "visible-draw-retry"
  | "visible-draw-failed-visible";

export interface StudioCommittedInkHandoffWaitResult
  extends StudioCommittedInkHandoffResultBase {
  readonly status: "wait";
  readonly reason: StudioCommittedInkHandoffWaitReason;
  /** Settled surfaces remain the authoritative visible fallback for every wait result. */
  readonly failVisible: true;
  readonly drawReceiptRequired: boolean;
  /** Null after bounded retries are exhausted; a newer revision can open a fresh retry budget. */
  readonly drawRequest: StudioCommittedInkVisibleDrawRequest | null;
  readonly missingStrokeIds: readonly string[];
  readonly ignoredDrawReceipt: boolean;
}

export type StudioCommittedInkHandoffTransitionResult =
  | StudioCommittedInkHandoffReadyResult
  | StudioCommittedInkHandoffDiscardResult
  | StudioCommittedInkHandoffWaitResult;

export interface StudioCommittedInkHandoffTransitionOptions {
  readonly drawReceipt?: StudioCommittedInkVisibleDrawReceipt | null;
  /** Maximum automatic synchronous draw attempts per authoritative revision. */
  readonly maxDrawAttempts?: number;
}

export interface CreateStudioCommittedInkSurfaceHandoffInput {
  readonly pageId: string;
  readonly strokeIds: readonly string[];
  readonly overlaySettledCount: number;
  readonly draftSettledCount: number;
  readonly gpuSettledCount: number;
  readonly queuedRevision: number;
}

const ZERO_SURFACE_COUNTS: StudioCommittedInkSurfaceCounts = {
  overlay: 0,
  draft: 0,
  gpu: 0,
};

const DEFAULT_MAX_DRAW_ATTEMPTS = 3;

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function sceneRevision(value: number): number {
  return nonNegativeInteger(value);
}

function normalizedStrokeIds(strokeIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const strokeId of strokeIds) {
    if (typeof strokeId !== "string" || strokeId.length === 0 || seen.has(strokeId)) continue;
    seen.add(strokeId);
    result.push(strokeId);
  }
  return result;
}

/** Creates a normalized handoff with an immutable queued-revision baseline. */
export function createStudioCommittedInkSurfaceHandoff(
  input: CreateStudioCommittedInkSurfaceHandoffInput
): StudioCommittedInkSurfaceHandoff {
  const queuedRevision = sceneRevision(input.queuedRevision);
  return {
    pageId: input.pageId,
    strokeIds: normalizedStrokeIds(input.strokeIds),
    overlaySettledCount: nonNegativeInteger(input.overlaySettledCount),
    draftSettledCount: nonNegativeInteger(input.draftSettledCount),
    gpuSettledCount: nonNegativeInteger(input.gpuSettledCount),
    queuedRevision,
    missingPasses: 0,
    drawFailures: 0,
    drawAttemptRevision: queuedRevision,
  };
}

export function studioCommittedInkHandoffSurfaceCounts(
  handoff: StudioCommittedInkSurfaceHandoff
): StudioCommittedInkSurfaceCounts {
  return {
    overlay: handoff.overlaySettledCount,
    draft: handoff.draftSettledCount,
    gpu: handoff.gpuSettledCount,
  };
}

/** Sums the exact FIFO reservations represented by a handoff queue. */
export function sumStudioCommittedInkHandoffSurfaceCounts(
  queue: readonly StudioCommittedInkSurfaceHandoff[]
): StudioCommittedInkSurfaceCounts {
  let overlay = 0;
  let draft = 0;
  let gpu = 0;
  for (const handoff of queue) {
    overlay += handoff.overlaySettledCount;
    draft += handoff.draftSettledCount;
    gpu += handoff.gpuSettledCount;
  }
  return { overlay, draft, gpu };
}

function accountingFor(
  before: readonly StudioCommittedInkSurfaceHandoff[],
  released: StudioCommittedInkSurfaceCounts,
  after: readonly StudioCommittedInkSurfaceHandoff[]
): StudioCommittedInkSurfaceAccounting {
  return {
    queuedBefore: sumStudioCommittedInkHandoffSurfaceCounts(before),
    released,
    queuedAfter: sumStudioCommittedInkHandoffSurfaceCounts(after),
  };
}

function replaceHead(
  queue: readonly StudioCommittedInkSurfaceHandoff[],
  head: StudioCommittedInkSurfaceHandoff
): readonly StudioCommittedInkSurfaceHandoff[] {
  if (queue[0] === head) return queue;
  return [head, ...queue.slice(1)];
}

function drawRequestToken(
  handoff: StudioCommittedInkSurfaceHandoff,
  pageId: string,
  revision: number,
  attempt: number,
  strokeIds: readonly string[]
): string {
  // JSON preserves boundaries even when user-generated IDs contain punctuation or separators.
  return JSON.stringify([
    "studio-committed-ink-draw-v1",
    handoff.pageId,
    handoff.queuedRevision,
    handoff.strokeIds,
    pageId,
    revision,
    attempt,
    strokeIds,
  ]);
}

function createDrawRequest(
  handoff: StudioCommittedInkSurfaceHandoff,
  pageId: string,
  revision: number,
  attempt: number,
  strokeIds: readonly string[]
): StudioCommittedInkVisibleDrawRequest {
  return {
    token: drawRequestToken(handoff, pageId, revision, attempt, strokeIds),
    pageId,
    revision,
    attempt,
    strokeIds,
  };
}

type StrokeAuthorityState =
  | { readonly kind: "committed"; readonly pageId: string }
  | { readonly kind: "displaced"; readonly pageId: string }
  | { readonly kind: "removed" }
  | { readonly kind: "missing" };

function strokeAuthorityState(
  handoff: StudioCommittedInkSurfaceHandoff,
  strokeId: string,
  evidence: StudioCommittedInkAuthorityEvidence
): StrokeAuthorityState {
  // Explicit deletion is more authoritative than a stale React/CRDT projection row.
  if (evidence.strokeTombstoneIds.has(strokeId)) return { kind: "removed" };

  const reparent = evidence.strokeReparents.get(strokeId);
  if (
    reparent
    && reparent.fromPageId === handoff.pageId
    && reparent.toPageId !== handoff.pageId
  ) {
    if (evidence.pageTombstoneIds.has(reparent.toPageId)) return { kind: "removed" };
    // The reparent operation itself is durable authority for removing the old-page copy. An
    // offscreen destination therefore authorizes discarding this settled source surface even when
    // its projection lags. A visible destination must additionally be present in the projected
    // scene, otherwise a successful canvas draw could still omit the stroke.
    if (reparent.toPageId !== evidence.visiblePageId) {
      return { kind: "displaced", pageId: reparent.toPageId };
    }
    if (
      evidence.pageIds.has(reparent.toPageId)
      && evidence.strokePageIds.get(strokeId) === reparent.toPageId
    ) {
      return { kind: "committed", pageId: reparent.toPageId };
    }
    return { kind: "missing" };
  }

  const projectedPageId = evidence.strokePageIds.get(strokeId);
  if (projectedPageId !== undefined) {
    if (evidence.pageTombstoneIds.has(projectedPageId)) return { kind: "removed" };
    if (evidence.pageIds.has(projectedPageId)) {
      return projectedPageId === handoff.pageId || projectedPageId === evidence.visiblePageId
        ? { kind: "committed", pageId: projectedPageId }
        : { kind: "displaced", pageId: projectedPageId };
    }
    return { kind: "missing" };
  }

  // A tombstoned source page authoritatively removes an otherwise-unmoved stroke. An absent page
  // without a tombstone may only be a lagging projection and must remain fail-visible.
  if (evidence.pageTombstoneIds.has(handoff.pageId)) return { kind: "removed" };
  return { kind: "missing" };
}

function nextMissingPasses(
  handoff: StudioCommittedInkSurfaceHandoff,
  evidenceRevision: number
): number {
  const newerRevisions = Math.max(0, evidenceRevision - handoff.queuedRevision);
  return Math.max(handoff.missingPasses, newerRevisions);
}

function waitResult(
  before: readonly StudioCommittedInkSurfaceHandoff[],
  head: StudioCommittedInkSurfaceHandoff,
  reason: StudioCommittedInkHandoffWaitReason,
  options: {
    readonly drawReceiptRequired?: boolean;
    readonly drawRequest?: StudioCommittedInkVisibleDrawRequest | null;
    readonly missingStrokeIds?: readonly string[];
    readonly ignoredDrawReceipt?: boolean;
  } = {}
): StudioCommittedInkHandoffWaitResult {
  const queue = replaceHead(before, head);
  return {
    status: "wait",
    reason,
    failVisible: true,
    head,
    queue,
    accounting: accountingFor(before, ZERO_SURFACE_COUNTS, queue),
    drawReceiptRequired: options.drawReceiptRequired ?? false,
    drawRequest: options.drawRequest ?? null,
    missingStrokeIds: options.missingStrokeIds ?? [],
    ignoredDrawReceipt: options.ignoredDrawReceipt ?? false,
  };
}

/**
 * Classifies and transitions exactly the FIFO head.
 *
 * `null` means the queue is empty. A `ready` or `authoritative-discard` result consumes one head
 * and authorizes releasing exactly its surface counts. Every `wait` result releases zero counts,
 * retains the head, and is fail-visible.
 */
export function transitionStudioCommittedInkHandoffHead(
  queue: readonly StudioCommittedInkSurfaceHandoff[],
  authority: StudioCommittedInkAuthorityEvidence,
  options: StudioCommittedInkHandoffTransitionOptions = {}
): StudioCommittedInkHandoffTransitionResult | null {
  const originalHead = queue[0];
  if (!originalHead) return null;

  const revision = sceneRevision(authority.revision);
  const authorityStates = originalHead.strokeIds.map((strokeId) => ({
    strokeId,
    state: strokeAuthorityState(originalHead, strokeId, authority),
  }));

  if (authorityStates.length === 0) {
    return waitResult(queue, originalHead, "empty-stroke-set");
  }

  const missingStrokeIds = authorityStates
    .filter(({ state }) => state.kind === "missing")
    .map(({ strokeId }) => strokeId);
  if (missingStrokeIds.length > 0) {
    const head = {
      ...originalHead,
      missingPasses: nextMissingPasses(originalHead, revision),
    };
    return waitResult(queue, head, "awaiting-authoritative-topology", {
      missingStrokeIds,
      ignoredDrawReceipt: options.drawReceipt !== undefined && options.drawReceipt !== null,
    });
  }

  const committed = authorityStates.filter(
    (entry): entry is { strokeId: string; state: { kind: "committed"; pageId: string } } => (
      entry.state.kind === "committed"
    )
  );
  const removedStrokeIds = authorityStates
    .filter(({ state }) => state.kind === "removed" || state.kind === "displaced")
    .map(({ strokeId }) => strokeId);

  if (committed.length === 0) {
    const remainingQueue = queue.slice(1);
    const pageTombstoned = authority.pageTombstoneIds.has(originalHead.pageId);
    return {
      status: "authoritative-discard",
      reason: pageTombstoned ? "page-tombstoned" : "strokes-tombstoned-or-reparented",
      head: originalHead,
      queue: remainingQueue,
      accounting: accountingFor(
        queue,
        studioCommittedInkHandoffSurfaceCounts(originalHead),
        remainingQueue
      ),
      removedStrokeIds,
      drawReceiptRequired: false,
    };
  }

  const visibleCommittedStrokeIds = committed
    .filter(({ state }) => state.pageId === authority.visiblePageId)
    .map(({ strokeId }) => strokeId);

  if (visibleCommittedStrokeIds.length === 0) {
    const remainingQueue = queue.slice(1);
    return {
      status: "ready",
      reason: "committed-offscreen",
      head: originalHead,
      queue: remainingQueue,
      accounting: accountingFor(
        queue,
        studioCommittedInkHandoffSurfaceCounts(originalHead),
        remainingQueue
      ),
      visibleCommittedStrokeIds,
      drawReceiptRequired: false,
    };
  }

  const sameDrawRevision = originalHead.drawAttemptRevision === revision;
  const drawFailures = sameDrawRevision ? originalHead.drawFailures : 0;
  const maxDrawAttempts = Math.max(
    1,
    nonNegativeInteger(options.maxDrawAttempts ?? DEFAULT_MAX_DRAW_ATTEMPTS)
  );
  const attempt = drawFailures + 1;
  const drawRequest = createDrawRequest(
    originalHead,
    authority.visiblePageId!,
    revision,
    attempt,
    visibleCommittedStrokeIds
  );
  const head = sameDrawRevision
    ? originalHead
    : {
        ...originalHead,
        drawFailures: 0,
        drawAttemptRevision: revision,
      };
  const receipt = options.drawReceipt;
  const exactReceipt = receipt?.token === drawRequest.token ? receipt : null;

  if (exactReceipt?.outcome === "drawn") {
    const remainingQueue = queue.slice(1);
    return {
      status: "ready",
      reason: "visible-draw-receipted",
      head,
      queue: remainingQueue,
      accounting: accountingFor(
        queue,
        studioCommittedInkHandoffSurfaceCounts(originalHead),
        remainingQueue
      ),
      visibleCommittedStrokeIds,
      drawReceiptRequired: false,
    };
  }

  if (exactReceipt?.outcome === "failed") {
    const failedHead = {
      ...head,
      drawFailures: attempt,
      drawAttemptRevision: revision,
    };
    if (attempt >= maxDrawAttempts) {
      return waitResult(queue, failedHead, "visible-draw-failed-visible", {
        drawReceiptRequired: true,
      });
    }
    const retryRequest = createDrawRequest(
      failedHead,
      authority.visiblePageId!,
      revision,
      attempt + 1,
      visibleCommittedStrokeIds
    );
    return waitResult(queue, failedHead, "visible-draw-retry", {
      drawReceiptRequired: true,
      drawRequest: retryRequest,
    });
  }

  if (drawFailures >= maxDrawAttempts) {
    return waitResult(queue, head, "visible-draw-failed-visible", {
      drawReceiptRequired: true,
      ignoredDrawReceipt: receipt !== undefined && receipt !== null,
    });
  }

  return waitResult(queue, head, "visible-draw-receipt-required", {
    drawReceiptRequired: true,
    drawRequest,
    ignoredDrawReceipt: receipt !== undefined && receipt !== null,
  });
}
