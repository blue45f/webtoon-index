import { describe, expect, it } from "vitest";

import {
  COMPOSITE_CATEGORIES,
  COMPOSITE_PRESETS,
  instantiateCompositePreset,
  type BgCompositeCategory,
} from "./studio-background-3d-composites";
import { PRIMITIVE_DEFS, type BgPrimitiveKind } from "./studio-background-3d-primitives";

const VALID_KINDS = new Set(Object.keys(PRIMITIVE_DEFS) as BgPrimitiveKind[]);

function isFiniteTriple(v: [number, number, number]): boolean {
  return v.length === 3 && v.every(Number.isFinite);
}

describe("studio-background-3d-composites", () => {
  it("every preset part references a valid BgPrimitiveKind", () => {
    for (const preset of COMPOSITE_PRESETS) {
      for (const part of preset.parts) {
        expect(VALID_KINDS.has(part.kind)).toBe(true);
      }
    }
  });

  it("every preset part has finite offset/rotation/scale, and every preset has footprint > 0 and at least one part", () => {
    for (const preset of COMPOSITE_PRESETS) {
      expect(preset.footprint).toBeGreaterThan(0);
      expect(preset.parts.length).toBeGreaterThanOrEqual(1);
      for (const part of preset.parts) {
        expect(isFiniteTriple(part.offset)).toBe(true);
        expect(isFiniteTriple(part.rotation)).toBe(true);
        expect(isFiniteTriple(part.scale)).toBe(true);
      }
    }
  });

  it("every composite category has at least one preset", () => {
    for (const category of COMPOSITE_CATEGORIES) {
      const presetsInCategory = COMPOSITE_PRESETS.filter((p) => p.category === category);
      expect(presetsInCategory.length).toBeGreaterThan(0);
    }
  });

  it("category labels cover exactly the BgCompositeCategory union", () => {
    const categoriesFromPresets = new Set(COMPOSITE_PRESETS.map((p) => p.category));
    const expected: BgCompositeCategory[] = ["building", "nature", "vehicle", "prop"];
    for (const category of expected) {
      expect(COMPOSITE_CATEGORIES).toContain(category);
    }
    // sanity: no preset uses a category outside the declared union
    for (const category of categoriesFromPresets) {
      expect(COMPOSITE_CATEGORIES).toContain(category);
    }
  });

  it("instantiateCompositePreset returns one primitive per part, preserving kind order, with unique ids", () => {
    for (const preset of COMPOSITE_PRESETS) {
      const result = instantiateCompositePreset(preset, 0);
      expect(result.length).toBe(preset.parts.length);
      expect(result.map((p) => p.kind)).toEqual(preset.parts.map((p) => p.kind));
      const ids = new Set(result.map((p) => p.id));
      expect(ids.size).toBe(result.length);
    }
  });

  it("result[0] is the anchor part (matches parts[0])", () => {
    const preset = COMPOSITE_PRESETS.find((p) => p.parts.length > 1)!;
    const result = instantiateCompositePreset(preset, 0);
    expect(result[0].kind).toBe(preset.parts[0].kind);
    expect(result[0].color).toBe(preset.parts[0].color);
  });

  it("does not share array references across two instantiations (purity)", () => {
    const preset = COMPOSITE_PRESETS[0];
    const first = instantiateCompositePreset(preset, 0);
    const second = instantiateCompositePreset(preset, 0);

    const originalPosition = [...second[0].position];
    first[0].position[0] = 9999;
    expect(second[0].position).toEqual(originalPosition);

    const originalPartOffset = [...preset.parts[0].offset];
    first[0].position[1] = -9999;
    expect(preset.parts[0].offset).toEqual(originalPartOffset);

    const originalRotation = [...preset.parts[0].rotation];
    first[0].rotation[0] = 12345;
    expect(preset.parts[0].rotation).toEqual(originalRotation);

    const originalScale = [...preset.parts[0].scale];
    first[0].scale[0] = 12345;
    expect(preset.parts[0].scale).toEqual(originalScale);
  });

  it("anchorX grows with existingCount and resets every 5, scaled by footprint", () => {
    const preset = COMPOSITE_PRESETS[0];
    const anchorXs = Array.from({ length: 6 }, (_, i) => instantiateCompositePreset(preset, i)[0].position[0]);
    // existingCount % 5 cycles 0,1,2,3,4,0 -> anchorX[5] should equal anchorX[0]
    expect(anchorXs[5]).toBeCloseTo(anchorXs[0]);
    expect(anchorXs[1]).toBeCloseTo(anchorXs[0] + preset.footprint * 1.5);
    expect(anchorXs[4]).toBeCloseTo(anchorXs[0] + 4 * preset.footprint * 1.5);
  });
});
