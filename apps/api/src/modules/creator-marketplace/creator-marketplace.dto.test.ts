import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";

import {
  CreatorMarketplaceModerationQuerySchema,
  CreatorMarketplaceOwnedHistoryQuerySchema,
  CreatorMarketplaceResourceHistoryQuerySchema,
  CreatorMarketplaceResourceListQuerySchema,
  CreatorMarketplaceResourceParamsSchema,
  DismissCreatorMarketplaceOrphanReportSchema,
  ModerateCreatorMarketplaceResourceSchema,
  ReportCreatorMarketplaceResourceSchema,
} from "./creator-marketplace.dto";

describe("creator marketplace DTO contracts", () => {
  it("목록 쿼리를 제한하고 unknown query를 거절한다", () => {
    expect(CreatorMarketplaceResourceListQuerySchema.parse({
      limit: "12",
      kind: "brush",
      license: "cc0-1.0",
      search: " 잉크 ",
      sort: "relevance",
    })).toMatchObject({
      limit: 12,
      kind: "brush",
      license: "cc0-1.0",
      search: "잉크",
      sort: "relevance",
    });
    expect(
      CreatorMarketplaceResourceListQuerySchema.safeParse({
        limit: 21,
        paid: "1",
      }).success
    ).toBe(false);
  });

  it("관련도순은 유효한 검색어와 함께만 허용한다", () => {
    expect(CreatorMarketplaceResourceListQuerySchema.parse({
      search: "잉크",
      sort: "relevance",
    })).toMatchObject({ search: "잉크", sort: "relevance" });
    expect(CreatorMarketplaceResourceListQuerySchema.safeParse({
      sort: "relevance",
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceListQuerySchema.safeParse({
      search: "잉크",
      sort: "popular",
    }).success).toBe(false);
  });

  it("base64url 커서와 UUID resource id만 허용한다", () => {
    expect(
      CreatorMarketplaceResourceListQuerySchema.safeParse({ cursor: "abc_DEF-123" }).success
    ).toBe(true);
    expect(
      CreatorMarketplaceResourceListQuerySchema.safeParse({ cursor: "not+base64" }).success
    ).toBe(false);
    expect(
      CreatorMarketplaceResourceParamsSchema.safeParse({
        id: "123e4567-e89b-42d3-a456-426614174000",
      }).success
    ).toBe(true);
    expect(CreatorMarketplaceResourceParamsSchema.safeParse({ id: "../asset" }).success).toBe(
      false
    );
  });

  it("package history는 bounded ordinal cursor를 쓰고 owner packageId를 필수로 한다", () => {
    expect(CreatorMarketplaceResourceHistoryQuerySchema.parse({
      limit: "5",
      cursor: "12",
    })).toEqual({ limit: 5, cursor: 12 });
    expect(CreatorMarketplaceResourceHistoryQuerySchema.safeParse({
      cursor: "12.5",
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceHistoryQuerySchema.safeParse({
      cursor: "0",
    }).success).toBe(false);
    expect(CreatorMarketplaceOwnedHistoryQuerySchema.parse({
      packageId: "publisher/brush/ink",
    })).toEqual({
      packageId: "publisher/brush/ink",
      limit: 20,
    });
    expect(CreatorMarketplaceOwnedHistoryQuerySchema.safeParse({}).success).toBe(false);
    expect(CreatorMarketplaceOwnedHistoryQuerySchema.safeParse({
      packageId: "../private",
    }).success).toBe(false);
  });

  it("공개 배급자 필터는 UUID만 허용한다", () => {
    expect(
      CreatorMarketplaceResourceListQuerySchema.parse({
        publisher: "123e4567-e89b-42d3-a456-426614174000",
      })
    ).toMatchObject({ publisher: "123e4567-e89b-42d3-a456-426614174000" });
    expect(
      CreatorMarketplaceResourceListQuerySchema.safeParse({ publisher: "not-a-uuid" }).success
    ).toBe(false);
  });

  it("공유 쿼리 상수와 동일한 검색어·태그 경계를 적용한다", () => {
    const boundary = CreatorMarketplaceResourceListQuerySchema.parse({
      search: "s".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS),
      tag: "t".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS),
    });
    expect(boundary.search).toHaveLength(
      CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS
    );
    expect(boundary.tag).toHaveLength(
      CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS
    );

    expect(CreatorMarketplaceResourceListQuerySchema.safeParse({
      search: "s".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS + 1),
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceListQuerySchema.safeParse({
      tag: "t".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS + 1),
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceListQuerySchema.safeParse({
      search: `ink${String.fromCharCode(0)}`,
    }).success).toBe(false);
  });

  it("신고 사유·증거 설명을 strict bounded contract로 제한한다", () => {
    expect(ReportCreatorMarketplaceResourceSchema.parse({
      reason: "copyright",
      details: "  권리자 표기 확인 필요  ",
    })).toEqual({ reason: "copyright", details: "권리자 표기 확인 필요" });
    expect(ReportCreatorMarketplaceResourceSchema.safeParse({
      reason: "revenge",
    }).success).toBe(false);
    expect(ReportCreatorMarketplaceResourceSchema.safeParse({
      reason: "unsafe",
      details: "x".repeat(501),
    }).success).toBe(false);
    expect(ReportCreatorMarketplaceResourceSchema.safeParse({
      reason: "spam",
      hidden: true,
    }).success).toBe(false);
  });

  it("관리자 queue와 lifecycle action 조합만 허용한다", () => {
    expect(CreatorMarketplaceModerationQuerySchema.parse({})).toEqual({
      status: "open",
      limit: 50,
      offset: 0,
    });
    expect(CreatorMarketplaceModerationQuerySchema.safeParse({
      status: "pending",
    }).success).toBe(false);
    expect(ModerateCreatorMarketplaceResourceSchema.parse({
      action: "hide",
      sourceReportId: "123e4567-e89b-42d3-a456-426614174099",
      note: "  저작권 침해 확인  ",
    })).toEqual({
      action: "hide",
      sourceReportId: "123e4567-e89b-42d3-a456-426614174099",
      note: "저작권 침해 확인",
    });
    expect(ModerateCreatorMarketplaceResourceSchema.safeParse({
      action: "hide",
      sourceReportId: "not-a-report-id",
      note: "침해 확인",
    }).success).toBe(false);
    expect(ModerateCreatorMarketplaceResourceSchema.safeParse({
      action: "hide",
      note: "",
    }).success).toBe(false);
    expect(ModerateCreatorMarketplaceResourceSchema.safeParse({
      action: "delete",
      note: "삭제",
    }).success).toBe(false);
    expect(DismissCreatorMarketplaceOrphanReportSchema.parse({
      action: "dismiss",
      note: "  삭제된 리소스 신고 종결  ",
    })).toEqual({ action: "dismiss", note: "삭제된 리소스 신고 종결" });
    expect(DismissCreatorMarketplaceOrphanReportSchema.safeParse({
      action: "hide",
      note: "숨김",
    }).success).toBe(false);
  });
});
