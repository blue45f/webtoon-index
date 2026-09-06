// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioPressureCurveGraph } from "./StudioPressureCurveGraph";

function renderPressureCurve(onPressureCurveChange = vi.fn<(value: number) => void>()) {
  const view = render(
    <StudioPressureCurveGraph
      pressureCurve={1}
      onPressureCurveChange={onPressureCurveChange}
      pressureMinSize={0.25}
    />
  );
  return { onPressureCurveChange, view };
}

function stubCurveGeometry(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      bottom: 88,
      height: 88,
      left: 0,
      right: 160,
      toJSON: () => ({}),
      top: 0,
      width: 160,
      x: 0,
      y: 0,
    }) as DOMRect;
}

afterEach(cleanup);

describe("StudioPressureCurveGraph interaction", () => {
  it("maps keyboard directions to visible curve output rather than inverted gamma numbers", () => {
    const { onPressureCurveChange } = renderPressureCurve();
    const handle = screen.getByRole("slider", { name: "필압 곡선 제어점" });

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "End" });

    expect(onPressureCurveChange.mock.calls).toEqual([
      [0.95],
      [0.95],
      [1.05],
      [1.05],
      [2.5],
      [0.35],
    ]);
  });

  it("converts a dragged mid-pressure output back into the compatible scalar exponent", () => {
    const { onPressureCurveChange, view } = renderPressureCurve();
    const handle = screen.getByRole("slider", { name: "필압 곡선 제어점" });
    const svg = view.container.querySelector<SVGSVGElement>(
      'svg[data-studio-pressure-curve-chart="true"]'
    );
    expect(svg).not.toBeNull();
    stubCurveGeometry(svg!);

    // Mid-pressure input x=0.5, output y=0.75 (22px from the top of an 88px chart).
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 80,
      clientY: 22,
      pointerId: 7,
    });

    expect(onPressureCurveChange).toHaveBeenCalledTimes(1);
    expect(onPressureCurveChange.mock.calls[0]?.[0]).toBeCloseTo(
      Math.log(0.75) / Math.log(0.5),
      5
    );
  });

  it("leaves secondary and barrel-button contacts available to context actions", () => {
    const { onPressureCurveChange } = renderPressureCurve();
    const handle = screen.getByRole("slider", { name: "필압 곡선 제어점" });

    fireEvent.pointerDown(handle, {
      button: 2,
      clientX: 80,
      clientY: 22,
      pointerId: 9,
    });

    expect(onPressureCurveChange).not.toHaveBeenCalled();
  });
});
