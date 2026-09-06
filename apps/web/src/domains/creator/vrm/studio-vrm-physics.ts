// VRM 스프링본(흔들림 뼈) 물리 제어 — 머리카락·스커트·의상 부속의 "정지 컷 자연스러움" 핵심 모듈.
// three-vrm의 VRMSpringBoneManager(joint.settings: stiffness/gravityPower/gravityDir)를 구조적 타입으로만
// 다뤄서 three 의존 없이 단위 테스트가 가능하다.
//
// 설계 원칙(결정성):
//  - 정착(settle)은 고정 스텝 수 × 고정 델타로만 시뮬레이션한다(Math.random/가변 프레임 금지).
//  - 원본 조인트 설정은 최초 1회 캡처해 두고, 배율 적용은 항상 "원본 기준"으로 재계산한다(중첩 누적 방지).

export const VRM_PHYSICS_VERSION = 1 as const;

/** 정착 시뮬레이션 고정 스텝 수 — 60스텝 × 1/60s = 시뮬레이션 1초. */
export const PHYSICS_SETTLE_STEPS = 60;
/** 정착 시뮬레이션 고정 델타(초). */
export const PHYSICS_SETTLE_DELTA = 1 / 60;
/** 흔들림 미리보기 루프에서 사용할 프레임 델타 상한(저사양 프레임 드랍 시 폭주 방지). */
export const PHYSICS_PREVIEW_MAX_DELTA = 1 / 30;
/** 바람 세기 1.0이 만들어내는 수평 중력(gravityPower 단위) — VRoid 기본 중력(0.0~0.2)과 맞춘 스케일. */
export const WIND_GRAVITY_POWER = 0.08;

export type Vec3Tuple = readonly [number, number, number];

export interface VrmPhysicsSettings {
  version: typeof VRM_PHYSICS_VERSION;
  /** 스프링 탄성 배율(0~2). 낮을수록 흐물흐물, 높을수록 단단하게 제자리로 돌아온다. */
  stiffnessScale: number;
  /** 중력 배율(0~2). 머리카락/치마가 아래로 처지는 힘. */
  gravityScale: number;
  /** 바람 방향(도, -180~180). 0° = +X(화면 오른쪽), 90° = +Z(카메라 쪽). */
  windDirectionDeg: number;
  /** 바람 세기(0~2). gravityDir 회전(수평 중력 합성)으로 구현된다. */
  windStrength: number;
}

export const DEFAULT_VRM_PHYSICS: VrmPhysicsSettings = {
  version: VRM_PHYSICS_VERSION,
  stiffnessScale: 1,
  gravityScale: 1,
  windDirectionDeg: 0,
  windStrength: 0,
};

const MIN_SCALE = 0;
const MAX_SCALE = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 임의 입력(localStorage/문서 직렬화 등)을 안전한 물리 설정으로 정규화한다. */
export function parseVrmPhysicsSettings(raw: unknown): VrmPhysicsSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VRM_PHYSICS };
  const value = raw as Partial<Record<keyof VrmPhysicsSettings, unknown>>;
  return {
    version: VRM_PHYSICS_VERSION,
    stiffnessScale: clamp(toFiniteNumber(value.stiffnessScale, DEFAULT_VRM_PHYSICS.stiffnessScale), MIN_SCALE, MAX_SCALE),
    gravityScale: clamp(toFiniteNumber(value.gravityScale, DEFAULT_VRM_PHYSICS.gravityScale), MIN_SCALE, MAX_SCALE),
    windDirectionDeg: clamp(toFiniteNumber(value.windDirectionDeg, DEFAULT_VRM_PHYSICS.windDirectionDeg), -180, 180),
    windStrength: clamp(toFiniteNumber(value.windStrength, DEFAULT_VRM_PHYSICS.windStrength), MIN_SCALE, MAX_SCALE),
  };
}

export function isDefaultVrmPhysics(settings: VrmPhysicsSettings): boolean {
  return (
    settings.stiffnessScale === DEFAULT_VRM_PHYSICS.stiffnessScale &&
    settings.gravityScale === DEFAULT_VRM_PHYSICS.gravityScale &&
    settings.windDirectionDeg === DEFAULT_VRM_PHYSICS.windDirectionDeg &&
    settings.windStrength === DEFAULT_VRM_PHYSICS.windStrength
  );
}

/* ── three-vrm 구조 호환 타입(구조적 서브셋) ─────────────────────────── */

export interface SpringVector3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

export interface SpringJointSettingsLike {
  stiffness: number;
  gravityPower: number;
  gravityDir: SpringVector3Like;
}

export interface SpringJointLike {
  settings: SpringJointSettingsLike;
}

export interface SpringBoneManagerLike {
  joints: Iterable<SpringJointLike>;
  reset(): void;
}

export interface PhysicsVrmLike {
  update(delta: number): void;
  springBoneManager?: SpringBoneManagerLike | null;
}

/* ── 중력+바람 합성(순수 수학) ─────────────────────────────────────── */

export interface ComposedGravity {
  dir: Vec3Tuple;
  power: number;
}

/**
 * 원본 중력(dir×power)에 배율과 바람(수평 벡터)을 합성한다.
 * 바람은 gravityDir 회전으로 구현: 합성 벡터의 방향이 새 gravityDir, 길이가 새 gravityPower.
 */
export function composeSpringGravity(
  baseDir: Vec3Tuple,
  basePower: number,
  settings: Pick<VrmPhysicsSettings, "gravityScale" | "windDirectionDeg" | "windStrength">
): ComposedGravity {
  const gravityScale = clamp(settings.gravityScale, MIN_SCALE, MAX_SCALE);
  const windStrength = clamp(settings.windStrength, MIN_SCALE, MAX_SCALE);
  const windRad = (clamp(settings.windDirectionDeg, -180, 180) * Math.PI) / 180;

  const gx = baseDir[0] * basePower * gravityScale + Math.cos(windRad) * windStrength * WIND_GRAVITY_POWER;
  const gy = baseDir[1] * basePower * gravityScale;
  const gz = baseDir[2] * basePower * gravityScale + Math.sin(windRad) * windStrength * WIND_GRAVITY_POWER;

  const power = Math.hypot(gx, gy, gz);
  if (power < 1e-9) {
    return { dir: [0, -1, 0], power: 0 };
  }
  return { dir: [gx / power, gy / power, gz / power], power };
}

/* ── 조인트 원본 설정 캡처 + 배율 적용 ─────────────────────────────── */

interface SpringJointBase {
  stiffness: number;
  gravityPower: number;
  gravityDir: Vec3Tuple;
}

const springJointBaseCache = new WeakMap<SpringJointLike, SpringJointBase>();

function ensureJointBase(joint: SpringJointLike): SpringJointBase {
  const cached = springJointBaseCache.get(joint);
  if (cached) return cached;
  const base: SpringJointBase = {
    stiffness: joint.settings.stiffness,
    gravityPower: joint.settings.gravityPower,
    gravityDir: [joint.settings.gravityDir.x, joint.settings.gravityDir.y, joint.settings.gravityDir.z],
  };
  springJointBaseCache.set(joint, base);
  return base;
}

/** 모델의 스프링본 조인트 수(0이면 흔들림 정보가 베이크되지 않은 모델). */
export function countSpringBoneJoints(vrm: Pick<PhysicsVrmLike, "springBoneManager">): number {
  const manager = vrm.springBoneManager;
  if (!manager) return 0;
  let count = 0;
  for (const _joint of manager.joints) count += 1;
  return count;
}

/**
 * 물리 설정을 모든 스프링본 조인트에 적용한다(원본 기준 재계산 — 멱등).
 * @returns 적용된 조인트 수
 */
export function applyVrmSpringBonePhysics(vrm: PhysicsVrmLike, settings: VrmPhysicsSettings): number {
  const manager = vrm.springBoneManager;
  if (!manager) return 0;

  const stiffnessScale = clamp(settings.stiffnessScale, MIN_SCALE, MAX_SCALE);
  let count = 0;
  for (const joint of manager.joints) {
    const base = ensureJointBase(joint);
    joint.settings.stiffness = base.stiffness * stiffnessScale;
    const gravity = composeSpringGravity(base.gravityDir, base.gravityPower, settings);
    joint.settings.gravityPower = gravity.power;
    joint.settings.gravityDir.set(gravity.dir[0], gravity.dir[1], gravity.dir[2]);
    count += 1;
  }
  return count;
}

/**
 * 정지 컷용 정착(settle) 시뮬레이션 — 포즈/모델/물리 변경 직후 호출한다.
 * springBone 상태를 리셋한 뒤 고정 스텝(기본 60×1/60s)으로 흔들림이 가라앉은 프레임을 만든다.
 * vrm.update(delta)는 springBone 외에도 constraint/expression/lookAt을 함께 갱신하므로 안전하다.
 */
export function settleVrmPhysics(
  vrm: PhysicsVrmLike,
  steps: number = PHYSICS_SETTLE_STEPS,
  delta: number = PHYSICS_SETTLE_DELTA
): void {
  vrm.springBoneManager?.reset();
  const safeSteps = Math.max(0, Math.floor(steps));
  for (let index = 0; index < safeSteps; index += 1) {
    vrm.update(delta);
  }
}
