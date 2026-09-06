/**
 * ICC provider / rights policy.
 *
 * Parsing a profile is not permission to bundle, embed, or redistribute it. This module keeps the
 * byte-level ICC facts, provider provenance, rights declaration, and the capability Studio can
 * actually execute in separate fields. It never treats a profile description or copyright tag as
 * a license grant.
 */

import {
  parseIccProfile,
  type StudioIccProfile,
} from "./render/studio-canvaskit-icc-profile";

export const STUDIO_ICC_PROFILE_POLICY_VERSION = 1 as const;
export const STUDIO_ICC_PROFILE_POLICY_SCHEMA =
  "toonspectrum-icc-profile-policy/v1" as const;
export const STUDIO_ICC_MAX_PROFILE_BYTES = 16 * 1024 * 1024;

export interface StudioBundledIccProfileGrant {
  readonly sha256: string;
  readonly providerId: string;
  readonly provenance: string;
  readonly licenseClass: "permissive" | "project-generated" | "public-domain";
  readonly licenseId: string;
}

/**
 * Bundling is an explicit code-reviewed allowlist, not a user-editable rights assertion. Adding a
 * profile requires committing its exact SHA-256 and provenance; commercial/vendor bytes cannot be
 * relabelled as "project-generated" at runtime.
 */
export const STUDIO_BUNDLED_ICC_PROFILE_ALLOWLIST: Readonly<
  Record<string, StudioBundledIccProfileGrant>
> = Object.freeze({
  "toonspectrum-srgb-v2": Object.freeze({
    sha256: "320e97fb94f085925d825687024459249524fcc5d8308ec3764295b957d6a8cd",
    providerId: "toonspectrum",
    provenance: "project-generated:studio-canvaskit-icc-profile",
    licenseClass: "project-generated",
    licenseId: "ToonSpectrum-generated-profile-v1",
  }),
});

export type StudioIccProfileSourceKind = "bundled" | "printer" | "public" | "user";
export type StudioIccProfileRequestedUse =
  | "embed"
  | "inspect"
  | "redistribute"
  | "transform";
export type StudioIccLicenseClass =
  | "commercial"
  | "permissive"
  | "printer-supplied"
  | "project-generated"
  | "public-domain"
  | "restricted"
  | "user-authorized";
export type StudioIccPermission = "allowed" | "forbidden";
export type StudioIccKnownDeviceClass = "abst" | "mntr" | "prtr" | "scnr" | "spac";
export type StudioIccKnownDataColorSpace = "CMYK" | "GRAY" | "RGB ";
export type StudioIccKnownPcs = "Lab " | "XYZ ";

export interface StudioIccProviderSource {
  readonly kind: StudioIccProfileSourceKind;
  /** Stable local/catalog identifier, not a trademark or certification claim. */
  readonly providerId: string;
  /** Public page, user upload label, or printer hand-off reference. Never fetched by this policy. */
  readonly provenance: string | null;
}

export interface StudioIccRightsDeclaration {
  readonly licenseClass: StudioIccLicenseClass;
  readonly licenseId: string;
  readonly redistribution: StudioIccPermission;
  readonly embedding: StudioIccPermission;
  readonly commercialUse: StudioIccPermission;
}

export interface StudioIccDeclaredCapabilities {
  readonly matrixTrcRgb: boolean;
  readonly trc: boolean;
  readonly lut: boolean;
  readonly cmyk: boolean;
}

export interface StudioIccExpectedIdentity {
  /** Required for bundled/public/printer sources. User uploads may establish it during this audit. */
  readonly sha256: string | null;
  readonly versionMajor: 2 | 4;
  /** ICC v2 must declare null; ICC v4 must match the non-zero 16-byte header profile ID. */
  readonly profileId: string | null;
  readonly deviceClass: StudioIccKnownDeviceClass;
  readonly dataColorSpace: StudioIccKnownDataColorSpace;
  readonly pcs: StudioIccKnownPcs;
  readonly capabilities: StudioIccDeclaredCapabilities;
}

export interface StudioIccProviderManifest {
  readonly schemaVersion: 1;
  readonly profileKey: string;
  readonly source: StudioIccProviderSource;
  readonly rights: StudioIccRightsDeclaration;
  readonly expected: StudioIccExpectedIdentity;
}

/** Product-owned deterministic sRGB profile manifest used by PDF/A/PDF/X and raster color policy. */
export const STUDIO_BUNDLED_SRGB_ICC_MANIFEST: StudioIccProviderManifest =
  Object.freeze({
    schemaVersion: 1,
    profileKey: "toonspectrum-srgb-v2",
    source: Object.freeze({
      kind: "bundled",
      providerId: "toonspectrum",
      provenance: "project-generated:studio-canvaskit-icc-profile",
    }),
    rights: Object.freeze({
      licenseClass: "project-generated",
      licenseId: "ToonSpectrum-generated-profile-v1",
      redistribution: "allowed",
      embedding: "allowed",
      commercialUse: "allowed",
    }),
    expected: Object.freeze({
      sha256: STUDIO_BUNDLED_ICC_PROFILE_ALLOWLIST["toonspectrum-srgb-v2"]!.sha256,
      versionMajor: 2,
      profileId: null,
      deviceClass: "mntr",
      dataColorSpace: "RGB ",
      pcs: "XYZ ",
      capabilities: Object.freeze({
        matrixTrcRgb: true,
        trc: true,
        lut: false,
        cmyk: false,
      }),
    }),
  });

export interface StudioIccProfilePolicyRequest {
  readonly bytes: Uint8Array;
  readonly requestedUse: StudioIccProfileRequestedUse;
  readonly manifest: StudioIccProviderManifest;
}

export type StudioIccPolicyRejectionCode =
  | "CAPABILITY_MISMATCH"
  | "CAPABILITY_UNSUPPORTED"
  | "CHECKSUM_MISMATCH"
  | "CHECKSUM_UNAVAILABLE"
  | "INPUT_TOO_LARGE"
  | "INVALID_PROFILE"
  | "INVALID_REQUEST"
  | "MANIFEST_MISMATCH"
  | "PROFILE_ID_REQUIRED"
  | "PROFILE_ID_RESERVED"
  | "RESERVED_HEADER"
  | "RIGHTS_DENIED"
  | "SOURCE_POLICY_DENIED"
  | "UNEXPECTED_FAILURE"
  | "UNKNOWN_COLOR_SPACE"
  | "UNKNOWN_DEVICE_CLASS"
  | "UNKNOWN_PCS"
  | "UNSUPPORTED_VERSION";

export interface StudioIccDetectedCapabilities extends StudioIccDeclaredCapabilities {
  /** Existing Studio core only executes RGB matrix/TRC. LUT/CMYK remain inspect/embed-only. */
  readonly studioTransform: "inspect-only" | "rgb-matrix-trc";
}

export interface StudioIccPolicyHeaderReceipt {
  readonly version: string;
  readonly versionMajor: 2 | 4;
  readonly profileId: string | null;
  readonly profileIdVerification: "header-matched-manifest" | "v2-reserved-zero";
  readonly deviceClass: StudioIccKnownDeviceClass;
  readonly dataColorSpace: StudioIccKnownDataColorSpace;
  readonly pcs: StudioIccKnownPcs;
  readonly profileSize: number;
}

export interface StudioIccProfilePolicyReceipt {
  readonly schema: typeof STUDIO_ICC_PROFILE_POLICY_SCHEMA;
  readonly policyVersion: typeof STUDIO_ICC_PROFILE_POLICY_VERSION;
  readonly receiptId: string;
  readonly verdict: "accepted" | "rejected";
  readonly rejectionCode: StudioIccPolicyRejectionCode | null;
  readonly requestedUse: StudioIccProfileRequestedUse | null;
  readonly profileKey: string | null;
  readonly checksum: {
    readonly algorithm: "SHA-256";
    readonly actual: string | null;
    readonly expected: string | null;
    readonly matched: boolean | null;
  };
  readonly source: StudioIccProviderSource | null;
  readonly rights: StudioIccRightsDeclaration | null;
  readonly header: StudioIccPolicyHeaderReceipt | null;
  readonly capabilities: StudioIccDetectedCapabilities | null;
  readonly certification: {
    readonly thirdParty: "not-claimed";
    readonly note: "ToonSpectrum policy acceptance is not an ICC, vendor, printer, or trademark certification.";
  };
}

export type StudioIccProfilePolicyResult =
  | {
      readonly ok: true;
      readonly receipt: StudioIccProfilePolicyReceipt;
      readonly profile: StudioIccProfile;
    }
  | {
      readonly ok: false;
      readonly code: StudioIccPolicyRejectionCode;
      readonly error: string;
      readonly receipt: StudioIccProfilePolicyReceipt;
    };

const REQUEST_KEYS = ["bytes", "manifest", "requestedUse"] as const;
const MANIFEST_KEYS = ["expected", "profileKey", "rights", "schemaVersion", "source"] as const;
const SOURCE_KEYS = ["kind", "provenance", "providerId"] as const;
const RIGHTS_KEYS = [
  "commercialUse",
  "embedding",
  "licenseClass",
  "licenseId",
  "redistribution",
] as const;
const EXPECTED_KEYS = [
  "capabilities",
  "dataColorSpace",
  "deviceClass",
  "pcs",
  "profileId",
  "sha256",
  "versionMajor",
] as const;
const CAPABILITY_KEYS = ["cmyk", "lut", "matrixTrcRgb", "trc"] as const;

const REQUESTED_USES = new Set<StudioIccProfileRequestedUse>([
  "embed",
  "inspect",
  "redistribute",
  "transform",
]);
const SOURCE_KINDS = new Set<StudioIccProfileSourceKind>([
  "bundled",
  "printer",
  "public",
  "user",
]);
const LICENSE_CLASSES = new Set<StudioIccLicenseClass>([
  "commercial",
  "permissive",
  "printer-supplied",
  "project-generated",
  "public-domain",
  "restricted",
  "user-authorized",
]);
const PERMISSIONS = new Set<StudioIccPermission>(["allowed", "forbidden"]);
const DEVICE_CLASSES = new Set<StudioIccKnownDeviceClass>([
  "abst",
  "mntr",
  "prtr",
  "scnr",
  "spac",
]);
const DATA_COLOR_SPACES = new Set<StudioIccKnownDataColorSpace>(["CMYK", "GRAY", "RGB "]);
const PCS_VALUES = new Set<StudioIccKnownPcs>(["Lab ", "XYZ "]);
const SAFE_BUNDLED_LICENSES = new Set<StudioIccLicenseClass>([
  "permissive",
  "project-generated",
  "public-domain",
]);
const SAFE_PUBLIC_LICENSES = new Set<StudioIccLicenseClass>(["permissive", "public-domain"]);
const USER_LICENSES = new Set<StudioIccLicenseClass>([
  "commercial",
  "permissive",
  "public-domain",
  "user-authorized",
]);
const PRINTER_LICENSES = new Set<StudioIccLicenseClass>(["commercial", "printer-supplied"]);

const ERROR_MESSAGES: Readonly<Record<StudioIccPolicyRejectionCode, string>> = {
  CAPABILITY_MISMATCH: "ICC manifest의 capability 선언이 실제 프로파일 구조와 일치하지 않습니다.",
  CAPABILITY_UNSUPPORTED: "현재 Studio 색 변환 엔진이 요청한 ICC capability를 실행할 수 없습니다.",
  CHECKSUM_MISMATCH: "ICC 프로파일 SHA-256이 provider manifest와 일치하지 않습니다.",
  CHECKSUM_UNAVAILABLE: "SHA-256을 계산할 수 없는 런타임이라 ICC 프로파일을 승인하지 않았습니다.",
  INPUT_TOO_LARGE: "ICC 프로파일이 16MiB 안전 상한을 초과합니다.",
  INVALID_PROFILE: "ICC 프로파일 구조 검증에 실패했습니다.",
  INVALID_REQUEST: "ICC policy 요청 또는 manifest 구조가 올바르지 않습니다.",
  MANIFEST_MISMATCH: "ICC header identity가 provider manifest와 일치하지 않습니다.",
  PROFILE_ID_REQUIRED: "ICC v4 프로파일은 non-zero header profile ID와 manifest 일치가 필요합니다.",
  PROFILE_ID_RESERVED: "ICC v2에서 예약된 profile ID 영역은 모두 0이어야 합니다.",
  RESERVED_HEADER: "ICC header의 예약 영역 또는 예약 비트가 0이 아닙니다.",
  RIGHTS_DENIED: "선언된 ICC 권한으로 요청한 임베딩·재배포 작업을 허용할 수 없습니다.",
  SOURCE_POLICY_DENIED: "ICC 제공 출처와 라이선스 유형 조합을 제품 정책에서 허용하지 않습니다.",
  UNEXPECTED_FAILURE: "ICC policy 평가 중 예기치 않은 오류가 발생해 승인을 거부했습니다.",
  UNKNOWN_COLOR_SPACE: "지원 정책에 등록되지 않은 ICC data color space입니다.",
  UNKNOWN_DEVICE_CLASS: "지원 정책에 등록되지 않은 ICC device class입니다.",
  UNKNOWN_PCS: "지원 정책에 등록되지 않은 ICC PCS입니다.",
  UNSUPPORTED_VERSION: "지원 범위를 벗어난 ICC version입니다.",
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value);
}

function validateManifestShape(request: unknown): request is StudioIccProfilePolicyRequest {
  if (!isPlainRecord(request) || !hasExactKeys(request, REQUEST_KEYS)) return false;
  if (!(request.bytes instanceof Uint8Array)) return false;
  if (!REQUESTED_USES.has(request.requestedUse as StudioIccProfileRequestedUse)) return false;
  if (!isPlainRecord(request.manifest) || !hasExactKeys(request.manifest, MANIFEST_KEYS)) return false;
  const manifest = request.manifest;
  if (manifest.schemaVersion !== 1 || !isBoundedText(manifest.profileKey, 128)) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.profileKey)) return false;

  if (!isPlainRecord(manifest.source) || !hasExactKeys(manifest.source, SOURCE_KEYS)) return false;
  const source = manifest.source;
  if (!SOURCE_KINDS.has(source.kind as StudioIccProfileSourceKind)) return false;
  if (!isBoundedText(source.providerId, 128)) return false;
  if (source.provenance !== null && !isBoundedText(source.provenance, 2_048)) return false;

  if (!isPlainRecord(manifest.rights) || !hasExactKeys(manifest.rights, RIGHTS_KEYS)) return false;
  const rights = manifest.rights;
  if (!LICENSE_CLASSES.has(rights.licenseClass as StudioIccLicenseClass)) return false;
  if (!isBoundedText(rights.licenseId, 256)) return false;
  if (!PERMISSIONS.has(rights.redistribution as StudioIccPermission)) return false;
  if (!PERMISSIONS.has(rights.embedding as StudioIccPermission)) return false;
  if (!PERMISSIONS.has(rights.commercialUse as StudioIccPermission)) return false;

  if (!isPlainRecord(manifest.expected) || !hasExactKeys(manifest.expected, EXPECTED_KEYS)) return false;
  const expected = manifest.expected;
  if (expected.versionMajor !== 2 && expected.versionMajor !== 4) return false;
  if (expected.sha256 !== null && !isHex(expected.sha256, 64)) return false;
  if (expected.profileId !== null && !isHex(expected.profileId, 32)) return false;
  if (!DEVICE_CLASSES.has(expected.deviceClass as StudioIccKnownDeviceClass)) return false;
  if (!DATA_COLOR_SPACES.has(expected.dataColorSpace as StudioIccKnownDataColorSpace)) return false;
  if (!PCS_VALUES.has(expected.pcs as StudioIccKnownPcs)) return false;
  const capabilities = expected.capabilities;
  if (
    !isPlainRecord(capabilities) ||
    !hasExactKeys(capabilities, CAPABILITY_KEYS) ||
    !CAPABILITY_KEYS.every((key) => typeof capabilities[key] === "boolean")
  ) {
    return false;
  }
  return true;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const value of bytes) result += value.toString(16).padStart(2, "0");
  return result;
}

async function sha256(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(digest));
}

function detectedCapabilities(profile: StudioIccProfile): StudioIccDetectedCapabilities {
  const signatures = new Set(profile.tags.map((tag) => tag.signature));
  const matrixTrcRgb = profile.kind === "matrix-trc-rgb" && profile.matrixTrc !== null;
  const trc =
    (signatures.has("rTRC") && signatures.has("gTRC") && signatures.has("bTRC")) ||
    signatures.has("kTRC");
  const lut = profile.kind === "lut-based";
  const cmyk = profile.header.dataColorSpace === "CMYK";
  return {
    matrixTrcRgb,
    trc,
    lut,
    cmyk,
    studioTransform: matrixTrcRgb ? "rgb-matrix-trc" : "inspect-only",
  };
}

function capabilitiesMatch(
  expected: StudioIccDeclaredCapabilities,
  actual: StudioIccDetectedCapabilities,
): boolean {
  return CAPABILITY_KEYS.every((key) => expected[key] === actual[key]);
}

function validateSourcePolicy(manifest: StudioIccProviderManifest): boolean {
  const { source, rights, expected } = manifest;
  if (
    (source.kind === "bundled" || source.kind === "public" || source.kind === "printer") &&
    (source.provenance === null || expected.sha256 === null)
  ) {
    return false;
  }
  if (source.kind === "bundled") {
    const grant = STUDIO_BUNDLED_ICC_PROFILE_ALLOWLIST[manifest.profileKey];
    return (
      grant !== undefined &&
      SAFE_BUNDLED_LICENSES.has(rights.licenseClass) &&
      rights.redistribution === "allowed" &&
      rights.embedding === "allowed" &&
      rights.commercialUse === "allowed" &&
      expected.sha256 === grant.sha256 &&
      source.providerId === grant.providerId &&
      source.provenance === grant.provenance &&
      rights.licenseClass === grant.licenseClass &&
      rights.licenseId === grant.licenseId
    );
  }
  if (source.kind === "public") {
    return SAFE_PUBLIC_LICENSES.has(rights.licenseClass);
  }
  if (source.kind === "user") {
    return USER_LICENSES.has(rights.licenseClass);
  }
  return PRINTER_LICENSES.has(rights.licenseClass) && expected.deviceClass === "prtr";
}

function requestedUseAllowed(
  requestedUse: StudioIccProfileRequestedUse,
  rights: StudioIccRightsDeclaration,
  capabilities: StudioIccDetectedCapabilities,
): boolean {
  if (requestedUse === "inspect") return true;
  if (requestedUse === "transform") return capabilities.studioTransform === "rgb-matrix-trc";
  if (requestedUse === "embed") return rights.embedding === "allowed";
  return rights.redistribution === "allowed";
}

function emptyReceipt(
  code: StudioIccPolicyRejectionCode,
  request: unknown,
  checksumActual: string | null = null,
): StudioIccProfilePolicyReceipt {
  const typed = (() => {
    try {
      return validateManifestShape(request) ? request : null;
    } catch {
      return null;
    }
  })();
  const expected = typed?.manifest.expected.sha256 ?? null;
  return {
    schema: STUDIO_ICC_PROFILE_POLICY_SCHEMA,
    policyVersion: STUDIO_ICC_PROFILE_POLICY_VERSION,
    receiptId: `icc-audit-v1:${checksumActual ?? "unverified"}:${code}`,
    verdict: "rejected",
    rejectionCode: code,
    requestedUse: typed?.requestedUse ?? null,
    profileKey: typed?.manifest.profileKey ?? null,
    checksum: {
      algorithm: "SHA-256",
      actual: checksumActual,
      expected,
      matched: checksumActual !== null && expected !== null ? checksumActual === expected : null,
    },
    source: typed?.manifest.source ?? null,
    rights: typed?.manifest.rights ?? null,
    header: null,
    capabilities: null,
    certification: {
      thirdParty: "not-claimed",
      note: "ToonSpectrum policy acceptance is not an ICC, vendor, printer, or trademark certification.",
    },
  };
}

function reject(
  code: StudioIccPolicyRejectionCode,
  request: unknown,
  checksumActual: string | null = null,
): StudioIccProfilePolicyResult {
  return {
    ok: false,
    code,
    error: ERROR_MESSAGES[code],
    receipt: emptyReceipt(code, request, checksumActual),
  };
}

function acceptedReceipt(
  request: StudioIccProfilePolicyRequest,
  checksumActual: string,
  profile: StudioIccProfile,
  versionMajor: 2 | 4,
  profileId: string | null,
  capabilities: StudioIccDetectedCapabilities,
): StudioIccProfilePolicyReceipt {
  return {
    schema: STUDIO_ICC_PROFILE_POLICY_SCHEMA,
    policyVersion: STUDIO_ICC_PROFILE_POLICY_VERSION,
    receiptId: `icc-audit-v1:${checksumActual}:${request.requestedUse}`,
    verdict: "accepted",
    rejectionCode: null,
    requestedUse: request.requestedUse,
    profileKey: request.manifest.profileKey,
    checksum: {
      algorithm: "SHA-256",
      actual: checksumActual,
      expected: request.manifest.expected.sha256,
      matched:
        request.manifest.expected.sha256 === null
          ? null
          : checksumActual === request.manifest.expected.sha256,
    },
    source: request.manifest.source,
    rights: request.manifest.rights,
    header: {
      version: profile.header.version,
      versionMajor,
      profileId,
      profileIdVerification:
        versionMajor === 2 ? "v2-reserved-zero" : "header-matched-manifest",
      deviceClass: profile.header.deviceClass as StudioIccKnownDeviceClass,
      dataColorSpace: profile.header.dataColorSpace as StudioIccKnownDataColorSpace,
      pcs: profile.header.pcs as StudioIccKnownPcs,
      profileSize: profile.header.profileSize,
    },
    capabilities,
    certification: {
      thirdParty: "not-claimed",
      note: "ToonSpectrum policy acceptance is not an ICC, vendor, printer, or trademark certification.",
    },
  };
}

/**
 * Evaluates one immutable copy of the untrusted profile and returns a deterministic receipt.
 * No timestamps, random IDs, network calls, or provider-name allowlists are involved.
 */
export async function auditStudioIccProfilePolicy(
  request: StudioIccProfilePolicyRequest,
): Promise<StudioIccProfilePolicyResult> {
  try {
    if (!validateManifestShape(request)) return reject("INVALID_REQUEST", request);
    if (request.bytes.byteLength === 0) return reject("INVALID_PROFILE", request);
    if (request.bytes.byteLength > STUDIO_ICC_MAX_PROFILE_BYTES) {
      return reject("INPUT_TOO_LARGE", request);
    }

    const stableBytes = Uint8Array.from(request.bytes);
    const checksumActual = await sha256(stableBytes);
    if (checksumActual === null) return reject("CHECKSUM_UNAVAILABLE", request);
    const expectedChecksum = request.manifest.expected.sha256;
    if (expectedChecksum !== null && checksumActual !== expectedChecksum) {
      return reject("CHECKSUM_MISMATCH", request, checksumActual);
    }

    const parsed = parseIccProfile(stableBytes);
    if (!parsed.ok) return reject("INVALID_PROFILE", request, checksumActual);
    const { profile } = parsed;

    const versionMajor = stableBytes[8];
    const versionMinor = (stableBytes[9] ?? 0) >>> 4;
    if (
      (versionMajor !== 2 && versionMajor !== 4) ||
      versionMinor > 4 ||
      stableBytes[10] !== 0 ||
      stableBytes[11] !== 0
    ) {
      return reject("UNSUPPORTED_VERSION", request, checksumActual);
    }
    if (stableBytes.subarray(100, 128).some((value) => value !== 0)) {
      return reject("RESERVED_HEADER", request, checksumActual);
    }
    const flags = new DataView(
      stableBytes.buffer,
      stableBytes.byteOffset,
      stableBytes.byteLength,
    ).getUint32(44);
    if ((flags & ~0x3) !== 0) return reject("RESERVED_HEADER", request, checksumActual);

    if (!DEVICE_CLASSES.has(profile.header.deviceClass as StudioIccKnownDeviceClass)) {
      return reject("UNKNOWN_DEVICE_CLASS", request, checksumActual);
    }
    if (!DATA_COLOR_SPACES.has(profile.header.dataColorSpace as StudioIccKnownDataColorSpace)) {
      return reject("UNKNOWN_COLOR_SPACE", request, checksumActual);
    }
    if (!PCS_VALUES.has(profile.header.pcs as StudioIccKnownPcs)) {
      return reject("UNKNOWN_PCS", request, checksumActual);
    }

    const rawProfileId = stableBytes.subarray(84, 100);
    const profileIdIsZero = rawProfileId.every((value) => value === 0);
    const profileId = profileIdIsZero ? null : bytesToHex(rawProfileId);
    if (versionMajor === 2 && profileId !== null) {
      return reject("PROFILE_ID_RESERVED", request, checksumActual);
    }
    if (versionMajor === 4 && profileId === null) {
      return reject("PROFILE_ID_REQUIRED", request, checksumActual);
    }

    const expected = request.manifest.expected;
    if (
      expected.versionMajor !== versionMajor ||
      expected.profileId !== profileId ||
      expected.deviceClass !== profile.header.deviceClass ||
      expected.dataColorSpace !== profile.header.dataColorSpace ||
      expected.pcs !== profile.header.pcs
    ) {
      return reject("MANIFEST_MISMATCH", request, checksumActual);
    }

    const capabilities = detectedCapabilities(profile);
    if (!capabilitiesMatch(expected.capabilities, capabilities)) {
      return reject("CAPABILITY_MISMATCH", request, checksumActual);
    }
    if (!validateSourcePolicy(request.manifest)) {
      return reject("SOURCE_POLICY_DENIED", request, checksumActual);
    }
    if (!requestedUseAllowed(request.requestedUse, request.manifest.rights, capabilities)) {
      return reject(
        request.requestedUse === "transform" ? "CAPABILITY_UNSUPPORTED" : "RIGHTS_DENIED",
        request,
        checksumActual,
      );
    }

    return {
      ok: true,
      receipt: acceptedReceipt(
        request,
        checksumActual,
        profile,
        versionMajor,
        profileId,
        capabilities,
      ),
      profile,
    };
  } catch {
    return reject("UNEXPECTED_FAILURE", request);
  }
}
