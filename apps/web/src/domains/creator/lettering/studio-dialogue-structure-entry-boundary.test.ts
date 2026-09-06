import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";


const studioCanvasViewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");

describe("Studio dialogue structure entry boundary", () => {
  it("connects split, merge, move, copy, text→bubble, multi-format, and ruby to the shipped story panel", () => {
    expect(studioCanvasViewportSource).toContain("splitDialogueElement(pages");
    expect(studioCanvasViewportSource).toContain("mergeDialogueWithNext(pages");
    expect(studioCanvasViewportSource).toContain("transferDialogueElement(pages");
    expect(studioCanvasViewportSource).toContain("convertTextElementsToBubbles(pages");
    expect(studioCanvasViewportSource).toContain("applyDialogueFormatPatch(pages");
    expect(studioCanvasViewportSource).toContain("applyDialogueRubySpan(pages");
    expect(studioCanvasViewportSource).toContain("clearDialogueRubyRange(pages");
    expect(studioCanvasViewportSource).toContain("onSplitText={splitDialogueText}");
    expect(studioCanvasViewportSource).toContain("onMergeWithNext={mergeDialogueTextWithNext}");
    expect(studioCanvasViewportSource).toContain("onTransferElement={transferDialogueText}");
    expect(studioCanvasViewportSource).toContain("onConvertTextToBubble={convertDialogueTextToBubble}");
    expect(studioCanvasViewportSource).toContain(
      "onConvertTextsToBubbles={convertDialogueTextsToBubbles}",
    );
    expect(studioCanvasViewportSource).toContain("onApplyFormat={applyDialogueMultiFormat}");
    expect(studioCanvasViewportSource).toContain("onApplyDialogueRuby={applyDialogueRuby}");
    expect(studioCanvasViewportSource).toContain("onClearDialogueRuby={clearDialogueRuby}");
    expect(studioCanvasViewportSource).toContain(
      "selectedIds={marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : []}"
    );
  });

  it("selects the resulting dialogue and target page after a structural commit", () => {
    expect(studioCanvasViewportSource).toContain("setSelectedId(newElementId);");
    expect(studioCanvasViewportSource).toContain("setCurrentPageId(targetPageId);");
    expect(studioCanvasViewportSource).toContain("setSelectedId(nextElementId);");
  });
});
