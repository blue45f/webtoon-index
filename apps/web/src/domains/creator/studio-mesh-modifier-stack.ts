/**
 * Non-destructive mesh modifier stack (MOD-012…016).
 *
 * Evaluates Mirror / Array / Boolean / Solidify / Bevel on an editable-mesh source.
 * Source mesh is never mutated; stack params are pure data and undo reverts params.
 * Boolean commit uses a solid backend (Manifold-class) with failure diagnostics.
 */

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  faceNormalStudioEditableMesh,
  hashStudioEditableMesh,
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";
import { decimateStudioMesh } from "./studio-mesh-ops-advanced";
import { sha256HexPortable } from "./studio-sha256";
import { createStudioDefaultSolidBooleanBackend } from "./studio-solid-boolean-backend";

export const STUDIO_MESH_MODIFIER_STACK_REVISION = 1 as const;

/** Persistence/import budgets. Invalid data is rejected instead of being truncated. */
export const STUDIO_MESH_MODIFIER_STACK_LIMITS = Object.freeze({
  maxModifiers: 128,
  maxModifierIdLength: 160,
  maxBooleanPositionValues: 750_000,
  maxBooleanIndexValues: 3_000_000,
  /** All Boolean operands are copied for immutable authority, so the whole stack shares this cap. */
  maxBooleanOperandBytes: 16 * 1024 * 1024,
  maxCoordinateMagnitude: 10_000_000,
  maxParameterMagnitude: 1_000_000,
  /** Browser-safe evaluated topology caps. Every generated mesh is checked before allocation. */
  maxEvaluatedVertices: 100_000,
  maxEvaluatedIndexValues: 600_000,
  maxEvaluatedHalfEdges: 600_000,
  /** Cumulative allocation/work caps cover an entire evaluation, not only its final mesh. */
  maxEvaluationAllocatedVertices: 1_000_000,
  maxEvaluationAllocatedIndexValues: 4_000_000,
  maxEvaluationAllocatedBytes: 192 * 1024 * 1024,
  maxEvaluationWorkUnits: 20_000_000,
});

export type StudioMeshModifierKind =
  | "mirror"
  | "array"
  | "boolean"
  | "solidify"
  | "bevel"
  | "subdivision"
  | "weld"
  | "decimate"
  | "simple-deform";

export type StudioMeshBooleanOp = "union" | "difference" | "intersection";

export interface StudioMeshMirrorModifier {
  readonly kind: "mirror";
  readonly id: string;
  readonly enabled: boolean;
  readonly axis: "x" | "y" | "z";
  readonly merge: boolean;
  readonly mergeThreshold: number;
  readonly bisect: boolean;
  readonly clip: boolean;
}

export interface StudioMeshArrayModifier {
  readonly kind: "array";
  readonly id: string;
  readonly enabled: boolean;
  readonly count: number;
  readonly offset: StudioMeshVec3;
  readonly mode: "linear" | "radial";
  readonly radialAngleRad?: number;
  readonly realizeInstances: boolean;
}

export interface StudioMeshBooleanModifier {
  readonly kind: "boolean";
  readonly id: string;
  readonly enabled: boolean;
  readonly operation: StudioMeshBooleanOp;
  /** Stable cutter provenance for UI selection/rebinding; geometry remains self-contained below. */
  readonly operandAssetId?: string;
  /** Operand mesh serialized as triangle soup for solid commit. */
  readonly operand: {
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
  };
}

export interface StudioMeshSolidifyModifier {
  readonly kind: "solidify";
  readonly id: string;
  readonly enabled: boolean;
  readonly thickness: number;
  readonly evenThickness: boolean;
  readonly rim: boolean;
}

export interface StudioMeshBevelModifier {
  readonly kind: "bevel";
  readonly id: string;
  readonly enabled: boolean;
  readonly amount: number;
  readonly segments: number;
  readonly angleLimitRad: number;
  readonly weightInfluence: number;
}

export interface StudioMeshSubdivisionModifier {
  readonly kind: "subdivision";
  readonly id: string;
  readonly enabled: boolean;
  readonly levels: number;
  readonly smooth: boolean;
}

export interface StudioMeshWeldModifier {
  readonly kind: "weld";
  readonly id: string;
  readonly enabled: boolean;
  readonly quantum: number;
}

export interface StudioMeshDecimateModifier {
  readonly kind: "decimate";
  readonly id: string;
  readonly enabled: boolean;
  readonly ratio: number;
}

export type StudioMeshSimpleDeformMode = "twist" | "taper" | "stretch";

export interface StudioMeshSimpleDeformModifier {
  readonly kind: "simple-deform";
  readonly id: string;
  readonly enabled: boolean;
  readonly mode: StudioMeshSimpleDeformMode;
  readonly axis: "x" | "y" | "z";
  /** twist rotation at the far end, radians. */
  readonly angleRad: number;
  /** taper scale at the far end (1 = untouched); stretch factor along the axis. */
  readonly factor: number;
}

export type StudioMeshModifier =
  | StudioMeshMirrorModifier
  | StudioMeshArrayModifier
  | StudioMeshBooleanModifier
  | StudioMeshSolidifyModifier
  | StudioMeshBevelModifier
  | StudioMeshSubdivisionModifier
  | StudioMeshWeldModifier
  | StudioMeshDecimateModifier
  | StudioMeshSimpleDeformModifier;

/** Exact JSON-safe DTO. Boolean typed arrays are deliberately encoded as dense number arrays. */
export type StudioMeshModifierDto =
  | {
      readonly kind: "mirror";
      readonly id: string;
      readonly enabled: boolean;
      readonly axis: "x" | "y" | "z";
      readonly merge: boolean;
      readonly mergeThreshold: number;
      readonly bisect: boolean;
      readonly clip: boolean;
    }
  | {
      readonly kind: "array";
      readonly id: string;
      readonly enabled: boolean;
      readonly count: number;
      readonly offset: StudioMeshVec3;
      readonly mode: "linear" | "radial";
      readonly radialAngleRad?: number;
      readonly realizeInstances: boolean;
    }
  | {
      readonly kind: "boolean";
      readonly id: string;
      readonly enabled: boolean;
      readonly operation: StudioMeshBooleanOp;
      readonly operandAssetId?: string;
      readonly operand: {
        readonly positions: readonly number[];
        readonly indices: readonly number[];
      };
    }
  | {
      readonly kind: "solidify";
      readonly id: string;
      readonly enabled: boolean;
      readonly thickness: number;
      readonly evenThickness: boolean;
      readonly rim: boolean;
    }
  | {
      readonly kind: "bevel";
      readonly id: string;
      readonly enabled: boolean;
      readonly amount: number;
      readonly segments: number;
      readonly angleLimitRad: number;
      readonly weightInfluence: number;
    }
  | {
      readonly kind: "subdivision";
      readonly id: string;
      readonly enabled: boolean;
      readonly levels: number;
      readonly smooth: boolean;
    }
  | {
      readonly kind: "weld";
      readonly id: string;
      readonly enabled: boolean;
      readonly quantum: number;
    }
  | {
      readonly kind: "decimate";
      readonly id: string;
      readonly enabled: boolean;
      readonly ratio: number;
    }
  | {
      readonly kind: "simple-deform";
      readonly id: string;
      readonly enabled: boolean;
      readonly mode: StudioMeshSimpleDeformMode;
      readonly axis: "x" | "y" | "z";
      readonly angleRad: number;
      readonly factor: number;
    };

export interface StudioMeshModifierStackDto {
  readonly revision: typeof STUDIO_MESH_MODIFIER_STACK_REVISION;
  /** Array order is evaluation order and therefore part of the persisted authority. */
  readonly modifiers: readonly StudioMeshModifierDto[];
}

export type StudioMeshModifierStackSnapshot = StudioMeshModifierStackDto;

export interface StudioMeshModifierStack {
  readonly revision: typeof STUDIO_MESH_MODIFIER_STACK_REVISION;
  readonly source: StudioEditableMesh;
  readonly modifiers: readonly StudioMeshModifier[];
}

export type StudioMeshModifierFailureCode =
  | "boolean-empty"
  | "boolean-failed"
  | "budget-exceeded"
  | "invalid-parameter"
  | "invalid-stack";

export type StudioMeshModifierResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: StudioMeshModifierFailureCode;
      readonly detail: string;
      readonly diagnostics?: readonly string[];
    };

/** Solid boolean commit backend (Manifold-class contract). */
export interface StudioSolidBooleanBackend {
  boolean(input: {
    readonly left: { readonly positions: Float32Array; readonly indices: Uint32Array };
    readonly right: { readonly positions: Float32Array; readonly indices: Uint32Array };
    readonly operation: StudioMeshBooleanOp;
  }): Promise<{
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
    readonly diagnostic?: string;
  }>;
}

function ok<T>(value: T): StudioMeshModifierResult<T> {
  return { ok: true, value };
}

function fail<T>(
  code: StudioMeshModifierFailureCode,
  detail: string,
  diagnostics?: readonly string[],
): StudioMeshModifierResult<T> {
  return { ok: false, code, detail, diagnostics };
}

function v(x: number, y: number, z: number): StudioMeshVec3 {
  return { x, y, z };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length
    && ownKeys.every((key) => typeof key === "string")
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function hasOnlyEnumerableDataProperties(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (!keys.every((key) => key === "length" || (typeof key === "string"
    && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length))) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function validModifierId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_MESH_MODIFIER_STACK_LIMITS.maxModifierIdLength
    && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value);
}

function validAssetReferenceId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0
    || value.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxModifierIdLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function decodeVec3(value: unknown, path: string): StudioMeshModifierResult<StudioMeshVec3> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["x", "y", "z"])) {
    return fail("invalid-stack", `${path} must contain exactly x/y/z`);
  }
  const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  if (![value.x, value.y, value.z].every((entry) => finiteInRange(entry, -limit, limit))) {
    return fail("invalid-parameter", `${path} coordinates must be finite and bounded`);
  }
  return ok({ x: value.x as number, y: value.y as number, z: value.z as number });
}

function decodeModifier(
  value: unknown,
  index: number,
): StudioMeshModifierResult<StudioMeshModifier> {
  const path = `modifiers[${index}]`;
  if (!isPlainRecord(value)) return fail("invalid-stack", `${path} must be an object`);
  if (!hasOnlyEnumerableDataProperties(value)) {
    return fail("invalid-stack", `${path} must contain only enumerable data properties`);
  }
  if (!validModifierId(value.id)) return fail("invalid-stack", `${path}.id is invalid`);
  if (typeof value.enabled !== "boolean") {
    return fail("invalid-stack", `${path}.enabled must be boolean`);
  }

  if (value.kind === "mirror") {
    if (!hasExactKeys(value, [
      "kind", "id", "enabled", "axis", "merge", "mergeThreshold", "bisect", "clip",
    ])) return fail("invalid-stack", `${path} mirror DTO keys are invalid`);
    if (value.axis !== "x" && value.axis !== "y" && value.axis !== "z") {
      return fail("invalid-parameter", `${path}.axis is invalid`);
    }
    if (typeof value.merge !== "boolean" || typeof value.bisect !== "boolean"
      || typeof value.clip !== "boolean") {
      return fail("invalid-stack", `${path} mirror flags must be boolean`);
    }
    if (!finiteInRange(
      value.mergeThreshold,
      0,
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
    )) return fail("invalid-parameter", `${path}.mergeThreshold is invalid`);
    return ok({
      kind: "mirror",
      id: value.id,
      enabled: value.enabled,
      axis: value.axis,
      merge: value.merge,
      mergeThreshold: value.mergeThreshold,
      bisect: value.bisect,
      clip: value.clip,
    });
  }

  if (value.kind === "array") {
    const arrayKeys = Object.hasOwn(value, "radialAngleRad")
      ? [
          "kind", "id", "enabled", "count", "offset", "mode", "radialAngleRad",
          "realizeInstances",
        ]
      : ["kind", "id", "enabled", "count", "offset", "mode", "realizeInstances"];
    if (!hasExactKeys(value, arrayKeys)) {
      return fail("invalid-stack", `${path} array DTO keys are invalid`);
    }
    if (!Number.isSafeInteger(value.count) || (value.count as number) < 1
      || (value.count as number) > 64) {
      return fail("invalid-parameter", `${path}.count must be an integer in 1..64`);
    }
    if (value.mode !== "linear" && value.mode !== "radial") {
      return fail("invalid-parameter", `${path}.mode is invalid`);
    }
    if (typeof value.realizeInstances !== "boolean") {
      return fail("invalid-stack", `${path}.realizeInstances must be boolean`);
    }
    if (Object.hasOwn(value, "radialAngleRad")
      && !finiteInRange(value.radialAngleRad, -Math.PI * 128, Math.PI * 128)) {
      return fail("invalid-parameter", `${path}.radialAngleRad is invalid`);
    }
    const offset = decodeVec3(value.offset, `${path}.offset`);
    if (!offset.ok) return offset;
    return ok({
      kind: "array",
      id: value.id,
      enabled: value.enabled,
      count: value.count as number,
      offset: offset.value,
      mode: value.mode,
      ...(Object.hasOwn(value, "radialAngleRad")
        ? { radialAngleRad: value.radialAngleRad as number }
        : {}),
      realizeInstances: value.realizeInstances,
    });
  }

  if (value.kind === "boolean") {
    const booleanKeys = Object.hasOwn(value, "operandAssetId")
      ? ["kind", "id", "enabled", "operation", "operandAssetId", "operand"]
      : ["kind", "id", "enabled", "operation", "operand"];
    if (!hasExactKeys(value, booleanKeys)) {
      return fail("invalid-stack", `${path} boolean DTO keys are invalid`);
    }
    if (value.operation !== "union" && value.operation !== "difference"
      && value.operation !== "intersection") {
      return fail("invalid-parameter", `${path}.operation is invalid`);
    }
    if (Object.hasOwn(value, "operandAssetId") && !validAssetReferenceId(value.operandAssetId)) {
      return fail("invalid-parameter", `${path}.operandAssetId is invalid`);
    }
    if (!isPlainRecord(value.operand)
      || !hasExactKeys(value.operand, ["positions", "indices"])) {
      return fail("invalid-stack", `${path}.operand DTO keys are invalid`);
    }
    const positions = value.operand.positions;
    const indices = value.operand.indices;
    if (!isDenseArray(positions) || positions.length < 9 || positions.length % 3 !== 0
      || positions.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanPositionValues) {
      return fail("budget-exceeded", `${path}.operand.positions is empty, malformed, or too large`);
    }
    if (!isDenseArray(indices) || indices.length < 3 || indices.length % 3 !== 0
      || indices.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanIndexValues) {
      return fail("budget-exceeded", `${path}.operand.indices is empty, malformed, or too large`);
    }
    const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
    if (!positions.every((entry): entry is number => (
      finiteInRange(entry, -coordinateLimit, coordinateLimit)
    ))) {
      return fail("invalid-parameter", `${path}.operand.positions must be finite and bounded`);
    }
    const vertexCount = positions.length / 3;
    if (!indices.every((entry): entry is number => typeof entry === "number"
      && Number.isSafeInteger(entry) && entry >= 0
      && entry < vertexCount && entry <= 0xffff_ffff)) {
      return fail("invalid-parameter", `${path}.operand.indices contains an invalid vertex index`);
    }
    return ok({
      kind: "boolean",
      id: value.id,
      enabled: value.enabled,
      operation: value.operation,
      ...(Object.hasOwn(value, "operandAssetId")
        ? { operandAssetId: value.operandAssetId as string }
        : {}),
      operand: {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      },
    });
  }

  if (value.kind === "solidify") {
    if (!hasExactKeys(value, [
      "kind", "id", "enabled", "thickness", "evenThickness", "rim",
    ])) return fail("invalid-stack", `${path} solidify DTO keys are invalid`);
    const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude;
    if (!finiteInRange(value.thickness, -limit, limit)) {
      return fail("invalid-parameter", `${path}.thickness is invalid`);
    }
    if (typeof value.evenThickness !== "boolean" || typeof value.rim !== "boolean") {
      return fail("invalid-stack", `${path} solidify flags must be boolean`);
    }
    return ok({
      kind: "solidify",
      id: value.id,
      enabled: value.enabled,
      thickness: value.thickness,
      evenThickness: value.evenThickness,
      rim: value.rim,
    });
  }

  if (value.kind === "bevel") {
    if (!hasExactKeys(value, [
      "kind", "id", "enabled", "amount", "segments", "angleLimitRad", "weightInfluence",
    ])) return fail("invalid-stack", `${path} bevel DTO keys are invalid`);
    const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude;
    if (!finiteInRange(value.amount, 0, limit)) {
      return fail("invalid-parameter", `${path}.amount is invalid`);
    }
    if (!Number.isSafeInteger(value.segments) || (value.segments as number) < 1
      || (value.segments as number) > 64) {
      return fail("invalid-parameter", `${path}.segments must be an integer in 1..64`);
    }
    if (!finiteInRange(value.angleLimitRad, 0, Math.PI)
      || !finiteInRange(value.weightInfluence, 0, 1)) {
      return fail("invalid-parameter", `${path} bevel limits are invalid`);
    }
    return ok({
      kind: "bevel",
      id: value.id,
      enabled: value.enabled,
      amount: value.amount,
      segments: value.segments as number,
      angleLimitRad: value.angleLimitRad,
      weightInfluence: value.weightInfluence,
    });
  }

  if (value.kind === "subdivision") {
    if (!hasExactKeys(value, ["kind", "id", "enabled", "levels", "smooth"])) {
      return fail("invalid-stack", `${path} subdivision DTO keys are invalid`);
    }
    if (!Number.isSafeInteger(value.levels) || (value.levels as number) < 1
      || (value.levels as number) > 3) {
      return fail("invalid-parameter", `${path}.levels must be an integer in 1..3`);
    }
    if (typeof value.smooth !== "boolean") {
      return fail("invalid-stack", `${path}.smooth must be boolean`);
    }
    return ok({
      kind: "subdivision",
      id: value.id,
      enabled: value.enabled,
      levels: value.levels as number,
      smooth: value.smooth,
    });
  }

  if (value.kind === "weld") {
    if (!hasExactKeys(value, ["kind", "id", "enabled", "quantum"])) {
      return fail("invalid-stack", `${path} weld DTO keys are invalid`);
    }
    if (!finiteInRange(
      value.quantum,
      1e-6,
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
    )) return fail("invalid-parameter", `${path}.quantum is invalid`);
    return ok({
      kind: "weld",
      id: value.id,
      enabled: value.enabled,
      quantum: value.quantum,
    });
  }

  if (value.kind === "decimate") {
    if (!hasExactKeys(value, ["kind", "id", "enabled", "ratio"])) {
      return fail("invalid-stack", `${path} decimate DTO keys are invalid`);
    }
    if (!finiteInRange(value.ratio, 0.05, 0.95)) {
      return fail("invalid-parameter", `${path}.ratio must be within 0.05..0.95`);
    }
    return ok({
      kind: "decimate",
      id: value.id,
      enabled: value.enabled,
      ratio: value.ratio,
    });
  }

  if (value.kind === "simple-deform") {
    if (!hasExactKeys(value, [
      "kind", "id", "enabled", "mode", "axis", "angleRad", "factor",
    ])) return fail("invalid-stack", `${path} simple-deform DTO keys are invalid`);
    if (value.mode !== "twist" && value.mode !== "taper" && value.mode !== "stretch") {
      return fail("invalid-parameter", `${path}.mode is invalid`);
    }
    if (value.axis !== "x" && value.axis !== "y" && value.axis !== "z") {
      return fail("invalid-parameter", `${path}.axis is invalid`);
    }
    const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude;
    if (!finiteInRange(value.angleRad, -limit, limit)
      || !finiteInRange(value.factor, 0.001, limit)) {
      return fail("invalid-parameter", `${path} simple-deform limits are invalid`);
    }
    return ok({
      kind: "simple-deform",
      id: value.id,
      enabled: value.enabled,
      mode: value.mode,
      axis: value.axis,
      angleRad: value.angleRad,
      factor: value.factor,
    });
  }

  return fail("invalid-stack", `${path}.kind is unsupported`);
}

function booleanOperandByteLength(
  positionsLength: number,
  indicesLength: number,
): number | null {
  const valueCount = positionsLength + indicesLength;
  if (!Number.isSafeInteger(valueCount) || valueCount < 0) return null;
  const bytes = valueCount * Float32Array.BYTES_PER_ELEMENT;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Validate the in-memory authority shape without first cloning its potentially large operands. */
function validateRuntimeModifier(
  modifier: StudioMeshModifier,
  index: number,
): StudioMeshModifierResult<number> {
  const path = `modifiers[${index}]`;
  if (!modifier || typeof modifier !== "object") {
    return fail("invalid-stack", `${path} must be an object`);
  }
  if (!validModifierId(modifier.id) || typeof modifier.enabled !== "boolean") {
    return fail("invalid-stack", `${path} identity/enabled state is invalid`);
  }

  if (modifier.kind === "mirror") {
    if ((modifier.axis !== "x" && modifier.axis !== "y" && modifier.axis !== "z")
      || typeof modifier.merge !== "boolean"
      || typeof modifier.bisect !== "boolean"
      || typeof modifier.clip !== "boolean"
      || !finiteInRange(
        modifier.mergeThreshold,
        0,
        STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
      )) {
      return fail("invalid-parameter", `${path} mirror parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "array") {
    if (!modifier.offset || typeof modifier.offset !== "object") {
      return fail("invalid-stack", `${path}.offset must be a vector`);
    }
    const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
    if (!Number.isSafeInteger(modifier.count) || modifier.count < 1 || modifier.count > 64
      || (modifier.mode !== "linear" && modifier.mode !== "radial")
      || typeof modifier.realizeInstances !== "boolean"
      || !finiteInRange(modifier.offset.x, -limit, limit)
      || !finiteInRange(modifier.offset.y, -limit, limit)
      || !finiteInRange(modifier.offset.z, -limit, limit)
      || (modifier.radialAngleRad !== undefined
        && !finiteInRange(modifier.radialAngleRad, -Math.PI * 128, Math.PI * 128))) {
      return fail("invalid-parameter", `${path} array parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "boolean") {
    if (!modifier.operand || typeof modifier.operand !== "object") {
      return fail("invalid-stack", `${path}.operand must be a triangle soup`);
    }
    if ((modifier.operation !== "union" && modifier.operation !== "difference"
      && modifier.operation !== "intersection")
      || (modifier.operandAssetId !== undefined
        && !validAssetReferenceId(modifier.operandAssetId))
      || !(modifier.operand.positions instanceof Float32Array)
      || !(modifier.operand.indices instanceof Uint32Array)) {
      return fail("invalid-parameter", `${path} boolean contract is invalid`);
    }
    const { positions, indices } = modifier.operand;
    if (positions.length < 9 || positions.length % 3 !== 0
      || positions.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanPositionValues
      || indices.length < 3 || indices.length % 3 !== 0
      || indices.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanIndexValues) {
      return fail("budget-exceeded", `${path} boolean operand topology budget exceeded`);
    }
    const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
      if (!finiteInRange(positions[positionIndex], -coordinateLimit, coordinateLimit)) {
        return fail("invalid-parameter", `${path} boolean positions must be finite and bounded`);
      }
    }
    const vertexCount = positions.length / 3;
    for (let indexIndex = 0; indexIndex < indices.length; indexIndex += 1) {
      if (indices[indexIndex]! >= vertexCount) {
        return fail("invalid-parameter", `${path} boolean index is out of range`);
      }
    }
    const bytes = booleanOperandByteLength(positions.length, indices.length);
    if (bytes === null) return fail("budget-exceeded", `${path} boolean byte size overflow`);
    return ok(bytes);
  }

  if (modifier.kind === "solidify") {
    if (!finiteInRange(
      modifier.thickness,
      -STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
    ) || typeof modifier.evenThickness !== "boolean" || typeof modifier.rim !== "boolean") {
      return fail("invalid-parameter", `${path} solidify parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "bevel") {
    if (!finiteInRange(
      modifier.amount,
      0,
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
    ) || !Number.isSafeInteger(modifier.segments)
      || modifier.segments < 1 || modifier.segments > 64
      || !finiteInRange(modifier.angleLimitRad, 0, Math.PI)
      || !finiteInRange(modifier.weightInfluence, 0, 1)) {
      return fail("invalid-parameter", `${path} bevel parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "subdivision") {
    if (!Number.isSafeInteger(modifier.levels) || modifier.levels < 1 || modifier.levels > 3
      || typeof modifier.smooth !== "boolean") {
      return fail("invalid-parameter", `${path} subdivision parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "weld") {
    if (!finiteInRange(
      modifier.quantum,
      1e-6,
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude,
    )) return fail("invalid-parameter", `${path} weld parameters are invalid`);
    return ok(0);
  }

  if (modifier.kind === "decimate") {
    if (!finiteInRange(modifier.ratio, 0.05, 0.95)) {
      return fail("invalid-parameter", `${path} decimate parameters are invalid`);
    }
    return ok(0);
  }

  if (modifier.kind === "simple-deform") {
    const limit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxParameterMagnitude;
    if ((modifier.mode !== "twist" && modifier.mode !== "taper" && modifier.mode !== "stretch")
      || (modifier.axis !== "x" && modifier.axis !== "y" && modifier.axis !== "z")
      || !finiteInRange(modifier.angleRad, -limit, limit)
      || !finiteInRange(modifier.factor, 0.001, limit)) {
      return fail("invalid-parameter", `${path} simple-deform parameters are invalid`);
    }
    return ok(0);
  }

  return fail("invalid-stack", `${path}.kind is unsupported`);
}

function validateRuntimeModifiers(
  modifiers: readonly StudioMeshModifier[],
): StudioMeshModifierResult<undefined> {
  if (modifiers.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxModifiers) {
    return fail("budget-exceeded", "modifier stack budget exceeded");
  }
  const ids = new Set<string>();
  let booleanBytes = 0;
  for (let index = 0; index < modifiers.length; index += 1) {
    const modifier = modifiers[index]!;
    const validated = validateRuntimeModifier(modifier, index);
    if (!validated.ok) return validated;
    if (ids.has(modifier.id)) return fail("invalid-stack", `duplicate modifier id ${modifier.id}`);
    ids.add(modifier.id);
    booleanBytes += validated.value;
    if (!Number.isSafeInteger(booleanBytes)
      || booleanBytes > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanOperandBytes) {
      return fail("budget-exceeded", "cumulative boolean operand byte budget exceeded");
    }
  }
  return ok(undefined);
}

function throwForInvalidRuntimeModifiers(modifiers: readonly StudioMeshModifier[]): void {
  const validated = validateRuntimeModifiers(modifiers);
  if (!validated.ok) throw new Error(`invalid modifier stack: ${validated.detail}`);
}

function preflightSerializedBooleanBytes(
  value: unknown,
  index: number,
): StudioMeshModifierResult<number> {
  if (!isPlainRecord(value) || value.kind !== "boolean" || !isPlainRecord(value.operand)) {
    return ok(0);
  }
  const { positions, indices } = value.operand;
  if (!Array.isArray(positions) || !Array.isArray(indices)) return ok(0);
  const bytes = booleanOperandByteLength(positions.length, indices.length);
  if (bytes === null) {
    return fail("budget-exceeded", `modifiers[${index}] boolean byte size overflow`);
  }
  return ok(bytes);
}

function cloneModifier(modifier: StudioMeshModifier): StudioMeshModifier {
  if (modifier.kind === "boolean") {
    return {
      ...modifier,
      operand: {
        positions: new Float32Array(modifier.operand.positions),
        indices: new Uint32Array(modifier.operand.indices),
      },
    };
  }
  if (modifier.kind === "array") {
    return { ...modifier, offset: { ...modifier.offset } };
  }
  return { ...modifier };
}

function serializeModifier(modifier: StudioMeshModifier, index: number): StudioMeshModifierDto {
  if (modifier.kind === "boolean") {
    const { positions, indices } = modifier.operand;
    if (positions.length < 9 || positions.length % 3 !== 0
      || positions.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanPositionValues
      || indices.length < 3 || indices.length % 3 !== 0
      || indices.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanIndexValues) {
      throw new Error(`invalid modifier stack: modifiers[${index}] boolean operand budget`);
    }
  }
  let dto: StudioMeshModifierDto;
  if (modifier.kind === "boolean") {
    dto = {
      kind: "boolean",
      id: modifier.id,
      enabled: modifier.enabled,
      operation: modifier.operation,
      ...(modifier.operandAssetId === undefined
        ? {}
        : { operandAssetId: modifier.operandAssetId }),
      operand: {
        positions: Array.from(modifier.operand.positions),
        indices: Array.from(modifier.operand.indices),
      },
    };
  } else if (modifier.kind === "array") {
    dto = {
      kind: "array",
      id: modifier.id,
      enabled: modifier.enabled,
      count: modifier.count,
      offset: { ...modifier.offset },
      mode: modifier.mode,
      ...(modifier.radialAngleRad === undefined
        ? {}
        : { radialAngleRad: modifier.radialAngleRad }),
      realizeInstances: modifier.realizeInstances,
    };
  } else if (modifier.kind === "mirror") {
    dto = {
      kind: "mirror",
      id: modifier.id,
      enabled: modifier.enabled,
      axis: modifier.axis,
      merge: modifier.merge,
      mergeThreshold: modifier.mergeThreshold,
      bisect: modifier.bisect,
      clip: modifier.clip,
    };
  } else if (modifier.kind === "solidify") {
    dto = {
      kind: "solidify",
      id: modifier.id,
      enabled: modifier.enabled,
      thickness: modifier.thickness,
      evenThickness: modifier.evenThickness,
      rim: modifier.rim,
    };
  } else if (modifier.kind === "bevel") {
    dto = {
      kind: "bevel",
      id: modifier.id,
      enabled: modifier.enabled,
      amount: modifier.amount,
      segments: modifier.segments,
      angleLimitRad: modifier.angleLimitRad,
      weightInfluence: modifier.weightInfluence,
    };
  } else if (modifier.kind === "subdivision") {
    dto = {
      kind: "subdivision",
      id: modifier.id,
      enabled: modifier.enabled,
      levels: modifier.levels,
      smooth: modifier.smooth,
    };
  } else if (modifier.kind === "weld") {
    dto = {
      kind: "weld",
      id: modifier.id,
      enabled: modifier.enabled,
      quantum: modifier.quantum,
    };
  } else if (modifier.kind === "decimate") {
    dto = {
      kind: "decimate",
      id: modifier.id,
      enabled: modifier.enabled,
      ratio: modifier.ratio,
    };
  } else {
    dto = {
      kind: "simple-deform",
      id: modifier.id,
      enabled: modifier.enabled,
      mode: modifier.mode,
      axis: modifier.axis,
      angleRad: modifier.angleRad,
      factor: modifier.factor,
    };
  }
  return dto;
}

/** Serialize only non-destructive modifier authority; the source mesh is stored once by its asset. */
export function serializeStudioMeshModifierStack(
  stack: StudioMeshModifierStack,
): StudioMeshModifierStackDto {
  if (stack.revision !== STUDIO_MESH_MODIFIER_STACK_REVISION) {
    throw new Error("invalid modifier stack revision");
  }
  if (stack.modifiers.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxModifiers) {
    throw new Error("invalid modifier stack: modifier budget exceeded");
  }
  throwForInvalidRuntimeModifiers(stack.modifiers);
  const modifiers = stack.modifiers.map(serializeModifier);
  return { revision: STUDIO_MESH_MODIFIER_STACK_REVISION, modifiers };
}

/** Decode untrusted JSON without partially accepting or truncating corrupt modifier data. */
export function deserializeStudioMeshModifierStack(
  snapshot: unknown,
  source: StudioEditableMesh,
): StudioMeshModifierResult<StudioMeshModifierStack> {
  if (!isPlainRecord(snapshot)
    || !hasExactKeys(snapshot, ["revision", "modifiers"])
    || snapshot.revision !== STUDIO_MESH_MODIFIER_STACK_REVISION
    || !isDenseArray(snapshot.modifiers)) {
    return fail("invalid-stack", "modifier stack DTO header is invalid");
  }
  if (snapshot.modifiers.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxModifiers) {
    return fail("budget-exceeded", "modifier stack budget exceeded");
  }
  const modifiers: StudioMeshModifier[] = [];
  const ids = new Set<string>();
  let booleanBytes = 0;
  for (let index = 0; index < snapshot.modifiers.length; index += 1) {
    const bytePreflight = preflightSerializedBooleanBytes(snapshot.modifiers[index], index);
    if (!bytePreflight.ok) return bytePreflight;
    booleanBytes += bytePreflight.value;
    if (!Number.isSafeInteger(booleanBytes)
      || booleanBytes > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanOperandBytes) {
      return fail("budget-exceeded", "cumulative boolean operand byte budget exceeded");
    }
    const decoded = decodeModifier(snapshot.modifiers[index], index);
    if (!decoded.ok) return decoded;
    if (ids.has(decoded.value.id)) {
      return fail("invalid-stack", `duplicate modifier id ${decoded.value.id}`);
    }
    ids.add(decoded.value.id);
    modifiers.push(decoded.value);
  }
  return ok(createStudioMeshModifierStack(source, modifiers));
}

/** Stable content hash: source identity, modifier order, params, and boolean operand all bind. */
export function hashStudioMeshModifierStack(stack: StudioMeshModifierStack): string {
  const canonical = JSON.stringify({
    sourceHash: hashStudioEditableMesh(stack.source),
    ...serializeStudioMeshModifierStack(stack),
  });
  return `modifier-stack:sha256:${sha256HexPortable(new TextEncoder().encode(canonical))}`;
}

export function createStudioMeshModifierStack(
  source: StudioEditableMesh = createStudioUnitCubeMesh(),
  modifiers: readonly StudioMeshModifier[] = [],
): StudioMeshModifierStack {
  throwForInvalidRuntimeModifiers(modifiers);
  return {
    revision: STUDIO_MESH_MODIFIER_STACK_REVISION,
    source,
    modifiers: modifiers.map(cloneModifier),
  };
}

export function withStudioMeshModifier(
  stack: StudioMeshModifierStack,
  modifier: StudioMeshModifier,
): StudioMeshModifierStack {
  const modifiers = [...stack.modifiers, modifier];
  throwForInvalidRuntimeModifiers(modifiers);
  return { ...stack, modifiers: [...stack.modifiers, cloneModifier(modifier)] };
}

export function replaceStudioMeshModifier(
  stack: StudioMeshModifierStack,
  id: string,
  modifier: StudioMeshModifier,
): StudioMeshModifierResult<StudioMeshModifierStack> {
  const idx = stack.modifiers.findIndex((m) => m.id === id);
  if (idx < 0) return fail("invalid-stack", `modifier ${id} not found`);
  const modifiers = stack.modifiers.map((m, i) => (i === idx ? modifier : m));
  const validated = validateRuntimeModifiers(modifiers);
  if (!validated.ok) return validated;
  return ok({
    ...stack,
    modifiers: modifiers.map((entry, index) => (index === idx ? cloneModifier(entry) : entry)),
  });
}

export function removeStudioMeshModifier(
  stack: StudioMeshModifierStack,
  id: string,
): StudioMeshModifierResult<StudioMeshModifierStack> {
  if (!stack.modifiers.some((m) => m.id === id)) {
    return fail("invalid-stack", `modifier ${id} not found`);
  }
  return ok({
    ...stack,
    modifiers: stack.modifiers.filter((m) => m.id !== id),
  });
}

interface StudioMeshEvaluationBudget {
  allocatedVertices: number;
  allocatedIndexValues: number;
  allocatedBytes: number;
  workUnits: number;
}

interface StudioMeshEvaluationMetrics {
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly triangleCount: number;
}

interface StudioTriangleSoup {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

function createEvaluationBudget(): StudioMeshEvaluationBudget {
  return {
    allocatedVertices: 0,
    allocatedIndexValues: 0,
    allocatedBytes: 0,
    workUnits: 0,
  };
}

function checkedProduct(left: number, right: number): number | null {
  const product = left * right;
  return Number.isSafeInteger(product) && product >= 0 ? product : null;
}

function checkedSum(...values: readonly number[]): number | null {
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isSafeInteger(sum) || sum < 0) return null;
  }
  return sum;
}

function reserveEvaluationBudget(
  budget: StudioMeshEvaluationBudget,
  request: {
    readonly vertices?: number;
    readonly indexValues?: number;
    readonly bytes?: number;
    readonly workUnits?: number;
  },
  context: string,
): StudioMeshModifierResult<undefined> {
  const vertices = request.vertices ?? 0;
  const indexValues = request.indexValues ?? 0;
  const bytes = request.bytes ?? 0;
  const workUnits = request.workUnits ?? 0;
  if (![vertices, indexValues, bytes, workUnits].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  )) return fail("budget-exceeded", `${context}: budget arithmetic overflow`);

  const nextVertices = checkedSum(budget.allocatedVertices, vertices);
  const nextIndices = checkedSum(budget.allocatedIndexValues, indexValues);
  const nextBytes = checkedSum(budget.allocatedBytes, bytes);
  const nextWork = checkedSum(budget.workUnits, workUnits);
  if (nextVertices === null || nextIndices === null || nextBytes === null || nextWork === null
    || nextVertices > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluationAllocatedVertices
    || nextIndices > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluationAllocatedIndexValues
    || nextBytes > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluationAllocatedBytes
    || nextWork > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluationWorkUnits) {
    return fail("budget-exceeded", `${context}: cumulative evaluation budget exceeded`);
  }
  budget.allocatedVertices = nextVertices;
  budget.allocatedIndexValues = nextIndices;
  budget.allocatedBytes = nextBytes;
  budget.workUnits = nextWork;
  return ok(undefined);
}

function validateEvaluatedTopologyCounts(
  vertexCount: number,
  indexCount: number,
  context: string,
): StudioMeshModifierResult<undefined> {
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 3
    || vertexCount > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedVertices
    || !Number.isSafeInteger(indexCount) || indexCount < 3 || indexCount % 3 !== 0
    || indexCount > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedIndexValues) {
    return fail("budget-exceeded", `${context}: evaluated topology budget exceeded`);
  }
  return ok(undefined);
}

/** Inspect canonical topology without asking the soup converter to allocate first. */
function inspectEvaluationMesh(
  mesh: StudioEditableMesh,
  budget: StudioMeshEvaluationBudget,
  context: string,
  chargeBudget: boolean = true,
): StudioMeshModifierResult<StudioMeshEvaluationMetrics> {
  if (mesh.revision !== 1 || !Array.isArray(mesh.vertices)
    || !Array.isArray(mesh.halfEdges) || !Array.isArray(mesh.faces)) {
    return fail("invalid-stack", `${context}: editable mesh header is invalid`);
  }
  const vertexCount = mesh.vertices.length;
  const halfEdgeCount = mesh.halfEdges.length;
  if (vertexCount < 3
    || vertexCount > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedVertices
    || halfEdgeCount < 3
    || halfEdgeCount > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedHalfEdges
    || mesh.faces.length < 1
    || mesh.faces.length > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedIndexValues / 3) {
    return fail("budget-exceeded", `${context}: editable mesh topology budget exceeded`);
  }
  if (chargeBudget) {
    const inspection = reserveEvaluationBudget(budget, {
      bytes: halfEdgeCount,
      workUnits: checkedSum(vertexCount, halfEdgeCount * 2, mesh.faces.length) ?? Number.NaN,
    }, `${context} inspection`);
    if (!inspection.ok) return inspection;
  }
  const seenHalfEdges = new Uint8Array(halfEdgeCount);
  const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  for (let index = 0; index < vertexCount; index += 1) {
    const vertex = mesh.vertices[index]!;
    if (vertex.id !== index
      || !finiteInRange(vertex.position.x, -coordinateLimit, coordinateLimit)
      || !finiteInRange(vertex.position.y, -coordinateLimit, coordinateLimit)
      || !finiteInRange(vertex.position.z, -coordinateLimit, coordinateLimit)) {
      return fail("invalid-stack", `${context}: vertex ${index} is invalid`);
    }
  }
  for (let index = 0; index < halfEdgeCount; index += 1) {
    const edge = mesh.halfEdges[index]!;
    if (edge.id !== index || !Number.isSafeInteger(edge.vertex)
      || edge.vertex < 0 || edge.vertex >= vertexCount
      || !Number.isSafeInteger(edge.next) || edge.next < 0 || edge.next >= halfEdgeCount
      || !Number.isSafeInteger(edge.prev) || edge.prev < 0 || edge.prev >= halfEdgeCount
      || !Number.isSafeInteger(edge.twin) || edge.twin < -1 || edge.twin >= halfEdgeCount
      || !Number.isSafeInteger(edge.face) || edge.face < 0 || edge.face >= mesh.faces.length) {
      return fail("invalid-stack", `${context}: half-edge ${index} is invalid`);
    }
  }

  let indexCount = 0;
  for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex += 1) {
    const face = mesh.faces[faceIndex]!;
    if (face.id !== faceIndex || !Number.isSafeInteger(face.he)
      || face.he < 0 || face.he >= halfEdgeCount) {
      return fail("invalid-stack", `${context}: face ${faceIndex} is invalid`);
    }
    const start = face.he;
    let cursor = start;
    let loopLength = 0;
    do {
      const edge = mesh.halfEdges[cursor]!;
      if (edge.face !== faceIndex || seenHalfEdges[cursor] !== 0) {
        return fail("invalid-stack", `${context}: face ${faceIndex} loop overlaps or escapes`);
      }
      seenHalfEdges[cursor] = 1;
      cursor = edge.next;
      loopLength += 1;
      if (loopLength > halfEdgeCount) {
        return fail("invalid-stack", `${context}: face ${faceIndex} loop does not close`);
      }
    } while (cursor !== start);
    if (loopLength < 3) return fail("invalid-stack", `${context}: face ${faceIndex} is degenerate`);
    const faceIndices = checkedProduct(loopLength - 2, 3);
    if (faceIndices === null) return fail("budget-exceeded", `${context}: triangle count overflow`);
    const nextIndexCount = checkedSum(indexCount, faceIndices);
    if (nextIndexCount === null
      || nextIndexCount > STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedIndexValues) {
      return fail("budget-exceeded", `${context}: triangle index budget exceeded`);
    }
    indexCount = nextIndexCount;
  }
  if (seenHalfEdges.some((value) => value === 0)) {
    return fail("invalid-stack", `${context}: unowned half-edge found`);
  }
  return ok({ vertexCount, indexCount, triangleCount: indexCount / 3 });
}

function estimateSoupConversionBytes(metrics: StudioMeshEvaluationMetrics): number | null {
  // Float32/Uint32 outputs plus the converter's vertex map and temporary JS triangle list.
  return checkedSum(
    checkedProduct(metrics.vertexCount, 64) ?? Number.NaN,
    checkedProduct(metrics.indexCount, 16) ?? Number.NaN,
  );
}

function estimateMeshConstructionBytes(vertexCount: number, indexCount: number): number | null {
  // Conservative object/Map/string/face-loop allowance for half-edge reconstruction.
  return checkedSum(
    checkedProduct(vertexCount, 128) ?? Number.NaN,
    checkedProduct(indexCount, 128) ?? Number.NaN,
  );
}

function materializeTriangleSoup(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  budget: StudioMeshEvaluationBudget,
  context: string,
): StudioMeshModifierResult<StudioTriangleSoup> {
  const bytes = estimateSoupConversionBytes(metrics);
  const reserved = reserveEvaluationBudget(budget, {
    vertices: metrics.vertexCount,
    indexValues: metrics.indexCount,
    bytes: bytes ?? Number.NaN,
    workUnits: checkedSum(metrics.vertexCount, metrics.indexCount) ?? Number.NaN,
  }, `${context} triangle soup`);
  if (!reserved.ok) return reserved;
  const soup = studioEditableMeshToTriangleSoup(mesh);
  if (soup.positions.length !== metrics.vertexCount * 3
    || soup.indices.length !== metrics.indexCount) {
    return fail("invalid-stack", `${context}: triangle soup disagrees with topology preflight`);
  }
  return ok(soup);
}

function reserveGeneratedMesh(
  budget: StudioMeshEvaluationBudget,
  vertexCount: number,
  indexCount: number,
  extraBytes: number,
  extraWork: number,
  context: string,
): StudioMeshModifierResult<undefined> {
  const topology = validateEvaluatedTopologyCounts(vertexCount, indexCount, context);
  if (!topology.ok) return topology;
  const constructionBytes = estimateMeshConstructionBytes(vertexCount, indexCount);
  return reserveEvaluationBudget(budget, {
    vertices: vertexCount,
    indexValues: indexCount,
    bytes: checkedSum(constructionBytes ?? Number.NaN, extraBytes) ?? Number.NaN,
    workUnits: checkedSum(vertexCount, indexCount, extraWork) ?? Number.NaN,
  }, `${context} output`);
}

function soupToMesh(
  positions: Float32Array,
  indices: Uint32Array,
): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    verts.push(v(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  }
  const faces: number[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

type MutablePoint3 = [number, number, number];

function pointAxis(point: MutablePoint3, axis: number): number {
  return point[axis] ?? 0;
}

function clipTriangleToPositiveAxis(
  triangle: readonly MutablePoint3[],
  axis: number,
): MutablePoint3[] {
  const clipped: MutablePoint3[] = [];
  for (let index = 0; index < triangle.length; index += 1) {
    const current = triangle[index]!;
    const previous = triangle[(index + triangle.length - 1) % triangle.length]!;
    const currentDistance = pointAxis(current, axis);
    const previousDistance = pointAxis(previous, axis);
    const currentInside = currentDistance >= 0;
    const previousInside = previousDistance >= 0;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      const t = denominator === 0 ? 0 : previousDistance / denominator;
      const intersection: MutablePoint3 = [
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
        previous[2] + (current[2] - previous[2]) * t,
      ];
      intersection[axis] = 0;
      clipped.push(intersection);
    }
    if (currentInside) clipped.push([...current]);
  }
  return clipped;
}

function applyMirror(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshMirrorModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  if (mod.clip && !mod.merge) {
    return fail("invalid-parameter", "mirror clip requires merge so the center seam is authoritative");
  }
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, `mirror ${mod.id}`);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const axis = mod.axis === "x" ? 0 : mod.axis === "y" ? 1 : 2;
  const worstBaseVertices = mod.bisect
    ? checkedProduct(metrics.triangleCount, 4)
    : metrics.vertexCount;
  const worstBaseIndices = mod.bisect
    ? checkedProduct(metrics.indexCount, 2)
    : metrics.indexCount;
  const worstVertices = worstBaseVertices === null ? null : checkedProduct(worstBaseVertices, 2);
  const worstIndices = worstBaseIndices === null ? null : checkedProduct(worstBaseIndices, 2);
  if (worstBaseVertices === null || worstBaseIndices === null
    || worstVertices === null || worstIndices === null) {
    return fail("budget-exceeded", `mirror ${mod.id}: topology arithmetic overflow`);
  }
  const stagingBytes = checkedSum(
    checkedProduct(worstVertices, 40) ?? Number.NaN,
    checkedProduct(worstIndices, 12) ?? Number.NaN,
  );
  const reserved = reserveGeneratedMesh(
    budget,
    worstVertices,
    worstIndices,
    stagingBytes ?? Number.NaN,
    checkedSum(worstVertices, worstIndices) ?? Number.NaN,
    `mirror ${mod.id}`,
  );
  if (!reserved.ok) return reserved;

  const basePositions: number[] = [];
  const baseIndices: number[] = [];
  const seamThreshold = mod.merge ? mod.mergeThreshold : -1;
  if (!mod.bisect) {
    for (let index = 0; index < soup.positions.length; index += 3) {
      const point: MutablePoint3 = [
        soup.positions[index]!,
        soup.positions[index + 1]!,
        soup.positions[index + 2]!,
      ];
      if (Math.abs(pointAxis(point, axis)) <= seamThreshold) point[axis] = 0;
      basePositions.push(point[0], point[1], point[2]);
    }
    for (let index = 0; index < soup.indices.length; index += 1) {
      baseIndices.push(soup.indices[index]!);
    }
  } else {
    // This DTO has no bisect-direction flag, so its documented side is the positive axis half-space.
    const vertexByCoordinate = new Map<string, number>();
    const addVertex = (point: MutablePoint3): number => {
      if (Math.abs(pointAxis(point, axis)) <= Math.max(seamThreshold, 1e-12)) point[axis] = 0;
      const key = `${point[0].toPrecision(15)}|${point[1].toPrecision(15)}|${point[2].toPrecision(15)}`;
      const existing = vertexByCoordinate.get(key);
      if (existing !== undefined) return existing;
      const next = basePositions.length / 3;
      basePositions.push(point[0], point[1], point[2]);
      vertexByCoordinate.set(key, next);
      return next;
    };
    for (let index = 0; index < soup.indices.length; index += 3) {
      const triangle = [0, 1, 2].map((corner): MutablePoint3 => {
        const vertexIndex = soup.indices[index + corner]! * 3;
        return [
          soup.positions[vertexIndex]!,
          soup.positions[vertexIndex + 1]!,
          soup.positions[vertexIndex + 2]!,
        ];
      });
      const clipped = clipTriangleToPositiveAxis(triangle, axis);
      if (clipped.length < 3) continue;
      const polygon = clipped.map(addVertex);
      for (let corner = 1; corner + 1 < polygon.length; corner += 1) {
        const a = polygon[0]!;
        const b = polygon[corner]!;
        const c = polygon[corner + 1]!;
        if (a !== b && b !== c && c !== a) baseIndices.push(a, b, c);
      }
    }
  }
  if (baseIndices.length < 3) {
    return fail("invalid-parameter", `mirror ${mod.id}: bisect/merge collapsed the source mesh`);
  }

  const baseVertexCount = basePositions.length / 3;
  const positions = [...basePositions];
  const mirroredVertex = new Uint32Array(baseVertexCount);
  for (let vertexIndex = 0; vertexIndex < baseVertexCount; vertexIndex += 1) {
    const sourceOffset = vertexIndex * 3;
    const coordinate = basePositions[sourceOffset + axis]!;
    if (mod.merge && Math.abs(coordinate) <= mod.mergeThreshold) {
      mirroredVertex[vertexIndex] = vertexIndex;
      continue;
    }
    const reflected: MutablePoint3 = [
      basePositions[sourceOffset]!,
      basePositions[sourceOffset + 1]!,
      basePositions[sourceOffset + 2]!,
    ];
    reflected[axis] = -reflected[axis]!;
    mirroredVertex[vertexIndex] = positions.length / 3;
    positions.push(reflected[0], reflected[1], reflected[2]);
  }
  const indices = [...baseIndices];
  for (let index = 0; index < baseIndices.length; index += 3) {
    const a = mirroredVertex[baseIndices[index]!]!;
    const b = mirroredVertex[baseIndices[index + 1]!]!;
    const c = mirroredVertex[baseIndices[index + 2]!]!;
    if (a !== b && b !== c && c !== a
      && !(a === baseIndices[index] && b === baseIndices[index + 1]
        && c === baseIndices[index + 2])) {
      indices.push(a, c, b);
    }
  }
  const exactTopology = validateEvaluatedTopologyCounts(
    positions.length / 3,
    indices.length,
    `mirror ${mod.id}`,
  );
  if (!exactTopology.ok) return exactTopology;
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

function applyArray(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshArrayModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  if (!mod.realizeInstances) {
    return fail(
      "invalid-parameter",
      `array ${mod.id}: unrealized instances cannot be represented by the editable-mesh result contract`,
    );
  }
  const outputVertices = checkedProduct(metrics.vertexCount, mod.count);
  const outputIndices = checkedProduct(metrics.indexCount, mod.count);
  if (outputVertices === null || outputIndices === null) {
    return fail("budget-exceeded", `array ${mod.id}: topology arithmetic overflow`);
  }
  const stagingBytes = checkedSum(
    checkedProduct(outputVertices, 12) ?? Number.NaN,
    checkedProduct(outputIndices, 4) ?? Number.NaN,
  );
  const reserved = reserveGeneratedMesh(
    budget,
    outputVertices,
    outputIndices,
    stagingBytes ?? Number.NaN,
    checkedSum(outputVertices, outputIndices) ?? Number.NaN,
    `array ${mod.id}`,
  );
  if (!reserved.ok) return reserved;
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, `array ${mod.id}`);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const positions = new Float32Array(outputVertices * 3);
  const indices = new Uint32Array(outputIndices);
  const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  const totalAngle = mod.radialAngleRad ?? Math.PI * 2;
  for (let instance = 0; instance < mod.count; instance += 1) {
    const angle = mod.mode === "radial" ? totalAngle * (instance / mod.count) : 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offsetX = mod.mode === "radial"
      ? mod.offset.x * cos - mod.offset.z * sin
      : mod.offset.x * instance;
    const offsetY = mod.offset.y * instance;
    const offsetZ = mod.mode === "radial"
      ? mod.offset.x * sin + mod.offset.z * cos
      : mod.offset.z * instance;
    const vertexBase = instance * metrics.vertexCount;
    for (let vertexIndex = 0; vertexIndex < metrics.vertexCount; vertexIndex += 1) {
      const sourceOffset = vertexIndex * 3;
      const x = soup.positions[sourceOffset]!;
      const y = soup.positions[sourceOffset + 1]!;
      const z = soup.positions[sourceOffset + 2]!;
      const outputX = (mod.mode === "radial" ? x * cos - z * sin : x) + offsetX;
      const outputY = y + offsetY;
      const outputZ = (mod.mode === "radial" ? x * sin + z * cos : z) + offsetZ;
      if (!finiteInRange(outputX, -coordinateLimit, coordinateLimit)
        || !finiteInRange(outputY, -coordinateLimit, coordinateLimit)
        || !finiteInRange(outputZ, -coordinateLimit, coordinateLimit)) {
        return fail("invalid-parameter", `array ${mod.id}: transformed coordinate is out of range`);
      }
      const outputOffset = (vertexBase + vertexIndex) * 3;
      positions[outputOffset] = outputX;
      positions[outputOffset + 1] = outputY;
      positions[outputOffset + 2] = outputZ;
    }
    const indexBase = instance * metrics.indexCount;
    for (let index = 0; index < metrics.indexCount; index += 1) {
      indices[indexBase + index] = soup.indices[index]! + vertexBase;
    }
  }
  return ok(soupToMesh(positions, indices));
}

interface SolidifyEdgeUse {
  readonly a: number;
  readonly b: number;
  count: number;
}

function triangleCornerAngle(
  positions: Float32Array,
  center: number,
  left: number,
  right: number,
): number {
  const cx = positions[center * 3]!;
  const cy = positions[center * 3 + 1]!;
  const cz = positions[center * 3 + 2]!;
  const lx = positions[left * 3]! - cx;
  const ly = positions[left * 3 + 1]! - cy;
  const lz = positions[left * 3 + 2]! - cz;
  const rx = positions[right * 3]! - cx;
  const ry = positions[right * 3 + 1]! - cy;
  const rz = positions[right * 3 + 2]! - cz;
  const denominator = Math.hypot(lx, ly, lz) * Math.hypot(rx, ry, rz);
  if (denominator <= 1e-12) return 0;
  const cosine = Math.max(-1, Math.min(1, (lx * rx + ly * ry + lz * rz) / denominator));
  return Math.acos(cosine);
}

function applySolidify(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshSolidifyModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  if (mod.thickness === 0) return ok(mesh);
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, `solidify ${mod.id}`);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const normalBytes = checkedSum(
    checkedProduct(metrics.vertexCount, Float64Array.BYTES_PER_ELEMENT * 5) ?? Number.NaN,
    checkedProduct(metrics.indexCount, 80) ?? Number.NaN,
  );
  const analysis = reserveEvaluationBudget(budget, {
    bytes: normalBytes ?? Number.NaN,
    workUnits: checkedSum(metrics.indexCount * 3, metrics.vertexCount * 2) ?? Number.NaN,
  }, `solidify ${mod.id} boundary/normal analysis`);
  if (!analysis.ok) return analysis;

  const normals = new Float64Array(metrics.vertexCount * 3);
  const projectionSums = new Float64Array(metrics.vertexCount);
  const projectionWeights = new Float64Array(metrics.vertexCount);
  const edgeUses = new Map<string, SolidifyEdgeUse>();
  const addEdge = (a: number, b: number): StudioMeshModifierResult<undefined> => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const found = edgeUses.get(key);
    if (!found) {
      edgeUses.set(key, { a, b, count: 1 });
      return ok(undefined);
    }
    found.count += 1;
    if (found.count > 2) {
      return fail("invalid-stack", `solidify ${mod.id}: non-manifold edge ${key}`);
    }
    return ok(undefined);
  };
  for (let index = 0; index < soup.indices.length; index += 3) {
    const ia = soup.indices[index]!;
    const ib = soup.indices[index + 1]!;
    const ic = soup.indices[index + 2]!;
    const ax = soup.positions[ia * 3]!;
    const ay = soup.positions[ia * 3 + 1]!;
    const az = soup.positions[ia * 3 + 2]!;
    const bx = soup.positions[ib * 3]! - ax;
    const by = soup.positions[ib * 3 + 1]! - ay;
    const bz = soup.positions[ib * 3 + 2]! - az;
    const cx = soup.positions[ic * 3]! - ax;
    const cy = soup.positions[ic * 3 + 1]! - ay;
    const cz = soup.positions[ic * 3 + 2]! - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const faceNormalLength = Math.hypot(nx, ny, nz);
    if (faceNormalLength <= 1e-12) {
      return fail("invalid-stack", `solidify ${mod.id}: zero-area triangle`);
    }
    nx /= faceNormalLength;
    ny /= faceNormalLength;
    nz /= faceNormalLength;
    for (const [vertexIndex, left, right] of [
      [ia, ib, ic],
      [ib, ic, ia],
      [ic, ia, ib],
    ] as const) {
      const weight = triangleCornerAngle(soup.positions, vertexIndex, left, right);
      normals[vertexIndex * 3]! += nx * weight;
      normals[vertexIndex * 3 + 1]! += ny * weight;
      normals[vertexIndex * 3 + 2]! += nz * weight;
    }
    for (const [a, b] of [[ia, ib], [ib, ic], [ic, ia]] as const) {
      const edge = addEdge(a, b);
      if (!edge.ok) return edge;
    }
  }
  for (let vertexIndex = 0; vertexIndex < metrics.vertexCount; vertexIndex += 1) {
    const length = Math.hypot(
      normals[vertexIndex * 3]!,
      normals[vertexIndex * 3 + 1]!,
      normals[vertexIndex * 3 + 2]!,
    );
    if (length <= 1e-12) {
      return fail("invalid-stack", `solidify ${mod.id}: vertex ${vertexIndex} has no stable normal`);
    }
    normals[vertexIndex * 3]! /= length;
    normals[vertexIndex * 3 + 1]! /= length;
    normals[vertexIndex * 3 + 2]! /= length;
  }
  if (mod.evenThickness) {
    for (let index = 0; index < soup.indices.length; index += 3) {
      const ia = soup.indices[index]!;
      const ib = soup.indices[index + 1]!;
      const ic = soup.indices[index + 2]!;
      const ax = soup.positions[ia * 3]!;
      const ay = soup.positions[ia * 3 + 1]!;
      const az = soup.positions[ia * 3 + 2]!;
      const abx = soup.positions[ib * 3]! - ax;
      const aby = soup.positions[ib * 3 + 1]! - ay;
      const abz = soup.positions[ib * 3 + 2]! - az;
      const acx = soup.positions[ic * 3]! - ax;
      const acy = soup.positions[ic * 3 + 1]! - ay;
      const acz = soup.positions[ic * 3 + 2]! - az;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      for (const [vertexIndex, left, right] of [
        [ia, ib, ic],
        [ib, ic, ia],
        [ic, ia, ib],
      ] as const) {
        const weight = triangleCornerAngle(soup.positions, vertexIndex, left, right);
        projectionSums[vertexIndex]! += Math.abs(
          normals[vertexIndex * 3]! * nx
          + normals[vertexIndex * 3 + 1]! * ny
          + normals[vertexIndex * 3 + 2]! * nz,
        ) * weight;
        projectionWeights[vertexIndex]! += weight;
      }
    }
  }
  const boundaryEdges = mod.rim
    ? [...edgeUses.values()].filter(({ count }) => count === 1)
    : [];
  const outputVertices = checkedProduct(metrics.vertexCount, 2);
  const rimIndices = checkedProduct(boundaryEdges.length, 6);
  const shellIndices = checkedProduct(metrics.indexCount, 2);
  const outputIndices = rimIndices === null || shellIndices === null
    ? null
    : checkedSum(shellIndices, rimIndices);
  if (outputVertices === null || outputIndices === null) {
    return fail("budget-exceeded", `solidify ${mod.id}: topology arithmetic overflow`);
  }
  const stagingBytes = checkedSum(
    checkedProduct(outputVertices, 12) ?? Number.NaN,
    checkedProduct(outputIndices, 4) ?? Number.NaN,
  );
  const reserved = reserveGeneratedMesh(
    budget,
    outputVertices,
    outputIndices,
    stagingBytes ?? Number.NaN,
    checkedSum(outputVertices, outputIndices) ?? Number.NaN,
    `solidify ${mod.id}`,
  );
  if (!reserved.ok) return reserved;

  const positions = new Float32Array(outputVertices * 3);
  const indices = new Uint32Array(outputIndices);
  const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  for (let vertexIndex = 0; vertexIndex < metrics.vertexCount; vertexIndex += 1) {
    const sourceOffset = vertexIndex * 3;
    positions[sourceOffset] = soup.positions[sourceOffset]!;
    positions[sourceOffset + 1] = soup.positions[sourceOffset + 1]!;
    positions[sourceOffset + 2] = soup.positions[sourceOffset + 2]!;
    const projection = mod.evenThickness
      ? projectionSums[vertexIndex]! / projectionWeights[vertexIndex]!
      : 1;
    if (!Number.isFinite(projection) || projection <= 1e-6) {
      return fail("invalid-stack", `solidify ${mod.id}: even-thickness projection is unstable`);
    }
    const distance = mod.thickness / projection;
    const outputOffset = (metrics.vertexCount + vertexIndex) * 3;
    const outputX = soup.positions[sourceOffset]! + normals[sourceOffset]! * distance;
    const outputY = soup.positions[sourceOffset + 1]! + normals[sourceOffset + 1]! * distance;
    const outputZ = soup.positions[sourceOffset + 2]! + normals[sourceOffset + 2]! * distance;
    if (!finiteInRange(outputX, -coordinateLimit, coordinateLimit)
      || !finiteInRange(outputY, -coordinateLimit, coordinateLimit)
      || !finiteInRange(outputZ, -coordinateLimit, coordinateLimit)) {
      return fail("invalid-parameter", `solidify ${mod.id}: offset coordinate is out of range`);
    }
    positions[outputOffset] = outputX;
    positions[outputOffset + 1] = outputY;
    positions[outputOffset + 2] = outputZ;
  }
  let outputIndex = 0;
  for (let index = 0; index < soup.indices.length; index += 3) {
    const a = soup.indices[index]!;
    const b = soup.indices[index + 1]!;
    const c = soup.indices[index + 2]!;
    indices.set([a, b, c], outputIndex);
    outputIndex += 3;
    indices.set([
      a + metrics.vertexCount,
      c + metrics.vertexCount,
      b + metrics.vertexCount,
    ], outputIndex);
    outputIndex += 3;
  }
  for (const edge of boundaryEdges) {
    indices.set([
      edge.a,
      edge.a + metrics.vertexCount,
      edge.b + metrics.vertexCount,
      edge.a,
      edge.b + metrics.vertexCount,
      edge.b,
    ], outputIndex);
    outputIndex += 6;
  }
  return ok(soupToMesh(positions, indices));
}

/** Dissolve only truly coplanar, uncreased triangulation seams before angle-limited beveling. */
function mergeCoplanarFacesForBevel(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  const parents = new Int32Array(mesh.faces.length);
  for (let index = 0; index < parents.length; index += 1) parents[index] = index;
  const find = (value: number): number => {
    let root = value;
    while (parents[root] !== root) root = parents[root]!;
    let cursor = value;
    while (parents[cursor] !== cursor) {
      const next = parents[cursor]!;
      parents[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const normals = new Map<number, StudioMeshVec3>();
  const normalFor = (faceId: number): StudioMeshVec3 => {
    const found = normals.get(faceId);
    if (found) return found;
    const normal = faceNormalStudioEditableMesh(mesh, faceId);
    normals.set(faceId, normal);
    return normal;
  };
  let mergeCount = 0;
  for (const edge of mesh.halfEdges) {
    if (edge.twin < 0 || edge.id > edge.twin || edge.crease > 0
      || mesh.halfEdges[edge.twin]!.crease > 0) continue;
    const twin = mesh.halfEdges[edge.twin]!;
    const left = normalFor(edge.face);
    const right = normalFor(twin.face);
    const dot = left.x * right.x + left.y * right.y + left.z * right.z;
    // Float32-derived offset shells can differ by a few ulps across a triangulation seam.
    if (dot >= 1 - 1e-5) {
      unite(edge.face, twin.face);
      mergeCount += 1;
    }
  }
  if (mergeCount === 0) return ok(mesh);

  const facesByRoot = new Map<number, number[]>();
  for (let faceId = 0; faceId < mesh.faces.length; faceId += 1) {
    const root = find(faceId);
    const faces = facesByRoot.get(root) ?? [];
    faces.push(faceId);
    facesByRoot.set(root, faces);
  }
  const polygons: number[][] = [];
  for (const faceIds of facesByRoot.values()) {
    const faceSet = new Set(faceIds);
    const boundary = mesh.halfEdges.filter((edge) => (
      faceSet.has(edge.face)
      && (edge.twin < 0 || !faceSet.has(mesh.halfEdges[edge.twin]!.face))
    ));
    const edgeByOrigin = new Map<number, number>();
    for (const edge of boundary) {
      const origin = mesh.halfEdges[edge.prev]!.vertex;
      if (edgeByOrigin.has(origin)) {
        return fail("invalid-stack", "coplanar bevel region has a branch or hole");
      }
      edgeByOrigin.set(origin, edge.id);
    }
    const first = boundary[0];
    if (!first) return fail("invalid-stack", "coplanar bevel region has no boundary");
    const loop: number[] = [];
    const used = new Set<number>();
    let cursor = first.id;
    while (!used.has(cursor)) {
      used.add(cursor);
      const edge = mesh.halfEdges[cursor]!;
      loop.push(mesh.halfEdges[edge.prev]!.vertex);
      const next = edgeByOrigin.get(edge.vertex);
      if (next === undefined) {
        return fail("invalid-stack", "coplanar bevel region boundary does not close");
      }
      cursor = next;
    }
    if (cursor !== first.id || used.size !== boundary.length || loop.length < 3) {
      return fail("invalid-stack", "coplanar bevel region has multiple boundary loops");
    }
    polygons.push(loop);
  }
  const construction = reserveGeneratedMesh(
    budget,
    metrics.vertexCount,
    metrics.indexCount,
    checkedSum(
      checkedProduct(metrics.vertexCount, 64) ?? Number.NaN,
      checkedProduct(metrics.indexCount, 32) ?? Number.NaN,
    ) ?? Number.NaN,
    checkedSum(mesh.halfEdges.length, mesh.faces.length * 2) ?? Number.NaN,
    "bevel coplanar seam dissolve",
  );
  if (!construction.ok) return construction;
  try {
    const merged = createStudioEditableMeshFromPolygons(
      mesh.vertices.map(({ position }) => ({ ...position })),
      polygons,
    );
    if (mesh.halfEdges.every(({ twin }) => twin >= 0)
      && merged.halfEdges.some(({ twin }) => twin < 0)) {
      return fail("invalid-stack", "coplanar seam dissolve opened a closed shell");
    }
    return ok(merged);
  } catch (error) {
    return fail(
      "invalid-stack",
      error instanceof Error ? error.message : "coplanar seam dissolve failed",
    );
  }
}

/**
 * Build a complete segments=1 bevel in one immutable reconstruction.
 * Face strips, edge chamfers, and fully cut vertex caps are emitted together; there is no
 * sequential "some edges succeeded" state to leak when topology validation fails.
 */
function bevelSelectedEdgesSingleSegment(
  mesh: StudioEditableMesh,
  edgeIds: readonly number[],
  amount: number,
): StudioMeshModifierResult<StudioEditableMesh> {
  const selectedKeys = new Set<string>();
  const keyForVertices = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const edgeId of edgeIds) {
    const edge = mesh.halfEdges[edgeId];
    if (!edge) return fail("invalid-stack", `bevel edge ${edgeId} disappeared before rebuild`);
    const origin = mesh.halfEdges[edge.prev]!.vertex;
    selectedKeys.add(keyForVertices(origin, edge.vertex));
  }
  const incidentEdgesByVertex = new Map<number, Set<string>>();
  for (const edge of mesh.halfEdges) {
    if (edge.twin >= 0 && edge.id > edge.twin) continue;
    const origin = mesh.halfEdges[edge.prev]!.vertex;
    const edgeKey = keyForVertices(origin, edge.vertex);
    for (const vertexId of [origin, edge.vertex]) {
      const incident = incidentEdgesByVertex.get(vertexId) ?? new Set<string>();
      incident.add(edgeKey);
      incidentEdgesByVertex.set(vertexId, incident);
    }
  }
  for (const [vertexId, incident] of incidentEdgesByVertex) {
    let selectedCount = 0;
    for (const edgeKey of incident) {
      if (selectedKeys.has(edgeKey)) selectedCount += 1;
    }
    if (selectedCount > 0 && selectedCount !== incident.size) {
      return fail(
        "invalid-parameter",
        `bevel vertex ${vertexId} has a partial edge selection (${selectedCount}/${incident.size}); vertex-complete selection is required`,
      );
    }
  }

  const positions: StudioMeshVec3[] = mesh.vertices.map(({ position }) => ({ ...position }));
  const polygons: number[][] = [];
  const cornerPoints = new Map<string, number>();
  const pointsByOriginalVertex = new Map<number, number[]>();
  const capNextByOriginalVertex = new Map<number, Map<number, number>>();
  const originalVerticesStillUsed = new Set<number>();
  const t = Math.min(0.49, Math.max(0.01, amount));

  const faceEdgeLoop = (start: number): number[] => {
    const loop: number[] = [];
    let cursor = start;
    do {
      loop.push(cursor);
      cursor = mesh.halfEdges[cursor]!.next;
    } while (cursor !== start);
    return loop;
  };
  const pointForFullySelectedCorner = (
    faceId: number,
    vertexId: number,
    previousVertexId: number,
    nextVertexId: number,
  ): number => {
    const key = `${faceId}|${vertexId}|fully-selected`;
    const existing = cornerPoints.get(key);
    if (existing !== undefined) return existing;
    const source = mesh.vertices[vertexId]!.position;
    const previous = mesh.vertices[previousVertexId]!.position;
    const next = mesh.vertices[nextVertexId]!.position;
    const point = v(
      source.x + (previous.x - source.x) * t + (next.x - source.x) * t,
      source.y + (previous.y - source.y) * t + (next.y - source.y) * t,
      source.z + (previous.z - source.z) * t + (next.z - source.z) * t,
    );
    const pointIndex = positions.length;
    positions.push(point);
    cornerPoints.set(key, pointIndex);
    cornerPoints.set(`${faceId}|${vertexId}|incoming`, pointIndex);
    cornerPoints.set(`${faceId}|${vertexId}|outgoing`, pointIndex);
    const vertexPoints = pointsByOriginalVertex.get(vertexId) ?? [];
    vertexPoints.push(pointIndex);
    pointsByOriginalVertex.set(vertexId, vertexPoints);
    return pointIndex;
  };

  for (const face of mesh.faces) {
    const edgeLoop = faceEdgeLoop(face.he);
    const polygon: number[] = [];
    for (let corner = 0; corner < edgeLoop.length; corner += 1) {
      const outgoing = mesh.halfEdges[edgeLoop[corner]!]!;
      const incoming = mesh.halfEdges[edgeLoop[
        (corner + edgeLoop.length - 1) % edgeLoop.length
      ]!]!;
      const vertexId = mesh.halfEdges[outgoing.prev]!.vertex;
      const previousVertexId = mesh.halfEdges[incoming.prev]!.vertex;
      const nextVertexId = outgoing.vertex;
      const incomingSelected = selectedKeys.has(keyForVertices(previousVertexId, vertexId));
      const outgoingSelected = selectedKeys.has(keyForVertices(vertexId, nextVertexId));
      if (incomingSelected !== outgoingSelected) {
        return fail("invalid-parameter", `bevel face ${face.id} has a partial corner selection`);
      }
      if (incomingSelected && outgoingSelected) {
        polygon.push(pointForFullySelectedCorner(
          face.id,
          vertexId,
          previousVertexId,
          nextVertexId,
        ));
      } else {
        polygon.push(vertexId);
        originalVerticesStillUsed.add(vertexId);
      }
    }
    const clean = polygon.filter((point, index) => point !== polygon[index - 1]);
    if (clean.length < 3) {
      return fail("invalid-stack", `bevel face ${face.id} collapsed during corner reconstruction`);
    }
    polygons.push(clean);
  }

  for (const edgeId of edgeIds) {
    const edge = mesh.halfEdges[edgeId]!;
    const origin = mesh.halfEdges[edge.prev]!.vertex;
    const destination = edge.vertex;
    const originOnLeft = cornerPoints.get(`${edge.face}|${origin}|outgoing`);
    const destinationOnLeft = cornerPoints.get(`${edge.face}|${destination}|incoming`);
    if (originOnLeft === undefined || destinationOnLeft === undefined) {
      return fail("invalid-stack", `bevel edge ${edgeId} is missing its left face strip`);
    }
    if (edge.twin < 0) {
      polygons.push([origin, destination, destinationOnLeft, originOnLeft]);
      originalVerticesStillUsed.add(origin);
      originalVerticesStillUsed.add(destination);
      continue;
    }
    const twin = mesh.halfEdges[edge.twin]!;
    const destinationOnRight = cornerPoints.get(`${twin.face}|${destination}|outgoing`);
    const originOnRight = cornerPoints.get(`${twin.face}|${origin}|incoming`);
    if (destinationOnRight === undefined || originOnRight === undefined) {
      return fail("invalid-stack", `bevel edge ${edgeId} is missing its right face strip`);
    }
    polygons.push([
      destinationOnLeft,
      originOnLeft,
      originOnRight,
      destinationOnRight,
    ]);
    const originCapNext = capNextByOriginalVertex.get(origin) ?? new Map<number, number>();
    originCapNext.set(originOnRight, originOnLeft);
    capNextByOriginalVertex.set(origin, originCapNext);
    const destinationCapNext = capNextByOriginalVertex.get(destination)
      ?? new Map<number, number>();
    destinationCapNext.set(destinationOnLeft, destinationOnRight);
    capNextByOriginalVertex.set(destination, destinationCapNext);
  }

  for (const [vertexId, rawPoints] of pointsByOriginalVertex) {
    if (originalVerticesStillUsed.has(vertexId)) continue;
    const pointIds = [...new Set(rawPoints)];
    if (pointIds.length < 3) {
      return fail("invalid-stack", `bevel vertex ${vertexId} has an incomplete cap`);
    }
    const capNext = capNextByOriginalVertex.get(vertexId);
    if (!capNext || capNext.size !== pointIds.length) {
      return fail("invalid-stack", `bevel vertex ${vertexId} cap adjacency is incomplete`);
    }
    const cap: number[] = [];
    const start = pointIds[0]!;
    let cursor = start;
    do {
      if (cap.includes(cursor)) {
        return fail("invalid-stack", `bevel vertex ${vertexId} cap cycle repeats early`);
      }
      cap.push(cursor);
      const next = capNext.get(cursor);
      if (next === undefined) {
        return fail("invalid-stack", `bevel vertex ${vertexId} cap cycle is open`);
      }
      cursor = next;
    } while (cursor !== start);
    if (cap.length !== pointIds.length) {
      return fail("invalid-stack", `bevel vertex ${vertexId} has multiple cap cycles`);
    }
    polygons.push(cap);
  }

  try {
    const usedVertexIds = [...new Set(polygons.flat())].toSorted((left, right) => left - right);
    const compactIndex = new Map(usedVertexIds.map((vertexId, index) => [vertexId, index] as const));
    const compactPositions = usedVertexIds.map((vertexId) => positions[vertexId]!);
    const compactPolygons = polygons.map((polygon) => polygon.map((vertexId) => (
      compactIndex.get(vertexId)!
    )));
    const beveled = createStudioEditableMeshFromPolygons(compactPositions, compactPolygons);
    const sourceClosed = mesh.halfEdges.every(({ twin }) => twin >= 0);
    const openEdges = beveled.halfEdges.filter(({ twin }) => twin < 0).length;
    if (sourceClosed && openEdges > 0) {
      return fail(
        "invalid-stack",
        `bevel reconstruction opened a previously closed shell (${openEdges} boundary half-edges)`,
      );
    }
    if (beveled.vertices.length <= mesh.vertices.length
      || beveled.faces.length <= mesh.faces.length) {
      return fail("invalid-stack", "bevel reconstruction did not increase topology");
    }
    return ok(beveled);
  } catch (error) {
    return fail(
      "invalid-stack",
      error instanceof Error ? error.message : "bevel reconstruction failed",
    );
  }
}

function applyBevel(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshBevelModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  if (mod.amount === 0) return ok(mesh);
  if (mod.amount > 0.45) {
    return fail("invalid-parameter", `bevel ${mod.id}: amount must be within 0..0.45`);
  }
  if (mod.segments !== 1) {
    return fail(
      "invalid-parameter",
      `bevel ${mod.id}: exact multi-segment topology is unavailable; segments must be 1`,
    );
  }
  const selectionBytes = checkedSum(
    checkedProduct(mesh.faces.length, 64) ?? Number.NaN,
    checkedProduct(mesh.halfEdges.length, 16) ?? Number.NaN,
  );
  const selectionReserve = reserveEvaluationBudget(budget, {
    bytes: selectionBytes ?? Number.NaN,
    workUnits: checkedSum(mesh.faces.length * 2, mesh.halfEdges.length * 2) ?? Number.NaN,
  }, `bevel ${mod.id} edge selection`);
  if (!selectionReserve.ok) return selectionReserve;
  const merged = mergeCoplanarFacesForBevel(mesh, metrics, budget);
  if (!merged.ok) return merged;
  const workingMesh = merged.value;
  const workingMetricsResult = inspectEvaluationMesh(
    workingMesh,
    budget,
    `bevel ${mod.id} coplanar-normalized input`,
    false,
  );
  if (!workingMetricsResult.ok) return workingMetricsResult;
  const workingMetrics = workingMetricsResult.value;
  const faceNormals = new Map<number, StudioMeshVec3>();
  const normalFor = (faceId: number): StudioMeshVec3 => {
    const cached = faceNormals.get(faceId);
    if (cached) return cached;
    const normal = faceNormalStudioEditableMesh(workingMesh, faceId);
    faceNormals.set(faceId, normal);
    return normal;
  };
  const edgeIds: number[] = [];
  const effectiveFactors: number[] = [];
  for (const edge of workingMesh.halfEdges) {
    if (edge.twin >= 0 && edge.id > edge.twin) continue;
    let angle = Math.PI;
    if (edge.twin >= 0) {
      const left = normalFor(edge.face);
      const right = normalFor(workingMesh.halfEdges[edge.twin]!.face);
      const dot = Math.max(-1, Math.min(1,
        left.x * right.x + left.y * right.y + left.z * right.z,
      ));
      angle = Math.acos(dot);
    }
    if (angle + 1e-9 < mod.angleLimitRad) continue;
    edgeIds.push(edge.id);
    const twinCrease = edge.twin >= 0
      ? workingMesh.halfEdges[edge.twin]!.crease
      : edge.crease;
    const weight = Math.max(edge.crease, twinCrease);
    effectiveFactors.push((1 - mod.weightInfluence) + mod.weightInfluence * weight);
  }
  if (edgeIds.length === 0) return ok(mesh);
  const firstFactor = effectiveFactors[0]!;
  if (effectiveFactors.some((factor) => Math.abs(factor - firstFactor) > 1e-6)) {
    return fail(
      "invalid-parameter",
      `bevel ${mod.id}: mixed edge weights require a per-edge bevel kernel`,
    );
  }
  const effectiveAmount = mod.amount * firstFactor;
  if (effectiveAmount <= 1e-9) return ok(mesh);
  const bevelWork = checkedProduct(
    edgeIds.length,
    checkedSum(workingMesh.halfEdges.length, workingMesh.faces.length) ?? Number.NaN,
  );
  const worstVertices = checkedSum(workingMetrics.vertexCount, edgeIds.length * 4);
  const worstIndices = checkedSum(workingMesh.halfEdges.length * 6, edgeIds.length * 18);
  if (bevelWork === null || worstVertices === null || worstIndices === null) {
    return fail("budget-exceeded", `bevel ${mod.id}: topology/work arithmetic overflow`);
  }
  const reserved = reserveGeneratedMesh(
    budget,
    worstVertices,
    worstIndices,
    checkedSum(
      checkedProduct(worstVertices, 64) ?? Number.NaN,
      checkedProduct(worstIndices, 32) ?? Number.NaN,
    ) ?? Number.NaN,
    bevelWork,
    `bevel ${mod.id}`,
  );
  if (!reserved.ok) return reserved;
  const beveled = bevelSelectedEdgesSingleSegment(workingMesh, edgeIds, effectiveAmount);
  if (!beveled.ok) {
    return fail(
      beveled.code === "budget-exceeded" ? "budget-exceeded" : "invalid-stack",
      `bevel ${mod.id}: ${beveled.detail}`,
    );
  }
  const outputMetrics = inspectEvaluationMesh(
    beveled.value,
    budget,
    `bevel ${mod.id} result`,
    false,
  );
  if (!outputMetrics.ok) return outputMetrics;
  return ok(beveled.value);
}

/**
 * MOD-017: Catmull-lite subdivision (mid-edge split + optional neighbor smoothing),
 * evaluated non-destructively under the same budget discipline as the other modifiers.
 */
function applySubdivision(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshSubdivisionModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  let current = mesh;
  let currentMetrics = metrics;
  for (let level = 0; level < mod.levels; level += 1) {
    const context = `subdivision ${mod.id} level ${level + 1}`;
    const soupResult = materializeTriangleSoup(current, currentMetrics, budget, context);
    if (!soupResult.ok) return soupResult;
    const soup = soupResult.value;
    const vertexCount = soup.positions.length / 3;
    const triangleCount = soup.indices.length / 3;
    const worstVertices = checkedSum(vertexCount, checkedProduct(triangleCount, 2) ?? Number.NaN);
    const worstIndices = checkedProduct(soup.indices.length, 4);
    if (worstVertices === null || worstIndices === null) {
      return fail("budget-exceeded", `${context}: topology arithmetic overflow`);
    }
    const reserved = reserveGeneratedMesh(
      budget,
      worstVertices,
      worstIndices,
      checkedSum(
        checkedProduct(worstVertices, 96) ?? Number.NaN,
        checkedProduct(worstIndices, 24) ?? Number.NaN,
      ) ?? Number.NaN,
      checkedSum(worstVertices, worstIndices) ?? Number.NaN,
      context,
    );
    if (!reserved.ok) return reserved;
    const edgeMid = new Map<string, number>();
    const positions: number[] = [...soup.positions];
    const midOf = (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}|${hi}`;
      let idx = edgeMid.get(key);
      if (idx !== undefined) return idx;
      idx = positions.length / 3;
      positions.push(
        (soup.positions[a * 3]! + soup.positions[b * 3]!) / 2,
        (soup.positions[a * 3 + 1]! + soup.positions[b * 3 + 1]!) / 2,
        (soup.positions[a * 3 + 2]! + soup.positions[b * 3 + 2]!) / 2,
      );
      edgeMid.set(key, idx);
      return idx;
    };
    const indices: number[] = [];
    for (let t = 0; t < soup.indices.length; t += 3) {
      const a = soup.indices[t]!;
      const b = soup.indices[t + 1]!;
      const c = soup.indices[t + 2]!;
      const ab = midOf(a, b);
      const bc = midOf(b, c);
      const ca = midOf(c, a);
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    if (mod.smooth) {
      const accum = new Float64Array(vertexCount * 3);
      const degree = new Uint32Array(vertexCount);
      for (let t = 0; t < soup.indices.length; t += 3) {
        for (let k = 0; k < 3; k += 1) {
          const i = soup.indices[t + k]!;
          const j = soup.indices[t + ((k + 1) % 3)]!;
          accum[i * 3]! += soup.positions[j * 3]!;
          accum[i * 3 + 1]! += soup.positions[j * 3 + 1]!;
          accum[i * 3 + 2]! += soup.positions[j * 3 + 2]!;
          degree[i]! += 1;
        }
      }
      for (let i = 0; i < vertexCount; i += 1) {
        if (degree[i] === 0) continue;
        positions[i * 3] = soup.positions[i * 3]! * 0.5
          + (accum[i * 3]! / degree[i]!) * 0.5;
        positions[i * 3 + 1] = soup.positions[i * 3 + 1]! * 0.5
          + (accum[i * 3 + 1]! / degree[i]!) * 0.5;
        positions[i * 3 + 2] = soup.positions[i * 3 + 2]! * 0.5
          + (accum[i * 3 + 2]! / degree[i]!) * 0.5;
      }
    }
    current = soupToMesh(new Float32Array(positions), new Uint32Array(indices));
    const inspected = inspectEvaluationMesh(current, budget, `${context} result`, false);
    if (!inspected.ok) return inspected;
    currentMetrics = inspected.value;
  }
  return ok(current);
}

/** MOD-019 subset: weld duplicated vertices by positional quantum and drop degenerate faces. */
function applyWeld(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshWeldModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  const context = `weld ${mod.id}`;
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, context);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const reserved = reserveGeneratedMesh(
    budget,
    soup.positions.length / 3,
    soup.indices.length,
    checkedSum(soup.positions.byteLength, soup.indices.byteLength) ?? Number.NaN,
    checkedSum(soup.positions.length, soup.indices.length) ?? Number.NaN,
    context,
  );
  if (!reserved.ok) return reserved;
  const q = 1 / mod.quantum;
  const keyOf = (i: number) =>
    `${Math.round(soup.positions[i * 3]! * q)}|${Math.round(soup.positions[i * 3 + 1]! * q)}|${Math.round(soup.positions[i * 3 + 2]! * q)}`;
  const remap = new Map<string, number>();
  const positions: number[] = [];
  const vertexIndexOf = (i: number) => {
    const key = keyOf(i);
    let target = remap.get(key);
    if (target === undefined) {
      target = positions.length / 3;
      remap.set(key, target);
      positions.push(soup.positions[i * 3]!, soup.positions[i * 3 + 1]!, soup.positions[i * 3 + 2]!);
    }
    return target;
  };
  const indices: number[] = [];
  for (let t = 0; t < soup.indices.length; t += 3) {
    const a = vertexIndexOf(soup.indices[t]!);
    const b = vertexIndexOf(soup.indices[t + 1]!);
    const c = vertexIndexOf(soup.indices[t + 2]!);
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  if (indices.length < 3) {
    return fail("invalid-parameter", `${context}: weld collapsed every face`);
  }
  return ok(soupToMesh(new Float32Array(positions), new Uint32Array(indices)));
}

/** MOD-018: deterministic shortest-edge-collapse decimation toward a triangle ratio. */
function applyDecimate(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshDecimateModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  const context = `decimate ${mod.id}`;
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, context);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const triangleCount = soup.indices.length / 3;
  const target = Math.max(4, Math.floor(triangleCount * mod.ratio));
  if (target >= triangleCount) return ok(mesh);
  // Edge-collapse keeps the shell closed; the op owns determinism and degenerate cleanup.
  const decimated = decimateStudioMesh(mesh, mod.ratio);
  if (!decimated.ok) {
    return fail(
      decimated.code === "budget-exceeded" ? "budget-exceeded" : "invalid-parameter",
      `${context}: ${decimated.detail}`,
    );
  }
  const reserved = reserveGeneratedMesh(
    budget,
    decimated.value.vertices.length,
    studioEditableMeshToTriangleSoup(decimated.value).indices.length,
    checkedProduct(decimated.value.vertices.length, 128) ?? Number.NaN,
    checkedSum(triangleCount, decimated.value.vertices.length) ?? Number.NaN,
    context,
  );
  if (!reserved.ok) return reserved;
  return ok(decimated.value);
}

/** MOD-020 subset: twist/taper/stretch along a world axis. */
function applySimpleDeform(
  mesh: StudioEditableMesh,
  metrics: StudioMeshEvaluationMetrics,
  mod: StudioMeshSimpleDeformModifier,
  budget: StudioMeshEvaluationBudget,
): StudioMeshModifierResult<StudioEditableMesh> {
  const context = `simple-deform ${mod.id}`;
  const soupResult = materializeTriangleSoup(mesh, metrics, budget, context);
  if (!soupResult.ok) return soupResult;
  const soup = soupResult.value;
  const reserved = reserveGeneratedMesh(
    budget,
    soup.positions.length / 3,
    soup.indices.length,
    checkedSum(soup.positions.byteLength, soup.indices.byteLength) ?? Number.NaN,
    checkedSum(soup.positions.length, soup.indices.length) ?? Number.NaN,
    context,
  );
  if (!reserved.ok) return reserved;
  const axisIndex = mod.axis === "x" ? 0 : mod.axis === "y" ? 1 : 2;
  const uIndex = (axisIndex + 1) % 3;
  const vIndex = (axisIndex + 2) % 3;
  const positions = new Float32Array(soup.positions);
  let minAxis = Infinity;
  let maxAxis = -Infinity;
  for (let i = axisIndex; i < positions.length; i += 3) {
    minAxis = Math.min(minAxis, positions[i]!);
    maxAxis = Math.max(maxAxis, positions[i]!);
  }
  const span = Math.max(1e-6, maxAxis - minAxis);
  for (let i = 0; i < positions.length / 3; i += 1) {
    const t = (positions[i * 3 + axisIndex]! - minAxis) / span;
    if (mod.mode === "twist") {
      const angle = mod.angleRad * t;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const u = positions[i * 3 + uIndex]!;
      const w = positions[i * 3 + vIndex]!;
      positions[i * 3 + uIndex] = u * c - w * s;
      positions[i * 3 + vIndex] = u * s + w * c;
    } else if (mod.mode === "taper") {
      const scale = 1 + (mod.factor - 1) * t;
      positions[i * 3 + uIndex] = positions[i * 3 + uIndex]! * scale;
      positions[i * 3 + vIndex] = positions[i * 3 + vIndex]! * scale;
    } else {
      positions[i * 3 + axisIndex] = positions[i * 3 + axisIndex]! * mod.factor;
    }
  }
  return ok(soupToMesh(positions, soup.indices));
}

/**
 * Pure AABB solid boolean for watertight axis-aligned boxes (shipped fallback commit path).
 * Production may inject Manifold WASM via StudioSolidBooleanBackend.
 */
export function createStudioAabbSolidBooleanBackend(): StudioSolidBooleanBackend {
  return {
    async boolean(input) {
      const bounds = (positions: Float32Array) => {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
          minX = Math.min(minX, positions[i]!);
          minY = Math.min(minY, positions[i + 1]!);
          minZ = Math.min(minZ, positions[i + 2]!);
          maxX = Math.max(maxX, positions[i]!);
          maxY = Math.max(maxY, positions[i + 1]!);
          maxZ = Math.max(maxZ, positions[i + 2]!);
        }
        return { minX, minY, minZ, maxX, maxY, maxZ };
      };
      const a = bounds(input.left.positions);
      const b = bounds(input.right.positions);
      let minX: number;
      let minY: number;
      let minZ: number;
      let maxX: number;
      let maxY: number;
      let maxZ: number;
      if (input.operation === "union") {
        minX = Math.min(a.minX, b.minX);
        minY = Math.min(a.minY, b.minY);
        minZ = Math.min(a.minZ, b.minZ);
        maxX = Math.max(a.maxX, b.maxX);
        maxY = Math.max(a.maxY, b.maxY);
        maxZ = Math.max(a.maxZ, b.maxZ);
      } else if (input.operation === "intersection") {
        minX = Math.max(a.minX, b.minX);
        minY = Math.max(a.minY, b.minY);
        minZ = Math.max(a.minZ, b.minZ);
        maxX = Math.min(a.maxX, b.maxX);
        maxY = Math.min(a.maxY, b.maxY);
        maxZ = Math.min(a.maxZ, b.maxZ);
        if (minX >= maxX || minY >= maxY || minZ >= maxZ) {
          throw new Error("boolean empty intersection");
        }
      } else {
        // difference: keep A when no overlap; when overlap, shrink A by clipping to non-overlap slab (simplified)
        minX = a.minX;
        minY = a.minY;
        minZ = a.minZ;
        maxX = a.maxX;
        maxY = a.maxY;
        maxZ = a.maxZ;
        const ox = Math.max(a.minX, b.minX) < Math.min(a.maxX, b.maxX);
        const oy = Math.max(a.minY, b.minY) < Math.min(a.maxY, b.maxY);
        const oz = Math.max(a.minZ, b.minZ) < Math.min(a.maxZ, b.maxZ);
        if (ox && oy && oz) {
          // cut maxX back if B covers the +X half of A
          if (b.minX <= a.minX && b.maxX < a.maxX) {
            minX = b.maxX;
          } else if (b.maxX >= a.maxX && b.minX > a.minX) {
            maxX = b.minX;
          }
        }
      }
      return boxSoup(minX, minY, minZ, maxX, maxY, maxZ);
    },
  };
}

function boxSoup(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array([
    minX, minY, minZ,
    maxX, minY, minZ,
    maxX, maxY, minZ,
    minX, maxY, minZ,
    minX, minY, maxZ,
    maxX, minY, maxZ,
    maxX, maxY, maxZ,
    minX, maxY, maxZ,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ]);
  return { positions, indices };
}

function validateBooleanBackendOutput(
  output: unknown,
  budget: StudioMeshEvaluationBudget,
  context: string,
): StudioMeshModifierResult<StudioTriangleSoup> {
  if (output === null || typeof output !== "object") {
    return fail("boolean-failed", `${context}: backend result must be an object`);
  }
  const positions = (output as { positions?: unknown }).positions;
  const indices = (output as { indices?: unknown }).indices;
  if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array)) {
    return fail("boolean-failed", `${context}: backend must return Float32Array/Uint32Array`);
  }
  if (positions.length < 9 || positions.length % 3 !== 0
    || indices.length < 3 || indices.length % 3 !== 0) {
    return fail("boolean-empty", `${context}: backend returned an empty or malformed triangle soup`);
  }
  const vertexCount = positions.length / 3;
  const topology = validateEvaluatedTopologyCounts(vertexCount, indices.length, context);
  if (!topology.ok) return topology;
  const backendBytes = checkedSum(positions.byteLength, indices.byteLength);
  const reserved = reserveGeneratedMesh(
    budget,
    vertexCount,
    indices.length,
    backendBytes ?? Number.NaN,
    checkedSum(positions.length, indices.length) ?? Number.NaN,
    context,
  );
  if (!reserved.ok) return reserved;
  const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  for (let index = 0; index < positions.length; index += 1) {
    if (!finiteInRange(positions[index], -coordinateLimit, coordinateLimit)) {
      return fail("boolean-failed", `${context}: backend position ${index} is non-finite or unbounded`);
    }
  }
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= vertexCount) {
      return fail("boolean-failed", `${context}: backend index ${index} is out of range`);
    }
  }
  return ok({ positions, indices });
}

export async function evaluateStudioMeshModifierStack(
  stack: StudioMeshModifierStack,
  options: { readonly booleanBackend?: StudioSolidBooleanBackend } = {},
): Promise<StudioMeshModifierResult<{
  readonly mesh: StudioEditableMesh;
  readonly sourceHash: string;
  readonly resultHash: string;
}>> {
  if (stack.revision !== STUDIO_MESH_MODIFIER_STACK_REVISION) {
    return fail("invalid-stack", "modifier stack revision is invalid");
  }
  const runtimeValidation = validateRuntimeModifiers(stack.modifiers);
  if (!runtimeValidation.ok) return runtimeValidation;
  const budget = createEvaluationBudget();
  let current = stack.source;
  let currentMetrics = inspectEvaluationMesh(current, budget, "modifier source");
  if (!currentMetrics.ok) return currentMetrics;
  // MOD-014: commit path defaults to Manifold solid CSG (with pure convex fallback).
  const backend = options.booleanBackend ?? createStudioDefaultSolidBooleanBackend();
  for (const mod of stack.modifiers) {
    if (!mod.enabled) continue;
    try {
      let applied: StudioMeshModifierResult<StudioEditableMesh>;
      if (mod.kind === "mirror") {
        applied = applyMirror(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "array") {
        applied = applyArray(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "solidify") {
        applied = applySolidify(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "bevel") {
        applied = applyBevel(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "subdivision") {
        applied = applySubdivision(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "weld") {
        applied = applyWeld(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "decimate") {
        applied = applyDecimate(current, currentMetrics.value, mod, budget);
      } else if (mod.kind === "simple-deform") {
        applied = applySimpleDeform(current, currentMetrics.value, mod, budget);
      } else {
        const leftResult = materializeTriangleSoup(
          current,
          currentMetrics.value,
          budget,
          `boolean ${mod.id}`,
        );
        if (!leftResult.ok) return leftResult;
        const left = leftResult.value;
        const backendInputBytes = checkedSum(
          left.positions.byteLength,
          left.indices.byteLength,
          mod.operand.positions.byteLength,
          mod.operand.indices.byteLength,
        );
        const backendWork = checkedSum(
          left.positions.length,
          left.indices.length,
          mod.operand.positions.length,
          mod.operand.indices.length,
        );
        const backendPreflight = reserveEvaluationBudget(budget, {
          bytes: checkedProduct(backendInputBytes ?? Number.NaN, 2) ?? Number.NaN,
          workUnits: backendWork ?? Number.NaN,
        }, `boolean ${mod.id} backend input`);
        if (!backendPreflight.ok) return backendPreflight;
        try {
          const out = await backend.boolean({
            left,
            right: mod.operand,
            operation: mod.operation,
          });
          const validatedOutput = validateBooleanBackendOutput(
            out,
            budget,
            `boolean ${mod.id} backend output`,
          );
          if (!validatedOutput.ok) return validatedOutput;
          const tris = validatedOutput.value.indices.length / 3;
          const leftTris = left.indices.length / 3;
          // Reject empty or degenerate solids (e.g. pure-convex 2-tri garbage on inverted cubes).
          if (tris < 4) {
            return fail("boolean-empty", "boolean produced empty/degenerate mesh", [
              out.diagnostic ?? "empty",
              `tris=${tris}`,
            ]);
          }
          // Unit-cube / closed solid inputs (≥12 tris) must yield a real shell after difference.
          if (mod.operation === "difference" && leftTris >= 12 && tris < 8) {
            return fail(
              "boolean-failed",
              `boolean difference degenerate solid (tris=${tris}, need ≥8 for closed input)`,
              [out.diagnostic ?? "degenerate", `tris=${tris}`],
            );
          }
          applied = ok(soupToMesh(
            validatedOutput.value.positions,
            validatedOutput.value.indices,
          ));
        } catch (error) {
          return fail(
            "boolean-failed",
            error instanceof Error ? error.message : "boolean failed",
            [error instanceof Error ? error.message : "unknown"],
          );
        }
      }
      if (!applied.ok) return applied;
      current = applied.value;
      const inspected = inspectEvaluationMesh(
        current,
        budget,
        `modifier ${mod.id} result`,
        false,
      );
      if (!inspected.ok) return inspected;
      currentMetrics = inspected;
    } catch (error) {
      return fail(
        "invalid-stack",
        error instanceof Error ? error.message : "modifier evaluation failed",
      );
    }
  }
  const hashBytes = checkedSum(
    checkedProduct(stack.source.vertices.length + current.vertices.length, 96) ?? Number.NaN,
    checkedProduct(stack.source.halfEdges.length + current.halfEdges.length, 48) ?? Number.NaN,
    checkedProduct(stack.source.faces.length + current.faces.length, 48) ?? Number.NaN,
  );
  const hashWork = checkedSum(
    stack.source.vertices.length,
    stack.source.halfEdges.length,
    stack.source.faces.length,
    current.vertices.length,
    current.halfEdges.length,
    current.faces.length,
  );
  const hashPreflight = reserveEvaluationBudget(budget, {
    bytes: hashBytes ?? Number.NaN,
    workUnits: hashWork ?? Number.NaN,
  }, "modifier result hashing");
  if (!hashPreflight.ok) return hashPreflight;
  return ok({
    mesh: current,
    sourceHash: hashStudioEditableMesh(stack.source),
    resultHash: hashStudioEditableMesh(current),
  });
}
