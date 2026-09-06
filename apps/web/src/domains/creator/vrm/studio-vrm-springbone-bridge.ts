// VRM 스프링본 오써링 ↔ three-vrm 런타임 브리지.
//
// three 를 import 하지 않고 "구조적 서브셋 타입"으로만 three-vrm 객체를 다룬다(헤드리스 테스트 가능).
// 실제 대상은 @pixiv/three-vrm 3.5.3 의 VRMSpringBoneManager / VRMSpringBoneJoint 다.
//
// ── StudioVrmPoser 통합 사양(이 파일은 소유권 밖 파일을 수정하지 않으므로 사양만 남긴다) ──────
//
// 1) 모델 로드 직후 (StudioVrmPoser 의 onLoad 경로, 기존 countSpringBoneJoints 호출 지점 근처):
//      const bindings = bindStudioVrmSpringBoneJoints(vrm, authoring);
//      setSpringBindingCount(bindings.length);
//    bindings 는 vrm 이 바뀔 때까지 ref 로 들고 있는다(본 이름 매칭은 1회면 충분).
//
// 2) 오써링 슬라이더 변경 / 포즈 변경 / 캡처 직전 (기존 settleVrmPhysics(current) 호출 지점):
//      settleStudioVrmSpringBoneRuntime(vrm, authoring, bindings);
//    이 함수는 내부에서 springBoneManager.reset() → 고정 dt 로 vrm.update() 를 반복 →
//    본 쿼터니언 변화량이 epsilon 이하가 되면 멈춘다. 벽시계를 읽지 않으므로 같은 입력이면
//    같은 프레임에서 멈춘다 = 캡처가 재현된다.
//
// 3) 캡처 파이프라인(기존 rgba 리드백 직전 `currentVrm.update(0)` 자리):
//      update(0) 은 three-vrm 이 delta<=0 을 무시하므로 "상태 고정"이 맞다. 그 앞에서 반드시
//      2) 의 settle 이 한 번 끝나 있어야 한다. 미리보기 루프(physicsPreview)가 켜져 있으면
//      캡처 직전에 루프를 멈추고 settle 을 다시 돌려야 프레임 타이밍 의존이 사라진다.
//
// 4) 흔들림 미리보기 루프(useFrame)는 "연출용"이며 캡처 경로가 아니다. 미리보기에서만
//      applyStudioVrmSpringBoneBindings(bindings, authoring, previewStepIndex++) 로 돌풍 위상을
//      전진시키고, 캡처 경로는 항상 stepIndex 0..N 을 처음부터 다시 밟는다.
//
// 5) 문서 저장: serializeStudioVrmSpringBoneAuthoring(authoring) 결과 문자열을 그대로 넣고,
//    로드 시 parseStudioVrmSpringBoneAuthoring 으로 복구한다(손상 입력도 기본값으로 흡수).

import {
  studioVrmSpringBoneWind,
  type StudioVrmSpringBoneAuthoring,
  type StudioVrmSpringBoneChainSettings,
} from "./studio-vrm-springbone-authoring";
import {
  studioVrmSpringBoneWindAt,
  type SpringVec3,
} from "./studio-vrm-springbone-core";

export type { SpringVec3 };

/* ── three-vrm 구조적 서브셋 ────────────────────────────────────────── */

export interface SpringBoneVectorLike {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
}

export interface SpringBoneQuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SpringBoneJointSettingsLike {
  hitRadius: number;
  stiffness: number;
  gravityPower: number;
  gravityDir: SpringBoneVectorLike;
  dragForce: number;
}

export interface SpringBoneObjectLike {
  name: string;
  quaternion: SpringBoneQuaternionLike;
  parent?: { name: string } | null;
}

export interface SpringBoneJointLike {
  settings: SpringBoneJointSettingsLike;
  bone: SpringBoneObjectLike;
}

export interface SpringBoneManagerLike {
  joints: Iterable<SpringBoneJointLike>;
  reset(): void;
}

export interface SpringBoneVrmLike {
  update(delta: number): void;
  springBoneManager?: SpringBoneManagerLike | null;
}

/* ── 본 이름 → 체인 매칭 ────────────────────────────────────────────── */

/** 본 이름(및 부모 이름)에 체인 키워드가 들어 있으면 그 체인으로 묶는다. */
export function matchStudioVrmSpringBoneChain(
  boneName: string,
  parentName: string | null,
  chains: readonly StudioVrmSpringBoneChainSettings[]
): StudioVrmSpringBoneChainSettings | null {
  const haystack = `${boneName} ${parentName ?? ""}`.toLowerCase();
  for (const chain of chains) {
    if (!chain.enabled) continue;
    if (chain.bonePatterns.some((pattern) => pattern.length > 0 && haystack.includes(pattern))) {
      return chain;
    }
  }
  return null;
}

export interface SpringBoneBinding {
  joint: SpringBoneJointLike;
  chainId: string;
  chainIndex: number;
  jointIndex: number;
}

/**
 * VRM 의 모든 스프링본 조인트를 오써링 체인에 배정한다.
 * 매칭되지 않은 조인트는 결과에 포함되지 않으며 원래 설정이 유지된다.
 */
export function bindStudioVrmSpringBoneJoints(
  vrm: SpringBoneVrmLike,
  authoring: StudioVrmSpringBoneAuthoring
): SpringBoneBinding[] {
  const manager = vrm.springBoneManager;
  if (!manager) return [];
  const chainIndexById = new Map(authoring.chains.map((chain, index) => [chain.id, index]));
  const perChainCounter = new Map<string, number>();
  const bindings: SpringBoneBinding[] = [];
  for (const joint of manager.joints) {
    const chain = matchStudioVrmSpringBoneChain(
      joint.bone.name ?? "",
      joint.bone.parent?.name ?? null,
      authoring.chains
    );
    if (!chain) continue;
    const jointIndex = perChainCounter.get(chain.id) ?? 0;
    perChainCounter.set(chain.id, jointIndex + 1);
    bindings.push({
      joint,
      chainId: chain.id,
      chainIndex: chainIndexById.get(chain.id) ?? 0,
      jointIndex,
    });
  }
  return bindings;
}

/* ── 설정 적용(중력 + 바람 합성) ────────────────────────────────────── */

/**
 * 체인 설정과 바람을 three-vrm 조인트 설정으로 합성한다.
 * three-vrm 에는 바람 입력이 없으므로 "중력 벡터에 바람 벡터를 더한 뒤 방향/세기로 분해"한다
 * (기존 studio-vrm-physics.composeSpringGravity 와 같은 전략, 단 스텝 결정성 노이즈가 붙는다).
 */
export function composeStudioVrmSpringBoneGravity(
  chain: StudioVrmSpringBoneChainSettings,
  authoring: StudioVrmSpringBoneAuthoring,
  stepIndex: number,
  chainIndex: number,
  jointIndex: number
): { dir: [number, number, number]; power: number } {
  const gravity = chain.gravityDir;
  const gx = gravity[0] * chain.gravityPower;
  const gy = gravity[1] * chain.gravityPower;
  const gz = gravity[2] * chain.gravityPower;

  const wind: SpringVec3 = authoring.enabled
    ? studioVrmSpringBoneWindAt(
        studioVrmSpringBoneWind(authoring.wind, chain.windScale),
        stepIndex,
        chainIndex,
        jointIndex
      )
    : { x: 0, y: 0, z: 0 };

  const x = gx + wind.x;
  const y = gy + wind.y;
  const z = gz + wind.z;
  const power = Math.hypot(x, y, z);
  if (!(power > 1e-9)) return { dir: [0, -1, 0], power: 0 };
  return { dir: [x / power, y / power, z / power], power };
}

/**
 * 바인딩된 조인트에 오써링 값을 기록한다(멱등 — 항상 오써링 원본에서 재계산).
 * @returns 적용된 조인트 수
 */
export function applyStudioVrmSpringBoneBindings(
  bindings: readonly SpringBoneBinding[],
  authoring: StudioVrmSpringBoneAuthoring,
  stepIndex = 0
): number {
  const byId = new Map(authoring.chains.map((chain) => [chain.id, chain]));
  let applied = 0;
  for (const binding of bindings) {
    const chain = byId.get(binding.chainId);
    if (!chain || !chain.enabled) continue;
    const settings = binding.joint.settings;
    settings.stiffness = chain.stiffness;
    settings.dragForce = chain.drag;
    settings.hitRadius = chain.hitRadius;
    const gravity = composeStudioVrmSpringBoneGravity(
      chain,
      authoring,
      stepIndex,
      binding.chainIndex,
      binding.jointIndex
    );
    settings.gravityPower = gravity.power;
    settings.gravityDir.set(gravity.dir[0], gravity.dir[1], gravity.dir[2]);
    applied += 1;
  }
  return applied;
}

/* ── 런타임 정착 ────────────────────────────────────────────────────── */

function measureJointRotations(joints: readonly SpringBoneJointLike[]): number[] {
  const out: number[] = [];
  for (const joint of joints) {
    const q = joint.bone.quaternion;
    out.push(q.x, q.y, q.z, q.w);
  }
  return out;
}

/** 바인딩된 조인트의 본 회전을 평평한 배열로 뜬다(수렴 판정용 관측). */
export function measureStudioVrmSpringBoneRotations(bindings: readonly SpringBoneBinding[]): number[] {
  return measureJointRotations(bindings.map((binding) => binding.joint));
}

function maxQuatDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!, a[i + 3]! - b[i + 3]!);
    if (d > max) max = d;
  }
  return max;
}

export interface SpringBoneRuntimeSettleReport {
  steps: number;
  maxDelta: number;
  settled: boolean;
  applied: number;
}

/**
 * 캡처 직전 정착 루틴 — 벽시계를 읽지 않는다.
 *  1. springBoneManager.reset() 으로 조인트 상태를 rest 로 되감고,
 *  2. 고정 dt 로 vrm.update() 를 반복하며 (돌풍이 있으면 스텝마다 설정을 재적용),
 *  3. 본 회전 변화량이 epsilon 이하가 되면 멈춘다(최대 maxSteps).
 */
export function settleStudioVrmSpringBoneRuntime(
  vrm: SpringBoneVrmLike,
  authoring: StudioVrmSpringBoneAuthoring,
  bindings: readonly SpringBoneBinding[]
): SpringBoneRuntimeSettleReport {
  const { dt, epsilon, maxSteps } = authoring.settle;
  const animatedWind = authoring.enabled && authoring.wind.strength > 0 && authoring.wind.turbulence > 0 && authoring.wind.phaseStep > 0;

  const applied = applyStudioVrmSpringBoneBindings(bindings, authoring, 0);

  // 수렴 관측 대상은 "모델의 모든 스프링본 조인트"다. 오써링 체인에 매칭되지 않은 조인트도
  // 원래 설정으로 계속 흔들리므로 캡처 안정성 판단에 포함돼야 한다.
  const observed: SpringBoneJointLike[] = vrm.springBoneManager
    ? Array.from(vrm.springBoneManager.joints)
    : bindings.map((binding) => binding.joint);
  if (observed.length === 0) {
    // 흔들림 뼈가 없는 모델 — 정착시킬 것이 없다.
    return { steps: 0, maxDelta: 0, settled: true, applied };
  }

  vrm.springBoneManager?.reset();

  let previous = measureJointRotations(observed);
  let steps = 0;
  let maxDelta = Number.POSITIVE_INFINITY;
  const cap = Math.max(1, Math.floor(maxSteps));
  while (steps < cap) {
    if (animatedWind && steps > 0) applyStudioVrmSpringBoneBindings(bindings, authoring, steps);
    vrm.update(dt);
    steps += 1;
    const current = measureJointRotations(observed);
    maxDelta = maxQuatDelta(previous, current);
    previous = current;
    if (maxDelta <= epsilon) break;
  }
  return { steps, maxDelta, settled: maxDelta <= epsilon, applied };
}
