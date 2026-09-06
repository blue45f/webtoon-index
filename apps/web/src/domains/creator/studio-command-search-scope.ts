/**
 * 통합 검색의 범위 — 순수 모듈.
 *
 * 감사 §5.5(UX 감사 2026-09-02)는 전역 검색과 인스펙터 안의 "패널 찾기"가 따로 있어
 * 사용자가 두 검색의 차이를 학습해야 한다고 지적했다. 이제 검색 표면은 하나이고, 진입점이
 * 범위만 골라 준다 — 인스펙터의 찾기는 `inspector`, F1·메뉴·모바일 도크는 `all`.
 *
 * 범위 → 색인 구획 매핑을 컴포넌트 밖에 두는 이유: 다이얼로그 파일은 컴포넌트만 내보내야
 * fast refresh 가 유지되고, 채널(`studio-help-center-channel.ts`)과 다이얼로그가 같은
 * 어휘를 공유해야 하기 때문이다.
 */

import type { StudioSearchKind } from "./studio-search-corpus";

export type StudioCommandSearchScope = "all" | "inspector" | "command" | "help";

export const STUDIO_COMMAND_SEARCH_SCOPES: readonly StudioCommandSearchScope[] =
  Object.freeze(["all", "inspector", "command", "help"]);

/** 범위 → 색인 구획. `all` 은 필터 없음. */
export const STUDIO_COMMAND_SEARCH_SCOPE_KINDS: Readonly<
  Record<StudioCommandSearchScope, readonly StudioSearchKind[] | null>
> = Object.freeze({
  all: null,
  inspector: Object.freeze(["property", "panel"] as const),
  command: Object.freeze(["command"] as const),
  help: Object.freeze(["tutorial"] as const),
});

export const STUDIO_COMMAND_SEARCH_SCOPE_LABELS: Readonly<
  Record<StudioCommandSearchScope, string>
> = Object.freeze({
  all: "전체",
  inspector: "현재 패널",
  command: "명령",
  help: "도움말",
});
