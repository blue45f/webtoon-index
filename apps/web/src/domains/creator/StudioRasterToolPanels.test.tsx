// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioHealClonePanel } from "./StudioHealClonePanel";
import { StudioHistoryBrushPanel } from "./StudioHistoryBrushPanel";
import { StudioPuppetWarpPanel } from "./StudioPuppetWarpPanel";

afterEach(cleanup);

describe("raster tool panel busy and prerequisite guidance", () => {
  it("freezes heal/clone controls while the destructive stroke is being encoded", () => {
    render(
      <StudioHealClonePanel
        mode="clone"
        radiusPx={20}
        hardness={0.5}
        opacity={1}
        aligned
        hasSource
        busy
        onPickMode={vi.fn()}
        onRadiusChange={vi.fn()}
        onHardnessChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onAlignedChange={vi.fn()}
        onClearSource={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "소스 해제" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("slider")).toHaveLength(3);
    expect(screen.getAllByRole("slider").every((slider) => slider.hasAttribute("disabled"))).toBe(true);
  });

  it("freezes history brush controls while applying a restore stroke", () => {
    render(
      <StudioHistoryBrushPanel
        active
        radiusPx={20}
        hardness={0.5}
        opacity={1}
        hasSource
        busy
        onToggleActive={vi.fn()}
        onRadiusChange={vi.fn()}
        onHardnessChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onClearSource={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "소스 해제" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("slider").every((slider) => slider.hasAttribute("disabled"))).toBe(true);
  });

  it("explains exactly why puppet Apply is disabled", () => {
    const { rerender } = render(
      <StudioPuppetWarpPanel
        active
        pins={[]}
        onToggle={vi.fn()}
        onRemovePin={vi.fn()}
        onResetPositions={vi.fn()}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const apply = screen.getByRole("button", { name: "적용" });
    expect(apply.hasAttribute("disabled")).toBe(true);
    expect(apply.getAttribute("title")).toBe("이미지에 핀을 먼저 놓으세요.");

    rerender(
      <StudioPuppetWarpPanel
        active
        pins={[{ id: "pin-1", x: 0.5, y: 0.5, restX: 0.5, restY: 0.5 }]}
        canApply={false}
        onToggle={vi.fn()}
        onRemovePin={vi.fn()}
        onResetPositions={vi.fn()}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "적용" }).getAttribute("title")).toBe(
      "핀을 원본 위치에서 움직인 뒤 적용하세요.",
    );
  });
});
