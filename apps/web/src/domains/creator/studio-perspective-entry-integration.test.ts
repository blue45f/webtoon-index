import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./studio-drawing-assist-handlers.ts", import.meta.url), "utf8");

describe("Studio perspective entry integration", () => {
  it("creates a usable default vanishing point when any UI enables an empty perspective ruler", () => {
    const setterStart = page.indexOf("function setPerspectiveRulerActive(");
    const nextSetter = page.indexOf("function setIsometricGridActive(", setterStart);
    const setter = page.slice(setterStart, nextSetter);

    expect(setterStart).toBeGreaterThanOrEqual(0);
    expect(setter).toContain("if (active && points.length === 0)");
    expect(setter).toContain("defaultVanishingPointPosition(points, CANVAS_W, canvasH)");
    expect(setter).toContain("points = addVanishingPoint(points");
    expect(setter).toContain("perspective: { ...current.perspective, active, points }");
  });
});
