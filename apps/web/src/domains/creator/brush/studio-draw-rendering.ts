import {
  processFreehandPoints,
  resampleStrokePressures,
  resolveStudioBrushRenderFamily,
  strokeRenderDistance,
} from "../studio-brush";
import { planStudioCausalInk } from "../studio-causal-ink";
import { fillStudioCausalInkDabs } from "../studio-causal-ink-canvas";
import {
  resolveStudioCausalInkNib,
  type StudioCausalInkNib,
} from "../studio-marker-nib-profile";
import {
  fillStudioPixelPencilCells,
  isStudioPixelPencilRenderMode,
  planStudioPixelPencilCells,
} from "../studio-pixel-pencil";

import {
  isStudioBrushEraserAliasId,
  mapStudioBrushAliasPressure,
  mapStudioBrushAliasPressureSamples,
  studioBrushAliasEffectiveDiameter,
} from "./studio-brush-alias-profile";
import {
  resolveStudioBrushDynamicsPresetId,
  resolveStudioCapturedBrushDynamicsPresetId,
} from "./studio-brush-dynamics";
import {
  resolveStudioStampBrushKind,
} from "./studio-brush-stamp-engine";
import {
  studioBrushSymmetryTransforms,
} from "./studio-brush-symmetry";
import {
  studioInkFallbackPressure,
} from "./studio-ink-pressure-model";
import { isStudioStrokePaintModelCompatible } from "./studio-stroke-paint-model";

import type { StudioBrushSymmetrySpec } from "./studio-brush-symmetry";
import type { DrawEl } from "../studio-element-model";
import type { StudioInkPressureModel } from "./studio-ink-pressure-model";
import type { StudioStrokePaintModel } from "./studio-stroke-paint-model";
import type { StudioLiveInkStrokeStyle } from "../live/studio-live-ink-overlay";
import type Konva from "konva";

export type StudioDraftPreviewCompositeMode = "source-over" | "backdrop-multiply";

export interface StudioDraftPreviewCompositeRun {
  readonly elements: readonly DrawEl[];
  readonly key: string;
  readonly mode: StudioDraftPreviewCompositeMode;
}

export const STUDIO_DRAFT_PREVIEW_MAX_SETTLED_COMPOSITE_LAYERS = 2;

export type StudioDraftPreviewCompositeRunPlan =
  | readonly []
  | readonly [StudioDraftPreviewCompositeRun]
  | readonly [StudioDraftPreviewCompositeRun, StudioDraftPreviewCompositeRun];

export interface StudioDraftPreviewBackdropBoundaryPlan {
  readonly action: "continue" | "flush";
  readonly reason:
    | "eraser-backdrop"
    | "within-layer-bound"
    | "retained-dom-backdrop"
    | "overlay-owned-fifo"
    | "third-blend-run";
}

export interface StudioDraftPreviewBackdropBoundaryExecution {
  readonly ready: boolean;
  readonly synchronized: boolean;
}

export type StudioDraftPreviewActiveLane =
  | "normal"
  | "backdrop-multiply"
  | "fixed-fx"
  | "dynamic"
  | null;

/**
 * Returns the DOM-canvas blend contract required by one retained preview element.
 *
 * A Konva Layer is a separate transparent HTMLCanvasElement. Therefore a highlighter Shape using
 * Canvas2D `multiply` cannot see committed pixels in a lower Layer: its first source is simply
 * painted onto transparency. The Layer canvas itself must multiply against the already-composited
 * backdrop. This mode is deliberately limited to the one-wash freehand highlighter path; applying
 * it to a mixed run would incorrectly multiply ordinary drafts as well.
 */
export function resolveStudioDraftPreviewCompositeMode(
  element: Pick<DrawEl, "brush" | "fill" | "kind" | "mode">,
): StudioDraftPreviewCompositeMode {
  if (
    element.mode === "pen"
    && (element.kind ?? "freehand") === "freehand"
    && !element.fill
    && resolveStudioBrushRenderFamily(element.brush) === "highlighter"
  ) return "backdrop-multiply";
  return "source-over";
}

function collectStudioDraftPreviewCompositeRuns(
  elements: readonly DrawEl[],
): StudioDraftPreviewCompositeRun[] {
  const runs: Array<{
    elements: DrawEl[];
    key: string;
    mode: StudioDraftPreviewCompositeMode;
  }> = [];
  for (const element of elements) {
    if (element.mode === "eraser") continue;
    const mode = resolveStudioDraftPreviewCompositeMode(element);
    const previous = runs.at(-1);
    if (previous?.mode === mode) {
      previous.elements.push(element);
      continue;
    }
    runs.push({
      elements: [element],
      key: `${element.id}:${mode}`,
      mode,
    });
  }
  return runs;
}

/**
 * Decides whether the existing 200 ms retained queue must be made canonical before pointerdown.
 *
 * A multiply preview can see retained Konva canvases, but an older native DOM live surface is a
 * separate authority sibling. That sibling must be synchronously handed to the main scene before
 * the new wash owns its first sample. Independently, a third alternating blend run would require a
 * third full-DPR Konva Layer, so it is also a hard flush boundary.
 */
export function planStudioDraftPreviewBackdropBoundary(input: {
  readonly incoming: Pick<DrawEl, "brush" | "fill" | "kind" | "mode">;
  readonly pending: readonly DrawEl[];
  readonly hasRetainedDomBackdrop: boolean;
  /** Pending FIFO already lives on the native overlay that will also own this gesture. */
  readonly overlayOwnsPendingAndIncoming?: boolean;
}): StudioDraftPreviewBackdropBoundaryPlan {
  if (input.overlayOwnsPendingAndIncoming) {
    return { action: "continue", reason: "overlay-owned-fifo" };
  }
  // A destination-out preview must share the retained main canvas with every pixel it can erase.
  // Commit the bounded 200 ms preview FIFO first, otherwise the live gesture cannot affect those
  // newer sibling canvases and they disappear only at pointer-up when the document catches up.
  if (input.incoming.mode === "eraser" && input.pending.length > 0) {
    return { action: "flush", reason: "eraser-backdrop" };
  }
  const incomingMode = resolveStudioDraftPreviewCompositeMode(input.incoming);
  if (incomingMode === "backdrop-multiply" && input.hasRetainedDomBackdrop) {
    return { action: "flush", reason: "retained-dom-backdrop" };
  }
  const pendingRuns = collectStudioDraftPreviewCompositeRuns(input.pending);
  const projectedRunCount = pendingRuns.length + (
    pendingRuns.at(-1)?.mode === incomingMode ? 0 : 1
  );
  if (projectedRunCount > STUDIO_DRAFT_PREVIEW_MAX_SETTLED_COMPOSITE_LAYERS) {
    return { action: "flush", reason: "third-blend-run" };
  }
  return { action: "continue", reason: "within-layer-bound" };
}

/** Executes the planned authority handoff before the caller reads the first pointer coordinate. */
export function executeStudioDraftPreviewBackdropBoundary(input: {
  readonly plan: StudioDraftPreviewBackdropBoundaryPlan;
  readonly flushSynchronously: (flush: () => void) => void;
  readonly flushPending: () => boolean;
  readonly restorePointerPosition: () => void;
}): StudioDraftPreviewBackdropBoundaryExecution {
  if (input.plan.action === "continue") {
    return { ready: true, synchronized: false };
  }
  let ready = false;
  input.flushSynchronously(() => {
    ready = input.flushPending();
  });
  if (!ready) return { ready: false, synchronized: false };
  input.restorePointerPosition();
  return { ready: true, synchronized: true };
}

/**
 * Preserves FIFO paint order while sharing one canvas between adjacent drafts with the same blend.
 * Alternating normal/highlighter strokes remain separate DOM layers so a later source-over stroke
 * can cover an earlier wash exactly as it will after the main-layer commit.
 */
export function planStudioDraftPreviewCompositeRuns(
  elements: readonly DrawEl[],
): StudioDraftPreviewCompositeRunPlan {
  const runs = collectStudioDraftPreviewCompositeRuns(elements);
  if (runs.length > STUDIO_DRAFT_PREVIEW_MAX_SETTLED_COMPOSITE_LAYERS) {
    throw new RangeError(
      "Studio draft preview exceeded the two-layer blend boundary; flush pending strokes before starting the next blend run.",
    );
  }
  if (runs.length === 0) return [];
  if (runs.length === 1) return [runs[0]!];
  return [runs[0]!, runs[1]!];
}

/**
 * Chooses the smallest preview surface that preserves the brush's accepted pixel semantics.
 *
 * Only source-over luminous freehand brushes are safe to composite on an independent transparent
 * layer. Multiply/material brushes (highlighter, oil, and similar media) deliberately stay beside
 * the settled FIFO so their interaction with earlier paint remains unchanged.
 */
export function resolveStudioDraftPreviewActiveLane(
  active: DrawEl | null,
): StudioDraftPreviewActiveLane {
  if (!active || active.mode === "eraser") return null;
  if (
    active.mode === "pen"
    && resolveStudioCapturedBrushDynamicsPresetId(active) !== null
  ) return "dynamic";

  const brushFamily = resolveStudioBrushRenderFamily(active.brush);
  if (resolveStudioDraftPreviewCompositeMode(active) === "backdrop-multiply") {
    return "backdrop-multiply";
  }
  if (
    active.mode === "pen"
    && (active.kind ?? "freehand") === "freehand"
    && !active.fill
    && (brushFamily === "neon" || brushFamily === "glow" || brushFamily === "glitter")
  ) return "fixed-fx";

  return "normal";
}

export function drawBounds(points: number[]) {
  const [x1 = 0, y1 = 0, x2 = x1, y2 = y1] = points;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * Resolves the artist-facing brush name into the live renderer's exact document-pixel diameter.
 * Erasers intentionally retain their selected width even when the previously selected pen is an
 * alias: changing from a bold marker to the eraser must not silently resize the eraser footprint.
 */
export function studioLiveBrushEffectiveDiameter(el: DrawEl): number {
  const selectedDiameter = Math.max(1, el.strokeWidth);
  return el.mode === "eraser" && !isStudioBrushEraserAliasId(el.brush)
    ? selectedDiameter
    : studioBrushAliasEffectiveDiameter(el.brush, selectedDiameter);
}

/** Maps one raw source pressure at the live boundary without changing persisted stroke samples. */
export function studioLiveBrushPressure(el: DrawEl, pressure: unknown): number {
  return mapStudioBrushAliasPressure(
    el.mode === "eraser" && !isStudioBrushEraserAliasId(el.brush)
      ? null
      : el.brush,
    pressure,
    studioInkFallbackPressure(el.pressureModel)
  );
}

/**
 * Aligns and maps live pressure samples once for the requested source-point count. The returned
 * array is renderer-owned; the DrawEl pressure history stays raw so retained/export renderers can
 * apply the same versioned alias profile independently.
 */
export function studioLiveBrushPressureSamples(
  el: DrawEl,
  sourcePointCount = Math.floor(el.points.length / 2)
): number[] {
  return mapStudioBrushAliasPressureSamples(
    el.mode === "eraser" && !isStudioBrushEraserAliasId(el.brush)
      ? null
      : el.brush,
    el.pressures,
    sourcePointCount,
    studioInkFallbackPressure(el.pressureModel)
  );
}

/**
 * The complete canonical input consumed by both the immediate live surface and the retained
 * renderer. Keeping this as one resolver is important for alias brushes: diameter and pressure
 * curves must be applied exactly once, and an unsupported paint model must not silently change
 * renderer selection at pointer-up.
 */
export interface StudioCausalInkDrawContract {
  readonly points: readonly number[];
  readonly pressures: readonly number[];
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly minDistance: number;
  readonly pressureModel?: StudioInkPressureModel;
  readonly paintModel?: StudioStrokePaintModel;
  readonly opacity: number;
  readonly composite: GlobalCompositeOperation;
  /** Chisel/bullet footprint for the marker family; omitted brushes keep the round dab. */
  readonly nib?: StudioCausalInkNib;
}

export function resolveStudioCausalInkDrawContract(
  el: DrawEl,
  points: readonly number[] = el.points
): StudioCausalInkDrawContract {
  const eraser = el.mode === "eraser";
  return {
    points,
    pressures: studioLiveBrushPressureSamples(el, Math.floor(points.length / 2)),
    strokeColor: eraser ? "#16100c" : el.stroke,
    strokeWidth: studioLiveBrushEffectiveDiameter(el),
    // The retained causal renderer historically treats an omitted persisted spacing as zero.
    // Use that exact value live so pointer-up cannot re-thin the same document route. A truly
    // legacy stroke (neither field present) keeps its frozen 3px overlay thinning contract.
    minDistance: el.sampleSpacing !== undefined || el.pressureModel !== undefined
      ? el.sampleSpacing ?? 0
      : strokeRenderDistance(undefined),
    pressureModel: el.pressureModel,
    paintModel: isStudioStrokePaintModelCompatible(el) ? el.paintModel : undefined,
    opacity: Math.min(1, Math.max(0, el.opacity ?? 1)),
    composite: eraser ? "destination-out" : "source-over",
    // An eraser lifts ink with its own footprint, not with the selected marker's wedge.
    ...(eraser ? {} : { nib: resolveStudioCausalInkNib(el.brush) }),
  };
}

/** Exact style projection consumed by the native live and prediction overlay surfaces. */
export function resolveStudioLiveInkStrokeStyle(el: DrawEl): StudioLiveInkStrokeStyle {
  const contract = resolveStudioCausalInkDrawContract(el);
  return {
    color: contract.strokeColor,
    strokeWidthDoc: contract.strokeWidth,
    pressureModel: contract.pressureModel,
    paintModel: contract.paintModel,
    opacity: contract.opacity,
    minDistanceDoc: contract.minDistance,
  };
}

export function getSymmetricPoints(
  points: number[],
  symmetry: StudioBrushSymmetrySpec | undefined
): number[][] {
  if (!symmetry || symmetry.type === "none" || points.length === 0) {
    return [points];
  }

  return studioBrushSymmetryTransforms(symmetry).map((transform, transformIndex) => {
    if (transformIndex === 0) return points;
    const mapped = new Array<number>(points.length);
    let writeIndex = 0;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x !== undefined && y !== undefined) {
        // Apply the affine pair directly. Calling the tuple-returning point helper here allocated
        // one short array per point, per symmetry copy, on every live draft frame.
        mapped[writeIndex] = transform.a * x + transform.c * y + transform.e;
        mapped[writeIndex + 1] = transform.b * x + transform.d * y + transform.f;
        writeIndex += 2;
      }
    }
    mapped.length = writeIndex;
    return mapped;
  });
}

/**
 * Default(pen/marker/eraser) 프리핸드 경로의 공용 래스터라이저 — 중점 이차곡선 + 정점 필압 폭.
 * StudioDrawNode 의 선언적 Shape 와 다이렉트 라이브 초안(임페러티브 sceneFunc)이 같은 함수를
 * 그려 미리보기와 커밋 픽셀이 일치한다.
 */
export function drawFreehandPenSegments(
  context: Konva.Context,
  smoothed: number[],
  sampledPressures: readonly number[] | null,
  strokeColor: string,
  strokeWidth: number,
  composite?: GlobalCompositeOperation,
): void {
  if (smoothed.length < 4) return;
  if (composite && composite !== "source-over") {
    if (typeof (context as { setAttr?: unknown }).setAttr === "function") {
      context.setAttr("globalCompositeOperation", composite);
    }
    context.globalCompositeOperation = composite;
    if (context._context) context._context.globalCompositeOperation = composite;
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = strokeColor;
  const widthAt = (idx: number) => {
    if (!sampledPressures) return strokeWidth;
    const p = sampledPressures[idx] ?? 0.5;
    return Math.max(0.5, strokeWidth * (0.3 + p * 1.4));
  };
  const count = smoothed.length / 2;
  if (count === 2) {
    context.beginPath();
    context.moveTo(smoothed[0]!, smoothed[1]!);
    context.lineTo(smoothed[2]!, smoothed[3]!);
    context.lineWidth = widthAt(1);
    context.stroke();
    return;
  }
  let prevMidX = smoothed[0]!;
  let prevMidY = smoothed[1]!;
  for (let i = 1; i < count; i += 1) {
    const cx = smoothed[(i - 1) * 2]!;
    const cy = smoothed[(i - 1) * 2 + 1]!;
    const x = smoothed[i * 2]!;
    const y = smoothed[i * 2 + 1]!;
    const isLast = i === count - 1;
    const midX = isLast ? x : (cx + x) / 2;
    const midY = isLast ? y : (cy + y) / 2;
    context.beginPath();
    context.moveTo(prevMidX, prevMidY);
    context.quadraticCurveTo(cx, cy, midX, midY);
    context.lineWidth = widthAt(i);
    context.stroke();
    prevMidX = midX;
    prevMidY = midY;
  }
}

/** Canonical new-stroke rasterizer shared with the Canvas live overlay and retained WebGPU path. */
export function drawStudioCausalInkDabs(
  context: Konva.Context,
  points: readonly number[],
  pressures: readonly number[] | undefined,
  strokeColor: string,
  strokeWidth: number,
  minDistance: number,
  pressureModel?: StudioInkPressureModel,
  paintModel?: StudioStrokePaintModel,
  nib?: StudioCausalInkNib
): void {
  const plan = planStudioCausalInk({
    points,
    pressures,
    minDistance,
    size: strokeWidth,
    pressureModel,
  });
  fillStudioCausalInkDabs(context, plan.dabs, strokeColor, paintModel, nib);
}

/** Draws the already-resolved contract without reapplying alias or pressure transformations. */
export function drawStudioCausalInkContract(
  context: Konva.Context,
  contract: StudioCausalInkDrawContract
): void {
  if (contract.composite && contract.composite !== "source-over") {
    if (typeof (context as { setAttr?: unknown }).setAttr === "function") {
      context.setAttr("globalCompositeOperation", contract.composite);
    }
    context.globalCompositeOperation = contract.composite;
    if (context._context) context._context.globalCompositeOperation = contract.composite;
  }
  drawStudioCausalInkDabs(
    context,
    contract.points,
    contract.pressures,
    contract.strokeColor,
    contract.strokeWidth,
    contract.minDistance,
    contract.pressureModel,
    contract.paintModel,
    contract.nib
  );
}

/**
 * 다이렉트 라이브 초안 대상인지 — StudioDrawNode 의 Default(pen/marker/eraser) 브랜치와 정확히
 * 같은 집합만 참이어야 미리보기가 커밋과 픽셀 단위로 일치한다. 지우개는 모든 브러시에서 Default
 * 경로를 타고, dynamics 프리셋 브러시(mode "pen")는 dab 브랜치라 제외한다.
 */
export function isDirectLiveDraftEl(el: DrawEl): boolean {
  if ((el.kind ?? "freehand") !== "freehand") return false;
  if (el.mode === "eraser") return true;
  if (isStudioPixelPencilRenderMode(el.brush)) return true;
  const family = resolveStudioBrushRenderFamily(el.brush ?? "pen");
  if (family !== "pen" && family !== "marker") return false;
  return resolveStudioBrushDynamicsPresetId(el.brush) === null;
}

/** v2 스탬프는 raw accepted point 접미사를 자체 walker에 공급한다(대칭은 retained affine compositor가 소유). */
export function isDirectLiveStampDraftEl(el: DrawEl): boolean {
  const stampKind = resolveStudioStampBrushKind(el.brush);
  return (el.kind ?? "freehand") === "freehand"
    && el.mode === "pen"
    && !el.fill
    && el.stampPipeline === "causal-walker-v2"
    && stampKind !== null
    // Ink now uses one stroke-local ribbon fill. The append-only dab overlay cannot reproduce
    // translucent retrace/figure-eight union semantics without repainting the gesture mask, so
    // active ink intentionally stays on the exact retained Shape path.
    && stampKind !== "ink"
    && (el.symmetry?.type ?? "none") === "none";
}

/** 다이렉트 라이브 초안을 임페러티브로 그린다 — React 렌더 없이 Konva batchDraw 로만 갱신. */
export function drawLiveFreehandDraftToContext(context: Konva.Context, el: DrawEl): void {
  const isEraser = el.mode === "eraser";
  const contract = resolveStudioCausalInkDrawContract(el);
  const strokeColor = contract.strokeColor;
  const strokeWidth = contract.strokeWidth;
  const renderSampleDistance = strokeRenderDistance(el.sampleSpacing);
  const variations = getSymmetricPoints(el.points, el.symmetry);
  const livePressures = contract.pressures;
  context.save();
  context.globalAlpha = contract.opacity;
  context.globalCompositeOperation = contract.composite;
  for (const points of variations) {
    if (!isEraser && isStudioPixelPencilRenderMode(el.brush)) {
      const pixelPlan = planStudioPixelPencilCells({ points, strokeWidth });
      if (!pixelPlan.complete) continue;
      context.fillStyle = strokeColor;
      fillStudioPixelPencilCells(context, pixelPlan.cells);
      continue;
    }
    if ((el.sampleSpacing !== undefined || el.pressureModel !== undefined) && !el.fill) {
      drawStudioCausalInkContract(context, { ...contract, points });
      continue;
    }
    if (points.length === 2) {
      const pressure = livePressures[0] ?? studioLiveBrushPressure(el, undefined);
      const width = strokeWidth * (0.3 + pressure * 1.4);
      context.beginPath();
      context.arc(points[0]!, points[1]!, Math.max(0.35, width / 2), 0, Math.PI * 2);
      context.fillStyle = strokeColor;
      context.fill();
      continue;
    }
    const smoothed = processFreehandPoints(points, renderSampleDistance);
    const fill = !isEraser ? el.fill : undefined;
    if (fill && smoothed.length >= 6) {
      context.beginPath();
      context.moveTo(smoothed[0]!, smoothed[1]!);
      for (let i = 2; i < smoothed.length; i += 2) {
        context.lineTo(smoothed[i]!, smoothed[i + 1]!);
      }
      context.closePath();
      context.fillStyle = fill;
      context.fill();
    }
    const sampledPressures = livePressures.length > 0 && smoothed.length >= 4
      ? resampleStrokePressures(livePressures, Math.floor(smoothed.length / 2))
      : null;
    drawFreehandPenSegments(context, smoothed, sampledPressures, strokeColor, strokeWidth);
  }
  context.restore();
}
