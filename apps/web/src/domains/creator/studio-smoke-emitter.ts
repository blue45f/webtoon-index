/**
 * Studio Smoke Emitter — 결정적 연기 소스
 *
 * 구(sphere)/원뿔(cone) 모양으로 density·temperature·velocity 를 격자에 주입한다.
 * **난수 없음**: 지터는 `hash2(cellIndex, frameIndex, seed)`(studio-grain 의 좌표·시드
 * 결정적 해시)로 만든다. 같은 (emitter, frameIndex) 는 항상 같은 주입 패턴이라
 * 시뮬레이션 전체가 재현 가능하다 — Math.random/Date.now 0건.
 *
 * ## 모양
 *  - sphere: 중심 (x,y,z), 반지름 r. 감쇠 = 1 − smoothstep(0,1, dist/r).
 *  - cone  : **+y 로 열린** 원뿔. 꼭짓점 (x,y,z), 높이 height, 밑면 반지름 radius.
 *            높이 t=dy/height 에서 허용 반경은 radius·t 이고, 세로로도 (1−t) 로 약해진다
 *            (굴뚝 입구에서 세게, 위로 갈수록 흐려지는 플룸 형태).
 *
 * ## 주입 규칙
 *  - density  += dt · densityRate · falloff · jitterMul
 *  - temperature += dt · temperatureRate · falloff · jitterMul
 *  - 속도는 셀의 양쪽 면에 절반씩 나눠 더한다(면 하나가 두 셀에서 기여받을 수 있다 —
 *    부드러운 소스라 의도한 동작이다).
 *  - solid 셀은 건너뛴다.
 *
 * ## 한계
 * 셀 단위 계단 falloff 이고 부분 셀 점유가 없다. 애니메이션되는 이미터(경로를 따라
 * 움직이는 소스)나 텍스처 기반 소스 마스크는 지원하지 않는다.
 */

import { hash2 } from "./studio-grain";
import { stepStudioSmoke } from "./studio-smoke-core";
import { studioSmokeCellIndex, studioSmokeUIndex, studioSmokeVIndex, studioSmokeWIndex } from "./studio-smoke-grid";

import type { StudioSmokeStepParams, StudioSmokeStepResult } from "./studio-smoke-core";
import type { StudioSmokeState } from "./studio-smoke-grid";

export type StudioSmokeEmitterShape = "sphere" | "cone";

export interface StudioSmokeEmitter {
  readonly shape: StudioSmokeEmitterShape;
  /** 셀 단위 좌표. sphere 는 중심, cone 은 꼭짓점(아래쪽 끝). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 셀 단위 반지름(cone 은 밑면 반지름). */
  readonly radius: number;
  /** cone 전용 — +y 방향 높이(셀). sphere 에서는 무시. */
  readonly height: number;
  /** 초당 주입 밀도. */
  readonly densityRate: number;
  /** 초당 주입 온도. */
  readonly temperatureRate: number;
  /** 초기 분사 속도(월드단위/초) [vx,vy,vz]. */
  readonly velocity: readonly [number, number, number];
  /** 0..1 — 주입량 변동 폭(0 이면 완전 대칭·결정적 균일). */
  readonly jitter: number;
  /** 결정적 시드. 같은 시드는 항상 같은 지터 패턴. */
  readonly seed: number;
}

function smoothFalloff(t: number): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  // 1 − smoothstep(0,1,t) — 가장자리에서 기울기 0 이라 계단 티가 덜 난다.
  return 1 - t * t * (3 - 2 * t);
}

/** (i,j,k) 에서 이미터의 감쇠값 0..1. 0 이면 이 셀은 이미터 밖이다. */
export function studioSmokeEmitterFalloff(
  emitter: StudioSmokeEmitter,
  i: number,
  j: number,
  k: number,
): number {
  const dx = i + 0.5 - emitter.x;
  const dy = j + 0.5 - emitter.y;
  const dz = k + 0.5 - emitter.z;
  if (emitter.shape === "sphere") {
    if (emitter.radius <= 0) return 0;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return smoothFalloff(dist / emitter.radius);
  }
  if (emitter.radius <= 0 || emitter.height <= 0) return 0;
  if (dy < 0 || dy > emitter.height) return 0;
  const t = dy / emitter.height;
  const allowed = emitter.radius * t;
  const radial = Math.sqrt(dx * dx + dz * dz);
  if (allowed <= 0) return radial === 0 ? 1 : 0;
  return smoothFalloff(radial / allowed) * (1 - t);
}

/**
 * 이미터 하나의 지터 배수 — `hash2(cellIndex, frameIndex, seed)` 기반.
 * jitter=0 이면 정확히 1(항등)이라 대칭 검증이 가능하다.
 */
export function studioSmokeEmitterJitter(
  emitter: StudioSmokeEmitter,
  cellIndex: number,
  frameIndex: number,
): number {
  if (emitter.jitter <= 0) return 1;
  const noise = hash2(cellIndex, frameIndex, emitter.seed);
  return 1 + emitter.jitter * (2 * noise - 1);
}

/** 이미터 하나를 한 프레임 주입한다. 반환값 = 실제로 값이 들어간 fluid 셀 수. */
export function applyStudioSmokeEmitter(
  state: StudioSmokeState,
  emitter: StudioSmokeEmitter,
  dt: number,
  frameIndex: number,
): number {
  const { spec, fields } = state;
  const reach =
    emitter.shape === "sphere"
      ? emitter.radius
      : Math.max(emitter.radius, emitter.height) + 1;
  const i0 = Math.max(0, Math.floor(emitter.x - reach - 1));
  const i1 = Math.min(spec.nx - 1, Math.ceil(emitter.x + reach + 1));
  const j0 = Math.max(0, Math.floor(emitter.y - reach - 1));
  const j1 = Math.min(spec.ny - 1, Math.ceil(emitter.y + reach + 1));
  const k0 = Math.max(0, Math.floor(emitter.z - reach - 1));
  const k1 = Math.min(spec.nz - 1, Math.ceil(emitter.z + reach + 1));
  const [vx, vy, vz] = emitter.velocity;
  let touched = 0;

  for (let k = k0; k <= k1; k += 1) {
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        if (fields.solid[cell] !== 0) continue;
        const falloff = studioSmokeEmitterFalloff(emitter, i, j, k);
        if (falloff <= 0) continue;
        const weight = falloff * studioSmokeEmitterJitter(emitter, cell, frameIndex);
        fields.density[cell] += dt * emitter.densityRate * weight;
        fields.temperature[cell] += dt * emitter.temperatureRate * weight;
        if (vx !== 0) {
          const push = dt * vx * weight * 0.5;
          fields.u[studioSmokeUIndex(spec, i, j, k)] += push;
          fields.u[studioSmokeUIndex(spec, i + 1, j, k)] += push;
        }
        if (vy !== 0) {
          const push = dt * vy * weight * 0.5;
          fields.v[studioSmokeVIndex(spec, i, j, k)] += push;
          fields.v[studioSmokeVIndex(spec, i, j + 1, k)] += push;
        }
        if (vz !== 0) {
          const push = dt * vz * weight * 0.5;
          fields.w[studioSmokeWIndex(spec, i, j, k)] += push;
          fields.w[studioSmokeWIndex(spec, i, j, k + 1)] += push;
        }
        touched += 1;
      }
    }
  }
  return touched;
}

/** 이미터 목록을 배열 순서대로 주입한다(순서가 결과에 영향을 주므로 고정 순회). */
export function applyStudioSmokeEmitters(
  state: StudioSmokeState,
  emitters: readonly StudioSmokeEmitter[],
  dt: number,
  frameIndex: number,
): number {
  let touched = 0;
  for (let index = 0; index < emitters.length; index += 1) {
    touched += applyStudioSmokeEmitter(state, emitters[index], dt, frameIndex);
  }
  return touched;
}

/**
 * 이미터 주입 + 솔버 스텝 한 프레임. 코어(studio-smoke-core)는 이미터를 모르므로
 * 조합은 이 모듈이 제공한다(의존 방향: emitter → core, 역방향 없음).
 */
export function advanceStudioSmokeFrame(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
  emitters: readonly StudioSmokeEmitter[],
  frameIndex: number,
): StudioSmokeStepResult {
  applyStudioSmokeEmitters(state, emitters, params.dt, frameIndex);
  return stepStudioSmoke(state, params);
}

/**
 * frameCount 프레임을 0부터 순서대로 돌린다 — 베이크/테스트용.
 * frameIndex 는 0..frameCount-1 로 명시적으로 흐르므로 시간에 의존하지 않는다.
 */
export function simulateStudioSmokeFrames(
  state: StudioSmokeState,
  params: StudioSmokeStepParams,
  emitters: readonly StudioSmokeEmitter[],
  frameCount: number,
): StudioSmokeStepResult[] {
  const results: StudioSmokeStepResult[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    results.push(advanceStudioSmokeFrame(state, params, emitters, frameIndex));
  }
  return results;
}
