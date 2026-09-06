// VRM 포즈·표정 프리셋 확장 팩 — 코미Po!(ComiPo!)식 "원클릭 포즈/표정 갈아끼우기".
// StudioVrmPoser의 PoseBoneMap/applyPoseToVrm·applyExpressionWeightsToVrm 규약과 구조적으로 호환:
//  - rotation: 정규화 본의 오일러 회전(라디안). 코어(hips/spine/chest/neck/head)·말단(hand/foot)에 사용.
//  - direction: 사지(팔다리) 월드 방향 타깃. sideX는 좌우 대칭 자동 처리(양수 = 몸 바깥쪽).
// 외부 에셋 없음 — 순수 데이터 모듈.

import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export type PoseVec3 = readonly [number, number, number];
export type PoseSideAwareDirection = { sideX: number; y: number; z?: number };
export type PoseDirectionTarget = PoseVec3 | PoseSideAwareDirection;
export type PoseBoneSpec = { direction?: PoseDirectionTarget; rotation?: PoseVec3 };
export type PoseBoneMapSpec = Partial<Record<VRMHumanBoneName, PoseBoneSpec>>;

export interface StudioPosePreset {
  id: string;
  label: string;
  tone: string;
  yOffset?: number;
  bones: PoseBoneMapSpec;
}

export interface StudioExpressionPreset {
  id: string;
  label: string;
  emoji: string;
  tone: string;
  // VRM 표준 표정(blendshape) 이름 → 가중치(0~1) 조합
  weights: Record<string, number>;
}

// 포저(applyPoseToVrm)가 손가락 회전(오일러)으로 적용하는 본 — 모델에 없으면 안전하게 무시된다.
export const POSER_FINGER_BONES: readonly VRMHumanBoneName[] = [
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
];

// 포저(applyPoseToVrm)가 실제로 적용하는 본 집합 — 테스트에서 본 이름 검증에 사용.
export const POSER_KNOWN_BONES: readonly VRMHumanBoneName[] = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
  ...POSER_FINGER_BONES,
];

// VRM 1.0 표준 프리셋 표정 이름(+표준 시선) — 표정 프리셋 가중치 키 검증용.
export const VRM_STANDARD_EXPRESSIONS: readonly string[] = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blinkLeft",
  "blinkRight",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

const d = (deg: number) => (deg * Math.PI) / 180;

function aim(sideX: number, y: number, z = 0): PoseBoneSpec {
  return { direction: { sideX, y, z } };
}

function rotate(rotation: PoseVec3): PoseBoneSpec {
  return { rotation };
}

/**
 * Comfortable-attention wrists: almost collinear with the hanging forearm.
 * Only a tiny mirrored roll (1–2°) so palms stay soft without a kinked left wrist.
 * Avoid large Y/Z eulers — they read as spun or broken wrists on VRoid hands.
 */
function idleHands(rollDeg = 1.5): PoseBoneMapSpec {
  return {
    leftHand: rotate([0, 0, d(rollDeg)]),
    rightHand: rotate([0, 0, d(-rollDeg)]),
  };
}

// 편안한 차렷 기본 사지 — 팔·다리는 거의 내리고, 손목은 직선에 가깝게.
const BASE_LIMBS: PoseBoneMapSpec = {
  leftUpperArm: aim(0.28, -0.96, 0.02),
  rightUpperArm: aim(0.3, -0.95, 0.03),
  leftLowerArm: aim(0.14, -0.98, 0.14),
  rightLowerArm: aim(0.16, -0.97, 0.16),
  ...idleHands(1.5),
  leftUpperLeg: aim(0.06, -1),
  rightUpperLeg: aim(0.08, -1),
  leftLowerLeg: aim(0.02, -1),
  rightLowerLeg: aim(0.03, -1),
  leftFoot: rotate([0, 0, 0]),
  rightFoot: rotate([0, 0, 0]),
};

function basePose(core: PoseBoneMapSpec = {}): PoseBoneMapSpec {
  return { ...BASE_LIMBS, ...core };
}

// ── 자연 아이들(스폰 기본) 포즈 ─────────────────────────────────────────
// 새 VRM 캐릭터를 추가하면 T-포즈 대신 아래 포즈 중 하나가 캐릭터 id 해시로
// 결정적으로 선택·적용된다(같은 캐릭터 = 항상 같은 포즈, Math.random 금지).
// 설계 원칙: "편안한 차렷" — 팔·다리 거의 내림, 체중 이동은 수 도만,
// 팔꿈치 10~14° 이완, 어깨 내림 3~4°, 손목 1~2°(꺾임·스핀 금지),
// 손가락은 손바닥 쪽으로 살짝 말아 쉼(바깥 휘어짐·활짝 폄 금지), 머리 2~3° 기울임.

// 손가락 릴랙스 범위(도) — 손바닥 안쪽으로 자연스럽게 쉬는 정도(주먹·과펴짐 금지).
export const RELAXED_FINGER_CURL_MIN_DEG = 14;
export const RELAXED_FINGER_CURL_MAX_DEG = 24;

const FINGER_SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const FINGER_NAMES = ["Index", "Middle", "Ring", "Little"] as const;
// 검지→새끼로 살짝만 더 말림. 새끼 과 cascade 는 바깥으로 휘어 보이게 하니 억제.
const FINGER_CURL_PROFILE: Record<(typeof FINGER_NAMES)[number], number> = {
  Index: 1,
  Middle: 1.04,
  Ring: 1.06,
  Little: 1.08,
};
const SEGMENT_CURL_PROFILE: Record<(typeof FINGER_SEGMENTS)[number], number> = {
  Proximal: 1.05,
  Intermediate: 1.16,
  Distal: 0.92,
};
// 손 가운데로 모으는 미세 내전(°). 검지·새끼가 부채처럼 벌어지지 않게.
// (부호는 VRoid 정규화 본에서 span 이 줄어드는 쪽으로 검증됨 — 반대 부호는 오히려 벌림.)
const FINGER_ADDUCT_DEG: Record<(typeof FINGER_NAMES)[number], number> = {
  Index: -4.5,
  Middle: -1,
  Ring: 1.5,
  Little: 4,
};

function clampDeg(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// VRM 정규화 손가락 본: 다수 VRoid/샘플은 좌우 모두 local +Z 가 손바닥 쪽 굽힘이다.
// (예전 좌 -Z / 우 +Z 규약은 하린·세라 등 대부분에서 왼손을 손등 쪽으로 꺾었다.)
// sample.vrm(루미)처럼 축이 뒤집힌 모델은 applyFingerRotations 의 극성 정렬이 보정한다.
// Y 는 손 가운데로 살짝 모음(내전) — 펼쳐진 “바깥 휨” 실루엣을 줄인다.
export function relaxedFingers(leftCurlDeg: number, rightCurlDeg: number): PoseBoneMapSpec {
  const bones: PoseBoneMapSpec = {};

  (["left", "right"] as const).forEach((side) => {
    const baseDeg = side === "left" ? leftCurlDeg : rightCurlDeg;

    FINGER_NAMES.forEach((finger) => {
      FINGER_SEGMENTS.forEach((segment) => {
        const curlDeg = clampDeg(
          baseDeg * FINGER_CURL_PROFILE[finger] * SEGMENT_CURL_PROFILE[segment],
          RELAXED_FINGER_CURL_MIN_DEG,
          RELAXED_FINGER_CURL_MAX_DEG,
        );
        // Proximal 에만 내전을 실어 손끝 부채 벌어짐을 줄인다.
        const adductDeg = segment === "Proximal" ? FINGER_ADDUCT_DEG[finger] : FINGER_ADDUCT_DEG[finger] * 0.35;
        bones[`${side}${finger}${segment}` as VRMHumanBoneName] = rotate([
          0,
          d(adductDeg),
          d(curlDeg),
        ]);
      });
    });

    // 엄지: 손바닥 쪽으로 살짝 모아 쉼 (과외전 금지)
    bones[`${side}ThumbMetacarpal` as VRMHumanBoneName] = rotate([0, d(baseDeg * 0.42), d(baseDeg * 0.22)]);
    bones[`${side}ThumbProximal` as VRMHumanBoneName] = rotate([0, d(baseDeg * 0.32), d(baseDeg * 0.24)]);
    bones[`${side}ThumbDistal` as VRMHumanBoneName] = rotate([0, d(baseDeg * 0.2), d(baseDeg * 0.08)]);
  });

  return bones;
}

function idlePose(core: PoseBoneMapSpec, leftCurlDeg: number, rightCurlDeg: number): PoseBoneMapSpec {
  return { ...BASE_LIMBS, ...relaxedFingers(leftCurlDeg, rightCurlDeg), ...core };
}

export const NATURAL_IDLE_POSES: StudioPosePreset[] = [
  {
    id: "ni_weight_left",
    label: "자연 대기 A",
    tone: "편안한 차렷 · 왼발 살짝",
    bones: idlePose(
      {
        hips: rotate([0, d(1), d(2)]),
        spine: rotate([d(0.5), d(-0.5), d(-1.2)]),
        chest: rotate([d(-0.5), d(-1), d(-0.5)]),
        neck: rotate([0, d(1), d(-0.5)]),
        head: rotate([d(0.5), d(-2), d(2)]),
        leftShoulder: rotate([0, 0, d(-3.5)]),
        rightShoulder: rotate([0, 0, d(3)]),
        leftUpperArm: aim(0.26, -0.96, 0),
        rightUpperArm: aim(0.3, -0.95, 0.03),
        leftLowerArm: aim(0.1, -0.99, 0.1),
        rightLowerArm: aim(0.16, -0.97, 0.16),
        ...idleHands(1.5),
        leftUpperLeg: aim(0.04, -1, 0),
        rightUpperLeg: aim(0.1, -0.99, 0.04),
        leftLowerLeg: aim(0.02, -1, 0),
        rightLowerLeg: aim(0.04, -0.99, -0.06),
        leftFoot: rotate([0, d(-1), 0]),
        rightFoot: rotate([d(1), d(4), 0]),
      },
      17,
      18,
    ),
  },
  {
    id: "ni_weight_right",
    label: "자연 대기 B",
    tone: "편안한 차렷 · 오른발 살짝",
    bones: idlePose(
      {
        hips: rotate([d(0.5), d(-1.5), d(-2)]),
        spine: rotate([0, d(1), d(1.2)]),
        chest: rotate([d(-1), d(0.5), d(0.5)]),
        neck: rotate([d(0.5), d(-1), d(0.5)]),
        head: rotate([d(-0.5), d(2), d(-2)]),
        leftShoulder: rotate([0, 0, d(-3)]),
        rightShoulder: rotate([0, 0, d(3.5)]),
        leftUpperArm: aim(0.3, -0.95, 0.03),
        rightUpperArm: aim(0.26, -0.96, 0),
        leftLowerArm: aim(0.16, -0.97, 0.16),
        rightLowerArm: aim(0.1, -0.99, 0.1),
        ...idleHands(1.5),
        leftUpperLeg: aim(0.1, -0.99, 0.04),
        rightUpperLeg: aim(0.04, -1, 0),
        leftLowerLeg: aim(0.04, -0.99, -0.06),
        rightLowerLeg: aim(0.02, -1, 0),
        leftFoot: rotate([d(1), d(4), 0]),
        rightFoot: rotate([0, d(-1), 0]),
      },
      18,
      17,
    ),
  },
  {
    id: "ni_calm_front",
    label: "자연 대기 C",
    tone: "편안한 차렷 · 정면 차분",
    bones: idlePose(
      {
        hips: rotate([d(0.5), d(0.5), d(2)]),
        spine: rotate([d(1), 0, d(-1)]),
        chest: rotate([d(0.5), d(-0.5), d(-0.5)]),
        neck: rotate([d(1), d(0.5), 0]),
        head: rotate([d(1), d(1.5), d(2)]),
        leftShoulder: rotate([0, d(1), d(-3.2)]),
        rightShoulder: rotate([0, d(-1), d(3.2)]),
        leftUpperArm: aim(0.28, -0.96, 0.02),
        rightUpperArm: aim(0.29, -0.95, 0.04),
        leftLowerArm: aim(0.12, -0.97, 0.2),
        rightLowerArm: aim(0.13, -0.96, 0.22),
        ...idleHands(1.5),
        leftUpperLeg: aim(0.06, -1, 0),
        rightUpperLeg: aim(0.08, -0.995, 0.02),
        leftLowerLeg: aim(0.02, -1, -0.02),
        rightLowerLeg: aim(0.03, -0.995, -0.04),
        leftFoot: rotate([0, d(2), 0]),
        rightFoot: rotate([0, d(-3), 0]),
      },
      18,
      18,
    ),
  },
  {
    id: "ni_open_easy",
    label: "자연 대기 D",
    tone: "편안한 차렷 · 어깨 여유",
    bones: idlePose(
      {
        hips: rotate([d(-0.5), d(2), d(-2.5)]),
        spine: rotate([d(-1), d(-1), d(1.5)]),
        chest: rotate([d(-1), d(-0.5), d(0.8)]),
        neck: rotate([0, d(1), d(-0.5)]),
        head: rotate([d(-1), d(2), d(-2)]),
        leftShoulder: rotate([0, 0, d(-3)]),
        rightShoulder: rotate([0, d(-0.5), d(3.5)]),
        leftUpperArm: aim(0.32, -0.94, 0.05),
        rightUpperArm: aim(0.28, -0.95, 0.02),
        leftLowerArm: aim(0.18, -0.96, 0.18),
        rightLowerArm: aim(0.14, -0.97, 0.14),
        ...idleHands(1.5),
        leftUpperLeg: aim(0.09, -0.995, -0.02),
        rightUpperLeg: aim(0.05, -1, 0.01),
        leftLowerLeg: aim(0.03, -0.995, -0.03),
        rightLowerLeg: aim(0.02, -1, 0),
        leftFoot: rotate([0, d(3), 0]),
        rightFoot: rotate([0, d(-1), 0]),
      },
      16,
      17,
    ),
  },
];

// djb2 해시 — 캐릭터 id로 아이들 포즈를 결정적으로 고른다.
export function naturalIdleSeed(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

export function pickNaturalIdlePose(characterId: string): StudioPosePreset {
  return NATURAL_IDLE_POSES[naturalIdleSeed(characterId) % NATURAL_IDLE_POSES.length];
}

// ── 포즈 프리셋 22종 (기본 제공 포즈와 id가 겹치지 않도록 xp_ 접두) ──────
export const EXTRA_POSE_PRESETS: StudioPosePreset[] = [
  {
    id: "xp_wave_greeting",
    label: "손들어 인사",
    tone: "반갑게 오른손을 들어 인사",
    bones: basePose({
      spine: rotate([0, 0, d(-2)]),
      chest: rotate([d(-2), 0, d(-1)]),
      head: rotate([d(-2), d(-5), d(3)]),
      rightUpperArm: aim(0.55, 0.45, 0.4),
      rightLowerArm: aim(0.15, 0.85, 0.35),
      rightHand: rotate([0, d(15), d(25)]),
    }),
  },
  {
    id: "xp_idle_relax",
    label: "서있기(휴식)",
    tone: "힘 뺀 기본 대기",
    bones: basePose({
      hips: rotate([0, 0, d(2)]),
      spine: rotate([d(1), 0, d(-2)]),
      chest: rotate([d(-1), 0, d(-1)]),
      head: rotate([d(1), 0, d(2)]),
      leftUpperLeg: aim(0.16, -0.99),
      rightUpperLeg: aim(0.05, -1),
    }),
  },
  {
    id: "xp_hands_on_hips",
    label: "양손 허리",
    tone: "자신만만 스탠딩",
    bones: basePose({
      hips: rotate([0, d(2), d(1.5)]),
      spine: rotate([d(-3), d(-1), d(-1)]),
      chest: rotate([d(-4), d(-1), d(-0.5)]),
      head: rotate([d(-2), d(2), d(1.5)]),
      leftShoulder: rotate([0, 0, d(-2)]),
      rightShoulder: rotate([0, 0, d(3)]),
      leftUpperArm: aim(0.76, -0.57, 0.08),
      leftLowerArm: aim(-0.74, -0.58, 0.2),
      leftHand: rotate([0, d(14), d(11)]),
      rightUpperArm: aim(0.8, -0.53, 0.12),
      rightLowerArm: aim(-0.7, -0.62, 0.16),
      rightHand: rotate([0, d(-17), d(-9)]),
    }),
  },
  {
    id: "xp_one_hand_hip",
    label: "한손 허리",
    tone: "여유로운 포즈",
    bones: basePose({
      hips: rotate([0, 0, d(3)]),
      spine: rotate([d(-2), 0, d(-3)]),
      chest: rotate([d(-2), 0, d(-1)]),
      head: rotate([0, d(4), d(3)]),
      rightUpperArm: aim(0.75, -0.58, 0.1),
      rightLowerArm: aim(-0.7, -0.62, 0.18),
      rightHand: rotate([0, d(-15), d(-10)]),
    }),
  },
  {
    id: "xp_sprint",
    label: "전력 질주",
    tone: "역동적인 대시",
    yOffset: -0.04,
    bones: basePose({
      hips: rotate([d(-14), d(-6), 0]),
      spine: rotate([d(16), d(5), 0]),
      chest: rotate([d(4), d(3), 0]),
      head: rotate([d(-8), d(-5), 0]),
      leftUpperArm: aim(0.28, -0.42, -0.86),
      leftLowerArm: aim(0.15, 0.2, -0.95),
      rightUpperArm: aim(0.28, -0.3, 0.92),
      rightLowerArm: aim(0.15, 0.35, 0.9),
      leftUpperLeg: aim(0.08, -0.2, 0.97),
      leftLowerLeg: aim(0.03, -0.75, 0.65),
      rightUpperLeg: aim(0.08, -0.45, -0.88),
      rightLowerLeg: aim(0.03, -0.6, -0.78),
    }),
  },
  {
    id: "xp_chair_sit",
    label: "의자 앉기",
    tone: "바른 자세 착석",
    yOffset: -0.12,
    bones: basePose({
      hips: rotate([d(-6), d(2), d(1)]),
      spine: rotate([d(6), d(-1), d(-1)]),
      chest: rotate([d(1), d(-1), 0]),
      head: rotate([d(-1), d(3), d(1.5)]),
      leftShoulder: rotate([0, 0, d(-3)]),
      rightShoulder: rotate([0, 0, d(3.5)]),
      leftUpperLeg: aim(0.17, -0.19, 0.96),
      rightUpperLeg: aim(0.12, -0.22, 0.97),
      leftLowerLeg: aim(0.07, -0.9, -0.4),
      rightLowerLeg: aim(0.04, -0.93, -0.33),
      leftUpperArm: aim(0.28, -0.82, 0.38),
      rightUpperArm: aim(0.33, -0.78, 0.42),
      leftLowerArm: aim(0.06, -0.74, 0.66),
      rightLowerArm: aim(0.1, -0.7, 0.7),
      leftFoot: rotate([d(-6), d(-3), 0]),
      rightFoot: rotate([d(-5), d(4), 0]),
    }),
  },
  {
    id: "xp_kneel",
    label: "무릎 꿇기",
    tone: "정중한 자세",
    yOffset: -0.42,
    bones: basePose({
      hips: rotate([d(4), d(-2), d(1)]),
      spine: rotate([d(2), d(1), d(-1)]),
      head: rotate([d(2), d(-2), d(1.5)]),
      leftShoulder: rotate([0, 0, d(-3)]),
      rightShoulder: rotate([0, 0, d(2.5)]),
      leftUpperLeg: aim(0.14, -0.84, -0.51),
      rightUpperLeg: aim(0.11, -0.86, -0.49),
      leftLowerLeg: aim(0.06, -0.24, -0.96),
      rightLowerLeg: aim(0.04, -0.26, -0.95),
      leftUpperArm: aim(0.28, -0.93, 0.18),
      rightUpperArm: aim(0.32, -0.91, 0.23),
      leftLowerArm: aim(0.08, -0.96, 0.26),
      rightLowerArm: aim(0.12, -0.94, 0.3),
      leftFoot: rotate([d(35), d(2), 0]),
      rightFoot: rotate([d(33), d(-2), 0]),
    }),
  },
  {
    id: "xp_finger_heart",
    label: "손하트",
    tone: "팬서비스 컷",
    bones: basePose({
      spine: rotate([0, 0, d(-3)]),
      head: rotate([d(2), d(-5), d(-8)]),
      rightUpperArm: aim(0.42, 0.12, 0.5),
      rightLowerArm: aim(-0.4, 0.72, 0.5),
      rightHand: rotate([d(10), d(-20), d(-12)]),
    }),
  },
  {
    id: "xp_double_v",
    label: "양손 브이",
    tone: "신난 셀카 포즈",
    bones: basePose({
      chest: rotate([d(-3), 0, 0]),
      head: rotate([d(-2), 0, d(6)]),
      leftUpperArm: aim(0.6, 0.12, 0.4),
      leftLowerArm: aim(0.2, 0.85, 0.42),
      leftHand: rotate([d(-10), 0, d(12)]),
      rightUpperArm: aim(0.6, 0.12, 0.4),
      rightLowerArm: aim(0.2, 0.85, 0.42),
      rightHand: rotate([d(-10), 0, d(-12)]),
    }),
  },
  {
    id: "xp_point_you",
    label: "지목(삿대질)",
    tone: "\"바로 너!\" 컷",
    bones: basePose({
      hips: rotate([d(-3), d(-5), 0]),
      spine: rotate([d(6), d(4), 0]),
      chest: rotate([d(3), d(3), 0]),
      head: rotate([d(-3), d(-4), 0]),
      rightUpperArm: aim(0.22, 0.05, 0.97),
      rightLowerArm: aim(0.12, 0.02, 0.99),
      rightHand: rotate([0, 0, d(-5)]),
      leftUpperArm: aim(0.4, -0.9, -0.1),
    }),
  },
  {
    id: "xp_shock_hands",
    label: "놀람 양손",
    tone: "\"헉!\" 리액션",
    bones: basePose({
      hips: rotate([d(3), d(-2), 0]),
      spine: rotate([d(-6), d(1), d(-1)]),
      chest: rotate([d(-5), d(1), 0]),
      head: rotate([d(-7), d(-2), d(1)]),
      leftUpperArm: aim(0.74, 0.2, 0.3),
      leftLowerArm: aim(0.3, 0.8, 0.4),
      leftHand: rotate([d(-18), d(2), d(12)]),
      rightUpperArm: aim(0.7, 0.15, 0.35),
      rightLowerArm: aim(0.26, 0.84, 0.36),
      rightHand: rotate([d(-23), d(-2), d(-9)]),
      leftUpperLeg: aim(0.12, -0.96, -0.22),
    }),
  },
  {
    id: "xp_teary",
    label: "울먹임",
    tone: "눈물 그렁그렁",
    bones: basePose({
      spine: rotate([d(8), d(-1), d(1)]),
      chest: rotate([d(5), d(-1), d(-1)]),
      neck: rotate([d(7), d(1), 0]),
      head: rotate([d(7), d(2), d(3)]),
      leftShoulder: rotate([0, 0, d(-4)]),
      rightShoulder: rotate([0, 0, d(3)]),
      leftUpperArm: aim(0.18, -0.4, 0.6),
      leftLowerArm: aim(-0.28, 0.78, 0.48),
      leftHand: rotate([d(13), d(2), d(9)]),
      rightUpperArm: aim(0.14, -0.44, 0.64),
      rightLowerArm: aim(-0.32, 0.74, 0.52),
      rightHand: rotate([d(17), d(-2), d(-7)]),
    }),
  },
  {
    id: "xp_banzai",
    label: "만세",
    tone: "두 팔 번쩍",
    bones: basePose({
      hips: rotate([d(2), 0, 0]),
      spine: rotate([d(-5), 0, 0]),
      chest: rotate([d(-4), 0, 0]),
      head: rotate([d(-6), 0, 0]),
      leftUpperArm: aim(0.3, 0.92, 0.14),
      leftLowerArm: aim(0.14, 0.98, 0.06),
      leftHand: rotate([0, 0, d(8)]),
      rightUpperArm: aim(0.3, 0.92, 0.14),
      rightLowerArm: aim(0.14, 0.98, 0.06),
      rightHand: rotate([0, 0, d(-8)]),
    }),
  },
  {
    id: "xp_guard_up",
    label: "싸움 자세(가드)",
    tone: "주먹 들고 대비",
    yOffset: -0.05,
    bones: basePose({
      hips: rotate([d(-5), d(-10), 0]),
      spine: rotate([d(6), d(8), 0]),
      chest: rotate([d(2), d(5), 0]),
      head: rotate([d(-3), d(-9), 0]),
      leftUpperArm: aim(0.42, -0.08, 0.66),
      leftLowerArm: aim(-0.2, 0.7, 0.6),
      leftHand: rotate([d(-23), d(3), d(12)]),
      rightUpperArm: aim(0.38, -0.16, 0.58),
      rightLowerArm: aim(-0.24, 0.66, 0.64),
      rightHand: rotate([d(-27), d(-3), d(-9)]),
      leftUpperLeg: aim(0.14, -0.72, 0.66),
      rightUpperLeg: aim(0.14, -0.86, -0.48),
      leftLowerLeg: aim(0.04, -0.95, 0.3),
      rightLowerLeg: aim(0.04, -0.92, -0.36),
    }),
  },
  {
    id: "xp_shrug",
    label: "어깨 으쓱",
    tone: "\"몰라~\" 제스처",
    bones: basePose({
      spine: rotate([d(-2), d(1), d(-1)]),
      head: rotate([d(2), d(-2), d(8)]),
      leftShoulder: rotate([0, 0, d(4)]),
      rightShoulder: rotate([0, 0, d(-3)]),
      leftUpperArm: aim(0.84, -0.4, 0.16),
      leftLowerArm: aim(0.74, 0.43, 0.32),
      leftHand: rotate([d(-58), d(2), d(16)]),
      rightUpperArm: aim(0.8, -0.44, 0.2),
      rightLowerArm: aim(0.7, 0.47, 0.28),
      rightHand: rotate([d(-62), d(-2), d(-14)]),
    }),
  },
  {
    id: "xp_phone_look",
    label: "스마트폰 보기",
    tone: "폰 보며 딴청",
    bones: basePose({
      spine: rotate([d(6), 0, 0]),
      chest: rotate([d(4), 0, 0]),
      neck: rotate([d(10), 0, 0]),
      head: rotate([d(10), 0, 0]),
      rightUpperArm: aim(0.28, -0.5, 0.65),
      rightLowerArm: aim(-0.45, 0.4, 0.78),
      rightHand: rotate([d(20), d(-15), 0]),
      leftUpperArm: aim(0.3, -0.62, 0.5),
      leftLowerArm: aim(-0.4, 0.25, 0.85),
      leftHand: rotate([d(20), d(15), 0]),
    }),
  },
  {
    id: "xp_chin_rest",
    label: "턱 괴기",
    tone: "골똘한 생각",
    bones: basePose({
      spine: rotate([d(7), 0, d(2)]),
      chest: rotate([d(4), 0, 0]),
      neck: rotate([d(4), 0, 0]),
      head: rotate([d(3), d(6), d(8)]),
      rightUpperArm: aim(0.2, -0.45, 0.74),
      rightLowerArm: aim(-0.32, 0.86, 0.36),
      rightHand: rotate([d(-15), d(-20), d(-10)]),
      leftUpperArm: aim(0.32, -0.88, 0.3),
      leftLowerArm: aim(-0.5, -0.55, 0.62),
    }),
  },
  {
    id: "xp_polite_bow",
    label: "인사 꾸벅",
    tone: "공손한 목례",
    yOffset: -0.02,
    bones: basePose({
      hips: rotate([d(8), 0, 0]),
      spine: rotate([d(22), 0, 0]),
      chest: rotate([d(14), 0, 0]),
      neck: rotate([d(8), 0, 0]),
      head: rotate([d(6), 0, 0]),
      leftUpperArm: aim(0.2, -0.94, 0.26),
      rightUpperArm: aim(0.2, -0.94, 0.26),
      leftLowerArm: aim(0.08, -0.96, 0.22),
      rightLowerArm: aim(0.08, -0.96, 0.22),
    }),
  },
  {
    id: "xp_jump_joy",
    label: "신나는 점프",
    tone: "공중에서 환호",
    yOffset: 0.16,
    bones: basePose({
      hips: rotate([d(-6), 0, 0]),
      spine: rotate([d(-4), 0, d(3)]),
      chest: rotate([d(4), 0, 0]),
      head: rotate([d(-7), 0, d(-4)]),
      leftUpperArm: aim(0.65, 0.74, 0.12),
      leftLowerArm: aim(0.32, 0.93, 0.1),
      rightUpperArm: aim(0.58, 0.78, 0.08),
      rightLowerArm: aim(0.27, 0.95, 0.06),
      leftUpperLeg: aim(0.1, -0.5, 0.86),
      leftLowerLeg: aim(0.05, -0.8, -0.58),
      rightUpperLeg: aim(0.12, -0.92, 0.12),
      rightLowerLeg: aim(0.05, -0.55, -0.82),
      leftFoot: rotate([d(-20), 0, 0]),
      rightFoot: rotate([d(-18), 0, 0]),
    }),
  },
  {
    id: "xp_look_back",
    label: "뒤돌아보기",
    tone: "어깨 너머 시선",
    bones: basePose({
      hips: rotate([0, d(-8), 0]),
      spine: rotate([d(2), d(-20), 0]),
      chest: rotate([d(1), d(-18), 0]),
      neck: rotate([0, d(-11), 0]),
      head: rotate([0, d(-11), d(-3)]),
      rightUpperArm: aim(0.4, -0.9, -0.15),
      leftUpperArm: aim(0.35, -0.92, 0.1),
    }),
  },
  {
    id: "xp_lying_down",
    label: "누워있기",
    tone: "바닥에 벌렁",
    yOffset: -0.55,
    bones: basePose({
      hips: rotate([d(-85), 0, 0]),
      spine: rotate([d(2), d(-1), 0]),
      chest: rotate([d(1), d(1), 0]),
      neck: rotate([d(6), d(-1), 0]),
      head: rotate([d(6), d(3), d(2)]),
      leftUpperArm: aim(0.55, -0.15, -0.5),
      rightUpperArm: aim(0.45, -0.22, -0.6),
      leftLowerArm: aim(0.34, -0.08, -0.66),
      rightLowerArm: aim(0.26, -0.12, -0.74),
      leftUpperLeg: aim(0.15, -0.1, 0.94),
      rightUpperLeg: aim(0.1, -0.14, 0.96),
      leftLowerLeg: aim(0.07, -0.16, 0.93),
      rightLowerLeg: aim(0.04, -0.2, 0.91),
    }),
  },
  {
    id: "xp_hands_behind",
    label: "뒷짐",
    tone: "느긋한 산책",
    bones: basePose({
      spine: rotate([d(-3), d(-1), 0]),
      chest: rotate([d(-4), d(1), 0]),
      head: rotate([d(-2), d(2), d(1)]),
      leftShoulder: rotate([0, 0, d(-2.5)]),
      rightShoulder: rotate([0, 0, d(2)]),
      leftUpperArm: aim(0.26, -0.8, -0.44),
      leftLowerArm: aim(-0.53, -0.52, -0.53),
      rightUpperArm: aim(0.22, -0.84, -0.4),
      rightLowerArm: aim(-0.57, -0.48, -0.57),
    }),
  },
  {
    id: "xp_propose_kneel",
    label: "한쪽 무릎(프로포즈)",
    tone: "극적인 고백 컷",
    yOffset: -0.3,
    bones: basePose({
      hips: rotate([d(2), 0, 0]),
      spine: rotate([d(4), 0, 0]),
      head: rotate([d(-3), 0, 0]),
      rightUpperLeg: aim(0.12, -0.8, -0.55),
      rightLowerLeg: aim(0.05, -0.3, -0.93),
      leftUpperLeg: aim(0.12, -0.45, 0.87),
      leftLowerLeg: aim(0.05, -0.95, -0.2),
      rightUpperArm: aim(0.25, -0.2, 0.9),
      rightLowerArm: aim(0.1, 0.05, 0.97),
      rightHand: rotate([d(-30), 0, 0]),
      leftUpperArm: aim(0.35, -0.9, 0.1),
      rightFoot: rotate([d(30), 0, 0]),
    }),
  },
  // 추가 30종+ (액션/표정/일상/장르 다양, idle/action/expression 카테고리 커버)
  { id: "xp_kick", label: "킥", tone: "발차기", yOffset: -0.05, bones: basePose({ hips: rotate([d(-8), d(-5), 0]), rightUpperLeg: aim(0.2, -0.1, -0.95), rightLowerLeg: aim(0.1, -0.6, -0.8), leftUpperLeg: aim(0.15, -0.95, 0.1) }) },
  { id: "xp_punch", label: "펀치", tone: "주먹질", bones: basePose({ rightUpperArm: aim(0.3, 0.1, 0.9), rightLowerArm: aim(0.1, 0.2, 0.95), rightHand: rotate([d(5), 0, d(-10)]) }) },
  { id: "xp_sit_floor", label: "바닥 앉기", tone: "편안한 좌식", yOffset: -0.35, bones: basePose({ hips: rotate([d(-65), 0, 0]), spine: rotate([d(10), 0, 0]), leftUpperLeg: aim(0.6, -0.3, 0.7), rightUpperLeg: aim(0.5, -0.4, 0.65) }) },
  { id: "xp_dance", label: "댄스", tone: "가벼운 춤", bones: basePose({ leftUpperArm: aim(0.8, 0.5, 0.3), rightUpperArm: aim(0.7, -0.4, -0.4), hips: rotate([d(2), d(8), d(4)]) }) },
  { id: "xp_run", label: "달리기", tone: "전력", yOffset: -0.03, bones: basePose({ leftUpperLeg: aim(0.3, -0.3, 0.9), rightUpperLeg: aim(0.1, -0.9, -0.4), leftLowerLeg: aim(0.2, -0.6, 0.7) }) },
  { id: "xp_crouch", label: "웅크리기", tone: "숨기", yOffset: -0.25, bones: basePose({ hips: rotate([d(-25), 0, 0]), spine: rotate([d(12), 0, 0]), leftUpperLeg: aim(0.4, -0.6, 0.6), rightUpperLeg: aim(0.35, -0.65, 0.55) }) },
  { id: "xp_fist_up", label: "주먹 들기", tone: "결의", bones: basePose({ rightUpperArm: aim(0.2, 0.85, 0.1), rightLowerArm: aim(-0.1, 0.95, 0.05), rightHand: rotate([d(10), 0, d(-15)]) }) },
  { id: "xp_bow_deep", label: "깊은 인사", tone: "정중", yOffset: -0.05, bones: basePose({ spine: rotate([d(18), 0, 0]), chest: rotate([d(9), 0, 0]), neck: rotate([d(5), 0, 0]) }) },
  { id: "xp_lean_wall", label: "벽 기대기", tone: "캐주얼", bones: basePose({ spine: rotate([d(3), d(-25), 0]), rightUpperArm: aim(0.1, -0.7, -0.5) }) },
  { id: "xp_hold_heart", label: "가슴에 손", tone: "진심", bones: basePose({ leftUpperArm: aim(0.4, -0.3, 0.6), leftLowerArm: aim(-0.2, -0.6, 0.7), leftHand: rotate([d(5), d(10), d(20)]) }) },
  { id: "xp_spin", label: "회전", tone: "스핀", bones: basePose({ hips: rotate([d(0), d(45), 0]), spine: rotate([d(-2), d(30), 0]) }) },
  { id: "xp_kneel_pray", label: "무릎 기도", tone: "경건", yOffset: -0.35, bones: basePose({ hips: rotate([d(5), 0, 0]), rightUpperLeg: aim(0.15, -0.75, -0.5), rightLowerLeg: aim(0.08, -0.25, -0.9), head: rotate([d(-8), 0, 0]) }) },
  { id: "xp_jump_pose", label: "점프 포즈", tone: "공중", yOffset: 0.12, bones: basePose({ leftUpperLeg: aim(0.25, -0.4, 0.8), rightUpperLeg: aim(0.15, -0.5, -0.7), leftLowerLeg: aim(0.1, -0.7, -0.5) }) },
  { id: "xp_side_lean", label: "옆 기대", tone: "여유", bones: basePose({ hips: rotate([d(1), d(12), d(3)]), rightUpperArm: aim(0.1, -0.8, -0.3) }) },
  { id: "xp_sword_ready", label: "검 자세", tone: "전투", bones: basePose({ rightUpperArm: aim(0.25, 0.05, 0.9), rightLowerArm: aim(0.05, 0.1, 0.98), hips: rotate([d(-4), d(-3), 0]) }) },
  { id: "xp_blush_cover", label: "부끄러움 가리기", tone: "수줍", bones: basePose({ head: rotate([d(2), d(5), d(5)]), rightUpperArm: aim(0.5, -0.3, 0.5), rightLowerArm: aim(-0.1, -0.4, 0.8) }) },
  { id: "xp_think_chin", label: "턱 고개", tone: "고민", bones: basePose({ rightUpperArm: aim(0.3, -0.25, 0.4), rightLowerArm: aim(-0.2, -0.55, 0.75), head: rotate([d(6), d(-8), d(-3)]) }) },
  { id: "xp_superhero", label: "히어로 포즈", tone: "영웅", bones: basePose({ leftUpperArm: aim(0.2, 0.95, 0.15), rightUpperArm: aim(0.15, -0.9, -0.2), hips: rotate([d(-3), 0, 0]) }) },
  { id: "xp_sad_sit", label: "슬픔 앉기", tone: "우울", yOffset: -0.25, bones: basePose({ spine: rotate([d(12), 0, d(-2)]), head: rotate([d(5), d(3), d(4)]), leftUpperArm: aim(0.4, -0.7, -0.3) }) },
  { id: "xp_laugh", label: "웃음", tone: "박장대소", bones: basePose({ spine: rotate([d(-6), d(3), 0]), head: rotate([d(-10), d(8), d(6)]), leftUpperArm: aim(0.7, 0.4, 0.4), rightUpperArm: aim(0.65, -0.35, -0.45) }) },
  { id: "xp_meditate", label: "명상", tone: "차분", bones: basePose({ spine: rotate([d(8), 0, 0]), head: rotate([d(-2), 0, 0]), leftUpperArm: aim(0.1, -0.7, -0.6), rightUpperArm: aim(0.1, -0.7, 0.6) }) },
  { id: "xp_point_forward", label: "앞 가리키기", tone: "지시", bones: basePose({ rightUpperArm: aim(0.1, 0.2, 0.95), rightLowerArm: aim(0.05, 0.1, 0.99), head: rotate([d(-1), d(-3), d(1)]) }) },
  { id: "xp_angel_wing", label: "날개 포즈", tone: "천사", bones: basePose({ leftUpperArm: aim(0.8, 0.6, 0.2), rightUpperArm: aim(0.75, -0.55, -0.25), head: rotate([d(-1), 0, d(2)]) }) },
  { id: "xp_cry", label: "울기", tone: "눈물", bones: basePose({ spine: rotate([d(4), 0, d(2)]), head: rotate([d(8), d(2), d(3)]), leftUpperArm: aim(0.25, -0.4, 0.3) }) },
  { id: "xp_fly_pose", label: "비행 포즈", tone: "하늘", yOffset: 0.05, bones: basePose({ leftUpperArm: aim(0.1, 0.9, 0.1), rightUpperArm: aim(0.05, -0.85, -0.15), leftUpperLeg: aim(0.2, -0.3, 0.8), rightUpperLeg: aim(0.15, -0.4, -0.75) }) },
  { id: "xp_thumbs_up", label: "엄지척", tone: "좋아", bones: basePose({ rightUpperArm: aim(0.5, -0.1, 0.8), rightLowerArm: aim(-0.1, 0.3, 0.85), rightHand: rotate([d(5), 0, d(25)]) }) },
  { id: "xp_shock", label: "깜짝 놀람", tone: "헉", bones: basePose({ spine: rotate([d(-8), d(5), 0]), head: rotate([d(-12), d(-6), d(4)]), leftUpperArm: aim(0.7, 0.2, 0.4), rightUpperArm: aim(0.65, -0.15, -0.35) }) },
  { id: "xp_sleep_stand", label: "졸음 서기", tone: "꾸벅", bones: basePose({ head: rotate([d(12), d(3), d(-2)]), spine: rotate([d(2), 0, d(-1)]), leftUpperArm: aim(0.2, -0.8, -0.1) }) },
  { id: "xp_victory", label: "승리 V", tone: "승리", bones: basePose({ leftUpperArm: aim(0.55, 0.3, 0.5), leftLowerArm: aim(0.1, 0.9, 0.3), rightUpperArm: aim(0.5, -0.25, -0.45), rightLowerArm: aim(0.05, 0.85, -0.4) }) },
  { id: "xp_cool_lean", label: "쿨 기대기", tone: "멋", bones: basePose({ spine: rotate([d(-1), d(-15), 0]), rightUpperArm: aim(0.15, -0.75, -0.4), head: rotate([d(-1), d(-8), d(3)]) }) },
  // 추가 장르·상황 포즈
  { id: "xp_phone_selfie", label: "셀카", tone: "스마트폰 각도", bones: basePose({ rightUpperArm: aim(0.35, 0.35, 0.7), rightLowerArm: aim(0.1, 0.55, 0.75), head: rotate([d(-4), d(8), d(3)]) }) },
  { id: "xp_typing", label: "타이핑", tone: "노트북 작업", bones: basePose({ spine: rotate([d(8), 0, 0]), leftUpperArm: aim(0.35, -0.45, 0.55), rightUpperArm: aim(0.35, -0.45, -0.55), head: rotate([d(6), 0, 0]) }) },
  { id: "xp_cooking", label: "요리", tone: "팬 젓기", bones: basePose({ rightUpperArm: aim(0.4, -0.2, 0.75), rightLowerArm: aim(0.1, 0.15, 0.9), leftUpperArm: aim(0.3, -0.55, 0.4) }) },
  { id: "xp_reading", label: "독서", tone: "책 펼침", bones: basePose({ leftUpperArm: aim(0.45, -0.35, 0.55), rightUpperArm: aim(0.4, -0.3, -0.5), head: rotate([d(8), 0, 0]) }) },
  { id: "xp_guard", label: "가드", tone: "방어 자세", bones: basePose({ leftUpperArm: aim(0.5, -0.1, 0.7), rightUpperArm: aim(0.45, -0.15, -0.65), hips: rotate([d(-3), 0, 0]) }) },
  { id: "xp_archer", label: "궁수", tone: "활 시위", bones: basePose({ leftUpperArm: aim(0.15, 0.05, 0.95), rightUpperArm: aim(0.55, -0.1, -0.7), head: rotate([d(-2), d(-12), 0]) }) },
  { id: "xp_salutation", label: "경례", tone: "군대·교칙", bones: basePose({ rightUpperArm: aim(0.2, 0.75, 0.25), rightLowerArm: aim(-0.15, 0.55, 0.7), head: rotate([d(-1), 0, 0]) }) },
  { id: "xp_present", label: "소개 포즈", tone: "안내·쇼", bones: basePose({ leftUpperArm: aim(0.55, -0.15, 0.65), leftLowerArm: aim(0.1, 0.2, 0.9), head: rotate([d(-2), d(6), 0]) }) },
  { id: "xp_wait_line", label: "줄 서기", tone: "대기", bones: basePose({ spine: rotate([d(1), 0, d(1)]), leftUpperArm: aim(0.25, -0.85, 0.1), rightUpperArm: aim(0.25, -0.85, -0.1) }) },
  { id: "xp_stretch", label: "기지개", tone: "기상", bones: basePose({ leftUpperArm: aim(0.15, 0.95, 0.15), rightUpperArm: aim(0.15, 0.9, -0.2), spine: rotate([d(-6), 0, 0]) }) },
  { id: "xp_fall_back", label: "뒤로 넘어짐", tone: "충격", yOffset: -0.15, bones: basePose({ spine: rotate([d(-18), 0, 0]), head: rotate([d(-10), 0, 0]), leftUpperArm: aim(0.7, 0.3, 0.4), rightUpperArm: aim(0.65, -0.25, -0.4) }) },
  { id: "xp_hug_self", label: "자기 안기", tone: "추위·불안", bones: basePose({ leftUpperArm: aim(0.55, -0.35, 0.55), rightUpperArm: aim(0.55, -0.35, -0.55), spine: rotate([d(6), 0, 0]) }) },
  { id: "xp_cheer_both", label: "양손 환호", tone: "응원", bones: basePose({ leftUpperArm: aim(0.25, 0.95, 0.2), rightUpperArm: aim(0.25, 0.95, -0.2), head: rotate([d(-6), 0, 0]) }) },
  { id: "xp_sneak", label: "살금", tone: "잠입", yOffset: -0.12, bones: basePose({ spine: rotate([d(10), d(8), 0]), head: rotate([d(4), d(10), 0]), leftUpperLeg: aim(0.25, -0.7, 0.55), rightUpperLeg: aim(0.2, -0.85, -0.25) }) },
  { id: "xp_balance", label: "균형", tone: "한 발", yOffset: -0.02, bones: basePose({ leftUpperLeg: aim(0.15, -0.95, 0.05), rightUpperLeg: aim(0.4, -0.5, 0.7), leftUpperArm: aim(0.6, 0.2, 0.5), rightUpperArm: aim(0.55, -0.15, -0.55) }) },
];

// ── 표정 프리셋 14종 — VRM 표준 표정 가중치 "조합"을 원클릭 적용 ─────────
export const EXPRESSION_PRESETS: StudioExpressionPreset[] = [
  { id: "xf_joy", label: "기쁨", emoji: "😊", tone: "밝은 미소", weights: { happy: 1 } },
  { id: "xf_grin", label: "활짝웃음", emoji: "😆", tone: "눈웃음 + 함박", weights: { happy: 1, blink: 1, aa: 0.3 } },
  { id: "xf_sad", label: "슬픔", emoji: "😢", tone: "축 처진 표정", weights: { sad: 1 } },
  { id: "xf_tears", label: "눈물", emoji: "😭", tone: "울음 직전", weights: { sad: 1, blink: 0.55, ou: 0.3 } },
  { id: "xf_angry", label: "분노", emoji: "😠", tone: "정색 화남", weights: { angry: 1 } },
  { id: "xf_grudge", label: "킹받음", emoji: "😤", tone: "웃는데 화남", weights: { angry: 0.7, happy: 0.4, ih: 0.35 } },
  { id: "xf_surprised", label: "놀람", emoji: "😲", tone: "동공 지진", weights: { surprised: 1, oh: 0.55 } },
  { id: "xf_blank", label: "멍", emoji: "😶", tone: "넋 나간 얼굴", weights: { relaxed: 0.4, aa: 0.15, lookUp: 0.3 } },
  { id: "xf_shy", label: "부끄러움", emoji: "😳", tone: "시선 회피", weights: { happy: 0.4, sad: 0.25, lookDown: 0.6 } },
  { id: "xf_wink", label: "윙크", emoji: "😉", tone: "한쪽 눈 찡긋", weights: { happy: 0.7, blinkRight: 1, ih: 0.25 } },
  { id: "xf_sleepy", label: "졸림", emoji: "😪", tone: "반쯤 감긴 눈", weights: { relaxed: 0.8, blink: 0.8, aa: 0.2 } },
  { id: "xf_neutral", label: "무표정", emoji: "😐", tone: "표정 초기화", weights: {} },
  { id: "xf_determined", label: "결의", emoji: "😼", tone: "불타는 의지", weights: { angry: 0.45, happy: 0.3, ee: 0.4 } },
  { id: "xf_pout", label: "새침(삐짐)", emoji: "😗", tone: "입 삐죽", weights: { angry: 0.3, ou: 0.7, lookLeft: 0.3 } },
  // 추가 8종 (더욱 풍부한 표정)
  { id: "xf_smirk", label: "능글", emoji: "😏", tone: "자신만만", weights: { happy: 0.6, angry: 0.2, lookRight: 0.4 } },
  { id: "xf_awe", label: "경외", emoji: "😮", tone: "입 벌린 감탄", weights: { surprised: 0.8, oh: 0.7, lookUp: 0.3 } },
  { id: "xf_evil", label: "사악", emoji: "😈", tone: "음흉", weights: { angry: 0.5, happy: 0.6, ih: 0.4 } },
  { id: "xf_cry_laugh", label: "눈물 웃음", emoji: "😂", tone: "배꼽", weights: { happy: 1, sad: 0.3, blink: 0.6, aa: 0.4 } },
  { id: "xf_confused", label: "혼란", emoji: "😕", tone: "어리둥절", weights: { sad: 0.3, relaxed: 0.5, lookLeft: 0.5, lookRight: 0.2 } },
  { id: "xf_love", label: "사랑", emoji: "🥰", tone: "하트 눈", weights: { happy: 0.9, relaxed: 0.4 } },
  { id: "xf_scream", label: "비명", emoji: "😱", tone: "공포", weights: { surprised: 1, oh: 0.9, aa: 0.6 } },
  { id: "xf_cool", label: "쿨", emoji: "😎", tone: "선글라스 감성", weights: { relaxed: 0.6, happy: 0.3, lookDown: 0.2 } },
  { id: "xf_focus", label: "집중", emoji: "🧐", tone: "일에 몰입", weights: { angry: 0.25, ee: 0.35, lookDown: 0.4 } },
  { id: "xf_yawn", label: "하품", emoji: "🥱", tone: "피곤", weights: { relaxed: 0.7, aa: 0.75, blink: 0.5 } },
  { id: "xf_sassy", label: "도도", emoji: "💅", tone: "자존심", weights: { happy: 0.35, angry: 0.25, lookRight: 0.45, ou: 0.25 } },
  { id: "xf_innocent", label: "순수", emoji: "🥺", tone: "순진", weights: { sad: 0.2, happy: 0.45, lookUp: 0.35 } },
  { id: "xf_serious", label: "진지", emoji: "😐", tone: "무거움", weights: { angry: 0.35, relaxed: 0.2, ee: 0.2 } },
  { id: "xf_excited", label: "흥분", emoji: "🤩", tone: "설렘", weights: { happy: 1, surprised: 0.45, aa: 0.35 } },
];
