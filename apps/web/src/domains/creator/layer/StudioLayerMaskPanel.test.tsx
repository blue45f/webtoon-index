// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioLayerMaskPanel,
  type StudioLayerMaskPanelProps,
} from "./StudioLayerMaskPanel";

afterEach(cleanup);

function makeProps(
  overrides: Partial<StudioLayerMaskPanelProps> = {}
): StudioLayerMaskPanelProps {
  return {
    hasMask: false,
    enabled: true,
    paintActive: false,
    paintMode: "reveal",
    radiusPx: 48,
    hardness: 0.6,
    strength: 1,
    maskThumbnailSrc: null,
    busy: false,
    onAddMask: vi.fn(),
    onCreateFromSelection: vi.fn(),
    hasUsableSelection: false,
    onDeleteMask: vi.fn(),
    onToggleEnabled: vi.fn(),
    onInvert: vi.fn(),
    onTogglePaintActive: vi.fn(),
    onPaintModeChange: vi.fn(),
    onRadiusChange: vi.fn(),
    onHardnessChange: vi.fn(),
    onStrengthChange: vi.fn(),
    ...overrides,
  };
}

describe("StudioLayerMaskPanel", () => {
  it("마스크 생성 경로와 선택 불가 사유를 한 화면에서 설명한다", () => {
    const props = makeProps();
    render(<StudioLayerMaskPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "마스크 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "숨김으로 추가" }));
    expect(props.onAddMask).toHaveBeenNthCalledWith(1, "reveal");
    expect(props.onAddMask).toHaveBeenNthCalledWith(2, "conceal");

    const fromSelection = screen.getByRole("button", { name: "선택으로 마스크" });
    const outsideSelection = screen.getByRole("button", { name: "선택 밖으로 마스크" });
    expect((fromSelection as HTMLButtonElement).disabled).toBe(true);
    expect((outsideSelection as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("먼저 이미지에서 픽셀 영역을 선택");
  });

  it("선택 영역이 있으면 안쪽·바깥쪽 마스크 생성을 각각 전달한다", () => {
    const props = makeProps({ hasUsableSelection: true });
    render(<StudioLayerMaskPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "선택으로 마스크" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 밖으로 마스크" }));
    expect(props.onCreateFromSelection).toHaveBeenNthCalledWith(1, false);
    expect(props.onCreateFromSelection).toHaveBeenNthCalledWith(2, true);
  });

  it("busy 중에는 중복 변경을 잠그고 활성 그리기 도구 종료만 허용한다", () => {
    const props = makeProps({ hasMask: true, paintActive: true, busy: true });
    render(<StudioLayerMaskPanel {...props} />);

    const region = screen.getByRole("region", { name: "레이어 마스크" });
    const exitButton = screen.getByRole("button", { name: "레이어 마스크 그리기 종료" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect((exitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(exitButton);
    expect(props.onTogglePaintActive).toHaveBeenCalledTimes(1);

    for (const name of ["사용 중", "반전", "삭제", "보이기", "숨기기"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      screen.getAllByRole("slider").every((slider) => (slider as HTMLInputElement).disabled)
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "반전" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(props.onInvert).not.toHaveBeenCalled();
    expect(props.onDeleteMask).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("‘그리기 종료’");
  });

  it("busy 중 비활성 그리기와 새 마스크 생성을 막고 44px 터치 타깃을 유지한다", () => {
    const addProps = makeProps({ busy: true, hasUsableSelection: true });
    const { rerender } = render(<StudioLayerMaskPanel {...addProps} />);

    for (const name of [
      "마스크 추가",
      "숨김으로 추가",
      "선택으로 마스크",
      "선택 밖으로 마스크",
    ]) {
      const button = screen.getByRole("button", { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).toContain("pointer-coarse:min-h-11");
      fireEvent.click(button);
    }
    expect(addProps.onAddMask).not.toHaveBeenCalled();
    expect(addProps.onCreateFromSelection).not.toHaveBeenCalled();

    const paintProps = makeProps({ hasMask: true, busy: true, paintActive: false });
    rerender(<StudioLayerMaskPanel {...paintProps} />);
    expect(
      (screen.getByRole("button", { name: "레이어 마스크에 그리기" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
