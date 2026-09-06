import { describe, expect, it } from "vitest";

import { EXPRESSION_PRESETS } from "../studio-pose-presets";
import { DEFAULT_AVATAR_FORGE_STATE } from "../vrm/studio-vrm-avatar-forge";
import { applyWardrobeItemSelection, applyWardrobeSet, wardrobeItemById, wardrobeSetById } from "../vrm/studio-vrm-wardrobe";

import { planCharacterSlotApply } from "./character-shaper-apply-plan";
import { findCharacterSlotEntry, listCharacterSlotEntries } from "./character-shaper-catalog";
import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import {
  createEmptyCharacterRecipe,
  deriveCharacterRecipe,
  describeCharacterRecipe,
  diffCharacterRecipes,
  parseCharacterRecipe,
  serializeCharacterRecipe,
} from "./character-shaper-recipe";

import type {
  CharacterApplyStep,
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterSlotKind,
} from "./character-shaper-contract";
import type { WardrobeSlot, WardrobeState } from "../vrm/studio-vrm-wardrobe";

const FULL_PROFILE: CharacterCapabilityProfile = {
  status: "ready",
  modelId: "sample",
  modelName: "샘플 모델",
  humanoid: true,
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
  expressions: ["happy", "angry", "sad", "relaxed", "surprised", "blink", "blinkLeft", "blinkRight", "aa", "ih", "ou", "ee", "oh", "lookUp", "lookDown", "lookLeft", "lookRight"],
  costumeSlots: ["outer", "tops", "bottoms", "onepiece", "shoes"],
  wardrobeMetricsReady: true,
  propsReady: true,
  irisTintable: true,
  originalHairMeshCount: 2,
  surfacePaintReady: true,
};

const EMPTY_PROFILE: CharacterCapabilityProfile = { ...FULL_PROFILE, status: "empty" };

type MutableSnapshot = {
  -readonly [K in keyof CharacterHostSnapshot]: CharacterHostSnapshot[K];
};

function freshSnapshot(): CharacterHostSnapshot {
  return {
    forgeFace: { ...DEFAULT_AVATAR_FORGE_STATE.face },
    semanticMorphs: {},
    hairStyle: "none",
    hairBangStyle: "full",
    hairReplaceOriginal: false,
    hairBaseColor: DEFAULT_AVATAR_FORGE_STATE.hair.baseColor,
    hairTipColor: DEFAULT_AVATAR_FORGE_STATE.hair.tipColor,
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
  };
}

function toWardrobeState(wardrobe: CharacterHostSnapshot["wardrobe"]): WardrobeState {
  const state: WardrobeState = {};
  for (const slot of ["outer", "top", "bottom", "shoes"] as const) {
    const equip = wardrobe[slot];
    const def = equip ? wardrobeItemById(equip.itemId) : undefined;
    if (!equip || !def) continue;
    state[slot] = { itemId: equip.itemId, color: equip.color, fit: 1, fitMode: "auto", fabricId: def.defaultFabricId };
  }
  return state;
}

function fromWardrobeState(state: WardrobeState): CharacterHostSnapshot["wardrobe"] {
  const wardrobe: Partial<Record<WardrobeSlot, { itemId: string; color: string }>> = {};
  for (const slot of ["outer", "top", "bottom", "shoes"] as const) {
    const equip = state[slot];
    if (equip) wardrobe[slot] = { itemId: equip.itemId, color: equip.color };
  }
  return wardrobe;
}

/** Mirrors the host semantics the binding relies on (see notes in the apply-plan module). */
function simulate(snapshot: CharacterHostSnapshot, steps: readonly CharacterApplyStep[]): CharacterHostSnapshot {
  const next: MutableSnapshot = {
    ...snapshot,
    forgeFace: { ...snapshot.forgeFace },
    semanticMorphs: { ...snapshot.semanticMorphs },
    wardrobe: { ...snapshot.wardrobe },
    propIds: [...snapshot.propIds],
    expressionWeights: { ...snapshot.expressionWeights },
  };
  for (const step of steps) {
    switch (step.kind) {
      case "forge-face":
        next.forgeFace = { ...next.forgeFace, ...step.face };
        break;
      case "semantic-morph": {
        const morphs = { ...next.semanticMorphs };
        for (const [id, value] of Object.entries(step.morphs)) {
          const key = id as keyof CharacterHostSnapshot["semanticMorphs"];
          if (typeof value !== "number" || Math.abs(value) < 1e-4) delete morphs[key];
          else morphs[key] = Math.min(1, Math.max(-1, value));
        }
        next.semanticMorphs = morphs;
        break;
      }
      case "iris-color":
        next.irisColor = step.color;
        break;
      case "expression-floor": {
        const weights = { ...next.expressionWeights };
        for (const [name, floor] of Object.entries(step.weights)) weights[name] = Math.max(weights[name] ?? 0, floor);
        next.expressionWeights = weights;
        break;
      }
      case "forge-hair":
        if (step.hair.style !== undefined) next.hairStyle = step.hair.style;
        if (step.hair.replaceOriginal !== undefined) next.hairReplaceOriginal = step.hair.replaceOriginal;
        if (step.hair.bangStyle !== undefined) next.hairBangStyle = step.hair.bangStyle;
        if (step.hair.baseColor !== undefined) next.hairBaseColor = step.hair.baseColor;
        if (step.hair.tipColor !== undefined) next.hairTipColor = step.hair.tipColor;
        break;
      case "proportion":
        next.proportionPresetId = step.presetId;
        if (step.bodyPresetId) next.bodyPresetId = step.bodyPresetId;
        break;
      case "wardrobe-equip": {
        const state = applyWardrobeItemSelection(toWardrobeState(next.wardrobe), step.slot, step.itemId);
        const equipped = state[step.slot];
        if (step.itemId && step.color && equipped) state[step.slot] = { ...equipped, color: step.color };
        next.wardrobe = fromWardrobeState(state);
        break;
      }
      case "wardrobe-set": {
        const set = wardrobeSetById(step.setId);
        if (set) next.wardrobe = fromWardrobeState(applyWardrobeSet(set));
        break;
      }
      case "costume-visibility":
        break;
      case "prop-add":
        next.propIds = [...next.propIds, step.propId];
        break;
      case "prop-remove":
        next.propIds = next.propIds.filter((id) => id !== step.propId);
        break;
      case "expression-preset": {
        const preset = EXPRESSION_PRESETS.find((candidate) => candidate.id === step.presetId);
        next.activeExpressionId = `preset:${step.presetId}`;
        next.expressionWeights = { ...(preset?.weights ?? {}) };
        break;
      }
      case "pose-preset":
        next.activePoseId = step.presetId;
        break;
      case "hand-pose":
        next.lastHandPoseType = step.poseType;
        next.handSide = step.side;
        break;
      default:
        throw new Error(`unhandled step ${JSON.stringify(step)}`);
    }
  }
  return next;
}

const BASELINE_IDS = [
  "face-shape:oval",
  "eyes:romance-sparkle",
  "irises:blue",
  "nose:straight",
  "mouth:natural-smile",
  "ears:standard",
  "hair:bob",
  "body:webtoon-7",
  "top:shirt",
  "bottom:pleated",
  "shoes:loafers",
  "accessory:glasses",
  "accessory:backpack",
  "expression:xf_joy",
  "pose:xp_wave_greeting",
  "hand-pose:peace",
] as const;

function commit(snapshot: CharacterHostSnapshot, entryId: string, profile = FULL_PROFILE): CharacterHostSnapshot {
  const entry = findCharacterSlotEntry(entryId);
  if (!entry) throw new Error(`missing entry ${entryId}`);
  const plan = planCharacterSlotApply(entry, profile, { snapshot, handSide: snapshot.handSide });
  return simulate(snapshot, plan.steps);
}

function baselineSnapshot(): CharacterHostSnapshot {
  return BASELINE_IDS.reduce<CharacterHostSnapshot>((snapshot, id) => commit(snapshot, id), freshSnapshot());
}

/** Slots an entry is allowed to change besides its own (a dress occupies the bottom slot). */
const ALLOWED_SIDE_EFFECTS: Readonly<Record<string, readonly CharacterSlotKind[]>> = {
  "top:dress": ["bottom"],
};

describe("deriveCharacterRecipe — baseline", () => {
  it("derives the empty recipe shape from a fresh model", () => {
    const recipe = deriveCharacterRecipe(freshSnapshot());
    expect(recipe.version).toBe(1);
    expect(recipe.slots["face-shape"]).toBe("face-shape:balanced");
    expect(recipe.slots.eyes).toBe("eyes:original");
    expect(recipe.slots.irises).toBe("irises:standard");
    expect(recipe.slots.nose).toBe("nose:original");
    expect(recipe.slots.mouth).toBe("mouth:neat-line");
    expect(recipe.slots.ears).toBe("ears:standard");
    expect(recipe.slots.hair).toBe("hair:original");
    expect(recipe.slots.body).toBeNull();
    expect(recipe.slots.top).toBe("top:original");
    expect(recipe.slots.bottom).toBe("bottom:original");
    expect(recipe.slots.shoes).toBe("shoes:original");
    expect(recipe.slots.accessory).toEqual([]);
    expect(recipe.slots.expression).toBe("expression:xf_neutral");
    expect(recipe.slots.pose).toBeNull();
    expect(recipe.slots["hand-pose"]).toBeNull();
    expect(recipe.colors).toEqual({ skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null });
    expect(recipe.handSide).toBe("both");
  });

  it("reads every baseline selection back after committing the plans", () => {
    const recipe = deriveCharacterRecipe(baselineSnapshot());
    expect(recipe.slots).toEqual({
      "face-shape": "face-shape:oval",
      eyes: "eyes:romance-sparkle",
      irises: "irises:blue",
      nose: "nose:straight",
      mouth: "mouth:natural-smile",
      ears: "ears:standard",
      hair: "hair:bob",
      body: "body:webtoon-7",
      top: "top:shirt",
      bottom: "bottom:pleated",
      shoes: "shoes:loafers",
      accessory: ["accessory:glasses", "accessory:backpack"],
      expression: "expression:xf_joy",
      pose: "pose:xp_wave_greeting",
      "hand-pose": "hand-pose:peace",
    });
    expect(recipe.colors).toEqual({
      skin: null,
      hairBase: DEFAULT_AVATAR_FORGE_STATE.hair.baseColor,
      hairTip: DEFAULT_AVATAR_FORGE_STATE.hair.tipColor,
      iris: "#3b6fb6",
      top: "#f8fafc",
      bottom: "#1e293b",
      shoes: "#451a03",
    });
  });
});

describe("deriveCharacterRecipe — round trips", () => {
  const baseline = baselineSnapshot();
  const baselineRecipe = deriveCharacterRecipe(baseline);

  for (const slot of CHARACTER_SLOT_KINDS) {
    it(`round-trips every ${slot} entry and leaves the other slots untouched`, () => {
      for (const entry of listCharacterSlotEntries(slot)) {
        const next = commit(baseline, entry.id);
        const recipe = deriveCharacterRecipe(next);
        if (slot === "accessory") expect(recipe.slots.accessory, entry.id).toContain(entry.id);
        else expect(recipe.slots[slot], entry.id).toBe(entry.id);
        const allowed = new Set<CharacterSlotKind>([slot, ...(ALLOWED_SIDE_EFFECTS[entry.id] ?? [])]);
        for (const other of CHARACTER_SLOT_KINDS) {
          if (allowed.has(other)) continue;
          expect(recipe.slots[other], `${entry.id} → ${other}`).toEqual(baselineRecipe.slots[other]);
        }
      }
    });
  }

  it("keeps the hand side chosen at commit time", () => {
    const entry = findCharacterSlotEntry("hand-pose:fist")!;
    const plan = planCharacterSlotApply(entry, FULL_PROFILE, { snapshot: baseline, handSide: "left" });
    const recipe = deriveCharacterRecipe(simulate(baseline, plan.steps));
    expect(recipe.slots["hand-pose"]).toBe("hand-pose:fist");
    expect(recipe.handSide).toBe("left");
  });

  it("changes nothing when the entry is unavailable", () => {
    for (const entry of listCharacterSlotEntries("eyes")) {
      const next = commit(baseline, entry.id, EMPTY_PROFILE);
      expect(deriveCharacterRecipe(next).slots).toEqual(baselineRecipe.slots);
    }
  });
});

describe("deriveCharacterRecipe — matching rules", () => {
  it("treats values outside ε as custom and inside ε as the entry", () => {
    const base = freshSnapshot();
    const near = deriveCharacterRecipe({ ...base, semanticMorphs: { eyeSize: 0.5504, eyeSpacing: 0.05, eyeTilt: 0.1 } });
    expect(near.slots.eyes).toBe("eyes:romance-sparkle");
    const far = deriveCharacterRecipe({ ...base, semanticMorphs: { eyeSize: 0.552, eyeSpacing: 0.05, eyeTilt: 0.1 } });
    expect(far.slots.eyes).toBeNull();
    const customFace = deriveCharacterRecipe({ ...base, forgeFace: { ...base.forgeFace, headWidth: 1.03 } });
    expect(customFace.slots["face-shape"]).toBeNull();
    const nearFace = deriveCharacterRecipe({ ...base, forgeFace: { ...base.forgeFace, headWidth: 1.0004 } });
    expect(nearFace.slots["face-shape"]).toBe("face-shape:balanced");
  });

  it("derives irises from size and exact colour", () => {
    const base = freshSnapshot();
    expect(deriveCharacterRecipe({ ...base, irisColor: "#3B6FB6" }).slots.irises).toBe("irises:blue");
    expect(deriveCharacterRecipe({ ...base, irisColor: "#123456" }).slots.irises).toBeNull();
    expect(deriveCharacterRecipe({ ...base, semanticMorphs: { irisSize: 0.5 } }).slots.irises).toBe("irises:large");
    expect(deriveCharacterRecipe({ ...base, semanticMorphs: { irisSize: 0.5 }, irisColor: "#3b6fb6" }).slots.irises).toBeNull();
  });

  it("derives ears from ear size plus ear-prop presence", () => {
    const base = freshSnapshot();
    expect(deriveCharacterRecipe({ ...base, propIds: ["elfEars"] }).slots.ears).toBe("ears:elf");
    expect(deriveCharacterRecipe({ ...base, propIds: ["catEars", "glasses"] }).slots.ears).toBe("ears:animal");
    expect(deriveCharacterRecipe({ ...base, propIds: ["catEars"], semanticMorphs: { earSize: 0.5 } }).slots.ears).toBeNull();
    expect(deriveCharacterRecipe({ ...base, semanticMorphs: { earSize: 0.5 } }).slots.ears).toBe("ears:large");
    expect(deriveCharacterRecipe({ ...base, propIds: ["catEars", "glasses"] }).slots.accessory).toEqual(["accessory:glasses"]);
  });

  it("derives hair from style and replaceOriginal", () => {
    const base = freshSnapshot();
    expect(deriveCharacterRecipe({ ...base, hairStyle: "none", hairReplaceOriginal: true }).slots.hair).toBe("hair:none");
    expect(deriveCharacterRecipe({ ...base, hairStyle: "ponytail", hairReplaceOriginal: true }).slots.hair).toBe("hair:ponytail");
    expect(deriveCharacterRecipe({ ...base, hairStyle: "ponytail", hairReplaceOriginal: false }).slots.hair).toBeNull();
  });

  it("prefers the outer layer for the top slot and falls back to 원본 유지", () => {
    const base = freshSnapshot();
    const layered = deriveCharacterRecipe({
      ...base,
      wardrobe: { outer: { itemId: "blazer", color: "#111111" }, top: { itemId: "shirt", color: "#f8fafc" } },
    });
    expect(layered.slots.top).toBe("top:blazer");
    expect(layered.colors.top).toBe("#111111");
    expect(deriveCharacterRecipe({ ...base, wardrobe: { top: { itemId: "not-a-garment", color: "#000000" } } }).slots.top).toBeNull();
    expect(deriveCharacterRecipe(base).slots.top).toBe("top:original");
  });

  it("derives the expression from the preset id, then from an exact weight match", () => {
    const base = freshSnapshot();
    expect(deriveCharacterRecipe({ ...base, activeExpressionId: "preset:xf_sad", expressionWeights: { sad: 1 } }).slots.expression).toBe("expression:xf_sad");
    expect(deriveCharacterRecipe({ ...base, activeExpressionId: "xf_angry", expressionWeights: { angry: 1 } }).slots.expression).toBe("expression:xf_angry");
    expect(deriveCharacterRecipe({ ...base, activeExpressionId: "custom", expressionWeights: { sad: 1 } }).slots.expression).toBe("expression:xf_sad");
    expect(deriveCharacterRecipe({ ...base, activeExpressionId: "custom", expressionWeights: { sad: 0.5 } }).slots.expression).toBeNull();
    expect(deriveCharacterRecipe({ ...base, activeExpressionId: "neutral", expressionWeights: {} }).slots.expression).toBe("expression:xf_neutral");
  });

  it("keeps the mouth selection when the expression preset changes", () => {
    const smiling = commit(freshSnapshot(), "mouth:slight-open");
    expect(deriveCharacterRecipe(smiling).slots.mouth).toBe("mouth:slight-open");
    const neutral = commit(smiling, "expression:xf_neutral");
    expect(deriveCharacterRecipe(neutral).slots.mouth).toBe("mouth:slight-open");
    expect(deriveCharacterRecipe(neutral).slots.expression).toBe("expression:xf_neutral");
  });

  it("reads colours from the host snapshot", () => {
    const base = freshSnapshot();
    const recipe = deriveCharacterRecipe({
      ...base,
      customColors: { body: "#F1D2B0", hair: "#223344", tops: "#445566", bottoms: "#778899" },
      irisColor: "#7b4fb0",
      wardrobe: { shoes: { itemId: "boots", color: "#5a4632" } },
    });
    expect(recipe.colors).toEqual({
      skin: "#f1d2b0",
      hairBase: "#223344",
      hairTip: null,
      iris: "#7b4fb0",
      top: "#445566",
      bottom: "#778899",
      shoes: "#5a4632",
    });
  });
});

describe("describeCharacterRecipe / diffCharacterRecipes", () => {
  it("summarises body · hair · top and lists every selected slot", () => {
    const described = describeCharacterRecipe(deriveCharacterRecipe(baselineSnapshot()));
    expect(described.style).toBe("7두신 · 보브 · 셔츠");
    expect(described.lines).toContain("액세서리: 안경, 백팩");
    expect(described.lines).toContain("포즈: 손들어 인사");
    expect(described.changedSlots).toEqual(CHARACTER_SLOT_KINDS.filter((slot) => slot !== "ears"));
  });

  it("describes a fresh model honestly and counts nothing as changed", () => {
    const fresh = describeCharacterRecipe(deriveCharacterRecipe(freshSnapshot()));
    expect(fresh.style).toBe("원본 헤어 · 원본 의상");
    expect(fresh.changedSlots).toEqual([]);
    const empty = describeCharacterRecipe(createEmptyCharacterRecipe());
    expect(empty.style).toBe("선택 없음");
    expect(empty.lines).toEqual([]);
    expect(empty.changedSlots).toEqual([]);
  });

  it("diffs slot selections order-insensitively for multi slots", () => {
    const a = deriveCharacterRecipe(baselineSnapshot());
    const b = { ...a, slots: { ...a.slots, accessory: [...a.slots.accessory].reverse(), eyes: "eyes:cat", pose: null } };
    expect(diffCharacterRecipes(a, b)).toEqual(["eyes", "pose"]);
    expect(diffCharacterRecipes(a, a)).toEqual([]);
    expect(diffCharacterRecipes(createEmptyCharacterRecipe(), a).length).toBeGreaterThan(10);
  });
});

describe("serializeCharacterRecipe / parseCharacterRecipe", () => {
  it("round-trips a derived recipe", () => {
    const recipe = deriveCharacterRecipe(baselineSnapshot());
    const parsed = parseCharacterRecipe(serializeCharacterRecipe(recipe));
    expect(parsed).toEqual(recipe);
    expect(parseCharacterRecipe(JSON.parse(serializeCharacterRecipe(recipe)))).toEqual(recipe);
  });

  it("drops unknown or mismatched ids, invalid colours and hand sides without throwing", () => {
    const parsed = parseCharacterRecipe({
      version: 1,
      slots: { eyes: "nose:dot", nose: "nose:dot", accessory: ["accessory:glasses", "bogus", 3, "accessory:glasses"], pose: 12 },
      colors: { iris: "#ABCDEF", top: "red", skin: 5 },
      handSide: "up",
    });
    expect(parsed.slots.eyes).toBeNull();
    expect(parsed.slots.nose).toBe("nose:dot");
    expect(parsed.slots.accessory).toEqual(["accessory:glasses"]);
    expect(parsed.slots.pose).toBeNull();
    expect(parsed.colors.iris).toBe("#abcdef");
    expect(parsed.colors.top).toBeNull();
    expect(parsed.colors.skin).toBeNull();
    expect(parsed.handSide).toBe("both");
  });

  it("returns the empty recipe for garbage", () => {
    const empty = createEmptyCharacterRecipe();
    for (const garbage of ["{not json", "", 42, null, undefined, [], "[]", "null", { slots: "x", colors: [] }]) {
      expect(parseCharacterRecipe(garbage)).toEqual(empty);
    }
  });
});
