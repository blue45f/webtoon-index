// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Palette, Ruler, Timer, Wand2 } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioWorkbenchTabStrip,
  studioWorkbenchTabId,
  studioWorkbenchTabPanelId,
  studioWorkbenchTabPanelProps,
  type StudioWorkbenchTab,
} from "./studio-workbench-tabs";

const TABS: readonly StudioWorkbenchTab[] = [
  { id: "spec-slicer", label: "규격 검증", icon: Ruler },
  { id: "color-harmony", label: "컬러 하모니", icon: Palette },
  { id: "focus-timer", label: "집중 타이머", icon: Timer },
  { id: "croquis-pose", label: "크로키 포즈", icon: Wand2 },
];

afterEach(cleanup);

function renderStrip(overrides?: {
  activeId?: string;
  onSelect?: (id: string) => void;
  tabs?: readonly StudioWorkbenchTab[];
}) {
  const onSelect = overrides?.onSelect ?? vi.fn();
  render(
    <StudioWorkbenchTabStrip
      tabs={overrides?.tabs ?? TABS}
      activeId={overrides?.activeId ?? "spec-slicer"}
      onSelect={onSelect}
      ariaLabel="어시스턴트 구역"
      idPrefix="assistant"
    />
  );
  return { onSelect };
}

describe("StudioWorkbenchTabStrip — ARIA structure", () => {
  it("renders a labelled tablist with one tab per entry", () => {
    renderStrip();
    const list = screen.getByRole("tablist", { name: "어시스턴트 구역" });
    expect(list).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(TABS.length);
  });

  it("marks exactly the active tab as selected", () => {
    renderStrip({ activeId: "focus-timer" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
  });

  it("gives each tab a stable id and points aria-controls at its panel", () => {
    renderStrip();
    for (const tab of TABS) {
      const button = screen.getByRole("tab", { name: tab.label });
      expect(button.id).toBe(studioWorkbenchTabId("assistant", tab.id));
      expect(button.getAttribute("aria-controls")).toBe(
        studioWorkbenchTabPanelId("assistant", tab.id)
      );
    }
  });

  it("keeps a title attribute so truncated labels stay discoverable", () => {
    renderStrip();
    for (const tab of TABS) {
      expect(screen.getByRole("tab", { name: tab.label }).getAttribute("title")).toBe(tab.label);
    }
  });

  it("hides decorative icons from the accessibility tree", () => {
    const { container } = render(
      <StudioWorkbenchTabStrip
        tabs={TABS}
        activeId="spec-slicer"
        onSelect={vi.fn()}
        ariaLabel="어시스턴트 구역"
        idPrefix="assistant"
      />
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(TABS.length);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("scrolls horizontally instead of wrapping", () => {
    renderStrip();
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("flex-wrap");
  });

  it("carries the shared focus-ring and touch-target tokens on every tab", () => {
    renderStrip();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("focus-visible:outline-accent");
      expect(tab.className).toContain("min-h-11");
      expect(tab.className).toContain("transition-colors");
    }
  });
});

describe("StudioWorkbenchTabStrip — roving tabIndex", () => {
  it("makes only the active tab tabbable", () => {
    renderStrip({ activeId: "color-harmony" });
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"))).toEqual([
      "-1",
      "0",
      "-1",
      "-1",
    ]);
  });

  it("keeps the strip keyboard-reachable when activeId matches no tab", () => {
    renderStrip({ activeId: "retired-tab-id" });
    const indices = screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"));
    expect(indices).toEqual(["0", "-1", "-1", "-1"]);
    expect(indices.filter((value) => value === "0")).toHaveLength(1);
  });
});

describe("StudioWorkbenchTabStrip — keyboard navigation", () => {
  it("selects on click", () => {
    const { onSelect } = renderStrip();
    fireEvent.click(screen.getByRole("tab", { name: "집중 타이머" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("focus-timer");
  });

  it("ArrowRight moves focus and selection to the next tab", () => {
    const { onSelect } = renderStrip({ activeId: "spec-slicer" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "규격 검증" }), { key: "ArrowRight" });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("color-harmony");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "컬러 하모니" }));
  });

  it("ArrowLeft moves focus and selection to the previous tab", () => {
    const { onSelect } = renderStrip({ activeId: "focus-timer" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "집중 타이머" }), { key: "ArrowLeft" });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("color-harmony");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "컬러 하모니" }));
  });

  it("ArrowRight wraps from the last tab to the first", () => {
    const { onSelect } = renderStrip({ activeId: "croquis-pose" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "크로키 포즈" }), { key: "ArrowRight" });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("spec-slicer");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "규격 검증" }));
  });

  it("ArrowLeft wraps from the first tab to the last", () => {
    const { onSelect } = renderStrip({ activeId: "spec-slicer" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "규격 검증" }), { key: "ArrowLeft" });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("croquis-pose");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "크로키 포즈" }));
  });

  it("Home and End jump to the ends", () => {
    const { onSelect } = renderStrip({ activeId: "color-harmony" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "컬러 하모니" }), { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("croquis-pose");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "크로키 포즈" }));

    fireEvent.keyDown(screen.getByRole("tab", { name: "컬러 하모니" }), { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("spec-slicer");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "규격 검증" }));
  });

  it("ignores keys it does not own, leaving them to the surface", () => {
    const { onSelect } = renderStrip();
    const first = screen.getByRole("tab", { name: "규격 검증" });
    for (const key of ["ArrowUp", "ArrowDown", "Escape", "a", "Tab"]) {
      fireEvent.keyDown(first, { key });
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stops the arrow key from reaching StudioPage's global nudge handler", () => {
    const onOuterKeyDown = vi.fn();
    render(
      // StudioPage 의 전역 방향키 리스너를 흉내내는 테스트 하네스다 — 실제 상호작용 요소가 아니다.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={onOuterKeyDown}>
        <StudioWorkbenchTabStrip
          tabs={TABS}
          activeId="spec-slicer"
          onSelect={vi.fn()}
          ariaLabel="어시스턴트 구역"
          idPrefix="assistant"
        />
      </div>
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "규격 검증" }), { key: "ArrowRight" });
    expect(onOuterKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("tab", { name: "규격 검증" }), { key: "ArrowUp" });
    expect(onOuterKeyDown).toHaveBeenCalledOnce();
  });

  it("survives a single-tab strip without moving anywhere", () => {
    const onSelect = vi.fn();
    renderStrip({ tabs: [TABS[0]!], activeId: "spec-slicer", onSelect });
    fireEvent.keyDown(screen.getByRole("tab", { name: "규격 검증" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("spec-slicer");
  });

  it("renders an empty strip without crashing", () => {
    render(
      <StudioWorkbenchTabStrip
        tabs={[]}
        activeId=""
        onSelect={vi.fn()}
        ariaLabel="빈 구역"
        idPrefix="assistant"
      />
    );
    expect(screen.getByRole("tablist", { name: "빈 구역" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("studioWorkbenchTabPanelProps", () => {
  it("returns the panel side of the tab relationship", () => {
    expect(studioWorkbenchTabPanelProps("assistant", "focus-timer")).toEqual({
      role: "tabpanel",
      id: "assistant-panel-focus-timer",
      "aria-labelledby": "assistant-tab-focus-timer",
      tabIndex: 0,
    });
  });

  it("keeps prefixes distinct so two strips can coexist on one page", () => {
    expect(studioWorkbenchTabId("assistant", "x")).not.toBe(studioWorkbenchTabId("ai-suite", "x"));
    expect(studioWorkbenchTabPanelId("assistant", "x")).not.toBe(
      studioWorkbenchTabPanelId("ai-suite", "x")
    );
  });

  it("wires a real panel to its tab end-to-end", () => {
    function Harness() {
      const [active, setActive] = useState("spec-slicer");
      return (
        <>
          <StudioWorkbenchTabStrip
            tabs={TABS}
            activeId={active}
            onSelect={setActive}
            ariaLabel="어시스턴트 구역"
            idPrefix="assistant"
          />
          <section {...studioWorkbenchTabPanelProps("assistant", active)}>{active} 패널</section>
        </>
      );
    }
    render(<Harness />);

    // 패널의 접근성 이름은 연결된 탭의 라벨에서 온다.
    expect(screen.getByRole("tabpanel", { name: "규격 검증" }).textContent).toBe(
      "spec-slicer 패널"
    );

    fireEvent.click(screen.getByRole("tab", { name: "크로키 포즈" }));
    expect(screen.getByRole("tabpanel", { name: "크로키 포즈" }).textContent).toBe(
      "croquis-pose 패널"
    );
  });
});
