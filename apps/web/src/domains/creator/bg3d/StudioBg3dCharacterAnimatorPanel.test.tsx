// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dCharacterAnimatorPanel } from "./StudioBg3dCharacterAnimatorPanel";

describe("StudioBg3dCharacterAnimatorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with default 7-head proportion and switches tabs", () => {
    const handleProps = vi.fn();
    const handleExp = vi.fn();
    const handleMotion = vi.fn();

    render(
      <StudioBg3dCharacterAnimatorPanel
        onApplyProportions={handleProps}
        onApplyFacialExpression={handleExp}
        onPlayAnimationClip={handleMotion}
      />,
    );

    expect(screen.getByText("등신대 비율")).toBeDefined();
    expect(screen.getByText("애니 표정 (12종)")).toBeDefined();

    // Switch to facial tab
    const facialTab = screen.getByText("애니 표정 (12종)");
    fireEvent.click(facialTab);

    expect(screen.getByText("활짝 웃음 (Joy)")).toBeDefined();

    // Select smile
    const smileBtn = screen.getByText("활짝 웃음 (Joy)");
    fireEvent.click(smileBtn);

    expect(handleExp).toHaveBeenCalledTimes(1);
    expect(handleExp.mock.calls[0][0].expression).toBe("joy-smile");
  });
});
