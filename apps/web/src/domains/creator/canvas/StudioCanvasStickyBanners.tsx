import { ImagePlus, Lock, MessageSquare } from "lucide-react";
import { Fragment, Suspense, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { StudioLiveCollaborationQuickControls } from "../live/StudioLiveCollaborationQuickControls";
import { StudioLivePresenceDockConnected } from "../studio-page-lazy-ui";
import { adoptMissingPage } from "../studio-pages";
import { stepStudioViewZoom, type StudioViewRotation } from "../studio-view-controls";
import { StudioViewToolsHud } from "../studio-view-tools-hud-loader";

import { localizeText } from "./studio-canvas-viewport-primitives";

import type { Tool } from "../studio-editor-tool-model";
import type { PageState } from "../studio-page-state";
import type { NavigateFunction } from "react-router-dom";

/**
 * Sticky banners that ride above the scrolling canvas viewport: the asset-drop indicator and hint,
 * the live-presence dock, the optional view-tools HUD host, the comment-pin placement banner, and
 * the hydration / collaboration-unavailable placeholder.
 *
 * A plain factory rather than a component: these are positional children of the scroll viewport and
 * every value they read stays owned by the viewport, so nothing here holds state or effects.
 */
export interface StudioCanvasStickyBannersContext {
  readonly activePage: PageState;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
  readonly closeViewToolWithFocus: (options?: { preferCanvas?: boolean }) => void;
  readonly collaborationDocumentUnavailable: boolean;
  readonly commentPinArmed: boolean;
  readonly commitPages: (nextPages: PageState[], options?: { bypassReviewLock?: boolean; }) => boolean;
  readonly dismissQuickStart: () => void;
  readonly effScale: number;
  readonly fitCanvasToWidth: () => void;
  readonly followingStudioSessionId: string | null;
  readonly navigate: NavigateFunction;
  readonly pages: PageState[];
  readonly remixId: string | null;
  readonly resetView: () => void;
  readonly rotateCanvasView: (direction: "left" | "right") => void;
  readonly setActualPixelView: () => void;
  readonly setCurrentPageId: (value: SetStateAction<string>) => boolean;
  readonly setFollowingStudioSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
  readonly setTeamPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly setTool: Dispatch<SetStateAction<Tool>>;
  readonly setZoom: Dispatch<SetStateAction<number>>;
  readonly sourceHydrationPending: boolean;
  readonly stopStudioCommentPlacementSession: () => void;
  readonly studioCrdtOperationSyncReady: boolean;
  readonly t: (key: string) => string;
  readonly toggleHorizontalCanvasView: () => void;
  readonly viewTool: "zoom" | "rotate" | null;
  readonly workHydrationFailed: boolean;
  readonly workHydrationUnsupportedFormat: boolean;
  readonly workId: string | null;
  readonly zoom: number;
}

export function renderStudioCanvasStickyBanners({
  activePage,
  canvasFlipH,
  canvasRotation,
  closeViewToolWithFocus,
  collaborationDocumentUnavailable,
  commentPinArmed,
  commitPages,
  dismissQuickStart,
  effScale,
  fitCanvasToWidth,
  followingStudioSessionId,
  navigate,
  pages,
  remixId,
  resetView,
  rotateCanvasView,
  setActualPixelView,
  setCurrentPageId,
  setFollowingStudioSessionId,
  setSelectedId,
  setTeamPanelOpen,
  setTool,
  setZoom,
  sourceHydrationPending,
  stopStudioCommentPlacementSession,
  studioCrdtOperationSyncReady,
  t,
  toggleHorizontalCanvasView,
  viewTool,
  workHydrationFailed,
  workHydrationUnsupportedFormat,
  workId,
  zoom,
}: StudioCanvasStickyBannersContext): ReactNode {
  const openTeam = () => {
    dismissQuickStart();
    setTeamPanelOpen(true);
  };
  const toggleFollow = (sessionId: string) => {
    setFollowingStudioSessionId((current) =>
      current === sessionId ? null : sessionId
    );
  };

  return (
    <Fragment>
    <div
      data-studio-asset-drop-indicator
      aria-hidden
      className="pointer-events-none absolute z-[46] size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/15 opacity-0 shadow-[0_0_0_8px_oklch(0.72_0.18_45/0.12)] transition-opacity group-data-[studio-asset-drop-active=true]/asset-drop:opacity-100"
      style={{
        left: "var(--studio-asset-drop-x, -9999px)",
        top: "var(--studio-asset-drop-y, -9999px)",
      }}
    >
      <span className="absolute inset-1 rounded-full border border-dashed border-accent/80" />
    </div>
    <div
      aria-hidden
      className="pointer-events-none sticky top-3 z-[47] flex h-0 justify-center px-3 opacity-0 transition-opacity group-data-[studio-asset-drop-active=true]/asset-drop:opacity-100"
    >
      <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-accent/60 bg-panel/95 px-3 text-[0.68rem] font-bold text-fg shadow-xl backdrop-blur-md">
        <ImagePlus size={14} className="text-accent" aria-hidden />
        {localizeText(t, "놓는 위치에 정확히 배치", "studio.canvas.dropPlaceHint")}
        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.58rem] text-accent">
          {localizeText(t, "복사", "studio.canvas.copyBadge")}
        </span>
      </div>
    </div>
    {/*
      The immersive mobile shell floats the document menubar over a canvas that starts at y=0, so
      `top-2` puts this band inside the menubar's own row and its buttons win elementFromPoint over
      내보내기 옵션 / 프로젝트 센터 / 초안 저장. Clear the floating pill (55px tall) on that shell only;
      the windowed shell already starts the canvas below the chrome.
    */}
    <div className='pointer-events-none sticky top-2 [[data-studio-mobile-immersive="true"]_&]:top-16 z-[56] flex h-0 items-start justify-end gap-1.5 pr-2'>
      <StudioLiveCollaborationQuickControls
        followingSessionId={followingStudioSessionId}
        onOpenTeam={openTeam}
        onToggleFollow={toggleFollow}
      />
      <Suspense fallback={null}>
        <StudioLivePresenceDockConnected
          operationSyncReady={studioCrdtOperationSyncReady}
          followingSessionId={followingStudioSessionId}
          onOpenTeam={openTeam}
          onToggleFollow={toggleFollow}
          onFollowPage={(pageId) => {
            if (pageId === activePage.id) return;
            if (!pages.some((page) => page.id === pageId)) {
              const nextPages = adoptMissingPage(pages, pageId, activePage.canvasH || 1080);
              if (nextPages === pages || !commitPages(nextPages)) return;
            }
            if (!setCurrentPageId(pageId)) return;
            setSelectedId(null);
            setTool("select");
          }}
        />
      </Suspense>
    </div>
    {viewTool ? (
      <div className="pointer-events-none sticky top-2 z-[44] flex h-0 items-start justify-center px-2">
        <Suspense fallback={null}>
          <StudioViewToolsHud
            className="!relative !left-auto !top-auto !max-w-full !translate-x-0"
            mode={viewTool}
            magnification={effScale}
            canZoomIn={stepStudioViewZoom(zoom, 1) !== zoom}
            canZoomOut={stepStudioViewZoom(zoom, -1) !== zoom}
            rotation={canvasRotation}
            flipped={canvasFlipH}
            onZoomIn={() => setZoom((current) => stepStudioViewZoom(current, 1))}
            onZoomOut={() => setZoom((current) => stepStudioViewZoom(current, -1))}
            onFit={fitCanvasToWidth}
            onActual={setActualPixelView}
            onRotateLeft={() => rotateCanvasView("left")}
            onRotateRight={() => rotateCanvasView("right")}
            onToggleFlip={toggleHorizontalCanvasView}
            onReset={resetView}
            onClose={closeViewToolWithFocus}
          />
        </Suspense>
      </div>
    ) : null}
    {commentPinArmed ? (
      <div className="pointer-events-none sticky top-3 z-[45] flex h-0 items-start justify-center px-3">
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex max-w-[min(32rem,calc(100vw-1.5rem))] items-center gap-2 rounded-lg border border-accent/45 bg-panel px-3 py-2 text-xs text-fg shadow-[0_10px_30px_oklch(0.08_0.01_70/0.48)]"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <MessageSquare size={15} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            캔버스에서 댓글을 연결할 위치를 선택하세요.
            <span className="ml-1 text-fg-3">Esc로 취소</span>
          </span>
          <button
            type="button"
            aria-label="댓글 핀 배치 취소"
            onClick={() => {
              stopStudioCommentPlacementSession();
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-card px-3 text-xs font-bold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
          >
            취소
          </button>
        </div>
      </div>
    ) : null}
    {sourceHydrationPending || collaborationDocumentUnavailable ? (
      <div className="sticky left-0 top-0 z-20 grid min-h-[15rem] w-full place-items-center px-6 py-10 text-center lg:min-h-[20rem]">
        <span className="max-w-sm">
          <Lock size={22} className="mx-auto text-warn" aria-hidden />
          <strong className="mt-3 block text-sm font-semibold text-fg">
            {sourceHydrationPending
              ? workHydrationFailed
                ? workHydrationUnsupportedFormat
                  ? "업로드형 작품은 별도 편집기가 필요해요"
                  : remixId
                  ? "리믹스 원본을 열지 못했어요"
                  : "원고를 열지 못했어요"
                : remixId
                  ? "리믹스 원본을 안전하게 불러오는 중"
                  : "원고를 안전하게 불러오는 중"
              : "공동 문서를 열지 못했어요"}
          </strong>
          <span className="mt-1 block text-xs leading-relaxed text-fg-2">
            {sourceHydrationPending
              ? workHydrationFailed
                ? workHydrationUnsupportedFormat
                  ? "원본을 보호하기 위해 컷툰 편집을 잠갔습니다. 업로드 편집 화면으로 이동해 주세요."
                  : "빈 캔버스로 덮어쓰지 않도록 잠금을 유지합니다. 다시 불러와 주세요."
                : "불러오기가 끝날 때까지 편집·저장·가져오기·내보내기를 잠급니다."
              : "이전 계정이나 다른 작품의 캔버스는 표시·내보내지 않습니다."}
          </span>
          {sourceHydrationPending && workHydrationFailed ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (workHydrationUnsupportedFormat && workId) {
                    navigate(`/studio?mode=upload&id=${encodeURIComponent(workId)}`);
                    return;
                  }
                  if (workHydrationUnsupportedFormat && remixId) {
                    navigate(`/create/${encodeURIComponent(remixId)}`);
                    return;
                  }
                  globalThis.location.reload();
                }}
                className="min-h-11 rounded-lg border border-line bg-card px-4 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {workHydrationUnsupportedFormat
                  ? workId
                    ? "업로드 편집기로 이동"
                    : "원본 작품으로 이동"
                  : "다시 불러오기"}
              </button>
              {!workHydrationUnsupportedFormat && (
                <button
                  type="button"
                  onClick={() => {
                    globalThis.location.href = "/studio";
                  }}
                  className="min-h-11 rounded-lg border border-accent/40 bg-accent-soft px-4 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  새 작업 공간으로 이동
                </button>
              )}
            </div>
          ) : null}
        </span>
      </div>
    ) : null}
    </Fragment>
  );
}
