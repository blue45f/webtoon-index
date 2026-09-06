// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { StudioBg3dParticleVfxPanel } from "./StudioBg3dParticleVfxPanel";

describe("StudioBg3dParticleVfxPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 7 particle presets and allows user selection", () => {
    const handleSelect = vi.fn();
    render(<StudioBg3dParticleVfxPanel onSelectPreset={handleSelect} />);

    expect(screen.getByText("벚꽃 잎날림")).toBeDefined();
    expect(screen.getByText("마법 스타더스트")).toBeDefined();
    expect(screen.getByText("비와 물보라")).toBeDefined();

    const fireBtn = screen.getByText("불꽃 파편");
    fireEvent.click(fireBtn);

    expect(handleSelect).toHaveBeenCalledWith("fire-embers");
  });
});
