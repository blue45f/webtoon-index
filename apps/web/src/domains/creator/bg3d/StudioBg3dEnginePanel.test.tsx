// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { selectStudioBg3dEngine } from "./studio-bg3d-engine-selection";
import { classifyStudioBg3dInAppBrowser } from "./studio-bg3d-inapp-browser";
import { StudioBg3dEnginePanel } from "./StudioBg3dEnginePanel";

import type { StudioBg3dWebGpuProbeResult } from "./studio-bg3d-webgpu-capability";

const SUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: true,
  reason: "available",
  computeSupported: true,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});
const UNSUPPORTED_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: false,
  reason: "api-unavailable",
  computeSupported: false,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});

const DESKTOP = classifyStudioBg3dInAppBrowser({
  userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/133 Safari/537.36",
});
const KAKAOTALK = classifyStudioBg3dInAppBrowser({
  userAgent: "Mozilla/5.0 (Linux; Android 15; wv) Mobile Safari/537.36 KAKAOTALK 10.6.5",
});

function planFor(overrides: Partial<Parameters<typeof selectStudioBg3dEngine>[0]> = {}) {
  return selectStudioBg3dEngine({
    preference: "webgpu",
    probe: SUPPORTED_PROBE,
    inApp: DESKTOP,
    deviceProfile: "desktop",
    webgpuRuntimeAvailable: true,
    ...overrides,
  });
}

afterEach(cleanup);

describe("StudioBg3dEnginePanel", () => {
  it("names the available explicitly selected engine", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor()}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("WebGPU 사용 중");
    expect(screen.getByTestId("studio-bg3d-engine-status").textContent)
      .toContain("직접 선택한 WebGPU");
    expect(screen.queryByTestId("studio-bg3d-engine-preference-auto")).toBeNull();
  });

  it("keeps unsupported WebGPU selected and offers an explicit WebGL2 choice", () => {
    const onPreferenceChange = vi.fn();
    render(
      <StudioBg3dEnginePanel
        plan={planFor({ probe: UNSUPPORTED_PROBE })}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={onPreferenceChange}
      />,
    );

    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("WebGPU 사용 불가");
    const status = screen.getByTestId("studio-bg3d-engine-status");
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toContain("WebGL2를 직접 선택");
    expect((screen.getByTestId("studio-bg3d-engine-preference-webgpu") as HTMLButtonElement)
      .disabled).toBe(false);

    fireEvent.click(screen.getByTestId("studio-bg3d-engine-preference-webgl2"));
    expect(onPreferenceChange).toHaveBeenCalledWith("webgl2");
  });

  it("reports a VRM requirement without relabeling the selection as WebGL2", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor({
          webglOnlyFeatures: { webxr: false, vrmCharacters: true },
        })}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("WebGPU 사용 불가");
    const status = screen.getByTestId("studio-bg3d-engine-status").textContent ?? "";
    expect(status).toContain("3D 캐릭터 색");
    expect(status).toContain("WebGL2 엔진을 직접 선택");
    expect(status).not.toContain("MToon");
  });

  it("does not auto-demote an opt-in in-app browser", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor({ inApp: KAKAOTALK })}
        preference="webgpu"
        inApp={KAKAOTALK}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    expect(screen.getByText(/카카오톡 인앱 브라우저/u)).toBeTruthy();
    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("WebGPU 사용 중");
  });

  it("announces a runtime failure assertively and keeps the selected backend", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor({ webgpuRuntimeFailed: true })}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage="WebGPU 디바이스 연결이 끊어졌습니다."
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("WebGPU 실행 실패");
    const status = screen.getByTestId("studio-bg3d-engine-status");
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toContain("끊어졌습니다");
  });

  it("locks the two manual choices only while capability probing runs", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor()}
        preference="webgpu"
        inApp={DESKTOP}
        probing
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    for (const option of ["webgpu", "webgl2"] as const) {
      expect((screen.getByTestId(`studio-bg3d-engine-preference-${option}`) as HTMLButtonElement)
        .disabled).toBe(true);
    }
    expect(screen.queryByTestId("studio-bg3d-engine-preference-auto")).toBeNull();
    expect(screen.getByTestId("studio-bg3d-engine-active-backend").textContent)
      .toContain("확인 중");
  });

  it("marks the selected preference for assistive technology", () => {
    render(
      <StudioBg3dEnginePanel
        plan={planFor({ preference: "webgl2" })}
        preference="webgl2"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={null}
        onPreferenceChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("studio-bg3d-engine-preference-webgl2").getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByTestId("studio-bg3d-engine-preference-webgpu").getAttribute("aria-pressed"))
      .toBe("false");
  });

  it("shows frame timing only while a renderer is available", () => {
    const { rerender } = render(
      <StudioBg3dEnginePanel
        plan={planFor()}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={12.5}
        onPreferenceChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("studio-bg3d-engine-frame-time").textContent)
      .toContain("12.5ms · 약 80fps");

    rerender(
      <StudioBg3dEnginePanel
        plan={planFor({ probe: UNSUPPORTED_PROBE })}
        preference="webgpu"
        inApp={DESKTOP}
        probing={false}
        deviceLostMessage={null}
        frameTimeMs={12.5}
        onPreferenceChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("studio-bg3d-engine-frame-time")).toBeNull();
  });
});
