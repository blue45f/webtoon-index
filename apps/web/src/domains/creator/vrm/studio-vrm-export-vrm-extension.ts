/**
 * VRM 1.0 extension serialization from plain data — no Three.js, no DOM, no GPU.
 *
 * ## Why VRM 1.0 (`VRMC_vrm`) and not VRM 0.x (`VRM`)
 * 1. `@pixiv/three-vrm` 3.5.3 — the loader this app already ships — treats 1.0 as native and only
 *    *migrates* 0.x through `@pixiv/three-vrm-materials-v0compat` + `VRMUtils.rotateVRM0`. Writing
 *    0.x would mean re-implementing that migration in reverse, including the Y-axis 180° flip.
 * 2. 0.x encodes humanoid bones by *node name string*, whereas 1.0 uses node indices — indices are
 *    what a headless planner can validate; names cannot be checked for collisions reliably.
 * 3. 0.x `blendShapeMaster` and `secondaryAnimation` have no typed schema in the installed
 *    packages, while `@pixiv/types-vrmc-vrm-1.0` (a transitive dep of `@pixiv/three-vrm`) documents
 *    every 1.0 field precisely.
 *
 * ## Required-field ground truth (read from the installed packages, not from memory)
 * - `VRMCVRM` requires `specVersion`, `meta`, `humanoid`.
 * - `Meta` requires `name`, `authors`, `licenseUrl`.
 * - `VRMMetaLoaderPlugin` defaults `acceptLicenseUrls` to `["https://vrm.dev/licenses/1.0/"]` and
 *   **throws** on any other value, so emitting a different licence URL produces a file this app's
 *   own loader refuses. `otherLicenseUrl` is the spec-sanctioned place for extra terms.
 * - `VRMHumanoidLoaderPlugin` throws unless all 15 `VRMRequiredHumanBoneName` entries are present.
 */

import {
  STUDIO_HUMANOID_BONE_NAMES,
  type StudioHumanoidBoneName,
} from "../studio-humanoid-bones";

import { studioVrmExportError } from "./studio-vrm-export-error";

export const STUDIO_VRM_EXPORT_SPEC_VERSION = "1.0" as const;
export const STUDIO_VRM_EXPORT_VRM_EXTENSION = "VRMC_vrm" as const;
export const STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION = "VRMC_springBone" as const;
export const STUDIO_VRM_EXPORT_MTOON_EXTENSION = "VRMC_materials_mtoon" as const;
/** The only licence URL `@pixiv/three-vrm`'s meta loader accepts without custom options. */
export const STUDIO_VRM_EXPORT_LICENSE_URL = "https://vrm.dev/licenses/1.0/" as const;

/** Mirrors `VRMRequiredHumanBoneName` in `@pixiv/three-vrm` 3.5.3. */
export const STUDIO_VRM_EXPORT_REQUIRED_BONES = Object.freeze([
  "hips",
  "spine",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
] as const satisfies readonly StudioHumanoidBoneName[]);

export const STUDIO_VRM_EXPORT_EXPRESSION_PRESETS = Object.freeze([
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blinkLeft",
  "blinkRight",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
  "neutral",
] as const);

export type StudioVrmExportExpressionPreset =
  (typeof STUDIO_VRM_EXPORT_EXPRESSION_PRESETS)[number];

export const STUDIO_VRM_EXPORT_OUTLINE_WIDTH_MODES = Object.freeze([
  "none",
  "worldCoordinates",
  "screenCoordinates",
] as const);

export type StudioVrmExportOutlineWidthMode =
  (typeof STUDIO_VRM_EXPORT_OUTLINE_WIDTH_MODES)[number];

export type StudioVrmExportAvatarPermission =
  | "onlyAuthor"
  | "onlySeparatelyLicensedPerson"
  | "everyone";
export type StudioVrmExportCommercialUsage = "personalNonProfit" | "personalProfit" | "corporation";
export type StudioVrmExportCreditNotation = "required" | "unnecessary";
export type StudioVrmExportModification =
  | "prohibited"
  | "allowModification"
  | "allowModificationRedistribution";
export type StudioVrmExportExpressionOverride = "none" | "block" | "blend";
export type StudioVrmExportFirstPersonType =
  | "auto"
  | "both"
  | "thirdPersonOnly"
  | "firstPersonOnly";

export interface StudioVrmExportMeta {
  readonly name: string;
  readonly authors: readonly string[];
  /** Optional; defaults to (and is only allowed to be) the canonical VRM 1.0 licence URL. */
  readonly licenseUrl?: string;
  readonly version?: string;
  readonly copyrightInformation?: string;
  readonly contactInformation?: string;
  readonly references?: readonly string[];
  readonly thirdPartyLicenses?: string;
  /** Index into `gltf.images`. */
  readonly thumbnailImage?: number;
  readonly avatarPermission?: StudioVrmExportAvatarPermission;
  readonly allowExcessivelyViolentUsage?: boolean;
  readonly allowExcessivelySexualUsage?: boolean;
  readonly commercialUsage?: StudioVrmExportCommercialUsage;
  readonly allowPoliticalOrReligiousUsage?: boolean;
  readonly allowAntisocialOrHateUsage?: boolean;
  readonly creditNotation?: StudioVrmExportCreditNotation;
  readonly allowRedistribution?: boolean;
  readonly modification?: StudioVrmExportModification;
  readonly otherLicenseUrl?: string;
}

export type StudioVrmExportHumanoidBones = Readonly<Partial<Record<StudioHumanoidBoneName, number>>>;

export interface StudioVrmExportMorphTargetBind {
  readonly node: number;
  readonly index: number;
  readonly weight: number;
}

export interface StudioVrmExportExpression {
  readonly morphTargetBinds?: readonly StudioVrmExportMorphTargetBind[];
  readonly isBinary?: boolean;
  readonly overrideBlink?: StudioVrmExportExpressionOverride;
  readonly overrideLookAt?: StudioVrmExportExpressionOverride;
  readonly overrideMouth?: StudioVrmExportExpressionOverride;
}

export interface StudioVrmExportExpressions {
  readonly preset?: Readonly<Partial<Record<StudioVrmExportExpressionPreset, StudioVrmExportExpression>>>;
  readonly custom?: Readonly<Record<string, StudioVrmExportExpression>>;
}

export interface StudioVrmExportFirstPersonAnnotation {
  readonly node: number;
  readonly type: StudioVrmExportFirstPersonType;
}

export interface StudioVrmExportSpringJoint {
  readonly node: number;
  readonly hitRadius: number;
  readonly stiffness: number;
  readonly gravityPower: number;
  readonly dragForce: number;
  readonly gravityDir?: readonly [number, number, number];
}

export interface StudioVrmExportSpring {
  readonly name?: string;
  readonly joints: readonly StudioVrmExportSpringJoint[];
  readonly colliderGroups?: readonly number[];
  readonly center?: number;
}

export interface StudioVrmExportSphereCollider {
  readonly node: number;
  readonly shape: "sphere";
  readonly offset: readonly [number, number, number];
  readonly radius: number;
}

export interface StudioVrmExportCapsuleCollider {
  readonly node: number;
  readonly shape: "capsule";
  readonly offset: readonly [number, number, number];
  readonly radius: number;
  readonly tail: readonly [number, number, number];
}

export type StudioVrmExportCollider =
  | StudioVrmExportSphereCollider
  | StudioVrmExportCapsuleCollider;

export interface StudioVrmExportColliderGroup {
  readonly name?: string;
  readonly colliders: readonly number[];
}

export interface StudioVrmExportSpringBoneConfig {
  readonly colliders?: readonly StudioVrmExportCollider[];
  readonly colliderGroups?: readonly StudioVrmExportColliderGroup[];
  readonly springs?: readonly StudioVrmExportSpring[];
}

export interface StudioVrmExportMToonParams {
  readonly transparentWithZWrite?: boolean;
  readonly renderQueueOffsetNumber?: number;
  readonly shadeColorFactor?: readonly [number, number, number];
  readonly shadingShiftFactor?: number;
  readonly shadingToonyFactor?: number;
  readonly giEqualizationFactor?: number;
  readonly matcapFactor?: readonly [number, number, number];
  readonly parametricRimColorFactor?: readonly [number, number, number];
  readonly rimLightingMixFactor?: number;
  readonly parametricRimFresnelPowerFactor?: number;
  readonly parametricRimLiftFactor?: number;
  readonly outlineWidthMode?: StudioVrmExportOutlineWidthMode;
  readonly outlineWidthFactor?: number;
  readonly outlineColorFactor?: readonly [number, number, number];
  readonly outlineLightingMixFactor?: number;
  readonly uvAnimationScrollXSpeedFactor?: number;
  readonly uvAnimationScrollYSpeedFactor?: number;
  readonly uvAnimationRotationSpeedFactor?: number;
}

export interface StudioVrmExtensionContext {
  readonly nodeCount: number;
  readonly imageCount: number;
  /** Morph-target count of the mesh attached to each node; `null` when the node carries no mesh. */
  readonly morphTargetCountByNode: readonly (number | null)[];
}

const BONE_NAME_SET = new Set<string>(STUDIO_HUMANOID_BONE_NAMES);
const PRESET_SET = new Set<string>(STUDIO_VRM_EXPORT_EXPRESSION_PRESETS);
const OUTLINE_MODE_SET = new Set<string>(STUDIO_VRM_EXPORT_OUTLINE_WIDTH_MODES);
const OVERRIDE_SET = new Set<string>(["none", "block", "blend"]);
const FIRST_PERSON_TYPE_SET = new Set<string>([
  "auto",
  "both",
  "thirdPersonOnly",
  "firstPersonOnly",
]);
const AVATAR_PERMISSION_SET = new Set<string>([
  "onlyAuthor",
  "onlySeparatelyLicensedPerson",
  "everyone",
]);
const COMMERCIAL_USAGE_SET = new Set<string>([
  "personalNonProfit",
  "personalProfit",
  "corporation",
]);
const CREDIT_NOTATION_SET = new Set<string>(["required", "unnecessary"]);
const MODIFICATION_SET = new Set<string>([
  "prohibited",
  "allowModification",
  "allowModificationRedistribution",
]);
/** Guards a runaway custom-expression map from inflating the JSON chunk. */
const MAX_CUSTOM_EXPRESSIONS = 256;
const MAX_META_TEXT_LENGTH = 2_048;
const MAX_META_AUTHORS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime "this really is an object" guard that deliberately does **not** narrow the argument:
 * narrowing a typed snapshot field down to `Record<string, unknown>` would erase the declared
 * member types that the rest of each builder relies on.
 */
function assertRecord(value: unknown, code: Parameters<typeof studioVrmExportError>[0]): void {
  if (!isRecord(value)) throw studioVrmExportError(code);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNodeIndex(value: unknown, nodeCount: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value < nodeCount;
}

function trimmedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  return normalized.length > 0 && normalized.length <= MAX_META_TEXT_LENGTH ? normalized : null;
}

function optionalText(value: unknown, code: "meta-field-invalid"): string | undefined {
  if (value === undefined) return undefined;
  const text = trimmedText(value);
  if (text === null) throw studioVrmExportError(code);
  return text;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw studioVrmExportError("meta-field-invalid");
  return value;
}

function optionalEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw studioVrmExportError("meta-field-invalid");
  }
  return value as T;
}

function colorTriplet(value: unknown, code: "mtoon-invalid"): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => !isFiniteNumber(entry) || entry < 0 || entry > 1)
  ) {
    throw studioVrmExportError(code);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function vector3(value: unknown, code: "spring-bone-invalid"): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !isFiniteNumber(entry))) {
    throw studioVrmExportError(code);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function boundedFactor(
  value: unknown,
  minimum: number,
  maximum: number,
  code: "mtoon-invalid",
): number {
  if (!isFiniteNumber(value) || value < minimum || value > maximum) {
    throw studioVrmExportError(code);
  }
  return value;
}

/**
 * Validates and normalizes VRM 1.0 licence metadata.
 *
 * VRM licence metadata is *mandatory*: a file without `name`/`authors`/`licenseUrl` is not a legal
 * VRM 1.0 document and `@pixiv/three-vrm` will refuse or mis-report it. Each failure raises a
 * distinct Korean message so the panel can point at the field the author must fill in.
 */
export function buildStudioVrmExportMeta(
  meta: StudioVrmExportMeta,
  context: Pick<StudioVrmExtensionContext, "imageCount">,
): Record<string, unknown> {
  assertRecord(meta, "invalid-snapshot");
  const name = trimmedText(meta.name);
  if (name === null) throw studioVrmExportError("meta-name-missing");

  if (!Array.isArray(meta.authors) || meta.authors.length === 0) {
    throw studioVrmExportError("meta-authors-missing");
  }
  if (meta.authors.length > MAX_META_AUTHORS) throw studioVrmExportError("meta-field-invalid");
  const authors = meta.authors.map((author) => {
    const text = trimmedText(author);
    if (text === null) throw studioVrmExportError("meta-authors-missing");
    return text;
  });

  const licenseUrl = meta.licenseUrl ?? STUDIO_VRM_EXPORT_LICENSE_URL;
  if (licenseUrl !== STUDIO_VRM_EXPORT_LICENSE_URL) {
    throw studioVrmExportError("meta-license-url-invalid", {
      expectedLicenseUrl: STUDIO_VRM_EXPORT_LICENSE_URL,
    });
  }

  let references: string[] | undefined;
  if (meta.references !== undefined) {
    if (!Array.isArray(meta.references) || meta.references.length > MAX_META_AUTHORS) {
      throw studioVrmExportError("meta-field-invalid");
    }
    references = meta.references.map((reference) => {
      const text = trimmedText(reference);
      if (text === null) throw studioVrmExportError("meta-field-invalid");
      return text;
    });
  }

  let thumbnailImage: number | undefined;
  if (meta.thumbnailImage !== undefined) {
    if (
      !Number.isSafeInteger(meta.thumbnailImage) ||
      meta.thumbnailImage < 0 ||
      meta.thumbnailImage >= context.imageCount
    ) {
      throw studioVrmExportError("meta-thumbnail-invalid");
    }
    thumbnailImage = meta.thumbnailImage;
  }

  return {
    name,
    authors,
    licenseUrl,
    version: optionalText(meta.version, "meta-field-invalid"),
    copyrightInformation: optionalText(meta.copyrightInformation, "meta-field-invalid"),
    contactInformation: optionalText(meta.contactInformation, "meta-field-invalid"),
    references,
    thirdPartyLicenses: optionalText(meta.thirdPartyLicenses, "meta-field-invalid"),
    thumbnailImage,
    avatarPermission: optionalEnum<StudioVrmExportAvatarPermission>(
      meta.avatarPermission,
      AVATAR_PERMISSION_SET,
    ),
    allowExcessivelyViolentUsage: optionalBoolean(meta.allowExcessivelyViolentUsage),
    allowExcessivelySexualUsage: optionalBoolean(meta.allowExcessivelySexualUsage),
    commercialUsage: optionalEnum<StudioVrmExportCommercialUsage>(
      meta.commercialUsage,
      COMMERCIAL_USAGE_SET,
    ),
    allowPoliticalOrReligiousUsage: optionalBoolean(meta.allowPoliticalOrReligiousUsage),
    allowAntisocialOrHateUsage: optionalBoolean(meta.allowAntisocialOrHateUsage),
    creditNotation: optionalEnum<StudioVrmExportCreditNotation>(
      meta.creditNotation,
      CREDIT_NOTATION_SET,
    ),
    allowRedistribution: optionalBoolean(meta.allowRedistribution),
    modification: optionalEnum<StudioVrmExportModification>(meta.modification, MODIFICATION_SET),
    otherLicenseUrl: optionalText(meta.otherLicenseUrl, "meta-field-invalid"),
  };
}

/**
 * Builds `humanoid.humanBones`, enforcing the 15 required bones and rejecting a node that is
 * claimed by more than one bone (VRM 1.0 §humanoid: the mapping must be injective).
 */
export function buildStudioVrmExportHumanoid(
  bones: StudioVrmExportHumanoidBones,
  context: Pick<StudioVrmExtensionContext, "nodeCount">,
): Record<string, unknown> {
  assertRecord(bones, "invalid-snapshot");
  const humanBones: Record<string, { node: number }> = {};
  const claimedNodes = new Map<number, string>();
  // Iterate the canonical vocabulary, not the caller's key order, so output is deterministic and
  // an unknown bone name cannot smuggle itself into the document.
  for (const boneName of STUDIO_HUMANOID_BONE_NAMES) {
    const node = bones[boneName];
    if (node === undefined) continue;
    if (!isNodeIndex(node, context.nodeCount)) {
      throw studioVrmExportError("humanoid-node-invalid", { bone: boneName });
    }
    const owner = claimedNodes.get(node);
    if (owner !== undefined) {
      throw studioVrmExportError("humanoid-node-duplicate", { bone: boneName, conflictsWith: owner });
    }
    claimedNodes.set(node, boneName);
    humanBones[boneName] = { node };
  }
  for (const key of Object.keys(bones)) {
    if (!BONE_NAME_SET.has(key)) throw studioVrmExportError("humanoid-node-invalid", { bone: key });
  }

  const missingBones = STUDIO_VRM_EXPORT_REQUIRED_BONES.filter(
    (boneName) => humanBones[boneName] === undefined,
  );
  if (missingBones.length > 0) {
    throw studioVrmExportError("humanoid-bone-missing", { missingBones });
  }
  return { humanBones };
}

function buildExpression(
  expression: StudioVrmExportExpression,
  preset: StudioVrmExportExpressionPreset | "custom",
  name: string | undefined,
  context: StudioVrmExtensionContext,
): Record<string, unknown> {
  assertRecord(expression, "expression-invalid");
  let morphTargetBinds: { node: number; index: number; weight: number }[] | undefined;
  if (expression.morphTargetBinds !== undefined) {
    if (!Array.isArray(expression.morphTargetBinds)) throw studioVrmExportError("expression-invalid");
    morphTargetBinds = expression.morphTargetBinds.map((bind) => {
      assertRecord(bind, "expression-invalid");
      if (!isNodeIndex(bind.node, context.nodeCount)) {
        throw studioVrmExportError("expression-invalid");
      }
      const morphTargetCount = context.morphTargetCountByNode[bind.node] ?? 0;
      if (
        !Number.isSafeInteger(bind.index) ||
        typeof bind.index !== "number" ||
        bind.index < 0 ||
        bind.index >= morphTargetCount
      ) {
        throw studioVrmExportError("expression-invalid", { node: bind.node });
      }
      if (!isFiniteNumber(bind.weight) || bind.weight < 0 || bind.weight > 1) {
        throw studioVrmExportError("expression-invalid", { node: bind.node });
      }
      return { node: bind.node, index: bind.index, weight: bind.weight };
    });
  }
  return {
    name,
    preset,
    morphTargetBinds,
    isBinary: optionalBooleanForExpression(expression.isBinary),
    overrideBlink: optionalEnum<StudioVrmExportExpressionOverride>(
      expression.overrideBlink,
      OVERRIDE_SET,
    ),
    overrideLookAt: optionalEnum<StudioVrmExportExpressionOverride>(
      expression.overrideLookAt,
      OVERRIDE_SET,
    ),
    overrideMouth: optionalEnum<StudioVrmExportExpressionOverride>(
      expression.overrideMouth,
      OVERRIDE_SET,
    ),
  };
}

function optionalBooleanForExpression(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw studioVrmExportError("expression-invalid");
  return value;
}

export function buildStudioVrmExportExpressions(
  expressions: StudioVrmExportExpressions | undefined,
  context: StudioVrmExtensionContext,
): Record<string, unknown> | undefined {
  if (expressions === undefined) return undefined;
  assertRecord(expressions, "expression-invalid");

  let preset: Record<string, unknown> | undefined;
  if (expressions.preset !== undefined) {
    assertRecord(expressions.preset, "expression-invalid");
    for (const key of Object.keys(expressions.preset)) {
      if (!PRESET_SET.has(key)) throw studioVrmExportError("expression-invalid", { preset: key });
    }
    const entries: Record<string, unknown> = {};
    // Fixed preset order keeps the emitted JSON byte-stable across callers.
    for (const presetName of STUDIO_VRM_EXPORT_EXPRESSION_PRESETS) {
      const expression = expressions.preset[presetName];
      if (expression === undefined) continue;
      entries[presetName] = buildExpression(expression, presetName, undefined, context);
    }
    if (Object.keys(entries).length > 0) preset = entries;
  }

  let custom: Record<string, unknown> | undefined;
  if (expressions.custom !== undefined) {
    assertRecord(expressions.custom, "expression-invalid");
    const names = Object.keys(expressions.custom).sort();
    if (names.length > MAX_CUSTOM_EXPRESSIONS) throw studioVrmExportError("expression-invalid");
    const entries: Record<string, unknown> = {};
    for (const name of names) {
      const normalized = trimmedText(name);
      if (normalized === null || normalized !== name || PRESET_SET.has(name)) {
        throw studioVrmExportError("expression-invalid", { expression: name });
      }
      const expression = expressions.custom[name];
      if (expression === undefined) continue;
      entries[name] = buildExpression(expression, "custom", name, context);
    }
    if (Object.keys(entries).length > 0) custom = entries;
  }

  if (!preset && !custom) return undefined;
  return { preset, custom };
}

export function buildStudioVrmExportFirstPerson(
  annotations: readonly StudioVrmExportFirstPersonAnnotation[] | undefined,
  context: Pick<StudioVrmExtensionContext, "nodeCount">,
): Record<string, unknown> | undefined {
  if (annotations === undefined) return undefined;
  if (!Array.isArray(annotations)) throw studioVrmExportError("invalid-snapshot");
  if (annotations.length === 0) return undefined;
  const meshAnnotations = annotations.map((annotation) => {
    assertRecord(annotation, "invalid-snapshot");
    if (
      !isNodeIndex(annotation.node, context.nodeCount) ||
      typeof annotation.type !== "string" ||
      !FIRST_PERSON_TYPE_SET.has(annotation.type)
    ) {
      throw studioVrmExportError("invalid-snapshot");
    }
    return { node: annotation.node, type: annotation.type };
  });
  return { meshAnnotations };
}

/**
 * Builds the root-level `VRMC_vrm` object. Callers must add
 * {@link STUDIO_VRM_EXPORT_VRM_EXTENSION} to `extensionsUsed` — never to `extensionsRequired`,
 * because a required extension the studio's own GLB gate does not allowlist would make the file
 * un-importable.
 */
export function buildStudioVrmcVrmExtension(input: {
  readonly meta: StudioVrmExportMeta;
  readonly humanoidBones: StudioVrmExportHumanoidBones;
  readonly expressions?: StudioVrmExportExpressions;
  readonly firstPerson?: readonly StudioVrmExportFirstPersonAnnotation[];
  readonly context: StudioVrmExtensionContext;
}): Record<string, unknown> {
  const { context } = input;
  return {
    specVersion: STUDIO_VRM_EXPORT_SPEC_VERSION,
    meta: buildStudioVrmExportMeta(input.meta, context),
    humanoid: buildStudioVrmExportHumanoid(input.humanoidBones, context),
    expressions: buildStudioVrmExportExpressions(input.expressions, context),
    firstPerson: buildStudioVrmExportFirstPerson(input.firstPerson, context),
  };
}

/** Builds the root-level `VRMC_springBone` object, or `undefined` when nothing sways. */
export function buildStudioVrmcSpringBoneExtension(
  config: StudioVrmExportSpringBoneConfig | undefined,
  context: Pick<StudioVrmExtensionContext, "nodeCount">,
): Record<string, unknown> | undefined {
  if (config === undefined) return undefined;
  assertRecord(config, "spring-bone-invalid");

  const rawColliders = config.colliders ?? [];
  const rawColliderGroups = config.colliderGroups ?? [];
  const rawSprings = config.springs ?? [];
  if (
    !Array.isArray(rawColliders) ||
    !Array.isArray(rawColliderGroups) ||
    !Array.isArray(rawSprings)
  ) {
    throw studioVrmExportError("spring-bone-invalid");
  }
  if (rawColliders.length === 0 && rawColliderGroups.length === 0 && rawSprings.length === 0) {
    return undefined;
  }

  const colliders = rawColliders.map((collider) => {
    assertRecord(collider, "spring-bone-invalid");
    if (!isNodeIndex(collider.node, context.nodeCount)) {
      throw studioVrmExportError("spring-bone-invalid");
    }
    const offset = vector3(collider.offset, "spring-bone-invalid");
    if (!isFiniteNumber(collider.radius) || collider.radius <= 0) {
      throw studioVrmExportError("spring-bone-invalid");
    }
    if (collider.shape === "sphere") {
      return { node: collider.node, shape: { sphere: { offset, radius: collider.radius } } };
    }
    if (collider.shape === "capsule") {
      return {
        node: collider.node,
        shape: {
          capsule: {
            offset,
            radius: collider.radius,
            tail: vector3(collider.tail, "spring-bone-invalid"),
          },
        },
      };
    }
    throw studioVrmExportError("spring-bone-invalid");
  });

  const colliderGroups = rawColliderGroups.map((group) => {
    assertRecord(group, "spring-bone-invalid");
    if (!Array.isArray(group.colliders) || group.colliders.length === 0) {
      throw studioVrmExportError("spring-bone-invalid");
    }
    const indices = group.colliders.map((index: unknown) => {
      if (!isNodeIndex(index, colliders.length)) throw studioVrmExportError("spring-bone-invalid");
      return index;
    });
    return { name: optionalSpringName(group.name), colliders: indices };
  });

  const springs = rawSprings.map((spring) => {
    assertRecord(spring, "spring-bone-invalid");
    if (!Array.isArray(spring.joints) || spring.joints.length === 0) {
      throw studioVrmExportError("spring-bone-invalid");
    }
    const joints = spring.joints.map((joint: StudioVrmExportSpringJoint) => {
      assertRecord(joint, "spring-bone-invalid");
      if (!isNodeIndex(joint.node, context.nodeCount)) {
        throw studioVrmExportError("spring-bone-invalid");
      }
      if (
        !isFiniteNumber(joint.hitRadius) ||
        joint.hitRadius < 0 ||
        !isFiniteNumber(joint.stiffness) ||
        joint.stiffness < 0 ||
        !isFiniteNumber(joint.gravityPower) ||
        joint.gravityPower < 0 ||
        !isFiniteNumber(joint.dragForce) ||
        joint.dragForce < 0 ||
        joint.dragForce > 1
      ) {
        throw studioVrmExportError("spring-bone-invalid");
      }
      return {
        node: joint.node,
        hitRadius: joint.hitRadius,
        stiffness: joint.stiffness,
        gravityPower: joint.gravityPower,
        dragForce: joint.dragForce,
        gravityDir:
          joint.gravityDir === undefined ? undefined : vector3(joint.gravityDir, "spring-bone-invalid"),
      };
    });
    let groupIndices: number[] | undefined;
    if (spring.colliderGroups !== undefined) {
      if (!Array.isArray(spring.colliderGroups)) throw studioVrmExportError("spring-bone-invalid");
      groupIndices = spring.colliderGroups.map((index: unknown) => {
        if (!isNodeIndex(index, colliderGroups.length)) {
          throw studioVrmExportError("spring-bone-invalid");
        }
        return index;
      });
    }
    let center: number | undefined;
    if (spring.center !== undefined) {
      if (!isNodeIndex(spring.center, context.nodeCount)) {
        throw studioVrmExportError("spring-bone-invalid");
      }
      center = spring.center;
    }
    return {
      name: optionalSpringName(spring.name),
      joints,
      colliderGroups: groupIndices,
      center,
    };
  });

  return {
    specVersion: STUDIO_VRM_EXPORT_SPEC_VERSION,
    colliders: colliders.length > 0 ? colliders : undefined,
    colliderGroups: colliderGroups.length > 0 ? colliderGroups : undefined,
    springs: springs.length > 0 ? springs : undefined,
  };
}

function optionalSpringName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = trimmedText(value);
  if (text === null) throw studioVrmExportError("spring-bone-invalid");
  return text;
}

/** Builds the per-material `VRMC_materials_mtoon` object. */
export function buildStudioVrmcMToonExtension(
  params: StudioVrmExportMToonParams,
): Record<string, unknown> {
  assertRecord(params, "mtoon-invalid");
  const outlineWidthMode = params.outlineWidthMode;
  if (outlineWidthMode !== undefined && !OUTLINE_MODE_SET.has(outlineWidthMode)) {
    throw studioVrmExportError("mtoon-invalid");
  }
  if (
    params.renderQueueOffsetNumber !== undefined &&
    !Number.isSafeInteger(params.renderQueueOffsetNumber)
  ) {
    throw studioVrmExportError("mtoon-invalid");
  }
  if (params.transparentWithZWrite !== undefined && typeof params.transparentWithZWrite !== "boolean") {
    throw studioVrmExportError("mtoon-invalid");
  }
  return {
    specVersion: STUDIO_VRM_EXPORT_SPEC_VERSION,
    transparentWithZWrite: params.transparentWithZWrite,
    renderQueueOffsetNumber: params.renderQueueOffsetNumber,
    shadeColorFactor:
      params.shadeColorFactor === undefined
        ? undefined
        : colorTriplet(params.shadeColorFactor, "mtoon-invalid"),
    shadingShiftFactor:
      params.shadingShiftFactor === undefined
        ? undefined
        : boundedFactor(params.shadingShiftFactor, -1, 1, "mtoon-invalid"),
    shadingToonyFactor:
      params.shadingToonyFactor === undefined
        ? undefined
        : boundedFactor(params.shadingToonyFactor, 0, 1, "mtoon-invalid"),
    giEqualizationFactor:
      params.giEqualizationFactor === undefined
        ? undefined
        : boundedFactor(params.giEqualizationFactor, 0, 1, "mtoon-invalid"),
    matcapFactor:
      params.matcapFactor === undefined
        ? undefined
        : colorTriplet(params.matcapFactor, "mtoon-invalid"),
    parametricRimColorFactor:
      params.parametricRimColorFactor === undefined
        ? undefined
        : colorTriplet(params.parametricRimColorFactor, "mtoon-invalid"),
    rimLightingMixFactor:
      params.rimLightingMixFactor === undefined
        ? undefined
        : boundedFactor(params.rimLightingMixFactor, 0, 1, "mtoon-invalid"),
    parametricRimFresnelPowerFactor:
      params.parametricRimFresnelPowerFactor === undefined
        ? undefined
        : boundedFactor(params.parametricRimFresnelPowerFactor, 0, 100, "mtoon-invalid"),
    parametricRimLiftFactor:
      params.parametricRimLiftFactor === undefined
        ? undefined
        : boundedFactor(params.parametricRimLiftFactor, -1, 1, "mtoon-invalid"),
    outlineWidthMode,
    outlineWidthFactor:
      params.outlineWidthFactor === undefined
        ? undefined
        : boundedFactor(params.outlineWidthFactor, 0, 1, "mtoon-invalid"),
    outlineColorFactor:
      params.outlineColorFactor === undefined
        ? undefined
        : colorTriplet(params.outlineColorFactor, "mtoon-invalid"),
    outlineLightingMixFactor:
      params.outlineLightingMixFactor === undefined
        ? undefined
        : boundedFactor(params.outlineLightingMixFactor, 0, 1, "mtoon-invalid"),
    uvAnimationScrollXSpeedFactor:
      params.uvAnimationScrollXSpeedFactor === undefined
        ? undefined
        : boundedFactor(params.uvAnimationScrollXSpeedFactor, -100, 100, "mtoon-invalid"),
    uvAnimationScrollYSpeedFactor:
      params.uvAnimationScrollYSpeedFactor === undefined
        ? undefined
        : boundedFactor(params.uvAnimationScrollYSpeedFactor, -100, 100, "mtoon-invalid"),
    uvAnimationRotationSpeedFactor:
      params.uvAnimationRotationSpeedFactor === undefined
        ? undefined
        : boundedFactor(params.uvAnimationRotationSpeedFactor, -100, 100, "mtoon-invalid"),
  };
}
