import { describe, expect, it } from "vitest";

import {
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY,
  claimStudioStrokeSurfaceLifecycle,
  resolveStudioStrokeSurfaceRoute,
  studioStrokeSurfaceRouteFailurePolicy,
  studioStrokeSurfaceRouteSuppressesDraft,
  type StudioStrokeSurfaceRouteKind,
  type StudioStrokeSurfaceRouteSnapshotInput,
} from "./studio-stroke-surface-route";

function snapshot(
  overrides: Partial<StudioStrokeSurfaceRouteSnapshotInput> = {},
): StudioStrokeSurfaceRouteSnapshotInput {
  return {
    strokeId: "stroke-7",
    pointerId: 3,
    strokeEpoch: 11,
    livingInk: {
      eligible: false,
      providerState: "unavailable",
      capabilitiesAccepted: false,
      admitted: false,
    },
    hokusai: { admitted: false, surface: "supported" },
    stampAdmitted: false,
    gpuAdmitted: false,
    liveInkAdmitted: false,
    wetInkAdmitted: false,
    dynamicAdmitted: false,
    ...overrides,
  };
}

describe("Studio stroke surface pointer-down route", () => {
  it("keeps the audited Studio specialist priority mutually exclusive", () => {
    expect(STUDIO_STROKE_SURFACE_ROUTE_PRIORITY).toEqual([
      "living-ink",
      "hokusai",
      "stamp",
      "gpu",
      "live-ink",
      "wet-ink",
      "dynamic",
      "konva",
    ]);

    const cases: ReadonlyArray<readonly [
      StudioStrokeSurfaceRouteKind,
      Partial<StudioStrokeSurfaceRouteSnapshotInput>,
    ]> = [
      ["living-ink", {
        livingInk: {
          eligible: true,
          providerState: "ready",
          capabilitiesAccepted: true,
          admitted: true,
        },
        hokusai: { admitted: true, surface: "supported" },
        stampAdmitted: true,
        gpuAdmitted: true,
        liveInkAdmitted: true,
        wetInkAdmitted: true,
        dynamicAdmitted: true,
      }],
      ["hokusai", {
        hokusai: { admitted: true, surface: "supported" },
        stampAdmitted: true,
        gpuAdmitted: true,
        liveInkAdmitted: true,
        wetInkAdmitted: true,
        dynamicAdmitted: true,
      }],
      ["stamp", {
        stampAdmitted: true,
        gpuAdmitted: true,
        liveInkAdmitted: true,
        wetInkAdmitted: true,
        dynamicAdmitted: true,
      }],
      ["gpu", {
        gpuAdmitted: true,
        liveInkAdmitted: true,
        wetInkAdmitted: true,
        dynamicAdmitted: true,
      }],
      ["live-ink", {
        liveInkAdmitted: true,
        wetInkAdmitted: true,
        dynamicAdmitted: true,
      }],
      ["wet-ink", { wetInkAdmitted: true, dynamicAdmitted: true }],
      ["dynamic", { dynamicAdmitted: true }],
      ["konva", {}],
    ];

    for (const [expected, overrides] of cases) {
      const route = resolveStudioStrokeSurfaceRoute(snapshot(overrides));
      expect(route.kind).toBe(expected);
      expect(route.ownership).toBe("pinned-for-entire-stroke");
      expect(route.midStrokePromotion).toBe(false);
      expect(Object.isFrozen(route)).toBe(true);
    }
  });

  it.each(["loading", "unavailable", "failed"] as const)(
    "pins a %s Living Ink provider to the whole-stroke wet fallback",
    (providerState) => {
      const route = resolveStudioStrokeSurfaceRoute(snapshot({
        livingInk: {
          eligible: true,
          providerState,
          capabilitiesAccepted: false,
          admitted: false,
        },
        wetInkAdmitted: true,
      }));
      expect(route.kind).toBe("wet-ink");
      expect(route.reason).toBe(`living-ink-provider-${providerState}`);

      const nextPointerDown = resolveStudioStrokeSurfaceRoute(snapshot({
        strokeEpoch: 12,
        livingInk: {
          eligible: true,
          providerState: "ready",
          capabilitiesAccepted: true,
          admitted: true,
        },
        wetInkAdmitted: true,
      }));
      expect(nextPointerDown.kind).toBe("living-ink");
      expect(route.kind).toBe("wet-ink");
      expect(nextPointerDown.routeKey).not.toBe(route.routeKey);
    },
  );

  it("fails closed on rejected or malformed Living Ink capabilities", () => {
    const rejected = resolveStudioStrokeSurfaceRoute(snapshot({
      livingInk: {
        eligible: true,
        providerState: "ready",
        capabilitiesAccepted: false,
        admitted: true,
      },
      wetInkAdmitted: true,
    }));
    expect(rejected).toMatchObject({
      kind: "wet-ink",
      reason: "living-ink-capabilities-rejected",
    });

    const malformed = resolveStudioStrokeSurfaceRoute(snapshot({
      livingInk: {
        eligible: true,
        providerState: "future-state",
        capabilitiesAccepted: "yes",
        admitted: true,
      } as unknown as StudioStrokeSurfaceRouteSnapshotInput["livingInk"],
    }));
    expect(malformed).toMatchObject({
      kind: "konva",
      reason: "living-ink-provider-invalid",
    });

    expect(resolveStudioStrokeSurfaceRoute(snapshot({ pointerId: Number.NaN })))
      .toMatchObject({ kind: "konva", reason: "invalid-pointerdown-snapshot" });
  });

  it.each([
    ["flip-unsupported", "hokusai-flip-unsupported"],
    ["rotation-unsupported", "hokusai-rotation-unsupported"],
    ["unavailable", "hokusai-surface-unavailable"],
  ] as const)("does not admit Hokusai on a %s surface", (surface, reason) => {
    const fallback = resolveStudioStrokeSurfaceRoute(snapshot({
      hokusai: { admitted: true, surface },
      stampAdmitted: true,
    }));
    expect(fallback.kind).toBe("stamp");

    const konva = resolveStudioStrokeSurfaceRoute(snapshot({
      hokusai: { admitted: true, surface },
    }));
    expect(konva).toMatchObject({ kind: "konva", reason });
  });
});

describe("Studio stroke surface pinned lifecycle", () => {
  const route = resolveStudioStrokeSurfaceRoute(snapshot({
    livingInk: {
      eligible: true,
      providerState: "ready",
      capabilitiesAccepted: true,
      admitted: true,
    },
  }));

  it.each(["append", "finish", "cancel", "handoff"] as const)(
    "keeps the exact pointer-down route as the %s owner",
    (phase) => {
      const ownership = claimStudioStrokeSurfaceLifecycle(route, {
        phase,
        routeKey: route.routeKey,
        strokeId: route.strokeId,
        kind: route.kind,
      });
      expect(ownership).toMatchObject({ status: "owned", phase, owner: "living-ink" });
      if (ownership.status === "owned") expect(ownership.route).toBe(route);
    },
  );

  it("rejects stale stroke, route, and kind claims instead of rerouting", () => {
    const base = {
      phase: "append" as const,
      routeKey: route.routeKey,
      strokeId: route.strokeId,
      kind: route.kind,
    };
    expect(claimStudioStrokeSurfaceLifecycle(route, { ...base, routeKey: "stale" }))
      .toEqual({ status: "rejected", reason: "route-key-mismatch" });
    expect(claimStudioStrokeSurfaceLifecycle(route, { ...base, strokeId: "other" }))
      .toEqual({ status: "rejected", reason: "stroke-id-mismatch" });
    expect(claimStudioStrokeSurfaceLifecycle(route, { ...base, kind: "konva" }))
      .toEqual({ status: "rejected", reason: "route-kind-mismatch" });
  });

  it("suppresses the retained draft only after the exact route presents", () => {
    expect(studioStrokeSurfaceRouteSuppressesDraft(route, {
      routeKey: route.routeKey,
      kind: route.kind,
      status: "pending",
    })).toBe(false);
    expect(studioStrokeSurfaceRouteSuppressesDraft(route, {
      routeKey: route.routeKey,
      kind: route.kind,
      status: "failed",
    })).toBe(false);
    expect(studioStrokeSurfaceRouteSuppressesDraft(route, {
      routeKey: route.routeKey,
      kind: route.kind,
      status: "presented",
    })).toBe(true);
    expect(studioStrokeSurfaceRouteSuppressesDraft(route, {
      routeKey: "stale",
      kind: route.kind,
      status: "presented",
    })).toBe(false);

    const konva = resolveStudioStrokeSurfaceRoute(snapshot());
    expect(studioStrokeSurfaceRouteSuppressesDraft(konva, {
      routeKey: konva.routeKey,
      kind: konva.kind,
      status: "presented",
    })).toBe(false);
  });

  it.each(["provider-failed", "device-lost", "surface-lost"] as const)(
    "retains route identity after %s and defers reevaluation to the next pointer-down",
    (cause) => {
      const policy = studioStrokeSurfaceRouteFailurePolicy(route, cause);
      expect(policy).toMatchObject({
        cause,
        owner: "living-ink",
        action: "retain-pinned-route",
        allowProviderSubstitution: false,
        alternateSelection: "explicit-next-pointerdown-only",
        presentation: "preserve-last-presented-frame",
      });
      expect(policy.route).toBe(route);
    },
  );
});
