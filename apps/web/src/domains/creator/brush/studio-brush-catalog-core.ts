/**
 * Launch-safe brush catalogue contract.
 *
 * Core brushes stay on the always-visible quick shelf. The 160 procedural descriptors live in
 * `studio-brush-catalog.ts` and load when a saved pro brush needs metadata or the full library opens.
 *
 * Counts are derived from the live catalogues — never hardcode historical totals in product copy.
 */
import {
  listStudioBrushTrayItems,
  listStudioQuickBrushTrayItems,
  type StudioBrushMediaGroup,
  type StudioBrushTrayItem,
  type StudioQuickBrushTrayItem,
} from "../studio-creative-ux";

import { STUDIO_BRUSH_MATERIAL_GROUP_LABELS } from "./studio-brush-material-group";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./studio-brush-pack-id";
import {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
} from "./studio-brush-quarantine";

import type { StudioToolOperation } from "../studio-brush";

export interface StudioBrushCatalogItem extends StudioBrushTrayItem {
  source: "core" | "pro";
}

export const STUDIO_CORE_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    listStudioBrushTrayItems("all").map((item) =>
      Object.freeze({ ...item, source: "core" as const })
    )
  );

export function listStudioCoreBrushCatalogItems(
  operation?: StudioToolOperation
): readonly StudioBrushCatalogItem[] {
  return operation === undefined
    ? STUDIO_CORE_BRUSH_CATALOG_ITEMS
    : STUDIO_CORE_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === operation);
}

/**
 * Resolution-complete core listing. The curated 48-tool default portfolio is a separate lazy UI
 * projection; exhaustive checks, saved-document lookup and explicit user pins retain every
 * non-quarantined core id here.
 */
export const STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_CORE_BRUSH_CATALOG_ITEMS.filter((item) => !isStudioBrushQuarantinedPresetId(item.id)),
  );

const STUDIO_CORE_ERASE_BRUSH_COUNT = STUDIO_CORE_BRUSH_CATALOG_ITEMS.filter(
  (item) => item.operation === "erase",
).length;

/** Registered catalogue totals, including quarantined ids retained for replay. */
export const STUDIO_BRUSH_CATALOG_COUNTS = Object.freeze({
  core: STUDIO_CORE_BRUSH_CATALOG_ITEMS.length,
  pro: STUDIO_BRUSH_PACK_CATALOG_IDS.length,
  total: STUDIO_CORE_BRUSH_CATALOG_ITEMS.length + STUDIO_BRUSH_PACK_CATALOG_IDS.length,
  erase: STUDIO_CORE_ERASE_BRUSH_COUNT,
  paint:
    STUDIO_CORE_BRUSH_CATALOG_ITEMS.length
    - STUDIO_CORE_ERASE_BRUSH_COUNT
    + STUDIO_BRUSH_PACK_CATALOG_IDS.length,
});

/**
 * Counts for the complete non-quarantined selectable/searchable inventory. Default quality
 * portfolio counts live in `studio-brush-quality-portfolio-counts.ts` and must not silently narrow
 * exhaustive browser or renderer-quality gates.
 */
const STUDIO_QUARANTINED_PRO_BRUSH_COUNT = STUDIO_BRUSH_QUARANTINED_PRESET_IDS.filter(
  (quarantinedId) => !STUDIO_CORE_BRUSH_CATALOG_ITEMS.some((item) => item.id === quarantinedId),
).length;

const STUDIO_LISTED_CORE_ERASE_BRUSH_COUNT = STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.filter(
  (item) => item.operation === "erase",
).length;

export const STUDIO_BRUSH_LISTED_CATALOG_COUNTS = Object.freeze({
  core: STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.length,
  pro: STUDIO_BRUSH_PACK_CATALOG_IDS.length - STUDIO_QUARANTINED_PRO_BRUSH_COUNT,
  total:
    STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.length
    + STUDIO_BRUSH_PACK_CATALOG_IDS.length
    - STUDIO_QUARANTINED_PRO_BRUSH_COUNT,
  erase: STUDIO_LISTED_CORE_ERASE_BRUSH_COUNT,
  paint:
    STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.length
    - STUDIO_LISTED_CORE_ERASE_BRUSH_COUNT
    + STUDIO_BRUSH_PACK_CATALOG_IDS.length
    - STUDIO_QUARANTINED_PRO_BRUSH_COUNT,
});

/** Material labels are owned by the derived material module. */
export const STUDIO_BRUSH_MEDIA_LABELS: Readonly<Record<StudioBrushMediaGroup, string>> =
  STUDIO_BRUSH_MATERIAL_GROUP_LABELS;

const STUDIO_CORE_BRUSH_CATALOG_BY_ID: ReadonlyMap<string, StudioBrushCatalogItem> =
  new Map(STUDIO_CORE_BRUSH_CATALOG_ITEMS.map((item) => [item.id, item]));

export function studioCoreBrushCatalogItemById(
  brushId: unknown
): StudioBrushCatalogItem | null {
  return typeof brushId === "string"
    ? STUDIO_CORE_BRUSH_CATALOG_BY_ID.get(brushId) ?? null
    : null;
}

export function studioBrushCatalogKindLabel(
  item: Pick<StudioBrushTrayItem, "mediaGroup" | "operation">
): string {
  if (item.operation === "erase") return "지우개";
  return STUDIO_BRUSH_MEDIA_LABELS[item.mediaGroup];
}

export function listStudioCoreQuickBrushCatalogItems(options: {
  catalogItems?: readonly StudioBrushTrayItem[];
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  limit?: number;
} = {}): StudioQuickBrushTrayItem[] {
  return listStudioQuickBrushTrayItems({
    ...options,
    // The launch fallback stays resolution-complete and non-quarantined. Once the lazy full
    // catalogue loads, product UI injects the compact default quality portfolio explicitly.
    catalogItems: options.catalogItems ?? STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS,
  });
}
