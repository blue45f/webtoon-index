import {
  parseStudioCodecExecutionRequest,
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProviderFailureCode,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";

export const STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION =
  1 as const;

export type StudioFirstPartyRasterCodecWorkerFailureCode =
  | "budget-exceeded"
  | "execution-failed"
  | "invalid-request"
  | "protocol-error"
  | "provider-failure"
  | "unsupported-direction"
  | "unsupported-format"
  | "unsupported-profile"
  | "unsupported-version";

export interface StudioFirstPartyRasterCodecWorkerRunMessage {
  readonly type: "studio-first-party-raster-codec/run";
  readonly version:
    typeof STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioCodecExecutionRequest;
  /** A fixed, Worker-owned buffer. The client transfers a private caller snapshot. */
  readonly inputBytes: ArrayBuffer;
}

export interface StudioFirstPartyRasterCodecWorkerSuccessMessage {
  readonly type: "studio-first-party-raster-codec/success";
  readonly version:
    typeof STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  /** Exact provider output ownership is transferred back to the client. */
  readonly bytes: ArrayBuffer;
  readonly receipt: StudioCodecExecutionReceipt;
}

export interface StudioFirstPartyRasterCodecWorkerFailureMessage {
  readonly type: "studio-first-party-raster-codec/failure";
  readonly version:
    typeof STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly error: {
    readonly code: StudioFirstPartyRasterCodecWorkerFailureCode;
    /**
     * Provider failures retain only the stable product-owned code. Raw Error names, messages,
     * stacks, paths, and codec payloads never cross the Worker boundary.
     */
    readonly providerCode: StudioCodecProviderFailureCode | null;
  };
}

export type StudioFirstPartyRasterCodecWorkerResponseMessage =
  | StudioFirstPartyRasterCodecWorkerFailureMessage
  | StudioFirstPartyRasterCodecWorkerSuccessMessage;

export interface StudioFirstPartyRasterCodecWorkerExpectedResponse {
  readonly requestId: number;
  readonly request: StudioCodecExecutionRequest;
  readonly inputByteLength: number;
  readonly inputSha256: `sha256:${string}`;
}

export interface StudioFirstPartyRasterCodecWorkerResult {
  readonly bytes: Uint8Array;
  readonly receipt: StudioCodecExecutionReceipt;
}

const RUN_KEYS = [
  "type",
  "version",
  "requestId",
  "request",
  "inputBytes",
] as const;
const SUCCESS_KEYS = [
  "type",
  "version",
  "requestId",
  "bytes",
  "receipt",
] as const;
const FAILURE_KEYS = [
  "type",
  "version",
  "requestId",
  "error",
] as const;
const FAILURE_ERROR_KEYS = ["code", "providerCode"] as const;
const REQUEST_KEYS = [
  "schemaVersion",
  "direction",
  "format",
  "profile",
  "version",
  "mimeType",
  "extension",
  "allowedModes",
  "requireDeterministic",
  "maxInputBytes",
  "maxOutputBytes",
] as const;
const RECEIPT_KEYS = [
  "schemaVersion",
  "kind",
  "providerId",
  "mode",
  "direction",
  "format",
  "profile",
  "version",
  "mimeType",
  "extension",
  "deterministic",
  "input",
  "output",
  "licenseGrant",
  "officialClaims",
] as const;
const BYTE_RECEIPT_KEYS = ["byteLength", "sha256"] as const;
const LICENSE_GRANT_KEYS = ["id", "scope", "expiresAt"] as const;
const OFFICIAL_CLAIM_KEYS = [
  "externalAttestationAccepted",
  "officialCodec",
  "certified",
  "trademarkAuthorized",
] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const FAILURE_CODES = new Set<StudioFirstPartyRasterCodecWorkerFailureCode>([
  "budget-exceeded",
  "execution-failed",
  "invalid-request",
  "protocol-error",
  "provider-failure",
  "unsupported-direction",
  "unsupported-format",
  "unsupported-profile",
  "unsupported-version",
]);

const PROVIDER_FAILURE_CODES = new Set<StudioCodecProviderFailureCode>([
  "ambiguous-provider",
  "input-budget-exceeded",
  "input-mutated",
  "invalid-manifest",
  "invalid-provider",
  "invalid-registry",
  "invalid-request",
  "license-expired",
  "no-provider",
  "output-budget-exceeded",
  "provider-result-invalid",
  "provider-runtime-error",
  "receipt-mismatch",
]);

const PROVIDER_BY_FORMAT = new Map(
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.map((provider) => [
    provider.manifest.format,
    provider,
  ]),
);

export class StudioFirstPartyRasterCodecWorkerProtocolError extends Error {
  readonly code: Exclude<
    StudioFirstPartyRasterCodecWorkerFailureCode,
    "execution-failed" | "provider-failure"
  >;

  constructor(
    code: StudioFirstPartyRasterCodecWorkerProtocolError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyRasterCodecWorkerProtocolError";
    this.code = code;
  }
}

function fail(
  code: StudioFirstPartyRasterCodecWorkerProtocolError["code"],
  message: string,
): never {
  throw new StudioFirstPartyRasterCodecWorkerProtocolError(code, message);
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some(
        (key) => typeof key !== "string" || !keys.includes(key),
      )
    ) {
      return null;
    }
    const record: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return null;
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function exactDenseArray(value: unknown): readonly unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1
      || !ownKeys.includes("length")
    ) {
      return null;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

function positiveRequestId(value: unknown): value is number {
  return (
    Number.isSafeInteger(value)
    && (value as number) > 0
  );
}

function isProviderFailureCode(
  value: unknown,
): value is StudioCodecProviderFailureCode {
  return (
    typeof value === "string"
    && PROVIDER_FAILURE_CODES.has(value as StudioCodecProviderFailureCode)
  );
}

function protocolCode(error: unknown): StudioFirstPartyRasterCodecWorkerFailureCode {
  return error instanceof StudioFirstPartyRasterCodecWorkerProtocolError
    ? error.code
    : "protocol-error";
}

async function hash(
  bytes: Uint8Array,
): Promise<`sha256:${string}` | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !(bytes.buffer instanceof ArrayBuffer)) return null;
    const digest = new Uint8Array(
      await subtle.digest("SHA-256", bytes.buffer),
    );
    return `sha256:${[...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return null;
  }
}

/**
 * Narrows the generic codec request to the exact first-party raster provider profile.
 *
 * Unsupported identity fields receive explicit codes; malformed budgets, modes, MIME aliases, and
 * extension aliases are rejected as invalid rather than being silently normalized.
 */
export function normalizeStudioFirstPartyRasterCodecWorkerRequest(
  value: unknown,
): StudioCodecExecutionRequest {
  const record = ownDataRecord(value, REQUEST_KEYS);
  if (!record) {
    return fail(
      "invalid-request",
      "First-party raster codec request must use the exact request envelope.",
    );
  }
  if (record.direction !== "decode" && record.direction !== "encode") {
    return fail(
      "unsupported-direction",
      "First-party raster codec direction is not supported.",
    );
  }
  if (
    typeof record.format !== "string"
    || !STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS.includes(
      record.format as never,
    )
  ) {
    return fail(
      "unsupported-format",
      "First-party raster codec format is not supported.",
    );
  }
  if (record.profile !== STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE) {
    return fail(
      "unsupported-profile",
      "First-party raster codec profile is not supported.",
    );
  }
  if (record.version !== STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION) {
    return fail(
      "unsupported-version",
      "First-party raster codec version is not supported.",
    );
  }

  let request: StudioCodecExecutionRequest | null;
  try {
    request = parseStudioCodecExecutionRequest(value);
  } catch {
    request = null;
  }
  const provider = PROVIDER_BY_FORMAT.get(record.format);
  if (
    !request
    || !provider
    || request.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || request.allowedModes.length !== 1
    || request.allowedModes[0] !== "public-clean-room"
    || request.requireDeterministic !== true
    || request.mimeType !== provider.manifest.mimeTypes[0]
    || request.extension !== provider.manifest.extensions[0]
    || request.maxInputBytes > provider.manifest.maxInputBytes
    || request.maxOutputBytes > provider.manifest.maxOutputBytes
  ) {
    return fail(
      "invalid-request",
      "First-party raster codec request does not match its provider manifest.",
    );
  }
  return request;
}

export function createStudioFirstPartyRasterCodecWorkerRunMessage(
  requestId: number,
  requestValue: unknown,
  inputValue: unknown,
): StudioFirstPartyRasterCodecWorkerRunMessage {
  if (!positiveRequestId(requestId)) {
    return fail(
      "protocol-error",
      "First-party raster codec requestId must be a positive safe integer.",
    );
  }
  const request = normalizeStudioFirstPartyRasterCodecWorkerRequest(
    requestValue,
  );
  if (!(inputValue instanceof Uint8Array)) {
    return fail(
      "invalid-request",
      "First-party raster codec input must be a Uint8Array.",
    );
  }
  if (
    inputValue.byteLength > request.maxInputBytes
    || inputValue.byteLength
      > (
        PROVIDER_BY_FORMAT.get(request.format)?.manifest.maxInputBytes
        ?? 0
      )
  ) {
    return fail(
      "budget-exceeded",
      "First-party raster codec input exceeds the request budget.",
    );
  }
  const inputBytes = Uint8Array.from(inputValue).buffer;
  return Object.freeze({
    type: "studio-first-party-raster-codec/run",
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
    requestId,
    request,
    inputBytes,
  });
}

export function parseStudioFirstPartyRasterCodecWorkerRunMessage(
  value: unknown,
): StudioFirstPartyRasterCodecWorkerRunMessage {
  const record = ownDataRecord(value, RUN_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-raster-codec/run"
    || record.version
      !== STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || !(record.inputBytes instanceof ArrayBuffer)
  ) {
    return fail(
      "protocol-error",
      "First-party raster codec Worker message is malformed.",
    );
  }
  const request = normalizeStudioFirstPartyRasterCodecWorkerRequest(
    record.request,
  );
  const provider = PROVIDER_BY_FORMAT.get(request.format);
  if (
    !provider
    || record.inputBytes.byteLength > request.maxInputBytes
    || record.inputBytes.byteLength > provider.manifest.maxInputBytes
  ) {
    return fail(
      "budget-exceeded",
      "First-party raster codec Worker input exceeds the request budget.",
    );
  }
  return Object.freeze({
    type: "studio-first-party-raster-codec/run",
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
    requestId: record.requestId,
    request,
    inputBytes: record.inputBytes,
  });
}

export function studioFirstPartyRasterCodecWorkerResponseCorrelation(
  value: unknown,
): number | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
    return descriptor
      && "value" in descriptor
      && positiveRequestId(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function studioFirstPartyRasterCodecWorkerRequestTransfers(
  message: StudioFirstPartyRasterCodecWorkerRunMessage,
): Transferable[] {
  const parsed = parseStudioFirstPartyRasterCodecWorkerRunMessage(message);
  return [parsed.inputBytes];
}

export function createStudioFirstPartyRasterCodecWorkerFailureMessage(
  requestId: number,
  code: StudioFirstPartyRasterCodecWorkerFailureCode,
  providerCode: StudioCodecProviderFailureCode | null = null,
): StudioFirstPartyRasterCodecWorkerFailureMessage {
  if (
    !positiveRequestId(requestId)
    || !FAILURE_CODES.has(code)
    || (
      code === "provider-failure"
        ? !isProviderFailureCode(providerCode)
        : providerCode !== null
    )
  ) {
    return fail(
      "protocol-error",
      "First-party raster codec Worker failure envelope is invalid.",
    );
  }
  return Object.freeze({
    type: "studio-first-party-raster-codec/failure",
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
    requestId,
    error: Object.freeze({ code, providerCode }),
  });
}

export function createStudioFirstPartyRasterCodecWorkerProtocolFailure(
  requestId: number,
  error: unknown,
): StudioFirstPartyRasterCodecWorkerFailureMessage {
  return createStudioFirstPartyRasterCodecWorkerFailureMessage(
    requestId,
    protocolCode(error),
  );
}

export function isStudioFirstPartyRasterCodecWorkerFailureMessage(
  value: unknown,
): value is StudioFirstPartyRasterCodecWorkerFailureMessage {
  const record = ownDataRecord(value, FAILURE_KEYS);
  const error = record
    ? ownDataRecord(record.error, FAILURE_ERROR_KEYS)
    : null;
  if (
    !record
    || !error
    || record.type !== "studio-first-party-raster-codec/failure"
    || record.version
      !== STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || typeof error.code !== "string"
    || !FAILURE_CODES.has(
      error.code as StudioFirstPartyRasterCodecWorkerFailureCode,
    )
  ) {
    return false;
  }
  return error.code === "provider-failure"
    ? isProviderFailureCode(error.providerCode)
    : error.providerCode === null;
}

function canonicalReceipt(
  value: unknown,
  expected: StudioFirstPartyRasterCodecWorkerExpectedResponse,
  outputByteLength: number,
  outputSha256: `sha256:${string}`,
): StudioCodecExecutionReceipt | null {
  const receipt = ownDataRecord(value, RECEIPT_KEYS);
  const input = receipt
    ? ownDataRecord(receipt.input, BYTE_RECEIPT_KEYS)
    : null;
  const output = receipt
    ? ownDataRecord(receipt.output, BYTE_RECEIPT_KEYS)
    : null;
  const licenseGrant = receipt
    ? ownDataRecord(receipt.licenseGrant, LICENSE_GRANT_KEYS)
    : null;
  const officialClaims = receipt
    ? ownDataRecord(receipt.officialClaims, OFFICIAL_CLAIM_KEYS)
    : null;
  const scope = licenseGrant
    ? exactDenseArray(licenseGrant.scope)
    : null;
  const provider = PROVIDER_BY_FORMAT.get(expected.request.format);
  if (
    !receipt
    || !input
    || !output
    || !licenseGrant
    || !officialClaims
    || !scope
    || !provider
    || receipt.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || receipt.kind !== "toonspectrum-codec-provider-execution"
    || receipt.providerId !== provider.manifest.providerId
    || receipt.mode !== "public-clean-room"
    || receipt.direction !== expected.request.direction
    || receipt.format !== expected.request.format
    || receipt.profile !== expected.request.profile
    || receipt.version !== expected.request.version
    || receipt.mimeType !== expected.request.mimeType
    || receipt.extension !== expected.request.extension
    || receipt.deterministic !== true
    || input.byteLength !== expected.inputByteLength
    || !Number.isSafeInteger(input.byteLength)
    || typeof input.sha256 !== "string"
    || !SHA256.test(input.sha256)
    || input.sha256 !== expected.inputSha256
    || output.byteLength !== outputByteLength
    || !Number.isSafeInteger(output.byteLength)
    || typeof output.sha256 !== "string"
    || !SHA256.test(output.sha256)
    || output.sha256 !== outputSha256
    || licenseGrant.id !== provider.manifest.licenseGrant.id
    || licenseGrant.expiresAt
      !== provider.manifest.licenseGrant.expiresAt
    || scope.length !== provider.manifest.licenseGrant.scope.length
    || scope.some(
      (entry, index) =>
        entry !== provider.manifest.licenseGrant.scope[index],
    )
    || officialClaims.externalAttestationAccepted !== false
    || officialClaims.officialCodec !== false
    || officialClaims.certified !== false
    || officialClaims.trademarkAuthorized !== false
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    kind: "toonspectrum-codec-provider-execution",
    providerId: provider.manifest.providerId,
    mode: "public-clean-room",
    direction: expected.request.direction,
    format: expected.request.format,
    profile: expected.request.profile,
    version: expected.request.version,
    mimeType: expected.request.mimeType,
    extension: expected.request.extension,
    deterministic: true,
    input: Object.freeze({
      byteLength: expected.inputByteLength,
      sha256: expected.inputSha256,
    }),
    output: Object.freeze({
      byteLength: outputByteLength,
      sha256: outputSha256,
    }),
    licenseGrant: Object.freeze({
      id: provider.manifest.licenseGrant.id,
      scope: Object.freeze([...provider.manifest.licenseGrant.scope]),
      expiresAt: provider.manifest.licenseGrant.expiresAt,
    }),
    officialClaims: Object.freeze({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    }),
  });
}

export async function parseStudioFirstPartyRasterCodecWorkerSuccessMessage(
  value: unknown,
  expected: StudioFirstPartyRasterCodecWorkerExpectedResponse,
): Promise<StudioFirstPartyRasterCodecWorkerResult | null> {
  const record = ownDataRecord(value, SUCCESS_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-raster-codec/success"
    || record.version
      !== STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION
    || record.requestId !== expected.requestId
    || !(record.bytes instanceof ArrayBuffer)
    || record.bytes.byteLength < 1
    || record.bytes.byteLength > expected.request.maxOutputBytes
  ) {
    return null;
  }
  const bytes = new Uint8Array(record.bytes);
  const outputSha256 = await hash(bytes);
  if (!outputSha256) return null;
  const receipt = canonicalReceipt(
    record.receipt,
    expected,
    record.bytes.byteLength,
    outputSha256,
  );
  if (!receipt) return null;
  return Object.freeze({
    bytes,
    receipt,
  });
}

export function studioFirstPartyRasterCodecWorkerSuccessTransfers(
  message: StudioFirstPartyRasterCodecWorkerSuccessMessage,
): Transferable[] {
  const record = ownDataRecord(message, SUCCESS_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-raster-codec/success"
    || record.version
      !== STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || !(record.bytes instanceof ArrayBuffer)
  ) {
    return fail(
      "protocol-error",
      "First-party raster codec Worker success transfer is invalid.",
    );
  }
  return [record.bytes];
}
