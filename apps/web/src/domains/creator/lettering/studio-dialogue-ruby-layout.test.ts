import { describe, expect, it } from "vitest";

import { layoutVerticalText } from "../studio-vertical-text";

import {
  estimateDialogueGlyphWidth,
  estimateDialogueTextAdvanceWidth,
  planDialogueRubyOverlayPlacements,
  planDialogueRubyRuns,
  planDialogueVerticalRubyOverlayPlacements,
  readDialogueRubySpans,
} from "./studio-dialogue-ruby-layout";

const VERTICAL_MEASURER = {
  measureWidth(text: string, fontPx: number) {
    return estimateDialogueTextAdvanceWidth(text, fontPx);
  },
};

function verticalLayout(
  text: string,
  options: { align?: "start" | "center" | "end"; lineHeight?: number; max?: number } = {},
) {
  return layoutVerticalText(
    {
      text,
      fontSize: 20,
      lineHeight: options.lineHeight ?? 1.4,
      letterSpacing: 2,
      fontFamily: "Test CJK",
      maxColumnLength: options.max ?? 200,
      blockAlign: options.align ?? "start",
    },
    VERTICAL_MEASURER,
  );
}

describe("planDialogueRubyRuns", () => {
  it("returns a single base-only run when spans are absent or empty", () => {
    expect(planDialogueRubyRuns("hello", undefined)).toEqual([
      { base: "hello", start: 0, end: 5 },
    ]);
    expect(planDialogueRubyRuns("hello", [])).toEqual([
      { base: "hello", start: 0, end: 5 },
    ]);
    expect(planDialogueRubyRuns("", undefined)).toEqual([]);
    expect(planDialogueRubyRuns("", [])).toEqual([]);
  });

  it("interleaves base-only gaps with ruby runs and freezes the plan", () => {
    const runs = planDialogueRubyRuns("漢字テスト", [
      { start: 0, end: 2, ruby: "かんじ" },
    ]);
    expect(runs).toEqual([
      { base: "漢字", ruby: "かんじ", start: 0, end: 2 },
      { base: "テスト", start: 2, end: 5 },
    ]);
    expect(Object.isFrozen(runs)).toBe(true);
    expect(Object.isFrozen(runs[0])).toBe(true);
  });

  it("sorts spans by start and fills uncovered heads and tails", () => {
    const runs = planDialogueRubyRuns("AB漢字CD", [
      { start: 4, end: 6, ruby: "씨디" },
      { start: 2, end: 4, ruby: "かんじ" },
    ]);
    expect(runs).toEqual([
      { base: "AB", start: 0, end: 2 },
      { base: "漢字", ruby: "かんじ", start: 2, end: 4 },
      { base: "CD", ruby: "씨디", start: 4, end: 6 },
    ]);
  });

  it("drops overlapping later spans (first wins after sort) without mutating inputs", () => {
    const spans = Object.freeze([
      Object.freeze({ start: 0, end: 2, ruby: "first" }),
      Object.freeze({ start: 1, end: 3, ruby: "overlap" }),
      Object.freeze({ start: 3, end: 5, ruby: "tail" }),
    ]);
    const snapshot = structuredClone(spans);
    const runs = planDialogueRubyRuns("一二三四五", spans);
    expect(runs).toEqual([
      { base: "一二", ruby: "first", start: 0, end: 2 },
      { base: "三", start: 2, end: 3 },
      { base: "四五", ruby: "tail", start: 3, end: 5 },
    ]);
    expect(spans).toEqual(snapshot);
  });

  it("clamps out-of-range offsets and skips inverted, empty, or empty-ruby spans", () => {
    const runs = planDialogueRubyRuns("abcd", [
      { start: -2, end: 2, ruby: "head" },
      { start: 2, end: 2, ruby: "empty" },
      { start: 3, end: 1, ruby: "invert" },
      { start: 2, end: 4, ruby: "" },
      { start: 2, end: 99, ruby: "tail" },
    ]);
    // -2..2 clamps to 0..2 with ruby; 2..99 clamps to 2..4 with ruby after empty reading skipped.
    expect(runs).toEqual([
      { base: "ab", ruby: "head", start: 0, end: 2 },
      { base: "cd", ruby: "tail", start: 2, end: 4 },
    ]);
  });

  it("preserves UTF-16 code unit offsets for surrogate pairs", () => {
    // "𠮷野" — U+20BB7 is a surrogate pair (2 code units) + 野 (1) = 3 code units.
    const text = "𠮷野家";
    expect(text.length).toBe(4);
    const runs = planDialogueRubyRuns(text, [
      { start: 0, end: 2, ruby: "よし" },
      { start: 2, end: 3, ruby: "の" },
    ]);
    expect(runs).toEqual([
      { base: "𠮷", ruby: "よし", start: 0, end: 2 },
      { base: "野", ruby: "の", start: 2, end: 3 },
      { base: "家", start: 3, end: 4 },
    ]);
  });

  it("treats non-string text as empty and ignores non-array spans", () => {
    expect(planDialogueRubyRuns(null as never, undefined)).toEqual([]);
    expect(planDialogueRubyRuns("x", null as never)).toEqual([
      { base: "x", start: 0, end: 1 },
    ]);
  });
});

describe("estimateDialogueTextAdvanceWidth / glyph width", () => {
  it("treats CJK as ~1em and basic Latin as ~0.55em", () => {
    expect(estimateDialogueGlyphWidth("漢", 20)).toBe(20);
    expect(estimateDialogueGlyphWidth("A", 20)).toBeCloseTo(11);
    expect(estimateDialogueTextAdvanceWidth("漢字", 20)).toBe(40);
    expect(estimateDialogueTextAdvanceWidth("AB", 20)).toBeCloseTo(22);
    expect(estimateDialogueTextAdvanceWidth("A漢", 20)).toBeCloseTo(31);
  });

  it("applies letterSpacing between code points and handles surrogates as one glyph", () => {
    const text = "𠮷野";
    expect(text.length).toBe(3);
    expect(estimateDialogueTextAdvanceWidth(text, 10, 2)).toBe(10 + 2 + 10);
    expect(estimateDialogueTextAdvanceWidth("", 10)).toBe(0);
    expect(estimateDialogueTextAdvanceWidth("x", 0)).toBe(0);
  });
});

describe("readDialogueRubySpans", () => {
  it("returns undefined for absent or empty arrays and passes through non-empty", () => {
    expect(readDialogueRubySpans(undefined)).toBeUndefined();
    expect(readDialogueRubySpans([])).toBeUndefined();
    expect(readDialogueRubySpans("nope")).toBeUndefined();
    const spans = [{ start: 0, end: 1, ruby: "a" }];
    expect(readDialogueRubySpans(spans)).toBe(spans);
  });
});

describe("planDialogueRubyOverlayPlacements", () => {
  it("returns empty when there is no ruby reading to paint", () => {
    expect(
      planDialogueRubyOverlayPlacements("hello", undefined, { fontSize: 20 }),
    ).toEqual([]);
    expect(
      planDialogueRubyOverlayPlacements("", [{ start: 0, end: 1, ruby: "x" }], {
        fontSize: 20,
      }),
    ).toEqual([]);
    expect(
      planDialogueRubyOverlayPlacements("漢字", [{ start: 0, end: 2, ruby: "かんじ" }], {
        fontSize: 0,
      }),
    ).toEqual([]);
  });

  it("places a ruby overlay above the base segment with estimated advance", () => {
    const placements = planDialogueRubyOverlayPlacements(
      "AB漢字CD",
      [{ start: 2, end: 4, ruby: "かんじ" }],
      { fontSize: 20, letterSpacing: 0, align: "left" },
    );
    expect(placements).toHaveLength(1);
    const placement = placements[0]!;
    expect(placement).toMatchObject({
      base: "漢字",
      ruby: "かんじ",
      start: 2,
      end: 4,
      rubyFontSize: 9, // 20 * 0.45
    });
    // "AB" ≈ 0.55em * 2 * 20 = 22
    expect(placement.x).toBeCloseTo(22);
    expect(placement.baseWidth).toBe(40);
    expect(placement.y).toBeCloseTo(-9 * 0.9);
    expect(Object.isFrozen(placements)).toBe(true);
    expect(Object.isFrozen(placement)).toBe(true);
  });

  it("shifts origin for center/right align within the text box", () => {
    const text = "漢字";
    const total = estimateDialogueTextAdvanceWidth(text, 20);
    const centered = planDialogueRubyOverlayPlacements(
      text,
      [{ start: 0, end: 2, ruby: "かんじ" }],
      { fontSize: 20, textWidth: 100, align: "center" },
    );
    expect(centered[0]!.x).toBeCloseTo((100 - total) / 2);

    const right = planDialogueRubyOverlayPlacements(
      text,
      [{ start: 0, end: 2, ruby: "かんじ" }],
      { fontSize: 20, textWidth: 100, align: "right" },
    );
    expect(right[0]!.x).toBeCloseTo(100 - total);
  });

  it("honors custom rubySizeRatio and rubyY", () => {
    const placements = planDialogueRubyOverlayPlacements(
      "漢",
      [{ start: 0, end: 1, ruby: "かん" }],
      { fontSize: 40, rubySizeRatio: 0.5, rubyY: -12 },
    );
    expect(placements[0]).toMatchObject({
      rubyFontSize: 20,
      y: -12,
      x: 0,
      baseWidth: 40,
    });
  });
});

describe("planDialogueVerticalRubyOverlayPlacements", () => {
  it("places Japanese and Korean readings upright on the right of vertical base spans", () => {
    const text = "漢字한국";
    const layout = verticalLayout(text);
    const plan = planDialogueVerticalRubyOverlayPlacements(
      text,
      [
        { start: 0, end: 2, ruby: "かんじ" },
        { start: 2, end: 4, ruby: "한글" },
      ],
      layout,
      { fontSize: 20, lineHeight: 1.4, letterSpacing: 2 },
    );

    expect(plan.unsupported).toEqual([]);
    expect(plan.placements).toHaveLength(2);
    expect(plan.placements[0]).toMatchObject({
      base: "漢字",
      ruby: "かんじ",
      orientation: "vertical-upright",
      writingMode: "vertical-rl",
      side: "right",
      column: 0,
      start: 0,
      end: 2,
      rubyFontSize: 9,
    });
    expect(plan.placements[0]!.x).toBeGreaterThan(
      plan.placements[0]!.baseX + plan.placements[0]!.baseWidth,
    );
    expect(plan.placements[1]).toMatchObject({ base: "한국", ruby: "한글" });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.placements[0])).toBe(true);
  });

  it("maps UTF-16 spans without splitting a surrogate pair", () => {
    const text = "𠮷野";
    const layout = verticalLayout(text);
    const valid = planDialogueVerticalRubyOverlayPlacements(
      text,
      [{ start: 0, end: 2, ruby: "よし" }],
      layout,
      { fontSize: 20, lineHeight: 1.4 },
    );
    expect(valid.placements[0]).toMatchObject({ base: "𠮷", start: 0, end: 2 });
    expect(valid.unsupported).toEqual([]);

    const split = planDialogueVerticalRubyOverlayPlacements(
      text,
      [{ start: 1, end: 2, ruby: "broken" }],
      layout,
      { fontSize: 20, lineHeight: 1.4 },
    );
    expect(split.placements).toEqual([]);
    expect(split.unsupported).toEqual([
      expect.objectContaining({ code: "split-surrogate-pair", spanIndex: 0 }),
    ]);
  });

  it("splits a reading across explicit newline columns without losing ruby glyphs", () => {
    const text = "東京\n都心";
    const layout = verticalLayout(text);
    const plan = planDialogueVerticalRubyOverlayPlacements(
      text,
      [{ start: 0, end: text.length, ruby: "とうきょうとしん" }],
      layout,
      { fontSize: 20, lineHeight: 1.4, letterSpacing: 2 },
    );

    expect(plan.placements).toHaveLength(2);
    expect(plan.placements.map((placement) => placement.column)).toEqual([0, 1]);
    expect(plan.placements.map((placement) => placement.ruby).join("")).toBe("とうきょうとしん");
    expect(plan.placements[0]!.x).toBeGreaterThan(plan.placements[1]!.x);
    expect(plan.warnings).toEqual([
      expect.objectContaining({ code: "span-split-across-columns", spanIndex: 0 }),
    ]);
  });

  it("tracks automatic column progression and multiple independent spans", () => {
    const text = "一二三四五六";
    const layout = verticalLayout(text, { max: 66 });
    const plan = planDialogueVerticalRubyOverlayPlacements(
      text,
      [
        { start: 0, end: 2, ruby: "いちに" },
        { start: 4, end: 6, ruby: "ごろく" },
      ],
      layout,
      { fontSize: 20, lineHeight: 1.4, letterSpacing: 2 },
    );
    expect(plan.unsupported).toEqual([]);
    expect(plan.placements.map((placement) => placement.base)).toEqual(["一二", "五六"]);
    expect(plan.placements[0]!.column).toBe(0);
    expect(plan.placements[1]!.column).toBe(1);
  });

  it("centers ruby against aligned base geometry and follows line-height column spacing", () => {
    const start = verticalLayout("漢字\n語", { align: "start", lineHeight: 1.2 });
    const centered = verticalLayout("漢字\n語", { align: "center", lineHeight: 2 });
    const startPlan = planDialogueVerticalRubyOverlayPlacements(
      "漢字\n語",
      [{ start: 3, end: 4, ruby: "ご" }],
      start,
      { fontSize: 20, lineHeight: 1.2, letterSpacing: 2 },
    );
    const centeredPlan = planDialogueVerticalRubyOverlayPlacements(
      "漢字\n語",
      [{ start: 3, end: 4, ruby: "ご" }],
      centered,
      { fontSize: 20, lineHeight: 2, letterSpacing: 2 },
    );
    expect(centeredPlan.placements[0]!.baseY).toBeGreaterThan(startPlan.placements[0]!.baseY);
    expect(centeredPlan.placements[0]!.x - startPlan.placements[0]!.x).toBeGreaterThan(0);
    const placement = centeredPlan.placements[0]!;
    expect(placement.y + placement.height / 2).toBeCloseTo(
      placement.baseY + placement.baseHeight / 2,
    );
  });

  it("surfaces malformed, overlapping, empty, and unmappable spans explicitly", () => {
    const text = "漢字";
    const layout = verticalLayout(text);
    const plan = planDialogueVerticalRubyOverlayPlacements(
      text,
      [
        { start: 0, end: 1, ruby: "かん" },
        { start: 0, end: 2, ruby: "overlap" },
        { start: 1.5, end: 2, ruby: "fraction" },
        { start: -1, end: 1, ruby: "outside" },
        { start: 1, end: 2, ruby: "   " },
      ],
      layout,
      { fontSize: 20, lineHeight: 1.4 },
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.unsupported.map((issue) => issue.code).sort()).toEqual([
      "empty-reading",
      "fractional-offset",
      "out-of-range",
      "overlapping-span",
    ].sort());

    const mismatched = planDialogueVerticalRubyOverlayPlacements(
      text,
      [{ start: 0, end: 1, ruby: "かん" }],
      verticalLayout("別文"),
      { fontSize: 20, lineHeight: 1.4 },
    );
    expect(mismatched.placements).toEqual([]);
    expect(mismatched.unsupported).toEqual([
      expect.objectContaining({ code: "layout-source-mismatch", spanIndex: null }),
    ]);

    const emptySource = planDialogueVerticalRubyOverlayPlacements(
      "",
      [{ start: 0, end: 1, ruby: "x" }],
      verticalLayout(""),
      { fontSize: 20, lineHeight: 1.4 },
    );
    expect(emptySource.placements).toEqual([]);
    expect(emptySource.unsupported).toEqual([
      expect.objectContaining({ code: "out-of-range", spanIndex: 0 }),
    ]);
  });

  it("maps tate-chu-yoko source digits to one upright base cell", () => {
    const text = "第12話";
    const layout = verticalLayout(text);
    const plan = planDialogueVerticalRubyOverlayPlacements(
      text,
      [{ start: 1, end: 3, ruby: "じゅうに" }],
      layout,
      { fontSize: 20, lineHeight: 1.4, letterSpacing: 2 },
    );
    expect(plan.unsupported).toEqual([]);
    expect(plan.placements[0]).toMatchObject({ base: "12", baseHeight: 22 });
  });

  it("bounds hostile sizing options and reports every adjustment", () => {
    const plan = planDialogueVerticalRubyOverlayPlacements(
      "漢",
      [{ start: 0, end: 1, ruby: "かん" }],
      verticalLayout("漢"),
      {
        fontSize: 20,
        lineHeight: 99,
        letterSpacing: 999,
        rubySizeRatio: 9,
        sideGap: -10,
      },
    );
    expect(plan.placements[0]!.rubyFontSize).toBe(13);
    expect(plan.placements[0]!.x).toBe(
      plan.placements[0]!.baseX + plan.placements[0]!.baseWidth,
    );
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      "bounded-option",
      "bounded-option",
      "bounded-option",
      "bounded-option",
    ]);
  });
});
