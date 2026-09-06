import { describe, expect, it } from "vitest";

import {
  createAvatarForgeState,
  sanitizeAvatarForgeState,
  serializeAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  applyStudioVrmCharacterVariant,
  listStudioVrmCharacterVariantSummaries,
  STUDIO_VRM_CHARACTER_VARIANTS,
  sanitizeStudioVrmCharacterVariant,
} from "./studio-vrm-character-variants";

describe("studio VRM character variants (CHR-017)", () => {
  it("exposes unique curated variants with UI summaries", () => {
    const ids = STUDIO_VRM_CHARACTER_VARIANTS.map((variant) => variant.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    const summaries = listStudioVrmCharacterVariantSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual(ids);
    for (const summary of summaries) {
      expect(summary.label.length).toBeGreaterThan(0);
      expect(summary.description.length).toBeGreaterThan(0);
      expect(summary.tags.length).toBeGreaterThan(0);
    }
  });

  it("applies a variant without destroying user face geometry", () => {
    const base = createAvatarForgeState();
    const customized = sanitizeAvatarForgeState({
      ...base,
      face: { ...base.face, headWidth: base.face.headWidth + 0.2 },
    });
    const applied = applyStudioVrmCharacterVariant(customized, "idol-twintail");
    expect(applied.face.headWidth).toBe(customized.face.headWidth);
    expect(applied.hair.style).toBe("twintail");
    expect(applied.hair.baseColor).toBe("#f2a7c3");
    // Body preset rides along with the variant.
    expect(applied.bodyPresetId).toBe("soft");
  });

  it("merges accent toggles deterministically in canonical order", () => {
    const base = createAvatarForgeState();
    const applied = applyStudioVrmCharacterVariant(base, "idol-twintail");
    const accents = applied.faceAccents ?? [];
    const blush = accents.find((accent) => accent.id === "blush");
    expect(blush?.enabled).toBe(true);
    expect(blush?.color).toBe("#fb7185");
    // sanitizeAvatarForgeState enforces the canonical accent order.
    expect(accents.map((accent) => accent.id)).toEqual(["blush", "freckles", "beauty-mark"]);
  });

  it("is deterministic: same state + same variant → identical serialization", () => {
    const base = createAvatarForgeState("sunny-short");
    const first = serializeAvatarForgeState(
      applyStudioVrmCharacterVariant(base, "street-wolf"),
    );
    const second = serializeAvatarForgeState(
      applyStudioVrmCharacterVariant(base, "street-wolf"),
    );
    expect(first).toEqual(second);
  });

  it("returns the sanitized state unchanged for unknown or invalid variant ids", () => {
    const base = createAvatarForgeState();
    const unknown = applyStudioVrmCharacterVariant(base, "does-not-exist");
    expect(serializeAvatarForgeState(unknown)).toEqual(serializeAvatarForgeState(base));
    const empty = applyStudioVrmCharacterVariant(base, "");
    expect(serializeAvatarForgeState(empty)).toEqual(serializeAvatarForgeState(base));
  });

  it("sanitizes untrusted variant payloads into a safe shape", () => {
    const sanitized = sanitizeStudioVrmCharacterVariant({
      id: "custom",
      label: "커스텀",
      description: "설명",
      tags: ["태그", 42],
      hair: { style: "bob", baseColor: "#aabbcc", volume: 1.7 },
      accents: [{ id: "blush", enabled: true }],
    });
    expect(sanitized).not.toBeNull();
    if (!sanitized) return;
    expect(sanitized.tags).toEqual(["태그"]);
    expect(sanitized.hair.baseColor).toBe("#aabbcc");
    expect(sanitized.hair.volume).toBe(1.7);
    expect(sanitizeStudioVrmCharacterVariant({ id: "" })).toBeNull();
    expect(sanitizeStudioVrmCharacterVariant(null)).toBeNull();
  });

  it("keeps every curated variant applicable from the default state", () => {
    for (const variant of STUDIO_VRM_CHARACTER_VARIANTS) {
      const applied = applyStudioVrmCharacterVariant(createAvatarForgeState(), variant.id);
      expect(applied.hair.style).toBe(variant.hair.style ?? applied.hair.style);
      for (const value of Object.values(applied.proportions)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
