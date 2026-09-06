/**
 * Character Shaper — pure apply planning.
 *
 * A plan is the list of host calls one commit performs, computed from an entry, the capability
 * profile and the current host snapshot. Planning never mutates anything; the binding executes
 * the steps (merging every Avatar Forge write into one `handleAvatarForgeChange`) and records one
 * undo step. Unavailable entries yield zero steps; partial entries drop only what the model lacks.
 */

import { DEFAULT_AVATAR_FORGE_STATE } from "../vrm/studio-vrm-avatar-forge";

import { evaluateCharacterSlotEntry } from "./character-shaper-capability";
import {
  CHARACTER_NEUTRAL_SLOT_ENTRY_IDS,
  characterSlotMeta,
  findCharacterSlotEntry,
  listCharacterSlotEntries,
} from "./character-shaper-catalog";

import type {
  CharacterApplyPlan,
  CharacterApplyStep,
  CharacterCapabilityProfile,
  CharacterHandSide,
  CharacterHostSnapshot,
  CharacterSemanticMorphBundle,
  CharacterSlotAvailability,
  CharacterSlotEntry,
  CharacterSlotKind,
} from "./character-shaper-contract";
import type { CostumeSlot } from "../vrm/studio-vrm-costume";
import type { WardrobeSlot } from "../vrm/studio-vrm-wardrobe";

export interface CharacterSlotPlanContext {
  readonly snapshot: CharacterHostSnapshot;
  readonly handSide: CharacterHandSide;
}

const AVAILABLE: CharacterSlotAvailability = Object.freeze({ status: "available", reason: null, missing: Object.freeze([]) });

const EYE_MORPH_IDS = ["eyeSize", "eyeSpacing", "eyeTilt"] as const;
const NOSE_MORPH_IDS = ["noseHeight", "noseWidth"] as const;
const MOUTH_MORPH_IDS = ["mouthWidth", "lipFullness"] as const;

function freezePlan(plan: CharacterApplyPlan): CharacterApplyPlan {
  return Object.freeze({ ...plan, steps: Object.freeze([...plan.steps]) });
}

function planLabel(slot: CharacterSlotKind, entryLabel: string): string {
  return `${characterSlotMeta(slot).label}: ${entryLabel}`;
}

/** Keeps only the morph ids the model can honour (zero-valued unsupported ids are no-ops anyway). */
function supportedMorphs(morphs: CharacterSemanticMorphBundle, profile: CharacterCapabilityProfile): CharacterSemanticMorphBundle {
  const next: CharacterSemanticMorphBundle = {};
  for (const id of Object.keys(morphs) as (keyof CharacterSemanticMorphBundle)[]) {
    const value = morphs[id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!profile.semanticMorphs[id]) continue;
    next[id] = value;
  }
  return next;
}

function morphStep(morphs: CharacterSemanticMorphBundle, profile: CharacterCapabilityProfile): CharacterApplyStep[] {
  const supported = supportedMorphs(morphs, profile);
  return Object.keys(supported).length > 0 ? [{ kind: "semantic-morph", morphs: Object.freeze(supported) }] : [];
}

function zeroMorphs(ids: readonly (keyof CharacterSemanticMorphBundle)[]): CharacterSemanticMorphBundle {
  const next: CharacterSemanticMorphBundle = {};
  for (const id of ids) next[id] = 0;
  return next;
}

/** Prop ids owned by the ears slot (elf / animal ears), read from the catalog so both stay in sync. */
function earPropIds(): string[] {
  return listCharacterSlotEntries("ears").flatMap((item) => (
    item.apply.kind === "ears" && item.apply.propId ? [item.apply.propId] : []
  ));
}

function earPropSteps(targetPropId: string | null, snapshot: CharacterHostSnapshot, profile: CharacterCapabilityProfile): CharacterApplyStep[] {
  const steps: CharacterApplyStep[] = [];
  const equipped = new Set(snapshot.propIds);
  for (const propId of earPropIds()) {
    if (propId !== targetPropId && equipped.has(propId)) steps.push({ kind: "prop-remove", propId });
  }
  if (targetPropId && profile.propsReady && !equipped.has(targetPropId)) {
    steps.push({ kind: "prop-add", propId: targetPropId });
  }
  return steps;
}

function expressionFloorStep(floor: Readonly<Record<string, number>>, profile: CharacterCapabilityProfile): CharacterApplyStep[] {
  if (profile.expressions.length === 0) return [];
  const present = new Set(profile.expressions);
  const weights: Record<string, number> = {};
  for (const [name, value] of Object.entries(floor)) {
    if (!present.has(name) || !Number.isFinite(value) || value <= 0) continue;
    weights[name] = Math.min(1, value);
  }
  return Object.keys(weights).length > 0 ? [{ kind: "expression-floor", weights: Object.freeze(weights) }] : [];
}

/** The top slot holds one visible garment: equipping a top clears the outer layer and vice versa. */
function wardrobeSteps(slot: WardrobeSlot, itemId: string | null, color: string | undefined, snapshot: CharacterHostSnapshot): CharacterApplyStep[] {
  const steps: CharacterApplyStep[] = [];
  const partner: WardrobeSlot | null = slot === "top" ? "outer" : slot === "outer" ? "top" : null;
  if (partner && itemId && snapshot.wardrobe[partner]) steps.push({ kind: "wardrobe-equip", slot: partner, itemId: null });
  steps.push(color ? { kind: "wardrobe-equip", slot, itemId, color } : { kind: "wardrobe-equip", slot, itemId });
  return steps;
}

function costumeOriginalSteps(
  wardrobeSlot: WardrobeSlot,
  costumeSlots: readonly CostumeSlot[],
  snapshot: CharacterHostSnapshot,
): CharacterApplyStep[] {
  const steps: CharacterApplyStep[] = [];
  const slots: WardrobeSlot[] = wardrobeSlot === "top" ? ["outer", "top"] : [wardrobeSlot];
  for (const slot of slots) {
    if (snapshot.wardrobe[slot]) steps.push({ kind: "wardrobe-equip", slot, itemId: null });
  }
  steps.push({ kind: "costume-visibility", slots: Object.freeze([...costumeSlots]), visible: true });
  return steps;
}

function stepsFor(entry: CharacterSlotEntry, profile: CharacterCapabilityProfile, context: CharacterSlotPlanContext): CharacterApplyStep[] {
  const { snapshot } = context;
  const ref = entry.apply;
  switch (ref.kind) {
    case "forge-face":
      return [{ kind: "forge-face", face: Object.freeze({ ...ref.face }) }];
    case "semantic-morph":
      return morphStep(ref.morphs, profile);
    case "iris": {
      const steps: CharacterApplyStep[] = morphStep({ irisSize: ref.irisSize }, profile);
      if (ref.color === null || profile.irisTintable) steps.push({ kind: "iris-color", color: ref.color });
      return steps;
    }
    case "mouth":
      return [...morphStep(ref.morphs, profile), ...expressionFloorStep(ref.expressionFloor, profile)];
    case "ears":
      return [...morphStep(ref.morphs, profile), ...earPropSteps(ref.propId, snapshot, profile)];
    case "forge-hair":
      return [{ kind: "forge-hair", hair: Object.freeze({ ...ref.hair }) }];
    case "hair-original":
      return [{ kind: "forge-hair", hair: Object.freeze({ style: "none", replaceOriginal: false }) }];
    case "proportion":
      return [ref.bodyPresetId
        ? { kind: "proportion", presetId: ref.presetId, bodyPresetId: ref.bodyPresetId }
        : { kind: "proportion", presetId: ref.presetId }];
    case "wardrobe":
      return wardrobeSteps(ref.slot, ref.itemId, ref.color, snapshot);
    case "wardrobe-set":
      return [{ kind: "wardrobe-set", setId: ref.setId }];
    case "costume-original":
      return costumeOriginalSteps(ref.wardrobeSlot, ref.costumeSlots, snapshot);
    case "prop":
      if (snapshot.propIds.includes(ref.propId)) return [];
      return [ref.color ? { kind: "prop-add", propId: ref.propId, color: ref.color } : { kind: "prop-add", propId: ref.propId }];
    case "expression":
      return [{ kind: "expression-preset", presetId: ref.presetId }];
    case "pose":
      return [{ kind: "pose-preset", presetId: ref.presetId }];
    case "hand-pose":
      return [{ kind: "hand-pose", poseType: ref.poseType, side: context.handSide }];
    case "none":
      return planCharacterSlotClear(entry.slot, context)?.steps.slice() ?? [];
    default:
      return [];
  }
}

/**
 * Plan for committing one entry. Unavailable entries carry zero steps and the reason; partial
 * entries keep only the supported morph ids / expression names.
 */
export function planCharacterSlotApply(
  entry: CharacterSlotEntry,
  profile: CharacterCapabilityProfile,
  context: CharacterSlotPlanContext,
): CharacterApplyPlan {
  const availability = evaluateCharacterSlotEntry(entry, profile);
  const steps = availability.status === "unavailable" ? [] : stepsFor(entry, profile, context);
  return freezePlan({
    entryId: entry.id,
    slot: entry.slot,
    label: planLabel(entry.slot, entry.label),
    steps,
    availability,
  });
}

function clearSteps(slot: CharacterSlotKind, context: CharacterSlotPlanContext): CharacterApplyStep[] | null {
  const { snapshot } = context;
  switch (slot) {
    case "face-shape":
      return [{ kind: "forge-face", face: Object.freeze({ ...DEFAULT_AVATAR_FORGE_STATE.face }) }];
    case "eyes":
      return [{ kind: "semantic-morph", morphs: Object.freeze(zeroMorphs(EYE_MORPH_IDS)) }];
    case "irises":
      return [
        { kind: "semantic-morph", morphs: Object.freeze({ irisSize: 0 }) },
        { kind: "iris-color", color: null },
      ];
    case "nose":
      return [{ kind: "semantic-morph", morphs: Object.freeze(zeroMorphs(NOSE_MORPH_IDS)) }];
    case "mouth":
      return [{ kind: "semantic-morph", morphs: Object.freeze(zeroMorphs(MOUTH_MORPH_IDS)) }];
    case "ears": {
      const equipped = new Set(snapshot.propIds);
      return [
        { kind: "semantic-morph", morphs: Object.freeze({ earSize: 0 }) },
        ...earPropIds().filter((propId) => equipped.has(propId)).map((propId): CharacterApplyStep => ({ kind: "prop-remove", propId })),
      ];
    }
    case "hair":
      return [{ kind: "forge-hair", hair: Object.freeze({ style: "none", replaceOriginal: false }) }];
    case "body":
      return [{ kind: "proportion", presetId: "realistic-8" }];
    case "top":
      return costumeOriginalSteps("top", ["outer", "tops", "onepiece"], snapshot);
    case "bottom":
      return costumeOriginalSteps("bottom", ["bottoms", "onepiece"], snapshot);
    case "shoes":
      return costumeOriginalSteps("shoes", ["shoes"], snapshot);
    case "accessory": {
      const equipped = new Set(snapshot.propIds);
      const steps = listCharacterSlotEntries("accessory")
        .flatMap((item) => (item.apply.kind === "prop" && equipped.has(item.apply.propId) ? [item.apply.propId] : []))
        .map((propId): CharacterApplyStep => ({ kind: "prop-remove", propId }));
      return steps.length > 0 ? steps : null;
    }
    case "expression":
      return [{ kind: "expression-preset", presetId: "xf_neutral" }];
    case "pose":
      return null;
    case "hand-pose":
      return [{ kind: "hand-pose", poseType: "relaxed", side: context.handSide }];
    default:
      return null;
  }
}

/**
 * Plan that returns a slot to "없음 / 원본". `null` when the slot has nothing to clear (pose has no
 * neutral preset; an empty accessory list has nothing to remove).
 */
export function planCharacterSlotClear(slot: CharacterSlotKind, context: CharacterSlotPlanContext): CharacterApplyPlan | null {
  const steps = clearSteps(slot, context);
  if (!steps) return null;
  const neutralId = CHARACTER_NEUTRAL_SLOT_ENTRY_IDS[slot];
  const neutral = neutralId ? findCharacterSlotEntry(neutralId) : null;
  return freezePlan({
    entryId: neutral?.id ?? `${slot}:clear`,
    slot,
    label: planLabel(slot, neutral?.label ?? "초기화"),
    steps,
    availability: AVAILABLE,
  });
}

/**
 * Plan that removes one entry from a multi slot (accessory → `prop-remove`). Single slots return
 * `null`; use `planCharacterSlotClear` for them.
 */
export function planCharacterSlotRemove(
  slot: CharacterSlotKind,
  entryId: string,
  context: CharacterSlotPlanContext,
): CharacterApplyPlan | null {
  if (!characterSlotMeta(slot).multi) return null;
  const entry = findCharacterSlotEntry(entryId);
  if (!entry || entry.slot !== slot || entry.apply.kind !== "prop") return null;
  const propId = entry.apply.propId;
  const steps: CharacterApplyStep[] = context.snapshot.propIds.includes(propId) ? [{ kind: "prop-remove", propId }] : [];
  return freezePlan({
    entryId: entry.id,
    slot,
    label: `${characterSlotMeta(slot).label} 제거: ${entry.label}`,
    steps,
    availability: AVAILABLE,
  });
}
