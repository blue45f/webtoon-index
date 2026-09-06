// @vitest-environment jsdom

/**
 * Regression coverage for the draw(선화) selection indicator.
 *
 * Draw elements never register a Konva node ref, so StudioPage's Transformer effect resolves
 * them to `null` and attaches nothing — selecting a stroke used to show no selection chrome at
 * all. These tests pin the dedicated overlay's measurement (full point scan, symmetry union,
 * ink-radius padding) and its zoom-compensated dashed-box rendering.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  drawSelectionIndicatorBox,
  StudioDrawSelectionOverlay,
} from "../StudioSelectionOverlays";

import { studioLiveBrushEffectiveDiameter } from "./studio-draw-rendering";

import type { DrawEl } from "../studio-element-model";

interface CapturedKonvaNode {
  kind: string;
  props: Record<string, unknown>;
}

const konvaCapture = vi.hoisted(() => ({
  nodes: [] as CapturedKonvaNode[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement } = await import("react");
  const capture = (kind: string, renderChildren = false) =>
    (props: Record<string, unknown>) => {
      konvaCapture.nodes.push({ kind, props });
      return renderChildren
        ? createElement(Fragment, null, props.children as import("react").ReactNode)
        : null;
    };

  return {
    Circle: capture("Circle"),
    Group: capture("Group", true),
    Image: capture("Image"),
    Line: capture("Line"),
    Rect: capture("Rect"),
  };
});

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    points: [0, 0, 10, 0],
    stroke: "#123456",
    strokeWidth: 4,
    ...overrides,
  };
}

function captured(kind: string): CapturedKonvaNode[] {
  return konvaCapture.nodes.filter((node) => node.kind === kind);
}

beforeEach(() => {
  konvaCapture.nodes.length = 0;
});

afterEach(cleanup);

describe("drawSelectionIndicatorBox", () => {
  it("scans every point of a freehand stroke, not just the first segment", () => {
    // Eraser mode keeps the effective ink diameter identical to strokeWidth (no alias scaling),
    // so the expected numbers stay exact.
    const el = drawEl({
      mode: "eraser",
      points: [0, 0, 10, 0, 5, 20, -6, 4],
      strokeWidth: 4,
    });
    const box = drawSelectionIndicatorBox(el, { scale: 1, screenPaddingPx: 0 });

    // ink radius pad = 4 / 2 = 2 around the true min/max (-6..10, 0..20).
    expect(box).toEqual({ x: -8, y: -2, width: 20, height: 24 });
  });

  it("unions all symmetry copies so mirrored ink is inside the indicator", () => {
    const el = drawEl({
      mode: "eraser",
      points: [2, 3, 8, 11],
      strokeWidth: 2,
      symmetry: { type: "vertical", centerX: 10, centerY: 0 },
    });
    const box = drawSelectionIndicatorBox(el, { scale: 1, screenPaddingPx: 0 });

    // Source spans x 2..8; the vertical mirror around x=10 spans 12..18. Pad = 1.
    expect(box).toEqual({ x: 1, y: 2, width: 18, height: 10 });
  });

  it("pads by the brush's effective ink radius, wider than strokeWidth for alias brushes", () => {
    const plain = drawSelectionIndicatorBox(
      drawEl({ mode: "eraser", strokeWidth: 10 }),
      { scale: 1, screenPaddingPx: 0 },
    )!;
    const marker = drawEl({ brush: "marker-bold", mode: "pen", strokeWidth: 10 });
    const aliased = drawSelectionIndicatorBox(marker, { scale: 1, screenPaddingPx: 0 })!;

    expect(plain.height).toBe(10);
    expect(aliased.height).toBeCloseTo(studioLiveBrushEffectiveDiameter(marker));
    expect(aliased.height).toBeGreaterThan(plain.height);
  });

  it("keeps the screen padding constant on screen by dividing by the zoom scale", () => {
    const el = drawEl({ mode: "eraser", strokeWidth: 2 });
    const zoomedOut = drawSelectionIndicatorBox(el, { scale: 0.5, screenPaddingPx: 4 })!;
    const zoomedIn = drawSelectionIndicatorBox(el, { scale: 4, screenPaddingPx: 4 })!;

    // width = span(10) + strokeWidth(2) + 2 * screenPaddingPx / scale
    expect(zoomedOut.width).toBeCloseTo(10 + 2 + 16);
    expect(zoomedIn.width).toBeCloseTo(10 + 2 + 2);
  });

  it("returns a padded dot box for one-point taps and null for empty points", () => {
    const tap = drawSelectionIndicatorBox(
      drawEl({ mode: "eraser", points: [4, 7], strokeWidth: 6 }),
      { scale: 1, screenPaddingPx: 0 },
    );
    expect(tap).toEqual({ x: 1, y: 4, width: 6, height: 6 });

    expect(drawSelectionIndicatorBox(drawEl({ points: [] }), { scale: 1 })).toBeNull();
  });
});

describe("StudioDrawSelectionOverlay", () => {
  it("renders one zoom-compensated dashed accent box per selected draw element", () => {
    const scale = 2;
    render(
      <StudioDrawSelectionOverlay
        els={[
          drawEl({ id: "stroke-a", mode: "eraser", points: [0, 0, 10, 20], strokeWidth: 2 }),
          drawEl({ id: "stroke-b", mode: "eraser", points: [30, 30, 40, 30], strokeWidth: 2 }),
        ]}
        scale={scale}
      />,
    );

    expect(captured("Group")[0]?.props.listening).toBe(false);
    const rects = captured("Rect");
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.props).toMatchObject({
        stroke: "oklch(0.72 0.185 42 / 0.9)",
        strokeWidth: 1.5 / scale,
        dash: [7 / scale, 4 / scale],
        listening: false,
      });
    }
    expect(rects[0]!.props).toMatchObject({ x: -2, y: -2, width: 14, height: 24 });
  });

  it("skips degenerate empty-point elements instead of drawing broken boxes", () => {
    render(
      <StudioDrawSelectionOverlay
        els={[drawEl({ id: "empty", points: [] }), drawEl({ id: "ok", mode: "eraser" })]}
        scale={1}
      />,
    );

    expect(captured("Rect")).toHaveLength(1);
  });
});
