// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditStudioInspectorDensity } from "./studio-inspector-dom-density";
import { resetStudioInspectorSectionStateCache } from "./studio-inspector-section-state";
import { resolveStudioFigmaSelectionLayoutMetrics } from "./studio-selection-transform-advanced";
import { StudioFigmaDesignPanel } from "./StudioFigmaDesignPanel";

import type { DrawEl, El, ImageEl } from "./studio-element-model";

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetStudioInspectorSectionStateCache();
});
afterEach(cleanup);

function image(id: string, overrides: Partial<ImageEl> = {}): ImageEl {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    rotation: 0,
    ...overrides,
  } as ImageEl;
}

function draw(id: string): DrawEl {
  return {
    id,
    type: "draw",
    mode: "pen",
    brush: "pen",
    stroke: "#111",
    strokeWidth: 4,
    points: [0, 0, 40, 20],
  } as DrawEl;
}

function renderPrecisionPanel(elements: readonly El[], onChange = vi.fn()) {
  const view = render(
    <StudioFigmaDesignPanel
      metrics={resolveStudioFigmaSelectionLayoutMetrics(elements)}
      defaultGeometryOpen
      onChange={onChange}
      onFlipHorizontal={() => undefined}
      onFlipVertical={() => undefined}
      onZoomToSelection={() => undefined}
    />,
  );
  return { ...view, onChange };
}

describe("StudioFigmaDesignPanel precision transform", () => {
  it("opens atomic multi-selection W/H and relative rotation", () => {
    renderPrecisionPanel([
      image("a"),
      image("b", { x: 100, y: 40, width: 20, height: 20 }),
    ]);
    expect((screen.getByLabelText("전체 너비 W") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("전체 높이 H") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("회전(상대)") as HTMLInputElement).disabled).toBe(false);
  });

  it("commits expressions with the selected nine-point resize anchor", () => {
    const { onChange } = renderPrecisionPanel([image("a")]);
    fireEvent.change(screen.getByLabelText("크기 조절 기준점"), {
      target: { value: "center" },
    });
    const width = screen.getByLabelText("너비 W") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "*=1.5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(width, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({
      width: 120,
      resizeAnchor: "center",
    });
  });

  it("keeps repeated modifier nudges local until one explicit commit", () => {
    const { onChange } = renderPrecisionPanel([image("a")]);
    const rotation = screen.getByLabelText("회전") as HTMLInputElement;
    fireEvent.keyDown(rotation, { key: "ArrowUp", shiftKey: true });
    expect(rotation.value).toBe("15");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(rotation, { key: "ArrowUp", altKey: true });
    expect(rotation.value).toBe("15.1");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(rotation, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ rotation: 15.1 });
  });

  it("holds an invalid draft for correction instead of publishing it", () => {
    const { onChange } = renderPrecisionPanel([image("a")]);
    const width = screen.getByLabelText("너비 W") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "10/0" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(width.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("안전한 수식");
    fireEvent.keyDown(width, { key: "Escape" });
    expect(width.value).toBe("80");
    expect(width.hasAttribute("aria-invalid")).toBe(false);
  });

  it("does not duplicate the image ratio toggle owned by the constraints section", () => {
    renderPrecisionPanel([image("a")]);
    expect(screen.queryByRole("button", { name: /가로세로 비율 잠금/u })).toBeNull();
  });

  it("persists aspect lock through the same transform patch channel", () => {
    const { onChange } = renderPrecisionPanel([draw("s")]);
    fireEvent.click(screen.getByRole("button", { name: "가로세로 비율 잠금" }));
    expect(onChange).toHaveBeenCalledWith({ lockAspect: true });
  });

  it("adds line-weight scaling only after the artist opts in", () => {
    const { onChange } = renderPrecisionPanel([
      draw("s"),
      image("i", { x: 80, width: 20, height: 20 }),
    ]);
    const lineWeight = screen.getByRole("button", { name: "선 굵기도 함께 확대" });
    expect(lineWeight.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lineWeight);
    expect(lineWeight.getAttribute("aria-pressed")).toBe("true");
    const width = screen.getByLabelText("전체 너비 W") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "200%" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      width: 204,
      resizeAnchor: "top-left",
      strokeWidthPolicy: "scale",
    });
  });

  it("resets the destructive line-weight opt-in when the selection identity changes", () => {
    const first = [draw("s"), image("i", { x: 80 })] as const;
    const second = [draw("s2"), image("i2", { x: 120 })] as const;
    const { rerender } = render(
      <StudioFigmaDesignPanel
        metrics={resolveStudioFigmaSelectionLayoutMetrics(first)}
        defaultGeometryOpen
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "선 굵기도 함께 확대" }));
    expect(
      screen.getByRole("button", { name: "선 굵기도 함께 확대" }).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(
      <StudioFigmaDesignPanel
        metrics={resolveStudioFigmaSelectionLayoutMetrics(second)}
        defaultGeometryOpen
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "선 굵기도 함께 확대" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("explains every globally disabled precision control to the density audit", () => {
    const { container } = render(
      <StudioFigmaDesignPanel
        metrics={resolveStudioFigmaSelectionLayoutMetrics([draw("s"), image("i", { x: 80 })])}
        defaultGeometryOpen
        disabled
        disabledReason="협업 검토 잠금 중입니다."
        onChange={vi.fn()}
      />,
    );
    const audit = auditStudioInspectorDensity(container);
    expect(audit.violations.filter((violation) => violation.kind === "disabled-without-reason")).toEqual([]);
  });

  it("stays classified and within the inspector control budget when fully equipped", () => {
    const { container } = renderPrecisionPanel([
      draw("s"),
      image("i", { x: 80, width: 20, height: 20 }),
    ]);
    const audit = auditStudioInspectorDensity(container);
    expect(audit.count.unclassified).toBe(0);
    expect(audit.violations).toEqual([]);
  });
});
