import {
  parseStudioCodecExecutionRequest,
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProviderFailureCode,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  STUDIO_WILL_V1_OPC_EXTENSION,
  STUDIO_WILL_V1_OPC_MEDIA_TYPE,
  STUDIO_WILL_V1_OPC_PROFILE,
} from "./studio-will-v1-opc-interchange";

export const
STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION =
  1 as const;

export type StudioFirstPartyWillV1DocumentCodecWorkerFailureCode =
  | "budget-exceeded"
  | "execution-failed"
  | "invalid-request"
  | "protocol-error"
  | "provider-failure"
  | "unsupported-direction"
  | "unsupported-format"
  | "unsupported-profile"
  | "unsupported-version";

export interface StudioFirstPartyWillV1DocumentCodecWorkerRunMessage {
  readonly type: "studio-first-party-will-v1-document-codec/run";
  readonly version:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioCodecExecutionRequest;
  /** Worker-owned input snapshot. The caller's buffer is never transferred. */
  readonly inputBytes: ArrayBuffer;
}

export interface StudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage {
  readonly type: "studio-first-party-will-v1-document-codec/success";
  readonly version:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  /** Exact provider output ownership is transferred to the client. */
  readonly bytes: ArrayBuffer;
  readonly receipt: StudioCodecExecutionReceipt;
}

export interface StudioFirstPartyWillV1DocumentCodecWorkerFailureMessage {
  readonly type: "studio-first-party-will-v1-document-codec/failure";
  readonly version:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly error: {
    readonly code: StudioFirstPartyWillV1DocumentCodecWorkerFailureCode;
    /**
     * Only product-owned codes cross the boundary. Raw provider errors, stacks, paths, and
     * container payloads remain inside the Worker.
     */
    readonly providerCode: StudioCodecProviderFailureCode | null;
  };
}

export type StudioFirstPartyWillV1DocumentCodecWorkerResponseMessage =
  | StudioFirstPartyWillV1DocumentCodecWorkerFailureMessage
  | StudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage;

export interface StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse {
  readonly requestId: number;
  readonly request: StudioCodecExecutionRequest;
  readonly inputByteLength: number;
  readonly inputSha256: `sha256:${string}`;
}

export interface StudioFirstPartyWillV1DocumentCodecWorkerResult {
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

const FAILURE_CODES =
  new Set<StudioFirstPartyWillV1DocumentCodecWorkerFailureCode>([
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
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER = STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER;

export class StudioFirstPartyWillV1DocumentCodecWorkerProtocolError
  extends Error {
  readonly code: Exclude<
    StudioFirstPartyWillV1DocumentCodecWorkerFailureCode,
    "execution-failed" | "provider-failure"
  >;

  constructor(
    code: StudioFirstPartyWillV1DocumentCodecWorkerProtocolError["code"],
    message: string,
  ) {
    super(message);
    this.name =
      "StudioFirstPartyWillV1DocumentCodecWorkerProtocolError";
    this.code = code;
  }
}

function fail(
  code: StudioFirstPartyWillV1DocumentCodecWorkerProtocolError["code"],
  message: string,
): never {
  throw new StudioFirstPartyWillV1DocumentCodecWorkerProtocolError(
    code,
    message,
  );
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
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isProviderFailureCode(
  value: unknown,
): value is StudioCodecProviderFailureCode {
  return (
    typeof value === "string"
    && PROVIDER_FAILURE_CODES.has(value as StudioCodecProviderFailureCode)
  );
}

function protocolCode(
  error: unknown,
): StudioFirstPartyWillV1DocumentCodecWorkerFailureCode {
  return error
    instanceof StudioFirstPartyWillV1DocumentCodecWorkerProtocolError
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
 * Narrows the generic provider request to the exact built-in bounded WILL v1 Annex B manifest.
 */
export function normalizeStudioFirstPartyWillV1DocumentCodecWorkerRequest(
  value: unknown,
): StudioCodecExecutionRequest {
  const record = ownDataRecord(value, REQUEST_KEYS);
  if (!record) {
    return fail(
      "invalid-request",
      "First-party WILL v1 document request must use the exact request envelope.",
    );
  }
  if (record.direction !== "decode" && record.direction !== "encode") {
    return fail(
      "unsupported-direction",
      "First-party WILL v1 document direction is not supported.",
    );
  }
  if (record.format !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT) {
    return fail(
      "unsupported-format",
      "First-party WILL v1 document format is not supported.",
    );
  }
  if (record.profile !== STUDIO_WILL_V1_OPC_PROFILE) {
    return fail(
      "unsupported-profile",
      "First-party WILL v1 document profile is not supported.",
    );
  }
  if (record.version !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION) {
    return fail(
      "unsupported-version",
      "First-party WILL v1 document version is not supported.",
    );
  }

  let request: StudioCodecExecutionRequest | null;
  try {
    request = parseStudioCodecExecutionRequest(value);
  } catch {
    request = null;
  }
  if (
    !request
    || request.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || request.allowedModes.length !== 1
    || request.allowedModes[0] !== "public-clean-room"
    || request.requireDeterministic !== true
    || request.mimeType !== STUDIO_WILL_V1_OPC_MEDIA_TYPE
    || request.extension !== STUDIO_WILL_V1_OPC_EXTENSION
    || request.maxInputBytes !== PROVIDER.manifest.maxInputBytes
    || request.maxOutputBytes !== PROVIDER.manifest.maxOutputBytes
  ) {
    return fail(
      "invalid-request",
      "First-party WILL v1 document request does not match the built-in provider manifest.",
    );
  }
  return request;
}

export function createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
  requestId: number,
  requestValue: unknown,
  inputValue: unknown,
): StudioFirstPartyWillV1DocumentCodecWorkerRunMessage {
  if (!positiveRequestId(requestId)) {
    return fail(
      "protocol-error",
      "First-party WILL v1 document requestId must be a positive safe integer.",
    );
  }
  const request =
    normalizeStudioFirstPartyWillV1DocumentCodecWorkerRequest(requestValue);
  if (!(inputValue instanceof Uint8Array)) {
    return fail(
      "invalid-request",
      "First-party WILL v1 document input must be a Uint8Array.",
    );
  }
  if (
    inputValue.byteLength < 1
    || inputValue.byteLength > request.maxInputBytes
    || inputValue.byteLength > PROVIDER.manifest.maxInputBytes
  ) {
    return fail(
      "budget-exceeded",
      "First-party WILL v1 document input exceeds the request budget.",
    );
  }
  const inputBytes = Uint8Array.from(inputValue).buffer;
  return Object.freeze({
    type: "studio-first-party-will-v1-document-codec/run",
    version:
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
    requestId,
    request,
    inputBytes,
  });
}

export function parseStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
  value: unknown,
): StudioFirstPartyWillV1DocumentCodecWorkerRunMessage {
  const record = ownDataRecord(value, RUN_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-will-v1-document-codec/run"
    || record.version
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || !(record.inputBytes instanceof ArrayBuffer)
  ) {
    return fail(
      "protocol-error",
      "First-party WILL v1 document Worker message is malformed.",
    );
  }
  const request =
    normalizeStudioFirstPartyWillV1DocumentCodecWorkerRequest(record.request);
  if (
    record.inputBytes.byteLength < 1
    || record.inputBytes.byteLength > request.maxInputBytes
    || record.inputBytes.byteLength > PROVIDER.manifest.maxInputBytes
  ) {
    return fail(
      "budget-exceeded",
      "First-party WILL v1 document Worker input exceeds the request budget.",
    );
  }
  return Object.freeze({
    type: "studio-first-party-will-v1-document-codec/run",
    version:
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
    requestId: record.requestId,
    request,
    inputBytes: record.inputBytes,
  });
}

export function studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation(
  value: unknown,
): number | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
    return (
      descriptor
      && "value" in descriptor
      && positiveRequestId(descriptor.value)
    )
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers(
  message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
): Transferable[] {
  const parsed =
    parseStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(message);
  return [parsed.inputBytes];
}

export function createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
  requestId: number,
  code: StudioFirstPartyWillV1DocumentCodecWorkerFailureCode,
  providerCode: StudioCodecProviderFailureCode | null = null,
): StudioFirstPartyWillV1DocumentCodecWorkerFailureMessage {
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
      "First-party WILL v1 document Worker failure envelope is invalid.",
    );
  }
  return Object.freeze({
    type: "studio-first-party-will-v1-document-codec/failure",
    version:
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
    requestId,
    error: Object.freeze({ code, providerCode }),
  });
}

export function createStudioFirstPartyWillV1DocumentCodecWorkerProtocolFailure(
  requestId: number,
  error: unknown,
): StudioFirstPartyWillV1DocumentCodecWorkerFailureMessage {
  return createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
    requestId,
    protocolCode(error),
  );
}

export function isStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
  value: unknown,
): value is StudioFirstPartyWillV1DocumentCodecWorkerFailureMessage {
  const record = ownDataRecord(value, FAILURE_KEYS);
  const error = record
    ? ownDataRecord(record.error, FAILURE_ERROR_KEYS)
    : null;
  if (
    !record
    || !error
    || record.type !== "studio-first-party-will-v1-document-codec/failure"
    || record.version
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || typeof error.code !== "string"
    || !FAILURE_CODES.has(
      error.code as StudioFirstPartyWillV1DocumentCodecWorkerFailureCode,
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
  expected: StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse,
  outputBytes: Uint8Array,
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
  if (
    !receipt
    || !input
    || !output
    || !licenseGrant
    || !officialClaims
    || !scope
    || receipt.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || receipt.kind !== "toonspectrum-codec-provider-execution"
    || receipt.providerId !== PROVIDER.manifest.providerId
    || receipt.mode !== PROVIDER.manifest.mode
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
    || output.byteLength !== outputBytes.byteLength
    || !Number.isSafeInteger(output.byteLength)
    || output.sha256 !== outputSha256
    || typeof output.sha256 !== "string"
    || !SHA256.test(output.sha256)
    || licenseGrant.id !== PROVIDER.manifest.licenseGrant.id
    || licenseGrant.expiresAt
      !== PROVIDER.manifest.licenseGrant.expiresAt
    || scope.length !== PROVIDER.manifest.licenseGrant.scope.length
    || scope.some(
      (entry, index) =>
        entry !== PROVIDER.manifest.licenseGrant.scope[index],
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
    providerId: PROVIDER.manifest.providerId,
    mode: PROVIDER.manifest.mode,
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
      byteLength: outputBytes.byteLength,
      sha256: outputSha256,
    }),
    licenseGrant: Object.freeze({
      id: PROVIDER.manifest.licenseGrant.id,
      scope: Object.freeze([...PROVIDER.manifest.licenseGrant.scope]),
      expiresAt: PROVIDER.manifest.licenseGrant.expiresAt,
    }),
    officialClaims: Object.freeze({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    }),
  });
}

export async function
parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage(
  value: unknown,
  expected: StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse,
): Promise<StudioFirstPartyWillV1DocumentCodecWorkerResult | null> {
  const record = ownDataRecord(value, SUCCESS_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-will-v1-document-codec/success"
    || record.version
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION
    || record.requestId !== expected.requestId
    || !(record.bytes instanceof ArrayBuffer)
    || record.bytes.byteLength < 1
    || record.bytes.byteLength > expected.request.maxOutputBytes
    || record.bytes.byteLength > PROVIDER.manifest.maxOutputBytes
  ) {
    return null;
  }
  const bytes = new Uint8Array(record.bytes);
  const outputSha256 = await hash(bytes);
  if (!outputSha256) return null;
  const receipt = canonicalReceipt(
    record.receipt,
    expected,
    bytes,
    outputSha256,
  );
  if (!receipt) return null;
  return Object.freeze({ bytes, receipt });
}

export function studioFirstPartyWillV1DocumentCodecWorkerSuccessTransfers(
  message: StudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage,
): Transferable[] {
  const record = ownDataRecord(message, SUCCESS_KEYS);
  if (
    !record
    || record.type !== "studio-first-party-will-v1-document-codec/success"
    || record.version
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION
    || !positiveRequestId(record.requestId)
    || !(record.bytes instanceof ArrayBuffer)
  ) {
    return fail(
      "protocol-error",
      "First-party WILL v1 document Worker success transfer is invalid.",
    );
  }
  return [record.bytes];
}
