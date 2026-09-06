/**
 * Character Shaper — renderer-neutral contract.
 *
 * The Character Shaper is ToonStudio's preset-first 3D webtoon character workshop. It sits on top
 * of the existing VRM runtime (`useStudioVrmPoserController`) and never owns a second scene
 * document: every slot selection is *derived* from host state (Avatar Forge, wardrobe, costume,
 * props, pose, expression, colors) and every commit is a small set of host calls. That keeps
 * undo, persistence, capture, and export on the one existing authority.
 *
 * Product rules (see docs/studio/character-shaper-design-brief-2026-09-04.md):
 *  - Every card predicts the actual runtime result; emoji are never the primary preview.
 *  - Switching a slot preserves every other slot and creates one undoable step.
 *  - Unsupported entries explain why they are unavailable and are never silently substituted.
 *  - A saved scene reopens with identical slot ids, colors, pose, paint atlas, and PSD mapping.
 */

import type {
  AvatarForgeBangStyle,
  AvatarForgeBodyPresetId,
  AvatarForgeFaceParams,
  AvatarForgeHairParams,
  AvatarForgeHairStyle,
  AvatarForgeSemanticFaceMorphId,
} from "../vrm/studio-vrm-avatar-forge";
import type { CostumeSlot } from "../vrm/studio-vrm-costume";
import type { StudioVrmSemanticFaceMorphProvider } from "../vrm/studio-vrm-semantic-face-morph";
import type { WardrobeSlot } from "../vrm/studio-vrm-wardrobe";

/* -------------------------------------------------------------------------- */
/* Slot kinds                                                                  */
/* -------------------------------------------------------------------------- */

/** The fifteen combinable slots. SHAPER's fourteen plus `expression`, which VRM owns natively. */
export const CHARACTER_SLOT_KINDS = [
  "face-shape",
  "eyes",
  "irises",
  "nose",
  "mouth",
  "ears",
  "hair",
  "body",
  "top",
  "bottom",
  "shoes",
  "accessory",
  "expression",
  "pose",
  "hand-pose",
] as const;

export type CharacterSlotKind = (typeof CHARACTER_SLOT_KINDS)[number];

/** Slots that hold a set of entries instead of exactly one. */
export const CHARACTER_MULTI_SLOT_KINDS = ["accessory"] as const satisfies readonly CharacterSlotKind[];

export type CharacterMultiSlotKind = (typeof CHARACTER_MULTI_SLOT_KINDS)[number];
export type CharacterSingleSlotKind = Exclude<CharacterSlotKind, CharacterMultiSlotKind>;

export interface CharacterSlotMeta {
  readonly id: CharacterSlotKind;
  /** Korean product label, e.g. "얼굴형". */
  readonly label: string;
  /** English label for the palette/search index. */
  readonly labelEn: string;
  /** One-line intent shown in the rail tooltip and the shelf header. */
  readonly hint: string;
  /** Rail grouping: identity (face/head), figure (body/clothing), performance (expression/pose). */
  readonly group: "identity" | "figure" | "performance";
  /** lucide-react icon name, resolved by the UI layer. */
  readonly icon: string;
  readonly multi: boolean;
}

/* -------------------------------------------------------------------------- */
/* Preview specs — deterministic, theme-token SVG previews                    */
/* -------------------------------------------------------------------------- */

export type CharacterEyeLidStyle = "round" | "cat" | "droopy" | "sharp" | "half-moon";
export type CharacterIrisHighlight = "basic" | "star" | "soft" | "none";
export type CharacterPupilStyle = "round" | "vertical";
export type CharacterNoseGlyph = "dot" | "line" | "bridge" | "button";
export type CharacterEarGlyph = "human" | "elf" | "animal";
export type CharacterGarmentGlyph =
  | "tshirt"
  | "shirt"
  | "sweater"
  | "sailor"
  | "tank"
  | "dress"
  | "scrubs"
  | "blazer"
  | "hoodie"
  | "coat"
  | "cardigan"
  | "armor"
  | "robe"
  | "labcoat"
  | "pleated"
  | "longskirt"
  | "shorts"
  | "pants"
  | "wide"
  | "jeans"
  | "scrubpants"
  | "sneakers"
  | "boots"
  | "longboots"
  | "heels"
  | "loafers"
  | "sandals"
  | "clogs"
  | "original";

/** 2D stick figure used for pose cards: normalized joint positions in a 0..1 box (y down). */
export interface CharacterPoseGlyphFigure {
  readonly head: readonly [number, number];
  readonly neck: readonly [number, number];
  readonly hips: readonly [number, number];
  readonly leftHand: readonly [number, number];
  readonly rightHand: readonly [number, number];
  readonly leftElbow: readonly [number, number];
  readonly rightElbow: readonly [number, number];
  readonly leftKnee: readonly [number, number];
  readonly rightKnee: readonly [number, number];
  readonly leftFoot: readonly [number, number];
  readonly rightFoot: readonly [number, number];
}

export type CharacterHandPoseType =
  | "fist"
  | "open"
  | "point"
  | "peace"
  | "thumbsUp"
  | "holding"
  | "phoneGrip"
  | "penGrip"
  | "fingerHeart"
  | "cupGrip"
  | "rockRoll"
  | "okSign"
  | "relaxed";

export type CharacterSlotPreviewSpec =
  | { readonly kind: "face-shape"; readonly face: AvatarForgeFaceParams }
  | {
      readonly kind: "eyes";
      /** -1..1 relative deltas mirroring the semantic morph bundle. */
      readonly size: number;
      readonly spacing: number;
      readonly tilt: number;
      readonly lid: CharacterEyeLidStyle;
    }
  | {
      readonly kind: "irises";
      readonly irisSize: number;
      readonly color: string;
      readonly highlight: CharacterIrisHighlight;
      readonly pupil: CharacterPupilStyle;
    }
  | { readonly kind: "nose"; readonly height: number; readonly width: number; readonly glyph: CharacterNoseGlyph }
  | {
      readonly kind: "mouth";
      readonly width: number;
      readonly fullness: number;
      /** 0..1 openness (viseme weight) and 0..1 smile (happy weight). */
      readonly open: number;
      readonly smile: number;
    }
  | { readonly kind: "ears"; readonly size: number; readonly glyph: CharacterEarGlyph }
  | {
      readonly kind: "hair";
      readonly style: AvatarForgeHairStyle;
      readonly bangStyle: AvatarForgeBangStyle;
      readonly baseColor: string;
      readonly tipColor: string;
      readonly length: number;
      readonly volume: number;
    }
  | { readonly kind: "hair-original" }
  | {
      readonly kind: "body";
      readonly headUnits: number;
      readonly shoulderWidth: number;
      readonly legLength: number;
      readonly torsoLength: number;
    }
  | {
      readonly kind: "garment";
      readonly slot: WardrobeSlot | "original";
      readonly glyph: CharacterGarmentGlyph;
      readonly color: string;
    }
  | { readonly kind: "prop"; readonly propId: string; readonly category: "hand" | "head" | "body"; readonly color: string }
  | { readonly kind: "expression"; readonly emoji: string; readonly weights: Readonly<Record<string, number>> }
  /** The renderer resolves `presetId` through `buildCharacterPoseGlyph` so the catalog stays data-only. */
  | { readonly kind: "pose"; readonly presetId: string; readonly tone: string }
  | { readonly kind: "hand-pose"; readonly poseType: CharacterHandPoseType }
  | { readonly kind: "glyph"; readonly icon: string; readonly caption: string };

/* -------------------------------------------------------------------------- */
/* Apply refs — how an entry reaches the runtime                              */
/* -------------------------------------------------------------------------- */

export type CharacterSemanticMorphBundle = Partial<Record<AvatarForgeSemanticFaceMorphId, number>>;

/** Which side(s) a hand pose targets. */
export type CharacterHandSide = "left" | "right" | "both";

export type CharacterSlotApplyRef =
  /** Merge into `avatarForgeState.face` (rig-preserving whole-head recipe). */
  | { readonly kind: "forge-face"; readonly face: Partial<AvatarForgeFaceParams> }
  /** Model-native shape keys or the adaptive mesh deformer, via `setAvatarForgeSemanticFaceMorph`. */
  | { readonly kind: "semantic-morph"; readonly morphs: CharacterSemanticMorphBundle }
  /** Iris size morph plus an optional texture-preserving iris tint. `color: null` restores the model tint. */
  | { readonly kind: "iris"; readonly irisSize: number; readonly color: string | null }
  /**
   * Mouth shapes combine a rest-shape morph bundle with a subtle VRM expression floor so the card
   * predicts a visible change even on models without mouth shape keys.
   */
  | {
      readonly kind: "mouth";
      readonly morphs: CharacterSemanticMorphBundle;
      readonly expressionFloor: Readonly<Record<string, number>>;
    }
  /** Ear size morph; optional accessory prop for non-human ears. */
  | { readonly kind: "ears"; readonly morphs: CharacterSemanticMorphBundle; readonly propId: string | null }
  /** Procedural toon hair through the Avatar Forge (style, bangs, palette, length, volume, …). */
  | { readonly kind: "forge-hair"; readonly hair: Partial<AvatarForgeHairParams> }
  /** Keep the model's authored hair and switch procedural hair off. */
  | { readonly kind: "hair-original" }
  /** Head-unit proportion preset id from `STUDIO_VRM_PROPORTION_PRESETS`. */
  | { readonly kind: "proportion"; readonly presetId: string; readonly bodyPresetId?: AvatarForgeBodyPresetId }
  /** One wardrobe garment (`null` item = remove the procedural garment for that slot). */
  | { readonly kind: "wardrobe"; readonly slot: WardrobeSlot; readonly itemId: string | null; readonly color?: string }
  /** A curated wardrobe set (multi-slot). */
  | { readonly kind: "wardrobe-set"; readonly setId: string }
  /** Keep the model's own clothing for the given costume slots and clear the procedural garment. */
  | { readonly kind: "costume-original"; readonly wardrobeSlot: WardrobeSlot; readonly costumeSlots: readonly CostumeSlot[] }
  /** Attach a prop from `VRM_PROPS`. */
  | { readonly kind: "prop"; readonly propId: string; readonly color?: string }
  /** A `StudioExpressionPreset` id from `EXPRESSION_PRESETS`. */
  | { readonly kind: "expression"; readonly presetId: string }
  /** A full-body pose preset id accepted by `handlePoseSelect`. */
  | { readonly kind: "pose"; readonly presetId: string }
  /** A hand shape applied through `applyHandPosePreset`. Side is chosen by the user at commit time. */
  | { readonly kind: "hand-pose"; readonly poseType: CharacterHandPoseType }
  /** Declarative "none / keep original" entry that clears the slot. */
  | { readonly kind: "none" };

/* -------------------------------------------------------------------------- */
/* Capability requirements and availability                                    */
/* -------------------------------------------------------------------------- */

export type CharacterCapabilityRequirement =
  | { readonly kind: "model-loaded" }
  | { readonly kind: "semantic-morph"; readonly ids: readonly AvatarForgeSemanticFaceMorphId[] }
  | { readonly kind: "iris-tint" }
  | { readonly kind: "expression"; readonly names: readonly string[] }
  | { readonly kind: "wardrobe-metrics" }
  | { readonly kind: "costume-slot"; readonly slots: readonly CostumeSlot[] }
  | { readonly kind: "props" }
  | { readonly kind: "humanoid" }
  | { readonly kind: "hair-original" };

export type CharacterSlotAvailabilityStatus = "available" | "partial" | "unavailable";

export interface CharacterSlotAvailability {
  readonly status: CharacterSlotAvailabilityStatus;
  /** Plain-language reason shown on the card when not fully available. */
  readonly reason: string | null;
  /** Morph ids (or expression names) the current model cannot honour. */
  readonly missing: readonly string[];
}

export interface CharacterCapabilityProfile {
  readonly status: "empty" | "loading" | "ready" | "error";
  readonly modelId: string | null;
  readonly modelName: string;
  readonly humanoid: boolean;
  readonly semanticMorphs: Readonly<Record<AvatarForgeSemanticFaceMorphId, StudioVrmSemanticFaceMorphProvider | null>>;
  /** VRM expression names present on the model (e.g. happy, aa, blink). */
  readonly expressions: readonly string[];
  /** Costume slots detected on the authored model meshes. */
  readonly costumeSlots: readonly CostumeSlot[];
  readonly wardrobeMetricsReady: boolean;
  readonly propsReady: boolean;
  readonly irisTintable: boolean;
  readonly originalHairMeshCount: number;
  readonly surfacePaintReady: boolean;
}

/* -------------------------------------------------------------------------- */
/* Catalog entries                                                             */
/* -------------------------------------------------------------------------- */

export type CharacterGenreTag = "romance" | "school" | "action" | "fantasy" | "modern" | "comedy" | "noir" | "medical" | "daily";

export interface CharacterSlotEntry {
  /** Stable id, namespaced by slot: `"eyes:romance-sparkle"`, `"top:shirt"`, `"pose:xp_run"`. */
  readonly id: string;
  readonly slot: CharacterSlotKind;
  readonly label: string;
  readonly labelEn?: string;
  /** One-line intent, ≤ 40 Korean characters. */
  readonly hint: string;
  readonly tags: readonly CharacterGenreTag[];
  readonly keywords: readonly string[];
  readonly preview: CharacterSlotPreviewSpec;
  readonly apply: CharacterSlotApplyRef;
  readonly requires: readonly CharacterCapabilityRequirement[];
  /** Semantic PSD layer this entry contributes to. */
  readonly exportLayer: CharacterPsdSemanticLayer;
  /** Rights authority. Bundled catalog entries are ToonStudio originals; imported assets carry their own. */
  readonly license: "toonstudio-original" | "model-native" | "user-import";
  /** Curated ordering inside the shelf; lower first. */
  readonly order: number;
  /** Featured entries appear in the "추천" strip of the shelf. */
  readonly featured?: boolean;
}

export type CharacterPsdSemanticLayer =
  | "face"
  | "eyes"
  | "hair-front"
  | "hair-back"
  | "skin"
  | "top"
  | "bottom"
  | "shoes"
  | "accessory"
  | "pose"
  | "none";

export interface CharacterSlotCatalog {
  readonly version: 1;
  readonly slots: readonly CharacterSlotMeta[];
  readonly entries: readonly CharacterSlotEntry[];
}

/* -------------------------------------------------------------------------- */
/* Recipe — derived selection layer over host state                           */
/* -------------------------------------------------------------------------- */

export type CharacterRecipeSlots = {
  readonly [K in CharacterSlotKind]: K extends CharacterMultiSlotKind ? readonly string[] : string | null;
};

export interface CharacterRecipeColors {
  readonly skin: string | null;
  readonly hairBase: string | null;
  readonly hairTip: string | null;
  readonly iris: string | null;
  readonly top: string | null;
  readonly bottom: string | null;
  readonly shoes: string | null;
}

export interface CharacterRecipe {
  readonly version: 1;
  /** Selected catalog entry ids; `null` means "custom / not from the catalog". */
  readonly slots: CharacterRecipeSlots;
  readonly colors: CharacterRecipeColors;
  readonly handSide: CharacterHandSide;
}

/** Snapshot of the host state the recipe is derived from; produced by the binding, consumed by pure code. */
export interface CharacterHostSnapshot {
  readonly forgeFace: AvatarForgeFaceParams;
  readonly semanticMorphs: CharacterSemanticMorphBundle;
  readonly hairStyle: AvatarForgeHairStyle;
  readonly hairBangStyle: AvatarForgeBangStyle;
  readonly hairReplaceOriginal: boolean;
  readonly hairBaseColor: string;
  readonly hairTipColor: string;
  readonly proportionPresetId: string | null;
  readonly bodyPresetId: AvatarForgeBodyPresetId;
  readonly wardrobe: Readonly<Partial<Record<WardrobeSlot, { readonly itemId: string; readonly color: string }>>>;
  readonly propIds: readonly string[];
  readonly activePoseId: string | null;
  readonly activeExpressionId: string | null;
  readonly expressionWeights: Readonly<Record<string, number>>;
  readonly customColors: Readonly<Record<string, string>>;
  readonly irisColor: string | null;
  readonly handSide: CharacterHandSide;
  readonly lastHandPoseType: CharacterHandPoseType | null;
}

/* -------------------------------------------------------------------------- */
/* Apply plan — pure description of the host calls one commit performs        */
/* -------------------------------------------------------------------------- */

export type CharacterApplyStep =
  | { readonly kind: "forge-face"; readonly face: Partial<AvatarForgeFaceParams> }
  | { readonly kind: "semantic-morph"; readonly morphs: CharacterSemanticMorphBundle }
  | { readonly kind: "iris-color"; readonly color: string | null }
  | { readonly kind: "expression-floor"; readonly weights: Readonly<Record<string, number>> }
  | { readonly kind: "forge-hair"; readonly hair: Partial<AvatarForgeHairParams> }
  | { readonly kind: "proportion"; readonly presetId: string; readonly bodyPresetId?: AvatarForgeBodyPresetId }
  | { readonly kind: "wardrobe-equip"; readonly slot: WardrobeSlot; readonly itemId: string | null; readonly color?: string }
  | { readonly kind: "wardrobe-set"; readonly setId: string }
  | { readonly kind: "costume-visibility"; readonly slots: readonly CostumeSlot[]; readonly visible: boolean }
  | { readonly kind: "prop-add"; readonly propId: string; readonly color?: string }
  | { readonly kind: "prop-remove"; readonly propId: string }
  | { readonly kind: "expression-preset"; readonly presetId: string }
  | { readonly kind: "pose-preset"; readonly presetId: string }
  | { readonly kind: "hand-pose"; readonly poseType: CharacterHandPoseType; readonly side: CharacterHandSide };

export interface CharacterApplyPlan {
  readonly entryId: string;
  readonly slot: CharacterSlotKind;
  /** Human label for the undo entry, e.g. "눈: 순정 반짝눈". */
  readonly label: string;
  readonly steps: readonly CharacterApplyStep[];
  /** Availability at planning time; `unavailable` plans carry zero steps. */
  readonly availability: CharacterSlotAvailability;
}

/* -------------------------------------------------------------------------- */
/* Export contract                                                             */
/* -------------------------------------------------------------------------- */

export type CharacterSemanticPassId =
  | "beauty"
  | "flat"
  | "shadow"
  | "highlight"
  | "line"
  | "surface-paint"
  | "mask-face"
  | "mask-eyes"
  | "mask-hair"
  | "mask-skin"
  | "mask-top"
  | "mask-bottom"
  | "mask-shoes"
  | "mask-accessory";

export interface CharacterSemanticPass {
  readonly id: CharacterSemanticPassId;
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA8, row-major, top-left origin. */
  readonly rgba: Uint8ClampedArray;
}

export interface CharacterPsdExportReceipt {
  readonly width: number;
  readonly height: number;
  readonly layerNames: readonly string[];
  /** Passes that were not produced and why (never fabricated). */
  readonly skipped: readonly { readonly pass: CharacterSemanticPassId; readonly reason: string }[];
  readonly byteLength: number;
}
