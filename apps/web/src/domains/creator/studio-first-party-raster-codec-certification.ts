/**
 * End-to-end first-party raster codec execution + ToonSpectrum product certification.
 *
 * This composes the generic provider boundary, deterministic conformance vectors, and the
 * deployment-owned signing authority. The result is an exact-source ToonSpectrum product
 * certificate. It is not a third-party standards-body, codec-vendor, or trademark certificate.
 */

import {
  createStudioCodecCertificationPipelineGuard,
  StudioCodecCertificationPipelineGuardError,
  type StudioCodecCertificationPipelineGuard,
} from "./studio-codec-certification-pipeline-guard";
import {
  executeStudioCodecProvider,
  type StudioCodecDirection,
  type StudioCodecExecutionReceipt,
  type StudioCodecExecutionRequest,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  createStudioFirstPartyRasterConformanceEvidence,
  serializeStudioFirstPartyRasterConformanceEvidence,
  type StudioFirstPartyRasterConformanceEvidence,
} from "./studio-first-party-raster-codec-conformance";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_MAX_TIMEOUT_MS,
  runStudioFirstPartyRasterCodecWorker,
  StudioFirstPartyRasterCodecWorkerClientError,
  type StudioFirstPartyRasterCodecWorkerFactory,
  type StudioFirstPartyRasterCodecWorkerResult,
} from "./studio-first-party-raster-codec-worker-client";
import {
  issueStudioProductCodecCertificate,
  verifyStudioProductCodecCertificate,
  type StudioProductCodecCertificate,
  type StudioProductCodecCertificationSigner,
  type StudioProductCodecCertificationTrustRoot,
  type StudioProductCodecCertificateVerificationResult,
  type StudioProductCodecExecutionProviderReceipt,
} from "./studio-product-codec-certification";

import type { StudioRasterInterchangeFormat } from "./render/studio-raster-interchange";

export const STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_EVIDENCE_MEDIA_TYPE =
  "application/vnd.toonspectrum.raster-codec-conformance+json" as const;

export type StudioFirstPartyRasterCodecExecutionPolicy =
  | "direct"
  | "worker";

export interface ExecuteAndCertifyStudioFirstPartyRasterCodecInput {
  readonly format: StudioRasterInterchangeFormat;
  readonly direction: StudioCodecDirection;
  readonly inputBytes: Uint8Array;
  /**
   * The default is the fail-closed dedicated Worker. `direct` is an independent provider that a
   * caller must select before the request starts; Worker failure never replays work through it.
   */
  readonly execution?: StudioFirstPartyRasterCodecExecutionPolicy;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?:
    | StudioFirstPartyRasterCodecWorkerFactory
    | null;
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly expiresAt: string;
  readonly providers?: readonly StudioCodecProvider[];
}

export interface StudioFirstPartyRasterCertifiedExecution {
  readonly kind: "toonspectrum-first-party-raster-certified-execution";
  readonly format: StudioRasterInterchangeFormat;
  readonly direction: StudioCodecDirection;
  readonly scope: string;
  readonly bytes: Uint8Array;
  readonly receipt: StudioCodecExecutionReceipt;
  readonly executionProviderReceipt:
    StudioProductCodecExecutionProviderReceipt;
  readonly conformance: StudioFirstPartyRasterConformanceEvidence;
  readonly conformanceBytes: Uint8Array;
  readonly certificateBytes: Uint8Array;
}

export interface VerifyStudioFirstPartyRasterCertifiedExecutionOptions {
  readonly trustRoots: readonly StudioProductCodecCertificationTrustRoot[];
  readonly nowEpochMs?: number;
  readonly revokedCertificateIds?: ReadonlySet<string>;
  readonly revokedKeyIds?: ReadonlySet<string>;
  readonly claimCertificateId?: (
    certificateId: string,
  ) => boolean | Promise<boolean>;
}

export type StudioFirstPartyRasterCertifiedExecutionVerification =
  | Readonly<{
      ok: true;
      certificate: StudioProductCodecCertificate;
    }>
  | Extract<
      StudioProductCodecCertificateVerificationResult,
      { readonly ok: false }
    >
  | Readonly<{
      ok: false;
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH";
      message: string;
    }>;

export class StudioFirstPartyRasterCodecCertificationError extends Error {
  readonly code:
    | "CODEC_EXECUTION_ABORTED"
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_EXECUTION_TIMEOUT"
    | "CODEC_WORKER_REQUIRED"
    | "INVALID_TIMEOUT"
    | "INVALID_EXECUTION_POLICY"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyRasterCodecCertificationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyRasterCodecCertificationError";
    this.code = code;
  }
}

function mapPipelineGuardError(
  error: unknown,
): StudioFirstPartyRasterCodecCertificationError {
  if (
    error instanceof StudioCodecCertificationPipelineGuardError
    && error.code === "timeout"
  ) {
    return new StudioFirstPartyRasterCodecCertificationError(
      "CODEC_EXECUTION_TIMEOUT",
      "First-party raster codec certification pipeline timed out.",
    );
  }
  if (
    error instanceof StudioCodecCertificationPipelineGuardError
    && error.code === "invalid-timeout"
  ) {
    return new StudioFirstPartyRasterCodecCertificationError(
      "INVALID_TIMEOUT",
      "First-party raster codec certification timeout is invalid.",
    );
  }
  return new StudioFirstPartyRasterCodecCertificationError(
    "CODEC_EXECUTION_ABORTED",
    "First-party raster codec certification pipeline was aborted.",
  );
}

export function studioFirstPartyRasterCodecCertificationScope(
  format: StudioRasterInterchangeFormat,
  direction: StudioCodecDirection,
): string {
  return `toonspectrum.product.codec-conformance.${format}-${direction}`;
}

function providerFor(
  format: StudioRasterInterchangeFormat,
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const expected = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
    (provider) => provider.manifest.format === format,
  );
  const matches = expected
    ? providers.filter((provider) => provider === expected)
    : [];
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyRasterCodecCertificationError(
      "PROVIDER_NOT_FOUND",
      `Expected one first-party ${format} codec provider.`,
    );
  }
  return matches[0];
}

function requestFor(
  provider: StudioCodecProvider,
  direction: StudioCodecDirection,
): StudioCodecExecutionRequest {
  const mimeType = provider.manifest.mimeTypes[0];
  const extension = provider.manifest.extensions[0];
  if (!mimeType || !extension) {
    throw new StudioFirstPartyRasterCodecCertificationError(
      "PROVIDER_NOT_FOUND",
      "First-party raster provider identity is incomplete.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: provider.manifest.format,
    profile: provider.manifest.profile,
    version: provider.manifest.version,
    mimeType,
    extension,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
}

function normalizeExecutionPolicy(
  value: unknown,
): StudioFirstPartyRasterCodecExecutionPolicy {
  if (value === undefined) return "worker";
  if (value === "direct" || value === "worker") {
    return value;
  }
  throw new StudioFirstPartyRasterCodecCertificationError(
    "INVALID_EXECUTION_POLICY",
    "First-party raster codec execution policy is invalid.",
  );
}

type SuccessfulCodecExecution =
  | StudioFirstPartyRasterCodecWorkerResult
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      receipt: StudioCodecExecutionReceipt;
    }>;

type CertifiedCodecExecution = SuccessfulCodecExecution & Readonly<{
  executionProviderReceipt: StudioProductCodecExecutionProviderReceipt;
}>;

async function executeDirect(
  request: StudioCodecExecutionRequest,
  inputBytes: Uint8Array,
  provider: StudioCodecProvider,
  signal: AbortSignal | undefined,
): Promise<SuccessfulCodecExecution> {
  if (signal?.aborted) {
    throw new StudioFirstPartyRasterCodecCertificationError(
      "CODEC_EXECUTION_ABORTED",
      "First-party raster codec execution was aborted before direct execution.",
    );
  }
  const execution = await executeStudioCodecProvider(
    request,
    inputBytes,
    [provider],
  );
  if (!execution.ok) {
    throw new StudioFirstPartyRasterCodecCertificationError(
      "CODEC_EXECUTION_FAILED",
      `First-party raster codec execution failed (${execution.code}).`,
    );
  }
  return execution;
}

function workerCertificationError(
  error: unknown,
): StudioFirstPartyRasterCodecCertificationError {
  if (error instanceof StudioFirstPartyRasterCodecWorkerClientError) {
    if (error.code === "worker-aborted") {
      return new StudioFirstPartyRasterCodecCertificationError(
        "CODEC_EXECUTION_ABORTED",
        "First-party raster codec Worker execution was aborted.",
      );
    }
    if (error.code === "worker-timeout") {
      return new StudioFirstPartyRasterCodecCertificationError(
        "CODEC_EXECUTION_TIMEOUT",
        "First-party raster codec Worker execution timed out.",
      );
    }
    if (error.code === "worker-unavailable") {
      return new StudioFirstPartyRasterCodecCertificationError(
        "CODEC_WORKER_REQUIRED",
        "First-party raster codec Worker is required but unavailable.",
      );
    }
  }
  return new StudioFirstPartyRasterCodecCertificationError(
    "CODEC_EXECUTION_FAILED",
    "First-party raster codec Worker execution failed.",
  );
}

function executionMatchesProvider(
  execution: SuccessfulCodecExecution,
  request: StudioCodecExecutionRequest,
  provider: StudioCodecProvider,
): boolean {
  const receipt = execution.receipt;
  return (
    receipt.providerId === provider.manifest.providerId
    && receipt.mode === provider.manifest.mode
    && receipt.direction === request.direction
    && receipt.format === request.format
    && receipt.profile === request.profile
    && receipt.version === request.version
    && receipt.mimeType === request.mimeType
    && receipt.extension === request.extension
    && receipt.output.byteLength === execution.bytes.byteLength
  );
}

async function executeWithPolicy(
  input: ExecuteAndCertifyStudioFirstPartyRasterCodecInput,
  provider: StudioCodecProvider,
): Promise<CertifiedCodecExecution> {
  const policy = normalizeExecutionPolicy(input.execution);
  const request = requestFor(provider, input.direction);
  let execution: SuccessfulCodecExecution;
  if (policy === "direct") {
    execution = await executeDirect(
      request,
      input.inputBytes,
      provider,
      input.signal,
    );
  } else {
    try {
      execution = await runStudioFirstPartyRasterCodecWorker(
        request,
        input.inputBytes,
        {
          signal: input.signal,
          timeoutMs: input.timeoutMs,
          workerFactory: input.workerFactory,
        },
      );
    } catch (error) {
      throw workerCertificationError(error);
    }
  }
  if (!executionMatchesProvider(execution, request, provider)) {
    throw new StudioFirstPartyRasterCodecCertificationError(
      "CODEC_EXECUTION_FAILED",
      "First-party raster codec execution identity is invalid.",
    );
  }
  return Object.freeze({
    ...execution,
    executionProviderReceipt: Object.freeze({
      schemaVersion: 1,
      kind: "toonspectrum-codec-execution-provider-selection",
      selectedProvider: policy,
      attemptedProviders: Object.freeze([policy]) as readonly [
        StudioFirstPartyRasterCodecExecutionPolicy,
      ],
    }),
  });
}

function sameExecutionProviderReceipt(
  actual: StudioProductCodecExecutionProviderReceipt,
  certified: StudioProductCodecExecutionProviderReceipt | undefined,
): boolean {
  return certified !== undefined
    && actual.schemaVersion === certified.schemaVersion
    && actual.kind === certified.kind
    && actual.selectedProvider === certified.selectedProvider
    && actual.attemptedProviders.length === 1
    && certified.attemptedProviders.length === 1
    && actual.attemptedProviders[0] === actual.selectedProvider
    && certified.attemptedProviders[0] === certified.selectedProvider
    && actual.attemptedProviders[0] === certified.attemptedProviders[0];
}

function sameReceipt(
  actual: StudioCodecExecutionReceipt,
  certified: StudioCodecExecutionReceipt,
): boolean {
  return actual.schemaVersion === certified.schemaVersion
    && actual.kind === certified.kind
    && actual.providerId === certified.providerId
    && actual.mode === certified.mode
    && actual.direction === certified.direction
    && actual.format === certified.format
    && actual.profile === certified.profile
    && actual.version === certified.version
    && actual.mimeType === certified.mimeType
    && actual.extension === certified.extension
    && actual.deterministic === certified.deterministic
    && actual.input.byteLength === certified.input.byteLength
    && actual.input.sha256 === certified.input.sha256
    && actual.output.byteLength === certified.output.byteLength
    && actual.output.sha256 === certified.output.sha256
    && actual.licenseGrant.id === certified.licenseGrant.id
    && actual.licenseGrant.expiresAt === certified.licenseGrant.expiresAt
    && actual.licenseGrant.scope.length === certified.licenseGrant.scope.length
    && actual.licenseGrant.scope.every(
      (scope, index) => scope === certified.licenseGrant.scope[index],
    )
    && actual.officialClaims.externalAttestationAccepted
      === certified.officialClaims.externalAttestationAccepted
    && actual.officialClaims.officialCodec
      === certified.officialClaims.officialCodec
    && actual.officialClaims.certified
      === certified.officialClaims.certified
    && actual.officialClaims.trademarkAuthorized
      === certified.officialClaims.trademarkAuthorized;
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.byteLength === second.byteLength
    && first.every((byte, index) => byte === second[index]);
}

function conformanceObjectMatches(
  execution: StudioFirstPartyRasterCertifiedExecution,
): boolean {
  try {
    return sameBytes(
      serializeStudioFirstPartyRasterConformanceEvidence(
        execution.conformance,
      ),
      execution.conformanceBytes,
    );
  } catch {
    return false;
  }
}

export async function executeAndCertifyStudioFirstPartyRasterCodec(
  input: ExecuteAndCertifyStudioFirstPartyRasterCodecInput,
  signer: StudioProductCodecCertificationSigner,
): Promise<StudioFirstPartyRasterCertifiedExecution> {
  let guard: StudioCodecCertificationPipelineGuard;
  try {
    guard = createStudioCodecCertificationPipelineGuard({
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      defaultTimeoutMs:
        STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
      minTimeoutMs: 1,
      maxTimeoutMs:
        STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_MAX_TIMEOUT_MS,
    });
  } catch (error) {
    throw mapPipelineGuardError(error);
  }
  try {
    const providers =
      input.providers ?? STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS;
    const provider = providerFor(input.format, providers);
    const execution = await guard.run((signal) =>
      executeWithPolicy({
        ...input,
        signal,
        timeoutMs: guard.timeoutMs,
      }, provider)
    );
    const conformance = await guard.run(() =>
      createStudioFirstPartyRasterConformanceEvidence(
        input.format,
        [provider],
      )
    );
    const scope = studioFirstPartyRasterCodecCertificationScope(
      input.format,
      input.direction,
    );
    const certificateBytes = await guard.run(() =>
      issueStudioProductCodecCertificate(
        {
          receipt: execution.receipt,
          executionProviderReceipt: execution.executionProviderReceipt,
          outputBytes: execution.bytes,
          evidenceBytes: conformance.bytes,
          evidenceMediaType:
            STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_EVIDENCE_MEDIA_TYPE,
          scope,
          issuedAt: input.issuedAt,
          ...(input.notBefore ? { notBefore: input.notBefore } : {}),
          expiresAt: input.expiresAt,
        },
        signer,
      )
    );
    return Object.freeze({
      kind: "toonspectrum-first-party-raster-certified-execution",
      format: input.format,
      direction: input.direction,
      scope,
      bytes: execution.bytes,
      receipt: execution.receipt,
      executionProviderReceipt: execution.executionProviderReceipt,
      conformance: conformance.evidence,
      conformanceBytes: conformance.bytes,
      certificateBytes,
    });
  } catch (error) {
    if (error instanceof StudioCodecCertificationPipelineGuardError) {
      throw mapPipelineGuardError(error);
    }
    throw error;
  } finally {
    guard.close();
  }
}

export async function verifyStudioFirstPartyRasterCertifiedExecution(
  execution: StudioFirstPartyRasterCertifiedExecution,
  options: VerifyStudioFirstPartyRasterCertifiedExecutionOptions,
): Promise<StudioFirstPartyRasterCertifiedExecutionVerification> {
  const expectedScope = studioFirstPartyRasterCodecCertificationScope(
    execution.format,
    execution.direction,
  );
  const verified = await verifyStudioProductCodecCertificate(
    execution.certificateBytes,
    {
      outputBytes: execution.bytes,
      evidenceBytes: execution.conformanceBytes,
      trustRoots: options.trustRoots,
      expectedScope,
      ...(options.nowEpochMs === undefined
        ? {}
        : { nowEpochMs: options.nowEpochMs }),
      ...(options.revokedCertificateIds
        ? { revokedCertificateIds: options.revokedCertificateIds }
        : {}),
      ...(options.revokedKeyIds
        ? { revokedKeyIds: options.revokedKeyIds }
        : {}),
    },
  );
  if (!verified.ok) return verified;
  const receipt = verified.certificate.receipt;
  const expectedProvider = providerFor(
    execution.format,
    STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  );
  if (
    execution.kind !==
      "toonspectrum-first-party-raster-certified-execution"
    || execution.scope !== expectedScope
    || verified.certificate.evidence.mediaType
      !== STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_EVIDENCE_MEDIA_TYPE
    || !conformanceObjectMatches(execution)
    || !sameReceipt(execution.receipt, receipt)
    || !sameExecutionProviderReceipt(
      execution.executionProviderReceipt,
      verified.certificate.executionProviderReceipt,
    )
    || receipt.format !== execution.format
    || receipt.providerId !== expectedProvider.manifest.providerId
    || receipt.direction !== execution.direction
    || receipt.profile !== STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE
    || receipt.version !== STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION
    || receipt.mode !== "public-clean-room"
    || execution.conformance.format !== execution.format
    || execution.conformance.profile
      !== STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE
    || execution.conformance.providerId !== receipt.providerId
    || execution.conformance.decision !== "passed"
  ) {
    return Object.freeze({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
      message:
        "Certified execution identity does not match the product certificate.",
    });
  }
  if (options.claimCertificateId) {
    let claimed: boolean;
    try {
      claimed = await options.claimCertificateId(
        verified.certificate.certificateId,
      );
    } catch {
      claimed = false;
    }
    if (!claimed) {
      return Object.freeze({
        ok: false,
        code: "REPLAYED_CERTIFICATE",
        message: "Codec product certificate id was already consumed.",
      });
    }
  }
  return verified;
}
