import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS,
  studioDynamicBrushDabVariations,
  studioDynamicBrushDabVariationsFromTransforms,
  studioBrushSymmetryTransforms,
  transformStudioDynamicBrushDab,
} from "./studio-brush-symmetry";

import type { StudioDynamicBrushDab } from "./studio-brush-dynamics";

const dab: StudioDynamicBrushDab = {
  index: 0,
  progress: 0.5,
  sourceX: 12,
  sourceY: 4,
  x: 13,
  y: 5,
  size: 8,
  opacity: 0.8,
  flow: 0.6,
  spacing: 2,
  scatter: 1.5,
  angle: 30,
  roundness: 0.4,
};

describe("studioBrushSymmetryTransforms", () => {
  it("mirrors the source, scatter offset and elliptical axis together", () => {
    const vertical = studioBrushSymmetryTransforms({
      type: "vertical",
      centerX: 10,
      centerY: 0,
    })[1]!;
    const mirrored = transformStudioDynamicBrushDab(dab, vertical);
    expect(mirrored.sourceX).toBe(8);
    expect(mirrored.sourceY).toBe(4);
    expect(mirrored.x).toBe(7);
    expect(mirrored.y).toBe(5);
    expect(mirrored.x - mirrored.sourceX).toBe(-(dab.x - dab.sourceX));
    expect(mirrored.angle).toBeCloseTo(150);
    expect(mirrored.size).toBe(dab.size);
    expect(mirrored.roundness).toBe(dab.roundness);
  });

  it("rotates radial dabs and angles around the symmetry center", () => {
    const transforms = studioBrushSymmetryTransforms({
      type: "radial",
      centerX: 10,
      centerY: 4,
      radialCount: 4,
    });
    expect(transforms).toHaveLength(4);
    const rotated = transformStudioDynamicBrushDab(dab, transforms[1]!);
    expect(rotated.sourceX).toBeCloseTo(10);
    expect(rotated.sourceY).toBeCloseTo(6);
    expect(rotated.angle).toBeCloseTo(120);
  });

  it("matches kaleidoscope ordering: N rotations followed by N reflections", () => {
    const transforms = studioBrushSymmetryTransforms({
      type: "kaleidoscope",
      centerX: 0,
      centerY: 0,
      radialCount: 5,
    });
    expect(transforms).toHaveLength(10);
    const firstReflection = transformStudioDynamicBrushDab(dab, transforms[5]!);
    expect(firstReflection.sourceX).toBeCloseTo(dab.sourceX);
    expect(firstReflection.sourceY).toBeCloseTo(-dab.sourceY);
    expect(firstReflection.angle).toBeCloseTo(-30);
  });

  it("uses the established four-way fallback for corrupt radial counts", () => {
    expect(studioBrushSymmetryTransforms({
      type: "radial",
      centerX: Number.NaN,
      centerY: Number.POSITIVE_INFINITY,
      radialCount: Number.NaN,
    })).toHaveLength(4);
  });

  it("caps untrusted radial and kaleidoscope fans at the live GPU contract", () => {
    expect(studioBrushSymmetryTransforms({
      type: "radial",
      centerX: 0,
      centerY: 0,
      radialCount: Number.MAX_SAFE_INTEGER,
    })).toHaveLength(STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS);
    expect(studioBrushSymmetryTransforms({
      type: "kaleidoscope",
      centerX: 0,
      centerY: 0,
      radialCount: Number.MAX_SAFE_INTEGER,
    })).toHaveLength(STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS * 2);
  });

  it("creates every variation from one base dab plan without mutating it", () => {
    const original = structuredClone(dab);
    const symmetry = {
      type: "vertical" as const,
      centerX: 10,
      centerY: 0,
    };
    const baseDabs = [dab];
    const variations = studioDynamicBrushDabVariations(baseDabs, {
      ...symmetry,
    });
    const fromPrecomputed = studioDynamicBrushDabVariationsFromTransforms(
      baseDabs,
      studioBrushSymmetryTransforms(symmetry)
    );
    expect(variations).toHaveLength(2);
    expect(variations[0]).toBe(baseDabs);
    expect(fromPrecomputed[0]).toBe(baseDabs);
    expect(fromPrecomputed).toEqual(variations);
    expect(variations[0]?.[0]).toEqual(dab);
    expect(variations[1]?.[0]?.x).toBe(7);
    expect(dab).toEqual(original);
  });
});
