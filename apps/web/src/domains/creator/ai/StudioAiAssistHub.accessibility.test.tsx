// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAiAssistHub } from "./StudioAiAssistHub";

import type { StudioAiAssistHubProps } from "./StudioAiAssistHub";

function props(
  overrides: Partial<StudioAiAssistHubProps> = {}
): StudioAiAssistHubProps {
  return {
    activeTool: "background",
    connectionLabel: "연결됨",
    connectionOk: true,
    imageConfigured: true,
    onApplyPresetPrompt: vi.fn(),
    onOpenSettings: vi.fn(),
    onToolChange: vi.fn(),
    recentState: { version: 1, entries: [] },
    textConfigured: true,
    toolPanel: <input aria-label="활성 도구" />,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("StudioAiAssistHub task-first and keyboard UX", () => {
  it("uses a roving tab stop and arrow-key selection", () => {
    const input = props();
    render(<StudioAiAssistHub {...input} />);

    const background = screen.getByRole("tab", { name: /배경/u });
    const character = screen.getByRole("tab", { name: /캐릭터/u });
    const panel = screen.getByRole("tabpanel");

    expect(background.getAttribute("tabindex")).toBe("0");
    expect(character.getAttribute("tabindex")).toBe("-1");
    expect(background.hasAttribute("aria-controls")).toBe(true);
    expect(panel.getAttribute("aria-labelledby")).toBe(background.id);

    fireEvent.keyDown(background, { key: "ArrowRight" });
    expect(input.onToolChange).toHaveBeenCalledWith("character");
  });

  it("launches existing end-to-end scenario and local recipe workflows", () => {
    const onOpenScenario = vi.fn();
    const onOpenSuperSuite = vi.fn();

    render(
      <StudioAiAssistHub
        {...props({ onOpenScenario, onOpenSuperSuite })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /스토리 → 편집 가능한 컷/u }));
    fireEvent.click(screen.getByRole("button", { name: /화풍·연출 레시피 만들기/u }));

    expect(onOpenScenario).toHaveBeenCalledTimes(1);
    expect(onOpenSuperSuite).toHaveBeenCalledTimes(1);
  });
});
