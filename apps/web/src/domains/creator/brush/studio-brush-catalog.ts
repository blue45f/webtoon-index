/**
 * Full built-in brush catalogue metadata.
 *
 * This module is a lazy boundary. Always-visible Studio chrome imports the launch-safe core
 * contract instead, while the library and persisted pro favorites load these 160 descriptors on
 * demand. The heavier procedural dynamics remain in `studio-brush-pack-runtime.ts`.
 */
import {
  listStudioQuickBrushTrayItems,
  type StudioBrushTrayCategory,
  type StudioBrushTrayItem,
  type StudioQuickBrushTrayItem,
} from "../studio-creative-ux";

import {
  STUDIO_BRUSH_CATALOG_COUNTS,
  STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  listStudioCoreBrushCatalogItems,
  studioBrushCatalogKindLabel,
  type StudioBrushCatalogItem,
} from "./studio-brush-catalog-core";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import {
  STUDIO_BRUSH_QUALITY_PORTFOLIO,
  STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS,
} from "./studio-brush-quality-portfolio";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";
import { filterStudioBrushLibraryItems } from "./studio-draw-ux";

import type { StudioToolOperation } from "../studio-brush";

export {
  STUDIO_BRUSH_CATALOG_COUNTS,
  STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  listStudioCoreBrushCatalogItems,
  studioBrushCatalogKindLabel,
};
export type { StudioBrushCatalogItem };

export const STUDIO_PRO_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_BRUSH_PACK_DESCRIPTORS.map((descriptor) =>
      Object.freeze({
        id: descriptor.catalogId,
        runtimeBrushId: descriptor.runtimeBrushId,
        name: descriptor.catalogName,
        shortName: descriptor.shortName,
        hint: descriptor.hint,
        defaultWidth: descriptor.defaultWidth,
        defaultOpacity: descriptor.defaultOpacity,
        operation: "paint" as const,
        category: "expressive" as const,
        mediaGroup: descriptor.mediaGroup,
        previewWeight: descriptor.previewWeight,
        previewStyle: descriptor.previewStyle,
        source: "pro" as const,
      })
    )
  );

export const STUDIO_ALL_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] = [
  ...STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  ...STUDIO_PRO_BRUSH_CATALOG_ITEMS,
];

export const STUDIO_PAINT_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "paint"));

export const STUDIO_ERASER_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "erase"));

const STUDIO_BRUSH_CATALOG_BY_ID: ReadonlyMap<string, StudioBrushCatalogItem> =
  new Map(STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => [item.id, item]));

export function studioBrushCatalogItemById(
  brushId: unknown
): StudioBrushCatalogItem | null {
  return typeof brushId === "string"
    ? STUDIO_BRUSH_CATALOG_BY_ID.get(brushId) ?? null
    : null;
}

/**
 * Resolution-complete selectable inventory. This keeps the historical `LISTED_ALL` contract used
 * by exhaustive browser, long-session and durability gates: every non-quarantined brush that a
 * user can reach through search or an explicit pin remains in this list.
 */
export const STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => !isStudioBrushQuarantinedPresetId(item.id)),
  );

/** Explicit alias for call sites that want to document search/expert-lane intent. */
export const STUDIO_SEARCHABLE_ALL_BRUSH_CATALOG_ITEMS =
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS;

export const STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "paint"),
  );

export const STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "erase"),
  );

function materializeDefaultQualityPortfolio(): readonly StudioBrushCatalogItem[] {
  const portfolio = STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => {
    const item = STUDIO_BRUSH_CATALOG_BY_ID.get(entry.id);
    if (!item) {
      throw new Error(`Studio quality portfolio references an unregistered brush: ${entry.id}`);
    }
    if (item.source !== entry.source) {
      throw new Error(
        `Studio quality portfolio source drift for ${entry.id}: ${item.source} != ${entry.source}`,
      );
    }
    if (isStudioBrushQuarantinedPresetId(item.id)) {
      throw new Error(`Studio quality portfolio cannot expose quarantined brush: ${item.id}`);
    }
    return item;
  });
  if (new Set(portfolio.map((item) => item.id)).size !== STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS.length) {
    throw new Error("Studio quality portfolio contains duplicate catalogue ids");
  }
  return Object.freeze(portfolio);
}

/**
 * Compact first-choice picker inventory. Absorbed variants are not deleted: the exhaustive listed
 * inventory, exact search, favorites, recent history and persisted documents retain their ids.
 */
export const STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  materializeDefaultQualityPortfolio();

export const STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "paint"),
  );

export const STUDIO_DEFAULT_QUALITY_ERASER_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  Object.freeze(
    STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.filter((item) => item.operation === "erase"),
  );

function operationInventory(
  operation: StudioToolOperation | undefined,
  exhaustive: boolean,
): readonly StudioBrushCatalogItem[] {
  const inventory = exhaustive
    ? STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS
    : STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS;
  return operation === undefined
    ? inventory
    : inventory.filter((item) => item.operation === operation);
}

export function filterStudioBrushCatalogItems(options: {
  operation?: StudioToolOperation;
  category?: StudioBrushTrayCategory | "favorites" | "recent";
  query?: string;
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
} = {}): StudioBrushCatalogItem[] {
  const { operation, ...libraryOptions } = options;
  const query = (libraryOptions.query ?? "").trim();
  const pinnedLane = libraryOptions.category === "favorites" || libraryOptions.category === "recent";
  // Search escapes material tabs, never a deliberately selected personal collection.
  const category = query && !pinnedLane ? "all" : libraryOptions.category;
  const exhaustive = Boolean(query) || pinnedLane || category === "all";
  return filterStudioBrushLibraryItems({
    ...libraryOptions,
    category,
    query,
    // Initial and material views use the compact portfolio. Search, user-owned pins, and the
    // explicit "전체" tab retain the complete non-quarantined inventory for compatibility and
    // exhaustive quality auditing.
    catalogItems: operationInventory(operation, exhaustive),
  }) as StudioBrushCatalogItem[];
}

function quickCatalogInventory(options: {
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  limit?: number;
}): readonly StudioBrushCatalogItem[] {
  const requestedIds = [...(options.favoriteIds ?? []), ...(options.recentIds ?? [])];
  const byId = new Map(
    STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map((item) => [item.id, item]),
  );
  for (const id of requestedIds) {
    const item = STUDIO_BRUSH_CATALOG_BY_ID.get(id);
    if (item && !isStudioBrushQuarantinedPresetId(item.id)) byId.set(item.id, item);
  }
  // Explicit large audit callers historically requested the complete shelf by setting a limit
  // larger than the compact portfolio. Preserve that diagnostic contract without expanding UI.
  if ((options.limit ?? 0) > STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.length) {
    return STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS;
  }
  return [...byId.values()];
}

export function listStudioQuickBrushCatalogItems(options: {
  catalogItems?: readonly StudioBrushTrayItem[];
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
  limit?: number;
} = {}): StudioQuickBrushTrayItem[] {
  return listStudioQuickBrushTrayItems({
    ...options,
    catalogItems: options.catalogItems ?? quickCatalogInventory(options),
  });
}
