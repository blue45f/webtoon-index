import {
  CheckCircle2,
  ClipboardCheck,
  LayoutGrid,
  MessageCircle,
  Smartphone,
  GanttChartSquare,
  UsersRound,
  Video,
} from "lucide-react";
import { memo, type ComponentProps } from "react";

import { studioChromeIconClass, STUDIO_ICON_SIZE, STUDIO_ICON_STROKE } from "./studio-chrome-ui";
import { studioToolButtonClass } from "./studio-panel-ui";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolBeltContentProps, StudioToolBeltHintMap } from "./StudioToolBeltContent";

import { cn } from "@/shared/lib/utils";

export interface StudioToolBeltCreateModeUtilityButtonsProps {
  hints: StudioToolBeltHintMap;
  toolBelt: StudioToolBeltContentProps;
}

type StudioToolBeltHintTargetProps = Omit<
  ComponentProps<typeof StudioToolHintTarget>,
  "preferredSide"
>;

function StudioToolBeltHintTarget(props: StudioToolBeltHintTargetProps) {
  return <StudioToolHintTarget preferredSide="bottom" {...props} />;
}

export const StudioToolBeltCreateModeUtilityButtons = memo(function StudioToolBeltCreateModeUtilityButtons(
  props: StudioToolBeltCreateModeUtilityButtonsProps,
) {
  const { hints, toolBelt } = props;
  const {
    masterEditMode,
    pageEditLocked,
    openStudioCommentCount,
    collaborationDocumentLocked,
    collaborationLockMessage,
    commentsOpen,
    pageReviewOpen,
    continuityOpen,
    sharedDocument,
    setCommentsOpen,
    setContinuityOpen,
    setScrollPreviewOpen,
    setStoryboardGridOpen,
    setTeamPanelOpen,
    setTimelineOpen,
    setPageReviewOpen,
    setTimelapseOpen,
    teamPanelOpen,
    timelineOpen,
  } = toolBelt;

  const toolBtn = (active: boolean) => studioToolButtonClass(active, { dense: true });
  const iconToolBtnTouch = "pointer-coarse:min-w-11 pointer-coarse:justify-center";
  const studioToolIconClass = (props?: Parameters<typeof studioChromeIconClass>[0]) =>
    studioChromeIconClass(props ?? {});

  return (
    <>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <StudioToolBeltHintTarget
        hint={hints.timelapse}
        disabled={masterEditMode}
        unavailableReason={masterEditMode ? "마스터 편집 중에는 타임랩스를 녹화할 수 없습니다." : undefined}
      >
        <button
          type="button"
          onClick={() => setTimelapseOpen(true)}
          disabled={masterEditMode}
          aria-label="타임랩스 녹화"
          className={cn(toolBtn(false), iconToolBtnTouch, "disabled:opacity-40")}
        >
          <Video
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ disabled: masterEditMode })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.storyboard}>
        <button
          type="button"
          onClick={() => setStoryboardGridOpen(true)}
          aria-label="스토리보드 그리드 보기"
          className={cn(toolBtn(false), iconToolBtnTouch)}
        >
          <LayoutGrid
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass()}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={
          pageEditLocked
            ? { ...hints.review, tip: "현재 페이지가 검토 잠금 상태예요." }
            : hints.review
        }
      >
        <button
          type="button"
          onClick={() => setPageReviewOpen(true)}
          aria-pressed={pageReviewOpen}
          aria-label={pageEditLocked ? "페이지 검토, 현재 편집 잠금" : "페이지 검토와 편집 잠금"}
          className={cn(toolBtn(pageReviewOpen || pageEditLocked), iconToolBtnTouch)}
        >
          <ClipboardCheck
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: pageReviewOpen || pageEditLocked })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={{
          id: "toolbelt-comment-inbox",
          title: "문서 댓글",
          description:
            sharedDocument?.access === "view"
              ? "팀 댓글을 읽고 연결된 페이지·컷·요소 위치로 바로 이동합니다."
              : `페이지·컷·요소에 ${sharedDocument ? "팀 댓글을 남기고 서버로 동기화합니다." : "댓글을 남겨 프로젝트와 함께 저장합니다."}`,
          preview: "comment-inbox",
          tip:
            openStudioCommentCount > 0
              ? `아직 해결되지 않은 댓글이 ${openStudioCommentCount}개 있어요.`
              : "캔버스 위치를 지정해 댓글을 남기면 검토자가 맥락을 바로 이해할 수 있어요.",
        }}
        disabled={collaborationDocumentLocked && !sharedDocument?.capabilities.view}
        unavailableReason={
          collaborationDocumentLocked && !sharedDocument?.capabilities.view
            ? collaborationLockMessage()
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => {
            setTeamPanelOpen(false);
            setCommentsOpen((current) => !current);
          }}
          disabled={collaborationDocumentLocked && !sharedDocument?.capabilities.view}
          aria-expanded={commentsOpen}
          aria-haspopup="dialog"
          aria-controls="studio-comments-review-dialog"
          aria-label={`문서 댓글${openStudioCommentCount > 0 ? `, 열림 ${openStudioCommentCount}개` : ""}`}
          className={cn(
            toolBtn(commentsOpen),
            iconToolBtnTouch,
            "relative disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <MessageCircle
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: commentsOpen })}
          />
          {openStudioCommentCount > 0 ? (
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-[0.58rem] font-bold leading-4 text-on-accent"
            >
              {openStudioCommentCount > 99 ? "99+" : openStudioCommentCount}
            </span>
          ) : null}
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.team}>
        <button
          type="button"
          data-studio-team-share-btn="true"
          onClick={() => {
            setCommentsOpen(false);
            setTeamPanelOpen((prev) => !prev);
          }}
          aria-pressed={teamPanelOpen}
          aria-label="팀 작업 공간"
          className={cn(
            toolBtn(teamPanelOpen),
            iconToolBtnTouch,
            "relative gap-1 px-2.5 font-medium text-xs text-accent hover:bg-accent/15 border border-accent/30 rounded-full transition-all shadow-sm"
          )}
        >
          <UsersRound
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ tone: "accent" })}
          />
          <span className="hidden sm:inline font-semibold text-[0.7rem] text-accent">팀 &amp; 실시간 공유</span>
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.continuity}>
        <button
          type="button"
          onClick={() => setContinuityOpen(true)}
          aria-pressed={continuityOpen}
          aria-label="마감·품질 검사"
          className={cn(toolBtn(continuityOpen), iconToolBtnTouch)}
        >
          <CheckCircle2
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: continuityOpen })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={hints.scrollPreview}>
        <button
          type="button"
          onClick={() => setScrollPreviewOpen(true)}
          aria-label="세로 스크롤 미리보기"
          className={cn(toolBtn(false), iconToolBtnTouch)}
        >
          <Smartphone
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass()}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={hints.timeline}
        disabled={masterEditMode}
        unavailableReason={masterEditMode ? "마스터 편집 중에는 타임라인을 열 수 없습니다." : undefined}
      >
        <button
          type="button"
          onClick={() => {
            setTimelineOpen((v) => !v);
          }}
          disabled={masterEditMode}
          aria-pressed={timelineOpen}
          aria-label="다중 레이어 타임라인"
          className={cn(toolBtn(timelineOpen), iconToolBtnTouch, "disabled:opacity-40")}
        >
          <GanttChartSquare
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ active: timelineOpen })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <span className="mx-0.5 hidden h-5 w-px bg-line lg:block" />
    </>
  );
});

