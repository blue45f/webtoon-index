import { useEffect, useLayoutEffect, useRef } from "react";

import {
  isStudioBrushEraserAliasId,
} from "../brush/studio-brush-alias-profile";
import { studioDrawObjectRotationIsDropped } from "../brush/studio-draw-object-transform";
import { shouldApplyLayerMask } from "../layer/studio-layer-mask";
import { BUBBLE_MERGE_MIN_COUNT, bubbleMergeUnavailableReason } from "../lettering/studio-bubble-merge";
import { applyDialogueFormatPatch, convertTextElementsToBubbles } from "../lettering/studio-dialogue-format";
import { applyDialogueRubySpan, clearDialogueRubyRange } from "../lettering/studio-dialogue-ruby";
import { mergeDialogueWithNext, splitDialogueElement, transferDialogueElement } from "../lettering/studio-dialogue-structure";
import {
  resolveStudioBrushPresetOperation,
} from "../studio-brush";
import { elBounds } from "../studio-element-geometry";
import { unionStudioSelectionBounds } from "../studio-figma-selection-ux";
import { planGroupClickSelectionRelease } from "../studio-group-selection";
import { studioGroupUniformResizeMemberCanRotate } from "../studio-group-uniform-resize";
import { uid } from "../studio-id";
import { isEffectivelyHidden, isEffectivelyLocked } from "../studio-layers";
import { unionBounds } from "../studio-selection";
import {
  beginStudioSingleObjectDragLayer,
  restoreStudioSingleObjectDragLayer,
  type StudioSingleObjectDragLayerSession,
} from "../studio-single-object-drag-layer";
import { stepStudioViewZoom, toggleStudioCanvasWheelMode } from "../studio-view-controls";

import { studioCanvasCursorClassName, studioCanvasViewportCursorClassName } from "./studio-canvas-cursor";
import {
  recordStudioHotPathRender,
  studioElementIdOf,
} from "./studio-canvas-shared-runtime";
import {
  liveNodeDisplayBounds,
  localizeText,
} from "./studio-canvas-viewport-primitives";

import type {
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";
import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type Konva from "konva";

import { useMediaQuery } from "@/src/hooks/use-media-query";
import { useT } from "@/shared/lib/i18n";

export function useStudioCanvasViewportInteraction(props: StudioCanvasViewportProps) {
  const {
    activeGroupId,
    activePage,
    activeSurfaceReviewLocked,
    advancedFillArmed,
    appSettings,
    bubbleShapeArmed,
    brush,
    canvasFlipH,
    canvasInteractionBlocked,
    canvasRotation,
    collaborationDocumentLocked,
    collaborationLockMessage,
    commentPinArmed,
    cropArmed,
    dodgeBurnArmed,
    drawMode,
    editing,
    elementById,
    elements,
    eyedropperActive,
    filterMaskPaintArmed,
    groups,
    hardCanvasInteractionBlock,
    healCloneArmed,
    historyBrushArmed,
    isExporting,
    isPanning,
    isSpacePressed,
    layerMaskPaintArmed,
    liquifyArmed,
    mainLayerRef,
    marqueeIds,
    masterEditMode,
    nodeEditArmed,
    nodeRefsRef,
    pages,
    panelSplitArmed,
    perspectiveRulerActive,
    pixelToolArmed,
    puppetWarpArmed,
    quickMaskArmed,
    selected,
    selectedId,
    setMarqueeIds,
    setSelectedId,
    smudgeArmed,
    stableHandlers,
    tool,
    trRef,
    viewTransformSuppressed,
    wetMixArmed,
    zoom,
    zoomLocked,
  } = props;
  const {
    commitAppSettings,
    commitPages,
    onStageDragEnd,
    onStagePointerCancel,
    patchEl: patchElFromPage,
    selectElementFromCanvas,
    setCurrentPageId,
  } = stableHandlers;
  const singleObjectDragLayerRef = useRef<Konva.Layer>(null);
  const singleObjectDragSessionRef = useRef<StudioSingleObjectDragLayerSession | null>(null);
  function restoreSingleObjectDragLayer(): boolean {
    const session = singleObjectDragSessionRef.current;
    if (!session) return true;
    const restored = restoreStudioSingleObjectDragLayer(session);
    if (restored) singleObjectDragSessionRef.current = null;
    return restored;
  }

  function patchElementAfterDragRestore(id: string, patch: Partial<El>): void {
    if (singleObjectDragSessionRef.current?.elementId === id) {
      // Child dragend runs before the Stage dragend bubble. Restore the React-owned parent first so
      // a synchronous external-store/CRDT commit can never reconcile an imperatively lifted node.
      if (!restoreSingleObjectDragLayer()) return;
    }
    patchEl(id, patch);
  }

  function patchEl(id: string, patch: Partial<El>): void {
    // Element drag-end handlers commit before their event bubbles to Stage. Restore the lifted
    // node first so document mutation/reconciliation always starts from the authoritative Layer;
    // Stage drag-end remains the fallback for cancelled/no-op gestures.
    if (singleObjectDragSessionRef.current?.elementId === id) {
      if (!restoreSingleObjectDragLayer()) return;
    }
    patchElFromPage(id, patch);
  }

  function beginSingleObjectDragLayer(
    event: Konva.KonvaEventObject<DragEvent>,
  ): void {
    if (!restoreSingleObjectDragLayer()) return;
    if (!event.target.isDragging()) return;
    const selectedElement = selected?.id === selectedId ? selected : null;
    singleObjectDragSessionRef.current = beginStudioSingleObjectDragLayer({
      target: event.target,
      selectedElementId: selectedElement?.id ?? null,
      selectionSize: marqueeIds.length > 0 ? marqueeIds.length : selectedId ? 1 : 0,
      mainLayer: mainLayerRef.current,
      dragLayer: singleObjectDragLayerRef.current,
      transformer: trRef.current,
      selectedIsDraw: selectedElement?.type === "draw",
      hasMaskOrClip: Boolean(
        selectedElement?.clipBelow
        || (selectedElement?.type === "image" && shouldApplyLayerMask(selectedElement)),
      ),
      layerSensitiveComposite: Boolean(
        selectedElement?.blendMode
        && selectedElement.blendMode !== "source-over"
      ),
    });
  }

  function finishSingleObjectDragLayer(): void {
    if (!restoreSingleObjectDragLayer()) return;
    onStageDragEnd();
  }

  function cancelSingleObjectDragLayer(
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void {
    restoreSingleObjectDragLayer();
    onStagePointerCancel(event);
  }

  useLayoutEffect(() => {
    restoreSingleObjectDragLayer();
  }, [activePage.id, masterEditMode, marqueeIds.length, selectedId, tool]);

  useLayoutEffect(
    () => () => {
      const session = singleObjectDragSessionRef.current;
      singleObjectDragSessionRef.current = null;
      restoreStudioSingleObjectDragLayer(session);
    },
    [],
  );
  function splitDialogueText(pageId: string, elementId: string, text: string, offset: number) {
    const newElementId = uid();
    const next = splitDialogueElement(pages, {
      pageId,
      elementId,
      text,
      offset,
      newElementId,
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(pageId);
    setSelectedId(newElementId);
  }

  function mergeDialogueTextWithNext(pageId: string, elementId: string, text: string) {
    const next = mergeDialogueWithNext(pages, pageId, elementId, text);
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(pageId);
    setSelectedId(elementId);
  }

  function transferDialogueText(
    sourcePageId: string,
    elementId: string,
    targetPageId: string,
    mode: "move" | "copy",
    text: string
  ) {
    const nextElementId = mode === "copy" ? uid() : elementId;
    const next = transferDialogueElement(pages, {
      sourcePageId,
      targetPageId,
      elementId,
      mode,
      newElementId: mode === "copy" ? nextElementId : undefined,
      text,
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(targetPageId);
    setSelectedId(nextElementId);
  }

  function convertDialogueTextToBubble(pageId: string, elementId: string) {
    const next = convertTextElementsToBubbles(pages, {
      elementIds: [elementId],
      variant: "speech",
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(pageId);
    setSelectedId(elementId);
  }

  /** One undo step for many free-text → bubble conversions (story panel bulk action). */
  function convertDialogueTextsToBubbles(requests: readonly { pageId: string; elementId: string }[]) {
    if (requests.length === 0) return;
    const elementIds = requests.map((request) => request.elementId);
    const next = convertTextElementsToBubbles(pages, {
      elementIds,
      variant: "speech",
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    const last = requests[requests.length - 1];
    if (last) {
      setCurrentPageId(last.pageId);
      setSelectedId(last.elementId);
    }
  }

  function applyDialogueMultiFormat(
    elementIds: readonly string[],
    patch: {
      fontSize?: number;
      fontStyle?: "normal" | "bold" | "italic" | "bold italic";
      textColor?: string;
      align?: "left" | "center" | "right";
    }
  ) {
    const targets =
      elementIds.length > 0
        ? elementIds
        : marqueeIds.length > 0
          ? marqueeIds
          : selectedId
            ? [selectedId]
            : [];
    const next = applyDialogueFormatPatch(pages, { elementIds: targets, patch });
    if (next === pages || !commitPages(next as PageState[])) return;
  }

  function applyDialogueRuby(
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number,
    ruby: string
  ) {
    const next = applyDialogueRubySpan(pages, {
      pageId,
      elementId: elId,
      text,
      start,
      end,
      ruby,
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(pageId);
    setSelectedId(elId);
  }

  function clearDialogueRuby(
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number
  ) {
    const next = clearDialogueRubyRange(pages, {
      pageId,
      elementId: elId,
      text,
      start,
      end,
    });
    if (next === pages || !commitPages(next as PageState[])) return;
    setCurrentPageId(pageId);
    setSelectedId(elId);
  }
  // 텍스트 인라인 편집 — canvasFlipH(좌우 반전 미리보기)나 세로쓰기 요소는 캔버스 실시간 오버레이가
  // 안전하게 다룰 수 없어(StudioTextEditOverlay 상단 주석 참고) 예전 중앙 모달로 폴백한다.
  const editingTarget = editing ? elementById.get(editing.id) : null;
  const editingVertical = !!editingTarget &&
    (editingTarget.type === "text" || editingTarget.type === "bubble") && !!editingTarget.vertical;
  const editingFallbackToModal = !!editingTarget && (
    canvasFlipH || canvasRotation !== 0 || editingVertical
  );
  // 핫패스 탈React 계약의 런타임 계측점 — StudioPage 와 같은 규약(의존성 없는 effect 이므로
  // 실제 렌더된 커밋만 센다). 하네스가 싱크를 심지 않으면 no-op 이다.
  useEffect(() => {
    recordStudioHotPathRender("studio:canvas");
  });
  const editingUseOverlay = !!editingTarget && !editingFallbackToModal;
  const canvasCursorInput = {
    tool,
    drawMode,
    isSpacePressed,
    isPanning,
    interactionBlocked: canvasInteractionBlocked,
    commentPinArmed,
    eyedropperActive,
    advancedFillArmed,
    cropArmed,
    pixelToolArmed,
    panelSplitArmed,
    nodeEditArmed,
    bubbleShapeArmed,
    puppetWarpArmed,
    perspectiveRulerActive,
    precisionBrushArmed:
      smudgeArmed
      || dodgeBurnArmed
      || wetMixArmed
      || liquifyArmed
      || healCloneArmed
      || historyBrushArmed
      || layerMaskPaintArmed
      || filterMaskPaintArmed
      || quickMaskArmed,
  } as const;
  const viewportCursorClassName = studioCanvasViewportCursorClassName(canvasCursorInput);
  const canvasCursorClassName = studioCanvasCursorClassName(canvasCursorInput);
  const brushCursorStyle = appSettings.general.brushCursorStyle;
  const t = useT();
  const hasCoarsePointer = useMediaQuery("(pointer: coarse)");
  // 말풍선 병합 액션 게이트 — 다중 선택에 말풍선이 2개 이상 섞였을 때만 노출하고, 비활성
  // 사유(혼합 선택·개수 범위)는 bubbleMergeUnavailableReason으로 툴팁에 안내한다.
  const canvasSelectionIds =
    marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : [];
  const canvasSelectionEls = canvasSelectionIds
    .map((id) => elementById.get(id))
    .filter((element): element is El => element !== undefined);
  const canvasSelectionIdSet = new Set(canvasSelectionEls.map((element) => element.id));
  const marqueeSelectedEls =
    marqueeIds.length >= BUBBLE_MERGE_MIN_COUNT
      ? marqueeIds.map((id) => elementById.get(id)).filter((el): el is El => el !== undefined)
      : [];
  const selectedGroupIds = new Set(
    canvasSelectionEls
      .map((element) => element.groupId)
      .filter((groupId): groupId is string => groupId !== undefined)
  );
  const activeCanvasGroup = activeGroupId
    ? groups.find((group) => group.id === activeGroupId) ?? null
    : null;
  const activeCanvasGroupName = activeCanvasGroup
    ? activeCanvasGroup.name.trim() || "이름 없는 그룹"
    : null;
  const completeSelectionGroup =
    selectedGroupIds.size === 1
      ? groups.find((group) => {
          if (!selectedGroupIds.has(group.id)) return false;
          // 그룹에 들어간 뒤에는 모든 자식이 선택되어도 최상위 그룹 하나로 표시하지
          // 않는다. 내부 편집의 선택 경계·명령을 그대로 유지하는 PPT/Figma 동작이다.
          if (activeGroupId === group.id) return false;
          const memberIds = elements
            .filter((element) => element.groupId === group.id)
            .map((element) => element.id);
          return (
            memberIds.length > 0 &&
            memberIds.length === canvasSelectionEls.length &&
            memberIds.every((id) => canvasSelectionIdSet.has(id))
          );
        }) ?? null
      : null;
  const selectionMutationDisabledReason =
    collaborationDocumentLocked
      ? collaborationLockMessage()
      : activeSurfaceReviewLocked
        ? "검토 잠금이 켜진 작업면이에요. 잠금을 해제한 뒤 선택을 편집하세요."
        : null;
  const selectionContainsExistingGroup = canvasSelectionEls.some(
    (element) =>
      element.groupId !== undefined &&
      groups.some((group) => group.id === element.groupId)
  );
  const groupSelectionDisabledReason =
    selectionMutationDisabledReason ??
    (selectionContainsExistingGroup
      ? "기존 그룹이 포함된 선택이에요. 먼저 그룹을 해제한 뒤 다시 그룹화하세요."
      : null);
  const selectionLockedCount = canvasSelectionEls.filter((element) =>
    isEffectivelyLocked(element, groups)
  ).length;
  const topLevelSelectedGroupIds = new Set(
    canvasSelectionEls
      .map((element) => element.groupId)
      .filter(
        (groupId): groupId is string =>
          groupId !== undefined &&
          groupId !== activeGroupId &&
          groups.some((group) => group.id === groupId)
      )
  );
  const alignmentSelectionDisabledReason =
    selectionMutationDisabledReason ??
    (selectionLockedCount > 0
      ? "잠긴 객체가 포함되어 있어 정렬·분배·반전할 수 없어요. 선택 항목의 잠금을 모두 해제하세요."
      : topLevelSelectedGroupIds.size > 0 && !completeSelectionGroup
        ? "여러 그룹의 내부 배치를 보호하려고 정렬·분배·반전을 잠갔어요. 그룹 하나씩 선택해 주세요."
        : null);
  // Multi-marquee (2+) or single freehand stroke — strokes have no Konva Transformer, so
  // they share the uniform-resize proxy used for groups (competitive free-scale on one layer).
  const singleDrawFreeScale =
    marqueeIds.length === 0
    && canvasSelectionEls.length === 1
    && canvasSelectionEls[0]?.type === "draw"
    && !isEffectivelyHidden(canvasSelectionEls[0]!, groups)
    && !isEffectivelyLocked(canvasSelectionEls[0]!, groups);
  // The proxy's rotation handle is offered only where the commit could honour it: a sole stroke
  // follows the single-stroke planner's drop rule, a selection the group planner's all-or-nothing
  // verdict, which scans calligraphy strokes for effective stylus orientation. It is derived here
  // beside the other facts that gate the same proxy -- singleDrawFreeScale, multiSelectionBounds,
  // groupResizeEnabled -- so one selection cannot produce a handle and a commit that disagree.
  // Placement is not a cost argument: the decoration pass is a plain factory whose caller owns
  // every piece of state it reads, and it imports no planner to ask.
  const soleSelectionEl = canvasSelectionEls[0];
  const selectionRotatable = singleDrawFreeScale
    ? soleSelectionEl?.type === "draw" && !studioDrawObjectRotationIsDropped(soleSelectionEl)
    : canvasSelectionEls.every(studioGroupUniformResizeMemberCanRotate);
  const multiSelectionVisibleBounds =
    marqueeIds.length > 1 || singleDrawFreeScale
      ? canvasSelectionEls
          .filter((element) => !isEffectivelyHidden(element, groups))
          .map((element) => {
            // draw의 select-only hit Shape는 scene geometry가 없어 Konva Group clientRect에
            // 원점(0,0)을 끼워 넣을 수 있다. 그러면 그룹 union이 캔버스 좌상단까지 부풀고
            // 이름 배지가 화면 밖으로 사라진다. 선화는 권위 points 기반 bounds를 사용한다.
            if (element.type === "draw") {
              // Horizontal/vertical freehand lines can report 0 height/width; free-scale
              // handles require a positive box, so pad by stroke radius. That padding rule is
              // owned by `unionStudioSelectionBounds` — the same box the Design 패널 W/H,
              // 플립 피벗, 수치 변형이 읽는다. 여기서 규칙을 한 번 더 적어 두면 두 사본이
              // 조용히 갈라지는 날 선택 핸들과 사용자가 타이핑한 수치가 서로 다른 상자를
              // 가리키게 되므로, 계산은 하지 않고 그 함수에 위임한다.
              return unionStudioSelectionBounds([element]) ?? elBounds(element);
            }
            return liveNodeDisplayBounds(
              nodeRefsRef.current[element.id],
              mainLayerRef.current,
              elBounds(element),
            );
          })
      : [];
  const multiSelectionBounds =
    multiSelectionVisibleBounds.length > 0
      ? unionBounds(multiSelectionVisibleBounds)
      : null;
  // A hidden member is dropped from the box above but NOT from the selection the commit
  // transforms, so the frame would be derived from what is visible and then applied to artwork
  // outside it -- a 90-degree turn about a box that excludes it flings a hidden stroke hundreds of
  // pixels away, discovered only when it is shown again. Refuse the whole gesture exactly as a
  // locked member does, rather than silently transforming the visible subset; the sole-stroke lane
  // already requires `!isEffectivelyHidden` for the same reason.
  const selectionHasHiddenMember = canvasSelectionEls.some((element) =>
    isEffectivelyHidden(element, groups)
  );
  const selectionLockState: "locked" | "mixed" | "unlocked" =
    selectionLockedCount === 0
      ? "unlocked"
      : selectionLockedCount === canvasSelectionEls.length
        ? "locked"
        : "mixed";
  const groupResizeEnabled =
    tool === "select" &&
    !isExporting &&
    !viewTransformSuppressed &&
    !canvasInteractionBlocked &&
    !hardCanvasInteractionBlock &&
    !activeSurfaceReviewLocked &&
    selectionMutationDisabledReason === null &&
    (marqueeIds.length > 1 || singleDrawFreeScale) &&
    canvasSelectionEls.length === (marqueeIds.length > 1 ? marqueeIds.length : 1) &&
    selectionLockState === "unlocked" &&
    !selectionHasHiddenMember &&
    multiSelectionBounds !== null &&
    multiSelectionBounds.w > 0 &&
    multiSelectionBounds.h > 0;
  const groupMovementBlockedIds = new Set(
    groups
      .filter((group) =>
        elements.some(
          (element) =>
            element.groupId === group.id && isEffectivelyLocked(element, groups)
        )
      )
      .map((group) => group.id)
  );
  const marqueeBubbleCount = marqueeSelectedEls.filter((el) => el.type === "bubble").length;
  const showBubbleMerge = marqueeBubbleCount >= BUBBLE_MERGE_MIN_COUNT;
  const bubbleMergeReason = showBubbleMerge
    ? bubbleMergeUnavailableReason(marqueeSelectedEls)
    : null;
  const zoomOutAtLimit = stepStudioViewZoom(zoom, -1) === zoom;
  const zoomInAtLimit = stepStudioViewZoom(zoom, 1) === zoom;
  const zoomLockedReason = zoomLocked
    ? localizeText(t, "캔버스 배율 잠금을 먼저 해제하세요.", "studio.canvas.zoomLock.blocked")
    : undefined;
  const viewBusyReason = viewTransformSuppressed
    ? localizeText(t, "내보내기·저장·타임랩스 캡처가 끝난 뒤 보기를 조절하세요.", "studio.canvas.viewBusyHint")
    : undefined;
  const zoomOutUnavailableReason = viewBusyReason ?? zoomLockedReason ?? (zoomOutAtLimit
    ? localizeText(t, "최소 축소 배율에 도달했습니다.", "studio.canvas.zoomOutLimitReached")
    : undefined);
  const zoomInUnavailableReason = viewBusyReason ?? zoomLockedReason ?? (zoomInAtLimit
    ? localizeText(t, "최대 확대 배율에 도달했습니다.", "studio.canvas.zoomInLimitReached")
    : undefined);
  const toggleWheelCanvasMode = () => {
    commitAppSettings({
      ...appSettings,
      mouse: {
        ...appSettings.mouse,
        wheel: toggleStudioCanvasWheelMode(appSettings.mouse.wheel),
      },
    });
  };
  const enterGroupFromCanvasGesture = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    if (
      canvasInteractionBlocked ||
      tool !== "select" ||
      commentPinArmed ||
      eyedropperActive ||
      advancedFillArmed ||
      pixelToolArmed ||
      cropArmed ||
      smudgeArmed ||
      dodgeBurnArmed ||
      wetMixArmed ||
      liquifyArmed ||
      panelSplitArmed ||
      nodeEditArmed ||
      healCloneArmed ||
      layerMaskPaintArmed ||
      filterMaskPaintArmed ||
      quickMaskArmed ||
      historyBrushArmed ||
      bubbleShapeArmed ||
      puppetWarpArmed
    ) {
      return;
    }
    const elementId = studioElementIdOf(event.target);
    if (elementId) selectElementFromCanvas(elementId, event, true);
  };
  /**
   * 다중 선택 좁히기의 "뗌" 단계 — Figma/PPT/CSP 규약의 나머지 절반.
   *
   * 누름(`onSelect` → `planGroupClickSelection`)은 이미 선택된 멤버를 Shift 없이 눌러도 다중 선택을
   * 유지한다. 그래야 이어지는 드래그가 선택 전체를 함께 옮긴다. 하나로 좁히는 일은 "드래그 없이 뗐을
   * 때"만 일어나야 하는데, Konva 는 실제 드래그가 시작되면 `click`/`tap` 을 발화하지 않으므로
   * (DragAndDrop `_endDragBefore` 가 `_mouseListenClick`/`_touchListenClick` 을 내린다)
   * Stage 로 버블링된 이 두 이벤트가 곧 "드래그 없는 뗌"이다. 별도의 이동거리 추정이 필요 없다.
   *
   * 판정 자체는 `studio-group-selection` 의 순수 함수가 누름과 같은 규칙으로 계산한다 — 두 단계가
   * 갈라지지 않는다. 좁힐 게 없으면 `null` 이라 이 핸들러는 아무 상태도 건드리지 않는다.
   */
  const narrowCanvasSelectionOnRelease = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    if (
      canvasInteractionBlocked ||
      tool !== "select" ||
      commentPinArmed ||
      eyedropperActive ||
      advancedFillArmed ||
      pixelToolArmed ||
      cropArmed ||
      smudgeArmed ||
      dodgeBurnArmed ||
      wetMixArmed ||
      liquifyArmed ||
      panelSplitArmed ||
      nodeEditArmed ||
      healCloneArmed ||
      layerMaskPaintArmed ||
      filterMaskPaintArmed ||
      quickMaskArmed ||
      historyBrushArmed ||
      bubbleShapeArmed ||
      puppetWarpArmed
    ) {
      return;
    }
    // Konva 는 `mouseup` 에서 버튼과 무관하게 자체 `click` 을 합성한다. 우클릭(컨텍스트 메뉴)과
    // macOS 의 Ctrl+클릭은 선택을 좁히는 제스처가 아니다 — 멀티 선택에 대고 우클릭했는데 메뉴가
    // 하나짜리 선택에 적용되면 안 된다.
    const mouse = event.evt as Partial<MouseEvent> | undefined;
    if (typeof mouse?.button === "number" && mouse.button !== 0) return;
    if (mouse?.ctrlKey === true) return;
    const elementId = studioElementIdOf(event.target);
    if (!elementId) return;
    const narrowed = planGroupClickSelectionRelease({
      items: elements,
      groups,
      clickedId: elementId,
      current: { selectedId, marqueeIds, activeGroupId },
      additive: mouse?.shiftKey === true,
    });
    if (!narrowed) return;
    setSelectedId(narrowed.selectedId);
    setMarqueeIds(narrowed.marqueeIds);
  };
  const eraserPresetActive =
    drawMode === "eraser" && resolveStudioBrushPresetOperation(brush) === "erase";
  const lowDensityEraserActive =
    drawMode === "eraser" && isStudioBrushEraserAliasId(brush);

  return {
    activeCanvasGroupName,
    alignmentSelectionDisabledReason,
    applyDialogueMultiFormat,
    applyDialogueRuby,
    beginSingleObjectDragLayer,
    brushCursorStyle,
    bubbleMergeReason,
    cancelSingleObjectDragLayer,
    canvasCursorClassName,
    canvasSelectionEls,
    clearDialogueRuby,
    completeSelectionGroup,
    convertDialogueTextToBubble,
    convertDialogueTextsToBubbles,
    editingFallbackToModal,
    editingUseOverlay,
    enterGroupFromCanvasGesture,
    eraserPresetActive,
    finishSingleObjectDragLayer,
    groupMovementBlockedIds,
    groupResizeEnabled,
    groupSelectionDisabledReason,
    hasCoarsePointer,
    lowDensityEraserActive,
    mergeDialogueTextWithNext,
    multiSelectionBounds,
    narrowCanvasSelectionOnRelease,
    patchEl,
    patchElementAfterDragRestore,
    selectionLockState,
    selectionMutationDisabledReason,
    selectionRotatable,
    showBubbleMerge,
    singleDrawFreeScale,
    singleObjectDragLayerRef,
    splitDialogueText,
    t,
    toggleWheelCanvasMode,
    transferDialogueText,
    viewportCursorClassName,
    viewBusyReason,
    zoomInAtLimit,
    zoomInUnavailableReason,
    zoomLockedReason,
    zoomOutAtLimit,
    zoomOutUnavailableReason,
  };
}

export type StudioCanvasViewportInteraction = ReturnType<typeof useStudioCanvasViewportInteraction>;
