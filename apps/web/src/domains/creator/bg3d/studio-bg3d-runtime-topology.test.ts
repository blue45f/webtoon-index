import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_RUNTIME_CATALOG,
  planStudioBg3dRuntimeTopology,
} from "./studio-bg3d-runtime-topology";

const baseRequest = {
  availableRuntimeIds: ["three-webgl"] as const,
  primaryCapabilities: ["interactive-editing", "capture-rgba-depth"] as const,
  allowLabRuntimes: false,
  webgpuSupported: false,
  maximumActivationGzipBytes: 500_000,
};

describe("Studio BG3D runtime topology policy", () => {
  it("exposes capability catalogs without mutable Set methods", () => {
    const capabilities = STUDIO_BG3D_RUNTIME_CATALOG["three-webgl"].capabilities;
    expect(capabilities.has("webgl")).toBe(true);
    expect("add" in capabilities).toBe(false);
    expect("delete" in capabilities).toBe(false);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(STUDIO_BG3D_RUNTIME_CATALOG["three-webgpu"].capabilities.has("webxr"))
      .toBe(false);
    expect(STUDIO_BG3D_RUNTIME_CATALOG["three-webgpu"].capabilities.has("compute")).toBe(true);
    expect(STUDIO_BG3D_RUNTIME_CATALOG["three-webgpu"].maturity).toBe("production");
    expect(capabilities.has("multi-artifact-capture")).toBe(false);
    expect(STUDIO_BG3D_RUNTIME_CATALOG["babylon-webgl-lab"].capabilities
      .has("multi-artifact-capture")).toBe(true);
    expect(STUDIO_BG3D_RUNTIME_CATALOG["babylon-webgpu-lab"].capabilities
      .has("multi-artifact-capture")).toBe(true);
  });

  it("keeps one production Three owner for the default editor", () => {
    expect(planStudioBg3dRuntimeTopology(baseRequest)).toEqual({
      ok: true,
      primaryRuntimeId: "three-webgl",
      specialists: [],
      totalActivationGzipBytes: 80_000,
      diagnostics: [],
      boundary: "scene-document+verified-glb-snapshots",
      singleInteractiveOwner: true,
    });
  });

  it("uses Babylon only as an isolated specialist when a registered lab adapter adds value", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["three-webgl", "babylon-webgl-lab"],
      allowLabRuntimes: true,
      maximumActivationGzipBytes: 500_000,
      specialistJobs: [
        { id: "physics-preview", requiredCapabilities: ["physics"] },
        { id: "thumbnail", requiredCapabilities: ["capture-rgba-depth"] },
      ],
    });

    expect(plan).toMatchObject({
      ok: true,
      primaryRuntimeId: "three-webgl",
      totalActivationGzipBytes: 386_000,
      singleInteractiveOwner: true,
      specialists: [
        { jobId: "physics-preview", runtimeId: "babylon-webgl-lab", isolated: true },
        { jobId: "thumbnail", runtimeId: "three-webgl", isolated: false },
      ],
    });
  });

  it("routes depth-aware webtoon FX to an isolated Babylon WebGPU specialist", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: [
        "three-webgl",
        "babylon-webgl-lab",
        "babylon-webgpu-lab",
      ],
      allowLabRuntimes: true,
      webgpuSupported: true,
      maximumActivationGzipBytes: 500_000,
      specialistJobs: [{
        id: "webtoon-fx-preview",
        requiredCapabilities: ["capture-rgba-depth", "webtoon-scene-fx"],
      }],
    });

    expect(plan).toMatchObject({
      ok: true,
      primaryRuntimeId: "three-webgl",
      totalActivationGzipBytes: 351_000,
      singleInteractiveOwner: true,
      specialists: [{
        jobId: "webtoon-fx-preview",
        runtimeId: "babylon-webgpu-lab",
        isolated: true,
      }],
    });

    const webglFallback = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: [
        "three-webgl",
        "babylon-webgl-lab",
        "babylon-webgpu-lab",
      ],
      allowLabRuntimes: true,
      maximumActivationGzipBytes: 500_000,
      specialistJobs: [{
        id: "webtoon-fx-preview",
        requiredCapabilities: ["capture-rgba-depth", "webtoon-scene-fx"],
      }],
    });
    expect(webglFallback).toMatchObject({
      ok: true,
      primaryRuntimeId: "three-webgl",
      totalActivationGzipBytes: 386_000,
      specialists: [{
        jobId: "webtoon-fx-preview",
        runtimeId: "babylon-webgl-lab",
        isolated: true,
      }],
    });
  });

  it("routes multi-artifact capture only to an isolated Babylon specialist", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: [
        "three-webgl",
        "babylon-webgl-lab",
        "babylon-webgpu-lab",
      ],
      allowLabRuntimes: true,
      webgpuSupported: true,
      maximumActivationGzipBytes: 500_000,
      specialistJobs: [{
        id: "multi-artifact-capture",
        requiredCapabilities: ["capture-rgba-depth", "multi-artifact-capture"],
      }],
    });

    expect(plan).toMatchObject({
      ok: true,
      primaryRuntimeId: "three-webgl",
      totalActivationGzipBytes: 351_000,
      specialists: [{
        jobId: "multi-artifact-capture",
        runtimeId: "babylon-webgpu-lab",
        isolated: true,
      }],
    });
  });

  it("never promotes a Babylon FX specialist to the interactive editor owner", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["babylon-webgpu-lab"],
      allowLabRuntimes: true,
      webgpuSupported: true,
      primaryCapabilities: ["interactive-editing", "webgpu"],
    });

    expect(plan).toMatchObject({
      ok: false,
      primaryRuntimeId: null,
      specialists: [],
    });
    expect(plan.diagnostics).toContain("no-primary-runtime");
  });

  it("routes web-native splat/compute and domain rendering to isolated specialist adapters", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: [
        "three-webgl",
        "playcanvas-webgpu-lab",
        "filament-webgl-lab",
        "cesium-webgl-lab",
        "vtk-webgl-lab",
      ],
      allowLabRuntimes: true,
      webgpuSupported: true,
      maximumActivationGzipBytes: 2_000_000,
      specialistJobs: [
        { id: "splat-preview", requiredCapabilities: ["gaussian-splatting", "compute"] },
        { id: "pbr-golden", requiredCapabilities: ["material-conformance"] },
        { id: "city-stream", requiredCapabilities: ["geospatial-streaming"] },
        { id: "volume-iso", requiredCapabilities: ["scientific-volume"] },
      ],
    });

    expect(plan.specialists).toEqual([
      { jobId: "splat-preview", runtimeId: "playcanvas-webgpu-lab", isolated: true },
      { jobId: "pbr-golden", runtimeId: "filament-webgl-lab", isolated: true },
      { jobId: "city-stream", runtimeId: "cesium-webgl-lab", isolated: true },
      { jobId: "volume-iso", runtimeId: "vtk-webgl-lab", isolated: true },
    ]);
    expect(plan.singleInteractiveOwner).toBe(true);
  });

  it("keeps additional domain engines behind narrow capabilities instead of making them editors", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: [
        "three-webgl",
        "three-spark-webgl-lab",
        "xeokit-webgl-lab",
        "potree-webgl-lab",
        "deckgl-webgl-lab",
        "maplibre-webgl-lab",
        "wonderland-wasm-webgl-lab",
      ],
      allowLabRuntimes: true,
      maximumActivationGzipBytes: 3_000_000,
      specialistJobs: [
        { id: "splat", requiredCapabilities: ["gaussian-splatting"] },
        { id: "bim", requiredCapabilities: ["bim-semantic-model"] },
        { id: "point-cloud", requiredCapabilities: ["point-cloud-streaming"] },
        { id: "data-layers", requiredCapabilities: ["geospatial-data-layers"] },
        { id: "vector-map", requiredCapabilities: ["vector-map-streaming"] },
        { id: "xr", requiredCapabilities: ["webxr", "wasm-runtime"] },
      ],
    });

    expect(plan.primaryRuntimeId).toBe("three-webgl");
    expect(plan.specialists).toEqual([
      { jobId: "splat", runtimeId: "three-spark-webgl-lab", isolated: true },
      { jobId: "bim", runtimeId: "xeokit-webgl-lab", isolated: true },
      { jobId: "point-cloud", runtimeId: "potree-webgl-lab", isolated: true },
      { jobId: "data-layers", runtimeId: "deckgl-webgl-lab", isolated: true },
      { jobId: "vector-map", runtimeId: "maplibre-webgl-lab", isolated: true },
      { jobId: "xr", runtimeId: "wonderland-wasm-webgl-lab", isolated: true },
    ]);
    expect(plan.singleInteractiveOwner).toBe(true);
  });

  it("does not load a second engine when the cumulative activation budget would be exceeded", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["three-webgl", "babylon-webgl-lab"],
      allowLabRuntimes: true,
      maximumActivationGzipBytes: 350_000,
      specialistJobs: [{ id: "physics-preview", requiredCapabilities: ["physics"] }],
    });

    expect(plan).toMatchObject({
      ok: true,
      primaryRuntimeId: "three-webgl",
      specialists: [],
      totalActivationGzipBytes: 80_000,
    });
    expect(plan.diagnostics).toEqual(["activation-budget-exceeded", "specialist-unavailable"]);
  });

  it("selects WebGPU only when the device actually supports it", () => {
    const unsupported = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["three-webgpu"],
      primaryCapabilities: ["interactive-editing", "webgpu"],
    });
    expect(unsupported).toMatchObject({ ok: false, primaryRuntimeId: null });
    expect(unsupported.diagnostics).toContain("webgpu-unavailable");

    const supported = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["three-webgpu", "babylon-webgpu-lab"],
      allowLabRuntimes: true,
      webgpuSupported: true,
      primaryCapabilities: ["interactive-editing", "webgpu"],
    });
    expect(supported).toMatchObject({ ok: true, primaryRuntimeId: "three-webgpu" });
  });

  it("honors a caller-selected primary runtime over the default preference order", () => {
    const bothAvailable = {
      ...baseRequest,
      availableRuntimeIds: ["three-webgl", "three-webgpu"] as const,
      webgpuSupported: true,
    };
    // Default ordering prefers the cheaper production runtime.
    expect(planStudioBg3dRuntimeTopology({ ...bothAvailable }))
      .toMatchObject({ ok: true, primaryRuntimeId: "three-webgl" });

    expect(planStudioBg3dRuntimeTopology({
      ...bothAvailable,
      preferredPrimaryRuntimeId: "three-webgpu",
    })).toMatchObject({ ok: true, primaryRuntimeId: "three-webgpu", diagnostics: [] });
  });

  it("fails closed when the explicitly selected primary is unavailable", () => {
    const plan = planStudioBg3dRuntimeTopology({
      ...baseRequest,
      availableRuntimeIds: ["three-webgl", "three-webgpu"],
      webgpuSupported: false,
      preferredPrimaryRuntimeId: "three-webgpu",
    });
    expect(plan).toMatchObject({
      ok: false,
      primaryRuntimeId: null,
      specialists: [],
      totalActivationGzipBytes: 0,
    });
    expect(plan.diagnostics).toContain("preferred-runtime-unavailable");
    expect(plan.diagnostics).toContain("no-primary-runtime");
  });

  it("fails closed for malformed requests and unavailable primary capabilities", () => {
    expect(planStudioBg3dRuntimeTopology({
      ...baseRequest,
      primaryCapabilities: ["capture-rgba-depth"],
    })).toMatchObject({ ok: false, diagnostics: ["invalid-request"] });

    expect(planStudioBg3dRuntimeTopology({
      ...baseRequest,
      primaryCapabilities: ["interactive-editing", "physics"],
    })).toMatchObject({ ok: false, diagnostics: ["no-primary-runtime"] });
  });
});
