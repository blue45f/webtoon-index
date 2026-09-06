import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT,
  type StudioBrushBackendAvailability,
  type StudioBrushBackendId,
} from "./brush/studio-brush-backend-quality-policy";
import { studioBrushPackDescriptorById } from "./brush/studio-brush-pack-index";
import {
  STUDIO_PROFESSIONAL_SHELF_GENERIC_RUNTIME_CARRIERS,
  STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS,
  STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACT_VERSION,
  STUDIO_PROFESSIONAL_SHELF_TARGET_IDS,
  inspectStudioProfessionalShelfRouteAlignment,
  resolveStudioProfessionalShelfRoute,
} from "./studio-professional-shelf-route-contract";

function availabilitySnapshot(
  availability: StudioBrushBackendAvailability,
): Record<StudioBrushBackendId, StudioBrushBackendAvailability> {
  return Object.fromEntries(
    STUDIO_BRUSH_BACKEND_INTEGRATION_AUDIT.map(({ id }) => [id, availability]),
  ) as Record<StudioBrushBackendId, StudioBrushBackendAvailability>;
}

describe("professional brush shelf route inventory", () => {
  it("pins every audited bristle, knife and physical FX target to one immutable contract", () => {
    expect(STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACT_VERSION).toBe(1);
    expect(STUDIO_PROFESSIONAL_SHELF_TARGET_IDS).toHaveLength(11);
    expect(STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS).toHaveLength(11);
    expect(new Set(STUDIO_PROFESSIONAL_SHELF_TARGET_IDS).size).toBe(11);
    expect(new Set(
      STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS.map(({ catalogId }) => catalogId),
    ).size).toBe(11);
    expect(STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS.map(({ catalogId }) => catalogId))
      .toEqual(STUDIO_PROFESSIONAL_SHELF_TARGET_IDS);

    for (const contract of STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS) {
      const descriptor = studioBrushPackDescriptorById(contract.catalogId);
      expect(descriptor, contract.catalogId).not.toBeNull();
      expect(descriptor?.runtimeBrushId, contract.catalogId)
        .toBe(contract.genericRuntimeCarrier);
      expect(STUDIO_PROFESSIONAL_SHELF_GENERIC_RUNTIME_CARRIERS)
        .toContain(contract.genericRuntimeCarrier);
      expect(contract.contractVersion).toBe(1);
      expect(contract.candidates.length, contract.catalogId).toBeGreaterThan(0);
      expect(contract.unavailablePolicy).toEqual({
        behavior: "fail-closed",
        preserveExistingSurface: true,
        emitApproximation: false,
      });
      expect(Object.isFrozen(contract), contract.catalogId).toBe(true);
      expect(Object.isFrozen(contract.candidates), contract.catalogId).toBe(true);
      expect(Object.isFrozen(contract.unavailablePolicy), contract.catalogId).toBe(true);
    }
  });

  it("declares the intended material family, specialist profile and semantic contract", () => {
    const byId = new Map(
      STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS.map((contract) => [
        contract.catalogId,
        contract,
      ]),
    );
    expect(byId.get("bristle-round-loaded")).toMatchObject({
      family: "wet-media",
      routeProfile: "wet-specialist",
      semanticProfile: "loaded-bristle-v1",
    });
    expect(byId.get("bristle-fan-dry")).toMatchObject({
      family: "dry-media",
      routeProfile: "dry-specialist",
      semanticProfile: "dry-bristle-v1",
    });
    expect(byId.get("bristle-flat-streak")).toMatchObject({
      family: "wet-media",
      routeProfile: "wet-specialist",
      semanticProfile: "loaded-bristle-v1",
    });
    expect(byId.get("oil-filbert")).toMatchObject({
      family: "wet-media",
      routeProfile: "wet-specialist",
      semanticProfile: "loaded-bristle-v1",
    });
    expect(byId.get("palette-knife-edge")).toMatchObject({
      family: "wet-media",
      routeProfile: "wet-specialist",
      semanticProfile: "palette-knife-edge-v1",
      candidates: [{
        liveBackend: "canvas2d-material-specialist",
        commitBackend: "canvas2d-material-specialist",
        semanticContract: "retained-wet-material-v1",
      }],
    });
    for (const id of [
      "smoke-wisp-layered",
      "flame-tongue-spark",
      "snow-powder-drift",
      "dust-mote-depth",
      "stage-safe-splatter",
      "leaf-fall-flurry",
    ] as const) {
      expect(byId.get(id), id).toMatchObject({
        family: "spray-particle",
        routeProfile: "spray-specialist",
        semanticProfile: "physics-particle-v1",
        candidates: [{
          liveBackend: "physics-particle-worker",
          commitBackend: "physics-particle-worker",
          semanticContract: "physics-particle-v1",
        }],
      });
    }
  });
});

describe("professional brush shelf route downgrade audit", () => {
  it("aligns the connected bristle/knife carrier while keeping unwired physics FX honest", () => {
    for (const catalogId of [
      "bristle-round-loaded",
      "bristle-fan-dry",
      "bristle-flat-streak",
      "oil-filbert",
      "palette-knife-edge",
    ] as const) {
      expect(inspectStudioProfessionalShelfRouteAlignment(catalogId)).toMatchObject({
        status: "aligned",
        currentRouteProfile: catalogId === "bristle-fan-dry"
          ? "dry-specialist"
          : "wet-specialist",
      });
    }
    for (const contract of STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS.slice(5)) {
      const alignment = inspectStudioProfessionalShelfRouteAlignment(
        contract.catalogId,
      );
      expect(alignment.status, contract.catalogId)
        .toBe("generic-carrier-downgrade");
      if (alignment.status !== "generic-carrier-downgrade") continue;
      expect(alignment.currentGenericCarrier, contract.catalogId)
        .toBe(contract.genericRuntimeCarrier);
      expect(alignment.currentRouteProfile, contract.catalogId)
        .not.toBe(contract.routeProfile);
    }
  });

  it("does not classify ordinary catalogue ids as managed specialist targets", () => {
    expect(inspectStudioProfessionalShelfRouteAlignment("gpen")).toEqual({
      status: "unmanaged",
    });
    expect(inspectStudioProfessionalShelfRouteAlignment(null)).toEqual({
      status: "unmanaged",
    });
  });
});

describe("professional brush shelf route admission", () => {
  it("blocks by default even when a backend audit has a ready default", () => {
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "palette-knife-edge",
    })).toMatchObject({
      status: "blocked",
      reason: "specialist-backend-unavailable",
      preserveExistingSurface: true,
      emitApproximation: false,
    });
  });

  it("does not let the generic dynamic coverage backend satisfy a specialist contract", () => {
    const availability = availabilitySnapshot("unavailable");
    availability["canvas2d-dynamic-coverage"] = "ready";
    availability["canvas2d-stamp-pattern"] = "ready";

    for (const catalogId of STUDIO_PROFESSIONAL_SHELF_TARGET_IDS) {
      expect(resolveStudioProfessionalShelfRoute({
        catalogId,
        availability,
      }), catalogId).toMatchObject({
        status: "blocked",
        reason: "specialist-backend-unavailable",
        preserveExistingSurface: true,
        emitApproximation: false,
      });
    }
  });

  it("selects a bristle backend only after the exact live/commit provider is ready", () => {
    const unavailable = availabilitySnapshot("unavailable");
    unavailable["professional-bristle-webgpu"] = "loading";
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "bristle-round-loaded",
      availability: unavailable,
    })).toMatchObject({
      status: "pending",
      reason: "specialist-backend-loading",
      preserveExistingSurface: true,
      emitApproximation: false,
    });

    const ready = availabilitySnapshot("unavailable");
    ready["professional-bristle-webgpu"] = "ready";
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "bristle-round-loaded",
      availability: ready,
    })).toMatchObject({
      status: "ready",
      liveBackend: "professional-bristle-webgpu",
      commitBackend: "professional-bristle-webgpu",
      semanticContract: "professional-loaded-bristle-v1",
    });
  });

  it("uses deterministic priority and an exact fallback, never a generic carrier", () => {
    const availability = availabilitySnapshot("unavailable");
    availability["professional-bristle-webgpu"] = "failed";
    availability["fiber-bristle-worker"] = "ready";
    availability["canvas2d-material-specialist"] = "ready";

    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "bristle-fan-dry",
      availability,
    })).toMatchObject({
      status: "ready",
      liveBackend: "fiber-bristle-worker",
      commitBackend: "fiber-bristle-worker",
      semanticContract: "individual-fiber-dry-v1",
    });
  });

  it("admits physical FX only when its physics provider explicitly reports ready", () => {
    const loading = availabilitySnapshot("unavailable");
    loading["physics-particle-worker"] = "loading";
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "smoke-wisp-layered",
      availability: loading,
    })).toMatchObject({
      status: "pending",
      reason: "specialist-backend-loading",
    });

    const ready = availabilitySnapshot("unavailable");
    ready["physics-particle-worker"] = "ready";
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "smoke-wisp-layered",
      availability: ready,
    })).toMatchObject({
      status: "ready",
      liveBackend: "physics-particle-worker",
      commitBackend: "physics-particle-worker",
      semanticContract: "physics-particle-v1",
    });
  });

  it("leaves non-target brushes unmanaged without manufacturing a route", () => {
    expect(resolveStudioProfessionalShelfRoute({
      catalogId: "gpen",
      availability: availabilitySnapshot("ready"),
    })).toEqual({ status: "unmanaged" });
  });
});
