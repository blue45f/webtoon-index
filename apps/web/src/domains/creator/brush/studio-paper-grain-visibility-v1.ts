/**
 * 종이 결 표시 여부의 **단일 권위** (2026-08-21 paper substrate wave, 5단계).
 *
 * 배경.
 * `PageState.paperGrainVisible`은 optional이고 모델 주석(`studio-page-state.ts:23-27`)과 prop
 * 문서(`StudioInspectorCanvasControls.tsx:33`)는 "미설정 = true"라고 약속했는데, 실제 두 호출부
 * (`StudioCuttoonEditorView.tsx`, `canvas/StudioCanvasViewport.tsx`)는 `=== true`로 읽었다.
 * 결과: **아티스트가 종이를 골라도 화면에 아무 일도 일어나지 않았다.**
 *
 * 왜 무조건 `!== false`로 뒤집지 않았는가 — 이 판단이 이 모듈의 존재 이유다.
 * `!== false`는 이 필드가 없는 **모든 기존 페이지**를 다시 칠한다. 종이를 고른 적조차 없는
 * 완성된 원고까지 배경이 바뀐다 — 이 프로젝트가 피하려는 소급 변경 부류다.
 * 그래서 규약은 두 단계다.
 *   1. 명시 boolean이 있으면 그것이 이긴다(아티스트가 토글한 값).
 *   2. 없으면 **페이지가 명시적으로 종이를 들고 있을 때만** 보인다.
 * 이러면 "종이를 고르면 즉시 보인다"(실제 결함)는 고쳐지고, 한 번도 종이를 고르지 않은
 * 레거시 문서는 픽셀 하나 안 바뀐다.
 *
 * 무조건 기본 ON을 원하면 `paperSurfacePresent` 분기 한 줄만 `true`로 바꾸면 된다 —
 * 제품 결정이지 배선 결정이 아니라서 여기 한 곳에 모아 두었다.
 */

export interface StudioPaperGrainVisibilityPageV1 {
  readonly paperGrainVisible?: unknown;
  readonly paperSurface?: unknown;
}

/**
 * 이 페이지가 **명시적으로** 종이 한 장을 들고 있는가.
 * 스키마상 `paperSurface`는 `{kind, seed}` 객체다. null/undefined/비객체는 "고른 적 없음"이다.
 */
export function studioPageHasAuthoredPaperSurfaceV1(
  page: StudioPaperGrainVisibilityPageV1 | null | undefined,
): boolean {
  const surface = page?.paperSurface;
  return typeof surface === "object" && surface !== null;
}

/** 배경 종이 결을 칠할 것인가. 두 호출부(스테이지·뷰포트)가 반드시 이 함수를 통해야 한다. */
export function resolveStudioPaperGrainVisibleV1(
  page: StudioPaperGrainVisibilityPageV1 | null | undefined,
): boolean {
  if (typeof page?.paperGrainVisible === "boolean") return page.paperGrainVisible;
  return studioPageHasAuthoredPaperSurfaceV1(page);
}
