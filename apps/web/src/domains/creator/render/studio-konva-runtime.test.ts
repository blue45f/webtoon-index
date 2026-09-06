import KonvaCore from "konva/lib/Core";
import { describe, expect, it } from "vitest";

import { studioKonvaRuntime } from "./studio-konva-runtime";

const STUDIO_KONVA_SHAPES = [
  "Arrow",
  "Circle",
  "Ellipse",
  "Image",
  "Line",
  "Path",
  "Rect",
  "Star",
  "Text",
  "TextPath",
  "Transformer",
] as const;

describe("studio Konva runtime", () => {
  it("reuses Konva Core's process-wide singleton and initializes its filter registry", () => {
    expect(studioKonvaRuntime).toBe(KonvaCore);
    expect(studioKonvaRuntime.Filters).toBeDefined();
    expect(typeof studioKonvaRuntime.Filters).toBe("object");
  });

  it.each(STUDIO_KONVA_SHAPES)("registers the %s constructor", (shapeName) => {
    expect(typeof studioKonvaRuntime[shapeName]).toBe("function");
  });

  it("constructs a real Arrow instead of react-konva's missing-node Group fallback", () => {
    const arrow = new studioKonvaRuntime.Arrow({
      points: [0, 0, 40, 20],
      pointerLength: 10,
      pointerWidth: 10,
    });

    expect(arrow.getClassName()).toBe("Arrow");
    expect(arrow.points()).toEqual([0, 0, 40, 20]);
  });
});
