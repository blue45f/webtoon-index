/**
 * Append-only live surface for versioned dynamic brushes.
 *
 * Causal-v2 pointer frames consume only the unseen accepted-sample suffix. Older non-causal
 * texture snapshots still consume only the unseen source suffix, but redraw that accepted prefix
 * from the exact canonical planner: their station positions, whole-stroke taper and stamp-grid
 * budget depend on the current endpoint and cannot be reproduced by an independent append walker.
 * Pointer-up reuses the same exact plan before the stroke is flattened into the settled FIFO.
 *
 * Material planning is deliberately shared with the committed bounded-flow renderer. If the
 * current tip/grain/dual/layer/flow combination cannot produce a bounded mark plan, this renderer
 * reports an explicit rejection while retaining the accepted source/pixels for the host's
 * explicit cancellation or next-operation decision.
 */

import {
  isStudioDynamicBrushCausalDepositPipeline,
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  serializeStudioBrushDynamicsSettingsCanonical,
  STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE,
  studioDynamicBrushDepositPipelineUsesContinuation,
  studioBrushDynamicsSeedFromKey,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "../brush/studio-brush-dynamics";
import {
  planStudioDynamicBrushRenderBudget,
  selectStudioDynamicBrushCausalStampGrid,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
  studioDynamicBrushCausalStampGridRuleOf,
  type StudioDynamicBrushAcceptedPrefixReceipt,
  type StudioDynamicBrushRenderStampGrid,
} from "../brush/studio-brush-render-budget";
import {
  studioBrushSymmetryTransforms,
  studioDynamicBrushDabVariationsFromTransforms,
  transformStudioBrushSymmetryPoint,
  type StudioBrushSymmetrySpec,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";
import {
  resolveStudioDynamicBrushMaterialIdentity,
  studioDryMediaDynamicBridgeMarkMultiplier,
  type StudioDynamicBrushMaterialIdentity,
} from "../brush/studio-dry-media-dynamic-bridge";
import {
  studioDryMediaUnionRibbonCarrierOwnsMaterial,
} from "../brush/studio-dry-media-union-ribbon-carrier";
import { resolveStudioPaperBrushResponse, resolveStudioPaperBrushMedium } from "../brush/studio-paper-brush-response";
import {
  resolveStudioDocumentPaperSurface,
  studioPaperGranulationIsActive,
  type StudioPaperGranulationSettings,
  type StudioPaperSurfaceSettings,
} from "../brush/studio-paper-granulation-runtime";
import {
  normalizeStudioPaperSubstrateModel,
  studioPaperUsesContactTooth,
} from "../brush/studio-paper-substrate-model";
import { isStudioBoundedFlowPaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  appendStudioCausalDynamicBrushDepositsV2,
  appendStudioCausalDynamicBrushDepositsV3,
  beginStudioCausalDynamicBrushDepositV2,
  beginStudioCausalDynamicBrushDepositV3,
  planStudioCausalDynamicBrushDepositSegmentsV3,
  planStudioCausalDynamicBrushDepositsV2,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
  type StudioCausalDynamicBrushDepositStateV2,
  type StudioCausalDynamicBrushDepositStateV3,
} from "../studio-causal-dynamic-brush-deposit-v2";
import {
  studioCompetitorSpecialtyRibbonCarrierOwnsMaterial,
} from "../studio-competitor-specialty-ribbon-carrier";
import {
  STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverageMark,
  resolveStudioDynamicBrushCoverageBudgetContract,
  type StudioDynamicBrushCoverageMark,
  type StudioDynamicBrushSegmentedDabVariation,
} from "../studio-dynamic-brush-coverage-renderer";
import {
  acquireStudioLowLatencyCanvas2dContext,
  resolveStudioLiveSurfaceDevicePixelRatio,
  STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS,
} from "../studio-low-latency-canvas";
import {
  studioProfessionalShelfRibbonCarrierOwnsMaterial,
} from "../studio-professional-shelf-ribbon-carrier";
import {
  studioSplatterOriginAnchorMarkCount,
} from "../studio-splatter-origin-anchor";
import {
  studioWebDrawingKitOwnsStrokeGeometry,
  planStudioWebDrawingKitOwnedDabs,
  recommendStudioWebDrawingLiveMaxDabs,
  sliceStudioDynamicDabsForLiveFrame,
} from "../studio-web-drawing-stroke-bridge";

import type { StudioPaperMediumV1 } from "../brush/studio-paper-media-profile-v1";
import type { DrawEl } from "../studio-element-model";
import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";
import type { StudioPaperSubstrateModel } from "../brush/studio-paper-substrate-model";

const POINT_EPSILON = 1e-6;
const MAX_LEGACY_LIVE_DABS = STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.max;
const MAX_COORDINATE_ABS = 1_000_000_000;

export interface StudioLiveDynamicBrushOverlayCanvases {
  /** Full-opacity stroke-local coverage accumulator. This surface is never presented directly. */
  readonly activeCanvas: HTMLCanvasElement;
  /** Canvas2D-alpha-composited live pixels presented above the retained scene. */
  readonly presentationCanvas: HTMLCanvasElement;
  readonly settledCanvas: HTMLCanvasElement;
}

export type StudioLiveDynamicBrushUnavailableReason =
  | "surface-unavailable"
  | "surface-budget"
  | "surface-render";

export type StudioLiveDynamicBrushRejectedReason =
  | "unsupported-style"
  | "stroke-identity"
  | "source-prefix"
  | "invalid-sample"
  | "dab-budget"
  | "mark-budget"
  | "material-plan";

export type StudioLiveDynamicBrushFailureReason =
  | StudioLiveDynamicBrushUnavailableReason
  | StudioLiveDynamicBrushRejectedReason;

export type StudioLiveDynamicBrushOperationFailure =
  | {
      readonly status: "unavailable";
      readonly reason: StudioLiveDynamicBrushUnavailableReason;
    }
  | {
      readonly status: "rejected";
      readonly reason: StudioLiveDynamicBrushRejectedReason;
    };

function dynamicBrushOperationFailure(
  reason: StudioLiveDynamicBrushFailureReason,
): StudioLiveDynamicBrushOperationFailure {
  return reason === "surface-unavailable"
    || reason === "surface-budget"
    || reason === "surface-render"
    ? { status: "unavailable", reason }
    : { status: "rejected", reason };
}

export type StudioLiveDynamicBrushBeginResult =
  | {
      readonly status: "started";
      readonly dabCount: number;
      readonly markCount: number;
    }
  | StudioLiveDynamicBrushOperationFailure;

export type StudioLiveDynamicBrushAppendResult =
  | {
      readonly status: "appended" | "noop";
      readonly consumedSourcePoints: number;
      readonly appendedDabs: number;
      readonly appendedMarks: number;
      readonly acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
    }
  | StudioLiveDynamicBrushOperationFailure;

export type StudioLiveDynamicBrushEndResult =
  | {
      readonly status: "settled";
      readonly dabCount: number;
      readonly markCount: number;
      readonly acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
    }
  | StudioLiveDynamicBrushOperationFailure;

interface DynamicSourceSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly speed: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
}

interface DetachedDynamicStrokeStyle {
  readonly strokeId: string;
  readonly brushId: string;
  readonly materialIdentity: StudioDynamicBrushMaterialIdentity;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly seed: number;
  readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  readonly sourceDynamics: DrawEl["brushDynamics"];
  readonly dynamicsSignature: string;
  readonly symmetry: StudioBrushSymmetrySpec;
  readonly symmetrySignature: string;
  readonly transforms: readonly StudioBrushSymmetryTransform[];
  readonly strokeOrigins: readonly Readonly<{ x: number; y: number }>[];
  /**
   * 이 도구의 종이 반응 + 스트로크 시작 시점의 문서 종이. 획을 그리는 도중 문서 종이가 바뀌어도
   * 라이브 프리픽스와 커밋 결과가 갈라지지 않도록 시작 시 한 번 확정한다.
   */
  readonly paper?: Readonly<{
    readonly response: StudioPaperGranulationSettings;
    readonly surface: StudioPaperSurfaceSettings;
    /** 획이 태어날 때 얼린 substrate 세대. 라이브 프리픽스와 커밋이 갈라지지 않게 함께 옮긴다. */
    readonly model?: StudioPaperSubstrateModel;
    /** 극성 taxonomy상의 상호작용 매체. `model`이 있을 때만 채워진다. */
    readonly medium?: StudioPaperMediumV1;
  }>;
}

interface DynamicStrokeSource {
  readonly points: number[];
  readonly pressures: number[];
  readonly tangentialPressures: number[];
  readonly speeds: number[];
  readonly tiltXs: number[];
  readonly tiltYs: number[];
  readonly twists: number[];
}

interface ActiveDynamicStroke {
  readonly style: DetachedDynamicStrokeStyle;
  readonly source: DynamicStrokeSource;
  /** Version matches the persisted causal-v2 or segmented causal-v3 pipeline exactly. */
  causalState?:
    | StudioCausalDynamicBrushDepositStateV2
    | StudioCausalDynamicBrushDepositStateV3;
  consumedSourcePoints: number;
  previousSample: DynamicSourceSample;
  totalDistance: number;
  distanceSinceLastDab: number;
  nextDabIndex: number;
  lastSpacing: number;
  markCount: number;
  /** Stroke-wide sum of immutable R8 alpha-map receipts across incremental suffix plans. */
  r8AlphaMapBytes: number;
  acceptedCausalDabCount: number;
  plannedCausalDabCount: number;
  acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
  stampGrid: StudioDynamicBrushRenderStampGrid;
  transitionedFromTap: boolean;
  /** Last globally admitted causal dab, retained as one-station geometry context for dry media. */
  lastAcceptedCausalDab?: StudioDynamicBrushDab;
  /** Prefix-stable union geometry; suffix planning appends without rebuilding causal history. */
  dryMediaUnionAccumulator?: DryMediaUnionAccumulator;
}

interface SettledDynamicStroke {
  readonly style: DetachedDynamicStrokeStyle;
  readonly source: DynamicStrokeSource;
}

interface ExactDynamicPlan {
  readonly dabCount: number;
  readonly firstDab?: StudioDynamicBrushDab;
  readonly lastDab?: StudioDynamicBrushDab;
  readonly lastSpacing: number;
  readonly marks: readonly StudioDynamicBrushCoverageMark[];
  readonly stampGrid: StudioDynamicBrushRenderStampGrid;
  readonly dabCapped: boolean;
  readonly r8AlphaMapBytes: number;
  readonly acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
}

type DryMediaUnionRibbon = Extract<
  NonNullable<StudioDynamicBrushCoverageMark["ribbon"]>,
  { readonly kind: "dry-media-union-ribbon-polygon" }
>;

interface DryMediaUnionAccumulatorEntry {
  readonly color: string;
  /**
   * Stroke-constant union alpha captured from the first planned mark. The carrier emits opaque
   * stroke-local coverage today, but the accumulator must not assume that: a snapshot that forced
   * alpha back to 1 would make replay/settle composite darker than the live suffix fills whenever
   * a future carrier version ships flow-scaled unions.
   */
  readonly alpha: number;
  readonly ribbonVersion: DryMediaUnionRibbon["version"];
  readonly polygons: Array<readonly number[]>;
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

interface DryMediaUnionAccumulator {
  readonly entries: DryMediaUnionAccumulatorEntry[];
}

interface PresentationPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function exactPlanUsesWholePrefixRibbonUnion(
  plan: ExactDynamicPlan,
): boolean {
  return plan.marks.length > 0
    && plan.marks.every(
      (mark) => mark.ribbon?.role === "stroke-union"
        && (
          mark.ribbon.kind === "dry-media-union-ribbon-polygon"
          || mark.ribbon.kind === "professional-shelf-ribbon-polygon"
          || mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
        ),
    );
}

function dryMediaUnionPolygonBounds(
  polygons: readonly (readonly number[])[],
): Readonly<{
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}> | null {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    const len = polygon.length;
    if (len < 6 || len % 2 !== 0) return null;
    for (let index = 0; index < len; index += 2) {
      const x = polygon[index]!;
      const y = polygon[index + 1]!;
      if (x < minimumX) minimumX = x;
      if (x > maximumX) maximumX = x;
      if (y < minimumY) minimumY = y;
      if (y > maximumY) maximumY = y;
    }
  }
  return maximumX > minimumX && maximumY > minimumY
    ? { minimumX, minimumY, maximumX, maximumY }
    : null;
}

function quantizeDryMediaUnionCoordinate(value: number): number {
  return Math.round(
    clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS) * 10_000,
  ) / 10_000;
}

/** @internal exported for the colocated overlay contract test only. */
export function createDryMediaUnionAccumulator(
  marks: readonly StudioDynamicBrushCoverageMark[],
): DryMediaUnionAccumulator | null {
  if (marks.length === 0) return null;
  const entries: DryMediaUnionAccumulatorEntry[] = [];
  for (const mark of marks) {
    const ribbon = mark.ribbon;
    if (
      ribbon?.kind !== "dry-media-union-ribbon-polygon"
      || ribbon.role !== "stroke-union"
      || mark.alpha <= 0
    ) return null;
    const bounds = dryMediaUnionPolygonBounds(ribbon.polygons);
    if (!bounds) return null;
    entries.push({
      color: mark.color,
      alpha: mark.alpha,
      ribbonVersion: ribbon.version,
      polygons: [...ribbon.polygons],
      ...bounds,
    });
  }
  return { entries };
}

/** @internal exported for the colocated overlay contract test only. */
export function appendDryMediaUnionAccumulator(
  accumulator: DryMediaUnionAccumulator,
  suffixMarks: readonly StudioDynamicBrushCoverageMark[],
): boolean {
  if (suffixMarks.length !== accumulator.entries.length) return false;
  const pending: Array<Readonly<{
    polygons: readonly (readonly number[])[];
    minimumX: number;
    minimumY: number;
    maximumX: number;
    maximumY: number;
  }>> = [];
  for (const [index, mark] of suffixMarks.entries()) {
    const entry = accumulator.entries[index];
    const ribbon = mark.ribbon;
    if (
      !entry
      // A union stroke owns one immutable colour and one stroke-local alpha. A suffix that
      // changes either is a planner contract violation, so the caller fails closed instead of
      // recording a snapshot that would settle differently from the already-presented fills.
      || ribbon?.kind !== "dry-media-union-ribbon-polygon"
      || ribbon.role !== "stroke-union"
      || ribbon.version !== entry.ribbonVersion
      || mark.alpha !== entry.alpha
      || mark.color !== entry.color
    ) return false;
    const bounds = dryMediaUnionPolygonBounds(ribbon.polygons);
    if (!bounds) return false;
    pending.push({ polygons: ribbon.polygons, ...bounds });
  }
  for (const [index, suffix] of pending.entries()) {
    const entry = accumulator.entries[index]!;
    entry.polygons.push(...suffix.polygons);
    entry.minimumX = Math.min(entry.minimumX, suffix.minimumX);
    entry.minimumY = Math.min(entry.minimumY, suffix.minimumY);
    entry.maximumX = Math.max(entry.maximumX, suffix.maximumX);
    entry.maximumY = Math.max(entry.maximumY, suffix.maximumY);
  }
  return true;
}

/**
 * Materializes the cumulative union as canonical coverage marks.
 *
 * The polygon list is shallow-copied so a retained snapshot stays immutable while later pointer
 * frames keep appending suffix contours to the live accumulator. Incremental appends never call
 * this (they only need the entry count), so the copy runs once per stroke start and replay.
 *
 * @internal exported for the colocated overlay contract test only.
 */
export function snapshotDryMediaUnionAccumulator(
  accumulator: DryMediaUnionAccumulator,
): readonly StudioDynamicBrushCoverageMark[] {
  return accumulator.entries.map((entry) => ({
    x: quantizeDryMediaUnionCoordinate((entry.minimumX + entry.maximumX) / 2),
    y: quantizeDryMediaUnionCoordinate((entry.minimumY + entry.maximumY) / 2),
    radiusX: quantizeDryMediaUnionCoordinate(
      Math.max(0.25, (entry.maximumX - entry.minimumX) / 2),
    ),
    radiusY: quantizeDryMediaUnionCoordinate(
      Math.max(0.25, (entry.maximumY - entry.minimumY) / 2),
    ),
    angleRadians: 0,
    alpha: entry.alpha,
    color: entry.color,
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: entry.ribbonVersion,
      role: "stroke-union",
      polygons: [...entry.polygons],
    },
  }));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS)
    : null;
}

function rotatedEllipseExtent(
  radiusX: number,
  radiusY: number,
  angleRadians: number,
): Readonly<{ x: number; y: number }> {
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return {
    x: Math.hypot(radiusX * cosine, radiusY * sine),
    y: Math.hypot(radiusX * sine, radiusY * cosine),
  };
}

function presentationRectForMarks(
  marks: readonly StudioDynamicBrushCoverageMark[],
  surface: StudioLiveInkSurface,
  dpr: number,
  canvas: Pick<HTMLCanvasElement, "width" | "height">,
): PresentationPixelRect | null {
  let minimumDocumentX = Number.POSITIVE_INFINITY;
  let minimumDocumentY = Number.POSITIVE_INFINITY;
  let maximumDocumentX = Number.NEGATIVE_INFINITY;
  let maximumDocumentY = Number.NEGATIVE_INFINITY;
  for (const mark of marks) {
    if (
      mark.ribbon?.role === "stroke-union"
      && Number.isFinite(mark.x)
      && Number.isFinite(mark.y)
      && Number.isFinite(mark.radiusX)
      && Number.isFinite(mark.radiusY)
      && mark.radiusX >= 0
      && mark.radiusY >= 0
    ) {
      minimumDocumentX = Math.min(minimumDocumentX, mark.x - mark.radiusX);
      minimumDocumentY = Math.min(minimumDocumentY, mark.y - mark.radiusY);
      maximumDocumentX = Math.max(maximumDocumentX, mark.x + mark.radiusX);
      maximumDocumentY = Math.max(maximumDocumentY, mark.y + mark.radiusY);
      continue;
    }
    if (mark.ribbon) {
      for (const polygon of mark.ribbon.polygons) {
        const len = polygon.length;
        for (let index = 0; index < len; index += 2) {
          const x = polygon[index];
          const y = polygon[index + 1];
          if (x === undefined || y === undefined) continue;
          minimumDocumentX = Math.min(minimumDocumentX, x);
          minimumDocumentY = Math.min(minimumDocumentY, y);
          maximumDocumentX = Math.max(maximumDocumentX, x);
          maximumDocumentY = Math.max(maximumDocumentY, y);
        }
      }
      continue;
    }
    const radiusX = Math.max(0, mark.radiusX);
    const radiusY = Math.max(0, mark.radiusY);
    const cosine = Math.cos(mark.angleRadians);
    const sine = Math.sin(mark.angleRadians);
    // Texture stamps are rotated rectangles, not ellipses. Use the complete corner footprint so
    // a dirty presentation crop never omits a grain texel that the committed tile path retains.
    const extent = mark.texture
      ? {
          x: Math.abs(radiusX * cosine) + Math.abs(radiusY * sine),
          y: Math.abs(radiusX * sine) + Math.abs(radiusY * cosine),
        }
      : rotatedEllipseExtent(radiusX, radiusY, mark.angleRadians);
    minimumDocumentX = Math.min(minimumDocumentX, mark.x - extent.x);
    minimumDocumentY = Math.min(minimumDocumentY, mark.y - extent.y);
    maximumDocumentX = Math.max(maximumDocumentX, mark.x + extent.x);
    maximumDocumentY = Math.max(maximumDocumentY, mark.y + extent.y);
  }
  if (
    !Number.isFinite(minimumDocumentX)
    || !Number.isFinite(minimumDocumentY)
    || !Number.isFinite(maximumDocumentX)
    || !Number.isFinite(maximumDocumentY)
  ) return null;

  const scale = dpr * surface.documentScale;
  const translateX = surface.flipX
    ? (surface.documentWidth * surface.documentScale - surface.left) * dpr
    : -surface.left * dpr;
  const translateY = -surface.top * dpr;
  const firstPixelX = (surface.flipX ? -scale : scale) * minimumDocumentX + translateX;
  const secondPixelX = (surface.flipX ? -scale : scale) * maximumDocumentX + translateX;
  const firstPixelY = scale * minimumDocumentY + translateY;
  const secondPixelY = scale * maximumDocumentY + translateY;
  // Canvas antialiasing and filtered alpha-map samples may touch the next pixel outside the
  // analytic footprint. Three physical pixels cover that fringe without turning an append into a
  // full-surface presentation copy.
  const fringe = 3;
  const minimumPixelX = Math.max(
    0,
    Math.floor(Math.min(firstPixelX, secondPixelX)) - fringe,
  );
  const minimumPixelY = Math.max(
    0,
    Math.floor(Math.min(firstPixelY, secondPixelY)) - fringe,
  );
  const maximumPixelX = Math.min(
    canvas.width,
    Math.ceil(Math.max(firstPixelX, secondPixelX)) + fringe,
  );
  const maximumPixelY = Math.min(
    canvas.height,
    Math.ceil(Math.max(firstPixelY, secondPixelY)) + fringe,
  );
  const width = maximumPixelX - minimumPixelX;
  const height = maximumPixelY - minimumPixelY;
  return width > 0 && height > 0
    ? {
        x: minimumPixelX,
        y: minimumPixelY,
        width,
        height,
      }
    : null;
}

function unionPresentationPixelRects(
  left: PresentationPixelRect | null,
  right: PresentationPixelRect,
): PresentationPixelRect {
  if (!left) return right;
  const minimumX = Math.min(left.x, right.x);
  const minimumY = Math.min(left.y, right.y);
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(left.x + left.width, right.x + right.width) - minimumX,
    height: Math.max(left.y + left.height, right.y + right.height) - minimumY,
  };
}

function detachedSymmetry(value: DrawEl["symmetry"]): StudioBrushSymmetrySpec {
  return value
    ? {
        type: value.type,
        centerX: finiteNumber(value.centerX, 0),
        centerY: finiteNumber(value.centerY, 0),
        radialCount: value.radialCount,
      }
    : { type: "none", centerX: 0, centerY: 0 };
}

function sourceSampleAt(
  element: DrawEl,
  index: number,
  fallbackPressure: number
): DynamicSourceSample | null {
  const x = finiteCoordinate(element.points[index * 2]);
  const y = finiteCoordinate(element.points[index * 2 + 1]);
  if (x === null || y === null) return null;
  return {
    x,
    y,
    pressure: clamp01(finiteNumber(element.pressures?.[index], fallbackPressure)),
    tangentialPressure: clamp(
      finiteNumber(element.tangentialPressures?.[index], 0),
      -1,
      1,
    ),
    speed: clamp(finiteNumber(element.speeds?.[index], 0), 0, 64),
    tiltX: clamp(finiteNumber(element.tiltXs?.[index], 0), -90, 90),
    tiltY: clamp(finiteNumber(element.tiltYs?.[index], 0), -90, 90),
    twist: clamp(finiteNumber(element.twists?.[index], 0), 0, 359),
  };
}

function appendSourceSample(source: DynamicStrokeSource, sample: DynamicSourceSample): void {
  source.points.push(sample.x, sample.y);
  source.pressures.push(sample.pressure);
  source.tangentialPressures.push(sample.tangentialPressure);
  source.speeds.push(sample.speed);
  source.tiltXs.push(sample.tiltX);
  source.tiltYs.push(sample.tiltY);
  source.twists.push(sample.twist);
}

function detachedSource(source: DynamicStrokeSource): DynamicStrokeSource {
  return {
    points: [...source.points],
    pressures: [...source.pressures],
    tangentialPressures: [...source.tangentialPressures],
    speeds: [...source.speeds],
    tiltXs: [...source.tiltXs],
    tiltYs: [...source.tiltYs],
    twists: [...source.twists],
  };
}

function dynamicSourceFromElement(
  element: DrawEl,
  fallbackPressure: number,
): DynamicStrokeSource | null {
  const source: DynamicStrokeSource = {
    points: [],
    pressures: [],
    tangentialPressures: [],
    speeds: [],
    tiltXs: [],
    tiltYs: [],
    twists: [],
  };
  const total = Math.floor(element.points.length / 2);
  for (let index = 0; index < total; index += 1) {
    const sample = sourceSampleAt(element, index, fallbackPressure);
    if (!sample) return null;
    appendSourceSample(source, sample);
  }
  return source;
}

function dynamicSourceMatchesElement(
  source: DynamicStrokeSource,
  element: DrawEl,
  fallbackPressure: number,
): boolean {
  const total = Math.floor(element.points.length / 2);
  if (source.points.length !== total * 2) return false;
  for (let index = 0; index < total; index += 1) {
    const sample = sourceSampleAt(element, index, fallbackPressure);
    if (!sample) return false;
    if (
      source.points[index * 2] !== sample.x
      || source.points[index * 2 + 1] !== sample.y
      || source.pressures[index] !== sample.pressure
      || source.tangentialPressures[index] !== sample.tangentialPressure
      || source.speeds[index] !== sample.speed
      || source.tiltXs[index] !== sample.tiltX
      || source.tiltYs[index] !== sample.tiltY
      || source.twists[index] !== sample.twist
    ) return false;
  }
  return true;
}

function dynamicStyleForSourceOrigin(
  style: DetachedDynamicStrokeStyle,
  source: DynamicStrokeSource,
): DetachedDynamicStrokeStyle | null {
  const firstX = finiteCoordinate(source.points[0]);
  const firstY = finiteCoordinate(source.points[1]);
  if (firstX === null || firstY === null) return null;
  return {
    ...style,
    strokeOrigins: style.transforms.map((transform) => {
      const [x, y] = transformStudioBrushSymmetryPoint(firstX, firstY, transform);
      return Object.freeze({ x, y });
    }),
  };
}

function segmentedDabCount(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
): number {
  return segments.reduce((count, segment) => count + segment.length, 0);
}

function firstSegmentedDab(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
): StudioDynamicBrushDab | undefined {
  for (const segment of segments) {
    if (segment[0]) return segment[0];
  }
  return undefined;
}

function lastSegmentedDab(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
): StudioDynamicBrushDab | undefined {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const last = segments[index]?.at(-1);
    if (last) return last;
  }
  return undefined;
}

function segmentedDabPrefix(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  maximumDabs: number,
): readonly (readonly StudioDynamicBrushDab[])[] {
  const accepted: Array<readonly StudioDynamicBrushDab[]> = [];
  let remaining = Math.max(0, Math.floor(maximumDabs));
  for (const segment of segments) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      accepted.push(segment);
      remaining -= segment.length;
      continue;
    }
    accepted.push(segment.slice(0, remaining));
    remaining = 0;
  }
  return accepted;
}

function segmentedDabVariations(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  transforms: readonly StudioBrushSymmetryTransform[],
): readonly StudioDynamicBrushSegmentedDabVariation[] {
  const variationSegments = transforms.map(
    () => [] as Array<readonly StudioDynamicBrushDab[]>,
  );
  for (const segment of segments) {
    const transformed = studioDynamicBrushDabVariationsFromTransforms(
      segment,
      transforms,
    );
    for (
      let variationIndex = 0;
      variationIndex < transformed.length;
      variationIndex += 1
    ) {
      variationSegments[variationIndex]!.push(transformed[variationIndex]!);
    }
  }
  return variationSegments.map((segmentsForVariation) => ({
    kind: "studio-dynamic-brush-segmented-dab-variation",
    segments: segmentsForVariation,
  }));
}

function styleIdentityMatches(element: DrawEl, style: DetachedDynamicStrokeStyle): boolean {
  const dynamicsMatches = element.brushDynamics === style.sourceDynamics
    || serializeStudioBrushDynamicsSettingsCanonical(element.brushDynamics)
      === style.dynamicsSignature;
  return element.id === style.strokeId
    && element.brush === style.brushId
    && element.brushCatalogId === style.materialIdentity.brushCatalogId
    && element.stroke === style.color
    && Math.max(1, finiteNumber(element.strokeWidth, 1)) === style.width
    && clamp01(finiteNumber(element.opacity, 1)) === style.opacity
    && dynamicsMatches
    && JSON.stringify(detachedSymmetry(element.symmetry)) === style.symmetrySignature
    && element.paintModel === "bounded-flow-v2";
}

/**
 * Exact live support gate. Unsupported/legacy combinations stay on the retained Konva renderer
 * before this module mutates a pixel.
 */
export function studioLiveDynamicBrushOverlaySupportsElement(
  element: DrawEl
): boolean {
  return isStudioBoundedFlowPaintModelCompatible(element)
    && typeof element.brushDynamics === "object"
    && element.brushDynamics !== null
    && typeof element.stroke === "string"
    && element.stroke.length > 0
    && Number.isFinite(element.strokeWidth)
    && element.strokeWidth > 0
    && Number.isFinite(element.opacity ?? 1)
    && (element.opacity ?? 1) > 0
    && resolveStudioDynamicBrushMaterialIdentity(element.brush, element.brushCatalogId) !== null;
}

function styleFromElement(element: DrawEl): DetachedDynamicStrokeStyle | null {
  if (!studioLiveDynamicBrushOverlaySupportsElement(element)) return null;
  // 시작 시점에 아직 점이 없어도(begin 이 첫 point 이전에 오는 경로) 획을 거절하지 않는다.
  // 원점을 (0,0) 으로 고정하면 대칭 변환의 기준이 캔버스 좌상단으로 끌려가므로, 알 수 없을 때는
  // 비워 두고 커버리지 렌더러가 첫 dab 을 원점으로 쓰게 한다. 실제 좌표는 소스가 채워지는 즉시
  // dynamicStyleForSourceOrigin 이 다시 계산한다.
  const firstX = finiteCoordinate(element.points[0]);
  const firstY = finiteCoordinate(element.points[1]);
  const sourceDynamics = element.brushDynamics;
  const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
    element.brush,
    element.brushCatalogId,
  );
  if (!materialIdentity) return null;
  const normalized = normalizeStudioBrushDynamicsSettings(sourceDynamics);
  const width = Math.max(1, finiteNumber(element.strokeWidth, 1));
  const seed = studioBrushDynamicsSeedFromKey(`${element.id}:${normalized.seed}`);
  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...normalized,
    seed,
    width: { ...normalized.width, base: width },
  });
  const symmetry = detachedSymmetry(element.symmetry);
  const symmetrySignature = JSON.stringify(symmetry);
  const transforms = studioBrushSymmetryTransforms(symmetry);
  const strokeOrigins = firstX === null || firstY === null
    ? []
    : transforms.map((transform) => {
        const [x, y] = transformStudioBrushSymmetryPoint(firstX, firstY, transform);
        return Object.freeze({ x, y });
      });
  const paperBrushId = typeof element.brush === "string" && element.brush
    ? element.brush
    : "dry-media";
  const livePaperModel = normalizeStudioPaperSubstrateModel(element.paperModel);
  const livePaperMedium = studioPaperUsesContactTooth(livePaperModel)
    ? resolveStudioPaperBrushMedium(paperBrushId)
    : null;
  const paperResponse = resolveStudioPaperBrushResponse(
    paperBrushId,
    undefined,
    livePaperModel === undefined
      ? undefined
      : { model: livePaperModel, medium: livePaperMedium },
  );
  // model/medium 을 함께 옮겨야 커버리지 렌더러의 contact-tooth-v2 분기가 라이브에서도 켜진다.
  // 빠뜨리면 라이브는 평균 보존 레거시 granulation, 커밋은 tooth 침착으로 그려져 같은 마크가
  // 화면에서 갈라진다(장경로 실측: charcoal--compressed-edge 라이브/커밋 평균 알파 126/92,
  // 문서 고정 tooth 필드의 공간 변조가 무게중심을 7~12px 흔드는 centroid-drift 로 나타남).
  const paper = studioPaperGranulationIsActive(paperResponse)
    ? Object.freeze({
        response: paperResponse,
        surface: resolveStudioDocumentPaperSurface(),
        ...(livePaperModel !== undefined ? { model: livePaperModel } : {}),
        ...(livePaperMedium !== null ? { medium: livePaperMedium } : {}),
      })
    : undefined;
  return {
    strokeId: element.id,
    brushId: element.brush!,
    materialIdentity,
    color: element.stroke,
    width,
    opacity: clamp01(finiteNumber(element.opacity, 1)),
    seed,
    dynamics,
    sourceDynamics,
    dynamicsSignature: serializeStudioBrushDynamicsSettingsCanonical(sourceDynamics),
    symmetry,
    symmetrySignature,
    transforms,
    strokeOrigins,
    ...(paper ? { paper } : {}),
  };
}

function initialStampGrid(style: DetachedDynamicStrokeStyle): StudioDynamicBrushRenderStampGrid {
  const coverageBudget = resolveStudioDynamicBrushCoverageBudgetContract(
    style.materialIdentity,
    style.dynamics,
  );
  if (liveUsesCausalDepositPipeline(style)) {
    // A causal stroke cannot lower its stamp lattice after marks have already been accepted:
    // doing so would require an O(N) clear/replay and would make the live prefix differ from the
    // retained result. Select the lattice from the versioned rule ONCE here — legacy snapshots
    // (no `causalStampGridRule` pin) keep the bounded three-sample lattice, rule-v2 snapshots take
    // a width-adaptive 3/5/7 grid — and reuse the same pinned grid for append, pointer-up and
    // retained replay, preserving material parity inside the live mark budget. The inputs
    // (coverage-contract settings, symmetry count) match the render-budget planner's exactly so
    // exact plans recompute the identical grid.
    return selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(coverageBudget.settings),
      baseWidth: coverageBudget.settings.width.base,
      symmetryCount: style.transforms.length,
      activeTipLayerCount: coverageBudget.settings.tipLayers.filter(
        (layer) => layer.opacity > 0,
      ).length,
    });
  }
  return planStudioDynamicBrushRenderBudget({
    settings: coverageBudget.settings,
    dabCount: 1,
    symmetryCount: style.transforms.length,
    fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
      style.materialIdentity,
      true,
    ),
    materialMarkMultiplier: coverageBudget.materialMarkMultiplier,
    markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
  }).stampGrid;
}

function causalMarkBudget(
  dynamics: NormalizedStudioBrushDynamicsSettings,
): number {
  return studioDynamicBrushDepositPipelineUsesContinuation(
    dynamics.depositPipeline,
  )
    ? STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET
    : STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET;
}

/** Kit-owned web brushes keep the shared kit planner, even when the catalogue snapshot is causal. */
function liveUsesCausalDepositPipeline(
  style: Pick<DetachedDynamicStrokeStyle, "brushId" | "dynamics">,
): boolean {
  return isStudioDynamicBrushCausalDepositPipeline(style.dynamics.depositPipeline)
    && !studioWebDrawingKitOwnsStrokeGeometry(style.brushId);
}

function liveDynamicDevicePixelRatio(surface: StudioLiveInkSurface): number {
  const devicePixelRatio =
    typeof globalThis.devicePixelRatio === "number"
    && Number.isFinite(globalThis.devicePixelRatio)
      ? globalThis.devicePixelRatio
      : 1;
  return resolveStudioLiveSurfaceDevicePixelRatio({
    cssWidth: surface.width,
    cssHeight: surface.height,
    devicePixelRatio,
    // Coverage, Canvas2D presentation and settled surfaces share the transient backing budget.
    maximumBackingPixels: STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS / 3,
  });
}

function nativeStudioDevicePixelRatio(): number {
  const devicePixelRatio =
    typeof globalThis.devicePixelRatio === "number"
    && Number.isFinite(globalThis.devicePixelRatio)
      ? globalThis.devicePixelRatio
      : 1;
  return clamp(devicePixelRatio, 1, 4);
}

export class StudioLiveDynamicBrushOverlayRenderer {
  private activeCanvas: HTMLCanvasElement | null = null;
  private presentationCanvas: HTMLCanvasElement | null = null;
  private settledCanvas: HTMLCanvasElement | null = null;
  private activeContext: CanvasRenderingContext2D | null = null;
  private presentationContext: CanvasRenderingContext2D | null = null;
  private settledContext: CanvasRenderingContext2D | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private surfaceUsable = false;
  private dpr = 1;
  private active: ActiveDynamicStroke | null = null;
  private settled: SettledDynamicStroke[] = [];
  private lastFailureReason: StudioLiveDynamicBrushFailureReason | null = null;
  private pendingFirstDab: StudioDynamicBrushDab | null = null;
  private pendingFirstDabRaf = 0;
  private pendingBeginElement: DrawEl | null = null;
  private pendingBeginRaf = 0;
  /**
   * Whole-stroke union of every per-frame active paint rect (physical pixels, same rect authority
   * as {@link presentActiveRect}). The active surface is transparent outside this union, so the
   * settle flatten crops its drawImage to it with byte-identical retained output. Reset whenever
   * the active surface is cleared.
   */
  private settleFlattenUnionRect: PresentationPixelRect | null = null;
  /**
   * 시작 접촉 자리표시 원({@link paintImmediateContact})의 프레젠테이션 픽셀 rect.
   *
   * 자리표시 원은 브러시 계획과 무관한 단색 원이라, 실제 계획 마크가 그 원을 완전히 덮지
   * 않는 레인(테이퍼 시작·치즐 엣지·그리드 스냅)에서는 획 내내 시작점에 라이브 전용 잉크로
   * 남는다(장경로 실측: live-only-start-circle 79px / 1307px, centroid drift 7~11px). 첫
   * 실제 프레젠테이션에서 이 rect 를 더티 영역에 합집합해 누적 캔버스 내용으로 재구성하면
   * 탭 즉시 피드백 계약은 그대로 두고 자리표시 원만 계획된 잉크로 교체된다.
   */
  private contactPlaceholderRect: PresentationPixelRect | null = null;

  attach(canvases: StudioLiveDynamicBrushOverlayCanvases | null): void {
    this.activeCanvas = canvases?.activeCanvas ?? null;
    this.presentationCanvas = canvases?.presentationCanvas ?? null;
    this.settledCanvas = canvases?.settledCanvas ?? null;
    this.activeContext = this.activeCanvas
      ? acquireStudioLowLatencyCanvas2dContext(this.activeCanvas)
      : null;
    this.presentationContext = this.presentationCanvas
      ? acquireStudioLowLatencyCanvas2dContext(this.presentationCanvas)
      : null;
    this.settledContext = this.settledCanvas
      ? acquireStudioLowLatencyCanvas2dContext(this.settledCanvas)
      : null;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
    this.parkCoverageBackingStoreIfIdle();
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    const previous = this.surface;
    this.surface = surface;
    const changed =
      !previous || !surface
      || previous.left !== surface.left
      || previous.top !== surface.top
      || previous.width !== surface.width
      || previous.height !== surface.height
      || previous.documentScale !== surface.documentScale
      || previous.documentWidth !== surface.documentWidth
      || previous.flipX !== surface.flipX;
    if (!changed) return;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
    this.parkCoverageBackingStoreIfIdle();
  }

  get isActive(): boolean {
    return this.active !== null || this.pendingBeginElement !== null;
  }

  get hasPendingBegin(): boolean {
    return this.pendingBeginElement !== null;
  }

  get hasSettledStrokes(): boolean {
    return this.settled.length > 0;
  }

  get settledStrokeCount(): number {
    return this.settled.length;
  }

  get lastOperationFailureReason(): StudioLiveDynamicBrushFailureReason | null {
    return this.lastFailureReason;
  }

  get backingPixelCount(): number {
    return (this.activeCanvas?.width ?? 0) * (this.activeCanvas?.height ?? 0)
      + (this.presentationCanvas?.width ?? 0) * (this.presentationCanvas?.height ?? 0)
      + (this.settledCanvas?.width ?? 0) * (this.settledCanvas?.height ?? 0);
  }

  begin(element: DrawEl): StudioLiveDynamicBrushBeginResult {
    if (!studioLiveDynamicBrushOverlaySupportsElement(element)) {
      return dynamicBrushOperationFailure("unsupported-style");
    }
    this.restoreCoverageBackingStore();
    if (!this.surfaceReady()) {
      this.parkCoverageBackingStoreIfIdle();
      return dynamicBrushOperationFailure(
        this.surfaceUsable ? "surface-unavailable" : "surface-budget",
      );
    }
    this.paintContactFromElement(element);
    if (this.canDeferFirstDabRaster()) {
      this.pendingBeginElement = element;
      if (this.pendingBeginRaf) cancelAnimationFrame(this.pendingBeginRaf);
      this.pendingBeginRaf = requestAnimationFrame(() => {
        this.pendingBeginRaf = 0;
        const pending = this.pendingBeginElement;
        this.pendingBeginElement = null;
        if (pending) {
          const result = this.finishBegin(pending);
          if (result.status !== "started") {
            this.lastFailureReason = result.reason;
            this.parkCoverageBackingStoreIfIdle();
          }
        }
      });
      return { status: "started", dabCount: 0, markCount: 0 };
    }
    const result = this.finishBegin(element);
    if (result.status !== "started") this.parkCoverageBackingStoreIfIdle();
    return result;
  }

  private finishBegin(element: DrawEl): StudioLiveDynamicBrushBeginResult {
    const style = styleFromElement(element);
    if (!style) return dynamicBrushOperationFailure("unsupported-style");
    if (!this.surfaceReady()) {
      return dynamicBrushOperationFailure(
        this.surfaceUsable ? "surface-unavailable" : "surface-budget",
      );
    }

    if (this.active) {
      this.resetActiveState();
      this.replay();
    }
    const first = sourceSampleAt(element, 0, style.dynamics.fallbackPressure);
    if (!first) return dynamicBrushOperationFailure("invalid-sample");
    this.paintImmediateContact(style, first);

    const source: DynamicStrokeSource = {
      points: [],
      pressures: [],
      tangentialPressures: [],
      speeds: [],
      tiltXs: [],
      tiltYs: [],
      twists: [],
    };
    appendSourceSample(source, first);
    const deferFirstRaster = this.canDeferFirstDabRaster();
    const causalBegin = deferFirstRaster || !liveUsesCausalDepositPipeline(style)
      ? null
      : studioDynamicBrushDepositPipelineUsesContinuation(
          style.dynamics.depositPipeline,
        )
        ? beginStudioCausalDynamicBrushDepositV3(first, style.dynamics)
        : beginStudioCausalDynamicBrushDepositV2(
            first,
            style.dynamics,
            STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
          );
    if (causalBegin && !causalBegin.ok) {
      return dynamicBrushOperationFailure(
        causalBegin.reason === "dab-budget" ? "dab-budget" : "material-plan",
      );
    }
    const active: ActiveDynamicStroke = {
      style,
      source,
      ...(causalBegin?.ok ? { causalState: causalBegin.state } : {}),
      consumedSourcePoints: 1,
      previousSample: first,
      totalDistance: 0,
      distanceSinceLastDab: 0,
      nextDabIndex: 1,
      lastSpacing: causalBegin?.ok
        ? causalBegin.state.lastSpacing
        : Math.max(0.25, style.width * 0.35),
      markCount: 0,
      r8AlphaMapBytes: 0,
      acceptedCausalDabCount: 0,
      plannedCausalDabCount: causalBegin?.ok ? 1 : 0,
      stampGrid: initialStampGrid(style),
      transitionedFromTap: false,
    };
    this.active = active;
    let initialMarkCount = 0;
    if (causalBegin?.ok) {
      if (this.canDeferFirstDabRaster()) {
        this.pendingFirstDab = causalBegin.dab;
        this.pendingFirstDabRaf = requestAnimationFrame(() => {
          this.pendingFirstDabRaf = 0;
          this.flushPendingFirstDab();
        });
      } else {
        const rendered = this.appendDabs(active, [causalBegin.dab]);
        if (rendered.status === "unavailable" || rendered.status === "rejected") return rendered;
        initialMarkCount = rendered.appendedMarks;
      }
    }
    this.lastFailureReason = null;
    return {
      status: "started",
      dabCount: 1,
      markCount: initialMarkCount,
    };
  }

  /**
   * Consumes only source indices at or after `consumedSourcePoints`. Already accepted prefix slots
   * are never read or planned again on pointermove.
   */
  appendFrom(element: DrawEl): StudioLiveDynamicBrushAppendResult {
    if (this.lastFailureReason) {
      return dynamicBrushOperationFailure(this.lastFailureReason);
    }
    if (!this.active && this.pendingBeginElement) {
      const pending = this.pendingBeginElement;
      this.pendingBeginElement = null;
      if (this.pendingBeginRaf) {
        cancelAnimationFrame(this.pendingBeginRaf);
        this.pendingBeginRaf = 0;
      }
      const started = this.finishBegin(pending);
      if (started.status !== "started") {
        this.lastFailureReason = started.reason;
        this.parkCoverageBackingStoreIfIdle();
        return started;
      }
    }
    const active = this.active;
    if (!active) {
      this.parkCoverageBackingStoreIfIdle();
      return dynamicBrushOperationFailure("surface-unavailable");
    }
    if (!styleIdentityMatches(element, active.style)) {
      return this.failActive("stroke-identity");
    }
    this.flushPendingFirstDab();
    if (!active.causalState && liveUsesCausalDepositPipeline(active.style)) {
      const started = studioDynamicBrushDepositPipelineUsesContinuation(
        active.style.dynamics.depositPipeline,
      )
        ? beginStudioCausalDynamicBrushDepositV3(
            active.previousSample,
            active.style.dynamics,
          )
        : beginStudioCausalDynamicBrushDepositV2(
            active.previousSample,
            active.style.dynamics,
            STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
          );
      if (!started.ok) {
        return this.failActive(
          started.reason === "dab-budget" ? "dab-budget" : "material-plan",
        );
      }
      active.causalState = started.state;
      active.lastSpacing = started.state.lastSpacing;
      active.plannedCausalDabCount = 1;
      this.appendDabs(active, [started.dab]);
    }
    const total = Math.floor(element.points.length / 2);
    if (total < active.consumedSourcePoints) return this.failActive("source-prefix");
    if (total === active.consumedSourcePoints) {
      return {
        status: "noop",
        consumedSourcePoints: total,
        appendedDabs: 0,
        appendedMarks: 0,
      };
    }
    const previousIndex = active.consumedSourcePoints - 1;
    if (
      finiteCoordinate(element.points[previousIndex * 2]) !== active.previousSample.x
      || finiteCoordinate(element.points[previousIndex * 2 + 1]) !== active.previousSample.y
    ) {
      return this.failActive("source-prefix");
    }
    if (active.causalState) {
      return this.appendCausalFrom(element, active, total);
    }
    return this.appendCanonicalFrom(element, active, total);
  }

  /**
   * Live marks already on the active surface are the accepted prefix. Seal that surface
   * directly whenever the release sample matches the live source: re-planning and repainting
   * thousands of identical marks on pointer-up only adds a long task and a visible compositor
   * handoff. Same-length post-correction still rebuilds below.
   */
  end(element: DrawEl): StudioLiveDynamicBrushEndResult {
    const sealDebugMarkCount = this.active?.markCount ?? -1;
    const appended = this.appendFrom(element);
    // 브라우저 감사 진단: 실패 프레임에서 "오버레이가 몇 개의 마크를 칠했다고 믿는지"가
    // 앱 내 계획/예산 문제와 렌더러 드로잉 드롭아웃을 가른다. 성공/실패 공통으로 남긴다.
    // 무거운 캔버스 검열(census)은 감사 하니스가 플래그를 켠 세션에서만 수행한다 — 제품
    // 경로에서는 스트로크마다 getImageData를 읽는 비용을 절대 지불하지 않는다.
    const sealDiagnosticsEnabled = (globalThis as {
      __studioDynamicSealDebugEnabled?: boolean;
    }).__studioDynamicSealDebugEnabled === true;
    const sealDebugCensus = (
      canvas: HTMLCanvasElement | null,
      context: CanvasRenderingContext2D | null,
    ): number => {
      if (!canvas || !context || canvas.width === 0 || canvas.height === 0) {
        return -1;
      }
      try {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let index = 3; index < data.length; index += 16) {
          if ((data[index] ?? 0) > 16) ink += 1;
        }
        return ink;
      } catch {
        return -1;
      }
    };
    const recordSealDebug = (status: string): void => {
      (globalThis as {
        __studioDynamicSealDebug?: {
          status: string;
          markCountBefore: number;
          markCountAfter: number;
          at: number;
        };
      }).__studioDynamicSealDebug = {
        status,
        markCountBefore: sealDebugMarkCount,
        markCountAfter: this.active?.markCount ?? -1,
        at: performance.now(),
        ...(sealDiagnosticsEnabled
          ? {
              union: this.settleFlattenUnionRect,
              surface: this.surface
                ? {
                    left: this.surface.left,
                    top: this.surface.top,
                    width: this.surface.width,
                    height: this.surface.height,
                    documentScale: this.surface.documentScale,
                  }
                : null,
              dpr: this.dpr,
              // 렌더러가 들고 있는 캔버스가 아직 DOM에 붙어 있는가 — seal 시점 내부 잉크와
              // DOM 검열 0 의 모순(실측)을 가르는 단 하나의 판별값.
              activeConnected: this.activeCanvas?.isConnected ?? null,
              presentationConnected: this.presentationCanvas?.isConnected ?? null,
              settledConnected: this.settledCanvas?.isConnected ?? null,
              activeInk: sealDebugCensus(this.activeCanvas, this.activeContext),
              presentationInk: sealDebugCensus(
                this.presentationCanvas,
                this.presentationContext,
              ),
              settledInk: sealDebugCensus(this.settledCanvas, this.settledContext),
            }
          : {}),
      };
    };
    if (appended.status === "unavailable" || appended.status === "rejected") {
      recordSealDebug(`append-${appended.status}:${appended.reason}`);
      return appended;
    }
    const active = this.active;
    if (!active) return dynamicBrushOperationFailure("surface-unavailable");
    if (!this.surfaceReady()) {
      return this.failActive(
        this.surfaceUsable ? "surface-unavailable" : "surface-budget",
      );
    }
    const sourceMatches = dynamicSourceMatchesElement(
      active.source,
      element,
      active.style.dynamics.fallbackPressure,
    );
    if (sourceMatches && (active.causalState || active.markCount > 0)) {
      recordSealDebug("seal-direct");
      if (!this.flattenActiveToSettled(active.style.opacity)) {
        return this.failActive("surface-render");
      }
      // 진단 모드에서만 유의미한 두 번째 기록: settled 검열이 flatten 결과를 반영한다.
      recordSealDebug("seal-direct:flattened");
      this.settled.push({
        style: active.style,
        source: detachedSource(active.source),
      });
      const result = {
        status: "settled" as const,
        dabCount: active.causalState
          ? active.acceptedCausalDabCount
          : active.nextDabIndex,
        markCount: active.markCount,
        ...(active.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
          : {}),
      };
      this.resetActiveState();
      this.clearActiveRect();
      this.parkCoverageBackingStoreIfIdle();
      return result;
    }

    // Same-length post-correction can replace points or sensor channels without appendFrom seeing
    // a longer suffix. Rebuild that uncommon release input instead of sealing a stale live prefix.
    const exactSource = sourceMatches
      ? active.source
      : dynamicSourceFromElement(element, active.style.dynamics.fallbackPressure);
    if (!exactSource) return this.failActive("invalid-sample");
    const exactStyle = sourceMatches
      ? active.style
      : dynamicStyleForSourceOrigin(active.style, exactSource);
    if (!exactStyle) return this.failActive("invalid-sample");
    const exact = this.exactPlan(exactStyle, exactSource);
    if (!exact) return this.failActive("material-plan");
    this.clearActiveRect();
    active.markCount = 0;
    active.stampGrid = exact.stampGrid;
    if (!this.drawMarksToActive(exact.marks)) return this.failActive("surface-render");
    active.markCount = exact.marks.length;
    recordSealDebug("seal-exact-rebuild");
    active.r8AlphaMapBytes = exact.r8AlphaMapBytes;
    if (!this.flattenActiveToSettled(active.style.opacity)) {
      return this.failActive("surface-render");
    }
    recordSealDebug("seal-exact-rebuild:flattened");
    this.settled.push({
      style: exactStyle,
      source: detachedSource(exactSource),
    });
    const result = {
      status: "settled" as const,
      dabCount: exact.dabCount,
      markCount: exact.marks.length,
      ...(exact.acceptedPrefixReceipt
        ? { acceptedPrefixReceipt: exact.acceptedPrefixReceipt }
        : {}),
    };
    this.resetActiveState();
    this.clearActiveRect();
    this.parkCoverageBackingStoreIfIdle();
    return result;
  }

  releaseSettledPrefix(count: number): number {
    const requested = count === Number.POSITIVE_INFINITY
      ? this.settled.length
      : Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 0;
    const released = Math.min(requested, this.settled.length);
    if (released === 0) return 0;
    this.settled = this.settled.slice(released);
    this.recordReleaseDebug("release-prefix", { released, remaining: this.settled.length });
    this.replay();
    this.parkCoverageBackingStoreIfIdle();
    return released;
  }

  /**
   * 브라우저 감사 진단 브레드크럼: settled 표면을 비운 마지막 주체를 전역에 남긴다. 실패
   * 프레임에서 "커밋 영수증 릴리스가 이른 것"과 "replay 실패의 조용한 전량 클리어"를 가른다.
   */
  private recordReleaseDebug(
    reason: string,
    detail?: Record<string, unknown>,
  ): void {
    (globalThis as {
      __studioDynamicReleaseDebug?: Record<string, unknown>;
    }).__studioDynamicReleaseDebug = {
      reason,
      ...(detail ?? {}),
      settledCount: this.settled.length,
      at: performance.now(),
    };
  }

  clearSettled(): number {
    return this.releaseSettledPrefix(this.settled.length);
  }

  resetActive(): boolean {
    const hadOperation = this.active !== null
      || this.pendingBeginElement !== null
      || this.lastFailureReason !== null;
    if (!hadOperation) return false;
    this.resetActiveState();
    this.lastFailureReason = null;
    this.clearActiveRect();
    this.parkCoverageBackingStoreIfIdle();
    return true;
  }

  clear(): void {
    this.resetActiveState();
    this.lastFailureReason = null;
    this.settled = [];
    this.clearActiveRect();
    this.clearSettledRect();
    this.parkCoverageBackingStoreIfIdle();
  }

  private appendDabs(
    active: ActiveDynamicStroke,
    dabs: readonly StudioDynamicBrushDab[],
  ): StudioLiveDynamicBrushAppendResult {
    if (dabs.length === 0) {
      return {
        status: "noop",
        consumedSourcePoints: active.consumedSourcePoints,
        appendedDabs: 0,
        appendedMarks: 0,
      };
    }
    const markBudget = liveUsesCausalDepositPipeline(active.style)
      ? causalMarkBudget(active.style.dynamics)
      : STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET;
    const causal = liveUsesCausalDepositPipeline(active.style);
    const coverageBudget = causal
      ? resolveStudioDynamicBrushCoverageBudgetContract(
          active.style.materialIdentity,
          active.style.dynamics,
        )
      : null;
    const causalBudget = causal
      ? planStudioDynamicBrushRenderBudget({
          settings: coverageBudget!.settings,
          dabCount: active.plannedCausalDabCount,
          symmetryCount: active.style.transforms.length,
          fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
            active.style.materialIdentity,
            active.plannedCausalDabCount > 0,
          ),
          materialMarkMultiplier: coverageBudget!.materialMarkMultiplier,
          markBudget,
        })
      : null;
    if (causalBudget?.acceptedPrefixReceipt) {
      active.acceptedPrefixReceipt = causalBudget.acceptedPrefixReceipt;
    }
    // Consume causal slots from the global conservative receipt, not from actual visible mark
    // count. Zero-alpha/zero-flow dabs still own an immutable prefix slot; otherwise later visible
    // dabs could appear live and disappear when pointer-up replay applies the global dab ceiling.
    const acceptedDabLimit = causalBudget
      ? Math.max(
          0,
          causalBudget.maxDabsPerVariation - active.acceptedCausalDabCount,
        )
      : dabs.length;
    const acceptedDabPrefix = acceptedDabLimit < dabs.length
      ? dabs.slice(0, acceptedDabLimit)
      : dabs;
    if (acceptedDabPrefix.length === 0) {
      return {
        status: "noop",
        consumedSourcePoints: active.consumedSourcePoints,
        appendedDabs: 0,
        appendedMarks: 0,
        ...(active.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
          : {}),
      };
    }
    const dryMediaIncrementalUnion = causal
      && active.style.dynamics.grain.source === undefined
      && studioDryMediaUnionRibbonCarrierOwnsMaterial(
        active.style.materialIdentity,
        active.style.dynamics,
      );
    const dryMediaPredecessor = dryMediaIncrementalUnion
      && active.dryMediaUnionAccumulator
      ? active.lastAcceptedCausalDab
      : undefined;
    if (
      dryMediaIncrementalUnion
      && ((active.dryMediaUnionAccumulator === undefined)
        !== (active.lastAcceptedCausalDab === undefined))
    ) {
      return this.failActive("material-plan");
    }
    const remainingMarks = dryMediaIncrementalUnion
      ? markBudget + (
          dryMediaPredecessor
            ? studioDryMediaDynamicBridgeMarkMultiplier(
                active.style.materialIdentity,
              ) * active.style.transforms.length
            : 0
        )
      : markBudget - active.markCount;
    if (remainingMarks <= 0) {
      if (!causal) return this.failActive("mark-budget");
      return {
        status: "noop",
        consumedSourcePoints: active.consumedSourcePoints,
        appendedDabs: 0,
        appendedMarks: 0,
        ...(active.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
          : {}),
      };
    }
    const planningDabPrefix = dryMediaPredecessor
      ? [dryMediaPredecessor, ...acceptedDabPrefix]
      : acceptedDabPrefix;
    const variations = studioDynamicBrushDabVariationsFromTransforms(
      planningDabPrefix,
      active.style.transforms,
    );
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: variations,
      strokeOrigins: active.style.strokeOrigins,
      dynamics: active.style.dynamics,
      materialIdentity: active.style.materialIdentity,
      ...(active.style.paper ? { paper: active.style.paper } : {}),
      dynamicSeed: active.style.seed,
      stroke: active.style.color,
      stampGrid: active.stampGrid,
      markBudget: remainingMarks,
      ...(dryMediaPredecessor
        ? { dryMediaUnionLeadingSourceDabsToSkip: 1 }
        : {}),
      r8AlphaMapByteBudget: Math.max(
        0,
        STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET
          - active.r8AlphaMapBytes,
      ),
    });
    if (!plan.ok) {
      return this.failActive(
        plan.reason === "mark-budget" ? "mark-budget" : "material-plan",
      );
    }
    if (dryMediaIncrementalUnion) {
      const planAcceptedDabs = plan.acceptedPrefixReceipt
        ? plan.acceptedPrefixReceipt.acceptedDabsPerVariation
        : planningDabPrefix.length;
      // Charge multi-lane expansion at admission time and degrade gracefully. A partial accepted
      // prefix is still a valid long stroke — hard-failing mid-contact turned competitive
      // frame-budget workloads into freezes and all-or-nothing mark-budget collapse.
      const admittedPlanningDabs = Math.min(
        planAcceptedDabs,
        planningDabPrefix.length,
      );
      if (admittedPlanningDabs <= 0) {
        return {
          status: "noop",
          consumedSourcePoints: active.consumedSourcePoints,
          appendedDabs: 0,
          appendedMarks: 0,
          ...(active.acceptedPrefixReceipt
            ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
            : {}),
        };
      }
      const admittedSuffixDabs = dryMediaPredecessor
        ? Math.max(0, admittedPlanningDabs - 1)
        : admittedPlanningDabs;
      if (admittedSuffixDabs <= 0 && dryMediaPredecessor) {
        return {
          status: "noop",
          consumedSourcePoints: active.consumedSourcePoints,
          appendedDabs: 0,
          appendedMarks: 0,
          ...(active.acceptedPrefixReceipt
            ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
            : {}),
        };
      }
      let cumulativeUnionCommandCount: number;
      if (dryMediaPredecessor) {
        if (
          !active.dryMediaUnionAccumulator
          || !appendDryMediaUnionAccumulator(
            active.dryMediaUnionAccumulator,
            plan.marks,
          )
        ) {
          return this.failActive("material-plan");
        }
        // O(1) append: paint and present only the planned suffix fills. The cumulative union is
        // never re-materialized here; seal/replay bookkeeping only needs the entry count.
        if (!this.drawMarksToActive(plan.marks, active.style.opacity, plan.marks)) {
          return this.failActive("surface-render");
        }
        cumulativeUnionCommandCount = active.dryMediaUnionAccumulator.entries.length;
      } else {
        const accumulator = createDryMediaUnionAccumulator(plan.marks);
        if (!accumulator) return this.failActive("material-plan");
        active.dryMediaUnionAccumulator = accumulator;
        const cumulativeMarks = snapshotDryMediaUnionAccumulator(accumulator);
        this.clearActiveRect();
        if (!this.drawMarksToActive(cumulativeMarks, active.style.opacity)) {
          return this.failActive("surface-render");
        }
        cumulativeUnionCommandCount = cumulativeMarks.length;
      }
      active.acceptedCausalDabCount += admittedSuffixDabs;
      active.lastAcceptedCausalDab = acceptedDabPrefix[admittedSuffixDabs - 1]
        ?? acceptedDabPrefix.at(-1);
      // One stroke-local union mark was painted; seal/replay markCount must match that authority.
      active.markCount = cumulativeUnionCommandCount;
      active.r8AlphaMapBytes = 0;
      return {
        status: "appended",
        consumedSourcePoints: active.consumedSourcePoints,
        appendedDabs: admittedSuffixDabs,
        appendedMarks: plan.marks.length,
        ...(active.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
          : {}),
      };
    }
    if (active.markCount + plan.marks.length > markBudget) {
      return this.failActive("mark-budget");
    }
    if (!this.drawMarksToActive(plan.marks, active.style.opacity)) {
      return this.failActive("surface-render");
    }
    const acceptedDabs = plan.acceptedPrefixReceipt
      ? plan.acceptedPrefixReceipt.acceptedDabsPerVariation
      : acceptedDabPrefix.length;
    if (causal) {
      active.acceptedCausalDabCount += acceptedDabs;
    }
    active.markCount += plan.marks.length;
    active.r8AlphaMapBytes +=
      plan.r8TextureAlphaMapReceipt?.alphaMapBytes ?? 0;
    return {
      status: acceptedDabs > 0 ? "appended" : "noop",
      consumedSourcePoints: active.consumedSourcePoints,
      appendedDabs: acceptedDabs,
      appendedMarks: plan.marks.length,
      ...(active.acceptedPrefixReceipt
        ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
        : {}),
    };
  }

  private appendCausalFrom(
    element: DrawEl,
    active: ActiveDynamicStroke,
    total: number,
  ): StudioLiveDynamicBrushAppendResult {
    const causalState = active.causalState;
    if (!causalState) return this.failActive("material-plan");
    const samples: DynamicSourceSample[] = [];
    for (
      let sourceIndex = active.consumedSourcePoints;
      sourceIndex < total;
      sourceIndex += 1
    ) {
      const next = sourceSampleAt(
        element,
        sourceIndex,
        active.style.dynamics.fallbackPressure,
      );
      if (!next) return this.failActive("invalid-sample");
      samples.push(next);
      appendSourceSample(active.source, next);
      active.consumedSourcePoints = sourceIndex + 1;
    }
    const usesContinuation = studioDynamicBrushDepositPipelineUsesContinuation(
      active.style.dynamics.depositPipeline,
    );
    if (
      usesContinuation !== (
        causalState.version === 3
      )
    ) return this.failActive("material-plan");
    const planned = causalState.version === 3
      ? appendStudioCausalDynamicBrushDepositsV3(
          causalState,
          samples,
          active.style.dynamics,
        )
      : appendStudioCausalDynamicBrushDepositsV2(
          causalState,
          samples,
          active.style.dynamics,
        );
    if (!planned.ok) {
      return this.failActive(
        planned.reason === "dab-budget"
          ? "dab-budget"
          : planned.reason === "invalid-input"
            ? "invalid-sample"
            : "material-plan",
      );
    }
    active.causalState = planned.state;
    active.previousSample = planned.state.previousSample;
    active.totalDistance = planned.state.totalDistance;
    active.distanceSinceLastDab = planned.state.distanceSinceLastDab;
    active.nextDabIndex = planned.state.nextDabIndex;
    active.plannedCausalDabCount = planned.state.nextDabIndex;
    active.lastSpacing = planned.state.lastSpacing;
    active.transitionedFromTap = planned.state.transitionedFromTap;

    const requiresWholePrefixRibbonReplay =
      studioProfessionalShelfRibbonCarrierOwnsMaterial(
        active.style.materialIdentity,
        active.style.dynamics,
      )
      || studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
        active.style.materialIdentity,
        active.style.dynamics,
      );
    if (requiresWholePrefixRibbonReplay) {
      // Slow sub-spacing movement consumes samples without emitting dabs. The whole-prefix replay
      // would replan the ENTIRE stroke from scratch and repaint identical pixels for that frame;
      // the causal append above already proved no geometry changed, so skip the replan entirely.
      // (Slow detailed knife/bristle work is exactly the many-moves-few-dabs regime.)
      if (planned.dabs.length === 0 && !planned.replaceInitialTap) {
        return {
          status: "noop",
          consumedSourcePoints: active.consumedSourcePoints,
          appendedDabs: 0,
          appendedMarks: 0,
          ...(active.acceptedPrefixReceipt
            ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
            : {}),
        };
      }
      const previousAcceptedDabCount = active.acceptedCausalDabCount;
      const exact = this.exactPlan(active.style, active.source);
      if (!exact || !exactPlanUsesWholePrefixRibbonUnion(exact)) {
        return this.failActive("material-plan");
      }
      const acceptedDabs = planned.replaceInitialTap
        ? exact.dabCount
        : Math.max(0, exact.dabCount - previousAcceptedDabCount);
      if (acceptedDabs === 0) {
        active.acceptedPrefixReceipt = exact.acceptedPrefixReceipt;
        return {
          status: "noop",
          consumedSourcePoints: active.consumedSourcePoints,
          appendedDabs: 0,
          appendedMarks: 0,
          ...(active.acceptedPrefixReceipt
            ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
            : {}),
        };
      }
      // Whole-stroke ribbon unions are not appendable dab batches. Appending a suffix union would
      // overlap the already-present prefix and make crossings darker live than after pointer-up.
      // Replace both transient surfaces from the canonical accepted prefix so every pointer frame,
      // retained replay and final commit consume identical same-winding geometry.
      this.clearActiveRect();
      active.markCount = 0;
      active.r8AlphaMapBytes = 0;
      active.acceptedCausalDabCount = 0;
      active.acceptedPrefixReceipt = undefined;
      active.stampGrid = exact.stampGrid;
      if (!this.drawMarksToActive(exact.marks, active.style.opacity)) {
        return this.failActive("surface-render");
      }
      active.markCount = exact.marks.length;
      active.r8AlphaMapBytes = exact.r8AlphaMapBytes;
      active.acceptedCausalDabCount = exact.dabCount;
      active.acceptedPrefixReceipt = exact.acceptedPrefixReceipt;
      return {
        status: "appended",
        consumedSourcePoints: active.consumedSourcePoints,
        appendedDabs: acceptedDabs,
        appendedMarks: exact.marks.length,
        ...(active.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
          : {}),
      };
    }

    if (
      planned.replaceInitialTap
      // This branch relies on appendDabs' incremental-union rebuild to clear the replaced tap.
      // A grain-source stroke never enters that rebuild, so it must keep the explicit
      // clear-then-replay replacement path below instead of double-painting the tap.
      && active.style.dynamics.grain.source === undefined
      && studioDryMediaUnionRibbonCarrierOwnsMaterial(
        active.style.materialIdentity,
        active.style.dynamics,
      )
    ) {
      active.markCount = 0;
      active.r8AlphaMapBytes = 0;
      active.acceptedCausalDabCount = 0;
      active.acceptedPrefixReceipt = undefined;
      active.lastAcceptedCausalDab = undefined;
      active.dryMediaUnionAccumulator = undefined;
      return this.appendDabs(active, planned.dabs);
    }

    let appendedDabs = planned.dabs;
    let replacementDabs = 0;
    let replacementMarks = 0;
    if (planned.replaceInitialTap) {
      this.clearActiveRect();
      active.markCount = 0;
      active.r8AlphaMapBytes = 0;
      active.acceptedCausalDabCount = 0;
      active.acceptedPrefixReceipt = undefined;
      active.lastAcceptedCausalDab = undefined;
      active.dryMediaUnionAccumulator = undefined;
      const [replacement, ...suffix] = planned.dabs;
      if (!replacement) return this.failActive("material-plan");
      const replacementResult = this.appendDabs(active, [replacement]);
      if (
        replacementResult.status === "unavailable"
        || replacementResult.status === "rejected"
      ) return replacementResult;
      replacementDabs = replacementResult.appendedDabs;
      replacementMarks = replacementResult.appendedMarks;
      appendedDabs = suffix;
    }
    const rendered = this.appendDabs(active, appendedDabs);
    if (rendered.status === "unavailable" || rendered.status === "rejected") return rendered;
    const totalAcceptedDabs = replacementDabs + rendered.appendedDabs;
    return {
      status: totalAcceptedDabs > 0 || replacementMarks > 0
        ? "appended"
        : "noop",
      consumedSourcePoints: active.consumedSourcePoints,
      appendedDabs: totalAcceptedDabs,
      appendedMarks: replacementMarks + rendered.appendedMarks,
      ...(active.acceptedPrefixReceipt
        ? { acceptedPrefixReceipt: active.acceptedPrefixReceipt }
        : {}),
    };
  }

  /**
   * Legacy dynamic snapshots derive taper, station redistribution and stamp-grid density from the
   * current whole path. An incremental replica used a one-dab grid forever, exposing circular
   * alpha-map samples that disappeared when pointer-up rebuilt the canonical plan. Consume only
   * the unseen source suffix, then redraw the accepted prefix through the exact same planner used
   * by pointer-up and retained replay.
   */
  private appendCanonicalFrom(
    element: DrawEl,
    active: ActiveDynamicStroke,
    total: number,
  ): StudioLiveDynamicBrushAppendResult {
    const previousDabCount = active.nextDabIndex;
    for (
      let sourceIndex = active.consumedSourcePoints;
      sourceIndex < total;
      sourceIndex += 1
    ) {
      const next = sourceSampleAt(
        element,
        sourceIndex,
        active.style.dynamics.fallbackPressure,
      );
      if (!next) return this.failActive("invalid-sample");
      const segmentLength = Math.hypot(
        next.x - active.previousSample.x,
        next.y - active.previousSample.y,
      );
      if (!Number.isFinite(segmentLength)) return this.failActive("invalid-sample");
      appendSourceSample(active.source, next);
      active.consumedSourcePoints = sourceIndex + 1;
      active.totalDistance += segmentLength;
      active.previousSample = next;
    }

    const exact = this.exactPlan(active.style, active.source);
    if (!exact) return this.failActive("material-plan");
    const suffixMarks = exact.marks.slice(active.markCount);
    active.stampGrid = exact.stampGrid;
    if (suffixMarks.length > 0) {
      if (!this.drawMarksToActive(suffixMarks, active.style.opacity)) {
        return this.failActive("surface-render");
      }
    }
    active.markCount = Math.max(active.markCount, exact.marks.length);
    active.r8AlphaMapBytes = exact.r8AlphaMapBytes;
    active.nextDabIndex = exact.dabCount;
    active.lastSpacing = Math.max(0.25, exact.lastSpacing);
    active.distanceSinceLastDab = 0;
    active.transitionedFromTap = active.totalDistance > POINT_EPSILON;
    return {
      status: "appended",
      consumedSourcePoints: active.consumedSourcePoints,
      appendedDabs: Math.max(0, exact.dabCount - previousDabCount),
      appendedMarks: exact.marks.length,
    };
  }

  private exactPlan(
    style: DetachedDynamicStrokeStyle,
    source: DynamicStrokeSource,
  ): ExactDynamicPlan | null {
    if (liveUsesCausalDepositPipeline(style)) {
      const causalInput = {
        points: source.points,
        pressures: source.pressures,
        tangentialPressures: source.tangentialPressures,
        speeds: source.speeds,
        tiltXs: source.tiltXs,
        tiltYs: source.tiltYs,
        twists: source.twists,
        settings: style.dynamics,
      };
      const causal = studioDynamicBrushDepositPipelineUsesContinuation(
        style.dynamics.depositPipeline,
      )
        ? planStudioCausalDynamicBrushDepositSegmentsV3(causalInput)
        : planStudioCausalDynamicBrushDepositsV2({
            ...causalInput,
            maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
          });
      if (!causal.ok) return null;
      const causalSegments = "segments" in causal
        ? causal.segments.map((segment) => segment.dabs)
        : null;
      const causalDabs = "dabs" in causal ? causal.dabs : null;
      const causalDabCount = causalSegments
        ? segmentedDabCount(causalSegments)
        : causalDabs!.length;
      const stampGrid = initialStampGrid(style);
      const coverageBudget = resolveStudioDynamicBrushCoverageBudgetContract(
        style.materialIdentity,
        style.dynamics,
      );
      const renderBudget = planStudioDynamicBrushRenderBudget({
        settings: coverageBudget.settings,
        dabCount: causalDabCount,
        symmetryCount: style.transforms.length,
        fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
          style.materialIdentity,
          causalDabCount > 0,
        ),
        materialMarkMultiplier: coverageBudget.materialMarkMultiplier,
        markBudget: causalMarkBudget(style.dynamics),
      });
      const acceptedDabCount = renderBudget.acceptedPrefixReceipt
        ? renderBudget.acceptedPrefixReceipt.acceptedDabsPerVariation
        : causalDabCount;
      const acceptedSegments = causalSegments
        ? segmentedDabPrefix(causalSegments, acceptedDabCount)
        : null;
      const acceptedDabs = acceptedSegments
        ? null
        : causalDabs!.slice(0, acceptedDabCount);
      const dabVariations = acceptedSegments
        ? segmentedDabVariations(acceptedSegments, style.transforms)
        : studioDynamicBrushDabVariationsFromTransforms(
            acceptedDabs!,
            style.transforms,
          );
      const marks = planStudioDynamicBrushCoverageMarks({
        dabVariations,
        strokeOrigins: style.strokeOrigins,
        dynamics: style.dynamics,
        materialIdentity: style.materialIdentity,
        dynamicSeed: style.seed,
        stroke: style.color,
        stampGrid,
        markBudget: causalMarkBudget(style.dynamics),
        ...(style.paper ? { paper: style.paper } : {}),
      });
      if (!marks.ok) return null;
      const firstDab = acceptedSegments
        ? firstSegmentedDab(acceptedSegments)
        : acceptedDabs?.[0];
      const lastDab = acceptedSegments
        ? lastSegmentedDab(acceptedSegments)
        : acceptedDabs?.at(-1);
      return {
        dabCount: acceptedDabCount,
        ...(firstDab ? { firstDab } : {}),
        ...(lastDab ? { lastDab } : {}),
        lastSpacing: Math.max(0.25, lastDab?.spacing ?? 0.25),
        marks: marks.marks,
        stampGrid,
        r8AlphaMapBytes:
          marks.r8TextureAlphaMapReceipt?.alphaMapBytes ?? 0,
        dabCapped: (
          "continuationCapped" in causal
            ? causal.continuationCapped
            : causal.dabCapped
        ) || renderBudget.dabCapped,
        ...(renderBudget.acceptedPrefixReceipt
          ? { acceptedPrefixReceipt: renderBudget.acceptedPrefixReceipt }
          : {}),
      };
    }
    const planInput = {
      points: source.points,
      pressures: source.pressures,
      tangentialPressures: source.tangentialPressures,
      speeds: source.speeds,
      tiltXs: source.tiltXs,
      tiltYs: source.tiltYs,
      twists: source.twists,
      baseWidth: style.width,
      baseOpacity: style.dynamics.opacity.base,
      seed: style.seed,
    };
    const planWebDabs = (maxDabs: number): StudioDynamicBrushDab[] | null => {
      return planStudioWebDrawingKitOwnedDabs(
        {
          brushId: style.brushId,
          points: planInput.points,
          pressures: planInput.pressures,
          baseWidth: planInput.baseWidth,
          baseOpacity: planInput.baseOpacity,
          seed: planInput.seed,
          maxDabs,
          centerX: style.symmetry.centerX,
          centerY: style.symmetry.centerY,
        },
        style.dynamics,
      );
    };
    // Web kits can explode sample counts (swarm/kaleido). Cap the first live plan to the
    // mark budget before render-budget planning so pointer frames stay allocation-light.
    const webLiveCap = studioWebDrawingKitOwnsStrokeGeometry(style.brushId)
      ? recommendStudioWebDrawingLiveMaxDabs({
          brushId: style.brushId,
          points: planInput.points,
          pressures: planInput.pressures,
          baseWidth: planInput.baseWidth,
          seed: planInput.seed,
          markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
          maxDabs: MAX_LEGACY_LIVE_DABS,
        }).maxDabs
      : MAX_LEGACY_LIVE_DABS;
    const initialLiveMaxDabs = Math.min(MAX_LEGACY_LIVE_DABS, webLiveCap);
    let dabs = planWebDabs(initialLiveMaxDabs)
      ?? planNormalizedStudioDynamicBrushDabs(
        { ...planInput, maxDabs: initialLiveMaxDabs },
        style.dynamics,
      );
    const coverageBudget = resolveStudioDynamicBrushCoverageBudgetContract(
      style.materialIdentity,
      style.dynamics,
    );
    const renderBudget = planStudioDynamicBrushRenderBudget({
      settings: coverageBudget.settings,
      dabCount: dabs.length,
      symmetryCount: style.transforms.length,
      fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
        style.materialIdentity,
        dabs.some((dab) => dab.index === 0),
      ),
      materialMarkMultiplier: coverageBudget.materialMarkMultiplier,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    if (renderBudget.maxDabsPerVariation < dabs.length) {
      dabs = planWebDabs(renderBudget.maxDabsPerVariation)
        ?? planNormalizedStudioDynamicBrushDabs(
          { ...planInput, maxDabs: renderBudget.maxDabsPerVariation },
          style.dynamics,
        );
    }
    // Final hard slice if planner still overshoots (defensive; avoids multi-frame freezes).
    const liveSlice = sliceStudioDynamicDabsForLiveFrame(
      dabs,
      renderBudget.maxDabsPerVariation,
    );
    dabs = liveSlice.dabs as StudioDynamicBrushDab[];
    const marks = planStudioDynamicBrushCoverageMarks({
      dabVariations: studioDynamicBrushDabVariationsFromTransforms(
        dabs,
        style.transforms,
      ),
      strokeOrigins: style.strokeOrigins,
      dynamics: style.dynamics,
      materialIdentity: style.materialIdentity,
      ...(style.paper ? { paper: style.paper } : {}),
      dynamicSeed: style.seed,
      stroke: style.color,
      stampGrid: renderBudget.stampGrid,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    if (!marks.ok) return null;
    return {
      dabCount: dabs.length,
      ...(dabs[0] ? { firstDab: dabs[0] } : {}),
      ...(dabs.at(-1) ? { lastDab: dabs.at(-1) } : {}),
      lastSpacing: Math.max(0.25, dabs.at(-1)?.spacing ?? 0.25),
      marks: marks.marks,
      stampGrid: renderBudget.stampGrid,
      r8AlphaMapBytes:
        marks.r8TextureAlphaMapReceipt?.alphaMapBytes ?? 0,
      dabCapped:
        renderBudget.dabCapped
        || liveSlice.sliced
        || dabs.length >= initialLiveMaxDabs,
    };
  }

  private drawMarksToActive(
    marks: readonly StudioDynamicBrushCoverageMark[],
    presentationOpacity?: number,
    boundsMarks?: readonly StudioDynamicBrushCoverageMark[],
  ): boolean {
    const context = this.preparedActive();
    if (!context) return false;
    // Union the frame's full paint rect before any mark lands so a mid-loop throw still leaves
    // the settle-flatten crop a superset of every touched active pixel.
    this.accumulateSettleFlattenUnion(marks);
    try {
      for (const mark of marks) {
        renderStudioDynamicBrushCoverageMark(context, mark);
      }
    } catch {
      return false;
    } finally {
      context.restore();
    }
    return presentationOpacity === undefined
      || this.presentActiveRect(boundsMarks ?? marks, presentationOpacity);
  }

  private presentActiveRect(
    marks: readonly StudioDynamicBrushCoverageMark[],
    opacity: number,
  ): boolean {
    const context = this.presentationContext;
    const source = this.activeCanvas;
    const destination = this.presentationCanvas;
    const surface = this.surface;
    if (!context || !source || !destination || !surface) return false;
    const markRect = presentationRectForMarks(marks, surface, this.dpr, destination);
    // A valid suffix may be fully outside the clipped live viewport. Its coverage is still kept
    // in the source surface and will be presented after a viewport replay; there is simply no
    // visible destination crop to update in this frame.
    if (!markRect) return true;
    // 첫 실제 마크 프레젠테이션이 시작 접촉 자리표시 원을 함께 지우고 누적 캔버스 내용으로
    // 재구성한다. 순수 탭(마크 없음)은 여기 오지 않으므로 즉시 피드백 원은 그대로 남는다.
    const rect = this.contactPlaceholderRect
      ? unionPresentationPixelRects(this.contactPlaceholderRect, markRect)
      : markRect;
    this.contactPlaceholderRect = null;
    try {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(rect.x, rect.y, rect.width, rect.height);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = clamp01(opacity);
      context.drawImage(
        source,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
      context.restore();
      return true;
    } catch {
      try {
        context.restore();
      } catch {
        // The fail-closed caller removes the transient authority.
      }
      return false;
    }
  }

  /**
   * Accumulates the whole-stroke union of per-frame active paint rects — the identical rect
   * authority {@link presentActiveRect} already relies on for the visible dirty presentation copy.
   */
  private accumulateSettleFlattenUnion(
    marks: readonly StudioDynamicBrushCoverageMark[],
  ): void {
    const surface = this.surface;
    const canvas = this.activeCanvas;
    if (!surface || !canvas) return;
    const rect = presentationRectForMarks(marks, surface, this.dpr, canvas);
    if (!rect) return;
    this.settleFlattenUnionRect = unionPresentationPixelRects(
      this.settleFlattenUnionRect,
      rect,
    );
  }

  private flattenActiveToSettled(opacity: number): boolean {
    const context = this.settledContext;
    const canvas = this.activeCanvas;
    if (!context || !canvas) return false;
    // Crop the settle copy to the whole-stroke dirty union. Every pixel outside the union is
    // transparent on the active surface (no drawMarksToActive frame ever touched it), so the
    // cropped copy is pixel-identical while short strokes stop paying a full-surface drawImage on
    // pointer-up. A degenerate/absent union keeps the fail-safe legacy full-surface copy.
    const union = this.settleFlattenUnionRect;
    const crop = union
      ? {
          x: union.x,
          y: union.y,
          width: Math.min(union.width, canvas.width - union.x),
          height: Math.min(union.height, canvas.height - union.y),
        }
      : null;
    try {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = clamp01(opacity);
      if (!crop) {
        context.drawImage(canvas, 0, 0);
      } else if (crop.width > 0 && crop.height > 0) {
        context.drawImage(
          canvas,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
        );
      }
      // A union fully clipped away by a surface change has no retained active pixel to settle.
      context.restore();
      return true;
    } catch {
      try {
        context.restore();
      } catch {
        // The fail-closed caller clears active authority and exposes the retained renderer.
      }
      return false;
    }
  }

  private replay(): void {
    this.clearActiveRect();
    this.clearSettledRect();
    if (!this.surfaceReady()) {
      this.recordReleaseDebug("replay-surface-not-ready");
      return;
    }
    let replayIndex = 0;
    for (const stroke of this.settled) {
      const exact = this.exactPlan(stroke.style, stroke.source);
      if (
        !exact
        || !this.drawMarksToActive(exact.marks)
        || !this.flattenActiveToSettled(stroke.style.opacity)
      ) {
        this.lastFailureReason = "surface-render";
        // 이 경로는 failActive 를 거치지 않는 조용한 전량 클리어다 — 브레드크럼 없이는
        // 커밋 영수증 릴리스와 구분되지 않았던 실측 교훈.
        this.recordReleaseDebug("replay-settled-failed", {
          failedAtIndex: replayIndex,
          exactPlanned: Boolean(exact),
        });
        this.clearActiveRect();
        this.clearSettledRect();
        return;
      }
      this.clearActiveRect();
      replayIndex += 1;
    }
    const active = this.active;
    if (!active) return;
    const exact = this.exactPlan(active.style, active.source);
    if (!exact || !this.drawMarksToActive(exact.marks, active.style.opacity)) {
      this.failActive("surface-render");
      return;
    }
    active.markCount = exact.marks.length;
    active.r8AlphaMapBytes = exact.r8AlphaMapBytes;
    active.acceptedCausalDabCount = exact.dabCount;
    active.acceptedPrefixReceipt = exact.acceptedPrefixReceipt;
    active.stampGrid = exact.stampGrid;
    const dryMediaAccumulator = createDryMediaUnionAccumulator(exact.marks);
    active.dryMediaUnionAccumulator = dryMediaAccumulator ?? undefined;
    active.lastAcceptedCausalDab = dryMediaAccumulator
      ? exact.lastDab
      : undefined;
    this.lastFailureReason = null;
  }

  private failActive(
    reason: StudioLiveDynamicBrushFailureReason,
  ): StudioLiveDynamicBrushOperationFailure {
    this.lastFailureReason = reason;
    // 브라우저 감사 진단 브레드크럼: 명시적 거부/사용 불가 상태는 호스트가 다음 동작을
    // 선택할 때까지 마지막으로 수락된 소스와 픽셀을 유지한다.
    (globalThis as {
      __studioDynamicOverlayDebug?: {
        lastFailure: StudioLiveDynamicBrushFailureReason;
        at: number;
      };
    }).__studioDynamicOverlayDebug = { lastFailure: reason, at: performance.now() };
    return dynamicBrushOperationFailure(reason);
  }

  private resetActiveState(): void {
    if (this.pendingFirstDabRaf) {
      cancelAnimationFrame(this.pendingFirstDabRaf);
      this.pendingFirstDabRaf = 0;
    }
    if (this.pendingBeginRaf) {
      cancelAnimationFrame(this.pendingBeginRaf);
      this.pendingBeginRaf = 0;
    }
    this.pendingFirstDab = null;
    this.pendingBeginElement = null;
    this.active = null;
  }

  private canDeferFirstDabRaster(): boolean {
    return typeof requestAnimationFrame === "function"
      && typeof PerformanceObserver !== "undefined"
      && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
  }

  private flushPendingFirstDab(): void {
    const dab = this.pendingFirstDab;
    const active = this.active;
    if (!dab || !active) return;
    this.pendingFirstDab = null;
    if (this.pendingFirstDabRaf) {
      cancelAnimationFrame(this.pendingFirstDabRaf);
      this.pendingFirstDabRaf = 0;
    }
    this.appendDabs(active, [dab]);
  }

  private surfaceReady(): boolean {
    return this.surfaceUsable
      && this.surface !== null
      && this.activeCanvas !== null
      && this.presentationCanvas !== null
      && this.settledCanvas !== null
      && this.activeContext !== null
      && this.presentationContext !== null
      && this.settledContext !== null;
  }

  paintContactFromElement(element: DrawEl): boolean {
    const x = finiteCoordinate(element.points[0]);
    const y = finiteCoordinate(element.points[1]);
    if (x === null || y === null) return false;
    this.paintImmediateContact(
      {
        color: element.stroke,
        width: Math.max(1, element.strokeWidth),
        opacity: Math.max(0, Math.min(1, element.opacity ?? 1)),
      },
      { x, y },
    );
    return this.presentationContext !== null && this.surface !== null;
  }

  private paintImmediateContact(
    style: Pick<DetachedDynamicStrokeStyle, "color" | "width" | "opacity">,
    first: { readonly x: number; readonly y: number },
  ): void {
    const context = this.presentationContext;
    const surface = this.surface;
    if (!context || !surface || !this.surfaceUsable) return;
    const scale = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -scale,
        0,
        0,
        scale,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr,
      );
    } else {
      context.setTransform(
        scale,
        0,
        0,
        scale,
        -surface.left * this.dpr,
        -surface.top * this.dpr,
      );
    }
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = Math.max(0.72, Math.min(1, style.opacity));
    context.fillStyle = style.color;
    const radius = Math.max(2.8, style.width * 0.34);
    context.beginPath();
    context.arc(first.x, first.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
    this.recordContactPlaceholderRect(first.x, first.y, radius);
  }

  /**
   * {@link presentationRectForMarks}와 같은 변환·같은 3px 프린지로 자리표시 원의 픽셀 rect 를
   * 기록한다. begin 경로가 원을 두 번(요소 폭 → 스타일 폭) 그릴 수 있으므로 합집합으로 쌓는다.
   */
  private recordContactPlaceholderRect(
    centerX: number,
    centerY: number,
    radius: number,
  ): void {
    const surface = this.surface;
    const canvas = this.presentationCanvas;
    if (!surface || !canvas) return;
    const scale = this.dpr * surface.documentScale;
    const translateX = surface.flipX
      ? (surface.documentWidth * surface.documentScale - surface.left) * this.dpr
      : -surface.left * this.dpr;
    const translateY = -surface.top * this.dpr;
    const firstPixelX = (surface.flipX ? -scale : scale) * (centerX - radius) + translateX;
    const secondPixelX = (surface.flipX ? -scale : scale) * (centerX + radius) + translateX;
    const firstPixelY = scale * (centerY - radius) + translateY;
    const secondPixelY = scale * (centerY + radius) + translateY;
    const fringe = 3;
    const minimumPixelX = Math.max(
      0,
      Math.floor(Math.min(firstPixelX, secondPixelX)) - fringe,
    );
    const minimumPixelY = Math.max(
      0,
      Math.floor(Math.min(firstPixelY, secondPixelY)) - fringe,
    );
    const maximumPixelX = Math.min(
      canvas.width,
      Math.ceil(Math.max(firstPixelX, secondPixelX)) + fringe,
    );
    const maximumPixelY = Math.min(
      canvas.height,
      Math.ceil(Math.max(firstPixelY, secondPixelY)) + fringe,
    );
    const width = maximumPixelX - minimumPixelX;
    const height = maximumPixelY - minimumPixelY;
    if (width <= 0 || height <= 0) return;
    this.contactPlaceholderRect = unionPresentationPixelRects(
      this.contactPlaceholderRect,
      { x: minimumPixelX, y: minimumPixelY, width, height },
    );
  }

  private preparedActive(): CanvasRenderingContext2D | null {
    const context = this.activeContext;
    const surface = this.surface;
    if (!context || !surface || !this.surfaceUsable) return null;
    const scale = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -scale,
        0,
        0,
        scale,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr,
      );
    } else {
      context.setTransform(
        scale,
        0,
        0,
        scale,
        -surface.left * this.dpr,
        -surface.top * this.dpr,
      );
    }
    context.globalCompositeOperation = "source-over";
    return context;
  }

  private applySurface(): void {
    const activeCanvas = this.activeCanvas;
    const presentationCanvas = this.presentationCanvas;
    const settledCanvas = this.settledCanvas;
    const surface = this.surface;
    if (!activeCanvas || !presentationCanvas || !settledCanvas || !surface) {
      this.surfaceUsable = false;
      return;
    }
    const cssPixels = Math.max(1, surface.width) * Math.max(1, surface.height);
    this.surfaceUsable = cssPixels * 3 <= STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS;
    if (!this.surfaceUsable) {
      this.releaseSurfaceBackingStores();
      return;
    }
    this.dpr = liveDynamicDevicePixelRatio(surface);
    // Dynamic tip/grain/dual material must not become visibly softer while the pointer is down.
    // If all three live canvases cannot retain native density, fail closed before painting a
    // pixel and let the exact retained renderer remain authoritative.
    if (this.dpr + POINT_EPSILON < nativeStudioDevicePixelRatio()) {
      this.surfaceUsable = false;
      this.releaseSurfaceBackingStores();
      return;
    }
    const width = Math.max(1, Math.round(surface.width * this.dpr));
    const height = Math.max(1, Math.round(surface.height * this.dpr));
    if (
      (activeCanvas.width !== width || activeCanvas.height !== height)
      && (this.active !== null || this.settled.length > 0)
    ) {
      // 치수 변경은 세 백킹 비트맵을 조용히 지운다 — setSurface 의 replay 가 복구를 맡지만,
      // 실패 프레임에서 지워진 시점을 확정할 수 있게 남긴다.
      this.recordReleaseDebug("surface-resize-wipe", {
        fromWidth: activeCanvas.width,
        fromHeight: activeCanvas.height,
        toWidth: width,
        toHeight: height,
      });
    }
    if (activeCanvas.width !== width) activeCanvas.width = width;
    if (activeCanvas.height !== height) activeCanvas.height = height;
    if (presentationCanvas.width !== width) presentationCanvas.width = width;
    if (presentationCanvas.height !== height) presentationCanvas.height = height;
    if (settledCanvas.width !== width) settledCanvas.width = width;
    if (settledCanvas.height !== height) settledCanvas.height = height;
    this.surfaceUsable =
      width * height * 3 <= STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS;
    if (!this.surfaceUsable) this.releaseSurfaceBackingStores();
  }

  /**
   * The coverage surface is an internal R8-like accumulation bitmap and is never presented in the
   * DOM. Keep only that hidden store parked between contacts; the presentation and settled canvases
   * remain untouched because they can still own visible handoff pixels. `begin()` restores this
   * store synchronously before painting the immediate contact, so first-use rendering stays on the
   * existing same-task path.
   */
  private parkCoverageBackingStoreIfIdle(): void {
    if (this.active !== null || this.pendingBeginElement !== null) return;
    const canvas = this.activeCanvas;
    if (!canvas) return;
    if (canvas.width !== 1) canvas.width = 1;
    if (canvas.height !== 1) canvas.height = 1;
  }

  private restoreCoverageBackingStore(): void {
    const canvas = this.activeCanvas;
    const surface = this.surface;
    if (!canvas || !surface || !this.surfaceUsable) return;
    const width = Math.max(1, Math.round(surface.width * this.dpr));
    const height = Math.max(1, Math.round(surface.height * this.dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  private releaseSurfaceBackingStores(): void {
    this.dpr = 1;
    for (
      const canvas of [
        this.activeCanvas,
        this.presentationCanvas,
        this.settledCanvas,
      ]
    ) {
      if (!canvas) continue;
      // Resizing releases the old RGBA allocation and clears the bitmap. Keep a real 1 × 1
      // surface so a context acquired by the long-lived host remains valid for a later viewport.
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
    }
    // A mock canvas or an already-minimal real canvas may not observe a dimension mutation.
    // Explicitly clear all three bitmaps after the provider releases their backing stores. The
    // retained source arrays remain available for an explicit later rebuild.
    this.clearActiveRect();
    this.clearSettledRect();
  }

  private clearActiveRect(): void {
    this.clearCanvas(this.activeContext, this.activeCanvas);
    this.clearCanvas(this.presentationContext, this.presentationCanvas);
    this.settleFlattenUnionRect = null;
    this.contactPlaceholderRect = null;
  }

  private clearSettledRect(): void {
    this.clearCanvas(this.settledContext, this.settledCanvas);
  }

  private clearCanvas(
    context: CanvasRenderingContext2D | null,
    canvas: HTMLCanvasElement | null,
  ): void {
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }
}
