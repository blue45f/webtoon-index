// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioCanvasGuideOverlayLayers,
  StudioCanvasGuideUnderlay,
  type StudioCanvasGuideOverlayLayersProps,
  type StudioUserGuide,
} from "./StudioCanvasGuideLayers";

import type { ReactNode } from "react";

const capture = vi.hoisted(() => ({
  circles: [] as Record<string, unknown>[],
  ellipses: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  isometric: [] as Record<string, unknown>[],
  layers: [] as Record<string, unknown>[],
  lines: [] as Record<string, unknown>[],
  perspective: [] as Record<string, unknown>[],
  rects: [] as Record<string, unknown>[],
  shapes: [] as Record<string, unknown>[],
  texts: [] as Record<string, unknown>[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement } = await import("react");
  const record = (target: Record<string, unknown>[], props: Record<string, unknown>) => {
    const captured: Record<string, unknown> = {};
    for (const name of Object.keys(props)) {
      if (name !== "key") captured[name] = props[name];
    }
    target.push(captured);
  };
  const container = (target: Record<string, unknown>[]) => (
    props: Record<string, unknown> & { children?: ReactNode },
  ) => {
    record(target, props);
    return createElement(Fragment, null, props.children);
  };
  const primitive = (target: Record<string, unknown>[]) => (props: Record<string, unknown>) => {
    record(target, props);
    return null;
  };
  return {
    Circle: primitive(capture.circles),
    Ellipse: primitive(capture.ellipses),
    Group: container(capture.groups),
    Layer: container(capture.layers),
    Line: primitive(capture.lines),
    Rect: primitive(capture.rects),
    Shape: primitive(capture.shapes),
    Text: primitive(capture.texts),
  };
});

vi.mock("../studio-page-lazy-ui", () => ({
  StudioPerspectiveOverlay: (props: Record<string, unknown>) => {
    capture.perspective.push(props);
    return null;
  },
  StudioIsometricGridOverlay: (props: Record<string, unknown>) => {
    capture.isometric.push(props);
    return null;
  },
}));

function overlayProps(
  overrides: Partial<StudioCanvasGuideOverlayLayersProps> = {},
): StudioCanvasGuideOverlayLayersProps {
  return {
    canvasHeight: 80,
    canvasWidth: 100,
    drawingAssistDisabled: false,
    drawingMode: false,
    effScale: 2,
    guides: { x: [], y: [] },
    isExporting: false,
    isometricConfig: {
      angleDeg: 30,
      cellSize: 24,
      originX: 50,
      originY: 40,
    },
    isometricGridActive: false,
    onCancelDrawingAssistPreview: vi.fn(),
    onCommitIsometricOrigin: vi.fn(),
    onCommitVanishingPoint: vi.fn(),
    onPreviewIsometricOrigin: vi.fn(),
    onPreviewVanishingPoint: vi.fn(),
    perspectiveRulerActive: false,
    setSymmetryCenterX: vi.fn(),
    setSymmetryCenterY: vi.fn(),
    setUserGuides: vi.fn(),
    smartGuides: { segments: [], spacings: [] },
    symmetryCenterX: 50,
    symmetryCenterY: 40,
    symmetryRadialCount: 4,
    symmetryType: "none",
    userGuides: [],
    vanishingPoints: [],
    ...overrides,
  };
}

function clearCapture(): void {
  for (const values of Object.values(capture)) values.length = 0;
}

type GridPathSegment = readonly [
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
];

function executeCapturedGridScene(shapeProps: Record<string, unknown>) {
  const segments: GridPathSegment[] = [];
  let cursor: readonly [number, number] | null = null;
  const context = {
    beginPath: vi.fn(() => {
      cursor = null;
    }),
    moveTo: vi.fn((x: number, y: number) => {
      cursor = [x, y];
    }),
    lineTo: vi.fn((x: number, y: number) => {
      if (!cursor) throw new Error("grid sceneFunc called lineTo before moveTo");
      segments.push([cursor[0], cursor[1], x, y]);
      cursor = [x, y];
    }),
    strokeShape: vi.fn(),
  };
  const shape = { role: "captured-grid-shape" };
  const sceneFunc = shapeProps.sceneFunc as
    | ((drawingContext: typeof context, targetShape: typeof shape) => void)
    | undefined;
  expect(sceneFunc).toBeTypeOf("function");
  sceneFunc!(context, shape);
  return { context, segments, shape };
}

beforeEach(clearCapture);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioCanvasGuideUnderlay", () => {
  it("renders deterministic grid, safe-area, and publication-width geometry below the document", () => {
    const safeAreaMargin = vi.fn(() => ({ left: 6, right: 8 }));
    const webtoonWidthGuides = vi.fn(() => [{ axis: "x" as const, pos: 20, label: "표준 60" }]);

    render(
      <StudioCanvasGuideUnderlay
        canvasWidth={100}
        canvasHeight={50}
        effScale={2}
        gridSize={25}
        showGrid
        showWebtoonGuides
        webtoonGuides={{ safeAreaMargin, webtoonWidthGuides }}
      />,
    );

    expect(safeAreaMargin).toHaveBeenCalledWith(100);
    expect(webtoonWidthGuides).toHaveBeenCalledWith(100);
    expect(capture.shapes).toHaveLength(2);
    expect(capture.shapes).toMatchObject([
      {
        listening: false,
        perfectDrawEnabled: false,
        stroke: "rgba(124, 92, 252, 0.24)",
        strokeWidth: 0.5,
      },
      {
        listening: false,
        perfectDrawEnabled: false,
        stroke: "rgba(124, 92, 252, 0.46)",
        strokeWidth: 0.675,
      },
    ]);
    expect(capture.groups.map((group) => group.listening)).toEqual([false]);
    expect(capture.lines.map((line) => line.points)).toEqual([
      [20, 0, 20, 50],
    ]);
    expect(capture.rects).toMatchObject([
      { x: 0, width: 6, height: 50 },
      { x: 92, width: 8, height: 50 },
    ]);
    expect(capture.lines.at(-1)).toMatchObject({ dash: [3, 3], strokeWidth: 0.5 });
  });

  it("executes separate minor/major paths and strokes each Shape on the five-cell cadence", () => {
    render(
      <StudioCanvasGuideUnderlay
        canvasWidth={100}
        canvasHeight={50}
        effScale={1}
        gridSize={10}
        showGrid
        showWebtoonGuides={false}
        webtoonGuides={null}
      />,
    );

    expect(capture.shapes).toHaveLength(2);
    const minor = executeCapturedGridScene(capture.shapes[0]);
    const major = executeCapturedGridScene(capture.shapes[1]);

    expect(minor.context.beginPath).toHaveBeenCalledTimes(1);
    expect(minor.context.strokeShape).toHaveBeenCalledOnce();
    expect(minor.context.strokeShape).toHaveBeenCalledWith(minor.shape);
    expect(minor.segments).toEqual([
      [10, 0, 10, 50],
      [20, 0, 20, 50],
      [30, 0, 30, 50],
      [40, 0, 40, 50],
      [60, 0, 60, 50],
      [70, 0, 70, 50],
      [80, 0, 80, 50],
      [90, 0, 90, 50],
      [0, 10, 100, 10],
      [0, 20, 100, 20],
      [0, 30, 100, 30],
      [0, 40, 100, 40],
    ]);

    expect(major.context.beginPath).toHaveBeenCalledTimes(1);
    expect(major.context.strokeShape).toHaveBeenCalledOnce();
    expect(major.context.strokeShape).toHaveBeenCalledWith(major.shape);
    expect(major.segments).toEqual([
      [0, 0, 0, 50],
      [50, 0, 50, 50],
      [100, 0, 100, 50],
      [0, 0, 100, 0],
      [0, 50, 100, 50],
    ]);

    const minorPathKeys = new Set(minor.segments.map((segment) => segment.join(",")));
    expect(major.segments.every((segment) => !minorPathKeys.has(segment.join(",")))).toBe(true);
  });

  it("does not instantiate either grid Shape while pixel-grid display is disabled", () => {
    render(
      <StudioCanvasGuideUnderlay
        canvasWidth={100}
        canvasHeight={50}
        effScale={1}
        gridSize={10}
        showGrid={false}
        showWebtoonGuides={false}
        webtoonGuides={null}
      />,
    );

    expect(capture.shapes).toEqual([]);
  });
});

describe("StudioCanvasGuideOverlayLayers", () => {
  it("keeps snap and smart guides in separate passive layers and suppresses all overlays for export", () => {
    const view = render(
      <StudioCanvasGuideOverlayLayers
        {...overlayProps({
          guides: { x: [10], y: [20] },
          smartGuides: {
            segments: [{ axis: "v", pos: 30, from: 5, to: 70, kind: "center" }],
            spacings: [{ axis: "x", gap: 9.6, at: 40, spans: [{ from: 10, to: 30 }] }],
          },
        })}
      />,
    );

    expect(capture.layers.map((layer) => layer.listening)).toEqual([false, false]);
    expect(capture.lines.slice(0, 3).map((line) => line.points)).toEqual([
      [10, 0, 10, 80],
      [0, 20, 100, 20],
      [30, 5, 30, 70],
    ]);
    expect(capture.lines[2]).toMatchObject({ dash: [3.5, 1.5], strokeWidth: 0.5 });
    expect(capture.texts).toMatchObject([{ text: "10", x: 8, y: 43, width: 24 }]);

    clearCapture();
    view.rerender(
      <StudioCanvasGuideOverlayLayers
        {...overlayProps({
          isExporting: true,
          guides: { x: [10], y: [20] },
          userGuides: [{ id: "guide", type: "v", pos: 30 }],
          symmetryType: "vertical",
          drawingMode: true,
        })}
      />,
    );
    expect(capture.layers).toEqual([]);
    expect(capture.lines).toEqual([]);
  });

  it("clamps user-guide and symmetry-handle drags without changing their restricted axis", () => {
    const setUserGuides = vi.fn();
    const setSymmetryCenterX = vi.fn();
    const setSymmetryCenterY = vi.fn();
    const userGuides: StudioUserGuide[] = [{ id: "vertical", type: "v", pos: 40 }];

    render(
      <StudioCanvasGuideOverlayLayers
        {...overlayProps({
          drawingMode: true,
          setSymmetryCenterX,
          setSymmetryCenterY,
          setUserGuides,
          symmetryCenterX: 30,
          symmetryCenterY: 20,
          symmetryType: "kaleidoscope",
          userGuides,
        })}
      />,
    );

    const guideHandle = capture.lines.find((line) => line.name === "guide-line-handle") as {
      onDragMove: (event: { target: { x: (value?: number) => number | void; y: (value?: number) => number | void } }) => void;
    };
    let guideX = 80;
    let guideY = 999;
    const guideNode = {
      x: vi.fn((value?: number) => value === undefined ? guideX : void (guideX = value)),
      y: vi.fn((value?: number) => value === undefined ? guideY : void (guideY = value)),
    };
    guideHandle.onDragMove({ target: guideNode });
    const updateGuides = setUserGuides.mock.calls[0]?.[0] as (current: StudioUserGuide[]) => StudioUserGuide[];
    expect(updateGuides(userGuides)).toEqual([{ id: "vertical", type: "v", pos: 100 }]);
    expect(guideNode.y).toHaveBeenCalledWith(0);
    expect(guideNode.x).toHaveBeenCalledWith(0);

    const symmetryHandle = capture.circles.find((circle) => circle.name === "symmetry-handle") as {
      onDragMove: (event: { target: { x: () => number; y: () => number } }) => void;
    };
    symmetryHandle.onDragMove({ target: { x: () => 150, y: () => -5 } });
    expect(setSymmetryCenterX).toHaveBeenCalledWith(100);
    expect(setSymmetryCenterY).toHaveBeenCalledWith(0);
    expect(capture.lines.filter((line) => line.stroke === "#0ea5e9" && line.opacity === 0.7))
      .toHaveLength(4);
    expect(capture.lines.filter((line) => line.stroke === "#a855f7")).toHaveLength(4);
  });

  it("forwards drawing-assist transactions and hides them outside drawing mode", () => {
    const onPreviewVanishingPoint = vi.fn();
    const onCommitVanishingPoint = vi.fn();
    const onPreviewIsometricOrigin = vi.fn();
    const onCommitIsometricOrigin = vi.fn();
    const onCancelDrawingAssistPreview = vi.fn();
    const props = overlayProps({
      drawingAssistDisabled: true,
      drawingMode: true,
      isometricGridActive: true,
      onCancelDrawingAssistPreview,
      onCommitIsometricOrigin,
      onCommitVanishingPoint,
      onPreviewIsometricOrigin,
      onPreviewVanishingPoint,
      perspectiveRulerActive: true,
      vanishingPoints: [{ id: "vp", x: 10, y: 20 }],
    });
    const view = render(<StudioCanvasGuideOverlayLayers {...props} />);

    expect(capture.perspective).toMatchObject([{
      disabled: true,
      onPreviewPoint: onPreviewVanishingPoint,
      onCommitPoint: onCommitVanishingPoint,
      onCancelPoint: onCancelDrawingAssistPreview,
    }]);
    expect(capture.isometric).toMatchObject([{
      disabled: true,
      onPreviewOrigin: onPreviewIsometricOrigin,
      onCommitOrigin: onCommitIsometricOrigin,
      onCancelOrigin: onCancelDrawingAssistPreview,
    }]);

    clearCapture();
    view.rerender(<StudioCanvasGuideOverlayLayers {...props} drawingMode={false} />);
    expect(capture.perspective).toEqual([]);
    expect(capture.isometric).toEqual([]);
    expect(capture.layers).toEqual([]);
  });
});
