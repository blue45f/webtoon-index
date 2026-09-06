// VRM 의상 변경 시스템 — 베이크드 VRM에서 가능한 "현실적 최고치".
//  1) 의상성 메시 자동 탐지(노드/머티리얼 이름 휴리스틱) → 파츠별 표시/숨김 토글
//  2) 파츠별 리컬러(MToon/Standard 공통: HSL 색조 시프트로 텍스처 보존 틴트)
//  3) 피부·얼굴·눈·머리카락 보호 휴리스틱(실수로 살색을 바꾸지 않게)
//
// 설계 원칙: three/VRM 의존 없이 "이름 → 분류" 순수 함수로 분리해 단위 테스트가 가능하다.
// 실제 씬그래프 순회·머티리얼 변경은 StudioVrmPoser가 이 분류 결과를 받아 수행한다.

export const VRM_COSTUME_VERSION = 1 as const;

export type CostumeSlot =
  | "outer" // 겉옷/자켓/코트
  | "tops" // 상의
  | "bottoms" // 하의/바지/치마
  | "onepiece" // 원피스/드레스
  | "shoes" // 신발
  | "accessory" // 장신구/리본/모자류(의상 부속)
  | "innerwear"; // 속옷/이너

export const COSTUME_SLOT_LABELS: Record<CostumeSlot, string> = {
  outer: "겉옷",
  tops: "상의",
  bottoms: "하의",
  onepiece: "원피스",
  shoes: "신발",
  accessory: "장신구",
  innerwear: "이너",
};

/** 의상 토글·리컬러에서 절대 건드리면 안 되는 보호 카테고리(피부·얼굴·눈·머리). */
export type ProtectedCategory = "skin" | "face" | "eye" | "hair" | "body";

export interface MeshClassification {
  /** 의상 슬롯(의상이면) — 토글·리컬러 대상. */
  slot: CostumeSlot | null;
  /** 보호 카테고리(있으면 의상 아님 → 토글·리컬러 제외). */
  protected: ProtectedCategory | null;
}

/* ── 이름 휴리스틱 ──────────────────────────────────────────────────────
 * VRoid/일반 VRM의 노드·머티리얼 네이밍을 소문자로 보고 매칭한다.
 * 보호 패턴을 의상 패턴보다 먼저 평가한다(살색 오변경 방지).
 */

const PROTECT_PATTERNS: { re: RegExp; cat: ProtectedCategory }[] = [
  { re: /\b(face|head)\b|_face|face_|_head|head_|facemouth|faceeyeline|facebrow|faceeyelash/i, cat: "face" },
  { re: /eye(ball|iris|white|line|lash|highlight|extra)?|_eye|iris|cornea|sclera|hitomi/i, cat: "eye" },
  { re: /\bskin\b|_skin|skin_|body_?skin|onskin|bodyskin/i, cat: "skin" },
  { re: /\bhair\b|_hair|hair_|hairback|hairfront|hairside|backhair|banghair/i, cat: "hair" },
  { re: /\bbody\b(?!.*wear)|_body(?!wear)|naked|nude/i, cat: "body" },
];

const COSTUME_PATTERNS: { re: RegExp; slot: CostumeSlot }[] = [
  { re: /onepiece|one_piece|dress|gown|robe|kimono|uniform_?dress/i, slot: "onepiece" },
  { re: /outer|jacket|coat|cardigan|blazer|hoodie|parka|cloak|mantle|jumper|outerwear/i, slot: "outer" },
  { re: /skirt|pants|trouser|shorts|jeans|slacks|bottom|bottoms|hakama|leg_?wear|legwear|stocking|tights|sock/i, slot: "bottoms" },
  { re: /tops?|shirt|blouse|tee|sweater|knit|tank|camisole|vest|upper|top_?wear|topwear/i, slot: "tops" },
  { re: /shoe|boot|sneaker|sandal|footwear|loafer|heel/i, slot: "shoes" },
  { re: /inner|underwear|bra|panty|pants_?inner|innerwear|swimsuit|bikini/i, slot: "innerwear" },
  { re: /ribbon|tie|necktie|scarf|muffler|hat|cap|beret|accessory|accessory_?wear|belt|glove|wristband|hairaccessory|cloth(?!es?$)/i, slot: "accessory" },
  { re: /cloth|clothes|costume|wear|outfit|attire/i, slot: "tops" }, // 포괄 폴백
];

/**
 * 노드/머티리얼 이름(들)을 의상 슬롯 또는 보호 카테고리로 분류한다.
 * 보호 패턴이 우선 — 살색/눈/얼굴/머리는 의상으로 잡지 않는다.
 */
export function classifyMeshName(...names: (string | null | undefined)[]): MeshClassification {
  const joined = names.filter(Boolean).join(" ").toLowerCase();
  if (!joined.trim()) return { slot: null, protected: null };

  for (const { re, cat } of PROTECT_PATTERNS) {
    if (re.test(joined)) return { slot: null, protected: cat };
  }
  for (const { re, slot } of COSTUME_PATTERNS) {
    if (re.test(joined)) return { slot, protected: null };
  }
  return { slot: null, protected: null };
}

/** 의상 토글/리컬러 대상 여부(의상 슬롯이 있고 보호 대상이 아님). */
export function isCostumeMesh(names: (string | null | undefined)[]): boolean {
  const c = classifyMeshName(...names);
  return c.slot !== null && c.protected === null;
}

/* ── 리컬러(HSL 색조 시프트) — 텍스처 보존 틴트 ───────────────────────── */

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface HSL {
  h: number; // 0~360
  s: number; // 0~1
  l: number; // 0~1
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 };
  const int = parseInt(m[1], 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, hh + 1 / 3), g: hue2rgb(p, q, hh), b: hue2rgb(p, q, hh - 1 / 3) };
}

/**
 * 원본 색에 목표 색조를 입히는 틴트 — 색조(H)·채도(S)는 목표를 따르고,
 * 명도(L)는 원본 음영을 strength만큼만 끌어와 텍스처의 주름/그림자를 보존한다.
 * @param strength 0=원본 유지, 1=목표 색 완전 적용(명도는 원본 음영 일부 보존)
 */
export function tintColor(baseHex: string, targetHex: string, strength = 0.85): string {
  const baseHsl = rgbToHsl(hexToRgb(baseHex));
  const targetHsl = rgbToHsl(hexToRgb(targetHex));
  const s = Math.min(1, Math.max(0, strength));
  // 명도: 원본 음영을 유지하되 목표 명도 쪽으로 약간 당김(원본 70% + 목표 30% × strength)
  const l = baseHsl.l * (1 - 0.3 * s) + targetHsl.l * 0.3 * s;
  const mixedHue = targetHsl.h;
  const mixedSat = baseHsl.s * (1 - s) + targetHsl.s * s;
  return rgbToHex(hslToRgb({ h: mixedHue, s: mixedSat, l }));
}

/**
 * Mannequin clay gray (StudioVrmMannequinMaterial). Ephemeral paint — never lock as
 * a costume "native" base, or recolor restores collapse garments to clay/black.
 */
export const COSTUME_MANNEQUIN_CLAY_HEX = "#b7b2a8" as const;

/** Safe white lit factor when texture holds albedo (MToon color × map). */
export const COSTUME_SAFE_LIT_BASE_HEX = "#ffffff" as const;

export function normalizeCostumeHex(hex: string): string {
  const trimmed = hex.trim().toLowerCase();
  if (!trimmed) return COSTUME_SAFE_LIT_BASE_HEX;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/** Near-black lit factors multiply texture albedo to pure black garments. */
export function isNearBlackCostumeHex(hex: string): boolean {
  const { r, g, b } = hexToRgb(normalizeCostumeHex(hex));
  return r <= 0.02 && g <= 0.02 && b <= 0.02;
}

export function isMannequinClayCostumeHex(hex: string): boolean {
  return normalizeCostumeHex(hex) === COSTUME_MANNEQUIN_CLAY_HEX;
}

/**
 * Resolve the lit-factor base used for costume recolor / restore.
 * - Mannequin clay is never cacheable (ephemeral pose paint).
 * - Near-black × map is never cacheable as native (would bake pure black clothes).
 * - Otherwise the current hex is a stable native base and may be cached once.
 */
export function resolveCostumeMaterialBaseHex(
  currentHex: string,
  options?: { hasMap?: boolean; cached?: string | null },
): { hex: string; cacheable: boolean } {
  if (options?.cached) {
    return { hex: normalizeCostumeHex(options.cached), cacheable: true };
  }
  const normalized = normalizeCostumeHex(currentHex);
  if (isMannequinClayCostumeHex(normalized)) {
    return { hex: COSTUME_SAFE_LIT_BASE_HEX, cacheable: false };
  }
  if (isNearBlackCostumeHex(normalized) && options?.hasMap) {
    return { hex: COSTUME_SAFE_LIT_BASE_HEX, cacheable: false };
  }
  return { hex: normalized, cacheable: true };
}

/* ── 의상 프리셋 팔레트 ────────────────────────────────────────────── */

export interface CostumePalette {
  id: string;
  label: string;
  color: string;
}

export const COSTUME_PALETTES: readonly CostumePalette[] = [
  { id: "navy", label: "교복 네이비", color: "#2b3a5e" },
  { id: "black", label: "블랙", color: "#1c1c22" },
  { id: "white", label: "화이트", color: "#eef0f4" },
  { id: "burgundy", label: "버건디", color: "#6e2434" },
  { id: "forest", label: "포레스트", color: "#2f5141" },
  { id: "pastelpink", label: "파스텔 핑크", color: "#e8a6bd" },
  { id: "skyblue", label: "스카이 블루", color: "#6fa8d6" },
  { id: "cream", label: "크림", color: "#e6dcc2" },
] as const;

/* ── 직렬화(슬롯별 표시/색상 오버라이드) ──────────────────────────────── */

export interface CostumeState {
  /** 숨긴 메시 노드 이름 목록(슬롯 토글). */
  hidden: string[];
  /** 메시 노드 이름 → 적용 색(hex). */
  recolor: Record<string, string>;
}

export interface SerializedCostume {
  version: typeof VRM_COSTUME_VERSION;
  hidden: string[];
  recolor: Record<string, string>;
}

export function parseCostumeState(raw: unknown): CostumeState {
  const empty: CostumeState = { hidden: [], recolor: {} };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as { hidden?: unknown; recolor?: unknown };
  const hidden = Array.isArray(r.hidden) ? r.hidden.filter((x): x is string => typeof x === "string") : [];
  const recolor: Record<string, string> = {};
  if (r.recolor && typeof r.recolor === "object") {
    for (const [k, v] of Object.entries(r.recolor as Record<string, unknown>)) {
      if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) recolor[k] = v.toLowerCase();
    }
  }
  return { hidden, recolor };
}

export function serializeCostume(state: CostumeState): SerializedCostume | undefined {
  if (state.hidden.length === 0 && Object.keys(state.recolor).length === 0) return undefined;
  return { version: VRM_COSTUME_VERSION, hidden: [...state.hidden], recolor: { ...state.recolor } };
}
