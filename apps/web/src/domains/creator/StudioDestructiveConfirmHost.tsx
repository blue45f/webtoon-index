/**
 * 파괴 승인 표면의 마운트 지점 — `setStudioDestructiveConfirmPresenter` seam 에 온캔버스
 * 다이얼로그를 꽂는다.
 *
 * 규율:
 *  - **단일 소유자.** 스튜디오와 /create 라우트가 동시에 살아 있어도 presenter 는 하나다.
 *    두 번째 마운트는 조용히 관망만 하고, 첫 마운트가 사라지면 다음이 이어받는다.
 *  - **직렬 처리.** 승인 요청이 겹치면 큐에 쌓고 하나씩 묻는다. 겹쳤다고 뒤엣것을 조용히
 *    거절하면 사용자는 "버튼을 눌렀는데 아무 일도 없다"를 보게 된다.
 *  - **fail-closed 언마운트.** 호스트가 사라지면 대기 중인 요청을 전부 **거절**로 닫는다.
 *    미해결 프라미스를 남기면 호출부가 영원히 멈춘 채 아무것도 알리지 않는다.
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  setStudioDestructiveConfirmPresenter,
  type StudioDestructiveActionRequest,
} from "./studio-destructive-action-preview";

const StudioDestructiveConfirmDialog = lazy(() =>
  import("./StudioDestructiveConfirmDialog").then((module) => ({
    default: module.StudioDestructiveConfirmDialog,
  })),
);

interface PendingApproval {
  readonly key: number;
  readonly request: StudioDestructiveActionRequest;
  readonly settle: (approved: boolean) => void;
}

/**
 * presenter 소유권 토큰. 가장 마지막에 마운트된 호스트가 소유하고, 물러난 호스트의 정리
 * 코드는 **자기가 아직 소유자일 때만** seam 을 비운다. 라우트 전환에서 새 호스트가 먼저
 * 마운트되고 옛 호스트가 나중에 언마운트되더라도 승인 표면이 사라지지 않는다.
 */
let presenterOwner: symbol | null = null;

function onceOnly(resolve: (approved: boolean) => void): (approved: boolean) => void {
  let settled = false;
  return (approved) => {
    if (settled) return;
    settled = true;
    resolve(approved);
  };
}

export function StudioDestructiveConfirmHost(): ReactElement | null {
  const [queue, setQueue] = useState<readonly PendingApproval[]>([]);
  // 언마운트 정리는 state updater 밖에서 일어나야 한다(StrictMode 이중 호출 시 프라미스를
  // 두 번 닫지 않도록). 그래서 현재 큐를 ref 로 미러링한다.
  const queueRef = useRef<readonly PendingApproval[]>(queue);
  queueRef.current = queue;
  const nextKeyRef = useRef(0);

  useEffect(() => {
    const token = Symbol("studio-destructive-confirm-host");
    presenterOwner = token;
    setStudioDestructiveConfirmPresenter(
      (request) =>
        new Promise<boolean>((resolve) => {
          nextKeyRef.current += 1;
          const key = nextKeyRef.current;
          setQueue((current) => [
            ...current,
            { key, request, settle: onceOnly(resolve) },
          ]);
        }),
    );
    return () => {
      if (presenterOwner === token) {
        setStudioDestructiveConfirmPresenter(null);
        presenterOwner = null;
      }
      // 이 호스트로 들어온 대기 요청은 소유권과 무관하게 닫는다 — 미해결 프라미스가
      // 남으면 호출부가 조용히 멈춘다.
      for (const pending of queueRef.current) pending.settle(false);
      setQueue([]);
    };
  }, []);

  const answer = useCallback((key: number, approved: boolean) => {
    setQueue((current) => {
      const pending = current.find((entry) => entry.key === key);
      pending?.settle(approved);
      return current.filter((entry) => entry.key !== key);
    });
  }, []);

  const active = queue[0] ?? null;
  if (!active) return null;

  return (
    <Suspense fallback={null}>
      <StudioDestructiveConfirmDialog
        key={active.key}
        request={active.request}
        queuedCount={queue.length - 1}
        onConfirm={() => answer(active.key, true)}
        onCancel={() => answer(active.key, false)}
      />
    </Suspense>
  );
}
