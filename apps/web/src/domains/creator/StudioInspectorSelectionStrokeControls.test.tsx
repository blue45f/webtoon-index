// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStudioChromeInspectorPropertySurface } from "./studio-chrome-ia-map";
import { StudioInspectorSelectionStrokeControls } from "./StudioInspectorSelectionStrokeControls";

import type { DrawEl } from "./studio-element-model";

afterEach(cleanup);

function drawSelection(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    kind: "freehand",
    points: [0, 0, 10, 10],
    stroke: "#112233",
    strokeWidth: 5,
    opacity: 0.8,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    ...overrides,
  } as DrawEl;
}

describe("StudioInspectorSelectionStrokeControls", () => {
  it("exposes the live selection context labels for a draw element (shipped path)", () => {
    const patchEl = vi.fn();
    const selected = drawSelection();
    const surface = resolveStudioChromeInspectorPropertySurface({
      kind: "selection",
      selectedType: "draw",
    });

    render(
      <div data-testid={surface.testId} role="tabpanel" aria-label="선택 요소 속성">
        <StudioInspectorSelectionStrokeControls selected={selected} patchEl={patchEl} />
      </div>,
    );

    expect(screen.getByTestId("studio-inspector-context-selection")).toBeTruthy();
    expect(screen.getByTestId("studio-inspector-selection-stroke-controls")).toBeTruthy();
    for (const label of surface.requiredControlLabels) {
      expect(screen.getByText(label), label).toBeTruthy();
      expect(screen.getByLabelText(label), `aria ${label}`).toBeTruthy();
    }

    fireEvent.change(screen.getByLabelText("선 두께"), { target: { value: "12" } });
    expect(patchEl).toHaveBeenCalledWith("draw-1", { strokeWidth: 12 });

    fireEvent.change(screen.getByLabelText("불투명도"), { target: { value: "0.5" } });
    expect(patchEl).toHaveBeenCalledWith("draw-1", { opacity: 0.5 });
  });
});
