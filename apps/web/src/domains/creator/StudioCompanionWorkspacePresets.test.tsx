// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioCompanionWorkspacePresets,
  type StudioCompanionWorkspacePresetId,
} from "./StudioCompanionWorkspacePresets";

afterEach(cleanup);

const PRESET_CASES: ReadonlyArray<{
  id: StudioCompanionWorkspacePresetId;
  label: string;
}> = [
  { id: "draw", label: "작화 집중" },
  { id: "navigate", label: "전체 탐색" },
  { id: "review", label: "검수" },
  { id: "reference", label: "레퍼런스 집중" },
];

describe("StudioCompanionWorkspacePresets", () => {
  it("shows the three workspace roles and marks the active preset", () => {
    render(
      <StudioCompanionWorkspacePresets
        disabled={false}
        activePreset="navigate"
        onApplyPreset={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "멀티 화면 빠른 배치" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "멀티 화면 빠른 배치 프리셋" });
    expect(group.className).toContain("min-[480px]:grid-cols-2");

    for (const preset of PRESET_CASES) {
      const button = within(group).getByRole("button", { name: new RegExp(preset.label) });
      expect(button.getAttribute("aria-pressed")).toBe(String(preset.id === "navigate"));
      expect(button.className).toContain("min-h-14");
      expect(button.className).toContain("focus-visible:ring-2");
    }

    expect(screen.getByText("기본 화면은 캔버스만, 보조 화면은 도구 전용")).toBeTruthy();
    expect(screen.getByText("캔버스는 넓게 두고 전체 원고를 Navigator로 확인")).toBeTruthy();
    expect(screen.getByText("기본 화면은 평소 배치, 보조 화면은 레이어·댓글 검수")).toBeTruthy();
    expect(screen.getByText("캔버스는 넓게 유지하고 참고 이미지와 색상 피커를 별도 창에 고정"))
      .toBeTruthy();
  });

  it("reports each selected preset without owning window behavior", () => {
    const onApplyPreset = vi.fn();
    render(
      <StudioCompanionWorkspacePresets
        disabled={false}
        activePreset={null}
        onApplyPreset={onApplyPreset}
      />
    );

    for (const preset of PRESET_CASES) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(preset.label) }));
    }

    expect(onApplyPreset.mock.calls).toEqual([
      ["draw"],
      ["navigate"],
      ["review"],
      ["reference"],
    ]);
  });

  it("keeps the selected state visible while preventing disabled interactions", () => {
    const onApplyPreset = vi.fn();
    render(
      <StudioCompanionWorkspacePresets
        disabled
        activePreset="review"
        onApplyPreset={onApplyPreset}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }

    expect(screen.getByRole("button", { name: /검수/ }).getAttribute("aria-pressed")).toBe("true");
    expect(onApplyPreset).not.toHaveBeenCalled();
  });
});
