/**
 * Bridges clean-room web-drawing kits into the dynamic-dab planner path.
 *
 * Product call sites may pass a freehand point stream + brush id; when the brush
 * belongs to a web kit the path is rewritten into kit sample stations and mapped
 * to `StudioDynamicBrushDab` so live/commit coverage reuses the existing stamp
 * pipeline (no parallel renderer).
 */

import { resolveStudioBrushIntrinsicSymmetry } from "./brush/studio-brush-intrinsic-symmetry";
import {
  isStudioWebAssistBrushId,
  planStudioWebAssistSamplesForBrush,
  type StudioWebAssistSample,
  STUDIO_WEB_ASSIST_BRUSH_IDS,
} from "./studio-web-drawing-assist-kit";
import {
  isStudioWebColoringBrushId,
  planStudioWebColoringSamplesForBrush,
  type StudioWebColorSample,
  STUDIO_WEB_COLORING_BRUSH_IDS,
} from "./studio-web-drawing-coloring-kit";
import {
  isStudioWebCompetitiveBrushId,
  planStudioWebCompetitiveSamplesForBrush,
  type StudioWebCompetitiveSample,
  STUDIO_WEB_COMPETITIVE_BRUSH_IDS,
} from "./studio-web-drawing-competitive-kit";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";

export const STUDIO_WEB_DRAWING_STROKE_BRIDGE_VERSION =
  "web-drawing-stroke-bridge-v1" as const;

export const STUDIO_WEB_DRAWING_ALL_BRUSH_IDS = Object.freeze([
  ...STUDIO_WEB_COMPETITIVE_BRUSH_IDS,
  ...STUDIO_WEB_COLORING_BRUSH_IDS,
  ...STUDIO_WEB_ASSIST_BRUSH_IDS,
] as const);

export type StudioWebDrawingBrushId =
  (typeof STUDIO_WEB_DRAWING_ALL_BRUSH_IDS)[number];

export function isStudioWebDrawingBrushId(
  value: unknown,
): value is StudioWebDrawingBrushId {
  return typeof value === "string"
    && (STUDIO_WEB_DRAWING_ALL_BRUSH_IDS as readonly string[]).includes(value);
}

export type StudioWebDrawingBrushFamily =
  | "competitive"
  | "coloring"
  | "assist"
  | "none";

/** Classify a brush id into the clean-room kit family that owns its samples. */
export function classifyStudioWebDrawingBrushFamily(
  brushId: unknown,
): StudioWebDrawingBrushFamily {
  if (typeof brushId !== "string") return "none";
  if (isStudioWebCompetitiveBrushId(brushId)) return "competitive";
  if (isStudioWebColoringBrushId(brushId)) return "coloring";
  if (isStudioWebAssistBrushId(brushId)) return "assist";
  return "none";
}

/**
 * True when the KIT authors this stroke's geometry, so every surface must plan from kit samples
 * rather than from the ordinary deposition planner.
 *
 * Two kit presets are deliberately excluded. `web-mirror-ink` and `web-kaleido-ink` already get
 * their second mark from `studio-brush-intrinsic-symmetry`, which records the fold on the stroke
 * and is honoured identically by the committed Konva plan, the SVG export and the live overlay,
 * centred on the PAGE. Their kit planners take a `centerX`/`centerY` that no caller supplies, so
 * routing them here would fold them a SECOND time about the origin and throw those copies
 * off-canvas. Excluding them is that repair: the fold they render is the page-centred one.
 *
 * Everything outside the kit answers false, which is what keeps this change byte-identical for the
 * rest of the catalogue.
 */
export function studioWebDrawingKitOwnsStrokeGeometry(
  brushId: unknown,
): brushId is StudioWebDrawingBrushId {
  return isStudioWebDrawingBrushId(brushId)
    && resolveStudioBrushIntrinsicSymmetry(brushId) === null;
}

/** Kit ids whose geometry the kit owns — for governance tests and audits. */
export const STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS: readonly string[] = Object.freeze(
  STUDIO_WEB_DRAWING_ALL_BRUSH_IDS.filter(studioWebDrawingKitOwnsStrokeGeometry),
);

export interface StudioWebDrawingBridgePlanAudit {
  readonly family: StudioWebDrawingBrushFamily;
  readonly pathPointCount: number;
  readonly sampleCount: number;
  readonly dabCount: number;
  readonly maxDabs: number;
  readonly stride: number;
  /** True when sample stations were decimated to fit maxDabs. */
  readonly budgetLimited: boolean;
  /** True when kit path was empty or brush is not a web kit. */
  readonly empty: boolean;
}

/**
 * Inspect the kit → dab conversion without allocating full dab objects when empty.
 * Live and commit planners share the same sample/stride arithmetic so audits match paint.
 */
export function auditStudioWebDrawingBridgePlan(
  input: StudioWebDrawingBridgeInput,
): StudioWebDrawingBridgePlanAudit {
  const family = classifyStudioWebDrawingBrushFamily(input.brushId);
  // The audit mirrors the planner's path exactly, sparse-gap densification included, so its
  // sample/dab arithmetic never drifts from what planStudioWebDrawingDynamicDabs emits.
  const path = densifySparseWebDrawingPathGaps(
    pathFromFlat(input.points, input.pressures),
    clamp(finite(input.baseWidth, 8), 0.5, 256),
  );
  const maxDabs = Math.max(
    1,
    Math.min(65_536, Math.round(finite(input.maxDabs, 8_192))),
  );
  if (family === "none" || path.length === 0) {
    return Object.freeze({
      family,
      pathPointCount: path.length,
      sampleCount: 0,
      dabCount: 0,
      maxDabs,
      stride: 1,
      budgetLimited: false,
      empty: true,
    });
  }
  const samples = planSamples(input.brushId as string, path, {
    baseSize: clamp(finite(input.baseWidth, 8), 0.5, 256),
    seed: input.seed,
    centerX: input.centerX,
    centerY: input.centerY,
  });
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return Object.freeze({
      family,
      pathPointCount: path.length,
      sampleCount: 0,
      dabCount: 0,
      maxDabs,
      stride: 1,
      budgetLimited: false,
      empty: true,
    });
  }
  const stride = sampleCount > maxDabs ? Math.ceil(sampleCount / maxDabs) : 1;
  const dabCount = Math.min(maxDabs, Math.ceil(sampleCount / stride));
  return Object.freeze({
    family,
    pathPointCount: path.length,
    sampleCount,
    dabCount,
    maxDabs,
    stride,
    budgetLimited: stride > 1 || dabCount < sampleCount,
    empty: false,
  });
}

export interface StudioWebDrawingBridgeInput {
  readonly brushId: unknown;
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly baseWidth?: number;
  readonly baseOpacity?: number;
  readonly seed?: number;
  readonly maxDabs?: number;
  /** Optional kaleidoscope/mirror centre (document space). */
  readonly centerX?: number;
  readonly centerY?: number;
}

type AnySample =
  | StudioWebCompetitiveSample
  | StudioWebColorSample
  | StudioWebAssistSample;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finite(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pathFromFlat(
  points: readonly number[],
  pressures: readonly number[] | undefined,
): { x: number; y: number; pressure: number }[] {
  const out: { x: number; y: number; pressure: number }[] = [];
  const n = Math.floor(points.length / 2);
  for (let i = 0; i < n; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x,
      y,
      pressure: clamp(finite(pressures?.[i], 0.55), 0.02, 1),
    });
  }
  return out;
}

/**
 * Inserts linearly interpolated route points into sparse gaps, keeping every original point
 * byte-identical. Kit family planners place samples ON path points, so this is the single
 * interpolation authority the committed Konva plan, SVG export and live overlay all inherit
 * through {@link planStudioWebDrawingDynamicDabs}. The step must stay well under the narrowest
 * stamp footprint: chisel nibs (web-calligraphy-ribbon) are only `minRoundness × size ≈ 0.18 ×
 * baseWidth` wide along the stroke, so a half-width step leaves separated stamps that the
 * long-route quality gate flags as repeated-pattern / edge-periodicity (실측 0.649 / 0.721).
 */
function densifySparseWebDrawingPathGaps(
  path: readonly { x: number; y: number; pressure: number }[],
  baseWidth: number,
): readonly { x: number; y: number; pressure: number }[] {
  if (path.length < 2) return path;
  const gapThreshold = clamp(baseWidth * 0.1, 1, 3);
  let needsDensify = false;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const next = path[i]!;
    if (Math.hypot(next.x - prev.x, next.y - prev.y) > gapThreshold) {
      needsDensify = true;
      break;
    }
  }
  if (!needsDensify) return path;
  const out: { x: number; y: number; pressure: number }[] = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const next = path[i]!;
    const gap = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (gap > gapThreshold) {
      // 상한은 병적 입력(손상 좌표 등)만 막는 안전판이다. 이전 512 상한은 threshold(1–3px)의
      // 512배를 넘는 간격 — 세로로 수천 px 인 캔버스의 희소 2점 직선 획에서 실제로 가능 — 에서
      // 보간 간격이 threshold 를 훌쩍 넘겨 좁은 치즐 스탬프 몸통이 다시 끊겼다(P2 리뷰).
      // 65,536 이면 1px 하한 기준 65k px 간격까지 간격 보장이 정확히 유지된다 — 지원 캔버스
      // 어느 크기보다도 크다.
      const steps = Math.min(65_536, Math.ceil(gap / gapThreshold));
      for (let step = 1; step < steps; step++) {
        const amount = step / steps;
        out.push({
          x: prev.x + (next.x - prev.x) * amount,
          y: prev.y + (next.y - prev.y) * amount,
          pressure: prev.pressure + (next.pressure - prev.pressure) * amount,
        });
      }
    }
    out.push(next);
  }
  return out;
}

function planSamples(
  brushId: string,
  path: readonly { x: number; y: number; pressure: number }[],
  options: {
    baseSize?: number;
    seed?: number;
    centerX?: number;
    centerY?: number;
  },
): readonly AnySample[] {
  if (isStudioWebCompetitiveBrushId(brushId)) {
    return planStudioWebCompetitiveSamplesForBrush(brushId, path, {
      baseSize: options.baseSize,
      seed: options.seed,
    });
  }
  if (isStudioWebColoringBrushId(brushId)) {
    return planStudioWebColoringSamplesForBrush(brushId, path, {
      baseSize: options.baseSize,
      seed: options.seed,
    });
  }
  if (isStudioWebAssistBrushId(brushId)) {
    return planStudioWebAssistSamplesForBrush(brushId, path, {
      baseSize: options.baseSize,
      seed: options.seed,
      centerX: options.centerX,
      centerY: options.centerY,
    });
  }
  return Object.freeze([]);
}

function sampleAngle(sample: AnySample): number {
  if ("angleRadians" in sample && typeof sample.angleRadians === "number") {
    return (sample.angleRadians * 180) / Math.PI;
  }
  return 0;
}

function sampleAgent(sample: AnySample): number {
  if ("agent" in sample && typeof sample.agent === "number") return sample.agent;
  return 0;
}

/**
 * When `brushId` is a web-drawing kit identity, return kit-authored dabs.
 * Otherwise return `null` so callers keep the ordinary dynamics planner.
 */
export function planStudioWebDrawingDynamicDabs(
  input: StudioWebDrawingBridgeInput,
  settings: NormalizedStudioBrushDynamicsSettings,
): StudioDynamicBrushDab[] | null {
  if (!isStudioWebDrawingBrushId(input.brushId)) return null;
  const sparsePath = pathFromFlat(input.points, input.pressures);
  if (sparsePath.length === 0) return [];

  const baseWidth = clamp(finite(input.baseWidth, settings.width.base), 0.5, 256);
  // 렌더러는 자기 경로를 스스로 보간해야 한다(장경로 감사 계약): 빠른 스와이프가 포인터
  // 샘플을 391px 한 번의 점프로 전달하면, 키트 패밀리 플래너는 경로 점 위에만 샘플을 놓으므로
  // 양끝 캡만 그려지고 몸통이 사라진다(실측: web-rainbow-flow · web-calligraphy-ribbon,
  // origin/main 동일). 임계(브러시 폭 절반)를 넘는 갭에만 보간점을 삽입한다 — 사람 손의 정상
  // 밀도 획은 경로가 바이트 그대로라 저장 문서의 재생이 변하지 않고, 오늘 끊겨 그려지던
  // 희소 획만 몸통을 되찾는다.
  const path = densifySparseWebDrawingPathGaps(sparsePath, baseWidth);
  const baseOpacity = clamp(finite(input.baseOpacity, settings.opacity.base), 0.02, 1);
  const maxDabs = Math.max(
    1,
    Math.min(
      65_536,
      Math.round(finite(input.maxDabs, 8_192)),
    ),
  );

  const samples = planSamples(input.brushId, path, {
    baseSize: baseWidth,
    seed: input.seed ?? settings.seed,
    centerX: input.centerX,
    centerY: input.centerY,
  });
  if (samples.length === 0) return [];

  const stride = samples.length > maxDabs
    ? Math.ceil(samples.length / maxDabs)
    : 1;
  const dabs: StudioDynamicBrushDab[] = [];
  let prevX = samples[0]!.x;
  let prevY = samples[0]!.y;
  let traveled = 0;
  let outIndex = 0;
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i]!;
    const dist = Math.hypot(s.x - prevX, s.y - prevY);
    if (outIndex > 0) traveled += dist;
    const size = clamp(s.size, 0.25, 256);
    const opacity = clamp(s.opacity * baseOpacity, 0.02, 1);
    const flow = clamp(settings.flow.base, 0.05, 1);
    dabs.push({
      index: outIndex,
      progress: samples.length <= 1 ? 0 : i / (samples.length - 1),
      sourceX: s.x,
      sourceY: s.y,
      x: s.x,
      y: s.y,
      size,
      opacity,
      flow,
      spacing: Math.max(0.25, dist),
      scatter: 0,
      angle: sampleAngle(s),
      roundness: clamp(settings.roundness.base, 0.05, 1),
      direction: sampleAngle(s),
      distanceFromPrevious: outIndex === 0 ? 0 : dist,
      distanceFromStrokeStart: traveled,
      contactFactor: size * opacity * flow,
      // Preserve multi-agent / fold identity for diagnostics without changing mark shape.
      contactLoadFromStrokeStart: sampleAgent(s),
    });
    prevX = s.x;
    prevY = s.y;
    outIndex += 1;
    if (dabs.length >= maxDabs) break;
  }
  return dabs;
}

/**
 * The dabs every surface must paint for a kit-owned brush, or null to keep the ordinary planner.
 *
 * This is the entry point the committed Konva plan, the SVG export and the live overlay all call.
 * They used to diverge by construction: all 25 kit presets normalise to `causal-deposit-v3-segmented`,
 * and each surface's causal branch returns before its dab planner is ever consulted, so the kit's
 * rays, strands and double contours reached NO surface — including live, whose kit call sat below
 * that early return. Routing every surface through one function is what stops that from recurring.
 */
export function planStudioWebDrawingKitOwnedDabs(
  input: StudioWebDrawingBridgeInput,
  settings: NormalizedStudioBrushDynamicsSettings,
): StudioDynamicBrushDab[] | null {
  if (!studioWebDrawingKitOwnsStrokeGeometry(input.brushId)) return null;
  return planStudioWebDrawingDynamicDabs(input, settings);
}

/**
 * Prefer web-kit dabs when available; otherwise fall through to `fallback`.
 */
export function planStudioWebAwareDynamicBrushDabs(
  input: StudioWebDrawingBridgeInput & {
    readonly settings: NormalizedStudioBrushDynamicsSettings;
  },
  fallback: (
    planInput: {
      points: readonly number[];
      pressures?: readonly number[];
      baseWidth?: number;
      baseOpacity?: number;
      seed?: number;
      maxDabs?: number;
    },
    settings: NormalizedStudioBrushDynamicsSettings,
  ) => StudioDynamicBrushDab[],
): StudioDynamicBrushDab[] {
  const web = planStudioWebDrawingDynamicDabs(input, input.settings);
  if (web) return web;
  return fallback(
    {
      points: input.points,
      pressures: input.pressures,
      baseWidth: input.baseWidth,
      baseOpacity: input.baseOpacity,
      seed: input.seed,
      maxDabs: input.maxDabs,
    },
    input.settings,
  );
}

/** Live pointer frames target ~4k Canvas marks (see STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET). */
export const STUDIO_WEB_DRAWING_LIVE_MARK_BUDGET_DEFAULT = 4_096;

export interface StudioWebDrawingLiveMaxDabsRecommendation {
  readonly family: StudioWebDrawingBrushFamily;
  readonly maxDabs: number;
  readonly sampleCount: number;
  readonly uncappedDabCount: number;
  readonly markBudget: number;
  readonly marksPerDab: number;
  readonly capped: boolean;
  readonly empty: boolean;
}

/**
 * Recommend a live maxDabs ceiling from kit sample volume and the live mark budget.
 * Competitive swarms (multi-agent) often explode samples; this keeps pointer frames under budget
 * without changing committed document fidelity (callers still pass higher max for commit).
 */
export function recommendStudioWebDrawingLiveMaxDabs(
  input: StudioWebDrawingBridgeInput & {
    readonly markBudget?: number;
    readonly marksPerDab?: number;
  },
): StudioWebDrawingLiveMaxDabsRecommendation {
  const markBudget = Math.max(
    1,
    Math.round(finite(input.markBudget, STUDIO_WEB_DRAWING_LIVE_MARK_BUDGET_DEFAULT)),
  );
  const marksPerDab = Math.max(1, Math.round(finite(input.marksPerDab, 1)));
  const audit = auditStudioWebDrawingBridgePlan({
    ...input,
    // Uncapped sample count for capacity planning.
    maxDabs: 65_536,
  });
  if (audit.empty || audit.family === "none") {
    return Object.freeze({
      family: audit.family,
      maxDabs: 1,
      sampleCount: 0,
      uncappedDabCount: 0,
      markBudget,
      marksPerDab,
      capped: false,
      empty: true,
    });
  }
  const byMarks = Math.max(1, Math.floor(markBudget / marksPerDab));
  const callerCap = Math.max(
    1,
    Math.min(65_536, Math.round(finite(input.maxDabs, byMarks))),
  );
  const maxDabs = Math.min(byMarks, callerCap, audit.sampleCount);
  return Object.freeze({
    family: audit.family,
    maxDabs,
    sampleCount: audit.sampleCount,
    uncappedDabCount: audit.sampleCount,
    markBudget,
    marksPerDab,
    capped: maxDabs < audit.sampleCount,
    empty: false,
  });
}

/**
 * Progressive live-frame slice under a hard ceiling.
 *
 * When decimating, keeps the stroke **endpoint** (last dab) so live preview does not
 * leave the tip frozen mid-path. Same array reference when no slice is needed.
 */
export function sliceStudioDynamicDabsForLiveFrame<
  T extends { readonly index: number },
>(
  dabs: readonly T[],
  maxDabs: number,
): {
  readonly dabs: readonly T[];
  readonly sliced: boolean;
  readonly dropped: number;
  readonly preservedEndpoint: boolean;
} {
  const limit = Math.max(0, Math.floor(maxDabs));
  if (limit <= 0) {
    return Object.freeze({
      dabs: Object.freeze([] as T[]),
      sliced: true,
      dropped: dabs.length,
      preservedEndpoint: false,
    });
  }
  if (dabs.length <= limit) {
    return Object.freeze({
      dabs,
      sliced: false,
      dropped: 0,
      preservedEndpoint: false,
    });
  }
  if (limit === 1) {
    // Prefer the newest tip so the cursor feels attached to the stroke end.
    const tip = dabs[dabs.length - 1]!;
    return Object.freeze({
      dabs: Object.freeze([tip]),
      sliced: true,
      dropped: dabs.length - 1,
      preservedEndpoint: true,
    });
  }
  const head = dabs.slice(0, limit - 1);
  const last = dabs[dabs.length - 1]!;
  const alreadyHasLast = head[head.length - 1] === last;
  const out = alreadyHasLast ? dabs.slice(0, limit) : [...head, last];
  return Object.freeze({
    dabs: Object.freeze(out),
    sliced: true,
    dropped: dabs.length - out.length,
    preservedEndpoint: true,
  });
}
