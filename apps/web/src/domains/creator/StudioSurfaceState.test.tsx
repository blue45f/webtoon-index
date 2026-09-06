// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioSurfaceState } from "./StudioSurfaceState";

afterEach(cleanup);

describe("StudioSurfaceState", () => {
  it("preserves the legacy empty-state marker while exposing the canonical state", () => {
    const { container } = render(
      <StudioSurfaceState
        state="empty"
        title="항목이 없습니다"
        description="새 항목을 추가하세요."
      />,
    );

    expect(container.querySelector('[data-studio-empty-state="true"]')).toBeTruthy();
    expect(container.querySelector('[data-studio-surface-state="empty"]')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("항목이 없습니다");
  });

  it("announces errors assertively and loading as busy", () => {
    const { rerender } = render(
      <StudioSurfaceState state="error" title="불러오지 못했습니다" />,
    );
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");

    rerender(<StudioSurfaceState state="loading" title="불러오는 중" />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });
});
