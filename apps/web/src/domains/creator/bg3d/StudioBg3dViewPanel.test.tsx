// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Camera, Loader2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dAiReferenceAction,
  StudioBg3dBabylonDiagnostic,
  type StudioBg3dAiReferenceActionProps,
  type StudioBg3dBabylonDiagnosticState,
} from "./StudioBg3dViewPanel";
import viewPanelSource from "./StudioBg3dViewPanelContent.tsx?raw";

afterEach(cleanup);

function renderAiReferenceAction(
  overrides: Partial<StudioBg3dAiReferenceActionProps> = {},
) {
  const onUseCurrentFrameAsAiReference = vi.fn();
  render(
    <StudioBg3dAiReferenceAction
      CameraIcon={Camera}
      LoaderIcon={Loader2}
      onUseCurrentFrameAsAiReference={onUseCurrentFrameAsAiReference}
      {...overrides}
    />,
  );
  return onUseCurrentFrameAsAiReference;
}

describe("Studio BG3D current-shot AI reference action", () => {
  it("explains the review boundary and sends the enabled action through its callback", () => {
    const onUseCurrentFrameAsAiReference = renderAiReferenceAction();
    const button = screen.getByRole("button", { name: "현재 샷으로 AI 시안" });
    const description = screen.getByText(
      "현재 프레임을 구도 참조로 보냅니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다.",
    );

    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.getAttribute("aria-describedby")).toBe(description.id);
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("w-full");

    fireEvent.click(button);

    expect(onUseCurrentFrameAsAiReference).toHaveBeenCalledTimes(1);
  });

  it("announces preparation, disables repeat submission, and never invokes the callback while busy", () => {
    const onUseCurrentFrameAsAiReference = renderAiReferenceAction({ busy: true });
    const button = screen.getByRole("button", {
      name: "현재 샷으로 AI 시안 준비 중",
    });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByText(
        "현재 프레임을 구도 참조로 보내고 있습니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다.",
      ),
    ).toBeTruthy();

    fireEvent.click(button);

    expect(onUseCurrentFrameAsAiReference).not.toHaveBeenCalled();
  });

  it("keeps the unavailable reason visible and blocks the callback while disabled", () => {
    const onUseCurrentFrameAsAiReference = renderAiReferenceAction({ disabled: true });
    const button = screen.getByRole("button", { name: "현재 샷으로 AI 시안" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(
      screen.getByText(
        "현재 상태에서는 프레임을 구도 참조로 보낼 수 없습니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다.",
      ),
    ).toBeTruthy();

    fireEvent.click(button);

    expect(onUseCurrentFrameAsAiReference).not.toHaveBeenCalled();
  });

  it("keeps the parent callback optional and combines editor locks with the explicit disabled state", () => {
    expect(viewPanelSource).toContain(
      "readonly onUseCurrentFrameAsAiReference?: () => void;",
    );
    expect(viewPanelSource).toContain(
      "const aiReferenceActionDisabled =\n    aiReferenceDisabled || cameraControlsDisabled;",
    );
    expect(viewPanelSource).toContain(
      "{onUseCurrentFrameAsAiReference ? (",
    );
    expect(viewPanelSource).toContain(
      "onUseCurrentFrameAsAiReference={onUseCurrentFrameAsAiReference}",
    );
  });
});

function renderBabylonDiagnostic(state: StudioBg3dBabylonDiagnosticState) {
  const onRun = vi.fn();
  render(<StudioBg3dBabylonDiagnostic state={state} onRun={onRun} />);
  return onRun;
}

describe("Studio BG3D explicit Babylon diagnostic", () => {
  it("keeps both backends idle until the user chooses one explicitly", () => {
    const onRun = renderBabylonDiagnostic({ status: "idle", backend: null });
    const webGlButton = screen.getByRole("button", {
      name: "Babylon WebGL2 진단 실행",
    });
    const webGpuButton = screen.getByRole("button", {
      name: "Babylon WebGPU 진단 실행",
    });

    expect((webGlButton as HTMLButtonElement).disabled).toBe(false);
    expect((webGpuButton as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.getByText(
        /실제 컬러\(beauty\)·깊이\(depth\)·\s*법선\(normal\)·객체 ID·재질 ID 패스를 확인합니다/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "진단을 실행하기 전에는 Babylon 코드와 GPU 컨텍스트를 불러오지 않습니다.",
      ),
    ).toBeTruthy();

    fireEvent.click(webGpuButton);

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("webgpu");
  });

  it("locks duplicate actions while preserving the exact requested backend label", () => {
    const onRun = renderBabylonDiagnostic({
      status: "loading",
      backend: "webgl2",
    });
    const webGlButton = screen.getByRole("button", {
      name: "Babylon WebGL2 진단 실행",
    });
    const webGpuButton = screen.getByRole("button", {
      name: "Babylon WebGPU 진단 실행",
    });

    expect((webGlButton as HTMLButtonElement).disabled).toBe(true);
    expect((webGpuButton as HTMLButtonElement).disabled).toBe(true);
    expect(webGlButton.getAttribute("aria-busy")).toBe("true");
    expect(webGpuButton.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("Babylon WebGL2 진단을 준비하고 있습니다.")).toBeTruthy();

    fireEvent.click(webGlButton);
    fireEvent.click(webGpuButton);

    expect(onRun).not.toHaveBeenCalled();
  });

  it("announces a measured success without claiming that the production renderer changed", () => {
    renderBabylonDiagnostic({
      status: "success",
      backend: "webgpu",
      durationMs: 18.6,
    });

    expect(screen.getByText("Babylon WebGPU 진단 완료 · 19ms")).toBeTruthy();
    expect(
      screen.getByText(/현재 3D 편집기나 최종 렌더러를 전환하지 않으며/),
    ).toBeTruthy();
  });

  it("uses an alert for a backend-specific failure and exposes an explicit retry", () => {
    const onRun = renderBabylonDiagnostic({
      status: "error",
      backend: "webgpu",
      message:
        "이 브라우저에서 WebGPU를 사용할 수 없습니다. WebGL2 진단은 자동 실행하지 않았습니다.",
    });
    const retry = screen.getByRole("button", {
      name: "Babylon WebGPU 진단 실행",
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "WebGL2 진단은 자동 실행하지 않았습니다.",
    );
    expect(retry.textContent).toContain("WebGPU 다시 진단");

    fireEvent.click(retry);

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("webgpu");
  });
});
