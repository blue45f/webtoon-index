import { describe, expect, it } from "vitest";

import { DEFAULT_AVATAR_FORGE_STATE } from "../vrm/studio-vrm-avatar-forge";

import { planCharacterSlotApply, planCharacterSlotClear, planCharacterSlotRemove } from "./character-shaper-apply-plan";
import { EMPTY_CHARACTER_CAPABILITY_PROFILE } from "./character-shaper-capability";
import { findCharacterSlotEntry, listCharacterSlotEntries } from "./character-shaper-catalog";

import type { CharacterCapabilityProfile, CharacterHostSnapshot, CharacterSlotEntry } from "./character-shaper-contract";

const FULL_PROFILE: CharacterCapabilityProfile = {
  ...EMPTY_CHARACTER_CAPABILITY_PROFILE,
  status: "ready",
  modelId: "sample",
  modelName: "샘플",
  humanoid: true,
  propsReady: true,
  wardrobeMetricsReady: true,
  irisTintable: true,
  originalHairMeshCount: 2,
  expressions: ["happy", "sad", "angry", "surprised", "relaxed", "aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight"],
  semanticMorphs: {
    eyeSize: "native-morph",
    eyeSpacing: "adaptive-mesh",
    eyeTilt: "adaptive-mesh",
    irisSize: "native-morph",
    noseHeight: "adaptive-mesh",
    noseWidth: "adaptive-mesh",
    mouthWidth: "adaptive-mesh",
    lipFullness: "adaptive-mesh",
    earSize: "adaptive-mesh",
  },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function snapshotWith(overrides: Partial<CharacterHostSnapshot> = {}): CharacterHostSnapshot {
  return deepFreeze({
    forgeFace: { ...DEFAULT_AVATAR_FORGE_STATE.face },
    semanticMorphs: {},
    hairStyle: "none",
    hairBangStyle: "full",
    hairReplaceOriginal: false,
    hairBaseColor: "#352a28",
    hairTipColor: "#6b5148",
    proportionPresetId: null,
    bodyPresetId: "balanced",
    wardrobe: {},
    propIds: [],
    activePoseId: null,
    activeExpressionId: "neutral",
    expressionWeights: {},
    customColors: {},
    irisColor: null,
    handSide: "both",
    lastHandPoseType: null,
    ...overrides,
  });
}

function entryOf(id: string): CharacterSlotEntry {
  const entry = findCharacterSlotEntry(id);
  if (!entry) throw new Error(`missing entry ${id}`);
  return entry;
}

function plan(id: string, snapshot = snapshotWith(), profile = FULL_PROFILE, handSide: CharacterHostSnapshot["handSide"] = "both") {
  return planCharacterSlotApply(entryOf(id), profile, { snapshot, handSide });
}

describe("planCharacterSlotApply", () => {
  it("returns frozen plans with a slot-labelled undo entry and never mutates inputs", () => {
    const snapshot = snapshotWith({ propIds: ["catEars"] });
    const result = plan("ears:elf", snapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(result.label).toBe("귀: 엘프 귀");
    expect(result.entryId).toBe("ears:elf");
    expect(result.slot).toBe("ears");
    expect(snapshot.propIds).toEqual(["catEars"]);
  });

  it("carries zero steps and the reason when the entry is unavailable", () => {
    for (const entry of listCharacterSlotEntries("eyes")) {
      const result = planCharacterSlotApply(entry, EMPTY_CHARACTER_CAPABILITY_PROFILE, { snapshot: snapshotWith(), handSide: "both" });
      expect(result.steps).toEqual([]);
      expect(result.availability.status).toBe("unavailable");
      expect(result.availability.reason).toBeTruthy();
    }
    expect(plan("irises:blue", snapshotWith(), { ...FULL_PROFILE, irisTintable: false }).steps).toEqual([]);
  });

  it("drops missing semantic morph ids and marks the plan partial", () => {
    const profile: CharacterCapabilityProfile = { ...FULL_PROFILE, semanticMorphs: { ...FULL_PROFILE.semanticMorphs, eyeSpacing: null, eyeTilt: null } };
    const result = plan("eyes:cat", snapshotWith(), profile);
    expect(result.availability.status).toBe("partial");
    expect(result.steps).toEqual([{ kind: "semantic-morph", morphs: { eyeSize: 0.1 } }]);
    expect(plan("eyes:cat").steps).toEqual([{ kind: "semantic-morph", morphs: { eyeSize: 0.1, eyeSpacing: 0, eyeTilt: 0.6 } }]);
  });

  it("plans face, iris, nose, mouth and ear entries from their apply refs", () => {
    expect(plan("face-shape:oval").steps).toEqual([{ kind: "forge-face", face: { headWidth: 0.97, headHeight: 1.05, headDepth: 1, cheekVolume: 0.3, chinLength: 1.04 } }]);
    expect(plan("irises:blue").steps).toEqual([
      { kind: "semantic-morph", morphs: { irisSize: 0 } },
      { kind: "iris-color", color: "#3b6fb6" },
    ]);
    expect(plan("irises:large").steps).toEqual([
      { kind: "semantic-morph", morphs: { irisSize: 0.5 } },
      { kind: "iris-color", color: null },
    ]);
    expect(plan("irises:blue", snapshotWith(), { ...FULL_PROFILE, semanticMorphs: { ...FULL_PROFILE.semanticMorphs, irisSize: null } }).steps).toEqual([
      { kind: "iris-color", color: "#3b6fb6" },
    ]);
    expect(plan("nose:high").steps).toEqual([{ kind: "semantic-morph", morphs: { noseHeight: 0.6, noseWidth: -0.15 } }]);
    expect(plan("mouth:natural-smile").steps).toEqual([
      { kind: "semantic-morph", morphs: { mouthWidth: 0.15, lipFullness: 0 } },
      { kind: "expression-floor", weights: { happy: 0.2 } },
    ]);
    expect(plan("mouth:natural-smile", snapshotWith(), { ...FULL_PROFILE, expressions: ["aa"] }).steps).toEqual([
      { kind: "semantic-morph", morphs: { mouthWidth: 0.15, lipFullness: 0 } },
    ]);
    expect(plan("mouth:neat-line").steps).toEqual([{ kind: "semantic-morph", morphs: { mouthWidth: 0, lipFullness: 0 } }]);
  });

  it("swaps ear props and never adds a prop twice", () => {
    expect(plan("ears:elf", snapshotWith({ propIds: ["catEars"] })).steps).toEqual([
      { kind: "semantic-morph", morphs: { earSize: 0 } },
      { kind: "prop-remove", propId: "catEars" },
      { kind: "prop-add", propId: "elfEars" },
    ]);
    expect(plan("ears:elf", snapshotWith({ propIds: ["elfEars"] })).steps).toEqual([{ kind: "semantic-morph", morphs: { earSize: 0 } }]);
    expect(plan("ears:standard", snapshotWith({ propIds: ["elfEars", "glasses"] })).steps).toEqual([
      { kind: "semantic-morph", morphs: { earSize: 0 } },
      { kind: "prop-remove", propId: "elfEars" },
    ]);
    expect(plan("ears:large").steps).toEqual([{ kind: "semantic-morph", morphs: { earSize: 0.5 } }]);
  });

  it("plans hair, body, expression, pose and hand pose", () => {
    expect(plan("hair:original").steps).toEqual([{ kind: "forge-hair", hair: { style: "none", replaceOriginal: false } }]);
    const bob = plan("hair:bob").steps[0];
    expect(bob?.kind).toBe("forge-hair");
    if (bob?.kind === "forge-hair") {
      expect(bob.hair).toMatchObject({ style: "bob", replaceOriginal: true, bangStyle: "blunt", curl: 0.25 });
      expect(bob.hair.baseColor).toBeUndefined();
    }
    expect(plan("body:sd-chibi-3").steps).toEqual([{ kind: "proportion", presetId: "sd-chibi-3" }]);
    expect(plan("expression:xf_wink").steps).toEqual([{ kind: "expression-preset", presetId: "xf_wink" }]);
    expect(plan("pose:xp_run").steps).toEqual([{ kind: "pose-preset", presetId: "xp_run" }]);
    expect(plan("hand-pose:fist", snapshotWith(), FULL_PROFILE, "left").steps).toEqual([{ kind: "hand-pose", poseType: "fist", side: "left" }]);
    expect(plan("hand-pose:peace").steps).toEqual([{ kind: "hand-pose", poseType: "peace", side: "both" }]);
  });

  it("keeps the top slot to one visible garment and restores the costume for 원본 유지", () => {
    const layered = snapshotWith({ wardrobe: { outer: { itemId: "blazer", color: "#2b3a5e" }, top: { itemId: "shirt", color: "#f8fafc" } } });
    expect(plan("top:tshirt", layered).steps).toEqual([
      { kind: "wardrobe-equip", slot: "outer", itemId: null },
      { kind: "wardrobe-equip", slot: "top", itemId: "tshirt", color: "#e5e7eb" },
    ]);
    expect(plan("top:hoodie", snapshotWith({ wardrobe: { top: { itemId: "shirt", color: "#f8fafc" } } })).steps).toEqual([
      { kind: "wardrobe-equip", slot: "top", itemId: null },
      { kind: "wardrobe-equip", slot: "outer", itemId: "hoodie", color: "#374151" },
    ]);
    expect(plan("bottom:jeans").steps).toEqual([{ kind: "wardrobe-equip", slot: "bottom", itemId: "jeans", color: "#3b5b85" }]);
    expect(plan("top:original", layered).steps).toEqual([
      { kind: "wardrobe-equip", slot: "outer", itemId: null },
      { kind: "wardrobe-equip", slot: "top", itemId: null },
      { kind: "costume-visibility", slots: ["outer", "tops", "onepiece"], visible: true },
    ]);
    expect(plan("shoes:original").steps).toEqual([{ kind: "costume-visibility", slots: ["shoes"], visible: true }]);
  });

  it("adds accessories idempotently", () => {
    expect(plan("accessory:glasses").steps).toEqual([{ kind: "prop-add", propId: "glasses" }]);
    expect(plan("accessory:glasses", snapshotWith({ propIds: ["glasses"] })).steps).toEqual([]);
  });
});

describe("planCharacterSlotClear", () => {
  const context = { snapshot: snapshotWith({ propIds: ["elfEars", "glasses", "backpack", "sword"] }), handSide: "right" as const };

  it("returns each slot to its neutral entry", () => {
    expect(planCharacterSlotClear("face-shape", context)?.steps).toEqual([{ kind: "forge-face", face: DEFAULT_AVATAR_FORGE_STATE.face }]);
    expect(planCharacterSlotClear("eyes", context)?.steps).toEqual([{ kind: "semantic-morph", morphs: { eyeSize: 0, eyeSpacing: 0, eyeTilt: 0 } }]);
    expect(planCharacterSlotClear("irises", context)?.steps).toEqual([
      { kind: "semantic-morph", morphs: { irisSize: 0 } },
      { kind: "iris-color", color: null },
    ]);
    expect(planCharacterSlotClear("ears", context)?.steps).toEqual([
      { kind: "semantic-morph", morphs: { earSize: 0 } },
      { kind: "prop-remove", propId: "elfEars" },
    ]);
    const hair = planCharacterSlotClear("hair", context);
    expect(hair?.steps).toEqual([{ kind: "forge-hair", hair: { style: "none", replaceOriginal: false } }]);
    expect(hair?.entryId).toBe("hair:original");
    expect(hair?.label).toBe("헤어: 원본 유지");
    expect(planCharacterSlotClear("body", context)?.steps).toEqual([{ kind: "proportion", presetId: "realistic-8" }]);
    expect(planCharacterSlotClear("top", context)?.steps).toEqual([{ kind: "costume-visibility", slots: ["outer", "tops", "onepiece"], visible: true }]);
    expect(planCharacterSlotClear("expression", context)?.steps).toEqual([{ kind: "expression-preset", presetId: "xf_neutral" }]);
    expect(planCharacterSlotClear("hand-pose", context)?.steps).toEqual([{ kind: "hand-pose", poseType: "relaxed", side: "right" }]);
  });

  it("removes only catalog accessories and has nothing to clear for poses or empty lists", () => {
    expect(planCharacterSlotClear("accessory", context)?.steps).toEqual([
      { kind: "prop-remove", propId: "glasses" },
      { kind: "prop-remove", propId: "backpack" },
    ]);
    expect(planCharacterSlotClear("accessory", { ...context, snapshot: snapshotWith() })).toBeNull();
    expect(planCharacterSlotClear("pose", context)).toBeNull();
  });
});

describe("planCharacterSlotRemove", () => {
  it("removes one accessory and refuses single slots or foreign ids", () => {
    const context = { snapshot: snapshotWith({ propIds: ["glasses"] }), handSide: "both" as const };
    const removal = planCharacterSlotRemove("accessory", "accessory:glasses", context);
    expect(removal?.steps).toEqual([{ kind: "prop-remove", propId: "glasses" }]);
    expect(removal?.label).toBe("액세서리 제거: 안경");
    expect(planCharacterSlotRemove("accessory", "accessory:backpack", context)?.steps).toEqual([]);
    expect(planCharacterSlotRemove("accessory", "eyes:cat", context)).toBeNull();
    expect(planCharacterSlotRemove("eyes", "eyes:cat", context)).toBeNull();
    expect(planCharacterSlotRemove("accessory", "accessory:nope", context)).toBeNull();
  });
});
