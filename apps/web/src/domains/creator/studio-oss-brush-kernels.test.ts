import { describe, expect, it } from "vitest";

import {
  describeStudioOssBrushHybridStack,
  resolveStudioOssBrushHybridFamily,
  STUDIO_OSS_BRUSH_HYBRID_ROUTES,
} from "./studio-oss-brush-hybrid-registry";
import {
  STUDIO_OSS_DRY_CARRIER_RECIPE,
  STUDIO_OSS_OIL_FILM_RECIPE,
  studioOssApplyMaterialColorChannel,
  studioOssEqualAreaDiskOffset,
  studioOssFabricCrayonGrainAdhesion,
  studioOssFabricLongFurTangentOffset,
  studioOssFabricSquaresMeshOffset,
  studioOssHarmonyProximityCoupling,
  studioOssKlecksChalkCoverage,
  studioOssKlecksSmudgeColorBlend,
  studioOssMaterialColorModeForProfile,
  studioOssOilBristleFilm,
  studioOssP5BrushFlowfieldVector,
  studioOssSprayTipCoverage,
  studioOssWatercolorTipCoverage,
} from "./studio-oss-brush-kernels";

describe("studio OSS brush kernels (verified hybrid)", () => {
  it("uses equal-area √U disk scatter (Klecks/Krita polar distance)", () => {
    const samples = Array.from({ length: 400 }, (_, index) =>
      studioOssEqualAreaDiskOffset(7, index, 10),
    );
    const meanR =
      samples.reduce((sum, s) => sum + s.distance, 0) / samples.length;
    // Uniform disk mean radius is 2/3 R ≈ 6.67; raw U would mean ≈5.
    expect(meanR).toBeGreaterThan(5.8);
    expect(meanR).toBeLessThan(7.6);
    expect(samples.every((s) => s.distance <= 10 + 1e-9)).toBe(true);
    // Deterministic
    expect(studioOssEqualAreaDiskOffset(7, 3, 10)).toEqual(
      studioOssEqualAreaDiskOffset(7, 3, 10),
    );
  });

  it("builds Klecks chalk multi-octave coverage that is denser at centre", () => {
    const centre = studioOssKlecksChalkCoverage(0, 0, 0x41);
    const edge = studioOssKlecksChalkCoverage(0.92, 0, 0x41);
    const outside = studioOssKlecksChalkCoverage(1.2, 0, 0x41);
    expect(centre).toBeGreaterThan(edge);
    expect(outside).toBe(0);
    expect(centre).toBeGreaterThan(0.05);
  });

  it("builds spray tips with grit and soft falloff, not a flat disc", () => {
    const centre = studioOssSprayTipCoverage(0, 0, 99, 0.08);
    const mid = studioOssSprayTipCoverage(0.45, 0.2, 99, 0.08);
    const rim = studioOssSprayTipCoverage(0.9, 0, 99, 0.08);
    expect(centre).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(rim);
    // Grit makes nearby samples non-equal even at similar radii.
    const a = studioOssSprayTipCoverage(0.5, 0.1, 99, 0.08);
    const b = studioOssSprayTipCoverage(0.1, 0.5, 99, 0.08);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });

  it("adds a wet-edge ring contribution for watercolor tips", () => {
    const core = studioOssWatercolorTipCoverage(0, 0, 11, 0.3);
    const nearEdge = studioOssWatercolorTipCoverage(0.92, 0, 11, 0.3);
    const far = studioOssWatercolorTipCoverage(0.99, 0, 11, 0.3);
    expect(core).toBeGreaterThan(0.2);
    // Edge band is non-zero and distinct from empty exterior.
    expect(nearEdge).toBeGreaterThan(0);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  it("never invents white glitter on dark paint-film oil", () => {
    const dark = 24;
    const film = studioOssApplyMaterialColorChannel(
      dark,
      0.9,
      0.2,
      "paint-film",
    );
    // Density multiply + darken must stay ≤ source (no white lift).
    expect(film).toBeLessThanOrEqual(dark);
    const dry = studioOssApplyMaterialColorChannel(dark, 0.9, 0.2, "dry-paper");
    // Dry paper tooth may lighten toward paper.
    expect(dry).toBeGreaterThan(film);
    expect(studioOssMaterialColorModeForProfile("oil")).toBe("paint-film");
    expect(studioOssMaterialColorModeForProfile("crayon")).toBe("dry-paper");
  });

  it("exposes transparent-safe oil and dry recipes from libmypaint DNA", () => {
    expect(STUDIO_OSS_OIL_FILM_RECIPE.smudge).toBe(0);
    expect(STUDIO_OSS_OIL_FILM_RECIPE.paintMode).toBe(0.88);
    expect(STUDIO_OSS_OIL_FILM_RECIPE.hardness).toBeLessThan(0.7);
    expect(STUDIO_OSS_DRY_CARRIER_RECIPE.offsetByRandom).toBeGreaterThan(0.1);
    expect(STUDIO_OSS_DRY_CARRIER_RECIPE.hardness).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps oil grooves measurably separated from loaded bristle ridges", () => {
    const valley = studioOssOilBristleFilm(20, 12, 0, 17, () => 0);
    const ridge = studioOssOilBristleFilm(20, 12, 0, 17, () => 1);

    expect(valley.ridge).toBe(0);
    expect(ridge.ridge).toBe(1);
    expect(ridge.alpha - valley.alpha).toBeGreaterThanOrEqual(0.25);
    expect(ridge.color - valley.color).toBeGreaterThanOrEqual(0.8);
    expect(valley.lift - ridge.lift).toBeGreaterThanOrEqual(0.3);
  });

  it("routes site families to hybrid OSS stacks", () => {
    expect(resolveStudioOssBrushHybridFamily("oil")).toBe("wet-oil");
    expect(resolveStudioOssBrushHybridFamily("crayon")).toBe("dry-scrape");
    expect(resolveStudioOssBrushHybridFamily("airbrush")).toBe("spray-air");
    expect(resolveStudioOssBrushHybridFamily("watercolor")).toBe(
      "wet-watercolor",
    );
    expect(resolveStudioOssBrushHybridFamily("pencil")).toBe("graphite");
    const oil = describeStudioOssBrushHybridStack("oil");
    expect(oil.route).toBe(STUDIO_OSS_BRUSH_HYBRID_ROUTES["wet-oil"]);
    expect(oil.provenanceNotes.length).toBeGreaterThan(0);
    // Hybrid routing is family pin selection, not a cross-engine failure ladder.
    expect(oil.crossEngineProductFallbackAllowed).toBe(false);
  });

  it("evaluates Harmony proximity coupling with distance falloff", () => {
    const near = studioOssHarmonyProximityCoupling(10, 10, 15, 12, 30, 0x42);
    const far = studioOssHarmonyProximityCoupling(10, 10, 28, 28, 30, 0x42);
    const outside = studioOssHarmonyProximityCoupling(10, 10, 100, 100, 30, 0x42);

    expect(near.connected).toBe(true);
    expect(near.weight).toBeGreaterThan(far.weight);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(outside.connected).toBe(false);
    expect(outside.weight).toBe(0);
  });

  it("evaluates fabric-brushes crayon tooth bite and wax deposit under pressure", () => {
    const light = studioOssFabricCrayonGrainAdhesion(50, 50, 0.2, 5, 0x19);
    const heavy = studioOssFabricCrayonGrainAdhesion(50, 50, 0.9, 5, 0x19);

    expect(heavy.deposit).toBeGreaterThan(light.deposit);
    expect(heavy.toothBite).toBeGreaterThan(light.toothBite);
    expect(light.deposit).toBeGreaterThan(0);
    expect(heavy.deposit).toBeLessThanOrEqual(1);
  });

  it("emits continuous tangent-relative offsets for long fur ribbons", () => {
    const strand0 = studioOssFabricLongFurTangentOffset(0, 6, 0, 15, 0x77);
    const strand5 = studioOssFabricLongFurTangentOffset(5, 6, 0, 15, 0x77);

    expect(strand0.offsetX).not.toEqual(strand5.offsetX);
    expect(strand0.offsetY).not.toEqual(strand5.offsetY);
    expect(strand0.opacity).toBeGreaterThan(0);
    expect(strand5.opacity).toBeGreaterThan(0);
  });

  it("snaps square tiles to local grid with rotation jitter and pressure scaling", () => {
    const tileA = studioOssFabricSquaresMeshOffset(35, 42, 16, 0.4, 0x12, 0);
    const tileB = studioOssFabricSquaresMeshOffset(37, 44, 16, 0.4, 0x12, 0);
    const tileHeavy = studioOssFabricSquaresMeshOffset(35, 42, 16, 0.9, 0x12, 0);

    // Both points in the same 16px cell share the same cell center
    expect(tileA.tileX).toEqual(tileB.tileX);
    expect(tileA.tileY).toEqual(tileB.tileY);
    expect(tileHeavy.size).toBeGreaterThan(tileA.size);
    expect(tileHeavy.opacity).toBeGreaterThan(tileA.opacity);
  });

  it("blends brush color into sampled canvas color based on smudge rate and wetness", () => {
    // Red brush (255, 0, 0), Blue canvas (0, 0, 255)
    const dry = studioOssKlecksSmudgeColorBlend(255, 0, 0, 0, 0, 255, 1, 0, 0);
    const wetSmudge = studioOssKlecksSmudgeColorBlend(255, 0, 0, 0, 0, 255, 1, 0.8, 0.9);

    expect(dry.r).toBe(255);
    expect(dry.b).toBe(0);
    expect(wetSmudge.b).toBeGreaterThan(50);
    expect(wetSmudge.r).toBeLessThan(200);
    expect(wetSmudge.pickupRate).toBeGreaterThan(0.5);
  });

  it("evaluates p5.brush flowfield vector angle, velocity, and curl magnitude", () => {
    const v1 = studioOssP5BrushFlowfieldVector(100, 100, 0.05, 3, 0x5a);
    const v2 = studioOssP5BrushFlowfieldVector(500, 500, 0.05, 3, 0x5a);

    expect(Number.isFinite(v1.angle)).toBe(true);
    expect(Math.hypot(v1.velocityX, v1.velocityY)).toBeGreaterThan(0.5);
    expect(v1.curlMagnitude).toBeGreaterThanOrEqual(0);
    expect(v1.curlMagnitude).toBeLessThanOrEqual(2);
    expect(v1.angle).not.toEqual(v2.angle);
  });
});
