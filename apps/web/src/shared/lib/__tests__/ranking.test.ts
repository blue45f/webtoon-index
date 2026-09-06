import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { rankBy, rankingItemListJsonLd, deriveBayesPrior, DEFAULT_BAYES_PRIOR } from "../ranking";

import { makeTitle } from "./fixtures";

describe("rankBy", () => {
  it("정렬: 인기축은 교차-플랫폼 인기 백분위가 높은 작품이 위로", () => {
    // 인기 점수는 플랫폼별로 정규화한 인기 백분위(popularityPercentile, 카탈로그 로드 시 계산)를
    // 지수감쇠로 반영한다 — 특정 플랫폼의 절대 조회수가 아니라 '플랫폼 내 상위권'을 본다.
    const low = makeTitle({ id: "low", stats: { popularityPercentile: 8 } });
    const high = makeTitle({ id: "high", stats: { popularityPercentile: 100 } });
    const ranked = rankBy([low, high], "popular", { period: "all" });
    expect(ranked[0].title.id).toBe("high");
    expect(ranked[0].rank).toBe(1);
  });

  it("평점축: 베이즈 보정으로 표본 적은 만점작이 표본 많은 고득점작을 못 이긴다", () => {
    const fewPerfect = makeTitle({ id: "few", stats: { ratingAvg: 5.0, ratingCount: 30 } });
    const manyHigh = makeTitle({ id: "many", stats: { ratingAvg: 4.9, ratingCount: 50_000 } });
    const ranked = rankBy([fewPerfect, manyHigh], "rating", { period: "all" });
    expect(ranked[0].title.id).toBe("many");
  });

  it("완결축: 완결작만 포함", () => {
    const done = makeTitle({ id: "done", status: "completed" });
    const ongoing = makeTitle({ id: "ongoing", status: "ongoing" });
    const ranked = rankBy([done, ongoing], "completed", { period: "all" });
    expect(ranked.map((r) => r.title.id)).toEqual(["done"]);
  });

  it("신작축: 2022년 이후만 포함", () => {
    const fresh = makeTitle({ id: "fresh", releaseYear: 2024 });
    const old = makeTitle({ id: "old", releaseYear: 2015 });
    const ranked = rankBy([fresh, old], "rookie", { period: "all" });
    expect(ranked.map((r) => r.title.id)).toEqual(["fresh"]);
  });

  it("유형 필터: 웹소설만", () => {
    const toon = makeTitle({ id: "toon", type: "webtoon" });
    const novel = makeTitle({ id: "novel", type: "webnovel" });
    const ranked = rankBy([toon, novel], "popular", { period: "all", type: "webnovel" });
    expect(ranked.map((r) => r.title.id)).toEqual(["novel"]);
  });

  it("limit 적용", () => {
    const list = Array.from({ length: 10 }, (_, i) => makeTitle({ id: `n${i}` }));
    expect(rankBy(list, "popular", { period: "all", limit: 3 })).toHaveLength(3);
  });

  it("관심 폭발축: 관심(bookmarks) 많은 작품이 위로", () => {
    const a = makeTitle({ id: "a", stats: { bookmarks: 50 } });
    const b = makeTitle({ id: "b", stats: { bookmarks: 5_000_000 } });
    expect(rankBy([a, b], "favorites", { period: "all" })[0].title.id).toBe("b");
  });

  it("숨은 명작축: 같은 고평점이면 조회 적은 쪽이 위 + 평가 적으면 제외", () => {
    const lowViews = makeTitle({ id: "low", stats: { ratingAvg: 4.8, ratingCount: 5000, views: 10_000 } });
    const highViews = makeTitle({ id: "high", stats: { ratingAvg: 4.8, ratingCount: 5000, views: 500_000_000 } });
    const tooFew = makeTitle({ id: "few", stats: { ratingAvg: 5.0, ratingCount: 100, views: 1000 } });
    const ranked = rankBy([lowViews, highViews, tooFew], "hidden", { period: "all" });
    const ids = ranked.map((r) => r.title.id);
    expect(ids).not.toContain("few"); // ratingCount < 300 제외
    expect(ids.indexOf("low")).toBeLessThan(ids.indexOf("high"));
  });

  it("장르 필터: 해당 장르만", () => {
    const r = makeTitle({ id: "r", genres: ["로맨스"] });
    const f = makeTitle({ id: "f", genres: ["판타지"] });
    const ranked = rankBy([r, f], "popular", { period: "all", genre: "로맨스" });
    expect(ranked.map((x) => x.title.id)).toEqual(["r"]);
  });

  it("플랫폼 필터: 해당 플랫폼 가용성만", () => {
    const naver = makeTitle({ id: "n", availability: [{ platformId: "naver-webtoon", pricing: "free" }] });
    const kakao = makeTitle({ id: "k", availability: [{ platformId: "kakao-webtoon", pricing: "wait-free" }] });
    const ranked = rankBy([naver, kakao], "popular", { period: "all", platform: "kakao-webtoon" });
    expect(ranked.map((x) => x.title.id)).toEqual(["k"]);
  });
});

describe("기간별 신호 블렌딩 (가짜 wobble 제거)", () => {
  // 모멘텀형: 실 순위상승·트렌드는 최대, 누적(조회·관심)은 평범.
  const momentumTitle = () =>
    makeTitle({
      id: "momentum",
      status: "ongoing",
      updateDays: ["월"],
      stats: {
        popularityPercentile: 95,
        rankDelta: 15,
        trendingScore: 100,
        views: 1_000_000,
        bookmarks: 100_000,
        ratingAvg: 4.4,
        ratingCount: 10_000,
      },
    });
  // 누적형: 변동은 없지만 조회·관심·평점 누적이 압도적.
  const cumulativeTitle = () =>
    makeTitle({
      id: "cumulative",
      status: "ongoing",
      updateDays: ["화"],
      stats: {
        popularityPercentile: 95,
        rankDelta: 0,
        trendingScore: 0,
        views: 800_000_000,
        bookmarks: 5_000_000,
        ratingAvg: 4.8,
        ratingCount: 100_000,
      },
    });

  it("결정적: 같은 입력 두 번 → 동일 순서·동일 점수", () => {
    const pool = () => [momentumTitle(), cumulativeTitle(), makeTitle({ id: "filler" })];
    const a = rankBy(pool(), "popular", { period: "daily" });
    const b = rankBy(pool(), "popular", { period: "daily" });
    expect(a.map((r) => r.title.id)).toEqual(b.map((r) => r.title.id));
    expect(a.map((r) => r.score)).toEqual(b.map((r) => r.score));
  });

  it("일간은 단기 모멘텀(실 순위상승·트렌드) 우위, 월간/전체는 누적(조회·관심·평점) 우위 — 신호 차이지 wobble이 아니다", () => {
    const daily = rankBy([momentumTitle(), cumulativeTitle()], "popular", { period: "daily" });
    const monthly = rankBy([momentumTitle(), cumulativeTitle()], "popular", { period: "monthly" });
    const all = rankBy([momentumTitle(), cumulativeTitle()], "popular", { period: "all" });
    expect(daily[0].title.id).toBe("momentum");
    expect(monthly[0].title.id).toBe("cumulative");
    expect(all[0].title.id).toBe("cumulative");
  });

  it("랭킹 모듈은 seededRandom/Math.random을 호출·임포트하지 않는다(소스 검증)", () => {
    const source = readFileSync(fileURLToPath(new URL("../ranking.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/seededRandom\s*\(/); // 호출 없음 (과거 wobble 폐기 — 주석 언급은 허용)
    expect(source).not.toMatch(/import[^;]*seededRandom/); // 임포트 없음
    expect(source).not.toContain("Math.random");
  });
});

describe("연재 신선도 (popular/trending)", () => {
  const base = {
    stats: { popularityPercentile: 90, rankDelta: 0, trendingScore: 50 },
  };

  it("인기축: 연재중 + 연재요일 보유 작품이 동일 조건 완결작보다 위(완결도 포함은 유지)", () => {
    const ongoing = makeTitle({ id: "ongoing", status: "ongoing", updateDays: ["수"], ...base });
    const done = makeTitle({ id: "done", status: "completed", ...base });
    const ranked = rankBy([done, ongoing], "popular", { period: "weekly" });
    expect(ranked.map((r) => r.title.id)).toEqual(["ongoing", "done"]);
  });

  it("인기축: 연재요일이 확인되는 연재작이 요일 미상 연재작보다 위", () => {
    const withDays = makeTitle({ id: "with-days", status: "ongoing", updateDays: ["금"], ...base });
    const noDays = makeTitle({ id: "no-days", status: "ongoing", updateDays: [], ...base });
    expect(rankBy([noDays, withDays], "popular", { period: "weekly" })[0].title.id).toBe("with-days");
  });

  it("급상승축: 완결작은 제외하지 않되 분명히 감쇠, 휴재작도 감쇠", () => {
    const ongoing = makeTitle({ id: "t-ongoing", status: "ongoing", updateDays: ["월"], ...base });
    const hiatus = makeTitle({ id: "t-hiatus", status: "hiatus", ...base });
    const done = makeTitle({ id: "t-done", status: "completed", ...base });
    const ranked = rankBy([done, hiatus, ongoing], "trending", { period: "weekly" });
    expect(ranked.map((r) => r.title.id)).toEqual(["t-ongoing", "t-hiatus", "t-done"]);
    expect(ranked).toHaveLength(3); // 완결 제외 대신 감쇠
  });
});

describe("베이즈 사전값(C·m) 카탈로그 유도", () => {
  it("C=평가수 가중 평균 평점, m=평가수 중앙값으로 유도된다", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      makeTitle({ id: `p${i}`, stats: { ratingAvg: 4.2, ratingCount: 1000 } })
    );
    const prior = deriveBayesPrior(pool);
    expect(prior.c).toBeCloseTo(4.2, 5);
    expect(prior.m).toBe(1000);
  });

  it("극단 분포는 정상 범위로 클램프된다 (C∈[3.2,4.6], m∈[50,5000])", () => {
    const inflated = Array.from({ length: 10 }, (_, i) =>
      makeTitle({ id: `hi${i}`, stats: { ratingAvg: 5.0, ratingCount: 80_000 } })
    );
    const deflated = Array.from({ length: 10 }, (_, i) =>
      makeTitle({ id: `lo${i}`, stats: { ratingAvg: 1.2, ratingCount: 3 } })
    );
    expect(deriveBayesPrior(inflated)).toEqual({ c: 4.6, m: 5000 });
    expect(deriveBayesPrior(deflated)).toEqual({ c: 3.2, m: 50 });
  });

  it("평가 보유작이 8편 미만이면 기본값으로 폴백한다", () => {
    const tiny = [makeTitle({ id: "a" }), makeTitle({ id: "b" })];
    expect(deriveBayesPrior(tiny)).toEqual(DEFAULT_BAYES_PRIOR);
  });

  it("추정 표본은 사전평균(C) 유도에 25%만 가중된다", () => {
    const real = Array.from({ length: 8 }, (_, i) =>
      makeTitle({
        id: `real${i}`,
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
        stats: { ratingAvg: 4.0, ratingCount: 1000 },
      })
    );
    const estimated = Array.from({ length: 8 }, (_, i) =>
      makeTitle({ id: `est${i}`, type: "webnovel", stats: { ratingAvg: 5.0, ratingCount: 1000 } })
    );
    // (8×1000×4.0 + 8×250×5.0) / (8000 + 2000) = 4.2 — 합성 만점이 사전평균을 5.0으로 끌고 가지 못함
    const prior = deriveBayesPrior([...real, ...estimated]);
    expect(prior.c).toBeCloseTo(4.2, 5);
    expect(prior.m).toBe(1000);
  });
});

describe("크로스플랫폼 융합·신뢰 회귀", () => {
  it("멀티플랫폼 유통작(검증된 IP)은 동일 조건의 단일 유통작보다 소폭 위", () => {
    const solo = makeTitle({
      id: "solo",
      availability: [{ platformId: "naver-webtoon", pricing: "free" }],
      stats: { popularityPercentile: 90 },
    });
    const multi = makeTitle({
      id: "multi",
      availability: [
        { platformId: "naver-webtoon", pricing: "free" },
        { platformId: "kakao-page", pricing: "wait-free" },
      ],
      stats: { popularityPercentile: 90 },
    });
    const ranked = rankBy([solo, multi], "popular", { period: "weekly" });
    expect(ranked[0].title.id).toBe("multi");
    // 보너스는 '소폭'(최대 +6%) — 점수 격차가 과장되지 않아야 한다.
    expect(ranked[0].score / ranked[1].score).toBeLessThan(1.07);
  });

  it("추정작은 모멘텀·누적을 최대로 채워도 실데이터 1위를 인기축에서 밀어내지 못한다(기존 회귀 유지)", () => {
    const real = makeTitle({
      id: "real-top",
      status: "ongoing",
      updateDays: ["월"],
      availability: [{ platformId: "naver-webtoon", pricing: "free" }],
      stats: {
        popularityPercentile: 100,
        rankDelta: 0,
        trendingScore: 0,
        views: 400_000_000,
        bookmarks: 2_000_000,
        ratingAvg: 4.9,
        ratingCount: 120_000,
      },
    });
    const estimated = makeTitle({
      id: "est-top",
      type: "webnovel",
      status: "ongoing",
      updateDays: ["월"],
      availability: [{ platformId: "kakao-page", pricing: "wait-free" }],
      stats: {
        popularityPercentile: 100,
        rankDelta: 15,
        trendingScore: 100,
        views: 900_000_000,
        bookmarks: 9_000_000,
        ratingAvg: 5.0,
        ratingCount: 200_000,
      },
    });
    for (const period of ["daily", "weekly", "monthly", "all"] as const) {
      expect(rankBy([estimated, real], "popular", { period })[0].title.id).toBe("real-top");
    }
  });
});

describe("delta 정직화 (seededRandom 가짜 delta 제거)", () => {
  it("popular/trending 축은 실데이터 rankDelta를 그대로 노출한다", () => {
    const t = makeTitle({ id: "d", stats: { rankDelta: 7 } });
    const popular = rankBy([t], "popular", { period: "daily" })[0];
    const trending = rankBy([t], "trending", { period: "daily" })[0];
    expect(popular.delta).toBe(7);
    expect(trending.delta).toBe(7);
    expect(popular.deltaEstimated).toBeUndefined();
  });

  it("비모멘텀 축의 weekly(기준 기간)는 delta 0 — 변동을 지어내지 않는다", () => {
    const ranked = rankBy(
      [makeTitle({ id: "w1", stats: { rankDelta: 9 } }), makeTitle({ id: "w2", stats: { rankDelta: -4 } })],
      "rating",
      { period: "weekly" }
    );
    expect(ranked.every((r) => r.delta === 0)).toBe(true);
    expect(ranked.every((r) => r.deltaEstimated === undefined)).toBe(true);
  });

  it("비모멘텀 축의 추정 delta는 기간 가중 차이 기반, ±5 클램프 + 추정 플래그", () => {
    // 동일 축점수(평점 동일)에서 모멘텀/누적 신호만 갈라 monthly에서 기준(주간) 대비 순위차 유발.
    const surging = makeTitle({
      id: "surging",
      stats: { ratingAvg: 4.5, ratingCount: 10_000, rankDelta: 15, trendingScore: 100, views: 10_000, bookmarks: 1_000 },
    });
    const steady = makeTitle({
      id: "steady",
      stats: { ratingAvg: 4.5, ratingCount: 10_000, rankDelta: 0, trendingScore: 0, views: 900_000_000, bookmarks: 8_000_000 },
    });
    const ranked = rankBy([surging, steady], "rating", { period: "monthly" });
    expect(ranked.some((r) => r.deltaEstimated === true)).toBe(true);
    for (const r of ranked) {
      expect(Math.abs(r.delta)).toBeLessThanOrEqual(5);
      if (r.delta !== 0) expect(r.deltaEstimated).toBe(true);
    }
  });
});

describe("rankingItemListJsonLd", () => {
  it("상위 20개만 순위 position + 절대 URL의 ListItem으로 변환한다", () => {
    const pool = Array.from({ length: 30 }, (_, i) => makeTitle({ id: `n${i}` }));
    const ranked = rankBy(pool, "popular", { period: "all" });
    const ld = rankingItemListJsonLd(ranked, "실시간 인기");
    expect(ld?.["@type"]).toBe("ItemList");
    expect(ld?.name).toBe("툰스펙트럼 통합 랭킹 · 실시간 인기");
    expect(ld?.numberOfItems).toBe(20);
    expect(ld?.itemListElement).toHaveLength(20);
    expect(ld?.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: ranked[0].title.title,
      url: `https://www.toonstudio.cloud/title/${encodeURIComponent(ranked[0].title.slug)}`,
    });
  });

  it("한글 slug는 URL 인코딩되고, 빈 목록은 null(스크립트 미주입)", () => {
    const slug = "나 혼자만 레벨업";
    const ranked = rankBy([makeTitle({ id: "kr", slug })], "popular", { period: "all" });
    const url = rankingItemListJsonLd(ranked, "실시간 인기")?.itemListElement[0].url;
    expect(url).toBe(`https://www.toonstudio.cloud/title/${encodeURIComponent(slug)}`);
    expect(url).not.toContain(" ");
    expect(rankingItemListJsonLd([], "실시간 인기")).toBeNull();
  });

  it("자체 산식 점수·평점 지표는 스키마에 넣지 않는다(외부 평점으로 오인 금지)", () => {
    const ranked = rankBy([makeTitle({ id: "honest" })], "popular", { period: "all" });
    const json = JSON.stringify(rankingItemListJsonLd(ranked, "실시간 인기"));
    expect(json).not.toContain("aggregateRating");
    expect(json).not.toContain("ratingValue");
    expect(json).not.toContain("score");
  });
});
