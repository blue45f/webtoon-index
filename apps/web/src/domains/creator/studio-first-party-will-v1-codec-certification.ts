/**
 * End-to-end WILL v1 Annex A provider execution + ToonSpectrum product certification.
 *
 * The certificate binds exact Path-stream bytes and bounded conformance evidence. It remains a
 * ToonSpectrum product certificate, not Wacom certification or an Annex B `.will` claim.
 */

import {
  executeStudioCodecProvider,
  type StudioCodecDirection,
  type StudioCodecExecutionReceipt,
  type StudioCodecExecutionRequest,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  createStudioFirstPartyWillV1ConformanceEvidence,
  serializeStudioFirstPartyWillV1ConformanceEvidence,
  type StudioFirstPartyWillV1ConformanceEvidence,
} from "./studio-first-party-will-v1-codec-conformance";
import {
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
} from "./studio-first-party-will-v1-codec-provider";
import {
  issueStudioProductCodecCertificate,
  verifyStudioProductCodecCertificate,
  type StudioProductCodecCertificate,
  type StudioProductCodecCertificationSigner,
  type StudioProductCodecCertificationTrustRoot,
  type StudioProductCodecCertificateVerificationResult,
} from "./studio-product-codec-certification";
import {
  STUDIO_WILL_V1_PATH_MEDIA_TYPE,
  STUDIO_WILL_V1_PROFILE,
} from "./studio-will-v1-interchange";

export const STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_EVIDENCE_MEDIA_TYPE =
  "application/vnd.toonspectrum.will-v1-annex-a-conformance+json" as const;

export interface ExecuteAndCertifyStudioFirstPartyWillV1CodecInput {
  readonly direction: StudioCodecDirection;
  readonly inputBytes: Uint8Array;
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly expiresAt: string;
  readonly providers?: readonly StudioCodecProvider[];
}

export interface StudioFirstPartyWillV1CertifiedExecution {
  readonly kind: "toonspectrum-first-party-will-v1-certified-execution";
  readonly direction: StudioCodecDirection;
  readonly scope: string;
  readonly bytes: Uint8Array;
  readonly receipt: StudioCodecExecutionReceipt;
  readonly conformance: StudioFirstPartyWillV1ConformanceEvidence;
  readonly conformanceBytes: Uint8Array;
  readonly certificateBytes: Uint8Array;
}

export interface VerifyStudioFirstPartyWillV1CertifiedExecutionOptions {
  readonly trustRoots: readonly StudioProductCodecCertificationTrustRoot[];
  readonly nowEpochMs?: number;
  readonly revokedCertificateIds?: ReadonlySet<string>;
  readonly revokedKeyIds?: ReadonlySet<string>;
  readonly claimCertificateId?: (
    certificateId: string,
  ) => boolean | Promise<boolean>;
}

export type StudioFirstPartyWillV1CertifiedExecutionVerification =
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

export class StudioFirstPartyWillV1CodecCertificationError extends Error {
  readonly code:
    | "CODEC_EXECUTION_FAILED"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyWillV1CodecCertificationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1CodecCertificationError";
    this.code = code;
  }
}

export function studioFirstPartyWillV1CodecCertificationScope(
  direction: StudioCodecDirection,
): string {
  return `toonspectrum.product.codec-conformance.will-v1-path-stream-${direction}`;
}

function providerFor(
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const matches = providers.filter(
    (provider) => provider === STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyWillV1CodecCertificationError(
      "PROVIDER_NOT_FOUND",
      "Expected one first-party WILL v1 Annex A provider.",
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
    format: STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
    profile: STUDIO_WILL_V1_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_PATH_MEDIA_TYPE,
    extension: provider.manifest.extensions[0]!,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
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
  execution: StudioFirstPartyWillV1CertifiedExecution,
): boolean {
  try {
    return sameBytes(
      serializeStudioFirstPartyWillV1ConformanceEvidence(
        execution.conformance,
      ),
      execution.conformanceBytes,
    );
  } catch {
    return false;
  }
}

export async function executeAndCertifyStudioFirstPartyWillV1Codec(
  input: ExecuteAndCertifyStudioFirstPartyWillV1CodecInput,
  signer: StudioProductCodecCertificationSigner,
): Promise<StudioFirstPartyWillV1CertifiedExecution> {
  const providers = input.providers ?? [
    STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  ];
  const provider = providerFor(providers);
  const execution = await executeStudioCodecProvider(
    requestFor(provider, input.direction),
    input.inputBytes,
    [provider],
  );
  if (!execution.ok) {
    throw new StudioFirstPartyWillV1CodecCertificationError(
      "CODEC_EXECUTION_FAILED",
      `First-party WILL v1 codec execution failed (${execution.code}).`,
    );
  }
  const conformance =
    await createStudioFirstPartyWillV1ConformanceEvidence([provider]);
  const scope = studioFirstPartyWillV1CodecCertificationScope(input.direction);
  const certificateBytes = await issueStudioProductCodecCertificate(
    {
      receipt: execution.receipt,
      outputBytes: execution.bytes,
      evidenceBytes: conformance.bytes,
      evidenceMediaType:
        STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_EVIDENCE_MEDIA_TYPE,
      scope,
      issuedAt: input.issuedAt,
      ...(input.notBefore ? { notBefore: input.notBefore } : {}),
      expiresAt: input.expiresAt,
    },
    signer,
  );
  return Object.freeze({
    kind: "toonspectrum-first-party-will-v1-certified-execution",
    direction: input.direction,
    scope,
    bytes: execution.bytes,
    receipt: execution.receipt,
    conformance: conformance.evidence,
    conformanceBytes: conformance.bytes,
    certificateBytes,
  });
}

export async function verifyStudioFirstPartyWillV1CertifiedExecution(
  execution: StudioFirstPartyWillV1CertifiedExecution,
  options: VerifyStudioFirstPartyWillV1CertifiedExecutionOptions,
): Promise<StudioFirstPartyWillV1CertifiedExecutionVerification> {
  const expectedScope = studioFirstPartyWillV1CodecCertificationScope(
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
      !== "toonspectrum-first-party-will-v1-certified-execution"
    || execution.scope !== expectedScope
    || verified.certificate.evidence.mediaType
      !== STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_EVIDENCE_MEDIA_TYPE
    || !conformanceObjectMatches(execution)
    || !sameReceipt(execution.receipt, receipt)
    || receipt.format !== STUDIO_FIRST_PARTY_WILL_V1_FORMAT
    || receipt.providerId
      !== STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest.providerId
    || receipt.direction !== execution.direction
    || receipt.profile !== STUDIO_WILL_V1_PROFILE
    || receipt.version !== STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION
    || receipt.mode !== "public-clean-room"
    || execution.conformance.format !== STUDIO_FIRST_PARTY_WILL_V1_FORMAT
    || execution.conformance.profile !== STUDIO_WILL_V1_PROFILE
    || execution.conformance.providerId !== receipt.providerId
    || execution.conformance.coverage !== "annex-a-path-stream-only"
    || execution.conformance.annexBContainerCovered !== false
    || execution.conformance.decision !== "passed"
  ) {
    return Object.freeze({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
      message:
        "Certified WILL v1 Annex A execution does not match the product certificate.",
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
