
// MediaPipe Pose worldLandmarks → VRM 휴머노이드 본 로컬 회전(Euler) 솔버.
//
// 기존 구현의 핵심 결함을 바로잡는다:
//  - (구) 하완/하퇴를 "월드 방향"으로 계산해 부모(상완/대퇴)의 회전을 무시한 채 로컬로 적용 →
//    계층 이중회전으로 팔꿈치/무릎이 부자연스럽게 꺾였다.
//  - (신) 자식 본은 부모의 월드 회전을 제거한 **부모상대(parent-relative)** 회전으로 계산한다:
//        qChildLocal = qParentWorld⁻¹ · qChildWorld
//    이렇게 하면 팔이 곧게 펴졌을 때 하완 로컬 회전이 0(굽힘 없음)이 되어 자연스럽다.
//  - 단일 카메라의 깊이(z) 추정은 노이즈가 커 앞뒤로 출렁이므로 z 축을 감쇠한다.
//  - 가시성(visibility)이 낮은 관절은 해당 본을 생략해 호출부가 휴식 포즈로 페이드하게 한다.
//
// 순수 함수라 three 외 의존 없이 단위 테스트가 가능하다.

import * as THREE from "three";

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseSolveOptions {
  /** 좌우 미러(셀카 모드). 기본 true. */
  mirror?: boolean;
  /** 단일 카메라 깊이(z) 감쇠 계수(0~1). 작을수록 앞뒤 출렁임을 억제. 기본 0.85(충실도 우선). */
  zDamp?: number;
  /** 이 미만 가시성의 관절이 포함된 본은 생략. 기본 0.2(팔이 쉽게 제외되지 않게 낮춤). */
  minVisibility?: number;
}

export type BoneEulerMap = Record<string, readonly [number, number, number]>;

/** MediaPipe Pose 랜드마크 인덱스(필요한 것만). */
export const POSE_LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
} as const;

// VRM T-포즈 기준 본 방향(정규화 본은 rest 가 항등이라 월드축과 정렬).
const REST_ARM_LEFT = new THREE.Vector3(1, 0, 0); // 좌완은 +X 바깥
const REST_ARM_RIGHT = new THREE.Vector3(-1, 0, 0);
const REST_LEG = new THREE.Vector3(0, -1, 0); // 다리는 아래(-Y)
const REST_FOOT = new THREE.Vector3(0, 0, 1); // 발끝 앞
const TORSO_UP = new THREE.Vector3(0, 1, 0); // 곧게 선 척추 방향(+Y)
// 토르소 기울임 감쇠(0~1) — 단일 카메라 노이즈/과장 억제.
const TORSO_LEAN = 0.55;

const EULER_ORDER = "XYZ" as const;

/**
 * MediaPipe(Y-down, Z-전방) → three/VRM(Y-up, Z-후방) 좌표 변환.
 * 미러 시 x 부호를 뒤집고, z(깊이)는 노이즈 억제를 위해 감쇠한다.
 */
function toVrmVec(lm: PoseLandmark, mirrorSign: number, zDamp: number): THREE.Vector3 {
  return new THREE.Vector3(lm.x * mirrorSign, -lm.y, -lm.z * zDamp);
}

function dir(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 | null {
  const d = to.clone().sub(from);
  if (d.lengthSq() < 1e-8) return null;
  return d.normalize();
}

function quatToEuler(q: THREE.Quaternion): readonly [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(q, EULER_ORDER);
  return [e.x, e.y, e.z] as const;
}

/**
 * 2-본 체인(상완→하완, 대퇴→하퇴)을 풀어 부모/자식 로컬 회전을 만든다.
 *  - 부모(상완): 부모프레임(parentWorld, 기본 항등=토르소)에서의 로컬 회전.
 *    토르소를 추적해 척추/가슴을 기울이면 팔도 그 프레임 상대로 계산해야 이중회전이 안 생긴다.
 *  - 자식(하완)은 부모상대: qParentWorld⁻¹ · qChildWorld → 팔꿈치 굽힘만 남는다.
 */
function solveTwoBone(
  root: THREE.Vector3,
  mid: THREE.Vector3,
  tip: THREE.Vector3,
  rest: THREE.Vector3,
  parentWorld?: THREE.Quaternion
): { parent: THREE.Quaternion; child: THREE.Quaternion } | null {
  const upperDir = dir(root, mid);
  const lowerDir = dir(mid, tip);
  if (!upperDir || !lowerDir) return null;
  const qParentWorld = new THREE.Quaternion().setFromUnitVectors(rest, upperDir);
  const qChildWorld = new THREE.Quaternion().setFromUnitVectors(rest, lowerDir);
  const qChildLocal = qParentWorld.clone().invert().multiply(qChildWorld);
  // 부모(상완)를 토르소 프레임 상대로: parentWorld⁻¹ · qParentWorld.
  const parentLocal = parentWorld
    ? parentWorld.clone().invert().multiply(qParentWorld)
    : qParentWorld;
  return { parent: parentLocal, child: qChildLocal };
}

/** 단일 본(발 등) 월드 방향 회전. */
function solveOneBone(
  from: THREE.Vector3,
  to: THREE.Vector3,
  parentWorld: THREE.Quaternion,
  rest: THREE.Vector3
): THREE.Quaternion | null {
  const d = dir(from, to);
  if (!d) return null;
  const world = new THREE.Quaternion().setFromUnitVectors(rest, d);
  return parentWorld.clone().invert().multiply(world);
}

/**
 * worldLandmarks → VRM 본 로컬 Euler 맵.
 * 가시성이 충분한 체인만 채운다(미검출 본은 키 자체가 없음 → 호출부가 휴식 포즈 유지/페이드).
 */
export function solvePoseToVrmBones(
  worldLandmarks: readonly PoseLandmark[] | undefined,
  options: PoseSolveOptions = {}
): BoneEulerMap {
  const out: Record<string, readonly [number, number, number]> = {};
  if (!worldLandmarks || worldLandmarks.length < 33) return out;

  const { mirror = true, zDamp = 0.85, minVisibility = 0.2 } = options;
  // 항상 비미러(해부학적) 프레임으로 계산한다. 미러는 마지막에 "회전 거울 반사"로 적용한다 —
  // 입력 위치 x 를 뒤집어 재계산하면 회전의 손잡이성이 깨져 상하(y)가 뒤집히는 버그가 생긴다.
  const sideName = (side: "left" | "right") => side;

  const vec = (i: number) => toVrmVec(worldLandmarks[i], 1, zDamp);
  const visOk = (...idx: number[]) =>
    idx.every((i) => (worldLandmarks[i]?.visibility ?? 1) >= minVisibility);

  // ── 토르소(척추/가슴) 기울임 ──────────────────────────────────
  // 어깨중심→골반중심 방향으로 상체를 기울인다. 팔은 이 토르소 프레임 상대로 계산한다.
  let torsoWorld: THREE.Quaternion | undefined;
  if (visOk(POSE_LM.leftShoulder, POSE_LM.rightShoulder, POSE_LM.leftHip, POSE_LM.rightHip)) {
    const shoulderC = vec(POSE_LM.leftShoulder).add(vec(POSE_LM.rightShoulder)).multiplyScalar(0.5);
    const hipC = vec(POSE_LM.leftHip).add(vec(POSE_LM.rightHip)).multiplyScalar(0.5);
    const spineDir = shoulderC.sub(hipC);
    if (spineDir.lengthSq() > 1e-6) {
      spineDir.normalize();
      // 감쇠: 항등 → 전체 기울임 사이 슬러프.
      torsoWorld = new THREE.Quaternion().slerp(
        new THREE.Quaternion().setFromUnitVectors(TORSO_UP, spineDir),
        TORSO_LEAN
      );
      const e = new THREE.Euler().setFromQuaternion(torsoWorld, EULER_ORDER);
      out.spine = [e.x * 0.6, e.y * 0.6, e.z * 0.6];
      out.chest = [e.x * 0.4, e.y * 0.4, e.z * 0.4];
    }
  }

  // ── 팔(상완/하완) — 토르소 프레임 상대 ────────────────────────
  const arm = (
    side: "left" | "right",
    sIdx: number,
    eIdx: number,
    wIdx: number,
    rest: THREE.Vector3
  ) => {
    if (!visOk(sIdx, eIdx, wIdx)) return;
    const r = solveTwoBone(vec(sIdx), vec(eIdx), vec(wIdx), rest, torsoWorld);
    if (!r) return;
    out[`${sideName(side)}UpperArm`] = quatToEuler(r.parent);
    out[`${sideName(side)}LowerArm`] = quatToEuler(r.child);
  };
  arm("left", POSE_LM.leftShoulder, POSE_LM.leftElbow, POSE_LM.leftWrist, REST_ARM_LEFT);
  arm("right", POSE_LM.rightShoulder, POSE_LM.rightElbow, POSE_LM.rightWrist, REST_ARM_RIGHT);

  // ── 다리(대퇴/하퇴/발) ────────────────────────────────────────
  const leg = (
    side: "left" | "right",
    hIdx: number,
    kIdx: number,
    aIdx: number,
    heelIdx: number
  ) => {
    if (!visOk(hIdx, kIdx, aIdx)) return;
    const r = solveTwoBone(vec(hIdx), vec(kIdx), vec(aIdx), REST_LEG);
    if (!r) return;
    out[`${sideName(side)}UpperLeg`] = quatToEuler(r.parent);
    out[`${sideName(side)}LowerLeg`] = quatToEuler(r.child);
    // 발: 부모(하퇴)의 월드 회전을 제거한 부모상대 회전.
    if (visOk(heelIdx)) {
      const shinDir = dir(vec(kIdx), vec(aIdx));
      if (shinDir) {
        const qShinWorld = new THREE.Quaternion().setFromUnitVectors(REST_LEG, shinDir);
        const foot = solveOneBone(vec(aIdx), vec(heelIdx), qShinWorld, REST_FOOT);
        if (foot) out[`${sideName(side)}Foot`] = quatToEuler(foot);
      }
    }
  };
  leg("left", POSE_LM.leftHip, POSE_LM.leftKnee, POSE_LM.leftAnkle, POSE_LM.leftHeel);
  leg("right", POSE_LM.rightHip, POSE_LM.rightKnee, POSE_LM.rightAnkle, POSE_LM.rightHeel);

  if (!mirror) return out;
  // 거울 모드: 회전(Euler) 본을 YZ평면으로 반사 = 좌우 본 스왑 + y·z 부호 반전.
  // (수동 포즈 "반전"의 mirrorBone 과 동일한 규약 — 위치 x 반전과 달리 손잡이성을 보존.)
  const mirrored: Record<string, readonly [number, number, number]> = {};
  for (const [name, e] of Object.entries(out)) {
    const swapped = name.startsWith("left")
      ? `right${name.slice(4)}`
      : name.startsWith("right")
        ? `left${name.slice(5)}`
        : name;
    mirrored[swapped] = [e[0], -e[1], -e[2]];
  }
  return mirrored;
}
