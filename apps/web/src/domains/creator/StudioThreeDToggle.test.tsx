// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioThreeDStatePill,
  StudioThreeDToggleControl,
} from "./StudioThreeDToggle";

afterEach(cleanup);

describe("Studio 3D shared toggle", () => {
  it("keeps a long Korean label readable without shrinking or misaligning the track", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StudioThreeDToggleControl
        checked={false}
        label="태양 그림자(기기 성능에 따라 자동 제한)"
        description="좁은 패널에서도 설명과 상태를 겹치지 않게 표시합니다."
        onChange={onChange}
      />,
    );

    const control = screen.getByRole("switch", {
      name: "태양 그림자(기기 성능에 따라 자동 제한)",
    });
    const indicator = container.querySelector(
      '[data-studio-three-d-toggle-indicator="true"]',
    );
    const thumb = indicator?.firstElementChild;

    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.className).toContain("min-w-0");
    expect(screen.getByText(/태양 그림자/u).className).toContain("break-words");
    expect(indicator?.className).toContain("h-6");
    expect(indicator?.className).toContain("w-11");
    expect(indicator?.className).toContain("shrink-0");
    expect(thumb?.className).toContain("left-0.5");
    expect(thumb?.className).toContain("translate-x-0");

    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("uses exact integer thumb travel for the enabled state and blocks disabled changes", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StudioThreeDToggleControl
        checked
        disabled
        label="손가락 자동 그립"
        onChange={onChange}
      />,
    );

    const control = screen.getByRole("switch", { name: "손가락 자동 그립" });
    const thumb = container.querySelector(
      '[data-studio-three-d-toggle-indicator="true"] > span',
    );

    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(thumb?.className).toContain("translate-x-5");
    expect(thumb?.className).not.toContain("translate-x-[");

    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders read-only DCC state as a Korean pill instead of an English pseudo-button", () => {
    const { rerender } = render(
      <StudioThreeDStatePill active accessibleLabel="미러 변형 켜짐" />,
    );

    const active = screen.getByLabelText("미러 변형 켜짐");
    expect(active.textContent).toBe("켜짐");
    expect(active.getAttribute("data-state")).toBe("on");
    expect(active.className).toContain("min-w-12");
    expect(active.getAttribute("role")).toBeNull();

    rerender(<StudioThreeDStatePill active={false} accessibleLabel="미러 변형 꺼짐" />);
    expect(screen.getByLabelText("미러 변형 꺼짐").textContent).toBe("꺼짐");
  });
});
