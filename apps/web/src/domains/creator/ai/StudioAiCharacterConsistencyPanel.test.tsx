// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioAiCharacterConsistencyPanel } from "./StudioAiCharacterConsistencyPanel";

afterEach(cleanup);

describe("StudioAiCharacterConsistencyPanel", () => {
  it("offers a 44px reference-selection CTA and delegates selection-mode entry", () => {
    const onRequestSelectReference = vi.fn();
    render(
      <StudioAiCharacterConsistencyPanel
        configured
        hasReference={false}
        referenceThumbnail={null}
        prompt=""
        onPromptChange={vi.fn()}
        busy={false}
        error={null}
        onGenerate={vi.fn()}
        onRequestSelectReference={onRequestSelectReference}
      />,
    );

    const recovery = screen.getByRole("button", { name: "기준 이미지 선택하기" });
    expect(recovery.className).toContain("min-h-11");
    expect(screen.getByRole("status").textContent).toContain(
      "캐릭터 이미지를 먼저 선택하세요",
    );
    expect(screen.getByText(/Esc를 누르면 선택을 취소/)).toBeTruthy();

    fireEvent.click(recovery);
    expect(onRequestSelectReference).toHaveBeenCalledOnce();
  });

  it("removes the recovery CTA after a reference becomes available", () => {
    render(
      <StudioAiCharacterConsistencyPanel
        configured
        hasReference
        referenceThumbnail="data:image/png;base64,AA=="
        prompt="장면"
        onPromptChange={vi.fn()}
        busy={false}
        error={null}
        onGenerate={vi.fn()}
        onRequestSelectReference={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "기준 이미지 선택하기" })).toBeNull();
    expect(screen.getByAltText("기준 캐릭터 미리보기")).toBeTruthy();
    expect(screen.getByRole("button", { name: "같은 캐릭터로 생성" })).toBeTruthy();
  });
});
