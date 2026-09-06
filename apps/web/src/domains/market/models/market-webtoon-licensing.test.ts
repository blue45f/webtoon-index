import { describe, expect, it } from "vitest";

import { MarketWebtoonLicensingEngine } from "./market-webtoon-licensing";

describe("MarketWebtoonLicensingEngine", () => {
  const engine = new MarketWebtoonLicensingEngine();

  it("provides terms for all 4 licensing tiers", () => {
    const solo = engine.getTerms("solo-creator");
    expect(solo.maxSeats).toBe(1);
    expect(solo.allowCommercialWebtoonPublishing).toBe(true);
    expect(solo.isNoAiProtected).toBe(true);

    const team = engine.getTerms("studio-team");
    expect(team.maxSeats).toBe(5);

    const corp = engine.getTerms("corporate-agency");
    expect(corp.maxSeats).toBe(-1);
  });

  it("calculates tiered multiplier pricing based on industry standards", () => {
    const base = 20_000;
    expect(engine.calculateTierPrice(base, "solo-creator")).toBe(20_000);
    expect(engine.calculateTierPrice(base, "studio-team")).toBe(50_000); // 2.5x
    expect(engine.calculateTierPrice(base, "corporate-agency")).toBe(100_000); // 5.0x
    expect(engine.calculateTierPrice(base, "open-cc0")).toBe(0);
  });

  it("detects compliance violations when seat count is exceeded", () => {
    const res = engine.verifyCompliance("solo-creator", 3, false);
    expect(res.isCompliant).toBe(false);
    expect(res.violationReason).toContain("허용 인원");
  });

  it("strictly prohibits raw asset resale for non-cc0 tiers", () => {
    const res = engine.verifyCompliance("studio-team", 2, true);
    expect(res.isCompliant).toBe(false);
    expect(res.violationReason).toContain("재판매");
  });
});
