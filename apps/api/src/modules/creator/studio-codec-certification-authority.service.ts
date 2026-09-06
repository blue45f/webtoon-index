import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

import {
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { z } from "zod";

import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  STUDIO_CODEC_PROVIDER_LIMITS,
} from "../../../../web/src/domains/creator/studio-codec-provider-contract";
import {
  STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION,
  STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS,
  STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS,
} from "../../../../web/src/domains/creator/studio-product-codec-certification";

const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const TEXT_ENCODER = new TextEncoder();
const MAX_CONCURRENT_ADAPTER_OPERATIONS = 8;
const DEFAULT_SIGNING_TIMEOUT_MS = 15_000;
const MIN_SIGNING_TIMEOUT_MS = 100;
const MAX_SIGNING_TIMEOUT_MS = 60_000;
const ADAPTER_OPERATION_QUARANTINE_MS = 1_000;
const MAX_SIGNER_SCOPES = 64;
const MAX_KEY_ID_CODE_UNITS = 128;
const MAX_VALIDITY_MILLISECONDS = 366 * 24 * 60 * 60 * 1_000;
const MAX_ISSUED_AT_AGE_MILLISECONDS = 5 * 60 * 1_000;
const MAX_CLOCK_SKEW_MILLISECONDS = 60 * 1_000;
const ECDSA_P256_SCALAR_BYTES = 32;
const SIGNATURE_BYTES = 64;
const ECDSA_P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const ECDSA_P256_HALF_ORDER = ECDSA_P256_ORDER >> BigInt(1);

export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNER = Symbol(
  "STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNER"
);
export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_EXECUTION_VERIFIER = Symbol(
  "STUDIO_CODEC_CERTIFICATION_AUTHORITY_EXECUTION_VERIFIER"
);
export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_CLOCK = Symbol(
  "STUDIO_CODEC_CERTIFICATION_AUTHORITY_CLOCK"
);

export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_VERSION = 1 as const;
export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_KIND =
  "toonspectrum-product-codec-authority-signing-request" as const;
export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_VERSION = 1 as const;
export const STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_KIND =
  "toonspectrum-product-codec-authority-signature" as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_KEY_ID_CODE_UNITS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u);
const ScopeSchema = z
  .string()
  .min(3)
  .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxScopeCodeUnits)
  .regex(/^[a-z][a-z0-9]*(?:[.:/_-][a-z0-9]+)+$/u);
const AlgorithmSchema = z.enum(["ed25519", "ecdsa-p256-sha256"]);
const Sha256Schema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u);
const CanonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
  });
const MimeTypeSchema = z
  .string()
  .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceMediaTypeCodeUnits)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u);
const ExtensionSchema = z
  .string()
  .regex(/^\.[a-z0-9][a-z0-9._+-]{0,31}$/u);
const CanonicalBytesSchema = z.custom<Uint8Array>(
  (value) =>
    value instanceof Uint8Array
    && value.byteLength > 0
    && value.byteLength
      <= STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes,
  "Canonical certificate signing bytes are invalid or exceed their budget."
);

export const StudioCodecCertificationAuthoritySigningRequestSchema = z
  .object({
    schemaVersion: z.literal(
      STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_VERSION
    ),
    kind: z.literal(STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_KIND),
    algorithm: AlgorithmSchema,
    keyId: IdentifierSchema,
    scope: ScopeSchema,
    executionId: IdentifierSchema,
    canonicalByteLength: z
      .number()
      .int()
      .positive()
      .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes),
    canonicalSha256: Sha256Schema,
    canonicalBytes: CanonicalBytesSchema,
  })
  .strict();

export type StudioCodecCertificationAuthoritySigningRequest = z.infer<
  typeof StudioCodecCertificationAuthoritySigningRequestSchema
>;

const DigestSchema = z
  .object({
    byteLength: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes),
    sha256: Sha256Schema,
  })
  .strict();
const InputDigestSchema = DigestSchema.extend({
  byteLength: z
    .number()
    .int()
    .min(0)
    .max(STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes),
}).strict();
const EvidenceSchema = DigestSchema.extend({
  byteLength: z
    .number()
    .int()
    .positive()
    .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes),
  mediaType: MimeTypeSchema,
}).strict();
const LicenseScopeSchema = z.enum([
  "browser-runtime",
  "commercial-use",
  "decode",
  "encode",
  "licensed-sdk",
  "public-clean-room",
  "remote-provider",
]);
const ProviderModeSchema = z.enum([
  "browser-runtime",
  "licensed-sdk",
  "public-clean-room",
  "remote-provider",
]);
const DirectionSchema = z.enum(["decode", "encode"]);
const LicenseGrantSchema = z
  .object({
    id: IdentifierSchema,
    scope: z
      .array(LicenseScopeSchema)
      .max(STUDIO_CODEC_PROVIDER_LIMITS.maxLicenseScopes)
      .refine((value) => new Set(value).size === value.length),
    expiresAt: CanonicalTimestampSchema.nullable(),
  })
  .strict();
const ReceiptSchema = z
  .object({
    schemaVersion: z.literal(STUDIO_CODEC_PROVIDER_CONTRACT_VERSION),
    kind: z.literal("toonspectrum-codec-provider-execution"),
    providerId: IdentifierSchema,
    mode: ProviderModeSchema,
    direction: DirectionSchema,
    format: IdentifierSchema,
    profile: IdentifierSchema,
    version: IdentifierSchema,
    mimeType: MimeTypeSchema,
    extension: ExtensionSchema,
    deterministic: z.boolean(),
    input: InputDigestSchema,
    output: DigestSchema,
    licenseGrant: LicenseGrantSchema,
    officialClaims: z
      .object({
        externalAttestationAccepted: z.literal(false),
        officialCodec: z.literal(false),
        certified: z.literal(false),
        trademarkAuthorized: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (!receipt.licenseGrant.scope.includes(receipt.mode)) {
      context.addIssue({
        code: "custom",
        path: ["licenseGrant", "scope"],
        message: "Provider mode is outside the license grant.",
      });
    }
    if (!receipt.licenseGrant.scope.includes(receipt.direction)) {
      context.addIssue({
        code: "custom",
        path: ["licenseGrant", "scope"],
        message: "Provider direction is outside the license grant.",
      });
    }
  });
const ExactCertificationClaimsSchema = z
  .object({
    authority: z.literal(STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS.authority),
    program: z.literal(STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS.program),
    officialToonSpectrumProductCertification: z.literal(true),
    thirdPartyCodecCertification: z.literal(false),
    codecVendorCertification: z.literal(false),
    officialCodecVendorClaim: z.literal(false),
    trademarkAuthorization: z.literal(false),
  })
  .strict();
const CertificateCoreSchema = z
  .object({
    certification: ExactCertificationClaimsSchema,
    evidence: EvidenceSchema,
    kind: z.literal(STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND),
    nonce: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]{43}$/u),
    output: DigestSchema,
    receipt: ReceiptSchema,
    receiptSha256: Sha256Schema,
    schemaVersion: z.literal(STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION),
    scope: ScopeSchema,
    signer: z
      .object({
        algorithm: AlgorithmSchema,
        keyId: IdentifierSchema,
      })
      .strict(),
    validity: z
      .object({
        issuedAt: CanonicalTimestampSchema,
        notBefore: CanonicalTimestampSchema,
        expiresAt: CanonicalTimestampSchema,
      })
      .strict(),
  })
  .strict();
const UnsignedCertificateMessageSchema = z
  .object({
    certificateId: z
      .string()
      .regex(/^tspcc1:[0-9a-f]{64}$/u),
    core: CertificateCoreSchema,
  })
  .strict();

const SignerMetadataSchema = z
  .object({
    adapterKind: z.enum(["kms", "hsm"]),
    algorithm: AlgorithmSchema,
    keyId: IdentifierSchema,
    scopes: z
      .array(ScopeSchema)
      .min(1)
      .max(MAX_SIGNER_SCOPES)
      .refine((value) => new Set(value).size === value.length),
    validFrom: CanonicalTimestampSchema,
    validUntil: CanonicalTimestampSchema,
  })
  .strict();

export type StudioCodecCertificationAuthorityAlgorithm = z.infer<
  typeof AlgorithmSchema
>;

const SignatureValueSchema = z
  .string()
  .length(86)
  .regex(/^[A-Za-z0-9_-]{86}$/u)
  .refine((value) => {
    try {
      const bytes = Buffer.from(value, "base64url");
      return bytes.byteLength === SIGNATURE_BYTES
        && bytes.toString("base64url") === value;
    } catch {
      return false;
    }
  });

export const StudioCodecCertificationAuthoritySignatureSchema = z
  .object({
    schemaVersion: z.literal(
      STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_VERSION
    ),
    kind: z.literal(STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_KIND),
    algorithm: AlgorithmSchema,
    keyId: IdentifierSchema,
    scope: ScopeSchema,
    executionId: IdentifierSchema,
    canonicalByteLength: z
      .number()
      .int()
      .positive()
      .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes),
    canonicalSha256: Sha256Schema,
    signatureValue: SignatureValueSchema,
  })
  .strict()
  .superRefine((signature, context) => {
    const bytes = Buffer.from(signature.signatureValue, "base64url");
    if (!hasCanonicalSignatureShape(signature.algorithm, bytes)) {
      context.addIssue({
        code: "custom",
        path: ["signatureValue"],
        message: "Authority signature is not in canonical wire form.",
      });
    }
  });

export type StudioCodecCertificationAuthoritySignature = z.infer<
  typeof StudioCodecCertificationAuthoritySignatureSchema
>;

const ExecutionAuthorizationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reserved"),
      reservationId: IdentifierSchema,
      attemptId: IdentifierSchema,
      admissionLeaseId: IdentifierSchema,
      expiresAt: CanonicalTimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("completed"),
      signature: StudioCodecCertificationAuthoritySignatureSchema,
    })
    .strict(),
]);

const VerifiedProviderExecutionSchema = z
  .object({
    verified: z.literal(true),
    executionId: IdentifierSchema,
    canonicalByteLength: z
      .number()
      .int()
      .positive()
      .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes),
    canonicalSha256: Sha256Schema,
    receiptByteLength: z
      .number()
      .int()
      .positive()
      .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxReceiptBytes),
    receiptSha256: Sha256Schema,
    outputByteLength: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes),
    outputSha256: Sha256Schema,
    evidenceByteLength: z
      .number()
      .int()
      .positive()
      .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes),
    evidenceSha256: Sha256Schema,
    evidenceMediaType: MimeTypeSchema,
    providerId: IdentifierSchema,
    mode: ProviderModeSchema,
    direction: DirectionSchema,
    format: IdentifierSchema,
    profile: IdentifierSchema,
    version: IdentifierSchema,
    mimeType: MimeTypeSchema,
    extension: ExtensionSchema,
    deterministic: z.boolean(),
    inputByteLength: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes),
    inputSha256: Sha256Schema,
    licenseGrantId: IdentifierSchema,
    licenseGrantScopes: z
      .array(LicenseScopeSchema)
      .min(1)
      .max(STUDIO_CODEC_PROVIDER_LIMITS.maxLicenseScopes)
      .refine((value) => new Set(value).size === value.length),
    licenseGrantExpiresAt: CanonicalTimestampSchema.nullable(),
    authorization: ExecutionAuthorizationSchema,
  })
  .strict();
const RejectedProviderExecutionSchema = z
  .object({
    verified: z.literal(false),
  })
  .strict();
const ProviderExecutionVerificationResultSchema = z.discriminatedUnion(
  "verified",
  [
    VerifiedProviderExecutionSchema,
    RejectedProviderExecutionSchema,
  ]
);

export type StudioCodecCertificationAuthorityExecutionVerificationResult =
  z.infer<typeof ProviderExecutionVerificationResultSchema>;

/**
 * Deployment-owned verification boundary. Implementations must resolve
 * `executionId` against server-owned storage, streams, or a trusted provider
 * receipt and independently hash the exact receipt/output/evidence bytes.
 * Returning browser-echoed digests or trusting a caller-provided boolean
 * violates this contract.
 */
export interface StudioCodecCertificationAuthorityExecutionVerifier {
  readonly verify: (
    request: Readonly<{
      executionId: string;
      scope: string;
      providerId: string;
      mode: z.infer<typeof ProviderModeSchema>;
      direction: z.infer<typeof DirectionSchema>;
      format: string;
      profile: string;
      version: string;
      mimeType: string;
      extension: string;
      signal: AbortSignal;
    }>
  ) => Promise<StudioCodecCertificationAuthorityExecutionVerificationResult>;
  /**
   * Mandatory two-phase one-use boundary. A successful verification either
   * owns a fenced live reservation or carries a durable completed signature.
   * The authority stores the independently verified signature atomically with
   * consumption; transient signer failures release only the owning attempt.
   */
  readonly complete: (
    request:
    | Readonly<{
      executionId: string;
      reservationId: string;
      attemptId: string;
      admissionLeaseId: string;
      outcome: "consume";
      signature: StudioCodecCertificationAuthoritySignature;
      signal: AbortSignal;
    }>
    | Readonly<{
      executionId: string;
      reservationId: string;
      attemptId: string;
      admissionLeaseId: string;
      outcome: "reject" | "release";
      signal: AbortSignal;
    }>
  ) => Promise<boolean>;
}

/**
 * A server-owned KMS/HSM adapter. It exposes signing capability and public
 * metadata only; raw, wrapped, or exportable private-key material is not part
 * of this contract.
 */
export interface StudioCodecCertificationAuthoritySigner {
  readonly adapterKind: "kms" | "hsm";
  readonly algorithm: StudioCodecCertificationAuthorityAlgorithm;
  readonly keyId: string;
  readonly scopes: readonly string[];
  readonly validFrom: string;
  readonly validUntil: string;
  /**
   * Returns a canonical 64-byte signature: Ed25519 raw bytes or ECDSA P-256
   * IEEE-P1363 r || low-s bytes. DER conversion and low-s normalization belong
   * inside the deployment-owned adapter.
   */
  readonly sign: (
    request: Readonly<{
      algorithm: StudioCodecCertificationAuthorityAlgorithm;
      keyId: string;
      scope: string;
      canonicalBytes: Uint8Array;
      canonicalByteLength: number;
      canonicalSha256: `sha256:${string}`;
      signal: AbortSignal;
    }>
  ) => Promise<Uint8Array>;
  /**
   * Cryptographically verifies the exact signature returned by `sign` using
   * the deployment-pinned public key or the KMS/HSM verify operation.
   */
  readonly verify: (
    request: Readonly<{
      algorithm: StudioCodecCertificationAuthorityAlgorithm;
      keyId: string;
      scope: string;
      canonicalBytes: Uint8Array;
      canonicalByteLength: number;
      canonicalSha256: `sha256:${string}`;
      signatureBytes: Uint8Array;
      signal: AbortSignal;
    }>
  ) => Promise<boolean>;
}

export interface StudioCodecCertificationAuthorityClock {
  readonly now: () => number;
}

export interface StudioCodecCertificationAuthoritySignOptions {
  readonly signal?: AbortSignal;
  readonly verificationTimeoutMs?: number;
  readonly finalizationTimeoutMs?: number;
  readonly signingTimeoutMs?: number;
  readonly signatureVerificationTimeoutMs?: number;
  /** @deprecated Use `signingTimeoutMs`; retained for the initial internal API. */
  readonly timeoutMs?: number;
}

export type StudioCodecCertificationAuthorityErrorCode =
  | "ABORTED"
  | "BUSY"
  | "CERTIFICATE_TIME_INVALID"
  | "DIGEST_MISMATCH"
  | "EXECUTION_NOT_VERIFIED"
  | "EXECUTION_FINALIZATION_FAILED"
  | "EXECUTION_FINALIZATION_TIMEOUT"
  | "EXECUTION_VERIFICATION_FAILED"
  | "EXECUTION_VERIFICATION_MISMATCH"
  | "EXECUTION_VERIFICATION_TIMEOUT"
  | "EXECUTION_VERIFIER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_SIGNATURE"
  | "NON_CANONICAL_MESSAGE"
  | "SIGNER_FAILED"
  | "SIGNER_POLICY_MISMATCH"
  | "SIGNER_TIMEOUT"
  | "SIGNER_UNAVAILABLE"
  | "SIGNATURE_VERIFICATION_FAILED"
  | "SIGNATURE_VERIFICATION_TIMEOUT";

const STABLE_ERROR_MESSAGES = Object.freeze({
  ABORTED: "Codec certification signing was aborted.",
  BUSY: "Codec certification signing capacity is exhausted.",
  CERTIFICATE_TIME_INVALID:
    "Codec certification validity is outside the authority clock policy.",
  DIGEST_MISMATCH: "Codec certification signing bytes do not match their digest.",
  EXECUTION_NOT_VERIFIED:
    "Codec provider execution was not independently verified.",
  EXECUTION_FINALIZATION_FAILED:
    "Codec provider execution reservation finalization failed closed.",
  EXECUTION_FINALIZATION_TIMEOUT:
    "Codec provider execution reservation finalization timed out.",
  EXECUTION_VERIFICATION_FAILED:
    "Codec provider execution verification failed closed.",
  EXECUTION_VERIFICATION_MISMATCH:
    "Verified codec execution bytes or provenance do not match the certificate request.",
  EXECUTION_VERIFICATION_TIMEOUT:
    "Codec provider execution verification timed out.",
  EXECUTION_VERIFIER_UNAVAILABLE:
    "Codec provider execution verifier is unavailable.",
  INVALID_REQUEST: "Codec certification signing request is invalid.",
  INVALID_SIGNATURE: "Codec certification signer returned an invalid signature.",
  NON_CANONICAL_MESSAGE:
    "Codec certification signing message is not the exact canonical product certificate message.",
  SIGNER_FAILED: "Codec certification signer failed closed.",
  SIGNER_POLICY_MISMATCH:
    "Codec certification signing request is outside the configured signer policy.",
  SIGNER_TIMEOUT: "Codec certification signer timed out.",
  SIGNER_UNAVAILABLE: "Codec certification signer is unavailable.",
  SIGNATURE_VERIFICATION_FAILED:
    "Codec certification signature verification failed closed.",
  SIGNATURE_VERIFICATION_TIMEOUT:
    "Codec certification signature verification timed out.",
} satisfies Record<StudioCodecCertificationAuthorityErrorCode, string>);

export class StudioCodecCertificationAuthorityError extends Error {
  readonly code: StudioCodecCertificationAuthorityErrorCode;

  constructor(code: StudioCodecCertificationAuthorityErrorCode) {
    super(STABLE_ERROR_MESSAGES[code]);
    this.name = "StudioCodecCertificationAuthorityError";
    this.code = code;
  }
}

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function fail(code: StudioCodecCertificationAuthorityErrorCode): never {
  throw new StudioCodecCertificationAuthorityError(code);
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Readonly<Record<string, JsonValue>>)[key] as JsonValue
        )}`
    )
    .join(",")}}`;
}

function parseEpoch(value: string): number {
  return Date.parse(value);
}

function bigIntFromBigEndian(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (const byte of bytes) {
    value = (value << BigInt(8)) | BigInt(byte);
  }
  return value;
}

function hasCanonicalSignatureShape(
  algorithm: StudioCodecCertificationAuthorityAlgorithm,
  bytes: Uint8Array
): boolean {
  if (bytes.byteLength !== SIGNATURE_BYTES) return false;
  if (algorithm === "ed25519") return true;
  const r = bigIntFromBigEndian(
    bytes.subarray(0, ECDSA_P256_SCALAR_BYTES)
  );
  const s = bigIntFromBigEndian(
    bytes.subarray(ECDSA_P256_SCALAR_BYTES)
  );
  return (
    r > BigInt(0)
    && r < ECDSA_P256_ORDER
    && s > BigInt(0)
    && s <= ECDSA_P256_HALF_ORDER
  );
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function parseSigningRequest(
  source: unknown
): StudioCodecCertificationAuthoritySigningRequest {
  let parsed: ReturnType<
    typeof StudioCodecCertificationAuthoritySigningRequestSchema.safeParse
  >;
  try {
    parsed = StudioCodecCertificationAuthoritySigningRequestSchema.safeParse(
      source
    );
  } catch {
    fail("INVALID_REQUEST");
  }
  if (!parsed.success) fail("INVALID_REQUEST");
  return parsed.data;
}

function parseCanonicalCertificateMessage(
  request: StudioCodecCertificationAuthoritySigningRequest,
  ownedBytes: Uint8Array
): Readonly<{
  message: z.infer<typeof UnsignedCertificateMessageSchema>;
  receiptByteLength: number;
}> {
  if (
    ownedBytes.byteLength !== request.canonicalByteLength
    || !constantTimeDigestEquals(
      sha256(ownedBytes),
      request.canonicalSha256
    )
  ) {
    fail("DIGEST_MISMATCH");
  }

  let decoded: string;
  try {
    decoded = TEXT_DECODER.decode(ownedBytes);
  } catch {
    fail("NON_CANONICAL_MESSAGE");
  }
  const prefix = `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000`;
  if (!decoded.startsWith(prefix)) fail("NON_CANONICAL_MESSAGE");
  const serialized = decoded.slice(prefix.length);
  let unknownMessage: unknown;
  try {
    unknownMessage = JSON.parse(serialized);
  } catch {
    fail("NON_CANONICAL_MESSAGE");
  }
  const result = UnsignedCertificateMessageSchema.safeParse(unknownMessage);
  if (!result.success) fail("NON_CANONICAL_MESSAGE");
  const message = result.data;
  if (
    canonicalJson(message as JsonValue) !== serialized
    || message.core.scope !== request.scope
    || message.core.signer.algorithm !== request.algorithm
    || message.core.signer.keyId !== request.keyId
    || message.core.output.byteLength !== message.core.receipt.output.byteLength
    || message.core.output.sha256 !== message.core.receipt.output.sha256
  ) {
    fail("NON_CANONICAL_MESSAGE");
  }

  const receiptBytes = TEXT_ENCODER.encode(
    canonicalJson(message.core.receipt as JsonValue)
  );
  if (
    receiptBytes.byteLength
      > STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxReceiptBytes
    || !constantTimeDigestEquals(
      sha256(receiptBytes),
      message.core.receiptSha256
    )
  ) {
    fail("NON_CANONICAL_MESSAGE");
  }
  const expectedCertificateId = `tspcc1:${sha256(
    TEXT_ENCODER.encode(
      `${STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN}\u0000${canonicalJson(
        message.core as JsonValue
      )}`
    )
  ).slice("sha256:".length)}`;
  if (message.certificateId !== expectedCertificateId) {
    fail("NON_CANONICAL_MESSAGE");
  }

  const issuedAt = parseEpoch(message.core.validity.issuedAt);
  const notBefore = parseEpoch(message.core.validity.notBefore);
  const expiresAt = parseEpoch(message.core.validity.expiresAt);
  const licenseExpiresAt = message.core.receipt.licenseGrant.expiresAt === null
    ? null
    : parseEpoch(message.core.receipt.licenseGrant.expiresAt);
  if (
    issuedAt > notBefore
    || notBefore >= expiresAt
    || expiresAt - issuedAt > MAX_VALIDITY_MILLISECONDS
    || (licenseExpiresAt !== null && licenseExpiresAt < expiresAt)
  ) {
    fail("NON_CANONICAL_MESSAGE");
  }
  return Object.freeze({
    message,
    receiptByteLength: receiptBytes.byteLength,
  });
}

function signerMetadata(
  signer: StudioCodecCertificationAuthoritySigner
): z.infer<typeof SignerMetadataSchema> {
  let result: ReturnType<typeof SignerMetadataSchema.safeParse>;
  try {
    result = SignerMetadataSchema.safeParse({
      adapterKind: signer.adapterKind,
      algorithm: signer.algorithm,
      keyId: signer.keyId,
      scopes: signer.scopes,
      validFrom: signer.validFrom,
      validUntil: signer.validUntil,
    });
  } catch {
    fail("SIGNER_UNAVAILABLE");
  }
  if (!result.success) fail("SIGNER_UNAVAILABLE");
  return result.data;
}

function boundedTimeout(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value)
    || value < MIN_SIGNING_TIMEOUT_MS
    || value > MAX_SIGNING_TIMEOUT_MS
  ) {
    fail("INVALID_REQUEST");
  }
  return value;
}

function constantTimeDigestEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength
    && timingSafeEqual(leftBytes, rightBytes)
  );
}

interface AdapterOperationLease {
  readonly running: Promise<unknown>;
  quarantineTimer: ReturnType<typeof setTimeout> | null;
}

async function runBoundedAuthorityPhase<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: Readonly<{
    externalSignal?: AbortSignal;
    timeoutMs: number;
    failedCode:
      | "EXECUTION_FINALIZATION_FAILED"
      | "EXECUTION_VERIFICATION_FAILED"
      | "SIGNER_FAILED"
      | "SIGNATURE_VERIFICATION_FAILED";
    timeoutCode:
      | "EXECUTION_FINALIZATION_TIMEOUT"
      | "EXECUTION_VERIFICATION_TIMEOUT"
      | "SIGNER_TIMEOUT"
      | "SIGNATURE_VERIFICATION_TIMEOUT";
    leases: Set<AdapterOperationLease>;
  }>
): Promise<T> {
  if (options.externalSignal?.aborted) fail("ABORTED");
  if (
    options.leases.size
      >= MAX_CONCURRENT_ADAPTER_OPERATIONS
  ) {
    fail("BUSY");
  }
  const operationController = new AbortController();
  let termination: "external" | "timeout" | null = null;
  let abortRaceListener: (() => void) | null = null;
  let lease: AdapterOperationLease | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortRaceListener = () => reject(new Error("terminated"));
    operationController.signal.addEventListener(
      "abort",
      abortRaceListener,
      { once: true }
    );
    if (operationController.signal.aborted) abortRaceListener();
  });
  const abortExternally = () => {
    termination ??= "external";
    operationController.abort();
  };
  options.externalSignal?.addEventListener(
    "abort",
    abortExternally,
    { once: true }
  );
  if (options.externalSignal?.aborted) abortExternally();
  const timeout = setTimeout(() => {
    termination ??= "timeout";
    operationController.abort();
  }, options.timeoutMs);
  timeout.unref?.();

  try {
    const running = Promise.resolve().then(() =>
      operation(operationController.signal)
    );
    lease = {
      running,
      quarantineTimer: null,
    };
    options.leases.add(lease);
    const releaseLease = () => {
      if (!lease) return;
      if (lease.quarantineTimer !== null) {
        clearTimeout(lease.quarantineTimer);
        lease.quarantineTimer = null;
      }
      options.leases.delete(lease);
    };
    void running.then(
      releaseLease,
      releaseLease
    );
    try {
      return await Promise.race([running, aborted]);
    } catch {
      if (termination === "external") {
        throw new StudioCodecCertificationAuthorityError("ABORTED");
      }
      if (termination === "timeout") {
        throw new StudioCodecCertificationAuthorityError(
          options.timeoutCode
        );
      }
      throw new StudioCodecCertificationAuthorityError(options.failedCode);
    }
  } finally {
    clearTimeout(timeout);
    if (
      termination !== null
      && lease
      && options.leases.has(lease)
      && lease.quarantineTimer === null
    ) {
      // An adapter that ignores abort cannot retain process capacity forever.
      // Keep it fenced for a finite grace interval, then half-open the circuit.
      // Its late resolution/rejection remains observed by `releaseLease`.
      const quarantinedLease = lease;
      quarantinedLease.quarantineTimer = setTimeout(() => {
        quarantinedLease.quarantineTimer = null;
        options.leases.delete(quarantinedLease);
      }, ADAPTER_OPERATION_QUARANTINE_MS);
      quarantinedLease.quarantineTimer.unref?.();
    }
    options.externalSignal?.removeEventListener("abort", abortExternally);
    if (abortRaceListener) {
      operationController.signal.removeEventListener(
        "abort",
        abortRaceListener
      );
    }
  }
}

function parseExecutionVerificationResult(
  value: unknown
): StudioCodecCertificationAuthorityExecutionVerificationResult {
  let result: ReturnType<
    typeof ProviderExecutionVerificationResultSchema.safeParse
  >;
  try {
    result = ProviderExecutionVerificationResultSchema.safeParse(value);
  } catch {
    fail("EXECUTION_VERIFICATION_FAILED");
  }
  if (!result.success) fail("EXECUTION_VERIFICATION_FAILED");
  return result.data;
}

function executionVerificationMatches(
  verification: z.infer<typeof VerifiedProviderExecutionSchema>,
  request: StudioCodecCertificationAuthoritySigningRequest,
  message: z.infer<typeof UnsignedCertificateMessageSchema>,
  receiptByteLength: number
): boolean {
  const receipt = message.core.receipt;
  return (
    verification.executionId === request.executionId
    && verification.canonicalByteLength === request.canonicalByteLength
    && constantTimeDigestEquals(
      verification.canonicalSha256,
      request.canonicalSha256
    )
    && verification.receiptByteLength === receiptByteLength
    && constantTimeDigestEquals(
      verification.receiptSha256,
      message.core.receiptSha256
    )
    && verification.outputByteLength === message.core.output.byteLength
    && constantTimeDigestEquals(
      verification.outputSha256,
      message.core.output.sha256
    )
    && verification.evidenceByteLength === message.core.evidence.byteLength
    && constantTimeDigestEquals(
      verification.evidenceSha256,
      message.core.evidence.sha256
    )
    && verification.evidenceMediaType === message.core.evidence.mediaType
    && verification.providerId === receipt.providerId
    && verification.mode === receipt.mode
    && verification.direction === receipt.direction
    && verification.format === receipt.format
    && verification.profile === receipt.profile
    && verification.version === receipt.version
    && verification.mimeType === receipt.mimeType
    && verification.extension === receipt.extension
    && verification.deterministic === receipt.deterministic
    && verification.inputByteLength === receipt.input.byteLength
    && constantTimeDigestEquals(
      verification.inputSha256,
      receipt.input.sha256
    )
    && verification.licenseGrantId === receipt.licenseGrant.id
    && verification.licenseGrantScopes.length
      === receipt.licenseGrant.scope.length
    && verification.licenseGrantScopes.every(
      (scope, index) => scope === receipt.licenseGrant.scope[index]
    )
    && verification.licenseGrantExpiresAt
      === receipt.licenseGrant.expiresAt
  );
}

@Injectable()
export class StudioCodecCertificationAuthorityService {
  private readonly adapterOperationLeases = new Set<AdapterOperationLease>();

  constructor(
    @Optional()
    @Inject(STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNER)
    private readonly signer?: StudioCodecCertificationAuthoritySigner,
    @Optional()
    @Inject(STUDIO_CODEC_CERTIFICATION_AUTHORITY_EXECUTION_VERIFIER)
    private readonly executionVerifier?:
      StudioCodecCertificationAuthorityExecutionVerifier,
    @Optional()
    @Inject(STUDIO_CODEC_CERTIFICATION_AUTHORITY_CLOCK)
    private readonly clock?: StudioCodecCertificationAuthorityClock
  ) {}

  async signProductCertificateMessage(
    source: unknown,
    options: StudioCodecCertificationAuthoritySignOptions = {}
  ): Promise<StudioCodecCertificationAuthoritySignature> {
    const request = parseSigningRequest(source);
    let ownedBytes: Uint8Array;
    try {
      ownedBytes = Uint8Array.from(request.canonicalBytes);
    } catch {
      fail("INVALID_REQUEST");
    }
    const parsedMessage = parseCanonicalCertificateMessage(request, ownedBytes);
    const { message, receiptByteLength } = parsedMessage;
    const signer = this.signer;
    if (!signer || typeof signer.sign !== "function") {
      fail("SIGNER_UNAVAILABLE");
    }
    if (typeof signer.verify !== "function") {
      fail("SIGNER_UNAVAILABLE");
    }
    const executionVerifier = this.executionVerifier;
    if (
      !executionVerifier
      || typeof executionVerifier.verify !== "function"
      || typeof executionVerifier.complete !== "function"
    ) {
      fail("EXECUTION_VERIFIER_UNAVAILABLE");
    }
    const metadata = signerMetadata(signer);
    const validFrom = parseEpoch(metadata.validFrom);
    const validUntil = parseEpoch(metadata.validUntil);
    const issuedAt = parseEpoch(message.core.validity.issuedAt);
    const expiresAt = parseEpoch(message.core.validity.expiresAt);
    let nowEpochMs: number;
    try {
      nowEpochMs = this.clock?.now() ?? Date.now();
    } catch {
      fail("CERTIFICATE_TIME_INVALID");
    }
    if (
      !Number.isFinite(nowEpochMs)
      || issuedAt
        < nowEpochMs - MAX_ISSUED_AT_AGE_MILLISECONDS
      || issuedAt
        > nowEpochMs + MAX_CLOCK_SKEW_MILLISECONDS
      || expiresAt <= nowEpochMs
      || parseEpoch(message.core.validity.notBefore)
        > nowEpochMs + MAX_CLOCK_SKEW_MILLISECONDS
    ) {
      fail("CERTIFICATE_TIME_INVALID");
    }
    if (
      metadata.algorithm !== request.algorithm
      || metadata.keyId !== request.keyId
      || !metadata.scopes.includes(request.scope)
      || validFrom >= validUntil
      || issuedAt < validFrom
      || expiresAt > validUntil
    ) {
      fail("SIGNER_POLICY_MISMATCH");
    }

    if (
      options.timeoutMs !== undefined
      && options.signingTimeoutMs !== undefined
    ) {
      fail("INVALID_REQUEST");
    }
    const verificationTimeoutMs = boundedTimeout(
      options.verificationTimeoutMs,
      DEFAULT_SIGNING_TIMEOUT_MS
    );
    const finalizationTimeoutMs = boundedTimeout(
      options.finalizationTimeoutMs,
      DEFAULT_SIGNING_TIMEOUT_MS
    );
    const signingTimeoutMs = boundedTimeout(
      options.signingTimeoutMs ?? options.timeoutMs,
      DEFAULT_SIGNING_TIMEOUT_MS
    );
    const signatureVerificationTimeoutMs = boundedTimeout(
      options.signatureVerificationTimeoutMs,
      DEFAULT_SIGNING_TIMEOUT_MS
    );
    if (options.signal?.aborted) fail("ABORTED");
    const rawVerification = await runBoundedAuthorityPhase(
      (signal) =>
        executionVerifier.verify({
          executionId: request.executionId,
          scope: request.scope,
          providerId: message.core.receipt.providerId,
          mode: message.core.receipt.mode,
          direction: message.core.receipt.direction,
          format: message.core.receipt.format,
          profile: message.core.receipt.profile,
          version: message.core.receipt.version,
          mimeType: message.core.receipt.mimeType,
          extension: message.core.receipt.extension,
          signal,
        }),
      {
        externalSignal: options.signal,
        timeoutMs: verificationTimeoutMs,
        failedCode: "EXECUTION_VERIFICATION_FAILED",
        timeoutCode: "EXECUTION_VERIFICATION_TIMEOUT",
        leases: this.adapterOperationLeases,
      }
    );
    const verification = parseExecutionVerificationResult(rawVerification);
    if (!verification.verified) fail("EXECUTION_NOT_VERIFIED");
    const authorization = verification.authorization;
    const completeReservation = async (
      outcome: "consume" | "reject" | "release",
      signature?: StudioCodecCertificationAuthoritySignature
    ): Promise<void> => {
      if (authorization.status !== "reserved") return;
      if (outcome === "consume" && signature === undefined) {
        fail("EXECUTION_FINALIZATION_FAILED");
      }
      const completionRequest = outcome === "consume"
        ? {
            executionId: verification.executionId,
            reservationId: authorization.reservationId,
            attemptId: authorization.attemptId,
            admissionLeaseId: authorization.admissionLeaseId,
            outcome,
            signature: signature as StudioCodecCertificationAuthoritySignature,
            signal: new AbortController().signal,
          } as const
        : {
            executionId: verification.executionId,
            reservationId: authorization.reservationId,
            attemptId: authorization.attemptId,
            admissionLeaseId: authorization.admissionLeaseId,
            outcome,
            signal: new AbortController().signal,
          } as const;
      const completed = await runBoundedAuthorityPhase(
        (signal) =>
          executionVerifier.complete({
            ...completionRequest,
            signal,
          }),
        {
          timeoutMs: finalizationTimeoutMs,
          failedCode: "EXECUTION_FINALIZATION_FAILED",
          timeoutCode: "EXECUTION_FINALIZATION_TIMEOUT",
          leases: this.adapterOperationLeases,
        }
      );
      if (completed !== true) fail("EXECUTION_FINALIZATION_FAILED");
    };
    if (authorization.status === "reserved") {
      let postVerificationNowEpochMs: number;
      try {
        postVerificationNowEpochMs = this.clock?.now() ?? Date.now();
      } catch {
        await completeReservation("release");
        fail("CERTIFICATE_TIME_INVALID");
      }
      const minimumReservationExpiry =
        postVerificationNowEpochMs
        + signingTimeoutMs
        + signatureVerificationTimeoutMs
        + finalizationTimeoutMs
        + MAX_CLOCK_SKEW_MILLISECONDS;
      if (
        !Number.isFinite(postVerificationNowEpochMs)
        || parseEpoch(authorization.expiresAt) <= minimumReservationExpiry
      ) {
        await completeReservation("release");
        fail("EXECUTION_FINALIZATION_FAILED");
      }
    }
    if (
      !executionVerificationMatches(
        verification,
        request,
        message,
        receiptByteLength
      )
    ) {
      await completeReservation("reject");
      fail("EXECUTION_VERIFICATION_MISMATCH");
    }

    if (authorization.status === "completed") {
      const recoveredSignature = authorization.signature;
      if (
        recoveredSignature.algorithm !== request.algorithm
        || recoveredSignature.keyId !== request.keyId
        || recoveredSignature.scope !== request.scope
        || recoveredSignature.executionId !== request.executionId
        || recoveredSignature.canonicalByteLength !== ownedBytes.byteLength
        || !constantTimeDigestEquals(
          recoveredSignature.canonicalSha256,
          request.canonicalSha256
        )
      ) {
        fail("EXECUTION_VERIFICATION_MISMATCH");
      }
      const recoveredSignatureBytes = Buffer.from(
        recoveredSignature.signatureValue,
        "base64url"
      );
      if (
        !hasCanonicalSignatureShape(
          request.algorithm,
          recoveredSignatureBytes
        )
      ) {
        fail("INVALID_SIGNATURE");
      }
      const recoveredSignatureVerified = await runBoundedAuthorityPhase(
        (signal) =>
          signer.verify({
            algorithm: request.algorithm,
            keyId: request.keyId,
            scope: request.scope,
            canonicalBytes: Uint8Array.from(ownedBytes),
            canonicalByteLength: ownedBytes.byteLength,
            canonicalSha256: request.canonicalSha256 as `sha256:${string}`,
            signatureBytes: Uint8Array.from(recoveredSignatureBytes),
            signal,
          }),
        {
          externalSignal: options.signal,
          timeoutMs: signatureVerificationTimeoutMs,
          failedCode: "SIGNATURE_VERIFICATION_FAILED",
          timeoutCode: "SIGNATURE_VERIFICATION_TIMEOUT",
          leases: this.adapterOperationLeases,
        }
      );
      if (recoveredSignatureVerified !== true) fail("INVALID_SIGNATURE");
      return Object.freeze({ ...recoveredSignature });
    }

    let signatureBytes: Uint8Array;
    try {
      const returned = await runBoundedAuthorityPhase(
        (signal) =>
          signer.sign({
            algorithm: request.algorithm,
            keyId: request.keyId,
            scope: request.scope,
            canonicalBytes: Uint8Array.from(ownedBytes),
            canonicalByteLength: ownedBytes.byteLength,
            canonicalSha256: request.canonicalSha256 as `sha256:${string}`,
            signal,
          }),
        {
          externalSignal: options.signal,
          timeoutMs: signingTimeoutMs,
          failedCode: "SIGNER_FAILED",
          timeoutCode: "SIGNER_TIMEOUT",
          leases: this.adapterOperationLeases,
        }
      );
      if (!(returned instanceof Uint8Array)) fail("INVALID_SIGNATURE");
      signatureBytes = Uint8Array.from(returned);
      if (!hasCanonicalSignatureShape(request.algorithm, signatureBytes)) {
        fail("INVALID_SIGNATURE");
      }
      const signatureVerified = await runBoundedAuthorityPhase(
        (signal) =>
          signer.verify({
            algorithm: request.algorithm,
            keyId: request.keyId,
            scope: request.scope,
            canonicalBytes: Uint8Array.from(ownedBytes),
            canonicalByteLength: ownedBytes.byteLength,
            canonicalSha256: request.canonicalSha256 as `sha256:${string}`,
            signatureBytes: Uint8Array.from(signatureBytes),
            signal,
          }),
        {
          externalSignal: options.signal,
          timeoutMs: signatureVerificationTimeoutMs,
          failedCode: "SIGNATURE_VERIFICATION_FAILED",
          timeoutCode: "SIGNATURE_VERIFICATION_TIMEOUT",
          leases: this.adapterOperationLeases,
        }
      );
      if (signatureVerified !== true) fail("INVALID_SIGNATURE");
    } catch (error) {
      // A KMS/HSM failure must not burn verified execution evidence. Cleanup
      // deliberately ignores an already-aborted caller signal and uses its own
      // bounded phase so a user cancellation can still release the reservation.
      await completeReservation("release");
      if (error instanceof StudioCodecCertificationAuthorityError) {
        throw error;
      }
      fail("INVALID_SIGNATURE");
    }
    const signature = StudioCodecCertificationAuthoritySignatureSchema.parse({
      schemaVersion:
        STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_VERSION,
      kind: STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_KIND,
      algorithm: request.algorithm,
      keyId: request.keyId,
      scope: request.scope,
      executionId: request.executionId,
      canonicalByteLength: ownedBytes.byteLength,
      canonicalSha256: request.canonicalSha256 as `sha256:${string}`,
      signatureValue: base64Url(signatureBytes),
    });
    await completeReservation("consume", signature);
    return Object.freeze(signature);
  }
}
