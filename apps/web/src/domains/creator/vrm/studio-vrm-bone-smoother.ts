
// 본 회전 시간축 스무딩 — One-Euro 필터를 quaternion(slerp) 위에서 구현.
//
// 얼굴 채널은 이미 EMA 스무딩되지만(studio-vrm-webcam-tracking),
// 팔/다리 본은 raw 로 적용돼 떨림이 심했다. 여기서 본별로:
//  - 측지(geodesic) 각속도로 One-Euro 컷오프를 적응시킨다(정지=부드럽게, 빠른 동작=즉각).
//  - quaternion 반구 정렬(q·prev<0 → 부호 반전)로 slerp 튐 방지.
//  - 데드밴드로 미세 지터 무시, max-step 으로 프레임당 급변(팝핑) 억제.
//
// z(깊이) 노이즈는 솔버에서 선제 감쇠하므로, 여기 One-Euro 의 "속도 적응이 깊이 노이즈를
// 통과시킨다"는 약점이 완화된다(둘을 함께 써야 자연스럽다).
//
// 순수 단계 함수(smoothQuaternionStep)와 상태 보관 래퍼(VrmBoneSmoother)로 분리해 테스트한다.

import * as THREE from "three";

export interface BoneSmootherOptions {
  /** One-Euro 최소 컷오프(Hz). 낮을수록 정지 시 더 부드럽고 느리다. */
  minCutoff: number;
  /** 속도 민감도. 높을수록 빠른 동작에 즉각 반응(지연↓). */
  beta: number;
  /** 데드밴드(rad). 측지 각 변화가 이보다 작으면 이전 값 유지(미세 지터 제거). */
  deadBand: number;
  /** 프레임당 최대 회전(rad). 급격한 팝핑을 제한. */
  maxStep: number;
}

export const DEFAULT_BONE_SMOOTHER: Readonly<BoneSmootherOptions> = {
  // 충실도 우선: 정지 시 컷오프를 높여 지연을 줄이고(반응적), 빠른 동작엔 거의 즉각.
  minCutoff: 3.0,
  beta: 0.8,
  deadBand: 0.004,
  maxStep: 1.2,
};

/** head/neck 용 — 시선이 머무는 비주얼 채널이라 팔다리보다 지터 억제를 우선한다. */
export const HEAD_BONE_SMOOTHER: Readonly<BoneSmootherOptions> = {
  minCutoff: 1.5,
  beta: 0.5,
  deadBand: 0.002,
  maxStep: 0.8,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One-Euro: 각속도(speed)에 따라 컷오프를 올려 보간 계수 α(0~1)를 만든다. */
export function oneEuroAlpha(speed: number, dt: number, minCutoff: number, beta: number): number {
  const cutoff = minCutoff + beta * speed;
  const tau = 1 / (2 * Math.PI * cutoff);
  return clamp(1 / (1 + tau / Math.max(dt, 1e-4)), 0, 1);
}

/**
 * 이전 스무딩 quaternion에서 raw Euler 회전으로 한 스텝 보간한다(slerp).
 * prev 가 없으면 raw 를 그대로(첫 프레임 스냅).
 */
export function smoothQuaternionStep(
  prev: THREE.Quaternion | null,
  rawEuler: readonly [number, number, number],
  dt: number,
  opts: BoneSmootherOptions
): THREE.Quaternion {
  const raw = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rawEuler[0], rawEuler[1], rawEuler[2], "XYZ")
  );
  if (!prev) return raw;
  // 반구 정렬: q 와 -q 는 같은 회전이므로 prev 와 가까운 쪽으로 맞춘다(slerp 최단경로).
  if (prev.dot(raw) < 0) raw.set(-raw.x, -raw.y, -raw.z, -raw.w);
  const dot = clamp(prev.dot(raw), -1, 1);
  const angle = 2 * Math.acos(dot); // 측지 각도(rad)
  if (angle < opts.deadBand) return prev.clone(); // 미세 지터 무시
  const speed = angle / Math.max(dt, 1e-4);
  let t = oneEuroAlpha(speed, dt, opts.minCutoff, opts.beta);
  if (angle * t > opts.maxStep) t = opts.maxStep / angle; // 프레임당 최대 회전 제한
  return prev.clone().slerp(raw, t);
}

/** 본 이름별 스무딩 상태를 보관하는 래퍼. useRef 에 보관해 프레임 간 유지한다. */
export class VrmBoneSmoother {
  private readonly states = new Map<string, THREE.Quaternion>();
  private readonly opts: BoneSmootherOptions;

  constructor(opts: BoneSmootherOptions = DEFAULT_BONE_SMOOTHER) {
    this.opts = opts;
  }

  /** 본의 raw Euler 를 스무딩한 quaternion 으로 반환(상태 갱신). */
  smooth(boneName: string, rawEuler: readonly [number, number, number], dt: number): THREE.Quaternion {
    const next = smoothQuaternionStep(this.states.get(boneName) ?? null, rawEuler, dt, this.opts);
    this.states.set(boneName, next);
    return next;
  }

  /**
   * 미검출 본을 타깃(rest) 회전 쪽으로 부드럽게 감쇠(half-life 기반).
   * - 추적된 적 없는 본(상태 없음)은 페이드하지 않고 null 반환.
   * - rest 에 충분히 도달하면 상태를 비우고 null 반환(이후 적용 불필요 → 그대로 유지).
   * 반환값이 있으면 그 quaternion 을 적용한다.
   */
  fadeToward(
    boneName: string,
    targetEuler: readonly [number, number, number],
    dt: number,
    halfLifeSec: number
  ): THREE.Quaternion | null {
    const cur = this.states.get(boneName);
    if (!cur) return null;
    const target = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(targetEuler[0], targetEuler[1], targetEuler[2], "XYZ")
    );
    if (cur.dot(target) < 0) target.set(-target.x, -target.y, -target.z, -target.w);
    const alpha = 1 - Math.pow(0.5, Math.max(dt, 1e-4) / Math.max(halfLifeSec, 1e-3));
    const next = cur.clone().slerp(target, alpha);
    const remaining = 2 * Math.acos(clamp(Math.abs(next.dot(target)), -1, 1));
    if (remaining < 0.01) {
      this.states.delete(boneName);
      return null;
    }
    this.states.set(boneName, next);
    return next;
  }

  /** 이번 프레임에 미검출된 본의 상태 제거(재검출 시 stale 보간 대신 즉시 스냅). */
  forget(boneName: string): void {
    this.states.delete(boneName);
  }

  /** 이번 프레임에 적용된 본 외 모든 상태 제거. */
  retainOnly(activeBones: Iterable<string>): void {
    const keep = new Set(activeBones);
    for (const name of [...this.states.keys()]) {
      if (!keep.has(name)) this.states.delete(name);
    }
  }

  reset(): void {
    this.states.clear();
  }
}
