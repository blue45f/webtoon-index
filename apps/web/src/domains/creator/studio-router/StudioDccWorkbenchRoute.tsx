import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import type { StudioDccRouteAccess } from "../hybrid-dcc/studio-dcc-route-access";

/**
 * DCC 워크벤치 표면을 문서 레이아웃 아래의 자식 라우트로 세우는 컴포넌트.
 *
 * 지속성 절반은 `hybrid-dcc/studio-hybrid-dcc-persistence.ts`, 내비게이션 절반은
 * `studio-dcc-workbench-navigation.ts`가 소유한다. 이 파일은 표면에 한정된 라우트 계약만
 * 갖는다 — 문서 이탈 flush, 접근 거부 시 탈출.
 */

interface StudioDccWorkbenchSurfaceProps {
  readonly dccRouteAccess: StudioDccRouteAccess;
  readonly onCloseWorkbench: () => void;
  readonly onFlushWorkspacePersistence: () => void;
}

/**
 * DCC 표면에 한정된 생명주기. 라우트가 DCC일 때만 마운트되므로 게이팅 조건이 마운트 자체다.
 *
 * 여기서 `null`을 렌더하는 것은 의도다 — DCC 패널 자체는 편집기 트리 안쪽 lazy 서브트리가
 * 소유하고, 이 노드는 그 표면의 라우트 계약만 갖는다.
 */
function StudioDccWorkbenchSurface({
  dccRouteAccess,
  onCloseWorkbench,
  onFlushWorkspacePersistence,
}: StudioDccWorkbenchSurfaceProps) {
  const flushBeforeDocumentExit = useEffectEvent(onFlushWorkspacePersistence);
  const closeDeniedWorkbench = useEffectEvent(onCloseWorkbench);
  useEffect(() => {
    const handlePageHide = () => flushBeforeDocumentExit();
    globalThis.addEventListener("pagehide", handlePageHide);
    return () => globalThis.removeEventListener("pagehide", handlePageHide);
  }, []);
  useEffect(() => {
    if (dccRouteAccess !== "denied") return;
    closeDeniedWorkbench();
  }, [dccRouteAccess]);
  return null;
}

export interface StudioDccWorkbenchRouteProps {
  /** 편집기 표면. 표면 전환은 이 래퍼를 재마운트하지 않는다. */
  readonly children: ReactNode;
  readonly dccRouteAccess: StudioDccRouteAccess;
  readonly dccRouteRequested: boolean;
  readonly onCloseWorkbench: () => void;
  readonly onFlushWorkspacePersistence: () => void;
}

/**
 * 문서 레이아웃 아래에 걸리는 DCC 워크벤치 라우트.
 *
 * 래퍼 자체는 모든 표면에서 마운트된 채로 남아 캔버스↔DCC 전환을 가로지르는 DCC 런타임을
 * 보존한다(문서 정체성 하나당 한 번만 재마운트된다). 표면 한정 생명주기는 `dccRouteRequested`
 * 가 참일 때만 자식으로 마운트된다.
 *
 * 표면을 떠날 때의 flush는 래퍼가 소유한다. 마운트 해제 정리로 대체하면 문서 정체성 회전에서도
 * 발화해 추출 전 계약을 넓히므로, 전이 ref를 그대로 유지한다.
 */
export function StudioDccWorkbenchRoute({
  children,
  dccRouteAccess,
  dccRouteRequested,
  onCloseWorkbench,
  onFlushWorkspacePersistence,
}: StudioDccWorkbenchRouteProps) {
  const flushOnLeave = useEffectEvent(onFlushWorkspacePersistence);
  const previousDccRouteRequestedRef = useRef(dccRouteRequested);
  useEffect(() => {
    const previouslyRequested = previousDccRouteRequestedRef.current;
    previousDccRouteRequestedRef.current = dccRouteRequested;
    if (previouslyRequested && !dccRouteRequested) {
      flushOnLeave();
    }
  }, [dccRouteRequested]);

  return (
    <>
      {dccRouteRequested ? (
        <StudioDccWorkbenchSurface
          dccRouteAccess={dccRouteAccess}
          onCloseWorkbench={onCloseWorkbench}
          onFlushWorkspacePersistence={onFlushWorkspacePersistence}
        />
      ) : null}
      {children}
    </>
  );
}
