/**
 * Studio Asset Catalog Enhancements: Recent, Frequency, Pinning, and Search Options Bar
 *
 * CLIP STUDIO PAINT Ver.5.0.0 & Ver.5.1.0 Parity:
 * 1. Recent Assets Tracking (최근 사용 소재):
 *    - Records timestamp whenever an asset is used/inserted into the canvas.
 * 2. Usage Frequency Sorting (사용 빈도순 정렬):
 *    - Tracks execution frequency counts per asset.
 * 3. Material Storage Location Display (소재 저장 위치 표시):
 *    - Distinguishes and shows origin paths (Local OPFS, Cloud Marketplace, Built-in 3D, Workspace cache).
 * 4. Pinned Assets at Top (상단 고정 핀):
 *    - Pinned assets stay anchored at the top across all sort views.
 * 5. Material Search Options Bar (소재 검색 옵션 바):
 *    - Multi-criteria filtering: Name, Category/Catalog, User Tags, License, AI origin.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface AssetUsageRecord {
  readonly assetId: string;
  readonly useCount: number;
  readonly lastUsedAt: number; // Unix timestamp ms
  readonly lastProjectId?: string;
}

export interface AssetSearchCriteria {
  readonly query?: string;
  readonly category?: string; // e.g. "brush", "3d", "palette", "template"
  readonly tag?: string;
  readonly license?: string; // e.g. "free", "standard", "commercial"
  readonly containsAi?: boolean;
  readonly onlyPinned?: boolean;
}

export interface EnhancedStudioAssetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly storageLocation: string; // e.g. "로컬 OPFS / 사용자 브러시"
  readonly createdAt: number;
  readonly license?: string;
  readonly containsAi?: boolean;
}

export interface AssetCatalogState {
  readonly usageRecords: Readonly<Record<string, AssetUsageRecord>>;
  readonly pinnedAssetIds: readonly string[];
}

export const EMPTY_ASSET_CATALOG_STATE: AssetCatalogState = Object.freeze({
  usageRecords: Object.freeze({}),
  pinnedAssetIds: Object.freeze([]),
});

/**
 * Records usage of an asset, updating count and last used timestamp.
 */
export function recordAssetUsage(
  state: AssetCatalogState,
  assetId: string,
  nowMs = Date.now(),
  projectId?: string,
): AssetCatalogState {
  const existing = state.usageRecords[assetId];
  const updated: AssetUsageRecord = {
    assetId,
    useCount: (existing?.useCount ?? 0) + 1,
    lastUsedAt: nowMs,
    lastProjectId: projectId ?? existing?.lastProjectId,
  };

  return Object.freeze({
    ...state,
    usageRecords: Object.freeze({
      ...state.usageRecords,
      [assetId]: Object.freeze(updated),
    }),
  });
}

/**
 * Toggles the pinned status of an asset.
 */
export function togglePinAsset(state: AssetCatalogState, assetId: string): AssetCatalogState {
  const isPinned = state.pinnedAssetIds.includes(assetId);
  const nextPinned = isPinned
    ? state.pinnedAssetIds.filter((id) => id !== assetId)
    : [...state.pinnedAssetIds, assetId];

  return Object.freeze({
    ...state,
    pinnedAssetIds: Object.freeze(nextPinned),
  });
}

export type AssetSortCriterion =
  | "newest"
  | "name"
  | "recent"
  | "frequency"
  | "popular";

/**
 * Filters and sorts assets with pinned items anchored at the top.
 */
export function filterAndSortAssets<T extends EnhancedStudioAssetItem>(
  assets: readonly T[],
  state: AssetCatalogState,
  criteria: AssetSearchCriteria,
  sort: AssetSortCriterion = "recent",
): readonly T[] {
  // 1. Filter
  const filtered = assets.filter((asset) => {
    if (criteria.onlyPinned && !state.pinnedAssetIds.includes(asset.id)) {
      return false;
    }
    if (criteria.query) {
      const q = criteria.query.toLowerCase().trim();
      const matchName = asset.name.toLowerCase().includes(q);
      const matchTag = asset.tags.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchTag) return false;
    }
    if (criteria.category && criteria.category !== "all" && asset.category !== criteria.category) {
      return false;
    }
    if (criteria.tag && !asset.tags.includes(criteria.tag)) {
      return false;
    }
    if (criteria.license && asset.license !== criteria.license) {
      return false;
    }
    if (typeof criteria.containsAi === "boolean" && asset.containsAi !== criteria.containsAi) {
      return false;
    }
    return true;
  });

  // 2. Separate into pinned and non-pinned
  const isPinned = (asset: T) => state.pinnedAssetIds.includes(asset.id);
  const pinnedList = filtered.filter(isPinned);
  const unpinnedList = filtered.filter((a) => !isPinned(a));

  // 3. Sort comparator
  const comparator = (a: T, b: T): number => {
    const recordA = state.usageRecords[a.id];
    const recordB = state.usageRecords[b.id];

    switch (sort) {
      case "recent": {
        const timeA = recordA?.lastUsedAt ?? 0;
        const timeB = recordB?.lastUsedAt ?? 0;
        if (timeA !== timeB) return timeB - timeA;
        return b.createdAt - a.createdAt;
      }
      case "frequency": {
        const countA = recordA?.useCount ?? 0;
        const countB = recordB?.useCount ?? 0;
        if (countA !== countB) return countB - countA;
        return a.name.localeCompare(b.name);
      }
      case "name":
        return a.name.localeCompare(b.name);
      case "newest":
      case "popular":
      default:
        return b.createdAt - a.createdAt;
    }
  };

  pinnedList.sort(comparator);
  unpinnedList.sort(comparator);

  return Object.freeze([...pinnedList, ...unpinnedList]);
}

/**
 * Resolves formatted human-readable storage location string.
 */
export function formatAssetStorageLocation(
  originKind: "opfs" | "cloud" | "builtin" | "external",
  pathOrFolder: string,
): string {
  switch (originKind) {
    case "opfs":
      return `로컬 저장소 (OPFS) › ${pathOrFolder}`;
    case "cloud":
      return `클라우드 마켓 에셋 › ${pathOrFolder}`;
    case "builtin":
      return `스튜디오 내장 에셋 › ${pathOrFolder}`;
    case "external":
      return `외부 임포트 › ${pathOrFolder}`;
  }
}
