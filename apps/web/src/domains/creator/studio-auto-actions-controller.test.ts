import { describe, expect, it } from "vitest";

import { createStudioAutoActionsController } from "./studio-auto-actions-controller";

import type { StudioAutoActionPlan, StudioAutoActionSet } from "./studio-auto-actions";
import type { StudioAutoActionsControllerDeps } from "./studio-auto-actions-controller";

/**
 * P2 리뷰 회귀: busy 는 렌더에 캡처된 상태라 `saveNamedCheckpoint` 대기 중의 재클릭을 막지
 * 못했다 — 두 호출이 모두 가드를 통과해 같은 플랜을 동시에 두 번 실행했다. abort ref 가
 * 첫 await 전에 동기 in-flight 가드로 선점하는지를 고정한다.
 *
 * P1 리뷰 회귀: 뮤테이션 티켓을 체크포인트 await 뒤에 캡처하면, 체크포인트 저장이 느린
 * 동안 들어온 편집 이후의 티켓이라 canApplyStudioMutation 가드를 둘 다 통과하고, 클릭
 * 시점 pages 로 계산한 결과가 그 편집을 commitPages 전체 교체로 덮어쓴다. 티켓이 첫
 * await 앞에서 캡처되고, 체크포인트 중 편집이 실행을 무효화하는지를 고정한다.
 */
function makeDeps(): {
  deps: StudioAutoActionsControllerDeps<number>;
  checkpointCalls: string[];
  ticketCaptures: number[];
  resolveCheckpoint: (ok: boolean) => void;
  bumpDocumentGeneration: () => void;
  committed: unknown[];
  errors: (string | null)[];
} {
  const checkpointCalls: string[] = [];
  const ticketCaptures: number[] = [];
  const committed: unknown[] = [];
  const errors: (string | null)[] = [];
  let documentGeneration = 1;
  let resolveCheckpoint: (ok: boolean) => void = () => {};
  const deps: StudioAutoActionsControllerDeps<number> = {
    autoActionSet: { name: "재진입 시험" } as StudioAutoActionSet,
    autoActionScope: { kind: "current" },
    autoActionPlan: {
      failures: [],
      mutationCount: 2,
    } as unknown as StudioAutoActionPlan,
    autoActionBusy: false,
    pages: [],
    currentPageId: "page-1",
    autoActionAbortRef: { current: null },
    setAutoActionsOpen: () => {},
    setAutoActionError: (message) => {
      errors.push(message);
    },
    setAutoActionStatus: () => {},
    setAutoActionSet: () => {},
    setAutoActionScope: () => {},
    setAutoActionSelectedPageIds: () => {},
    setAutoActionPlan: () => {},
    setAutoActionBusy: () => {},
    setAutoActionProgress: () => {},
    saveNamedCheckpoint: (name) => {
      checkpointCalls.push(name);
      return new Promise<boolean>((resolve) => {
        resolveCheckpoint = resolve;
      });
    },
    captureStudioMutationTicket: () => {
      ticketCaptures.push(documentGeneration);
      return documentGeneration;
    },
    canApplyStudioMutation: (ticket) => ticket === documentGeneration,
    commitPages: (next) => {
      committed.push(next);
      return true;
    },
    setError: () => {},
  };
  return {
    deps,
    checkpointCalls,
    ticketCaptures,
    resolveCheckpoint: (ok) => resolveCheckpoint(ok),
    bumpDocumentGeneration: () => {
      documentGeneration += 1;
    },
    committed,
    errors,
  };
}

describe("createStudioAutoActionsController — executeAutoAction 재진입 가드", () => {
  it("blocks a second Execute while the safety checkpoint is still pending", async () => {
    const { deps, checkpointCalls, resolveCheckpoint, errors } = makeDeps();
    const controller = createStudioAutoActionsController(deps);

    const first = controller.executeAutoAction();
    // 체크포인트 대기 중의 더블클릭 — 같은 렌더의 컨트롤러를 다시 부른다.
    await controller.executeAutoAction();
    expect(checkpointCalls).toHaveLength(1);
    // 첫 await 전에 abort ref 가 선점되어 체크포인트 중 취소도 가능해진다.
    expect(deps.autoActionAbortRef.current).not.toBeNull();

    resolveCheckpoint(false);
    await first;
    expect(errors).toContain("안전 복구 지점을 만들지 못해 실행을 중단했어요.");
    // finally 정리 후에는 다음 실행이 다시 허용된다.
    expect(deps.autoActionAbortRef.current).toBeNull();
    const third = controller.executeAutoAction();
    expect(checkpointCalls).toHaveLength(2);
    resolveCheckpoint(false);
    await third;
  });

  it("captures the mutation ticket before the checkpoint await and drops the run when the document changes while it is pending", async () => {
    const { deps, ticketCaptures, resolveCheckpoint, bumpDocumentGeneration, committed } =
      makeDeps();
    const controller = createStudioAutoActionsController(deps);

    const run = controller.executeAutoAction();
    // 티켓은 첫 await(체크포인트) 앞에서 동기로 캡처된다 — 체크포인트 뒤 캡처는 대기 중
    // 편집 이후의 세대를 담아 가드가 사문화된다.
    expect(ticketCaptures).toEqual([1]);

    // 체크포인트 저장이 느린 동안 사용자가 원고를 편집한다.
    bumpDocumentGeneration();
    resolveCheckpoint(true);
    await run;

    // 티켓 세대가 갈렸으니 실행은 조용히 무효화되고, 클릭 시점 pages 로 계산한 결과가
    // 편집을 덮어쓰지 않는다.
    expect(committed).toEqual([]);
    // finally 정리는 그대로 동작한다.
    expect(deps.autoActionAbortRef.current).toBeNull();
  });
});
