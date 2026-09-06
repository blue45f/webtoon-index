// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditStudioInspectorDensity } from "./studio-inspector-dom-density";
import { resetStudioInspectorSectionStateCache } from "./studio-inspector-section-state";
import {
  StudioInspectorOrderAlignSection,
  StudioInspectorSelectionActions,
} from "./StudioInspectorOrderAlignSection";

import type { El } from "./studio-element-model";

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetStudioInspectorSectionStateCache();
});
afterEach(cleanup);

const dummyEl: El = {
  id: "el-1",
  type: "image",
  src: "data:image/png;base64,abc",
  x: 10,
  y: 20,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
};

function renderOrderAlignSection() {
  const alignSelected = vi.fn();
  const view = render(
    <StudioInspectorOrderAlignSection
      selected={dummyEl}
      selectedBg3dEditSource={null}
      patchEl={vi.fn()}
      reorder={vi.fn()}
      alignSelected={alignSelected}
      duplicateSelected={vi.fn()}
      removeSelected={vi.fn()}
      setPoserInitialDataUrl={vi.fn()}
      setPoserInitialElementId={vi.fn()}
      setPoserVrmOpen={vi.fn()}
      setBg3dInitialScene={vi.fn()}
      setBg3dInitialDataUrl={vi.fn()}
      setBg3dInitialElementId={vi.fn()}
      setBg3dOpen={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^정렬·순서/u }));
  return { ...view, alignSelected };
}

function renderActions(selectionCount: number) {
  const alignSelected = vi.fn();
  const duplicateSelected = vi.fn();
  const removeSelected = vi.fn();
  const reorder = vi.fn();
  const view = render(
    <StudioInspectorSelectionActions
      selectionCount={selectionCount}
      alignSelected={alignSelected}
      duplicateSelected={duplicateSelected}
      removeSelected={removeSelected}
      reorder={reorder}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^정렬·순서/u }));
  return { ...view, alignSelected, duplicateSelected, removeSelected, reorder };
}

describe("StudioInspectorOrderAlignSection", () => {
  it("keeps single-selection alignment live and explains why distribution is unavailable", () => {
    const { alignSelected } = renderOrderAlignSection();

    fireEvent.click(screen.getByRole("button", { name: "왼쪽 정렬" }));
    expect(alignSelected).toHaveBeenCalledWith("left");

    const distH = screen.getByRole("button", { name: "가로 등간격 분배" }) as HTMLButtonElement;
    const distV = screen.getByRole("button", { name: "세로 등간격 분배" }) as HTMLButtonElement;
    expect(distH.disabled).toBe(true);
    expect(distV.disabled).toBe(true);
    expect(distH.title).toContain("3개 이상");
    expect(distV.title).toContain("3개 이상");
  });
});

describe("StudioInspectorSelectionActions", () => {
  it("surfaces the same labelled order and alignment commands for a marquee selection", () => {
    const { alignSelected, reorder } = renderActions(2);

    fireEvent.click(screen.getByRole("button", { name: "선택을 맨 앞으로" }));
    expect(reorder).toHaveBeenCalledWith("front");
    fireEvent.click(screen.getByRole("button", { name: "가로 가운데 정렬" }));
    expect(alignSelected).toHaveBeenCalledWith("hcenter");
    expect(screen.getByText("2개")).toBeTruthy();
  });

  it("requires three targets for distribution and explains the disabled state", () => {
    renderActions(2);
    const horizontal = screen.getByRole("button", { name: "가로 등간격 분배" }) as HTMLButtonElement;
    const vertical = screen.getByRole("button", { name: "세로 등간격 분배" }) as HTMLButtonElement;

    expect(horizontal.disabled).toBe(true);
    expect(vertical.disabled).toBe(true);
    expect(horizontal.title).toContain("3개 이상");
    expect(vertical.title).toContain("3개 이상");
  });

  it("enables both distribution directions for three or more targets", () => {
    const { alignSelected } = renderActions(3);
    const horizontal = screen.getByRole("button", { name: "가로 등간격 분배" }) as HTMLButtonElement;
    const vertical = screen.getByRole("button", { name: "세로 등간격 분배" }) as HTMLButtonElement;

    expect(horizontal.disabled).toBe(false);
    expect(vertical.disabled).toBe(false);
    fireEvent.click(horizontal);
    fireEvent.click(vertical);
    expect(alignSelected).toHaveBeenNthCalledWith(1, "distributeH");
    expect(alignSelected).toHaveBeenNthCalledWith(2, "distributeV");
  });

  it("keeps duplicate and delete immediately available with full accessible names", () => {
    const duplicateSelected = vi.fn();
    const removeSelected = vi.fn();
    render(
      <StudioInspectorSelectionActions
        selectionCount={4}
        alignSelected={() => undefined}
        duplicateSelected={duplicateSelected}
        removeSelected={removeSelected}
        reorder={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "4개 선택 복제" }));
    fireEvent.click(screen.getByRole("button", { name: "4개 선택 삭제" }));
    expect(duplicateSelected).toHaveBeenCalledTimes(1);
    expect(removeSelected).toHaveBeenCalledTimes(1);
  });

  it("classifies every interactive control and gives each one a unique identity", () => {
    const { container } = renderActions(3);
    const audit = auditStudioInspectorDensity(container);
    const ids = [...container.querySelectorAll("[data-inspector-control-id]")].map((element) =>
      element.getAttribute("data-inspector-control-id"),
    );

    expect(audit.count.unclassified).toBe(0);
    expect(audit.violations).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
