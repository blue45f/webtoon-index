import { sha256HexPortable } from "../studio-sha256";

import {
  inspectVrmPropsDocumentForProjection,
  propDefById,
  type PropHandBone,
  type PropInstance,
  type VrmPropsProjectionIssue,
  type VrmPropsProjectionSourceVersion,
} from "./studio-vrm-props";
import {
  VRM_WARDROBE_VERSION,
  WARDROBE_FIT_MAX,
  WARDROBE_FIT_MIN,
  WARDROBE_SLOTS,
  parseWardrobeDocument,
  wardrobeFabricById,
  wardrobeItemById,
  type ParsedWardrobeDocument,
  type WardrobeFabricId,
  type WardrobeFitMode,
  type WardrobeItemDef,
  type WardrobeSlot,
} from "./studio-vrm-wardrobe";

import type { StudioVrmSceneDocument } from "./studio-vrm-scene-document";

export const STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND =
  "studio-vrm-linked-appearance-projection-plan" as const;
export const STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION = 1 as const;
/** Per-character cap; a shared stage may already contain twelve independently animated VRMs. */
export const STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS = 8;

export type StudioVrmLinkedAppearanceProjectionFeature = "wardrobe" | "hand-props";

export type StudioVrmLinkedAppearanceProjectionUnsupportedReasonCode =
  | "unsupported-version"
  | "malformed-document"
  | "unknown-item"
  | "unknown-prop"
  | "unsupported-prop-category"
  | "unsupported-rig"
  | "resource-budget-exceeded"
  | "duplicate-identity"
  | "partial-document";

export interface StudioVrmLinkedAppearanceProjectionUnsupportedReason {
  readonly feature: StudioVrmLinkedAppearanceProjectionFeature;
  readonly code: StudioVrmLinkedAppearanceProjectionUnsupportedReasonCode;
  readonly path: string;
}

export interface StudioVrmLinkedAppearanceWardrobeSlot {
  readonly slot: WardrobeSlot;
  readonly itemId: string;
  readonly color: string;
  readonly fit: number;
  readonly fitMode: WardrobeFitMode;
  readonly fabricId: WardrobeFabricId;
  readonly geometrySource: WardrobeItemDef["geometrySource"];
  readonly quality: WardrobeItemDef["quality"];
}

export type StudioVrmLinkedAppearanceWardrobeProjection =
  | Readonly<{ readonly status: "empty" }>
  | Readonly<{
      readonly status: "supported";
      readonly sourceVersion: "legacy" | 1 | 2;
      readonly autoHideOriginal: boolean;
      readonly slots: readonly StudioVrmLinkedAppearanceWardrobeSlot[];
    }>
  | Readonly<{
      readonly status: "unsupported";
      readonly reasons: readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[];
    }>;

export interface StudioVrmLinkedAppearanceSecondaryHandProjection {
  readonly bone: PropHandBone;
  readonly anchorId: string;
  readonly influence: number;
}

export interface StudioVrmLinkedAppearanceHandPropProjection {
  readonly uid: string;
  readonly propId: string;
  readonly bone: PropHandBone;
  readonly attachmentMode: "legacy-transform" | "smart-rig-v2";
  readonly primaryAnchorId: string | null;
  readonly autoScale: boolean;
  readonly autoGripHand: PropHandBone | null;
  readonly gripFit: number | null;
  readonly secondaryHand: StudioVrmLinkedAppearanceSecondaryHandProjection | null;
  /** Strictly inspected, detached and deeply frozen input for the shared runtime. */
  readonly instance: PropInstance;
}

export type StudioVrmLinkedAppearanceHandPropsProjection =
  | Readonly<{ readonly status: "empty" }>
  | Readonly<{
      readonly status: "supported";
      readonly sourceVersion: Exclude<VrmPropsProjectionSourceVersion, "absent" | "unknown">;
      readonly props: readonly StudioVrmLinkedAppearanceHandPropProjection[];
    }>
  | Readonly<{
      readonly status: "unsupported";
      readonly reasons: readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[];
    }>;

export interface StudioVrmLinkedAppearanceProjectionPlan {
  readonly kind: typeof STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND;
  readonly version: typeof STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION;
  readonly signature: `sha256:${string}`;
  readonly wardrobe: StudioVrmLinkedAppearanceWardrobeProjection;
  readonly handProps: StudioVrmLinkedAppearanceHandPropsProjection;
}

const WARDROBE_ROOT_KEYS = new Set(["version", "slots", "options"]);
const WARDROBE_EQUIP_KEYS = new Set([
  "itemId",
  "color",
  "fit",
  "fitMode",
  "fabricId",
]);
const WARDROBE_OPTION_KEYS = new Set(["autoHideOriginal"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function unsupportedKeys(
  value: Record<string, unknown>,
  supported: ReadonlySet<string>,
): string[] {
  return Object.keys(value)
    .filter((key) => !supported.has(key))
    .sort(compareStableText);
}

function reason(
  feature: StudioVrmLinkedAppearanceProjectionFeature,
  code: StudioVrmLinkedAppearanceProjectionUnsupportedReasonCode,
  path: string,
): StudioVrmLinkedAppearanceProjectionUnsupportedReason {
  return Object.freeze({ feature, code, path });
}

function unsupportedWardrobe(
  reasons: readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[],
): StudioVrmLinkedAppearanceWardrobeProjection {
  return Object.freeze({ status: "unsupported" as const, reasons: Object.freeze([...reasons]) });
}

function wardrobeSourceVersion(
  rawVersion: unknown,
): "legacy" | 1 | 2 | "unsupported" {
  if (rawVersion === undefined) return "legacy";
  if (rawVersion === 1 || rawVersion === VRM_WARDROBE_VERSION) return rawVersion;
  return "unsupported";
}

function inspectWardrobeEquip(
  slot: WardrobeSlot,
  raw: unknown,
  path: string,
  present: boolean,
): readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[] {
  if (!present) return Object.freeze([]);
  if (!isRecord(raw)) {
    return Object.freeze([reason("wardrobe", "malformed-document", path)]);
  }

  const unknownFields = unsupportedKeys(raw, WARDROBE_EQUIP_KEYS);
  if (unknownFields.length > 0) {
    return Object.freeze(unknownFields.map((field) =>
      reason("wardrobe", "partial-document", `${path}.${field}`)));
  }

  if (typeof raw.itemId !== "string") {
    return Object.freeze([reason("wardrobe", "unknown-item", `${path}.itemId`)]);
  }
  const item = wardrobeItemById(raw.itemId);
  if (!item || item.slot !== slot) {
    return Object.freeze([reason("wardrobe", "unknown-item", `${path}.itemId`)]);
  }
  if (raw.color !== undefined && (typeof raw.color !== "string" || !HEX_COLOR.test(raw.color))) {
    return Object.freeze([reason("wardrobe", "malformed-document", `${path}.color`)]);
  }
  if (raw.fit !== undefined && (typeof raw.fit !== "number" || !Number.isFinite(raw.fit))) {
    return Object.freeze([reason("wardrobe", "malformed-document", `${path}.fit`)]);
  }
  if (
    raw.fitMode !== undefined
    && raw.fitMode !== "auto"
    && raw.fitMode !== "manual"
  ) {
    return Object.freeze([reason("wardrobe", "malformed-document", `${path}.fitMode`)]);
  }
  if (
    raw.fabricId !== undefined
    && (typeof raw.fabricId !== "string" || !wardrobeFabricById(raw.fabricId))
  ) {
    return Object.freeze([reason("wardrobe", "malformed-document", `${path}.fabricId`)]);
  }
  return Object.freeze([]);
}

/**
 * Strict, side-effect-free wardrobe inspection for linked rendering.
 *
 * The editor parser intentionally repairs old data. This boundary first rejects fields that the
 * tolerant parser would otherwise drop, then uses the same deterministic legacy defaults and fit
 * clamping as the Poser runtime so a declared supported plan cannot silently lose authored state.
 */
export function inspectStudioVrmWardrobeForLinkedProjection(
  raw: unknown,
): StudioVrmLinkedAppearanceWardrobeProjection {
  if (raw === null || raw === undefined || raw === false || raw === 0 || raw === "") {
    return Object.freeze({ status: "empty" as const });
  }
  if (Array.isArray(raw)) {
    return raw.length === 0
      ? Object.freeze({ status: "empty" as const })
      : unsupportedWardrobe([reason("wardrobe", "malformed-document", "appearance.wardrobe")]);
  }
  if (!isRecord(raw)) {
    return unsupportedWardrobe([reason("wardrobe", "malformed-document", "appearance.wardrobe")]);
  }

  try {
    if (Object.keys(raw).length === 0) return Object.freeze({ status: "empty" as const });
    const sourceVersion = wardrobeSourceVersion(raw.version);
    if (sourceVersion === "unsupported") {
      return unsupportedWardrobe([
        reason("wardrobe", "unsupported-version", "appearance.wardrobe.version"),
      ]);
    }

    const explicitSlots = Object.hasOwn(raw, "slots");
    if (sourceVersion === VRM_WARDROBE_VERSION && !explicitSlots) {
      return unsupportedWardrobe([
        reason("wardrobe", "partial-document", "appearance.wardrobe.slots"),
      ]);
    }
    const slotsRaw = explicitSlots ? raw.slots : raw;
    if (!isRecord(slotsRaw)) {
      return unsupportedWardrobe([
        reason("wardrobe", "malformed-document", "appearance.wardrobe.slots"),
      ]);
    }

    const directWardrobeRootKeys = new Set<string>(["version", ...WARDROBE_SLOTS]);
    const unknownRootKeys = unsupportedKeys(
      raw,
      explicitSlots ? WARDROBE_ROOT_KEYS : directWardrobeRootKeys,
    );
    if (unknownRootKeys.length > 0) {
      return unsupportedWardrobe(unknownRootKeys.map((key) =>
        reason("wardrobe", "partial-document", `appearance.wardrobe.${key}`)));
    }

    const supportedSlotKeys = new Set<string>(WARDROBE_SLOTS);
    if (slotsRaw === raw) supportedSlotKeys.add("version");
    const unknownSlots = unsupportedKeys(slotsRaw, supportedSlotKeys);
    if (unknownSlots.length > 0) {
      return unsupportedWardrobe(unknownSlots.map((slot) =>
        reason("wardrobe", "partial-document", `appearance.wardrobe.slots.${slot}`)));
    }

    if (Object.hasOwn(raw, "options")) {
      if (sourceVersion !== VRM_WARDROBE_VERSION || !isRecord(raw.options)) {
        return unsupportedWardrobe([
          reason("wardrobe", "partial-document", "appearance.wardrobe.options"),
        ]);
      }
      const unknownOptions = unsupportedKeys(raw.options, WARDROBE_OPTION_KEYS);
      if (unknownOptions.length > 0) {
        return unsupportedWardrobe(unknownOptions.map((option) =>
          reason("wardrobe", "partial-document", `appearance.wardrobe.options.${option}`)));
      }
      if (
        raw.options.autoHideOriginal !== undefined
        && typeof raw.options.autoHideOriginal !== "boolean"
      ) {
        return unsupportedWardrobe([
          reason("wardrobe", "malformed-document", "appearance.wardrobe.options.autoHideOriginal"),
        ]);
      }
    }

    const validationReasons = WARDROBE_SLOTS.flatMap((slot) =>
      inspectWardrobeEquip(
        slot,
        slotsRaw[slot],
        `appearance.wardrobe.slots.${slot}`,
        Object.hasOwn(slotsRaw, slot),
      ),
    );
    if (validationReasons.length > 0) return unsupportedWardrobe(validationReasons);

    const parsed: ParsedWardrobeDocument = parseWardrobeDocument(raw);
    if (!parsed.supported) {
      return unsupportedWardrobe([
        reason("wardrobe", "unsupported-version", "appearance.wardrobe.version"),
      ]);
    }

    const slots = WARDROBE_SLOTS.flatMap((slot) => {
      const equip = parsed.slots[slot];
      if (!equip) return [];
      const item = wardrobeItemById(equip.itemId);
      if (!item || item.slot !== slot) return [];
      return [Object.freeze({
        slot,
        itemId: equip.itemId,
        color: equip.color,
        fit: Math.min(WARDROBE_FIT_MAX, Math.max(WARDROBE_FIT_MIN, equip.fit)),
        fitMode: equip.fitMode,
        fabricId: equip.fabricId,
        geometrySource: item.geometrySource,
        quality: item.quality,
      })];
    });
    if (slots.length === 0) return Object.freeze({ status: "empty" as const });

    return Object.freeze({
      status: "supported" as const,
      sourceVersion,
      autoHideOriginal: parsed.options.autoHideOriginal,
      slots: Object.freeze(slots),
    });
  } catch {
    return unsupportedWardrobe([
      reason("wardrobe", "malformed-document", "appearance.wardrobe"),
    ]);
  }
}

function mapPropIssue(
  issue: VrmPropsProjectionIssue,
): StudioVrmLinkedAppearanceProjectionUnsupportedReason {
  const path = issue.path === "$" ? "props" : `props.${issue.path}`;
  if (issue.reason === "unsupported-version") {
    return reason("hand-props", "unsupported-version", path);
  }
  if (issue.reason === "unknown-prop-id") {
    return reason("hand-props", "unknown-prop", path);
  }
  if (issue.reason === "duplicate-uid") {
    return reason("hand-props", "duplicate-identity", path);
  }
  if (
    issue.reason === "unsupported-document-field"
    || issue.reason === "unsupported-item-field"
  ) {
    return reason("hand-props", "partial-document", path);
  }
  if (
    issue.reason === "rig-not-supported-for-source-version"
    || issue.reason === "unsupported-rig-version"
    || issue.reason === "unsupported-rig-field"
    || issue.reason === "unsupported-rig-secondary"
    || issue.reason === "unsupported-secondary-field"
  ) {
    return reason("hand-props", "unsupported-rig", path);
  }
  if (
    issue.reason === "missing-prop-id"
    || issue.reason === "missing-uid"
    || issue.reason === "missing-bone"
  ) {
    return reason("hand-props", "partial-document", path);
  }
  return reason("hand-props", "malformed-document", path);
}

function unsupportedHandProps(
  reasons: readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[],
): StudioVrmLinkedAppearanceHandPropsProjection {
  return Object.freeze({ status: "unsupported" as const, reasons: Object.freeze([...reasons]) });
}

function inspectHandProps(
  raw: unknown,
): StudioVrmLinkedAppearanceHandPropsProjection {
  const inspection = inspectVrmPropsDocumentForProjection(raw);
  if (inspection.status === "rejected") {
    return unsupportedHandProps(inspection.issues.map(mapPropIssue));
  }
  if (inspection.document.items.length === 0) {
    return Object.freeze({ status: "empty" as const });
  }
  if (inspection.sourceVersion === "absent") {
    // The strict inspector can only produce an absent source with an empty item array. Keep this
    // impossible future contract drift fail-closed instead of widening supported source versions.
    return unsupportedHandProps([
      reason("hand-props", "malformed-document", "props"),
    ]);
  }
  if (inspection.document.items.length > STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS) {
    return unsupportedHandProps([
      reason("hand-props", "resource-budget-exceeded", "props.items"),
    ]);
  }

  const categoryReasons = inspection.document.items.flatMap((item, index) => {
    const definition = propDefById(item.propId);
    return definition?.category === "hand" && (item.bone === "leftHand" || item.bone === "rightHand")
      ? []
      : [reason("hand-props", "unsupported-prop-category", `props.items[${index}]`)];
  });
  if (categoryReasons.length > 0) return unsupportedHandProps(categoryReasons);

  const props = inspection.document.items.map((item) => {
    const rig = item.rig;
    const definition = propDefById(item.propId)!;
    const bone = item.bone as PropHandBone;
    return Object.freeze({
      uid: item.uid,
      propId: item.propId,
      bone,
      attachmentMode: rig ? "smart-rig-v2" as const : "legacy-transform" as const,
      primaryAnchorId: rig?.anchorId ?? null,
      autoScale: rig?.autoScale ?? false,
      autoGripHand: rig?.autoFingerPose && definition.grip ? bone : null,
      gripFit: rig?.autoFingerPose && definition.grip ? rig.gripFit : null,
      secondaryHand: rig?.secondary?.enabled
        ? Object.freeze({
            bone: rig.secondary.bone,
            anchorId: rig.secondary.anchorId,
            influence: rig.secondary.influence,
          })
        : null,
      instance: item,
    });
  });
  return Object.freeze({
    status: "supported" as const,
    sourceVersion: inspection.sourceVersion,
    props: Object.freeze(props),
  });
}

function projectionSignature(value: {
  readonly wardrobe: StudioVrmLinkedAppearanceWardrobeProjection;
  readonly handProps: StudioVrmLinkedAppearanceHandPropsProjection;
}): `sha256:${string}` {
  const bytes = new TextEncoder().encode(JSON.stringify({
    kind: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND,
    version: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION,
    wardrobe: value.wardrobe,
    handProps: value.handProps,
  }));
  return `sha256:${sha256HexPortable(bytes)}`;
}

/** Builds a deterministic, engine-neutral plan without mutating the canonical VRM scene. */
export function createStudioVrmLinkedAppearanceProjectionPlan(
  scene: Pick<StudioVrmSceneDocument, "appearance" | "props">,
): StudioVrmLinkedAppearanceProjectionPlan {
  const wardrobe = inspectStudioVrmWardrobeForLinkedProjection(scene.appearance.wardrobe);
  const handProps = inspectHandProps(scene.props);
  return Object.freeze({
    kind: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND,
    version: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION,
    signature: projectionSignature({ wardrobe, handProps }),
    wardrobe,
    handProps,
  });
}
