/**
 * §15.3 Filter group.
 *
 * Unchanged by the §15.3 regroup — it already was its own group — but split into
 * its own module so the filter rows cannot crowd the rest of the catalogue.
 *
 * The pack rows used to be a hand-written array of 27 `{ id, label, icon }` literals. It drifted:
 * the 16 union-wave filters (warps, film grain, pointillize, god rays…) shipped with working
 * engines, dialog entries and search metadata, but never got a menubar row, so a third of the
 * filter catalogue was reachable only by typing into the gallery's search box. The rows are now
 * generated from `STUDIO_FILTER_PACK_KINDS` + `STUDIO_FILTER_PACK_LABELS` (the same registry the
 * dialog gallery counts), and this module only decides the icon. A new filter kind therefore
 * appears in the menu the moment it exists — it cannot be forgotten here again.
 *
 * Purpose grouping, section labels and separators are not authored here either: the rows go
 * through `orderStudioFilterMenuItems`, so the menu and the filter gallery read one taxonomy
 * (#771 — 흐림·초점, 선화·복원, 빛·렌즈 …) instead of two hand-kept ones that drift apart.
 */

import {
  Aperture,
  Blend,
  Camera,
  CircleDot,
  Cloudy,
  Compass,
  Contrast,
  Copy,
  Droplet,
  Droplets,
  Eraser,
  Film,
  Focus,
  Frame,
  GanttChartSquare,
  Gem,
  Grid2x2,
  Grid3x3,
  Grip,
  History as HistoryIcon,
  Layers,
  Maximize2,
  Mountain,
  Paintbrush,
  Palette,
  Printer,
  Rainbow,
  RotateCw,
  ScanLine,
  Shrink,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Sun,
  Sunrise,
  Tornado,
  Tv,
  Waves,
  Wind,
  Zap,
} from "lucide-react";

import { orderStudioFilterMenuItems } from "./filter/studio-filter-menu-groups";
import {
  STUDIO_FILTER_PACK_KINDS,
  STUDIO_FILTER_PACK_LABELS,
} from "./filter/studio-filter-pack-registry";

import type { StudioFilterPackKind } from "./filter/studio-filter-pack-registry";
import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";
import type { LucideIcon } from "lucide-react";

/**
 * kind → row icon. Exhaustive by type: adding a filter kind without choosing an icon is a
 * compile error, which is the only part of a filter row this module still authors by hand.
 */
const STUDIO_FILTER_PACK_MENU_ICONS: Readonly<Record<StudioFilterPackKind, LucideIcon>> = {
  mosaic: Grid3x3,
  "radial-blur": RotateCw,
  "zoom-blur": Maximize2,
  "lens-blur": Aperture,
  "field-iris-blur": Focus,
  "tilt-shift-blur": ScanLine,
  "selective-gaussian-blur": Blend,
  "tileable-blur": Grid3x3,
  "chromatic-aberration": Copy,
  glitch: Zap,
  scanline: Tv,
  vignette: Focus,
  "lens-flare": Sun,
  emboss: Layers,
  solarize: Contrast,
  threshold: SlidersHorizontal,
  "oil-paint": Paintbrush,
  "surface-blur": Droplets,
  "line-cleanup": ScanLine,
  "screentone-removal": Grid2x2,
  "jpeg-artifact-reduction": Eraser,
  "edge-aware-denoise": Sparkles,
  "dust-scratches": Eraser,
  "difference-of-gaussians": ScanLine,
  "color-to-alpha": Blend,
  duotone: Palette,
  "noise-add": Droplet,
  "wave-warp": Waves,
  "ripple-warp": CircleDot,
  fisheye: Aperture,
  twirl: Tornado,
  "pinch-bloat": Shrink,
  "lens-distortion": Camera,
  "film-grain-pro": Film,
  "salt-pepper": Grip,
  "rgb-noise": Rainbow,
  "perlin-texture": Cloudy,
  pointillize: CircleDot,
  "stained-glass": Gem,
  "poster-edges": Frame,
  photocopy: Printer,
  "normal-map": Mountain,
  "god-rays": Sunrise,
  "polar-coordinates": Compass,
};

/** Core rows keep their bespoke drafts and ⌘⇧n chords; the shared grouping decides where they sit. */
const STUDIO_FILTER_CORE_MENU_ROWS = [
  { id: "gaussian-blur", label: "가우시안 블러", icon: Droplets, shortcut: "⌘⇧1" },
  { id: "motion-blur", label: "모션 블러", icon: Wind, shortcut: "⌘⇧2" },
  {
    id: "hue-saturation-brightness",
    label: "색조 / 채도 / 밝기",
    icon: Palette,
    shortcut: "⌘⇧3",
  },
  { id: "brightness-contrast", label: "명도 / 대비", icon: SlidersHorizontal, shortcut: "⌘⇧4" },
  { id: "color-curves", label: "색상 커브", icon: GanttChartSquare, shortcut: "⌘⇧5" },
] as const;

export function buildStudioFilterMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  const filterUnavailableReason = state.filterDisabled
    ? state.filterUnavailableReason ?? "현재 편집 상태에서는 필터를 적용할 수 없습니다."
    : undefined;

  const items: StudioMainMenuItem[] = [
    {
      id: "last-filter",
      commandId: "filter.last",
      searchActivation: "execute",
      label: state.lastFilterDraft ? "마지막 필터 다시 열기" : "마지막 필터…",
      icon: HistoryIcon,
      disabled: !state.lastFilterDraft || state.filterDisabled,
      unavailableReason: state.filterDisabled
        ? filterUnavailableReason
        : !state.lastFilterDraft
          ? "아직 다시 열 수 있는 필터 설정이 없습니다."
          : undefined,
      separatorAfter: true,
      onSelect: () => {
        if (state.lastFilterDraft) {
          editor.openStudioFilter(state.lastFilterDraft.kind, state.lastFilterDraft);
        }
      },
    },
    ...STUDIO_FILTER_CORE_MENU_ROWS.map(({ id, label, icon, shortcut }) => ({
      id,
      commandId: `filter.${id}`,
      searchActivation: "execute" as const,
      label,
      icon,
      shortcut,
      disabled: state.filterDisabled,
      unavailableReason: filterUnavailableReason,
      onSelect: () => {
        editor.openStudioFilter(id);
      },
    })),
    // §15.3 Filter ▸ Adjustment Layer. 위 항목들과 달리 픽셀을 굽지 않고 선택 레이어의
    // 보정 파라미터를 편집한다 — 인스펙터 보정 패널이 실제 편집면이고, 메뉴는 그 문이다.
    // (감사 §2.2: 레벨·커브 둘 다 메뉴·팔레트·검색 어디에도 없어 3동작을 넘겼다.)
    // 다이얼로그 필터가 아니라 공유 분류 밖에 남고, 정렬 뒤에는 메뉴 맨 끝 구역이 된다.
    ...([
      { id: "levels", commandId: "filter.levels", label: "레이어 보정 · 레벨", icon: SlidersHorizontal },
      { id: "tone-curve", commandId: "filter.tone-curve", label: "레이어 보정 · 톤 커브", icon: Spline },
    ] as const).map(({ id, commandId, label, icon }, index) => ({
      id,
      commandId,
      searchActivation: "execute" as const,
      ...(index === 0 ? { sectionLabel: "레이어 보정" } : {}),
      label,
      icon,
      disabled: !state.imageLayerSelected,
      unavailableReason: state.imageLayerSelected
        ? undefined
        : "보정할 이미지 레이어를 먼저 선택하세요.",
      onSelect: () => {
        ui.openImageAdjustments();
      },
    })),
    // 필터 팩 전체 — 하나도 빠뜨릴 수 없도록 레지스트리를 그대로 순회한다. 라벨은
    // 다이얼로그(STUDIO_FILTER_PACK_DEFS)와 같은 문자열이고, 여기서 정하는 건 아이콘뿐.
    ...STUDIO_FILTER_PACK_KINDS.map((kind) => ({
      id: kind,
      commandId: `filter.${kind}`,
      searchActivation: "execute" as const,
      label: STUDIO_FILTER_PACK_LABELS[kind],
      icon: STUDIO_FILTER_PACK_MENU_ICONS[kind],
      disabled: state.filterDisabled,
      unavailableReason: filterUnavailableReason,
      onSelect: () => {
        editor.openStudioFilter(kind);
      },
    })),
  ];
  // 용도별 그룹·구분선은 갤러리와 같은 한 곳에서 정한다. ID·콜백·단축키·비활성 사유는 그대로다.
  return orderStudioFilterMenuItems(items);
}
