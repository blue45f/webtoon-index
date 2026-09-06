/**
 * Studio 검수·미리보기 진입점 — "프로젝트 센터" 시트의 한 섹션.
 *
 * 왜 이 파일이 있는가(2026-08-08 회귀 복구):
 * 아래 7개 기능은 트리거가 툴벨트(`StudioToolBelt`)에만 있었다. 그런데 벨트 호스트는
 * 데스크톱에서 `lg:hidden`, 모바일 몰입 모드에서 `max-lg:hidden`이라 1600 / 900 / 430
 * 어느 폭에서도 `display:none`이었다 — 즉 DOM에는 있지만 포인터로 도달할 수 없었다
 * (`docs/perf/heavy-feature-findings.md` §4-1: 가시 컨트롤 336개 전수 스윕에서 미발견).
 *
 * 벨트의 반응형 의도(데스크톱은 메뉴바·레일이 발견성을 소유, 모바일 몰입은 썸 독이 소유)는
 * 그대로 둔다. 대신 상시 보이는 "프로젝트 센터" 시트에 정본 진입점을 둔다. 이 시트에는
 * 이미 애니매틱·제작 인사이트·게시 사전검사 같은 검수 표면이 모여 있어 정보구조가 맞는다.
 *
 * 순수 프레젠테이션: 상태 변이는 전부 호출자(StudioPage)가 소유한다.
 */
import {
  CheckCircle2,
  ClipboardCheck,
  GanttChartSquare,
  LayoutGrid,
  MessageCircle,
  Smartphone,
  Video,
} from "lucide-react";

import type {
  StudioProjectReviewActionHandlers,
  StudioProjectReviewActionId,
} from "./studio-project-review-actions";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioProjectReviewActionsProps {
  /** 마스터 편집 중에는 히스토리 스크러빙 기반 표면을 열 수 없다. */
  masterEditMode: boolean;
  /** 현재 페이지가 검토 잠금 상태인지 — 라벨과 강조 상태에 쓰인다. */
  pageEditLocked: boolean;
  /** 공동 문서가 잠겨 댓글조차 읽을 수 없는 상태. */
  commentsLocked: boolean;
  /** 잠금 사유 카피. `commentsLocked`일 때만 노출된다. */
  commentsLockedReason: string;
  /** 미해결 댓글 수 — 0이면 배지를 숨긴다. */
  openCommentCount: number;
  handlers: StudioProjectReviewActionHandlers;
}

const MASTER_EDIT_REASON = "마스터 편집을 종료한 뒤 사용할 수 있어요.";

const ACTION_BUTTON_CLASS = buttonClass({
  size: "sm",
  variant: "quiet",
  className:
    "min-h-11 shrink-0 whitespace-nowrap gap-1.5 disabled:cursor-not-allowed disabled:opacity-50",
});

interface ReviewActionSpec {
  readonly id: StudioProjectReviewActionId;
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly icon: typeof Video;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly badge?: number;
  readonly onSelect: () => void;
}

export function StudioProjectReviewActions({
  masterEditMode,
  pageEditLocked,
  commentsLocked,
  commentsLockedReason,
  openCommentCount,
  handlers,
}: StudioProjectReviewActionsProps) {
  const actions: readonly ReviewActionSpec[] = [
    {
      id: "anim-timeline",
      label: "다중 레이어 타임라인",
      ariaLabel: "다중 레이어 타임라인",
      title: "레이어별 키프레임과 재생 구간을 시간축에서 편집합니다.",
      icon: GanttChartSquare,
      disabled: masterEditMode,
      disabledReason: MASTER_EDIT_REASON,
      onSelect: handlers.toggleAnimationTimeline,
    },
    {
      id: "timelapse",
      label: "타임랩스 녹화",
      ariaLabel: "타임랩스 녹화",
      title: "그리기 과정을 기록해 작업 흐름을 타임랩스 영상으로 만듭니다.",
      icon: Video,
      disabled: masterEditMode,
      disabledReason: MASTER_EDIT_REASON,
      onSelect: handlers.openTimelapse,
    },
    {
      id: "storyboard-grid",
      label: "스토리보드 그리드",
      ariaLabel: "스토리보드 그리드 보기",
      title: "모든 페이지를 격자로 펼쳐 컷 흐름, 밀도와 장면 전환을 한눈에 비교합니다.",
      icon: LayoutGrid,
      disabled: false,
      onSelect: handlers.openStoryboardGrid,
    },
    {
      id: "scroll-preview",
      label: "세로 스크롤 미리보기",
      ariaLabel: "세로 스크롤 미리보기",
      title: "페이지를 모바일 독자 폭으로 이어 붙여 컷 간격과 읽기 흐름을 확인합니다.",
      icon: Smartphone,
      disabled: false,
      onSelect: handlers.openScrollPreview,
    },
    {
      id: "continuity",
      label: "마감·품질 검사",
      ariaLabel: "마감·품질 검사",
      title: "문서 무결성·이미지 해상도·레이어·식자·컷 간격·검토 상태와 이야기 연속성을 한 번에 검사합니다.",
      icon: CheckCircle2,
      disabled: false,
      onSelect: handlers.openContinuityCheck,
    },
    {
      id: "comments",
      label: "문서 댓글",
      ariaLabel:
        openCommentCount > 0 ? `문서 댓글, 열림 ${openCommentCount}개` : "문서 댓글",
      title: "페이지·컷·요소에 댓글을 남기고 검토자와 해결 상태를 함께 관리합니다.",
      icon: MessageCircle,
      disabled: commentsLocked,
      disabledReason: commentsLockedReason,
      badge: openCommentCount,
      onSelect: handlers.toggleDocumentComments,
    },
    {
      id: "page-review",
      label: pageEditLocked ? "페이지 검토 (편집 잠김)" : "페이지 검토",
      ariaLabel: pageEditLocked
        ? "페이지 검토, 현재 편집 잠금"
        : "페이지 검토와 편집 잠금",
      title: "페이지별 승인 상태·담당자·메모를 관리하고 검토 중 편집을 잠급니다.",
      icon: ClipboardCheck,
      disabled: false,
      onSelect: handlers.openPageReview,
    },
  ];

  return (
    <>
      <div className="col-span-2 border-t border-line/60 px-2 pb-1 pt-2 sm:col-span-3">
        <span className="block text-xs font-bold text-fg">검수 · 미리보기</span>
        <span className="mt-0.5 block text-[0.65rem] text-fg-3">
          타임라인 · 스토리보드 · 독자 시점 · 검토와 댓글
        </span>
      </div>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            data-studio-project-action={action.id}
            onClick={action.onSelect}
            disabled={action.disabled}
            aria-label={action.ariaLabel}
            title={
              action.disabled && action.disabledReason
                ? action.disabledReason
                : action.title
            }
            className={cn(ACTION_BUTTON_CLASS, "relative")}
          >
            <Icon size={14} aria-hidden /> {action.label}
            {action.badge && action.badge > 0 ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-[0.65rem] font-bold text-accent">
                {action.badge > 99 ? "99+" : action.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
