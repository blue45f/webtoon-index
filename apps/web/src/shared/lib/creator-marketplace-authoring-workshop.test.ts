import { describe, expect, it } from "vitest";

import {
  buildCreatorMarketplaceAuthoringManifest,
  createCreatorMarketplaceAuthoringDraft,
  createCreatorMarketplaceBrushEngineNode,
  createCreatorMarketplaceDraftFromBrushStudio,
  creatorMarketplaceBrushCombinationCount,
  normalizeCreatorMarketplaceAuthoringDraft,
  validateCreatorMarketplaceAuthoringDraft,
} from "./creator-marketplace-authoring-workshop";

describe("creator marketplace authoring workshop", () => {
  it("preserves native Brush Studio enginePrograms and editable snapshot", () => {
    const enginePrograms = [
      {
        id: "dry-graphite",
        kind: "dry-media",
        grain: { scale: 0.72, contrast: 0.41 },
        tipLayers: [{ id: "graphite-tip", source: "image", spacing: 0.08 }],
        dynamics: { pressure: { size: [0, 0.2, 0.7, 1] }, tilt: true },
      },
      {
        id: "water-pass",
        kind: "watercolor-diffusion",
        wetMix: { water: 0.65, pigment: 0.44 },
      },
    ];
    const snapshot = {
      name: "Graphite wash",
      description: "Graphite and watercolor hybrid",
      tags: ["graphite", "wash"],
      seed: 8842,
      enginePrograms,
      dualBrush: { blend: "multiply" },
      colorDynamics: { hue: 0.05 },
    };

    const draft = createCreatorMarketplaceDraftFromBrushStudio(snapshot);
    const manifest = buildCreatorMarketplaceAuthoringManifest(draft);
    const brush = manifest.brush as Record<string, unknown>;

    expect(draft.source.mode).toBe("brush-studio");
    expect(draft.brush.originalEnginePrograms).toEqual(enginePrograms);
    expect(draft.brush.engineNodes).toHaveLength(2);
    expect(draft.brush.engineNodes[0]?.engine).toBe("dry-media");
    expect(draft.brush.engineNodes[1]?.engine).toBe("watercolor-diffusion");
    expect(brush.enginePrograms).toEqual(enginePrograms);
    expect(brush.studioSnapshot).toEqual(snapshot);
  });

  it("normalizes malformed external drafts without dropping source programs", () => {
    const normalized = normalizeCreatorMarketplaceAuthoringDraft({
      kind: "brush",
      brush: {
        deterministicSeed: Number.NaN,
        originalEnginePrograms: [{ id: "native" }],
        engineNodes: [{
          id: "node",
          engine: "particle-scatter",
          backend: "webgpu",
          blend: "add",
          parameters: { particleCount: 120 },
          mappings: [{ channel: "velocity", target: "particle-count", curve: [0, 1] }],
          tipLayers: [{ source: "procedural", opacity: 4, scale: -1 }],
          sourceProgram: { id: "native" },
        }],
      },
    });

    expect(normalized.brush.originalEnginePrograms).toEqual([{ id: "native" }]);
    expect(normalized.brush.engineNodes[0]?.tipLayers[0]?.opacity).toBe(1);
    expect(normalized.brush.engineNodes[0]?.tipLayers[0]?.scale).toBe(0.01);
    expect(Number.isFinite(normalized.brush.deterministicSeed)).toBe(true);
  });

  it("blocks contradictory GPU and incomplete dual-brush contracts", () => {
    const draft = createCreatorMarketplaceAuthoringDraft("brush");
    const dual = createCreatorMarketplaceBrushEngineNode("dual-brush");
    const diagnostics = validateCreatorMarketplaceAuthoringDraft({
      ...draft,
      title: "Dual GPU ink",
      summary: "A dual GPU ink brush for clean webtoon line art.",
      description: "A long enough description for the authoring gate and marketplace review.",
      tags: ["ink", "webtoon"],
      media: [{ id: "preview", kind: "stroke-sheet", name: "Sheet", alt: "Stroke sheet" }],
      brush: { ...draft.brush, engineNodes: [{ ...dual, backend: "webgpu" }] },
      compatibility: { ...draft.compatibility, webgpu: false },
      rights: { ...draft.rights, originalWorkAttested: true, previewRightsAttested: true },
    });

    expect(diagnostics.map((item) => item.id)).toEqual(
      expect.arrayContaining(["webgpu-contract", "dual-brush-input"]),
    );
  });

  it("grades multi-engine combinations deterministically", () => {
    const draft = createCreatorMarketplaceAuthoringDraft("brush");
    const second = createCreatorMarketplaceBrushEngineNode("dry-media");
    const third = createCreatorMarketplaceBrushEngineNode("glow");
    const value = creatorMarketplaceBrushCombinationCount({
      ...draft,
      brush: { ...draft.brush, engineNodes: [...draft.brush.engineNodes, second, third] },
    });

    expect(value).toBeGreaterThan(8);
    expect(value).toBe(creatorMarketplaceBrushCombinationCount({
      ...draft,
      brush: { ...draft.brush, engineNodes: [...draft.brush.engineNodes, second, third] },
    }));
  });

  it("builds the same lifecycle envelope for non-brush assets", () => {
    const draft = createCreatorMarketplaceAuthoringDraft("3d");
    const manifest = buildCreatorMarketplaceAuthoringManifest({
      ...draft,
      title: "City block",
      technical: { polygonCount: 48200, format: "glb", lodCount: 3 },
      bundle: [{
        id: "texture-pack",
        kind: "texture",
        name: "PBR textures",
        required: true,
        versionRange: "^1.0.0",
        role: "surface maps",
      }],
    });

    expect(manifest.brush).toBeUndefined();
    expect(manifest.technical).toEqual({ format: "glb", lodCount: 3, polygonCount: 48200 });
    expect(manifest.bundle).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "PBR textures", required: true }),
    ]));
  });
});
