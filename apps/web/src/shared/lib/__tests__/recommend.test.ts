import { describe, it, expect } from "vitest";

import { similarity, buildTasteProfile, recommendForTaste } from "../recommend";

import { makeTitle } from "./fixtures";

describe("similarity", () => {
  it("장르·태그 겹치면 더 유사", () => {
    const a = makeTitle({ genres: ["판타지", "액션"], tags: ["먼치킨"] });
    const b = makeTitle({ genres: ["판타지"], tags: ["먼치킨"] });
    const c = makeTitle({ genres: ["로맨스"], tags: [] });
    expect(similarity(a, b)).toBeGreaterThan(similarity(a, c));
  });
  it("동일 작품은 0", () => {
    const a = makeTitle();
    expect(similarity(a, a)).toBe(0);
  });
});

describe("buildTasteProfile", () => {
  it("평가한 작품의 장르가 선호 장르로", () => {
    const f1 = makeTitle({ id: "f1", genres: ["판타지"], tags: ["먼치킨"] });
    const r1 = makeTitle({ id: "r1", genres: ["로맨스"] });
    const profile = buildTasteProfile([f1, r1], { f1: 5 }, {});
    expect(profile.topGenres[0]?.name).toBe("판타지");
    expect(profile.ratedCount).toBe(1);
    expect(profile.avgRating).toBe(5);
  });
  it("데이터 없으면 빈 프로필", () => {
    const profile = buildTasteProfile([makeTitle()], {}, {});
    expect(profile.topGenres).toEqual([]);
    expect(profile.ratedCount).toBe(0);
  });
});

describe("recommendForTaste", () => {
  it("선호 장르 매칭 + 이미 본 작품 제외", () => {
    const f1 = makeTitle({ id: "f1", genres: ["판타지"], tags: ["먼치킨"] });
    const f2 = makeTitle({ id: "f2", genres: ["판타지"], tags: ["먼치킨"], stats: { ratingAvg: 4.6 } });
    const r1 = makeTitle({ id: "r1", genres: ["로맨스"] });
    const all = [f1, f2, r1];
    const profile = buildTasteProfile(all, { f1: 5 }, {});
    const recs = recommendForTaste(all, profile, new Set(["f1"]), 10);
    const ids = recs.map((x) => x.title.id);
    expect(ids).toContain("f2");
    expect(ids).not.toContain("f1");
    expect(recs[0].reason).toBeTruthy();
  });
});
