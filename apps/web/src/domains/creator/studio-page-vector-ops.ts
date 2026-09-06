import {
  refitSettledCenterline,
  type CenterlineFitEngine,
  type SettledCenterlineRefitResult,
} from "@toonspectrum/studio-brush-platform";

import {
  requireStudioDrawingPointerTransport,
  type StudioDrawingPointerTransport,
} from "./brush/studio-drawing-pointer-transport";
import { refineStudioDrawElementWithPaper } from "./brush/studio-paper-vector-document-adapter";
import {
  combineStudioShapesWithCanvasKit,
} from "./render/studio-canvaskit-path-boolean-document-adapter";
import { hasTrack, removeTrack, type AnimationTimelineDoc } from "./studio-anim-tracks";
import { selectionShapeForIds, type GroupSelectionState } from "./studio-group-selection";
import { uid } from "./studio-id";
import { isEffectivelyLocked, type LayerGroup } from "./studio-layers";
import {
  drawElToStudioPathBooleanSpec,
  studioPathBooleanOpLabel,
  studioPathBooleanPieceToDrawElSeed,
  studioPathBooleanUnavailableReason,
  type StudioPathBooleanCombineResult,
  type StudioPathBooleanOp,
} from "./studio-path-boolean";
import { studioVectorAsyncCommandStaleReason } from "./studio-vector-async-command-guard";

import type { StudioEditorMutationTicket } from "./studio-editor-scope";
import type { DrawEl, El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";
import type { StudioQualityWorkerClient } from "./studio-quality-worker-client";

/**
 * Editor surface the async vector commands operate on. Values are captured per render (the
 * factory is invoked in the StudioPage body); refs stay refs so long-running computations keep
 * revalidating against the live document instead of their render-time closure.
 */
export interface StudioPageVectorOpsContext {
  readonly paperVectorRefinementUnavailableReason: string | null;
  readonly selected: El | null | undefined;
  readonly elementById: ReadonlyMap<string, El>;
  readonly nodeSmoothStrength: number;
  readonly pageEditLocked: boolean;
  readonly masterEditMode: boolean;
  readonly activePage: { readonly id: string };
  readonly animTimeline: AnimationTimelineDoc;
  readonly drawingRef: { readonly current: DrawEl | null };
  readonly drawingPointerTransportRef: {
    current: StudioDrawingPointerTransport | null;
  };
  readonly pendingStrokeCommitsRef: { readonly current: object | null };
  readonly flushPendingStrokeCommitsRef: { readonly current: () => boolean };
  readonly pathBooleanRunIdRef: { current: number };
  readonly pathBooleanActiveRef: { current: boolean };
  readonly pathBooleanAbortRef: { current: AbortController | null };
  readonly pathBooleanClientRef: { current: StudioQualityWorkerClient | null };
  readonly paperVectorRefinementRunIdRef: { current: number };
  readonly paperVectorRefinementActiveRef: { current: boolean };
  readonly paperVectorRefinementAbortRef: { current: AbortController | null };
  readonly paperVectorRefinementRequestSequenceRef: { current: number };
  readonly paperVectorRefinementEngineEpochRef: { readonly current: number };
  readonly paperVectorRefinementClientRef: {
    current: { advanceEngineEpoch(): number; dispose(): void } | null;
  };
  readonly currentPageIdRef: { readonly current: string };
  readonly masterEditModeRef: { readonly current: boolean };
  readonly activeElementsRef: { readonly current: El[] };
  readonly activeGroupsRef: { readonly current: LayerGroup[] };
  readonly activeSurfaceReviewLockedRef: { readonly current: boolean };
  readonly selectedIdRef: { current: string | null };
  readonly marqueeIdsRef: { current: string[] };
  readonly activeGroupIdRef: { readonly current: string | null };
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  readonly currentCanvasSelectionIds: () => string[];
  readonly commit: (
    nextElements: El[],
    extraPatch?: Partial<Omit<PageState, "id" | "elements">>,
    targetPageId?: string
  ) => boolean;
  readonly applyGroupSelectionState: (next: GroupSelectionState) => void;
  readonly setError: (message: string | null) => void;
  readonly setPaperVectorRefinementBusy: (busy: boolean) => void;
  readonly setPathBooleanBusy: (busy: boolean) => void;
  readonly setSelectedId: (id: string | null) => void;
  readonly setMarqueeIds: (ids: string[]) => void;
  readonly announceDrawingShortcut: (message: string) => void;
}

export interface StudioPageVectorOps {
  readonly applyPaperVectorRefinement: (
    operation: "simplify" | "smooth"
  ) => Promise<void>;
  readonly applyPathBooleanCombine: (op: StudioPathBooleanOp) => Promise<void>;
}

/**
 * Async vector-path commands extracted from StudioPage. Behavior-identical move: the bodies
 * below are verbatim, with dependencies received through {@link ctx} instead of component
 * closure. The captureStudioMutationTicket/canApplyStudioMutation authority guards stay inside
 * the extracted code so a stale worker result can never overwrite a newer document.
 */
export function createStudioPageVectorOps(
  ctx: StudioPageVectorOpsContext,
): StudioPageVectorOps {
  const {
    paperVectorRefinementUnavailableReason,
    selected,
    elementById,
    nodeSmoothStrength,
    pageEditLocked,
    masterEditMode,
    activePage,
    animTimeline,
    drawingRef,
    drawingPointerTransportRef,
    pendingStrokeCommitsRef,
    flushPendingStrokeCommitsRef,
    pathBooleanRunIdRef,
    pathBooleanActiveRef,
    pathBooleanAbortRef,
    pathBooleanClientRef,
    paperVectorRefinementRunIdRef,
    paperVectorRefinementActiveRef,
    paperVectorRefinementAbortRef,
    paperVectorRefinementRequestSequenceRef,
    paperVectorRefinementEngineEpochRef,
    paperVectorRefinementClientRef,
    currentPageIdRef,
    masterEditModeRef,
    activeElementsRef,
    activeGroupsRef,
    activeSurfaceReviewLockedRef,
    selectedIdRef,
    marqueeIdsRef,
    activeGroupIdRef,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    currentCanvasSelectionIds,
    commit,
    applyGroupSelectionState,
    setError,
    setPaperVectorRefinementBusy,
    setPathBooleanBusy,
    setSelectedId,
    setMarqueeIds,
    announceDrawingShortcut,
  } = ctx;

  async function applyPaperVectorRefinement(
    operation: "simplify" | "smooth"
  ) {
    if (paperVectorRefinementUnavailableReason) {
      setError(paperVectorRefinementUnavailableReason);
      return;
    }
    if (
      selected?.type !== "draw"
      || elementById.get(selected.id) !== selected
      || paperVectorRefinementActiveRef.current
    ) {
      return;
    }

    const source = selected;
    const runId = paperVectorRefinementRunIdRef.current + 1;
    paperVectorRefinementRunIdRef.current = runId;
    paperVectorRefinementActiveRef.current = true;
    const controller = new AbortController();
    paperVectorRefinementAbortRef.current = controller;
    const mutationTicket = captureStudioMutationTicket();
    const targetPageId = currentPageIdRef.current || activePage.id;
    const targetMasterEditMode = masterEditModeRef.current;
    const requestSequence =
      paperVectorRefinementRequestSequenceRef.current + 1;
    paperVectorRefinementRequestSequenceRef.current = requestSequence;
    const engineEpoch = paperVectorRefinementEngineEpochRef.current;
    const snapshot = {
      runId,
      pageId: targetPageId,
      masterEditMode: targetMasterEditMode,
      selectedIds: [source.id],
      sourceElements: [source],
    } as const;
    setPaperVectorRefinementBusy(true);

    try {
      const {
        getStudioPaperVectorRefinementWorkerClient,
      } = await import("./brush/studio-paper-vector-refinement-worker-client");
      if (
        controller.signal.aborted
        || !paperVectorRefinementActiveRef.current
        || paperVectorRefinementRunIdRef.current !== runId
      ) {
        return;
      }
      const client = getStudioPaperVectorRefinementWorkerClient({
        engineEpoch,
      });
      paperVectorRefinementClientRef.current = client;
      const provider = {
        refine: (request: unknown) =>
          client.refine(request, { signal: controller.signal }),
      };
      const result = await refineStudioDrawElementWithPaper({
        element: source,
        provider,
        requestSequence,
        engineEpoch,
        refinement: operation === "simplify"
          ? {
              kind: "simplify",
              tolerance: 0.25 + Math.min(1, Math.max(0, nodeSmoothStrength)) * 2.75,
            }
          : {
              kind: "smooth",
              smoothing: {
                type: "catmull-rom",
                factor: Math.min(1, Math.max(0, nodeSmoothStrength)),
              },
            },
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || !paperVectorRefinementActiveRef.current
        || paperVectorRefinementRunIdRef.current !== runId
      ) {
        return;
      }
      if (!result.ok) {
        if (
          result.providerReason === "aborted"
          || result.providerReason === "disposed"
          || result.providerReason === "epoch-mismatch"
        ) {
          return;
        }
        console.warn(
          `Paper vector refinement was rejected: ${JSON.stringify({
            reason: result.reason,
            providerReason: result.providerReason ?? null,
            detail: result.detail,
          })}`,
        );
        setError(
          result.reason === "budget-exceeded"
            ? "선택한 획이 너무 복잡해 안전한 경로 예산 안에서 정리하지 못했어요."
            : result.reason === "ineligible-element"
              ? "이 브러시는 질감과 획 의미를 보존하기 위해 경로 정리를 제한해요."
              : "경로 정리 결과를 안전하게 검증하지 못했어요. 다시 시도해 주세요."
        );
        return;
      }

      const latestElements = activeElementsRef.current;
      const staleReason = studioVectorAsyncCommandStaleReason(snapshot, {
        runId: paperVectorRefinementRunIdRef.current,
        pageId: currentPageIdRef.current || activePage.id,
        masterEditMode: masterEditModeRef.current,
        selectedIds: currentCanvasSelectionIds(),
        elements: latestElements,
        mutationAllowed: canApplyStudioMutation(mutationTicket),
        reviewLocked: activeSurfaceReviewLockedRef.current,
        isElementLocked: (element) =>
          isEffectivelyLocked(element, activeGroupsRef.current),
      });
      if (staleReason) {
        if (
          staleReason !== "superseded"
          && staleReason !== "document-changed"
        ) {
          setError(
            staleReason === "locked"
              ? "계산 중 획이나 작업면이 잠겨 경로 정리 결과를 적용하지 않았어요."
              : "계산 중 페이지·선택 또는 획이 바뀌어 오래된 경로 정리 결과를 적용하지 않았어요."
          );
        }
        return;
      }

      const nextElements = latestElements.map((element) =>
        element === source ? result.replacement : element
      );
      const committed = commit(nextElements, undefined, targetPageId);
      if (!committed) return;
      selectedIdRef.current = source.id;
      marqueeIdsRef.current = [];
      setSelectedId(source.id);
      setMarqueeIds([]);
      setError(null);
      announceDrawingShortcut(
        operation === "simplify"
          ? "경로의 불필요한 점을 정리했어요."
          : "경로를 자연스러운 곡선으로 다듬었어요."
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error("Failed to refine vector path with Paper worker:", cause);
        setError("벡터 경로 엔진을 시작하지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      if (paperVectorRefinementRunIdRef.current === runId) {
        paperVectorRefinementActiveRef.current = false;
        paperVectorRefinementAbortRef.current = null;
        setPaperVectorRefinementBusy(false);
      }
    }
  }

  // 벡터 패스 불리언 결합 — 마퀴로 고른 도형 2개를 합치기/빼기/교차/제외로 치환한다.
  // CanvasKit PathOps는 전용 module Worker에서 곡선을 계산하고 portable contour만 반환한다.
  // 이 제품 명령은 작업 시작 전 CanvasKit PathOps module Worker를 단일 provider로
  // 선택한다. Worker 생성·초기화·통신·실행이 실패하면 원본 도형을 보존하고
  // unavailable로 종료하며, 같은 요청을 polygon-clipping으로 재실행하지 않는다.
  // 계산은 lazy geometry 청크를 기다리므로 시작 시점의 render closure를 그대로 커밋하면 안 된다.
  // 페이지/Undo/선택/원본/잠금이 하나라도 바뀐 결과는 authority 없는 suggestion으로 폐기하고,
  // 최신 ref-backed surface가 정확히 같은 때에만 단일 undo commit으로 소비한다.
  async function applyPathBooleanCombine(op: StudioPathBooleanOp) {
    if (
      drawingRef.current
      || requireStudioDrawingPointerTransport(
        drawingPointerTransportRef,
      ).getSession()
    ) {
      setError("현재 획을 마친 뒤 도형을 결합할 수 있어요.");
      return;
    }
    if (
      pendingStrokeCommitsRef.current
      && !flushPendingStrokeCommitsRef.current()
    ) {
      setError(
        "마지막 획을 원고에 확정하지 못해 도형 결합을 시작하지 않았어요. 잠금·동기화 상태를 확인해 주세요.",
      );
      return;
    }
    if (pathBooleanActiveRef.current) return;

    const selectedIdsAtStart = currentCanvasSelectionIds();
    const elementsAtStart = activeElementsRef.current;
    const groupsAtStart = activeGroupsRef.current;
    const selectionEls = selectedIdsAtStart
      .map((id) => elementsAtStart.find((el) => el.id === id))
      .filter((el): el is El => Boolean(el));
    const gate = studioPathBooleanUnavailableReason(selectionEls);
    if (gate) {
      setError(gate);
      return;
    }
    if (
      selectionEls.some((el) => isEffectivelyLocked(el, groupsAtStart))
    ) {
      setError("잠긴 도형은 결합할 수 없어요.");
      return;
    }
    const groupIds = new Set(
      selectionEls.map((element) => element.groupId ?? null),
    );
    if (groupIds.size > 1) {
      setError(
        "서로 다른 그룹의 도형은 바로 결합할 수 없어요. 같은 그룹 안에서 선택하거나 먼저 그룹을 해제해 주세요.",
      );
      return;
    }
    if (pageEditLocked && !masterEditMode) {
      setError("이 페이지는 검토 잠금 상태예요. 잠금을 해제한 뒤 편집해 주세요.");
      return;
    }

    const runId = pathBooleanRunIdRef.current + 1;
    pathBooleanRunIdRef.current = runId;
    pathBooleanActiveRef.current = true;
    const controller = new AbortController();
    pathBooleanAbortRef.current = controller;
    const mutationTicket = captureStudioMutationTicket();
    const targetPageId = currentPageIdRef.current || activePage.id;
    const targetMasterEditMode = masterEditModeRef.current;
    const selectedIds = selectionEls.map((element) => element.id);
    const snapshot = {
      runId,
      pageId: targetPageId,
      masterEditMode: targetMasterEditMode,
      selectedIds,
      sourceElements: selectionEls,
    } as const;
    setPathBooleanBusy(true);
    try {
      const indexed = selectionEls
        .map((el) => ({
          el: el as DrawEl & El,
          index: elementsAtStart.findIndex((element) => element.id === el.id),
        }))
        .sort((x, y) => x.index - y.index);
      const base = indexed[0]!.el; // 아래(BACK 쪽)
      const top = indexed[1]!.el; // 위
      const baseSpec = drawElToStudioPathBooleanSpec(base)!;
      const topSpec = drawElToStudioPathBooleanSpec(top)!;
      const qualityModule = await import("./studio-quality-worker-client");
      if (
        controller.signal.aborted
        || !pathBooleanActiveRef.current
        || pathBooleanRunIdRef.current !== runId
      ) {
        return;
      }
      const client = pathBooleanClientRef.current
        ?? new qualityModule.StudioQualityWorkerClient();
      pathBooleanClientRef.current = client;
      const result: StudioPathBooleanCombineResult =
        await combineStudioShapesWithCanvasKit(
          client,
          baseSpec,
          topSpec,
          op,
          { signal: controller.signal },
        );
      if (
        controller.signal.aborted
        || !pathBooleanActiveRef.current
        || pathBooleanRunIdRef.current !== runId
      ) {
        return;
      }
      if (!result.ok) {
        setError(result.reason);
        return;
      }

      const latestElements = activeElementsRef.current;
      const mutationAllowed = canApplyStudioMutation(mutationTicket);
      const staleReason = studioVectorAsyncCommandStaleReason(snapshot, {
        runId: pathBooleanRunIdRef.current,
        pageId: currentPageIdRef.current || activePage.id,
        masterEditMode: masterEditModeRef.current,
        selectedIds: marqueeIdsRef.current,
        elements: latestElements,
        mutationAllowed,
        reviewLocked: activeSurfaceReviewLockedRef.current,
        isElementLocked: (element) =>
          isEffectivelyLocked(element, activeGroupsRef.current),
      });
      if (staleReason) {
        if (
          staleReason !== "superseded"
          && staleReason !== "document-changed"
        ) {
          setError(
            staleReason === "locked"
              ? "계산 중 페이지나 도형이 잠겨 결합 결과를 적용하지 않았어요."
              : "계산 중 페이지·선택 또는 도형이 바뀌어 오래된 결합 결과를 적용하지 않았어요."
          );
        }
        return;
      }

      const latestSelectionEls = selectedIds
        .map((id) => latestElements.find((element) => element.id === id))
        .filter((element): element is El => Boolean(element));
      const latestGate = studioPathBooleanUnavailableReason(
        latestSelectionEls
      );
      if (latestGate) {
        setError(latestGate);
        return;
      }
      const pieceEls = result.output.pieces.map((piece) => ({
        ...studioPathBooleanPieceToDrawElSeed(piece, base),
        id: uid(),
        name: `도형 결합 ${studioPathBooleanOpLabel(op)}`,
        ...(base.groupId ? { groupId: base.groupId } : {}),
        ...(base.blendMode ? { blendMode: base.blendMode } : {}),
        ...(base.noClip !== undefined ? { noClip: base.noClip } : {}),
        ...(base.clipBelow !== undefined ? { clipBelow: base.clipBelow } : {}),
        ...(base.alphaLocked !== undefined
          ? { alphaLocked: base.alphaLocked }
          : {}),
        ...(base.maskSrc ? { maskSrc: base.maskSrc } : {}),
        ...(base.maskEnabled !== undefined
          ? { maskEnabled: base.maskEnabled }
          : {}),
        ...(base.layerRole ? { layerRole: base.layerRole } : {}),
        ...(base.layerColor ? { layerColor: base.layerColor } : {}),
      }) as El);
      const latestBaseIndex = latestElements.findIndex(
        (element) => element.id === base.id
      );
      const kept = latestElements.filter(
        (element) => element.id !== base.id && element.id !== top.id
      );
      const insertAt = latestElements
        .slice(0, latestBaseIndex)
        .filter((element) => element.id !== top.id).length;
      const trackedSourceIds = selectedIds.filter((id) =>
        hasTrack(animTimeline, id)
      );
      const nextTimeline = trackedSourceIds.reduce(
        (document, id) => removeTrack(document, id),
        animTimeline,
      );
      const committed = commit(
        [...kept.slice(0, insertAt), ...pieceEls, ...kept.slice(insertAt)],
        trackedSourceIds.length > 0
          ? { animTimeline: nextTimeline }
          : undefined,
        targetPageId
      );
      if (!committed) return;
      applyGroupSelectionState({
        ...selectionShapeForIds(pieceEls.map((element) => element.id)),
        activeGroupId:
          base.groupId && activeGroupIdRef.current === base.groupId
            ? base.groupId
            : null,
      });
      setError(null);
      announceDrawingShortcut(
        `${studioPathBooleanOpLabel(op)} 완료 · 2개 → ${pieceEls.length}개 · Skia 고품질 경로`,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        // A failed Worker must not stay reusable as if it were healthy. Disposing it prepares a
        // later, explicitly initiated operation; it does not authorize another provider now.
        pathBooleanClientRef.current?.dispose();
        pathBooleanClientRef.current = null;
        console.error("Failed to apply path boolean combine:", err);
        setError(
          err instanceof Error && err.name === "TimeoutError"
            ? "선택한 Skia 도형 결합 시간이 초과되어 원본 도형을 유지했어요. 다음 작업 전에 provider를 다시 선택해 주세요."
            : "선택한 Skia 도형 결합 provider를 사용할 수 없어 원본 도형을 유지했어요. 다른 엔진은 자동으로 실행하지 않았습니다.",
        );
      }
    } finally {
      if (pathBooleanRunIdRef.current === runId) {
        pathBooleanActiveRef.current = false;
        pathBooleanAbortRef.current = null;
        setPathBooleanBusy(false);
      }
    }
  }

  return { applyPaperVectorRefinement, applyPathBooleanCombine };
}

/* -------------------------------------------------------------------------- *
 * Settled-stroke centerline refit — opt-in enhancer seam (V12 §12.2 "Kurbo
 * centerline" in the product vector-path lane).
 * -------------------------------------------------------------------------- */

/**
 * Explicit product gate for the settled-phase Kurbo centerline refit. The
 * capability ships default-OFF: with no options (or `enabled: false`) the seam
 * is a pure no-op — it touches nothing, calls no engine, and existing vector
 * ops stay byte-identical. Turning it on product-wide is an authority change
 * that requires the visual-equivalence gate first; until then only explicit
 * callers (tests, gated experiments) pass `enabled: true`.
 */
export interface StudioSettledCenterlineRefitOptions {
  readonly enabled: boolean;
  /** Injected Kurbo fitter (studio-engine-vello fitPolylineToPath). */
  readonly fitEngine: CenterlineFitEngine;
  /** Kurbo fit tolerance in px (package default 0.35). */
  readonly accuracy?: number;
  /** Deviation gate in px (package default accuracy × 2). */
  readonly maxDeviationPx?: number;
}

export type StudioSettledCenterlineRefitOutcome =
  | { readonly kind: "disabled" }
  | { readonly kind: "ineligible"; readonly reason: string }
  | { readonly kind: "refit"; readonly refit: SettledCenterlineRefitResult };

/**
 * Post-settle enhancer seam: refit a settled freehand stroke's CENTERLINE
 * (never the outline polygon — the package guard throws a typed
 * CenterlineRefitError on ring input; kurbo has measured non-termination on
 * sliver outlines) to a smooth editable bezier.
 *
 * The outcome is a PathIR proposal plus its numeric receipt; the DrawEl is
 * never mutated here. The document model has no fitted-centerline field yet,
 * so the sample polyline stays the persistence authority until the visual
 * gate and the model slice land — this seam ships the capability, not the
 * authority change. Package invariant violations (endpoint drift, deviation
 * beyond tolerance, degenerate fit) propagate as CenterlineRefitError: the
 * caller keeps the original stroke, never a silent approximation.
 */
export function refitSettledStudioStrokeCenterline(
  element: DrawEl,
  options?: StudioSettledCenterlineRefitOptions,
): StudioSettledCenterlineRefitOutcome {
  if (options?.enabled !== true) return { kind: "disabled" };
  if ((element.kind ?? "freehand") !== "freehand") {
    return { kind: "ineligible", reason: "shape-stroke" };
  }
  if (element.mode === "eraser") {
    // Refitting an eraser centerline would silently change erase coverage.
    return { kind: "ineligible", reason: "eraser-stroke" };
  }
  const points = element.points;
  if (points.length < 4 || points.length % 2 !== 0) {
    return { kind: "ineligible", reason: "insufficient-points" };
  }
  const centerline: Array<readonly [number, number]> = [];
  for (let at = 0; at < points.length; at += 2) {
    centerline.push([points[at]!, points[at + 1]!] as const);
  }
  const refit = refitSettledCenterline(centerline, options.fitEngine, {
    ...(options.accuracy !== undefined ? { accuracy: options.accuracy } : {}),
    ...(options.maxDeviationPx !== undefined
      ? { maxDeviationPx: options.maxDeviationPx }
      : {}),
  });
  return { kind: "refit", refit };
}
