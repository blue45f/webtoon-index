import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

import {
  createStudioCanvasRulerTicks,
  normalizeStudioCanvasRulerDpr,
  normalizeStudioCanvasRulerScale,
  shouldStartStudioCanvasRulerGuideDrag,
  snapStudioCanvasRulerDevicePixel,
  STUDIO_CANVAS_RULER_THICKNESS,
  studioCanvasRulerBackingPixels,
  studioCanvasRulerDocumentCoordinate,
  type StudioCanvasRulerAxis,
  type StudioCanvasRulerRect,
} from "./studio-canvas-ruler";

export interface StudioCanvasRulerBarsProps {
  visible: boolean;
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  canvasWidth: number;
  canvasHeight: number;
  guides?: { horizontal: number[]; vertical: number[] };
  onAddGuide?: (axis: "h" | "v", position: number) => void;
  onRemoveGuide?: (axis: "h" | "v", index: number) => void;
  onToggleRulers?: () => void;
}

interface RulerGuideDragSession {
  readonly axis: StudioCanvasRulerAxis;
  readonly pointerId: number;
  readonly rect: StudioCanvasRulerRect;
}

type RulerCssProperties = CSSProperties & {
  "--studio-ruler-thickness": string;
};

const RULER_STYLE: RulerCssProperties = {
  "--studio-ruler-thickness": `${STUDIO_CANVAS_RULER_THICKNESS}px`,
};

function rulerCanvasColors(
  canvas: HTMLCanvasElement,
  axis: StudioCanvasRulerAxis
): {
  readonly background: string;
  readonly line: string;
  readonly text: string;
  readonly fontFamily: string;
} {
  const style = window.getComputedStyle(canvas);
  return {
    background: style.backgroundColor,
    line:
      axis === "x"
        ? style.borderBottomColor || style.color
        : style.borderRightColor || style.color,
    text: style.color,
    fontFamily: style.fontFamily,
  };
}

function prepareRulerCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  axis: StudioCanvasRulerAxis
): CanvasRenderingContext2D | null {
  const backingWidth = studioCanvasRulerBackingPixels(cssWidth, dpr);
  const backingHeight = studioCanvasRulerBackingPixels(cssHeight, dpr);
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const ratio = normalizeStudioCanvasRulerDpr(dpr);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, Math.max(0, cssWidth), Math.max(0, cssHeight));
  const colors = rulerCanvasColors(canvas, axis);
  if (colors.background) {
    context.fillStyle = colors.background;
    context.fillRect(0, 0, Math.max(0, cssWidth), Math.max(0, cssHeight));
  }
  context.strokeStyle = colors.line || colors.text;
  context.fillStyle = colors.text;
  context.lineWidth = 1 / ratio;
  context.font = `9px ${colors.fontFamily || "ui-sans-serif, system-ui, sans-serif"}`;
  context.textBaseline = "alphabetic";
  return context;
}

export function StudioCanvasRulerBars({
  visible,
  scale,
  scrollLeft,
  scrollTop,
  canvasWidth,
  canvasHeight,
  onAddGuide,
}: StudioCanvasRulerBarsProps) {
  const topCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragSessionRef = useRef<RulerGuideDragSession | null>(null);
  const observedSizeRef = useRef("");
  const [sizeRevision, setSizeRevision] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const topCanvas = topCanvasRef.current;
    const leftCanvas = leftCanvasRef.current;
    if (!topCanvas || !leftCanvas) return;

    const measure = () => {
      const signature = [
        topCanvas.clientWidth,
        topCanvas.clientHeight,
        leftCanvas.clientWidth,
        leftCanvas.clientHeight,
        normalizeStudioCanvasRulerDpr(window.devicePixelRatio),
      ].join(":");
      if (signature === observedSizeRef.current) return;
      observedSizeRef.current = signature;
      setSizeRevision((revision) => revision + 1);
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(topCanvas);
    observer?.observe(leftCanvas);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const topCanvas = topCanvasRef.current;
    const leftCanvas = leftCanvasRef.current;
    if (!topCanvas || !leftCanvas) return;
    const dpr = normalizeStudioCanvasRulerDpr(window.devicePixelRatio);
    const thickness = STUDIO_CANVAS_RULER_THICKNESS;

    const topWidth = Math.max(0, topCanvas.clientWidth);
    const topContext = prepareRulerCanvas(
      topCanvas,
      topWidth,
      thickness,
      dpr,
      "x"
    );
    if (topContext) {
      const ticks = createStudioCanvasRulerTicks({
        viewportPixels: topWidth,
        scrollPixels: scrollLeft,
        scale,
        documentExtent: canvasWidth,
      });
      topContext.beginPath();
      for (const tick of ticks) {
        const x = snapStudioCanvasRulerDevicePixel(tick.screenPosition, dpr);
        const markHeight = tick.major ? 12 : 5;
        topContext.moveTo(x, thickness);
        topContext.lineTo(x, thickness - markHeight);
        if (tick.label && tick.screenPosition + 34 <= topWidth) {
          topContext.fillText(tick.label, tick.screenPosition + 3, 10.5);
        }
      }
      topContext.stroke();
    }

    const leftHeight = Math.max(0, leftCanvas.clientHeight);
    const leftContext = prepareRulerCanvas(
      leftCanvas,
      thickness,
      leftHeight,
      dpr,
      "y"
    );
    if (leftContext) {
      const ticks = createStudioCanvasRulerTicks({
        viewportPixels: leftHeight,
        scrollPixels: scrollTop,
        scale,
        documentExtent: canvasHeight,
      });
      leftContext.beginPath();
      for (const tick of ticks) {
        const y = snapStudioCanvasRulerDevicePixel(tick.screenPosition, dpr);
        const markWidth = tick.major ? 12 : 5;
        leftContext.moveTo(thickness, y);
        leftContext.lineTo(thickness - markWidth, y);
        if (tick.label && tick.screenPosition + 14 <= leftHeight) {
          leftContext.save();
          leftContext.translate(10.5, tick.screenPosition + 12);
          leftContext.rotate(-Math.PI / 2);
          leftContext.fillText(tick.label, 0, 0);
          leftContext.restore();
        }
      }
      leftContext.stroke();
    }
  }, [
    visible,
    scale,
    scrollLeft,
    scrollTop,
    canvasWidth,
    canvasHeight,
    sizeRevision,
  ]);

  if (!visible) return null;

  function beginGuideDrag(
    axis: StudioCanvasRulerAxis,
    event: PointerEvent<HTMLCanvasElement>
  ): void {
    if (
      !onAddGuide
      || event.button !== 0
      || event.isPrimary === false
      || !normalizeStudioCanvasRulerScale(scale)
    ) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      !Number.isFinite(rect.left)
      || !Number.isFinite(rect.top)
      || !Number.isFinite(rect.right)
      || !Number.isFinite(rect.bottom)
    ) {
      return;
    }
    event.preventDefault();
    dragSessionRef.current = {
      axis,
      pointerId: event.pointerId,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function continueGuideDrag(
    axis: StudioCanvasRulerAxis,
    event: PointerEvent<HTMLCanvasElement>
  ): void {
    const session = dragSessionRef.current;
    if (
      !session
      || session.axis !== axis
      || session.pointerId !== event.pointerId
      || !shouldStartStudioCanvasRulerGuideDrag(
        axis,
        { clientX: event.clientX, clientY: event.clientY },
        session.rect
      )
    ) {
      return;
    }
    const position = studioCanvasRulerDocumentCoordinate({
      clientCoordinate: axis === "x" ? event.clientX : event.clientY,
      rulerStart: axis === "x" ? session.rect.left : session.rect.top,
      scrollPixels: axis === "x" ? scrollLeft : scrollTop,
      scale,
      documentExtent: axis === "x" ? canvasWidth : canvasHeight,
    });
    dragSessionRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (position !== null) onAddGuide?.(axis === "x" ? "v" : "h", position);
  }

  function endGuideDrag(event: PointerEvent<HTMLCanvasElement>): void {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  const topInstruction =
    "세로 가이드선을 만들려면 상단 눈금자에서 캔버스 안으로 아래 방향으로 드래그하세요.";
  const leftInstruction =
    "가로 가이드선을 만들려면 왼쪽 눈금자에서 캔버스 안으로 오른쪽 방향으로 드래그하세요.";

  return (
    <div
      data-studio-canvas-rulers="true"
      data-studio-ruler-state="on"
      data-studio-ruler-layout-contract="inset-top-left"
      data-studio-ruler-thickness={STUDIO_CANVAS_RULER_THICKNESS}
      data-studio-ruler-hit-contract="desktop-fine-pointer-22px"
      style={RULER_STYLE}
      className="pointer-events-none absolute inset-0 z-30 hidden select-none overflow-hidden lg:block"
    >
      <div
        aria-hidden="true"
        data-studio-ruler-corner="true"
        className="pointer-events-none absolute left-0 top-0 flex items-center justify-center border-b border-r border-line bg-panel text-[9px] text-fg-3"
        style={{
          width: "var(--studio-ruler-thickness)",
          height: "var(--studio-ruler-thickness)",
        }}
      >
        px
      </div>

      <canvas
        ref={topCanvasRef}
        onPointerDown={(event) => beginGuideDrag("x", event)}
        onPointerMove={(event) => continueGuideDrag("x", event)}
        onPointerUp={endGuideDrag}
        onPointerCancel={endGuideDrag}
        data-studio-ruler-axis="x"
        data-studio-ruler-guide-gesture="drag-to-canvas"
        aria-label={topInstruction}
        aria-disabled={onAddGuide ? undefined : true}
        className={`pointer-events-auto absolute top-0 touch-none border-b border-line bg-panel text-fg-3 ${
          onAddGuide ? "cursor-ns-resize" : "cursor-default"
        }`}
        style={{
          left: "var(--studio-ruler-thickness)",
          width: "calc(100% - var(--studio-ruler-thickness))",
          height: "var(--studio-ruler-thickness)",
        }}
        title={topInstruction}
      />

      <canvas
        ref={leftCanvasRef}
        onPointerDown={(event) => beginGuideDrag("y", event)}
        onPointerMove={(event) => continueGuideDrag("y", event)}
        onPointerUp={endGuideDrag}
        onPointerCancel={endGuideDrag}
        data-studio-ruler-axis="y"
        data-studio-ruler-guide-gesture="drag-to-canvas"
        aria-label={leftInstruction}
        aria-disabled={onAddGuide ? undefined : true}
        className={`pointer-events-auto absolute left-0 touch-none border-r border-line bg-panel text-fg-3 ${
          onAddGuide ? "cursor-ew-resize" : "cursor-default"
        }`}
        style={{
          top: "var(--studio-ruler-thickness)",
          width: "var(--studio-ruler-thickness)",
          height: "calc(100% - var(--studio-ruler-thickness))",
        }}
        title={leftInstruction}
      />
    </div>
  );
}
