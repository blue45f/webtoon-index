import { MessageCircle, Palette, Type as TypeIcon, ImagePlus } from "lucide-react";
import { memo, Suspense, type ComponentProps } from "react";

import {
  StudioFloatingToolPopover,
  StudioToolbarCluster,
  studioChromeIconClass,
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  StudioToolbarDivider,
} from "./studio-chrome-ui";
import { writeStudioInsertDragPayload } from "./studio-insert-drag-writer";
import { studioToolButtonClass } from "./studio-panel-ui";
import {
  LazyStudioBubbleToolPopoverBody,
  preloadStudioBubbleToolPopoverBody,
} from "./studio-tool-belt-lazy-ui";
import { LazyStudioColorPopover } from "./StudioLazyColorPopover";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolBeltContentProps, StudioToolBeltHintMap } from "./StudioToolBeltContent";

import { cn } from "@/shared/lib/utils";

export interface StudioToolBeltCreateModeInsertToolsProps {
  hints: StudioToolBeltHintMap;
  studioCanvasImageAccept: string;
  toolBelt: StudioToolBeltContentProps;
}

export const StudioToolBeltCreateModeInsertTools = memo(function StudioToolBeltCreateModeInsertTools(
  props: StudioToolBeltCreateModeInsertToolsProps,
) {
  const { hints, studioCanvasImageAccept, toolBelt } = props;
  const { color, menu, menuRef, setMenu, recentColors } = toolBelt;
  const {
    addText,
    onPickImage,
    rememberColor: stableRememberColor,
    ensureRecentColorsLoaded: stableEnsureRecentColorsLoaded,
  } = toolBelt.stableHandlers;
  const { setColor } = toolBelt;

  const studioToolIconClass = (nextProps?: Parameters<typeof studioChromeIconClass>[0]) =>
    studioChromeIconClass(nextProps ?? {});
  const toolBtn = (active: boolean) => studioToolButtonClass(active, { dense: true });

  return (
    <>
      <StudioToolbarDivider label="삽입" />
      <StudioToolbarCluster label="삽입·대사">
        <StudioToolBeltHintTarget hint={hints.text}>
          <button
            type="button"
            onClick={() => {
              addText();
              setMenu(null);
            }}
            draggable
            onDragStart={(event) => {
              writeStudioInsertDragPayload(event.dataTransfer, { kind: "text" });
            }}
            className={toolBtn(false)}
          >
            <TypeIcon
              size={STUDIO_ICON_SIZE.toolCompact}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioToolIconClass()}
            /> 텍스트
          </button>
        </StudioToolBeltHintTarget>
        <div ref={menu === "bubble" ? menuRef : undefined} className="relative">
          <StudioToolBeltHintTarget hint={hints.bubble}>
            <button
              type="button"
              onClick={() => setMenu(menu === "bubble" ? null : "bubble")}
              onPointerEnter={preloadStudioBubbleToolPopoverBody}
              onPointerDown={preloadStudioBubbleToolPopoverBody}
              onFocus={preloadStudioBubbleToolPopoverBody}
              aria-haspopup="menu"
              aria-expanded={menu === "bubble"}
              className={toolBtn(menu === "bubble")}
            >
              <MessageCircle
                size={STUDIO_ICON_SIZE.toolCompact}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioToolIconClass({ active: menu === "bubble" })}
              />
              말풍선
            </button>
          </StudioToolBeltHintTarget>
          <StudioFloatingToolPopover
            open={menu === "bubble"}
            id="bubble-menu"
            className="fixed inset-x-2 top-[4.5rem] z-[70] max-h-[calc(100dvh-13rem)] w-auto overflow-y-auto rounded-2xl border border-line/70 bg-panel p-0 shadow-xl lg:inset-x-auto lg:left-3 lg:top-[4.5rem] lg:max-h-[min(42rem,calc(100dvh-7rem))] lg:w-[22rem] lg:max-w-[calc(100vw-1.5rem)]"
          >
            <Suspense fallback={<StudioPanelLoading label="말풍선 메뉴를 여는 중..." />}>
              <LazyStudioBubbleToolPopoverBody
                toolBelt={toolBelt}
              />
            </Suspense>
          </StudioFloatingToolPopover>
        </div>
        <StudioToolBeltHintTarget hint={hints.image}>
          <label
            className={cn(
              toolBtn(false),
              "cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
            )}
          >
            <ImagePlus
              size={STUDIO_ICON_SIZE.toolCompact}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioToolIconClass({ tone: "default" })}
            />
            이미지
            <input
              type="file"
              accept={studioCanvasImageAccept}
              className="sr-only"
              onChange={onPickImage}
            />
          </label>
        </StudioToolBeltHintTarget>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-2 text-xs text-fg-2 pointer-coarse:h-11">
          <Palette
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioToolIconClass({ tone: "default" })}
          />
          <span className="sr-only sm:not-sr-only sm:inline">색</span>
          <LazyStudioColorPopover
            value={color}
            onChange={(nextColor) => {
              setColor(nextColor);
            }}
            recentColors={recentColors}
            onUseColor={(nextColor) => {
              stableRememberColor(nextColor);
            }}
            onLoadRecentColors={() => {
              stableEnsureRecentColorsLoaded();
            }}
            label="브러시·도형 색상"
            purpose="brush-shape"
          />
        </span>
      </StudioToolbarCluster>
    </>
  );
});

function StudioToolBeltHintTarget(props: Omit<ComponentProps<typeof StudioToolHintTarget>, "preferredSide">) {
  return <StudioToolHintTarget preferredSide="bottom" {...props} />;
}
