/**
 * End-to-end bounded WILL v1 Annex B provider execution + ToonSpectrum product certification.
 *
 * This certificate binds exact seven-part document bytes and deterministic conformance evidence.
 * It is a ToonSpectrum product certificate, not Wacom/vendor certification, trademark
 * authorization, or proof that arbitrary `.will` documents interoperate.
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
  createStudioFirstPartyWillV1DocumentConformanceEvidence,
  serializeStudioFirstPartyWillV1DocumentConformanceEvidence,
  type StudioFirstPartyWillV1DocumentConformanceEvidence,
} from "./studio-first-party-will-v1-document-codec-conformance";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS,
  runStudioFirstPartyWillV1DocumentCodecWorker,
  StudioFirstPartyWillV1DocumentCodecWorkerClientError,
  type StudioFirstPartyWillV1DocumentCodecWorkerFactory,
  type StudioFirstPartyWillV1DocumentCodecWorkerResult,
} from "./studio-first-party-will-v1-document-codec-worker-client";
import {
  issueStudioProductCodecCertificate,
  verifyStudioProductCodecCertificate,
  type StudioProductCodecCertificate,
  type StudioProductCodecCertificateVerificationResult,
  type StudioProductCodecCertificationSigner,
  type StudioProductCodecCertificationTrustRoot,
  type StudioProductCodecExecutionProviderReceipt,
} from "./studio-product-codec-certification";
import {
  STUDIO_WILL_V1_OPC_EXTENSION,
  STUDIO_WILL_V1_OPC_MEDIA_TYPE,
  STUDIO_WILL_V1_OPC_PROFILE,
} from "./studio-will-v1-opc-interchange";

export const
STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_EVIDENCE_MEDIA_TYPE =
  "application/vnd.toonspectrum.will-v1-annex-b-document-conformance+json" as const;

export type StudioFirstPartyWillV1DocumentCodecExecutionPolicy =
  | "direct"
  | "worker";

export interface ExecuteAndCertifyStudioFirstPartyWillV1DocumentCodecInput {
  readonly direction: StudioCodecDirection;
  readonly inputBytes: Uint8Array;
  /**
   * The default is the fail-closed dedicated Worker. `direct` is an independent provider that a
   * caller must select before the request starts; Worker failure never replays work through it.
   */
  readonly execution?: StudioFirstPartyWillV1DocumentCodecExecutionPolicy;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?:
    | StudioFirstPartyWillV1DocumentCodecWorkerFactory
    | null;
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly expiresAt: string;
  readonly providers?: readonly StudioCodecProvider[];
}

export interface StudioFirstPartyWillV1DocumentCertifiedExecution {
  readonly kind:
    "toonspectrum-first-party-will-v1-annex-b-document-certified-execution";
  readonly direction: StudioCodecDirection;
  readonly scope: string;
  readonly bytes: Uint8Array;
  readonly receipt: StudioCodecExecutionReceipt;
  readonly executionProviderReceipt:
    StudioProductCodecExecutionProviderReceipt;
  readonly conformance: StudioFirstPartyWillV1DocumentConformanceEvidence;
  readonly conformanceBytes: Uint8Array;
  readonly certificateBytes: Uint8Array;
}

export interface VerifyStudioFirstPartyWillV1DocumentCertifiedExecutionOptions {
  readonly trustRoots: readonly StudioProductCodecCertificationTrustRoot[];
  readonly nowEpochMs?: number;
  readonly revokedCertificateIds?: ReadonlySet<string>;
  readonly revokedKeyIds?: ReadonlySet<string>;
  readonly claimCertificateId?: (
    certificateId: string,
  ) => boolean | Promise<boolean>;
}

export type StudioFirstPartyWillV1DocumentCertifiedExecutionVerification =
  | Readonly<{ ok: true; certificate: StudioProductCodecCertificate }>
  | Extract<
      StudioProductCodecCertificateVerificationResult,
      { readonly ok: false }
    >
  | Readonly<{
      ok: false;
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH";
      message: string;
    }>;

export class StudioFirstPartyWillV1DocumentCodecCertificationError
  extends Error {
  readonly code:
    | "CODEC_EXECUTION_ABORTED"
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_EXECUTION_TIMEOUT"
    | "CODEC_WORKER_REQUIRED"
    | "INVALID_TIMEOUT"
    | "INVALID_EXECUTION_POLICY"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyWillV1DocumentCodecCertificationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1DocumentCodecCertificationError";
    this.code = code;
  }
}

function mapPipelineGuardError(
  error: unknown,
): StudioFirstPartyWillV1DocumentCodecCertificationError {
  if (
    error instanceof StudioCodecCertificationPipelineGuardError
    && error.code === "timeout"
  ) {
    return new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "CODEC_EXECUTION_TIMEOUT",
      "First-party WILL v1 document codec certification pipeline timed out.",
    );
  }
  if (
    error instanceof StudioCodecCertificationPipelineGuardError
    && error.code === "invalid-timeout"
  ) {
    return new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "INVALID_TIMEOUT",
      "First-party WILL v1 document codec certification timeout is invalid.",
    );
  }
  return new StudioFirstPartyWillV1DocumentCodecCertificationError(
    "CODEC_EXECUTION_ABORTED",
    "First-party WILL v1 document codec certification pipeline was aborted.",
  );
}

export function studioFirstPartyWillV1DocumentCodecCertificationScope(
  direction: StudioCodecDirection,
): string {
  return `toonspectrum.product.codec-conformance.will-v1-annex-b-document-${direction}`;
}

function providerFor(
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const matches = providers.filter(
    (provider) =>
      provider === STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "PROVIDER_NOT_FOUND",
      "Expected one exact first-party WILL v1 Annex B document provider.",
    );
  }
  return matches[0];
}

function requestFor(
  provider: StudioCodecProvider,
  direction: StudioCodecDirection,
): StudioCodecExecutionRequest {
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
    profile: STUDIO_WILL_V1_OPC_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_OPC_MEDIA_TYPE,
    extension: STUDIO_WILL_V1_OPC_EXTENSION,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
}

function normalizeExecutionPolicy(
  value: unknown,
): StudioFirstPartyWillV1DocumentCodecExecutionPolicy {
  if (value === undefined) return "worker";
  if (value === "direct" || value === "worker") {
    return value;
  }
  throw new StudioFirstPartyWillV1DocumentCodecCertificationError(
    "INVALID_EXECUTION_POLICY",
    "First-party WILL v1 document codec execution policy is invalid.",
  );
}

type SuccessfulCodecExecution =
  | StudioFirstPartyWillV1DocumentCodecWorkerResult
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
    throw new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "CODEC_EXECUTION_ABORTED",
      "First-party WILL v1 document codec execution was aborted before direct execution.",
    );
  }
  const execution = await executeStudioCodecProvider(
    request,
    inputBytes,
    [provider],
  );
  if (!execution.ok) {
    throw new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "CODEC_EXECUTION_FAILED",
      `First-party WILL v1 Annex B document execution failed (${execution.code}).`,
    );
  }
  return execution;
}

function workerCertificationError(
  error: unknown,
): StudioFirstPartyWillV1DocumentCodecCertificationError {
  if (
    error instanceof
      StudioFirstPartyWillV1DocumentCodecWorkerClientError
  ) {
    if (error.code === "worker-aborted") {
      return new StudioFirstPartyWillV1DocumentCodecCertificationError(
        "CODEC_EXECUTION_ABORTED",
        "First-party WILL v1 document codec Worker execution was aborted.",
      );
    }
    if (error.code === "worker-timeout") {
      return new StudioFirstPartyWillV1DocumentCodecCertificationError(
        "CODEC_EXECUTION_TIMEOUT",
        "First-party WILL v1 document codec Worker execution timed out.",
      );
    }
    if (error.code === "worker-unavailable") {
      return new StudioFirstPartyWillV1DocumentCodecCertificationError(
        "CODEC_WORKER_REQUIRED",
        "First-party WILL v1 document codec Worker is required but unavailable.",
      );
    }
  }
  return new StudioFirstPartyWillV1DocumentCodecCertificationError(
    "CODEC_EXECUTION_FAILED",
    "First-party WILL v1 document codec Worker execution failed.",
  );
}

function executionMatchesProvider(
  execution: SuccessfulCodecExecution,
  request: StudioCodecExecutionRequest,
  provider: StudioCodecProvider,
): boolean {
  const receipt = execution.receipt;
  const manifest = provider.manifest;
  return (
    receipt.providerId === manifest.providerId
    && receipt.mode === manifest.mode
    && receipt.direction === request.direction
    && receipt.format === request.format
    && receipt.profile === request.profile
    && receipt.version === request.version
    && receipt.mimeType === request.mimeType
    && receipt.extension === request.extension
    && receipt.deterministic === true
    && receipt.input.byteLength >= 1
    && receipt.input.byteLength <= request.maxInputBytes
    && receipt.output.byteLength === execution.bytes.byteLength
    && receipt.output.byteLength <= request.maxOutputBytes
    && receipt.licenseGrant.id === manifest.licenseGrant.id
    && receipt.licenseGrant.expiresAt
      === manifest.licenseGrant.expiresAt
    && receipt.licenseGrant.scope.length
      === manifest.licenseGrant.scope.length
    && receipt.licenseGrant.scope.every(
      (scope, index) =>
        scope === manifest.licenseGrant.scope[index],
    )
    && receipt.officialClaims.externalAttestationAccepted === false
    && receipt.officialClaims.officialCodec === false
    && receipt.officialClaims.certified === false
    && receipt.officialClaims.trademarkAuthorized === false
  );
}

async function executeWithPolicy(
  input: ExecuteAndCertifyStudioFirstPartyWillV1DocumentCodecInput,
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
      execution =
        await runStudioFirstPartyWillV1DocumentCodecWorker(
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
    throw new StudioFirstPartyWillV1DocumentCodecCertificationError(
      "CODEC_EXECUTION_FAILED",
      "First-party WILL v1 document codec execution identity is invalid.",
    );
  }
  return Object.freeze({
    ...execution,
    executionProviderReceipt: Object.freeze({
      schemaVersion: 1,
      kind: "toonspectrum-codec-execution-provider-selection",
      selectedProvider: policy,
      attemptedProviders: Object.freeze([policy]) as readonly [
        StudioFirstPartyWillV1DocumentCodecExecutionPolicy,
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
  execution: StudioFirstPartyWillV1DocumentCertifiedExecution,
): boolean {
  try {
    return sameBytes(
      serializeStudioFirstPartyWillV1DocumentConformanceEvidence(
        execution.conformance,
      ),
      execution.conformanceBytes,
    );
  } catch {
    return false;
  }
}

export async function executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
  input: ExecuteAndCertifyStudioFirstPartyWillV1DocumentCodecInput,
  signer: StudioProductCodecCertificationSigner,
): Promise<StudioFirstPartyWillV1DocumentCertifiedExecution> {
  let guard: StudioCodecCertificationPipelineGuard;
  try {
    guard = createStudioCodecCertificationPipelineGuard({
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      defaultTimeoutMs:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS,
      minTimeoutMs:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS,
      maxTimeoutMs:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS,
    });
  } catch (error) {
    throw mapPipelineGuardError(error);
  }
  try {
    const providers = input.providers ?? [
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
    ];
    const provider = providerFor(providers);
    const execution = await guard.run((signal) =>
      executeWithPolicy({
        ...input,
        signal,
        timeoutMs: guard.timeoutMs,
      }, provider)
    );
    const conformance = await guard.run(() =>
      createStudioFirstPartyWillV1DocumentConformanceEvidence([provider])
    );
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope(
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
            STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_EVIDENCE_MEDIA_TYPE,
          scope,
          issuedAt: input.issuedAt,
          ...(input.notBefore ? { notBefore: input.notBefore } : {}),
          expiresAt: input.expiresAt,
        },
        signer,
      )
    );
    return Object.freeze({
      kind:
        "toonspectrum-first-party-will-v1-annex-b-document-certified-execution",
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

export async function verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
  execution: StudioFirstPartyWillV1DocumentCertifiedExecution,
  options: VerifyStudioFirstPartyWillV1DocumentCertifiedExecutionOptions,
): Promise<StudioFirstPartyWillV1DocumentCertifiedExecutionVerification> {
  const expectedScope =
    studioFirstPartyWillV1DocumentCodecCertificationScope(
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
  if (
    execution.kind
      !== "toonspectrum-first-party-will-v1-annex-b-document-certified-execution"
    || execution.scope !== expectedScope
    || verified.certificate.evidence.mediaType
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_EVIDENCE_MEDIA_TYPE
    || !conformanceObjectMatches(execution)
    || !sameReceipt(execution.receipt, receipt)
    || !sameExecutionProviderReceipt(
      execution.executionProviderReceipt,
      verified.certificate.executionProviderReceipt,
    )
    || receipt.providerId
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest.providerId
    || receipt.format !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT
    || receipt.direction !== execution.direction
    || receipt.profile !== STUDIO_WILL_V1_OPC_PROFILE
    || receipt.version !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION
    || receipt.mimeType !== STUDIO_WILL_V1_OPC_MEDIA_TYPE
    || receipt.extension !== STUDIO_WILL_V1_OPC_EXTENSION
    || receipt.mode !== "public-clean-room"
    || receipt.officialClaims.externalAttestationAccepted !== false
    || receipt.officialClaims.officialCodec !== false
    || receipt.officialClaims.certified !== false
    || receipt.officialClaims.trademarkAuthorized !== false
    || execution.conformance.format
      !== STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT
    || execution.conformance.profile !== STUDIO_WILL_V1_OPC_PROFILE
    || execution.conformance.mediaType !== STUDIO_WILL_V1_OPC_MEDIA_TYPE
    || execution.conformance.extension !== STUDIO_WILL_V1_OPC_EXTENSION
    || execution.conformance.providerId !== receipt.providerId
    || execution.conformance.coverage
      !== "annex-b-bounded-seven-part-document"
    || execution.conformance.annexAPathStreamCovered !== true
    || execution.conformance.annexBOpcContainerCovered !== true
    || execution.conformance.boundedSevenPartProfile !== true
    || execution.conformance.wacomSdkCodeUsed !== false
    || execution.conformance.thirdPartyCodecCertification !== false
    || execution.conformance.vendorTrademarkAuthorization !== false
    || execution.conformance.arbitraryVendorFileInteroperabilityCertified
      !== false
    || execution.conformance.decision !== "passed"
  ) {
    return Object.freeze({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
      message:
        "Certified WILL v1 Annex B document execution does not match the product certificate.",
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
