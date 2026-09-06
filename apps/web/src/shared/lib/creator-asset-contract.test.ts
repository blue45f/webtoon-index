import { describe, expect, it } from "vitest";

import {
  assertCreatorAssetListResponseBudget,
  CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
  CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES,
  CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE,
  CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS,
  creatorAssetSerializedResponseBytes,
  creatorAssetLicenseOf,
  normalizeCreatorAssetTags,
  parseCreatorAssetCatalogSort,
} from "./creator-asset-contract";

describe("creator asset marketplace contract", () => {
  it("태그를 NFKC 정규화하고 중복·개수·길이를 제한한다", () => {
    expect(normalizeCreatorAssetTags([" #배경 ", "배경", " 골목  야경 ", ...Array.from({ length: 12 }, (_, i) => `태그${i}`)]))
      .toEqual(["배경", "골목 야경", "태그0", "태그1", "태그2", "태그3", "태그4", "태그5"]);
  });

  it("알 수 없는 정렬·사용권은 안전한 기본값으로 정규화한다", () => {
    expect(parseCreatorAssetCatalogSort("popular")).toBe("popular");
    expect(parseCreatorAssetCatalogSort("bad")).toBe("newest");
    expect(creatorAssetLicenseOf("cc-by-4.0").attributionRequired).toBe(true);
    expect(creatorAssetLicenseOf("cc-by-4.0").url).toBe(
      "https://creativecommons.org/licenses/by/4.0/"
    );
    expect(creatorAssetLicenseOf("cc-by-nc-4.0")).toMatchObject({
      commercialUse: false,
      url: "https://creativecommons.org/licenses/by-nc/4.0/",
    });
    expect(creatorAssetLicenseOf("bad").id).toBe("toonspectrum-standard");
  });

  it("최대 catalog·moderation 페이지를 Vercel보다 낮은 4MB JSON 경계에 고정한다", () => {
    const previewDataUrl = `data:image/webp;base64,${"A".repeat(
      CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS - "data:image/webp;base64,".length
    )}`;
    const asset = {
      id: "a".repeat(160),
      name: "이".repeat(60),
      description: "설".repeat(500),
      tags: Array.from({ length: 8 }, () => "태".repeat(24)),
      previewDataUrl,
      previewWidth: 320,
      previewHeight: 320,
      previewAvailable: true,
      width: 4096,
      height: 4096,
      kind: "image",
      license: "cc-by-4.0",
      licenseLabel: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attributionRequired: true,
      commercialUse: true,
      attributionText: "출".repeat(160),
      containsAi: true,
      moderationStatus: "published",
      reportCount: 2_147_483_647,
      downloads: 2_147_483_647,
      author: { id: "u".repeat(160), name: "작".repeat(100), avatar: `#${"f".repeat(2047)}` },
      isOwner: false,
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    const catalog = {
      items: Array.from({ length: CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE }, (_, index) => ({
        ...asset,
        id: `${index}-${asset.id}`.slice(0, 160),
      })),
      limit: CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
      offset: 1_000_000,
      hasMore: true,
      nextOffset: 1_000_000 + CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
    };
    const moderation = Array.from(
      { length: CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE },
      (_, index) => ({
        reportId: `${index}-${"r".repeat(158)}`.slice(0, 160),
        reason: "copyright",
        details: "신".repeat(500),
        reportStatus: "open",
        reportedAt: "2026-07-20T00:00:00.000Z",
        reporter: { id: "u".repeat(160), name: "신고 회원", avatar: "#64748b" },
        asset: { ...asset, id: `${index}-${asset.id}`.slice(0, 160) },
      })
    );

    expect(CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE).toBe(20);
    expect(CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE).toBe(20);
    expect(creatorAssetSerializedResponseBytes(catalog)).toBeLessThanOrEqual(
      CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES
    );
    expect(creatorAssetSerializedResponseBytes(moderation)).toBeLessThanOrEqual(
      CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES
    );
    expect(() => assertCreatorAssetListResponseBudget(catalog)).not.toThrow();
    expect(() => assertCreatorAssetListResponseBudget(moderation)).not.toThrow();
    expect(() =>
      assertCreatorAssetListResponseBudget({ oversized: "x".repeat(CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES) })
    ).toThrow("안전한 전송 크기");
  });
});
