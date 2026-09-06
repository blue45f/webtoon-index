import { describe, expect, it } from "vitest";

import {
  createStudioCommunityAssetCredit,
  formatStudioCommunityAssetCredit,
} from "./studio-community-asset-license";

describe("studio community asset license ledger", () => {
  it("fails closed when an asset response has no recognized license", () => {
    expect(createStudioCommunityAssetCredit({
      assetId: "asset-1",
      authorName: "작가",
      license: undefined,
    })).toBeNull();
  });

  it("persists CC BY attribution and its canonical license link", () => {
    const credit = createStudioCommunityAssetCredit({
      assetId: "asset-1",
      authorName: "작가",
      license: "cc-by-4.0",
      attributionText: "원저작자 표시",
    });

    expect(credit).toMatchObject({
      licenseId: "cc-by-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attributionRequired: true,
      commercialUse: true,
    });
    expect(formatStudioCommunityAssetCredit(credit!)).toContain("작품 내 편집·사용");
  });

  it("keeps the noncommercial restriction in generated publication credits", () => {
    const credit = createStudioCommunityAssetCredit({
      assetId: "asset-2",
      authorName: "NC 작가",
      license: "cc-by-nc-4.0",
    });

    expect(formatStudioCommunityAssetCredit(credit!)).toContain("비상업 전용");
  });
});
