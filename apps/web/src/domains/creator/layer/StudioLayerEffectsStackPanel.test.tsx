// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultLayerEffect,
  type StudioLayerEffectsStack,
} from "./studio-layer-effects-stack";
import { StudioLayerEffectsStackPanel } from "./StudioLayerEffectsStackPanel";

afterEach(() => {
  cleanup();
});

describe("StudioLayerEffectsStackPanel", () => {
  it("renders empty state notice when no effects are present", () => {
    const onChange = vi.fn();
    render(<StudioLayerEffectsStackPanel stack={{ effects: [] }} onChange={onChange} />);

    expect(screen.getByText(/적용된 레이어 효과가 없습니다/u)).not.toBeNull();
  });

  it("adds new effect when clicking add buttons", () => {
    const onChange = vi.fn();
    render(<StudioLayerEffectsStackPanel stack={{ effects: [] }} onChange={onChange} />);

    const addGlowBtn = screen.getByRole("button", { name: "발광 효과 추가" });
    fireEvent.click(addGlowBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newStack: StudioLayerEffectsStack = onChange.mock.calls[0][0];
    expect(newStack.effects).toHaveLength(1);
    expect(newStack.effects[0].kind).toBe("glow");
  });

  it("renders existing effects with toggle and remove controls", () => {
    const onChange = vi.fn();
    const glow = createDefaultLayerEffect("glow", "test-glow");
    render(<StudioLayerEffectsStackPanel stack={{ effects: [glow] }} onChange={onChange} />);

    expect(screen.getByText(/발광 \(외곽\)/u)).not.toBeNull();

    const toggleBtn = screen.getByRole("button", { name: "효과 끄기" });
    fireEvent.click(toggleBtn);
    expect(onChange).toHaveBeenCalled();

    const removeBtn = screen.getByRole("button", { name: "효과 삭제" });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalled();
  });
});
