import { describe, expect, it } from "vitest";

import { marketBrowseJsonLd, marketHomeJsonLd, marketResourceJsonLd } from "./market-jsonld";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";


function record(overrides: Partial<CreatorMarketplaceResourceRecord> = {}): CreatorMarketplaceResourceRecord {
  return {
    schemaVersion: 1,
    packageId: "original/palette/noir",
    name: "느와르 팔레트",
    description: "밤의 무드",
    kind: "palette",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["야경"],
    license: "cc-by-4.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    id: "123e4567-e89b-42d3-a456-426614174000",
    manifestHash: "a".repeat(64),
    manifestByteSize: 128,
    publisher: { id: "author-1", name: "작가", avatar: null },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isOwner: false,
    access: "free",
    ...overrides,
  };
}

describe("market json-ld", () => {
  it("빈 목록은 주입하지 않는다(null)", () => {
    expect(marketHomeJsonLd([])).toBeNull();
    expect(marketBrowseJsonLd([], undefined)).toBeNull();
  });

  it("홈은 CollectionPage와 상세 URL이 담긴 ItemList를 만든다", () => {
    const ld = marketHomeJsonLd([record()])!;
    expect(ld["@type"]).toBe("CollectionPage");
    const list = ld.mainEntity as { itemListElement: Array<{ url: string }> };
    expect(list.itemListElement[0]!.url).toBe(
      "https://www.toonstudio.cloud/market/resource/123e4567-e89b-42d3-a456-426614174000"
    );
  });

  it("탐색은 종류 라벨이 붙은 ItemList를 만든다", () => {
    const ld = marketBrowseJsonLd([record()], "palette")!;
    expect(ld.name).toContain("팔레트");
    expect(ld["@type"]).toBe("ItemList");
  });

  it("상세는 배급자·라이선스·수정일을 CreativeWork로 노출한다", () => {
    const ld = marketResourceJsonLd(record());
    expect(ld["@type"]).toBe("CreativeWork");
    expect(ld.isAccessibleForFree).toBe(true);
    expect((ld.author as { name: string }).name).toBe("작가");
    expect(ld.license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(ld.dateModified).toBe("2026-08-23T00:00:00.000Z");
    expect(ld.version).toBe("1.0.0");
    const page = ld.mainEntityOfPage as {
      breadcrumb: { itemListElement: Array<{ name: string; item: string }> };
    };
    expect(page.breadcrumb.itemListElement.map((item) => item.name)).toEqual([
      "창작 마켓",
      "마켓 탐색",
      "느와르 팔레트",
    ]);
    expect(page.breadcrumb.itemListElement[2]?.item).toBe(
      "https://www.toonstudio.cloud/market/resource/123e4567-e89b-42d3-a456-426614174000",
    );
    expect(ld.additionalProperty).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "최소 Studio 버전", value: "0.1.0" }),
      expect.objectContaining({ name: "호환 엔진", value: "canvas2d" }),
    ]));
  });

  it("표준 사용권은 사이트 약관 URL로 폴백한다", () => {
    const ld = marketResourceJsonLd(record({ license: "toonspectrum-standard" }));
    expect(ld.license).toBe("https://www.toonstudio.cloud/terms");
  });
});
