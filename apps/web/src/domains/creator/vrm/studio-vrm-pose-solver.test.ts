import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  POSE_LM,
  solvePoseToVrmBones,
  type PoseLandmark,
} from "./studio-vrm-pose-solver";

// 33개 랜드마크 배열을 만들고 일부만 지정한다(나머지는 원점, 가시성 1).
function makeLandmarks(set: Record<number, Partial<PoseLandmark>>): PoseLandmark[] {
  const arr: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }));
  for (const [i, v] of Object.entries(set)) {
    arr[Number(i)] = { x: 0, y: 0, z: 0, visibility: 1, ...v };
  }
  return arr;
}

const REST_ARM_LEFT = new THREE.Vector3(1, 0, 0);
const REST_ARM_RIGHT = new THREE.Vector3(-1, 0, 0);

function eulerToQuat(e: readonly [number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], "XYZ"));
}

// 본 Euler 체인으로부터 하완의 월드 방향을 복원한다(부모상대 합성 검증용).
function forearmWorldDir(bones: Record<string, readonly [number, number, number]>): THREE.Vector3 {
  const upper = eulerToQuat(bones.leftUpperArm);
  const lowerLocal = eulerToQuat(bones.leftLowerArm);
  const world = upper.clone().multiply(lowerLocal);
  return REST_ARM_LEFT.clone().applyQuaternion(world).normalize();
}

describe("studio-vrm-pose-solver", () => {
  // MediaPipe: y는 아래가 양수. 미러 비활성으로 좌표를 직관적으로 검증한다.
  const opts = { mirror: false as const, zDamp: 1, minVisibility: 0.5 };

  it("팔을 곧게 폈을 때 하완의 부모상대 회전은 0(굽힘 없음)이다 — 이중회전 버그 수정의 핵심", () => {
    // 어깨 위, 팔꿈치/손목이 일직선으로 아래로.
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: 0.1 },
    });
    const bones = solvePoseToVrmBones(lm, opts);
    expect(bones.leftLowerArm).toBeDefined();
    const [x, y, z] = bones.leftLowerArm;
    expect(Math.abs(x)).toBeLessThan(1e-3);
    expect(Math.abs(y)).toBeLessThan(1e-3);
    expect(Math.abs(z)).toBeLessThan(1e-3);
  });

  it("팔꿈치를 굽히면 부모상대 합성이 실제 하완 방향을 정확히 복원한다", () => {
    // 상완은 아래로, 하완은 카메라 쪽(앞)으로 90° 굽힘.
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: -0.2, z: -0.3 }, // MediaPipe z<0 = 카메라 쪽
    });
    const bones = solvePoseToVrmBones(lm, opts);
    // 굽혔으므로 하완 로컬은 0이 아니다.
    const mag =
      Math.abs(bones.leftLowerArm[0]) +
      Math.abs(bones.leftLowerArm[1]) +
      Math.abs(bones.leftLowerArm[2]);
    expect(mag).toBeGreaterThan(0.5);

    // 복원된 하완 월드 방향 ≈ three 좌표의 (0,0,1) (앞=+Z, z 부호 변환 -(-0.3)).
    const d = forearmWorldDir(bones);
    expect(d.x).toBeCloseTo(0, 2);
    expect(d.y).toBeCloseTo(0, 2);
    expect(d.z).toBeCloseTo(1, 2);
  });

  it("상완 회전은 어깨→팔꿈치 방향을 향한다", () => {
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: 0.1 },
    });
    const bones = solvePoseToVrmBones(lm, opts);
    const upperWorld = REST_ARM_LEFT.clone()
      .applyQuaternion(eulerToQuat(bones.leftUpperArm))
      .normalize();
    // 팔꿈치가 어깨 아래 → three 좌표(y-up)에서 하향(-Y).
    expect(upperWorld.y).toBeLessThan(-0.9);
  });

  it("zDamp 이 작을수록 하완 방향의 깊이(z) 성분이 줄어든다", () => {
    // 하완이 아래(y)+앞(z) 으로 향하도록 — z 를 0으로 감쇠해도 방향이 퇴화하지 않는다.
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: 0.0, z: -0.3 },
    });
    const full = forearmWorldDir(solvePoseToVrmBones(lm, { mirror: false, zDamp: 1, minVisibility: 0.5 }));
    const damped = forearmWorldDir(solvePoseToVrmBones(lm, { mirror: false, zDamp: 0, minVisibility: 0.5 }));
    expect(Math.abs(full.z)).toBeGreaterThan(0.2); // 감쇠 없으면 깊이 성분 존재
    expect(Math.abs(damped.z)).toBeLessThan(1e-2); // 감쇠 0이면 거의 사라짐
  });

  it("가시성이 낮은 관절이 있으면 해당 팔 본을 생략한다", () => {
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: 0.1, visibility: 0.1 },
    });
    const bones = solvePoseToVrmBones(lm, opts);
    expect(bones.leftUpperArm).toBeUndefined();
    expect(bones.leftLowerArm).toBeUndefined();
  });

  it("미러 모드에서 왼쪽 랜드마크를 오른쪽 본으로 매핑한다(거울 따라하기)", () => {
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.5 },
      [POSE_LM.leftElbow]: { y: -0.2 },
      [POSE_LM.leftWrist]: { y: 0.1 },
    });
    const bones = solvePoseToVrmBones(lm, { mirror: true });
    expect(bones.rightUpperArm).toBeDefined();
    expect(bones.leftUpperArm).toBeUndefined();
  });

  it("거울 모드는 좌우(x)만 반전하고 상하(y)는 보존한다 — 상하 반전 버그 회귀 방지", () => {
    // 왼팔을 위로(팔꿈치·손목이 어깨보다 위 = 더 작은 y).
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { y: -0.3 },
      [POSE_LM.leftElbow]: { y: -0.6 },
      [POSE_LM.leftWrist]: { y: -0.9 },
    });
    const o = { zDamp: 1, minVisibility: 0.5 } as const;
    // 비미러: 왼팔 본이 위(+y)를 향한다.
    const nonMirror = solvePoseToVrmBones(lm, { mirror: false, ...o });
    const leftDir = REST_ARM_LEFT.clone()
      .applyQuaternion(eulerToQuat(nonMirror.leftUpperArm))
      .normalize();
    expect(leftDir.y).toBeGreaterThan(0.8);
    expect(leftDir.x).toBeCloseTo(0, 1);

    // 미러: 오른팔 본(스왑)도 위(+y) 보존, x 부호만 반전(여기선 x≈0이라 위 유지가 핵심).
    const mir = solvePoseToVrmBones(lm, { mirror: true, ...o });
    expect(mir.rightUpperArm).toBeDefined();
    const rightDir = REST_ARM_RIGHT.clone()
      .applyQuaternion(eulerToQuat(mir.rightUpperArm))
      .normalize();
    expect(rightDir.y).toBeGreaterThan(0.8); // 상하 보존(위) — 버그면 아래(-y)로 뒤집힘
  });

  it("거울 모드: x 오프셋이 있으면 좌우(x) 부호만 반전하고 상하(y)는 같은 부호로 보존", () => {
    // 왼팔을 위+바깥(+x)으로 — x·y 동시 검증.
    const lm = makeLandmarks({
      [POSE_LM.leftShoulder]: { x: 0, y: -0.3 },
      [POSE_LM.leftElbow]: { x: 0.25, y: -0.55 },
      [POSE_LM.leftWrist]: { x: 0.5, y: -0.8 },
    });
    const o = { zDamp: 1, minVisibility: 0.5 } as const;
    const left = REST_ARM_LEFT.clone()
      .applyQuaternion(eulerToQuat(solvePoseToVrmBones(lm, { mirror: false, ...o }).leftUpperArm))
      .normalize();
    const right = REST_ARM_RIGHT.clone()
      .applyQuaternion(eulerToQuat(solvePoseToVrmBones(lm, { mirror: true, ...o }).rightUpperArm))
      .normalize();
    expect(left.x).toBeGreaterThan(0.1); // 비미러: 바깥(+x)
    expect(right.x).toBeLessThan(-0.1); // 미러: x 부호 반전
    expect(Math.sign(right.y)).toBe(Math.sign(left.y)); // 상하는 같은 부호(보존)
    expect(Math.abs(right.y - left.y)).toBeLessThan(1e-6); // y 크기도 동일
  });

  it("랜드마크가 33개 미만이면 빈 맵을 반환한다", () => {
    expect(solvePoseToVrmBones([], opts)).toEqual({});
    expect(solvePoseToVrmBones(undefined, opts)).toEqual({});
  });

  it("상체를 옆으로 기울이면 척추/가슴이 회전하고 팔은 토르소 상대로 보정된다", () => {
    // 골반은 수평, 어깨가 +x 쪽으로 치우침(옆 기울임) + 왼팔 듦.
    const base = {
      [POSE_LM.leftHip]: { x: 0.2, y: 0 },
      [POSE_LM.rightHip]: { x: -0.2, y: 0 },
      [POSE_LM.leftElbow]: { x: 0.3, y: -0.6 },
      [POSE_LM.leftWrist]: { x: 0.4, y: -0.9 },
    };
    const upright = makeLandmarks({
      ...base,
      [POSE_LM.leftShoulder]: { x: 0.2, y: -0.5 },
      [POSE_LM.rightShoulder]: { x: -0.2, y: -0.5 },
    });
    const leaned = makeLandmarks({
      ...base,
      [POSE_LM.leftShoulder]: { x: 0.5, y: -0.5 }, // 어깨가 오른쪽으로 치우침
      [POSE_LM.rightShoulder]: { x: 0.1, y: -0.5 },
    });
    const a = solvePoseToVrmBones(upright, opts);
    const b = solvePoseToVrmBones(leaned, opts);
    // 곧게 선 상체: 척추 회전 ≈ 0.
    expect(Math.hypot(...a.spine)).toBeLessThan(0.05);
    // 기울인 상체: 척추에 롤(z) 발생.
    expect(Math.abs(b.spine[2])).toBeGreaterThan(0.05);
    expect(b.chest).toBeDefined();
    // 팔은 토르소 프레임 상대 → 기울임에 따라 상완 로컬이 보정되어 달라진다(이중회전 방지).
    expect(b.leftUpperArm).toBeDefined();
    expect(Math.abs(b.leftUpperArm[2] - a.leftUpperArm[2])).toBeGreaterThan(0.02);
  });
});
