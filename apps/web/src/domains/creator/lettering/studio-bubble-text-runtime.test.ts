import { describe, expect, it } from "vitest";

import { layoutVerticalText } from "../studio-vertical-text";

import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  fitBubbleFontSize,
} from "./studio-bubble-text-fit";
import {
  BUBBLE_TEXT_MEASURER,
  bubbleAutoShrinkPreview,
  formatVerticalText,
  verticalBlockAlign,
  verticalTextItemGeometry,
  verticalTextLayout,
} from "./studio-bubble-text-runtime";

import type { BubbleEl } from "../studio-element-model";

function bubble(overrides: Partial<BubbleEl> = {}): BubbleEl {
  return {
    id: "bubble-1",
    type: "bubble",
    variant: "speech",
    text: "첫 번째 대사\n두 번째 대사",
    x: 0,
    y: 0,
    width: 180,
    height: 100,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
    autoShrinkText: true,
    ...overrides,
  };
}

describe("formatVerticalText", () => {
  it("stacks a horizontal line into one character per row", () => {
    expect(formatVerticalText("가나다")).toBe("가\n나\n다");
    expect(formatVerticalText("")).toBe("");
  });

  it("orders multiline columns from right to left and pads shorter columns", () => {
    expect(formatVerticalText("가나\nABC")).toBe("A  가\nB  나\nC  　");
  });
});

describe("verticalTextLayout", () => {
  const layoutInput = {
    text: "가나ABC。\n다",
    fontSize: 20,
    lineHeight: 1.4,
    letterSpacing: 0,
    fontFamily: "Pretendard, sans-serif",
    fontStyle: "bold",
    maxColumnLength: 200,
  };

  it("binds the shared canvas measurer to the pure core", () => {
    expect(verticalTextLayout(layoutInput)).toEqual(layoutVerticalText(layoutInput, BUBBLE_TEXT_MEASURER));
  });

  it("produces right-to-left columns with a rotated latin run", () => {
    const layout = verticalTextLayout(layoutInput);

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]!.centerX).toBeGreaterThan(layout.columns[1]!.centerX);
    expect(layout.columns[0]!.items.map((item) => [item.text, item.rotation])).toEqual([
      ["가\n나", 0],
      ["ABC", 90],
      ["。", 0],
    ]);
  });
});

describe("verticalBlockAlign / verticalTextItemGeometry", () => {
  it("maps the horizontal align field onto the column axis", () => {
    expect(verticalBlockAlign(undefined)).toBe("start");
    expect(verticalBlockAlign("left")).toBe("start");
    expect(verticalBlockAlign("center")).toBe("center");
    expect(verticalBlockAlign("right")).toBe("end");
  });

  it("turns the per-glyph advance into a line-height multiplier for upright runs", () => {
    const spaced = verticalTextLayout({
      text: "가나",
      fontSize: 20,
      lineHeight: 1.4,
      letterSpacing: 6,
      fontFamily: "Pretendard, sans-serif",
    });
    expect(verticalTextItemGeometry(spaced.columns[0]!.items[0]!, 20)).toEqual({
      boxWidth: 20,
      lineHeight: 1.3, // (20 + 6) / 20
      scaleX: 1,
    });
  });

  it("keeps rotated runs on a single line box", () => {
    const layout = verticalTextLayout({
      text: "ABC",
      fontSize: 20,
      lineHeight: 1.4,
      fontFamily: "Pretendard, sans-serif",
    });
    expect(verticalTextItemGeometry(layout.columns[0]!.items[0]!, 20)).toEqual({
      boxWidth: 20,
      lineHeight: 1,
      scaleX: 1,
    });
  });

  it("returns an inverse-width box for one-cell tate-chu-yoko scaling", () => {
    const layout = verticalTextLayout({
      text: "2026",
      fontSize: 20,
      lineHeight: 1.4,
      fontFamily: "Pretendard, sans-serif",
    });
    const item = layout.columns[0]!.items[0]!;
    expect(item.form).toBe("tate-chu-yoko");
    const geometry = verticalTextItemGeometry(item, 20);
    expect(geometry.scaleX).toBeGreaterThan(0);
    expect(geometry.scaleX).toBeLessThanOrEqual(1);
    expect(geometry.boxWidth * geometry.scaleX).toBeCloseTo(20, 8);
    expect(geometry.lineHeight).toBe(1);
  });
});

describe("bubbleAutoShrinkPreview", () => {
  it("skips measurement when fixed-size auto shrink is disabled", () => {
    expect(bubbleAutoShrinkPreview(bubble({ autoShrinkText: false }), 1.35)).toBeNull();
    expect(bubbleAutoShrinkPreview(bubble({ autoShrinkText: undefined }), 1.35)).toBeNull();
  });

  it("keeps horizontal preview inputs in parity with the shared fit engine", () => {
    const el = bubble({
      text: "가로쓰기 말풍선의 긴 대사를 자동으로 축소하는 미리보기",
      fontSize: 26,
      autoShrinkMinFontSize: 12,
      font: "Nanum Gothic, sans-serif",
      fontStyle: "italic",
    });
    const lineHeight = 1.35;

    expect(bubbleAutoShrinkPreview(el, lineHeight)).toEqual(
      fitBubbleFontSize(
        {
          text: el.text,
          boxWidth: el.width,
          boxHeight: el.height,
          maxFontSize: 26,
          minFontSize: 12,
          fontFamily: "Nanum Gothic, sans-serif",
          fontStyle: "italic",
          lineHeight,
        },
        BUBBLE_TEXT_MEASURER
      )
    );
  });

  it("uses the same vertical formatting and legacy defaults as the render path", () => {
    const el = bubble({
      text: "가나다라마바사",
      width: 100,
      height: 150,
      vertical: true,
      fontSize: undefined,
      autoShrinkMinFontSize: undefined,
    });
    const lineHeight = 1.4;
    const expected = fitBubbleFontSize(
      {
        text: formatVerticalText(el.text),
        boxWidth: el.width,
        boxHeight: el.height,
        maxFontSize: 24,
        minFontSize: BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
        fontFamily: "Pretendard, sans-serif",
        fontStyle: "bold",
        lineHeight,
      },
      BUBBLE_TEXT_MEASURER
    );
    const unformatted = fitBubbleFontSize(
      {
        text: el.text,
        boxWidth: el.width,
        boxHeight: el.height,
        maxFontSize: 24,
        minFontSize: BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
        fontFamily: "Pretendard, sans-serif",
        fontStyle: "bold",
        lineHeight,
      },
      BUBBLE_TEXT_MEASURER
    );

    expect(bubbleAutoShrinkPreview(el, lineHeight)).toEqual(expected);
    expect(expected.fontSize).toBeLessThan(unformatted.fontSize);
  });
});
