
// MediaPipe HandLandmarker(손 21개 랜드마크) → VRM 손가락 본 회전(Euler) 솔버.
//
// 각 관절의 굽힘(curl) 각도를 인접 분절 사이 각으로 구해, 스튜디오의 기존 손가락 컬 규약과
// 동일하게 [0, 0, sign*각도](Z축 회전, sign=좌-1/우+1)로 매핑한다. 엄지는 Y·Z 복합.
// → 수동 "주먹" 프리셋과 같은 축이라 손가락이 올바른 방향으로 말린다.
//
// 순수 함수라 단위 테스트가 가능하다(MediaPipe 의존 없음).

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export type FingerEulerMap = Record<string, readonly [number, number, number]>;

/** MediaPipe Hand 랜드마크 인덱스. */
export const HAND_LM = {
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexDip: 7,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleDip: 11,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringDip: 15,
  ringTip: 16,
  littleMcp: 17,
  littlePip: 18,
  littleDip: 19,
  littleTip: 20,
} as const;

const FINGERS = [
  { name: "Index", mcp: 5, pip: 6, dip: 7, tip: 8 },
  { name: "Middle", mcp: 9, pip: 10, dip: 11, tip: 12 },
  { name: "Ring", mcp: 13, pip: 14, dip: 15, tip: 16 },
  { name: "Little", mcp: 17, pip: 18, dip: 19, tip: 20 },
] as const;

const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;

/** 손가락 최대 컬(rad). 약 110°. */
const MAX_CURL = 1.95;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 관절 p1 에서 분절 (p0→p1)과 (p1→p2) 사이 각(rad). 곧게 펴면 0. */
function jointAngle(lm: readonly HandLandmark[], i0: number, i1: number, i2: number): number {
  const ax = lm[i1].x - lm[i0].x;
  const ay = lm[i1].y - lm[i0].y;
  const az = lm[i1].z - lm[i0].z;
  const bx = lm[i2].x - lm[i1].x;
  const by = lm[i2].y - lm[i1].y;
  const bz = lm[i2].z - lm[i1].z;
  const dot = ax * bx + ay * by + az * bz;
  const m = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  if (m < 1e-8) return 0;
  return Math.acos(clamp(dot / m, -1, 1));
}

/**
 * 한 손의 21개 랜드마크 → 지정한 아바타 측(left/right)의 VRM 손가락 본 Euler 맵.
 * sign 은 아바타 측에서 결정되므로, 미러는 호출부가 avatarSide 를 스왑하는 것으로 처리된다.
 */
export function solveHandToFingerBones(
  landmarks: readonly HandLandmark[] | undefined,
  avatarSide: "left" | "right"
): FingerEulerMap {
  const out: Record<string, readonly [number, number, number]> = {};
  if (!landmarks || landmarks.length < 21) return out;
  const sign = avatarSide === "left" ? -1 : 1;
  const W = HAND_LM.wrist;

  for (const f of FINGERS) {
    const curls = [
      jointAngle(landmarks, W, f.mcp, f.pip), // Proximal: 손목→MCP vs MCP→PIP (너클 굽힘)
      jointAngle(landmarks, f.mcp, f.pip, f.dip), // Intermediate: PIP
      jointAngle(landmarks, f.pip, f.dip, f.tip), // Distal: DIP
    ];
    SEGMENTS.forEach((seg, i) => {
      const c = clamp(curls[i], 0, MAX_CURL);
      out[`${avatarSide}${f.name}${seg}`] = [0, 0, sign * c];
    });
  }

  // 엄지: MCP·IP 굽힘을 기존 컬 규약(Y·Z 복합)에 맞춰 근사 매핑.
  const thumbProx = clamp(jointAngle(landmarks, HAND_LM.thumbCmc, HAND_LM.thumbMcp, HAND_LM.thumbIp), 0, MAX_CURL);
  const thumbDist = clamp(jointAngle(landmarks, HAND_LM.thumbMcp, HAND_LM.thumbIp, HAND_LM.thumbTip), 0, MAX_CURL);
  out[`${avatarSide}ThumbProximal`] = [0, sign * thumbProx * 0.6, sign * thumbProx * 0.5];
  out[`${avatarSide}ThumbDistal`] = [0, 0, sign * thumbDist];

  return out;
}

/**
 * MediaPipe HandLandmarker handedness("Left"/"Right") + 미러 → 아바타 측.
 *
 * 주의: HandLandmarker 의 handedness 는 "셀카(미러)" 입력을 가정해 분류된다 — 즉
 * PoseLandmarker 의 해부학적 left/right 랜드마크 라벨과 반대다(같은 물리적 손인데 라벨이 뒤집힘).
 * 손가락은 팔(pose 솔버)이 올려놓은 아바타 손에 얹혀야 손바닥 방향이 팔과 일치한다.
 * pose 솔버는 미러 시 좌우를 스왑해 "거울 따라하기"를 만들므로, 손가락도 같은 측을 골라야 한다:
 *   - mirror(셀카 거울): HandLandmarker 라벨을 그대로 사용(이미 미러 기준이라 스왑하면 이중반전 → 손바닥 반대).
 *   - non-mirror: 라벨을 스왑해 해부학적 측으로 되돌린다.
 */
export function avatarSideForHand(handedness: string, mirror: boolean): "left" | "right" {
  const labelSide = handedness.toLowerCase().startsWith("l") ? "left" : "right";
  if (mirror) return labelSide;
  return labelSide === "left" ? "right" : "left";
}
