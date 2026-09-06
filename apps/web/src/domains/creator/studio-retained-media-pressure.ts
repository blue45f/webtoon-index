/**
 * Pressure materialisation for retained media that does not own a dedicated dynamic-dab engine.
 *
 * `DrawEl.pressures` already contains the canonical hardware/simulated pressure chosen at the
 * input boundary. This module must therefore never infer velocity or apply a second pressure
 * curve. It only maps that canonical 0..1 channel into renderer-facing material axes.
 *
 * The response is centred at pressure 0.5: mouse input and old documents retain their nominal
 * catalogue appearance, while a stylus can move continuously toward a light or heavy extreme.
 * Pixel/pattern/global-grid brushes are intentionally not represented here.
 */

import { applyStudioMaterialMinimumDiameterRatio } from "./studio-material-pressure-model";

export const STUDIO_RETAINED_MEDIA_PRESSURE_VERSION = 1 as const;

export type StudioRetainedMediaPressureProfileId =
  | "pencil"
  | "pencil-2b"
  | "pencil-6b"
  | "soft-pencil"
  | "colored-pencil"
  | "brush"
  | "flat-brush"
  | "marker-chisel";

export interface StudioRetainedMediaPressureResponse {
  readonly pressure: number;
  /** Physical nib/particle diameter multiplier. */
  readonly sizeScale: number;
  /** Dab/segment pigment alpha multiplier before whole-stroke opacity. */
  readonly opacityScale: number;
  /** Pigment delivery multiplier for buildup-capable renderers. */
  readonly flowScale: number;
}

export interface StudioRetainedMediaCurveSegment
  extends StudioRetainedMediaPressureResponse {
  readonly moveX: number;
  readonly moveY: number;
  readonly controlX: number;
  readonly controlY: number;
  readonly endX: number;
  readonly endY: number;
  readonly sourceSegmentIndex: number;
}

/**
 * Contact mark for a gesture that never travelled.
 *
 * A ribbon needs two distinct samples before it has any extent. Planning a tap as a ribbon either
 * yields no segment at all or — once the pencil grain jitter has nudged the coincident samples
 * apart — a sub-pixel sliver whose coverage is far below the nib the user pressed down.
 */
export interface StudioRetainedMediaTapDab
  extends StudioRetainedMediaPressureResponse {
  readonly x: number;
  readonly y: number;
}

export interface StudioRetainedMediaCurvePlan {
  readonly kind: "studio-retained-media-pressure-curve";
  readonly version: typeof STUDIO_RETAINED_MEDIA_PRESSURE_VERSION;
  readonly profileId: StudioRetainedMediaPressureProfileId;
  readonly sourcePointCount: number;
  readonly segments: readonly StudioRetainedMediaCurveSegment[];
}

export interface StudioRetainedMediaCurveOptions {
  /** Retained-path bend response. Kept explicit so legacy and accepted-sample documents remain distinct. */
  readonly tension?: unknown;
  /** Persisted geometry-only floor. Omitted legacy strokes keep their previous dimensions. */
  readonly minimumDiameterRatio?: unknown;
}

interface ResponseAxis {
  readonly light: number;
  readonly heavy: number;
  readonly curve: number;
}

interface ResponseProfile {
  /** New input-profile nominal pressure. Legacy documents used 0.5 as the same neutral width. */
  readonly nominalPressure: number;
  readonly size: ResponseAxis;
  readonly opacity: ResponseAxis;
  readonly flow: ResponseAxis;
}

const MAX_COORDINATE_ABS = 1_000_000_000;
const MAX_SOURCE_POINTS = 1_000_000;
const DEFAULT_PRESSURE = 0.5;
/**
 * Mirrors the ribbon planner's own degenerate-direction threshold. Below it no flattened cell can
 * exist, so a tap dab and ribbon cells are mutually exclusive descriptions of the same gesture.
 */
const TAP_EXTENT_EPSILON = 1e-6;

const PROFILE: Readonly<Record<StudioRetainedMediaPressureProfileId, ResponseProfile>> = {
  pencil: {
    nominalPressure: 0.58,
    size: { light: 0.58, heavy: 1.34, curve: 0.92 },
    opacity: { light: 0.38, heavy: 1.16, curve: 0.82 },
    flow: { light: 0.44, heavy: 1.24, curve: 0.88 },
  },
  "pencil-2b": {
    nominalPressure: 0.58,
    size: { light: 0.62, heavy: 1.4, curve: 0.88 },
    opacity: { light: 0.44, heavy: 1.2, curve: 0.78 },
    flow: { light: 0.5, heavy: 1.3, curve: 0.84 },
  },
  "pencil-6b": {
    nominalPressure: 0.58,
    size: { light: 0.66, heavy: 1.48, curve: 0.82 },
    opacity: { light: 0.5, heavy: 1.24, curve: 0.72 },
    flow: { light: 0.54, heavy: 1.36, curve: 0.8 },
  },
  "soft-pencil": {
    nominalPressure: 0.58,
    size: { light: 0.7, heavy: 1.54, curve: 0.8 },
    opacity: { light: 0.46, heavy: 1.22, curve: 0.74 },
    flow: { light: 0.5, heavy: 1.34, curve: 0.8 },
  },
  "colored-pencil": {
    nominalPressure: 0.58,
    size: { light: 0.64, heavy: 1.3, curve: 0.94 },
    opacity: { light: 0.42, heavy: 1.14, curve: 0.86 },
    flow: { light: 0.48, heavy: 1.2, curve: 0.9 },
  },
  brush: {
    nominalPressure: 0.65,
    size: { light: 0.42, heavy: 1.58, curve: 0.84 },
    opacity: { light: 0.56, heavy: 1.12, curve: 0.9 },
    flow: { light: 0.48, heavy: 1.3, curve: 0.86 },
  },
  "flat-brush": {
    nominalPressure: 0.65,
    size: { light: 0.5, heavy: 1.46, curve: 0.9 },
    opacity: { light: 0.62, heavy: 1.1, curve: 0.94 },
    flow: { light: 0.54, heavy: 1.24, curve: 0.9 },
  },
  // Chisel felt marker (marker--chisel-ribbon): a firm wedge nib keeps its footprint almost
  // constant across the pressure range — what pressure moves is ink delivery, not width.
  "marker-chisel": {
    nominalPressure: 0.6,
    size: { light: 0.86, heavy: 1.12, curve: 0.95 },
    opacity: { light: 0.72, heavy: 1.16, curve: 0.85 },
    flow: { light: 0.64, heavy: 1.28, curve: 0.8 },
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPressure(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_PRESSURE;
}

function centeredAxisResponse(
  pressure: number,
  neutralPressure: number,
  axis: ResponseAxis,
): number {
  // Historical mouse/document pressure was 0.5, while the newer material-family input profiles
  // start pencil/ribbon strokes at 0.58/0.65. Treat both as the same selected toolbar size so
  // enabling retained pressure cannot make the first point jump. Stylus response remains smooth
  // and monotonic on either side of this deliberately small neutral plateau.
  if (pressure >= DEFAULT_PRESSURE && pressure <= neutralPressure) return 1;
  if (pressure < DEFAULT_PRESSURE) {
    const distance = 1 - pressure / DEFAULT_PRESSURE;
    return 1 - (1 - axis.light) * Math.pow(distance, axis.curve);
  }
  const distance = (pressure - neutralPressure) / Math.max(0.001, 1 - neutralPressure);
  return 1 + (axis.heavy - 1) * Math.pow(distance, axis.curve);
}

/**
 * Largest diameter multiplier a profile can ever return, for O(1) paint-footprint budgeting.
 *
 * `centeredAxisResponse` is monotonic in pressure above the neutral plateau and reaches its
 * maximum, `axis.heavy`, exactly at pressure 1; below the plateau it only descends toward
 * `axis.light`. `applyStudioMaterialMinimumDiameterRatio` then raises small values toward a ratio
 * the type constrains to [0, 1], and every profile's `heavy` is above 1, so the floor can never
 * lift the result past it. The maximum is therefore `heavy` for every input.
 *
 * Callers that need a paint radius before touching the samples -- live transform work admission --
 * multiply this by the nib half-width rather than scanning the pressure array per frame.
 */
export function studioRetainedMediaMaximumSizeScale(
  profileId: StudioRetainedMediaPressureProfileId,
): number {
  return PROFILE[profileId].size.heavy;
}

export function resolveStudioRetainedMediaPressureProfileId(
  brushId: unknown,
): StudioRetainedMediaPressureProfileId | null {
  switch (brushId) {
    case "pencil":
    case "pencil-2b":
    case "pencil-6b":
    case "soft-pencil":
    case "colored-pencil":
    case "brush":
    case "flat-brush":
      return brushId;
    case "marker--chisel-ribbon":
      return "marker-chisel";
    default:
      return null;
  }
}

export function resolveStudioRetainedMediaPressure(
  profileId: StudioRetainedMediaPressureProfileId,
  pressureInput: unknown,
  minimumDiameterRatio?: unknown,
): StudioRetainedMediaPressureResponse {
  const pressure = normalizedPressure(pressureInput);
  const profile = PROFILE[profileId];
  return Object.freeze({
    pressure,
    sizeScale: applyStudioMaterialMinimumDiameterRatio(
      centeredAxisResponse(pressure, profile.nominalPressure, profile.size),
      minimumDiameterRatio,
    ),
    opacityScale: centeredAxisResponse(pressure, profile.nominalPressure, profile.opacity),
    flowScale: centeredAxisResponse(pressure, profile.nominalPressure, profile.flow),
  });
}

function pressureAtProgress(
  pressures: readonly number[] | null | undefined,
  progress: number,
): number {
  if (!pressures || pressures.length === 0) return DEFAULT_PRESSURE;
  if (pressures.length === 1) return normalizedPressure(pressures[0]);
  const position = clamp(progress, 0, 1) * (pressures.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(pressures.length - 1, Math.ceil(position));
  const amount = position - lowerIndex;
  const lower = normalizedPressure(pressures[lowerIndex]);
  const upper = normalizedPressure(pressures[upperIndex]);
  return lower + (upper - lower) * amount;
}

/**
 * 시리즈의 `index` 번째 항목 하나 — 배치 시리즈와 같은 진행률 식이다.
 *
 * 필압 배열이 점과 나란하면 진행률 식이 가리키는 슬롯을 그대로 읽는다. `(index / (count - 1))
 * * (count - 1)` 은 이진 부동소수에서 `index` 로 정확히 되돌아오지 않아(count = 800 일 때
 * index = 357 은 356.99999999999994 로 떨어져 이웃 값이 섞인다) **앞선 표본의 값이 획이
 * 얼마나 자랐는지에 따라 달라졌다**. 오차 자체는 ~1e-15 로 보이지 않지만, 증분 플래너들이
 * 접두 재사용을 판정하는 바이트 동일성 비교를 깨서 이동마다 전체 재계획을 물게 했다. 슬롯을
 * 직접 읽으면 반올림과 그 의존성이 함께 사라지고, 증분 소비자와 최종 배치가 ulp 까지 같아진다.
 * 길이가 어긋난 저널(레거시 문서·재표본화 시리즈)은 정규화 경로를 그대로 쓴다.
 */
export function resolveStudioRetainedMediaPressureAt(
  profileId: StudioRetainedMediaPressureProfileId,
  pressures: readonly number[] | null | undefined,
  index: number,
  count: number,
  minimumDiameterRatio?: unknown,
): StudioRetainedMediaPressureResponse {
  const aligned = pressures && pressures.length === count && index >= 0 && index < count;
  return resolveStudioRetainedMediaPressure(
    profileId,
    aligned
      ? normalizedPressure(pressures[index])
      : pressureAtProgress(pressures, count <= 1 ? 0 : index / (count - 1)),
    minimumDiameterRatio,
  );
}

/** Aligns an arbitrary persisted pressure journal to a renderer-owned point count. */
export function resolveStudioRetainedMediaPressureSeries(
  profileId: StudioRetainedMediaPressureProfileId,
  pressures: readonly number[] | null | undefined,
  requestedCount: unknown,
  minimumDiameterRatio?: unknown,
): readonly StudioRetainedMediaPressureResponse[] {
  const count = typeof requestedCount === "number" && Number.isFinite(requestedCount)
    ? clamp(Math.floor(requestedCount), 0, MAX_SOURCE_POINTS)
    : 0;
  if (count === 0) return Object.freeze([]);
  return Object.freeze(Array.from({ length: count }, (_, index) => (
    resolveStudioRetainedMediaPressureAt(
      profileId,
      pressures,
      index,
      count,
      minimumDiameterRatio,
    )
  )));
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS)
    : null;
}

/** Leading run of well-formed coordinate pairs. Planning stops at the first malformed sample. */
function finitePointPrefix(points: readonly number[]): number[] {
  const requestedPointCount = Math.min(
    MAX_SOURCE_POINTS,
    Math.floor(points.length / 2),
  );
  const finitePoints: number[] = [];
  for (let pointIndex = 0; pointIndex < requestedPointCount; pointIndex += 1) {
    const x = finiteCoordinate(points[pointIndex * 2]);
    const y = finiteCoordinate(points[pointIndex * 2 + 1]);
    if (x === null || y === null) break;
    finitePoints.push(x, y);
  }
  return finitePoints;
}

/**
 * Resolves the contact mark of a gesture whose accepted samples never separated.
 *
 * The response is evaluated at the contact pressure rather than an average: a tap deposits what the
 * nib delivered when it touched down. Returns null as soon as any sample moved, so a travelling
 * stroke keeps its existing segment-only plan byte for byte.
 */
function tapDabOfFinitePoints(
  finitePoints: readonly number[],
  pressures: readonly number[] | null | undefined,
  profileId: StudioRetainedMediaPressureProfileId,
  minimumDiameterRatio: unknown,
): StudioRetainedMediaTapDab | null {
  const pointCount = Math.floor(finitePoints.length / 2);
  if (pointCount < 1) return null;
  const x = finitePoints[0]!;
  const y = finitePoints[1]!;
  for (let pointIndex = 1; pointIndex < pointCount; pointIndex += 1) {
    if (
      Math.abs(finitePoints[pointIndex * 2]! - x) > TAP_EXTENT_EPSILON
      || Math.abs(finitePoints[pointIndex * 2 + 1]! - y) > TAP_EXTENT_EPSILON
    ) return null;
  }
  return Object.freeze({
    x,
    y,
    ...resolveStudioRetainedMediaPressure(
      profileId,
      pressureAtProgress(pressures, 0),
      minimumDiameterRatio,
    ),
  });
}

/**
 * Standalone contact mark for renderers that do not build a pressure curve, such as the legacy
 * alias pencil passes. Non-null only for a gesture with no extent.
 */
export function planStudioRetainedMediaTapDab(
  points: readonly number[],
  pressures: readonly number[] | null | undefined,
  profileId: StudioRetainedMediaPressureProfileId,
  options?: StudioRetainedMediaCurveOptions | null,
): StudioRetainedMediaTapDab | null {
  return tapDabOfFinitePoints(
    finitePointPrefix(points),
    pressures,
    profileId,
    options?.minimumDiameterRatio,
  );
}

/**
 * Converts the midpoint-quadratic path used by retained pencil rendering into pressure-bearing
 * segments. Each response is evaluated at the segment midpoint, preventing width steps at noisy
 * sample boundaries while preserving the exact first and final coordinates.
 */
export function planStudioRetainedMediaPressureCurve(
  points: readonly number[],
  pressures: readonly number[] | null | undefined,
  profileId: StudioRetainedMediaPressureProfileId,
  options?: StudioRetainedMediaCurveOptions | null,
): StudioRetainedMediaCurvePlan {
  const finitePoints = finitePointPrefix(points);
  const sourcePointCount = finitePoints.length / 2;
  if (sourcePointCount < 2) {
    return Object.freeze({
      kind: "studio-retained-media-pressure-curve",
      version: STUDIO_RETAINED_MEDIA_PRESSURE_VERSION,
      profileId,
      sourcePointCount,
      segments: Object.freeze([]),
    });
  }

  const segments: StudioRetainedMediaCurveSegment[] = [];
  const tension = typeof options?.tension === "number" && Number.isFinite(options.tension)
    ? clamp(options.tension, 0, 1)
    : 0.2;
  let moveX = finitePoints[0]!;
  let moveY = finitePoints[1]!;
  for (let pointIndex = 1; pointIndex < sourcePointCount; pointIndex += 1) {
    const previousX = finitePoints[(pointIndex - 1) * 2]!;
    const previousY = finitePoints[(pointIndex - 1) * 2 + 1]!;
    const currentX = finitePoints[pointIndex * 2]!;
    const currentY = finitePoints[pointIndex * 2 + 1]!;
    // Pull the midpoint quadratic control slightly toward the arriving sample. This preserves the
    // historical accepted-vs-legacy tension distinction without introducing a non-causal
    // look-ahead or moving either endpoint.
    const controlPull = tension * 0.5;
    const controlX = previousX + (currentX - previousX) * controlPull;
    const controlY = previousY + (currentY - previousY) * controlPull;
    const finalSegment = pointIndex === sourcePointCount - 1;
    const endX = finalSegment ? currentX : (previousX + currentX) / 2;
    const endY = finalSegment ? currentY : (previousY + currentY) / 2;
    const startProgress = (pointIndex - 1) / (sourcePointCount - 1);
    const endProgress = pointIndex / (sourcePointCount - 1);
    const pressure = (
      pressureAtProgress(pressures, startProgress)
      + pressureAtProgress(pressures, endProgress)
    ) / 2;
    segments.push(Object.freeze({
      moveX,
      moveY,
      controlX,
      controlY,
      endX,
      endY,
      sourceSegmentIndex: pointIndex - 1,
      ...resolveStudioRetainedMediaPressure(
        profileId,
        pressure,
        options?.minimumDiameterRatio,
      ),
    }));
    moveX = endX;
    moveY = endY;
  }

  return Object.freeze({
    kind: "studio-retained-media-pressure-curve",
    version: STUDIO_RETAINED_MEDIA_PRESSURE_VERSION,
    profileId,
    sourcePointCount,
    segments: Object.freeze(segments),
  });
}

export interface StudioIncrementalRetainedMediaCurveBuilder {
  /**
   * 자라나는 스트로크의 현재 스냅샷을 소비하고 지금까지의 곡선 계획을 돌려준다. 이미 소비한
   * prefix의 선분은 다시 계산하지 않는다 — 이동 한 번의 비용이 새 점 수에만 비례한다. 마지막
   * 선분만은 "교체 가능한 꼬리"다: 배치 빌더가 최종 선분의 끝을 원시 끝점에 두므로, 다음 점이
   * 도착하면 그 선분의 끝이 중점으로 물러난다(선분 개수와 sourceSegmentIndex는 불변). 반환
   * plan의 segments는 빌더 내부 보관 배열이므로 수정하면 안 된다.
   */
  append(
    points: readonly number[],
    pressures: readonly number[] | null | undefined,
  ): StudioRetainedMediaCurvePlan;
}

/** 점 배열과 나란한 필압 배열에서 점 index의 정규화 필압(진행률 표본화의 나란한-배열 특수화). */
function parallelPointPressure(
  pressures: readonly number[] | null | undefined,
  index: number,
): number {
  if (!pressures || pressures.length === 0) return DEFAULT_PRESSURE;
  if (pressures.length === 1) return normalizedPressure(pressures[0]);
  return normalizedPressure(pressures[Math.min(pressures.length - 1, index)]);
}

/**
 * 라이브 오버레이용 증분 리테인드 미디어 필압 곡선 빌더.
 *
 * `planStudioRetainedMediaPressureCurve`는 진행률 비례 필압 표본화와 "최종 선분은 원시
 * 끝점에서 끝난다" 규칙 때문에 매 이동 전체를 다시 세운다(이동당 O(n) — 장획 게이트가 잡는
 * 형태). 필압 배열이 점 배열과 나란할 때(라이브 원소가 항상 이 경우다) 진행률 표본화는 이웃
 * 두 샘플의 평균으로 환원되어 선분이 국소 함수가 되고, 최종-선분 규칙은 위 append 계약의
 * 교체 가능한 꼬리로 흡수된다. 좌표 검증·클램프는 배치의 `finitePointPrefix`와 같은 "첫
 * 비유한 좌표에서 절단" 규약을 새 suffix에만 적용한다. prefix가 다시 쓰였는지는 마지막 소비
 * 점 하나로 O(1) 검증하고, 다르면 전체를 다시 만든다(비용은 그 한 번의 O(n)).
 * 나란하지 않은 필압 배열은 진행률 표본화와 값이 어긋날 수 있다 — 커밋 렌더러가 배치
 * 빌더로 정본을 다시 그리므로 라이브 프리뷰 한정 근사다.
 */
export function createStudioIncrementalRetainedMediaCurveBuilder(
  profileId: StudioRetainedMediaPressureProfileId,
  options?: StudioRetainedMediaCurveOptions | null,
): StudioIncrementalRetainedMediaCurveBuilder {
  const tension = typeof options?.tension === "number" && Number.isFinite(options.tension)
    ? clamp(options.tension, 0, 1)
    : 0.2;
  const controlPull = tension * 0.5;
  const minimumDiameterRatio = options?.minimumDiameterRatio;
  const segments: StudioRetainedMediaCurveSegment[] = [];
  let consumedPoints = 0;
  // 마지막으로 소비한 두 원시 점(클램프 적용) — 꼬리 선분 재계산과 O(1) prefix 검증에 쓴다.
  let prevX = 0;
  let prevY = 0;
  let prevPrevX = 0;
  let prevPrevY = 0;

  const reset = (): void => {
    segments.length = 0;
    consumedPoints = 0;
  };

  return {
    append(points, pressures) {
      const pointCount = Math.min(MAX_SOURCE_POINTS, Math.floor(points.length / 2));
      if (pointCount < consumedPoints) reset();
      if (consumedPoints > 0) {
        const lastIndex = consumedPoints - 1;
        if (
          finiteCoordinate(points[lastIndex * 2]) !== prevX
          || finiteCoordinate(points[lastIndex * 2 + 1]) !== prevY
        ) {
          reset();
        }
      }
      if (consumedPoints === 0 && pointCount > 0) {
        const firstX = finiteCoordinate(points[0]);
        const firstY = finiteCoordinate(points[1]);
        if (firstX !== null && firstY !== null) {
          prevX = firstX;
          prevY = firstY;
          consumedPoints = 1;
        }
      }
      for (
        let pointIndex = consumedPoints;
        pointIndex >= 1 && pointIndex < pointCount;
        pointIndex += 1
      ) {
        const currentX = finiteCoordinate(points[pointIndex * 2]);
        const currentY = finiteCoordinate(points[pointIndex * 2 + 1]);
        // 첫 비유한 좌표에서 절단(배치 `finitePointPrefix` 규약): 이 점과 그 뒤는 소비하지 않는다.
        if (currentX === null || currentY === null) break;
        let moveX = prevX;
        let moveY = prevY;
        const tail = segments.length > 0 ? segments[segments.length - 1]! : null;
        if (tail) {
          // 직전 최종 선분의 끝을 원시 끝점에서 중점으로 물린다(배치의 비최종 규칙).
          const demotedEndX = (prevPrevX + prevX) / 2;
          const demotedEndY = (prevPrevY + prevY) / 2;
          segments[segments.length - 1] = Object.freeze({
            ...tail,
            endX: demotedEndX,
            endY: demotedEndY,
          });
          moveX = demotedEndX;
          moveY = demotedEndY;
        }
        const pressure = (
          parallelPointPressure(pressures, pointIndex - 1)
          + parallelPointPressure(pressures, pointIndex)
        ) / 2;
        segments.push(Object.freeze({
          moveX,
          moveY,
          controlX: prevX + (currentX - prevX) * controlPull,
          controlY: prevY + (currentY - prevY) * controlPull,
          endX: currentX,
          endY: currentY,
          sourceSegmentIndex: pointIndex - 1,
          ...resolveStudioRetainedMediaPressure(profileId, pressure, minimumDiameterRatio),
        }));
        prevPrevX = prevX;
        prevPrevY = prevY;
        prevX = currentX;
        prevY = currentY;
        consumedPoints = pointIndex + 1;
      }
      return {
        kind: "studio-retained-media-pressure-curve",
        version: STUDIO_RETAINED_MEDIA_PRESSURE_VERSION,
        profileId,
        sourcePointCount: consumedPoints,
        segments,
      };
    },
  };
}
