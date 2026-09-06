import { describe, expect, it } from "vitest";

import { containingPanel, elBounds } from "./studio-element-geometry";

import type { El } from "./studio-element-model";

type DrawElement = Extract<El, { type: "draw" }>;
type FrameElement = Extract<El, { type: "frame" }>;

function draw(points: number[], over: Partial<DrawElement> = {}): DrawElement {
  return {
    id: "draw-1",
    type: "draw",
    points,
    stroke: "#111111",
    strokeWidth: 4,
    ...over,
  };
}

function frame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  over: Partial<FrameElement> = {}
): FrameElement {
  return {
    id,
    type: "frame",
    x,
    y,
    width,
    height,
    ...over,
  };
}

describe("elBounds", () => {
  it("returns a zero-sized origin box for an empty draw stroke", () => {
    expect(elBounds(draw([]))).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("returns a zero-sized box for a single draw point", () => {
    expect(elBounds(draw([18, -7]))).toEqual({ x: 18, y: -7, w: 0, h: 0 });
  });

  it("finds draw extrema regardless of point order and negative coordinates", () => {
    expect(elBounds(draw([12, 30, -4, 8, 42, -10, 3, 18]))).toEqual({
      x: -4,
      y: -10,
      w: 46,
      h: 40,
    });
  });

  it("preserves the legacy fallback for an odd trailing draw coordinate", () => {
    expect(elBounds(draw([10, 20, 4]))).toEqual({ x: 4, y: 20, w: 6, h: 0 });
  });

  it("derives text height from font size and ignores view rotation", () => {
    const text: El = {
      id: "text-1",
      type: "text",
      text: "대사",
      x: 14,
      y: 22,
      width: 180,
      fontSize: 25,
      fill: "#111111",
      rotation: 90,
    };

    expect(elBounds(text)).toEqual({ x: 14, y: 22, w: 180, h: 35 });
  });

  it("uses a font-size square for stickers", () => {
    const sticker: El = {
      id: "sticker-1",
      type: "sticker",
      text: "쾅",
      x: -20,
      y: 45,
      fontSize: 64,
      rotation: 35,
    };

    expect(elBounds(sticker)).toEqual({ x: -20, y: 45, w: 64, h: 64 });
  });

  it("uses stored boxes for image, bubble, frame, focus-line, and speed-line elements", () => {
    const elements: El[] = [
      {
        id: "image-1",
        type: "image",
        src: "data:image/png;base64,AA==",
        x: 1,
        y: 2,
        width: 101,
        height: 202,
        rotation: 15,
      },
      {
        id: "bubble-1",
        type: "bubble",
        variant: "speech",
        text: "안녕",
        x: 3,
        y: 4,
        width: 103,
        height: 204,
        fill: "#ffffff",
        textFill: "#111111",
        rotation: 20,
      },
      frame("frame-1", 5, 6, 105, 206),
      {
        id: "focus-1",
        type: "focusLines",
        x: 7,
        y: 8,
        width: 107,
        height: 208,
        lineCount: 16,
        innerRadius: 20,
        outerRadius: 100,
        stroke: "#111111",
        strokeWidth: 2,
        noise: 0,
        rotation: 25,
      },
      {
        id: "speed-1",
        type: "speedLines",
        x: 9,
        y: 10,
        width: 109,
        height: 210,
        lineCount: 20,
        direction: "horizontal",
        stroke: "#111111",
        strokeWidth: 2,
        rotation: 30,
      },
    ];

    expect(elements.map(elBounds)).toEqual([
      { x: 1, y: 2, w: 101, h: 202 },
      { x: 3, y: 4, w: 103, h: 204 },
      { x: 5, y: 6, w: 105, h: 206 },
      { x: 7, y: 8, w: 107, h: 208 },
      { x: 9, y: 10, w: 109, h: 210 },
    ]);
  });
});

describe("containingPanel", () => {
  it("never assigns a frame element to another frame", () => {
    const subject = frame("subject", 20, 20, 40, 40);
    const container = frame("container", 0, 0, 200, 200);

    expect(containingPanel(subject, [container, subject])).toBeNull();
  });

  it("returns null when no visible frame contains the element center", () => {
    const subject = draw([310, 310, 330, 330]);
    const distant = frame("distant", 0, 0, 200, 200);

    expect(containingPanel(subject, [subject, distant])).toBeNull();
  });

  it("ignores hidden frames and non-frame candidates", () => {
    const subject = draw([40, 40, 60, 60]);
    const hidden = frame("hidden", 0, 0, 100, 100, { hidden: true });
    const image: El = {
      id: "image-1",
      type: "image",
      src: "data:image/png;base64,AA==",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
    };

    expect(containingPanel(subject, [image, hidden, subject])).toBeNull();
  });

  it("chooses the smallest-area visible frame that contains the center", () => {
    const subject = draw([80, 80, 120, 120]);
    const large = frame("large", 0, 0, 300, 300);
    const smallest = frame("smallest", 50, 50, 100, 100);
    const medium = frame("medium", 25, 25, 200, 180);

    expect(containingPanel(subject, [large, smallest, medium, subject])?.id).toBe(
      "smallest"
    );
  });

  it("keeps the first frame when equal-area candidates tie", () => {
    const subject = draw([40, 40, 60, 60]);
    const first = frame("first", 0, 0, 100, 100);
    const second = frame("second", 10, 10, 100, 100);

    expect(containingPanel(subject, [first, second, subject])?.id).toBe("first");
  });

  it("treats frame edges as inclusive for the element center", () => {
    const subject = draw([100, 40, 100, 60]);
    const container = frame("container", 0, 0, 100, 100);

    expect(containingPanel(subject, [container, subject])?.id).toBe("container");
  });

  it("preserves the center-based policy for elements that extend partly outside a frame", () => {
    const subject = draw([-20, 20, 100, 80]);
    const container = frame("container", 0, 0, 100, 100);

    expect(containingPanel(subject, [container, subject])?.id).toBe("container");
  });

  it("excludes backdrop-sized elements beyond the 1.4x width or height threshold", () => {
    const container = frame("container", 0, 0, 100, 100);
    const tooWide = draw([-21, 40, 120, 60]);
    const tooTall = draw([40, -21, 60, 120]);

    expect(containingPanel(tooWide, [container, tooWide])).toBeNull();
    expect(containingPanel(tooTall, [container, tooTall])).toBeNull();
  });

  it("accepts an element exactly at the 1.4x size threshold", () => {
    const container = frame("container", 0, 0, 100, 100);
    const threshold = draw([-20, -20, 120, 120]);

    expect(containingPanel(threshold, [container, threshold])?.id).toBe("container");
  });
});
