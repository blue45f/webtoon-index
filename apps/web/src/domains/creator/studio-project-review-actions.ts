/**
 * 검수·미리보기 진입점 계약 (선언 전용 — React/DOM 없음).
 *
 * 아래 7종은 트리거가 툴벨트(`StudioToolBelt`)에만 있었는데, 벨트 호스트가 데스크톱
 * `lg:hidden` + 모바일 몰입 `max-lg:hidden`으로 1600 / 900 / 430 전 구간에서 `display:none`
 * 이라 어디서도 클릭할 수 없었다(`docs/perf/heavy-feature-findings.md` §4-1).
 * 지금은 상시 보이는 "프로젝트 센터" 시트가 정본 진입점을 소유한다.
 *
 * 렌더 계층(`StudioProjectReviewActions.tsx`)과 분리해 두면 도달성 계약 테스트가
 * jsdom 없이도 이 목록을 읽을 수 있다.
 */

/** 벨트 전용이었다가 프로젝트 시트로 승격된 액션 id. */
export const STUDIO_PROJECT_REVIEW_ACTION_IDS = [
  "anim-timeline",
  "timelapse",
  "storyboard-grid",
  "scroll-preview",
  "continuity",
  "comments",
  "page-review",
] as const;

export type StudioProjectReviewActionId =
  (typeof STUDIO_PROJECT_REVIEW_ACTION_IDS)[number];

/** 상태 변이는 전부 호출자(StudioPage)가 소유한다 — 여기서는 의도만 선언한다. */
export interface StudioProjectReviewActionHandlers {
  /** 다중 레이어 타임라인 — 열림 토글(벨트와 동일 계약). */
  toggleAnimationTimeline: () => void;
  openTimelapse: () => void;
  openStoryboardGrid: () => void;
  openScrollPreview: () => void;
  openContinuityCheck: () => void;
  /** 문서 댓글 — 열림 토글(벨트와 동일 계약). */
  toggleDocumentComments: () => void;
  openPageReview: () => void;
}
