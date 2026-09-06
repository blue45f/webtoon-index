export type StudioTeamCommentRefreshReason = "initial" | "panel-open" | "manual" | "resume";

interface StudioTeamCommentVisibilityTarget {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: EventListener): void;
  removeEventListener(type: "visibilitychange", listener: EventListener): void;
}

interface StudioTeamCommentOnlineTarget {
  addEventListener(type: "online" | "offline", listener: EventListener): void;
  removeEventListener(type: "online" | "offline", listener: EventListener): void;
}

export interface StudioTeamCommentRefreshSessionDependencies {
  readonly load: (signal: AbortSignal, reason: StudioTeamCommentRefreshReason) => Promise<void>;
  readonly visibilityTarget: StudioTeamCommentVisibilityTarget;
  readonly onlineTarget: StudioTeamCommentOnlineTarget;
  readonly isOnline: () => boolean;
  readonly now?: () => number;
  readonly resumeFreshnessMs?: number;
  readonly onBusyChange?: (busy: boolean) => void;
}

export interface StudioTeamCommentRefreshSession {
  request(reason: StudioTeamCommentRefreshReason): boolean;
  dispose(): void;
}

const DEFAULT_RESUME_FRESHNESS_MS = 15_000;

/**
 * Event-driven replacement for the former 5s/30s full-history poll. It performs one initial load,
 * refreshes on explicit panel/user actions, and revalidates once after an offline/hidden pause.
 * A refresh can fan out to many paginated requests, so every trigger is single-flight and scoped
 * behind one AbortController.
 */
export function createStudioTeamCommentRefreshSession(
  dependencies: StudioTeamCommentRefreshSessionDependencies
): StudioTeamCommentRefreshSession {
  const now = dependencies.now ?? (() => Date.now());
  const resumeFreshnessMs = Math.max(
    0,
    Math.floor(dependencies.resumeFreshnessMs ?? DEFAULT_RESUME_FRESHNESS_MS)
  );
  const controller = new AbortController();
  let disposed = false;
  let inFlight = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let eligible = dependencies.visibilityTarget.visibilityState !== "hidden"
    && dependencies.isOnline();

  const canRequest = () => !disposed
    && dependencies.visibilityTarget.visibilityState !== "hidden"
    && dependencies.isOnline();

  const request = (reason: StudioTeamCommentRefreshReason): boolean => {
    if (!canRequest() || inFlight) return false;
    const startedAt = now();
    if (reason === "resume" && startedAt - lastStartedAt < resumeFreshnessMs) return false;
    inFlight = true;
    lastStartedAt = startedAt;
    dependencies.onBusyChange?.(true);
    void dependencies.load(controller.signal, reason).catch(() => {
      // The Studio controller owns user-facing error projection. This lifecycle boundary only
      // guarantees that rejected loads do not create an unhandled promise.
    }).finally(() => {
      inFlight = false;
      if (!disposed) dependencies.onBusyChange?.(false);
    });
    return true;
  };

  const onLifecycleChange: EventListener = () => {
    const nextEligible = canRequest();
    const resumed = !eligible && nextEligible;
    eligible = nextEligible;
    if (resumed) request("resume");
  };

  dependencies.visibilityTarget.addEventListener("visibilitychange", onLifecycleChange);
  dependencies.onlineTarget.addEventListener("online", onLifecycleChange);
  dependencies.onlineTarget.addEventListener("offline", onLifecycleChange);
  request("initial");

  return {
    request,
    dispose() {
      if (disposed) return;
      disposed = true;
      dependencies.visibilityTarget.removeEventListener("visibilitychange", onLifecycleChange);
      dependencies.onlineTarget.removeEventListener("online", onLifecycleChange);
      dependencies.onlineTarget.removeEventListener("offline", onLifecycleChange);
      controller.abort(new DOMException("팀 댓글 동기화 범위가 변경되었습니다.", "AbortError"));
      dependencies.onBusyChange?.(false);
    },
  };
}
