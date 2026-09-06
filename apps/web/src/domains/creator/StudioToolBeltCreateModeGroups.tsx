import {
  Boxes,
  ChevronDown,
  Eraser,
  Film,
  Folder,
  Mountain,
  MousePointer2,
  PaintBucket,
  Plus,
  Pencil,
  Palette,
  UsersRound,
  PersonStanding,
  PictureInPicture2,
  Sparkles,
  SquareSplitHorizontal,
  WandSparkles,
} from "lucide-react";
import { memo, Suspense, type ComponentProps } from "react";

import {
  StudioFloatingToolPopover,
  StudioToolbarCluster,
  StudioToolbarDivider,
  studioChromeIconClass,
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
} from "./studio-chrome-ui";
import {
  preloadStudioAssetMenuPanel,
  preloadStudioPaletteLibraryPanel,
  preloadStudioReferencePanel,
} from "./studio-page-lazy-ui";
import { studioToolButtonClass } from "./studio-panel-ui";
import {
  LazyStudioAiToolPopoverBody,
  LazyStudioAssetToolPopoverBody,
  LazyStudioSceneToolPopoverBody,
  LazyStudioStyleToolPopoverBody,
  preloadStudioAiToolPopoverBody,
  preloadStudioAssetToolPopoverBody,
  preloadStudioSceneToolPopoverBody,
  preloadStudioStyleToolPopoverBody,
} from "./studio-tool-belt-lazy-ui";
import { studioUiDensityAllows } from "./studio-ui-density";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { StudioToolBeltCreateModeInsertTools } from "./StudioToolBeltCreateModeInsertTools";
import { StudioToolBeltCreateModeUtilityButtons } from "./StudioToolBeltCreateModeUtilityButtons";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolBeltContentProps, StudioToolBeltHintMap } from "./StudioToolBeltContent";

import { cn } from "@/shared/lib/utils";

type StudioToolBeltHintTargetProps = Omit<
  ComponentProps<typeof StudioToolHintTarget>,
  "preferredSide"
>;

function StudioToolBeltHintTarget(props: StudioToolBeltHintTargetProps) {
  return <StudioToolHintTarget preferredSide="bottom" {...props} />;
}

const groupPopoverClass = (width: "w-72" | "w-80") =>
  cn(
    "fixed inset-x-2 top-[6.5rem] z-[70] max-h-[min(78dvh,36rem)] w-auto overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-2xl lg:inset-x-auto lg:left-3 lg:w-auto lg:max-w-[min(28rem,calc(100vw-1.5rem))]",
    width === "w-72" ? "lg:w-72" : "lg:w-80"
  );

export interface StudioToolBeltCreateModeGroupsProps {
  hints: StudioToolBeltHintMap;
  studioCanvasImageAccept: string;
  toolBelt: StudioToolBeltContentProps;
}

export const StudioToolBeltCreateModeGroups = memo(function StudioToolBeltCreateModeGroups(
  props: StudioToolBeltCreateModeGroupsProps,
) {
  const { hints, studioCanvasImageAccept, toolBelt } = props;
  const {
    activeSurfaceReviewLocked,
    activeToolbarGroup,
    advancedFillActive,
    advancedFillUnsupportedReason,
    bg3dOpen,
    drawMode,
    frameAnimOpen,
    frameAnimTargetId,
    menuRef,
    mannequinPoserOpen,
    poserVrmOpen,
    characterShaperOpen,
    referencePanelOpen,
    selected,
    stableHandlers,
    tool,
    uiDensityMode,
    setBg3dOpen,
    setMannequinPoserOpen,
    setMenu,
    setPoserVrmOpen,
    setCharacterShaperOpen,
    setReferencePanelOpen,
  } = toolBelt;

  const {
    activatePrimaryCanvasTool,
    addDiagonalSplit,
    addFrame,
    openFrameAnimationForSelected,
    toggleAdvancedFill,
    toggleSelectedFrameDiagonal,
  } = stableHandlers;

  const studioToolIconClass = (nextProps?: Parameters<typeof studioChromeIconClass>[0]) =>
    studioChromeIconClass(nextProps ?? {});
  const toolBtn = (active: boolean) => studioToolButtonClass(active, { dense: true });

  return (
    <>
      {(studioUiDensityAllows(uiDensityMode, "toolbar-assets") || activeToolbarGroup === "assetGroup") ? (
        <StudioToolbarCluster
          label="에셋 라이브러리"
          className={cn(!studioUiDensityAllows(uiDensityMode, "toolbar-assets") && "border-0 bg-transparent p-0 shadow-none")}
        >
          <div ref={activeToolbarGroup === "assetGroup" ? menuRef : undefined} className="relative">
            <StudioToolBeltHintTarget hint={hints.assets}>
              <button
                type="button"
                aria-label="템플릿·에셋"
                onClick={() => {
                  preloadStudioAssetMenuPanel();
                  setMenu(activeToolbarGroup === "assetGroup" ? null : "template");
                }}
                onPointerEnter={() => {
                  preloadStudioAssetToolPopoverBody();
                  preloadStudioAssetMenuPanel();
                }}
                onPointerDown={preloadStudioAssetToolPopoverBody}
                onFocus={() => {
                  preloadStudioAssetToolPopoverBody();
                  preloadStudioAssetMenuPanel();
                }}
                aria-haspopup="menu"
                aria-expanded={activeToolbarGroup === "assetGroup"}
                className={cn(
                  toolBtn(activeToolbarGroup === "assetGroup"),
                  !studioUiDensityAllows(uiDensityMode, "toolbar-assets") && "sr-only"
                )}
              >
                <Folder
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({
                    tone: activeToolbarGroup === "assetGroup" ? "accent" : "default",
                    active: activeToolbarGroup === "assetGroup",
                  })}
                />
                <span><span className="max-[359px]:hidden">템플릿·</span>에셋</span>
                <ChevronDown
                  size={STUDIO_ICON_SIZE.subtab}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={cn("transition-transform duration-150", activeToolbarGroup === "assetGroup" && "rotate-180")}
                />
              </button>
            </StudioToolBeltHintTarget>
            <StudioFloatingToolPopover
              open={activeToolbarGroup === "assetGroup"}
              id="asset-group"
              className={cn(groupPopoverClass("w-80"), "lg:w-[22rem] lg:max-w-[min(24rem,calc(100vw-1.5rem))]")}
            >
              <Suspense fallback={<StudioPanelLoading label="에셋 메뉴를 여는 중..." />}>
                <LazyStudioAssetToolPopoverBody toolBelt={toolBelt} />
              </Suspense>
            </StudioFloatingToolPopover>
          </div>
        </StudioToolbarCluster>
      ) : null}

      {studioUiDensityAllows(uiDensityMode, "toolbar-cut") ? (
        <>
          <StudioToolbarDivider label="컷" />
          <StudioToolbarCluster label="컷 배치">
            <StudioToolBeltHintTarget hint={hints.panelAdd}>
              <button
                type="button"
                aria-label="컷 추가 · 만화 패널"
                onClick={addFrame}
                className={toolBtn(false)}
              >
                <Plus
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass()}
                /> 컷 추가
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget hint={hints.panelSplit}>
              <button type="button" onClick={addDiagonalSplit} className={toolBtn(false)}>
                <SquareSplitHorizontal
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass()}
                /> 사선 컷
              </button>
            </StudioToolBeltHintTarget>
            {selected?.type === "frame" && (
              <StudioToolBeltHintTarget
                hint={selected.points ? hints.panelStraighten : hints.panelDiagonalize}
              >
                <button
                  type="button"
                  onClick={toggleSelectedFrameDiagonal}
                  className={toolBtn(Boolean(selected.points))}
                >
                  <SquareSplitHorizontal
                    size={STUDIO_ICON_SIZE.toolCompact}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={cn(studioToolIconClass({ active: Boolean(selected?.points) }), "opacity-90")}
                  />
                  {selected.points ? "직선화" : "사선화"}
                </button>
              </StudioToolBeltHintTarget>
            )}
          </StudioToolbarCluster>
        </>
      ) : null}

      {studioUiDensityAllows(uiDensityMode, "toolbar-draw") ? (
        <>
          <StudioToolbarDivider label="도구" className="lg:hidden" />
          <StudioToolbarCluster label="그리기 도구" className="lg:hidden">
            <StudioToolBeltHintTarget hint={hints.select}>
              <button
                type="button"
                onClick={() => {
                  activatePrimaryCanvasTool("select");
                  setMenu(null);
                }}
                className={toolBtn(tool === "select")}
                aria-pressed={tool === "select"}
              >
                <MousePointer2
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ active: tool === "select" })}
                />
                선택
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget
              hint={hints.pen}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 펜을 사용할 수 있어요." : undefined}
            >
              <button
                type="button"
                disabled={activeSurfaceReviewLocked}
                onClick={() => {
                  activatePrimaryCanvasTool("draw", "pen");
                  setMenu(null);
                }}
                className={cn(toolBtn(tool === "draw" && drawMode === "pen"), "disabled:cursor-not-allowed disabled:opacity-40")}
                aria-pressed={tool === "draw" && drawMode === "pen"}
              >
                <Pencil
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ active: tool === "draw" && drawMode === "pen" })}
                />
                펜
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget
              hint={hints.eraser}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 지우개를 사용할 수 있어요." : undefined}
            >
              <button
                type="button"
                disabled={activeSurfaceReviewLocked}
                onClick={() => {
                  activatePrimaryCanvasTool("draw", "eraser");
                  setMenu(null);
                }}
                className={cn(toolBtn(tool === "draw" && drawMode === "eraser"), "disabled:cursor-not-allowed disabled:opacity-40")}
                aria-pressed={tool === "draw" && drawMode === "eraser"}
              >
                <Eraser
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ active: tool === "draw" && drawMode === "eraser" })}
                />
                지우개
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget
              hint={hints.fill}
              unavailableReason={
                advancedFillUnsupportedReason
                  ? `${advancedFillUnsupportedReason} 채우기를 누르면 안전한 단일 래스터 후보를 찾거나 필요한 조건을 안내합니다.`
                  : undefined
              }
            >
              <button
                type="button"
                onClick={toggleAdvancedFill}
                className={toolBtn(advancedFillActive)}
                aria-pressed={advancedFillActive}
              >
                <PaintBucket
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ active: advancedFillActive })}
                />
                채우기
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget
              hint={hints.frameAnimation}
              disabled={selected?.type !== "image"}
              unavailableReason={selected?.type !== "image" ? "애니메이션으로 만들 이미지를 먼저 선택하세요." : undefined}
            >
              <button
                type="button"
                onClick={openFrameAnimationForSelected}
                disabled={selected?.type !== "image"}
                className={cn(toolBtn(frameAnimOpen && frameAnimTargetId === selected?.id), "disabled:opacity-40")}
              >
                <Film
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ disabled: selected?.type !== "image" })}
                />
                프레임
              </button>
            </StudioToolBeltHintTarget>
          </StudioToolbarCluster>
        </>
      ) : null}

      {studioUiDensityAllows(uiDensityMode, "toolbar-insert") ? (
        <StudioToolBeltCreateModeInsertTools
          hints={hints}
          studioCanvasImageAccept={studioCanvasImageAccept}
          toolBelt={toolBelt}
        />
      ) : null}

      {studioUiDensityAllows(uiDensityMode, "toolbar-reference") ? (
        <>
          <StudioToolbarDivider label="참조" />
          <StudioToolbarCluster label="참조·3D">
            <StudioToolBeltHintTarget hint={hints.character3d}>
              <button
                type="button"
                onClick={() => setPoserVrmOpen(true)}
                className={cn(toolBtn(poserVrmOpen), "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40")}
              >
                <UsersRound
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ tone: "accent" })}
                />
                3D 캐릭터
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget hint={hints.characterShaper}>
              <button
                type="button"
                onClick={() => setCharacterShaperOpen(true)}
                className={cn(toolBtn(characterShaperOpen), "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40")}
              >
                <Sparkles
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ tone: "accent" })}
                />
                캐릭터 셰이퍼
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget hint={hints.mannequin3d}>
              <button
                type="button"
                onClick={() => setMannequinPoserOpen(true)}
                className={cn(toolBtn(mannequinPoserOpen), "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40")}
              >
                <PersonStanding
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ tone: "accent" })}
                />
                3D 데생 인형
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget hint={hints.bg3d}>
              <button
                type="button"
                onClick={() => setBg3dOpen(true)}
                className={cn(toolBtn(bg3dOpen), "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40")}
              >
                <Boxes
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ tone: "accent" })}
                />
                3D 배경
              </button>
            </StudioToolBeltHintTarget>
            <StudioToolBeltHintTarget hint={hints.reference}>
              <button
                type="button"
                onClick={() => setReferencePanelOpen((v) => !v)}
                onMouseEnter={preloadStudioReferencePanel}
                onFocus={preloadStudioReferencePanel}
                className={cn(toolBtn(referencePanelOpen), "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40")}
                aria-pressed={referencePanelOpen}
              >
                <PictureInPicture2
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({ tone: "accent" })}
                />
                참고
              </button>
            </StudioToolBeltHintTarget>
          </StudioToolbarCluster>
        </>
      ) : null}

      {(studioUiDensityAllows(uiDensityMode, "toolbar-scene") || activeToolbarGroup === "bgGroup") ? (
        <>
          {studioUiDensityAllows(uiDensityMode, "toolbar-scene") ? <StudioToolbarDivider label="장면" /> : null}
          <StudioToolbarCluster
            label="배경·톤"
            className={cn(!studioUiDensityAllows(uiDensityMode, "toolbar-scene") && "border-0 bg-transparent p-0 shadow-none")}
          >
            <div ref={activeToolbarGroup === "bgGroup" ? menuRef : undefined} className="relative">
              <StudioToolBeltHintTarget hint={hints.background}>
                <button
                  type="button"
                  onClick={() => setMenu(activeToolbarGroup === "bgGroup" ? null : "bgFill")}
                  onPointerEnter={preloadStudioSceneToolPopoverBody}
                  onPointerDown={preloadStudioSceneToolPopoverBody}
                  onFocus={preloadStudioSceneToolPopoverBody}
                  aria-haspopup="menu"
                  aria-expanded={activeToolbarGroup === "bgGroup"}
                  className={cn(
                    toolBtn(activeToolbarGroup === "bgGroup"),
                    !studioUiDensityAllows(uiDensityMode, "toolbar-scene") && "sr-only"
                  )}
                >
                  <Mountain
                    size={STUDIO_ICON_SIZE.toolCompact}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioToolIconClass({
                      tone: activeToolbarGroup === "bgGroup" ? "accent" : "default",
                      active: activeToolbarGroup === "bgGroup",
                    })}
                  />
                  배경
                  <ChevronDown
                    size={STUDIO_ICON_SIZE.subtab}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={cn("transition-transform duration-150", activeToolbarGroup === "bgGroup" && "rotate-180")}
                  />
                </button>
              </StudioToolBeltHintTarget>
              <StudioFloatingToolPopover
                open={activeToolbarGroup === "bgGroup"}
                id="bg-group"
                className={groupPopoverClass("w-80")}
              >
                <Suspense fallback={<StudioPanelLoading label="배경 메뉴를 여는 중..." />}>
                  <LazyStudioSceneToolPopoverBody toolBelt={toolBelt} />
                </Suspense>
              </StudioFloatingToolPopover>
            </div>
          </StudioToolbarCluster>
        </>
      ) : null}

      {(studioUiDensityAllows(uiDensityMode, "toolbar-style") || activeToolbarGroup === "styleGroup") ? (
        <StudioToolbarCluster
          label="스타일"
          className={cn(!studioUiDensityAllows(uiDensityMode, "toolbar-style") && "border-0 bg-transparent p-0 shadow-none")}
        >
          <div ref={activeToolbarGroup === "styleGroup" ? menuRef : undefined} className="relative">
            <StudioToolBeltHintTarget hint={hints.style}>
              <button
                type="button"
                onClick={() => setMenu(activeToolbarGroup === "styleGroup" ? null : "palette")}
                onPointerEnter={() => {
                  preloadStudioStyleToolPopoverBody();
                  preloadStudioPaletteLibraryPanel();
                }}
                onPointerDown={() => {
                  preloadStudioStyleToolPopoverBody();
                  preloadStudioPaletteLibraryPanel();
                }}
                onFocus={() => {
                  preloadStudioStyleToolPopoverBody();
                  preloadStudioPaletteLibraryPanel();
                }}
                aria-haspopup="menu"
                aria-expanded={activeToolbarGroup === "styleGroup"}
                className={cn(
                  toolBtn(activeToolbarGroup === "styleGroup"),
                  !studioUiDensityAllows(uiDensityMode, "toolbar-style") && "sr-only"
                )}
              >
                <Palette
                  size={STUDIO_ICON_SIZE.toolCompact}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={studioToolIconClass({
                    tone: activeToolbarGroup === "styleGroup" ? "accent" : "default",
                    active: activeToolbarGroup === "styleGroup",
                  })}
                /> 스타일
                <ChevronDown
                  size={STUDIO_ICON_SIZE.subtab}
                  strokeWidth={STUDIO_ICON_STROKE}
                  aria-hidden
                  className={cn("transition-transform duration-150", activeToolbarGroup === "styleGroup" && "rotate-180")}
                />
              </button>
            </StudioToolBeltHintTarget>
            <StudioFloatingToolPopover
              open={activeToolbarGroup === "styleGroup"}
              id="style-group"
              className={groupPopoverClass("w-72")}
            >
              <Suspense fallback={<StudioPanelLoading label="스타일 메뉴를 여는 중..." />}>
                <LazyStudioStyleToolPopoverBody toolBelt={toolBelt} />
              </Suspense>
            </StudioFloatingToolPopover>
          </div>
        </StudioToolbarCluster>
      ) : null}

      {(studioUiDensityAllows(uiDensityMode, "toolbar-ai") || activeToolbarGroup === "aiGroup") ? (
        <>
          {studioUiDensityAllows(uiDensityMode, "toolbar-ai") ? <StudioToolbarDivider label="AI" /> : null}
          <StudioToolbarCluster
            label="AI 연동"
            className={cn(!studioUiDensityAllows(uiDensityMode, "toolbar-ai") && "border-0 bg-transparent p-0 shadow-none")}
          >
            <div ref={activeToolbarGroup === "aiGroup" ? menuRef : undefined} className="relative">
              <StudioToolBeltHintTarget hint={hints.ai}>
                <button
                  type="button"
                  onClick={() => setMenu(activeToolbarGroup === "aiGroup" ? null : "aiAssist")}
                  onPointerEnter={preloadStudioAiToolPopoverBody}
                  onPointerDown={preloadStudioAiToolPopoverBody}
                  onFocus={preloadStudioAiToolPopoverBody}
                  aria-haspopup="menu"
                  aria-expanded={activeToolbarGroup === "aiGroup"}
                  className={cn(
                    toolBtn(activeToolbarGroup === "aiGroup"),
                    !studioUiDensityAllows(uiDensityMode, "toolbar-ai") && "sr-only"
                  )}
                >
                  <WandSparkles
                    size={STUDIO_ICON_SIZE.toolCompact}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioToolIconClass({
                      tone: activeToolbarGroup === "aiGroup" ? "accent" : "default",
                      active: activeToolbarGroup === "aiGroup",
                    })}
                  />
                  AI
                  <ChevronDown
                    size={STUDIO_ICON_SIZE.subtab}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={cn("transition-transform duration-150", activeToolbarGroup === "aiGroup" && "rotate-180")}
                  />
                </button>
              </StudioToolBeltHintTarget>
              <StudioFloatingToolPopover
                open={activeToolbarGroup === "aiGroup"}
                id="ai-group"
                className={cn(
                  groupPopoverClass("w-80"),
                  "flex h-[min(78dvh,36rem)] max-h-[min(78dvh,36rem)] flex-col overflow-hidden lg:w-96 lg:max-w-[min(24rem,calc(100vw-1.5rem))]"
                )}
              >
                <Suspense fallback={<StudioPanelLoading label="AI 메뉴를 여는 중..." />}>
                  <LazyStudioAiToolPopoverBody toolBelt={toolBelt} />
                </Suspense>
              </StudioFloatingToolPopover>
            </div>
          </StudioToolbarCluster>
        </>
      ) : null}



      <StudioToolBeltCreateModeUtilityButtons
        hints={hints}
        toolBelt={toolBelt}
      />
    </>
  );
});
