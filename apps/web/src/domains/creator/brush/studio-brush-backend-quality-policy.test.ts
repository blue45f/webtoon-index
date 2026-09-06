import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
} from "../render/studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "../render/studio-hokusai-natural-media-worker-protocol";
import { BRUSH_PRESETS } from "../studio-brush";

import {
  STUDIO_BRUSH_BACKEND_FAMILY_POLICIES,
  STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT,
  STUDIO_BRUSH_BACKEND_QUALITY_POLICY_VERSION,
  STUDIO_BRUSH_BACKEND_ROUTE_CANDIDATES,
  STUDIO_BRUSH_CROSS_ENGINE_PRODUCT_FALLBACK_POLICY,
  STUDIO_BRUSH_ENGINE_PRIORITY_POLICY,
  STUDIO_CORE_BRUSH_BACKEND_ROUTE_PROFILES,
  STUDIO_HOKUSAI_FULLSIZE_PROMOTION_GATE,
  STUDIO_HOKUSAI_MYB_PROVIDER_POLICY,
  STUDIO_HOKUSAI_MYB_PROVIDER_POLICY_VERSION,
  STUDIO_HOKUSAI_PRODUCT_PROMOTED_PRESETS,
  classifyStudioBrushBackendQuality,
  resolveStudioBrushBackendQualityRoute,
  resolveStudioHokusaiProductLiveAdmission,
  type StudioBrushBackendAvailability,
  type StudioBrushBackendId,
  type StudioBrushBackendQualityFamily,
  type StudioBrushBackendRouteProfile,
  type StudioHokusaiMybProviderOptIn,
} from "./studio-brush-backend-quality-policy";
import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import {
  STUDIO_BRUSH_RUNTIME_CONTRACT,
  resolveStudioBrushRuntimeContract,
} from "./studio-brush-runtime-contract";

function availabilitySnapshot(
  availability: StudioBrushBackendAvailability,
): Record<StudioBrushBackendId, StudioBrushBackendAvailability> {
  return Object.fromEntries(
    STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.map(({ id }) => [id, availability]),
  ) as Record<StudioBrushBackendId, StudioBrushBackendAvailability>;
}

function familyForRouteProfile(
  profile: StudioBrushBackendRouteProfile,
): StudioBrushBackendQualityFamily {
  if (profile.startsWith("continuous-")) return "continuous-ink";
  if (profile.startsWith("dry-")) return "dry-media";
  if (profile.startsWith("wet-")) return "wet-media";
  if (profile.startsWith("spray-")) return "spray-particle";
  if (profile.startsWith("stamp-")) return "stamp-pattern";
  return "eraser-mixer";
}

function hokusaiOptIn(): StudioHokusaiMybProviderOptIn {
  return {
    backendId: "hokusai-myb-worker",
    mode: "settled",
    engineVersion: "0.3.0",
    adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
    customBinding: "toonspectrum-packed-dirty-frame",
    surfaceContract: "packed-dirty-rgba8",
  };
}

function hokusaiLiveOptIn(): StudioHokusaiMybProviderOptIn {
  return {
    ...hokusaiOptIn(),
    mode: "live",
    liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
    protocolVersion: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
    admission: {
      prewarmedAtStrokeStart: true,
      packedDirtyTransfer: true,
      singleInFlightFrame: true,
      stalePresentationCoalesced: true,
      inputSamplesPreserved: true,
      epochCancellation: true,
      canonicalPng: true,
      exactLiveCommitParity: true,
      midStrokePromotion: false,
    },
  };
}

describe("studio brush backend integration audit", () => {
  it("records every current and future backend once without treating scene overlays as brushes", () => {
    const ids = STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.map(({ id }) => id);
    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(ids.length);

    const auditById = new Map(
      STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.map((entry) => [entry.id, entry]),
    );
    expect(auditById.get("pixi-scene-overlay")).toMatchObject({
      connection: "not-a-brush-backend",
      brushPixelAuthority: false,
      phases: ["scene-overlay"],
    });
    expect(auditById.get("paper-vector-refinement")).toMatchObject({
      connection: "active-settled-tool",
      brushPixelAuthority: false,
      phases: ["settled"],
    });
    expect(auditById.get("canvaskit-path-specialist")?.connection)
      .toBe("implemented-unwired");
    expect(auditById.get("vnext-provider-router")).toMatchObject({
      connection: "implemented-unwired",
      brushPixelAuthority: false,
      phases: ["routing"],
    });
    expect(auditById.get("canonical-webgpu-analytic")?.connection)
      .toBe("implemented-unwired");
    expect(auditById.get("canonical-webgpu-textured")).toMatchObject({
      connection: "conditional-product",
      phases: ["live", "commit", "settled"],
      brushPixelAuthority: true,
    });
    expect(auditById.get("canonical-webgpu-textured")?.evidence)
      .toContain("shared RGBA16F");
    expect(auditById.get("canonical-webgpu-textured")?.evidence)
      .toContain("selected, top-most, unclipped");
    expect(auditById.get("canonical-webgpu-textured")?.evidence)
      .toContain("presentation receipts");
    expect(auditById.get("perfect-freehand-outline")).toMatchObject({
      connection: "active-product",
      asynchronous: false,
      defaultAvailability: "ready",
    });
    expect(auditById.get("webgpu-live-causal-ink")?.connection)
      .toBe("conditional-product");
    expect(auditById.get("canvas2d-wet-field")).toMatchObject({
      connection: "implemented-unwired",
      defaultAvailability: "unavailable",
    });
    expect(auditById.get("canvas2d-wet-ribbon")).toMatchObject({
      connection: "active-product",
      defaultAvailability: "ready",
      phases: ["live", "commit"],
      brushPixelAuthority: true,
    });
    expect(auditById.get("hokusai-myb-worker")).toMatchObject({
      implementation:
        "installed studio-hokusai-wasm with exact Hokusai 0.3.0 crates and a packed dirty-frame Dedicated Worker",
      connection: "conditional-product",
      phases: ["live", "commit", "settled"],
      asynchronous: true,
      defaultAvailability: "unavailable",
      brushPixelAuthority: true,
    });
    expect(auditById.get("hokusai-myb-worker")?.evidence)
      .toContain("explicit experimental conversion");
    expect(auditById.get("hokusai-myb-worker")?.evidence)
      .toContain("failed quality parity and the 1.2x throughput gate");
    expect(auditById.get("hokusai-myb-worker")?.evidence)
      .toContain("benchmark reference, not a product fallback");
  });
});

describe("studio brush backend quality classification", () => {
  it("classifies all 99 core tools exactly once and keeps dry/wet media off causal ink", () => {
    const presetIds = BRUSH_PRESETS.map(({ id }) => id).sort();
    const routeIds = Object.keys(STUDIO_CORE_BRUSH_BACKEND_ROUTE_PROFILES).sort();
    const runtimeIds = STUDIO_BRUSH_RUNTIME_CONTRACT.map(({ id }) => id).sort();

    expect(presetIds).toHaveLength(BRUSH_PRESETS.length);
    expect(presetIds.length).toBeGreaterThan(99);
    expect(routeIds).toEqual(presetIds);
    expect(runtimeIds).toEqual(presetIds);

    for (const brushId of presetIds) {
      const classification = classifyStudioBrushBackendQuality({ brushId });
      expect(classification.status, brushId).toBe("classified");
      if (classification.status !== "classified") continue;

      expect(classification.identity.source, brushId).toBe("core");
      expect(classification.identity.catalogId, brushId).toBe(brushId);
      expect(
        Object.values(STUDIO_BRUSH_BACKEND_FAMILY_POLICIES)
          .filter(({ family }) => family === classification.identity.family),
        brushId,
      ).toHaveLength(1);

      if (
        classification.identity.family === "dry-media"
        || classification.identity.family === "wet-media"
      ) {
        expect(resolveStudioBrushRuntimeContract(brushId)?.engine, brushId)
          .not.toBe("causal-ink");
      }
    }

    for (const eraserId of ["standard-eraser", "kneaded-eraser"] as const) {
      expect(classifyStudioBrushBackendQuality({ brushId: eraserId })).toMatchObject({
        status: "classified",
        identity: {
          source: "core",
          catalogId: eraserId,
          runtimeBrushId: eraserId,
          family: "continuous-ink",
          routeProfile: "continuous-analytic",
        },
      });
    }
  });

  it("classifies all 160 pro brushes by their catalogue identity and runtime profile", () => {
    expect(STUDIO_BRUSH_PACK_DESCRIPTORS).toHaveLength(160);
    for (const descriptor of STUDIO_BRUSH_PACK_DESCRIPTORS) {
      const classification = classifyStudioBrushBackendQuality({
        catalogId: descriptor.catalogId,
        brushId: descriptor.runtimeBrushId,
      });
      expect(classification.status, descriptor.catalogId).toBe("classified");
      if (classification.status !== "classified") continue;

      expect(classification.identity).toMatchObject({
        source: "pro",
        catalogId: descriptor.catalogId,
        runtimeBrushId: descriptor.runtimeBrushId,
      });
    }

    const descriptor = STUDIO_BRUSH_PACK_DESCRIPTORS[0];
    expect(classifyStudioBrushBackendQuality({
      catalogId: descriptor.catalogId,
      brushId: "pen",
    })).toEqual({
      status: "rejected",
      reason: "identity-mismatch",
    });

    for (const [catalogId, routeProfile, family] of [
      ["bristle-round-loaded", "wet-specialist", "wet-media"],
      ["bristle-fan-dry", "dry-specialist", "dry-media"],
      ["bristle-flat-streak", "wet-specialist", "wet-media"],
      ["oil-filbert", "wet-specialist", "wet-media"],
      ["palette-knife-edge", "wet-specialist", "wet-media"],
    ] as const) {
      expect(classifyStudioBrushBackendQuality({ catalogId })).toMatchObject({
        status: "classified",
        identity: { catalogId, routeProfile, family },
      });
    }
  });

  it("covers the complete 234-tool shelf without duplicate or unclassified ids", () => {
    const ids = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map(({ id }) => id);
    expect(ids).toHaveLength(STUDIO_ALL_BRUSH_CATALOG_ITEMS.length);
    expect(new Set(ids).size).toBe(ids.length);

    for (const { id, source } of STUDIO_ALL_BRUSH_CATALOG_ITEMS) {
      const classification = classifyStudioBrushBackendQuality({ catalogId: id });
      expect(classification.status, id).toBe("classified");
      if (classification.status !== "classified") continue;
      expect(classification.identity.source, id).toBe(source);
    }
  });
});

describe("studio brush material backend policy", () => {
  it("defines the six exclusive material families and bans generic circle fallback for dry and wet media", () => {
    expect(Object.keys(STUDIO_BRUSH_BACKEND_FAMILY_POLICIES).sort()).toEqual([
      "continuous-ink",
      "dry-media",
      "eraser-mixer",
      "spray-particle",
      "stamp-pattern",
      "wet-media",
    ]);

    for (const family of ["dry-media", "wet-media"] as const) {
      const policy = STUDIO_BRUSH_BACKEND_FAMILY_POLICIES[family];
      expect(policy.forbiddenFallbacks).toEqual(expect.arrayContaining([
        "generic-round-circle-carrier",
        "cross-family-round-dab",
      ]));
      expect(policy.allowedPrimaryBackends).not.toContain("canvas2d-causal-ink");
      expect(policy.allowedPrimaryBackends).toContain("hokusai-myb-worker");
      expect(policy.allowedSettledEnhancers).toContain("hokusai-myb-worker");
    }

    const allPrimaryBackends = Object.values(STUDIO_BRUSH_BACKEND_FAMILY_POLICIES)
      .flatMap(({ allowedPrimaryBackends }) => allowedPrimaryBackends);
    expect(allPrimaryBackends).not.toContain("pixi-scene-overlay");
    expect(allPrimaryBackends).not.toContain("vnext-provider-router");
    expect(allPrimaryBackends).not.toContain("canvaskit-path-specialist");
    expect(allPrimaryBackends).not.toContain("paper-vector-refinement");
  });

  it("admits only explicit live/commit pairs with a shared semantic contract", () => {
    const auditById = new Map(
      STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.map((entry) => [entry.id, entry]),
    );

    for (const [profile, candidates] of Object.entries(
      STUDIO_BRUSH_BACKEND_ROUTE_CANDIDATES,
    ) as [StudioBrushBackendRouteProfile, typeof STUDIO_BRUSH_BACKEND_ROUTE_CANDIDATES[
      StudioBrushBackendRouteProfile
    ]][]) {
      const policy =
        STUDIO_BRUSH_BACKEND_FAMILY_POLICIES[familyForRouteProfile(profile)];
      expect(candidates.length, profile).toBeGreaterThan(0);

      for (const candidate of candidates) {
        const live = auditById.get(candidate.live);
        const commit = auditById.get(candidate.commit);
        expect(candidate.semanticContract.length, profile).toBeGreaterThan(0);
        expect(policy.allowedPrimaryBackends, profile).toContain(candidate.live);
        expect(policy.allowedPrimaryBackends, profile).toContain(candidate.commit);
        expect(live?.phases, profile).toContain("live");
        expect(commit?.phases, profile).toContain("commit");
        expect(commit?.brushPixelAuthority, profile).toBe(true);
        if (candidate.live !== "deferred-raster-tool-preview") {
          expect(live?.brushPixelAuthority, profile).toBe(true);
        }
      }
    }
  });

  it("resolves every catalogue brush with exact parity when its backend pair is ready", () => {
    const availability = availabilitySnapshot("ready");
    for (const { id } of STUDIO_ALL_BRUSH_CATALOG_ITEMS) {
      const route = resolveStudioBrushBackendQualityRoute({
        catalogId: id,
        availability,
      });
      expect(route.status, id).toBe("ready");
      if (route.status !== "ready") continue;
      expect(route.semanticContract.length, id).toBeGreaterThan(0);
      expect(route.parity).toMatchObject({
        requirement: "explicit-live-commit-pair",
        source: "same-authoritative-samples",
        recipe: "same-versioned-recipe",
        seed: "same-persisted-seed",
        handoff: "receipt-before-authority-switch",
      });
      expect(route.liveBackend, id).not.toBe("hokusai-myb-worker");
      expect(route.commitBackend, id).not.toBe("hokusai-myb-worker");
    }
  });
});

describe("Hokusai .myb provider admission", () => {
  it("pins the profile-routed packed dirty-frame adapter and forbids the stock opaque-white surface", () => {
    expect(STUDIO_BRUSH_BACKEND_QUALITY_POLICY_VERSION).toBe(8);
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY_VERSION).toBe(7);
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY).toMatchObject({
      policyVersion: 7,
      backendId: "hokusai-myb-worker",
      crate: "hokusai-wasm",
      exactVersion: "0.3.0",
      exactCargoRequirement: "=0.3.0",
      license: "MIT OR Apache-2.0",
      brushFormat: ".myb/libmypaint-v3",
      execution: "dedicated-worker-wasm-packed-dirty-frame",
      adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
      customBinding: "toonspectrum-packed-dirty-frame",
      surface: {
        internalTileSize: 64,
        internalFormat: "premultiplied-linear-rgba-fix15",
        transferFormat: "packed-dirty-rgba8",
        productBoundary:
          "transferable-packed-dirty-live-plus-canonical-png-parity-receipt",
        stockOpaqueWhiteFlatteningAllowed: false,
      },
      rollout: {
        defaultMode: "experimental-explicit-selected-stroke-only",
        productStatus: "experimental-quality-gate-blocked",
        liveAutomaticRoutingEnabled: false,
        settledRequiresExplicitOptIn: true,
        fullLiveCoreInstalled: true,
        runtimeMustBeReady: true,
        defaultBrushRoutesChanged: false,
        verifiedAutomaticRouteCount: 0,
        promotedPresetEvidenceCount: 0,
        prewarmAtBrushSelection: false,
        prewarmAtExplicitAdmission: true,
        admissionPinnedAtStrokeStart: true,
        midStrokeProviderSwitchAllowed: false,
        inFlightTransferableFrameLimit: 1,
        stalePresentationPolicy: "coalesce-latest",
        inputDropAllowed: false,
        explicitSelectedStrokeConversionFallback: true,
        licenseGatePassed: true,
        reproducibleReleaseGatePassed: true,
        realBrowserRuntimeGatePassed: true,
        fullsizeQualityParityPassed: false,
        fullsizeThroughputGatePassed: false,
        benchmarkReferenceIsProductFallback: false,
      },
      determinism: {
        persistSeed: true,
        persistEngineAndAdapterVersion: true,
        requireInputAndPixelHashReceipt: true,
        crossPlatformBitIdentityGuaranteed: false,
      },
    });
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY.eligibleFamilies)
      .toEqual(["continuous-ink", "dry-media", "wet-media"]);
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY.determinism.risk)
      .toContain("Young upstream project");
    expect(Object.isFrozen(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY)).toBe(true);
    expect(Object.isFrozen(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY.surface))
      .toBe(true);
  });

  it("pins the failed full-size verdict and blocks identity-only product promotion", () => {
    const raw = JSON.parse(readFileSync(
      new URL("../../../../../../tests/benchmarks/results/libmypaint-fullsize.json", import.meta.url),
      "utf8",
    )) as {
      gate: {
        allQualityParityPass: boolean;
        hokusaiThroughputAdvantageMin: number;
        hokusaiPasses20pctGate: boolean;
        verdict: string;
      };
    };

    expect(STUDIO_HOKUSAI_FULLSIZE_PROMOTION_GATE).toMatchObject({
      artifact: "tests/benchmarks/results/libmypaint-fullsize.json",
      requiredThroughputRatio: 1.2,
      observedMinimumThroughputRatio: raw.gate.hokusaiThroughputAdvantageMin,
      allQualityParityPass: raw.gate.allQualityParityPass,
      hokusaiPasses20pctGate: raw.gate.hokusaiPasses20pctGate,
      verdict: raw.gate.verdict,
      libmypaintRole: "benchmark-reference-only-not-product-fallback",
    });
    expect(STUDIO_HOKUSAI_PRODUCT_PROMOTED_PRESETS).toEqual([]);

    expect(resolveStudioHokusaiProductLiveAdmission({
      brushId: "pencil",
      catalogId: "pencil",
    })).toEqual({
      status: "blocked",
      reason: "fullsize-quality-gate-failed",
      retainBackend: "existing-exact-product-route",
      userVisibleStatus: "experimental-quality-gate-blocked",
      noProductLibmypaintFallback: true,
    });
  });

  it("forbids cross-engine product fallback (no Hokusai→MyPaint→Skia ladder)", () => {
    expect(STUDIO_BRUSH_CROSS_ENGINE_PRODUCT_FALLBACK_POLICY).toMatchObject({
      allowed: false,
      unavailableBehavior: "fail-closed",
      emitApproximation: false,
      midStrokeProviderSwitchAllowed: false,
      performanceDrivenSilentReplaceAllowed: false,
      libmypaintRole: "benchmark-reference-only-not-product-fallback",
    });
    expect(STUDIO_BRUSH_CROSS_ENGINE_PRODUCT_FALLBACK_POLICY.forbidden)
      .toContain("cross-engine-natural-media-fallback");
    expect(STUDIO_BRUSH_CROSS_ENGINE_PRODUCT_FALLBACK_POLICY.forbidden)
      .toContain("silent-backend-substitution");
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY.rollout.benchmarkReferenceIsProductFallback)
      .toBe(false);
    expect(STUDIO_HOKUSAI_MYB_PROVIDER_POLICY.rollout.midStrokeProviderSwitchAllowed)
      .toBe(false);

    for (const policy of Object.values(STUDIO_BRUSH_BACKEND_FAMILY_POLICIES)) {
      expect(policy.unavailablePolicy).toEqual({
        behavior: "fail-closed",
        preserveExistingSurface: true,
        emitApproximation: false,
      });
      expect(policy.forbiddenFallbacks)
        .toContain("cross-engine-natural-media-fallback");
      expect(policy.forbiddenFallbacks)
        .toContain("silent-backend-substitution");
    }
  });

  it("adopts engines texture-first, then optimize, then deliberate pin replace", () => {
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.primaryGoal).toBe("texture-fidelity");
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.secondaryGoal)
      .toBe("performance-on-pinned-engine");
    expect([...STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.order]).toEqual([
      "texture-first-hybrid-pin",
      "optimize-same-pin",
      "deliberate-pin-replace-after-lab-evidence",
    ]);
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.pinReplaceRequires)
      .toContain("texture-quality-gate-pass-or-not-worse");
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.pinReplaceRequires)
      .toContain("no-silent-backend-substitution");
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.forbid).toContain(
      "choose-weaker-texture-engine-only-for-speed-before-optimization",
    );
    expect(STUDIO_BRUSH_ENGINE_PRIORITY_POLICY.forbid).toContain(
      "silent-cross-engine-fallback-on-failure",
    );
  });

  it("admits Hokusai only when the caller carries an explicit experimental choice", () => {
    expect(resolveStudioHokusaiProductLiveAdmission({
      brushId: "charcoal",
      catalogId: "charcoal",
      explicitExperimentalOptIn: true,
    })).toEqual({
      status: "admitted",
      mode: "experimental-explicit-opt-in",
      presetId: "charcoal",
      userVisibleStatus: "experimental",
    });
    expect(resolveStudioHokusaiProductLiveAdmission({
      brushId: "gpen",
      explicitExperimentalOptIn: true,
    })).toMatchObject({
      status: "blocked",
      reason: "identity-not-supported",
      noProductLibmypaintFallback: true,
    });
  });

  it("fails closed for the retired adapter v1 opt-in metadata", () => {
    const retiredV1OptIn = {
      backendId: "hokusai-myb-worker",
      mode: "settled",
      engineVersion: "0.3.0",
      adapterVersion: "0.3.0-transparent-dirty-tile-adapter.1",
      customBinding: "toonspectrum-transparent-dirty-tile",
      surfaceContract: "transparent-straight-rgba8-dirty-tiles",
    } as unknown as StudioHokusaiMybProviderOptIn;

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: retiredV1OptIn,
    })).toMatchObject({
      status: "rejected",
      reason: "provider-opt-in-invalid",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });

  it("does not alter any default brush route even when the provider is ready", () => {
    const availability = availabilitySnapshot("ready");
    const routeIds = Object.values(STUDIO_BRUSH_BACKEND_ROUTE_CANDIDATES)
      .flatMap((candidates) => candidates)
      .flatMap(({ live, commit }) => [live, commit]);
    expect(routeIds).not.toContain("hokusai-myb-worker");

    for (const { id } of STUDIO_ALL_BRUSH_CATALOG_ITEMS) {
      const route = resolveStudioBrushBackendQualityRoute({
        catalogId: id,
        availability,
      });
      expect(route.status, id).toBe("ready");
      if (route.status !== "ready") continue;
      expect(route.liveBackend, id).not.toBe("hokusai-myb-worker");
      expect(route.commitBackend, id).not.toBe("hokusai-myb-worker");
      expect(route.settledEnhancer, id).toBeUndefined();
      expect(route.providerOptInMode, id).toBeUndefined();
    }
  });

  it("admits settled conversion only after explicit opt-in and ready runtime", () => {
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: hokusaiOptIn(),
    })).toMatchObject({
      status: "ready",
      liveBackend: "canvas2d-dynamic-coverage",
      commitBackend: "canvas2d-dynamic-coverage",
      settledEnhancer: "hokusai-myb-worker",
      providerOptInMode: "settled",
    });

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability: {
        "hokusai-myb-worker": "loading",
      },
      naturalMediaProviderOptIn: hokusaiOptIn(),
    })).toMatchObject({
      status: "pending",
      reason: "backend-loading",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });

  it("admits the live provider only with every parity, transfer, epoch and cancellation receipt", () => {
    const forgedLiveOptIn = {
      ...hokusaiOptIn(),
      mode: "live",
    } as unknown as StudioHokusaiMybProviderOptIn;
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "watercolor",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: forgedLiveOptIn,
    })).toMatchObject({
      status: "rejected",
      reason: "provider-opt-in-invalid",
      preserveExistingSurface: true,
      emitApproximation: false,
    });

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "charcoal",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: hokusaiLiveOptIn(),
    })).toMatchObject({
      status: "ready",
      liveBackend: "hokusai-myb-worker",
      commitBackend: "hokusai-myb-worker",
      semanticContract: "hokusai-live-canonical-v1",
      providerOptInMode: "live",
    });

    const missingBackpressure = {
      ...hokusaiLiveOptIn(),
      admission: {
        ...(hokusaiLiveOptIn() as Extract<
          StudioHokusaiMybProviderOptIn,
          { mode: "live" }
        >).admission,
        singleInFlightFrame: false,
      },
    } as unknown as StudioHokusaiMybProviderOptIn;
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "marker",
      availability: { "hokusai-myb-worker": "ready" },
      naturalMediaProviderOptIn: missingBackpressure,
    })).toMatchObject({
      status: "rejected",
      reason: "provider-opt-in-invalid",
    });
  });

  it("rejects wrong versions, non-natural families and unavailable opt-in runtimes", () => {
    const wrongVersion = {
      ...hokusaiOptIn(),
      engineVersion: "0.3.1",
    } as unknown as StudioHokusaiMybProviderOptIn;
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: wrongVersion,
    })).toMatchObject({
      status: "rejected",
      reason: "provider-opt-in-invalid",
    });
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "gpen",
      availability: {
        "hokusai-myb-worker": "ready",
      },
      naturalMediaProviderOptIn: hokusaiOptIn(),
    })).toMatchObject({
      status: "rejected",
      reason: "provider-family-ineligible",
    });
    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability: {
        "hokusai-myb-worker": "failed",
      },
      naturalMediaProviderOptIn: hokusaiOptIn(),
    })).toMatchObject({
      status: "rejected",
      reason: "backend-unavailable",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });
});

describe("studio brush backend availability", () => {
  it("routes the basic G-pen to the statically ready outline backend", () => {
    expect(resolveStudioBrushBackendQualityRoute({ brushId: "gpen" }))
      .toMatchObject({
        status: "ready",
        liveBackend: "perfect-freehand-outline",
        commitBackend: "perfect-freehand-outline",
        semanticContract: "perfect-outline-profile-v1",
      });

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "gpen",
      availability: { "perfect-freehand-outline": "ready" },
    })).toMatchObject({
      status: "ready",
      liveBackend: "perfect-freehand-outline",
      commitBackend: "perfect-freehand-outline",
      semanticContract: "perfect-outline-profile-v1",
    });
  });

  it("fails closed for dry media when only the forbidden causal round carrier is ready", () => {
    const availability = availabilitySnapshot("unavailable");
    availability["canvas2d-causal-ink"] = "ready";

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "chalk",
      availability,
    })).toMatchObject({
      status: "rejected",
      reason: "backend-unavailable",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });

  it("routes causal watercolor to the exact ribbon pair while physical WebGPU is unavailable", () => {
    expect(resolveStudioBrushBackendQualityRoute({ brushId: "watercolor" }))
      .toMatchObject({
        status: "ready",
        liveBackend: "canvas2d-wet-ribbon",
        commitBackend: "canvas2d-wet-ribbon",
        semanticContract: "wet-ribbon-carrier-v2",
      });

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "watercolor",
      availability: {
        "canonical-webgpu-wet-specialist": "ready",
        "canvas2d-wet-field": "unavailable",
        "canvas2d-wet-ribbon": "ready",
      },
    })).toMatchObject({
      status: "ready",
      liveBackend: "canonical-webgpu-wet-specialist",
      commitBackend: "canonical-webgpu-wet-specialist",
      semanticContract: "canonical-pigment-water-v1",
    });

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "watercolor",
      availability: {
        // The synchronous physical field is retained only as an implementation artifact. A
        // caller cannot promote it back into the product route and reintroduce multi-second
        // main-thread simulation or tiled seams.
        "canvas2d-wet-field": "ready",
        "canvas2d-wet-ribbon": "unavailable",
        "canonical-webgpu-wet-specialist": "unavailable",
      },
    })).toMatchObject({
      status: "rejected",
      reason: "backend-unavailable",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });

  it("uses an approved exact fallback pair and never a live-only approximation", () => {
    const availability = availabilitySnapshot("unavailable");
    availability["webgpu-live-causal-ink"] = "failed";
    availability["canvas2d-causal-ink"] = "ready";

    expect(resolveStudioBrushBackendQualityRoute({
      brushId: "pen",
      availability,
    })).toMatchObject({
      status: "ready",
      liveBackend: "canvas2d-causal-ink",
      commitBackend: "canvas2d-causal-ink",
      semanticContract: "causal-ink-residual-v3",
    });
  });

  it("keeps mixer preview non-authoritative until its pixel transaction backend is ready", () => {
    expect(resolveStudioBrushBackendQualityRoute({ operation: "mix" }))
      .toMatchObject({
        status: "pending",
        reason: "backend-loading",
        preserveExistingSurface: true,
        emitApproximation: false,
      });

    expect(resolveStudioBrushBackendQualityRoute({
      operation: "mix",
      availability: {
        "deferred-raster-tool-preview": "ready",
        "pixel-edit-worker": "ready",
      },
    })).toMatchObject({
      status: "ready",
      liveBackend: "deferred-raster-tool-preview",
      commitBackend: "pixel-edit-worker",
      semanticContract: "raster-mix-transaction-v1",
    });
  });

  it("rejects unknown, mismatched and invalid identities without touching the surface", () => {
    expect(resolveStudioBrushBackendQualityRoute({ brushId: "not-a-brush" }))
      .toEqual({
        status: "rejected",
        reason: "unknown-brush",
        preserveExistingSurface: true,
        emitApproximation: false,
      });
    expect(resolveStudioBrushBackendQualityRoute({
      catalogId: "gpen",
      brushId: "pen",
    })).toEqual({
      status: "rejected",
      reason: "identity-mismatch",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
    expect(resolveStudioBrushBackendQualityRoute({
      operation: "retouch",
      brushId: "pen",
    })).toEqual({
      status: "rejected",
      reason: "invalid-operation",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });
});
