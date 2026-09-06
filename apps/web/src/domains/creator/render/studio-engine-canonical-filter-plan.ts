import { sha256HexPortable } from "../studio-sha256";

/**
 * Renderer-neutral, future-only non-destructive filter recipe.
 *
 * The recipe deliberately has no legacy engine identifiers or byte-encoded colour modes. Storage
 * is scene-linear premultiplied RGBA16F; colour math crosses an explicit straight-alpha boundary,
 * while spatial convolution remains premultiplied so transparent pixels cannot inject hidden RGB.
 */

export const STUDIO_CANONICAL_FILTER_RECIPE_VERSION = 1 as const;
export const STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE = 4 as const;
export const STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION = "monotone-cubic" as const;
export const STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE = 4_096 as const;

export const STUDIO_CANONICAL_FILTER_BUDGETS = Object.freeze({
  maxNodes: 64,
  maxIdentifierCharacters: 128,
  maxDimension: 65_536,
  maxPixels: 268_435_456,
  maxTileSize: 1_024,
  maxTiles: 262_144,
  maxDispatches: 1_048_576,
  maxHalo: 256,
  maxSigma: 64,
  maxCurvePoints: 64,
  maxReferenceWhiteNits: 10_000,
} as const);

export type StudioCanonicalFilterWorkingSpace =
  | "linear-srgb"
  | "linear-display-p3"
  | "linear-rec2020";

export type StudioCanonicalFilterPrimaries = "srgb" | "display-p3" | "rec2020";
export type StudioCanonicalFilterBorderMode = "clamp" | "reflect" | "transparent";

export interface StudioCanonicalFilterColorMetadata {
  readonly workingSpace: StudioCanonicalFilterWorkingSpace;
  readonly primaries: StudioCanonicalFilterPrimaries;
  readonly transfer: "scene-linear";
  readonly whitePoint: "d65";
  readonly referenceWhiteNits: number;
  readonly storageFormat: "rgba16float";
  readonly storageAlphaMode: "premultiplied";
  readonly filterMathAlphaMode: "straight";
}

export const STUDIO_CANONICAL_FILTER_DEFAULT_COLOR_METADATA =
  deepFreeze<StudioCanonicalFilterColorMetadata>({
    workingSpace: "linear-display-p3",
    primaries: "display-p3",
    transfer: "scene-linear",
    whitePoint: "d65",
    referenceWhiteNits: 203,
    storageFormat: "rgba16float",
    storageAlphaMode: "premultiplied",
    filterMathAlphaMode: "straight",
  });

export interface StudioCanonicalFilterInputNode {
  readonly id: string;
  readonly kind: "input";
  readonly source: "document-composite";
}

export interface StudioCanonicalFilterGaussianBlurNode {
  readonly id: string;
  readonly kind: "gaussian-blur";
  readonly input: string;
  readonly sigma: number;
  /** Must equal ceil(sigma * truncate), except sigma=0 where radius=0. */
  readonly radius: number;
  readonly truncate: typeof STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE;
  readonly borderMode: StudioCanonicalFilterBorderMode;
}

export interface StudioCanonicalFilterUnsharpMaskNode {
  readonly id: string;
  readonly kind: "unsharp-mask";
  readonly input: string;
  readonly sigma: number;
  readonly radius: number;
  readonly truncate: typeof STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE;
  readonly amount: number;
  /** Scene-linear straight-channel threshold. */
  readonly threshold: number;
  readonly borderMode: StudioCanonicalFilterBorderMode;
}

export interface StudioCanonicalFilterExposureContrastNode {
  readonly id: string;
  readonly kind: "exposure-contrast";
  readonly input: string;
  readonly exposureStops: number;
  readonly contrast: number;
  readonly pivot: number;
}

export interface StudioCanonicalFilterLevelsNode {
  readonly id: string;
  readonly kind: "levels";
  readonly input: string;
  readonly inputBlack: readonly [number, number, number];
  readonly inputWhite: readonly [number, number, number];
  readonly gamma: readonly [number, number, number];
  readonly outputBlack: readonly [number, number, number];
  readonly outputWhite: readonly [number, number, number];
}

export interface StudioCanonicalFilterCurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioCanonicalFilterCurvesNode {
  readonly id: string;
  readonly kind: "curves";
  readonly input: string;
  readonly interpolation: typeof STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION;
  readonly lutSize: typeof STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE;
  readonly rgb: readonly StudioCanonicalFilterCurvePoint[];
  readonly red: readonly StudioCanonicalFilterCurvePoint[];
  readonly green: readonly StudioCanonicalFilterCurvePoint[];
  readonly blue: readonly StudioCanonicalFilterCurvePoint[];
}

export interface StudioCanonicalFilterColorMatrixNode {
  readonly id: string;
  readonly kind: "color-matrix";
  readonly input: string;
  /** Row-major 4x5 straight-RGBA matrix. */
  readonly matrix: readonly [
    number, number, number, number, number,
    number, number, number, number, number,
    number, number, number, number, number,
    number, number, number, number, number,
  ];
}

export interface StudioCanonicalFilterChannelMixerNode {
  readonly id: string;
  readonly kind: "channel-mixer";
  readonly input: string;
  /** Row-major 3x4 straight-RGB matrix; the fourth column is a constant offset. */
  readonly matrix: readonly [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
}

export interface StudioCanonicalFilterThresholdNode {
  readonly id: string;
  readonly kind: "threshold";
  readonly input: string;
  readonly threshold: number;
  readonly mode: "luminance" | "per-channel";
}

export interface StudioCanonicalFilterPosterizeNode {
  readonly id: string;
  readonly kind: "posterize";
  readonly input: string;
  readonly levels: number;
}

export interface StudioCanonicalFilterMorphologyNode {
  readonly id: string;
  readonly kind: "morphology";
  readonly input: string;
  readonly operation: "min" | "max";
  readonly metric: "alpha";
  readonly radius: number;
  readonly borderMode: StudioCanonicalFilterBorderMode;
}

export type StudioCanonicalFilterNode =
  | StudioCanonicalFilterInputNode
  | StudioCanonicalFilterGaussianBlurNode
  | StudioCanonicalFilterUnsharpMaskNode
  | StudioCanonicalFilterExposureContrastNode
  | StudioCanonicalFilterLevelsNode
  | StudioCanonicalFilterCurvesNode
  | StudioCanonicalFilterColorMatrixNode
  | StudioCanonicalFilterChannelMixerNode
  | StudioCanonicalFilterThresholdNode
  | StudioCanonicalFilterPosterizeNode
  | StudioCanonicalFilterMorphologyNode;

export type StudioCanonicalFilterOperationNode = Exclude<
  StudioCanonicalFilterNode,
  StudioCanonicalFilterInputNode
>;

export interface StudioCanonicalFilterRecipe {
  readonly kind: "studio-canonical-filter-recipe";
  readonly version: typeof STUDIO_CANONICAL_FILTER_RECIPE_VERSION;
  readonly recipeId: string;
  readonly revision: number;
  readonly graph: "ordered-single-output-dag";
  readonly color: StudioCanonicalFilterColorMetadata;
  /** Strict topological order. Ordering is semantic and participates in the content hash. */
  readonly nodes: readonly StudioCanonicalFilterNode[];
  readonly outputNodeId: string;
}

export type StudioCanonicalFilterParseFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-field"
  | "unsupported-version"
  | "unsupported-node"
  | "budget-exceeded"
  | "duplicate-node-id"
  | "missing-input"
  | "non-topological-input"
  | "invalid-output";

export type StudioCanonicalFilterParseResult =
  | { readonly ok: true; readonly value: StudioCanonicalFilterRecipe }
  | {
      readonly ok: false;
      readonly reason: StudioCanonicalFilterParseFailureReason;
      readonly path: string;
    };

type UnknownRecord = Record<string, unknown>;
type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: StudioCanonicalFilterParseFailureReason;
      readonly path: string;
    };

const NODE_KEYS: Record<StudioCanonicalFilterNode["kind"], readonly string[]> = {
  input: ["id", "kind", "source"],
  "gaussian-blur": ["id", "kind", "input", "sigma", "radius", "truncate", "borderMode"],
  "unsharp-mask": [
    "id",
    "kind",
    "input",
    "sigma",
    "radius",
    "truncate",
    "amount",
    "threshold",
    "borderMode",
  ],
  "exposure-contrast": ["id", "kind", "input", "exposureStops", "contrast", "pivot"],
  levels: [
    "id",
    "kind",
    "input",
    "inputBlack",
    "inputWhite",
    "gamma",
    "outputBlack",
    "outputWhite",
  ],
  curves: ["id", "kind", "input", "interpolation", "lutSize", "rgb", "red", "green", "blue"],
  "color-matrix": ["id", "kind", "input", "matrix"],
  "channel-mixer": ["id", "kind", "input", "matrix"],
  threshold: ["id", "kind", "input", "threshold", "mode"],
  posterize: ["id", "kind", "input", "levels"],
  morphology: ["id", "kind", "input", "operation", "metric", "radius", "borderMode"],
};

const NODE_KINDS = new Set<string>(Object.keys(NODE_KEYS));

function fail<T>(
  reason: StudioCanonicalFilterParseFailureReason,
  path: string,
): ValidationResult<T> {
  return { ok: false, reason, path };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function inspectRecord(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): ValidationResult<UnknownRecord> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return fail("not-plain-data", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("not-plain-data", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) return fail("not-plain-data", path);
    const allowed = new Set(allowedKeys);
    const result: UnknownRecord = {};
    for (const key of keys as string[]) {
      if (!allowed.has(key)) return fail("unknown-field", `${path}.${key}`);
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return fail("not-plain-data", `${path}.${key}`);
      }
      result[key] = descriptor.value;
    }
    for (const key of allowedKeys) {
      if (!(key in result)) return fail("invalid-field", `${path}.${key}`);
    }
    return { ok: true, value: result };
  } catch {
    return fail("not-plain-data", path);
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function safeUnsignedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0);
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_CANONICAL_FILTER_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function borderMode(value: unknown): value is StudioCanonicalFilterBorderMode {
  return value === "clamp" || value === "reflect" || value === "transparent";
}

function inspectArray(
  value: unknown,
  exactLength: number | null,
  maxLength: number,
  path: string,
): ValidationResult<readonly unknown[]> {
  try {
    if (!Array.isArray(value)) return fail("invalid-field", path);
    if (exactLength !== null && value.length !== exactLength) return fail("invalid-field", path);
    if (value.length > maxLength) return fail("budget-exceeded", path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = new Set([...value.keys()].map(String).concat("length"));
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === "symbol" || !expectedKeys.has(key)) return fail("not-plain-data", path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (key !== "length" && (!descriptor.enumerable || !("value" in descriptor))) {
        return fail("not-plain-data", path);
      }
    }
    return { ok: true, value };
  } catch {
    return fail("not-plain-data", path);
  }
}

function numberTuple<N extends number>(
  value: unknown,
  length: N,
  min: number,
  max: number,
  path: string,
): ValidationResult<readonly number[]> {
  const array = inspectArray(value, length, length, path);
  if (!array.ok) return array;
  for (let index = 0; index < array.value.length; index += 1) {
    if (!finiteIn(array.value[index], min, max)) return fail("invalid-field", `${path}[${index}]`);
  }
  return { ok: true, value: [...array.value] as number[] };
}

function validateColorMetadata(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalFilterColorMetadata> {
  const record = inspectRecord(
    input,
    [
      "workingSpace",
      "primaries",
      "transfer",
      "whitePoint",
      "referenceWhiteNits",
      "storageFormat",
      "storageAlphaMode",
      "filterMathAlphaMode",
    ],
    path,
  );
  if (!record.ok) return record;
  const validPair =
    (record.value.workingSpace === "linear-srgb" && record.value.primaries === "srgb")
    || (
      record.value.workingSpace === "linear-display-p3"
      && record.value.primaries === "display-p3"
    )
    || (
      record.value.workingSpace === "linear-rec2020"
      && record.value.primaries === "rec2020"
    );
  if (
    !validPair
    || record.value.transfer !== "scene-linear"
    || record.value.whitePoint !== "d65"
    || !finiteIn(
      record.value.referenceWhiteNits,
      1,
      STUDIO_CANONICAL_FILTER_BUDGETS.maxReferenceWhiteNits,
    )
    || record.value.storageFormat !== "rgba16float"
    || record.value.storageAlphaMode !== "premultiplied"
    || record.value.filterMathAlphaMode !== "straight"
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      workingSpace: record.value.workingSpace,
      primaries: record.value.primaries,
      transfer: "scene-linear",
      whitePoint: "d65",
      referenceWhiteNits: record.value.referenceWhiteNits,
      storageFormat: "rgba16float",
      storageAlphaMode: "premultiplied",
      filterMathAlphaMode: "straight",
    } as StudioCanonicalFilterColorMetadata,
  };
}

export function studioCanonicalFilterGaussianRadius(sigma: number): number {
  if (!Number.isFinite(sigma) || sigma <= 0) return 0;
  return Math.ceil(sigma * STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE);
}

function validateCurvePoints(
  value: unknown,
  path: string,
): ValidationResult<readonly StudioCanonicalFilterCurvePoint[]> {
  const array = inspectArray(
    value,
    null,
    STUDIO_CANONICAL_FILTER_BUDGETS.maxCurvePoints,
    path,
  );
  if (!array.ok) return array;
  if (array.value.length < 2) return fail("invalid-field", path);
  const points: StudioCanonicalFilterCurvePoint[] = [];
  let previousX = -1;
  for (let index = 0; index < array.value.length; index += 1) {
    const point = inspectRecord(array.value[index], ["x", "y"], `${path}[${index}]`);
    if (!point.ok) return point;
    if (
      !finiteIn(point.value.x, 0, 1)
      || !finiteIn(point.value.y, 0, 1)
      || point.value.x <= previousX
    ) return fail("invalid-field", `${path}[${index}]`);
    previousX = point.value.x;
    points.push({ x: point.value.x, y: point.value.y });
  }
  if (points[0]!.x !== 0 || points.at(-1)!.x !== 1) return fail("invalid-field", path);
  return { ok: true, value: points };
}

function nodeIdentity(
  record: UnknownRecord,
  path: string,
): ValidationResult<{ readonly id: string; readonly input: string }> {
  if (!identifier(record.id)) return fail("invalid-field", `${path}.id`);
  if (!identifier(record.input)) return fail("invalid-field", `${path}.input`);
  return { ok: true, value: { id: record.id, input: record.input } };
}

function validateOperationNode(
  input: unknown,
  kind: Exclude<StudioCanonicalFilterNode["kind"], "input">,
  path: string,
): ValidationResult<StudioCanonicalFilterOperationNode> {
  const record = inspectRecord(input, NODE_KEYS[kind], path);
  if (!record.ok) return record;
  const identity = nodeIdentity(record.value, path);
  if (!identity.ok) return identity;
  const base = identity.value;

  switch (kind) {
    case "gaussian-blur": {
      if (
        !finiteIn(record.value.sigma, 0, STUDIO_CANONICAL_FILTER_BUDGETS.maxSigma)
        || !safeUnsignedInteger(record.value.radius)
        || record.value.radius > STUDIO_CANONICAL_FILTER_BUDGETS.maxHalo
        || record.value.radius !== studioCanonicalFilterGaussianRadius(record.value.sigma)
        || record.value.truncate !== STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE
        || !borderMode(record.value.borderMode)
      ) return fail("invalid-field", path);
      return {
        ok: true,
        value: {
          ...base,
          kind,
          sigma: record.value.sigma,
          radius: record.value.radius,
          truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
          borderMode: record.value.borderMode,
        },
      };
    }
    case "unsharp-mask": {
      if (
        !finiteIn(record.value.sigma, 0, STUDIO_CANONICAL_FILTER_BUDGETS.maxSigma)
        || !safeUnsignedInteger(record.value.radius)
        || record.value.radius > STUDIO_CANONICAL_FILTER_BUDGETS.maxHalo
        || record.value.radius !== studioCanonicalFilterGaussianRadius(record.value.sigma)
        || record.value.truncate !== STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE
        || !finiteIn(record.value.amount, 0, 16)
        || !finiteIn(record.value.threshold, 0, 16)
        || !borderMode(record.value.borderMode)
      ) return fail("invalid-field", path);
      return {
        ok: true,
        value: {
          ...base,
          kind,
          sigma: record.value.sigma,
          radius: record.value.radius,
          truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
          amount: record.value.amount,
          threshold: record.value.threshold,
          borderMode: record.value.borderMode,
        },
      };
    }
    case "exposure-contrast": {
      if (
        !finiteIn(record.value.exposureStops, -32, 32)
        || !finiteIn(record.value.contrast, 0, 32)
        || !finiteIn(record.value.pivot, 0, 16)
      ) return fail("invalid-field", path);
      return {
        ok: true,
        value: {
          ...base,
          kind,
          exposureStops: record.value.exposureStops,
          contrast: record.value.contrast,
          pivot: record.value.pivot,
        },
      };
    }
    case "levels": {
      const inputBlack = numberTuple(record.value.inputBlack, 3, -16, 16, `${path}.inputBlack`);
      if (!inputBlack.ok) return inputBlack;
      const inputWhite = numberTuple(record.value.inputWhite, 3, -16, 16, `${path}.inputWhite`);
      if (!inputWhite.ok) return inputWhite;
      const gamma = numberTuple(record.value.gamma, 3, 0.01, 100, `${path}.gamma`);
      if (!gamma.ok) return gamma;
      const outputBlack = numberTuple(record.value.outputBlack, 3, -16, 16, `${path}.outputBlack`);
      if (!outputBlack.ok) return outputBlack;
      const outputWhite = numberTuple(record.value.outputWhite, 3, -16, 16, `${path}.outputWhite`);
      if (!outputWhite.ok) return outputWhite;
      if (inputWhite.value.some((value, index) => value <= inputBlack.value[index]!)) {
        return fail("invalid-field", path);
      }
      return {
        ok: true,
        value: {
          ...base,
          kind,
          inputBlack: inputBlack.value as [number, number, number],
          inputWhite: inputWhite.value as [number, number, number],
          gamma: gamma.value as [number, number, number],
          outputBlack: outputBlack.value as [number, number, number],
          outputWhite: outputWhite.value as [number, number, number],
        },
      };
    }
    case "curves": {
      if (
        record.value.interpolation !== STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION
        || record.value.lutSize !== STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE
      ) return fail("invalid-field", path);
      const rgb = validateCurvePoints(record.value.rgb, `${path}.rgb`);
      if (!rgb.ok) return rgb;
      const red = validateCurvePoints(record.value.red, `${path}.red`);
      if (!red.ok) return red;
      const green = validateCurvePoints(record.value.green, `${path}.green`);
      if (!green.ok) return green;
      const blue = validateCurvePoints(record.value.blue, `${path}.blue`);
      if (!blue.ok) return blue;
      return {
        ok: true,
        value: {
          ...base,
          kind,
          interpolation: STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
          lutSize: STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
          rgb: rgb.value,
          red: red.value,
          green: green.value,
          blue: blue.value,
        },
      };
    }
    case "color-matrix": {
      const matrix = numberTuple(record.value.matrix, 20, -64, 64, `${path}.matrix`);
      if (!matrix.ok) return matrix;
      return {
        ok: true,
        value: { ...base, kind, matrix: matrix.value as StudioCanonicalFilterColorMatrixNode["matrix"] },
      };
    }
    case "channel-mixer": {
      const matrix = numberTuple(record.value.matrix, 12, -64, 64, `${path}.matrix`);
      if (!matrix.ok) return matrix;
      return {
        ok: true,
        value: { ...base, kind, matrix: matrix.value as StudioCanonicalFilterChannelMixerNode["matrix"] },
      };
    }
    case "threshold": {
      if (
        !finiteIn(record.value.threshold, 0, 16)
        || (record.value.mode !== "luminance" && record.value.mode !== "per-channel")
      ) return fail("invalid-field", path);
      return {
        ok: true,
        value: {
          ...base,
          kind,
          threshold: record.value.threshold,
          mode: record.value.mode,
        },
      };
    }
    case "posterize": {
      if (
        !safeUnsignedInteger(record.value.levels)
        || record.value.levels < 2
        || record.value.levels > 65_536
      ) return fail("invalid-field", path);
      return { ok: true, value: { ...base, kind, levels: record.value.levels } };
    }
    case "morphology": {
      if (
        (record.value.operation !== "min" && record.value.operation !== "max")
        || record.value.metric !== "alpha"
        || !safeUnsignedInteger(record.value.radius)
        || record.value.radius > STUDIO_CANONICAL_FILTER_BUDGETS.maxHalo
        || !borderMode(record.value.borderMode)
      ) return fail("invalid-field", path);
      return {
        ok: true,
        value: {
          ...base,
          kind,
          operation: record.value.operation,
          metric: "alpha",
          radius: record.value.radius,
          borderMode: record.value.borderMode,
        },
      };
    }
    default:
      return fail("unsupported-node", `${path}.kind`);
  }
}

function validateNode(input: unknown, path: string): ValidationResult<StudioCanonicalFilterNode> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("not-plain-data", path);
  }
  let kind: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (!descriptor || !("value" in descriptor)) return fail("invalid-field", `${path}.kind`);
    kind = descriptor.value;
  } catch {
    return fail("not-plain-data", path);
  }
  if (kind === "input") {
    const record = inspectRecord(input, NODE_KEYS.input, path);
    if (!record.ok) return record;
    if (!identifier(record.value.id) || record.value.source !== "document-composite") {
      return fail("invalid-field", path);
    }
    return {
      ok: true,
      value: { id: record.value.id, kind: "input", source: "document-composite" },
    };
  }
  if (typeof kind !== "string" || !NODE_KINDS.has(kind)) {
    return fail("unsupported-node", `${path}.kind`);
  }
  return validateOperationNode(
    input,
    kind as Exclude<StudioCanonicalFilterNode["kind"], "input">,
    path,
  );
}

/**
 * Untrusted-data boundary. Data is never repaired, clamped, reordered or silently approximated.
 * The returned schema-ordered object is detached and deeply frozen.
 */
export function parseStudioCanonicalFilterRecipe(
  input: unknown,
): StudioCanonicalFilterParseResult {
  const record = inspectRecord(
    input,
    ["kind", "version", "recipeId", "revision", "graph", "color", "nodes", "outputNodeId"],
    "$",
  );
  if (!record.ok) return record;
  if (record.value.kind !== "studio-canonical-filter-recipe") {
    return fail("invalid-field", "$.kind");
  }
  if (record.value.version !== STUDIO_CANONICAL_FILTER_RECIPE_VERSION) {
    return fail("unsupported-version", "$.version");
  }
  if (
    !identifier(record.value.recipeId)
    || !safeUnsignedInteger(record.value.revision)
    || record.value.graph !== "ordered-single-output-dag"
    || !identifier(record.value.outputNodeId)
  ) return fail("invalid-field", "$");
  const color = validateColorMetadata(record.value.color, "$.color");
  if (!color.ok) return color;
  const rawNodes = inspectArray(
    record.value.nodes,
    null,
    STUDIO_CANONICAL_FILTER_BUDGETS.maxNodes,
    "$.nodes",
  );
  if (!rawNodes.ok) return rawNodes;
  if (rawNodes.value.length < 1) return fail("invalid-field", "$.nodes");
  const nodes: StudioCanonicalFilterNode[] = [];
  const known = new Set<string>();
  let inputCount = 0;
  for (let index = 0; index < rawNodes.value.length; index += 1) {
    const node = validateNode(rawNodes.value[index], `$.nodes[${index}]`);
    if (!node.ok) return node;
    if (known.has(node.value.id)) return fail("duplicate-node-id", `$.nodes[${index}].id`);
    if (node.value.kind === "input") {
      inputCount += 1;
      if (index !== 0 || inputCount !== 1) return fail("invalid-field", `$.nodes[${index}]`);
    } else if (!known.has(node.value.input)) {
      return fail("non-topological-input", `$.nodes[${index}].input`);
    }
    known.add(node.value.id);
    nodes.push(node.value);
  }
  if (inputCount !== 1) return fail("missing-input", "$.nodes");
  if (!known.has(record.value.outputNodeId)) return fail("invalid-output", "$.outputNodeId");
  if (record.value.revision !== nodes.length - 1) return fail("invalid-field", "$.revision");
  const recipe: StudioCanonicalFilterRecipe = {
    kind: "studio-canonical-filter-recipe",
    version: STUDIO_CANONICAL_FILTER_RECIPE_VERSION,
    recipeId: record.value.recipeId,
    revision: record.value.revision,
    graph: "ordered-single-output-dag",
    color: color.value,
    nodes,
    outputNodeId: record.value.outputNodeId,
  };
  return { ok: true, value: deepFreeze(recipe) };
}

export interface StudioCanonicalFilterRecipeOptions {
  readonly recipeId: string;
  readonly inputNodeId?: string;
  readonly color?: StudioCanonicalFilterColorMetadata;
}

export function createStudioCanonicalFilterRecipe(
  options: StudioCanonicalFilterRecipeOptions,
): StudioCanonicalFilterRecipe {
  const inputNodeId = options.inputNodeId ?? "source";
  const candidate = {
    kind: "studio-canonical-filter-recipe",
    version: STUDIO_CANONICAL_FILTER_RECIPE_VERSION,
    recipeId: options.recipeId,
    revision: 0,
    graph: "ordered-single-output-dag",
    color: options.color ?? STUDIO_CANONICAL_FILTER_DEFAULT_COLOR_METADATA,
    nodes: [{ id: inputNodeId, kind: "input", source: "document-composite" }],
    outputNodeId: inputNodeId,
  };
  const parsed = parseStudioCanonicalFilterRecipe(candidate);
  if (!parsed.ok) {
    throw new Error(`Invalid canonical filter recipe at ${parsed.path}: ${parsed.reason}`);
  }
  return parsed.value;
}

export function appendStudioCanonicalFilterNode(
  recipe: StudioCanonicalFilterRecipe,
  node: StudioCanonicalFilterOperationNode,
): StudioCanonicalFilterRecipe {
  const candidate = {
    kind: recipe.kind,
    version: recipe.version,
    recipeId: recipe.recipeId,
    revision: recipe.revision + 1,
    graph: recipe.graph,
    color: recipe.color,
    nodes: [...recipe.nodes, node],
    outputNodeId: node.id,
  };
  const parsed = parseStudioCanonicalFilterRecipe(candidate);
  if (!parsed.ok) {
    throw new Error(`Invalid canonical filter append at ${parsed.path}: ${parsed.reason}`);
  }
  return parsed.value;
}

export function rebuildStudioCanonicalFilterRecipe(
  options: StudioCanonicalFilterRecipeOptions,
  nodes: readonly StudioCanonicalFilterOperationNode[],
): StudioCanonicalFilterRecipe {
  return nodes.reduce(
    (recipe, node) => appendStudioCanonicalFilterNode(recipe, node),
    createStudioCanonicalFilterRecipe(options),
  );
}

/** Canonical schema order is already fixed by the parser/rebuilder. */
export function encodeStudioCanonicalFilterRecipe(recipe: StudioCanonicalFilterRecipe): string {
  return JSON.stringify(recipe);
}

/** SHA-256 identity over canonical UTF-8 JSON; suitable for replay, cache and integrity receipts. */
export function hashStudioCanonicalFilterRecipe(recipe: StudioCanonicalFilterRecipe): string {
  const bytes = new TextEncoder().encode(encodeStudioCanonicalFilterRecipe(recipe));
  return `sha256:${sha256HexPortable(bytes)}`;
}

export interface StudioCanonicalFilterRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StudioCanonicalFilterPassKind =
  | "point"
  | "gaussian-horizontal"
  | "gaussian-vertical"
  | "unsharp-combine"
  | "morphology-horizontal"
  | "morphology-vertical";

export interface StudioCanonicalFilterTileDispatch {
  readonly tileIndex: number;
  readonly core: StudioCanonicalFilterRect;
  /** May extend outside the image; the declared border mode resolves those coordinates. */
  readonly read: StudioCanonicalFilterRect;
  readonly clippedRead: StudioCanonicalFilterRect;
  readonly halo: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly workgroupsX: number;
  readonly workgroupsY: number;
}

export interface StudioCanonicalFilterExecutionStage {
  readonly nodeId: string;
  readonly nodeKind: StudioCanonicalFilterOperationNode["kind"];
  readonly inputNodeId: string;
  readonly pass: StudioCanonicalFilterPassKind;
  readonly borderMode: StudioCanonicalFilterBorderMode;
  readonly radius: number;
  readonly tiles: readonly StudioCanonicalFilterTileDispatch[];
}

export interface StudioCanonicalFilterExecutionPlan {
  readonly kind: "studio-canonical-filter-execution-plan";
  readonly version: 1;
  readonly recipeHash: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly textureFormat: "rgba16float";
  readonly workingSpace: StudioCanonicalFilterWorkingSpace;
  readonly storageAlphaMode: "premultiplied";
  readonly filterMathAlphaMode: "straight";
  readonly stages: readonly StudioCanonicalFilterExecutionStage[];
  readonly tileCount: number;
  readonly dispatchCount: number;
  readonly maximumHalo: number;
}

export type StudioCanonicalFilterPlanFailureReason =
  | "invalid-dimensions"
  | "pixel-budget-exceeded"
  | "invalid-tile-size"
  | "tile-budget-exceeded"
  | "dispatch-budget-exceeded"
  | "halo-budget-exceeded"
  | "invalid-recipe";

export type StudioCanonicalFilterPlanResult =
  | { readonly status: "ready"; readonly plan: StudioCanonicalFilterExecutionPlan }
  | { readonly status: "rejected"; readonly reason: StudioCanonicalFilterPlanFailureReason };

export interface StudioCanonicalFilterPlannerOptions {
  readonly tileSize?: number;
  readonly maxPixels?: number;
  readonly maxTiles?: number;
  readonly maxDispatches?: number;
  readonly maxHalo?: number;
}

function stagePasses(
  node: StudioCanonicalFilterOperationNode,
): readonly {
  readonly pass: StudioCanonicalFilterPassKind;
  readonly radius: number;
  readonly borderMode: StudioCanonicalFilterBorderMode;
  readonly axis: "x" | "y" | "none";
}[] {
  switch (node.kind) {
    case "gaussian-blur":
      return [
        { pass: "gaussian-horizontal", radius: node.radius, borderMode: node.borderMode, axis: "x" },
        { pass: "gaussian-vertical", radius: node.radius, borderMode: node.borderMode, axis: "y" },
      ];
    case "unsharp-mask":
      return [
        { pass: "gaussian-horizontal", radius: node.radius, borderMode: node.borderMode, axis: "x" },
        { pass: "gaussian-vertical", radius: node.radius, borderMode: node.borderMode, axis: "y" },
        { pass: "unsharp-combine", radius: 0, borderMode: node.borderMode, axis: "none" },
      ];
    case "morphology":
      return [
        {
          pass: "morphology-horizontal",
          radius: node.radius,
          borderMode: node.borderMode,
          axis: "x",
        },
        {
          pass: "morphology-vertical",
          radius: node.radius,
          borderMode: node.borderMode,
          axis: "y",
        },
      ];
    default:
      return [{ pass: "point", radius: 0, borderMode: "clamp", axis: "none" }];
  }
}

function clipRect(
  rect: StudioCanonicalFilterRect,
  width: number,
  height: number,
): StudioCanonicalFilterRect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function planStudioCanonicalFilterExecution(
  recipe: StudioCanonicalFilterRecipe,
  width: number,
  height: number,
  options: StudioCanonicalFilterPlannerOptions = {},
): StudioCanonicalFilterPlanResult {
  const parsed = parseStudioCanonicalFilterRecipe(recipe);
  if (!parsed.ok) {
    return { status: "rejected", reason: "invalid-recipe" };
  }
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > STUDIO_CANONICAL_FILTER_BUDGETS.maxDimension
    || height > STUDIO_CANONICAL_FILTER_BUDGETS.maxDimension
  ) return { status: "rejected", reason: "invalid-dimensions" };
  const maxPixels = options.maxPixels ?? STUDIO_CANONICAL_FILTER_BUDGETS.maxPixels;
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0 || width > Math.floor(maxPixels / height)) {
    return { status: "rejected", reason: "pixel-budget-exceeded" };
  }
  const tileSize = options.tileSize ?? 256;
  if (
    !Number.isSafeInteger(tileSize)
    || tileSize <= 0
    || tileSize > STUDIO_CANONICAL_FILTER_BUDGETS.maxTileSize
  ) return { status: "rejected", reason: "invalid-tile-size" };
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const tileCount = columns * rows;
  const maxTiles = options.maxTiles ?? STUDIO_CANONICAL_FILTER_BUDGETS.maxTiles;
  if (!Number.isSafeInteger(maxTiles) || maxTiles <= 0 || tileCount > maxTiles) {
    return { status: "rejected", reason: "tile-budget-exceeded" };
  }
  const maxHalo = options.maxHalo ?? STUDIO_CANONICAL_FILTER_BUDGETS.maxHalo;
  const maxDispatches = options.maxDispatches ?? STUDIO_CANONICAL_FILTER_BUDGETS.maxDispatches;
  if (!safeUnsignedInteger(maxHalo)) {
    return { status: "rejected", reason: "halo-budget-exceeded" };
  }
  if (!Number.isSafeInteger(maxDispatches) || maxDispatches <= 0) {
    return { status: "rejected", reason: "dispatch-budget-exceeded" };
  }
  const stages: StudioCanonicalFilterExecutionStage[] = [];
  let dispatchCount = 0;
  let maximumHalo = 0;
  for (const node of parsed.value.nodes) {
    if (node.kind === "input") continue;
    for (const descriptor of stagePasses(node)) {
      if (descriptor.radius > maxHalo) {
        return { status: "rejected", reason: "halo-budget-exceeded" };
      }
      maximumHalo = Math.max(maximumHalo, descriptor.radius);
      const tiles: StudioCanonicalFilterTileDispatch[] = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const core: StudioCanonicalFilterRect = {
            x: column * tileSize,
            y: row * tileSize,
            width: Math.min(tileSize, width - column * tileSize),
            height: Math.min(tileSize, height - row * tileSize),
          };
          const halo = descriptor.axis === "x"
            ? { left: descriptor.radius, top: 0, right: descriptor.radius, bottom: 0 }
            : descriptor.axis === "y"
              ? { left: 0, top: descriptor.radius, right: 0, bottom: descriptor.radius }
              : { left: 0, top: 0, right: 0, bottom: 0 };
          const read: StudioCanonicalFilterRect = {
            x: core.x - halo.left,
            y: core.y - halo.top,
            width: core.width + halo.left + halo.right,
            height: core.height + halo.top + halo.bottom,
          };
          tiles.push({
            tileIndex: row * columns + column,
            core,
            read,
            clippedRead: clipRect(read, width, height),
            halo,
            workgroupsX: Math.ceil(core.width / 8),
            workgroupsY: Math.ceil(core.height / 8),
          });
        }
      }
      dispatchCount += tiles.length;
      if (
        !Number.isSafeInteger(dispatchCount)
        || dispatchCount > maxDispatches
      ) return { status: "rejected", reason: "dispatch-budget-exceeded" };
      stages.push({
        nodeId: node.id,
        nodeKind: node.kind,
        inputNodeId: node.input,
        pass: descriptor.pass,
        borderMode: descriptor.borderMode,
        radius: descriptor.radius,
        tiles,
      });
    }
  }
  return {
    status: "ready",
    plan: deepFreeze({
      kind: "studio-canonical-filter-execution-plan",
      version: 1,
      recipeHash: hashStudioCanonicalFilterRecipe(parsed.value),
      width,
      height,
      tileSize,
      textureFormat: "rgba16float",
      workingSpace: parsed.value.color.workingSpace,
      storageAlphaMode: "premultiplied",
      filterMathAlphaMode: "straight",
      stages,
      tileCount,
      dispatchCount,
      maximumHalo,
    }),
  };
}

export interface StudioCanonicalFilterLinearImage {
  readonly width: number;
  readonly height: number;
  /** Scene-linear premultiplied RGBA, four f32 components per pixel. */
  readonly data: Float32Array;
  readonly color: StudioCanonicalFilterColorMetadata;
}

export interface StudioCanonicalFilterCpuOptions {
  /** Divides every pass into tiles while retaining exact global halo reads. */
  readonly tileSize?: number;
}

const STUDIO_CANONICAL_FILTER_HALF_FLOAT_MAX = 65_504;

function cloneImage(
  image: StudioCanonicalFilterLinearImage,
): StudioCanonicalFilterLinearImage {
  return {
    width: image.width,
    height: image.height,
    data: new Float32Array(image.data),
    color: image.color,
  };
}

function validateCpuImage(
  image: StudioCanonicalFilterLinearImage,
  recipe: StudioCanonicalFilterRecipe,
): void {
  if (
    !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width <= 0
    || image.height <= 0
    || image.data.length !== image.width * image.height * 4
    || image.color.workingSpace !== recipe.color.workingSpace
    || image.color.primaries !== recipe.color.primaries
    || image.color.transfer !== recipe.color.transfer
    || image.color.whitePoint !== recipe.color.whitePoint
    || image.color.referenceWhiteNits !== recipe.color.referenceWhiteNits
    || image.color.storageFormat !== "rgba16float"
    || image.color.storageAlphaMode !== "premultiplied"
    || image.color.filterMathAlphaMode !== "straight"
  ) throw new Error("Canonical filter CPU oracle received an incompatible image");
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3]!;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error("Canonical filter CPU oracle received an invalid alpha component");
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const component = image.data[index + channel]!;
      if (
        !Number.isFinite(component)
        || Math.abs(component) > STUDIO_CANONICAL_FILTER_HALF_FLOAT_MAX
      ) {
        throw new Error("Canonical filter CPU oracle received an invalid colour component");
      }
      if (alpha <= 1e-8 && component !== 0) {
        throw new Error("Canonical filter CPU oracle received hidden RGB behind zero alpha");
      }
    }
  }
}

function coordinate(value: number, size: number, mode: StudioCanonicalFilterBorderMode): number {
  if (value >= 0 && value < size) return value;
  if (mode === "transparent") return -1;
  if (mode === "clamp" || size === 1) return Math.min(size - 1, Math.max(0, value));
  const period = 2 * (size - 1);
  const folded = ((value % period) + period) % period;
  return folded < size ? folded : period - folded;
}

function loadPixel(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  mode: StudioCanonicalFilterBorderMode,
  output: number[],
): void {
  const resolvedX = coordinate(x, width, mode);
  const resolvedY = coordinate(y, height, mode);
  if (resolvedX < 0 || resolvedY < 0) {
    output[0] = 0;
    output[1] = 0;
    output[2] = 0;
    output[3] = 0;
    return;
  }
  const index = (resolvedY * width + resolvedX) * 4;
  output[0] = source[index]!;
  output[1] = source[index + 1]!;
  output[2] = source[index + 2]!;
  output[3] = source[index + 3]!;
}

export function buildStudioCanonicalGaussianKernel(
  sigma: number,
  radius = studioCanonicalFilterGaussianRadius(sigma),
): Float64Array {
  if (
    !finiteIn(sigma, 0, STUDIO_CANONICAL_FILTER_BUDGETS.maxSigma)
    || !safeUnsignedInteger(radius)
    || radius !== studioCanonicalFilterGaussianRadius(sigma)
  ) throw new Error("Invalid canonical Gaussian kernel");
  if (radius === 0) return new Float64Array([1]);
  const weights = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    sum += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= sum;
  return weights;
}

function forEachTile(
  width: number,
  height: number,
  tileSize: number,
  callback: (left: number, top: number, right: number, bottom: number) => void,
): void {
  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      callback(left, top, Math.min(width, left + tileSize), Math.min(height, top + tileSize));
    }
  }
}

function separableGaussian(
  image: StudioCanonicalFilterLinearImage,
  sigma: number,
  radius: number,
  mode: StudioCanonicalFilterBorderMode,
  tileSize: number,
): StudioCanonicalFilterLinearImage {
  if (radius === 0) return cloneImage(image);
  const weights = buildStudioCanonicalGaussianKernel(sigma, radius);
  const horizontal = new Float32Array(image.data.length);
  const output = new Float32Array(image.data.length);
  const sample = [0, 0, 0, 0];
  forEachTile(image.width, image.height, tileSize, (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const target = (y * image.width + x) * 4;
        for (let offset = -radius; offset <= radius; offset += 1) {
          loadPixel(image.data, image.width, image.height, x + offset, y, mode, sample);
          const weight = weights[offset + radius]!;
          for (let channel = 0; channel < 4; channel += 1) {
            horizontal[target + channel] = horizontal[target + channel]! + sample[channel]! * weight;
          }
        }
      }
    }
  });
  forEachTile(image.width, image.height, tileSize, (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const target = (y * image.width + x) * 4;
        for (let offset = -radius; offset <= radius; offset += 1) {
          loadPixel(horizontal, image.width, image.height, x, y + offset, mode, sample);
          const weight = weights[offset + radius]!;
          for (let channel = 0; channel < 4; channel += 1) {
            output[target + channel] = output[target + channel]! + sample[channel]! * weight;
          }
        }
      }
    }
  });
  return { width: image.width, height: image.height, data: output, color: image.color };
}

function straightPixel(data: Float32Array, index: number): [number, number, number, number] {
  const alpha = Math.min(1, Math.max(0, data[index + 3]!));
  if (alpha <= 1e-8) return [0, 0, 0, 0];
  return [
    data[index]! / alpha,
    data[index + 1]! / alpha,
    data[index + 2]! / alpha,
    alpha,
  ];
}

function writeStraight(
  target: Float32Array,
  index: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  if (safeAlpha <= 1e-8) {
    target[index] = 0;
    target[index + 1] = 0;
    target[index + 2] = 0;
    target[index + 3] = 0;
    return;
  }
  const premultiply = (value: number): number => {
    if (Number.isNaN(value)) return 0;
    return Math.min(
      STUDIO_CANONICAL_FILTER_HALF_FLOAT_MAX,
      Math.max(-STUDIO_CANONICAL_FILTER_HALF_FLOAT_MAX, value * safeAlpha),
    );
  };
  target[index] = premultiply(red);
  target[index + 1] = premultiply(green);
  target[index + 2] = premultiply(blue);
  target[index + 3] = safeAlpha;
}

function transformStraightPixels(
  image: StudioCanonicalFilterLinearImage,
  transform: (
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ) => readonly [number, number, number, number],
): StudioCanonicalFilterLinearImage {
  const output = new Float32Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const [red, green, blue, alpha] = straightPixel(image.data, index);
    const transformed = transform(red, green, blue, alpha);
    writeStraight(output, index, ...transformed);
  }
  return { width: image.width, height: image.height, data: output, color: image.color };
}

function softThreshold(value: number, threshold: number): number {
  if (threshold <= 0) return 1;
  const normalized = (value - threshold) / threshold;
  const clamped = Math.min(1, Math.max(0, normalized));
  return clamped * clamped * (3 - 2 * clamped);
}

function applyUnsharp(
  image: StudioCanonicalFilterLinearImage,
  node: StudioCanonicalFilterUnsharpMaskNode,
  tileSize: number,
): StudioCanonicalFilterLinearImage {
  if (node.amount === 0 || node.radius === 0) return cloneImage(image);
  const blurred = separableGaussian(
    image,
    node.sigma,
    node.radius,
    node.borderMode,
    tileSize,
  );
  const output = new Float32Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const original = straightPixel(image.data, index);
    const low = straightPixel(blurred.data, index);
    const channels = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = original[channel]! - low[channel]!;
      channels[channel] = original[channel]!
        + delta * node.amount * softThreshold(Math.abs(delta), node.threshold);
    }
    writeStraight(output, index, channels[0]!, channels[1]!, channels[2]!, original[3]);
  }
  return { width: image.width, height: image.height, data: output, color: image.color };
}

function monotoneCurveSlopes(
  points: readonly StudioCanonicalFilterCurvePoint[],
): Float64Array {
  const intervals = points.length - 1;
  const widths = new Float64Array(intervals);
  const secants = new Float64Array(intervals);
  for (let index = 0; index < intervals; index += 1) {
    widths[index] = points[index + 1]!.x - points[index]!.x;
    secants[index] = (points[index + 1]!.y - points[index]!.y) / widths[index]!;
  }
  const slopes = new Float64Array(points.length);
  slopes[0] = secants[0]!;
  slopes[points.length - 1] = secants[intervals - 1]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = secants[index - 1]!;
    const right = secants[index]!;
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) {
      slopes[index] = 0;
    } else {
      const leftWeight = 2 * widths[index]! + widths[index - 1]!;
      const rightWeight = widths[index]! + 2 * widths[index - 1]!;
      slopes[index] = (leftWeight + rightWeight) / (leftWeight / left + rightWeight / right);
    }
  }
  return slopes;
}

export function evaluateStudioCanonicalFilterCurve(
  points: readonly StudioCanonicalFilterCurvePoint[],
  input: number,
): number {
  const value = Math.min(1, Math.max(0, input));
  let upper = 1;
  while (upper < points.length - 1 && value > points[upper]!.x) upper += 1;
  const lower = upper - 1;
  const left = points[lower]!;
  const right = points[upper]!;
  const width = right.x - left.x;
  if (width <= 0) throw new Error("Invalid canonical curve");
  const slopes = monotoneCurveSlopes(points);
  const t = (value - left.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * left.y
    + (t3 - 2 * t2 + t) * width * slopes[lower]!
    + (-2 * t3 + 3 * t2) * right.y
    + (t3 - t2) * width * slopes[upper]!;
}

export function buildStudioCanonicalFilterCurveLut(
  points: readonly StudioCanonicalFilterCurvePoint[],
  size = STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
): Float32Array {
  if (!Number.isSafeInteger(size) || size < 2 || size > 65_536) {
    throw new Error("Invalid canonical curve LUT size");
  }
  const lut = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    lut[index] = evaluateStudioCanonicalFilterCurve(points, index / (size - 1));
  }
  return lut;
}

function luminanceCoefficients(
  primaries: StudioCanonicalFilterPrimaries,
): readonly [number, number, number] {
  if (primaries === "display-p3") return [0.228_974_56, 0.691_738_52, 0.079_286_91];
  if (primaries === "rec2020") return [0.2627, 0.678, 0.0593];
  return [0.2126, 0.7152, 0.0722];
}

function applyPointNode(
  image: StudioCanonicalFilterLinearImage,
  node: Exclude<
    StudioCanonicalFilterOperationNode,
    | StudioCanonicalFilterGaussianBlurNode
    | StudioCanonicalFilterUnsharpMaskNode
    | StudioCanonicalFilterMorphologyNode
  >,
): StudioCanonicalFilterLinearImage {
  switch (node.kind) {
    case "exposure-contrast": {
      const exposure = 2 ** node.exposureStops;
      return transformStraightPixels(image, (red, green, blue, alpha) => [
        (red * exposure - node.pivot) * node.contrast + node.pivot,
        (green * exposure - node.pivot) * node.contrast + node.pivot,
        (blue * exposure - node.pivot) * node.contrast + node.pivot,
        alpha,
      ]);
    }
    case "levels":
      return transformStraightPixels(image, (red, green, blue, alpha) => {
        const input = [red, green, blue];
        const result = input.map((value, channel) => {
          const normalized = Math.min(
            1,
            Math.max(
              0,
              (value - node.inputBlack[channel]!)
                / (node.inputWhite[channel]! - node.inputBlack[channel]!),
            ),
          );
          const gamma = normalized ** (1 / node.gamma[channel]!);
          return node.outputBlack[channel]!
            + gamma * (node.outputWhite[channel]! - node.outputBlack[channel]!);
        });
        return [result[0]!, result[1]!, result[2]!, alpha];
      });
    case "curves":
      return transformStraightPixels(image, (red, green, blue, alpha) => {
        const masterRed = evaluateStudioCanonicalFilterCurve(node.rgb, red);
        const masterGreen = evaluateStudioCanonicalFilterCurve(node.rgb, green);
        const masterBlue = evaluateStudioCanonicalFilterCurve(node.rgb, blue);
        return [
          evaluateStudioCanonicalFilterCurve(node.red, masterRed),
          evaluateStudioCanonicalFilterCurve(node.green, masterGreen),
          evaluateStudioCanonicalFilterCurve(node.blue, masterBlue),
          alpha,
        ];
      });
    case "color-matrix":
      return transformStraightPixels(image, (red, green, blue, alpha) => {
        const input = [red, green, blue, alpha, 1];
        const result = [0, 0, 0, 0];
        for (let row = 0; row < 4; row += 1) {
          for (let column = 0; column < 5; column += 1) {
            result[row] = result[row]! + node.matrix[row * 5 + column]! * input[column]!;
          }
        }
        return [result[0]!, result[1]!, result[2]!, result[3]!];
      });
    case "channel-mixer":
      return transformStraightPixels(image, (red, green, blue, alpha) => {
        const input = [red, green, blue, 1];
        const result = [0, 0, 0];
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 4; column += 1) {
            result[row] = result[row]! + node.matrix[row * 4 + column]! * input[column]!;
          }
        }
        return [result[0]!, result[1]!, result[2]!, alpha];
      });
    case "threshold": {
      const coefficients = luminanceCoefficients(image.color.primaries);
      return transformStraightPixels(image, (red, green, blue, alpha) => {
        if (node.mode === "per-channel") {
          return [
            red >= node.threshold ? 1 : 0,
            green >= node.threshold ? 1 : 0,
            blue >= node.threshold ? 1 : 0,
            alpha,
          ];
        }
        const luminance =
          red * coefficients[0] + green * coefficients[1] + blue * coefficients[2];
        const value = luminance >= node.threshold ? 1 : 0;
        return [value, value, value, alpha];
      });
    }
    case "posterize": {
      const scale = node.levels - 1;
      return transformStraightPixels(image, (red, green, blue, alpha) => [
        Math.round(Math.min(1, Math.max(0, red)) * scale) / scale,
        Math.round(Math.min(1, Math.max(0, green)) * scale) / scale,
        Math.round(Math.min(1, Math.max(0, blue)) * scale) / scale,
        alpha,
      ]);
    }
  }
}

function morphologyPass(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  operation: "min" | "max",
  borderModeValue: StudioCanonicalFilterBorderMode,
  axis: "x" | "y",
  tileSize: number,
): Float32Array {
  if (radius === 0) return new Float32Array(source);
  const output = new Float32Array(source.length);
  const sample = [0, 0, 0, 0];
  forEachTile(width, height, tileSize, (left, top, right, bottom) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        let bestAlpha = operation === "max" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
        const best = [0, 0, 0, 0];
        for (let offset = -radius; offset <= radius; offset += 1) {
          loadPixel(
            source,
            width,
            height,
            axis === "x" ? x + offset : x,
            axis === "y" ? y + offset : y,
            borderModeValue,
            sample,
          );
          if (
            (operation === "max" && sample[3]! > bestAlpha)
            || (operation === "min" && sample[3]! < bestAlpha)
          ) {
            bestAlpha = sample[3]!;
            best[0] = sample[0]!;
            best[1] = sample[1]!;
            best[2] = sample[2]!;
            best[3] = sample[3]!;
          }
        }
        const target = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          output[target + channel] = best[channel]!;
        }
      }
    }
  });
  return output;
}

function applyMorphology(
  image: StudioCanonicalFilterLinearImage,
  node: StudioCanonicalFilterMorphologyNode,
  tileSize: number,
): StudioCanonicalFilterLinearImage {
  const horizontal = morphologyPass(
    image.data,
    image.width,
    image.height,
    node.radius,
    node.operation,
    node.borderMode,
    "x",
    tileSize,
  );
  const vertical = morphologyPass(
    horizontal,
    image.width,
    image.height,
    node.radius,
    node.operation,
    node.borderMode,
    "y",
    tileSize,
  );
  return { width: image.width, height: image.height, data: vertical, color: image.color };
}

/**
 * High-precision CPU oracle. Float64 kernels/evaluation feed f32 image storage, mirroring RGBA16F
 * pass boundaries without quantising to encoded bytes. Tiled and untiled evaluation share the
 * same global coordinate resolver, so a mismatch exposes a planner/kernel seam rather than a
 * different edge convention.
 */
export function applyStudioCanonicalFilterRecipeCpu(
  recipe: StudioCanonicalFilterRecipe,
  source: StudioCanonicalFilterLinearImage,
  options: StudioCanonicalFilterCpuOptions = {},
): StudioCanonicalFilterLinearImage {
  const parsed = parseStudioCanonicalFilterRecipe(recipe);
  if (!parsed.ok) throw new Error(`Invalid canonical filter recipe: ${parsed.reason}`);
  validateCpuImage(source, parsed.value);
  const tileSize = options.tileSize ?? Math.max(source.width, source.height);
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0) throw new Error("Invalid CPU tile size");
  const images = new Map<string, StudioCanonicalFilterLinearImage>();
  for (const node of parsed.value.nodes) {
    if (node.kind === "input") {
      images.set(node.id, cloneImage(source));
      continue;
    }
    const input = images.get(node.input);
    if (!input) throw new Error(`Missing canonical node input: ${node.input}`);
    let output: StudioCanonicalFilterLinearImage;
    if (node.kind === "gaussian-blur") {
      output = separableGaussian(
        input,
        node.sigma,
        node.radius,
        node.borderMode,
        tileSize,
      );
    } else if (node.kind === "unsharp-mask") {
      output = applyUnsharp(input, node, tileSize);
    } else if (node.kind === "morphology") {
      output = applyMorphology(input, node, tileSize);
    } else {
      output = applyPointNode(input, node);
    }
    images.set(node.id, output);
  }
  const output = images.get(parsed.value.outputNodeId);
  if (!output) throw new Error("Canonical filter output was not produced");
  return output;
}
