import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { EXPRESSION_PRESETS, EXTRA_POSE_PRESETS, NATURAL_IDLE_POSES } from "../studio-pose-presets";
import { HAND_SHAPE_PRESETS } from "../vrm/studio-vrm-poser-catalogs";
import { STUDIO_VRM_PROPORTION_PRESETS } from "../vrm/studio-vrm-proportion-core";
import { buildPropObject, propDefById, VRM_PROPS } from "../vrm/studio-vrm-props";
import { WARDROBE_ITEMS } from "../vrm/studio-vrm-wardrobe";

import { EMPTY_CHARACTER_CAPABILITY_PROFILE, evaluateCharacterSlotEntry } from "./character-shaper-capability";
import {
  CHARACTER_GENRE_TAG_LABELS,
  CHARACTER_HAIR_PALETTES,
  CHARACTER_NEUTRAL_SLOT_ENTRY_IDS,
  CHARACTER_POSE_GROUPS,
  CHARACTER_SLOT_CATALOG,
  CHARACTER_SLOT_METAS,
  findCharacterSlotEntry,
  listCharacterSlotEntries,
  searchCharacterSlotEntries,
} from "./character-shaper-catalog";
import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";

import type { CharacterCapabilityProfile, CharacterSlotEntry, CharacterSlotKind } from "./character-shaper-contract";
import type { ThreeLike } from "../vrm/studio-vrm-props";

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

const SLOT_MINIMUMS: Readonly<Record<CharacterSlotKind, number>> = {
  "face-shape": 7,
  eyes: 8,
  irises: 10,
  nose: 6,
  mouth: 7,
  ears: 5,
  hair: 15,
  body: 6,
  top: 14,
  bottom: 8,
  shoes: 8,
  accessory: 30,
  expression: EXPRESSION_PRESETS.length,
  pose: NATURAL_IDLE_POSES.length + EXTRA_POSE_PRESETS.length,
  "hand-pose": 13,
};

const HANGUL = /[가-힣]/u;
const LATIN = /[a-z]/iu;

function expectPreviewMatchesApply(item: CharacterSlotEntry) {
  const { preview, apply } = item;
  switch (item.slot) {
    case "face-shape":
      expect(preview.kind).toBe("face-shape");
      expect(apply.kind).toBe("forge-face");
      if (preview.kind === "face-shape" && apply.kind === "forge-face") expect(preview.face).toEqual(apply.face);
      break;
    case "eyes":
      expect(preview.kind).toBe("eyes");
      expect(apply.kind).toBe("semantic-morph");
      if (preview.kind === "eyes" && apply.kind === "semantic-morph") {
        expect(preview.size).toBe(apply.morphs.eyeSize);
        expect(preview.spacing).toBe(apply.morphs.eyeSpacing);
        expect(preview.tilt).toBe(apply.morphs.eyeTilt);
      }
      break;
    case "irises":
      expect(preview.kind).toBe("irises");
      expect(apply.kind).toBe("iris");
      if (preview.kind === "irises" && apply.kind === "iris") {
        expect(preview.irisSize).toBe(apply.irisSize);
        if (apply.color) expect(preview.color).toBe(apply.color);
      }
      break;
    case "nose":
      expect(preview.kind).toBe("nose");
      expect(apply.kind).toBe("semantic-morph");
      if (preview.kind === "nose" && apply.kind === "semantic-morph") {
        expect(preview.height).toBe(apply.morphs.noseHeight);
        expect(preview.width).toBe(apply.morphs.noseWidth);
      }
      break;
    case "mouth":
      expect(preview.kind).toBe("mouth");
      expect(apply.kind).toBe("mouth");
      if (preview.kind === "mouth" && apply.kind === "mouth") {
        expect(preview.width).toBe(apply.morphs.mouthWidth);
        expect(preview.fullness).toBe(apply.morphs.lipFullness);
        expect(preview.smile).toBe(apply.expressionFloor.happy ?? 0);
      }
      break;
    case "ears":
      expect(preview.kind).toBe("ears");
      expect(apply.kind).toBe("ears");
      if (preview.kind === "ears" && apply.kind === "ears") {
        expect(preview.size).toBe(apply.morphs.earSize);
        expect(preview.glyph === "elf").toBe(apply.propId === "elfEars");
        expect(preview.glyph === "animal").toBe(apply.propId === "catEars");
      }
      break;
    case "hair":
      if (apply.kind === "hair-original") {
        expect(preview.kind).toBe("hair-original");
      } else {
        expect(apply.kind).toBe("forge-hair");
        expect(preview.kind).toBe("hair");
        if (preview.kind === "hair" && apply.kind === "forge-hair") {
          expect(preview.style).toBe(apply.hair.style);
          expect(apply.hair.replaceOriginal).toBe(true);
        }
      }
      break;
    case "body":
      expect(preview.kind).toBe("body");
      expect(apply.kind).toBe("proportion");
      if (preview.kind === "body" && apply.kind === "proportion") {
        const preset = STUDIO_VRM_PROPORTION_PRESETS.find((candidate) => candidate.id === apply.presetId);
        expect(preset).toBeDefined();
        expect(preview.headUnits).toBe(preset?.targetHeadUnits);
      }
      break;
    case "top":
    case "bottom":
    case "shoes":
      expect(preview.kind).toBe("garment");
      if (preview.kind === "garment") {
        if (apply.kind === "wardrobe") {
          expect(preview.glyph).toBe(apply.itemId);
          expect(preview.slot).toBe(apply.slot);
          expect(apply.color).toBe(preview.color);
        } else {
          expect(apply.kind).toBe("costume-original");
          expect(preview.glyph).toBe("original");
        }
      }
      break;
    case "accessory":
      expect(preview.kind).toBe("prop");
      expect(apply.kind).toBe("prop");
      if (preview.kind === "prop" && apply.kind === "prop") expect(preview.propId).toBe(apply.propId);
      break;
    case "expression":
      expect(preview.kind).toBe("expression");
      expect(apply.kind).toBe("expression");
      if (preview.kind === "expression" && apply.kind === "expression") {
        const preset = EXPRESSION_PRESETS.find((candidate) => candidate.id === apply.presetId);
        expect(preview.weights).toEqual(preset?.weights);
      }
      break;
    case "pose":
      expect(preview.kind).toBe("pose");
      expect(apply.kind).toBe("pose");
      if (preview.kind === "pose" && apply.kind === "pose") {
        expect(preview.presetId).toBe(apply.presetId);
        const preset = [...NATURAL_IDLE_POSES, ...EXTRA_POSE_PRESETS].find((candidate) => candidate.id === apply.presetId);
        expect(preview.tone).toBe(preset?.tone);
      }
      break;
    case "hand-pose":
      expect(preview.kind).toBe("hand-pose");
      expect(apply.kind).toBe("hand-pose");
      if (preview.kind === "hand-pose" && apply.kind === "hand-pose") expect(preview.poseType).toBe(apply.poseType);
      break;
    default:
      throw new Error(`unexpected slot ${String(item.slot)}`);
  }
}

describe("character shaper catalog — slots", () => {
  it("exposes the fifteen slots in rail order with complete metadata", () => {
    expect(CHARACTER_SLOT_METAS.map((meta) => meta.id)).toEqual([...CHARACTER_SLOT_KINDS]);
    for (const meta of CHARACTER_SLOT_METAS) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.labelEn.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
      expect(meta.icon).toMatch(/^[A-Z][A-Za-z0-9]+$/u);
      expect(meta.multi).toBe(meta.id === "accessory");
    }
    expect(CHARACTER_SLOT_CATALOG.version).toBe(1);
    expect(CHARACTER_SLOT_CATALOG.slots).toBe(CHARACTER_SLOT_METAS);
  });

  it("labels every genre tag in Korean", () => {
    const used = new Set(CHARACTER_SLOT_CATALOG.entries.flatMap((item) => item.tags));
    for (const tag of used) expect(CHARACTER_GENRE_TAG_LABELS[tag]).toMatch(HANGUL);
    expect(Object.keys(CHARACTER_GENRE_TAG_LABELS)).toHaveLength(9);
  });
});

describe("character shaper catalog — entries", () => {
  it("has unique, slot-namespaced ids grouped in rail order", () => {
    const ids = CHARACTER_SLOT_CATALOG.entries.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of CHARACTER_SLOT_CATALOG.entries) {
      expect(item.id.startsWith(`${item.slot}:`)).toBe(true);
      expect(item.id.slice(item.slot.length + 1).length).toBeGreaterThan(0);
    }
    const slotSequence = CHARACTER_SLOT_CATALOG.entries.map((item) => item.slot);
    const firstIndex = new Map<CharacterSlotKind, number>();
    slotSequence.forEach((slot, position) => {
      if (!firstIndex.has(slot)) firstIndex.set(slot, position);
    });
    const orderedSlots = [...firstIndex.entries()].sort((a, b) => a[1] - b[1]).map(([slot]) => slot);
    expect(orderedSlots).toEqual([...CHARACTER_SLOT_KINDS]);
  });

  it("meets the minimum entry count per slot and keeps a stable order", () => {
    for (const slot of CHARACTER_SLOT_KINDS) {
      const entries = listCharacterSlotEntries(slot);
      expect(entries.length, slot).toBeGreaterThanOrEqual(SLOT_MINIMUMS[slot]);
      const orders = entries.map((item) => item.order);
      expect([...orders].sort((a, b) => a - b), slot).toEqual(orders);
      expect(new Set(orders).size, slot).toBe(orders.length);
    }
  });

  it("gives every entry an honest hint, Korean + English keywords, tags, requirements and license", () => {
    for (const item of CHARACTER_SLOT_CATALOG.entries) {
      expect(item.hint.length, item.id).toBeGreaterThan(0);
      expect(item.hint.length, item.id).toBeLessThanOrEqual(40);
      expect(item.label, item.id).toMatch(HANGUL);
      expect(item.keywords.length, item.id).toBeGreaterThan(0);
      expect(item.keywords.some((keyword) => LATIN.test(keyword)), `${item.id} english keyword`).toBe(true);
      expect(item.tags.length, item.id).toBeGreaterThan(0);
      expect(item.requires.length, item.id).toBeGreaterThan(0);
      expect(["toonstudio-original", "model-native", "user-import"]).toContain(item.license);
      expect(Object.isFrozen(item), item.id).toBe(true);
    }
  });

  it("derives every preview from the same numbers as the apply ref", () => {
    for (const item of CHARACTER_SLOT_CATALOG.entries) expectPreviewMatchesApply(item);
  });

  it("features four to eight entries per slot", () => {
    for (const slot of CHARACTER_SLOT_KINDS) {
      const featured = listCharacterSlotEntries(slot).filter((item) => item.featured);
      expect(featured.length, slot).toBeGreaterThanOrEqual(4);
      expect(featured.length, slot).toBeLessThanOrEqual(8);
    }
  });

  it("is unavailable with a reason on the empty profile and available on a full profile", () => {
    for (const item of CHARACTER_SLOT_CATALOG.entries) {
      const empty = evaluateCharacterSlotEntry(item, EMPTY_CHARACTER_CAPABILITY_PROFILE);
      expect(empty.status, item.id).toBe("unavailable");
      expect(empty.reason, item.id).toMatch(HANGUL);
      const full = evaluateCharacterSlotEntry(item, FULL_PROFILE);
      expect(full.status, item.id).toBe("available");
      expect(full.reason, item.id).toBeNull();
      expect(full.missing, item.id).toEqual([]);
    }
  });

  it("resolves every neutral entry id to an entry of the same slot", () => {
    for (const slot of CHARACTER_SLOT_KINDS) {
      const id = CHARACTER_NEUTRAL_SLOT_ENTRY_IDS[slot];
      if (!id) continue;
      const item = findCharacterSlotEntry(id);
      expect(item?.slot, slot).toBe(slot);
    }
    expect(findCharacterSlotEntry("eyes:does-not-exist")).toBeNull();
    expect(findCharacterSlotEntry("")).toBeNull();
  });
});

describe("character shaper catalog — runtime coverage", () => {
  it("mirrors the pose presets, grouped into contiguous order bands", () => {
    const poses = listCharacterSlotEntries("pose");
    const presetIds = [...NATURAL_IDLE_POSES, ...EXTRA_POSE_PRESETS].map((preset) => preset.id).sort();
    expect(poses.map((item) => item.id.slice("pose:".length)).sort()).toEqual(presetIds);
    const bands = CHARACTER_POSE_GROUPS.map((group) => group.orderBase);
    let lastBand = -1;
    for (const item of poses) {
      const band = [...bands].reverse().find((base) => item.order >= base) ?? -1;
      expect(band, item.id).toBeGreaterThanOrEqual(lastBand);
      lastBand = band;
    }
    for (const group of CHARACTER_POSE_GROUPS) {
      expect(poses.some((item) => item.order >= group.orderBase && item.order < group.orderBase + 100), group.id).toBe(true);
    }
    expect(findCharacterSlotEntry("pose:xp_run")?.tags).toContain("action");
    expect(findCharacterSlotEntry("pose:xp_chair_sit")?.keywords).toContain("앉기/눕기");
  });

  it("mirrors every expression preset and every hand shape", () => {
    expect(listCharacterSlotEntries("expression").map((item) => item.id)).toEqual(
      EXPRESSION_PRESETS.map((preset) => `expression:${preset.id}`),
    );
    expect(listCharacterSlotEntries("hand-pose").map((item) => item.id.slice("hand-pose:".length)).sort()).toEqual(
      HAND_SHAPE_PRESETS.map((preset) => preset.id).sort(),
    );
  });

  it("mirrors every proportion preset as a body entry sorted by head units", () => {
    const bodies = listCharacterSlotEntries("body");
    expect(bodies).toHaveLength(STUDIO_VRM_PROPORTION_PRESETS.length);
    const units = bodies.map((item) => (item.preview.kind === "body" ? item.preview.headUnits : 0));
    expect([...units].sort((a, b) => b - a)).toEqual(units);
    expect(findCharacterSlotEntry("body:webtoon-7")?.label).toBe("7두신");
  });

  it("offers 원본 유지 plus every selectable wardrobe item for top / bottom / shoes", () => {
    const selectable = (slots: readonly string[]) => WARDROBE_ITEMS
      .filter((item) => slots.includes(item.slot) && item.catalogStatus === "selectable")
      .map((item) => item.id)
      .sort();
    const ids = (slot: CharacterSlotKind) => listCharacterSlotEntries(slot)
      .filter((item) => item.apply.kind === "wardrobe")
      .map((item) => item.id.slice(slot.length + 1))
      .sort();
    expect(ids("top")).toEqual(selectable(["top", "outer"]));
    expect(ids("bottom")).toEqual(selectable(["bottom"]));
    expect(ids("shoes")).toEqual(selectable(["shoes"]));
    for (const slot of ["top", "bottom", "shoes"] as const) {
      const original = listCharacterSlotEntries(slot)[0];
      expect(original?.apply.kind).toBe("costume-original");
      expect(original?.license).toBe("model-native");
      expect(original?.label).toBe("원본 유지");
    }
    expect(findCharacterSlotEntry("top:blazer")?.apply).toEqual({ kind: "wardrobe", slot: "outer", itemId: "blazer", color: "#2b3a5e" });
  });

  it("offers procedural head and body props as accessories, leaving ear props to the ears slot", () => {
    const accessories = listCharacterSlotEntries("accessory");
    const ids = accessories.map((item) => item.id.slice("accessory:".length));
    expect(ids).toEqual(expect.arrayContaining(["glasses", "cap", "backpack", "cape", "stethoscope"]));
    expect(ids).not.toContain("catEars");
    expect(ids).not.toContain("elfEars");
    expect(ids.some((id) => id.startsWith("blender_"))).toBe(false);
    for (const item of accessories) {
      const prop = VRM_PROPS.find((candidate) => candidate.id === item.id.slice("accessory:".length));
      expect(prop?.category === "head" || prop?.category === "body", item.id).toBe(true);
    }
    expect(findCharacterSlotEntry("ears:elf")?.apply).toEqual({ kind: "ears", morphs: { earSize: 0 }, propId: "elfEars" });
    expect(findCharacterSlotEntry("ears:animal")?.apply).toEqual({ kind: "ears", morphs: { earSize: 0 }, propId: "catEars" });
  });

  it("keeps 원본 유지 hair on the model's own meshes and offers every forge style once", () => {
    const hair = listCharacterSlotEntries("hair");
    expect(hair[0]?.id).toBe("hair:original");
    expect(hair[0]?.requires).toEqual([{ kind: "hair-original" }]);
    const styles = hair.flatMap((item) => (item.apply.kind === "forge-hair" ? [item.apply.hair.style] : []));
    expect(new Set(styles).size).toBe(styles.length);
    expect(styles).toContain("none");
    expect(styles).toHaveLength(14);
    expect(CHARACTER_HAIR_PALETTES).toHaveLength(6);
    for (const palette of CHARACTER_HAIR_PALETTES) {
      expect(palette.baseColor).toMatch(/^#[0-9a-f]{6}$/u);
      expect(palette.tipColor).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });

  it("ships the elfEars procedural prop next to catEars", () => {
    const elf = propDefById("elfEars");
    const cat = propDefById("catEars");
    expect(elf).toBeDefined();
    expect(elf?.category).toBe("head");
    expect(elf?.defaultBone).toBe("head");
    expect(elf?.defaultColor).toBe("#f5c6a0");
    expect(elf?.wearSocket).toBe("bone");
    expect(elf?.fit).toEqual(cat?.fit);
    expect(elf?.anchors).toEqual(cat?.anchors);
    expect(elf?.geometrySource).toEqual({ kind: "procedural" });
    const object = buildPropObject(THREE as unknown as ThreeLike, elf!, elf!.defaultColor) as unknown as THREE.Group;
    expect(object.name).toBe("prop:elfEars");
    expect(object.children).toHaveLength(4);
    const xs = object.children.map((child) => Math.sign(child.position.x));
    expect(xs.filter((sign) => sign < 0)).toHaveLength(2);
    expect(xs.filter((sign) => sign > 0)).toHaveLength(2);
    for (const child of object.children) {
      expect(child.rotation.z).not.toBe(0);
      expect(Math.sign(child.rotation.z)).toBe(-Math.sign(child.position.x));
    }
  });
});

describe("character shaper catalog — search", () => {
  it("matches label, hint, keywords and tags case-insensitively", () => {
    expect(searchCharacterSlotEntries("eyes", "고양이").map((item) => item.id)).toEqual(["eyes:cat"]);
    expect(searchCharacterSlotEntries("eyes", "CAT").map((item) => item.id)).toEqual(["eyes:cat"]);
    expect(searchCharacterSlotEntries("top", "교복").map((item) => item.id)).toEqual(
      expect.arrayContaining(["top:shirt", "top:sailor", "top:blazer"]),
    );
    expect(searchCharacterSlotEntries("pose", "달리기").map((item) => item.id)).toContain("pose:xp_run");
    expect(searchCharacterSlotEntries("hair", "없는스타일")).toEqual([]);
  });

  it("filters by genre tag and keeps the catalog order", () => {
    const all = listCharacterSlotEntries("hair");
    expect(searchCharacterSlotEntries("hair", "")).toEqual(all);
    const romance = searchCharacterSlotEntries("hair", "", "romance");
    expect(romance.length).toBeGreaterThan(0);
    expect(romance.every((item) => item.tags.includes("romance"))).toBe(true);
    const orderOf = (item: CharacterSlotEntry) => all.indexOf(item);
    expect(romance.map(orderOf)).toEqual([...romance.map(orderOf)].sort((a, b) => a - b));
    expect(searchCharacterSlotEntries("hair", "   ", null)).toEqual(all);
    expect(searchCharacterSlotEntries("hair", "보브 romance", "romance").map((item) => item.id)).toEqual(["hair:bob"]);
  });
});

describe("hair:none", () => {
  it("asks for a separable authored hair mesh, because hiding one is all it does", () => {
    const noHair = findCharacterSlotEntry("hair:none");
    expect(noHair).not.toBeNull();
    expect(noHair?.requires).toEqual([{ kind: "hair-original" }]);
  });

  it("still turns procedural hair off and asks the runtime to hide the model's hair", () => {
    const noHair = findCharacterSlotEntry("hair:none");
    expect(noHair?.apply).toMatchObject({
      kind: "forge-hair",
      hair: { style: "none", replaceOriginal: true },
    });
  });
});
