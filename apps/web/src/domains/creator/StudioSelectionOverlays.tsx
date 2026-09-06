/* eslint-disable react-refresh/only-export-components -- 순수 측정 헬퍼(drawSelectionIndicatorBox)도 선택 표시 회귀 테스트의 공개 계약이다. */
/**
 * Optional Konva overlays for pixel selection and crop editing.
 *
 * Both overlays are loaded only when their corresponding tool is active so
 * the animation/rendering code does not inflate the Studio route bootstrap.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Line, Rect } from "react-konva/lib/ReactKonvaCore";

import {
  getSymmetricPoints,
  studioLiveBrushEffectiveDiameter,
} from "./brush/studio-draw-rendering";
import {
  cropHandlePoints,
  cropRectLocalPx,
  cropShadeRects,
  cropThirdsLines,
  type CropRect,
} from "./studio-crop";
import {
  pressureAt,
  type NodeEditHandle,
  type NodeEditTool,
} from "./studio-node-edit";
import {
  STUDIO_DRAW_SELECTION_INDICATOR_NAME,
  mirrorStudioDrawSelectionIndicators,
} from "./studio-selection-chrome-mirror";
import {
  brushStrokePreview,
  marchingAntsPasses,
  subpathOutlinePoints,
  type PixelSelection,
  type SelectionCombineMode,
  type SelectionDragState,
  type SelectionFrame,
  type SelPoint,
} from "./studio-selection-tools";

import type { DrawEl } from "./studio-element-model";
import type { OnionSkinLayer } from "./studio-frame-animation";
import type Konva from "konva";

function selectionModePreviewColors(
  mode: SelectionCombineMode
): { stroke: string; fill: string } {
  if (mode === "subtract") {
    return { stroke: "rgba(244, 63, 94, 0.55)", fill: "rgba(244, 63, 94, 0.12)" };
  }
  if (mode === "intersect") {
    return { stroke: "rgba(14, 165, 233, 0.55)", fill: "rgba(14, 165, 233, 0.12)" };
  }
  return { stroke: "rgba(124, 92, 252, 0.5)", fill: "rgba(124, 92, 252, 0.10)" };
}

export interface StudioSelectionAntsOverlayProps {
  selection: PixelSelection | null;
  drag: SelectionDragState | null;
  /** 다각형 올가미 진행 중 — 열린 폴리라인 + 고무줄(hover) + 꼭짓점 점. */
  polyDraft?: {
    points: SelPoint[];
    hover: SelPoint | null;
    mode: SelectionCombineMode;
  } | null;
  frame: SelectionFrame;
  scale: number;
}

/**
 * Pixel-selection marching ants. Only this small Konva layer redraws on the
 * quantized animation clock, so the Studio document tree remains untouched.
 */
export function StudioSelectionAntsOverlay({
  selection,
  drag,
  polyDraft,
  frame,
  scale,
}: StudioSelectionAntsOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let animationFrame = 0;
    const tick = (now: number) => {
      setElapsedMs(Math.floor((now - start) / 50) * 50);
      animationFrame = globalThis.requestAnimationFrame(tick);
    };
    animationFrame = globalThis.requestAnimationFrame(tick);
    return () => globalThis.cancelAnimationFrame(animationFrame);
  }, []);

  const passes = marchingAntsPasses(elapsedMs, scale);
  const size = { width: frame.width, height: frame.height };
  const brushDrag = drag?.tool === "brush"
    ? brushStrokePreview(drag.points, drag.brushRadius, size)
    : null;
  const dragPoints = drag && drag.tool !== "brush" && drag.points.length >= 2
    ? subpathOutlinePoints({ mode: drag.mode, points: drag.points }, size)
    : null;
  const dragColors = selectionModePreviewColors(drag?.mode ?? "add");
  const polyDraftPoints = polyDraft && polyDraft.points.length > 0
    ? subpathOutlinePoints(
        {
          mode: polyDraft.mode,
          points: polyDraft.hover ? [...polyDraft.points, polyDraft.hover] : polyDraft.points,
        },
        size
      )
    : null;
  const polyColors = selectionModePreviewColors(polyDraft?.mode ?? "add");
  const vertexRadius = 3.5 / scale;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      {selection?.subpaths.map((subpath, subpathIndex) => {
        if (subpath.kind === "brush") {
          const stroke = brushStrokePreview(subpath.points, subpath.radius, size);
          if (!stroke) return null;
          return passes.map((pass, passIndex) => (
            <Line
              key={`ants-brush-${subpathIndex}-${passIndex}`}
              points={stroke.points}
              stroke={pass.stroke}
              strokeWidth={stroke.strokeWidth}
              lineCap="round"
              lineJoin="round"
              opacity={passIndex === 0 ? 0.9 : 0.5}
            />
          ));
        }
        const points = subpathOutlinePoints(subpath, size);
        return passes.map((pass, passIndex) => (
          <Line
            key={`ants-${subpathIndex}-${passIndex}`}
            points={points}
            closed
            stroke={pass.stroke}
            strokeWidth={pass.strokeWidth}
            dash={pass.dash ?? undefined}
            dashOffset={pass.dashOffset}
          />
        ));
      })}

      {selection?.invert &&
        passes.map((pass, passIndex) => (
          <Rect
            key={`ants-inv-${passIndex}`}
            x={0}
            y={0}
            width={frame.width}
            height={frame.height}
            stroke={pass.stroke}
            strokeWidth={pass.strokeWidth}
            dash={pass.dash ?? undefined}
            dashOffset={pass.dashOffset}
          />
        ))}

      {brushDrag ? (
        <Line
          points={brushDrag.points}
          stroke={dragColors.stroke}
          strokeWidth={brushDrag.strokeWidth}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}

      {dragPoints ? (
        <>
          <Line points={dragPoints} closed fill={dragColors.fill} />
          {passes.map((pass, passIndex) => (
            <Line
              key={`ants-drag-${passIndex}`}
              points={dragPoints}
              closed
              stroke={pass.stroke}
              strokeWidth={pass.strokeWidth}
              dash={pass.dash ?? undefined}
              dashOffset={pass.dashOffset}
            />
          ))}
        </>
      ) : null}

      {polyDraftPoints && polyDraft ? (
        <>
          <Line
            points={polyDraftPoints}
            closed={false}
            stroke={polyColors.stroke}
            strokeWidth={1.5 / scale}
            lineJoin="round"
            lineCap="round"
          />
          {polyDraft.points.map((point, pointIndex) => (
            <Circle
              key={`poly-v-${pointIndex}`}
              x={point.x * size.width}
              y={point.y * size.height}
              radius={pointIndex === 0 && polyDraft.points.length >= 3
                ? vertexRadius * 1.35
                : vertexRadius}
              fill={pointIndex === 0 ? polyColors.stroke : "rgba(255,255,255,0.9)"}
              stroke={polyColors.stroke}
              strokeWidth={1 / scale}
            />
          ))}
        </>
      ) : null}
    </Group>
  );
}

export interface StudioCropOverlayProps {
  rect: CropRect;
  frame: SelectionFrame;
  scale: number;
}

/** Crop mask, rule-of-thirds guides, border, and eight resize handles. */
export function StudioCropOverlay({ rect, frame, scale }: StudioCropOverlayProps) {
  const size = { width: frame.width, height: frame.height };
  const border = cropRectLocalPx(rect, size);
  const handleSide = 9 / scale;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      {cropShadeRects(rect, size).map((shade, shadeIndex) => (
        <Rect
          key={`crop-shade-${shadeIndex}`}
          x={shade.x}
          y={shade.y}
          width={shade.w}
          height={shade.h}
          fill="rgba(9, 9, 11, 0.55)"
        />
      ))}
      {cropThirdsLines(rect, size).map((points, lineIndex) => (
        <Line
          key={`crop-third-${lineIndex}`}
          points={points}
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth={1 / scale}
        />
      ))}
      <Rect
        x={border.x}
        y={border.y}
        width={border.w}
        height={border.h}
        stroke="rgba(24, 24, 27, 0.6)"
        strokeWidth={3 / scale}
      />
      <Rect
        x={border.x}
        y={border.y}
        width={border.w}
        height={border.h}
        stroke="#ffffff"
        strokeWidth={1.5 / scale}
      />
      {cropHandlePoints(rect, size).map((handle) => (
        <Rect
          key={`crop-handle-${handle.id}`}
          x={handle.x - handleSide / 2}
          y={handle.y - handleSide / 2}
          width={handleSide}
          height={handleSide}
          fill="#ffffff"
          stroke="#18181b"
          strokeWidth={1 / scale}
          cornerRadius={2 / scale}
        />
      ))}
    </Group>
  );
}

export interface StudioNodeEditOverlayProps {
  handles: NodeEditHandle[];
  tool: NodeEditTool;
  pressures: number[] | undefined;
  scale: number;
  activeHandleIndex: number | null;
}

/** Vector point/width/smoothing handles, loaded only while node editing. */
export function StudioNodeEditOverlay({
  handles,
  tool,
  pressures,
  scale,
  activeHandleIndex,
}: StudioNodeEditOverlayProps) {
  return (
    <Group listening={false}>
      {handles.map((handle) => {
        const active = activeHandleIndex === handle.pointIndex;
        const radius = tool === "width"
          ? (4 + pressureAt(pressures, handle.pointIndex) * 8) / scale
          : 5 / scale;
        const fill = active
          ? tool === "smooth"
            ? "#0f766e"
            : "#7c5cfc"
          : tool === "width"
            ? "#7c5cfc"
            : tool === "smooth"
              ? "#14b8a6"
              : "#ffffff";
        return (
          <Circle
            key={handle.pointIndex}
            x={handle.x}
            y={handle.y}
            radius={radius}
            fill={fill}
            stroke="#18181b"
            strokeWidth={1.25 / scale}
          />
        );
      })}
    </Group>
  );
}

export interface StudioBubbleShapeOverlayProps {
  frame: { x: number; y: number; rotation: number };
  handles: NodeEditHandle[];
  scale: number;
  activeHandleIndex: number | null;
}

/** Local-coordinate custom speech-bubble polygon handles. */
export function StudioBubbleShapeOverlay({
  frame,
  handles,
  scale,
  activeHandleIndex,
}: StudioBubbleShapeOverlayProps) {
  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation} listening={false}>
      {handles.map((handle) => (
        <Circle
          key={handle.pointIndex}
          x={handle.x}
          y={handle.y}
          radius={5 / scale}
          fill={activeHandleIndex === handle.pointIndex ? "#7c5cfc" : "#ffffff"}
          stroke="#18181b"
          strokeWidth={1.25 / scale}
        />
      ))}
    </Group>
  );
}

/** Matches the Transformer border / locked-selection accent so "selected" reads as one language. */
const DRAW_SELECTION_ACCENT = "oklch(0.72 0.185 42 / 0.9)";
const DRAW_SELECTION_DEFAULT_SCREEN_PADDING_PX = 2;

export interface DrawSelectionIndicatorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Document-space bounding box for a draw(선화) element's *visible ink*.
 *
 * Draw elements have no x/y/width/height — geometry lives in `points` — so the Konva Transformer
 * never attaches to them (they register no node ref and are intentionally outside the
 * drag/transform system). This is the shared measurement for their dedicated selection indicator:
 * it scans every point (not just the first two like `drawBounds`), unions all symmetry copies,
 * and pads by the brush's effective ink radius plus a small zoom-compensated screen margin.
 */
export function drawSelectionIndicatorBox(
  el: DrawEl,
  options: { scale: number; screenPaddingPx?: number }
): DrawSelectionIndicatorBox | null {
  if (el.points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const variation of getSymmetricPoints(el.points, el.symmetry)) {
    for (let i = 0; i + 1 < variation.length; i += 2) {
      const x = variation[i]!;
      const y = variation[i + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const scale = Math.max(options.scale, 0.0001);
  const pad =
    studioLiveBrushEffectiveDiameter(el) / 2 +
    (options.screenPaddingPx ?? DRAW_SELECTION_DEFAULT_SCREEN_PADDING_PX) / scale;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

export interface StudioDrawSelectionOverlayProps {
  /** Selected draw elements (single selection or the draw members of a marquee multi-select). */
  els: readonly DrawEl[];
  scale: number;
}

export { STUDIO_DRAW_SELECTION_INDICATOR_NAME } from "./studio-selection-chrome-mirror";

/**
 * Dashed "selected" boxes for draw(선화) elements.
 *
 * The Transformer resolves nodes through the element ref map, which draw elements never join,
 * so without this overlay a selected stroke shows no on-canvas selection chrome at all. Styling
 * mirrors the locked-element dashed rect in StudioPage (same accent, stroke and dash rhythm),
 * and everything is zoom-compensated so the indicator keeps a constant screen weight.
 *
 * **Live drag mirroring.** `drawSelectionIndicatorBox` measures `el.points`, which are document
 * state and therefore frozen for the whole drag — the wrapper node is translated imperatively by
 * Konva and only bakes its offset into `points` at drag end. Rendering the box from points alone
 * left the indicator standing still while the stroke moved (measured: 227px of divergence over a
 * 233px drag, never converging until pointer-up).
 *
 * So each indicator lives in its own group whose position mirrors the wrapper's live x/y through
 * Konva's own `xChange`/`yChange` events. Those fire synchronously inside `Node._setAttr`, before
 * the drag's `_requestDraw`, so the indicator and the ink land in the *same* rasterized frame with
 * zero React commits — the same imperative discipline `translateGroupPreview` already uses for the
 * multi-select overlay, and consistent with the hot-path de-React contract.
 */
export function StudioDrawSelectionOverlay({ els, scale }: StudioDrawSelectionOverlayProps) {
  const indicatorRefs = useRef(new Map<string, Konva.Group>());
  // Identity of the mirrored set; re-subscribes when the selection itself changes.
  const selectionKey = els.map((el) => el.id).join(" ");

  useLayoutEffect(
    () => mirrorStudioDrawSelectionIndicators(indicatorRefs.current),
    [selectionKey]
  );

  return (
    <Group listening={false}>
      {els.map((el) => {
        const box = drawSelectionIndicatorBox(el, { scale });
        if (!box) return null;
        return (
          <Group
            key={el.id}
            name={STUDIO_DRAW_SELECTION_INDICATOR_NAME}
            listening={false}
            ref={(node: Konva.Group | null) => {
              if (node) indicatorRefs.current.set(el.id, node);
              else indicatorRefs.current.delete(el.id);
            }}
          >
            <Rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              stroke={DRAW_SELECTION_ACCENT}
              strokeWidth={1.5 / scale}
              dash={[7 / scale, 4 / scale]}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

export interface StudioOnionSkinImageProps {
  el: { x: number; y: number; width: number; height: number };
  layer: OnionSkinLayer;
}

/** Previous/next animation frame reference that never participates in hit testing. */
export function StudioOnionSkinImage({ el, layer }: StudioOnionSkinImageProps) {
  const [image, setImage] = useState<HTMLImageElement>();

  useEffect(() => {
    const nextImage = new globalThis.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = layer.frame.src;
    return () => {
      nextImage.onload = null;
    };
  }, [layer.frame.src]);

  if (!image) return null;
  return (
    <Group opacity={layer.opacity} listening={false}>
      <KonvaImage
        image={image}
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        listening={false}
      />
      {layer.tint !== "none" ? (
        <Rect
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          fill={layer.tint === "prev" ? "#ef4444" : "#3b82f6"}
          opacity={0.55}
          globalCompositeOperation="source-atop"
          listening={false}
        />
      ) : null}
    </Group>
  );
}
