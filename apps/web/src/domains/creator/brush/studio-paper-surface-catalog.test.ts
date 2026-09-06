import { describe, expect, it } from "vitest";

import {
  assertStudioPaperSurfaceCatalogComplete,
  getStudioPaperSurfaceCatalogEntry,
  getStudioPaperSurfaceCharacteristics,
  listStudioPaperSurfaceCatalogByGroup,
  livingInkMaterialPatchForPaper,
  matchPaperKindFromLivingInkMaterial,
  planStudioPaperSurfaceApply,
  planStudioPaperSurfaceSelection,
  STUDIO_PAPER_SURFACE_CATALOG,
  studioPaperSurfaceSwatchStyle,
} from "./studio-paper-surface-catalog";
import {
  PAPER_GRAIN_KINDS,
} from "./studio-paper-texture";

describe("studio paper surface catalog", () => {
  it("covers every physics paper kind exactly once", () => {
    expect(() => assertStudioPaperSurfaceCatalogComplete()).not.toThrow();
    expect(STUDIO_PAPER_SURFACE_CATALOG).toHaveLength(PAPER_GRAIN_KINDS.length);
    const ids = STUDIO_PAPER_SURFACE_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of STUDIO_PAPER_SURFACE_CATALOG) {
      expect(entry.cue.trim().length, entry.id).toBeGreaterThan(5);
      expect(entry.description.trim().length, entry.id).toBeGreaterThan(40);
      expect(entry.bestFor.trim().length, entry.id).toBeGreaterThan(5);
    }
  });

  it("groups catalog entries for the picker UI", () => {
    const groups = listStudioPaperSurfaceCatalogByGroup();
    expect(groups.length).toBeGreaterThanOrEqual(3);
    const flat = groups.flatMap((section) => section.entries.map((entry) => entry.id));
    expect(flat.sort()).toEqual([...PAPER_GRAIN_KINDS].sort());
  });

  it("resolves unknown kinds to the default catalog row", () => {
    expect(getStudioPaperSurfaceCatalogEntry("papyrus").id).toBe("cold-press");
    expect(getStudioPaperSurfaceCatalogEntry("washi").id).toBe("washi");
  });

  it("plans a document surface selection and swatch styles", () => {
    expect(planStudioPaperSurfaceSelection("charcoal", 12)).toEqual({
      kind: "charcoal",
      seed: 12,
    });
    const entry = getStudioPaperSurfaceCatalogEntry("canvas");
    const style = studioPaperSurfaceSwatchStyle(entry);
    expect(style.backgroundColor).toMatch(/^#/);
    expect(style.backgroundImage.length).toBeGreaterThan(20);
    expect(entry.tintBg).toMatch(/^#/);
    expect(entry.livingInk.paperTooth).toBeGreaterThan(0);
  });

  it("maps Living Ink materials to the shared paper catalog", () => {
    const patch = livingInkMaterialPatchForPaper("washi");
    expect(patch.paperFiber).toBeGreaterThan(0.4);
    expect(patch.bleed).toBeGreaterThan(0.7);
    expect(patch.dryRate).toBeLessThan(0.5);
    expect(matchPaperKindFromLivingInkMaterial(patch)).toBe("washi");
    const plan = planStudioPaperSurfaceApply({ kind: "kraft", applyTintBackground: true });
    expect(plan.tintBg).toBe(getStudioPaperSurfaceCatalogEntry("kraft").tintBg);
    expect(plan.surface.kind).toBe("kraft");
  });

  it("describes comparable physical axes from the render profile", () => {
    const hot = getStudioPaperSurfaceCharacteristics("hot-press");
    const cold = getStudioPaperSurfaceCharacteristics("cold-press");
    const rough = getStudioPaperSurfaceCharacteristics("rough");
    expect(hot.map((axis) => axis.id)).toEqual([
      "tooth",
      "absorbency",
      "bleed",
      "friction",
    ]);
    for (const axes of [hot, cold, rough]) {
      expect(axes.every((axis) => axis.value >= 0 && axis.value <= 1)).toBe(true);
      expect(axes.every((axis) => axis.valueLabel.length > 0)).toBe(true);
    }
    for (let index = 0; index < hot.length; index += 1) {
      expect(hot[index]!.value).toBeLessThan(cold[index]!.value);
      expect(cold[index]!.value).toBeLessThan(rough[index]!.value);
    }
  });
});
