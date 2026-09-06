import { z } from "zod";

import {
  creatorAssetLicenseOf,
  isCreatorAssetLicenseId,
  type CreatorAssetLicenseId,
} from "@/shared/lib/creator-asset-contract";

export const STUDIO_ASSET_RIGHTS_MANIFEST_SCHEMA =
  "toonspectrum.studio-asset-rights-manifest" as const;
export const STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA =
  "toonspectrum.studio-asset-rights-manifest-export" as const;
export const STUDIO_ASSET_RIGHTS_MANIFEST_VERSION = 1 as const;

export const STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER =
  "이 권리 명세는 현재 기기의 작품 납품 점검을 돕는 로컬 전용 기록입니다. 법률 자문, 권리 인증, 플랫폼 승인 또는 제3자의 권리 보유를 보장하지 않습니다. 게시·납품 전 원문 사용권과 대상 플랫폼의 최신 정책을 직접 확인하세요." as const;

export const STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS = Object.freeze({
  assets: 250,
  usages: 10_000,
  diagnostics: 2_000,
  identifierCodePoints: 160,
  versionCodePoints: 160,
  sourceCodePoints: 300,
  labelCodePoints: 160,
  attributionCodePoints: 1_000,
  reviewerCodePoints: 80,
  jsonBytes: 2 * 1_024 * 1_024,
  csvBytes: 4 * 1_024 * 1_024,
} as const);

export const STUDIO_ASSET_RIGHTS_SOURCE_KINDS = [
  "builtin",
  "community",
  "work-asset",
  "local-upload",
  "ai-generated",
  "external",
  "3d-library",
  "unknown",
] as const;
export type StudioAssetRightsSourceKind =
  (typeof STUDIO_ASSET_RIGHTS_SOURCE_KINDS)[number];

export const STUDIO_ASSET_RIGHTS_SCOPES = [
  "current-work",
  "commercial-publication",
  "marketing",
  "redistribution",
  "ai-training",
] as const;
export type StudioAssetRightsScope = (typeof STUDIO_ASSET_RIGHTS_SCOPES)[number];

export const STUDIO_ASSET_RIGHTS_PERMISSIONS = [
  "allowed",
  "prohibited",
  "unknown",
] as const;
export type StudioAssetRightsPermission =
  (typeof STUDIO_ASSET_RIGHTS_PERMISSIONS)[number];

export type StudioAssetRightsAttributionRequirement =
  | "required"
  | "not-required"
  | "unknown";
export type StudioAssetRightsLicenseId =
  | CreatorAssetLicenseId
  | "creator-owned"
  | "custom"
  | "unknown";
export type StudioAssetRightsExpiryState = "known" | "none" | "unknown";
export type StudioAssetRightsAttestationStatus =
  | "unreviewed"
  | "confirmed"
  | "rejected";

export interface StudioAssetRightsUsageInput {
  readonly assetId?: unknown;
  readonly assetVersion?: unknown;
  readonly source?: {
    readonly kind?: unknown;
    readonly id?: unknown;
  } | null;
  readonly scope?: unknown;
  readonly licenseId?: unknown;
  readonly licenseLabel?: unknown;
  readonly licenseUrl?: unknown;
  readonly attributionRequired?: unknown;
  readonly attributionText?: unknown;
  readonly commercialUse?: unknown;
  readonly aiTraining?: unknown;
  readonly redistribution?: unknown;
  /**
   * ISO timestamp means a finite grant, `null` explicitly means no known expiry, and `undefined`
   * means the expiry was not checked. The latter remains fail-closed.
   */
  readonly expiresAt?: unknown;
  readonly pageId?: unknown;
  readonly elementId?: unknown;
}

export interface StudioAssetRightsAttestationInput {
  readonly status?: unknown;
  readonly reviewedAt?: unknown;
  /**
   * Display label only. Account IDs, e-mail addresses, order IDs and signatures do not belong in
   * this local delivery artifact.
   */
  readonly reviewer?: unknown;
}

export interface StudioAssetRightsManifestBuildInput {
  readonly workId?: unknown;
  readonly usages: readonly StudioAssetRightsUsageInput[];
  readonly attestation?: StudioAssetRightsAttestationInput | null;
  readonly now?: number;
}

export interface StudioAssetRightsSource {
  readonly kind: StudioAssetRightsSourceKind;
  readonly id: string | null;
}

export interface StudioAssetRightsLicense {
  readonly id: StudioAssetRightsLicenseId;
  readonly declaredId: string | null;
  readonly label: string;
  readonly url: string | null;
}

export interface StudioAssetRightsAttribution {
  readonly requirement: StudioAssetRightsAttributionRequirement;
  readonly text: string;
}

export interface StudioAssetRightsUsageLocation {
  readonly pageId: string | null;
  readonly elementId: string | null;
}

export interface StudioAssetRightsManifestAsset {
  readonly assetId: string;
  readonly assetVersion: string | null;
  readonly source: StudioAssetRightsSource;
  readonly scope: readonly StudioAssetRightsScope[];
  readonly license: StudioAssetRightsLicense;
  readonly attribution: StudioAssetRightsAttribution;
  readonly commercialUse: StudioAssetRightsPermission;
  readonly aiTraining: StudioAssetRightsPermission;
  readonly redistribution: StudioAssetRightsPermission;
  readonly expiryState: StudioAssetRightsExpiryState;
  readonly expiresAt: string | null;
  readonly usages: readonly StudioAssetRightsUsageLocation[];
}

export type StudioAssetRightsDiagnosticCategory =
  | "missing"
  | "expired"
  | "incompatible"
  | "unknown"
  | "duplicate"
  | "attestation";
export type StudioAssetRightsDiagnosticSeverity = "error" | "warning";

export type StudioAssetRightsDiagnosticCode =
  | "WORK_ID_MISSING"
  | "USAGE_LIMIT_EXCEEDED"
  | "ASSET_LIMIT_EXCEEDED"
  | "ASSET_ID_MISSING"
  | "ASSET_VERSION_MISSING"
  | "ASSET_VERSION_CONFLICT"
  | "SOURCE_MISSING"
  | "SOURCE_CONFLICT"
  | "LICENSE_MISSING"
  | "LICENSE_UNKNOWN"
  | "LICENSE_CONFLICT"
  | "LICENSE_DECLARATION_INCOMPATIBLE"
  | "ATTRIBUTION_MISSING"
  | "ATTRIBUTION_CONFLICT"
  | "COMMERCIAL_USE_UNKNOWN"
  | "COMMERCIAL_USE_PROHIBITED"
  | "AI_TRAINING_UNKNOWN"
  | "AI_TRAINING_PROHIBITED"
  | "REDISTRIBUTION_UNKNOWN"
  | "REDISTRIBUTION_PROHIBITED"
  | "EXPIRY_UNKNOWN"
  | "EXPIRY_INVALID"
  | "RIGHTS_EXPIRED"
  | "EXPIRY_CONFLICT"
  | "USAGE_LOCATION_INCOMPATIBLE"
  | "DUPLICATE_USAGE"
  | "ATTESTATION_REQUIRED"
  | "ATTESTATION_REJECTED"
  | "ATTESTATION_INVALID";

export interface StudioAssetRightsDiagnostic {
  readonly code: StudioAssetRightsDiagnosticCode;
  readonly category: StudioAssetRightsDiagnosticCategory;
  readonly severity: StudioAssetRightsDiagnosticSeverity;
  readonly message: string;
  readonly assetId: string | null;
  readonly pageId: string | null;
  readonly elementId: string | null;
}

export interface StudioAssetRightsAttestation {
  readonly status: StudioAssetRightsAttestationStatus;
  readonly reviewedAt: string | null;
  readonly reviewer: string | null;
}

export interface StudioAssetRightsManifestSummary {
  readonly inputUsageCount: number;
  readonly assetCount: number;
  readonly placementCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly readyForPublishPreflight: boolean;
}

export interface StudioAssetRightsManifest {
  readonly schema: typeof STUDIO_ASSET_RIGHTS_MANIFEST_SCHEMA;
  readonly version: typeof STUDIO_ASSET_RIGHTS_MANIFEST_VERSION;
  readonly workId: string | null;
  readonly assets: readonly StudioAssetRightsManifestAsset[];
  readonly diagnostics: readonly StudioAssetRightsDiagnostic[];
  readonly attestation: StudioAssetRightsAttestation;
  readonly summary: StudioAssetRightsManifestSummary;
  readonly localOnly: true;
  readonly disclaimer: typeof STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER;
}

export interface StudioAssetRightsPageProjection {
  readonly pageId: string;
  readonly assetCount: number;
  readonly elementCount: number;
  readonly assets: readonly {
    readonly assetId: string;
    readonly assetVersion: string | null;
    readonly elementIds: readonly string[];
  }[];
}

export interface StudioAssetRightsElementProjection {
  readonly pageId: string;
  readonly elementId: string;
  readonly assetId: string;
  readonly assetVersion: string | null;
}

/** Readonly bridge intended for publish preflight/package callers. It performs no I/O or upload. */
export interface StudioAssetRightsManifestResult {
  readonly manifest: StudioAssetRightsManifest;
  readonly assets: readonly StudioAssetRightsManifestAsset[];
  readonly diagnostics: readonly StudioAssetRightsDiagnostic[];
  readonly errors: readonly StudioAssetRightsDiagnostic[];
  readonly warnings: readonly StudioAssetRightsDiagnostic[];
  readonly pageProjection: readonly StudioAssetRightsPageProjection[];
  readonly elementProjection: readonly StudioAssetRightsElementProjection[];
  readonly readyForPublishPreflight: boolean;
  readonly disclaimer: typeof STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER;
}

interface NormalizedCandidate extends StudioAssetRightsManifestAsset {
  readonly fingerprint: string;
}

interface KnownLicensePolicy {
  readonly attribution: StudioAssetRightsAttributionRequirement;
  readonly commercialUse: StudioAssetRightsPermission;
  readonly aiTraining: StudioAssetRightsPermission;
  readonly redistribution: StudioAssetRightsPermission;
}

const SOURCE_KIND_SET = new Set<string>(STUDIO_ASSET_RIGHTS_SOURCE_KINDS);
const SCOPE_SET = new Set<string>(STUDIO_ASSET_RIGHTS_SCOPES);
const PERMISSION_SET = new Set<string>(STUDIO_ASSET_RIGHTS_PERMISSIONS);
const LICENSE_IDS = new Set<string>([
  "creator-owned",
  "custom",
  "unknown",
]);
const SENSITIVE_TEXT_PATTERN =
  /(?:\b(?:api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|password|authorization|order[-_\s]?id)\b|\bbearer\s+[A-Za-z0-9._~-]{8,}|\b(?:sk|pk)-[A-Za-z0-9_-]{8,})/iu;
const REVIEWER_PRIVATE_PATTERN =
  /(?:@|https?:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/iu;

const PermissionSchema = z.enum(STUDIO_ASSET_RIGHTS_PERMISSIONS);
const AttributionRequirementSchema = z.enum([
  "required",
  "not-required",
  "unknown",
]);
const SourceKindSchema = z.enum(STUDIO_ASSET_RIGHTS_SOURCE_KINDS);
const RightsScopeSchema = z.enum(STUDIO_ASSET_RIGHTS_SCOPES);
const LicenseIdSchema = z.enum([
  "toonspectrum-standard",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-nc-4.0",
  "creator-owned",
  "custom",
  "unknown",
]);
const DiagnosticCodeSchema = z.enum([
  "WORK_ID_MISSING",
  "USAGE_LIMIT_EXCEEDED",
  "ASSET_LIMIT_EXCEEDED",
  "ASSET_ID_MISSING",
  "ASSET_VERSION_MISSING",
  "ASSET_VERSION_CONFLICT",
  "SOURCE_MISSING",
  "SOURCE_CONFLICT",
  "LICENSE_MISSING",
  "LICENSE_UNKNOWN",
  "LICENSE_CONFLICT",
  "LICENSE_DECLARATION_INCOMPATIBLE",
  "ATTRIBUTION_MISSING",
  "ATTRIBUTION_CONFLICT",
  "COMMERCIAL_USE_UNKNOWN",
  "COMMERCIAL_USE_PROHIBITED",
  "AI_TRAINING_UNKNOWN",
  "AI_TRAINING_PROHIBITED",
  "REDISTRIBUTION_UNKNOWN",
  "REDISTRIBUTION_PROHIBITED",
  "EXPIRY_UNKNOWN",
  "EXPIRY_INVALID",
  "RIGHTS_EXPIRED",
  "EXPIRY_CONFLICT",
  "USAGE_LOCATION_INCOMPATIBLE",
  "DUPLICATE_USAGE",
  "ATTESTATION_REQUIRED",
  "ATTESTATION_REJECTED",
  "ATTESTATION_INVALID",
]);
const DiagnosticCategorySchema = z.enum([
  "missing",
  "expired",
  "incompatible",
  "unknown",
  "duplicate",
  "attestation",
]);

const IdentifierSchema = z.string().min(1).max(
  STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.identifierCodePoints
);
const NullableIdentifierSchema = IdentifierSchema.nullable();

const AssetSchema = z
  .object({
    assetId: IdentifierSchema,
    assetVersion: z.string().min(1).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.versionCodePoints
    ).nullable(),
    source: z.object({
      kind: SourceKindSchema,
      id: z.string().min(1).max(
        STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.sourceCodePoints
      ).nullable(),
    }).strict(),
    scope: z.array(RightsScopeSchema).min(1).max(STUDIO_ASSET_RIGHTS_SCOPES.length),
    license: z.object({
      id: LicenseIdSchema,
      declaredId: z.string().min(1).max(
        STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.labelCodePoints
      ).nullable(),
      label: z.string().max(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.labelCodePoints),
      url: z.url().startsWith("https://").nullable(),
    }).strict(),
    attribution: z.object({
      requirement: AttributionRequirementSchema,
      text: z.string().max(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.attributionCodePoints),
    }).strict(),
    commercialUse: PermissionSchema,
    aiTraining: PermissionSchema,
    redistribution: PermissionSchema,
    expiryState: z.enum(["known", "none", "unknown"]),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    usages: z.array(z.object({
      pageId: NullableIdentifierSchema,
      elementId: NullableIdentifierSchema,
    }).strict()).max(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages),
  })
  .strict()
  .superRefine((asset, context) => {
    if ((asset.expiryState === "known") !== (asset.expiresAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["expiryState"],
        message: "expiry state and timestamp must agree",
      });
    }
    for (let index = 0; index < asset.usages.length; index += 1) {
      const usage = asset.usages[index]!;
      if (usage.elementId !== null && usage.pageId === null) {
        context.addIssue({
          code: "custom",
          path: ["usages", index],
          message: "element usage requires a page",
        });
      }
    }
  });

const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  category: DiagnosticCategorySchema,
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1).max(500),
  assetId: NullableIdentifierSchema,
  pageId: NullableIdentifierSchema,
  elementId: NullableIdentifierSchema,
}).strict();

const AttestationSchema = z
  .object({
    status: z.enum(["unreviewed", "confirmed", "rejected"]),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    reviewer: z.string().min(1).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.reviewerCodePoints
    ).nullable(),
  })
  .strict()
  .superRefine((attestation, context) => {
    const reviewed = attestation.status !== "unreviewed";
    if (
      reviewed !== (attestation.reviewedAt !== null)
      || reviewed !== (attestation.reviewer !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "review metadata must match attestation state",
      });
    }
  });

export const StudioAssetRightsManifestSchema = z.object({
  schema: z.literal(STUDIO_ASSET_RIGHTS_MANIFEST_SCHEMA),
  version: z.literal(STUDIO_ASSET_RIGHTS_MANIFEST_VERSION),
  workId: NullableIdentifierSchema,
  assets: z.array(AssetSchema).max(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets),
  diagnostics: z.array(DiagnosticSchema).max(
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.diagnostics
  ),
  attestation: AttestationSchema,
  summary: z.object({
    inputUsageCount: z.number().int().min(0).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages
    ),
    assetCount: z.number().int().min(0).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets
    ),
    placementCount: z.number().int().min(0).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages
    ),
    errorCount: z.number().int().min(0).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.diagnostics
    ),
    warningCount: z.number().int().min(0).max(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.diagnostics
    ),
    readyForPublishPreflight: z.boolean(),
  }).strict(),
  localOnly: z.literal(true),
  disclaimer: z.literal(STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER),
}).strict();

const ExportEnvelopeSchema = z.object({
  schema: z.literal(STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA),
  version: z.literal(STUDIO_ASSET_RIGHTS_MANIFEST_VERSION),
  integrity: z.object({
    algorithm: z.literal("SHA-256"),
    canonicalHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  }).strict(),
  manifest: StudioAssetRightsManifestSchema,
}).strict();

function hasUnsafeControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
}

function safeText(
  value: unknown,
  maximumCodePoints: number,
  allowSensitive = false
): string | null {
  if (typeof value !== "string" || hasUnsafeControl(value)) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    !normalized
    || Array.from(normalized).length > maximumCodePoints
    || (!allowSensitive && SENSITIVE_TEXT_PATTERN.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareText(left, right);
}

function permission(value: unknown): StudioAssetRightsPermission {
  if (typeof value === "boolean") return value ? "allowed" : "prohibited";
  return typeof value === "string" && PERMISSION_SET.has(value)
    ? value as StudioAssetRightsPermission
    : "unknown";
}

function attributionRequirement(
  value: unknown
): StudioAssetRightsAttributionRequirement {
  if (typeof value === "boolean") return value ? "required" : "not-required";
  return value === "required" || value === "not-required" ? value : "unknown";
}

function knownLicensePolicy(
  licenseId: StudioAssetRightsLicenseId
): KnownLicensePolicy | null {
  if (isCreatorAssetLicenseId(licenseId)) {
    const license = creatorAssetLicenseOf(licenseId);
    return {
      attribution: license.attributionRequired ? "required" : "not-required",
      commercialUse: license.commercialUse ? "allowed" : "prohibited",
      aiTraining: "unknown",
      redistribution:
        license.id === "toonspectrum-standard" ? "prohibited" : "allowed",
    };
  }
  if (licenseId === "creator-owned") {
    return {
      attribution: "not-required",
      commercialUse: "allowed",
      aiTraining: "unknown",
      redistribution: "unknown",
    };
  }
  return null;
}

function normalizeLicenseId(value: unknown): {
  id: StudioAssetRightsLicenseId;
  declaredId: string | null;
} {
  if (isCreatorAssetLicenseId(value)) return { id: value, declaredId: value };
  if (typeof value === "string" && LICENSE_IDS.has(value)) {
    const id = value as StudioAssetRightsLicenseId;
    return { id, declaredId: id === "unknown" ? null : id };
  }
  const declaredId = safeText(
    value,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.labelCodePoints
  );
  return { id: "unknown", declaredId };
}

function licenseDetails(
  input: StudioAssetRightsUsageInput,
  diagnostics: StudioAssetRightsDiagnostic[],
  context: Pick<StudioAssetRightsDiagnostic, "assetId" | "pageId" | "elementId">
): {
  license: StudioAssetRightsLicense;
  policy: KnownLicensePolicy | null;
} {
  const normalized = normalizeLicenseId(input.licenseId);
  if (input.licenseId === undefined || input.licenseId === null || input.licenseId === "") {
    diagnostics.push(diagnostic(
      "LICENSE_MISSING",
      "missing",
      "error",
      "에셋 사용권이 기록되지 않았습니다.",
      context
    ));
  } else if (normalized.id === "unknown") {
    diagnostics.push(diagnostic(
      "LICENSE_UNKNOWN",
      "unknown",
      "error",
      "알 수 없는 에셋 사용권입니다. 원문 사용권을 직접 확인해 주세요.",
      context
    ));
  }
  const known = isCreatorAssetLicenseId(normalized.id)
    ? creatorAssetLicenseOf(normalized.id)
    : null;
  const customLabel = safeText(
    input.licenseLabel,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.labelCodePoints,
    true
  );
  const label = known?.shortLabel
    ?? (normalized.id === "creator-owned"
      ? "창작자 소유"
      : customLabel ?? (normalized.declaredId ?? ""));
  return {
    license: {
      id: normalized.id,
      declaredId: normalized.declaredId,
      label,
      url: known?.url ?? safeHttpsUrl(input.licenseUrl),
    },
    policy: knownLicensePolicy(normalized.id),
  };
}

function diagnostic(
  code: StudioAssetRightsDiagnosticCode,
  category: StudioAssetRightsDiagnosticCategory,
  severity: StudioAssetRightsDiagnosticSeverity,
  message: string,
  context: Partial<
    Pick<StudioAssetRightsDiagnostic, "assetId" | "pageId" | "elementId">
  > = {}
): StudioAssetRightsDiagnostic {
  return {
    code,
    category,
    severity,
    message,
    assetId: context.assetId ?? null,
    pageId: context.pageId ?? null,
    elementId: context.elementId ?? null,
  };
}

function normalizedScope(value: unknown): StudioAssetRightsScope[] {
  const values = Array.isArray(value) ? value : [value ?? "current-work"];
  const unique = new Set<StudioAssetRightsScope>(["current-work"]);
  for (const candidate of values) {
    if (typeof candidate === "string" && SCOPE_SET.has(candidate)) {
      unique.add(candidate as StudioAssetRightsScope);
    }
  }
  return [...unique].sort(compareText);
}

function normalizedSource(
  input: StudioAssetRightsUsageInput,
  diagnostics: StudioAssetRightsDiagnostic[],
  context: Pick<StudioAssetRightsDiagnostic, "assetId" | "pageId" | "elementId">
): StudioAssetRightsSource {
  const kind =
    typeof input.source?.kind === "string" && SOURCE_KIND_SET.has(input.source.kind)
      ? input.source.kind as StudioAssetRightsSourceKind
      : "unknown";
  const id = safeText(
    input.source?.id,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.sourceCodePoints
  );
  if (kind === "unknown" || !id) {
    diagnostics.push(diagnostic(
      "SOURCE_MISSING",
      "missing",
      "error",
      "에셋의 안정적인 출처와 출처 식별자가 필요합니다.",
      context
    ));
  }
  return { kind, id };
}

function normalizeExpiry(
  input: StudioAssetRightsUsageInput,
  now: number,
  diagnostics: StudioAssetRightsDiagnostic[],
  context: Pick<StudioAssetRightsDiagnostic, "assetId" | "pageId" | "elementId">
): Pick<StudioAssetRightsManifestAsset, "expiryState" | "expiresAt"> {
  if (input.expiresAt === null) return { expiryState: "none", expiresAt: null };
  if (input.expiresAt === undefined) {
    diagnostics.push(diagnostic(
      "EXPIRY_UNKNOWN",
      "unknown",
      "error",
      "사용권 만료 여부를 확인하지 않았습니다.",
      context
    ));
    return { expiryState: "unknown", expiresAt: null };
  }
  if (typeof input.expiresAt !== "string" || input.expiresAt.length > 80) {
    diagnostics.push(diagnostic(
      "EXPIRY_INVALID",
      "unknown",
      "error",
      "사용권 만료 시각 형식이 올바르지 않습니다.",
      context
    ));
    return { expiryState: "unknown", expiresAt: null };
  }
  const timestamp = Date.parse(input.expiresAt);
  if (!Number.isFinite(timestamp)) {
    diagnostics.push(diagnostic(
      "EXPIRY_INVALID",
      "unknown",
      "error",
      "사용권 만료 시각 형식이 올바르지 않습니다.",
      context
    ));
    return { expiryState: "unknown", expiresAt: null };
  }
  const expiresAt = new Date(timestamp).toISOString();
  if (timestamp <= now) {
    diagnostics.push(diagnostic(
      "RIGHTS_EXPIRED",
      "expired",
      "error",
      "에셋 사용권이 만료되었습니다.",
      context
    ));
  }
  return { expiryState: "known", expiresAt };
}

function applyKnownPolicy(
  field: "commercialUse" | "aiTraining" | "redistribution",
  declared: StudioAssetRightsPermission,
  policy: KnownLicensePolicy | null,
  diagnostics: StudioAssetRightsDiagnostic[],
  context: Pick<StudioAssetRightsDiagnostic, "assetId" | "pageId" | "elementId">
): StudioAssetRightsPermission {
  const expected = policy?.[field];
  if (expected && expected !== "unknown" && declared !== "unknown" && declared !== expected) {
    diagnostics.push(diagnostic(
      "LICENSE_DECLARATION_INCOMPATIBLE",
      "incompatible",
      "error",
      "입력한 권리 허용 범위가 선택한 사용권의 기본 조건과 충돌합니다.",
      context
    ));
  }
  return expected && expected !== "unknown" ? expected : declared;
}

function normalizeCandidate(
  input: StudioAssetRightsUsageInput,
  now: number,
  diagnostics: StudioAssetRightsDiagnostic[]
): NormalizedCandidate | null {
  const assetId = safeText(
    input.assetId,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.identifierCodePoints
  );
  const pageId = safeText(
    input.pageId,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.identifierCodePoints
  );
  const elementId = safeText(
    input.elementId,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.identifierCodePoints
  );
  const context = { assetId, pageId, elementId };
  if (!assetId) {
    diagnostics.push(diagnostic(
      "ASSET_ID_MISSING",
      "missing",
      "error",
      "에셋의 안정적인 식별자가 없습니다.",
      context
    ));
    return null;
  }
  const assetVersion = safeText(
    input.assetVersion,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.versionCodePoints
  );
  if (!assetVersion) {
    diagnostics.push(diagnostic(
      "ASSET_VERSION_MISSING",
      "missing",
      "error",
      "에셋 버전 또는 콘텐츠 해시가 없습니다.",
      context
    ));
  }
  if (elementId && !pageId) {
    diagnostics.push(diagnostic(
      "USAGE_LOCATION_INCOMPATIBLE",
      "incompatible",
      "error",
      "요소 단위 에셋 사용에는 페이지 식별자가 필요합니다.",
      context
    ));
  }

  const source = normalizedSource(input, diagnostics, context);
  const { license, policy } = licenseDetails(input, diagnostics, context);
  const declaredAttribution = attributionRequirement(input.attributionRequired);
  const expectedAttribution = policy?.attribution ?? declaredAttribution;
  if (
    policy
    && policy.attribution !== "unknown"
    && declaredAttribution !== "unknown"
    && declaredAttribution !== policy.attribution
  ) {
    diagnostics.push(diagnostic(
      "LICENSE_DECLARATION_INCOMPATIBLE",
      "incompatible",
      "error",
      "출처 표시 선언이 선택한 사용권 조건과 충돌합니다.",
      context
    ));
  }
  const attributionText = safeText(
    input.attributionText,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.attributionCodePoints,
    true
  ) ?? "";
  if (expectedAttribution === "required" && !attributionText) {
    diagnostics.push(diagnostic(
      "ATTRIBUTION_MISSING",
      "missing",
      "error",
      "출처 표시가 필요한 에셋이지만 표시 문구가 비어 있습니다.",
      context
    ));
  }
  const candidate: Omit<NormalizedCandidate, "fingerprint"> = {
    assetId,
    assetVersion,
    source,
    scope: normalizedScope(input.scope),
    license,
    attribution: {
      requirement: expectedAttribution,
      text: attributionText,
    },
    commercialUse: applyKnownPolicy(
      "commercialUse",
      permission(input.commercialUse),
      policy,
      diagnostics,
      context
    ),
    aiTraining: applyKnownPolicy(
      "aiTraining",
      permission(input.aiTraining),
      policy,
      diagnostics,
      context
    ),
    redistribution: applyKnownPolicy(
      "redistribution",
      permission(input.redistribution),
      policy,
      diagnostics,
      context
    ),
    ...normalizeExpiry(input, now, diagnostics, context),
    // Keep the ledger structurally valid after reporting an orphan element. A detached element ID
    // is not a trustworthy projection key, so it must not survive as a page-level placement.
    usages: [{ pageId, elementId: pageId ? elementId : null }],
  };
  return { ...candidate, fingerprint: canonicalJson(candidate) };
}

function restrictivePermission(
  values: readonly StudioAssetRightsPermission[]
): StudioAssetRightsPermission {
  if (values.includes("prohibited")) return "prohibited";
  if (values.includes("unknown")) return "unknown";
  return "allowed";
}

function restrictiveAttribution(
  values: readonly StudioAssetRightsAttributionRequirement[]
): StudioAssetRightsAttributionRequirement {
  if (values.includes("required")) return "required";
  if (values.includes("unknown")) return "unknown";
  return "not-required";
}

function uniqueFingerprints<T>(values: readonly T[], serialize = canonicalJson): T[] {
  const byFingerprint = new Map<string, T>();
  for (const value of values) byFingerprint.set(serialize(value), value);
  return [...byFingerprint.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, value]) => value);
}

function mergeCandidateGroup(
  candidates: readonly NormalizedCandidate[],
  diagnostics: StudioAssetRightsDiagnostic[]
): StudioAssetRightsManifestAsset {
  const ordered = [...candidates].sort((left, right) =>
    compareText(left.fingerprint, right.fingerprint)
  );
  const first = ordered[0]!;
  const context = {
    assetId: first.assetId,
    pageId: null,
    elementId: null,
  };
  const sources = uniqueFingerprints(ordered.map(({ source }) => source));
  const licenses = uniqueFingerprints(ordered.map(({ license }) => license));
  const attributions = uniqueFingerprints(ordered.map(({ attribution }) => attribution));
  const expiries = uniqueFingerprints(ordered.map(({ expiryState, expiresAt }) => ({
    expiryState,
    expiresAt,
  })));
  if (sources.length > 1) {
    diagnostics.push(diagnostic(
      "SOURCE_CONFLICT",
      "incompatible",
      "error",
      "같은 에셋 버전에 서로 다른 출처가 선언되었습니다.",
      context
    ));
  }
  if (licenses.length > 1) {
    diagnostics.push(diagnostic(
      "LICENSE_CONFLICT",
      "incompatible",
      "error",
      "같은 에셋 버전에 서로 다른 사용권이 선언되었습니다.",
      context
    ));
  }
  if (attributions.length > 1) {
    diagnostics.push(diagnostic(
      "ATTRIBUTION_CONFLICT",
      "incompatible",
      "error",
      "같은 에셋 버전의 출처 표시 선언이 서로 다릅니다.",
      context
    ));
  }
  if (expiries.length > 1) {
    diagnostics.push(diagnostic(
      "EXPIRY_CONFLICT",
      "incompatible",
      "error",
      "같은 에셋 버전에 서로 다른 만료 조건이 선언되었습니다.",
      context
    ));
  }

  const locationCounts = new Map<string, number>();
  for (const candidate of ordered) {
    const location = candidate.usages[0]!;
    const key = canonicalJson(location);
    locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
  }
  if ([...locationCounts.values()].some((count) => count > 1)) {
    diagnostics.push(diagnostic(
      "DUPLICATE_USAGE",
      "duplicate",
      "warning",
      "동일한 페이지·요소에 같은 에셋 사용이 중복 기록되었습니다.",
      context
    ));
  }
  const usages = uniqueFingerprints(ordered.flatMap(({ usages: value }) => value))
    .sort(compareUsageLocation);
  const scope = [...new Set(ordered.flatMap(({ scope: value }) => value))].sort(compareText);
  const source = sources.length === 1 ? sources[0]! : { kind: "unknown" as const, id: null };
  const license = licenses.length === 1
    ? licenses[0]!
    : { id: "unknown" as const, declaredId: null, label: "", url: null };
  const attribution = {
    requirement: restrictiveAttribution(
      ordered.map(({ attribution: value }) => value.requirement)
    ),
    text: attributions.length === 1 ? attributions[0]!.text : "",
  };
  const expiry = expiries.length === 1
    ? expiries[0]!
    : { expiryState: "unknown" as const, expiresAt: null };
  return {
    assetId: first.assetId,
    assetVersion: first.assetVersion,
    source,
    scope,
    license,
    attribution,
    commercialUse: restrictivePermission(
      ordered.map(({ commercialUse }) => commercialUse)
    ),
    aiTraining: restrictivePermission(ordered.map(({ aiTraining }) => aiTraining)),
    redistribution: restrictivePermission(
      ordered.map(({ redistribution }) => redistribution)
    ),
    ...expiry,
    usages,
  };
}

function compareUsageLocation(
  left: StudioAssetRightsUsageLocation,
  right: StudioAssetRightsUsageLocation
): number {
  return compareNullableText(left.pageId, right.pageId)
    || compareNullableText(left.elementId, right.elementId);
}

function compareAsset(
  left: StudioAssetRightsManifestAsset,
  right: StudioAssetRightsManifestAsset
): number {
  return compareText(left.assetId, right.assetId)
    || compareNullableText(left.assetVersion, right.assetVersion);
}

function compareDiagnostic(
  left: StudioAssetRightsDiagnostic,
  right: StudioAssetRightsDiagnostic
): number {
  return compareText(left.severity, right.severity)
    || compareText(left.category, right.category)
    || compareNullableText(left.assetId, right.assetId)
    || compareNullableText(left.pageId, right.pageId)
    || compareNullableText(left.elementId, right.elementId)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

function permissionDiagnostics(
  asset: StudioAssetRightsManifestAsset,
  diagnostics: StudioAssetRightsDiagnostic[]
): void {
  const context = { assetId: asset.assetId, pageId: null, elementId: null };
  const checks: readonly {
    scope: StudioAssetRightsScope;
    permission: StudioAssetRightsPermission;
    unknownCode: StudioAssetRightsDiagnosticCode;
    prohibitedCode: StudioAssetRightsDiagnosticCode;
    label: string;
  }[] = [
    {
      scope: "commercial-publication",
      permission: asset.commercialUse,
      unknownCode: "COMMERCIAL_USE_UNKNOWN",
      prohibitedCode: "COMMERCIAL_USE_PROHIBITED",
      label: "상업 게시",
    },
    {
      scope: "marketing",
      permission: asset.commercialUse,
      unknownCode: "COMMERCIAL_USE_UNKNOWN",
      prohibitedCode: "COMMERCIAL_USE_PROHIBITED",
      label: "마케팅 사용",
    },
    {
      scope: "ai-training",
      permission: asset.aiTraining,
      unknownCode: "AI_TRAINING_UNKNOWN",
      prohibitedCode: "AI_TRAINING_PROHIBITED",
      label: "AI 학습",
    },
    {
      scope: "redistribution",
      permission: asset.redistribution,
      unknownCode: "REDISTRIBUTION_UNKNOWN",
      prohibitedCode: "REDISTRIBUTION_PROHIBITED",
      label: "원본 재배포",
    },
  ];
  const emitted = new Set<string>();
  for (const check of checks) {
    if (!asset.scope.includes(check.scope)) continue;
    const code = check.permission === "unknown"
      ? check.unknownCode
      : check.permission === "prohibited"
        ? check.prohibitedCode
        : null;
    if (!code || emitted.has(code)) continue;
    emitted.add(code);
    diagnostics.push(diagnostic(
      code,
      check.permission === "unknown" ? "unknown" : "incompatible",
      "error",
      check.permission === "unknown"
        ? `${check.label} 허용 여부가 확인되지 않았습니다.`
        : `이 사용권은 ${check.label}을 허용하지 않습니다.`,
      context
    ));
  }
}

function normalizeAttestation(
  value: StudioAssetRightsAttestationInput | null | undefined,
  now: number,
  diagnostics: StudioAssetRightsDiagnostic[]
): StudioAssetRightsAttestation {
  const status = value?.status;
  if (status === undefined || status === null || status === "unreviewed") {
    diagnostics.push(diagnostic(
      "ATTESTATION_REQUIRED",
      "attestation",
      "error",
      "사람이 에셋 사용권 명세를 검토하고 확인해야 합니다."
    ));
    return { status: "unreviewed", reviewedAt: null, reviewer: null };
  }
  if (status !== "confirmed" && status !== "rejected") {
    diagnostics.push(diagnostic(
      "ATTESTATION_INVALID",
      "attestation",
      "error",
      "수동 검토 상태가 올바르지 않습니다."
    ));
    return { status: "unreviewed", reviewedAt: null, reviewer: null };
  }
  const reviewedValue = value as StudioAssetRightsAttestationInput;
  const reviewer = safeText(
    reviewedValue.reviewer,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.reviewerCodePoints,
    true
  );
  const reviewedTimestamp =
    typeof reviewedValue.reviewedAt === "string"
      && reviewedValue.reviewedAt.length <= 80
      ? Date.parse(reviewedValue.reviewedAt)
      : Number.NaN;
  if (
    !reviewer
    || REVIEWER_PRIVATE_PATTERN.test(reviewer)
    || !Number.isFinite(reviewedTimestamp)
    || reviewedTimestamp > now + 5 * 60 * 1_000
  ) {
    diagnostics.push(diagnostic(
      "ATTESTATION_INVALID",
      "attestation",
      "error",
      "검토 시각과 검토자 표시 이름을 확인해 주세요. 계정 ID·이메일은 저장하지 않습니다."
    ));
    return { status: "unreviewed", reviewedAt: null, reviewer: null };
  }
  if (status === "rejected") {
    diagnostics.push(diagnostic(
      "ATTESTATION_REJECTED",
      "attestation",
      "error",
      "수동 검토에서 에셋 권리 명세가 반려되었습니다."
    ));
  }
  return {
    status,
    reviewedAt: new Date(reviewedTimestamp).toISOString(),
    reviewer,
  };
}

function dedupeDiagnostics(
  diagnostics: readonly StudioAssetRightsDiagnostic[]
): StudioAssetRightsDiagnostic[] {
  return uniqueFingerprints(diagnostics)
    .sort(compareDiagnostic)
    .slice(0, STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.diagnostics);
}

function createPageProjection(
  assets: readonly StudioAssetRightsManifestAsset[]
): StudioAssetRightsPageProjection[] {
  const byPage = new Map<string, Map<string, {
    assetId: string;
    assetVersion: string | null;
    elementIds: Set<string>;
  }>>();
  for (const asset of assets) {
    for (const usage of asset.usages) {
      if (!usage.pageId) continue;
      const page = byPage.get(usage.pageId) ?? new Map();
      byPage.set(usage.pageId, page);
      const key = canonicalJson([asset.assetId, asset.assetVersion]);
      const projected = page.get(key) ?? {
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        elementIds: new Set<string>(),
      };
      if (usage.elementId) projected.elementIds.add(usage.elementId);
      page.set(key, projected);
    }
  }
  return [...byPage.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([pageId, assetMap]) => {
      const projectedAssets = [...assetMap.values()]
        .sort((left, right) =>
          compareText(left.assetId, right.assetId)
          || compareNullableText(left.assetVersion, right.assetVersion)
        )
        .map(({ elementIds, ...asset }) => ({
          ...asset,
          elementIds: [...elementIds].sort(compareText),
        }));
      return {
        pageId,
        assetCount: projectedAssets.length,
        elementCount: new Set(projectedAssets.flatMap(({ elementIds }) => elementIds)).size,
        assets: projectedAssets,
      };
    });
}

function createElementProjection(
  assets: readonly StudioAssetRightsManifestAsset[]
): StudioAssetRightsElementProjection[] {
  return assets.flatMap((asset) =>
    asset.usages.flatMap((usage) =>
      usage.pageId && usage.elementId
        ? [{
            pageId: usage.pageId,
            elementId: usage.elementId,
            assetId: asset.assetId,
            assetVersion: asset.assetVersion,
          }]
        : []
    )
  ).sort((left, right) =>
    compareText(left.pageId, right.pageId)
    || compareText(left.elementId, right.elementId)
    || compareText(left.assetId, right.assetId)
    || compareNullableText(left.assetVersion, right.assetVersion)
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

/**
 * Builds a deterministic local audit ledger. Unknown rights never become allowed by default and
 * conflicting duplicate declarations collapse to the most restrictive effective permission.
 */
export function buildStudioAssetRightsManifest(
  input: StudioAssetRightsManifestBuildInput
): StudioAssetRightsManifestResult {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError("에셋 권리 명세 기준 시각이 올바르지 않습니다.");
  }
  const diagnostics: StudioAssetRightsDiagnostic[] = [];
  const workId = safeText(
    input.workId,
    STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.identifierCodePoints
  );
  if (!workId) {
    diagnostics.push(diagnostic(
      "WORK_ID_MISSING",
      "missing",
      "error",
      "작품 식별자가 없어 권리 명세를 납품 기록에 연결할 수 없습니다."
    ));
  }
  if (!Array.isArray(input.usages)) {
    throw new TypeError("에셋 사용 목록은 배열이어야 합니다.");
  }
  if (input.usages.length > STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages) {
    diagnostics.push(diagnostic(
      "USAGE_LIMIT_EXCEEDED",
      "incompatible",
      "error",
      "에셋 사용 기록이 안전 처리 한도를 초과했습니다."
    ));
  }
  const candidates = input.usages
    .slice(0, STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages)
    .map((usage) => normalizeCandidate(usage, now, diagnostics))
    .filter((candidate): candidate is NormalizedCandidate => candidate !== null);
  const groups = new Map<string, NormalizedCandidate[]>();
  for (const candidate of candidates) {
    const key = canonicalJson([candidate.assetId, candidate.assetVersion]);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  let assets = [...groups.values()]
    .map((group) => mergeCandidateGroup(group, diagnostics))
    .sort(compareAsset);
  if (assets.length > STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets) {
    diagnostics.push(diagnostic(
      "ASSET_LIMIT_EXCEEDED",
      "incompatible",
      "error",
      "작품의 고유 에셋 수가 권리 감사 한도를 초과했습니다."
    ));
    assets = assets.slice(0, STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets);
  }

  const versionsByAsset = new Map<string, Set<string | null>>();
  for (const asset of assets) {
    const versions = versionsByAsset.get(asset.assetId) ?? new Set();
    versions.add(asset.assetVersion);
    versionsByAsset.set(asset.assetId, versions);
    permissionDiagnostics(asset, diagnostics);
  }
  for (const [assetId, versions] of versionsByAsset) {
    if (versions.size <= 1) continue;
    diagnostics.push(diagnostic(
      "ASSET_VERSION_CONFLICT",
      "incompatible",
      "error",
      "같은 에셋 식별자가 여러 버전으로 동시에 사용되었습니다.",
      { assetId }
    ));
  }

  const attestation = normalizeAttestation(input.attestation, now, diagnostics);
  const normalizedDiagnostics = dedupeDiagnostics(diagnostics);
  const errors = normalizedDiagnostics.filter(({ severity }) => severity === "error");
  const warnings = normalizedDiagnostics.filter(({ severity }) => severity === "warning");
  const placementCount = assets.reduce((total, asset) => total + asset.usages.length, 0);
  const readyForPublishPreflight =
    errors.length === 0 && attestation.status === "confirmed";
  const manifest: StudioAssetRightsManifest = {
    schema: STUDIO_ASSET_RIGHTS_MANIFEST_SCHEMA,
    version: STUDIO_ASSET_RIGHTS_MANIFEST_VERSION,
    workId,
    assets,
    diagnostics: normalizedDiagnostics,
    attestation,
    summary: {
      inputUsageCount: Math.min(
        input.usages.length,
        STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.usages
      ),
      assetCount: assets.length,
      placementCount,
      errorCount: errors.length,
      warningCount: warnings.length,
      readyForPublishPreflight,
    },
    localOnly: true,
    disclaimer: STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
  };
  const parsed = StudioAssetRightsManifestSchema.parse(manifest);
  const pageProjection = createPageProjection(parsed.assets);
  const elementProjection = createElementProjection(parsed.assets);
  return deepFreeze({
    manifest: parsed,
    assets: parsed.assets,
    diagnostics: parsed.diagnostics,
    errors: parsed.diagnostics.filter(({ severity }) => severity === "error"),
    warnings: parsed.diagnostics.filter(({ severity }) => severity === "warning"),
    pageProjection,
    elementProjection,
    readyForPublishPreflight: parsed.summary.readyForPublishPreflight,
    disclaimer: STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
  });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort(compareText)
      .map((key) => [key, canonicalValue(record[key])])
  );
}

/** RFC 8785-style key ordering for this integer/string/boolean/null-only bounded schema. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertJsonBudget(value: string): void {
  if (utf8Bytes(value) > STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.jsonBytes) {
    throw new Error("에셋 권리 명세 JSON이 안전한 내보내기 크기를 초과했습니다.");
  }
}

export async function hashStudioAssetRightsManifest(
  value: StudioAssetRightsManifest
): Promise<`sha256:${string}`> {
  const manifest = StudioAssetRightsManifestSchema.parse(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("이 브라우저에서는 에셋 권리 명세 해시를 계산할 수 없습니다.");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(manifest))
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${hex}`;
}

/** Deterministic, integrity-bearing JSON export. No account IDs, local paths or asset bytes enter it. */
export async function serializeStudioAssetRightsManifestJson(
  value: StudioAssetRightsManifest
): Promise<string> {
  const manifest = StudioAssetRightsManifestSchema.parse(value);
  const canonicalHash = await hashStudioAssetRightsManifest(manifest);
  const envelope = {
    schema: STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA,
    version: STUDIO_ASSET_RIGHTS_MANIFEST_VERSION,
    integrity: { algorithm: "SHA-256" as const, canonicalHash },
    manifest,
  };
  const serialized = `${JSON.stringify(canonicalValue(envelope), null, 2)}\n`;
  assertJsonBudget(serialized);
  return serialized;
}

function assertCanonicalManifestSemantics(
  manifest: StudioAssetRightsManifest,
  now: number
): void {
  if (
    canonicalJson(manifest.assets) !== canonicalJson([...manifest.assets].sort(compareAsset))
    || canonicalJson(manifest.diagnostics)
      !== canonicalJson([...manifest.diagnostics].sort(compareDiagnostic))
  ) {
    throw new Error("에셋 권리 명세의 정렬 순서가 표준 형식과 다릅니다.");
  }
  const assetKeys = new Set<string>();
  const usageKeys = new Set<string>();
  for (const asset of manifest.assets) {
    const assetKey = canonicalJson([asset.assetId, asset.assetVersion]);
    if (assetKeys.has(assetKey)) {
      throw new Error("에셋 권리 명세에 중복된 에셋 버전이 있습니다.");
    }
    assetKeys.add(assetKey);
    if (
      canonicalJson(asset.scope)
        !== canonicalJson([...asset.scope].sort(compareText))
      || canonicalJson(asset.usages)
        !== canonicalJson([...asset.usages].sort(compareUsageLocation))
    ) {
      throw new Error("에셋 권리 명세의 사용 범위 또는 위치 순서가 표준 형식과 다릅니다.");
    }
    for (const usage of asset.usages) {
      const usageKey = canonicalJson([assetKey, usage]);
      if (usageKeys.has(usageKey)) {
        throw new Error("에셋 권리 명세에 중복된 사용 위치가 있습니다.");
      }
      usageKeys.add(usageKey);
    }
  }
  const errorCount = manifest.diagnostics.filter(
    ({ severity }) => severity === "error"
  ).length;
  const warningCount = manifest.diagnostics.length - errorCount;
  const placementCount = manifest.assets.reduce(
    (total, asset) => total + asset.usages.length,
    0
  );
  if (
    manifest.summary.assetCount !== manifest.assets.length
    || manifest.summary.placementCount !== placementCount
    || manifest.summary.errorCount !== errorCount
    || manifest.summary.warningCount !== warningCount
    || manifest.summary.readyForPublishPreflight
      !== (errorCount === 0 && manifest.attestation.status === "confirmed")
  ) {
    throw new Error("에셋 권리 명세 요약이 상세 기록과 일치하지 않습니다.");
  }
  if (
    manifest.summary.readyForPublishPreflight
    && manifest.assets.some((asset) =>
      asset.source.kind === "unknown"
      || asset.source.id === null
      || asset.assetVersion === null
      || asset.license.id === "unknown"
      || asset.attribution.requirement === "unknown"
      || (asset.attribution.requirement === "required" && !asset.attribution.text)
      || asset.expiryState === "unknown"
      || (asset.expiresAt !== null && Date.parse(asset.expiresAt) <= now)
      || (asset.scope.includes("commercial-publication")
        && asset.commercialUse !== "allowed")
      || (asset.scope.includes("marketing") && asset.commercialUse !== "allowed")
      || (asset.scope.includes("ai-training") && asset.aiTraining !== "allowed")
      || (asset.scope.includes("redistribution")
        && asset.redistribution !== "allowed")
    )
  ) {
    throw new Error("에셋 권리 명세가 미확인 권리를 게시 가능 상태로 표시했습니다.");
  }
}

/** Strict import verifies size, exact schema, canonical ordering, semantic totals and SHA-256. */
export async function parseStudioAssetRightsManifestJson(
  serialized: string,
  now = Date.now()
): Promise<StudioAssetRightsManifest> {
  if (typeof serialized !== "string") {
    throw new TypeError("에셋 권리 명세 JSON은 문자열이어야 합니다.");
  }
  assertJsonBudget(serialized);
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("에셋 권리 명세 JSON을 해석할 수 없습니다.");
  }
  const parsed = ExportEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("에셋 권리 명세 JSON 형식이 올바르지 않습니다.");
  }
  assertCanonicalManifestSemantics(parsed.data.manifest, now);
  const actualHash = await hashStudioAssetRightsManifest(parsed.data.manifest);
  if (actualHash !== parsed.data.integrity.canonicalHash) {
    throw new Error("에셋 권리 명세 JSON의 무결성 해시가 일치하지 않습니다.");
  }
  return deepFreeze(parsed.data.manifest);
}

function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const CSV_COLUMNS = [
  "asset_id",
  "asset_version",
  "source_kind",
  "source_id",
  "scope",
  "license_id",
  "license_label",
  "attribution_requirement",
  "attribution_text",
  "commercial_use",
  "ai_training",
  "redistribution",
  "expiry_state",
  "expires_at",
  "page_id",
  "element_id",
  "diagnostic_codes",
  "attestation_status",
  "reviewed_at",
  "reviewer",
  "local_only",
  "disclaimer",
] as const;

/** Deterministic RFC 4180 CSV; every cell is quoted and spreadsheet formulas are neutralized. */
export function serializeStudioAssetRightsManifestCsv(
  value: StudioAssetRightsManifest
): string {
  const manifest = StudioAssetRightsManifestSchema.parse(value);
  assertCanonicalManifestSemantics(manifest, Number.NEGATIVE_INFINITY);
  const rows: Array<readonly (string | number | boolean | null)[]> = [CSV_COLUMNS];
  for (const asset of manifest.assets) {
    const diagnosticCodes = manifest.diagnostics
      .filter(({ assetId }) => assetId === asset.assetId)
      .map(({ code }) => code)
      .join("|");
    const usages = asset.usages.length > 0
      ? asset.usages
      : [{ pageId: null, elementId: null }];
    for (const usage of usages) {
      rows.push([
        asset.assetId,
        asset.assetVersion,
        asset.source.kind,
        asset.source.id,
        asset.scope.join("|"),
        asset.license.id,
        asset.license.label,
        asset.attribution.requirement,
        asset.attribution.text,
        asset.commercialUse,
        asset.aiTraining,
        asset.redistribution,
        asset.expiryState,
        asset.expiresAt,
        usage.pageId,
        usage.elementId,
        diagnosticCodes,
        manifest.attestation.status,
        manifest.attestation.reviewedAt,
        manifest.attestation.reviewer,
        manifest.localOnly,
        manifest.disclaimer,
      ]);
    }
  }
  const serialized = `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  if (utf8Bytes(serialized) > STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.csvBytes) {
    throw new Error("에셋 권리 명세 CSV가 안전한 내보내기 크기를 초과했습니다.");
  }
  return serialized;
}
