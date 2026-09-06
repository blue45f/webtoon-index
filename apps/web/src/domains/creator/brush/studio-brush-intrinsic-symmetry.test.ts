import { describe, expect, it } from "vitest";

import {
  resolveStudioBrushIntrinsicSymmetry,
  STUDIO_BRUSH_INTRINSIC_SYMMETRY_IDS,
} from "./studio-brush-intrinsic-symmetry";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "./studio-brush-runtime-contract";

describe("studio brush intrinsic symmetry", () => {
  it("names only presets that exist in the runtime contract", () => {
    // An entry for a id that no document can hold would be a promise to nobody.
    const known = new Set(STUDIO_BRUSH_RUNTIME_CONTRACT.map(({ id }) => id));
    for (const id of STUDIO_BRUSH_INTRINSIC_SYMMETRY_IDS) {
      expect(known.has(id), id).toBe(true);
    }
  });

  it("gives every listed preset a fan that matches what its name promises", () => {
    expect(resolveStudioBrushIntrinsicSymmetry("web-mirror-ink")?.type).toBe("vertical");
    expect(resolveStudioBrushIntrinsicSymmetry("sketchpad-mirror")?.type).toBe("vertical");
    const kaleido = resolveStudioBrushIntrinsicSymmetry("web-kaleido-ink");
    expect(kaleido?.type).toBe("kaleidoscope");
    expect(kaleido?.radialCount).toBeGreaterThan(1);
  });

  it("leaves every other brush alone", () => {
    // This is what keeps the change from touching any existing stroke: a brush with no intrinsic
    // symmetry resolves to null and the pointer-start planner's behaviour is unchanged for it.
    for (const id of ["pen", "brush", "pastel", "watercolor", "web-radial-burst"]) {
      expect(resolveStudioBrushIntrinsicSymmetry(id), id).toBeNull();
    }
    expect(resolveStudioBrushIntrinsicSymmetry(undefined)).toBeNull();
    expect(resolveStudioBrushIntrinsicSymmetry(42)).toBeNull();
  });
});
