// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auditStudioInspectorDensity } from "./studio-inspector-dom-density";
import { StudioSelectionMatchingPanel } from "./StudioSelectionMatchingPanel";

import type { StudioSelectMatchingOption } from "./studio-select-matching";

const OPTIONS: readonly StudioSelectMatchingOption[] = [
  {
    criterion: "paint",
    label: "같은 외형",
    description: "채우기와 선이 같은 요소를 선택합니다.",
    count: 4,
  },
  {
    criterion: "type",
    label: "같은 유형",
    description: "같은 유형의 요소를 선택합니다.",
    count: 7,
  },
];

afterEach(cleanup);

describe("StudioSelectionMatchingPanel", () => {
  it("renders the first useful criterion and invokes it", () => {
    const onSelect = vi.fn();
    render(<StudioSelectionMatchingPanel options={OPTIONS} onSelect={onSelect} />);

    expect((screen.getByLabelText("같은 항목 선택 기준") as HTMLSelectElement).value).toBe("paint");
    expect(screen.getByText("채우기와 선이 같은 요소를 선택합니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "같은 외형 4개 전체 선택" }));
    expect(onSelect).toHaveBeenCalledWith("paint");
  });

  it("changes criterion, count, description and selection action together", () => {
    const onSelect = vi.fn();
    render(<StudioSelectionMatchingPanel options={OPTIONS} onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText("같은 항목 선택 기준"), {
      target: { value: "type" },
    });

    expect(screen.getByText("같은 유형의 요소를 선택합니다.")).toBeTruthy();
    const action = screen.getByRole("button", { name: "같은 유형 7개 전체 선택" });
    expect(action.getAttribute("data-studio-select-matching-action")).toBe("type");
    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledWith("type");
  });

  it("classifies both controls and connects their current explanation", () => {
    const { container } = render(
      <StudioSelectionMatchingPanel options={OPTIONS} onSelect={vi.fn()} />,
    );
    const criterion = screen.getByLabelText("같은 항목 선택 기준");
    const action = screen.getByRole("button", { name: "같은 외형 4개 전체 선택" });
    const descriptionId = criterion.getAttribute("aria-describedby");
    const audit = auditStudioInspectorDensity(container);
    const ids = [...container.querySelectorAll("[data-inspector-control-id]")].map((element) =>
      element.getAttribute("data-inspector-control-id"),
    );

    expect(descriptionId).toBeTruthy();
    expect(action.getAttribute("aria-describedby")).toBe(descriptionId);
    expect(container.ownerDocument.getElementById(descriptionId!)?.textContent).toContain(
      "채우기와 선",
    );
    expect(audit.count.contextual).toBe(2);
    expect(audit.count.unclassified).toBe(0);
    expect(audit.violations).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders nothing when no criterion has another match", () => {
    const view = render(
      <StudioSelectionMatchingPanel options={[]} onSelect={vi.fn()} />,
    );
    expect(view.container.childElementCount).toBe(0);
  });
});
