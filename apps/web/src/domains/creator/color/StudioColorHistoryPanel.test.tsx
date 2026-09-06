// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioColorHistoryPanel } from "./StudioColorHistoryPanel";

describe("StudioColorHistoryPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with header, CSP badge, and initial swatches", () => {
    render(
      <StudioColorHistoryPanel
        activeColor="#fcd5b5"
        onSelectColor={vi.fn()}
      />,
    );

    expect(screen.getByText("컬러 히스토리 (Color History)")).toBeDefined();
    expect(screen.getByText("CSP")).toBeDefined();
    expect(screen.getByRole("button", { name: "등록" })).toBeDefined();
    expect(screen.getByRole("button", { name: "히스토리 전체 지우기" })).toBeDefined();
  });

  it("calls onSelectColor when clicking a color swatch", () => {
    const onSelectColor = vi.fn();
    render(
      <StudioColorHistoryPanel
        activeColor="#fcd5b5"
        onSelectColor={onSelectColor}
        initialHistory={["#ff0000", "#00ff00"]}
      />,
    );

    const redButton = screen.getByRole("button", { name: "#ff0000 색상 선택" });
    fireEvent.click(redButton);
    expect(onSelectColor).toHaveBeenCalledWith("#ff0000");
  });

  it("adds current active color when '등록' is clicked", () => {
    render(
      <StudioColorHistoryPanel
        activeColor="#123456"
        onSelectColor={vi.fn()}
        initialHistory={["#ffffff"]}
      />,
    );

    const registerBtn = screen.getByRole("button", { name: "등록" });
    fireEvent.click(registerBtn);

    expect(screen.getByRole("button", { name: "#123456 색상 선택" })).toBeDefined();
  });

  it("clears history when trash button is clicked", () => {
    render(
      <StudioColorHistoryPanel
        activeColor="#123456"
        onSelectColor={vi.fn()}
        initialHistory={["#ffffff"]}
      />,
    );

    const clearBtn = screen.getByRole("button", { name: "히스토리 전체 지우기" });
    fireEvent.click(clearBtn);

    expect(screen.getByText("기록된 색상이 없습니다.")).toBeDefined();
  });
});
