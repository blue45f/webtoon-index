import { describe, it, expect } from "vitest";

import { rankBy } from "../ranking";
import { replaceCatalogData } from "../server/catalog-store";

import { makeTitle } from "./fixtures";

import type { Title } from "../types";


// 교차-플랫폼 인기 백분위(popularityPercentile)는 카탈로그 로드 시 replaceCatalogData 안에서 계산된다.
// 내부 함수(computeCrossPlatformPopularity/platformPopSignal)는 비공개이므로 공개 진입점으로 검증한다.
function load(titles: Title[]): Title[] {
  return replaceCatalogData(titles, { source: "cli-ingest", sourceVersion: "test" });
}
function byId(arr: Title[], id: string): Title {
  const found = arr.find((t) => t.id === id);
  if (!found) throw new Error(`title ${id} not found`);
  return found;
}

describe("교차-플랫폼 인기 백분위 (computeCrossPlatformPopularity)", () => {
  it("좋아요==관심(둘 다 추정 동일값)이면 좋아요를 관심의 60%로 분리한다", () => {
    const out = load([
      makeTitle({ id: "dup", stats: { likes: 1_000, bookmarks: 1_000 } }),
      makeTitle({ id: "diff", stats: { likes: 400, bookmarks: 1_000 } }),
      makeTitle({ id: "zero", stats: { likes: 0, bookmarks: 0 } }),
    ]);
    expect(byId(out, "dup").stats.likes).toBe(600); // round(1000 * 0.6)
    expect(byId(out, "diff").stats.likes).toBe(400); // 값이 다르면 그대로 둔다
    expect(byId(out, "zero").stats.likes).toBe(0); // 0은 (>0 가드로) 건드리지 않는다
  });

  it("같은 플랫폼 안에서 인기 신호 내림차순으로 백분위를 부여한다(최상위 100·최하위 0)", () => {
    // popularityRank 없음 → views 기반 신호. likes 동일(0)로 맞춰 순서를 views로 고정.
    const k = (id: string, views: number) =>
      makeTitle({
        id,
        availability: [{ platformId: "kakao-webtoon", pricing: "free" }],
        stats: { views, likes: 0, bookmarks: 0 },
      });
    const out = load([k("top", 1_000_000), k("mid", 10_000), k("low", 100)]);
    expect(byId(out, "top").stats.popularityPercentile).toBe(100);
    expect(byId(out, "mid").stats.popularityPercentile).toBe(50); // (3-1-1)/(3-1)
    expect(byId(out, "low").stats.popularityPercentile).toBe(0);
  });

  it("작은 플랫폼의 1위도 큰 플랫폼 1위와 동일하게 100 — 네이버에 묻히지 않는다", () => {
    // 네이버 5작품(실순위 1~5, 관심 동일) + 카카오 단독 1작품.
    const naver = [1, 2, 3, 4, 5].map((rank) =>
      makeTitle({
        id: `nv-${rank}`,
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
        stats: { popularityRank: rank, likes: 1_000, bookmarks: 5_000 },
      })
    );
    const kakaoSolo = makeTitle({
      id: "kk-1",
      availability: [{ platformId: "kakao-webtoon", pricing: "free" }],
      stats: { views: 5_000, likes: 100, bookmarks: 500 },
    });
    const out = load([...naver, kakaoSolo]);
    expect(byId(out, "nv-1").stats.popularityPercentile).toBe(100); // 네이버 실순위 1위
    expect(byId(out, "nv-5").stats.popularityPercentile).toBe(0); // 네이버 최하위
    expect(byId(out, "kk-1").stats.popularityPercentile).toBe(100); // 단독 플랫폼 1위도 동일 100
  });

  it("네이버: 같은 실순위라도 관심이 높으면 위로 — 동순위 무더기를 연속값으로 분산", () => {
    const out = load([
      makeTitle({
        id: "r2-hi",
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
        stats: { popularityRank: 2, likes: 1_000_000, bookmarks: 5_000_000 },
      }),
      makeTitle({
        id: "r2-lo",
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
        stats: { popularityRank: 2, likes: 10, bookmarks: 50 },
      }),
    ]);
    expect(byId(out, "r2-hi").stats.popularityPercentile).toBe(100);
    expect(byId(out, "r2-lo").stats.popularityPercentile).toBe(0);
  });

  it("가용성이 없는 작품은 백분위를 부여하지 않는다(undefined)", () => {
    const out = load([
      makeTitle({ id: "noavail", availability: [] }),
      makeTitle({ id: "ok" }),
    ]);
    expect(byId(out, "noavail").stats.popularityPercentile).toBeUndefined();
    expect(byId(out, "ok").stats.popularityPercentile).toBe(100); // 단독 그룹 → 100
  });
});

describe("크로스플랫폼 융합 (rankBy 멀티플랫폼 보너스·도달 최댓값 원칙)", () => {
  it("2곳 이상 유통작(검증된 IP)은 동일 신호의 단일 유통작보다 소폭 위", () => {
    const solo = makeTitle({
      id: "fusion-solo",
      availability: [{ platformId: "naver-webtoon", pricing: "free" }],
      stats: { popularityPercentile: 92 },
    });
    const multi = makeTitle({
      id: "fusion-multi",
      availability: [
        { platformId: "naver-webtoon", pricing: "free" },
        { platformId: "kakao-page", pricing: "wait-free" },
        { platformId: "ridi", pricing: "paid" },
      ],
      stats: { popularityPercentile: 92 },
    });
    const ranked = rankBy([solo, multi], "popular", { period: "weekly" });
    expect(ranked[0].title.id).toBe("fusion-multi");
    // '소폭 보너스' 계약: 추가 플랫폼당 +2%, 최대 +6% — 점수 비율이 과장되면 안 된다.
    expect(ranked[0].score / ranked[1].score).toBeLessThan(1.07);
  });

  it("도달 가중은 합산이 아니라 최댓값 — 군소 플랫폼 여러 곳이 메이저 1곳을 넘지 못한다", () => {
    const major = makeTitle({
      id: "fusion-major",
      availability: [{ platformId: "naver-webtoon", pricing: "free" }],
      stats: { popularityPercentile: 90 },
    });
    const smallMulti = makeTitle({
      id: "fusion-smalls",
      availability: [
        { platformId: "lezhin", pricing: "paid" },
        { platformId: "ridi", pricing: "paid" },
        { platformId: "novelpia", pricing: "subscription" },
        { platformId: "munpia", pricing: "paid" },
      ],
      stats: { popularityPercentile: 90 },
    });
    expect(rankBy([smallMulti, major], "popular", { period: "weekly" })[0].title.id).toBe("fusion-major");
  });
});
