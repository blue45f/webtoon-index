// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  STUDIO_SUB_TOOL_PALETTE_CATEGORIES,
  type StudioSubToolPaletteCategory,
} from "./studio-sub-tool-palette-data";
import { StudioSubToolPalette } from "./StudioSubToolPalette";

/** Injected fixture keeping the original keyboard/a11y contract deterministic. */
const FIXTURE_CATEGORIES: readonly StudioSubToolPaletteCategory[] = [
  {
    id: "pen",
    label: "펜",
    drawMode: "pen",
    tools: [
      { id: "gpen", name: "G펜(필압)", shortcut: "B" },
      { id: "maru-pen", name: "마루펜" },
      { id: "calligraphy", name: "캘리그래피" },
    ],
  },
  {
    id: "eraser",
    label: "지우개",
    drawMode: "eraser",
    tools: [{ id: "standard-eraser", name: "표준 지우개" }],
  },
];

describe('StudioSubToolPalette', () => {
  const onSelectSubToolMock = vi.fn();
  const onCategoryChangeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders correctly with active category', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('G펜(필압)')).toBeTruthy();
    expect(screen.getByText('마루펜')).toBeTruthy();
  });

  it('calls onCategoryChange when a tab is clicked', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        onCategoryChange={onCategoryChangeMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]); // eraser
    expect(onCategoryChangeMock).toHaveBeenCalledWith('eraser');
  });

  it('calls onSelectSubTool when an option is clicked', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    fireEvent.click(screen.getByText('마루펜'));
    expect(onSelectSubToolMock).toHaveBeenCalledWith('maru-pen');
  });

  it('supports keyboard navigation (ArrowDown, ArrowUp, Enter)', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    const options = screen.getAllByRole('option');
    const firstOption = options[0];

    firstOption.focus();
    expect(firstOption).toEqual(document.activeElement);

    // Move down
    fireEvent.keyDown(firstOption, { key: 'ArrowDown' });
    expect(options[1]).toEqual(document.activeElement);

    // Move up
    fireEvent.keyDown(options[1], { key: 'ArrowUp' });
    expect(options[0]).toEqual(document.activeElement);

    // Select with Enter
    fireEvent.keyDown(options[0], { key: 'Enter' });
    expect(onSelectSubToolMock).toHaveBeenCalledWith('gpen');
  });

  it('sets aria-selected correctly', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="maru-pen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    const gPen = screen.getByText('G펜(필압)').closest('[role="option"]');
    const maruPen = screen.getByText('마루펜').closest('[role="option"]');

    expect(gPen?.getAttribute('aria-selected')).toBe('false');
    expect(maruPen?.getAttribute('aria-selected')).toBe('true');
  });

  it('renders the real shortcut badge when the data provides one', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    expect(screen.getByText('B')).toBeTruthy();
  });

  it('defaults to the real core-catalogue mapping when no categories are injected', () => {
    render(
      <StudioSubToolPalette
        activeCategory="pen"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
      />
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(STUDIO_SUB_TOOL_PALETTE_CATEGORIES.length);

    const penCategory = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.find(
      (category) => category.id === 'pen',
    );
    expect(penCategory).toBeTruthy();
    for (const tool of penCategory!.tools) {
      expect(screen.getByText(tool.name)).toBeTruthy();
    }

    fireEvent.click(screen.getByText(penCategory!.tools[1]!.name));
    expect(onSelectSubToolMock).toHaveBeenCalledWith(penCategory!.tools[1]!.id);
  });

  it('shows the empty state for a category id outside the data', () => {
    render(
      <StudioSubToolPalette
        activeCategory="not-a-category"
        activeSubToolId="gpen"
        onSelectSubTool={onSelectSubToolMock}
        categories={FIXTURE_CATEGORIES}
      />
    );

    expect(screen.getByText('도구가 없습니다.')).toBeTruthy();
  });
});
