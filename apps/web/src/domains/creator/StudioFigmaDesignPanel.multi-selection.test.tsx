// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveStudioInspectorSelectionLayoutMetrics } from "./studio-inspector-multi-selection";
import { resetStudioInspectorSectionStateCache } from "./studio-inspector-section-state";
import { StudioFigmaDesignPanel } from "./StudioFigmaDesignPanel";

import type { El, ImageEl } from "./studio-element-model";

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetStudioInspectorSectionStateCache();
});
afterEach(cleanup);

function image(id: string, x: number, y: number): ImageEl {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x,
    y,
    width: 40,
    height: 20,
    rotation: 0,
  } as ImageEl;
}

function openGeometry(): void {
  fireEvent.click(screen.getByRole("button", { name: /^변형/u }));
}

function renderPanel(elements: readonly El[], onChange = vi.fn()) {
  render(
    <StudioFigmaDesignPanel
      metrics={resolveStudioInspectorSelectionLayoutMetrics(elements)}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("StudioFigmaDesignPanel production multi-selection", () => {
  it("opens total W/H and relative rotation instead of sending the artist back to canvas", () => {
    renderPanel([image("a", 10, 20), image("b", 90, 60)]);
    openGeometry();

    const width = screen.getByLabelText("전체 너비 W") as HTMLInputElement;
    const height = screen.getByLabelText("전체 높이 H") as HTMLInputElement;
    const rotation = screen.getByLabelText("회전(상대)") as HTMLInputElement;
    expect(width.disabled).toBe(false);
    expect(height.disabled).toBe(false);
    expect(rotation.disabled).toBe(false);
    // A marquee stores no shared angle, so the box is an increment that reads 0.
    expect(rotation.value).toBe("0");
    expect(screen.getByText(/현재 비율을 유지/u)).toBeTruthy();
    expect(screen.getByText(/선택 중심을 기준/u)).toBeTruthy();
  });

  it("commits one completed total-size or rotation number, never intermediate keystrokes", () => {
    const onChange = renderPanel([image("a", 10, 20), image("b", 90, 60)]);
    openGeometry();

    const width = screen.getByLabelText("전체 너비 W") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "2" } });
    fireEvent.change(width, { target: { value: "20" } });
    fireEvent.change(width, { target: { value: "220" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(width, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ width: 220, resizeAnchor: "top-left" });

    const height = screen.getByLabelText("전체 높이 H") as HTMLInputElement;
    fireEvent.change(height, { target: { value: "120" } });
    fireEvent.keyDown(height, { key: "Enter" });
    // phase-180 attaches the resize anchor to size commits (its pivot feature);
    // the guarantee here is still one completed number per commit.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ height: 120 }));

    const rotation = screen.getByLabelText("회전(상대)") as HTMLInputElement;
    fireEvent.change(rotation, { target: { value: "15" } });
    fireEvent.blur(rotation);
    expect(onChange).toHaveBeenLastCalledWith({ rotation: 15 });
  });

  it("keeps rotation disabled with a concrete explanation when one member cannot rotate", () => {
    const panel = {
      id: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    } as El;
    renderPanel([panel, image("image", 140, 0)]);
    openGeometry();

    const width = screen.getByLabelText("전체 너비 W") as HTMLInputElement;
    const rotation = screen.getByLabelText("회전(상대)") as HTMLInputElement;
    expect(width.disabled).toBe(false);
    expect(rotation.disabled).toBe(true);
    expect(rotation.title).toContain("회전할 수 없는 요소");
    expect(screen.getByText(/회전할 수 없는 요소/u)).toBeTruthy();
  });
});
