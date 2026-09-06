import {
  applyStudioPagesHistoryRetention,
  type StudioPagesHistoryRetentionOptions,
} from "./studio-history-retention-budget";

import type {
  StudioAutosavePayload,
  StudioPendingStrokeDurabilityReason,
} from "./studio-autosave";

export type StudioPendingStrokeElementLike = { id?: unknown };

export type StudioPendingStrokePageLike = {
  id?: unknown;
  elements?: readonly unknown[];
};

export type StudioPendingStrokeBatch<Stroke extends StudioPendingStrokeElementLike> = {
  pageId: string;
  strokes: readonly Stroke[];
};

export type StudioPendingStrokeProjectionStatus =
  | "projected"
  | "no-pending"
  | "no-new-strokes"
  | "page-missing"
  | "page-ambiguous";

export type StudioPendingStrokeProjection<Page extends StudioPendingStrokePageLike> = {
  pagesList: Page[];
  status: StudioPendingStrokeProjectionStatus;
  appliedStrokeIds: string[];
  duplicateStrokeIds: string[];
  invalidStrokeIndexes: number[];
};

export type StudioPendingStrokeDurabilityDocumentScope =
  | { kind: "local" }
  | { kind: "shared"; workId: string; revision: number };

export type StudioPendingStrokeEmergencyAutosaveFailureReason =
  | Exclude<StudioPendingStrokeProjectionStatus, "projected">
  | "invalid-shared-scope"
  | "source-metadata-mismatch";

export type StudioPendingStrokeEmergencyAutosaveResult =
  | {
      ok: true;
      payload: StudioAutosavePayload;
      projection: StudioPendingStrokeProjection<StudioAutosavePayload["pagesList"][number]>;
    }
  | {
      ok: false;
      reason: StudioPendingStrokeEmergencyAutosaveFailureReason;
      projection: StudioPendingStrokeProjection<StudioAutosavePayload["pagesList"][number]>;
    };

export type StudioLifecycleEmergencyAutosaveFailureReason =
  | "page-missing"
  | "page-ambiguous"
  | "invalid-shared-scope"
  | "source-metadata-mismatch";

export type StudioLifecycleEmergencyAutosaveResult =
  | {
      ok: true;
      payload: StudioAutosavePayload;
      projection: StudioPendingStrokeProjection<StudioAutosavePayload["pagesList"][number]>;
    }
  | {
      ok: false;
      reason: StudioLifecycleEmergencyAutosaveFailureReason;
      projection: StudioPendingStrokeProjection<StudioAutosavePayload["pagesList"][number]>;
    };

export type StudioPagesHistoryAppendResult<Page> = {
  history: Page[][];
  historyIndex: number;
  /** 이 히스토리 배열이 붙들고 있는 것으로 계량된 바이트 누계. */
  retainedBytes: number;
  /** 적용된 유지 바이트 예산 — 호출자가 같은 숫자를 아티스트에게 보여줄 수 있게 함께 돌려준다. */
  budgetBytes: number;
  /** 이번에 새로 붙은 엔트리 1개의 계량 바이트("단계당 약 N MB" 예고용). */
  appendedEntryBytes: number;
  /** 이번 append 가 앞에서 걷어낸 스냅샷 수. */
  evictedCount: number;
  /** 퇴출 원인이 바이트 예산이면 true(개수 방벽만 물었으면 false). */
  evictedForBudget: boolean;
};

function nonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Projects an in-memory deferred stroke batch into its owning page without mutating the source
 * snapshot. Existing element ids and repeated ids inside the batch are both treated as already
 * durable, so replaying this function is idempotent.
 */
export function projectStudioPendingStrokes<
  Page extends StudioPendingStrokePageLike,
  Stroke extends StudioPendingStrokeElementLike,
>(
  pagesList: readonly Page[],
  pending: StudioPendingStrokeBatch<Stroke> | null | undefined
): StudioPendingStrokeProjection<Page> {
  const sourcePages = pagesList as Page[];
  if (!pending || pending.strokes.length === 0) {
    return {
      pagesList: sourcePages,
      status: "no-pending",
      appliedStrokeIds: [],
      duplicateStrokeIds: [],
      invalidStrokeIndexes: [],
    };
  }

  const targetIndexes: number[] = [];
  pagesList.forEach((page, index) => {
    if (page.id === pending.pageId) targetIndexes.push(index);
  });
  if (targetIndexes.length === 0) {
    return {
      pagesList: sourcePages,
      status: "page-missing",
      appliedStrokeIds: [],
      duplicateStrokeIds: [],
      invalidStrokeIndexes: [],
    };
  }
  if (targetIndexes.length > 1) {
    return {
      pagesList: sourcePages,
      status: "page-ambiguous",
      appliedStrokeIds: [],
      duplicateStrokeIds: [],
      invalidStrokeIndexes: [],
    };
  }

  const targetIndex = targetIndexes[0]!;
  const target = pagesList[targetIndex]!;
  const existingElements = Array.isArray(target.elements) ? target.elements : [];
  const seenIds = new Set<string>();
  for (const element of existingElements) {
    if (!element || typeof element !== "object") continue;
    const id = nonEmptyId((element as StudioPendingStrokeElementLike).id);
    if (id) seenIds.add(id);
  }

  const accepted: Stroke[] = [];
  const appliedStrokeIds: string[] = [];
  const duplicateStrokeIds: string[] = [];
  const invalidStrokeIndexes: number[] = [];
  pending.strokes.forEach((stroke, index) => {
    const id = nonEmptyId(stroke.id);
    if (!id) {
      invalidStrokeIndexes.push(index);
      return;
    }
    if (seenIds.has(id)) {
      duplicateStrokeIds.push(id);
      return;
    }
    seenIds.add(id);
    accepted.push(stroke);
    appliedStrokeIds.push(id);
  });

  if (accepted.length === 0) {
    return {
      pagesList: sourcePages,
      status: "no-new-strokes",
      appliedStrokeIds,
      duplicateStrokeIds,
      invalidStrokeIndexes,
    };
  }

  const projectedPages = [...pagesList] as Page[];
  projectedPages[targetIndex] = {
    ...target,
    elements: [...existingElements, ...accepted],
  } as Page;
  return {
    pagesList: projectedPages,
    status: "projected",
    appliedStrokeIds,
    duplicateStrokeIds,
    invalidStrokeIndexes,
  };
}

function sourceMetadataMatchesScope(
  payload: StudioAutosavePayload,
  scope: StudioPendingStrokeDurabilityDocumentScope
): { ok: true; source: Pick<StudioAutosavePayload, "sourceWorkId" | "sourceRevision"> }
  | { ok: false; reason: "invalid-shared-scope" | "source-metadata-mismatch" } {
  const hasWorkId = payload.sourceWorkId !== undefined;
  const hasRevision = payload.sourceRevision !== undefined;
  if (scope.kind === "local") {
    return hasWorkId || hasRevision
      ? { ok: false, reason: "source-metadata-mismatch" }
      : { ok: true, source: {} };
  }

  const workId = scope.workId.trim();
  if (!workId || !Number.isSafeInteger(scope.revision) || scope.revision < 1) {
    return { ok: false, reason: "invalid-shared-scope" };
  }
  if (
    (hasWorkId || hasRevision)
    && (payload.sourceWorkId !== workId || payload.sourceRevision !== scope.revision)
  ) {
    return { ok: false, reason: "source-metadata-mismatch" };
  }
  return {
    ok: true,
    source: { sourceWorkId: workId, sourceRevision: scope.revision },
  };
}

/**
 * Appends one immutable snapshot to the current undo branch. The helper deliberately accepts the
 * caller's latest ref-backed history so two commits in one browser task cannot both branch from an
 * old React render and replace each other.
 *
 * 유지 경계는 **엔트리 수가 아니라 계량된 유지 바이트**다(`studio-history-retention-budget.ts`).
 * 스냅샷이 참조 공유라 엔트리 1개의 한계비용이 376 B ~ 6.46 MiB 로 네 자릿수 배 갈리기 때문에,
 * 고정 개수 상한은 가벼운 편집에는 500배 과하고 무거운 편집에는 무력했다. 퇴출 동작 자체는
 * 그대로다 — 항상 **앞에서만** 잘라내고 `historyIndex = length - 1` 을 유지하므로, 이 값을
 * `recordStudioHistoryJournalPagesSteps` 의 `nextUndoDepth` 로 넘기는 기존 배선이 저널을
 * 그대로 보조 맞춰 준다. 달라진 건 **한 커밋이 한 개가 아니라 N 개를 버릴 수 있다**는 점뿐이다.
 */
export function appendStudioPagesHistorySnapshot<Page>(
  history: readonly (readonly Page[])[],
  historyIndex: number,
  nextPages: readonly Page[],
  retention?: StudioPagesHistoryRetentionOptions
): StudioPagesHistoryAppendResult<Page> {
  const boundedIndex = Math.max(0, Math.min(historyIndex, Math.max(0, history.length - 1)));
  const nextHistory = history
    .slice(0, boundedIndex + 1)
    .map((snapshot) => snapshot as Page[]);
  const keptLength = nextHistory.length;
  nextHistory.push(nextPages as Page[]);

  const applied = applyStudioPagesHistoryRetention({
    sourceHistory: history,
    keptLength,
    nextHistory: nextHistory as unknown[],
    options: retention,
  });

  return {
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
    retainedBytes: applied.retainedBytes,
    budgetBytes: applied.budgetBytes,
    appendedEntryBytes: applied.appendedEntryBytes,
    evictedCount: applied.evictedCount,
    evictedForBudget: applied.evictedForBudget,
  };
}

/**
 * Creates a full lifecycle recovery payload. A pending batch is projected when present, while
 * an already-stable edit still receives a receipt and succeeds with `no-pending`. Missing or
 * ambiguous target pages fail closed because inventing a destination would silently corrupt work.
 */
export function createStudioLifecycleEmergencyAutosave<
  Stroke extends StudioPendingStrokeElementLike = StudioPendingStrokeElementLike,
>(input: {
  payload: StudioAutosavePayload;
  pending: StudioPendingStrokeBatch<Stroke> | null | undefined;
  reason: StudioPendingStrokeDurabilityReason;
  savedAt: string;
  documentScope: StudioPendingStrokeDurabilityDocumentScope;
}): StudioLifecycleEmergencyAutosaveResult {
  const projection = projectStudioPendingStrokes(input.payload.pagesList, input.pending);
  if (projection.status === "page-missing" || projection.status === "page-ambiguous") {
    return { ok: false, reason: projection.status, projection };
  }

  const source = sourceMetadataMatchesScope(input.payload, input.documentScope);
  if (!source.ok) return { ok: false, reason: source.reason, projection };

  const pendingStrokeIds = input.pending
    ? [
        ...new Set(
          input.pending.strokes
            .map((stroke) => nonEmptyId(stroke.id))
            .filter((id): id is string => id !== null)
        ),
      ]
    : [];
  const pendingReceipt =
    input.pending && pendingStrokeIds.length > 0
      ? {
          pendingStrokePageId: input.pending.pageId,
          pendingStrokeIds,
        }
      : {};
  return {
    ok: true,
    payload: {
      ...input.payload,
      ...source.source,
      savedAt: input.savedAt,
      pagesList: projection.pagesList,
      lifecycleDurability: {
        kind: "lifecycle-snapshot",
        reason: input.reason,
        savedAt: input.savedAt,
        ...pendingReceipt,
      },
      ...(projection.appliedStrokeIds.length > 0 && input.pending
        ? {
            pendingStrokeDurability: {
              kind: "pending-strokes" as const,
              reason: input.reason,
              pageId: input.pending.pageId,
              strokeIds: projection.appliedStrokeIds,
              savedAt: input.savedAt,
            },
          }
        : {}),
    },
    projection,
  };
}

/**
 * Builds a deterministic emergency autosave from the latest stable snapshot plus deferred strokes.
 * Callers supply the timestamp so this helper stays deterministic and safe to use from pagehide
 * or unmount cleanup. Shared documents never have their source revision silently rebased.
 */
export function createStudioPendingStrokeEmergencyAutosave<
  Stroke extends StudioPendingStrokeElementLike = StudioPendingStrokeElementLike,
>(input: {
  payload: StudioAutosavePayload;
  pending: StudioPendingStrokeBatch<Stroke> | null | undefined;
  reason: StudioPendingStrokeDurabilityReason;
  savedAt: string;
  documentScope: StudioPendingStrokeDurabilityDocumentScope;
}): StudioPendingStrokeEmergencyAutosaveResult {
  const projection = projectStudioPendingStrokes(input.payload.pagesList, input.pending);
  if (projection.status !== "projected") {
    return { ok: false, reason: projection.status, projection };
  }

  const source = sourceMetadataMatchesScope(input.payload, input.documentScope);
  if (!source.ok) return { ok: false, reason: source.reason, projection };

  return {
    ok: true,
    payload: {
      ...input.payload,
      ...source.source,
      savedAt: input.savedAt,
      pagesList: projection.pagesList,
      pendingStrokeDurability: {
        kind: "pending-strokes",
        reason: input.reason,
        pageId: input.pending!.pageId,
        strokeIds: projection.appliedStrokeIds,
        savedAt: input.savedAt,
      },
    },
    projection,
  };
}
