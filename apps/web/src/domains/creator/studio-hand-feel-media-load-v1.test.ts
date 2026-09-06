import { describe, expect, it } from "vitest";

import { applyStudioBrushAliasWatercolorMaterial } from "./brush/studio-brush-alias-profile";
import {
  createStudioWetInkField,
  depositStudioWetInkStroke,
  readStudioWetInkCell,
} from "./brush/studio-wet-ink-field";
import {
  resolveStudioHandFeelMediaLoadV1,
  studioHandFeelTravelSpeedV1,
  STUDIO_HAND_FEEL_MEDIA_LOAD_V1,
} from "./studio-hand-feel-media-load-v1";


describe("studio hand-feel media load v1", () => {
  it("is identity at rest and thins pigment on a flick", () => {
    const rest = resolveStudioHandFeelMediaLoadV1({ speed: 0, pressure: 0.55 });
    expect(rest.version).toBe(STUDIO_HAND_FEEL_MEDIA_LOAD_V1);
    expect(rest.pigmentScale).toBeCloseTo(1, 8);
    expect(rest.waterScale).toBeCloseTo(1, 8);
    expect(rest.coverageScale).toBeCloseTo(1, 8);
    const flick = resolveStudioHandFeelMediaLoadV1({
      speed: 1,
      pressure: 0.55,
      family: "sumi",
    });
    expect(flick.pigmentScale).toBeLessThan(rest.pigmentScale * 0.75);
    expect(flick.coverageScale).toBeLessThan(rest.coverageScale);
    expect(studioHandFeelTravelSpeedV1(0, 10)).toBe(0);
    expect(studioHandFeelTravelSpeedV1(2.5, 10)).toBe(0);
    expect(studioHandFeelTravelSpeedV1(17.5, 10)).toBeCloseTo(1, 8);
  });

  it("deposits less ink-wash pigment on a fast pass than a dwell", () => {
    const field = (speed: "dwell" | "flick") => {
      const created = createStudioWetInkField({
        width: 48,
        height: 16,
        tileSize: 16,
        chromatography: 0.72,
        waterDiffusion: 0,
        pigmentDiffusion: 0,
        bleed: 0,
        absorption: 0,
        evaporation: 0,
        dryingRate: 0,
        fixationRate: 0,
      });
      if (!created.ok) throw new Error(created.reason);
      const samples = speed === "dwell"
        ? [
            { x: 8, y: 8, timeMs: 0, pressure: 0.8 },
            { x: 10, y: 8, timeMs: 80, pressure: 0.8 },
            { x: 12, y: 8, timeMs: 160, pressure: 0.8 },
          ]
        : [
            { x: 8, y: 8, timeMs: 0, pressure: 0.8 },
            { x: 28, y: 8, timeMs: 8, pressure: 0.8 },
            { x: 46, y: 8, timeMs: 16, pressure: 0.8 },
          ];
      const deposited = depositStudioWetInkStroke(created.value, {
        samples,
        radius: 3,
        hardness: 1,
        spacing: speed === "dwell" ? 2 : 10,
        waterLoad: 0.8,
        pigmentLoad: 1,
        wetnessLoad: 0.9,
      });
      if (!deposited.ok) throw new Error(deposited.reason);
      return created.value;
    };
    const dwell = field("dwell");
    const flick = field("flick");
    const dwellMass = readStudioWetInkCell(dwell, 10, 8)!.pigment;
    const flickMass = readStudioWetInkCell(flick, 28, 8)!.pigment;
    expect(dwellMass).toBeGreaterThan(0);
    expect(flickMass).toBeGreaterThan(0);
    expect(flickMass).toBeLessThan(dwellMass);
  });

  it("does not treat planned watercolor station travel as hand speed", () => {
    const rest = applyStudioBrushAliasWatercolorMaterial("watercolor", [
      { x: 0, y: 0, radius: 10, opacity: 0.5, role: "core" },
      { x: 2, y: 0, radius: 10, opacity: 0.5, role: "core" },
    ]);
    expect(rest[0]?.opacity).toBeCloseTo(0.5 * 1.42, 8);
    expect(rest[1]?.opacity).toBeCloseTo(rest[0]!.opacity, 8);
    const spaced = applyStudioBrushAliasWatercolorMaterial("watercolor", [
      { x: 0, y: 0, radius: 8, opacity: 0.5, role: "core" },
      { x: 40, y: 0, radius: 8, opacity: 0.5, role: "core" },
    ]);
    expect(spaced[1]!.opacity).toBeCloseTo(spaced[0]!.opacity, 8);
  });

  it("maps a long oil flick to a higher travel speed than a dwell", () => {
    const dwell = studioHandFeelTravelSpeedV1(3, 8);
    const flick = studioHandFeelTravelSpeedV1(40, 8);
    expect(dwell).toBeLessThan(0.2);
    expect(flick).toBeGreaterThan(0.8);
    expect(
      resolveStudioHandFeelMediaLoadV1({ speed: flick, family: "oil" }).coverageScale,
    ).toBeLessThan(
      resolveStudioHandFeelMediaLoadV1({ speed: dwell, family: "oil" }).coverageScale,
    );
  });
});
