import { describe, expect, it } from "vitest";

import {
  isStudioSoftFalloffLinearAccumulationProgramPin,
  normalizeStudioBrushDynamicsSettings,
  serializeStudioBrushDynamicsSettingsCanonical,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
  studioSoftFalloffLinearAccumulationProgramPin,
  STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST,
  STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import { materializeStudioBrushPackDynamics } from "./studio-brush-pack-runtime";

describe("studio soft-falloff linear-accumulation program pin", () => {
  it("mints an immutable exact pin and guards it strictly", () => {
    const pin = studioSoftFalloffLinearAccumulationProgramPin();
    expect(pin).toEqual({
      version: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION,
      programDigest: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST,
    });
    expect(Object.isFrozen(pin)).toBe(true);
    expect(isStudioSoftFalloffLinearAccumulationProgramPin(pin)).toBe(true);

    for (const malformed of [
      null,
      undefined,
      "soft-falloff-linear-accumulation-v1",
      [pin],
      { version: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION },
      { programDigest: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST },
      { ...pin, version: "soft-falloff-linear-accumulation-v2" },
      { ...pin, programDigest: "0".repeat(64) },
      { ...pin, extra: true },
    ]) {
      expect(isStudioSoftFalloffLinearAccumulationProgramPin(malformed)).toBe(false);
    }
  });

  it("preserves an explicit pin byte-for-byte through normalization and canonical round-trips", () => {
    const pinned = normalizeStudioBrushDynamicsSettings({
      seed: 17,
      tip: { shape: "soft", softness: 0.42 },
      softFalloffLinearProgram: studioSoftFalloffLinearAccumulationProgramPin(),
    });
    expect(pinned.softFalloffLinearProgram).toEqual(
      studioSoftFalloffLinearAccumulationProgramPin(),
    );
    // Round-trip: the normalized output re-normalizes byte-identically with the pin retained.
    expect(normalizeStudioBrushDynamicsSettings(JSON.parse(JSON.stringify(pinned))))
      .toEqual(pinned);
    expect(serializeStudioBrushDynamicsSettingsCanonical(pinned))
      .toBe(JSON.stringify(pinned));
  });

  it("never injects the pin, keeping un-opted-in canonical serialization unchanged", () => {
    const legacy = normalizeStudioBrushDynamicsSettings({
      seed: 17,
      tip: { shape: "soft", softness: 0.42 },
    });
    expect(legacy.softFalloffLinearProgram).toBeUndefined();
    expect(serializeStudioBrushDynamicsSettingsCanonical(legacy))
      .not.toContain("softFalloffLinearProgram");
  });

  it("fails normalization closed for any malformed explicit pin", () => {
    for (const malformed of [
      "soft-falloff-linear-accumulation-v1",
      { version: "soft-falloff-linear-accumulation-v2", programDigest: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST },
      { version: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION, programDigest: "f".repeat(64) },
      { version: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION, programDigest: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST, extra: 1 },
      [studioSoftFalloffLinearAccumulationProgramPin()],
      null,
      42,
    ]) {
      expect(() => normalizeStudioBrushDynamicsSettings({
        seed: 17,
        softFalloffLinearProgram: malformed,
      })).toThrow(TypeError);
    }
  });

  it("mints the pin for the whole fresh-authoring airbrush family", () => {
    // The canonical preset is the mint site; every airbrush-preset alias, variant and pack
    // expansion derives from it, so freshly authored soft/spray/marker snapshots inherit it.
    expect(studioBrushDynamicsPresetSettings("airbrush").softFalloffLinearProgram)
      .toEqual(studioSoftFalloffLinearAccumulationProgramPin());
    for (const brushId of [
      "airbrush",
      "soft-brush",
      "spray",
      "sketchpad-soft-marker",
      "web-soft-cloud",
      "marker--soft-dynamic",
    ] as const) {
      expect(
        studioBrushDynamicsSettingsForBrushId(brushId)?.softFalloffLinearProgram,
        brushId,
      ).toEqual(studioSoftFalloffLinearAccumulationProgramPin());
    }
    for (const packId of ["airbrush-grand-soft", "cloud-soft", "spray-noise-fine"] as const) {
      expect(
        materializeStudioBrushPackDynamics(packId)?.softFalloffLinearProgram,
        packId,
      ).toEqual(studioSoftFalloffLinearAccumulationProgramPin());
    }
    // Non-airbrush engines stay unpinned — the tone belongs to the analytic soft skirt only.
    expect(studioBrushDynamicsPresetSettings("ink-particle").softFalloffLinearProgram)
      .toBeUndefined();
    expect(studioBrushDynamicsPresetSettings("dry-media").softFalloffLinearProgram)
      .toBeUndefined();
    expect(studioBrushDynamicsSettingsForBrushId("crayon")?.softFalloffLinearProgram)
      .toBeUndefined();
  });

  it("strips the pin from snapshot-less replay re-derivation", () => {
    // Persisted elements without their own stored snapshot re-derive dynamics from today's
    // catalogue; inheriting the pin would re-ramp a committed airbrush skirt the artist already
    // approved. Only an element's own stored snapshot may carry it.
    for (const brushId of ["airbrush", "soft-brush", "spray", "sketchpad-soft-marker"] as const) {
      const replaySafe = studioReplaySafeBrushDynamicsSettingsForBrushId(brushId);
      expect(replaySafe, brushId).not.toBeNull();
      expect(replaySafe?.softFalloffLinearProgram, brushId).toBeUndefined();
    }
  });
});
