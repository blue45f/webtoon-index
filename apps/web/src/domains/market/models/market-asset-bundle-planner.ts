/**
 * market-asset-bundle-planner.ts
 *
 * Webtoon Episode Kit & Multi-Asset Bundle Planner.
 * Benchmarks Acon3D All-in-One Season Packs and Clip Studio Complete Kits.
 *
 * - Combines 3D environments, props, character parts, brushes, and color palettes into
 *   a cohesive "Episode 1 Production Kit".
 * - Calculates bundle discount savings (typically 15%~35% off individual items).
 * - Computes scene readiness score to guarantee creators have all required visual components.
 */

export type BundleItemCategory = "background-3d" | "prop-3d" | "character-part" | "brush" | "palette" | "filter";

export interface BundleItemEntry {
  readonly id: string;
  readonly title: string;
  readonly category: BundleItemCategory;
  readonly individualPriceKrw: number;
  readonly byteSize: number;
}

export interface BundlePlanResult {
  readonly bundleTitle: string;
  readonly items: readonly BundleItemEntry[];
  readonly totalItemCount: number;
  readonly individualSumKrw: number;
  readonly bundleDiscountRatePercent: number;
  readonly bundlePriceKrw: number;
  readonly totalSavedKrw: number;
  readonly totalByteSize: number;
  readonly sceneReadinessScore: number; // 0..100%
  readonly categoriesCovered: readonly BundleItemCategory[];
}

export class MarketAssetBundlePlanner {
  /**
   * Plans and evaluates an all-in-one webtoon asset bundle.
   */
  public planBundle(
    bundleTitle: string,
    items: readonly BundleItemEntry[],
    customDiscountPercent?: number,
  ): BundlePlanResult {
    if (items.length === 0) {
      return {
        bundleTitle,
        items: [],
        totalItemCount: 0,
        individualSumKrw: 0,
        bundleDiscountRatePercent: 0,
        bundlePriceKrw: 0,
        totalSavedKrw: 0,
        totalByteSize: 0,
        sceneReadinessScore: 0,
        categoriesCovered: [],
      };
    }

    const individualSum = items.reduce((acc, item) => acc + item.individualPriceKrw, 0);
    const totalBytes = items.reduce((acc, item) => acc + item.byteSize, 0);

    // Dynamic discount rate based on item count:
    // 2 items: 15%, 3-4 items: 25%, 5+ items: 35%
    let discountRate = customDiscountPercent ?? 20;
    if (customDiscountPercent === undefined) {
      if (items.length >= 5) discountRate = 35;
      else if (items.length >= 3) discountRate = 25;
      else discountRate = 15;
    }

    const bundlePrice = Math.round(individualSum * (1 - discountRate / 100));
    const totalSaved = individualSum - bundlePrice;

    // Categories covered & scene readiness score
    const categorySet = new Set<BundleItemCategory>(items.map((i) => i.category));
    const categoriesCovered = Array.from(categorySet);

    // Full webtoon scene readiness:
    // Having background-3d (40pts) + prop-3d (25pts) + brush (20pts) + palette/filter (15pts) = 100pts
    let score = 0;
    if (categorySet.has("background-3d")) score += 40;
    if (categorySet.has("prop-3d")) score += 25;
    if (categorySet.has("brush")) score += 20;
    if (categorySet.has("palette") || categorySet.has("filter")) score += 15;

    return {
      bundleTitle,
      items,
      totalItemCount: items.length,
      individualSumKrw: individualSum,
      bundleDiscountRatePercent: discountRate,
      bundlePriceKrw: bundlePrice,
      totalSavedKrw: totalSaved,
      totalByteSize: totalBytes,
      sceneReadinessScore: Math.min(100, score),
      categoriesCovered,
    };
  }
}
