/**
 * 생성형 캐릭터의 **휴머노이드 리그(rest 스켈레톤)** 를 파라미터에서 결정론적으로 만든다.
 *
 * 이 모듈이 생긴 이유 — 이전 생성기는 15개 본을 전부 `hips` 의 직계 자식으로 붙이고 좌우를
 * 뒤집어 놨다. 그러면 무릎을 굽혀도 발이 따라오지 않고, 척추를 숙여도 머리·팔이 제자리에
 * 남으며, `leftHand` 가 해부학적 오른팔에 붙는다. 스튜디오의 IK·포저·사진 포즈 스캔이
 * 전부 헛도는 리그였다. 여기서는 실제 부모 체인을 세우고 축 규약을 바로잡는다:
 *
 *   hips ─┬─ spine ─┬─ head
 *         │         ├─ leftUpperArm → leftLowerArm → leftHand ─┬─ 엄지 3마디
 *         │         │                                          └─ 검지·중지·약지·새끼 각 3마디
 *         │         └─ rightUpperArm → rightLowerArm → rightHand ─ (좌우 대칭)
 *         ├─ leftUpperLeg → leftLowerLeg → leftFoot
 *         └─ rightUpperLeg → rightLowerLeg → rightFoot
 *
 * 축 규약은 VRM 1.0 과 이 레포의 기준 스켈레톤
 * ({@link STUDIO_VRM_REFERENCE_BONE_SNAPSHOT}) 을 그대로 따른다: **Y-up, +Z 정면,
 * 캐릭터의 왼쪽 = +X**. 중립 치수도 같은 스냅샷에서 가져와 신장 1.60 m · 정확히 8두신이다.
 *
 * ---------------------------------------------------------------------------
 * 바인드 규약 — "IBM 은 이동만, 노드 스케일은 조형 파라미터"
 * ---------------------------------------------------------------------------
 * glTF 스키닝은 `globalTransform(joint) · IBM[joint]` 다. 이 리그는 IBM 을 **rest 월드
 * 위치의 역이동만으로** 정의한다(회전·스케일 없음). 그래서 노드에 남겨 둔 `scale` 은
 * 바인드에서 상쇄되지 않고 `T · S · T⁻¹` 로 살아남아 **관절을 원점으로 하는 조형 스케일**이
 * 된다. 머리 크기(두신비·얼굴 비율)와 손·발 크기가 이 경로로 적용된다.
 *
 * 전단(shear)은 **비균등** 스케일 아래에서 자식이 회전할 때 생긴다. 그래서 규약은 두 갈래다:
 * 비균등 조형 스케일(얼굴 비율)은 자식이 없는 `head` 에만 얹고, 자식을 이고 있는 본
 * (손가락을 단 hand)에는 **균등 스케일만** 얹는다. 균등 스케일은 회전과 교환되므로 전단을
 * 만들지 않고, 손가락이 손과 함께 커지는 것은 의도한 동작이다 — studio-vrm-proportion-core
 * 가 세운 원칙과 같고, 체형 런타임도 같은 기준으로 판정한다.
 *
 * 월드 rest 누적은 조상의 노드 스케일을 반영한다. IBM 이 이동만 담으므로, 반영하지 않으면
 * 스케일된 손 아래의 손가락이 씬 그래프가 놓는 자리와 어긋난 바인드를 쓰게 된다.
 *
 * 메시(studio-vrm-humanoid-mesh)는 이 rest 월드 좌표계에서 그대로 저작된다.
 */

import { STUDIO_VRM_EXPORT_REQUIRED_BONES } from "./studio-vrm-export-vrm-extension";
import {
  sanitizeStudioVrmProportions,
  type StudioVrmProportions,
} from "./studio-vrm-proportion-core";

import type { StudioHumanoidBoneName } from "../studio-humanoid-bones";
import type { AvatarForgeFaceParams } from "./studio-vrm-avatar-forge";

export const STUDIO_VRM_HUMANOID_RIG_VERSION = 2 as const;

/**
 * 리그가 실제로 굽는 본. VRM 이 **요구하는** 15본(`STUDIO_VRM_EXPORT_REQUIRED_BONES`)에
 * 손가락 30본을 얹은 것으로, 두 목록은 역할이 다르다 — 저 상수는 익스포터의 완결성 게이트이고,
 * 이쪽은 리그·스킨·노드 레이아웃의 순서를 정한다. 요구 목록에 손가락을 넣으면 익스포터가
 * 손가락 없는 스냅샷을 전부 거부하게 된다.
 *
 * **부모가 항상 자식보다 앞에 와야 한다** — `buildStudioVrmRig` 가 한 번의 순회로 월드 위치를
 * 확정하기 때문이다.
 */
export const STUDIO_VRM_RIG_BONES = Object.freeze([
  ...STUDIO_VRM_EXPORT_REQUIRED_BONES,
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
] as const satisfies readonly StudioHumanoidBoneName[]);

/** 한 손의 손가락 뿌리 마디 — 손바닥에서 뻗어 나가는 다섯 갈래. */
export const STUDIO_VRM_RIG_FINGERS = Object.freeze([
  "Thumb",
  "Index",
  "Middle",
  "Ring",
  "Little",
] as const);

export type StudioVrmRigFinger = (typeof STUDIO_VRM_RIG_FINGERS)[number];
export type StudioVrmRigBone = (typeof STUDIO_VRM_RIG_BONES)[number];
export type StudioVrmRigVec3 = readonly [number, number, number];

/** 해부학적 부모 체인. `null` 은 아마추어 직속(= 휴머노이드 루트). */
export const STUDIO_VRM_RIG_PARENTS: Readonly<
  Record<StudioVrmRigBone, StudioVrmRigBone | null>
> = Object.freeze({
  hips: null,
  spine: "hips",
  head: "spine",
  leftUpperArm: "spine",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  rightUpperArm: "spine",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  leftThumbMetacarpal: "leftHand",
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbDistal: "leftThumbProximal",
  leftIndexProximal: "leftHand",
  leftIndexIntermediate: "leftIndexProximal",
  leftIndexDistal: "leftIndexIntermediate",
  leftMiddleProximal: "leftHand",
  leftMiddleIntermediate: "leftMiddleProximal",
  leftMiddleDistal: "leftMiddleIntermediate",
  leftRingProximal: "leftHand",
  leftRingIntermediate: "leftRingProximal",
  leftRingDistal: "leftRingIntermediate",
  leftLittleProximal: "leftHand",
  leftLittleIntermediate: "leftLittleProximal",
  leftLittleDistal: "leftLittleIntermediate",
  rightThumbMetacarpal: "rightHand",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbDistal: "rightThumbProximal",
  rightIndexProximal: "rightHand",
  rightIndexIntermediate: "rightIndexProximal",
  rightIndexDistal: "rightIndexIntermediate",
  rightMiddleProximal: "rightHand",
  rightMiddleIntermediate: "rightMiddleProximal",
  rightMiddleDistal: "rightMiddleIntermediate",
  rightRingProximal: "rightHand",
  rightRingIntermediate: "rightRingProximal",
  rightRingDistal: "rightRingIntermediate",
  rightLittleProximal: "rightHand",
  rightLittleIntermediate: "rightLittleProximal",
  rightLittleDistal: "rightLittleIntermediate",
});

/**
 * 중립(모든 비율 1.0) rest 치수. 단위 m.
 *
 * {@link STUDIO_VRM_REFERENCE_BONE_SNAPSHOT} 에서 15본 리그로 접어 옮긴 값이다. 중간 본
 * (chest/upperChest/neck/shoulder)이 없으므로 그 구간 길이를 부모 세그먼트에 합산했다:
 * spine→head 0.34 = chest .10 + upperChest .10 + neck .06 + head .08,
 * spine→어깨 0.25 = chest .10 + upperChest .10 + shoulder .05.
 * 수직 누적은 발목 0.09 + 다리 0.86 + 골반→머리관절 0.45 = 1.40, 머리 0.20 → **1.60 m / 8두신**.
 */
export const STUDIO_VRM_RIG_NEUTRAL = Object.freeze({
  hipHeight: 0.95,
  /** hips → spine */
  spineRise: 0.11,
  /** spine → head(두개골 바닥) */
  headRise: 0.34,
  /** spine → 어깨 관절 */
  shoulderRise: 0.25,
  shoulderHalf: 0.155,
  upperArm: 0.27,
  lowerArm: 0.24,
  /** hips → 고관절 좌우 오프셋 */
  hipHalf: 0.09,
  thigh: 0.45,
  shin: 0.41,
  /** 중립 발목 높이(지면 → 발목). hipHeight − thigh − shin 과 같아야 한다. */
  ankleHeight: 0.09,
  /** 손목 → 너클(손가락 뿌리). 이 값 + 가운뎃손가락 길이가 손 전체 길이다. */
  palmLength: 0.062,
  /**
   * 너클에서 네 손가락이 벌어지는 앞뒤(+Z) 간격. 손바닥 반폭(0.025·신장단위 ≈ 4.0cm) 안에
   * 네 갈래가 서로 닿을 만큼 들어가야 한다 — 간격보다 손가락이 굵으면 서로 파묻힌다.
   */
  fingerSpread: 0.021,
  /** 손목에서 엄지가 갈라져 나오는 지점 */
  thumbBase: 0.018,
  thumbBaseForward: 0.022,
  /**
   * 엄지가 손바닥에서 벌어지는 각(rad). 손바닥은 앞뒤로 넓은 판이라, 이 각이 작으면 엄지가
   * 판 안에 통째로 묻혀 보이지 않는다.
   */
  thumbSplay: 0.8,
  /** head 관절 → 두개골 중심 */
  headCenterRise: 0.088,
  headForward: -0.006,
  headRadiusX: 0.096,
  headRadiusY: 0.115,
  headRadiusZ: 0.082,
});

/**
 * 중립 리그가 만드는 전신 키(m). 메시 프로파일 상수는 전부 이 값에 대한 **비율**로
 * 적어 두었으므로(studio-vrm-humanoid-mesh 의 `RATIO` 참고), 여기 숫자를 바꾸면 실루엣이
 * 통째로 따라온다.
 *
 * 발바닥 0 → 두개골 정수리 = hipHeight − (thigh + shin) 을 뺀 발목 0.09 위에 쌓은 값:
 * 0.95 + 0.11 + 0.34 + 0.088 + 0.115 = 1.603. 머리 길이 0.23 → **약 7.0두신**으로,
 * 실측한 VRoid 표준 아바타(≈7.3두신)와 같은 체감 비율이다.
 */
export const STUDIO_VRM_RIG_NEUTRAL_HEIGHT =
  STUDIO_VRM_RIG_NEUTRAL.hipHeight +
  STUDIO_VRM_RIG_NEUTRAL.spineRise +
  STUDIO_VRM_RIG_NEUTRAL.headRise +
  STUDIO_VRM_RIG_NEUTRAL.headCenterRise +
  STUDIO_VRM_RIG_NEUTRAL.headRadiusY;

export type StudioVrmRigHeadFit = {
  /** 두개골 타원체 중심(월드 rest). */
  readonly center: StudioVrmRigVec3;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly radiusZ: number;
};

export type StudioVrmRig = {
  readonly version: typeof STUDIO_VRM_HUMANOID_RIG_VERSION;
  readonly bones: readonly StudioVrmRigBone[];
  /**
   * 중립 리그 대비 **균등 배율**(중립에서 정확히 1) = `overallHeight`.
   *
   * 메시 실루엣 상수는 전부 이 값에 곱해야 한다. 골반 높이로 배율을 유추하면 안 된다 —
   * 골반은 다리가 길어져도 발바닥이 지면에 남도록 보정되므로 `legLength` 가 섞여 들어간다
   * (legLength 1.55 에서 골반 기준 배율은 1.50 이 되어 몸통·팔다리·의상이 50% 부풀었다).
   */
  readonly heightScale: number;
  /** 부모 기준 로컬 이동. glTF 노드 `translation` 에 그대로 들어간다. */
  readonly localTranslation: Readonly<Record<StudioVrmRigBone, StudioVrmRigVec3>>;
  /** rest 월드 위치. 메시 저작 좌표계이자 IBM 의 기준. */
  readonly worldRest: Readonly<Record<StudioVrmRigBone, StudioVrmRigVec3>>;
  /** 말단 본에만 붙는 조형 스케일. */
  readonly nodeScale: Readonly<Partial<Record<StudioVrmRigBone, StudioVrmRigVec3>>>;
  /** 손 크기. 노드 스케일이 아니라 관절 간격과 메시 굵기에 굽혀 들어간다. */
  readonly handScale: number;
  /** 스킨 `joints` 배열에서의 인덱스(= bones 배열 인덱스). */
  readonly jointIndex: Readonly<Record<StudioVrmRigBone, number>>;
  readonly head: StudioVrmRigHeadFit;
  /** 발바닥이 닿는 지면 높이(월드 Y). */
  readonly groundY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function uniform(value: number): StudioVrmRigVec3 {
  const scale = clamp(value, 0.6, 1.6);
  return [scale, scale, scale];
}

/**
 * 한 손의 손가락 마디 로컬 이동.
 *
 * T 포즈에서 팔은 ±X 로 뻗고 손바닥은 아래를 보므로, 네 손가락은 손바닥 폭 방향인 **Z 로
 * 벌어져** ±X 로 자란다. 엄지만 손목 가까이에서 갈라져 손바닥 앞(+Z)으로 벌어진다.
 *
 * 마디 길이는 검지 < 중지, 약지 ≈ 검지, 새끼 가장 짧게 — 손이 실루엣으로 손처럼 읽히는 최소
 * 조건이다. 손 노드에는 균등 `handScale` 이 붙어 있고, 월드 rest 누적이 조상 스케일을
 * 반영하므로 손가락은 손과 함께 커진다.
 */
type FingerSegments = {
  readonly thumbBase: StudioVrmRigVec3;
  readonly thumb: (index: 0 | 1) => StudioVrmRigVec3;
  readonly knuckle: (lane: number) => StudioVrmRigVec3;
  readonly straight: (
    finger: "index" | "middle" | "ring" | "little",
    index: 0 | 1,
  ) => StudioVrmRigVec3;
};

/**
 * 한 손의 손가락 마디 치수.
 *
 * T 포즈에서 팔은 ±X 로 뻗고 손바닥은 아래를 보므로, 네 손가락은 손바닥 폭 방향인 **Z 로
 * 벌어져** ±X 로 자란다. 엄지만 손목 가까이에서 갈라져 손바닥 앞(+Z)으로 벌어진다.
 *
 * 마디 길이는 새끼가 가장 짧고 중지가 가장 길다 — 손이 실루엣으로 손처럼 읽히는 최소 조건이다.
 * 손 노드에는 균등 `handScale` 이 붙어 있고 월드 rest 누적이 조상 스케일을 반영하므로,
 * 손가락은 손과 함께 커진다.
 */
function fingerSegments(side: 1 | -1, height: number, hand: number): FingerSegments {
  const n = STUDIO_VRM_RIG_NEUTRAL;
  const scale = height * hand;
  const palm = n.palmLength * scale;
  const spread = n.fingerSpread * scale;
  // 마디 길이(중립 m). 뿌리 → 중간 → 끝 순으로 짧아진다.
  const lengths = {
    index: [0.024, 0.015],
    middle: [0.026, 0.016],
    ring: [0.023, 0.015],
    little: [0.018, 0.011],
    thumb: [0.026, 0.02],
  } as const;
  const splayX = Math.cos(n.thumbSplay);
  const splayZ = Math.sin(n.thumbSplay);
  return {
    thumbBase: [n.thumbBase * scale * side, 0, n.thumbBaseForward * scale],
    thumb: (index) => [
      lengths.thumb[index] * scale * splayX * side,
      0,
      lengths.thumb[index] * scale * splayZ,
    ],
    knuckle: (lane) => [palm * side, 0, spread * lane],
    straight: (finger, index) => [lengths[finger][index] * scale * side, 0, 0],
  };
}

function leftFingerLocalTranslations(height: number, hand: number) {
  const f = fingerSegments(1, height, hand);
  return {
    leftThumbMetacarpal: f.thumbBase,
    leftThumbProximal: f.thumb(0),
    leftThumbDistal: f.thumb(1),
    leftIndexProximal: f.knuckle(1.5),
    leftIndexIntermediate: f.straight("index", 0),
    leftIndexDistal: f.straight("index", 1),
    leftMiddleProximal: f.knuckle(0.5),
    leftMiddleIntermediate: f.straight("middle", 0),
    leftMiddleDistal: f.straight("middle", 1),
    leftRingProximal: f.knuckle(-0.5),
    leftRingIntermediate: f.straight("ring", 0),
    leftRingDistal: f.straight("ring", 1),
    leftLittleProximal: f.knuckle(-1.5),
    leftLittleIntermediate: f.straight("little", 0),
    leftLittleDistal: f.straight("little", 1),
  };
}

function rightFingerLocalTranslations(height: number, hand: number) {
  const f = fingerSegments(-1, height, hand);
  return {
    rightThumbMetacarpal: f.thumbBase,
    rightThumbProximal: f.thumb(0),
    rightThumbDistal: f.thumb(1),
    rightIndexProximal: f.knuckle(1.5),
    rightIndexIntermediate: f.straight("index", 0),
    rightIndexDistal: f.straight("index", 1),
    rightMiddleProximal: f.knuckle(0.5),
    rightMiddleIntermediate: f.straight("middle", 0),
    rightMiddleDistal: f.straight("middle", 1),
    rightRingProximal: f.knuckle(-0.5),
    rightRingIntermediate: f.straight("ring", 0),
    rightRingDistal: f.straight("ring", 1),
    rightLittleProximal: f.knuckle(-1.5),
    rightLittleIntermediate: f.straight("little", 0),
    rightLittleDistal: f.straight("little", 1),
  };
}

/**
 * 리그를 만든다. 길이 파라미터는 **관절 간격**으로만, 크기 파라미터는 **말단 균등 스케일**로만
 * 표현한다. 얼굴 비율만 머리라는 leaf 위에서 비균등 스케일을 쓴다.
 */
export function buildStudioVrmRig(input: {
  readonly proportions?: unknown;
  readonly face?: Partial<AvatarForgeFaceParams>;
}): StudioVrmRig {
  const p: StudioVrmProportions = sanitizeStudioVrmProportions(input.proportions);
  const n = STUDIO_VRM_RIG_NEUTRAL;
  const height = p.overallHeight;

  const spineRise = n.spineRise * p.torsoLength * height;
  // 목 길이는 spine→head 구간의 위쪽 일부만 늘린다. 전 구간에 곱하면 흉곽까지 늘어난다.
  const headRise = n.headRise * height * (p.torsoLength * 0.68 + p.neckLength * 0.32);
  const shoulderRise = n.shoulderRise * p.torsoLength * height;
  const shoulderHalf = n.shoulderHalf * p.shoulderWidth * height;
  const upperArm = n.upperArm * p.armLength * height;
  const lowerArm = n.lowerArm * p.armLength * height;
  // 골반 간격은 어깨 너비와 무관하다. `shoulderWidth` 는 쇄골 좌우 오프셋이고 골반 메시도
  // 그 값으로 넓어지지 않는다 — 여기에 곱하면 어깨를 좁혔을 때 두 허벅지가 겹치고 넓히면
  // 스탠스가 바뀐다. 골반 폭 파라미터가 생기기 전까지는 키에만 비례시킨다.
  const hipHalf = n.hipHalf * height;
  const thigh = n.thigh * p.legLength * height;
  const shin = n.shin * p.legLength * height;
  // 다리가 길어져도 발바닥이 지면(y=0)에 남도록 골반을 같이 올린다.
  const hipHeight = (n.hipHeight + (n.thigh + n.shin) * (p.legLength - 1)) * height;
  // 손 크기는 **기하에 굽는다**. 노드 스케일로 두면 손가락이 그 아래에 있으므로, 저작이 이미
  // 스케일된 관절 위치를 쓰는 데다 바인드가 관절 기준으로 스케일을 한 번 더 적용해 손바닥이
  // 배로 늘어난다(handScale 1.5 에서 손바닥 뻗음 2.25배). 머리처럼 자식이 없는 말단이라야
  // 노드 스케일이 안전하다.
  const handScale = clamp(p.handScale, 0.6, 1.6);

  const local: Record<StudioVrmRigBone, StudioVrmRigVec3> = {
    hips: [0, hipHeight, 0],
    spine: [0, spineRise, 0],
    head: [0, headRise, 0],
    leftUpperArm: [shoulderHalf, shoulderRise, 0],
    leftLowerArm: [upperArm, 0, 0],
    leftHand: [lowerArm, 0, 0],
    rightUpperArm: [-shoulderHalf, shoulderRise, 0],
    rightLowerArm: [-upperArm, 0, 0],
    rightHand: [-lowerArm, 0, 0],
    leftUpperLeg: [hipHalf, 0, 0],
    leftLowerLeg: [0, -thigh, 0],
    leftFoot: [0, -shin, 0],
    rightUpperLeg: [-hipHalf, 0, 0],
    rightLowerLeg: [0, -thigh, 0],
    rightFoot: [0, -shin, 0],
    ...leftFingerLocalTranslations(height, handScale),
    ...rightFingerLocalTranslations(height, handScale),
  };

  const face = input.face ?? {};
  const headScale = clamp(p.headBodyRatio, 0.5, 3.6);
  const headWidth = clamp(finite(face.headWidth, 1), 0.6, 1.6);
  const headHeight = clamp(finite(face.headHeight, 1), 0.6, 1.6);
  const headDepth = clamp(finite(face.headDepth, 1), 0.6, 1.6);

  const nodeScale: Partial<Record<StudioVrmRigBone, StudioVrmRigVec3>> = {
    head: [headWidth * headScale, headHeight * headScale, headDepth * headScale],
    leftFoot: uniform(p.footScale),
    rightFoot: uniform(p.footScale),
  };

  // bones 배열은 부모가 항상 자식보다 앞에 오므로 한 번의 순회로 월드가 확정된다.
  //
  // 조상의 노드 스케일도 함께 누적한다. 손 노드에는 균등 `handScale` 이 붙어 있고 손가락이
  // 그 아래에 있으므로, 이걸 빼면 IBM(이동만 담는다)이 가리키는 rest 위치와 씬 그래프가
  // 실제로 놓는 위치가 어긋나 손가락이 어긋난 바인드로 날아간다. 스케일이 말단에만 있던
  // 동안에는 누적이 항상 1이라 결과가 같다.
  const world = {} as Record<StudioVrmRigBone, StudioVrmRigVec3>;
  const inherited = {} as Record<StudioVrmRigBone, StudioVrmRigVec3>;
  for (const bone of STUDIO_VRM_RIG_BONES) {
    const parent = STUDIO_VRM_RIG_PARENTS[bone];
    const base: StudioVrmRigVec3 = parent === null ? [0, 0, 0] : world[parent];
    const carry: StudioVrmRigVec3 = parent === null ? [1, 1, 1] : inherited[parent];
    const offset = local[bone];
    world[bone] = [
      base[0] + offset[0] * carry[0],
      base[1] + offset[1] * carry[1],
      base[2] + offset[2] * carry[2],
    ];
    const own = nodeScale[bone] ?? [1, 1, 1];
    inherited[bone] = [carry[0] * own[0], carry[1] * own[1], carry[2] * own[2]];
  }

  const headJoint = world.head;

  return {
    version: STUDIO_VRM_HUMANOID_RIG_VERSION,
    bones: STUDIO_VRM_RIG_BONES,
    heightScale: height,
    localTranslation: local,
    worldRest: world,
    nodeScale,
    handScale,
    jointIndex: Object.fromEntries(
      STUDIO_VRM_RIG_BONES.map((bone, index) => [bone, index]),
    ) as Record<StudioVrmRigBone, number>,
    head: {
      center: [
        headJoint[0],
        headJoint[1] + n.headCenterRise * height,
        headJoint[2] + n.headForward * height,
      ],
      radiusX: n.headRadiusX * height,
      radiusY: n.headRadiusY * height,
      radiusZ: n.headRadiusZ * height,
    },
    groundY: 0,
  };
}

/**
 * 스킨 `inverseBindMatrices` — rest 월드 위치의 **역이동만** 담는다(열 우선 4×4).
 * 노드 스케일을 일부러 담지 않는 것이 이 리그의 조형 규약이다(파일 상단 참고).
 */
export function studioVrmRigInverseBindMatrices(rig: StudioVrmRig): number[] {
  const matrices: number[] = [];
  for (const bone of rig.bones) {
    const [x, y, z] = rig.worldRest[bone];
    matrices.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1);
  }
  return matrices;
}

/** 리그가 만드는 캐릭터의 전신 키(지면 → 두개골 정수리). 두신비 스케일을 반영한다. */
export function studioVrmRigStandingHeight(rig: StudioVrmRig): number {
  const headScaleY = rig.nodeScale.head?.[1] ?? 1;
  const headJointY = rig.worldRest.head[1];
  const topY = headJointY + (rig.head.center[1] - headJointY + rig.head.radiusY) * headScaleY;
  return topY - rig.groundY;
}
