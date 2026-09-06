/**
 * Studio Denoise — 시간 누적 + 모멘트 기반 분산 추정 (SVGF 의 temporal 단계)
 *
 * 프로그레시브 경로 추적기는 같은 카메라로 프레임을 계속 쌓는다. 그 누적을 여기서
 * 담당하고, 동시에 휘도의 1·2차 모멘트를 굴려 **픽셀별 분산**을 만든다. 이 분산이
 * studio-denoise-atrous 의 휘도 엣지 스토핑 분모로 들어가 "수렴한 곳은 덜, 노이즈가
 * 남은 곳은 더" 필터링되게 한다.
 *
 * ── 리프로젝션 계약 ─────────────────────────────────────────────────────────
 *  기본은 **항등 리프로젝션**(카메라 고정 프로그레시브 렌더링 = 우리 주 사용처).
 *  카메라가 움직이면 경로 추적기가 `reprojection: Int32Array(w*h)` 를 채워 넘긴다.
 *    reprojection[p] = 이전 프레임에서 대응되는 픽셀 인덱스, 없으면 -1.
 *  모션 벡터 → 인덱스 변환은 추적기 쪽 책임이다. 여기서는 정수 인덱스만 받아 결정성을
 *  보장한다(부동소수 bilinear 재투영은 드라이버/컴파일러 차이로 비트 재현이 깨진다).
 *
 * ── 히스토리 기각 ───────────────────────────────────────────────────────────
 *  dot(n_curr, n_prev) < normalThreshold  또는
 *  |z_curr - z_prev| > depthThreshold * max(z_curr, 1)  이면 그 픽셀의 히스토리를 버린다
 *  (= historyLength 0 부터 다시). 디스오클루전에서 유령(ghosting)을 막는 표준 조치.
 *
 * ── 누적 규칙 ───────────────────────────────────────────────────────────────
 *  alpha = max(1 / (historyLength + 1), minAlpha)
 *   · minAlpha = 0 이면 정확한 누적 평균(프로그레시브 렌더링의 정답).
 *   · minAlpha > 0 이면 지수 이동 평균으로 전환되어 오래된 히스토리가 서서히 잊힌다
 *     (움직이는 장면에서 잔상 억제). SVGF 는 보통 0.2 를 쓴다.
 *  color  = lerp(prevColor,  currColor,  alpha)
 *  m1     = lerp(prevM1, luma(curr),     alpha)
 *  m2     = lerp(prevM2, luma(curr)²,    alpha)
 *
 *  결과 m1/m2 를 그대로 StudioDenoiseFrame.momentLuma / momentLuma2 로 넘기면 된다.
 *  분산은 계약 정규화 단계에서 (m2 - m1²)/spp 로 계산된다.
 *
 * 결정적이다 — 난수/시간 의존 없음.
 */

import {
  STUDIO_DENOISE_COLOR_CHANNELS,
  studioDenoiseLuminance,
  type StudioDenoiseFrame,
} from "./studio-denoise-contract";

/** 이전 프레임의 누적 상태. 첫 프레임에서는 `createStudioDenoiseHistory` 로 만든다. */
export interface StudioDenoiseHistory {
  readonly width: number;
  readonly height: number;
  /** 누적 선형 HDR 색, w*h*3. */
  readonly color: Float32Array;
  /** 휘도 1차 모멘트, w*h. */
  readonly momentLuma: Float32Array;
  /** 휘도 2차 모멘트, w*h. */
  readonly momentLuma2: Float32Array;
  /** 픽셀별 누적 프레임 수, w*h. */
  readonly historyLength: Float32Array;
  /** 히스토리 검증용 노멀, w*h*3. */
  readonly normal: Float32Array;
  /** 히스토리 검증용 깊이, w*h. */
  readonly depth: Float32Array;
}

export interface StudioDenoiseTemporalOptions {
  /** 지수 이동 평균 하한. 0 = 정확한 누적 평균(카메라 고정 프로그레시브). */
  readonly minAlpha?: number;
  /** 히스토리 유지에 필요한 최소 노멀 내적. */
  readonly normalThreshold?: number;
  /** 히스토리 유지에 필요한 상대 깊이 허용 오차. */
  readonly depthThreshold?: number;
  /** 픽셀별 이전 프레임 인덱스. 생략 시 항등. -1 = 히스토리 없음. */
  readonly reprojection?: Int32Array;
}

export interface StudioDenoiseTemporalResolvedOptions {
  readonly minAlpha: number;
  readonly normalThreshold: number;
  readonly depthThreshold: number;
}

export const STUDIO_DENOISE_TEMPORAL_DEFAULTS: StudioDenoiseTemporalResolvedOptions = {
  minAlpha: 0,
  normalThreshold: 0.9,
  depthThreshold: 0.05,
};

export interface StudioDenoiseTemporalResult {
  /** 다음 프레임에 다시 넘길 누적 상태. */
  readonly history: StudioDenoiseHistory;
  /** 누적된 색 + 모멘트를 채운, 공간 디노이저에 바로 넣을 수 있는 프레임. */
  readonly frame: StudioDenoiseFrame;
  /** 히스토리를 기각하고 리셋한 픽셀 수. */
  readonly rejected: number;
  /** 리프로젝션 대상이 없던(디스오클루전) 픽셀 수. */
  readonly disoccluded: number;
}

/** 빈 히스토리(첫 프레임용). */
export function createStudioDenoiseHistory(width: number, height: number): StudioDenoiseHistory {
  const pixels = Math.max(0, width) * Math.max(0, height);
  return {
    width,
    height,
    color: new Float32Array(pixels * STUDIO_DENOISE_COLOR_CHANNELS),
    momentLuma: new Float32Array(pixels),
    momentLuma2: new Float32Array(pixels),
    historyLength: new Float32Array(pixels),
    normal: new Float32Array(pixels * STUDIO_DENOISE_COLOR_CHANNELS),
    depth: new Float32Array(pixels),
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function resolveTemporalOptions(
  options?: StudioDenoiseTemporalOptions,
): StudioDenoiseTemporalResolvedOptions {
  const d = STUDIO_DENOISE_TEMPORAL_DEFAULTS;
  if (!options) return d;
  const minAlpha =
    typeof options.minAlpha === "number" && Number.isFinite(options.minAlpha)
      ? Math.min(1, Math.max(0, options.minAlpha))
      : d.minAlpha;
  const normalThreshold =
    typeof options.normalThreshold === "number" && Number.isFinite(options.normalThreshold)
      ? Math.min(1, Math.max(-1, options.normalThreshold))
      : d.normalThreshold;
  const depthThreshold =
    typeof options.depthThreshold === "number" &&
    Number.isFinite(options.depthThreshold) &&
    options.depthThreshold >= 0
      ? options.depthThreshold
      : d.depthThreshold;
  return { minAlpha, normalThreshold, depthThreshold };
}

/**
 * 현재 프레임을 히스토리에 누적하고, 모멘트가 채워진 새 프레임을 돌려준다.
 * 입력 히스토리는 변형하지 않는다(새 버퍼 반환) — 재현 가능한 테스트/타임라인 스크럽용.
 */
export function accumulateStudioDenoiseTemporal(
  history: StudioDenoiseHistory,
  frame: StudioDenoiseFrame,
  options?: StudioDenoiseTemporalOptions,
): StudioDenoiseTemporalResult {
  const resolved = resolveTemporalOptions(options);
  const width = frame.width;
  const height = frame.height;
  const pixels = Math.max(0, width) * Math.max(0, height);
  const sizeMatches = history.width === width && history.height === height;

  const next = createStudioDenoiseHistory(width, height);
  const reprojection = options?.reprojection;
  let rejected = 0;
  let disoccluded = 0;

  for (let p = 0; p < pixels; p += 1) {
    const b = p * 3;
    const cr = finiteOrZero(frame.color[b]);
    const cg = finiteOrZero(frame.color[b + 1]);
    const cb = finiteOrZero(frame.color[b + 2]);
    const luma = studioDenoiseLuminance(cr, cg, cb);

    const nx = frame.normal ? finiteOrZero(frame.normal[b]) : 0;
    const ny = frame.normal ? finiteOrZero(frame.normal[b + 1]) : 0;
    const nz = frame.normal ? finiteOrZero(frame.normal[b + 2]) : 1;
    const z = frame.depth ? finiteOrZero(frame.depth[p]) : 1;

    next.normal[b] = nx;
    next.normal[b + 1] = ny;
    next.normal[b + 2] = nz;
    next.depth[p] = z;

    let source = -1;
    if (sizeMatches) {
      const mapped = reprojection ? reprojection[p] : p;
      if (mapped >= 0 && mapped < pixels) source = mapped;
    }
    if (source < 0) {
      disoccluded += 1;
    }

    let accept = source >= 0 && history.historyLength[source] > 0;
    if (accept) {
      const sb = source * 3;
      const dot =
        nx * history.normal[sb] + ny * history.normal[sb + 1] + nz * history.normal[sb + 2];
      const dz = Math.abs(z - history.depth[source]);
      if (dot < resolved.normalThreshold || dz > resolved.depthThreshold * Math.max(z, 1)) {
        accept = false;
        rejected += 1;
      }
    }

    const prevLength = accept ? history.historyLength[source] : 0;
    const length = prevLength + 1;
    const alpha = Math.max(1 / length, resolved.minAlpha);
    next.historyLength[p] = length;

    if (!accept) {
      next.color[b] = cr;
      next.color[b + 1] = cg;
      next.color[b + 2] = cb;
      next.momentLuma[p] = luma;
      next.momentLuma2[p] = luma * luma;
      continue;
    }

    const sb = source * 3;
    next.color[b] = history.color[sb] + alpha * (cr - history.color[sb]);
    next.color[b + 1] = history.color[sb + 1] + alpha * (cg - history.color[sb + 1]);
    next.color[b + 2] = history.color[sb + 2] + alpha * (cb - history.color[sb + 2]);
    next.momentLuma[p] =
      history.momentLuma[source] + alpha * (luma - history.momentLuma[source]);
    next.momentLuma2[p] =
      history.momentLuma2[source] + alpha * (luma * luma - history.momentLuma2[source]);
  }

  const accumulated: StudioDenoiseFrame = {
    width,
    height,
    color: next.color,
    albedo: frame.albedo,
    normal: frame.normal,
    depth: frame.depth,
    sampleCount: next.historyLength,
    momentLuma: next.momentLuma,
    momentLuma2: next.momentLuma2,
  };

  return { history: next, frame: accumulated, rejected, disoccluded };
}
