// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioCompanionWindowManager } from "./StudioCompanionWindowManager";

afterEach(cleanup);

describe("StudioCompanionWindowManager", () => {
  it("offers three independent dedicated windows for a four-screen workspace", () => {
    const onOpenSurface = vi.fn(() => true);
    render(
      <StudioCompanionWindowManager
        disabled={false}
        onOpenSurface={onOpenSurface}
      />
    );

    expect(screen.getByText(/최대 4화면으로 확장/)).toBeTruthy();
    expect(document.querySelector("[data-companion-window-list]")?.className)
      .toContain("min-[480px]:grid-cols-2");
    const navigator = screen.getByRole("button", { name: "Navigator 전용 창 열기 또는 앞으로 가져오기" });
    const review = screen.getByRole("button", { name: "검수 전용 창 열기 또는 앞으로 가져오기" });
    const reference = screen.getByRole("button", { name: "레퍼런스 전용 창 열기 또는 앞으로 가져오기" });

    for (const button of [navigator, review, reference]) {
      expect(button.className).toContain("min-h-14");
      fireEvent.click(button);
    }

    expect(onOpenSurface.mock.calls).toEqual([
      ["navigator"],
      ["review"],
      ["reference"],
    ]);
    expect(screen.getByRole("status").textContent).toContain("레퍼런스 창");
  });

  it("announces popup blocking and prevents disabled interactions", () => {
    const onOpenSurface = vi.fn(() => false);
    const { rerender } = render(
      <StudioCompanionWindowManager
        disabled={false}
        onOpenSurface={onOpenSurface}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /레퍼런스 전용 창/ }));
    expect(screen.getByRole("alert").textContent).toContain("팝업이 차단");

    rerender(
      <StudioCompanionWindowManager
        disabled
        onOpenSurface={onOpenSurface}
      />
    );
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onOpenSurface).toHaveBeenCalledTimes(1);
  });
});
