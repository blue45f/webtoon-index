/**
 * Renderer- and UI-independent Component / Instance core.
 *
 * The core deliberately stores immutable component revisions instead of expanded canvas nodes.
 * An instance resolves one revision, independent variant axes, exposed properties, slots, and
 * compact local overrides in a deterministic cascade. This keeps a thousand repeated characters
 * or balloons cheap to persist while leaving rendering to a later adapter.
 *
 * All public mutation boundaries are fail-closed. Inputs are strict canonical JSON, inheritance
 * and patch work are bounded, and history plans use snapshot fingerprints so a stale concurrent
 * edit cannot be overwritten silently.
 */

export const STUDIO_COMPONENT_DOCUMENT_VERSION = 1 as const;
export const STUDIO_COMPONENT_DEFINITION_SCHEMA_VERSION = 1 as const;

export const STUDIO_COMPONENT_LIMITS = Object.freeze({
  maxDefinitions: 512,
  maxRevisionsPerComponent: 64,
  maxInstances: 8_192,
  maxInheritanceDepth: 32,
  maxVariantAxes: 16,
  maxVariantOptionsPerAxis: 64,
  maxSlots: 64,
  maxProperties: 128,
  maxPatchesPerSource: 256,
  maxPatchOperationsPerResolution: 4_096,
  maxJsonDepth: 64,
  maxJsonNodes: 200_000,
  maxSerializedBytes: 16 * 1024 * 1024,
  maxDiffPaths: 4_096,
  maxIdLength: 160,
  maxLabelLength: 256,
  maxStringLength: 256 * 1024,
});

export type StudioComponentJsonPrimitive = null | boolean | number | string;
export type StudioComponentJsonValue =
  | StudioComponentJsonPrimitive
  | readonly StudioComponentJsonValue[]
  | StudioComponentJsonObject;
export interface StudioComponentJsonObject {
  readonly [key: string]: StudioComponentJsonValue;
}

export type StudioComponentPatchDomain =
  | "structure"
  | "style"
  | "content"
  | "metadata";

export interface StudioComponentSetPatch {
  readonly id: string;
  readonly domain: StudioComponentPatchDomain;
  readonly op: "set";
  /** RFC 6901 JSON Pointer. Root replacement is intentionally unsupported. */
  readonly path: string;
  readonly value: StudioComponentJsonValue;
}

export interface StudioComponentRemovePatch {
  readonly id: string;
  readonly domain: StudioComponentPatchDomain;
  readonly op: "remove";
  readonly path: string;
}

export type StudioComponentPatch =
  | StudioComponentSetPatch
  | StudioComponentRemovePatch;

export interface StudioComponentSourceReference {
  readonly componentId: string;
  /** Omission means the latest revision in the same immutable document snapshot. */
  readonly revision?: number;
}

export interface StudioComponentSlotDefinition {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly domain: StudioComponentPatchDomain;
  readonly required: boolean;
  readonly defaultValue?: StudioComponentJsonValue;
}

export type StudioComponentPropertyType =
  | "boolean"
  | "number"
  | "string"
  | "color"
  | "enum"
  | "json";

export interface StudioComponentPropertyDefinition {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly domain: StudioComponentPatchDomain;
  readonly type: StudioComponentPropertyType;
  readonly defaultValue?: StudioComponentJsonValue;
  readonly enumValues?: readonly string[];
}

export interface StudioComponentVariantOption {
  readonly id: string;
  readonly label: string;
  readonly patches: readonly StudioComponentPatch[];
}

export interface StudioComponentVariantAxis {
  readonly id: string;
  readonly label: string;
  /**
   * Lower priority is applied first. Equal priorities are ordered by axis ID, so resolution never
   * depends on insertion order.
   */
  readonly priority: number;
  readonly defaultOptionId: string;
  readonly options: readonly StudioComponentVariantOption[];
}

export interface StudioComponentDefinitionRevision {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly schemaVersion: typeof STUDIO_COMPONENT_DEFINITION_SCHEMA_VERSION;
  readonly revision: number;
  readonly libraryId?: string;
  readonly basedOn?: StudioComponentSourceReference;
  /** A deep object overlay on the inherited payload. Arrays and scalar values replace wholesale. */
  readonly payload: StudioComponentJsonObject;
  readonly slots: readonly StudioComponentSlotDefinition[];
  readonly properties: readonly StudioComponentPropertyDefinition[];
  readonly variantAxes: readonly StudioComponentVariantAxis[];
}

export type StudioComponentUpdatePolicy = "auto" | "review" | "pinned";

export interface StudioComponentInstance {
  readonly id: string;
  readonly componentId: string;
  /** Last accepted revision. `auto` resolves latest but retains this for audit and make-unique. */
  readonly sourceRevision: number;
  readonly updatePolicy: StudioComponentUpdatePolicy;
  readonly variantSelection: Readonly<Record<string, string>>;
  readonly slotBindings: Readonly<Record<string, StudioComponentJsonValue>>;
  readonly propertyValues: Readonly<Record<string, StudioComponentJsonValue>>;
  readonly localOverrides: readonly StudioComponentPatch[];
}

export interface StudioComponentDocument {
  readonly version: typeof STUDIO_COMPONENT_DOCUMENT_VERSION;
  readonly definitions: readonly StudioComponentDefinitionRevision[];
  readonly instances: readonly StudioComponentInstance[];
}

export interface StudioResolvedComponentInstance {
  readonly instanceId: string;
  readonly componentId: string;
  readonly acceptedRevision: number;
  readonly effectiveRevision: number;
  readonly latestRevision: number;
  readonly updatePolicy: StudioComponentUpdatePolicy;
  readonly updateAvailable: boolean;
  readonly sourceChain: readonly string[];
  readonly variantSelection: Readonly<Record<string, string>>;
  readonly appliedPatchIds: readonly string[];
  readonly localOverrideIds: readonly string[];
  readonly payload: StudioComponentJsonObject;
  readonly payloadFingerprint: string;
}

export interface StudioComponentUsage {
  readonly instanceId: string;
  readonly componentId: string;
  readonly direct: boolean;
  readonly acceptedRevision: number;
  readonly effectiveRevision: number;
  readonly latestRevision: number;
  readonly updatePolicy: StudioComponentUpdatePolicy;
  readonly updateAvailable: boolean;
  readonly sourceChain: readonly string[];
}

export type StudioComponentErrorCode =
  | "INVALID_DOCUMENT"
  | "LIMIT_EXCEEDED"
  | "DUPLICATE_ID"
  | "UNKNOWN_COMPONENT"
  | "UNKNOWN_REVISION"
  | "DANGLING_BASE"
  | "INHERITANCE_CYCLE"
  | "INHERITANCE_TOO_DEEP"
  | "INVALID_INSTANCE"
  | "INVALID_VARIANT"
  | "INVALID_BINDING"
  | "INVALID_PROPERTY"
  | "INVALID_PATCH"
  | "PATCH_TARGET_MISSING"
  | "STALE_OPERATION";

export class StudioComponentError extends Error {
  readonly code: StudioComponentErrorCode;
  readonly path: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StudioComponentErrorCode,
    message: string,
    path = "$",
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "StudioComponentError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

export interface ResolveStudioComponentInstanceOptions {
  readonly maxInheritanceDepth?: number;
  readonly maxPatchOperations?: number;
  /** Internal/public preview hook: resolve a specific revision without mutating the instance. */
  readonly revisionOverride?: number;
}

export interface StudioComponentReplaceInstanceOperation {
  readonly kind: "studio-component-replace-instance";
  readonly instanceId: string;
  readonly expectedFingerprint: string;
  readonly next: StudioComponentInstance;
}

export interface StudioComponentOperationPlan {
  readonly kind:
    | "studio-component-source-update"
    | "studio-component-make-unique";
  readonly planId: string;
  readonly instanceId: string;
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
  readonly changedPaths: readonly string[];
  readonly preservedLocalOverrideIds: readonly string[];
  readonly forward: StudioComponentReplaceInstanceOperation;
  readonly inverse: StudioComponentReplaceInstanceOperation;
  /** Present for make-unique; inserted and removed atomically with the instance replacement. */
  readonly definitionForward?: StudioComponentDefinitionRevision;
  readonly definitionInverseId?: string;
  readonly definitionInverseRevision?: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const FORBIDDEN_POINTER_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const PATCH_DOMAINS = new Set<StudioComponentPatchDomain>([
  "structure",
  "style",
  "content",
  "metadata",
]);
const PROPERTY_TYPES = new Set<StudioComponentPropertyType>([
  "boolean",
  "number",
  "string",
  "color",
  "enum",
  "json",
]);
const UPDATE_POLICIES = new Set<StudioComponentUpdatePolicy>([
  "auto",
  "review",
  "pinned",
]);
const TEXT_ENCODER = new TextEncoder();

type MutableJsonValue =
  | StudioComponentJsonPrimitive
  | MutableJsonValue[]
  | { [key: string]: MutableJsonValue };
type MutableJsonObject = { [key: string]: MutableJsonValue };
type UnknownRecord = Record<string, unknown>;

interface JsonBudget {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

interface ResolutionBudget {
  patches: number;
  readonly maxPatches: number;
  readonly maxDepth: number;
}

interface ResolvedDefinition {
  readonly source: StudioComponentDefinitionRevision;
  readonly payload: StudioComponentJsonObject;
  readonly slots: readonly StudioComponentSlotDefinition[];
  readonly properties: readonly StudioComponentPropertyDefinition[];
  readonly variantAxes: readonly StudioComponentVariantAxis[];
  readonly sourceChain: readonly string[];
}

function fail(
  code: StudioComponentErrorCode,
  message: string,
  path = "$",
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new StudioComponentError(code, message, path, details);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireStrictRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
): UnknownRecord {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", "Expected a plain JSON object.", path);
  }
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      fail("INVALID_DOCUMENT", "Unknown or non-string object field.", path, {
        field: typeof key === "string" ? key : "symbol",
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("INVALID_DOCUMENT", "Accessors and hidden fields are not accepted.", `${path}.${key}`);
    }
  }
  return value;
}

function requireBoundedArray(
  value: unknown,
  maxLength: number,
  path: string,
  minLength = 0,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    fail("LIMIT_EXCEEDED", "Array is invalid or exceeds its budget.", path);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !ARRAY_INDEX_PATTERN.test(key)
      || Number(key) >= value.length
    ) {
      fail("INVALID_DOCUMENT", "Sparse or custom-property arrays are not accepted.", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("INVALID_DOCUMENT", "Array accessors are not accepted.", `${path}[${key}]`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("INVALID_DOCUMENT", "Sparse arrays are not accepted.", `${path}[${index}]`);
    }
  }
  return value;
}

function requireDynamicRecord(value: unknown, path: string): UnknownRecord {
  if (!isPlainRecord(value)) fail("INVALID_DOCUMENT", "Expected a strict map.", path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("INVALID_DOCUMENT", "Symbol map keys are not accepted.", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("INVALID_DOCUMENT", "Map accessors and hidden fields are not accepted.", `${path}.${key}`);
    }
  }
  return value;
}

function requireId(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_COMPONENT_LIMITS.maxIdLength
    || !ID_PATTERN.test(value)
  ) {
    fail("INVALID_DOCUMENT", "Expected a bounded stable ID.", path);
  }
  return value;
}

function requireLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_COMPONENT_LIMITS.maxLabelLength
    || value.trim() !== value
  ) {
    fail("INVALID_DOCUMENT", "Expected a non-empty canonical label.", path);
  }
  return value;
}

function requireRevision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("INVALID_DOCUMENT", "Revision must be a positive safe integer.", path);
  }
  return value as number;
}

function requireBoundedInteger(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail("INVALID_DOCUMENT", `Expected an integer from ${min} to ${max}.`, path);
  }
  return value as number;
}

function cloneCanonicalJson(
  value: unknown,
  path: string,
  depth: number,
  budget: JsonBudget,
): StudioComponentJsonValue {
  budget.nodes += 1;
  if (budget.nodes > STUDIO_COMPONENT_LIMITS.maxJsonNodes) {
    fail("LIMIT_EXCEEDED", "Component JSON node budget exceeded.", path);
  }
  if (depth > STUDIO_COMPONENT_LIMITS.maxJsonDepth) {
    fail("LIMIT_EXCEEDED", "Component JSON depth budget exceeded.", path);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INVALID_DOCUMENT", "Only finite JSON numbers are accepted.", path);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (value.length > STUDIO_COMPONENT_LIMITS.maxStringLength) {
      fail("LIMIT_EXCEEDED", "Component JSON string budget exceeded.", path);
    }
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    fail("INVALID_DOCUMENT", "Only strict JSON values are accepted.", path);
  }
  if (budget.ancestors.has(value)) {
    fail("INVALID_DOCUMENT", "Cyclic JSON is not accepted.", path);
  }
  budget.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string"
          || !ARRAY_INDEX_PATTERN.test(key)
          || Number(key) >= value.length
        ) {
          fail("INVALID_DOCUMENT", "Sparse or custom-property arrays are not accepted.", path);
        }
      }
      const result: StudioComponentJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          fail("INVALID_DOCUMENT", "Sparse arrays are not accepted.", `${path}[${index}]`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          fail("INVALID_DOCUMENT", "Array accessors are not accepted.", `${path}[${index}]`);
        }
        result.push(cloneCanonicalJson(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          budget,
        ));
      }
      return Object.freeze(result);
    }
    if (!isPlainRecord(value)) {
      fail("INVALID_DOCUMENT", "JSON objects must use a plain or null prototype.", path);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      fail("INVALID_DOCUMENT", "Symbol keys are not accepted.", path);
    }
    const result: Record<string, StudioComponentJsonValue> = {};
    for (const key of (ownKeys as string[]).sort(compareText)) {
      if (FORBIDDEN_POINTER_SEGMENTS.has(key)) {
        fail("INVALID_DOCUMENT", "Unsafe object key is not accepted.", `${path}.${key}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        fail("INVALID_DOCUMENT", "Accessors and hidden fields are not accepted.", `${path}.${key}`);
      }
      result[key] = cloneCanonicalJson(
        descriptor.value,
        `${path}.${key}`,
        depth + 1,
        budget,
      );
    }
    return Object.freeze(result);
  } finally {
    budget.ancestors.delete(value);
  }
}

function canonicalJson(value: StudioComponentJsonValue): string {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as StudioComponentJsonObject;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function fingerprintJson(value: StudioComponentJsonValue): string {
  const bytes = TEXT_ENCODER.encode(canonicalJson(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `sci1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function parsePointer(path: unknown, fieldPath: string): readonly string[] {
  if (
    typeof path !== "string"
    || path.length < 2
    || path[0] !== "/"
    || path.length > STUDIO_COMPONENT_LIMITS.maxStringLength
  ) {
    fail("INVALID_PATCH", "Patch paths must be non-root RFC 6901 JSON Pointers.", fieldPath);
  }
  const segments = path.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/u.test(segment)) {
      fail("INVALID_PATCH", "JSON Pointer contains an invalid escape.", fieldPath);
    }
    const decoded = segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (FORBIDDEN_POINTER_SEGMENTS.has(decoded)) {
      fail("INVALID_PATCH", "Unsafe JSON Pointer segment is not accepted.", fieldPath);
    }
    return decoded;
  });
  return Object.freeze(segments);
}

function comparePatches(left: StudioComponentPatch, right: StudioComponentPatch): number {
  const leftDepth = left.path.split("/").length;
  const rightDepth = right.path.split("/").length;
  return (
    leftDepth - rightDepth
    || compareText(left.path, right.path)
    || compareText(left.id, right.id)
  );
}

function normalizePatchList(
  value: unknown,
  path: string,
  budget: JsonBudget,
): readonly StudioComponentPatch[] {
  const entries = requireBoundedArray(
    value,
    STUDIO_COMPONENT_LIMITS.maxPatchesPerSource,
    path,
  );
  const ids = new Set<string>();
  const paths = new Set<string>();
  const patches = entries.map((rawPatch, index): StudioComponentPatch => {
    const patchPath = `${path}[${index}]`;
    if (!isPlainRecord(rawPatch)) {
      fail("INVALID_PATCH", "Patch must be a strict object.", patchPath);
    }
    const op = rawPatch.op;
    const allowed = op === "set"
      ? new Set(["id", "domain", "op", "path", "value"])
      : new Set(["id", "domain", "op", "path"]);
    const patch = requireStrictRecord(rawPatch, allowed, patchPath);
    const id = requireId(patch.id, `${patchPath}.id`);
    if (ids.has(id)) fail("DUPLICATE_ID", "Duplicate patch ID.", `${patchPath}.id`);
    ids.add(id);
    if (op !== "set" && op !== "remove") {
      fail("INVALID_PATCH", "Patch operation must be set or remove.", `${patchPath}.op`);
    }
    if (typeof patch.domain !== "string" || !PATCH_DOMAINS.has(
      patch.domain as StudioComponentPatchDomain,
    )) {
      fail("INVALID_PATCH", "Unknown patch domain.", `${patchPath}.domain`);
    }
    const pointer = patch.path;
    parsePointer(pointer, `${patchPath}.path`);
    if (paths.has(pointer as string)) {
      fail("INVALID_PATCH", "One patch source cannot write the same path twice.", patchPath);
    }
    paths.add(pointer as string);
    if (op === "remove") {
      return Object.freeze({
        id,
        domain: patch.domain as StudioComponentPatchDomain,
        op,
        path: pointer as string,
      });
    }
    return Object.freeze({
      id,
      domain: patch.domain as StudioComponentPatchDomain,
      op,
      path: pointer as string,
      value: cloneCanonicalJson(patch.value, `${patchPath}.value`, 0, budget),
    });
  });
  return Object.freeze(patches.sort(comparePatches));
}

function normalizeSourceReference(
  value: unknown,
  path: string,
): StudioComponentSourceReference {
  const record = requireStrictRecord(
    value,
    new Set(["componentId", "revision"]),
    path,
  );
  const componentId = requireId(record.componentId, `${path}.componentId`);
  return Object.freeze({
    componentId,
    ...(record.revision === undefined
      ? {}
      : { revision: requireRevision(record.revision, `${path}.revision`) }),
  });
}

function normalizeSlot(
  value: unknown,
  path: string,
  budget: JsonBudget,
): StudioComponentSlotDefinition {
  const record = requireStrictRecord(
    value,
    new Set(["id", "label", "path", "domain", "required", "defaultValue"]),
    path,
  );
  const id = requireId(record.id, `${path}.id`);
  const label = requireLabel(record.label, `${path}.label`);
  parsePointer(record.path, `${path}.path`);
  if (typeof record.domain !== "string" || !PATCH_DOMAINS.has(
    record.domain as StudioComponentPatchDomain,
  )) {
    fail("INVALID_DOCUMENT", "Unknown slot domain.", `${path}.domain`);
  }
  if (typeof record.required !== "boolean") {
    fail("INVALID_DOCUMENT", "Slot required must be boolean.", `${path}.required`);
  }
  const hasDefault = Object.hasOwn(record, "defaultValue");
  return Object.freeze({
    id,
    label,
    path: record.path as string,
    domain: record.domain as StudioComponentPatchDomain,
    required: record.required,
    ...(hasDefault
      ? {
        defaultValue: cloneCanonicalJson(
          record.defaultValue,
          `${path}.defaultValue`,
          0,
          budget,
        ),
      }
      : {}),
  });
}

function valueMatchesProperty(
  definition: StudioComponentPropertyDefinition,
  value: StudioComponentJsonValue,
): boolean {
  if (definition.type === "json") return true;
  if (definition.type === "number") return typeof value === "number";
  if (definition.type === "boolean") return typeof value === "boolean";
  if (definition.type === "string") return typeof value === "string";
  if (definition.type === "color") {
    return typeof value === "string" && value.length > 0;
  }
  return typeof value === "string" && (definition.enumValues ?? []).includes(value);
}

function normalizeProperty(
  value: unknown,
  path: string,
  budget: JsonBudget,
): StudioComponentPropertyDefinition {
  const record = requireStrictRecord(
    value,
    new Set([
      "id",
      "label",
      "path",
      "domain",
      "type",
      "defaultValue",
      "enumValues",
    ]),
    path,
  );
  const id = requireId(record.id, `${path}.id`);
  const label = requireLabel(record.label, `${path}.label`);
  parsePointer(record.path, `${path}.path`);
  if (typeof record.domain !== "string" || !PATCH_DOMAINS.has(
    record.domain as StudioComponentPatchDomain,
  )) {
    fail("INVALID_DOCUMENT", "Unknown property domain.", `${path}.domain`);
  }
  if (typeof record.type !== "string" || !PROPERTY_TYPES.has(
    record.type as StudioComponentPropertyType,
  )) {
    fail("INVALID_DOCUMENT", "Unknown property type.", `${path}.type`);
  }
  let enumValues: readonly string[] | undefined;
  if (record.type === "enum") {
    const rawEnumValues = requireBoundedArray(
      record.enumValues,
      STUDIO_COMPONENT_LIMITS.maxVariantOptionsPerAxis,
      `${path}.enumValues`,
      1,
    );
    const values = rawEnumValues.map((entry, index) =>
      requireId(entry, `${path}.enumValues[${index}]`));
    if (new Set(values).size !== values.length) {
      fail("DUPLICATE_ID", "Enum values must be unique.", `${path}.enumValues`);
    }
    enumValues = Object.freeze([...values].sort(compareText));
  } else if (record.enumValues !== undefined) {
    fail("INVALID_DOCUMENT", "enumValues is only valid for enum properties.", path);
  }
  const hasDefault = Object.hasOwn(record, "defaultValue");
  const defaultValue = hasDefault
    ? cloneCanonicalJson(record.defaultValue, `${path}.defaultValue`, 0, budget)
    : undefined;
  const normalized = Object.freeze({
    id,
    label,
    path: record.path as string,
    domain: record.domain as StudioComponentPatchDomain,
    type: record.type as StudioComponentPropertyType,
    ...(enumValues ? { enumValues } : {}),
    ...(hasDefault ? { defaultValue } : {}),
  });
  if (hasDefault && !valueMatchesProperty(normalized, defaultValue!)) {
    fail("INVALID_PROPERTY", "Property default does not match its declared type.", path);
  }
  return normalized;
}

function normalizeVariantAxis(
  value: unknown,
  path: string,
  budget: JsonBudget,
): StudioComponentVariantAxis {
  const record = requireStrictRecord(
    value,
    new Set(["id", "label", "priority", "defaultOptionId", "options"]),
    path,
  );
  const id = requireId(record.id, `${path}.id`);
  const label = requireLabel(record.label, `${path}.label`);
  const priority = requireBoundedInteger(record.priority, -10_000, 10_000, `${path}.priority`);
  const defaultOptionId = requireId(record.defaultOptionId, `${path}.defaultOptionId`);
  const rawOptions = requireBoundedArray(
    record.options,
    STUDIO_COMPONENT_LIMITS.maxVariantOptionsPerAxis,
    `${path}.options`,
    1,
  );
  const optionIds = new Set<string>();
  const options = rawOptions.map((rawOption, index): StudioComponentVariantOption => {
    const optionPath = `${path}.options[${index}]`;
    const option = requireStrictRecord(
      rawOption,
      new Set(["id", "label", "patches"]),
      optionPath,
    );
    const optionId = requireId(option.id, `${optionPath}.id`);
    if (optionIds.has(optionId)) {
      fail("DUPLICATE_ID", "Duplicate variant option ID.", `${optionPath}.id`);
    }
    optionIds.add(optionId);
    return Object.freeze({
      id: optionId,
      label: requireLabel(option.label, `${optionPath}.label`),
      patches: normalizePatchList(option.patches, `${optionPath}.patches`, budget),
    });
  }).sort((left, right) => compareText(left.id, right.id));
  if (!optionIds.has(defaultOptionId)) {
    fail("INVALID_VARIANT", "Variant default option does not exist.", `${path}.defaultOptionId`);
  }
  return Object.freeze({
    id,
    label,
    priority,
    defaultOptionId,
    options: Object.freeze(options),
  });
}

function normalizeUniqueList<T extends { readonly id: string }>(
  values: readonly T[],
  path: string,
): readonly T[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) fail("DUPLICATE_ID", "Duplicate ID.", `${path}.${value.id}`);
    ids.add(value.id);
  }
  return Object.freeze([...values].sort((left, right) => compareText(left.id, right.id)));
}

function normalizeDefinition(
  value: unknown,
  path: string,
  budget: JsonBudget,
): StudioComponentDefinitionRevision {
  const record = requireStrictRecord(
    value,
    new Set([
      "id",
      "name",
      "kind",
      "schemaVersion",
      "revision",
      "libraryId",
      "basedOn",
      "payload",
      "slots",
      "properties",
      "variantAxes",
    ]),
    path,
  );
  if (record.schemaVersion !== STUDIO_COMPONENT_DEFINITION_SCHEMA_VERSION) {
    fail("INVALID_DOCUMENT", "Unsupported component definition schema.", `${path}.schemaVersion`);
  }
  const rawSlots = requireBoundedArray(
    record.slots,
    STUDIO_COMPONENT_LIMITS.maxSlots,
    `${path}.slots`,
  );
  const rawProperties = requireBoundedArray(
    record.properties,
    STUDIO_COMPONENT_LIMITS.maxProperties,
    `${path}.properties`,
  );
  const rawAxes = requireBoundedArray(
    record.variantAxes,
    STUDIO_COMPONENT_LIMITS.maxVariantAxes,
    `${path}.variantAxes`,
  );
  const payload = cloneCanonicalJson(record.payload, `${path}.payload`, 0, budget);
  if (Array.isArray(payload) || payload === null || typeof payload !== "object") {
    fail("INVALID_DOCUMENT", "Component payload must be a JSON object.", `${path}.payload`);
  }
  const slots = normalizeUniqueList(
    rawSlots.map((slot, index) => normalizeSlot(slot, `${path}.slots[${index}]`, budget)),
    `${path}.slots`,
  );
  const properties = normalizeUniqueList(
    rawProperties.map((property, index) =>
      normalizeProperty(property, `${path}.properties[${index}]`, budget)),
    `${path}.properties`,
  );
  const axes = [...normalizeUniqueList(
    rawAxes.map((axis, index) =>
      normalizeVariantAxis(axis, `${path}.variantAxes[${index}]`, budget)),
    `${path}.variantAxes`,
  )].sort((left, right) =>
    left.priority - right.priority || compareText(left.id, right.id));
  const id = requireId(record.id, `${path}.id`);
  return Object.freeze({
    id,
    name: requireLabel(record.name, `${path}.name`),
    kind: requireId(record.kind, `${path}.kind`),
    schemaVersion: STUDIO_COMPONENT_DEFINITION_SCHEMA_VERSION,
    revision: requireRevision(record.revision, `${path}.revision`),
    ...(record.libraryId === undefined
      ? {}
      : { libraryId: requireId(record.libraryId, `${path}.libraryId`) }),
    ...(record.basedOn === undefined
      ? {}
      : { basedOn: normalizeSourceReference(record.basedOn, `${path}.basedOn`) }),
    payload: payload as StudioComponentJsonObject,
    slots,
    properties,
    variantAxes: Object.freeze(axes),
  });
}

function normalizeStringMap(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> {
  const record = requireDynamicRecord(value, path);
  const result: Record<string, string> = {};
  for (const key of Object.keys(record).sort(compareText)) {
    requireId(key, `${path}.${key}`);
    result[key] = requireId(record[key], `${path}.${key}`);
  }
  return Object.freeze(result);
}

function normalizeJsonMap(
  value: unknown,
  path: string,
  budget: JsonBudget,
): Readonly<Record<string, StudioComponentJsonValue>> {
  const record = requireDynamicRecord(value, path);
  const result: Record<string, StudioComponentJsonValue> = {};
  for (const key of Object.keys(record).sort(compareText)) {
    requireId(key, `${path}.${key}`);
    result[key] = cloneCanonicalJson(record[key], `${path}.${key}`, 0, budget);
  }
  return Object.freeze(result);
}

function normalizeInstance(
  value: unknown,
  path: string,
  budget: JsonBudget,
): StudioComponentInstance {
  const record = requireStrictRecord(
    value,
    new Set([
      "id",
      "componentId",
      "sourceRevision",
      "updatePolicy",
      "variantSelection",
      "slotBindings",
      "propertyValues",
      "localOverrides",
    ]),
    path,
  );
  if (
    typeof record.updatePolicy !== "string"
    || !UPDATE_POLICIES.has(record.updatePolicy as StudioComponentUpdatePolicy)
  ) {
    fail("INVALID_INSTANCE", "Unknown component update policy.", `${path}.updatePolicy`);
  }
  return Object.freeze({
    id: requireId(record.id, `${path}.id`),
    componentId: requireId(record.componentId, `${path}.componentId`),
    sourceRevision: requireRevision(record.sourceRevision, `${path}.sourceRevision`),
    updatePolicy: record.updatePolicy as StudioComponentUpdatePolicy,
    variantSelection: normalizeStringMap(record.variantSelection, `${path}.variantSelection`),
    slotBindings: normalizeJsonMap(record.slotBindings, `${path}.slotBindings`, budget),
    propertyValues: normalizeJsonMap(record.propertyValues, `${path}.propertyValues`, budget),
    localOverrides: normalizePatchList(record.localOverrides, `${path}.localOverrides`, budget),
  });
}

function definitionKey(componentId: string, revision: number): string {
  return `${componentId}@${revision}`;
}

function buildDefinitionMaps(document: StudioComponentDocument): {
  readonly byKey: ReadonlyMap<string, StudioComponentDefinitionRevision>;
  readonly latest: ReadonlyMap<string, StudioComponentDefinitionRevision>;
} {
  const byKey = new Map<string, StudioComponentDefinitionRevision>();
  const latest = new Map<string, StudioComponentDefinitionRevision>();
  for (const definition of document.definitions) {
    byKey.set(definitionKey(definition.id, definition.revision), definition);
    const current = latest.get(definition.id);
    if (!current || definition.revision > current.revision) latest.set(definition.id, definition);
  }
  return { byKey, latest };
}

function findDefinition(
  maps: ReturnType<typeof buildDefinitionMaps>,
  componentId: string,
  revision: number | undefined,
  code: "UNKNOWN_COMPONENT" | "DANGLING_BASE" = "UNKNOWN_COMPONENT",
): StudioComponentDefinitionRevision {
  if (revision === undefined) {
    const latest = maps.latest.get(componentId);
    if (!latest) fail(code, "Component definition does not exist.", componentId);
    return latest;
  }
  const definition = maps.byKey.get(definitionKey(componentId, revision));
  if (!definition) {
    fail(
      code === "DANGLING_BASE" ? code : "UNKNOWN_REVISION",
      "Component revision does not exist.",
      definitionKey(componentId, revision),
    );
  }
  return definition;
}

function mergeJsonObjects(
  base: StudioComponentJsonObject,
  overlay: StudioComponentJsonObject,
): StudioComponentJsonObject {
  const result: Record<string, StudioComponentJsonValue> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(overlay)]);
  for (const key of [...keys].sort(compareText)) {
    if (!Object.hasOwn(overlay, key)) {
      result[key] = base[key];
      continue;
    }
    const baseValue = base[key];
    const overlayValue = overlay[key];
    if (
      isPlainRecord(baseValue)
      && isPlainRecord(overlayValue)
    ) {
      result[key] = mergeJsonObjects(
        baseValue as StudioComponentJsonObject,
        overlayValue as StudioComponentJsonObject,
      );
    } else {
      result[key] = overlayValue;
    }
  }
  return Object.freeze(result);
}

function mergeById<T extends { readonly id: string }>(
  base: readonly T[],
  overlay: readonly T[],
  compare: (left: T, right: T) => number =
    (left, right) => compareText(left.id, right.id),
): readonly T[] {
  const map = new Map(base.map((entry) => [entry.id, entry]));
  for (const entry of overlay) map.set(entry.id, entry);
  return Object.freeze([...map.values()].sort(compare));
}

function resolveDefinition(
  document: StudioComponentDocument,
  source: StudioComponentDefinitionRevision,
  budget: ResolutionBudget,
  cache = new Map<string, ResolvedDefinition>(),
  stack: readonly string[] = [],
): ResolvedDefinition {
  const key = definitionKey(source.id, source.revision);
  const cached = cache.get(key);
  if (cached) return cached;
  if (stack.includes(key)) {
    fail("INHERITANCE_CYCLE", "Component inheritance cycle detected.", key, {
      chain: [...stack, key],
    });
  }
  if (stack.length >= budget.maxDepth) {
    fail("INHERITANCE_TOO_DEEP", "Component inheritance depth budget exceeded.", key);
  }
  const maps = buildDefinitionMaps(document);
  let payload = source.payload;
  let slots = source.slots;
  let properties = source.properties;
  let axes = source.variantAxes;
  let sourceChain = [key];
  if (source.basedOn) {
    const parent = findDefinition(
      maps,
      source.basedOn.componentId,
      source.basedOn.revision,
      "DANGLING_BASE",
    );
    const resolvedParent = resolveDefinition(
      document,
      parent,
      budget,
      cache,
      [...stack, key],
    );
    payload = mergeJsonObjects(resolvedParent.payload, source.payload);
    slots = mergeById(resolvedParent.slots, source.slots);
    properties = mergeById(resolvedParent.properties, source.properties);
    axes = mergeById(
      resolvedParent.variantAxes,
      source.variantAxes,
      (left, right) => left.priority - right.priority || compareText(left.id, right.id),
    );
    sourceChain = [...resolvedParent.sourceChain, key];
  }
  const resolved = Object.freeze({
    source,
    payload,
    slots,
    properties,
    variantAxes: axes,
    sourceChain: Object.freeze(sourceChain),
  });
  cache.set(key, resolved);
  return resolved;
}

function toMutable(value: StudioComponentJsonValue): MutableJsonValue {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toMutable);
  const record = value as StudioComponentJsonObject;
  const result: MutableJsonObject = {};
  for (const key of Object.keys(record)) result[key] = toMutable(record[key]);
  return result;
}

function freezeMutable(value: MutableJsonValue): StudioComponentJsonValue {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeMutable));
  const result: Record<string, StudioComponentJsonValue> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    result[key] = freezeMutable(value[key]);
  }
  return Object.freeze(result);
}

function applyPatch(
  root: MutableJsonObject,
  patch: StudioComponentPatch,
  budget: ResolutionBudget,
  traceId: string,
): void {
  budget.patches += 1;
  if (budget.patches > budget.maxPatches) {
    fail("LIMIT_EXCEEDED", "Component resolution patch budget exceeded.", patch.path);
  }
  const segments = parsePointer(patch.path, `${traceId}.path`);
  let cursor: MutableJsonValue = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (Array.isArray(cursor)) {
      if (!ARRAY_INDEX_PATTERN.test(segment) || Number(segment) >= cursor.length) {
        fail("PATCH_TARGET_MISSING", "Patch array parent does not exist.", patch.path);
      }
      cursor = cursor[Number(segment)];
    } else if (cursor !== null && typeof cursor === "object") {
      if (!Object.hasOwn(cursor, segment)) {
        fail("PATCH_TARGET_MISSING", "Patch object parent does not exist.", patch.path);
      }
      cursor = cursor[segment];
    } else {
      fail("PATCH_TARGET_MISSING", "Patch parent is not a container.", patch.path);
    }
  }
  const leaf = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    if (!ARRAY_INDEX_PATTERN.test(leaf) || Number(leaf) >= cursor.length) {
      fail("PATCH_TARGET_MISSING", "Patch array target does not exist.", patch.path);
    }
    if (patch.op === "set") cursor[Number(leaf)] = toMutable(patch.value);
    else cursor.splice(Number(leaf), 1);
    return;
  }
  if (cursor === null || typeof cursor !== "object") {
    fail("PATCH_TARGET_MISSING", "Patch target parent is not an object.", patch.path);
  }
  if (patch.op === "remove") {
    if (!Object.hasOwn(cursor, leaf)) {
      fail("PATCH_TARGET_MISSING", "Patch remove target does not exist.", patch.path);
    }
    delete cursor[leaf];
  } else {
    cursor[leaf] = toMutable(patch.value);
  }
}

function requireKnownKeys(
  values: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  code: StudioComponentErrorCode,
  path: string,
): void {
  for (const key of Object.keys(values)) {
    if (!known.has(key)) fail(code, "Instance references an unknown exposed control.", `${path}.${key}`);
  }
}

function effectiveSource(
  document: StudioComponentDocument,
  instance: StudioComponentInstance,
  revisionOverride?: number,
): {
  readonly definition: StudioComponentDefinitionRevision;
  readonly latest: StudioComponentDefinitionRevision;
} {
  const maps = buildDefinitionMaps(document);
  const latest = findDefinition(maps, instance.componentId, undefined);
  const revision = revisionOverride
    ?? (instance.updatePolicy === "auto" ? latest.revision : instance.sourceRevision);
  return {
    definition: findDefinition(maps, instance.componentId, revision),
    latest,
  };
}

function instanceFingerprint(instance: StudioComponentInstance): string {
  return fingerprintJson(instance as unknown as StudioComponentJsonValue);
}

/**
 * Strictly validates, canonicalizes, detaches, and deeply freezes a component document.
 * Declaration order and object-key order do not affect the resulting serialization.
 */
export function createStudioComponentDocument(input: unknown): StudioComponentDocument {
  const root = requireStrictRecord(
    input,
    new Set(["version", "definitions", "instances"]),
    "$",
  );
  if (root.version !== STUDIO_COMPONENT_DOCUMENT_VERSION) {
    fail("INVALID_DOCUMENT", "Unsupported component document version.", "$.version");
  }
  const rawDefinitions = requireBoundedArray(
    root.definitions,
    STUDIO_COMPONENT_LIMITS.maxDefinitions,
    "$.definitions",
  );
  const rawInstances = requireBoundedArray(
    root.instances,
    STUDIO_COMPONENT_LIMITS.maxInstances,
    "$.instances",
  );
  const jsonBudget: JsonBudget = { nodes: 0, ancestors: new WeakSet() };
  const definitionKeys = new Set<string>();
  const revisionsPerComponent = new Map<string, number>();
  const definitions = rawDefinitions.map((definition, index) => {
    const normalized = normalizeDefinition(definition, `$.definitions[${index}]`, jsonBudget);
    const key = definitionKey(normalized.id, normalized.revision);
    if (definitionKeys.has(key)) {
      fail("DUPLICATE_ID", "Duplicate component revision.", `$.definitions[${index}]`);
    }
    definitionKeys.add(key);
    const count = (revisionsPerComponent.get(normalized.id) ?? 0) + 1;
    if (count > STUDIO_COMPONENT_LIMITS.maxRevisionsPerComponent) {
      fail("LIMIT_EXCEEDED", "Component revision budget exceeded.", normalized.id);
    }
    revisionsPerComponent.set(normalized.id, count);
    return normalized;
  }).sort((left, right) =>
    compareText(left.id, right.id) || left.revision - right.revision);
  const instanceIds = new Set<string>();
  const instances = rawInstances.map((instance, index) => {
    const normalized = normalizeInstance(instance, `$.instances[${index}]`, jsonBudget);
    if (instanceIds.has(normalized.id)) {
      fail("DUPLICATE_ID", "Duplicate component instance ID.", `$.instances[${index}].id`);
    }
    instanceIds.add(normalized.id);
    return normalized;
  }).sort((left, right) => compareText(left.id, right.id));
  const document: StudioComponentDocument = Object.freeze({
    version: STUDIO_COMPONENT_DOCUMENT_VERSION,
    definitions: Object.freeze(definitions),
    instances: Object.freeze(instances),
  });

  const maps = buildDefinitionMaps(document);
  for (const definition of definitions) {
    if (definition.basedOn) {
      findDefinition(
        maps,
        definition.basedOn.componentId,
        definition.basedOn.revision,
        "DANGLING_BASE",
      );
    }
    resolveDefinition(document, definition, {
      patches: 0,
      maxPatches: STUDIO_COMPONENT_LIMITS.maxPatchOperationsPerResolution,
      maxDepth: STUDIO_COMPONENT_LIMITS.maxInheritanceDepth,
    });
  }
  for (const instance of instances) {
    findDefinition(maps, instance.componentId, instance.sourceRevision);
  }
  const serialized = canonicalJson(document as unknown as StudioComponentJsonValue);
  if (TEXT_ENCODER.encode(serialized).byteLength > STUDIO_COMPONENT_LIMITS.maxSerializedBytes) {
    fail("LIMIT_EXCEEDED", "Component document serialized-byte budget exceeded.");
  }
  return document;
}

export function serializeStudioComponentDocument(document: StudioComponentDocument): string {
  const canonical = createStudioComponentDocument(document);
  return canonicalJson(canonical as unknown as StudioComponentJsonValue);
}

export function hashStudioComponentDocument(document: StudioComponentDocument): string {
  return fingerprintJson(
    createStudioComponentDocument(document) as unknown as StudioComponentJsonValue,
  );
}

function resolveCanonicalStudioComponentInstance(
  canonical: StudioComponentDocument,
  instanceId: string,
  options: ResolveStudioComponentInstanceOptions = {},
): StudioResolvedComponentInstance {
  const instance = canonical.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) fail("INVALID_INSTANCE", "Component instance does not exist.", instanceId);
  const maxDepth = options.maxInheritanceDepth
    ?? STUDIO_COMPONENT_LIMITS.maxInheritanceDepth;
  const maxPatches = options.maxPatchOperations
    ?? STUDIO_COMPONENT_LIMITS.maxPatchOperationsPerResolution;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1
    || maxDepth > STUDIO_COMPONENT_LIMITS.maxInheritanceDepth) {
    fail("LIMIT_EXCEEDED", "Invalid inheritance-depth budget.", "$.options.maxInheritanceDepth");
  }
  if (!Number.isSafeInteger(maxPatches) || maxPatches < 1
    || maxPatches > STUDIO_COMPONENT_LIMITS.maxPatchOperationsPerResolution) {
    fail("LIMIT_EXCEEDED", "Invalid patch-operation budget.", "$.options.maxPatchOperations");
  }
  const budget: ResolutionBudget = { patches: 0, maxPatches, maxDepth };
  const { definition, latest } = effectiveSource(canonical, instance, options.revisionOverride);
  const resolvedDefinition = resolveDefinition(canonical, definition, budget);
  const mutable = toMutable(resolvedDefinition.payload) as MutableJsonObject;
  const selectedVariants: Record<string, string> = {};
  const axisIds = new Set(resolvedDefinition.variantAxes.map((axis) => axis.id));
  requireKnownKeys(instance.variantSelection, axisIds, "INVALID_VARIANT", "$.variantSelection");
  const appliedPatchIds: string[] = [];
  for (const axis of resolvedDefinition.variantAxes) {
    const selection = instance.variantSelection[axis.id] ?? axis.defaultOptionId;
    const option = axis.options.find((candidate) => candidate.id === selection);
    if (!option) {
      fail("INVALID_VARIANT", "Selected variant option does not exist.", `${axis.id}.${selection}`);
    }
    selectedVariants[axis.id] = selection;
    for (const patch of option.patches) {
      const trace = `${definitionKey(definition.id, definition.revision)}:${axis.id}:${selection}:${patch.id}`;
      applyPatch(mutable, patch, budget, trace);
      appliedPatchIds.push(trace);
    }
  }

  const propertyIds = new Set(resolvedDefinition.properties.map((property) => property.id));
  requireKnownKeys(instance.propertyValues, propertyIds, "INVALID_PROPERTY", "$.propertyValues");
  for (const property of resolvedDefinition.properties) {
    const hasInstanceValue = Object.hasOwn(instance.propertyValues, property.id);
    const hasDefault = Object.hasOwn(property, "defaultValue");
    if (!hasInstanceValue && !hasDefault) continue;
    const value = hasInstanceValue
      ? instance.propertyValues[property.id]
      : property.defaultValue!;
    if (!valueMatchesProperty(property, value)) {
      fail("INVALID_PROPERTY", "Instance property value does not match its type.", property.id);
    }
    const patch: StudioComponentSetPatch = {
      id: property.id,
      domain: property.domain,
      op: "set",
      path: property.path,
      value,
    };
    applyPatch(mutable, patch, budget, `property:${property.id}`);
    appliedPatchIds.push(`property:${property.id}`);
  }

  const slotIds = new Set(resolvedDefinition.slots.map((slot) => slot.id));
  requireKnownKeys(instance.slotBindings, slotIds, "INVALID_BINDING", "$.slotBindings");
  for (const slot of resolvedDefinition.slots) {
    const hasBinding = Object.hasOwn(instance.slotBindings, slot.id);
    const hasDefault = Object.hasOwn(slot, "defaultValue");
    if (!hasBinding && !hasDefault) {
      if (slot.required) fail("INVALID_BINDING", "Required component slot is unbound.", slot.id);
      continue;
    }
    const patch: StudioComponentSetPatch = {
      id: slot.id,
      domain: slot.domain,
      op: "set",
      path: slot.path,
      value: hasBinding ? instance.slotBindings[slot.id] : slot.defaultValue!,
    };
    applyPatch(mutable, patch, budget, `slot:${slot.id}`);
    appliedPatchIds.push(`slot:${slot.id}`);
  }

  for (const patch of instance.localOverrides) {
    applyPatch(mutable, patch, budget, `local:${patch.id}`);
    appliedPatchIds.push(`local:${patch.id}`);
  }
  const payload = freezeMutable(mutable) as StudioComponentJsonObject;
  const effectiveRevision = definition.revision;
  return Object.freeze({
    instanceId: instance.id,
    componentId: instance.componentId,
    acceptedRevision: instance.sourceRevision,
    effectiveRevision,
    latestRevision: latest.revision,
    updatePolicy: instance.updatePolicy,
    updateAvailable: instance.updatePolicy !== "auto" && latest.revision > instance.sourceRevision,
    sourceChain: resolvedDefinition.sourceChain,
    variantSelection: Object.freeze(selectedVariants),
    appliedPatchIds: Object.freeze(appliedPatchIds),
    localOverrideIds: Object.freeze(instance.localOverrides.map((patch) => patch.id)),
    payload,
    payloadFingerprint: fingerprintJson(payload),
  });
}

export function resolveStudioComponentInstance(
  document: StudioComponentDocument,
  instanceId: string,
  options: ResolveStudioComponentInstanceOptions = {},
): StudioResolvedComponentInstance {
  return resolveCanonicalStudioComponentInstance(
    createStudioComponentDocument(document),
    instanceId,
    options,
  );
}

export function findStudioComponentUsages(
  document: StudioComponentDocument,
  componentId: string,
  revision?: number,
): readonly StudioComponentUsage[] {
  requireId(componentId, "$.componentId");
  if (revision !== undefined) requireRevision(revision, "$.revision");
  const canonical = createStudioComponentDocument(document);
  const usages: StudioComponentUsage[] = [];
  for (const instance of canonical.instances) {
    const resolved = resolveCanonicalStudioComponentInstance(canonical, instance.id);
    const matchingKeys = resolved.sourceChain.filter((key) =>
      key.startsWith(`${componentId}@`)
      && (revision === undefined || key === definitionKey(componentId, revision)));
    if (matchingKeys.length === 0) continue;
    usages.push(Object.freeze({
      instanceId: instance.id,
      componentId: instance.componentId,
      direct: instance.componentId === componentId,
      acceptedRevision: resolved.acceptedRevision,
      effectiveRevision: resolved.effectiveRevision,
      latestRevision: resolved.latestRevision,
      updatePolicy: resolved.updatePolicy,
      updateAvailable: resolved.updateAvailable,
      sourceChain: resolved.sourceChain,
    }));
  }
  return Object.freeze(usages.sort((left, right) => compareText(left.instanceId, right.instanceId)));
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function collectChangedPaths(
  before: StudioComponentJsonValue | undefined,
  after: StudioComponentJsonValue | undefined,
  path: string,
  output: string[],
): void {
  if (before === undefined && after === undefined) return;
  if (
    before !== undefined
    && after !== undefined
    && canonicalJson(before) === canonicalJson(after)
  ) return;
  if (output.length >= STUDIO_COMPONENT_LIMITS.maxDiffPaths) {
    fail("LIMIT_EXCEEDED", "Component update diff-path budget exceeded.", path);
  }
  if (before === undefined || after === undefined) {
    output.push(path || "/");
    return;
  }
  const beforeRecord = before !== undefined && isPlainRecord(before) ? before : null;
  const afterRecord = after !== undefined && isPlainRecord(after) ? after : null;
  if (beforeRecord && afterRecord) {
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of [...keys].sort(compareText)) {
      collectChangedPaths(
        beforeRecord[key] as StudioComponentJsonValue | undefined,
        afterRecord[key] as StudioComponentJsonValue | undefined,
        `${path}/${escapePointerSegment(key)}`,
        output,
      );
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) {
      collectChangedPaths(before[index], after[index], `${path}/${index}`, output);
    }
    return;
  }
  output.push(path || "/");
}

function replaceInstanceInDocument(
  document: StudioComponentDocument,
  nextInstance: StudioComponentInstance,
  expectedFingerprint: string,
  definitionToAdd?: StudioComponentDefinitionRevision,
  definitionToRemove?: { readonly id: string; readonly revision: number },
): StudioComponentDocument {
  const canonical = createStudioComponentDocument(document);
  const index = canonical.instances.findIndex((instance) => instance.id === nextInstance.id);
  if (index < 0) fail("INVALID_INSTANCE", "Operation target instance does not exist.", nextInstance.id);
  const current = canonical.instances[index];
  const actualFingerprint = instanceFingerprint(current);
  if (actualFingerprint !== expectedFingerprint) {
    fail("STALE_OPERATION", "Component operation snapshot is stale.", nextInstance.id, {
      expectedFingerprint,
      actualFingerprint,
    });
  }
  let definitions = [...canonical.definitions];
  if (definitionToRemove) {
    const beforeLength = definitions.length;
    definitions = definitions.filter((definition) =>
      definition.id !== definitionToRemove.id
      || definition.revision !== definitionToRemove.revision);
    if (definitions.length === beforeLength) {
      fail("STALE_OPERATION", "Make-unique definition is already absent.", definitionToRemove.id);
    }
  }
  if (definitionToAdd) {
    const key = definitionKey(definitionToAdd.id, definitionToAdd.revision);
    if (definitions.some((definition) =>
      definitionKey(definition.id, definition.revision) === key)) {
      fail("STALE_OPERATION", "Make-unique definition already exists.", key);
    }
    definitions.push(definitionToAdd);
  }
  const instances = [...canonical.instances];
  instances[index] = nextInstance;
  return createStudioComponentDocument({
    version: STUDIO_COMPONENT_DOCUMENT_VERSION,
    definitions,
    instances,
  });
}

export function planStudioComponentSourceUpdate(
  document: StudioComponentDocument,
  instanceId: string,
  targetRevision?: number,
): StudioComponentOperationPlan {
  const canonical = createStudioComponentDocument(document);
  const instance = canonical.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) fail("INVALID_INSTANCE", "Component instance does not exist.", instanceId);
  const maps = buildDefinitionMaps(canonical);
  const latest = findDefinition(maps, instance.componentId, undefined);
  const revision = targetRevision ?? latest.revision;
  findDefinition(maps, instance.componentId, revision);
  const before = resolveCanonicalStudioComponentInstance(canonical, instanceId);
  const afterInstance = Object.freeze({ ...instance, sourceRevision: revision });
  const previewDocument = createStudioComponentDocument({
    version: canonical.version,
    definitions: canonical.definitions,
    instances: canonical.instances.map((candidate) =>
      candidate.id === instanceId ? afterInstance : candidate),
  });
  const after = resolveCanonicalStudioComponentInstance(previewDocument, instanceId);
  const changedPaths: string[] = [];
  collectChangedPaths(before.payload, after.payload, "", changedPaths);
  const beforeFingerprint = instanceFingerprint(instance);
  const afterFingerprint = instanceFingerprint(afterInstance);
  const forward: StudioComponentReplaceInstanceOperation = Object.freeze({
    kind: "studio-component-replace-instance",
    instanceId,
    expectedFingerprint: beforeFingerprint,
    next: afterInstance,
  });
  const inverse: StudioComponentReplaceInstanceOperation = Object.freeze({
    kind: "studio-component-replace-instance",
    instanceId,
    expectedFingerprint: afterFingerprint,
    next: instance,
  });
  return Object.freeze({
    kind: "studio-component-source-update",
    planId: fingerprintJson({
      kind: "studio-component-source-update",
      instanceId,
      beforeFingerprint,
      afterFingerprint,
    }),
    instanceId,
    beforeFingerprint,
    afterFingerprint,
    changedPaths: Object.freeze(changedPaths),
    preservedLocalOverrideIds: Object.freeze(instance.localOverrides.map((patch) => patch.id)),
    forward,
    inverse,
  });
}

/**
 * Bakes one resolved instance into a private revision. The new definition has no inherited source,
 * variants, slots, or exposed properties because their current values are already materialized.
 * The replacement instance is therefore visually stable and keeps a reversible source snapshot.
 */
export function planStudioComponentMakeUnique(
  document: StudioComponentDocument,
  instanceId: string,
  uniqueComponentId: string,
  uniqueName: string,
): StudioComponentOperationPlan {
  const canonical = createStudioComponentDocument(document);
  const instance = canonical.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) fail("INVALID_INSTANCE", "Component instance does not exist.", instanceId);
  requireId(uniqueComponentId, "$.uniqueComponentId");
  requireLabel(uniqueName, "$.uniqueName");
  if (canonical.definitions.some((definition) => definition.id === uniqueComponentId)) {
    fail("DUPLICATE_ID", "Make-unique component ID already exists.", uniqueComponentId);
  }
  const resolved = resolveCanonicalStudioComponentInstance(canonical, instanceId);
  const source = effectiveSource(canonical, instance).definition;
  const definitionForward: StudioComponentDefinitionRevision = Object.freeze({
    id: uniqueComponentId,
    name: uniqueName,
    kind: source.kind,
    schemaVersion: STUDIO_COMPONENT_DEFINITION_SCHEMA_VERSION,
    revision: 1,
    payload: resolved.payload,
    slots: Object.freeze([]),
    properties: Object.freeze([]),
    variantAxes: Object.freeze([]),
  });
  const afterInstance: StudioComponentInstance = Object.freeze({
    id: instance.id,
    componentId: uniqueComponentId,
    sourceRevision: 1,
    updatePolicy: "pinned",
    variantSelection: Object.freeze({}),
    slotBindings: Object.freeze({}),
    propertyValues: Object.freeze({}),
    localOverrides: Object.freeze([]),
  });
  const beforeFingerprint = instanceFingerprint(instance);
  const afterFingerprint = instanceFingerprint(afterInstance);
  return Object.freeze({
    kind: "studio-component-make-unique",
    planId: fingerprintJson({
      kind: "studio-component-make-unique",
      instanceId,
      uniqueComponentId,
      beforeFingerprint,
      afterFingerprint,
    }),
    instanceId,
    beforeFingerprint,
    afterFingerprint,
    changedPaths: Object.freeze([]),
    preservedLocalOverrideIds: Object.freeze(instance.localOverrides.map((patch) => patch.id)),
    forward: Object.freeze({
      kind: "studio-component-replace-instance",
      instanceId,
      expectedFingerprint: beforeFingerprint,
      next: afterInstance,
    }),
    inverse: Object.freeze({
      kind: "studio-component-replace-instance",
      instanceId,
      expectedFingerprint: afterFingerprint,
      next: instance,
    }),
    definitionForward,
    definitionInverseId: uniqueComponentId,
    definitionInverseRevision: 1,
  });
}

export function applyStudioComponentOperationPlan(
  document: StudioComponentDocument,
  plan: StudioComponentOperationPlan,
  direction: "forward" | "inverse",
): StudioComponentDocument {
  if (direction === "forward") {
    return replaceInstanceInDocument(
      document,
      plan.forward.next,
      plan.forward.expectedFingerprint,
      plan.definitionForward,
    );
  }
  return replaceInstanceInDocument(
    document,
    plan.inverse.next,
    plan.inverse.expectedFingerprint,
    undefined,
    plan.definitionInverseId && plan.definitionInverseRevision
      ? { id: plan.definitionInverseId, revision: plan.definitionInverseRevision }
      : undefined,
  );
}
