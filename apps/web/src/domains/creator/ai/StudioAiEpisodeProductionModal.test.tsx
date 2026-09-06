// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAiEpisodeProductionModal } from "./StudioAiEpisodeProductionModal";

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioAiEpisodeProductionModal", () => {
  it("renders nothing while closed", () => {
    render(<StudioAiEpisodeProductionModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as an accessible mobile-safe production dialog", () => {
    render(<StudioAiEpisodeProductionModal open onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "회차 AI 프로덕션 디렉터" });
    expect(dialog.tagName).toBe("SECTION");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("max-h-[100dvh]");
    expect(screen.getByText("생성 전 품질 게이트")).toBeTruthy();
    expect(screen.getByText("2장면 · 6컷")).toBeTruthy();
    expect(screen.getByText("품질 게이트")).toBeTruthy();
    expect(screen.getByText("생성 전 수정 항목")).toBeTruthy();
    expect(screen.getAllByText("생성 묶음")).toHaveLength(2);
  });

  it("replans output count immediately when mode and variants change", () => {
    render(<StudioAiEpisodeProductionModal open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("radio", { name: /품질 우선/ }));
    fireEvent.click(screen.getByRole("radio", { name: "4" }));

    expect(screen.getByText("품질 우선 · 컷당 4개")).toBeTruthy();
    expect(screen.getByText(/예상 결과 24개/)).toBeTruthy();
  });

  it("makes every continuity lock explicit and disables its anchor when turned off", () => {
    render(<StudioAiEpisodeProductionModal open onClose={() => {}} />);

    const characterInput = screen.getByRole<HTMLInputElement>("textbox", { name: "캐릭터 기준" });
    expect(characterInput.disabled).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "캐릭터 연속성 잠금 끄기" }));

    expect(characterInput.disabled).toBe(true);
    expect(
      screen.getByRole("switch", { name: "캐릭터 연속성 잠금 켜기" }).getAttribute("aria-checked")
    ).toBe("false");
  });

  it("blocks prompt application when the script is empty", () => {
    const onApplyPrompt = vi.fn();
    render(
      <StudioAiEpisodeProductionModal
        open
        onClose={() => {}}
        onApplyPrompt={onApplyPrompt}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "대본 원문" }), {
      target: { value: "" },
    });

    expect(screen.getByText("대본을 입력하면 제작 계획을 만들어요")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "첫 배치를 구도 도구에 적용" })
        .disabled
    ).toBe(true);
  });

  it("hands the first QA-approved batch to the existing AI hub", () => {
    const onApplyPrompt = vi.fn();
    const onClose = vi.fn();
    render(
      <StudioAiEpisodeProductionModal
        open
        onClose={onClose}
        onApplyPrompt={onApplyPrompt}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "첫 배치를 구도 도구에 적용" }));

    expect(onApplyPrompt).toHaveBeenCalledTimes(1);
    expect(onApplyPrompt).toHaveBeenCalledWith(expect.stringContaining("Continuity lock"));
    expect(onApplyPrompt).toHaveBeenCalledWith(expect.stringContaining("Cut 1"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("copies the deterministic production manifest with truthful feedback", async () => {
    render(<StudioAiEpisodeProductionModal open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "제작 매니페스트 복사" }));

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"version": 1')
    );
    expect(
      (await screen.findByRole("button", { name: "제작 매니페스트 복사" })).textContent
    ).toContain("복사됨");
  });
});
