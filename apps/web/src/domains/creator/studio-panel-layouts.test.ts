import { describe, expect, it } from "vitest";

import { CANVAS_W } from "./studio-assets";
import { materializePanelLayout, PANEL_LAYOUTS } from "./studio-panel-layouts";

describe("컷(패널) 레이아웃 템플릿 스키마", () => {
  it("provides at least 12 presets with unique ids", () => {
    expect(PANEL_LAYOUTS.length).toBeGreaterThanOrEqual(12);
    const ids = PANEL_LAYOUTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every preset in Korean with a hint", () => {
    for (const layout of PANEL_LAYOUTS) {
      expect(layout.label.trim().length).toBeGreaterThan(0);
      expect(layout.hint.trim().length).toBeGreaterThan(0);
      expect(layout.frames.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every frame inside the canvas bounds with usable size", () => {
    for (const layout of PANEL_LAYOUTS) {
      expect(layout.canvasH).toBeGreaterThanOrEqual(400);
      for (const frame of layout.frames) {
        expect(frame.x, `${layout.id} frame x`).toBeGreaterThanOrEqual(0);
        expect(frame.y, `${layout.id} frame y`).toBeGreaterThanOrEqual(0);
        expect(frame.width).toBeGreaterThanOrEqual(40);
        expect(frame.height).toBeGreaterThanOrEqual(40);
        expect(frame.x + frame.width, `${layout.id} frame right edge`).toBeLessThanOrEqual(CANVAS_W + 0.5);
        expect(frame.y + frame.height, `${layout.id} frame bottom edge`).toBeLessThanOrEqual(layout.canvasH + 0.5);
      }
    }
  });

  it("avoids overlapping frames (패널끼리 겹치지 않음)", () => {
    for (const layout of PANEL_LAYOUTS) {
      for (let i = 0; i < layout.frames.length; i++) {
        for (let j = i + 1; j < layout.frames.length; j++) {
          const a = layout.frames[i]!;
          const b = layout.frames[j]!;
          const overlaps =
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlaps, `${layout.id} frames ${i}/${j} overlap`).toBe(false);
        }
      }
    }
  });

  it("places bubble seeds inside one of the layout frames", () => {
    for (const layout of PANEL_LAYOUTS) {
      for (const bubble of layout.bubbles ?? []) {
        expect(["speech", "box"]).toContain(bubble.variant);
        expect(bubble.text.trim().length).toBeGreaterThan(0);
        const inside = layout.frames.some(
          (f) =>
            bubble.x >= f.x &&
            bubble.y >= f.y &&
            bubble.x + bubble.width <= f.x + f.width &&
            bubble.y + bubble.height <= f.y + f.height
        );
        expect(inside, `${layout.id} bubble inside a frame`).toBe(true);
      }
    }
  });

  it("materializePanelLayout returns frame and bubble seeds for talk layout", () => {
    const layout = PANEL_LAYOUTS.find((item) => item.id === "layout_talk_2_bubbles");
    expect(layout).toBeTruthy();
    const { canvasH, seeds } = materializePanelLayout(layout!);
    expect(canvasH).toBe(layout!.canvasH);
    expect(seeds.filter((s) => s.type === "frame").length).toBe(layout!.frames.length);
    expect(seeds.filter((s) => s.type === "bubble").length).toBe((layout!.bubbles ?? []).length);
  });

  it("covers the comic staples: 1컷·인스타툰 3단·4컷·지그재그·말풍선 틀", () => {
    const ids = PANEL_LAYOUTS.map((l) => l.id);
    for (const required of [
      "layout_single_hero",
      "layout_insta_3",
      "layout_yonkoma_titled",
      "layout_zigzag_5",
      "layout_spread_2",
      "layout_talk_2_bubbles",
    ]) {
      expect(ids).toContain(required);
    }
  });
});
