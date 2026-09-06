// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioSubToolPalette } from "./StudioSubToolPalette";

afterEach(cleanup);

function mount(activeCategory = "pen", activeSubToolId = "gpen") {
  const select = vi.fn();
  const category = vi.fn();
  const view = render(<StudioSubToolPalette activeCategory={activeCategory} activeSubToolId={activeSubToolId} onSelectSubTool={select} onCategoryChange={category} />);
  return { ...view, select, category };
}

describe("shortcut palette discovery interactions", () => {
  it("shows real names, feature previews, and accessible usage descriptions", () => {
    const { container } = mount();
    expect(screen.getByText("대표 18개")).toBeTruthy();
    expect(container.querySelectorAll("[data-studio-subtool-preview]")).toHaveLength(3);
    const option = screen.getByRole("option", { name: "G펜(필압)" });
    const description = document.getElementById(option.getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain("웹툰 선화");
  });
  it("AND-searches legacy names and use cases across all shortcut categories without selecting", () => {
    const { select } = mount();
    const input = screen.getByRole("searchbox", { name: "빠른 브러시 검색" });
    fireEvent.change(input, { target: { value: "스플래터(흩뿌리기)" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    const splatter = screen.getByRole("option", { name: "물감 튀김" });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(splatter);
    fireEvent.keyDown(splatter, { key: "Enter" });
    expect(select).toHaveBeenCalledExactlyOnceWith("splatter");
    fireEvent.change(input, { target: { value: "ＧＰＥＮ 선화" } });
    expect(screen.getByRole("option", { name: "G펜(필압)" })).toBeTruthy();
  });
  it("supports Home/End roving focus separately from selected state", () => {
    const { select, category } = mount();
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(options[0], { key: "End" });
    expect(document.activeElement).toBe(options[2]);
    expect(options.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(options[2], { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(document.activeElement).toBe(tabs[5]);
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(select).not.toHaveBeenCalled();
    expect(category).not.toHaveBeenCalled();
  });
  it("clears search with Escape without propagating a close or changing the brush", () => {
    const { select } = mount();
    const bubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    try {
      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "zz-no-such-tool" } });
      expect(screen.queryAllByRole("option")).toHaveLength(0);
      fireEvent.keyDown(input, { key: "Escape" });
      expect((input as HTMLInputElement).value).toBe("");
      expect(document.activeElement).toBe(input);
      expect(screen.getAllByRole("option")).toHaveLength(3);
      expect(bubbled).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    } finally { document.removeEventListener("keydown", bubbled); }
  });
  it("uses unique relationships for multiple mounted palettes", () => {
    mount();
    mount("eraser", "standard-eraser");
    const panels = screen.getAllByRole("tabpanel");
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(2);
    for (const panel of panels) expect(document.getElementById(panel.getAttribute("aria-labelledby")!)).toBeTruthy();
    expect(within(panels[1]).getAllByRole("option")).toHaveLength(2);
  });
  it("leaves an advanced active brush untouched instead of silently replacing it", () => {
    const { select } = mount("pen", "perfect-ink");
    expect(screen.getByText(/현재 브러시는 전체 라이브러리의 항목/)).toBeTruthy();
    expect(screen.queryAllByRole("option", { selected: true })).toHaveLength(0);
    expect(select).not.toHaveBeenCalled();
  });
});
