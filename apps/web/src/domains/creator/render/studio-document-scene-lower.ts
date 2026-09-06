import {
  polylineToPath,
  type ColorIR,
  type PathIR,
  type RenderNodeIR,
  type RenderSceneIR,
  type SceneNodeIR,
} from "@toonspectrum/studio-project-model";

import { drawBounds } from "../brush/studio-draw-rendering";
import {
  effectiveCornerRadius,
  lineArrowHeadGeoms,
  normalizeShapeParams,
  normalizeStrokeStyle,
  polygonPathPointsInBounds,
  starPathPoints,
  type StrokeLineCap,
} from "../brush/studio-stroke-shapes";
import { containingPanel } from "../studio-element-geometry";

import {
  placeStudioLineSegment,
  planStudioFocusLineSegments,
  planStudioSpeedLineSegments,
  STUDIO_FOCUS_LINE_DEFAULTS,
  STUDIO_SPEED_LINE_DEFAULTS,
  type StudioLineSegment,
} from "./studio-radial-line-geometry";

import type { DrawEl, El } from "../studio-element-model";

/**
 * Lower the product element model into a V13 RenderSceneIR.
 *
 * Vello owns path-heavy vector chrome plus a deliberately narrow set of clean
 * geometric DrawEl shapes. Freehand/media brushes and styled shape variants
 * stay on the explicit legacy renderer boundary — flattening them would erase
 * pressure, wash, pattern, sketch, dash, mask, or blend semantics.
 */

export interface StudioDocumentLowerOptions {
  readonly width: number;
  readonly height: number;
  readonly background?: ColorIR;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function parseSupportedCssColorToIR(value: string | undefined): ColorIR | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : null;
  if (hex && /^[0-9a-fA-F]+$/u.test(hex)) {
    const digit = (index: number): number => Number.parseInt(hex[index] ?? "0", 16);
    const pair = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16);
    if (hex.length === 3) {
      return { r: (digit(0) * 17) / 255, g: (digit(1) * 17) / 255, b: (digit(2) * 17) / 255, a: 1 };
    }
    if (hex.length === 6) {
      return { r: pair(0) / 255, g: pair(2) / 255, b: pair(4) / 255, a: 1 };
    }
    if (hex.length === 8) {
      return { r: pair(0) / 255, g: pair(2) / 255, b: pair(4) / 255, a: pair(6) / 255 };
    }
  }
  const rgb = trimmed.match(/^rgba?\((.+)\)$/u);
  if (rgb?.[1]) {
    // Percentage channels need CSS Color parsing semantics (including a percentage alpha).
    // Treat them as unsupported until the shared color parser can preserve those semantics;
    // Number("50%") would otherwise silently turn a valid authored color into the wrong pixels.
    if (rgb[1].includes("%")) return null;
    const parts = rgb[1].split(/[\s,/]+/u).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      return {
        r: clamp01(parts[0]! / 255),
        g: clamp01(parts[1]! / 255),
        b: clamp01(parts[2]! / 255),
        a: parts[3] === undefined ? 1 : clamp01(parts[3]),
      };
    }
  }
  return null;
}

export function parseCssColorToIR(value: string | undefined, fallback: ColorIR): ColorIR {
  return parseSupportedCssColorToIR(value) ?? fallback;
}

function pairs(points: readonly number[]): Array<readonly [number, number]> {
  const result: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    result.push([points[index]!, points[index + 1]!]);
  }
  return result;
}

function rectPath(x: number, y: number, width: number, height: number) {
  return polylineToPath(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    true,
  );
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): PathIR {
  const safeWidth = Math.max(0.1, Math.abs(width));
  const safeHeight = Math.max(0.1, Math.abs(height));
  const r = effectiveCornerRadius(safeWidth, safeHeight, radius);
  if (r <= 0) return rectPath(x, y, safeWidth, safeHeight);
  const right = x + safeWidth;
  const bottom = y + safeHeight;
  const kappa = 0.5522847498307936;
  const control = r * kappa;
  return {
    verbs: [
      { v: "M", x: x + r, y },
      { v: "L", x: right - r, y },
      { v: "C", c1x: right - r + control, c1y: y, c2x: right, c2y: y + r - control, x: right, y: y + r },
      { v: "L", x: right, y: bottom - r },
      { v: "C", c1x: right, c1y: bottom - r + control, c2x: right - r + control, c2y: bottom, x: right - r, y: bottom },
      { v: "L", x: x + r, y: bottom },
      { v: "C", c1x: x + r - control, c1y: bottom, c2x: x, c2y: bottom - r + control, x, y: bottom - r },
      { v: "L", x, y: y + r },
      { v: "C", c1x: x, c1y: y + r - control, c2x: x + r - control, c2y: y, x: x + r, y },
      { v: "Z" },
    ],
  };
}

function ellipsePath(x: number, y: number, width: number, height: number): PathIR {
  const safeWidth = Math.max(0.1, Math.abs(width));
  const safeHeight = Math.max(0.1, Math.abs(height));
  const cx = x + safeWidth / 2;
  const cy = y + safeHeight / 2;
  const rx = safeWidth / 2;
  const ry = safeHeight / 2;
  const kappa = 0.5522847498307936;
  return {
    verbs: [
      { v: "M", x: cx, y: cy - ry },
      { v: "C", c1x: cx + rx * kappa, c1y: cy - ry, c2x: cx + rx, c2y: cy - ry * kappa, x: cx + rx, y: cy },
      { v: "C", c1x: cx + rx, c1y: cy + ry * kappa, c2x: cx + rx * kappa, c2y: cy + ry, x: cx, y: cy + ry },
      { v: "C", c1x: cx - rx * kappa, c1y: cy + ry, c2x: cx - rx, c2y: cy + ry * kappa, x: cx - rx, y: cy },
      { v: "C", c1x: cx - rx, c1y: cy - ry * kappa, c2x: cx - rx * kappa, c2y: cy - ry, x: cx, y: cy - ry },
      { v: "Z" },
    ],
  };
}

function flatPointsPath(points: readonly number[], closed = false): PathIR {
  return polylineToPath(pairs(points), closed);
}

function fillNode(
  id: string,
  path: PathIR,
  color: ColorIR,
  opacity: number,
): SceneNodeIR {
  return {
    id,
    kind: "fill-path",
    path,
    paint: { kind: "solid", color },
    fillRule: "nonzero",
    opacity,
    blend: "src-over",
  };
}

function strokeNode(
  id: string,
  path: PathIR,
  color: ColorIR,
  width: number,
  opacity: number,
  cap: StrokeLineCap = "round",
  join: "round" | "miter" | "bevel" = "round",
): SceneNodeIR {
  return {
    id,
    kind: "stroke-path",
    path,
    paint: { kind: "solid", color },
    strokeWidth: Math.max(0.5, width),
    cap,
    join,
    miterLimit: 4,
    opacity,
    blend: "src-over",
  };
}

const STUDIO_VELLO_GEOMETRIC_DRAW_KINDS = new Set<NonNullable<DrawEl["kind"]>>([
  "line",
  "rect",
  "ellipse",
  "triangle",
  "polygon",
  "star",
  "arrow",
]);

function hasFiniteShapePoints(points: readonly number[]): boolean {
  return points.length >= 4
    && points.length % 2 === 0
    && points.every((value) => Number.isFinite(value));
}

function hasDrawableSegment(points: readonly number[]): boolean {
  for (let index = 2; index + 1 < points.length; index += 2) {
    if (points[index] !== points[index - 2] || points[index + 1] !== points[index - 1]) {
      return true;
    }
  }
  return false;
}

function hasDrawableFinalSegment(points: readonly number[]): boolean {
  const end = points.length - 2;
  return end >= 2
    && (points[end] !== points[end - 2] || points[end + 1] !== points[end - 1]);
}

/**
 * Fail-closed admission for the first product DrawEl slice. The admitted
 * shapes use only geometry and solid src-over paint that PathIR can preserve.
 */
export function isStudioVelloDocumentGeometricDrawElement(
  element: El,
): element is DrawEl & El {
  if (element.type !== "draw") return false;
  const kind = element.kind;
  if (!kind || !STUDIO_VELLO_GEOMETRIC_DRAW_KINDS.has(kind)) return false;
  if (element.mode === "eraser" || !hasFiniteShapePoints(element.points)) return false;
  if ((kind === "line" || kind === "arrow") && !hasDrawableSegment(element.points)) return false;
  if (kind === "arrow" && !hasDrawableFinalSegment(element.points)) return false;
  if (!Number.isFinite(element.strokeWidth) || element.strokeWidth <= 0) return false;
  if (element.opacity !== undefined && !Number.isFinite(element.opacity)) return false;
  if (element.gradient || element.pattern || element.sketch?.enabled === true) return false;
  if (element.symmetry && element.symmetry.type !== "none") return false;
  if (element.paintModel !== undefined) return false;
  if (element.maskEnabled || element.maskSrc || element.clipBelow || element.alphaLocked) return false;
  if (element.blendMode && element.blendMode !== "source-over") return false;

  const style = normalizeStrokeStyle(element.strokeStyle);
  if (style.dash !== "solid") return false;
  const stroke = parseSupportedCssColorToIR(element.stroke);
  if (!stroke) return false;
  const fill = element.fill ? parseSupportedCssColorToIR(element.fill) : null;
  if (element.fill && !fill) return false;
  if (kind === "line" || kind === "arrow") return stroke.a > 0;
  return stroke.a > 0 || (fill?.a ?? 0) > 0;
}

function geometricDrawNodes(element: DrawEl & El, opacity: number): RenderNodeIR[] {
  const kind = element.kind!;
  const style = normalizeStrokeStyle(element.strokeStyle);
  const shape = normalizeShapeParams(element.shapeParams);
  const strokeWidth = Math.max(1, element.strokeWidth);
  const stroke = parseSupportedCssColorToIR(element.stroke)!;
  const fill = element.fill ? parseSupportedCssColorToIR(element.fill) : null;
  const box = drawBounds(element.points);
  let path: PathIR;

  if (kind === "rect") {
    path = roundedRectPath(box.x, box.y, box.width, box.height, shape.cornerRadius);
  } else if (kind === "ellipse") {
    path = ellipsePath(box.x, box.y, box.width, box.height);
  } else if (kind === "star") {
    const size = Math.max(0.1, Math.min(box.width, box.height));
    path = flatPointsPath(starPathPoints(
      box.x + box.width / 2,
      box.y + box.height / 2,
      size / 2,
      shape,
    ), true);
  } else if (kind === "triangle" || kind === "polygon") {
    path = flatPointsPath(polygonPathPointsInBounds(
      box.x,
      box.y,
      box.width,
      box.height,
      kind === "triangle" ? 3 : shape.polygonSides,
    ), true);
  } else {
    path = flatPointsPath(element.points);
  }

  const nodes: RenderNodeIR[] = [];
  if (kind !== "line" && kind !== "arrow" && fill && fill.a > 0) {
    nodes.push(fillNode(`${element.id}:fill`, path, fill, opacity));
  }
  if (stroke.a > 0) {
    nodes.push(strokeNode(
      `${element.id}:stroke`,
      path,
      stroke,
      strokeWidth,
      opacity,
      style.lineCap,
      kind === "arrow" ? "miter" : "round",
    ));
  }

  if (kind === "line") {
    for (const [index, head] of lineArrowHeadGeoms(element.points, style, strokeWidth).entries()) {
      const headPath = head.kind === "dot"
        ? ellipsePath(head.cx - head.r, head.cy - head.r, head.r * 2, head.r * 2)
        : flatPointsPath(head.points, true);
      nodes.push(fillNode(`${element.id}:head-${index}`, headPath, stroke, opacity));
    }
  } else if (kind === "arrow" && element.points.length >= 4) {
    const end = element.points.length - 2;
    const x = element.points[end]!;
    const y = element.points[end + 1]!;
    const previousX = element.points[end - 2]!;
    const previousY = element.points[end - 1]!;
    const angle = Math.atan2(y - previousY, x - previousX);
    const pointer = Math.max(8, strokeWidth * 2);
    const baseX = x - pointer * Math.cos(angle);
    const baseY = y - pointer * Math.sin(angle);
    const perpendicularX = (pointer / 2) * Math.cos(angle + Math.PI / 2);
    const perpendicularY = (pointer / 2) * Math.sin(angle + Math.PI / 2);
    const headPath = flatPointsPath([
      x,
      y,
      baseX + perpendicularX,
      baseY + perpendicularY,
      baseX - perpendicularX,
      baseY - perpendicularY,
    ], true);
    nodes.push(fillNode(`${element.id}:head-fill`, headPath, stroke, opacity));
    nodes.push(strokeNode(
      `${element.id}:head-stroke`,
      headPath,
      stroke,
      strokeWidth,
      opacity,
      style.lineCap,
      "miter",
    ));
  }
  return nodes;
}

/**
 * True when the element is authored as a Vello-safe vector island.
 * Brush strokes, images, and lettering stay with Konva / raster providers.
 */
export function isStudioVelloDocumentRadialLineElement(element: El): boolean {
  if (element.type !== "focusLines" && element.type !== "speedLines") return false;
  const numbers = [
    element.x,
    element.y,
    element.width,
    element.height,
    element.lineCount,
    element.strokeWidth,
    element.rotation,
    element.opacity ?? 1,
    ...(element.type === "focusLines"
      ? [
          element.innerRadius,
          element.outerRadius,
          element.noise,
          element.centerXRatio ?? STUDIO_FOCUS_LINE_DEFAULTS.centerXRatio,
          element.centerYRatio ?? STUDIO_FOCUS_LINE_DEFAULTS.centerYRatio,
        ]
      : [element.noise ?? 0]),
  ];
  if (
    numbers.some((value) => !Number.isFinite(value))
    || element.width <= 0
    || element.height <= 0
    || element.lineCount < 0
    || element.strokeWidth <= 0
  ) return false;
  if (!parseSupportedCssColorToIR(
    element.stroke
      ?? (element.type === "focusLines"
        ? STUDIO_FOCUS_LINE_DEFAULTS.stroke
        : STUDIO_SPEED_LINE_DEFAULTS.stroke),
  )) return false;
  if (element.blendMode && element.blendMode !== "source-over") return false;
  if (element.maskEnabled || element.maskSrc || element.clipBelow || element.alphaLocked) {
    return false;
  }
  return true;
}

export function isStudioVelloDocumentVectorElement(element: El): boolean {
  return isStudioVelloDocumentRadialLineElement(element)
    || isStudioVelloDocumentGeometricDrawElement(element);
}

/**
 * Hide the Konva document layer only when every visible painted object is a
 * Vello vector island. A single brush/image/text object keeps Konva visible.
 */
export function studioDocumentAllowsKonvaHide(
  elements: readonly El[],
  ownedDocumentIds: readonly string[],
): boolean {
  if (ownedDocumentIds.length === 0) return false;
  const owned = new Set(ownedDocumentIds);
  for (const element of elements) {
    if (element.hidden || (element.opacity ?? 1) <= 0) continue;
    if (!isStudioVelloDocumentVectorElement(element)) return false;
    // Konva clips non-frame vector content whose centre belongs to a frame.
    // This first Vello slice intentionally has no clip stack, so such pages
    // remain legacy regardless of which supported vector kind is inside.
    if (
      element.type !== "frame"
      && isStudioVelloDocumentVectorElement(element)
      && containingPanel(element, elements)
    ) return false;
    if (isStudioVelloDocumentVectorElement(element) && !owned.has(element.id)) {
      return false;
    }
  }
  return true;
}

/**
 * Element-local line segments → placed stroke nodes.
 *
 * Placement uses the Konva node transform (`translate(x, y) · rotate`), so the
 * pivot is the node ORIGIN. The previous lowering rotated focus rays about the
 * pattern centre and ignored speed-line rotation entirely.
 */
function lineSegmentNodes(
  element: {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly rotation: number;
    readonly stroke?: string;
    readonly strokeWidth?: number;
  },
  segments: readonly StudioLineSegment[],
  fallbackStrokeWidth: number,
  fallbackStroke: string,
  opacity: number,
): RenderNodeIR[] {
  const color = parseSupportedCssColorToIR(element.stroke ?? fallbackStroke);
  if (!color) return [];
  const placement = { x: element.x, y: element.y, rotationDeg: element.rotation };
  const width = element.strokeWidth ?? fallbackStrokeWidth;
  return segments.map((segment, index) => {
    const placed = placeStudioLineSegment(segment, placement);
    return strokeNode(
      `${element.id}:${index}`,
      polylineToPath([[placed.x1, placed.y1], [placed.x2, placed.y2]]),
      color,
      width,
      opacity,
      "butt",
    );
  });
}

function lowerElement(element: El): RenderNodeIR[] {
  if (element.hidden) return [];
  const opacity = clamp01(element.opacity ?? 1);
  if (opacity <= 0) return [];

  switch (element.type) {
    case "frame": {
      const path = element.points && element.points.length >= 6
        ? polylineToPath(pairs(element.points).map(([x, y]) => [element.x + x, element.y + y]), true)
        : rectPath(element.x, element.y, element.width, element.height);
      const nodes: RenderNodeIR[] = [];
      const fill = parseCssColorToIR(element.bgColor ?? element.bg, { r: 1, g: 1, b: 1, a: 1 });
      if (fill.a > 0) nodes.push(fillNode(`${element.id}:fill`, path, fill, opacity));
      const stroke = parseCssColorToIR(element.stroke, { r: 0, g: 0, b: 0, a: 0 });
      if (stroke.a > 0 && (element.strokeWidth ?? 0) > 0) {
        nodes.push(strokeNode(`${element.id}:stroke`, path, stroke, element.strokeWidth ?? 2, opacity));
      }
      return nodes;
    }
    case "draw":
      return isStudioVelloDocumentGeometricDrawElement(element)
        ? geometricDrawNodes(element, opacity)
        : [];
    // Focus/speed lines share ONE planner with the Konva nodes, the SVG
    // exporter, and page thumbnails. Do not reimplement the geometry here — a
    // GPU-vs-CPU pixel gate cannot see a geometry divergence, because both
    // Vello lanes would render the same wrong artwork in perfect agreement.
    case "focusLines":
      return lineSegmentNodes(
        element,
        planStudioFocusLineSegments(element),
        STUDIO_FOCUS_LINE_DEFAULTS.strokeWidth,
        STUDIO_FOCUS_LINE_DEFAULTS.stroke,
        opacity,
      );
    case "speedLines":
      return lineSegmentNodes(
        element,
        planStudioSpeedLineSegments(element),
        STUDIO_SPEED_LINE_DEFAULTS.strokeWidth,
        STUDIO_SPEED_LINE_DEFAULTS.stroke,
        opacity,
      );
    case "text":
    case "sticker":
      return [{
        id: element.id,
        kind: "text",
        x: element.x,
        y: element.y + (element.type === "text" ? element.fontSize : element.fontSize),
        text: element.text,
        fontSizePx: element.fontSize,
        color: parseCssColorToIR(
          element.type === "text" ? element.fill : "#111111",
          { r: 0.1, g: 0.1, b: 0.1, a: 1 },
        ),
        fontFamily: element.type === "text" ? (element.font ?? "sans-serif") : "sans-serif",
        opacity,
        blend: "src-over",
      }];
    case "bubble": {
      const path = element.customShapePoints && element.customShapePoints.length >= 6
        ? polylineToPath(
          pairs(element.customShapePoints).map(([x, y]) => [element.x + x, element.y + y]),
          true,
        )
        : rectPath(element.x, element.y, element.width, element.height);
      const nodes: RenderNodeIR[] = [
        fillNode(
          `${element.id}:fill`,
          path,
          parseCssColorToIR(element.fill, { r: 1, g: 1, b: 1, a: 1 }),
          opacity,
        ),
      ];
      const stroke = parseCssColorToIR(element.stroke, { r: 0, g: 0, b: 0, a: 1 });
      if ((element.strokeWidth ?? 2) > 0) {
        nodes.push(strokeNode(
          `${element.id}:stroke`,
          path,
          stroke,
          element.strokeWidth ?? 2,
          opacity,
        ));
      }
      if (element.text.trim().length > 0) {
        nodes.push({
          id: `${element.id}:text`,
          kind: "text",
          x: element.x + 12,
          y: element.y + (element.fontSize ?? 24),
          text: element.text,
          fontSizePx: element.fontSize ?? 24,
          color: parseCssColorToIR(element.textFill, { r: 0.1, g: 0.1, b: 0.1, a: 1 }),
          fontFamily: element.font ?? "sans-serif",
          opacity,
          blend: "src-over",
        });
      }
      return nodes;
    }
    case "image": {
      const hasFilter = Boolean(
        element.blur
        || element.smartFilters?.entries.length
        || element.filterMaskSrc
        || element.lensBlur
        || element.lineart
        || element.screentone,
      );
      const image: RenderNodeIR = {
        id: element.id,
        kind: "image",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        src: element.src,
        opacity,
        blend: "src-over",
        rotationDeg: element.rotation,
        flipX: Boolean(element.flipped),
        flipY: Boolean(element.flippedY),
      };
      if (!hasFilter) return [image];
      return [{
        id: `${element.id}:filter`,
        kind: "filter-group",
        opacity,
        blend: "src-over",
        graph: {
          nodes: [{ id: "fx", op: "core.image-filter", params: {}, inputs: ["source"], colorSpace: "srgb" }],
          output: "fx",
        },
        children: [image],
      }];
    }
    default:
      return [];
  }
}

export function lowerStudioElementsToRenderScene(
  elements: readonly El[],
  options: StudioDocumentLowerOptions,
): RenderSceneIR {
  const nodes: RenderNodeIR[] = [];
  for (const element of elements) {
    nodes.push(...lowerElement(element));
  }
  return {
    version: 13,
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
    background: options.background ?? { r: 0, g: 0, b: 0, a: 0 },
    nodes,
  };
}

export function documentIdsOwnedByVectorIslands(scene: RenderSceneIR): string[] {
  const ids: string[] = [];
  for (const node of scene.nodes) {
    if (node.kind === "fill-path" || node.kind === "stroke-path") {
      ids.push(node.id.split(":")[0] ?? node.id);
    }
  }
  return [...new Set(ids)];
}
