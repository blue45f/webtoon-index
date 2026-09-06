/**
 * VRM 텍스처 페인팅 — 드래그(레이 히트 시퀀스) → 텍스처 공간 dab 시퀀스.
 *
 * 핵심 결정 두 가지.
 *
 * 1) **간격은 화면이 아니라 텍스처 공간에서 잰다.** 같은 화면 이동량이라도 UV 밀도가
 *    다른 부위(얼굴 vs 옷자락)에서는 텍셀 이동량이 몇 배씩 달라진다. 화면 간격으로 dab 을
 *    찍으면 밀도가 높은 곳은 뭉치고 낮은 곳은 끊긴다. 그래서 히트를 먼저 텍셀 좌표로 바꾼 뒤,
 *    Studio 의 기존 2D 스탬프 엔진(`studio-brush-stamp-engine`)에 **텍셀 좌표 폴리라인**을
 *    그대로 먹인다 — 브러시 종류별 간격비·필압 반응·잉크 속도 감쇠가 2D 캔버스와 동일해진다.
 *
 * 2) **UV 심(seam)에서는 획을 끊는다.** 3D 상으로는 연속인 두 히트가 서로 다른 UV 아일랜드에
 *    떨어지면 텍스처 공간에서는 아틀라스를 가로지르는 긴 선분이 된다. 그대로 걸으면 관계없는
 *    부위에 페인트가 그어진다. 월드 이동량과 텍셀 밀도를 아는 경우에는 "예상 텍셀 이동량 대비
 *    실제 이동량" 비율로, 모르는 경우에는 절대 텍셀 임계값으로 끊는다.
 *
 * 결정성: 같은 (samples, style, seed) 는 항상 같은 op 배열을 만든다. 연필 그레인 같은 무작위
 * 요소는 전부 스탬프 엔진의 `stampJitter(index, salt)` 해시에서만 유도한다.
 */

import {
  STUDIO_STAMP_BRUSH_MAX_DABS,
  planStudioStampBrushDabs,
  resolveStudioStampBrushStyle,
  stampJitter,
  type StudioStampBrushDab,
  type StudioStampBrushKind,
  type StudioStampBrushStyle,
  type StudioStampBrushTuning,
} from "../brush/studio-brush-stamp-engine";

import {
  resolveStudioVrmTexelPoint,
  type StudioVrmTexelPoint,
  type StudioVrmTexelResolveOptions,
  type StudioVrmTextureSize,
  type StudioVrmUvPoint,
  type StudioVrmVector3,
} from "./studio-vrm-texture-uv";

import type {
  StudioVrmTexturePaintBlendMode,
  StudioVrmTexturePaintOp,
} from "./studio-vrm-texture-paint-ops";

/** 한 획이 만들 수 있는 op 상한. 연필은 dab 하나가 op 3 개(본체 + 그레인 2)라 별도 상한을 둔다. */
export const STUDIO_VRM_TEXTURE_STROKE_MAX_OPS = 200_000;

export interface StudioVrmTextureStrokeSample {
  readonly uv: StudioVrmUvPoint;
  /** 0..1. 미지정이면 0.5. */
  readonly pressure?: number;
  /** 메시/서브메시/머티리얼 식별자. 값이 바뀌면 무조건 획을 끊는다. */
  readonly islandId?: string | number;
  /** 있으면 심 판정을 월드 이동량 기반으로 한다(더 정확). */
  readonly world?: StudioVrmVector3;
  /** 이 히트 지점의 월드 1 단위당 텍셀 수(`estimateStudioVrmUvTexelDensity`). */
  readonly texelsPerWorldUnit?: number;
}

export interface StudioVrmTextureStrokeStyle {
  readonly kind: StudioStampBrushKind;
  readonly color: string;
  /** 텍셀 단위 지름. 월드 기준 굵기를 유지하려면 UV 밀도로 환산해서 넣는다. */
  readonly sizeTexels: number;
  readonly opacity: number;
  readonly blend: StudioVrmTexturePaintBlendMode;
  readonly tuning?: StudioStampBrushTuning | null;
}

export interface StudioVrmTextureStrokePlanOptions extends StudioVrmTexelResolveOptions {
  /** 같은 seed 면 같은 결과. 기본 0. */
  readonly seed?: number;
  /**
   * 월드 정보가 없을 때 쓰는 절대 임계값(텍셀). 기본 max(64, min(width, height) × 0.25).
   * 절대값만으로는 "빠른 드래그"와 "심 점프"를 구분할 수 없어 일부러 관대하게 잡는다 —
   * 정확한 심 판정을 원하면 샘플에 `world` + `texelsPerWorldUnit` 을 실어 보낼 것.
   */
  readonly seamBreakTexels?: number;
  /** 월드 정보가 있을 때, 예상 텍셀 이동량의 몇 배를 넘으면 심으로 볼지. 기본 4. */
  readonly seamStretchRatio?: number;
  readonly maxDabs?: number;
}

export interface StudioVrmTextureStrokePlan {
  readonly ops: readonly StudioVrmTexturePaintOp[];
  /** 심으로 끊긴 뒤 다시 시작한 구간 수(항상 1 이상, 유효 샘플이 없으면 0). */
  readonly runs: number;
  readonly seamBreaks: number;
  /** UV/크기 문제로 텍셀 좌표를 못 구한 샘플 수. */
  readonly skipped: number;
  readonly dabs: number;
}

const EMPTY_PLAN: StudioVrmTextureStrokePlan = Object.freeze({
  ops: Object.freeze([]),
  runs: 0,
  seamBreaks: 0,
  skipped: 0,
  dabs: 0,
});

export interface StudioVrmTextureResolvedStrokeSample {
  readonly point: StudioVrmTexelPoint;
  readonly pressure: number;
  readonly islandKey: string;
  readonly world?: StudioVrmVector3;
  readonly density?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizedPressure(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0.5;
}

/** 스탬프 엔진의 종류별 기본값 위에 획 튜닝을 얹는다(2D 브러시와 완전히 같은 규약). */
export function resolveStudioVrmTextureStrokeBrush(
  style: StudioVrmTextureStrokeStyle,
): StudioStampBrushStyle {
  return resolveStudioStampBrushStyle(
    style.kind,
    { color: style.color, size: style.sizeTexels, opacity: style.opacity },
    style.tuning ?? null,
  );
}

function worldDistance(a: StudioVrmVector3, b: StudioVrmVector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface StudioVrmTextureStrokeSeamPolicy {
  readonly seamBreakTexels: number;
  readonly seamStretchRatio: number;
  readonly brushSizeTexels: number;
}

export function isStudioVrmTextureStrokeSeamBreak(
  previous: StudioVrmTextureResolvedStrokeSample,
  current: StudioVrmTextureResolvedStrokeSample,
  policy: StudioVrmTextureStrokeSeamPolicy,
): boolean {
  if (previous.islandKey !== current.islandKey) return true;
  const step = Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y);
  if (!Number.isFinite(step)) return true;
  if (
    previous.world &&
    current.world &&
    previous.density !== undefined &&
    current.density !== undefined &&
    previous.density > 0 &&
    current.density > 0
  ) {
    const expected =
      worldDistance(previous.world, current.world) * ((previous.density + current.density) / 2);
    // 월드 이동량을 알면 임계값을 브러시 굵기까지 낮출 수 있다 — 인접 아일랜드로 건너뛰는
    // 짧은 심도 잡힌다. 삼각형 하나를 건너뛴 정도의 오차는 브러시 지름 2 배로 흡수한다.
    return step > Math.max(policy.brushSizeTexels * 2, expected * policy.seamStretchRatio);
  }
  return step > policy.seamBreakTexels;
}

export function resolveStudioVrmTextureStrokeSample(
  sample: StudioVrmTextureStrokeSample,
  size: StudioVrmTextureSize,
  options: StudioVrmTextureStrokePlanOptions,
): StudioVrmTextureResolvedStrokeSample | null {
  const point = resolveStudioVrmTexelPoint(sample.uv, size, options);
  if (!point) return null;
  const density =
    typeof sample.texelsPerWorldUnit === "number" &&
    Number.isFinite(sample.texelsPerWorldUnit) &&
    sample.texelsPerWorldUnit > 0
      ? sample.texelsPerWorldUnit
      : undefined;
  return {
    point,
    pressure: normalizedPressure(sample.pressure),
    islandKey: sample.islandId === undefined ? "" : String(sample.islandId),
    ...(sample.world ? { world: sample.world } : {}),
    ...(density === undefined ? {} : { density }),
  };
}

function resolveSamples(
  samples: readonly StudioVrmTextureStrokeSample[],
  size: StudioVrmTextureSize,
  options: StudioVrmTextureStrokePlanOptions,
): {
  readonly resolved: (StudioVrmTextureResolvedStrokeSample | null)[];
  readonly skipped: number;
} {
  let skipped = 0;
  const resolved = samples.map((sample) => {
    const resolvedSample = resolveStudioVrmTextureStrokeSample(sample, size, options);
    if (!resolvedSample) skipped += 1;
    return resolvedSample;
  });
  return { resolved, skipped };
}

export function studioVrmTextureStrokeDabToOps(
  dab: StudioStampBrushDab,
  globalIndex: number,
  style: StudioVrmTextureStrokeStyle,
  brush: StudioStampBrushStyle,
  seedSalt: number,
): StudioVrmTexturePaintOp[] {
  if (style.kind !== "pencil") {
    return [
      {
        x: dab.x,
        y: dab.y,
        radius: dab.radius,
        hardness: brush.hardness,
        color: style.color,
        opacity: dab.alpha,
        blend: style.blend,
      },
    ];
  }

  // 2D 연필과 같은 salt(11/23/37/41/53/67)를 써서 종이 그레인의 결이 캔버스와 같은 성격을 갖는다.
  const jitterX = (stampJitter(globalIndex, 11 + seedSalt) - 0.5) * dab.radius * 0.5;
  const jitterY = (stampJitter(globalIndex, 23 + seedSalt) - 0.5) * dab.radius * 0.5;
  const ops: StudioVrmTexturePaintOp[] = [
    {
      x: dab.x + jitterX,
      y: dab.y + jitterY,
      radius: dab.radius * (0.82 + 0.18 * stampJitter(globalIndex, 41 + seedSalt)),
      hardness: brush.hardness,
      color: style.color,
      opacity: clamp01(dab.alpha * (0.7 + 0.3 * stampJitter(globalIndex, 37 + seedSalt))),
      blend: style.blend,
    },
  ];
  for (let grain = 0; grain < 2; grain += 1) {
    ops.push({
      x: dab.x + (stampJitter(globalIndex, 53 + grain + seedSalt) - 0.5) * dab.radius * 2.4,
      y: dab.y + (stampJitter(globalIndex, 67 + grain + seedSalt) - 0.5) * dab.radius * 2.4,
      radius: Math.max(0.35, dab.radius * 0.2),
      hardness: 1,
      color: style.color,
      opacity: clamp01(dab.alpha * 0.45),
      blend: style.blend,
    });
  }
  return ops;
}

export function resolveStudioVrmTextureStrokeSeamPolicy(
  brush: StudioStampBrushStyle,
  size: StudioVrmTextureSize,
  options: StudioVrmTextureStrokePlanOptions,
): StudioVrmTextureStrokeSeamPolicy {
  return {
    brushSizeTexels: brush.size,
    seamBreakTexels:
      typeof options.seamBreakTexels === "number" && Number.isFinite(options.seamBreakTexels)
        ? Math.max(1, options.seamBreakTexels)
        : Math.max(64, Math.min(size.width, size.height) * 0.25),
    seamStretchRatio:
      typeof options.seamStretchRatio === "number" && Number.isFinite(options.seamStretchRatio)
        ? Math.max(1.5, options.seamStretchRatio)
        : 4,
  };
}

/**
 * 히트 시퀀스를 텍스처 공간 페인트 op 으로 계획한다. GPU/DOM 을 전혀 쓰지 않으므로
 * 라이브 페인트, 커밋 재생, 헤드리스 테스트가 완전히 같은 픽셀 규약을 공유한다.
 */
export function planStudioVrmTextureStroke(
  style: StudioVrmTextureStrokeStyle,
  samples: readonly StudioVrmTextureStrokeSample[],
  size: StudioVrmTextureSize,
  options: StudioVrmTextureStrokePlanOptions = {},
): StudioVrmTextureStrokePlan {
  if (!Array.isArray(samples) || samples.length === 0) return EMPTY_PLAN;
  if (typeof style.sizeTexels !== "number" || !(style.sizeTexels > 0)) return EMPTY_PLAN;
  const brush = resolveStudioVrmTextureStrokeBrush(style);

  const { resolved, skipped } = resolveSamples(samples, size, options);
  const policy = resolveStudioVrmTextureStrokeSeamPolicy(brush, size, options);

  const runs: StudioVrmTextureResolvedStrokeSample[][] = [];
  let seamBreaks = 0;
  let current: StudioVrmTextureResolvedStrokeSample[] = [];
  for (const sample of resolved) {
    if (!sample) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    const previous = current[current.length - 1];
    if (previous && isStudioVrmTextureStrokeSeamBreak(previous, sample, policy)) {
      runs.push(current);
      seamBreaks += 1;
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) runs.push(current);
  if (runs.length === 0) {
    return { ops: [], runs: 0, seamBreaks, skipped, dabs: 0 };
  }

  const maxDabs =
    typeof options.maxDabs === "number" && Number.isFinite(options.maxDabs)
      ? Math.max(0, Math.min(STUDIO_STAMP_BRUSH_MAX_DABS, Math.floor(options.maxDabs)))
      : STUDIO_STAMP_BRUSH_MAX_DABS;
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed ?? 0) : 0;
  const seedSalt = Math.imul(seed, 7919);

  const ops: StudioVrmTexturePaintOp[] = [];
  let globalIndex = 0;
  let dabCount = 0;
  for (const run of runs) {
    if (dabCount >= maxDabs || ops.length >= STUDIO_VRM_TEXTURE_STROKE_MAX_OPS) break;
    const points: number[] = [];
    const pressures: number[] = [];
    for (const sample of run) {
      points.push(sample.point.x, sample.point.y);
      pressures.push(sample.pressure);
    }
    const dabs = planStudioStampBrushDabs(brush, points, pressures, maxDabs - dabCount);
    for (const dab of dabs) {
      for (const op of studioVrmTextureStrokeDabToOps(
        dab,
        globalIndex,
        style,
        brush,
        seedSalt,
      )) {
        if (ops.length >= STUDIO_VRM_TEXTURE_STROKE_MAX_OPS) break;
        ops.push(op);
      }
      globalIndex += 1;
      dabCount += 1;
      if (ops.length >= STUDIO_VRM_TEXTURE_STROKE_MAX_OPS) break;
    }
  }

  return { ops, runs: runs.length, seamBreaks, skipped, dabs: dabCount };
}
