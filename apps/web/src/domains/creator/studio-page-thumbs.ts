/**
 * Studio Page Thumbs — 페이지 스트립 "실내용" 썸네일 프록시 + 드래그 재배열 슬롯 계산.
 *
 * 캔버스(KonvaLike) 렌더 파이프라인을 페이지마다 통째로 돌리는 대신, 각 요소를
 * 경량 SVG 프리미티브 스펙(ThumbNode)으로 축약해 PPT 사이드바식 미리보기를 만든다.
 * 근사 프록시임을 전제로 한 트레이드오프:
 *  - 요소 수 상한(maxNodes) + 프리핸드 포인트 다운샘플로 비용 상한을 보장한다.
 *  - 지우개 스트로크/픽셀 필터/패널 클리핑 등 래스터 전용 효과는 생략하거나 CSS로 근사한다.
 *  - 말풍선 외형은 실제 캔버스와 동일한 studio-bubble-path 를 재사용해 근사도를 높인다.
 *
 * 전부 순수 · 결정적 · 부수효과 없음. React/DOM/Konva 의존 없음.
 * 실제 순서 변경은 studio-pages.reorderPages 가 담당하고, 여기는 슬롯 산술만 제공한다.
 */

import {
  bubblePathData,
  burstStarPathData,
  doubleBubblePathData,
  heartBubblePathData,
  scaredBubblePathData,
  thoughtBubbleBodyPath,
  type BubbleTailDirection,
  type BubbleTailSpec,
} from "./lettering/studio-bubble-path";
import {
  planStudioFocusLineSegments,
  planStudioSpeedLineSegments,
  studioSeededRandom,
  STUDIO_FOCUS_LINE_DEFAULTS,
  STUDIO_SPEED_LINE_DEFAULTS,
  type StudioLineSegment,
} from "./render/studio-radial-line-geometry";
import { isEffectivelyHidden, type LayerGroup } from "./studio-layers";

// ── 입력 — 느슨한 구조 타입(StudioPage 의 El/PageState 가 그대로 대입 가능) ────────────

export interface ThumbElement {
  id: string;
  type: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  opacity?: number;
  rotation?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // image
  src?: string;
  flipped?: boolean;
  flippedY?: boolean;
  grayscale?: boolean;
  sepia?: boolean;
  invert?: boolean;
  // text · sticker · bubble 공통 타이포
  text?: string;
  fontSize?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  font?: string;
  fontStyle?: string;
  align?: string;
  lineHeight?: number;
  fillType?: string;
  gradientColorStart?: string;
  // bubble
  variant?: string;
  textFill?: string;
  tail?: string;
  tailDirection?: string;
  tailXRatio?: number;
  tailHeight?: number;
  tailBase?: number;
  tailBend?: number;
  // frame
  bg?: string;
  bgColor?: string;
  dashStyle?: string;
  points?: number[];
  // draw
  kind?: string;
  mode?: string;
  // focusLines · speedLines
  lineCount?: number;
  innerRadius?: number;
  outerRadius?: number;
  /** 집중선 반지름 흔들림. 예전 썸네일은 이 필드를 아예 읽지 않아 캔버스와 그림이 달랐다. */
  noise?: number;
  direction?: string;
  centerXRatio?: number;
  centerYRatio?: number;
}

export interface ThumbPageLike {
  id: string;
  elements: ThumbElement[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  grade?: unknown;
  groups?: LayerGroup[];
}

// ── 출력 — SVG 프리미티브 스펙(컴포넌트가 그대로 <svg> 자식으로 그린다) ─────────────────

export type ThumbNode =
  | {
      kind: "rect";
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
      rx: number;
      fill: string | null;
      fillOpacity: number;
      stroke: string | null;
      strokeWidth: number;
      dashed: boolean;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "ellipse";
      key: string;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "polygon";
      key: string;
      points: string;
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "polyline";
      key: string;
      points: string;
      stroke: string;
      strokeWidth: number;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "path";
      key: string;
      d: string;
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      dashed: boolean;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "image";
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
      src: string;
      cover: boolean; // true=커버핏 크롭(패널 배경), false=늘려 채움(캔버스 이미지와 동일)
      filterCss: string | null;
      transform: string | null;
      opacity: number;
    }
  | {
      kind: "text";
      key: string;
      x: number;
      y: number; // 첫 줄 베이스라인
      lines: string[];
      lineStep: number;
      fontSize: number;
      font: string;
      bold: boolean;
      anchor: "start" | "middle" | "end";
      fill: string;
      stroke: string | null;
      strokeWidth: number;
      transform: string | null;
      opacity: number;
    };

export interface ThumbBuildOptions {
  /** 페이지당 렌더할 SVG 노드 상한(초과 요소는 생략하고 개수만 보고). */
  maxNodes?: number;
  /** 축소 후에도 획이 보이도록 캔버스 좌표 기준 최소 획 두께. */
  minStroke?: number;
  /** 텍스트 요소당 최대 표시 줄 수. */
  maxTextLines?: number;
  /** 한 줄 최대 글자 수(초과 시 말줄임). */
  maxLineChars?: number;
}

export interface ThumbBuildResult {
  nodes: ThumbNode[];
  /** 노드 상한 때문에 생략된(보이는) 요소 수 — "+N" 배지용. */
  skipped: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── SVG 기하 유틸(순수) ─────────────────────────────────────────────────────────────

/** 획 두께 하한 클램프 — 0 이하(획 없음)는 그대로 0. */
export function clampThumbStroke(width: number, minStroke: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(width, minStroke);
}

/** 줄 수·줄 길이 클램프(초과분 말줄임 "…"). 썸네일 텍스트 비용 상한. */
export function clampThumbTextLines(text: string, maxLines: number, maxChars: number): string[] {
  return text
    .split("\n")
    .slice(0, Math.max(1, maxLines))
    .map((line) => (line.length > maxChars ? `${line.slice(0, Math.max(0, maxChars - 1))}…` : line));
}

/** [x,y,...] 플랫 배열을 균등 간격으로 최대 maxPoints 개로 줄인다(양 끝점 보존). */
export function downsamplePoints(points: number[], maxPoints = 24): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= maxPoints) return points.slice(0, n * 2);
  const out: number[] = [];
  const step = (n - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step) * 2;
    out.push(points[idx] ?? 0, points[idx + 1] ?? 0);
  }
  return out;
}

/** [x,y,...] → SVG points 속성 문자열("x,y x,y"). */
export function pointsToSvg(points: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    parts.push(`${round2(points[i] ?? 0)},${round2(points[i + 1] ?? 0)}`);
  }
  return parts.join(" ");
}

/** [x,y,...] 플랫 배열의 바운딩 박스. */
export function flatPointsBounds(points: number[]): { x: number; y: number; w: number; h: number } {
  if (points.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0] ?? 0;
  let minY = points[1] ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Konva Star 와 동일하게 위쪽(-90°)에서 시작하는 별 폴리곤 points. sx/sy 로 비율 스케일. */
export function starPolygonPoints(
  cx: number,
  cy: number,
  numPoints: number,
  innerRadius: number,
  outerRadius: number,
  sx = 1,
  sy = 1
): string {
  const parts: string[] = [];
  for (let i = 0; i < numPoints * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (Math.PI * i) / numPoints;
    parts.push(`${round2(cx + Math.cos(angle) * r * sx)},${round2(cy + Math.sin(angle) * r * sy)}`);
  }
  return parts.join(" ");
}

/** Konva RegularPolygon 과 동일하게 위쪽(-90°) 꼭짓점에서 시작하는 정다각형 points. */
export function regularPolygonPoints(cx: number, cy: number, sides: number, radius: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    parts.push(`${round2(cx + Math.cos(angle) * radius)},${round2(cy + Math.sin(angle) * radius)}`);
  }
  return parts.join(" ");
}

/** Konva Group(x,y,rotation) 의미와 동일 — 로컬 좌표계를 (x,y)로 옮기고 원점 기준 회전. */
export function svgLocalTransform(x: number, y: number, rotationDeg: number): string {
  const t = `translate(${round2(x)} ${round2(y)})`;
  return rotationDeg ? `${t} rotate(${round2(rotationDeg)})` : t;
}

/** (cx,cy) 기준 회전. 0/비유한이면 null(속성 생략). */
export function svgRotateAround(rotationDeg: number, cx: number, cy: number): string | null {
  if (!rotationDeg || !Number.isFinite(rotationDeg)) return null;
  return `rotate(${round2(rotationDeg)} ${round2(cx)} ${round2(cy)})`;
}

/** 박스 중심(cx,cy) 기준 좌우/상하 반전. 반전 없으면 null. */
export function svgFlipTransform(flipX: boolean, flipY: boolean, cx: number, cy: number): string | null {
  if (!flipX && !flipY) return null;
  const scale = `scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`;
  return `translate(${round2(cx)} ${round2(cy)}) ${scale} translate(${round2(-cx)} ${round2(-cy)})`;
}

/** null 을 걸러 transform 문자열을 합친다(모두 null 이면 null). */
export function joinTransforms(...parts: Array<string | null>): string | null {
  const list = parts.filter((p): p is string => Boolean(p));
  return list.length > 0 ? list.join(" ") : null;
}

/**
 * StudioPage 캔버스와 동일한 시퀀스의 결정적 의사난수(속도선 위치 재현용).
 * 구현 본체는 렌더러 중립 플래너(`render/studio-radial-line-geometry`)로 옮겼다 —
 * 여기는 기존 임포트를 유지하기 위한 재수출.
 */
export const seededRandom = studioSeededRandom;

// ── 요소 → ThumbNode 변환 ────────────────────────────────────────────────────────────

interface ThumbBuildContext {
  minStroke: number;
  maxTextLines: number;
  maxLineChars: number;
}

function frameNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const opacity = el.opacity ?? 1;
  // soft 테마(스튜디오 기본) 기본값 근사 — 사용자 지정이 있으면 그대로.
  const stroke = el.stroke ?? "#222222";
  const strokeWidth = clampThumbStroke(el.strokeWidth ?? 1.8, ctx.minStroke);
  const dashed = el.dashStyle === "dashed";
  const fill = el.bgColor ?? "#ffffff";
  const poly = Array.isArray(el.points) && el.points.length >= 6 ? el.points : null;
  const nodes: ThumbNode[] = [];
  if (poly) {
    // 사선/비정형 패널 — 프레임 로컬 폴리곤을 (x,y) 로 옮겨 그린다.
    nodes.push({
      kind: "polygon",
      key: el.id,
      points: pointsToSvg(poly),
      fill,
      stroke: strokeWidth > 0 ? stroke : null,
      strokeWidth,
      transform: svgLocalTransform(x, y, 0),
      opacity,
    });
  } else if (el.bg) {
    // 채움 → 배경 이미지(커버핏) → 테두리 순서(캔버스 렌더 순서와 동일).
    nodes.push({
      kind: "rect",
      key: el.id,
      x,
      y,
      w,
      h,
      rx: 0,
      fill,
      fillOpacity: 1,
      stroke: null,
      strokeWidth: 0,
      dashed: false,
      transform: null,
      opacity,
    });
  } else {
    nodes.push({
      kind: "rect",
      key: el.id,
      x,
      y,
      w,
      h,
      rx: 0,
      fill,
      fillOpacity: 1,
      stroke: strokeWidth > 0 ? stroke : null,
      strokeWidth,
      dashed,
      transform: null,
      opacity,
    });
    return nodes;
  }
  if (el.bg) {
    nodes.push({
      kind: "image",
      key: `${el.id}-img`,
      x,
      y,
      w,
      h,
      src: el.bg,
      cover: true,
      filterCss: null,
      transform: null,
      opacity,
    });
    if (!poly && strokeWidth > 0) {
      nodes.push({
        kind: "rect",
        key: `${el.id}-border`,
        x,
        y,
        w,
        h,
        rx: 0,
        fill: null,
        fillOpacity: 1,
        stroke,
        strokeWidth,
        dashed,
        transform: null,
        opacity,
      });
    }
  }
  return nodes;
}

function imageNodes(el: ThumbElement): ThumbNode[] {
  if (!el.src) return [];
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  // 픽셀 필터는 CSS 로 재현 가능한 불리언 3종만 근사(나머지 보정은 썸네일 크기에서 식별 불가).
  const filters: string[] = [];
  if (el.grayscale) filters.push("grayscale(1)");
  if (el.sepia) filters.push("sepia(1)");
  if (el.invert) filters.push("invert(1)");
  return [
    {
      kind: "image",
      key: el.id,
      x,
      y,
      w,
      h,
      src: el.src,
      cover: false,
      filterCss: filters.length > 0 ? filters.join(" ") : null,
      transform: joinTransforms(
        svgRotateAround(el.rotation ?? 0, x, y),
        svgFlipTransform(el.flipped === true, el.flippedY === true, x + w / 2, y + h / 2)
      ),
      opacity: el.opacity ?? 1,
    },
  ];
}

function textNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  const lines = clampThumbTextLines(el.text ?? "", ctx.maxTextLines, ctx.maxLineChars);
  if (lines.every((line) => line.trim() === "")) return [];
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const fs = el.fontSize ?? 24;
  const align = el.align ?? "left";
  const anchor: "start" | "middle" | "end" = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const anchorX = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;
  // 그라디언트 텍스트는 시작색 단색 근사(캔버스 TextPath 폴백과 동일한 규칙).
  const fill = el.fillType === "gradient" ? (el.gradientColorStart ?? "#ff3b30") : (el.fill ?? "#111111");
  const strokeWidth = el.stroke ? Math.max(0, el.strokeWidth ?? 0) : 0;
  return [
    {
      kind: "text",
      key: el.id,
      x: round2(anchorX),
      y: round2(y + fs * 0.85),
      lines,
      lineStep: round2(fs * (el.lineHeight ?? 1)),
      fontSize: fs,
      font: el.font ?? "Pretendard, sans-serif",
      bold: (el.fontStyle ?? "bold").includes("bold"),
      anchor,
      fill,
      stroke: strokeWidth > 0 ? (el.stroke ?? null) : null,
      strokeWidth,
      transform: svgRotateAround(el.rotation ?? 0, x, y),
      opacity: el.opacity ?? 1,
    },
  ];
}

function stickerNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  const lines = clampThumbTextLines(el.text ?? "", 1, ctx.maxLineChars);
  if (lines.every((line) => line.trim() === "")) return [];
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const fs = el.fontSize ?? 48;
  return [
    {
      kind: "text",
      key: el.id,
      x: round2(x),
      y: round2(y + fs * 0.85),
      lines,
      lineStep: fs,
      fontSize: fs,
      font: "Pretendard, sans-serif",
      bold: false,
      anchor: "start",
      fill: "#111111",
      stroke: null,
      strokeWidth: 0,
      transform: svgRotateAround(el.rotation ?? 0, x, y),
      opacity: el.opacity ?? 1,
    },
  ];
}

/** 말풍선 꼬리 스펙 — StudioPage 캔버스(soft 테마 기본)의 정규화 규칙을 그대로 따른다. */
export function bubbleTailSpecOf(el: ThumbElement, w: number, h: number): BubbleTailSpec | null {
  const tailSide = el.tail ?? "left";
  if (tailSide === "none") return null;
  const raw = el.tailDirection;
  const direction: BubbleTailDirection = raw === "top" || raw === "left" || raw === "right" ? raw : "bottom";
  const tailIsVertical = direction === "bottom" || direction === "top";
  const ratioBase = el.tailXRatio ?? 0.35;
  const minDim = Math.min(w, h);
  const themeLen = (el.tailHeight ?? 30) - 10; // soft 테마 보정(-10)
  const length = Math.max(minDim * 0.12, Math.min(Math.max(8, themeLen), minDim * 0.3));
  const automaticBase = Math.max(minDim * 0.1, (tailIsVertical ? w : h) * 0.08 * 1.8);
  const base = Math.max(4, Math.min(el.tailBase ?? automaticBase, minDim * 0.62));
  return {
    direction,
    ratio: tailSide === "right" && tailIsVertical ? 1 - ratioBase : ratioBase,
    length,
    base,
    side: "center",
    bend: Math.max(-1, Math.min(el.tailBend ?? 0, 1)),
  };
}

function bubbleNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const opacity = el.opacity ?? 1;
  const local = svgLocalTransform(x, y, el.rotation ?? 0);
  const avg = (w + h) / 2;
  const stroke = el.stroke ?? "#2d2d2d";
  const strokeWidth = clampThumbStroke(el.strokeWidth ?? (avg < 300 ? 1.5 : avg < 500 ? 1.8 : 2), ctx.minStroke);
  const fill = el.fill ?? "#ffffff";
  const variant = el.variant ?? "speech";
  const nodes: ThumbNode[] = [];

  if (variant === "shout" || variant === "angry") {
    const outer = variant === "shout" ? 68 : 64;
    const inner = variant === "shout" ? 36 : 28;
    nodes.push({
      kind: "path",
      key: el.id,
      d: burstStarPathData(w, h, variant === "shout" ? 20 : 22, inner, outer),
      fill,
      stroke: variant === "angry" ? "#dc2626" : stroke,
      strokeWidth,
      dashed: false,
      transform: local,
      opacity,
    });
  } else if (variant === "thought") {
    nodes.push({
      kind: "path",
      key: el.id,
      d: thoughtBubbleBodyPath(w, h),
      fill,
      stroke,
      strokeWidth,
      dashed: false,
      transform: local,
      opacity,
    });
  } else if (variant === "double") {
    nodes.push({
      kind: "path",
      key: el.id,
      d: doubleBubblePathData(w, h, bubbleTailSpecOf(el, w, h)),
      fill,
      stroke,
      strokeWidth,
      dashed: false,
      transform: local,
      opacity,
    });
  } else if (variant === "scared") {
    nodes.push({
      kind: "path",
      key: el.id,
      d: scaredBubblePathData(w, h, bubbleTailSpecOf(el, w, h)),
      fill,
      stroke: "#7c3aed",
      strokeWidth: clampThumbStroke(2, ctx.minStroke),
      dashed: false,
      transform: local,
      opacity,
    });
  } else if (variant === "heart") {
    nodes.push({
      kind: "path",
      key: el.id,
      d: heartBubblePathData(w, h),
      fill,
      stroke,
      strokeWidth,
      dashed: false,
      transform: local,
      opacity,
    });
  } else if (variant === "system") {
    nodes.push({
      kind: "rect",
      key: el.id,
      x: 0,
      y: 0,
      w,
      h,
      rx: 4,
      fill: "#0a0f24",
      fillOpacity: 0.88,
      stroke: "#0ea5e9",
      strokeWidth: clampThumbStroke(2.5, ctx.minStroke),
      dashed: false,
      transform: local,
      opacity,
    });
  } else {
    // speech · whisper · box · phone 등 — 캔버스와 동일한 단일 path(꼬리 포함).
    nodes.push({
      kind: "path",
      key: el.id,
      d: bubblePathData(w, h, variant === "phone" ? 8 : variant === "box" ? 4 : 24, bubbleTailSpecOf(el, w, h)),
      fill,
      stroke,
      strokeWidth,
      dashed: variant === "whisper",
      transform: local,
      opacity,
    });
  }

  // 대사 텍스트 — 세로 중앙 정렬 근사(캔버스 verticalAlign="middle").
  const lines = clampThumbTextLines(el.text ?? "", 3, 16);
  if (!lines.every((line) => line.trim() === "")) {
    const fs = el.fontSize ?? 24;
    const step = fs * (el.lineHeight ?? 1.3);
    const total = step * (lines.length - 1) + fs;
    nodes.push({
      kind: "text",
      key: `${el.id}-text`,
      x: round2(w / 2),
      y: round2((h - total) / 2 + fs * 0.85),
      lines,
      lineStep: round2(step),
      fontSize: fs,
      font: el.font ?? "Pretendard, sans-serif",
      bold: (el.fontStyle ?? "bold").includes("bold"),
      anchor: "middle",
      fill: el.textFill ?? "#1f2937",
      stroke: null,
      strokeWidth: 0,
      transform: local,
      opacity,
    });
  }
  return nodes;
}

function drawNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  if (el.mode === "eraser") return []; // SVG 프록시로 destination-out(지우개) 재현 불가 — 생략
  const pts = Array.isArray(el.points) ? el.points : [];
  if (pts.length < 4) return [];
  const opacity = el.opacity ?? 1;
  const stroke = el.stroke ?? "#111111";
  const strokeWidth = clampThumbStroke(el.strokeWidth ?? 1, ctx.minStroke);
  const kind = el.kind ?? "freehand";
  const fill = el.fill ?? null;

  if (kind === "rect" || kind === "ellipse" || kind === "star" || kind === "triangle" || kind === "polygon") {
    const b = flatPointsBounds(pts);
    const minDim = Math.min(b.w, b.h);
    if (kind === "rect") {
      return [
        {
          kind: "rect",
          key: el.id,
          x: b.x,
          y: b.y,
          w: Math.max(0.1, b.w),
          h: Math.max(0.1, b.h),
          rx: 3,
          fill,
          fillOpacity: 1,
          stroke,
          strokeWidth,
          dashed: false,
          transform: null,
          opacity,
        },
      ];
    }
    if (kind === "ellipse") {
      return [
        {
          kind: "ellipse",
          key: el.id,
          cx: round2(b.x + b.w / 2),
          cy: round2(b.y + b.h / 2),
          rx: Math.max(0.1, b.w / 2),
          ry: Math.max(0.1, b.h / 2),
          fill,
          stroke,
          strokeWidth,
          transform: null,
          opacity,
        },
      ];
    }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const points =
      kind === "star"
        ? starPolygonPoints(cx, cy, 5, Math.max(0.1, minDim / 4), Math.max(0.1, minDim / 2))
        : regularPolygonPoints(cx, cy, kind === "triangle" ? 3 : 6, Math.max(0.1, minDim / 2));
    return [{ kind: "polygon", key: el.id, points, fill, stroke, strokeWidth, transform: null, opacity }];
  }

  // freehand · line · arrow — 다운샘플한 폴리라인(화살촉 등 디테일은 생략).
  return [
    {
      kind: "polyline",
      key: el.id,
      points: pointsToSvg(downsamplePoints(pts, 24)),
      stroke,
      strokeWidth,
      transform: null,
      opacity,
    },
  ];
}

/** 세그먼트 목록 → 썸네일 path d 문자열(소수 2자리 반올림). */
function lineSegmentsToThumbPath(segments: readonly StudioLineSegment[]): string {
  return segments
    .map((s) => `M ${round2(s.x1)} ${round2(s.y1)} L ${round2(s.x2)} ${round2(s.y2)}`)
    .join(" ");
}

function focusLinesNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  // 캔버스와 같은 플래너 — 예전에는 noise 를 통째로 빠뜨려서 썸네일과 캔버스의
  // 집중선이 서로 다른 그림이었다. 상한(20)은 lineCount 자체를 낮추므로 방사선은
  // 원 전체에 고르게 남는다(앞쪽 20개만 잘라내면 한쪽 부채꼴만 남아 더 나쁘다).
  const parts = lineSegmentsToThumbPath(
    planStudioFocusLineSegments(el, { maxSegments: 20 }), // 방사선 개수 상한(썸네일 비용)
  );
  return [
    {
      kind: "path",
      key: el.id,
      d: parts,
      fill: null,
      stroke: el.stroke ?? STUDIO_FOCUS_LINE_DEFAULTS.stroke,
      strokeWidth: clampThumbStroke(el.strokeWidth ?? STUDIO_FOCUS_LINE_DEFAULTS.strokeWidth, ctx.minStroke),
      dashed: false,
      transform: svgLocalTransform(el.x ?? 0, el.y ?? 0, el.rotation ?? 0),
      opacity: el.opacity ?? 1,
    },
  ];
}

function speedLinesNodes(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  // 상한 — 캔버스와 같은 시드/플래너라 앞쪽 14개 선 위치는 캔버스와 완전히 동일.
  const parts = lineSegmentsToThumbPath(
    planStudioSpeedLineSegments(el, { maxSegments: 14 }),
  );
  return [
    {
      kind: "path",
      key: el.id,
      d: parts,
      fill: null,
      stroke: el.stroke ?? STUDIO_SPEED_LINE_DEFAULTS.stroke,
      strokeWidth: clampThumbStroke(el.strokeWidth ?? STUDIO_SPEED_LINE_DEFAULTS.strokeWidth, ctx.minStroke),
      dashed: false,
      transform: svgLocalTransform(el.x ?? 0, el.y ?? 0, el.rotation ?? 0),
      opacity: el.opacity ?? 1,
    },
  ];
}

function thumbNodesForElement(el: ThumbElement, ctx: ThumbBuildContext): ThumbNode[] {
  switch (el.type) {
    case "frame":
      return frameNodes(el, ctx);
    case "image":
      return imageNodes(el);
    case "text":
      return textNodes(el, ctx);
    case "sticker":
      return stickerNodes(el, ctx);
    case "bubble":
      return bubbleNodes(el, ctx);
    case "draw":
      return drawNodes(el, ctx);
    case "focusLines":
      return focusLinesNodes(el, ctx);
    case "speedLines":
      return speedLinesNodes(el, ctx);
    default:
      return [];
  }
}

/**
 * 페이지 → 썸네일 SVG 노드 목록. 요소 배열 순서 = z 순서(캔버스와 동일),
 * 숨김 요소/숨김 그룹 소속 요소는 제외(isEffectivelyHidden 재사용).
 * maxNodes 초과분은 생략하고 skipped 로 개수만 보고한다.
 */
export function buildThumbNodes(page: ThumbPageLike, opts: ThumbBuildOptions = {}): ThumbBuildResult {
  const maxNodes = opts.maxNodes ?? 90;
  const ctx: ThumbBuildContext = {
    minStroke: opts.minStroke ?? 5,
    maxTextLines: opts.maxTextLines ?? 4,
    maxLineChars: opts.maxLineChars ?? 24,
  };
  const groups = page.groups ?? [];
  const nodes: ThumbNode[] = [];
  let skipped = 0;
  for (const el of page.elements) {
    if (isEffectivelyHidden(el, groups)) continue;
    if (nodes.length >= maxNodes) {
      skipped += 1;
      continue;
    }
    nodes.push(...thumbNodesForElement(el, ctx));
  }
  return { nodes, skipped };
}

// 기존 순수 썸네일 API 호환. 실제 구현은 초기 Studio 그래프가 SVG 렌더러를 끌어오지 않도록
// 작은 DnD 모듈에 둔다.
export {
  computeDropSlot,
  dropIndicatorFor,
  dropSlotToReorderTarget,
  isNoopDropSlot,
} from "./studio-page-dnd";
