import { describe, expect, it } from "vitest";

import {
  VERTICAL_NO_BREAK_AFTER,
  VERTICAL_NO_BREAK_BEFORE,
  classifyVerticalPunctuation,
  classifyVerticalGlyph,
  isVerticalNoBreakAfter,
  isVerticalNoBreakBefore,
  layoutVerticalText,
  measureVerticalTextBlock,
  segmentVerticalRuns,
  toVerticalGlyphs,
  type VerticalTextLayoutInput,
  type VerticalTextMeasurer,
} from "./studio-vertical-text";

/** 결정적 가짜 측정기 — 코드포인트 하나당 fontPx의 절반(라틴 폭 근사). */
const HALF_EM: VerticalTextMeasurer = {
  measureWidth: (text, fontPx) => [...text].length * fontPx * 0.5,
};

function input(overrides: Partial<VerticalTextLayoutInput> = {}): VerticalTextLayoutInput {
  return {
    text: "가나다",
    fontSize: 20,
    lineHeight: 1.4,
    fontFamily: "Pretendard, sans-serif",
    fontStyle: "bold",
    ...overrides,
  };
}

describe("classifyVerticalGlyph", () => {
  it("keeps square CJK/Hangul/kana glyphs upright", () => {
    for (const char of ["가", "힣", "ㄱ", "漢", "字", "あ", "ア", "〆", "々", "〇", "🔥"]) {
      expect(classifyVerticalGlyph(char)).toEqual({ form: "upright", offsetX: 0, offsetY: 0 });
    }
  });

  it("keeps fullwidth alphanumerics upright because they are already square", () => {
    for (const char of ["Ａ", "Ｚ", "０", "９", "？", "！"]) {
      expect(classifyVerticalGlyph(char).form).toBe("upright");
    }
  });

  it("rotates latin letters, digits and the ascii symbols between them", () => {
    for (const char of ["A", "z", "0", "9", "?", "!", "&", "@", "/", "%"]) {
      expect(classifyVerticalGlyph(char)).toEqual({ form: "rotated", offsetX: 0, offsetY: 0 });
    }
  });

  it("rotates greek, cyrillic and accented latin as well", () => {
    for (const char of ["Ω", "π", "Д", "я", "É", "ñ"]) {
      expect(classifyVerticalGlyph(char).form).toBe("rotated");
    }
  });

  it("rotates bracket and stroke-shaped glyphs whose vertical form is the turned horizontal one", () => {
    for (const char of ["(", ")", "「", "」", "『", "』", "【", "】", "（", "）", "“", "”"]) {
      expect(classifyVerticalGlyph(char).form).toBe("rotated");
    }
    for (const char of ["ー", "〜", "～", "—", "―", "─", "－", "-", "_", "…", "‥", "="]) {
      expect(classifyVerticalGlyph(char).form).toBe("rotated");
    }
  });

  it("moves stop-family punctuation from the lower-left to the upper-right of the em box", () => {
    for (const char of ["、", "。", "，", "．", "｡", "､"]) {
      expect(classifyVerticalGlyph(char)).toEqual({ form: "shifted", offsetX: 0.5, offsetY: -0.5 });
    }
  });

  it("classifies Unicode opening, closing, stop, small, centered and stroke punctuation roles", () => {
    for (const char of ["「", "『", "（", "【", "〈", "“", "‘", "⟦"]) {
      expect(classifyVerticalPunctuation(char)).toBe("opening");
      expect(isVerticalNoBreakAfter(char)).toBe(true);
    }
    for (const char of ["」", "』", "）", "】", "〉", "”", "’", "⟧"]) {
      expect(classifyVerticalPunctuation(char)).toBe("closing");
      expect(isVerticalNoBreakBefore(char)).toBe(true);
    }
    expect(classifyVerticalPunctuation("。")).toBe("stop");
    expect(classifyVerticalPunctuation("ゃ")).toBe("small");
    expect(classifyVerticalPunctuation("！")).toBe("centered");
    expect(classifyVerticalPunctuation("ー")).toBe("stroke");
    expect(classifyVerticalPunctuation("한")).toBe("none");
  });

  it("nudges small kana up and to the right", () => {
    for (const char of ["ぁ", "っ", "ゃ", "ョ", "ヵ"]) {
      expect(classifyVerticalGlyph(char)).toEqual({ form: "shifted", offsetX: 0.08, offsetY: -0.08 });
    }
  });

  it("defaults to upright and never throws on empty input", () => {
    expect(classifyVerticalGlyph("")).toEqual({ form: "upright", offsetX: 0, offsetY: 0 });
    expect(classifyVerticalGlyph("字")).toEqual({ form: "upright", offsetX: 0, offsetY: 0 });
  });

  it("exposes kinsoku sets that never overlap", () => {
    for (const char of VERTICAL_NO_BREAK_AFTER) {
      expect(VERTICAL_NO_BREAK_BEFORE.has(char)).toBe(false);
    }
  });
});

describe("toVerticalGlyphs / segmentVerticalRuns", () => {
  it("splits by code point so surrogate pairs stay intact", () => {
    expect(toVerticalGlyphs("가🔥나")).toEqual(["가", "🔥", "나"]);
  });

  it("groups consecutive latin/digit characters into one readable run", () => {
    expect(segmentVerticalRuns("가나ABC123다")).toEqual([
      { form: "upright", chars: ["가", "나"] },
      { form: "rotated", chars: ["A", "B", "C", "1", "2", "3"] },
      { form: "upright", chars: ["다"] },
    ]);
  });

  it("classifies an independent one-to-four digit run as tate-chu-yoko", () => {
    expect(segmentVerticalRuns("가2026나")).toEqual([
      { form: "upright", chars: ["가"] },
      { form: "tate-chu-yoko", chars: ["2", "0", "2", "6"] },
      { form: "upright", chars: ["나"] },
    ]);
    expect(segmentVerticalRuns("12345")).toEqual([
      { form: "rotated", chars: ["1", "2", "3", "4", "5"] },
    ]);
    expect(segmentVerticalRuns("A12B")).toEqual([
      { form: "rotated", chars: ["A", "1", "2", "B"] },
    ]);
  });

  it("isolates shifted punctuation into single-character runs", () => {
    expect(segmentVerticalRuns("가、나。")).toEqual([
      { form: "upright", chars: ["가"] },
      { form: "shifted", chars: ["、"] },
      { form: "upright", chars: ["나"] },
      { form: "shifted", chars: ["。"] },
    ]);
  });

  it("never merges adjacent opening/closing punctuation with opposite roles", () => {
    expect(segmentVerticalRuns("가」「『』나")).toEqual([
      { form: "upright", chars: ["가"] },
      { form: "rotated", chars: ["」"] },
      { form: "rotated", chars: ["「"] },
      { form: "rotated", chars: ["『"] },
      { form: "rotated", chars: ["』"] },
      { form: "upright", chars: ["나"] },
    ]);
  });

  it("isolates stop and centered sentence punctuation while preserving their orientation", () => {
    expect(segmentVerticalRuns("、。！？")).toEqual([
      { form: "shifted", chars: ["、"] },
      { form: "shifted", chars: ["。"] },
      { form: "upright", chars: ["！"] },
      { form: "upright", chars: ["？"] },
    ]);
  });
});

function layoutSourceText(layout: ReturnType<typeof layoutVerticalText>): string {
  return layout.columns
    .flatMap((column) => column.items)
    .map((item) => item.text.replaceAll("\n", ""))
    .join("");
}

function expectKinsokuValid(layout: ReturnType<typeof layoutVerticalText>): void {
  for (const column of layout.columns) {
    const chars = column.items.flatMap((item) => [...item.text.replaceAll("\n", "")]);
    const first = chars[0];
    const last = chars.at(-1);
    if (first !== undefined) expect(isVerticalNoBreakBefore(first)).toBe(false);
    if (last !== undefined) expect(isVerticalNoBreakAfter(last)).toBe(false);
  }
}

describe("layoutVerticalText — 열 배치", () => {
  it("stacks characters top-to-bottom inside one column", () => {
    const layout = layoutVerticalText(input({ text: "가나다" }), HALF_EM);

    expect(layout.columns).toHaveLength(1);
    expect(layout.columnAdvance).toBe(28); // 20 × 1.4
    expect(layout.width).toBe(28);
    expect(layout.height).toBe(60); // 3글자 × 20px
    const [item] = layout.columns[0]!.items;
    expect(item).toMatchObject({ form: "upright", text: "가\n나\n다", rotation: 0, y: 0, glyphAdvance: 20 });
    expect(item!.x).toBe(28 - 0.5 * 28 - 10); // centerX − fontSize/2
  });

  it("orders explicit source lines right-to-left", () => {
    const layout = layoutVerticalText(input({ text: "가나\n다라" }), HALF_EM);

    expect(layout.columns).toHaveLength(2);
    expect(layout.width).toBe(56);
    expect(layout.columns[0]!.centerX).toBeGreaterThan(layout.columns[1]!.centerX);
    expect(layout.columns[0]!.items[0]!.text).toBe("가\n나");
    expect(layout.columns[1]!.items[0]!.text).toBe("다\n라");
  });

  it("keeps a blank source line as a blank column", () => {
    const layout = layoutVerticalText(input({ text: "가\n\n나" }), HALF_EM);
    expect(layout.columns.map((column) => column.items.length)).toEqual([1, 0, 1]);
  });

  it("returns one empty column for empty text instead of throwing", () => {
    const layout = layoutVerticalText(input({ text: "" }), HALF_EM);
    expect(layout.columns).toHaveLength(1);
    expect(layout.height).toBe(0);
  });
});

describe("layoutVerticalText — 혼합 조판(한글 + 라틴 + 숫자 + 문장부호)", () => {
  it("rotates the latin run, keeps hangul upright, and shifts the stop", () => {
    const layout = layoutVerticalText(input({ text: "가OK9나。" }), HALF_EM);
    const items = layout.columns[0]!.items;

    expect(items.map((item) => [item.form, item.text, item.rotation])).toEqual([
      ["upright", "가", 0],
      ["rotated", "OK9", 90],
      ["upright", "나", 0],
      ["shifted", "。", 0],
    ]);
  });

  it("fits one-to-four digits horizontally into exactly one vertical cell", () => {
    const layout = layoutVerticalText(input({ text: "가2026나" }), HALF_EM);
    const items = layout.columns[0]!.items;

    expect(items.map((item) => [item.form, item.text, item.rotation])).toEqual([
      ["upright", "가", 0],
      ["tate-chu-yoko", "2026", 0],
      ["upright", "나", 0],
    ]);
    expect(items[1]).toMatchObject({
      length: 20,
      glyphAdvance: 20,
      horizontalScale: 0.5,
      y: 20,
    });
    expect(layout.height).toBe(60);
  });

  it("keeps five digits and latin-adjacent digits in the rotated lane", () => {
    const five = layoutVerticalText(input({ text: "12345" }), HALF_EM);
    expect(five.columns[0]!.items[0]).toMatchObject({
      form: "rotated",
      rotation: 90,
      horizontalScale: 1,
    });
    const mixed = layoutVerticalText(input({ text: "A12B" }), HALF_EM);
    expect(mixed.columns[0]!.items[0]).toMatchObject({
      form: "rotated",
      text: "A12B",
      rotation: 90,
    });
  });

  it("advances the column by the measured horizontal width of a rotated run", () => {
    const layout = layoutVerticalText(input({ text: "가OK9나" }), HALF_EM);
    const [hangul, latin, tail] = layout.columns[0]!.items;

    expect(hangul!.length).toBe(20);
    expect(latin!.y).toBe(20);
    expect(latin!.length).toBe(30); // "OK9" = 3자 × 20 × 0.5
    expect(tail!.y).toBe(50);
    expect(layout.height).toBe(70);
  });

  it("applies the em offsets of shifted punctuation to the item position", () => {
    const layout = layoutVerticalText(input({ text: "가。" }), HALF_EM);
    const [, stop] = layout.columns[0]!.items;
    const centerX = layout.columns[0]!.centerX;

    expect(stop!.x).toBe(centerX - 10 + 0.5 * 20);
    expect(stop!.y).toBe(20 - 0.5 * 20);
  });

  it("splits merged upright runs whenever a rotated or shifted item interrupts them", () => {
    const layout = layoutVerticalText(input({ text: "가나A다라" }), HALF_EM);
    expect(layout.columns[0]!.items.map((item) => item.text)).toEqual(["가\n나", "A", "다\n라"]);
  });

  it("keeps 、。！？ as independent role-aware cells without dropping a code point", () => {
    const text = "가、。！？나";
    const layout = layoutVerticalText(input({ text }), HALF_EM);
    expect(layoutSourceText(layout)).toBe(text);
    expect(layout.columns[0]!.items.map((item) => [item.text, item.form, item.punctuation])).toEqual([
      ["가", "upright", "none"],
      ["、", "shifted", "stop"],
      ["。", "shifted", "stop"],
      ["！", "upright", "centered"],
      ["？", "upright", "centered"],
      ["나", "upright", "none"],
    ]);
  });

  it("keeps tate-chu-yoko atomic beside opening, closing and stop punctuation", () => {
    const text = "「2026」、。！？";
    const layout = layoutVerticalText(input({ text, maxColumnLength: 80 }), HALF_EM);
    expect(layoutSourceText(layout)).toBe(text);
    const tcy = layout.columns.flatMap((column) => column.items).filter((item) => item.form === "tate-chu-yoko");
    expect(tcy).toHaveLength(1);
    expect(tcy[0]).toMatchObject({ text: "2026", length: 20, punctuation: "none" });
    expectKinsokuValid(layout);
  });
});

describe("layoutVerticalText — 줄바꿈은 세로축으로 측정한다", () => {
  it("breaks into a new column when the column length exceeds the box height", () => {
    const layout = layoutVerticalText(input({ text: "가나다라마바", maxColumnLength: 60 }), HALF_EM);

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]!.items[0]!.text).toBe("가\n나\n다");
    expect(layout.columns[1]!.items[0]!.text).toBe("라\n마\n바");
    expect(layout.height).toBe(60);
    expect(layout.width).toBe(56);
    expect(layout.overflow).toBe(false);
  });

  it("never breaks inside a rotated run that still fits a column", () => {
    const layout = layoutVerticalText(input({ text: "가나ABCD", maxColumnLength: 60 }), HALF_EM);

    expect(layout.columns[0]!.items.map((item) => item.text)).toEqual(["가\n나"]);
    expect(layout.columns[1]!.items.map((item) => item.text)).toEqual(["ABCD"]);
  });

  it("hard-breaks a rotated run that alone is longer than the column", () => {
    const layout = layoutVerticalText(input({ text: "ABCDEFGH", maxColumnLength: 40 }), HALF_EM);

    expect(layout.columns.map((column) => column.items[0]!.text)).toEqual(["ABCD", "EFGH"]);
    expect(layout.overflow).toBe(false);
  });

  it("treats a complete tate-chu-yoko run as one atomic wrapping cell", () => {
    const layout = layoutVerticalText(
      input({ text: "가2026나", maxColumnLength: 40 }),
      HALF_EM,
    );
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]!.items.map((item) => item.text)).toEqual([
      "가",
      "2026",
    ]);
    expect(layout.columns[1]!.items.map((item) => item.text)).toEqual(["나"]);
    expect(layout.columns[0]!.length).toBe(40);
    expect(layout.overflow).toBe(false);
  });

  it("reports overflow when a single item cannot be shortened below the column length", () => {
    const layout = layoutVerticalText(input({ text: "가나다", maxColumnLength: 12 }), HALF_EM);
    expect(layout.overflow).toBe(true);
  });

  it("keeps line-start kinsoku punctuation attached to the previous character", () => {
    // 60px 열이면 "가나다"로 끊기고 "。"가 다음 열 첫머리가 된다 → 금칙에 걸려 "다"가 함께 내려간다.
    const layout = layoutVerticalText(input({ text: "가나다。라", maxColumnLength: 60 }), HALF_EM);

    expect(layout.columns[0]!.items.map((item) => item.text)).toEqual(["가\n나"]);
    expect(layout.columns[1]!.items.map((item) => item.text)).toEqual(["다", "。", "라"]);
  });

  it("keeps an opening bracket from being stranded at the end of a column", () => {
    const layout = layoutVerticalText(input({ text: "가나「다라", maxColumnLength: 60 }), HALF_EM);

    expect(layout.columns[0]!.items.map((item) => item.text)).toEqual(["가\n나"]);
    expect(layout.columns[1]!.items.map((item) => item.text)).toEqual(["「", "다\n라"]);
  });

  it("breaks between adjacent closing/opening punctuation without merging or glyph loss", () => {
    const text = "가나」「다";
    const layout = layoutVerticalText(input({ text, maxColumnLength: 40 }), HALF_EM);
    expect(layoutSourceText(layout)).toBe(text);
    expect(layout.columns.flatMap((column) => column.items).filter((item) => item.text === "」")).toHaveLength(1);
    expect(layout.columns.flatMap((column) => column.items).filter((item) => item.text === "「")).toHaveLength(1);
    expectKinsokuValid(layout);
  });

  it("handles nested paired punctuation across a column boundary without merging", () => {
    const text = "가나「『다』」라";
    const layout = layoutVerticalText(input({ text, maxColumnLength: 80 }), HALF_EM);
    expect(layoutSourceText(layout)).toBe(text);
    expect(layout.overflow).toBe(false);
    expect(layout.columns).toHaveLength(2);
    expectKinsokuValid(layout);
    expect(layout.columns.flatMap((column) => column.items).map((item) => item.text).join("")).toContain("「『다』」");
  });

  it("adds the letter spacing to the vertical advance, not the horizontal one", () => {
    const spaced = layoutVerticalText(input({ text: "가나다", letterSpacing: 4 }), HALF_EM);
    expect(spaced.height).toBe(72); // (20 + 4) × 3
    expect(spaced.width).toBe(28);
  });
});

describe("layoutVerticalText — blockAlign", () => {
  const text = "가나다라\n마";

  it("aligns every column to the top by default", () => {
    const layout = layoutVerticalText(input({ text }), HALF_EM);
    expect(layout.columns[1]!.items[0]!.y).toBe(0);
  });

  it("centers a short column against the tallest one", () => {
    const layout = layoutVerticalText(input({ text, blockAlign: "center" }), HALF_EM);
    expect(layout.columns[1]!.items[0]!.y).toBe(30); // (80 − 20) / 2
  });

  it("pushes a short column to the bottom", () => {
    const layout = layoutVerticalText(input({ text, blockAlign: "end" }), HALF_EM);
    expect(layout.columns[1]!.items[0]!.y).toBe(60);
  });
});

describe("measureVerticalTextBlock", () => {
  it("reports the block box, column count and overflow flag", () => {
    expect(measureVerticalTextBlock(input({ text: "가나다라", maxColumnLength: 40 }), HALF_EM)).toEqual({
      width: 56,
      height: 40,
      columnCount: 2,
      overflow: false,
    });
  });

  it("grows in width, not height, as text gets longer inside a fixed column", () => {
    const short = measureVerticalTextBlock(input({ text: "가나", maxColumnLength: 40 }), HALF_EM);
    const long = measureVerticalTextBlock(input({ text: "가나다라마바", maxColumnLength: 40 }), HALF_EM);

    expect(long.height).toBe(short.height);
    expect(long.width).toBeGreaterThan(short.width);
  });
});
