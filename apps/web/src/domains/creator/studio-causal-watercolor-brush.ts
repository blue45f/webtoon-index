/**
 * Prefix-stable watercolor dab planner.
 *
 * The legacy watercolor planner fits a fresh set of stations across the current total stroke
 * length. That is useful for bounded export plans, but it means appending one pointer sample can
 * move every station that was already visible. This walker uses a persistent arc-length cursor:
 * once a core/diffuse pair is emitted, later samples can only append new dabs.
 *
 * The active live path deliberately does not paint a provisional endpoint. The exact endpoint is
 * emitted once by `finishCausalWatercolorBrush`; a UI may show a disposable predicted-tail layer
 * above this authoritative surface without ever rewriting retained pigment.
 */

import {
  DEFAULT_STUDIO_STROKE_BUDGET,
  resolveStrokeDabCapacity,
  STUDIO_CAUSAL_WATERCOLOR_DAB_RESIDENT_BYTES,
} from "@toonspectrum/studio-brush-platform";

import {
  normalizeWatercolorBrushPlanSettings,
  type WatercolorBrushDab,
  type WatercolorBrushPlanSettings,
} from "./brush/studio-watercolor-brush";
import { hash2 } from "./studio-grain";

const DEFAULT_PRESSURE = 0.55;
const MAX_COORDINATE_ABS = 1_000_000;
const POINT_EPSILON = 1e-6;
const TAU = Math.PI * 2;
const PIGMENT_NOISE_STATION_PERIOD = 12;

/**
 * 상한은 StrokeBudget 파생값이다(2026-09-02 아키텍처 리뷰). 기본 예산 4 MiB / dab 당 128 B =
 * 32,768 로, 지금 출하 중인 값과 동일하다 — 동작 중립 파생.
 */
export const STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE = {
  min: 2,
  max: resolveStrokeDabCapacity({
    budget: DEFAULT_STUDIO_STROKE_BUDGET,
    bytesPerDab: STUDIO_CAUSAL_WATERCOLOR_DAB_RESIDENT_BYTES,
  }),
} as const;

export const DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS = 16_384;

export interface StudioCausalWatercolorSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface StudioCausalWatercolorSettings extends WatercolorBrushPlanSettings {
  /** A safety ceiling only. Unlike the legacy planner, reaching it never redistributes old dabs. */
  maxDabs: number;
}

export interface StudioCausalWatercolorState {
  settings: StudioCausalWatercolorSettings;
  lastX: number;
  lastY: number;
  lastPressure: number;
  /** Arc length still required before the next permanent station. */
  distanceToNextStation: number;
  /** Stable seed index for the next station. */
  stationIndex: number;
  emittedDabCount: number;
  lastStationX: number;
  lastStationY: number;
  travelled: boolean;
  finished: boolean;
  /** Set only after an actually requested core/diffuse dab could not fit. */
  capped: boolean;
}

export interface StudioCausalWatercolorBeginResult {
  state: StudioCausalWatercolorState;
  dabs: WatercolorBrushDab[];
}

export interface StudioCausalWatercolorPlanInput {
  readonly points: readonly number[];
  readonly pressures?: readonly number[] | null;
  readonly baseWidth?: number;
  readonly seed?: number;
  readonly maxDabs?: number;
  readonly spacing?: number;
  readonly diffuse?: boolean;
  /**
   * Adds the current exact endpoint to this disposable replay without sealing or mutating the
   * causal walker. Retained live previews use this to match pointer-up bounds while permanent
   * pigment remains an append-only station prefix.
   */
  readonly previewEndpoint?: boolean;
}

export interface StudioCausalWatercolorPlan {
  dabs: WatercolorBrushDab[];
  sourcePointCount: number;
  /** True when malformed input contains no drawable coordinate pair. */
  empty: boolean;
  /** True when the safety ceiling prevented one or more new dabs. */
  capped: boolean;
  finalized: boolean;
  settings: StudioCausalWatercolorSettings;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: unknown): number {
  return clamp(finiteNumber(value, DEFAULT_PRESSURE), 0, 1);
}

function safeCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(value, -MAX_COORDINATE_ABS, MAX_COORDINATE_ABS);
}

/**
 * Low-frequency deterministic pigment variation.
 *
 * Independent opacity noise at every spacing station becomes a row of transverse bars after the
 * retained ribbon converts coverage into vector superlevels. Interpolating two deterministic
 * anchors keeps the material alive over distance without exposing the station lattice. The value
 * depends only on station index/seed, so appending a suffix cannot change any retained prefix.
 */
function causalPigmentNoise(
  stationIndex: number,
  salt: number,
  seed: number,
): number {
  const position = stationIndex / PIGMENT_NOISE_STATION_PERIOD;
  const leftIndex = Math.floor(position);
  const progress = position - leftIndex;
  const smoothProgress = progress * progress * (3 - 2 * progress);
  const left = hash2(leftIndex, salt, seed);
  const right = hash2(leftIndex + 1, salt, seed);
  return left + (right - left) * smoothProgress;
}

export function normalizeStudioCausalWatercolorSettings(
  input?: Omit<StudioCausalWatercolorPlanInput, "points" | "pressures"> | null,
): StudioCausalWatercolorSettings {
  const legacy = normalizeWatercolorBrushPlanSettings({
    baseWidth: input?.baseWidth,
    seed: input?.seed,
    spacing: input?.spacing,
    diffuse: input?.diffuse,
  });
  const maxDabs = Math.floor(clamp(
    finiteNumber(input?.maxDabs, DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS),
    STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.min,
    STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.max,
  ));
  return { ...legacy, maxDabs };
}

function createStationDabs(
  state: Pick<StudioCausalWatercolorState, "settings" | "stationIndex" | "emittedDabCount" | "capped">,
  x: number,
  y: number,
  pressure: number,
): WatercolorBrushDab[] {
  const { settings, stationIndex } = state;
  const available = settings.maxDabs - state.emittedDabCount;
  if (available <= 0) {
    state.capped = true;
    return [];
  }

  const radiusNoise = hash2(stationIndex, 11, settings.seed);
  const opacityNoise = causalPigmentNoise(stationIndex, 13, settings.seed);
  const baseRadius = settings.baseWidth * 0.5;
  const pressureScale = 0.58 + pressure * 0.84;
  const radius = clamp(
    baseRadius * pressureScale * (0.93 + radiusNoise * 0.14),
    0.05,
    settings.baseWidth * 1.1,
  );
  const opacity = clamp(
    0.16 + pressure * 0.38 + (opacityNoise - 0.5) * 0.05,
    0.08,
    0.72,
  );
  const core: WatercolorBrushDab = { x, y, radius, opacity, role: "core" };
  if (!settings.diffuse) return [core];
  if (available < 2) {
    state.capped = true;
    return [core];
  }

  const angle = hash2(stationIndex, 31, settings.seed) * TAU;
  const distance = core.radius * (0.16 + hash2(stationIndex, 37, settings.seed) * 0.54);
  const diffuseRadius = clamp(
    core.radius * (1.2 + hash2(stationIndex, 41, settings.seed) * 0.48),
    0.05,
    settings.baseWidth * 1.7,
  );
  const diffuseOpacity = clamp(
    core.opacity * (0.17 + causalPigmentNoise(
      stationIndex,
      43,
      settings.seed,
    ) * 0.17),
    0.02,
    0.3,
  );
  return [
    core,
    {
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      radius: diffuseRadius,
      opacity: diffuseOpacity,
      role: "diffuse",
    },
  ];
}

function emitStation(
  state: StudioCausalWatercolorState,
  x: number,
  y: number,
  pressure: number,
): WatercolorBrushDab[] {
  const dabs = createStationDabs(state, x, y, pressure);
  state.stationIndex += 1;
  state.emittedDabCount += dabs.length;
  state.lastStationX = x;
  state.lastStationY = y;
  return dabs;
}

function consumeDistanceAfterDabCeiling(
  state: StudioCausalWatercolorState,
  distance: number,
): void {
  if (distance + POINT_EPSILON < state.distanceToNextStation) {
    state.distanceToNextStation = Math.max(
      POINT_EPSILON,
      state.distanceToNextStation - distance,
    );
    return;
  }
  state.capped = true;
  const afterFirstMiss = Math.max(0, distance - state.distanceToNextStation);
  const remainder = afterFirstMiss % state.settings.spacing;
  state.distanceToNextStation = remainder <= POINT_EPSILON
    ? state.settings.spacing
    : state.settings.spacing - remainder;
}

/** Starts a new causal stroke and emits its tap/start pigment. */
export function beginCausalWatercolorBrush(
  sample: StudioCausalWatercolorSample,
  input?: Omit<StudioCausalWatercolorPlanInput, "points" | "pressures"> | null,
): StudioCausalWatercolorBeginResult | null {
  const x = safeCoordinate(sample.x);
  const y = safeCoordinate(sample.y);
  if (x === null || y === null) return null;

  const settings = normalizeStudioCausalWatercolorSettings(input);
  const pressure = clamp01(sample.pressure);
  const state: StudioCausalWatercolorState = {
    settings,
    lastX: x,
    lastY: y,
    lastPressure: pressure,
    distanceToNextStation: settings.spacing,
    stationIndex: 0,
    emittedDabCount: 0,
    lastStationX: x,
    lastStationY: y,
    travelled: false,
    finished: false,
    capped: false,
  };
  return { state, dabs: emitStation(state, x, y, pressure) };
}

/**
 * Consumes one accepted source sample and returns only newly crossed permanent stations.
 * The state is mutated in place to keep the pointer hot path allocation bounded to emitted dabs.
 */
export function appendCausalWatercolorBrush(
  state: StudioCausalWatercolorState,
  sample: StudioCausalWatercolorSample,
): WatercolorBrushDab[] {
  if (state.finished) return [];
  const x = safeCoordinate(sample.x);
  const y = safeCoordinate(sample.y);
  if (x === null || y === null) return [];
  const pressure = clamp01(sample.pressure);
  const dx = x - state.lastX;
  const dy = y - state.lastY;
  const distance = Math.hypot(dx, dy);
  if (distance <= POINT_EPSILON) {
    state.lastX = x;
    state.lastY = y;
    state.lastPressure = pressure;
    return [];
  }

  state.travelled = true;
  if (state.emittedDabCount >= state.settings.maxDabs) {
    consumeDistanceAfterDabCeiling(state, distance);
    state.lastX = x;
    state.lastY = y;
    state.lastPressure = pressure;
    return [];
  }
  const dabs: WatercolorBrushDab[] = [];
  let consumed = 0;
  let distanceToNext = state.distanceToNextStation;
  while (distance - consumed + POINT_EPSILON >= distanceToNext) {
    consumed += distanceToNext;
    const amount = clamp(consumed / distance, 0, 1);
    const stationX = state.lastX + dx * amount;
    const stationY = state.lastY + dy * amount;
    const stationPressure = state.lastPressure + (pressure - state.lastPressure) * amount;
    dabs.push(...emitStation(state, stationX, stationY, stationPressure));
    distanceToNext = state.settings.spacing;
    if (state.emittedDabCount >= state.settings.maxDabs) {
      state.distanceToNextStation = distanceToNext;
      consumeDistanceAfterDabCeiling(state, Math.max(0, distance - consumed));
      state.lastX = x;
      state.lastY = y;
      state.lastPressure = pressure;
      return dabs;
    }
  }

  state.distanceToNextStation = Math.max(
    POINT_EPSILON,
    distanceToNext - Math.max(0, distance - consumed),
  );
  state.lastX = x;
  state.lastY = y;
  state.lastPressure = pressure;
  return dabs;
}

/** Emits the exact endpoint once and seals the stroke. Repeated calls are idempotent. */
export function finishCausalWatercolorBrush(
  state: StudioCausalWatercolorState,
): WatercolorBrushDab[] {
  if (state.finished) return [];
  state.finished = true;
  if (!state.travelled) return [];
  if (
    Math.hypot(
      state.lastX - state.lastStationX,
      state.lastY - state.lastStationY,
    ) <= POINT_EPSILON
  ) {
    return [];
  }
  return emitStation(state, state.lastX, state.lastY, state.lastPressure);
}

/**
 * Peeks the exact dab(s) that `finishCausalWatercolorBrush` would emit without changing any part
 * of the authoritative causal state. The returned geometry is disposable: callers must redraw it
 * on the next accepted sample rather than append it to retained pigment.
 */
export function previewCausalWatercolorBrushEndpoint(
  state: StudioCausalWatercolorState,
): WatercolorBrushDab[] {
  if (state.finished || !state.travelled) return [];
  if (
    Math.hypot(
      state.lastX - state.lastStationX,
      state.lastY - state.lastStationY,
    ) <= POINT_EPSILON
  ) {
    return [];
  }
  const previewState: StudioCausalWatercolorState = {
    ...state,
    settings: state.settings,
  };
  return emitStation(
    previewState,
    previewState.lastX,
    previewState.lastY,
    previewState.lastPressure,
  );
}

/**
 * Deterministic replay for committed (`finalized=true`) or still-active (`false`) strokes.
 * Incremental append and this replay function intentionally share the exact same walker.
 */
export function planCausalWatercolorBrush(
  input?: Partial<StudioCausalWatercolorPlanInput> | null,
  finalized = true,
): StudioCausalWatercolorPlan {
  const sourcePoints = Array.isArray(input?.points) ? input.points : [];
  const sourcePointCount = Math.floor(sourcePoints.length / 2);
  const settings = normalizeStudioCausalWatercolorSettings(input ?? undefined);
  let started: StudioCausalWatercolorBeginResult | null = null;
  let acceptedPointCount = 0;
  const dabs: WatercolorBrushDab[] = [];

  for (let sourceIndex = 0; sourceIndex < sourcePointCount; sourceIndex += 1) {
    const x = safeCoordinate(sourcePoints[sourceIndex * 2]);
    const y = safeCoordinate(sourcePoints[sourceIndex * 2 + 1]);
    if (x === null || y === null) continue;
    const sample = {
      x,
      y,
      pressure: input?.pressures?.[sourceIndex],
    };
    acceptedPointCount += 1;
    if (!started) {
      started = beginCausalWatercolorBrush(sample, settings);
      if (started) dabs.push(...started.dabs);
      continue;
    }
    dabs.push(...appendCausalWatercolorBrush(started.state, sample));
  }

  if (started && finalized) {
    dabs.push(...finishCausalWatercolorBrush(started.state));
  } else if (started && input?.previewEndpoint === true) {
    dabs.push(...previewCausalWatercolorBrushEndpoint(started.state));
  }
  return {
    dabs,
    sourcePointCount: acceptedPointCount,
    empty: started === null,
    capped: started?.state.capped ?? false,
    finalized: Boolean(started && finalized),
    settings: started?.state.settings ?? settings,
  };
}

export function planCausalWatercolorBrushDabs(
  input?: Partial<StudioCausalWatercolorPlanInput> | null,
  finalized = true,
): WatercolorBrushDab[] {
  return planCausalWatercolorBrush(input, finalized).dabs;
}

/** 정규화 설정의 값 동일성 — 증분 플래너의 구성 검증에 쓴다. */
function causalWatercolorSettingsEqual(
  left: StudioCausalWatercolorSettings,
  right: StudioCausalWatercolorSettings,
): boolean {
  const leftKeys = Object.keys(left) as (keyof StudioCausalWatercolorSettings)[];
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

export interface StudioIncrementalCausalWatercolorPlanner {
  /**
   * 자라나는 획의 현재 스냅샷을 소비하고 배치 `planCausalWatercolorBrushDabs`와 값이 정확히
   * 같은 dab 배열을 돌려준다(같은 워커 함수를 같은 순서로 호출하므로 바이트 동일). 이미 소비한
   * raw prefix는 다시 읽지 않으며(마지막 채택 표본 하나로 O(1) 검증), 되돌리기·재작성·설정
   * 변경이 감지되면 전체를 다시 만든다. 반환 배열은 플래너 내부 보관 배열이므로 수정하면 안
   * 된다. finish/previewEndpoint 꼬리 dab은 다음 호출에서 걷어내고 다시 단다.
   */
  plan(
    input: Partial<StudioCausalWatercolorPlanInput> | null | undefined,
    finalized: boolean,
  ): WatercolorBrushDab[];
  /**
   * 마지막 `plan()`이 돌려준 배열에서 안정 prefix 길이. 그 뒤(미리보기/봉인 꼬리)는 다음
   * 호출에서 걷어내고 다시 다는 휘발 영역이라, 하류 증분 소비자는 이 길이까지만 신뢰해야 한다.
   */
  stableDabCount(): number;
  /** 전체 재구축마다 증가한다 — 하류 증분 소비자의 prefix 신뢰를 무효화하는 신호. */
  generation(): number;
}

/**
 * 라이브/리렌더용 증분 causal watercolor 플래너.
 *
 * `planCausalWatercolorBrush`는 출력이 prefix 안정이지만 매 호출 전체 스트로크를 다시 걷는다
 * (이동당 O(n) — 장획 게이트가 잡는 형태). 워커(begin/append)는 원래 증분 설계이므로, 상태와
 * 방출 dab 배열을 유지하고 새 raw 표본만 소비하면 이동당 비용이 새 표본 수에만 비례한다.
 */
export function createStudioIncrementalCausalWatercolorPlanner(): StudioIncrementalCausalWatercolorPlanner {
  let settings: StudioCausalWatercolorSettings | null = null;
  let started: StudioCausalWatercolorBeginResult | null = null;
  const dabs: WatercolorBrushDab[] = [];
  let tailCount = 0;
  let consumedSourceIndex = 0;
  let lastAcceptedIndex = -1;
  let lastAcceptedX = 0;
  let lastAcceptedY = 0;
  let lastAcceptedPressureSlot: number | undefined;
  let finalizedDone = false;
  let rebuildGeneration = 0;

  const reset = (): void => {
    settings = null;
    started = null;
    dabs.length = 0;
    tailCount = 0;
    consumedSourceIndex = 0;
    lastAcceptedIndex = -1;
    lastAcceptedPressureSlot = undefined;
    finalizedDone = false;
    rebuildGeneration += 1;
  };

  return {
    plan(input, finalized) {
      const sourcePoints = Array.isArray(input?.points) ? input.points : [];
      const sourcePointCount = Math.floor(sourcePoints.length / 2);
      const nextSettings = normalizeStudioCausalWatercolorSettings(input ?? undefined);
      if (
        (settings !== null && !causalWatercolorSettingsEqual(settings, nextSettings))
        || sourcePointCount < consumedSourceIndex
      ) {
        reset();
      }
      if (lastAcceptedIndex >= 0) {
        const rawX = sourcePoints[lastAcceptedIndex * 2];
        const rawY = sourcePoints[lastAcceptedIndex * 2 + 1];
        if (
          rawX !== lastAcceptedX
          || rawY !== lastAcceptedY
          || input?.pressures?.[lastAcceptedIndex] !== lastAcceptedPressureSlot
        ) {
          reset();
        }
      }
      if (finalizedDone) {
        if (finalized && sourcePointCount === consumedSourceIndex) return dabs;
        // 봉인 뒤의 성장·재개는 편집이다 — 배치 리플레이 의미론대로 전체를 다시 만든다.
        reset();
      }
      settings ??= nextSettings;
      dabs.length -= tailCount;
      tailCount = 0;
      for (
        let sourceIndex = consumedSourceIndex;
        sourceIndex < sourcePointCount;
        sourceIndex += 1
      ) {
        const x = safeCoordinate(sourcePoints[sourceIndex * 2]);
        const y = safeCoordinate(sourcePoints[sourceIndex * 2 + 1]);
        consumedSourceIndex = sourceIndex + 1;
        // 배치와 같은 규약: 잘못된 표본은 건너뛰고 계속 걷는다.
        if (x === null || y === null) continue;
        const sample = {
          x,
          y,
          pressure: input?.pressures?.[sourceIndex],
        };
        if (!started) {
          started = beginCausalWatercolorBrush(sample, settings);
          if (started) dabs.push(...started.dabs);
        } else {
          dabs.push(...appendCausalWatercolorBrush(started.state, sample));
        }
        lastAcceptedIndex = sourceIndex;
        lastAcceptedX = sourcePoints[sourceIndex * 2] as number;
        lastAcceptedY = sourcePoints[sourceIndex * 2 + 1] as number;
        lastAcceptedPressureSlot = input?.pressures?.[sourceIndex];
      }
      if (started && finalized) {
        const finishDabs = finishCausalWatercolorBrush(started.state);
        dabs.push(...finishDabs);
        tailCount = finishDabs.length;
        finalizedDone = true;
      } else if (started && input?.previewEndpoint === true) {
        const previewDabs = previewCausalWatercolorBrushEndpoint(started.state);
        dabs.push(...previewDabs);
        tailCount = previewDabs.length;
      }
      return dabs;
    },
    stableDabCount() {
      return dabs.length - tailCount;
    },
    generation() {
      return rebuildGeneration;
    },
  };
}

const INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE = new Map<
  string,
  StudioIncrementalCausalWatercolorPlanner
>();
/** 활성 획은 하나지만 draft/commit 리렌더가 겹치는 짧은 창을 위해 소수의 최근 획을 유지한다. */
const INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_LIMIT = 8;

/**
 * 요소 id로 키된 증분 causal watercolor 플랜. `StudioDrawNode`의 렌더 본문이 매 이동
 * 호출하는 자리(기존 `planCausalWatercolorBrushDabs`)의 교체용으로, 반환 배열은 내부 보관
 * 배열이므로 수정하면 안 된다. 검증·재구축 규약은 플래너 자체가 진다.
 */
export function planCausalWatercolorBrushDabsIncremental(
  strokeKey: string,
  input: Partial<StudioCausalWatercolorPlanInput> | null | undefined,
  finalized = true,
): WatercolorBrushDab[] {
  let planner = INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.get(strokeKey);
  if (planner) {
    // LRU 갱신: 재삽입으로 삽입 순서를 최근 사용 순서로 유지한다.
    INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.delete(strokeKey);
  } else {
    planner = createStudioIncrementalCausalWatercolorPlanner();
  }
  INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.set(strokeKey, planner);
  while (
    INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.size
    > INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_LIMIT
  ) {
    const oldest = INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.keys().next().value;
    if (oldest === undefined) break;
    INCREMENTAL_CAUSAL_WATERCOLOR_PLANNER_CACHE.delete(oldest);
  }
  return planner.plan(input, finalized);
}
