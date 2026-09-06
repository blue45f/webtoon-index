/**
 * Pure rigid-transform solver for the canonical Studio 3D attachment contract.
 *
 * Runtime adapters resolve asset/humanoid/joint references into socket transforms before entering
 * this boundary. The solver never imports a renderer, mutates a rig, or writes document state.
 */

import {
  STUDIO_3D_ATTACHMENT_MAX_ID_LENGTH,
  normalizeStudio3dAttachmentDocument,
  validateStudio3dAttachmentBindings,
  type Studio3dAttachmentBindingIssue,
  type Studio3dAttachmentConstraint,
  type Studio3dAttachmentQuaternion,
  type Studio3dAttachmentTransform,
  type Studio3dAttachmentVec3,
} from "./studio-3d-attachment-contract";

export const STUDIO_3D_ATTACHMENT_SOLVER_MAX_WORLD_DISTANCE = 1_000_000;
export const STUDIO_3D_ATTACHMENT_SOLVER_MIN_UNIFORM_SCALE = 0.000_001;
export const STUDIO_3D_ATTACHMENT_SOLVER_MAX_UNIFORM_SCALE = 1_000_000;
export const STUDIO_3D_ATTACHMENT_SOLVER_SCALE_RELATIVE_EPSILON = 1e-6;
export const STUDIO_3D_ATTACHMENT_SOLVER_QUATERNION_EPSILON = 1e-8;

export interface Studio3dAttachmentSolveRequest {
  readonly document: unknown;
  readonly constraintId: string;
  readonly runtimeNodes: unknown;
  /** Resolved world transform of the primary target socket. */
  readonly primarySocketWorld: unknown;
  /** Resolved local transform of the prop's primary authored/local anchor. */
  readonly propAnchorLocal: unknown;
  /** Required exactly when the constraint declares `secondaryHand`. */
  readonly secondaryPropAnchorLocal?: unknown;
}

export type Studio3dAttachmentSolveFailureCode =
  | "invalid-document"
  | "constraint-not-found"
  | "invalid-binding-set"
  | "missing-node-binding"
  | "stale-content-binding"
  | "stale-skeleton-binding"
  | "invalid-primary-socket"
  | "invalid-prop-anchor"
  | "missing-secondary-prop-anchor"
  | "unexpected-secondary-prop-anchor"
  | "invalid-secondary-prop-anchor"
  | "non-uniform-scale"
  | "invalid-scale"
  | "degenerate-quaternion"
  | "numeric-overflow";

export interface Studio3dAttachmentSolveFailure {
  readonly ok: false;
  readonly code: Studio3dAttachmentSolveFailureCode;
  readonly constraintId?: string;
  readonly bindingIssues?: readonly Studio3dAttachmentBindingIssue[];
}

export interface Studio3dAttachmentSolveSuccess {
  readonly ok: true;
  readonly constraintId: string;
  /** Canonical rigid world transform to apply to the prop node. */
  readonly propWorld: Studio3dAttachmentTransform;
  /** World target consumed by opposite-hand IK; it never becomes prop transform authority. */
  readonly secondaryHandIkTargetWorld?: Studio3dAttachmentTransform;
}

export type Studio3dAttachmentSolveResult =
  | Studio3dAttachmentSolveFailure
  | Studio3dAttachmentSolveSuccess;

type TransformFailureCode =
  | "invalid"
  | "non-uniform-scale"
  | "invalid-scale"
  | "degenerate-quaternion";

type TransformParseResult =
  | { readonly ok: true; readonly transform: Studio3dAttachmentTransform }
  | { readonly ok: false; readonly code: TransformFailureCode };

type DataRecord = Readonly<Record<string, unknown>>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u;
const RECORD_KEYS = Object.freeze(["position", "rotation", "scale"]);

function failure(
  code: Studio3dAttachmentSolveFailureCode,
  constraintId?: string,
  bindingIssues?: readonly Studio3dAttachmentBindingIssue[],
): Studio3dAttachmentSolveFailure {
  return Object.freeze({
    ok: false,
    code,
    ...(constraintId ? { constraintId } : {}),
    ...(bindingIssues ? { bindingIssues: Object.freeze([...bindingIssues]) } : {}),
  });
}

function snapshotTransformRecord(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== RECORD_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !RECORD_KEYS.includes(key))
  ) {
    return null;
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
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

function snapshotNumericTuple(value: unknown, length: 3 | 4): readonly number[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== length) {
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

  const result: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof descriptor.value !== "number" ||
      !Number.isFinite(descriptor.value)
    ) {
      return null;
    }
    result.push(Object.is(descriptor.value, -0) ? 0 : descriptor.value);
  }
  return Object.freeze(result);
}

function canonicalQuaternionSign(
  quaternion: Studio3dAttachmentQuaternion,
): Studio3dAttachmentQuaternion {
  const signProbe = quaternion[3] !== 0
    ? quaternion[3]
    : quaternion[0] !== 0
      ? quaternion[0]
      : quaternion[1] !== 0
        ? quaternion[1]
        : quaternion[2];
  if (signProbe >= 0) return quaternion;
  return Object.freeze(
    quaternion.map((component) => component === 0 ? 0 : -component),
  ) as Studio3dAttachmentQuaternion;
}

function normalizeQuaternion(value: unknown): Studio3dAttachmentQuaternion | null {
  const tuple = snapshotNumericTuple(value, 4);
  if (!tuple) return null;
  const magnitude = Math.hypot(tuple[0]!, tuple[1]!, tuple[2]!, tuple[3]!);
  if (!Number.isFinite(magnitude) || magnitude < STUDIO_3D_ATTACHMENT_SOLVER_QUATERNION_EPSILON) {
    return null;
  }
  const normalized = Object.freeze(tuple.map((component) => {
    const result = component / magnitude;
    return Object.is(result, -0) ? 0 : result;
  })) as Studio3dAttachmentQuaternion;
  return canonicalQuaternionSign(normalized);
}

function uniformScale(value: unknown): { ok: true; scale: number } | {
  ok: false;
  code: "invalid-scale" | "non-uniform-scale";
} {
  const tuple = snapshotNumericTuple(value, 3);
  if (!tuple) return { ok: false, code: "invalid-scale" };
  if (tuple.some((component) =>
    component < STUDIO_3D_ATTACHMENT_SOLVER_MIN_UNIFORM_SCALE ||
    component > STUDIO_3D_ATTACHMENT_SOLVER_MAX_UNIFORM_SCALE)) {
    return { ok: false, code: "invalid-scale" };
  }
  const maximum = Math.max(tuple[0]!, tuple[1]!, tuple[2]!);
  const minimum = Math.min(tuple[0]!, tuple[1]!, tuple[2]!);
  if (
    maximum - minimum >
    Math.max(1, maximum) * STUDIO_3D_ATTACHMENT_SOLVER_SCALE_RELATIVE_EPSILON
  ) {
    return { ok: false, code: "non-uniform-scale" };
  }
  return { ok: true, scale: (tuple[0]! + tuple[1]! + tuple[2]!) / 3 };
}

function parseRigidTransform(value: unknown): TransformParseResult {
  const record = snapshotTransformRecord(value);
  if (!record) return { ok: false, code: "invalid" };
  const positionTuple = snapshotNumericTuple(record.position, 3);
  if (
    !positionTuple ||
    positionTuple.some((component) =>
      Math.abs(component) > STUDIO_3D_ATTACHMENT_SOLVER_MAX_WORLD_DISTANCE)
  ) {
    return { ok: false, code: "invalid" };
  }
  const rotation = normalizeQuaternion(record.rotation);
  if (!rotation) return { ok: false, code: "degenerate-quaternion" };
  const scaleResult = uniformScale(record.scale);
  if (!scaleResult.ok) return scaleResult;
  const scale = scaleResult.scale;
  return {
    ok: true,
    transform: Object.freeze({
      position: Object.freeze([
        positionTuple[0]!,
        positionTuple[1]!,
        positionTuple[2]!,
      ]) as Studio3dAttachmentVec3,
      rotation,
      scale: Object.freeze([scale, scale, scale]) as Studio3dAttachmentVec3,
    }),
  };
}

function multiplyQuaternions(
  first: Studio3dAttachmentQuaternion,
  second: Studio3dAttachmentQuaternion,
): Studio3dAttachmentQuaternion | null {
  const [ax, ay, az, aw] = first;
  const [bx, by, bz, bw] = second;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function rotateVector(
  quaternion: Studio3dAttachmentQuaternion,
  vector: Studio3dAttachmentVec3,
): Studio3dAttachmentVec3 | null {
  const [qx, qy, qz, qw] = quaternion;
  const [vx, vy, vz] = vector;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const result = [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
  if (
    result.some((component) =>
      !Number.isFinite(component) ||
      Math.abs(component) > STUDIO_3D_ATTACHMENT_SOLVER_MAX_WORLD_DISTANCE)
  ) {
    return null;
  }
  return Object.freeze(result.map((component) =>
    Object.is(component, -0) ? 0 : component)) as Studio3dAttachmentVec3;
}

function scalarScale(transform: Studio3dAttachmentTransform): number {
  return transform.scale[0];
}

function composeRigidTransforms(
  parent: Studio3dAttachmentTransform,
  child: Studio3dAttachmentTransform,
): Studio3dAttachmentTransform | null {
  const parentScale = scalarScale(parent);
  const childScale = scalarScale(child);
  const scale = parentScale * childScale;
  if (
    !Number.isFinite(scale) ||
    scale < STUDIO_3D_ATTACHMENT_SOLVER_MIN_UNIFORM_SCALE ||
    scale > STUDIO_3D_ATTACHMENT_SOLVER_MAX_UNIFORM_SCALE
  ) {
    return null;
  }

  const scaledChildPosition = Object.freeze(child.position.map((component) =>
    component * parentScale)) as Studio3dAttachmentVec3;
  const rotatedChildPosition = rotateVector(parent.rotation, scaledChildPosition);
  const rotation = multiplyQuaternions(parent.rotation, child.rotation);
  if (!rotatedChildPosition || !rotation) return null;

  const position = parent.position.map((component, index) =>
    component + rotatedChildPosition[index]!) as [number, number, number];
  if (
    position.some((component) =>
      !Number.isFinite(component) ||
      Math.abs(component) > STUDIO_3D_ATTACHMENT_SOLVER_MAX_WORLD_DISTANCE)
  ) {
    return null;
  }
  return Object.freeze({
    position: Object.freeze(position.map((component) =>
      Object.is(component, -0) ? 0 : component)) as Studio3dAttachmentVec3,
    rotation,
    scale: Object.freeze([scale, scale, scale]) as Studio3dAttachmentVec3,
  });
}

function invertRigidTransform(
  transform: Studio3dAttachmentTransform,
): Studio3dAttachmentTransform | null {
  const scale = scalarScale(transform);
  const inverseScale = 1 / scale;
  if (
    !Number.isFinite(inverseScale) ||
    inverseScale < STUDIO_3D_ATTACHMENT_SOLVER_MIN_UNIFORM_SCALE ||
    inverseScale > STUDIO_3D_ATTACHMENT_SOLVER_MAX_UNIFORM_SCALE
  ) {
    return null;
  }
  const inverseRotation = canonicalQuaternionSign(Object.freeze([
    -transform.rotation[0],
    -transform.rotation[1],
    -transform.rotation[2],
    transform.rotation[3],
  ]));
  const negativePosition = Object.freeze(transform.position.map((component) =>
    -component)) as Studio3dAttachmentVec3;
  const rotatedPosition = rotateVector(inverseRotation, negativePosition);
  if (!rotatedPosition) return null;
  const position = rotatedPosition.map((component) => component * inverseScale);
  if (
    position.some((component) =>
      !Number.isFinite(component) ||
      Math.abs(component) > STUDIO_3D_ATTACHMENT_SOLVER_MAX_WORLD_DISTANCE)
  ) {
    return null;
  }
  return Object.freeze({
    position: Object.freeze(position.map((component) =>
      Object.is(component, -0) ? 0 : component)) as Studio3dAttachmentVec3,
    rotation: inverseRotation,
    scale: Object.freeze([
      inverseScale,
      inverseScale,
      inverseScale,
    ]) as Studio3dAttachmentVec3,
  });
}

function mappedTransformFailure(
  parsed: TransformParseResult,
  invalidCode:
    | "invalid-primary-socket"
    | "invalid-prop-anchor"
    | "invalid-secondary-prop-anchor",
  constraintId: string,
): Studio3dAttachmentSolveFailure {
  if (parsed.ok) return failure("numeric-overflow", constraintId);
  if (parsed.code === "non-uniform-scale") return failure("non-uniform-scale", constraintId);
  if (parsed.code === "invalid-scale") return failure("invalid-scale", constraintId);
  if (parsed.code === "degenerate-quaternion") {
    return failure("degenerate-quaternion", constraintId);
  }
  return failure(invalidCode, constraintId);
}

function bindingFailure(
  constraintId: string,
  issues: readonly Studio3dAttachmentBindingIssue[],
): Studio3dAttachmentSolveFailure {
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has("invalid-document")) return failure("invalid-document", constraintId, issues);
  if (codes.has("invalid-runtime-node") || codes.has("duplicate-runtime-node")) {
    return failure("invalid-binding-set", constraintId, issues);
  }
  if (codes.has("missing-runtime-node")) {
    return failure("missing-node-binding", constraintId, issues);
  }
  if (codes.has("content-hash-mismatch")) {
    return failure("stale-content-binding", constraintId, issues);
  }
  return failure("stale-skeleton-binding", constraintId, issues);
}

function findConstraint(
  constraints: readonly Studio3dAttachmentConstraint[],
  constraintId: string,
): Studio3dAttachmentConstraint | null {
  return constraints.find((constraint) => constraint.id === constraintId) ?? null;
}

/**
 * Computes:
 *
 * `propWorld = primarySocketWorld × constraintOffset × inverse(propAnchorLocal)`
 *
 * and, for two-hand constraints:
 *
 * `secondaryHandIkTargetWorld = propWorld × secondaryPropAnchorLocal`
 */
export function solveStudio3dAttachment(
  request: Studio3dAttachmentSolveRequest,
): Studio3dAttachmentSolveResult {
  const document = normalizeStudio3dAttachmentDocument(request.document);
  if (!document) return failure("invalid-document");
  if (
    typeof request.constraintId !== "string" ||
    request.constraintId.length < 1 ||
    request.constraintId.length > STUDIO_3D_ATTACHMENT_MAX_ID_LENGTH ||
    !ID_PATTERN.test(request.constraintId)
  ) {
    return failure("constraint-not-found");
  }

  const constraint = findConstraint(document.constraints, request.constraintId);
  if (!constraint) return failure("constraint-not-found", request.constraintId);

  const bindingValidation = validateStudio3dAttachmentBindings(
    document,
    request.runtimeNodes,
  );
  if (!bindingValidation.ok) {
    return bindingFailure(constraint.id, bindingValidation.issues);
  }

  const primarySocket = parseRigidTransform(request.primarySocketWorld);
  if (!primarySocket.ok) {
    return mappedTransformFailure(primarySocket, "invalid-primary-socket", constraint.id);
  }
  const primaryPropAnchor = parseRigidTransform(request.propAnchorLocal);
  if (!primaryPropAnchor.ok) {
    return mappedTransformFailure(primaryPropAnchor, "invalid-prop-anchor", constraint.id);
  }
  const offset = parseRigidTransform(constraint.offset);
  if (!offset.ok) {
    return mappedTransformFailure(offset, "invalid-prop-anchor", constraint.id);
  }

  const hasSecondaryInput =
    Object.prototype.hasOwnProperty.call(request, "secondaryPropAnchorLocal") &&
    request.secondaryPropAnchorLocal !== undefined;
  if (constraint.secondaryHand && !hasSecondaryInput) {
    return failure("missing-secondary-prop-anchor", constraint.id);
  }
  if (!constraint.secondaryHand && hasSecondaryInput) {
    return failure("unexpected-secondary-prop-anchor", constraint.id);
  }

  const inversePrimaryPropAnchor = invertRigidTransform(primaryPropAnchor.transform);
  const socketWithOffset = composeRigidTransforms(primarySocket.transform, offset.transform);
  const propWorld = socketWithOffset && inversePrimaryPropAnchor
    ? composeRigidTransforms(socketWithOffset, inversePrimaryPropAnchor)
    : null;
  if (!propWorld) return failure("numeric-overflow", constraint.id);

  let secondaryHandIkTargetWorld: Studio3dAttachmentTransform | undefined;
  if (constraint.secondaryHand) {
    const secondaryPropAnchor = parseRigidTransform(request.secondaryPropAnchorLocal);
    if (!secondaryPropAnchor.ok) {
      return mappedTransformFailure(
        secondaryPropAnchor,
        "invalid-secondary-prop-anchor",
        constraint.id,
      );
    }
    secondaryHandIkTargetWorld =
      composeRigidTransforms(propWorld, secondaryPropAnchor.transform) ?? undefined;
    if (!secondaryHandIkTargetWorld) return failure("numeric-overflow", constraint.id);
  }

  return Object.freeze({
    ok: true,
    constraintId: constraint.id,
    propWorld,
    ...(secondaryHandIkTargetWorld ? { secondaryHandIkTargetWorld } : {}),
  });
}
