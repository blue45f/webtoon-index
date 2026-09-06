import { afterEach, describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import {
  createStudioCanonicalVNextGpuQualityShadowRuntime,
  type StudioCanonicalVNextGpuQualityShadowRuntimeOptions,
} from "./studio-canonical-vnext-gpu-quality-shadow-runtime";
import {
  computeStudioCanonicalVNextQualityShadowShardManifest,
  getStudioCanonicalVNextQualityShadowActiveShard,
  installStudioCanonicalVNextQualityShadowRuntime,
  STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE,
  submitStudioCanonicalVNextQualityShadowFinalParity,
  type StudioCanonicalVNextQualityShadowRuntime,
  type StudioCanonicalVNextQualityShadowRuntimeLease,
} from "./studio-canonical-vnext-quality-shadow";

import type {
  StudioEngineVNextBrushProviderGpuExecutionBoundary,
  StudioEngineVNextBrushProviderGpuRequest,
} from "./render/studio-engine-vnext-brush-provider-gpu-boundary";
import type { DrawEl } from "./studio-element-model";

let lease: StudioCanonicalVNextQualityShadowRuntimeLease | null = null;

afterEach(() => {
  lease?.dispose();
  lease = null;
});

function dryTextureElement(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "dry-texture-gpu-shadow-stroke",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [2, 3, 8, 5, 14, 11],
    pressures: [0.2, 0.65, 0.9],
    speeds: [0, 6.32, 8.48],
    stroke: "#334155",
    strokeWidth: 14,
    // Product pointer-start stamps the bounded-flow-v2 seam with causal sampleSpacing on every
    // retained-dynamics pen stroke; the vNext specialist admits only its unit-opacity form.
    opacity: 1,
    paintModel: "bounded-flow-v2",
    sampleSpacing: 1,
    brush: "dry-media",
    brushDynamics: normalizeStudioBrushDynamicsSettings({
      seed: 91,
      fallbackPressure: 0.45,
      spacingRatio: 0.16,
      scatterRatio: 0.04,
      taper: { enabled: false },
      tip: { shape: "bristle", softness: 0.18, alphaMapSize: 16 },
      tipLayers: [],
      colorDynamics: {
        backgroundColor: "#ffffff",
        foregroundBackgroundMix: 0,
        foregroundBackgroundJitter: 0,
        hueJitter: 0,
        saturationJitter: 0,
        valueJitter: 0,
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.42,
        scale: 8,
        contrast: 0.65,
        seed: 73,
      },
      width: {
        base: 14,
        min: 0.05,
        max: 4096,
        mappings: [{
          source: "pressure",
          mode: "multiply",
          from: 0.3,
          to: 1,
          amount: 1,
        }],
        jitter: null,
      },
      opacity: { base: 0.9, min: 0, max: 1, mappings: [], jitter: null },
      flow: { base: 0.72, min: 0, max: 1, mappings: [], jitter: null },
      spacing: { base: 2.24, min: 0.25, max: 4096, mappings: [], jitter: null },
      scatter: { base: 0.56, min: 0, max: 4096, mappings: [], jitter: null },
      angle: { base: -12, min: -180, max: 180, mappings: [], jitter: null },
      roundness: { base: 0.68, min: 0.08, max: 1, mappings: [], jitter: null },
    }),
    ...overrides,
  };
}

function manifestIds(count: number): string[] {
  const ids = Array.from({ length: count - 1 }, (_, index) => (
    `manifest-brush-${String(index).padStart(4, "0")}`
  ));
  return [...ids, "dry-media"];
}

function recordingBoundary(): Readonly<{
  boundary: StudioEngineVNextBrushProviderGpuExecutionBoundary;
  requests: StudioEngineVNextBrushProviderGpuRequest[];
}> {
  const requests: StudioEngineVNextBrushProviderGpuRequest[] = [];
  const boundary: StudioEngineVNextBrushProviderGpuExecutionBoundary = {
    async execute(request) {
      requests.push(request);
      return {
        status: "presented",
        proof: {
          kind: "studio-engine-vnext-brush-provider/proof",
          version: 1,
          providerId: "gpu-specialist",
          providerVersion: 6,
          providerPriority: 10,
          globalRequestSequence: request.requestSequence,
          providerLocalSequence: request.requestSequence,
          sessionEpoch: request.sessionEpoch,
          strokeEpoch: request.strokeEpoch,
          deviceEpoch: request.deviceEpoch,
          resizeEpoch: request.resizeEpoch,
          canonicalPlanHash: request.canonicalPlanHash,
          requiredCapabilities: [
            "tip:texture",
            "grain:procedural",
            "media:dry",
            "color:linear-srgb",
            "porter-duff:source-over",
            "blend:normal",
            "intent:professional",
          ],
          executionDigest: `proof:${request.requestSequence}`,
        },
        receipt: {
          kind: "studio-engine-webgpu-brush-receipt",
          revision: 2,
          backend: "webgpu",
          requestSequence: request.requestSequence,
          resizeEpoch: request.resizeEpoch,
          deviceEpoch: request.deviceEpoch,
          width: request.rasterRect.width,
          height: request.rasterRect.height,
          textureFormat: "rgba16float",
          colorModel: "linear-premultiplied",
          workingColorSpace: "linear-srgb",
          inputColorEncoding: "scene-linear-straight",
          presentationColorSpace: "srgb",
          mode: request.mode,
          strokeId: request.strokeId,
          loweringVersion: 1,
          dabCount: 12,
          batchCount: 1,
          batchOrder: ["source-over"],
          planFingerprint: `provider-frame:${request.requestSequence}`,
          queueState: "submitted",
          complete: true,
        },
      };
    },
  };
  return Object.freeze({ boundary, requests });
}

function runtimeOptions(
  overrides: Partial<StudioCanonicalVNextGpuQualityShadowRuntimeOptions> = {},
): StudioCanonicalVNextGpuQualityShadowRuntimeOptions {
  return {
    runtimeId: "browser-gpu-specialist",
    runtimeVersion: 2,
    sessionEpoch: 7,
    deviceEpoch: 3,
    resizeEpoch: 5,
    supportedFamilies: ["dry-media"],
    supportedBackends: ["canonical-webgpu-textured"],
    optedInCatalogIds: ["dry-media"],
    rasterRect: { x: 0, y: 0, width: 1024, height: 2048 },
    boundary: recordingBoundary().boundary,
    ...overrides,
  };
}

function install(runtime: StudioCanonicalVNextQualityShadowRuntime): void {
  const result = installStudioCanonicalVNextQualityShadowRuntime(runtime);
  expect(result.status).toBe("installed");
  if (result.status !== "installed") throw new Error(result.reason);
  lease = result;
}

describe("Studio canonical vNext GPU quality shadow runtime manifest delegation", () => {
  it("accepts a manifest larger than one per-run shard", () => {
    const ids = manifestIds(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE + 86);
    const runtime = createStudioCanonicalVNextGpuQualityShadowRuntime(
      runtimeOptions({ optedInCatalogIds: ids }),
    );
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    expect(runtime.capability.optedInCatalogIds).toHaveLength(ids.length);
    expect([...runtime.capability.optedInCatalogIds].sort())
      .toEqual([...ids].sort());
  });

  it("rejects only what the shadow module's manifest validator rejects, fail-closed", () => {
    // The manifest limit is owned by the shadow module. These two guard assertions pin the
    // boundary against the exported validator itself, so if the shadow module's limit ever
    // moves, this test fails at the guard instead of letting the runtime drift.
    const atLimit = manifestIds(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE * 64);
    const beyondLimit = manifestIds(
      STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE * 64 + 1,
    );
    expect(computeStudioCanonicalVNextQualityShadowShardManifest(atLimit)).not.toBeNull();
    expect(computeStudioCanonicalVNextQualityShadowShardManifest(beyondLimit)).toBeNull();

    expect(createStudioCanonicalVNextGpuQualityShadowRuntime(
      runtimeOptions({ optedInCatalogIds: atLimit }),
    )).not.toBeNull();
    // Same error style as every other invalid capability input: null, no partial runtime.
    expect(createStudioCanonicalVNextGpuQualityShadowRuntime(
      runtimeOptions({ optedInCatalogIds: beyondLimit }),
    )).toBeNull();
  });

  it("bounds one installed run to its deterministic shard of a large manifest", async () => {
    const ids = manifestIds(150);
    const manifest = computeStudioCanonicalVNextQualityShadowShardManifest(ids);
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    const dryShardIndex = manifest.shards.findIndex((shard) => shard.includes("dry-media"));
    expect(dryShardIndex).toBeGreaterThanOrEqual(0);
    const inShardEpoch = dryShardIndex + 1;
    const outShardEpoch = ((dryShardIndex + 1) % manifest.shardCount) + 1;
    expect(outShardEpoch).not.toBe(inShardEpoch);

    const outOfShard = recordingBoundary();
    const outOfShardRuntime = createStudioCanonicalVNextGpuQualityShadowRuntime(
      runtimeOptions({
        optedInCatalogIds: ids,
        sessionEpoch: outShardEpoch,
        boundary: outOfShard.boundary,
      }),
    );
    expect(outOfShardRuntime).not.toBeNull();
    install(outOfShardRuntime!);
    const activeShard = getStudioCanonicalVNextQualityShadowActiveShard();
    expect(activeShard).not.toBeNull();
    expect(activeShard!.shardCount).toBe(manifest.shardCount);
    expect(activeShard!.catalogIds.length)
      .toBeLessThanOrEqual(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE);
    expect(activeShard!.catalogIds)
      .toEqual(manifest.shards[activeShard!.shardIndex]);
    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    })).resolves.toEqual({
      status: "skipped",
      reason: "catalog-id-out-of-shard",
    });
    expect(outOfShard.requests).toHaveLength(0);
    lease?.dispose();
    lease = null;

    const inShard = recordingBoundary();
    const inShardRuntime = createStudioCanonicalVNextGpuQualityShadowRuntime(
      runtimeOptions({
        optedInCatalogIds: ids,
        sessionEpoch: inShardEpoch,
        boundary: inShard.boundary,
      }),
    );
    expect(inShardRuntime).not.toBeNull();
    install(inShardRuntime!);
    const result = await submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    });
    expect(result.status).toBe("completed");
    expect(inShard.requests.map(({ mode }) => mode)).toEqual(["append", "rebuild"]);
  });
});
