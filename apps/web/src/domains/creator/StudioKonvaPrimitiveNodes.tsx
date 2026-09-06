import { useEffect, useState } from "react";
import {
  Group,
  Image as KImage,
  Line,
  Rect,
  Shape,
  Text as KText,
} from "react-konva/lib/ReactKonvaCore";

import {
  planStudioFocusLineSegments,
  planStudioSpeedLineSegments,
  STUDIO_FOCUS_LINE_DEFAULTS,
  STUDIO_SPEED_LINE_DEFAULTS,
} from "./render/studio-radial-line-geometry";
import { resizableNodeProps } from "./studio-node-props";

import type { FocusLinesEl, FrameEl, SpeedLinesEl } from "./studio-element-model";
import type { StudioWorkAssetRenderPlaceholder } from "./studio-work-asset-render-projection";
import type Konva from "konva";

export function StudioWorkAssetPlaceholderNode({
  placeholder,
  scale,
}: {
  placeholder: StudioWorkAssetRenderPlaceholder;
  scale: number;
}) {
  const palette = placeholder.status === "error"
    ? { fill: "#450a0a", stroke: "#ef4444", title: "#fecaca", detail: "#fca5a5" }
    : placeholder.status === "ready"
      ? { fill: "#052e16", stroke: "#22c55e", title: "#bbf7d0", detail: "#86efac" }
      : { fill: "#1e1b4b", stroke: "#8b5cf6", title: "#ddd6fe", detail: "#c4b5fd" };
  const padding = Math.min(18, Math.max(8, placeholder.width * 0.05));
  return (
    <Group
      key={`work-asset-placeholder:${placeholder.elementType}:${placeholder.assetId}`}
      x={placeholder.x}
      y={placeholder.y}
      rotation={placeholder.rotation}
      listening={false}
    >
      <Rect
        width={placeholder.width}
        height={placeholder.height}
        fill={palette.fill}
        opacity={0.88}
        stroke={palette.stroke}
        strokeWidth={1.5 / Math.max(0.1, scale)}
        dash={[8 / Math.max(0.1, scale), 5 / Math.max(0.1, scale)]}
        cornerRadius={10}
      />
      <KText
        x={padding}
        y={Math.max(10, placeholder.height * 0.28)}
        width={Math.max(24, placeholder.width - padding * 2)}
        text={placeholder.label}
        fill={palette.title}
        fontFamily="Pretendard, sans-serif"
        fontStyle="bold"
        fontSize={Math.min(18, Math.max(11, placeholder.width / 18))}
        align="center"
      />
      {placeholder.message ? (
        <KText
          x={padding}
          y={Math.max(32, placeholder.height * 0.54)}
          width={Math.max(24, placeholder.width - padding * 2)}
          height={Math.max(18, placeholder.height * 0.32)}
          text={placeholder.message}
          fill={palette.detail}
          fontFamily="Pretendard, sans-serif"
          fontSize={Math.min(13, Math.max(9, placeholder.width / 24))}
          align="center"
          ellipsis
          wrap="word"
        />
      ) : null}
    </Group>
  );
}

function coverFitRect(containerW: number, containerH: number, imageW: number, imageH: number) {
  if (imageW <= 0 || imageH <= 0) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }
  const scale = Math.max(containerW / imageW, containerH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return {
    x: (containerW - width) / 2,
    y: (containerH - height) / 2,
    width,
    height,
  };
}

export function StudioFramePanel({
  el,
  theme,
  draggable,
  innerRef,
  onSelect,
  onChange,
  dragBoundFunc,
  onInteractionBegin,
  onInteractionEnd,
}: {
  el: FrameEl;
  theme: "classic" | "soft" | "vivid";
  draggable: boolean;
  innerRef: (n: Konva.Node | null) => void;
  onSelect: () => void;
  onChange: (patch: Partial<FrameEl>) => void;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!el.bg) {
      setImg(null);
      return;
    }
    let alive = true;
    const im = new globalThis.Image();
    im.onload = () => {
      if (alive) setImg(im);
    };
    im.onerror = () => {
      if (alive) setImg(null);
    };
    im.src = el.bg;
    return () => {
      alive = false;
      im.onload = null;
      im.onerror = null;
    };
  }, [el.bg]);

  let fStroke = el.stroke ?? "#16100c";
  let fStrokeW = el.strokeWidth ?? 3;
  let fRadius = 4;
  let fShadowColor = undefined;
  let fShadowBlur = 0;
  let fShadowOpacity = 0;
  let fShadowOffset = undefined;

  if (theme === "soft") {
    fStroke = el.stroke ?? "#222222";
    fStrokeW = el.strokeWidth ?? 1.8;
    fRadius = 0;
  } else if (theme === "vivid") {
    fStroke = el.stroke ?? "#3a3a3a";
    fStrokeW = el.strokeWidth ?? 1.2;
    fRadius = 6;
    fShadowColor = "black";
    fShadowBlur = 5;
    fShadowOpacity = 0.08;
    fShadowOffset = { x: 1, y: 2 };
  }

  const fit = img ? coverFitRect(el.width, el.height, img.naturalWidth || img.width, img.naturalHeight || img.height) : null;
  const borderInset = fStrokeW / 2;
  // 사선/비정형 패널: 쿼드(8수) 폴리곤이면 폴리곤 클립·채움·테두리로 그린다.
  const poly = el.points && el.points.length >= 6 ? el.points : null;
  const clipProps = poly
    ? {
        clipFunc: (ctx: Konva.Context) => {
          ctx.beginPath();
          ctx.moveTo(poly[0], poly[1]);
          for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
          ctx.closePath();
        },
      }
    : { clipX: 0, clipY: 0, clipWidth: el.width, clipHeight: el.height };

  return (
    <Group
      studioElementId={el.id}
      ref={innerRef}
      x={el.x}
      y={el.y}
      {...clipProps}
      draggable={draggable}
      dragBoundFunc={dragBoundFunc}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={(e) => {
        if (onInteractionBegin && !onInteractionBegin()) e.target.stopDrag();
      }}
      onTransformStart={(e) => {
        if (onInteractionBegin && !onInteractionBegin()) {
          const node = e.target as Konva.Node & { stopDrag?: () => void };
          node.stopDrag?.();
        }
      }}
      onDragEnd={(e) => {
        try {
          onChange({ x: e.target.x(), y: e.target.y() });
        } finally {
          onInteractionEnd?.();
        }
      }}
      onTransformEnd={(e) => {
        try {
          const node = e.target as Konva.Group;
          const sx = node.scaleX();
          const sy = node.scaleY();
          const w = Math.max(40, el.width * sx);
          const h = Math.max(40, el.height * sy);
          node.scaleX(1);
          node.scaleY(1);
          // 폴리곤도 같은 비율로 스케일해 형태 유지.
          const patch: Partial<FrameEl> = { x: node.x(), y: node.y(), width: w, height: h };
          if (poly) patch.points = poly.map((v, i) => v * (i % 2 === 0 ? sx : sy));
          onChange(patch);
        } finally {
          onInteractionEnd?.();
        }
      }}
    >
      {poly ? (
        <Line points={poly} closed fill={el.bgColor ?? "#ffffff"} />
      ) : (
        <Rect width={el.width} height={el.height} fill={el.bgColor ?? "#ffffff"} />
      )}
      {img && fit ? (
        <KImage
          image={img}
          x={fit.x}
          y={fit.y}
          width={fit.width}
          height={fit.height}
        />
      ) : null}
      {fStrokeW > 0 &&
        (poly ? (
          <Line
            points={poly}
            closed
            stroke={fStroke}
            strokeWidth={fStrokeW}
            shadowColor={fShadowColor}
            shadowBlur={fShadowBlur}
            shadowOpacity={fShadowOpacity}
            shadowOffset={fShadowOffset}
            dash={el.dashStyle === "dashed" ? [10, 5] : undefined}
          />
        ) : (
          <Rect
            x={borderInset}
            y={borderInset}
            width={Math.max(0, el.width - fStrokeW)}
            height={Math.max(0, el.height - fStrokeW)}
            stroke={fStroke}
            strokeWidth={fStrokeW}
            cornerRadius={Math.max(0, fRadius - borderInset)}
            shadowColor={fShadowColor}
            shadowBlur={fShadowBlur}
            shadowOpacity={fShadowOpacity}
            shadowOffset={fShadowOffset}
            dash={el.dashStyle === "dashed" ? [10, 5] : undefined}
          />
        ))}
    </Group>
  );
}

export function StudioFocusLinesNode({
  el,
  draggable,
  innerRef,
  onSelect,
  onChange,
  dragBoundFunc,
  onInteractionBegin,
  onInteractionEnd,
}: {
  el: FocusLinesEl;
  draggable: boolean;
  innerRef: (n: Konva.Node | null) => void;
  onSelect: () => void;
  onChange: (patch: Partial<FocusLinesEl>) => void;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}) {
  return (
    <Shape
      studioElementId={el.id}
      ref={innerRef}
      sceneFunc={(context, shape) => {
        context.beginPath();
        for (const segment of planStudioFocusLineSegments(el)) {
          context.moveTo(segment.x1, segment.y1);
          context.lineTo(segment.x2, segment.y2);
        }
        context.fillStrokeShape(shape);
      }}
      hitFunc={(context, shape) => {
        // 가는 선이라 빈 곳 클릭이 안 잡히는 문제 해결 — 전체 박스를 클릭 영역으로.
        context.beginPath();
        context.rect(0, 0, el.width, el.height);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      stroke={el.stroke ?? STUDIO_FOCUS_LINE_DEFAULTS.stroke}
      strokeWidth={el.strokeWidth ?? STUDIO_FOCUS_LINE_DEFAULTS.strokeWidth}
      rotation={el.rotation ?? 0}
      opacity={el.opacity ?? 1}
      {...resizableNodeProps<Partial<FocusLinesEl>>({
        draggable,
        dragBoundFunc,
        onSelect,
        onChange,
        onInteractionBegin,
        onInteractionEnd,
      })}
    />
  );
}

export function StudioSpeedLinesNode({
  el,
  draggable,
  innerRef,
  onSelect,
  onChange,
  dragBoundFunc,
  onInteractionBegin,
  onInteractionEnd,
}: {
  el: SpeedLinesEl;
  draggable: boolean;
  innerRef: (n: Konva.Node | null) => void;
  onSelect: () => void;
  onChange: (patch: Partial<SpeedLinesEl>) => void;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}) {
  return (
    <Shape
      studioElementId={el.id}
      ref={innerRef}
      sceneFunc={(context, shape) => {
        context.beginPath();
        for (const segment of planStudioSpeedLineSegments(el)) {
          context.moveTo(segment.x1, segment.y1);
          context.lineTo(segment.x2, segment.y2);
        }
        context.fillStrokeShape(shape);
      }}
      hitFunc={(context, shape) => {
        // 가는 선이라 빈 곳 클릭이 안 잡히는 문제 해결 — 전체 박스를 클릭 영역으로.
        context.beginPath();
        context.rect(0, 0, el.width, el.height);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      stroke={el.stroke ?? STUDIO_SPEED_LINE_DEFAULTS.stroke}
      strokeWidth={el.strokeWidth ?? STUDIO_SPEED_LINE_DEFAULTS.strokeWidth}
      rotation={el.rotation ?? 0}
      opacity={el.opacity ?? 1}
      {...resizableNodeProps<Partial<SpeedLinesEl>>({
        draggable,
        dragBoundFunc,
        onSelect,
        onChange,
        onInteractionBegin,
        onInteractionEnd,
      })}
    />
  );
}
