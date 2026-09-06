/**
 * 컷 레이어 분리(Scene Layer Lift)의 renderer/provider 중립 데이터 계약.
 *
 * 이 모듈은 정규화된 RGBA 입력과 로컬 provider 결과의 신뢰 경계만 정의한다.
 * DOM, React, 모델 실행, Worker 수명주기, 네트워크 정책은 의도적으로 포함하지 않는다.
 */
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_SCENE_LAYER_LIFT_CONTRACT_KIND =
  "toonspectrum.scene-layer-lift" as const;
export const STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION = 1 as const;
export const STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND =
  "toonspectrum.scene-layer-lift/request" as const;
export const STUDIO_SCENE_LAYER_LIFT_RESULT_KIND =
  "toonspectrum.scene-layer-lift/result" as const;
export const STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND =
  "toonspectrum.scene-layer-lift/local-provider-receipt" as const;

export const STUDIO_SCENE_LAYER_LIFT_BUDGETS = Object.freeze({
  maximumAxisPixels: 8_192,
  maximumPixels: 16_777_216,
  maximumInputBytes: 64 * 1_024 * 1_024,
  maximumOutputBytes: 256 * 1_024 * 1_024,
  maximumLayerCount: 12,
  maximumMaskBytes: 128 * 1_024 * 1_024,
  maximumSourceCharacters: 512,
  maximumIdentifierCharacters: 160,
  maximumLayerLabelCharacters: 128,
  maximumDiagnostics: 32,
  maximumDiagnosticMessageCharacters: 256,
  maximumProviderVersionCharacters: 64,
  maximumDurationMilliseconds: 24 * 60 * 60 * 1_000,
} as const);

export const STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES = Object.freeze([
  "background",
  "character",
  "line-art",
  "flat-color",
  "shading",
  "highlight",
  "effect",
  "text",
  "speech-bubble",
  "foreground",
  "unclassified",
] as const);

export const STUDIO_SCENE_LAYER_LIFT_SOURCE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
] as const);

export type StudioSceneLayerLiftSemanticLayerRole =
  (typeof STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES)[number];
export type StudioSceneLayerLiftSourceMimeType =
  (typeof STUDIO_SCENE_LAYER_LIFT_SOURCE_MIME_TYPES)[number];
export type StudioSceneLayerLiftSha256 = `sha256:${string}`;

/**
 * 원본 컨테이너의 MIME을 보존하되 `bytes`는 provider에 넘길 정규화된 straight-alpha
 * sRGB RGBA8 픽셀이다. 따라서 byteLength는 항상 width * height * 4와 같다.
 */
export interface StudioSceneLayerLiftSourceDescriptor {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly mimeType: StudioSceneLayerLiftSourceMimeType;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly pixelFormat: "rgba8-srgb-straight";
  readonly channels: 4;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface StudioSceneLayerLiftSourceBinding {
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
}

export interface StudioSceneLayerLiftRequest {
  readonly kind: typeof STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND;
  readonly version: typeof STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION;
  readonly requestId: string;
  readonly source: StudioSceneLayerLiftSourceDescriptor;
  readonly requestedRoles: readonly StudioSceneLayerLiftSemanticLayerRole[];
}

export type StudioSceneLayerLiftConfidenceBand = "low" | "medium" | "high";

export interface StudioSceneLayerLiftConfidence {
  readonly score: number;
  readonly band: StudioSceneLayerLiftConfidenceBand;
}

export type StudioSceneLayerLiftDiagnosticSeverity =
  | "info"
  | "warning"
  | "error";

export type StudioSceneLayerLiftDiagnosticCode =
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_REGION"
  | "PARTIAL_BOUNDARY"
  | "TRANSPARENT_SOURCE"
  | "PROVIDER_FALLBACK"
  | "INVALID_SOURCE"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_FAILURE"
  | "ABORTED";

export interface StudioSceneLayerLiftDiagnostic {
  readonly code: StudioSceneLayerLiftDiagnosticCode;
  readonly severity: StudioSceneLayerLiftDiagnosticSeverity;
  readonly layerId: string | null;
  readonly message: string;
}

export interface StudioSceneLayerLiftRgbaPlane {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly encoding: "rgba8-srgb-straight";
  readonly channels: 4;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface StudioSceneLayerLiftMaskPlane {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly encoding: "alpha8";
  readonly channels: 1;
  readonly byteLength: number;
  readonly sha256: StudioSceneLayerLiftSha256;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface StudioSceneLayerLiftLayer {
  readonly layerId: string;
  readonly role: StudioSceneLayerLiftSemanticLayerRole;
  /** Back-to-front compositing order; the parser requires a dense 0-based sequence. */
  readonly order: number;
  readonly label: string;
  readonly confidence: StudioSceneLayerLiftConfidence;
  readonly rgba: StudioSceneLayerLiftRgbaPlane;
  readonly mask: StudioSceneLayerLiftMaskPlane;
}

export type StudioSceneLayerLiftProviderOutcome = "success" | "failure";

export interface StudioSceneLayerLiftLocalProviderReceipt {
  readonly kind: typeof STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND;
  readonly version: typeof STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly execution: "local-device";
  readonly networkUsed: false;
  readonly requestId: string;
  readonly sourceSha256: StudioSceneLayerLiftSha256;
  readonly inputByteLength: number;
  readonly outputByteLength: number;
  readonly maskByteLength: number;
  readonly layerCount: number;
  readonly durationMilliseconds: number;
  readonly outcome: StudioSceneLayerLiftProviderOutcome;
  readonly receiptSha256: StudioSceneLayerLiftSha256;
}

export type StudioSceneLayerLiftLocalProviderReceiptUnsigned = Omit<
  StudioSceneLayerLiftLocalProviderReceipt,
  "receiptSha256"
>;

const PROVIDER_RECEIPT_TEXT_ENCODER = new TextEncoder();

export function calculateStudioSceneLayerLiftProviderReceiptSha256(
  receipt: StudioSceneLayerLiftLocalProviderReceiptUnsigned,
): StudioSceneLayerLiftSha256 {
  const canonical = JSON.stringify([
    receipt.kind,
    receipt.version,
    receipt.providerId,
    receipt.providerVersion,
    receipt.execution,
    receipt.networkUsed,
    receipt.requestId,
    receipt.sourceSha256,
    receipt.inputByteLength,
    receipt.outputByteLength,
    receipt.maskByteLength,
    receipt.layerCount,
    receipt.durationMilliseconds,
    receipt.outcome,
  ]);
  return `sha256:${sha256HexPortable(
    PROVIDER_RECEIPT_TEXT_ENCODER.encode(canonical),
  )}`;
}

export type StudioSceneLayerLiftFailureCode =
  | "invalid-request"
  | "unsupported-source"
  | "budget-exceeded"
  | "provider-unavailable"
  | "provider-failed"
  | "aborted";

export interface StudioSceneLayerLiftSuccess {
  readonly kind: typeof STUDIO_SCENE_LAYER_LIFT_RESULT_KIND;
  readonly version: typeof STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION;
  readonly requestId: string;
  readonly status: "success";
  readonly source: StudioSceneLayerLiftSourceBinding;
  readonly layers: readonly StudioSceneLayerLiftLayer[];
  readonly confidence: StudioSceneLayerLiftConfidence;
  readonly diagnostics: readonly StudioSceneLayerLiftDiagnostic[];
  readonly receipt: StudioSceneLayerLiftLocalProviderReceipt;
}

export interface StudioSceneLayerLiftFailure {
  readonly kind: typeof STUDIO_SCENE_LAYER_LIFT_RESULT_KIND;
  readonly version: typeof STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION;
  readonly requestId: string;
  readonly status: "failure";
  readonly source: StudioSceneLayerLiftSourceBinding;
  readonly code: StudioSceneLayerLiftFailureCode;
  readonly retryable: boolean;
  readonly diagnostics: readonly StudioSceneLayerLiftDiagnostic[];
  readonly receipt: StudioSceneLayerLiftLocalProviderReceipt;
}

export type StudioSceneLayerLiftResult =
  | StudioSceneLayerLiftSuccess
  | StudioSceneLayerLiftFailure;

export type StudioSceneLayerLiftParseFailureReason =
  | "invalid-shape"
  | "invalid-value"
  | "unsupported-kind"
  | "unsupported-version"
  | "budget-exceeded"
  | "inconsistent-data";

export type StudioSceneLayerLiftParseResult<Value> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioSceneLayerLiftParseFailureReason;
      /** Stable product-owned diagnostic path; input/provider text is never reflected. */
      readonly detail: string;
    }>;

const SOURCE_KEYS = [
  "sourceId",
  "sourceName",
  "mimeType",
  "width",
  "height",
  "pixelCount",
  "pixelFormat",
  "channels",
  "byteLength",
  "sha256",
  "bytes",
] as const;
const SOURCE_BINDING_KEYS = [
  "sourceId",
  "width",
  "height",
  "pixelCount",
  "byteLength",
  "sha256",
] as const;
const REQUEST_KEYS = [
  "kind",
  "version",
  "requestId",
  "source",
  "requestedRoles",
] as const;
const CONFIDENCE_KEYS = ["score", "band"] as const;
const DIAGNOSTIC_KEYS = ["code", "severity", "layerId", "message"] as const;
const PLANE_KEYS = [
  "width",
  "height",
  "pixelCount",
  "encoding",
  "channels",
  "byteLength",
  "sha256",
  "bytes",
] as const;
const LAYER_KEYS = [
  "layerId",
  "role",
  "order",
  "label",
  "confidence",
  "rgba",
  "mask",
] as const;
const RECEIPT_KEYS = [
  "kind",
  "version",
  "providerId",
  "providerVersion",
  "execution",
  "networkUsed",
  "requestId",
  "sourceSha256",
  "inputByteLength",
  "outputByteLength",
  "maskByteLength",
  "layerCount",
  "durationMilliseconds",
  "outcome",
  "receiptSha256",
] as const;
const SUCCESS_KEYS = [
  "kind",
  "version",
  "requestId",
  "status",
  "source",
  "layers",
  "confidence",
  "diagnostics",
  "receipt",
] as const;
const FAILURE_KEYS = [
  "kind",
  "version",
  "requestId",
  "status",
  "source",
  "code",
  "retryable",
  "diagnostics",
  "receipt",
] as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ROLES = new Set<string>(STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES);
const SOURCE_MIME_TYPES =
  new Set<string>(STUDIO_SCENE_LAYER_LIFT_SOURCE_MIME_TYPES);
const DIAGNOSTIC_CODES = new Set<string>([
  "LOW_CONFIDENCE",
  "AMBIGUOUS_REGION",
  "PARTIAL_BOUNDARY",
  "TRANSPARENT_SOURCE",
  "PROVIDER_FALLBACK",
  "INVALID_SOURCE",
  "BUDGET_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_FAILURE",
  "ABORTED",
]);
const FAILURE_CODES = new Set<string>([
  "invalid-request",
  "unsupported-source",
  "budget-exceeded",
  "provider-unavailable",
  "provider-failed",
  "aborted",
]);
const TRUSTED_SUCCESS_RESULTS = new WeakSet<object>();

type PlainSnapshot = Readonly<Record<string, unknown>>;

class StudioSceneLayerLiftValidationError extends Error {
  readonly reason: StudioSceneLayerLiftParseFailureReason;
  readonly detail: string;

  constructor(
    reason: StudioSceneLayerLiftParseFailureReason,
    detail: string,
  ) {
    super(detail);
    this.name = "StudioSceneLayerLiftValidationError";
    this.reason = reason;
    this.detail = detail;
  }
}

function reject(
  reason: StudioSceneLayerLiftParseFailureReason,
  detail: string,
): never {
  throw new StudioSceneLayerLiftValidationError(reason, detail);
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): PlainSnapshot {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return reject("invalid-shape", `${path}.record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return reject("invalid-shape", `${path}.prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return reject("invalid-shape", `${path}.keys`);
  }
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) {
      return reject("invalid-shape", `${path}.${key}.property`);
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function plainArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  path: string,
): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return reject("invalid-shape", `${path}.array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as
    Record<PropertyKey, PropertyDescriptor | undefined>;
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    return reject("invalid-shape", `${path}.length`);
  }
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number"
    || !Number.isSafeInteger(length)
    || length < minimumLength
    || length > maximumLength
  ) {
    return reject(
      length > maximumLength ? "budget-exceeded" : "invalid-shape",
      `${path}.length`,
    );
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1) {
    return reject("invalid-shape", `${path}.dense`);
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) {
      return reject("invalid-shape", `${path}.dense`);
    }
    copy.push(descriptor.value);
  }
  if (keys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length;
  })) {
    return reject("invalid-shape", `${path}.keys`);
  }
  return Object.freeze(copy);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    return reject(
      typeof value === "number" && Number.isFinite(value) && value > maximum
        ? "budget-exceeded"
        : "invalid-value",
      path,
    );
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters
    || !IDENTIFIER_PATTERN.test(value)
  ) {
    return reject("invalid-value", path);
  }
  return value;
}

function boundedText(
  value: unknown,
  maximumCharacters: number,
  path: string,
): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumCharacters
    || value.trim() !== value
  ) {
    return reject("invalid-value", path);
  }
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 31 || codePoint === 127) {
      return reject("invalid-value", path);
    }
  }
  return value;
}

function sha256(value: unknown, path: string): StudioSceneLayerLiftSha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return reject("invalid-value", path);
  }
  return value as StudioSceneLayerLiftSha256;
}

function verifyByteDigest(
  bytes: Uint8Array<ArrayBuffer>,
  declaredSha256: StudioSceneLayerLiftSha256,
  path: string,
): void {
  const actualSha256 =
    `sha256:${sha256HexPortable(bytes)}` as StudioSceneLayerLiftSha256;
  if (actualSha256 !== declaredSha256) {
    return reject("inconsistent-data", path);
  }
}

function copyBytes(
  value: unknown,
  expectedByteLength: number,
  maximumByteLength: number,
  path: string,
): Uint8Array<ArrayBuffer> {
  if (expectedByteLength > maximumByteLength) {
    return reject("budget-exceeded", `${path}.byteLength`);
  }
  if (
    !(value instanceof Uint8Array)
    || !(value.buffer instanceof ArrayBuffer)
    || value.byteLength !== expectedByteLength
  ) {
    return reject("inconsistent-data", `${path}.bytes`);
  }
  if (Reflect.get(value.buffer, "resizable") === true) {
    return reject("invalid-shape", `${path}.buffer`);
  }
  return new Uint8Array(value);
}

function dimensions(
  input: PlainSnapshot,
  path: string,
): {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
} {
  const width = boundedInteger(
    input.width,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels,
    `${path}.width`,
  );
  const height = boundedInteger(
    input.height,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels,
    `${path}.height`,
  );
  const calculatedPixels = width * height;
  if (
    !Number.isSafeInteger(calculatedPixels)
    || calculatedPixels > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels
  ) {
    return reject("budget-exceeded", `${path}.pixelCount`);
  }
  const pixelCount = boundedInteger(
    input.pixelCount,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels,
    `${path}.pixelCount`,
  );
  if (pixelCount !== calculatedPixels) {
    return reject("inconsistent-data", `${path}.pixelCount`);
  }
  return Object.freeze({ width, height, pixelCount });
}

function parseSourceValue(value: unknown): StudioSceneLayerLiftSourceDescriptor {
  const input = exactRecord(value, SOURCE_KEYS, "source");
  const sourceId = identifier(input.sourceId, "source.sourceId");
  const sourceName = boundedText(
    input.sourceName,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumSourceCharacters,
    "source.sourceName",
  );
  if (
    typeof input.mimeType !== "string"
    || !SOURCE_MIME_TYPES.has(input.mimeType)
  ) {
    return reject("invalid-value", "source.mimeType");
  }
  const { width, height, pixelCount } = dimensions(input, "source");
  if (
    input.pixelFormat !== "rgba8-srgb-straight"
    || input.channels !== 4
  ) {
    return reject("invalid-value", "source.pixelFormat");
  }
  const expectedByteLength = pixelCount * 4;
  const byteLength = boundedInteger(
    input.byteLength,
    4,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumInputBytes,
    "source.byteLength",
  );
  if (byteLength !== expectedByteLength) {
    return reject("inconsistent-data", "source.byteLength");
  }
  const digest = sha256(input.sha256, "source.sha256");
  const bytes = copyBytes(
    input.bytes,
    byteLength,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumInputBytes,
    "source",
  );
  verifyByteDigest(bytes, digest, "source.sha256");
  return Object.freeze({
    sourceId,
    sourceName,
    mimeType: input.mimeType as StudioSceneLayerLiftSourceMimeType,
    width,
    height,
    pixelCount,
    pixelFormat: "rgba8-srgb-straight",
    channels: 4,
    byteLength,
    sha256: digest,
    bytes,
  });
}

function parseSourceBindingValue(
  value: unknown,
): StudioSceneLayerLiftSourceBinding {
  const input = exactRecord(value, SOURCE_BINDING_KEYS, "result.source");
  const sourceId = identifier(input.sourceId, "result.source.sourceId");
  const { width, height, pixelCount } = dimensions(input, "result.source");
  const expectedByteLength = pixelCount * 4;
  const byteLength = boundedInteger(
    input.byteLength,
    4,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumInputBytes,
    "result.source.byteLength",
  );
  if (byteLength !== expectedByteLength) {
    return reject("inconsistent-data", "result.source.byteLength");
  }
  return Object.freeze({
    sourceId,
    width,
    height,
    pixelCount,
    byteLength,
    sha256: sha256(input.sha256, "result.source.sha256"),
  });
}

function confidenceBand(score: number): StudioSceneLayerLiftConfidenceBand {
  if (score < 0.5) return "low";
  if (score < 0.8) return "medium";
  return "high";
}

function parseConfidenceValue(
  value: unknown,
  path: string,
): StudioSceneLayerLiftConfidence {
  const input = exactRecord(value, CONFIDENCE_KEYS, path);
  if (
    typeof input.score !== "number"
    || !Number.isFinite(input.score)
    || input.score < 0
    || input.score > 1
  ) {
    return reject("invalid-value", `${path}.score`);
  }
  const band = confidenceBand(input.score);
  if (input.band !== band) {
    return reject("inconsistent-data", `${path}.band`);
  }
  return Object.freeze({ score: input.score, band });
}

function parseDiagnosticValue(
  value: unknown,
  path: string,
): StudioSceneLayerLiftDiagnostic {
  const input = exactRecord(value, DIAGNOSTIC_KEYS, path);
  if (
    typeof input.code !== "string"
    || !DIAGNOSTIC_CODES.has(input.code)
    || (
      input.severity !== "info"
      && input.severity !== "warning"
      && input.severity !== "error"
    )
  ) {
    return reject("invalid-value", `${path}.code`);
  }
  const layerId = input.layerId === null
    ? null
    : identifier(input.layerId, `${path}.layerId`);
  return Object.freeze({
    code: input.code as StudioSceneLayerLiftDiagnosticCode,
    severity: input.severity,
    layerId,
    message: boundedText(
      input.message,
      STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumDiagnosticMessageCharacters,
      `${path}.message`,
    ),
  });
}

function parseDiagnosticsValue(
  value: unknown,
): readonly StudioSceneLayerLiftDiagnostic[] {
  const input = plainArray(
    value,
    0,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumDiagnostics,
    "result.diagnostics",
  );
  return Object.freeze(
    input.map((diagnostic, index) =>
      parseDiagnosticValue(diagnostic, `result.diagnostics.${index}`)),
  );
}

function parseRgbaPlaneValue(
  value: unknown,
  source: StudioSceneLayerLiftSourceBinding,
  path: string,
): StudioSceneLayerLiftRgbaPlane {
  const input = exactRecord(value, PLANE_KEYS, path);
  const { width, height, pixelCount } = dimensions(input, path);
  if (
    width !== source.width
    || height !== source.height
    || pixelCount !== source.pixelCount
  ) {
    return reject("inconsistent-data", `${path}.dimensions`);
  }
  if (input.encoding !== "rgba8-srgb-straight" || input.channels !== 4) {
    return reject("invalid-value", `${path}.encoding`);
  }
  const expectedByteLength = pixelCount * 4;
  const byteLength = boundedInteger(
    input.byteLength,
    4,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes,
    `${path}.byteLength`,
  );
  if (byteLength !== expectedByteLength) {
    return reject("inconsistent-data", `${path}.byteLength`);
  }
  const digest = sha256(input.sha256, `${path}.sha256`);
  const bytes = copyBytes(
    input.bytes,
    byteLength,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes,
    path,
  );
  verifyByteDigest(bytes, digest, `${path}.sha256`);
  return Object.freeze({
    width,
    height,
    pixelCount,
    encoding: "rgba8-srgb-straight",
    channels: 4,
    byteLength,
    sha256: digest,
    bytes,
  });
}

function parseMaskPlaneValue(
  value: unknown,
  source: StudioSceneLayerLiftSourceBinding,
  path: string,
): StudioSceneLayerLiftMaskPlane {
  const input = exactRecord(value, PLANE_KEYS, path);
  const { width, height, pixelCount } = dimensions(input, path);
  if (
    width !== source.width
    || height !== source.height
    || pixelCount !== source.pixelCount
  ) {
    return reject("inconsistent-data", `${path}.dimensions`);
  }
  if (input.encoding !== "alpha8" || input.channels !== 1) {
    return reject("invalid-value", `${path}.encoding`);
  }
  const byteLength = boundedInteger(
    input.byteLength,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes,
    `${path}.byteLength`,
  );
  if (byteLength !== pixelCount) {
    return reject("inconsistent-data", `${path}.byteLength`);
  }
  const digest = sha256(input.sha256, `${path}.sha256`);
  const bytes = copyBytes(
    input.bytes,
    byteLength,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes,
    path,
  );
  verifyByteDigest(bytes, digest, `${path}.sha256`);
  return Object.freeze({
    width,
    height,
    pixelCount,
    encoding: "alpha8",
    channels: 1,
    byteLength,
    sha256: digest,
    bytes,
  });
}

function parseLayerValue(
  value: unknown,
  source: StudioSceneLayerLiftSourceBinding,
  expectedOrder: number,
): StudioSceneLayerLiftLayer {
  const path = `result.layers.${expectedOrder}`;
  const input = exactRecord(value, LAYER_KEYS, path);
  const layerId = identifier(input.layerId, `${path}.layerId`);
  if (typeof input.role !== "string" || !ROLES.has(input.role)) {
    return reject("invalid-value", `${path}.role`);
  }
  if (input.order !== expectedOrder) {
    return reject("inconsistent-data", `${path}.order`);
  }
  return Object.freeze({
    layerId,
    role: input.role as StudioSceneLayerLiftSemanticLayerRole,
    order: expectedOrder,
    label: boundedText(
      input.label,
      STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerLabelCharacters,
      `${path}.label`,
    ),
    confidence: parseConfidenceValue(
      input.confidence,
      `${path}.confidence`,
    ),
    rgba: parseRgbaPlaneValue(input.rgba, source, `${path}.rgba`),
    mask: parseMaskPlaneValue(input.mask, source, `${path}.mask`),
  });
}

function parseReceiptValue(
  value: unknown,
): StudioSceneLayerLiftLocalProviderReceipt {
  const input = exactRecord(value, RECEIPT_KEYS, "receipt");
  if (
    input.kind !== STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND
  ) {
    return reject("unsupported-kind", "receipt.kind");
  }
  if (input.version !== STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION) {
    return reject("unsupported-version", "receipt.version");
  }
  if (input.execution !== "local-device" || input.networkUsed !== false) {
    return reject("invalid-value", "receipt.locality");
  }
  const providerId = identifier(input.providerId, "receipt.providerId");
  const providerVersion = boundedText(
    input.providerVersion,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumProviderVersionCharacters,
    "receipt.providerVersion",
  );
  const requestId = identifier(input.requestId, "receipt.requestId");
  const sourceSha256 = sha256(input.sourceSha256, "receipt.sourceSha256");
  const inputByteLength = boundedInteger(
    input.inputByteLength,
    4,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumInputBytes,
    "receipt.inputByteLength",
  );
  const outputByteLength = boundedInteger(
    input.outputByteLength,
    0,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes,
    "receipt.outputByteLength",
  );
  const maskByteLength = boundedInteger(
    input.maskByteLength,
    0,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes,
    "receipt.maskByteLength",
  );
  const layerCount = boundedInteger(
    input.layerCount,
    0,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerCount,
    "receipt.layerCount",
  );
  if (
    typeof input.durationMilliseconds !== "number"
    || !Number.isFinite(input.durationMilliseconds)
    || input.durationMilliseconds < 0
    || input.durationMilliseconds
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumDurationMilliseconds
  ) {
    return reject("invalid-value", "receipt.durationMilliseconds");
  }
  if (input.outcome !== "success" && input.outcome !== "failure") {
    return reject("invalid-value", "receipt.outcome");
  }
  if (
    maskByteLength > outputByteLength
    || (
      input.outcome === "success"
      && (layerCount < 1 || outputByteLength < 1 || maskByteLength < 1)
    )
    || (
      input.outcome === "failure"
      && (layerCount !== 0 || outputByteLength !== 0 || maskByteLength !== 0)
    )
  ) {
    return reject("inconsistent-data", "receipt.byteTotals");
  }
  const unsignedReceipt: StudioSceneLayerLiftLocalProviderReceiptUnsigned =
    Object.freeze({
      kind: STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
      version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
      providerId,
      providerVersion,
      execution: "local-device",
      networkUsed: false,
      requestId,
      sourceSha256,
      inputByteLength,
      outputByteLength,
      maskByteLength,
      layerCount,
      durationMilliseconds: input.durationMilliseconds,
      outcome: input.outcome,
    });
  const receiptSha256 = sha256(
    input.receiptSha256,
    "receipt.receiptSha256",
  );
  if (
    receiptSha256
      !== calculateStudioSceneLayerLiftProviderReceiptSha256(unsignedReceipt)
  ) {
    return reject("inconsistent-data", "receipt.receiptSha256");
  }
  return Object.freeze({
    ...unsignedReceipt,
    receiptSha256,
  });
}

function verifyEnvelope(
  input: PlainSnapshot,
  expectedKind: string,
  path: string,
): void {
  if (input.kind !== expectedKind) {
    return reject("unsupported-kind", `${path}.kind`);
  }
  if (input.version !== STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION) {
    return reject("unsupported-version", `${path}.version`);
  }
}

function parseRequestValue(value: unknown): StudioSceneLayerLiftRequest {
  const input = exactRecord(value, REQUEST_KEYS, "request");
  verifyEnvelope(input, STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND, "request");
  const requestId = identifier(input.requestId, "request.requestId");
  const source = parseSourceValue(input.source);
  const rawRoles = plainArray(
    input.requestedRoles,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerCount,
    "request.requestedRoles",
  );
  const requestedRoles: StudioSceneLayerLiftSemanticLayerRole[] = [];
  for (const [index, role] of rawRoles.entries()) {
    if (typeof role !== "string" || !ROLES.has(role)) {
      return reject("invalid-value", `request.requestedRoles.${index}`);
    }
    if (requestedRoles.includes(role as StudioSceneLayerLiftSemanticLayerRole)) {
      return reject("inconsistent-data", "request.requestedRoles.duplicate");
    }
    requestedRoles.push(role as StudioSceneLayerLiftSemanticLayerRole);
  }
  return Object.freeze({
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId,
    source,
    requestedRoles: Object.freeze(requestedRoles),
  });
}

function verifyResultBindings(
  requestId: string,
  source: StudioSceneLayerLiftSourceBinding,
  receipt: StudioSceneLayerLiftLocalProviderReceipt,
): void {
  if (
    receipt.requestId !== requestId
    || receipt.sourceSha256 !== source.sha256
    || receipt.inputByteLength !== source.byteLength
  ) {
    return reject("inconsistent-data", "result.receipt.binding");
  }
}

function parseSuccessValue(
  input: PlainSnapshot,
): StudioSceneLayerLiftSuccess {
  const requestId = identifier(input.requestId, "result.requestId");
  const source = parseSourceBindingValue(input.source);
  const rawLayers = plainArray(
    input.layers,
    1,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerCount,
    "result.layers",
  );
  // Every v1 layer is contractually a full-size RGBA8 plane plus one full-size alpha8 mask.
  // Reject aggregate work before parseLayerValue defensively copies any provider-owned buffer.
  const expectedMaskByteLength = source.pixelCount * rawLayers.length;
  const expectedOutputByteLength = source.pixelCount * 5 * rawLayers.length;
  if (
    !Number.isSafeInteger(expectedMaskByteLength)
    || !Number.isSafeInteger(expectedOutputByteLength)
    || expectedMaskByteLength > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes
    || expectedOutputByteLength > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes
  ) {
    return reject("budget-exceeded", "result.layers.byteTotals");
  }
  const layers = rawLayers.map((layer, index) =>
    parseLayerValue(layer, source, index));
  const layerIds = new Set(layers.map(({ layerId }) => layerId));
  if (layerIds.size !== layers.length) {
    return reject("inconsistent-data", "result.layers.layerId");
  }
  let outputByteLength = 0;
  let maskByteLength = 0;
  for (const layer of layers) {
    outputByteLength += layer.rgba.byteLength + layer.mask.byteLength;
    maskByteLength += layer.mask.byteLength;
    if (
      outputByteLength > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumOutputBytes
      || maskByteLength > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumMaskBytes
    ) {
      return reject("budget-exceeded", "result.layers.byteTotals");
    }
  }
  const confidence = parseConfidenceValue(
    input.confidence,
    "result.confidence",
  );
  const diagnostics = parseDiagnosticsValue(input.diagnostics);
  if (
    diagnostics.some(({ severity }) => severity === "error")
    || diagnostics.some(({ layerId }) =>
      layerId !== null && !layerIds.has(layerId))
  ) {
    return reject("inconsistent-data", "result.diagnostics");
  }
  const receipt = parseReceiptValue(input.receipt);
  verifyResultBindings(requestId, source, receipt);
  if (
    receipt.outcome !== "success"
    || receipt.layerCount !== layers.length
    || receipt.outputByteLength !== outputByteLength
    || receipt.maskByteLength !== maskByteLength
  ) {
    return reject("inconsistent-data", "result.receipt.totals");
  }
  return Object.freeze({
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId,
    status: "success",
    source,
    layers: Object.freeze(layers),
    confidence,
    diagnostics,
    receipt,
  });
}

function parseFailureValue(
  input: PlainSnapshot,
): StudioSceneLayerLiftFailure {
  const requestId = identifier(input.requestId, "result.requestId");
  const source = parseSourceBindingValue(input.source);
  if (typeof input.code !== "string" || !FAILURE_CODES.has(input.code)) {
    return reject("invalid-value", "result.code");
  }
  if (typeof input.retryable !== "boolean") {
    return reject("invalid-value", "result.retryable");
  }
  const diagnostics = parseDiagnosticsValue(input.diagnostics);
  if (
    !diagnostics.some(({ severity }) => severity === "error")
    || diagnostics.some(({ layerId }) => layerId !== null)
  ) {
    return reject("inconsistent-data", "result.diagnostics");
  }
  const receipt = parseReceiptValue(input.receipt);
  verifyResultBindings(requestId, source, receipt);
  if (receipt.outcome !== "failure") {
    return reject("inconsistent-data", "result.receipt.outcome");
  }
  return Object.freeze({
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId,
    status: "failure",
    source,
    code: input.code as StudioSceneLayerLiftFailureCode,
    retryable: input.retryable,
    diagnostics,
    receipt,
  });
}

function parseResultValue(value: unknown): StudioSceneLayerLiftResult {
  const discriminator = exactRecord(
    value,
    typeof value === "object"
      && value !== null
      && Object.getOwnPropertyDescriptor(value, "status")?.value === "success"
      ? SUCCESS_KEYS
      : FAILURE_KEYS,
    "result",
  );
  verifyEnvelope(discriminator, STUDIO_SCENE_LAYER_LIFT_RESULT_KIND, "result");
  if (discriminator.status === "success") {
    return parseSuccessValue(discriminator);
  }
  if (discriminator.status === "failure") {
    return parseFailureValue(discriminator);
  }
  return reject("invalid-value", "result.status");
}

function parsed<Value>(value: Value): StudioSceneLayerLiftParseResult<Value> {
  return Object.freeze({ ok: true, value });
}

function parseFailure(
  error: unknown,
): StudioSceneLayerLiftParseResult<never> {
  if (error instanceof StudioSceneLayerLiftValidationError) {
    return Object.freeze({
      ok: false,
      reason: error.reason,
      detail: error.detail,
    });
  }
  return Object.freeze({
    ok: false,
    reason: "invalid-shape",
    detail: "contract.unreadable",
  });
}

export function parseStudioSceneLayerLiftSourceDescriptor(
  value: unknown,
): StudioSceneLayerLiftParseResult<StudioSceneLayerLiftSourceDescriptor> {
  try {
    return parsed(parseSourceValue(value));
  } catch (error) {
    return parseFailure(error);
  }
}

export function parseStudioSceneLayerLiftRequest(
  value: unknown,
): StudioSceneLayerLiftParseResult<StudioSceneLayerLiftRequest> {
  try {
    return parsed(parseRequestValue(value));
  } catch (error) {
    return parseFailure(error);
  }
}

export function parseStudioSceneLayerLiftLocalProviderReceipt(
  value: unknown,
): StudioSceneLayerLiftParseResult<StudioSceneLayerLiftLocalProviderReceipt> {
  try {
    return parsed(parseReceiptValue(value));
  } catch (error) {
    return parseFailure(error);
  }
}

export function parseStudioSceneLayerLiftResult(
  value: unknown,
): StudioSceneLayerLiftParseResult<StudioSceneLayerLiftResult> {
  try {
    const result = parseResultValue(value);
    if (result.status === "success") {
      TRUSTED_SUCCESS_RESULTS.add(result);
    }
    return parsed(result);
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * Returns true only for the exact immutable success snapshot produced by
 * `parseStudioSceneLayerLiftResult` in this module instance.
 *
 * Trust is deliberately identity-bound and does not survive object spreading,
 * serialization, or structured cloning. Callers crossing such a boundary must
 * strictly parse the received value again.
 */
export function isStudioSceneLayerLiftTrustedSuccess(
  value: unknown,
): value is StudioSceneLayerLiftSuccess {
  return (
    typeof value === "object"
    && value !== null
    && TRUSTED_SUCCESS_RESULTS.has(value)
  );
}
