/**
 * Character Shaper — slot catalog (data layer).
 *
 * Every entry is a ToonStudio original: labels, hints and parameter values are authored here and
 * map 1:1 onto the existing runtime (Avatar Forge, semantic face morphs, proportion presets,
 * wardrobe, props, VRM expressions, pose presets, hand shapes). The preview spec of an entry is
 * derived from the same numbers as its apply ref, so a card always predicts the result.
 *
 * Ids are namespaced `"slot:name"`. The catalog is frozen data; nothing here touches the scene.
 */

import { EXPRESSION_PRESETS, EXTRA_POSE_PRESETS, NATURAL_IDLE_POSES } from "../studio-pose-presets";
import { DEFAULT_AVATAR_FORGE_STATE } from "../vrm/studio-vrm-avatar-forge";
import { STUDIO_VRM_PROPORTION_PRESETS } from "../vrm/studio-vrm-proportion-core";
import { VRM_PROPS } from "../vrm/studio-vrm-props";
import { WARDROBE_ITEMS } from "../vrm/studio-vrm-wardrobe";

import type { StudioExpressionPreset, StudioPosePreset } from "../studio-pose-presets";
import type {
  CharacterCapabilityRequirement,
  CharacterEarGlyph,
  CharacterEyeLidStyle,
  CharacterGarmentGlyph,
  CharacterGenreTag,
  CharacterHandPoseType,
  CharacterNoseGlyph,
  CharacterPsdSemanticLayer,
  CharacterSemanticMorphBundle,
  CharacterSlotApplyRef,
  CharacterSlotCatalog,
  CharacterSlotEntry,
  CharacterSlotKind,
  CharacterSlotMeta,
  CharacterSlotPreviewSpec,
} from "./character-shaper-contract";
import type {
  AvatarForgeFaceParams,
  AvatarForgeHairParams,
  AvatarForgeHairStyle,
} from "../vrm/studio-vrm-avatar-forge";
import type { PropDef } from "../vrm/studio-vrm-props";
import type { WardrobeItemDef } from "../vrm/studio-vrm-wardrobe";

/* -------------------------------------------------------------------------- */
/* Slot metas                                                                  */
/* -------------------------------------------------------------------------- */

export const CHARACTER_SLOT_METAS: readonly CharacterSlotMeta[] = Object.freeze([
  { id: "face-shape", label: "얼굴형", labelEn: "Face shape", hint: "두상·볼·턱 비율을 한 번에 바꿉니다", group: "identity", icon: "CircleUserRound", multi: false },
  { id: "eyes", label: "눈", labelEn: "Eyes", hint: "눈 크기·간격·눈꼬리 조합", group: "identity", icon: "Eye", multi: false },
  { id: "irises", label: "눈동자", labelEn: "Irises", hint: "홍채 크기와 색", group: "identity", icon: "Aperture", multi: false },
  { id: "nose", label: "코", labelEn: "Nose", hint: "코 높이와 너비", group: "identity", icon: "Triangle", multi: false },
  { id: "mouth", label: "입", labelEn: "Mouth", hint: "입 너비·입술 볼륨과 기본 입모양", group: "identity", icon: "Smile", multi: false },
  { id: "ears", label: "귀", labelEn: "Ears", hint: "귀 크기, 엘프·동물 귀", group: "identity", icon: "Ear", multi: false },
  { id: "hair", label: "헤어", labelEn: "Hair", hint: "원본 헤어 또는 절차형 스타일", group: "identity", icon: "Scissors", multi: false },
  { id: "body", label: "체형", labelEn: "Body", hint: "두신 비율 프리셋", group: "figure", icon: "Ruler", multi: false },
  { id: "top", label: "상의", labelEn: "Top", hint: "티셔츠·셔츠·겉옷", group: "figure", icon: "Shirt", multi: false },
  { id: "bottom", label: "하의", labelEn: "Bottom", hint: "스커트·팬츠", group: "figure", icon: "RectangleVertical", multi: false },
  { id: "shoes", label: "신발", labelEn: "Shoes", hint: "스니커즈·부츠·힐", group: "figure", icon: "Footprints", multi: false },
  { id: "accessory", label: "액세서리", labelEn: "Accessory", hint: "모자·안경·가방을 여러 개 조합", group: "figure", icon: "Glasses", multi: true },
  { id: "expression", label: "표정", labelEn: "Expression", hint: "VRM 표정 조합", group: "performance", icon: "Laugh", multi: false },
  { id: "pose", label: "포즈", labelEn: "Pose", hint: "전신 포즈 프리셋", group: "performance", icon: "PersonStanding", multi: false },
  { id: "hand-pose", label: "손 포즈", labelEn: "Hand pose", hint: "손 모양, 왼손·오른손·양손", group: "performance", icon: "Hand", multi: false },
] satisfies readonly CharacterSlotMeta[]);

const SLOT_META_BY_ID = new Map(CHARACTER_SLOT_METAS.map((meta) => [meta.id, meta] as const));

export function characterSlotMeta(slot: CharacterSlotKind): CharacterSlotMeta {
  return SLOT_META_BY_ID.get(slot) ?? CHARACTER_SLOT_METAS[0]!;
}

export const CHARACTER_GENRE_TAG_LABELS: Readonly<Record<CharacterGenreTag, string>> = Object.freeze({
  romance: "로맨스",
  school: "학원",
  action: "액션",
  fantasy: "판타지",
  modern: "현대",
  comedy: "코미디",
  noir: "누아르",
  medical: "의료",
  daily: "일상",
});

/* -------------------------------------------------------------------------- */
/* Entry helpers                                                               */
/* -------------------------------------------------------------------------- */

const MODEL_LOADED: readonly CharacterCapabilityRequirement[] = Object.freeze([{ kind: "model-loaded" as const }]);
const HUMANOID: readonly CharacterCapabilityRequirement[] = Object.freeze([{ kind: "humanoid" as const }]);
const PROPS: readonly CharacterCapabilityRequirement[] = Object.freeze([{ kind: "props" as const }]);
const WARDROBE: readonly CharacterCapabilityRequirement[] = Object.freeze([{ kind: "wardrobe-metrics" as const }]);

type EntrySeed = {
  readonly name: string;
  readonly label: string;
  readonly labelEn?: string;
  readonly hint: string;
  readonly tags: readonly CharacterGenreTag[];
  readonly keywords: readonly string[];
  readonly preview: CharacterSlotPreviewSpec;
  readonly apply: CharacterSlotApplyRef;
  readonly requires: readonly CharacterCapabilityRequirement[];
  readonly exportLayer: CharacterPsdSemanticLayer;
  readonly license?: CharacterSlotEntry["license"];
  readonly featured?: boolean;
};

function entry(slot: CharacterSlotKind, order: number, seed: EntrySeed): CharacterSlotEntry {
  const { name, license, featured, labelEn, ...rest } = seed;
  return Object.freeze({
    id: `${slot}:${name}`,
    slot,
    ...rest,
    ...(labelEn ? { labelEn } : {}),
    tags: Object.freeze([...new Set(seed.tags)]),
    keywords: Object.freeze([...new Set(seed.keywords.map((keyword) => keyword.trim()).filter(Boolean))]),
    requires: Object.freeze([...seed.requires]),
    license: license ?? "toonstudio-original",
    order,
    ...(featured ? { featured: true } : {}),
  });
}

function morphRequirement(morphs: CharacterSemanticMorphBundle): readonly CharacterCapabilityRequirement[] {
  const ids = (Object.keys(morphs) as (keyof CharacterSemanticMorphBundle)[])
    .filter((id) => Math.abs(morphs[id] ?? 0) >= 1e-4);
  return ids.length > 0 ? [{ kind: "semantic-morph", ids }] : MODEL_LOADED;
}

/* -------------------------------------------------------------------------- */
/* face-shape                                                                  */
/* -------------------------------------------------------------------------- */

function faceParams(
  headWidth: number,
  headHeight: number,
  headDepth: number,
  cheekVolume: number,
  chinLength: number,
): AvatarForgeFaceParams {
  return Object.freeze({ headWidth, headHeight, headDepth, cheekVolume, chinLength });
}

const FACE_SHAPES: readonly (Omit<EntrySeed, "preview" | "apply" | "requires" | "exportLayer"> & { readonly face: AvatarForgeFaceParams })[] = [
  { name: "balanced", label: "균형", labelEn: "Balanced", hint: "기본 비율. 어떤 장르에도 무난합니다", tags: ["daily", "modern"], keywords: ["기본", "표준", "default", "neutral"], face: faceParams(1, 1, 1, 0.35, 1), featured: true },
  { name: "oval", label: "계란형", labelEn: "Oval", hint: "갸름한 세로 실루엣의 로맨스 얼굴", tags: ["romance", "modern"], keywords: ["갸름", "타원", "oval", "slim"], face: faceParams(0.97, 1.05, 1, 0.3, 1.04), featured: true },
  { name: "round", label: "둥근 얼굴", labelEn: "Round", hint: "볼이 도톰한 친근한 얼굴", tags: ["comedy", "daily"], keywords: ["동글", "귀여운", "round", "cute"], face: faceParams(1.06, 0.97, 1.02, 0.62, 0.95), featured: true },
  { name: "sharp", label: "샤프", labelEn: "Sharp", hint: "턱선이 살아 있는 날카로운 얼굴", tags: ["action", "noir"], keywords: ["날카로운", "턱선", "sharp", "chiseled"], face: faceParams(0.94, 1.04, 0.98, 0.18, 1.08), featured: true },
  { name: "soft-volume", label: "볼륨", labelEn: "Soft volume", hint: "볼 볼륨을 키운 부드러운 얼굴", tags: ["romance", "daily"], keywords: ["볼", "부드러운", "soft", "chubby"], face: faceParams(1.04, 1, 1.04, 0.72, 0.98) },
  { name: "angular", label: "각진 얼굴", labelEn: "Angular", hint: "넓은 광대와 각진 턱", tags: ["action", "noir"], keywords: ["각진", "광대", "angular", "square"], face: faceParams(1.08, 1, 1, 0.22, 1.06) },
  { name: "baby", label: "동안 SD", labelEn: "Baby face", hint: "짧은 턱과 큰 볼의 아동·SD 얼굴", tags: ["comedy", "school"], keywords: ["동안", "아이", "치비", "baby", "chibi"], face: faceParams(1.1, 0.94, 1.04, 0.8, 0.9) },
];

function buildFaceShapeEntries(): CharacterSlotEntry[] {
  return FACE_SHAPES.map((seed, index) => entry("face-shape", index, {
    ...seed,
    preview: { kind: "face-shape", face: seed.face },
    apply: { kind: "forge-face", face: seed.face },
    requires: MODEL_LOADED,
    exportLayer: "face",
  }));
}

/* -------------------------------------------------------------------------- */
/* eyes                                                                        */
/* -------------------------------------------------------------------------- */

const EYE_SHAPES: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly size: number; readonly spacing: number; readonly tilt: number; readonly lid: CharacterEyeLidStyle;
  readonly featured?: boolean;
}[] = [
  { name: "original", label: "원본 눈", labelEn: "Original", hint: "모델 고유의 눈 그대로", tags: ["daily"], keywords: ["기본", "원본", "default", "original"], size: 0, spacing: 0, tilt: 0, lid: "round" },
  { name: "romance-sparkle", label: "순정 반짝", labelEn: "Sparkle", hint: "크고 촉촉한 순정만화 눈", tags: ["romance", "school"], keywords: ["순정", "반짝", "큰 눈", "sparkle", "shoujo", "big"], size: 0.55, spacing: 0.05, tilt: 0.1, lid: "round", featured: true },
  { name: "cat", label: "고양이 눈", labelEn: "Cat eye", hint: "눈꼬리가 올라간 고양이상", tags: ["romance", "noir"], keywords: ["고양이", "눈꼬리", "cat", "upturned"], size: 0.1, spacing: 0, tilt: 0.6, lid: "cat", featured: true },
  { name: "half-moon", label: "반달 눈", labelEn: "Half moon", hint: "웃는 듯한 반달 눈매", tags: ["daily", "comedy"], keywords: ["반달", "눈웃음", "half moon", "smiling"], size: -0.15, spacing: 0.05, tilt: 0.15, lid: "half-moon" },
  { name: "shonen", label: "소년만화 눈", labelEn: "Shonen", hint: "또렷하고 힘 있는 소년만화 눈", tags: ["action", "school"], keywords: ["소년", "또렷", "shonen", "bold"], size: 0.3, spacing: -0.1, tilt: 0.35, lid: "sharp", featured: true },
  { name: "droopy", label: "처진 눈", labelEn: "Droopy", hint: "순한 인상의 처진 눈꼬리", tags: ["daily", "romance"], keywords: ["처진", "순한", "droopy", "downturned"], size: 0.2, spacing: 0.1, tilt: -0.5, lid: "droopy" },
  { name: "sharp", label: "날카로운 눈", labelEn: "Sharp", hint: "가늘고 날카로운 눈매", tags: ["noir", "action"], keywords: ["날카로운", "가는", "sharp", "narrow"], size: -0.3, spacing: -0.15, tilt: 0.45, lid: "sharp", featured: true },
  { name: "round-baby", label: "둥근 동안 눈", labelEn: "Round baby", hint: "동그랗고 큰 동안 눈", tags: ["comedy", "school"], keywords: ["동그란", "동안", "round", "baby"], size: 0.7, spacing: 0.2, tilt: -0.1, lid: "round" },
  { name: "wide-set", label: "먼 눈", labelEn: "Wide set", hint: "눈 사이가 넓은 개성 있는 눈", tags: ["modern", "fantasy"], keywords: ["먼", "간격", "wide set", "spacing"], size: 0.15, spacing: 0.6, tilt: 0, lid: "round" },
];

function buildEyeEntries(): CharacterSlotEntry[] {
  return EYE_SHAPES.map((seed, index) => {
    const morphs: CharacterSemanticMorphBundle = { eyeSize: seed.size, eyeSpacing: seed.spacing, eyeTilt: seed.tilt };
    return entry("eyes", index, {
      ...seed,
      preview: { kind: "eyes", size: seed.size, spacing: seed.spacing, tilt: seed.tilt, lid: seed.lid },
      apply: { kind: "semantic-morph", morphs },
      requires: morphRequirement(morphs),
      exportLayer: "eyes",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* irises                                                                      */
/* -------------------------------------------------------------------------- */

/** Preview colour used when an entry keeps the model's own iris tint. */
export const CHARACTER_IRIS_PREVIEW_DEFAULT_COLOR = "#4a3328";

const IRISES: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly irisSize: number; readonly color: string | null; readonly featured?: boolean;
}[] = [
  { name: "standard", label: "표준", labelEn: "Standard", hint: "모델 고유의 눈동자 크기와 색", tags: ["daily"], keywords: ["기본", "원본", "default", "original"], irisSize: 0, color: null },
  { name: "large", label: "큰 눈동자", labelEn: "Large iris", hint: "홍채를 키운 순정 눈동자", tags: ["romance", "school"], keywords: ["큰", "순정", "large", "big"], irisSize: 0.5, color: null, featured: true },
  { name: "small", label: "작은 눈동자", labelEn: "Small iris", hint: "작고 또렷한 눈동자. 냉정한 인상", tags: ["noir", "action"], keywords: ["작은", "냉정", "small", "cold"], irisSize: -0.45, color: null },
  { name: "dark-brown", label: "흑갈색", labelEn: "Dark brown", hint: "가장 자연스러운 흑갈색", tags: ["daily", "modern"], keywords: ["갈색", "검정", "brown", "black"], irisSize: 0, color: "#2b1a12", featured: true },
  { name: "brown", label: "다크 브라운", labelEn: "Brown", hint: "따뜻한 진갈색", tags: ["daily", "romance"], keywords: ["갈색", "brown"], irisSize: 0, color: "#4a2c1a" },
  { name: "amber", label: "앰버", labelEn: "Amber", hint: "호박빛 노란 갈색", tags: ["fantasy", "romance"], keywords: ["호박", "노란", "amber", "gold"], irisSize: 0, color: "#b8742a" },
  { name: "hazel", label: "헤이즐", labelEn: "Hazel", hint: "녹갈색 헤이즐", tags: ["modern", "daily"], keywords: ["녹갈색", "hazel"], irisSize: 0, color: "#7a6a2f" },
  { name: "blue", label: "블루", labelEn: "Blue", hint: "맑은 파란 눈동자", tags: ["romance", "fantasy"], keywords: ["파란", "청색", "blue"], irisSize: 0, color: "#3b6fb6", featured: true },
  { name: "green", label: "그린", labelEn: "Green", hint: "초록 눈동자", tags: ["fantasy", "modern"], keywords: ["초록", "녹색", "green"], irisSize: 0, color: "#3f8f5a", featured: true },
  { name: "violet", label: "바이올렛", labelEn: "Violet", hint: "판타지 보라 눈동자", tags: ["fantasy", "romance"], keywords: ["보라", "자주", "violet", "purple"], irisSize: 0, color: "#7b4fb0", featured: true },
  { name: "red", label: "레드", labelEn: "Red", hint: "붉은 눈동자. 악역·마족", tags: ["fantasy", "noir"], keywords: ["빨간", "붉은", "red", "crimson"], irisSize: 0, color: "#b83a3a" },
];

function buildIrisEntries(): CharacterSlotEntry[] {
  return IRISES.map((seed, index) => {
    const requires: CharacterCapabilityRequirement[] = [];
    if (Math.abs(seed.irisSize) >= 1e-4) requires.push({ kind: "semantic-morph", ids: ["irisSize"] });
    if (seed.color) requires.push({ kind: "iris-tint" });
    return entry("irises", index, {
      ...seed,
      preview: { kind: "irises", irisSize: seed.irisSize, color: seed.color ?? CHARACTER_IRIS_PREVIEW_DEFAULT_COLOR, highlight: "basic", pupil: "round" },
      apply: { kind: "iris", irisSize: seed.irisSize, color: seed.color },
      requires: requires.length > 0 ? requires : MODEL_LOADED,
      exportLayer: "eyes",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* nose                                                                        */
/* -------------------------------------------------------------------------- */

const NOSES: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly height: number; readonly width: number; readonly glyph: CharacterNoseGlyph; readonly featured?: boolean;
}[] = [
  { name: "original", label: "원본 코", labelEn: "Original", hint: "모델 고유의 코", tags: ["daily"], keywords: ["기본", "원본", "default", "original"], height: 0, width: 0, glyph: "dot" },
  { name: "dot", label: "점코", labelEn: "Dot", hint: "점 하나로 찍는 만화식 코", tags: ["comedy", "school"], keywords: ["점", "만화", "dot", "tiny"], height: -0.35, width: -0.3, glyph: "dot", featured: true },
  { name: "straight", label: "직선코", labelEn: "Straight", hint: "짧은 선으로 그린 단정한 코", tags: ["daily", "romance"], keywords: ["직선", "단정", "straight", "line"], height: 0.15, width: -0.1, glyph: "line", featured: true },
  { name: "high", label: "오뚝", labelEn: "High bridge", hint: "콧대가 높은 뚜렷한 코", tags: ["romance", "noir"], keywords: ["오뚝", "높은", "high", "bridge"], height: 0.6, width: -0.15, glyph: "bridge", featured: true },
  { name: "low", label: "낮은 코", labelEn: "Low", hint: "낮고 동글한 코", tags: ["comedy", "daily"], keywords: ["낮은", "동글", "low", "button"], height: -0.5, width: 0.1, glyph: "button", featured: true },
  { name: "wide", label: "넓은 코", labelEn: "Wide", hint: "콧방울이 넓은 코", tags: ["action", "modern"], keywords: ["넓은", "콧방울", "wide", "broad"], height: 0, width: 0.5, glyph: "button" },
  { name: "long-bridge", label: "긴 콧대", labelEn: "Long bridge", hint: "가늘고 긴 콧대", tags: ["noir", "fantasy"], keywords: ["긴", "가는", "long", "narrow"], height: 0.35, width: -0.4, glyph: "bridge" },
];

function buildNoseEntries(): CharacterSlotEntry[] {
  return NOSES.map((seed, index) => {
    const morphs: CharacterSemanticMorphBundle = { noseHeight: seed.height, noseWidth: seed.width };
    return entry("nose", index, {
      ...seed,
      preview: { kind: "nose", height: seed.height, width: seed.width, glyph: seed.glyph },
      apply: { kind: "semantic-morph", morphs },
      requires: morphRequirement(morphs),
      exportLayer: "face",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* mouth                                                                       */
/* -------------------------------------------------------------------------- */

const MOUTHS: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly width: number; readonly fullness: number;
  readonly floor: Readonly<Record<string, number>>; readonly featured?: boolean;
}[] = [
  { name: "natural-smile", label: "자연 미소", labelEn: "Natural smile", hint: "살짝 올라간 입꼬리의 기본 미소", tags: ["daily", "romance"], keywords: ["미소", "웃음", "smile"], width: 0.15, fullness: 0, floor: { happy: 0.2 }, featured: true },
  { name: "neat-line", label: "단정한 일자", labelEn: "Neat line", hint: "표정 없이 다문 일자 입", tags: ["daily", "noir"], keywords: ["일자", "다문", "기본", "neutral", "closed", "default"], width: 0, fullness: 0, floor: {}, featured: true },
  { name: "slight-open", label: "살짝 벌림", labelEn: "Slightly open", hint: "말하는 중인 듯 살짝 벌린 입", tags: ["daily", "school"], keywords: ["벌림", "말하기", "open", "talking"], width: 0.05, fullness: 0.1, floor: { aa: 0.25 }, featured: true },
  { name: "plump", label: "도톰", labelEn: "Plump", hint: "입술 볼륨을 키운 도톰한 입", tags: ["romance", "modern"], keywords: ["도톰", "두꺼운", "plump", "full lips"], width: 0, fullness: 0.45, floor: {} },
  { name: "thin", label: "얇은 입술", labelEn: "Thin", hint: "얇고 단정한 입술", tags: ["noir", "modern"], keywords: ["얇은", "thin"], width: 0.1, fullness: -0.4, floor: {} },
  { name: "wide-grin", label: "활짝", labelEn: "Wide grin", hint: "입을 크게 벌린 활짝 웃음", tags: ["comedy", "school"], keywords: ["활짝", "함박", "grin", "laugh"], width: 0.4, fullness: 0.05, floor: { happy: 0.45, aa: 0.15 }, featured: true },
  { name: "pout", label: "삐죽", labelEn: "Pout", hint: "삐죽 내민 입", tags: ["comedy", "romance"], keywords: ["삐죽", "삐짐", "pout", "sulky"], width: -0.3, fullness: 0.2, floor: { ou: 0.35 } },
];

const MOUTH_OPEN_EXPRESSIONS = ["aa", "ih", "ou", "ee", "oh"] as const;

function buildMouthEntries(): CharacterSlotEntry[] {
  return MOUTHS.map((seed, index) => {
    const morphs: CharacterSemanticMorphBundle = { mouthWidth: seed.width, lipFullness: seed.fullness };
    const floorNames = Object.keys(seed.floor);
    const requires: CharacterCapabilityRequirement[] = [...morphRequirement(morphs)];
    if (floorNames.length > 0) requires.push({ kind: "expression", names: floorNames });
    const open = MOUTH_OPEN_EXPRESSIONS.reduce((max, name) => Math.max(max, seed.floor[name] ?? 0), 0);
    return entry("mouth", index, {
      ...seed,
      preview: { kind: "mouth", width: seed.width, fullness: seed.fullness, open, smile: seed.floor.happy ?? 0 },
      apply: { kind: "mouth", morphs, expressionFloor: Object.freeze({ ...seed.floor }) },
      requires,
      exportLayer: "face",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* ears                                                                        */
/* -------------------------------------------------------------------------- */

const EARS: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly size: number; readonly propId: string | null; readonly glyph: CharacterEarGlyph; readonly featured?: boolean;
}[] = [
  { name: "standard", label: "표준", labelEn: "Standard", hint: "모델 고유의 사람 귀", tags: ["daily"], keywords: ["기본", "사람", "default", "human"], size: 0, propId: null, glyph: "human", featured: true },
  { name: "small", label: "작은 귀", labelEn: "Small", hint: "작고 단정한 귀", tags: ["romance", "daily"], keywords: ["작은", "small"], size: -0.45, propId: null, glyph: "human" },
  { name: "large", label: "큰 귀", labelEn: "Large", hint: "크고 눈에 띄는 귀", tags: ["comedy", "daily"], keywords: ["큰", "large", "big"], size: 0.5, propId: null, glyph: "human", featured: true },
  { name: "elf", label: "엘프 귀", labelEn: "Elf", hint: "뒤로 뻗은 뾰족한 엘프 귀 소품", tags: ["fantasy"], keywords: ["엘프", "뾰족", "요정", "elf", "pointed"], size: 0, propId: "elfEars", glyph: "elf", featured: true },
  { name: "animal", label: "동물 귀", labelEn: "Animal", hint: "정수리에 붙는 고양이 귀 소품", tags: ["fantasy", "comedy"], keywords: ["고양이", "동물", "수인", "cat", "animal"], size: 0, propId: "catEars", glyph: "animal", featured: true },
];

function buildEarEntries(): CharacterSlotEntry[] {
  return EARS.map((seed, index) => {
    const morphs: CharacterSemanticMorphBundle = { earSize: seed.size };
    const requires: CharacterCapabilityRequirement[] = [...morphRequirement(morphs)];
    if (seed.propId) requires.push({ kind: "props" });
    return entry("ears", index, {
      ...seed,
      preview: { kind: "ears", size: seed.size, glyph: seed.glyph },
      apply: { kind: "ears", morphs, propId: seed.propId },
      requires,
      exportLayer: seed.propId ? "accessory" : "face",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* hair                                                                        */
/* -------------------------------------------------------------------------- */

const HAIR_DEFAULTS = DEFAULT_AVATAR_FORGE_STATE.hair;

/** Shape-only parameters; the palette (base/tip/shadow/shine) is owned by the colour controls. */
const HAIR_SHAPE_DEFAULTS: Partial<AvatarForgeHairParams> = Object.freeze({
  volume: HAIR_DEFAULTS.volume,
  length: HAIR_DEFAULTS.length,
  strandWidth: HAIR_DEFAULTS.strandWidth,
  fringe: HAIR_DEFAULTS.fringe,
  curl: HAIR_DEFAULTS.curl,
  wave: HAIR_DEFAULTS.wave,
  ahoge: HAIR_DEFAULTS.ahoge,
  tailHeight: HAIR_DEFAULTS.tailHeight,
  bangStyle: HAIR_DEFAULTS.bangStyle,
});

function hairStyle(style: AvatarForgeHairStyle, overrides: Partial<AvatarForgeHairParams> = {}): Partial<AvatarForgeHairParams> {
  return Object.freeze({ ...HAIR_SHAPE_DEFAULTS, ...overrides, style, replaceOriginal: true });
}

/** Six curated palettes offered by the inspector; the cards render with the current palette. */
export const CHARACTER_HAIR_PALETTES: readonly { readonly id: string; readonly label: string; readonly baseColor: string; readonly tipColor: string }[] = Object.freeze([
  { id: "ink", label: "잉크 블랙", baseColor: "#1f1a1c", tipColor: "#4a3f47" },
  { id: "walnut", label: "월넛 브라운", baseColor: "#4a302b", tipColor: "#8a6257" },
  { id: "honey", label: "허니 블론드", baseColor: "#a16207", tipColor: "#fde68a" },
  { id: "silver", label: "실버", baseColor: "#a7a6a2", tipColor: "#e4e1db" },
  { id: "rose", label: "로즈 핑크", baseColor: "#9d174d", tipColor: "#fbcfe8" },
  { id: "lavender", label: "라벤더", baseColor: "#4c1d95", tipColor: "#c4b5fd" },
]);

const HAIR_STYLES: readonly {
  readonly name: string; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[];
  readonly hair: Partial<AvatarForgeHairParams>; readonly featured?: boolean;
}[] = [
  { name: "none", label: "헤어 없음", labelEn: "No hair", hint: "원본 헤어를 숨깁니다. 모자·민머리 컷", tags: ["fantasy", "comedy"], keywords: ["민머리", "숨김", "bald", "none", "hide"], hair: hairStyle("none") },
  { name: "short", label: "숏", labelEn: "Short", hint: "가벼운 기본 숏 커트", tags: ["daily", "school", "modern"], keywords: ["짧은", "숏컷", "short", "crop"], hair: hairStyle("short"), featured: true },
  { name: "pixie", label: "픽시", labelEn: "Pixie", hint: "짧게 친 경쾌한 픽시 커트", tags: ["modern", "action"], keywords: ["픽시", "짧은", "pixie"], hair: hairStyle("pixie", { length: 0.7, volume: 0.86, fringe: 0.6, bangStyle: "side-swept" }) },
  { name: "bob", label: "보브", labelEn: "Bob", hint: "턱선에서 끊기는 보브 커트", tags: ["romance", "daily"], keywords: ["단발", "보브", "bob"], hair: hairStyle("bob", { curl: 0.25, bangStyle: "blunt" }), featured: true },
  { name: "wolf", label: "울프컷", labelEn: "Wolf cut", hint: "윗머리 짧고 뒷머리 긴 레이어드", tags: ["modern", "action"], keywords: ["울프", "레이어드", "wolf", "shag"], hair: hairStyle("wolf", { length: 1.2, volume: 1.1, wave: 0.3, bangStyle: "side-swept" }) },
  { name: "long", label: "롱", labelEn: "Long", hint: "등을 따라 흐르는 긴 생머리", tags: ["romance", "fantasy"], keywords: ["긴 머리", "생머리", "long", "straight"], hair: hairStyle("long", { length: 1.3, bangStyle: "curtain" }), featured: true },
  { name: "wavy", label: "웨이브 롱", labelEn: "Wavy long", hint: "굵은 웨이브가 흐르는 롱 헤어", tags: ["romance", "modern"], keywords: ["웨이브", "컬", "wavy", "curly"], hair: hairStyle("wavy", { length: 1.35, volume: 1.15, wave: 0.65, bangStyle: "curtain" }) },
  { name: "hime", label: "히메컷", labelEn: "Hime cut", hint: "일자 사이드락과 긴 뒷머리", tags: ["fantasy", "romance"], keywords: ["히메", "공주", "hime", "princess"], hair: hairStyle("hime", { length: 1.3, bangStyle: "blunt" }) },
  { name: "ponytail", label: "포니테일", labelEn: "Ponytail", hint: "높게 묶은 활동적인 포니테일", tags: ["action", "school"], keywords: ["포니", "묶은", "ponytail"], hair: hairStyle("ponytail", { length: 1.15, volume: 1.05, tailHeight: 0.62, bangStyle: "split" }), featured: true },
  { name: "twintail", label: "트윈테일", labelEn: "Twin tails", hint: "양쪽으로 묶은 트윈테일", tags: ["school", "comedy"], keywords: ["트윈", "양갈래", "twintail", "pigtails"], hair: hairStyle("twintail", { length: 1.1, volume: 1.1, curl: 0.5 }), featured: true },
  { name: "half-up", label: "반묶음", labelEn: "Half up", hint: "윗머리만 묶고 나머지는 내린 헤어", tags: ["romance", "daily"], keywords: ["반묶음", "하프업", "half up"], hair: hairStyle("half-up", { length: 1.12, tailHeight: 0.7, ahoge: 0.4, bangStyle: "split" }) },
  { name: "bun", label: "번", labelEn: "Bun", hint: "단정하게 올린 번 헤어", tags: ["modern", "medical"], keywords: ["번", "올림머리", "bun", "updo"], hair: hairStyle("bun", { volume: 0.95, bangStyle: "side-swept" }) },
  { name: "braid", label: "땋은 머리", labelEn: "Braid", hint: "한 갈래로 땋아 내린 머리", tags: ["fantasy", "daily"], keywords: ["땋은", "브레이드", "braid"], hair: hairStyle("braid", { length: 1.15, tailHeight: 0.42, bangStyle: "split" }) },
  { name: "twin-braid", label: "양갈래 땋기", labelEn: "Twin braids", hint: "양쪽으로 땋아 내린 머리", tags: ["daily", "fantasy"], keywords: ["양갈래", "땋기", "twin braid"], hair: hairStyle("twin-braid", { length: 1.05, bangStyle: "blunt" }) },
];

function buildHairEntries(): CharacterSlotEntry[] {
  const original = entry("hair", 0, {
    name: "original",
    label: "원본 유지",
    labelEn: "Original hair",
    hint: "모델이 가진 헤어 메시를 그대로 씁니다",
    tags: ["daily"],
    keywords: ["원본", "기본", "모델 헤어", "original", "native", "default"],
    preview: { kind: "hair-original" },
    apply: { kind: "hair-original" },
    requires: [{ kind: "hair-original" }],
    exportLayer: "hair-front",
    license: "model-native",
    featured: true,
  });
  const styles = HAIR_STYLES.map((seed, index) => entry("hair", index + 1, {
    ...seed,
    preview: {
      kind: "hair",
      style: seed.hair.style ?? "none",
      bangStyle: seed.hair.bangStyle ?? HAIR_DEFAULTS.bangStyle,
      baseColor: HAIR_DEFAULTS.baseColor,
      tipColor: HAIR_DEFAULTS.tipColor,
      length: seed.hair.length ?? HAIR_DEFAULTS.length,
      volume: seed.hair.volume ?? HAIR_DEFAULTS.volume,
    },
    apply: { kind: "forge-hair", hair: seed.hair },
    // 「헤어 없음」은 모델이 가진 헤어를 감추는 것이 전부다. 헤어가 얼굴·몸 메시에 합쳐진
    // 모델에서는 감출 대상이 없으므로, 적용된 척하지 않고 이유를 밝힌다.
    requires: seed.hair.style === "none" ? [{ kind: "hair-original" as const }] : MODEL_LOADED,
    exportLayer: "hair-front",
  }));
  return [original, ...styles];
}

/* -------------------------------------------------------------------------- */
/* body                                                                        */
/* -------------------------------------------------------------------------- */

const BODY_FLAVOR: Readonly<Record<string, { readonly hint: string; readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean }>> = {
  "runway-9": { hint: "패션·판타지 장신 비율", tags: ["fantasy", "modern"], keywords: ["런웨이", "장신", "runway", "tall"] },
  "realistic-8": { hint: "실사 비율. 극화·성인극 기준", tags: ["noir", "modern"], keywords: ["실사", "리얼", "realistic"] },
  "webtoon-7": { hint: "세로 스크롤 웹툰 주인공 표준", tags: ["romance", "school", "daily"], keywords: ["웹툰", "표준", "webtoon", "standard"], featured: true },
  "shonen-6": { hint: "액션이 읽히는 단단한 비율", tags: ["action", "school"], keywords: ["소년만화", "액션", "shonen"], featured: true },
  "cartoon-5": { hint: "코믹·개그 톤의 둥근 비율", tags: ["comedy"], keywords: ["카툰", "개그", "cartoon"], featured: true },
  "mini-4": { hint: "미니 캐릭터·굿즈 컷", tags: ["comedy", "daily"], keywords: ["미니", "굿즈", "mini"] },
  "sd-chibi-3": { hint: "SD 치비. 이모티콘·개그 컷", tags: ["comedy"], keywords: ["치비", "SD", "이모티콘", "chibi"], featured: true },
};

function buildBodyEntries(): CharacterSlotEntry[] {
  return [...STUDIO_VRM_PROPORTION_PRESETS]
    .sort((a, b) => b.targetHeadUnits - a.targetHeadUnits)
    .map((preset, index) => {
      const flavor = BODY_FLAVOR[preset.id] ?? { hint: preset.hint.slice(0, 40), tags: ["daily"] as const, keywords: [preset.id] };
      return entry("body", index, {
        name: preset.id,
        label: `${preset.targetHeadUnits}두신`,
        labelEn: `${preset.targetHeadUnits} heads`,
        hint: flavor.hint,
        tags: flavor.tags,
        keywords: [preset.label, `${preset.targetHeadUnits}두신`, "두신", "비율", "proportion", ...flavor.keywords],
        preview: {
          kind: "body",
          headUnits: preset.targetHeadUnits,
          shoulderWidth: preset.proportions.shoulderWidth,
          legLength: preset.proportions.legLength,
          torsoLength: preset.proportions.torsoLength,
        },
        apply: { kind: "proportion", presetId: preset.id },
        requires: HUMANOID,
        exportLayer: "none",
        featured: flavor.featured,
      });
    });
}

/* -------------------------------------------------------------------------- */
/* garments (top / bottom / shoes)                                             */
/* -------------------------------------------------------------------------- */

const GARMENT_GLYPHS = new Set<string>([
  "tshirt", "shirt", "sweater", "sailor", "tank", "dress", "scrubs", "blazer", "hoodie", "coat", "cardigan", "armor",
  "robe", "labcoat", "pleated", "longskirt", "shorts", "pants", "wide", "jeans", "scrubpants", "sneakers", "boots",
  "longboots", "heels", "loafers", "sandals", "clogs", "original",
]);

const GARMENT_FALLBACK_GLYPH: Readonly<Record<WardrobeItemDef["slot"], CharacterGarmentGlyph>> = {
  outer: "blazer",
  top: "tshirt",
  bottom: "pants",
  shoes: "sneakers",
};

function garmentGlyph(item: WardrobeItemDef): CharacterGarmentGlyph {
  return GARMENT_GLYPHS.has(item.id) ? (item.id as CharacterGarmentGlyph) : GARMENT_FALLBACK_GLYPH[item.slot];
}

const GARMENT_FLAVOR: Readonly<Record<string, { readonly hint: string; readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean }>> = {
  tshirt: { hint: "만능 기본 반팔 티셔츠", tags: ["daily", "modern"], keywords: ["티셔츠", "반팔", "tshirt", "tee"], featured: true },
  shirt: { hint: "긴팔 카라 셔츠. 교복·오피스", tags: ["school", "modern"], keywords: ["셔츠", "카라", "shirt", "blouse"], featured: true },
  sweater: { hint: "겨울·지적 캐릭터의 터틀넥", tags: ["daily", "romance"], keywords: ["스웨터", "니트", "터틀넥", "sweater", "knit"] },
  sailor: { hint: "교복·마린 컷 세일러 톱", tags: ["school"], keywords: ["세일러", "교복", "sailor", "uniform"], featured: true },
  tank: { hint: "여름·트레이닝 탱크톱", tags: ["action", "daily"], keywords: ["탱크톱", "민소매", "tank", "sleeveless"] },
  dress: { hint: "상하 일체형 원피스. 하의를 비웁니다", tags: ["romance"], keywords: ["원피스", "드레스", "dress"] },
  scrubs: { hint: "의료 스크럽 상의", tags: ["medical"], keywords: ["스크럽", "수술복", "scrubs", "medical"] },
  blazer: { hint: "교복·오피스 블레이저", tags: ["school", "modern"], keywords: ["블레이저", "자켓", "blazer", "jacket"], featured: true },
  hoodie: { hint: "캐주얼·스트릿 후드집업", tags: ["modern", "daily"], keywords: ["후드", "집업", "hoodie"], featured: true },
  coat: { hint: "가을·탐정 컷 롱코트", tags: ["noir", "modern"], keywords: ["코트", "롱코트", "coat", "trench"] },
  cardigan: { hint: "포근한 일상 가디건", tags: ["daily", "romance"], keywords: ["가디건", "cardigan"] },
  armor: { hint: "기사·판타지 플레이트 아머", tags: ["fantasy", "action"], keywords: ["아머", "갑옷", "기사", "armor", "knight"] },
  robe: { hint: "마법사·사제 로브", tags: ["fantasy"], keywords: ["로브", "마법사", "robe", "mage"] },
  labcoat: { hint: "의사·연구원 가운", tags: ["medical"], keywords: ["가운", "의사", "labcoat", "doctor"] },
  pleated: { hint: "천 물리 플리츠 스커트", tags: ["school", "romance"], keywords: ["플리츠", "스커트", "치마", "pleated", "skirt"], featured: true },
  longskirt: { hint: "천 물리 롱스커트", tags: ["romance", "daily"], keywords: ["롱스커트", "긴 치마", "long skirt"] },
  shorts: { hint: "여름·활동 컷 반바지", tags: ["daily", "action"], keywords: ["반바지", "shorts"], featured: true },
  pants: { hint: "정장·데일리 슬림 팬츠", tags: ["modern", "noir"], keywords: ["슬림 팬츠", "바지", "pants", "slacks"], featured: true },
  wide: { hint: "밑단이 퍼지는 와이드 팬츠", tags: ["modern", "daily"], keywords: ["와이드", "바지", "wide pants"] },
  jeans: { hint: "캐주얼 만능 청바지", tags: ["daily", "modern"], keywords: ["청바지", "데님", "jeans", "denim"], featured: true },
  scrubpants: { hint: "의료 스크럽 팬츠", tags: ["medical"], keywords: ["스크럽", "의료", "scrub pants"] },
  sneakers: { hint: "캐주얼 기본 스니커즈", tags: ["daily", "school"], keywords: ["스니커즈", "운동화", "sneakers"], featured: true },
  boots: { hint: "가을·여행 앵클부츠", tags: ["daily", "noir"], keywords: ["앵클부츠", "부츠", "boots"], featured: true },
  longboots: { hint: "무릎 아래 롱부츠", tags: ["fantasy", "noir"], keywords: ["롱부츠", "long boots"] },
  heels: { hint: "드레스·파티 하이힐", tags: ["romance", "modern"], keywords: ["하이힐", "구두", "heels"], featured: true },
  loafers: { hint: "교복·오피스 로퍼", tags: ["school", "modern"], keywords: ["로퍼", "구두", "loafers"], featured: true },
  sandals: { hint: "여름·바캉스 샌들", tags: ["daily"], keywords: ["샌들", "sandals"] },
  clogs: { hint: "병원·실험실 클로그", tags: ["medical"], keywords: ["클로그", "clogs", "medical"] },
};

type GarmentSlotKind = "top" | "bottom" | "shoes";

const GARMENT_SLOT_SPEC: Readonly<Record<GarmentSlotKind, {
  readonly wardrobeSlots: readonly WardrobeItemDef["slot"][];
  readonly originalRef: Extract<CharacterSlotApplyRef, { kind: "costume-original" }>;
  readonly originalHint: string;
  readonly exportLayer: CharacterPsdSemanticLayer;
}>> = {
  top: {
    wardrobeSlots: ["top", "outer"],
    originalRef: { kind: "costume-original", wardrobeSlot: "top", costumeSlots: ["outer", "tops", "onepiece"] },
    originalHint: "모델이 입고 있는 상의를 그대로 씁니다",
    exportLayer: "top",
  },
  bottom: {
    wardrobeSlots: ["bottom"],
    originalRef: { kind: "costume-original", wardrobeSlot: "bottom", costumeSlots: ["bottoms", "onepiece"] },
    originalHint: "모델이 입고 있는 하의를 그대로 씁니다",
    exportLayer: "bottom",
  },
  shoes: {
    wardrobeSlots: ["shoes"],
    originalRef: { kind: "costume-original", wardrobeSlot: "shoes", costumeSlots: ["shoes"] },
    originalHint: "모델이 신고 있는 신발을 그대로 씁니다",
    exportLayer: "shoes",
  },
};

function buildGarmentEntries(slot: GarmentSlotKind): CharacterSlotEntry[] {
  const spec = GARMENT_SLOT_SPEC[slot];
  const original = entry(slot, 0, {
    name: "original",
    label: "원본 유지",
    labelEn: "Original outfit",
    hint: spec.originalHint,
    tags: ["daily"],
    keywords: ["원본", "기본", "모델 의상", "original", "native", "default"],
    preview: { kind: "garment", slot: "original", glyph: "original", color: "#b7b2a8" },
    apply: spec.originalRef,
    requires: MODEL_LOADED,
    exportLayer: spec.exportLayer,
    license: "model-native",
    featured: true,
  });
  const items = spec.wardrobeSlots.flatMap((wardrobeSlot) => WARDROBE_ITEMS.filter(
    (item) => item.slot === wardrobeSlot && item.catalogStatus === "selectable",
  ));
  const garments = items.map((item, index) => {
    const flavor = GARMENT_FLAVOR[item.id] ?? { hint: item.hint.slice(0, 40), tags: ["daily"] as const, keywords: [item.id] };
    return entry(slot, index + 1, {
      name: item.id,
      label: item.label,
      labelEn: item.id,
      hint: flavor.hint,
      tags: flavor.tags,
      keywords: [item.label, ...flavor.keywords, item.slot === "outer" ? "겉옷" : ""],
      preview: { kind: "garment", slot: item.slot, glyph: garmentGlyph(item), color: item.defaultColor },
      apply: { kind: "wardrobe", slot: item.slot, itemId: item.id, color: item.defaultColor },
      requires: WARDROBE,
      exportLayer: spec.exportLayer,
      featured: flavor.featured,
    });
  });
  return [original, ...garments];
}

/* -------------------------------------------------------------------------- */
/* accessory                                                                   */
/* -------------------------------------------------------------------------- */

/** Ear props are owned by the ears slot so the two slots never fight over one prop. */
const EAR_PROP_IDS = new Set(EARS.flatMap((seed) => (seed.propId ? [seed.propId] : [])));

const ACCESSORY_FLAVOR: Readonly<Record<string, { readonly hint: string; readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean }>> = {
  cap: { hint: "캐주얼·스포츠 컷의 기본 모자", tags: ["modern", "daily"], keywords: ["캡", "모자", "cap", "hat"], featured: true },
  beret: { hint: "아트·감성 컷에 비스듬히", tags: ["romance", "modern"], keywords: ["베레모", "모자", "beret"] },
  glasses: { hint: "지적 캐릭터의 기본 안경", tags: ["school", "modern"], keywords: ["안경", "glasses"], featured: true },
  sunglasses: { hint: "쿨한 현대극·액션 컷", tags: ["modern", "action"], keywords: ["선글라스", "sunglasses", "shades"] },
  crown: { hint: "왕족·판타지 컷의 왕관", tags: ["fantasy", "romance"], keywords: ["왕관", "티아라", "crown"] },
  ribbon: { hint: "소녀 캐릭터의 머리 리본", tags: ["romance", "school"], keywords: ["리본", "ribbon", "bow"], featured: true },
  surgicalCap: { hint: "수술실 장면의 수술 모자", tags: ["medical"], keywords: ["수술 모자", "surgical cap"] },
  faceMask: { hint: "의료·감염병 장면의 마스크", tags: ["medical", "daily"], keywords: ["마스크", "mask"] },
  headphones: { hint: "음악·현대 컷의 헤드폰", tags: ["modern", "daily"], keywords: ["헤드폰", "headphones"], featured: true },
  headband: { hint: "스포츠·운동 컷", tags: ["school", "action"], keywords: ["헤드밴드", "headband"] },
  flowerCrown: { hint: "요정·자연 컷의 꽃관", tags: ["fantasy", "romance"], keywords: ["꽃관", "화관", "flower crown"] },
  choker: { hint: "패션 포인트 초커", tags: ["modern", "noir"], keywords: ["초커", "choker"] },
  horns: { hint: "악마·판타지 컷의 뿔", tags: ["fantasy", "noir"], keywords: ["뿔", "악마", "horns", "demon"] },
  halo: { hint: "천사·성스러운 컷의 후광", tags: ["fantasy"], keywords: ["후광", "천사", "halo", "angel"] },
  eyepatch: { hint: "해적·다크 히어로 안대", tags: ["noir", "action"], keywords: ["안대", "eyepatch"] },
  beanie: { hint: "겨울·캐주얼 비니", tags: ["daily", "modern"], keywords: ["비니", "beanie"] },
  earmuffs: { hint: "겨울 컷의 귀마개", tags: ["daily", "romance"], keywords: ["귀마개", "earmuffs"] },
  hairpin: { hint: "작은 포인트 머리핀", tags: ["school", "romance"], keywords: ["머리핀", "hairpin"] },
  goggles: { hint: "이마에 올린 고글", tags: ["action", "fantasy"], keywords: ["고글", "goggles"] },
  backpack: { hint: "학생·여행 컷의 백팩", tags: ["school", "daily"], keywords: ["백팩", "가방", "backpack", "bag"], featured: true },
  shoulderbag: { hint: "데일리 컷의 숄더백", tags: ["daily", "modern"], keywords: ["숄더백", "가방", "shoulder bag"] },
  cape: { hint: "히어로·판타지 망토", tags: ["fantasy", "action"], keywords: ["망토", "케이프", "cape", "cloak"], featured: true },
  wings: { hint: "천사·요정 날개", tags: ["fantasy"], keywords: ["날개", "wings"] },
  stethoscope: { hint: "의사·간호사 컷의 청진기", tags: ["medical"], keywords: ["청진기", "stethoscope"] },
  idBadge: { hint: "병원·연구실 명찰", tags: ["medical"], keywords: ["명찰", "id badge"] },
  scarf: { hint: "겨울·패션 목도리", tags: ["daily", "romance"], keywords: ["목도리", "스카프", "scarf"] },
  holster: { hint: "액션·서부 컷의 총집", tags: ["action", "noir"], keywords: ["총집", "holster"] },
  belt: { hint: "허리 장식 벨트", tags: ["action", "modern"], keywords: ["벨트", "belt"] },
  backwing: { hint: "요정·소악마의 작은 날개", tags: ["fantasy", "comedy"], keywords: ["작은 날개", "요정", "small wings"] },
  gloves: { hint: "액션·정장 장갑", tags: ["action", "modern"], keywords: ["장갑", "gloves"] },
  guitar: { hint: "밴드·거리 연주 컷", tags: ["modern", "school"], keywords: ["기타", "guitar"] },
  quiver: { hint: "궁수·판타지 컷의 화살통", tags: ["fantasy", "action"], keywords: ["화살통", "궁수", "quiver", "archer"] },
  nameTag: { hint: "학교·회사 명찰", tags: ["school", "modern"], keywords: ["명찰", "name tag"] },
  apron: { hint: "요리·카페 컷의 앞치마", tags: ["daily"], keywords: ["앞치마", "apron"] },
  tail: { hint: "동물귀 코스튬 꼬리", tags: ["fantasy", "comedy"], keywords: ["꼬리", "tail"] },
};

/**
 * Wearable head / body props. The `blender_*` catalog is scene furniture and full-head gear that
 * belongs to the prop panel, and the two ear props are owned by the ears slot.
 */
function isAccessoryProp(prop: PropDef): boolean {
  return (prop.category === "head" || prop.category === "body")
    && !prop.id.startsWith("blender_")
    && !EAR_PROP_IDS.has(prop.id);
}

function buildAccessoryEntries(): CharacterSlotEntry[] {
  return VRM_PROPS.filter(isAccessoryProp).map((prop, index) => {
    const flavor = ACCESSORY_FLAVOR[prop.id] ?? { hint: prop.hint.slice(0, 40), tags: ["modern"] as const, keywords: [prop.id] };
    return entry("accessory", index, {
      name: prop.id,
      label: prop.label,
      labelEn: prop.id,
      hint: flavor.hint,
      tags: flavor.tags,
      keywords: [prop.label, prop.category === "head" ? "머리" : "몸", ...flavor.keywords],
      preview: { kind: "prop", propId: prop.id, category: prop.category, color: prop.defaultColor ?? "#b7b2a8" },
      apply: { kind: "prop", propId: prop.id },
      requires: PROPS,
      exportLayer: "accessory",
      featured: flavor.featured,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* expression                                                                  */
/* -------------------------------------------------------------------------- */

const EXPRESSION_FLAVOR: Readonly<Record<string, { readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean }>> = {
  xf_joy: { tags: ["romance", "daily"], keywords: ["joy", "happy", "smile"], featured: true },
  xf_grin: { tags: ["comedy", "school"], keywords: ["grin", "laugh"] },
  xf_sad: { tags: ["romance"], keywords: ["sad"], featured: true },
  xf_tears: { tags: ["romance"], keywords: ["tears", "cry"] },
  xf_angry: { tags: ["action"], keywords: ["angry", "mad"], featured: true },
  xf_grudge: { tags: ["comedy"], keywords: ["grudge", "annoyed"] },
  xf_surprised: { tags: ["comedy", "daily"], keywords: ["surprised", "shock"], featured: true },
  xf_blank: { tags: ["comedy"], keywords: ["blank", "dazed"] },
  xf_shy: { tags: ["romance", "school"], keywords: ["shy", "blush"], featured: true },
  xf_wink: { tags: ["romance", "comedy"], keywords: ["wink"], featured: true },
  xf_sleepy: { tags: ["daily"], keywords: ["sleepy", "tired"] },
  xf_neutral: { tags: ["daily"], keywords: ["neutral", "reset", "default", "기본"] },
  xf_determined: { tags: ["action"], keywords: ["determined", "resolve"] },
  xf_pout: { tags: ["romance", "comedy"], keywords: ["pout", "sulky"] },
  xf_smirk: { tags: ["noir"], keywords: ["smirk", "confident"] },
  xf_awe: { tags: ["fantasy"], keywords: ["awe", "wow"] },
  xf_evil: { tags: ["noir", "fantasy"], keywords: ["evil", "villain"] },
  xf_cry_laugh: { tags: ["comedy"], keywords: ["lol", "cry laugh"] },
  xf_confused: { tags: ["comedy"], keywords: ["confused"] },
  xf_love: { tags: ["romance"], keywords: ["love", "heart eyes"] },
  xf_scream: { tags: ["action", "noir"], keywords: ["scream", "fear"] },
  xf_cool: { tags: ["modern"], keywords: ["cool", "chill"] },
  xf_focus: { tags: ["modern", "school"], keywords: ["focus", "concentrate"] },
  xf_yawn: { tags: ["daily"], keywords: ["yawn"] },
  xf_sassy: { tags: ["modern"], keywords: ["sassy", "proud"] },
  xf_innocent: { tags: ["romance"], keywords: ["innocent", "puppy eyes"] },
  xf_serious: { tags: ["noir"], keywords: ["serious"] },
  xf_excited: { tags: ["comedy", "school"], keywords: ["excited", "starry eyes"] },
};

function expressionRequirement(preset: StudioExpressionPreset): readonly CharacterCapabilityRequirement[] {
  const names = Object.keys(preset.weights).filter((name) => (preset.weights[name] ?? 0) > 0);
  return names.length > 0 ? [{ kind: "expression", names }] : MODEL_LOADED;
}

function buildExpressionEntries(): CharacterSlotEntry[] {
  return EXPRESSION_PRESETS.map((preset, index) => {
    const flavor = EXPRESSION_FLAVOR[preset.id] ?? { tags: ["daily"] as const, keywords: [preset.id] };
    return entry("expression", index, {
      name: preset.id,
      label: preset.label,
      labelEn: preset.id.replace(/^xf_/u, "").replace(/_/gu, " "),
      hint: preset.tone.slice(0, 40),
      tags: flavor.tags,
      keywords: [preset.label, preset.tone, ...Object.keys(preset.weights), ...flavor.keywords],
      preview: { kind: "expression", emoji: preset.emoji, weights: Object.freeze({ ...preset.weights }) },
      apply: { kind: "expression", presetId: preset.id },
      requires: expressionRequirement(preset),
      exportLayer: "face",
      featured: flavor.featured,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* pose                                                                        */
/* -------------------------------------------------------------------------- */

export type CharacterPoseGroupId = "daily" | "emotion" | "action" | "sitting" | "reaction";

/** Shelf sections for the pose slot; `order` bands keep each group contiguous. */
export const CHARACTER_POSE_GROUPS: readonly { readonly id: CharacterPoseGroupId; readonly label: string; readonly orderBase: number }[] = Object.freeze([
  { id: "daily", label: "일상", orderBase: 100 },
  { id: "emotion", label: "감정", orderBase: 200 },
  { id: "action", label: "액션", orderBase: 300 },
  { id: "sitting", label: "앉기/눕기", orderBase: 400 },
  { id: "reaction", label: "리액션", orderBase: 500 },
]);

const POSE_GROUP_TAGS: Readonly<Record<CharacterPoseGroupId, readonly CharacterGenreTag[]>> = {
  daily: ["daily"],
  emotion: ["romance"],
  action: ["action"],
  sitting: ["daily"],
  reaction: ["comedy"],
};

const POSE_GROUP_KEYWORDS: Readonly<Record<CharacterPoseGroupId, readonly string[]>> = {
  daily: ["일상", "daily", "idle", "stand"],
  emotion: ["감정", "emotion"],
  action: ["액션", "action"],
  sitting: ["앉기", "눕기", "sit", "lie"],
  reaction: ["리액션", "reaction"],
};

const POSE_FLAVOR: Readonly<Record<string, { readonly group: CharacterPoseGroupId; readonly tags?: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean }>> = {
  ni_weight_left: { group: "daily", keywords: ["natural", "idle"], featured: true },
  ni_weight_right: { group: "daily", keywords: ["natural", "idle"] },
  ni_calm_front: { group: "daily", keywords: ["natural", "idle", "front"] },
  ni_open_easy: { group: "daily", keywords: ["natural", "idle", "relaxed"] },
  xp_wave_greeting: { group: "daily", tags: ["daily", "school"], keywords: ["wave", "hello", "greeting"], featured: true },
  xp_idle_relax: { group: "daily", keywords: ["relax", "idle"] },
  xp_hands_on_hips: { group: "daily", tags: ["daily", "action"], keywords: ["hands on hips", "confident"], featured: true },
  xp_one_hand_hip: { group: "daily", keywords: ["hand on hip"] },
  xp_hands_behind: { group: "daily", keywords: ["hands behind", "walk"] },
  xp_look_back: { group: "daily", tags: ["daily", "romance"], keywords: ["look back", "glance"] },
  xp_phone_look: { group: "daily", tags: ["daily", "modern"], keywords: ["phone", "smartphone"] },
  xp_phone_selfie: { group: "daily", tags: ["daily", "modern"], keywords: ["selfie", "phone"] },
  xp_typing: { group: "daily", tags: ["daily", "modern"], keywords: ["typing", "laptop", "work"] },
  xp_cooking: { group: "daily", keywords: ["cooking", "pan"] },
  xp_reading: { group: "daily", tags: ["daily", "school"], keywords: ["reading", "book"] },
  xp_wait_line: { group: "daily", keywords: ["waiting", "queue"] },
  xp_stretch: { group: "daily", keywords: ["stretch", "morning"] },
  xp_lean_wall: { group: "daily", tags: ["daily", "modern"], keywords: ["lean", "wall", "casual"] },
  xp_side_lean: { group: "daily", keywords: ["lean", "relaxed"] },
  xp_cool_lean: { group: "daily", tags: ["daily", "noir"], keywords: ["cool", "lean"] },
  xp_polite_bow: { group: "daily", tags: ["daily", "school"], keywords: ["bow", "polite"] },
  xp_bow_deep: { group: "daily", tags: ["daily", "school"], keywords: ["deep bow", "apology"] },
  xp_salutation: { group: "daily", tags: ["daily", "action"], keywords: ["salute", "military"] },
  xp_present: { group: "daily", tags: ["daily", "modern"], keywords: ["present", "introduce", "show"] },
  xp_sleep_stand: { group: "daily", tags: ["daily", "comedy"], keywords: ["sleepy", "doze"] },
  xp_finger_heart: { group: "emotion", tags: ["romance", "school"], keywords: ["finger heart", "fan service"], featured: true },
  xp_teary: { group: "emotion", keywords: ["teary", "sad"] },
  xp_cry: { group: "emotion", keywords: ["cry", "tears"] },
  xp_blush_cover: { group: "emotion", tags: ["romance", "school"], keywords: ["blush", "shy", "cover"] },
  xp_think_chin: { group: "emotion", tags: ["romance", "modern"], keywords: ["think", "chin", "ponder"] },
  xp_chin_rest: { group: "emotion", tags: ["romance", "daily"], keywords: ["chin rest", "thinking"] },
  xp_hold_heart: { group: "emotion", keywords: ["hand on heart", "sincere"] },
  xp_hug_self: { group: "emotion", tags: ["romance", "noir"], keywords: ["hug self", "cold", "anxious"] },
  xp_propose_kneel: { group: "emotion", keywords: ["propose", "kneel", "confession"] },
  xp_laugh: { group: "emotion", tags: ["romance", "comedy"], keywords: ["laugh", "lol"] },
  xp_meditate: { group: "emotion", tags: ["romance", "fantasy"], keywords: ["meditate", "calm"] },
  xp_sprint: { group: "action", keywords: ["sprint", "dash", "run"], featured: true },
  xp_run: { group: "action", keywords: ["run", "running"] },
  xp_guard_up: { group: "action", keywords: ["guard", "fight", "fists"] },
  xp_guard: { group: "action", keywords: ["guard", "defend"] },
  xp_kick: { group: "action", keywords: ["kick"] },
  xp_punch: { group: "action", keywords: ["punch"] },
  xp_fist_up: { group: "action", tags: ["action", "school"], keywords: ["fist up", "resolve"] },
  xp_sword_ready: { group: "action", tags: ["action", "fantasy"], keywords: ["sword", "stance", "battle"], featured: true },
  xp_archer: { group: "action", tags: ["action", "fantasy"], keywords: ["archer", "bow"] },
  xp_superhero: { group: "action", tags: ["action", "fantasy"], keywords: ["superhero", "hero"] },
  xp_jump_pose: { group: "action", keywords: ["jump", "air"] },
  xp_fly_pose: { group: "action", tags: ["action", "fantasy"], keywords: ["fly", "flight"] },
  xp_spin: { group: "action", tags: ["action", "romance"], keywords: ["spin", "turn"] },
  xp_dance: { group: "action", tags: ["action", "modern"], keywords: ["dance"] },
  xp_sneak: { group: "action", tags: ["action", "noir"], keywords: ["sneak", "stealth"] },
  xp_balance: { group: "action", keywords: ["balance", "one leg"] },
  xp_angel_wing: { group: "action", tags: ["action", "fantasy"], keywords: ["angel", "wings"] },
  xp_chair_sit: { group: "sitting", keywords: ["sit", "chair"], featured: true },
  xp_sit_floor: { group: "sitting", keywords: ["sit", "floor"] },
  xp_kneel: { group: "sitting", tags: ["daily", "school"], keywords: ["kneel"] },
  xp_kneel_pray: { group: "sitting", tags: ["daily", "fantasy"], keywords: ["kneel", "pray"] },
  xp_lying_down: { group: "sitting", keywords: ["lie down", "lying"] },
  xp_sad_sit: { group: "sitting", tags: ["daily", "romance"], keywords: ["sad", "sit"] },
  xp_crouch: { group: "sitting", tags: ["daily", "action"], keywords: ["crouch", "hide"] },
  xp_shock_hands: { group: "reaction", keywords: ["shock", "gasp"] },
  xp_shock: { group: "reaction", keywords: ["shock", "surprise"] },
  xp_shrug: { group: "reaction", keywords: ["shrug", "dunno"] },
  xp_banzai: { group: "reaction", tags: ["comedy", "school"], keywords: ["banzai", "cheer", "arms up"] },
  xp_double_v: { group: "reaction", tags: ["comedy", "school"], keywords: ["double v", "peace", "selfie"] },
  xp_victory: { group: "reaction", tags: ["comedy", "action"], keywords: ["victory", "win"] },
  xp_cheer_both: { group: "reaction", tags: ["comedy", "school"], keywords: ["cheer", "support"] },
  xp_thumbs_up: { group: "reaction", keywords: ["thumbs up", "good"] },
  xp_point_you: { group: "reaction", tags: ["comedy", "action"], keywords: ["point", "you"] },
  xp_point_forward: { group: "reaction", keywords: ["point", "forward", "direct"] },
  xp_jump_joy: { group: "reaction", tags: ["comedy", "school"], keywords: ["jump", "joy"], featured: true },
  xp_fall_back: { group: "reaction", keywords: ["fall", "back", "shock"] },
};

function poseGroupOf(id: string): CharacterPoseGroupId {
  return POSE_FLAVOR[id]?.group ?? "daily";
}

function buildPoseEntries(): CharacterSlotEntry[] {
  const presets: readonly StudioPosePreset[] = [...NATURAL_IDLE_POSES, ...EXTRA_POSE_PRESETS];
  const counters = new Map<CharacterPoseGroupId, number>();
  return presets.map((preset) => {
    const flavor = POSE_FLAVOR[preset.id];
    const group = poseGroupOf(preset.id);
    const groupMeta = CHARACTER_POSE_GROUPS.find((candidate) => candidate.id === group) ?? CHARACTER_POSE_GROUPS[0]!;
    const index = counters.get(group) ?? 0;
    counters.set(group, index + 1);
    return entry("pose", groupMeta.orderBase + index, {
      name: preset.id,
      label: preset.label,
      labelEn: preset.id.replace(/^(xp|ni)_/u, "").replace(/_/gu, " "),
      hint: preset.tone.slice(0, 40),
      tags: flavor?.tags ?? POSE_GROUP_TAGS[group],
      keywords: [preset.label, preset.tone, groupMeta.label, ...POSE_GROUP_KEYWORDS[group], ...(flavor?.keywords ?? [])],
      preview: { kind: "pose", presetId: preset.id, tone: preset.tone },
      apply: { kind: "pose", presetId: preset.id },
      requires: HUMANOID,
      exportLayer: "pose",
      featured: flavor?.featured,
    });
  }).sort((a, b) => a.order - b.order);
}

/* -------------------------------------------------------------------------- */
/* hand-pose                                                                   */
/* -------------------------------------------------------------------------- */

const HAND_POSES: readonly {
  readonly id: CharacterHandPoseType; readonly label: string; readonly labelEn: string; readonly hint: string;
  readonly tags: readonly CharacterGenreTag[]; readonly keywords: readonly string[]; readonly featured?: boolean;
}[] = [
  { id: "relaxed", label: "기본", labelEn: "Relaxed", hint: "힘을 뺀 자연스러운 손", tags: ["daily"], keywords: ["기본", "편안", "relaxed", "default"], featured: true },
  { id: "open", label: "보", labelEn: "Open", hint: "손가락을 다 편 손", tags: ["daily", "comedy"], keywords: ["펴기", "보자기", "open", "paper"], featured: true },
  { id: "fist", label: "주먹", labelEn: "Fist", hint: "꽉 쥔 주먹", tags: ["action"], keywords: ["주먹", "바위", "fist", "rock"], featured: true },
  { id: "point", label: "가리키기", labelEn: "Point", hint: "검지로 가리키기", tags: ["daily", "comedy"], keywords: ["검지", "지목", "point", "index"], featured: true },
  { id: "peace", label: "브이", labelEn: "Peace", hint: "브이 사인", tags: ["school", "comedy"], keywords: ["브이", "피스", "peace", "v sign"], featured: true },
  { id: "thumbsUp", label: "따봉", labelEn: "Thumbs up", hint: "엄지 척", tags: ["daily", "comedy"], keywords: ["엄지", "좋아요", "thumbs up", "like"] },
  { id: "holding", label: "무기 쥐기", labelEn: "Holding", hint: "검·지팡이 같은 막대형 소품 쥐기", tags: ["action", "fantasy"], keywords: ["쥐기", "무기", "grip", "hold", "weapon"] },
  { id: "phoneGrip", label: "스마트폰", labelEn: "Phone grip", hint: "스마트폰을 쥔 손", tags: ["modern", "daily"], keywords: ["폰", "스마트폰", "phone"] },
  { id: "penGrip", label: "펜 쥐기", labelEn: "Pen grip", hint: "펜·연필을 쥔 손", tags: ["school", "modern"], keywords: ["펜", "연필", "필기", "pen", "pencil"] },
  { id: "fingerHeart", label: "손가락 하트", labelEn: "Finger heart", hint: "엄지와 검지로 만든 하트", tags: ["romance", "school"], keywords: ["하트", "손하트", "finger heart"] },
  { id: "cupGrip", label: "찻잔 잡기", labelEn: "Cup grip", hint: "컵·찻잔을 든 손", tags: ["daily", "romance"], keywords: ["컵", "찻잔", "cup", "mug"] },
  { id: "rockRoll", label: "락/파이팅", labelEn: "Rock on", hint: "검지·새끼손가락을 편 락 사인", tags: ["modern", "action"], keywords: ["락", "파이팅", "rock", "horns"] },
  { id: "okSign", label: "OK 수신호", labelEn: "OK sign", hint: "엄지와 검지로 만든 OK", tags: ["daily", "comedy"], keywords: ["오케이", "ok", "okay"] },
];

function buildHandPoseEntries(): CharacterSlotEntry[] {
  return HAND_POSES.map((seed, index) => entry("hand-pose", index, {
    name: seed.id,
    label: seed.label,
    labelEn: seed.labelEn,
    hint: seed.hint,
    tags: seed.tags,
    keywords: [seed.label, ...seed.keywords],
    preview: { kind: "hand-pose", poseType: seed.id },
    apply: { kind: "hand-pose", poseType: seed.id },
    requires: HUMANOID,
    exportLayer: "pose",
    featured: seed.featured,
  }));
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

const ENTRIES_BY_SLOT: Readonly<Record<CharacterSlotKind, readonly CharacterSlotEntry[]>> = Object.freeze({
  "face-shape": Object.freeze(buildFaceShapeEntries()),
  eyes: Object.freeze(buildEyeEntries()),
  irises: Object.freeze(buildIrisEntries()),
  nose: Object.freeze(buildNoseEntries()),
  mouth: Object.freeze(buildMouthEntries()),
  ears: Object.freeze(buildEarEntries()),
  hair: Object.freeze(buildHairEntries()),
  body: Object.freeze(buildBodyEntries()),
  top: Object.freeze(buildGarmentEntries("top")),
  bottom: Object.freeze(buildGarmentEntries("bottom")),
  shoes: Object.freeze(buildGarmentEntries("shoes")),
  accessory: Object.freeze(buildAccessoryEntries()),
  expression: Object.freeze(buildExpressionEntries()),
  pose: Object.freeze(buildPoseEntries()),
  "hand-pose": Object.freeze(buildHandPoseEntries()),
});

export const CHARACTER_SLOT_CATALOG: CharacterSlotCatalog = Object.freeze({
  version: 1,
  slots: CHARACTER_SLOT_METAS,
  entries: Object.freeze(CHARACTER_SLOT_METAS.flatMap((meta) => ENTRIES_BY_SLOT[meta.id])),
});

const ENTRY_BY_ID = new Map<string, CharacterSlotEntry>();
for (const item of CHARACTER_SLOT_CATALOG.entries) {
  if (!ENTRY_BY_ID.has(item.id)) ENTRY_BY_ID.set(item.id, item);
}

/**
 * The entry that represents "nothing changed / keep the model's own" per slot. Used for
 * changed-slot counting and for "clear" plans. Slots without a neutral entry map to `null`.
 */
export const CHARACTER_NEUTRAL_SLOT_ENTRY_IDS: Readonly<Record<CharacterSlotKind, string | null>> = Object.freeze({
  "face-shape": "face-shape:balanced",
  eyes: "eyes:original",
  irises: "irises:standard",
  nose: "nose:original",
  mouth: "mouth:neat-line",
  ears: "ears:standard",
  hair: "hair:original",
  body: null,
  top: "top:original",
  bottom: "bottom:original",
  shoes: "shoes:original",
  accessory: null,
  expression: "expression:xf_neutral",
  pose: null,
  "hand-pose": "hand-pose:relaxed",
});

export function listCharacterSlotEntries(slot: CharacterSlotKind): readonly CharacterSlotEntry[] {
  return ENTRIES_BY_SLOT[slot] ?? [];
}

export function findCharacterSlotEntry(id: string): CharacterSlotEntry | null {
  return ENTRY_BY_ID.get(id) ?? null;
}

const SEARCH_INDEX = new Map<string, string>();

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
}

function searchHaystack(item: CharacterSlotEntry): string {
  const cached = SEARCH_INDEX.get(item.id);
  if (cached !== undefined) return cached;
  const haystack = normalizeSearchText([
    item.label,
    item.labelEn ?? "",
    item.hint,
    ...item.keywords,
    ...item.tags,
    ...item.tags.map((tag) => CHARACTER_GENRE_TAG_LABELS[tag]),
    item.id.slice(item.id.indexOf(":") + 1),
  ].join(" "));
  SEARCH_INDEX.set(item.id, haystack);
  return haystack;
}

/**
 * Case-insensitive search over label / hint / keywords / tags. Every whitespace-separated token
 * must match (AND); `tag` narrows to one genre tag. The result keeps the catalog order.
 */
export function searchCharacterSlotEntries(
  slot: CharacterSlotKind,
  query: string,
  tag: string | null = null,
): readonly CharacterSlotEntry[] {
  const tokens = normalizeSearchText(query ?? "").split(/\s+/u).filter(Boolean);
  const tagFilter = tag && tag.trim() ? tag.trim() : null;
  return listCharacterSlotEntries(slot).filter((item) => {
    if (tagFilter && !item.tags.includes(tagFilter as CharacterGenreTag)) return false;
    if (tokens.length === 0) return true;
    const haystack = searchHaystack(item);
    return tokens.every((token) => haystack.includes(token));
  });
}
