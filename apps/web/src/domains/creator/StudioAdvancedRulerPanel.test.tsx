// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioAdvancedRulerPanel,
  type StudioAdvancedRulerPanelProps,
} from "./StudioAdvancedRulerPanel";

import type {
  StudioAdvancedRuler,
  StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";

afterEach(cleanup);

const rulerDocument: StudioAdvancedRulerDocument = {
  version: 1,
  activeSnapRulerId: "curve-a",
  selectedRulerId: "curve-a",
  rulers: [{
    id: "curve-a",
    type: "curve",
    name: "옷 주름",
    enabled: true,
    visible: true,
    scope: { kind: "page", groupId: null },
    snapMode: "through-start",
    fixedOffset: 0,
    p0: { x: 10, y: 100 },
    p1: { x: 50, y: 20 },
    p2: { x: 150, y: 180 },
    p3: { x: 200, y: 100 },
  }],
};

function documentWithSelected(ruler: StudioAdvancedRuler): StudioAdvancedRulerDocument {
  return {
    version: 1,
    activeSnapRulerId: ruler.id,
    selectedRulerId: ruler.id,
    rulers: [ruler],
  };
}

const parallelRuler: StudioAdvancedRuler = {
  id: "parallel-a",
  type: "parallel",
  name: "빗줄기",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  angleDeg: 30,
  originX: 400,
  originY: 600,
  guideSpacing: 96,
};

const concentricRuler: StudioAdvancedRuler = {
  id: "concentric-a",
  type: "concentric",
  name: "파문",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  centerX: 320,
  centerY: 320,
  guideSpacing: 120,
};

const radialRuler: StudioAdvancedRuler = {
  id: "radial-a",
  type: "radial",
  name: "집중선",
  enabled: true,
  visible: true,
  scope: { kind: "page", groupId: null },
  centerX: 400,
  centerY: 200,
};

function props(overrides: Partial<StudioAdvancedRulerPanelProps> = {}): StudioAdvancedRulerPanelProps {
  return {
    document: rulerDocument,
    groups: [{ id: "background", name: "배경" }],
    canvasWidth: 800,
    canvasHeight: 1_200,
    onAdd: vi.fn(),
    onPatch: vi.fn(),
    onRemove: vi.fn(),
    onSelect: vi.fn(),
    onSetActiveSnap: vi.fn(),
    ...overrides,
  };
}

describe("StudioAdvancedRulerPanel", () => {
  it("adds curve and fisheye rulers from explicit controls", () => {
    const onAdd = vi.fn();
    render(<StudioAdvancedRulerPanel {...props({ onAdd })} />);
    fireEvent.click(screen.getByRole("button", { name: /^곡선자$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^어안자$/ }));
    expect(onAdd).toHaveBeenNthCalledWith(1, "curve");
    expect(onAdd).toHaveBeenNthCalledWith(2, "fisheye");
  });

  it("adds parallel, concentric and radial rulers from explicit controls", () => {
    const onAdd = vi.fn();
    render(<StudioAdvancedRulerPanel {...props({ onAdd })} />);
    fireEvent.click(screen.getByRole("button", { name: /^평행선자$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^동심원자$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^방사선자$/ }));
    expect(onAdd).toHaveBeenNthCalledWith(1, "parallel");
    expect(onAdd).toHaveBeenNthCalledWith(2, "concentric");
    expect(onAdd).toHaveBeenNthCalledWith(3, "radial");
  });

  it("shows per-kind controls when switching the selected ruler kind", () => {
    const { rerender } = render(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(parallelRuler),
    })} />);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(screen.getByText("30°")).toBeTruthy();
    expect(screen.getByText("96px")).toBeTruthy();
    expect(screen.getByLabelText("기준점 X")).toBeTruthy();
    expect(screen.queryByLabelText("렌즈 중심 X")).toBeNull();

    rerender(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(concentricRuler),
    })} />);
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getByText("120px")).toBeTruthy();
    expect(screen.getByLabelText("중심점 X")).toBeTruthy();
    expect(screen.queryByLabelText("기준점 X")).toBeNull();

    rerender(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(radialRuler),
    })} />);
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(screen.getByLabelText("중심점 Y")).toBeTruthy();
    expect(screen.getByText("방사선자 · 집중선")).toBeTruthy();
  });

  it("commits parallel angle and spacing through deferred sliders", () => {
    const onPatch = vi.fn();
    render(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(parallelRuler),
      onPatch,
    })} />);
    const [angleSlider, spacingSlider] = screen.getAllByRole("slider");
    fireEvent.change(angleSlider!, { target: { value: "135" } });
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.pointerUp(angleSlider!);
    expect(onPatch).toHaveBeenLastCalledWith("parallel-a", { angleDeg: 135 });

    fireEvent.change(spacingSlider!, { target: { value: "128" } });
    fireEvent.blur(spacingSlider!);
    expect(onPatch).toHaveBeenLastCalledWith("parallel-a", { guideSpacing: 128 });
  });

  it("commits concentric and radial centers through coordinate inputs", () => {
    const onPatch = vi.fn();
    const { rerender } = render(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(concentricRuler),
      onPatch,
    })} />);
    const centerX = screen.getByLabelText("중심점 X");
    fireEvent.focus(centerX);
    fireEvent.change(centerX, { target: { value: "512" } });
    fireEvent.blur(centerX);
    expect(onPatch).toHaveBeenLastCalledWith("concentric-a", { centerX: 512, centerY: 320 });

    rerender(<StudioAdvancedRulerPanel {...props({
      document: documentWithSelected(radialRuler),
      onPatch,
    })} />);
    const centerY = screen.getByLabelText("중심점 Y");
    fireEvent.focus(centerY);
    fireEvent.change(centerY, { target: { value: "48" } });
    fireEvent.blur(centerY);
    expect(onPatch).toHaveBeenLastCalledWith("radial-a", { centerX: 400, centerY: 48 });
  });

  it("selects, hides, deactivates and removes a ruler", () => {
    const onSelect = vi.fn();
    const onPatch = vi.fn();
    const onRemove = vi.fn();
    const onSetActiveSnap = vi.fn();
    render(<StudioAdvancedRulerPanel {...props({
      onSelect,
      onPatch,
      onRemove,
      onSetActiveSnap,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /^곡선자 · 옷 주름$/ }));
    fireEvent.click(screen.getByRole("button", { name: "옷 주름 숨기기" }));
    fireEvent.click(screen.getByRole("button", { name: "옷 주름 스냅 해제" }));
    fireEvent.click(screen.getByRole("button", { name: "옷 주름 삭제" }));
    expect(onSelect).toHaveBeenCalledWith("curve-a");
    expect(onPatch).toHaveBeenCalledWith("curve-a", { visible: false });
    expect(onSetActiveSnap).toHaveBeenCalledWith(null);
    expect(onRemove).toHaveBeenCalledWith("curve-a");
  });

  it("changes a ruler from page scope to an authored layer group", () => {
    const onPatch = vi.fn();
    render(<StudioAdvancedRulerPanel {...props({ onPatch })} />);
    fireEvent.change(screen.getByLabelText("적용 범위"), {
      target: { value: "group:background" },
    });
    expect(onPatch).toHaveBeenCalledWith("curve-a", {
      scope: { kind: "group", groupId: "background" },
    });
  });

  it("disables mutation controls at a locked document boundary", () => {
    render(<StudioAdvancedRulerPanel {...props({ disabled: true, disabledReason: "검토 잠금" })} />);
    expect((screen.getByRole("button", { name: /^곡선자$/ }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "옷 주름 삭제" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByLabelText("적용 범위") as HTMLSelectElement).disabled).toBe(true);
  });
});
