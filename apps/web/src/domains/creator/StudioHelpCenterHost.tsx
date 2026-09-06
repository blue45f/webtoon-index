/**
 * 도움말 센터 호스트 — 메뉴 요청을 받아 다이얼로그를 띄운다.
 *
 * StudioPage 루트에 한 번 마운트된다. 다이얼로그 본체는 lazy 라서, 도움말을 한 번도
 * 열지 않은 세션은 진단·라이선스·용어 사전 코드를 지불하지 않는다.
 *
 * 마운트 시 세션 오류 저널을 설치한다 — 버그 리포트가 "이 세션에서 무슨 일이
 * 있었나"에 답하려면 사용자가 도움말을 열기 **전에** 기록이 시작돼야 한다.
 *
 * 같은 이유로 다이얼로그 포커스 복귀 그물도 여기서 건다. 이 호스트는 StudioPage 루트에
 * 딱 한 번 마운트되는 유일한 상시 호스트라서, "복원을 한 곳으로 모은다"는 계약이
 * 걸릴 자리가 여기다. 도움말 센터 자신뿐 아니라 통합 검색처럼 body 로 포털되는 다른
 * 모달까지 같은 그물이 받는다 — 다이얼로그마다 따로 기억하게 두면 다음 다이얼로그가
 * 또 빠뜨린다(`studio-dialog-focus-return.ts` 머리말의 실측 근거).
 */

import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { installStudioDialogFocusReturn } from "./studio-dialog-focus-return";
import { installStudioErrorJournal } from "./studio-error-journal";
import { subscribeStudioHelpCenter } from "./studio-help-center-channel";

import type { StudioHelpCenterSection } from "./studio-help-center-channel";

const StudioHelpCenterDialog = lazy(() =>
  import("./StudioHelpCenterDialog").then((module) => ({
    default: module.StudioHelpCenterDialog,
  })),
);

interface HelpCenterState {
  readonly open: boolean;
  readonly section: StudioHelpCenterSection;
  readonly toolCommandId: string | null;
}

const CLOSED: HelpCenterState = {
  open: false,
  section: "diagnostics",
  toolCommandId: null,
};

export function StudioHelpCenterHost() {
  const [state, setState] = useState<HelpCenterState>(CLOSED);

  useEffect(() => installStudioErrorJournal(), []);
  useEffect(() => installStudioDialogFocusReturn(), []);

  useEffect(
    () =>
      subscribeStudioHelpCenter((request) => {
        setState({
          open: true,
          section: request.section,
          toolCommandId: request.toolCommandId ?? null,
        });
      }),
    [],
  );

  const close = useCallback(() => setState(CLOSED), []);
  const changeSection = useCallback(
    (section: StudioHelpCenterSection) =>
      setState((current) => ({ ...current, section })),
    [],
  );

  if (!state.open) return null;

  return (
    <Suspense fallback={null}>
      <StudioHelpCenterDialog
        open
        section={state.section}
        toolCommandId={state.toolCommandId}
        onSectionChange={changeSection}
        onClose={close}
      />
    </Suspense>
  );
}
