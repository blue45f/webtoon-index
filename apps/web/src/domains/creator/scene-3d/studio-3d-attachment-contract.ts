/**
 * Renderer-neutral attachment contract shared by VRM and canonical rigged-GLB workflows.
 *
 * This module owns persistence intent only. It deliberately has no Three.js, VRM, DOM, storage,
 * network, or editor imports. Runtime adapters may read the normalized document, but renderer
 * state never becomes document authority.
 */

export const STUDIO_3D_ATTACHMENT_DOCUMENT_KIND =
  "toonspectrum.3d-attachment-document" as const;
export const STUDIO_3D_ATTACHMENT_DOCUMENT_VERSION = 1 as const;

export const STUDIO_3D_ATTACHMENT_MAX_DOCUMENT_BYTES = 128 * 1024;
export const STUDIO_3D_ATTACHMENT_MAX_NODES = 256;
export const STUDIO_3D_ATTACHMENT_MAX_CONSTRAINTS = 256;
export const STUDIO_3D_ATTACHMENT_MAX_ID_LENGTH = 80;
export const STUDIO_3D_ATTACHMENT_MAX_ANCHOR_KEY_LENGTH = 120;
export const STUDIO_3D_ATTACHMENT_MAX_LOCAL_DISTANCE = 1_000;
export const STUDIO_3D_ATTACHMENT_MIN_LOCAL_SCALE = 0.001;
export const STUDIO_3D_ATTACHMENT_MAX_LOCAL_SCALE = 1_000;

export type Studio3dAttachmentContentHash = `sha256:${string}`;
export type Studio3dAttachmentAssetKind = "vrm" | "rigged-glb" | "static-glb";
export type Studio3dAttachmentVec3 = readonly [number, number, number];
export type Studio3dAttachmentQuaternion = readonly [number, number, number, number];

export const STUDIO_3D_ATTACHMENT_HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const;

export type Studio3dAttachmentHumanoidBone =
  (typeof STUDIO_3D_ATTACHMENT_HUMANOID_BONES)[number];

export interface Studio3dAttachmentTransform {
  readonly position: Studio3dAttachmentVec3;
  /** Unit quaternion in canonical sign form (`q` and `-q` normalize to the same value). */
  readonly rotation: Studio3dAttachmentQuaternion;
  readonly scale: Studio3dAttachmentVec3;
}

/** Anchor authored inside the immutable asset metadata. */
export interface Studio3dAttachmentAssetAnchorRef {
  readonly kind: "asset";
  readonly anchorId: string;
}

/** Explicit local-space anchor for assets without authored socket metadata. */
export interface Studio3dAttachmentLocalAnchorRef {
  readonly kind: "local";
  readonly transform: Studio3dAttachmentTransform;
}

/** Semantic humanoid anchor, available to VRM and mapped humanoid rigged-GLB assets. */
export interface Studio3dAttachmentHumanoidAnchorRef {
  readonly kind: "humanoid";
  readonly bone: Studio3dAttachmentHumanoidBone;
}

/** Canonical skin/joint key, for example `skin-0:joint-12`. */
export interface Studio3dAttachmentJointAnchorRef {
  readonly kind: "joint";
  readonly jointKey: string;
}

export type Studio3dAttachmentAnchorRef =
  | Studio3dAttachmentAssetAnchorRef
  | Studio3dAttachmentLocalAnchorRef
  | Studio3dAttachmentHumanoidAnchorRef
  | Studio3dAttachmentJointAnchorRef;

export type Studio3dAttachmentDrivenAnchorRef =
  | Studio3dAttachmentAssetAnchorRef
  | Studio3dAttachmentLocalAnchorRef;

export type Studio3dAttachmentRigAnchorRef =
  | Studio3dAttachmentHumanoidAnchorRef
  | Studio3dAttachmentJointAnchorRef;

export const STUDIO_3D_ATTACHMENT_GRIP_PRESETS = [
  "none",
  "auto",
  "power",
  "precision",
  "pinch",
  "flat",
  "support",
  "wear",
] as const;

export type Studio3dAttachmentGripPresetId =
  (typeof STUDIO_3D_ATTACHMENT_GRIP_PRESETS)[number];

export interface Studio3dAttachmentGripPreset {
  readonly preset: Studio3dAttachmentGripPresetId;
  /** Blend weight for the hand-pose preset. Zero keeps the authored hand pose. */
  readonly strength: number;
}

/**
 * Optional two-hand continuation of the one-way solve:
 * primary rig anchor -> driven prop -> secondary-hand IK.
 *
 * The secondary hand never becomes a second transform authority for the prop.
 */
export interface Studio3dAttachmentSecondaryHand {
  readonly drivenAnchor: Studio3dAttachmentDrivenAnchorRef;
  readonly handAnchor: Studio3dAttachmentRigAnchorRef;
  readonly weight: number;
}

export interface Studio3dAttachmentNodeBinding {
  readonly id: string;
  readonly assetKind: Studio3dAttachmentAssetKind;
  readonly contentHash: Studio3dAttachmentContentHash;
  /**
   * Hash of the canonical joint order, parent graph, rest transforms, and humanoid mapping.
   * Required for VRM/rigged GLB and forbidden for static GLB.
   */
  readonly skeletonHash?: Studio3dAttachmentContentHash;
}

export interface Studio3dAttachmentConstraint {
  readonly id: string;
  /** Prop/accessory node whose world transform is owned by the attachment solver. */
  readonly drivenNodeId: string;
  /** Character or scene node that provides the primary anchor. */
  readonly targetNodeId: string;
  readonly drivenAnchor: Studio3dAttachmentDrivenAnchorRef;
  readonly targetAnchor: Studio3dAttachmentAnchorRef;
  /** Fine adjustment applied after aligning the two anchor bases. */
  readonly offset: Studio3dAttachmentTransform;
  readonly grip: Studio3dAttachmentGripPreset;
  readonly secondaryHand?: Studio3dAttachmentSecondaryHand;
  readonly enabled: boolean;
  readonly weight: number;
  /** Persisted intent is always document-owned; runtime writers cannot claim this field. */
  readonly authority: "attachment-document";
}

export type Studio3dAttachmentAuthority =
  | "attachment-document"
  | "rig-runtime"
  | "attachment-solver"
  | "secondary-hand-ik";

export type Studio3dAttachmentAuthorityChannel =
  | "constraint-intent"
  | "target-pose"
  | "driven-world-transform"
  | "secondary-hand-pose";

export interface Studio3dAttachmentAuthorityPolicy {
  readonly constraintIntent: "attachment-document";
  readonly targetPose: "rig-runtime";
  readonly drivenWorldTransform: "attachment-solver";
  readonly secondaryHandPose: "secondary-hand-ik";
  readonly feedback: "forbidden";
}

export const STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY: Studio3dAttachmentAuthorityPolicy =
  Object.freeze({
    constraintIntent: "attachment-document",
    targetPose: "rig-runtime",
    drivenWorldTransform: "attachment-solver",
    secondaryHandPose: "secondary-hand-ik",
    feedback: "forbidden",
  });

export interface Studio3dAttachmentDocument {
  readonly kind: typeof STUDIO_3D_ATTACHMENT_DOCUMENT_KIND;
  readonly version: typeof STUDIO_3D_ATTACHMENT_DOCUMENT_VERSION;
  readonly authority: Studio3dAttachmentAuthorityPolicy;
  readonly nodes: readonly Studio3dAttachmentNodeBinding[];
  readonly constraints: readonly Studio3dAttachmentConstraint[];
}

export interface Studio3dAttachmentRuntimeNodeIdentity {
  readonly nodeId: string;
  readonly contentHash: Studio3dAttachmentContentHash;
  readonly skeletonHash?: Studio3dAttachmentContentHash;
}

export type Studio3dAttachmentBindingIssueCode =
  | "invalid-document"
  | "invalid-runtime-node"
  | "duplicate-runtime-node"
  | "missing-runtime-node"
  | "content-hash-mismatch"
  | "skeleton-hash-missing"
  | "skeleton-hash-mismatch";

export interface Studio3dAttachmentBindingIssue {
  readonly code: Studio3dAttachmentBindingIssueCode;
  readonly nodeId?: string;
  readonly runtimeIndex?: number;
}

export type Studio3dAttachmentBindingValidation =
  | {
      readonly ok: true;
      readonly issues: readonly Studio3dAttachmentBindingIssue[];
      readonly validatedNodeIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly Studio3dAttachmentBindingIssue[];
      readonly validatedNodeIds: readonly string[];
    };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u;
const ANCHOR_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/~-]*$/u;
const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/iu;
const HUMANOID_BONES = new Set<string>(STUDIO_3D_ATTACHMENT_HUMANOID_BONES);
const ASSET_KINDS = new Set<string>(["vrm", "rigged-glb", "static-glb"]);
const GRIP_PRESETS = new Set<string>(STUDIO_3D_ATTACHMENT_GRIP_PRESETS);
const RECORD_PROPERTY_LIMIT = 16;

type DataRecord = Readonly<Record<string, unknown>>;

function snapshotPlainRecord(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > RECORD_PROPERTY_LIMIT) return null;

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function hasOnlyKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function snapshotDenseArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < minimumLength ||
    length > maximumLength
  ) {
    return null;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== length + 1 ||
    ownKeys.some((key) => {
      if (key === "length") return false;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= length;
    })
  ) {
    return null;
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function canonicalId(value: unknown, maximumLength = STUDIO_3D_ATTACHMENT_MAX_ID_LENGTH): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    !ID_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function canonicalAnchorKey(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > STUDIO_3D_ATTACHMENT_MAX_ANCHOR_KEY_LENGTH ||
    value.trim() !== value ||
    !ANCHOR_KEY_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function canonicalHash(value: unknown): Studio3dAttachmentContentHash | null {
  if (typeof value !== "string") return null;
  const match = SHA256_PATTERN.exec(value.trim());
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}

function boundedFinite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? Object.is(value, -0)
      ? 0
      : value
    : null;
}

function normalizeVec3(
  value: unknown,
  minimum: number,
  maximum: number,
): Studio3dAttachmentVec3 | null {
  const values = snapshotDenseArray(value, 3, 3);
  if (!values) return null;
  const x = boundedFinite(values[0], minimum, maximum);
  const y = boundedFinite(values[1], minimum, maximum);
  const z = boundedFinite(values[2], minimum, maximum);
  return x === null || y === null || z === null ? null : Object.freeze([x, y, z]);
}

function canonicalQuaternionSign(
  value: Studio3dAttachmentQuaternion,
): Studio3dAttachmentQuaternion {
  const signProbe = value[3] !== 0
    ? value[3]
    : value[0] !== 0
      ? value[0]
      : value[1] !== 0
        ? value[1]
        : value[2];
  if (signProbe >= 0) return value;
  return Object.freeze(value.map((component) => component === 0 ? 0 : -component)) as
    Studio3dAttachmentQuaternion;
}

function normalizeQuaternion(value: unknown): Studio3dAttachmentQuaternion | null {
  const values = snapshotDenseArray(value, 4, 4);
  if (!values) return null;
  const components = values.map((component) => boundedFinite(component, -1_000_000, 1_000_000));
  if (components.some((component) => component === null)) return null;

  const [x, y, z, w] = components as [number, number, number, number];
  const magnitude = Math.hypot(x, y, z, w);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return null;

  const normalized = Object.freeze(
    [x / magnitude, y / magnitude, z / magnitude, w / magnitude].map((component) =>
      Object.is(component, -0) ? 0 : component),
  ) as Studio3dAttachmentQuaternion;
  return canonicalQuaternionSign(normalized);
}

function normalizeTransform(value: unknown): Studio3dAttachmentTransform | null {
  const record = snapshotPlainRecord(value);
  if (!record || !hasOnlyKeys(record, ["position", "rotation", "scale"])) return null;
  const position = normalizeVec3(
    record.position,
    -STUDIO_3D_ATTACHMENT_MAX_LOCAL_DISTANCE,
    STUDIO_3D_ATTACHMENT_MAX_LOCAL_DISTANCE,
  );
  const rotation = normalizeQuaternion(record.rotation);
  const scale = normalizeVec3(
    record.scale,
    STUDIO_3D_ATTACHMENT_MIN_LOCAL_SCALE,
    STUDIO_3D_ATTACHMENT_MAX_LOCAL_SCALE,
  );
  if (!position || !rotation || !scale) return null;
  return Object.freeze({ position, rotation, scale });
}

function normalizeAnchor(value: unknown): Studio3dAttachmentAnchorRef | null {
  const record = snapshotPlainRecord(value);
  if (!record || typeof record.kind !== "string") return null;

  if (record.kind === "asset") {
    if (!hasOnlyKeys(record, ["kind", "anchorId"])) return null;
    const anchorId = canonicalAnchorKey(record.anchorId);
    return anchorId ? Object.freeze({ kind: "asset", anchorId }) : null;
  }
  if (record.kind === "local") {
    if (!hasOnlyKeys(record, ["kind", "transform"])) return null;
    const transform = normalizeTransform(record.transform);
    return transform ? Object.freeze({ kind: "local", transform }) : null;
  }
  if (record.kind === "humanoid") {
    if (
      !hasOnlyKeys(record, ["kind", "bone"]) ||
      typeof record.bone !== "string" ||
      !HUMANOID_BONES.has(record.bone)
    ) {
      return null;
    }
    return Object.freeze({
      kind: "humanoid",
      bone: record.bone as Studio3dAttachmentHumanoidBone,
    });
  }
  if (record.kind === "joint") {
    if (!hasOnlyKeys(record, ["kind", "jointKey"])) return null;
    const jointKey = canonicalAnchorKey(record.jointKey);
    return jointKey ? Object.freeze({ kind: "joint", jointKey }) : null;
  }
  return null;
}

function isDrivenAnchor(
  value: Studio3dAttachmentAnchorRef,
): value is Studio3dAttachmentDrivenAnchorRef {
  return value.kind === "asset" || value.kind === "local";
}

function isRigAnchor(value: Studio3dAttachmentAnchorRef): value is Studio3dAttachmentRigAnchorRef {
  return value.kind === "humanoid" || value.kind === "joint";
}

function normalizeGrip(value: unknown): Studio3dAttachmentGripPreset | null {
  const record = snapshotPlainRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, ["preset", "strength"]) ||
    typeof record.preset !== "string" ||
    !GRIP_PRESETS.has(record.preset)
  ) {
    return null;
  }
  const strength = boundedFinite(record.strength, 0, 1);
  return strength === null
    ? null
    : Object.freeze({
        preset: record.preset as Studio3dAttachmentGripPresetId,
        strength,
      });
}

function normalizeSecondaryHand(value: unknown): Studio3dAttachmentSecondaryHand | null {
  const record = snapshotPlainRecord(value);
  if (!record || !hasOnlyKeys(record, ["drivenAnchor", "handAnchor", "weight"])) return null;
  const drivenAnchor = normalizeAnchor(record.drivenAnchor);
  const handAnchor = normalizeAnchor(record.handAnchor);
  const weight = boundedFinite(record.weight, 0, 1);
  if (!drivenAnchor || !isDrivenAnchor(drivenAnchor) || !handAnchor || !isRigAnchor(handAnchor)) {
    return null;
  }
  if (
    handAnchor.kind === "humanoid" &&
    handAnchor.bone !== "leftHand" &&
    handAnchor.bone !== "rightHand"
  ) {
    return null;
  }
  return weight === null ? null : Object.freeze({ drivenAnchor, handAnchor, weight });
}

function normalizeNode(value: unknown): Studio3dAttachmentNodeBinding | null {
  const record = snapshotPlainRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, ["id", "assetKind", "contentHash"], ["skeletonHash"])
  ) {
    return null;
  }
  const id = canonicalId(record.id);
  const contentHash = canonicalHash(record.contentHash);
  const assetKind = typeof record.assetKind === "string" && ASSET_KINDS.has(record.assetKind)
    ? record.assetKind as Studio3dAttachmentAssetKind
    : null;
  const hasSkeletonHash = Object.prototype.hasOwnProperty.call(record, "skeletonHash");
  const skeletonHash = hasSkeletonHash ? canonicalHash(record.skeletonHash) : null;
  if (!id || !contentHash || !assetKind) return null;
  if (assetKind === "static-glb" ? hasSkeletonHash : !skeletonHash) return null;

  return Object.freeze({
    id,
    assetKind,
    contentHash,
    ...(skeletonHash ? { skeletonHash } : {}),
  });
}

function normalizeConstraint(value: unknown): Studio3dAttachmentConstraint | null {
  const record = snapshotPlainRecord(value);
  if (
    !record ||
    !hasOnlyKeys(
      record,
      [
        "id",
        "drivenNodeId",
        "targetNodeId",
        "drivenAnchor",
        "targetAnchor",
        "offset",
        "grip",
        "enabled",
        "weight",
        "authority",
      ],
      ["secondaryHand"],
    ) ||
    record.authority !== "attachment-document" ||
    typeof record.enabled !== "boolean"
  ) {
    return null;
  }

  const id = canonicalId(record.id);
  const drivenNodeId = canonicalId(record.drivenNodeId);
  const targetNodeId = canonicalId(record.targetNodeId);
  const drivenAnchor = normalizeAnchor(record.drivenAnchor);
  const targetAnchor = normalizeAnchor(record.targetAnchor);
  const offset = normalizeTransform(record.offset);
  const grip = normalizeGrip(record.grip);
  const weight = boundedFinite(record.weight, 0, 1);
  const hasSecondary = Object.prototype.hasOwnProperty.call(record, "secondaryHand");
  const secondaryHand = hasSecondary ? normalizeSecondaryHand(record.secondaryHand) : null;

  if (
    !id ||
    !drivenNodeId ||
    !targetNodeId ||
    drivenNodeId === targetNodeId ||
    !drivenAnchor ||
    !isDrivenAnchor(drivenAnchor) ||
    !targetAnchor ||
    !offset ||
    !grip ||
    weight === null ||
    (hasSecondary && !secondaryHand)
  ) {
    return null;
  }

  return Object.freeze({
    id,
    drivenNodeId,
    targetNodeId,
    drivenAnchor,
    targetAnchor,
    offset,
    grip,
    ...(secondaryHand ? { secondaryHand } : {}),
    enabled: record.enabled,
    weight,
    authority: "attachment-document",
  });
}

function normalizeAuthority(value: unknown): Studio3dAttachmentAuthorityPolicy | null {
  const record = snapshotPlainRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, [
      "constraintIntent",
      "targetPose",
      "drivenWorldTransform",
      "secondaryHandPose",
      "feedback",
    ]) ||
    record.constraintIntent !== "attachment-document" ||
    record.targetPose !== "rig-runtime" ||
    record.drivenWorldTransform !== "attachment-solver" ||
    record.secondaryHandPose !== "secondary-hand-ik" ||
    record.feedback !== "forbidden"
  ) {
    return null;
  }
  return STUDIO_3D_ATTACHMENT_ONE_WAY_AUTHORITY;
}

function anchorsEqual(
  first: Studio3dAttachmentAnchorRef,
  second: Studio3dAttachmentAnchorRef,
): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === "asset" && second.kind === "asset") return first.anchorId === second.anchorId;
  if (first.kind === "humanoid" && second.kind === "humanoid") return first.bone === second.bone;
  if (first.kind === "joint" && second.kind === "joint") return first.jointKey === second.jointKey;
  if (first.kind !== "local" || second.kind !== "local") return false;
  return (
    first.transform.position.every((value, index) => value === second.transform.position[index]) &&
    first.transform.rotation.every((value, index) => value === second.transform.rotation[index]) &&
    first.transform.scale.every((value, index) => value === second.transform.scale[index])
  );
}

function hasAttachmentCycle(
  constraints: readonly Studio3dAttachmentConstraint[],
): boolean {
  const targetByDriven = new Map(
    constraints.map((constraint) => [constraint.drivenNodeId, constraint.targetNodeId] as const),
  );
  for (const startNodeId of targetByDriven.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = startNodeId;
    while (cursor !== undefined) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = targetByDriven.get(cursor);
    }
  }
  return false;
}

function normalizeDecodedDocument(value: unknown): Studio3dAttachmentDocument | null {
  const record = snapshotPlainRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, ["kind", "version", "authority", "nodes", "constraints"]) ||
    record.kind !== STUDIO_3D_ATTACHMENT_DOCUMENT_KIND ||
    record.version !== STUDIO_3D_ATTACHMENT_DOCUMENT_VERSION
  ) {
    return null;
  }
  const authority = normalizeAuthority(record.authority);
  const rawNodes = snapshotDenseArray(record.nodes, 0, STUDIO_3D_ATTACHMENT_MAX_NODES);
  const rawConstraints = snapshotDenseArray(
    record.constraints,
    0,
    STUDIO_3D_ATTACHMENT_MAX_CONSTRAINTS,
  );
  if (!authority || !rawNodes || !rawConstraints) return null;

  const nodes: Studio3dAttachmentNodeBinding[] = [];
  const nodeIds = new Set<string>();
  for (const candidate of rawNodes) {
    const node = normalizeNode(candidate);
    if (!node || nodeIds.has(node.id)) return null;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const constraints: Studio3dAttachmentConstraint[] = [];
  const constraintIds = new Set<string>();
  const drivenNodeIds = new Set<string>();
  for (const candidate of rawConstraints) {
    const constraint = normalizeConstraint(candidate);
    if (
      !constraint ||
      constraintIds.has(constraint.id) ||
      drivenNodeIds.has(constraint.drivenNodeId) ||
      !nodeById.has(constraint.drivenNodeId) ||
      !nodeById.has(constraint.targetNodeId)
    ) {
      return null;
    }

    const targetNode = nodeById.get(constraint.targetNodeId);
    const targetNeedsSkeleton =
      isRigAnchor(constraint.targetAnchor) || constraint.secondaryHand !== undefined;
    if (targetNeedsSkeleton && !targetNode?.skeletonHash) return null;
    if (
      constraint.secondaryHand &&
      (
        anchorsEqual(constraint.drivenAnchor, constraint.secondaryHand.drivenAnchor) ||
        anchorsEqual(constraint.targetAnchor, constraint.secondaryHand.handAnchor)
      )
    ) {
      return null;
    }

    constraintIds.add(constraint.id);
    drivenNodeIds.add(constraint.drivenNodeId);
    constraints.push(constraint);
  }
  if (hasAttachmentCycle(constraints)) return null;

  return Object.freeze({
    kind: STUDIO_3D_ATTACHMENT_DOCUMENT_KIND,
    version: STUDIO_3D_ATTACHMENT_DOCUMENT_VERSION,
    authority,
    nodes: Object.freeze(nodes),
    constraints: Object.freeze(constraints),
  });
}

/**
 * Strict object normalizer. Unknown keys, accessors, sparse arrays, invalid references, duplicate
 * IDs/driven nodes, self-links, and longer dependency cycles are rejected rather than repaired.
 */
export function normalizeStudio3dAttachmentDocument(
  value: unknown,
): Studio3dAttachmentDocument | null {
  return normalizeDecodedDocument(value);
}

/** Parses bounded JSON and then applies the same strict canonical normalizer. */
export function parseStudio3dAttachmentDocument(
  raw: string,
): Studio3dAttachmentDocument | null {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > STUDIO_3D_ATTACHMENT_MAX_DOCUMENT_BYTES) {
    return null;
  }
  let decoded: unknown;
  try {
    if (new TextEncoder().encode(raw).byteLength > STUDIO_3D_ATTACHMENT_MAX_DOCUMENT_BYTES) {
      return null;
    }
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return normalizeDecodedDocument(decoded);
}

/**
 * Runtime identity gate. Every node used by a constraint must still resolve to the exact asset and
 * skeleton used when authoring the binding. A mismatch never falls back to node name or joint
 * ordinal, because doing so can silently attach a prop to the wrong body part.
 */
export function validateStudio3dAttachmentBindings(
  document: unknown,
  runtimeNodes: unknown,
): Studio3dAttachmentBindingValidation {
  const normalizedDocument = normalizeStudio3dAttachmentDocument(document);
  if (!normalizedDocument) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([{ code: "invalid-document" as const }]),
      validatedNodeIds: Object.freeze([]),
    });
  }

  const rawRuntimeNodes = snapshotDenseArray(
    runtimeNodes,
    0,
    STUDIO_3D_ATTACHMENT_MAX_NODES,
  );
  if (!rawRuntimeNodes) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([{ code: "invalid-runtime-node" as const }]),
      validatedNodeIds: Object.freeze([]),
    });
  }

  const runtimeById = new Map<string, Studio3dAttachmentRuntimeNodeIdentity>();
  const issues: Studio3dAttachmentBindingIssue[] = [];
  for (let index = 0; index < rawRuntimeNodes.length; index += 1) {
    const record = snapshotPlainRecord(rawRuntimeNodes[index]);
    if (!record || !hasOnlyKeys(record, ["nodeId", "contentHash"], ["skeletonHash"])) {
      issues.push(Object.freeze({ code: "invalid-runtime-node", runtimeIndex: index }));
      continue;
    }
    const nodeId = canonicalId(record.nodeId);
    const contentHash = canonicalHash(record.contentHash);
    const hasSkeletonHash = Object.prototype.hasOwnProperty.call(record, "skeletonHash");
    const skeletonHash = hasSkeletonHash ? canonicalHash(record.skeletonHash) : null;
    if (!nodeId || !contentHash || (hasSkeletonHash && !skeletonHash)) {
      issues.push(Object.freeze({ code: "invalid-runtime-node", runtimeIndex: index }));
      continue;
    }
    if (runtimeById.has(nodeId)) {
      issues.push(Object.freeze({ code: "duplicate-runtime-node", nodeId, runtimeIndex: index }));
      continue;
    }
    runtimeById.set(
      nodeId,
      Object.freeze({
        nodeId,
        contentHash,
        ...(skeletonHash ? { skeletonHash } : {}),
      }),
    );
  }

  const referencedNodeIds = new Set<string>();
  for (const constraint of normalizedDocument.constraints) {
    referencedNodeIds.add(constraint.targetNodeId);
    referencedNodeIds.add(constraint.drivenNodeId);
  }
  const authoredById = new Map(
    normalizedDocument.nodes.map((node) => [node.id, node] as const),
  );
  for (const nodeId of referencedNodeIds) {
    const expected = authoredById.get(nodeId);
    const current = runtimeById.get(nodeId);
    if (!expected || !current) {
      issues.push(Object.freeze({ code: "missing-runtime-node", nodeId }));
      continue;
    }
    if (expected.contentHash !== current.contentHash) {
      issues.push(Object.freeze({ code: "content-hash-mismatch", nodeId }));
      continue;
    }
    if (expected.skeletonHash && !current.skeletonHash) {
      issues.push(Object.freeze({ code: "skeleton-hash-missing", nodeId }));
      continue;
    }
    if (expected.skeletonHash !== current.skeletonHash) {
      issues.push(Object.freeze({ code: "skeleton-hash-mismatch", nodeId }));
    }
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze(issues),
      validatedNodeIds: Object.freeze([]),
    });
  }
  return Object.freeze({
    ok: true,
    issues: Object.freeze([]),
    validatedNodeIds: Object.freeze([...referencedNodeIds]),
  });
}

/** Only the declared authority may write a channel; all reverse/sideways writes fail closed. */
export function canStudio3dAttachmentAuthorityWrite(
  authority: Studio3dAttachmentAuthority,
  channel: Studio3dAttachmentAuthorityChannel,
): boolean {
  switch (channel) {
    case "constraint-intent":
      return authority === "attachment-document";
    case "target-pose":
      return authority === "rig-runtime";
    case "driven-world-transform":
      return authority === "attachment-solver";
    case "secondary-hand-pose":
      return authority === "secondary-hand-ik";
  }
}

/**
 * Allowed one-way data dependencies. Notably, secondary IK cannot feed the prop transform back,
 * and the attachment solver cannot overwrite the primary rig pose or persisted constraint.
 */
export function isStudio3dAttachmentAuthorityFlowAllowed(
  source: Studio3dAttachmentAuthority,
  consumer: Studio3dAttachmentAuthority,
): boolean {
  return (
    (source === "attachment-document" && consumer === "attachment-solver") ||
    (source === "rig-runtime" && consumer === "attachment-solver") ||
    (source === "attachment-solver" && consumer === "secondary-hand-ik")
  );
}
