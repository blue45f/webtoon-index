import { memo, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { Layer } from "react-konva/lib/ReactKonvaCore";

import {
  planStudioDraftPreviewCompositeRuns,
  resolveStudioDraftPreviewActiveLane,
} from "./brush/studio-draw-rendering";
import { StudioDrawNode } from "./brush/StudioDrawNode";

import type { StudioDraftPreviewCompositeRun } from "./brush/studio-draw-rendering";
import type { StudioDraftPreviewSource } from "./studio-draft-preview-store";
import type { DrawEl } from "./studio-element-model";
import type Konva from "konva";

export interface StudioDraftPreviewLayersProps {
  store: StudioDraftPreviewSource;
  normalLayerRef?: RefObject<Konva.Layer | null>;
  dynamicLayerRef?: RefObject<Konva.Layer | null>;
}

interface StudioDraftPreviewCanvasElement extends HTMLCanvasElement {
  dataset: DOMStringMap & { studioDraftPreviewBlend?: string };
}

const STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE = 20;
const STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z = STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE + 2;
const STUDIO_DRAFT_PREVIEW_FOLLOWING_OVERLAY_Z = STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z + 1;

function draftPreviewLayerCanvas(layer: Konva.Layer | null): StudioDraftPreviewCanvasElement | null {
  if (!layer) return null;
  return layer.getNativeCanvasElement() as StudioDraftPreviewCanvasElement;
}

/** Applies the only cross-Kanvas-layer blend mode used by draft previews. */
function applyStudioDraftPreviewCanvasBlend(
  layer: Konva.Layer | null,
  mode: StudioDraftPreviewCompositeRun["mode"],
  stackIndex: number,
): void {
  const canvas = draftPreviewLayerCanvas(layer);
  if (!canvas) return;
  canvas.style.mixBlendMode = mode === "backdrop-multiply" ? "multiply" : "normal";
  canvas.style.zIndex = String(STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE + stackIndex);
  canvas.dataset.studioDraftPreviewBlend = mode;

  // The elevated preview participates in the zoom host's isolated stacking context so it can see
  // sibling DOM raster/live authorities. Preserve Konva's later overlay order (cursor, rulers,
  // selection handles) by elevating every following public canvas as one bounded z slot.
  let sibling = canvas.nextElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLCanvasElement) {
      sibling.style.zIndex = String(STUDIO_DRAFT_PREVIEW_FOLLOWING_OVERLAY_Z);
    }
    sibling = sibling.nextElementSibling;
  }
}

function sameElementIdentity(
  previous: readonly DrawEl[],
  next: readonly DrawEl[],
): boolean {
  return previous.length === next.length
    && previous.every((element, index) => element === next[index]);
}

const StudioDraftPreviewSettledRunLayer = memo(
  function StudioDraftPreviewSettledRunLayer({
    layerRef,
    run,
    runIndex,
  }: {
    layerRef: RefObject<Konva.Layer | null>;
    run: StudioDraftPreviewCompositeRun;
    runIndex: number;
  }) {
    useLayoutEffect(() => {
      layerRef.current?.drawScene();
    }, [layerRef, run.elements]);
    return (
      <Layer
        ref={layerRef}
        name={`studio-draft-preview-settled-${run.mode}-${runIndex}`}
        listening={false}
      >
        {run.elements.map((element) => (
          <StudioDrawNode key={element.id} el={element} />
        ))}
      </Layer>
    );
  },
  (previous, next) => (
    previous.layerRef === next.layerRef
    && previous.run.mode === next.run.mode
    && previous.runIndex === next.runIndex
    && sameElementIdentity(previous.run.elements, next.run.elements)
  ),
);

function StudioDraftPreviewBackdropMultiplyLayer({
  element,
  layerRef,
}: {
  element: DrawEl;
  layerRef: RefObject<Konva.Layer | null>;
}) {
  return (
    <Layer
      ref={layerRef}
      name="studio-draft-preview-backdrop-multiply"
      listening={false}
    >
      <StudioDrawNode el={element} activeDraft />
    </Layer>
  );
}

/** 비다이렉트 초안 전용 격리 레이어 — 스토어 구독으로 페이지 본문 렌더 없이 프레임을 그린다. */
export const StudioDraftPreviewLayers = memo(function StudioDraftPreviewLayers({
  store,
  normalLayerRef,
  dynamicLayerRef,
}: StudioDraftPreviewLayersProps) {
  const { active } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const settled = store.visibleSettled;
  const settledRuns = planStudioDraftPreviewCompositeRuns(settled);
  const settledRun0 = settledRuns[0] ?? null;
  const settledRun1 = settledRuns[1] ?? null;
  const settledRun0LayerRef = useRef<Konva.Layer>(null);
  const settledRun1LayerRef = useRef<Konva.Layer>(null);
  const backdropMultiplyLayerRef = useRef<Konva.Layer>(null);
  const fallbackNormalLayerRef = useRef<Konva.Layer>(null);
  const effectiveNormalLayerRef = normalLayerRef ?? fallbackNormalLayerRef;
  const fixedFxLayerRef = useRef<Konva.Layer>(null);
  const activeLane = resolveStudioDraftPreviewActiveLane(active);
  const isolatedDynamic = activeLane === "dynamic" ? active : null;
  const isolatedFixedFx = activeLane === "fixed-fx" ? active : null;
  const backdropMultiplyActive = activeLane === "backdrop-multiply" ? active : null;
  // Non-direct specialty brushes retain their exact accepted coordinates while the pointer is
  // down. The former growing-prefix smoother recalculated already-visible points every frame.
  // Default opaque pens now use the fixed-lag two-surface causal path; specialty brushes prefer a
  // single release-time correction over visibly crawling historical geometry.
  const normalActive = activeLane === "normal" ? active : null;

  // scheduleDraft disables react-konva's deferred auto draw while publishing one pointer frame.
  // Paint only the bounded settled/active surfaces during the same React commit; the main scene
  // remains untouched even when a luminous compound path receives thousands of active samples.
  useLayoutEffect(() => {
    if (settledRun0) {
      applyStudioDraftPreviewCanvasBlend(
        settledRun0LayerRef.current,
        settledRun0.mode,
        0,
      );
    }
    if (settledRun1) {
      applyStudioDraftPreviewCanvasBlend(
        settledRun1LayerRef.current,
        settledRun1.mode,
        1,
      );
    }
    if (normalActive) {
      applyStudioDraftPreviewCanvasBlend(
        effectiveNormalLayerRef.current,
        "source-over",
        STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z - STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE,
      );
      effectiveNormalLayerRef.current?.drawScene();
    }
    if (isolatedFixedFx) {
      applyStudioDraftPreviewCanvasBlend(
        fixedFxLayerRef.current,
        "source-over",
        STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z - STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE,
      );
      fixedFxLayerRef.current?.drawScene();
    }
    if (isolatedDynamic) {
      applyStudioDraftPreviewCanvasBlend(
        dynamicLayerRef?.current ?? null,
        "source-over",
        STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z - STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE,
      );
      dynamicLayerRef?.current?.drawScene();
    }
    if (backdropMultiplyActive) {
      applyStudioDraftPreviewCanvasBlend(
        backdropMultiplyLayerRef.current,
        "backdrop-multiply",
        STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z - STUDIO_DRAFT_PREVIEW_CANVAS_Z_BASE,
      );
      backdropMultiplyLayerRef.current?.drawScene();
    }
  }, [
    backdropMultiplyActive,
    dynamicLayerRef,
    effectiveNormalLayerRef,
    isolatedDynamic,
    isolatedFixedFx,
    normalActive,
    settledRun0,
    settledRun1,
  ]);

  return (
    <>
      {settledRun0 ? (
        <StudioDraftPreviewSettledRunLayer
          key={settledRun0.key}
          layerRef={settledRun0LayerRef}
          run={settledRun0}
          runIndex={0}
        />
      ) : null}
      {settledRun1 ? (
        <StudioDraftPreviewSettledRunLayer
          key={settledRun1.key}
          layerRef={settledRun1LayerRef}
          run={settledRun1}
          runIndex={1}
        />
      ) : null}
      {normalActive ? (
        <Layer
          key="normal"
          ref={effectiveNormalLayerRef}
          name="studio-draft-preview-normal"
          listening={false}
        >
          <StudioDrawNode el={normalActive} activeDraft />
        </Layer>
      ) : null}
      {backdropMultiplyActive ? (
        <StudioDraftPreviewBackdropMultiplyLayer
          element={backdropMultiplyActive}
          layerRef={backdropMultiplyLayerRef}
        />
      ) : null}
      {/* Source-over luminous effects do not need the settled pixels as an in-layer backdrop. */}
      {isolatedFixedFx ? (
        <Layer
          key="fixed-fx"
          ref={fixedFxLayerRef}
          name="studio-draft-preview-fixed-fx"
          listening={false}
        >
          <StudioDrawNode el={isolatedFixedFx} activeDraft />
        </Layer>
      ) : null}
      {/* 라이브 입자 획은 독립 레이어에서만 다시 그린다 — committed 입자 획이 포인터 RAF마다
          수천 개의 dab 을 재실행하지 않는다. */}
      {isolatedDynamic ? (
        <Layer
          key="dynamic"
          ref={dynamicLayerRef}
          name="studio-draft-preview-dynamic"
          listening={false}
        >
          <StudioDrawNode el={isolatedDynamic} activeDraft />
        </Layer>
      ) : null}
    </>
  );
});
