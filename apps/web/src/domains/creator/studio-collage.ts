/**
 * Studio Collage — PicsArt/Canva-class multi-photo grid layouts.
 *
 * Pure geometry: normalized slots → pixel frames with gap/padding/border.
 * No DOM/Konva. StudioPage materializes frames (+ optional image cover-fit placements).
 */

import { coverFitInFrame, containFitInFrame, type FitBox } from "./studio-fit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unit rect inside the padded content area (0–1). */
export interface CollageNormalizedSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StudioCollageCategory = "basic" | "grid" | "story" | "magazine" | "creative";

export interface StudioCollageLayoutPreset {
  id: string;
  label: string;
  hint: string;
  category: StudioCollageCategory;
  /** Expected photo count (slot length). */
  cells: number;
  slots: readonly CollageNormalizedSlot[];
}

export interface StudioCollageMaterializeOptions {
  canvasW: number;
  canvasH: number;
  /** Outer margin from canvas edge (px). */
  padding: number;
  /** Gap between cells (px). Applied as half-gap inset per shared edge. */
  gap: number;
  borderWidth: number;
  borderColor: string;
  cellBg: string;
}

export interface StudioCollageFrameSeed {
  type: "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  bg: string;
  stroke: string;
  strokeWidth: number;
  name: string;
  groupId: string;
  collageSlotIndex: number;
  collageLayoutId: string;
}

export type StudioCollageFitMode = "cover" | "contain";

export interface StudioCollageImageSource {
  id: string;
  width: number;
  height: number;
}

export interface StudioCollageImagePlacement {
  imageId: string;
  slotIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioCollageMaterializeResult {
  frames: StudioCollageFrameSeed[];
  groupId: string;
  canvasW: number;
  canvasH: number;
}

export const STUDIO_COLLAGE_GAP_RANGE = { min: 0, max: 48 } as const;
export const STUDIO_COLLAGE_PADDING_RANGE = { min: 0, max: 80 } as const;
export const STUDIO_COLLAGE_BORDER_RANGE = { min: 0, max: 24 } as const;
export const STUDIO_COLLAGE_CANVAS_H_PRESETS = [
  { id: "square", label: "정사각", height: 720 },
  { id: "story", label: "스토리", height: 1280 },
  { id: "feed", label: "피드", height: 900 },
  { id: "wide", label: "와이드", height: 480 },
] as const;

export const DEFAULT_STUDIO_COLLAGE_OPTIONS: StudioCollageMaterializeOptions = {
  canvasW: 720,
  canvasH: 720,
  padding: 16,
  gap: 8,
  borderWidth: 0,
  borderColor: "#16100c",
  cellBg: "#f4efe6",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeStudioCollageOptions(
  partial?: Partial<StudioCollageMaterializeOptions> | null
): StudioCollageMaterializeOptions {
  const src = partial && typeof partial === "object" ? partial : {};
  return {
    canvasW: clamp(Math.round(finiteNumber(src.canvasW, DEFAULT_STUDIO_COLLAGE_OPTIONS.canvasW)), 64, 8192),
    canvasH: clamp(Math.round(finiteNumber(src.canvasH, DEFAULT_STUDIO_COLLAGE_OPTIONS.canvasH)), 64, 8192),
    padding: clamp(Math.round(finiteNumber(src.padding, DEFAULT_STUDIO_COLLAGE_OPTIONS.padding)), STUDIO_COLLAGE_PADDING_RANGE.min, STUDIO_COLLAGE_PADDING_RANGE.max),
    gap: clamp(Math.round(finiteNumber(src.gap, DEFAULT_STUDIO_COLLAGE_OPTIONS.gap)), STUDIO_COLLAGE_GAP_RANGE.min, STUDIO_COLLAGE_GAP_RANGE.max),
    borderWidth: clamp(Math.round(finiteNumber(src.borderWidth, DEFAULT_STUDIO_COLLAGE_OPTIONS.borderWidth)), STUDIO_COLLAGE_BORDER_RANGE.min, STUDIO_COLLAGE_BORDER_RANGE.max),
    borderColor:
      typeof src.borderColor === "string" && src.borderColor.trim()
        ? src.borderColor.trim()
        : DEFAULT_STUDIO_COLLAGE_OPTIONS.borderColor,
    cellBg:
      typeof src.cellBg === "string" && src.cellBg.trim()
        ? src.cellBg.trim()
        : DEFAULT_STUDIO_COLLAGE_OPTIONS.cellBg,
  };
}

function slot(x: number, y: number, w: number, h: number): CollageNormalizedSlot {
  return { x, y, w, h };
}

/** Uniform grid slots (cols × rows) covering [0,1]². */
export function collageGridSlots(cols: number, rows: number): CollageNormalizedSlot[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const slots: CollageNormalizedSlot[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      slots.push(slot(col / c, row / r, 1 / c, 1 / r));
    }
  }
  return slots;
}

function layout(
  id: string,
  label: string,
  hint: string,
  category: StudioCollageCategory,
  slots: readonly CollageNormalizedSlot[]
): StudioCollageLayoutPreset {
  return {
    id,
    label,
    hint,
    category,
    cells: slots.length,
    slots,
  };
}

// ---------------------------------------------------------------------------
// Catalog (PicsArt-depth grids without brand clones)
// ---------------------------------------------------------------------------

export const STUDIO_COLLAGE_LAYOUTS: readonly StudioCollageLayoutPreset[] = Object.freeze([
  // —— Basic ——
  layout("c1", "1칸", "전체 한 장", "basic", [slot(0, 0, 1, 1)]),
  layout("c2h", "좌우 2칸", "사이드 바이 사이드", "basic", collageGridSlots(2, 1)),
  layout("c2v", "상하 2칸", "위·아래 분할", "basic", collageGridSlots(1, 2)),
  layout("c3h", "가로 3칸", "가로 스트립", "basic", collageGridSlots(3, 1)),
  layout("c3v", "세로 3칸", "세로 스트립", "basic", collageGridSlots(1, 3)),
  // —— Grid ——
  layout("c2x2", "2×2", "정사각 네 칸", "grid", collageGridSlots(2, 2)),
  layout("c3x3", "3×3", "인스타 그리드", "grid", collageGridSlots(3, 3)),
  layout("c2x3", "2×3", "세로 긴 6칸", "grid", collageGridSlots(2, 3)),
  layout("c3x2", "3×2", "가로 넓은 6칸", "grid", collageGridSlots(3, 2)),
  layout("c4x2", "4×2", "여덟 칸 와이드", "grid", collageGridSlots(4, 2)),
  // —— Story / social ——
  layout(
    "c-story-hero",
    "스토리 히어로",
    "위 큰 컷 + 아래 2",
    "story",
    [slot(0, 0, 1, 0.62), slot(0, 0.62, 0.5, 0.38), slot(0.5, 0.62, 0.5, 0.38)]
  ),
  layout(
    "c-story-tri",
    "스토리 3단",
    "세로 스토리 3컷",
    "story",
    collageGridSlots(1, 3)
  ),
  layout(
    "c-feed-feature",
    "피드 피처",
    "위 전폭 + 아래 3",
    "story",
    [slot(0, 0, 1, 0.55), slot(0, 0.55, 1 / 3, 0.45), slot(1 / 3, 0.55, 1 / 3, 0.45), slot(2 / 3, 0.55, 1 / 3, 0.45)]
  ),
  // —— Magazine ——
  layout(
    "c-mag-left",
    "매거진 좌",
    "왼쪽 큰 컷 + 우 2",
    "magazine",
    [slot(0, 0, 0.58, 1), slot(0.58, 0, 0.42, 0.5), slot(0.58, 0.5, 0.42, 0.5)]
  ),
  layout(
    "c-mag-right",
    "매거진 우",
    "오른쪽 큰 컷 + 좌 2",
    "magazine",
    [slot(0, 0, 0.42, 0.5), slot(0, 0.5, 0.42, 0.5), slot(0.42, 0, 0.58, 1)]
  ),
  layout(
    "c-mag-quad",
    "매거진 4",
    "큰 1 + 작은 3 스택",
    "magazine",
    [
      slot(0, 0, 0.62, 0.72),
      slot(0.62, 0, 0.38, 0.36),
      slot(0.62, 0.36, 0.38, 0.36),
      slot(0, 0.72, 1, 0.28),
    ]
  ),
  layout(
    "c-mag-strip",
    "시네마 스트립",
    "가로 4연속",
    "magazine",
    collageGridSlots(4, 1)
  ),
  // —— Creative ——
  layout(
    "c-cross",
    "크로스 5",
    "십자 5칸",
    "creative",
    [
      slot(1 / 3, 0, 1 / 3, 1 / 3),
      slot(0, 1 / 3, 1 / 3, 1 / 3),
      slot(1 / 3, 1 / 3, 1 / 3, 1 / 3),
      slot(2 / 3, 1 / 3, 1 / 3, 1 / 3),
      slot(1 / 3, 2 / 3, 1 / 3, 1 / 3),
    ]
  ),
  layout(
    "c-lshape",
    "L형 3",
    "L자 배치",
    "creative",
    [slot(0, 0, 0.62, 0.62), slot(0.62, 0, 0.38, 0.62), slot(0, 0.62, 1, 0.38)]
  ),
  layout(
    "c-window",
    "윈도우 4",
    "테두리형 4칸",
    "creative",
    [slot(0, 0, 0.5, 0.5), slot(0.5, 0, 0.5, 0.5), slot(0, 0.5, 0.5, 0.5), slot(0.5, 0.5, 0.5, 0.5)]
  ),
  layout(
    "c-mosaic-5",
    "모자이크 5",
    "비대칭 5컷",
    "creative",
    [
      slot(0, 0, 0.55, 0.55),
      slot(0.55, 0, 0.45, 0.35),
      slot(0.55, 0.35, 0.45, 0.3),
      slot(0, 0.55, 0.35, 0.45),
      slot(0.35, 0.55, 0.65, 0.45),
    ]
  ),
  layout(
    "c-triptych-wide",
    "트립티크",
    "가운데 강조 3",
    "creative",
    [slot(0, 0.08, 0.3, 0.84), slot(0.3, 0, 0.4, 1), slot(0.7, 0.08, 0.3, 0.84)]
  ),
]);

export const STUDIO_COLLAGE_CATEGORY_CHIPS: readonly {
  id: StudioCollageCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "전체" },
  { id: "basic", label: "기본" },
  { id: "grid", label: "그리드" },
  { id: "story", label: "스토리" },
  { id: "magazine", label: "매거진" },
  { id: "creative", label: "크리에이티브" },
];

export function listStudioCollageLayouts(
  category: StudioCollageCategory | "all" = "all"
): StudioCollageLayoutPreset[] {
  if (category === "all") return [...STUDIO_COLLAGE_LAYOUTS];
  return STUDIO_COLLAGE_LAYOUTS.filter((layoutItem) => layoutItem.category === category);
}

export function findStudioCollageLayout(id: unknown): StudioCollageLayoutPreset | null {
  if (typeof id !== "string" || !id) return null;
  return STUDIO_COLLAGE_LAYOUTS.find((layoutItem) => layoutItem.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Materialize
// ---------------------------------------------------------------------------

/**
 * Convert normalized slots into pixel frames.
 * Gap is applied by insetting each cell by gap/2 on every edge that isn't the outer padding edge.
 */
export function materializeStudioCollage(
  layoutPreset: StudioCollageLayoutPreset,
  options?: Partial<StudioCollageMaterializeOptions> | null,
  groupId = `collage-${layoutPreset.id}`
): StudioCollageMaterializeResult {
  const opts = normalizeStudioCollageOptions(options);
  const contentW = Math.max(1, opts.canvasW - opts.padding * 2);
  const contentH = Math.max(1, opts.canvasH - opts.padding * 2);
  const halfGap = opts.gap / 2;

  const frames: StudioCollageFrameSeed[] = layoutPreset.slots.map((s, index) => {
    const rawX = opts.padding + s.x * contentW;
    const rawY = opts.padding + s.y * contentH;
    const rawW = s.w * contentW;
    const rawH = s.h * contentH;

    // Inset by half-gap so adjacent cells share a clean gutter.
    const x = Math.round(rawX + halfGap);
    const y = Math.round(rawY + halfGap);
    const width = Math.max(1, Math.round(rawW - opts.gap));
    const height = Math.max(1, Math.round(rawH - opts.gap));

    return {
      type: "frame" as const,
      x,
      y,
      width,
      height,
      bg: opts.cellBg,
      stroke: opts.borderWidth > 0 ? opts.borderColor : "transparent",
      strokeWidth: opts.borderWidth,
      name: `콜라주 ${index + 1}`,
      groupId,
      collageSlotIndex: index,
      collageLayoutId: layoutPreset.id,
    };
  });

  return {
    frames,
    groupId,
    canvasW: opts.canvasW,
    canvasH: opts.canvasH,
  };
}

/** Cover/contain place images into collage frame boxes (order = slot order). */
export function planStudioCollageImagePlacements(
  frames: readonly FitBox[],
  images: readonly StudioCollageImageSource[],
  fit: StudioCollageFitMode = "cover"
): StudioCollageImagePlacement[] {
  const count = Math.min(frames.length, images.length);
  const placements: StudioCollageImagePlacement[] = [];
  for (let i = 0; i < count; i++) {
    const frame = frames[i]!;
    const image = images[i]!;
    const box =
      fit === "contain"
        ? containFitInFrame(image, frame, 0)
        : coverFitInFrame(image, frame);
    placements.push({
      imageId: image.id,
      slotIndex: i,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }
  return placements;
}

/** Mini preview rects for a layout tile (viewBox 0..viewW × 0..viewH). */
export function studioCollagePreviewRects(
  layoutPreset: StudioCollageLayoutPreset,
  viewW = 56,
  viewH = 56,
  gap = 2,
  pad = 3
): Array<{ x: number; y: number; w: number; h: number }> {
  const contentW = Math.max(1, viewW - pad * 2);
  const contentH = Math.max(1, viewH - pad * 2);
  const half = gap / 2;
  return layoutPreset.slots.map((s) => {
    const rawX = pad + s.x * contentW;
    const rawY = pad + s.y * contentH;
    const rawW = s.w * contentW;
    const rawH = s.h * contentH;
    return {
      x: rawX + half,
      y: rawY + half,
      w: Math.max(1, rawW - gap),
      h: Math.max(1, rawH - gap),
    };
  });
}

/** Validate layout slots cover roughly the unit square without NaN. */
export function studioCollageLayoutIsValid(layoutPreset: StudioCollageLayoutPreset): boolean {
  if (!layoutPreset.slots.length) return false;
  for (const s of layoutPreset.slots) {
    if (![s.x, s.y, s.w, s.h].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
    if (s.w <= 0 || s.h <= 0) return false;
    if (s.x < -0.01 || s.y < -0.01 || s.x + s.w > 1.01 || s.y + s.h > 1.01) return false;
  }
  return layoutPreset.cells === layoutPreset.slots.length;
}
