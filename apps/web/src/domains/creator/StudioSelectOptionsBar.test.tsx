import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioSelectOptionsBar } from "./StudioSelectOptionsBar";

describe("StudioSelectOptionsBar", () => {
  it("renders a commercial selection badge and action cluster", () => {
    const html = renderToStaticMarkup(
      <StudioSelectOptionsBar
        selectionLabel="레이어 1"
        selectionCount={1}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onBringFront={vi.fn()}
        onSendBack={vi.fn()}
        onToggleLock={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-select-options="true"');
    expect(html).toContain('data-studio-icon-first="true"');
    expect(html).toContain('data-studio-selection-badge="true"');
    expect(html).toContain("레이어 1");
    // Icon-first actions — names live in aria-label
    expect(html).toContain('aria-label="복제"');
    expect(html).toContain('aria-label="맨 앞"');
    expect(html).toContain('aria-label="삭제"');
    expect(html).toContain("studio-opt-cluster");
    expect(html.match(/data-studio-tool-hint-target="true"/g)).toHaveLength(5);
    expect(html).toContain("size-11");
    expect(html).toContain("sm:size-8");
    expect(html).not.toContain('title="복제"');
  });

  it("shows multi-select count badge without long Korean label chrome", () => {
    const html = renderToStaticMarkup(
      <StudioSelectOptionsBar
        selectionLabel={null}
        selectionCount={3}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onBringFront={vi.fn()}
        onSendBack={vi.fn()}
      />
    );
    expect(html).toContain("3개 선택"); // sr-only
    expect(html).toContain(">3<");
  });

  it("surfaces one-click lettering actions only when the selection supports them", () => {
    const onEditText = vi.fn();
    const onFitBubble = vi.fn();
    const html = renderToStaticMarkup(
      <StudioSelectOptionsBar
        selectionLabel="대사 말풍선"
        selectionCount={1}
        textEditLabel="대사 편집"
        onEditText={onEditText}
        onFitBubble={onFitBubble}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onBringFront={vi.fn()}
        onSendBack={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="대사 편집"');
    expect(html).toContain('aria-label="텍스트 맞춤"');
    expect(html).toContain(">대사 편집<");
  });
});
