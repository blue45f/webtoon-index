/**
 * Character Shaper — recipe derivation over host state.
 *
 * The recipe is never stored on its own: it is derived from a `CharacterHostSnapshot` each render
 * by matching host values against catalog entries (nearest morph / face bundles within ε = 1e-3,
 * exact ids elsewhere). `null` means "custom / not from the catalog". Serialisation exists for
 * copy & paste only and is validated against the catalog on parse.
 */

import { EXPRESSION_PRESETS } from "../studio-pose-presets";

import {
  CHARACTER_NEUTRAL_SLOT_ENTRY_IDS,
  CHARACTER_SLOT_CATALOG,
  characterSlotMeta,
} from "./character-shaper-catalog";
import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";

import type {
  CharacterHandSide,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterRecipeColors,
  CharacterRecipeSlots,
  CharacterSemanticMorphBundle,
  CharacterSlotCatalog,
  CharacterSlotEntry,
  CharacterSlotKind,
} from "./character-shaper-contract";
import type { AvatarForgeFaceParams } from "../vrm/studio-vrm-avatar-forge";

/** Tolerance for numeric bundle matching (face params, semantic morphs, iris size). */
export const CHARACTER_RECIPE_EPSILON = 1e-3;

const HAND_SIDES: readonly CharacterHandSide[] = ["left", "right", "both"];
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;
const FACE_KEYS: readonly (keyof AvatarForgeFaceParams)[] = ["headWidth", "headHeight", "headDepth", "cheekVolume", "chinLength"];

export function createEmptyCharacterRecipe(): CharacterRecipe {
  return {
    version: 1,
    slots: {
      "face-shape": null,
      eyes: null,
      irises: null,
      nose: null,
      mouth: null,
      ears: null,
      hair: null,
      body: null,
      top: null,
      bottom: null,
      shoes: null,
      accessory: [],
      expression: null,
      pose: null,
      "hand-pose": null,
    },
    colors: { skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null },
    handSide: "both",
  };
}

/* -------------------------------------------------------------------------- */
/* Catalog index (cached per catalog instance)                                 */
/* -------------------------------------------------------------------------- */

type CatalogIndex = {
  readonly bySlot: ReadonlyMap<CharacterSlotKind, readonly CharacterSlotEntry[]>;
  readonly byId: ReadonlyMap<string, CharacterSlotEntry>;
};

const INDEX_CACHE = new WeakMap<CharacterSlotCatalog, CatalogIndex>();

function indexOf(catalog: CharacterSlotCatalog): CatalogIndex {
  const cached = INDEX_CACHE.get(catalog);
  if (cached) return cached;
  const bySlot = new Map<CharacterSlotKind, CharacterSlotEntry[]>();
  const byId = new Map<string, CharacterSlotEntry>();
  for (const item of catalog.entries) {
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
    const list = bySlot.get(item.slot);
    if (list) list.push(item);
    else bySlot.set(item.slot, [item]);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order);
  const index: CatalogIndex = { bySlot, byId };
  INDEX_CACHE.set(catalog, index);
  return index;
}

function entriesOf(index: CatalogIndex, slot: CharacterSlotKind): readonly CharacterSlotEntry[] {
  return index.bySlot.get(slot) ?? [];
}

/* -------------------------------------------------------------------------- */
/* Matching helpers                                                            */
/* -------------------------------------------------------------------------- */

function bundleOf(item: CharacterSlotEntry): CharacterSemanticMorphBundle {
  switch (item.apply.kind) {
    case "semantic-morph":
    case "mouth":
    case "ears":
      return item.apply.morphs;
    case "iris":
      return { irisSize: item.apply.irisSize };
    default:
      return {};
  }
}

function bundleDistance(
  ids: readonly (keyof CharacterSemanticMorphBundle)[],
  a: CharacterSemanticMorphBundle,
  b: CharacterSemanticMorphBundle,
): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Math.abs((a[id] ?? 0) - (b[id] ?? 0)));
  return max;
}

/** Entries whose bundle is within ε of the snapshot, nearest first (stable on ties). */
function nearestByBundle(
  entries: readonly CharacterSlotEntry[],
  ids: readonly (keyof CharacterSemanticMorphBundle)[],
  snapshotBundle: CharacterSemanticMorphBundle,
): CharacterSlotEntry[] {
  const scored = entries
    .map((item, index) => ({ item, index, distance: bundleDistance(ids, bundleOf(item), snapshotBundle) }))
    .filter((candidate) => candidate.distance <= CHARACTER_RECIPE_EPSILON)
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  return scored.map((candidate) => candidate.item);
}

function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = typeof a === "string" ? a.trim().toLowerCase() : null;
  const right = typeof b === "string" ? b.trim().toLowerCase() : null;
  return left === right;
}

function floorSatisfied(item: CharacterSlotEntry, weights: Readonly<Record<string, number>>): boolean {
  if (item.apply.kind !== "mouth") return true;
  for (const [name, floor] of Object.entries(item.apply.expressionFloor)) {
    if ((weights[name] ?? 0) + CHARACTER_RECIPE_EPSILON < floor) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Per-slot derivation                                                         */
/* -------------------------------------------------------------------------- */

function deriveFaceShape(entries: readonly CharacterSlotEntry[], face: AvatarForgeFaceParams): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const item of entries) {
    if (item.apply.kind !== "forge-face") continue;
    let distance = 0;
    for (const key of FACE_KEYS) {
      const target = item.apply.face[key];
      if (typeof target !== "number") continue;
      distance = Math.max(distance, Math.abs(target - face[key]));
    }
    if (distance <= CHARACTER_RECIPE_EPSILON && (!best || distance < best.distance)) best = { id: item.id, distance };
  }
  return best?.id ?? null;
}

function deriveMorphSlot(
  entries: readonly CharacterSlotEntry[],
  ids: readonly (keyof CharacterSemanticMorphBundle)[],
  snapshot: CharacterHostSnapshot,
): string | null {
  const candidates = nearestByBundle(entries, ids, snapshot.semanticMorphs);
  if (candidates.length === 0) return null;
  const satisfied = candidates.find((item) => floorSatisfied(item, snapshot.expressionWeights));
  return (satisfied ?? candidates[0]!).id;
}

function deriveIrises(entries: readonly CharacterSlotEntry[], snapshot: CharacterHostSnapshot): string | null {
  const candidates = nearestByBundle(entries, ["irisSize"], snapshot.semanticMorphs);
  const match = candidates.find((item) => item.apply.kind === "iris" && sameColor(item.apply.color, snapshot.irisColor));
  return match?.id ?? null;
}

function deriveEars(entries: readonly CharacterSlotEntry[], snapshot: CharacterHostSnapshot): string | null {
  const equipped = new Set(snapshot.propIds);
  const earProps = entries.flatMap((item) => (item.apply.kind === "ears" && item.apply.propId ? [item.apply.propId] : []));
  const anyEarPropEquipped = earProps.some((propId) => equipped.has(propId));
  const candidates = nearestByBundle(entries, ["earSize"], snapshot.semanticMorphs);
  const match = candidates.find((item) => {
    if (item.apply.kind !== "ears") return false;
    return item.apply.propId ? equipped.has(item.apply.propId) : !anyEarPropEquipped;
  });
  return match?.id ?? null;
}

function deriveHair(entries: readonly CharacterSlotEntry[], snapshot: CharacterHostSnapshot): string | null {
  if (snapshot.hairStyle === "none" && !snapshot.hairReplaceOriginal) {
    return entries.find((item) => item.apply.kind === "hair-original")?.id ?? null;
  }
  const match = entries.find((item) => (
    item.apply.kind === "forge-hair"
    && (item.apply.hair.style ?? "none") === snapshot.hairStyle
    && (item.apply.hair.replaceOriginal ?? false) === snapshot.hairReplaceOriginal
  ));
  return match?.id ?? null;
}

function deriveGarment(entries: readonly CharacterSlotEntry[], slot: "top" | "bottom" | "shoes", snapshot: CharacterHostSnapshot): string | null {
  const equipped = slot === "top"
    ? (snapshot.wardrobe.outer ?? snapshot.wardrobe.top ?? null)
    : (snapshot.wardrobe[slot] ?? null);
  if (equipped) {
    return entries.find((item) => item.apply.kind === "wardrobe" && item.apply.itemId === equipped.itemId)?.id ?? null;
  }
  return entries.find((item) => item.apply.kind === "costume-original")?.id ?? null;
}

function deriveAccessories(entries: readonly CharacterSlotEntry[], snapshot: CharacterHostSnapshot): string[] {
  const equipped = new Set(snapshot.propIds);
  return entries.flatMap((item) => (item.apply.kind === "prop" && equipped.has(item.apply.propId) ? [item.id] : []));
}

function normalizeExpressionId(raw: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith("preset:") ? raw.slice("preset:".length) : raw;
}

function weightsEqual(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    if (Math.abs((a[name] ?? 0) - (b[name] ?? 0)) > CHARACTER_RECIPE_EPSILON) return false;
  }
  return true;
}

function deriveExpression(entries: readonly CharacterSlotEntry[], snapshot: CharacterHostSnapshot): string | null {
  const id = normalizeExpressionId(snapshot.activeExpressionId);
  if (id) {
    const byId = entries.find((item) => item.apply.kind === "expression" && item.apply.presetId === id);
    if (byId) return byId.id;
  }
  // The host resets the id to neutral / custom after weight edits; fall back to an exact weight match.
  const byWeights = entries.find((item) => {
    if (item.apply.kind !== "expression") return false;
    const presetId = item.apply.presetId;
    const preset = EXPRESSION_PRESETS.find((candidate) => candidate.id === presetId);
    return preset ? weightsEqual(preset.weights, snapshot.expressionWeights) : false;
  });
  return byWeights?.id ?? null;
}

function deriveById(entries: readonly CharacterSlotEntry[], id: string | null, kind: "pose" | "hand-pose" | "proportion"): string | null {
  if (!id) return null;
  const match = entries.find((item) => {
    switch (item.apply.kind) {
      case "pose":
        return kind === "pose" && item.apply.presetId === id;
      case "hand-pose":
        return kind === "hand-pose" && item.apply.poseType === id;
      case "proportion":
        return kind === "proportion" && item.apply.presetId === id;
      default:
        return false;
    }
  });
  return match?.id ?? null;
}

function normalizeColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function deriveColors(snapshot: CharacterHostSnapshot): CharacterRecipeColors {
  const proceduralHair = snapshot.hairStyle !== "none";
  return {
    skin: normalizeColor(snapshot.customColors.body),
    hairBase: proceduralHair ? normalizeColor(snapshot.hairBaseColor) : normalizeColor(snapshot.customColors.hair),
    hairTip: proceduralHair ? normalizeColor(snapshot.hairTipColor) : null,
    iris: normalizeColor(snapshot.irisColor),
    top: normalizeColor(snapshot.wardrobe.outer?.color ?? snapshot.wardrobe.top?.color ?? snapshot.customColors.tops),
    bottom: normalizeColor(snapshot.wardrobe.bottom?.color ?? snapshot.customColors.bottoms),
    shoes: normalizeColor(snapshot.wardrobe.shoes?.color),
  };
}

export function deriveCharacterRecipe(
  snapshot: CharacterHostSnapshot,
  catalog: CharacterSlotCatalog = CHARACTER_SLOT_CATALOG,
): CharacterRecipe {
  const index = indexOf(catalog);
  const slots: CharacterRecipeSlots = {
    "face-shape": deriveFaceShape(entriesOf(index, "face-shape"), snapshot.forgeFace),
    eyes: deriveMorphSlot(entriesOf(index, "eyes"), ["eyeSize", "eyeSpacing", "eyeTilt"], snapshot),
    irises: deriveIrises(entriesOf(index, "irises"), snapshot),
    nose: deriveMorphSlot(entriesOf(index, "nose"), ["noseHeight", "noseWidth"], snapshot),
    mouth: deriveMorphSlot(entriesOf(index, "mouth"), ["mouthWidth", "lipFullness"], snapshot),
    ears: deriveEars(entriesOf(index, "ears"), snapshot),
    hair: deriveHair(entriesOf(index, "hair"), snapshot),
    body: deriveById(entriesOf(index, "body"), snapshot.proportionPresetId, "proportion"),
    top: deriveGarment(entriesOf(index, "top"), "top", snapshot),
    bottom: deriveGarment(entriesOf(index, "bottom"), "bottom", snapshot),
    shoes: deriveGarment(entriesOf(index, "shoes"), "shoes", snapshot),
    accessory: deriveAccessories(entriesOf(index, "accessory"), snapshot),
    expression: deriveExpression(entriesOf(index, "expression"), snapshot),
    pose: deriveById(entriesOf(index, "pose"), snapshot.activePoseId, "pose"),
    "hand-pose": deriveById(entriesOf(index, "hand-pose"), snapshot.lastHandPoseType, "hand-pose"),
  };
  return {
    version: 1,
    slots,
    colors: deriveColors(snapshot),
    handSide: HAND_SIDES.includes(snapshot.handSide) ? snapshot.handSide : "both",
  };
}

/* -------------------------------------------------------------------------- */
/* Description / diff                                                          */
/* -------------------------------------------------------------------------- */

function selectedIds(recipe: CharacterRecipe, slot: CharacterSlotKind): readonly string[] {
  const value = recipe.slots[slot];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function isNeutralSelection(slot: CharacterSlotKind, ids: readonly string[]): boolean {
  if (ids.length === 0) return true;
  const neutral = CHARACTER_NEUTRAL_SLOT_ENTRY_IDS[slot];
  return ids.length === 1 && ids[0] === neutral;
}

function styleWord(item: CharacterSlotEntry | null | undefined, originalWord: string): string | null {
  if (!item) return null;
  if (item.apply.kind === "hair-original" || item.apply.kind === "costume-original") return originalWord;
  return item.label;
}

export function describeCharacterRecipe(
  recipe: CharacterRecipe,
  catalog: CharacterSlotCatalog = CHARACTER_SLOT_CATALOG,
): { style: string; lines: readonly string[]; changedSlots: readonly CharacterSlotKind[] } {
  const index = indexOf(catalog);
  const resolve = (id: string | null | undefined) => (id ? index.byId.get(id) ?? null : null);
  const lines: string[] = [];
  const changedSlots: CharacterSlotKind[] = [];
  for (const slot of CHARACTER_SLOT_KINDS) {
    const ids = selectedIds(recipe, slot);
    const labels = ids.map((id) => resolve(id)?.label ?? id);
    if (labels.length > 0) lines.push(`${characterSlotMeta(slot).label}: ${labels.join(", ")}`);
    if (!isNeutralSelection(slot, ids)) changedSlots.push(slot);
  }
  const styleParts = [
    styleWord(resolve(recipe.slots.body), "원본 비율"),
    styleWord(resolve(recipe.slots.hair), "원본 헤어"),
    styleWord(resolve(recipe.slots.top), "원본 의상"),
  ].filter((part): part is string => Boolean(part));
  return {
    style: styleParts.length > 0 ? styleParts.join(" · ") : "선택 없음",
    lines: Object.freeze(lines),
    changedSlots: Object.freeze(changedSlots),
  };
}

function sameSelection(a: string | readonly string[] | null, b: string | readonly string[] | null): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? [...a].sort() : [];
    const right = Array.isArray(b) ? [...b].sort() : [];
    return left.length === right.length && left.every((id, position) => id === right[position]);
  }
  return a === b;
}

/** Slots whose selection differs between two recipes, in rail order. */
export function diffCharacterRecipes(a: CharacterRecipe, b: CharacterRecipe): readonly CharacterSlotKind[] {
  return CHARACTER_SLOT_KINDS.filter((slot) => !sameSelection(a.slots[slot], b.slots[slot]));
}

/* -------------------------------------------------------------------------- */
/* Serialisation (copy / paste)                                                */
/* -------------------------------------------------------------------------- */

export function serializeCharacterRecipe(recipe: CharacterRecipe): string {
  return JSON.stringify({
    version: 1,
    slots: recipe.slots,
    colors: recipe.colors,
    handSide: recipe.handSide,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a serialised recipe (string or object). Unknown or mismatched entry ids become `null`
 * (dropped for the accessory list), invalid colours become `null`, and garbage yields the empty
 * recipe — this never throws.
 */
export function parseCharacterRecipe(raw: unknown, catalog: CharacterSlotCatalog = CHARACTER_SLOT_CATALOG): CharacterRecipe {
  let source: unknown = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return createEmptyCharacterRecipe();
    }
  }
  if (!isRecord(source)) return createEmptyCharacterRecipe();
  const index = indexOf(catalog);
  const rawSlots = isRecord(source.slots) ? source.slots : {};
  const rawColors = isRecord(source.colors) ? source.colors : {};
  const empty = createEmptyCharacterRecipe();
  const slots = { ...empty.slots } as { -readonly [K in keyof CharacterRecipeSlots]: CharacterRecipeSlots[K] };

  const validId = (slot: CharacterSlotKind, value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const item = index.byId.get(value);
    return item && item.slot === slot ? item.id : null;
  };

  for (const slot of CHARACTER_SLOT_KINDS) {
    const value = rawSlots[slot];
    if (characterSlotMeta(slot).multi) {
      const ids = Array.isArray(value)
        ? value.map((candidate) => validId(slot, candidate)).filter((id): id is string => id !== null)
        : [];
      (slots as Record<string, unknown>)[slot] = [...new Set(ids)];
    } else {
      (slots as Record<string, unknown>)[slot] = validId(slot, value);
    }
  }

  const colors = { ...empty.colors } as { -readonly [K in keyof CharacterRecipeColors]: CharacterRecipeColors[K] };
  for (const key of Object.keys(colors) as (keyof CharacterRecipeColors)[]) {
    colors[key] = normalizeColor(typeof rawColors[key] === "string" ? (rawColors[key] as string) : null);
  }

  const handSide = HAND_SIDES.includes(source.handSide as CharacterHandSide)
    ? (source.handSide as CharacterHandSide)
    : "both";

  return { version: 1, slots, colors, handSide };
}
