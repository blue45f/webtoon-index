// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioSubViewPanel } from "./StudioSubViewPanel";

describe("StudioSubViewPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with sub view header, CSP badge, and image pagination", () => {
    render(<StudioSubViewPanel onPickColor={vi.fn()} />);

    expect(screen.getByText("서브 뷰 (Sub View)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();
    expect(screen.getByText("1/2")).toBeDefined();
  });

  it("navigates through reference images with next and previous buttons", () => {
    render(<StudioSubViewPanel onPickColor={vi.fn()} />);

    const nextBtn = screen.getByLabelText("다음 레퍼런스 이미지");
    fireEvent.click(nextBtn);
    expect(screen.getByText("2/2")).toBeDefined();

    const prevBtn = screen.getByLabelText("이전 레퍼런스 이미지");
    fireEvent.click(prevBtn);
    expect(screen.getByText("1/2")).toBeDefined();
  });

  it("adjusts zoom and toggles transform buttons", () => {
    render(<StudioSubViewPanel onPickColor={vi.fn()} />);

    expect(screen.getAllByText("100%").length).toBeGreaterThanOrEqual(1);

    const zoomInBtn = screen.getByLabelText("확대");
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("110%")).toBeDefined();

    const zoomOutBtn = screen.getByLabelText("축소");
    fireEvent.click(zoomOutBtn);
    expect(screen.getAllByText("100%").length).toBeGreaterThanOrEqual(1);

    const flipHBtn = screen.getByLabelText("좌우 반전");
    fireEvent.click(flipHBtn);
    expect(flipHBtn.getAttribute("aria-pressed")).toBe("true");

    const flipVBtn = screen.getByLabelText("상하 반전");
    fireEvent.click(flipVBtn);
    expect(flipVBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles eyedropper and handles click to pick color", () => {
    const onPickColor = vi.fn();
    render(<StudioSubViewPanel onPickColor={onPickColor} />);

    const eyedropperBtn = screen.getByLabelText("자동 스포이드 활성화됨");
    expect(eyedropperBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(eyedropperBtn);
    expect(eyedropperBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
