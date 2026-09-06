/**
 * Creative UX helpers — competitor-inspired IA (names not cloned).
 *
 * - AutoDraw: doodle → clean shape (QuickShape promotion)
 * - Canva Draw: beginner-first short brush set + size chips + large starter cards
 * - Picsart Draw: visual brush tray with categories + stroke previews
 * - Adobe Express: digital pencil/marker/brush named for easy pick
 * - Piskel/Lospec: pixel art + restricted palettes
 * - Miro/tldraw: sticky notes + ephemeral whiteboard
 * - Silk: generative multi-arm symmetry trails
 * - SculptGL: browser sculpt (Hybrid DCC sculpt kernel)
 * - 레이아웃 밀도 프리셋은 studio-ui-density.ts 에 매핑돼 있다
 *
 * Pure data + presentation helpers; no document state.
 */

import { STUDIO_BRUSH_DISCOVERY } from "./brush/studio-brush-discovery";
import {
  isStudioBrushMaterialGroup,
  studioBrushCoreMaterialGroup,
} from "./brush/studio-brush-material-group";
import { isStudioBrushQuarantinedPresetId } from "./brush/studio-brush-quarantine";
import { resolveStudioBrushRuntimeContract } from "./brush/studio-brush-runtime-contract";
import {
  BRUSH_PRESETS,
  type BrushPreset,
  type StudioToolOperation,
} from "./studio-brush";

import type {
  StudioBrushMaterialGroup,
  StudioBrushPreviewStyle,
} from "./brush/studio-brush-visual";

/** Canva/Express style “simple draw” kit — first tools a beginner sees. */
export const STUDIO_BEGINNER_BRUSH_IDS = [
  // 선 — 굵기·필압 순 (pen 대표 → 필압 G펜 → 펜촉)
  // 2026-09-02 feel-cull: fineliner 는 pen 과 실행 서명이 같아 격리. 빈 히스토리 퀵 셸프
  // 첫 8(펜→수채→에어)은 그대로 유지한다.
  "pen",
  "gpen",
  "fountain-pen",
  // 워시/에어 — 번짐 축 (빈 히스토리 퀵 셸프 첫 8 안에 유지 계약)
  "watercolor",
  "airbrush",
  // 마커/붓 — 도포 축
  "marker",
  "brush",
  // 드로잉
  "pencil",
  "highlighter",
  // 2026-09-01 InkWash 유체 도구: 기본 탭 기본 목록에 올려 피커에서 바로 고르게 합니다.
  // 퀵 셸프 첫 8(펜→수채→에어)은 그대로 두고, 기본 키트 본문 뒤에 둡니다.
  "inkwash-pen",
  "inkwash-water-brush",
  // 2026-08-21 로스터 축소: gel-pen·school-pen 을 스타터 키트에서 뺐습니다. 둘 다 pen/gpen 과
  // 실행 서명이 같아(굵기만 다름) 초보 키트 한 줄에 같은 선이 다섯 번 보이던 자리였습니다.
  // 두 id 는 격리 원장으로 옮겼고, 저장된 문서는 계속 원래 브러시로 재생됩니다.
  // 2026-08-22 제2차 축소: ballpoint·felt-tip 도 같은 서명의 굵기 중간값이라 뺐습니다(격리 A′).
  // 지우개는 도구 경계라 마지막에 둡니다.
  "standard-eraser",
  "kneaded-eraser",
] as const;

/** Picsart/Express expressive kit shown after expanding the tray. */
export const STUDIO_EXPRESSIVE_BRUSH_IDS = [
  // ── 펜촉·캘리그래피 ──
  "maru-pen",
  "calligraphy",
  "fountain-pen",
  "parallel-pen",
  "perfect-ink",
  "perfect-marker",
  // (2026-08-21 격리: ruling-pen · glass-pen · liner — pen/gpen 과 같은 서명, 원래 자리 유지)
  "ruling-pen",
  "glass-pen",
  "liner",
  // ── 마커·형광 FX ──
  "marker-bold",
  "neon",
  "soft-glow",
  "glow",
  "glitter",
  "star-dust",
  // ── 연필 ──
  "soft-pencil",
  "erodible-pencil",
  // ── 수채·유화·페인트 ──
  "watercolor",
  // 2026-08-22 제2차 축소: ink-wash 는 watercolor 와 실행 서명·값이 같아 격리 원장으로
  // 옮겼습니다(격리 D′). 수묵 표현은 ink-wash--sumi-core 등 전용 레인이 유지합니다.
  "inkwash-pen",
  "inkwash-water-brush",
  "inkwash-bleed-wash",
  "inkwash-white-ink",
  "oil",
  "paint-tube",
  // ── 파스텔·드라이 미디어 ──
  "pastel",
  "crayon",
  "chalk",
  "charcoal",
  "dry-media",
  // ── 에어브러시 계열 ──
  "airbrush",
  "hard-airbrush",
  "soft-brush",
  "spray",
  // ── 스페셜 잉크 ──
  "ink-particle",
  "tangent-normal-brush",
  // ── 스케치패드 키트 ──
  "sketchpad-tile",
  "sketchpad-mirror",
  "sketchpad-soft-marker",
  // ── 웹 드로잉 키트(도구군) ──
  "web-multi-agent",
  "web-rough-ink",
  "web-gravity-drip",
  "web-soft-cloud",
  "web-calligraphy-ribbon",
  "web-dash-stitch",
  "web-scatter-stamp",
  "web-rainbow-flow",
  "web-lazy-ink",
  "web-hatch-color",
  "web-cel-flat",
  "web-blend-softener",
  "web-dot-tone",
  "web-kaleido-ink",
  "web-fur-strand",
  "web-contour-double",
  "web-radial-burst",
  "web-mirror-ink",
  "web-grid-ink",
  "web-spiro-orbit",
  "web-zigzag-edge",
  "web-neon-tube",
  "web-pressure-flat",
  "web-smudge-trail",
  "web-cross-hatch-pen",
  // ── 톤 ──
  "screentone",
] as const;

/**
 * 브러시 서랍 필터. 티어 축("프로"/"엔진")은 재료를 말해주지 않아 제거했고, 남은 축은
 * 숙련도(기본/전체+)와 재질뿐이다.
 */
export type StudioBrushTrayCategory =
  | "beginner"
  | "expressive"
  | StudioBrushMediaGroup
  | "all";

export type StudioBrushTrayItemCategory = "beginner" | "expressive";

export type StudioBrushMediaGroup = StudioBrushMaterialGroup;

export interface StudioBrushTrayItem {
  id: string;
  name: string;
  shortName: string;
  hint: string;
  /** Korean/English discovery aliases; never replace the persisted catalogue id. */
  searchAliases?: readonly string[];
  defaultWidth: number;
  defaultOpacity: number;
  defaultColor?: string;
  /** Independent tool-family axis; media categories never imply paint versus erase. */
  operation: StudioToolOperation;
  category: StudioBrushTrayItemCategory;
  mediaGroup: StudioBrushMediaGroup;
  /** 0–1 visual weight for stroke preview thickness. */
  previewWeight: number;
  /** Preview stroke style for SVG chip (Picsart/Express/Ibis affordance). */
  previewStyle: StudioBrushPreviewStyle;
}

export type StudioQuickBrushSource = "favorite" | "recent" | "starter";

export interface StudioQuickBrushTrayItem extends StudioBrushTrayItem {
  quickSource: StudioQuickBrushSource;
}

export interface StudioQuickBrushTrayOptions {
  /**
   * Optional caller-owned catalogue. Passing the combined core + procedural catalogue lets the
   * quick shelf resolve persisted Pro brush identities without eagerly coupling this pure helper
   * to the pack metadata module.
   */
  catalogItems?: readonly StudioBrushTrayItem[];
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  limit?: number;
}

export const STUDIO_QUICK_BRUSH_LIMIT = 8;

const BEGINNER_SET = new Set<string>(STUDIO_BEGINNER_BRUSH_IDS);


const SHORT_NAMES: Record<string, string> = {
  pen: "펜",
  fineliner: "파인",
  ballpoint: "볼펜",
  "gel-pen": "젤펜",
  "glass-pen": "유리펜",
  "ruling-pen": "룰링펜",
  gpen: "G펜",
  "school-pen": "스쿨펜",
  "maru-pen": "마루펜",
  liner: "라이너",
  calligraphy: "캘리",
  "fountain-pen": "만년필",
  "parallel-pen": "평행펜",
  "standard-eraser": "지우개",
  "kneaded-eraser": "떡지우개",
  marker: "마커",
  "felt-tip": "펠트",
  "marker-bold": "볼드",
  highlighter: "형광",
  neon: "네온",
  glow: "글로우",
  "soft-glow": "소프광",
  glitter: "글리터",
  "star-dust": "스타",
  brush: "붓",
  watercolor: "수채",
  "ink-wash": "수묵",
  "inkwash-pen": "잉크펜",
  "inkwash-water-brush": "물붓",
  "inkwash-bleed-wash": "번짐워",
  "inkwash-white-ink": "흰잉크",
  oil: "유화",
  "paint-tube": "튜브물감",
  pastel: "파스텔",
  "ink-particle": "잉크",
  "tangent-normal-brush": "노멀맵",
  "sketchpad-tile": "타일",
  "sketchpad-mirror": "세로대칭",
  "sketchpad-soft-marker": "소프트마",
  "web-multi-agent": "무리붓",
  "web-rough-ink": "러프잉크",
  "web-gravity-drip": "드립",
  "web-soft-cloud": "클라우드",
  "web-calligraphy-ribbon": "캘리리본",
  "web-dash-stitch": "스티치",
  "web-scatter-stamp": "스탬프",
  "web-rainbow-flow": "레인보우",
  "web-lazy-ink": "레이지잉크",
  "web-hatch-color": "해치채색",
  "web-cel-flat": "셀플랫",
  "web-blend-softener": "블렌드",
  "web-dot-tone": "도트톤",
  "web-kaleido-ink": "만화경",
  "web-fur-strand": "퍼스트",
  "web-contour-double": "더블윤곽",
  "web-radial-burst": "방사선",
  "web-mirror-ink": "대칭잉크",
  "web-grid-ink": "그리드",
  "web-spiro-orbit": "스파이로",
  "web-zigzag-edge": "지그재그",
  "web-neon-tube": "네온튜브",
  "web-pressure-flat": "플랫필압",
  "web-smudge-trail": "스머지",
  "web-cross-hatch-pen": "크로해치",
  airbrush: "에어",
  "hard-airbrush": "하드에어",
  "soft-brush": "소프트",
  spray: "스프레이",
  "dry-media": "드라이",
  crayon: "크레용",
  chalk: "초크",
  charcoal: "목탄",
  pencil: "연필",
  "soft-pencil": "연연필",
  "erodible-pencil": "마모연필",
  screentone: "톤",
  "ink-brush": "잉크붓",
  "airbrush-fine": "정밀에어",
  "pencil-grain": "그레인",
  "wash-brush": "물맛",
  "perfect-ink": "퍼펙잉크",
  "perfect-marker": "퍼펙마커",
};

const HINTS: Record<string, string> = {
  pen: "매끈한 선 — Canva·Express 기본 펜",
  fineliner: "얇고 일정한 선 — 디테일·컷선",
  ballpoint: "일상 볼펜 감촉 — 메모·스케치",
  "gel-pen": "끊김 없이 선명한 중성 잉크 — 대사·세부 선화",
  "glass-pen": "유리 홈의 미세한 잉크 흐름 — 섬세한 필기·장식선",
  "ruling-pen": "펜촉 간격을 압력으로 조절하는 정밀 제도선",
  gpen: "필압 굵기 — 만화 선화",
  "school-pen": "G펜보다 안정적인 필압 — 긴 웹툰 선화",
  "maru-pen": "가는 시작과 탄력 있는 굵기 변화 — 눈·머리카락·세부 선화",
  liner: "또렷한 잉크 라이너",
  calligraphy: "기울기 펜촉 — 캘리그래피",
  "fountain-pen": "사선 촉과 필압이 만드는 만년필 획",
  "parallel-pen": "넓고 평행한 촉 — 고딕 레터링·굵은 장식선",
  "standard-eraser": "한 번에 완전히 지우는 100% 기본 지우개",
  "kneaded-eraser": "여러 번 문질러 농도를 서서히 걷어내는 저농도 지우개",
  marker: "굵고 반투명 — 스케치·채색",
  "felt-tip": "펠트 마커 — 일러스트 윤곽",
  "marker-bold": "넓은 마커 — 면 채색",
  highlighter: "하이라이트 강조",
  neon: "네온 글로우 마커",
  glow: "다중 할로 글로우 — SNS 효과선",
  "soft-glow": "넓은 소프트 글로우",
  glitter: "반짝 글리터 입자",
  "star-dust": "성긴 스타 스파클",
  brush: "일반 붓 스트로크",
  watercolor: "번지는 수채 느낌",
  "ink-wash": "수묵·먹 번짐",
  "inkwash-pen": "유체 잉크 딥펜 — 필압으로 굵어지고 젖은 가장자리가 남청색으로 갈라짐",
  "inkwash-water-brush": "물붓 — 먹선을 문지르면 번지고 소용돌이치며 마른 자국이 남음",
  "inkwash-bleed-wash": "번짐 워시 — 입자 침착과 가장자리 암화, 염료가 채널별로 갈라짐",
  "inkwash-white-ink": "화이트 과슈 — 말리면 아래 먹을 덮고 그 위에 다시 그을 수 있음",
  oil: "두꺼운 유화 붓터치",
  "paint-tube": "튜브에서 짜낸 물감처럼 몸체와 능선이 이어지는 입체 압출 획",
  pastel: "부드러운 파스텔 쌓임",
  "ink-particle": "잉크 입자 텍스처",
  "tangent-normal-brush": "획 방향을 RGB 탄젠트 노멀로 인코딩하는 재질 제작 브러시",
  "sketchpad-tile": "경로를 따라 타일처럼 찍히는 이산 스탬프 — Sketchpad Tile 계열",
  "sketchpad-mirror": "세로 대칭 트윈 획 — Sketchpad Mirror 계열 (수직 대칭 힌트)",
  "sketchpad-soft-marker": "부드러운 소비자용 마커 봉투 — Sketchpad Soft Marker 계열",
  "web-multi-agent": "여러 펜이 포인터를 쫓는 무리 획 — Bomomo 계열 웹 드로잉",
  "web-rough-ink": "손그림 지터 다중 패스 잉크 — 웹 코믹/스케치 잉크",
  "web-gravity-drip": "압력에 따라 아래로 흘러내리는 드립 잉크 — Sumo/페인트 드립 계열",
  "web-soft-cloud": "부드러운 입자 구름 스프레이 — Kleki/소프트 에어 계열",
  "web-calligraphy-ribbon": "치즐 플랫 캘리 리본 — Infinite Painter/CSP 치즐 계열",
  "web-dash-stitch": "점선·스티치 패턴 획 — 디자인 툴 대시 펜 계열",
  "web-scatter-stamp": "장식 스탬프 스캐터 — Ibis/Pixlr 재미 스탬프 계열",
  "web-rainbow-flow": "색상 순환 플로우 획 — 웹 레인보우 장난감 브러시 계열",
  "web-lazy-ink": "레이지 마우스 스무스 잉크 — Atrament/Lazy Nezumi 계열",
  "web-hatch-color": "한 방향 평행 사선 해치 채색 펜 — 각도 하나로 고르게 톤을 까는 웹 코믹/마그마 스피드 채색 계열",
  "web-cel-flat": "하드 플랫 셀 채색 마커 — 애니 셀 셰이딩 계열",
  "web-blend-softener": "부드러운 색 블렌드 소프너 — Magma Blend Tool 계열",
  "web-dot-tone": "망점 도트 톤 채색 — 망가 톤/스크린톤 펜 계열",
  "web-kaleido-ink": "N-fold 방사 대칭 만화경 잉크 — Bomomo/Kleki 계열 보조 드로잉",
  "web-fur-strand": "평행 스트랜드 퍼 브러시 — 웹 퍼/털 보조 드로잉 계열",
  "web-contour-double": "이중 윤곽 컨투어 펜 — 코믹 아웃라인 보조",
  "web-radial-burst": "방사 버스트/스피드라인 — 만화 효과 보조 드로잉",
  "web-mirror-ink": "세로축 대칭 2획 미러 잉크 — 한 획이 축 반대편에 함께 그려지는 스케치패드 미러 계열",
  "web-grid-ink": "격자 스냅 자유선 — 픽셀 어시스트 웹 드로잉 계열",
  "web-spiro-orbit": "궤도 스파이로 펜 — 생성형 웹 드로잉 장난감 계열",
  "web-zigzag-edge": "지그재그 윤곽 펜 — 손그림 장식 선 계열",
  "web-neon-tube": "코어+할로 네온 튜브 — 웹 네온 펜 계열",
  "web-pressure-flat": "균일 필압 코믹 잉크 — 플랫 선 보조",
  "web-smudge-trail": "잔상 스머지 트레일 — 소프트 블렌드 트레일 계열",
  "web-cross-hatch-pen": "±45° 두 방향이 겹치는 교차 해치 펜 — 한 획에 크로스해칭이 짜이는 웹 해칭 보조",
  airbrush: "부드러운 에어브러시",
  "hard-airbrush": "입자 간격 없이 연결되는 선명한 경질 분사 경계",
  "soft-brush": "가장자리 부드러운 페인트",
  spray: "스프레이 분무 — 그라데이션",
  "dry-media": "연필·파스텔 텍스처",
  crayon: "크레용 거친 질감",
  chalk: "초크·분필 느낌",
  charcoal: "거친 목탄 셰이딩",
  pencil: "가벼운 밑그림 연필",
  "soft-pencil": "부드러운 셰이딩 연필",
  "erodible-pencil": "획이 길어질수록 심의 접촉면이 닳아 변하는 마모 연필",
  screentone: "만화 스크린톤 도트",
  "ink-brush": "속도 반응 딥펜 — 빠르게 그으면 가늘어져요",
  "airbrush-fine": "입자 없는 매끈한 에어브러시 — 부드러운 셰이딩",
  "pencil-grain": "종이결 그레인 연필 — 러프·해칭",
  "wash-brush": "플로우가 쌓이는 물붓 — 웻엣지 수채",
  "perfect-ink": "필압 테이퍼 잉크 — tldraw급 필기감",
  "perfect-marker": "매끈한 아웃라인 마커 — 균일 굵기 필기감",
};

function previewWeightFor(preset: BrushPreset): number {
  return Math.min(1, Math.max(0.18, preset.defaultWidth / 36));
}

export function studioBrushTrayItem(preset: BrushPreset): StudioBrushTrayItem {
  return {
    id: preset.id,
    name: preset.name,
    shortName: SHORT_NAMES[preset.id] ?? preset.name.slice(0, 4),
    hint: STUDIO_BRUSH_DISCOVERY[preset.id]?.hint ?? HINTS[preset.id] ?? preset.name,
    ...(preset.searchAliases ? { searchAliases: preset.searchAliases } : {}),
    defaultWidth: preset.defaultWidth,
    defaultOpacity: preset.defaultOpacity,
    defaultColor: preset.defaultColor,
    operation: preset.operation,
    category: BEGINNER_SET.has(preset.id) ? "beginner" : "expressive",
    // 재질은 렌더 계약에서 파생한다. 손으로 적던 id 표는 엔진 레인 71종과 코어 17종을
    // 전부 "선"으로 흘려보냈다(88/330 오분류). 계약은 감사받는 SSOT라 누락이 불가능하다.
    mediaGroup: studioBrushCoreMaterialGroup(preset.id),
    previewWeight: previewWeightFor(preset),
    // Preview style is part of the same audited contract as Canvas/SVG routing. Keeping it there
    // prevents a catalogue card from advertising a texture that the selected preset cannot draw.
    previewStyle: resolveStudioBrushRuntimeContract(preset.id)?.preview ?? "solid",
  };
}

export function listStudioBrushTrayItems(
  category: StudioBrushTrayCategory = "all"
): StudioBrushTrayItem[] {
  const byId = new Map(BRUSH_PRESETS.map((preset) => [preset.id, studioBrushTrayItem(preset)]));
  const beginner = STUDIO_BEGINNER_BRUSH_IDS.map((id) => byId.get(id)).filter(
    (item): item is StudioBrushTrayItem => Boolean(item)
  );
  const expressive = STUDIO_EXPRESSIVE_BRUSH_IDS.map((id) => byId.get(id)).filter(
    (item): item is StudioBrushTrayItem => Boolean(item)
  );
  // Any future presets not listed fall into expressive tail (Picsart depth).
  const known = new Set<string>([...STUDIO_BEGINNER_BRUSH_IDS, ...STUDIO_EXPRESSIVE_BRUSH_IDS]);
  const extras = BRUSH_PRESETS.filter((preset) => !known.has(preset.id)).map(studioBrushTrayItem);
  // Wash/air (and any other id listed in both kits) must appear once in "all" so the core
  // catalogue stays 1:1 with BRUSH_PRESETS and quick-shelf injection does not inflate counts.
  const beginnerIds = new Set<string>(STUDIO_BEGINNER_BRUSH_IDS);
  const expressiveUnique = expressive.filter((item) => !beginnerIds.has(item.id));
  const all = [...beginner, ...expressiveUnique, ...extras];

  if (category === "beginner") return beginner;
  // Expressive kit still surfaces wash/air for discovery even when they are beginner-primary.
  if (category === "expressive") return [...expressive, ...extras];
  if (isStudioBrushMaterialGroup(category)) {
    return all.filter((item) => item.mediaGroup === category);
  }
  return all;
}

/**
 * Compact brush shelf: pinned favorites first, then MRU brushes, then a
 * beginner-safe fallback. Unknown and duplicate IDs are ignored so persisted
 * preferences cannot create empty or repeated affordances.
 */
export function listStudioQuickBrushTrayItems({
  catalogItems,
  favoriteIds = [],
  recentIds = [],
  limit = STUDIO_QUICK_BRUSH_LIMIT,
}: StudioQuickBrushTrayOptions = {}): StudioQuickBrushTrayItem[] {
  // Quarantine filtering happens exactly once per lane, at the point that resolves the lane's
  // inventory. This fallback IS such a point (a bare listing lane), so it filters the SSOT on the
  // quarantine ledger (leaf import, no cycle). Injected `catalogItems` are used verbatim — the
  // injecting caller owns its lane's filtering (see `listStudioCoreQuickBrushCatalogItems` and
  // `listStudioQuickBrushCatalogItems`, which inject already-listed inventories) — so a listed
  // injection is never double-filtered and lanes cannot drift apart.
  const availableItems =
    catalogItems
    ?? listStudioBrushTrayItems("all").filter(
      (item) => !isStudioBrushQuarantinedPresetId(item.id)
    );
  const catalog = new Map(availableItems.map((item) => [item.id, item]));
  const safeLimit = Number.isFinite(limit)
    ? Math.min(catalog.size, Math.max(0, Math.floor(limit)))
    : STUDIO_QUICK_BRUSH_LIMIT;
  if (safeLimit === 0) return [];

  const selected: StudioQuickBrushTrayItem[] = [];
  const seen = new Set<string>();

  function append(ids: readonly string[], quickSource: StudioQuickBrushSource): void {
    for (const id of ids) {
      if (selected.length >= safeLimit) return;
      if (seen.has(id)) continue;
      const item = catalog.get(id);
      if (!item) continue;
      selected.push({ ...item, quickSource });
      seen.add(id);
    }
  }

  append(favoriteIds, "favorite");
  append(recentIds, "recent");
  append(STUDIO_BEGINNER_BRUSH_IDS, "starter");

  return selected;
}

export const STUDIO_BRUSH_TRAY_CATEGORY_CHIPS: readonly {
  id: StudioBrushTrayCategory;
  label: string;
  title: string;
}[] = [
  { id: "beginner", label: "기본", title: "Canva·Express 초보 키트" },
  { id: "ink", label: "잉크", title: "펜·G펜·붓 — 균일한 잉크선" },
  { id: "pencil", label: "연필", title: "연필·흑연 — 종이결 그레인" },
  { id: "marker", label: "마커", title: "마커·형광펜 — 반투명 균일 도포" },
  { id: "watercolor", label: "수채", title: "수채·수묵·과슈 — 웻엣지 번짐" },
  { id: "oil", label: "유화", title: "유화·아크릴·임파스토 — 강모결과 두께" },
  { id: "airbrush", label: "에어", title: "에어·스프레이·스플래터 — 소프트 입자" },
  { id: "pastel", label: "파스텔", title: "파스텔·목탄·크레용·초크 — 마른 가루" },
  { id: "texture", label: "질감", title: "천·암석·나뭇잎·털 — 재질 스탬프" },
  { id: "tone", label: "톤", title: "스크린톤·망점·해칭" },
  { id: "fx", label: "효과", title: "네온·글로우·글리터" },
  { id: "expressive", label: "전체+", title: "확장 브러시 전체" },
];

/** Quick-start cards — multi-product entry without cloning brand names. */
export type StudioCreativeStarterId =
  | "example"
  | "template"
  | "smart-shape"
  | "draw"
  | "brush-kit"
  | "collab-focus"
  | "character"
  | "bubble"
  | "publish"
  | "pixel-art"
  | "sticky-board"
  | "silk-flow"
  | "ephemeral-board"
  | "sculpt-3d";

export interface StudioCreativeStarterCard {
  id: StudioCreativeStarterId;
  label: string;
  hint: string;
  /** Competitor inspiration note for docs/tests only (not shown as brand copy). */
  inspiredBy: string;
}

export const STUDIO_CREATIVE_STARTER_CARDS: readonly StudioCreativeStarterCard[] = Object.freeze([
  {
    id: "draw",
    label: "펜으로 그리기",
    hint: "바로 스케치 시작",
    inspiredBy: "Canva Draw",
  },
  {
    id: "smart-shape",
    label: "스마트 도형",
    hint: "낙서 → 선·원·사각형",
    inspiredBy: "AutoDraw",
  },
  {
    id: "brush-kit",
    label: "브러시",
    hint: "펜·수채·글로우·글리터·유화",
    inspiredBy: "Picsart Draw / Adobe Express",
  },
  {
    id: "template",
    label: "컷 템플릿",
    hint: "패널 레이아웃 배치",
    inspiredBy: "Canva / Express",
  },
  {
    id: "collab-focus",
    label: "캔버스 넓히기",
    hint: "패널 접고 집중 모드",
    inspiredBy: "협업 캔버스 집중 모드",
  },
  {
    id: "example",
    label: "예시 캔버스",
    hint: "샘플 컷으로 연습",
    inspiredBy: "Canva templates",
  },
  {
    id: "character",
    label: "캐릭터",
    hint: "2D / 3D 포즈",
    inspiredBy: "webtoon workflow",
  },
  {
    id: "bubble",
    label: "말풍선",
    hint: "대사 넣기",
    inspiredBy: "webtoon workflow",
  },
  {
    id: "pixel-art",
    label: "픽셀 아트",
    hint: "도트·팔레트 잠금·GIF",
    inspiredBy: "Piskel / Pixilart / Lospec",
  },
  {
    id: "sticky-board",
    label: "스티키 보드",
    hint: "아이디어 포스트잇",
    inspiredBy: "Miro / tldraw",
  },
  {
    id: "silk-flow",
    label: "실크 플로우",
    hint: "대칭 생성형 문양",
    inspiredBy: "Silk generative art",
  },
  {
    id: "ephemeral-board",
    label: "빠른 보드",
    hint: "휘발 공유 화이트보드",
    inspiredBy: "Witeboard / Whiteboard.fi",
  },
  {
    id: "sculpt-3d",
    label: "3D 스컬프",
    hint: "찰흙 조형 브러시",
    inspiredBy: "SculptGL",
  },
]);
