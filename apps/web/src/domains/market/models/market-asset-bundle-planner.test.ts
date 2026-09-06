import { describe, expect, it } from "vitest";

import {
  MarketAssetBundlePlanner,
  type BundleItemEntry,
} from "./market-asset-bundle-planner";

describe("MarketAssetBundlePlanner", () => {
  const planner = new MarketAssetBundlePlanner();

  it("handles empty items gracefully", () => {
    const res = planner.planBundle("빈 번들", []);
    expect(res.totalItemCount).toBe(0);
    expect(res.bundlePriceKrw).toBe(0);
    expect(res.sceneReadinessScore).toBe(0);
  });

  it("calculates multi-category bundle discount and scene readiness score", () => {
    const items: BundleItemEntry[] = [
      { id: "1", title: "황실 연회장 3D 대강당", category: "background-3d", individualPriceKrw: 35_000, byteSize: 45_000_000 },
      { id: "2", title: "크리스탈 샹들리에 & 촛대 세트", category: "prop-3d", individualPriceKrw: 12_000, byteSize: 8_000_000 },
      { id: "3", title: "귀족 레이스 장식 브러시", category: "brush", individualPriceKrw: 8_000, byteSize: 2_000_000 },
      { id: "4", title: "황실 로판 무드 팔레트", category: "palette", individualPriceKrw: 5_000, byteSize: 50_000 },
    ];

    const res = planner.planBundle("황실 로맨스 1화 풀패키지", items);

    expect(res.totalItemCount).toBe(4);
    expect(res.individualSumKrw).toBe(60_000);
    expect(res.bundleDiscountRatePercent).toBe(25); // 4 items -> 25% discount
    expect(res.bundlePriceKrw).toBe(45_000); // 60,000 * 0.75
    expect(res.totalSavedKrw).toBe(15_000);
    expect(res.sceneReadinessScore).toBe(100); // 40 + 25 + 20 + 15 = 100
    expect(res.categoriesCovered).toHaveLength(4);
  });

  it("allows custom discount percentage override", () => {
    const items: BundleItemEntry[] = [
      { id: "1", title: "A", category: "brush", individualPriceKrw: 10_000, byteSize: 100 },
      { id: "2", title: "B", category: "brush", individualPriceKrw: 10_000, byteSize: 100 },
    ];

    const res = planner.planBundle("브러시 듀오", items, 50);
    expect(res.bundleDiscountRatePercent).toBe(50);
    expect(res.bundlePriceKrw).toBe(10_000);
  });
});
