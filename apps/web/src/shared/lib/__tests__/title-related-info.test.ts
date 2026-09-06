import { describe, expect, it } from "vitest";

import { getRelatedInfoForTitle } from "../title-related-info";

import { makeTitle } from "./fixtures";

import type { RelatedInfoItem } from "@toonspectrum/core";

describe("title-related-info — 관련 정보 소스 우선순위", () => {
  const crawled: RelatedInfoItem[] = [
    {
      id: "yt-x-0",
      category: "youtube",
      title: "실제 리뷰 영상",
      url: "https://www.youtube.com/watch?v=abcdef12345",
      sourceName: "유튜브",
    },
  ];

  it("크롤 수집된 title.relatedInfo 가 있으면 최우선으로 그대로 반환한다", () => {
    const title = makeTitle({ title: "나 혼자만 레벨업", relatedInfo: crawled });
    expect(getRelatedInfoForTitle(title)).toBe(crawled);
  });

  it("relatedInfo 가 없으면 폴백을 구성하되 실제 목적지 URL(검색결과 페이지 아님)만 담는다", () => {
    const title = makeTitle({ title: "듣도보도못한무명작품xyz" });
    const items = getRelatedInfoForTitle(title);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.url).toMatch(/^https?:\/\//);
      // 검색 결과 페이지(google/naver 검색 쿼리)는 배제된다.
      expect(it.url).not.toMatch(/\/search\?|\/results\?|search\.naver/);
    }
  });

  it("빈 relatedInfo 배열은 무시하고 폴백으로 넘어간다", () => {
    const title = makeTitle({ title: "듣도보도못한무명작품xyz", relatedInfo: [] });
    const items = getRelatedInfoForTitle(title);
    expect(items).not.toBe(crawled);
    expect(items.length).toBeGreaterThan(0);
  });
});
