// VRM 실장착 워드로브 시스템 — 채색이 아니라 실제 3D 의상 지오메트리를 캐릭터에 장착한다.
// 겉옷/상의/하의/신발 4슬롯. 아이템은 여러 "파츠"로 분해되어 각 파츠가 humanoid 본에 부착되므로
// 포즈를 바꿔도 몸을 따라 움직인다(소품 studio-vrm-props와 같은 본 포털 부착 패턴의 의상 확장).
//
// 설계 원칙:
//  - three 의존 0. 아이템 → 파츠 스펙(도형·본·오프셋·정렬축) 순수 함수라 단위 테스트 가능.
//    실제 메시 생성·부착은 StudioVrmPoser가 스펙을 받아 수행한다.
//  - 사이징은 모델별 골격 실측 치수(WardrobeMetrics)로 계산 → 어떤 VRM에도 자동 핏.
//  - 부착 본은 VRM 필수 humanoid 본만 사용(spine/hips/팔다리/발) — chest·neck 등 옵셔널 본 미의존.

import {
  sampleBodySilhouette,
  sanitizeBodySilhouette,
  widestHalfWidth,
  type BodySilhouette,
  type BodySilhouetteRing,
} from "./studio-vrm-body-silhouette";

import type { CostumeSlot, CostumeState } from "./studio-vrm-costume";

export const VRM_WARDROBE_VERSION = 2 as const;
export const LEGACY_VRM_WARDROBE_VERSION = 1 as const;

/* ── 슬롯 ────────────────────────────────────────────────────────────── */

export type WardrobeSlot = "outer" | "top" | "bottom" | "shoes";

export const WARDROBE_SLOTS: readonly WardrobeSlot[] = ["outer", "top", "bottom", "shoes"] as const;

export const WARDROBE_SLOT_LABELS: Record<WardrobeSlot, string> = {
  outer: "겉옷",
  top: "상의",
  bottom: "하의",
  shoes: "신발",
};

export type WardrobeFabricId =
  | "cotton"
  | "jersey"
  | "knit"
  | "wool"
  | "denim"
  | "satin"
  | "leather"
  | "steel";

export interface WardrobeFabricPreset {
  id: WardrobeFabricId;
  label: string;
  hint: string;
  roughness: number;
  metalness: number;
  sheen: number;
  sheenRoughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Procedural micro-weave height. Zero disables the weave texture. */
  weaveStrength: number;
  /** Number of warp/weft repeats across the generated tile. */
  weaveFrequency: number;
}

export const WARDROBE_FABRICS: readonly WardrobeFabricPreset[] = [
  { id: "cotton", label: "코튼", hint: "셔츠처럼 보송하고 균형 잡힌 기본 직물", roughness: 0.78, metalness: 0, sheen: 0.22, sheenRoughness: 0.78, clearcoat: 0.01, clearcoatRoughness: 0.95, weaveStrength: 0.018, weaveFrequency: 10 },
  { id: "jersey", label: "저지", hint: "티셔츠·후드처럼 부드러운 편직물", roughness: 0.86, metalness: 0, sheen: 0.32, sheenRoughness: 0.84, clearcoat: 0, clearcoatRoughness: 1, weaveStrength: 0.024, weaveFrequency: 13 },
  { id: "knit", label: "니트", hint: "스웨터처럼 굵고 포근한 짜임", roughness: 0.94, metalness: 0, sheen: 0.42, sheenRoughness: 0.9, clearcoat: 0, clearcoatRoughness: 1, weaveStrength: 0.042, weaveFrequency: 7 },
  { id: "wool", label: "울", hint: "코트·로브처럼 묵직하고 잔광이 적은 직물", roughness: 0.9, metalness: 0, sheen: 0.34, sheenRoughness: 0.88, clearcoat: 0, clearcoatRoughness: 1, weaveStrength: 0.03, weaveFrequency: 9 },
  { id: "denim", label: "데님", hint: "사선 결이 읽히는 단단한 청바지 직물", roughness: 0.88, metalness: 0, sheen: 0.18, sheenRoughness: 0.82, clearcoat: 0.005, clearcoatRoughness: 0.96, weaveStrength: 0.035, weaveFrequency: 15 },
  { id: "satin", label: "새틴", hint: "드레스처럼 매끈하고 방향성 하이라이트가 선명한 직물", roughness: 0.34, metalness: 0, sheen: 0.78, sheenRoughness: 0.38, clearcoat: 0.08, clearcoatRoughness: 0.45, weaveStrength: 0.012, weaveFrequency: 18 },
  { id: "leather", label: "가죽", hint: "부츠·로퍼처럼 단단하고 은은한 코팅이 있는 표면", roughness: 0.48, metalness: 0.02, sheen: 0.08, sheenRoughness: 0.62, clearcoat: 0.22, clearcoatRoughness: 0.42, weaveStrength: 0.014, weaveFrequency: 20 },
  { id: "steel", label: "금속", hint: "플레이트 아머용 단단한 금속 표면", roughness: 0.28, metalness: 0.88, sheen: 0, sheenRoughness: 1, clearcoat: 0.26, clearcoatRoughness: 0.28, weaveStrength: 0, weaveFrequency: 1 },
] as const;

export function wardrobeFabricById(id: string): WardrobeFabricPreset | undefined {
  return WARDROBE_FABRICS.find((fabric) => fabric.id === id);
}

export type WardrobeGarmentRegion = "torso" | "arms" | "hips" | "legs" | "feet";

export interface WardrobeFitProfile {
  version: 1;
  layer: "base" | "outer" | "shoe";
  layerRank: number;
  regions: readonly WardrobeGarmentRegion[];
  /** Clearance already built into the procedural silhouette at fit=1. */
  baseBodyClearanceM: number;
  /** Minimum room reserved for ordinary joint motion. */
  motionAllowanceM: number;
  /** Extra room required over an intersecting inner layer. */
  layerClearanceM: number;
}

function defaultWardrobeFabric(itemId: string, slot: WardrobeSlot): WardrobeFabricId {
  if (itemId === "armor") return "steel";
  if (["boots", "longboots", "heels", "loafers"].includes(itemId)) return "leather";
  if (["jeans", "pants", "wide", "shorts"].includes(itemId)) return "denim";
  if (["sweater", "cardigan"].includes(itemId)) return "knit";
  if (["coat", "robe", "blazer"].includes(itemId)) return "wool";
  if (["dress", "sailor", "longskirt", "pleated"].includes(itemId)) return "satin";
  if (["hoodie", "tshirt", "tank"].includes(itemId)) return "jersey";
  if (slot === "shoes") return "leather";
  return "cotton";
}

function wardrobeFitProfile(itemId: string, slot: WardrobeSlot): WardrobeFitProfile {
  if (slot === "outer") {
    const long = ["coat", "robe", "labcoat"].includes(itemId);
    return {
      version: 1,
      layer: "outer",
      layerRank: 30,
      regions: long ? ["torso", "arms", "hips", "legs"] : ["torso", "arms"],
      baseBodyClearanceM: itemId === "armor" ? 0.026 : 0.022,
      motionAllowanceM: itemId === "armor" ? 0.014 : 0.012,
      layerClearanceM: itemId === "armor" ? 0.011 : 0.008,
    };
  }
  if (slot === "top") {
    return {
      version: 1,
      layer: "base",
      layerRank: 10,
      regions: ["torso", "arms"],
      baseBodyClearanceM: itemId === "sweater" ? 0.019 : 0.015,
      motionAllowanceM: itemId === "sweater" ? 0.012 : 0.009,
      layerClearanceM: 0.004,
    };
  }
  if (slot === "bottom") {
    const skirt = ["pleated", "longskirt", "dress"].includes(itemId);
    return {
      version: 1,
      layer: "base",
      layerRank: 12,
      regions: ["hips", "legs"],
      baseBodyClearanceM: skirt ? 0.024 : 0.015,
      motionAllowanceM: skirt ? 0.014 : 0.01,
      layerClearanceM: 0.004,
    };
  }
  return {
    version: 1,
    layer: "shoe",
    layerRank: 20,
    regions: ["feet"],
    baseBodyClearanceM: 0.014,
    motionAllowanceM: 0.009,
    layerClearanceM: 0.004,
  };
}

/** 장착 슬롯 → 자동 숨김 대상이 되는 기존(베이크드) 의상 슬롯 매핑. */
export const WARDROBE_HIDE_COSTUME_SLOTS: Record<WardrobeSlot, CostumeSlot[]> = {
  outer: ["outer"],
  top: ["tops", "onepiece"],
  bottom: ["bottoms", "onepiece"],
  shoes: ["shoes"],
};

/**
 * 실장착 워드로브와 같은 부위의 베이크드 의상을 숨긴 최종 의상 상태를 만든다.
 *
 * 프리셋/undo/공유 상태 복원은 개별 장착 핸들러를 거치지 않으므로, 이 계산을 복원 경로에서도
 * 한 번 더 수행해야 원본 의상과 절차형 의상이 겹쳐 보이지 않는다. 사용자가 직접 숨긴 메시와
 * 리컬러 정보는 그대로 보존한다.
 */
export function mergeWardrobeCostumeVisibility(
  costume: CostumeState,
  wardrobe: WardrobeState,
  meshes: readonly { key: string; slot: CostumeSlot }[],
  autoHide: boolean,
): CostumeState {
  if (!autoHide) {
    return { hidden: [...costume.hidden], recolor: { ...costume.recolor } };
  }

  const hiddenSlots = new Set<CostumeSlot>();
  for (const slot of WARDROBE_SLOTS) {
    if (!wardrobe[slot]) continue;
    for (const costumeSlot of WARDROBE_HIDE_COSTUME_SLOTS[slot]) {
      hiddenSlots.add(costumeSlot);
    }
  }

  const wardrobeMeshKeys = meshes
    .filter((mesh) => hiddenSlots.has(mesh.slot))
    .map((mesh) => mesh.key);

  return {
    hidden: Array.from(new Set([...costume.hidden, ...wardrobeMeshKeys])),
    recolor: { ...costume.recolor },
  };
}

/* ── 골격 실측 치수 ──────────────────────────────────────────────────── */

export type Vec3 = readonly [number, number, number];

/** 팔다리 한 세그먼트의 실측: 길이 + 본 로컬 공간에서 자식 관절을 향하는 단위 축. */
export interface LimbMetric {
  len: number;
  axis: Vec3;
}

export interface SideMetric {
  left: LimbMetric;
  right: LimbMetric;
}

/**
 * 모델별 골격 실측 치수(미터). StudioVrmPoser가 정규화 휴머노이드 rest 포즈에서 측정한다.
 * 모든 방향 벡터는 해당 부착 본의 로컬 공간 기준 단위 벡터.
 */
export interface WardrobeMetrics {
  /** Whether the dimensions came from the loaded raw/skinned rig or the guarded fallback. */
  source: "raw-rig" | "partial-rig" | "fallback";
  /** 어깨 폭(좌우 upperArm 관절 거리). */
  shoulderW: number;
  /** 골반 폭(좌우 upperLeg 관절 거리). */
  hipW: number;
  /** hips 관절 → spine 관절 거리. */
  hipsToSpine: number;
  /** spine 관절 → 목 부근(neck 또는 head) 거리. */
  spineToNeck: number;
  /** 발목(발 관절)의 지면 기준 높이. */
  ankleH: number;
  /** 몸통 위쪽 방향(spine/hips 로컬). */
  up: Vec3;
  /** 발이 향하는 앞 방향(발 본 로컬). */
  footForward: { left: Vec3; right: Vec3 };
  upperArm: SideMetric;
  lowerArm: SideMetric;
  upperLeg: SideMetric;
  lowerLeg: SideMetric;
  /**
   * 스킨 메시에서 실측한 몸통 단면(hips→목). 있으면 절차형 셸이 어깨 폭 배수 대신 이 표면 위에
   * 여유분을 얹어 재단된다. 측정 실패·부분 리그에서는 null이고 재단은 골격 폴백을 쓴다.
   */
  torso: BodySilhouette | null;
}

/** VRoid 표준 성인 체형 근사값 — 측정 실패 시(또는 테스트) 폴백. */
export const FALLBACK_WARDROBE_METRICS: WardrobeMetrics = {
  source: "fallback",
  shoulderW: 0.32,
  hipW: 0.17,
  hipsToSpine: 0.09,
  spineToNeck: 0.32,
  ankleH: 0.08,
  up: [0, 1, 0],
  footForward: { left: [0, 0, 1], right: [0, 0, 1] },
  upperArm: { left: { len: 0.22, axis: [1, 0, 0] }, right: { len: 0.22, axis: [-1, 0, 0] } },
  lowerArm: { left: { len: 0.22, axis: [1, 0, 0] }, right: { len: 0.22, axis: [-1, 0, 0] } },
  upperLeg: { left: { len: 0.35, axis: [0, -1, 0] }, right: { len: 0.35, axis: [0, -1, 0] } },
  lowerLeg: { left: { len: 0.4, axis: [0, -1, 0] }, right: { len: 0.4, axis: [0, -1, 0] } },
  torso: null,
};

const LEN_MIN = 0.02;
const LEN_MAX = 2.5;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampLen(value: number, fallback: number): number {
  const v = finiteOr(value, fallback);
  return Math.min(LEN_MAX, Math.max(LEN_MIN, v));
}

function normalizeVec(v: Vec3, fallback: Vec3): Vec3 {
  const [x, y, z] = [finiteOr(v[0], 0), finiteOr(v[1], 0), finiteOr(v[2], 0)];
  const mag = Math.hypot(x, y, z);
  if (mag < 1e-6) return fallback;
  return [x / mag, y / mag, z / mag];
}

function sanitizeLimb(limb: LimbMetric | undefined, fallback: LimbMetric): LimbMetric {
  if (!limb) return fallback;
  return { len: clampLen(limb.len, fallback.len), axis: normalizeVec(limb.axis, fallback.axis) };
}

function sanitizeSide(side: SideMetric | undefined, fallback: SideMetric): SideMetric {
  return {
    left: sanitizeLimb(side?.left, fallback.left),
    right: sanitizeLimb(side?.right, fallback.right),
  };
}

/** 측정값을 안전 범위로 정규화한다(NaN/비정상 rig 방어). 부분 입력은 폴백으로 채운다. */
export function sanitizeWardrobeMetrics(raw: Partial<WardrobeMetrics> | null | undefined): WardrobeMetrics {
  const f = FALLBACK_WARDROBE_METRICS;
  if (!raw) return f;
  return {
    source: raw.source === "raw-rig" || raw.source === "partial-rig" ? raw.source : "fallback",
    shoulderW: clampLen(raw.shoulderW ?? f.shoulderW, f.shoulderW),
    hipW: clampLen(raw.hipW ?? f.hipW, f.hipW),
    hipsToSpine: clampLen(raw.hipsToSpine ?? f.hipsToSpine, f.hipsToSpine),
    spineToNeck: clampLen(raw.spineToNeck ?? f.spineToNeck, f.spineToNeck),
    ankleH: clampLen(raw.ankleH ?? f.ankleH, f.ankleH),
    up: normalizeVec(raw.up ?? f.up, f.up),
    footForward: {
      left: normalizeVec(raw.footForward?.left ?? f.footForward.left, f.footForward.left),
      right: normalizeVec(raw.footForward?.right ?? f.footForward.right, f.footForward.right),
    },
    upperArm: sanitizeSide(raw.upperArm, f.upperArm),
    lowerArm: sanitizeSide(raw.lowerArm, f.lowerArm),
    upperLeg: sanitizeSide(raw.upperLeg, f.upperLeg),
    lowerLeg: sanitizeSide(raw.lowerLeg, f.lowerLeg),
    torso: sanitizeBodySilhouette(raw.torso),
  };
}

/* ── 아이템 카탈로그 ─────────────────────────────────────────────────── */

export interface WardrobeItemDef {
  id: string;
  label: string;
  slot: WardrobeSlot;
  emoji: string;
  defaultColor: string;
  hint: string;
  /**
   * 절차형 메시의 감사 결과. 렌더·저장 호환성과 신규 카탈로그 노출 여부를
   * 분리하기 위해 이름이나 파츠 수를 추측하지 않고 명시적으로 기록한다.
   */
  quality: "standard-procedural" | "low-fidelity-procedural";
  catalogStatus: "selectable" | "legacy-only";
  /** 신규 선택 시 제안할 같은 슬롯의 대체 아이템. */
  replacementId: string | null;
  /** Runtime deformation authority selected before attachment; providers never replace each other. */
  geometrySource: "xpbd-skirt-v1" | "skinned-procedural-v1" | "rigid-procedural";
  defaultFabricId: WardrobeFabricId;
  fitProfile: WardrobeFitProfile;
}

type WardrobeItemBase = Omit<
  WardrobeItemDef,
  "quality" | "catalogStatus" | "replacementId" | "geometrySource" | "defaultFabricId" | "fitProfile"
>;

const WARDROBE_ITEM_BASES: readonly WardrobeItemBase[] = [
  // 겉옷
  { id: "blazer", label: "블레이저", slot: "outer", emoji: "🧥", defaultColor: "#2b3a5e", hint: "교복·오피스 컷. 색으로 학교/팀을 표현하세요." },
  { id: "hoodie", label: "후드집업", slot: "outer", emoji: "🧢", defaultColor: "#374151", hint: "캐주얼·스트릿 컷. 뒤에 후드가 달려요." },
  { id: "coat", label: "롱코트", slot: "outer", emoji: "🧥", defaultColor: "#8a6a3c", hint: "가을·탐정 컷. 기장이 무릎까지 내려와요." },
  { id: "cardigan", label: "가디건", slot: "outer", emoji: "🧶", defaultColor: "#d6b98c", hint: "포근한 일상 컷에." },
  { id: "armor", label: "플레이트 아머", slot: "outer", emoji: "🛡️", defaultColor: "#9aa3b2", hint: "기사·판타지 컷. 어깨 견갑이 포인트." },
  { id: "robe", label: "마법사 로브", slot: "outer", emoji: "🪄", defaultColor: "#3a2b55", hint: "마법사·사제 컷. 소매가 넓어요." },
  { id: "labcoat", label: "의료 가운", slot: "outer", emoji: "🥼", defaultColor: "#f8fafc", hint: "의사·연구원 컷. 긴 흰 가운과 포켓이 포함됩니다." },
  // 상의
  { id: "tshirt", label: "티셔츠", slot: "top", emoji: "👕", defaultColor: "#e5e7eb", hint: "만능 기본템. 반팔이에요." },
  { id: "shirt", label: "셔츠", slot: "top", emoji: "👔", defaultColor: "#f8fafc", hint: "긴팔+카라. 단추 라인이 살아있어요." },
  { id: "sweater", label: "터틀넥 스웨터", slot: "top", emoji: "🧣", defaultColor: "#7a3b3b", hint: "겨울·지적 캐릭터 컷." },
  { id: "sailor", label: "세일러 톱", slot: "top", emoji: "⚓", defaultColor: "#f8fafc", hint: "교복·마린 컷. 뒷카라와 리본 포함." },
  { id: "tank", label: "탱크톱", slot: "top", emoji: "🎽", defaultColor: "#94a3b8", hint: "여름·트레이닝 컷." },
  { id: "dress", label: "원피스", slot: "top", emoji: "👗", defaultColor: "#e8a6bd", hint: "상의+스커트 일체형. 하의 없이 단독 착용 추천." },
  { id: "scrubs", label: "의료 스크럽 상의", slot: "top", emoji: "🩺", defaultColor: "#0f766e", hint: "의사·간호사·응급구조사 컷. 반소매 V넥 작업복입니다." },
  // 하의
  { id: "pleated", label: "플리츠 스커트", slot: "bottom", emoji: "🩳", defaultColor: "#1e293b", hint: "신체 충돌을 계산하는 가벼운 천 물리 스커트예요. 천끼리의 자기 충돌은 아직 지원하지 않습니다." },
  { id: "longskirt", label: "롱스커트", slot: "bottom", emoji: "👗", defaultColor: "#6e2434", hint: "신체의 허벅지와 종아리를 따라 움직이는 천 물리 롱스커트예요. 천끼리의 자기 충돌은 아직 지원하지 않습니다." },
  { id: "shorts", label: "반바지", slot: "bottom", emoji: "🩳", defaultColor: "#334155", hint: "여름·활동 컷." },
  { id: "pants", label: "슬림 팬츠", slot: "bottom", emoji: "👖", defaultColor: "#1c1c22", hint: "정장·데일리 컷." },
  { id: "wide", label: "와이드 팬츠", slot: "bottom", emoji: "👖", defaultColor: "#4b5563", hint: "밑단이 넓게 퍼지는 실루엣." },
  { id: "jeans", label: "청바지", slot: "bottom", emoji: "👖", defaultColor: "#3b5b85", hint: "캐주얼 만능. 밑단 롤업 디테일." },
  { id: "scrubpants", label: "의료 스크럽 팬츠", slot: "bottom", emoji: "🩺", defaultColor: "#115e59", hint: "병원 근무복의 여유 있는 일자 팬츠입니다." },
  // 신발
  { id: "sneakers", label: "스니커즈", slot: "shoes", emoji: "👟", defaultColor: "#f1f5f9", hint: "캐주얼 기본. 색으로 포인트를." },
  { id: "boots", label: "앵클부츠", slot: "shoes", emoji: "🥾", defaultColor: "#5a4632", hint: "가을·여행 컷." },
  { id: "longboots", label: "롱부츠", slot: "shoes", emoji: "👢", defaultColor: "#1c1c22", hint: "무릎 아래까지 올라와요." },
  { id: "heels", label: "하이힐", slot: "shoes", emoji: "👠", defaultColor: "#991b1b", hint: "드레스·파티 컷." },
  { id: "loafers", label: "로퍼", slot: "shoes", emoji: "🥿", defaultColor: "#451a03", hint: "교복·오피스 컷." },
  { id: "sandals", label: "샌들", slot: "shoes", emoji: "🩴", defaultColor: "#d6b98c", hint: "여름·바캉스 컷." },
  { id: "clogs", label: "의료 클로그", slot: "shoes", emoji: "🩴", defaultColor: "#f1f5f9", hint: "병원·실험실 근무용으로 발등을 감싸는 가벼운 신발입니다." },
] as const;

/**
 * 품질 감사에서 실루엣·관통·재질 완성도가 신규 카탈로그 기준에 못 미친 항목.
 *
 * 키는 기존 저장 문서의 itemId와 동일하다. 항목 자체를 삭제하지 않으므로 과거
 * 문서는 계속 파싱·렌더링할 수 있지만, 신규 선택 화면에서는 replacementId로
 * 치환한다. 의상 이름을 통한 휴리스틱은 의도적으로 사용하지 않는다.
 */
/**
 * Wave 3에서 이전 저품질 10종을 본 추종형 다중 파츠로 다시 제작했다. 과거 문서의
 * ID를 바꾸지 않고 원본 아이템 자체를 승격했으므로 신규 선택 시 대체가 필요 없다.
 * 이후 품질 감사에서 격리가 필요한 항목이 생기면 이 명시적 맵에만 추가한다.
 */
export const LEGACY_WARDROBE_REPLACEMENTS: Readonly<Record<string, string>> = {};

export const WARDROBE_ITEMS: readonly WardrobeItemDef[] = WARDROBE_ITEM_BASES.map(
  (item) => {
    const replacementId = LEGACY_WARDROBE_REPLACEMENTS[item.id] ?? null;
    return {
      ...item,
      quality: replacementId
        ? "low-fidelity-procedural"
        : "standard-procedural",
      catalogStatus: replacementId ? "legacy-only" : "selectable",
      replacementId,
      geometrySource: item.id === "pleated" || item.id === "longskirt"
        ? "xpbd-skirt-v1"
        : item.slot === "shoes"
          ? "rigid-procedural"
          : "skinned-procedural-v1",
      defaultFabricId: defaultWardrobeFabric(item.id, item.slot),
      fitProfile: wardrobeFitProfile(item.id, item.slot),
    };
  },
);

export function wardrobeItemById(id: string): WardrobeItemDef | undefined {
  return WARDROBE_ITEMS.find((item) => item.id === id);
}

/** 저장·렌더 호환성을 위한 전체 카탈로그(legacy-only 포함). */
export function wardrobeItemsBySlot(slot: WardrobeSlot): WardrobeItemDef[] {
  return WARDROBE_ITEMS.filter((item) => item.slot === slot);
}

/** 신규 장착 화면에 노출해도 되는 감사 완료 항목만 반환한다. */
export function selectableWardrobeItemsBySlot(
  slot: WardrobeSlot,
): WardrobeItemDef[] {
  return WARDROBE_ITEMS.filter(
    (item) => item.slot === slot && item.catalogStatus === "selectable",
  );
}

/**
 * 신규 선택 경계에서 legacy-only ID를 같은 슬롯의 감사 완료 대체품으로 바꾼다.
 * 저장 문서 복원 경로(parseWardrobe)는 이 함수를 사용하지 않는다.
 */
export function resolveWardrobeItemForNewSelection(
  itemId: string,
): WardrobeItemDef | undefined {
  const item = wardrobeItemById(itemId);
  if (!item) return undefined;
  if (item.catalogStatus === "selectable") return item;
  if (!item.replacementId) return undefined;

  const replacement = wardrobeItemById(item.replacementId);
  if (
    !replacement
    || replacement.catalogStatus !== "selectable"
    || replacement.slot !== item.slot
  ) {
    return undefined;
  }
  return replacement;
}

/* ── 장착 상태 + 직렬화 ──────────────────────────────────────────────── */

export const WARDROBE_FIT_MIN = 0.8;
export const WARDROBE_FIT_MAX = 1.4;
export type WardrobeFitMode = "auto" | "manual";

export interface WardrobeOptions {
  /** Hide only the baked VRM materials covered by the currently equipped wardrobe. */
  autoHideOriginal: boolean;
}

export const DEFAULT_WARDROBE_OPTIONS: Readonly<WardrobeOptions> = Object.freeze({
  autoHideOriginal: true,
});

export interface WardrobeEquip {
  itemId: string;
  color: string;
  /** 품(반경) 배율 — 몸에 붙게/헐렁하게. */
  fit: number;
  /** Auto keeps the rendered shell outside the body and lower garment layers without mutating fit. */
  fitMode: WardrobeFitMode;
  fabricId: WardrobeFabricId;
}

export type WardrobeState = Partial<Record<WardrobeSlot, WardrobeEquip>>;

export interface SerializedWardrobe {
  version: typeof VRM_WARDROBE_VERSION;
  slots: WardrobeState;
  options: WardrobeOptions;
}

export interface ParsedWardrobeDocument {
  version: typeof VRM_WARDROBE_VERSION;
  slots: WardrobeState;
  options: WardrobeOptions;
  sourceVersion: 0 | typeof LEGACY_VRM_WARDROBE_VERSION | typeof VRM_WARDROBE_VERSION;
  supported: boolean;
}

function normalizeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function clampFit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(WARDROBE_FIT_MAX, Math.max(WARDROBE_FIT_MIN, n));
}

function normalizeWardrobeEquip(slot: WardrobeSlot, raw: unknown): WardrobeEquip | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<Record<keyof WardrobeEquip, unknown>>;
  const def = wardrobeItemById(String(entry.itemId ?? ""));
  if (!def || def.slot !== slot) return null;
  return {
    itemId: def.id,
    color: normalizeHex(entry.color, def.defaultColor),
    fit: clampFit(entry.fit),
    fitMode: entry.fitMode === "manual" ? "manual" : "auto",
    fabricId: typeof entry.fabricId === "string" && wardrobeFabricById(entry.fabricId)
      ? entry.fabricId as WardrobeFabricId
      : def.defaultFabricId,
  };
}

function normalizeWardrobeSlotOccupancy(slots: WardrobeState): void {
  // A dress occupies both upper- and lower-body space. Old/shared documents could contain a dress
  // and bottoms simultaneously; prefer the full-body garment deterministically so restoring the
  // document cannot recreate overlapping meshes.
  if (slots.top?.itemId === "dress") delete slots.bottom;
}

/**
 * Parses both the old v1 slot-only payload and the authored v2 document. Runtime diagnostics,
 * measured body data, and derived visibility never enter this document.
 */
export function parseWardrobeDocument(raw: unknown): ParsedWardrobeDocument {
  const empty = (sourceVersion: ParsedWardrobeDocument["sourceVersion"], supported = true): ParsedWardrobeDocument => ({
    version: VRM_WARDROBE_VERSION,
    slots: {},
    options: { ...DEFAULT_WARDROBE_OPTIONS },
    sourceVersion,
    supported,
  });
  if (!raw || typeof raw !== "object") return empty(0);

  const root = raw as { version?: unknown; slots?: unknown; options?: unknown };
  const explicitVersion = typeof root.version === "number" ? root.version : null;
  if (explicitVersion !== null && explicitVersion !== LEGACY_VRM_WARDROBE_VERSION && explicitVersion !== VRM_WARDROBE_VERSION) {
    return empty(0, false);
  }
  const sourceVersion = explicitVersion === VRM_WARDROBE_VERSION
    ? VRM_WARDROBE_VERSION
    : LEGACY_VRM_WARDROBE_VERSION;
  const slotsRaw = root.slots ?? raw;
  if (!slotsRaw || typeof slotsRaw !== "object") return empty(sourceVersion);

  const slots: WardrobeState = {};
  for (const slot of WARDROBE_SLOTS) {
    const equip = normalizeWardrobeEquip(slot, (slotsRaw as Record<string, unknown>)[slot]);
    if (equip) slots[slot] = equip;
  }
  normalizeWardrobeSlotOccupancy(slots);

  const optionsRaw = root.options && typeof root.options === "object"
    ? root.options as { autoHideOriginal?: unknown }
    : null;
  const options: WardrobeOptions = {
    autoHideOriginal: sourceVersion === VRM_WARDROBE_VERSION && typeof optionsRaw?.autoHideOriginal === "boolean"
      ? optionsRaw.autoHideOriginal
      : DEFAULT_WARDROBE_OPTIONS.autoHideOriginal,
  };
  return { version: VRM_WARDROBE_VERSION, slots, options, sourceVersion, supported: true };
}

/** 임의 입력(저장 문서)을 안전한 장착 상태로 정규화한다. 슬롯-아이템 불일치·미지의 아이템은 버린다. */
export function parseWardrobe(raw: unknown): WardrobeState {
  return parseWardrobeDocument(raw).slots;
}

export function serializeWardrobe(
  state: WardrobeState,
  options: WardrobeOptions = DEFAULT_WARDROBE_OPTIONS,
): SerializedWardrobe | undefined {
  const slots: WardrobeState = {};
  for (const slot of WARDROBE_SLOTS) {
    const equip = normalizeWardrobeEquip(slot, state[slot]);
    if (!equip) continue;
    slots[slot] = { ...equip };
  }
  normalizeWardrobeSlotOccupancy(slots);
  const count = WARDROBE_SLOTS.reduce((total, slot) => total + (slots[slot] ? 1 : 0), 0);
  const normalizedOptions: WardrobeOptions = {
    autoHideOriginal: options.autoHideOriginal !== false,
  };
  if (count === 0 && normalizedOptions.autoHideOriginal === DEFAULT_WARDROBE_OPTIONS.autoHideOriginal) {
    return undefined;
  }
  return { version: VRM_WARDROBE_VERSION, slots, options: normalizedOptions };
}

/** 카탈로그 기본값으로 슬롯 장착을 생성한다. */
export function createWardrobeEquip(itemId: string): WardrobeEquip | null {
  const def = wardrobeItemById(itemId);
  if (!def) return null;
  return {
    itemId: def.id,
    color: def.defaultColor,
    fit: 1,
    fitMode: "auto",
    fabricId: def.defaultFabricId,
  };
}

/**
 * 신규 선택 UI의 단일 슬롯 변경을 정규화한다. 원피스는 상·하의를 함께 차지하므로 원피스를
 * 고르면 하의를, 원피스 위에서 하의를 고르면 원피스를 해제해 겹친 메시를 만들지 않는다.
 * 저장·공유 문서 파서에도 같은 점유 규칙을 적용해 과거의 중첩 상태가 다시 나타나지 않게 한다.
 */
export function applyWardrobeItemSelection(
  current: WardrobeState,
  slot: WardrobeSlot,
  itemId: string | null,
): WardrobeState {
  const next: WardrobeState = { ...current };
  if (!itemId) {
    delete next[slot];
    return next;
  }
  const equip = createWardrobeEquip(itemId);
  if (!equip || wardrobeItemById(itemId)?.slot !== slot) return current;
  next[slot] = equip;
  if (itemId === "dress") delete next.bottom;
  else if (slot === "bottom" && next.top?.itemId === "dress") delete next.top;
  return next;
}

/* ── 테마 세트(원클릭 코디) ──────────────────────────────────────────── */

export interface WardrobeSet {
  id: string;
  label: string;
  emoji: string;
  equips: Partial<Record<WardrobeSlot, { itemId: string; color?: string }>>;
}

export const WARDROBE_SETS: readonly WardrobeSet[] = [
  { id: "school", label: "교복 세트", emoji: "🏫", equips: { outer: { itemId: "blazer", color: "#2b3a5e" }, top: { itemId: "shirt", color: "#f8fafc" }, bottom: { itemId: "pleated", color: "#1e293b" }, shoes: { itemId: "loafers", color: "#451a03" } } },
  { id: "knight", label: "성기사 세트", emoji: "🛡️", equips: { outer: { itemId: "armor", color: "#9aa3b2" }, bottom: { itemId: "pants", color: "#1e293b" }, shoes: { itemId: "longboots", color: "#3a2b1c" } } },
  { id: "royal", label: "황실 드레스 세트", emoji: "👑", equips: { top: { itemId: "dress", color: "#991b1b" }, shoes: { itemId: "heels", color: "#d97706" } } },
  { id: "cyber", label: "사이버펑크 세트", emoji: "⚡", equips: { outer: { itemId: "hoodie", color: "#0f172a" }, bottom: { itemId: "pants", color: "#1c1c22" }, shoes: { itemId: "sneakers", color: "#ec4899" } } },
  { id: "gothic", label: "고스 세트", emoji: "🖤", equips: { top: { itemId: "dress", color: "#111827" }, shoes: { itemId: "longboots", color: "#111827" } } },
  { id: "autumn", label: "클래식 코트 세트", emoji: "🍂", equips: { outer: { itemId: "coat", color: "#8a5a2b" }, bottom: { itemId: "pants", color: "#451a03" }, shoes: { itemId: "boots", color: "#5a4632" } } },
  { id: "marine", label: "마린 세일러 세트", emoji: "⚓", equips: { top: { itemId: "sailor", color: "#f8fafc" }, bottom: { itemId: "pleated", color: "#0f172a" }, shoes: { itemId: "loafers", color: "#1e293b" } } },
  { id: "druid", label: "숲의 로브 세트", emoji: "🍃", equips: { outer: { itemId: "robe", color: "#2f5141" }, bottom: { itemId: "pants", color: "#78350f" }, shoes: { itemId: "sandals", color: "#8a6a3c" } } },
  { id: "casual", label: "캐주얼 세트", emoji: "🛹", equips: { top: { itemId: "tshirt", color: "#e5e7eb" }, bottom: { itemId: "jeans", color: "#3b5b85" }, shoes: { itemId: "sneakers", color: "#f1f5f9" } } },
  { id: "winter", label: "겨울 니트 세트", emoji: "❄️", equips: { top: { itemId: "sweater", color: "#7a3b3b" }, bottom: { itemId: "longskirt", color: "#6e2434" }, shoes: { itemId: "boots", color: "#5a4632" } } },
  { id: "office", label: "오피스 정장 세트", emoji: "💼", equips: { outer: { itemId: "blazer", color: "#1f2937" }, top: { itemId: "shirt", color: "#f8fafc" }, bottom: { itemId: "pants", color: "#111827" }, shoes: { itemId: "loafers", color: "#3f2d20" } } },
  { id: "doctor", label: "의사 가운 세트", emoji: "🥼", equips: { outer: { itemId: "labcoat", color: "#f8fafc" }, top: { itemId: "scrubs", color: "#0e7490" }, bottom: { itemId: "scrubpants", color: "#155e75" }, shoes: { itemId: "clogs", color: "#f1f5f9" } } },
  { id: "surgeon", label: "외과 수술복 세트", emoji: "🩺", equips: { top: { itemId: "scrubs", color: "#0f766e" }, bottom: { itemId: "scrubpants", color: "#115e59" }, shoes: { itemId: "clogs", color: "#dbeafe" } } },
  { id: "nurse", label: "간호 스크럽 세트", emoji: "🏥", equips: { top: { itemId: "scrubs", color: "#60a5fa" }, bottom: { itemId: "scrubpants", color: "#2563eb" }, shoes: { itemId: "clogs", color: "#f8fafc" } } },
  { id: "paramedic", label: "응급구조사 세트", emoji: "🚑", equips: { outer: { itemId: "hoodie", color: "#f97316" }, top: { itemId: "tshirt", color: "#f8fafc" }, bottom: { itemId: "pants", color: "#1e293b" }, shoes: { itemId: "sneakers", color: "#111827" } } },
  { id: "idol", label: "아이돌 무대 세트", emoji: "🎤", equips: { top: { itemId: "dress", color: "#f9a8d4" }, shoes: { itemId: "heels", color: "#fde68a" } } },
  { id: "street", label: "스트릿 후디 세트", emoji: "🏙️", equips: { outer: { itemId: "hoodie", color: "#7c3aed" }, bottom: { itemId: "wide", color: "#1e293b" }, shoes: { itemId: "sneakers", color: "#22d3ee" } } },
  { id: "detective", label: "탐정 코트 세트", emoji: "🔎", equips: { outer: { itemId: "coat", color: "#3f2d20" }, top: { itemId: "shirt", color: "#f8fafc" }, bottom: { itemId: "pants", color: "#1c1917" }, shoes: { itemId: "loafers", color: "#292524" } } },
  { id: "athlete", label: "트레이닝 세트", emoji: "🏃", equips: { top: { itemId: "tank", color: "#0ea5e9" }, bottom: { itemId: "shorts", color: "#0f172a" }, shoes: { itemId: "sneakers", color: "#f8fafc" } } },
  { id: "mage", label: "마법사 세트", emoji: "🔮", equips: { outer: { itemId: "robe", color: "#4c1d95" }, bottom: { itemId: "pants", color: "#1e1b4b" }, shoes: { itemId: "longboots", color: "#312e81" } } },
  { id: "summer", label: "여름 원피스 세트", emoji: "☀️", equips: { top: { itemId: "dress", color: "#7dd3fc" }, shoes: { itemId: "sandals", color: "#fef3c7" } } },
  { id: "barista", label: "바리스타 세트", emoji: "☕", equips: { outer: { itemId: "cardigan", color: "#a16207" }, top: { itemId: "shirt", color: "#f8fafc" }, bottom: { itemId: "pants", color: "#292524" }, shoes: { itemId: "sneakers", color: "#e7e5e4" } } },
  { id: "formal_evening", label: "이브닝 드레스 세트", emoji: "🌙", equips: { top: { itemId: "dress", color: "#1e1b4b" }, shoes: { itemId: "heels", color: "#111827" } } },
  { id: "denim", label: "데님 캐주얼 세트", emoji: "👖", equips: { top: { itemId: "tshirt", color: "#fef2f2" }, bottom: { itemId: "jeans", color: "#1e3a5f" }, shoes: { itemId: "boots", color: "#451a03" } } },
  { id: "lab_researcher", label: "연구원 세트", emoji: "🔬", equips: { outer: { itemId: "labcoat", color: "#f8fafc" }, top: { itemId: "sweater", color: "#64748b" }, bottom: { itemId: "pants", color: "#334155" }, shoes: { itemId: "clogs", color: "#e2e8f0" } } },
] as const;

export function wardrobeSetById(id: string): WardrobeSet | undefined {
  return WARDROBE_SETS.find((set) => set.id === id);
}

function createSelectableWardrobeSet(set: WardrobeSet): WardrobeSet | null {
  const equips: WardrobeSet["equips"] = {};
  for (const slot of WARDROBE_SLOTS) {
    const pick = set.equips[slot];
    if (!pick) continue;
    const resolved = resolveWardrobeItemForNewSelection(pick.itemId);
    if (!resolved || resolved.slot !== slot) return null;
    equips[slot] = { ...pick, itemId: resolved.id };
  }
  return { ...set, equips };
}

/**
 * 기존 세트 ID·색상은 유지하되 legacy-only 파츠를 감사 완료 대체품으로 바꾼
 * 신규 선택 전용 카탈로그다. 원본 WARDROBE_SETS는 과거 문서/프리셋 호환을 위해
 * 수정하지 않는다.
 */
export const SELECTABLE_WARDROBE_SETS: readonly WardrobeSet[] =
  WARDROBE_SETS.flatMap((set) => {
    const selectable = createSelectableWardrobeSet(set);
    return selectable ? [selectable] : [];
  });

export function selectableWardrobeSetById(
  id: string,
): WardrobeSet | undefined {
  return SELECTABLE_WARDROBE_SETS.find((set) => set.id === id);
}

/** 세트를 장착 상태로 변환한다(세트에 없는 슬롯은 비움). */
export function applyWardrobeSet(set: WardrobeSet): WardrobeState {
  const state: WardrobeState = {};
  for (const slot of WARDROBE_SLOTS) {
    const pick = set.equips[slot];
    if (!pick) continue;
    const def = wardrobeItemById(pick.itemId);
    if (!def || def.slot !== slot) continue;
    const equip = createWardrobeEquip(def.id);
    if (!equip) continue;
    state[slot] = { ...equip, color: normalizeHex(pick.color, def.defaultColor) };
  }
  return state;
}

/* ── 파츠 스펙 빌더(순수) ────────────────────────────────────────────── */

/** 부착 가능한 본 — VRM 필수 humanoid 본만(옵셔널 본 미의존). */
export type WardrobeBone =
  | "hips"
  | "spine"
  | "leftUpperArm"
  | "leftLowerArm"
  | "rightUpperArm"
  | "rightLowerArm"
  | "leftUpperLeg"
  | "leftLowerLeg"
  | "rightUpperLeg"
  | "rightLowerLeg"
  | "leftFoot"
  | "rightFoot";

export const WARDROBE_BONES: readonly WardrobeBone[] = [
  "hips",
  "spine",
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperArm",
  "rightLowerArm",
  "leftUpperLeg",
  "leftLowerLeg",
  "rightUpperLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
] as const;

export type GarmentShape =
  | { kind: "cylinder"; rTop: number; rBottom: number; h: number; open?: boolean }
  | {
      kind: "lathe";
      /**
       * Bottom-to-top garment silhouette in the part's local +Y axis.
       * `depth` is the ring's Z radius as a ratio of `radius`; omitted rings stay circular and
       * fall back to the part-wide `squash`. Per-ring depth is what lets a chest read wide and
       * shallow while the waist stays narrow — a single squash cannot express both.
       */
      profile: readonly { radius: number; y: number; depth?: number }[];
      segments?: number;
    }
  | { kind: "box"; w: number; h: number; d: number }
  | { kind: "sphere"; r: number }
  | { kind: "torus"; r: number; tube: number; arc?: number };

export interface GarmentPart {
  bone: WardrobeBone;
  shape: GarmentShape;
  /**
   * 골반에 매단 원통형 치마는 이 모드에서 밑단으로 갈수록 좌우 허벅지 본을 함께 따른다.
   * 생략한 파츠는 기존 관절 체인 웨이트 규칙을 그대로 사용한다.
   */
  skinMode?: "lower-body-drape";
  /** 본 로컬 오프셋(미터). */
  offset: Vec3;
  /** 도형의 +Y축을 이 방향(본 로컬 단위 벡터)으로 정렬. 생략 시 그대로. */
  align?: Vec3;
  /** 비균등 스케일(타원 단면 등). 생략 시 [1,1,1]. */
  squash?: Vec3;
  /** 파츠 색 오버라이드(hex). 생략 시 아이템 색. */
  color?: string;
  roughness?: number;
  metalness?: number;
}

const scaleVec = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const negVec = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"] as const;

/* ── 실측 재단 기준 ──────────────────────────────────────────────────── */

/** 실측 프로파일의 링 수. 5점으로는 허리와 가슴이 한 링에 뭉쳐 결국 원통으로 되돌아간다. */
const MEASURED_TORSO_RINGS = 17;

/** 소매가 진동 안쪽으로 파고드는 깊이(윗팔 길이 비율). 팔을 올려도 요크와 겹친 채 남는다. */
const ARMHOLE_SEAT_RATIO = 0.12;

/** 어깨 요크가 앉는 높이(spineToNeck 비율) — 카라(0.9~0.92) 바로 아래, 어깨 관절 근처. */
const SHOULDER_YOKE_HEIGHT = 0.86;

/** 요크 반경 = 소매 반경 × 이 값. 소매 윗동이 요크 안으로 들어가 이음매에 단차가 보이지 않는다. */
const SHOULDER_YOKE_OVER_SLEEVE = 1.06;

/**
 * 아이템 한 벌을 재단할 때 쓰는 기준. clearanceM은 몸 표면과 옷 표면 사이 최소 거리이고,
 * fit(품 배율)과 아이템별 여유(rMul)는 이 값에만 곱해진다 — 몸 쪽에 곱하면 fit을 줄였을 때
 * 옷이 살을 파고든다. 여유분은 상수가 아니라 아이템의 fitProfile에서 온다.
 */
interface GarmentCut {
  m: WardrobeMetrics;
  clearanceM: number;
}

function garmentCut(m: WardrobeMetrics, profile: WardrobeFitProfile): GarmentCut {
  // 안쪽 레이어 위에 겹쳐 입는 건 겉옷뿐이라 layerClearance도 겉옷에만 더한다.
  const layer = profile.layer === "outer" ? profile.layerClearanceM : 0;
  return { m, clearanceM: profile.baseBodyClearanceM + profile.motionAllowanceM + layer };
}

/** spine 로컬 높이 → 실루엣 t(hips 0 → 목 1). 실측에서 쓴 정규화와 같은 식이다. */
function torsoT(m: WardrobeMetrics, spineLocalY: number): number {
  return (spineLocalY + m.hipsToSpine) / (m.hipsToSpine + m.spineToNeck);
}

/**
 * 실측 단면 하나 → 회전체 링 하나. 반경은 반폭 + 여유분이고 깊이비는 (반깊이+여유)/(반폭+여유)라
 * 가슴은 넓고 얕게, 허리는 좁게 남는다. 단면 중심이 부착 축에서 밀려 있으면 그만큼 더 벌려
 * 축 대칭 회전체가 실제 단면을 반드시 감싸도록 한다.
 */
function latheRing(ring: BodySilhouetteRing, clearanceM: number): { radius: number; depth: number } {
  const radius = Math.abs(ring.centerX) + ring.halfWidth + clearanceM;
  return { radius, depth: (Math.abs(ring.centerZ) + ring.halfDepth + clearanceM) / radius };
}

/** 허리선 t 이하에서 가장 넓은 골반 반폭. 골반은 허리보다 아래에서 넓어지므로 밴드는 그쪽을 따른다. */
function widestHipHalfWidth(silhouette: BodySilhouette, upToT: number): number {
  const band = sampleBodySilhouette(silhouette, upToT);
  let widest = Math.abs(band.centerX) + band.halfWidth;
  for (const ring of silhouette.rings) {
    if (ring.t > upToT) continue;
    widest = Math.max(widest, Math.abs(ring.centerX) + ring.halfWidth);
  }
  return widest;
}

/** 몸통 좌우 축(spine 로컬) = 위 × 앞. 실측 프레임이 쓴 "왼쪽" 규약과 같다. */
function lateralAxis(m: WardrobeMetrics): Vec3 {
  const fwd = m.footForward.left;
  const x = m.up[1] * fwd[2] - m.up[2] * fwd[1];
  const y = m.up[2] * fwd[0] - m.up[0] * fwd[2];
  const z = m.up[0] * fwd[1] - m.up[1] * fwd[0];
  const length = Math.hypot(x, y, z);
  // 위와 앞이 같은 축인 비정상 리그에서는 좌우를 만들 수 없다 — 표준 좌우 축으로 물러선다.
  return length < 1e-6 ? [1, 0, 0] : [x / length, y / length, z / length];
}

/** 팔/다리 세그먼트를 덮는 소매/바짓단 실린더 파츠. */
function limbSleeve(
  bone: WardrobeBone,
  limb: LimbMetric,
  opts: { start?: number; coverage: number; r: number; flare?: number; seat?: number; color?: string; roughness?: number; metalness?: number }
): GarmentPart {
  // seat은 관절보다 몸쪽에서 시작해 진동 안으로 파고드는 깊이다. 끝단은 그대로 두고 위로만
  // 늘려야(h에도 더한다) 소매 기장이 바뀌지 않는다.
  const seat = Math.max(0, opts.seat ?? 0);
  const start = (opts.start ?? 0) - seat;
  const h = limb.len * (opts.coverage + seat);
  const center = scaleVec(limb.axis, limb.len * start + h / 2);
  return {
    bone,
    shape: { kind: "cylinder", rTop: opts.r * (opts.flare ?? 1), rBottom: opts.r, h, open: true },
    offset: center,
    // +Y/rTop은 자식 관절(손목·발목), -Y/rBottom은 몸쪽이다. 플레어는 끝단에 적용한다.
    align: limb.axis,
    color: opts.color,
    roughness: opts.roughness,
    metalness: opts.metalness,
  };
}

/** 몸통(spine 부착) 실린더 파츠 — bottomExt/topExt 는 hips/목 기준 연장 배율.
 * 기본 bottomExt 2.4 = hips 관절보다 1.4×hipsToSpine 아래까지 내려와 스커트/바지 허리와 확실히 겹친다(맨살 갭 방지).
 * 실측 실루엣이 있으면 반경은 골격이 아니라 그 표면 + 여유분에서 나온다. rMul·flare는 실측이
 * 없을 때만 반경 배율로 쓰이고, 실측 재단에서 rMul은 여유분 배율(품)이 된다. */
function torsoShell(
  cut: GarmentCut,
  opts: { bottomExt?: number; topExt?: number; rMul?: number; flare?: number; color?: string; roughness?: number; metalness?: number }
): GarmentPart {
  const m = cut.m;
  const bottomY = -m.hipsToSpine * (opts.bottomExt ?? 2.4);
  const topY = m.spineToNeck * (opts.topExt ?? 0.92);
  const h = topY - bottomY;
  const centerY = (topY + bottomY) / 2;
  const base = {
    bone: "spine",
    offset: scaleVec(m.up, centerY),
    align: m.up,
    color: opts.color,
    roughness: opts.roughness,
    metalness: opts.metalness,
  } satisfies Omit<GarmentPart, "shape">;

  const silhouette = m.torso;
  if (silhouette) {
    const clearance = cut.clearanceM * (opts.rMul ?? 1);
    const profile = Array.from({ length: MEASURED_TORSO_RINGS }, (_, index) => {
      const y = bottomY + (h * index) / (MEASURED_TORSO_RINGS - 1);
      const ring = latheRing(sampleBodySilhouette(silhouette, torsoT(m, y)), clearance);
      return { radius: ring.radius, y: y - centerY, depth: ring.depth };
    });
    // 링마다 깊이를 따로 실었으므로 파츠 전체 squash는 걸지 않는다 — 두 번 눌리면 몸을 파고든다.
    return { ...base, shape: { kind: "lathe", profile, segments: 32 } };
  }

  const r = m.shoulderW * 0.56 * (opts.rMul ?? 1);
  const rBottom = r * (opts.flare ?? 0.94);
  const waist = Math.min(r, rBottom) * 0.86;
  return {
    ...base,
    // A straight cylinder makes every outfit look like a barrel.  The five-ring profile keeps
    // enough overlap at the hips and shoulders while introducing an anatomical waist/chest curve.
    shape: {
      kind: "lathe",
      profile: [
        { radius: rBottom * 0.98, y: -h * 0.5 },
        { radius: rBottom, y: -h * 0.38 },
        { radius: waist, y: -h * 0.06 },
        { radius: r * 0.94, y: h * 0.24 },
        { radius: r, y: h * 0.4 },
        { radius: r * 0.78, y: h * 0.5 },
      ],
      segments: 32,
    },
    // 몸통 단면은 폭 대비 깊이 ~0.85 타원 — 얕으면 가슴/배가 옷을 관통한다.
    squash: [1, 1, 0.85],
  };
}

/**
 * 어깨 요크(spine 부착) — 목에서 좌우 어깨 관절까지 건너가는 파츠. 실측 재단에서는 몸통 셸이
 * 목 쪽에서 몸을 따라 좁아지고 소매는 팔 본에 따로 붙으므로, 둘 사이 진동이 그대로 벌어진다.
 * 요크가 그 사이를 잇고 소매는 seat만큼 요크 안으로 들어가 팔을 올려도 틈이 생기지 않는다.
 * 골격 폴백에서는 예전처럼 셸이 어깨까지 덮으므로 만들지 않는다.
 */
function shoulderYokes(cut: GarmentCut, parts: readonly GarmentPart[]): GarmentPart[] {
  const m = cut.m;
  const silhouette = m.torso;
  if (!silhouette) return [];
  const shell = parts.find((part) => part.bone === "spine" && part.shape.kind === "lathe");
  if (!shell) return [];

  let sleeveR = 0;
  for (const part of parts) {
    if (part.bone !== "leftUpperArm" && part.bone !== "rightUpperArm") continue;
    if (part.shape.kind !== "cylinder") continue;
    sleeveR = Math.max(sleeveR, part.shape.rTop);
  }
  if (sleeveR <= 0) return [];

  const y = m.spineToNeck * SHOULDER_YOKE_HEIGHT;
  const ring = latheRing(sampleBodySilhouette(silhouette, torsoT(m, y)), cut.clearanceM);
  const halfSpan = Math.max(widestHalfWidth(silhouette) + cut.clearanceM, m.shoulderW * 0.5);
  const lateral = lateralAxis(m);
  // A single cylinder across both shoulders reads as a horizontal tube. Two short,
  // tapered bridges leave the neck/clavicle silhouette open and only connect the shell
  // edge to each sleeve seat.
  const inner = Math.min(halfSpan * 0.7, Math.max(ring.radius * 0.72, sleeveR * 0.95));
  const outer = halfSpan + sleeveR * 0.12;
  const span = Math.max(0.03, outer - inner);
  const innerRadius = sleeveR * SHOULDER_YOKE_OVER_SLEEVE * 1.08;
  const outerRadius = sleeveR * 1.01;

  return ([-1, 1] as const).map((side) => ({
    bone: "spine",
    shape: {
      kind: "lathe",
      profile: [
        { radius: innerRadius, y: -span * 0.5 },
        { radius: innerRadius * 0.96, y: -span * 0.16 },
        { radius: outerRadius * 1.03, y: span * 0.24 },
        { radius: outerRadius, y: span * 0.5 },
      ],
      segments: 24,
    },
    offset: addVec(scaleVec(m.up, y), scaleVec(lateral, side * (inner + outer) * 0.5)),
    align: scaleVec(lateral, side),
    squash: [1, 1, Math.min(0.9, Math.max(0.55, ring.depth))],
    color: shell.color,
    roughness: shell.roughness,
    metalness: shell.metalness,
  }));
}

/** 허리(hips 부착)에서 아래로 퍼지는 스커트 파츠. */
function skirtCone(
  cut: GarmentCut,
  opts: { len: number; rTopMul?: number; flare: number; color?: string }
): GarmentPart {
  const m = cut.m;
  const topY = m.hipsToSpine * 0.55;
  const ease = opts.rTopMul ?? 1;
  const rTop = m.torso
    // 허리선은 hips 본 로컬 높이라 실루엣 t로 옮겨서 잰다(hips 관절 = t 0).
    ? widestHipHalfWidth(m.torso, torsoT(m, topY - m.hipsToSpine)) + cut.clearanceM * ease
    : Math.max(m.hipW * 0.95, m.shoulderW * 0.42) * ease;
  const rBottom = rTop * opts.flare;
  // 허리 단면의 깊이비도 실측에서 온다. 폭만 재고 깊이는 0.88 상수를 남겨 두면 골반이 얕은 몸에서
  // 치마가 앞뒤로 부풀고, 깊은 몸에서는 파고든다 — 한 축만 재는 것은 재지 않은 것과 비슷하다.
  const waist = m.torso ? sampleBodySilhouette(m.torso, torsoT(m, topY - m.hipsToSpine)) : null;
  const depth = waist
    ? (Math.abs(waist.centerZ) + waist.halfDepth + cut.clearanceM * ease) / rTop
    : null;
  const profile = [
    { radius: rBottom, y: -opts.len * 0.5 },
    { radius: rBottom * 0.97, y: -opts.len * 0.42 },
    { radius: rTop + (rBottom - rTop) * 0.58, y: -opts.len * 0.08 },
    { radius: rTop * 1.02, y: opts.len * 0.4 },
    { radius: rTop, y: opts.len * 0.5 },
  ];
  return {
    bone: "hips",
    skinMode: "lower-body-drape",
    // A slightly eased hem reads as cloth instead of a rigid traffic cone while retaining a
    // deterministic, inexpensive surface that can follow the hips bone in every browser.
    shape: {
      kind: "lathe",
      // 밑단은 허리보다 퍼지며 원형에 가까워진다 — 깊이비를 1 쪽으로 풀어 준다.
      profile: depth === null
        ? profile
        : profile.map((ring, index) => ({ ...ring, depth: depth + (1 - depth) * (index <= 1 ? 0.6 : 0) })),
      segments: 32,
    },
    offset: scaleVec(m.up, topY - opts.len / 2),
    align: m.up,
    // 링마다 깊이를 실은 프로파일에는 파츠 전체 squash를 걸지 않는다 — 두 번 눌린다.
    squash: depth === null ? [1, 1, 0.88] : undefined,
    color: opts.color,
  };
}

/** 신발 파츠 묶음(한쪽 발). */
function shoeParts(
  m: WardrobeMetrics,
  side: Side,
  style: "sneakers" | "boots" | "longboots" | "heels" | "loafers" | "sandals",
  fit: number
): GarmentPart[] {
  const bone: WardrobeBone = side === "left" ? "leftFoot" : "rightFoot";
  const legBone: WardrobeBone = side === "left" ? "leftLowerLeg" : "rightLowerLeg";
  const fwd = m.footForward[side];
  const down = negVec(m.up);
  const lowerLeg = m.lowerLeg[side];
  // 신발은 발 메시를 "감싸야" 보인다 — 실측 발 치수보다 한 치수 크게 잡는다.
  const footLen = Math.max(m.ankleH * 2.3, lowerLeg.len * 0.52) * fit;
  const footW = footLen * 0.46;
  const soleDrop = m.ankleH * 0.92;
  const parts: GarmentPart[] = [];

  const soleH = style === "heels" ? 0.014 : 0.032;
  // 밑창 — 발끝 방향으로 치우친 박스.
  parts.push({
    bone,
    shape: { kind: "box", w: footW, h: soleH, d: footLen },
    offset: addVec(scaleVec(fwd, footLen * 0.32), scaleVec(down, soleDrop)),
    align: m.up,
    color: style === "sneakers" ? "#ffffff" : undefined,
    roughness: 0.85,
  });
  // 발등/토 — 앞쪽 반구.
  if (style !== "sandals") {
    parts.push({
      bone,
      shape: { kind: "sphere", r: footW * 0.66 },
      offset: addVec(scaleVec(fwd, footLen * 0.55), scaleVec(down, soleDrop - footW * 0.26)),
      squash: [1, 0.74, 1.4],
      roughness: 0.7,
    });
  }
  if (style === "sneakers" || style === "loafers" || style === "heels") {
    // 발목 아래 몸통 — 발등·뒤꿈치를 덮는다.
    parts.push({
      bone,
      shape: { kind: "cylinder", rTop: footW * 0.66, rBottom: footW * 0.74, h: Math.max(m.ankleH * 0.95, footW * 0.8), open: true },
      offset: addVec(scaleVec(fwd, footLen * 0.06), scaleVec(down, soleDrop * 0.42)),
      align: m.up,
      squash: [1, 1, 1.2],
      roughness: 0.7,
    });
  }
  if (style === "heels") {
    // 뒷굽.
    parts.push({
      bone,
      shape: { kind: "cylinder", rTop: footW * 0.18, rBottom: footW * 0.14, h: soleDrop * 0.95 },
      offset: addVec(scaleVec(fwd, -footLen * 0.16), scaleVec(down, soleDrop * 0.5)),
      align: m.up,
      roughness: 0.45,
    });
  }
  if (style === "boots" || style === "longboots") {
    // 부츠 샤프트 — 종아리 본을 따라 올라감.
    const coverage = style === "boots" ? 0.4 : 0.88;
    const r = Math.max(footW * 0.72, lowerLeg.len * 0.15 * fit);
    parts.push(
      limbSleeve(legBone, lowerLeg, {
        start: 1 - coverage,
        coverage,
        r,
        flare: 0.92,
        roughness: 0.62,
      })
    );
    // 발목 연결부(부츠 몸통과 샤프트 사이 빈틈 방지).
    parts.push({
      bone,
      shape: { kind: "cylinder", rTop: footW * 0.72, rBottom: footW * 0.78, h: Math.max(m.ankleH, footW), open: true },
      offset: addVec(scaleVec(fwd, footLen * 0.04), scaleVec(down, soleDrop * 0.35)),
      align: m.up,
      squash: [1, 1, 1.18],
      roughness: 0.62,
    });
  }
  if (style === "sandals") {
    // 스트랩.
    parts.push({
      bone,
      shape: { kind: "torus", r: footW * 0.6, tube: footW * 0.11, arc: Math.PI },
      offset: addVec(scaleVec(fwd, footLen * 0.36), scaleVec(down, soleDrop - footW * 0.18)),
      align: fwd,
      roughness: 0.7,
    });
  }
  return parts;
}

/**
 * 실측 재단에서 이 아이템의 몸통 셸이 실제로 남기는 몸 여유(미터). 못 재면 null.
 *
 * 공식을 다시 쓰지 않고 **파츠를 만들어 잰다**. 여유분 계산이 재단과 보고서 두 곳에 따로 있으면
 * 반드시 어긋나고, 실제로 어긋났다 — 골격 재단은 반경 전체에 fit을 곱했지만 실측 재단은 여유분
 * 에만 곱하므로, 반경 배율을 가정한 보고서는 fit 한 칸이 벌어 주는 폭을 몇 배로 과대평가했다.
 */
export function measuredTorsoClearanceM(
  itemId: string,
  metricsRaw: WardrobeMetrics,
  fit = 1,
): number | null {
  const m = sanitizeWardrobeMetrics(metricsRaw);
  const silhouette = m.torso;
  if (!silhouette) return null;
  const parts = buildGarmentParts(itemId, m, fit);
  let narrowest = Infinity;

  for (const part of parts) {
    if (part.shape.kind !== "lathe") continue;
    // 실측으로 재단된 파츠만 잰다: 몸통 셸(링마다 depth)과 골반 드레이프(치마). 나머지 파츠는
    // 여전히 골격 반경을 쓰므로 여기서 재면 실측이 아닌 값을 실측인 척하게 된다.
    const measuredShell = part.bone === "spine"
      && part.shape.profile.some((ring) => ring.depth !== undefined);
    const measuredDrape = part.bone === "hips" && part.skinMode === "lower-body-drape";
    if (!measuredShell && !measuredDrape) continue;

    // 파츠는 로컬 centerY를 중심으로 놓이므로, 링의 로컬 y를 그 오프셋만큼 되돌려야 실루엣과
    // 같은 높이를 가리킨다. 오프셋은 항상 up 축 위에 있다(torsoShell·skirtCone이 그렇게 만든다).
    const centerY = part.offset[0] * m.up[0] + part.offset[1] * m.up[1] + part.offset[2] * m.up[2];
    const hipsAnchored = part.bone === "hips";
    for (const ring of part.shape.profile) {
      // 골반 부착 파츠의 로컬 높이는 hips 관절 기준이라 t로 옮기기 전에 spine 기준으로 맞춘다.
      const spineLocalY = ring.y + centerY - (hipsAnchored ? m.hipsToSpine : 0);
      const body = sampleBodySilhouette(silhouette, torsoT(m, spineLocalY));
      narrowest = Math.min(narrowest, ring.radius - (Math.abs(body.centerX) + body.halfWidth));
    }
  }
  return Number.isFinite(narrowest) ? narrowest : null;
}

/**
 * 아이템 + 실측 치수 → 본 부착 파츠 스펙 목록.
 * fit은 반경(품)에만 적용되어 길이는 체형을 따른다.
 */
export function buildGarmentParts(itemId: string, metricsRaw: WardrobeMetrics, fit = 1): GarmentPart[] {
  const def = wardrobeItemById(itemId);
  if (!def) return [];
  const m = sanitizeWardrobeMetrics(metricsRaw);
  const f = clampFit(fit);
  const cut = garmentCut(m, def.fitProfile);
  // 실측이 없으면 진동을 덮을 요크도 없다 — 소매는 예전처럼 어깨 관절에서 시작한다.
  const armSeat = m.torso ? ARMHOLE_SEAT_RATIO : 0;
  // Keep motion clearance independent from the fit multiplier so a narrower fit cannot
  // collapse the gap between morphed skin and procedural sleeves/trousers.
  const limbClearance = m.torso ? cut.clearanceM * (def.fitProfile.layer === "outer" ? 0.58 : 0.46) : 0;
  const armR = (side: Side, mul = 1) => Math.max(0.03, m.upperArm[side].len * 0.19) * mul * f + limbClearance;
  const legR = (side: Side, mul = 1) => Math.max(0.045, m.upperLeg[side].len * 0.175) * mul * f + limbClearance;
  const parts: GarmentPart[] = [];

  switch (def.id) {
    case "blazer": {
      parts.push(torsoShell(cut, { rMul: 1.12 * f, roughness: 0.72 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.32), roughness: 0.72 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.94, r: armR(s, 1.2), roughness: 0.72 }));
      }
      // 카라.
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.3, tube: m.shoulderW * 0.055 }, offset: scaleVec(m.up, m.spineToNeck * 0.9), align: m.up, squash: [1, 1, 0.72], roughness: 0.72 });
      break;
    }
    case "hoodie": {
      parts.push(torsoShell(cut, { rMul: 1.2 * f, flare: 1, roughness: 0.85 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.42), roughness: 0.85 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.96, r: armR(s, 1.3), roughness: 0.85 }));
      }
      // 후드(등 뒤 반구) — 앞 방향의 반대로 배치.
      const back = negVec(m.footForward.left);
      parts.push({
        bone: "spine",
        shape: { kind: "sphere", r: m.shoulderW * 0.34 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.82), scaleVec(back, m.shoulderW * 0.3)),
        squash: [0.9, 0.82, 0.72],
        roughness: 0.85,
      });
      break;
    }
    case "coat": {
      const skirtLen = m.upperLeg.left.len * 0.85;
      parts.push(torsoShell(cut, { rMul: 1.14 * f, roughness: 0.78 }));
      parts.push(skirtCone(cut, { len: skirtLen, rTopMul: 1.16 * f, flare: 1.32 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.34), roughness: 0.78 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.96, r: armR(s, 1.22), roughness: 0.78 }));
      }
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.31, tube: m.shoulderW * 0.06 }, offset: scaleVec(m.up, m.spineToNeck * 0.9), align: m.up, squash: [1, 1, 0.74], roughness: 0.78 });
      break;
    }
    case "labcoat": {
      const skirtLen = m.upperLeg.left.len * 0.72;
      const fwd = m.footForward.left;
      parts.push(torsoShell(cut, { rMul: 1.13 * f, bottomExt: 3.2, roughness: 0.72 }));
      parts.push(skirtCone(cut, { len: skirtLen, rTopMul: 1.12 * f, flare: 1.2 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.3), roughness: 0.72 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.95, r: armR(s, 1.18), roughness: 0.72 }));
      }
      // V자 라펠과 양쪽 포켓 — 가운 실루엣을 일반 코트와 구분한다.
      for (const side of [-1, 1] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.17, h: m.spineToNeck * 0.34, d: 0.012 },
          offset: addVec(
            addVec(scaleVec(m.up, m.spineToNeck * 0.62), scaleVec(fwd, m.shoulderW * 0.52 * f)),
            [side * m.shoulderW * 0.12, 0, 0]
          ),
          color: "#e2e8f0",
          roughness: 0.72,
        });
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.22, h: m.hipsToSpine * 0.42, d: 0.016 },
          offset: addVec(
            addVec(scaleVec(m.up, -m.hipsToSpine * 0.72), scaleVec(fwd, m.shoulderW * 0.54 * f)),
            [side * m.shoulderW * 0.19, 0, 0]
          ),
          color: "#f1f5f9",
          roughness: 0.72,
        });
      }
      break;
    }
    case "cardigan": {
      const fwd = m.footForward.left;
      parts.push(torsoShell(cut, { rMul: 1.1 * f, bottomExt: 3.1, roughness: 0.92 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.0, r: armR(s, 1.3), roughness: 0.92 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.92, r: armR(s, 1.18), roughness: 0.92 }));
        parts.push({
          bone: s === "left" ? "leftLowerArm" : "rightLowerArm",
          shape: { kind: "torus", r: armR(s, 1.12), tube: 0.009 },
          offset: scaleVec(m.lowerArm[s].axis, m.lowerArm[s].len * 0.88),
          align: m.lowerArm[s].axis,
          roughness: 0.94,
        });
      }
      // 열린 앞섶, 골지 밑단, 포켓과 단추를 분리해 블레이저와 다른 니트 실루엣을 만든다.
      for (const side of [-1, 1] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.2, h: m.spineToNeck * 0.82, d: 0.018 },
          offset: addVec(
            addVec(scaleVec(m.up, m.spineToNeck * 0.18), scaleVec(fwd, m.shoulderW * 0.53 * f)),
            [side * m.shoulderW * 0.13, 0, 0],
          ),
          roughness: 0.94,
        });
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.18, h: m.hipsToSpine * 0.35, d: 0.022 },
          offset: addVec(
            addVec(scaleVec(m.up, -m.hipsToSpine * 0.76), scaleVec(fwd, m.shoulderW * 0.55 * f)),
            [side * m.shoulderW * 0.18, 0, 0],
          ),
          roughness: 0.94,
        });
      }
      for (const y of [0.38, 0.12, -0.14] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "sphere", r: 0.012 },
          offset: addVec(scaleVec(m.up, m.spineToNeck * y), scaleVec(fwd, m.shoulderW * 0.57 * f)),
          color: "#d6b98c",
          roughness: 0.72,
        });
      }
      parts.push({
        bone: "hips",
        shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.43) * f, tube: 0.014 },
        offset: scaleVec(m.up, m.hipsToSpine * 0.48),
        align: m.up,
        squash: [1, 1, 0.84],
        roughness: 0.94,
      });
      break;
    }
    case "armor": {
      parts.push(torsoShell(cut, { rMul: 1.16 * f, roughness: 0.32, metalness: 0.85 }));
      for (const s of SIDES) {
        // 견갑(퍼울드런).
        parts.push({
          bone: s === "left" ? "leftUpperArm" : "rightUpperArm",
          shape: { kind: "sphere", r: armR(s, 1.9) },
          offset: scaleVec(m.upperArm[s].axis, m.upperArm[s].len * 0.08),
          squash: [1, 0.78, 1],
          roughness: 0.32,
          metalness: 0.85,
        });
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.9, r: armR(s, 1.24), roughness: 0.35, metalness: 0.8 }));
      }
      // 벨트.
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW * 0.92, m.shoulderW * 0.4) * f, tube: 0.016 }, offset: scaleVec(m.up, m.hipsToSpine * 0.35), align: m.up, squash: [1, 1, 0.8], color: "#3a2b1c", roughness: 0.6, metalness: 0.2 });
      break;
    }
    case "robe": {
      const skirtLen = m.upperLeg.left.len + m.lowerLeg.left.len * 0.55;
      parts.push(torsoShell(cut, { rMul: 1.18 * f, roughness: 0.88 }));
      parts.push(skirtCone(cut, { len: skirtLen, rTopMul: 1.2 * f, flare: 1.6 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.5), roughness: 0.88 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 1.0, r: armR(s, 1.4), flare: 1.7, roughness: 0.88 }));
      }
      const back = negVec(m.footForward.left);
      parts.push({
        bone: "spine",
        shape: { kind: "sphere", r: m.shoulderW * 0.32 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.84), scaleVec(back, m.shoulderW * 0.28)),
        squash: [0.9, 0.8, 0.7],
        roughness: 0.88,
      });
      break;
    }
    case "tshirt": {
      const fwd = m.footForward.left;
      parts.push(torsoShell(cut, { rMul: 1.04 * f, roughness: 0.82 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 0.42, r: armR(s, 1.26), roughness: 0.82 }));
      }
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.23, tube: 0.012 }, offset: scaleVec(m.up, m.spineToNeck * 0.91), align: m.up, squash: [1, 1, 0.74], roughness: 0.86 });
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.42) * f, tube: 0.011 }, offset: scaleVec(m.up, m.hipsToSpine * 0.5), align: m.up, squash: [1, 1, 0.84], roughness: 0.86 });
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.16, h: m.spineToNeck * 0.16, d: 0.012 },
        offset: addVec(addVec(scaleVec(m.up, m.spineToNeck * 0.38), scaleVec(fwd, m.shoulderW * 0.54 * f)), [m.shoulderW * 0.15, 0, 0]),
        roughness: 0.86,
      });
      break;
    }
    case "scrubs": {
      const fwd = m.footForward.left;
      parts.push(torsoShell(cut, { rMul: 1.08 * f, topExt: 0.88, bottomExt: 2.75, roughness: 0.84 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 0.38, r: armR(s, 1.3), roughness: 0.84 }));
      }
      // 가슴 포켓과 V넥 중심선.
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.18, h: m.spineToNeck * 0.18, d: 0.012 },
        offset: addVec(
          addVec(scaleVec(m.up, m.spineToNeck * 0.38), scaleVec(fwd, m.shoulderW * 0.54 * f)),
          [m.shoulderW * 0.15, 0, 0]
        ),
        roughness: 0.84,
      });
      for (const side of [-1, 1] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.2, h: m.hipsToSpine * 0.36, d: 0.015 },
          offset: addVec(
            addVec(scaleVec(m.up, -m.hipsToSpine * 0.72), scaleVec(fwd, m.shoulderW * 0.55 * f)),
            [side * m.shoulderW * 0.18, 0, 0],
          ),
          roughness: 0.86,
        });
      }
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.045, h: m.spineToNeck * 0.28, d: 0.014 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.68), scaleVec(fwd, m.shoulderW * 0.57 * f)),
        color: "#d1fae5",
        roughness: 0.8,
      });
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.43) * f, tube: 0.011 }, offset: scaleVec(m.up, m.hipsToSpine * 0.46), align: m.up, squash: [1, 1, 0.84], roughness: 0.86 });
      break;
    }
    case "shirt": {
      parts.push(torsoShell(cut, { rMul: 1.05 * f, roughness: 0.68 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.0, r: armR(s, 1.22), roughness: 0.68 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.92, r: armR(s, 1.12), roughness: 0.68 }));
      }
      // 카라 + 단추 라인.
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.27, tube: m.shoulderW * 0.045 }, offset: scaleVec(m.up, m.spineToNeck * 0.92), align: m.up, squash: [1, 1, 0.72], roughness: 0.68 });
      const fwd = m.footForward.left;
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.05, h: m.spineToNeck * 0.66 + m.hipsToSpine, d: 0.008 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.28 - m.hipsToSpine * 0.45), scaleVec(fwd, m.shoulderW * 0.56 * 1.05 * f * 0.85 + 0.004)),
        align: m.up,
        color: "#d8dce4",
        roughness: 0.68,
      });
      break;
    }
    case "sweater": {
      parts.push(torsoShell(cut, { rMul: 1.12 * f, roughness: 0.95 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.36), roughness: 0.95 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.94, r: armR(s, 1.24), roughness: 0.95 }));
      }
      // 터틀넥.
      parts.push({ bone: "spine", shape: { kind: "cylinder", rTop: m.shoulderW * 0.21, rBottom: m.shoulderW * 0.24, h: m.spineToNeck * 0.22, open: true }, offset: scaleVec(m.up, m.spineToNeck * 1.0), align: m.up, roughness: 0.95 });
      break;
    }
    case "sailor": {
      parts.push(torsoShell(cut, { rMul: 1.05 * f, roughness: 0.8 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 0.46, r: armR(s, 1.28), roughness: 0.8 }));
      }
      // 뒷카라(사각 플랩) + 앞 리본.
      const back = negVec(m.footForward.left);
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.62, h: m.spineToNeck * 0.34, d: 0.01 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.72), scaleVec(back, m.shoulderW * 0.56 * 0.6 * f)),
        align: m.up,
        color: "#2b3a5e",
        roughness: 0.8,
      });
      const fwd = m.footForward.left;
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.2, h: m.shoulderW * 0.12, d: 0.012 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.68), scaleVec(fwd, m.shoulderW * 0.56 * 0.62 * f)),
        align: m.up,
        color: "#d8475e",
        roughness: 0.8,
      });
      parts.push({
        bone: "spine",
        shape: { kind: "box", w: m.shoulderW * 0.48, h: m.spineToNeck * 0.2, d: 0.014 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.72), scaleVec(fwd, m.shoulderW * 0.57 * f)),
        color: "#2b3a5e",
        roughness: 0.82,
      });
      parts.push({
        bone: "spine",
        shape: { kind: "sphere", r: m.shoulderW * 0.075 },
        offset: addVec(scaleVec(m.up, m.spineToNeck * 0.59), scaleVec(fwd, m.shoulderW * 0.62 * f)),
        squash: [1.35, 0.65, 0.42],
        color: "#d8475e",
        roughness: 0.82,
      });
      for (const s of SIDES) {
        parts.push({
          bone: s === "left" ? "leftUpperArm" : "rightUpperArm",
          shape: { kind: "torus", r: armR(s, 1.22), tube: 0.009 },
          offset: scaleVec(m.upperArm[s].axis, m.upperArm[s].len * 0.43),
          align: m.upperArm[s].axis,
          color: "#2b3a5e",
          roughness: 0.82,
        });
      }
      break;
    }
    case "tank": {
      const fwd = m.footForward.left;
      parts.push(torsoShell(cut, { rMul: 1.06 * f, topExt: 0.82, roughness: 0.82 }));
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.24, tube: 0.014 }, offset: scaleVec(m.up, m.spineToNeck * 0.81), align: m.up, squash: [1, 1, 0.74], roughness: 0.86 });
      for (const side of [-1, 1] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "torus", r: m.shoulderW * 0.17, tube: 0.012, arc: Math.PI },
          offset: addVec(addVec(scaleVec(m.up, m.spineToNeck * 0.69), scaleVec(fwd, m.shoulderW * 0.42)), [side * m.shoulderW * 0.35, 0, 0]),
          align: m.up,
          roughness: 0.86,
        });
      }
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.43) * f, tube: 0.011 }, offset: scaleVec(m.up, m.hipsToSpine * 0.48), align: m.up, squash: [1, 1, 0.84], roughness: 0.86 });
      break;
    }
    case "dress": {
      const skirtLen = m.upperLeg.left.len * 1.05;
      parts.push(torsoShell(cut, { rMul: 1.04 * f, roughness: 0.8 }));
      parts.push(skirtCone(cut, { len: skirtLen, rTopMul: 1.05 * f, flare: 1.85 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 0.3, r: armR(s, 1.3), roughness: 0.8 }));
      }
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.25, tube: 0.012 }, offset: scaleVec(m.up, m.spineToNeck * 0.91), align: m.up, squash: [1, 1, 0.76], roughness: 0.74 });
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.43) * f, tube: 0.018 }, offset: scaleVec(m.up, m.hipsToSpine * 0.52), align: m.up, squash: [1, 1, 0.86], color: "#d4af37", roughness: 0.42, metalness: 0.25 });
      parts.push({
        bone: "hips",
        skinMode: "lower-body-drape",
        shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.43) * 1.85 * f, tube: 0.016 },
        offset: scaleVec(m.up, m.hipsToSpine * 0.55 - skirtLen * 0.96),
        align: m.up,
        squash: [1, 1, 0.88],
        roughness: 0.72,
      });
      break;
    }
    case "pleated": {
      parts.push(skirtCone(cut, { len: m.upperLeg.left.len * 0.58, rTopMul: f, flare: 1.7 }));
      // 허리 밴드.
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW * 0.95, m.shoulderW * 0.42) * f, tube: 0.012 }, offset: scaleVec(m.up, m.hipsToSpine * 0.55), align: m.up, squash: [1, 1, 0.78], roughness: 0.7 });
      break;
    }
    case "longskirt": {
      parts.push(skirtCone(cut, { len: m.upperLeg.left.len + m.lowerLeg.left.len * 0.72, rTopMul: f, flare: 1.55 }));
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW * 0.95, m.shoulderW * 0.42) * f, tube: 0.012 }, offset: scaleVec(m.up, m.hipsToSpine * 0.55), align: m.up, squash: [1, 1, 0.78], roughness: 0.7 });
      break;
    }
    case "shorts": {
      const fwd = m.footForward.left;
      parts.push(skirtCone(cut, { len: m.hipsToSpine * 1.15, rTopMul: f, flare: 1.05 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperLeg" : "rightUpperLeg", m.upperLeg[s], { coverage: 0.42, r: legR(s, 1.26), roughness: 0.75 }));
        parts.push({
          bone: s === "left" ? "leftUpperLeg" : "rightUpperLeg",
          shape: { kind: "torus", r: legR(s, 1.22), tube: 0.01 },
          offset: scaleVec(m.upperLeg[s].axis, m.upperLeg[s].len * 0.41),
          align: m.upperLeg[s].axis,
          roughness: 0.78,
        });
        parts.push({
          bone: "hips",
          shape: { kind: "box", w: m.hipW * 0.28, h: m.hipsToSpine * 0.3, d: 0.014 },
          offset: addVec(addVec(scaleVec(m.up, m.hipsToSpine * 0.06), scaleVec(fwd, m.hipW * 1.02 * f)), [s === "left" ? m.hipW * 0.48 : -m.hipW * 0.48, 0, 0]),
          roughness: 0.78,
        });
      }
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.42) * f, tube: 0.015 }, offset: scaleVec(m.up, m.hipsToSpine * 0.53), align: m.up, squash: [1, 1, 0.84], roughness: 0.78 });
      break;
    }
    case "pants":
    case "scrubpants":
    case "jeans":
    case "wide": {
      const fwd = m.footForward.left;
      const flare = def.id === "wide" ? 1.55 : 1.02;
      const rMul = def.id === "wide" ? 1.3 : 1.16;
      const rough = def.id === "jeans" ? 0.9 : 0.72;
      parts.push(skirtCone(cut, { len: m.hipsToSpine * 0.82, rTopMul: f, flare: 1.02 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperLeg" : "rightUpperLeg", m.upperLeg[s], { start: 0.04, seat: 0.06, coverage: 0.96, r: legR(s, rMul), roughness: rough }));
        parts.push(
          limbSleeve(s === "left" ? "leftLowerLeg" : "rightLowerLeg", m.lowerLeg[s], {
            coverage: def.id === "jeans" ? 0.84 : 0.92,
            r: legR(s, rMul * 0.88),
            flare,
            roughness: rough,
          })
        );
        if (def.id === "jeans") {
          // 롤업 커프.
          const lower = m.lowerLeg[s];
          parts.push({
            bone: s === "left" ? "leftLowerLeg" : "rightLowerLeg",
            shape: { kind: "torus", r: legR(s, rMul * 0.82), tube: 0.011 },
            offset: scaleVec(lower.axis, lower.len * 0.84),
            align: lower.axis,
            color: "#2d4666",
            roughness: 0.9,
          });
        }
        if (def.id === "wide" || def.id === "scrubpants") {
          parts.push({
            bone: s === "left" ? "leftLowerLeg" : "rightLowerLeg",
            shape: { kind: "torus", r: legR(s, rMul * flare * 0.86), tube: 0.011 },
            offset: scaleVec(m.lowerLeg[s].axis, m.lowerLeg[s].len * 0.9),
            align: m.lowerLeg[s].axis,
            roughness: rough,
          });
        }
        parts.push({
          bone: "hips",
          shape: { kind: "box", w: m.hipW * 0.24, h: m.hipsToSpine * 0.28, d: 0.014 },
          offset: addVec(addVec(scaleVec(m.up, m.hipsToSpine * 0.08), scaleVec(fwd, m.hipW * 1.04 * f)), [s === "left" ? m.hipW * 0.5 : -m.hipW * 0.5, 0, 0]),
          roughness: rough,
        });
      }
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW, m.shoulderW * 0.42) * f, tube: 0.015 }, offset: scaleVec(m.up, m.hipsToSpine * 0.53), align: m.up, squash: [1, 1, 0.84], roughness: rough });
      parts.push({
        bone: "hips",
        shape: { kind: "box", w: 0.018, h: m.hipsToSpine * 0.46, d: 0.016 },
        offset: addVec(scaleVec(m.up, -m.hipsToSpine * 0.03), scaleVec(fwd, m.hipW * 1.07 * f)),
        roughness: rough,
      });
      break;
    }
    case "sneakers":
    case "boots":
    case "longboots":
    case "heels":
    case "loafers":
    case "sandals": {
      for (const s of SIDES) parts.push(...shoeParts(m, s, def.id, f));
      break;
    }
    case "clogs": {
      for (const s of SIDES) parts.push(...shoeParts(m, s, "loafers", f));
      break;
    }
    case "cyberpunk_suit": {
      parts.push(torsoShell(cut, { rMul: 1.15 * f, roughness: 0.3, metalness: 0.6 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.0, r: armR(s, 1.3), roughness: 0.3, metalness: 0.6 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.94, r: armR(s, 1.2), roughness: 0.3, metalness: 0.6 }));
      }
      parts.push({ bone: "spine", shape: { kind: "box", w: m.shoulderW * 0.15, h: m.spineToNeck * 0.2, d: 0.02 }, offset: scaleVec(m.up, m.spineToNeck * 0.5), color: "#06b6d4", roughness: 0.1, metalness: 0.9 });
      break;
    }
    case "hanbok_modern": {
      parts.push(torsoShell(cut, { rMul: 1.12 * f, roughness: 0.35 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.4), roughness: 0.35 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.96, r: armR(s, 1.35), flare: 1.3, roughness: 0.35 }));
      }
      parts.push({ bone: "spine", shape: { kind: "torus", r: m.shoulderW * 0.28, tube: m.shoulderW * 0.05 }, offset: scaleVec(m.up, m.spineToNeck * 0.94), align: m.up, color: "#f8fafc", roughness: 0.35 });
      break;
    }
    case "trenchcoat": {
      const skirtLen = m.upperLeg.left.len * 1.1;
      parts.push(torsoShell(cut, { rMul: 1.16 * f, roughness: 0.85 }));
      parts.push(skirtCone(cut, { len: skirtLen, rTopMul: 1.18 * f, flare: 1.35 }));
      for (const s of SIDES) {
        parts.push(limbSleeve(s === "left" ? "leftUpperArm" : "rightUpperArm", m.upperArm[s], { seat: armSeat, coverage: 1.02, r: armR(s, 1.35), roughness: 0.85 }));
        parts.push(limbSleeve(s === "left" ? "leftLowerArm" : "rightLowerArm", m.lowerArm[s], { coverage: 0.96, r: armR(s, 1.25), roughness: 0.85 }));
      }
      parts.push({ bone: "hips", shape: { kind: "torus", r: Math.max(m.hipW * 0.98, m.shoulderW * 0.44) * f, tube: 0.018 }, offset: scaleVec(m.up, m.hipsToSpine * 0.4), align: m.up, color: "#451a03", roughness: 0.6 });
      break;
    }
    case "tactical_vest": {
      parts.push(torsoShell(cut, { rMul: 1.18 * f, topExt: 0.85, bottomExt: 2.3, roughness: 0.88 }));
      const fwd = m.footForward.left;
      for (const side of [-1, 1] as const) {
        parts.push({
          bone: "spine",
          shape: { kind: "box", w: m.shoulderW * 0.16, h: m.hipsToSpine * 0.35, d: 0.022 },
          offset: addVec(addVec(scaleVec(m.up, m.spineToNeck * 0.2), scaleVec(fwd, m.shoulderW * 0.54 * f)), [side * m.shoulderW * 0.16, 0, 0]),
          color: "#374151",
          roughness: 0.9,
        });
      }
      break;
    }
    default:
      break;
  }

  parts.push(...shoulderYokes(cut, parts));
  return parts;
}
