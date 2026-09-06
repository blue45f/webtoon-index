import { useCallback } from "react";
import {
  Circle as KCircle,
  Ellipse,
  Group,
  Layer,
  Line as KLine,
  Rect,
} from "react-konva/lib/ReactKonvaCore";

import {
  planStudioBrushCursorVisual,
  type StudioBrushCursorMode,
} from "../canvas/studio-canvas-cursor";

import type { StudioBrushCursorStyle } from "../studio-app-settings";
import type Konva from "konva";
import type { RefObject } from "react";

interface StudioBrushCursorProps {
  cursorRef: RefObject<Konva.Group | null>;
  guideRef?: RefObject<Konva.Line | null>;
  brushId: string;
  diameter: number;
  effectiveScale: number;
  mode: StudioBrushCursorMode;
  style: StudioBrushCursorStyle;
  tipAngleDeg: number;
  tipRoundness: number;
}

const CURSOR_DARK = "oklch(0.17 0.01 70 / 0.96)";
const CURSOR_LIGHT = "oklch(0.97 0.01 85 / 0.98)";

interface StudioBrushCursorOutlineProps {
  dash?: readonly number[];
  radiusX: number;
  radiusY: number;
  shape: "round" | "ellipse" | "square";
  stroke: string;
  strokeWidth: number;
}

function StudioBrushCursorOutline({
  dash,
  radiusX,
  radiusY,
  shape,
  stroke,
  strokeWidth,
}: StudioBrushCursorOutlineProps) {
  const shared = {
    dash: dash ? [...dash] : undefined,
    fillEnabled: false,
    listening: false,
    perfectDrawEnabled: false,
    stroke,
    strokeWidth,
  } as const;
  if (shape === "square") {
    return (
      <Rect
        {...shared}
        x={-radiusX}
        y={-radiusY}
        width={radiusX * 2}
        height={radiusY * 2}
      />
    );
  }
  return <Ellipse {...shared} radiusX={radiusX} radiusY={radiusY} />;
}

/**
 * Exact-size, non-interactive drawing cursor. The dark/light nested outline stays legible over
 * white paper, dark ink, tones, and photo backgrounds without covering the pixels being edited.
 */
export function StudioBrushCursor({
  cursorRef,
  guideRef,
  brushId,
  diameter,
  effectiveScale,
  mode,
  style,
  tipAngleDeg,
  tipRoundness,
}: StudioBrushCursorProps) {
  const visual = planStudioBrushCursorVisual({
    brushId,
    diameter,
    effectiveScale,
    mode,
    style,
    tipAngleDeg,
    tipRoundness,
  });

  // The cursor layer owns its own Konva canvas element. Tag it in the DOM so evidence tooling
  // (browser verifiers, recordings, exports) can exclude the transient cursor chrome from pixel
  // measurements — the ring is UI, never document ink.
  const tagCursorCanvas = useCallback((layer: Konva.Layer | null) => {
    layer?.getCanvas()._canvas.setAttribute("data-studio-brush-cursor-canvas", "true");
  }, []);

  return (
    <Layer ref={tagCursorCanvas} listening={false} name="studio-brush-cursor-layer">
      {guideRef ? (
        <KLine
          ref={guideRef}
          visible={false}
          points={[0, 0, 0, 0]}
          stroke="oklch(0.63 0.19 285 / 0.86)"
          strokeWidth={1}
          dash={[4, 3]}
          lineCap="round"
          listening={false}
          perfectDrawEnabled={false}
          shadowColor="oklch(0.98 0.01 85 / 0.9)"
          shadowBlur={1}
          shadowOpacity={0.8}
          name="studio-stroke-guide"
        />
      ) : null}
      <Group
        ref={cursorRef}
        visible={false}
        listening={false}
        name={`studio-brush-cursor studio-brush-cursor-${mode}`}
        rotation={visual.rotationDeg}
      >
        {visual.showOutline ? (
          <>
            <StudioBrushCursorOutline
              radiusX={visual.radiusX}
              radiusY={visual.radiusY}
              shape={visual.shape}
              stroke={CURSOR_DARK}
              strokeWidth={visual.outerStrokeWidth}
            />
            <StudioBrushCursorOutline
              radiusX={visual.radiusX}
              radiusY={visual.radiusY}
              shape={visual.shape}
              stroke={CURSOR_LIGHT}
              strokeWidth={visual.innerStrokeWidth}
              dash={visual.dash}
            />
            {visual.innerBoundaryScale !== null ? (
              <>
                <StudioBrushCursorOutline
                  radiusX={visual.radiusX * visual.innerBoundaryScale}
                  radiusY={visual.radiusY * visual.innerBoundaryScale}
                  shape={visual.shape}
                  stroke={CURSOR_DARK}
                  strokeWidth={visual.innerStrokeWidth * 1.75}
                  dash={visual.dash}
                />
                <StudioBrushCursorOutline
                  radiusX={visual.radiusX * visual.innerBoundaryScale}
                  radiusY={visual.radiusY * visual.innerBoundaryScale}
                  shape={visual.shape}
                  stroke={CURSOR_LIGHT}
                  strokeWidth={visual.centerStrokeWidth}
                  dash={visual.dash}
                />
              </>
            ) : null}
          </>
        ) : null}
        {visual.centerRadius !== null ? (
          <KCircle
            radius={visual.centerRadius}
            fill={CURSOR_DARK}
            stroke={CURSOR_LIGHT}
            strokeWidth={visual.centerStrokeWidth}
            listening={false}
            perfectDrawEnabled={false}
          />
        ) : null}
      </Group>
    </Layer>
  );
}
