// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SHAPE_PARAMS, DEFAULT_STROKE_STYLE } from "./brush/studio-stroke-shapes";
import { DEFAULT_STUDIO_SKETCH_STYLE } from "./studio-rough-shape";
import { StudioStrokeShapePanel } from "./StudioStrokeShapePanel";

import type { ShapeParams, StrokeShapeKind, StrokeStyle } from "./brush/studio-stroke-shapes";
import type { StudioSketchStyle } from "./studio-rough-shape";

afterEach(cleanup);

function panelProps(overrides: Partial<{
  kind: StrokeShapeKind;
  strokeStyle: StrokeStyle;
  shapeParams: ShapeParams;
  sketch: StudioSketchStyle;
}> = {}) {
  return {
    kind: "rect" as StrokeShapeKind,
    strokeStyle: { ...DEFAULT_STROKE_STYLE },
    shapeParams: { ...DEFAULT_SHAPE_PARAMS },
    sketch: { ...DEFAULT_STUDIO_SKETCH_STYLE },
    onPatchStrokeStyle: vi.fn(),
    onPatchShapeParams: vi.fn(),
    onPatchSketch: vi.fn(),
    ...overrides,
  };
}

describe("StudioStrokeShapePanel 손그림 스케치", () => {
  it("끔 상태에서는 토글만 보이고, 켜면 enabled 패치를 보낸다", () => {
    const props = panelProps();
    render(<StudioStrokeShapePanel {...props} />);

    expect(screen.getByText("손그림 스케치")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /^거칠기/u })).toBeNull();
    expect(screen.queryByRole("slider", { name: /^휘어짐/u })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "끔" }));
    expect(props.onPatchSketch).toHaveBeenLastCalledWith({ enabled: true });
  });

  it("켬 상태에서는 거칠기/휘어짐 슬라이더와 채우기 질감 4종 칩을 노출한다", () => {
    const props = panelProps({ sketch: { ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true } });
    render(<StudioStrokeShapePanel {...props} />);

    fireEvent.change(screen.getByRole("slider", { name: /^거칠기/u }), { target: { value: "2.5" } });
    expect(props.onPatchSketch).toHaveBeenLastCalledWith({ roughness: 2.5 });

    fireEvent.change(screen.getByRole("slider", { name: /^휘어짐/u }), { target: { value: "3" } });
    expect(props.onPatchSketch).toHaveBeenLastCalledWith({ bowing: 3 });

    for (const label of ["빗금", "단색", "교차 빗금", "지그재그"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "지그재그" }));
    expect(props.onPatchSketch).toHaveBeenLastCalledWith({ fillStyle: "zigzag" });

    fireEvent.click(screen.getByRole("button", { name: "켬" }));
    expect(props.onPatchSketch).toHaveBeenLastCalledWith({ enabled: false });
  });

  it("선(line)에서는 채우기 질감 칩을 숨긴다(채우기 없는 종류)", () => {
    render(
      <StudioStrokeShapePanel
        {...panelProps({ kind: "line", sketch: { ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true } })}
      />
    );
    expect(screen.getByRole("slider", { name: /^거칠기/u })).toBeTruthy();
    expect(screen.queryByText("채우기 질감")).toBeNull();
    expect(screen.queryByRole("button", { name: "지그재그" })).toBeNull();
  });

  it("기본값 버튼은 스케치가 기본값이 아니면 활성화되고, 셋 모두 리셋한다", () => {
    const identity = panelProps();
    const { unmount } = render(<StudioStrokeShapePanel {...identity} />);
    expect(
      (screen.getByRole("button", { name: /기본값/ }) as HTMLButtonElement).disabled
    ).toBe(true);
    unmount();

    const props = panelProps({ sketch: { ...DEFAULT_STUDIO_SKETCH_STYLE, enabled: true } });
    render(<StudioStrokeShapePanel {...props} />);
    const reset = screen.getByRole("button", { name: /기본값/ }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(props.onPatchStrokeStyle).toHaveBeenCalledWith(DEFAULT_STROKE_STYLE);
    expect(props.onPatchShapeParams).toHaveBeenCalledWith(DEFAULT_SHAPE_PARAMS);
    expect(props.onPatchSketch).toHaveBeenCalledWith(DEFAULT_STUDIO_SKETCH_STYLE);
  });
});
