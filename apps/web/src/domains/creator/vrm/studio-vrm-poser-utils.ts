import * as THREE from "three";

import {
  STUDIO_HUMANOID_BONE_NAMES,
  isStudioHumanoidBoneName,
} from "../studio-humanoid-bones";
import { POSER_FINGER_BONES } from "../studio-pose-presets";

import { classifyMeshName } from "./studio-vrm-costume";
import {
  cloneStudioVrmIkConstraints,
  parseStudioVrmIkConstraints,
} from "./studio-vrm-ik-constraints";
import {
  isStudioVrmMtoonMaterial,
  type StudioVrmMtoonBrand,
} from "./studio-vrm-mtoon-brand";
import {
  parseVrmPhysicsSettings,
  type VrmPhysicsSettings,
} from "./studio-vrm-physics";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  normalizeStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import { parseVrmProps, type PropInstance } from "./studio-vrm-props";
import {
  DEFAULT_STUDIO_VRM_LIGHTING_TONE,
  STUDIO_VRM_LIGHTING_TONES,
  type StudioVrmIkConstraint,
  type StudioVrmLightingTone,
  type StudioVrmPoseTranslations,
} from "./studio-vrm-scene-document";
import { parseSceneProps, type SerializedSceneProps } from "./studio-vrm-scene-props";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export type Vec3 = readonly [number, number, number];
export type SideAwareDirection = {
  sideX: number;
  y: number;
  z?: number;
};
export type DirectionTarget = Vec3 | SideAwareDirection;
export type PoseBone = {
  direction?: DirectionTarget;
  rotation?: Vec3;
};
export type PoseBoneMap = Partial<Record<VRMHumanBoneName, PoseBone>>;

export type PosePreset = {
  id: string;
  label: string;
  tone: string;
  yOffset?: number;
  bones: PoseBoneMap;
};

export const d = THREE.MathUtils.degToRad;

function aim(sideX: number, y: number, z = 0): PoseBone {
  return { direction: { sideX, y, z } };
}

function rotate(rotation: Vec3): PoseBone {
  return { rotation };
}

const NATURAL_LIMBS: PoseBoneMap = {
  leftUpperArm: aim(0.35, -0.94),
  rightUpperArm: aim(0.35, -0.94),
  leftLowerArm: aim(0.2, -0.98),
  rightLowerArm: aim(0.2, -0.98),
  leftHand: rotate([0, 0, d(2)]),
  rightHand: rotate([0, 0, d(-2)]),
  leftUpperLeg: aim(0.08, -1),
  rightUpperLeg: aim(0.08, -1),
  leftLowerLeg: aim(0.03, -1),
  rightLowerLeg: aim(0.03, -1),
  leftFoot: rotate([0, 0, 0]),
  rightFoot: rotate([0, 0, 0]),
};

function naturalPose(core: PoseBoneMap = {}) {
  return { ...NATURAL_LIMBS, ...core };
}

export const POSE_PRESETS: PosePreset[] = [
  {
    id: "default",
    label: "기본",
    tone: "편한 스탠딩",
    bones: naturalPose({
      hips: rotate([0, d(1), d(1.5)]),
      spine: rotate([d(1), d(-1), d(-1)]),
      chest: rotate([d(-1), d(-1), d(-0.5)]),
      neck: rotate([d(1), d(1), 0]),
      head: rotate([d(-1), d(-2), d(1.5)]),
      leftShoulder: rotate([0, 0, d(-3.5)]),
      rightShoulder: rotate([0, 0, d(3)]),
      leftUpperArm: aim(0.31, -0.95, -0.02),
      rightUpperArm: aim(0.37, -0.93, 0.04),
      leftLowerArm: aim(0.17, -0.97, 0.18),
      rightLowerArm: aim(0.21, -0.95, 0.24),
      leftHand: rotate([0, d(2), d(5)]),
      rightHand: rotate([0, d(-3), d(-6)]),
      leftUpperLeg: aim(0.06, -1, -0.01),
      rightUpperLeg: aim(0.11, -0.99, 0.06),
      leftLowerLeg: aim(0.02, -1, 0.01),
      rightLowerLeg: aim(0.05, -0.98, -0.09),
      leftFoot: rotate([0, d(-2), 0]),
      rightFoot: rotate([d(1), d(5), 0]),
    }),
  },
  {
    id: "wave",
    label: "손인사",
    tone: "반가운 손짓",
    bones: naturalPose({
      spine: rotate([d(-1), d(-2), 0]),
      chest: rotate([d(1), d(-3), 0]),
      head: rotate([d(-2), d(3), d(3)]),
      rightUpperArm: aim(0.48, 0.66, 0.08),
      rightLowerArm: aim(0.18, 0.96, 0.1),
      rightHand: rotate([0, 0, d(-15)]),
    }),
  },
  {
    id: "point",
    label: "대화",
    tone: "자연스러운 대화",
    bones: naturalPose({
      hips: rotate([0, d(-2), 0]),
      spine: rotate([d(-1), d(3), 0]),
      chest: rotate([d(1), d(4), 0]),
      head: rotate([d(-1), d(-4), 0]),
      rightUpperArm: aim(0.62, -0.12, 0.28),
      rightLowerArm: aim(0.3, 0.05, 0.95),
      rightHand: rotate([0, d(-10), d(-10)]),
    }),
  },
  {
    id: "cheer",
    label: "기쁨",
    tone: "만세 포즈",
    bones: naturalPose({
      hips: rotate([d(-1), 0, 0]),
      spine: rotate([d(-3), 0, 0]),
      chest: rotate([d(4), 0, 0]),
      head: rotate([d(-6), 0, 0]),
      leftUpperArm: aim(0.55, 0.83),
      leftLowerArm: aim(0.22, 0.97),
      rightUpperArm: aim(0.55, 0.83),
      rightLowerArm: aim(0.22, 0.97),
    }),
  },
  {
    id: "think",
    label: "생각",
    tone: "고민 컷",
    bones: naturalPose({
      hips: rotate([0, d(2), 0]),
      spine: rotate([d(3), d(-3), 0]),
      chest: rotate([d(1), d(-4), 0]),
      neck: rotate([d(1), d(3), 0]),
      head: rotate([d(6), d(-4), d(-4)]),
      rightUpperArm: aim(0.38, -0.25, 0.25),
      rightLowerArm: aim(-0.28, 0.55, 0.78),
      rightHand: rotate([d(15), d(10), d(-15)]),
    }),
  },
  {
    id: "sit",
    label: "앉기",
    tone: "낮은 자세",
    yOffset: -0.08,
    bones: naturalPose({
      hips: rotate([d(-4), d(2), d(1)]),
      spine: rotate([d(4), d(-1), d(-1)]),
      chest: rotate([d(-1), d(-1), 0]),
      head: rotate([d(-2), d(3), d(1.5)]),
      leftShoulder: rotate([0, 0, d(-3)]),
      rightShoulder: rotate([0, 0, d(2.5)]),
      leftUpperLeg: aim(0.15, -0.26, 0.95),
      rightUpperLeg: aim(0.1, -0.3, 0.94),
      leftLowerLeg: aim(0.07, -0.86, -0.48),
      rightLowerLeg: aim(0.04, -0.9, -0.42),
      leftFoot: rotate([d(-4), d(-2), d(1)]),
      rightFoot: rotate([d(-3), d(3), d(-1)]),
    }),
  },
  {
    id: "run",
    label: "걷기",
    tone: "한 걸음",
    yOffset: -0.01,
    bones: naturalPose({
      hips: rotate([d(-2), d(-3), 0]),
      spine: rotate([d(3), d(2), 0]),
      chest: rotate([d(-1), d(2), 0]),
      head: rotate([d(-2), d(-3), 0]),
      leftUpperArm: aim(0.32, -0.75, -0.55),
      leftLowerArm: aim(0.18, -0.85, -0.48),
      rightUpperArm: aim(0.32, -0.65, 0.68),
      rightLowerArm: aim(0.18, -0.8, 0.56),
      leftUpperLeg: aim(0.08, -0.55, 0.83),
      leftLowerLeg: aim(0.03, -0.96, 0.25),
      rightUpperLeg: aim(0.08, -0.72, -0.7),
      rightLowerLeg: aim(0.03, -0.9, 0.44),
    }),
  },
  {
    id: "present",
    label: "설명",
    tone: "차분한 안내",
    bones: naturalPose({
      hips: rotate([0, d(3), 0]),
      spine: rotate([d(-1), d(-3), 0]),
      chest: rotate([d(1), d(-4), 0]),
      head: rotate([d(-1), d(4), 0]),
      rightUpperArm: aim(0.48, -0.2, 0.55),
      rightLowerArm: aim(0.18, 0.05, 0.98),
      rightHand: rotate([0, d(-10), d(-10)]),
    }),
  },
  {
    id: "support",
    label: "응원",
    tone: "화이팅 응원",
    bones: naturalPose({
      hips: rotate([d(-1), d(-2), 0]),
      spine: rotate([d(-3), d(2), 0]),
      chest: rotate([d(4), d(2), 0]),
      head: rotate([d(-2), d(-1), 0]),
      leftUpperArm: aim(0.42, 0.9),
      leftLowerArm: aim(0.1, 0.99),
      leftHand: rotate([0, 0, d(10)]),
      rightUpperArm: aim(0.42, 0.9),
      rightLowerArm: aim(0.1, 0.99),
      rightHand: rotate([0, 0, d(-10)]),
    }),
  },
  {
    id: "despair",
    label: "낙담",
    tone: "차분한 저점",
    yOffset: -0.03,
    bones: naturalPose({
      hips: rotate([d(4), d(1), 0]),
      spine: rotate([d(8), d(-1), d(1)]),
      chest: rotate([d(6), 0, d(-1)]),
      neck: rotate([d(8), d(1), 0]),
      head: rotate([d(6), d(-2), d(2)]),
      leftShoulder: rotate([0, 0, d(-5)]),
      rightShoulder: rotate([0, 0, d(4)]),
      leftUpperArm: aim(0.3, -0.95, 0.08),
      rightUpperArm: aim(0.26, -0.96, 0.04),
      leftLowerArm: aim(0.14, -0.98, 0.06),
      rightLowerArm: aim(0.1, -0.99, 0.02),
      leftHand: rotate([d(5), d(2), d(3)]),
      rightHand: rotate([d(3), d(-1), d(-2)]),
    }),
  },
  {
    id: "attack",
    label: "준비",
    tone: "대치 상태",
    yOffset: -0.02,
    bones: naturalPose({
      hips: rotate([d(-4), d(-6), 0]),
      spine: rotate([d(4), d(4), 0]),
      chest: rotate([d(-1), d(4), 0]),
      head: rotate([d(-3), d(-5), 0]),
      leftUpperArm: aim(0.52, 0.08, 0.58),
      leftLowerArm: aim(0.22, 0.13, 0.96),
      rightUpperArm: aim(0.48, 0.02, 0.52),
      rightLowerArm: aim(0.18, 0.07, 0.98),
      leftUpperLeg: aim(0.1, -0.7, 0.7),
      rightUpperLeg: aim(0.1, -0.82, -0.56),
    }),
  },
  {
    id: "defense",
    label: "방어",
    tone: "조심스러운 자세",
    yOffset: -0.02,
    bones: naturalPose({
      hips: rotate([d(-3), d(4), 0]),
      spine: rotate([d(3), d(-4), 0]),
      chest: rotate([d(2), d(-5), 0]),
      head: rotate([d(-2), d(5), 0]),
      leftUpperArm: aim(0.6, 0.3, 0.33),
      leftLowerArm: aim(0.2, 0.72, 0.66),
      rightUpperArm: aim(0.56, 0.25, 0.38),
      rightLowerArm: aim(0.16, 0.68, 0.7),
      leftUpperLeg: aim(0.1, -0.88, 0.46),
      rightUpperLeg: aim(0.1, -0.9, -0.42),
    }),
  },
  {
    id: "peace",
    label: "브이",
    tone: "셀카 포즈",
    bones: naturalPose({
      hips: rotate([0, d(-4), 0]),
      spine: rotate([d(2), d(4), 0]),
      chest: rotate([d(-1), d(4), d(2)]),
      head: rotate([d(4), d(-8), d(-5)]),
      rightUpperArm: aim(0.4, 0.58, 0.35),
      rightLowerArm: aim(0.1, 0.82, 0.55),
      rightHand: rotate([0, 0, d(-15)]),
    }),
  },
  {
    id: "fist",
    label: "화이팅",
    tone: "결의 컷",
    bones: naturalPose({
      hips: rotate([d(-2), d(4), 0]),
      spine: rotate([d(-3), 0, 0]),
      chest: rotate([d(5), 0, 0]),
      head: rotate([d(-3), d(-4), 0]),
      rightUpperArm: aim(0.35, 0.93, 0.05),
      rightLowerArm: aim(0.08, 0.99, 0.02),
      rightHand: rotate([0, 0, 0]),
    }),
  },
  {
    id: "flying",
    label: "비상",
    tone: "날아오르기",
    yOffset: 0.14,
    bones: naturalPose({
      hips: rotate([d(45), 0, 0]),
      spine: rotate([d(-12), 0, 0]),
      chest: rotate([d(-5), 0, 0]),
      head: rotate([d(-10), 0, 0]),
      leftUpperArm: aim(0.74, 0.53, -0.4),
      rightUpperArm: aim(0.7, 0.57, -0.44),
      leftLowerArm: aim(0.57, 0.7, -0.4),
      rightLowerArm: aim(0.53, 0.74, -0.44),
      leftUpperLeg: aim(0.13, -0.43, -0.89),
      rightUpperLeg: aim(0.11, -0.47, -0.87),
      leftLowerLeg: aim(0.07, -0.78, -0.62),
      rightLowerLeg: aim(0.05, -0.82, -0.58),
    }),
  },
  {
    id: "heart",
    label: "하트",
    tone: "볼하트 연출",
    bones: naturalPose({
      hips: rotate([0, d(3), 0]),
      spine: rotate([d(2), 0, 0]),
      chest: rotate([d(-2), 0, 0]),
      head: rotate([d(3), d(8), d(5)]),
      leftUpperArm: aim(0.38, 0.92),
      leftLowerArm: aim(-0.45, 0.8),
      leftHand: rotate([0, 0, d(15)]),
      rightUpperArm: aim(0.38, 0.92),
      rightLowerArm: aim(-0.45, 0.8),
      rightHand: rotate([0, 0, d(-10)]),
    }),
  },
  {
    id: "shy",
    label: "부끄럼",
    tone: "수줍은 자세",
    bones: naturalPose({
      spine: rotate([d(1), d(-2), 0]),
      head: rotate([d(8), d(3), d(5)]),
      leftShoulder: rotate([0, 0, d(-2)]),
      rightShoulder: rotate([0, 0, d(2.5)]),
      leftUpperArm: aim(-0.2, -0.56, 0.8),
      rightUpperArm: aim(-0.24, -0.6, 0.76),
      leftLowerArm: aim(-0.18, 0.15, 0.97),
      rightLowerArm: aim(-0.22, 0.09, 0.97),
    }),
  },
  {
    id: "arrogant",
    label: "팔짱",
    tone: "거만한 태도",
    bones: naturalPose({
      spine: rotate([d(-3), d(-1), 0]),
      chest: rotate([d(-2), d(1), 0]),
      head: rotate([d(-4), d(2), d(1.5)]),
      leftUpperArm: aim(-0.5, -0.22, 0.5),
      leftLowerArm: aim(-0.82, 0.2, 0.44),
      rightUpperArm: aim(-0.6, -0.18, 0.4),
      rightLowerArm: aim(-0.88, 0.15, 0.36),
    }),
  },
  {
    id: "shock",
    label: "깜짝",
    tone: "충격 유발",
    bones: naturalPose({
      spine: rotate([d(5), d(1), 0]),
      chest: rotate([d(4), d(-1), 0]),
      head: rotate([d(8), d(-2), d(1)]),
      leftUpperArm: aim(0.64, 0.54, 0.28),
      leftLowerArm: aim(0.24, 0.91, 0.3),
      leftHand: rotate([d(13), d(11), d(12)]),
      rightUpperArm: aim(0.6, 0.5, 0.33),
      rightLowerArm: aim(0.2, 0.93, 0.26),
      rightHand: rotate([d(17), d(-9), d(-8)]),
    }),
  },
  {
    id: "surrender",
    label: "항복",
    tone: "당황한 양손",
    bones: naturalPose({
      head: rotate([d(6), 0, 0]),
      leftUpperArm: aim(0.46, 0.88, 0.04),
      leftLowerArm: aim(0.14, 0.98, 0.02),
      rightUpperArm: aim(0.46, 0.88, 0.04),
      rightLowerArm: aim(0.14, 0.98, 0.02),
    }),
  },
  {
    id: "phone",
    label: "통화",
    tone: "전화 연출",
    bones: naturalPose({
      rightUpperArm: aim(0.36, -0.24, 0.34),
      rightLowerArm: aim(-0.18, 0.72, 0.66),
      rightHand: rotate([d(10), d(-15), d(-10)]),
    }),
  },
  {
    id: "salute",
    label: "경례",
    tone: "절제된 인사",
    bones: naturalPose({
      head: rotate([d(-2), d(-5), 0]),
      rightUpperArm: aim(0.45, 0.28, 0.35),
      rightLowerArm: aim(-0.45, 0.58, 0.68),
      rightHand: rotate([d(5), d(15), d(-15)]),
    }),
  },
  {
    id: "fighting",
    label: "격투",
    tone: "전투 준비 자세",
    yOffset: -0.03,
    bones: naturalPose({
      hips: rotate([d(-5), d(-10), 0]),
      spine: rotate([d(5), d(8), 0]),
      chest: rotate([d(-2), d(6), 0]),
      head: rotate([d(-4), d(-8), 0]),
      leftUpperArm: aim(0.55, 0.1, 0.6),
      leftLowerArm: aim(0.1, 0.45, 0.88),
      leftHand: rotate([d(10), 0, d(10)]),
      rightUpperArm: aim(0.5, -0.15, 0.55),
      rightLowerArm: aim(0.15, 0.5, 0.85),
      rightHand: rotate([d(10), 0, d(-10)]),
      leftUpperLeg: aim(0.15, -0.65, 0.75),
      rightUpperLeg: aim(0.1, -0.85, -0.52),
      leftLowerLeg: aim(0.05, -0.92, 0.38),
      rightLowerLeg: aim(0.03, -0.95, -0.3),
    }),
  },
  {
    id: "thinking",
    label: "생각중",
    tone: "턱을 괴고 생각",
    bones: naturalPose({
      hips: rotate([0, d(5), 0]),
      spine: rotate([d(4), d(-5), 0]),
      chest: rotate([d(2), d(-4), 0]),
      neck: rotate([d(2), d(4), 0]),
      head: rotate([d(8), d(-6), d(-5)]),
      rightUpperArm: aim(0.35, -0.2, 0.3),
      rightLowerArm: aim(-0.35, 0.6, 0.7),
      rightHand: rotate([d(20), d(15), d(-10)]),
      leftUpperArm: aim(-0.4, -0.3, 0.5),
      leftLowerArm: aim(-0.6, 0.15, 0.78),
      leftHand: rotate([d(5), 0, d(5)]),
    }),
  },
  {
    id: "pray",
    label: "기도",
    tone: "합장/기도",
    bones: naturalPose({
      spine: rotate([d(3), 0, 0]),
      chest: rotate([d(2), 0, 0]),
      neck: rotate([d(4), 0, 0]),
      head: rotate([d(8), 0, 0]),
      leftUpperArm: aim(-0.4, -0.25, 0.6),
      leftLowerArm: aim(-0.55, 0.35, 0.75),
      leftHand: rotate([d(10), d(-15), d(15)]),
      rightUpperArm: aim(-0.4, -0.25, 0.6),
      rightLowerArm: aim(-0.55, 0.35, 0.75),
      rightHand: rotate([d(10), d(15), d(-15)]),
    }),
  },
  {
    id: "dance",
    label: "댄스",
    tone: "춤추는 자세",
    yOffset: -0.01,
    bones: naturalPose({
      hips: rotate([d(-3), d(-8), d(3)]),
      spine: rotate([d(-2), d(6), d(-2)]),
      chest: rotate([d(3), d(5), d(-3)]),
      head: rotate([d(-4), d(-6), d(4)]),
      leftUpperArm: aim(0.62, 0.7, 0.15),
      leftLowerArm: aim(0.3, 0.92, 0.2),
      leftHand: rotate([0, 0, d(15)]),
      rightUpperArm: aim(0.5, -0.4, 0.4),
      rightLowerArm: aim(0.2, -0.2, 0.96),
      rightHand: rotate([0, 0, d(-10)]),
      leftUpperLeg: aim(0.1, -0.6, 0.79),
      leftLowerLeg: aim(0.05, -0.85, 0.52),
      rightUpperLeg: aim(0.18, -0.88, -0.42),
      rightLowerLeg: aim(0.05, -0.72, -0.69),
    }),
  },
  {
    id: "bow",
    label: "인사",
    tone: "깊은 인사",
    yOffset: -0.04,
    bones: naturalPose({
      hips: rotate([d(25), 0, 0]),
      spine: rotate([d(15), 0, 0]),
      chest: rotate([d(8), 0, 0]),
      neck: rotate([d(5), 0, 0]),
      head: rotate([d(3), 0, 0]),
      leftUpperArm: aim(0.2, -0.98),
      rightUpperArm: aim(0.2, -0.98),
      leftLowerArm: aim(0.1, -0.99),
      rightLowerArm: aim(0.1, -0.99),
    }),
  },
  {
    id: "crouch",
    label: "쪼그림",
    tone: "웅크리기",
    yOffset: -0.18,
    bones: naturalPose({
      hips: rotate([d(-15), 0, 0]),
      spine: rotate([d(12), 0, 0]),
      chest: rotate([d(5), 0, 0]),
      neck: rotate([d(3), 0, 0]),
      head: rotate([d(-5), 0, 0]),
      leftUpperArm: aim(0.32, -0.63, 0.52),
      leftLowerArm: aim(0.17, -0.28, 0.94),
      rightUpperArm: aim(0.28, -0.67, 0.48),
      rightLowerArm: aim(0.13, -0.32, 0.94),
      leftUpperLeg: aim(0.14, -0.13, 0.98),
      rightUpperLeg: aim(0.1, -0.17, 0.97),
      leftLowerLeg: aim(0.06, -0.94, -0.33),
      rightLowerLeg: aim(0.04, -0.96, -0.27),
      leftFoot: rotate([d(-8), d(2), d(1)]),
      rightFoot: rotate([d(-7), d(-3), d(-1)]),
    }),
  },
  {
    id: "heroic",
    label: "영웅",
    tone: "영웅적 포즈",
    bones: naturalPose({
      hips: rotate([d(-2), d(-6), 0]),
      spine: rotate([d(-4), d(4), 0]),
      chest: rotate([d(-3), d(4), 0]),
      head: rotate([d(-4), d(-3), 0]),
      leftUpperArm: aim(0.45, -0.5, 0.15),
      leftLowerArm: aim(0.2, -0.92, 0.32),
      leftHand: rotate([0, 0, d(5)]),
      rightUpperArm: aim(0.6, 0.78, 0.1),
      rightLowerArm: aim(0.2, 0.96, 0.15),
      rightHand: rotate([0, 0, d(-5)]),
      leftUpperLeg: aim(0.12, -0.7, 0.7),
      rightUpperLeg: aim(0.05, -0.99, -0.1),
    }),
  },
  {
    id: "shy2",
    label: "수줍음",
    tone: "수줍은 자세",
    bones: naturalPose({
      hips: rotate([d(2), d(4), 0]),
      spine: rotate([d(3), d(-3), 0]),
      chest: rotate([d(2), d(-2), 0]),
      head: rotate([d(10), d(6), d(5)]),
      leftUpperArm: aim(-0.3, -0.55, 0.72),
      leftLowerArm: aim(-0.5, 0.2, 0.84),
      leftHand: rotate([d(5), 0, d(5)]),
      rightUpperArm: aim(-0.3, -0.55, 0.72),
      rightLowerArm: aim(-0.5, 0.2, 0.84),
      rightHand: rotate([d(5), 0, d(-5)]),
      leftUpperLeg: aim(0.15, -0.98, 0.1),
      rightUpperLeg: aim(0.05, -0.95, -0.3),
    }),
  },
  {
    id: "lean",
    label: "기대기",
    tone: "벽에 기대기",
    yOffset: -0.01,
    bones: naturalPose({
      hips: rotate([d(3), d(-5), d(-4)]),
      spine: rotate([d(-2), d(3), d(2)]),
      chest: rotate([d(-1), d(2), d(1)]),
      head: rotate([d(-3), d(-3), d(-2)]),
      leftUpperArm: aim(0.35, -0.94),
      rightUpperArm: aim(-0.2, -0.4, 0.5),
      rightLowerArm: aim(-0.6, 0.3, 0.72),
      rightHand: rotate([0, d(-10), d(-5)]),
      leftUpperLeg: aim(0.1, -0.85, 0.52),
      rightUpperLeg: aim(0.08, -0.92, -0.38),
      rightLowerLeg: aim(0.03, -0.88, -0.47),
    }),
  },
  {
    id: "crossArms",
    label: "팔짱",
    tone: "팔짱 끼기",
    bones: naturalPose({
      spine: rotate([d(-2), d(1), 0]),
      chest: rotate([d(-3), d(-1), 0]),
      head: rotate([d(-3), d(-2), d(1)]),
      leftUpperArm: aim(-0.52, -0.22, 0.52),
      leftLowerArm: aim(-0.85, 0.16, 0.42),
      leftHand: rotate([d(4), d(-9), d(9)]),
      rightUpperArm: aim(-0.58, -0.28, 0.44),
      rightLowerArm: aim(-0.9, 0.09, 0.34),
      rightHand: rotate([d(6), d(11), d(-7)]),
    }),
  },
  {
    id: "run2",
    label: "달리기",
    tone: "달리는 자세",
    yOffset: -0.02,
    bones: naturalPose({
      hips: rotate([d(-6), d(-5), 0]),
      spine: rotate([d(6), d(4), 0]),
      chest: rotate([d(-2), d(3), 0]),
      head: rotate([d(-3), d(-4), 0]),
      leftUpperArm: aim(0.3, -0.6, -0.72),
      leftLowerArm: aim(0.15, -0.7, -0.7),
      rightUpperArm: aim(0.3, -0.5, 0.8),
      rightLowerArm: aim(0.15, -0.6, 0.78),
      leftUpperLeg: aim(0.1, -0.35, 0.93),
      leftLowerLeg: aim(0.03, -0.82, 0.57),
      rightUpperLeg: aim(0.1, -0.6, -0.79),
      rightLowerLeg: aim(0.03, -0.88, 0.48),
    }),
  },
  {
    id: "jump",
    label: "점프",
    tone: "점프 자세",
    yOffset: 0.1,
    bones: naturalPose({
      hips: rotate([d(-8), 0, 0]),
      spine: rotate([d(-4), 0, 0]),
      chest: rotate([d(5), 0, 0]),
      head: rotate([d(-6), 0, 0]),
      leftUpperArm: aim(0.58, 0.8, 0.14),
      leftLowerArm: aim(0.27, 0.95, 0.1),
      rightUpperArm: aim(0.52, 0.84, 0.1),
      rightLowerArm: aim(0.23, 0.97, 0.06),
      leftUpperLeg: aim(0.12, -0.52, 0.85),
      leftLowerLeg: aim(0.06, -0.8, -0.59),
      rightUpperLeg: aim(0.09, -0.58, 0.81),
      rightLowerLeg: aim(0.04, -0.84, -0.55),
      leftFoot: rotate([d(-16), 0, d(1)]),
      rightFoot: rotate([d(-13), 0, d(-1)]),
    }),
  },
];

const LIMB_BONE_ORDER = [
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
] as const satisfies readonly VRMHumanBoneName[];
// 손가락 본(오일러 회전 전용) — 모델에 해당 본이 없으면 그대로 건너뛴다.
const FINGER_ROTATION_BONE_ORDER = [
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
] as const satisfies readonly VRMHumanBoneName[];
const FINGER_ROTATION_BONE_SET = new Set<VRMHumanBoneName>(FINGER_ROTATION_BONE_ORDER);
/**
 * Runtime pose application is deliberately derived from the same semantic allowlist used by the
 * portable pose-material boundary. Arbitrary object keys can therefore never address scene nodes,
 * while optional VRM bones (eyes, jaw, upper chest and toes included) are no longer dropped.
 */
export const STUDIO_VRM_APPLIED_HUMANOID_BONES = STUDIO_HUMANOID_BONE_NAMES;
const LIMB_BONE_SET = new Set<VRMHumanBoneName>(LIMB_BONE_ORDER);
const POST_DIRECTION_ROTATION_BONE_SET = new Set<VRMHumanBoneName>([
  "leftHand",
  "rightHand",
  "leftFoot",
  "leftToes",
  "rightFoot",
  "rightToes",
  ...FINGER_ROTATION_BONE_ORDER,
]);
const PRE_DIRECTION_ROTATION_BONE_ORDER = STUDIO_VRM_APPLIED_HUMANOID_BONES.filter(
  (boneName) =>
    !LIMB_BONE_SET.has(boneName) && !POST_DIRECTION_ROTATION_BONE_SET.has(boneName)
);
const POST_DIRECTION_ROTATION_BONE_ORDER = STUDIO_VRM_APPLIED_HUMANOID_BONES.filter(
  (boneName) => POST_DIRECTION_ROTATION_BONE_SET.has(boneName)
);
export const ZERO_ROTATION: Vec3 = [0, 0, 0];
const MIN_DIRECTION_LENGTH_SQ = 0.000001;

type LimbBoneName = (typeof LIMB_BONE_ORDER)[number];

const LIMB_CHILD_BONE: Record<LimbBoneName, VRMHumanBoneName> = {
  leftUpperArm: "leftLowerArm",
  rightUpperArm: "rightLowerArm",
  leftLowerArm: "leftHand",
  rightLowerArm: "rightHand",
  leftUpperLeg: "leftLowerLeg",
  rightUpperLeg: "rightLowerLeg",
  leftLowerLeg: "leftFoot",
  rightLowerLeg: "rightFoot",
};

function normalizeDirection(direction: THREE.Vector3) {
  const lengthSq = direction.lengthSq();
  if (lengthSq < MIN_DIRECTION_LENGTH_SQ) return false;
  direction.multiplyScalar(1 / Math.sqrt(lengthSq));
  return true;
}

export function getPoseBoneRotation(poseBone: PoseBone | undefined) {
  return poseBone?.rotation ?? ZERO_ROTATION;
}

function applyEulerRotation(humanoid: NonNullable<VRM["humanoid"]>, boneName: VRMHumanBoneName, rotation: Vec3) {
  const bone = humanoid.getNormalizedBoneNode(boneName);
  if (!bone) return;
  const order = boneName.includes("Hand") || boneName.includes("Arm") || boneName.includes("Finger") ? "YXZ" : "XYZ";
  bone.rotation.set(rotation[0], rotation[1], rotation[2], order);
  bone.updateMatrixWorld(true);
}

function getBoneWorldDirection(bone: THREE.Object3D, child: THREE.Object3D, out: THREE.Vector3) {
  const bonePosition = new THREE.Vector3();
  const childPosition = new THREE.Vector3();
  bone.getWorldPosition(bonePosition);
  child.getWorldPosition(childPosition);
  out.subVectors(childPosition, bonePosition);
  return normalizeDirection(out);
}

function isVec3Direction(target: DirectionTarget): target is Vec3 {
  return Array.isArray(target);
}

function resolveTargetWorldDirection(target: DirectionTarget, restWorldDirection: THREE.Vector3, out: THREE.Vector3) {
  if (isVec3Direction(target)) {
    out.set(target[0], target[1], target[2]);
  } else {
    const sideSign = Math.abs(restWorldDirection.x) > MIN_DIRECTION_LENGTH_SQ ? Math.sign(restWorldDirection.x) : 0;
    out.set(sideSign * target.sideX, target.y, target.z ?? 0);
  }

  return normalizeDirection(out);
}

function aimBoneToWorldDirection(humanoid: NonNullable<VRM["humanoid"]>, boneName: LimbBoneName, target: DirectionTarget) {
  const bone = humanoid.getNormalizedBoneNode(boneName);
  const child = humanoid.getNormalizedBoneNode(LIMB_CHILD_BONE[boneName]);
  if (!bone || !child) return;

  const restWorldDirection = new THREE.Vector3();
  if (!getBoneWorldDirection(bone, child, restWorldDirection)) return;

  const targetWorldDirection = new THREE.Vector3();
  if (!resolveTargetWorldDirection(target, restWorldDirection, targetWorldDirection)) return;

  const parentInverseWorldQuaternion = new THREE.Quaternion();
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentInverseWorldQuaternion).invert();
  } else {
    parentInverseWorldQuaternion.identity();
  }

  const restParentDirection = restWorldDirection.clone().applyQuaternion(parentInverseWorldQuaternion);
  const targetParentDirection = targetWorldDirection.clone().applyQuaternion(parentInverseWorldQuaternion);
  if (!normalizeDirection(restParentDirection) || !normalizeDirection(targetParentDirection)) return;

  const aimQuaternion = new THREE.Quaternion().setFromUnitVectors(restParentDirection, targetParentDirection);
  bone.quaternion.premultiply(aimQuaternion);
  bone.updateMatrixWorld(true);
}

/**
 * World-space palm normal (out of the palm face, not the dorsal/back).
 *
 * VRM left/right finger axes are mirrored: after limb aim, left hands need
 * along×across while right hands need across×along to point palm-out. A single
 * winding made one side look correct and the other look like a spun wrist.
 */
export function estimateVrmPalmNormal(vrm: VRM, side: "left" | "right"): THREE.Vector3 | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
  const middle = humanoid.getNormalizedBoneNode(`${side}MiddleProximal`);
  const thumb =
    humanoid.getNormalizedBoneNode(`${side}ThumbProximal`)
    ?? humanoid.getNormalizedBoneNode(`${side}ThumbMetacarpal`);
  if (!hand || !middle) return null;

  const handPos = new THREE.Vector3();
  const middlePos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  middle.getWorldPosition(middlePos);
  const along = middlePos.clone().sub(handPos);
  if (!normalizeDirection(along)) return null;

  const thumbPos = new THREE.Vector3();
  if (thumb) {
    thumb.getWorldPosition(thumbPos);
  } else {
    // Degenerate fallback: slight side offset so a normal still exists.
    thumbPos.copy(handPos).add(new THREE.Vector3(side === "left" ? -0.02 : 0.02, 0, 0));
  }
  const across = thumbPos.sub(handPos);
  if (!normalizeDirection(across)) return null;

  return palmNormalFromAlongAcross(along, across, side);
}

/** Side-aware palm-out normal from finger axes (see estimateVrmPalmNormal). */
function palmNormalFromAlongAcross(
  along: THREE.Vector3,
  across: THREE.Vector3,
  side: "left" | "right",
): THREE.Vector3 | null {
  const palm = side === "right"
    ? new THREE.Vector3().crossVectors(across, along)
    : new THREE.Vector3().crossVectors(along, across);
  return normalizeDirection(palm) ? palm : null;
}

/**
 * Limb aiming uses setFromUnitVectors, which leaves an uncontrolled twist around the bone axis.
 * Most bundled VRoids then show palms facing outward or camera-back after natural idle aims.
 * Lumi happened to residual-twist into a readable pose; others did not.
 *
 * For relaxed / hanging arms, twist each hand so the palm faces:
 *   medial (toward midline) + slightly down + slightly character-forward (+Z).
 * Raised arms (wave, fist) are skipped so expressive poses stay intact.
 *
 * Returns how many hands were corrected.
 */
export function correctVrmHangingHandPalmTwist(vrm: VRM): number {
  const humanoid = vrm.humanoid;
  if (!humanoid) return 0;

  let corrected = 0;
  for (const side of ["left", "right"] as const) {
    if (orientRelaxedHandPalm(humanoid, side)) corrected += 1;
  }
  if (corrected > 0) {
    // 트위스트는 normalized 손 본 quaternion을 직접 쓰므로 raw 스키튼에 즉시 동기화한다.
    // 이후 vrm.update()가 없는 경로(테스트·bg3d·저장 직전 스냅샷)에서도 결과가 보이게 한다.
    humanoid.update();
    vrm.scene.updateMatrixWorld(true);
  }
  return corrected;
}

/** Max forearm twist per pass (larger snaps read as a spun wrist). */
export const STUDIO_VRM_HANGING_PALM_TWIST_MAX_RAD = THREE.MathUtils.degToRad(34);
/** Fraction of remaining twist error applied each pass. */
export const STUDIO_VRM_HANGING_PALM_TWIST_BLEND = 0.62;
/** Max extra pitch used only to kill obvious palm-up residuals. */
export const STUDIO_VRM_HANGING_PALM_PITCH_MAX_RAD = THREE.MathUtils.degToRad(10);
/**
 * If palm already faces this far toward the body midline, skip forearm twist.
 * Natural idle with side-aware winding is often already ≥0.75 — twisting then
 * looks like the wrist was wrenched the wrong way.
 */
export const STUDIO_VRM_HANGING_PALM_ALREADY_MEDIAL = 0.34;

/**
 * Desired palm normal for a relaxed hand on a standing character facing +Z.
 * Pure "toward hips" pulls palms camera-back when hands sit in front of the torso.
 * Keep the target mild so the wrist only needs a small twist from limb-aim residual.
 */
export function desiredRelaxedPalmNormal(
  side: "left" | "right",
  handWorldPos: THREE.Vector3,
  spineWorldPos: THREE.Vector3,
): THREE.Vector3 {
  // Medial: left hand (+X) wants -X, right hand (-X) wants +X. Fall back to side label
  // when the hand sits near the midplane.
  const sideSign = Math.abs(handWorldPos.x) > 0.04
    ? Math.sign(handWorldPos.x)
    : (side === "left" ? 1 : -1);
  const medial = new THREE.Vector3(-sideSign, 0, 0);

  // Soft pull toward the torso (spine/chest) without letting a forward hand force -Z palms.
  const towardTorso = spineWorldPos.clone().sub(handWorldPos);
  if (normalizeDirection(towardTorso)) {
    towardTorso.x *= 0.4;
    towardTorso.y = Math.min(0, towardTorso.y) * 0.4;
    towardTorso.z = Math.max(0, towardTorso.z) * 0.12;
  } else {
    towardTorso.set(0, 0, 0);
  }

  // Mild down + mild forward — extreme targets force 100°+ twists that look like spun wrists.
  const desired = medial
    .multiplyScalar(0.72)
    .add(towardTorso)
    .add(new THREE.Vector3(0, -0.38, 0.32));
  if (!normalizeDirection(desired)) {
    return new THREE.Vector3(-sideSign, -0.38, 0.32).normalize();
  }
  return desired;
}

function measurePalmNormalFromBones(
  hand: THREE.Object3D,
  middle: THREE.Object3D,
  thumb: THREE.Object3D | null,
  side: "left" | "right",
): THREE.Vector3 | null {
  const handPos = new THREE.Vector3();
  const middlePos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  middle.getWorldPosition(middlePos);
  const along = middlePos.clone().sub(handPos);
  if (!normalizeDirection(along)) return null;
  const thumbPos = new THREE.Vector3();
  if (thumb) {
    thumb.getWorldPosition(thumbPos);
  } else {
    thumbPos.copy(handPos).add(new THREE.Vector3(side === "left" ? -0.02 : 0.02, 0, 0));
  }
  const across = thumbPos.sub(handPos);
  if (!normalizeDirection(across)) return null;
  return palmNormalFromAlongAcross(along, across, side);
}

function applyWorldTwistToHand(
  hand: THREE.Object3D,
  worldAxis: THREE.Vector3,
  angle: number,
): void {
  if (!hand.parent || !Number.isFinite(angle) || Math.abs(angle) < THREE.MathUtils.degToRad(1)) {
    return;
  }
  const parentWorldQ = new THREE.Quaternion();
  hand.parent.getWorldQuaternion(parentWorldQ);
  const handWorldQ = new THREE.Quaternion();
  hand.getWorldQuaternion(handWorldQ);
  const twist = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle);
  const newWorldQ = twist.clone().multiply(handWorldQ);
  hand.quaternion.copy(parentWorldQ.clone().invert().multiply(newWorldQ));
  hand.updateMatrixWorld(true);
}

function orientRelaxedHandPalm(
  humanoid: NonNullable<VRM["humanoid"]>,
  side: "left" | "right",
): boolean {
  const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
  const lowerArm = humanoid.getNormalizedBoneNode(`${side}LowerArm`);
  const middle = humanoid.getNormalizedBoneNode(`${side}MiddleProximal`);
  const thumb =
    humanoid.getNormalizedBoneNode(`${side}ThumbProximal`)
    ?? humanoid.getNormalizedBoneNode(`${side}ThumbMetacarpal`);
  const spine =
    humanoid.getNormalizedBoneNode("chest")
    ?? humanoid.getNormalizedBoneNode("spine")
    ?? humanoid.getNormalizedBoneNode("hips");
  if (!hand || !lowerArm || !middle || !spine || !hand.parent) return false;

  const handPos = new THREE.Vector3();
  const lowerPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  lowerArm.getWorldPosition(lowerPos);

  // Twist axis = forearm (lower arm → hand).
  const forearmAxis = handPos.clone().sub(lowerPos);
  if (!normalizeDirection(forearmAxis)) return false;
  // Skip clearly raised arms. Allow slight forward hang (natural idle often has z>0).
  if (forearmAxis.y > -0.15) return false;

  const palm = measurePalmNormalFromBones(hand, middle, thumb, side);
  if (!palm) return false;

  const spinePos = new THREE.Vector3();
  spine.getWorldPosition(spinePos);
  const desired = desiredRelaxedPalmNormal(side, handPos, spinePos);

  // Already facing the body? Do not twist — residual limb-aim + side-aware winding
  // is already medial for most bundled VRoids; further twist reads as a reversed wrist.
  const medialAxis = new THREE.Vector3(
    -(Math.abs(handPos.x) > 0.04 ? Math.sign(handPos.x) : (side === "left" ? 1 : -1)),
    0,
    0,
  );
  const medialScore = palm.dot(medialAxis);
  let changed = false;

  if (medialScore < STUDIO_VRM_HANGING_PALM_ALREADY_MEDIAL) {
    // Pass 1 — small partial forearm twist only when clearly non-medial.
    const palmProj = palm.clone().addScaledVector(forearmAxis, -palm.dot(forearmAxis));
    const desiredProj = desired.clone().addScaledVector(forearmAxis, -desired.dot(forearmAxis));
    if (normalizeDirection(palmProj) && normalizeDirection(desiredProj)) {
      const sin = forearmAxis.dot(new THREE.Vector3().crossVectors(palmProj, desiredProj));
      const cos = palmProj.dot(desiredProj);
      let angle = Math.atan2(sin, cos);
      if (Number.isFinite(angle)) {
        angle *= STUDIO_VRM_HANGING_PALM_TWIST_BLEND;
        angle = THREE.MathUtils.clamp(
          angle,
          -STUDIO_VRM_HANGING_PALM_TWIST_MAX_RAD,
          STUDIO_VRM_HANGING_PALM_TWIST_MAX_RAD,
        );
        if (Math.abs(angle) >= THREE.MathUtils.degToRad(1.5)) {
          applyWorldTwistToHand(hand, forearmAxis, angle);
          changed = true;
        }
      }
    }
  }

  // Pass 2 — only kill obvious palm-up (never chase deep thigh targets).
  const palmAfter = measurePalmNormalFromBones(hand, middle, thumb, side);
  if (!palmAfter) return changed;
  if (palmAfter.y > 0.18) {
    const worldDown = new THREE.Vector3(0, -1, 0);
    const pitchAxis = new THREE.Vector3().crossVectors(forearmAxis, worldDown);
    if (normalizeDirection(pitchAxis)) {
      const magnitude = THREE.MathUtils.clamp(
        (palmAfter.y - 0.08) * 0.85,
        THREE.MathUtils.degToRad(2),
        STUDIO_VRM_HANGING_PALM_PITCH_MAX_RAD,
      );
      const parentWorldQ = new THREE.Quaternion();
      hand.parent!.getWorldQuaternion(parentWorldQ);
      const baseLocal = hand.quaternion.clone();
      const handWorldQ = new THREE.Quaternion();
      hand.getWorldQuaternion(handWorldQ);
      let bestAngle = 0;
      let bestY = palmAfter.y;
      for (const sign of [1, -1] as const) {
        const trial = magnitude * sign;
        const twist = new THREE.Quaternion().setFromAxisAngle(pitchAxis, trial);
        const newWorldQ = twist.clone().multiply(handWorldQ);
        hand.quaternion.copy(parentWorldQ.clone().invert().multiply(newWorldQ));
        hand.updateMatrixWorld(true);
        const trialPalm = measurePalmNormalFromBones(hand, middle, thumb, side);
        const trialY = trialPalm?.y ?? Number.POSITIVE_INFINITY;
        const trialMedial = trialPalm ? trialPalm.dot(medialAxis) : -1;
        const baseMedial = palmAfter.dot(medialAxis);
        if (trialY < bestY - 0.02 && trialMedial > baseMedial - 0.12) {
          bestY = trialY;
          bestAngle = trial;
        }
        hand.quaternion.copy(baseLocal);
        hand.updateMatrixWorld(true);
      }
      if (bestAngle !== 0 && bestY < palmAfter.y - 0.02) {
        applyWorldTwistToHand(hand, pitchAxis, bestAngle);
        changed = true;
      }
    }
  }

  return changed;
}

const translatedBoneBasePositions = new WeakMap<THREE.Object3D, THREE.Vector3>();

function restoreTranslatedBoneBase(node: THREE.Object3D | null): void {
  if (!node) return;
  const existing = translatedBoneBasePositions.get(node);
  if (existing) {
    node.position.copy(existing);
    return;
  }
  translatedBoneBasePositions.set(node, node.position.clone());
}

function sceneLocalTranslationToBoneLocal(
  scene: THREE.Object3D,
  node: THREE.Object3D,
  translation: Vec3,
): THREE.Vector3 | null {
  const parent = node.parent;
  if (!parent) return null;
  scene.updateMatrixWorld(true);
  parent.updateMatrixWorld(true);
  const sceneOriginWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(scene.matrixWorld);
  const sceneEndpointWorld = new THREE.Vector3(...translation).applyMatrix4(scene.matrixWorld);
  const worldDelta = sceneEndpointWorld.sub(sceneOriginWorld);
  const parentInverse = parent.matrixWorld.clone().invert();
  const parentOrigin = new THREE.Vector3(0, 0, 0).applyMatrix4(parentInverse);
  const parentEndpoint = worldDelta.clone().applyMatrix4(parentInverse);
  const result = parentEndpoint.sub(parentOrigin);
  return [result.x, result.y, result.z].every(Number.isFinite) ? result : null;
}

function applyPoseTranslations(
  vrm: VRM,
  translations: StudioVrmPoseTranslations,
): boolean {
  const humanoid = vrm.humanoid;
  if (!humanoid) return false;
  const hips = humanoid.getNormalizedBoneNode("hips");
  const spine = humanoid.getNormalizedBoneNode("spine");
  const hasHipsTranslation = translations.hips.some((coordinate) => coordinate !== 0);
  const hasSpineTranslation = translations.spine.some((coordinate) => coordinate !== 0);
  if (hasHipsTranslation) {
    if (!hips) return false;
    const hipsLocal = sceneLocalTranslationToBoneLocal(vrm.scene, hips, translations.hips);
    if (!hipsLocal) return false;
    hips.position.add(hipsLocal);
    vrm.scene.updateMatrixWorld(true);
  }
  if (hasSpineTranslation) {
    if (!spine) return false;
    const spineLocal = sceneLocalTranslationToBoneLocal(vrm.scene, spine, translations.spine);
    if (!spineLocal) return false;
    spine.position.add(spineLocal);
    vrm.scene.updateMatrixWorld(true);
  }
  return true;
}

export function applyPoseToVrm(
  vrm: VRM,
  bones: PoseBoneMap,
  yOffset: number,
  rawTranslations: StudioVrmPoseTranslations = EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  options: { readonly skipPalmCorrect?: boolean } = {},
) {
  const humanoid = vrm.humanoid;
  if (!humanoid) return false;
  const translations = normalizeStudioVrmPoseTranslations(rawTranslations);
  if (!translations) return false;

  humanoid.resetNormalizedPose();
  const hips = humanoid.getNormalizedBoneNode("hips");
  const spine = humanoid.getNormalizedBoneNode("spine");
  restoreTranslatedBoneBase(hips);
  restoreTranslatedBoneBase(spine);
  vrm.scene.position.set(translations.root[0], yOffset, translations.root[2]);
  vrm.scene.updateMatrixWorld(true);

  PRE_DIRECTION_ROTATION_BONE_ORDER.forEach((boneName) => {
    const rotation = bones[boneName]?.rotation;
    if (rotation) {
      applyEulerRotation(humanoid, boneName, rotation);
    }
  });
  vrm.scene.updateMatrixWorld(true);

  LIMB_BONE_ORDER.forEach((boneName) => {
    const poseBone = bones[boneName];
    if (!poseBone) return;

    if (poseBone.direction) {
      aimBoneToWorldDirection(humanoid, boneName, poseBone.direction);
      return;
    }

    if (poseBone.rotation) {
      applyEulerRotation(humanoid, boneName, poseBone.rotation);
    }
  });

  POST_DIRECTION_ROTATION_BONE_ORDER.forEach((boneName) => {
    // Finger curls always go through applyFingerRotations so model-axis polarity can be fixed.
    if (FINGER_ROTATION_BONE_SET.has(boneName)) return;
    const rotation = bones[boneName]?.rotation;
    if (rotation) {
      applyEulerRotation(humanoid, boneName, rotation);
    }
  });

  // Optional finger eulers carried in the pose map (natural idle, extras) — polarity-aware.
  const fingerEdits: Partial<Record<VRMHumanBoneName, Vec3>> = {};
  for (const boneName of FINGER_ROTATION_BONE_ORDER) {
    const rotation = bones[boneName]?.rotation;
    if (rotation) fingerEdits[boneName] = rotation;
  }
  if (Object.keys(fingerEdits).length > 0) {
    applyFingerRotations(vrm, fingerEdits);
  }

  // One hanging-palm pass after limbs + hand euler + fingers (unless caller defers).
  // Stacking this with a second call after applyPoserVisualState fingers spun wrists.
  if (!options.skipPalmCorrect) {
    correctVrmHangingHandPalmTwist(vrm);
  }

  humanoid.update();
  if (!applyPoseTranslations(vrm, translations)) return false;
  humanoid.update();
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  return true;
}

export function applyExpressionWeightsToVrm(vrm: VRM, weights: Record<string, number>) {
  const expressionManager = vrm.expressionManager;
  if (!expressionManager) return false;

  expressionManager.resetValues();

  Object.entries(weights).forEach(([name, weight]) => {
    if (expressionManager.getExpression(name)) {
      expressionManager.setValue(name, weight);
    }
  });

  expressionManager.update();
  vrm.update(0);
  return true;
}

/** Mannequin clay gray — never cache as native albedo factor. */
export const STUDIO_VRM_MANNEQUIN_COLOR_HEX = "#b7b2a8" as const;

function colorHexLower(color: THREE.Color): string {
  return `#${color.getHexString().toLowerCase()}`;
}

export function isVrmMannequinPaintColor(color: THREE.Color): boolean {
  return colorHexLower(color) === STUDIO_VRM_MANNEQUIN_COLOR_HEX;
}

/** Near-black lit factors multiply texture albedo to pure black — refuse as "native". */
export function isVrmNearBlackLitColor(color: THREE.Color): boolean {
  return color.r <= 0.02 && color.g <= 0.02 && color.b <= 0.02;
}

/**
 * Map a single mesh/material name to a recolor slot.
 * Hair before bare "top" (Hair_Top); face before body/head; cloth before generic body.
 */
export function classifyVrmCustomColorPart(nameRaw: string): string | null {
  const name = nameRaw.toLowerCase();
  if (!name.trim()) return null;
  if (name.includes("hair") || name.includes("kami")) return "hair";
  if (
    name.includes("face")
    || name.includes("eye")
    || name.includes("mouth")
    || name.includes("brow")
    || name.includes("lash")
    || name.includes("tooth")
  ) {
    return "face";
  }
  // Clothing before body — VRoid bakes Tops/Bottoms materials onto a node named "Body".
  // Bottoms before generic "cloth" so names like Bottoms_01_CLOTH do not fall into tops.
  if (
    name.includes("bottoms")
    || name.includes("bottom")
    || name.includes("pants")
    || name.includes("skirt")
    || name.includes("shoes")
    || name.includes("boot")
    || name.includes("sock")
    || name.includes("acc")
  ) {
    return "bottoms";
  }
  if (
    name.includes("tops")
    || name.includes("clothes")
    || name.includes("cloth")
    || name.includes("shirt")
    || name.includes("jacket")
    || name.includes("coat")
    || name.includes("wear")
    || /(^|[^a-z])top([^a-z]|$)/.test(name)
  ) {
    return "tops";
  }
  if (
    name.includes("body")
    || name.includes("skin")
    || name.includes("hand")
    || name.includes("leg")
    || name.includes("arm")
    || name.includes("foot")
    || name.includes("head")
    || name.includes("neck")
    || name.includes("torso")
  ) {
    return "body";
  }
  return null;
}

/**
 * Prefer material name over mesh name so multi-material "Body" meshes (skin + tops + bottoms
 * + hair) recolor only the matching primitive, not the entire body as one slot.
 */
export function classifyVrmCustomColorPartForMaterial(
  meshName: string,
  materialName?: string | null,
): string | null {
  return classifyVrmCustomColorPart(materialName ?? "")
    ?? classifyVrmCustomColorPart(meshName);
}

function isActiveCustomColorHex(hex: string | undefined): hex is string {
  if (!hex || typeof hex !== "string") return false;
  const normalized = hex.trim().toLowerCase();
  return normalized !== "" && normalized !== "#ffffff" && normalized !== "#fff";
}

function isMToonOutlineMaterial(mat: THREE.Material & { isOutline?: boolean }): boolean {
  return mat.isOutline === true;
}

type VrmCustomColorReadableTexture = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  lowLuma: number;
  highLuma: number;
};

type VrmCustomColorTextureState = {
  originalMap: THREE.Texture;
  originalShadeMultiplyTexture: THREE.Texture | null | undefined;
  generatedMap: THREE.DataTexture;
  targetHex: string;
};

type VrmCustomColorTexturedMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  shadeMultiplyTexture?: THREE.Texture | null;
  userData: Record<string, unknown>;
};

const VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY = "__vrmCustomColorTextureState";
const VRM_CUSTOM_COLOR_TEXTURE_MAX_PIXELS = 4096 * 4096;
const vrmCustomColorTextureAnalysisCache = new WeakMap<
  THREE.Texture,
  VrmCustomColorReadableTexture | null
>();

function vrmCustomColorTextureLuma(r: number, g: number, b: number): number {
  return Math.round((54 * r + 183 * g + 19 * b) / 256);
}

function vrmCustomColorTexturePercentile(
  histogram: Uint32Array,
  visiblePixels: number,
  percentile: number,
): number {
  const target = Math.max(1, Math.ceil(visiblePixels * percentile));
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    accumulated += histogram[value] ?? 0;
    if (accumulated >= target) return value;
  }
  return 255;
}

function analyzeVrmCustomColorTexture(
  texture: THREE.Texture,
): VrmCustomColorReadableTexture | null {
  if (vrmCustomColorTextureAnalysisCache.has(texture)) {
    return vrmCustomColorTextureAnalysisCache.get(texture) ?? null;
  }

  const image = texture.image as {
    width?: unknown;
    height?: unknown;
    data?: unknown;
  } | null | undefined;
  const width = typeof image?.width === "number" ? Math.floor(image.width) : 0;
  const height = typeof image?.height === "number" ? Math.floor(image.height) : 0;
  const pixelCount = width * height;
  if (
    width <= 0
    || height <= 0
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > VRM_CUSTOM_COLOR_TEXTURE_MAX_PIXELS
  ) {
    vrmCustomColorTextureAnalysisCache.set(texture, null);
    return null;
  }

  let pixels: Uint8ClampedArray | null = null;
  if (
    (image?.data instanceof Uint8Array || image?.data instanceof Uint8ClampedArray)
    && image.data.byteLength === pixelCount * 4
    && texture.format === THREE.RGBAFormat
    && texture.type === THREE.UnsignedByteType
  ) {
    pixels = new Uint8ClampedArray(image.data.byteLength);
    pixels.set(image.data);
  } else if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(image as CanvasImageSource, 0, 0, width, height);
        const source = context.getImageData(0, 0, width, height).data;
        pixels = new Uint8ClampedArray(source.length);
        pixels.set(source);
      }
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      pixels = null;
    }
  }

  if (!pixels) {
    vrmCustomColorTextureAnalysisCache.set(texture, null);
    return null;
  }

  const histogram = new Uint32Array(256);
  let visiblePixels = 0;
  let lumaTotal = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < 16) continue;
    const luma = vrmCustomColorTextureLuma(
      pixels[offset] ?? 0,
      pixels[offset + 1] ?? 0,
      pixels[offset + 2] ?? 0,
    );
    histogram[luma] = (histogram[luma] ?? 0) + 1;
    lumaTotal += luma;
    visiblePixels += 1;
  }

  if (visiblePixels === 0) {
    vrmCustomColorTextureAnalysisCache.set(texture, null);
    return null;
  }

  const averageLuma = lumaTotal / visiblePixels;
  const highLuma = vrmCustomColorTexturePercentile(histogram, visiblePixels, 0.9);
  // Light albedo already accepts the normal material-color multiply path. Only synthesize
  // a replacement for dark maps where multiplication cannot reveal the requested hue.
  if (averageLuma > 82 || highLuma > 140) {
    vrmCustomColorTextureAnalysisCache.set(texture, null);
    return null;
  }

  const readable = {
    width,
    height,
    data: pixels,
    lowLuma: vrmCustomColorTexturePercentile(histogram, visiblePixels, 0.05),
    highLuma,
  };
  vrmCustomColorTextureAnalysisCache.set(texture, readable);
  return readable;
}

function parseVrmCustomColorRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function writeVrmCustomColorTexturePixels(
  target: Uint8Array,
  readable: VrmCustomColorReadableTexture,
  hex: string,
): boolean {
  const rgb = parseVrmCustomColorRgb(hex);
  if (!rgb || target.byteLength !== readable.data.byteLength) return false;
  const [targetR, targetG, targetB] = rgb;
  const span = Math.max(24, readable.highLuma - readable.lowLuma);
  for (let offset = 0; offset < readable.data.length; offset += 4) {
    const sourceR = readable.data[offset] ?? 0;
    const sourceG = readable.data[offset + 1] ?? 0;
    const sourceB = readable.data[offset + 2] ?? 0;
    const luma = vrmCustomColorTextureLuma(sourceR, sourceG, sourceB);
    const detail = THREE.MathUtils.clamp((luma - readable.lowLuma) / span, 0, 1);
    // Even a pure-black albedo receives 45% of the requested color, while native
    // highlights reach the full target. This preserves folds without black × tint collapse.
    const brightness = 0.45 + 0.55 * detail;
    target[offset] = Math.round(targetR * brightness);
    target[offset + 1] = Math.round(targetG * brightness);
    target[offset + 2] = Math.round(targetB * brightness);
    target[offset + 3] = readable.data[offset + 3] ?? 0;
  }
  return true;
}

function copyVrmCustomColorTextureSampling(
  source: THREE.Texture,
  target: THREE.DataTexture,
): void {
  if (source.matrixAutoUpdate) source.updateMatrix();
  target.mapping = source.mapping;
  target.channel = source.channel;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.colorSpace = source.colorSpace;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix);
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.unpackAlignment = source.unpackAlignment;
  target.flipY = source.flipY;
  target.name = source.name
    ? `${source.name} · Studio custom color`
    : "Studio VRM custom color";
}

function restoreVrmCustomColorTexture(material: VrmCustomColorTexturedMaterial): boolean {
  const state = material.userData[VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY] as
    | VrmCustomColorTextureState
    | undefined;
  if (!state) return false;
  if (material.map === state.generatedMap) material.map = state.originalMap;
  if (material.shadeMultiplyTexture === state.generatedMap) {
    material.shadeMultiplyTexture = state.originalShadeMultiplyTexture;
  }
  state.generatedMap.dispose();
  delete material.userData[VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY];
  material.needsUpdate = true;
  return true;
}

function applyVrmCustomColorTexture(
  material: VrmCustomColorTexturedMaterial,
  targetHex: string,
): boolean {
  let state = material.userData[VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY] as
    | VrmCustomColorTextureState
    | undefined;
  if (
    state
    && material.map !== state.generatedMap
    && material.map !== state.originalMap
  ) {
    state.generatedMap.dispose();
    delete material.userData[VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY];
    state = undefined;
  }

  const originalMap = state?.originalMap ?? material.map;
  if (!originalMap) {
    if (state) restoreVrmCustomColorTexture(material);
    return false;
  }
  const readable = analyzeVrmCustomColorTexture(originalMap);
  if (!readable) {
    if (state) restoreVrmCustomColorTexture(material);
    return false;
  }

  if (!state) {
    const data = new Uint8Array(readable.data.byteLength);
    const generatedMap = new THREE.DataTexture(
      data,
      readable.width,
      readable.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    copyVrmCustomColorTextureSampling(originalMap, generatedMap);
    state = {
      originalMap,
      originalShadeMultiplyTexture: material.shadeMultiplyTexture,
      generatedMap,
      targetHex: "",
    };
    material.userData[VRM_CUSTOM_COLOR_TEXTURE_STATE_KEY] = state;
  }

  if (state.targetHex !== targetHex) {
    const target = (state.generatedMap.image as { data: Uint8Array }).data;
    if (!writeVrmCustomColorTexturePixels(target, readable, targetHex)) {
      restoreVrmCustomColorTexture(material);
      return false;
    }
    state.targetHex = targetHex;
    state.generatedMap.needsUpdate = true;
  }
  material.map = state.generatedMap;
  if (state.originalShadeMultiplyTexture === state.originalMap) {
    material.shadeMultiplyTexture = state.generatedMap;
  }
  material.needsUpdate = true;
  return true;
}

export function scrubVrmMannequinColorCaches(vrm: VRM) {
  vrm.scene.traverse((obj) => {
    if (!(obj as Partial<THREE.Mesh>).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat?.userData) continue;
      mat.userData.__vrmMannequinActive = false;
      const original = mat.userData.__vrmCustomColorOriginal as THREE.Color | undefined;
      if (original && (isVrmMannequinPaintColor(original) || isVrmNearBlackLitColor(original))) {
        delete mat.userData.__vrmCustomColorOriginal;
        mat.userData.__vrmCustomColorApplied = false;
      }
    }
  });
}

/**
 * Safety net for "original clothes flash then pure black":
 * textured materials whose lit factor collapsed to near-black (color × map = black).
 * Skips mannequin paint, outline materials, and materials with an active custom recolor.
 * Returns how many materials were repaired.
 */
export function repairVrmTexturedNearBlackLitFactors(vrm: VRM): number {
  let repaired = 0;
  vrm.scene.traverse((obj) => {
    if (!(obj as Partial<THREE.Mesh>).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const colored = mat as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        isOutline?: boolean;
        userData: Record<string, unknown>;
      };
      if (!colored?.color || !colored.map) continue;
      if (colored.userData.__vrmMannequinActive === true) continue;
      if (isMToonOutlineMaterial(colored)) continue;
      if (colored.userData.__vrmCustomColorApplied === true) continue;
      if (colored.userData.__vrmCostumeRecolorApplied === true) continue;
      if (!isVrmNearBlackLitColor(colored.color) && !isVrmMannequinPaintColor(colored.color)) continue;
      colored.color.set("#ffffff");
      colored.needsUpdate = true;
      if (colored.userData.__vrmCustomColorOriginal) {
        delete colored.userData.__vrmCustomColorOriginal;
      }
      repaired += 1;
    }
  });
  return repaired;
}

/**
 * Recolor VRM mesh slots without destroying native albedo.
 * - Classify per material (VRoid Body mesh holds skin+tops+bottoms together).
 * - No active custom hex → leave materials alone (textures + lit factor).
 * - Never cache mannequin clay or near-black as "native" (black × texture = pure black clothes).
 * - After idle pass, repair any textured near-black lit factors left by races.
 */
export function applyVrmCustomColors(vrm: VRM, customColors: Record<string, string>) {
  vrm.scene.traverse((obj) => {
    if (!(obj as Partial<THREE.Mesh>).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    materials.forEach((mat) => {
      const colored = mat as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        isOutline?: boolean;
        name?: string;
        userData: Record<string, unknown>;
      };
      if (!colored.color) return;
      if (colored.userData.__vrmMannequinActive === true) return;
      // Outline pass materials must keep their own factors — recoloring them blacks silhouettes.
      if (isMToonOutlineMaterial(colored)) return;

      const part = classifyVrmCustomColorPartForMaterial(mesh.name, colored.name);
      const customHex = part ? customColors[part] : undefined;
      const hasCustom = isActiveCustomColorHex(customHex);
      let original = colored.userData.__vrmCustomColorOriginal as THREE.Color | undefined;

      if (original && (isVrmMannequinPaintColor(original) || isVrmNearBlackLitColor(original))) {
        delete colored.userData.__vrmCustomColorOriginal;
        colored.userData.__vrmCustomColorApplied = false;
        original = undefined;
      }

      if (hasCustom) {
        if (!original) {
          if (isVrmMannequinPaintColor(colored.color) || isVrmNearBlackLitColor(colored.color)) {
            // Prefer white lit factor so textured clothing keeps albedo under a tint.
            original = new THREE.Color("#ffffff");
          } else {
            original = colored.color.clone();
          }
          colored.userData.__vrmCustomColorOriginal = original;
        }
        const textureColorApplied = applyVrmCustomColorTexture(colored, customHex);
        colored.color.set(textureColorApplied ? "#ffffff" : customHex);
        colored.needsUpdate = true;
        colored.userData.__vrmCustomColorApplied = true;
        return;
      }

      restoreVrmCustomColorTexture(colored);
      if (colored.userData.__vrmCustomColorApplied === true && original) {
        colored.color.copy(original);
        colored.needsUpdate = true;
        colored.userData.__vrmCustomColorApplied = false;
      }
    });
  });

  // Heal textured clothes that collapsed to pure black lit×map.
  // Skip only materials that are actively custom-repainted or costume-repainted; leave
  // other slots visible for near-black map lighting artifacts.
  repairVrmTexturedNearBlackLitFactors(vrm);
}

// ── 재질 효과(MToon 셰이딩/외곽선/림라이트) ─────────────────────────────

export type VrmMaterialFx = {
  shadeColor: string | null; // shadeColorFactor — 그림자(셰이딩) 색, 베이스 색과 별개
  outlineColor: string | null; // outlineColorFactor — 외곽선/선화 색
  rimColor: string | null; // parametricRimColorFactor — 림 라이트(윤곽 발광) 색
  rimIntensity: number; // rimLightingMixFactor 0-1 — rimColor 없이 세팅해도 안 보이므로 페어드 슬라이더 필수
  emissiveColor: string | null; // emissive — 발광 색(야광/네온 연출)
  emissiveIntensity: number; // emissiveIntensity 0-1
};

export const DEFAULT_VRM_MATERIAL_FX: VrmMaterialFx = {
  shadeColor: null,
  outlineColor: null,
  rimColor: null,
  rimIntensity: 0,
  emissiveColor: null,
  emissiveIntensity: 0,
};

// MToonMaterial은 트랜지티브 의존성(@pixiv/three-vrm-materials-mtoon이 package.json 직접 의존성이
// 아님)이라 패키지를 import하지 않고 구조적으로 타이핑한다 — applyVrmCustomColors의
// `mat as THREE.Material & { color?: THREE.Color }` 패턴과 동일.
//
// 유니폼 이름은 WebGL `MToonMaterial` 과 WebGPU `MToonNodeMaterial` 이 동일하므로 아래 본문은
// 두 구현에 그대로 적용된다. 다른 건 브랜드 플래그뿐이라 판정만 공용 술어에 위임한다.
interface MToonUniformMaterial extends StudioVrmMtoonBrand {
  shadeColorFactor?: THREE.Color;
  outlineColorFactor?: THREE.Color;
  parametricRimColorFactor?: THREE.Color;
  rimLightingMixFactor?: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
}

/** VRM 씬에 MToon 재질이 하나라도 있는지 — 재질 효과 섹션의 표시 가드에 쓰인다. */
export function hasVrmMToonMaterial(vrm: VRM): boolean {
  let found = false;
  vrm.scene.traverse((obj) => {
    if (found || !(obj as Partial<THREE.Mesh>).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((m) => isStudioVrmMtoonMaterial(m as MToonUniformMaterial | undefined))) {
      found = true;
    }
  });
  return found;
}

interface VrmMaterialFxOriginal {
  shadeColor?: THREE.Color;
  outlineColor?: THREE.Color;
  rimColor?: THREE.Color;
  rimIntensity?: number;
  emissiveColor?: THREE.Color;
  emissiveIntensity?: number;
}

/**
 * MToon 재질의 그림자·외곽선·림라이트·발광 색/강도 유니폼을 적용한다.
 * 표준 재질(MeshStandardMaterial 등)에는 해당 유니폼이 없어 자동으로 건너뛴다.
 * 정점/지오메트리는 절대 건드리지 않는다 — 재질 색상 유니폼만 갱신.
 *
 * fx 필드가 꺼지면(falsy) 단순히 아무 일도 안 하면 이전에 적용해 둔 색이 그대로 남아 "끄기"/
 * "초기화" 버튼이 시각적으로 무효과가 된다 — 그래서 재질(mat.userData)에 원본 유니폼 값을 최초
 * 1회만 캐시해 두고, 필드가 꺼진 경우 그 원본으로 되돌린다.
 */
export function applyVrmMaterialFx(vrm: VRM, fx: VrmMaterialFx) {
  vrm.scene.traverse((obj) => {
    if (!(obj as Partial<THREE.Mesh>).isMesh) return;
    const mesh = obj as THREE.Mesh;
    // 눈/얼굴 하이라이트 텍스처가 emissive를 쓰는 모델이 많아, 발광색만은 보호 카테고리를 피한다
    // (studio-vrm-costume의 protected 판정 재사용 — 의상 보호 로직과 동일한 안전장치).
    const { protected: guard } = classifyMeshName(mesh.name);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    materials.forEach((m) => {
      const mat = m as THREE.Material & MToonUniformMaterial & { userData: Record<string, unknown> };
      // MToon 전용 유니폼 — 표준 재질(MeshStandardMaterial 등)엔 없다. WebGPU 노드 포트도 같은
      // 유니폼을 갖지만 브랜드 플래그가 달라, 여기서 놓치면 캐릭터가 오류 없이 무보정으로 남는다.
      if (!isStudioVrmMtoonMaterial(mat)) return;

      let original = mat.userData.__vrmMaterialFxOriginal as VrmMaterialFxOriginal | undefined;
      if (!original) {
        original = {
          shadeColor: mat.shadeColorFactor?.clone(),
          outlineColor: mat.outlineColorFactor?.clone(),
          rimColor: mat.parametricRimColorFactor?.clone(),
          rimIntensity: mat.rimLightingMixFactor,
          emissiveColor: mat.emissive?.clone(),
          emissiveIntensity: mat.emissiveIntensity,
        };
        mat.userData.__vrmMaterialFxOriginal = original;
      }

      if (fx.shadeColor) mat.shadeColorFactor?.set(fx.shadeColor);
      else if (original.shadeColor) mat.shadeColorFactor?.copy(original.shadeColor);

      if (fx.outlineColor) mat.outlineColorFactor?.set(fx.outlineColor);
      else if (original.outlineColor) mat.outlineColorFactor?.copy(original.outlineColor);

      if (fx.rimColor) {
        mat.parametricRimColorFactor?.set(fx.rimColor);
        mat.rimLightingMixFactor = fx.rimIntensity;
      } else {
        if (original.rimColor) mat.parametricRimColorFactor?.copy(original.rimColor);
        if (original.rimIntensity !== undefined) mat.rimLightingMixFactor = original.rimIntensity;
      }

      if (guard !== "eye" && guard !== "face") {
        if (fx.emissiveColor) {
          mat.emissive?.set(fx.emissiveColor);
          mat.emissiveIntensity = fx.emissiveIntensity;
        } else {
          if (original.emissiveColor) mat.emissive?.copy(original.emissiveColor);
          if (original.emissiveIntensity !== undefined) mat.emissiveIntensity = original.emissiveIntensity;
        }
      }
      mat.needsUpdate = true;
    });
  });
}

// ── 신규 순수 헬퍼: finger / bodyScale / lighting / full state ─────────────

export type FingerRotationMap = Partial<Record<VRMHumanBoneName, Vec3>>;

function middleTipPalmDot(vrm: VRM, side: "left" | "right"): number | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
  const tip =
    humanoid.getNormalizedBoneNode(`${side}MiddleDistal`)
    ?? humanoid.getNormalizedBoneNode(`${side}MiddleProximal`);
  if (!hand || !tip) return null;
  const palm = estimateVrmPalmNormal(vrm, side);
  if (!palm) return null;
  const tipDir = tip.getWorldPosition(new THREE.Vector3())
    .sub(hand.getWorldPosition(new THREE.Vector3()));
  if (!normalizeDirection(tipDir)) return null;
  return tipDir.dot(palm);
}

function zeroFingerSide(
  humanoid: NonNullable<VRM["humanoid"]>,
  side: "left" | "right",
): void {
  for (const boneName of FINGER_ROTATION_BONE_ORDER) {
    if (!String(boneName).startsWith(side)) continue;
    const node = humanoid.getNormalizedBoneNode(boneName);
    if (node) node.rotation.set(0, 0, 0);
  }
}

function applyFingerSide(
  humanoid: NonNullable<VRM["humanoid"]>,
  fingers: FingerRotationMap,
  side: "left" | "right",
  curlPolarity: 1 | -1,
  adductPolarity: 1 | -1,
): void {
  for (const boneName of FINGER_ROTATION_BONE_ORDER) {
    if (!String(boneName).startsWith(side)) continue;
    const rot = fingers[boneName];
    if (!rot) continue;
    applyEulerRotation(humanoid, boneName, [
      curlPolarity * rot[0],
      adductPolarity * rot[1],
      curlPolarity * rot[2],
    ]);
  }
}

/**
 * Some bundled VRM rest axes (notably sample.vrm / 루미) mirror finger local Z relative to
 * typical VRoid samples. After the body/palm pose is live, pick the curl polarity that moves
 * the middle fingertip toward the palm (−palm normal), not into hyperextension.
 *
 * 극성은 모델의 정규화 본 축이 고정한 정적 성질이다. 프로브는 살아있는 포즈로 측정하므로
 * 임계값 근처에서 적용마다 결과가 뒤집히면 손가락이 접힘↔과신전 사이를 튀는 불안정이
 * 그대로 화면에 나타난다. 첫 명확한 측정만 휴머노이드 인스턴스에 캐시해 이후 적용은
 * 재측정 없이 재사용한다(휴머노이드 재구축 시 새 인스턴스라 자동 무효화).
 */
/**
 * 축별 해석 결과만 담는다(미해석 축은 undefined). 기본값으로 채우면 다른 프로브가
 * 만든 엔트리의 미해석 필드를 "해석됨"으로 잘못 보고 스킵하게 된다.
 */
type FingerAxisPolarityEntry = Partial<Record<"curl" | "adduct", 1 | -1>>;

const fingerAxisPolarityCache = new WeakMap<
  NonNullable<VRM["humanoid"]>,
  Partial<Record<"left" | "right", FingerAxisPolarityEntry>>
>();

/** 이 값보다 작은 판별 신호는 모호한 것으로 보고 캐시하지 않는다. */
export const STUDIO_VRM_FINGER_CURL_POLARITY_MARGIN = 0.04;
/** 내전(Y) 판별에 쓰는 최소 손끝 간격 변화(m). 그 아래는 축 판별이 모호하다. */
export const STUDIO_VRM_FINGER_ADDUCT_POLARITY_MARGIN = 0.0015;

function cachedFingerAxisPolarity(
  humanoid: NonNullable<VRM["humanoid"]>,
  side: "left" | "right",
): FingerAxisPolarityEntry | undefined {
  return fingerAxisPolarityCache.get(humanoid)?.[side];
}

function storeFingerAxisPolarity(
  humanoid: NonNullable<VRM["humanoid"]>,
  side: "left" | "right",
  patch: FingerAxisPolarityEntry,
): void {
  let cache = fingerAxisPolarityCache.get(humanoid);
  if (!cache) {
    cache = {};
    fingerAxisPolarityCache.set(humanoid, cache);
  }
  cache[side] = { ...cache[side], ...patch };
}

/** proportion 리그 재구축 등 모델 축 가정이 깨졌을 때 명시적으로 캐시를 버린다. */
export function invalidateVrmFingerCurlPolarityCache(vrm: VRM): void {
  const humanoid = vrm.humanoid;
  if (humanoid) fingerAxisPolarityCache.delete(humanoid);
}

export function resolveFingerCurlPolarity(
  vrm: VRM,
  fingers: FingerRotationMap,
  side: "left" | "right",
): 1 | -1 {
  const humanoid = vrm.humanoid;
  if (!humanoid) return 1;
  const hasSide = FINGER_ROTATION_BONE_ORDER.some(
    (boneName) => String(boneName).startsWith(side) && fingers[boneName],
  );
  if (!hasSide) return 1;

  const cached = cachedFingerAxisPolarity(humanoid, side)?.curl;
  if (cached !== undefined) return cached;

  zeroFingerSide(humanoid, side);
  humanoid.update();
  vrm.scene.updateMatrixWorld(true);
  const baseline = middleTipPalmDot(vrm, side);
  if (baseline === null) return 1;

  applyFingerSide(humanoid, fingers, side, 1, 1);
  humanoid.update();
  vrm.scene.updateMatrixWorld(true);
  const positive = middleTipPalmDot(vrm, side);
  if (positive === null) return 1;

  // Prefer the polarity that decreases tip·palm (curl into the palm surface).
  // If +1 makes the tip more palm-normal-aligned, the axes are inverted → use -1.
  const delta = positive - baseline;
  const polarity: 1 | -1 = delta > 0 ? -1 : 1;
  if (Math.abs(delta) > STUDIO_VRM_FINGER_CURL_POLARITY_MARGIN) {
    storeFingerAxisPolarity(humanoid, side, { curl: polarity });
  }
  return polarity;
}

/**
 * 손가락 로컬 Y(내전/모음) 축도 모델마다 방향이 다르다. 루미(sample.vrm)는 Z만 반전되어
 * 컬 극성(-1)을 Y에도 곱하면 오히려 검지·새끼가 부채처럼 벌어졌다. 검지↔새끼 손끝 거리가
 * 줄어드는 부호를 실측해 독립적으로 고른다. 팁 간 거리는 강체 변환에 불변이므로 어떤
 * 포즈에서 측정해도 같은 부호가 나온다.
 */
export function resolveFingerAdductPolarity(
  vrm: VRM,
  fingers: FingerRotationMap,
  side: "left" | "right",
): 1 | -1 {
  const humanoid = vrm.humanoid;
  if (!humanoid) return 1;
  const hasSide = FINGER_ROTATION_BONE_ORDER.some(
    (boneName) => String(boneName).startsWith(side) && fingers[boneName],
  );
  if (!hasSide) return 1;

  const cached = cachedFingerAxisPolarity(humanoid, side)?.adduct;
  if (cached !== undefined) return cached;

  const spanOf = (): number | null => {
    humanoid.update();
    vrm.scene.updateMatrixWorld(true);
    const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
    const index =
      humanoid.getNormalizedBoneNode(`${side}IndexDistal`)
      ?? humanoid.getNormalizedBoneNode(`${side}IndexIntermediate`)
      ?? humanoid.getNormalizedBoneNode(`${side}IndexProximal`);
    const little =
      humanoid.getNormalizedBoneNode(`${side}LittleDistal`)
      ?? humanoid.getNormalizedBoneNode(`${side}LittleIntermediate`)
      ?? humanoid.getNormalizedBoneNode(`${side}LittleProximal`);
    if (!hand || !index || !little) return null;
    const a = index.getWorldPosition(new THREE.Vector3());
    const b = little.getWorldPosition(new THREE.Vector3());
    const span = a.distanceTo(b);
    // three MathUtils에는 EPSILON이 없다 — 비영속 길이 가드는 표준 Number.EPSILON으로.
    return Number.isFinite(span) && span > Number.EPSILON ? span : null;
  };

  // Y-only 트라이: 컬(Z)과 무관하게 내전 기여만 분리해 측정한다.
  const applyYOnly = (polarity: 1 | -1) => {
    for (const boneName of FINGER_ROTATION_BONE_ORDER) {
      if (!String(boneName).startsWith(side)) continue;
      const rot = fingers[boneName];
      const node = humanoid.getNormalizedBoneNode(boneName);
      if (!rot || !node) continue;
      node.rotation.set(0, polarity * rot[1], 0, "YXZ");
    }
  };

  zeroFingerSide(humanoid, side);
  const baseline = spanOf();
  if (baseline === null) return 1;

  applyYOnly(1);
  const positiveSpan = spanOf();
  zeroFingerSide(humanoid, side);
  applyYOnly(-1);
  const negativeSpan = spanOf();
  zeroFingerSide(humanoid, side);
  if (positiveSpan === null || negativeSpan === null) return 1;

  const positiveDelta = positiveSpan - baseline;
  const negativeDelta = negativeSpan - baseline;
  const best = Math.min(positiveDelta, negativeDelta);
  // 어느 쪽도 유의미하게 모으지 못하면(내전 값이 없거나 축이 직교) 부호를 바꾸지 않는다.
  const polarity: 1 | -1 = negativeDelta < positiveDelta ? -1 : 1;
  if (best < -STUDIO_VRM_FINGER_ADDUCT_POLARITY_MARGIN) {
    storeFingerAxisPolarity(humanoid, side, { adduct: polarity });
  }
  return polarity;
}

function fingerMapSides(fingers: FingerRotationMap): Array<"left" | "right"> {
  const sides: Array<"left" | "right"> = [];
  for (const side of ["left", "right"] as const) {
    if (
      FINGER_ROTATION_BONE_ORDER.some(
        (boneName) => String(boneName).startsWith(side) && fingers[boneName],
      )
    ) {
      sides.push(side);
    }
  }
  return sides;
}

export function applyFingerRotations(vrm: VRM, fingers: FingerRotationMap) {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;
  // 맵에 없는 반대손은 건드리지 않는다. 한 손만 오버라이드할 때(자동그립·게임 제스처)
  // 다른 손의 이미 적용된 손가락 포즈가 0으로 초기화되어 펴지는 버그의 원인이었다.
  const sides = fingerMapSides(fingers);
  if (sides.length === 0) return;

  // Body/palm pose must already be on the skeleton (applyPoseToVrm first).
  vrm.scene.updateMatrixWorld(true);
  const polarities = sides.map((side) => ({
    curl: resolveFingerCurlPolarity(vrm, fingers, side),
    adduct: resolveFingerAdductPolarity(vrm, fingers, side),
  }));

  // resolve* leaves each probed side at its trial pose; re-apply with chosen polarities.
  for (const side of sides) zeroFingerSide(humanoid, side);
  sides.forEach((side, index) => {
    applyFingerSide(humanoid, fingers, side, polarities[index].curl, polarities[index].adduct);
  });
  humanoid.update();
  vrm.scene.updateMatrixWorld(true);
}

/** 접점 정련 대상 그립 하나. socketWorldPoint는 실측 palm socket의 world 좌표다. */
export interface VrmGripContactTarget {
  side: "left" | "right";
  /** 소품 anchor가 도달하는 접점(= palm socket world). */
  socketWorldPoint: THREE.Vector3;
  /** 그립 반경(m). 손끝이 이 배수 안으로 닿도록 컬을 증폭한다. */
  gripRadius: number;
  /**
   * 그립 종류별 목표 보정(m). cylinder/handle은 0, flat/support처럼 얹히는 소품은
   * 손가락을 감지 않고 받치므로 목표를 느슨하게 하려면 양수를 준다.
   */
  goalBias?: number;
}

const GRIP_WRAP_FINGERS = ["Index", "Middle", "Ring"] as const;

/** 세 손가락 중 가장 멀리 있는 관절 원점 거리 — 전지가 접점에 닿아야 목표를 통과한다. */
function gripWrapDistance(
  vrm: VRM,
  side: "left" | "right",
  target: THREE.Vector3,
): number | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  let farthest: number | null = null;
  for (const fingerName of GRIP_WRAP_FINGERS) {
    const node =
      humanoid.getNormalizedBoneNode(`${side}${fingerName}Distal` as never)
      ?? humanoid.getNormalizedBoneNode(`${side}${fingerName}Intermediate` as never);
    if (!node) continue;
    const distance = node.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    farthest = farthest === null ? distance : Math.max(farthest, distance);
  }
  return farthest;
}

/**
 * 자동그립 컬이 모델 손 크기에 비해 얕으면 손끝이 소품에 닿지 않는다(실측: 44° 컬로
 * 손끝-접점 6.2cm). 적용된 손가락 Z컬을 접점까지 실제로 감싸도 증폭한다 — 부호 규약과
 * 무관하게 "현재 적용값"을 키우므로 모델별 축 반전에도 안전하다. 상태 변경 시 1회 호출.
 */
export function refineVrmGripFingerWrap(
  vrm: VRM,
  targets: readonly VrmGripContactTarget[],
  options: { readonly maxPasses?: number } = {},
): void {
  const humanoid = vrm.humanoid;
  if (!humanoid || targets.length === 0) return;

  const maxPasses = Math.max(1, Math.min(6, options.maxPasses ?? 4));
  for (const target of targets) {
    const { side, socketWorldPoint, gripRadius } = target;
    if (!Number.isFinite(gripRadius) || gripRadius <= 0) continue;
        // 측정점은 distal 관절 원점이다 — 완전히 감아도 손바닥 중심에서 ~3.8cm 떨어진다.
    // (미감지 상태 ~6.2cm와 구분되는 지점에서 멈춰 과감아·관절 포화를 방지한다.)
    const reachGoal = gripRadius * 2.2 + 0.030 + Math.max(0, target.goalBias ?? 0);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      vrm.scene.updateMatrixWorld(true);
      const distance = gripWrapDistance(vrm, side, socketWorldPoint);
      if (distance === null || distance <= reachGoal) break;

      // 접점에 가까워지는 동안에만 증폭한다. 개선이 멈추면(관절 한계 도달) 중단.
      const before = distance;
      let touched = false;
      for (const fingerName of GRIP_WRAP_FINGERS) {
        for (const segment of ["Proximal", "Intermediate", "Distal"] as const) {
          const node = humanoid.getNormalizedBoneNode(`${side}${fingerName}${segment}` as never);
          if (!node) continue;
          const z = node.rotation.z;
          if (!Number.isFinite(z) || Math.abs(z) < 1e-4) continue;
          node.rotation.z = THREE.MathUtils.clamp(
            z * 1.42,
            -Math.PI / 2 + 0.02,
            Math.PI / 2 - 0.02,
          );
          touched = true;
        }
      }
      if (!touched) break;
      humanoid.update();
      vrm.scene.updateMatrixWorld(true);
      const after = gripWrapDistance(vrm, side, socketWorldPoint);
      if (after === null || after > before - 0.0006) break;
    }
  }
}

export type BodyScale = {
  height: number; // 0.7 ~ 1.4
  width: number; // 0.7 ~ 1.3
};

export function applyBodyScale(vrm: VRM, scale: BodyScale) {
  const s = Math.max(0.5, Math.min(1.6, scale.height || 1));
  const w = Math.max(0.5, Math.min(1.6, scale.width || 1));
  const sc = (vrm.scene as any).scale; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (sc && typeof sc.set === "function") sc.set(w, s, w);
  vrm.scene.updateMatrixWorld(true);
}

export type LightingParams = {
  intensity: number; // 0.2~3
  colorTemp: number; // 0=cool blue ~1=warm orange
  directionDeg: number; // azimuth
};

export function computeLightingUniforms(params: LightingParams) {
  const i = Math.max(0.1, Math.min(4, params.intensity ?? 1));
  const t = Math.max(0, Math.min(1, params.colorTemp ?? 0.5));
  const dir = (params.directionDeg ?? 45) * (Math.PI / 180);
  // simple: cool (high blue) to warm (high red/yellow)
  const r = 1.0 - t * 0.3;
  const g = 0.95 - t * 0.15;
  const b = 0.85 + t * 0.1;
  return {
    intensity: i,
    color: [r, g, b] as const,
    dir: { x: Math.cos(dir), y: -0.6, z: Math.sin(dir) },
  };
}

export type EnvVariant = "none" | "floor" | "wall" | "room" | "outdoor";

export type FullVrmState = {
  version: 3;
  /**
   * 이 상태를 캡처한 VRM 라이브러리 엔트리. 저장 상태의 명시적 모델 간 이식은 허용하지만,
   * 편집 undo/redo는 이 소유권이 현재 모델과 일치할 때만 복원한다.
   */
  modelId?: string;
  poseId?: string;
  bones: PoseBoneMap;
  yOffset: number;
  /** Canonical v3 root/hips/spine translation state; absent v2 payloads migrate to zero. */
  poseTranslations: StudioVrmPoseTranslations;
  /** Canonical scene-local persistent hand/foot targets; absent v2 payloads migrate to empty. */
  ikConstraints: readonly StudioVrmIkConstraint[];
  /** 캐릭터 루트의 사용자 Y축 회전(라디안, -PI~PI). */
  bodyRotation: number;
  expressionId?: string;
  expressionWeights?: Record<string, number>;
  costume?: unknown;
  /** 실장착 워드로브(studio-vrm-wardrobe SerializedWardrobe) — 옵셔널 하위호환. */
  wardrobe?: unknown;
  props?: unknown;
  /** 캐릭터 주변 월드/본 배치 동물·이펙트 상태. */
  sceneProps?: unknown;
  physics?: unknown;
  bodyScale?: BodyScale;
  lighting?: LightingParams;
  /** 카메라와 별개인 장면 조명 프리셋. 구버전 저장본은 morning으로 이행한다. */
  lightingTone?: StudioVrmLightingTone;
  env?: EnvVariant;
  fingerOverrides?: FingerRotationMap;
  materialFx?: VrmMaterialFx;
  /** VRoid형 비파괴 얼굴·헤어·체형 조형 상태. 구버전 저장본과 호환되는 선택 필드. */
  avatarForge?: unknown;
  /** 원본 VRM의 머리·피부·의상 재질에 적용한 비파괴 색상 오버라이드. */
  customColors?: Record<string, string>;
};

/** Historical v2 payloads are accepted at read boundaries and promoted by serializeFullVrmState. */
export type FullVrmStateInput = Partial<Omit<FullVrmState, "version" | "ikConstraints">> & {
  version: 2 | 3;
  ikConstraints?: unknown;
};

const MAX_VRM_MODEL_ID_LENGTH = 256;
const MAX_VRM_STATE_TEXT_LENGTH = 256;
const MAX_VRM_RUNTIME_NUMBER = 10_000;
const MAX_VRM_RUNTIME_DATA_DEPTH = 16;
const MAX_VRM_RUNTIME_DATA_NODES = 8_192;
const MAX_VRM_RUNTIME_ARRAY_ITEMS = 1_024;
const MAX_VRM_RUNTIME_OBJECT_KEYS = 1_024;
const MAX_VRM_RUNTIME_STRING_LENGTH = 1_024;
const SAFE_VRM_RUNTIME_KEY_PATTERN = /^[\p{L}\p{N}_. :/@+-]{1,64}$/u;
const CSS_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FORBIDDEN_VRM_RUNTIME_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FINGER_BONE_SET = new Set<string>(POSER_FINGER_BONES);
const FULL_VRM_LIGHTING_TONE_SET = new Set<string>(STUDIO_VRM_LIGHTING_TONES);
const FULL_VRM_STATE_KEYS = new Set([
  "version",
  "modelId",
  "poseId",
  "bones",
  "yOffset",
  "poseTranslations",
  "ikConstraints",
  "bodyRotation",
  "expressionId",
  "expressionWeights",
  "costume",
  "wardrobe",
  "props",
  "sceneProps",
  "physics",
  "bodyScale",
  "lighting",
  "lightingTone",
  "env",
  "fingerOverrides",
  "materialFx",
  "avatarForge",
  "customColors",
]);
const FULL_VRM_FRAGMENT_KEYS = new Set([
  ...FULL_VRM_STATE_KEYS,
  "tool",
  "modelName",
  "vrmProps",
]);

function isFullVrmStateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFullVrmKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteFullVrmNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isStrictFullVrmVec3(value: unknown, maxAbs = MAX_VRM_RUNTIME_NUMBER): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every((coordinate) => isFiniteFullVrmNumber(coordinate, -maxAbs, maxAbs));
}

function isStrictFullVrmPoseBones(value: unknown): value is PoseBoneMap {
  if (!isFullVrmStateRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > STUDIO_HUMANOID_BONE_NAMES.length) return false;
  for (const [boneName, rawBone] of entries) {
    if (!isStudioHumanoidBoneName(boneName) || !isFullVrmStateRecord(rawBone)) return false;
    const keys = Object.keys(rawBone);
    if (
      keys.length === 0
      || keys.some((key) => key !== "rotation" && key !== "direction")
    ) return false;
    if (Object.prototype.hasOwnProperty.call(rawBone, "rotation")
      && !isStrictFullVrmVec3(rawBone.rotation, Math.PI * 4)) return false;
    if (Object.prototype.hasOwnProperty.call(rawBone, "direction")) {
      const direction = rawBone.direction;
      if (Array.isArray(direction)) {
        if (!isStrictFullVrmVec3(direction, 4)) return false;
      } else if (
        !isFullVrmStateRecord(direction)
        || !hasOnlyFullVrmKeys(direction, new Set(["sideX", "y", "z"]))
        || !Object.prototype.hasOwnProperty.call(direction, "sideX")
        || !Object.prototype.hasOwnProperty.call(direction, "y")
        || !isFiniteFullVrmNumber(direction.sideX, -4, 4)
        || !isFiniteFullVrmNumber(direction.y, -4, 4)
        || (Object.prototype.hasOwnProperty.call(direction, "z")
          && !isFiniteFullVrmNumber(direction.z, -4, 4))
      ) return false;
    }
  }
  return true;
}

function isStrictFullVrmFingerOverrides(value: unknown): value is FingerRotationMap {
  if (!isFullVrmStateRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= POSER_FINGER_BONES.length
    && entries.every(([boneName, rotation]) => (
      FINGER_BONE_SET.has(boneName) && isStrictFullVrmVec3(rotation, Math.PI * 4)
    ));
}

function isSafeFullVrmRuntimeKey(key: string): boolean {
  return SAFE_VRM_RUNTIME_KEY_PATTERN.test(key)
    && !FORBIDDEN_VRM_RUNTIME_KEYS.has(key.toLowerCase());
}

function isStrictFullVrmNumberRecord(
  value: unknown,
  maxEntries: number,
  min: number,
  max: number,
): value is Record<string, number> {
  if (!isFullVrmStateRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= maxEntries && entries.every(([key, entry]) => (
    isSafeFullVrmRuntimeKey(key) && isFiniteFullVrmNumber(entry, min, max)
  ));
}

function isStrictFullVrmBodyScale(value: unknown): value is BodyScale {
  return isFullVrmStateRecord(value)
    && Object.keys(value).length === 2
    && Object.prototype.hasOwnProperty.call(value, "height")
    && Object.prototype.hasOwnProperty.call(value, "width")
    && isFiniteFullVrmNumber(value.height, 0.5, 1.6)
    && isFiniteFullVrmNumber(value.width, 0.5, 1.6);
}

function isStrictFullVrmCustomColors(value: unknown): value is Record<string, string> {
  if (!isFullVrmStateRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 32 && entries.every(([key, color]) => (
    isSafeFullVrmRuntimeKey(key)
    && typeof color === "string"
    && CSS_HEX_COLOR_PATTERN.test(color)
  ));
}

function isStrictFullVrmMaterialFx(value: unknown): boolean {
  if (!isFullVrmStateRecord(value)) return false;
  const colorKeys = ["shadeColor", "outlineColor", "rimColor", "emissiveColor"] as const;
  const allowed = new Set([...colorKeys, "rimIntensity", "emissiveIntensity"]);
  return Object.keys(value).length <= allowed.size
    && hasOnlyFullVrmKeys(value, allowed)
    && colorKeys.every((key) => (
      !Object.prototype.hasOwnProperty.call(value, key)
      || value[key] === null
      || (typeof value[key] === "string" && CSS_HEX_COLOR_PATTERN.test(value[key]))
    ))
    && (!Object.prototype.hasOwnProperty.call(value, "rimIntensity")
      || isFiniteFullVrmNumber(value.rimIntensity, 0, 1))
    && (!Object.prototype.hasOwnProperty.call(value, "emissiveIntensity")
      || isFiniteFullVrmNumber(value.emissiveIntensity, 0, 1));
}

function isStrictFullVrmLighting(value: unknown): value is LightingParams {
  if (!isFullVrmStateRecord(value)) return false;
  return Object.keys(value).length === 3
    && hasOnlyFullVrmKeys(value, new Set(["intensity", "colorTemp", "directionDeg"]))
    && isFiniteFullVrmNumber(value.intensity, 0.1, 4)
    && isFiniteFullVrmNumber(value.colorTemp, 0, 1)
    && isFiniteFullVrmNumber(value.directionDeg, -180, 180);
}

function isStrictFullVrmLightingTone(value: unknown): value is StudioVrmLightingTone {
  return typeof value === "string" && FULL_VRM_LIGHTING_TONE_SET.has(value);
}

function isStrictFullVrmPhysics(value: unknown): value is VrmPhysicsSettings {
  if (!isFullVrmStateRecord(value)) return false;
  const keys = new Set([
    "version",
    "stiffnessScale",
    "gravityScale",
    "windDirectionDeg",
    "windStrength",
  ]);
  if (Object.keys(value).length !== keys.size || !hasOnlyFullVrmKeys(value, keys)) return false;
  const normalized = parseVrmPhysicsSettings(value);
  return value.version === normalized.version
    && value.stiffnessScale === normalized.stiffnessScale
    && value.gravityScale === normalized.gravityScale
    && value.windDirectionDeg === normalized.windDirectionDeg
    && value.windStrength === normalized.windStrength;
}

function isSafeFullVrmOpaqueId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_VRM_STATE_TEXT_LENGTH) {
    return false;
  }
  return value === value.trim() && !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isBoundedFullVrmRuntimeData(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): boolean {
  state.nodes += 1;
  if (state.nodes > MAX_VRM_RUNTIME_DATA_NODES || depth > MAX_VRM_RUNTIME_DATA_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return Array.from(value).length <= MAX_VRM_RUNTIME_STRING_LENGTH;
  if (Array.isArray(value)) {
    return value.length <= MAX_VRM_RUNTIME_ARRAY_ITEMS
      && value.every((item) => isBoundedFullVrmRuntimeData(item, state, depth + 1));
  }
  if (!isFullVrmStateRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_VRM_RUNTIME_OBJECT_KEYS
    && entries.every(([key, entry]) => (
      isSafeFullVrmRuntimeKey(key)
      && isBoundedFullVrmRuntimeData(entry, state, depth + 1)
    ));
}

function hasStrictFullVrmRuntimeFields(value: Record<string, unknown>): boolean {
  if (!isStrictFullVrmPoseBones(value.bones)) return false;
  if (value.modelId !== undefined && normalizeFullVrmModelId(value.modelId) !== value.modelId) return false;
  if (value.poseId !== undefined && !isSafeFullVrmOpaqueId(value.poseId)) return false;
  if (value.expressionId !== undefined && !isSafeFullVrmOpaqueId(value.expressionId)) return false;
  if (value.expressionWeights !== undefined
    && !isStrictFullVrmNumberRecord(value.expressionWeights, 64, 0, 1)) return false;
  if (value.fingerOverrides !== undefined
    && !isStrictFullVrmFingerOverrides(value.fingerOverrides)) return false;
  if (value.bodyScale !== undefined && !isStrictFullVrmBodyScale(value.bodyScale)) return false;
  if (value.customColors !== undefined && !isStrictFullVrmCustomColors(value.customColors)) return false;
  if (value.materialFx !== undefined && !isStrictFullVrmMaterialFx(value.materialFx)) return false;
  if (value.lighting !== undefined && !isStrictFullVrmLighting(value.lighting)) return false;
  if (value.lightingTone !== undefined && !isStrictFullVrmLightingTone(value.lightingTone)) {
    return false;
  }
  if (value.physics !== undefined && !isStrictFullVrmPhysics(value.physics)) return false;
  if (value.env !== undefined && !["none", "floor", "wall", "room", "outdoor"].includes(String(value.env))) {
    return false;
  }
  for (const key of ["costume", "wardrobe", "props", "sceneProps", "avatarForge"] as const) {
    if (value[key] !== undefined && !isBoundedFullVrmRuntimeData(value[key], { nodes: 0 })) return false;
  }
  return true;
}

/** 외부 저장/공유 데이터가 NaN, Infinity, 과도한 회전을 React/Three 상태에 주입하지 못하게 한다. */
export function normalizeVrmBodyRotation(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-Math.PI, Math.min(Math.PI, value));
}

function normalizeFullVrmYOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-10, Math.min(10, Object.is(value, -0) ? 0 : value));
}

/**
 * 모델 ID는 opaque storage key로 취급하되, 히스토리 소유권 비교에 부적합한 빈 값·제어문자·
 * 과도한 문자열은 보존하지 않는다.
 */
export function normalizeFullVrmModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value || value.length > MAX_VRM_MODEL_ID_LENGTH || value !== value.trim()) return undefined;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return undefined;
  }
  return value;
}

/**
 * Undo/redo는 명시적 포즈 이식이 아니다. 소유권이 없거나 현재 모델과 다르면 fail closed한다.
 * 구버전 저장 상태는 명시적 불러오기 경로에서는 계속 사용할 수 있다.
 */
export function canRestoreFullVrmHistoryState(state: FullVrmStateInput, activeModelId: unknown): boolean {
  const stateModelId = normalizeFullVrmModelId(state.modelId);
  const currentModelId = normalizeFullVrmModelId(activeModelId);
  return stateModelId !== undefined && currentModelId !== undefined && stateModelId === currentModelId;
}

export function serializeFullVrmState(
  state: Partial<Omit<FullVrmState, "version" | "ikConstraints">> & {
    version?: 2 | 3;
    ikConstraints?: unknown;
  },
): FullVrmState {
  const poseTranslations = normalizeStudioVrmPoseTranslations(state.poseTranslations)
    ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS;
  const ikConstraints = parseStudioVrmIkConstraints(state.ikConstraints ?? []) ?? [];
  return {
    version: 3,
    modelId: normalizeFullVrmModelId(state.modelId),
    poseId: state.poseId,
    bones: state.bones || {},
    yOffset: normalizeFullVrmYOffset(state.yOffset),
    poseTranslations,
    ikConstraints: cloneStudioVrmIkConstraints(ikConstraints),
    bodyRotation: normalizeVrmBodyRotation(state.bodyRotation),
    expressionId: state.expressionId,
    expressionWeights: state.expressionWeights,
    costume: state.costume,
    wardrobe: state.wardrobe,
    props: state.props,
    sceneProps: state.sceneProps,
    physics: state.physics,
    bodyScale: state.bodyScale,
    lighting: state.lighting,
    lightingTone: isStrictFullVrmLightingTone(state.lightingTone)
      ? state.lightingTone
      : DEFAULT_STUDIO_VRM_LIGHTING_TONE,
    env: state.env,
    fingerOverrides: state.fingerOverrides,
    materialFx: state.materialFx,
    avatarForge: state.avatarForge,
    customColors: state.customColors,
  };
}

/** Strict external reader: current v3 must contain the exact canonical persistent-IK block. */
export function deserializeFullVrmState(value: unknown): FullVrmState | null {
  if (!isFullVrmStateRecord(value) || (value.version !== 2 && value.version !== 3)) return null;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !FULL_VRM_STATE_KEYS.has(key))
    || !Object.prototype.hasOwnProperty.call(value, "bones")
    || !Object.prototype.hasOwnProperty.call(value, "yOffset")
    || !Object.prototype.hasOwnProperty.call(value, "bodyRotation")
    || !hasStrictFullVrmRuntimeFields(value)
  ) return null;
  const hasPoseTranslations = Object.prototype.hasOwnProperty.call(value, "poseTranslations");
  const normalizedTranslations = hasPoseTranslations
    ? normalizeStudioVrmPoseTranslations(value.poseTranslations)
    : null;
  if (value.version === 2) {
    if (Object.prototype.hasOwnProperty.call(value, "ikConstraints")) return null;
    if (
      hasPoseTranslations
      && (!normalizedTranslations
        || JSON.stringify(normalizedTranslations) !== JSON.stringify(value.poseTranslations))
    ) return null;
  } else {
    if (!Object.prototype.hasOwnProperty.call(value, "ikConstraints")) return null;
    const constraints = parseStudioVrmIkConstraints(value.ikConstraints);
    if (!constraints || JSON.stringify(constraints) !== JSON.stringify(value.ikConstraints)) return null;
    if (
      !hasPoseTranslations
      || !normalizedTranslations
      || JSON.stringify(normalizedTranslations) !== JSON.stringify(value.poseTranslations)
    ) return null;
  }
  if (
    typeof value.yOffset !== "number"
    || normalizeFullVrmYOffset(value.yOffset) !== value.yOffset
    || normalizeVrmBodyRotation(value.bodyRotation) !== value.bodyRotation
    || !isFullVrmStateRecord(value.bones)
  ) return null;
  return serializeFullVrmState(value as FullVrmStateInput);
}

export function applyFullState(vrm: VRM, state: FullVrmStateInput, applyers: {
  applyPose: (
    bones: PoseBoneMap,
    y: number,
    translations: StudioVrmPoseTranslations,
  ) => void;
  applyExpr: (weights: Record<string, number>) => void;
  applyCostume?: (c: unknown) => void;
  applyWardrobe?: (w: unknown) => void;
  applyProps?: (p: unknown) => void;
  applySceneProps?: (p: unknown) => void;
  applyPhysics?: (p: unknown) => void;
  applyMaterialFx?: (fx: VrmMaterialFx) => void;
  applyCustomColors?: (colors: Record<string, string>) => void;
}) {
  if (state.bones) applyers.applyPose(
    stripFingerBones(state.bones),
    state.yOffset ?? 0,
    normalizeStudioVrmPoseTranslations(state.poseTranslations)
      ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  );
  if (state.expressionWeights) applyers.applyExpr(state.expressionWeights);
  if (state.bodyScale) applyBodyScale(vrm, state.bodyScale);
  if (state.fingerOverrides) applyFingerRotations(vrm, state.fingerOverrides);
  if (state.costume && applyers.applyCostume) applyers.applyCostume(state.costume);
  if (state.wardrobe && applyers.applyWardrobe) applyers.applyWardrobe(state.wardrobe);
  // Full-state 복원은 authoritative 하다. props 필드가 없더라도 빈 배열을 전달해 이전 장착물이
  // 다음 문서에 눌어붙지 않게 하고, 외부/구버전 입력은 반드시 동일 parser를 통과시킨다.
  if (applyers.applyProps) applyers.applyProps(parseVrmProps(state.props));
  if (applyers.applySceneProps) applyers.applySceneProps(parseSceneProps(state.sceneProps));
  if (state.physics && applyers.applyPhysics) applyers.applyPhysics(state.physics);
  if (state.materialFx && applyers.applyMaterialFx) applyers.applyMaterialFx(state.materialFx);
  if (state.customColors && applyers.applyCustomColors) applyers.applyCustomColors(state.customColors);
  // lighting/env applied in scene setup (UI side)
}

export function stripFingerBones(bones: PoseBoneMap): PoseBoneMap {
  const result: PoseBoneMap = {};
  (Object.keys(bones) as VRMHumanBoneName[]).forEach((k) => {
    if (!POSER_FINGER_BONES.includes(k)) {
      result[k] = bones[k];
    }
  });
  return result;
}

export function applyPoserVisualState(
  vrm: VRM,
  state: {
    bones: PoseBoneMap;
    yOffset?: number;
    poseTranslations?: StudioVrmPoseTranslations;
    fingerEdits?: FingerRotationMap;
    bodyScale?: BodyScale;
  }
) {
  const {
    bones,
    yOffset = 0,
    poseTranslations = EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
    fingerEdits = {},
    bodyScale,
  } = state;
  // Defer palm correct until after finger polarity so we only twist wrists once.
  applyPoseToVrm(vrm, stripFingerBones(bones), yOffset, poseTranslations, {
    skipPalmCorrect: true,
  });
  if (Object.keys(fingerEdits).length) {
    applyFingerRotations(vrm, fingerEdits);
  }
  correctVrmHangingHandPalmTwist(vrm);
  if (bodyScale) {
    applyBodyScale(vrm, bodyScale);
  }
}

/**
 * Pure planner for full state restore (AC2).
 * Returns a plan object with every React state field + stripped bones.
 */
export function planFullStateRestore(state: FullVrmStateInput): {
  modelId?: string;
  strippedBones: PoseBoneMap;
  yOffset: number;
  poseTranslations: StudioVrmPoseTranslations;
  ikConstraints: readonly StudioVrmIkConstraint[];
  bodyRotation: number;
  expressionWeights: Record<string, number>;
  bodyScale?: BodyScale;
  lighting?: LightingParams;
  lightingTone: StudioVrmLightingTone;
  env?: EnvVariant;
  fingerOverrides?: FingerRotationMap;
  costume?: unknown;
  wardrobe?: unknown;
  /** 항상 정규화된 소품 목록. props가 없는 authoritative 상태는 빈 목록으로 복원한다. */
  propsItems: PropInstance[];
  sceneProps: SerializedSceneProps;
  physics?: unknown;
  materialFx?: VrmMaterialFx;
  avatarForge?: unknown;
  customColors?: Record<string, string>;
} {
  return {
    modelId: normalizeFullVrmModelId(state.modelId),
    strippedBones: stripFingerBones(state.bones || {}),
    yOffset: state.yOffset ?? 0,
    poseTranslations: normalizeStudioVrmPoseTranslations(state.poseTranslations)
      ?? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
    ikConstraints: cloneStudioVrmIkConstraints(
      parseStudioVrmIkConstraints(state.ikConstraints) ?? [],
    ),
    bodyRotation: normalizeVrmBodyRotation(state.bodyRotation),
    expressionWeights: state.expressionWeights || {},
    bodyScale: state.bodyScale,
    lighting: state.lighting,
    lightingTone: isStrictFullVrmLightingTone(state.lightingTone)
      ? state.lightingTone
      : DEFAULT_STUDIO_VRM_LIGHTING_TONE,
    env: state.env,
    fingerOverrides: state.fingerOverrides,
    costume: state.costume,
    wardrobe: state.wardrobe,
    propsItems: parseVrmProps(state.props).items,
    sceneProps: parseSceneProps(state.sceneProps),
    physics: state.physics,
    materialFx: state.materialFx,
    avatarForge: state.avatarForge,
    customColors: state.customColors,
  };
}

/**
 * 공유 PNG와 캔버스 삽입 PNG가 동일한 authoritative full-state 직렬화를 사용하게 한다.
 * 기존 재편집 payload가 기대하는 `vrmProps` 별칭은 유지한다.
 */
export function buildVrmPoseDataUrlMetadata(state: Partial<FullVrmState>, modelName: string) {
  const { props, ...fullState } = serializeFullVrmState(state);
  return {
    tool: "vrm-poser" as const,
    ...fullState,
    modelName,
    vrmProps: props,
  };
}

/**
 * Pure helpers so component handlers can delegate.
 * Tests import and call these (aliased as handle*) to drive the exact shipped restore logic.
 */
export function buildFullVrmStateFromSharedDataUrl(dataUrl: string): FullVrmState | null {
  try {
    const hashIndex = dataUrl.indexOf("#");
    if (hashIndex === -1) return null;
    const hashStr = dataUrl.substring(hashIndex + 1);
    const poseData: unknown = JSON.parse(decodeURIComponent(hashStr));
    if (!isFullVrmStateRecord(poseData)) return null;
    const keys = Object.keys(poseData);
    if (
      keys.some((key) => !FULL_VRM_FRAGMENT_KEYS.has(key))
      || (poseData.tool !== undefined && poseData.tool !== "vrm-poser")
      || (poseData.version !== undefined && poseData.version !== 2 && poseData.version !== 3)
    ) return null;
    const sourceVersion = poseData.version === 3 ? 3 : 2;
    if (sourceVersion === 3) {
      for (const requiredKey of [
        "bones",
        "yOffset",
        "bodyRotation",
        "poseTranslations",
        "ikConstraints",
      ]) {
        if (!Object.prototype.hasOwnProperty.call(poseData, requiredKey)) return null;
      }
    }
    const candidate = {
      version: sourceVersion,
      modelId: poseData.modelId,
      poseId: poseData.poseId,
      bones: poseData.bones || {},
      yOffset: typeof poseData.yOffset === "number" ? poseData.yOffset : 0,
      bodyRotation: sourceVersion === 2 && poseData.bodyRotation === undefined
        ? 0
        : poseData.bodyRotation,
      expressionId: poseData.expressionId,
      expressionWeights: poseData.expressionWeights || {},
      bodyScale: poseData.bodyScale,
      fingerOverrides: poseData.fingerOverrides,
      lighting: poseData.lighting,
      lightingTone: poseData.lightingTone,
      env: poseData.env,
      costume: poseData.costume,
      wardrobe: poseData.wardrobe,
      props: poseData.props != null
        ? parseVrmProps(poseData.props)
        : poseData.vrmProps != null
          ? parseVrmProps(poseData.vrmProps)
          : undefined,
      sceneProps: poseData.sceneProps != null ? parseSceneProps(poseData.sceneProps) : undefined,
      physics: poseData.physics,
      materialFx: poseData.materialFx,
      avatarForge: poseData.avatarForge,
      customColors: poseData.customColors,
      ...(sourceVersion === 3 || Object.prototype.hasOwnProperty.call(poseData, "poseTranslations")
        ? { poseTranslations: poseData.poseTranslations }
        : {}),
      ...(sourceVersion === 3 ? { ikConstraints: poseData.ikConstraints } : {}),
    };
    return deserializeFullVrmState(candidate);
  } catch {
    return null;
  }
}

/**
 * Factory so that the real handlers inside the component and the tests
 * use the exact same logic objects.
 * Tests call the returned handle* functions with controlled deps.
 */
export function createFullStateLoadHandlers(deps: {
  savedFullStates: Record<string, FullVrmState>;
  commitFullStateRestore: (s: FullVrmState, vrm: VRM | null) => boolean | void;
  vrmRef: { current: VRM | null };
  setActivePoseId?: (id: string) => void;
  setCustomColors?: (c: Record<string, string>) => void;
  alertFn?: (msg: string) => void;
}) {
  return {
    handleLoadFullLocal(name: string) {
      const s = deps.savedFullStates[name];
      if (!s) return false;
      return deps.commitFullStateRestore(s, deps.vrmRef.current) !== false;
    },
    handlePasteFullStateFromParsed(s: FullVrmStateInput | null) {
      const full = deserializeFullVrmState(s);
      if (!full) return false;
      return deps.commitFullStateRestore(full, deps.vrmRef.current) !== false;
    },
    handleSelectSharedPose(asset: { dataUrl: string }) {
      const full = buildFullVrmStateFromSharedDataUrl(asset.dataUrl);
      if (!full) {
        deps.alertFn?.("이 포즈 에셋에는 3D 설정 정보가 포함되어 있지 않습니다.");
        return false;
      }
      if (deps.commitFullStateRestore(full, deps.vrmRef.current) === false) {
        return false;
      }

      try {
        const hashIndex = asset.dataUrl.indexOf("#");
        if (hashIndex !== -1) {
          const poseData = JSON.parse(decodeURIComponent(asset.dataUrl.substring(hashIndex + 1)));
          if (poseData.customColors && deps.setCustomColors) {
            deps.setCustomColors(poseData.customColors);
          }
        }
      } catch {}
      return true;
    },
  };
}
