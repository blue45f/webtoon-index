// 절차형 아바타 조형(헤어/얼굴 디테일)의 순수 코어.
//
// v2에서 헤어 스타일 7종 → 14종, 앞머리 형태(bangStyle)·웨이브(wave)·삐침머리(ahoge)·
// 묶음 높이(tailHeight) 파라미터가 추가됐다. v3에서는 기존 VRM 리그를 유지하는 안전 범위의
// 체형 실루엣과 결정론적 체형 프리셋을 추가했다. v4에서는 체형의 단일 권위를
// studio-vrm-proportion-core의 관절 이동 기반 비율로 승격한다. 기존 body는 UI/저장본 호환 뷰로
// 유지하지만, 새 런타임은 반드시 proportions를 사용해야 한다.
//
// ⚠ 하위호환 계약(회귀 금지)
//   v1로 저장된 AvatarForgeState는 buildAvatarForgeHairParts에서 **바이트 단위로 동일한**
//   파츠 계획을 만들어야 한다. 그래서
//     1) v2 신규 파라미터의 기본값은 전부 "v1 무동작" 값이고(bangStyle="full", wave=0,
//        ahoge=0, tailHeight=0.5),
//     2) 기본값일 때는 v1과 동일한 산술식(×1, +0)만 타도록 작성했으며,
//     3) 파츠에 붙는 신규 필드(wave/waveFrequency)는 값이 0일 때 **키 자체를 만들지 않는다**
//        (JSON.stringify 결과가 v1과 문자 단위로 같아야 하므로).
//   studio-vrm-avatar-forge.test.ts의 V1_GEOMETRY_DIGESTS가 이 계약을 SHA-256으로 잠근다.

import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  sanitizeStudioVrmProportions,
  type StudioVrmProportions,
} from "./studio-vrm-proportion-core";

export const AVATAR_FORGE_VERSION = 4 as const;

/** v1 문서를 현재 스키마로 승격할 때 강제되는 "v1과 동일한 렌더" 파라미터. */
const V1_EQUIVALENT_HAIR = {
  bangStyle: "full",
  wave: 0,
  ahoge: 0,
  tailHeight: 0.5,
} as const;

export type AvatarForgeHairStyle =
  | "none"
  | "short"
  | "bob"
  | "long"
  | "ponytail"
  | "twintail"
  | "bun"
  // ── v2 추가 ──
  | "wavy"
  | "braid"
  | "twin-braid"
  | "hime"
  | "wolf"
  | "half-up"
  | "pixie";

/** 앞머리 형태 — 스타일과 독립적으로 조합된다(v2). */
export type AvatarForgeBangStyle = "full" | "split" | "side-swept" | "curtain" | "blunt" | "none";

export type AvatarForgeFaceAccentId = "blush" | "freckles" | "beauty-mark";

export type AvatarForgeFaceParams = {
  headWidth: number;
  headHeight: number;
  headDepth: number;
  cheekVolume: number;
  chinLength: number;
};

export const AVATAR_FORGE_SEMANTIC_FACE_MORPH_IDS = [
  "eyeSize",
  "eyeSpacing",
  "eyeTilt",
  "irisSize",
  "noseHeight",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "earSize",
] as const;

export type AvatarForgeSemanticFaceMorphId =
  (typeof AVATAR_FORGE_SEMANTIC_FACE_MORPH_IDS)[number];

/**
 * Optional model-native shape-key values. Zero values are omitted so v1-v4 documents and
 * geometry-plan digests remain byte-compatible.
 */
export type AvatarForgeSemanticFaceMorphState =
  Partial<Record<AvatarForgeSemanticFaceMorphId, number>>;

export type AvatarForgeBodyParams = {
  shoulderWidth: number;
  torsoLength: number;
  /**
   * @deprecated v3 호환 메타데이터. proportion core에는 골반 폭 파라미터가 없으며,
   * 이 값을 메시 볼륨/비균등 스케일로 해석하면 안 된다.
   */
  hipWidth: number;
  armLength: number;
  legLength: number;
};

export type AvatarForgeBodyPresetId =
  | "balanced"
  | "hero"
  | "long-line"
  | "compact"
  | "soft";

export type AvatarForgeHairParams = {
  style: AvatarForgeHairStyle;
  replaceOriginal: boolean;
  volume: number;
  length: number;
  strandWidth: number;
  fringe: number;
  curl: number;
  shine: number;
  baseColor: string;
  /** Optional authored cel-shadow colour. Omitted legacy states derive it from baseColor. */
  shadowColor?: string;
  tipColor: string;
  /** v2: 앞머리 형태. "full"이 v1과 동일한 3가닥 뱅. */
  bangStyle: AvatarForgeBangStyle;
  /** v2: 웨이브 진폭(0=직모). 0일 때 파츠에 wave 키가 생기지 않는다. */
  wave: number;
  /** v2: 삐침머리 길이(0=없음). */
  ahoge: number;
  /** v2: 묶음(포니/트윈/번/하프업) 높이. 0.5가 v1 위치. */
  tailHeight: number;
};

export type AvatarForgeFaceAccent = {
  id: AvatarForgeFaceAccentId;
  enabled: boolean;
  color: string;
  intensity: number;
};

export type AvatarForgeState = {
  version: typeof AVATAR_FORGE_VERSION;
  presetId?: string;
  bodyPresetId?: AvatarForgeBodyPresetId;
  face: AvatarForgeFaceParams;
  /**
   * Exact model-native shape keys only. Missing targets remain unsupported instead of being
   * approximated through whole-head scaling.
   */
  semanticFaceMorphs?: AvatarForgeSemanticFaceMorphState;
  /**
   * v4 체형의 단일 권위. 관절을 이동하고 말단만 균등 스케일하는 안전한 비율 코어 상태다.
   */
  proportions: StudioVrmProportions;
  /**
   * @deprecated v3 UI/런타임 호환 뷰. v4에서는 proportions에서 결정적으로 투영된다.
   */
  body: AvatarForgeBodyParams;
  /**
   * v3 hipWidth의 손실 없는 보존값. proportion core가 골반 관절 간격 파라미터를 지원하기 전까지
   * 렌더 비율로 해석하지 않는 저장 메타데이터다. 중립값(1)은 생략한다.
   */
  legacyHipWidth?: number;
  hair: AvatarForgeHairParams;
  faceAccents?: AvatarForgeFaceAccent[];
};

export type AvatarForgeNumericLimit = {
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type AvatarForgeHairPart = {
  id: string;
  role: "cap" | "bang" | "side" | "back" | "tail" | "bun" | "braid" | "ahoge";
  primitive: "ellipsoid" | "tapered-capsule" | "sphere";
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
  baseColor: string;
  /** Optional authored cel-shadow colour. Omitted legacy states derive it from baseColor. */
  shadowColor?: string;
  tipColor: string;
  taper: number;
  curl: number;
  shine: number;
  /**
   * v2 웨이브 진폭. **0이면 이 키가 존재하지 않는다** — v1 계획과의 바이트 동일성 계약.
   * 렌더러(StudioVrmAvatarForge.tsx)는 `part.wave ?? 0`으로 읽고 0이면 v1 경로를 그대로 탄다.
   */
  wave?: number;
  /** v2 웨이브 주기(파장 수). wave와 항상 짝으로만 존재한다. */
  waveFrequency?: number;
};

export type AvatarForgePreset = {
  id: string;
  label: string;
  hint: string;
  emoji: string;
  state: AvatarForgeState;
};

export const AVATAR_FORGE_FACE_LIMITS: Record<keyof AvatarForgeFaceParams, AvatarForgeNumericLimit> = {
  headWidth: { label: "얼굴 너비", min: 0.84, max: 1.18, step: 0.01, unit: "×" },
  headHeight: { label: "얼굴 길이", min: 0.86, max: 1.16, step: 0.01, unit: "×" },
  headDepth: { label: "얼굴 입체감", min: 0.88, max: 1.14, step: 0.01, unit: "×" },
  cheekVolume: { label: "볼륨", min: 0, max: 1, step: 0.01 },
  chinLength: { label: "턱 길이", min: 0.88, max: 1.14, step: 0.01, unit: "×" },
};

export const AVATAR_FORGE_BODY_LIMITS: Record<keyof AvatarForgeBodyParams, AvatarForgeNumericLimit> = {
  shoulderWidth: { label: "어깨 너비", min: 0.88, max: 1.14, step: 0.01, unit: "×" },
  torsoLength: { label: "몸통 길이", min: 0.9, max: 1.12, step: 0.01, unit: "×" },
  hipWidth: { label: "골반 너비", min: 0.9, max: 1.12, step: 0.01, unit: "×" },
  armLength: { label: "팔 길이", min: 0.92, max: 1.1, step: 0.01, unit: "×" },
  legLength: { label: "다리 길이", min: 0.92, max: 1.12, step: 0.01, unit: "×" },
};

export type AvatarForgeHairLimitKey =
  | "volume"
  | "length"
  | "strandWidth"
  | "fringe"
  | "curl"
  | "shine"
  | "wave"
  | "ahoge"
  | "tailHeight";

export const AVATAR_FORGE_HAIR_LIMITS: Record<AvatarForgeHairLimitKey, AvatarForgeNumericLimit> = {
  volume: { label: "전체 볼륨", min: 0.72, max: 1.45, step: 0.01, unit: "×" },
  length: { label: "길이", min: 0.55, max: 1.7, step: 0.01, unit: "×" },
  strandWidth: { label: "모발 굵기", min: 0.68, max: 1.45, step: 0.01, unit: "×" },
  fringe: { label: "앞머리", min: 0.2, max: 1.35, step: 0.01, unit: "×" },
  curl: { label: "컬", min: 0, max: 1, step: 0.01 },
  shine: { label: "윤기", min: 0, max: 1, step: 0.01 },
  wave: { label: "웨이브", min: 0, max: 1, step: 0.01 },
  ahoge: { label: "삐침머리", min: 0, max: 1, step: 0.01 },
  tailHeight: { label: "묶음 높이", min: 0, max: 1, step: 0.01 },
};

export const AVATAR_FORGE_HAIR_STYLE_OPTIONS: ReadonlyArray<{
  id: AvatarForgeHairStyle;
  label: string;
  emoji: string;
  hint: string;
}> = [
  { id: "none", label: "헤어 없음", emoji: "◌", hint: "추가 헤어 파츠를 끕니다." },
  { id: "short", label: "숏", emoji: "✦", hint: "가벼운 숏 커트" },
  { id: "bob", label: "보브", emoji: "●", hint: "턱선 보브 커트" },
  { id: "long", label: "롱", emoji: "│", hint: "등을 따라 흐르는 긴 머리" },
  { id: "ponytail", label: "포니테일", emoji: "◒", hint: "뒤로 묶은 활동적인 헤어" },
  { id: "twintail", label: "트윈테일", emoji: "◖◗", hint: "양쪽으로 묶은 헤어" },
  { id: "bun", label: "번", emoji: "◎", hint: "단정하게 올린 번 헤어" },
  { id: "wavy", label: "웨이브 롱", emoji: "〰", hint: "굵은 웨이브가 흐르는 롱 헤어" },
  { id: "braid", label: "땋은 머리", emoji: "⛓", hint: "뒤로 한 갈래로 땋아 내린 머리" },
  { id: "twin-braid", label: "양갈래 땋기", emoji: "⋈", hint: "양쪽으로 땋아 내린 머리" },
  { id: "hime", label: "히메컷", emoji: "▤", hint: "일자 사이드락 + 긴 생머리" },
  { id: "wolf", label: "울프컷", emoji: "◤", hint: "윗머리는 짧고 뒷머리만 긴 레이어드" },
  { id: "half-up", label: "반묶음", emoji: "◐", hint: "윗머리만 묶고 나머지는 흘려 내린 헤어" },
  { id: "pixie", label: "픽시", emoji: "▵", hint: "짧게 친 경쾌한 커트" },
] as const;

export const AVATAR_FORGE_BANG_STYLE_OPTIONS: ReadonlyArray<{
  id: AvatarForgeBangStyle;
  label: string;
  emoji: string;
  hint: string;
}> = [
  { id: "full", label: "풀뱅", emoji: "▬", hint: "이마를 덮는 기본 3가닥 앞머리" },
  { id: "split", label: "가르마", emoji: "◭", hint: "가운데를 갈라 양옆으로 넘긴 앞머리" },
  { id: "side-swept", label: "사이드뱅", emoji: "◣", hint: "한쪽으로 길게 넘긴 비대칭 앞머리" },
  { id: "curtain", label: "커튼뱅", emoji: "◫", hint: "얼굴을 감싸는 긴 커튼 앞머리" },
  { id: "blunt", label: "일자뱅", emoji: "▭", hint: "가지런히 자른 일자 앞머리" },
  { id: "none", label: "앞머리 없음", emoji: "◌", hint: "이마를 드러낸 올백" },
] as const;

export const AVATAR_FORGE_FACE_ACCENT_OPTIONS: ReadonlyArray<{
  id: AvatarForgeFaceAccentId;
  label: string;
  hint: string;
}> = [
  { id: "blush", label: "홍조", hint: "볼에 부드러운 색을 더합니다." },
  { id: "freckles", label: "주근깨", hint: "코와 볼 주변에 작은 점을 더합니다." },
  { id: "beauty-mark", label: "매력점", hint: "얼굴에 작은 포인트를 더합니다." },
] as const;

const DEFAULT_FACE: AvatarForgeFaceParams = {
  headWidth: 1,
  headHeight: 1,
  headDepth: 1,
  cheekVolume: 0.35,
  chinLength: 1,
};

const DEFAULT_BODY: AvatarForgeBodyParams = {
  shoulderWidth: 1,
  torsoLength: 1,
  hipWidth: 1,
  armLength: 1,
  legLength: 1,
};

export type AvatarForgeBodyPreset = {
  readonly id: AvatarForgeBodyPresetId;
  readonly label: string;
  readonly hint: string;
  readonly emoji: string;
  readonly body: AvatarForgeBodyParams;
};

export const AVATAR_FORGE_BODY_PRESETS: readonly AvatarForgeBodyPreset[] = [
  {
    id: "balanced",
    label: "균형형",
    emoji: "◇",
    hint: "원본 비율을 유지하는 기본 실루엣",
    body: { ...DEFAULT_BODY },
  },
  {
    id: "hero",
    label: "히어로",
    emoji: "◆",
    hint: "넓은 어깨와 긴 팔다리의 또렷한 실루엣",
    body: { shoulderWidth: 1.1, torsoLength: 1.03, hipWidth: 0.96, armLength: 1.04, legLength: 1.06 },
  },
  {
    id: "long-line",
    label: "롱라인",
    emoji: "│",
    hint: "길어진 몸통과 다리의 세로형 실루엣",
    body: { shoulderWidth: 0.97, torsoLength: 1.07, hipWidth: 0.96, armLength: 1.05, legLength: 1.1 },
  },
  {
    id: "compact",
    label: "컴팩트",
    emoji: "●",
    hint: "짧은 팔다리와 안정적인 중심 실루엣",
    body: { shoulderWidth: 1.02, torsoLength: 0.95, hipWidth: 1.02, armLength: 0.95, legLength: 0.94 },
  },
  {
    id: "soft",
    label: "소프트",
    emoji: "◯",
    hint: "부드러운 어깨와 넓은 골반의 곡선 실루엣",
    body: { shoulderWidth: 0.94, torsoLength: 0.99, hipWidth: 1.08, armLength: 0.98, legLength: 0.99 },
  },
] as const;

const DEFAULT_HAIR: AvatarForgeHairParams = {
  style: "none",
  replaceOriginal: false,
  volume: 1,
  length: 1,
  strandWidth: 1,
  fringe: 0.75,
  curl: 0.15,
  shine: 0.42,
  baseColor: "#352a28",
  tipColor: "#6b5148",
  ...V1_EQUIVALENT_HAIR,
};

const DEFAULT_ACCENTS: AvatarForgeFaceAccent[] = [
  { id: "blush", enabled: false, color: "#ef8f9d", intensity: 0.35 },
  { id: "freckles", enabled: false, color: "#8b5c4a", intensity: 0.45 },
  { id: "beauty-mark", enabled: false, color: "#4b342f", intensity: 0.7 },
];

export const DEFAULT_AVATAR_FORGE_STATE: AvatarForgeState = {
  version: AVATAR_FORGE_VERSION,
  bodyPresetId: "balanced",
  face: { ...DEFAULT_FACE },
  proportions: sanitizeStudioVrmProportions(NEUTRAL_STUDIO_VRM_PROPORTIONS),
  body: { ...DEFAULT_BODY },
  hair: { ...DEFAULT_HAIR },
  faceAccents: DEFAULT_ACCENTS.map((accent) => ({ ...accent })),
};

function preset(
  id: string,
  label: string,
  emoji: string,
  hint: string,
  face: Partial<AvatarForgeFaceParams>,
  hair: Partial<AvatarForgeHairParams>,
  accents: Partial<Record<AvatarForgeFaceAccentId, Partial<AvatarForgeFaceAccent>>> = {}
): AvatarForgePreset {
  const faceAccents = DEFAULT_ACCENTS.map((accent) => ({ ...accent, ...accents[accent.id] }));
  return {
    id,
    label,
    emoji,
    hint,
    state: {
      version: AVATAR_FORGE_VERSION,
      presetId: id,
      bodyPresetId: "balanced",
      face: { ...DEFAULT_FACE, ...face },
      proportions: sanitizeStudioVrmProportions(NEUTRAL_STUDIO_VRM_PROPORTIONS),
      body: { ...DEFAULT_BODY },
      hair: { ...DEFAULT_HAIR, ...hair },
      faceAccents,
    },
  };
}

export const AVATAR_FORGE_PRESETS: ReadonlyArray<AvatarForgePreset> = [
  preset("natural-short", "내추럴 숏", "🌿", "현대극 주인공에 잘 맞는 자연스러운 숏", {}, { style: "short" }),
  preset("soft-bob", "소프트 보브", "☁️", "둥근 얼굴과 부드러운 보브", { headWidth: 1.05, cheekVolume: 0.62 }, { style: "bob", curl: 0.28, baseColor: "#4a302b", tipColor: "#8a6257" }, { blush: { enabled: true, intensity: 0.28 } }),
  preset("romance-long", "로맨스 롱", "🌙", "로맨스 판타지 컷에 어울리는 긴 실루엣", { headHeight: 1.04, chinLength: 1.05 }, { style: "long", length: 1.3, shine: 0.68, baseColor: "#2c253f", tipColor: "#725d8d" }),
  preset("action-pony", "액션 포니", "⚡", "움직임이 또렷한 높은 포니테일", { headWidth: 0.97 }, { style: "ponytail", length: 1.12, volume: 1.08, curl: 0.18, baseColor: "#222936", tipColor: "#485a70" }),
  preset("pop-twin", "팝 트윈", "🎧", "아이돌·학원물용 트윈테일", { headWidth: 1.04, cheekVolume: 0.55 }, { style: "twintail", volume: 1.12, length: 1.08, curl: 0.55, baseColor: "#33274f", tipColor: "#c064a2" }, { blush: { enabled: true } }),
  preset("elegant-bun", "엘리건트 번", "✨", "사극·오피스·의료 장면에 단정한 올림머리", { headHeight: 1.02 }, { style: "bun", volume: 0.95, shine: 0.55, baseColor: "#29211f", tipColor: "#59443e" }),
  preset("androgynous-crop", "앤드로지너스", "◇", "성별 표현에 구애받지 않는 짧은 커트", { headWidth: 0.96, headHeight: 1.04, chinLength: 1.04 }, { style: "short", fringe: 0.48, volume: 0.9, baseColor: "#3b3d42", tipColor: "#747980" }),
  preset("silver-senior", "실버 시니어", "🕊️", "중·노년 캐릭터용 은빛 보브", { headWidth: 1.04, cheekVolume: 0.48 }, { style: "bob", volume: 0.9, curl: 0.12, shine: 0.28, baseColor: "#a7a6a2", tipColor: "#e4e1db" }, { freckles: { enabled: true, intensity: 0.24 } }),
  preset("fiery-long", "파이어 롱", "🔥", "강렬한 붉은 긴 머리", { headWidth: 0.98 }, { style: "long", length: 1.25, volume: 1.15, shine: 0.72, baseColor: "#7f1d1d", tipColor: "#f97316" }, { blush: { enabled: true, intensity: 0.35, color: "#fb7185" } }),
  preset("mint-bob", "민트 보브", "🧊", "시원한 민트 보브", { cheekVolume: 0.58, headWidth: 1.03 }, { style: "bob", curl: 0.22, baseColor: "#134e4a", tipColor: "#5eead4" }, { freckles: { enabled: true, intensity: 0.18 } }),
  preset("gold-pony", "골드 포니", "🌟", "밝은 금발 포니테일", { chinLength: 1.02 }, { style: "ponytail", length: 1.18, shine: 0.8, baseColor: "#a16207", tipColor: "#fde68a" }),
  preset("ink-twin", "잉크 트윈", "🖤", "흑발 트윈테일", { headHeight: 1.03 }, { style: "twintail", volume: 1.08, curl: 0.4, baseColor: "#0f172a", tipColor: "#334155" }, { "beauty-mark": { enabled: true, intensity: 0.5 } }),
  preset("sakura-bun", "벚꽃 번", "🌸", "분홍 톤 올림머리", { cheekVolume: 0.7, headWidth: 1.04 }, { style: "bun", volume: 1.0, baseColor: "#9d174d", tipColor: "#fbcfe8" }, { blush: { enabled: true, intensity: 0.4 } }),
  preset("hero-crop", "히어로 크롭", "🦸", "단정한 액션 숏컷", { headWidth: 0.95, chinLength: 1.06 }, { style: "short", fringe: 0.4, volume: 0.88, baseColor: "#1e293b", tipColor: "#64748b" }),
  // ── v2 신규 스타일 프리셋 ──
  preset("wave-diva", "웨이브 디바", "💃", "굵은 웨이브가 흐르는 롱 헤어", { headWidth: 1.02 }, { style: "wavy", length: 1.35, volume: 1.18, wave: 0.7, bangStyle: "curtain", shine: 0.7, baseColor: "#3f1d2b", tipColor: "#b06a7a" }),
  preset("braid-scholar", "브레이드 스칼라", "📚", "차분한 한 갈래 땋은 머리", { headHeight: 1.02 }, { style: "braid", length: 1.15, bangStyle: "split", tailHeight: 0.42, baseColor: "#2f2620", tipColor: "#6b5340" }),
  preset("twin-braid-village", "트윈 브레이드", "🌾", "소박한 양갈래 땋기", { cheekVolume: 0.6, headWidth: 1.04 }, { style: "twin-braid", length: 1.05, bangStyle: "blunt", ahoge: 0.5, baseColor: "#6b4a22", tipColor: "#c99b52" }, { freckles: { enabled: true, intensity: 0.3 } }),
  preset("hime-noble", "히메 노블", "🏮", "일자 사이드락의 정통 히메컷", { headHeight: 1.03 }, { style: "hime", length: 1.3, bangStyle: "blunt", shine: 0.62, baseColor: "#141024", tipColor: "#3f3663" }),
  preset("wolf-rebel", "울프 레벨", "🎸", "거친 레이어드 울프컷", { headWidth: 0.96, chinLength: 1.05 }, { style: "wolf", length: 1.2, volume: 1.1, wave: 0.35, bangStyle: "side-swept", baseColor: "#1f2937", tipColor: "#9ca3af" }),
  preset("halfup-idol", "하프업 아이돌", "🎤", "반묶음에 삐침머리 한 가닥", { cheekVolume: 0.6 }, { style: "half-up", length: 1.12, tailHeight: 0.74, ahoge: 0.65, bangStyle: "split", baseColor: "#4c1d95", tipColor: "#c4b5fd" }, { blush: { enabled: true, intensity: 0.3 } }),
  preset("pixie-sport", "픽시 스포츠", "🏃", "짧고 가벼운 픽시 커트", { headWidth: 0.95, chinLength: 1.05 }, { style: "pixie", length: 0.7, volume: 0.86, bangStyle: "side-swept", baseColor: "#111827", tipColor: "#4b5563" }),
] as const;

const HAIR_STYLE_IDS = new Set<AvatarForgeHairStyle>(AVATAR_FORGE_HAIR_STYLE_OPTIONS.map((option) => option.id));
const BANG_STYLE_IDS = new Set<AvatarForgeBangStyle>(AVATAR_FORGE_BANG_STYLE_OPTIONS.map((option) => option.id));
const ACCENT_IDS = new Set<AvatarForgeFaceAccentId>(AVATAR_FORGE_FACE_ACCENT_OPTIONS.map((option) => option.id));
const BODY_PRESET_IDS = new Set<AvatarForgeBodyPresetId>(
  AVATAR_FORGE_BODY_PRESETS.map((option) => option.id),
);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clampNumber(value: unknown, limit: AvatarForgeNumericLimit, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(limit.max, Math.max(limit.min, numeric));
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeAvatarForgeSemanticFaceMorphs(
  raw: unknown,
): AvatarForgeSemanticFaceMorphState | undefined {
  const source = record(raw);
  const next: AvatarForgeSemanticFaceMorphState = {};
  for (const id of AVATAR_FORGE_SEMANTIC_FACE_MORPH_IDS) {
    const numeric = typeof source[id] === "number" ? source[id] : Number(source[id]);
    if (!Number.isFinite(numeric)) continue;
    const bounded = Math.min(1, Math.max(-1, numeric));
    if (Math.abs(bounded) >= 0.0001) next[id] = bounded;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeLegacyAvatarForgeBody(raw: unknown): AvatarForgeBodyParams {
  const body = record(raw);
  return {
    shoulderWidth: clampNumber(
      body.shoulderWidth,
      AVATAR_FORGE_BODY_LIMITS.shoulderWidth,
      DEFAULT_BODY.shoulderWidth,
    ),
    torsoLength: clampNumber(
      body.torsoLength,
      AVATAR_FORGE_BODY_LIMITS.torsoLength,
      DEFAULT_BODY.torsoLength,
    ),
    hipWidth: clampNumber(
      body.hipWidth,
      AVATAR_FORGE_BODY_LIMITS.hipWidth,
      DEFAULT_BODY.hipWidth,
    ),
    armLength: clampNumber(
      body.armLength,
      AVATAR_FORGE_BODY_LIMITS.armLength,
      DEFAULT_BODY.armLength,
    ),
    legLength: clampNumber(
      body.legLength,
      AVATAR_FORGE_BODY_LIMITS.legLength,
      DEFAULT_BODY.legLength,
    ),
  };
}

/**
 * v3 body를 v4 관절 비율로 승격한다. 네 길이/간격 컨트롤만 의미가 정확히 대응한다.
 * hipWidth는 proportion core에 대응 파라미터가 없으므로 의도적으로 읽지 않는다.
 */
export function migrateAvatarForgeBodyToStudioVrmProportions(
  body: unknown,
  base: unknown = NEUTRAL_STUDIO_VRM_PROPORTIONS,
): StudioVrmProportions {
  const legacy = sanitizeLegacyAvatarForgeBody(body);
  const canonicalBase = sanitizeStudioVrmProportions(base);
  return sanitizeStudioVrmProportions({
    ...canonicalBase,
    presetId: undefined,
    shoulderWidth: legacy.shoulderWidth,
    torsoLength: legacy.torsoLength,
    armLength: legacy.armLength,
    legLength: legacy.legLength,
  });
}

function projectStudioVrmProportionsToLegacyBody(
  proportions: StudioVrmProportions,
  legacyHipWidth: number,
): AvatarForgeBodyParams {
  return sanitizeLegacyAvatarForgeBody({
    shoulderWidth: proportions.shoulderWidth,
    torsoLength: proportions.torsoLength,
    hipWidth: legacyHipWidth,
    armLength: proportions.armLength,
    legLength: proportions.legLength,
  });
}

/**
 * 문서에 적힌 스키마 버전. 숫자가 아니거나 비어 있으면 0(= v1 이전)으로 본다.
 * v2 전용 필드는 이 값이 2 미만이면 **문서에 무엇이 적혀 있든 무시**하고 v1 등가값으로 고정한다
 * (v1 문서가 신규 키를 가질 방법이 없으므로, 있다면 오염된 입력이다).
 */
function documentVersion(raw: unknown): number {
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function sanitizeAvatarForgeState(raw: unknown): AvatarForgeState {
  const source = record(raw);
  const face = record(source.face);
  const semanticFaceMorphs = sanitizeAvatarForgeSemanticFaceMorphs(
    source.semanticFaceMorphs,
  );
  const hair = record(source.hair);
  const sourceVersion = documentVersion(source.version);
  const legacy = sourceVersion < 2;
  const preBodySchema = sourceVersion < 3;
  const legacyBody = preBodySchema
    ? { ...DEFAULT_BODY }
    : sanitizeLegacyAvatarForgeBody(source.body);
  const hasCanonicalProportions = sourceVersion >= 4 && isRecord(source.proportions);
  const proportions = hasCanonicalProportions
    ? sanitizeStudioVrmProportions(source.proportions)
    : sourceVersion >= 3
      ? migrateAvatarForgeBodyToStudioVrmProportions(legacyBody)
      : sanitizeStudioVrmProportions(NEUTRAL_STUDIO_VRM_PROPORTIONS);
  const legacyHipWidth = sourceVersion >= 3
    ? clampNumber(
        sourceVersion >= 4 && source.legacyHipWidth !== undefined
          ? source.legacyHipWidth
          : legacyBody.hipWidth,
        AVATAR_FORGE_BODY_LIMITS.hipWidth,
        DEFAULT_BODY.hipWidth,
      )
    : DEFAULT_BODY.hipWidth;
  const resolvedBody = hasCanonicalProportions
    ? projectStudioVrmProportionsToLegacyBody(proportions, legacyHipWidth)
    : legacyBody;
  const style = HAIR_STYLE_IDS.has(hair.style as AvatarForgeHairStyle)
    ? (hair.style as AvatarForgeHairStyle)
    : DEFAULT_HAIR.style;
  const bangStyle = legacy
    ? V1_EQUIVALENT_HAIR.bangStyle
    : BANG_STYLE_IDS.has(hair.bangStyle as AvatarForgeBangStyle)
      ? (hair.bangStyle as AvatarForgeBangStyle)
      : DEFAULT_HAIR.bangStyle;
  const rawAccents = Array.isArray(source.faceAccents) ? source.faceAccents : [];
  const byId = new Map<AvatarForgeFaceAccentId, Record<string, unknown>>();
  for (const entry of rawAccents) {
    const parsed = record(entry);
    if (ACCENT_IDS.has(parsed.id as AvatarForgeFaceAccentId)) {
      byId.set(parsed.id as AvatarForgeFaceAccentId, parsed);
    }
  }

  return {
    version: AVATAR_FORGE_VERSION,
    ...(typeof source.presetId === "string" && source.presetId.trim()
      ? { presetId: source.presetId.trim().slice(0, 64) }
      : {}),
    ...(!preBodySchema && BODY_PRESET_IDS.has(source.bodyPresetId as AvatarForgeBodyPresetId)
      ? { bodyPresetId: source.bodyPresetId as AvatarForgeBodyPresetId }
      : {}),
    face: {
      headWidth: clampNumber(face.headWidth, AVATAR_FORGE_FACE_LIMITS.headWidth, DEFAULT_FACE.headWidth),
      headHeight: clampNumber(face.headHeight, AVATAR_FORGE_FACE_LIMITS.headHeight, DEFAULT_FACE.headHeight),
      headDepth: clampNumber(face.headDepth, AVATAR_FORGE_FACE_LIMITS.headDepth, DEFAULT_FACE.headDepth),
      cheekVolume: clampNumber(face.cheekVolume, AVATAR_FORGE_FACE_LIMITS.cheekVolume, DEFAULT_FACE.cheekVolume),
      chinLength: clampNumber(face.chinLength, AVATAR_FORGE_FACE_LIMITS.chinLength, DEFAULT_FACE.chinLength),
    },
    ...(semanticFaceMorphs ? { semanticFaceMorphs } : {}),
    proportions,
    body: resolvedBody,
    ...(legacyHipWidth !== DEFAULT_BODY.hipWidth ? { legacyHipWidth } : {}),
    hair: {
      style,
      replaceOriginal: hair.replaceOriginal === true,
      volume: clampNumber(hair.volume, AVATAR_FORGE_HAIR_LIMITS.volume, DEFAULT_HAIR.volume),
      length: clampNumber(hair.length, AVATAR_FORGE_HAIR_LIMITS.length, DEFAULT_HAIR.length),
      strandWidth: clampNumber(hair.strandWidth, AVATAR_FORGE_HAIR_LIMITS.strandWidth, DEFAULT_HAIR.strandWidth),
      fringe: clampNumber(hair.fringe, AVATAR_FORGE_HAIR_LIMITS.fringe, DEFAULT_HAIR.fringe),
      curl: clampNumber(hair.curl, AVATAR_FORGE_HAIR_LIMITS.curl, DEFAULT_HAIR.curl),
      shine: clampNumber(hair.shine, AVATAR_FORGE_HAIR_LIMITS.shine, DEFAULT_HAIR.shine),
      baseColor: color(hair.baseColor, DEFAULT_HAIR.baseColor),
      ...(typeof hair.shadowColor === "string" && HEX_COLOR.test(hair.shadowColor)
        ? { shadowColor: hair.shadowColor.toLowerCase() }
        : {}),
      tipColor: color(hair.tipColor, DEFAULT_HAIR.tipColor),
      bangStyle,
      wave: legacy
        ? V1_EQUIVALENT_HAIR.wave
        : clampNumber(hair.wave, AVATAR_FORGE_HAIR_LIMITS.wave, DEFAULT_HAIR.wave),
      ahoge: legacy
        ? V1_EQUIVALENT_HAIR.ahoge
        : clampNumber(hair.ahoge, AVATAR_FORGE_HAIR_LIMITS.ahoge, DEFAULT_HAIR.ahoge),
      tailHeight: legacy
        ? V1_EQUIVALENT_HAIR.tailHeight
        : clampNumber(hair.tailHeight, AVATAR_FORGE_HAIR_LIMITS.tailHeight, DEFAULT_HAIR.tailHeight),
    },
    faceAccents: DEFAULT_ACCENTS.map((fallback) => {
      const entry = byId.get(fallback.id) ?? {};
      return {
        id: fallback.id,
        enabled: entry.enabled === true,
        color: color(entry.color, fallback.color),
        intensity: clampNumber(
          entry.intensity,
          { label: "강도", min: 0, max: 1, step: 0.01 },
          fallback.intensity
        ),
      };
    }),
  };
}

export function parseAvatarForgeState(raw: unknown): AvatarForgeState {
  if (typeof raw === "string") {
    try {
      return sanitizeAvatarForgeState(JSON.parse(raw));
    } catch {
      return sanitizeAvatarForgeState(undefined);
    }
  }
  return sanitizeAvatarForgeState(raw);
}

export function serializeAvatarForgeState(raw: unknown): AvatarForgeState {
  return sanitizeAvatarForgeState(raw);
}

export function setAvatarForgeSemanticFaceMorph(
  state: AvatarForgeState,
  id: AvatarForgeSemanticFaceMorphId,
  value: number,
): AvatarForgeState {
  const current = sanitizeAvatarForgeState(state);
  const next: AvatarForgeSemanticFaceMorphState = {
    ...(current.semanticFaceMorphs ?? {}),
  };
  const bounded = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
  if (Math.abs(bounded) < 0.0001) delete next[id];
  else next[id] = bounded;
  return sanitizeAvatarForgeState({
    ...current,
    presetId: undefined,
    semanticFaceMorphs: Object.keys(next).length > 0 ? next : undefined,
  });
}

export function createAvatarForgeState(presetId?: string): AvatarForgeState {
  if (!presetId) return sanitizeAvatarForgeState(DEFAULT_AVATAR_FORGE_STATE);
  const selected = AVATAR_FORGE_PRESETS.find((item) => item.id === presetId);
  return sanitizeAvatarForgeState(selected?.state ?? DEFAULT_AVATAR_FORGE_STATE);
}

/**
 * Applies one named body recipe without replacing the user's face, hair, colors, or accents.
 * The same state + preset id always produces the same serialized result.
 */
export function applyAvatarForgeBodyPreset(
  state: AvatarForgeState,
  presetId: AvatarForgeBodyPresetId,
): AvatarForgeState {
  const selected = AVATAR_FORGE_BODY_PRESETS.find((item) => item.id === presetId);
  if (!selected) return sanitizeAvatarForgeState(state);
  const current = sanitizeAvatarForgeState(state);
  return sanitizeAvatarForgeState({
    ...current,
    presetId: undefined,
    bodyPresetId: selected.id,
    body: { ...selected.body },
    legacyHipWidth: selected.body.hipWidth,
    proportions: migrateAvatarForgeBodyToStudioVrmProportions(
      selected.body,
      current.proportions,
    ),
  });
}

export type AvatarForgeBodyBoneName =
  | "hips"
  | "spine"
  | "chest"
  | "upperChest"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand"
  | "leftLowerLeg"
  | "rightLowerLeg"
  | "leftFoot"
  | "rightFoot";

export type AvatarForgeBodyBoneAdjustment = {
  readonly bone: AvatarForgeBodyBoneName;
  readonly positionMultiplier: readonly [number, number, number];
  readonly scaleMultiplier: readonly [number, number, number];
};

/**
 * Builds a renderer-independent, deterministic rig adjustment plan. Width is applied as a
 * conservative torso scale; length uses child-bone offsets so arbitrary source bone axes remain
 * intact and the original mesh/geometry buffers never change.
 */
export function buildAvatarForgeBodyAdjustmentPlan(
  body: AvatarForgeBodyParams,
): readonly AvatarForgeBodyBoneAdjustment[] {
  const shoulder = clampNumber(
    body.shoulderWidth,
    AVATAR_FORGE_BODY_LIMITS.shoulderWidth,
    DEFAULT_BODY.shoulderWidth,
  );
  const torso = clampNumber(
    body.torsoLength,
    AVATAR_FORGE_BODY_LIMITS.torsoLength,
    DEFAULT_BODY.torsoLength,
  );
  const hip = clampNumber(body.hipWidth, AVATAR_FORGE_BODY_LIMITS.hipWidth, DEFAULT_BODY.hipWidth);
  const arm = clampNumber(body.armLength, AVATAR_FORGE_BODY_LIMITS.armLength, DEFAULT_BODY.armLength);
  const leg = clampNumber(body.legLength, AVATAR_FORGE_BODY_LIMITS.legLength, DEFAULT_BODY.legLength);
  const unchanged = [1, 1, 1] as const;

  return [
    { bone: "hips", positionMultiplier: unchanged, scaleMultiplier: [hip, 1, 1] },
    { bone: "spine", positionMultiplier: [torso, torso, torso], scaleMultiplier: unchanged },
    { bone: "chest", positionMultiplier: [torso, torso, torso], scaleMultiplier: [shoulder, 1, 1] },
    { bone: "upperChest", positionMultiplier: [torso, torso, torso], scaleMultiplier: [shoulder, 1, 1] },
    { bone: "leftLowerArm", positionMultiplier: [arm, arm, arm], scaleMultiplier: unchanged },
    { bone: "rightLowerArm", positionMultiplier: [arm, arm, arm], scaleMultiplier: unchanged },
    { bone: "leftHand", positionMultiplier: [arm, arm, arm], scaleMultiplier: unchanged },
    { bone: "rightHand", positionMultiplier: [arm, arm, arm], scaleMultiplier: unchanged },
    { bone: "leftLowerLeg", positionMultiplier: [leg, leg, leg], scaleMultiplier: unchanged },
    { bone: "rightLowerLeg", positionMultiplier: [leg, leg, leg], scaleMultiplier: unchanged },
    { bone: "leftFoot", positionMultiplier: [leg, leg, leg], scaleMultiplier: unchanged },
    { bone: "rightFoot", positionMultiplier: [leg, leg, leg], scaleMultiplier: unchanged },
  ];
}

/** 웨이브 스펙. amount가 0이면 파츠에 키를 만들지 않는다(하위호환 계약). */
type WaveSpec = { amount: number; frequency: number };

function hairPart(
  hair: AvatarForgeHairParams,
  id: string,
  role: AvatarForgeHairPart["role"],
  primitive: AvatarForgeHairPart["primitive"],
  position: AvatarForgeHairPart["position"],
  rotation: AvatarForgeHairPart["rotation"],
  scale: AvatarForgeHairPart["scale"],
  taper = 0.25,
  wave?: WaveSpec
): AvatarForgeHairPart {
  return {
    id,
    role,
    primitive,
    position,
    rotation,
    scale,
    baseColor: hair.baseColor,
    ...(hair.shadowColor ? { shadowColor: hair.shadowColor } : {}),
    tipColor: hair.tipColor,
    taper,
    curl: hair.curl,
    shine: hair.shine,
    // wave가 0이면 키 자체를 만들지 않는다 → v1 계획과 JSON 바이트 동일.
    ...(wave && wave.amount > 0 ? { wave: wave.amount, waveFrequency: wave.frequency } : {}),
  };
}

/**
 * 스타일별 캡(두상 덮개) 배율. v1 스타일은 반드시 1이어야 한다(x*1 === x 로 바이트 동일 유지).
 */
const STYLE_CAP_SCALE: Record<AvatarForgeHairStyle, number> = {
  none: 1,
  short: 1,
  bob: 1,
  long: 1,
  ponytail: 1,
  twintail: 1,
  bun: 1,
  wavy: 1,
  braid: 1,
  "twin-braid": 1,
  hime: 1,
  wolf: 1.06,
  "half-up": 1,
  pixie: 0.96,
};

/**
 * 땋은 머리 마디 수 — 길이 파라미터에서 결정론적으로 유도한다.
 * length 0.55 → 5마디, 1.0 → 6마디, 1.7 → 8마디.
 */
export function avatarForgeBraidSegmentCount(length: number): number {
  const numeric = Number.isFinite(length) ? length : 1;
  return Math.min(9, Math.max(4, Math.round(3 + numeric * 3)));
}

/** 앞머리 파츠. "full"은 v1과 완전히 동일한 3가닥을 만든다. */
function buildBangParts(hair: AvatarForgeHairParams): AvatarForgeHairPart[] {
  const w = hair.strandWidth;
  const f = hair.fringe;

  if (hair.bangStyle === "none") return [];

  if (hair.bangStyle === "split") {
    return [
      hairPart(hair, "bang-split-left", "bang", "tapered-capsule", [-0.13, 0.05, 0.42], [0.05, 0, 0.3], [0.13 * w, 0.34 * f, 0.085 * w], 0.68),
      hairPart(hair, "bang-split-right", "bang", "tapered-capsule", [0.13, 0.05, 0.42], [0.05, 0, -0.3], [0.13 * w, 0.34 * f, 0.085 * w], 0.68),
      hairPart(hair, "bang-split-outer-left", "bang", "tapered-capsule", [-0.29, -0.01, 0.35], [0.04, 0, 0.14], [0.1 * w, 0.42 * f, 0.075 * w], 0.6),
      hairPart(hair, "bang-split-outer-right", "bang", "tapered-capsule", [0.29, -0.01, 0.35], [0.04, 0, -0.14], [0.1 * w, 0.42 * f, 0.075 * w], 0.6),
    ];
  }

  if (hair.bangStyle === "side-swept") {
    return [
      hairPart(hair, "bang-sweep-main", "bang", "tapered-capsule", [-0.06, 0.06, 0.42], [0.05, 0, 0.52], [0.16 * w, 0.4 * f, 0.09 * w], 0.66),
      hairPart(hair, "bang-sweep-short", "bang", "tapered-capsule", [-0.27, 0.02, 0.37], [0.07, 0, 0.24], [0.09 * w, 0.24 * f, 0.07 * w], 0.76),
      hairPart(hair, "bang-sweep-tail", "bang", "tapered-capsule", [0.23, 0, 0.38], [0.06, 0, -0.1], [0.09 * w, 0.3 * f, 0.07 * w], 0.74),
    ];
  }

  if (hair.bangStyle === "curtain") {
    return [
      hairPart(hair, "bang-curtain-left", "bang", "tapered-capsule", [-0.16, 0, 0.41], [0.02, 0, 0.16], [0.12 * w, 0.52 * f, 0.085 * w], 0.5),
      hairPart(hair, "bang-curtain-right", "bang", "tapered-capsule", [0.16, 0, 0.41], [0.02, 0, -0.16], [0.12 * w, 0.52 * f, 0.085 * w], 0.5),
      hairPart(hair, "bang-curtain-wisp-left", "bang", "tapered-capsule", [-0.32, -0.07, 0.33], [0.02, 0, 0.1], [0.085 * w, 0.44 * f, 0.07 * w], 0.58),
      hairPart(hair, "bang-curtain-wisp-right", "bang", "tapered-capsule", [0.32, -0.07, 0.33], [0.02, 0, -0.1], [0.085 * w, 0.44 * f, 0.07 * w], 0.58),
    ];
  }

  if (hair.bangStyle === "blunt") {
    const strands: AvatarForgeHairPart[] = [];
    for (let index = 0; index < 5; index += 1) {
      const x = -0.24 + index * 0.12;
      strands.push(
        hairPart(
          hair,
          `bang-blunt-${index}`,
          "bang",
          "tapered-capsule",
          [x, 0.05, 0.43 - Math.abs(x) * 0.18],
          [0.03, 0, 0],
          [0.085 * w, 0.3 * f, 0.075 * w],
          0.06
        )
      );
    }
    return strands;
  }

  // "full" — v1 기본값. 아래 세 줄은 v1 원본과 산술식까지 동일해야 한다.
  return [
    hairPart(hair, "bang-center", "bang", "tapered-capsule", [0, 0.03, 0.43], [0.04, 0, 0], [0.12 * w, 0.35 * f, 0.08 * w], 0.72),
    hairPart(hair, "bang-left", "bang", "tapered-capsule", [-0.19, 0.04, 0.4], [0.08, 0, 0.18], [0.11 * w, 0.31 * f, 0.08 * w], 0.7),
    hairPart(hair, "bang-right", "bang", "tapered-capsule", [0.19, 0.04, 0.4], [0.08, 0, -0.18], [0.11 * w, 0.31 * f, 0.08 * w], 0.7),
  ];
}

/**
 * 땋은 갈래 하나를 마디 체인으로 전개한다. 마디 수·형태 모두 파라미터 유도(결정론적).
 * @param swaySign 좌우 갈래를 거울 대칭으로 만들기 위한 부호(+1 왼쪽 / -1 오른쪽).
 */
function buildBraidStrand(
  hair: AvatarForgeHairParams,
  prefix: string,
  anchor: readonly [number, number, number],
  totalLength: number,
  rootRadius: number,
  segments: number,
  swaySign = 1
): AvatarForgeHairPart[] {
  const parts: AvatarForgeHairPart[] = [
    hairPart(hair, `${prefix}-tie`, "bun", "sphere", anchor, [0, 0, 0], [rootRadius * 1.05, rootRadius * 0.7, rootRadius * 1.05], 0),
  ];
  const step = totalLength / segments;
  for (let index = 0; index < segments; index += 1) {
    const progress = (index + 0.5) / segments;
    const radius = rootRadius * (1 - progress * 0.46);
    const sway = swaySign * (index % 2 === 0 ? 1 : -1) * radius * 0.34;
    parts.push(
      hairPart(
        hair,
        `${prefix}-seg-${index}`,
        "braid",
        "sphere",
        [anchor[0] + sway, anchor[1] - (index + 0.5) * step, anchor[2] - progress * 0.05],
        [0, 0, sway * 1.6],
        [radius, radius * 0.74, radius * 0.92],
        0
      )
    );
  }
  return parts;
}

/**
 * Head-local, unit-scale procedural part plan. The Three renderer owns geometry creation;
 * this module stays deterministic, serializable and testable.
 *
 * 순수 함수 — 같은 입력이면 항상 같은 배열(난수·시간·전역 상태 없음).
 */
export function buildAvatarForgeHairParts(
  stateOrHair: AvatarForgeState | AvatarForgeHairParams
): AvatarForgeHairPart[] {
  const hair = "hair" in stateOrHair
    ? sanitizeAvatarForgeState(stateOrHair).hair
    // 순수 헤어 파라미터 입력은 항상 현재 스키마로 본다(v2 필드가 legacy 강등되지 않도록).
    : sanitizeAvatarForgeState({ version: AVATAR_FORGE_VERSION, hair: stateOrHair }).hair;
  if (hair.style === "none") return [];

  const v = hair.volume;
  const l = hair.length;
  const w = hair.strandWidth;
  const capScale = STYLE_CAP_SCALE[hair.style];
  // tailHeight 0.5 = v1 위치. (x - 0.5) * k 는 기본값에서 정확히 0이라 +0으로 값이 보존된다.
  const tailLift = (hair.tailHeight - 0.5) * 0.56;
  const wave: WaveSpec | undefined = hair.wave > 0 ? { amount: hair.wave, frequency: 2.4 } : undefined;

  const parts: AvatarForgeHairPart[] = [
    hairPart(hair, "cap", "cap", "ellipsoid", [0, 0.18, 0.015], [0, 0, 0], [0.56 * v * capScale, 0.46 * v * capScale, 0.54 * v * capScale], 0),
    ...buildBangParts(hair),
  ];

  if (hair.style === "short") {
    parts.push(
      hairPart(hair, "short-left", "side", "tapered-capsule", [-0.42, -0.03, 0.02], [0.06, 0, 0.08], [0.12 * w, 0.35 * l, 0.12 * w], 0.55, wave),
      hairPart(hair, "short-right", "side", "tapered-capsule", [0.42, -0.03, 0.02], [0.06, 0, -0.08], [0.12 * w, 0.35 * l, 0.12 * w], 0.55, wave)
    );
  }

  if (hair.style === "bob" || hair.style === "long") {
    const sideLength = (hair.style === "long" ? 0.82 : 0.5) * l;
    parts.push(
      hairPart(hair, "side-left", "side", "tapered-capsule", [-0.43, -0.22 * l, 0.02], [0, 0, 0.05], [0.15 * w, sideLength, 0.13 * w], 0.38, wave),
      hairPart(hair, "side-right", "side", "tapered-capsule", [0.43, -0.22 * l, 0.02], [0, 0, -0.05], [0.15 * w, sideLength, 0.13 * w], 0.38, wave),
      hairPart(hair, "back", "back", "ellipsoid", [0, -0.25 * l, -0.34], [0, 0, 0], [0.47 * v, sideLength, 0.17 * v], 0.08)
    );
  }

  if (hair.style === "ponytail") {
    parts.push(
      hairPart(hair, "pony-root", "bun", "sphere", [0, 0.13 + tailLift, -0.48], [0, 0, 0], [0.19 * v, 0.19 * v, 0.19 * v], 0),
      hairPart(hair, "pony-tail", "tail", "tapered-capsule", [0, -0.42 * l + tailLift, -0.58], [-0.22 + (hair.tailHeight - 0.5) * 0.3, 0, 0], [0.2 * w, 0.82 * l, 0.18 * w], 0.58, wave)
    );
  }

  if (hair.style === "twintail") {
    parts.push(
      hairPart(hair, "twin-left", "tail", "tapered-capsule", [-0.48, -0.34 * l + tailLift, -0.14], [0, 0, -0.2 - (hair.tailHeight - 0.5) * 0.24], [0.19 * w, 0.72 * l, 0.17 * w], 0.58, wave),
      hairPart(hair, "twin-right", "tail", "tapered-capsule", [0.48, -0.34 * l + tailLift, -0.14], [0, 0, 0.2 + (hair.tailHeight - 0.5) * 0.24], [0.19 * w, 0.72 * l, 0.17 * w], 0.58, wave)
    );
  }

  if (hair.style === "bun") {
    parts.push(
      hairPart(hair, "bun", "bun", "sphere", [0, 0.53 * v + tailLift, -0.16], [0, 0, 0], [0.28 * v, 0.28 * v, 0.25 * v], 0),
      hairPart(hair, "bun-wisp-left", "side", "tapered-capsule", [-0.39, -0.05, 0.12], [0.02, 0, 0.08], [0.07 * w, 0.28 * l, 0.06 * w], 0.78, wave),
      hairPart(hair, "bun-wisp-right", "side", "tapered-capsule", [0.39, -0.05, 0.12], [0.02, 0, -0.08], [0.07 * w, 0.28 * l, 0.06 * w], 0.78, wave)
    );
  }

  /* ── v2 신규 스타일 ─────────────────────────────────────────────────── */

  if (hair.style === "wavy") {
    // 스타일 자체가 기본 웨이브 0.45를 갖고, wave 파라미터가 그 위에 진폭을 더한다.
    const spec: WaveSpec = { amount: Math.min(1, 0.45 + hair.wave * 0.55), frequency: 2.9 };
    const sideLength = 0.86 * l;
    parts.push(
      hairPart(hair, "wavy-side-left", "side", "tapered-capsule", [-0.44, -0.26 * l, 0.03], [0, 0, 0.06], [0.16 * w, sideLength, 0.14 * w], 0.34, spec),
      hairPart(hair, "wavy-side-right", "side", "tapered-capsule", [0.44, -0.26 * l, 0.03], [0, 0, -0.06], [0.16 * w, sideLength, 0.14 * w], 0.34, spec),
      hairPart(hair, "wavy-back", "back", "ellipsoid", [0, -0.3 * l, -0.35], [0, 0, 0], [0.48 * v, 0.92 * l, 0.19 * v], 0.08),
      hairPart(hair, "wavy-inner-left", "back", "tapered-capsule", [-0.24, -0.52 * l, -0.4], [0, 0, 0.03], [0.13 * w, 0.78 * l, 0.12 * w], 0.42, spec),
      hairPart(hair, "wavy-inner-right", "back", "tapered-capsule", [0.24, -0.52 * l, -0.4], [0, 0, -0.03], [0.13 * w, 0.78 * l, 0.12 * w], 0.42, spec)
    );
  }

  if (hair.style === "braid") {
    const segments = avatarForgeBraidSegmentCount(l);
    parts.push(
      hairPart(hair, "braid-nape", "back", "ellipsoid", [0, -0.06, -0.36], [0, 0, 0], [0.4 * v, 0.3 * v, 0.18 * v], 0.1),
      ...buildBraidStrand(hair, "braid", [0, -0.16 + tailLift, -0.46], 0.95 * l, 0.13 * w, segments)
    );
  }

  if (hair.style === "twin-braid") {
    const segments = avatarForgeBraidSegmentCount(l * 0.85);
    parts.push(
      ...buildBraidStrand(hair, "braid-left", [-0.42, -0.12 + tailLift, -0.2], 0.8 * l, 0.115 * w, segments, 1),
      ...buildBraidStrand(hair, "braid-right", [0.42, -0.12 + tailLift, -0.2], 0.8 * l, 0.115 * w, segments, -1)
    );
  }

  if (hair.style === "hime") {
    // 히메컷: 턱선에서 뚝 끊기는 일자 사이드락 + 등까지 오는 긴 생머리.
    parts.push(
      hairPart(hair, "hime-lock-left", "side", "tapered-capsule", [-0.42, -0.3 * l, 0.16], [0, 0, 0.02], [0.15 * w, 0.34 * l, 0.12 * w], 0.04),
      hairPart(hair, "hime-lock-right", "side", "tapered-capsule", [0.42, -0.3 * l, 0.16], [0, 0, -0.02], [0.15 * w, 0.34 * l, 0.12 * w], 0.04),
      hairPart(hair, "hime-back", "back", "ellipsoid", [0, -0.44 * l, -0.33], [0, 0, 0], [0.5 * v, 1.02 * l, 0.19 * v], 0.05),
      hairPart(hair, "hime-back-left", "back", "tapered-capsule", [-0.3, -0.5 * l, -0.3], [0, 0, 0.02], [0.12 * w, 0.9 * l, 0.11 * w], 0.12, wave),
      hairPart(hair, "hime-back-right", "back", "tapered-capsule", [0.3, -0.5 * l, -0.3], [0, 0, -0.02], [0.12 * w, 0.9 * l, 0.11 * w], 0.12, wave)
    );
  }

  if (hair.style === "wolf") {
    // 울프컷: 윗머리 레이어 볼륨 + 목덜미에서만 길게 빠지는 얇은 가닥.
    parts.push(
      hairPart(hair, "wolf-layer", "back", "ellipsoid", [0, 0.06, -0.16], [0, 0, 0], [0.52 * v, 0.32 * v, 0.5 * v], 0.14),
      hairPart(hair, "wolf-side-left", "side", "tapered-capsule", [-0.44, -0.08, 0.06], [0.05, 0, 0.1], [0.1 * w, 0.3 * l, 0.1 * w], 0.68, wave),
      hairPart(hair, "wolf-side-right", "side", "tapered-capsule", [0.44, -0.08, 0.06], [0.05, 0, -0.1], [0.1 * w, 0.3 * l, 0.1 * w], 0.68, wave),
      hairPart(hair, "wolf-nape-center", "tail", "tapered-capsule", [0, -0.5 * l, -0.44], [-0.06, 0, 0], [0.09 * w, 0.72 * l, 0.09 * w], 0.74, wave),
      hairPart(hair, "wolf-nape-left", "tail", "tapered-capsule", [-0.19, -0.44 * l, -0.42], [-0.04, 0, 0.06], [0.075 * w, 0.62 * l, 0.075 * w], 0.78, wave),
      hairPart(hair, "wolf-nape-right", "tail", "tapered-capsule", [0.19, -0.44 * l, -0.42], [-0.04, 0, -0.06], [0.075 * w, 0.62 * l, 0.075 * w], 0.78, wave)
    );
  }

  if (hair.style === "half-up") {
    parts.push(
      hairPart(hair, "halfup-knot", "bun", "sphere", [0, 0.3 * v + tailLift, -0.42], [0, 0, 0], [0.19 * v, 0.17 * v, 0.17 * v], 0),
      hairPart(hair, "halfup-back", "back", "ellipsoid", [0, -0.3 * l, -0.34], [0, 0, 0], [0.46 * v, 0.8 * l, 0.18 * v], 0.1),
      hairPart(hair, "halfup-side-left", "side", "tapered-capsule", [-0.43, -0.24 * l, 0.05], [0, 0, 0.05], [0.13 * w, 0.62 * l, 0.12 * w], 0.44, wave),
      hairPart(hair, "halfup-side-right", "side", "tapered-capsule", [0.43, -0.24 * l, 0.05], [0, 0, -0.05], [0.13 * w, 0.62 * l, 0.12 * w], 0.44, wave)
    );
  }

  if (hair.style === "pixie") {
    parts.push(
      hairPart(hair, "pixie-nape", "back", "tapered-capsule", [0, -0.12 * l, -0.36], [-0.12, 0, 0], [0.16 * w, 0.2 * l, 0.1 * w], 0.66, wave),
      hairPart(hair, "pixie-sideburn-left", "side", "tapered-capsule", [-0.41, -0.06, 0.14], [0.04, 0, 0.06], [0.06 * w, 0.19 * l, 0.055 * w], 0.82),
      hairPart(hair, "pixie-sideburn-right", "side", "tapered-capsule", [0.41, -0.06, 0.14], [0.04, 0, -0.06], [0.06 * w, 0.19 * l, 0.055 * w], 0.82),
      // 기울기 부호가 형제 가닥들과 반대였다. 그대로 두면 굵은 뿌리가 두피 밖 1.5cm 에 떠
      // 있고 가는 끝이 두개골 안으로 파고든다(정규거리 1.180 → 0.707). 옆·뒷머리 가닥은
      // 전부 뿌리가 두피에 묻히고 끝이 밖으로 뻗는다(`pixie-nape` 0.989 → 1.220,
      // 사이드번 0.954 → 1.190). 부호를 뒤집으면 0.827 → 1.099 로 같은 형태가 된다.
      hairPart(hair, "pixie-crown-flick", "side", "tapered-capsule", [-0.22, 0.3 * v, -0.24], [0.42, 0, -0.3], [0.07 * w, 0.2 * l, 0.06 * w], 0.8)
    );
  }

  if (hair.ahoge > 0) {
    // 삐침머리 — 정수리에서 한 가닥 튀어나온다. ahoge=0이면 파츠 자체가 없다(v1 동일).
    const ahogeLength = 0.1 + hair.ahoge * 0.26;
    parts.push(
      hairPart(
        hair,
        "ahoge",
        "ahoge",
        "tapered-capsule",
        [0, 0.18 + 0.46 * v + ahogeLength * 0.6, -0.04],
        [0.36, 0, 0.14],
        [0.035 * w, ahogeLength, 0.03 * w],
        0.88,
        { amount: 0.5 + hair.ahoge * 0.45, frequency: 1.35 }
      )
    );
  }

  return parts;
}
