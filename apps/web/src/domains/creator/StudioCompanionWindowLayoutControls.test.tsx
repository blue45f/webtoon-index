// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCompanionWindowLayoutControls,
  type StudioCompanionWindowLayoutControlsProps,
  type StudioCompanionWindowSurface,
} from "./StudioCompanionWindowLayoutControls";

afterEach(cleanup);

function renderControls(overrides: Partial<StudioCompanionWindowLayoutControlsProps> = {}) {
  const props: StudioCompanionWindowLayoutControlsProps = {
    surface: "workspace",
    enabled: true,
    disabled: false,
    hasSavedLayout: true,
    persistenceStatus: "persistent",
    onEnabledChange: vi.fn(),
    onCapture: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };

  return { props, ...render(<StudioCompanionWindowLayoutControls {...props} />) };
}

describe("StudioCompanionWindowLayoutControls", () => {
  it("labels each companion role without collapsing Navigator into the workspace role", () => {
    const cases: ReadonlyArray<{ surface: StudioCompanionWindowSurface; heading: string }> = [
      { surface: "workspace", heading: "작업공간 창 배치" },
      { surface: "navigator", heading: "Navigator 창 배치" },
      { surface: "review", heading: "검수 창 배치" },
      { surface: "reference", heading: "레퍼런스 창 배치" },
    ];

    for (const roleCase of cases) {
      const { unmount } = renderControls({ surface: roleCase.surface });
      expect(screen.getByRole("heading", { name: roleCase.heading })).toBeTruthy();
      unmount();
    }
  });

  it("exposes described controls and reports toggle, capture, and clear actions", () => {
    const onEnabledChange = vi.fn();
    const onCapture = vi.fn();
    const onClear = vi.fn();
    renderControls({ onEnabledChange, onCapture, onClear });

    const toggle = screen.getByRole("switch", { name: "위치·크기 기억" });
    const capture = screen.getByRole("button", { name: "현재 위치 저장" });
    const clear = screen.getByRole("button", { name: "저장 배치 삭제" });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.className).toContain("min-h-11");
    expect(capture.className).toContain("min-h-11");
    expect(clear.className).toContain("min-h-11");

    for (const control of [toggle, capture]) {
      const describedBy = control.getAttribute("aria-describedby")?.split(" ") ?? [];
      expect(describedBy).toHaveLength(3);
      for (const id of describedBy) expect(document.getElementById(id)).toBeTruthy();
    }

    fireEvent.click(toggle);
    fireEvent.click(capture);
    fireEvent.click(clear);

    expect(onEnabledChange).toHaveBeenCalledWith(false);
    expect(onCapture).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("저장된 배치로 복원");
    expect(screen.getByText(/최소한의 모니터 크기·배율·상대 배치 특성/)).toBeTruthy();
    expect(screen.getByText(/모니터 이름·ID와 작품·세션·계정 정보는 저장하지 않습니다/))
      .toBeTruthy();
  });

  it("keeps unavailable destructive actions disabled and preserves 44px targets", () => {
    const onEnabledChange = vi.fn();
    const onCapture = vi.fn();
    const onClear = vi.fn();
    renderControls({
      enabled: false,
      disabled: true,
      hasSavedLayout: true,
      onEnabledChange,
      onCapture,
      onClear,
    });

    const toggle = screen.getByRole("switch");
    const capture = screen.getByRole("button", { name: "현재 위치 저장" });
    const clear = screen.getByRole("button", { name: "저장 배치 삭제" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect((capture as HTMLButtonElement).disabled).toBe(true);
    expect((clear as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(toggle);
    fireEvent.click(capture);
    fireEvent.click(clear);
    expect(onEnabledChange).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();

    cleanup();
    renderControls({ enabled: false, hasSavedLayout: false });
    expect(
      (screen.getByRole("button", { name: "현재 위치 저장" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "저장 배치 삭제" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("explains session-only and unsupported fallbacks while allowing stale data cleanup", () => {
    const { rerender, props } = renderControls({
      persistenceStatus: "session-only",
      enabled: true,
      hasSavedLayout: false,
    });

    expect(screen.getByText("현재 세션만")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("창을 닫기 전까지만");

    const onClear = vi.fn();
    rerender(
      <StudioCompanionWindowLayoutControls
        {...props}
        persistenceStatus="unsupported"
        hasSavedLayout
        onClear={onClear}
      />
    );

    expect(screen.getByText("자동 배치 미지원")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("자동 복원");
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "현재 위치 저장" }) as HTMLButtonElement).disabled
    ).toBe(true);

    const clear = screen.getByRole("button", { name: "저장 배치 삭제" });
    expect((clear as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("uses a stable two-row grid for a 320px companion viewport", () => {
    const { container } = renderControls();
    const section = container.querySelector("section");
    const controlRow = container.querySelector("[data-layout-controls]");

    expect(section?.className).toContain("min-w-0");
    expect(section?.className).toContain("rounded-lg");
    expect(controlRow?.className).toContain("min-w-0");
    expect(controlRow?.className).toContain("grid-cols-2");
    expect(screen.getByRole("switch", { name: "위치·크기 기억" }).className)
      .toContain("col-span-2");
  });
});
