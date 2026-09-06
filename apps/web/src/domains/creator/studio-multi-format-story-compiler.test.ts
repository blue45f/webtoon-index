import { describe, expect, it } from "vitest";

import {
  compileStoryDocument,
  type CompilerSourcePanel,
} from "./studio-multi-format-story-compiler";

describe("Studio Multi-format Story Compiler", () => {
  function makePanels(count: number): CompilerSourcePanel[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `panel_${i + 1}`,
      sequenceIndex: i,
      originalWidth: 800,
      originalHeight: 1200,
      importanceWeight: 0.5,
    }));
  }

  it("compiles vertical webtoon format with vertical stack slices", () => {
    const panels = makePanels(10);
    const doc = compileStoryDocument(panels, "vertical-webtoon");

    expect(doc.format).toBe("vertical-webtoon");
    // max 6 panels per slice -> 10 panels = 2 slices (6 + 4)
    expect(doc.totalPagesOrSlices).toBe(2);
    expect(doc.pages[0].elements).toHaveLength(6);
    expect(doc.pages[1].elements).toHaveLength(4);
    expect(doc.pages[0].width).toBe(800);
  });

  it("compiles page comic format with grid pagination", () => {
    const panels = makePanels(8);
    const doc = compileStoryDocument(panels, "page-comic");

    expect(doc.format).toBe("page-comic");
    expect(doc.totalPagesOrSlices).toBe(2); // 6 + 2
    expect(doc.pages[0].elements).toHaveLength(6);
    expect(doc.pages[0].width).toBe(1200);
    expect(doc.pages[0].height).toBe(1700);
  });

  it("handles splash page with dedicated full-page assignment", () => {
    const panels: CompilerSourcePanel[] = [
      { id: "p1", sequenceIndex: 0, originalWidth: 800, originalHeight: 1000, importanceWeight: 0.5 },
      { id: "splash_p2", sequenceIndex: 1, originalWidth: 1200, originalHeight: 1800, importanceWeight: 1.0, isSplashPage: true },
      { id: "p3", sequenceIndex: 2, originalWidth: 800, originalHeight: 1000, importanceWeight: 0.5 },
    ];

    const doc = compileStoryDocument(panels, "page-comic");
    // p1 on page 0, splash_p2 on page 1, p3 on page 2
    expect(doc.totalPagesOrSlices).toBe(3);
    expect(doc.pages[1].elements).toHaveLength(1);
    expect(doc.pages[1].elements[0].panelId).toBe("splash_p2");
  });

  it("compiles 4-panel yonkoma and social slides", () => {
    const panels = makePanels(4);
    const fourPanelDoc = compileStoryDocument(panels, "four-panel");
    expect(fourPanelDoc.totalPagesOrSlices).toBe(1);
    expect(fourPanelDoc.pages[0].elements).toHaveLength(4);

    const socialDoc = compileStoryDocument(panels, "social-slide");
    // max 2 per slide -> 4 panels = 2 slides
    expect(socialDoc.totalPagesOrSlices).toBe(2);
  });
});
