import { describe, expect, it } from "vitest";

import { MarketCreatorRevenueCalculator } from "./market-creator-revenue-calculator";

describe("MarketCreatorRevenueCalculator", () => {
  const calculator = new MarketCreatorRevenueCalculator();

  it("calculates standard tier payout with 20% platform fee and taxes", () => {
    const res = calculator.calculate({
      priceKrw: 50_000,
      creatorTier: "standard-creator",
    });

    expect(res.grossPriceKrw).toBe(50_000);
    expect(res.platformFeeRatePercent).toBe(20);
    expect(res.platformFeeKrw).toBe(10_000);
    expect(res.pgFeeKrw).toBe(1_650); // 50000 * 0.033
    expect(res.withholdingTaxKrw).toBeGreaterThan(1_200);
    expect(res.netCreatorPayoutKrw).toBeLessThan(40_000);
    expect(res.creatorEffectiveTakeRatePercent).toBeGreaterThan(70);
  });

  it("calculates pro-partner preferential tier with 10% platform fee", () => {
    const res = calculator.calculate({
      priceKrw: 50_000,
      creatorTier: "pro-partner",
    });

    expect(res.platformFeeRatePercent).toBe(10);
    expect(res.platformFeeKrw).toBe(5_000);
    expect(res.netCreatorPayoutKrw).toBeGreaterThan(40_000);
    expect(res.creatorEffectiveTakeRatePercent).toBeGreaterThan(80);
  });

  it("calculates boost tip passed directly to creator", () => {
    const res = calculator.calculate({
      priceKrw: 30_000,
      creatorTier: "pro-partner",
      boostTipKrw: 10_000,
    });

    expect(res.boostTipKrw).toBe(10_000);
    expect(res.grossPriceKrw).toBe(30_000);
    expect(res.platformFeeKrw).toBe(3_000); // 10% of 30,000 only, not tip
    expect(calculator.formatKrw(res.netCreatorPayoutKrw)).toContain("원");
  });
});
