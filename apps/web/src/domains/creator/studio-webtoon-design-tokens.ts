import type { BrandKit } from "./studio-brand-kit";
import type { StudioNamedPalette } from "./studio-palette-library";
import type { SceneSeed } from "./studio-scene-templates";

/**
 * ToonSpectrum Webtoon Design Tokens
 *
 * A persistence- and UI-agnostic design-system core for reusable webtoon
 * styles. The model deliberately owns no browser globals, storage, React, or
 * Studio state. Callers can validate and resolve a document first, then project
 * the resolved values into the existing BrandKit and SceneSeed boundaries.
 */

export const STUDIO_WEBTOON_DESIGN_TOKEN_VERSION = 1 as const;
export const STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES =
  2 * 1_024 * 1_024;

export const STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS = Object.freeze({
  maxAxes: 12,
  maxModeValuesPerAxis: 32,
  /** @deprecated Product totals are governed by maxSerializedBytes, not a count ceiling. */
  maxTokens: Number.POSITIVE_INFINITY,
  /** @deprecated Product totals are governed by maxSerializedBytes, not a count ceiling. */
  maxOverridesPerToken: Number.POSITIVE_INFINITY,
  /** @deprecated Product totals are governed by maxSerializedBytes, not a count ceiling. */
  maxTotalOverrides: Number.POSITIVE_INFINITY,
  maxInheritanceDepth: 64,
  /** @deprecated Product totals are governed by maxSerializedBytes, not a count ceiling. */
  maxPaletteColors: Number.POSITIVE_INFINITY,
  /** @deprecated Product totals are governed by maxSerializedBytes, not a count ceiling. */
  maxPaletteRoles: Number.POSITIVE_INFINITY,
  maxSerializedBytes: STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES,
  maxDashSegments: 32,
  maxDiagnostics: 256,
  maxIdLength: 128,
  maxLabelLength: 160,
  maxStringLength: 512,
});

export const STUDIO_WEBTOON_DESIGN_TOKEN_CATEGORIES = [
  "palette",
  "typography",
  "spacing",
  "stroke",
  "bubble",
  "effect",
  "output",
] as const;

export type StudioWebtoonDesignTokenCategory =
  (typeof STUDIO_WEBTOON_DESIGN_TOKEN_CATEGORIES)[number];

export const STUDIO_WEBTOON_BUILTIN_MODE_AXES = Object.freeze([
  {
    id: "theme",
    label: "분위기",
    defaultValueId: "present",
    values: [
      { id: "present", label: "현재" },
      { id: "night", label: "밤" },
      { id: "memory", label: "회상" },
      { id: "dream", label: "꿈" },
    ],
  },
  {
    id: "language",
    label: "언어",
    defaultValueId: "ko",
    values: [
      { id: "ko", label: "한국어" },
      { id: "ja", label: "일본어" },
      { id: "en", label: "영어" },
    ],
  },
  {
    id: "platform",
    label: "출력 매체",
    defaultValueId: "mobile",
    values: [
      { id: "mobile", label: "모바일" },
      { id: "print", label: "인쇄" },
      { id: "preview", label: "미리보기" },
    ],
  },
] as const satisfies readonly StudioWebtoonDesignModeAxis[]);

export interface StudioWebtoonDesignModeValue {
  readonly id: string;
  readonly label: string;
}

export interface StudioWebtoonDesignModeAxis {
  readonly id: string;
  readonly label: string;
  readonly defaultValueId: string;
  readonly values: readonly StudioWebtoonDesignModeValue[];
}

export interface StudioWebtoonPaletteTokenValue {
  readonly colors: readonly string[];
  readonly roles: Readonly<Record<string, string>>;
}

export interface StudioWebtoonTypographyTokenValue {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly lineHeight: number;
  readonly fontWeight: number;
  readonly letterSpacingPx: number;
  readonly color: string;
}

export interface StudioWebtoonSpacingTokenValue {
  readonly panelGutterPx: number;
  readonly contentMarginPx: number;
  readonly safeAreaTopPx: number;
  readonly safeAreaRightPx: number;
  readonly safeAreaBottomPx: number;
  readonly safeAreaLeftPx: number;
}

export interface StudioWebtoonStrokeTokenValue {
  readonly color: string;
  readonly widthPx: number;
  readonly opacity: number;
  readonly dash: readonly number[];
  readonly lineCap: "butt" | "round" | "square";
  readonly lineJoin: "bevel" | "round" | "miter";
}

export interface StudioWebtoonBubbleTokenValue {
  readonly fill: string;
  readonly textColor: string;
  readonly borderColor: string;
  readonly borderWidthPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly tailLengthPx: number;
  readonly tailWidthPx: number;
  readonly cornerRadiusPx: number;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly lineHeight: number;
}

export interface StudioWebtoonEffectTokenValue {
  readonly effect:
    | "none"
    | "shadow"
    | "glow"
    | "focus-lines"
    | "speed-lines"
    | "tone";
  readonly color: string;
  readonly opacity: number;
  readonly intensity: number;
  readonly blurPx: number;
  readonly distancePx: number;
  readonly angleDeg: number;
  readonly density: number;
}

export interface StudioWebtoonOutputTokenValue {
  readonly format: "png" | "jpeg" | "webp" | "pdf";
  readonly quality: number;
  readonly maxWidthPx: number;
  readonly sliceHeightPx: number;
  readonly pixelRatio: number;
  readonly colorSpace: "srgb" | "display-p3" | "grayscale";
  readonly backgroundColor: string;
  readonly compression: "speed" | "balanced" | "size";
}

export interface StudioWebtoonDesignTokenValueMap {
  readonly palette: StudioWebtoonPaletteTokenValue;
  readonly typography: StudioWebtoonTypographyTokenValue;
  readonly spacing: StudioWebtoonSpacingTokenValue;
  readonly stroke: StudioWebtoonStrokeTokenValue;
  readonly bubble: StudioWebtoonBubbleTokenValue;
  readonly effect: StudioWebtoonEffectTokenValue;
  readonly output: StudioWebtoonOutputTokenValue;
}

export type StudioWebtoonDesignTokenPatch<
  Category extends StudioWebtoonDesignTokenCategory,
> = Partial<StudioWebtoonDesignTokenValueMap[Category]>;

export interface StudioWebtoonDesignModeOverride<
  Category extends StudioWebtoonDesignTokenCategory,
> {
  readonly id: string;
  readonly selector: Readonly<Record<string, string>>;
  readonly priority?: number;
  readonly value: StudioWebtoonDesignTokenPatch<Category>;
}

export interface StudioWebtoonDesignTokenDefinition<
  Category extends StudioWebtoonDesignTokenCategory,
> {
  readonly id: string;
  readonly label: string;
  readonly category: Category;
  readonly extendsTokenId?: string;
  readonly value: StudioWebtoonDesignTokenPatch<Category>;
  readonly overrides?: readonly StudioWebtoonDesignModeOverride<Category>[];
}

export type StudioWebtoonDesignToken = {
  [Category in StudioWebtoonDesignTokenCategory]:
    StudioWebtoonDesignTokenDefinition<Category>;
}[StudioWebtoonDesignTokenCategory];

export interface StudioWebtoonDesignTokenDocumentInput {
  readonly version?: typeof STUDIO_WEBTOON_DESIGN_TOKEN_VERSION;
  readonly axes: readonly StudioWebtoonDesignModeAxis[];
  readonly tokens: readonly StudioWebtoonDesignToken[];
}

export type StudioWebtoonDesignTokenDiagnosticCode =
  | "INVALID_VERSION"
  | "INVALID_AXIS_ID"
  | "DUPLICATE_AXIS_ID"
  | "INVALID_MODE_VALUE_ID"
  | "DUPLICATE_MODE_VALUE_ID"
  | "DANGLING_MODE_DEFAULT"
  | "INVALID_TOKEN_ID"
  | "DUPLICATE_TOKEN_ID"
  | "INVALID_TOKEN_VALUE"
  | "UNKNOWN_TOKEN_FIELD"
  | "DANGLING_TOKEN_REFERENCE"
  | "TOKEN_REFERENCE_KIND_MISMATCH"
  | "TOKEN_REFERENCE_CYCLE"
  | "TOKEN_CHAIN_TOO_DEEP"
  | "DUPLICATE_OVERRIDE_ID"
  | "UNKNOWN_MODE_AXIS"
  | "UNKNOWN_MODE_VALUE";

export interface StudioWebtoonDesignTokenDiagnostic {
  readonly code: StudioWebtoonDesignTokenDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly relatedIds: readonly string[];
}

export interface StudioWebtoonDesignTokenDocument {
  readonly version: typeof STUDIO_WEBTOON_DESIGN_TOKEN_VERSION;
  readonly axes: readonly StudioWebtoonDesignModeAxis[];
  readonly tokens: readonly StudioWebtoonDesignToken[];
  readonly diagnostics: readonly StudioWebtoonDesignTokenDiagnostic[];
  readonly diagnosticsTruncated: boolean;
  readonly usable: boolean;
}

export type StudioWebtoonDesignTokenErrorCode =
  | "LIMIT_EXCEEDED"
  | "INVALID_DOCUMENT"
  | "UNKNOWN_TOKEN"
  | "UNKNOWN_MODE_AXIS"
  | "UNKNOWN_MODE_VALUE"
  | "TOKEN_KIND_MISMATCH"
  | "INVALID_RUNTIME_OVERRIDE"
  | "INVALID_ADAPTER_BINDING";

export class StudioWebtoonDesignTokenError extends Error {
  readonly code: StudioWebtoonDesignTokenErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StudioWebtoonDesignTokenErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "StudioWebtoonDesignTokenError";
    this.code = code;
    this.details = details;
  }
}

const MAX_CANONICAL_JSON_NESTING_DEPTH = 64;

function invalidAdmission(reason: string): never {
  throw new StudioWebtoonDesignTokenError(
    "INVALID_DOCUMENT",
    "The webtoon design-token input is not safe to inspect.",
    { reason },
  );
}

function serializedBudgetExceeded(
  label: string,
  count = STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES + 1,
): never {
  throw new StudioWebtoonDesignTokenError(
    "LIMIT_EXCEEDED",
    `${label} exceeds the canonical UTF-8 design-token byte budget.`,
    {
      count,
      limit: STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES,
      label,
    },
  );
}

function addCanonicalBytes(
  current: number,
  additional: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(additional)
    || additional < 0
    || current > STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES - additional
  ) {
    serializedBudgetExceeded(label);
  }
  return current + additional;
}

/** JSON string-literal UTF-8 bytes without allocating a second, potentially huge string. */
function canonicalJsonStringByteLength(value: string, label: string): number {
  let bytes = 2; // opening and closing quotes
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    let nextBytes: number;
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      nextBytes = 2;
    } else if (codeUnit <= 0x1f) {
      nextBytes =
        codeUnit === 0x08
        || codeUnit === 0x09
        || codeUnit === 0x0a
        || codeUnit === 0x0c
        || codeUnit === 0x0d
          ? 2
          : 6;
    } else if (codeUnit <= 0x7f) {
      nextBytes = 1;
    } else if (codeUnit <= 0x7ff) {
      nextBytes = 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        nextBytes = 4;
        index += 1;
      } else {
        // Well-formed JSON escapes a lone surrogate as \udxxx.
        nextBytes = 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      nextBytes = 6;
    } else {
      nextBytes = 3;
    }
    bytes = addCanonicalBytes(bytes, nextBytes, label);
  }
  return bytes;
}

function ownDataDescriptor(
  value: object,
  key: PropertyKey,
  label: string,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    invalidAdmission(`${label} cannot be reflected safely.`);
  }
  if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
    invalidAdmission(`${label} must be an own data property.`);
  }
  return descriptor;
}

function assertCanonicalPrototype(value: object, array: boolean, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    invalidAdmission(`${label} prototype cannot be reflected safely.`);
  }
  if (
    prototype !== null
    && prototype !== Object.prototype
    && !(array && prototype === Array.prototype)
  ) {
    invalidAdmission(`${label} must use a plain JSON prototype.`);
  }
}

function canonicalJsonArrayLength(value: readonly unknown[], label: string): number {
  const descriptor = ownDataDescriptor(value, "length", `${label}.length`);
  const length = descriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    invalidAdmission(`${label} must have a safe array length.`);
  }
  if (length > 0) {
    const first = ownDataDescriptor(value, "0", `${label}[0]`);
    if (!first.enumerable) invalidAdmission(`${label} must be a dense JSON array.`);
  }
  // `0` plus a comma costs at least two bytes per array member. This is derived from the
  // canonical byte contract and rejects hostile sparse lengths before any proportional clone.
  const minimumBytes = length === 0 ? 2 : length * 2 + 1;
  if (
    !Number.isSafeInteger(minimumBytes)
    || minimumBytes > STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES
  ) {
    serializedBudgetExceeded(label, minimumBytes);
  }
  return length as number;
}

function ownEnumerableStringKeys(value: object, label: string): string[] {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalidAdmission(`${label} keys cannot be reflected safely.`);
  }
  if (keys.length > STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES) {
    serializedBudgetExceeded(label, keys.length);
  }
  const result: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string") {
      invalidAdmission(`${label} must not contain symbol keys.`);
    }
    const descriptor = ownDataDescriptor(value, key, `${label}.${key}`);
    if (!descriptor.enumerable) {
      invalidAdmission(`${label}.${key} must be an enumerable data property.`);
    }
    result.push(key);
  }
  return result.sort(compareText);
}

function canonicalInspectableJsonByteLength(
  value: unknown,
  label: string,
  active: Set<object> = new Set(),
  depth = 0,
  arrayEntry = false,
): number {
  if (value === undefined) return arrayEntry ? 4 : 0;
  if (value === null) return 4;
  if (typeof value === "string") {
    return canonicalJsonStringByteLength(value, label);
  }
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    const serialized = Number.isFinite(value) ? JSON.stringify(value) : "null";
    return serialized.length;
  }
  if (
    typeof value === "bigint"
    || typeof value === "function"
    || typeof value === "symbol"
  ) {
    invalidAdmission(`${label} contains a non-JSON value.`);
  }
  if (depth > MAX_CANONICAL_JSON_NESTING_DEPTH) {
    invalidAdmission(`${label} exceeds the safe JSON nesting depth.`);
  }

  const objectValue = value as object;
  if (active.has(objectValue)) {
    invalidAdmission(`${label} contains a cyclic reference.`);
  }
  active.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      assertCanonicalPrototype(objectValue, true, label);
      const length = canonicalJsonArrayLength(objectValue, label);
      // Validate the complete shape before visiting values, so a late sparse/accessor entry never
      // causes a partial snapshot allocation.
      for (let index = 0; index < length; index += 1) {
        const descriptor = ownDataDescriptor(
          objectValue,
          String(index),
          `${label}[${index}]`,
        );
        if (!descriptor.enumerable) {
          invalidAdmission(`${label} must be a dense JSON array.`);
        }
      }
      let bytes = 2;
      for (let index = 0; index < length; index += 1) {
        if (index > 0) bytes = addCanonicalBytes(bytes, 1, label);
        const descriptor = ownDataDescriptor(
          objectValue,
          String(index),
          `${label}[${index}]`,
        );
        bytes = addCanonicalBytes(
          bytes,
          canonicalInspectableJsonByteLength(
            descriptor.value,
            `${label}[${index}]`,
            active,
            depth + 1,
            true,
          ),
          label,
        );
      }
      return bytes;
    }

    assertCanonicalPrototype(objectValue, false, label);
    const keys = ownEnumerableStringKeys(objectValue, label);
    let bytes = 2;
    let included = 0;
    for (const key of keys) {
      const descriptor = ownDataDescriptor(objectValue, key, `${label}.${key}`);
      if (descriptor.value === undefined) continue;
      if (included > 0) bytes = addCanonicalBytes(bytes, 1, label);
      bytes = addCanonicalBytes(
        bytes,
        canonicalJsonStringByteLength(key, label),
        label,
      );
      bytes = addCanonicalBytes(bytes, 1, label); // colon
      bytes = addCanonicalBytes(
        bytes,
        canonicalInspectableJsonByteLength(
          descriptor.value,
          `${label}.${key}`,
          active,
          depth + 1,
        ),
        label,
      );
      included += 1;
    }
    return bytes;
  } finally {
    active.delete(objectValue);
  }
}

function snapshotInspectableJson(
  value: unknown,
  label: string,
  active: Set<object> = new Set(),
  depth = 0,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_CANONICAL_JSON_NESTING_DEPTH) {
    invalidAdmission(`${label} exceeds the safe JSON nesting depth.`);
  }
  if (active.has(value)) invalidAdmission(`${label} contains a cyclic reference.`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      assertCanonicalPrototype(value, true, label);
      const length = canonicalJsonArrayLength(value, label);
      for (let index = 0; index < length; index += 1) {
        const descriptor = ownDataDescriptor(value, String(index), `${label}[${index}]`);
        if (!descriptor.enumerable) invalidAdmission(`${label} must be a dense JSON array.`);
      }
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = ownDataDescriptor(value, String(index), `${label}[${index}]`);
        result.push(
          snapshotInspectableJson(
            descriptor.value,
            `${label}[${index}]`,
            active,
            depth + 1,
          ),
        );
      }
      return result;
    }

    assertCanonicalPrototype(value, false, label);
    const result: Record<string, unknown> = {};
    for (const key of ownEnumerableStringKeys(value, label)) {
      const descriptor = ownDataDescriptor(value, key, `${label}.${key}`);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: snapshotInspectableJson(
          descriptor.value,
          `${label}.${key}`,
          active,
          depth + 1,
        ),
        writable: true,
      });
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function snapshotDesignTokenInput(
  input: unknown,
): StudioWebtoonDesignTokenDocumentInput {
  canonicalInspectableJsonByteLength(input, "design-token input");
  const snapshot = snapshotInspectableJson(input, "design-token input");
  canonicalInspectableJsonByteLength(snapshot, "design-token input snapshot");
  if (!isRecord(snapshot)) {
    invalidAdmission("The design-token input root must be an object.");
  }
  return snapshot as unknown as StudioWebtoonDesignTokenDocumentInput;
}

function addCanonicalArrayEntry(
  currentBytes: number,
  itemCount: number,
  value: unknown,
  label: string,
): number {
  const separatorBytes = itemCount > 0 ? 1 : 0;
  const itemBytes = canonicalInspectableJsonByteLength(value, label);
  return addCanonicalBytes(
    addCanonicalBytes(currentBytes, separatorBytes, label),
    itemBytes,
    label,
  );
}

export interface ResolveStudioWebtoonDesignTokenOptions<
  Category extends StudioWebtoonDesignTokenCategory =
    StudioWebtoonDesignTokenCategory,
> {
  readonly modes?: Readonly<Record<string, string>>;
  readonly runtimeOverride?: StudioWebtoonDesignTokenPatch<Category>;
}

export interface StudioResolvedWebtoonDesignToken<
  Category extends StudioWebtoonDesignTokenCategory,
> {
  readonly id: string;
  readonly label: string;
  readonly category: Category;
  readonly value: StudioWebtoonDesignTokenValueMap[Category];
  readonly inheritanceChain: readonly string[];
  readonly appliedOverrideIds: readonly string[];
  readonly activeModes: Readonly<Record<string, string>>;
}

export type StudioResolvedWebtoonDesignTokenUnion = {
  [Category in StudioWebtoonDesignTokenCategory]:
    StudioResolvedWebtoonDesignToken<Category>;
}[StudioWebtoonDesignTokenCategory];

export interface StudioBrandKitDesignTokenBindings {
  readonly paletteTokenId?: string;
  readonly headingTypographyTokenId?: string;
  readonly bodyTypographyTokenId?: string;
}

export interface StudioBrandKitDesignTokenProjection {
  readonly kit: BrandKit;
  readonly palette: StudioNamedPalette | null;
  readonly resolvedTokenIds: readonly string[];
}

export interface StudioSceneDesignTokenBindings {
  readonly frameStrokeTokenId?: string;
  readonly bubbleTokenId?: string;
  readonly textTypographyTokenId?: string;
  readonly effectTokenId?: string;
}

const TOKEN_CATEGORY_SET = new Set<StudioWebtoonDesignTokenCategory>(
  STUDIO_WEBTOON_DESIGN_TOKEN_CATEGORIES,
);

const DEFAULT_VALUES: StudioWebtoonDesignTokenValueMap = Object.freeze({
  palette: Object.freeze({
    colors: Object.freeze([]),
    roles: Object.freeze({}),
  }),
  typography: Object.freeze({
    fontFamily: "Pretendard, sans-serif",
    fontSizePx: 16,
    lineHeight: 1.4,
    fontWeight: 400,
    letterSpacingPx: 0,
    color: "#111111",
  }),
  spacing: Object.freeze({
    panelGutterPx: 20,
    contentMarginPx: 24,
    safeAreaTopPx: 0,
    safeAreaRightPx: 0,
    safeAreaBottomPx: 0,
    safeAreaLeftPx: 0,
  }),
  stroke: Object.freeze({
    color: "#111111",
    widthPx: 2,
    opacity: 1,
    dash: Object.freeze([]),
    lineCap: "round",
    lineJoin: "round",
  }),
  bubble: Object.freeze({
    fill: "#ffffff",
    textColor: "#111111",
    borderColor: "#111111",
    borderWidthPx: 2,
    paddingXPx: 18,
    paddingYPx: 14,
    tailLengthPx: 24,
    tailWidthPx: 16,
    cornerRadiusPx: 22,
    fontFamily: "Pretendard, sans-serif",
    fontSizePx: 18,
    lineHeight: 1.4,
  }),
  effect: Object.freeze({
    effect: "none",
    color: "#111111",
    opacity: 1,
    intensity: 1,
    blurPx: 0,
    distancePx: 0,
    angleDeg: 0,
    density: 24,
  }),
  output: Object.freeze({
    format: "webp",
    quality: 0.92,
    maxWidthPx: 800,
    sliceHeightPx: 4_000,
    pixelRatio: 1,
    colorSpace: "srgb",
    backgroundColor: "#ffffff",
    compression: "balanced",
  }),
});

export const STUDIO_WEBTOON_DESIGN_TOKEN_DEFAULTS = DEFAULT_VALUES;

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function compareDiagnostics(
  left: StudioWebtoonDesignTokenDiagnostic,
  right: StudioWebtoonDesignTokenDiagnostic,
): number {
  return (
    compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.relatedIds.join("\u0000"), right.relatedIds.join("\u0000"))
  );
}

function compareOverrides(
  left: StudioWebtoonDesignModeOverride<StudioWebtoonDesignTokenCategory>,
  right: StudioWebtoonDesignModeOverride<StudioWebtoonDesignTokenCategory>,
): number {
  const leftSpecificity = Object.keys(left.selector).length;
  const rightSpecificity = Object.keys(right.selector).length;
  return (
    leftSpecificity - rightSpecificity
    || (left.priority ?? 0) - (right.priority ?? 0)
    || compareText(left.id, right.id)
  );
}

function assertCollectionLimit(
  count: number,
  limit: number,
  label: string,
): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
    throw new StudioWebtoonDesignTokenError(
      "LIMIT_EXCEEDED",
      `${label} exceeds the safe design-token limit.`,
      { count, limit, label },
    );
  }
}

function normalizeIdentifier(
  value: unknown,
  placeholder: string,
  code: "INVALID_AXIS_ID" | "INVALID_MODE_VALUE_ID" | "INVALID_TOKEN_ID",
  path: string,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): string {
  if (
    typeof value === "string"
    && value.trim().length > 0
    && value.trim().length
      <= STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxIdLength
    // eslint-disable-next-line no-control-regex -- persisted identifiers must reject ASCII control bytes
    && !/[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return value.trim();
  }
  addDiagnostic({
    code,
    path,
    message: "Design-token identifiers must be non-empty, bounded strings.",
    relatedIds: [],
  });
  return placeholder;
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (normalized.length === 0) return fallback;
  return normalized.slice(0, STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxLabelLength);
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && value.length <= STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxStringLength
    // eslint-disable-next-line no-control-regex -- token strings must reject non-whitespace ASCII control bytes
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function addInvalidValue(
  path: string,
  field: string,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): void {
  addDiagnostic({
    code: "INVALID_TOKEN_VALUE",
    path: `${path}.${field}`,
    message: `Invalid ${field} value for this design-token category.`,
    relatedIds: [],
  });
}

function normalizeColor(
  value: unknown,
  path: string,
  field: string,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): string | undefined {
  if (isBoundedString(value)) return value.trim();
  addInvalidValue(path, field, addDiagnostic);
  return undefined;
}

function normalizeNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  field: string,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): number | undefined {
  if (isFiniteRange(value, minimum, maximum)) return value;
  addInvalidValue(path, field, addDiagnostic);
  return undefined;
}

const ALLOWED_FIELDS: Readonly<
  Record<StudioWebtoonDesignTokenCategory, ReadonlySet<string>>
> = Object.freeze({
  palette: new Set(["colors", "roles"]),
  typography: new Set([
    "fontFamily",
    "fontSizePx",
    "lineHeight",
    "fontWeight",
    "letterSpacingPx",
    "color",
  ]),
  spacing: new Set([
    "panelGutterPx",
    "contentMarginPx",
    "safeAreaTopPx",
    "safeAreaRightPx",
    "safeAreaBottomPx",
    "safeAreaLeftPx",
  ]),
  stroke: new Set([
    "color",
    "widthPx",
    "opacity",
    "dash",
    "lineCap",
    "lineJoin",
  ]),
  bubble: new Set([
    "fill",
    "textColor",
    "borderColor",
    "borderWidthPx",
    "paddingXPx",
    "paddingYPx",
    "tailLengthPx",
    "tailWidthPx",
    "cornerRadiusPx",
    "fontFamily",
    "fontSizePx",
    "lineHeight",
  ]),
  effect: new Set([
    "effect",
    "color",
    "opacity",
    "intensity",
    "blurPx",
    "distancePx",
    "angleDeg",
    "density",
  ]),
  output: new Set([
    "format",
    "quality",
    "maxWidthPx",
    "sliceHeightPx",
    "pixelRatio",
    "colorSpace",
    "backgroundColor",
    "compression",
  ]),
});

function normalizePatch(
  category: StudioWebtoonDesignTokenCategory,
  rawValue: unknown,
  path: string,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): StudioWebtoonDesignTokenPatch<StudioWebtoonDesignTokenCategory> {
  if (!isRecord(rawValue)) {
    addInvalidValue(path, "value", addDiagnostic);
    return {};
  }

  for (const field of Object.keys(rawValue).sort(compareText)) {
    if (!ALLOWED_FIELDS[category].has(field)) {
      addDiagnostic({
        code: "UNKNOWN_TOKEN_FIELD",
        path: `${path}.${field}`,
        message: `Unknown ${category} token field.`,
        relatedIds: [field],
      });
    }
  }

  const result: MutableRecord = {};
  const copyColor = (field: string) => {
    if (!(field in rawValue)) return;
    const value = normalizeColor(
      rawValue[field],
      path,
      field,
      addDiagnostic,
    );
    if (value !== undefined) result[field] = value;
  };
  const copyNumber = (
    field: string,
    minimum: number,
    maximum: number,
  ) => {
    if (!(field in rawValue)) return;
    const value = normalizeNumber(
      rawValue[field],
      minimum,
      maximum,
      path,
      field,
      addDiagnostic,
    );
    if (value !== undefined) result[field] = value;
  };
  const copyEnum = (field: string, values: ReadonlySet<string>) => {
    if (!(field in rawValue)) return;
    const value = rawValue[field];
    if (typeof value === "string" && values.has(value)) {
      result[field] = value;
      return;
    }
    addInvalidValue(path, field, addDiagnostic);
  };

  switch (category) {
    case "palette": {
      if ("colors" in rawValue) {
        const colors = rawValue.colors;
        if (
          Array.isArray(colors)
          && colors.every(isBoundedString)
        ) {
          result.colors = Object.freeze(colors.map((color) => color.trim()));
        } else {
          addInvalidValue(path, "colors", addDiagnostic);
        }
      }
      if ("roles" in rawValue) {
        const roles = rawValue.roles;
        if (
          isRecord(roles)
          && Object.keys(roles).every(isBoundedString)
          && Object.values(roles).every(isBoundedString)
        ) {
          result.roles = Object.freeze(
            Object.fromEntries(
              Object.entries(roles)
                .sort(([left], [right]) => compareText(left, right))
                .map(([key, value]) => [key.trim(), (value as string).trim()]),
            ),
          );
        } else {
          addInvalidValue(path, "roles", addDiagnostic);
        }
      }
      break;
    }
    case "typography":
      if ("fontFamily" in rawValue) {
        if (isBoundedString(rawValue.fontFamily)) {
          result.fontFamily = rawValue.fontFamily.trim();
        } else {
          addInvalidValue(path, "fontFamily", addDiagnostic);
        }
      }
      copyNumber("fontSizePx", 1, 512);
      copyNumber("lineHeight", 0.5, 5);
      copyNumber("fontWeight", 1, 1_000);
      copyNumber("letterSpacingPx", -100, 100);
      copyColor("color");
      break;
    case "spacing":
      copyNumber("panelGutterPx", 0, 100_000);
      copyNumber("contentMarginPx", 0, 100_000);
      copyNumber("safeAreaTopPx", 0, 100_000);
      copyNumber("safeAreaRightPx", 0, 100_000);
      copyNumber("safeAreaBottomPx", 0, 100_000);
      copyNumber("safeAreaLeftPx", 0, 100_000);
      break;
    case "stroke":
      copyColor("color");
      copyNumber("widthPx", 0, 10_000);
      copyNumber("opacity", 0, 1);
      if ("dash" in rawValue) {
        const dash = rawValue.dash;
        if (
          Array.isArray(dash)
          && dash.length <= STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxDashSegments
          && dash.every((value) => isFiniteRange(value, 0, 100_000))
        ) {
          result.dash = Object.freeze([...dash]);
        } else {
          addInvalidValue(path, "dash", addDiagnostic);
        }
      }
      copyEnum("lineCap", new Set(["butt", "round", "square"]));
      copyEnum("lineJoin", new Set(["bevel", "round", "miter"]));
      break;
    case "bubble":
      copyColor("fill");
      copyColor("textColor");
      copyColor("borderColor");
      copyNumber("borderWidthPx", 0, 1_000);
      copyNumber("paddingXPx", 0, 10_000);
      copyNumber("paddingYPx", 0, 10_000);
      copyNumber("tailLengthPx", 0, 10_000);
      copyNumber("tailWidthPx", 0, 10_000);
      copyNumber("cornerRadiusPx", 0, 10_000);
      if ("fontFamily" in rawValue) {
        if (isBoundedString(rawValue.fontFamily)) {
          result.fontFamily = rawValue.fontFamily.trim();
        } else {
          addInvalidValue(path, "fontFamily", addDiagnostic);
        }
      }
      copyNumber("fontSizePx", 1, 512);
      copyNumber("lineHeight", 0.5, 5);
      break;
    case "effect":
      copyEnum(
        "effect",
        new Set([
          "none",
          "shadow",
          "glow",
          "focus-lines",
          "speed-lines",
          "tone",
        ]),
      );
      copyColor("color");
      copyNumber("opacity", 0, 1);
      copyNumber("intensity", 0, 1_000);
      copyNumber("blurPx", 0, 10_000);
      copyNumber("distancePx", 0, 100_000);
      copyNumber("angleDeg", -360_000, 360_000);
      copyNumber("density", 1, 2_048);
      break;
    case "output":
      copyEnum("format", new Set(["png", "jpeg", "webp", "pdf"]));
      copyNumber("quality", 0, 1);
      copyNumber("maxWidthPx", 1, 200_000);
      copyNumber("sliceHeightPx", 1, 200_000);
      copyNumber("pixelRatio", 0.1, 16);
      copyEnum("colorSpace", new Set(["srgb", "display-p3", "grayscale"]));
      copyColor("backgroundColor");
      copyEnum("compression", new Set(["speed", "balanced", "size"]));
      break;
  }

  return Object.freeze(result) as StudioWebtoonDesignTokenPatch<StudioWebtoonDesignTokenCategory>;
}

function normalizeSelector(
  rawSelector: unknown,
  path: string,
  axisById: ReadonlyMap<string, StudioWebtoonDesignModeAxis>,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): Readonly<Record<string, string>> {
  if (!isRecord(rawSelector)) {
    addDiagnostic({
      code: "UNKNOWN_MODE_AXIS",
      path,
      message: "A mode selector must be a bounded axis-to-value object.",
      relatedIds: [],
    });
    return Object.freeze({});
  }
  const selector: Record<string, string> = {};
  for (const [rawAxisId, rawValueId] of Object.entries(rawSelector).sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const axis = axisById.get(rawAxisId);
    if (!axis) {
      addDiagnostic({
        code: "UNKNOWN_MODE_AXIS",
        path: `${path}.${rawAxisId}`,
        message: "The override references an unknown mode axis.",
        relatedIds: [rawAxisId],
      });
      continue;
    }
    if (
      typeof rawValueId !== "string"
      || !axis.values.some(({ id }) => id === rawValueId)
    ) {
      addDiagnostic({
        code: "UNKNOWN_MODE_VALUE",
        path: `${path}.${rawAxisId}`,
        message: "The override references an unknown mode value.",
        relatedIds: [axis.id, String(rawValueId)],
      });
      continue;
    }
    selector[axis.id] = rawValueId;
  }
  return Object.freeze(selector);
}

function detectReferenceCycles(
  tokens: readonly StudioWebtoonDesignToken[],
  parentByTokenId: ReadonlyMap<string, string>,
  addDiagnostic: (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => void,
): void {
  const reportedCycles = new Set<string>();
  for (const startId of tokens.map(({ id }) => id).sort(compareText)) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let currentId: string | undefined = startId;
    while (currentId) {
      const cycleStart = pathIndex.get(currentId);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart).sort(compareText);
        const signature = cycle.join("\u0000");
        if (!reportedCycles.has(signature)) {
          reportedCycles.add(signature);
          addDiagnostic({
            code: "TOKEN_REFERENCE_CYCLE",
            path: `tokens.${startId}.extendsTokenId`,
            message: "Design-token inheritance contains a cycle.",
            relatedIds: cycle,
          });
        }
        break;
      }
      pathIndex.set(currentId, path.length);
      path.push(currentId);
      if (
        path.length
        > STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxInheritanceDepth
      ) {
        addDiagnostic({
          code: "TOKEN_CHAIN_TOO_DEEP",
          path: `tokens.${startId}.extendsTokenId`,
          message: "Design-token inheritance exceeds the safe depth.",
          relatedIds: [startId, currentId],
        });
        break;
      }
      currentId = parentByTokenId.get(currentId);
    }
  }
}

export function createStudioWebtoonDesignTokenDocument(
  input: StudioWebtoonDesignTokenDocumentInput,
): StudioWebtoonDesignTokenDocument {
  const admittedInput = snapshotDesignTokenInput(input);
  const rawAxes = Array.isArray(admittedInput.axes) ? admittedInput.axes : [];
  const rawTokens = Array.isArray(admittedInput.tokens) ? admittedInput.tokens : [];
  assertCollectionLimit(
    rawAxes.length,
    STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxAxes,
    "mode axes",
  );

  let diagnosticsTruncated = false;
  const diagnostics: StudioWebtoonDesignTokenDiagnostic[] = [];
  const addDiagnostic = (
    diagnostic: StudioWebtoonDesignTokenDiagnostic,
  ) => {
    if (
      diagnostics.length
      >= STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxDiagnostics
    ) {
      diagnosticsTruncated = true;
      return;
    }
    diagnostics.push({
      ...diagnostic,
      relatedIds: Object.freeze([...diagnostic.relatedIds].sort(compareText)),
    });
  };

  if (
    admittedInput.version !== undefined
    && admittedInput.version !== STUDIO_WEBTOON_DESIGN_TOKEN_VERSION
  ) {
    addDiagnostic({
      code: "INVALID_VERSION",
      path: "version",
      message: "Unsupported webtoon design-token document version.",
      relatedIds: [String(admittedInput.version)],
    });
  }

  const axes: StudioWebtoonDesignModeAxis[] = [];
  const axisById = new Map<string, StudioWebtoonDesignModeAxis>();
  let axesCanonicalBytes = 2;
  rawAxes.forEach((rawAxis, axisIndex) => {
    const rawAxisRecord = isRecord(rawAxis) ? rawAxis : {};
    const id = normalizeIdentifier(
      rawAxisRecord.id,
      `__invalid_axis_${axisIndex}`,
      "INVALID_AXIS_ID",
      `axes.${axisIndex}.id`,
      addDiagnostic,
    );
    if (axisById.has(id)) {
      addDiagnostic({
        code: "DUPLICATE_AXIS_ID",
        path: `axes.${axisIndex}.id`,
        message: "Mode axis identifiers must be unique.",
        relatedIds: [id],
      });
      return;
    }
    const rawValues = Array.isArray(rawAxisRecord.values)
      ? rawAxisRecord.values
      : [];
    assertCollectionLimit(
      rawValues.length,
      STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxModeValuesPerAxis,
      `mode values for ${id}`,
    );
    const values: StudioWebtoonDesignModeValue[] = [];
    const valueIds = new Set<string>();
    rawValues.forEach((rawValue, valueIndex) => {
      const rawValueRecord = isRecord(rawValue) ? rawValue : {};
      const valueId = normalizeIdentifier(
        rawValueRecord.id,
        `__invalid_mode_${axisIndex}_${valueIndex}`,
        "INVALID_MODE_VALUE_ID",
        `axes.${axisIndex}.values.${valueIndex}.id`,
        addDiagnostic,
      );
      if (valueIds.has(valueId)) {
        addDiagnostic({
          code: "DUPLICATE_MODE_VALUE_ID",
          path: `axes.${axisIndex}.values.${valueIndex}.id`,
          message: "Mode values must be unique within an axis.",
          relatedIds: [id, valueId],
        });
        return;
      }
      valueIds.add(valueId);
      values.push(
        Object.freeze({
          id: valueId,
          label: normalizeLabel(rawValueRecord.label, valueId),
        }),
      );
    });
    values.sort((left, right) => compareText(left.id, right.id));
    const defaultValueId = typeof rawAxisRecord.defaultValueId === "string"
      ? rawAxisRecord.defaultValueId.trim()
      : "";
    if (!valueIds.has(defaultValueId)) {
      addDiagnostic({
        code: "DANGLING_MODE_DEFAULT",
        path: `axes.${axisIndex}.defaultValueId`,
        message: "The default mode value must exist in the same axis.",
        relatedIds: [id, defaultValueId],
      });
    }
    const axis = Object.freeze({
      id,
      label: normalizeLabel(rawAxisRecord.label, id),
      defaultValueId,
      values: Object.freeze(values),
    });
    axesCanonicalBytes = addCanonicalArrayEntry(
      axesCanonicalBytes,
      axes.length,
      axis,
      "canonical mode axes",
    );
    axes.push(axis);
    axisById.set(id, axis);
  });
  axes.sort((left, right) => compareText(left.id, right.id));

  const tokens: StudioWebtoonDesignToken[] = [];
  const tokenById = new Map<string, StudioWebtoonDesignToken>();
  let tokensCanonicalBytes = 2;
  rawTokens.forEach((rawToken, tokenIndex) => {
    const rawTokenRecord = isRecord(rawToken) ? rawToken : {};
    const id = normalizeIdentifier(
      rawTokenRecord.id,
      `__invalid_token_${tokenIndex}`,
      "INVALID_TOKEN_ID",
      `tokens.${tokenIndex}.id`,
      addDiagnostic,
    );
    if (tokenById.has(id)) {
      addDiagnostic({
        code: "DUPLICATE_TOKEN_ID",
        path: `tokens.${tokenIndex}.id`,
        message: "Design-token identifiers must be unique.",
        relatedIds: [id],
      });
      return;
    }
    const category = rawTokenRecord.category;
    if (
      typeof category !== "string"
      || !TOKEN_CATEGORY_SET.has(category as StudioWebtoonDesignTokenCategory)
    ) {
      addDiagnostic({
        code: "INVALID_TOKEN_VALUE",
        path: `tokens.${tokenIndex}.category`,
        message: "Unknown design-token category.",
        relatedIds: [String(category)],
      });
      return;
    }
    const typedCategory = category as StudioWebtoonDesignTokenCategory;
    const rawOverrides = Array.isArray(rawTokenRecord.overrides)
      ? rawTokenRecord.overrides
      : [];
    const overrides: StudioWebtoonDesignModeOverride<StudioWebtoonDesignTokenCategory>[] = [];
    const overrideIds = new Set<string>();
    let overridesCanonicalBytes = 2;
    rawOverrides.forEach((rawOverride, overrideIndex) => {
      const rawOverrideRecord = isRecord(rawOverride) ? rawOverride : {};
      const overrideId = normalizeIdentifier(
        rawOverrideRecord.id,
        `__invalid_override_${tokenIndex}_${overrideIndex}`,
        "INVALID_TOKEN_ID",
        `tokens.${tokenIndex}.overrides.${overrideIndex}.id`,
        addDiagnostic,
      );
      if (overrideIds.has(overrideId)) {
        addDiagnostic({
          code: "DUPLICATE_OVERRIDE_ID",
          path: `tokens.${tokenIndex}.overrides.${overrideIndex}.id`,
          message: "Override identifiers must be unique within a token.",
          relatedIds: [id, overrideId],
        });
        return;
      }
      overrideIds.add(overrideId);
      const priority = rawOverrideRecord.priority;
      const normalizedPriority = priority === undefined
        ? 0
        : isFiniteRange(priority, -10_000, 10_000)
          ? priority
          : 0;
      if (priority !== undefined && normalizedPriority !== priority) {
        addInvalidValue(
          `tokens.${tokenIndex}.overrides.${overrideIndex}`,
          "priority",
          addDiagnostic,
        );
      }
      const override = Object.freeze({
        id: overrideId,
        selector: normalizeSelector(
          rawOverrideRecord.selector,
          `tokens.${tokenIndex}.overrides.${overrideIndex}.selector`,
          axisById,
          addDiagnostic,
        ),
        priority: normalizedPriority,
        value: normalizePatch(
          typedCategory,
          rawOverrideRecord.value,
          `tokens.${tokenIndex}.overrides.${overrideIndex}.value`,
          addDiagnostic,
        ),
      });
      overridesCanonicalBytes = addCanonicalArrayEntry(
        overridesCanonicalBytes,
        overrides.length,
        override,
        `canonical mode overrides for ${id}`,
      );
      overrides.push(override);
    });
    overrides.sort(compareOverrides);
    const extendsTokenId =
      typeof rawTokenRecord.extendsTokenId === "string"
      && rawTokenRecord.extendsTokenId.trim().length > 0
        ? rawTokenRecord.extendsTokenId.trim()
        : undefined;
    const token = Object.freeze({
      id,
      label: normalizeLabel(rawTokenRecord.label, id),
      category: typedCategory,
      ...(extendsTokenId ? { extendsTokenId } : {}),
      value: normalizePatch(
        typedCategory,
        rawTokenRecord.value,
        `tokens.${tokenIndex}.value`,
        addDiagnostic,
      ),
      ...(overrides.length > 0
        ? { overrides: Object.freeze(overrides) }
        : {}),
    }) as StudioWebtoonDesignToken;
    tokensCanonicalBytes = addCanonicalArrayEntry(
      tokensCanonicalBytes,
      tokens.length,
      token,
      "canonical design tokens",
    );
    tokens.push(token);
    tokenById.set(id, token);
  });
  tokens.sort((left, right) => compareText(left.id, right.id));

  const parentByTokenId = new Map<string, string>();
  for (const token of tokens) {
    if (!token.extendsTokenId) continue;
    const parent = tokenById.get(token.extendsTokenId);
    if (!parent) {
      addDiagnostic({
        code: "DANGLING_TOKEN_REFERENCE",
        path: `tokens.${token.id}.extendsTokenId`,
        message: "The inherited design token does not exist.",
        relatedIds: [token.id, token.extendsTokenId],
      });
      continue;
    }
    if (parent.category !== token.category) {
      addDiagnostic({
        code: "TOKEN_REFERENCE_KIND_MISMATCH",
        path: `tokens.${token.id}.extendsTokenId`,
        message: "A design token can only inherit from the same category.",
        relatedIds: [token.id, parent.id],
      });
      continue;
    }
    parentByTokenId.set(token.id, parent.id);
  }
  detectReferenceCycles(tokens, parentByTokenId, addDiagnostic);

  diagnostics.sort(compareDiagnostics);
  const frozenDiagnostics = Object.freeze(diagnostics);
  const document = Object.freeze({
    version: STUDIO_WEBTOON_DESIGN_TOKEN_VERSION,
    axes: Object.freeze(axes),
    tokens: Object.freeze(tokens),
    diagnostics: frozenDiagnostics,
    diagnosticsTruncated,
    usable: frozenDiagnostics.length === 0 && !diagnosticsTruncated,
  });
  canonicalInspectableJsonByteLength(
    {
      axes: document.axes,
      tokens: document.tokens,
      version: document.version,
    },
    "canonical design-token document",
  );
  return document;
}

function assertUsableDocument(
  document: StudioWebtoonDesignTokenDocument,
): void {
  if (!document.usable || document.diagnostics.length > 0) {
    throw new StudioWebtoonDesignTokenError(
      "INVALID_DOCUMENT",
      "The webtoon design-token document is not safe to resolve.",
      {
        diagnosticCodes: document.diagnostics.map(({ code }) => code),
        diagnosticsTruncated: document.diagnosticsTruncated,
      },
    );
  }
}

function resolveActiveModes(
  document: StudioWebtoonDesignTokenDocument,
  selectedModes: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const modes: Record<string, string> = {};
  const axisById = new Map(document.axes.map((axis) => [axis.id, axis]));
  for (const axis of document.axes) modes[axis.id] = axis.defaultValueId;
  for (const [axisId, valueId] of Object.entries(selectedModes ?? {}).sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const axis = axisById.get(axisId);
    if (!axis) {
      throw new StudioWebtoonDesignTokenError(
        "UNKNOWN_MODE_AXIS",
        "The requested mode axis does not exist.",
        { axisId },
      );
    }
    if (!axis.values.some(({ id }) => id === valueId)) {
      throw new StudioWebtoonDesignTokenError(
        "UNKNOWN_MODE_VALUE",
        "The requested mode value does not exist.",
        { axisId, valueId },
      );
    }
    modes[axisId] = valueId;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(modes).sort(([left], [right]) => compareText(left, right)),
    ),
  );
}

function selectorMatches(
  selector: Readonly<Record<string, string>>,
  activeModes: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(selector).every(
    ([axisId, valueId]) => activeModes[axisId] === valueId,
  );
}

function cloneResolvedValue<
  Category extends StudioWebtoonDesignTokenCategory,
>(
  category: Category,
  value: StudioWebtoonDesignTokenValueMap[Category],
): StudioWebtoonDesignTokenValueMap[Category] {
  const record = { ...value } as MutableRecord;
  if (category === "palette") {
    const palette = value as StudioWebtoonPaletteTokenValue;
    record.colors = Object.freeze([...palette.colors]);
    record.roles = Object.freeze({ ...palette.roles });
  }
  if (category === "stroke") {
    record.dash = Object.freeze([
      ...(value as StudioWebtoonStrokeTokenValue).dash,
    ]);
  }
  return Object.freeze(record) as unknown as StudioWebtoonDesignTokenValueMap[Category];
}

function applyPatch<
  Category extends StudioWebtoonDesignTokenCategory,
>(
  category: Category,
  current: StudioWebtoonDesignTokenValueMap[Category],
  patch: StudioWebtoonDesignTokenPatch<Category>,
): StudioWebtoonDesignTokenValueMap[Category] {
  return cloneResolvedValue(category, {
    ...current,
    ...patch,
  } as StudioWebtoonDesignTokenValueMap[Category]);
}

function validateRuntimeOverride<
  Category extends StudioWebtoonDesignTokenCategory,
>(
  category: Category,
  override: StudioWebtoonDesignTokenPatch<Category> | undefined,
): StudioWebtoonDesignTokenPatch<Category> | undefined {
  if (override === undefined) return undefined;
  const diagnostics: StudioWebtoonDesignTokenDiagnostic[] = [];
  const normalized = normalizePatch(
    category,
    override,
    "runtimeOverride",
    (diagnostic) => diagnostics.push(diagnostic),
  ) as StudioWebtoonDesignTokenPatch<Category>;
  if (diagnostics.length > 0) {
    throw new StudioWebtoonDesignTokenError(
      "INVALID_RUNTIME_OVERRIDE",
      "The runtime design-token override is invalid.",
      { diagnosticCodes: diagnostics.map(({ code }) => code) },
    );
  }
  return normalized;
}

export function resolveStudioWebtoonDesignToken<
  Category extends StudioWebtoonDesignTokenCategory =
    StudioWebtoonDesignTokenCategory,
>(
  document: StudioWebtoonDesignTokenDocument,
  tokenId: string,
  options: ResolveStudioWebtoonDesignTokenOptions<Category> = {},
): StudioResolvedWebtoonDesignToken<Category> {
  assertUsableDocument(document);
  const tokenById = new Map(document.tokens.map((token) => [token.id, token]));
  const requestedToken = tokenById.get(tokenId);
  if (!requestedToken) {
    throw new StudioWebtoonDesignTokenError(
      "UNKNOWN_TOKEN",
      "The requested design token does not exist.",
      { tokenId },
    );
  }
  const activeModes = resolveActiveModes(document, options.modes);
  const chain: StudioWebtoonDesignToken[] = [];
  let cursor: StudioWebtoonDesignToken | undefined = requestedToken;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.extendsTokenId
      ? tokenById.get(cursor.extendsTokenId)
      : undefined;
  }
  chain.reverse();

  const category = requestedToken.category as Category;
  let value = cloneResolvedValue(
    category,
    DEFAULT_VALUES[category],
  );
  const appliedOverrideIds: string[] = [];
  for (const token of chain) {
    value = applyPatch(
      category,
      value,
      token.value as StudioWebtoonDesignTokenPatch<Category>,
    );
    const matchingOverrides = [...(token.overrides ?? [])]
      .filter(({ selector }) => selectorMatches(selector, activeModes))
      .sort(compareOverrides);
    for (const override of matchingOverrides) {
      value = applyPatch(
        category,
        value,
        override.value as StudioWebtoonDesignTokenPatch<Category>,
      );
      appliedOverrideIds.push(`${token.id}:${override.id}`);
    }
  }
  const runtimeOverride = validateRuntimeOverride(
    category,
    options.runtimeOverride,
  );
  if (runtimeOverride) value = applyPatch(category, value, runtimeOverride);

  return Object.freeze({
    id: requestedToken.id,
    label: requestedToken.label,
    category,
    value,
    inheritanceChain: Object.freeze(chain.map(({ id }) => id)),
    appliedOverrideIds: Object.freeze(appliedOverrideIds),
    activeModes,
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new StudioWebtoonDesignTokenError(
    "INVALID_DOCUMENT",
    "The design-token snapshot contains a non-serializable value.",
  );
}

export function serializeStudioWebtoonDesignTokenDocument(
  document: StudioWebtoonDesignTokenDocument,
): string {
  assertUsableDocument(document);
  return canonicalJson({
    axes: document.axes,
    tokens: document.tokens,
    version: document.version,
  });
}

export function hashStudioWebtoonDesignTokenDocument(
  document: StudioWebtoonDesignTokenDocument,
): string {
  const snapshot = serializeStudioWebtoonDesignTokenDocument(document);
  let hash = 0x811c9dc5;
  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `wtdt1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function requireResolvedCategory<
  Category extends StudioWebtoonDesignTokenCategory,
>(
  document: StudioWebtoonDesignTokenDocument,
  tokenId: string,
  category: Category,
  modes: Readonly<Record<string, string>> | undefined,
): StudioResolvedWebtoonDesignToken<Category> {
  const resolved = resolveStudioWebtoonDesignToken(document, tokenId, {
    modes,
  });
  if (resolved.category !== category) {
    throw new StudioWebtoonDesignTokenError(
      "TOKEN_KIND_MISMATCH",
      "A design-token adapter binding uses an incompatible token category.",
      { tokenId, expectedCategory: category, actualCategory: resolved.category },
    );
  }
  return resolved as StudioResolvedWebtoonDesignToken<Category>;
}

export function projectStudioWebtoonDesignTokensToBrandKit(
  document: StudioWebtoonDesignTokenDocument,
  sourceKit: BrandKit,
  bindings: StudioBrandKitDesignTokenBindings,
  modes?: Readonly<Record<string, string>>,
): StudioBrandKitDesignTokenProjection {
  const resolvedTokenIds: string[] = [];
  let headingFont = sourceKit.headingFont;
  let bodyFont = sourceKit.bodyFont;
  let paletteId = sourceKit.paletteId;
  let palette: StudioNamedPalette | null = null;

  if (bindings.headingTypographyTokenId) {
    const resolved = requireResolvedCategory(
      document,
      bindings.headingTypographyTokenId,
      "typography",
      modes,
    );
    headingFont = resolved.value.fontFamily;
    resolvedTokenIds.push(resolved.id);
  }
  if (bindings.bodyTypographyTokenId) {
    const resolved = requireResolvedCategory(
      document,
      bindings.bodyTypographyTokenId,
      "typography",
      modes,
    );
    bodyFont = resolved.value.fontFamily;
    resolvedTokenIds.push(resolved.id);
  }
  if (bindings.paletteTokenId) {
    const resolved = requireResolvedCategory(
      document,
      bindings.paletteTokenId,
      "palette",
      modes,
    );
    paletteId = sourceKit.paletteId ?? `design-token:${sourceKit.id}:palette`;
    palette = {
      id: paletteId,
      name: `${sourceKit.name} 팔레트`,
      createdAt: sourceKit.createdAt,
      updatedAt: sourceKit.updatedAt,
      colors: [...resolved.value.colors],
    };
    resolvedTokenIds.push(resolved.id);
  }

  return Object.freeze({
    kit: {
      ...sourceKit,
      paletteId,
      headingFont,
      bodyFont,
    },
    palette,
    resolvedTokenIds: Object.freeze([...new Set(resolvedTokenIds)].sort(compareText)),
  });
}

export function projectStudioWebtoonDesignTokensToSceneSeeds(
  document: StudioWebtoonDesignTokenDocument,
  sourceSeeds: readonly SceneSeed[],
  bindings: StudioSceneDesignTokenBindings,
  modes?: Readonly<Record<string, string>>,
): SceneSeed[] {
  const frameStroke = bindings.frameStrokeTokenId
    ? requireResolvedCategory(
        document,
        bindings.frameStrokeTokenId,
        "stroke",
        modes,
      ).value
    : null;
  const bubble = bindings.bubbleTokenId
    ? requireResolvedCategory(
        document,
        bindings.bubbleTokenId,
        "bubble",
        modes,
      ).value
    : null;
  const typography = bindings.textTypographyTokenId
    ? requireResolvedCategory(
        document,
        bindings.textTypographyTokenId,
        "typography",
        modes,
      ).value
    : null;
  const effect = bindings.effectTokenId
    ? requireResolvedCategory(
        document,
        bindings.effectTokenId,
        "effect",
        modes,
      ).value
    : null;

  return sourceSeeds.map((seed): SceneSeed => {
    switch (seed.type) {
      case "frame":
        if (!frameStroke) return { ...seed };
        return {
          ...seed,
          stroke: frameStroke.color,
          strokeWidth: frameStroke.widthPx,
          dashStyle: frameStroke.dash.length > 0 ? "dashed" : "solid",
        };
      case "bubble":
        if (!bubble) return { ...seed };
        return {
          ...seed,
          fill: bubble.fill,
          textFill: bubble.textColor,
          font: bubble.fontFamily,
          fontSize: bubble.fontSizePx,
        };
      case "text": {
        const next = { ...seed };
        if (typography) {
          next.font = typography.fontFamily;
          next.fontSize = typography.fontSizePx;
          next.fill = typography.color;
          next.fontStyle = typography.fontWeight >= 600 ? "bold" : "normal";
        }
        if (frameStroke) {
          next.stroke = frameStroke.color;
          next.strokeWidth = frameStroke.widthPx;
        }
        return next;
      }
      case "focusLines":
      case "speedLines":
        if (!effect) return { ...seed };
        return {
          ...seed,
          stroke: effect.color,
          strokeWidth: Math.max(0.1, effect.intensity),
          lineCount: Math.max(1, Math.round(effect.density)),
          rotation: effect.angleDeg,
        };
    }
  });
}
