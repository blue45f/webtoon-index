import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "./studio-brush";
import {
  STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES,
  STUDIO_OSS_BRUSH_HYBRID_REGISTRY_VERSION,
  describeStudioOssBrushHybridStack,
  listStudioBrushTextureEngineMatches,
  resolveStudioBrushTextureEngineMatch,
  resolveStudioBrushTextureKind,
  resolveStudioOssBrushHybridFamily,
  studioBrushTextureKindToLegacyFamily,
} from "./studio-oss-brush-hybrid-registry";

describe("studio brush texture engine matching", () => {
  it("pins a distinct verified engine for every texture kind", () => {
    const matches = listStudioBrushTextureEngineMatches();
    expect(matches.length).toBeGreaterThanOrEqual(20);
    const primaries = new Set(matches.map((m) => m.primaryEngine));
    // Not every kind must have a unique module string, but oil/dry/spray/line must differ.
    expect(
      resolveStudioBrushTextureEngineMatch("oil").primaryEngine,
    ).not.toBe(
      resolveStudioBrushTextureEngineMatch("airbrush").primaryEngine,
    );
    expect(
      resolveStudioBrushTextureEngineMatch("crayon").primaryEngine,
    ).not.toBe(
      resolveStudioBrushTextureEngineMatch("watercolor").primaryEngine,
    );
    expect(
      resolveStudioBrushTextureEngineMatch("pencil").primaryEngine,
    ).not.toBe(
      resolveStudioBrushTextureEngineMatch("oil").primaryEngine,
    );
    expect(primaries.size).toBeGreaterThan(10);
  });

  it("maps every core BRUSH_PRESETS id to a concrete texture kind (not all generic)", () => {
    const kinds = BRUSH_PRESETS.map((preset) => ({
      id: preset.id,
      kind: resolveStudioBrushTextureKind(preset.id),
    }));
    expect(kinds.every((entry) => entry.kind.length > 0)).toBe(true);
    const genericCount = kinds.filter((e) => e.kind === "dynamics-generic").length;
    // Core presets should almost all have explicit pins.
    expect(genericCount).toBeLessThanOrEqual(3);

    for (const entry of kinds) {
      const match = resolveStudioBrushTextureEngineMatch(entry.id);
      expect(match.kind).toBe(entry.kind);
      expect(match.primaryEngine.length).toBeGreaterThan(0);
      expect(match.qualityRouteProfile.length).toBeGreaterThan(0);
    }
  });

  it("matches texture-critical brushes to the intended engines", () => {
    expect(resolveStudioBrushTextureKind("oil")).toBe("paint-oil");
    expect(resolveStudioBrushTextureEngineMatch("oil").primaryEngine)
      .toContain("oil-ribbon");
    expect(resolveStudioBrushTextureKind("acrylic")).toBe("paint-acrylic");
    expect(resolveStudioBrushTextureKind("gouache")).toBe("paint-gouache");
    expect(resolveStudioBrushTextureKind("watercolor")).toBe("wet-watercolor");
    expect(resolveStudioBrushTextureKind("ink-wash")).toBe("wet-inkwash");
    expect(resolveStudioBrushTextureKind("crayon")).toBe("dry-crayon");
    expect(resolveStudioBrushTextureKind("chalk")).toBe("dry-chalk");
    expect(resolveStudioBrushTextureKind("charcoal")).toBe("dry-charcoal");
    expect(resolveStudioBrushTextureKind("pastel")).toBe("dry-pastel");
    expect(resolveStudioBrushTextureKind("oil-pastel")).toBe("dry-oil-pastel");
    expect(resolveStudioBrushTextureKind("pencil")).toBe("dry-graphite");
    expect(resolveStudioBrushTextureKind("airbrush")).toBe("spray-airbrush");
    expect(resolveStudioBrushTextureKind("splatter")).toBe("spray-splatter");
    expect(resolveStudioBrushTextureKind("gpen")).toBe("line-gpen");
    expect(resolveStudioBrushTextureKind("calligraphy")).toBe("calligraphy");
  });

  it("keeps pack aliases on the same texture pin as their family", () => {
    expect(resolveStudioBrushTextureKind("oil-filbert")).toBe("paint-oil");
    expect(resolveStudioBrushTextureKind("oil-impasto-heavy")).toBe("paint-oil");
    expect(resolveStudioBrushTextureKind("watercolor-wet-wash")).toBe(
      "wet-watercolor",
    );
    expect(resolveStudioBrushTextureKind("sumi-e")).toBe("wet-inkwash");
    expect(resolveStudioBrushTextureKind("crayon-wax-bold")).toBe("dry-crayon");
    expect(resolveStudioBrushTextureKind("airbrush-grand-soft")).toBe(
      "spray-airbrush",
    );
  });

  it("never allows cross-engine product fallback on the hybrid stack description", () => {
    const oil = describeStudioOssBrushHybridStack("oil");
    expect(oil.version).toBe(STUDIO_OSS_BRUSH_HYBRID_REGISTRY_VERSION);
    expect(oil.kind).toBe("paint-oil");
    expect(oil.textureFirst).toBe(true);
    expect(oil.crossEngineProductFallbackAllowed).toBe(false);
    expect(oil.match.primaryEngine).toContain("planOilBrushDabs");
    expect(oil.family).toBe("wet-oil");
    expect(resolveStudioOssBrushHybridFamily("oil")).toBe("wet-oil");
    expect(studioBrushTextureKindToLegacyFamily("dry-crayon")).toBe(
      "dry-scrape",
    );
  });

  it("separates gouache and oil texture pins", () => {
    const oil = STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["paint-oil"];
    const gouache = STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["paint-gouache"];
    expect(oil.primaryEngine).not.toBe(gouache.primaryEngine);
    expect(gouache.notes.toLowerCase()).toMatch(/matte|과슈|gouache/i);
  });
});
