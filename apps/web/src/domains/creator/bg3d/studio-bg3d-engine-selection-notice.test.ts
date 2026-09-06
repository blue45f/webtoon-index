import { describe, expect, it } from "vitest";

import {
  resolveStudioBg3dEngineRuntime,
  STUDIO_BG3D_ENGINE_SELECTION_NOTICES,
  type StudioBg3dEngineSelectionRequest,
} from "./studio-bg3d-engine-selection";
import { classifyStudioBg3dInAppBrowser } from "./studio-bg3d-inapp-browser";

import type { StudioBg3dWebGpuProbeReason } from "./studio-bg3d-webgpu-capability";

function unavailableRequest(reason: StudioBg3dWebGpuProbeReason): StudioBg3dEngineSelectionRequest {
  return {
    preference: "webgpu",
    probe: {
      supported: false,
      reason,
      computeSupported: false,
      timestampQuerySupported: false,
      limits: {},
    },
    inApp: classifyStudioBg3dInAppBrowser({ userAgent: "Mozilla/5.0 Chrome/151.0 Safari/537.36" }),
    deviceProfile: "desktop",
    webgpuRuntimeAvailable: true,
  };
}

const cases = [
  ["insecure-context", "보안 연결"],
  ["api-unavailable", "API"],
  ["adapter-unavailable", "어댑터를 찾지 못했습니다"],
  ["insufficient-limits", "메모리 한도"],
  ["timeout", "응답 확인이 지연"],
  ["aborted", "확인이 중단"],
] as const satisfies readonly (readonly [StudioBg3dWebGpuProbeReason, string])[];

describe("BG3D capability failure notices", () => {
  it.each(cases)("explains %s without changing explicit backend admission", (reason, expected) => {
    const result = resolveStudioBg3dEngineRuntime(unavailableRequest(reason));
    expect(result).toMatchObject({
      backend: "webgpu",
      runtimeId: "three-webgpu",
      status: "unavailable",
      reason: "webgpu-probe-unsupported",
    });
    expect(result.notice).toContain(expected);
    expect(result.notice.length).toBeLessThanOrEqual(80);
    expect(result).not.toHaveProperty("fallbackBackend");
  });

  it("does not describe a timed-out adapter as browser non-support", () => {
    const notice = resolveStudioBg3dEngineRuntime(unavailableRequest("timeout")).notice;
    expect(notice).toContain("미지원으로 확정된 것은 아니며");
    expect(notice).not.toContain("지원하지 않습니다");
  });

  it("keeps a renderer failure ahead of a capability diagnostic", () => {
    const result = resolveStudioBg3dEngineRuntime({
      ...unavailableRequest("timeout"),
      webgpuRuntimeFailed: true,
    });
    expect(result.status).toBe("failed");
    expect(result.notice).toBe(STUDIO_BG3D_ENGINE_SELECTION_NOTICES["webgpu-runtime-failed"]);
  });

  it("does not overwrite an explicit WebGL2 success with a WebGPU failure notice", () => {
    const result = resolveStudioBg3dEngineRuntime({
      ...unavailableRequest("timeout"),
      preference: "webgl2",
    });
    expect(result.status).toBe("available");
    expect(result.notice).toBe(STUDIO_BG3D_ENGINE_SELECTION_NOTICES["user-webgl2-override"]);
  });

  it("uses an inconclusive notice for an inconsistent or missing probe reason", () => {
    const result = resolveStudioBg3dEngineRuntime(unavailableRequest("available"));
    expect(result.status).toBe("unavailable");
    expect(result.notice).toContain("지원 여부를 확인하지 못했습니다");
  });
});
