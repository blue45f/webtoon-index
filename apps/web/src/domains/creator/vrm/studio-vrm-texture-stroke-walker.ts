/**
 * VRM 텍스처 획의 증분 planner.
 *
 * batch planner(`planStudioVrmTextureStroke`)는 저장/재생의 기준 규약으로 남기고, 라이브 입력은
 * 이 walker에 샘플 하나씩 추가한다. geometry/sample 배열을 보관하거나 이미 처리한 prefix를
 * 다시 계획하지 않으며, 각 append는 새 선분 하나만 걸어 새 op suffix만 반환한다.
 *
 * stamp segment 수학은 `studio-brush-stamp-engine`의 순수 내부 walker와 의도적으로 동일하다.
 * 이 모듈의 parity 테스트가 모든 브러시·필압·심·wrap 조합에서 batch 결과와 동등함을 고정한다.
 */

import {
  beginStampWalker,
  STUDIO_STAMP_BRUSH_MAX_DABS,
  studioStampInkSpeedFactor,
  type StudioStampBrushDab,
  type StudioStampBrushKind,
  type StudioStampBrushStyle,
  type StudioStampWalkerState,
} from "../brush/studio-brush-stamp-engine";

import {
  isStudioVrmTextureStrokeSeamBreak,
  resolveStudioVrmTextureStrokeBrush,
  resolveStudioVrmTextureStrokeSample,
  resolveStudioVrmTextureStrokeSeamPolicy,
  STUDIO_VRM_TEXTURE_STROKE_MAX_OPS,
  studioVrmTextureStrokeDabToOps,
  type StudioVrmTextureResolvedStrokeSample,
  type StudioVrmTextureStrokePlanOptions,
  type StudioVrmTextureStrokeSample,
  type StudioVrmTextureStrokeStyle,
} from "./studio-vrm-texture-stroke";

import type { StudioVrmTexturePaintOp } from "./studio-vrm-texture-paint-ops";
import type { StudioVrmTextureSize } from "./studio-vrm-texture-uv";

/**
 * `resolveStudioVrmTextureStrokeBrush`가 만드는 스타일은 항상 `spacingRatio`를 실어 오므로
 * 이 표는 손으로 조립한 스타일의 폴백일 뿐이다. 값은 studio-brush-stamp-engine 의
 * STAMP_SPACING_RATIO 와 동일하게 유지한다 — walker 가 batch planner(저장/재생 기준 규약)와
 * 다른 간격으로 걸으면 라이브 dab 위치가 재생과 어긋난다.
 */
const STAMP_SPACING_RATIO: Readonly<Record<StudioStampBrushKind, number>> = Object.freeze({
  airbrush: 0.12,
  pencil: 0.24,
  ink: 0.32,
  watercolor: 0.09,
  mypaint: 0.2,
  "krita-auto": 0.15,
  crayon: 0.16,
  chalk: 0.14,
  charcoal: 0.18,
  pastel: 0.13,
});

export interface StudioVrmTextureStrokeWalkerSnapshot {
  readonly runs: number;
  readonly seamBreaks: number;
  readonly skipped: number;
  readonly dabs: number;
  /** 지금까지 suffix로 방출한 op 수. op 배열 자체는 보관하지 않는다. */
  readonly ops: number;
  readonly exhausted: boolean;
  readonly disabled: boolean;
}

export interface StudioVrmTextureStrokeWalkerAppendResult {
  /** 이번 sample 때문에 새로 생긴 suffix만 포함한다. */
  readonly ops: readonly StudioVrmTexturePaintOp[];
  readonly dabs: number;
  readonly runStarted: boolean;
  readonly seamBreak: boolean;
  readonly skipped: boolean;
  readonly snapshot: StudioVrmTextureStrokeWalkerSnapshot;
}

export interface StudioVrmTextureStrokeWalker {
  append(sample: StudioVrmTextureStrokeSample): StudioVrmTextureStrokeWalkerAppendResult;
  snapshot(): StudioVrmTextureStrokeWalkerSnapshot;
}

interface ActiveRun {
  readonly state: StudioStampWalkerState;
  /** batch planner가 이 run에 넘기는 `maxDabs - 이전 run dab 수`와 동일한 절대 상한. */
  readonly dabLimit: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pressureRadius(style: StudioStampBrushStyle, pressure: number): number {
  const ratio =
    clamp01(style.minSizeRatio) + (1 - clamp01(style.minSizeRatio)) * clamp01(pressure);
  return Math.max(0.35, (style.size / 2) * ratio);
}

// 잉크 속도 감쇠는 studio-brush-stamp-engine 에서 직접 가져온다. 이 모듈은 walk 루프를 batch
// planner 와 의도적으로 이중화하지만, 감쇠 산식까지 복사해 두었더니 획 머리 이징이 batch 쪽에만
// 들어가면서 두 경로의 반지름이 갈렸다(패리티 테스트가 정확히 이걸 잡았다). 루프는 그대로 두고
// 산식만 한 곳에서 읽는다.

/**
 * 기존 stamp engine의 segment core와 같은 상태 전이. public Canvas API를 우회해 fake context를
 * 만들지 않고 논리 dab을 직접 방출하기 위해 이 작은 순수 루프만 독립 모듈에 둔다.
 */
function walkIncrementalStampSegment(
  style: StudioStampBrushStyle,
  state: StudioStampWalkerState,
  x: number,
  y: number,
  pressure: number,
  maximumDabs: number,
  emit: (dab: StudioStampBrushDab) => void,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const safePressure = Number.isFinite(pressure) ? clamp01(pressure) : 0.5;
  const dx = x - state.lastX;
  const dy = y - state.lastY;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0) return;
  const normalizedSpeed = style.kind === "ink" ? distance / Math.max(1, style.size) : 0;
  const baseAlpha = clamp01(style.flow) * clamp01(style.opacity);
  let travelled = state.residual;
  const spacingOf = (samplePressure: number): number =>
    Math.max(
      0.5,
      pressureRadius(style, samplePressure)
        * 2
        * (style.spacingRatio ?? STAMP_SPACING_RATIO[style.kind]),
    );
  if (travelled === 0 && state.stampIndex > 0) {
    travelled = spacingOf(state.lastPressure);
  }
  while (travelled <= distance && state.stampIndex < maximumDabs) {
    const t = distance === 0 ? 0 : travelled / distance;
    const px = state.lastX + dx * t;
    const py = state.lastY + dy * t;
    const interpolatedPressure =
      state.lastPressure + (safePressure - state.lastPressure) * t;
    emit({
      x: px,
      y: py,
      radius: pressureRadius(style, interpolatedPressure)
        * studioStampInkSpeedFactor(style, normalizedSpeed, state.stampIndex),
      alpha: baseAlpha,
      index: state.stampIndex,
    });
    state.stampIndex += 1;
    travelled += spacingOf(interpolatedPressure);
  }
  state.residual = state.stampIndex >= maximumDabs ? 0 : travelled - distance;
  state.lastX = x;
  state.lastY = y;
  state.lastPressure = safePressure;
}

function normalizedMaxDabs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(STUDIO_STAMP_BRUSH_MAX_DABS, Math.floor(value)))
    : STUDIO_STAMP_BRUSH_MAX_DABS;
}

function copyStyle(style: StudioVrmTextureStrokeStyle): StudioVrmTextureStrokeStyle {
  return Object.freeze({
    ...style,
    ...(style.tuning ? { tuning: Object.freeze({ ...style.tuning }) } : {}),
  });
}

function copyOptions(
  options: StudioVrmTextureStrokePlanOptions,
): StudioVrmTextureStrokePlanOptions {
  return Object.freeze({ ...options });
}

function createDot(
  brush: StudioStampBrushStyle,
  sample: StudioVrmTextureResolvedStrokeSample,
): StudioStampBrushDab {
  return {
    x: sample.point.x,
    y: sample.point.y,
    radius: pressureRadius(brush, sample.pressure),
    alpha: clamp01(brush.flow) * clamp01(brush.opacity),
    index: 0,
  };
}

/**
 * 한 획당 하나를 만든다. 이 객체가 유지하는 것은 마지막 해석 sample, stamp residual과 정수
 * 카운터뿐이며, 원본 samples나 누적 ops는 저장하지 않는다.
 */
export function createStudioVrmTextureStrokeWalker(
  rawStyle: StudioVrmTextureStrokeStyle,
  rawSize: StudioVrmTextureSize,
  rawOptions: StudioVrmTextureStrokePlanOptions = {},
): StudioVrmTextureStrokeWalker {
  const style = copyStyle(rawStyle);
  const size: StudioVrmTextureSize = Object.freeze({ ...rawSize });
  const options = copyOptions(rawOptions);
  const disabled = typeof style.sizeTexels !== "number" || !(style.sizeTexels > 0);
  const brush = disabled ? null : resolveStudioVrmTextureStrokeBrush(style);
  const seamPolicy = brush
    ? resolveStudioVrmTextureStrokeSeamPolicy(brush, size, options)
    : null;
  const maxDabs = normalizedMaxDabs(options.maxDabs);
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed ?? 0) : 0;
  const seedSalt = Math.imul(seed, 7919);

  let previous: StudioVrmTextureResolvedStrokeSample | null = null;
  let activeRun: ActiveRun | null = null;
  let runs = 0;
  let seamBreaks = 0;
  let skipped = 0;
  let dabCount = 0;
  let opCount = 0;

  function exhausted(): boolean {
    return disabled || dabCount >= maxDabs || opCount >= STUDIO_VRM_TEXTURE_STROKE_MAX_OPS;
  }

  function snapshot(): StudioVrmTextureStrokeWalkerSnapshot {
    return Object.freeze({
      runs,
      seamBreaks,
      skipped,
      dabs: dabCount,
      ops: opCount,
      exhausted: exhausted(),
      disabled,
    });
  }

  function appendDab(dab: StudioStampBrushDab, suffix: StudioVrmTexturePaintOp[]): boolean {
    if (!brush || exhausted()) return false;
    const generated = studioVrmTextureStrokeDabToOps(
      dab,
      dabCount,
      style,
      brush,
      seedSalt,
    );
    const remainingOps = STUDIO_VRM_TEXTURE_STROKE_MAX_OPS - opCount;
    if (remainingOps <= 0) return false;
    const accepted = generated.slice(0, remainingOps);
    suffix.push(...accepted);
    opCount += accepted.length;
    dabCount += 1;
    return true;
  }

  function availableDabsByOpBudget(): number {
    const remainingOps = STUDIO_VRM_TEXTURE_STROKE_MAX_OPS - opCount;
    if (remainingOps <= 0) return 0;
    return style.kind === "pencil" ? Math.ceil(remainingOps / 3) : remainingOps;
  }

  function beginRun(
    sample: StudioVrmTextureResolvedStrokeSample,
    suffix: StudioVrmTexturePaintOp[],
  ): void {
    runs += 1;
    const state = beginStampWalker(sample.point.x, sample.point.y, sample.pressure);
    activeRun = { state, dabLimit: maxDabs - dabCount };
    if (activeRun.dabLimit <= 0 || availableDabsByOpBudget() <= 0) return;
    if (appendDab(createDot(brush as StudioStampBrushStyle, sample), suffix)) {
      state.stampIndex = 1;
    }
  }

  function walkRun(
    sample: StudioVrmTextureResolvedStrokeSample,
    suffix: StudioVrmTexturePaintOp[],
  ): void {
    if (!brush || !activeRun || exhausted()) return;
    const available = Math.min(
      maxDabs - dabCount,
      availableDabsByOpBudget(),
    );
    if (available <= 0) return;
    const maximumRunDabs = Math.min(
      activeRun.dabLimit,
      activeRun.state.stampIndex + available,
    );
    if (maximumRunDabs <= activeRun.state.stampIndex) return;
    walkIncrementalStampSegment(
      brush,
      activeRun.state,
      sample.point.x,
      sample.point.y,
      sample.pressure,
      maximumRunDabs,
      (dab) => {
        appendDab(dab, suffix);
      },
    );
  }

  return Object.freeze({
    append(sample: StudioVrmTextureStrokeSample): StudioVrmTextureStrokeWalkerAppendResult {
      const suffix: StudioVrmTexturePaintOp[] = [];
      if (disabled || !brush || !seamPolicy) {
        return Object.freeze({
          ops: Object.freeze(suffix),
          dabs: 0,
          runStarted: false,
          seamBreak: false,
          skipped: false,
          snapshot: snapshot(),
        });
      }

      const resolved = resolveStudioVrmTextureStrokeSample(sample, size, options);
      if (!resolved) {
        skipped += 1;
        previous = null;
        activeRun = null;
        return Object.freeze({
          ops: Object.freeze(suffix),
          dabs: 0,
          runStarted: false,
          seamBreak: false,
          skipped: true,
          snapshot: snapshot(),
        });
      }

      const seamBreak =
        previous !== null &&
        isStudioVrmTextureStrokeSeamBreak(previous, resolved, seamPolicy);
      if (seamBreak) {
        seamBreaks += 1;
        activeRun = null;
      }
      const runStarted = activeRun === null;
      const previousDabCount = dabCount;
      if (runStarted) beginRun(resolved, suffix);
      else walkRun(resolved, suffix);
      previous = resolved;

      return Object.freeze({
        ops: Object.freeze(suffix),
        dabs: dabCount - previousDabCount,
        runStarted,
        seamBreak,
        skipped: false,
        snapshot: snapshot(),
      });
    },
    snapshot,
  });
}
