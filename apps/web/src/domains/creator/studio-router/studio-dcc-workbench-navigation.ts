import { useLocation, useNavigate } from "react-router-dom";

import {
  createStudioDccNavigationState,
  studioCanvasHref,
  studioDccHref,
  studioWorkspaceReturnHref,
  type StudioDccWorkbenchMode,
  type StudioWorkspaceRoute,
} from "../studio-workspace-route";

import { useStudioDocumentLayout } from "./studio-document-layout-context";

import type { StudioDccRouteAccess } from "../hybrid-dcc/studio-dcc-route-access";
import type { Dispatch, SetStateAction } from "react";

/**
 * DCC 워크벤치 표면의 내비게이션 절반 — 열기/닫기/모드 전환.
 *
 * 지속성 절반은 `hybrid-dcc/studio-hybrid-dcc-persistence.ts`가, 표면 한정 생명주기는
 * `StudioDccWorkbenchRoute.tsx`가 소유한다. 이 훅은 `StudioDocumentLayout` 아래에서만 동작하며
 * 부모 값(workId, remixId)을 URL 재파싱 없이 레이아웃 컨텍스트에서 읽는다. 접근 판정은
 * 하이드레이션·공유 문서·협업 프런티어 등 편집기 상태 10종에 묶여 있어 아직 StudioPage에
 * 남아 있고, 여기에는 그 결과만 주입된다.
 *
 * 불변식: v1 반환 영수증(`studioWorkspaceReturn`)과 `navigate(-1)` 되돌아가기는 추출 전과
 * 바이트 단위로 동일하다. URL 문법은 바뀌지 않는다.
 */
export interface StudioDccWorkbenchNavigationInput {
  /** 현재 라우트가 DCC 표면인지 — `studioRoute.surface === "dcc"`. */
  readonly dccRouteRequested: boolean;
  /** StudioPage가 판정한 접근 상태. 이 모듈은 판정하지 않고 소비만 한다. */
  readonly dccRouteAccess: StudioDccRouteAccess;
  /** 대기/거부 사유를 라이브 리전으로 알리는 편집기 announcer. */
  readonly onAnnounce: (message: string) => void;
  /**
   * 같은 사유를 화면에도 남기는 상태 알림. announcer는 aria-live 전용이라 보이는 피드백이
   * 없었고, 그래서 권한이 아직 확인되지 않은 동안 3D 도구 버튼이 눌러도 아무 일도 일어나지
   * 않는 것처럼 보였다. 라우트에 진입하지 못하면 `StudioHybridDccRouteGate`도 마운트되지
   * 않으므로, 이 채널이 그 상태를 알리는 유일한 표면이다.
   */
  readonly onBlockedNotice: (message: string) => void;
  /** 열기 직전 포커스 복귀 지점을 잡아 두는 편집기 UI 훅. */
  readonly onCaptureReturnFocus: () => void;
  /** 지속성 절반의 flush. 닫기 경로에서 반드시 먼저 호출된다. */
  readonly onFlushWorkspacePersistence: () => void;
  readonly studioRoute: StudioWorkspaceRoute;
}

export interface StudioDccWorkbenchNavigation {
  readonly closeHybridDccWorkspace: () => void;
  readonly openHybridDccWorkspace: (mode: StudioDccWorkbenchMode) => void;
  readonly setHybridDccOpen: Dispatch<SetStateAction<boolean>>;
  readonly setHybridDccWorkbenchMode: (mode: StudioDccWorkbenchMode) => void;
}

/**
 * 모든 표면에서 사용 가능한 DCC 내비게이션 콜백.
 *
 * 캔버스에서 DCC를 여는 경로가 있어야 하므로 이 훅은 표면 게이팅 없이 호출된다. 표면에
 * 한정된 생명주기(pagehide·거부 자동 종료)는 `StudioDccWorkbenchRoute`가 따로 소유한다.
 */
export function useStudioDccWorkbenchNavigation({
  dccRouteAccess,
  dccRouteRequested,
  onAnnounce,
  onBlockedNotice,
  onCaptureReturnFocus,
  onFlushWorkspacePersistence,
  studioRoute,
}: StudioDccWorkbenchNavigationInput): StudioDccWorkbenchNavigation {
  const navigate = useNavigate();
  const location = useLocation();
  // 부모(StudioDocumentLayout)가 이미 확정한 문서 정체성. 여기서 URL을 다시 파싱하지 않는다.
  // 레이아웃 밖에서 마운트되면 이 훅이 즉시 던져 경계 위반을 조용히 넘기지 않는다.
  const { remixId, workId } = useStudioDocumentLayout();

  const closeHybridDccWorkspace = () => {
    onFlushWorkspacePersistence();
    const returnHref = studioWorkspaceReturnHref(location.state, studioRoute);
    if (returnHref) {
      navigate(-1);
      return;
    }
    navigate(studioCanvasHref({
      remixSourceWorkId: remixId,
      search: location.search,
      workId,
    }), { replace: true });
  };

  const openHybridDccWorkspace = (mode: StudioDccWorkbenchMode) => {
    if (dccRouteRequested) return;
    if (dccRouteAccess !== "allowed") {
      const reason = dccRouteAccess === "pending"
        ? "3D 작업 권한과 원고를 확인하는 중입니다. 잠시 뒤 다시 시도해 주세요."
        : "이 작품에서는 3D 원본을 편집할 권한이 없습니다.";
      onAnnounce(reason);
      onBlockedNotice(reason);
      return;
    }
    onCaptureReturnFocus();
    navigate(studioDccHref({
      mode,
      remixSourceWorkId: remixId,
      search: location.search,
      workId,
    }), {
      state: createStudioDccNavigationState(studioRoute, {
        key: location.key,
        pathname: location.pathname,
        search: location.search,
      }),
    });
  };

  const setHybridDccOpen: Dispatch<SetStateAction<boolean>> = (nextValue) => {
    const shouldOpen = typeof nextValue === "function"
      ? nextValue(dccRouteRequested)
      : nextValue;
    if (shouldOpen === dccRouteRequested) return;
    if (!shouldOpen) {
      closeHybridDccWorkspace();
      return;
    }
    openHybridDccWorkspace("model");
  };

  const setHybridDccWorkbenchMode = (mode: StudioDccWorkbenchMode) => {
    if (!dccRouteRequested || mode === studioRoute.dccMode) return;
    navigate(studioDccHref({
      mode,
      remixSourceWorkId: remixId,
      search: location.search,
      workId,
    }), {
      replace: true,
      state: location.state,
    });
  };

  return {
    closeHybridDccWorkspace,
    openHybridDccWorkspace,
    setHybridDccOpen,
    setHybridDccWorkbenchMode,
  };
}
