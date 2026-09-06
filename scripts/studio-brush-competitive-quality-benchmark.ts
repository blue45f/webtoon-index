import {
  mapStudioBrushAliasPressureSamples,
  studioBrushAliasEffectiveDiameter,
} from "../apps/web/src/domains/creator/brush/studio-brush-alias-profile";
import {
  STUDIO_BRUSH_CATALOG_COUNTS,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog-core";
import {
  auditStudioBrushContinuity,
  type StudioBrushContinuityAuditResult,
  type StudioBrushContinuityRenderStrategy,
} from "../apps/web/src/domains/creator/brush/studio-brush-continuity-audit";
import {
  planNormalizedStudioDynamicBrushDabs,
  studioDynamicBrushDepositPipelineUsesContinuation,
  type StudioDynamicBrushDab,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import {
  profileStudioBrushMaterialResponse,
} from "../apps/web/src/domains/creator/brush/studio-brush-material-response";
import {
  type StudioBrushPlannerQualityCandidate,
} from "../apps/web/src/domains/creator/brush/studio-brush-planner-quality-audit";
import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  type StudioStampBrushDab,
} from "../apps/web/src/domains/creator/brush/studio-brush-stamp-engine";
import {
  planStudioCalligraphyRibbon,
} from "../apps/web/src/domains/creator/brush/studio-calligraphy-ribbon";
import {
  buildCalligraphySegments,
} from "../apps/web/src/domains/creator/studio-brush";
import {
  appendStudioCausalDynamicBrushDepositsV2,
  appendStudioCausalDynamicBrushDepositsV3,
  beginStudioCausalDynamicBrushDepositV2,
  beginStudioCausalDynamicBrushDepositV3,
  planStudioCausalDynamicBrushDepositsV2,
  planStudioCausalDynamicBrushDepositsV3,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_TOTAL_DABS,
  type StudioCausalDynamicBrushSampleV2,
} from "../apps/web/src/domains/creator/studio-causal-dynamic-brush-deposit-v2";
import {
  captureStudioOutlineStrokeContractV1,
  planStudioPerfectFreehandRender,
} from "../apps/web/src/domains/creator/studio-outline-stroke-contract";
import {
  peekStudioPerfectFreehandStroker,
} from "../apps/web/src/domains/creator/studio-perfect-freehand";

export const STUDIO_COMPETITIVE_BRUSH_QUALITY_SCHEMA_VERSION = 1 as const;
export const STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ = [60, 120, 240] as const;
export const STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR = 5_001 as const;
export const STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT = 97 as const;
export const STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX = 192 as const;

const LONG_STROKE_DURATION_MS = (STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR - 1)
  / 240 * 1_000;
const LONG_STROKE_WIDTH = 3_200;
const LONG_STROKE_HEIGHT = 720;
const DEFAULT_EXPECTED_PRESET_COUNT = STUDIO_BRUSH_CATALOG_COUNTS.total;
const QUALITY_SEED = 0x71ac_4e2d;
const VISIBLE_JOINT_GAP_RATIO = 0.8;
const STRICT_CARRIER_GAP_RATIO = 1;
const WARNING_TURN_RADIANS = 1.15;
const ERROR_TURN_RADIANS = 2.6;
const WARNING_RATE_DENSITY_SPAN = 2.5;
const ERROR_RATE_DENSITY_SPAN = 5;
const PRESSURE_RESPONSE_RATIO_FLOOR = 1.03;
const PRESSURE_RENDERER_PROBE_LOW = 0.15;
const PRESSURE_RENDERER_PROBE_HIGH = 0.9;
const PRESSURE_RENDERER_PROBE_START_X = 32;
const PRESSURE_RENDERER_PROBE_END_X = PRESSURE_RENDERER_PROBE_START_X
  + STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX;
const PRESSURE_RENDERER_PROBE_Y = 96;
const FOUR_K_WIDTH = 3_840;
const FOUR_K_HEIGHT = 2_160;
const RGBA_BYTES_PER_PIXEL = 4;
const HEAP_WARNING_BYTES = 512 * 1024 * 1024;

export type StudioCompetitiveBrushQualityTier = "ci" | "deep";
export type StudioCompetitiveBrushQualityStatus = "fail" | "pass" | "waived";
export type StudioCompetitiveBrushQualityFindingLevel =
  | "error"
  | "warning"
  | "waiver";

export interface StudioCompetitiveBrushQualityCandidate
  extends StudioBrushPlannerQualityCandidate {
  readonly source?: "core" | "pro";
}

export interface StudioCompetitiveBrushQualityClassification {
  readonly catalogId: string;
  readonly renderStrategy: StudioBrushContinuityRenderStrategy;
  readonly renderFamily: StudioBrushContinuityAuditResult["renderFamily"];
  readonly intentionalDiscontinuity: boolean;
}

export interface StudioCompetitiveBrushQualityFinding {
  readonly level: StudioCompetitiveBrushQualityFindingLevel;
  readonly code:
    | "carrier-gap"
    | "curvature-spike"
    | "dab-joint-exposure"
    | "heap-proxy-high"
    | "live-commit-geometry-drift"
    | "optical-crossing-loss"
    | "planner-cap"
    | "planner-failure"
    | "pressure-response-flat"
    | "rate-density-collapse";
  readonly reason: string;
  readonly metric?: string;
  readonly actual?: number | boolean | string | null;
  readonly limit?: number | boolean | string | null;
}

export interface StudioCompetitiveBrushCadenceMetrics {
  readonly rateHz: (typeof STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ)[number];
  readonly sourceSampleCount: number;
  readonly pathLengthPx: number;
  readonly markCount: number;
  readonly markDensityPerKilopixel: number;
  readonly plannerCapped: boolean;
  readonly runtimeMs: number;
  readonly runtimeMicrosecondsPerSample: number;
  readonly runtimeMicrosecondsPerMark: number;
  readonly maxCarrierGapRatio: number;
  readonly p95CarrierGapRatio: number;
  readonly exposedJointCount: number;
  readonly exposedJointRatio: number;
  /** Pigment-mark ordering, including deliberate scatter used for grain and fibre texture. */
  readonly maxTangentTurnRadians: number;
  readonly p95TangentTurnRadians: number;
  readonly curvatureSpikeRatio: number;
  /** Unscattered source carrier used to detect actual centreline/ribbon kinks. */
  readonly maxCarrierTangentTurnRadians: number;
  readonly p95CarrierTangentTurnRadians: number;
  readonly carrierCurvatureSpikeRatio: number;
  readonly liveCommitGeometryExact: boolean;
}

export interface StudioCompetitiveBrushPressureMetrics {
  readonly expected: boolean;
  /** The production geometry boundary used by the pressure oracle. */
  readonly measurementSource:
    | "planner-marks"
    | "perfect-outline-cpu"
    | "calligraphy-ribbon-cpu";
  readonly lowMeanDiameter: number;
  readonly highMeanDiameter: number;
  readonly diameterResponseRatio: number;
  readonly lowMeanDeposition: number;
  readonly highMeanDeposition: number;
  readonly depositionResponseRatio: number;
  /** Filled outline area, or the ribbon's projected width integral, in document px². */
  readonly lowInkMass: number;
  readonly highInkMass: number;
  readonly inkMassResponseRatio: number;
  /** Rendered width inside the terminal/taper region, before the endpoint cap. */
  readonly lowTerminalDiameter: number;
  readonly highTerminalDiameter: number;
  readonly terminalDiameterResponseRatio: number;
  readonly lowTerminalToBodyRatio: number;
  readonly highTerminalToBodyRatio: number;
  /** The actual live/commit pure renderer was planned twice and compared byte-for-byte. */
  readonly liveCommitGeometryExact: boolean;
}

export interface StudioCompetitiveBrushCrossingMetrics {
  readonly available: boolean;
  readonly overlap1Alpha: number | null;
  readonly overlap4Alpha: number | null;
  readonly overlap16Alpha: number | null;
  readonly alphaLossRatio: number | null;
  readonly preventedDarkeningAt16: number | null;
}

export interface StudioCompetitiveBrushResourceProxy {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly devicePixelRatio: 1 | 2;
  readonly fullSurfaceBytes: number;
  readonly estimatedDirtyPixels: number;
  readonly estimatedUploadBytes: number;
  readonly estimatedMarkFootprintPixels: number;
  readonly inputBufferBytes: number;
  readonly markObjectBytes: number;
  readonly estimatedPeakWorkingSetBytes: number;
  readonly allocationObjectProxy: number;
}

export interface StudioCompetitiveBrushQualityResult {
  readonly catalogId: string;
  readonly catalogName: string;
  readonly source: "core" | "pro";
  readonly category: string | null;
  readonly runtimeBrushId: string;
  readonly renderStrategy: StudioBrushContinuityRenderStrategy;
  readonly renderFamily: StudioBrushContinuityAuditResult["renderFamily"];
  readonly intentionalDiscontinuity: boolean;
  readonly representativeGroup: string;
  readonly representative: boolean;
  readonly cadence: readonly StudioCompetitiveBrushCadenceMetrics[];
  readonly rateDensitySpan: number | null;
  readonly pressure: StudioCompetitiveBrushPressureMetrics | null;
  readonly crossing: StudioCompetitiveBrushCrossingMetrics | null;
  readonly resourceProxy4k: Readonly<{
    dpr1: StudioCompetitiveBrushResourceProxy;
    dpr2: StudioCompetitiveBrushResourceProxy;
  }> | null;
  readonly findings: readonly StudioCompetitiveBrushQualityFinding[];
  readonly status: StudioCompetitiveBrushQualityStatus;
}

export interface StudioCompetitiveBrushExternalGate {
  readonly id:
    | "browser-frame-pacing"
    | "browser-heap-gc"
    | "pixel-crossing-color"
    | "pixel-live-commit-parity";
  readonly status: "required" | "waived";
  readonly reason: string;
  readonly command: string;
}

export interface StudioCompetitiveBrushQualityReport {
  readonly kind: "toonspectrum-studio-competitive-brush-quality";
  readonly schemaVersion: typeof STUDIO_COMPETITIVE_BRUSH_QUALITY_SCHEMA_VERSION;
  readonly tier: StudioCompetitiveBrushQualityTier;
  readonly policy: Readonly<{
    expectedPresetCount: number;
    inputRatesHz: typeof STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ;
    longSampleFloor: typeof STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR;
    strictCarrierGapRatio: number;
    visibleJointGapRatio: number;
    warningTurnRadians: number;
    errorTurnRadians: number;
    warningRateDensitySpan: number;
    errorRateDensitySpan: number;
    pressureResponseRatioFloor: number;
  }>;
  readonly catalogue: readonly Readonly<{
    catalogId: string;
    source: "core" | "pro";
    renderStrategy: StudioBrushContinuityRenderStrategy;
    renderFamily: StudioBrushContinuityAuditResult["renderFamily"];
    intentionalDiscontinuity: boolean;
    representativeGroup: string;
    representative: boolean;
  }>[];
  readonly results: readonly StudioCompetitiveBrushQualityResult[];
  readonly externalGates: readonly StudioCompetitiveBrushExternalGate[];
  readonly summary: Readonly<{
    catalogueCount: number;
    representativeCount: number;
    measuredCount: number;
    errorCount: number;
    warningCount: number;
    waiverCount: number;
    maximumSourceSampleCount: number;
    maximumRuntimeMs: number;
    maximumCarrierGapRatio: number;
    maximumExposedJointRatio: number;
    maximumEstimatedPeakWorkingSetBytes: number;
  }>;
  readonly ok: boolean;
}

export interface StudioCompetitiveBrushQualityOptions {
  readonly tier?: StudioCompetitiveBrushQualityTier;
  readonly expectedPresetCount?: number;
  readonly classifications?: readonly StudioCompetitiveBrushQualityClassification[];
}

interface LongRoute {
  readonly points: readonly number[];
  readonly pressures: readonly number[];
  readonly tangentialPressures: readonly number[];
  readonly speeds: readonly number[];
  readonly tiltXs: readonly number[];
  readonly tiltYs: readonly number[];
  readonly twists: readonly number[];
  readonly samples: readonly StudioCausalDynamicBrushSampleV2[];
  readonly pathLengthPx: number;
}

interface GenericMark {
  readonly x: number;
  readonly y: number;
  /** Exact unscattered path station; pigment x/y may retain intentional material scatter. */
  readonly carrierX: number;
  readonly carrierY: number;
  readonly diameter: number;
  readonly alpha: number;
  readonly roundness: number;
}

interface PlannedMarks {
  readonly marks: readonly GenericMark[];
  readonly exactReplayMarks: readonly GenericMark[];
  readonly capped: boolean;
  readonly failure: string | null;
}

function freezeLongRoute(route: LongRoute): LongRoute {
  for (const sample of route.samples) Object.freeze(sample);
  Object.freeze(route.points);
  Object.freeze(route.pressures);
  Object.freeze(route.tangentialPressures);
  Object.freeze(route.speeds);
  Object.freeze(route.tiltXs);
  Object.freeze(route.tiltYs);
  Object.freeze(route.twists);
  Object.freeze(route.samples);
  return Object.freeze(route);
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number, digits = 6): number {
  const multiplier = 10 ** digits;
  return Math.round(finite(value) * multiplier) / multiplier;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(
    Math.ceil(sorted.length * clamp(quantile, 0, 1)) - 1,
    0,
    sorted.length - 1,
  );
  return sorted[index] ?? 0;
}

function safeRatio(numerator: number, denominator: number, fallback = 0): number {
  return denominator > 0 ? numerator / denominator : fallback;
}

function sourceOf(candidate: StudioCompetitiveBrushQualityCandidate): "core" | "pro" {
  if (candidate.source) return candidate.source;
  return candidate.category ? "pro" : "core";
}

function buildLongRoute(
  rateHz: (typeof STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ)[number],
  pressureOverride?: number,
): LongRoute {
  const sourceSampleCount = Math.round(LONG_STROKE_DURATION_MS * rateHz / 1_000) + 1;
  const points: number[] = [];
  const pressures: number[] = [];
  const tangentialPressures: number[] = [];
  const speeds: number[] = [];
  const tiltXs: number[] = [];
  const tiltYs: number[] = [];
  const twists: number[] = [];
  const samples: StudioCausalDynamicBrushSampleV2[] = [];
  let pathLengthPx = 0;
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < sourceSampleCount; index += 1) {
    const progress = sourceSampleCount <= 1 ? 0 : index / (sourceSampleCount - 1);
    const x = 48 + progress * LONG_STROKE_WIDTH;
    const y = LONG_STROKE_HEIGHT / 2
      + Math.sin(progress * Math.PI * 8) * 170
      + Math.sin(progress * Math.PI * 30) * 18;
    const pressure = pressureOverride ?? clamp(
      0.18
        + Math.pow(0.5 + Math.sin(progress * Math.PI * 5 - Math.PI / 2) / 2, 0.72)
          * 0.8,
      0,
      1,
    );
    const distance = index === 0 ? 0 : Math.hypot(x - previousX, y - previousY);
    const speed = distance / Math.max(0.001, 1_000 / rateHz);
    const tangentialPressure = Math.sin(progress * Math.PI * 4) * 0.25;
    const tiltX = Math.sin(progress * Math.PI * 2) * 35;
    const tiltY = Math.cos(progress * Math.PI * 2) * 25;
    const twist = (progress * 270) % 360;
    points.push(x, y);
    pressures.push(pressure);
    tangentialPressures.push(tangentialPressure);
    speeds.push(speed);
    tiltXs.push(tiltX);
    tiltYs.push(tiltY);
    twists.push(twist);
    samples.push({
      x,
      y,
      pressure,
      tangentialPressure,
      speed,
      tiltX,
      tiltY,
      twist,
    });
    pathLengthPx += distance;
    previousX = x;
    previousY = y;
  }
  return freezeLongRoute({
    points,
    pressures,
    tangentialPressures,
    speeds,
    tiltXs,
    tiltYs,
    twists,
    samples,
    pathLengthPx,
  });
}

function dynamicMarks(dabs: readonly StudioDynamicBrushDab[]): GenericMark[] {
  return dabs.map((dab) => ({
    x: dab.x,
    y: dab.y,
    carrierX: dab.sourceX,
    carrierY: dab.sourceY,
    diameter: Math.max(0.05, dab.size),
    alpha: clamp(dab.opacity * dab.flow, 0, 1),
    roundness: clamp(dab.roundness, 0.08, 1),
  }));
}

function stampMarks(dabs: readonly StudioStampBrushDab[]): GenericMark[] {
  return dabs.map((dab) => ({
    x: dab.x,
    y: dab.y,
    carrierX: dab.x,
    carrierY: dab.y,
    diameter: Math.max(0.05, dab.radius * 2),
    alpha: clamp(dab.alpha, 0, 1),
    roundness: 1,
  }));
}

function connectedMarks(
  candidate: StudioCompetitiveBrushQualityCandidate,
  route: LongRoute,
): GenericMark[] {
  return route.points.reduce<GenericMark[]>((marks, value, index) => {
    if (index % 2 === 0) {
      marks.push({
        x: value,
        y: route.points[index + 1] ?? 0,
        carrierX: value,
        carrierY: route.points[index + 1] ?? 0,
        diameter: Math.max(0.05, candidate.defaultWidth),
        alpha: clamp(candidate.defaultOpacity, 0, 1),
        roundness: 1,
      });
    }
    return marks;
  }, []);
}

function marksExactlyEqual(
  left: readonly GenericMark[],
  right: readonly GenericMark[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      !Object.is(a.x, b.x)
      || !Object.is(a.y, b.y)
      || !Object.is(a.carrierX, b.carrierX)
      || !Object.is(a.carrierY, b.carrierY)
      || !Object.is(a.diameter, b.diameter)
      || !Object.is(a.alpha, b.alpha)
      || !Object.is(a.roundness, b.roundness)
    ) return false;
  }
  return true;
}

function incrementalCausalDynamicMarks(
  candidate: StudioCompetitiveBrushQualityCandidate,
  route: LongRoute,
): Readonly<{ marks: readonly GenericMark[]; capped: boolean; failure: string | null }> {
  const settings = candidate.brushDynamics;
  const first = route.samples[0];
  if (!settings || !first) return { marks: [], capped: false, failure: "missing-input" };
  const usesV3 = studioDynamicBrushDepositPipelineUsesContinuation(settings.depositPipeline);
  const begun = usesV3
    ? beginStudioCausalDynamicBrushDepositV3(
        first,
        settings,
        STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_TOTAL_DABS,
      )
    : beginStudioCausalDynamicBrushDepositV2(
        first,
        settings,
        STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
      );
  if (!begun.ok) return { marks: [], capped: false, failure: begun.reason };
  const dabs: StudioDynamicBrushDab[] = [begun.dab];
  let capped = false;
  let state = begun.state;
  const chunkSize = 37;
  for (let offset = 1; offset < route.samples.length; offset += chunkSize) {
    const chunk = route.samples.slice(offset, offset + chunkSize);
    const appended = usesV3
      ? appendStudioCausalDynamicBrushDepositsV3(
          state as Parameters<typeof appendStudioCausalDynamicBrushDepositsV3>[0],
          chunk,
          settings,
        )
      : appendStudioCausalDynamicBrushDepositsV2(
          state as Parameters<typeof appendStudioCausalDynamicBrushDepositsV2>[0],
          chunk,
          settings,
        );
    if (!appended.ok) {
      return { marks: dynamicMarks(dabs), capped, failure: appended.reason };
    }
    if (appended.replaceInitialTap) dabs.splice(0, 1, ...appended.dabs);
    else dabs.push(...appended.dabs);
    capped ||= appended.dabCapped;
    state = appended.state;
  }
  return { marks: dynamicMarks(dabs), capped, failure: null };
}

function planCandidateMarks(
  candidate: StudioCompetitiveBrushQualityCandidate,
  classification: StudioCompetitiveBrushQualityClassification,
  route: LongRoute,
): PlannedMarks {
  if (candidate.brushDynamics) {
    if (candidate.brushDynamics.depositPipeline) {
      const usesV3 = studioDynamicBrushDepositPipelineUsesContinuation(
        candidate.brushDynamics.depositPipeline,
      );
      const input = {
        points: route.points,
        pressures: route.pressures,
        tangentialPressures: route.tangentialPressures,
        speeds: route.speeds,
        tiltXs: route.tiltXs,
        tiltYs: route.tiltYs,
        twists: route.twists,
        settings: candidate.brushDynamics,
        maximumDabs: usesV3
          ? STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_TOTAL_DABS
          : STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
      };
      const committed = usesV3
        ? planStudioCausalDynamicBrushDepositsV3(input)
        : planStudioCausalDynamicBrushDepositsV2(input);
      const live = incrementalCausalDynamicMarks(candidate, route);
      if (!committed.ok) {
        return {
          marks: [],
          exactReplayMarks: live.marks,
          capped: live.capped,
          failure: `commit:${committed.reason}`,
        };
      }
      return {
        marks: dynamicMarks(committed.dabs),
        exactReplayMarks: live.marks,
        capped: committed.dabCapped || live.capped,
        failure: live.failure,
      };
    }
    const input = {
      points: route.points,
      pressures: route.pressures,
      speeds: route.speeds,
      baseWidth: candidate.defaultWidth,
      baseOpacity: 1,
      seed: QUALITY_SEED,
      maxDabs: 65_536,
    };
    const committed = dynamicMarks(planNormalizedStudioDynamicBrushDabs(
      input,
      candidate.brushDynamics,
    ));
    const replay = dynamicMarks(planNormalizedStudioDynamicBrushDabs(
      input,
      candidate.brushDynamics,
    ));
    return {
      marks: committed,
      exactReplayMarks: replay,
      capped: committed.length >= input.maxDabs,
      failure: null,
    };
  }
  if (classification.renderStrategy === "stamp-dab") {
    const kind = resolveStudioStampBrushKind(candidate.runtimeBrushId);
    if (!kind) return { marks: [], exactReplayMarks: [], capped: false, failure: "stamp-kind" };
    const style = resolveStudioStampBrushStyle(kind, {
      color: "#111111",
      size: candidate.defaultWidth,
      opacity: candidate.defaultOpacity,
    });
    const committed = stampMarks(planStudioStampBrushDabs(
      style,
      route.points,
      route.pressures,
    ));
    const replay = stampMarks(planStudioStampBrushDabs(
      style,
      route.points,
      route.pressures,
    ));
    return {
      marks: committed,
      exactReplayMarks: replay,
      capped: committed.length >= 100_000,
      failure: null,
    };
  }
  const marks = connectedMarks(candidate, route);
  return { marks, exactReplayMarks: marks, capped: false, failure: null };
}

function carrierGapRatios(marks: readonly GenericMark[]): number[] {
  const ratios: number[] = [];
  const start = Math.max(1, Math.floor(marks.length * 0.03));
  const end = Math.min(marks.length, Math.ceil(marks.length * 0.97));
  for (let index = start; index < end; index += 1) {
    const current = marks[index]!;
    const previous = marks[index - 1]!;
    ratios.push(Math.hypot(
      current.carrierX - previous.carrierX,
      current.carrierY - previous.carrierY,
    )
      / Math.max(0.05, (current.diameter + previous.diameter) / 2));
  }
  return ratios;
}

function tangentTurns(
  marks: readonly GenericMark[],
  coordinate: "carrier" | "pigment",
): number[] {
  const turns: number[] = [];
  let previousAngle: number | null = null;
  for (let index = 1; index < marks.length; index += 1) {
    const previous = marks[index - 1]!;
    const current = marks[index]!;
    const dx = coordinate === "carrier"
      ? current.carrierX - previous.carrierX
      : current.x - previous.x;
    const dy = coordinate === "carrier"
      ? current.carrierY - previous.carrierY
      : current.y - previous.y;
    if (Math.hypot(dx, dy) <= 1e-6) continue;
    const angle = Math.atan2(dy, dx);
    if (previousAngle !== null) {
      let delta = Math.abs(angle - previousAngle);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      turns.push(delta);
    }
    previousAngle = angle;
  }
  return turns;
}

function cadenceMetrics(
  route: LongRoute,
  planned: PlannedMarks,
  renderStrategy: StudioBrushContinuityRenderStrategy,
  rateHz: (typeof STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ)[number],
  runtimeMs: number,
): StudioCompetitiveBrushCadenceMetrics {
  // Connected renderers fill the path between accepted samples. Treating each input point as a
  // circular dab would manufacture the exact beading defect this gate is meant to detect.
  const gaps = renderStrategy === "connected-path" || renderStrategy === "pixel-grid"
    ? []
    : carrierGapRatios(planned.marks);
  // Texture brushes deliberately scatter rendered pigment marks around the centreline. Measuring
  // those x/y offsets as if they were the carrier manufactured curvature spikes for dry media,
  // cloud airbrush and fibre sketch. The exact sourceX/sourceY receipt is the canonical ribbon
  // station shared by live and commit; retain both metrics so artistic scatter stays observable
  // without being mislabeled as a centreline kink.
  const pigmentTurns = tangentTurns(planned.marks, "pigment");
  const carrierTurns = tangentTurns(planned.marks, "carrier");
  const p95PigmentTurn = percentile(pigmentTurns, 0.95);
  const p95CarrierTurn = percentile(carrierTurns, 0.95);
  const exposedJointCount = gaps.filter((ratio) => ratio > VISIBLE_JOINT_GAP_RATIO).length;
  return {
    rateHz,
    sourceSampleCount: route.samples.length,
    pathLengthPx: rounded(route.pathLengthPx),
    markCount: planned.marks.length,
    markDensityPerKilopixel: rounded(
      safeRatio(planned.marks.length * 1_000, route.pathLengthPx),
    ),
    plannerCapped: planned.capped,
    runtimeMs: rounded(runtimeMs),
    runtimeMicrosecondsPerSample: rounded(
      safeRatio(runtimeMs * 1_000, route.samples.length),
    ),
    runtimeMicrosecondsPerMark: rounded(
      safeRatio(runtimeMs * 1_000, planned.marks.length),
    ),
    maxCarrierGapRatio: rounded(Math.max(0, ...gaps)),
    p95CarrierGapRatio: rounded(percentile(gaps, 0.95)),
    exposedJointCount,
    exposedJointRatio: rounded(safeRatio(exposedJointCount, gaps.length)),
    maxTangentTurnRadians: rounded(Math.max(0, ...pigmentTurns)),
    p95TangentTurnRadians: rounded(p95PigmentTurn),
    curvatureSpikeRatio: rounded(safeRatio(
      Math.max(0, ...pigmentTurns),
      p95PigmentTurn,
    )),
    maxCarrierTangentTurnRadians: rounded(Math.max(0, ...carrierTurns)),
    p95CarrierTangentTurnRadians: rounded(p95CarrierTurn),
    carrierCurvatureSpikeRatio: rounded(safeRatio(
      Math.max(0, ...carrierTurns),
      p95CarrierTurn,
    )),
    liveCommitGeometryExact: planned.failure === null
      && marksExactlyEqual(planned.marks, planned.exactReplayMarks),
  };
}

function pressureIsExpected(
  candidate: StudioCompetitiveBrushQualityCandidate,
): boolean {
  const settings = candidate.brushDynamics;
  if (!settings) {
    return candidate.runtimeBrushId === "gpen"
      || candidate.runtimeBrushId === "calligraphy"
      || candidate.runtimeBrushId === "perfect-ink";
  }
  return [
    settings.width,
    settings.opacity,
    settings.flow,
    settings.spacing,
    settings.scatter,
    settings.angle,
    settings.roundness,
  ].some((property) => property.mappings.some((mapping) => mapping.source === "pressure"));
}

interface StudioRendererPressureSample {
  readonly meanDiameter: number;
  readonly meanDeposition: number;
  readonly inkMass: number;
  readonly terminalDiameter: number;
  readonly terminalToBodyRatio: number;
  readonly liveCommitGeometryExact: boolean;
}

function pressureProbePoints(): number[] {
  return Array.from(
    { length: STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT },
    (_, pointIndex) => {
      const progress = pointIndex
        / (STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT - 1);
      return [
        PRESSURE_RENDERER_PROBE_START_X
          + (PRESSURE_RENDERER_PROBE_END_X - PRESSURE_RENDERER_PROBE_START_X) * progress,
        PRESSURE_RENDERER_PROBE_Y,
      ];
    },
  ).flat();
}

function constantPressureSamples(value: number): number[] {
  return Array.from(
    { length: STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT },
    () => value,
  );
}

/**
 * Pressure response is an orthogonal renderer probe, not another long-stroke cadence run.
 *
 * The previous benchmark replayed two additional 3,200 px routes per representative. That did
 * not add pressure evidence: constant-pressure planners produce the same response on this dense
 * 192 px route, while the extra thousands of dabs repeatedly decoded custom tips and amplified GC
 * contention in the four-worker CI suite. Keep the production planner and all low/high assertions,
 * but use the same 97-point physical probe already used by the outline and calligraphy oracles.
 */
function buildPlannerPressureProbeRoute(pressure: number): LongRoute {
  const points = pressureProbePoints();
  const pressures = constantPressureSamples(pressure);
  const sampleCount = STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT;
  const tangentialPressures = Array.from({ length: sampleCount }, () => 0);
  const tiltXs = Array.from({ length: sampleCount }, () => 0);
  const tiltYs = Array.from({ length: sampleCount }, () => 0);
  const twists = Array.from({ length: sampleCount }, () => 0);
  const speeds = Array.from({ length: sampleCount }, (_, index) => (
    index === 0
      ? 0
      : (STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX / (sampleCount - 1))
        / (1_000 / 240)
  ));
  const samples = Array.from({ length: sampleCount }, (_, index) => ({
    x: points[index * 2]!,
    y: points[index * 2 + 1]!,
    pressure: pressures[index]!,
    tangentialPressure: 0,
    speed: speeds[index]!,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
  }));
  return freezeLongRoute({
    points,
    pressures,
    tangentialPressures,
    speeds,
    tiltXs,
    tiltYs,
    twists,
    samples,
    pathLengthPx: STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX,
  });
}

function symmetricResponseRatio(low: number, high: number): number {
  return Math.max(
    safeRatio(high, low, 1),
    safeRatio(low, high, 1),
  );
}

function markInkMass(marks: readonly GenericMark[]): number {
  return marks.reduce((total, mark) => (
    total
    + Math.PI * (mark.diameter / 2) ** 2 * mark.roundness * mark.alpha
  ), 0);
}

function outlineArea(outline: readonly (readonly number[])[]): number {
  if (outline.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index]!;
    const next = outline[(index + 1) % outline.length]!;
    twiceArea += (current[0] ?? 0) * (next[1] ?? 0)
      - (next[0] ?? 0) * (current[1] ?? 0);
  }
  return Math.abs(twiceArea) / 2;
}

/** Width of the production outline polygon at one document-space x station. */
function outlineVerticalSpanAt(
  outline: readonly (readonly number[])[],
  x: number,
): number {
  const intersections: number[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index]!;
    const next = outline[(index + 1) % outline.length]!;
    const x0 = current[0] ?? 0;
    const y0 = current[1] ?? 0;
    const x1 = next[0] ?? 0;
    const y1 = next[1] ?? 0;
    if (x < Math.min(x0, x1) || x > Math.max(x0, x1)) continue;
    const deltaX = x1 - x0;
    if (Math.abs(deltaX) <= Number.EPSILON) {
      if (Math.abs(x - x0) <= Number.EPSILON) intersections.push(y0, y1);
      continue;
    }
    const progress = (x - x0) / deltaX;
    if (progress >= 0 && progress <= 1) {
      intersections.push(y0 + (y1 - y0) * progress);
    }
  }
  return intersections.length < 2
    ? 0
    : Math.max(...intersections) - Math.min(...intersections);
}

function perfectRendererPressureSample(
  candidate: StudioCompetitiveBrushQualityCandidate,
  pressure: number,
): StudioRendererPressureSample | null {
  const contract = captureStudioOutlineStrokeContractV1({
    brushId: candidate.runtimeBrushId,
    pressureSource: "recorded",
  });
  const stroker = peekStudioPerfectFreehandStroker();
  if (!contract || !stroker) return null;
  // This probe measures the perfect-freehand taper/thinning response; the croquis capsule
  // sibling branch (2026-08-13 wave 3) has no taper profile and is measured by its own suite.
  if (contract.engine !== "perfect-freehand-outline") return null;
  const points = pressureProbePoints();
  const pressures = constantPressureSamples(pressure);
  const planInput = {
    contract,
    stroker,
    points,
    pressures,
    strokeWidth: candidate.defaultWidth,
    // A finite spacing is the production new-stroke contract: the accepted centreline must not be
    // smoothed a second time during retained/live replay.
    sampleSpacing: 2,
  } as const;
  const live = planStudioPerfectFreehandRender(planInput);
  const commit = planStudioPerfectFreehandRender(planInput);
  if (live.kind !== "outline" || commit.kind !== "outline") return null;

  const bodyDiameter = mean([0.35, 0.5, 0.65].map((progress) => (
    outlineVerticalSpanAt(
      live.outline,
      PRESSURE_RENDERER_PROBE_START_X
        + (PRESSURE_RENDERER_PROBE_END_X - PRESSURE_RENDERER_PROBE_START_X) * progress,
    )
  )));
  const rendererDiameter = candidate.defaultWidth * contract.profile.diameterScale;
  const endTaperLength = rendererDiameter * contract.profile.taperEndFactor;
  const terminalStation = PRESSURE_RENDERER_PROBE_END_X - Math.max(
    rendererDiameter * 0.25,
    endTaperLength * 0.5,
  );
  const terminalDiameter = outlineVerticalSpanAt(live.outline, terminalStation);
  return {
    meanDiameter: bodyDiameter,
    meanDeposition: clamp(candidate.defaultOpacity, 0, 1),
    inkMass: outlineArea(live.outline) * clamp(candidate.defaultOpacity, 0, 1),
    terminalDiameter,
    terminalToBodyRatio: safeRatio(terminalDiameter, bodyDiameter, 1),
    liveCommitGeometryExact: live.pathData === commit.pathData,
  };
}

function calligraphyProjectedInkMass(
  segments: ReturnType<typeof buildCalligraphySegments>,
): number {
  if (segments.length === 0) return 0;
  const bodyArea = segments.reduce((total, segment) => (
    total + segment.width * Math.hypot(
      segment.x1 - segment.x0,
      segment.y1 - segment.y0,
    )
  ), 0);
  const first = segments[0]!;
  const travelAngle = Math.atan2(first.y1 - first.y0, first.x1 - first.x0);
  const relativeTravelAngle = travelAngle - first.tipAngleRad;
  const projection = Math.sqrt(
    Math.sin(relativeTravelAngle) ** 2
      + first.roundness ** 2 * Math.cos(relativeTravelAngle) ** 2,
  );
  const majorRadius = first.width / 2 / Math.max(
    first.roundness,
    projection,
    Number.EPSILON,
  );
  const terminalFootprintArea = Math.PI * majorRadius * majorRadius * first.roundness;
  // For a straight constant-pressure route, the actual swept flat-nib union is exactly the
  // projected-width integral plus one terminal footprint (Minkowski sweep area).
  return bodyArea + terminalFootprintArea;
}

function calligraphyRendererPressureSample(
  candidate: StudioCompetitiveBrushQualityCandidate,
  pressure: number,
): StudioRendererPressureSample | null {
  const points = pressureProbePoints();
  const pressures = mapStudioBrushAliasPressureSamples(
    candidate.runtimeBrushId,
    constantPressureSamples(pressure),
    STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT,
    0.5,
  );
  const diameter = studioBrushAliasEffectiveDiameter(
    candidate.runtimeBrushId,
    candidate.defaultWidth,
  );
  const liveSegments = buildCalligraphySegments(
    points,
    pressures,
    [],
    diameter,
    undefined,
  );
  const commitSegments = buildCalligraphySegments(
    points,
    pressures,
    [],
    diameter,
    undefined,
  );
  if (liveSegments.length === 0 || commitSegments.length === 0) return null;
  const liveRibbon = planStudioCalligraphyRibbon(liveSegments);
  const commitRibbon = planStudioCalligraphyRibbon(commitSegments);
  const meanDiameter = mean(liveSegments.map(({ width }) => width));
  const terminalDiameter = liveSegments.at(-1)?.width ?? 0;
  return {
    meanDiameter,
    meanDeposition: clamp(candidate.defaultOpacity, 0, 1),
    inkMass: calligraphyProjectedInkMass(liveSegments)
      * clamp(candidate.defaultOpacity, 0, 1),
    terminalDiameter,
    terminalToBodyRatio: safeRatio(terminalDiameter, meanDiameter, 1),
    // Both StudioDrawNode and SVG export consume these exact segment/ribbon arrays. Comparing the
    // serialized numeric receipt proves deterministic live/commit planning without a DOM shim.
    liveCommitGeometryExact:
      JSON.stringify(liveSegments) === JSON.stringify(commitSegments)
      && JSON.stringify(liveRibbon) === JSON.stringify(commitRibbon),
  };
}

function rendererPressureSamples(
  candidate: StudioCompetitiveBrushQualityCandidate,
  classification: StudioCompetitiveBrushQualityClassification,
): Readonly<{
  source: StudioCompetitiveBrushPressureMetrics["measurementSource"];
  low: StudioRendererPressureSample;
  high: StudioRendererPressureSample;
}> | null {
  const perfectLow = perfectRendererPressureSample(
    candidate,
    PRESSURE_RENDERER_PROBE_LOW,
  );
  const perfectHigh = perfectRendererPressureSample(
    candidate,
    PRESSURE_RENDERER_PROBE_HIGH,
  );
  if (perfectLow && perfectHigh) {
    return { source: "perfect-outline-cpu", low: perfectLow, high: perfectHigh };
  }
  if (classification.renderFamily !== "calligraphy") return null;
  const calligraphyLow = calligraphyRendererPressureSample(
    candidate,
    PRESSURE_RENDERER_PROBE_LOW,
  );
  const calligraphyHigh = calligraphyRendererPressureSample(
    candidate,
    PRESSURE_RENDERER_PROBE_HIGH,
  );
  return calligraphyLow && calligraphyHigh
    ? { source: "calligraphy-ribbon-cpu", low: calligraphyLow, high: calligraphyHigh }
    : null;
}

function pressureMetrics(
  candidate: StudioCompetitiveBrushQualityCandidate,
  classification: StudioCompetitiveBrushQualityClassification,
  pressureProbeRoutes: Readonly<{ low: LongRoute; high: LongRoute }>,
): StudioCompetitiveBrushPressureMetrics {
  const renderer = rendererPressureSamples(candidate, classification);
  if (renderer) {
    return {
      expected: pressureIsExpected(candidate),
      measurementSource: renderer.source,
      lowMeanDiameter: rounded(renderer.low.meanDiameter),
      highMeanDiameter: rounded(renderer.high.meanDiameter),
      diameterResponseRatio: rounded(symmetricResponseRatio(
        renderer.low.meanDiameter,
        renderer.high.meanDiameter,
      )),
      lowMeanDeposition: rounded(renderer.low.meanDeposition),
      highMeanDeposition: rounded(renderer.high.meanDeposition),
      depositionResponseRatio: rounded(symmetricResponseRatio(
        renderer.low.meanDeposition,
        renderer.high.meanDeposition,
      )),
      lowInkMass: rounded(renderer.low.inkMass),
      highInkMass: rounded(renderer.high.inkMass),
      inkMassResponseRatio: rounded(symmetricResponseRatio(
        renderer.low.inkMass,
        renderer.high.inkMass,
      )),
      lowTerminalDiameter: rounded(renderer.low.terminalDiameter),
      highTerminalDiameter: rounded(renderer.high.terminalDiameter),
      terminalDiameterResponseRatio: rounded(symmetricResponseRatio(
        renderer.low.terminalDiameter,
        renderer.high.terminalDiameter,
      )),
      lowTerminalToBodyRatio: rounded(renderer.low.terminalToBodyRatio),
      highTerminalToBodyRatio: rounded(renderer.high.terminalToBodyRatio),
      liveCommitGeometryExact:
        renderer.low.liveCommitGeometryExact
        && renderer.high.liveCommitGeometryExact,
    };
  }
  const lowPlan = planCandidateMarks(
    candidate,
    classification,
    pressureProbeRoutes.low,
  );
  const highPlan = planCandidateMarks(
    candidate,
    classification,
    pressureProbeRoutes.high,
  );
  const lowMeanDiameter = mean(lowPlan.marks.map((mark) => mark.diameter));
  const highMeanDiameter = mean(highPlan.marks.map((mark) => mark.diameter));
  const lowMeanDeposition = mean(lowPlan.marks.map((mark) => mark.alpha));
  const highMeanDeposition = mean(highPlan.marks.map((mark) => mark.alpha));
  const lowInkMass = markInkMass(lowPlan.marks);
  const highInkMass = markInkMass(highPlan.marks);
  const lowTerminalDiameter = lowPlan.marks.at(-1)?.diameter ?? lowMeanDiameter;
  const highTerminalDiameter = highPlan.marks.at(-1)?.diameter ?? highMeanDiameter;
  return {
    expected: pressureIsExpected(candidate),
    measurementSource: "planner-marks",
    lowMeanDiameter: rounded(lowMeanDiameter),
    highMeanDiameter: rounded(highMeanDiameter),
    diameterResponseRatio: rounded(symmetricResponseRatio(
      lowMeanDiameter,
      highMeanDiameter,
    )),
    lowMeanDeposition: rounded(lowMeanDeposition),
    highMeanDeposition: rounded(highMeanDeposition),
    depositionResponseRatio: rounded(symmetricResponseRatio(
      lowMeanDeposition,
      highMeanDeposition,
    )),
    lowInkMass: rounded(lowInkMass),
    highInkMass: rounded(highInkMass),
    inkMassResponseRatio: rounded(symmetricResponseRatio(lowInkMass, highInkMass)),
    lowTerminalDiameter: rounded(lowTerminalDiameter),
    highTerminalDiameter: rounded(highTerminalDiameter),
    terminalDiameterResponseRatio: rounded(symmetricResponseRatio(
      lowTerminalDiameter,
      highTerminalDiameter,
    )),
    lowTerminalToBodyRatio: rounded(safeRatio(
      lowTerminalDiameter,
      lowMeanDiameter,
      1,
    )),
    highTerminalToBodyRatio: rounded(safeRatio(
      highTerminalDiameter,
      highMeanDiameter,
      1,
    )),
    liveCommitGeometryExact:
      lowPlan.failure === null
      && highPlan.failure === null
      && marksExactlyEqual(lowPlan.marks, lowPlan.exactReplayMarks)
      && marksExactlyEqual(highPlan.marks, highPlan.exactReplayMarks),
  };
}

function crossingMetrics(
  candidate: StudioCompetitiveBrushQualityCandidate,
): StudioCompetitiveBrushCrossingMetrics {
  if (!candidate.brushDynamics) {
    return {
      available: false,
      overlap1Alpha: null,
      overlap4Alpha: null,
      overlap16Alpha: null,
      alphaLossRatio: null,
      preventedDarkeningAt16: null,
    };
  }
  const deposition = profileStudioBrushMaterialResponse({
    brushDynamics: candidate.brushDynamics,
    defaultWidth: candidate.defaultWidth,
    defaultOpacity: candidate.defaultOpacity,
    seed: QUALITY_SEED,
  }).deposition;
  const precedingPeak = Math.max(deposition.overlap1Alpha, deposition.overlap4Alpha);
  return {
    available: true,
    overlap1Alpha: rounded(deposition.overlap1Alpha),
    overlap4Alpha: rounded(deposition.overlap4Alpha),
    overlap16Alpha: rounded(deposition.overlap16Alpha),
    alphaLossRatio: rounded(Math.max(
      0,
      safeRatio(precedingPeak - deposition.overlap16Alpha, precedingPeak),
    )),
    preventedDarkeningAt16: rounded(deposition.preventedDarkeningAt16),
  };
}

function resourceProxy(
  route: LongRoute,
  marks: readonly GenericMark[],
  devicePixelRatio: 1 | 2,
): StudioCompetitiveBrushResourceProxy {
  const fullSurfacePixels = FOUR_K_WIDTH * FOUR_K_HEIGHT * devicePixelRatio ** 2;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let markFootprint = 0;
  for (const mark of marks) {
    const radius = mark.diameter / 2;
    minimumX = Math.min(minimumX, mark.x - radius);
    minimumY = Math.min(minimumY, mark.y - radius);
    maximumX = Math.max(maximumX, mark.x + radius);
    maximumY = Math.max(maximumY, mark.y + radius);
    markFootprint += Math.PI * (radius * devicePixelRatio) ** 2;
  }
  const dirtyWidth = Number.isFinite(minimumX)
    ? Math.max(0, Math.min(FOUR_K_WIDTH, maximumX) - Math.max(0, minimumX))
    : 0;
  const dirtyHeight = Number.isFinite(minimumY)
    ? Math.max(0, Math.min(FOUR_K_HEIGHT, maximumY) - Math.max(0, minimumY))
    : 0;
  const dirtyPixels = Math.min(
    fullSurfacePixels,
    Math.ceil(dirtyWidth * dirtyHeight * devicePixelRatio ** 2),
  );
  const inputBufferBytes = route.samples.length * 8 * Float64Array.BYTES_PER_ELEMENT;
  const markObjectBytes = marks.length * (7 * Float64Array.BYTES_PER_ELEMENT + 64);
  const fullSurfaceBytes = fullSurfacePixels * RGBA_BYTES_PER_PIXEL;
  const estimatedUploadBytes = dirtyPixels * RGBA_BYTES_PER_PIXEL;
  return {
    canvasWidth: FOUR_K_WIDTH,
    canvasHeight: FOUR_K_HEIGHT,
    devicePixelRatio,
    fullSurfaceBytes,
    estimatedDirtyPixels: dirtyPixels,
    estimatedUploadBytes,
    estimatedMarkFootprintPixels: Math.ceil(markFootprint),
    inputBufferBytes,
    markObjectBytes,
    estimatedPeakWorkingSetBytes: inputBufferBytes + markObjectBytes + estimatedUploadBytes,
    allocationObjectProxy: route.samples.length + marks.length,
  };
}

function addFinding(
  findings: StudioCompetitiveBrushQualityFinding[],
  finding: StudioCompetitiveBrushQualityFinding,
): void {
  findings.push(finding);
}

function evaluateCandidateFindings(
  classification: StudioCompetitiveBrushQualityClassification,
  cadence: readonly StudioCompetitiveBrushCadenceMetrics[],
  rateDensitySpan: number,
  pressure: StudioCompetitiveBrushPressureMetrics,
  crossing: StudioCompetitiveBrushCrossingMetrics,
  dpr2: StudioCompetitiveBrushResourceProxy,
  plannerFailures: readonly string[],
): StudioCompetitiveBrushQualityFinding[] {
  const findings: StudioCompetitiveBrushQualityFinding[] = [];
  for (const failure of plannerFailures) {
    addFinding(findings, {
      level: "error",
      code: "planner-failure",
      reason: "The production planner did not complete the deterministic long-stroke route.",
      actual: failure,
      limit: "no planner failure",
    });
  }
  if (cadence.some((profile) => profile.plannerCapped)) {
    addFinding(findings, {
      level: "error",
      code: "planner-cap",
      reason: "At least one 60/120/240 Hz route reached its persisted dab ceiling.",
      actual: true,
      limit: false,
    });
  }
  if (
    cadence.some((profile) => !profile.liveCommitGeometryExact)
    || !pressure.liveCommitGeometryExact
  ) {
    addFinding(findings, {
      level: "error",
      code: "live-commit-geometry-drift",
      reason: "Incremental live planning or the production pressure renderer produced different commit geometry.",
      actual: false,
      limit: true,
    });
  }
  const maximumGap = Math.max(0, ...cadence.map((profile) => profile.maxCarrierGapRatio));
  const maximumJointRatio = Math.max(0, ...cadence.map((profile) => profile.exposedJointRatio));
  const maximumTurn = Math.max(
    0,
    ...cadence.map((profile) => profile.maxCarrierTangentTurnRadians),
  );
  if (!classification.intentionalDiscontinuity && maximumGap > STRICT_CARRIER_GAP_RATIO) {
    addFinding(findings, {
      level: "error",
      code: "carrier-gap",
      reason: "A continuous brush leaves a centre gap larger than its neighbouring mean diameter.",
      metric: "maxCarrierGapRatio",
      actual: rounded(maximumGap),
      limit: STRICT_CARRIER_GAP_RATIO,
    });
  }
  if (!classification.intentionalDiscontinuity && maximumJointRatio > 0.02) {
    addFinding(findings, {
      level: maximumJointRatio > 0.2 ? "error" : "warning",
      code: "dab-joint-exposure",
      reason: "Circular dab joints remain geometrically exposed along a nominally continuous stroke.",
      metric: "maximumExposedJointRatio",
      actual: rounded(maximumJointRatio),
      limit: 0.02,
    });
  }
  if (!classification.intentionalDiscontinuity && maximumTurn > WARNING_TURN_RADIANS) {
    addFinding(findings, {
      level: maximumTurn > ERROR_TURN_RADIANS ? "error" : "warning",
      code: "curvature-spike",
      reason: "The unscattered source carrier contains a tangent discontinuity not present in the smooth input route.",
      metric: "maxCarrierTangentTurnRadians",
      actual: rounded(maximumTurn),
      limit: maximumTurn > ERROR_TURN_RADIANS
        ? ERROR_TURN_RADIANS
        : WARNING_TURN_RADIANS,
    });
  }
  if (
    classification.renderStrategy !== "connected-path"
    && classification.renderStrategy !== "pixel-grid"
    && rateDensitySpan > WARNING_RATE_DENSITY_SPAN
  ) {
    addFinding(findings, {
      level: rateDensitySpan > ERROR_RATE_DENSITY_SPAN ? "error" : "warning",
      code: "rate-density-collapse",
      reason: "The same physical stroke produces materially different carrier density at 60/120/240 Hz.",
      metric: "rateDensitySpan",
      actual: rounded(rateDensitySpan),
      limit: rateDensitySpan > ERROR_RATE_DENSITY_SPAN
        ? ERROR_RATE_DENSITY_SPAN
        : WARNING_RATE_DENSITY_SPAN,
    });
  }
  if (
    pressure.expected
    && pressure.diameterResponseRatio < PRESSURE_RESPONSE_RATIO_FLOOR
    && pressure.depositionResponseRatio < PRESSURE_RESPONSE_RATIO_FLOOR
    && pressure.inkMassResponseRatio < PRESSURE_RESPONSE_RATIO_FLOOR
    && pressure.terminalDiameterResponseRatio < PRESSURE_RESPONSE_RATIO_FLOOR
  ) {
    addFinding(findings, {
      level: "error",
      code: "pressure-response-flat",
      reason: "The production pressure renderer has no measurable width, ink-mass, terminal-width or deposition response.",
      metric: "maxPressureRendererResponseRatio",
      actual: rounded(Math.max(
        pressure.diameterResponseRatio,
        pressure.depositionResponseRatio,
        pressure.inkMassResponseRatio,
        pressure.terminalDiameterResponseRatio,
      )),
      limit: PRESSURE_RESPONSE_RATIO_FLOOR,
    });
  }
  if ((crossing.alphaLossRatio ?? 0) > 0.001) {
    addFinding(findings, {
      level: "error",
      code: "optical-crossing-loss",
      reason: "Repeated deposition loses alpha at a crossing instead of preserving or building pigment.",
      metric: "alphaLossRatio",
      actual: crossing.alphaLossRatio,
      limit: 0.001,
    });
  }
  if (dpr2.estimatedPeakWorkingSetBytes > HEAP_WARNING_BYTES) {
    addFinding(findings, {
      level: "warning",
      code: "heap-proxy-high",
      reason: "The DPR2 4K dirty-surface and planner allocation proxy exceeds the portable warning budget.",
      metric: "estimatedPeakWorkingSetBytes",
      actual: dpr2.estimatedPeakWorkingSetBytes,
      limit: HEAP_WARNING_BYTES,
    });
  }
  return findings;
}

function classificationFor(
  candidate: StudioCompetitiveBrushQualityCandidate,
  supplied: ReadonlyMap<string, StudioCompetitiveBrushQualityClassification>,
): StudioCompetitiveBrushQualityClassification {
  const existing = supplied.get(candidate.catalogId);
  if (existing) return existing;
  const audit = auditStudioBrushContinuity(candidate);
  return {
    catalogId: candidate.catalogId,
    renderStrategy: audit.renderStrategy,
    renderFamily: audit.renderFamily,
    intentionalDiscontinuity: audit.intentionalDiscontinuity,
  };
}

function representativeGroup(
  candidate: StudioCompetitiveBrushQualityCandidate,
  classification: StudioCompetitiveBrushQualityClassification,
): string {
  return [
    sourceOf(candidate),
    classification.renderStrategy,
    classification.renderFamily,
    classification.intentionalDiscontinuity ? "discrete" : "continuous",
  ].join(":");
}

function externalGates(tier: StudioCompetitiveBrushQualityTier): StudioCompetitiveBrushExternalGate[] {
  const status = tier === "deep" ? "required" : "waived";
  return [
    {
      id: "pixel-live-commit-parity",
      status,
      reason: "DOM-free CI proves exact planner geometry; production pixel identity requires browser screenshots before and after pointer-up.",
      command: "pnpm run verify:studio-brushes",
    },
    {
      id: "pixel-crossing-color",
      status,
      reason: "The optical model catches alpha loss, while RGB/texture crossing loss requires the production compositor and pixel sampler.",
      command: "pnpm run verify:studio-brush-media",
    },
    {
      id: "browser-frame-pacing",
      status,
      reason: "Node planner runtime is recorded but cannot substitute for real 60/120/240 Hz requestAnimationFrame and pointer delivery evidence.",
      command: "pnpm run verify:studio-brush-latency",
    },
    {
      id: "browser-heap-gc",
      status,
      reason: "CI records bounded allocation and 4K/DPR proxies; browser heap deltas, long tasks and GC pauses require the frame-budget profiler.",
      command: "pnpm run verify:studio-brush-latency",
    },
  ];
}

export function benchmarkStudioCompetitiveBrushQuality(
  candidates: readonly StudioCompetitiveBrushQualityCandidate[],
  options: StudioCompetitiveBrushQualityOptions = {},
): StudioCompetitiveBrushQualityReport {
  const tier = options.tier ?? "ci";
  const expectedPresetCount = options.expectedPresetCount ?? DEFAULT_EXPECTED_PRESET_COUNT;
  const supplied = new Map(
    (options.classifications ?? []).map((classification) => [
      classification.catalogId,
      classification,
    ]),
  );
  const classified = candidates.map((candidate) => ({
    candidate,
    classification: classificationFor(candidate, supplied),
  }));
  const representativeIds = new Set<string>();
  const representedGroups = new Set<string>();
  for (const { candidate, classification } of classified) {
    const group = representativeGroup(candidate, classification);
    if (!representedGroups.has(group)) {
      representedGroups.add(group);
      representativeIds.add(candidate.catalogId);
    }
  }
  const measured = tier === "deep"
    ? classified
    : classified.filter(({ candidate }) => representativeIds.has(candidate.catalogId));
  // Every representative exercises the exact same immutable physical input routes. Build them
  // once per report instead of manufacturing and collecting identical 5,001-sample object graphs.
  const cadenceRoutes = new Map(
    STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ.map((rateHz) => [
      rateHz,
      buildLongRoute(rateHz),
    ]),
  );
  const pressureProbeRoutes = {
    low: buildPlannerPressureProbeRoute(PRESSURE_RENDERER_PROBE_LOW),
    high: buildPlannerPressureProbeRoute(PRESSURE_RENDERER_PROBE_HIGH),
  } as const;
  const results: StudioCompetitiveBrushQualityResult[] = [];
  for (const { candidate, classification } of measured) {
    const cadence: StudioCompetitiveBrushCadenceMetrics[] = [];
    const plannerFailures: string[] = [];
    let longestRoute: LongRoute | null = null;
    let longestMarks: readonly GenericMark[] = [];
    for (const rateHz of STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ) {
      const route = cadenceRoutes.get(rateHz)!;
      const started = performance.now();
      const plan = planCandidateMarks(candidate, classification, route);
      const runtimeMs = performance.now() - started;
      if (plan.failure) plannerFailures.push(`${rateHz}Hz:${plan.failure}`);
      cadence.push(cadenceMetrics(
        route,
        plan,
        classification.renderStrategy,
        rateHz,
        runtimeMs,
      ));
      if (!longestRoute || route.samples.length > longestRoute.samples.length) {
        longestRoute = route;
        longestMarks = plan.marks;
      }
    }
    const densities = cadence
      .map((profile) => profile.markDensityPerKilopixel)
      .filter((value) => value > 0);
    const rateDensitySpan = densities.length === 0
      ? 0
      : safeRatio(Math.max(...densities), Math.min(...densities), 1);
    const pressure = pressureMetrics(candidate, classification, pressureProbeRoutes);
    const crossing = crossingMetrics(candidate);
    const route = longestRoute ?? buildLongRoute(240);
    const dpr1 = resourceProxy(route, longestMarks, 1);
    const dpr2 = resourceProxy(route, longestMarks, 2);
    const findings = evaluateCandidateFindings(
      classification,
      cadence,
      rateDensitySpan,
      pressure,
      crossing,
      dpr2,
      plannerFailures,
    );
    const hasError = findings.some((finding) => finding.level === "error");
    const hasWaiver = findings.some((finding) => finding.level === "waiver");
    results.push({
      catalogId: candidate.catalogId,
      catalogName: candidate.catalogName,
      source: sourceOf(candidate),
      category: candidate.category ?? null,
      runtimeBrushId: candidate.runtimeBrushId,
      renderStrategy: classification.renderStrategy,
      renderFamily: classification.renderFamily,
      intentionalDiscontinuity: classification.intentionalDiscontinuity,
      representativeGroup: representativeGroup(candidate, classification),
      representative: representativeIds.has(candidate.catalogId),
      cadence,
      rateDensitySpan: rounded(rateDensitySpan),
      pressure,
      crossing,
      resourceProxy4k: { dpr1, dpr2 },
      findings,
      status: hasError ? "fail" : hasWaiver ? "waived" : "pass",
    });
  }
  const catalogue = classified.map(({ candidate, classification }) => ({
    catalogId: candidate.catalogId,
    source: sourceOf(candidate),
    renderStrategy: classification.renderStrategy,
    renderFamily: classification.renderFamily,
    intentionalDiscontinuity: classification.intentionalDiscontinuity,
    representativeGroup: representativeGroup(candidate, classification),
    representative: representativeIds.has(candidate.catalogId),
  }));
  const allFindings = results.flatMap((result) => result.findings);
  const allCadence = results.flatMap((result) => result.cadence);
  const allResources = results.flatMap((result) => result.resourceProxy4k
    ? [result.resourceProxy4k.dpr1, result.resourceProxy4k.dpr2]
    : []);
  const duplicateCount = candidates.length - new Set(candidates.map(({ catalogId }) => catalogId)).size;
  const external = externalGates(tier);
  const errorCount = allFindings.filter(({ level }) => level === "error").length
    + (candidates.length === expectedPresetCount ? 0 : 1)
    + duplicateCount;
  return {
    kind: "toonspectrum-studio-competitive-brush-quality",
    schemaVersion: STUDIO_COMPETITIVE_BRUSH_QUALITY_SCHEMA_VERSION,
    tier,
    policy: {
      expectedPresetCount,
      inputRatesHz: STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ,
      longSampleFloor: STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR,
      strictCarrierGapRatio: STRICT_CARRIER_GAP_RATIO,
      visibleJointGapRatio: VISIBLE_JOINT_GAP_RATIO,
      warningTurnRadians: WARNING_TURN_RADIANS,
      errorTurnRadians: ERROR_TURN_RADIANS,
      warningRateDensitySpan: WARNING_RATE_DENSITY_SPAN,
      errorRateDensitySpan: ERROR_RATE_DENSITY_SPAN,
      pressureResponseRatioFloor: PRESSURE_RESPONSE_RATIO_FLOOR,
    },
    catalogue,
    results,
    externalGates: external,
    summary: {
      catalogueCount: candidates.length,
      representativeCount: representativeIds.size,
      measuredCount: results.length,
      errorCount,
      warningCount: allFindings.filter(({ level }) => level === "warning").length,
      waiverCount: allFindings.filter(({ level }) => level === "waiver").length
        + external.filter(({ status }) => status === "waived").length,
      maximumSourceSampleCount: Math.max(0, ...allCadence.map(({ sourceSampleCount }) => sourceSampleCount)),
      maximumRuntimeMs: rounded(Math.max(0, ...allCadence.map(({ runtimeMs }) => runtimeMs))),
      maximumCarrierGapRatio: rounded(Math.max(
        0,
        ...allCadence.map(({ maxCarrierGapRatio }) => maxCarrierGapRatio),
      )),
      maximumExposedJointRatio: rounded(Math.max(
        0,
        ...allCadence.map(({ exposedJointRatio }) => exposedJointRatio),
      )),
      maximumEstimatedPeakWorkingSetBytes: Math.max(
        0,
        ...allResources.map(({ estimatedPeakWorkingSetBytes }) => estimatedPeakWorkingSetBytes),
      ),
    },
    ok: errorCount === 0,
  };
}
