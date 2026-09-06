import { describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES,
  latchStudioBg3dWebglOnlyFeatures,
  normalizeStudioBg3dEnginePreference,
  resolveStudioBg3dEngineRuntime,
  selectStudioBg3dEngine,
  STUDIO_BG3D_EDITOR_ACTIVATION_BUDGET_GZIP_BYTES,
  STUDIO_BG3D_EDITOR_REQUIRED_CAPABILITIES,
  STUDIO_BG3D_ENGINE_PREFERENCES,
  STUDIO_BG3D_ENGINE_SELECTION_NOTICES,
  type StudioBg3dEngineSelectionRequest,
} from "./studio-bg3d-engine-selection";
import { classifyStudioBg3dInAppBrowser } from "./studio-bg3d-inapp-browser";
import { STUDIO_BG3D_RUNTIME_CATALOG } from "./studio-bg3d-runtime-topology";

import type { StudioBg3dWebGpuProbeResult } from "./studio-bg3d-webgpu-capability";

const SUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: true,
  reason: "available",
  computeSupported: true,
  timestampQuerySupported: true,
  limits: Object.freeze({ maxBufferSize: 268_435_456 }),
});

const UNSUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: false,
  reason: "api-unavailable",
  computeSupported: false,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});

const STANDALONE = classifyStudioBg3dInAppBrowser({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/133.0 Safari/537.36",
});
const KAKAOTALK = classifyStudioBg3dInAppBrowser({
  userAgent: "Mozilla/5.0 (Linux; Android 15; wv) Mobile Safari/537.36 KAKAOTALK 10.6.5",
});
const INSTAGRAM = classifyStudioBg3dInAppBrowser({
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2) Mobile/15E148 Instagram 350.0",
});

const BASE: StudioBg3dEngineSelectionRequest = Object.freeze({
  preference: "webgpu",
  probe: SUPPORTED_PROBE,
  inApp: STANDALONE,
  deviceProfile: "desktop",
  webgpuRuntimeAvailable: true,
});

describe("Studio BG3D explicit engine selection", () => {
  it("exposes only explicit engines and migrates legacy auto to WebGPU", () => {
    expect(STUDIO_BG3D_ENGINE_PREFERENCES).toEqual(["webgpu", "webgl2"]);
    expect(normalizeStudioBg3dEnginePreference("auto")).toBe("webgpu");
    expect(normalizeStudioBg3dEnginePreference("unknown")).toBe("webgpu");
    expect(normalizeStudioBg3dEnginePreference("webgl2")).toBe("webgl2");
  });

  it("admits a supported explicit WebGPU selection without a fallback contract", () => {
    const plan = selectStudioBg3dEngine(BASE);
    expect(plan).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "available",
      reason: "user-webgpu-override",
      diagnostics: [],
    });
    expect(plan).not.toHaveProperty("fallbackBackend");
    expect(plan).not.toHaveProperty("webgpuSelectable");
  });

  it("keeps WebGPU selected but unavailable when capability admission fails", () => {
    expect(selectStudioBg3dEngine({ ...BASE, probe: UNSUPPORTED_PROBE })).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "unavailable",
      reason: "webgpu-probe-unsupported",
    });
    expect(selectStudioBg3dEngine({ ...BASE, webgpuRuntimeAvailable: false })).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "webgpu-runtime-unavailable",
    });
    expect(selectStudioBg3dEngine({
      ...BASE,
      probe: { ...SUPPORTED_PROBE, computeSupported: false },
    })).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "webgpu-compute-unavailable",
    });
    expect(selectStudioBg3dEngine({ ...BASE, inApp: INSTAGRAM })).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "inapp-browser-blocked",
    });
  });

  it("marks initialization or device loss failed without demoting the selection", () => {
    expect(selectStudioBg3dEngine({ ...BASE, webgpuRuntimeFailed: true })).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "failed",
      reason: "webgpu-runtime-failed",
    });
  });

  it("keeps opt-in, save-data, and memory signals advisory", () => {
    const plan = selectStudioBg3dEngine({
      ...BASE,
      inApp: KAKAOTALK,
      deviceProfile: "mobile",
      deviceMemoryGb: 2,
      saveData: true,
    });
    expect(plan).toMatchObject({ backend: "webgpu", status: "available" });
    expect(plan.diagnostics).toEqual([
      "inapp-browser-opt-in-required",
      "save-data-enabled",
      "low-device-memory",
    ]);
  });

  it("preserves an independent explicit WebGL2 engine even when WebGPU is unsupported", () => {
    const plan = selectStudioBg3dEngine({
      ...BASE,
      preference: "webgl2",
      probe: UNSUPPORTED_PROBE,
      webglOnlyFeatures: { webxr: true, vrmCharacters: true },
    });
    expect(plan).toMatchObject({
      backend: "webgl2",
      runtimeId: "three-webgl",
      status: "available",
      reason: "user-webgl2-override",
    });
    expect(plan.diagnostics).toContain("webgpu-probe-unsupported");
  });

  it("fails malformed input closed on WebGPU rather than mounting WebGL2", () => {
    expect(selectStudioBg3dEngine(undefined as unknown as StudioBg3dEngineSelectionRequest))
      .toMatchObject({
        backend: "webgpu",
        status: "unavailable",
        reason: "webgpu-probe-unsupported",
      });
  });
});

describe("Studio BG3D engine runtime resolution", () => {
  it("keeps the explicitly selected runtime when topology agrees", () => {
    expect(resolveStudioBg3dEngineRuntime(BASE)).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "available",
    });
    expect(resolveStudioBg3dEngineRuntime({ ...BASE, preference: "webgl2" })).toMatchObject({
      backend: "webgl2",
      runtimeId: "three-webgl",
      status: "available",
    });
  });

  it("does not ask topology to replace an unavailable WebGPU selection", () => {
    expect(resolveStudioBg3dEngineRuntime({ ...BASE, probe: UNSUPPORTED_PROBE })).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "unavailable",
      reason: "webgpu-probe-unsupported",
    });
  });

  it("requires both production runtimes to carry every editor capability", () => {
    for (const runtimeId of ["three-webgl", "three-webgpu"] as const) {
      for (const capability of STUDIO_BG3D_EDITOR_REQUIRED_CAPABILITIES) {
        expect(STUDIO_BG3D_RUNTIME_CATALOG[runtimeId].capabilities.has(capability)).toBe(true);
      }
      expect(STUDIO_BG3D_RUNTIME_CATALOG[runtimeId].maturity).toBe("production");
      expect(STUDIO_BG3D_RUNTIME_CATALOG[runtimeId].activationGzipBytes)
        .toBeLessThanOrEqual(STUDIO_BG3D_EDITOR_ACTIVATION_BUDGET_GZIP_BYTES);
    }
  });
});

describe("Studio BG3D WebGL-only feature demand", () => {
  it("keeps WebGPU selected and unavailable for WebXR and VRM requirements", () => {
    expect(selectStudioBg3dEngine({
      ...BASE,
      webglOnlyFeatures: { webxr: true, vrmCharacters: false },
    })).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "webgl-only-webxr",
    });
    expect(selectStudioBg3dEngine({
      ...BASE,
      webglOnlyFeatures: { webxr: false, vrmCharacters: true },
    })).toMatchObject({
      backend: "webgpu",
      status: "unavailable",
      reason: "webgl-only-vrm-character",
    });
  });

  it("latches feature demand without changing the selected backend", () => {
    const empty = EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES;
    expect(latchStudioBg3dWebglOnlyFeatures(empty, {})).toBe(empty);
    const latched = latchStudioBg3dWebglOnlyFeatures(empty, {
      webxr: true,
      vrmCharacters: true,
    });
    expect(latched).toEqual({ webxr: true, vrmCharacters: true });
    expect(Object.isFrozen(latched)).toBe(true);
    expect(latchStudioBg3dWebglOnlyFeatures(latched, {
      webxr: false,
      vrmCharacters: false,
    })).toBe(latched);
  });

  it("keeps every Korean notice readable in the narrow panel", () => {
    for (const [reason, notice] of Object.entries(STUDIO_BG3D_ENGINE_SELECTION_NOTICES)) {
      expect(notice.length, `${reason}: ${notice.length}자`).toBeLessThanOrEqual(80);
      expect(notice.trim()).not.toBe("");
    }
  });
});
