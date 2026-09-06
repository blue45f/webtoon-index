import { describe, expect, it } from "vitest";

import {
  scoreStudioHybridEnginePlan,
  STUDIO_HYBRID_ENGINE_CONTRACT_REVISION,
  STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES,
  validateStudioHybridEnginePlan,
  type StudioHybridAuthorityRole,
  type StudioHybridCanonicalFormat,
  type StudioHybridEnginePlan,
  type StudioHybridEngineProvider,
  type StudioHybridSpecialistRole,
  type StudioHybridSurfaceContract,
} from "./studio-hybrid-engine-contract";

function canonicalBoundary(
  formats: readonly StudioHybridCanonicalFormat[],
) {
  return {
    vendorNeutral: true as const,
    structuredCloneOnly: true as const,
    opaqueRuntimeHandles: "forbidden" as const,
    accepts: [...formats],
    emits: [...formats],
  };
}

function provider(input: {
  id: string;
  authorityRoles?: readonly StudioHybridAuthorityRole[];
  specialistRoles?: readonly StudioHybridSpecialistRole[];
  locality?: StudioHybridEngineProvider["locality"];
  dependencies?: readonly string[];
  formats?: readonly StudioHybridCanonicalFormat[];
  surface?: StudioHybridSurfaceContract | null;
  colorPrecision?: StudioHybridEngineProvider["colorPrecision"];
  implementation?: StudioHybridEngineProvider["implementation"];
  bundleBytes?: number | null;
}): StudioHybridEngineProvider {
  const deviceDependent = input.surface?.gpuContext !== null
    && input.surface !== null
    && input.surface !== undefined;
  return {
    id: input.id,
    label: `${input.id} provider`,
    implementation: input.implementation ?? "application-core",
    bundleBytes:
      "bundleBytes" in input ? input.bundleBytes ?? null : 1_000_000,
    availability: {
      installation: "installed",
      probe: "verified-supported",
      checkedAtEpochMilliseconds: 1_785_168_000_000,
      detail: "Verified by the test runtime adapter.",
    },
    authorityRoles: input.authorityRoles ?? [],
    specialistRoles: input.specialistRoles ?? [],
    locality: input.locality ?? "engine-worker",
    dependencies: input.dependencies ?? [],
    canonicalBoundary: canonicalBoundary(
      input.formats ?? ["asset-reference-v1"],
    ),
    surface: input.surface ?? null,
    determinism: {
      mode: "deterministic",
      replay: "exact",
      export: "lossless",
    },
    colorPrecision: input.colorPrecision ?? "rgba16-float",
    linearColorWorkflow: true,
    deviceRecovery: deviceDependent
      ? {
          deviceDependent: true,
          lossDetection:
            input.surface?.gpuContext?.api === "webgpu"
              ? "device-lost-promise"
              : "context-event",
          recovery: "recreate-from-canonical",
          canonicalReplayRequired: true,
        }
      : {
          deviceDependent: false,
          lossDetection: "not-applicable",
          recovery: "not-applicable",
          canonicalReplayRequired: false,
        },
    quality: {
      fidelity: 94,
      interactiveLatency: 91,
      exportFidelity: 96,
      replayReliability: 95,
      recoveryResilience: 92,
    },
  };
}

function validProviders(): StudioHybridEngineProvider[] {
  return [
    provider({
      id: "toonspectrum-tiledoc",
      authorityRoles: ["raster-document"],
      formats: ["raster-tiles-v1"],
      dependencies: ["raw-webgpu"],
    }),
    provider({
      id: "toonspectrum-vector-schema",
      authorityRoles: ["vector-document"],
      formats: ["vector-scene-v1"],
      dependencies: ["canvaskit-wasm", "geometry-kernel"],
      colorPrecision: "vector-exact",
    }),
    provider({
      id: "toonspectrum-text-layout",
      authorityRoles: ["text-layout"],
      formats: ["text-runs-v1"],
      dependencies: ["harfbuzz-wasm"],
      colorPrecision: "vector-exact",
    }),
    provider({
      id: "toonspectrum-scene-schema",
      authorityRoles: ["3d-scene"],
      formats: ["scene3d-v1"],
      dependencies: ["three-scene", "rapier-wasm"],
    }),
    provider({
      id: "toonspectrum-journal",
      authorityRoles: ["history/persistence"],
      formats: ["history-log-v1", "asset-reference-v1"],
      locality: "storage-worker",
      colorPrecision: "not-applicable",
      implementation: "storage-adapter",
      bundleBytes: null,
    }),
    provider({
      id: "raw-webgpu",
      specialistRoles: ["raster-render", "raster-fx"],
      formats: ["raster-tiles-v1"],
      surface: {
        surfaceId: "main-raster-surface",
        ownsSurface: true,
        gpuContext: {
          contextId: "main-webgpu-context",
          api: "webgpu",
          sharing: "exclusive",
          compatibilityKey: "probed-raw-webgpu-v1",
        },
      },
      implementation: "native-browser",
    }),
    provider({
      id: "geometry-kernel",
      specialistRoles: ["vector-geometry"],
      formats: ["vector-scene-v1"],
      locality: "wasm-worker",
      implementation: "wasm-library",
    }),
    provider({
      id: "canvaskit-wasm",
      specialistRoles: ["vector-quality", "text-raster"],
      formats: ["vector-scene-v1", "text-runs-v1"],
      locality: "wasm-worker",
      dependencies: ["geometry-kernel"],
      colorPrecision: "vector-exact",
      implementation: "wasm-library",
      surface: {
        surfaceId: "vector-quality-surface",
        ownsSurface: true,
        gpuContext: {
          contextId: "canvaskit-context",
          api: "webgl2",
          sharing: "exclusive",
          compatibilityKey: "probed-canvaskit-context-v1",
        },
      },
    }),
    provider({
      id: "harfbuzz-wasm",
      specialistRoles: ["text-shaping"],
      formats: ["text-runs-v1"],
      locality: "wasm-worker",
      colorPrecision: "vector-exact",
      implementation: "wasm-library",
    }),
    provider({
      id: "three-scene",
      specialistRoles: ["3d-render", "animation"],
      formats: ["scene3d-v1", "animation-timeline-v1"],
      surface: {
        surfaceId: "scene-3d-surface",
        ownsSurface: true,
        gpuContext: {
          contextId: "scene-webgpu-context",
          api: "webgpu",
          sharing: "exclusive",
          compatibilityKey: "probed-three-webgpu-v1",
        },
      },
      implementation: "js-library",
    }),
    provider({
      id: "rapier-wasm",
      specialistRoles: ["physics"],
      formats: ["scene3d-v1", "physics-state-v1"],
      locality: "wasm-worker",
      implementation: "wasm-library",
    }),
    provider({
      id: "pixi-renderer",
      specialistRoles: ["animation", "raster-fx"],
      formats: ["raster-tiles-v1", "animation-timeline-v1"],
      surface: {
        surfaceId: "pixi-preview-surface",
        ownsSurface: true,
        gpuContext: {
          contextId: "pixi-preview-context",
          api: "webgpu",
          sharing: "exclusive",
          compatibilityKey: "probed-pixi-context-v1",
        },
      },
      implementation: "js-library",
    }),
    provider({
      id: "image-codecs",
      specialistRoles: ["codecs", "image-analysis"],
      formats: ["encoded-image-v1", "analysis-mask-v1"],
      locality: "wasm-worker",
      implementation: "wasm-library",
    }),
  ];
}

function validPlan(
  providers = validProviders(),
  planId = "hybrid-quality-v1",
): StudioHybridEnginePlan {
  return {
    contractRevision: STUDIO_HYBRID_ENGINE_CONTRACT_REVISION,
    planId,
    providers,
    requirements: {
      deterministicReplay: true,
      exportRequired: true,
      recoverFromDeviceLoss: true,
      minimumColorPrecision: "rgba16-float",
    },
  };
}

describe("Studio hybrid engine authority and provider contract", () => {
  it("accepts a structured-cloned quality-first hybrid plan", () => {
    const validated = validateStudioHybridEnginePlan(
      structuredClone(validPlan()),
    );
    expect(validated).toMatchObject({
      ok: true,
      authorityProviderIds: {
        "raster-document": "toonspectrum-tiledoc",
        "vector-document": "toonspectrum-vector-schema",
        "text-layout": "toonspectrum-text-layout",
        "3d-scene": "toonspectrum-scene-schema",
        "history/persistence": "toonspectrum-journal",
      },
    });
    if (!validated.ok) return;
    expect(
      validated.dependencyOrder.indexOf("geometry-kernel"),
    ).toBeLessThan(
      validated.dependencyOrder.indexOf("canvaskit-wasm"),
    );
    expect(
      validated.dependencyOrder.indexOf("three-scene"),
    ).toBeLessThan(
      validated.dependencyOrder.indexOf("toonspectrum-scene-schema"),
    );
  });

  it("rejects malformed and future contract revisions", () => {
    expect(
      validateStudioHybridEnginePlan({
        ...validPlan(),
        contractRevision: 2,
      }),
    ).toEqual({
      ok: false,
      reason: "future-contract-revision",
      path: "contractRevision",
    });
    expect(
      validateStudioHybridEnginePlan({
        ...validPlan(),
        vendorGpuDevice: {},
      }),
    ).toEqual({
      ok: false,
      reason: "malformed-plan",
      path: "$",
    });
  });

  it("requires every authority exactly once", () => {
    expect(
      validateStudioHybridEnginePlan(
        validPlan(
          validProviders().filter(
            (entry) => entry.id !== "toonspectrum-journal",
          ),
        ),
      ),
    ).toMatchObject({
      ok: false,
      reason: "missing-authority",
      detail: "history/persistence",
    });

    const duplicate = provider({
      id: "toonspectrum-second-raster-authority",
      authorityRoles: ["raster-document"],
      formats: ["raster-tiles-v1"],
    });
    expect(
      validateStudioHybridEnginePlan(
        validPlan([...validProviders(), duplicate]),
      ),
    ).toMatchObject({
      ok: false,
      reason: "duplicate-authority",
    });
  });

  it("rejects duplicate IDs and providers without verified availability", () => {
    const providers = validProviders();
    expect(
      validateStudioHybridEnginePlan(
        validPlan([...providers, providers[0] as StudioHybridEngineProvider]),
      ),
    ).toMatchObject({
      ok: false,
      reason: "duplicate-provider-id",
    });

    const unavailable: StudioHybridEngineProvider = {
      ...providers[0],
      availability: {
        installation: "not-installed" as const,
        probe: "not-run" as const,
        checkedAtEpochMilliseconds: null,
        detail: "Candidate only.",
      },
    };
    expect(
      validateStudioHybridEnginePlan(
        validPlan([unavailable, ...providers.slice(1)]),
      ),
    ).toMatchObject({
      ok: false,
      reason: "provider-unavailable",
      detail: "toonspectrum-tiledoc",
    });
  });

  it("never permits an external runtime to become canonical authority", () => {
    const providers = validProviders().map((entry) =>
      entry.id === "raw-webgpu"
        ? {
            ...entry,
            authorityRoles: ["raster-document" as const],
          }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(providers)),
    ).toMatchObject({
      ok: false,
      reason: "invalid-provider",
      detail:
        "canonical authority must be a ToonSpectrum application-core or storage-adapter provider",
    });
  });

  it("requires every authority to emit its vendor-neutral canonical format", () => {
    const providers = validProviders().map((entry) =>
      entry.id === "toonspectrum-vector-schema"
        ? {
            ...entry,
            canonicalBoundary: canonicalBoundary([
              "asset-reference-v1",
            ]),
          }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(providers)),
    ).toMatchObject({
      ok: false,
      reason: "invalid-provider",
      detail: "vector-document:vector-scene-v1",
    });
  });

  it("forbids opaque vendor handles in canonical boundaries", () => {
    const providers = validProviders();
    const corrupted = {
      ...providers[0],
      canonicalBoundary: {
        ...providers[0]?.canonicalBoundary,
        opaqueRuntimeHandles: "allowed",
        gpuDevice: {},
      },
    };
    expect(
      validateStudioHybridEnginePlan(
        validPlan([corrupted as never, ...providers.slice(1)]),
      ),
    ).toMatchObject({
      ok: false,
      reason: "invalid-provider",
      path: "providers[0]",
    });
  });
});

describe("Studio hybrid dependency and surface safety", () => {
  it("rejects missing dependencies and dependency cycles", () => {
    const missing = validProviders().map((entry) =>
      entry.id === "image-codecs"
        ? { ...entry, dependencies: ["missing-codec-runtime"] }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(missing)),
    ).toMatchObject({
      ok: false,
      reason: "missing-dependency",
      detail: "missing-codec-runtime",
    });

    const cyclic = validProviders().map((entry) => {
      if (entry.id === "raw-webgpu") {
        return { ...entry, dependencies: ["pixi-renderer"] };
      }
      if (entry.id === "pixi-renderer") {
        return { ...entry, dependencies: ["raw-webgpu"] };
      }
      return entry;
    });
    expect(
      validateStudioHybridEnginePlan(validPlan(cyclic)),
    ).toMatchObject({
      ok: false,
      reason: "dependency-cycle",
    });
  });

  it("rejects duplicate surface owners", () => {
    const providers = validProviders().map((entry) =>
      entry.id === "pixi-renderer" && entry.surface
        ? {
            ...entry,
            surface: {
              ...entry.surface,
              surfaceId: "main-raster-surface",
              ownsSurface: true,
            },
          }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(providers)),
    ).toMatchObject({
      ok: false,
      reason: "duplicate-surface-owner",
    });
  });

  it("rejects incompatible providers claiming one shared GPU context", () => {
    const providers = validProviders().map((entry) =>
      entry.id === "pixi-renderer" && entry.surface?.gpuContext
        ? {
            ...entry,
            surface: {
              ...entry.surface,
              surfaceId: "main-raster-surface",
              ownsSurface: false,
              gpuContext: {
                ...entry.surface.gpuContext,
                contextId: "main-webgpu-context",
                sharing: "shared" as const,
                compatibilityKey: "unverified-pixi-context",
              },
            },
          }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(providers)),
    ).toMatchObject({
      ok: false,
      reason: "incompatible-shared-context",
      detail: "main-webgpu-context",
    });
  });

  it("rejects authority providers that cannot satisfy replay requirements", () => {
    const providers = validProviders().map((entry) =>
      entry.id === "toonspectrum-scene-schema"
        ? {
            ...entry,
            determinism: {
              ...entry.determinism,
              mode: "best-effort" as const,
              replay: "bounded" as const,
            },
          }
        : entry
    );
    expect(
      validateStudioHybridEnginePlan(validPlan(providers)),
    ).toMatchObject({
      ok: false,
      reason: "determinism-requirement-unsatisfied",
      path: "providers.toonspectrum-scene-schema.determinism",
    });
  });
});

describe("Studio hybrid quality-first scoring and candidate truthfulness", () => {
  it("does not use bundle bytes as a score or rejection criterion", () => {
    const baseline = validateStudioHybridEnginePlan(validPlan());
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    const hugeBundles = validProviders().map((entry, index) => ({
      ...entry,
      bundleBytes: (index + 1) * 500_000_000,
    }));
    const huge = validateStudioHybridEnginePlan(
      validPlan(hugeBundles, "hybrid-huge-bundles"),
    );
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;

    const baselineScore = scoreStudioHybridEnginePlan(baseline);
    const hugeScore = scoreStudioHybridEnginePlan(huge);
    expect(hugeScore.total).toBe(baselineScore.total);
    expect(hugeScore.fidelity).toBe(baselineScore.fidelity);
    expect(hugeScore.diagnostics.knownBundleBytes).not.toBe(
      baselineScore.diagnostics.knownBundleBytes,
    );
    expect(baselineScore.diagnostics).toMatchObject({
      hasUnknownBundleBytes: true,
      providerCount: 13,
      localities: {
        "engine-worker": 7,
        "wasm-worker": 5,
        "storage-worker": 1,
      },
    });
  });

  it("lists desired library combinations only as unprobed candidates", () => {
    expect(
      STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES.map(
        (candidate) => candidate.id,
      ),
    ).toEqual([
      "raw-webgpu",
      "canvaskit-wasm",
      "pixi-renderer",
      "geometry-kernel",
      "harfbuzz-wasm",
      "three-scene",
      "rapier-wasm",
    ]);
    expect(
      STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES.every(
        (candidate) => candidate.availability.probe === "not-run",
      ),
    ).toBe(true);
    expect(
      STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES.some(
        (candidate) =>
          candidate.availability.installation === "not-installed",
      ),
    ).toBe(true);
    expect(
      STUDIO_HYBRID_ENGINE_REFERENCE_CANDIDATES
        .filter((candidate) =>
          candidate.id === "three-scene"
          || candidate.id === "rapier-wasm"
        )
        .every(
          (candidate) =>
            candidate.availability.installation === "installed"
            && candidate.availability.probe === "not-run",
        ),
    ).toBe(true);
  });
});
