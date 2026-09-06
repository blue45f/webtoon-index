import {
  RemoteKillSwitch,
  WinnerCache,
  evaluateLicenseGate,
} from "@toonspectrum/studio-engine-registry";
import { beforeEach, describe, expect, it } from "vitest";


import {
  STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT,
} from "./brush/studio-brush-backend-quality-policy";
import {
  studioStrokeRouteBucket,
  studioStrokeRouteProviderId,
  type StudioStrokeRouteWorkloadTraits,
} from "./brush/studio-stroke-route-tournament";
import {
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY,
  type StudioHokusaiStrokeSurfaceSupport,
  type StudioStrokeSurfaceProviderState,
  type StudioStrokeSurfaceRouteKind,
  type StudioStrokeSurfaceRouteSnapshotInput,
} from "./brush/studio-stroke-surface-route";
import {
  STUDIO_V11_NON_PROVIDER_BACKENDS,
  deriveStudioV11BackendDescriptors,
} from "./render/studio-engine-provider-bridge";
import {
  admittedLanes,
  deriveStudioStrokeSurfaceCostFingerprint,
  planStudioStrokeSurfaceShadow,
  readStudioSurfaceCostShadowReceipt,
  resetStudioSurfaceCostShadowReceipt,
  type StudioStrokeSurfaceShadowTournamentProbe,
} from "./studio-surface-plan-shadow";

/**
 * V11 strangler gate (ADR 0001 개정): the shadow HybridExecutionPlanner must
 * reproduce the legacy stroke-surface ladder for the ENTIRE admission-snapshot
 * state space before any real routing is delegated. 8,192 exhaustive
 * combinations keep this cheap (<1s) and leave no sampled blind spots.
 */

const PROVIDER_STATES: readonly StudioStrokeSurfaceProviderState[] = [
  "failed",
  "loading",
  "ready",
  "unavailable",
];
const HOKUSAI_SURFACES: readonly StudioHokusaiStrokeSurfaceSupport[] = [
  "flip-unsupported",
  "rotation-unsupported",
  "supported",
  "unavailable",
];
const BOOLEANS = [false, true] as const;

function snapshot(
  overrides: Partial<StudioStrokeSurfaceRouteSnapshotInput>,
): StudioStrokeSurfaceRouteSnapshotInput {
  return {
    strokeId: "stroke-1",
    pointerId: 1,
    strokeEpoch: 3,
    livingInk: {
      eligible: false,
      providerState: "unavailable",
      capabilitiesAccepted: false,
      admitted: false,
    },
    hokusai: { admitted: false, surface: "unavailable" },
    stampAdmitted: false,
    gpuAdmitted: false,
    liveInkAdmitted: false,
    wetInkAdmitted: false,
    dynamicAdmitted: false,
    ...overrides,
  };
}

describe("V11 shadow planner parity (existing studio ladder)", () => {
  it("agrees with resolveStudioStrokeSurfaceRoute across all 8192 admission states", () => {
    let total = 0;
    const reached = new Map<StudioStrokeSurfaceRouteKind, number>();
    for (const eligible of BOOLEANS) {
      for (const providerState of PROVIDER_STATES) {
        for (const capabilitiesAccepted of BOOLEANS) {
          for (const livingAdmitted of BOOLEANS) {
            for (const hokusaiAdmitted of BOOLEANS) {
              for (const surface of HOKUSAI_SURFACES) {
                for (const stampAdmitted of BOOLEANS) {
                  for (const gpuAdmitted of BOOLEANS) {
                    for (const liveInkAdmitted of BOOLEANS) {
                      for (const wetInkAdmitted of BOOLEANS) {
                        for (const dynamicAdmitted of BOOLEANS) {
                          const input = snapshot({
                            livingInk: {
                              eligible,
                              providerState,
                              capabilitiesAccepted,
                              admitted: livingAdmitted,
                            },
                            hokusai: { admitted: hokusaiAdmitted, surface },
                            stampAdmitted,
                            gpuAdmitted,
                            liveInkAdmitted,
                            wetInkAdmitted,
                            dynamicAdmitted,
                          });
                          const result = planStudioStrokeSurfaceShadow(input);
                          if (!result.agrees) {
                            throw new Error(
                              `parity break: legacy=${result.legacyKind} planner=${result.plannedKind} for ${JSON.stringify(input)}`,
                            );
                          }
                          reached.set(
                            result.legacyKind,
                            (reached.get(result.legacyKind) ?? 0) + 1,
                          );
                          total += 1;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(total).toBe(8192);
    // Every lane of the ladder must be reachable in the enumeration —
    // otherwise the parity claim silently shrinks.
    for (const kind of STUDIO_STROKE_SURFACE_ROUTE_PRIORITY) {
      expect(reached.get(kind) ?? 0, `lane ${kind} reachable`).toBeGreaterThan(0);
    }
  });

  it("routes invalid pointerdown identity to konva like the legacy resolver", () => {
    const result = planStudioStrokeSurfaceShadow(
      snapshot({ strokeId: "  ", stampAdmitted: true }),
    );
    expect(result.legacyKind).toBe("konva");
    expect(result.plannedKind).toBe("konva");
    expect(result.agrees).toBe(true);
  });

  it("planner output binds only the initially selected capability lane", () => {
    const result = planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
    );
    expect(result.plannedKind).toBe("gpu");
    expect(result.plan.islands[0]).toMatchObject({
      islandId: "live-stroke",
      providerId: "stroke-route-gpu",
    });
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
  });
});

describe("V11 descriptor bridge (backend audit → ProviderDescriptor)", () => {
  it("derives a valid descriptor for every audited backend except documented non-providers", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    expect(descriptors).toHaveLength(
      STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.length -
        STUDIO_V11_NON_PROVIDER_BACKENDS.length,
    );
    const ids = descriptors.map((descriptor) => descriptor.id);
    for (const excluded of STUDIO_V11_NON_PROVIDER_BACKENDS) {
      expect(ids).not.toContain(excluded);
    }
  });

  it("every derived license passes the V11 hard gate (bundle or isolated)", () => {
    for (const descriptor of deriveStudioV11BackendDescriptors()) {
      const gate = evaluateLicenseGate(descriptor.license);
      expect(gate.mode, `${descriptor.id} license ${descriptor.license}`).not.toBe(
        "rejected",
      );
    }
  });

  it("pixel authority maps to surface.primary exactly for authoritative backends", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
    for (const entry of STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT) {
      const descriptor = byId.get(entry.id);
      if (!descriptor) continue;
      expect(
        descriptor.capabilities.includes("surface.primary"),
        `${entry.id} surface.primary`,
      ).toBe(entry.brushPixelAuthority);
    }
  });

  it("derived descriptors declare terminal provider failure without fallback links", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    for (const descriptor of descriptors) {
      expect(descriptor).not.toHaveProperty("fallbackProviderId");
      expect(descriptor.limitations).toContain(
        "provider failure is terminal for this binding; no automatic backend substitution",
      );
    }
  });
});

/**
 * V12 §5 observation-only seam: an optional tournament probe projects the
 * winner cache + kill switch onto the admitted ladder without ever feeding
 * back into the parity verdict. The exhaustive case pins the backwards
 * contract — with pristine tournament state the shadow output is invariant
 * over the full 8,192-state admission space, and the observation reports the
 * admitted ladder unchanged.
 */

function* allAdmissionSnapshots(): Generator<StudioStrokeSurfaceRouteSnapshotInput> {
  for (const eligible of BOOLEANS) {
    for (const providerState of PROVIDER_STATES) {
      for (const capabilitiesAccepted of BOOLEANS) {
        for (const livingAdmitted of BOOLEANS) {
          for (const hokusaiAdmitted of BOOLEANS) {
            for (const surface of HOKUSAI_SURFACES) {
              for (const stampAdmitted of BOOLEANS) {
                for (const gpuAdmitted of BOOLEANS) {
                  for (const liveInkAdmitted of BOOLEANS) {
                    for (const wetInkAdmitted of BOOLEANS) {
                      for (const dynamicAdmitted of BOOLEANS) {
                        yield snapshot({
                          livingInk: {
                            eligible,
                            providerState,
                            capabilitiesAccepted,
                            admitted: livingAdmitted,
                          },
                          hokusai: { admitted: hokusaiAdmitted, surface },
                          stampAdmitted,
                          gpuAdmitted,
                          liveInkAdmitted,
                          wetInkAdmitted,
                          dynamicAdmitted,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

describe("V12 §5 tournament probe on the shadow planner (observation only)", () => {
  const TRAITS: StudioStrokeRouteWorkloadTraits = {
    pointCount: 40,
    brushFamily: "wet-ink",
    canvasScale: 1,
  };

  function pristineProbe(): StudioStrokeSurfaceShadowTournamentProbe {
    return {
      traits: TRAITS,
      state: {
        deviceHash: "device-a",
        winnerCache: new WinnerCache(),
        killSwitch: new RemoteKillSwitch(),
      },
    };
  }

  it("empty tournament state leaves the shadow output invariant across all 8192 states", () => {
    const probe = pristineProbe();
    let total = 0;
    for (const input of allAdmissionSnapshots()) {
      const base = planStudioStrokeSurfaceShadow(input);
      const observed = planStudioStrokeSurfaceShadow(input, probe);
      if (base.tournament !== null) {
        throw new Error("probe-less shadow result must carry no tournament observation");
      }
      if (
        base.legacyKind !== observed.legacyKind ||
        base.plannedKind !== observed.plannedKind ||
        base.agrees !== observed.agrees
      ) {
        throw new Error(
          `pristine probe changed the shadow verdict for ${JSON.stringify(input)}`,
        );
      }
      const observation = observed.tournament;
      if (observation === null) {
        throw new Error("probed shadow result must carry the tournament observation");
      }
      const admitted = admittedLanes(input);
      if (
        observation.lanes.join(",") !== admitted.join(",") ||
        observation.killedLanes.length !== 0 ||
        observation.promotedLane !== null ||
        observation.unavailableReason !== null
      ) {
        throw new Error(
          `pristine probe altered the admitted ladder for ${JSON.stringify(input)}`,
        );
      }
      if (observation.lanes[0] !== observed.plannedKind) {
        throw new Error(
          `observation head diverged from the planned lane for ${JSON.stringify(input)}`,
        );
      }
      total += 1;
    }
    expect(total).toBe(8192);
  });

  it("a winner probe reorders only the observation; verdict and plan stay legacy", () => {
    const probe = pristineProbe();
    probe.state.winnerCache.set(studioStrokeRouteBucket(TRAITS), "device-a", {
      providerId: studioStrokeRouteProviderId("dynamic"),
      expectedWarmMs: 2,
      decidedAtSample: 4,
    });
    const result = planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
      probe,
    );
    expect(result.legacyKind).toBe("gpu");
    expect(result.plannedKind).toBe("gpu");
    expect(result.agrees).toBe(true);
    expect(result.plan.islands[0]?.providerId).toBe("stroke-route-gpu");
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
    expect(result.tournament?.lanes).toEqual(["dynamic", "gpu", "konva"]);
    expect(result.tournament?.promotedLane).toBe("dynamic");
    expect(result.tournament?.bucket).toBe(studioStrokeRouteBucket(TRAITS));
  });

  it("a kill probe prunes the observed ladder while the legacy route is untouched", () => {
    const probe = pristineProbe();
    probe.state.killSwitch.kill(studioStrokeRouteProviderId("gpu"), "remote flag");
    const result = planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
      probe,
    );
    expect(result.legacyKind).toBe("gpu");
    expect(result.plannedKind).toBe("gpu");
    expect(result.tournament?.lanes).toEqual(["dynamic", "konva"]);
    expect(result.tournament?.killedLanes).toEqual(["gpu"]);
    expect(result.tournament?.unavailableReason).toBeNull();
  });

  it("all-killed observation is unavailable without changing legacy authority", () => {
    const probe = pristineProbe();
    for (const kind of ["gpu", "dynamic", "konva"] as const) {
      probe.state.killSwitch.kill(studioStrokeRouteProviderId(kind), "panic");
    }
    const result = planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
      probe,
    );
    expect(result.legacyKind).toBe("gpu");
    expect(result.plannedKind).toBe("gpu");
    expect(result.tournament?.lanes).toEqual([]);
    expect(result.tournament?.killedLanes).toEqual(["gpu", "dynamic", "konva"]);
    expect(result.tournament?.unavailableReason).toBe("all-providers-killed");
  });
});

/**
 * V13 §2.5 cost shadow: the shadow plan runs through planWithCostShadow with
 * a workload fingerprint derived from the probe's stroke traits — the only
 * scene signal this seam sees. Receipts must be total (every plan recorded)
 * and deterministic, absent inputs must fail closed, and nothing about the
 * legacy/planned verdict may change (the 8192-state parity above already runs
 * through the same wired path).
 */
describe("V13 §2.5 cost shadow receipts (observation only)", () => {
  const COST_TRAITS: StudioStrokeRouteWorkloadTraits = {
    pointCount: 640,
    brushFamily: "wet-ink",
    canvasScale: 2,
  };

  function costProbe(
    traits: StudioStrokeRouteWorkloadTraits,
  ): StudioStrokeSurfaceShadowTournamentProbe {
    return {
      traits,
      state: {
        deviceHash: "device-a",
        winnerCache: new WinnerCache(),
        killSwitch: new RemoteKillSwitch(),
      },
    };
  }

  beforeEach(() => {
    resetStudioSurfaceCostShadowReceipt();
  });

  it("probe traits populate the workload fingerprint on the receipt", () => {
    planStudioStrokeSurfaceShadow(snapshot({ gpuAdmitted: true }), costProbe(COST_TRAITS));
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(1);
    expect(receipt.absentFingerprint).toBe(0);
    expect(receipt.shadowFailures).toBe(0);
    expect(receipt.agreed + receipt.disagreed).toBe(1);
    const island = receipt.lastReceipt?.islands[0];
    expect(island?.legacyWinner).toBe("stroke-route-gpu");
    expect(island?.fingerprint).toEqual({
      pathCount: 1,
      segmentCount: 640,
      changedPathRatio: 1,
      imageCount: 0,
      glyphCount: 0,
      gradientCount: 0,
      isolatedLayerCount: 0,
      maskDepth: 0,
      filterNodeCount: 0,
      visibleAreaRatio: 1,
      dpr: 2,
    });
    expect(island?.costs.length).toBeGreaterThan(0);
    for (const cost of island?.costs ?? []) {
      expect(Number.isFinite(cost.total)).toBe(true);
    }
  });

  it("probe-less calls record an absent fingerprint and rank nothing", () => {
    planStudioStrokeSurfaceShadow(snapshot({ stampAdmitted: true }));
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(1);
    expect(receipt.absentFingerprint).toBe(1);
    expect(receipt.agreed).toBe(0);
    expect(receipt.disagreed).toBe(0);
    const island = receipt.lastReceipt?.islands[0];
    expect(island?.fingerprint).toBe("absent");
    expect(island?.costs).toEqual([]);
    expect(island?.agreed).toBe(true);
  });

  it("malformed traits fail closed to an absent fingerprint; the verdict is untouched", () => {
    expect(deriveStudioStrokeSurfaceCostFingerprint(null)).toBeUndefined();
    expect(deriveStudioStrokeSurfaceCostFingerprint(undefined)).toBeUndefined();
    expect(
      deriveStudioStrokeSurfaceCostFingerprint({ ...COST_TRAITS, pointCount: Number.NaN }),
    ).toBeUndefined();
    expect(
      deriveStudioStrokeSurfaceCostFingerprint({ ...COST_TRAITS, pointCount: -1 }),
    ).toBeUndefined();
    expect(
      deriveStudioStrokeSurfaceCostFingerprint({ ...COST_TRAITS, canvasScale: 0 }),
    ).toBeUndefined();
    expect(
      deriveStudioStrokeSurfaceCostFingerprint({ ...COST_TRAITS, canvasScale: Number.NaN }),
    ).toBeUndefined();
    const input = snapshot({ gpuAdmitted: true });
    const bare = planStudioStrokeSurfaceShadow(input);
    const malformed = planStudioStrokeSurfaceShadow(
      input,
      costProbe({ ...COST_TRAITS, pointCount: Number.NaN }),
    );
    expect(malformed.legacyKind).toBe(bare.legacyKind);
    expect(malformed.plannedKind).toBe(bare.plannedKind);
    expect(malformed.agrees).toBe(bare.agrees);
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(2);
    expect(receipt.absentFingerprint).toBe(2);
  });

  it("receipts are total and deterministic across a mixed run", () => {
    const input = snapshot({ gpuAdmitted: true, dynamicAdmitted: true });
    planStudioStrokeSurfaceShadow(input, costProbe(COST_TRAITS));
    const first = readStudioSurfaceCostShadowReceipt().lastReceipt;
    planStudioStrokeSurfaceShadow(input, costProbe(COST_TRAITS));
    const second = readStudioSurfaceCostShadowReceipt().lastReceipt;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    planStudioStrokeSurfaceShadow(input);
    planStudioStrokeSurfaceShadow(input);
    planStudioStrokeSurfaceShadow(input);
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(5);
    expect(receipt.absentFingerprint).toBe(3);
    expect(receipt.agreed + receipt.disagreed).toBe(2);
    expect(receipt.shadowFailures).toBe(0);
  });

  it("the cost shadow never changes the shadow plan product", () => {
    const input = snapshot({ gpuAdmitted: true, dynamicAdmitted: true });
    const bare = planStudioStrokeSurfaceShadow(input);
    const fingerprinted = planStudioStrokeSurfaceShadow(input, costProbe(COST_TRAITS));
    expect(fingerprinted.legacyKind).toBe(bare.legacyKind);
    expect(fingerprinted.plannedKind).toBe(bare.plannedKind);
    expect(fingerprinted.plan.islands[0]).toEqual(bare.plan.islands[0]);
    expect(fingerprinted.plan.islands[0]).not.toHaveProperty("fallbackChain");
  });
});

/**
 * P-02c: the authority query is capability-narrowed to a single lane, so its
 * cost receipt ranks a singleton and can never disagree. The second,
 * observation-only query re-ranks the full admitted ladder and feeds only the
 * receipt — these cases pin that it produces real disagreement evidence, that
 * it can never touch the plan, and that the coarse-bucket memo bounds it.
 */
describe("P-02c full-ladder cost observation (second query, receipt-only)", () => {
  function probe(
    traits: StudioStrokeRouteWorkloadTraits,
  ): StudioStrokeSurfaceShadowTournamentProbe {
    return {
      traits,
      state: {
        deviceHash: "device-a",
        winnerCache: new WinnerCache(),
        killSwitch: new RemoteKillSwitch(),
      },
    };
  }

  beforeEach(() => {
    resetStudioSurfaceCostShadowReceipt();
  });

  it("records a disagreement on a multi-candidate ladder the singleton query cannot see", () => {
    // Hokusai (wasm-worker → cpu class) wins the admission ladder while the
    // WebGPU lane sits admitted below it — for a mid-size stroke the cost
    // model ranks the GPU lane strictly cheaper. This is exactly the
    // disagreement class the promotion review needs as evidence.
    planStudioStrokeSurfaceShadow(
      snapshot({ hokusai: { admitted: true, surface: "supported" }, gpuAdmitted: true }),
      probe({ pointCount: 40, brushFamily: "wet-ink", canvasScale: 1 }),
    );
    const receipt = readStudioSurfaceCostShadowReceipt();
    // The narrowed authority receipt still agrees (it ranked a singleton)…
    expect(receipt.total).toBe(1);
    expect(receipt.agreed).toBe(1);
    expect(receipt.disagreed).toBe(0);
    // …while the full-ladder observation captured the real disagreement.
    expect(receipt.fullLadderQueries).toBe(1);
    expect(receipt.fullLadderAgreed).toBe(0);
    expect(receipt.fullLadderDisagreed).toBe(1);
    const observation = receipt.lastFullLadderDisagreement;
    expect(observation?.islandId).toBe("live-stroke");
    expect(observation?.legacyWinner).toBe("stroke-route-hokusai");
    expect(observation?.costWinner).toBe("stroke-route-gpu");
    expect(observation?.agreed).toBe(false);
    expect(observation?.costs).toHaveLength(3);
    expect(observation?.costs[0]?.providerId).toBe("stroke-route-gpu");
    expect(observation?.costs[0]?.lane).toBe("webgpu");
  });

  it("agrees on the full ladder when the authority winner is also the cheapest", () => {
    planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
      probe({ pointCount: 640, brushFamily: "wet-ink", canvasScale: 2 }),
    );
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.fullLadderQueries).toBe(1);
    expect(receipt.fullLadderAgreed).toBe(1);
    expect(receipt.fullLadderDisagreed).toBe(0);
    const observation = receipt.lastFullLadderReceipt;
    expect(observation?.legacyWinner).toBe("stroke-route-gpu");
    expect(observation?.costWinner).toBe("stroke-route-gpu");
    expect(observation?.agreed).toBe(true);
    expect(observation?.costs).toHaveLength(3);
    expect(receipt.lastFullLadderDisagreement).toBeNull();
  });

  it("the plan is byte-identical with and without the second query", () => {
    const input = snapshot({ hokusai: { admitted: true, surface: "supported" }, gpuAdmitted: true });
    const traits: StudioStrokeRouteWorkloadTraits = {
      pointCount: 40,
      brushFamily: "wet-ink",
      canvasScale: 1,
    };
    // No probe ⇒ absent fingerprint ⇒ the second query never runs.
    const without = planStudioStrokeSurfaceShadow(input);
    // First probed call: the full-ladder query runs (and disagrees).
    const first = planStudioStrokeSurfaceShadow(input, probe(traits));
    // Second probed call: the memo skips the query entirely.
    const second = planStudioStrokeSurfaceShadow(input, probe(traits));
    expect(readStudioSurfaceCostShadowReceipt().fullLadderDisagreed).toBe(1);
    expect(JSON.stringify(first.plan)).toBe(JSON.stringify(without.plan));
    expect(JSON.stringify(second.plan)).toBe(JSON.stringify(without.plan));
    expect(first.legacyKind).toBe(without.legacyKind);
    expect(first.plannedKind).toBe(without.plannedKind);
    expect(second.plannedKind).toBe(without.plannedKind);
  });

  it("memoizes by coarse bucket: repeats are free, new lane sets or size classes are not", () => {
    const input = snapshot({ gpuAdmitted: true });
    const traits: StudioStrokeRouteWorkloadTraits = {
      pointCount: 40,
      brushFamily: "wet-ink",
      canvasScale: 1,
    };
    for (let i = 0; i < 5; i += 1) {
      planStudioStrokeSurfaceShadow(input, probe(traits));
    }
    expect(readStudioSurfaceCostShadowReceipt().fullLadderQueries).toBe(1);
    // Same lanes, different power-of-two segment class ⇒ a new bucket.
    planStudioStrokeSurfaceShadow(input, probe({ ...traits, pointCount: 640 }));
    expect(readStudioSurfaceCostShadowReceipt().fullLadderQueries).toBe(2);
    // Different admitted-lane set ⇒ a new bucket.
    planStudioStrokeSurfaceShadow(
      snapshot({ gpuAdmitted: true, dynamicAdmitted: true }),
      probe(traits),
    );
    expect(readStudioSurfaceCostShadowReceipt().fullLadderQueries).toBe(3);
    // Probe-less calls skip the second query entirely (absent fingerprint).
    planStudioStrokeSurfaceShadow(input);
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.fullLadderQueries).toBe(3);
    expect(receipt.fullLadderAgreed + receipt.fullLadderDisagreed).toBe(3);
  });

  it("a singleton admitted ladder records no full-ladder evidence", () => {
    // Only konva is admitted: no disagreement is possible by construction, so
    // counting it as agreement would fake evidence.
    planStudioStrokeSurfaceShadow(
      snapshot({}),
      probe({ pointCount: 40, brushFamily: "wet-ink", canvasScale: 1 }),
    );
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(1);
    expect(receipt.fullLadderQueries).toBe(0);
    expect(receipt.lastFullLadderReceipt).toBeNull();
  });

  it("the 8192-state parity loop stays bounded: one query per admitted-lane set", () => {
    const sharedProbe = probe({ pointCount: 40, brushFamily: "wet-ink", canvasScale: 1 });
    let total = 0;
    for (const input of allAdmissionSnapshots()) {
      const result = planStudioStrokeSurfaceShadow(input, sharedProbe);
      if (!result.agrees) {
        throw new Error(
          `full-ladder observation broke parity for ${JSON.stringify(input)}`,
        );
      }
      total += 1;
    }
    expect(total).toBe(8192);
    const receipt = readStudioSurfaceCostShadowReceipt();
    expect(receipt.total).toBe(8192);
    // 2^7 admitted-lane sets minus the konva-only singleton, one fixed
    // workload class — the second query ran 127 times for 8192 plans.
    expect(receipt.fullLadderQueries).toBe(127);
    expect(receipt.fullLadderAgreed + receipt.fullLadderDisagreed).toBe(127);
    // The enumeration itself yields real promotion evidence.
    expect(receipt.fullLadderDisagreed).toBeGreaterThan(0);
  });
});
