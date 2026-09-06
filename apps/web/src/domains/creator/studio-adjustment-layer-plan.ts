import {
  STUDIO_ADJUSTMENT_ENGINE_IDS,
  STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES,
  STUDIO_ADJUSTMENT_STACK_VERSION,
  listEnabledStudioAdjustmentOperations,
  normalizeStudioAdjustmentStack,
  studioAdjustmentStackSerializedByteLength,
  type StudioAdjustmentFilterOperation,
  type StudioAdjustmentStack,
} from "./studio-adjustment-stack";

/**
 * Pure compositor planning boundary for first-class adjustment ("lens") layers.
 *
 * Existing smart filters remain valid on individual image elements. This planner covers the
 * missing layer-level case: render vector, text, shape, raster, 3D, or a nested-group surface
 * first, then run one non-destructive filter stack over the already-composited pixels below the
 * adjustment layer. It owns no Canvas/Konva/WebGPU/React state.
 */

export const STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION = 1 as const;

export const STUDIO_ADJUSTMENT_LAYER_LIMITS = Object.freeze({
  maxGroups: 256,
  maxLayers: 8_192,
  maxGroupDepth: 32,
  maxParamFields: 64,
  maxIdLength: 160,
  maxStringLength: 512,
  maxSerializedBytes: 8 * 1024 * 1024,
});

export type StudioAdjustmentLayerRenderKind =
  | "raster"
  | "vector"
  | "text"
  | "shape"
  | "group"
  | "three-d"
  | "other";

export type StudioAdjustmentLayerScope = "composite-below" | "clip-previous";

export type StudioAdjustmentLayerBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "darken"
  | "lighten"
  | "color"
  | "luminosity";

export interface StudioAdjustmentLayerGroup {
  readonly id: string;
  readonly parentGroupId: string | null;
  readonly visible: boolean;
}

interface StudioAdjustmentLayerBase {
  readonly id: string;
  readonly parentGroupId: string | null;
  /** Stable bottom-to-top order within one parent group. */
  readonly paintOrder: number;
  readonly visible: boolean;
}

export interface StudioAdjustmentContentLayer extends StudioAdjustmentLayerBase {
  readonly kind: "content";
  readonly renderKind: StudioAdjustmentLayerRenderKind;
}

export interface StudioAdjustmentEffectLayer extends StudioAdjustmentLayerBase {
  readonly kind: "adjustment";
  readonly scope: StudioAdjustmentLayerScope;
  readonly opacity: number;
  readonly blendMode: StudioAdjustmentLayerBlendMode;
  /** Opaque reference consumed by a later selection/layer-mask adapter. */
  readonly maskId?: string;
  readonly stack: StudioAdjustmentStack;
}

export type StudioAdjustmentLayer =
  | StudioAdjustmentContentLayer
  | StudioAdjustmentEffectLayer;

export interface StudioAdjustmentLayerDocument {
  readonly version: typeof STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION;
  readonly groups: readonly StudioAdjustmentLayerGroup[];
  readonly layers: readonly StudioAdjustmentLayer[];
}

export type StudioAdjustmentLayerPlanStatus =
  | "active"
  | "hidden"
  | "transparent"
  | "empty-stack"
  | "empty-scope";

export interface StudioAdjustmentLayerPass {
  readonly adjustmentLayerId: string;
  readonly parentGroupId: string | null;
  readonly groupPath: readonly string[];
  readonly paintOrder: number;
  readonly scope: StudioAdjustmentLayerScope;
  readonly opacity: number;
  readonly blendMode: StudioAdjustmentLayerBlendMode;
  readonly maskId?: string;
  readonly status: StudioAdjustmentLayerPlanStatus;
  /** Painter-order content inputs, before the adjustment layer. */
  readonly sourceLayerIds: readonly string[];
  readonly sourceRenderKinds: readonly StudioAdjustmentLayerRenderKind[];
  /** Earlier active adjustment passes whose source composite overlaps this pass. */
  readonly upstreamAdjustmentLayerIds: readonly string[];
  readonly operations: readonly StudioAdjustmentFilterOperation[];
  /**
   * The renderer must filter an intermediate composite, never require an image node. This is the
   * contract that keeps filters available on vector-only line art and text-only pages.
   */
  readonly compositeMode: "flatten-then-filter";
  readonly acceptsNonRasterSources: true;
  readonly fingerprint: string;
}

export interface StudioAdjustmentLayerCompositorPlan {
  readonly version: typeof STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION;
  readonly passes: readonly StudioAdjustmentLayerPass[];
  readonly fingerprint: string;
}

export type StudioAdjustmentLayerErrorCode =
  | "INVALID_DOCUMENT"
  | "LIMIT_EXCEEDED"
  | "DUPLICATE_ID"
  | "DUPLICATE_PAINT_ORDER"
  | "DANGLING_GROUP"
  | "GROUP_CYCLE"
  | "GROUP_TOO_DEEP"
  | "INVALID_STACK";

export class StudioAdjustmentLayerError extends Error {
  readonly code: StudioAdjustmentLayerErrorCode;
  readonly path: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StudioAdjustmentLayerErrorCode,
    message: string,
    path = "$",
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "StudioAdjustmentLayerError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const RENDER_KINDS = new Set<StudioAdjustmentLayerRenderKind>([
  "raster",
  "vector",
  "text",
  "shape",
  "group",
  "three-d",
  "other",
]);
const SCOPES = new Set<StudioAdjustmentLayerScope>([
  "composite-below",
  "clip-previous",
]);
const BLEND_MODES = new Set<StudioAdjustmentLayerBlendMode>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "color",
  "luminosity",
]);
const ENGINE_IDS = new Set<string>(STUDIO_ADJUSTMENT_ENGINE_IDS);
const TEXT_ENCODER = new TextEncoder();

type UnknownRecord = Record<string, unknown>;
type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function fail(
  code: StudioAdjustmentLayerErrorCode,
  message: string,
  path = "$",
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new StudioAdjustmentLayerError(code, message, path, details);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parentSortKey(parentGroupId: string | null): string {
  return parentGroupId ?? "";
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  code: StudioAdjustmentLayerErrorCode = "INVALID_DOCUMENT",
): UnknownRecord {
  if (!isPlainRecord(value)) fail(code, "Expected a strict plain object.", path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(code, "Unknown or non-string object field.", path, {
        field: typeof key === "string" ? key : "symbol",
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "Accessors and hidden fields are not accepted.", `${path}.${key}`);
    }
  }
  return value;
}

function requireDynamicRecord(
  value: unknown,
  path: string,
  code: StudioAdjustmentLayerErrorCode,
): UnknownRecord {
  if (!isPlainRecord(value)) fail(code, "Expected a strict parameter object.", path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(code, "Symbol keys are not accepted.", path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(code, "Accessors and hidden fields are not accepted.", `${path}.${key}`);
    }
  }
  return value;
}

function requireArray(
  value: unknown,
  maxLength: number | null,
  path: string,
  code: StudioAdjustmentLayerErrorCode = "LIMIT_EXCEEDED",
): readonly unknown[] {
  if (!Array.isArray(value) || (maxLength !== null && value.length > maxLength)) {
    fail(code, "Array is invalid or exceeds its budget.", path);
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

function requireId(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_ADJUSTMENT_LAYER_LIMITS.maxIdLength
    || !ID_PATTERN.test(value)
  ) {
    fail("INVALID_DOCUMENT", "Expected a bounded stable ID.", path);
  }
  return value;
}

function optionalGroupId(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requireId(value, path);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("INVALID_DOCUMENT", "Expected boolean.", path);
  return value;
}

function requirePaintOrder(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    fail("INVALID_DOCUMENT", "paintOrder must be a safe integer.", path);
  }
  return value as number;
}

function requireOpacity(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail("INVALID_DOCUMENT", "Opacity must be finite and within 0..1.", path);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeParams(value: unknown, path: string): Readonly<Record<string, number | string | boolean>> {
  const source = requireDynamicRecord(value, path, "INVALID_STACK");
  const keys = Object.keys(source).sort(compareText);
  if (keys.length > STUDIO_ADJUSTMENT_LAYER_LIMITS.maxParamFields) {
    fail("LIMIT_EXCEEDED", "Adjustment parameter-field budget exceeded.", path);
  }
  const params: Record<string, number | string | boolean> = {};
  for (const key of keys) {
    if (!ID_PATTERN.test(key) || key.length > STUDIO_ADJUSTMENT_LAYER_LIMITS.maxIdLength) {
      fail("INVALID_STACK", "Adjustment parameter key is invalid.", `${path}.${key}`);
    }
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      params[key] = Object.is(raw, -0) ? 0 : raw;
    } else if (typeof raw === "boolean") {
      params[key] = raw;
    } else if (
      typeof raw === "string"
      && raw.length <= STUDIO_ADJUSTMENT_LAYER_LIMITS.maxStringLength
    ) {
      params[key] = raw;
    } else {
      fail("INVALID_STACK", "Adjustment parameter value is not a bounded primitive.", `${path}.${key}`);
    }
  }
  return Object.freeze(params);
}

function normalizeStack(value: unknown, path: string): StudioAdjustmentStack {
  const stack = requireRecord(
    value,
    new Set(["version", "entries"]),
    path,
    "INVALID_STACK",
  );
  if (stack.version !== STUDIO_ADJUSTMENT_STACK_VERSION) {
    fail("INVALID_STACK", "Unsupported adjustment stack version.", `${path}.version`);
  }
  const rawEntries = requireArray(
    stack.entries,
    null,
    `${path}.entries`,
    "INVALID_STACK",
  );
  // A canonical valid entry cannot serialize below 32 bytes. This byte-derived lower-bound check
  // rejects hostile arrays before allocating/map traversal without reintroducing a product count.
  if (rawEntries.length * 32 > STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES) {
    fail("LIMIT_EXCEEDED", "Adjustment stack serialized-byte budget exceeded.", `${path}.entries`);
  }
  const ids = new Set<string>();
  const entries = rawEntries.map((rawEntry, index) => {
    const entryPath = `${path}.entries[${index}]`;
    const entry = requireRecord(
      rawEntry,
      new Set(["id", "engine", "enabled", "params"]),
      entryPath,
      "INVALID_STACK",
    );
    const id = requireId(entry.id, `${entryPath}.id`);
    if (ids.has(id)) fail("DUPLICATE_ID", "Duplicate adjustment entry ID.", `${entryPath}.id`);
    ids.add(id);
    if (typeof entry.engine !== "string" || !ENGINE_IDS.has(entry.engine)) {
      fail("INVALID_STACK", "Unknown adjustment engine.", `${entryPath}.engine`);
    }
    if (typeof entry.enabled !== "boolean") {
      fail("INVALID_STACK", "Adjustment enabled flag must be boolean.", `${entryPath}.enabled`);
    }
    return Object.freeze({
      id,
      engine: entry.engine,
      enabled: entry.enabled,
      params: normalizeParams(entry.params, `${entryPath}.params`),
    });
  });
  const normalized = Object.freeze({
    version: STUDIO_ADJUSTMENT_STACK_VERSION,
    entries: Object.freeze(entries),
  }) as StudioAdjustmentStack;
  if (
    studioAdjustmentStackSerializedByteLength(normalized)
    > STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES
  ) {
    fail("LIMIT_EXCEEDED", "Adjustment stack serialized-byte budget exceeded.", path);
  }
  return normalized;
}

function normalizeGroup(value: unknown, path: string): StudioAdjustmentLayerGroup {
  const group = requireRecord(
    value,
    new Set(["id", "parentGroupId", "visible"]),
    path,
  );
  return Object.freeze({
    id: requireId(group.id, `${path}.id`),
    parentGroupId: optionalGroupId(group.parentGroupId, `${path}.parentGroupId`),
    visible: requireBoolean(group.visible, `${path}.visible`),
  });
}

function normalizeLayer(value: unknown, path: string): StudioAdjustmentLayer {
  if (!isPlainRecord(value)) fail("INVALID_DOCUMENT", "Layer must be a strict object.", path);
  if (value.kind === "content") {
    const layer = requireRecord(
      value,
      new Set([
        "id",
        "kind",
        "parentGroupId",
        "paintOrder",
        "visible",
        "renderKind",
      ]),
      path,
    );
    if (typeof layer.renderKind !== "string" || !RENDER_KINDS.has(
      layer.renderKind as StudioAdjustmentLayerRenderKind,
    )) {
      fail("INVALID_DOCUMENT", "Unknown content render kind.", `${path}.renderKind`);
    }
    return Object.freeze({
      id: requireId(layer.id, `${path}.id`),
      kind: "content",
      parentGroupId: optionalGroupId(layer.parentGroupId, `${path}.parentGroupId`),
      paintOrder: requirePaintOrder(layer.paintOrder, `${path}.paintOrder`),
      visible: requireBoolean(layer.visible, `${path}.visible`),
      renderKind: layer.renderKind as StudioAdjustmentLayerRenderKind,
    });
  }
  if (value.kind !== "adjustment") {
    fail("INVALID_DOCUMENT", "Layer kind must be content or adjustment.", `${path}.kind`);
  }
  const layer = requireRecord(
    value,
    new Set([
      "id",
      "kind",
      "parentGroupId",
      "paintOrder",
      "visible",
      "scope",
      "opacity",
      "blendMode",
      "maskId",
      "stack",
    ]),
    path,
  );
  if (typeof layer.scope !== "string" || !SCOPES.has(
    layer.scope as StudioAdjustmentLayerScope,
  )) {
    fail("INVALID_DOCUMENT", "Unknown adjustment scope.", `${path}.scope`);
  }
  if (typeof layer.blendMode !== "string" || !BLEND_MODES.has(
    layer.blendMode as StudioAdjustmentLayerBlendMode,
  )) {
    fail("INVALID_DOCUMENT", "Unknown adjustment blend mode.", `${path}.blendMode`);
  }
  return Object.freeze({
    id: requireId(layer.id, `${path}.id`),
    kind: "adjustment",
    parentGroupId: optionalGroupId(layer.parentGroupId, `${path}.parentGroupId`),
    paintOrder: requirePaintOrder(layer.paintOrder, `${path}.paintOrder`),
    visible: requireBoolean(layer.visible, `${path}.visible`),
    scope: layer.scope as StudioAdjustmentLayerScope,
    opacity: requireOpacity(layer.opacity, `${path}.opacity`),
    blendMode: layer.blendMode as StudioAdjustmentLayerBlendMode,
    ...(layer.maskId === undefined
      ? {}
      : { maskId: requireId(layer.maskId, `${path}.maskId`) }),
    stack: normalizeStack(layer.stack, `${path}.stack`),
  });
}

function compareLayers(
  left: StudioAdjustmentLayer,
  right: StudioAdjustmentLayer,
): number {
  return (
    compareText(parentSortKey(left.parentGroupId), parentSortKey(right.parentGroupId))
    || left.paintOrder - right.paintOrder
    || compareText(left.id, right.id)
  );
}

function validateGroupGraph(document: StudioAdjustmentLayerDocument): void {
  const groups = new Map(document.groups.map((group) => [group.id, group]));
  for (const group of document.groups) {
    if (group.parentGroupId !== null && !groups.has(group.parentGroupId)) {
      fail("DANGLING_GROUP", "Group parent does not exist.", group.id);
    }
  }
  for (const layer of document.layers) {
    if (layer.parentGroupId !== null && !groups.has(layer.parentGroupId)) {
      fail("DANGLING_GROUP", "Layer parent group does not exist.", layer.id);
    }
  }
  for (const origin of document.groups) {
    const path: string[] = [];
    let cursor: string | null = origin.id;
    while (cursor !== null) {
      if (path.includes(cursor)) {
        fail("GROUP_CYCLE", "Adjustment-layer group cycle detected.", cursor, {
          chain: [...path, cursor],
        });
      }
      if (path.length >= STUDIO_ADJUSTMENT_LAYER_LIMITS.maxGroupDepth) {
        fail("GROUP_TOO_DEEP", "Adjustment-layer group depth budget exceeded.", origin.id);
      }
      path.push(cursor);
      const group = groups.get(cursor);
      if (!group) fail("DANGLING_GROUP", "Group does not exist.", cursor);
      cursor = group.parentGroupId;
    }
  }
}

function canonicalJson(value: CanonicalJson): string {
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
  const record = value as Readonly<Record<string, CanonicalJson>>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function fingerprint(value: CanonicalJson): string {
  const bytes = TEXT_ENCODER.encode(canonicalJson(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `salp1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function createStudioAdjustmentLayerDocument(
  input: unknown,
): StudioAdjustmentLayerDocument {
  const root = requireRecord(input, new Set(["version", "groups", "layers"]), "$");
  if (root.version !== STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION) {
    fail("INVALID_DOCUMENT", "Unsupported adjustment-layer document version.", "$.version");
  }
  const rawGroups = requireArray(
    root.groups,
    STUDIO_ADJUSTMENT_LAYER_LIMITS.maxGroups,
    "$.groups",
  );
  const rawLayers = requireArray(
    root.layers,
    STUDIO_ADJUSTMENT_LAYER_LIMITS.maxLayers,
    "$.layers",
  );
  const ids = new Set<string>();
  const groups = rawGroups.map((group, index) => {
    const normalized = normalizeGroup(group, `$.groups[${index}]`);
    if (ids.has(normalized.id)) {
      fail("DUPLICATE_ID", "Duplicate group or layer ID.", normalized.id);
    }
    ids.add(normalized.id);
    return normalized;
  }).sort((left, right) => compareText(left.id, right.id));
  const paintOrders = new Set<string>();
  const layers = rawLayers.map((layer, index) => {
    const normalized = normalizeLayer(layer, `$.layers[${index}]`);
    if (ids.has(normalized.id)) {
      fail("DUPLICATE_ID", "Duplicate group or layer ID.", normalized.id);
    }
    ids.add(normalized.id);
    const orderKey = `${parentSortKey(normalized.parentGroupId)}\u0000${normalized.paintOrder}`;
    if (paintOrders.has(orderKey)) {
      fail(
        "DUPLICATE_PAINT_ORDER",
        "Sibling layers must have unique stable paintOrder values.",
        normalized.id,
      );
    }
    paintOrders.add(orderKey);
    return normalized;
  }).sort(compareLayers);
  const document = Object.freeze({
    version: STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION,
    groups: Object.freeze(groups),
    layers: Object.freeze(layers),
  });
  validateGroupGraph(document);
  const serialized = canonicalJson(document as unknown as CanonicalJson);
  if (TEXT_ENCODER.encode(serialized).byteLength
    > STUDIO_ADJUSTMENT_LAYER_LIMITS.maxSerializedBytes) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer serialized-byte budget exceeded.");
  }
  return document;
}

export function serializeStudioAdjustmentLayerDocument(
  document: StudioAdjustmentLayerDocument,
): string {
  return canonicalJson(
    createStudioAdjustmentLayerDocument(document) as unknown as CanonicalJson,
  );
}

export function hashStudioAdjustmentLayerDocument(
  document: StudioAdjustmentLayerDocument,
): string {
  return fingerprint(
    createStudioAdjustmentLayerDocument(document) as unknown as CanonicalJson,
  );
}

function groupPathFor(
  parentGroupId: string | null,
  groups: ReadonlyMap<string, StudioAdjustmentLayerGroup>,
): readonly string[] {
  const path: string[] = [];
  let cursor = parentGroupId;
  while (cursor !== null) {
    const group = groups.get(cursor);
    if (!group) fail("DANGLING_GROUP", "Group does not exist.", cursor);
    path.push(group.id);
    cursor = group.parentGroupId;
  }
  return Object.freeze(path.reverse());
}

function groupPathVisible(
  path: readonly string[],
  groups: ReadonlyMap<string, StudioAdjustmentLayerGroup>,
): boolean {
  return path.every((groupId) => groups.get(groupId)?.visible === true);
}

function sourceOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const smaller = left.length <= right.length ? left : right;
  const larger = new Set(left.length <= right.length ? right : left);
  return smaller.some((id) => larger.has(id));
}

export function buildStudioAdjustmentLayerCompositorPlan(
  document: StudioAdjustmentLayerDocument,
): StudioAdjustmentLayerCompositorPlan {
  const canonical = createStudioAdjustmentLayerDocument(document);
  const groups = new Map(canonical.groups.map((group) => [group.id, group]));
  const layersByParent = new Map<string, StudioAdjustmentLayer[]>();
  for (const layer of canonical.layers) {
    const key = parentSortKey(layer.parentGroupId);
    const siblings = layersByParent.get(key) ?? [];
    siblings.push(layer);
    layersByParent.set(key, siblings);
  }
  const passes: StudioAdjustmentLayerPass[] = [];
  for (const adjustment of canonical.layers) {
    if (adjustment.kind !== "adjustment") continue;
    const groupPath = groupPathFor(adjustment.parentGroupId, groups);
    const ancestorsVisible = groupPathVisible(groupPath, groups);
    const siblings = layersByParent.get(parentSortKey(adjustment.parentGroupId)) ?? [];
    const eligible = siblings.filter((layer): layer is StudioAdjustmentContentLayer =>
      layer.kind === "content"
      && layer.visible
      && layer.paintOrder < adjustment.paintOrder);
    const sources = adjustment.scope === "clip-previous"
      ? eligible.slice(-1)
      : eligible;
    const operations = Object.freeze(
      listEnabledStudioAdjustmentOperations(
        normalizeStudioAdjustmentStack(adjustment.stack),
      ).map((operation) => Object.freeze({
        ...operation,
        params: Object.freeze({ ...operation.params }),
      })),
    );
    let status: StudioAdjustmentLayerPlanStatus = "active";
    if (!adjustment.visible || !ancestorsVisible) status = "hidden";
    else if (adjustment.opacity === 0) status = "transparent";
    else if (operations.length === 0) status = "empty-stack";
    else if (sources.length === 0) status = "empty-scope";
    const sourceLayerIds = Object.freeze(sources.map((source) => source.id));
    const sourceRenderKinds = Object.freeze(sources.map((source) => source.renderKind));
    const upstreamAdjustmentLayerIds = Object.freeze(
      passes
        .filter((pass) =>
          pass.parentGroupId === adjustment.parentGroupId
          && pass.status === "active"
          && sourceOverlap(pass.sourceLayerIds, sourceLayerIds))
        .map((pass) => pass.adjustmentLayerId),
    );
    const passCore = {
      adjustmentLayerId: adjustment.id,
      parentGroupId: adjustment.parentGroupId,
      groupPath,
      paintOrder: adjustment.paintOrder,
      scope: adjustment.scope,
      opacity: adjustment.opacity,
      blendMode: adjustment.blendMode,
      ...(adjustment.maskId === undefined ? {} : { maskId: adjustment.maskId }),
      status,
      sourceLayerIds,
      sourceRenderKinds,
      upstreamAdjustmentLayerIds,
      operations,
      compositeMode: "flatten-then-filter" as const,
      acceptsNonRasterSources: true as const,
    };
    passes.push(Object.freeze({
      ...passCore,
      fingerprint: fingerprint(passCore as unknown as CanonicalJson),
    }));
  }
  const frozenPasses = Object.freeze(passes);
  return Object.freeze({
    version: STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION,
    passes: frozenPasses,
    fingerprint: fingerprint({
      version: STUDIO_ADJUSTMENT_LAYER_DOCUMENT_VERSION,
      passes: frozenPasses,
    } as unknown as CanonicalJson),
  });
}

export function findStudioAdjustmentPassesAffectingLayer(
  document: StudioAdjustmentLayerDocument,
  layerId: string,
): readonly StudioAdjustmentLayerPass[] {
  requireId(layerId, "$.layerId");
  return Object.freeze(
    buildStudioAdjustmentLayerCompositorPlan(document).passes.filter((pass) =>
      pass.status === "active" && pass.sourceLayerIds.includes(layerId)),
  );
}
