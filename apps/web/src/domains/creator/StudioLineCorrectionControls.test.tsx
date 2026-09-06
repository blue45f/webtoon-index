// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioLineCorrectionControls,
  type StudioLineCorrectionControlsProps,
} from "./StudioLineCorrectionControls";

function baseProps(
  overrides: Partial<StudioLineCorrectionControlsProps> = {}
): StudioLineCorrectionControlsProps {
  return {
    stabilizer: 1,
    onStabilizerChange: vi.fn(),
    mode: "standard",
    onModeChange: vi.fn(),
    postCorrection: 0,
    onPostCorrectionChange: vi.fn(),
    preserveCorners: true,
    onPreserveCornersChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("StudioLineCorrectionControls", () => {
  it("shows the current standard-mode response estimate accessibly", () => {
    render(<StudioLineCorrectionControls {...baseProps()} />);

    const responseGroup = screen.getByRole("group", { name: "입력 반응 예상" });
    expect(responseGroup.textContent).toContain("약 30ms");
    expect(responseGroup.textContent).toContain("큰 이동의 90%");

    const strength = screen.getByRole("slider", { name: "입력 선 보정 강도" });
    const descriptionId = strength.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toContain("예상 시간");
  });

  it("switches mode and strength together from the one-click instant response action", () => {
    const onModeChange = vi.fn();
    const onStabilizerChange = vi.fn();
    render(
      <StudioLineCorrectionControls
        {...baseProps({
          mode: "precision",
          stabilizer: 8,
          onModeChange,
          onStabilizerChange,
        })}
      />
    );

    expect(screen.getByText("의도적 후행")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {
      name: "즉시 반응: 고정 주기 모드와 입력 보정 0으로 전환",
    }));

    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("standard");
    expect(onStabilizerChange).toHaveBeenCalledOnce();
    expect(onStabilizerChange).toHaveBeenCalledWith(0);
  });

  it("marks the exact standard zero state as immediate without mutating it", () => {
    render(<StudioLineCorrectionControls {...baseProps({ stabilizer: 0 })} />);

    expect(screen.getByText("즉시", { selector: "span" })).toBeTruthy();
    const instantButton = screen.getByRole("button", { name: "즉시 반응 사용 중" }) as HTMLButtonElement;
    expect(instantButton.disabled).toBe(true);
    expect(instantButton.getAttribute("aria-pressed")).toBe("true");
  });
});
