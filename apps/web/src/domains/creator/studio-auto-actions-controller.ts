// Auto Actions(매크로) 패널 컨트롤러 — StudioPage 에서 추출한 핸들러 팩토리.
// 상태는 컴포넌트가 소유하고, 렌더마다 이 팩토리에 현재 값·세터를 주입해 추출 전과
// 동일한 클로저 의미를 유지한다(studio-drawing-assist-handlers 와 같은 관례).
import { sanitizeStudioPublishFileStem } from "./studio-publish-package";

import type {
  StudioAutoActionExecutionProgress,
  StudioAutoActionPlan,
  StudioAutoActionScope,
  StudioAutoActionSet,
} from "./studio-auto-actions";
import type { PageState } from "./studio-page-state";

export interface StudioAutoActionsControllerDeps<TMutationTicket> {
  autoActionSet: StudioAutoActionSet | null;
  autoActionScope: StudioAutoActionScope;
  autoActionPlan: StudioAutoActionPlan | null;
  autoActionBusy: boolean;
  pages: PageState[];
  currentPageId: string;
  autoActionAbortRef: { current: AbortController | null };
  setAutoActionsOpen: (open: boolean) => void;
  setAutoActionError: (message: string | null) => void;
  setAutoActionStatus: (message: string | null) => void;
  setAutoActionSet: (set: StudioAutoActionSet | null) => void;
  setAutoActionScope: (scope: StudioAutoActionScope) => void;
  setAutoActionSelectedPageIds: (pageIds: string[]) => void;
  setAutoActionPlan: (plan: StudioAutoActionPlan | null) => void;
  setAutoActionBusy: (busy: boolean) => void;
  setAutoActionProgress: (progress: StudioAutoActionExecutionProgress | null) => void;
  /** 실행 직전 명명 체크포인트 생성 — 실패 시 실행을 중단해야 한다. */
  saveNamedCheckpoint: (name: string) => Promise<boolean>;
  captureStudioMutationTicket: () => TMutationTicket;
  canApplyStudioMutation: (ticket: TMutationTicket) => boolean;
  commitPages: (next: PageState[]) => boolean;
  setError: (message: string | null) => void;
}

export function createStudioAutoActionsController<TMutationTicket>(
  deps: StudioAutoActionsControllerDeps<TMutationTicket>
) {
  const {
    autoActionSet,
    autoActionScope,
    autoActionPlan,
    autoActionBusy,
    pages,
    currentPageId,
    autoActionAbortRef,
    setAutoActionsOpen,
    setAutoActionError,
    setAutoActionStatus,
    setAutoActionSet,
    setAutoActionScope,
    setAutoActionSelectedPageIds,
    setAutoActionPlan,
    setAutoActionBusy,
    setAutoActionProgress,
    saveNamedCheckpoint,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    commitPages,
    setError,
  } = deps;

  async function openAutoActions() {
    setAutoActionsOpen(true);
    setAutoActionError(null);
    setAutoActionStatus(null);
    if (autoActionSet) return;
    try {
      const { createDefaultStudioAutoActionSet } = await import("./studio-auto-actions");
      setAutoActionSet(createDefaultStudioAutoActionSet());
    } catch (cause) {
      setAutoActionError(cause instanceof Error ? cause.message : "기본 Auto Action을 불러오지 못했어요.");
    }
  }

  function changeAutoActionScope(scope: StudioAutoActionScope) {
    setAutoActionError(null);
    setAutoActionStatus(null);
    setAutoActionScope(scope);
  }

  function changeAutoActionSelectedPages(pageIds: readonly string[]) {
    const available = new Set(pages.map((page) => page.id));
    const next = [...new Set(pageIds)].filter((id) => available.has(id));
    if (next.length === 0) return;
    setAutoActionSelectedPageIds(next);
    if (autoActionScope.kind === "selected-pages") {
      setAutoActionScope({ kind: "selected-pages", pageIds: next });
    }
    setAutoActionError(null);
    setAutoActionStatus(null);
  }

  async function importAutoActionJson(json: string, fileName: string) {
    setAutoActionError(null);
    setAutoActionStatus(null);
    try {
      const { importStudioAutoActionSetJson } = await import("./studio-auto-actions");
      const imported = importStudioAutoActionSetJson(json);
      setAutoActionSet(imported);
      setAutoActionStatus(`${fileName.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "Action Set"} 검증 완료`);
    } catch (cause) {
      setAutoActionError(cause instanceof Error ? cause.message : "Action Set을 가져오지 못했어요.");
    }
  }

  async function exportAutoActionJson() {
    if (!autoActionSet) return;
    setAutoActionError(null);
    try {
      const [{ exportStudioAutoActionSetJson }, { downloadBlob }] = await Promise.all([
        import("./studio-auto-actions"),
        import("./export/studio-export"),
      ]);
      const fileStem = sanitizeStudioPublishFileStem(autoActionSet.name, { fallback: "auto-action" }).slice(0, 80);
      downloadBlob(
        new Blob([exportStudioAutoActionSetJson(autoActionSet)], { type: "application/json" }),
        `${fileStem}.toonaction.json`
      );
    } catch (cause) {
      setAutoActionError(cause instanceof Error ? cause.message : "Action Set을 내보내지 못했어요.");
    }
  }

  async function planAutoAction() {
    if (!autoActionSet || autoActionBusy) return;
    setAutoActionError(null);
    setAutoActionStatus(null);
    try {
      const { planStudioAutoActionExecution } = await import("./studio-auto-actions");
      setAutoActionPlan(
        planStudioAutoActionExecution({
          actionSet: autoActionSet,
          pages,
          scope: autoActionScope,
          currentPageId,
        })
      );
    } catch (cause) {
      setAutoActionPlan(null);
      setAutoActionError(cause instanceof Error ? cause.message : "Auto Action 영향을 계산하지 못했어요.");
    }
  }

  async function executeAutoAction() {
    if (
      !autoActionSet ||
      !autoActionPlan ||
      autoActionPlan.failures.length > 0 ||
      autoActionPlan.mutationCount === 0 ||
      autoActionBusy
    ) {
      return;
    }
    // 렌더에 캡처된 busy 는 체크포인트 대기 중의 재클릭을 못 막는다(둘 다 false 를 본다) —
    // abort ref 를 동기 in-flight 가드로 겸용해 첫 await 전에 선점한다(P2 리뷰: 더블클릭이
    // 같은 플랜을 동시에 두 번 실행). 체크포인트 중 취소도 이 덕에 같이 동작한다.
    if (autoActionAbortRef.current) return;
    const controller = new AbortController();
    autoActionAbortRef.current = controller;
    setAutoActionBusy(true);
    setAutoActionError(null);
    setAutoActionStatus(null);
    setAutoActionProgress(null);
    try {
      // 티켓은 반드시 첫 await 앞에서 캡처한다(P1 리뷰). 체크포인트 저장이 느린 동안
      // 원고가 편집되면 documentGeneration 이 갈려 아래 두 canApplyStudioMutation 가드가
      // 실행을 무효화한다 — 체크포인트 뒤에 캡처하면 그 편집 이후의 티켓이라 가드를 둘 다
      // 통과하고, 클릭 시점 pages 로 계산한 결과가 편집을 commitPages 전체 교체로 덮어쓴다.
      const mutationTicket = captureStudioMutationTicket();
      const checkpointName = `Auto Actions 이전 · ${autoActionSet.name}`;
      // saveNamedCheckpoint 는 async 다 — await 없이는 Promise 가 항상 truthy 라 이 안전
      // 가드가 죽은 분기였다(추출하며 수정, 2026-08-27).
      if (!(await saveNamedCheckpoint(checkpointName))) {
        setAutoActionError("안전 복구 지점을 만들지 못해 실행을 중단했어요.");
        return;
      }
      const { executeStudioAutoAction } = await import("./studio-auto-actions");
      if (!canApplyStudioMutation(mutationTicket)) return;
      const result = await executeStudioAutoAction({
        actionSet: autoActionSet,
        pages,
        scope: autoActionScope,
        currentPageId,
        signal: controller.signal,
        onProgress: setAutoActionProgress,
      });
      if (!canApplyStudioMutation(mutationTicket)) return;
      if (result.status === "cancelled") return;
      if (!result.committed || result.failures.length > 0) {
        setAutoActionError("일부 페이지를 안전하게 변환하지 못해 원문을 유지했어요.");
        return;
      }
      if (!commitPages([...result.pages])) {
        setAutoActionError("검토 잠긴 페이지가 포함되어 적용하지 않았어요.");
        return;
      }
      setAutoActionPlan(null);
      setAutoActionStatus(
        `${result.plan.affectedPageIds.length}페이지 · ${result.plan.affectedElementCount}요소를 실행취소 한 단계로 적용했어요.`
      );
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setAutoActionError(cause instanceof Error ? cause.message : "Auto Action 실행에 실패했어요.");
    } finally {
      if (autoActionAbortRef.current === controller) autoActionAbortRef.current = null;
      setAutoActionBusy(false);
      setAutoActionProgress(null);
    }
  }

  function cancelAutoAction() {
    autoActionAbortRef.current?.abort();
  }

  return {
    openAutoActions,
    changeAutoActionScope,
    changeAutoActionSelectedPages,
    importAutoActionJson,
    exportAutoActionJson,
    planAutoAction,
    executeAutoAction,
    cancelAutoAction,
  };
}
