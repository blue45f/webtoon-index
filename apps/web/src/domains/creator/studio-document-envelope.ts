/**
 * Canonical, engine-neutral envelope for durable Studio documents.
 *
 * This module deliberately does not know any concrete Studio payload schema. A format registry
 * identifies a payload by `(format.id, payload.type)`, validates the envelope graph, and advances
 * historical format versions through a contiguous, bounded migrator chain. Existing project,
 * BG3D, VRM, and interchange modules can adopt this boundary independently.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_DOCUMENT_ENVELOPE_LIMITS = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 600_000,
  maxObjectKeys: 50_000,
  maxArrayItems: 200_000,
  maxStringBytes: 16 * 1024 * 1024,
  maxKeyBytes: 1_024,
  maxExtensions: 512,
});

export const STUDIO_DOCUMENT_MIGRATION_BUDGET = Object.freeze({
  maxSteps: 64,
  maxCumulativeBytes: 256 * 1024 * 1024,
});

export const STUDIO_DOCUMENT_MIGRATION_RECEIPT_VERSION = 1 as const;

const MAX_FORMAT_VERSION = 1_000_000;
const FORMAT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const PAYLOAD_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/u;
const MIGRATOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TEXT_ENCODER = new TextEncoder();

declare const studioDocumentFormatIdBrand: unique symbol;
declare const studioDocumentPayloadTypeBrand: unique symbol;
declare const canonicalStudioDocumentEnvelopeBrand: unique symbol;
declare const studioDocumentChecksumBrand: unique symbol;

export type StudioDocumentFormatId = string & {
  readonly [studioDocumentFormatIdBrand]: true;
};

export type StudioDocumentPayloadType = string & {
  readonly [studioDocumentPayloadTypeBrand]: true;
};

export type StudioDocumentChecksum = `sha256:${string}` & {
  readonly [studioDocumentChecksumBrand]: true;
};

export type StudioDocumentJsonPrimitive = null | boolean | number | string;
export type StudioDocumentJsonArray = readonly StudioDocumentJsonValue[];
export interface StudioDocumentJsonObject {
  readonly [key: string]: StudioDocumentJsonValue;
}
export type StudioDocumentJsonValue =
  | StudioDocumentJsonPrimitive
  | StudioDocumentJsonArray
  | StudioDocumentJsonObject;

export interface StudioDocumentEnvelopeLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
  readonly maxStringBytes: number;
  readonly maxKeyBytes: number;
  readonly maxExtensions: number;
}

export interface StudioDocumentEnvelopeOptions {
  readonly limits?: Partial<StudioDocumentEnvelopeLimits>;
}

export interface StudioDocumentEnvelopeInput<
  PayloadType extends string = string,
  Payload = unknown,
> {
  readonly format: {
    readonly id: string;
    readonly version: number;
  };
  readonly document: {
    readonly id: string;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly payload: {
    readonly type: PayloadType;
    readonly data: Payload;
  };
  readonly extensions: Readonly<Record<string, unknown>>;
}

export type CanonicalStudioDocumentEnvelope<
  PayloadType extends string = string,
  Payload extends StudioDocumentJsonValue = StudioDocumentJsonValue,
> = Readonly<{
  format: Readonly<{
    id: StudioDocumentFormatId;
    version: number;
  }>;
  document: Readonly<{
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>;
  payload: Readonly<{
    type: StudioDocumentPayloadType & PayloadType;
    data: Payload;
  }>;
  extensions: StudioDocumentJsonObject;
}> & {
  readonly [canonicalStudioDocumentEnvelopeBrand]: true;
};

export type StudioDocumentDiagnosticCode =
  | "INVALID_JSON"
  | "INVALID_ENVELOPE"
  | "INVALID_JSON_VALUE"
  | "LIMIT_EXCEEDED"
  | "NON_CANONICAL_SERIALIZATION"
  | "FORMAT_NOT_REGISTERED"
  | "PAYLOAD_TYPE_NOT_REGISTERED"
  | "UNSUPPORTED_PAST_VERSION"
  | "UNKNOWN_FUTURE_VERSION"
  | "MIGRATION_BUDGET_EXCEEDED"
  | "MIGRATOR_FAILED"
  | "MIGRATION_INVARIANT_VIOLATION"
  | "CHECKSUM_UNAVAILABLE";

export type StudioDocumentRecoveryAction =
  | "repair-source"
  | "preserve-source"
  | "upgrade-client"
  | "register-format"
  | "increase-budget"
  | "fix-migrator"
  | "retry-runtime";

interface StudioDocumentDiagnosticBase {
  readonly severity: "error";
  readonly code: StudioDocumentDiagnosticCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly recovery: StudioDocumentRecoveryAction;
  readonly path?: string;
  readonly formatId?: string;
  readonly payloadType?: string;
  readonly actualVersion?: number;
  readonly currentVersion?: number;
  readonly minimumVersion?: number;
  readonly migratorId?: string;
  readonly fromVersion?: number;
  readonly toVersion?: number;
  readonly requiredSteps?: number;
  readonly maximumSteps?: number;
  readonly cumulativeBytes?: number;
  readonly maximumCumulativeBytes?: number;
}

export interface StudioDocumentFutureVersionDiagnostic
  extends StudioDocumentDiagnosticBase {
  readonly code: "UNKNOWN_FUTURE_VERSION";
  readonly recoverable: true;
  readonly recovery: "upgrade-client";
  readonly formatId: string;
  readonly payloadType: string;
  readonly actualVersion: number;
  readonly currentVersion: number;
}

export type StudioDocumentDiagnostic =
  | StudioDocumentFutureVersionDiagnostic
  | (StudioDocumentDiagnosticBase & {
      readonly code: Exclude<
        StudioDocumentDiagnosticCode,
        "UNKNOWN_FUTURE_VERSION"
      >;
    });

export type StudioDocumentDiagnostics = readonly [
  StudioDocumentDiagnostic,
  ...StudioDocumentDiagnostic[],
];

export type StudioDocumentEnvelopeValidationResult<
  PayloadType extends string = string,
> =
  | {
      readonly ok: true;
      readonly envelope: CanonicalStudioDocumentEnvelope<PayloadType>;
    }
  | {
      readonly ok: false;
      readonly diagnostics: StudioDocumentDiagnostics;
    };

export class StudioDocumentEnvelopeError extends Error {
  readonly diagnostic: StudioDocumentDiagnostic;

  constructor(diagnostic: StudioDocumentDiagnostic) {
    super(diagnostic.message);
    this.name = "StudioDocumentEnvelopeError";
    this.diagnostic = diagnostic;
  }
}

export type StudioDocumentRegistryErrorCode =
  | "INVALID_DEFINITION"
  | "DUPLICATE_FORMAT"
  | "DUPLICATE_MIGRATOR"
  | "MIGRATOR_GAP"
  | "MIGRATOR_DOWNGRADE"
  | "MIGRATOR_CYCLE"
  | "INVALID_BUDGET";

export class StudioDocumentRegistryError extends Error {
  readonly code: StudioDocumentRegistryErrorCode;
  readonly formatId?: string;
  readonly payloadType?: string;
  readonly migratorId?: string;
  readonly fromVersion?: number;
  readonly toVersion?: number;

  constructor(
    code: StudioDocumentRegistryErrorCode,
    message: string,
    details: Readonly<{
      formatId?: string;
      payloadType?: string;
      migratorId?: string;
      fromVersion?: number;
      toVersion?: number;
    }> = {}
  ) {
    super(message);
    this.name = "StudioDocumentRegistryError";
    this.code = code;
    this.formatId = details.formatId;
    this.payloadType = details.payloadType;
    this.migratorId = details.migratorId;
    this.fromVersion = details.fromVersion;
    this.toVersion = details.toVersion;
  }
}

export class StudioDocumentChecksumError extends Error {
  readonly code = "CHECKSUM_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "StudioDocumentChecksumError";
  }
}

class StudioDocumentValidationAbort extends Error {
  readonly diagnostic: StudioDocumentDiagnostic;

  constructor(diagnostic: StudioDocumentDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

interface JsonCloneState {
  readonly limits: StudioDocumentEnvelopeLimits;
  readonly active: WeakSet<object>;
  nodes: number;
}

function diagnostic(
  value: StudioDocumentDiagnostic
): StudioDocumentDiagnostic {
  return Object.freeze(value);
}

function validationAbort(
  code: Exclude<StudioDocumentDiagnosticCode, "UNKNOWN_FUTURE_VERSION">,
  message: string,
  options: Readonly<{
    path?: string;
    recoverable?: boolean;
    recovery?: StudioDocumentRecoveryAction;
  }> = {}
): never {
  throw new StudioDocumentValidationAbort(
    diagnostic({
      severity: "error",
      code,
      message,
      recoverable: options.recoverable ?? false,
      recovery: options.recovery ?? "repair-source",
      ...(options.path === undefined ? {} : { path: options.path }),
    })
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isJsonArray(value: unknown): value is StudioDocumentJsonArray {
  return Array.isArray(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function pointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function childPath(path: string, key: string | number): string {
  return `${path}/${pointerSegment(String(key))}`;
}

function utf8Length(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function ownDescriptors(
  value: object,
  path: string
): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    validationAbort(
      "INVALID_JSON_VALUE",
      "Studio 문서에 안전하게 읽을 수 없는 객체가 포함되어 있습니다.",
      { path }
    );
  }
}

function cloneJsonValue(
  value: unknown,
  state: JsonCloneState,
  depth: number,
  path: string
): StudioDocumentJsonValue {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    validationAbort(
      "LIMIT_EXCEEDED",
      "Studio 문서의 JSON 노드 수가 안전 한도를 넘었습니다.",
      { path }
    );
  }
  if (depth > state.limits.maxDepth) {
    validationAbort(
      "LIMIT_EXCEEDED",
      "Studio 문서의 JSON 중첩 깊이가 안전 한도를 넘었습니다.",
      { path }
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      validationAbort(
        "INVALID_JSON_VALUE",
        "Studio 문서의 모든 숫자는 유한해야 합니다.",
        { path }
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      validationAbort(
        "INVALID_JSON_VALUE",
        "Studio 문서 문자열에 올바르지 않은 Unicode surrogate가 있습니다.",
        { path }
      );
    }
    if (utf8Length(value) > state.limits.maxStringBytes) {
      validationAbort(
        "LIMIT_EXCEEDED",
        "Studio 문서 문자열이 안전 한도를 넘었습니다.",
        { path }
      );
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    validationAbort(
      "INVALID_JSON_VALUE",
      "Studio 문서에는 JSON 값만 사용할 수 있습니다.",
      { path }
    );
  }

  const object = value as object;
  if (state.active.has(object)) {
    validationAbort(
      "INVALID_JSON_VALUE",
      "Studio 문서에 순환 참조가 포함되어 있습니다.",
      { path }
    );
  }
  state.active.add(object);
  try {
    if (Array.isArray(value)) {
      if (value.length > state.limits.maxArrayItems) {
        validationAbort(
          "LIMIT_EXCEEDED",
          "Studio 문서 배열 길이가 안전 한도를 넘었습니다.",
          { path }
        );
      }
      const descriptors = ownDescriptors(value, path);
      const symbols = Reflect.ownKeys(descriptors).filter(
        (key): key is symbol => typeof key === "symbol"
      );
      if (symbols.length > 0) {
        validationAbort(
          "INVALID_JSON_VALUE",
          "Studio 문서 배열에는 Symbol 속성을 사용할 수 없습니다.",
          { path }
        );
      }
      const allowedKeys = new Set(["length"]);
      const result: StudioDocumentJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          validationAbort(
            "INVALID_JSON_VALUE",
            "Studio 문서 배열은 빈 슬롯이나 접근자 속성을 포함할 수 없습니다.",
            { path: childPath(path, index) }
          );
        }
        result.push(cloneJsonValue(descriptor.value, state, depth + 1, childPath(path, index)));
      }
      if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) {
        validationAbort(
          "INVALID_JSON_VALUE",
          "Studio 문서 배열에는 인덱스 외 속성을 사용할 수 없습니다.",
          { path }
        );
      }
      return result;
    }

    if (!isPlainRecord(value)) {
      validationAbort(
        "INVALID_JSON_VALUE",
        "Studio 문서 객체는 일반 JSON 객체여야 합니다.",
        { path }
      );
    }
    const descriptors = ownDescriptors(value, path);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
      validationAbort(
        "INVALID_JSON_VALUE",
        "Studio 문서 객체에는 Symbol 속성을 사용할 수 없습니다.",
        { path }
      );
    }
    const keys = Object.keys(descriptors);
    if (keys.length > state.limits.maxObjectKeys) {
      validationAbort(
        "LIMIT_EXCEEDED",
        "Studio 문서 객체의 키 수가 안전 한도를 넘었습니다.",
        { path }
      );
    }
    const result = Object.create(null) as Record<string, StudioDocumentJsonValue>;
    for (const key of keys.sort()) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        key.length === 0 ||
        hasUnpairedSurrogate(key)
      ) {
        validationAbort(
          "INVALID_JSON_VALUE",
          "Studio 문서 객체 키 또는 속성 형식이 올바르지 않습니다.",
          { path: childPath(path, key) }
        );
      }
      if (utf8Length(key) > state.limits.maxKeyBytes) {
        validationAbort(
          "LIMIT_EXCEEDED",
          "Studio 문서 객체 키가 안전 한도를 넘었습니다.",
          { path: childPath(path, key) }
        );
      }
      Object.defineProperty(result, key, {
        value: cloneJsonValue(descriptor.value, state, depth + 1, childPath(path, key)),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } finally {
    state.active.delete(object);
  }
}

function canonicalJson(value: StudioDocumentJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function deepFreezeJson<T extends StudioDocumentJsonValue>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of isJsonArray(value) ? value : Object.values(value)) {
    deepFreezeJson(child);
  }
  return Object.freeze(value);
}

function exactKeys(
  value: StudioDocumentJsonObject,
  keys: readonly string[],
  path: string
): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    validationAbort(
      "INVALID_ENVELOPE",
      "Studio 문서 envelope의 필드 구성이 올바르지 않습니다.",
      { path }
    );
  }
}

function jsonObject(
  value: StudioDocumentJsonValue,
  path: string
): StudioDocumentJsonObject {
  if (typeof value !== "object" || value === null || isJsonArray(value)) {
    validationAbort(
      "INVALID_ENVELOPE",
      "Studio 문서 envelope 필드는 JSON 객체여야 합니다.",
      { path }
    );
  }
  return value;
}

function requiredString(
  value: StudioDocumentJsonValue,
  path: string
): string {
  if (typeof value !== "string") {
    validationAbort(
      "INVALID_ENVELOPE",
      "Studio 문서 envelope 문자열 필드가 올바르지 않습니다.",
      { path }
    );
  }
  return value;
}

function boundedFormatVersion(
  value: StudioDocumentJsonValue,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_FORMAT_VERSION
  ) {
    validationAbort(
      "INVALID_ENVELOPE",
      `Studio 문서 format version은 1 이상 ${MAX_FORMAT_VERSION.toLocaleString("en-US")} 이하의 정수여야 합니다.`,
      { path }
    );
  }
  return value;
}

function canonicalTimestamp(value: StudioDocumentJsonValue, path: string): string {
  const source = requiredString(value, path);
  if (
    !CANONICAL_TIMESTAMP_PATTERN.test(source) ||
    !Number.isFinite(Date.parse(source)) ||
    new Date(source).toISOString() !== source
  ) {
    validationAbort(
      "INVALID_ENVELOPE",
      "Studio 문서 timestamp는 밀리초를 포함한 UTC ISO-8601 형식이어야 합니다.",
      { path }
    );
  }
  return source;
}

function resolveEnvelopeLimits(
  value: Partial<StudioDocumentEnvelopeLimits> | undefined
): StudioDocumentEnvelopeLimits {
  const resolve = (
    key: keyof StudioDocumentEnvelopeLimits,
    minimum: number
  ): number => {
    const hardMaximum = STUDIO_DOCUMENT_ENVELOPE_LIMITS[key];
    const candidate = value?.[key] ?? hardMaximum;
    if (
      !Number.isSafeInteger(candidate) ||
      candidate < minimum ||
      candidate > hardMaximum
    ) {
      throw new StudioDocumentRegistryError(
        "INVALID_BUDGET",
        `${key} envelope 한도는 ${minimum.toLocaleString("en-US")} 이상 ${hardMaximum.toLocaleString("en-US")} 이하의 정수여야 합니다.`
      );
    }
    return candidate;
  };
  return {
    maxBytes: resolve("maxBytes", 1),
    maxDepth: resolve("maxDepth", 1),
    maxNodes: resolve("maxNodes", 1),
    maxObjectKeys: resolve("maxObjectKeys", 1),
    maxArrayItems: resolve("maxArrayItems", 0),
    maxStringBytes: resolve("maxStringBytes", 0),
    maxKeyBytes: resolve("maxKeyBytes", 1),
    maxExtensions: resolve("maxExtensions", 0),
  };
}

function decodeEnvelopeInput(
  input: unknown,
  limits: StudioDocumentEnvelopeLimits
): unknown {
  if (typeof input !== "string") return input;
  if (utf8Length(input) > limits.maxBytes) {
    validationAbort(
      "LIMIT_EXCEEDED",
      "Studio 문서 envelope 바이트 크기가 안전 한도를 넘었습니다.",
      { path: "" }
    );
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    validationAbort(
      "INVALID_JSON",
      "Studio 문서 envelope JSON을 해석하지 못했습니다.",
      { path: "" }
    );
  }
}

/**
 * Validates, detaches, canonicalizes, and deeply freezes an envelope.
 *
 * Unknown data is permitted only inside `payload.data` and the explicit `extensions` map. That
 * map is carried byte-semantically through every registered migration.
 */
export function canonicalizeStudioDocumentEnvelope<
  PayloadType extends string = string,
>(
  input: unknown,
  options: StudioDocumentEnvelopeOptions = {}
): StudioDocumentEnvelopeValidationResult<PayloadType> {
  const limits = resolveEnvelopeLimits(options.limits);
  try {
    const decoded = decodeEnvelopeInput(input, limits);
    const cloned = cloneJsonValue(
      decoded,
      { limits, active: new WeakSet(), nodes: 0 },
      0,
      ""
    );
    const root = jsonObject(cloned, "");
    exactKeys(root, ["format", "document", "payload", "extensions"], "");

    const format = jsonObject(root.format, "/format");
    exactKeys(format, ["id", "version"], "/format");
    const formatId = requiredString(format.id, "/format/id");
    if (
      formatId.length > 160 ||
      !FORMAT_ID_PATTERN.test(formatId)
    ) {
      validationAbort(
        "INVALID_ENVELOPE",
        "Studio 문서 format id는 소문자 namespace 형식이어야 합니다.",
        { path: "/format/id" }
      );
    }
    const formatVersion = boundedFormatVersion(format.version, "/format/version");

    const document = jsonObject(root.document, "/document");
    exactKeys(
      document,
      ["id", "revision", "createdAt", "updatedAt"],
      "/document"
    );
    const documentId = requiredString(document.id, "/document/id");
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      validationAbort(
        "INVALID_ENVELOPE",
        "Studio 문서 id 형식이 올바르지 않습니다.",
        { path: "/document/id" }
      );
    }
    if (
      typeof document.revision !== "number" ||
      !Number.isSafeInteger(document.revision) ||
      document.revision < 0
    ) {
      validationAbort(
        "INVALID_ENVELOPE",
        "Studio 문서 revision은 0 이상의 안전한 정수여야 합니다.",
        { path: "/document/revision" }
      );
    }
    const createdAt = canonicalTimestamp(document.createdAt, "/document/createdAt");
    const updatedAt = canonicalTimestamp(document.updatedAt, "/document/updatedAt");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      validationAbort(
        "INVALID_ENVELOPE",
        "Studio 문서 updatedAt은 createdAt보다 빠를 수 없습니다.",
        { path: "/document/updatedAt" }
      );
    }

    const payload = jsonObject(root.payload, "/payload");
    exactKeys(payload, ["type", "data"], "/payload");
    const payloadType = requiredString(payload.type, "/payload/type");
    if (
      payloadType.length > 128 ||
      !PAYLOAD_TYPE_PATTERN.test(payloadType)
    ) {
      validationAbort(
        "INVALID_ENVELOPE",
        "Studio 문서 payload type 형식이 올바르지 않습니다.",
        { path: "/payload/type" }
      );
    }

    const extensions = jsonObject(root.extensions, "/extensions");
    if (Object.keys(extensions).length > limits.maxExtensions) {
      validationAbort(
        "LIMIT_EXCEEDED",
        "Studio 문서 extension 수가 안전 한도를 넘었습니다.",
        { path: "/extensions" }
      );
    }

    const envelope = {
      format: {
        id: formatId as StudioDocumentFormatId,
        version: formatVersion,
      },
      document: {
        id: documentId,
        revision: document.revision,
        createdAt,
        updatedAt,
      },
      payload: {
        type: payloadType as StudioDocumentPayloadType & PayloadType,
        data: payload.data,
      },
      extensions,
    } as unknown as CanonicalStudioDocumentEnvelope<PayloadType>;
    const serialized = canonicalJson(
      envelope as unknown as StudioDocumentJsonValue
    );
    if (utf8Length(serialized) > limits.maxBytes) {
      validationAbort(
        "LIMIT_EXCEEDED",
        "Studio 문서 envelope 바이트 크기가 안전 한도를 넘었습니다.",
        { path: "" }
      );
    }
    deepFreezeJson(envelope as unknown as StudioDocumentJsonValue);
    return { ok: true, envelope };
  } catch (error) {
    if (error instanceof StudioDocumentValidationAbort) {
      return { ok: false, diagnostics: [error.diagnostic] };
    }
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          severity: "error",
          code: "INVALID_JSON_VALUE",
          message: "Studio 문서 envelope를 안전하게 검증하지 못했습니다.",
          recoverable: false,
          recovery: "repair-source",
        }),
      ],
    };
  }
}

/** Creates a branded canonical envelope or throws a typed validation error. */
export function createCanonicalStudioDocumentEnvelope<
  PayloadType extends string = string,
>(
  input: StudioDocumentEnvelopeInput<PayloadType>,
  options: StudioDocumentEnvelopeOptions = {}
): CanonicalStudioDocumentEnvelope<PayloadType> {
  const result = canonicalizeStudioDocumentEnvelope<PayloadType>(input, options);
  if (!result.ok) throw new StudioDocumentEnvelopeError(result.diagnostics[0]);
  return result.envelope;
}

/**
 * Parses only the deterministic wire representation emitted by
 * `serializeCanonicalStudioDocumentEnvelope`.
 */
export function parseCanonicalStudioDocumentEnvelope<
  PayloadType extends string = string,
>(
  serialized: string,
  options: StudioDocumentEnvelopeOptions = {}
): StudioDocumentEnvelopeValidationResult<PayloadType> {
  const parsed = canonicalizeStudioDocumentEnvelope<PayloadType>(serialized, options);
  if (!parsed.ok) return parsed;
  if (serializeCanonicalStudioDocumentEnvelope(parsed.envelope) !== serialized) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          severity: "error",
          code: "NON_CANONICAL_SERIALIZATION",
          message: "Studio 문서 envelope가 canonical JSON 표현과 일치하지 않습니다.",
          recoverable: true,
          recovery: "preserve-source",
        }),
      ],
    };
  }
  return parsed;
}

/** RFC-8259-compatible canonical JSON with recursively sorted object keys and normalized `-0`. */
export function serializeCanonicalStudioDocumentEnvelope(
  envelope: CanonicalStudioDocumentEnvelope
): string {
  return canonicalJson(envelope as unknown as StudioDocumentJsonValue);
}

/** SHA-256 over the exact UTF-8 canonical envelope serialization. */
export async function checksumCanonicalStudioDocumentEnvelope(
  envelope: CanonicalStudioDocumentEnvelope
): Promise<StudioDocumentChecksum> {
  const bytes = TEXT_ENCODER.encode(
    serializeCanonicalStudioDocumentEnvelope(envelope)
  );
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);
    try {
      const digest = await subtle.digest("SHA-256", owned.buffer);
      const digestBytes = new Uint8Array(digest);
      if (digestBytes.byteLength === 32) {
        const hexadecimal = [...digestBytes]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        return `sha256:${hexadecimal}` as StudioDocumentChecksum;
      }
    } catch {
      // A partially implemented Web Crypto surface must not make durable provenance unavailable.
      // The verified portable implementation below preserves the exact SHA-256 contract.
    }
  }
  try {
    return `sha256:${sha256HexPortable(bytes)}` as StudioDocumentChecksum;
  } catch {
    throw new StudioDocumentChecksumError(
      "Studio 문서 SHA-256 checksum 계산이 실패했습니다."
    );
  }
}

export interface StudioDocumentMigratorContext {
  readonly formatId: string;
  readonly payloadType: string;
  readonly migratorId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly step: number;
  readonly maximumSteps: number;
  readonly remainingSteps: number;
}

export interface StudioDocumentMigrator {
  readonly id: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (
    envelope: CanonicalStudioDocumentEnvelope,
    context: StudioDocumentMigratorContext
  ) => unknown | Promise<unknown>;
}

export interface StudioDocumentFormatDefinition {
  readonly formatId: string;
  readonly payloadType: string;
  readonly minimumVersion?: number;
  readonly currentVersion: number;
  readonly migrators: readonly StudioDocumentMigrator[];
}

export interface StudioDocumentRegisteredFormat {
  readonly formatId: StudioDocumentFormatId;
  readonly payloadType: StudioDocumentPayloadType;
  readonly minimumVersion: number;
  readonly currentVersion: number;
  readonly migrators: readonly Readonly<{
    id: string;
    fromVersion: number;
    toVersion: number;
  }>[];
}

interface RegisteredFormat {
  readonly formatId: StudioDocumentFormatId;
  readonly payloadType: StudioDocumentPayloadType;
  readonly minimumVersion: number;
  readonly currentVersion: number;
  readonly migrators: readonly StudioDocumentMigrator[];
  readonly byFromVersion: ReadonlyMap<number, StudioDocumentMigrator>;
}

export interface StudioDocumentMigrationBudget {
  readonly maxSteps: number;
  readonly maxCumulativeBytes: number;
}

export interface StudioDocumentMigrationOptions
  extends StudioDocumentEnvelopeOptions {
  readonly budget?: Partial<StudioDocumentMigrationBudget>;
}

export interface StudioDocumentMigrationStepReceipt {
  readonly migratorId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly inputChecksum: StudioDocumentChecksum;
  readonly outputChecksum: StudioDocumentChecksum;
  readonly outputBytes: number;
}

export interface StudioDocumentMigrationReceipt {
  readonly receiptVersion: typeof STUDIO_DOCUMENT_MIGRATION_RECEIPT_VERSION;
  readonly formatId: string;
  readonly payloadType: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly sourceChecksum: StudioDocumentChecksum;
  readonly resultChecksum: StudioDocumentChecksum;
  readonly migrated: boolean;
  readonly steps: readonly StudioDocumentMigrationStepReceipt[];
}

export type StudioDocumentMigrationResult =
  | {
      readonly ok: true;
      readonly envelope: CanonicalStudioDocumentEnvelope;
      readonly receipt: StudioDocumentMigrationReceipt;
    }
  | {
      readonly ok: false;
      readonly diagnostics: StudioDocumentDiagnostics;
      /**
       * Structurally valid source retained for safe export/retry. It is never presented as a
       * successfully opened or migrated document.
       */
      readonly preservedEnvelope?: CanonicalStudioDocumentEnvelope;
    };

function registryKey(formatId: string, payloadType: string): string {
  return `${formatId.length}:${formatId}${payloadType.length}:${payloadType}`;
}

function registryError(
  code: StudioDocumentRegistryErrorCode,
  message: string,
  definition: Pick<StudioDocumentFormatDefinition, "formatId" | "payloadType">,
  migrator?: Pick<StudioDocumentMigrator, "id" | "fromVersion" | "toVersion">
): never {
  throw new StudioDocumentRegistryError(code, message, {
    formatId: definition.formatId,
    payloadType: definition.payloadType,
    ...(migrator
      ? {
          migratorId: migrator.id,
          fromVersion: migrator.fromVersion,
          toVersion: migrator.toVersion,
        }
      : {}),
  });
}

function validDefinitionVersion(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_FORMAT_VERSION
  );
}

function assertNoMigratorCycle(
  migrators: readonly StudioDocumentMigrator[],
  definition: StudioDocumentFormatDefinition
): void {
  const byFrom = new Map(migrators.map((migrator) => [migrator.fromVersion, migrator]));
  const settled = new Set<number>();
  const visit = (version: number, active: Set<number>): void => {
    if (active.has(version)) {
      registryError(
        "MIGRATOR_CYCLE",
        "Studio 문서 migrator 그래프에 순환 경로가 있습니다.",
        definition,
        byFrom.get(version)
      );
    }
    if (settled.has(version)) return;
    const edge = byFrom.get(version);
    if (!edge) {
      settled.add(version);
      return;
    }
    active.add(version);
    visit(edge.toVersion, active);
    active.delete(version);
    settled.add(version);
  };
  for (const version of byFrom.keys()) visit(version, new Set());
}

function validateFormatDefinition(
  definition: StudioDocumentFormatDefinition
): RegisteredFormat {
  if (
    definition.formatId.length > 160 ||
    !FORMAT_ID_PATTERN.test(definition.formatId) ||
    definition.payloadType.length > 128 ||
    !PAYLOAD_TYPE_PATTERN.test(definition.payloadType) ||
    !validDefinitionVersion(definition.currentVersion)
  ) {
    registryError(
      "INVALID_DEFINITION",
      "Studio 문서 format 정의의 id, payload type, 또는 current version이 올바르지 않습니다.",
      definition
    );
  }
  const minimumVersion = definition.minimumVersion ?? 1;
  if (
    !validDefinitionVersion(minimumVersion) ||
    minimumVersion > definition.currentVersion
  ) {
    registryError(
      "INVALID_DEFINITION",
      "Studio 문서 format의 minimum version이 올바르지 않습니다.",
      definition
    );
  }
  if (
    definition.currentVersion - minimumVersion >
    STUDIO_DOCUMENT_MIGRATION_BUDGET.maxSteps
  ) {
    registryError(
      "MIGRATOR_GAP",
      "Studio 문서 format의 migration 경로가 등록 가능한 최대 단계 수를 넘었습니다.",
      definition
    );
  }

  const migrators = [...definition.migrators];
  const ids = new Set<string>();
  const fromVersions = new Set<number>();
  for (const migrator of migrators) {
    if (
      !MIGRATOR_ID_PATTERN.test(migrator.id) ||
      !validDefinitionVersion(migrator.fromVersion) ||
      !validDefinitionVersion(migrator.toVersion) ||
      typeof migrator.migrate !== "function"
    ) {
      registryError(
        "INVALID_DEFINITION",
        "Studio 문서 migrator 정의가 올바르지 않습니다.",
        definition,
        migrator
      );
    }
    if (ids.has(migrator.id) || fromVersions.has(migrator.fromVersion)) {
      registryError(
        "DUPLICATE_MIGRATOR",
        "같은 id 또는 시작 version을 가진 Studio 문서 migrator가 중복 등록되었습니다.",
        definition,
        migrator
      );
    }
    ids.add(migrator.id);
    fromVersions.add(migrator.fromVersion);
  }

  assertNoMigratorCycle(migrators, definition);
  for (const migrator of migrators) {
    if (migrator.toVersion < migrator.fromVersion) {
      registryError(
        "MIGRATOR_DOWNGRADE",
        "Studio 문서 migrator는 이전 version으로 되돌릴 수 없습니다.",
        definition,
        migrator
      );
    }
  }

  const ordered = migrators.sort(
    (left, right) =>
      left.fromVersion - right.fromVersion ||
      left.toVersion - right.toVersion ||
      left.id.localeCompare(right.id)
  );
  if (ordered.length !== definition.currentVersion - minimumVersion) {
    registryError(
      "MIGRATOR_GAP",
      "Studio 문서 format의 migration version 경로가 연속적이지 않습니다.",
      definition
    );
  }
  for (
    let version = minimumVersion;
    version < definition.currentVersion;
    version += 1
  ) {
    const migrator = ordered[version - minimumVersion];
    if (
      !migrator ||
      migrator.fromVersion !== version ||
      migrator.toVersion !== version + 1
    ) {
      registryError(
        "MIGRATOR_GAP",
        "Studio 문서 migrator는 모든 지원 version을 정확히 한 단계씩 연결해야 합니다.",
        definition,
        migrator
      );
    }
  }

  const frozenMigrators = Object.freeze(ordered.map((migrator) => Object.freeze({
    id: migrator.id,
    fromVersion: migrator.fromVersion,
    toVersion: migrator.toVersion,
    migrate: migrator.migrate,
  })));
  return Object.freeze({
    formatId: definition.formatId as StudioDocumentFormatId,
    payloadType: definition.payloadType as StudioDocumentPayloadType,
    minimumVersion,
    currentVersion: definition.currentVersion,
    migrators: frozenMigrators,
    byFromVersion: new Map(
      frozenMigrators.map((migrator) => [migrator.fromVersion, migrator])
    ),
  });
}

function resolveMigrationBudget(
  value: Partial<StudioDocumentMigrationBudget> | undefined
): StudioDocumentMigrationBudget {
  const maxSteps = value?.maxSteps ?? STUDIO_DOCUMENT_MIGRATION_BUDGET.maxSteps;
  const maxCumulativeBytes =
    value?.maxCumulativeBytes ??
    STUDIO_DOCUMENT_MIGRATION_BUDGET.maxCumulativeBytes;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 0 ||
    maxSteps > STUDIO_DOCUMENT_MIGRATION_BUDGET.maxSteps ||
    !Number.isSafeInteger(maxCumulativeBytes) ||
    maxCumulativeBytes < 1 ||
    maxCumulativeBytes >
      STUDIO_DOCUMENT_MIGRATION_BUDGET.maxCumulativeBytes
  ) {
    throw new StudioDocumentRegistryError(
      "INVALID_BUDGET",
      "Studio 문서 migration budget이 허용 범위를 벗어났습니다."
    );
  }
  return { maxSteps, maxCumulativeBytes };
}

function resolveRegistryEnvelopeLimits(
  configured: StudioDocumentEnvelopeLimits,
  override: Partial<StudioDocumentEnvelopeLimits> | undefined
): StudioDocumentEnvelopeLimits {
  if (!override) return configured;
  const resolved = resolveEnvelopeLimits({ ...configured, ...override });
  for (const key of Object.keys(configured) as Array<keyof StudioDocumentEnvelopeLimits>) {
    if (resolved[key] > configured[key]) {
      throw new StudioDocumentRegistryError(
        "INVALID_BUDGET",
        `${key} envelope 한도는 registry에 설정된 한도보다 높일 수 없습니다.`
      );
    }
  }
  return resolved;
}

function migrationFailure(
  diagnosticValue: StudioDocumentDiagnostic,
  preservedEnvelope?: CanonicalStudioDocumentEnvelope
): StudioDocumentMigrationResult {
  return {
    ok: false,
    diagnostics: [diagnostic(diagnosticValue)],
    ...(preservedEnvelope ? { preservedEnvelope } : {}),
  };
}

function sameDocumentIdentity(
  left: CanonicalStudioDocumentEnvelope,
  right: CanonicalStudioDocumentEnvelope
): boolean {
  return (
    left.document.id === right.document.id &&
    left.document.revision === right.document.revision &&
    left.document.createdAt === right.document.createdAt &&
    left.document.updatedAt === right.document.updatedAt
  );
}

function sameExtensions(
  left: CanonicalStudioDocumentEnvelope,
  right: CanonicalStudioDocumentEnvelope
): boolean {
  return canonicalJson(left.extensions) === canonicalJson(right.extensions);
}

async function checksumForMigration(
  envelope: CanonicalStudioDocumentEnvelope
): Promise<StudioDocumentChecksum | null> {
  try {
    return await checksumCanonicalStudioDocumentEnvelope(envelope);
  } catch {
    return null;
  }
}

/**
 * Registry for immutable, contiguous Studio format histories.
 *
 * Registration errors are programmer/configuration errors and throw `StudioDocumentRegistryError`.
 * Document input and migration failures return typed diagnostics and never expose a partial output
 * as successfully migrated.
 */
export class StudioDocumentMigratorRegistry {
  private readonly formats = new Map<string, RegisteredFormat>();
  private readonly envelopeLimits: StudioDocumentEnvelopeLimits;

  constructor(
    definitions: readonly StudioDocumentFormatDefinition[] = [],
    options: StudioDocumentEnvelopeOptions = {}
  ) {
    this.envelopeLimits = Object.freeze(resolveEnvelopeLimits(options.limits));
    for (const definition of definitions) this.register(definition);
  }

  register(definition: StudioDocumentFormatDefinition): this {
    const registered = validateFormatDefinition(definition);
    const key = registryKey(registered.formatId, registered.payloadType);
    if (this.formats.has(key)) {
      registryError(
        "DUPLICATE_FORMAT",
        "같은 format id와 payload type의 Studio 문서 format이 이미 등록되어 있습니다.",
        definition
      );
    }
    this.formats.set(key, registered);
    return this;
  }

  list(): readonly StudioDocumentRegisteredFormat[] {
    return Object.freeze(
      [...this.formats.values()]
        .sort(
          (left, right) =>
            left.formatId.localeCompare(right.formatId) ||
            left.payloadType.localeCompare(right.payloadType)
        )
        .map((definition) =>
          Object.freeze({
            formatId: definition.formatId,
            payloadType: definition.payloadType,
            minimumVersion: definition.minimumVersion,
            currentVersion: definition.currentVersion,
            migrators: Object.freeze(
              definition.migrators.map((migrator) =>
                Object.freeze({
                  id: migrator.id,
                  fromVersion: migrator.fromVersion,
                  toVersion: migrator.toVersion,
                })
              )
            ),
          })
        )
    );
  }

  async migrate(
    input: unknown,
    options: StudioDocumentMigrationOptions = {}
  ): Promise<StudioDocumentMigrationResult> {
    const envelopeOptions: StudioDocumentEnvelopeOptions = {
      limits: resolveRegistryEnvelopeLimits(this.envelopeLimits, options.limits),
    };
    const parsed = canonicalizeStudioDocumentEnvelope(input, envelopeOptions);
    if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
    const source = parsed.envelope;
    const definition = this.formats.get(
      registryKey(source.format.id, source.payload.type)
    );
    if (!definition) {
      const formatKnown = [...this.formats.values()].some(
        (candidate) => candidate.formatId === source.format.id
      );
      return migrationFailure(
        {
          severity: "error",
          code: formatKnown
            ? "PAYLOAD_TYPE_NOT_REGISTERED"
            : "FORMAT_NOT_REGISTERED",
          message: formatKnown
            ? "이 Studio 문서 payload type을 처리할 format이 등록되어 있지 않습니다."
            : "이 Studio 문서 format이 registry에 등록되어 있지 않습니다.",
          recoverable: true,
          recovery: "register-format",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
        },
        source
      );
    }

    if (source.format.version > definition.currentVersion) {
      return migrationFailure(
        {
          severity: "error",
          code: "UNKNOWN_FUTURE_VERSION",
          message:
            "이 Studio 문서는 현재 빌드보다 새로운 format version으로 저장되었습니다.",
          recoverable: true,
          recovery: "upgrade-client",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
          currentVersion: definition.currentVersion,
        },
        source
      );
    }
    if (source.format.version < definition.minimumVersion) {
      return migrationFailure(
        {
          severity: "error",
          code: "UNSUPPORTED_PAST_VERSION",
          message:
            "이 Studio 문서의 format version은 registry가 보존하는 migration 범위보다 오래되었습니다.",
          recoverable: true,
          recovery: "preserve-source",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
          minimumVersion: definition.minimumVersion,
          currentVersion: definition.currentVersion,
        },
        source
      );
    }

    const budget = resolveMigrationBudget(options.budget);
    const requiredSteps =
      definition.currentVersion - source.format.version;
    if (requiredSteps > budget.maxSteps) {
      return migrationFailure(
        {
          severity: "error",
          code: "MIGRATION_BUDGET_EXCEEDED",
          message: "Studio 문서 migration 단계 수가 실행 budget을 넘었습니다.",
          recoverable: true,
          recovery: "increase-budget",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
          currentVersion: definition.currentVersion,
          requiredSteps,
          maximumSteps: budget.maxSteps,
        },
        source
      );
    }

    const sourceSerialized = serializeCanonicalStudioDocumentEnvelope(source);
    let cumulativeBytes = utf8Length(sourceSerialized);
    if (cumulativeBytes > budget.maxCumulativeBytes) {
      return migrationFailure(
        {
          severity: "error",
          code: "MIGRATION_BUDGET_EXCEEDED",
          message: "Studio 문서 migration 누적 바이트가 실행 budget을 넘었습니다.",
          recoverable: true,
          recovery: "increase-budget",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
          currentVersion: definition.currentVersion,
          cumulativeBytes,
          maximumCumulativeBytes: budget.maxCumulativeBytes,
        },
        source
      );
    }

    const sourceChecksum = await checksumForMigration(source);
    if (!sourceChecksum) {
      return migrationFailure(
        {
          severity: "error",
          code: "CHECKSUM_UNAVAILABLE",
          message: "Studio 문서 migration provenance checksum을 계산하지 못했습니다.",
          recoverable: true,
          recovery: "retry-runtime",
          formatId: source.format.id,
          payloadType: source.payload.type,
          actualVersion: source.format.version,
          currentVersion: definition.currentVersion,
        },
        source
      );
    }

    let current = source;
    let currentChecksum = sourceChecksum;
    const steps: StudioDocumentMigrationStepReceipt[] = [];
    for (let index = 0; index < requiredSteps; index += 1) {
      const migrator = definition.byFromVersion.get(current.format.version);
      if (!migrator) {
        return migrationFailure(
          {
            severity: "error",
            code: "MIGRATION_INVARIANT_VIOLATION",
            message: "등록된 Studio 문서 migration 경로가 실행 중 끊어졌습니다.",
            recoverable: true,
            recovery: "fix-migrator",
            formatId: source.format.id,
            payloadType: source.payload.type,
            actualVersion: current.format.version,
            currentVersion: definition.currentVersion,
          },
          source
        );
      }
      const context = Object.freeze({
        formatId: definition.formatId,
        payloadType: definition.payloadType,
        migratorId: migrator.id,
        fromVersion: migrator.fromVersion,
        toVersion: migrator.toVersion,
        step: index + 1,
        maximumSteps: budget.maxSteps,
        remainingSteps: requiredSteps - index - 1,
      });

      let migratedValue: unknown;
      try {
        migratedValue = await migrator.migrate(current, context);
      } catch {
        return migrationFailure(
          {
            severity: "error",
            code: "MIGRATOR_FAILED",
            message: "Studio 문서 migrator 실행이 실패했습니다.",
            recoverable: true,
            recovery: "fix-migrator",
            formatId: source.format.id,
            payloadType: source.payload.type,
            migratorId: migrator.id,
            fromVersion: migrator.fromVersion,
            toVersion: migrator.toVersion,
          },
          source
        );
      }

      const output = canonicalizeStudioDocumentEnvelope(
        migratedValue,
        envelopeOptions
      );
      if (!output.ok) {
        return migrationFailure(
          {
            severity: "error",
            code: "MIGRATION_INVARIANT_VIOLATION",
            message:
              "Studio 문서 migrator가 유효한 canonical envelope를 반환하지 않았습니다.",
            recoverable: true,
            recovery: "fix-migrator",
            formatId: source.format.id,
            payloadType: source.payload.type,
            migratorId: migrator.id,
            fromVersion: migrator.fromVersion,
            toVersion: migrator.toVersion,
          },
          source
        );
      }
      const next = output.envelope;
      if (
        next.format.id !== source.format.id ||
        next.payload.type !== source.payload.type ||
        next.format.version !== migrator.toVersion ||
        !sameDocumentIdentity(source, next) ||
        !sameExtensions(source, next)
      ) {
        return migrationFailure(
          {
            severity: "error",
            code: "MIGRATION_INVARIANT_VIOLATION",
            message:
              "Studio 문서 migrator가 format, payload type, document identity, 또는 extension 보존 규칙을 위반했습니다.",
            recoverable: true,
            recovery: "fix-migrator",
            formatId: source.format.id,
            payloadType: source.payload.type,
            migratorId: migrator.id,
            fromVersion: migrator.fromVersion,
            toVersion: migrator.toVersion,
          },
          source
        );
      }

      const outputBytes = utf8Length(
        serializeCanonicalStudioDocumentEnvelope(next)
      );
      cumulativeBytes += outputBytes;
      if (cumulativeBytes > budget.maxCumulativeBytes) {
        return migrationFailure(
          {
            severity: "error",
            code: "MIGRATION_BUDGET_EXCEEDED",
            message: "Studio 문서 migration 누적 바이트가 실행 budget을 넘었습니다.",
            recoverable: true,
            recovery: "increase-budget",
            formatId: source.format.id,
            payloadType: source.payload.type,
            migratorId: migrator.id,
            fromVersion: migrator.fromVersion,
            toVersion: migrator.toVersion,
            cumulativeBytes,
            maximumCumulativeBytes: budget.maxCumulativeBytes,
          },
          source
        );
      }
      const outputChecksum = await checksumForMigration(next);
      if (!outputChecksum) {
        return migrationFailure(
          {
            severity: "error",
            code: "CHECKSUM_UNAVAILABLE",
            message: "Studio 문서 migration provenance checksum을 계산하지 못했습니다.",
            recoverable: true,
            recovery: "retry-runtime",
            formatId: source.format.id,
            payloadType: source.payload.type,
            migratorId: migrator.id,
            fromVersion: migrator.fromVersion,
            toVersion: migrator.toVersion,
          },
          source
        );
      }
      steps.push(
        Object.freeze({
          migratorId: migrator.id,
          fromVersion: migrator.fromVersion,
          toVersion: migrator.toVersion,
          inputChecksum: currentChecksum,
          outputChecksum,
          outputBytes,
        })
      );
      current = next;
      currentChecksum = outputChecksum;
    }

    const receipt: StudioDocumentMigrationReceipt = Object.freeze({
      receiptVersion: STUDIO_DOCUMENT_MIGRATION_RECEIPT_VERSION,
      formatId: source.format.id,
      payloadType: source.payload.type,
      documentId: source.document.id,
      documentRevision: source.document.revision,
      fromVersion: source.format.version,
      toVersion: current.format.version,
      sourceChecksum,
      resultChecksum: currentChecksum,
      migrated: steps.length > 0,
      steps: Object.freeze(steps),
    });
    return { ok: true, envelope: current, receipt };
  }
}

export function createStudioDocumentMigratorRegistry(
  definitions: readonly StudioDocumentFormatDefinition[] = [],
  options: StudioDocumentEnvelopeOptions = {}
): StudioDocumentMigratorRegistry {
  return new StudioDocumentMigratorRegistry(definitions, options);
}
