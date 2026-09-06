// VRM 스프링본(흔들림 뼈) — 순수 데이터 기반 결정성 시뮬레이션 코어.
//
// 왜 자체 구현인가:
//  - three-vrm 의 VRMSpringBoneJoint.update(delta) 는 THREE.Object3D 씬 그래프(matrixWorld·부모 행렬·
//    center 노드)에 강하게 결합돼 있어 헤드리스 단위 테스트가 불가능하고, 조인트 내부 상태
//    (_currentTail/_prevTail/_boneAxis)가 전부 private 라 "정착 여부"를 관측할 수단이 없다.
//  - 스튜디오는 3D 뷰포트를 PNG 로 캡처해 웹툰 컷을 만든다. 즉 같은 (포즈 + 설정 + 스텝 수)면 항상
//    같은 픽셀이 나와야 한다. 벽시계 기반 흔들림은 캡처마다 결과가 달라져 쓸 수 없다.
//  - 그래서 적분식은 three-vrm 3.5.3 의 verlet 구현과 동일하게 맞추되(호환성), 시계·난수·씬 그래프
//    의존을 전부 제거하고 "명시적 dt + 명시적 스텝 인덱스"만 받는 순수 함수로 재구성한다.
//
// three-vrm 원본 적분식(lib/three-vrm-springbone.module.js VRMSpringBoneJoint.update):
//   nextTail = currentTail
//            + (currentTail - prevTail) * (1 - dragForce)      // 관성
//            + worldRestDir * stiffness * delta                // rest 로 당기는 힘
//            + gravityDir * gravityPower * delta               // 중력
//   nextTail = head + normalize(nextTail - head) * boneLength  // 길이 구속
//   collision(nextTail)                                        // 콜라이더 밀어내기 + 길이 재구속
// 본 모듈은 여기에 "명시적 바람 항"과 "수렴 판정"을 더한다.

/* ── 벡터/쿼터니언(월드 공간, 평범한 숫자만) ────────────────────────── */

export interface SpringVec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpringQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type SpringVec3Tuple = readonly [number, number, number];

/** 0 나눗셈 방지 임계값 — 이보다 짧은 벡터는 방향이 정의되지 않은 것으로 본다. */
export const SPRING_ZERO_EPSILON = 1e-12;

export const SPRING_QUAT_IDENTITY: SpringQuat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function springVec3(x: number, y: number, z: number): SpringVec3 {
  return { x, y, z };
}

export function springVec3FromTuple(t: SpringVec3Tuple): SpringVec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

export function springVec3ToTuple(v: SpringVec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export function springAdd(a: SpringVec3, b: SpringVec3): SpringVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function springSub(a: SpringVec3, b: SpringVec3): SpringVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function springScale(a: SpringVec3, s: number): SpringVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function springAddScaled(a: SpringVec3, b: SpringVec3, s: number): SpringVec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function springDot(a: SpringVec3, b: SpringVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function springCross(a: SpringVec3, b: SpringVec3): SpringVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function springLength(a: SpringVec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function springDistance(a: SpringVec3, b: SpringVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 길이 0 벡터는 fallback 방향을 그대로 돌려준다(NaN 전파 차단). */
export function springNormalize(a: SpringVec3, fallback: SpringVec3 = { x: 0, y: -1, z: 0 }): SpringVec3 {
  const len = springLength(a);
  if (!(len > SPRING_ZERO_EPSILON)) return { ...fallback };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** three.js Quaternion.multiplyQuaternions 와 동일한 순서(a * b). */
export function springQuatMultiply(a: SpringQuat, b: SpringQuat): SpringQuat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** three.js Vector3.applyQuaternion 과 동일한 전개식. */
export function springQuatRotate(q: SpringQuat, v: SpringVec3): SpringVec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/** three.js Quaternion.setFromUnitVectors 와 동일(180° 뒤집힘 특이점 처리 포함). */
export function springQuatFromUnitVectors(from: SpringVec3, to: SpringVec3): SpringQuat {
  const f = springNormalize(from, { x: 0, y: 1, z: 0 });
  const t = springNormalize(to, { x: 0, y: 1, z: 0 });
  let r = springDot(f, t) + 1;
  let x: number;
  let y: number;
  let z: number;
  if (r < SPRING_ZERO_EPSILON) {
    r = 0;
    if (Math.abs(f.x) > Math.abs(f.z)) {
      x = -f.y;
      y = f.x;
      z = 0;
    } else {
      x = 0;
      y = -f.z;
      z = f.y;
    }
  } else {
    const c = springCross(f, t);
    x = c.x;
    y = c.y;
    z = c.z;
  }
  const len = Math.hypot(x, y, z, r);
  if (!(len > SPRING_ZERO_EPSILON)) return { ...SPRING_QUAT_IDENTITY };
  return { x: x / len, y: y / len, z: z / len, w: r / len };
}

/* ── 조인트 / 체인 / 콜라이더 정의 ──────────────────────────────────── */

export interface SpringJointSettings {
  /** rest 방향으로 당기는 힘(초당). three-vrm settings.stiffness 와 동일 스케일. */
  stiffness: number;
  /** 관성 감쇠 0~1. three-vrm settings.dragForce 와 동일(속도에 (1 - drag) 를 곱한다). */
  drag: number;
  /** 중력 세기(초당). */
  gravityPower: number;
  /** 중력 방향(단위 벡터). */
  gravityDir: SpringVec3;
  /** 충돌 판정용 조인트 반지름. */
  hitRadius: number;
}

export interface SpringJointDef {
  name: string;
  /** 정지 상태에서의 head→tail 단위 방향(루트 회전 미적용 기준). */
  restDir: SpringVec3;
  /** 본 길이(월드 단위). 매 스텝 이 길이가 보존된다. */
  length: number;
  settings: SpringJointSettings;
}

export interface SpringChainDef {
  id: string;
  /** 체인 첫 조인트의 head 월드 위치(포즈에서 측정). */
  origin: SpringVec3;
  /** 체인 루트 본의 월드 회전(포즈 변화가 여기로 들어온다). */
  rootRotation: SpringQuat;
  joints: SpringJointDef[];
}

export type SpringCollider =
  | {
      kind: "sphere";
      /** 월드 공간 중심. */
      center: SpringVec3;
      radius: number;
      /** true 면 "안쪽에 가둔다"(three-vrm shape.inside 와 동일 의미). */
      inside: boolean;
    }
  | {
      kind: "capsule";
      head: SpringVec3;
      tail: SpringVec3;
      radius: number;
      inside: boolean;
    };

/**
 * 바람 입력 — 시계가 아니라 "스텝 인덱스 + 시드 + 위상"만으로 결정된다.
 * phaseStep = 0 이면 정상풍(모든 스텝에서 동일)이라 정착(수렴)이 가능하고,
 * phaseStep > 0 이면 돌풍이 스텝마다 변하므로 정지점은 없지만 여전히 완전 결정적이다.
 */
export interface SpringWind {
  /** 단위 방향. */
  dir: SpringVec3;
  strength: number;
  /** 돌풍 진폭 0~1. 0 이면 노이즈 없음. */
  turbulence: number;
  /** 정수 시드. */
  seed: number;
  /** 노이즈 시작 위상. */
  phase: number;
  /** 스텝당 위상 증가량. 캡처 결정성을 원하면 0 으로 둔다. */
  phaseStep: number;
}

export const SPRING_WIND_NONE: SpringWind = Object.freeze({
  dir: Object.freeze({ x: 1, y: 0, z: 0 }) as SpringVec3,
  strength: 0,
  turbulence: 0,
  seed: 1,
  phase: 0,
  phaseStep: 0,
});

/* ── 시뮬레이션 상태 ────────────────────────────────────────────────── */

export interface SpringJointState {
  currentTail: SpringVec3;
  prevTail: SpringVec3;
}

export interface SpringChainState {
  def: SpringChainDef;
  joints: SpringJointState[];
}

export interface StudioVrmSpringBoneState {
  chains: SpringChainState[];
  colliders: SpringCollider[];
  wind: SpringWind;
  /** 다음 스텝에 사용될 인덱스. reset 시 0. */
  stepIndex: number;
  /** 콜라이더 밀어내기 ↔ 길이 재구속 교대 투영 반복 횟수. */
  collisionIterations: number;
  /** 직전 스텝의 최대 tail 이동량. 아직 한 스텝도 돌지 않았으면 +Infinity(= 정착 여부 미지). */
  lastMaxDelta: number;
}

export interface CreateSpringBoneStateInput {
  chains: readonly SpringChainDef[];
  colliders?: readonly SpringCollider[];
  wind?: SpringWind;
  collisionIterations?: number;
}

/** 교대 투영 기본 반복 횟수 — 4회면 일반적인 머리카락/치마 배치에서 관통이 1e-4 이하로 떨어진다. */
export const SPRING_DEFAULT_COLLISION_ITERATIONS = 4;

function cloneJointDef(def: SpringJointDef): SpringJointDef {
  return {
    name: def.name,
    restDir: springNormalize(def.restDir),
    length: Math.max(0, def.length),
    settings: {
      stiffness: def.settings.stiffness,
      drag: Math.min(1, Math.max(0, def.settings.drag)),
      gravityPower: def.settings.gravityPower,
      gravityDir: springNormalize(def.settings.gravityDir),
      hitRadius: Math.max(0, def.settings.hitRadius),
    },
  };
}

function cloneChainDef(def: SpringChainDef): SpringChainDef {
  return {
    id: def.id,
    origin: { ...def.origin },
    rootRotation: { ...def.rootRotation },
    joints: def.joints.map(cloneJointDef),
  };
}

/** rest 자세(모든 조인트가 restDir 방향)의 tail 위치들을 계산한다. */
export function computeSpringChainRestTails(def: SpringChainDef): SpringVec3[] {
  const tails: SpringVec3[] = [];
  let head = { ...def.origin };
  let accum = { ...def.rootRotation };
  for (const joint of def.joints) {
    const dir = springNormalize(springQuatRotate(accum, joint.restDir));
    const tail = springAddScaled(head, dir, joint.length);
    tails.push(tail);
    head = tail;
    // rest 자세에서는 delta 회전이 항등이므로 accum 은 그대로 전파된다.
    accum = { ...accum };
  }
  return tails;
}

export function createStudioVrmSpringBoneState(input: CreateSpringBoneStateInput): StudioVrmSpringBoneState {
  const chains = input.chains.map((raw) => {
    const def = cloneChainDef(raw);
    const restTails = computeSpringChainRestTails(def);
    return {
      def,
      joints: restTails.map((tail) => ({ currentTail: { ...tail }, prevTail: { ...tail } })),
    } satisfies SpringChainState;
  });
  return {
    chains,
    colliders: (input.colliders ?? []).map((c) => ({ ...c })),
    wind: { ...(input.wind ?? SPRING_WIND_NONE), dir: springNormalize((input.wind ?? SPRING_WIND_NONE).dir, { x: 1, y: 0, z: 0 }) },
    stepIndex: 0,
    collisionIterations: Math.max(1, Math.floor(input.collisionIterations ?? SPRING_DEFAULT_COLLISION_ITERATIONS)),
    lastMaxDelta: Number.POSITIVE_INFINITY,
  };
}

/** 모든 tail 을 rest 자세로 되돌리고 스텝 인덱스를 0 으로 되감는다. */
export function resetStudioVrmSpringBoneState(state: StudioVrmSpringBoneState): void {
  for (const chain of state.chains) {
    const restTails = computeSpringChainRestTails(chain.def);
    for (let i = 0; i < chain.joints.length; i += 1) {
      const tail = restTails[i]!;
      chain.joints[i]!.currentTail = { ...tail };
      chain.joints[i]!.prevTail = { ...tail };
    }
  }
  state.stepIndex = 0;
  state.lastMaxDelta = Number.POSITIVE_INFINITY;
}

/**
 * 특정 조인트의 tail 을 임의 위치로 옮긴다(속도 0). 길이는 자동 구속된다.
 * 포즈 점프 직후 "이 방향에서부터 정착시키고 싶다" 같은 오써링에 쓴다.
 */
export function displaceStudioVrmSpringBoneTail(
  state: StudioVrmSpringBoneState,
  chainIndex: number,
  jointIndex: number,
  tail: SpringVec3
): boolean {
  const chain = state.chains[chainIndex];
  const jointState = chain?.joints[jointIndex];
  const jointDef = chain?.def.joints[jointIndex];
  if (!chain || !jointState || !jointDef) return false;
  const head = jointIndex === 0 ? chain.def.origin : chain.joints[jointIndex - 1]!.currentTail;
  const constrained = constrainSpringTailLength(head, jointDef.length, tail, jointDef.restDir);
  jointState.currentTail = constrained;
  jointState.prevTail = { ...constrained };
  state.lastMaxDelta = Number.POSITIVE_INFINITY;
  return true;
}

/* ── 결정성 노이즈(바람) ────────────────────────────────────────────── */

/** 32bit 정수 해시 → [0, 1). 부동소수 누적이 없으므로 플랫폼 간 비트 동일. */
export function springHash01(seed: number, index: number): number {
  let h = (Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 격자 해시 + smoothstep 보간 value noise → [0, 1). */
export function springValueNoise(seed: number, t: number): number {
  const safeT = Number.isFinite(t) ? t : 0;
  const i = Math.floor(safeT);
  const f = safeT - i;
  const s = f * f * (3 - 2 * f);
  const a = springHash01(seed, i);
  const b = springHash01(seed, i + 1);
  return a + (b - a) * s;
}

/** 스텝/체인/조인트 인덱스로만 결정되는 바람 벡터(가속도). */
export function studioVrmSpringBoneWindAt(
  wind: SpringWind,
  stepIndex: number,
  chainIndex: number,
  jointIndex: number
): SpringVec3 {
  if (!(wind.strength > 0)) return { x: 0, y: 0, z: 0 };
  const turbulence = Math.min(1, Math.max(0, wind.turbulence));
  if (turbulence === 0) return springScale(wind.dir, wind.strength);
  // 체인/조인트마다 위상을 어긋나게 해서 뭉텅이로 같이 흔들리지 않게 한다.
  const t = wind.phase + stepIndex * wind.phaseStep + chainIndex * 0.61 + jointIndex * 0.37;
  const gust = 1 + turbulence * (springValueNoise(wind.seed, t) * 2 - 1);
  return springScale(wind.dir, wind.strength * gust);
}

/* ── 충돌 ───────────────────────────────────────────────────────────── */

export interface SpringColliderHit {
  /** 음수면 관통. three-vrm calculateCollision 반환값과 같은 부호 규약. */
  distance: number;
  /** 밀어낼 단위 방향. */
  normal: SpringVec3;
}

/** three-vrm VRMSpringBoneColliderShape*.calculateCollision 과 동일한 판정. */
export function evaluateSpringCollider(
  collider: SpringCollider,
  tail: SpringVec3,
  hitRadius: number
): SpringColliderHit {
  let offset: SpringVec3;
  if (collider.kind === "sphere") {
    offset = springSub(tail, collider.center);
  } else {
    const ab = springSub(collider.tail, collider.head);
    const ap = springSub(tail, collider.head);
    const lengthSq = springDot(ab, ab);
    const dot = springDot(ab, ap);
    if (dot <= 0) {
      offset = ap;
    } else if (lengthSq <= dot) {
      offset = springSub(ap, ab);
    } else {
      offset = springSub(ap, springScale(ab, dot / lengthSq));
    }
  }
  const len = springLength(offset);
  const distance = collider.inside
    ? collider.radius - hitRadius - len
    : len - hitRadius - collider.radius;
  // 완전히 겹친 특이점: 임의의 안정적인 축으로 밀어낸다.
  const dir = len > SPRING_ZERO_EPSILON ? springScale(offset, 1 / len) : { x: 0, y: 1, z: 0 };
  return { distance, normal: collider.inside ? springScale(dir, -1) : dir };
}

/** head 로부터 정확히 length 만큼 떨어지도록 tail 을 재투영한다. */
export function constrainSpringTailLength(
  head: SpringVec3,
  length: number,
  tail: SpringVec3,
  fallbackDir: SpringVec3
): SpringVec3 {
  const dir = springNormalize(springSub(tail, head), fallbackDir);
  return springAddScaled(head, dir, length);
}

/**
 * 콜라이더 밀어내기와 길이 구속을 교대로 투영해 "길이는 정확히 보존하면서 콜라이더 밖"인 점을 찾는다.
 * 마지막 연산이 항상 길이 구속이므로 체인은 절대 늘어나지 않는다(관통이 남을 수 있고, 이는 문서화된 한계).
 */
export function resolveSpringTailConstraints(
  head: SpringVec3,
  length: number,
  tail: SpringVec3,
  colliders: readonly SpringCollider[],
  hitRadius: number,
  iterations: number,
  fallbackDir: SpringVec3
): SpringVec3 {
  let result = constrainSpringTailLength(head, length, tail, fallbackDir);
  if (colliders.length === 0) return result;
  const passes = Math.max(1, Math.floor(iterations));
  for (let pass = 0; pass < passes; pass += 1) {
    let penetrated = false;
    for (const collider of colliders) {
      const hit = evaluateSpringCollider(collider, result, hitRadius);
      if (hit.distance < 0) {
        result = springAddScaled(result, hit.normal, -hit.distance);
        penetrated = true;
      }
    }
    result = constrainSpringTailLength(head, length, result, fallbackDir);
    if (!penetrated) break;
  }
  return result;
}

/* ── 스텝 ───────────────────────────────────────────────────────────── */

/**
 * 고정 스텝 1회 전진. dt 와 stepIndex 를 반드시 호출자가 준다(시계 접근 없음).
 * @returns 이 스텝에서 발생한 최대 tail 이동량(수렴 판정용).
 */
export function stepStudioVrmSpringBones(
  state: StudioVrmSpringBoneState,
  dt: number,
  stepIndex: number
): number {
  if (!Number.isFinite(dt) || dt <= 0) {
    // three-vrm 도 delta <= 0 이면 즉시 반환한다. 스텝 인덱스도 전진시키지 않는다.
    return 0;
  }
  let maxDelta = 0;
  for (let chainIndex = 0; chainIndex < state.chains.length; chainIndex += 1) {
    const chain = state.chains[chainIndex]!;
    let head = { ...chain.def.origin };
    let accum = { ...chain.def.rootRotation };
    for (let jointIndex = 0; jointIndex < chain.joints.length; jointIndex += 1) {
      const def = chain.def.joints[jointIndex]!;
      const jointState = chain.joints[jointIndex]!;
      const settings = def.settings;

      const restDirWorld = springNormalize(springQuatRotate(accum, def.restDir));

      // 관성(verlet) + rest 복원력 + 중력 + 바람.
      let next = springAddScaled(
        jointState.currentTail,
        springSub(jointState.currentTail, jointState.prevTail),
        1 - settings.drag
      );
      next = springAddScaled(next, restDirWorld, settings.stiffness * dt);
      next = springAddScaled(next, settings.gravityDir, settings.gravityPower * dt);
      const wind = studioVrmSpringBoneWindAt(state.wind, stepIndex, chainIndex, jointIndex);
      next = springAddScaled(next, wind, dt);

      next = resolveSpringTailConstraints(
        head,
        def.length,
        next,
        state.colliders,
        settings.hitRadius,
        state.collisionIterations,
        restDirWorld
      );

      const delta = springDistance(next, jointState.currentTail);
      if (delta > maxDelta) maxDelta = delta;

      jointState.prevTail = jointState.currentTail;
      jointState.currentTail = next;

      const actualDir = springNormalize(springSub(next, head), restDirWorld);
      accum = springQuatMultiply(springQuatFromUnitVectors(restDirWorld, actualDir), accum);
      head = next;
    }
  }
  state.stepIndex = stepIndex + 1;
  state.lastMaxDelta = maxDelta;
  return maxDelta;
}

/** 정착 시뮬레이션 기본 델타(초) — 60Hz. */
export const SPRING_SETTLE_DT = 1 / 60;
/** 정착 기본 스텝 수(= 시뮬레이션 1초). */
export const SPRING_SETTLE_STEPS = 60;
/** 수렴 판정 기본 임계값(월드 단위 이동량). */
export const SPRING_SETTLE_EPSILON = 1e-5;
/** until-stable 의 하드 상한 — 감쇠가 0에 가까운 설정에서도 무한 루프를 만들지 않는다. */
export const SPRING_SETTLE_MAX_STEPS = 600;

/**
 * 고정 스텝으로 정착시킨다. 같은 (state, dt, steps, seed) 면 항상 같은 결과.
 * @returns 마지막 스텝의 최대 이동량.
 */
export function settleStudioVrmSpringBones(
  state: StudioVrmSpringBoneState,
  steps: number = SPRING_SETTLE_STEPS,
  dt: number = SPRING_SETTLE_DT
): number {
  const safeSteps = Math.max(0, Math.floor(steps));
  let last = state.lastMaxDelta;
  for (let i = 0; i < safeSteps; i += 1) {
    last = stepStudioVrmSpringBones(state, dt, state.stepIndex);
  }
  return last;
}

export interface SpringSettleUntilStableOptions {
  dt?: number;
  epsilon?: number;
  maxSteps?: number;
}

export interface SpringSettleReport {
  /** 실제로 돌린 스텝 수. */
  steps: number;
  /** 마지막 스텝의 최대 이동량. */
  maxDelta: number;
  /** epsilon 이하로 수렴했는지(false 면 maxSteps 상한에 걸린 것). */
  settled: boolean;
}

/** epsilon 이하로 수렴할 때까지, 단 maxSteps 를 넘지 않게 전진시킨다. */
export function settleStudioVrmSpringBonesUntilStable(
  state: StudioVrmSpringBoneState,
  options: SpringSettleUntilStableOptions = {}
): SpringSettleReport {
  const dt = options.dt ?? SPRING_SETTLE_DT;
  const epsilon = options.epsilon ?? SPRING_SETTLE_EPSILON;
  const maxSteps = Math.max(1, Math.floor(options.maxSteps ?? SPRING_SETTLE_MAX_STEPS));
  let steps = 0;
  let maxDelta = Number.POSITIVE_INFINITY;
  while (steps < maxSteps) {
    maxDelta = stepStudioVrmSpringBones(state, dt, state.stepIndex);
    steps += 1;
    if (maxDelta <= epsilon) break;
  }
  return { steps, maxDelta, settled: maxDelta <= epsilon };
}

/** 직전 스텝 기준 정착 여부. 한 번도 스텝하지 않았으면 false(미지). */
export function isStudioVrmSpringBoneSettled(
  state: StudioVrmSpringBoneState,
  epsilon: number = SPRING_SETTLE_EPSILON
): boolean {
  return state.lastMaxDelta <= epsilon;
}

/* ── 관측(스냅샷) ───────────────────────────────────────────────────── */

export interface StudioVrmSpringBoneSnapshot {
  version: 1;
  stepIndex: number;
  chains: { id: string; tails: number[] }[];
}

/** 캡처 결정성 비교용 스냅샷. 키 순서가 고정이라 JSON 직렬화가 바이트 동일해진다. */
export function snapshotStudioVrmSpringBoneState(
  state: StudioVrmSpringBoneState
): StudioVrmSpringBoneSnapshot {
  return {
    version: 1,
    stepIndex: state.stepIndex,
    chains: state.chains.map((chain) => ({
      id: chain.def.id,
      tails: chain.joints.flatMap((joint) => [joint.currentTail.x, joint.currentTail.y, joint.currentTail.z]),
    })),
  };
}

export function serializeStudioVrmSpringBoneSnapshot(snapshot: StudioVrmSpringBoneSnapshot): string {
  return JSON.stringify(snapshot);
}

/** 두 스냅샷의 최대 위치 차이(정착 멱등 검증용). 구조가 다르면 +Infinity. */
export function studioVrmSpringBoneSnapshotDelta(
  a: StudioVrmSpringBoneSnapshot,
  b: StudioVrmSpringBoneSnapshot
): number {
  if (a.chains.length !== b.chains.length) return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 0; i < a.chains.length; i += 1) {
    const ca = a.chains[i]!;
    const cb = b.chains[i]!;
    if (ca.id !== cb.id || ca.tails.length !== cb.tails.length) return Number.POSITIVE_INFINITY;
    for (let j = 0; j < ca.tails.length; j += 3) {
      const d = Math.hypot(
        ca.tails[j]! - cb.tails[j]!,
        ca.tails[j + 1]! - cb.tails[j + 1]!,
        ca.tails[j + 2]! - cb.tails[j + 2]!
      );
      if (d > max) max = d;
    }
  }
  return max;
}

/** 체인의 각 조인트 head 위치(첫 조인트는 origin). 콜라이더 오써링 UI 프리뷰에 쓴다. */
export function studioVrmSpringBoneHeads(chain: SpringChainState): SpringVec3[] {
  const heads: SpringVec3[] = [{ ...chain.def.origin }];
  for (let i = 0; i < chain.joints.length - 1; i += 1) {
    heads.push({ ...chain.joints[i]!.currentTail });
  }
  return heads;
}

/** 조인트별 현재 본 길이(길이 보존 검증/디버깅용). */
export function studioVrmSpringBoneJointLengths(chain: SpringChainState): number[] {
  const heads = studioVrmSpringBoneHeads(chain);
  return chain.joints.map((joint, i) => springDistance(joint.currentTail, heads[i]!));
}
