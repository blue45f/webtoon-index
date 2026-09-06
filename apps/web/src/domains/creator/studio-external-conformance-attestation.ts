/**
 * Vendor-neutral acceptance boundary for an external conformance validator.
 *
 * This module does not contain vendor SDK code, private keys, bundled trust roots, certification
 * marks, or a way for ToonSpectrum to issue a third-party certification. A caller-owned adapter may
 * project a validator response into this bounded envelope, and a caller-owned trust policy may then
 * accept the provider's signed assertion.
 */

export const STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA =
  "toonspectrum.external-conformance-attestation" as const;
export const STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA_VERSION = 1 as const;

export type StudioExternalConformanceSignatureAlgorithm =
  | "ed25519"
  | "ecdsa-p256-sha256";

export type StudioExternalConformanceOutcome =
  | "passed"
  | "failed"
  | "indeterminate";

export type StudioSha256Digest = `sha256:${string}`;

export interface StudioExternalConformanceAttestationPayload {
  readonly schema: typeof STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA;
  readonly schemaVersion: typeof STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA_VERSION;
  readonly provider: string;
  readonly vendor: string;
  readonly standard: string;
  readonly profile: string;
  readonly standardVersion: string;
  readonly toolVersion: string;
  readonly outcome: StudioExternalConformanceOutcome;
  readonly documentDigest: StudioSha256Digest;
  readonly resultDigest: StudioSha256Digest;
  readonly evidenceDigest: StudioSha256Digest;
  readonly signedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly keyId: string;
  readonly signatureAlgorithm: StudioExternalConformanceSignatureAlgorithm;
}

export interface StudioExternalConformanceAttestation
  extends StudioExternalConformanceAttestationPayload {
  /** Canonical, unpadded base64url. P-256 uses Web Crypto's 64-byte IEEE-P1363 r || s form. */
  readonly signatureBytes: string;
}

export interface StudioExternalConformanceTrustScope {
  readonly standard: string;
  readonly profile: string;
  readonly standardVersion: string;
}

export interface StudioExternalConformanceTrustRoot {
  readonly provider: string;
  readonly vendor: string;
  readonly keyId: string;
  readonly signatureAlgorithm: StudioExternalConformanceSignatureAlgorithm;
  readonly publicKey: CryptoKey;
  readonly scopes: readonly StudioExternalConformanceTrustScope[];
}

/**
 * ToonSpectrum ships no vendor root by default. Deployments must supply reviewed, rotatable keys.
 */
export const STUDIO_EXTERNAL_CONFORMANCE_DEFAULT_TRUST_ROOTS:
  readonly StudioExternalConformanceTrustRoot[] = Object.freeze([]);

export interface StudioExternalConformanceExpectedClaim {
  readonly standard: string;
  readonly profile: string;
  readonly standardVersion: string;
  readonly documentDigest: StudioSha256Digest;
  readonly nonce: string;
}

export interface StudioExternalConformanceNonceContext {
  readonly nonce: string;
  readonly attestationDigest: StudioSha256Digest;
  readonly provider: string;
  readonly vendor: string;
  readonly standard: string;
  readonly profile: string;
  readonly documentDigest: StudioSha256Digest;
  readonly expiresAt: string;
}

export interface StudioExternalConformanceVerificationOptions {
  readonly expected: StudioExternalConformanceExpectedClaim;
  readonly resultBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
  readonly trustRoots?: readonly StudioExternalConformanceTrustRoot[];
  /**
   * Must atomically reserve a previously unused nonce and return false when it was already used.
   * The callback is invoked only after every digest, trust policy, time, and signature check passes.
   */
  readonly consumeNonce?: (
    context: StudioExternalConformanceNonceContext
  ) => boolean | Promise<boolean>;
  readonly now?: Date | number;
  readonly maxClockSkewMs?: number;
  readonly maxLifetimeMs?: number;
  readonly subtle?: SubtleCrypto;
}

export const STUDIO_CONFORMANCE_ASSURANCE_BOUNDARY = Object.freeze({
  publicSpecificationSelfValidation: "toonspectrum-self-validation",
  externalAttestation: "external-provider-attestation-accepted",
  productIssuedOfficialCertification: false,
  productIssuedTrademarkApproval: false,
  vendorSdkOrSigningKeyBundled: false,
} as const);

export interface StudioPublicSpecificationSelfValidationReceipt {
  readonly kind: "studio-public-specification-self-validation";
  readonly standard: string;
  readonly profile: string;
  readonly standardVersion: string;
  readonly documentDigest: StudioSha256Digest;
  readonly evidenceDigest: StudioSha256Digest;
  readonly validatedAt: string;
  readonly assurance: "self-validation";
  readonly externalAttestationAccepted: false;
  readonly officialCertificationIssuedByProduct: false;
  readonly trademarkApprovalIssuedByProduct: false;
}

export interface StudioExternalConformanceAcceptanceReceipt {
  readonly kind: "studio-external-conformance-attestation-acceptance";
  readonly attestationDigest: StudioSha256Digest;
  readonly provider: string;
  readonly vendor: string;
  readonly standard: string;
  readonly profile: string;
  readonly standardVersion: string;
  readonly toolVersion: string;
  readonly outcome: "passed";
  readonly documentDigest: StudioSha256Digest;
  readonly resultDigest: StudioSha256Digest;
  readonly evidenceDigest: StudioSha256Digest;
  readonly signedAt: string;
  readonly expiresAt: string;
  readonly keyId: string;
  readonly signatureAlgorithm: StudioExternalConformanceSignatureAlgorithm;
  readonly acceptedAt: string;
  readonly assurance: "external-provider-attestation-accepted";
  readonly officialCertificationIssuedByProduct: false;
  readonly trademarkApprovalIssuedByProduct: false;
  readonly selfValidationReceiptIssued: false;
}

export type StudioExternalConformanceRejectionCode =
  | "schema-invalid"
  | "canonical-encoding-invalid"
  | "expectation-invalid"
  | "claim-not-passed"
  | "claim-mismatch"
  | "document-digest-mismatch"
  | "result-digest-mismatch"
  | "evidence-digest-mismatch"
  | "not-yet-valid"
  | "expired"
  | "lifetime-invalid"
  | "resource-limit-exceeded"
  | "crypto-unavailable"
  | "trust-root-not-found"
  | "trust-root-ambiguous"
  | "trust-key-invalid"
  | "signature-invalid"
  | "nonce-verifier-unavailable"
  | "nonce-replayed"
  | "provider-adapter-failed";

export type StudioExternalConformanceVerificationResult =
  | Readonly<{
      accepted: true;
      receipt: StudioExternalConformanceAcceptanceReceipt;
    }>
  | Readonly<{
      accepted: false;
      code: StudioExternalConformanceRejectionCode;
    }>;

export interface StudioExternalConformanceProviderBundle {
  readonly attestation: unknown;
  readonly resultBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
}

/**
 * Provider-specific parsing stays outside this module. Adapters only normalize external output to
 * bytes plus the public envelope; they do not expand ToonSpectrum's trust policy.
 */
export interface StudioExternalConformanceProviderAdapter<TSource> {
  readonly adapterId: string;
  readonly read: (
    source: TSource
  ) =>
    | StudioExternalConformanceProviderBundle
    | Promise<StudioExternalConformanceProviderBundle>;
}

export type StudioExternalConformanceProviderVerificationOptions = Omit<
  StudioExternalConformanceVerificationOptions,
  "resultBytes" | "evidenceBytes"
>;

export class StudioExternalConformanceAttestationError extends Error {
  readonly code:
    | "SCHEMA_INVALID"
    | "CANONICAL_ENCODING_INVALID"
    | "RESOURCE_LIMIT_EXCEEDED";

  constructor(
    code: StudioExternalConformanceAttestationError["code"],
    message: string
  ) {
    super(message);
    this.name = "StudioExternalConformanceAttestationError";
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const STRICT_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const PAYLOAD_KEYS = Object.freeze([
  "documentDigest",
  "evidenceDigest",
  "expiresAt",
  "keyId",
  "nonce",
  "outcome",
  "profile",
  "provider",
  "resultDigest",
  "schema",
  "schemaVersion",
  "signatureAlgorithm",
  "signedAt",
  "standard",
  "standardVersion",
  "toolVersion",
  "vendor",
] as const);
const ATTESTATION_KEYS = Object.freeze([
  ...PAYLOAD_KEYS,
  "signatureBytes",
].sort());
const MAX_CANONICAL_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CLOCK_SKEW_MS = 60_000;
const DEFAULT_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_CONFIGURED_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_CONFIGURED_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const ED25519_SIGNATURE_BYTES = 64;
const ECDSA_P256_SIGNATURE_BYTES = 64;
const ECDSA_P256_SCALAR_BYTES = 32;
const ECDSA_P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_EIGHT = BigInt(8);
const ECDSA_P256_HALF_ORDER = ECDSA_P256_ORDER >> BIGINT_ONE;
const SIGNING_DOMAIN = "ToonSpectrum external conformance attestation\nv1\n";
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/+@~-]*$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function rejected(
  code: StudioExternalConformanceRejectionCode
): StudioExternalConformanceVerificationResult {
  return Object.freeze({ accepted: false, code });
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      return Boolean(
        descriptor &&
          Object.hasOwn(descriptor, "value") &&
          descriptor.enumerable
      );
    });
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  try {
    const actual = Object.keys(value).sort();
    if (actual.length !== expectedKeys.length) return false;
    return actual.every((key, index) => key === expectedKeys[index]);
  } catch {
    return false;
  }
}

function boundedIdentifier(
  value: unknown,
  minimum: number,
  maximum: number
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    SAFE_IDENTIFIER.test(value)
  );
}

function isDigest(value: unknown): value is StudioSha256Digest {
  return typeof value === "string" && SHA256_DIGEST.test(value);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isSignatureAlgorithm(
  value: unknown
): value is StudioExternalConformanceSignatureAlgorithm {
  return value === "ed25519" || value === "ecdsa-p256-sha256";
}

function isOutcome(value: unknown): value is StudioExternalConformanceOutcome {
  return value === "passed" || value === "failed" || value === "indeterminate";
}

function parsePayloadRecord(
  value: unknown
): StudioExternalConformanceAttestationPayload {
  if (!isPlainDataRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "External conformance payload has an invalid field set."
    );
  }
  if (
    value.schema !== STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA ||
    value.schemaVersion !== STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA_VERSION ||
    !boundedIdentifier(value.provider, 1, 128) ||
    !boundedIdentifier(value.vendor, 1, 128) ||
    !boundedIdentifier(value.standard, 1, 128) ||
    !boundedIdentifier(value.profile, 1, 128) ||
    !boundedIdentifier(value.standardVersion, 1, 64) ||
    !boundedIdentifier(value.toolVersion, 1, 64) ||
    !isOutcome(value.outcome) ||
    !isDigest(value.documentDigest) ||
    !isDigest(value.resultDigest) ||
    !isDigest(value.evidenceDigest) ||
    !canonicalTimestamp(value.signedAt) ||
    !canonicalTimestamp(value.expiresAt) ||
    !boundedIdentifier(value.nonce, 16, 128) ||
    !boundedIdentifier(value.keyId, 1, 128) ||
    !isSignatureAlgorithm(value.signatureAlgorithm)
  ) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "External conformance payload is outside the bounded schema."
    );
  }
  return Object.freeze({
    schema: value.schema,
    schemaVersion: value.schemaVersion,
    provider: value.provider,
    vendor: value.vendor,
    standard: value.standard,
    profile: value.profile,
    standardVersion: value.standardVersion,
    toolVersion: value.toolVersion,
    outcome: value.outcome,
    documentDigest: value.documentDigest,
    resultDigest: value.resultDigest,
    evidenceDigest: value.evidenceDigest,
    signedAt: value.signedAt,
    expiresAt: value.expiresAt,
    nonce: value.nonce,
    keyId: value.keyId,
    signatureAlgorithm: value.signatureAlgorithm,
  });
}

function canonicalJsonRecord(record: Readonly<Record<string, unknown>>): string {
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(record[key])}`)
    .join(",")}}`;
}

function payloadRecord(
  payload: StudioExternalConformanceAttestationPayload
): Readonly<Record<string, unknown>> {
  return {
    schema: payload.schema,
    schemaVersion: payload.schemaVersion,
    provider: payload.provider,
    vendor: payload.vendor,
    standard: payload.standard,
    profile: payload.profile,
    standardVersion: payload.standardVersion,
    toolVersion: payload.toolVersion,
    outcome: payload.outcome,
    documentDigest: payload.documentDigest,
    resultDigest: payload.resultDigest,
    evidenceDigest: payload.evidenceDigest,
    signedAt: payload.signedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    keyId: payload.keyId,
    signatureAlgorithm: payload.signatureAlgorithm,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    return null;
  }
  const padding = (4 - (value.length % 4)) % 4;
  try {
    const binary = atob(
      value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(padding)
    );
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function bigIntFromBigEndian(bytes: Uint8Array): bigint {
  let value = BIGINT_ZERO;
  for (const byte of bytes) value = (value << BIGINT_EIGHT) | BigInt(byte);
  return value;
}

function signatureHasCanonicalShape(
  algorithm: StudioExternalConformanceSignatureAlgorithm,
  signature: Uint8Array
): boolean {
  if (algorithm === "ed25519") {
    return signature.byteLength === ED25519_SIGNATURE_BYTES;
  }
  if (signature.byteLength !== ECDSA_P256_SIGNATURE_BYTES) return false;
  const r = bigIntFromBigEndian(signature.subarray(0, ECDSA_P256_SCALAR_BYTES));
  const s = bigIntFromBigEndian(signature.subarray(ECDSA_P256_SCALAR_BYTES));
  return (
    r > BIGINT_ZERO &&
    r < ECDSA_P256_ORDER &&
    s > BIGINT_ZERO &&
    s <= ECDSA_P256_HALF_ORDER
  );
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

function subtleCrypto(override: SubtleCrypto | undefined): SubtleCrypto | null {
  return override ?? globalThis.crypto?.subtle ?? null;
}

async function sha256(
  bytes: Uint8Array,
  subtle: SubtleCrypto
): Promise<StudioSha256Digest> {
  const digest = new Uint8Array(
    await subtle.digest("SHA-256", ownedBuffer(bytes))
  );
  return `sha256:${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function keyMatchesAlgorithm(
  key: CryptoKey,
  algorithm: StudioExternalConformanceSignatureAlgorithm
): boolean {
  if (key.type !== "public" || !key.usages.includes("verify")) return false;
  if (algorithm === "ed25519") {
    return key.algorithm.name.toLowerCase() === "ed25519";
  }
  const ec = key.algorithm as EcKeyAlgorithm;
  return ec.name === "ECDSA" && ec.namedCurve === "P-256";
}

function algorithmIdentifier(
  algorithm: StudioExternalConformanceSignatureAlgorithm
): AlgorithmIdentifier | EcdsaParams {
  return algorithm === "ed25519"
    ? "Ed25519"
    : { name: "ECDSA", hash: "SHA-256" };
}

function safeConfigurationNumber(
  value: number | undefined,
  fallback: number,
  maximum: number
): number | null {
  const resolved = value ?? fallback;
  return Number.isSafeInteger(resolved) && resolved >= 0 && resolved <= maximum
    ? resolved
    : null;
}

function validExpectedClaim(
  value: unknown
): value is StudioExternalConformanceExpectedClaim {
  try {
    if (typeof value !== "object" || value === null) return false;
    const expected = value as Partial<StudioExternalConformanceExpectedClaim>;
    return (
      boundedIdentifier(expected.standard, 1, 128) &&
      boundedIdentifier(expected.profile, 1, 128) &&
      boundedIdentifier(expected.standardVersion, 1, 64) &&
      isDigest(expected.documentDigest) &&
      boundedIdentifier(expected.nonce, 16, 128)
    );
  } catch {
    return false;
  }
}

function trustRootMatches(
  root: StudioExternalConformanceTrustRoot,
  attestation: StudioExternalConformanceAttestation
): boolean {
  try {
    return (
      root.provider === attestation.provider &&
      root.vendor === attestation.vendor &&
      root.keyId === attestation.keyId &&
      root.signatureAlgorithm === attestation.signatureAlgorithm &&
      Array.isArray(root.scopes) &&
      root.scopes.some(
        (scope) =>
          scope.standard === attestation.standard &&
          scope.profile === attestation.profile &&
          scope.standardVersion === attestation.standardVersion
      )
    );
  } catch {
    return false;
  }
}

export function parseStudioExternalConformanceAttestationPayload(
  value: unknown
): StudioExternalConformanceAttestationPayload {
  return parsePayloadRecord(value);
}

export function parseStudioExternalConformanceAttestation(
  value: unknown
): StudioExternalConformanceAttestation {
  if (!isPlainDataRecord(value) || !hasExactKeys(value, ATTESTATION_KEYS)) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "External conformance attestation has an invalid field set."
    );
  }
  const { signatureBytes, ...candidatePayload } = value;
  const payload = parsePayloadRecord(candidatePayload);
  if (typeof signatureBytes !== "string" || signatureBytes.length > 128) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "External conformance signature is outside the bounded schema."
    );
  }
  const signature = decodeBase64Url(signatureBytes);
  if (!signature || !signatureHasCanonicalShape(payload.signatureAlgorithm, signature)) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "External conformance signature is not canonical."
    );
  }
  return Object.freeze({ ...payload, signatureBytes });
}

export function canonicalStudioExternalConformancePayloadJson(
  value: unknown
): string {
  return canonicalJsonRecord(payloadRecord(parsePayloadRecord(value)));
}

export function canonicalStudioExternalConformanceSigningBytes(
  value: unknown
): Uint8Array {
  const canonical = canonicalStudioExternalConformancePayloadJson(value);
  const bytes = TEXT_ENCODER.encode(`${SIGNING_DOMAIN}${canonical}`);
  if (bytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new StudioExternalConformanceAttestationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "External conformance signing payload exceeds its byte budget."
    );
  }
  return bytes;
}

export function canonicalStudioExternalConformanceAttestationJson(
  value: unknown
): string {
  const attestation = parseStudioExternalConformanceAttestation(value);
  return canonicalJsonRecord({
    ...payloadRecord(attestation),
    signatureBytes: attestation.signatureBytes,
  });
}

export function encodeStudioExternalConformanceAttestation(
  value: unknown
): Uint8Array {
  const bytes = TEXT_ENCODER.encode(
    canonicalStudioExternalConformanceAttestationJson(value)
  );
  if (bytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new StudioExternalConformanceAttestationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "External conformance attestation exceeds its byte budget."
    );
  }
  return bytes;
}

export function decodeStudioExternalConformanceAttestation(
  bytes: Uint8Array
): StudioExternalConformanceAttestation {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new StudioExternalConformanceAttestationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "External conformance attestation exceeds its byte budget."
    );
  }
  let text: string;
  let value: unknown;
  try {
    text = STRICT_TEXT_DECODER.decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new StudioExternalConformanceAttestationError(
      "CANONICAL_ENCODING_INVALID",
      "External conformance attestation is not canonical UTF-8 JSON."
    );
  }
  const attestation = parseStudioExternalConformanceAttestation(value);
  if (canonicalStudioExternalConformanceAttestationJson(attestation) !== text) {
    throw new StudioExternalConformanceAttestationError(
      "CANONICAL_ENCODING_INVALID",
      "External conformance attestation JSON is not canonical."
    );
  }
  return attestation;
}

export async function digestStudioExternalConformanceEvidence(
  bytes: Uint8Array,
  subtleOverride?: SubtleCrypto
): Promise<StudioSha256Digest> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new StudioExternalConformanceAttestationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "External conformance evidence exceeds its byte budget."
    );
  }
  const subtle = subtleCrypto(subtleOverride);
  if (!subtle) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "Web Crypto SubtleCrypto is unavailable."
    );
  }
  return sha256(bytes, subtle);
}

export function createStudioPublicSpecificationSelfValidationReceipt(
  input: Omit<
    StudioPublicSpecificationSelfValidationReceipt,
    | "kind"
    | "assurance"
    | "externalAttestationAccepted"
    | "officialCertificationIssuedByProduct"
    | "trademarkApprovalIssuedByProduct"
  >
): StudioPublicSpecificationSelfValidationReceipt {
  if (
    !boundedIdentifier(input.standard, 1, 128) ||
    !boundedIdentifier(input.profile, 1, 128) ||
    !boundedIdentifier(input.standardVersion, 1, 64) ||
    !isDigest(input.documentDigest) ||
    !isDigest(input.evidenceDigest) ||
    !canonicalTimestamp(input.validatedAt)
  ) {
    throw new StudioExternalConformanceAttestationError(
      "SCHEMA_INVALID",
      "Public specification self-validation receipt is invalid."
    );
  }
  return Object.freeze({
    kind: "studio-public-specification-self-validation",
    standard: input.standard,
    profile: input.profile,
    standardVersion: input.standardVersion,
    documentDigest: input.documentDigest,
    evidenceDigest: input.evidenceDigest,
    validatedAt: input.validatedAt,
    assurance: "self-validation",
    externalAttestationAccepted: false,
    officialCertificationIssuedByProduct: false,
    trademarkApprovalIssuedByProduct: false,
  });
}

export async function verifyStudioExternalConformanceAttestation(
  value: unknown,
  options: StudioExternalConformanceVerificationOptions
): Promise<StudioExternalConformanceVerificationResult> {
  let attestation: StudioExternalConformanceAttestation;
  try {
    attestation = parseStudioExternalConformanceAttestation(value);
  } catch {
    return rejected("schema-invalid");
  }
  if (!validExpectedClaim(options.expected)) return rejected("expectation-invalid");
  if (attestation.outcome !== "passed") return rejected("claim-not-passed");
  if (
    attestation.standard !== options.expected.standard ||
    attestation.profile !== options.expected.profile ||
    attestation.standardVersion !== options.expected.standardVersion ||
    attestation.nonce !== options.expected.nonce
  ) {
    return rejected("claim-mismatch");
  }
  if (attestation.documentDigest !== options.expected.documentDigest) {
    return rejected("document-digest-mismatch");
  }
  if (
    !(options.resultBytes instanceof Uint8Array) ||
    !(options.evidenceBytes instanceof Uint8Array) ||
    options.resultBytes.byteLength === 0 ||
    options.evidenceBytes.byteLength === 0 ||
    options.resultBytes.byteLength > MAX_RESULT_BYTES ||
    options.evidenceBytes.byteLength > MAX_EVIDENCE_BYTES
  ) {
    return rejected("resource-limit-exceeded");
  }
  const clockSkewMs = safeConfigurationNumber(
    options.maxClockSkewMs,
    DEFAULT_MAX_CLOCK_SKEW_MS,
    MAX_CONFIGURED_CLOCK_SKEW_MS
  );
  const maxLifetimeMs = safeConfigurationNumber(
    options.maxLifetimeMs,
    DEFAULT_MAX_LIFETIME_MS,
    MAX_CONFIGURED_LIFETIME_MS
  );
  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : options.now ?? Date.now();
  if (
    clockSkewMs === null ||
    maxLifetimeMs === null ||
    !Number.isFinite(nowMs)
  ) {
    return rejected("expectation-invalid");
  }
  const signedAtMs = Date.parse(attestation.signedAt);
  const expiresAtMs = Date.parse(attestation.expiresAt);
  if (
    expiresAtMs <= signedAtMs ||
    expiresAtMs - signedAtMs > maxLifetimeMs
  ) {
    return rejected("lifetime-invalid");
  }
  if (signedAtMs > nowMs + clockSkewMs) return rejected("not-yet-valid");
  if (expiresAtMs <= nowMs) return rejected("expired");

  const subtle = subtleCrypto(options.subtle);
  if (!subtle) return rejected("crypto-unavailable");
  let resultDigest: StudioSha256Digest;
  let evidenceDigest: StudioSha256Digest;
  try {
    [resultDigest, evidenceDigest] = await Promise.all([
      sha256(options.resultBytes, subtle),
      sha256(options.evidenceBytes, subtle),
    ]);
  } catch {
    return rejected("crypto-unavailable");
  }
  if (resultDigest !== attestation.resultDigest) {
    return rejected("result-digest-mismatch");
  }
  if (evidenceDigest !== attestation.evidenceDigest) {
    return rejected("evidence-digest-mismatch");
  }

  let matchingRoots: readonly StudioExternalConformanceTrustRoot[];
  try {
    matchingRoots = (
      options.trustRoots ?? STUDIO_EXTERNAL_CONFORMANCE_DEFAULT_TRUST_ROOTS
    ).filter((root) => trustRootMatches(root, attestation));
  } catch {
    return rejected("trust-root-not-found");
  }
  if (matchingRoots.length === 0) return rejected("trust-root-not-found");
  if (matchingRoots.length !== 1) return rejected("trust-root-ambiguous");
  const trustRoot = matchingRoots[0];
  if (!trustRoot || !keyMatchesAlgorithm(trustRoot.publicKey, attestation.signatureAlgorithm)) {
    return rejected("trust-key-invalid");
  }
  const signature = decodeBase64Url(attestation.signatureBytes);
  if (!signature || !signatureHasCanonicalShape(attestation.signatureAlgorithm, signature)) {
    return rejected("signature-invalid");
  }
  let signatureValid: boolean;
  try {
    signatureValid = await subtle.verify(
      algorithmIdentifier(attestation.signatureAlgorithm),
      trustRoot.publicKey,
      ownedBuffer(signature),
      ownedBuffer(
        canonicalStudioExternalConformanceSigningBytes(payloadRecord(attestation))
      )
    );
  } catch {
    return rejected("signature-invalid");
  }
  if (!signatureValid) return rejected("signature-invalid");

  let attestationDigest: StudioSha256Digest;
  try {
    attestationDigest = await sha256(
      encodeStudioExternalConformanceAttestation(attestation),
      subtle
    );
  } catch {
    return rejected("crypto-unavailable");
  }
  let acceptedAt: string;
  try {
    acceptedAt = new Date(nowMs).toISOString();
  } catch {
    return rejected("expectation-invalid");
  }
  if (!options.consumeNonce) return rejected("nonce-verifier-unavailable");
  const nonceContext = Object.freeze({
    nonce: attestation.nonce,
    attestationDigest,
    provider: attestation.provider,
    vendor: attestation.vendor,
    standard: attestation.standard,
    profile: attestation.profile,
    documentDigest: attestation.documentDigest,
    expiresAt: attestation.expiresAt,
  });
  let nonceAccepted: boolean;
  try {
    nonceAccepted = await options.consumeNonce(nonceContext);
  } catch {
    return rejected("nonce-replayed");
  }
  if (nonceAccepted !== true) return rejected("nonce-replayed");

  const receipt: StudioExternalConformanceAcceptanceReceipt = Object.freeze({
    kind: "studio-external-conformance-attestation-acceptance",
    attestationDigest,
    provider: attestation.provider,
    vendor: attestation.vendor,
    standard: attestation.standard,
    profile: attestation.profile,
    standardVersion: attestation.standardVersion,
    toolVersion: attestation.toolVersion,
    outcome: "passed",
    documentDigest: attestation.documentDigest,
    resultDigest: attestation.resultDigest,
    evidenceDigest: attestation.evidenceDigest,
    signedAt: attestation.signedAt,
    expiresAt: attestation.expiresAt,
    keyId: attestation.keyId,
    signatureAlgorithm: attestation.signatureAlgorithm,
    acceptedAt,
    assurance: "external-provider-attestation-accepted",
    officialCertificationIssuedByProduct: false,
    trademarkApprovalIssuedByProduct: false,
    selfValidationReceiptIssued: false,
  });
  return Object.freeze({ accepted: true, receipt });
}

export async function verifyStudioExternalConformanceProviderSource<TSource>(
  adapter: StudioExternalConformanceProviderAdapter<TSource>,
  source: TSource,
  options: StudioExternalConformanceProviderVerificationOptions
): Promise<StudioExternalConformanceVerificationResult> {
  try {
    if (
      !boundedIdentifier(adapter.adapterId, 1, 128) ||
      typeof adapter.read !== "function"
    ) {
      return rejected("provider-adapter-failed");
    }
  } catch {
    return rejected("provider-adapter-failed");
  }
  let bundle: StudioExternalConformanceProviderBundle;
  try {
    bundle = await adapter.read(source);
  } catch {
    return rejected("provider-adapter-failed");
  }
  if (
    !isPlainDataRecord(bundle) ||
    !hasExactKeys(bundle, ["attestation", "evidenceBytes", "resultBytes"]) ||
    !(bundle.resultBytes instanceof Uint8Array) ||
    !(bundle.evidenceBytes instanceof Uint8Array)
  ) {
    return rejected("provider-adapter-failed");
  }
  try {
    return verifyStudioExternalConformanceAttestation(bundle.attestation, {
      ...options,
      resultBytes: bundle.resultBytes.slice(),
      evidenceBytes: bundle.evidenceBytes.slice(),
    });
  } catch {
    return rejected("provider-adapter-failed");
  }
}
