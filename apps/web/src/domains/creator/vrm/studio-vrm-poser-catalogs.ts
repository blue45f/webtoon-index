/**
 * Static catalogs and label tables for the Studio VRM poser.
 * Data only — no closures, no DOM, no Three.js runtime. Split out of
 * `StudioVrmPoser.tsx` verbatim so the editor shell stays readable.
 */
import { Clapperboard, Paintbrush, PersonStanding, Shirt, Sliders, Smile, Sparkles, Swords, Upload, UserRound } from "lucide-react";

import { POSER_FINGER_BONES } from "../studio-pose-presets";

import type { EnvVariant, Vec3 } from "./studio-vrm-poser-utils";
import type { StudioVrmIkAxisLock, StudioVrmIkDragMode } from "./StudioVrmJointHandles";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export type ExpressionAction = {
  id: string;
  label: string;
  name: string | null;
  tone: string;
};

export type CameraPreset = {
  id: string;
  label: string;
  position: Vec3;
  target: Vec3;
  fov: number;
};

export type CostumePreset = {
  id: string;
  name: string;
  emoji: string;
  colors: Record<string, string>;
};

export const COSTUME_PRESETS: CostumePreset[] = [
  {
    id: "school",
    name: "스쿨룩 (교복)",
    emoji: "🏫",
    colors: { tops: "#f8f9fa", bottoms: "#1e293b", hair: "#475569", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "knight",
    name: "성기사 (갑옷)",
    emoji: "🛡️",
    colors: { tops: "#cbd5e1", bottoms: "#1e3a8a", hair: "#fbbf24", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "royal",
    name: "로판 황실예복",
    emoji: "👑",
    colors: { tops: "#991b1b", bottoms: "#d97706", hair: "#e2e8f0", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "cyber",
    name: "사이버펑크",
    emoji: "⚡",
    colors: { tops: "#0f172a", bottoms: "#ec4899", hair: "#a855f7", body: "#06b6d4", face: "#06b6d4" },
  },
  {
    id: "gothic",
    name: "고스 롤리타",
    emoji: "🖤",
    colors: { tops: "#111827", bottoms: "#581c87", hair: "#f3f4f6", body: "#f9fafb", face: "#f9fafb" },
  },
  {
    id: "autumn",
    name: "클래식 코트",
    emoji: "🍂",
    colors: { tops: "#d97706", bottoms: "#451a03", hair: "#b45309", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "marine",
    name: "마린 세일러",
    emoji: "⚓",
    colors: { tops: "#f8f9fa", bottoms: "#0f172a", hair: "#0284c7", body: "#ffe4e6", face: "#ffe4e6" },
  },
  {
    id: "druid",
    name: "숲의 엘프",
    emoji: "🍃",
    colors: { tops: "#065f46", bottoms: "#78350f", hair: "#10b981", body: "#fef3c7", face: "#fef3c7" },
  },
  {
    id: "ninja",
    name: "그림자 암살자",
    emoji: "🥷",
    colors: { tops: "#111827", bottoms: "#1f2937", hair: "#9ca3af", body: "#e5e7eb", face: "#e5e7eb" },
  },
  {
    id: "magical",
    name: "마법소녀/소년",
    emoji: "💖",
    colors: { tops: "#f472b6", bottoms: "#f472b6", hair: "#fb7185", body: "#ffe4e6", face: "#ffe4e6" },
  },
  {
    id: "wizard",
    name: "판타지 마법사",
    emoji: "🔮",
    colors: { tops: "#3b0764", bottoms: "#1e1b4b", hair: "#a5b4fc", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "murim",
    name: "무협 소협",
    emoji: "⚔️",
    colors: { tops: "#0284c7", bottoms: "#f8f9fa", hair: "#1e293b", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "ceo",
    name: "현대 재벌/정장",
    emoji: "💼",
    colors: { tops: "#0f172a", bottoms: "#0f172a", hair: "#1e293b", body: "#ffe4e6", face: "#ffe4e6" },
  },
  {
    id: "sporty",
    name: "스포티 트랙슈트",
    emoji: "🏃",
    colors: { tops: "#10b981", bottoms: "#10b981", hair: "#6b7280", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "explorer",
    name: "설원 탐험가",
    emoji: "❄️",
    colors: { tops: "#f1f5f9", bottoms: "#64748b", hair: "#38bdf8", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "steampunk",
    name: "스팀펑크",
    emoji: "⚙️",
    colors: { tops: "#78350f", bottoms: "#451a03", hair: "#d97706", body: "#fef3c7", face: "#fef3c7" },
  },
  {
    id: "angel",
    name: "성직자/천사",
    emoji: "👼",
    colors: { tops: "#ffffff", bottoms: "#ffffff", hair: "#fef08a", body: "#fffbeb", face: "#fffbeb" },
  },
  {
    id: "devil",
    name: "심연의 악마",
    emoji: "😈",
    colors: { tops: "#450a0a", bottoms: "#1a0505", hair: "#ef4444", body: "#1c1917", face: "#1c1917" },
  },
  {
    id: "zombie",
    name: "강시/강령술사",
    emoji: "🧟",
    colors: { tops: "#1e1b4b", bottoms: "#0f172a", hair: "#312e81", body: "#86efac", face: "#86efac" },
  },
  {
    id: "astronaut",
    name: "우주 대원",
    emoji: "👨‍🚀",
    colors: { tops: "#f97316", bottoms: "#e2e8f0", hair: "#475569", body: "#f1f5f9", face: "#f1f5f9" },
  },
  {
    id: "office",
    name: "오피스 정장",
    emoji: "💼",
    colors: { tops: "#f8fafc", bottoms: "#111827", hair: "#2b211f", body: "#c98b68", face: "#c98b68" },
  },
  {
    id: "doctor",
    name: "의사 가운",
    emoji: "🥼",
    colors: { tops: "#f8fafc", bottoms: "#155e75", hair: "#3b2b27", body: "#dca982", face: "#dca982" },
  },
  {
    id: "surgeon",
    name: "외과 수술복",
    emoji: "🩺",
    colors: { tops: "#0f766e", bottoms: "#115e59", hair: "#242124", body: "#9f684e", face: "#9f684e" },
  },
  {
    id: "nurse",
    name: "간호 스크럽",
    emoji: "🏥",
    colors: { tops: "#60a5fa", bottoms: "#2563eb", hair: "#49352f", body: "#efd1bb", face: "#efd1bb" },
  },
  {
    id: "paramedic",
    name: "응급구조사",
    emoji: "🚑",
    colors: { tops: "#f97316", bottoms: "#1e293b", hair: "#252027", body: "#b87855", face: "#b87855" },
  },
  // 추가 10종 (장르 다양성: 웹툰·판타지·현대·전통·코스프레)
  {
    id: "idol",
    name: "아이돌 스테이지",
    emoji: "🎤",
    colors: { tops: "#f472b6", bottoms: "#1e293b", hair: "#e0f2fe", body: "#ffe4e6", face: "#ffedd5" },
  },
  {
    id: "samurai",
    name: "사무라이",
    emoji: "🗡️",
    colors: { tops: "#334155", bottoms: "#1e293b", hair: "#0f172a", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "witch",
    name: "마녀",
    emoji: "🧙‍♀️",
    colors: { tops: "#312e81", bottoms: "#1e1b4b", hair: "#64748b", body: "#c084fc", face: "#c084fc" },
  },
  {
    id: "pirate",
    name: "해적",
    emoji: "🏴‍☠️",
    colors: { tops: "#334155", bottoms: "#1e293b", hair: "#854d0e", body: "#fed7aa", face: "#ffedd5" },
  },
  {
    id: "hanbok",
    name: "한복",
    emoji: "👘",
    colors: { tops: "#b91c1c", bottoms: "#166534", hair: "#1e293b", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "maid",
    name: "메이드",
    emoji: "🧹",
    colors: { tops: "#1e293b", bottoms: "#1e293b", hair: "#f3e8ff", body: "#fff1f2", face: "#ffedd5" },
  },
  {
    id: "butler",
    name: "집사/신사",
    emoji: "🎩",
    colors: { tops: "#0f172a", bottoms: "#0f172a", hair: "#1e293b", body: "#f1f5f9", face: "#ffedd5" },
  },
  {
    id: "superhero",
    name: "히어로",
    emoji: "🦸",
    colors: { tops: "#1e40af", bottoms: "#1e3a8a", hair: "#f8fafc", body: "#e0f2fe", face: "#ffedd5" },
  },
  {
    id: "qipao",
    name: "치파오",
    emoji: "🪭",
    colors: { tops: "#9f1239", bottoms: "#9f1239", hair: "#1e293b", body: "#ffedd5", face: "#ffedd5" },
  },
  {
    id: "street",
    name: "스트릿 패션",
    emoji: "🧢",
    colors: { tops: "#334155", bottoms: "#1e293b", hair: "#f59e0b", body: "#fef3c7", face: "#ffedd5" },
  },
];

// 우측 컨트롤 패널 탭 — 16개 섹션을 작업 흐름별로 묶어 탐색 부담을 줄인다.
export type PanelTab = "character" | "pose" | "face" | "scene" | "props";
export const PANEL_TABS: Array<{ id: PanelTab; label: string; icon: typeof UserRound; hint: string }> = [
  { id: "character", label: "캐릭터", icon: UserRound, hint: "모델 · 의상 · 색상" },
  { id: "pose", label: "포즈", icon: PersonStanding, hint: "프리셋 · 관절 · 대기" },
  { id: "face", label: "표정", icon: Smile, hint: "표정 · 블렌드 · 웹캠" },
  { id: "scene", label: "연출", icon: Clapperboard, hint: "카메라 · 조명 · 물리" },
  { id: "props", label: "소품", icon: Swords, hint: "부착 · 배치" },
];

export type CharacterPanelSection = "library" | "forge" | "appearance" | "wardrobe" | "surface";
export const CHARACTER_PANEL_SECTIONS: Array<{
  id: CharacterPanelSection;
  label: string;
  icon: typeof UserRound;
}> = [
  { id: "library", label: "모델", icon: Upload },
  { id: "forge", label: "조형", icon: Sparkles },
  { id: "appearance", label: "체형·색", icon: Sliders },
  { id: "wardrobe", label: "의상", icon: Shirt },
  { id: "surface", label: "표면", icon: Paintbrush },
];

export const ENV_VARIANTS: Array<{ id: EnvVariant; label: string }> = [
  { id: "none", label: "없음" },
  { id: "floor", label: "바닥" },
  { id: "wall", label: "벽" },
  { id: "room", label: "방" },
  { id: "outdoor", label: "야외" },
];
export const HAND_SHAPE_PRESETS = [
  { id: "fist", label: "주먹" },
  { id: "open", label: "보" },
  { id: "point", label: "가리키기" },
  { id: "peace", label: "브이" },
  { id: "thumbsUp", label: "따봉" },
  { id: "holding", label: "무기 쥐기" },
  { id: "phoneGrip", label: "스마트폰" },
  { id: "penGrip", label: "펜 쥐기" },
  { id: "fingerHeart", label: "손가락 하트" },
  { id: "cupGrip", label: "찻잔 잡기" },
  { id: "rockRoll", label: "락/파이팅" },
  { id: "okSign", label: "OK 수신호" },
  { id: "relaxed", label: "기본" },
] as const;

export const NEUTRAL_EXPRESSION_ACTION: ExpressionAction = { id: "neutral", label: "초기화", name: null, tone: "리셋" };
export const EXPRESSION_LABELS: Record<string, string> = {
  happy: "행복",
  angry: "화남",
  sad: "슬픔",
  relaxed: "편안",
  surprised: "놀람",
  blink: "눈감음",
  blinkLeft: "왼쪽 눈",
  blinkRight: "오른쪽 눈",
  aa: "입모양 A",
  ih: "입모양 I",
  ou: "입모양 U",
  ee: "입모양 E",
  oh: "입모양 O",
  lookUp: "시선 위",
  lookDown: "시선 아래",
  lookLeft: "시선 왼쪽",
  lookRight: "시선 오른쪽",
};
export const EXPRESSION_ORDER = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: "front", label: "정면", position: [0, 1.42, 3.15], target: [0, 1.22, 0], fov: 30 },
  { id: "threeQuarter", label: "사선", position: [1.55, 1.48, 2.75], target: [0, 1.2, 0], fov: 31 },
  { id: "low", label: "로우", position: [0.52, 0.92, 3.02], target: [0, 1.18, 0], fov: 32 },
  { id: "wideAction", label: "광각 액션", position: [0.35, 0.65, 2.15], target: [0, 1.25, 0], fov: 52 },
  { id: "bust", label: "상반신", position: [0, 1.68, 2.1], target: [0, 1.45, 0], fov: 27 },
  { id: "dramaticEye", label: "시선 집중", position: [0, 1.48, 1.65], target: [0, 1.42, 0], fov: 22 },
  { id: "high", label: "하이 앵글", position: [0, 2.2, 2.8], target: [0, 1.2, 0], fov: 28 },
  { id: "extremeLow", label: "웅장한 앵글", position: [0.1, 0.4, 2.5], target: [0, 1.3, 0], fov: 36 },
  { id: "closeup", label: "얼굴 줌", position: [0, 1.55, 1.25], target: [0, 1.5, 0], fov: 25 },
  { id: "profile", label: "측면", position: [2.8, 1.4, 0.35], target: [0, 1.25, 0], fov: 30 },
  { id: "overShoulder", label: "어깨 너머", position: [-1.35, 1.55, 1.85], target: [0.2, 1.35, 0], fov: 32 },
  { id: "fullBody", label: "전신", position: [0, 1.05, 4.4], target: [0, 0.95, 0], fov: 34 },
  { id: "dutch", label: "더치 앵글", position: [1.2, 1.35, 2.6], target: [0, 1.25, 0], fov: 33 },
  { id: "topDown", label: "탑 다운", position: [0.2, 3.4, 1.2], target: [0, 1.1, 0], fov: 36 },
  { id: "birdEyeIsometric", label: "조감도 쿼터뷰", position: [2.4, 3.1, 2.6], target: [0, 0.7, 0], fov: 24 },
  { id: "back", label: "후면", position: [0, 1.25, -3.15], target: [0, 1.22, 0], fov: 30 },
  { id: "profileReverse", label: "반대 측면", position: [-2.8, 1.4, 0.35], target: [0, 1.25, 0], fov: 30 },
  { id: "inspectTorso", label: "상의·허리 확대", position: [0, 1.25, 2], target: [0, 1.2, 0], fov: 30 },
  { id: "inspectTorsoBack", label: "등·착장 확대", position: [0, 1.25, -2], target: [0, 1.2, 0], fov: 30 },
  { id: "inspectLowerBody", label: "하의 확대", position: [0.2, 0.8, 2], target: [0, 0.7, 0], fov: 30 },
  { id: "inspectFeet", label: "신발·접지 확대", position: [0.4, 0.4, 1.4], target: [0, 0.1, 0], fov: 30 },
  { id: "inspectLeftHand", label: "왼손·그립 확대", position: [0.25, 1.1, 1.5], target: [0, 1, 0], fov: 30 },
  { id: "inspectRightHand", label: "오른손·그립 확대", position: [-0.25, 1.1, 1.5], target: [0, 1, 0], fov: 30 },
];

export const BONE_LABELS: Record<string, string> = {
  hips: "골반 (Hips)",
  head: "머리 (Head)",
  neck: "목 (Neck)",
  spine: "척추 (Spine)",
  chest: "가슴 (Chest)",
  upperChest: "윗가슴 (Upper Chest)",
  leftEye: "왼쪽 눈 (L Eye)",
  rightEye: "오른쪽 눈 (R Eye)",
  jaw: "턱 (Jaw)",
  leftShoulder: "왼쪽 쇄골/어깨 (L Shoulder)",
  rightShoulder: "오른쪽 쇄골/어깨 (R Shoulder)",
  leftUpperArm: "왼쪽 어깨 (L Upper Arm)",
  rightUpperArm: "오른쪽 어깨 (R Upper Arm)",
  leftLowerArm: "왼쪽 팔꿈치 (L Lower Arm)",
  rightLowerArm: "오른쪽 팔꿈치 (R Lower Arm)",
  leftHand: "왼쪽 손목 (L Hand)",
  rightHand: "오른쪽 손목 (R Hand)",
  leftUpperLeg: "왼쪽 고관절 (L Upper Leg)",
  rightUpperLeg: "오른쪽 고관절 (R Upper Leg)",
  leftLowerLeg: "왼쪽 무릎 (L Lower Leg)",
  rightLowerLeg: "오른쪽 무릎 (R Lower Leg)",
  leftFoot: "왼쪽 발목 (L Foot)",
  rightFoot: "오른쪽 발목 (R Foot)",
  leftToes: "왼쪽 발끝 (L Toes)",
  rightToes: "오른쪽 발끝 (R Toes)",
  // finger labels (detailed per-finger editing)
  leftThumbMetacarpal: "왼 엄지 중수 (L Thumb MC)",
  leftThumbProximal: "왼 엄지 근위 (L Thumb Prox)",
  leftThumbDistal: "왼 엄지 말단 (L Thumb Dist)",
  leftIndexProximal: "왼 검지 근위",
  leftIndexIntermediate: "왼 검지 중간",
  leftIndexDistal: "왼 검지 말단",
  leftMiddleProximal: "왼 중지 근위",
  leftMiddleIntermediate: "왼 중지 중간",
  leftMiddleDistal: "왼 중지 말단",
  leftRingProximal: "왼 약지 근위",
  leftRingIntermediate: "왼 약지 중간",
  leftRingDistal: "왼 약지 말단",
  leftLittleProximal: "왼 소지 근위",
  leftLittleIntermediate: "왼 소지 중간",
  leftLittleDistal: "왼 소지 말단",
  rightThumbMetacarpal: "오른 엄지 중수",
  rightThumbProximal: "오른 엄지 근위",
  rightThumbDistal: "오른 엄지 말단",
  rightIndexProximal: "오른 검지 근위",
  rightIndexIntermediate: "오른 검지 중간",
  rightIndexDistal: "오른 검지 말단",
  rightMiddleProximal: "오른 중지 근위",
  rightMiddleIntermediate: "오른 중지 중간",
  rightMiddleDistal: "오른 중지 말단",
  rightRingProximal: "오른 약지 근위",
  rightRingIntermediate: "오른 약지 중간",
  rightRingDistal: "오른 약지 말단",
  rightLittleProximal: "오른 소지 근위",
  rightLittleIntermediate: "오른 소지 중간",
  rightLittleDistal: "오른 소지 말단",
};

export const BONE_CATEGORIES: Array<{ id: string; label: string; bones: VRMHumanBoneName[] }> = [
  { id: "head", label: "머리/목", bones: ["head", "neck"] },
  { id: "gaze", label: "시선/턱", bones: ["leftEye", "rightEye", "jaw"] },
  { id: "torso", label: "골반/몸통", bones: ["hips", "spine", "chest", "upperChest"] },
  { id: "rightArm", label: "오른팔", bones: ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"] },
  { id: "leftArm", label: "왼팔", bones: ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"] },
  { id: "rightLeg", label: "오른다리", bones: ["rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"] },
  { id: "leftLeg", label: "왼다리", bones: ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"] },
  { id: "leftFingers", label: "왼손가락", bones: POSER_FINGER_BONES.filter((b) => b.startsWith("left")) as VRMHumanBoneName[] },
  { id: "rightFingers", label: "오른손가락", bones: POSER_FINGER_BONES.filter((b) => b.startsWith("right")) as VRMHumanBoneName[] },
];

export const STUDIO_VRM_IK_NOT_CONVERGED_STATUS =
  "전신 IK가 안정적으로 수렴하지 않아 미리보기를 취소하고 시작 자세로 되돌렸습니다. 목표를 몸 가까이 옮기거나 고정점을 줄인 뒤 다시 시도해 주세요.";

export const STUDIO_VRM_IK_DRAG_MODES: readonly {
  id: StudioVrmIkDragMode;
  label: string;
  description: string;
}[] = Object.freeze([
  { id: "screen", label: "화면", description: "화면과 나란한 평면에서 이동" },
  { id: "depth", label: "깊이", description: "위로 끌면 멀리, 아래로 끌면 가까이 이동" },
]);

export const STUDIO_VRM_IK_AXIS_LOCKS: readonly {
  id: StudioVrmIkAxisLock;
  label: string;
  description: string;
}[] = Object.freeze([
  { id: "free", label: "자유", description: "축 제한 없이 이동" },
  { id: "x", label: "X", description: "장면 X축으로만 이동" },
  { id: "y", label: "Y", description: "장면 Y축으로만 이동" },
  { id: "z", label: "Z", description: "장면 Z축으로만 이동" },
]);

export const PROP_CATEGORY_LABELS: Record<string, string> = { animal: "동물", item: "아이템", effect: "이펙트" };
