import {
  Box,
  Boxes,
  Circle,
  CircleDashed,
  Crop,
  Droplets,
  Eraser,
  Film,
  Hand,
  ImagePlus,
  Lasso,
  Maximize2,
  MessageCircle,
  MessageSquare,
  MousePointer2,
  Move,
  PaintBucket,
  Paintbrush,
  Grid3X3,
  Pencil,
  PersonStanding,
  PictureInPicture2,
  Pipette,
  Settings2,
  Shapes,
  Sparkles,
  Square,
  SquareDashedMousePointer,
  Sun,
  Triangle,
  Type as TypeIcon,
  UsersRound,
  Wind,
} from "lucide-react";
import { memo, useCallback, useEffect, useId, useRef, useState, type SetStateAction } from "react";
import { createPortal } from "react-dom";

import {
  StudioEditorClientProvider,
  useEditorSelector,
  useStudioEditorClient,
} from "./editor-client";
import {
  STUDIO_LEFT_TOOL_RAIL_COMMANDS,
  type StudioLeftToolRailActionArguments,
  type StudioLeftToolRailActionName,
  type StudioLeftToolRailClient,
  type StudioLeftToolRailHandlersContract,
  type StudioLeftToolRailSnapshot,
} from "./editor-client/studio-left-tool-rail-client";
import { preloadStudioRasterRetouchRuntime } from "./render/studio-raster-retouch-preload";
import {
  DEFAULT_STUDIO_RAIL_TOOL_ORDER,
  formatStudioShortcutChord,
  studioRailToolLabel,
} from "./studio-app-settings";
import {
  STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER,
  studioChromeRailGroupLabel,
} from "./studio-chrome-ia-map";
import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  StudioRailDivider,
  StudioRailToolButton,
  StudioVerticalToolRail,
  studioChromeIconClass,
} from "./studio-chrome-ui";
import {
  resolveStudioRailMorePosition,
  type StudioRailMorePosition,
  type StudioRailMoreViewport,
} from "./studio-left-tool-rail-position";
import { preloadStudioReferencePanel } from "./studio-page-lazy-ui";
import {
  isKoreanUiLocale,
  localizeStudioRailShellText,
} from "./studio-rail-tool-localization";
import {
  STUDIO_RETOUCH_EDITABLE_COPY_NOTE,
  studioRetouchToolHelp,
} from "./studio-retouch-help";
import { isSelectionUsable } from "./studio-selection-tools";
import { studioUiDensityAllows } from "./studio-ui-density";
import { StudioLeftToolRailViewToolsCluster } from "./StudioLeftToolRailViewToolsCluster";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { DrawMode, DrawShapeKind } from "./studio-editor-tool-model";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

const REVIEW_LOCK_REASON = "현재 작업면의 검토 잠금을 먼저 해제하세요.";
const IMAGE_EDIT_LOCK_REASON = "선택한 이미지 레이어의 편집 잠금을 먼저 해제하세요.";
const RASTER_RETOUCH_AUTO_TARGET_GUIDANCE = STUDIO_RETOUCH_EDITABLE_COPY_NOTE;
const RASTER_RETOUCH_AUTO_TARGET_UNAVAILABLE_REASON =
  "편집 가능한 이미지도, 편집용 이미지 복사본을 자동 준비할 벡터 선·도형도 없습니다.";
const STUDIO_CANVAS_IMAGE_ACCEPT =
  "image/*,.bmp,.dib,.tga,.icb,.vda,.vst,.ppm,.pam,.qoi,.tif,.tiff";
const STUDIO_RAIL_MORE_GAP_PX = 4;
const STUDIO_RAIL_MORE_MARGIN_PX = 8;
const STUDIO_RAIL_MORE_MAX_HEIGHT_PX = 28 * 16;
const STUDIO_RAIL_MORE_WIDTH_PX = 13 * 16;

type PositionedStudioRailMore = StudioRailMorePosition & { readonly maxHeight: number };

function labelWithShortcut(label: string, shortcut: string | undefined): string {
  return shortcut ? `${label} (${formatStudioShortcutChord(shortcut)})` : label;
}

function resolveStateAction<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === "function"
    ? (next as (value: T) => T)(current)
    : next;
}

function preloadRasterRetouchIntent(): void {
  void preloadStudioRasterRetouchRuntime().catch(() => undefined);
}

function preloadLiquifyIntent(): void {
  void preloadStudioRasterRetouchRuntime({ liquify: true }).catch(() => undefined);
}

function currentStudioRailMoreViewport(): StudioRailMoreViewport {
  const visualViewport = globalThis.visualViewport;
  return {
    height: visualViewport?.height ?? globalThis.innerHeight,
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? globalThis.innerWidth,
  };
}

function measureStudioRailMorePosition(
  trigger: Pick<DOMRect, "bottom" | "left" | "right">,
  dialog?: Pick<DOMRect, "height" | "width"> | null
): PositionedStudioRailMore {
  const viewport = currentStudioRailMoreViewport();
  const maxHeight = Math.max(0, Math.min(
    STUDIO_RAIL_MORE_MAX_HEIGHT_PX,
    viewport.height - 16
  ));
  const measuredHeight = dialog?.height && dialog.height > 0
    ? Math.min(dialog.height, maxHeight)
    : maxHeight;
  const measuredWidth = dialog?.width && dialog.width > 0
    ? dialog.width
    : STUDIO_RAIL_MORE_WIDTH_PX;

  const resolved = resolveStudioRailMorePosition({
    popoverHeight: measuredHeight,
    popoverWidth: measuredWidth,
    trigger,
    viewport,
  });
  const viewportLeft = viewport.left ?? 0;
  const viewportRight = viewportLeft + viewport.width;
  const availableOnRight = viewportRight - STUDIO_RAIL_MORE_MARGIN_PX
    - trigger.right - STUDIO_RAIL_MORE_GAP_PX;
  const availableOnLeft = trigger.left - viewportLeft
    - STUDIO_RAIL_MORE_MARGIN_PX - STUDIO_RAIL_MORE_GAP_PX;

  return {
    ...resolved,
    left: availableOnRight < measuredWidth && availableOnLeft >= measuredWidth
      ? trigger.left - STUDIO_RAIL_MORE_GAP_PX - measuredWidth
      : resolved.left,
    maxHeight,
  };
}

export type StudioLeftToolRailHandlers = StudioLeftToolRailHandlersContract;

export interface StudioLeftToolRailProps {
  readonly client: StudioLeftToolRailClient;
}

const selectStudioLeftToolRailSnapshot = (
  snapshot: StudioLeftToolRailSnapshot,
): StudioLeftToolRailSnapshot => snapshot;

export const StudioLeftToolRail = memo(function StudioLeftToolRail({
  client,
}: StudioLeftToolRailProps) {
  return (
    <StudioEditorClientProvider client={client}>
      <StudioLeftToolRailConnected />
    </StudioEditorClientProvider>
  );
});

function StudioLeftToolRailConnected() {
  const snapshot = useEditorSelector(selectStudioLeftToolRailSnapshot);
  const client = useStudioEditorClient<StudioLeftToolRailSnapshot>();
  const {
    activeSurfaceReviewLocked,
    pixelToolTargetAvailable,
    rasterRetouchTargetAvailable,
    advancedFillActive,
    advancedFillUnsupportedReason,
    appSettings,
    appSettingsOpen,
    canvasOnlyMode,
    commentPinArmed,
    cropActive,
    drawMode,
    drawShape,
    eyedropperActive,
    frameAnimOpen,
    frameAnimTargetId,
    isRailToolVisible,
    liquifyActive,
    mobileImmersive,
    perspectiveRulerActive,
    pixelForceCircle,
    pixelSel,
    pixelTool,
    quickShapeActive,
    railMoreOpen,
    referencePanelOpen,
    mannequinPoserOpen,
    poserVrmOpen,
    characterShaperOpen,
    bg3dOpen,
    hybridDccOpen,
    selected,
    selectedImageMutationLocked,
    dodgeBurnActive,
    wetMixActive,
    smudgeActive,
    tool,
    uiDensityMode,
    viewTransformSuppressed,
    viewTool,
  } = snapshot;
  const railMoreDialogId = useId();
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const railMoreTriggerId = `${railMoreDialogId}-trigger`;
  // 도구 버튼 라벨은 `StudioRailToolButton` 안에서 도구 id 로 번역된다. 여기서 쓰는 건 도구가
  // 아닌 레일 셸 문구(더보기 버튼, 숨긴 도구 목록, 설정 진입)뿐이다.
  const railLang = useI18n((state) => state.lang);
  const railT = useT();
  const railMoreTitleId = `${railMoreDialogId}-title`;
  const zoomShortcut = appSettings.shortcuts["tool-zoom"];
  const rotateViewShortcut = appSettings.shortcuts["tool-rotate-view"];
  const commentShortcut = appSettings.shortcuts["tool-comment"];
  const smudgeShortcut = appSettings.shortcuts["tool-blend"];
  const wetMixShortcut = appSettings.shortcuts["tool-wet-mix"];
  const dodgeBurnShortcut = appSettings.shortcuts["tool-dodge-burn"];
  const liquifyShortcut = appSettings.shortcuts["tool-liquify"];
  const smudgeHelp = studioRetouchToolHelp("smudge");
  const wetMixHelp = studioRetouchToolHelp("wet-mix");
  const dodgeBurnHelp = studioRetouchToolHelp("dodge-burn");
  const liquifyHelp = studioRetouchToolHelp("liquify");
  const formattedCommentShortcut = commentShortcut
    ? formatStudioShortcutChord(commentShortcut)
    : null;
  const zoomViewToolOpen = viewTool === "zoom";
  const rotateViewToolOpen = viewTool === "rotate";
  const zoomViewToolLabel = zoomViewToolOpen
    ? zoomShortcut
      ? `확대·축소 HUD 닫기 (${formatStudioShortcutChord(zoomShortcut)})`
      : "확대·축소 HUD 닫기"
    : zoomShortcut
      ? `보기 확대·축소 (${formatStudioShortcutChord(zoomShortcut)})`
      : "보기 확대·축소";
  const rotateViewToolLabel = rotateViewToolOpen
    ? rotateViewShortcut
      ? `회전 HUD 닫기 (${formatStudioShortcutChord(rotateViewShortcut)})`
      : "회전 HUD 닫기"
    : rotateViewShortcut
      ? `보기 회전 (${formatStudioShortcutChord(rotateViewShortcut)})`
      : "보기 회전";
  const lassoToolHintProps = pixelTool === "lasso"
    ? { hintPreview: "polygon-lasso" as const }
    : pixelTool === "poly-lasso"
      ? { hintPreview: "dismiss" as const }
      : { hintPreview: "lasso" as const };
  const zoomViewToolHintProps = zoomViewToolOpen
    ? { hintPreview: "view-hud" as const, hintPreviewVariant: "zoom-close" as const }
    : { hintPreview: "view-hud" as const, hintPreviewVariant: "zoom-open" as const };
  const rotateViewToolHintProps = rotateViewToolOpen
    ? { hintPreview: "view-hud" as const, hintPreviewVariant: "rotate-close" as const }
    : { hintPreview: "view-hud" as const, hintPreviewVariant: "rotate-open" as const };
  const selectionSubtoolActive =
    advancedFillActive
    || cropActive
    || eyedropperActive
    || commentPinArmed
    || pixelTool !== null
    || smudgeActive
    || wetMixActive
    || dodgeBurnActive
    || liquifyActive;
  const drawToolTemporarilyOverridden = eyedropperActive || commentPinArmed;
  const selectedImageLocked =
    selected?.type === "image" && selectedImageMutationLocked;
  const rasterRetouchCanStart =
    rasterRetouchTargetAvailable
    && !activeSurfaceReviewLocked
    && !selectedImageLocked;
  const rasterRetouchDescription = (base: string): string =>
    selected?.type === "image"
      ? base
      : `${base} ${RASTER_RETOUCH_AUTO_TARGET_GUIDANCE}`;
  const rasterRetouchUnavailableReason = (active: boolean): string | undefined => {
    if (active) return undefined;
    if (activeSurfaceReviewLocked) return REVIEW_LOCK_REASON;
    if (selectedImageLocked) return IMAGE_EDIT_LOCK_REASON;
    return rasterRetouchTargetAvailable
      ? undefined
      : RASTER_RETOUCH_AUTO_TARGET_UNAVAILABLE_REASON;
  };
  const railMoreDialogRef = useRef<HTMLDivElement>(null);
  const [railMorePosition, setRailMorePosition] = useState<PositionedStudioRailMore>({
    left: 56,
    maxHeight: STUDIO_RAIL_MORE_MAX_HEIGHT_PX,
    top: 8,
  });
  const invokeRail = useCallback(
    function invoke<K extends StudioLeftToolRailActionName>(
      action: K,
      ...args: StudioLeftToolRailActionArguments<K>
    ) {
      return client.dispatch({
        id: STUDIO_LEFT_TOOL_RAIL_COMMANDS[action],
        payload: args,
        source: "rail",
      });
    },
    [client],
  );

  function bindVoidAction<K extends StudioLeftToolRailActionName>(
    action: K,
  ): (...args: StudioLeftToolRailActionArguments<K>) => void {
    return (...args) => {
      void invokeRail(action, ...args);
    };
  }

  const setAppSettingsInitialTab = (
    value: StudioLeftToolRailActionArguments<"setAppSettingsInitialTab">[0],
  ): void => {
    void invokeRail("setAppSettingsInitialTab", value);
  };
  const setAppSettingsOpen = (next: SetStateAction<boolean>): void => {
    void invokeRail("setAppSettingsOpen", resolveStateAction(next, appSettingsOpen));
  };
  const setDrawShape = (next: SetStateAction<typeof drawShape>): void => {
    void invokeRail("setDrawShape", resolveStateAction(next, drawShape));
  };
  const setEyedropperActive = (next: SetStateAction<boolean>): void => {
    void invokeRail("setEyedropperActive", resolveStateAction(next, eyedropperActive));
  };
  const setMenu = (
    value: StudioLeftToolRailActionArguments<"setMenu">[0],
  ): void => {
    void invokeRail("setMenu", value);
  };
  const setPerspectiveRulerActive = (next: SetStateAction<boolean>): void => {
    void invokeRail(
      "setPerspectiveRulerActive",
      resolveStateAction(next, perspectiveRulerActive),
    );
  };
  const setPixelForceCircle = (next: SetStateAction<boolean>): void => {
    void invokeRail("setPixelForceCircle", resolveStateAction(next, pixelForceCircle));
  };
  const setPixelTool = (next: SetStateAction<typeof pixelTool>): void => {
    void invokeRail("setPixelTool", resolveStateAction(next, pixelTool));
  };
  const setQuickShapeActive = (next: SetStateAction<boolean>): void => {
    void invokeRail("setQuickShapeActive", resolveStateAction(next, quickShapeActive));
  };
  const setRailMoreOpen = useCallback((next: SetStateAction<boolean>): void => {
    void invokeRail("setRailMoreOpen", resolveStateAction(next, railMoreOpen));
  }, [invokeRail, railMoreOpen]);
  const setReferencePanelOpen = (next: SetStateAction<boolean>): void => {
    void invokeRail("setReferencePanelOpen", resolveStateAction(next, referencePanelOpen));
  };
  const setMannequinPoserOpen = client.availability(
    STUDIO_LEFT_TOOL_RAIL_COMMANDS.setMannequinPoserOpen,
  ).state === "enabled"
    ? (next: SetStateAction<boolean>): void => {
        void invokeRail(
          "setMannequinPoserOpen",
          resolveStateAction(next, mannequinPoserOpen),
        );
      }
    : undefined;
  const setPoserVrmOpen = client.availability(
    STUDIO_LEFT_TOOL_RAIL_COMMANDS.setPoserVrmOpen,
  ).state === "enabled"
    ? (next: SetStateAction<boolean>): void => {
        void invokeRail("setPoserVrmOpen", resolveStateAction(next, poserVrmOpen));
      }
    : undefined;
  const setCharacterShaperOpen = client.availability(
    STUDIO_LEFT_TOOL_RAIL_COMMANDS.setCharacterShaperOpen,
  ).state === "enabled"
    ? (next: SetStateAction<boolean>): void => {
        void invokeRail("setCharacterShaperOpen", resolveStateAction(next, characterShaperOpen));
      }
    : undefined;
  const setHybridDccOpen = client.availability(
    STUDIO_LEFT_TOOL_RAIL_COMMANDS.setHybridDccOpen,
  ).state === "enabled"
    ? (next: SetStateAction<boolean>): void => {
        void invokeRail("setHybridDccOpen", resolveStateAction(next, hybridDccOpen));
      }
    : undefined;
  const setViewTool = (next: SetStateAction<typeof viewTool>): void => {
    void invokeRail("setViewTool", resolveStateAction(next, viewTool));
  };

  const activatePrimaryCanvasTool = bindVoidAction("activatePrimaryCanvasTool");
  const addBubble = bindVoidAction("addBubble");
  const addText = bindVoidAction("addText");
  const announceDrawingShortcut = bindVoidAction("announceDrawingShortcut");
  const clearPolyLassoDraft = bindVoidAction("clearPolyLassoDraft");
  const commitAppSettings = bindVoidAction("commitAppSettings");
  const disarmAllPixelTools = bindVoidAction("disarmAllPixelTools");
  const fitCanvasToWidth = bindVoidAction("fitCanvasToWidth");
  const fitCanvasToWidthWithFocus = client.availability(
    STUDIO_LEFT_TOOL_RAIL_COMMANDS.fitCanvasToWidthWithFocus,
  ).state === "enabled"
    ? bindVoidAction("fitCanvasToWidthWithFocus")
    : undefined;
  const onRequestPixelSelection = bindVoidAction("onRequestPixelSelection");
  const onRequestSelectImage = bindVoidAction("onRequestSelectImage");
  const returnToSelectTool = bindVoidAction("returnToSelectTool");
  const toggleHandTool = bindVoidAction("toggleHandTool");
  const onPickImage: StudioLeftToolRailHandlers["onPickImage"] = async (...args) => {
    await invokeRail("onPickImage", ...args);
  };
  const revealDrawToolProperties = bindVoidAction("revealDrawToolProperties");
  const toggleAdvancedFill = bindVoidAction("toggleAdvancedFill");
  const toggleStudioCommentPinPlacement = bindVoidAction(
    "toggleStudioCommentPinPlacement",
  );
  const toggleDodgeBurnTool = bindVoidAction("toggleDodgeBurnTool");
  const toggleWetMixTool = bindVoidAction("toggleWetMixTool");
  const toggleLiquifyTool = bindVoidAction("toggleLiquifyTool");
  const togglePixelMarquee = bindVoidAction("togglePixelMarquee");
  const toggleSmudgeTool = bindVoidAction("toggleSmudgeTool");
  const toggleBg3dEditor = bindVoidAction("toggleBg3dEditor");
  const openFrameAnimationForSelected = bindVoidAction(
    "openFrameAnimationForSelected",
  );
  const openPixelSelectionTransform = bindVoidAction(
    "openPixelSelectionTransform",
  );
  const openSelectedLayerCrop = bindVoidAction("openSelectedLayerCrop");

  const fitCanvasToWidthWithWorkspace =
    fitCanvasToWidthWithFocus ?? fitCanvasToWidth;
  /** Pick a draw mode from the rail and surface context properties (CSP/PPT IA). */
  const activateDrawTool = (mode: DrawMode, shape?: DrawShapeKind) => {
    // 진행 중인 획 취소 + disarm(스포이드 포함) + tool/drawMode 커밋은 전이 함수가 정본이다.
    activatePrimaryCanvasTool("draw", mode);
    if (shape !== undefined) setDrawShape(shape);
    setMenu(null);
    // First tool click should clear first-use chrome so the canvas stays the focus.
    revealDrawToolProperties();
  };
  /** Object free-transform path (stroke handles / Konva) — no pixel marquee needed. */
  const objectFreeTransformReady =
    selected !== null
    && !activeSurfaceReviewLocked
    && !(selected.type === "image" && selectedImageMutationLocked);
  const pixelContentTransformReady =
    pixelToolTargetAvailable && isSelectionUsable(pixelSel);
  /**
   * Image-only content-transform recovery: start a marquee on a raster target.
   * Vector-first pages should NOT fall through here — that used to label the tool
   * "선택 시작하기" and open pixel marquee, which felt broken vs free-transform.
   */
  const pixelTransformRecoveryAvailable =
    !objectFreeTransformReady
    && !pixelContentTransformReady
    && pixelToolTargetAvailable
    && !activeSurfaceReviewLocked
    && !selectedImageLocked;
  /** No selection yet: arm select tool so the next click free-transforms. */
  const objectTransformPickRecoveryAvailable =
    !objectFreeTransformReady
    && !pixelContentTransformReady
    && !pixelToolTargetAvailable
    && !activeSurfaceReviewLocked;
  const frameAnimationNeedsImage =
    selected?.type !== "image" || !pixelToolTargetAvailable;
  const frameAnimationRecoveryAvailable =
    frameAnimationNeedsImage && !activeSurfaceReviewLocked && !selectedImageLocked;

  useEffect(() => {
    if (!railMoreOpen) return;
    const dialog = railMoreDialogRef.current;
    const updatePosition = () => {
      const trigger = document.getElementById(railMoreTriggerId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const next = measureStudioRailMorePosition(
        rect,
        dialog?.getBoundingClientRect()
      );
      setRailMorePosition((current) =>
        current.left === next.left
        && current.top === next.top
        && current.maxHeight === next.maxHeight
          ? current
          : next
      );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setRailMoreOpen(false);
      requestAnimationFrame(() => document.getElementById(railMoreTriggerId)?.focus());
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dialog?.contains(target) || document.getElementById(railMoreTriggerId)?.contains(target)) return;
      setRailMoreOpen(false);
    };
    updatePosition();
    dialog?.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    globalThis.addEventListener("resize", updatePosition);
    globalThis.addEventListener("scroll", updatePosition, true);
    globalThis.visualViewport?.addEventListener("resize", updatePosition);
    globalThis.visualViewport?.addEventListener("scroll", updatePosition);
    const frame = requestAnimationFrame(() => {
      dialog
        ?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled])')
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog?.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      globalThis.removeEventListener("resize", updatePosition);
      globalThis.removeEventListener("scroll", updatePosition, true);
      globalThis.visualViewport?.removeEventListener("resize", updatePosition);
      globalThis.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [railMoreOpen, railMoreTriggerId, setRailMoreOpen]);

  function closeRailMoreAndRestoreFocus(): void {
    setRailMoreOpen(false);
    requestAnimationFrame(() => document.getElementById(railMoreTriggerId)?.focus());
  }

  const railMoreFooter = (
    <div className="relative" data-studio-tool-rail-settings="true">
      <StudioRailToolButton
        id={railMoreTriggerId}
        icon={Settings2}
        label={localizeStudioRailShellText("더보기 · 툴바 설정", railLang, railT)}
        description="숨긴 도구를 열거나 애플리케이션 설정에서 툴바·단축키·마우스·터치를 맞춤 설정합니다."
        active={railMoreOpen || appSettingsOpen}
        aria-controls={railMoreOpen ? railMoreDialogId : undefined}
        aria-expanded={railMoreOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (!railMoreOpen) {
            const rect = document.getElementById(railMoreTriggerId)?.getBoundingClientRect();
            if (rect) {
              setRailMorePosition(measureStudioRailMorePosition(rect));
            }
          }
          setRailMoreOpen((v) => !v);
        }}
      />
      {railMoreOpen && typeof document !== "undefined" ? createPortal((
        <div
          ref={railMoreDialogRef}
          id={railMoreDialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={railMoreTitleId}
          tabIndex={-1}
          className="fixed z-[80] max-h-[min(28rem,calc(100dvh-1rem))] w-52 overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel p-1.5 shadow-2xl [scrollbar-gutter:stable]"
          style={{
            left: railMorePosition.left,
            maxHeight: railMorePosition.maxHeight,
            top: railMorePosition.top,
          }}
        >
          <p id={railMoreTitleId} className="px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-3">
            숨긴 도구
          </p>
          {appSettings.toolbar.visibleIds.length >= DEFAULT_STUDIO_RAIL_TOOL_ORDER.length ? (
            <p className="px-2 py-1.5 text-[0.6875rem] text-fg-3">모두 표시 중</p>
          ) : (
            STUDIO_CHROME_DEFAULT_RAIL_TOOL_ORDER
              .filter((id) => !isRailToolVisible(id))
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-lg px-2 py-2 text-left text-xs text-fg hover:bg-raised sm:min-h-9 sm:py-1.5 pointer-coarse:min-h-11 pointer-coarse:py-2"
                  onClick={() => {
                    commitAppSettings({
                      ...appSettings,
                      toolbar: {
                        visibleIds: [...appSettings.toolbar.visibleIds, id],
                      },
                    });
                    closeRailMoreAndRestoreFocus();
                  }}
                >
                  {isKoreanUiLocale(railLang) ? studioRailToolLabel(id) : studioRailToolLabel(id, railT)}
                </button>
              ))
          )}
          <button
            type="button"
            className="mt-1 flex min-h-11 w-full items-center gap-1 rounded-lg border border-line px-2 py-2 text-left text-xs font-medium text-accent hover:bg-accent-soft sm:min-h-9 sm:py-1.5 pointer-coarse:min-h-11 pointer-coarse:py-2"
            onClick={() => {
              document.getElementById(railMoreTriggerId)?.focus({ preventScroll: true });
              setRailMoreOpen(false);
              setAppSettingsInitialTab("toolbar");
              setAppSettingsOpen(true);
            }}
          >
            <Settings2
              size={STUDIO_ICON_SIZE.subtab}
              strokeWidth={STUDIO_ICON_STROKE}
              className={studioChromeIconClass({ tone: "accent" })}
              aria-hidden
            />
            {localizeStudioRailShellText("애플리케이션 설정", railLang, railT)}
          </button>
        </div>
      ), document.body) : null}
    </div>
  );

  return (
    <>
        {studioUiDensityAllows(uiDensityMode, "tool-rail") && !canvasOnlyMode ? (
          <StudioVerticalToolRail
            className={cn(mobileImmersive && "hidden")}
            footer={railMoreFooter}
          >
            <StudioRailDivider
              data-studio-rail-group-divider="navigate-select"
              label={studioChromeRailGroupLabel("navigate-select")}
            />
{isRailToolVisible("select") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="select"
              icon={MousePointer2}
              label="선택 (V)"
              description="캔버스 위 요소를 클릭·드래그로 고르고 옮기거나 크기를 바꿉니다. 여러 개를 드래그해 함께 선택할 수 있어요."
              active={tool === "select" && !selectionSubtoolActive}
              onClick={() => {
                activatePrimaryCanvasTool("select");
                setMenu(null);
              }}
            />
            ) : null}
{isRailToolVisible("hand") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="hand"
              icon={Hand}
              label="핸드 (팬)"
              description="캔버스를 드래그해 이동합니다. Space 키와 같은 역할입니다."
              active={tool === "hand"}
              onClick={() => {
                disarmAllPixelTools();
                toggleHandTool();
                setEyedropperActive(false);
                setMenu(null);
              }}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="draw"
              label={studioChromeRailGroupLabel("draw")}
            />
{isRailToolVisible("pen") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="pen"
              data-studio-primary-action="draw"
              icon={Pencil}
              label="펜 (B)"
              description="자유선으로 그립니다. 필압·보정·브러시 프리셋은 하단 옵션 도크와 브러시 스튜디오에서 조절해요."
              active={tool === "draw" && drawMode === "pen" && !drawToolTemporarilyOverridden}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              grouped
              onClick={() => activateDrawTool("pen")}
            />
            ) : null}
{isRailToolVisible("pixel-pencil") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="pixel-pencil"
              icon={Grid3X3}
              label="픽셀 펜 (P)"
              description="1px 하드 픽셀 펜으로 그립니다. 안티앨리어스·필압 없이 또렷한 선을 남깁니다."
              active={tool === "draw" && drawMode === "pixel" && !drawToolTemporarilyOverridden}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => activateDrawTool("pixel")}
            />
            ) : null}
{isRailToolVisible("eraser") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="eraser"
              icon={Eraser}
              label="지우개 (E)"
              description="현재 레이어/획 위를 지웁니다. 굵기는 펜과 같은 크기 칩으로 맞출 수 있어요."
              active={tool === "draw" && drawMode === "eraser" && !drawToolTemporarilyOverridden}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => activateDrawTool("eraser")}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="paint-retouch"
              label={studioChromeRailGroupLabel("paint-retouch")}
            />
{isRailToolVisible("blend") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="blend"
              icon={Wind}
              label={labelWithShortcut(smudgeHelp.railName, smudgeShortcut)}
              aria-keyshortcuts={smudgeShortcut || undefined}
              description={rasterRetouchDescription(smudgeHelp.summary)}
              active={smudgeActive}
              disabled={!smudgeActive && !rasterRetouchCanStart}
              unavailableReason={rasterRetouchUnavailableReason(smudgeActive)}
              onPointerEnter={preloadRasterRetouchIntent}
              onPointerDown={preloadRasterRetouchIntent}
              onFocus={preloadRasterRetouchIntent}
              onClick={toggleSmudgeTool}
            />
            ) : null}
{isRailToolVisible("wet-mix") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="wet-mix"
              icon={Droplets}
              label={labelWithShortcut(wetMixHelp.railName, wetMixShortcut)}
              aria-keyshortcuts={wetMixShortcut || undefined}
              description={rasterRetouchDescription(wetMixHelp.summary)}
              active={wetMixActive}
              disabled={!wetMixActive && !rasterRetouchCanStart}
              unavailableReason={rasterRetouchUnavailableReason(wetMixActive)}
              onPointerEnter={preloadRasterRetouchIntent}
              onPointerDown={preloadRasterRetouchIntent}
              onFocus={preloadRasterRetouchIntent}
              onClick={toggleWetMixTool}
            />
            ) : null}
{isRailToolVisible("dodge-burn") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="dodge-burn"
              icon={Sun}
              label={labelWithShortcut(dodgeBurnHelp.railName, dodgeBurnShortcut)}
              aria-keyshortcuts={dodgeBurnShortcut || undefined}
              description={rasterRetouchDescription(dodgeBurnHelp.summary)}
              active={dodgeBurnActive}
              disabled={!dodgeBurnActive && !rasterRetouchCanStart}
              unavailableReason={rasterRetouchUnavailableReason(dodgeBurnActive)}
              onPointerEnter={preloadRasterRetouchIntent}
              onPointerDown={preloadRasterRetouchIntent}
              onFocus={preloadRasterRetouchIntent}
              onClick={toggleDodgeBurnTool}
            />
            ) : null}
{isRailToolVisible("liquify") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="liquify"
              icon={Move}
              label={labelWithShortcut(liquifyHelp.railName, liquifyShortcut)}
              aria-keyshortcuts={liquifyShortcut || undefined}
              description={rasterRetouchDescription(liquifyHelp.summary)}
              active={liquifyActive}
              disabled={!liquifyActive && !rasterRetouchCanStart}
              unavailableReason={rasterRetouchUnavailableReason(liquifyActive)}
              onPointerEnter={preloadLiquifyIntent}
              onPointerDown={preloadLiquifyIntent}
              onFocus={preloadLiquifyIntent}
              onClick={toggleLiquifyTool}
            />
            ) : null}
{isRailToolVisible("fill") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="fill"
              icon={PaintBucket}
              label="채우기 (G)"
              description={advancedFillUnsupportedReason
                ? `선 안을 탭해 색을 채웁니다. ${advancedFillUnsupportedReason} 눌러서 안전한 단일 래스터 후보를 찾거나 필요한 조건을 확인하세요.`
                : "선 안을 탭해 색을 채웁니다. 경계 인식과 참조 레이어 설정은 속성 패널에서 조정해요."}
              active={advancedFillActive}
              onClick={toggleAdvancedFill}
            />
            ) : null}
{isRailToolVisible("lasso-fill") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="lasso-fill"
              icon={Paintbrush}
              label="올가미 채우기"
              description="닫힌 궤적을 그려 현재 색으로 채웁니다."
              active={tool === "draw" && drawMode === "lasso-fill"}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => activateDrawTool("lasso-fill")}
            />
            ) : null}
{isRailToolVisible("eyedropper") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="eyedropper"
              icon={Pipette}
              label="스포이드 (I / Alt+클릭)"
              description="캔버스 색을 샘플링해 주 색으로 가져옵니다. 펜으로 그리는 중엔 Alt+클릭으로도 동작해요."
              active={eyedropperActive}
              onClick={() => {
                const next = !eyedropperActive;
                if (next) disarmAllPixelTools();
                setEyedropperActive(next);
                setMenu(null);
              }}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="selection"
              label={studioChromeRailGroupLabel("selection")}
            />
{isRailToolVisible("marquee-rect") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="marquee-rect"
              icon={SquareDashedMousePointer}
              label="사각 선택 (M)"
              description="이미지 픽셀을 사각형으로 선택합니다. Shift=정사각, Alt=중심 확장."
              active={pixelTool === "rect" && !pixelForceCircle}
              disabled={activeSurfaceReviewLocked || (selected?.type === "image" && selectedImageMutationLocked)}
              unavailableReason={
                activeSurfaceReviewLocked
                  ? REVIEW_LOCK_REASON
                  : selected?.type === "image" && selectedImageMutationLocked
                    ? IMAGE_EDIT_LOCK_REASON
                    : undefined
              }
              onClick={() => togglePixelMarquee("rect")}
            />
            ) : null}
{isRailToolVisible("marquee-circle") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="marquee-circle"
              icon={CircleDashed}
              label="원형 선택"
              description="이미지 픽셀을 정원으로 선택합니다. Alt=중심 확장."
              active={pixelTool === "ellipse" && pixelForceCircle}
              disabled={activeSurfaceReviewLocked || (selected?.type === "image" && selectedImageMutationLocked)}
              unavailableReason={
                activeSurfaceReviewLocked
                  ? REVIEW_LOCK_REASON
                  : selected?.type === "image" && selectedImageMutationLocked
                    ? IMAGE_EDIT_LOCK_REASON
                    : undefined
              }
              onClick={() => togglePixelMarquee("circle")}
            />
            ) : null}
{isRailToolVisible("lasso") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="lasso"
              icon={Lasso}
              label={
                pixelTool === "lasso"
                    ? "자유 올가미 · 다시 누르면 다각형 올가미"
                    : pixelTool === "poly-lasso"
                      ? "다각형 올가미 · 다시 누르면 끄기"
                      : "올가미 선택"
              }
              description={
                pixelTool === "lasso"
                  ? "다시 누르면 클릭한 꼭짓점을 연결하는 다각형 올가미로 전환합니다."
                  : pixelTool === "poly-lasso"
                    ? "다시 누르면 다각형 올가미와 작성 중인 꼭짓점을 지우고 선택 도구를 끕니다."
                    : "다음 클릭부터 드래그한 자유 곡선 안쪽의 이미지 픽셀을 선택합니다."
              }
              {...lassoToolHintProps}
              active={(pixelTool === "lasso" || pixelTool === "poly-lasso") && !pixelForceCircle}
              disabled={activeSurfaceReviewLocked || (selected?.type === "image" && selectedImageMutationLocked)}
              unavailableReason={
                activeSurfaceReviewLocked
                  ? REVIEW_LOCK_REASON
                  : selected?.type === "image" && selectedImageMutationLocked
                    ? IMAGE_EDIT_LOCK_REASON
                    : undefined
              }
              onClick={() => {
                if (activeSurfaceReviewLocked || (selected?.type === "image" && selectedImageMutationLocked)) return;
                returnToSelectTool();
                setMenu(null);
                setPixelForceCircle(false);
                if (pixelTool === "lasso") {
                  clearPolyLassoDraft();
                  disarmAllPixelTools();
                  setPixelTool("poly-lasso");
                  return;
                }
                if (pixelTool === "poly-lasso") {
                  clearPolyLassoDraft();
                  setPixelTool(null);
                  return;
                }
                clearPolyLassoDraft();
                disarmAllPixelTools();
                setPixelTool("lasso");
              }}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="transform"
              label={studioChromeRailGroupLabel("transform")}
            />
{isRailToolVisible("transform") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="transform"
              icon={Maximize2}
              label={
                pixelTransformRecoveryAvailable
                  ? "선택 시작하기"
                  : objectTransformPickRecoveryAvailable
                    ? "선택 후 변형"
                    : "변형 (⇧T)"
              }
              description={
                pixelTransformRecoveryAvailable
                  ? "이미지 픽셀 내용 변형을 위해 사각 선택을 시작합니다. 선택 뒤 다시 누르면 스케일·회전·뒤집기 패널이 열려요."
                  : objectTransformPickRecoveryAvailable
                    ? "변형할 선·도형·이미지를 캔버스에서 먼저 고르세요. 선택 도구로 전환합니다."
                    : objectFreeTransformReady
                      ? selected?.type === "draw"
                        ? "선택한 선화 레이어의 모서리 핸들로 크기·위치를 조절합니다. 이미지 픽셀 부분 변형은 사각 선택 후 다시 눌러 주세요."
                        : selected?.type === "image" && !isSelectionUsable(pixelSel)
                          ? "이미지 레이어 전체를 선택해 내용 변형(스케일·회전·뒤집기) 패널을 엽니다. 부분만 바꾸려면 먼저 사각·올가미 선택하세요."
                          : "선택한 객체의 모서리·회전 핸들로 변형하거나, 픽셀 선택이 있으면 내용 변형 패널을 엽니다."
                      : "픽셀 선택이 있으면 속성→리터치에서 내용 변형(스케일·회전·뒤집기)을 적용합니다."
              }
              active={false}
              disabled={activeSurfaceReviewLocked || selectedImageLocked}
              unavailableReason={
                activeSurfaceReviewLocked
                  ? REVIEW_LOCK_REASON
                  : selectedImageMutationLocked
                    ? IMAGE_EDIT_LOCK_REASON
                    : undefined
              }
              className={
                pixelTransformRecoveryAvailable || objectTransformPickRecoveryAvailable
                  ? "size-11"
                  : undefined
              }
              onClick={() => {
                if (pixelTransformRecoveryAvailable) {
                  onRequestPixelSelection();
                  return;
                }
                if (objectTransformPickRecoveryAvailable) {
                  disarmAllPixelTools();
                  returnToSelectTool();
                  setMenu(null);
                  announceDrawingShortcut(
                    "변형할 요소를 클릭해 선택하세요 · 모서리 핸들로 크기 조절",
                  );
                  return;
                }
                openPixelSelectionTransform();
              }}
            />
            ) : null}
{isRailToolVisible("crop") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="crop"
              icon={Crop}
              label="자르기 (C)"
              description={rasterRetouchDescription(
                "가장자리와 모서리를 끌어 필요한 영역만 남깁니다. 적용 전까지 원본은 바뀌지 않아요."
              )}
              active={cropActive}
              disabled={!cropActive && !rasterRetouchCanStart}
              unavailableReason={rasterRetouchUnavailableReason(cropActive)}
              onClick={openSelectedLayerCrop}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="objects"
              label={studioChromeRailGroupLabel("objects")}
            />
{isRailToolVisible("smart-shape") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="smart-shape"
              icon={Shapes}
              label={quickShapeActive ? "스마트 도형 끄기" : "스마트 도형 켜기"}
              description={quickShapeActive
                ? "자동 도형 보정을 끄고 입력한 획을 그대로 유지합니다."
                : "낙서를 잠시 멈추면 선·원·사각형 등 깔끔한 도형으로 자동 다듬어요."}
              hintPreview="smart-shape"
              hintPreviewVariant={quickShapeActive ? "disable" : "enable"}
              active={quickShapeActive}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              accented
              onClick={() => {
                const next = !quickShapeActive;
                if (next) {
                  activateDrawTool("pen");
                  announceDrawingShortcut("스마트 도형 켜짐 · 그려서 손을 떼면 다듬어요");
                } else {
                  announceDrawingShortcut("스마트 도형 꺼짐");
                }
                setQuickShapeActive(next);
                setMenu(null);
              }}
            />
            ) : null}
{isRailToolVisible("shape-rect") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="shape-rect"
              icon={Square}
              label="사각형 도형"
              description="드래그로 사각형을 그립니다. Shift를 누르면 정사각형으로 맞출 수 있어요."
              active={tool === "draw" && drawMode === "shape" && drawShape === "rect"}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => activateDrawTool("shape", "rect")}
            />
            ) : null}
{isRailToolVisible("shape-ellipse") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="shape-ellipse"
              icon={Circle}
              label="타원 도형"
              description="드래그로 타원을 그립니다. Shift를 누르면 정원으로 맞출 수 있어요."
              active={tool === "draw" && drawMode === "shape" && drawShape === "ellipse"}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => activateDrawTool("shape", "ellipse")}
            />
            ) : null}
{isRailToolVisible("text") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="text"
              icon={TypeIcon}
              label="텍스트 추가"
              description="캔버스에 글자 상자를 추가합니다. 폰트·정렬·효과는 우측 속성에서 편집해요."
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => {
                addText(undefined, true);
              }}
            />
            ) : null}
{isRailToolVisible("bubble") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="bubble"
              icon={MessageCircle}
              label="말풍선 추가"
              description="만화 말풍선을 넣습니다. 꼬리 위치·스타일 프리셋은 말풍선 패널에서 바꿀 수 있어요."
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => {
                addBubble("speech", undefined, true);
              }}
            />
            ) : null}
{isRailToolVisible("image") ? (
            <StudioToolHintTarget
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              hint={{
                id: "image",
                title: "이미지 추가",
                description: "파일에서 그림을 불러와 캔버스에 배치합니다. 이후 비파괴 필터·블러·픽셀 선택을 적용할 수 있어요.",
                preview: "image",
                tip: "클립보드의 이미지는 ⌘V 또는 Ctrl+V로 바로 붙여넣을 수도 있어요.",
              }}
            >
              <span className="relative inline-flex">
                <button
                  type="button"
                  onClick={() => imageFileInputRef.current?.click()}
                  data-studio-rail-tool-id="image"
                  aria-label="이미지 추가"
                  disabled={activeSurfaceReviewLocked}
                  className={cn(
                    "relative grid size-10 place-items-center rounded-2xl border border-transparent text-fg-2 xl:size-11",
                    activeSurfaceReviewLocked
                      ? "cursor-not-allowed opacity-35"
                      : "cursor-pointer hover:border-line hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  )}
                >
                  <ImagePlus
                    size={STUDIO_ICON_SIZE.rail}
                    strokeWidth={STUDIO_ICON_STROKE}
                    aria-hidden
                    className={studioChromeIconClass({
                      tone: activeSurfaceReviewLocked ? "muted" : "default",
                      disabled: activeSurfaceReviewLocked,
                    })}
                  />
                  <span className="sr-only">이미지 추가</span>
                </button>
              </span>
              <input
                ref={imageFileInputRef}
                type="file"
                accept={STUDIO_CANVAS_IMAGE_ACCEPT}
                aria-label="캔버스 이미지 파일 선택"
                className="sr-only"
                tabIndex={-1}
                onChange={onPickImage}
                disabled={activeSurfaceReviewLocked}
              />
            </StudioToolHintTarget>
            ) : null}
{isRailToolVisible("comment") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="comment"
              icon={MessageSquare}
              label={commentPinArmed
                ? "댓글 핀 배치 취소"
                : formattedCommentShortcut
                  ? `댓글 핀 배치 (${formattedCommentShortcut})`
                  : "댓글 핀 배치"}
              description={commentPinArmed
                ? "댓글 핀 배치를 취소하고 이전 편집 도구로 돌아갑니다."
                : `캔버스의 정확한 위치를 클릭해 댓글을 남깁니다. ${formattedCommentShortcut ? `${formattedCommentShortcut}로 바로 시작하고, ` : ""}⇧·C로 핀을 숨길 수 있어요.`}
              aria-keyshortcuts={commentShortcut || undefined}
              hintPreview={commentPinArmed ? "dismiss" : "comment"}
              active={commentPinArmed}
              onClick={toggleStudioCommentPinPlacement}
            />
            ) : null}
{isRailToolVisible("perspective") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="perspective"
              icon={Triangle}
              label="투시도"
              description="소실점 가이드로 원근을 맞춥니다."
              active={perspectiveRulerActive}
              disabled={activeSurfaceReviewLocked}
              unavailableReason={activeSurfaceReviewLocked ? REVIEW_LOCK_REASON : undefined}
              onClick={() => {
                const next = !perspectiveRulerActive;
                setPerspectiveRulerActive(next);
                if (next) {
                  activateDrawTool("pen");
                  announceDrawingShortcut("투시도 켜짐 · 소실점 방향으로 펜 선을 맞춰요");
                } else {
                  announceDrawingShortcut("투시도 꺼짐");
                }
                setMenu(null);
              }}
            />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="media-3d"
              label={studioChromeRailGroupLabel("media-3d")}
            />
{isRailToolVisible("frame-anim") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="frame-anim"
              launcher
              icon={Film}
              label={frameAnimationRecoveryAvailable ? "이미지 선택하기" : "프레임 애니메이션"}
              description={
                frameAnimationRecoveryAvailable
                  ? "애니메이션으로 편집할 이미지 레이어를 먼저 선택하세요. 선택 모드에서 고른 뒤 이 위치에서 프레임 편집기로 돌아올 수 있어요."
                  : "선택한 이미지에 여러 프레임을 쌓아 간단한 셀 애니메이션을 만듭니다."
              }
              active={frameAnimOpen && frameAnimTargetId === selected?.id}
              disabled={activeSurfaceReviewLocked || selectedImageLocked}
              unavailableReason={
                activeSurfaceReviewLocked
                  ? REVIEW_LOCK_REASON
                  : selectedImageMutationLocked
                    ? IMAGE_EDIT_LOCK_REASON
                    : undefined
              }
              className={frameAnimationRecoveryAvailable ? "size-11" : undefined}
              onClick={
                frameAnimationRecoveryAvailable
                  ? onRequestSelectImage
                  : openFrameAnimationForSelected
              }
            />
            ) : null}
{isRailToolVisible("mannequin3d") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="mannequin3d"
              launcher
              icon={PersonStanding}
              label="3D 데생 인형"
              description="모델 파일 없이 체형을 조절하고 포즈를 잡아 드로잉 참고 이미지로 캡처합니다."
              active={mannequinPoserOpen}
              accented
              onClick={() => setMannequinPoserOpen?.((v) => !v)}
            />
            ) : null}
{isRailToolVisible("vrm3d") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="vrm3d"
              launcher
              icon={UsersRound}
              label="3D 캐릭터"
              description="베이스 캐릭터를 고른 뒤 포즈, 표정, 의상과 색상을 조정해 투명 배경 이미지로 추가합니다."
              active={poserVrmOpen}
              accented
              onClick={() => setPoserVrmOpen?.((v) => !v)}
            />
            ) : null}
{isRailToolVisible("character-shaper") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="character-shaper"
              launcher
              icon={Sparkles}
              label="캐릭터 셰이퍼"
              description="프리셋 카드로 얼굴·헤어·체형·의상을 고르고, 사진·웹캠으로 포즈를 잡고, 투명 PNG나 레이어 PSD로 내보냅니다."
              active={characterShaperOpen}
              accented
              onClick={() => setCharacterShaperOpen?.((v) => !v)}
            />
            ) : null}
{isRailToolVisible("bg3d") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="bg3d"
              launcher
              icon={Boxes}
              label="3D 배경"
              description="3D 오브젝트와 씬을 배치하고 카메라 앵글을 조절해 웹툰 배경 이미지를 추출합니다."
              active={bg3dOpen}
              accented
              onClick={toggleBg3dEditor}
            />
            ) : null}
{isRailToolVisible("hybrid-dcc") ? (
            <StudioRailToolButton
              data-studio-rail-tool-id="hybrid-dcc"
              launcher
              icon={Box}
              label="Hybrid 3D DCC"
              description="메시·불리언·CAD/스컬프/클로스·샷·.toon3d 하이브리드 워크스페이스를 엽니다. 웹툰 세트장 구축과 컷 연출을 한 화면에서 처리합니다."
              active={hybridDccOpen}
              accented
              onClick={() => setHybridDccOpen?.((v) => !v)}
            />
            ) : null}
{studioUiDensityAllows(uiDensityMode, "toolbar-reference") && isRailToolVisible("reference") ? (
              <StudioRailToolButton
              data-studio-rail-tool-id="reference"
                launcher
                icon={PictureInPicture2}
                label="참고 이미지"
                description="캔버스와 분리된 참고 이미지를 띄워 구도·색·의상을 보면서 작업합니다. 완성 원고에는 포함되지 않아요."
                active={referencePanelOpen}
                accented
                onClick={() => {
                  preloadStudioReferencePanel();
                  setReferencePanelOpen((v) => !v);
                }}
                onMouseEnter={preloadStudioReferencePanel}
                onFocus={preloadStudioReferencePanel}
              />
            ) : null}
            <StudioRailDivider
              data-studio-rail-group-divider="view"
              label={studioChromeRailGroupLabel("view")}
            />
            <StudioLeftToolRailViewToolsCluster
              isRailToolVisible={isRailToolVisible}
              zoomViewToolOpen={zoomViewToolOpen}
              rotateViewToolOpen={rotateViewToolOpen}
              zoomViewToolLabel={zoomViewToolLabel}
              rotateViewToolLabel={rotateViewToolLabel}
              zoomViewToolDescription={zoomViewToolOpen
                ? "현재 확대·축소 HUD를 닫고 적용한 보기 배율은 그대로 유지합니다."
                : "확대·축소 HUD를 열어 배율·화면 맞춤·100% 보기를 빠르게 조절합니다."}
              rotateViewToolDescription={rotateViewToolOpen
                ? "현재 회전 HUD를 닫고 적용한 보기 회전·반전 상태는 그대로 유지합니다."
                : "회전 HUD를 열어 캔버스를 좌·우 90°로 돌리거나 수평 반전합니다. 문서와 내보내기는 바뀌지 않아요."}
              zoomViewToolHintPreview={zoomViewToolHintProps.hintPreview}
              zoomViewToolHintVariant={zoomViewToolHintProps.hintPreviewVariant}
              rotateViewToolHintPreview={rotateViewToolHintProps.hintPreview}
              rotateViewToolHintVariant={rotateViewToolHintProps.hintPreviewVariant}
              onFitCanvasToWidth={fitCanvasToWidthWithWorkspace}
              onToggleZoomView={() => {
                setViewTool((current) => current === "zoom" ? null : "zoom");
              }}
              onToggleRotateView={() => {
                setViewTool((current) => current === "rotate" ? null : "rotate");
              }}
              viewTransformSuppressed={viewTransformSuppressed}
            />
          </StudioVerticalToolRail>
        ) : null}
    </>
  );
}
