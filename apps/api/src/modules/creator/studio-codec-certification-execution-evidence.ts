import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import {
  STUDIO_CODEC_PROVIDER_LIMITS,
} from "../../../../web/src/domains/creator/studio-codec-provider-contract";
import {
  STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS,
} from "../../../../web/src/domains/creator/studio-product-codec-certification";

import {
  StudioCodecCertificationAuthoritySignatureSchema,
  type StudioCodecCertificationAuthoritySignature,
  StudioCodecCertificationAuthorityExecutionVerificationResult,
  StudioCodecCertificationAuthorityExecutionVerifier,
} from "./studio-codec-certification-authority.service";

const MAX_IDENTIFIER_CODE_UNITS = 128;
const MAX_OBJECT_ID_CODE_UNITS = 512;
const MAX_EXECUTION_TTL_MS = 15 * 60 * 1_000;
const MIN_REPLAY_TOMBSTONE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30 * 1_000;
const AUTHORITY_MAX_PHASE_MS = 60 * 1_000;
const AUTHORITY_CLOCK_SKEW_BUDGET_MS = 60 * 1_000;
const AUTHORITY_PIPELINE_PHASES = 4;
const AUTHORITY_PIPELINE_BUDGET_MS =
  AUTHORITY_MAX_PHASE_MS * AUTHORITY_PIPELINE_PHASES
  + AUTHORITY_CLOCK_SKEW_BUDGET_MS;
// These owner leases span evidence hashing, signing, signature verification,
// and durable finalization. Six minutes covers the strict five-minute
// phase+skew budget with one minute of transport headroom.
const ADMISSION_LEASE_MS =
  AUTHORITY_PIPELINE_BUDGET_MS + AUTHORITY_MAX_PHASE_MS;
const EXECUTION_RESERVATION_LEASE_MS =
  AUTHORITY_PIPELINE_BUDGET_MS + AUTHORITY_MAX_PHASE_MS;
const MAX_STREAM_CHUNKS = 1_000_000;

export const STUDIO_CODEC_CERTIFICATION_EXECUTION_EVIDENCE_VERSION = 1 as const;
export const STUDIO_CODEC_CERTIFICATION_EXECUTION_EVIDENCE_KIND =
  "toonspectrum-codec-certification-execution-evidence" as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CODE_UNITS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u);
const ScopeSchema = z
  .string()
  .min(3)
  .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxScopeCodeUnits)
  .regex(/^[a-z][a-z0-9]*(?:[.:/_-][a-z0-9]+)+$/u);
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const TimestampSchema = z
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
const ObjectIdSchema = z
  .string()
  .min(1)
  .max(MAX_OBJECT_ID_CODE_UNITS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,511}$/u)
  .refine(
    (value) => !value.split("/").some((segment) => segment === ".."),
    "Parent traversal segments are forbidden."
  );

export const StudioCodecCertificationPrincipalBindingSchema = z
  .object({
    tenantId: IdentifierSchema,
    subjectId: IdentifierSchema,
    authenticationSessionId: IdentifierSchema,
    authorizationVersion: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strict();

export type StudioCodecCertificationPrincipalBinding = z.infer<
  typeof StudioCodecCertificationPrincipalBindingSchema
>;

function immutableObjectSchema(maxBytes: number, allowEmpty: boolean) {
  const byteLength = z.number().int().max(maxBytes);
  return z
    .object({
      objectId: ObjectIdSchema,
      versionId: IdentifierSchema,
      byteLength: allowEmpty ? byteLength.nonnegative() : byteLength.positive(),
      sha256: Sha256Schema,
    })
    .strict();
}

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
const DurableSignatureSchema =
  StudioCodecCertificationAuthoritySignatureSchema;

export const StudioCodecCertificationExecutionEvidenceRecordSchema = z
  .object({
    schemaVersion: z.literal(
      STUDIO_CODEC_CERTIFICATION_EXECUTION_EVIDENCE_VERSION
    ),
    kind: z.literal(STUDIO_CODEC_CERTIFICATION_EXECUTION_EVIDENCE_KIND),
    executionId: IdentifierSchema,
    principalBinding: StudioCodecCertificationPrincipalBindingSchema,
    scope: ScopeSchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    objects: z
      .object({
        canonical: immutableObjectSchema(
          STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes,
          false
        ),
        receipt: immutableObjectSchema(
          STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxReceiptBytes,
          false
        ),
        input: immutableObjectSchema(
          STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes,
          true
        ),
        output: immutableObjectSchema(
          STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes,
          true
        ),
        evidence: immutableObjectSchema(
          STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxEvidenceBytes,
          false
        ),
      })
      .strict(),
    provenance: z
      .object({
        providerId: IdentifierSchema,
        mode: ProviderModeSchema,
        direction: DirectionSchema,
        format: IdentifierSchema,
        profile: IdentifierSchema,
        version: IdentifierSchema,
        mimeType: MimeTypeSchema,
        extension: ExtensionSchema,
        deterministic: z.boolean(),
        evidenceMediaType: MimeTypeSchema,
        licenseGrantId: IdentifierSchema,
        licenseGrantScopes: z
          .array(LicenseScopeSchema)
          .min(1)
          .max(STUDIO_CODEC_PROVIDER_LIMITS.maxLicenseScopes)
          .refine((value) => new Set(value).size === value.length),
        licenseGrantExpiresAt: TimestampSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, context) => {
    const createdAt = Date.parse(record.createdAt);
    const expiresAt = Date.parse(record.expiresAt);
    if (
      createdAt >= expiresAt
      || expiresAt - createdAt > MAX_EXECUTION_TTL_MS
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Execution evidence TTL is invalid or exceeds its budget.",
      });
    }
    if (!record.provenance.licenseGrantScopes.includes(record.provenance.mode)) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "licenseGrantScopes"],
        message: "Provider mode is outside the server-owned license grant.",
      });
    }
    if (
      !record.provenance.licenseGrantScopes.includes(
        record.provenance.direction
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "licenseGrantScopes"],
        message: "Provider direction is outside the server-owned license grant.",
      });
    }
  });

export type StudioCodecCertificationExecutionEvidenceRecord = z.infer<
  typeof StudioCodecCertificationExecutionEvidenceRecordSchema
>;

const ReservedExecutionSchema = z
  .object({
    status: z.literal("reserved"),
    reservationId: IdentifierSchema,
    attemptId: IdentifierSchema,
    reservedAt: TimestampSchema,
    reservationExpiresAt: TimestampSchema,
    record: StudioCodecCertificationExecutionEvidenceRecordSchema,
  })
  .strict();
const CompletedExecutionSchema = z
  .object({
    status: z.literal("completed"),
    executionId: IdentifierSchema,
    consumptionId: IdentifierSchema,
    consumedAt: TimestampSchema,
    replayTombstoneExpiresAt: TimestampSchema,
    record: StudioCodecCertificationExecutionEvidenceRecordSchema,
    signature: DurableSignatureSchema,
  })
  .strict();
const UnavailableExecutionSchema = z
  .object({
    status: z.enum(["expired", "forbidden", "missing", "replayed"]),
  })
  .strict();
const ExecutionReservationResultSchema = z.discriminatedUnion("status", [
  ReservedExecutionSchema,
  CompletedExecutionSchema,
  UnavailableExecutionSchema,
]);
const ExecutionCompletionResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["consumed", "already-consumed"]),
      executionId: IdentifierSchema,
      reservationId: IdentifierSchema,
      attemptId: IdentifierSchema,
      consumptionId: IdentifierSchema,
      consumedAt: TimestampSchema,
      replayTombstoneExpiresAt: TimestampSchema,
      signature: DurableSignatureSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum(["rejected", "already-rejected"]),
      executionId: IdentifierSchema,
      reservationId: IdentifierSchema,
      attemptId: IdentifierSchema,
      consumptionId: IdentifierSchema,
      consumedAt: TimestampSchema,
      replayTombstoneExpiresAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("released"),
      executionId: IdentifierSchema,
      reservationId: IdentifierSchema,
      attemptId: IdentifierSchema,
    })
    .strict(),
  UnavailableExecutionSchema,
]);

export interface StudioCodecCertificationExecutionEvidenceRepository {
  /**
   * Atomically checks the principal binding and acquires an execution-scoped
   * reservation without creating the permanent replay tombstone. A replay,
   * expired record, wrong principal, or unknown id must never return contents.
   *
   * Only the same attemptId may replay a live reservation. A fresh attempt must
   * be denied while another attempt owns it, or receive the durable `completed`
   * record after atomic consumption; it must never share a signing reservation.
   */
  readonly reserveOneUse: (
    request: Readonly<{
      executionId: string;
      attemptId: string;
      principalBinding: StudioCodecCertificationPrincipalBinding;
      reservedAt: string;
      reservationExpiresAt: string;
      minimumReplayTombstoneExpiresAt: string;
      signal: AbortSignal;
    }>
  ) => Promise<unknown>;
  /**
   * `consume` atomically persists the verified signature with the immutable
   * record and replaces the reservation with a durable tombstone. `reject`
   * burns invalid evidence without a signature; `release` removes only the
   * matching fenced attempt. Implementations must be idempotent for the exact
   * executionId/reservationId/attemptId tuple.
   */
  readonly completeOneUse: (
    request:
    | Readonly<{
      executionId: string;
      reservationId: string;
      attemptId: string;
      principalBinding: StudioCodecCertificationPrincipalBinding;
      outcome: "consume";
      signature: StudioCodecCertificationAuthoritySignature;
      finalizedAt: string;
      minimumReplayTombstoneExpiresAt: string;
      signal: AbortSignal;
    }>
    | Readonly<{
      executionId: string;
      reservationId: string;
      attemptId: string;
      principalBinding: StudioCodecCertificationPrincipalBinding;
      outcome: "reject" | "release";
      finalizedAt: string;
      minimumReplayTombstoneExpiresAt: string;
      signal: AbortSignal;
    }>
  ) => Promise<unknown>;
}

export interface StudioCodecCertificationImmutableObjectReader {
  /**
   * Opens exactly the immutable object version named by the evidence record.
   * Implementations must not resolve a mutable "latest" alias.
   */
  readonly read: (
    request: Readonly<{
      objectId: string;
      versionId: string;
      maxBytes: number;
      signal: AbortSignal;
    }>
  ) => Promise<AsyncIterable<Uint8Array>>;
}

const AdmissionGrantedSchema = z
  .object({
    granted: z.literal(true),
    leaseId: IdentifierSchema,
    expiresAt: TimestampSchema,
  })
  .strict();
const AdmissionDeniedSchema = z
  .object({
    granted: z.literal(false),
    retryAfterMs: z.number().int().positive().max(60 * 60 * 1_000),
  })
  .strict();
const AdmissionResultSchema = z.discriminatedUnion("granted", [
  AdmissionGrantedSchema,
  AdmissionDeniedSchema,
]);

export interface StudioCodecCertificationDistributedAdmission {
  /**
   * Must combine a distributed principal rate limit and an execution-scoped
   * lease. A process-local counter does not satisfy this production contract.
   */
  readonly acquire: (
    request: Readonly<{
      tenantId: string;
      subjectId: string;
      executionId: string;
      scope: string;
      leaseTtlMs: number;
      signal: AbortSignal;
    }>
  ) => Promise<unknown>;
  readonly release: (
    request: Readonly<{
      leaseId: string;
      outcome: "rejected" | "reserved";
      signal: AbortSignal;
    }>
  ) => Promise<void>;
}

export interface StudioCodecCertificationExecutionEvidenceClock {
  readonly now: () => number;
}

export type StudioCodecCertificationExecutionEvidenceErrorCode =
  | "ABORTED"
  | "ADMISSION_DENIED"
  | "ADMISSION_FAILED"
  | "EVIDENCE_INTEGRITY_FAILED"
  | "EVIDENCE_REPOSITORY_FAILED"
  | "EXECUTION_UNAVAILABLE"
  | "INVALID_CONFIGURATION";

const ERROR_MESSAGES = Object.freeze({
  ABORTED: "Codec certification evidence verification was aborted.",
  ADMISSION_DENIED: "Codec certification admission capacity is exhausted.",
  ADMISSION_FAILED: "Codec certification admission failed closed.",
  EVIDENCE_INTEGRITY_FAILED:
    "Server-owned codec execution evidence failed integrity verification.",
  EVIDENCE_REPOSITORY_FAILED:
    "Codec certification evidence repository failed closed.",
  EXECUTION_UNAVAILABLE:
    "Codec certification execution is unavailable or already consumed.",
  INVALID_CONFIGURATION:
    "Codec certification evidence verifier configuration is invalid.",
} satisfies Record<
  StudioCodecCertificationExecutionEvidenceErrorCode,
  string
>);

export class StudioCodecCertificationExecutionEvidenceError extends Error {
  readonly code: StudioCodecCertificationExecutionEvidenceErrorCode;

  constructor(code: StudioCodecCertificationExecutionEvidenceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "StudioCodecCertificationExecutionEvidenceError";
    this.code = code;
  }
}

function fail(
  code: StudioCodecCertificationExecutionEvidenceErrorCode
): never {
  throw new StudioCodecCertificationExecutionEvidenceError(code);
}

function parseStrict<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: StudioCodecCertificationExecutionEvidenceErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile repository/adapter values fail closed below.
  }
  return fail(code);
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength
    && timingSafeEqual(leftBytes, rightBytes)
  );
}

function samePrincipal(
  left: StudioCodecCertificationPrincipalBinding,
  right: StudioCodecCertificationPrincipalBinding
): boolean {
  return (
    left.tenantId === right.tenantId
    && left.subjectId === right.subjectId
    && left.authenticationSessionId === right.authenticationSessionId
    && left.authorizationVersion === right.authorizationVersion
  );
}

function sameDurableSignature(
  left: StudioCodecCertificationAuthoritySignature,
  right: StudioCodecCertificationAuthoritySignature
): boolean {
  return (
    left.schemaVersion === right.schemaVersion
    && left.kind === right.kind
    && left.algorithm === right.algorithm
    && left.keyId === right.keyId
    && left.scope === right.scope
    && left.executionId === right.executionId
    && left.canonicalByteLength === right.canonicalByteLength
    && sameDigest(left.canonicalSha256, right.canonicalSha256)
    && sameDigest(left.signatureValue, right.signatureValue)
  );
}

async function independentlyHashObject(
  reader: StudioCodecCertificationImmutableObjectReader,
  reference: Readonly<{
    objectId: string;
    versionId: string;
    byteLength: number;
    sha256: string;
  }>,
  signal: AbortSignal
): Promise<void> {
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = await reader.read({
      objectId: reference.objectId,
      versionId: reference.versionId,
      maxBytes: reference.byteLength,
      signal,
    });
  } catch {
    if (signal.aborted) fail("ABORTED");
    fail("EVIDENCE_INTEGRITY_FAILED");
  }
  if (
    !stream
    || typeof stream[Symbol.asyncIterator] !== "function"
  ) {
    fail("EVIDENCE_INTEGRITY_FAILED");
  }

  const hash = createHash("sha256");
  let byteLength = 0;
  let chunks = 0;
  try {
    for await (const chunk of stream) {
      if (signal.aborted) fail("ABORTED");
      chunks += 1;
      if (
        chunks > MAX_STREAM_CHUNKS
        || !(chunk instanceof Uint8Array)
      ) {
        fail("EVIDENCE_INTEGRITY_FAILED");
      }
      byteLength += chunk.byteLength;
      if (byteLength > reference.byteLength) {
        fail("EVIDENCE_INTEGRITY_FAILED");
      }
      hash.update(chunk);
    }
  } catch (error) {
    if (error instanceof StudioCodecCertificationExecutionEvidenceError) {
      throw error;
    }
    if (signal.aborted) fail("ABORTED");
    fail("EVIDENCE_INTEGRITY_FAILED");
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (
    byteLength !== reference.byteLength
    || !sameDigest(digest, reference.sha256)
  ) {
    fail("EVIDENCE_INTEGRITY_FAILED");
  }
}

/**
 * Request-bound verifier for the production authority. The principal binding
 * is supplied by the server authentication layer at construction time, never
 * parsed from the certificate-signing request.
 */
export class StudioCodecCertificationExecutionEvidenceVerifier
implements StudioCodecCertificationAuthorityExecutionVerifier {
  private readonly principalBinding: StudioCodecCertificationPrincipalBinding;

  constructor(
    private readonly repository:
      StudioCodecCertificationExecutionEvidenceRepository,
    private readonly objectReader:
      StudioCodecCertificationImmutableObjectReader,
    private readonly admission: StudioCodecCertificationDistributedAdmission,
    principalBinding: unknown,
    private readonly clock: StudioCodecCertificationExecutionEvidenceClock = {
      now: () => Date.now(),
    }
  ) {
    this.principalBinding = parseStrict(
      StudioCodecCertificationPrincipalBindingSchema,
      principalBinding,
      "INVALID_CONFIGURATION"
    );
  }

  private async releaseAdmissionLease(
    leaseId: string,
    outcome: "rejected" | "reserved"
  ): Promise<void> {
    try {
      await this.admission.release({
        leaseId,
        outcome,
        // Admission cleanup is server-owned and must survive caller abort.
        signal: new AbortController().signal,
      });
    } catch {
      fail("ADMISSION_FAILED");
    }
  }

  async complete(
    request: Parameters<
      NonNullable<
        StudioCodecCertificationAuthorityExecutionVerifier["complete"]
      >
    >[0]
  ): Promise<boolean> {
    const executionId = parseStrict(
      IdentifierSchema,
      request.executionId,
      "EVIDENCE_REPOSITORY_FAILED"
    );
    const reservationId = parseStrict(
      IdentifierSchema,
      request.reservationId,
      "EVIDENCE_REPOSITORY_FAILED"
    );
    const attemptId = parseStrict(
      IdentifierSchema,
      request.attemptId,
      "EVIDENCE_REPOSITORY_FAILED"
    );
    const admissionLeaseId = parseStrict(
      IdentifierSchema,
      request.admissionLeaseId,
      "EVIDENCE_REPOSITORY_FAILED"
    );
    const outcome = parseStrict(
      z.enum(["consume", "reject", "release"]),
      request.outcome,
      "EVIDENCE_REPOSITORY_FAILED"
    );
    const signature = outcome === "consume"
      ? parseStrict(
          DurableSignatureSchema,
          "signature" in request ? request.signature : undefined,
          "EVIDENCE_REPOSITORY_FAILED"
        )
      : null;
    if (outcome !== "consume" && "signature" in request) {
      fail("EVIDENCE_REPOSITORY_FAILED");
    }
    if (
      signature
      && signature.executionId !== executionId
    ) {
      fail("EVIDENCE_REPOSITORY_FAILED");
    }
    if (request.signal.aborted) {
      await this.releaseAdmissionLease(admissionLeaseId, "rejected");
      fail("ABORTED");
    }
    let nowEpochMs: number;
    try {
      nowEpochMs = this.clock.now();
    } catch {
      await this.releaseAdmissionLease(admissionLeaseId, "rejected");
      return fail("INVALID_CONFIGURATION");
    }
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
      await this.releaseAdmissionLease(admissionLeaseId, "rejected");
      fail("INVALID_CONFIGURATION");
    }
    const finalizedAt = new Date(nowEpochMs).toISOString();
    const minimumReplayTombstoneExpiresAt = new Date(
      nowEpochMs + MIN_REPLAY_TOMBSTONE_MS
    ).toISOString();
    let completionFailed = false;
    try {
      let rawCompletion: unknown;
      try {
        const completionRequest = outcome === "consume"
          ? {
              executionId,
              reservationId,
              attemptId,
              principalBinding: this.principalBinding,
              outcome,
              signature:
                signature as StudioCodecCertificationAuthoritySignature,
              finalizedAt,
              minimumReplayTombstoneExpiresAt,
              signal: request.signal,
            } as const
          : {
              executionId,
              reservationId,
              attemptId,
              principalBinding: this.principalBinding,
              outcome,
              finalizedAt,
              minimumReplayTombstoneExpiresAt,
              signal: request.signal,
            } as const;
        rawCompletion = await this.repository.completeOneUse(
          completionRequest
        );
      } catch {
        if (request.signal.aborted) fail("ABORTED");
        fail("EVIDENCE_REPOSITORY_FAILED");
      }
      const completion = parseStrict(
        ExecutionCompletionResultSchema,
        rawCompletion,
        "EVIDENCE_REPOSITORY_FAILED"
      );
      if (outcome === "release") {
        if (
          completion.status !== "released"
          || completion.executionId !== executionId
          || completion.reservationId !== reservationId
          || completion.attemptId !== attemptId
        ) {
          fail("EXECUTION_UNAVAILABLE");
        }
        return true;
      }
      if (
        outcome === "consume"
        && completion.status !== "consumed"
        && completion.status !== "already-consumed"
      ) {
        fail("EXECUTION_UNAVAILABLE");
      }
      if (
        outcome === "reject"
        && completion.status !== "rejected"
        && completion.status !== "already-rejected"
      ) {
        fail("EXECUTION_UNAVAILABLE");
      }
      if (
        !("executionId" in completion)
        || completion.executionId !== executionId
        || completion.reservationId !== reservationId
        || completion.attemptId !== attemptId
      ) {
        fail("EXECUTION_UNAVAILABLE");
      }
      if (!("consumedAt" in completion)) {
        fail("EXECUTION_UNAVAILABLE");
      }
      const consumedAtEpochMs = Date.parse(completion.consumedAt);
      if (
        (
          (
            completion.status === "consumed"
            || completion.status === "rejected"
          )
          && Math.abs(consumedAtEpochMs - nowEpochMs) > MAX_CLOCK_SKEW_MS
        )
        || Date.parse(completion.replayTombstoneExpiresAt)
          < consumedAtEpochMs + MIN_REPLAY_TOMBSTONE_MS
        || (
          outcome === "consume"
          && (
            !("signature" in completion)
            || !sameDurableSignature(
              completion.signature,
              signature as StudioCodecCertificationAuthoritySignature
            )
          )
        )
      ) {
        fail("EVIDENCE_REPOSITORY_FAILED");
      }
      return true;
    } catch (error) {
      completionFailed = true;
      throw error;
    } finally {
      if (completionFailed) {
        try {
          await this.releaseAdmissionLease(
            admissionLeaseId,
            outcome === "consume" ? "reserved" : "rejected"
          );
        } catch {
          // Preserve the primary repository/fencing failure.
        }
      } else {
        await this.releaseAdmissionLease(
          admissionLeaseId,
          outcome === "consume" ? "reserved" : "rejected"
        );
      }
    }
  }

  async verify(
    request: Parameters<
      StudioCodecCertificationAuthorityExecutionVerifier["verify"]
    >[0]
  ): Promise<StudioCodecCertificationAuthorityExecutionVerificationResult> {
    if (request.signal.aborted) fail("ABORTED");
    let nowEpochMs: number;
    try {
      nowEpochMs = this.clock.now();
    } catch {
      return fail("INVALID_CONFIGURATION");
    }
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
      fail("INVALID_CONFIGURATION");
    }
    const reservedAt = new Date(nowEpochMs).toISOString();
    const reservationExpiresAt = new Date(
      nowEpochMs + EXECUTION_RESERVATION_LEASE_MS
    ).toISOString();
    const minimumReplayTombstoneExpiresAt = new Date(
      nowEpochMs + MIN_REPLAY_TOMBSTONE_MS
    ).toISOString();

    let rawAdmission: unknown;
    try {
      rawAdmission = await this.admission.acquire({
        tenantId: this.principalBinding.tenantId,
        subjectId: this.principalBinding.subjectId,
        executionId: request.executionId,
        scope: request.scope,
        leaseTtlMs: ADMISSION_LEASE_MS,
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) fail("ABORTED");
      fail("ADMISSION_FAILED");
    }
    const admission = parseStrict(
      AdmissionResultSchema,
      rawAdmission,
      "ADMISSION_FAILED"
    );
    if (!admission.granted) fail("ADMISSION_DENIED");
    const attemptId = randomUUID();
    let outcome: "rejected" | "reserved" = "rejected";
    let heldReservation:
      | Readonly<{ reservationId: string; attemptId: string }>
      | null = null;
    let admissionHeldForAuthority = false;
    let admissionReleasedByCompletion = false;
    try {
      const admissionExpiry = Date.parse(admission.expiresAt);
      if (
        admissionExpiry
          < nowEpochMs + ADMISSION_LEASE_MS - MAX_CLOCK_SKEW_MS
        || admissionExpiry > nowEpochMs + ADMISSION_LEASE_MS + MAX_CLOCK_SKEW_MS
      ) {
        fail("ADMISSION_FAILED");
      }
      let rawReservation: unknown;
      try {
        rawReservation = await this.repository.reserveOneUse({
          executionId: request.executionId,
          attemptId,
          principalBinding: this.principalBinding,
          reservedAt,
          reservationExpiresAt,
          minimumReplayTombstoneExpiresAt,
          signal: request.signal,
        });
      } catch {
        if (request.signal.aborted) fail("ABORTED");
        fail("EVIDENCE_REPOSITORY_FAILED");
      }
      const reservation = parseStrict(
        ExecutionReservationResultSchema,
        rawReservation,
        "EVIDENCE_REPOSITORY_FAILED"
      );
      if (
        reservation.status !== "reserved"
        && reservation.status !== "completed"
      ) {
        fail("EXECUTION_UNAVAILABLE");
      }
      if (reservation.status === "reserved") {
        if (reservation.attemptId !== attemptId) {
          fail("EVIDENCE_INTEGRITY_FAILED");
        }
        heldReservation = {
          reservationId: reservation.reservationId,
          attemptId: reservation.attemptId,
        };
      }

      const record = reservation.record;
      const createdAt = Date.parse(record.createdAt);
      const expiresAt = Date.parse(record.expiresAt);
      if (
        record.executionId !== request.executionId
        || record.scope !== request.scope
        || !samePrincipal(record.principalBinding, this.principalBinding)
        || createdAt > nowEpochMs + MAX_CLOCK_SKEW_MS
        || expiresAt <= nowEpochMs
        || record.provenance.providerId !== request.providerId
        || record.provenance.mode !== request.mode
        || record.provenance.direction !== request.direction
        || record.provenance.format !== request.format
        || record.provenance.profile !== request.profile
        || record.provenance.version !== request.version
        || record.provenance.mimeType !== request.mimeType
        || record.provenance.extension !== request.extension
      ) {
        fail("EVIDENCE_INTEGRITY_FAILED");
      }
      if (reservation.status === "reserved") {
        const repositoryReservedAt = Date.parse(reservation.reservedAt);
        const repositoryReservationExpiresAt = Date.parse(
          reservation.reservationExpiresAt
        );
        if (
          Math.abs(repositoryReservedAt - nowEpochMs) > MAX_CLOCK_SKEW_MS
          || repositoryReservationExpiresAt
            < nowEpochMs
              + EXECUTION_RESERVATION_LEASE_MS
              - MAX_CLOCK_SKEW_MS
          || repositoryReservationExpiresAt > expiresAt
        ) {
          fail("EVIDENCE_INTEGRITY_FAILED");
        }
      } else {
        const consumedAt = Date.parse(reservation.consumedAt);
        const replayTombstoneExpiresAt = Date.parse(
          reservation.replayTombstoneExpiresAt
        );
        if (
          reservation.executionId !== request.executionId
          || consumedAt > nowEpochMs + MAX_CLOCK_SKEW_MS
          || replayTombstoneExpiresAt <= nowEpochMs
          || replayTombstoneExpiresAt
            < consumedAt + MIN_REPLAY_TOMBSTONE_MS
          || reservation.signature.executionId !== record.executionId
          || reservation.signature.scope !== record.scope
          || reservation.signature.canonicalByteLength
            !== record.objects.canonical.byteLength
          || !sameDigest(
            reservation.signature.canonicalSha256,
            record.objects.canonical.sha256
          )
        ) {
          fail("EVIDENCE_INTEGRITY_FAILED");
        }
      }

      await independentlyHashObject(
        this.objectReader,
        record.objects.canonical,
        request.signal
      );
      await independentlyHashObject(
        this.objectReader,
        record.objects.receipt,
        request.signal
      );
      await independentlyHashObject(
        this.objectReader,
        record.objects.input,
        request.signal
      );
      await independentlyHashObject(
        this.objectReader,
        record.objects.output,
        request.signal
      );
      await independentlyHashObject(
        this.objectReader,
        record.objects.evidence,
        request.signal
      );
      outcome = "reserved";
      if (reservation.status === "reserved") {
        admissionHeldForAuthority = true;
      }
      return {
        verified: true,
        executionId: record.executionId,
        canonicalByteLength: record.objects.canonical.byteLength,
        canonicalSha256: record.objects.canonical.sha256,
        receiptByteLength: record.objects.receipt.byteLength,
        receiptSha256: record.objects.receipt.sha256,
        outputByteLength: record.objects.output.byteLength,
        outputSha256: record.objects.output.sha256,
        evidenceByteLength: record.objects.evidence.byteLength,
        evidenceSha256: record.objects.evidence.sha256,
        evidenceMediaType: record.provenance.evidenceMediaType,
        providerId: record.provenance.providerId,
        mode: record.provenance.mode,
        direction: record.provenance.direction,
        format: record.provenance.format,
        profile: record.provenance.profile,
        version: record.provenance.version,
        mimeType: record.provenance.mimeType,
        extension: record.provenance.extension,
        deterministic: record.provenance.deterministic,
        inputByteLength: record.objects.input.byteLength,
        inputSha256: record.objects.input.sha256,
        licenseGrantId: record.provenance.licenseGrantId,
        licenseGrantScopes: [...record.provenance.licenseGrantScopes],
        licenseGrantExpiresAt: record.provenance.licenseGrantExpiresAt,
        authorization: reservation.status === "reserved"
          ? {
              status: "reserved",
              reservationId: reservation.reservationId,
              attemptId: reservation.attemptId,
              admissionLeaseId: admission.leaseId,
              expiresAt: reservation.reservationExpiresAt,
            }
          : {
              status: "completed",
              signature: reservation.signature,
            },
      };
    } catch (error) {
      if (heldReservation) {
        const completionOutcome =
          error instanceof StudioCodecCertificationExecutionEvidenceError
          && error.code === "EVIDENCE_INTEGRITY_FAILED"
            ? "reject"
            : "release";
        admissionReleasedByCompletion = true;
        try {
          await this.complete({
            executionId: request.executionId,
            reservationId: heldReservation.reservationId,
            attemptId: heldReservation.attemptId,
            admissionLeaseId: admission.leaseId,
            outcome: completionOutcome,
            // Reservation cleanup must remain possible after caller abort.
            signal: new AbortController().signal,
          });
        } catch {
          if (
            error instanceof StudioCodecCertificationExecutionEvidenceError
            && error.code === "ABORTED"
          ) {
            throw error;
          }
          fail("EVIDENCE_REPOSITORY_FAILED");
        }
      }
      throw error;
    } finally {
      if (
        !admissionHeldForAuthority
        && !admissionReleasedByCompletion
      ) {
        await this.releaseAdmissionLease(admission.leaseId, outcome);
      }
    }
  }
}
