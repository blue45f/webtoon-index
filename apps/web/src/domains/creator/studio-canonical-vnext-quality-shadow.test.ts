import { afterEach, describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import {
  createStudioCanonicalVNextGpuQualityShadowRuntime,
} from "./studio-canonical-vnext-gpu-quality-shadow-runtime";
import {
  computeStudioCanonicalVNextQualityShadowShardManifest,
  getStudioCanonicalVNextQualityShadowActiveShard,
  installStudioCanonicalVNextQualityShadowRuntime,
  selectStudioCanonicalVNextQualityShadowShardIndex,
  STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_AUTHORITY_STAGE,
  STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE,
  submitStudioCanonicalVNextQualityShadowFinalParity,
  type StudioCanonicalVNextQualityShadowCapability,
  type StudioCanonicalVNextQualityShadowProviderRequest,
  type StudioCanonicalVNextQualityShadowRuntime,
  type StudioCanonicalVNextQualityShadowRuntimeLease,
} from "./studio-canonical-vnext-quality-shadow";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  authorityStagePosture,
  nextStagesOf,
  requireQualityShadowStagePosture,
} from "./studio-provider-authority-lifecycle";

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
    id: "dry-texture-quality-shadow-stroke",
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

function capability(
  overrides: Partial<StudioCanonicalVNextQualityShadowCapability> = {},
): StudioCanonicalVNextQualityShadowCapability {
  return {
    kind: "studio-canonical-vnext-quality-shadow-capability",
    version: 1,
    runtimeId: "test-vnext-texture-runtime",
    runtimeVersion: 3,
    availability: "ready",
    explicitOptIn: true,
    sessionEpoch: 7,
    supportedFamilies: ["dry-media", "wet-media"],
    supportedBackends: [
      "canonical-webgpu-textured",
      "canonical-webgpu-wet-specialist",
    ],
    optedInCatalogIds: ["dry-media", "ink-wash"],
    ...overrides,
  };
}

function providerReceipt(
  request: StudioCanonicalVNextQualityShadowProviderRequest,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "studio-canonical-vnext-quality-shadow-provider/receipt",
    version: 1,
    phase: request.phase,
    runtimeId: request.runtimeId,
    runtimeVersion: request.runtimeVersion,
    providerId: "specialist-gpu",
    providerVersion: 4,
    catalogId: request.catalogId,
    semanticContract: request.semanticContract,
    liveBackend: request.liveBackend,
    commitBackend: request.commitBackend,
    strokeId: request.canonicalPlan.strokeId,
    canonicalPlanHash: request.canonicalPlanHash,
    seed: request.seed,
    providerReceiptIdentity: `${request.phase}:provider-receipt`,
    presentationPayload: null,
    authoritativeHandoff: false,
    complete: true,
    ...overrides,
  };
}

function install(runtime: StudioCanonicalVNextQualityShadowRuntime): void {
  const result = installStudioCanonicalVNextQualityShadowRuntime(runtime);
  expect(result.status).toBe("installed");
  if (result.status !== "installed") throw new Error(result.reason);
  lease = result;
}

describe("Studio canonical vNext quality shadow", () => {
  it("is reachable from the normal Studio release path but absent from the pointer hot loop", () => {
    const page = readStudioCuttoonEditorSource();
    const releaseStart = page.indexOf("function finishDrawingPointer(");
    const releaseEnd = page.indexOf("function onStagePointerCancel", releaseStart);
    const release = page.slice(releaseStart, releaseEnd);

    expect(page).toMatch(
      /from ["'].*studio-canonical-vnext-quality-shadow["']/,
    );
    expect(release).toContain("const finished = releasePlan.stroke");
    expect(release).toContain("if (hasStudioCanonicalVNextQualityShadowRuntime())");
    expect(release).toContain(
      "void submitStudioCanonicalVNextQualityShadowFinalParity({",
    );
    expect(release).toContain("element: finished");
    expect(release).toContain("}).catch(() => undefined)");
    expect(page.match(/submitStudioCanonicalVNextQualityShadowFinalParity\(/gu))
      .toHaveLength(1);
    const pointerStart = page.slice(
      page.indexOf("function onStageDown"),
      releaseStart,
    );
    expect(pointerStart).not.toContain(
      "submitStudioCanonicalVNextQualityShadowFinalParity(",
    );
  });

  it("stays inert when no provider runtime has explicitly opted into a brush", async () => {
    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    })).resolves.toEqual({
      status: "skipped",
      reason: "no-runtime",
    });
  });

  it("submits one identical canonical plan and seed for final live and commit receipts", async () => {
    const requests: StudioCanonicalVNextQualityShadowProviderRequest[] = [];
    install({
      capability: capability(),
      execute(request) {
        requests.push(request);
        return providerReceipt(request);
      },
    });

    const result = await submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
      firstSampleSequence: 40,
      firstTimeMilliseconds: 100,
      fallbackSampleIntervalMilliseconds: 4,
    });

    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(requests.map(({ phase }) => phase)).toEqual(["live", "commit"]);
    expect(requests[0]!.canonicalPlan).toBe(requests[1]!.canonicalPlan);
    expect(requests[0]!.canonicalPlanHash).toBe(requests[1]!.canonicalPlanHash);
    expect(requests[0]!.seed).toBe(requests[1]!.seed);
    expect(requests[0]!.requirements).toEqual(["texture-tip", "grain"]);
    expect(requests[0]).toMatchObject({
      family: "dry-media",
      catalogId: "dry-media",
      liveBackend: "canonical-webgpu-textured",
      commitBackend: "canonical-webgpu-textured",
      semanticContract: "canonical-dry-texture-v1",
    });
    if (result.status === "completed") {
      expect(result.receipt).toMatchObject({
        catalogId: "dry-media",
        family: "dry-media",
        sameCanonicalPlan: true,
        samePersistedSeed: true,
        sameProvider: true,
        authority: "quality-shadow-only",
        presentationPayload: null,
        authoritativeHandoff: false,
        uiRendererChanged: false,
        sourceSampleCount: 3,
        complete: true,
      });
      expect(result.receipt.live.canonicalPlanHash)
        .toBe(result.receipt.commit.canonicalPlanHash);
      expect(result.receipt.live.seed).toBe(result.receipt.commit.seed);
    }
  });

  it("never expands an opt-in to another brush or an ineligible continuous family", async () => {
    let executions = 0;
    install({
      capability: capability({ optedInCatalogIds: ["ink-wash", "gpen"] }),
      execute(request) {
        executions += 1;
        return providerReceipt(request);
      },
    });

    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    })).resolves.toEqual({
      status: "skipped",
      reason: "brush-not-opted-in",
    });
    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: {
        id: "continuous-gpen",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [0, 0, 8, 4],
        pressures: [0.2, 0.8],
        stroke: "#111827",
        strokeWidth: 8,
        brush: "gpen",
        pressureModel: "linear-residual-path-v3",
      },
    })).resolves.toEqual({
      status: "skipped",
      reason: "family-ineligible",
    });
    expect(executions).toBe(0);
  });

  it("fails closed when the commit receipt does not match the final live provider", async () => {
    install({
      capability: capability(),
      execute(request) {
        return providerReceipt(
          request,
          request.phase === "commit"
            ? { providerId: "different-provider" }
            : {},
        );
      },
    });

    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    })).resolves.toEqual({
      status: "rejected",
      reason: "provider-receipt-mismatch",
      detail: "live-commit-parity",
    });
  });

  it("adapts the real provider GPU boundary and maps live/commit to append/rebuild", async () => {
    const boundaryRequests: StudioEngineVNextBrushProviderGpuRequest[] = [];
    const boundary: StudioEngineVNextBrushProviderGpuExecutionBoundary = {
      async execute(request) {
        boundaryRequests.push(request);
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
    const runtime = createStudioCanonicalVNextGpuQualityShadowRuntime({
      runtimeId: "browser-gpu-specialist",
      runtimeVersion: 2,
      sessionEpoch: 7,
      deviceEpoch: 3,
      resizeEpoch: 5,
      supportedFamilies: ["dry-media"],
      supportedBackends: ["canonical-webgpu-textured"],
      optedInCatalogIds: ["dry-media"],
      rasterRect: { x: 0, y: 0, width: 1024, height: 2048 },
      boundary,
    });
    expect(runtime).not.toBeNull();
    install(runtime!);

    const result = await submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    });

    expect(result.status).toBe("completed");
    expect(boundaryRequests.map(({ mode }) => mode)).toEqual(["append", "rebuild"]);
    expect(boundaryRequests[0]!.canonicalPlan)
      .toBe(boundaryRequests[1]!.canonicalPlan);
    expect(boundaryRequests[0]!.canonicalPlanHash)
      .toBe(boundaryRequests[1]!.canonicalPlanHash);
    expect(boundaryRequests[0]!.requirements).toEqual(["texture-tip", "grain"]);
  });
});

describe("Studio canonical vNext quality shadow authority lifecycle derivation", () => {
  it("pins the shadow to the lifecycle quality-shadow stage and its invariant", () => {
    expect(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_AUTHORITY_STAGE).toBe("quality-shadow");
    expect(requireQualityShadowStagePosture(
      STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_AUTHORITY_STAGE,
    )).toEqual({
      stage: "quality-shadow",
      presentationPayload: null,
      authoritativeHandoff: false,
      uiRendererChanged: false,
    });
    // The stage can never promote straight into a presentation-granting stage.
    for (const next of nextStagesOf(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_AUTHORITY_STAGE)) {
      const posture = authorityStagePosture(next);
      expect(posture?.presentationPayloadAllowed).toBe(false);
      expect(posture?.authoritativeHandoffAllowed).toBe(false);
    }
  });

  it("keeps every completed parity receipt inside the shadow-stage invariant", async () => {
    install({
      capability: capability(),
      execute(request) {
        return providerReceipt(request);
      },
    });

    const result = await submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const invariant = requireQualityShadowStagePosture(
      STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_AUTHORITY_STAGE,
    );
    expect(result.receipt.presentationPayload).toBe(invariant.presentationPayload);
    expect(result.receipt.authoritativeHandoff).toBe(invariant.authoritativeHandoff);
    expect(result.receipt.uiRendererChanged).toBe(invariant.uiRendererChanged);
    expect(result.receipt.authority).toBe("quality-shadow-only");
    expect(result.receipt.live.presentationPayload).toBe(invariant.presentationPayload);
    expect(result.receipt.commit.authoritativeHandoff).toBe(invariant.authoritativeHandoff);
  });
});

describe("Studio canonical vNext quality shadow manifest sharding", () => {
  function sweepCatalogIds(count: number): string[] {
    const ids = Array.from({ length: count - 1 }, (_, index) => (
      `sweep-brush-${String(index).padStart(3, "0")}`
    ));
    return [...ids, "dry-media"];
  }

  it("covers every catalogue id exactly once across deterministic order-independent shards", () => {
    const ids = sweepCatalogIds(130);
    const manifest = computeStudioCanonicalVNextQualityShadowShardManifest(ids);
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    expect(manifest.shardSize).toBe(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE);
    expect(manifest.shardCount).toBe(3);
    expect(manifest.catalogIdCount).toBe(130);
    const seen = new Set<string>();
    for (const shard of manifest.shards) {
      expect(shard.length).toBeLessThanOrEqual(STUDIO_CANONICAL_VNEXT_QUALITY_SHADOW_SHARD_SIZE);
      for (const id of shard) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(130);
    expect([...seen].sort()).toEqual([...ids].sort());

    const permuted = computeStudioCanonicalVNextQualityShadowShardManifest(
      [...ids].reverse(),
    );
    expect(permuted).toEqual(manifest);
  });

  it("sweeps every shard across consecutive session epochs", () => {
    const shardCount = 3;
    const visited = new Set<number>();
    for (let epoch = 1; epoch <= shardCount; epoch += 1) {
      const index = selectStudioCanonicalVNextQualityShadowShardIndex(epoch, shardCount);
      expect(index).not.toBeNull();
      if (index !== null) visited.add(index);
    }
    expect([...visited].sort()).toEqual([0, 1, 2]);
    // Deterministic wrap-around: epoch N+shardCount audits the same shard as epoch N.
    expect(selectStudioCanonicalVNextQualityShadowShardIndex(4, shardCount))
      .toBe(selectStudioCanonicalVNextQualityShadowShardIndex(1, shardCount));
    expect(selectStudioCanonicalVNextQualityShadowShardIndex(0, shardCount)).toBeNull();
    expect(selectStudioCanonicalVNextQualityShadowShardIndex(1, 0)).toBeNull();
    expect(computeStudioCanonicalVNextQualityShadowShardManifest([])).toBeNull();
    expect(computeStudioCanonicalVNextQualityShadowShardManifest(["ok"], 0)).toBeNull();
  });

  it("accepts manifests beyond the legacy cap and audits only the active shard per run", async () => {
    const ids = sweepCatalogIds(150);
    const manifest = computeStudioCanonicalVNextQualityShadowShardManifest(ids);
    expect(manifest).not.toBeNull();
    if (!manifest) return;
    const dryShardIndex = manifest.shards.findIndex((shard) => shard.includes("dry-media"));
    expect(dryShardIndex).toBeGreaterThanOrEqual(0);
    const inShardEpoch = dryShardIndex + 1;
    const outShardEpoch = ((dryShardIndex + 1) % manifest.shardCount) + 1;
    expect(outShardEpoch).not.toBe(inShardEpoch);

    expect(getStudioCanonicalVNextQualityShadowActiveShard()).toBeNull();
    install({
      capability: capability({
        optedInCatalogIds: ids,
        sessionEpoch: outShardEpoch,
      }),
      execute(request) {
        return providerReceipt(request);
      },
    });
    expect(getStudioCanonicalVNextQualityShadowActiveShard()).toMatchObject({
      shardIndex: outShardEpoch - 1,
      shardCount: manifest.shardCount,
    });
    await expect(submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    })).resolves.toEqual({
      status: "skipped",
      reason: "catalog-id-out-of-shard",
    });
    lease?.dispose();
    lease = null;

    install({
      capability: capability({
        optedInCatalogIds: ids,
        sessionEpoch: inShardEpoch,
      }),
      execute(request) {
        return providerReceipt(request);
      },
    });
    expect(getStudioCanonicalVNextQualityShadowActiveShard()).toMatchObject({
      shardIndex: dryShardIndex,
      shardCount: manifest.shardCount,
    });
    const result = await submitStudioCanonicalVNextQualityShadowFinalParity({
      element: dryTextureElement(),
    });
    expect(result.status).toBe("completed");
  });
});
