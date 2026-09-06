import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsPresetSettings,
  type StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import { profileStudioBrushMaterialResponse } from "./studio-brush-material-response";
import { encodeStudioBrushTipAlphaMapBase64 } from "./studio-brush-tip-stamp";

function neutralSettings(
  overrides: StudioBrushDynamicsSettings = {}
): StudioBrushDynamicsSettings {
  return {
    seed: 71,
    taper: { enabled: false },
    tip: { shape: "hard", softness: 0 },
    grain: { amount: 0 },
    width: { base: 20, mappings: [], jitter: null },
    opacity: { base: 1, mappings: [], jitter: null },
    flow: { base: 0.5, mappings: [], jitter: null },
    spacingRatio: 0.2,
    spacing: { mappings: [], jitter: null },
    scatterRatio: 0,
    scatter: { mappings: [], jitter: null },
    angle: { base: 0, mappings: [], jitter: null },
    roundness: { base: 1, mappings: [], jitter: null },
    ...overrides,
  };
}

function uniformTip(byte: number, size = 8) {
  return {
    shape: "round" as const,
    softness: 0,
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(
      new Uint8Array(size * size).fill(byte),
    ),
    alphaMapSize: size,
  };
}

describe("studio brush material response", () => {
  it("is deterministic across repeats and JSON persistence", () => {
    const input = {
      brushDynamics: studioBrushDynamicsPresetSettings("dry-media"),
      defaultWidth: 17,
      defaultOpacity: 0.72,
      seed: 0x1234_abcd,
    };
    const first = profileStudioBrushMaterialResponse(input);
    const replay = profileStudioBrushMaterialResponse(
      JSON.parse(JSON.stringify(input)),
    );

    expect(replay).toEqual(first);
    expect(replay.fingerprints.combined).toBe(first.fingerprints.combined);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.geometry)).toBe(true);
    expect(Object.isFrozen(first.deposition)).toBe(true);
    expect(Object.isFrozen(first.texture)).toBe(true);
  });

  it("separates opacity ceiling from flow buildup even when the first dab matches", () => {
    const lowCeilingFastFlow = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        flow: { base: 0.25, mappings: [], jitter: null },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.4,
    });
    const highCeilingSlowFlow = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        flow: { base: 0.125, mappings: [], jitter: null },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.8,
    });

    expect(lowCeilingFastFlow.deposition.overlap1Alpha).toBeCloseTo(
      highCeilingSlowFlow.deposition.overlap1Alpha,
      6,
    );
    expect(lowCeilingFastFlow.deposition.opacityCeiling).toBe(0.4);
    expect(highCeilingSlowFlow.deposition.opacityCeiling).toBe(0.8);
    expect(lowCeilingFastFlow.deposition.overlap4Alpha).not.toBe(
      highCeilingSlowFlow.deposition.overlap4Alpha,
    );
    expect(lowCeilingFastFlow.deposition.overlap16Alpha).toBeLessThanOrEqual(0.4);
    expect(highCeilingSlowFlow.deposition.overlap16Alpha).toBeLessThanOrEqual(0.8);
    expect(lowCeilingFastFlow.fingerprints.deposition).not.toBe(
      highCeilingSlowFlow.fingerprints.deposition,
    );
    expect(lowCeilingFastFlow.deposition.preventedDarkeningAt16).toBeGreaterThan(0);
  });

  it("changes placement cadence without changing the material response when only spacing changes", () => {
    const dense = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({ spacingRatio: 0.1 }),
      defaultWidth: 20,
      defaultOpacity: 0.65,
    });
    const sparse = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({ spacingRatio: 0.6 }),
      defaultWidth: 20,
      defaultOpacity: 0.65,
    });

    expect(dense.geometry.dabCount).toBeGreaterThan(sparse.geometry.dabCount);
    expect(dense.geometry.meanSpacing).toBeLessThan(sparse.geometry.meanSpacing);
    expect(dense.fingerprints.geometry).not.toBe(sparse.fingerprints.geometry);
    expect(dense.fingerprints.deposition).toBe(sparse.fingerprints.deposition);
    expect(dense.fingerprints.texture).toBe(sparse.fingerprints.texture);
  });

  it("changes texture without changing stroke cadence when only tip and grain change", () => {
    const clean = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        tip: { shape: "hard", softness: 0 },
        grain: { amount: 0 },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.8,
    });
    const textured = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        tip: { shape: "bristle", softness: 0.25 },
        grain: {
          amount: 0.75,
          scale: 4.5,
          contrast: 0.65,
          seed: 991,
        },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.8,
    });

    expect(textured.fingerprints.geometry).toBe(clean.fingerprints.geometry);
    expect(textured.fingerprints.texture).not.toBe(clean.fingerprints.texture);
    expect(textured.texture.materialAlphaVariance).not.toBe(
      clean.texture.materialAlphaVariance,
    );
    expect(textured.texture.grainMultiplierVariance).toBeGreaterThan(0);
  });

  it("keeps multiply and screen dual-tip blending behaviorally distinct", () => {
    const primary = uniformTip(128);
    const secondary = uniformTip(64);
    const multiply = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        tip: primary,
        dualBrush: {
          enabled: true,
          tip: secondary,
          blendMode: "multiply",
          sizeRatio: 1,
        },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.7,
    });
    const screen = profileStudioBrushMaterialResponse({
      brushDynamics: neutralSettings({
        tip: primary,
        dualBrush: {
          enabled: true,
          tip: secondary,
          blendMode: "screen",
          sizeRatio: 1,
        },
      }),
      defaultWidth: 20,
      defaultOpacity: 0.7,
    });

    expect(multiply.texture.dualBlendMode).toBe("multiply");
    expect(screen.texture.dualBlendMode).toBe("screen");
    expect(multiply.fingerprints.geometry).toBe(screen.fingerprints.geometry);
    expect(multiply.fingerprints.texture).not.toBe(screen.fingerprints.texture);
    expect(multiply.texture.materialMeanAlpha).toBeLessThan(
      screen.texture.materialMeanAlpha,
    );
  });

  it("profiles the shipped ink, airbrush and dry-media engines as distinct materials", () => {
    const results = ["ink-particle", "airbrush", "dry-media"].map((brushId) => (
      profileStudioBrushMaterialResponse({
        brushDynamics: normalizeStudioBrushDynamicsSettings(
          studioBrushDynamicsPresetSettings(
            brushId as "airbrush" | "dry-media" | "ink-particle",
          ),
        ),
        defaultWidth: 18,
        defaultOpacity: 0.8,
      })
    ));

    expect(new Set(results.map((result) => result.fingerprints.combined)).size).toBe(3);
    for (const result of results) {
      expect(result.geometry.dabCount).toBeGreaterThan(1);
      expect(result.deposition.overlap1Alpha).toBeGreaterThan(0);
      expect(result.deposition.overlap16Alpha).toBeLessThanOrEqual(
        result.deposition.opacityCeiling,
      );
      expect(Number.isFinite(result.texture.materialAlphaVariance)).toBe(true);
    }
  });
});
