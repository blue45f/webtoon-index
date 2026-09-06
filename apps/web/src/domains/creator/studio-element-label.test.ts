import { describe, expect, it } from "vitest";

import { elementLabel } from "./studio-element-label";

import type { El } from "./studio-element-model";

function labelOf(element: El): string {
  return elementLabel(element);
}

describe("elementLabel", () => {
  it("preserves a user-defined layer name for every element kind", () => {
    const draw: El = {
      id: "draw-named",
      type: "draw",
      points: [],
      stroke: "#111111",
      strokeWidth: 4,
      name: "  주인공 잉크  ",
    };

    expect(labelOf(draw)).toBe("  주인공 잉크  ");
    expect(labelOf({ ...draw, name: "   " })).toBe("   ");
    expect(labelOf({ ...draw, name: "" })).toBe("✏️ 그림");
  });

  it("truncates text previews to fourteen characters and falls back for blank text", () => {
    const text: El = {
      id: "text",
      type: "text",
      text: " 123456789012345",
      x: 0,
      y: 0,
      width: 200,
      fontSize: 24,
      fill: "#111111",
      rotation: 0,
    };

    expect(labelOf(text)).toBe("T 1234567890123");
    expect(labelOf({ ...text, text: "    " })).toBe("T 텍스트");
  });

  it("uses the configured bubble label and keeps the legacy unknown-variant fallback", () => {
    const bubble: El = {
      id: "bubble",
      type: "bubble",
      variant: "speech",
      text: "안녕",
      x: 0,
      y: 0,
      width: 240,
      height: 140,
      fill: "#ffffff",
      textFill: "#111111",
      rotation: 0,
    };

    expect(labelOf(bubble)).toBe("말하기 말풍선");
    expect(
      labelOf({ ...bubble, variant: "not-in-catalog" } as unknown as El)
    ).toBe("대사 말풍선");
  });

  it("preserves the established labels for every non-text element kind", () => {
    const elements: El[] = [
      {
        id: "sticker",
        type: "sticker",
        text: "쾅!",
        x: 0,
        y: 0,
        fontSize: 48,
        rotation: 0,
      },
      {
        id: "draw",
        type: "draw",
        points: [],
        stroke: "#111111",
        strokeWidth: 4,
      },
      {
        id: "frame",
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
      },
      {
        id: "image",
        type: "image",
        src: "data:image/png;base64,AA==",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        rotation: 0,
      },
      {
        id: "focus",
        type: "focusLines",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        lineCount: 16,
        innerRadius: 24,
        outerRadius: 120,
        stroke: "#111111",
        strokeWidth: 2,
        noise: 0,
        rotation: 0,
      },
      {
        id: "speed",
        type: "speedLines",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        lineCount: 16,
        direction: "horizontal",
        stroke: "#111111",
        strokeWidth: 2,
        rotation: 0,
      },
    ];

    expect(elements.map(labelOf)).toEqual([
      "쾅! 스티커",
      "✏️ 그림",
      "▢ 패널",
      "🖼️ 이미지",
      "🔆 집중선",
      "💨 속도선",
    ]);
  });

  it("keeps the defensive unknown-element fallback", () => {
    expect(elementLabel({ id: "future", type: "future" } as unknown as El)).toBe(
      "요소"
    );
  });
});
