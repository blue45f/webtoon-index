/**
 * ToonSpectrum-owned conformance and self-certification boundary for `.toonink`.
 *
 * This report deliberately separates three different claims:
 * - codec conformance: the bytes obey ToonSpectrum's published wire profile;
 * - integrity: the canonical document digest matches the manifest;
 * - trusted attestation: a caller-selected key verifier accepted the signature.
 *
 * A `ToonSpectrum Verified` badge is awarded only for the third case. The badge is a
 * ToonSpectrum product claim; it is not a Wacom, Adobe, standards-body, copyright, or authorship
 * certification.
 */

import {
  STUDIO_INK_ENVELOPE_CODEC_VERSION,
  StudioInkEnvelopeError,
  assertStudioInkEnvelopeConformance,
  type StudioInkEnvelopeDecodeOptions,
} from "./brush/studio-ink-envelope-codec";

export const STUDIO_TOONINK_SELF_CERTIFICATION_ID =
  "toonspectrum.toonink.self-certification" as const;
export const STUDIO_TOONINK_SELF_CERTIFICATION_VERSION = 1 as const;
export const STUDIO_TOONINK_VERIFIED_BADGE =
  "toonspectrum-verified-v1" as const;

export const STUDIO_TOONINK_CONFORMANCE_CAPABILITIES = Object.freeze([
  "bounded-decode-v1",
  "canonical-json-utf8-v1",
  "domain-separated-attestation-v1",
  "sha256-integrity-v1",
  "strict-wire-schema-v1",
] as const);

export type StudioToonInkConformanceCapability =
  (typeof STUDIO_TOONINK_CONFORMANCE_CAPABILITIES)[number];

export interface StudioToonInkConformanceRequest {
  readonly id: typeof STUDIO_TOONINK_SELF_CERTIFICATION_ID;
  readonly version: typeof STUDIO_TOONINK_SELF_CERTIFICATION_VERSION;
  readonly requiredCapabilities: readonly StudioToonInkConformanceCapability[];
}

export interface StudioToonInkSelfCertificationOptions
  extends Omit<StudioInkEnvelopeDecodeOptions, "adapter"> {
  /**
   * Runtime-negotiated profile request. Unknown fields, future versions, and unknown capabilities
   * fail closed before the source is decoded.
   */
  readonly request?: unknown;
}

export type StudioToonInkCertificationErrorCode =
  | StudioInkEnvelopeError["code"]
  | "INVALID_CONFORMANCE_REQUEST"
  | "UNKNOWN_FUTURE_PROFILE_VERSION"
  | "UNSUPPORTED_CAPABILITY"
  | "UNSUPPORTED_PROFILE"
  | "UNEXPECTED_FAILURE";

export interface StudioToonInkSelfCertificationReport {
  readonly report: Readonly<{
    id: typeof STUDIO_TOONINK_SELF_CERTIFICATION_ID;
    version: typeof STUDIO_TOONINK_SELF_CERTIFICATION_VERSION;
  }>;
  readonly profile: Readonly<{
    codecVersion: typeof STUDIO_INK_ENVELOPE_CODEC_VERSION;
    capabilities: readonly StudioToonInkConformanceCapability[];
  }>;
  readonly result: Readonly<{
    conformance: "passed" | "rejected";
    integrity: "verified" | "unverified";
    attestation: "verified" | "not-present" | "unverified";
    badge: typeof STUDIO_TOONINK_VERIFIED_BADGE | null;
    contentDigest: `sha256:${string}` | null;
    keyId: string | null;
  }>;
  readonly error: Readonly<{
    code: StudioToonInkCertificationErrorCode;
    path: string | null;
  }> | null;
  readonly limitations: readonly string[];
}

const CAPABILITY_SET = new Set<string>(
  STUDIO_TOONINK_CONFORMANCE_CAPABILITIES
);
const REQUEST_KEYS = new Set([
  "id",
  "requiredCapabilities",
  "version",
]);
const LIMITATIONS = Object.freeze([
  "The badge proves ToonSpectrum codec conformance, canonical-content integrity, and acceptance by the configured key verifier only.",
  "The badge does not prove copyright ownership, human authorship, provenance outside the signed envelope, or third-party vendor certification.",
] as const);

interface RejectedRequest {
  readonly code: StudioToonInkCertificationErrorCode;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectRequest(
  code: StudioToonInkCertificationErrorCode
): RejectedRequest {
  return Object.freeze({ code });
}

function validateRequest(value: unknown): RejectedRequest | null {
  if (value === undefined) return null;
  if (!isPlainRecord(value)) {
    return rejectRequest("INVALID_CONFORMANCE_REQUEST");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== REQUEST_KEYS.size ||
    keys.some((key) => !REQUEST_KEYS.has(key))
  ) {
    return rejectRequest("INVALID_CONFORMANCE_REQUEST");
  }
  if (value.id !== STUDIO_TOONINK_SELF_CERTIFICATION_ID) {
    return rejectRequest("UNSUPPORTED_PROFILE");
  }
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    return rejectRequest("INVALID_CONFORMANCE_REQUEST");
  }
  if (value.version > STUDIO_TOONINK_SELF_CERTIFICATION_VERSION) {
    return rejectRequest("UNKNOWN_FUTURE_PROFILE_VERSION");
  }
  if (value.version !== STUDIO_TOONINK_SELF_CERTIFICATION_VERSION) {
    return rejectRequest("UNSUPPORTED_PROFILE");
  }
  if (!Array.isArray(value.requiredCapabilities)) {
    return rejectRequest("INVALID_CONFORMANCE_REQUEST");
  }
  const capabilities = value.requiredCapabilities;
  if (
    capabilities.length > STUDIO_TOONINK_CONFORMANCE_CAPABILITIES.length ||
    capabilities.some(
      (capability) =>
        typeof capability !== "string" || !CAPABILITY_SET.has(capability)
    )
  ) {
    return rejectRequest("UNSUPPORTED_CAPABILITY");
  }
  if (new Set(capabilities).size !== capabilities.length) {
    return rejectRequest("INVALID_CONFORMANCE_REQUEST");
  }
  return null;
}

function report(
  result: StudioToonInkSelfCertificationReport["result"],
  error: StudioToonInkSelfCertificationReport["error"]
): StudioToonInkSelfCertificationReport {
  return Object.freeze({
    report: Object.freeze({
      id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
      version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
    }),
    profile: Object.freeze({
      codecVersion: STUDIO_INK_ENVELOPE_CODEC_VERSION,
      capabilities: STUDIO_TOONINK_CONFORMANCE_CAPABILITIES,
    }),
    result: Object.freeze(result),
    error: error === null ? null : Object.freeze(error),
    limitations: LIMITATIONS,
  });
}

function rejectedReport(
  code: StudioToonInkCertificationErrorCode,
  path: string | null = null,
  attestation: "not-present" | "unverified" = "unverified"
): StudioToonInkSelfCertificationReport {
  return report(
    {
      conformance: "rejected",
      integrity: "unverified",
      attestation,
      badge: null,
      contentDigest: null,
      keyId: null,
    },
    { code, path }
  );
}

/**
 * Produces a deterministic, non-throwing conformance receipt suitable for UI, CLI, and CI use.
 *
 * Rejected or unverifiable inputs never receive a badge. Unsigned but otherwise conformant files
 * receive a conformance receipt without a badge. Signed files receive a badge only after the
 * caller-supplied trust verifier accepts the domain-separated signature.
 */
export async function verifyStudioToonInkSelfCertification(
  source: unknown,
  options: StudioToonInkSelfCertificationOptions = {}
): Promise<StudioToonInkSelfCertificationReport> {
  const requestFailure = validateRequest(options.request);
  if (requestFailure) return rejectedReport(requestFailure.code);

  try {
    const decoded = await assertStudioInkEnvelopeConformance(source, {
      attestationVerifier: options.attestationVerifier,
      limits: options.limits,
      maxWireBytes: options.maxWireBytes,
      requireAttestation: options.requireAttestation,
    });
    const attestation = decoded.manifest.attestation;
    const attestationStatus =
      attestation === null ? "not-present" : "verified";
    return report(
      {
        conformance: "passed",
        integrity: "verified",
        attestation: attestationStatus,
        badge:
          attestationStatus === "verified"
            ? STUDIO_TOONINK_VERIFIED_BADGE
            : null,
        contentDigest: decoded.manifest.contentDigest,
        keyId: attestation?.keyId ?? null,
      },
      null
    );
  } catch (error) {
    if (error instanceof StudioInkEnvelopeError) {
      return rejectedReport(
        error.code,
        error.path ?? null,
        error.code === "ATTESTATION_REQUIRED" ? "not-present" : "unverified"
      );
    }
    return rejectedReport("UNEXPECTED_FAILURE");
  }
}
