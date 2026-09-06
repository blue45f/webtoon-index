/**
 * studio-3d-character-animator-and-proportions.ts
 *
 * VRoid Studio, Mixamo & Plask-inspired Character Proportions & Facial Expression Engine.
 * Supports head-to-body proportion ratio solvers, VRM blendshape facial expressions,
 * and standard animation clip transitions.
 */

export type ProportionRatioPreset =
  | "8-head-heroic-real"
  | "7-head-standard-manga"
  | "6-head-teen-anime"
  | "4-head-sd-chibi"
  | "2.5-head-mini-mascot";

export type AnimeFacialExpressionKind =
  | "neutral-calm"
  | "joy-smile"
  | "anger-shout"
  | "sorrow-crying"
  | "panic-shock"
  | "smug-confident"
  | "wink-left"
  | "wink-right"
  | "blushing-embarrassed"
  | "focused-determined"
  | "sleepy-yawn"
  | "screaming-fear";

export type CoreAnimationClipKind =
  | "idle-breathing"
  | "combat-stance"
  | "walk-cycle"
  | "run-dash"
  | "victory-cheer"
  | "defeated-kneel"
  | "floating-magic"
  | "sword-slashing";

export interface BodyProportionsSpec {
  readonly preset: ProportionRatioPreset;
  readonly headScale: number; // 0.6 to 2.2
  readonly shoulderWidth: number; // 0.7 to 1.5
  readonly torsoLength: number; // 0.7 to 1.3
  readonly legLength: number; // 0.6 to 1.6
  readonly armLength: number; // 0.7 to 1.4
  readonly hipWidth: number; // 0.7 to 1.4
  readonly overallScale: number; // 0.5 to 2.0
}

export interface FacialMorphWeights {
  readonly expression: AnimeFacialExpressionKind;
  readonly eyeBlinkLeft: number; // 0.0 to 1.0
  readonly eyeBlinkRight: number;
  readonly mouthSmile: number;
  readonly mouthOpen: number;
  readonly browAngry: number;
  readonly browSad: number;
  readonly blushIntensity: number;
}

export const PROPORTION_PRESETS: Record<ProportionRatioPreset, BodyProportionsSpec> = {
  "8-head-heroic-real": {
    preset: "8-head-heroic-real",
    headScale: 0.9,
    shoulderWidth: 1.25,
    torsoLength: 1.05,
    legLength: 1.25,
    armLength: 1.05,
    hipWidth: 1.0,
    overallScale: 1.0,
  },
  "7-head-standard-manga": {
    preset: "7-head-standard-manga",
    headScale: 1.0,
    shoulderWidth: 1.1,
    torsoLength: 1.0,
    legLength: 1.1,
    armLength: 1.0,
    hipWidth: 1.05,
    overallScale: 1.0,
  },
  "6-head-teen-anime": {
    preset: "6-head-teen-anime",
    headScale: 1.15,
    shoulderWidth: 0.95,
    torsoLength: 0.95,
    legLength: 1.0,
    armLength: 0.95,
    hipWidth: 0.95,
    overallScale: 0.95,
  },
  "4-head-sd-chibi": {
    preset: "4-head-sd-chibi",
    headScale: 1.65,
    shoulderWidth: 0.8,
    torsoLength: 0.8,
    legLength: 0.75,
    armLength: 0.8,
    hipWidth: 0.85,
    overallScale: 0.8,
  },
  "2.5-head-mini-mascot": {
    preset: "2.5-head-mini-mascot",
    headScale: 2.1,
    shoulderWidth: 0.7,
    torsoLength: 0.65,
    legLength: 0.6,
    armLength: 0.7,
    hipWidth: 0.8,
    overallScale: 0.65,
  },
};

export const FACIAL_EXPRESSION_PRESETS: Record<AnimeFacialExpressionKind, FacialMorphWeights> = {
  "neutral-calm": {
    expression: "neutral-calm",
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    mouthSmile: 0.05,
    mouthOpen: 0,
    browAngry: 0,
    browSad: 0,
    blushIntensity: 0,
  },
  "joy-smile": {
    expression: "joy-smile",
    eyeBlinkLeft: 0.2,
    eyeBlinkRight: 0.2,
    mouthSmile: 0.95,
    mouthOpen: 0.3,
    browAngry: 0,
    browSad: 0,
    blushIntensity: 0.4,
  },
  "anger-shout": {
    expression: "anger-shout",
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    mouthSmile: 0,
    mouthOpen: 0.85,
    browAngry: 0.95,
    browSad: 0,
    blushIntensity: 0.1,
  },
  "sorrow-crying": {
    expression: "sorrow-crying",
    eyeBlinkLeft: 0.4,
    eyeBlinkRight: 0.4,
    mouthSmile: 0,
    mouthOpen: 0.2,
    browAngry: 0,
    browSad: 0.9,
    blushIntensity: 0.2,
  },
  "panic-shock": {
    expression: "panic-shock",
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    mouthSmile: 0,
    mouthOpen: 0.95,
    browAngry: 0.4,
    browSad: 0.6,
    blushIntensity: 0,
  },
  "smug-confident": {
    expression: "smug-confident",
    eyeBlinkLeft: 0.15,
    eyeBlinkRight: 0.35,
    mouthSmile: 0.8,
    mouthOpen: 0.1,
    browAngry: 0.3,
    browSad: 0,
    blushIntensity: 0.1,
  },
  "wink-left": {
    expression: "wink-left",
    eyeBlinkLeft: 1.0,
    eyeBlinkRight: 0,
    mouthSmile: 0.85,
    mouthOpen: 0.2,
    browAngry: 0,
    browSad: 0,
    blushIntensity: 0.35,
  },
  "wink-right": {
    expression: "wink-right",
    eyeBlinkLeft: 0,
    eyeBlinkRight: 1.0,
    mouthSmile: 0.85,
    mouthOpen: 0.2,
    browAngry: 0,
    browSad: 0,
    blushIntensity: 0.35,
  },
  "blushing-embarrassed": {
    expression: "blushing-embarrassed",
    eyeBlinkLeft: 0.3,
    eyeBlinkRight: 0.3,
    mouthSmile: 0.4,
    mouthOpen: 0.15,
    browAngry: 0,
    browSad: 0.5,
    blushIntensity: 0.95,
  },
  "focused-determined": {
    expression: "focused-determined",
    eyeBlinkLeft: 0.1,
    eyeBlinkRight: 0.1,
    mouthSmile: 0,
    mouthOpen: 0,
    browAngry: 0.75,
    browSad: 0,
    blushIntensity: 0,
  },
  "sleepy-yawn": {
    expression: "sleepy-yawn",
    eyeBlinkLeft: 0.8,
    eyeBlinkRight: 0.8,
    mouthSmile: 0,
    mouthOpen: 0.7,
    browAngry: 0,
    browSad: 0.3,
    blushIntensity: 0.2,
  },
  "screaming-fear": {
    expression: "screaming-fear",
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    mouthSmile: 0,
    mouthOpen: 1.0,
    browAngry: 0.2,
    browSad: 0.95,
    blushIntensity: 0,
  },
};

export const CORE_ANIMATION_CLIPS: readonly {
  readonly id: CoreAnimationClipKind;
  readonly label: string;
  readonly durationSeconds: number;
  readonly isLooping: boolean;
  readonly description: string;
}[] = [
  {
    id: "idle-breathing",
    label: "기본 대기 호흡 (Idle Breathing)",
    durationSeconds: 2.4,
    isLooping: true,
    description: "가슴과 어깨가 자연스럽게 오르내리는 루프",
  },
  {
    id: "combat-stance",
    label: "전투 대치 자세 (Combat Stance)",
    durationSeconds: 1.8,
    isLooping: true,
    description: "무게중심을 낮추고 긴장감 있게 적을 노려보는 전투 준비",
  },
  {
    id: "walk-cycle",
    label: "자연스러운 보행 (Walk Cycle)",
    durationSeconds: 1.2,
    isLooping: true,
    description: "양팔을 흔들며 부드럽게 전진하는 보행 루프",
  },
  {
    id: "run-dash",
    label: "전력 질주 (Run Dash)",
    durationSeconds: 0.8,
    isLooping: true,
    description: "상체를 숙이고 강력하게 박차고 나가는 질주",
  },
  {
    id: "victory-cheer",
    label: "승리 환호 (Victory Cheer)",
    durationSeconds: 2.0,
    isLooping: false,
    description: "양팔을 번쩍 들며 기뻐하는 승리 세리머니",
  },
  {
    id: "defeated-kneel",
    label: "패배 좌절 무릎꿇기 (Defeated Kneel)",
    durationSeconds: 2.2,
    isLooping: false,
    description: "바닥에 주저앉아 한 손으로 바닥을 짚는 연출",
  },
  {
    id: "floating-magic",
    label: "마법 공중 부유 (Floating Magic)",
    durationSeconds: 3.0,
    isLooping: true,
    description: "공중에 떠서 부드럽게 넘실거리는 신비로운 부유",
  },
  {
    id: "sword-slashing",
    label: "검격 일도양단 (Sword Slash)",
    durationSeconds: 1.4,
    isLooping: false,
    description: "전방을 향해 쾌속으로 베어 가르는 액션 컷",
  },
];

/**
 * Calculates joint bone scale adjustments for character proportions
 */
export function calculateBoneScalesForProportions(
  spec: BodyProportionsSpec,
): Record<string, [number, number, number]> {
  return {
    head: [spec.headScale, spec.headScale, spec.headScale],
    neck: [spec.headScale * 0.9, 1.0, spec.headScale * 0.9],
    spine: [spec.torsoLength, spec.torsoLength, spec.torsoLength],
    chest: [spec.shoulderWidth, spec.torsoLength, spec.shoulderWidth * 0.9],
    leftUpperArm: [1.0, spec.armLength, 1.0],
    rightUpperArm: [1.0, spec.armLength, 1.0],
    leftUpperLeg: [spec.hipWidth, spec.legLength, spec.hipWidth],
    rightUpperLeg: [spec.hipWidth, spec.legLength, spec.hipWidth],
    hips: [spec.hipWidth, 1.0, spec.hipWidth],
  };
}
