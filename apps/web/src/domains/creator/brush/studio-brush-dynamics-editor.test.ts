import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  resolveStudioBrushDynamics,
  serializeStudioBrushDynamicsSettingsCanonical,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import {
  findStudioBrushDynamicsMapping,
  removeStudioBrushDynamicsMapping,
  studioBrushDynamicsActiveMappingCount,
  studioBrushDynamicsPresetMatch,
  updateStudioBrushDynamicsGrain,
  updateStudioBrushDynamicsJitter,
  updateStudioBrushDynamicsMapping,
  updateStudioBrushDynamicsPropertyBase,
  updateStudioBrushDynamicsRatio,
  updateStudioBrushDynamicsTaper,
  updateStudioBrushDynamicsTip,
} from "./studio-brush-dynamics-editor";

describe("studio brush dynamics editor", () => {
  it("recognizes detached presets and marks an edited recipe as custom", () => {
    const preset = studioBrushDynamicsPresetSettings("ink-particle");
    expect(studioBrushDynamicsPresetMatch(preset)).toBe("ink-particle");
    expect(studioBrushDynamicsPresetMatch(updateStudioBrushDynamicsRatio(preset, "spacing", 0.31))).toBeNull();
  });

  it("keeps the active-preset highlight for snapshots carrying the causal stamp-grid pin", () => {
    // Toolbar/panel selection of the canonical causal presets mints the v2 lattice pin at the
    // brush-id variant seam; the highlight must ignore that render marker, not read it as a tweak.
    const minted = studioBrushDynamicsSettingsForBrushId("dry-media");
    if (!minted) throw new Error("missing dry-media dynamics");
    expect(minted.causalStampGridRule).toBe("causal-stamp-grid-v2");
    expect(studioBrushDynamicsPresetMatch(minted)).toBe("dry-media");
    expect(studioBrushDynamicsPresetMatch(studioBrushDynamicsSettingsForBrushId("ink-particle")))
      .toBe("ink-particle");
    // A real authored edit on a pinned snapshot still reads as custom.
    expect(studioBrushDynamicsPresetMatch(updateStudioBrushDynamicsRatio(minted, "spacing", 0.31)))
      .toBeNull();
  });

  it("updates and removes one source mapping without mutating other properties", () => {
    const before = studioBrushDynamicsPresetSettings("airbrush");
    const next = updateStudioBrushDynamicsMapping(
      before,
      "width",
      "pressure",
      { from: 0.2, to: 1.8 },
      { source: "pressure", from: 0.3, to: 1.7 }
    );
    expect(findStudioBrushDynamicsMapping(next, "width", "pressure")).toMatchObject({ from: 0.2, to: 1.8 });
    expect(next.flow).toEqual(before.flow);
    expect(before.width.mappings[0]?.from).not.toBe(0.2);

    const removed = removeStudioBrushDynamicsMapping(next, "width", "pressure");
    expect(findStudioBrushDynamicsMapping(removed, "width", "pressure")).toBeNull();
  });

  it("edits bases, ratios and deterministic jitter through normalized settings", () => {
    let next = normalizeStudioBrushDynamicsSettings();
    next = updateStudioBrushDynamicsPropertyBase(next, "roundness", 0.25);
    next = updateStudioBrushDynamicsRatio(next, "spacing", 0.18);
    next = updateStudioBrushDynamicsRatio(next, "scatter", 0.4);
    next = updateStudioBrushDynamicsJitter(next, "width", 0.15);
    expect(next.roundness.base).toBe(0.25);
    expect(next.spacingRatio).toBe(0.18);
    expect(next.scatterRatio).toBe(0.4);
    expect(next.width.jitter).toEqual({ mode: "multiply", amount: 0.15 });
  });

  it("counts active mappings across every output property", () => {
    const preset = studioBrushDynamicsPresetSettings("dry-media");
    const expected = Object.values({
      width: preset.width,
      opacity: preset.opacity,
      flow: preset.flow,
      spacing: preset.spacing,
      scatter: preset.scatter,
      angle: preset.angle,
      roundness: preset.roundness,
    }).reduce((sum, property) => sum + property.mappings.length, 0);
    expect(studioBrushDynamicsActiveMappingCount(preset)).toBe(expected);
  });

  it("updates shared taper and PNG tip stamp settings through the editor helpers", () => {
    const base = studioBrushDynamicsPresetSettings("ink-particle");
    const tapered = updateStudioBrushDynamicsTaper(base, {
      enabled: true,
      startLength: 0.2,
      endLength: 0.3,
      minSizeRatio: 0.15,
    });
    expect(tapered.taper).toMatchObject({
      enabled: true,
      startLength: 0.2,
      endLength: 0.3,
      minSizeRatio: 0.15,
    });
    const tipped = updateStudioBrushDynamicsTip(tapered, { shape: "star", softness: 0.55 });
    expect(tipped.tip).toMatchObject({ shape: "star", softness: 0.55, alphaMapBase64: null });
    expect(studioBrushDynamicsPresetMatch(tipped)).toBeNull();
  });

  it("round-trips sensor routing, seeded random, taper and grain without losing runtime behavior", () => {
    const base = studioBrushDynamicsPresetSettings("ink-particle");
    let configured = removeStudioBrushDynamicsMapping(base, "width", "pressure");
    configured = updateStudioBrushDynamicsMapping(
      configured,
      "width",
      "speed",
      { from: 0.5, to: 1.5, amount: 0.8, curve: 1.4, invert: false },
      { source: "speed", from: 0.5, to: 1.5 }
    );
    configured = updateStudioBrushDynamicsJitter(configured, "width", 0.18);
    configured = updateStudioBrushDynamicsTaper(configured, {
      enabled: true,
      minOpacityRatio: 0.22,
      curve: 1.75,
    });
    configured = updateStudioBrushDynamicsGrain(configured, {
      space: "stroke-fixed",
      amount: 0.42,
      scale: 12,
      contrast: 0.73,
    });

    const serialized = serializeStudioBrushDynamicsSettingsCanonical(configured);
    const restored = normalizeStudioBrushDynamicsSettings(JSON.parse(serialized));
    expect(restored).toEqual(configured);
    expect(findStudioBrushDynamicsMapping(restored, "width", "speed")).toMatchObject({
      from: 0.5,
      to: 1.5,
      amount: 0.8,
      curve: 1.4,
      invert: false,
    });
    expect(restored.taper).toMatchObject({ minOpacityRatio: 0.22, curve: 1.75 });
    expect(restored.grain).toMatchObject({
      space: "stroke-fixed",
      amount: 0.42,
      scale: 12,
      contrast: 0.73,
    });

    const slow = resolveStudioBrushDynamics(
      { pressure: 0.5, speed: 0, stampIndex: 7 },
      restored
    );
    const fast = resolveStudioBrushDynamics(
      { pressure: 0.5, speed: restored.maxSpeed, stampIndex: 7 },
      restored
    );
    expect(fast.width).toBeGreaterThan(slow.width);
    expect(resolveStudioBrushDynamics(
      { pressure: 0.5, speed: restored.maxSpeed, stampIndex: 7 },
      restored
    )).toEqual(fast);
    expect(resolveStudioBrushDynamics(
      { pressure: 0.5, speed: restored.maxSpeed, stampIndex: 8 },
      restored
    ).width).not.toBe(fast.width);
  });

  it("normalizes grain edits without mutating the source settings", () => {
    const before = studioBrushDynamicsPresetSettings("dry-media");
    const next = updateStudioBrushDynamicsGrain(before, {
      amount: 4,
      scale: -2,
      contrast: 0.65,
      space: "stroke-fixed",
    });

    expect(next.grain).toMatchObject({
      amount: 1,
      scale: 0.25,
      contrast: 0.65,
      space: "stroke-fixed",
    });
    expect(before.grain.amount).not.toBe(1);
  });
});
