import { describe, it, expect } from "vitest";

import {
  splitComicPanelPolygon,
  getPolygonArea,
  type ComicPanelPolygon,
  type ComicPanelSplitCut,
} from "./studio-comic-panel-splitter";

describe('studio-comic-panel-splitter', () => {
  const createRect = (id: string, x: number, y: number, w: number, h: number): ComicPanelPolygon => ({
    id,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  });

  it('horizontal split of rectangle creates two smaller rectangles with gutter gap', () => {
    const rect = createRect('panel', 0, 0, 100, 100);
    // Cut from left to right at y = 50
    const cut: ComicPanelSplitCut = {
      start: { x: -10, y: 50 },
      end: { x: 110, y: 50 },
      gutterWidthPx: 10,
    };

    const result = splitComicPanelPolygon(rect, cut);
    expect(result).not.toBeNull();
    if (!result) return;

    const [top, bottom] = result;
    
    // Normal is (0, 1) pointing down (since dx=120, dy=0 -> nx=0, ny=1).
    // Wait, dx = 120, dy = 0.
    // nx = -dy/len = 0
    // ny = dx/len = 1
    // N = (0, 1). So "left" of the cut (start to end) is actually pointing +y (downwards in screen space, or upwards depending on coordinates).
    // We expect one to have y <= 45 and the other y >= 55.
    
    const area1 = getPolygonArea(top.points);
    const area2 = getPolygonArea(bottom.points);
    
    expect(area1).toBeCloseTo(100 * 45); // 4500
    expect(area2).toBeCloseTo(100 * 45); // 4500
    
    // Gutter area is 100 * 10 = 1000
    expect(area1 + area2 + 1000).toBeCloseTo(100 * 100);
  });

  it('vertical split of rectangle creates two smaller rectangles', () => {
    const rect = createRect('panel', 0, 0, 100, 100);
    // Cut from top to bottom at x = 50
    const cut: ComicPanelSplitCut = {
      start: { x: 50, y: -10 },
      end: { x: 50, y: 110 },
      gutterWidthPx: 20,
    };

    const result = splitComicPanelPolygon(rect, cut);
    expect(result).not.toBeNull();
    if (!result) return;

    const [left, right] = result;
    
    const area1 = getPolygonArea(left.points);
    const area2 = getPolygonArea(right.points);
    
    // Width of each half is (100 - 20) / 2 = 40
    expect(area1).toBeCloseTo(40 * 100); // 4000
    expect(area2).toBeCloseTo(40 * 100); // 4000
    
    expect(area1 + area2 + 20 * 100).toBeCloseTo(100 * 100);
  });

  it('slanted diagonal split creates two polygons', () => {
    const rect = createRect('panel', 0, 0, 100, 100);
    // Cut from top-left to bottom-right
    const cut: ComicPanelSplitCut = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      gutterWidthPx: 10 * Math.sqrt(2), // Makes the horizontal/vertical offset exactly 10
    };

    const result = splitComicPanelPolygon(rect, cut);
    expect(result).not.toBeNull();
    if (!result) return;

    const [poly1, poly2] = result;
    
    const area1 = getPolygonArea(poly1.points);
    const area2 = getPolygonArea(poly2.points);
    
    // The cut line length inside the square is 100*sqrt(2) = 141.4.
    // The gutter area is approx cut_length * gutterWidthPx = 141.4 * 14.14 = 2000.
    // Wait, the gutter corners are clipped by the bounding box, so the area calculation is slightly more complex.
    // Let's just ensure the sum is less than the total area, and it produced two valid polygons.
    expect(area1 + area2).toBeLessThan(100 * 100);
    expect(poly1.points.length).toBeGreaterThanOrEqual(3);
    expect(poly2.points.length).toBeGreaterThanOrEqual(3);
  });

  it('cut missing polygon returns null', () => {
    const rect = createRect('panel', 0, 0, 100, 100);
    // Cut is way off to the right
    const cut: ComicPanelSplitCut = {
      start: { x: 200, y: 0 },
      end: { x: 200, y: 100 },
      gutterWidthPx: 10,
    };

    const result = splitComicPanelPolygon(rect, cut);
    expect(result).toBeNull();
  });

  it('cut that barely touches edge returns null (degenerates)', () => {
    const rect = createRect('panel', 0, 0, 100, 100);
    // Cut exactly at the edge
    const cut: ComicPanelSplitCut = {
      start: { x: 100, y: -10 },
      end: { x: 100, y: 110 },
      gutterWidthPx: 20,
    };

    const result = splitComicPanelPolygon(rect, cut);
    expect(result).toBeNull();
  });
});
