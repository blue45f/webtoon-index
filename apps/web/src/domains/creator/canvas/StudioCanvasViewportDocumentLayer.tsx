import { Fragment, Suspense, useLayoutEffect, type ReactNode } from "react";
import { Group, Shape } from "react-konva/lib/ReactKonvaCore";

import { BlendIsolationGroup } from "../BlendIsolationGroup";
import {
  isStudioBrushEraserAliasId,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import { getSymmetricPoints } from "../brush/studio-draw-rendering";
import { normalizeShapeParams } from "../brush/studio-stroke-shapes";
import { StudioDrawNode } from "../brush/StudioDrawNode";
import { reconcileStudioInkwashWashWithDocument } from "../brush/studio-wet-ink-brush-runtime";
import { ClipMaskGroup } from "../ClipMaskGroup";
import { shouldApplyLayerMask } from "../layer/studio-layer-mask";
import { imageFilterCacheKey } from "../render/studio-konva-filter-fields";
import { studioAdjustmentStackToFilterFields } from "../studio-adjustment-stack";
import { resolveTimelineComposite, resolveTimelineTransforms } from "../studio-anim-tracks";
import { containingPanel, elBounds } from "../studio-element-geometry";
import { studioKonvaDrawTransformRecoveryPendingForElement } from "../studio-live-transform-gesture-konva";
import { studioLiveTransformPreviewBlockedForElement } from "../studio-live-transform-preview-eligibility";
import { clampFrameIndex, frameIndexOf, onionSkinLayers } from "../studio-frame-animation";
import { isEffectivelyHidden, isEffectivelyLocked } from "../studio-layers";
import { MASTER_EDIT_GHOST_OPACITY } from "../studio-master-page";
import {
  StudioOnionSkinImage,
} from "../studio-page-lazy-ui";
import { isEligibleForPanelAutoFit } from "../studio-panel-autofit";
import { STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR } from "../studio-selection-chrome-mirror";
import { materializeStudioAdvancedFillVectorTarget } from "../studio-vector-fill-reference";
import { StudioKonvaBubbleNode } from "../StudioKonvaBubbleNode";
import { StudioKonvaImageNode } from "../StudioKonvaImageNode";
import { StudioFocusLinesNode, StudioFramePanel, StudioSpeedLinesNode, StudioWorkAssetPlaceholderNode } from "../StudioKonvaPrimitiveNodes";
import { StudioKonvaStickerNode, StudioKonvaTextNode } from "../StudioKonvaTextNodes";

import { studioCanonicalDryMediaOwnsDocumentElement } from "./studio-canonical-dry-media-authority";

import type {
  StudioCanvasViewportHandlers,
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";
import type { StudioPaperSurfaceSettings } from "../brush/studio-paper-granulation-runtime";
import type { StudioLiveGesturePreviewRenderPlan } from "../live/studio-live-gesture-preview-projection";
import type { El, FrameEl, ImageEl } from "../studio-element-model";
import type Konva from "konva";

export interface StudioCanvasViewportDocumentLayerProps {
  activeGroupId: StudioCanvasViewportProps["activeGroupId"];
  activePage: StudioCanvasViewportProps["activePage"];
  activeSurfaceReviewLocked: StudioCanvasViewportProps["activeSurfaceReviewLocked"];
  advancedFillArmed: StudioCanvasViewportProps["advancedFillArmed"];
  advancedFillPreview: StudioCanvasViewportProps["advancedFillPreview"];
  animTimeline: StudioCanvasViewportProps["animTimeline"];
  bubbleShapeArmed: StudioCanvasViewportProps["bubbleShapeArmed"];
  bubbleShapeDraft: StudioCanvasViewportProps["bubbleShapeDraft"];
  canonicalDryMediaHiddenElementId: string | null;
  commitTextTransformEnd: StudioCanvasViewportHandlers["commitTextTransformEnd"];
  cropArmed: StudioCanvasViewportProps["cropArmed"];
  dodgeBurnArmed: StudioCanvasViewportProps["dodgeBurnArmed"];
  drawingRef: StudioCanvasViewportProps["drawingRef"];
  effScale: StudioCanvasViewportProps["effScale"];
  endLiveResourceEdit: StudioCanvasViewportHandlers["endLiveResourceEdit"];
  filterMaskPaintArmed: StudioCanvasViewportProps["filterMaskPaintArmed"];
  frameAnimOpen: StudioCanvasViewportProps["frameAnimOpen"];
  frameAnimTargetId: StudioCanvasViewportProps["frameAnimTargetId"];
  groupMovementBlockedIds: ReadonlySet<string>;
  groups: StudioCanvasViewportProps["groups"];
  healCloneArmed: StudioCanvasViewportProps["healCloneArmed"];
  historyBrushArmed: StudioCanvasViewportProps["historyBrushArmed"];
  isCanvasGroupDragActive: StudioCanvasViewportHandlers["isCanvasGroupDragActive"];
  isExporting: StudioCanvasViewportProps["isExporting"];
  layerMaskPaintArmed: StudioCanvasViewportProps["layerMaskPaintArmed"];
  liquifyArmed: StudioCanvasViewportProps["liquifyArmed"];
  localHiddenElementIds: StudioCanvasViewportProps["localHiddenElementIds"];
  marqueeIds: StudioCanvasViewportProps["marqueeIds"];
  masterEditMode: StudioCanvasViewportProps["masterEditMode"];
  masterRenderEls: StudioCanvasViewportProps["masterRenderEls"];
  nodeEditArmed: StudioCanvasViewportProps["nodeEditArmed"];
  nodeEditDraft: StudioCanvasViewportProps["nodeEditDraft"];
  nodeInteractionBegin: StudioCanvasViewportHandlers["nodeInteractionBegin"];
  onionSkin: StudioCanvasViewportProps["onionSkin"];
  onHokusaiCanonicalImageReady: StudioCanvasViewportHandlers["onHokusaiCanonicalImageReady"];
  onLivingInkCanonicalImageReady: StudioCanvasViewportHandlers["onLivingInkCanonicalImageReady"];
  pagesHi: StudioCanvasViewportProps["pagesHi"];
  paperSurfaceForPreview: StudioPaperSurfaceSettings;
  panelSplitArmed: StudioCanvasViewportProps["panelSplitArmed"];
  patchEl: (id: string, patch: Partial<El>) => void;
  patchElementAfterDragRestore: (id: string, patch: Partial<El>) => void;
  pixelToolArmed: StudioCanvasViewportProps["pixelToolArmed"];
  puppetWarpArmed: StudioCanvasViewportProps["puppetWarpArmed"];
  quickMaskArmed: StudioCanvasViewportProps["quickMaskArmed"];
  selectElementFromCanvas: StudioCanvasViewportHandlers["selectElementFromCanvas"];
  selectedId: StudioCanvasViewportProps["selectedId"];
  selectionLockState: "unlocked" | "locked" | "mixed";
  setElementNodeRef: StudioCanvasViewportHandlers["setElementNodeRef"];
  smudgeArmed: StudioCanvasViewportProps["smudgeArmed"];
  snapBoundFunc: StudioCanvasViewportHandlers["snapBoundFunc"];
  startEditText: StudioCanvasViewportHandlers["startEditText"];
  studioFilterPageComposite: StudioCanvasViewportProps["studioFilterPageComposite"];
  studioFilterPreview: StudioCanvasViewportProps["studioFilterPreview"];
  studioLiveGesturePreviewRenderPlan: StudioLiveGesturePreviewRenderPlan;
  studioRasterHiddenOperationIds: StudioCanvasViewportProps["studioRasterHiddenOperationIds"];
  studioWorkAssetRenderPlaceholders: StudioCanvasViewportProps["studioWorkAssetRenderPlaceholders"];
  studioWorkAssetRenderProjection: StudioCanvasViewportProps["studioWorkAssetRenderProjection"];
  timelineOpen: StudioCanvasViewportProps["timelineOpen"];
  timelinePlayhead: StudioCanvasViewportProps["timelinePlayhead"];
  timelinePlaying: StudioCanvasViewportProps["timelinePlaying"];
  timelinePreviewFrame: StudioCanvasViewportProps["timelinePreviewFrame"];
  timelapseCapturing: StudioCanvasViewportProps["timelapseCapturing"];
  tool: StudioCanvasViewportProps["tool"];
  webtoonTheme: StudioCanvasViewportProps["webtoonTheme"];
  wetMixArmed: StudioCanvasViewportProps["wetMixArmed"];
}

export function StudioCanvasViewportDocumentLayer({
  activeGroupId,
  activePage,
  activeSurfaceReviewLocked,
  advancedFillArmed,
  advancedFillPreview,
  animTimeline,
  bubbleShapeArmed,
  bubbleShapeDraft,
  canonicalDryMediaHiddenElementId,
  commitTextTransformEnd,
  cropArmed,
  dodgeBurnArmed,
  drawingRef,
  effScale,
  endLiveResourceEdit,
  filterMaskPaintArmed,
  frameAnimOpen,
  frameAnimTargetId,
  groupMovementBlockedIds,
  groups,
  healCloneArmed,
  historyBrushArmed,
  isCanvasGroupDragActive,
  isExporting,
  layerMaskPaintArmed,
  liquifyArmed,
  localHiddenElementIds,
  marqueeIds,
  masterEditMode,
  masterRenderEls,
  nodeEditArmed,
  nodeEditDraft,
  nodeInteractionBegin,
  onionSkin,
  onHokusaiCanonicalImageReady,
  onLivingInkCanonicalImageReady,
  pagesHi,
  paperSurfaceForPreview,
  panelSplitArmed,
  patchEl,
  patchElementAfterDragRestore,
  pixelToolArmed,
  puppetWarpArmed,
  quickMaskArmed,
  selectElementFromCanvas,
  selectedId,
  selectionLockState,
  setElementNodeRef,
  smudgeArmed,
  snapBoundFunc,
  startEditText,
  studioFilterPageComposite,
  studioFilterPreview,
  studioLiveGesturePreviewRenderPlan,
  studioRasterHiddenOperationIds,
  studioWorkAssetRenderPlaceholders,
  studioWorkAssetRenderProjection,
  timelineOpen,
  timelinePlayhead,
  timelinePlaying,
  timelinePreviewFrame,
  timelapseCapturing,
  tool,
  webtoonTheme,
  wetMixArmed,
}: StudioCanvasViewportDocumentLayerProps) {
                // Only this paint-time array may contain ephemeral Blob URLs. The authored
                // `elements`, page history, autosave, revisions, and CRDT publisher continue to
                // see stable work-asset URIs.
                const canvasRenderElements: El[] = studioFilterPreview
                  ? studioLiveGesturePreviewRenderPlan.elements.map((element) =>
                      element.id === studioFilterPreview.elementId && element.type === "image"
                        ? ({ ...element, ...studioFilterPreview.patch } as El)
                        : element,
                    )
                  : [...studioLiveGesturePreviewRenderPlan.elements];
                if (studioFilterPageComposite) {
                  const previewComposite = studioFilterPreview?.elementId === studioFilterPageComposite.id
                    ? ({ ...studioFilterPageComposite, ...studioFilterPreview.patch } as ImageEl & El)
                    : studioFilterPageComposite;
                  canvasRenderElements.push({
                    ...previewComposite,
                    locked: true,
                    noClip: true,
                  });
                }
                // 공유 수묵 워시는 침착만 알고 삭제를 모른다. Konva 가 이 커밋을 그리기 전에
                // (layout effect 는 react-konva 의 rAF batchDraw 보다 앞선다) 페이지의 수묵 획
                // 집합과 대조해, Undo·삭제·이동·페이지 전환으로 사라진 획의 안료를 걷어낸다.
                const inkwashDocumentElements: El[] =
                  !masterEditMode && !activePage.hideMaster
                    ? [...masterRenderEls, ...canvasRenderElements]
                    : canvasRenderElements;
                useLayoutEffect(() => {
                  reconcileStudioInkwashWashWithDocument(inkwashDocumentElements);
                }, [inkwashDocumentElements]);
                const virtualFillPreviewTarget =
                  !timelapseCapturing &&
                  advancedFillPreview?.virtualTarget &&
                  advancedFillPreview.historyIndex === pagesHi
                    ? advancedFillPreview.virtualTarget
                    : null;
                if (virtualFillPreviewTarget) {
                  const virtualFillPreviewElement: El = {
                    ...materializeStudioAdvancedFillVectorTarget(
                      virtualFillPreviewTarget,
                      advancedFillPreview!.resultSrc,
                    ),
                    locked: true,
                    noClip: true,
                  };
                  const insertionIndex = Math.max(
                    0,
                    Math.min(virtualFillPreviewTarget.insertionIndex, canvasRenderElements.length),
                  );
                  canvasRenderElements.splice(insertionIndex, 0, virtualFillPreviewElement);
                }
                // 다중 레이어 타임라인 재생 미리보기 — 재생 중에만 계산(커밋 없이 렌더 시점 override).
                // 정지 상태(timelinePlaying=false)면 항상 null이라 기존 렌더 경로와 100% 동일.
                const timelineComposite = timelinePlaying
                  ? resolveTimelineComposite(animTimeline, canvasRenderElements.map((e) => e.id), timelinePreviewFrame)
                  : null;
                // Preview-only transform tween (display offsets; does not commit to history).
                const timelineTransformFrame = timelinePlaying ? timelinePreviewFrame : timelinePlayhead;
                const timelineTransforms =
                  timelineOpen || timelinePlaying
                    ? resolveTimelineTransforms(
                        animTimeline,
                        canvasRenderElements.map((e) => e.id),
                        timelineTransformFrame
                      )
                    : null;
                // 이미지 드래그-드롭 패널 자동맞춤(studio-panel-autofit) 후보 프레임 — renderEl 안에서
                // 이미지 요소마다 매번 다시 필터링하지 않도록 렌더당 한 번만 계산한다. hidden 프레임은
                // containingPanel()과 동일하게 제외한다(자동맞춤 결과도 결국 그 클립 메커니즘에
                // 기대므로 대상이 일치해야 한다). locked 프레임은 제외하지 않는다(containingPanel()도
                // 프레임의 locked 여부를 보지 않는다 — "잠금"은 프레임 자체가 옮겨지지 않게 하는 것이지
                // 다른 요소가 그 위에 도킹되는 걸 막는 개념이 아니다).
                const autoFitFrameCandidates = canvasRenderElements.filter((e): e is FrameEl => e.type === "frame" && !e.hidden);
                // 한 요소를 렌더하는 함수. opts.asMask=클리핑 마스크의 베이스 사본(비상호작용),
                // opts.compositeOverride=알파 클리핑 자식의 "source-in" 합성.
                const renderEl = (el: El, idx: number, opts: { asMask?: boolean; compositeOverride?: string } = {}) => {
                const isAdvancedFillVirtualPreview = virtualFillPreviewTarget?.id === el.id;
                const isLiveGesturePreview =
                  studioLiveGesturePreviewRenderPlan.previewElementIds.has(el.id);
                const isNonInteractiveRender =
                  opts.asMask === true
                  || isAdvancedFillVirtualPreview
                  || isLiveGesturePreview;
                const locked = isAdvancedFillVirtualPreview || isEffectivelyLocked(el, groups);
                const isGroupDragMember =
                  marqueeIds.length > 1 && marqueeIds.includes(el.id);
                const topLevelGroupMovementBlocked =
                  el.groupId !== undefined &&
                  activeGroupId !== el.groupId &&
                  groupMovementBlockedIds.has(el.groupId);
                const selectedUnitMovementBlocked =
                  isGroupDragMember && selectionLockState !== "unlocked";
                // 픽셀 선택/크롭/패널 컷/노드 편집/문지르기/복구브러시 무장 중엔 요소 드래그를 잠근다 — 캔버스 드래그가 도구 조작으로 간다.
                const draggable =
                  !isNonInteractiveRender &&
                  !activeSurfaceReviewLocked &&
                  tool === "select" &&
                  !locked &&
                  !topLevelGroupMovementBlocked &&
                  !selectedUnitMovementBlocked &&
                  !advancedFillArmed &&
                  !pixelToolArmed &&
                  !cropArmed &&
                  !panelSplitArmed &&
                  !nodeEditArmed &&
                  !smudgeArmed &&
                  !dodgeBurnArmed &&
                  !wetMixArmed &&
                  !liquifyArmed &&
                  !healCloneArmed &&
                  !layerMaskPaintArmed &&
                  !filterMaskPaintArmed &&
                  !quickMaskArmed &&
                  !historyBrushArmed &&
                  !bubbleShapeArmed &&
                  !puppetWarpArmed;
                // 잠긴 요소(이메레스 밑그림 등)도 선택 모드에선 클릭 선택 허용 — 삭제/잠금해제 가능하게.
                // 이동·변형은 여전히 막힘(draggable=false·트랜스포머 미부착). 드로잉 모드(tool!=="select")엔 무영향.
                // 무장 중 클릭 선택 전환도 잠근다 — 제스처 도중 대상 이미지가 바뀌면 선택 좌표계가 깨진다.
                const onSelect = isNonInteractiveRender
                  ? () => {}
                  : (evt?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
                      if (
                        activeSurfaceReviewLocked ||
                        tool !== "select" ||
                        advancedFillArmed ||
                        pixelToolArmed ||
                        cropArmed ||
                        panelSplitArmed ||
                        nodeEditArmed ||
                        smudgeArmed ||
                        dodgeBurnArmed ||
                        wetMixArmed ||
                        liquifyArmed ||
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
                      // 그룹으로 묶인 요소는 PPT/Figma처럼 그룹 전체가 한 단위로 선택된다. Shift=그룹 단위
                      // 가산, 더블클릭=그룹 진입(개별 자식 편집). 순수 로직은 selectElementFromCanvas가 위임.
                      selectElementFromCanvas(el.id, evt);
                    };
                const setRef = isNonInteractiveRender
                  ? () => {}
                  : (n: Konva.Node | null) => {
                      setElementNodeRef(el.id, n);
                    };
                // 패널 내부 콘텐츠 클리핑(들어간 패널 영역). 아래 레이어 클리핑 마스크는 ClipMaskGroup이 알파로 처리한다.
                const panelClip = el.noClip ? null : containingPanel(el, canvasRenderElements);
                const clip = panelClip
                  ? { x: panelClip.x, y: panelClip.y, width: panelClip.width, height: panelClip.height }
                  : null;
                const wrapRenderInteraction = (node: ReactNode) =>
                  isNonInteractiveRender ? (
                    <Group
                      key={`${el.id}-non-interactive-render`}
                      listening={false}
                    >
                      {node}
                    </Group>
                  ) : (
                    node
                  );
                const wrapClip = (node: ReactNode) => {
                  const composite = (opts.compositeOverride ??
                    (el.blendMode || "source-over")) as NonNullable<
                    Konva.NodeConfig["globalCompositeOperation"]
                  >;
                  // 합성 모드가 켜진 요소는 캐시 그룹으로 평탄화해야 한다. 평범한 Group에
                  // globalCompositeOperation을 걸면 자식 스탬프 하나하나가 레이어와 개별
                  // 합성되어, 한 획(스탬프 수십 개)이 같은 물리를 그만큼 반복 적용받는다.
                  // 실측: 단일 탭(fill 1회) 곱하기는 이론값과 1/255 일치하는데 30스탬프 획은
                  // 검정으로 붕괴했다. BlendIsolationGroup이 획을 비트맵 한 장으로 만든 뒤
                  // 합성을 정확히 한 번 적용한다.
                  const isolatedComposite = composite !== "source-over" && composite !== "destination-out";
                  const previewSequence =
                    studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(el.id);
                  const blendCacheKey = isolatedComposite
                    ? [
                        el.id,
                        composite,
                        pagesHi,
                        previewSequence ?? "authoritative",
                        JSON.stringify(elBounds(el)),
                      ].join("|")
                    : "";
                  const clippedNode = isolatedComposite ? (
                    <BlendIsolationGroup
                      key={el.id}
                      cacheKey={blendCacheKey}
                      composite={composite}
                      {...(clip ? { clip } : {})}
                    >
                      {node}
                    </BlendIsolationGroup>
                  ) : clip ? (
                    <Group key={el.id} clipX={clip.x} clipY={clip.y} clipWidth={clip.width} clipHeight={clip.height}>
                      {node}
                    </Group>
                  ) : (
                    node
                  );
                  return wrapRenderInteraction(clippedNode);
                };
                if (el.type === "image") {
                  const isAnimTarget = frameAnimOpen && el.id === frameAnimTargetId && el.frames && el.frames.length > 1;
                  const onion = isAnimTarget
                    ? onionSkinLayers(el.frames!, clampFrameIndex(el.frames!, frameIndexOf(el.frames!, el.activeFrameId ?? null)), onionSkin)
                    : [];
                  // 단일-셀 온스킨(isAnimTarget)과 다중-트랙 재생 미리보기가 같은 요소를 동시에
                  // 건드리면 두 오버레이가 정의되지 않은 방식으로 충돌한다 — 패널의 eligible 계산이
                  // 이미 두 시스템을 UI 레벨에서 상호배제하지만(같은 요소는 frames.length>1 이면
                  // 트랙 추가가 애초에 막힘), 여기서도 방어적으로 한 번 더 가드한다.
                  const timelineOverride = isAnimTarget ? undefined : timelineComposite?.get(el.id);
                  const advancedFillPreviewSrc =
                    !timelapseCapturing &&
                    advancedFillPreview?.targetId === el.id &&
                    advancedFillPreview.historyIndex === pagesHi
                      ? advancedFillPreview.resultSrc
                      : undefined;
                  // 사용자가 아직 적용하지 않은 채우기 미리보기가 가장 높은 우선순위다. 타임라인 재생
                  // 중엔 도구 진입이 막히지만, 이미 만든 미리보기를 잃지 않고 적용/취소할 수는 있어야 한다.
                  const effectiveSrc = advancedFillPreviewSrc ?? timelineOverride?.src;
                  const smartFilterFields = studioAdjustmentStackToFilterFields(el.smartFilters);
                  const pose = timelineTransforms?.get(el.id);
                  const effectiveEl = {
                    ...el,
                    ...smartFilterFields,
                    ...(effectiveSrc ? { src: effectiveSrc } : null),
                    ...(pose
                      ? {
                          x: el.x + pose.x,
                          y: el.y + pose.y,
                          rotation: (el.rotation ?? 0) + pose.rotation,
                          width: Math.max(1, el.width * pose.scaleX),
                          height: Math.max(1, el.height * pose.scaleY),
                        }
                      : null),
                  } as ImageEl;
                  // 패널 자동맞춤(studio-panel-autofit) — 이 이미지가 드래그 종료 시 자동맞춤을
                  // 시도해도 되는지 여기서 전부 판정해 autoFitFrames 하나로 StudioKonvaImageNode 에 넘긴다.
                  // null 이면 StudioKonvaImageNode 는 시도조차 하지 않고 기존과 완전히 동일하게 {x,y}만 패치한다.
                  //
                  // isGroupDragMember 가드는 필수다 — 다중 선택(marqueeIds.length > 1)으로 이 이미지를
                  // 포함해 여러 요소를 함께 끌면, onStageDragEnd 가 드래그 시작 시점의 stale elements
                  // 스냅샷 + 델타로 marqueeIds 전원을 별도로 한 번 더 commit 한다 — 이 자동맞춤이 먼저
                  // 커밋한 결과(오버사이즈 박스)를 그 델타 커밋이 곧바로 덮어써 버려(원래의 "옮겨진
                  // 원본 위치 + 델타"로 되돌아감) 화면이 한 프레임 반짝인 뒤 자동맞춤이 무효화되는
                  // 버그가 된다. 그룹 드래그 중엔 이 기능을 아예 끄는 것으로 피한다 — 사용자 의도도
                  // "이 이미지를 패널에 맞추기"가 아니라 "선택한 여러 요소를 함께 옮기기"이므로
                  // 자연스러운 선택이기도 하다.
                  //
                  // isEligibleForPanelAutoFit 은 회전/기울임/다중 프레임 셀 애니메이션/noClip 을
                  // 걸러낸다 — 각 사유는 studio-panel-autofit.ts 의 isEligibleForPanelAutoFit
                  // docstring 참고.
                  const autoFitFrames =
                    !isGroupDragMember &&
                    !isCanvasGroupDragActive(el.id) &&
                    autoFitFrameCandidates.length > 0 &&
                    isEligibleForPanelAutoFit({
                      rotation: el.rotation,
                      skewX: el.skewX,
                      skewY: el.skewY,
                      frameCount: el.frames?.length,
                      noClip: el.noClip,
                    })
                      ? autoFitFrameCandidates
                      : null;
                  return wrapClip(
                    <Fragment key={el.id}>
                      <Suspense fallback={null}>
                        {onion.map((layer) => (
                          <StudioOnionSkinImage
                            key={`onion-${el.id}-${layer.frame.id}`}
                            el={el}
                            layer={layer}
                          />
                        ))}
                      </Suspense>
                      <StudioKonvaImageNode
                        el={effectiveEl}
                        draggable={draggable}
                        innerRef={setRef}
                        onSelect={onSelect}
                        onChange={(patch) => {
                          // 클릭 직후 시작된 그룹 드래그는 렌더 시점의 isGroupDragMember가
                          // 아직 false일 수 있다. 이 런타임 가드가 이미지 노드의 drag-end
                          // {x,y}/auto-fit 커밋 전체를 소비하고 Stage의 원자 그룹 커밋만 남긴다.
                          if (isCanvasGroupDragActive(el.id)) return;
                          patchElementAfterDragRestore(el.id, patch);
                        }}
                        dragBoundFunc={snapBoundFunc}
                        autoFitFrames={autoFitFrames}
                        onInteractionBegin={() => nodeInteractionBegin(el.id)}
                        onInteractionEnd={endLiveResourceEdit}
                        liveStrokeRef={drawingRef}
                        onHokusaiCanonicalImageReady={onHokusaiCanonicalImageReady}
                        onLivingInkCanonicalImageReady={onLivingInkCanonicalImageReady}
                        rasterPresentationEligible={!isNonInteractiveRender}
                      />
                    </Fragment>
                  );
                }
                if (el.type === "frame") {
                  return wrapRenderInteraction(
                    <StudioFramePanel
                      key={el.id}
                      el={el}
                      theme={webtoonTheme}
                      draggable={draggable}
                      innerRef={setRef}
                      onSelect={onSelect}
                      onChange={(patch) => patchElementAfterDragRestore(el.id, patch as Partial<El>)}
                      dragBoundFunc={snapBoundFunc}
                      onInteractionBegin={() => nodeInteractionBegin(el.id)}
                      onInteractionEnd={endLiveResourceEdit}
                    />
                  );
                }
                if (el.type === "focusLines")
                  return wrapClip(
                    <StudioFocusLinesNode
                      key={el.id}
                      el={el}
                      draggable={draggable}
                      innerRef={setRef}
                      onSelect={onSelect}
                      onChange={(patch) => patchElementAfterDragRestore(el.id, patch)}
                      dragBoundFunc={snapBoundFunc}
                      onInteractionBegin={() => nodeInteractionBegin(el.id)}
                      onInteractionEnd={endLiveResourceEdit}
                    />
                  );
                if (el.type === "speedLines")
                  return wrapClip(
                    <StudioSpeedLinesNode
                      key={el.id}
                      el={el}
                      draggable={draggable}
                      innerRef={setRef}
                      onSelect={onSelect}
                      onChange={(patch) => patchElementAfterDragRestore(el.id, patch)}
                      dragBoundFunc={snapBoundFunc}
                      onInteractionBegin={() => nodeInteractionBegin(el.id)}
                      onInteractionEnd={endLiveResourceEdit}
                    />
                  );
                if (el.type === "draw") {
                  // 노드 편집 드래그 중엔 커밋 전 초안을 얕게 병합해 그대로 넘긴다 — StudioDrawNode
                  // 는 points/pressures 로부터 매끈화·굵기를 재계산하므로 별도 로직 중복 없이
                  // "라이브 리셰이프"가 커밋될 최종 결과와 픽셀 단위로 동일하게 미리보기된다.
                  const liveEl =
                    nodeEditDraft?.elId === el.id ? { ...el, points: nodeEditDraft.points, pressures: nodeEditDraft.pressures } : el;
                  const hitPointVariations =
                    tool === "select"
                      ? getSymmetricPoints(liveEl.points, liveEl.symmetry)
                      : [];
                  const hitKind = liveEl.kind ?? "freehand";
                  const hitShapeParams = normalizeShapeParams(liveEl.shapeParams);
                  // Generous screen-space hit pad so thin strokes stay clickable at high zoom
                  // (layer-scoped transform/crop starts with a reliable single-layer select).
                  const hitStrokeWidth = Math.max(
                    liveEl.mode === "eraser"
                      && !isStudioBrushEraserAliasId(liveEl.brush)
                      ? liveEl.strokeWidth
                      : studioBrushAliasEffectiveDiameter(
                          liveEl.brush,
                          liveEl.strokeWidth
                        ),
                    16 / Math.max(effScale, 0.001)
                  );
                  const hitClosedShape =
                    hitKind === "rect" ||
                    hitKind === "ellipse" ||
                    hitKind === "star" ||
                    hitKind === "triangle" ||
                    hitKind === "polygon";
                  return wrapClip(
                    <Group
                      key={el.id}
                      studioElementId={el.id}
                      // Symmetry generates its copies about WORLD axes, and the model stores no
                      // axis angle (type/centerX/centerY/radialCount only). So a live affine
                      // preview shows `A ∘ S` — every already-generated copy transformed — while
                      // the commit transforms the base points and centre and lets the renderer
                      // regenerate copies as `S ∘ A`. Those differ whenever the two do not
                      // commute, so a rotated mirror-symmetry stroke would commit artwork the
                      // preview never showed. Marked here, where the element is in hand, and
                      // refused by studioLiveTransformPreviewEligible.
                      studioLiveTransformPreviewBlocked={
                        studioLiveTransformPreviewBlockedForElement(el, hitClosedShape)
                          ? true
                          : undefined
                      }
                      ref={setRef}
                      x={0}
                      y={0}
                      globalCompositeOperation={el.mode === "eraser" ? "destination-out" : undefined}
                      draggable={draggable}
                      dragBoundFunc={snapBoundFunc}
                      onMouseDown={onSelect}
                      onTap={onSelect}
                      onDragStart={(event) => {
                        // Setup can throw after moving this wrapper to the gesture Layer. Its
                        // phase-aware rollback then owns the node from a module registry because
                        // no pointer-session token could be returned. Do not acquire a new page
                        // interaction lease while that older writer is still restoring the node.
                        if (studioKonvaDrawTransformRecoveryPendingForElement(el.id)) {
                          event.target.stopDrag();
                          return;
                        }
                        // A live transform preview repurposes this wrapper's x/y as the gesture's
                        // ABSOLUTE target-box origin, not a drag offset. A concurrent drag (second
                        // finger on a touch device while the first holds a Transformer anchor)
                        // would end up reading that projection as a delta below and baking it into
                        // `points`. The gesture owns the node until it neutralizes the attr.
                        if (
                          (event.target as Konva.Node)
                            .getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR) === true
                        ) {
                          event.target.stopDrag();
                          return;
                        }
                        if (!nodeInteractionBegin(el.id)) event.target.stopDrag();
                      }}
                      onDragEnd={(event) => {
                        // `stopDrag()` above can produce a trailing dragend. The blocked drag did
                        // not acquire the page interaction lease, so it must neither bake a delta
                        // nor release the older recovery owner's lease.
                        if (studioKonvaDrawTransformRecoveryPendingForElement(el.id)) {
                          return;
                        }
                        // Same guard on the trailing edge: a drag that began before the transform
                        // (or one Konva ends after the preview took the node) must not bake the
                        // preview projection, and must not release a lease it never took.
                        if (
                          (event.target as Konva.Node)
                            .getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR) === true
                        ) {
                          return;
                        }
                        try {
                          // 다중선택은 Stage onDragEnd가 좌표형 자식과 함께 한 히스토리 스냅샷으로
                          // 확정한다. 단일 선화만 끌었을 때는 wrapper 오프셋을 points에 직접 굽는다.
                          if (
                            isGroupDragMember ||
                            isCanvasGroupDragActive(el.id)
                          ) {
                            return;
                          }
                          const deltaX = event.target.x();
                          const deltaY = event.target.y();
                          event.target.position({ x: 0, y: 0 });
                          if (deltaX === 0 && deltaY === 0) return;
                          patchEl(el.id, {
                            points: liveEl.points.map((value, index) =>
                              value + (index % 2 === 0 ? deltaX : deltaY)
                            ),
                          } as Partial<El>);
                        } finally {
                          endLiveResourceEdit();
                        }
                      }}
                    >
                      <StudioDrawNode
                        el={liveEl}
                        activeDraft={isLiveGesturePreview}
                        paperSurface={paperSurfaceForPreview}
                      />
                      {/* StudioDrawNode의 실제 페인트 노드는 드로잉 핫패스를 위해 listening=false다.
                          선택 도구일 때만 이 scene-less hit shape가 실제 polyline/도형 경로를 화면
                          10px 허용폭으로 포착한다. 긴 대각선의 빈 bbox는 hit가 아니며, 닫힌 도형도
                          실제 fill이 있을 때만 내부를 잡는다. */}
                      {tool === "select" && !isNonInteractiveRender ? (
                        <Shape
                          sceneFunc={() => undefined}
                          hitFunc={(context, shape) => {
                            for (const points of hitPointVariations) {
                              if (points.length < 2) continue;
                              if (points.length === 2) {
                                // A tap is retained as a visible round/elliptic brush footprint.
                                // A moveTo-only path has zero hit area, so give it a stroke-backed
                                // disc whose screen tolerance matches the rest of the draw hit path.
                                context.beginPath();
                                context.arc(
                                  points[0]!,
                                  points[1]!,
                                  Math.max(0.1, hitStrokeWidth / 4),
                                  0,
                                  Math.PI * 2
                                );
                                context.closePath();
                                context.fillStrokeShape(shape);
                                continue;
                              }
                              let minX = points[0]!;
                              let minY = points[1]!;
                              let maxX = minX;
                              let maxY = minY;
                              for (let pointIndex = 2; pointIndex < points.length; pointIndex += 2) {
                                const x = points[pointIndex] ?? maxX;
                                const y = points[pointIndex + 1] ?? maxY;
                                minX = Math.min(minX, x);
                                minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x);
                                maxY = Math.max(maxY, y);
                              }
                              const width = Math.max(0.1, maxX - minX);
                              const height = Math.max(0.1, maxY - minY);
                              context.beginPath();
                              if (hitKind === "rect") {
                                context.rect(minX, minY, width, height);
                                context.closePath();
                              } else if (hitKind === "ellipse") {
                                const radiusX = Math.max(0.1, width / 2);
                                const radiusY = Math.max(0.1, height / 2);
                                context.save();
                                context.translate(minX + width / 2, minY + height / 2);
                                context.scale(1, radiusY / radiusX);
                                context.arc(0, 0, radiusX, 0, Math.PI * 2);
                                context.restore();
                                context.closePath();
                              } else if (
                                hitKind === "star" ||
                                hitKind === "triangle" ||
                                hitKind === "polygon"
                              ) {
                                const centerX = minX + width / 2;
                                const centerY = minY + height / 2;
                                const radius = Math.max(0.1, Math.min(width, height) / 2);
                                const vertices =
                                  hitKind === "triangle"
                                    ? 3
                                    : hitKind === "polygon"
                                      ? hitShapeParams.polygonSides
                                      : hitShapeParams.starPoints * 2;
                                for (let vertex = 0; vertex < vertices; vertex += 1) {
                                  const angle = -Math.PI / 2 + (vertex * Math.PI * 2) / vertices;
                                  const vertexRadius =
                                    hitKind === "star" && vertex % 2 === 1
                                      ? radius * hitShapeParams.starInnerRatio
                                      : radius;
                                  const x = centerX + Math.cos(angle) * vertexRadius;
                                  const y = centerY + Math.sin(angle) * vertexRadius;
                                  if (vertex === 0) context.moveTo(x, y);
                                  else context.lineTo(x, y);
                                }
                                context.closePath();
                              } else {
                                context.moveTo(points[0]!, points[1]!);
                                for (
                                  let pointIndex = 2;
                                  pointIndex + 1 < points.length;
                                  pointIndex += 2
                                ) {
                                  context.lineTo(
                                    points[pointIndex]!,
                                    points[pointIndex + 1]!
                                  );
                                }
                              }
                              context.fillStrokeShape(shape);
                            }
                          }}
                          fill={
                            hitClosedShape &&
                            (liveEl.fill || liveEl.gradient || liveEl.pattern)
                              ? "#000"
                              : undefined
                          }
                          stroke="#000"
                          strokeWidth={hitStrokeWidth}
                          listening
                          perfectDrawEnabled={false}
                        />
                      ) : null}
                    </Group>
                  );
                }
                if (el.type === "text")
                  return wrapClip(
                    <StudioKonvaTextNode
                      key={el.id}
                      el={el}
                      draggable={draggable}
                      innerRef={setRef}
                      onSelect={onSelect}
                      onEdit={startEditText}
                      onPatch={patchElementAfterDragRestore}
                      dragBoundFunc={snapBoundFunc}
                      onInteractionBegin={() => nodeInteractionBegin(el.id)}
                      onInteractionEnd={endLiveResourceEdit}
                      onCommitTransform={commitTextTransformEnd}
                    />
                  );
                if (el.type === "sticker")
                  return wrapClip(
                    <StudioKonvaStickerNode
                      key={el.id}
                      el={el}
                      draggable={draggable}
                      innerRef={setRef}
                      onSelect={onSelect}
                      onEdit={startEditText}
                      onPatch={patchElementAfterDragRestore}
                      dragBoundFunc={snapBoundFunc}
                      onInteractionBegin={() => nodeInteractionBegin(el.id)}
                      onInteractionEnd={endLiveResourceEdit}
                      onCommitTransform={commitTextTransformEnd}
                    />
                  );
                // bubble
                return wrapClip(
                  <StudioKonvaBubbleNode
                    key={el.id}
                    el={el}
                    theme={webtoonTheme}
                    customShapeDraftPoints={
                      bubbleShapeDraft?.elId === el.id ? bubbleShapeDraft.points : undefined
                    }
                    selected={selectedId === el.id}
                    exporting={isExporting}
                    effectiveScale={effScale}
                    draggable={draggable}
                    innerRef={setRef}
                    dragBoundFunc={snapBoundFunc}
                    onSelect={onSelect}
                    onEdit={() => startEditText(el.id)}
                    onChange={(patch) => patchElementAfterDragRestore(el.id, patch)}
                    onInteractionBegin={() => nodeInteractionBegin(el.id)}
                    onInteractionEnd={endLiveResourceEdit}
                  />
                );
                };
                // 문서 마스터 밑그림 — 일반 요소 "아래"(배경 위)에 비상호작용(asMask)으로 합성(studio-master-page).
                // 같은 콘텐츠 레이어라 페이지 지우개(destination-out)에는 함께 지워진다(배경 레이어와 달리 의도된 동일 레이어 합성).
                const masterUnderlay =
                  !masterEditMode && !activePage.hideMaster && masterRenderEls.length > 0 ? (
                    <Group listening={false}>
                      {masterRenderEls.map((mel, mIdx) => renderEl(mel, mIdx, { asMask: true }))}
                    </Group>
                  ) : null;
                // 마스터 편집 모드 — 현재 페이지의 일반 요소를 반투명 잠금 고스트로 위에 겹쳐 위치 참고용으로만 보여준다.
                const pageGhost = masterEditMode ? (
                  <Group listening={false} opacity={MASTER_EDIT_GHOST_OPACITY}>
                    {studioWorkAssetRenderProjection.elements
                      .filter((pel) => !isEffectivelyHidden(pel, activePage.groups ?? []))
                      .map((pel, pIdx) => renderEl(pel, pIdx, { asMask: true }))}
                  </Group>
                ) : null;
                const mainEls = canvasRenderElements.map((el, idx) => {
                  if (isEffectivelyHidden(el, groups) || localHiddenElementIds.has(el.id)) return null; // 숨긴 레이어/그룹 + "나만 숨기기"는 렌더·내보내기에서 제외
                  // A verified raster frame and these vector fallbacks switch in one React commit.
                  // Any stale/gated/error frame yields an empty set, restoring Konva immediately.
                  if (studioRasterHiddenOperationIds.has(el.id)) return null;
                  // The canonical-vNext dry-media canvas receives authority only after its
                  // RGBA16F producer fence and exact live/final/commit parity receipt complete.
                  // This derived id stays owned when an unavailable specialist carries the exact
                  // last-good WebGPU snapshot. Provider failure therefore cannot reveal Konva as
                  // an automatic renderer fallback.
                  if (studioCanonicalDryMediaOwnsDocumentElement(
                    el.id,
                    canonicalDryMediaHiddenElementId,
                  )) return null;
                  const base = el.clipBelow && idx > 0 ? canvasRenderElements[idx - 1] : null;
                  // 자기 완결형 마스크(el.maskSrc) — clipBelow와 별개 축, 교집합으로 합성해야 하므로
                  // clipBelow보다 먼저 적용해 "이미 마스크 적용된 노드"를 만든다.
                  const maskOn = el.type === "image" && shouldApplyLayerMask(el as ImageEl);
                  // renderEl(el, idx, opts)를 그대로 호출하되, 마스크가 있으면 그 결과를 "자기 자신의
                  // maskSrc로 자른 ClipMaskGroup"으로 한 번 더 감싼다. opts는 clipBelow 분기
                  // (source-in override)와 평범한 분기(opts={}) 양쪽에서 재사용된다.
                  const renderWithOwnMask = (opts: { compositeOverride?: string } = {}) => {
                    if (!maskOn) return renderEl(el, idx, opts);
                    // The sandwich content must composite `source-in` against its mask sibling —
                    // ALWAYS, not only when the caller wanted source-in for the element itself.
                    // The plain branch used to pass the content through with `source-over`, which
                    // covered the mask instead of being clipped by it: painting on the mask
                    // measurably changed nothing. The caller's intent (the element's blend mode,
                    // or clipBelow's source-in) moves onto the cached sandwich root instead, where
                    // it applies exactly once to the flattened, already-masked result.
                    const content = renderEl(el, idx, { ...opts, compositeOverride: "source-in" });
                    const imgEl = el as ImageEl;
                    const maskSrc = (el as El).maskSrc;
                    // 마스크 노드는 최소 필드만 새로 구성한다(el 스프레드 후 필터 필드를 하나하나
                    // undefined로 지우는 방식은 필드 하나만 빠뜨려도 마스크에 필터가 새어들어가는
                    // 실수를 낳기 쉽다 — 순수 알파 스텐실 용도이므로 기하 정보만 필요).
                    const maskEl = {
                      id: `${el.id}__mask`,
                      type: "image",
                      src: maskSrc!,
                      x: imgEl.x,
                      y: imgEl.y,
                      width: imgEl.width,
                      height: imgEl.height,
                      rotation: imgEl.rotation,
                      flipped: imgEl.flipped,
                      flippedY: imgEl.flippedY,
                    } as ImageEl;
                    const mck = [
                      el.id,
                      "mask",
                      studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(el.id)
                        ?? "authoritative",
                      maskSrc,
                      JSON.stringify(elBounds(el)),
                      imgEl.rotation ?? 0,
                    ].join("|");
                    // What the caller wanted for the element — clipBelow's source-in, or the
                    // element's own blend mode — now rides on the sandwich root. Without this the
                    // nested clipBelow+mask case clipped by its own mask but no longer by the
                    // layer below, and a masked layer's blend mode silently vanished.
                    const sandwichComposite = (opts.compositeOverride ??
                      (el.blendMode && el.blendMode !== "source-over" ? el.blendMode : undefined)) as
                      | Konva.NodeConfig["globalCompositeOperation"]
                      | undefined;
                    return (
                      <ClipMaskGroup
                        key={`${el.id}-mask`}
                        cacheKey={mck}
                        {...(sandwichComposite ? { composite: sandwichComposite } : {})}
                      >
                        {renderEl(maskEl, idx, { asMask: true })}
                        {content}
                      </ClipMaskGroup>
                    );
                  };
                  if (base && !isEffectivelyHidden(base, groups) && !localHiddenElementIds.has(base.id)) {
                    // 알파 정밀 클리핑: 베이스 사본(마스크) + 자식(source-in)을 캐시 그룹에 담아 베이스 알파로만 자른다.
                    const ck = [
                      el.id,
                      base.id,
                      studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(el.id)
                        ?? "authoritative",
                      studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(base.id)
                        ?? "authoritative",
                      imageFilterCacheKey(el as ImageEl),
                      imageFilterCacheKey(base as ImageEl),
                      (el as { src?: string }).src ?? "",
                      (base as { src?: string }).src ?? "",
                      JSON.stringify(elBounds(el)),
                      JSON.stringify(elBounds(base)),
                      (el as { rotation?: number }).rotation ?? 0,
                      (base as { rotation?: number }).rotation ?? 0,
                      maskOn ? ((el as El).maskSrc ?? "") : "", // 마스크가 캐시 키에도 반영되게.
                    ].join("|");
                    return (
                      <ClipMaskGroup key={el.id} cacheKey={ck}>
                        {renderEl(base, idx - 1, { asMask: true })}
                        {renderWithOwnMask({ compositeOverride: "source-in" })}
                      </ClipMaskGroup>
                    );
                  }
                  return renderWithOwnMask();
                });
                return (
                  <>
                    {masterUnderlay}
                    {mainEls}
                    {!masterEditMode
                      ? studioWorkAssetRenderPlaceholders.map((placeholder) => (
                          <StudioWorkAssetPlaceholderNode
                            key={`${placeholder.elementType}:${placeholder.assetId}`}
                            placeholder={placeholder}
                            scale={effScale}
                          />
                        ))
                      : null}
                    {pageGhost}
                  </>
                );
}
