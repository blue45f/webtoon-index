import { readFileSync } from "node:fs";

import {
  PlanUnsatisfiableError,
  presentedMegapixels,
} from "@toonspectrum/studio-engine-registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStudioTournamentRuntime,
  installStudioTournamentRuntime,
  peekStudioTournamentRuntime,
} from "../studio-renderer-tournament-runtime";

import {
  deriveStudioFilterIslandCostFingerprint,
  installStudioFilterTournamentBootstrap,
  planStudioFilterIslandLanes,
  readStudioFilterIslandCostShadowReceipt,
  resetStudioFilterIslandCostShadowReceipt,
  studioFilterIslandBucket,
  studioFilterLaneProviderId,
} from "./studio-filter-island-plan";
import { megapixelsOf } from "./studio-filter-lane-cost-model";

function installNoopTournamentBootstrap(): void {
  installStudioFilterTournamentBootstrap({
    schedule: () => undefined,
    loadPersistence: () => Promise.resolve({
      installStudioTournamentSqlitePersistence: () => undefined,
    }),
  });
}

beforeEach(() => {
  installStudioTournamentRuntime(null);
  installNoopTournamentBootstrap();
  resetStudioFilterIslandCostShadowReceipt();
});

afterEach(() => {
  installStudioFilterTournamentBootstrap(null);
  installStudioTournamentRuntime(null);
});

/**
 * The filter planner performs capability admission once. `lanes` is retained
 * as a one-item compatibility projection, not a retry ladder; a selected
 * provider failure is terminal for this operation.
 */
describe("filter island singleton selection", () => {
  it("selects only the GPU provider when the chain is eligible", () => {
    const result = planStudioFilterIslandLanes({ gpuChainEligible: true });

    expect(result).toMatchObject({
      lanes: ["gpu-chain"],
      selectedLane: "gpu-chain",
      status: "selected",
      unavailableReason: null,
      laneCosts: null,
    });
    expect(result.plan.mode).toBe("final-export");
    expect(result.plan.primaryOwnerId).toBe("filter-lane-konva-native");
    expect(result.plan.islands[0]).toMatchObject({
      providerId: "filter-lane-gpu-chain",
      transport: "cpu-readback",
    });
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
  });

  it("selects only Worker when GPU capability admission fails", () => {
    const result = planStudioFilterIslandLanes({ gpuChainEligible: false });

    expect(result).toMatchObject({
      lanes: ["worker"],
      selectedLane: "worker",
      status: "selected",
      unavailableReason: null,
    });
    expect(result.plan.islands[0]?.providerId).toBe("filter-lane-worker");
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
    expect(result.lanes).not.toContain("konva-native");
  });

  it("rejects the same readback island in interactive mode", async () => {
    const { EngineCapabilityRegistry, HybridExecutionPlanner, providerDescriptorSchema } =
      await import("@toonspectrum/studio-engine-registry");
    const registry = EngineCapabilityRegistry.forTestFixtures();
    registry.registerTestFixture(
      providerDescriptorSchema.parse({
        id: "filter-lane-probe",
        kind: "filter",
        displayName: "probe",
        version: "1",
        license: "internal",
        attribution: "",
        maturity: "production-baseline",
        runtime: "js",
        capabilities: ["filter.lane.worker"],
        limitations: [],
        previewQuality: "production",
        finalQuality: "production",
        determinism: "tolerance",
        memoryEstimateMb: 1,
        knownIssues: [],
      }),
    );
    const planner = new HybridExecutionPlanner(registry);

    expect(() =>
      planner.plan({
        surfaceId: "probe",
        mode: "interactive",
        primaryOwnerId: "filter-lane-probe",
        islands: [
          {
            islandId: "image-filter-chain",
            kind: "filter",
            requiredCapabilities: ["filter.lane.worker"],
            availableTransports: ["cpu-readback"],
          },
        ],
      }),
    ).toThrow(PlanUnsatisfiableError);
  });
});

describe("tournament denial never substitutes another filter provider", () => {
  it("ignores a cached winner because it is observation, not selection authority", () => {
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-test",
    });
    const input = {
      gpuChainEligible: true,
      workload: { width: 256, height: 256, chainSteps: 1 },
    } as const;
    runtime.recordWinner(studioFilterIslandBucket(input), runtime.deviceHash, {
      providerId: studioFilterLaneProviderId("worker"),
      expectedWarmMs: 1,
      decidedAtSample: 10,
    });
    installStudioTournamentRuntime(runtime);

    const result = planStudioFilterIslandLanes(input);
    expect(result.selectedLane).toBe("gpu-chain");
    expect(result.lanes).toEqual(["gpu-chain"]);
    expect(result.status).toBe("selected");
    expect(result.laneCosts).toBeNull();
  });

  it("reports a killed GPU selection unavailable without running Worker or Konva", () => {
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-test",
    });
    runtime.applyKillList([studioFilterLaneProviderId("gpu-chain")], "remote flag");
    installStudioTournamentRuntime(runtime);

    const result = planStudioFilterIslandLanes({ gpuChainEligible: true });
    expect(result).toMatchObject({
      lanes: ["gpu-chain"],
      selectedLane: "gpu-chain",
      status: "unavailable",
      unavailableReason: "selected-provider-killed",
    });
    expect(result.plan.islands[0]?.providerId).toBe("filter-lane-gpu-chain");
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
    expect(result.lanes).not.toContain("worker");
    expect(result.lanes).not.toContain("konva-native");
  });

  it("reports a killed Worker selection unavailable without substituting Konva", () => {
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-test",
    });
    runtime.applyKillList([studioFilterLaneProviderId("worker")], "remote flag");
    installStudioTournamentRuntime(runtime);

    const result = planStudioFilterIslandLanes({ gpuChainEligible: false });
    expect(result).toMatchObject({
      lanes: ["worker"],
      selectedLane: "worker",
      status: "unavailable",
      unavailableReason: "selected-provider-killed",
    });
    expect(result.plan.islands[0]?.providerId).toBe("filter-lane-worker");
    expect(result.lanes).not.toContain("konva-native");
  });

  it("does not let a kill on an unselected provider alter the selected lane", () => {
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-test",
    });
    runtime.applyKillList(
      [studioFilterLaneProviderId("worker"), studioFilterLaneProviderId("konva-native")],
      "unrelated providers",
    );
    installStudioTournamentRuntime(runtime);

    const result = planStudioFilterIslandLanes({ gpuChainEligible: true });
    expect(result.selectedLane).toBe("gpu-chain");
    expect(result.status).toBe("selected");
    expect(result.lanes).toEqual(["gpu-chain"]);
  });

  it("does not restore an all-killed candidate set", () => {
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-test",
    });
    runtime.applyKillList(
      (["gpu-chain", "worker", "konva-native"] as const).map(
        studioFilterLaneProviderId,
      ),
      "panic",
    );
    installStudioTournamentRuntime(runtime);

    const result = planStudioFilterIslandLanes({ gpuChainEligible: true });
    expect(result.selectedLane).toBe("gpu-chain");
    expect(result.status).toBe("unavailable");
    expect(result.lanes).toEqual(["gpu-chain"]);
  });
});

describe("StudioKonvaImageNode fail-closed wiring", () => {
  function imageNodeSource(): string {
    return readFileSync(
      new URL("../StudioKonvaImageNode.tsx", import.meta.url),
      "utf8",
    );
  }

  it("consumes selectedLane/status and dispatches Worker only when Worker was selected", () => {
    const source = imageNodeSource();
    expect(source).toMatch(
      /import \{[\s\S]*?planStudioFilterIslandLanes[\s\S]*?\} from "\.\/filter\/studio-filter-island-plan";/u,
    );
    expect(source).toMatch(
      /const filterIslandPlan = planStudioFilterIslandLanes\(filterIslandInput\);/u,
    );
    expect(source).toMatch(/const selectedFilterLane = filterIslandPlan\.selectedLane;/u);
    expect(source).toMatch(
      /if \(filterIslandPlan\.status === "unavailable"\) \{[\s\S]*?markSelectedFilterUnavailable\([\s\S]*?return;[\s\S]*?\}/u,
    );
    expect(source).toMatch(
      /if \(selectedFilterLane === "gpu-chain" && !useRetainedGpuPreview\) \{[\s\S]*?markSelectedFilterUnavailable\([\s\S]*?return;[\s\S]*?\}/u,
    );
    expect(source).toMatch(
      /if \(selectedFilterLane === "worker"\) dispatchWorkerRequest\(\);/u,
    );
    expect(source).not.toMatch(/filterIslandPlan\.lanes\.slice\(1\)/u);
    expect(source).not.toMatch(/for \([^)]* of filterIslandPlan\.lanes/u);
  });

  it("does not require the Worker client before an eligible GPU selection can execute", () => {
    const source = imageNodeSource();
    expect(source).not.toMatch(
      /const useWorkerFilterPath = workerPipelineRequested\s*&& !!filterWorkerClient/u,
    );
    expect(source).not.toMatch(
      /if \(!useWorkerFilterPath \|\| !displayImg \|\| !filterWorkerClient\)/u,
    );
  });

  it("keeps Konva disabled when the selected filter boundary is unavailable", () => {
    const source = imageNodeSource();
    expect(source).toMatch(/const filterPipelineActive = workerPipelineRequested;/u);
    expect(source).toMatch(
      /const activeFilters:[\s\S]*?filterPipelineActive[\s\S]*?\? undefined[\s\S]*?: konvaCompatibilityFilters;/u,
    );
    expect(source).toMatch(
      /if \(!gpuFilterModule\) \{[\s\S]*?markSelectedFilterUnavailable\([\s\S]*?return;[\s\S]*?\}/u,
    );
  });

  it("passes the real workload into initial capability selection", () => {
    const source = imageNodeSource();
    expect(source).toMatch(/workload: \{ width, height, chainSteps: filterChainSteps \}/u);
    expect(source).toMatch(/const filterChainSteps = built\.filters\.length;/u);
  });
});

describe("filter island bucket key", () => {
  it("is deterministic for equivalent dimensions and pixel counts", () => {
    const dimensions = {
      gpuChainEligible: true,
      workload: { width: 1024, height: 1024, chainSteps: 3 },
    } as const;
    const pixels = {
      gpuChainEligible: true,
      workload: { pixelCount: 1024 * 1024, chainSteps: 3 },
    } as const;
    expect(studioFilterIslandBucket(dimensions)).toBe(studioFilterIslandBucket(dimensions));
    expect(studioFilterIslandBucket(dimensions)).toBe(studioFilterIslandBucket(pixels));
  });

  it("separates eligibility, size class, chain length, and unknown workloads", () => {
    const keys = new Set(
      [
        { gpuChainEligible: true, workload: { width: 256, height: 256, chainSteps: 1 } },
        { gpuChainEligible: true, workload: { width: 4096, height: 4096, chainSteps: 1 } },
        { gpuChainEligible: true, workload: { width: 256, height: 256, chainSteps: 6 } },
        { gpuChainEligible: false, workload: { width: 256, height: 256, chainSteps: 1 } },
        { gpuChainEligible: true },
      ].map((input) => studioFilterIslandBucket(input)),
    );
    expect(keys.size).toBe(5);
  });

  it("pools adjacent power-of-two sizes and marks invalid workloads unknown", () => {
    expect(
      studioFilterIslandBucket({
        gpuChainEligible: true,
        workload: { width: 1024, height: 1024, chainSteps: 3 },
      }),
    ).toBe(
      studioFilterIslandBucket({
        gpuChainEligible: true,
        workload: { width: 1100, height: 1100, chainSteps: 3 },
      }),
    );
    expect(studioFilterIslandBucket({ gpuChainEligible: true })).toContain("pu|su");
    expect(
      studioFilterIslandBucket({
        gpuChainEligible: true,
        workload: { pixelCount: Number.NaN, chainSteps: 2 },
      }),
    ).toContain("pu|su");
  });
});

describe("filter island persistence bootstrap", () => {
  function spyBootstrap(): {
    tasks: Array<() => void>;
    loads: number;
    installs: number;
  } {
    const state = { tasks: [] as Array<() => void>, loads: 0, installs: 0 };
    installStudioFilterTournamentBootstrap({
      schedule: (task) => {
        state.tasks.push(task);
      },
      loadPersistence: () => {
        state.loads += 1;
        return Promise.resolve({
          installStudioTournamentSqlitePersistence: () => {
            state.installs += 1;
          },
        });
      },
    });
    return state;
  }

  it("does not load persistence while producing singleton plans", () => {
    const bootstrap = spyBootstrap();
    for (let index = 0; index < 5; index += 1) {
      planStudioFilterIslandLanes({
        gpuChainEligible: true,
        workload: { width: 512, height: 512, chainSteps: 3 },
      });
    }
    expect(bootstrap.loads).toBe(0);
    expect(bootstrap.installs).toBe(0);
    expect(bootstrap.tasks).toHaveLength(1);
  });

  it("loads persistence only when the deferred task runs", async () => {
    const bootstrap = spyBootstrap();
    installStudioTournamentRuntime(
      createStudioTournamentRuntime({ persistence: null, deviceHash: "dev-test" }),
    );
    planStudioFilterIslandLanes({ gpuChainEligible: true });
    expect(bootstrap.loads).toBe(0);
    bootstrap.tasks[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(bootstrap.loads).toBe(1);
    expect(bootstrap.installs).toBe(1);
  });

  it("does not construct the shared tournament runtime during planning", () => {
    spyBootstrap();
    installStudioTournamentRuntime(null);
    const result = planStudioFilterIslandLanes({
      gpuChainEligible: true,
      workload: { width: 4096, height: 4096, chainSteps: 6 },
    });
    expect(result.lanes).toEqual(["gpu-chain"]);
    expect(result.selectedLane).toBe("gpu-chain");
    expect(result.status).toBe("selected");
    expect(result.laneCosts).toBeNull();
    expect(peekStudioTournamentRuntime()).toBeNull();
  });

  it("keeps SQLite persistence out of the plan module's static graph", () => {
    const source = readFileSync(
      new URL("./studio-filter-island-plan.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/^import .*studio-tournament-sqlite-persistence/mu);
    expect(source).toMatch(/import\("\.\.\/studio-tournament-sqlite-persistence"\)/u);
  });
});

describe("filter island fingerprint and cost-shadow receipts", () => {
  it("records real size and chain fields for the singleton provider", () => {
    const result = planStudioFilterIslandLanes({
      gpuChainEligible: true,
      workload: { width: 2048, height: 2048, chainSteps: 3 },
    });
    const receipt = readStudioFilterIslandCostShadowReceipt();
    const island = receipt.lastReceipt?.islands[0];

    expect(result.selectedLane).toBe("gpu-chain");
    expect(receipt.total).toBe(1);
    expect(receipt.absentFingerprint).toBe(0);
    expect(receipt.shadowFailures).toBe(0);
    expect(receipt.agreed + receipt.disagreed).toBe(1);
    expect(island?.legacyWinner).toBe("filter-lane-gpu-chain");
    expect(island?.costs).toHaveLength(1);
    expect(island?.costs[0]?.providerId).toBe("filter-lane-gpu-chain");
    const fingerprint = island?.fingerprint;
    if (fingerprint === undefined || fingerprint === "absent") {
      throw new Error("expected a populated filter-island fingerprint");
    }
    expect(fingerprint).toMatchObject({
      pathCount: 0,
      segmentCount: 0,
      imageCount: 1,
      isolatedLayerCount: 1,
      maskDepth: 0,
      filterNodeCount: 3,
      visibleAreaRatio: 1,
    });
    expect(fingerprint.dpr).toBeCloseTo(Math.sqrt(megapixelsOf(2048 * 2048)), 12);
    expect(receipt.fullLadderQueries).toBe(0);
    expect(receipt.lastFullLadderReceipt).toBeNull();
  });

  it("records an absent fingerprint without changing the selected Worker", () => {
    const result = planStudioFilterIslandLanes({ gpuChainEligible: false });
    const receipt = readStudioFilterIslandCostShadowReceipt();
    const island = receipt.lastReceipt?.islands[0];

    expect(result.lanes).toEqual(["worker"]);
    expect(result.selectedLane).toBe("worker");
    expect(island?.fingerprint).toBe("absent");
    expect(island?.costs).toEqual([]);
    expect(receipt.total).toBe(1);
    expect(receipt.absentFingerprint).toBe(1);
    expect(receipt.fullLadderQueries).toBe(0);
  });

  it("fails closed to an absent fingerprint for degenerate workloads", () => {
    for (const workload of [
      null,
      undefined,
      { pixelCount: 0, chainSteps: 2 },
      { pixelCount: Number.NaN, chainSteps: 2 },
      { width: -128, height: 128, chainSteps: 2 },
      { pixelCount: Number.MIN_VALUE, chainSteps: 1 },
      { pixelCount: Number.POSITIVE_INFINITY, chainSteps: 1 },
      { width: 1e200, height: 1e200, chainSteps: 1 },
    ] as const) {
      expect(deriveStudioFilterIslandCostFingerprint(workload)).toBeUndefined();
    }

    const result = planStudioFilterIslandLanes({
      gpuChainEligible: true,
      workload: { pixelCount: Number.MIN_VALUE, chainSteps: 1 },
    });
    const receipt = readStudioFilterIslandCostShadowReceipt();
    expect(result.selectedLane).toBe("gpu-chain");
    expect(result.lanes).toEqual(["gpu-chain"]);
    expect(result.plan.islands[0]).not.toHaveProperty("fallbackChain");
    expect(receipt.absentFingerprint).toBe(1);
    expect(receipt.lastReceipt?.islands[0]?.fingerprint).toBe("absent");
    expect(receipt.lastReceipt?.islands[0]?.costs).toEqual([]);
  });

  it("clamps sub-one chain lengths to one filter node", () => {
    const fingerprint = deriveStudioFilterIslandCostFingerprint({
      pixelCount: 1_000_000,
      chainSteps: 0,
    });
    expect(fingerprint?.filterNodeCount).toBe(1);
    expect(fingerprint?.dpr).toBe(1);
    expect(fingerprint?.visibleAreaRatio).toBe(1);
  });

  it("produces deterministic receipts across identical singleton plans", () => {
    const input = {
      gpuChainEligible: true,
      workload: { width: 512, height: 512, chainSteps: 2 },
    } as const;
    const firstPlan = planStudioFilterIslandLanes(input);
    const firstReceipt = readStudioFilterIslandCostShadowReceipt().lastReceipt;
    const secondPlan = planStudioFilterIslandLanes(input);
    const secondReceipt = readStudioFilterIslandCostShadowReceipt().lastReceipt;

    expect(JSON.stringify(secondPlan.plan)).toBe(JSON.stringify(firstPlan.plan));
    expect(secondPlan.lanes).toEqual(firstPlan.lanes);
    expect(JSON.stringify(secondReceipt)).toBe(JSON.stringify(firstReceipt));
    expect(readStudioFilterIslandCostShadowReceipt()).toMatchObject({
      total: 2,
      absentFingerprint: 0,
      shadowFailures: 0,
      fullLadderQueries: 0,
    });
  });
});

describe("filter island area encoding", () => {
  function fingerprintFor(width: number, height: number, chainSteps: number) {
    const fingerprint = deriveStudioFilterIslandCostFingerprint({ width, height, chainSteps });
    if (fingerprint === undefined) {
      throw new Error(`expected a fingerprint for ${width}x${height}`);
    }
    return fingerprint;
  }

  it("preserves true sub-megapixel area without a 1 MP floor", () => {
    const fingerprints = [
      fingerprintFor(128, 128, 1),
      fingerprintFor(256, 256, 1),
      fingerprintFor(512, 512, 1),
    ];
    const areas = fingerprints.map(presentedMegapixels);

    expect(areas[0]).toBeCloseTo(megapixelsOf(128 * 128), 12);
    expect(areas[1]).toBeCloseTo(megapixelsOf(256 * 256), 12);
    expect(areas[2]).toBeCloseTo(megapixelsOf(512 * 512), 12);
    expect(new Set(areas).size).toBe(3);
    for (const fingerprint of fingerprints) {
      expect(fingerprint.dpr).toBe(1);
      expect(fingerprint.visibleAreaRatio).toBeGreaterThan(0);
      expect(fingerprint.visibleAreaRatio).toBeLessThan(1);
    }
  });

  it("keeps the at-least-1 MP encoding as dpr square root with saturated ratio", () => {
    for (const size of [1024, 2048, 4096]) {
      const fingerprint = fingerprintFor(size, size, 3);
      const megapixels = megapixelsOf(size * size);
      expect(fingerprint.visibleAreaRatio).toBe(1);
      expect(fingerprint.dpr).toBeCloseTo(Math.sqrt(megapixels), 12);
      expect(presentedMegapixels(fingerprint)).toBeCloseTo(megapixels, 10);
    }
  });

  it("keeps fingerprint observations out of authority selection", () => {
    const blind = planStudioFilterIslandLanes({ gpuChainEligible: true });
    const small = planStudioFilterIslandLanes({
      gpuChainEligible: true,
      workload: { width: 256, height: 256, chainSteps: 1 },
    });
    const large = planStudioFilterIslandLanes({
      gpuChainEligible: true,
      workload: { width: 4096, height: 4096, chainSteps: 6 },
    });

    expect(JSON.stringify(small.plan)).toBe(JSON.stringify(blind.plan));
    expect(JSON.stringify(large.plan)).toBe(JSON.stringify(blind.plan));
    expect(small.selectedLane).toBe("gpu-chain");
    expect(large.selectedLane).toBe("gpu-chain");
    expect(small.lanes).toEqual(["gpu-chain"]);
    expect(large.lanes).toEqual(["gpu-chain"]);
    expect(small.plan.islands[0]).not.toHaveProperty("fallbackChain");
    expect(large.plan.islands[0]).not.toHaveProperty("fallbackChain");
  });
});
