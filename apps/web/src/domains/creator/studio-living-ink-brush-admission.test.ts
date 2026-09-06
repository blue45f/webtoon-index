import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVING_INK_NEW_PHYSICAL_STROKES_ENABLED,
  studioLivingInkAdmitsBrush,
  studioLivingInkExplicitBrushKey,
  studioLivingInkSupportsExplicitBrush,
} from "./studio-living-ink-brush-admission";

describe("studio Living Ink brush admission", () => {
  it.each([
    ["ink-particle", "watercolor-detail-round"],
    ["airbrush", "watercolor-flat-wash"],
    ["airbrush", "watercolor-wet-bleed"],
    ["airbrush", "watercolor-edge-stain"],
    ["dry-media", "watercolor-dry-granule"],
    ["airbrush", "watercolor-salt-bloom"],
    ["airbrush", "watercolor-backrun-ring"],
    ["airbrush", "watercolor-wet-wash"],
    ["dry-media", "sumi-wash-fray"],
  ])("never hijacks the %s runtime because catalogue id is %s", (brushId, catalogId) => {
    expect(studioLivingInkSupportsExplicitBrush(brushId, catalogId)).toBe(false);
    expect(studioLivingInkAdmitsBrush({
      brushId,
      catalogId,
      physicalModeEnabled: true,
    })).toBe(false);
  });

  it.each([
    "watercolor",
    "ink-wash",
    "sumi",
    "sumi-e",
  ])("keeps retired page-wide materialization closed for exact built-in %s", (brushId) => {
    expect(STUDIO_LIVING_INK_NEW_PHYSICAL_STROKES_ENABLED).toBe(false);
    expect(studioLivingInkExplicitBrushKey(brushId, brushId)).not.toBeNull();
    expect(studioLivingInkAdmitsBrush({
      brushId,
      catalogId: brushId,
      physicalModeEnabled: false,
    })).toBe(false);
    expect(studioLivingInkAdmitsBrush({
      brushId,
      catalogId: brushId,
      physicalModeEnabled: true,
    })).toBe(false);
  });

  it.each([
    "inkwash-pen",
    "inkwash-water-brush",
    "inkwash-bleed-wash",
    "inkwash-white-ink",
  ])("keeps specialized wet-runtime semantics for %s even when physical mode is requested", (brushId) => {
    expect(studioLivingInkSupportsExplicitBrush(brushId, brushId)).toBe(false);
    expect(studioLivingInkAdmitsBrush({
      brushId,
      catalogId: brushId,
      physicalModeEnabled: true,
    })).toBe(false);
  });

  it("does not infer renderer capability from a substring or a mismatched saved preset", () => {
    expect(studioLivingInkSupportsExplicitBrush("airbrush", "my-watercolor-experiment")).toBe(false);
    expect(studioLivingInkSupportsExplicitBrush("watercolor-fast", "watercolor-fast")).toBe(false);
    expect(studioLivingInkSupportsExplicitBrush("watercolor", "saved-watercolor-brush")).toBe(false);
  });

  it("normalizes exact built-in identity without broadening the contract", () => {
    expect(studioLivingInkExplicitBrushKey(" Ink-Wash ", "INK-WASH")).toBe(
      "ink-wash\u001fink-wash",
    );
    expect(studioLivingInkExplicitBrushKey(null, "watercolor")).toBeNull();
    expect(studioLivingInkExplicitBrushKey("watercolor", "")).toBe(
      "watercolor\u001fwatercolor",
    );
  });
});
