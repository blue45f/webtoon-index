import { describe, expect, it } from "vitest";

import {
  avatarSideForHand,
  HAND_LM,
  solveHandToFingerBones,
  type HandLandmark,
} from "./studio-vrm-hand-solver";

// 21개 랜드마크 배열을 만든다(나머지는 원점). set 으로 일부 지정.
function makeHand(set: Record<number, [number, number, number]>): HandLandmark[] {
  const arr: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [i, v] of Object.entries(set)) {
    arr[Number(i)] = { x: v[0], y: v[1], z: v[2] };
  }
  return arr;
}

// 곧게 편 검지(손목→MCP→PIP→DIP→TIP 일직선 +y).
function straightIndex(): Record<number, [number, number, number]> {
  return {
    [HAND_LM.wrist]: [0, 0, 0],
    [HAND_LM.indexMcp]: [0, 1, 0],
    [HAND_LM.indexPip]: [0, 2, 0],
    [HAND_LM.indexDip]: [0, 3, 0],
    [HAND_LM.indexTip]: [0, 4, 0],
  };
}

describe("studio-vrm-hand-solver", () => {
  it("곧게 편 손가락은 컬 회전이 0에 가깝다", () => {
    const hand = makeHand(straightIndex());
    const bones = solveHandToFingerBones(hand, "left");
    for (const seg of ["Proximal", "Intermediate", "Distal"]) {
      const r = bones[`leftIndex${seg}`];
      expect(r).toBeDefined();
      expect(Math.abs(r[2])).toBeLessThan(0.05); // Z 컬 ≈ 0
    }
  });

  it("굽힌 손가락은 컬 회전이 커지고 Z축에 실린다", () => {
    // PIP·DIP 에서 -z 로 굽힘.
    const hand = makeHand({
      ...straightIndex(),
      [HAND_LM.indexDip]: [0, 2.5, -0.7],
      [HAND_LM.indexTip]: [0, 2.4, -1.7],
    });
    const bones = solveHandToFingerBones(hand, "left");
    const inter = bones.leftIndexIntermediate;
    expect(Math.abs(inter[2])).toBeGreaterThan(0.3); // 굽힘 → Z 컬 존재
    expect(inter[0]).toBe(0); // X 성분 없음
    expect(inter[1]).toBe(0); // Y 성분 없음
  });

  it("좌우 부호가 반대다(left=-, right=+)", () => {
    const hand = makeHand({
      ...straightIndex(),
      [HAND_LM.indexDip]: [0, 2.5, -0.7],
      [HAND_LM.indexTip]: [0, 2.4, -1.7],
    });
    const left = solveHandToFingerBones(hand, "left").leftIndexIntermediate;
    const right = solveHandToFingerBones(hand, "right").rightIndexIntermediate;
    expect(Math.sign(left[2])).toBe(-1);
    expect(Math.sign(right[2])).toBe(1);
    expect(left[2]).toBeCloseTo(-right[2]); // 크기 동일, 부호 반대
  });

  it("엄지는 Y·Z 복합으로 매핑된다", () => {
    const hand = makeHand({
      [HAND_LM.thumbCmc]: [0, 0, 0],
      [HAND_LM.thumbMcp]: [1, 0, 0],
      [HAND_LM.thumbIp]: [1.7, 0, -0.7],
      [HAND_LM.thumbTip]: [1.7, 0, -1.7],
    });
    const bones = solveHandToFingerBones(hand, "right");
    const prox = bones.rightThumbProximal;
    expect(prox).toBeDefined();
    expect(prox[1]).not.toBe(0); // Y 성분 존재(엄지 규약)
    expect(prox[2]).not.toBe(0); // Z 성분 존재
    expect(bones.rightThumbDistal[2]).toBeGreaterThan(0); // 우측 부호 +
  });

  it("avatarSideForHand: HandLandmarker 라벨은 미러 기준 — 미러면 그대로, 비미러면 스왑", () => {
    // HandLandmarker handedness 는 셀카(미러) 입력을 가정해 분류되므로 Pose 의 해부학적 라벨과 반대다.
    // 미러(거울 따라하기): 라벨을 그대로 써야 팔(pose 솔버의 좌↔우 스왑 결과)과 같은 손에 손가락이 얹힌다.
    expect(avatarSideForHand("Left", true)).toBe("left");
    expect(avatarSideForHand("Right", true)).toBe("right");
    // 비미러: 라벨을 스왑해 해부학적 측으로 되돌린다(pose 솔버 non-mirror 와 일치).
    expect(avatarSideForHand("Left", false)).toBe("right");
    expect(avatarSideForHand("Right", false)).toBe("left");
  });

  it("랜드마크가 21개 미만이면 빈 맵", () => {
    expect(solveHandToFingerBones([], "left")).toEqual({});
    expect(solveHandToFingerBones(undefined, "left")).toEqual({});
  });
});
