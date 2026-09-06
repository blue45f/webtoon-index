import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS,
  STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND,
  STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION,
  createStudioVrmLinkedAppearanceProjectionPlan,
} from "./studio-vrm-linked-appearance-projection-plan";
import { createStudioVrmLinkedAppearanceReadiness } from "./studio-vrm-linked-appearance-readiness";

import type {
  StudioVrmLinkedAppearanceProjectionPlan,
  StudioVrmLinkedAppearanceProjectionUnsupportedReason,
} from "./studio-vrm-linked-appearance-projection-plan";
import type { StudioVrmLinkedAppearanceReadinessState } from "./studio-vrm-linked-appearance-readiness";

export interface StudioVrmLinkedAppearanceReadinessPlanIdentityInput {
  readonly runtimeKey: string;
  readonly placementHash: string;
  readonly generation: number;
}

export type StudioVrmLinkedAppearanceReadinessPlanResult =
  | Readonly<{
      readonly ok: true;
      readonly state: StudioVrmLinkedAppearanceReadinessState;
    }>
  | Readonly<{
      readonly ok: false;
      readonly state: null;
      readonly reasons: readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[];
    }>;

const PROJECTION_SIGNATURE_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PLAN_KEYS = ["kind", "version", "signature", "wardrobe", "handProps"] as const;
const WARDROBE_SUPPORTED_KEYS = [
  "status",
  "sourceVersion",
  "autoHideOriginal",
  "slots",
] as const;
const WARDROBE_SLOT_KEYS = [
  "slot",
  "itemId",
  "color",
  "fit",
  "fitMode",
  "fabricId",
  "geometrySource",
  "quality",
] as const;
const HAND_PROPS_SUPPORTED_KEYS = ["status", "sourceVersion", "props"] as const;
const HAND_PROP_KEYS = [
  "uid",
  "propId",
  "bone",
  "attachmentMode",
  "primaryAnchorId",
  "autoScale",
  "autoGripHand",
  "gripFit",
  "secondaryHand",
  "instance",
] as const;
const SECONDARY_HAND_KEYS = ["bone", "anchorId", "influence"] as const;
const PROP_INSTANCE_KEYS = [
  "uid",
  "propId",
  "bone",
  "position",
  "rotationDeg",
  "scale",
  "color",
] as const;
const PROP_RIG_KEYS = [
  "version",
  "mode",
  "anchorId",
  "autoScale",
  "autoFingerPose",
  "gripFit",
  "deltaPosition",
  "deltaRotationDeg",
  "deltaScale",
] as const;
const PROP_RIG_SECONDARY_KEYS = [
  "enabled",
  "anchorId",
  "bone",
  "influence",
] as const;
const UNSUPPORTED_KEYS = ["status", "reasons"] as const;
const UNSUPPORTED_REASON_KEYS = ["feature", "code", "path"] as const;
const EMPTY_KEYS = ["status"] as const;
const UNSUPPORTED_REASON_CODES = new Set<string>([
  "unsupported-version",
  "malformed-document",
  "unknown-item",
  "unknown-prop",
  "unsupported-prop-category",
  "unsupported-rig",
  "resource-budget-exceeded",
  "duplicate-identity",
  "partial-document",
]);

const INVALID_PLAN_REASON = Object.freeze({
  feature: "wardrobe" as const,
  code: "malformed-document" as const,
  path: "projection-plan",
});
const INVALID_PLAN_REASONS = Object.freeze([INVALID_PLAN_REASON]);
const INVALID_PLAN_RESULT: StudioVrmLinkedAppearanceReadinessPlanResult = Object.freeze({
  ok: false as const,
  state: null,
  reasons: INVALID_PLAN_REASONS,
});

type ProjectionPlanInput = Parameters<typeof createStudioVrmLinkedAppearanceProjectionPlan>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function hasCanonicalArrayShape(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!keys.includes(String(index))) return false;
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectionInput(wardrobe: unknown, props: unknown): ProjectionPlanInput {
  return {
    appearance: { wardrobe } as ProjectionPlanInput["appearance"],
    props: props as ProjectionPlanInput["props"],
  };
}

function isValidUnsupportedProjection(
  value: Record<string, unknown>,
  feature: StudioVrmLinkedAppearanceProjectionUnsupportedReason["feature"],
): boolean {
  if (
    !hasExactKeys(value, UNSUPPORTED_KEYS)
    || !Array.isArray(value.reasons)
    || !hasCanonicalArrayShape(value.reasons)
  ) return false;
  if (value.reasons.length === 0) return false;

  const identities = new Set<string>();
  for (const candidate of value.reasons) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, UNSUPPORTED_REASON_KEYS)) return false;
    if (
      candidate.feature !== feature
      || typeof candidate.code !== "string"
      || !UNSUPPORTED_REASON_CODES.has(candidate.code)
      || !isNonEmptyString(candidate.path)
    ) return false;
    const identity = `${candidate.feature}\u0000${candidate.code}\u0000${candidate.path}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function isCanonicalVec3(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === 3
    && hasCanonicalArrayShape(value);
}

function isValidPropRigSecondaryShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasElbowHint = Object.hasOwn(value, "elbowHint");
  const expectedKeys = hasElbowHint
    ? [...PROP_RIG_SECONDARY_KEYS, "elbowHint"]
    : PROP_RIG_SECONDARY_KEYS;
  return hasExactKeys(value, expectedKeys)
    && (!hasElbowHint || isCanonicalVec3(value.elbowHint));
}

function isValidPropRigShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasSecondary = Object.hasOwn(value, "secondary");
  const expectedKeys = hasSecondary ? [...PROP_RIG_KEYS, "secondary"] : PROP_RIG_KEYS;
  return hasExactKeys(value, expectedKeys)
    && isCanonicalVec3(value.deltaPosition)
    && isCanonicalVec3(value.deltaRotationDeg)
    && (!hasSecondary || isValidPropRigSecondaryShape(value.secondary));
}

function isValidPropInstanceShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasRig = Object.hasOwn(value, "rig");
  const expectedKeys = hasRig ? [...PROP_INSTANCE_KEYS, "rig"] : PROP_INSTANCE_KEYS;
  return hasExactKeys(value, expectedKeys)
    && isCanonicalVec3(value.position)
    && isCanonicalVec3(value.rotationDeg)
    && (!hasRig || isValidPropRigShape(value.rig));
}

function wardrobeDocumentFromProjection(value: Record<string, unknown>): unknown {
  const slots = value.slots as readonly Record<string, unknown>[];
  const serializedSlots = Object.fromEntries(slots.map((slot) => [
    slot.slot,
    {
      itemId: slot.itemId,
      color: slot.color,
      fit: slot.fit,
      fitMode: slot.fitMode,
      fabricId: slot.fabricId,
    },
  ]));

  if (value.sourceVersion === "legacy") return serializedSlots;
  if (value.sourceVersion === 1) return { version: 1, slots: serializedSlots };
  return {
    version: 2,
    slots: serializedSlots,
    options: { autoHideOriginal: value.autoHideOriginal },
  };
}

function isValidWardrobeProjection(value: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "empty") return hasExactKeys(value, EMPTY_KEYS);
  if (value.status === "unsupported") {
    return isValidUnsupportedProjection(value, "wardrobe");
  }
  if (value.status !== "supported" || !hasExactKeys(value, WARDROBE_SUPPORTED_KEYS)) {
    return false;
  }
  if (
    (value.sourceVersion !== "legacy" && value.sourceVersion !== 1 && value.sourceVersion !== 2)
    || typeof value.autoHideOriginal !== "boolean"
    || !Array.isArray(value.slots)
    || !hasCanonicalArrayShape(value.slots)
    || value.slots.length === 0
    || value.slots.length > 4
  ) return false;
  if (value.slots.some((slot) => !isRecord(slot) || !hasExactKeys(slot, WARDROBE_SLOT_KEYS))) {
    return false;
  }

  const regenerated = createStudioVrmLinkedAppearanceProjectionPlan(
    projectionInput(wardrobeDocumentFromProjection(value), null),
  ).wardrobe;
  return isCanonicalJsonEqual(value, regenerated);
}

function propsDocumentFromProjection(value: Record<string, unknown>): unknown {
  const items = (value.props as readonly Record<string, unknown>[]).map((prop) => prop.instance);
  if (value.sourceVersion === "legacy") return { items };
  return { version: value.sourceVersion, items };
}

function isValidHandPropsProjection(value: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "empty") return hasExactKeys(value, EMPTY_KEYS);
  if (value.status === "unsupported") {
    return isValidUnsupportedProjection(value, "hand-props");
  }
  if (value.status !== "supported" || !hasExactKeys(value, HAND_PROPS_SUPPORTED_KEYS)) {
    return false;
  }
  if (
    (value.sourceVersion !== "legacy" && value.sourceVersion !== 1 && value.sourceVersion !== 2)
    || !Array.isArray(value.props)
    || !hasCanonicalArrayShape(value.props)
    || value.props.length === 0
    || value.props.length > STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS
  ) return false;
  for (const prop of value.props) {
    if (!isRecord(prop) || !hasExactKeys(prop, HAND_PROP_KEYS)) return false;
    if (
      prop.secondaryHand !== null
      && (!isRecord(prop.secondaryHand) || !hasExactKeys(prop.secondaryHand, SECONDARY_HAND_KEYS))
    ) return false;
    if (!isValidPropInstanceShape(prop.instance)) return false;
  }

  const regenerated = createStudioVrmLinkedAppearanceProjectionPlan(
    projectionInput(null, propsDocumentFromProjection(value)),
  ).handProps;
  return isCanonicalJsonEqual(value, regenerated);
}

function projectionSignature(value: {
  readonly wardrobe: unknown;
  readonly handProps: unknown;
}): `sha256:${string}` {
  const bytes = new TextEncoder().encode(JSON.stringify({
    kind: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND,
    version: STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION,
    wardrobe: value.wardrobe,
    handProps: value.handProps,
  }));
  return `sha256:${sha256HexPortable(bytes)}`;
}

function isValidProjectionPlan(value: unknown): value is StudioVrmLinkedAppearanceProjectionPlan {
  if (!isRecord(value) || !hasExactKeys(value, PLAN_KEYS)) return false;
  if (
    value.kind !== STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_KIND
    || value.version !== STUDIO_VRM_LINKED_APPEARANCE_PROJECTION_PLAN_VERSION
    || typeof value.signature !== "string"
    || !PROJECTION_SIGNATURE_PATTERN.test(value.signature)
  ) return false;
  if (!isValidWardrobeProjection(value.wardrobe)) return false;
  if (!isValidHandPropsProjection(value.handProps)) return false;
  return value.signature === projectionSignature({
    wardrobe: value.wardrobe,
    handProps: value.handProps,
  });
}

function copyUnsupportedReasons(
  plan: StudioVrmLinkedAppearanceProjectionPlan,
): readonly StudioVrmLinkedAppearanceProjectionUnsupportedReason[] {
  const reasons = [
    ...(plan.wardrobe.status === "unsupported" ? plan.wardrobe.reasons : []),
    ...(plan.handProps.status === "unsupported" ? plan.handProps.reasons : []),
  ];
  return Object.freeze(reasons.map((reason) => Object.freeze({
    feature: reason.feature,
    code: reason.code,
    path: reason.path,
  })));
}

/**
 * Adapts the engine-neutral appearance projection into the coordinator's exact receipt authority.
 * Unsupported branches never expose a partial coordinator state.
 */
export function createStudioVrmLinkedAppearanceReadinessPlan(
  plan: StudioVrmLinkedAppearanceProjectionPlan,
  identityInput: StudioVrmLinkedAppearanceReadinessPlanIdentityInput,
): StudioVrmLinkedAppearanceReadinessPlanResult {
  try {
    if (!isValidProjectionPlan(plan)) return INVALID_PLAN_RESULT;
  } catch {
    return INVALID_PLAN_RESULT;
  }

  const identity = {
    runtimeKey: identityInput.runtimeKey,
    placementHash: identityInput.placementHash,
    projectionSignature: plan.signature,
    generation: identityInput.generation,
  };
  const hasUnsupportedBranch = plan.wardrobe.status === "unsupported"
    || plan.handProps.status === "unsupported";

  if (hasUnsupportedBranch) {
    // The coordinator remains the sole identity validator. This validation-only state is discarded
    // immediately so unsupported appearance can never masquerade as a partial readiness protocol.
    createStudioVrmLinkedAppearanceReadiness({ identity, wardrobe: [], props: [] });
    return Object.freeze({
      ok: false as const,
      state: null,
      reasons: copyUnsupportedReasons(plan),
    });
  }

  const wardrobe = plan.wardrobe.status === "supported"
    ? plan.wardrobe.slots.map(({ slot, itemId }) => ({ slot, itemId }))
    : [];
  const props = plan.handProps.status === "supported"
    ? plan.handProps.props.map(({ uid, propId }) => ({ uid, propId }))
    : [];
  const state = createStudioVrmLinkedAppearanceReadiness({ identity, wardrobe, props });
  return Object.freeze({ ok: true as const, state });
}
