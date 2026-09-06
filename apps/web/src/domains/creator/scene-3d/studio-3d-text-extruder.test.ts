import { describe, expect, it } from "vitest";

import {
  plan3dTextExtrusion,
  SFX_ONOPATOPOEIA_PRESETS,
} from "./studio-3d-text-extruder";

describe("Studio 3D Text & Webtoon SFX Onomatopoeia Extruder", () => {
  it("provides popular onomatopoeia presets with default styling", () => {
    expect(SFX_ONOPATOPOEIA_PRESETS.length).toBeGreaterThanOrEqual(6);
    const boom = SFX_ONOPATOPOEIA_PRESETS.find((p) => p.id === "sfx-boom");
    expect(boom).toBeDefined();
    expect(boom?.text).toBe("쾅!!");
    expect(boom?.defaultColor).toBe("#ef4444");
  });

  it("plans 3D extruded text layout and bounding box calculation", () => {
    const res = plan3dTextExtrusion({
      text: "BOOM",
      fontStyle: "manga-impact",
      extrudeDepth: 0.5,
      bevelThickness: 0.1,
      bevelSegments: 2,
      arcAngleDegrees: 30,
      letterSpacing: 0.2,
      size: 1.5,
    });

    expect(res.text).toBe("BOOM");
    expect(res.characterTransforms.length).toBe(4);
    expect(res.triangleCount).toBeGreaterThan(0);
    expect(res.boundingBox.min[0]).toBeLessThan(res.boundingBox.max[0]);
    expect(res.boundingBox.min[2]).toBe(-0.25);
    expect(res.boundingBox.max[2]).toBe(0.25);
  });

  it("handles empty text safely", () => {
    const res = plan3dTextExtrusion({
      text: "",
      fontStyle: "comic-pop",
      extrudeDepth: 0.2,
      bevelThickness: 0,
      bevelSegments: 1,
      arcAngleDegrees: 0,
      letterSpacing: 0,
      size: 1,
    });

    expect(res.vertexCount).toBe(0);
    expect(res.characterTransforms.length).toBe(0);
  });
});
