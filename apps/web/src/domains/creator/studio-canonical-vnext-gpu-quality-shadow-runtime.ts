/**
 * Heavy WebGPU adapter for the lightweight Studio quality shadow.
 *
 * Kept in a separate module so importing the normal pointer-up selector does not eagerly pull the
 * provider-router GPU boundary into the initial Studio bundle.
 */

import {
  STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
  type StudioEngineVNextBrushProviderGpuExecutionBoundary,
} from "./render/studio-engine-vnext-brush-provider-gpu-boundary";
import {
  computeStudioCanonicalVNextQualityShadowShardManifest,
  STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_BRIDGE_VERSION,
  type StudioCanonicalVNextQualityShadowBackend,
  type StudioCanonicalVNextQualityShadowCapability,
  type StudioCanonicalVNextQualityShadowProviderReceipt,
  type StudioCanonicalVNextQualityShadowProviderRequest,
  type StudioCanonicalVNextQualityShadowRuntime,
} from "./studio-canonical-vnext-quality-shadow";

import type { StudioBrushBackendQualityFamily } from "./brush/studio-brush-backend-quality-policy";
import type { StudioEngineWebGpuBrushRasterRect } from "./render/studio-engine-webgpu-brush-runtime";

export interface StudioCanonicalVNextGpuQualityShadowRuntimeOptions {
  readonly runtimeId: string;
  readonly runtimeVersion: number;
  readonly sessionEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly supportedFamilies: readonly StudioBrushBackendQualityFamily[];
  readonly supportedBackends: readonly StudioCanonicalVNextQualityShadowBackend[];
  readonly optedInCatalogIds: readonly string[];
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly boundary: StudioEngineVNextBrushProviderGpuExecutionBoundary;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u.test(value);
}

function capability(
  options: StudioCanonicalVNextGpuQualityShadowRuntimeOptions,
): StudioCanonicalVNextQualityShadowCapability | null {
  const families = options.supportedFamilies;
  const backends = options.supportedBackends;
  const catalogIds = options.optedInCatalogIds;
  if (
    !validIdentifier(options.runtimeId)
    || !positiveSafeInteger(options.runtimeVersion)
    || !positiveSafeInteger(options.sessionEpoch)
    || !Array.isArray(families)
    || families.length < 1
    || new Set(families).size !== families.length
    || !families.every((family) => (
      family === "dry-media"
      || family === "wet-media"
      || family === "stamp-pattern"
    ))
    || !Array.isArray(backends)
    || backends.length < 1
    || new Set(backends).size !== backends.length
    || !backends.every((backend) => (
      backend === "canonical-webgpu-textured"
      || backend === "canonical-webgpu-wet-specialist"
      || backend === "professional-bristle-webgpu"
    ))
    || !Array.isArray(catalogIds)
    || catalogIds.length < 1
    // The manifest size cap is owned by the shadow module: any manifest its shard-manifest
    // validator accepts is accepted here, and per-run workload bounds come from the shadow
    // module's deterministic shard scheduling instead of a local whole-manifest cap.
    || computeStudioCanonicalVNextQualityShadowShardManifest(catalogIds) === null
    || new Set(catalogIds).size !== catalogIds.length
    || !catalogIds.every(validIdentifier)
  ) return null;
  return Object.freeze({
    kind: "studio-canonical-vnext-quality-shadow-capability",
    version: STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_BRIDGE_VERSION,
    runtimeId: options.runtimeId,
    runtimeVersion: options.runtimeVersion,
    availability: "ready",
    explicitOptIn: true,
    sessionEpoch: options.sessionEpoch,
    supportedFamilies: Object.freeze([...families]),
    supportedBackends: Object.freeze([...backends]),
    optedInCatalogIds: Object.freeze([...catalogIds]),
  });
}

/**
 * Adapts the tested vNext provider-router GPU boundary to a non-authoritative quality shadow. The
 * projected receipt is backed by the provider proof and exact WebGPU brush receipt, but deliberately
 * carries no presentable pixel payload and can never acquire Studio renderer authority.
 */
export function createStudioCanonicalVNextGpuQualityShadowRuntime(
  options: StudioCanonicalVNextGpuQualityShadowRuntimeOptions,
): StudioCanonicalVNextQualityShadowRuntime | null {
  if (
    typeof options !== "object"
    || options === null
    || !positiveSafeInteger(options.deviceEpoch)
    || !positiveSafeInteger(options.resizeEpoch)
    || !options.boundary
    || typeof options.boundary.execute !== "function"
  ) return null;
  const runtimeCapability = capability(options);
  const rect = options.rasterRect;
  if (
    !runtimeCapability
    || !Number.isFinite(rect?.x)
    || !Number.isFinite(rect?.y)
    || !Number.isFinite(rect?.width)
    || !Number.isFinite(rect?.height)
    || rect.width <= 0
    || rect.height <= 0
  ) return null;
  let requestSequence = 0;
  return Object.freeze({
    capability: runtimeCapability,
    async execute(
      request: StudioCanonicalVNextQualityShadowProviderRequest,
      signal: AbortSignal,
    ): Promise<StudioCanonicalVNextQualityShadowProviderReceipt> {
      requestSequence += 1;
      const result = await options.boundary.execute({
        kind: "studio-engine-vnext-brush-provider-gpu/request",
        version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
        requestSequence,
        sessionEpoch: request.canonicalPlan.sessionEpoch,
        strokeEpoch: request.canonicalPlan.strokeEpoch,
        deviceEpoch: options.deviceEpoch,
        resizeEpoch: options.resizeEpoch,
        mode: request.phase === "live" ? "append" : "rebuild",
        rasterRect: rect,
        strokeId: request.canonicalPlan.strokeId,
        canonicalPlanHash: request.canonicalPlanHash,
        requirements: request.requirements.filter(
          (requirement): requirement is "texture-tip" | "grain" | "wet-media" =>
            requirement === "texture-tip"
            || requirement === "grain"
            || requirement === "wet-media",
        ),
        canonicalPlan: request.canonicalPlan,
      }, signal);
      if (result.status !== "presented") {
        throw new Error(`vnext-provider-${result.reason}`);
      }
      if (
        result.proof.canonicalPlanHash !== request.canonicalPlanHash
        || result.receipt.strokeId !== request.canonicalPlan.strokeId
        || result.receipt.complete !== true
      ) {
        throw new Error("vnext-provider-receipt-mismatch");
      }
      return Object.freeze({
        kind: "studio-canonical-vnext-quality-shadow-provider/receipt",
        version: STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_BRIDGE_VERSION,
        phase: request.phase,
        runtimeId: request.runtimeId,
        runtimeVersion: request.runtimeVersion,
        providerId: result.proof.providerId,
        providerVersion: result.proof.providerVersion,
        catalogId: request.catalogId,
        semanticContract: request.semanticContract,
        liveBackend: request.liveBackend,
        commitBackend: request.commitBackend,
        strokeId: request.canonicalPlan.strokeId,
        canonicalPlanHash: request.canonicalPlanHash,
        seed: request.seed,
        providerReceiptIdentity: result.receipt.planFingerprint,
        presentationPayload: null,
        authoritativeHandoff: false,
        complete: true,
      });
    },
  });
}
