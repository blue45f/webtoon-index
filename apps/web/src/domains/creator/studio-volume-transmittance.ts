/**
 * Studio Volume — 투과율(transmittance) 추정기 3종
 *
 * 방사전달방정식의 감쇠 항은 비어–람베르트 법칙이다:
 *
 *     T(a, b) = exp( - ∫_a^b σ_t(x(s)) ds ),      σ_t = densityScale · density(x)
 *
 * 이 모듈은 그 적분을 세 가지 방식으로 추정하고, 셋 다 같은 σ_t 정의를 쓴다.
 *
 * 1) **레이 마칭**(`rayMarchTransmittance`)
 *    광학깊이 τ 를 리만 합으로 쌓고 exp(-τ). 균질 매질에서는 스텝 크기와 무관하게 **정확**하다
 *    (σ 가 상수라 리만 합이 정확한 적분이 된다). 비균질에서는 O(Δt) 편향이 있지만 분산이 0 이라
 *    저샘플 이미지가 매끈하다. 1차 레이의 기본값.
 *
 * 2) **비율 추적**(`ratioTrackingTransmittance`) — **채택된 그림자 레이 기본값**
 *    majorant σ̄ 로 자유행로를 뽑고 충돌마다 가중치에 (1 - σ_t/σ̄) 를 곱한다. 스텝 크기 개념이
 *    없으므로 **무편향**이고, 델타 추적과 달리 0/1 이 아닌 연속 가중치를 남겨 분산이 훨씬 작다.
 *    러시안 룰렛을 정석대로(생존 시 1/(1-q) 보정) 넣어 무편향을 유지한 채 종료한다.
 *
 * 3) **델타 추적**(`deltaTrackingTransmittance`)
 *    같은 자유행로에 확률 σ_t/σ̄ 로 실제 충돌 판정 → 결과가 0 또는 1. 무편향이지만 베르누이라
 *    분산이 크다. 여기서는 **비교/검증용**으로만 둔다(비율 추적이 왜 나은지 테스트가 수치로 보인다).
 *
 * ── 왜 그림자 레이는 비율 추적인가 ───────────────────────────────────────
 * 그림자 레이는 픽셀당 (스텝 수 × 광원 수) 만큼 발사된다. 레이 마칭을 쓰면 스텝 크기를 이중으로
 * 튜닝해야 하고, 굵게 잡으면 자기그림자(self-shadowing)에 계단이 생긴다. 비율 추적은 튜닝
 * 파라미터가 majorant 하나뿐이고 편향이 없어, 스텝을 키워도 어긋나지 않고 노이즈만 는다 —
 * 이후 디노이즈/누적 평균으로 지울 수 있는 종류의 오차라 프로덕션에서 다루기 쉽다.
 */

import { intersectStudioVolumeBounds, sampleStudioVolumeDensity } from "./studio-volume-grid";

import type { StudioVolumePrepared } from "./studio-volume-grid";
import type { StudioVolumeSampler } from "./studio-volume-sampler";

/** 러시안 룰렛 시작 임계값 — 가중치가 이보다 작아지면 룰렛을 돌린다. */
export const STUDIO_VOLUME_RR_THRESHOLD = 0.05;
/** 룰렛 종료 확률. */
export const STUDIO_VOLUME_RR_KILL_PROBABILITY = 0.75;
/** 추적 루프 안전 상한(무한 루프 방지). */
export const STUDIO_VOLUME_MAX_TRACKING_EVENTS = 10000;

export interface StudioVolumeTransmittanceStats {
  /** 밀도 샘플 평가 횟수. */
  densitySamples: number;
}

function clampToBounds(prepared: StudioVolumePrepared, axis: number, value: number): number {
  const min = prepared.boundsMin[axis];
  const max = prepared.boundsMax[axis];
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 리만 합 기반 광학깊이. 스텝은 [tEnter, tExit] 를 정확히 stepCount 등분하고 각 스텝의
 * 표본 위치는 `t = tEnter + (k + offset)·dt` 다(offset ∈ [0,1)).
 */
export function rayMarchOpticalDepth(
  prepared: StudioVolumePrepared,
  densityScale: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tEnter: number,
  tExit: number,
  stepCount: number,
  offsetAt: (stepIndex: number) => number,
  stats?: StudioVolumeTransmittanceStats
): number {
  if (!(stepCount > 0) || !(tExit > tEnter) || !(densityScale > 0)) return 0;
  const dt = (tExit - tEnter) / stepCount;
  let tau = 0;
  for (let k = 0; k < stepCount; k += 1) {
    const t = tEnter + (k + offsetAt(k)) * dt;
    const density = sampleStudioVolumeDensity(
      prepared,
      clampToBounds(prepared, 0, ox + t * dx),
      clampToBounds(prepared, 1, oy + t * dy),
      clampToBounds(prepared, 2, oz + t * dz)
    );
    if (stats) stats.densitySamples += 1;
    tau += density * dt;
  }
  return tau * densityScale;
}

/** 위 광학깊이의 지수 — 비어–람베르트 투과율. */
export function rayMarchTransmittance(
  prepared: StudioVolumePrepared,
  densityScale: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tEnter: number,
  tExit: number,
  stepCount: number,
  offsetAt: (stepIndex: number) => number,
  stats?: StudioVolumeTransmittanceStats
): number {
  const tau = rayMarchOpticalDepth(
    prepared,
    densityScale,
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    tEnter,
    tExit,
    stepCount,
    offsetAt,
    stats
  );
  return Math.exp(-tau);
}

/**
 * 비율 추적(residual-free ratio tracking). majorant 는 전역 `densityScale * maxDensity` 다.
 * 반환값은 [0, 1] 구간의 **무편향** 투과율 추정치.
 */
export function ratioTrackingTransmittance(
  prepared: StudioVolumePrepared,
  densityScale: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tEnter: number,
  tExit: number,
  sampler: StudioVolumeSampler,
  stats?: StudioVolumeTransmittanceStats
): number {
  if (!(tExit > tEnter) || !(densityScale > 0)) return 1;
  const majorant = densityScale * prepared.maxDensity;
  if (!(majorant > 0)) return 1;

  const invMajorant = 1 / majorant;
  let t = tEnter;
  let weight = 1;

  for (let events = 0; events < STUDIO_VOLUME_MAX_TRACKING_EVENTS; events += 1) {
    const u = sampler.next();
    t -= Math.log(1 - u) * invMajorant;
    if (t >= tExit) break;

    const sigma =
      densityScale *
      sampleStudioVolumeDensity(
        prepared,
        clampToBounds(prepared, 0, ox + t * dx),
        clampToBounds(prepared, 1, oy + t * dy),
        clampToBounds(prepared, 2, oz + t * dz)
      );
    if (stats) stats.densitySamples += 1;

    const ratio = 1 - sigma * invMajorant;
    weight *= ratio > 0 ? ratio : 0;
    if (weight <= 0) return 0;

    if (weight < STUDIO_VOLUME_RR_THRESHOLD) {
      if (sampler.next() < STUDIO_VOLUME_RR_KILL_PROBABILITY) return 0;
      weight /= 1 - STUDIO_VOLUME_RR_KILL_PROBABILITY;
    }
  }

  return weight > 1 ? 1 : weight;
}

/**
 * 델타 추적(Woodcock tracking) 투과율 — 0 또는 1 을 돌려주는 베르누이 추정기.
 * 기댓값은 정확히 exp(-τ) 지만 분산이 커서 프로덕션 그림자 레이에는 쓰지 않는다(비교용).
 */
export function deltaTrackingTransmittance(
  prepared: StudioVolumePrepared,
  densityScale: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tEnter: number,
  tExit: number,
  sampler: StudioVolumeSampler,
  stats?: StudioVolumeTransmittanceStats
): number {
  if (!(tExit > tEnter) || !(densityScale > 0)) return 1;
  const majorant = densityScale * prepared.maxDensity;
  if (!(majorant > 0)) return 1;

  const invMajorant = 1 / majorant;
  let t = tEnter;

  for (let events = 0; events < STUDIO_VOLUME_MAX_TRACKING_EVENTS; events += 1) {
    t -= Math.log(1 - sampler.next()) * invMajorant;
    if (t >= tExit) return 1;
    const sigma =
      densityScale *
      sampleStudioVolumeDensity(
        prepared,
        clampToBounds(prepared, 0, ox + t * dx),
        clampToBounds(prepared, 1, oy + t * dy),
        clampToBounds(prepared, 2, oz + t * dz)
      );
    if (stats) stats.densitySamples += 1;
    if (sampler.next() < sigma * invMajorant) return 0;
  }
  return 0;
}

/**
 * 해석적 균질 슬랩 투과율 — 테스트/검증 기준값. exp(-σ·d).
 * (렌더 경로는 쓰지 않는다. "수식 하나만 고쳐도 테스트가 같이 통과" 하는 자기참조를 막기 위해
 *  테스트는 이 함수 대신 Math.exp 를 직접 쓴다.)
 */
export function beerLambertTransmittance(sigmaT: number, distance: number): number {
  if (!(sigmaT > 0) || !(distance > 0)) return 1;
  return Math.exp(-sigmaT * distance);
}

/**
 * 그림자/광원 방향 투과율. 월드 레이를 오브젝트 공간으로 옮기고 AABB 로 자른 뒤 비율 추적.
 * 볼륨을 스치지 않으면 1(완전 투과)을 돌려준다.
 */
export function studioVolumeShadowTransmittance(
  prepared: StudioVolumePrepared,
  densityScale: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  sampler: StudioVolumeSampler,
  stats?: StudioVolumeTransmittanceStats
): number {
  const span = intersectStudioVolumeBounds(prepared, ox, oy, oz, dx, dy, dz, 0, maxDistance);
  if (!span) return 1;
  return ratioTrackingTransmittance(
    prepared,
    densityScale,
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    span.tEnter,
    span.tExit,
    sampler,
    stats
  );
}
