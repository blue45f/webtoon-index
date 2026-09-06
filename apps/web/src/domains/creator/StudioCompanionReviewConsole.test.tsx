// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioCompanionReviewProjection } from "./studio-companion-review-projection";
import { StudioCompanionReviewConsole } from "./StudioCompanionReviewConsole";

import { useI18n } from "@/shared/lib/i18n";

afterEach(cleanup);

beforeEach(() => {
  useI18n.getState().setLang("ko");
});

const projection = createStudioCompanionReviewProjection({
  revision: 1,
  documentRevision: 2,
  pageLabel: "1화",
  selectionLabel: "선화",
  canUndo: true,
  canRedo: true,
  captureAllowed: true,
  viewport: { x: 0, y: 0, width: 1, height: 0.5 },
  layers: [{ id: "layer-1", label: "주인공 선화", type: "draw", selected: true }],
  historyLength: 3,
  historyIndex: 2,
  comments: [{ id: "thread-1", author: "편집자", body: "표정을 조금 더 선명하게", unread: true }],
  brush: {
    id: "pen",
    label: "펜",
    size: 6,
    opacity: 1,
    color: "#112233",
    choices: [{ id: "pencil", label: "연필" }],
  },
});

function renderConsole(overrides: Partial<React.ComponentProps<typeof StudioCompanionReviewConsole>> = {}) {
  const props = {
    projection,
    connected: true,
    presentationSafe: false,
    onSelectLayer: vi.fn(),
    onHistory: vi.fn(),
    onCommentFocus: vi.fn(),
    onBrushPatch: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<StudioCompanionReviewConsole {...props} />) };
}

describe("StudioCompanionReviewConsole", () => {
  it("sends primary-owned selection, history, comment, and coalescible brush intents", () => {
    const { props } = renderConsole();
    fireEvent.click(screen.getByRole("button", { name: /주인공 선화/u }));
    expect(props.onSelectLayer).toHaveBeenCalledWith("layer-1");

    fireEvent.change(screen.getByRole("combobox", { name: "원격 브러시" }), { target: { value: "pencil" } });
    fireEvent.change(screen.getByRole("slider", { name: "원격 브러시 크기" }), { target: { value: "18" } });
    expect(props.onBrushPatch).toHaveBeenNthCalledWith(1, { id: "pencil" });
    expect(props.onBrushPatch).toHaveBeenNthCalledWith(2, { size: 18 });

    fireEvent.click(screen.getByRole("tab", { name: /기록/u }));
    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(props.onHistory).toHaveBeenCalledWith("undo");

    fireEvent.click(screen.getByRole("tab", { name: /댓글/u }));
    fireEvent.click(screen.getByRole("button", { name: /편집자/u }));
    expect(props.onCommentFocus).toHaveBeenCalledWith("thread-1");
  });

  it("keeps all primary controls disabled and comment text hidden in presentation-safe mode", () => {
    renderConsole({ presentationSafe: true });
    expect(screen.getByRole("status").textContent).toContain("발표 안전 모드");
    expect(screen.queryByRole("combobox", { name: "원격 브러시" })).toBeNull();
    expect(screen.queryByText("주인공 선화")).toBeNull();
    expect(screen.queryByText("1화")).toBeNull();
    expect((screen.getByRole("button", { name: /레이어 1/u }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: /댓글/u }));
    expect(screen.queryByText("표정을 조금 더 선명하게")).toBeNull();
    expect(screen.getByText("검수 의견 열림")).toBeTruthy();
  });

  it("uses at least 44px targets for tabs and controls", () => {
    renderConsole();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("min-h-11");
    }
    const layerTab = screen.getByRole("tab", { name: /레이어/u });
    fireEvent.keyDown(layerTab, { key: "End" });
    expect(screen.getByRole("tab", { name: /댓글/u }).getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("companion-review-panel-layers")?.hidden).toBe(true);
    expect(document.getElementById("companion-review-panel-comments")?.hidden).toBe(false);
  });

  it("fills the available height in a dedicated review window", () => {
    renderConsole({ layout: "dedicated" });

    const layersPanel = document.getElementById("companion-review-panel-layers");
    expect(layersPanel?.className).toContain("flex-1");
    expect(layersPanel?.className).not.toContain("max-h-72");
    expect(screen.getByRole("tab", { name: /레이어/u }).className).toContain("min-h-11");
  });
});
