/**
 * Vendor-neutral hybrid engine contract.
 *
 * Providers may keep DOM nodes, GPUDevice/WebGL contexts, CanvasKit/Pixi/Three
 * instances or WASM pointers in their private runtime. Canonical document state
 * crosses provider boundaries only through the structured-clone format IDs
 * declared below. Opaque runtime handles are explicitly forbidden from canonical
 * data and therefore never become history, persistence or export authority.
 *
 * This file describes candidates; it does not import, install or claim runtime
 * availability for any external library.
 */

export const STUDIO_HYBRID_ENGINE_CONTRACT_REVISION = 1 as const;

export const STUDIO_HYBRID_AUTHORITY_ROLES = [
  "raster-document",
  "vector-document",
  "text-layout",
  "3d-scene",
  "history/persistence",
] as const;

export type StudioHybridAuthorityRole =
  (typeof STUDIO_HYBRID_AUTHORITY_ROLES)[number];

export const STUDIO_HYBRID_SPECIALIST_ROLES = [
  "raster-render",
  "raster-fx",
  "vector-quality",
  "vector-geometry",
  "text-shaping",
  "text-raster",
  "3d-render",
  "codecs",
  "image-analysis",
  "physics",
  "animation",
] as const;

export type StudioHybridSpecialistRole =
  (typeof STUDIO_HYBRID_SPECIALIST_ROLES)[number];

export type StudioHybridExecutionLocality =
  | "main"
  | "engine-worker"
  | "wasm-worker"
  | "storage-worker";

export type StudioHybridCanonicalFormat =
  | "raster-tiles-v1"
  | "vector-scene-v1"
  | "text-runs-v1"
  | "scene3d-v1"
  | "history-log-v1"
  | "asset-reference-v1"
  | "animation-timeline-v1"
  | "physics-state-v1"
  | "encoded-image-v1"
  | "analysis-mask-v1";

export type StudioHybridGpuApi =
  | "webgpu"
  | "webgl2"
  | "canvas2d"
  | "cpu"
  | "storage";

export type StudioHybridColorPrecision =
  | "rgba8-unorm"
  | "rgba16-float"
  | "rgba32-float"
  | "vector-exact"
  | "not-applicable";

export interface StudioHybridProviderAvailability {
  readonly installation:
    | "built-in"
    | "installed"
    | "not-installed"
    | "unknown";
  readonly probe:
    | "verified-supported"
    | "verified-unsupported"
    | "not-run"
    | "failed";
  readonly checkedAtEpochMilliseconds: number | null;
  readonly detail: string | null;
}

export interface StudioHybridCanonicalBoundary {
  readonly vendorNeutral: true;
  readonly structuredCloneOnly: true;
  readonly opaqueRuntimeHandles: "forbidden";
  readonly accepts: readonly StudioHybridCanonicalFormat[];
  readonly emits: readonly StudioHybridCanonicalFormat[];
}

export interface StudioHybridSurfaceContract {
  readonly surfaceId: string;
  /** Exactly one selected provider may own a given surface. */
  readonly ownsSurface: boolean;
  readonly gpuContext: {
    readonly contextId: string;
    readonly api: StudioHybridGpuApi;
    readonly sharing: "exclusive" | "shared";
    /**
     * Providers sharing one context must report the same non-empty key after a
     * real integration probe. Matching an API name alone is not sufficient.
     */
    readonly compatibilityKey: string;
  } | null;
}

export interface StudioHybridDeterminismContract {
  readonly mode:
    | "deterministic"
    | "seeded-deterministic"
    | "best-effort"
    | "non-deterministic";
  readonly replay: "exact" | "bounded" | "unsupported";
  readonly export: "lossless" | "bounded" | "unsupported";
}

export interface StudioHybridDeviceRecoveryContract {
  readonly deviceDependent: boolean;
  readonly lossDetection:
    | "not-applicable"
    | "context-event"
    | "device-lost-promise"
    | "poll";
  readonly recovery:
    | "not-applicable"
    | "recreate-from-canonical"
    | "provider-specific"
    | "unsupported";
  readonly canonicalReplayRequired: boolean;
}

export interface StudioHybridProviderQuality {
  /** All quality dimensions are 0..100 and measured by product benchmarks. */
  readonly fidelity: number;
  readonly interactiveLatency: number;
  readonly exportFidelity: number;
  readonly replayReliability: number;
  readonly recoveryResilience: number;
}

export interface StudioHybridEngineProvider {
  readonly id: string;
  readonly label: string;
  readonly implementation:
    | "application-core"
    | "native-browser"
    | "js-library"
    | "wasm-library"
    | "storage-adapter";
  /** Diagnostic only. It never contributes to acceptance or quality score. */
  readonly bundleBytes: number | null;
  readonly availability: StudioHybridProviderAvailability;
  readonly authorityRoles: readonly StudioHybridAuthorityRole[];
  readonly specialistRoles: readonly StudioHybridSpecialistRole[];
  readonly locality: StudioHybridExecutionLocality;
  readonly dependencies: readonly string[];
  readonly canonicalBoundary: StudioHybridCanonicalBoundary;
  readonly surface: StudioHybridSurfaceContract | null;
  readonly determinism: StudioHybridDeterminismContract;
  readonly colorPrecision: StudioHybridColorPrecision;
  readonly linearColorWorkflow: boolean;
  readonly deviceRecovery: StudioHybridDeviceRecoveryContract;
  readonly quality: StudioHybridProviderQuality;
}

export interface StudioHybridEngineRequirements {
  readonly deterministicReplay: boolean;
  readonly exportRequired: boolean;
  readonly recoverFromDeviceLoss: boolean;
  readonly minimumColorPrecision:
    | "rgba8-unorm"
    | "rgba16-float"
    | "rgba32-float";
}

export interface StudioHybridEnginePlan {
  readonly contractRevision:
    typeof STUDIO_HYBRID_ENGINE_CONTRACT_REVISION;
  readonly planId: string;
  readonly providers: readonly StudioHybridEngineProvider[];
  readonly requirements: StudioHybridEngineRequirements;
}

export type StudioHybridPlanFailureReason =
  | "malformed-plan"
  | "future-contract-revision"
  | "unsupported-contract-revision"
  | "duplicate-provider-id"
  | "invalid-provider"
  | "provider-unavailable"
  | "missing-authority"
  | "duplicate-authority"
  | "missing-dependency"
  | "dependency-cycle"
  | "duplicate-surface-owner"
  | "incompatible-shared-context"
  | "determinism-requirement-unsatisfied"
  | "export-requirement-unsatisfied"
  | "device-recovery-requirement-unsatisfied"
  | "color-precision-requirement-unsatisfied";

export type StudioHybridPlanValidationResult =
  | {
      readonly ok: true;
      readonly plan: StudioHybridEnginePlan;
      readonly dependencyOrder: readonly string[];
      readonly authorityProviderIds:
        Readonly<Record<StudioHybridAuthorityRole, string>>;
    }
  | {
      readonly ok: false;
      readonly reason: StudioHybridPlanFailureReason;
      readonly path: string;
      readonly detail?: string;
    };

export interface StudioHybridPlanScore {
  readonly total: number;
  readonly fidelity: number;
  readonly interactiveLatency: number;
  readonly exportFidelity: number;
  readonly replayReliability: number;
  readonly recoveryResilience: number;
  readonly diagnostics: {
    /**
     * Sum of known provider estimates. Unknown means at least one selected
     * provider has no estimate. Neither value changes `total`.
     */
    readonly knownBundleBytes: number;
    readonly hasUnknownBundleBytes: boolean;
    readonly providerCount: number;
    readonly localities: Readonly<
      Record<StudioHybridExecutionLocality, number>
    >;
  };
}

type UnknownRecord = Record<string, unknown>;

const AUTHORITY_ROLE_SET = new Set<string>(
  STUDIO_HYBRID_AUTHORITY_ROLES,
);
const SPECIALIST_ROLE_SET = new Set<string>(
  STUDIO_HYBRID_SPECIALIST_ROLES,
);
const CANONICAL_FORMAT_SET = new Set<StudioHybridCanonicalFormat>([
  "raster-tiles-v1",
  "vector-scene-v1",
  "text-runs-v1",
  "scene3d-v1",
  "history-log-v1",
  "asset-reference-v1",
  "animation-timeline-v1",
  "physics-state-v1",
  "encoded-image-v1",
  "analysis-mask-v1",
]);
const LOCALITY_SET = new Set<StudioHybridExecutionLocality>([
  "main",
  "engine-worker",
  "wasm-worker",
  "storage-worker",
]);
const COLOR_PRECISION_SET = new Set<StudioHybridColorPrecision>([
  "rgba8-unorm",
  "rgba16-float",
  "rgba32-float",
  "vector-exact",
  "not-applicable",
]);
const GPU_API_SET = new Set<StudioHybridGpuApi>([
  "webgpu",
  "webgl2",
  "canvas2d",
  "cpu",
  "storage",
]);

function failure(
  reason: StudioHybridPlanFailureReason,
  path: string,
  detail?: string,
): StudioHybridPlanValidationResult {
  return detail === undefined
    ? { ok: false, reason, path }
    : { ok: false, reason, path, detail };
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: UnknownRecord,
  allowed: readonly string[],
): boolean {
  const keySet = new Set(allowed);
  return Object.keys(value).every((key) => keySet.has(key));
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[a-z0-9][a-z0-9._:/+-]*$/.test(value)
  );
}

function isLabel(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && value.length <= 160
  );
}

function isQualityMetric(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 100
  );
}

function isUniqueStringArray(
  value: unknown,
  predicate: (entry: string) => boolean,
  maximumLength: number,
): value is readonly string[] {
  return (
    Array.isArray(value)
    && value.length <= maximumLength
    && value.every(
      (entry): entry is string =>
        typeof entry === "string" && predicate(entry),
    )
    && new Set(value).size === value.length
  );
}

function validateAvailability(
  value: unknown,
): value is StudioHybridProviderAvailability {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "installation",
      "probe",
      "checkedAtEpochMilliseconds",
      "detail",
    ])
  ) {
    return false;
  }
  const structurallyValid = (
    (
      value.installation === "built-in"
      || value.installation === "installed"
      || value.installation === "not-installed"
      || value.installation === "unknown"
    )
    && (
      value.probe === "verified-supported"
      || value.probe === "verified-unsupported"
      || value.probe === "not-run"
      || value.probe === "failed"
    )
    && (
      value.checkedAtEpochMilliseconds === null
      || (
        Number.isSafeInteger(value.checkedAtEpochMilliseconds)
        && (value.checkedAtEpochMilliseconds as number) >= 0
      )
    )
    && (
      value.detail === null
      || (
        typeof value.detail === "string"
        && value.detail.length > 0
        && value.detail.length <= 512
      )
    )
  );
  if (!structurallyValid) return false;
  if (value.probe === "not-run") {
    return value.checkedAtEpochMilliseconds === null;
  }
  if (value.checkedAtEpochMilliseconds === null) return false;
  return !(
    value.probe === "verified-supported"
    && (
      value.installation === "not-installed"
      || value.installation === "unknown"
    )
  );
}

function isProviderSelectable(
  availability: StudioHybridProviderAvailability,
): boolean {
  return (
    (
      availability.installation === "built-in"
      || availability.installation === "installed"
    )
    && availability.probe === "verified-supported"
  );
}

function validateCanonicalBoundary(
  value: unknown,
): value is StudioHybridCanonicalBoundary {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "vendorNeutral",
      "structuredCloneOnly",
      "opaqueRuntimeHandles",
      "accepts",
      "emits",
    ])
  ) {
    return false;
  }
  return (
    value.vendorNeutral === true
    && value.structuredCloneOnly === true
    && value.opaqueRuntimeHandles === "forbidden"
    && isUniqueStringArray(
      value.accepts,
      (entry) =>
        CANONICAL_FORMAT_SET.has(entry as StudioHybridCanonicalFormat),
      CANONICAL_FORMAT_SET.size,
    )
    && isUniqueStringArray(
      value.emits,
      (entry) =>
        CANONICAL_FORMAT_SET.has(entry as StudioHybridCanonicalFormat),
      CANONICAL_FORMAT_SET.size,
    )
  );
}

function validateSurface(
  value: unknown,
): value is StudioHybridSurfaceContract | null {
  if (value === null) return true;
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "surfaceId",
      "ownsSurface",
      "gpuContext",
    ])
    || !isIdentifier(value.surfaceId)
    || typeof value.ownsSurface !== "boolean"
  ) {
    return false;
  }
  if (value.gpuContext === null) return !value.ownsSurface;
  if (
    !isRecord(value.gpuContext)
    || !hasOnlyKeys(value.gpuContext, [
      "contextId",
      "api",
      "sharing",
      "compatibilityKey",
    ])
  ) {
    return false;
  }
  const structurallyValid = (
    isIdentifier(value.gpuContext.contextId)
    && GPU_API_SET.has(value.gpuContext.api as StudioHybridGpuApi)
    && (
      value.gpuContext.sharing === "exclusive"
      || value.gpuContext.sharing === "shared"
    )
    && isIdentifier(value.gpuContext.compatibilityKey)
  );
  return (
    structurallyValid
    && (
      value.gpuContext.sharing !== "exclusive"
      || value.ownsSurface
    )
  );
}

function validateDeterminism(
  value: unknown,
): value is StudioHybridDeterminismContract {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["mode", "replay", "export"])
  ) {
    return false;
  }
  return (
    (
      value.mode === "deterministic"
      || value.mode === "seeded-deterministic"
      || value.mode === "best-effort"
      || value.mode === "non-deterministic"
    )
    && (
      value.replay === "exact"
      || value.replay === "bounded"
      || value.replay === "unsupported"
    )
    && (
      value.export === "lossless"
      || value.export === "bounded"
      || value.export === "unsupported"
    )
  );
}

function validateRecovery(
  value: unknown,
): value is StudioHybridDeviceRecoveryContract {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "deviceDependent",
      "lossDetection",
      "recovery",
      "canonicalReplayRequired",
    ])
  ) {
    return false;
  }
  const structurallyValid = (
    typeof value.deviceDependent === "boolean"
    && (
      value.lossDetection === "not-applicable"
      || value.lossDetection === "context-event"
      || value.lossDetection === "device-lost-promise"
      || value.lossDetection === "poll"
    )
    && (
      value.recovery === "not-applicable"
      || value.recovery === "recreate-from-canonical"
      || value.recovery === "provider-specific"
      || value.recovery === "unsupported"
    )
    && typeof value.canonicalReplayRequired === "boolean"
    && (
      value.deviceDependent
      || (
        value.lossDetection === "not-applicable"
        && value.recovery === "not-applicable"
        && !value.canonicalReplayRequired
      )
    )
  );
  if (!structurallyValid) return false;
  if (!value.deviceDependent) return true;
  return (
    value.lossDetection !== "not-applicable"
    && value.recovery !== "not-applicable"
  );
}

function validateQuality(
  value: unknown,
): value is StudioHybridProviderQuality {
  return (
    isRecord(value)
    && hasOnlyKeys(value, [
      "fidelity",
      "interactiveLatency",
      "exportFidelity",
      "replayReliability",
      "recoveryResilience",
    ])
    && isQualityMetric(value.fidelity)
    && isQualityMetric(value.interactiveLatency)
    && isQualityMetric(value.exportFidelity)
    && isQualityMetric(value.replayReliability)
    && isQualityMetric(value.recoveryResilience)
  );
}

function validateProvider(
  value: unknown,
): value is StudioHybridEngineProvider {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "id",
      "label",
      "implementation",
      "bundleBytes",
      "availability",
      "authorityRoles",
      "specialistRoles",
      "locality",
      "dependencies",
      "canonicalBoundary",
      "surface",
      "determinism",
      "colorPrecision",
      "linearColorWorkflow",
      "deviceRecovery",
      "quality",
    ])
    || !isIdentifier(value.id)
    || !isLabel(value.label)
    || (
      value.implementation !== "application-core"
      && value.implementation !== "native-browser"
      && value.implementation !== "js-library"
      && value.implementation !== "wasm-library"
      && value.implementation !== "storage-adapter"
    )
    || (
      value.bundleBytes !== null
      && (
        !Number.isSafeInteger(value.bundleBytes)
        || (value.bundleBytes as number) < 0
      )
    )
    || !validateAvailability(value.availability)
    || !isUniqueStringArray(
      value.authorityRoles,
      (entry) => AUTHORITY_ROLE_SET.has(entry),
      STUDIO_HYBRID_AUTHORITY_ROLES.length,
    )
    || !isUniqueStringArray(
      value.specialistRoles,
      (entry) => SPECIALIST_ROLE_SET.has(entry),
      STUDIO_HYBRID_SPECIALIST_ROLES.length,
    )
    || (
      value.authorityRoles.length === 0
      && value.specialistRoles.length === 0
    )
    || !LOCALITY_SET.has(value.locality as StudioHybridExecutionLocality)
    || !isUniqueStringArray(value.dependencies, isIdentifier, 64)
    || value.dependencies.includes(value.id as string)
    || !validateCanonicalBoundary(value.canonicalBoundary)
    || !validateSurface(value.surface)
    || !validateDeterminism(value.determinism)
    || !COLOR_PRECISION_SET.has(
      value.colorPrecision as StudioHybridColorPrecision,
    )
    || typeof value.linearColorWorkflow !== "boolean"
    || !validateRecovery(value.deviceRecovery)
    || !validateQuality(value.quality)
  ) {
    return false;
  }
  return true;
}

function validateRequirements(
  value: unknown,
): value is StudioHybridEngineRequirements {
  return (
    isRecord(value)
    && hasOnlyKeys(value, [
      "deterministicReplay",
      "exportRequired",
      "recoverFromDeviceLoss",
      "minimumColorPrecision",
    ])
    && typeof value.deterministicReplay === "boolean"
    && typeof value.exportRequired === "boolean"
    && typeof value.recoverFromDeviceLoss === "boolean"
    && (
      value.minimumColorPrecision === "rgba8-unorm"
      || value.minimumColorPrecision === "rgba16-float"
      || value.minimumColorPrecision === "rgba32-float"
    )
  );
}

function dependencyOrder(
  providers: readonly StudioHybridEngineProvider[],
  providerById: ReadonlyMap<string, StudioHybridEngineProvider>,
): StudioHybridPlanValidationResult | string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const provider of providers) {
    indegree.set(provider.id, provider.dependencies.length);
    for (const dependencyId of provider.dependencies) {
      if (!providerById.has(dependencyId)) {
        return failure(
          "missing-dependency",
          `providers.${provider.id}.dependencies`,
          dependencyId,
        );
      }
      const entries = dependents.get(dependencyId) ?? [];
      entries.push(provider.id);
      dependents.set(dependencyId, entries);
    }
  }

  const ready = providers
    .filter((provider) => provider.dependencies.length === 0)
    .map((provider) => provider.id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const providerId = ready.shift();
    if (!providerId) break;
    order.push(providerId);
    for (const dependentId of dependents.get(providerId) ?? []) {
      const next = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }
  if (order.length !== providers.length) {
    return failure("dependency-cycle", "providers.dependencies");
  }
  return order;
}

function validateSurfaceAndContexts(
  providers: readonly StudioHybridEngineProvider[],
): StudioHybridPlanValidationResult | null {
  const ownerBySurface = new Map<string, string>();
  const contextBySurface = new Map<string, string>();
  const providersByContext = new Map<
    string,
    StudioHybridEngineProvider[]
  >();
  for (const provider of providers) {
    const surface = provider.surface;
    if (!surface) continue;
    if (surface.ownsSurface) {
      const previousOwner = ownerBySurface.get(surface.surfaceId);
      if (previousOwner) {
        return failure(
          "duplicate-surface-owner",
          `providers.${provider.id}.surface`,
          `${surface.surfaceId}:${previousOwner}`,
        );
      }
      ownerBySurface.set(surface.surfaceId, provider.id);
    }
    if (surface.gpuContext) {
      const previousContext = contextBySurface.get(surface.surfaceId);
      if (
        previousContext
        && previousContext !== surface.gpuContext.contextId
      ) {
        return failure(
          "incompatible-shared-context",
          `providers.${provider.id}.surface.gpuContext`,
          `${surface.surfaceId}:${previousContext}/${surface.gpuContext.contextId}`,
        );
      }
      contextBySurface.set(
        surface.surfaceId,
        surface.gpuContext.contextId,
      );
      const entries =
        providersByContext.get(surface.gpuContext.contextId) ?? [];
      entries.push(provider);
      providersByContext.set(surface.gpuContext.contextId, entries);
    }
  }

  for (const [contextId, contextProviders] of providersByContext) {
    if (contextProviders.length < 2) continue;
    const first = contextProviders[0]?.surface?.gpuContext;
    if (!first) continue;
    const compatible = contextProviders.every((provider) => {
      const context = provider.surface?.gpuContext;
      return (
        context?.sharing === "shared"
        && context.api === first.api
        && context.compatibilityKey === first.compatibilityKey
        && provider.surface?.surfaceId
          === contextProviders[0]?.surface?.surfaceId
      );
    });
    if (!compatible) {
      return failure(
        "incompatible-shared-context",
        "providers.surface.gpuContext",
        contextId,
      );
    }
  }
  return null;
}

const COLOR_PRECISION_RANK: Readonly<
  Record<Exclude<StudioHybridColorPrecision, "not-applicable">, number>
> = {
  "rgba8-unorm": 0,
  "rgba16-float": 1,
  "rgba32-float": 2,
  "vector-exact": 3,
};

const AUTHORITY_CANONICAL_FORMAT: Readonly<
  Record<StudioHybridAuthorityRole, StudioHybridCanonicalFormat>
> = {
  "raster-document": "raster-tiles-v1",
  "vector-document": "vector-scene-v1",
  "text-layout": "text-runs-v1",
  "3d-scene": "scene3d-v1",
  "history/persistence": "history-log-v1",
};

export function validateStudioHybridEnginePlan(
  input: unknown,
): StudioHybridPlanValidationResult {
  if (
    !isRecord(input)
    || !hasOnlyKeys(input, [
      "contractRevision",
      "planId",
      "providers",
      "requirements",
    ])
    || !Number.isSafeInteger(input.contractRevision)
    || !isIdentifier(input.planId)
    || !Array.isArray(input.providers)
    || input.providers.length === 0
    || input.providers.length > 128
    || !validateRequirements(input.requirements)
  ) {
    return failure("malformed-plan", "$");
  }
  const contractRevision = input.contractRevision as number;
  if (
    contractRevision > STUDIO_HYBRID_ENGINE_CONTRACT_REVISION
  ) {
    return failure(
      "future-contract-revision",
      "contractRevision",
    );
  }
  if (
    contractRevision !== STUDIO_HYBRID_ENGINE_CONTRACT_REVISION
  ) {
    return failure(
      "unsupported-contract-revision",
      "contractRevision",
    );
  }

  const providers: StudioHybridEngineProvider[] = [];
  const providerById = new Map<string, StudioHybridEngineProvider>();
  for (const [index, candidate] of input.providers.entries()) {
    if (!validateProvider(candidate)) {
      return failure("invalid-provider", `providers[${index}]`);
    }
    if (providerById.has(candidate.id)) {
      return failure(
        "duplicate-provider-id",
        `providers[${index}].id`,
        candidate.id,
      );
    }
    if (!isProviderSelectable(candidate.availability)) {
      return failure(
        "provider-unavailable",
        `providers[${index}].availability`,
        candidate.id,
      );
    }
    if (
      candidate.authorityRoles.length > 0
      && (
        (
          candidate.implementation !== "application-core"
          && candidate.implementation !== "storage-adapter"
        )
        || !candidate.id.startsWith("toonspectrum-")
      )
    ) {
      return failure(
        "invalid-provider",
        `providers[${index}].authorityRoles`,
        "canonical authority must be a ToonSpectrum application-core or storage-adapter provider",
      );
    }
    for (const authorityRole of candidate.authorityRoles) {
      const canonicalFormat = AUTHORITY_CANONICAL_FORMAT[authorityRole];
      if (
        !candidate.canonicalBoundary.accepts.includes(canonicalFormat)
        || !candidate.canonicalBoundary.emits.includes(canonicalFormat)
      ) {
        return failure(
          "invalid-provider",
          `providers[${index}].canonicalBoundary`,
          `${authorityRole}:${canonicalFormat}`,
        );
      }
    }
    providerById.set(candidate.id, candidate);
    providers.push(candidate);
  }

  const authorityProviderIds =
    {} as Record<StudioHybridAuthorityRole, string>;
  for (const authorityRole of STUDIO_HYBRID_AUTHORITY_ROLES) {
    const owners = providers.filter((provider) =>
      provider.authorityRoles.includes(authorityRole)
    );
    if (owners.length === 0) {
      return failure("missing-authority", "providers.authorityRoles", authorityRole);
    }
    if (owners.length > 1) {
      return failure(
        "duplicate-authority",
        "providers.authorityRoles",
        `${authorityRole}:${owners.map((owner) => owner.id).join(",")}`,
      );
    }
    authorityProviderIds[authorityRole] = owners[0]?.id ?? "";
  }

  const ordered = dependencyOrder(providers, providerById);
  if (!Array.isArray(ordered)) return ordered;
  const surfaceFailure = validateSurfaceAndContexts(providers);
  if (surfaceFailure) return surfaceFailure;

  const requirements =
    input.requirements as unknown as StudioHybridEngineRequirements;
  const authorityProviders = new Set(Object.values(authorityProviderIds));
  for (const provider of providers) {
    if (
      requirements.deterministicReplay
      && authorityProviders.has(provider.id)
      && (
        (
          provider.determinism.mode !== "deterministic"
          && provider.determinism.mode !== "seeded-deterministic"
        )
        || provider.determinism.replay !== "exact"
      )
    ) {
      return failure(
        "determinism-requirement-unsatisfied",
        `providers.${provider.id}.determinism`,
      );
    }
    if (
      requirements.exportRequired
      && authorityProviders.has(provider.id)
      && provider.determinism.export === "unsupported"
    ) {
      return failure(
        "export-requirement-unsatisfied",
        `providers.${provider.id}.determinism.export`,
      );
    }
    if (
      requirements.recoverFromDeviceLoss
      && provider.deviceRecovery.deviceDependent
      && provider.deviceRecovery.recovery !== "recreate-from-canonical"
    ) {
      return failure(
        "device-recovery-requirement-unsatisfied",
        `providers.${provider.id}.deviceRecovery`,
      );
    }
    const requiredPrecision =
      COLOR_PRECISION_RANK[requirements.minimumColorPrecision];
    if (
      authorityProviders.has(provider.id)
      && provider.colorPrecision !== "not-applicable"
      && COLOR_PRECISION_RANK[provider.colorPrecision] < requiredPrecision
    ) {
      return failure(
        "color-precision-requirement-unsatisfied",
        `providers.${provider.id}.colorPrecision`,
      );
    }
  }

  const plan = input as unknown as StudioHybridEnginePlan;
  return {
    ok: true,
    plan,
    dependencyOrder: Object.freeze([...ordered]),
    authorityProviderIds: Object.freeze({ ...authorityProviderIds }),
  };
}

function roundedMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Quality-only score. Bundle bytes are calculated after the score and appear
 * solely under diagnostics; they are not a weight, penalty, threshold or veto.
 */
export function scoreStudioHybridEnginePlan(
  validated: Extract<StudioHybridPlanValidationResult, { ok: true }>,
): StudioHybridPlanScore {
  const providerCount = validated.plan.providers.length;
  let fidelity = 0;
  let interactiveLatency = 0;
  let exportFidelity = 0;
  let replayReliability = 0;
  let recoveryResilience = 0;
  let knownBundleBytes = 0;
  let hasUnknownBundleBytes = false;
  const localities: Record<StudioHybridExecutionLocality, number> = {
    main: 0,
    "engine-worker": 0,
    "wasm-worker": 0,
    "storage-worker": 0,
  };

  for (const provider of validated.plan.providers) {
    fidelity += provider.quality.fidelity;
    interactiveLatency += provider.quality.interactiveLatency;
    exportFidelity += provider.quality.exportFidelity;
    replayReliability += provider.quality.replayReliability;
    recoveryResilience += provider.quality.recoveryResilience;
    localities[provider.locality] += 1;
    if (provider.bundleBytes === null) {
      hasUnknownBundleBytes = true;
    } else {
      knownBundleBytes += provider.bundleBytes;
    }
  }

  fidelity /= providerCount;
  interactiveLatency /= providerCount;
  exportFidelity /= providerCount;
  replayReliability /= providerCount;
  recoveryResilience /= providerCount;
  const total =
    fidelity * 0.35
    + interactiveLatency * 0.25
    + exportFidelity * 0.15
    + replayReliability * 0.15
    + recoveryResilience * 0.1;
  return Object.freeze({
    total: roundedMetric(total),
    fidelity: roundedMetric(fidelity),
    interactiveLatency: roundedMetric(interactiveLatency),
    exportFidelity: roundedMetric(exportFidelity),
    replayReliability: roundedMetric(replayReliability),
    recoveryResilience: roundedMetric(recoveryResilience),
    diagnostics: Object.freeze({
      knownBundleBytes,
      hasUnknownBundleBytes,
      providerCount,
      localities: Object.freeze({ ...localities }),
    }),
  });
}

function unprobed(
  installation: StudioHybridProviderAvailability["installation"],
  detail: string,
): StudioHybridProviderAvailability {
  return Object.freeze({
    installation,
    probe: "not-run",
    checkedAtEpochMilliseconds: null,
    detail,
  });
}

/**
 * Expresses the intended hybrid vocabulary without claiming that packages are
 * installed or supported. Every candidate is deliberately unprobed, so placing
 * it in an executable plan fails with `provider-unavailable` until a real runtime
 * adapter records installation and a verified capability probe.
 */
export const STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "raw-webgpu",
    label: "Raw WebGPU candidate",
    implementation: "native-browser",
    availability: unprobed(
      "built-in",
      "Browser API presence and device features require a runtime probe.",
    ),
    intendedRoles: Object.freeze([
      "raster-render",
      "raster-fx",
      "animation",
    ]),
  }),
  Object.freeze({
    id: "canvaskit-wasm",
    label: "CanvasKit WASM candidate",
    implementation: "wasm-library",
    availability: unprobed(
      "installed",
      "canvaskit-wasm 0.41.1 and its isolated quality-provider adapter are installed; a runtime probe is still required per session.",
    ),
    intendedRoles: Object.freeze([
      "vector-quality",
      "text-raster",
    ]),
  }),
  Object.freeze({
    id: "pixi-renderer",
    label: "Pixi renderer candidate",
    implementation: "js-library",
    availability: unprobed(
      "not-installed",
      "No Pixi package is imported by this contract.",
    ),
    intendedRoles: Object.freeze(["animation", "raster-fx"]),
  }),
  Object.freeze({
    id: "geometry-kernel",
    label: "Vector geometry kernel candidate",
    implementation: "wasm-library",
    availability: unprobed(
      "unknown",
      "Concrete geometry implementation has not been selected or probed.",
    ),
    intendedRoles: Object.freeze(["vector-geometry"]),
  }),
  Object.freeze({
    id: "harfbuzz-wasm",
    label: "HarfBuzz WASM candidate",
    implementation: "wasm-library",
    availability: unprobed(
      "not-installed",
      "No HarfBuzz package or WASM artifact is imported by this contract.",
    ),
    intendedRoles: Object.freeze(["text-shaping"]),
  }),
  Object.freeze({
    id: "three-scene",
    label: "Three scene adapter candidate",
    implementation: "js-library",
    availability: unprobed(
      "installed",
      "The package is installed, but this contract imports nothing and no runtime adapter probe has run.",
    ),
    intendedRoles: Object.freeze(["3d-render", "animation"]),
  }),
  Object.freeze({
    id: "rapier-wasm",
    label: "Rapier WASM candidate",
    implementation: "wasm-library",
    availability: unprobed(
      "installed",
      "The package is installed, but this contract imports nothing and no WASM/runtime probe has run.",
    ),
    intendedRoles: Object.freeze(["physics"]),
  }),
]);
