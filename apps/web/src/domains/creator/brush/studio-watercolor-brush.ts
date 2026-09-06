/**
 * Studio Watercolor Brush Dab Planner
 *
 * 자연 매체 수채 브러시 렌더러가 소비할 순수 dab 계획기다. Canvas/Konva를 직접 그리지 않고
 * 평면 스트로크 `[x0, y0, x1, y1, …]`를 순서 있는 core/diffuse dab 목록으로 바꾼다.
 *
 * - core: 스트로크 중심을 잇는 작은 안료 침착. 시작/끝 core는 항상 정확한 입력 종점에 놓인다.
 * - diffuse: core 주변의 크고 옅은 물 번짐. seed 기반으로만 흔들려 다시 렌더해도 깜빡이지 않는다.
 *
 * 성능 원칙:
 * - 경로를 일정 호 길이로 한 번만 재표본화한다.
 * - 생성 dab 수는 hard cap 안에 묶여 긴 스트로크도 렌더 작업량이 폭증하지 않는다.
 * - cap에 걸리면 core 연속성을 우선하고, 두 종점을 표현할 수 있도록 cap의 하한은 2다.
 * - cap 재분배로 station 간격이 core 직경을 넘어 구슬화(beading)될 상황이면 dab 수를 늘리지 않고
 *   반경을 간격에 비례해 키워 커버리지 연속성을 유지한다(적은 수의 더 넓은 wash).
 *
 * `hash2`는 기존 grain 엔진의 검증된 결정적 좌표 해시를 재사용한다. Math.random/DOM/Konva는 없다.
 */

import { hash2 } from "../studio-grain";

// ---------------------------------------------------------------------------
// 공개 타입·기본값
// ---------------------------------------------------------------------------

/** 렌더러가 drawImage/원형 그라디언트/파티클 등으로 소비할 하나의 수채 dab. */
export type WatercolorBrushDab = {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  role: "core" | "diffuse";
};

/** 평면 포인트 입력과 수채 dab 플래너 제어값. */
export type WatercolorBrushPlanInput = {
  /** `[x0, y0, x1, y1, …]` 형식. 비유한 좌표 쌍은 안전하게 건너뛴다. */
  points: readonly number[];
  /** 원본 포인트 진행률에 대응하는 선택 필압. 길이가 달라도 진행률 보간으로 소비한다. */
  pressures?: readonly number[] | null;
  /** 기존 브러시 폭(직경)과 같은 단위의 기본 폭. */
  baseWidth: number;
  /** 같은 seed는 같은 반경·농도·번짐 위치를 만든다. */
  seed: number;
  /** 최종 dab 상한. 2..2048로 정규화한다. */
  maxDabs?: number;
  /** dab 중심 간격(px). 누락/무효면 baseWidth에 비례한 자동 간격을 쓴다. */
  spacing?: number;
  /** false면 core만 계획한다. 기본값 true. */
  diffuse?: boolean;
};

/** 정규화된 플래너 제어값. `points`/`pressures`는 계획 시 별도로 정리한다. */
export type WatercolorBrushPlanSettings = {
  baseWidth: number;
  seed: number;
  maxDabs: number;
  spacing: number;
  diffuse: boolean;
};

/** 메타데이터를 포함한 계획 결과. `dabs`는 스트로크 진행 순서로 이미 정렬돼 있다. */
export type WatercolorBrushPlan = {
  dabs: WatercolorBrushDab[];
  sourcePointCount: number;
  totalLength: number;
  /** 이상적인 core/diffuse 샘플 수보다 maxDabs가 작아 샘플을 줄였는지 여부. */
  capped: boolean;
  settings: WatercolorBrushPlanSettings;
};

export const WATERCOLOR_BRUSH_WIDTH_RANGE = { min: 0.25, max: 2048 } as const;
export const WATERCOLOR_BRUSH_DAB_CAP_RANGE = { min: 2, max: 2048 } as const;
export const WATERCOLOR_BRUSH_SPACING_RANGE = { min: 0.25, max: 4096 } as const;
export const WATERCOLOR_BRUSH_SEED_RANGE = { min: 0, max: 9999 } as const;

export const DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH = 12;
export const DEFAULT_WATERCOLOR_BRUSH_SEED = 1;
export const DEFAULT_WATERCOLOR_BRUSH_MAX_DABS = 768;
export const DEFAULT_WATERCOLOR_BRUSH_DIFFUSE = true;

const DEFAULT_PRESSURE = 0.55;
const MAX_COORDINATE_ABS = 1_000_000;
const POINT_EPSILON = 1e-6;
const TAU = Math.PI * 2;
/**
 * cap 재분배 후 station 간격이 "보장 최소 core 직경 × 이 비율"을 넘으면 구슬화로 판정한다.
 * 0.9는 인접 core 원이 겹침을 유지하는 시각적 여유(≈10%)를 남기는 임계값이다.
 */
const BEADING_SPACING_DIAMETER_RATIO = 0.9;
/**
 * 압력 0(pressureScale 0.58)·반경 노이즈 최소(0.93)에서도 보장되는 core 직경 계수.
 * `createCoreDab`의 radius 공식과 반드시 함께 갱신해야 한다.
 */
const MIN_CORE_DIAMETER_FACTOR = 0.58 * 0.93;

type StrokePoint = {
  x: number;
  y: number;
  pressure: number;
};

type StrokeStation = StrokePoint & {
  progress: number;
};

// ---------------------------------------------------------------------------
// 입력 정규화
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * 저장된 DrawEl id 같은 문자열을 수채 재질용 짧은 결정적 시드로 바꾼다.
 * 스트로크를 다시 열거나 내보내도 번짐이 바뀌지 않고, 복제된 스트로크는 새 id로 자연스러운
 * 미세 변주를 갖게 된다. 문자열이 아니어도 항상 유효 범위의 안전한 시드를 돌려준다.
 */
export function watercolorBrushSeedFromKey(key: unknown): number {
  if (typeof key !== "string" || key.length === 0) return DEFAULT_WATERCOLOR_BRUSH_SEED;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (WATERCOLOR_BRUSH_SEED_RANGE.max + 1);
}

function safeCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // 과도하게 큰 유한 값도 Math.hypot/보간 오버플로를 일으키지 않도록 보수적으로 제한한다.
  return clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS);
}

function safePressureAtProgress(pressures: unknown, progress: number): number {
  if (!Array.isArray(pressures) || pressures.length === 0) return DEFAULT_PRESSURE;
  if (pressures.length === 1) return clamp01(finiteNumber(pressures[0], DEFAULT_PRESSURE));

  const boundedProgress = clamp01(progress);
  const position = boundedProgress * (pressures.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(pressures.length - 1, Math.ceil(position));
  const amount = position - lowerIndex;
  const lower = clamp01(finiteNumber(pressures[lowerIndex], DEFAULT_PRESSURE));
  const upper = clamp01(finiteNumber(pressures[upperIndex], lower));
  return lower + (upper - lower) * amount;
}

/**
 * 유효한 `[x,y]` 쌍만 모으고, 연속 중복점은 마지막 압력으로 합친다.
 * 원본 pair index를 기준으로 pressure를 표본화하므로 잘못된 중간 좌표를 건너뛰어도
 * 시작/끝 필압의 의미가 뒤집히지 않는다.
 */
function sanitizeStrokePoints(rawPoints: unknown, rawPressures: unknown): StrokePoint[] {
  if (!Array.isArray(rawPoints)) return [];
  const sourcePairCount = Math.floor(rawPoints.length / 2);
  if (sourcePairCount === 0) return [];

  const points: StrokePoint[] = [];
  for (let sourceIndex = 0; sourceIndex < sourcePairCount; sourceIndex++) {
    const x = safeCoordinate(rawPoints[sourceIndex * 2]);
    const y = safeCoordinate(rawPoints[sourceIndex * 2 + 1]);
    if (x === null || y === null) continue;

    const pressure = safePressureAtProgress(rawPressures, sourcePairCount <= 1 ? 0 : sourceIndex / (sourcePairCount - 1));
    const previous = points.at(-1);
    if (previous && Math.hypot(x - previous.x, y - previous.y) <= POINT_EPSILON) {
      // 위치는 같아도 마지막 필압은 의미가 있으므로 업데이트한다.
      previous.pressure = pressure;
      continue;
    }
    points.push({ x, y, pressure });
  }
  return points;
}

/**
 * baseWidth·seed·cap·spacing을 렌더 안전 범위로 정규화한다.
 * cap의 최소값 2는 양 끝 core dab을 동시에 보존하기 위한 의도적인 계약이다.
 */
export function normalizeWatercolorBrushPlanSettings(
  input?: Partial<WatercolorBrushPlanInput> | null,
): WatercolorBrushPlanSettings {
  const source = input && typeof input === "object" ? input : {};
  const baseWidth = clamp(
    finiteNumber(source.baseWidth, DEFAULT_WATERCOLOR_BRUSH_BASE_WIDTH),
    WATERCOLOR_BRUSH_WIDTH_RANGE.min,
    WATERCOLOR_BRUSH_WIDTH_RANGE.max,
  );
  const defaultSpacing = Math.max(WATERCOLOR_BRUSH_SPACING_RANGE.min, baseWidth * 0.34);
  const rawSpacing = finiteNumber(source.spacing, defaultSpacing);
  const spacing = rawSpacing > 0
    ? clamp(rawSpacing, WATERCOLOR_BRUSH_SPACING_RANGE.min, WATERCOLOR_BRUSH_SPACING_RANGE.max)
    : defaultSpacing;

  return {
    baseWidth,
    seed: Math.floor(
      clamp(finiteNumber(source.seed, DEFAULT_WATERCOLOR_BRUSH_SEED), WATERCOLOR_BRUSH_SEED_RANGE.min, WATERCOLOR_BRUSH_SEED_RANGE.max),
    ),
    maxDabs: Math.floor(
      clamp(
        finiteNumber(source.maxDabs, DEFAULT_WATERCOLOR_BRUSH_MAX_DABS),
        WATERCOLOR_BRUSH_DAB_CAP_RANGE.min,
        WATERCOLOR_BRUSH_DAB_CAP_RANGE.max,
      ),
    ),
    diffuse: typeof source.diffuse === "boolean" ? source.diffuse : DEFAULT_WATERCOLOR_BRUSH_DIFFUSE,
    spacing,
  };
}

// ---------------------------------------------------------------------------
// 호 길이 재표본화 — cap 전에도 입력 순서를 보존하고 양 종점을 정확히 유지한다.
// ---------------------------------------------------------------------------

function polylineLength(points: readonly StrokePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return total;
}

function samplePolylineStations(points: readonly StrokePoint[], stationCount: number, totalLength: number): StrokeStation[] {
  if (points.length === 0 || stationCount <= 0) return [];
  if (points.length === 1 || stationCount === 1 || totalLength <= POINT_EPSILON) {
    const point = points[0]!;
    return [{ ...point, progress: 0 }];
  }

  const cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    cumulative[index] = cumulative[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y);
  }

  const stations: StrokeStation[] = [];
  let segmentIndex = 0;
  for (let stationIndex = 0; stationIndex < stationCount; stationIndex++) {
    const progress = stationCount <= 1 ? 0 : stationIndex / (stationCount - 1);
    if (stationIndex === 0) {
      stations.push({ ...points[0]!, progress: 0 });
      continue;
    }
    if (stationIndex === stationCount - 1) {
      // 부동소수 보간 오차 없이 정확한 입력 종점을 보장한다.
      stations.push({ ...points.at(-1)!, progress: 1 });
      continue;
    }

    const targetDistance = totalLength * progress;
    while (segmentIndex < points.length - 2 && cumulative[segmentIndex + 1]! < targetDistance) segmentIndex++;
    const start = points[segmentIndex]!;
    const end = points[segmentIndex + 1]!;
    const segmentStart = cumulative[segmentIndex]!;
    const segmentEnd = cumulative[segmentIndex + 1]!;
    const segmentLength = segmentEnd - segmentStart;
    const amount = segmentLength > POINT_EPSILON ? (targetDistance - segmentStart) / segmentLength : 0;
    stations.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      pressure: start.pressure + (end.pressure - start.pressure) * amount,
      progress,
    });
  }
  return stations;
}

// ---------------------------------------------------------------------------
// dab 생성 — core 중심은 고정, diffuse만 seed 기반으로 주변에 번진다.
// ---------------------------------------------------------------------------

function createCoreDab(
  station: StrokeStation,
  stationIndex: number,
  settings: WatercolorBrushPlanSettings,
  radiusScale: number,
): WatercolorBrushDab {
  const radiusNoise = hash2(stationIndex, 11, settings.seed);
  const opacityNoise = hash2(stationIndex, 13, settings.seed);
  const baseRadius = settings.baseWidth * 0.5;
  // p=0.5일 때 대체로 입력 width와 같은 직경, p가 높을수록 자연스럽게 두꺼워진다.
  const pressureScale = 0.58 + station.pressure * 0.84;
  const radius = clamp(
    baseRadius * pressureScale * (0.93 + radiusNoise * 0.14) * radiusScale,
    0.05,
    settings.baseWidth * 1.1 * radiusScale,
  );
  const opacity = clamp(0.16 + station.pressure * 0.38 + (opacityNoise - 0.5) * 0.06, 0.08, 0.72);
  return { x: station.x, y: station.y, radius, opacity, role: "core" };
}

function createDiffuseDab(
  station: StrokeStation,
  stationIndex: number,
  core: WatercolorBrushDab,
  settings: WatercolorBrushPlanSettings,
  radiusScale: number,
): WatercolorBrushDab {
  const angle = hash2(stationIndex, 31, settings.seed) * TAU;
  const distance = core.radius * (0.16 + hash2(stationIndex, 37, settings.seed) * 0.54);
  const radius = clamp(
    core.radius * (1.2 + hash2(stationIndex, 41, settings.seed) * 0.48),
    0.05,
    settings.baseWidth * 1.7 * radiusScale,
  );
  const opacity = clamp(core.opacity * (0.17 + hash2(stationIndex, 43, settings.seed) * 0.17), 0.02, 0.3);
  return {
    x: station.x + Math.cos(angle) * distance,
    y: station.y + Math.sin(angle) * distance,
    radius,
    opacity,
    role: "diffuse",
  };
}

/**
 * cap이 station 수를 줄여 재분배 간격이 구슬화 임계(보장 최소 core 직경의 90%)를 넘을 때만
 * 1보다 큰 반경 배율을 돌려준다. dab 수(성능 예산)는 그대로 두고 반경만 간격에 비례해 키워
 * 인접 core가 항상 겹치는 연속 wash를 보장한다. 순수 함수라 결정성은 그대로다.
 */
function beadingRadiusScale(
  totalLength: number,
  stationCount: number,
  idealStationCount: number,
  baseWidth: number,
): number {
  if (stationCount >= idealStationCount || stationCount < 2) return 1;
  const cappedSpacing = totalLength / (stationCount - 1);
  const beadingSpacing = baseWidth * MIN_CORE_DIAMETER_FACTOR * BEADING_SPACING_DIAMETER_RATIO;
  return cappedSpacing > beadingSpacing ? cappedSpacing / beadingSpacing : 1;
}

// ---------------------------------------------------------------------------
// 공개 계획 함수
// ---------------------------------------------------------------------------

/**
 * 수채 브러시의 core/diffuse dab 계획을 만든다.
 *
 * 결과는 늘 `maxDabs` 이하이며, 여러 유효 좌표가 있으면 첫·마지막 core dab의 x/y는
 * 각각 첫·마지막 유효 입력 좌표와 정확히 같다. 입력 배열은 절대 변경하지 않는다.
 * cap으로 station이 줄어 간격이 구슬화 임계를 넘으면 반경을 간격에 비례해 키워 인접 core가
 * 항상 겹치게 유지한다(동일 입력·seed 결정성은 그대로).
 */
export function planWatercolorBrush(input?: Partial<WatercolorBrushPlanInput> | null): WatercolorBrushPlan {
  const settings = normalizeWatercolorBrushPlanSettings(input);
  const points = sanitizeStrokePoints(input?.points, input?.pressures);
  if (points.length === 0) {
    return { dabs: [], sourcePointCount: 0, totalLength: 0, capped: false, settings };
  }

  const totalLength = polylineLength(points);
  if (points.length === 1 || totalLength <= POINT_EPSILON) {
    const station: StrokeStation = { ...points[0]!, progress: 0 };
    const core = createCoreDab(station, 0, settings, 1);
    const dabs = [core];
    if (settings.diffuse && settings.maxDabs >= 2) dabs.push(createDiffuseDab(station, 0, core, settings, 1));
    return { dabs, sourcePointCount: points.length, totalLength: 0, capped: false, settings };
  }

  const idealStationCount = Math.max(2, Math.ceil(totalLength / settings.spacing) + 1);
  // diffuse는 한 station당 1개 더 필요하다. cap이 4 미만이면 core만 우선한다.
  const canEmitDiffuse = settings.diffuse && settings.maxDabs >= 4;
  const stationCapacity = canEmitDiffuse ? Math.floor(settings.maxDabs / 2) : settings.maxDabs;
  const stationCount = Math.min(idealStationCount, stationCapacity);
  const radiusScale = beadingRadiusScale(totalLength, stationCount, idealStationCount, settings.baseWidth);
  const stations = samplePolylineStations(points, stationCount, totalLength);
  const dabs: WatercolorBrushDab[] = [];

  for (let stationIndex = 0; stationIndex < stations.length && dabs.length < settings.maxDabs; stationIndex++) {
    const station = stations[stationIndex]!;
    const core = createCoreDab(station, stationIndex, settings, radiusScale);
    dabs.push(core);
    if (canEmitDiffuse && dabs.length < settings.maxDabs) {
      dabs.push(createDiffuseDab(station, stationIndex, core, settings, radiusScale));
    }
  }

  const idealDabCount = idealStationCount * (settings.diffuse ? 2 : 1);
  return {
    dabs,
    sourcePointCount: points.length,
    totalLength,
    capped: idealDabCount > settings.maxDabs,
    settings,
  };
}

/** 메타데이터가 필요 없는 캔버스 렌더러용 편의 함수. */
export function planWatercolorBrushDabs(input?: Partial<WatercolorBrushPlanInput> | null): WatercolorBrushDab[] {
  return planWatercolorBrush(input).dabs;
}
