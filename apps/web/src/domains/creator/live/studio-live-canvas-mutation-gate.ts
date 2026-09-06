/**
 * Canvas-facing soft-lock gate for selection, drag, and text mutations.
 *
 * Room leases already exist (`studio-live-mutation-guard`). This module maps editor intents
 * (select / drag / text-edit) onto those resources so non-holders fail closed with Korean reasons
 * before Konva handlers mutate the document. Pure — no Socket.IO.
 */
import {
  canBeginStudioLiveMutation,
  selfHoldsStudioLiveLock,
  studioLiveElementResource,
  studioLiveMutationResources,
  studioLivePageResource,
  type StudioLiveLockLike,
  type StudioLiveMutationDecision,
} from "./studio-live-mutation-guard";

export type StudioCanvasMutationIntent =
  | "select"
  | "drag"
  | "text-edit"
  | "transform"
  | "page-edit";

export type StudioCanvasMutationGateInput = {
  locks: readonly StudioLiveLockLike[];
  pageId: string;
  /** Concrete element targets; empty/null means page-scoped mutation. */
  elementIds?: readonly string[] | null;
  selfSessionId: string;
  intent: StudioCanvasMutationIntent;
  now?: number;
  /**
   * When true (default for select), viewing/highlighting is allowed even under foreign locks.
   * Drag/text/transform always require mutation permission.
   */
  allowSelectWithoutLease?: boolean;
};

export type StudioCanvasMutationGateResult =
  | {
      ok: true;
      /** Resources the caller should claim for durable edits (empty for pure select). */
      resources: readonly string[];
      intent: StudioCanvasMutationIntent;
    }
  | {
      ok: false;
      reason: string;
      lock: StudioLiveLockLike;
      intent: StudioCanvasMutationIntent;
    };

const MUTATING_INTENTS: ReadonlySet<StudioCanvasMutationIntent> = new Set([
  "drag",
  "text-edit",
  "transform",
  "page-edit",
]);

/**
 * Decide whether the local session may perform a canvas mutation intent.
 * Select is non-destructive by default; drag/text/transform fail closed for non-holders.
 */
export function gateStudioCanvasMutation(
  input: StudioCanvasMutationGateInput
): StudioCanvasMutationGateResult {
  const pageId = typeof input.pageId === "string" ? input.pageId.trim() : "";
  if (!pageId) {
    return {
      ok: false,
      reason: "페이지를 확인할 수 없어 편집을 시작하지 않았습니다.",
      lock: {
        resource: "page:",
        claimId: "invalid",
        owner: { sessionId: "system", displayName: "시스템" },
        leaseUntil: Number.POSITIVE_INFINITY,
      },
      intent: input.intent,
    };
  }

  const resources = studioLiveMutationResources({
    pageId,
    elementIds: input.elementIds,
  });

  const selectAllowedWithoutLease =
    input.intent === "select" && input.allowSelectWithoutLease !== false;
  if (selectAllowedWithoutLease) {
    return { ok: true, resources: [], intent: input.intent };
  }

  if (!MUTATING_INTENTS.has(input.intent) && input.intent !== "select") {
    return { ok: true, resources, intent: input.intent };
  }

  // Select with allowSelectWithoutLease=false still needs a free target (e.g. exclusive marquee).
  const decision: StudioLiveMutationDecision = canBeginStudioLiveMutation({
    locks: input.locks,
    pageId,
    elementIds: input.elementIds,
    selfSessionId: input.selfSessionId,
    now: input.now,
  });

  if (!decision.ok) {
    const verb =
      input.intent === "text-edit"
        ? "텍스트를 수정"
        : input.intent === "drag"
          ? "드래그"
          : input.intent === "transform"
            ? "변형"
            : input.intent === "page-edit"
              ? "페이지를 편집"
              : "선택 범위를 독점";
    const who = decision.lock.owner.displayName?.trim() || "다른 편집자";
    return {
      ok: false,
      reason: `${who}가 이 영역을 편집 중이라 ${verb}할 수 없습니다. 잠금이 풀릴 때까지 기다려 주세요.`,
      lock: decision.lock,
      intent: input.intent,
    };
  }

  return {
    ok: true,
    resources: input.intent === "select" ? [] : resources,
    intent: input.intent,
  };
}

/**
 * Holder matrix helper for tests and UI badges: true only when self holds every required resource.
 */
export function selfHoldsStudioCanvasMutationTargets(input: {
  locks: readonly StudioLiveLockLike[];
  pageId: string;
  elementIds?: readonly string[] | null;
  selfSessionId: string;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const resources = studioLiveMutationResources({
    pageId: input.pageId,
    elementIds: input.elementIds,
  });
  if (resources.length === 0) return false;
  return resources.every((resource) =>
    selfHoldsStudioLiveLock(input.locks, resource, input.selfSessionId, now)
  );
}

export {
  studioLiveElementResource,
  studioLivePageResource,
  studioLiveMutationResources,
};
