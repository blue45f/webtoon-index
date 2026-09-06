/**
 * 보조 창을 열지 못했을 때 "무엇을 하라"고 말할지 고르는 한 곳.
 *
 * 기존 문구는 언제나 "브라우저에서 팝업을 허용해 주세요" 였다. 일반 브라우저에서는 맞는
 * 말이지만, 카카오톡·인스타그램·네이버앱 같은 인앱 브라우저에는 팝업 설정 화면 자체가 없다.
 * 실행할 수 없는 지시를 주면 사용자는 같은 버튼을 반복해서 누르게 된다. 그래서 환경을 먼저
 * 판별하고, 인앱 브라우저에는 실제로 통하는 유일한 방법 — 기본 브라우저로 나가기 — 을 준다.
 *
 * 순수 모듈이다. 무거운 companion 프로토콜 청크를 끌어오지 않으므로 동기 예약 경로(런타임)와
 * 지연 로딩된 프로토콜 경로가 같은 문구를 공유할 수 있다.
 */

import {
  diagnoseStudioInAppBrowserFromGlobals,
  type StudioInAppBrowserDiagnosis,
} from "@/src/compat/in-app-browser";

export interface StudioCompanionPopupGuidance {
  /** 인앱 브라우저를 벗어나는 링크. 눌러서 바로 나갈 수 있을 때만 존재한다. */
  readonly escapeHref: string | null;
  /** i18n 키 — 로케일 팩이 아직 없으면 `text` 가 그대로 쓰인다. */
  readonly key: string;
  readonly text: string;
}

const POPUP_BLOCKED: StudioCompanionPopupGuidance = Object.freeze({
  escapeHref: null,
  key: "studio.toolsCompanion.open.popupBlocked",
  text: "팝업이 차단됐습니다. 브라우저에서 팝업을 허용해 주세요.",
});

/** 판별 결과만 받아 문구를 고르는 순수 함수 — 테스트가 전역을 흉내 내지 않아도 된다. */
export function studioCompanionPopupGuidanceFor(
  diagnosis: StudioInAppBrowserDiagnosis,
): StudioCompanionPopupGuidance {
  if (!diagnosis.inApp) return POPUP_BLOCKED;
  const app = diagnosis.name === null ? "인앱 브라우저" : `${diagnosis.name} 인앱 브라우저`;
  // 문구는 링크 없이도 완결이어야 한다. 이 안내가 도착하는 곳(스튜디오 announce 파이프라인)은
  // 문자열만 받는 aria-live 알림이라 링크를 그릴 수 없다 — "기본 브라우저로 여세요"까지만
  // 말하고 방법을 빼면 사용자는 같은 버튼을 다시 누르는 것 말고 할 수 있는 게 없다.
  const how = diagnosis.escapeHint ?? "기본 브라우저로 열어 주세요.";
  return Object.freeze({
    // 링크는 그릴 수 있는 화면을 위해 실어 보내되, 문구가 그것에 의존하지는 않는다.
    escapeHref: diagnosis.escapeHref,
    key: diagnosis.escapeHref === null
      ? "studio.toolsCompanion.open.inAppBrowserManual"
      : "studio.toolsCompanion.open.inAppBrowserEscapeLink",
    text: `${app}에서는 새 창을 열 수 없어요. ${how}`,
  });
}

/** 현재 환경을 판별해 문구를 고른다. */
export function studioCompanionPopupGuidance(
  scope: typeof globalThis = globalThis,
): StudioCompanionPopupGuidance {
  return studioCompanionPopupGuidanceFor(diagnoseStudioInAppBrowserFromGlobals(scope));
}
