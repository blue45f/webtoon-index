import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushColorDynamicsSettings,
  normalizeStudioBrushGrainSettings,
  resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt,
  resolveNormalizedStudioBrushGrainAlphaMultiplier,
  resolveNormalizedStudioBrushGrainAlphaMultiplierAt,
  resolveStudioBrushDabColor,
  resolveStudioBrushGrainAlphaMultiplier,
  serializeStudioBrushGrainSettingsCanonical,
  studioBrushColorDynamicsIsActive,
  studioBrushGrainIsActive,
  studioBrushGrainUsesR8Texture,
} from "./studio-brush-material-dynamics";

const R8_ENCODED_HASH = `sha256:${"a".repeat(64)}`;
const R8_DECODED_HASH = `sha256:${"b".repeat(64)}`;

function r8Source() {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: "paper.canvas-fine.v1",
      encodedSha256: R8_ENCODED_HASH,
      decodedSha256: R8_DECODED_HASH,
      byteLength: 2_048,
      mediaType: "image/png",
      width: 32,
      height: 32,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

describe("studio brush material dynamics", () => {
  it("normalizes corrupt colour/grain snapshots into finite bounded contracts", () => {
    expect(normalizeStudioBrushColorDynamicsSettings({
      backgroundColor: " #AbC ",
      foregroundBackgroundMix: 4,
      foregroundBackgroundJitter: -2,
      hueJitter: 900,
      saturationJitter: Number.NaN,
      valueJitter: 3,
    })).toEqual({
      backgroundColor: "#aabbcc",
      foregroundBackgroundMix: 1,
      foregroundBackgroundJitter: 0,
      hueJitter: 180,
      saturationJitter: 0,
      valueJitter: 1,
    });
    expect(normalizeStudioBrushGrainSettings({
      space: "future-space",
      amount: 8,
      scale: 0,
      contrast: -1,
      seed: Number.POSITIVE_INFINITY,
    })).toEqual({
      space: "canvas-fixed",
      amount: 1,
      scale: 0.25,
      contrast: 0,
      seed: 1,
    });
  });

  it("mixes foreground/background exactly before deterministic HSV variation", () => {
    const settings = {
      backgroundColor: "#0000ff",
      foregroundBackgroundMix: 0.5,
    };
    expect(resolveStudioBrushDabColor("#ff0000", 0, 19, settings)).toBe("#800080");
    expect(resolveStudioBrushDabColor("currentColor", 0, 19, settings)).toBe("currentColor");
  });

  it("replays per-dab HSV jitter deterministically without Math.random", () => {
    const settings = {
      hueJitter: 90,
      saturationJitter: 0.35,
      valueJitter: 0.2,
    };
    const first = Array.from({ length: 12 }, (_, index) => (
      resolveStudioBrushDabColor("#4f8ad9", index, 0x1234_abcd, settings)
    ));
    const replay = Array.from({ length: 12 }, (_, index) => (
      resolveStudioBrushDabColor(
        "#4f8ad9",
        index,
        0x1234_abcd,
        JSON.parse(JSON.stringify(settings))
      )
    ));
    expect(replay).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(4);
    expect(studioBrushColorDynamicsIsActive(settings)).toBe(true);
    expect(studioBrushColorDynamicsIsActive({})).toBe(false);
  });

  it("distinguishes canvas-fixed and stroke-fixed grain under translation", () => {
    const common = { amount: 0.8, scale: 5.5, contrast: 0.65, seed: 73 };
    const sample = {
      x: 13.25,
      y: 27.75,
      strokeOriginX: 10,
      strokeOriginY: 20,
      strokeSeed: 991,
    };
    const translated = {
      ...sample,
      x: sample.x + 100,
      y: sample.y - 40,
      strokeOriginX: sample.strokeOriginX + 100,
      strokeOriginY: sample.strokeOriginY - 40,
    };
    const strokeFixed = { ...common, space: "stroke-fixed" as const };
    const canvasFixed = { ...common, space: "canvas-fixed" as const };
    expect(resolveStudioBrushGrainAlphaMultiplier(translated, strokeFixed)).toBeCloseTo(
      resolveStudioBrushGrainAlphaMultiplier(sample, strokeFixed),
      12
    );
    expect(resolveStudioBrushGrainAlphaMultiplier(translated, canvasFixed)).not.toBeCloseTo(
      resolveStudioBrushGrainAlphaMultiplier(sample, canvasFixed),
      5
    );
  });

  it("keeps legacy grain as an exact identity", () => {
    expect(studioBrushGrainIsActive({ amount: 0 })).toBe(false);
    expect(resolveStudioBrushGrainAlphaMultiplier({
      x: 10,
      y: 20,
      strokeSeed: 4,
    }, { amount: 0 })).toBe(1);
  });

  it("keeps procedural grain canonical bytes unchanged when the source is omitted or null", () => {
    const legacy = {
      space: "stroke-fixed",
      amount: 0.375,
      scale: 6.25,
      contrast: 0.5,
      seed: 73,
    };
    const expected = "{\"space\":\"stroke-fixed\",\"amount\":0.375,\"scale\":6.25,\"contrast\":0.5,\"seed\":73}";
    expect(serializeStudioBrushGrainSettingsCanonical(legacy)).toBe(expected);
    expect(serializeStudioBrushGrainSettingsCanonical({ ...legacy, source: null })).toBe(expected);
    expect(normalizeStudioBrushGrainSettings(legacy)).not.toHaveProperty("source");
  });

  it("retains a strictly normalized R8 source in deterministic canonical grain JSON", () => {
    const normalized = normalizeStudioBrushGrainSettings({
      space: "canvas-fixed",
      amount: 0.72,
      scale: 128,
      contrast: 0.61,
      seed: 99,
      source: r8Source(),
    });
    expect(normalized).toEqual({
      space: "canvas-fixed",
      amount: 0.72,
      scale: 128,
      contrast: 0.61,
      seed: 99,
      source: r8Source(),
    });
    expect(studioBrushGrainUsesR8Texture(normalized)).toBe(true);
    expect(studioBrushGrainIsActive(normalized)).toBe(true);
    expect(serializeStudioBrushGrainSettingsCanonical(normalized)).toBe(
      `{"space":"canvas-fixed","amount":0.72,"scale":128,"contrast":0.61,"seed":99,"source":{"kind":"r8-texture-v1","asset":{"assetId":"paper.canvas-fine.v1","encodedSha256":"${R8_ENCODED_HASH}","decodedSha256":"${R8_DECODED_HASH}","byteLength":2048,"mediaType":"image/png","width":32,"height":32,"channel":"luminance","encoding":"r8-unorm"}}}`,
    );
  });

  it("fails malformed or unknown R8 sources closed instead of substituting procedural noise", () => {
    const poisoned = normalizeStudioBrushGrainSettings({
      space: "stroke-fixed",
      amount: 0.9,
      scale: 4,
      contrast: 0.8,
      seed: 17,
      source: {
        ...r8Source(),
        asset: { ...r8Source().asset, bytes: new Uint8Array([1, 2, 3]) },
      },
    });
    expect(poisoned).toEqual({
      space: "stroke-fixed",
      amount: 0,
      scale: 4,
      contrast: 0.8,
      seed: 17,
    });
    expect(studioBrushGrainIsActive(poisoned)).toBe(false);
    expect(studioBrushGrainUsesR8Texture(poisoned)).toBe(false);
    expect(normalizeStudioBrushGrainSettings({
      amount: 1,
      source: { kind: "r8-texture-v2", asset: r8Source().asset },
    }).amount).toBe(0);
  });

  it("does not run a source accessor and disables that grain", () => {
    let reads = 0;
    const candidate: Record<string, unknown> = {
      space: "canvas-fixed",
      amount: 0.75,
      scale: 8,
      contrast: 0.4,
      seed: 3,
    };
    Object.defineProperty(candidate, "source", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(normalizeStudioBrushGrainSettings(candidate).amount).toBe(0);
    expect(reads).toBe(0);
  });

  it("uses an explicit identity fallback when a procedural-only sampler receives R8 grain", () => {
    const settings = normalizeStudioBrushGrainSettings({
      amount: 0.8,
      source: r8Source(),
    });
    expect(resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      27,
      31,
      4,
      9,
      19,
      settings,
    )).toBe(1);
    expect(resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
      27,
      31,
      12,
      6,
      0.4,
      4,
      9,
      19,
      settings,
    )).toBe(1);
  });

  it("keeps the allocation-free grain renderer path exactly equal to the object API", () => {
    for (const space of ["canvas-fixed", "stroke-fixed"] as const) {
      const settings = normalizeStudioBrushGrainSettings({
        space,
        amount: 0.73,
        scale: 7.1,
        contrast: 0.56,
        seed: 917,
      });
      for (const sample of [
        { x: 0, y: 0, strokeOriginX: 0, strokeOriginY: 0, strokeSeed: 1 },
        { x: 13.25, y: -8.75, strokeOriginX: 3, strokeOriginY: -2, strokeSeed: 991 },
        { x: Number.NaN, y: Number.POSITIVE_INFINITY, strokeSeed: Number.NaN },
      ]) {
        expect(resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
          sample.x,
          sample.y,
          sample.strokeOriginX,
          sample.strokeOriginY,
          sample.strokeSeed,
          settings
        )).toBe(resolveNormalizedStudioBrushGrainAlphaMultiplier(sample, settings));
      }
    }
    const disabled = normalizeStudioBrushGrainSettings({ amount: 0 });
    expect(resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      Number.NaN,
      Number.NaN,
      undefined,
      undefined,
      Number.NaN,
      disabled
    )).toBe(1);
  });

  it("integrates grain across a rotated carrier without whole-dab brightness pulses", () => {
    const settings = normalizeStudioBrushGrainSettings({
      space: "canvas-fixed",
      amount: 0.72,
      scale: 3.2,
      contrast: 0.74,
      seed: 0x4b0a_2102,
    });
    const centerOnly: number[] = [];
    const footprint: number[] = [];
    for (let index = 0; index < 160; index += 1) {
      const x = 12 + index * 1.4;
      const y = 31 + Math.sin(index / 11) * 4;
      centerOnly.push(resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
        x,
        y,
        12,
        31,
        991,
        settings,
      ));
      footprint.push(
        resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
          x,
          y,
          13,
          7,
          Math.PI / 5,
          12,
          31,
          991,
          settings,
        ),
      );
    }
    const adjacentEnergy = (values: readonly number[]) => values
      .slice(1)
      .reduce((sum, value, index) => (
        sum + Math.abs(value - values[index]!)
      ), 0);
    expect(adjacentEnergy(footprint)).toBeLessThan(
      adjacentEnergy(centerOnly) * 0.72,
    );
    expect(Math.max(...footprint) - Math.min(...footprint)).toBeGreaterThan(0.04);
    expect(footprint.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("preserves stroke-fixed footprint grain under translated replay", () => {
    const settings = normalizeStudioBrushGrainSettings({
      space: "stroke-fixed",
      amount: 0.66,
      scale: 5.4,
      contrast: 0.58,
      seed: 71,
    });
    const sample = (
      x: number,
      y: number,
      originX: number,
      originY: number,
    ) => resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
      x,
      y,
      18,
      6,
      0.73,
      originX,
      originY,
      1441,
      settings,
    );
    expect(sample(32, 48, 10, 20)).toBeCloseTo(
      sample(232, -52, 210, -80),
      12,
    );
    expect(resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
      Number.NaN,
      Number.NaN,
      0,
      0,
      Number.NaN,
      undefined,
      undefined,
      Number.NaN,
      normalizeStudioBrushGrainSettings({ amount: 0 }),
    )).toBe(1);
  });
});
