import { RemoteKillSwitch, WinnerCache } from "@toonspectrum/studio-engine-registry";
import { describe, expect, it } from "vitest";

import {
  STUDIO_STROKE_ROUTE_TOURNAMENT_LANES,
  selectStudioStrokeRoute,
  studioStrokeRouteBrushFamilyKey,
  studioStrokeRouteBucket,
  studioStrokeRoutePointBand,
  studioStrokeRouteProviderId,
  studioStrokeRouteScaleBand,
  type StudioStrokeRouteTournamentState,
  type StudioStrokeRouteWorkloadTraits,
} from "./studio-stroke-route-tournament";
import { STUDIO_STROKE_SURFACE_ROUTE_PRIORITY } from "./studio-stroke-surface-route";

/**
 * Observation-only tournament projection. Product pointer-down does not consume this ordering:
 * it selects one surface from brush/document capability before any side-effecting begin call.
 */

const TRAITS: StudioStrokeRouteWorkloadTraits = {
  pointCount: 40,
  brushFamily: "wet-ink",
  canvasScale: 1,
};

function pristineState(deviceHash = "device-a"): StudioStrokeRouteTournamentState {
  return {
    deviceHash,
    winnerCache: new WinnerCache(),
    killSwitch: new RemoteKillSwitch(),
  };
}

function winnerEntry(providerId: string) {
  return { providerId, expectedWarmMs: 2, decidedAtSample: 4 };
}

describe("selectStudioStrokeRoute — observation-only projection", () => {
  it("keeps pristine observation input unchanged", () => {
    const result = selectStudioStrokeRoute({
      lanes: ["gpu", "wet-ink", "konva"],
      traits: TRAITS,
      state: pristineState(),
    });
    expect(result).toMatchObject({
      lanes: ["gpu", "wet-ink", "konva"],
      killedLanes: [],
      promotedLane: null,
      unavailableReason: null,
      bucket: studioStrokeRouteBucket(TRAITS),
    });
  });

  it("projects a cached winner without mutating caller input", () => {
    const state = pristineState();
    state.winnerCache.set(
      studioStrokeRouteBucket(TRAITS),
      state.deviceHash,
      winnerEntry(studioStrokeRouteProviderId("wet-ink")),
    );
    const lanes = ["gpu", "live-ink", "wet-ink", "konva"] as const;
    const result = selectStudioStrokeRoute({ lanes, traits: TRAITS, state });
    expect(result.lanes).toEqual(["wet-ink", "gpu", "live-ink", "konva"]);
    expect(result.promotedLane).toBe("wet-ink");
    expect(lanes).toEqual(["gpu", "live-ink", "wet-ink", "konva"]);
  });

  it("does not reuse a winner from another bucket or device", () => {
    const state = pristineState("device-a");
    state.winnerCache.set(
      studioStrokeRouteBucket({ ...TRAITS, pointCount: 5_000 }),
      state.deviceHash,
      winnerEntry(studioStrokeRouteProviderId("konva")),
    );
    state.winnerCache.set(
      studioStrokeRouteBucket(TRAITS),
      "device-b",
      winnerEntry(studioStrokeRouteProviderId("konva")),
    );
    expect(selectStudioStrokeRoute({
      lanes: ["gpu", "konva"],
      traits: TRAITS,
      state,
    })).toMatchObject({ lanes: ["gpu", "konva"], promotedLane: null });
  });

  it("reports kill projection but exposes no pointer-down admission API", () => {
    const state = pristineState();
    state.killSwitch.kill(studioStrokeRouteProviderId("gpu"), "remote flag");
    const result = selectStudioStrokeRoute({
      lanes: ["gpu", "wet-ink", "konva"],
      traits: TRAITS,
      state,
    });
    expect(result).toMatchObject({
      lanes: ["wet-ink", "konva"],
      killedLanes: ["gpu"],
      promotedLane: null,
    });
  });

  it("reports explicit unavailability instead of restoring all-killed candidates", () => {
    const state = pristineState();
    for (const kind of ["gpu", "konva"] as const) {
      state.killSwitch.kill(studioStrokeRouteProviderId(kind), "panic");
    }
    const result = selectStudioStrokeRoute({
      lanes: ["gpu", "konva"],
      traits: TRAITS,
      state,
    });
    expect(result.lanes).toEqual([]);
    expect(result.killedLanes).toEqual(["gpu", "konva"]);
    expect(result.promotedLane).toBeNull();
    expect(result.unavailableReason).toBe("all-providers-killed");
  });

  it("ignores a killed or absent observed winner", () => {
    const state = pristineState();
    state.winnerCache.set(
      studioStrokeRouteBucket(TRAITS),
      state.deviceHash,
      winnerEntry(studioStrokeRouteProviderId("live-ink")),
    );
    state.killSwitch.kill(studioStrokeRouteProviderId("live-ink"), "regression");
    expect(selectStudioStrokeRoute({
      lanes: ["gpu", "live-ink", "konva"],
      traits: TRAITS,
      state,
    })).toMatchObject({ lanes: ["gpu", "konva"], promotedLane: null });

    const absentWinnerState = pristineState();
    absentWinnerState.winnerCache.set(
      studioStrokeRouteBucket(TRAITS),
      absentWinnerState.deviceHash,
      winnerEntry(studioStrokeRouteProviderId("hokusai")),
    );
    expect(selectStudioStrokeRoute({
      lanes: ["gpu", "konva"],
      traits: TRAITS,
      state: absentWinnerState,
    })).toMatchObject({ lanes: ["gpu", "konva"], promotedLane: null });
  });
});

describe("stroke workload bucket derivation", () => {
  it("bands point counts deterministically", () => {
    expect(studioStrokeRoutePointBand(0)).toBe("micro");
    expect(studioStrokeRoutePointBand(16)).toBe("micro");
    expect(studioStrokeRoutePointBand(17)).toBe("short");
    expect(studioStrokeRoutePointBand(128)).toBe("short");
    expect(studioStrokeRoutePointBand(129)).toBe("long");
    expect(studioStrokeRoutePointBand(1024)).toBe("long");
    expect(studioStrokeRoutePointBand(1025)).toBe("marathon");
    expect(studioStrokeRoutePointBand(Number.NaN)).toBe("micro");
    expect(studioStrokeRoutePointBand(-5)).toBe("micro");
  });

  it("bands scale and rejects degenerate values into the stable base bucket", () => {
    expect(studioStrokeRouteScaleBand(0.25)).toBe("sub");
    expect(studioStrokeRouteScaleBand(0.5)).toBe("base");
    expect(studioStrokeRouteScaleBand(1.99)).toBe("base");
    expect(studioStrokeRouteScaleBand(2)).toBe("zoomed");
    expect(studioStrokeRouteScaleBand(Number.NaN)).toBe("base");
    expect(studioStrokeRouteScaleBand(0)).toBe("base");
  });

  it("normalizes brush families without allowing bucket separator injection", () => {
    expect(studioStrokeRouteBrushFamilyKey(" Wet Ink ")).toBe("wet-ink");
    expect(studioStrokeRouteBrushFamilyKey("GPU|hack")).toBe("gpu-hack");
    expect(studioStrokeRouteBrushFamilyKey("   ")).toBe("unknown");
  });

  it("keeps unlike workload traits in distinct buckets", () => {
    expect(studioStrokeRouteBucket(TRAITS)).toBe(
      "studio-stroke-route|wet-ink|pts:short|scale:base",
    );
    const variants: StudioStrokeRouteWorkloadTraits[] = [
      TRAITS,
      { ...TRAITS, pointCount: 5_000 },
      { ...TRAITS, brushFamily: "dry-pencil" },
      { ...TRAITS, canvasScale: 4 },
    ];
    expect(new Set(variants.map(studioStrokeRouteBucket)).size).toBe(variants.length);
  });

  it("covers every shadow provider id while exporting no executable chain", () => {
    expect(STUDIO_STROKE_ROUTE_TOURNAMENT_LANES).toEqual(
      STUDIO_STROKE_SURFACE_ROUTE_PRIORITY,
    );
    for (const kind of STUDIO_STROKE_SURFACE_ROUTE_PRIORITY) {
      expect(studioStrokeRouteProviderId(kind)).toBe(`stroke-route-${kind}`);
    }
  });
});
