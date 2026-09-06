/**
 * Help 그룹 진입점 채널 — 메뉴 항목(순수 데이터)과 도움말 표면(React) 사이의
 * 단방향 요청 통로.
 *
 * 왜 채널인가. 메인 메뉴 항목은 `StudioMainMenuUiActions` 를 통해 StudioPage 의
 * 상태를 만지는 것이 원칙이지만, Help 그룹이 여는 다섯 표면(현재 도구 도움말·
 * 진단·복구·라이선스·버그 리포트)은 **StudioPage 상태를 하나도 읽지 않는다**.
 * 전부 런타임 프로브와 모듈 스토어에서 값을 직접 읽는다. 그래서 이 다섯 개를
 * StudioPage 의 ui 액션 객체에 얹으면 아무 의미 없는 배선만 늘어난다.
 *
 * 대신 모듈 스코프 채널 하나를 두고, 메뉴는 "열어 달라"를 보내고 호스트가 받는다.
 * 채널은 이벤트를 저장하지 않는다(구독자가 없으면 그냥 버려진다) — 상태가 아니라
 * 요청이기 때문이고, 늦게 마운트된 호스트가 과거 요청을 재생하면 유령 다이얼로그가
 * 열리기 때문이다.
 *
 * 순수 모듈이다. React·DOM·타이머 없음.
 */

import type { StudioCommandSearchScope } from "./studio-command-search-scope";

export type StudioHelpCenterSection =
  | "current-tool"
  | "terminology"
  | "diagnostics"
  | "recovery"
  | "license"
  | "bug-report";

export const STUDIO_HELP_CENTER_SECTIONS: readonly StudioHelpCenterSection[] =
  Object.freeze([
    "current-tool",
    "terminology",
    "diagnostics",
    "recovery",
    "license",
    "bug-report",
  ]);

export interface StudioHelpCenterRequest {
  readonly section: StudioHelpCenterSection;
  /**
   * `current-tool` 섹션이 설명할 명령 id. 메뉴가 열리는 순간의 활성 도구를
   * 그대로 넘긴다 — 다이얼로그가 열린 뒤 도구가 바뀌어도 사용자가 물어본 도구를
   * 계속 설명하는 편이 덜 놀랍다.
   */
  readonly toolCommandId?: string;
}

type Listener<T> = (payload: T) => void;

function createChannel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(payload: T): boolean {
      if (listeners.size === 0) return false;
      for (const listener of [...listeners]) listener(payload);
      return true;
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

export type { StudioCommandSearchScope } from "./studio-command-search-scope";

export interface StudioCommandSearchRequest {
  readonly scope?: StudioCommandSearchScope;
}

const helpCenterChannel = createChannel<StudioHelpCenterRequest>();
const commandSearchChannel = createChannel<StudioCommandSearchRequest>();

/** 도움말 센터를 연다. 구독자가 없으면 `false` — 조용히 삼키지 않는다. */
export function openStudioHelpCenter(request: StudioHelpCenterRequest): boolean {
  return helpCenterChannel.publish(request);
}

export function subscribeStudioHelpCenter(
  listener: Listener<StudioHelpCenterRequest>,
): () => void {
  return helpCenterChannel.subscribe(listener);
}

/** Wave D 의 통합 Command Search 다이얼로그(F1)를 메뉴·인스펙터·모바일 도크에서 연다. */
export function requestStudioCommandSearch(
  request: StudioCommandSearchRequest = {},
): boolean {
  return commandSearchChannel.publish(request);
}

export function subscribeStudioCommandSearchRequests(
  listener: Listener<StudioCommandSearchRequest>,
): () => void {
  return commandSearchChannel.subscribe(listener);
}

/** 테스트 전용 — 마운트된 호스트가 있는지 확인한다. */
export function studioHelpCenterListenerCount(): number {
  return helpCenterChannel.listenerCount();
}

/** 테스트 전용. */
export function studioCommandSearchListenerCount(): number {
  return commandSearchChannel.listenerCount();
}
