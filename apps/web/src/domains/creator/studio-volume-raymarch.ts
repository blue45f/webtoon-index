/**
 * Studio Volume — 방사전달(radiative transfer) 적분기 · 단일산란
 *
 * 풀려는 식(방출-흡수-산란 매질의 RTE, 단일산란 근사):
 *
 *   L(o, ω) = ∫_{t0}^{t1} T(t0, t) [ σ_s(x_t)·∫_{4π} p(ω_i·ω) L_i(x_t, ω_i) dω_i
 *                                    + σ_a(x_t)·L_e(T(x_t)) ] dt   +   T(t0, t1)·L_bg
 *
 *   T(a,b) = exp(-∫_a^b σ_t ds)             (비어–람베르트)
 *   σ_t = densityScale·density,  σ_s = albedo·σ_t,  σ_a = (1-albedo)·σ_t
 *
 * 내부 적분은 **광원별 직접 조명만** 취한다(단일산란). 즉 σ_s·Σ_l p(ω_l·ω)·L_l·T_shadow.
 * 다중산란은 계산하지 않는다 — 짙은 연기의 밝은 회색빛(전방향 확산)이 실제보다 어둡게 나온다.
 * `ambientRadiance` 는 그 결손을 아트 디렉션으로 메우기 위한 **비물리 상수항**이며 기본 0 이다.
 *
 * ── 스텝 격자(빈 공간 스킵이 이미지를 바꾸지 않는 이유) ───────────────────
 * 진입점 tEnter 를 기준으로 **고정 격자**를 깐다:
 *
 *     dt = (tExit - tEnter) / K,     t_k = tEnter + (k + ξ_k)·dt,     ξ_k ∈ [0,1)
 *
 * ξ_k 는 (seed, rayKey, k) 해시라 마칭 경로와 무관하다. 빈 블록 안의 스텝은 σ_t = 0 이므로
 * `continue` 로 아무것도 갱신하지 않는다(T *= 1, radiance += 0 → 부동소수 연산조차 없다).
 * 따라서 occupancy 를 켜든 끄든 **결과가 비트 단위로 같다**. 테스트가 이를 직접 검증한다.
 */

import {
  normalizeStudioVolumeEmissionParams,
  studioVolumeBlackbodyEmission,
} from "./studio-volume-emission";
import {
  intersectStudioVolumeBounds,
  sampleStudioVolumeDensity,
  sampleStudioVolumeTemperature,
  studioVolumeWorldRayToObject,
} from "./studio-volume-grid";
import { studioVolumeOccupiedIntervals, studioVolumeStepRanges } from "./studio-volume-occupancy";
import { henyeyGreensteinPhase } from "./studio-volume-phase";
import {
  STUDIO_VOLUME_DIM_SHADOW,
  createStudioVolumeSampler,
  studioVolumeStratifiedOffset,
} from "./studio-volume-sampler";
import { ratioTrackingTransmittance } from "./studio-volume-transmittance";

import type { StudioVolumeEmissionParams } from "./studio-volume-emission";
import type { StudioVolumePrepared, StudioVolumeVec3 } from "./studio-volume-grid";
import type { StudioVolumeOccupancy } from "./studio-volume-occupancy";

export interface StudioVolumePointLight {
  readonly kind: "point";
  /** 월드 좌표. */
  readonly position: StudioVolumeVec3;
  /** 선형 RGB(정규화 불필요). */
  readonly color: StudioVolumeVec3;
  readonly intensity: number;
  /** 1/r² 감쇠(기본 true). false 면 거리 무관 — 스타일 조명용. */
  readonly inverseSquare?: boolean;
}

export interface StudioVolumeDirectionalLight {
  readonly kind: "directional";
  /** 빛이 **진행하는** 방향(월드). 샘플점→광원 방향은 이것의 반대다. 정규화된다. */
  readonly direction: StudioVolumeVec3;
  readonly color: StudioVolumeVec3;
  readonly intensity: number;
}

export type StudioVolumeLight = StudioVolumePointLight | StudioVolumeDirectionalLight;

export interface StudioVolumeMedium {
  /** density 1 단위당 소광계수 [1/world-unit]. */
  readonly densityScale: number;
  /** σ_s/σ_t ∈ [0,1]. 1 = 순수 산란(연기), 0 = 순수 흡수(그을음/재). */
  readonly scatteringAlbedo: number;
  /** HG 비등방성 g ∈ (-1,1). 연기는 +0.2~+0.5 가 흔하다. */
  readonly anisotropy: number;
  readonly emission: StudioVolumeEmissionParams;
  /** 방출 항 전체 배율(아트 디렉션). */
  readonly emissionScale: number;
  /** 다중산란 결손 보정용 **비물리** 상수 입사 복사휘도. 기본 [0,0,0]. */
  readonly ambientRadiance: StudioVolumeVec3;
}

export interface StudioVolumeMarchParams {
  /** 목표 스텝 크기(월드 단위). 실제 dt 는 스팬을 정수 등분하도록 살짝 조정된다. */
  readonly stepSize: number;
  readonly maxSteps: number;
  /** 0 = 정확히 중점(밴딩), 1 = stratum 전체 지터(밴딩 없음). */
  readonly jitter: number;
  readonly seed: number;
  /** 투과율이 이보다 작아지면 조기 종료. */
  readonly transmittanceCutoff: number;
  /** depth 를 확정하는 누적 불투명도 임계값. */
  readonly depthAlphaThreshold: number;
  readonly useOccupancy: boolean;
  /** "none" 이면 그림자 투과율을 1 로 고정(빠른 프리뷰). */
  readonly shadowMode: "ratio-tracking" | "none";
}

export interface StudioVolumeScene {
  readonly medium: StudioVolumeMedium;
  readonly lights: readonly StudioVolumeLight[];
}

export interface StudioVolumeRayResult {
  /** 프리멀티플라이드 복사휘도(= Σ T·source·ds). 배경 위에 그대로 `over` 합성된다. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 레이 전체 투과율 T(t0,t1) ∈ [0,1]. */
  readonly transmittance: number;
  /** 1 - transmittance. */
  readonly alpha: number;
  /** 누적 불투명도가 depthAlphaThreshold 를 처음 넘은 지점의 월드 거리. 없으면 Infinity. */
  readonly depth: number;
  /** 불투명도 가중 평균 거리(모션블러/DOF·디노이저용). 없으면 Infinity. */
  readonly expectedDepth: number;
  readonly densitySamples: number;
  readonly shadowSamples: number;
  readonly steps: number;
  readonly stepCount: number;
}

export const STUDIO_VOLUME_DEFAULT_MEDIUM: StudioVolumeMedium = Object.freeze({
  densityScale: 1,
  scatteringAlbedo: 0.9,
  anisotropy: 0.3,
  emission: normalizeStudioVolumeEmissionParams(),
  emissionScale: 1,
  ambientRadiance: [0, 0, 0] as StudioVolumeVec3,
});

export const STUDIO_VOLUME_DEFAULT_MARCH: StudioVolumeMarchParams = Object.freeze({
  stepSize: 0.05,
  maxSteps: 512,
  jitter: 1,
  seed: 0x5eed,
  transmittanceCutoff: 1e-3,
  depthAlphaThreshold: 0.5,
  useOccupancy: true,
  shadowMode: "ratio-tracking" as const,
});

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value < min ? min : value > max ? max : value;
}

function vec3(value: unknown, fallback: StudioVolumeVec3): StudioVolumeVec3 {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return fallback;
  const src = value as ArrayLike<number>;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const v = src[i];
    out[i] = typeof v === "number" && Number.isFinite(v) ? v : fallback[i];
  }
  return out;
}

export function normalizeStudioVolumeMedium(
  medium?: Partial<StudioVolumeMedium> | null
): StudioVolumeMedium {
  const base = STUDIO_VOLUME_DEFAULT_MEDIUM;
  return {
    densityScale: num(medium?.densityScale, base.densityScale, 0, 1e9),
    scatteringAlbedo: num(medium?.scatteringAlbedo, base.scatteringAlbedo, 0, 1),
    anisotropy: num(medium?.anisotropy, base.anisotropy, -0.995, 0.995),
    emission: normalizeStudioVolumeEmissionParams(medium?.emission),
    emissionScale: num(medium?.emissionScale, base.emissionScale, 0, 1e9),
    ambientRadiance: vec3(medium?.ambientRadiance, base.ambientRadiance),
  };
}

export function normalizeStudioVolumeMarch(
  march?: Partial<StudioVolumeMarchParams> | null
): StudioVolumeMarchParams {
  const base = STUDIO_VOLUME_DEFAULT_MARCH;
  return {
    stepSize: num(march?.stepSize, base.stepSize, 1e-6, 1e9),
    maxSteps: Math.floor(num(march?.maxSteps, base.maxSteps, 1, 1 << 20)),
    jitter: num(march?.jitter, base.jitter, 0, 1),
    seed: Math.floor(num(march?.seed, base.seed, 0, 0xffffffff)),
    transmittanceCutoff: num(march?.transmittanceCutoff, base.transmittanceCutoff, 0, 1),
    depthAlphaThreshold: num(march?.depthAlphaThreshold, base.depthAlphaThreshold, 0, 1),
    useOccupancy: march?.useOccupancy ?? base.useOccupancy,
    shadowMode: march?.shadowMode === "none" ? "none" : base.shadowMode,
  };
}

const EMPTY_RESULT: StudioVolumeRayResult = Object.freeze({
  r: 0,
  g: 0,
  b: 0,
  transmittance: 1,
  alpha: 0,
  depth: Number.POSITIVE_INFINITY,
  expectedDepth: Number.POSITIVE_INFINITY,
  densitySamples: 0,
  shadowSamples: 0,
  steps: 0,
  stepCount: 0,
});

/** 광원 평가 결과 스크래치 — [wx, wy, wz, distance, Lr, Lg, Lb]. */
type LightScratch = Float64Array;

function evaluateLight(
  light: StudioVolumeLight,
  px: number,
  py: number,
  pz: number,
  out: LightScratch
): boolean {
  if (light.kind === "directional") {
    const d = light.direction;
    const len = Math.hypot(d[0], d[1], d[2]);
    if (!(len > 0)) return false;
    out[0] = -d[0] / len;
    out[1] = -d[1] / len;
    out[2] = -d[2] / len;
    out[3] = Number.POSITIVE_INFINITY;
    out[4] = light.color[0] * light.intensity;
    out[5] = light.color[1] * light.intensity;
    out[6] = light.color[2] * light.intensity;
    return true;
  }
  const dx = light.position[0] - px;
  const dy = light.position[1] - py;
  const dz = light.position[2] - pz;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 0)) return false;
  out[0] = dx / dist;
  out[1] = dy / dist;
  out[2] = dz / dist;
  out[3] = dist;
  const falloff = light.inverseSquare === false ? 1 : 1 / (dist * dist);
  const scale = light.intensity * falloff;
  out[4] = light.color[0] * scale;
  out[5] = light.color[1] * scale;
  out[6] = light.color[2] * scale;
  return true;
}

function clampAxis(prepared: StudioVolumePrepared, axis: number, value: number): number {
  const min = prepared.boundsMin[axis];
  const max = prepared.boundsMax[axis];
  return value < min ? min : value > max ? max : value;
}

/**
 * 월드 레이 하나를 적분한다. `dirX/Y/Z` 는 **정규화된 월드 방향**이어야 한다(그래야 t 가 월드
 * 거리이고 σ_t·dt 가 무차원 광학깊이가 된다). `rayKey` 는 샘플러 결정성 키(보통 픽셀 인덱스).
 * `maxDistance` 는 배경 깊이 클립(래스터/패스트레이스 배경 앞까지만 적분).
 */
export function integrateStudioVolumeRay(
  prepared: StudioVolumePrepared,
  scene: StudioVolumeScene,
  march: StudioVolumeMarchParams,
  occupancy: StudioVolumeOccupancy | null,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  rayKey: number,
  maxDistance: number = Number.POSITIVE_INFINITY
): StudioVolumeRayResult {
  if (prepared.degenerate || prepared.maxDensity <= 0) return EMPTY_RESULT;

  const ray = studioVolumeWorldRayToObject(
    prepared,
    originX,
    originY,
    originZ,
    dirX,
    dirY,
    dirZ
  );
  const ox = ray[0];
  const oy = ray[1];
  const oz = ray[2];
  const dx = ray[3];
  const dy = ray[4];
  const dz = ray[5];

  const span = intersectStudioVolumeBounds(prepared, ox, oy, oz, dx, dy, dz, 0, maxDistance);
  if (!span) return EMPTY_RESULT;

  const { tEnter, tExit } = span;
  const length = tExit - tEnter;
  const stepCount = Math.max(1, Math.min(march.maxSteps, Math.ceil(length / march.stepSize)));
  const dt = length / stepCount;

  const ranges =
    march.useOccupancy && occupancy && occupancy.totalBlocks > 0
      ? studioVolumeStepRanges(
          studioVolumeOccupiedIntervals(
            prepared,
            occupancy,
            ox,
            oy,
            oz,
            dx,
            dy,
            dz,
            tEnter,
            tExit
          ),
          tEnter,
          dt,
          stepCount
        )
      : [0, stepCount - 1];

  const medium = scene.medium;
  const lights = scene.lights;
  const lightCount = lights.length;
  const albedo = medium.scatteringAlbedo;
  const densityScale = medium.densityScale;
  const g = medium.anisotropy;
  const hasTemperature = prepared.temperature !== null && medium.emissionScale > 0;
  const ambient = medium.ambientRadiance;
  const hasAmbient = ambient[0] !== 0 || ambient[1] !== 0 || ambient[2] !== 0;
  const useShadows = march.shadowMode === "ratio-tracking";

  const lightScratch: LightScratch = new Float64Array(7);
  const emissionScratch = new Float64Array(3);
  const shadowSampler = createStudioVolumeSampler(march.seed, rayKey);
  const shadowStats = { densitySamples: 0 };

  let transmittance = 1;
  let radianceR = 0;
  let radianceG = 0;
  let radianceB = 0;
  let depth = Number.POSITIVE_INFINITY;
  let depthWeightSum = 0;
  let depthWeightedSum = 0;
  let densitySamples = 0;
  let steps = 0;

  let terminated = false;

  for (let rangeIndex = 0; rangeIndex < ranges.length && !terminated; rangeIndex += 2) {
    const kLo = ranges[rangeIndex];
    const kHi = ranges[rangeIndex + 1];
    for (let k = kLo; k <= kHi; k += 1) {
      const offset = studioVolumeStratifiedOffset(march.seed, rayKey, k, march.jitter);
      const t = tEnter + (k + offset) * dt;
      const sx = clampAxis(prepared, 0, ox + t * dx);
      const sy = clampAxis(prepared, 1, oy + t * dy);
      const sz = clampAxis(prepared, 2, oz + t * dz);

      const density = sampleStudioVolumeDensity(prepared, sx, sy, sz);
      densitySamples += 1;
      steps += 1;
      const sigmaT = densityScale * density;
      if (!(sigmaT > 0)) continue;

      const sigmaS = albedo * sigmaT;
      const sigmaA = sigmaT - sigmaS;
      const stepT = Math.exp(-sigmaT * dt);
      // ∫_0^dt exp(-σ s) ds — 스텝 내부 감쇠를 해석적으로 처리(균질 스텝 가정).
      const weight = (1 - stepT) / sigmaT;

      let srcR = 0;
      let srcG = 0;
      let srcB = 0;

      if (sigmaS > 0 && lightCount > 0) {
        const wx = originX + t * dirX;
        const wy = originY + t * dirY;
        const wz = originZ + t * dirZ;
        for (let li = 0; li < lightCount; li += 1) {
          if (!evaluateLight(lights[li], wx, wy, wz, lightScratch)) continue;
          // 전방 전파 규약: cosθ = dot(ω_in, ω_out) = dot(-wi, -rayDir) = dot(wi, rayDir).
          const cosTheta =
            lightScratch[0] * dirX + lightScratch[1] * dirY + lightScratch[2] * dirZ;
          const phase = henyeyGreensteinPhase(g, cosTheta);
          let shadow = 1;
          if (useShadows) {
            // 차원 오프셋을 더해 스텝 지터(dim 0)와 키가 겹치지 않게 한다. WGSL 포트도 같은
            // `3 + li` 를 쓴다 — 두 경로의 난수열이 어긋나면 GPU/CPU 패리티를 잃는다.
            shadowSampler.rekey(march.seed, rayKey, k, STUDIO_VOLUME_DIM_SHADOW + li);
            const sdx =
              prepared.worldToObject[0] * lightScratch[0] +
              prepared.worldToObject[4] * lightScratch[1] +
              prepared.worldToObject[8] * lightScratch[2];
            const sdy =
              prepared.worldToObject[1] * lightScratch[0] +
              prepared.worldToObject[5] * lightScratch[1] +
              prepared.worldToObject[9] * lightScratch[2];
            const sdz =
              prepared.worldToObject[2] * lightScratch[0] +
              prepared.worldToObject[6] * lightScratch[1] +
              prepared.worldToObject[10] * lightScratch[2];
            const shadowSpan = intersectStudioVolumeBounds(
              prepared,
              sx,
              sy,
              sz,
              sdx,
              sdy,
              sdz,
              0,
              lightScratch[3]
            );
            shadow = shadowSpan
              ? ratioTrackingTransmittance(
                  prepared,
                  densityScale,
                  sx,
                  sy,
                  sz,
                  sdx,
                  sdy,
                  sdz,
                  shadowSpan.tEnter,
                  shadowSpan.tExit,
                  shadowSampler,
                  shadowStats
                )
              : 1;
          }
          const contribution = sigmaS * phase * shadow;
          srcR += contribution * lightScratch[4];
          srcG += contribution * lightScratch[5];
          srcB += contribution * lightScratch[6];
        }
      }

      if (hasAmbient && sigmaS > 0) {
        srcR += sigmaS * ambient[0];
        srcG += sigmaS * ambient[1];
        srcB += sigmaS * ambient[2];
      }

      if (hasTemperature && sigmaA > 0) {
        const temperature = sampleStudioVolumeTemperature(prepared, sx, sy, sz);
        if (temperature > medium.emission.ignitionK) {
          studioVolumeBlackbodyEmission(temperature, medium.emission, emissionScratch);
          const emissive = sigmaA * medium.emissionScale;
          srcR += emissive * emissionScratch[0];
          srcG += emissive * emissionScratch[1];
          srcB += emissive * emissionScratch[2];
        }
      }

      const attenuated = transmittance * weight;
      radianceR += attenuated * srcR;
      radianceG += attenuated * srcG;
      radianceB += attenuated * srcB;

      const opacityContribution = transmittance * (1 - stepT);
      depthWeightSum += opacityContribution;
      depthWeightedSum += opacityContribution * t;

      transmittance *= stepT;
      if (depth === Number.POSITIVE_INFINITY && 1 - transmittance >= march.depthAlphaThreshold) {
        depth = t;
      }
      // 조기 종료. 남은 구간의 기여를 버리는 대신 누적된 실제 T 를 그대로 보고한다(0 으로
      // 강제하지 않는다) — 배경 합성에서 미세하게 더 정확하고, 스킵/나이브 경로가 같은 k 에서
      // 같은 분기를 타므로 동치성 계약도 그대로 유지된다.
      if (transmittance < march.transmittanceCutoff) {
        terminated = true;
        break;
      }
    }
  }

  return {
    r: radianceR,
    g: radianceG,
    b: radianceB,
    transmittance,
    alpha: 1 - transmittance,
    depth,
    expectedDepth: depthWeightSum > 0 ? depthWeightedSum / depthWeightSum : Number.POSITIVE_INFINITY,
    densitySamples,
    shadowSamples: shadowStats.densitySamples,
    steps,
    stepCount,
  };
}
