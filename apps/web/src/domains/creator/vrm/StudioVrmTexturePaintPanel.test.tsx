// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioVrmTexturePaintPanel,
  type StudioVrmTexturePaintPanelProps,
  type StudioVrmTexturePaintPanelSettings,
} from "./StudioVrmTexturePaintPanel";

const SURFACE_BRUSH_UNAVAILABLE_REASON =
  "검증된 round 촉 기반 3D 표면 브러시입니다. 필압·크기·불투명도·경도는 로컬 UV atlas에 반영되며, stamp/image 촉과 wet/smudge 혼색은 아직 지원하지 않습니다.";

const SETTINGS: StudioVrmTexturePaintPanelSettings = {
  tool: "fill",
  brushKind: "ink",
  color: "#3a7bd5",
  sizeTexels: 48,
  opacity: 0.8,
  blend: "normal",
  fillScope: "contiguous",
  fillTolerance: 24,
  tuning: {
    flow: 0.7,
    hardness: 0.9,
    minSize: 0.2,
  },
};

function renderPanel(overrides: Partial<StudioVrmTexturePaintPanelProps> = {}) {
  const props: StudioVrmTexturePaintPanelProps = {
    hidden: false,
    disabled: false,
    settings: SETTINGS,
    activeTargetId: "vrm-texture:face",
    activeTextureLabel: "Face · 2048×2048",
    surfaceBrushUnavailableReason: SURFACE_BRUSH_UNAVAILABLE_REASON,
    status: "표면을 한 번 눌러 ColorDrop으로 채우세요.",
    strokeActive: false,
    eyedropperActive: false,
    targetCount: 1,
    canUndo: true,
    canRedo: true,
    onSettingsChange: vi.fn(),
    onEyedropperToggle: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onResetActiveTexture: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<StudioVrmTexturePaintPanel {...props} />) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioVrmTexturePaintPanel", () => {
  it("exposes a compact keyboard-accessible surface-paint workflow", () => {
    renderPanel();

    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "vrm-character-subtab-surface",
    );
    expect(screen.getByText("3D 표면 페인트")).toBeTruthy();
    expect(screen.getByText("Face · 2048×2048")).toBeTruthy();
    expect(
      screen.getByText("표면을 한 번 눌러 ColorDrop으로 채우세요.")
        .closest('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("polite");

    expect(screen.getByRole("button", { name: "표면 브러시" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "ColorDrop" }).className).toContain("min-h-11");
    for (const label of ["취소", "재실행", "원본"]) {
      expect(screen.getByRole("button", { name: label }).className).toContain("min-h-11");
    }
  });

  it("offers a 44px accessible one-shot surface eyedropper toggle", () => {
    const { props } = renderPanel();
    const eyedropper = screen.getByRole("button", { name: "표면 스포이드" });

    expect(eyedropper.className).toContain("size-11");
    expect(eyedropper.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(eyedropper);

    expect(props.onEyedropperToggle).toHaveBeenCalledOnce();
    expect(props.onSettingsChange).not.toHaveBeenCalled();
    expect(eyedropper.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches between the direct surface brush and ColorDrop", () => {
    const { props, rerender } = renderPanel();
    const surface = screen.getByRole("button", { name: "표면 브러시" });
    const fill = screen.getByRole("button", { name: "ColorDrop" });

    expect(surface.className).toContain("min-h-11");
    expect(fill.className).toContain("min-h-11");
    expect((surface as HTMLButtonElement).disabled).toBe(false);
    expect(surface.getAttribute("aria-pressed")).toBe("false");
    expect(fill.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(surface);
    expect(props.onSettingsChange).toHaveBeenCalledWith({ tool: "surface-brush" });

    rerender(
      <StudioVrmTexturePaintPanel
        {...props}
        settings={{ ...SETTINGS, tool: "surface-brush" }}
      />,
    );
    expect(screen.getByRole("button", { name: "표면 브러시" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "ColorDrop" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByTestId("vrm-surface-brush-controls").hasAttribute("hidden")).toBe(false);
    expect(screen.queryByRole("slider", { name: "ColorDrop 색상 허용치" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ColorDrop" }));
    expect(props.onSettingsChange).toHaveBeenLastCalledWith({ tool: "fill" });
  });

  it("exposes only the admitted round surface-brush controls", () => {
    const { props } = renderPanel({
      settings: { ...SETTINGS, tool: "surface-brush" },
    });

    const capability = screen.getByTestId("vrm-surface-brush-capability");
    expect(capability.textContent).toContain("직접 그리기 지원 범위");
    expect(capability.textContent).toContain(SURFACE_BRUSH_UNAVAILABLE_REASON);
    for (const label of ["호환", "잉크", "연필", "에어", "수채", "곱하기", "지우개"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }

    fireEvent.change(screen.getByRole("slider", { name: "표면 브러시 크기" }), {
      target: { value: "96" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "표면 브러시 불투명도" }), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "표면 브러시 도포량" }), {
      target: { value: "0.4" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "표면 브러시 경도" }), {
      target: { value: "0.3" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "표면 브러시 최소 굵기" }), {
      target: { value: "0.1" },
    });

    expect(props.onSettingsChange).toHaveBeenNthCalledWith(1, { sizeTexels: 96 });
    expect(props.onSettingsChange).toHaveBeenNthCalledWith(2, { opacity: 0.5 });
    expect(props.onSettingsChange).toHaveBeenNthCalledWith(3, { tuning: { flow: 0.4 } });
    expect(props.onSettingsChange).toHaveBeenNthCalledWith(4, { tuning: { hardness: 0.3 } });
    expect(props.onSettingsChange).toHaveBeenNthCalledWith(5, { tuning: { minSize: 0.1 } });
    expect(screen.queryByRole("slider", { name: "ColorDrop 색상 허용치" })).toBeNull();
  });

  it("shows only ColorDrop controls and keeps colour editable after eraser use", () => {
    renderPanel({
      settings: {
        ...SETTINGS,
        tool: "fill",
        blend: "erase",
        fillScope: "whole-material",
        fillTolerance: 87,
      },
    });

    expect(screen.getByRole("slider", { name: "ColorDrop 색상 허용치" })).toHaveProperty(
      "value",
      "87",
    );
    expect(screen.getByRole("button", { name: "연결 영역" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    const wholeMaterial = screen.getByRole("button", { name: "텍스처 전체" });
    expect(wholeMaterial.getAttribute("aria-pressed")).toBe("true");
    expect(wholeMaterial.className).toContain("min-h-11");

    expect(screen.queryByRole("button", { name: "잉크" })).toBeNull();
    expect(screen.queryByRole("button", { name: "지우개" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "크기" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "불투명" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "도포량" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "경도" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "최소 굵기" })).toBeNull();

    expect((screen.getByLabelText("표면 페인트 색상 선택") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("표면 페인트 HEX 색상") as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("reports precise ColorDrop tolerance and scope updates", () => {
    const { props } = renderPanel({
      settings: { ...SETTINGS, tool: "fill" },
    });

    fireEvent.change(screen.getByRole("slider", { name: "ColorDrop 색상 허용치" }), {
      target: { value: "143" },
    });
    fireEvent.click(screen.getByRole("button", { name: "텍스처 전체" }));

    expect(props.onSettingsChange).toHaveBeenNthCalledWith(1, { fillTolerance: 143 });
    expect(props.onSettingsChange).toHaveBeenNthCalledWith(2, {
      fillScope: "whole-material",
    });
    expect(props.onSettingsChange).toHaveBeenCalledTimes(2);
  });

  it("disables every surface editing control while texture work is busy", () => {
    const { props, rerender } = renderPanel({
      settings: { ...SETTINGS, tool: "fill" },
      strokeActive: true,
    });

    for (const label of ["표면 브러시", "ColorDrop", "연결 영역", "텍스처 전체"]) {
      expect(screen.getByRole("button", { name: label }).matches(":disabled")).toBe(true);
    }
    expect(
      (screen.getByRole("slider", { name: "ColorDrop 색상 허용치" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);

    rerender(
      <StudioVrmTexturePaintPanel
        {...props}
        settings={{ ...SETTINGS, tool: "surface-brush" }}
      />,
    );
    for (const label of [
      "표면 브러시 크기",
      "표면 브러시 불투명도",
      "표면 브러시 도포량",
      "표면 브러시 경도",
      "표면 브러시 최소 굵기",
    ]) {
      expect((screen.getByRole("slider", { name: label }) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByLabelText("표면 페인트 색상 선택") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("표면 페인트 HEX 색상") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(props.onSettingsChange).not.toHaveBeenCalled();
  });

  it("exposes the controlled active eyedropper state with selected styling", () => {
    renderPanel({ eyedropperActive: true });
    const eyedropper = screen.getByRole("button", { name: "표면 스포이드 취소" });

    expect(eyedropper.getAttribute("aria-pressed")).toBe("true");
    expect(eyedropper.className).toContain("border-accent/60");
    expect(eyedropper.className).toContain("bg-accent-soft");
    expect(eyedropper.className).toContain("text-accent");
  });

  it("prevents eyedropper mode changes while a surface stroke is active", () => {
    const { props } = renderPanel({ strokeActive: true });
    const eyedropper = screen.getByRole("button", { name: "표면 스포이드" });

    expect((eyedropper as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(eyedropper);
    expect(props.onEyedropperToggle).not.toHaveBeenCalled();
  });

  it("does not expose legacy brush-family or blend mutations", () => {
    const { props } = renderPanel();

    for (const label of ["잉크", "연필", "에어", "수채", "일반", "곱하기", "지우개"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    for (const label of [
      "표면 브러시 크기",
      "표면 브러시 불투명도",
      "표면 브러시 도포량",
      "표면 브러시 경도",
      "표면 브러시 최소 굵기",
    ]) {
      expect(screen.queryByRole("slider", { name: label })).toBeNull();
    }
    fireEvent.change(screen.getByLabelText("표면 페인트 색상 선택"), {
      target: { value: "#ff8800" },
    });

    expect(props.onSettingsChange).toHaveBeenCalledWith({ color: "#ff8800" });
    expect(props.onSettingsChange).toHaveBeenCalledTimes(1);
    expect(props.onEyedropperToggle).not.toHaveBeenCalled();
  });

  it("keeps an incremental HEX draft editable and commits only a complete color", () => {
    const { props } = renderPanel();
    const input = screen.getByLabelText("표면 페인트 HEX 색상") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "#3A7" } });
    expect(input.value).toBe("#3A7");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(props.onSettingsChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "#FF8800" } });
    expect(input.value).toBe("#FF8800");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(props.onSettingsChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSettingsChange).toHaveBeenCalledWith({ color: "#ff8800" });

    fireEvent.change(input, { target: { value: "#BAD" } });
    fireEvent.blur(input);
    expect(input.value).toBe(SETTINGS.color.toUpperCase());
  });

  it("keeps destructive and history actions unavailable without a usable target", () => {
    renderPanel({
      activeTargetId: null,
      activeTextureLabel: null,
      canUndo: false,
      canRedo: false,
      strokeActive: true,
    });

    expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "재실행" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "원본" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("칠할 표면을 선택하세요")).toBeTruthy();
  });

  it("offers an explicit retry action when persisted texture restoration fails", () => {
    const onRetryRestore = vi.fn();
    renderPanel({
      disabled: true,
      restoreError: "IndexedDB 원본을 읽지 못했습니다.",
      onRetryRestore,
    });

    expect(screen.getByRole("alert").textContent).toContain("원본 텍스처 복원이 중단됐습니다.");
    expect(screen.getByRole("alert").textContent).toContain("IndexedDB 원본을 읽지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetryRestore).toHaveBeenCalledOnce();
  });

  it("requires a deliberate second activation before destructive source restoration", () => {
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "원본" }));
    expect(props.onResetActiveTexture).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "한 번 더" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "한 번 더" }));
    expect(props.onResetActiveTexture).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "원본" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears destructive confirmation when the target id changes despite an identical label", () => {
    const firstTargetId = "vrm-texture:first";
    const secondTargetId = "vrm-texture:second";
    const sharedLabel = "Base color · 2048×2048";
    const { props, rerender } = renderPanel({
      activeTargetId: firstTargetId,
      activeTextureLabel: sharedLabel,
    });

    fireEvent.click(screen.getByRole("button", { name: "원본" }));
    expect(screen.getByRole("button", { name: "한 번 더" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    rerender(
      <StudioVrmTexturePaintPanel
        {...props}
        activeTargetId={secondTargetId}
        activeTextureLabel={sharedLabel}
      />,
    );
    expect(screen.getByRole("button", { name: "원본" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "원본" }));
    expect(props.onResetActiveTexture).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "한 번 더" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps ColorDrop colour entry available even if stale settings retain legacy erase", () => {
    renderPanel({
      settings: { ...SETTINGS, blend: "erase" },
    });

    expect(screen.queryByRole("button", { name: "지우개" })).toBeNull();
    expect((screen.getByLabelText("표면 페인트 색상 선택") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText("표면 페인트 HEX 색상") as HTMLInputElement).disabled).toBe(
      false,
    );
  });
});
