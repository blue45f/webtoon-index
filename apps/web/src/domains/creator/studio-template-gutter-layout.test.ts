import { describe, expect, it } from "vitest";

import { CANVAS_W, TEMPLATES, type FrameSpec } from "./studio-assets";
import {
  regenerateStudioTemplateFrames,
  resolveStudioTemplateGutterCapability,
  type StudioTemplateGutterTopology,
} from "./studio-template-gutter-layout";

const EXPECTED_TOPOLOGIES: Readonly<Record<string, StudioTemplateGutterTopology>> = {
  webtoon2: { kind: "stack", count: 2 },
  webtoon3: { kind: "stack", count: 3 },
  webtoon4: { kind: "stack", count: 4 },
  webtoon5: { kind: "stack", count: 5 },
  webtoon6: { kind: "stack", count: 6 },
  webtoon7: { kind: "stack", count: 7 },
  webtoon8: { kind: "stack", count: 8 },
  webtoon10: { kind: "stack", count: 10 },
  strip4: { kind: "stack", count: 4 },
  single: { kind: "stack", count: 1 },
  grid4: { kind: "grid", columns: 2, rows: 2 },
  grid6: { kind: "grid", columns: 2, rows: 3 },
  grid8: { kind: "grid", columns: 2, rows: 4 },
  grid9: { kind: "grid", columns: 3, rows: 3 },
  grid12: { kind: "grid", columns: 3, rows: 4 },
  storyboard3: { kind: "columns", count: 3 },
  storyboard6: { kind: "grid", columns: 3, rows: 2 },
  "webtoon-character-sheet": { kind: "grid", columns: 2, rows: 2 },
  "cover-square": { kind: "inset" },
  "cover-instagram": { kind: "inset" },
  "cover-poster": { kind: "inset" },
  "cover-story": { kind: "inset" },
};

const EXPLICITLY_UNSUPPORTED_TEMPLATE_IDS = new Set([
  "dynamic-hero-top",
  "dynamic-hero-left",
  "dynamic-hero-right",
  "dynamic-manga-five",
  "dynamic-dialogue",
  "dynamic-action-zoom",
  "dynamic-cinematic-banner",
]);

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function expectFiniteInBounds(frames: readonly FrameSpec[], canvasH: number): void {
  for (const frame of frames) {
    expect([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)).toBe(true);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(CANVAS_W);
    expect(frame.y + frame.height).toBeLessThanOrEqual(canvasH);
  }
}

function expectTopology(
  frames: readonly FrameSpec[],
  topology: StudioTemplateGutterTopology,
  gutter: number,
  canvasH: number,
): void {
  const xs = sortedUnique(frames.map((frame) => frame.x));
  const ys = sortedUnique(frames.map((frame) => frame.y));
  const widths = sortedUnique(frames.map((frame) => frame.width));
  const heights = sortedUnique(frames.map((frame) => frame.height));

  switch (topology.kind) {
    case "stack":
      expect(xs).toHaveLength(1);
      expect(ys).toHaveLength(topology.count);
      expect(widths).toHaveLength(1);
      expect(heights).toHaveLength(1);
      expect(xs[0]).toBeCloseTo(gutter);
      expect(CANVAS_W - (xs[0]! + widths[0]!)).toBeCloseTo(gutter);
      expect(ys[0]).toBeCloseTo(gutter);
      expect(canvasH - (ys.at(-1)! + heights[0]!)).toBeCloseTo(gutter);
      ys.slice(1).forEach((y, index) => {
        expect(y - ys[index]! - heights[0]!).toBeCloseTo(gutter);
      });
      break;
    case "columns":
      expect(xs).toHaveLength(topology.count);
      expect(ys).toHaveLength(1);
      expect(widths).toHaveLength(1);
      expect(heights).toHaveLength(1);
      expect(xs[0]).toBeCloseTo(gutter);
      expect(CANVAS_W - (xs.at(-1)! + widths[0]!)).toBeCloseTo(gutter);
      expect(ys[0]).toBeCloseTo(gutter);
      expect(canvasH - (ys[0]! + heights[0]!)).toBeCloseTo(gutter);
      xs.slice(1).forEach((x, index) => {
        expect(x - xs[index]! - widths[0]!).toBeCloseTo(gutter);
      });
      break;
    case "grid":
      expect(xs).toHaveLength(topology.columns);
      expect(ys).toHaveLength(topology.rows);
      expect(widths).toHaveLength(1);
      expect(heights).toHaveLength(1);
      expect(xs[0]).toBeCloseTo(gutter);
      expect(ys[0]).toBeCloseTo(gutter);
      expect(CANVAS_W - (xs.at(-1)! + widths[0]!)).toBeCloseTo(gutter);
      expect(canvasH - (ys.at(-1)! + heights[0]!)).toBeCloseTo(gutter);
      expect(new Set(frames.map((frame) => `${frame.x}:${frame.y}`)).size).toBe(
        topology.columns * topology.rows,
      );
      xs.slice(1).forEach((x, index) => {
        expect(x - xs[index]! - widths[0]!).toBeCloseTo(gutter);
      });
      ys.slice(1).forEach((y, index) => {
        expect(y - ys[index]! - heights[0]!).toBeCloseTo(gutter);
      });
      break;
    case "inset":
      expect(frames).toHaveLength(1);
      expect(frames[0]?.x).toBeCloseTo(gutter);
      expect(frames[0]?.y).toBeCloseTo(gutter);
      expect(CANVAS_W - (frames[0]!.x + frames[0]!.width)).toBeCloseTo(gutter);
      expect(canvasH - (frames[0]!.y + frames[0]!.height)).toBeCloseTo(gutter);
      break;
  }
}

describe("studio template gutter layout", () => {
  it.each(TEMPLATES)(
    "$id 템플릿을 명시적으로 지원하거나 원본을 보존하며 fail-closed한다",
    (template) => {
      const authoredFrames = template.frames.map((frame) => ({ ...frame }));
      const expectedTopology = EXPECTED_TOPOLOGIES[template.id];
      const capability = resolveStudioTemplateGutterCapability(template);
      expectFiniteInBounds(template.frames, template.canvasH);

      if (!expectedTopology) {
        expect(
          template.id === "blank" || EXPLICITLY_UNSUPPORTED_TEMPLATE_IDS.has(template.id),
          `catalog template ${template.id} needs an explicit gutter capability decision`,
        ).toBe(true);
        expect(capability).toEqual({
          supported: false,
          reason: template.id === "blank" ? "no-panels" : "unsupported-topology",
        });
        expect(regenerateStudioTemplateFrames(template, 24)).toBeNull();
        expect(template.frames).toEqual(authoredFrames);
        return;
      }

      expect(capability).toEqual({ supported: true, topology: expectedTopology });
      for (const gutter of [8, 24, 48]) {
        const frames = regenerateStudioTemplateFrames(template, gutter);
        expect(frames).not.toBeNull();
        expect(frames).toHaveLength(template.frames.length);
        expectFiniteInBounds(frames!, template.canvasH);
        expectTopology(frames!, expectedTopology, gutter, template.canvasH);
      }
      expect(template.frames).toEqual(authoredFrames);
    },
  );

  it("새 ID, 변경된 원본 topology와 유효하지 않은 gutter를 추측하지 않는다", () => {
    const grid4 = TEMPLATES.find((template) => template.id === "grid4")!;

    expect(resolveStudioTemplateGutterCapability(null)).toEqual({
      supported: false,
      reason: "no-template",
    });
    expect(resolveStudioTemplateGutterCapability({ ...grid4, id: "new-grid4" })).toEqual({
      supported: false,
      reason: "unsupported-topology",
    });
    expect(
      resolveStudioTemplateGutterCapability({
        ...grid4,
        frames: grid4.frames.map((frame, index) =>
          index === 0 ? { ...frame, x: frame.x + 1 } : frame,
        ),
      }),
    ).toEqual({ supported: false, reason: "unsupported-topology" });

    for (const gutter of [Number.NaN, Number.POSITIVE_INFINITY, 7, 49]) {
      expect(regenerateStudioTemplateFrames(grid4, gutter)).toBeNull();
    }
  });
});
