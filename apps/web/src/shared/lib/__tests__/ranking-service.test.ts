import { describe, expect, it } from "vitest";

import { getRankingData, normalizeRankingParams } from "../server/ranking-service";

import { makeTitle } from "./fixtures";

function query(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name] ?? null;
    },
  };
}

const now = () => new Date("2026-06-01T00:00:00.000Z");

// 실시간(live) 소스·스케줄러는 폐기됨(스냅샷 산식 운영). 랭킹은 커밋된 카탈로그에 대한 투명 산식만
// 사용하고, 외부 플랫폼을 런타임에 호출하지 않는다. 아래 테스트는 그 스냅샷 운영 계약을 고정한다.
describe("ranking service (snapshot 산식 운영)", () => {
  it("쿼리 파라미터를 안전하게 정규화한다", () => {
    const params = normalizeRankingParams(
      query({ axis: "bad", period: "bad", limit: "9999", minRating: "9", rising: "true" })
    );

    expect(params.axis).toBe("popular");
    expect(params.period).toBe("weekly");
    expect(params.limit).toBe(200);
    expect(params.minRating).toBe(5);
    expect(params.onlyRising).toBe(true);
  });

  it("limit 파라미터가 없으면 필터별 최대 노출 기준인 200건을 기본값으로 사용한다", () => {
    expect(normalizeRankingParams(query({})).limit).toBe(200);
  });

  it("플랫폼 필터는 전체 상위권 후처리가 아니라 필터 후보군에서 최대 200건을 반환한다", async () => {
    const naverTitles = Array.from({ length: 260 }, (_, index) =>
      makeTitle({
        id: `nw-dominant-${index}`,
        title: `네이버 상위 ${index}`,
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
        stats: { views: 900_000_000 - index * 1000, likes: 8_000_000, bookmarks: 8_000_000 },
      })
    );
    const lezhinTitles = Array.from({ length: 230 }, (_, index) =>
      makeTitle({
        id: `lz-filtered-${index}`,
        title: `레진 후보 ${index}`,
        availability: [{ platformId: "lezhin", pricing: "paid" }],
        stats: { views: 20_000 + index, likes: 900 + index, bookmarks: 800 + index },
      })
    );

    const data = await getRankingData(query({ platform: "lezhin", limit: "9999" }), {
      catalog: [...naverTitles, ...lezhinTitles],
      now,
    });

    expect(data.items).toHaveLength(200);
    expect(data.meta.total).toBe(230);
    expect(data.items.every((item) => item.title.availability.some((entry) => entry.platformId === "lezhin"))).toBe(
      true
    );
  });

  it("스냅샷 산식으로 응답한다(외부 실시간 소스 없음)", async () => {
    const data = await getRankingData(query({ axis: "popular", period: "daily", limit: "5" }), {
      catalog: [
        makeTitle({ id: "nw-a", type: "webtoon", availability: [{ platformId: "naver-webtoon", pricing: "free" }] }),
      ],
      now,
    });

    expect(data.meta.reliability.fallbackReason).toContain("스냅샷");
    expect(data.meta.reliability.basis).toContain("스냅샷 산식 운영 모드");
    expect(data.items.every((item) => item.evidence?.source === "formula")).toBe(true);
  });

  it("로컬 상태 필터(status)는 카탈로그 status 기준으로 적용된다", async () => {
    const data = await getRankingData(query({ axis: "popular", period: "weekly", status: "hiatus", limit: "5" }), {
      catalog: [
        makeTitle({ id: "nw-on", status: "ongoing", stats: { views: 50_000_000 } }),
        makeTitle({ id: "nw-hi", status: "hiatus", stats: { views: 10_000_000 } }),
      ],
      now,
    });

    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.title.id).toBe("nw-hi");
  });

  it("스냅샷 산식 모드는 결정적이다 — 같은 카탈로그·쿼리 두 번 → 동일 순서·동일 점수", async () => {
    const catalog = () => [
      makeTitle({ id: "a", stats: { popularityPercentile: 95, rankDelta: 12, trendingScore: 90 } }),
      makeTitle({ id: "b", stats: { popularityPercentile: 95, rankDelta: 0, trendingScore: 5, views: 700_000_000 } }),
      makeTitle({ id: "c", stats: { popularityPercentile: 40 } }),
    ];
    const q = query({ axis: "trending", period: "daily", limit: "10" });
    const first = await getRankingData(q, { catalog: catalog(), now });
    const second = await getRankingData(q, { catalog: catalog(), now });

    expect(first.items.map((item) => item.title.id)).toEqual(second.items.map((item) => item.title.id));
    expect(first.items.map((item) => item.score)).toEqual(second.items.map((item) => item.score));
  });

  it("양의 delta가 없으면 rising 인사이트를 null로 둔다(0을 상승으로 과장하지 않음)", async () => {
    const data = await getRankingData(query({ axis: "rating", period: "weekly", limit: "5" }), {
      catalog: [
        makeTitle({ id: "flat-a", stats: { rankDelta: 0 } }),
        makeTitle({ id: "flat-b", stats: { rankDelta: -3 } }),
      ],
      now,
    });

    expect(data.items.every((item) => item.delta === 0)).toBe(true);
    expect(data.insights.rising).toBeNull();
  });
});
