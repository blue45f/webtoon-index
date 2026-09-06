import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { MarketResourceCard } from "./MarketResourceCard";

import type { CreatorMarketplaceResourceManifest } from "@/shared/lib/creator-marketplace-resource-contract";

import { createCreatorMarketplacePortableDelivery } from "@/src/infrastructure/creator-marketplace-client";



async function manifest(): Promise<CreatorMarketplaceResourceManifest> {
  const delivery = await createCreatorMarketplacePortableDelivery("palette", {
    colors: ["#1a1a2e", "#e94560"],
  });
  return {
    schemaVersion: 1,
    packageId: "original/palette/noir-blossom",
    name: "느와르 블라썸 팔레트",
    description: "밤의 도시 무드 팔레트",
    kind: "palette",
    resourceVersion: "1.1.0",
    minimumStudioVersion: "0.1.0",
    tags: ["야경", "느와르"],
    license: "cc-by-4.0",
    attributionText: "© 테스트 작가",
    containsAi: false,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: "palette/noir-blossom",
      kind: "palette",
      name: "느와르 블라썸",
      delivery,
    }],
  };
}

describe("MarketResourceCard", () => {
  it("종류·배급자·라이선스·태그와 상세 링크를 렌더링한다", async () => {
    const input = await manifest();
    const record = {
      ...input,
      id: "123e4567-e89b-42d3-a456-426614174000",
      manifestHash: "a".repeat(64),
      manifestByteSize: 256,
      publisher: { id: "author-1", name: "테스트 작가", avatar: null },
      createdAt: "2026-07-27T01:00:00.000Z",
      updatedAt: "2026-08-01T01:00:00.000Z",
      isOwner: false,
      access: "free" as const,
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketResourceCard record={record} />
      </MemoryRouter>
    );

    expect(html).toContain("PALETTE");
    expect(html).toContain("느와르 블라썸 팔레트");
    expect(html).toContain("테스트 작가");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain("#야경");
    expect(html).toContain(`href="/market/resource/${record.id}"`);
    expect(html).toContain("bg-canvas");
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-on-accent");
    expect(html).toContain("비교 목록에 추가");
    expect(html).not.toContain(">4.9<");
    expect(html).not.toContain("공식 인증 배급자");
    expect(html).not.toContain("text-white");
    expect(html).not.toContain("text-black");

    const brushHtml = renderToStaticMarkup(
      <MemoryRouter>
        <MarketResourceCard
          record={{
            ...record,
            kind: "brush",
            entries: record.entries.map((entry) => ({ ...entry, kind: "brush" as const })),
          }}
        />
      </MemoryRouter>,
    );
    expect(brushHtml).toContain("var(--color-card)");
    expect(brushHtml).toContain("var(--color-canvas)");
  });
});
