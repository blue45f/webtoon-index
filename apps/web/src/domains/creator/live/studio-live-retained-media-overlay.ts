/**
 * Append-only live canvas for oil and pencil.
 *
 * Konva `sceneFunc` replans and repaints the whole growing stroke every pointer frame. That is
 * the 90–140ms long task on those families. This surface keeps accepted pixels and paints only
 * the unseen suffix with the same planners the committed renderer uses.
 */

import {
  mapStudioBrushAliasPressure,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import { resolveStudioCalligraphyRenderTip } from "../brush/studio-calligraphy-nib-profile";
import { planStudioCalligraphyRibbon } from "../brush/studio-calligraphy-ribbon";
import { studioOilFamilyPlanFields } from "../brush/studio-fluid-paint-reference";
import { studioLiveVisibleTapDocumentRadius } from "../brush/studio-live-visible-tap";
import {
  StudioOilRibbonCarrierPlanner,
  paintStudioOilRibbonCarrier,
  planStudioOilRibbonCarrier,
  studioOilRibbonProgramsForBrush,
  type StudioOilRibbonPaintContext,
} from "../brush/studio-oil-ribbon-carrier";
import {
  STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT,
  studioPencilAliasPasses,
  studioPencilAliasPassPoints,
  studioPencilRibbonAlphaBucket,
} from "../brush/studio-pencil-alias-passes";
import { isStudioBoundedFlowPaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  createStudioIncrementalCalligraphySegmentBuilder,
  resolveStudioBrushRenderFamily,
  resolveStudioFreehandRenderPath,
  strokeRenderDistance,
  type StudioIncrementalCalligraphySegmentBuilder,
} from "../studio-brush";
import {
  FX_OIL_DAB_CAP,
  FxOilDabPlanner,
  createStudioIncrementalFxPressurePathBuilder,
  fxBrushSeedFromKey,
  isStudioFxPressureBrushId,
  planOilBrushDabs,
  type StudioIncrementalFxPressurePathBuilder,
} from "../studio-fx-brush";
import {
  createStudioIncrementalHighlighterWashRibbonBuilder,
  planStudioHighlighterWashTap,
  resolveStudioHighlighterWashBrushId,
  traceStudioHighlighterWashDetail,
  traceStudioHighlighterWashPlan,
  type StudioIncrementalHighlighterWashRibbonBuilder,
} from "../studio-highlighter-wash-ribbon";
import {
  acquireStudioLowLatencyCanvas2dContext,
  decideStudioNativeLiveSurfaceResolution,
  type StudioNativeLiveSurfaceResolutionDecision,
} from "../studio-low-latency-canvas";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  createStudioIncrementalRetainedMediaCurveBuilder,
  planStudioRetainedMediaTapDab,
  resolveStudioRetainedMediaPressureProfileId,
  type StudioIncrementalRetainedMediaCurveBuilder,
} from "../studio-retained-media-pressure";
import { planStudioRetainedMediaRibbon } from "../studio-retained-media-ribbon";

import { paintStudioLivePencilProgram, type StudioLivePencilPaintCommand } from "./studio-live-pencil-paint-program";
import { paintStudioLiveRetainedRoundStroke } from "./studio-live-retained-stroke-paint";

import type { DrawEl } from "../studio-element-model";
import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";

export type StudioLiveRetainedMediaKind =
  | "oil"
  | "pencil"
  | "calligraphy"
  | "highlighter"
  | "eraser";

export type StudioLiveRetainedMediaUnavailableReason = "surface-unavailable";
export type StudioLiveRetainedMediaRejectedReason = "unsupported" | "stroke-identity";
export type StudioLiveRetainedMediaFailureReason =
  | StudioLiveRetainedMediaUnavailableReason
  | StudioLiveRetainedMediaRejectedReason;

export type StudioLiveRetainedMediaOperationFailure =
  | {
      readonly status: "unavailable";
      readonly reason: StudioLiveRetainedMediaUnavailableReason;
    }
  | {
      readonly status: "rejected";
      readonly reason: StudioLiveRetainedMediaRejectedReason;
    };

function retainedMediaOperationFailure(
  reason: StudioLiveRetainedMediaFailureReason,
): StudioLiveRetainedMediaOperationFailure {
  return reason === "surface-unavailable"
    ? { status: "unavailable", reason }
    : { status: "rejected", reason };
}

export type StudioLiveRetainedMediaBeginResult =
  | { readonly status: "started"; readonly kind: StudioLiveRetainedMediaKind }
  | StudioLiveRetainedMediaOperationFailure;

export type StudioLiveRetainedMediaAppendResult =
  | { readonly status: "appended" | "noop" }
  | StudioLiveRetainedMediaOperationFailure;

export type StudioLiveRetainedMediaEndResult =
  | { readonly status: "settled" }
  | StudioLiveRetainedMediaOperationFailure;

export function studioLiveRetainedMediaOverlaySupportsElement(
  element: DrawEl,
): boolean {
  if ((element.kind ?? "freehand") !== "freehand") return false;
  if (element.mode === "eraser") return true;
  if ((element.mode ?? "pen") !== "pen") return false;
  if (element.fill !== undefined && element.fill !== null) return false;
  // bounded-flow-v2 다이내믹 획은 다이내믹 오버레이가 커밋과 동일한 dab 플랜으로 그린다.
  // 이 오버레이가 패밀리만 보고 가로채면 라이브가 일반 캐리어(균일 실선)로 그려져 커밋과
  // 갈라진다 — 장경로 실측: erodible-pencil energy 0.35 붕괴 + 79px 라이브 전용 시작원,
  // oil--knife-edge 1307px 라이브 전용 시작원. 입장 체인에서 이 판정이 다이내믹보다 먼저
  // 평가되므로 여기서 명시적으로 양보해야 한다.
  if (isStudioBoundedFlowPaintModelCompatible(element)) return false;
  const family = resolveStudioBrushRenderFamily(element.brush ?? "pen");
  return family === "oil"
    || family === "pencil"
    || family === "calligraphy"
    || family === "highlighter";
}

function retainedKind(element: DrawEl): StudioLiveRetainedMediaKind | null {
  if (element.mode === "eraser") return "eraser";
  const family = resolveStudioBrushRenderFamily(element.brush ?? "pen");
  return family === "oil"
    || family === "pencil"
    || family === "calligraphy"
    || family === "highlighter"
    ? family
    : null;
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pairsFromElement(element: DrawEl): { x: number; y: number }[] {
  const pairs: { x: number; y: number }[] = [];
  const count = Math.floor(element.points.length / 2);
  for (let index = 0; index < count; index += 1) {
    const x = finiteCoordinate(element.points[index * 2]);
    const y = finiteCoordinate(element.points[index * 2 + 1]);
    if (x === null || y === null) break;
    pairs.push({ x, y });
  }
  return pairs;
}

/**
 * Exact equality for the numeric series an oil bed is planned from.
 *
 * Length is checked first, so the growth case — the common one — costs a single comparison; the
 * full scan only runs when a same-length draft has to be told apart from the one already painted.
 */
function sameNumberSeries(
  next: readonly number[] | undefined,
  previous: readonly number[] | null | undefined,
): boolean {
  // A stroke carrying no pressures at all (mouse input) has to be able to match a previous paint
  // that also carried none; only an unpainted bed — a real series against `null` — differs.
  if (next === undefined) return previous === undefined || previous === null;
  if (previous === undefined || previous === null) return false;
  if (next.length !== previous.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (!Object.is(next[index], previous[index])) return false;
  }
  return true;
}

function flatPairs(pairs: readonly { x: number; y: number }[]): number[] {
  const points: number[] = [];
  for (const pair of pairs) points.push(pair.x, pair.y);
  return points;
}

/**
 * `pairsFromElement` + `flatPairs` without the intermediate object array: the oil hot path ran
 * both on every pointer frame, allocating O(N) `{x,y}` objects per frame over one drag. Same
 * finite-validation semantics — stop at the first non-finite coordinate.
 */
function flatFinitePoints(element: DrawEl): number[] {
  const points: number[] = [];
  const count = Math.floor(element.points.length / 2);
  for (let index = 0; index < count; index += 1) {
    const x = element.points[index * 2];
    const y = element.points[index * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    points.push(x, y);
  }
  return points;
}

/**
 * Extends the running dab-radius mean to cover `dabs` and returns it. Addition stays strictly
 * left-to-right across frames, so the value is bit-identical to reducing the whole array every
 * call while costing O(new dabs) instead of O(all dabs) per pointer frame.
 */
function extendOilRadiusMean(
  active: ActiveRetainedStroke,
  dabs: readonly { radiusY: number }[],
): number {
  if (
    active.oilRadiusSum === undefined
    || active.oilRadiusSumDabCount === undefined
    || active.oilRadiusSumDabCount > dabs.length
  ) {
    // Clamped to what `dabs` actually holds. The seed covers the prefix already painted, but a
    // bed can SHRINK — an authoritative draft that retracts a predicted suffix replans to fewer
    // dabs — and seeding from the previous, longer count then reads past the end of the new array
    // and throws. Clamping seeds the whole short array instead, which is the same strictly
    // left-to-right sum a full reduce would produce.
    const seeded = Math.min(active.paintedDabs, dabs.length);
    let sum = 0;
    for (let index = 0; index < seeded; index += 1) {
      sum += dabs[index]!.radiusY;
    }
    active.oilRadiusSum = sum;
    active.oilRadiusSumDabCount = seeded;
  }
  for (
    let index = active.oilRadiusSumDabCount;
    index < dabs.length;
    index += 1
  ) {
    active.oilRadiusSum += dabs[index]!.radiusY;
  }
  active.oilRadiusSumDabCount = dabs.length;
  return Math.max(1, active.oilRadiusSum / Math.max(1, dabs.length));
}

/** Reuses the per-frame dab point objects across carrier paints instead of re-mapping. */
function oilDabPoints(
  active: ActiveRetainedStroke,
  dabs: readonly { x: number; y: number }[],
): readonly { x: number; y: number }[] {
  const cached = active.oilDabPoints;
  if (
    cached
    && cached.length === dabs.length
    && active.oilDabPointsElementPointsLength === active.element.points.length
    && active.oilDabPointsPressuresLength === (active.element.pressures?.length ?? -1)
  ) {
    return cached;
  }
  const mapped = dabs.map((dab) => ({ x: dab.x, y: dab.y }));
  active.oilDabPoints = mapped;
  active.oilDabPointsElementPointsLength = active.element.points.length;
  active.oilDabPointsPressuresLength = active.element.pressures?.length ?? -1;
  return mapped;
}

/**
 * How much of the pointer's own time an oil bed may spend rebuilding itself.
 *
 * A long oil stroke's replan costs tens of milliseconds, and the overlay used to stop repainting
 * altogether once the bed saturated — which froze the stroke's tip on screen, because the lattice
 * pins its last station to the last source point. A fixed sample stride cannot bound that either:
 * how far the tip falls behind depends on how fast the cursor is moving and how long the rebuild
 * takes on this machine, neither of which a constant knows.
 *
 * The bound is the rebuild's OWN measured cost — after a repaint that took `t`, the next one waits
 * `t * (DIVISOR - 1)`, so the bed never occupies more than `1 / DIVISOR` of the pointer's time no
 * matter what it costs here. A fast machine repaints often and stays glued to the cursor; a slow
 * one repaints less but still follows it, and neither can be starved.
 *
 * This is measured on every oil repaint rather than only on a saturated bed. Keying it to the dab
 * count made the count a stand-in for "expensive", and that stand-in does not survive contact with
 * the capped spacing ladder: a capped bed now lands inside a band below `FX_OIL_DAB_CAP` instead of
 * exactly on it, so the budget silently stopped engaging on precisely the strokes it was written
 * for. The cost is the thing the budget cares about and the overlay already times it, so it reads
 * that instead of guessing from a proxy. A cheap repaint yields a cooldown of its own small size,
 * which is no deferral in practice.
 */
const OIL_REPAINT_DUTY_DIVISOR = 3;

interface ActiveRetainedStroke {
  readonly id: string;
  readonly kind: StudioLiveRetainedMediaKind;
  element: DrawEl;
  paintedDabs: number;
  /**
   * Oil paints actually issued for this stroke.
   *
   * `paintedDabs` cannot answer "did this append change the canvas?" once the bed saturates
   * `FX_OIL_DAB_CAP` — the count is pinned at 4096 while every station keeps moving — so the
   * append result was reporting `noop` for repaints that really happened. This advances on every
   * oil paint and is what the append result reads. Non-oil kinds leave it at 0.
   */
  paintedOilPasses: number;
  /**
   * The exact inputs the painted oil bed was planned from, or null before the first paint.
   *
   * A cheaper fingerprint does not work here. Counting samples cannot see an authoritative draft
   * that REPLACES a predicted one of the same length, and adding the endpoint still misses a
   * correction to the interior — both leave retracted predicted pixels on screen. Comparing the
   * inputs themselves is exact, and it is a numeric scan that only runs to completion when the
   * lengths match, against a plan that costs tens of milliseconds.
   */
  paintedOilPoints: readonly number[] | null;
  paintedOilPressures: readonly number[] | null;
  /** Wall clock and duration of the last oil repaint, for the duty budget above. */
  lastOilRepaintAt: number;
  lastOilRepaintMs: number;
  paintedPencilMarks: number;
  paintedSourceSegments: number;
  /**
   * Per-stroke oil dab cache. Present only for the live in-progress stroke: settled replays build
   * a throwaway `ActiveRetainedStroke` and pass `null`, which routes them through the plain
   * `planOilBrushDabs` exactly as before.
   */
  oilPlanner: FxOilDabPlanner | null;
  /**
   * Per-stroke carrier planner, paired with `oilPlanner`. Present only for the live in-progress
   * stroke; settled replays pass `null` and route through the batch `planStudioOilRibbonCarrier`
   * exactly as before. The plan is byte-identical either way — see
   * `StudioOilRibbonCarrierPlanner`.
   */
  oilCarrierPlanner: StudioOilRibbonCarrierPlanner | null;
  /**
   * Per-stroke incremental highlighter planners (fx pressure path + wash ribbon), created lazily
   * on first paint. A live append then pays only for new samples; settled replays build throwaway
   * actives whose fresh builder pair reproduces the batch plan in one cold append, so replay
   * output stays batch-identical.
   */
  fxPressurePathBuilder?: StudioIncrementalFxPressurePathBuilder;
  highlighterWashBuilder?: StudioIncrementalHighlighterWashRibbonBuilder;
  /**
   * Running left-to-right `radiusY` sum over the accepted dab prefix plus the dab count it was
   * accumulated for. Rebuilding the mean from the whole dab array every pointer frame made oil
   * live cost O(N²) over one drag; extending the running sum keeps the float addition order —
   * and therefore the produced `radiusPx` — bit-identical to the full reduce it replaces.
   */
  oilRadiusSum?: number;
  oilRadiusSumDabCount?: number;
  /** Cached carrier input points plus the element lengths they were mapped from. */
  oilDabPoints?: readonly { x: number; y: number }[];
  oilDabPointsElementPointsLength?: number;
  oilDabPointsPressuresLength?: number;
  /**
   * Per-stroke incremental calligraphy segment state. Created lazily on the first multi-point
   * paint; settled replays build a throwaway `ActiveRetainedStroke`, so each replay starts its
   * own builder and pays one full O(n) build instead of per-move ones.
   */
  calligraphySegments?: StudioIncrementalCalligraphySegmentBuilder;
  /**
   * One incremental pressure-curve builder per pencil alias pass — same lifecycle as
   * `calligraphySegments`. A pass owns its own jittered polyline, so it needs its own builder.
   */
  pencilCurves?: StudioIncrementalRetainedMediaCurveBuilder[];
  /** Own the already-issued geometry once; no growing DrawEl snapshots or bitmap per stroke. */
  pencilProgram?: StudioLivePencilPaintCommand[];
}

export class StudioLiveRetainedMediaOverlayRenderer {
  private activeCanvas: HTMLCanvasElement | null = null;
  private settledCanvas: HTMLCanvasElement | null = null;
  private activeContext: CanvasRenderingContext2D | null = null;
  private settledContext: CanvasRenderingContext2D | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private dpr = 1;
  private resolutionDecision: StudioNativeLiveSurfaceResolutionDecision | null = null;
  private active: ActiveRetainedStroke | null = null;
  private settled: DrawEl[] = [];
  private readonly settledPencilPrograms = new Map<string, readonly StudioLivePencilPaintCommand[]>();
  private settledHasPixels = false;
  private activePaintedOntoSettled = false;
  private lastFailureReason: StudioLiveRetainedMediaFailureReason | null = null;

  /** Pending wake-up for a capped repaint this overlay deferred. */
  private capRepaintWake: unknown = null;

  private readonly now: () => number;
  private readonly scheduleWake: (run: () => void, delayMs: number) => unknown;
  private readonly cancelWake: (handle: unknown) => void;

  /**
   * The clock and the timer the capped-repaint budget uses are injectable so the budget's timing
   * is exercised deterministically in tests rather than by how fast the machine happens to be.
   */
  constructor(options: {
    readonly now?: () => number;
    readonly scheduleWake?: (run: () => void, delayMs: number) => unknown;
    readonly cancelWake?: (handle: unknown) => void;
  } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.scheduleWake = options.scheduleWake
      ?? ((run, delayMs) => setTimeout(run, delayMs));
    this.cancelWake = options.cancelWake
      ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Drop a pending wake-up: whatever it was going to repaint is gone or already painted. */
  private clearCapRepaintWake(): void {
    if (this.capRepaintWake === null) return;
    this.cancelWake(this.capRepaintWake);
    this.capRepaintWake = null;
  }

  attach(canvases: {
    readonly activeCanvas: HTMLCanvasElement;
    readonly settledCanvas: HTMLCanvasElement;
  } | null): void {
    this.activeCanvas = canvases?.activeCanvas ?? null;
    this.settledCanvas = canvases?.settledCanvas ?? null;
    this.activeContext = this.activeCanvas
      ? acquireStudioLowLatencyCanvas2dContext(this.activeCanvas)
      : null;
    this.settledContext = this.settledCanvas
      ? acquireStudioLowLatencyCanvas2dContext(this.settledCanvas)
      : null;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
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
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  get hasSettledStrokes(): boolean {
    return this.settled.length > 0;
  }

  get settledStrokeCount(): number {
    return this.settled.length;
  }

  /** Diagnostics for retained-command ownership; released prefixes must return this to zero. */
  get retainedPencilCommandCount(): number {
    let count = this.active?.pencilProgram?.length ?? 0;
    for (const program of this.settledPencilPrograms.values()) count += program.length;
    return count;
  }

  get lastOperationFailureReason(): StudioLiveRetainedMediaFailureReason | null {
    return this.lastFailureReason;
  }

  get isNativeSurfaceReady(): boolean {
    return this.activeContext !== null
      && this.surface !== null
      && this.resolutionDecision?.ok === true;
  }

  begin(element: DrawEl): StudioLiveRetainedMediaBeginResult {
    if (!studioLiveRetainedMediaOverlaySupportsElement(element)) {
      return retainedMediaOperationFailure("unsupported");
    }
    if (!this.isNativeSurfaceReady) {
      return retainedMediaOperationFailure("surface-unavailable");
    }
    const kind = retainedKind(element);
    if (!kind) return retainedMediaOperationFailure("unsupported");
    if (this.active) {
      this.resetActiveState();
      this.replay();
    }
    this.active = {
      id: element.id,
      kind,
      element,
      paintedDabs: 0,
      paintedOilPasses: 0,
      paintedOilPoints: null,
      paintedOilPressures: null,
      lastOilRepaintAt: 0,
      lastOilRepaintMs: 0,
      paintedPencilMarks: 0,
      paintedSourceSegments: 0,
      oilPlanner: kind === "oil" ? new FxOilDabPlanner() : null,
      oilCarrierPlanner: kind === "oil" ? new StudioOilRibbonCarrierPlanner() : null,
    };
    this.activePaintedOntoSettled = false;
    const painted = this.paintSuffix(this.active, element, this.activeContext);
    if (!painted) {
      return this.failActive("surface-unavailable");
    }
    this.lastFailureReason = null;
    return { status: "started", kind };
  }

  appendFrom(
    element: DrawEl,
    /** Internal: pointer-up, so the capped-repaint budget must not defer this paint. */
    finalize = false,
  ): StudioLiveRetainedMediaAppendResult {
    if (this.lastFailureReason) {
      return retainedMediaOperationFailure(this.lastFailureReason);
    }
    const active = this.active;
    if (!active) return retainedMediaOperationFailure("stroke-identity");
    if (element.id !== active.id || retainedKind(element) !== active.kind) {
      return this.failActive("stroke-identity");
    }
    if (!this.isNativeSurfaceReady) {
      return this.failActive("surface-unavailable");
    }
    active.element = element;
    // The oil pass counter is read on its own rather than added to the others. `paintedDabs` can
    // FALL — an authoritative draft that retracts a predicted suffix replans to fewer dabs — and a
    // drop of hundreds would swallow the `+1` a real repaint contributes, reporting `noop` for a
    // frame that cleared and repainted the canvas.
    const beforeOilPasses = active.paintedOilPasses;
    const before = active.paintedDabs
      + active.paintedPencilMarks + active.paintedSourceSegments;
    if (!this.paintSuffix(active, element, this.activeContext, finalize)) {
      return this.failActive("surface-unavailable");
    }
    const after = active.paintedDabs
      + active.paintedPencilMarks + active.paintedSourceSegments;
    const painted = active.paintedOilPasses > beforeOilPasses || after > before;
    return { status: painted ? "appended" : "noop" };
  }

  end(element: DrawEl): StudioLiveRetainedMediaEndResult {
    if (this.lastFailureReason) {
      return retainedMediaOperationFailure(this.lastFailureReason);
    }
    if (!this.active) return retainedMediaOperationFailure("stroke-identity");
    if (element.id !== this.active.id || retainedKind(element) !== this.active.kind) {
      return this.failActive("stroke-identity");
    }
    if (!this.isNativeSurfaceReady) return this.failActive("surface-unavailable");
    this.active.element = element;
    // Only a stationary pencil tap needs its screen-space visibility hint replaced at release.
    // Travel keeps its issued paint program: rebuilding thousands of points here stalls input.
    if (this.active.kind === "highlighter"
      || (this.active.kind === "pencil" && this.active.paintedSourceSegments === 0)) {
      this.clearCanvas(this.activeContext, this.activeCanvas);
      const fullActive: ActiveRetainedStroke = {
        id: element.id,
        kind: this.active.kind,
        element,
        paintedDabs: 0,
        paintedOilPasses: 0,
        paintedOilPoints: null,
        paintedOilPressures: null,
        lastOilRepaintAt: 0,
        lastOilRepaintMs: 0,
        paintedPencilMarks: 0,
        paintedSourceSegments: 0,
        oilPlanner: null,
        oilCarrierPlanner: null,
      };
      if (!this.paintSuffix(fullActive, element, this.activeContext, true)) {
        return this.failActive("surface-unavailable");
      }
      this.active.pencilProgram = fullActive.pencilProgram;
    } else {
      // Pointer-up seals whatever is on the active canvas into settled, so a capped bed that is
      // still holding a deferred tail has to flush it here. It stays a normal append otherwise:
      // a bed that already matches this element is still skipped rather than rebuilt for nothing.
      const appended = this.appendFrom(element, true);
      if (appended.status === "unavailable" || appended.status === "rejected") return appended;
    }
    if (!this.activePaintedOntoSettled && !this.flattenActiveToSettled()) {
      return this.failActive("surface-unavailable");
    }
    if (this.active.kind === "pencil" && this.active.pencilProgram) {
      this.settledPencilPrograms.set(this.active.id, this.active.pencilProgram);
    }
    this.settled.push(this.active.element);
    this.resetActiveState();
    this.clearActiveRect();
    return { status: "settled" };
  }

  releaseSettledPrefix(count: number): number {
    const requested = count === Number.POSITIVE_INFINITY
      ? this.settled.length
      : Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 0;
    const released = Math.min(requested, this.settled.length);
    if (released === 0) return 0;
    const releasedStrokes = this.settled.slice(0, released);
    this.settled = this.settled.slice(released);
    for (const stroke of releasedStrokes) {
      if (!this.settled.some((remaining) => remaining.id === stroke.id)) {
        this.settledPencilPrograms.delete(stroke.id);
      }
    }
    this.replay();
    return released;
  }

  resetActive(): boolean {
    const hadOperation = this.active !== null || this.lastFailureReason !== null;
    if (!hadOperation) return false;
    this.resetActiveState();
    this.lastFailureReason = null;
    this.replay();
    return true;
  }

  hideSettledPixels(): boolean {
    if (this.settled.length === 0 && !this.settledHasPixels) return false;
    this.clearCanvas(this.settledContext, this.settledCanvas);
    return true;
  }

  showSettledPixels(): boolean {
    if (this.settled.length === 0) return false;
    this.replaySettledOnly();
    return true;
  }

  clear(): void {
    this.resetActiveState();
    this.lastFailureReason = null;
    this.settled = [];
    this.settledPencilPrograms.clear();
    this.clearActiveRect();
    this.clearSettledRect();
  }

  private paintSuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
    /** Pointer-up. The active canvas is about to be sealed into settled, so nothing is deferred. */
    finalize = false,
  ): boolean {
    if (active.kind === "oil") return this.paintOilSuffix(active, element, target, finalize);
    if (active.kind === "pencil") {
      return this.paintPencilSuffix(active, element, target, finalize);
    }
    if (active.kind === "calligraphy") {
      return this.paintCalligraphySuffix(active, element, target);
    }
    if (active.kind === "eraser") return this.paintEraserSuffix(active, element, target);
    return this.paintHighlighterSuffix(active, element, target);
  }

  private paintOilSuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
    finalizeOil = false,
  ): boolean {
    const context = this.prepared(target);
    if (!context) return false;
    try {
      // Past the cap every append rebuilds all 4096 dabs, so the bed is held to a share of the
      // pointer's time (see `OIL_CAP_REPAINT_DUTY_DIVISOR`). `finalizeOil` is pointer-up, which
      // seals the active canvas into settled and so must never be deferred.
      //
      // This runs before the point copy below on purpose. A deferred event is decided from state
      // alone — a counter and two timestamps — while `flatFinitePoints` walks and copies the whole
      // accumulated history. Copying it for events that are about to be dropped would put an O(N)
      // allocation on every pointer frame past the cap, quadratic over the drag, and it would sit
      // outside the very budget this guard exists to enforce.
      const now = this.now();
      const cooldownRemaining = active.lastOilRepaintAt
        + active.lastOilRepaintMs * (OIL_REPAINT_DUTY_DIVISOR - 1)
        - now;
      if (target === this.activeContext && !finalizeOil && cooldownRemaining > 0) {
        // Deferring the newest pointer event drops the only carrier of the new endpoint, so if the
        // user then holds still nothing would ever ask again and the preview would sit detached
        // from a stationary cursor. Wake ourselves when the budget is paid off instead.
        this.clearCapRepaintWake();
        this.capRepaintWake = this.scheduleWake(() => {
          this.capRepaintWake = null;
          if (this.active === active) this.paintOilSuffix(active, active.element, target);
        }, cooldownRemaining);
        return true;
      }
      this.clearCapRepaintWake();

      const flatPoints = flatFinitePoints(element);
      if (flatPoints.length === 0) return true;
      // Nothing new arrived, so there is nothing to plan. Compared against the inputs themselves
      // rather than the dab count — that count saturates at the cap and stops being evidence
      // there — and checked here rather than after planning, because a plan whose result is
      // discarded is pure cost.
      const unchanged = sameNumberSeries(flatPoints, active.paintedOilPoints)
        && sameNumberSeries(element.pressures, active.paintedOilPressures);
      if (target === this.activeContext && unchanged) return true;

      const brush = element.brush ?? "oil";
      const planInput = {
        points: flatPoints,
        pressures: element.pressures,
        baseWidth: Math.max(1, element.strokeWidth),
        seed: fxBrushSeedFromKey(element.id),
        maxDabs: FX_OIL_DAB_CAP,
        ...studioOilFamilyPlanFields(brush),
      };
      // Same values either way: the planner re-derives the station lattice and reuses only the
      // prefix it has verified byte-equal, so a growing stroke stops rebuilding 4096 stations x
      // 7-44 bristles per pointer move.
      const dabs = active.oilPlanner
        ? active.oilPlanner.plan(planInput)
        : planOilBrushDabs(planInput);
      if (dabs.length === 0) return true;
      // There is no second "nothing changed" test here, and there must not be. This used to
      // return early when the new plan had the same dab count as the painted one, which is not
      // evidence of anything: the count saturates at `FX_OIL_DAB_CAP` while `sampleStations`
      // keeps refitting the lattice across the whole arc (that is what froze a long stroke's tip
      // on screen), and below the cap it is equally blind — a draft that corrects only pressures
      // keeps every station, so the count is unchanged while the dabs are not, and the retracted
      // pixels stayed on the canvas. The exact input comparison above already answers the
      // question, before the plan rather than after it, so anything that reaches this line has
      // inputs the canvas has not been painted from and is repainted.
      const radiusPx = extendOilRadiusMean(active, dabs);
      if (target === this.activeContext) {
        // The wet-mix readback that used to run here sampled and rewrote active-canvas pixels
        // immediately before this clear discarded them — pure per-frame getImageData stall with
        // zero surviving pixels. Wet-into-wet feel stays owned by the committed renderer.
        this.clearCanvas(this.activeContext, this.activeCanvas);
      }
      const programs = studioOilRibbonProgramsForBrush(
        brush,
        fxBrushSeedFromKey(element.id),
        element.brushEnginePrograms?.oil,
      );
      // The dab bed is already prefix-stable across a pointer move (`FxOilDabPlanner`); the
      // carrier was rebuilding its smoothed geometry, its stations and every bristle run on top
      // of it regardless — measured 14.6 ms per move at a 2906-dab bed, against 9.2 ms once the
      // settled prefix is kept. Same plan, so the painted pixels do not move.
      const carrier = active.oilCarrierPlanner
        ? active.oilCarrierPlanner.plan(dabs, programs)
        : planStudioOilRibbonCarrier(dabs, programs);
      paintStudioOilRibbonCarrier(
        context as unknown as StudioOilRibbonPaintContext,
        {
          carrier,
          stroke: element.stroke,
          opacity: element.opacity ?? 1,
          points: oilDabPoints(active, dabs),
          radiusPx,
          skipDestinationReadback: true,
        },
      );
      active.paintedDabs = dabs.length;
      if (target === this.activeContext) {
        active.paintedOilPasses += 1;
        active.paintedOilPoints = flatPoints;
        active.paintedOilPressures = element.pressures ? [...element.pressures] : null;
        // Measured from the start, but the cooldown runs from the END of the paint: charging it
        // from the start would hand back the paint's own duration and leave the bed taking half
        // the interval instead of the documented share.
        const finishedAt = this.now();
        active.lastOilRepaintMs = finishedAt - now;
        active.lastOilRepaintAt = finishedAt;
      }
      if (target === this.settledContext) this.settledHasPixels = true;
      return true;
    } finally {
      context.restore();
    }
  }

  private paintPencilSuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
    /** Pointer-up. Only then is the tip's round cap final and safe to lay down once. */
    finalize = false,
  ): boolean {
    const context = this.prepared(target);
    if (!context) return false;
    try {
      const rawPointCount = Math.floor(element.points.length / 2);
      if (rawPointCount === 0) return true;
      if (finiteCoordinate(element.points[0]) === null || finiteCoordinate(element.points[1]) === null) {
        return true;
      }
      const issue = (command: StudioLivePencilPaintCommand) => {
        paintStudioLivePencilProgram(context, [command]);
        if (target === this.activeContext) (active.pencilProgram ??= []).push(command);
      };
      const brush = element.brush ?? "pencil";
      const width = studioBrushAliasEffectiveDiameter(brush, Math.max(1, element.strokeWidth));
      const profile = resolveStudioRetainedMediaPressureProfileId(brush) ?? "pencil";
      // 이동한 획은 다시 탭이 될 수 없으므로(점은 append 전용), 선분을 이미 칠했다면 탭
      // 판정의 전점 스캔 O(n)을 건너뛴다 — 판정 결과는 그 경우 항상 null이다.
      const tap = active.paintedSourceSegments === 0
        ? planStudioRetainedMediaTapDab(
            flatFinitePoints(element),
            element.pressures,
            profile,
            { minimumDiameterRatio: element.materialMinimumDiameterRatio },
          )
        : null;
      if (tap && active.paintedSourceSegments === 0 && active.paintedPencilMarks === 0) {
        const scale = this.surface?.documentScale ?? 1;
        const liveDraft = target === this.activeContext && !finalize;
        context.globalCompositeOperation = "source-over";
        context.fillStyle = element.stroke;
        for (const pass of studioPencilAliasPasses(brush)) {
          const documentRadius = Math.max(
            0.35,
            Math.max(0.5, width * pass.widthScale) * tap.sizeScale / 2,
          );
          const radius = liveDraft
            ? studioLiveVisibleTapDocumentRadius(documentRadius, scale)
            : documentRadius;
          // The committed tap is a <Group opacity={element}> over a <KCircle opacity={material}>
          // and Konva multiplies the two, so the clamp sees the material term alone. Clamping
          // the product instead let a heavy-pressure tap (response above 1) paint darker live
          // than it commits whenever the element is translucent.
          issue({
            kind: "circle", x: tap.x, y: tap.y, radius, color: element.stroke,
            alpha: (element.opacity ?? 1)
              * Math.min(1, pass.opacityScale * Math.sqrt(tap.opacityScale * tap.flowScale)),
          });
        }
        active.paintedPencilMarks = 1;
        return true;
      }
      if (tap) return true;
      if (target === this.activeContext
        && active.paintedSourceSegments === 0 && active.paintedPencilMarks > 0) {
        // Pointerdown's visibility hint is not pigment. Retire it once travel begins,
        // otherwise it survives every append and disappears only on document replay.
        this.clearCanvas(this.activeContext, this.activeCanvas);
        active.pencilProgram = [];
        active.paintedPencilMarks = 0;
      }

      // 증분 곡선 빌더 + suffix 리본: 매 이동 전체 곡선·리본을 다시 세우던 O(n)/이동을 새 점
      // 수에만 비례하게 만든다. 리본은 이미 칠한 선분 경계부터의 suffix만 계획한다 — 아래
      // 셀 필터·start 캡 스킵과 같은 경계 규약이라 칠해지는 픽셀은 종전과 같다.
      // 커밋 렌더러와 같은 별칭 패스를 돈다. 예전에는 여기서 패스를 무시하고 기본 폭 리본
      // 하나만 칠했고, 그래서 화가가 그리는 동안 본 것과 손을 뗀 결과가 달랐다 — 측면 음영은
      // 라이브에서 평범한 연필이었다가 릴리스에서 넓고 옅은 치마가 생겼다(실측 14px→24px,
      // 농도 95→32). 패스 목록과 지터는 studio-pencil-alias-passes 가 두 렌더러에 공급한다.
      const passes = studioPencilAliasPasses(brush);
      const curves = active.pencilCurves ??= [];
      const startSegment = active.paintedSourceSegments === 0
        ? 0
        : Math.max(0, active.paintedSourceSegments - 1);
      const passPlans = passes.map((pass, passIndex) => {
        const builder = curves[passIndex]
          ??= createStudioIncrementalRetainedMediaCurveBuilder(
            profile,
            { minimumDiameterRatio: element.materialMinimumDiameterRatio },
          );
        const passCurve = builder.append(
          studioPencilAliasPassPoints(element.points, pass.jitterRadius),
          element.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
            ? element.pressures
            : undefined,
        );
        return {
          pass,
          curve: passCurve,
          ribbon: planStudioRetainedMediaRibbon(
            startSegment === 0
              ? passCurve
              : { ...passCurve, segments: passCurve.segments.slice(startSegment) },
            Math.max(0.5, width * pass.widthScale),
          ),
        };
      });
      const curve = passPlans[0]!.curve;
      // 커밋 렌더러와 같은 알파 사다리로 묶어 **버킷당 한 번** 칠한다. 셀을 하나씩 칠하면
      // 겹치는 셀끼리 다시 합성돼 라이브가 커밋보다 진해졌다(실측: 같은 커버리지에서 농도
      // 88.1 vs 71.7). 한 번의 fill 안에서 겹침은 합집합이다.
      const buckets = new Map<number, number[]>();
      const collectMark = (
        points: readonly number[],
        opacityScale: number,
        flowScale: number,
        passOpacityScale: number,
      ) => {
        if (points.length < 6) return;
        // Bucket the material term alone. The committed renderer (StudioDrawNode) quantizes
        // pass × pressure response and lets Konva apply the element opacity through the Shape's
        // globalAlpha afterwards. Folding the opacity in first moved every cell to a different
        // rung and, at low opacity, rounded a translucent skirt's cells into the empty bucket.
        const alpha = Math.min(1, passOpacityScale * Math.sqrt(opacityScale * flowScale));
        const rung = studioPencilRibbonAlphaBucket(alpha);
        if (rung === 0) return;
        let bucket = buckets.get(rung);
        if (!bucket) {
          bucket = [];
          buckets.set(rung, bucket);
        }
        for (let index = 0; index < points.length; index += 1) {
          bucket.push(points[index]!);
        }
        bucket.push(Number.NaN);
      };
      const flushBuckets = (inherited: number) => {
        for (const [rung, coords] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
          issue({
            kind: "fill", coordinates: coords, color: element.stroke,
            alpha: inherited * (element.opacity ?? 1)
              * (rung / STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT),
          });
        }
        buckets.clear();
      };
      context.fillStyle = element.stroke;
      context.strokeStyle = element.stroke;
      const inherited = context.globalAlpha;
      // 계획은 startSegment(이미 칠한 마지막 구간)부터 세워 조인 연속성을 얻지만, 칠하기는
      // **아직 칠하지 않은 구간만** 한다. 예전에는 경계 구간을 매 프레임 다시 칠해서 그 구간의
      // 알파가 1-(1-a)^2 로 쌓였고, 그래서 라이브가 커밋보다 진하고 두꺼웠다(실측: 연필 라이브
      // 2911px/86.3 vs 커밋 2298px/70.0). 한 셀은 정확히 한 번만 칠한다.
      const paintFromSegment = active.paintedSourceSegments;
      let paintedCells = 0;
      for (const { pass, ribbon } of passPlans) {
        let passCells = 0;
        for (const run of ribbon.runs) {
          for (const cell of run.cells) {
            if (cell.sourceSegmentIndex < paintFromSegment) continue;
            collectMark(cell.points, cell.opacityScale, cell.flowScale, pass.opacityScale);
            passCells += 1;
          }
          for (const cap of run.caps) {
            if (cap.role === "start" && active.paintedSourceSegments > 0) continue;
            // 끝 캡은 손을 뗄 때 한 번만. 그리는 동안 매 프레임 찍으면 자라나는 팁마다 캡이
            // 하나씩 남아 경로 전체에 알파가 겹겹이 쌓였다 — 라이브가 커밋보다 진해 보이던
            // 나머지 절반이다. 움직이는 팁의 뭉툭한 끝은 다음 프레임이 곧 덮는다.
            if (cap.role === "end" && !finalize) continue;
            collectMark(cap.points, cap.opacityScale, cap.flowScale, pass.opacityScale);
          }
        }
        // Soft-edge shells share alpha rungs but are distinct pigment layers: the committed
        // renderer opens a fresh ladder per pass, so union only WITHIN a pass. Unioning the
        // shells together erased the graded shading a skirt exists to add.
        flushBuckets(inherited);
        paintedCells = Math.max(paintedCells, passCells);
      }
      // 원시 꼬리 폴리라인: 검증된 점 개수는 곡선 빌더가 이미 알고 있으므로(sourcePointCount)
      // 점 배열을 다시 스캔하지 않고 suffix 인덱스만 직접 읽는다.
      // 꼬리 폴리라인은 **곡선이 아직 세그먼트로 만들지 못한 원시 점들만** 잇는다. 예전에는
      // 이미 칠한 구간 번호부터 이었는데, 그 구간들은 방금 리본이 칠한 자리와 같아서 매
      // 프레임 같은 자리에 전체 알파의 선을 한 번 더 그었다 — 라이브가 커밋보다 진하고
      // 두꺼워 보인 주된 이유다(실측: 연필 라이브 2911px/86.2 vs 커밋 2370px/71.0).
      const validPointCount = curve.sourcePointCount;
      if (validPointCount >= 2) {
        const from = Math.min(
          Math.max(0, curve.segments.length),
          validPointCount - 1,
        );
        if (from < validPointCount - 1) {
          const liveWidth = 2 * studioLiveVisibleTapDocumentRadius(
            Math.max(0.35, width / 2),
            this.surface?.documentScale ?? 1,
          );
          issue({
            kind: "stroke", color: element.stroke, width: liveWidth,
            alpha: inherited * Math.min(1, element.opacity ?? 1),
            coordinates: element.points.slice(from * 2, validPointCount * 2),
          });
        }
      }
      active.paintedSourceSegments = curve.segments.length;
      active.paintedPencilMarks = Math.max(active.paintedPencilMarks, paintedCells + 1);
      return true;
    } finally {
      context.restore();
    }
  }

  private paintCalligraphySuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
  ): boolean {
    const context = this.prepared(target);
    if (!context) return false;
    try {
      const rawPointCount = Math.floor(element.points.length / 2);
      if (rawPointCount === 0) return true;
      const firstX = finiteCoordinate(element.points[0]);
      const firstY = finiteCoordinate(element.points[1]);
      if (firstX === null || firstY === null) return true;
      const brush = element.brush ?? "calligraphy";
      const width = studioBrushAliasEffectiveDiameter(brush, Math.max(1, element.strokeWidth));
      if (rawPointCount === 1) {
        if (active.paintedSourceSegments > 0 || active.paintedPencilMarks > 0) return true;
        const radius = studioLiveVisibleTapDocumentRadius(
          Math.max(0.5, width * 0.18),
          this.surface?.documentScale ?? 1,
        );
        context.fillStyle = element.stroke;
        context.globalAlpha = Math.min(1, element.opacity ?? 1);
        context.beginPath();
        context.arc(firstX, firstY, radius, 0, Math.PI * 2);
        context.fill();
        // 탭은 아직 어떤 **구간도** 칠하지 않았다. 여기서 1을 세워 두면 아래 suffix 가
        // 첫 구간을 이미 칠한 것으로 오해하고 건너뛴다. 탭 재진입은 paintedPencilMarks 가
        // 막으므로 이 값은 0으로 남겨야 정확하다.
        active.paintedPencilMarks = 1;
        return true;
      }
      if (target === this.activeContext
        && active.paintedSourceSegments === 0 && active.paintedPencilMarks > 0) {
        this.clearCanvas(this.activeContext, this.activeCanvas);
        active.paintedPencilMarks = 0;
      }
      // 증분 빌더: 이동마다 전체 스트로크의 선분을 다시 세우던 O(n)/이동을 새 점 수에만
      // 비례하게 만든다. 필압·스타일러스는 나란한 인덱스별 접근자로 넘겨 배열 재구성
      // O(n)도 제거한다(빌더는 새 인덱스에서만 호출한다). 아래 suffix 리본과 짝을 이뤄
      // 이동당 비용이 스트로크 길이와 무관해진다.
      const builder = active.calligraphySegments
        ??= createStudioIncrementalCalligraphySegmentBuilder(
          width,
          resolveStudioCalligraphyRenderTip(brush, element.brushTip),
        );
      const { pressures, tiltXs, tiltYs, twists } = element;
      const segments = builder.append(
        element.points,
        (index) => mapStudioBrushAliasPressure(brush, pressures?.[index], 0.5),
        (index) => ({
          pointerType: "pen" as const,
          tiltX: tiltXs?.[index],
          tiltY: tiltYs?.[index],
          twist: twists?.[index],
        }),
      );
      // 아직 칠하지 않은 구간만 계획한다. 경계 구간을 다시 넣으면 그 구간이 프레임마다 한 번
      // 더 칠해져 반투명 획의 알파가 1-(1-a)^2 로 쌓였다 — 같은 파일의 연필 경로가 실측으로
      // 잡아낸 것과 같은 결함이다(라이브 86.3 vs 커밋 70.0). 다시 넣어도 조인이 더 덮이지도
      // 않는다: run 의 outline 은 구간별 커버리지 폴리곤의 합집합이고 각 구간이 자기 양 끝
      // nib 발자국을 이미 내므로, 경계의 앞 구간 몫은 직전 프레임이 이미 칠했다.
      const start = active.paintedSourceSegments;
      const ribbon = planStudioCalligraphyRibbon(segments.slice(start));
      context.fillStyle = element.stroke;
      context.globalAlpha = Math.min(1, element.opacity ?? 1);
      for (const run of ribbon.runs) this.fillOutline(context, run.outlinePoints);
      active.paintedSourceSegments = segments.length;
      active.paintedPencilMarks = Math.max(active.paintedPencilMarks, 1);
      return true;
    } finally {
      context.restore();
    }
  }

  private paintHighlighterSuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
  ): boolean {
    const ontoSettled = this.settledHasPixels && target === this.settledContext;
    const context = this.prepared(ontoSettled ? this.settledContext : target);
    if (!context) return false;
    try {
      const pairs = pairsFromElement(element);
      if (pairs.length === 0) return true;
      const brush = element.brush ?? "highlighter";
      const width = studioBrushAliasEffectiveDiameter(brush, Math.max(1, element.strokeWidth));
      const brushId = resolveStudioHighlighterWashBrushId(brush);
      if (target === this.activeContext) {
        this.clearCanvas(this.activeContext, this.activeCanvas);
      }
      const composite = ontoSettled ? "multiply" : "source-over";
      context.globalCompositeOperation = composite;
      context.fillStyle = element.stroke;
      if (pairs.length === 1) {
        const tap = planStudioHighlighterWashTap({
          brushId,
          x: pairs[0]!.x,
          y: pairs[0]!.y,
          width,
          opacityScale: element.opacity ?? 1,
        });
        context.globalAlpha = Math.min(1, (element.opacity ?? 1) * tap.opacityScale);
        context.beginPath();
        traceStudioHighlighterWashPlan(context, tap);
        context.fill();
        active.paintedPencilMarks = 1;
        active.paintedSourceSegments = 1;
        this.markSettledPaint(ontoSettled, context);
        return true;
      }
      const renderPath = resolveStudioFreehandRenderPath(flatPairs(pairs), {
        sampleSpacing: element.sampleSpacing,
        acceptedTension: 0.35,
        legacyMinDistance: strokeRenderDistance(element.sampleSpacing),
        legacyTension: 0.35,
      });
      // 획별 증분 빌더 쌍: 압력 경로와 워시 리본이 안정 prefix 를 유지해 append 가 새 표본
      // 수에만 비례한다(장획 게이트 family:highlighter). 콜드 1회 append 는 배치 플랜과 바이트
      // 동일하므로 settled 리플레이의 일회용 active 도 같은 경로를 그대로 쓴다.
      const fxBuilder = active.fxPressurePathBuilder
        ??= createStudioIncrementalFxPressurePathBuilder();
      const washBuilder = active.highlighterWashBuilder
        ??= createStudioIncrementalHighlighterWashRibbonBuilder();
      const pressurePath = fxBuilder.append({
        brushId: isStudioFxPressureBrushId(brush) ? brush : "highlighter",
        points: renderPath.points,
        pressures: element.pressures,
        pressureModel: element.materialPressureModel,
        minimumDiameterRatio: element.materialMinimumDiameterRatio,
        tension: renderPath.tension,
      });
      const wash = washBuilder.plan(
        { brushId, pressurePath, baseWidth: width },
        fxBuilder.stableSegmentCount(),
        fxBuilder.generation(),
      );
      const washAlpha = Math.min(1, (element.opacity ?? 1) * wash.opacityScale);
      context.globalAlpha = washAlpha;
      context.beginPath();
      traceStudioHighlighterWashPlan(context, wash);
      context.fill();
      if (wash.detailRuns.length > 0) {
        context.globalAlpha = washAlpha * wash.detailOpacityScale;
        context.beginPath();
        traceStudioHighlighterWashDetail(context, wash);
        context.fill();
      }
      active.paintedSourceSegments = pairs.length;
      active.paintedPencilMarks = Math.max(active.paintedPencilMarks, 1);
      this.markSettledPaint(ontoSettled, context);
      return true;
    } finally {
      context.restore();
    }
  }

  private paintEraserSuffix(
    active: ActiveRetainedStroke,
    element: DrawEl,
    target: CanvasRenderingContext2D | null,
  ): boolean {
    const context = this.prepared(target);
    if (!context) return false;
    try {
      const pairs = pairsFromElement(element);
      if (pairs.length === 0) return true;
      const width = Math.max(1, element.strokeWidth);
      const start = active.paintedSourceSegments === 0
        ? 0
        : Math.max(0, active.paintedSourceSegments - 1);
      paintStudioLiveRetainedRoundStroke(
        context,
        pairs,
        start,
        {
          stroke: "rgba(0,0,0,1)",
          width: Math.max(
            width,
            2 * studioLiveVisibleTapDocumentRadius(width / 2, this.surface?.documentScale ?? 1),
          ),
          opacity: 1,
          composite: "destination-out",
        },
      );
      active.paintedSourceSegments = pairs.length;
      active.paintedPencilMarks = Math.max(active.paintedPencilMarks, 1);
      return true;
    } finally {
      context.restore();
    }
  }

  private markSettledPaint(
    ontoSettled: boolean,
    context: CanvasRenderingContext2D,
  ): void {
    if (ontoSettled || context === this.settledContext) {
      this.settledHasPixels = true;
      this.activePaintedOntoSettled = true;
    }
  }

  private fillOutline(
    context: CanvasRenderingContext2D,
    points: readonly number[],
  ): void {
    const [firstX, firstY, ...rest] = points;
    if (firstX === undefined || firstY === undefined) return;
    context.beginPath();
    context.moveTo(firstX, firstY);
    for (let offset = 0; offset < rest.length; offset += 2) {
      const x = rest[offset];
      const y = rest[offset + 1];
      if (x === undefined || y === undefined) break;
      context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
  }

  private flattenActiveToSettled(): boolean {
    const context = this.settledContext;
    const canvas = this.activeCanvas;
    if (!context || !canvas) return false;
    try {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = this.active?.kind === "highlighter" && this.settledHasPixels
        ? "multiply"
        : "source-over";
      context.globalAlpha = 1;
      context.drawImage(canvas, 0, 0);
      context.restore();
      this.settledHasPixels = true;
      return true;
    } catch {
      return false;
    }
  }

  private replaySettledOnly(): void {
    this.clearCanvas(this.settledContext, this.settledCanvas);
    this.settledHasPixels = false;
    if (!this.isNativeSurfaceReady) return;
    for (const stroke of this.settled) {
      const kind = retainedKind(stroke);
      if (!kind) continue;
      const pencilProgram = this.settledPencilPrograms.get(stroke.id);
      if (kind === "pencil" && pencilProgram) {
        this.replayPencilProgram(pencilProgram, this.settledContext);
        this.settledHasPixels = pencilProgram.length > 0 || this.settledHasPixels;
        continue;
      }
      this.paintSuffix({
        id: stroke.id,
        kind,
        element: stroke,
        paintedDabs: 0,
        paintedOilPasses: 0,
        paintedOilPoints: null,
        paintedOilPressures: null,
        lastOilRepaintAt: 0,
        lastOilRepaintMs: 0,
        paintedPencilMarks: 0,
        paintedSourceSegments: 0,
        oilPlanner: null,
        oilCarrierPlanner: null,
      }, stroke, this.settledContext, true);
    }
  }

  private replay(): void {
    this.clearActiveRect();
    this.clearSettledRect();
    if (!this.isNativeSurfaceReady) return;
    for (const stroke of this.settled) {
      const kind = retainedKind(stroke);
      if (!kind) continue;
      const pencilProgram = this.settledPencilPrograms.get(stroke.id);
      if (kind === "pencil" && pencilProgram) {
        this.replayPencilProgram(pencilProgram, this.settledContext);
        this.settledHasPixels = pencilProgram.length > 0 || this.settledHasPixels;
        continue;
      }
      this.paintSuffix({
        id: stroke.id,
        kind,
        element: stroke,
        paintedDabs: 0,
        paintedOilPasses: 0,
        paintedOilPoints: null,
        paintedOilPressures: null,
        lastOilRepaintAt: 0,
        lastOilRepaintMs: 0,
        paintedPencilMarks: 0,
        paintedSourceSegments: 0,
        oilPlanner: null,
        oilCarrierPlanner: null,
      }, stroke, this.settledContext, true);
    }
    if (!this.active) return;
    if (this.active.kind === "pencil" && this.active.pencilProgram) {
      this.replayPencilProgram(this.active.pencilProgram, this.activeContext);
      return;
    }
    const replayActive: ActiveRetainedStroke = {
      ...this.active,
      paintedDabs: 0,
      paintedOilPasses: 0,
      paintedOilPoints: null,
      paintedOilPressures: null,
      lastOilRepaintAt: 0,
      lastOilRepaintMs: 0,
      paintedPencilMarks: 0,
      paintedSourceSegments: 0,
    };
    // A replay repaints from zero onto a cleared surface; it keeps the live planner so the next
    // append still reuses a verified prefix rather than paying a full replan for the resize.

    this.paintSuffix(replayActive, this.active.element, this.activeContext);
    this.active.paintedDabs = replayActive.paintedDabs;
    this.active.paintedOilPasses = replayActive.paintedOilPasses;
    this.active.paintedOilPoints = replayActive.paintedOilPoints;
    this.active.paintedOilPressures = replayActive.paintedOilPressures;
    // The replay just performed a full capped repaint; its cost is what the next append must
    // budget against, or a resize mid-stroke hands out a free rebuild.
    this.active.lastOilRepaintAt = replayActive.lastOilRepaintAt;
    this.active.lastOilRepaintMs = replayActive.lastOilRepaintMs;
    this.active.paintedPencilMarks = replayActive.paintedPencilMarks;
    this.active.paintedSourceSegments = replayActive.paintedSourceSegments;
  }

  private replayPencilProgram(
    commands: readonly StudioLivePencilPaintCommand[],
    target: CanvasRenderingContext2D | null,
  ): void {
    const context = this.prepared(target);
    if (!context) return;
    try {
      paintStudioLivePencilProgram(context, commands);
    } finally {
      context.restore();
    }
  }

  private prepared(
    context: CanvasRenderingContext2D | null,
  ): CanvasRenderingContext2D | null {
    const surface = this.surface;
    if (!context || !surface || !this.isNativeSurfaceReady) return null;
    const k = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -k,
        0,
        0,
        k,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr,
      );
    } else {
      context.setTransform(k, 0, 0, k, -surface.left * this.dpr, -surface.top * this.dpr);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalCompositeOperation = "source-over";
    return context;
  }

  private applySurface(): void {
    const surface = this.surface;
    const decision = surface
      ? decideStudioNativeLiveSurfaceResolution({
          cssWidth: surface.width,
          cssHeight: surface.height,
          devicePixelRatio: typeof globalThis.devicePixelRatio === "number"
            ? globalThis.devicePixelRatio
            : 1,
        })
      : null;
    this.resolutionDecision = decision;
    for (const canvas of [this.activeCanvas, this.settledCanvas]) {
      if (!canvas) continue;
      if (!decision || !decision.ok) {
        canvas.width = 1;
        canvas.height = 1;
        continue;
      }
      if (canvas.width !== decision.backingWidth) canvas.width = decision.backingWidth;
      if (canvas.height !== decision.backingHeight) canvas.height = decision.backingHeight;
    }
    this.dpr = decision?.ok ? decision.devicePixelRatio : 1;
    if (!decision?.ok && this.active) {
      // Canvas resizing may release pixels, but the accepted DrawEl remains intact until the host
      // explicitly cancels this operation or begins another one.
      this.lastFailureReason = "surface-unavailable";
    }
  }

  private failActive(
    reason: StudioLiveRetainedMediaFailureReason,
  ): StudioLiveRetainedMediaOperationFailure {
    this.lastFailureReason = reason;
    return retainedMediaOperationFailure(reason);
  }

  private resetActiveState(): void {
    this.clearCapRepaintWake();
    this.active = null;
    this.activePaintedOntoSettled = false;
  }

  private clearActiveRect(): void {
    this.clearCanvas(this.activeContext, this.activeCanvas);
  }

  private clearSettledRect(): void {
    this.settledHasPixels = false;
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
