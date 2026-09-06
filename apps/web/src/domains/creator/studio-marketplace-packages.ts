import {
  compareCreatorMarketplaceSemver,
  isCreatorMarketplaceSemver,
} from "@/shared/lib/creator-marketplace-semver";

/**
 * Local-first package contract shared by Studio assets, brushes, filters, palettes,
 * templates and 3D presets.
 *
 * This module deliberately contains no payment or server persistence implementation.
 * A package must declare those boundaries explicitly so the UI cannot imply that an
 * unavailable checkout, cloud sync or creator payout completed successfully.
 */

export const STUDIO_MARKETPLACE_PACKAGE_SCHEMA =
  "toonspectrum.studio-marketplace-package" as const;
export const STUDIO_MARKETPLACE_SHARE_MANIFEST_SCHEMA =
  "toonspectrum.studio-marketplace-share-manifest" as const;
export const STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY =
  "toonspectrum.studio-marketplace-library.v1" as const;
export const STUDIO_MARKETPLACE_LIBRARY_VERSION = 1 as const;
export const STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES = 200;

export const STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE =
  "다른 마켓에서 받은 소재와 구매 파일은 무료 여부와 관계없이 재배포할 수 없습니다. 직접 만든 원본, CC0, 재배포가 허용된 퍼미시브 라이선스, 또는 권리자의 명시적 허가가 있는 자료만 공유할 수 있습니다." as const;

export type StudioMarketplacePackageKind =
  | "raster-asset"
  | "vector-asset"
  | "brush"
  | "filter"
  | "palette"
  | "template"
  | "3d-preset"
  | "3d-asset";

export type StudioMarketplaceAccessModel = "free" | "paid" | "subscription";
export type StudioMarketplaceOrigin =
  | "original-procedural"
  | "original-handmade"
  | "cc0"
  | "permissive"
  | "explicit-permission";
export type StudioMarketplaceRuntimeBoundary =
  | "bundled"
  | "local-only"
  | "server-required"
  | "unavailable";
export type StudioMarketplacePlacementPreset =
  | "current-view"
  | "pointer"
  | "panel-fit"
  | "background-cover";

export interface StudioMarketplaceCreator {
  readonly id: string;
  readonly name: string;
  readonly verified: boolean;
}

export interface StudioMarketplaceLicense {
  readonly id: string;
  readonly label: string;
  readonly url: string | null;
  readonly commercialUse: boolean;
  readonly attributionRequired: boolean;
  readonly derivativesAllowed: boolean;
  readonly redistributionAllowed: boolean;
  readonly sourceVerifiedAt: string;
  readonly summary: string;
}

export interface StudioMarketplaceCompatibility {
  readonly studioVersion: string;
  readonly renderer: readonly ("canvas2d" | "svg" | "webgl" | "webgpu")[];
  readonly devices: readonly ("desktop" | "tablet" | "mobile")[];
  readonly formats: readonly string[];
}

export interface StudioMarketplaceIncludedItem {
  readonly id: string;
  readonly name: string;
  readonly kind: StudioMarketplacePackageKind;
  readonly format: string;
  readonly contentFingerprint: string;
  readonly tags: readonly string[];
}

export interface StudioMarketplaceChangelogEntry {
  readonly version: string;
  readonly releasedAt: string;
  readonly changes: readonly string[];
}

export interface StudioMarketplaceAvailability {
  readonly catalog: StudioMarketplaceRuntimeBoundary;
  readonly library: StudioMarketplaceRuntimeBoundary;
  readonly payment: StudioMarketplaceRuntimeBoundary;
  readonly cloudSync: StudioMarketplaceRuntimeBoundary;
  readonly exportManifest: StudioMarketplaceRuntimeBoundary;
}

export interface StudioMarketplacePackage {
  readonly schema: typeof STUDIO_MARKETPLACE_PACKAGE_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly kind: StudioMarketplacePackageKind;
  readonly access: StudioMarketplaceAccessModel;
  readonly accessLabel: string;
  readonly origin: StudioMarketplaceOrigin;
  readonly creator: StudioMarketplaceCreator;
  readonly version: string;
  readonly packageFingerprint: string;
  readonly compatibility: StudioMarketplaceCompatibility;
  readonly license: StudioMarketplaceLicense;
  readonly includedItems: readonly StudioMarketplaceIncludedItem[];
  readonly changelog: readonly StudioMarketplaceChangelogEntry[];
  readonly placementPresets: readonly StudioMarketplacePlacementPreset[];
  readonly availability: StudioMarketplaceAvailability;
  readonly updatedAt: string;
}

export interface StudioMarketplaceLibraryEntry {
  readonly packageId: string;
  readonly version: string;
  readonly packageFingerprint: string;
  readonly addedAt: string;
}

export interface StudioMarketplaceLibraryState {
  readonly version: typeof STUDIO_MARKETPLACE_LIBRARY_VERSION;
  readonly packages: readonly StudioMarketplaceLibraryEntry[];
}

export interface StudioMarketplaceLibrarySaveOptions {
  /**
   * IDs intentionally removed by the current mutation. They must not be restored from a newer
   * localStorage snapshot while merging concurrent tab writes.
   */
  readonly removedPackageIds?: readonly string[];
}

export interface StudioMarketplaceFilter {
  readonly query?: string;
  readonly categories?: readonly string[];
  readonly kinds?: readonly StudioMarketplacePackageKind[];
  readonly access?: readonly StudioMarketplaceAccessModel[];
  readonly origins?: readonly StudioMarketplaceOrigin[];
  readonly libraryPackageIds?: readonly string[];
  readonly libraryOnly?: boolean;
  readonly updateOnly?: boolean;
  readonly installed?: readonly StudioMarketplaceLibraryEntry[];
}

export type StudioMarketplaceImportStatus =
  | "new"
  | "duplicate"
  | "update"
  | "content-conflict"
  | "downgrade-blocked";

export interface StudioMarketplaceImportResolution {
  readonly status: StudioMarketplaceImportStatus;
  readonly recommendedAction: "add" | "skip" | "update" | "clone" | "block";
  readonly installedVersion: string | null;
  readonly message: string;
}

export interface StudioMarketplaceCompatibilityEvaluationInput {
  readonly minimumStudioVersion: string;
  /**
   * The authoritative Studio compatibility version supplied by the product runtime. Omit it when
   * the build has no trustworthy compatibility-version source; an arbitrary app/package version
   * must never be substituted because that could reject every otherwise valid marketplace item.
   */
  readonly currentStudioVersion?: string | null;
  readonly declaredEngines: readonly string[];
  /** Omitted means "not measured"; an empty array is a measured device with no supported engine. */
  readonly supportedEngines?: readonly string[] | null;
  /** Inconclusive per-engine probes; a resource requiring one remains unverified, not unsupported. */
  readonly unverifiedEngines?: readonly string[] | null;
}

export type StudioMarketplaceCompatibilityEvaluation =
  | Readonly<{
      status: "compatible";
      verified: true;
      code: "compatible";
      reason: null;
    }>
  | Readonly<{
      status: "unverified";
      verified: false;
      code:
        | "compatibility-sources-unavailable"
        | "studio-version-unavailable"
        | "engine-capabilities-unavailable";
      reason: string;
    }>
  | Readonly<{
      status: "unsupported";
      verified: true;
      code:
        | "minimum-version-invalid"
        | "current-version-invalid"
        | "studio-version-too-old"
        | "declared-engines-invalid"
        | "engine-unavailable";
      reason: string;
    }>;

export interface StudioMarketplaceShareManifest {
  readonly schema: typeof STUDIO_MARKETPLACE_SHARE_MANIFEST_SCHEMA;
  readonly version: 1;
  readonly package: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly packageFingerprint: string;
    readonly kind: StudioMarketplacePackageKind;
    readonly origin: StudioMarketplaceOrigin;
    readonly creator: StudioMarketplaceCreator;
    readonly license: StudioMarketplaceLicense;
    readonly compatibility: StudioMarketplaceCompatibility;
    readonly includedItems: readonly StudioMarketplaceIncludedItem[];
  };
  readonly createdAt: string;
  readonly localOnly: true;
  readonly contentIncluded: false;
  readonly notice: typeof STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE;
}

export interface StudioMarketplacePublishRightsInput {
  readonly origin: unknown;
  readonly creatorOwnsRights: boolean;
  readonly containsThirdPartyContent: boolean;
  readonly recognizableMarketplaceDerivative: boolean;
  readonly redistributionPermission: boolean;
  readonly sourceReference?: string;
  readonly permissionEvidence?: string;
}

export interface StudioMarketplacePublishRightsCheck {
  readonly id:
    | "origin"
    | "ownership"
    | "third-party"
    | "marketplace-derivative"
    | "source"
    | "redistribution";
  readonly passed: boolean;
  readonly label: string;
  readonly message: string;
}

export interface StudioMarketplacePublishRightsDecision {
  readonly allowed: boolean;
  readonly normalizedOrigin: StudioMarketplaceOrigin | null;
  readonly checks: readonly StudioMarketplacePublishRightsCheck[];
  readonly notice: typeof STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE;
  readonly localPreflightOnly: true;
}

const ORIGIN_SET = new Set<StudioMarketplaceOrigin>([
  "original-procedural",
  "original-handmade",
  "cc0",
  "permissive",
  "explicit-permission",
]);

const EMPTY_LIBRARY_STATE: StudioMarketplaceLibraryState = Object.freeze({
  version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
  packages: Object.freeze([]),
});

function normalizedSearch(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ko-KR") : "";
}

function normalizedStringSet(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((values ?? []).map(normalizedSearch).filter(Boolean));
}

function packageSearchText(pkg: StudioMarketplacePackage): string {
  return [
    pkg.name,
    pkg.summary,
    pkg.category,
    pkg.creator.name,
    pkg.version,
    pkg.license.label,
    ...pkg.tags,
    ...pkg.compatibility.formats,
    ...pkg.compatibility.renderer,
    ...pkg.compatibility.devices,
    ...pkg.includedItems.flatMap((item) => [item.name, item.format, ...item.tags]),
  ].join("\n").toLocaleLowerCase("ko-KR");
}

interface StudioMarketplaceSemver {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

// Marketplace records use exact x.y.z versions. The comparator also accepts historical x / x.y
// local receipts so an old install remains deterministically older/newer instead of becoming an
// accidental same-version conflict. Build metadata is parsed but deliberately excluded from the
// precedence representation, as required by SemVer 2.0.
const STUDIO_MARKETPLACE_COMPARABLE_SEMVER =
  /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
function parseStudioMarketplaceSemver(version: string): StudioMarketplaceSemver | null {
  const match = STUDIO_MARKETPLACE_COMPARABLE_SEMVER.exec(version.trim());
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  // SemVer forbids leading zeroes only for numeric prerelease identifiers. Build identifiers may
  // contain them and are intentionally discarded from the precedence representation.
  if (
    prerelease.some(
      (identifier) => /^\d+$/u.test(identifier) && !/^(?:0|[1-9]\d*)$/u.test(identifier),
    )
  ) {
    return null;
  }
  try {
    return {
      core: [
        BigInt(match[1] ?? "0"),
        BigInt(match[2] ?? "0"),
        BigInt(match[3] ?? "0"),
      ],
      prerelease,
    };
  } catch {
    return null;
  }
}

function isExactStudioMarketplaceSemver(version: string): boolean {
  return isCreatorMarketplaceSemver(version);
}

function compareBigInts(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function numericPrereleaseIdentifier(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  if (left === right) return 0;
  const leftNumeric = numericPrereleaseIdentifier(left);
  const rightNumeric = numericPrereleaseIdentifier(right);
  if (leftNumeric !== null && rightNumeric !== null) {
    return compareBigInts(leftNumeric, rightNumeric);
  }
  if (leftNumeric !== null) return -1;
  if (rightNumeric !== null) return 1;
  return left > right ? 1 : -1;
}

function compareParsedStudioMarketplaceSemver(
  left: StudioMarketplaceSemver,
  right: StudioMarketplaceSemver,
): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = compareBigInts(left.core[index]!, right.core[index]!);
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const sharedLength = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = comparePrereleaseIdentifiers(
      left.prerelease[index]!,
      right.prerelease[index]!,
    );
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === right.prerelease.length) return 0;
  return left.prerelease.length > right.prerelease.length ? 1 : -1;
}

export function compareStudioMarketplaceVersions(left: string, right: string): number {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (
    isCreatorMarketplaceSemver(normalizedLeft)
    && isCreatorMarketplaceSemver(normalizedRight)
  ) {
    return compareCreatorMarketplaceSemver(normalizedLeft, normalizedRight);
  }
  const leftVersion = parseStudioMarketplaceSemver(normalizedLeft);
  const rightVersion = parseStudioMarketplaceSemver(normalizedRight);
  if (leftVersion && rightVersion) {
    return compareParsedStudioMarketplaceSemver(leftVersion, rightVersion);
  }
  if (normalizedLeft === normalizedRight) return 0;
  // Invalid values can exist only in legacy local receipts, not in the marketplace contract.
  // Keep them deterministically below a valid release so a valid package can repair the receipt.
  if (leftVersion) return 1;
  if (rightVersion) return -1;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

function engineNames(engines: readonly string[]): string {
  const labels: Readonly<Record<string, string>> = {
    canvas2d: "Canvas 2D",
    webgl2: "WebGL 2",
    webgpu: "WebGPU",
    three: "Three.js",
  };
  return engines.map((engine) => labels[engine] ?? engine).join(", ");
}

/**
 * Evaluates only capabilities backed by authoritative caller input. Missing runtime sources return
 * an explicit `unverified` result rather than being called compatible; supplied invalid or
 * incompatible values fail closed with recovery copy suitable for the Studio card and one-shot
 * deep-link status. The projection integration decides whether an unverified result is actionable
 * only after the product provides the corresponding authoritative runtime source.
 */
export function evaluateStudioMarketplaceCompatibility(
  input: StudioMarketplaceCompatibilityEvaluationInput,
): StudioMarketplaceCompatibilityEvaluation {
  const minimumStudioVersion = input.minimumStudioVersion.trim();
  if (!isExactStudioMarketplaceSemver(minimumStudioVersion)) {
    return {
      status: "unsupported",
      verified: true,
      code: "minimum-version-invalid",
      reason:
        "리소스가 선언한 최소 Studio 버전이 올바르지 않아 안전하게 설치할 수 없습니다. 게시자에게 호환성 정보를 수정한 새 버전을 요청해 주세요.",
    };
  }

  const suppliedCurrentStudioVersion = input.currentStudioVersion;
  const hasCurrentVersionSource = suppliedCurrentStudioVersion !== undefined
    && suppliedCurrentStudioVersion !== null;
  const currentStudioVersion = typeof suppliedCurrentStudioVersion === "string"
    ? suppliedCurrentStudioVersion.trim()
    : null;
  if (
    hasCurrentVersionSource
    && (!currentStudioVersion || !isExactStudioMarketplaceSemver(currentStudioVersion))
  ) {
    return {
      status: "unsupported",
      verified: true,
      code: "current-version-invalid",
      reason:
        "현재 Studio 버전을 확인할 수 없어 안전하게 설치할 수 없습니다. Studio를 새로고침하거나 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.",
    };
  }
  if (
    currentStudioVersion
    && compareStudioMarketplaceVersions(currentStudioVersion, minimumStudioVersion) < 0
  ) {
    return {
      status: "unsupported",
      verified: true,
      code: "studio-version-too-old",
      reason:
        `이 리소스는 Studio ${minimumStudioVersion} 이상이 필요합니다. 현재 버전은 ${currentStudioVersion}입니다. Studio를 업데이트한 뒤 다시 시도해 주세요.`,
    };
  }

  const declaredEngines = [...new Set(
    input.declaredEngines.map((engine) => engine.trim()).filter(Boolean),
  )];
  if (declaredEngines.length === 0) {
    return {
      status: "unsupported",
      verified: true,
      code: "declared-engines-invalid",
      reason:
        "리소스가 지원 엔진을 선언하지 않아 안전하게 설치할 수 없습니다. 게시자에게 호환성 정보를 수정한 새 버전을 요청해 주세요.",
    };
  }

  const measuredEngines = input.supportedEngines;
  const hasMeasuredEngines = measuredEngines !== undefined && measuredEngines !== null;
  const supportedEngines = new Set(
    (measuredEngines ?? []).map((engine) => engine.trim()).filter(Boolean),
  );
  const unverifiedEngines = new Set(
    (input.unverifiedEngines ?? []).map((engine) => engine.trim()).filter(Boolean),
  );
  const hasSupportedDeclaredEngine = declaredEngines.some(
    (engine) => supportedEngines.has(engine),
  );
  // Marketplace engine declarations are alternatives. A positive proof therefore wins even when
  // another optional engine is inconclusive; uncertainty matters only if no declared alternative
  // was proven on this device.
  const hasUnverifiedDeclaredEngine = !hasSupportedDeclaredEngine
    && declaredEngines.some((engine) => unverifiedEngines.has(engine));
  if (
    hasMeasuredEngines
    && !hasSupportedDeclaredEngine
    && !hasUnverifiedDeclaredEngine
  ) {
    return {
      status: "unsupported",
      verified: true,
      code: "engine-unavailable",
      reason:
        `이 리소스에 필요한 렌더링 엔진(${engineNames(declaredEngines)})을 현재 기기에서 사용할 수 없습니다. 브라우저와 그래픽 드라이버를 업데이트하거나 지원되는 기기에서 다시 시도해 주세요.`,
    };
  }

  const hasCurrentVersion = currentStudioVersion !== null;
  const hasVerifiedEngine = hasMeasuredEngines && hasSupportedDeclaredEngine;
  if (hasCurrentVersion && hasVerifiedEngine) {
    return {
      status: "compatible",
      verified: true,
      code: "compatible",
      reason: null,
    };
  }
  const code = hasCurrentVersion
    ? "engine-capabilities-unavailable" as const
    : hasVerifiedEngine
      ? "studio-version-unavailable" as const
      : "compatibility-sources-unavailable" as const;
  const reason = code === "engine-capabilities-unavailable"
    ? hasUnverifiedDeclaredEngine
      ? `이 리소스에 필요한 렌더링 엔진(${engineNames(declaredEngines)}) 측정을 완료하지 못해 호환성을 검증하지 못했습니다. 잠시 후 다시 확인해 주세요.`
      : "현재 기기의 렌더링 엔진 지원 상태를 확인할 권위 있는 측정값이 없어 호환성을 검증하지 못했습니다."
    : code === "studio-version-unavailable"
      ? "현재 Studio 호환성 버전을 확인할 권위 있는 값이 없어 호환성을 검증하지 못했습니다."
      : "현재 Studio 호환성 버전과 기기 렌더링 엔진의 권위 있는 값이 없어 호환성을 검증하지 못했습니다.";
  return {
    status: "unverified",
    verified: false,
    code,
    reason,
  };
}

export function filterStudioMarketplacePackages(
  packages: readonly StudioMarketplacePackage[],
  filter: StudioMarketplaceFilter = {}
): StudioMarketplacePackage[] {
  const query = normalizedSearch(filter.query);
  const categories = normalizedStringSet(filter.categories);
  const kinds = new Set(filter.kinds ?? []);
  const access = new Set(filter.access ?? []);
  const origins = new Set(filter.origins ?? []);
  const libraryIds = new Set(filter.libraryPackageIds ?? []);
  const installedById = new Map(
    (filter.installed ?? []).map((entry) => [entry.packageId, entry] as const)
  );

  return packages.filter((pkg) => {
    if (query && !packageSearchText(pkg).includes(query)) return false;
    if (categories.size > 0 && !categories.has(normalizedSearch(pkg.category))) return false;
    if (kinds.size > 0 && !kinds.has(pkg.kind)) return false;
    if (access.size > 0 && !access.has(pkg.access)) return false;
    if (origins.size > 0 && !origins.has(pkg.origin)) return false;
    if (filter.libraryOnly && !libraryIds.has(pkg.id)) return false;
    if (filter.updateOnly) {
      const installed = installedById.get(pkg.id);
      if (!installed || compareStudioMarketplaceVersions(pkg.version, installed.version) <= 0) {
        return false;
      }
    }
    return true;
  });
}

function isLibraryEntry(value: unknown): value is StudioMarketplaceLibraryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StudioMarketplaceLibraryEntry>;
  return (
    typeof entry.packageId === "string"
    && entry.packageId.length > 0
    && entry.packageId.length <= 160
    && typeof entry.version === "string"
    && entry.version.length > 0
    && entry.version.length <= 80
    && typeof entry.packageFingerprint === "string"
    && entry.packageFingerprint.length > 0
    && entry.packageFingerprint.length <= 160
    && typeof entry.addedAt === "string"
    && Number.isFinite(Date.parse(entry.addedAt))
  );
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalMarketplaceLibraryState(value: unknown): StudioMarketplaceLibraryState {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !hasExactKeys(value, ["version", "packages"])
  ) {
    throw new Error("마켓 라이브러리 envelope가 올바르지 않습니다.");
  }
  const envelope = value as { readonly version?: unknown; readonly packages?: unknown };
  if (
    envelope.version !== STUDIO_MARKETPLACE_LIBRARY_VERSION
    || !Array.isArray(envelope.packages)
  ) {
    throw new Error("마켓 라이브러리 버전 또는 packages가 올바르지 않습니다.");
  }
  if (envelope.packages.length > STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES) {
    throw new Error(
      `마켓 라이브러리는 ${STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES}개를 초과할 수 없습니다.`,
    );
  }

  const seen = new Set<string>();
  const packages = envelope.packages.map((entry) => {
    if (
      !isLibraryEntry(entry)
      || !hasExactKeys(entry, [
        "packageId",
        "version",
        "packageFingerprint",
        "addedAt",
      ])
    ) {
      throw new Error("마켓 라이브러리 항목이 올바르지 않습니다.");
    }
    if (seen.has(entry.packageId)) {
      throw new Error(`마켓 라이브러리에 중복 packageId가 있습니다: ${entry.packageId}`);
    }
    seen.add(entry.packageId);
    return {
      packageId: entry.packageId,
      version: entry.version,
      packageFingerprint: entry.packageFingerprint,
      addedAt: entry.addedAt,
    } satisfies StudioMarketplaceLibraryEntry;
  });
  return {
    version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
    packages,
  };
}

/** Strict, byte-canonical parser used by the V12 SQLite product authority. */
export function parseCanonicalStudioMarketplaceLibrary(
  raw: string,
): StudioMarketplaceLibraryState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("마켓 라이브러리 JSON이 손상되었습니다.", { cause: error });
  }
  const state = canonicalMarketplaceLibraryState(parsed);
  if (JSON.stringify(state) !== raw) {
    throw new Error("마켓 라이브러리가 canonical JSON 형식이 아닙니다.");
  }
  return state;
}

/** Serializes only fully validated state; invalid input is never truncated or normalized. */
export function serializeCanonicalStudioMarketplaceLibrary(
  state: StudioMarketplaceLibraryState,
): string {
  return JSON.stringify(canonicalMarketplaceLibraryState(state));
}

export function loadStudioMarketplaceLibrary(
  storage: Pick<Storage, "getItem"> | null | undefined
): StudioMarketplaceLibraryState {
  if (!storage) return EMPTY_LIBRARY_STATE;
  try {
    const raw = storage.getItem(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY);
    if (!raw) return EMPTY_LIBRARY_STATE;
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      packages?: unknown;
    };
    if (
      parsed.version !== STUDIO_MARKETPLACE_LIBRARY_VERSION
      || !Array.isArray(parsed.packages)
    ) {
      return EMPTY_LIBRARY_STATE;
    }
    const seen = new Set<string>();
    const packages = parsed.packages
      .filter(isLibraryEntry)
      .filter((entry) => {
        if (seen.has(entry.packageId)) return false;
        seen.add(entry.packageId);
        return true;
      })
      .slice(0, STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES);
    return {
      version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
      packages,
    };
  } catch {
    return EMPTY_LIBRARY_STATE;
  }
}

export function saveStudioMarketplaceLibrary(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  state: StudioMarketplaceLibraryState,
  options: StudioMarketplaceLibrarySaveOptions = {},
): boolean {
  if (!storage) return false;
  try {
    const removedIds = new Set(options.removedPackageIds ?? []);
    const requestedIds = new Set(state.packages.map((entry) => entry.packageId));
    const latest = loadStudioMarketplaceLibrary(storage);
    const packages = [
      ...state.packages.filter((entry) => !removedIds.has(entry.packageId)),
      ...latest.packages.filter(
        (entry) => !removedIds.has(entry.packageId) && !requestedIds.has(entry.packageId),
      ),
    ].slice(0, STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES);
    storage.setItem(
      STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
        packages,
      })
    );
    const verified = loadStudioMarketplaceLibrary(storage);
    const verifiedById = new Map(
      verified.packages.map((entry) => [entry.packageId, entry] as const),
    );
    return packages.every((entry) => {
      const persisted = verifiedById.get(entry.packageId);
      return persisted?.version === entry.version
        && persisted.packageFingerprint === entry.packageFingerprint;
    }) && [...removedIds].every((packageId) => !verifiedById.has(packageId));
  } catch {
    return false;
  }
}

function stableMarketplaceFingerprintHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createStudioMarketplaceConflictCloneId(
  pkg: Pick<StudioMarketplacePackage, "id" | "version" | "packageFingerprint">,
): string {
  const suffix = `~conflict-${stableMarketplaceFingerprintHash(
    `${pkg.version}\u0000${pkg.packageFingerprint}`,
  )}`;
  return `${pkg.id.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

export function resolveStudioMarketplaceImport(
  pkg: StudioMarketplacePackage,
  installed: StudioMarketplaceLibraryEntry | null | undefined
): StudioMarketplaceImportResolution {
  if (!installed) {
    return {
      status: "new",
      recommendedAction: "add",
      installedVersion: null,
      message: "이 기기의 라이브러리에 새 패키지로 추가할 수 있습니다.",
    };
  }
  const versionComparison = compareStudioMarketplaceVersions(pkg.version, installed.version);
  if (
    versionComparison === 0
    && pkg.packageFingerprint === installed.packageFingerprint
  ) {
    return {
      status: "duplicate",
      recommendedAction: "skip",
      installedVersion: installed.version,
      message: "동일한 버전과 내용이 이미 로컬 라이브러리에 있습니다.",
    };
  }
  if (versionComparison > 0) {
    return {
      status: "update",
      recommendedAction: "update",
      installedVersion: installed.version,
      message: `${installed.version}에서 ${pkg.version}(으)로 로컬 패키지를 업데이트할 수 있습니다.`,
    };
  }
  if (versionComparison < 0) {
    return {
      status: "downgrade-blocked",
      recommendedAction: "block",
      installedVersion: installed.version,
      message: `설치된 ${installed.version}보다 오래된 ${pkg.version} 패키지는 덮어쓰지 않습니다.`,
    };
  }
  return {
    status: "content-conflict",
    recommendedAction: "clone",
    installedVersion: installed.version,
    message: "같은 버전 번호에 다른 내용이 감지되어 별도 복제본으로만 가져올 수 있습니다.",
  };
}

export function cloneStudioMarketplacePackageToLibrary(
  state: StudioMarketplaceLibraryState,
  pkg: StudioMarketplacePackage,
  now = new Date().toISOString()
): StudioMarketplaceLibraryState {
  const installed = state.packages.find((candidate) => candidate.packageId === pkg.id);
  const resolution = resolveStudioMarketplaceImport(pkg, installed);
  if (resolution.status === "duplicate" || resolution.status === "downgrade-blocked") {
    return state;
  }
  const packageId = resolution.status === "content-conflict"
    ? createStudioMarketplaceConflictCloneId(pkg)
    : pkg.id;
  const entry: StudioMarketplaceLibraryEntry = {
    packageId,
    version: pkg.version,
    packageFingerprint: pkg.packageFingerprint,
    addedAt: now,
  };
  const packages = [
    entry,
    ...state.packages.filter((candidate) => candidate.packageId !== packageId),
  ].slice(0, STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES);
  return {
    version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
    packages,
  };
}

export function removeStudioMarketplacePackageFromLibrary(
  state: StudioMarketplaceLibraryState,
  packageId: string
): StudioMarketplaceLibraryState {
  return {
    version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
    packages: state.packages.filter((entry) => entry.packageId !== packageId),
  };
}

export function createStudioMarketplaceShareManifest(
  pkg: StudioMarketplacePackage,
  now = new Date().toISOString()
): StudioMarketplaceShareManifest {
  return {
    schema: STUDIO_MARKETPLACE_SHARE_MANIFEST_SCHEMA,
    version: 1,
    package: {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      packageFingerprint: pkg.packageFingerprint,
      kind: pkg.kind,
      origin: pkg.origin,
      creator: pkg.creator,
      license: pkg.license,
      compatibility: pkg.compatibility,
      includedItems: pkg.includedItems,
    },
    createdAt: now,
    localOnly: true,
    contentIncluded: false,
    notice: STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE,
  };
}

export function evaluateStudioMarketplacePublishRights(
  input: StudioMarketplacePublishRightsInput
): StudioMarketplacePublishRightsDecision {
  const normalizedOrigin = typeof input.origin === "string" && ORIGIN_SET.has(
    input.origin as StudioMarketplaceOrigin
  )
    ? input.origin as StudioMarketplaceOrigin
    : null;
  const externalOrigin = normalizedOrigin === "cc0"
    || normalizedOrigin === "permissive"
    || normalizedOrigin === "explicit-permission";
  const sourceReference = input.sourceReference?.trim() ?? "";
  const permissionEvidence = input.permissionEvidence?.trim() ?? "";
  const sourcePassed = !externalOrigin || sourceReference.length > 0;
  const redistributionPassed = normalizedOrigin === "original-procedural"
    || normalizedOrigin === "original-handmade"
    || (
      input.redistributionPermission
      && (
        normalizedOrigin === "cc0"
        || (
          (normalizedOrigin === "permissive" || normalizedOrigin === "explicit-permission")
          && permissionEvidence.length > 0
        )
      )
    );

  const checks: StudioMarketplacePublishRightsCheck[] = [
    {
      id: "origin",
      passed: normalizedOrigin !== null,
      label: "허용 출처",
      message: normalizedOrigin
        ? "공유 가능한 출처 유형을 선택했습니다."
        : "원본·CC0·퍼미시브·명시적 허가 중 하나여야 합니다.",
    },
    {
      id: "ownership",
      passed: input.creatorOwnsRights,
      label: "권리 보유",
      message: input.creatorOwnsRights
        ? "게시자가 공유 권한을 확인했습니다."
        : "게시자가 직접 만든 원본이거나 공유 권한을 보유해야 합니다.",
    },
    {
      id: "third-party",
      passed: !input.containsThirdPartyContent || externalOrigin,
      label: "제3자 자료",
      message: !input.containsThirdPartyContent || externalOrigin
        ? "제3자 자료가 없거나 허용 출처로 구분했습니다."
        : "제3자 자료는 출처와 재배포 허가를 확인해야 합니다.",
    },
    {
      id: "marketplace-derivative",
      passed: !input.recognizableMarketplaceDerivative,
      label: "상용 마켓 복제 금지",
      message: input.recognizableMarketplaceDerivative
        ? "구매·구독 소재를 알아볼 수 있게 복제하거나 변형한 자료는 공유할 수 없습니다."
        : "상용 마켓 소재의 복제·식별 가능한 변형이 아님을 확인했습니다.",
    },
    {
      id: "source",
      passed: sourcePassed,
      label: "출처 원문",
      message: sourcePassed
        ? "필요한 출처 원문이 확인되었습니다."
        : "외부 라이선스 자료는 원문 URL 또는 식별 가능한 출처가 필요합니다.",
    },
    {
      id: "redistribution",
      passed: redistributionPassed,
      label: "재배포 허가",
      message: redistributionPassed
        ? "재배포 가능한 권리 근거를 확인했습니다."
        : "무료 사용과 재배포 허가는 다릅니다. 재배포 근거를 첨부하세요.",
    },
  ];

  return {
    allowed: checks.every((check) => check.passed),
    normalizedOrigin,
    checks,
    notice: STUDIO_MARKETPLACE_REDISTRIBUTION_NOTICE,
    localPreflightOnly: true,
  };
}
