import { beforeEach, describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_EXECUTION_ROUTE_PRIORITY,
  admittedStudioFilterExecutionLanes,
  captureStudioFilterExecutionRouteSnapshot,
  planStudioFilterExecutionShadow,
  readStudioFilterPlanShadowReceipt,
  recordStudioFilterExecutionShadow,
  resetStudioFilterPlanShadowReceipt,
  resolveStudioFilterExecutionRoute,
  type StudioFilterExecutionRouteSnapshotInput,
} from "./studio-filter-plan-shadow";

import type { StudioFilterLane } from "../filter/studio-filter-lane-cost-model";


/**
 * V11 strangler gate (필터 planner 위임, shadow step): the shadow
 * HybridExecutionPlanner must reproduce the legacy filter execution-route
 * contract for the ENTIRE admission-snapshot state space before any real
 * routing is delegated. 48 exhaustive combinations (3 island head lanes ×
 * 2^4 booleans) leave no sampled blind spots — same discipline as the
 * 8,192-state studio-surface-plan-shadow parity.
 */

const LANES: readonly StudioFilterLane[] = ["gpu-chain", "worker", "konva-native"];
const BOOLEANS = [false, true] as const;

function snapshot(
  overrides: Partial<StudioFilterExecutionRouteSnapshotInput> = {},
): StudioFilterExecutionRouteSnapshotInput {
  return {
    islandHeadLane: "gpu-chain",
    gpuModuleReady: true,
    presentChainAvailable: true,
    presentationSurfaceAvailable: true,
    maskActive: false,
    ...overrides,
  };
}

function* allSnapshots(): Generator<StudioFilterExecutionRouteSnapshotInput> {
  for (const islandHeadLane of LANES) {
    for (const gpuModuleReady of BOOLEANS) {
      for (const presentChainAvailable of BOOLEANS) {
        for (const presentationSurfaceAvailable of BOOLEANS) {
          for (const maskActive of BOOLEANS) {
            yield {
              islandHeadLane,
              gpuModuleReady,
              presentChainAvailable,
              presentationSurfaceAvailable,
              maskActive,
            };
          }
        }
      }
    }
  }
}

beforeEach(() => {
  resetStudioFilterPlanShadowReceipt();
});

describe("V11 shadow planner parity (filter execution route)", () => {
  it("agrees with resolveStudioFilterExecutionRoute across all 48 admission states", () => {
    let total = 0;
    const reached = new Map<StudioFilterLane, number>();
    for (const input of allSnapshots()) {
      const result = planStudioFilterExecutionShadow(input);
      if (!result.agrees || result.plannedLane === null) {
        throw new Error(
          `parity break: legacy=${result.legacyLane} planner=${String(result.plannedLane)} for ${JSON.stringify(input)}`,
        );
      }
      if (result.legacyLane !== resolveStudioFilterExecutionRoute(input)) {
        throw new Error(`legacy resolver drifted for ${JSON.stringify(input)}`);
      }
      expect(result.inputComplete).toBe(true);
      reached.set(result.legacyLane, (reached.get(result.legacyLane) ?? 0) + 1);
      total += 1;
    }
    expect(total).toBe(48);
    // Both admission-time lanes must be reachable in the enumeration.
    // Konva remains an explicitly selectable compatibility/reference lane,
    // never an automatic result of another selected provider failing.
    expect(reached.get("gpu-chain") ?? 0, "gpu-chain reachable").toBeGreaterThan(0);
    expect(reached.get("worker") ?? 0, "worker reachable").toBeGreaterThan(0);
    expect(reached.get("konva-native") ?? 0, "konva-native is not auto-selected").toBe(0);
  });

  it("binds every valid admission state to exactly one execution provider", () => {
    for (const input of allSnapshots()) {
      const result = planStudioFilterExecutionShadow(input);
      expect(result.plannedLane, JSON.stringify(input)).not.toBeNull();
      expect(result.plan?.islands[0]?.providerId, JSON.stringify(input)).toBe(
        `filter-exec-${result.plannedLane}`,
      );
      expect(result.plan?.islands[0], JSON.stringify(input)).not.toHaveProperty(
        "fallbackChain",
      );
      expect(admittedStudioFilterExecutionLanes(input), JSON.stringify(input)).toEqual([
        result.legacyLane,
      ]);
    }
  });

  it("keeps a GPU admission as a singleton final-export island", () => {
    const result = planStudioFilterExecutionShadow(snapshot());
    expect(result.legacyLane).toBe("gpu-chain");
    expect(result.plannedLane).toBe("gpu-chain");
    expect(result.plan?.islands[0]?.providerId).toBe("filter-exec-gpu-chain");
    expect(result.plan?.islands[0]).not.toHaveProperty("fallbackChain");
    expect(result.plan?.primaryOwnerId).toBe("filter-exec-konva-native");
    // The island's terminal single readback is legal only in final-export
    // mode (absolute rule 8 stays machine-checked).
    expect(result.plan?.mode).toBe("final-export");
  });

  it("selects Worker at admission when a GPU prerequisite is absent", () => {
    const gates: readonly Partial<StudioFilterExecutionRouteSnapshotInput>[] = [
      { islandHeadLane: "worker" },
      { islandHeadLane: "konva-native" },
      { gpuModuleReady: false },
      { presentChainAvailable: false },
      { presentationSurfaceAvailable: false },
      { maskActive: true },
    ];
    for (const override of gates) {
      const result = planStudioFilterExecutionShadow(snapshot(override));
      expect(result.legacyLane, JSON.stringify(override)).toBe("worker");
      expect(result.plannedLane, JSON.stringify(override)).toBe("worker");
      expect(result.agrees).toBe(true);
      expect(result.plan?.islands[0]?.providerId).toBe("filter-exec-worker");
      expect(result.plan?.islands[0]).not.toHaveProperty("fallbackChain");
    }
  });

  it("returns a singleton admitted lane in stable identity space", () => {
    for (const input of allSnapshots()) {
      const lanes = admittedStudioFilterExecutionLanes(input);
      expect(lanes).toHaveLength(1);
      expect(STUDIO_FILTER_EXECUTION_ROUTE_PRIORITY).toContain(lanes[0]);
      expect(lanes[0]).not.toBe("konva-native");
    }
  });
});

describe("fail-closed shadow inputs (parity records the miss, never crashes the filter)", () => {
  it("a malformed snapshot fails closed to the CPU lane without throwing", () => {
    const malformed = {
      ...snapshot(),
      islandHeadLane: "banana",
    } as unknown as StudioFilterExecutionRouteSnapshotInput;
    const result = planStudioFilterExecutionShadow(malformed);
    expect(result.inputComplete).toBe(false);
    expect(result.legacyLane).toBe("worker");
    expect(result.plannedLane).toBeNull();
    expect(result.agrees).toBe(false);
    expect(result.plan).toBeNull();
  });

  it("an incomplete snapshot never grants the GPU lane", () => {
    const incomplete = {
      islandHeadLane: "gpu-chain",
      gpuModuleReady: true,
    } as StudioFilterExecutionRouteSnapshotInput;
    const result = planStudioFilterExecutionShadow(incomplete);
    expect(result.inputComplete).toBe(false);
    expect(result.legacyLane).toBe("worker");
  });

  it("the recorder counts malformed inputs as a miss and returns null", () => {
    const malformed = {
      ...snapshot(),
      maskActive: "yes",
    } as unknown as StudioFilterExecutionRouteSnapshotInput;
    expect(recordStudioFilterExecutionShadow(malformed, "worker")).toBeNull();
    const receipt = readStudioFilterPlanShadowReceipt();
    expect(receipt.invalidInput).toBe(1);
    expect(receipt.total).toBe(0);
  });
});

describe("snapshot capture (module probes are guarded — never crash the filter effect)", () => {
  it("captures presentation exports from a plain module namespace", () => {
    const module = {
      presentGpuFilterChain: () => null,
      createStudioGpuFilterPresentationSurface: () => null,
    };
    const captured = captureStudioFilterExecutionRouteSnapshot({
      islandHeadLane: "gpu-chain",
      gpuFilterModule: module,
      maskActive: false,
    });
    expect(captured).toEqual(snapshot());
    expect(resolveStudioFilterExecutionRoute(captured)).toBe("gpu-chain");
  });

  it("a namespace that throws on export access (vitest ESM mock shape) probes as unavailable", () => {
    // vi.mock namespaces throw on undefined exports; the inline probe in the
    // filter effect used to crash on exactly this shape.
    const throwing = new Proxy(
      {},
      {
        get(): never {
          throw new Error("No export is defined on the mock");
        },
      },
    );
    const captured = captureStudioFilterExecutionRouteSnapshot({
      islandHeadLane: "worker",
      gpuFilterModule: throwing,
      maskActive: false,
    });
    expect(captured.gpuModuleReady).toBe(true);
    expect(captured.presentChainAvailable).toBe(false);
    expect(captured.presentationSurfaceAvailable).toBe(false);
    // An unprobeable module can never grant the GPU lane (fail closed).
    expect(resolveStudioFilterExecutionRoute(captured)).toBe("worker");
    const result = planStudioFilterExecutionShadow(captured);
    expect(result.agrees).toBe(true);
    expect(result.plannedLane).toBe("worker");
  });

  it("a partial mock without presentation exports captures them as unavailable", () => {
    const partial = { isStudioGpuFilterChainEligible: () => false };
    const captured = captureStudioFilterExecutionRouteSnapshot({
      islandHeadLane: "worker",
      gpuFilterModule: partial,
      maskActive: false,
    });
    expect(captured.gpuModuleReady).toBe(true);
    expect(captured.presentChainAvailable).toBe(false);
    expect(captured.presentationSurfaceAvailable).toBe(false);
  });

  it("a null module captures every module-dependent flag as false", () => {
    const captured = captureStudioFilterExecutionRouteSnapshot({
      islandHeadLane: "worker",
      gpuFilterModule: null,
      maskActive: true,
    });
    expect(captured).toEqual({
      islandHeadLane: "worker",
      gpuModuleReady: false,
      presentChainAvailable: false,
      presentationSurfaceAvailable: false,
      maskActive: true,
    });
    expect(resolveStudioFilterExecutionRoute(captured)).toBe("worker");
  });
});

describe("receipt/counter (observation only — the legacy gate keeps authority)", () => {
  it("agreeing observations accumulate under agreed with no divergence captured", () => {
    for (const input of allSnapshots()) {
      const observed = resolveStudioFilterExecutionRoute(input);
      const result = recordStudioFilterExecutionShadow(input, observed);
      expect(result?.agrees).toBe(true);
    }
    const receipt = readStudioFilterPlanShadowReceipt();
    expect(receipt.total).toBe(48);
    expect(receipt.agreed).toBe(48);
    expect(receipt.disagreed).toBe(0);
    expect(receipt.observedDrift).toBe(0);
    expect(receipt.plannerFailures).toBe(0);
    expect(receipt.lastDisagreement).toBeNull();
    expect(receipt.lastObservedDrift).toBeNull();
  });

  it("a live gate that drifts from the replica is captured as observedDrift", () => {
    const input = snapshot({ maskActive: true });
    // The replica says worker; simulate an inline gate that (wrongly) ran GPU.
    const result = recordStudioFilterExecutionShadow(input, "gpu-chain");
    expect(result?.legacyLane).toBe("worker");
    const receipt = readStudioFilterPlanShadowReceipt();
    expect(receipt.total).toBe(1);
    expect(receipt.observedDrift).toBe(1);
    expect(receipt.lastObservedDrift?.observedLane).toBe("gpu-chain");
    expect(receipt.lastObservedDrift?.legacyLane).toBe("worker");
    expect(receipt.lastObservedDrift?.snapshot).toEqual(input);
    // Planner parity itself still holds — drift is a contract problem, not a
    // planner problem, and the two counters must not conflate.
    expect(receipt.disagreed).toBe(0);
  });

  it("the recorder never throws and the reset seam restores a clean slate", () => {
    expect(() =>
      recordStudioFilterExecutionShadow(
        null as unknown as StudioFilterExecutionRouteSnapshotInput,
        "worker",
      ),
    ).not.toThrow();
    resetStudioFilterPlanShadowReceipt();
    const receipt = readStudioFilterPlanShadowReceipt();
    expect(receipt.total).toBe(0);
    expect(receipt.invalidInput).toBe(0);
  });
});
