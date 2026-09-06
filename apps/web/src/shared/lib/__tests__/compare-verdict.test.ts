import { describe, expect, it } from "vitest";

import { COMPARE_VERDICT_METRICS, computeCompareVerdict } from "../compare-verdict";

import { makeTitle } from "./fixtures";

describe("computeCompareVerdict", () => {
  it("tallies metric wins and declares the stronger title", () => {
    const a = makeTitle({
      title: "A",
      stats: { ratingAvg: 4.8, ratingCount: 20_000, views: 5_000_000, bookmarks: 200_000, completionRate: 80, bingeIndex: 75 },
    });
    const b = makeTitle({
      title: "B",
      stats: { ratingAvg: 4.2, ratingCount: 10_000, views: 1_000_000, bookmarks: 90_000, completionRate: 60, bingeIndex: 55 },
    });

    const verdict = computeCompareVerdict(a, b);
    expect(verdict.aWins).toBe(6);
    expect(verdict.bWins).toBe(0);
    expect(verdict.ties).toBe(0);
    expect(verdict.total).toBe(6);
    expect(verdict.winner).toBe("a");
    expect(verdict.aLabels).toContain("별점");
    expect(verdict.aLabels).toHaveLength(6);
  });

  it("counts ties separately and excludes them from the winner decision", () => {
    const shared = { ratingAvg: 4.5, ratingCount: 10_000, views: 1_000_000, bookmarks: 100_000, completionRate: 70, bingeIndex: 70 };
    const a = makeTitle({ stats: { ...shared, views: 2_000_000 } }); // A wins only on views
    const b = makeTitle({ stats: shared });

    const verdict = computeCompareVerdict(a, b);
    expect(verdict.aWins).toBe(1);
    expect(verdict.bWins).toBe(0);
    expect(verdict.ties).toBe(5);
    expect(verdict.winner).toBe("a");
    expect(verdict.aLabels).toEqual(["누적 조회"]);
  });

  it("returns a tie when neither side leads on more metrics", () => {
    const a = makeTitle({ stats: { ratingAvg: 5, views: 3_000_000, completionRate: 90 } });
    const b = makeTitle({ stats: { ratingCount: 99_000, bookmarks: 999_000, bingeIndex: 99 } });

    const verdict = computeCompareVerdict(a, b);
    expect(verdict.aWins).toBe(3);
    expect(verdict.bWins).toBe(3);
    expect(verdict.winner).toBe("tie");
  });

  it("only uses high-is-better metrics (release year is excluded)", () => {
    // 연재 시작연도(better:"none")는 METRICS 에서 제외돼야 한다.
    expect(COMPARE_VERDICT_METRICS.every((m) => m.better === "high")).toBe(true);
    expect(COMPARE_VERDICT_METRICS.map((m) => m.label)).not.toContain("연재 시작");
  });
});
