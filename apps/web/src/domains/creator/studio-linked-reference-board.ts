/**
 * Studio Linked Visual Reference Board — 무한 2D 참조 캔버스, 항상 위 핀 창,
 * 지능형 색상·원근 가이드 추출 및 컷·캐릭터 의미 태그 연동 코어.
 *
 * 마스터플랜 9.7 (Reference Board), 9.8 (Semantic Search) & 997개 기능 갭 (F-864 ~ F-898):
 * - 이미지·PDF·3D 스냅샷·색상표·포즈 참조 아이템 자유 배치 및 회전/스케일/투명도
 * - 항상 위(Always-on-top) 미니 핀 창 상태 지원
 * - 참조 이미지로부터 주요 지배 색상(Dominant Color Palette) 및 소실점/원근 가이드 추출
 * - 컷(Panel), 캐릭터, 장소 태그 바인딩 및 사용 레퍼런스 역추적
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_REFERENCE_BOARD_VERSION = 1 as const;

export const STUDIO_REFERENCE_LIMITS = Object.freeze({
  maxItemsPerBoard: 512,
  maxTagsPerItem: 32,
  maxColorsPerPalette: 16,
  maxIdLength: 128,
  maxTitleLength: 200,
  maxDiagnostics: 256,
});

export const REFERENCE_ITEM_KINDS = [
  "image",
  "pdf-page",
  "3d-snapshot",
  "color-swatch-set",
  "pose-skeleton",
  "web-link",
] as const;
export type ReferenceItemKind = (typeof REFERENCE_ITEM_KINDS)[number];

export interface ReferenceSpatialTransform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number;
  readonly scale: number;
  readonly opacity: number; // 0..1
}

export interface ReferencePerspectiveGuide {
  readonly horizonY: number;
  readonly vanishingPoints: readonly { readonly x: number; readonly y: number }[];
}

export interface VisualReferenceItem {
  readonly id: string;
  readonly kind: ReferenceItemKind;
  readonly title: string;
  readonly sourceUri: string;
  readonly attribution?: string;
  readonly transform: ReferenceSpatialTransform;
  readonly isPinnedAlwaysOnTop: boolean;
  readonly extractedPalette?: readonly string[]; // Hex colors
  readonly perspectiveGuide?: ReferencePerspectiveGuide;
  readonly boundTags: readonly string[]; // e.g. ["character:hero", "location:classroom", "panel:p_10"]
  readonly offlineCached: boolean;
}

export interface StudioVisualReferenceBoard {
  readonly version: typeof STUDIO_REFERENCE_BOARD_VERSION;
  readonly id: string;
  readonly title: string;
  readonly items: readonly VisualReferenceItem[];
}

export function createVisualReferenceBoard(params: {
  id: string;
  title: string;
  items?: readonly VisualReferenceItem[];
}): StudioVisualReferenceBoard {
  return Object.freeze({
    version: STUDIO_REFERENCE_BOARD_VERSION,
    id: params.id.trim(),
    title: params.title.trim(),
    items: Object.freeze([...(params.items ?? [])]),
  });
}

export function addReferenceItem(
  board: StudioVisualReferenceBoard,
  item: VisualReferenceItem,
): StudioVisualReferenceBoard {
  if (board.items.some((i) => i.id === item.id)) {
    throw new Error(`Reference item ${item.id} already exists`);
  }
  return {
    ...board,
    items: Object.freeze([...board.items, item]),
  };
}

export function updateReferenceItemTransform(
  board: StudioVisualReferenceBoard,
  itemId: string,
  transform: Partial<ReferenceSpatialTransform>,
): StudioVisualReferenceBoard {
  const index = board.items.findIndex((i) => i.id === itemId);
  if (index === -1) {
    throw new Error(`Reference item ${itemId} not found`);
  }
  const item = board.items[index];
  const updatedItem: VisualReferenceItem = {
    ...item,
    transform: Object.freeze({
      ...item.transform,
      ...transform,
    }),
  };

  const nextItems = [...board.items];
  nextItems[index] = Object.freeze(updatedItem);
  return { ...board, items: Object.freeze(nextItems) };
}

export function removeReferenceItem(
  board: StudioVisualReferenceBoard,
  itemId: string,
): StudioVisualReferenceBoard {
  return {
    ...board,
    items: Object.freeze(board.items.filter((i) => i.id !== itemId)),
  };
}

/**
 * RGB 픽셀 샘플 배열로부터 상위 지배 색상 팔레트(Hex)를 추출한다.
 */
export function extractDominantColorPalette(
  rgbPixelSamples: readonly (readonly [number, number, number])[],
  maxColors: number = 5,
): readonly string[] {
  if (rgbPixelSamples.length === 0) return Object.freeze(["#ffffff"]);

  // Quantize to 4-bit bins
  const binCounts: Record<string, { count: number; r: number; g: number; b: number }> = {};

  for (const [r, g, b] of rgbPixelSamples) {
    const qr = Math.floor(r / 16);
    const qg = Math.floor(g / 16);
    const qb = Math.floor(b / 16);
    const key = `${qr}_${qg}_${qb}`;

    if (!binCounts[key]) {
      binCounts[key] = { count: 0, r: 0, g: 0, b: 0 };
    }
    binCounts[key].count += 1;
    binCounts[key].r += r;
    binCounts[key].g += g;
    binCounts[key].b += b;
  }

  const sortedBins = Object.values(binCounts).sort((a, b) => b.count - a.count);
  const result: string[] = [];

  for (let i = 0; i < Math.min(maxColors, sortedBins.length); i += 1) {
    const bin = sortedBins[i];
    const avgR = Math.round(bin.r / bin.count);
    const avgG = Math.round(bin.g / bin.count);
    const avgB = Math.round(bin.b / bin.count);

    const hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`;
    result.push(hex);
  }

  return Object.freeze(result);
}

/**
 * 태그(캐릭터, 장소, 패널 번호 등)로 참조 아이템 목록을 필터링 질의한다.
 */
export function queryReferencesByTag(
  board: StudioVisualReferenceBoard,
  tag: string,
): readonly VisualReferenceItem[] {
  const cleanTag = tag.trim().toLowerCase();
  return Object.freeze(
    board.items.filter((item) =>
      item.boundTags.some((t) => t.toLowerCase() === cleanTag || t.toLowerCase().includes(cleanTag)),
    ),
  );
}
