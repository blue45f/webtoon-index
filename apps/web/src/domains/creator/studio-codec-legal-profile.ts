/**
 * Codec capability and distribution boundary.
 *
 * This is a machine-readable product record, not legal advice, patent clearance, a trademark
 * licence, or an official certification. It deliberately separates a codec/container being
 * technically usable from who supplies the implementation and whether that implementation is
 * included in ToonSpectrum's distribution.
 */

export const STUDIO_CODEC_LEGAL_PROFILE_VERSION = 1 as const;

export type StudioWebmCodecId = "V_AV1" | "V_VP8" | "V_VP9";
export type StudioCodecTechnicalAvailability =
  | "product-implemented"
  | "runtime-probe-required"
  | "unavailable";
export type StudioCodecDistributionStatus =
  | "first-party-source-included"
  | "runtime-implementation-not-bundled"
  | "external-license-required"
  | "blocked";

export interface StudioCodecContainerDescriptor {
  readonly id: "webm";
  readonly implementation: "toonspectrum-ebml-webm-muxer";
  readonly technicalAvailability: StudioCodecTechnicalAvailability;
  /**
   * Distribution status describes the implementation binary/source, not patent clearance or a
   * promise that every possible use of the produced file is licensed.
   */
  readonly distributionStatus: StudioCodecDistributionStatus;
  readonly provider: "ToonSpectrum";
}

export interface StudioCodecBitstreamDescriptor {
  readonly id: "av1" | "vp8" | "vp9";
  readonly matroskaCodecId: StudioWebmCodecId;
  readonly implementation: "browser-webcodecs-videoencoder";
  readonly technicalAvailability: StudioCodecTechnicalAvailability;
  readonly distributionStatus: StudioCodecDistributionStatus;
  readonly provider: "browser-runtime";
}

export interface StudioCodecCertificationDescriptor {
  readonly status: "not-claimed";
  readonly provider: null;
}

export interface StudioCodecLegalProfile {
  readonly profileVersion: typeof STUDIO_CODEC_LEGAL_PROFILE_VERSION;
  readonly container: StudioCodecContainerDescriptor;
  readonly codec: StudioCodecBitstreamDescriptor;
  readonly certification: StudioCodecCertificationDescriptor;
  readonly notices: readonly string[];
}

export type StudioCodecLegalProfileErrorCode =
  | "INVALID_CODEC_PROFILE"
  | "UNSUPPORTED_WEBM_CODEC_PROFILE";

export class StudioCodecLegalProfileError extends Error {
  readonly code: StudioCodecLegalProfileErrorCode;
  readonly path: string;

  constructor(code: StudioCodecLegalProfileErrorCode, message: string, path: string) {
    super(message);
    this.name = "StudioCodecLegalProfileError";
    this.code = code;
    this.path = path;
  }
}

const ROOT_KEYS = Object.freeze([
  "profileVersion",
  "container",
  "codec",
  "certification",
  "notices",
] as const);
const CONTAINER_KEYS = Object.freeze([
  "id",
  "implementation",
  "technicalAvailability",
  "distributionStatus",
  "provider",
] as const);
const CODEC_KEYS = Object.freeze([
  "id",
  "matroskaCodecId",
  "implementation",
  "technicalAvailability",
  "distributionStatus",
  "provider",
] as const);
const CERTIFICATION_KEYS = Object.freeze(["status", "provider"] as const);

const TECHNICAL_AVAILABILITY = new Set<StudioCodecTechnicalAvailability>([
  "product-implemented",
  "runtime-probe-required",
  "unavailable",
]);
const DISTRIBUTION_STATUS = new Set<StudioCodecDistributionStatus>([
  "first-party-source-included",
  "runtime-implementation-not-bundled",
  "external-license-required",
  "blocked",
]);
const CODEC_IDS = new Set<StudioCodecBitstreamDescriptor["id"]>(["av1", "vp8", "vp9"]);
const MATROSKA_CODEC_IDS = new Set<StudioWebmCodecId>(["V_AV1", "V_VP8", "V_VP9"]);

function fail(message: string, path: string): never {
  throw new StudioCodecLegalProfileError("INVALID_CODEC_PROFILE", message, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Codec profile field must be an object.", path);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length
    || actual.some((key, index) => key !== required[index])
  ) {
    fail("Codec profile field has missing or unsupported keys.", path);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("Codec profile string must not be empty.", path);
  }
  return value;
}

function validateContainer(value: unknown): StudioCodecContainerDescriptor {
  const container = record(value, "/container");
  exactKeys(container, CONTAINER_KEYS, "/container");
  if (container.id !== "webm") fail("Unsupported container profile.", "/container/id");
  if (container.implementation !== "toonspectrum-ebml-webm-muxer") {
    fail("Unsupported container implementation.", "/container/implementation");
  }
  if (
    !TECHNICAL_AVAILABILITY.has(
      container.technicalAvailability as StudioCodecTechnicalAvailability
    )
  ) {
    fail("Unsupported technical availability.", "/container/technicalAvailability");
  }
  if (container.technicalAvailability !== "product-implemented") {
    fail(
      "The first-party WebM muxer must be recorded as product-implemented.",
      "/container/technicalAvailability"
    );
  }
  if (!DISTRIBUTION_STATUS.has(container.distributionStatus as StudioCodecDistributionStatus)) {
    fail("Unsupported implementation distribution status.", "/container/distributionStatus");
  }
  if (container.distributionStatus !== "first-party-source-included") {
    fail(
      "The first-party WebM muxer must use its exact distribution status.",
      "/container/distributionStatus"
    );
  }
  if (container.provider !== "ToonSpectrum") {
    fail("Unsupported container implementation provider.", "/container/provider");
  }
  return container as unknown as StudioCodecContainerDescriptor;
}

function validateCodec(value: unknown): StudioCodecBitstreamDescriptor {
  const codec = record(value, "/codec");
  exactKeys(codec, CODEC_KEYS, "/codec");
  if (!CODEC_IDS.has(codec.id as StudioCodecBitstreamDescriptor["id"])) {
    fail("Unsupported codec profile.", "/codec/id");
  }
  if (!MATROSKA_CODEC_IDS.has(codec.matroskaCodecId as StudioWebmCodecId)) {
    fail("Unsupported Matroska codec id.", "/codec/matroskaCodecId");
  }
  const expectedMatroskaId = `V_${String(codec.id).toUpperCase()}`;
  if (codec.matroskaCodecId !== expectedMatroskaId) {
    fail("Codec id and Matroska codec id do not match.", "/codec/matroskaCodecId");
  }
  if (codec.implementation !== "browser-webcodecs-videoencoder") {
    fail("Unsupported codec implementation.", "/codec/implementation");
  }
  if (
    !TECHNICAL_AVAILABILITY.has(codec.technicalAvailability as StudioCodecTechnicalAvailability)
  ) {
    fail("Unsupported technical availability.", "/codec/technicalAvailability");
  }
  if (codec.technicalAvailability !== "runtime-probe-required") {
    fail(
      "The browser encoder must remain behind a runtime capability probe.",
      "/codec/technicalAvailability"
    );
  }
  if (!DISTRIBUTION_STATUS.has(codec.distributionStatus as StudioCodecDistributionStatus)) {
    fail("Unsupported implementation distribution status.", "/codec/distributionStatus");
  }
  if (codec.distributionStatus !== "runtime-implementation-not-bundled") {
    fail(
      "The browser encoder must be recorded as a runtime implementation not bundled by ToonSpectrum.",
      "/codec/distributionStatus"
    );
  }
  if (codec.provider !== "browser-runtime") {
    fail("Unsupported codec implementation provider.", "/codec/provider");
  }
  return codec as unknown as StudioCodecBitstreamDescriptor;
}

function validateCertification(value: unknown): StudioCodecCertificationDescriptor {
  const certification = record(value, "/certification");
  exactKeys(certification, CERTIFICATION_KEYS, "/certification");
  if (certification.status !== "not-claimed" || certification.provider !== null) {
    fail(
      "An official certification may not be asserted by this product profile.",
      "/certification"
    );
  }
  return certification as unknown as StudioCodecCertificationDescriptor;
}

/**
 * Validates persisted or adapter-supplied profile data. Unknown keys/statuses fail closed so a
 * phrase such as "royalty-free" cannot silently become a product entitlement.
 */
export function validateStudioCodecLegalProfile(value: unknown): StudioCodecLegalProfile {
  const profile = record(value, "");
  exactKeys(profile, ROOT_KEYS, "");
  if (profile.profileVersion !== STUDIO_CODEC_LEGAL_PROFILE_VERSION) {
    fail("Unsupported codec profile version.", "/profileVersion");
  }
  const container = validateContainer(profile.container);
  const codec = validateCodec(profile.codec);
  const certification = validateCertification(profile.certification);
  if (!Array.isArray(profile.notices) || profile.notices.length < 1) {
    fail("Codec profile must include at least one notice.", "/notices");
  }
  const notices = profile.notices.map((notice, index) =>
    nonEmptyString(notice, `/notices/${index}`)
  );
  return {
    profileVersion: STUDIO_CODEC_LEGAL_PROFILE_VERSION,
    container,
    codec,
    certification,
    notices: Object.freeze(notices),
  };
}

const COMMON_NOTICES = Object.freeze([
  "Technical availability is not an official certification or a patent, trademark, or licence clearance.",
  "Implementation distribution status does not determine rights for every output, market, or use case.",
] as const);

function createWebmProfile(
  id: StudioCodecBitstreamDescriptor["id"],
  matroskaCodecId: StudioWebmCodecId
): StudioCodecLegalProfile {
  const profile = validateStudioCodecLegalProfile({
    profileVersion: STUDIO_CODEC_LEGAL_PROFILE_VERSION,
    container: {
      id: "webm",
      implementation: "toonspectrum-ebml-webm-muxer",
      technicalAvailability: "product-implemented",
      distributionStatus: "first-party-source-included",
      provider: "ToonSpectrum",
    },
    codec: {
      id,
      matroskaCodecId,
      implementation: "browser-webcodecs-videoencoder",
      technicalAvailability: "runtime-probe-required",
      distributionStatus: "runtime-implementation-not-bundled",
      provider: "browser-runtime",
    },
    certification: {
      status: "not-claimed",
      provider: null,
    },
    notices: COMMON_NOTICES,
  });
  return Object.freeze({
    ...profile,
    container: Object.freeze(profile.container),
    codec: Object.freeze(profile.codec),
    certification: Object.freeze(profile.certification),
  });
}

export const STUDIO_WEBM_CODEC_LEGAL_PROFILES: Readonly<
  Record<StudioWebmCodecId, StudioCodecLegalProfile>
> = Object.freeze({
  V_AV1: createWebmProfile("av1", "V_AV1"),
  V_VP8: createWebmProfile("vp8", "V_VP8"),
  V_VP9: createWebmProfile("vp9", "V_VP9"),
});

/** Resolves a tested WebM track profile; unknown runtime input is rejected before muxing. */
export function studioWebmCodecLegalProfile(
  codecId: unknown
): StudioCodecLegalProfile {
  if (typeof codecId !== "string" || !Object.hasOwn(STUDIO_WEBM_CODEC_LEGAL_PROFILES, codecId)) {
    throw new StudioCodecLegalProfileError(
      "UNSUPPORTED_WEBM_CODEC_PROFILE",
      "WebM codec has no validated capability/distribution profile.",
      "/codecId"
    );
  }
  return STUDIO_WEBM_CODEC_LEGAL_PROFILES[codecId as StudioWebmCodecId];
}
