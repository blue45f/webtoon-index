import { describe, expect, it } from "vitest";

import {
  createStudioStickyNoteElement,
  studioStickyNoteGridLayout,
  STUDIO_STICKY_NOTE_PRESETS,
} from "./studio-sticky-note";

describe("studio-sticky-note", () => {
  it("creates a sticky text card with preset colors", () => {
    const note = createStudioStickyNoteElement({
      x: 40,
      y: 60,
      text: "컷 구성",
      presetId: "mint",
    });
    expect(note.type).toBe("text");
    expect(note.text).toBe("컷 구성");
    expect(note.stickyNotePresetId).toBe("mint");
    expect(note.stickyNoteFill).toBe("#bbf7d0");
    expect(STUDIO_STICKY_NOTE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("lays out a Miro-style sticky grid", () => {
    const points = studioStickyNoteGridLayout(5, 0, 0, 2, 10, 100, 80);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: 110, y: 0 });
    expect(points[2]).toEqual({ x: 0, y: 90 });
  });
});
