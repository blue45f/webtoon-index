// VRM 워드로브 카탈로그 — "이미 구워진(baked) 의상 메시"를 슬롯 단위로 다루는 순수 코어.
//
// 이 파일이 담당하는 것
//  1) 슬롯 카탈로그: 코디 세트(WardrobeOutfit)를 타입으로 선언하고, 슬롯별 표시/숨김 +
//     색·머티리얼 오버라이드를 하나의 상태로 묶는다.
//  2) 메시 바인딩: studio-vrm-costume의 classifyMeshName 휴리스틱으로 씬의 메시를
//     슬롯에 배정하고, 보호 카테고리(피부·얼굴·눈·머리)는 **구조적으로 제외**한다.
//  3) 계획 산출: 상태 + 바인딩 → CostumeState 호환 평면 계획(hidden/recolor) + 머티리얼 훅.
//  4) 직렬화: 버전·손상 입력·미지 필드 방어.
//
// 이 파일이 담당하지 않는 것 (의도적 분리)
//  - three.js 객체 생성/순회. 여기엔 three import가 0이며 전부 평범한 숫자·문자열·배열이다.
//    실제 mesh.visible / material 변경은 .tsx 레이어가 이 계획을 받아 수행한다.
//  - 절차형 의상 지오메트리 생성. 그건 studio-vrm-wardrobe.ts(본에 부착하는 3D 의상)의 몫이고,
//    이 파일은 "원본 VRM에 원래 들어 있던 의상"을 다룬다. 두 시스템은 대상이 다르므로 공존한다.
//
// ── HAIR_VISIBILITY_LEASES와의 관계 (중요) ───────────────────────────────
// StudioVrmAvatarForge.tsx는 절차형 헤어를 씌울 때 원본 헤어 메시를 숨기는데, 그냥
// `mesh.visible = false`를 쓰지 않고 **참조 카운팅 리스**(HAIR_VISIBILITY_LEASES)를 쓴다:
// 첫 획득에서만 원래 visible을 기억하고, 중첩 획득은 카운트만 올리고, 마지막 반납에서만
// 원복한다. 워드로브가 같은 메시를 `visible = true`로 되돌려 버리면 그 계약이 깨진다.
//
// 그래서 이 모듈은 "싸우지 않게" 두 층으로 설계했다.
//  (a) 대상 분리 — resolveWardrobeBindings는 `classifyMeshName().protected !== null`인 메시를
//      전부 버린다. 헤어 리스가 잡는 집합(protected === "hair")과 워드로브가 잡는 집합
//      (slot !== null && protected === null)은 **정의상 서로소**다. 겹칠 수 없으니 다툴 일도 없다.
//  (b) 동일 규약 — 그럼에도 워드로브 자신도 여러 출처(코디 세트 / 사용자 수동 토글 /
//      절차형 의상 자동 숨김)에서 같은 메시를 숨길 수 있으므로, createWardrobeVisibilityLedger가
//      HAIR_VISIBILITY_LEASES와 똑같은 획득/반납 시맨틱을 순수 함수로 제공한다. .tsx 레이어는
//      이 장부가 내주는 최종 visible 값만 적용하면 되고, 원복 책임을 잃지 않는다.
//
// 설계 원칙: 전 함수 순수(난수·시간·전역 상태 없음) → 헤드리스 단위 테스트 가능.

import {
  COSTUME_SLOT_LABELS,
  classifyMeshName,
  tintColor,
  type CostumeSlot,
  type CostumeState,
} from "./studio-vrm-costume";

export const WARDROBE_CATALOGUE_VERSION = 1 as const;

/* ── 슬롯 ────────────────────────────────────────────────────────────── */

/**
 * 워드로브가 제어하는 슬롯. studio-vrm-costume의 CostumeSlot을 그대로 쓴다
 * (분류 휴리스틱과 슬롯 어휘를 한 곳에서만 정의하기 위해).
 */
export type WardrobeCatalogueSlot = CostumeSlot;

export const WARDROBE_CATALOGUE_SLOTS: readonly WardrobeCatalogueSlot[] = [
  "outer",
  "tops",
  "bottoms",
  "onepiece",
  "shoes",
  "accessory",
  "innerwear",
] as const;

export const WARDROBE_CATALOGUE_SLOT_LABELS = COSTUME_SLOT_LABELS;

const SLOT_IDS = new Set<WardrobeCatalogueSlot>(WARDROBE_CATALOGUE_SLOTS);

/* ── 슬롯 오버라이드 ─────────────────────────────────────────────────── */

/** 머티리얼 오버라이드 훅. null = 원본 유지(렌더러가 아무것도 건드리지 않음). */
export interface WardrobeSlotOverride {
  /** 이 슬롯의 메시를 보일지. */
  visible: boolean;
  /** 틴트 목표색(hex) 또는 null(원본 색 유지). */
  color: string | null;
  /** 틴트 강도 0~1. color가 null이면 무시된다. */
  tintStrength: number;
  /** MToon/Standard 공통 거칠기 오버라이드 또는 null. */
  roughness: number | null;
  /** 금속감 오버라이드 또는 null. */
  metalness: number | null;
}

export const DEFAULT_WARDROBE_SLOT_OVERRIDE: WardrobeSlotOverride = {
  visible: true,
  color: null,
  tintStrength: 0.85,
  roughness: null,
  metalness: null,
};

export type WardrobeSlotOverridePatch = Partial<WardrobeSlotOverride>;

/* ── 코디 세트 카탈로그 ──────────────────────────────────────────────── */

export interface WardrobeOutfit {
  id: string;
  label: string;
  emoji: string;
  hint: string;
  slots: Partial<Record<WardrobeCatalogueSlot, WardrobeSlotOverridePatch>>;
}

/**
 * 원클릭 코디 세트. 모델마다 어떤 메시가 있는지는 알 수 없으므로, 세트는 "슬롯에 대한 의도"만
 * 기술한다 — 해당 슬롯 메시가 없는 모델에서는 그 항목이 조용히 무시된다.
 */
export const WARDROBE_OUTFITS: readonly WardrobeOutfit[] = [
  {
    id: "as-authored",
    label: "원본 그대로",
    emoji: "🫧",
    hint: "모델에 구워진 의상을 손대지 않습니다.",
    slots: {},
  },
  {
    id: "school-navy",
    label: "교복 네이비",
    emoji: "🏫",
    hint: "학원물 기본. 겉옷·하의를 네이비로 통일합니다.",
    slots: {
      outer: { visible: true, color: "#2b3a5e" },
      tops: { visible: true, color: "#eef0f4" },
      bottoms: { visible: true, color: "#1e293b" },
      shoes: { visible: true, color: "#451a03" },
    },
  },
  {
    id: "office-mono",
    label: "오피스 모노",
    emoji: "🏢",
    hint: "무채색 정장 톤. 장신구는 숨겨 깔끔하게.",
    slots: {
      outer: { visible: true, color: "#1c1c22" },
      tops: { visible: true, color: "#eef0f4" },
      bottoms: { visible: true, color: "#1c1c22" },
      shoes: { visible: true, color: "#1c1c22", roughness: 0.28 },
      accessory: { visible: false },
    },
  },
  {
    id: "casual-warm",
    label: "캐주얼 웜",
    emoji: "🍂",
    hint: "따뜻한 톤 일상 컷. 겉옷을 벗은 실내 상태.",
    slots: {
      outer: { visible: false },
      tops: { visible: true, color: "#d6b98c" },
      bottoms: { visible: true, color: "#3b5b85" },
      shoes: { visible: true, color: "#5a4632" },
    },
  },
  {
    id: "fantasy-noble",
    label: "판타지 노블",
    emoji: "👑",
    hint: "귀족·왕궁 컷. 광택을 올려 비단 느낌을 냅니다.",
    slots: {
      outer: { visible: true, color: "#3a2b55", roughness: 0.32 },
      onepiece: { visible: true, color: "#6e2434", roughness: 0.3 },
      shoes: { visible: true, color: "#a16207", metalness: 0.35 },
      accessory: { visible: true, color: "#d4af37", metalness: 0.6, roughness: 0.25 },
    },
  },
  {
    id: "knight-steel",
    label: "나이트 스틸",
    emoji: "🛡️",
    hint: "금속 질감 강조. 갑옷·장신구를 강철 톤으로.",
    slots: {
      outer: { visible: true, color: "#9aa3b2", metalness: 0.75, roughness: 0.3 },
      bottoms: { visible: true, color: "#3f4652" },
      shoes: { visible: true, color: "#4b5563", metalness: 0.5 },
      accessory: { visible: true, color: "#9aa3b2", metalness: 0.7 },
    },
  },
  {
    id: "summer-light",
    label: "서머 라이트",
    emoji: "🌊",
    hint: "여름 컷. 겉옷을 숨기고 밝은 톤으로 맞춥니다.",
    slots: {
      outer: { visible: false },
      tops: { visible: true, color: "#eef0f4" },
      bottoms: { visible: true, color: "#6fa8d6" },
      shoes: { visible: true, color: "#e6dcc2" },
    },
  },
  {
    id: "mourning-black",
    label: "모노 블랙",
    emoji: "🖤",
    hint: "장례·느와르 컷. 전 슬롯을 무광 블랙으로.",
    slots: {
      outer: { visible: true, color: "#111318", tintStrength: 0.95, roughness: 0.85 },
      tops: { visible: true, color: "#111318", tintStrength: 0.95 },
      bottoms: { visible: true, color: "#111318", tintStrength: 0.95 },
      onepiece: { visible: true, color: "#111318", tintStrength: 0.95 },
      shoes: { visible: true, color: "#0b0d11", tintStrength: 0.95 },
      accessory: { visible: false },
    },
  },
] as const;

export function wardrobeOutfitById(id: string): WardrobeOutfit | undefined {
  return WARDROBE_OUTFITS.find((outfit) => outfit.id === id);
}

/* ── 상태 ────────────────────────────────────────────────────────────── */

export interface WardrobeCatalogueState {
  version: typeof WARDROBE_CATALOGUE_VERSION;
  /** 마지막으로 적용한 코디 세트 id(직접 편집하면 null). */
  outfitId: string | null;
  slots: Record<WardrobeCatalogueSlot, WardrobeSlotOverride>;
}

function defaultSlots(): Record<WardrobeCatalogueSlot, WardrobeSlotOverride> {
  return WARDROBE_CATALOGUE_SLOTS.reduce(
    (accumulator, slot) => {
      accumulator[slot] = { ...DEFAULT_WARDROBE_SLOT_OVERRIDE };
      return accumulator;
    },
    {} as Record<WardrobeCatalogueSlot, WardrobeSlotOverride>
  );
}

/** 코디 세트(또는 기본값)로 새 상태를 만든다. 반환 객체는 항상 새로 할당된다(공유 변이 방지). */
export function createWardrobeCatalogueState(outfitId?: string): WardrobeCatalogueState {
  const slots = defaultSlots();
  const outfit = outfitId ? wardrobeOutfitById(outfitId) : undefined;
  if (!outfit) {
    return { version: WARDROBE_CATALOGUE_VERSION, outfitId: null, slots };
  }
  for (const slot of WARDROBE_CATALOGUE_SLOTS) {
    const patch = outfit.slots[slot];
    if (patch) slots[slot] = normalizeOverride({ ...slots[slot], ...patch });
  }
  return { version: WARDROBE_CATALOGUE_VERSION, outfitId: outfit.id, slots };
}

/** 슬롯 하나만 갱신한 새 상태를 만든다(불변 갱신). 직접 편집이므로 outfitId는 해제된다. */
export function applyWardrobeSlotPatch(
  state: WardrobeCatalogueState,
  slot: WardrobeCatalogueSlot,
  patch: WardrobeSlotOverridePatch
): WardrobeCatalogueState {
  const safe = sanitizeWardrobeCatalogueState(state);
  if (!SLOT_IDS.has(slot)) return safe;
  return {
    ...safe,
    outfitId: null,
    slots: { ...safe.slots, [slot]: normalizeOverride({ ...safe.slots[slot], ...patch }) },
  };
}

/** 슬롯 표시/숨김 토글. */
export function toggleWardrobeSlot(
  state: WardrobeCatalogueState,
  slot: WardrobeCatalogueSlot
): WardrobeCatalogueState {
  const safe = sanitizeWardrobeCatalogueState(state);
  return applyWardrobeSlotPatch(safe, slot, { visible: !safe.slots[slot].visible });
}

/* ── 정규화 · 직렬화 ─────────────────────────────────────────────────── */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clamp01(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function optionalUnit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(1, Math.max(0, numeric));
}

function optionalColor(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

function normalizeOverride(raw: unknown): WardrobeSlotOverride {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    // 명시적으로 false일 때만 숨긴다(누락·쓰레기 값은 "보임"이 안전한 기본).
    visible: source.visible !== false,
    color: optionalColor(source.color),
    tintStrength: clamp01(source.tintStrength, DEFAULT_WARDROBE_SLOT_OVERRIDE.tintStrength),
    roughness: optionalUnit(source.roughness),
    metalness: optionalUnit(source.metalness),
  };
}

/** 임의 입력(저장 문서·URL·손상된 localStorage)을 안전한 상태로 정규화한다. */
export function sanitizeWardrobeCatalogueState(raw: unknown): WardrobeCatalogueState {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const slotsRaw =
    source.slots && typeof source.slots === "object" && !Array.isArray(source.slots)
      ? (source.slots as Record<string, unknown>)
      : {};

  const slots = defaultSlots();
  for (const slot of WARDROBE_CATALOGUE_SLOTS) {
    if (slot in slotsRaw) slots[slot] = normalizeOverride(slotsRaw[slot]);
  }

  const outfitId =
    typeof source.outfitId === "string" && wardrobeOutfitById(source.outfitId)
      ? source.outfitId
      : null;

  return { version: WARDROBE_CATALOGUE_VERSION, outfitId, slots };
}

export function parseWardrobeCatalogueState(raw: unknown): WardrobeCatalogueState {
  if (typeof raw === "string") {
    try {
      return sanitizeWardrobeCatalogueState(JSON.parse(raw));
    } catch {
      return sanitizeWardrobeCatalogueState(undefined);
    }
  }
  return sanitizeWardrobeCatalogueState(raw);
}

/**
 * 문서에 실을 최소 표현. 기본값과 완전히 같으면 undefined를 반환해 문서에 키를 남기지 않는다
 * (studio-vrm-costume의 serializeCostume과 동일한 하위호환 전략).
 */
export function serializeWardrobeCatalogueState(
  state: WardrobeCatalogueState
): WardrobeCatalogueState | undefined {
  const safe = sanitizeWardrobeCatalogueState(state);
  const touched = WARDROBE_CATALOGUE_SLOTS.some((slot) => !isDefaultOverride(safe.slots[slot]));
  if (!touched && safe.outfitId === null) return undefined;
  return safe;
}

export function isDefaultOverride(override: WardrobeSlotOverride): boolean {
  return (
    override.visible === DEFAULT_WARDROBE_SLOT_OVERRIDE.visible &&
    override.color === null &&
    override.tintStrength === DEFAULT_WARDROBE_SLOT_OVERRIDE.tintStrength &&
    override.roughness === null &&
    override.metalness === null
  );
}

/* ── 메시 바인딩 ─────────────────────────────────────────────────────── */

/** 씬에서 뽑아온 메시 1개의 이름 정보(three 타입 대신 평범한 문자열만 받는다). */
export interface WardrobeMeshInput {
  /** 상태에서 이 메시를 가리키는 안정 키(보통 노드 이름). */
  key: string;
  /** 노드 이름. 생략하면 key를 쓴다. */
  nodeName?: string;
  /** 머티리얼 이름들(분류 정확도를 높인다). */
  materialNames?: readonly string[];
  /** 현재 베이스 색(hex). 틴트 계산에 쓰이며 없으면 중간 회색으로 본다. */
  baseColor?: string;
}

export interface WardrobeMeshBinding {
  key: string;
  slot: WardrobeCatalogueSlot;
  baseColor: string;
}

const NEUTRAL_BASE = "#808080";

/**
 * 메시 목록을 슬롯에 바인딩한다.
 * 보호 카테고리(피부·얼굴·눈·머리·몸통)와 미분류 메시는 **여기서 전부 탈락**한다 —
 * 워드로브가 헤어 리스 대상이나 살색 메시를 절대 건드릴 수 없게 만드는 구조적 방어선이다.
 */
export function resolveWardrobeBindings(
  meshes: readonly WardrobeMeshInput[]
): WardrobeMeshBinding[] {
  const bindings: WardrobeMeshBinding[] = [];
  const seen = new Set<string>();

  for (const mesh of meshes) {
    if (typeof mesh?.key !== "string" || !mesh.key) continue;
    if (seen.has(mesh.key)) continue;

    const classification = classifyMeshName(mesh.nodeName ?? mesh.key, ...(mesh.materialNames ?? []));
    if (classification.protected !== null) continue;
    if (classification.slot === null) continue;

    seen.add(mesh.key);
    bindings.push({
      key: mesh.key,
      slot: classification.slot,
      baseColor: optionalColor(mesh.baseColor) ?? NEUTRAL_BASE,
    });
  }

  return bindings;
}

/* ── 계획 산출 ───────────────────────────────────────────────────────── */

export interface WardrobeMaterialPlan {
  roughness: number | null;
  metalness: number | null;
}

export interface WardrobeCataloguePlan {
  /** 숨길 메시 키(정렬됨 — 계획이 결정론적이어야 diff/undo가 안정적이다). */
  hidden: string[];
  /** 메시 키 → 최종 색(hex). 틴트는 원본 음영을 보존한다. */
  recolor: Record<string, string>;
  /** 메시 키 → 머티리얼 훅. 두 값이 모두 null인 항목은 담지 않는다. */
  material: Record<string, WardrobeMaterialPlan>;
  /** 슬롯별로 바인딩된 메시 키(패널에서 "이 슬롯에 N개" 안내용). */
  bySlot: Record<WardrobeCatalogueSlot, string[]>;
}

/**
 * 상태 + 바인딩 → 평면 계획. three를 전혀 모르며, 출력은 전부 정렬된 결정론적 값이다.
 */
export function resolveWardrobeCataloguePlan(
  bindings: readonly WardrobeMeshBinding[],
  state: WardrobeCatalogueState
): WardrobeCataloguePlan {
  const safe = sanitizeWardrobeCatalogueState(state);
  const hidden: string[] = [];
  const recolor: Record<string, string> = {};
  const material: Record<string, WardrobeMaterialPlan> = {};
  const bySlot = WARDROBE_CATALOGUE_SLOTS.reduce(
    (accumulator, slot) => {
      accumulator[slot] = [];
      return accumulator;
    },
    {} as Record<WardrobeCatalogueSlot, string[]>
  );

  for (const binding of bindings) {
    if (!SLOT_IDS.has(binding.slot)) continue;
    const override = safe.slots[binding.slot];
    bySlot[binding.slot].push(binding.key);

    if (!override.visible) {
      hidden.push(binding.key);
      // 숨긴 메시에는 색·머티리얼을 계산하지 않는다(보이지 않는 것에 대한 낭비 + 원복 단순화).
      continue;
    }
    if (override.color) {
      recolor[binding.key] = tintColor(binding.baseColor, override.color, override.tintStrength);
    }
    if (override.roughness !== null || override.metalness !== null) {
      material[binding.key] = { roughness: override.roughness, metalness: override.metalness };
    }
  }

  hidden.sort();
  for (const slot of WARDROBE_CATALOGUE_SLOTS) bySlot[slot].sort();
  return { hidden, recolor, material, bySlot };
}

/**
 * 워드로브 계획을 기존 CostumeState에 합성한다.
 * 사용자가 수동으로 숨기거나 리컬러한 항목은 **보존**하고, 워드로브 결과를 덧씌운다.
 * (겹치는 키는 워드로브가 우선 — 사용자가 방금 고른 코디가 마지막 의도이기 때문.)
 */
export function mergeWardrobeCataloguePlan(
  costume: CostumeState,
  plan: WardrobeCataloguePlan
): CostumeState {
  return {
    hidden: [...new Set([...costume.hidden, ...plan.hidden])].sort(),
    recolor: { ...costume.recolor, ...plan.recolor },
  };
}

/* ── 가시성 리스 장부 (HAIR_VISIBILITY_LEASES 미러) ───────────────────── */

export interface WardrobeVisibilityLedger {
  /** 키를 숨기는 리스를 획득한다. 반환값 = 이 획득 후 최종 visible. */
  acquire(key: string, originalVisible: boolean): boolean;
  /** 리스를 반납한다. 반환값 = 반납 후 최종 visible(마지막 반납이면 원래 값). */
  release(key: string): boolean;
  /** 현재 이 키에 걸린 리스 수(테스트·디버그용). */
  count(key: string): number;
  /** 현재 리스가 걸린 키 목록(정렬됨). */
  keys(): string[];
}

/**
 * StudioVrmAvatarForge.tsx의 HAIR_VISIBILITY_LEASES와 **동일한 시맨틱**을 문자열 키 위에서
 * 재현한 순수 장부. WeakMap<Object3D> 대신 Map<string>을 쓰므로 three 없이 테스트된다.
 *
 * 계약:
 *  - 첫 acquire에서만 originalVisible을 기억한다(그 뒤 acquire의 인자는 무시).
 *  - 중첩 acquire는 카운트만 올린다 → 코디 세트와 절차형 의상이 같은 메시를 숨겨도 안전.
 *  - 마지막 release에서만 원래 값으로 복구하고 항목을 지운다.
 *  - 리스가 없는 키의 release는 무시(원래 값을 모르므로 "보임"으로 답한다).
 */
export function createWardrobeVisibilityLedger(): WardrobeVisibilityLedger {
  const leases = new Map<string, { count: number; visible: boolean }>();

  return {
    acquire(key, originalVisible) {
      const lease = leases.get(key);
      if (lease) {
        lease.count += 1;
      } else {
        leases.set(key, { count: 1, visible: originalVisible });
      }
      return false;
    },
    release(key) {
      const lease = leases.get(key);
      if (!lease) return true;
      lease.count -= 1;
      if (lease.count > 0) return false;
      leases.delete(key);
      return lease.visible;
    },
    count(key) {
      return leases.get(key)?.count ?? 0;
    },
    keys() {
      return [...leases.keys()].sort();
    },
  };
}
