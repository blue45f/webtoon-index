import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  StudioPageSequenceStrip,
  type StudioPageSequenceStripProps,
} from "./StudioPageSequenceStrip";

const source = readFileSync(new URL("./StudioPageSequenceStrip.tsx", import.meta.url), "utf8");

const PAGES = [
  { id: "page-1", label: "도입", thumbnailUrl: "data:image/png;base64,AA==" },
  { id: "page-2", label: "아주 긴 장면 이름도 좁은 필름스트립 안에서 안전하게 줄바꿈됩니다" },
] as const;

function renderStrip(overrides: Partial<StudioPageSequenceStripProps> = {}): string {
  return renderToStaticMarkup(
    <StudioPageSequenceStrip
      open
      pages={PAGES}
      currentPageId="page-2"
      onSelectPage={vi.fn()}
      onAddPage={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe("StudioPageSequenceStrip", () => {
  it("renders nothing while closed", () => {
    expect(renderStrip({ open: false })).toBe("");
  });

  it("renders a navigation-first horizontal filmstrip with one current page", () => {
    const html = renderStrip();

    expect(html).toContain('aria-label="페이지 시퀀스"');
    expect(html).toContain('data-studio-page-sequence-strip="true"');
    expect(html).toContain('data-studio-page-sequence-scroller="true"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("overscroll-x-contain");
    expect(html).toContain("min-w-0");
    expect(html).toContain("lg:flex");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("2번 페이지, 아주 긴 장면 이름도 좁은 필름스트립 안에서 안전하게 줄바꿈됩니다, 현재 페이지");
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("keeps page, add, and close controls touch-sized and keyboard-visible", () => {
    const html = renderStrip();

    expect(html).toContain('data-studio-page-sequence-add="true"');
    expect(html).toContain('aria-label="새 페이지 추가"');
    expect(html).toContain('data-studio-page-sequence-close="true"');
    expect(html).toContain('aria-label="페이지 시퀀스 닫기"');
    expect(html.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(html.match(/min-w-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(html).toContain("focus-visible:outline-accent");
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("uses a decorative lazy thumbnail and leaves a safe placeholder when no image exists", () => {
    const html = renderStrip();

    expect(html).toContain('src="data:image/png;base64,AA=="');
    expect(html).toContain('alt=""');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html.match(/data-studio-sequence-thumbnail-placeholder="true"/g)).toHaveLength(2);
  });

  it("supports an empty read-only sequence without inventing management actions", () => {
    const html = renderStrip({ pages: [], currentPageId: "", onAddPage: undefined });

    expect(html).toContain('role="status"');
    expect(html).toContain("페이지가 아직 없어요.");
    expect(html).not.toContain('data-studio-page-sequence-add="true"');
    expect(html).not.toContain("페이지 복제");
    expect(html).not.toContain("페이지 삭제");
  });

  it("reveals the current item with nearest, non-animated scrolling", () => {
    expect(source).toContain("pageRefs.current.get(currentPageId)");
    expect(source).toContain('behavior: "auto"');
    expect(source).toContain('block: "nearest"');
    expect(source).toContain('inline: "nearest"');
    expect(source).not.toContain('behavior: "smooth"');
  });
});
