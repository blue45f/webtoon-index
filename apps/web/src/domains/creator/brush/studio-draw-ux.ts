/**
 * Draw UX helpers — 상용 드로잉 앱(PicsArt/Procreate) 관례의 편의 계산.
 * Pure, no React.
 */

import { BRUSH_PRESETS, type BrushPreset } from "../studio-brush";
import {
  listStudioBrushTrayItems,
  type StudioBrushTrayCategory,
  type StudioBrushTrayItem,
} from "../studio-creative-ux";
import { matchesStudioToolSearch, studioToolSearchTerms } from "../studio-tool-search";

import { STUDIO_BRUSH_MATERIAL_GROUP_LABELS } from "./studio-brush-material-group";

export const STUDIO_BRUSH_SIZE_RANGE = { min: 1, max: 80 } as const;
export const STUDIO_BRUSH_OPACITY_RANGE = { min: 0.05, max: 1 } as const;

/** Size nudge steps (coarse when large). */
export function studioBrushSizeStep(current: number, direction: 1 | -1): number {
  const w = Number.isFinite(current) ? current : 6;
  let step = 1;
  if (w >= 40) step = 4;
  else if (w >= 20) step = 2;
  return step * direction;
}

export function adjustStudioBrushSize(width: unknown, delta: number): number {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 6;
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
  return Math.min(
    STUDIO_BRUSH_SIZE_RANGE.max,
    Math.max(STUDIO_BRUSH_SIZE_RANGE.min, Math.round(w + d))
  );
}

export function adjustStudioBrushOpacity(opacity: unknown, delta: number): number {
  const o = typeof opacity === "number" && Number.isFinite(opacity) ? opacity : 1;
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
  const next = o + d;
  return Math.min(
    STUDIO_BRUSH_OPACITY_RANGE.max,
    Math.max(STUDIO_BRUSH_OPACITY_RANGE.min, Math.round(next * 100) / 100)
  );
}

export function filterStudioBrushLibraryItems(options: {
  category?: StudioBrushTrayCategory | "favorites" | "recent";
  query?: string;
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  /** Optional extended catalogue supplied by the lazy library surface. */
  catalogItems?: readonly StudioBrushTrayItem[];
}): StudioBrushTrayItem[] {
  const terms = studioToolSearchTerms(options.query ?? "");
  const favoriteIds = options.favoriteIds ?? [];
  const recentIds = options.recentIds ?? [];
  const category = options.category ?? "all";

  const allItems = options.catalogItems
    ? [...options.catalogItems]
    : listStudioBrushTrayItems("all");
  const byId = new Map(allItems.map((item) => [item.id, item]));
  let items: StudioBrushTrayItem[];
  if (category === "favorites") {
    items = [...new Set(favoriteIds)].map((id) => byId.get(id)).filter((item): item is StudioBrushTrayItem => Boolean(item));
  } else if (category === "recent") {
    items = [...new Set(recentIds)].map((id) => byId.get(id)).filter((item): item is StudioBrushTrayItem => Boolean(item));
  } else if (category === "all" || category === "expressive") {
    items = category === "all"
      ? allItems
      : allItems.filter((item) => item.category === "expressive");
  } else if (category === "beginner") {
    items = allItems.filter((item) => item.category === "beginner");
  } else {
    items = allItems.filter((item) => item.mediaGroup === category);
  }

  if (!terms.length) return items;
  return items.filter((item) => {
    return matchesStudioToolSearch(terms, [
      item.name,
      item.shortName,
      item.hint,
      item.id,
      item.mediaGroup,
      STUDIO_BRUSH_MATERIAL_GROUP_LABELS[item.mediaGroup],
      ...(item.searchAliases ?? []),
    ]);
  });
}

export function studioBrushPresetById(id: unknown): BrushPreset | null {
  if (typeof id !== "string" || !id) return null;
  return BRUSH_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * 브러시 라이브러리 탭 — 재질 축 하나로 정리했다.
 *
 * "프로"와 "엔진" 탭은 삭제했다. 둘 다 브러시가 어떤 재료를 남기는지 말해주지 않는 구현 티어라,
 * 유화 리본과 수채 과립이 "엔진" 한 칸에 뒤섞여 있었고 프로 160종은 재질과 무관하게 한 덩어리였다.
 * 지금은 잉크·연필·마커·수채·유화·에어·파스텔·질감·톤·효과 열 갈래이며, 각 항목의 소속은
 * 렌더 계약에서 파생되므로 새 브러시가 추가돼도 손으로 표를 고칠 일이 없다.
 */
export const STUDIO_BRUSH_LIBRARY_TABS: readonly {
  id: StudioBrushTrayCategory | "favorites" | "recent";
  label: string;
  title: string;
}[] = [
  { id: "favorites", label: "즐겨찾기", title: "즐겨찾기 브러시" },
  { id: "recent", label: "최근 사용", title: "최근 사용한 브러시" },
  { id: "beginner", label: "시작 도구", title: "자주 쓰는 기본 표현부터 선택" },
  { id: "ink", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.ink, title: "펜·G펜·붓펜 — 균일 선부터 필압 테이퍼까지" },
  { id: "pencil", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.pencil, title: "연필·흑연 — 종이결 그레인" },
  { id: "marker", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.marker, title: "마커·형광펜 — 넓은 획과 겹칠 수 있는 채색" },
  { id: "watercolor", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.watercolor, title: "수채·수묵·과슈 — 물 번짐과 물감 도포" },
  { id: "oil", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.oil, title: "유화·아크릴·임파스토 — 강모결과 두께" },
  { id: "airbrush", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.airbrush, title: "에어·스프레이·스플래터 — 소프트 입자" },
  { id: "pastel", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.pastel, title: "파스텔·목탄·크레용·초크 — 마른 가루" },
  { id: "texture", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.texture, title: "천·암석·나뭇잎·털 — 재질 스탬프" },
  { id: "tone", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.tone, title: "스크린톤·망점·해칭" },
  { id: "fx", label: STUDIO_BRUSH_MATERIAL_GROUP_LABELS.fx, title: "네온·글로우·글리터·비·눈·불꽃" },
  { id: "all", label: "전체", title: "모든 브러시" },
];
