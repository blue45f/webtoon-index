import { Fragment, Suspense, type ReactNode, type RefObject } from "react";
import { Group, Rect, Text, Transformer } from "react-konva/lib/ReactKonvaCore";

import { CANVAS_W } from "../studio-assets";
import { elBounds } from "../studio-element-geometry";
import { isEffectivelyHidden, isEffectivelyLocked, type LayerGroup } from "../studio-layers";
import { StudioDrawSelectionOverlay } from "../studio-page-lazy-ui";
import { unionBounds } from "../studio-selection";
import { STUDIO_GROUP_SELECTION_OVERLAY_NAME } from "../studio-selection-chrome-mirror";
import { StudioGroupUniformResizeProxy } from "../StudioGroupUniformResizeProxy";

import type { Tool } from "../studio-editor-tool-model";
import type { DrawEl, El } from "../studio-element-model";
import type { StudioGroupUniformResizeBounds } from "../studio-group-uniform-resize";
import type { StudioLiveTransformDraftStore } from "../studio-live-transform-draft-store";
import type Konva from "konva";

/**
 * Konva selection decorations for the main Studio layer — the union-bounds ghost with its label
 * badge, the uniform resize proxy, the single-object Transformer, the locked/active-group dashed
 * boxes, and the freehand selection overlay.
 *
 * A plain factory rather than a component: these are positional children of one `<Layer>` and the
 * caller keeps owning every piece of state they read, so nothing here holds effects or its own
 * render identity.
 */
export interface StudioCanvasSelectionDecorationsContext {
  readonly activeGroupId: string | null;
  readonly activeSurfaceReviewLocked: boolean;
  readonly beginCanvasSelectionResize: (
    sourceBounds: StudioGroupUniformResizeBounds
  ) => boolean;
  readonly cancelCanvasSelectionResize: () => void;
  /** Bumped when Escape/pointer-cancel cancels the gesture outside the proxy's own Konva events. */
  readonly canvasSelectionResizeCancelSignal: number;
  readonly canvasH: number;
  readonly canvasSelectionEls: readonly El[];
  readonly commitCanvasSelectionResize: (
    targetBounds: StudioGroupUniformResizeBounds,
    rotationDeg: number
  ) => boolean;
  readonly completeSelectionGroup: LayerGroup | null;
  readonly effScale: number;
  readonly elements: readonly El[];
  readonly groupResizeEnabled: boolean;
  readonly groups: LayerGroup[];
  readonly hasCoarsePointer: boolean;
  readonly isExporting: boolean;
  readonly isMobile: boolean;
  readonly marqueeIds: readonly string[];
  readonly multiSelectionBounds: { x: number; y: number; w: number; h: number } | null;
  readonly selected: El | null;
  readonly selectionLockState: "unlocked" | "locked" | "mixed";
  /** Whether the uniform-resize proxy may offer its rotation handle; see the interaction hook. */
  readonly selectionRotatable: boolean;
  readonly singleDrawFreeScale: boolean;
  /** Small dedicated Layer the live transform gesture lifts into (single-object drag Layer). */
  readonly singleObjectDragLayerRef: RefObject<Konva.Layer | null>;
  readonly liveTransformDraftStore: StudioLiveTransformDraftStore;
  readonly liveTransformDraftScope: string;
  readonly tool: Tool;
  readonly trRef: RefObject<Konva.Transformer | null>;
}

export function renderStudioCanvasSelectionDecorations({
  activeGroupId,
  activeSurfaceReviewLocked,
  beginCanvasSelectionResize,
  cancelCanvasSelectionResize,
  canvasSelectionResizeCancelSignal,
  canvasH,
  canvasSelectionEls,
  commitCanvasSelectionResize,
  completeSelectionGroup,
  effScale,
  elements,
  groupResizeEnabled,
  groups,
  hasCoarsePointer,
  isExporting,
  isMobile,
  marqueeIds,
  multiSelectionBounds,
  selected,
  selectionLockState,
  selectionRotatable,
  singleDrawFreeScale,
  singleObjectDragLayerRef,
  liveTransformDraftStore,
  liveTransformDraftScope,
  tool,
  trRef,
}: StudioCanvasSelectionDecorationsContext): ReactNode {
  return (
    <Fragment>
      {/* 그룹 및 다중 선택은 구성 타입(draw + image/text 등)이 섞여도 하나의 union bounds를
          항상 보여준다. 아직 전용 affine proxy가 없는 혼합 선택에서도 PPT/Figma처럼 무엇이
          한 이동 단위인지 명확해야 한다. 잠금/혼합 상태는 amber 점선으로 즉시 구분하며
          listening=false라 선택·드래그 hit를 절대 가로채지 않는다. */}
      {!isExporting &&
        tool === "select" &&
        !activeSurfaceReviewLocked &&
        (marqueeIds.length > 1 || singleDrawFreeScale) &&
        multiSelectionBounds &&
        multiSelectionBounds.w >= 0 &&
        multiSelectionBounds.h >= 0 && (() => {
          const pad = 7 / Math.max(effScale, 0.001);
          const constrained = selectionLockState !== "unlocked";
          const label =
            completeSelectionGroup?.name?.trim() ||
            (completeSelectionGroup
              ? "그룹"
              : singleDrawFreeScale
                ? "선화 레이어"
                : "다중 선택");
          const lockStateLabel =
            selectionLockState === "locked"
              ? "잠금"
              : selectionLockState === "mixed"
                ? "일부 잠금"
                : null;
          const badgeText = `${label} · ${canvasSelectionEls.length}개${
            lockStateLabel ? ` · ${lockStateLabel}` : ""
          }`;
          const badgeWidth = Math.min(
            180 / effScale,
            Math.max(62 / effScale, (badgeText.length * 7 + 18) / effScale)
          );
          const badgeHeight = 20 / effScale;
          const badgeInset = 2 / effScale;
          const preferredBadgeY =
            multiSelectionBounds.y - pad - badgeHeight - 4 / effScale;
          const badgeX = Math.min(
            Math.max(multiSelectionBounds.x - pad, badgeInset),
            Math.max(badgeInset, CANVAS_W - badgeWidth - badgeInset)
          );
          const badgeY =
            preferredBadgeY >= badgeInset
              ? preferredBadgeY
              : Math.min(
                  canvasH - badgeHeight - badgeInset,
                  multiSelectionBounds.y + pad + 4 / effScale
                );
          return (
            <Group
              name={STUDIO_GROUP_SELECTION_OVERLAY_NAME}
              listening={false}
              studioSelectionRole="group-bounds"
              studioGroupId={completeSelectionGroup?.id ?? ""}
              studioGroupLocked={completeSelectionGroup?.locked === true}
            >
              {/* 조절 가능한 선택은 전용 Transformer가 정확한 한 줄 경계와 핸들을 그린다.
                  같은 위치에 padded overlay까지 겹치면 이중 점선으로 보여 상용 도구보다
                  산만해진다. 잠금·일시 차단 상태에서만 이 fallback 경계를 사용한다. */}
              {!groupResizeEnabled ? (
                <Rect
                  name="studio-group-selection-boundary"
                  x={multiSelectionBounds.x - pad}
                  y={multiSelectionBounds.y - pad}
                  width={Math.max(
                    pad * 2,
                    multiSelectionBounds.w + pad * 2
                  )}
                  height={Math.max(
                    pad * 2,
                    multiSelectionBounds.h + pad * 2
                  )}
                  stroke={constrained ? "#b45309" : "#c2410c"}
                  strokeWidth={(constrained ? 1.75 : 1.35) / effScale}
                  dash={
                    constrained
                      ? [7 / effScale, 4 / effScale]
                      : [2 / effScale, 3 / effScale]
                  }
                  cornerRadius={5 / effScale}
                  shadowColor={constrained ? "#b45309" : "#c2410c"}
                  shadowBlur={4 / effScale}
                  shadowOpacity={0.22}
                />
              ) : null}
              <Group
                name="studio-group-selection-badge"
                x={badgeX}
                y={badgeY}
              >
                <Rect
                  width={badgeWidth}
                  height={badgeHeight}
                  fill={constrained ? "#b45309" : "#c2410c"}
                  cornerRadius={5 / effScale}
                  shadowColor="#111827"
                  shadowBlur={3 / effScale}
                  shadowOpacity={0.24}
                />
                <Text
                  text={badgeText}
                  width={badgeWidth}
                  height={badgeHeight}
                  padding={5 / effScale}
                  fontSize={10 / effScale}
                  fontStyle="600"
                  fill="#fffaf5"
                  ellipsis
                  wrap="none"
                />
              </Group>
              {constrained ? (
                <Rect
                  name="studio-group-selection-lock-marker"
                  x={multiSelectionBounds.x - pad}
                  y={multiSelectionBounds.y - pad}
                  width={10 / effScale}
                  height={10 / effScale}
                  offsetX={5 / effScale}
                  offsetY={5 / effScale}
                  rotation={45}
                  fill="#b45309"
                  stroke="#fff7ed"
                  strokeWidth={1 / effScale}
                  cornerRadius={1.5 / effScale}
                />
              ) : null}
            </Group>
          );
        })()}
      {(marqueeIds.length > 1 || singleDrawFreeScale) && multiSelectionBounds ? (
        <StudioGroupUniformResizeProxy
          bounds={{
            x: multiSelectionBounds.x,
            y: multiSelectionBounds.y,
            width: multiSelectionBounds.w,
            height: multiSelectionBounds.h,
          }}
          effScale={effScale}
          mobile={isMobile}
          coarse={hasCoarsePointer}
          enabled={groupResizeEnabled}
          // One stroke can absorb independent width/height exactly, so it gets the full handle
          // set. A multi-selection stays on uniform corners: a non-uniform group scale would have
          // to re-weight every stroke by direction, and it would stop commuting with rotation.
          freeTransform={singleDrawFreeScale}
          // Rotation is safe for both. Uniform scale commutes with it, so a selection turns as a
          // rigid body and each member's committed angle is simply its own plus the gesture's.
          // The handle is offered from the planners' own verdicts (`selectionRotatable`, derived
          // in the interaction hook from the same predicates the commit runs): a member that
          // cannot carry an angle makes the commit stand the whole gesture down -- the group plan
          // refuses, and a sole dropped-rotation stroke is refused up front rather than committed
          // as a silent resize -- so offering the handle there could only end in a refusal toast.
          rotatable={selectionRotatable}
          // The caller supplies document facts only. Route thresholds, arrow semantics, clip
          // ownership, drag-Layer lift and wrapper lookup are private to the Konva adapter.
          livePreview={
            singleDrawFreeScale && canvasSelectionEls[0]?.type === "draw"
              ? {
                  mode: "single" as const,
                  scope: liveTransformDraftScope,
                  element: canvasSelectionEls[0],
                  elements,
                  draftStore: liveTransformDraftStore,
                  transformLiftLayerRef: singleObjectDragLayerRef,
                }
              : marqueeIds.length > 1 && canvasSelectionEls.length === marqueeIds.length
                ? {
                    // The group lane admits itself: it stands down to today's commit-at-release
                    // whenever a member is not a drafted-safe stroke, so the caller does not
                    // pre-filter and the two cannot disagree about what "eligible" means.
                    mode: "group" as const,
                    scope: liveTransformDraftScope,
                    selection: canvasSelectionEls,
                    elements,
                    draftStore: liveTransformDraftStore,
                    transformLiftLayerRef: singleObjectDragLayerRef,
                    isLocked: (element: El) => isEffectivelyLocked(element, groups),
                  }
                : undefined
          }
          gestureBinding={{
            externalCancelSignal: canvasSelectionResizeCancelSignal,
            acquire: beginCanvasSelectionResize,
            commit: ({ targetBounds, rotationDeg }) =>
              commitCanvasSelectionResize(targetBounds, rotationDeg),
            release: cancelCanvasSelectionResize,
            cancel: cancelCanvasSelectionResize,
          }}
        />
      ) : null}
      <Transformer
        ref={trRef}
        // Draw elements use the dedicated proxy Transformer above. This general Transformer has
        // nodes([]) and paints no pixels for that selection, so it cannot be treated as authored
        // z-order content that blocks the isolated exact draft Layer.
        studioLiveTransformZOrderExempt={selected?.type === "draw" ? true : undefined}
        // A panel frame is the one type this Transformer can attach to whose model stores no
        // angle: `StudioFramePanel`'s transformend commits {x, y, width, height} and never reads
        // `rotation()`, so a turn here becomes a pure displacement while the live node keeps the
        // angle until the next reload. Withhold the handle rather than drop the turn, the same
        // verdict `studioGroupUniformResizeMemberCanRotate` reaches for a frame in a selection.
        rotateEnabled={selected?.type !== "frame"}
        rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
        rotationSnapTolerance={6}
        keepRatio={selected?.type === "text" || selected?.type === "sticker" || !!selected?.lockAspect}
        enabledAnchors={
          selected?.type === "text" || selected?.type === "sticker" || selected?.lockAspect
            ? ["top-left", "top-right", "bottom-left", "bottom-right"]
            : ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right", "top-center", "bottom-center"]
        }
        // Konva 기본 파란 사각 핸들 대신 디자인 시스템(persimmon 악센트)의 라운드 핸들.
        // 그림자를 살짝 깔아 어떤 원고 색 위에서도 핸들이 읽힌다.
        anchorSize={11}
        anchorCornerRadius={5.5}
        anchorStroke="oklch(0.72 0.185 42)"
        anchorStrokeWidth={1.5}
        anchorFill="oklch(0.998 0.004 85)"
        borderStroke="oklch(0.72 0.185 42 / 0.9)"
        borderStrokeWidth={1.25}
        rotateAnchorOffset={26}
        anchorStyleFunc={(anchor) => {
          anchor.shadowColor("oklch(0.08 0.01 70)");
          anchor.shadowBlur(4);
          anchor.shadowOpacity(0.35);
          anchor.shadowOffsetY(1);
        }}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 24 || newBox.height < 24 ? oldBox : newBox)}
      />
      {/* 잠긴 선택 요소는 트랜스포머가 안 붙으므로 점선 박스로 '선택됨'을 표시(삭제·잠금해제 안내). */}
      {selected && isEffectivelyLocked(selected, groups) && marqueeIds.length === 0 && tool === "select" && !isExporting && (() => {
        const sb = elBounds(selected);
        return (
          <Rect
            x={sb.x}
            y={sb.y}
            width={sb.w}
            height={sb.h}
            rotation={(selected as { rotation?: number }).rotation ?? 0}
            stroke="oklch(0.72 0.185 42 / 0.9)"
            strokeWidth={1.5 / effScale}
            dash={[7 / effScale, 4 / effScale]}
            listening={false}
          />
        );
      })()}
      {/* draw(선화)는 points 기반이라 노드 ref 미등록 → 트랜스포머가 붙지 않는다.
          단일 선택·마퀴 다중선택의 선화 멤버 모두 점선 박스로 '선택됨'을 표시한다. */}
      {!isExporting && tool === "select" && !activeSurfaceReviewLocked && (() => {
        const drawSelectionEls =
          marqueeIds.length > 0
            ? completeSelectionGroup
              ? []
              : elements.filter(
                  (el): el is DrawEl & El =>
                    el.type === "draw" &&
                    marqueeIds.includes(el.id) &&
                    !isEffectivelyLocked(el, groups) &&
                    !isEffectivelyHidden(el, groups)
                )
            : selected?.type === "draw" &&
                !isEffectivelyLocked(selected, groups) &&
                !isEffectivelyHidden(selected, groups)
              ? [selected]
              : [];
        if (drawSelectionEls.length === 0) return null;
        return (
          <Suspense fallback={null}>
            <StudioDrawSelectionOverlay els={drawSelectionEls} scale={effScale} />
          </Suspense>
        );
      })()}
      {/* 그룹 진입(더블클릭) 표시 — 편집 중인 그룹의 경계를 옅은 점선으로 그려 "지금 이 그룹
          안에서 개별 편집 중"임을 알린다(PPT/Figma 관례). listening=false 라 클릭을 가로채지 않는다. */}
      {!isExporting && tool === "select" && !activeSurfaceReviewLocked && activeGroupId && (() => {
        const memberBounds = elements
          .filter((el) => el.groupId === activeGroupId && !isEffectivelyHidden(el, groups))
          .map((el) => elBounds(el));
        if (memberBounds.length === 0) return null;
        const box = unionBounds(memberBounds);
        if (box.w <= 0 || box.h <= 0) return null;
        const pad = 6 / effScale;
        return (
          <Rect
            x={box.x - pad}
            y={box.y - pad}
            width={box.w + pad * 2}
            height={box.h + pad * 2}
            stroke="oklch(0.62 0.02 250 / 0.7)"
            strokeWidth={1 / effScale}
            dash={[4 / effScale, 4 / effScale]}
            cornerRadius={4 / effScale}
            listening={false}
          />
        );
      })()}
    </Fragment>
  );
}
