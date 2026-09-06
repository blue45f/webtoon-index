import { afterEach, describe, expect, it } from "vitest";

import { getCalendarData } from "../server/calendar";
import { allTitles, getCatalogState, replaceCatalogData } from "../server/catalog-store";

import { makeTitle } from "./fixtures";

describe("calendar data", () => {
  const originalTitles = allTitles();
  const originalState = getCatalogState();

  afterEach(() => {
    replaceCatalogData(originalTitles, {
      source: originalState.source,
      sourceVersion: originalState.sourceVersion,
      seedFallback: originalState.seedFallback,
    });
  });

  it("연재 캘린더는 요일별 후보를 임의로 자르지 않고 모두 반환한다", async () => {
    const monday = Array.from({ length: 230 }, (_, index) =>
      makeTitle({
        id: `mon-${index}`,
        updateDays: ["월"],
        availability: [{ platformId: "naver-webtoon", pricing: "free" }],
      })
    );
    const tuesday = Array.from({ length: 95 }, (_, index) =>
      makeTitle({
        id: `tue-${index}`,
        updateDays: ["화"],
        availability: [{ platformId: "lezhin", pricing: "paid" }],
      })
    );

    replaceCatalogData([...monday, ...tuesday], {
      source: "database-snapshot",
      sourceVersion: "calendar-test",
    });

    const data = await getCalendarData();

    expect(data.days.find((day) => day.day === "월")?.items).toHaveLength(230);
    expect(data.days.find((day) => day.day === "화")?.items).toHaveLength(95);
    expect(data.totalScheduled).toBe(325);
    expect(data.platformCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "naver-webtoon", count: 230 }),
        expect.objectContaining({ id: "lezhin", count: 95 }),
      ])
    );
  });
});
