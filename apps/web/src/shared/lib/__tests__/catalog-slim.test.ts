import { describe, expect, it } from "vitest";

import {
  buildDetailExtra,
  detailShardBucket,
  detailShardFile,
  detailShardFileForBucket,
  DETAIL_SHARD_COUNT,
  mergeDetailExtra,
  SYNOPSIS_CARD_MAX,
  toCalendarTitle,
  toListTitle,
  truncateSynopsis,
} from "../catalog-slim";

import { makeTitle } from "./fixtures";

import type { Title, TitleStats } from "../types";

describe("catalog-slim — 정적 카탈로그 경량화 규약", () => {
  const longSynopsis = `${"기다리던 외전이 돌아왔다. ".repeat(20)}끝.`;
  const heavy = makeTitle({
    synopsis: longSynopsis,
    availability: [
      { platformId: "naver-webtoon", pricing: "free", isOriginal: true, url: "https://comic.naver.com/webtoon/1" },
      { platformId: "ridi", pricing: "paid" },
    ],
  });

  it("truncateSynopsis 는 코드포인트 기준으로 자르고 잘릴 때만 말줄임표를 붙인다", () => {
    expect(truncateSynopsis("짧은 줄거리")).toBe("짧은 줄거리");
    const cut = truncateSynopsis("가".repeat(SYNOPSIS_CARD_MAX + 50));
    expect([...cut].length).toBe(SYNOPSIS_CARD_MAX + 1); // 본문 160 + 말줄임표
    expect(cut.endsWith("…")).toBe(true);
  });

  it("toListTitle 은 상세 전용 필드를 줄이고 카드·검색·랭킹 필드는 유지한다", () => {
    const card = toListTitle(heavy);
    // 상세 전용 — 축약/제거
    expect([...(card.synopsis ?? "")].length).toBeLessThan([...longSynopsis].length);
    expect(card.synopsis?.endsWith("…")).toBe(true);
    expect(card.availability).toEqual([
      { platformId: "naver-webtoon", pricing: "free", isOriginal: true },
      { platformId: "ridi", pricing: "paid" },
    ]);
    expect("ratingDist" in card.stats).toBe(false);
    // 카드 경로가 읽는 필드 유지
    expect(card.id).toBe(heavy.id);
    expect(card.slug).toBe(heavy.slug);
    expect(card.cover).toEqual(heavy.cover);
    expect(card.stats.views).toBe(heavy.stats.views);
    expect(card.stats.ratingAvg).toBe(heavy.stats.ratingAvg);
    expect(card.stats.completionRate).toBe(heavy.stats.completionRate);
    // 원본은 변형되지 않는다
    expect(heavy.synopsis).toBe(longSynopsis);
    expect(heavy.availability[0].url).toBe("https://comic.naver.com/webtoon/1");
    expect(heavy.stats.ratingDist).toHaveLength(5);
  });

  it("toCalendarTitle 은 시놉시스 없이 캘린더 카드 필드만 담는다", () => {
    const card = toCalendarTitle(heavy);
    expect("synopsis" in card).toBe(false);
    expect(card.title).toBe(heavy.title);
    expect(card.stats.ratingAvg).toBe(heavy.stats.ratingAvg);
    expect(card.availability[0]).toEqual({ platformId: "naver-webtoon", pricing: "free", isOriginal: true });
  });

  it("detail 샤드 항목 병합으로 상세 전용 필드가 복원된다(라운드트립)", () => {
    const card = toListTitle(heavy) as unknown as Title;
    const extra = buildDetailExtra(heavy);
    expect(extra).not.toBeNull();
    const restored = mergeDetailExtra(card, extra ?? undefined);
    expect(restored.synopsis).toBe(longSynopsis);
    expect(restored.availability[0].url).toBe("https://comic.naver.com/webtoon/1");
    expect(restored.availability[0].isOriginal).toBe(true);
    expect(restored.availability[1].url).toBeUndefined();
    expect(restored.stats.ratingDist).toEqual(heavy.stats.ratingDist);
    // 병합도 카드 원본을 변형하지 않는다
    expect(card.availability[0].url).toBeUndefined();
    expect("ratingDist" in card.stats).toBe(false);
  });

  it("관련 정보(extra.r)는 병합 시 title.relatedInfo 로 복원된다(크롤 실링크)", () => {
    const card = toListTitle(heavy) as unknown as Title;
    const related = [
      {
        id: "yt-x-0",
        category: "youtube" as const,
        title: "리뷰 영상",
        url: "https://www.youtube.com/watch?v=abcdef12345",
        sourceName: "유튜브",
      },
    ];
    const restored = mergeDetailExtra(card, { r: related });
    expect(restored.relatedInfo).toEqual(related);
    // 빈 배열·부재는 relatedInfo 를 붙이지 않는다.
    expect(mergeDetailExtra(card, { r: [] }).relatedInfo).toBeUndefined();
    expect(mergeDetailExtra(card, {}).relatedInfo).toBeUndefined();
    // 원본 카드는 변형되지 않는다.
    expect(card.relatedInfo).toBeUndefined();
  });

  it("떼어낼 상세 필드가 없으면 샤드 항목을 만들지 않고, 병합은 무해하게 통과한다", () => {
    const bare = makeTitle({
      synopsis: "짧은 소개",
      availability: [{ platformId: "ridi", pricing: "paid" }],
    });
    delete (bare.stats as Partial<TitleStats>).ratingDist;
    expect(toListTitle(bare).synopsis).toBe("짧은 소개");
    expect(buildDetailExtra(bare)).toBeNull();
    expect(mergeDetailExtra(bare, undefined)).toBe(bare);
  });

  it("샤드 버킷은 결정적이며 빌드 생성기와 엔진이 같은 파일 경로를 가리킨다", () => {
    for (const id of ["nw-1", "ks-12345", "ridi-소설-9", "t-1", ""]) {
      const bucket = detailShardBucket(id);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(DETAIL_SHARD_COUNT);
      expect(detailShardBucket(id)).toBe(bucket); // 결정성
      expect(detailShardFile(id)).toBe(detailShardFileForBucket(bucket));
      expect(detailShardFile(id)).toMatch(/^detail\/[0-9a-f]{2}\.json$/);
    }
  });
});
