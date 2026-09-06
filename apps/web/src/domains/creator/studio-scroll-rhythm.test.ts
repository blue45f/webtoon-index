import { describe, expect, it } from "vitest";

import {
  analyzeStudioScrollRhythm,
  planStudioAutoScrollStep,
  STUDIO_SCROLL_RHYTHM_LIMITS,
  type StudioScrollRhythmPageLike,
} from "./studio-scroll-rhythm";

function page(
  id: string,
  canvasH: number,
  elements: StudioScrollRhythmPageLike["elements"]
): StudioScrollRhythmPageLike {
  return { id, canvasH, elements };
}

describe("analyzeStudioScrollRhythm", () => {
  it("returns a deterministic empty-document result", () => {
    expect(analyzeStudioScrollRhythm([])).toEqual({
      score: 0,
      grade: "D",
      pages: [],
      totalHeightPx: 0,
      totalScreenCount: 0,
      densePageCount: 0,
      breathingPageCount: 0,
      flatRhythmPageCount: 0,
      ending: {
        mode: "none",
        label: "엔딩 비트 없음",
        trailingWhitespacePx: 0,
        trailingWhitespaceScreens: 0,
      },
      insights: [],
      truncated: false,
    });
  });

  it("measures panels, dialogue load, visible bounds, and page gaps", () => {
    const result = analyzeStudioScrollRhythm(
      [
        page("p1", 1_280, [
          { type: "frame", y: 80, height: 500 },
          { type: "bubble", y: 160, height: 120, text: "안녕하세요" },
        ]),
        page("p2", 2_560, [{ type: "image", y: 200, height: 800 }]),
      ],
      { pageGapPx: 24 }
    );

    expect(result.totalHeightPx).toBe(3_864);
    expect(result.totalScreenCount).toBe(3.02);
    expect(result.pages[0]).toMatchObject({
      pageId: "p1",
      screenCount: 1,
      visibleElementCount: 2,
      panelCount: 1,
      dialogueCount: 1,
      dialogueCharacters: 5,
      beatCount: 2,
    });
  });

  it("ignores hidden and zero-opacity elements", () => {
    const result = analyzeStudioScrollRhythm([
      page("p1", 1_280, [
        { type: "frame", y: 0, height: 600, hidden: true },
        { type: "bubble", y: 50, height: 100, opacity: 0, text: "숨김" },
        { type: "image", y: 100, height: 400 },
      ]),
    ]);

    expect(result.pages[0]?.visibleElementCount).toBe(1);
    expect(result.pages[0]?.dialogueCount).toBe(0);
  });

  it("uses draw points when width and height bounds are unavailable", () => {
    const result = analyzeStudioScrollRhythm([
      page("p1", 1_280, [
        { type: "draw", points: [20, 100, 30, 300, 50, 500] },
      ]),
    ]);

    expect(result.pages[0]).toMatchObject({
      occupiedRatio: 0.31,
      longestGapPx: 780,
    });
  });

  it("flags pages with excessive weighted information density", () => {
    const elements = Array.from({ length: 15 }, (_, index) => ({
      type: "frame",
      y: index * 75,
      height: 70,
    }));
    const result = analyzeStudioScrollRhythm([page("dense", 1_280, elements)]);

    expect(result.densePageCount).toBe(1);
    expect(result.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DENSE_PAGE",
          pageId: "dense",
          severity: "critical",
        }),
      ])
    );
  });

  it("flags dialogue load independently from visual density", () => {
    const result = analyzeStudioScrollRhythm([
      page("talk", 1_280, [
        { type: "bubble", y: 200, height: 300, text: "가".repeat(420) },
      ]),
    ]);

    expect(result.pages[0]?.dialogueCharactersPerScreen).toBe(420);
    expect(result.insights.some((insight) => insight.code === "DIALOGUE_LOAD")).toBe(
      true
    );
  });

  it("detects monotonous beat spacing without treating two beats as evidence", () => {
    const flat = analyzeStudioScrollRhythm([
      page(
        "flat",
        2_000,
        [100, 500, 900, 1_300, 1_700].map((y) => ({
          type: "frame",
          y,
          height: 100,
        }))
      ),
    ]);
    const sparse = analyzeStudioScrollRhythm([
      page("sparse", 2_000, [
        { type: "frame", y: 100, height: 100 },
        { type: "frame", y: 1_000, height: 100 },
      ]),
    ]);

    expect(flat.pages[0]?.beatIntervalVariation).toBe(0);
    expect(flat.flatRhythmPageCount).toBe(1);
    expect(
      flat.insights.some((insight) => insight.code === "FLAT_BEAT_INTERVALS")
    ).toBe(true);
    expect(sparse.pages[0]?.beatIntervalVariation).toBeNull();
  });

  it.each([
    { y: 1_150, height: 100, expected: "tight" },
    { y: 900, height: 100, expected: "balanced" },
    { y: 300, height: 100, expected: "reveal" },
  ] as const)(
    "classifies ending whitespace as $expected",
    ({ y, height, expected }) => {
      const result = analyzeStudioScrollRhythm([
        page("ending", 1_280, [{ type: "frame", y, height }]),
      ]);
      expect(result.ending.mode).toBe(expected);
    }
  );

  it("reports an excessively empty ending and applies an overall penalty", () => {
    const result = analyzeStudioScrollRhythm([
      page("ending", 3_000, [{ type: "frame", y: 0, height: 400 }]),
    ]);

    expect(result.ending.mode).toBe("empty");
    expect(result.insights.some((insight) => insight.code === "EMPTY_ENDING")).toBe(
      true
    );
    expect(result.score).toBeLessThan(result.pages[0]?.score ?? 0);
  });

  it("uses hard page and element budgets and exposes truncation", () => {
    const firstPageElements = Array.from(
      { length: STUDIO_SCROLL_RHYTHM_LIMITS.maxElementsPerPage + 1 },
      () => ({ type: "frame", y: 0, height: 10 })
    );
    const pages = Array.from(
      { length: STUDIO_SCROLL_RHYTHM_LIMITS.maxPages + 1 },
      (_, index) =>
        page(
          `p${index}`,
          1_280,
          index === 0 ? firstPageElements : []
        )
    );
    const result = analyzeStudioScrollRhythm(pages);

    expect(result.pages).toHaveLength(STUDIO_SCROLL_RHYTHM_LIMITS.maxPages);
    expect(result.pages[0]?.visibleElementCount).toBe(
      STUDIO_SCROLL_RHYTHM_LIMITS.maxElementsPerPage
    );
    expect(result.truncated).toBe(true);
    expect(
      result.insights.some((insight) => insight.code === "ANALYSIS_TRUNCATED")
    ).toBe(true);
  });

  it("never mutates source pages or element order", () => {
    const source = [
      page("p1", 1_280, [
        { id: "b", type: "frame", y: 700, height: 100 },
        { id: "a", type: "frame", y: 100, height: 100 },
      ]),
    ];
    const before = JSON.stringify(source);

    analyzeStudioScrollRhythm(source);

    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("planStudioAutoScrollStep", () => {
  it("advances by reader speed and elapsed frame time", () => {
    expect(
      planStudioAutoScrollStep({
        scrollTop: 100,
        scrollHeight: 2_000,
        viewportHeight: 500,
        speedPxPerSecond: 240,
        elapsedMs: 50,
      })
    ).toEqual({
      nextScrollTop: 112,
      maxScrollTop: 1_500,
      reachedEnd: false,
    });
  });

  it("caps background-tab frame gaps at 100ms", () => {
    expect(
      planStudioAutoScrollStep({
        scrollTop: 100,
        scrollHeight: 2_000,
        viewportHeight: 500,
        speedPxPerSecond: 420,
        elapsedMs: 5_000,
      }).nextScrollTop
    ).toBe(142);
  });

  it("clamps to the end and reports completion", () => {
    expect(
      planStudioAutoScrollStep({
        scrollTop: 1_490,
        scrollHeight: 2_000,
        viewportHeight: 500,
        speedPxPerSecond: 240,
        elapsedMs: 100,
      })
    ).toEqual({
      nextScrollTop: 1_500,
      maxScrollTop: 1_500,
      reachedEnd: true,
    });
  });

  it("fails closed for invalid dimensions, speed, and elapsed time", () => {
    expect(
      planStudioAutoScrollStep({
        scrollTop: Number.NaN,
        scrollHeight: Number.NaN,
        viewportHeight: -1,
        speedPxPerSecond: Number.POSITIVE_INFINITY,
        elapsedMs: -50,
      })
    ).toEqual({
      nextScrollTop: 0,
      maxScrollTop: 0,
      reachedEnd: true,
    });
  });
});
