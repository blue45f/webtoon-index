/**
 * First-party ToonSpectrum product conformance certificates for codec executions.
 *
 * This boundary certifies only that ToonSpectrum verified an exact provider execution receipt,
 * output byte sequence, and evidence byte sequence against its own product conformance program.
 * It is deliberately not a codec-vendor certification, a third-party certification, an
 * "official codec" claim, or a trademark authorization.
 */

import {
  createStudioInkEnvelopeWebCryptoAttester,
  createStudioInkEnvelopeWebCryptoVerifier,
  type StudioInkEnvelopeWebCryptoAlgorithm,
} from "./brush/studio-ink-envelope-webcrypto-attestation";
import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  STUDIO_CODEC_PROVIDER_LIMITS,
  type StudioCodecDirection,
  type StudioCodecExecutionReceipt,
  type StudioCodecLicenseGrant,
  type StudioCodecLicenseScope,
  type StudioCodecProviderMode,
} from "./studio-codec-provider-contract";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION = 1 as const;
export const STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND =
  "toonspectrum-product-codec-conformance-certificate" as const;
export const STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN =
  "toonspectrum:product-codec-conformance-certificate:v1" as const;
export const STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN =
  "toonspectrum:product-codec-conformance-certificate-id:v1" as const;

const MAX_VALIDITY_MILLISECONDS = 366 * 24 * 60 * 60 * 1_000;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export const STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS = Object.freeze({
  maxCertificateBytes: 64 * 1_024,
  maxEvidenceBytes: 32 * 1_024 * 1_024,
  maxOutputBytes: STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes,
  maxReceiptBytes: 16 * 1_024,
  maxScopeCodeUnits: 192,
  maxEvidenceMediaTypeCodeUnits: 192,
  maxTrustRoots: 64,
  maxValidityMilliseconds: MAX_VALIDITY_MILLISECONDS,
} as const);

export const STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS = Object.freeze({
  authority: "ToonSpectrum" as const,
  program: "ToonSpectrum Product Codec Conformance" as const,
  officialToonSpectrumProductCertification: true as const,
  thirdPartyCodecCertification: false as const,
  codecVendorCertification: false as const,
  officialCodecVendorClaim: false as const,
  trademarkAuthorization: false as const,
});

export type StudioProductCodecCertificationErrorCode =
  | "AMBIGUOUS_TRUST_ROOT"
  | "CERTIFICATE_EXPIRED"
  | "CERTIFICATE_ID_MISMATCH"
  | "CERTIFICATE_NOT_YET_VALID"
  | "CERTIFICATE_REVOKED"
  | "EVIDENCE_MISMATCH"
  | "INVALID_CERTIFICATE"
  | "INVALID_JSON"
  | "INVALID_SOURCE"
  | "INVALID_UTF8"
  | "KEY_REVOKED"
  | "LIMIT_EXCEEDED"
  | "NON_CANONICAL_SERIALIZATION"
  | "OUTPUT_MISMATCH"
  | "RECEIPT_MISMATCH"
  | "REPLAYED_CERTIFICATE"
  | "SCOPE_MISMATCH"
  | "SIGNATURE_INVALID"
  | "SIGNING_FAILED"
  | "UNTRUSTED_KEY";

export class StudioProductCodecCertificationError extends Error {
  readonly code: StudioProductCodecCertificationErrorCode;

  constructor(
    code: StudioProductCodecCertificationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StudioProductCodecCertificationError";
    this.code = code;
  }
}

export interface StudioProductCodecCertificateDigest {
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

export interface StudioProductCodecCertificateEvidence
  extends StudioProductCodecCertificateDigest {
  readonly mediaType: string;
}

export type StudioProductCodecExecutionProvider = "direct" | "worker";

/**
 * Exact execution-provider selection bound into a product certificate. A one-element attempted
 * tuple is intentional: certification never authorizes a second provider after the selected one
 * fails.
 */
export interface StudioProductCodecExecutionProviderReceipt {
  readonly schemaVersion: 1;
  readonly kind: "toonspectrum-codec-execution-provider-selection";
  readonly selectedProvider: StudioProductCodecExecutionProvider;
  readonly attemptedProviders: readonly [StudioProductCodecExecutionProvider];
}

export interface StudioProductCodecCertificate {
  readonly schemaVersion: typeof STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION;
  readonly kind: typeof STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND;
  readonly certification: typeof STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS;
  readonly scope: string;
  readonly validity: Readonly<{
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
  }>;
  readonly nonce: string;
  readonly receipt: StudioCodecExecutionReceipt;
  readonly executionProviderReceipt?:
    StudioProductCodecExecutionProviderReceipt;
  readonly receiptSha256: `sha256:${string}`;
  readonly output: StudioProductCodecCertificateDigest;
  readonly evidence: StudioProductCodecCertificateEvidence;
  readonly certificateId: `tspcc1:${string}`;
  readonly signature: Readonly<{
    algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
    keyId: string;
    value: string;
  }>;
}

export interface StudioProductCodecCertificationSigner {
  readonly algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
  readonly keyId: string;
  readonly privateKey: CryptoKey;
  readonly scopes: readonly string[];
  readonly validFrom: string;
  readonly validUntil: string;
  readonly subtle?: SubtleCrypto;
}

export interface IssueStudioProductCodecCertificateInput {
  readonly receipt: StudioCodecExecutionReceipt;
  readonly executionProviderReceipt?:
    StudioProductCodecExecutionProviderReceipt;
  readonly outputBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
  readonly evidenceMediaType: string;
  readonly scope: string;
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly expiresAt: string;
}

export interface StudioProductCodecCertificationTrustRoot {
  readonly algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
  readonly keyId: string;
  readonly publicKey: CryptoKey;
  readonly scopes: readonly string[];
  readonly validFrom: string;
  readonly validUntil: string;
  /**
   * A root revoked at or before verification time is rejected. `null` means not revoked.
   * Deployments may additionally revoke a key id through verifier options.
   */
  readonly revokedAt: string | null;
}

export interface VerifyStudioProductCodecCertificateOptions {
  readonly outputBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
  readonly trustRoots: readonly StudioProductCodecCertificationTrustRoot[];
  readonly expectedScope?: string;
  readonly nowEpochMs?: number;
  readonly revokedCertificateIds?: ReadonlySet<string>;
  readonly revokedKeyIds?: ReadonlySet<string>;
  /**
   * Atomically claims an otherwise valid certificate id. Return `false` when it was already used.
   * It is invoked only after structural, declared-length, validity, trust, revocation, signature,
   * and exact byte-digest checks.
   */
  readonly claimCertificateId?: (
    certificateId: string
  ) => boolean | Promise<boolean>;
  readonly subtle?: SubtleCrypto;
}

export type StudioProductCodecCertificateVerificationResult =
  | Readonly<{
      ok: true;
      certificate: StudioProductCodecCertificate;
    }>
  | Readonly<{
      ok: false;
      code: StudioProductCodecCertificationErrorCode;
      message: string;
    }>;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const ROOT_KEYS = [
  "schemaVersion",
  "kind",
  "certification",
  "scope",
  "validity",
  "nonce",
  "receipt",
  "receiptSha256",
  "output",
  "evidence",
  "certificateId",
  "signature",
] as const;
const ROOT_KEYS_WITH_EXECUTION_PROVIDER_RECEIPT = [
  ...ROOT_KEYS,
  "executionProviderReceipt",
] as const;
const CERTIFICATION_KEYS = [
  "authority",
  "program",
  "officialToonSpectrumProductCertification",
  "thirdPartyCodecCertification",
  "codecVendorCertification",
  "officialCodecVendorClaim",
  "trademarkAuthorization",
] as const;
const VALIDITY_KEYS = ["issuedAt", "notBefore", "expiresAt"] as const;
const DIGEST_KEYS = ["byteLength", "sha256"] as const;
const EVIDENCE_KEYS = ["byteLength", "sha256", "mediaType"] as const;
const SIGNATURE_KEYS = ["algorithm", "keyId", "value"] as const;
const TRUST_ROOT_KEYS = [
  "algorithm",
  "keyId",
  "publicKey",
  "scopes",
  "validFrom",
  "validUntil",
  "revokedAt",
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
const LICENSE_GRANT_KEYS = ["id", "scope", "expiresAt"] as const;
const RECEIPT_OFFICIAL_CLAIMS_KEYS = [
  "externalAttestationAccepted",
  "officialCodec",
  "certified",
  "trademarkAuthorized",
] as const;
const EXECUTION_PROVIDER_RECEIPT_KEYS = [
  "schemaVersion",
  "kind",
  "selectedProvider",
  "attemptedProviders",
] as const;
const EXECUTION_PROVIDERS = new Set<StudioProductCodecExecutionProvider>([
  "direct",
  "worker",
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:[.:/_-][a-z0-9]+)+$/u;
const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9._+-]{0,31}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CERTIFICATE_ID_PATTERN = /^tspcc1:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MODES = new Set<StudioCodecProviderMode>([
  "browser-runtime",
  "licensed-sdk",
  "public-clean-room",
  "remote-provider",
]);
const DIRECTIONS = new Set<StudioCodecDirection>(["decode", "encode"]);
const LICENSE_SCOPES = new Set<StudioCodecLicenseScope>([
  "browser-runtime",
  "commercial-use",
  "decode",
  "encode",
  "licensed-sdk",
  "public-clean-room",
  "remote-provider",
]);

function fail(
  code: StudioProductCodecCertificationErrorCode,
  message: string
): never {
  throw new StudioProductCodecCertificationError(code, message);
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (
    (prototype !== Object.prototype && prototype !== null)
    || ownKeys.length !== expectedKeys.length
    || ownKeys.some(
      key => typeof key !== "string" || !expectedKeys.includes(key)
    )
  ) {
    return null;
  }
  const output: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    output[key] = descriptor.value;
  }
  return output;
}

function exactDenseArray(
  value: unknown,
  maximumLength: number
): readonly unknown[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > maximumLength
  ) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return null;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
  }
  return value;
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string"
    || !UTC_TIMESTAMP_PATTERN.test(value)
  ) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value
    ? epoch
    : null;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function safeScope(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length <= STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxScopeCodeUnits
    && SCOPE_PATTERN.test(value)
  );
}

function safeByteLength(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= maximum
  );
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Readonly<Record<string, JsonValue>>)[key] as JsonValue
        )}`
    )
    .join(",")}}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function parseDigest(
  value: unknown,
  maximum: number
): StudioProductCodecCertificateDigest | null {
  const record = ownDataRecord(value, DIGEST_KEYS);
  if (
    !record
    || !safeByteLength(record.byteLength, maximum)
    || typeof record.sha256 !== "string"
    || !SHA256_PATTERN.test(record.sha256)
  ) {
    return null;
  }
  return Object.freeze({
    byteLength: record.byteLength,
    sha256: record.sha256 as `sha256:${string}`,
  });
}

function parseEvidence(
  value: unknown
): StudioProductCodecCertificateEvidence | null {
  const record = ownDataRecord(value, EVIDENCE_KEYS);
  if (
    !record
    || !safeByteLength(
      record.byteLength,
      STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes
    )
    || typeof record.sha256 !== "string"
    || !SHA256_PATTERN.test(record.sha256)
    || typeof record.mediaType !== "string"
    || record.mediaType.length
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceMediaTypeCodeUnits
    || !MIME_TYPE_PATTERN.test(record.mediaType)
  ) {
    return null;
  }
  return Object.freeze({
    byteLength: record.byteLength,
    sha256: record.sha256 as `sha256:${string}`,
    mediaType: record.mediaType,
  });
}

function parseLicenseGrant(value: unknown): StudioCodecLicenseGrant | null {
  const record = ownDataRecord(value, LICENSE_GRANT_KEYS);
  const scope = exactDenseArray(
    record?.scope,
    STUDIO_CODEC_PROVIDER_LIMITS.maxLicenseScopes
  );
  if (
    !record
    || !safeIdentifier(record.id)
    || !scope
    || !scope.every(
      entry =>
        typeof entry === "string"
        && LICENSE_SCOPES.has(entry as StudioCodecLicenseScope)
    )
    || new Set(scope).size !== scope.length
    || (
      record.expiresAt !== null
      && parseCanonicalTimestamp(record.expiresAt) === null
    )
  ) {
    return null;
  }
  return Object.freeze({
    id: record.id,
    scope: Object.freeze([...(scope as readonly StudioCodecLicenseScope[])]),
    expiresAt: record.expiresAt as string | null,
  });
}

function parseReceiptDigest(
  value: unknown
): StudioCodecExecutionReceipt["input"] | null {
  const digest = parseDigest(
    value,
    STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes
  );
  return digest
    ? Object.freeze({
        byteLength: digest.byteLength,
        sha256: digest.sha256,
      })
    : null;
}

function parseReceipt(value: unknown): StudioCodecExecutionReceipt | null {
  const record = ownDataRecord(value, RECEIPT_KEYS);
  const input = parseReceiptDigest(record?.input);
  const output = parseDigest(
    record?.output,
    STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes
  );
  const licenseGrant = parseLicenseGrant(record?.licenseGrant);
  const officialClaims = ownDataRecord(
    record?.officialClaims,
    RECEIPT_OFFICIAL_CLAIMS_KEYS
  );
  if (
    !record
    || record.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || record.kind !== "toonspectrum-codec-provider-execution"
    || !safeIdentifier(record.providerId)
    || typeof record.mode !== "string"
    || !MODES.has(record.mode as StudioCodecProviderMode)
    || typeof record.direction !== "string"
    || !DIRECTIONS.has(record.direction as StudioCodecDirection)
    || !safeIdentifier(record.format)
    || !safeIdentifier(record.profile)
    || !safeIdentifier(record.version)
    || typeof record.mimeType !== "string"
    || !MIME_TYPE_PATTERN.test(record.mimeType)
    || typeof record.extension !== "string"
    || !EXTENSION_PATTERN.test(record.extension)
    || typeof record.deterministic !== "boolean"
    || !input
    || !output
    || !licenseGrant
    || !licenseGrant.scope.includes(record.mode as StudioCodecProviderMode)
    || !licenseGrant.scope.includes(record.direction as StudioCodecDirection)
    || !officialClaims
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
    providerId: record.providerId,
    mode: record.mode as StudioCodecProviderMode,
    direction: record.direction as StudioCodecDirection,
    format: record.format,
    profile: record.profile,
    version: record.version,
    mimeType: record.mimeType,
    extension: record.extension,
    deterministic: record.deterministic,
    input,
    output,
    licenseGrant,
    officialClaims: Object.freeze({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    }),
  });
}

function parseExecutionProviderReceipt(
  value: unknown,
): StudioProductCodecExecutionProviderReceipt | null {
  const record = ownDataRecord(value, EXECUTION_PROVIDER_RECEIPT_KEYS);
  const attemptedProviders = exactDenseArray(
    record?.attemptedProviders,
    1,
  );
  if (
    !record
    || record.schemaVersion !== 1
    || record.kind !== "toonspectrum-codec-execution-provider-selection"
    || typeof record.selectedProvider !== "string"
    || !EXECUTION_PROVIDERS.has(
      record.selectedProvider as StudioProductCodecExecutionProvider,
    )
    || !attemptedProviders
    || attemptedProviders.length !== 1
    || attemptedProviders[0] !== record.selectedProvider
  ) {
    return null;
  }
  const selectedProvider =
    record.selectedProvider as StudioProductCodecExecutionProvider;
  return Object.freeze({
    schemaVersion: 1,
    kind: "toonspectrum-codec-execution-provider-selection",
    selectedProvider,
    attemptedProviders: Object.freeze([
      selectedProvider,
    ]) as readonly [StudioProductCodecExecutionProvider],
  });
}

function receiptJson(receipt: StudioCodecExecutionReceipt): JsonValue {
  return receipt as unknown as JsonValue;
}

function certificateCoreJson(
  certificate: Omit<StudioProductCodecCertificate, "certificateId" | "signature">,
  signer: Readonly<{
    algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
    keyId: string;
  }>
): JsonValue {
  return {
    certification: certificate.certification as unknown as JsonValue,
    evidence: certificate.evidence as unknown as JsonValue,
    ...(certificate.executionProviderReceipt
      ? {
          executionProviderReceipt:
            certificate.executionProviderReceipt as unknown as JsonValue,
        }
      : {}),
    kind: certificate.kind,
    nonce: certificate.nonce,
    output: certificate.output as unknown as JsonValue,
    receipt: receiptJson(certificate.receipt),
    receiptSha256: certificate.receiptSha256,
    schemaVersion: certificate.schemaVersion,
    scope: certificate.scope,
    signer: {
      algorithm: signer.algorithm,
      keyId: signer.keyId,
    },
    validity: certificate.validity as unknown as JsonValue,
  };
}

function certificateUnsignedJson(
  certificate: StudioProductCodecCertificate
): JsonValue {
  return {
    certificateId: certificate.certificateId,
    core: certificateCoreJson(certificate, certificate.signature),
  };
}

function certificateIdFor(
  core: JsonValue
): `tspcc1:${string}` {
  const source = TEXT_ENCODER.encode(
    `${STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN}\u0000${canonicalJson(core)}`
  );
  return `tspcc1:${sha256HexPortable(source)}`;
}

function signatureMessage(
  certificate: StudioProductCodecCertificate
): Uint8Array {
  return TEXT_ENCODER.encode(
    `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000${canonicalJson(
      certificateUnsignedJson(certificate)
    )}`
  );
}

function normalizeCertification(
  value: unknown
): typeof STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS | null {
  const record = ownDataRecord(value, CERTIFICATION_KEYS);
  if (
    !record
    || record.authority !== STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS.authority
    || record.program !== STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS.program
    || record.officialToonSpectrumProductCertification !== true
    || record.thirdPartyCodecCertification !== false
    || record.codecVendorCertification !== false
    || record.officialCodecVendorClaim !== false
    || record.trademarkAuthorization !== false
  ) {
    return null;
  }
  return STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS;
}

function isAlgorithm(
  value: unknown
): value is StudioInkEnvelopeWebCryptoAlgorithm {
  return value === "ed25519" || value === "ecdsa-p256-sha256";
}

function normalizeCertificate(
  value: unknown
): StudioProductCodecCertificate | null {
  const record = ownDataRecord(value, ROOT_KEYS)
    ?? ownDataRecord(value, ROOT_KEYS_WITH_EXECUTION_PROVIDER_RECEIPT);
  const hasExecutionProviderReceipt =
    record !== null
    && Object.prototype.hasOwnProperty.call(
      record,
      "executionProviderReceipt",
    );
  const executionProviderReceipt = hasExecutionProviderReceipt
    ? parseExecutionProviderReceipt(record?.executionProviderReceipt)
    : undefined;
  const certification = normalizeCertification(record?.certification);
  const validity = ownDataRecord(record?.validity, VALIDITY_KEYS);
  const receipt = parseReceipt(record?.receipt);
  const output = parseDigest(
    record?.output,
    STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxOutputBytes
  );
  const evidence = parseEvidence(record?.evidence);
  const signature = ownDataRecord(record?.signature, SIGNATURE_KEYS);
  if (
    !record
    || record.schemaVersion !== STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION
    || record.kind !== STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND
    || !certification
    || !safeScope(record.scope)
    || !validity
    || parseCanonicalTimestamp(validity.issuedAt) === null
    || parseCanonicalTimestamp(validity.notBefore) === null
    || parseCanonicalTimestamp(validity.expiresAt) === null
    || typeof record.nonce !== "string"
    || !NONCE_PATTERN.test(record.nonce)
    || !receipt
    || (hasExecutionProviderReceipt && !executionProviderReceipt)
    || typeof record.receiptSha256 !== "string"
    || !SHA256_PATTERN.test(record.receiptSha256)
    || !output
    || !evidence
    || typeof record.certificateId !== "string"
    || !CERTIFICATE_ID_PATTERN.test(record.certificateId)
    || !signature
    || !isAlgorithm(signature.algorithm)
    || !safeIdentifier(signature.keyId)
    || typeof signature.value !== "string"
    || signature.value.length !== 86
    || !BASE64URL_PATTERN.test(signature.value)
  ) {
    return null;
  }
  const issuedAt = validity.issuedAt as string;
  const notBefore = validity.notBefore as string;
  const expiresAt = validity.expiresAt as string;
  const issuedEpoch = parseCanonicalTimestamp(issuedAt) as number;
  const notBeforeEpoch = parseCanonicalTimestamp(notBefore) as number;
  const expiresEpoch = parseCanonicalTimestamp(expiresAt) as number;
  if (
    issuedEpoch > notBeforeEpoch
    || notBeforeEpoch >= expiresEpoch
    || expiresEpoch - issuedEpoch > MAX_VALIDITY_MILLISECONDS
  ) {
    return null;
  }
  const normalized: StudioProductCodecCertificate = Object.freeze({
    schemaVersion: STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION,
    kind: STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND,
    certification,
    scope: record.scope,
    validity: Object.freeze({ issuedAt, notBefore, expiresAt }),
    nonce: record.nonce,
    receipt,
    ...(executionProviderReceipt ? { executionProviderReceipt } : {}),
    receiptSha256: record.receiptSha256 as `sha256:${string}`,
    output,
    evidence,
    certificateId: record.certificateId as `tspcc1:${string}`,
    signature: Object.freeze({
      algorithm: signature.algorithm,
      keyId: signature.keyId,
      value: signature.value,
    }),
  });
  const licenseExpiry = normalized.receipt.licenseGrant.expiresAt;
  if (
    normalized.output.byteLength !== normalized.receipt.output.byteLength
    || normalized.output.sha256 !== normalized.receipt.output.sha256
    || (
      licenseExpiry !== null
      && (parseCanonicalTimestamp(licenseExpiry) as number) < expiresEpoch
    )
  ) {
    return null;
  }
  return normalized;
}

function certificateIdMatches(
  certificate: StudioProductCodecCertificate
): boolean {
  return certificateIdFor(
    certificateCoreJson(certificate, certificate.signature)
  ) === certificate.certificateId;
}

function certificateJson(
  certificate: StudioProductCodecCertificate
): JsonValue {
  return certificate as unknown as JsonValue;
}

function ownedBytes(
  value: unknown,
  maximum: number,
  allowEmpty: boolean
): Uint8Array {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength > maximum
    || (!allowEmpty && value.byteLength === 0)
  ) {
    fail(
      value instanceof Uint8Array ? "LIMIT_EXCEEDED" : "INVALID_SOURCE",
      "Codec certification byte source is invalid or exceeds its budget."
    );
  }
  return Uint8Array.from(value);
}

function normalizeScopes(value: unknown): readonly string[] | null {
  const scopes = exactDenseArray(value, 64);
  if (
    !scopes
    || !scopes.every(safeScope)
    || new Set(scopes).size !== scopes.length
  ) {
    return null;
  }
  return Object.freeze([...(scopes as readonly string[])]);
}

function validateSigner(
  signer: StudioProductCodecCertificationSigner,
  scope: string,
  issuedEpoch: number,
  expiresEpoch: number
): void {
  const scopes = normalizeScopes(signer.scopes);
  const validFrom = parseCanonicalTimestamp(signer.validFrom);
  const validUntil = parseCanonicalTimestamp(signer.validUntil);
  if (
    !isAlgorithm(signer.algorithm)
    || !safeIdentifier(signer.keyId)
    || !scopes
    || !scopes.includes(scope)
    || validFrom === null
    || validUntil === null
    || validFrom >= validUntil
    || issuedEpoch < validFrom
    || expiresEpoch > validUntil
  ) {
    fail(
      "UNTRUSTED_KEY",
      "Codec certification signer is not valid for this scope and window."
    );
  }
}

function parseTrustRoot(
  value: unknown
): Readonly<{
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
  keyId: string;
  publicKey: CryptoKey;
  scopes: readonly string[];
  validFromEpoch: number;
  validUntilEpoch: number;
  revokedAtEpoch: number | null;
}> | null {
  const candidate = ownDataRecord(value, TRUST_ROOT_KEYS);
  if (!candidate) return null;
  const scopes = normalizeScopes(candidate.scopes);
  const validFromEpoch = parseCanonicalTimestamp(candidate.validFrom);
  const validUntilEpoch = parseCanonicalTimestamp(candidate.validUntil);
  const revokedAtEpoch = candidate.revokedAt === null
    ? null
    : parseCanonicalTimestamp(candidate.revokedAt);
  if (
    !isAlgorithm(candidate.algorithm)
    || !safeIdentifier(candidate.keyId)
    || !isCryptoKey(candidate.publicKey)
    || !scopes
    || validFromEpoch === null
    || validUntilEpoch === null
    || validFromEpoch >= validUntilEpoch
    || (candidate.revokedAt !== null && revokedAtEpoch === null)
  ) {
    return null;
  }
  return Object.freeze({
    algorithm: candidate.algorithm,
    keyId: candidate.keyId,
    publicKey: candidate.publicKey,
    scopes,
    validFromEpoch,
    validUntilEpoch,
    revokedAtEpoch,
  });
}

function isCryptoKey(value: unknown): value is CryptoKey {
  try {
    return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
  } catch {
    return false;
  }
}

function failureResult(
  code: StudioProductCodecCertificationErrorCode,
  message: string
): StudioProductCodecCertificateVerificationResult {
  return Object.freeze({ ok: false, code, message });
}

export function serializeStudioProductCodecCertificate(
  value: StudioProductCodecCertificate
): Uint8Array {
  const certificate = normalizeCertificate(value);
  if (!certificate) {
    fail("INVALID_CERTIFICATE", "Codec product certificate is invalid.");
  }
  if (!certificateIdMatches(certificate)) {
    fail(
      "CERTIFICATE_ID_MISMATCH",
      "Codec product certificate id does not match its signed source."
    );
  }
  const bytes = TEXT_ENCODER.encode(canonicalJson(certificateJson(certificate)));
  if (
    bytes.byteLength
    > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes
  ) {
    fail("LIMIT_EXCEEDED", "Codec product certificate exceeds its byte budget.");
  }
  return bytes;
}

export function parseStudioProductCodecCertificate(
  source: unknown
): StudioProductCodecCertificate {
  const bytes = ownedBytes(
    source,
    STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes,
    false
  );
  let serialized: string;
  try {
    serialized = TEXT_DECODER.decode(bytes);
  } catch {
    fail("INVALID_UTF8", "Codec product certificate is not valid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    fail("INVALID_JSON", "Codec product certificate is not valid JSON.");
  }
  const certificate = normalizeCertificate(value);
  if (!certificate) {
    fail("INVALID_CERTIFICATE", "Codec product certificate schema is invalid.");
  }
  if (!certificateIdMatches(certificate)) {
    fail(
      "CERTIFICATE_ID_MISMATCH",
      "Codec product certificate id does not match its signed source."
    );
  }
  const canonical = canonicalJson(certificateJson(certificate));
  if (canonical !== serialized) {
    fail(
      "NON_CANONICAL_SERIALIZATION",
      "Codec product certificate is not canonical JSON."
    );
  }
  const receiptBytes = TEXT_ENCODER.encode(canonicalJson(receiptJson(certificate.receipt)));
  if (
    receiptBytes.byteLength
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxReceiptBytes
    || hashBytes(receiptBytes) !== certificate.receiptSha256
  ) {
    fail(
      "RECEIPT_MISMATCH",
      "Codec execution receipt does not match its signed digest."
    );
  }
  return certificate;
}

export async function issueStudioProductCodecCertificate(
  input: IssueStudioProductCodecCertificateInput,
  signer: StudioProductCodecCertificationSigner
): Promise<Uint8Array> {
  const scope = safeScope(input.scope) ? input.scope : null;
  const receipt = parseReceipt(input.receipt);
  const executionProviderReceipt = input.executionProviderReceipt === undefined
    ? undefined
    : parseExecutionProviderReceipt(input.executionProviderReceipt);
  const issuedEpoch = parseCanonicalTimestamp(input.issuedAt);
  const notBefore = input.notBefore ?? input.issuedAt;
  const notBeforeEpoch = parseCanonicalTimestamp(notBefore);
  const expiresEpoch = parseCanonicalTimestamp(input.expiresAt);
  if (
    !scope
    || !receipt
    || (
      input.executionProviderReceipt !== undefined
      && !executionProviderReceipt
    )
    || issuedEpoch === null
    || notBeforeEpoch === null
    || expiresEpoch === null
    || issuedEpoch > notBeforeEpoch
    || notBeforeEpoch >= expiresEpoch
    || expiresEpoch - issuedEpoch > MAX_VALIDITY_MILLISECONDS
  ) {
    fail("INVALID_CERTIFICATE", "Codec certification request is invalid.");
  }
  if (
    receipt.licenseGrant.expiresAt !== null
    && (parseCanonicalTimestamp(receipt.licenseGrant.expiresAt) as number)
      < expiresEpoch
  ) {
    fail(
      "INVALID_CERTIFICATE",
      "Product certification cannot outlive the codec license grant."
    );
  }
  validateSigner(signer, scope, issuedEpoch, expiresEpoch);
  const outputBytes = ownedBytes(
    input.outputBytes,
    STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxOutputBytes,
    true
  );
  const evidenceBytes = ownedBytes(
    input.evidenceBytes,
    STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes,
    false
  );
  if (
    typeof input.evidenceMediaType !== "string"
    || input.evidenceMediaType.length
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceMediaTypeCodeUnits
    || !MIME_TYPE_PATTERN.test(input.evidenceMediaType)
  ) {
    fail("INVALID_CERTIFICATE", "Codec certification evidence media type is invalid.");
  }
  const output = Object.freeze({
    byteLength: outputBytes.byteLength,
    sha256: hashBytes(outputBytes),
  });
  if (
    output.byteLength !== receipt.output.byteLength
    || output.sha256 !== receipt.output.sha256
  ) {
    fail(
      "OUTPUT_MISMATCH",
      "Exact codec output bytes do not match the execution receipt."
    );
  }
  const receiptBytes = TEXT_ENCODER.encode(canonicalJson(receiptJson(receipt)));
  if (
    receiptBytes.byteLength
    > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxReceiptBytes
  ) {
    fail("LIMIT_EXCEEDED", "Codec execution receipt exceeds its byte budget.");
  }
  const nonceBytes = new Uint8Array(32);
  if (!globalThis.crypto?.getRandomValues) {
    fail("SIGNING_FAILED", "A cryptographic random source is unavailable.");
  }
  globalThis.crypto.getRandomValues(nonceBytes);
  const unsigned = Object.freeze({
    schemaVersion: STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION,
    kind: STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND,
    certification: STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS,
    scope,
    validity: Object.freeze({
      issuedAt: input.issuedAt,
      notBefore,
      expiresAt: input.expiresAt,
    }),
    nonce: base64Url(nonceBytes),
    receipt,
    ...(executionProviderReceipt ? { executionProviderReceipt } : {}),
    receiptSha256: hashBytes(receiptBytes),
    output,
    evidence: Object.freeze({
      byteLength: evidenceBytes.byteLength,
      sha256: hashBytes(evidenceBytes),
      mediaType: input.evidenceMediaType,
    }),
  });
  const signerIdentity = Object.freeze({
    algorithm: signer.algorithm,
    keyId: signer.keyId,
  });
  const certificateId = certificateIdFor(
    certificateCoreJson(unsigned, signerIdentity)
  );
  const signatureShell: StudioProductCodecCertificate = Object.freeze({
    ...unsigned,
    certificateId,
    signature: Object.freeze({
      ...signerIdentity,
      value: "pending",
    }),
  });
  let signatureValue: string;
  try {
    const attester = createStudioInkEnvelopeWebCryptoAttester({
      algorithm: signer.algorithm,
      keyId: signer.keyId,
      privateKey: signer.privateKey,
      ...(signer.subtle ? { subtle: signer.subtle } : {}),
    });
    signatureValue = await attester.sign(signatureMessage(signatureShell));
  } catch {
    fail("SIGNING_FAILED", "Codec product certificate signing failed.");
  }
  const certificate: StudioProductCodecCertificate = Object.freeze({
    ...unsigned,
    certificateId,
    signature: Object.freeze({
      ...signerIdentity,
      value: signatureValue,
    }),
  });
  return serializeStudioProductCodecCertificate(certificate);
}

export async function verifyStudioProductCodecCertificate(
  source: unknown,
  options: VerifyStudioProductCodecCertificateOptions
): Promise<StudioProductCodecCertificateVerificationResult> {
  let certificate: StudioProductCodecCertificate;
  try {
    certificate = parseStudioProductCodecCertificate(source);
  } catch (error) {
    if (error instanceof StudioProductCodecCertificationError) {
      return failureResult(error.code, error.message);
    }
    return failureResult(
      "INVALID_CERTIFICATE",
      "Codec product certificate parsing failed closed."
    );
  }

  let outputByteLength: number;
  let evidenceByteLength: number;
  try {
    if (
      !(options.outputBytes instanceof Uint8Array)
      || !(options.evidenceBytes instanceof Uint8Array)
    ) {
      return failureResult(
        "INVALID_SOURCE",
        "Certification byte input is invalid."
      );
    }
    outputByteLength = options.outputBytes.byteLength;
    evidenceByteLength = options.evidenceBytes.byteLength;
  } catch {
    return failureResult(
      "INVALID_SOURCE",
      "Certification byte input is invalid."
    );
  }
  if (
    outputByteLength
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxOutputBytes
    || outputByteLength !== certificate.output.byteLength
    || outputByteLength !== certificate.receipt.output.byteLength
  ) {
    return failureResult(
      "OUTPUT_MISMATCH",
      "Codec output length does not match the certified exact source."
    );
  }
  if (
    evidenceByteLength === 0
    || evidenceByteLength
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes
    || evidenceByteLength !== certificate.evidence.byteLength
  ) {
    return failureResult(
      "EVIDENCE_MISMATCH",
      "Codec evidence length does not match the certified exact source."
    );
  }
  if (
    options.expectedScope !== undefined
    && options.expectedScope !== certificate.scope
  ) {
    return failureResult(
      "SCOPE_MISMATCH",
      "Codec product certificate is outside the required trust scope."
    );
  }

  const nowEpochMs = options.nowEpochMs ?? Date.now();
  if (!Number.isFinite(nowEpochMs)) {
    return failureResult(
      "INVALID_CERTIFICATE",
      "Codec certificate verification time is invalid."
    );
  }
  const notBeforeEpoch = parseCanonicalTimestamp(
    certificate.validity.notBefore
  ) as number;
  const expiresEpoch = parseCanonicalTimestamp(
    certificate.validity.expiresAt
  ) as number;
  if (nowEpochMs < notBeforeEpoch) {
    return failureResult(
      "CERTIFICATE_NOT_YET_VALID",
      "Codec product certificate is not valid yet."
    );
  }
  if (nowEpochMs >= expiresEpoch) {
    return failureResult(
      "CERTIFICATE_EXPIRED",
      "Codec product certificate has expired."
    );
  }
  let certificateRevoked: boolean;
  let keyRevoked: boolean;
  try {
    certificateRevoked =
      options.revokedCertificateIds?.has(certificate.certificateId) ?? false;
    keyRevoked =
      options.revokedKeyIds?.has(certificate.signature.keyId) ?? false;
  } catch {
    return failureResult(
      "INVALID_CERTIFICATE",
      "Codec product certification revocation registry failed closed."
    );
  }
  if (certificateRevoked) {
    return failureResult(
      "CERTIFICATE_REVOKED",
      "Codec product certificate was revoked."
    );
  }
  if (keyRevoked) {
    return failureResult(
      "KEY_REVOKED",
      "Codec product certification key was revoked."
    );
  }
  let trustRootValues: readonly StudioProductCodecCertificationTrustRoot[];
  try {
    if (
      !Array.isArray(options.trustRoots)
      || options.trustRoots.length === 0
      || options.trustRoots.length
        > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxTrustRoots
    ) {
      return failureResult(
        "UNTRUSTED_KEY",
        "Codec product certification trust registry is invalid."
      );
    }
    trustRootValues = [...options.trustRoots];
  } catch {
    return failureResult(
      "UNTRUSTED_KEY",
      "Codec product certification trust registry is invalid."
    );
  }
  const issuedEpoch = parseCanonicalTimestamp(
    certificate.validity.issuedAt
  ) as number;
  let roots: readonly NonNullable<ReturnType<typeof parseTrustRoot>>[];
  try {
    roots = trustRootValues
      .map(parseTrustRoot)
      .filter(
        (
          root
        ): root is NonNullable<ReturnType<typeof parseTrustRoot>> =>
      root !== null
      && root.algorithm === certificate.signature.algorithm
      && root.keyId === certificate.signature.keyId
      && root.scopes.includes(certificate.scope)
      && issuedEpoch >= root.validFromEpoch
      && expiresEpoch <= root.validUntilEpoch
      );
  } catch {
    return failureResult(
      "UNTRUSTED_KEY",
      "Codec product certification trust registry failed closed."
    );
  }
  if (roots.length === 0) {
    return failureResult(
      "UNTRUSTED_KEY",
      "No scoped trust root covers this certificate and validity window."
    );
  }
  if (roots.length !== 1) {
    return failureResult(
      "AMBIGUOUS_TRUST_ROOT",
      "Multiple trust roots claim the same certificate identity and window."
    );
  }
  const root = roots[0]!;
  if (root.revokedAtEpoch !== null && nowEpochMs >= root.revokedAtEpoch) {
    return failureResult(
      "KEY_REVOKED",
      "Codec product certification trust root was revoked."
    );
  }
  let signatureValid: boolean;
  try {
    const verifier = createStudioInkEnvelopeWebCryptoVerifier({
      resolvePublicKey: (algorithm, keyId) =>
        algorithm === root.algorithm && keyId === root.keyId
          ? root.publicKey
          : null,
      ...(options.subtle ? { subtle: options.subtle } : {}),
    });
    signatureValid = await verifier.verify({
      algorithm: certificate.signature.algorithm,
      keyId: certificate.signature.keyId,
      message: signatureMessage({
        ...certificate,
        signature: {
          ...certificate.signature,
          value: "pending",
        },
      }),
      signature: certificate.signature.value,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return failureResult(
      "SIGNATURE_INVALID",
      "Codec product certificate signature is invalid."
    );
  }
  let outputBytes: Uint8Array;
  let evidenceBytes: Uint8Array;
  try {
    outputBytes = ownedBytes(
      options.outputBytes,
      STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxOutputBytes,
      true
    );
    evidenceBytes = ownedBytes(
      options.evidenceBytes,
      STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes,
      false
    );
  } catch (error) {
    return error instanceof StudioProductCodecCertificationError
      ? failureResult(error.code, error.message)
      : failureResult("INVALID_SOURCE", "Certification byte input is invalid.");
  }
  const outputDigest = hashBytes(outputBytes);
  if (
    outputDigest !== certificate.output.sha256
    || outputDigest !== certificate.receipt.output.sha256
  ) {
    return failureResult(
      "OUTPUT_MISMATCH",
      "Codec output bytes do not match the certified exact source."
    );
  }
  if (hashBytes(evidenceBytes) !== certificate.evidence.sha256) {
    return failureResult(
      "EVIDENCE_MISMATCH",
      "Codec evidence bytes do not match the certified exact source."
    );
  }
  if (options.claimCertificateId) {
    let claimed: boolean;
    try {
      claimed = await options.claimCertificateId(certificate.certificateId);
    } catch {
      claimed = false;
    }
    if (!claimed) {
      return failureResult(
        "REPLAYED_CERTIFICATE",
        "Codec product certificate id was already consumed."
      );
    }
  }
  return Object.freeze({ ok: true, certificate });
}
