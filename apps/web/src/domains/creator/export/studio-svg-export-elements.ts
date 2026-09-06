import { hasActiveImageFilters } from "../render/studio-konva-filter-fields";
import {
  planStudioFocusLineSegments,
  planStudioSpeedLineSegments,
  STUDIO_FOCUS_LINE_DEFAULTS,
  STUDIO_SPEED_LINE_DEFAULTS,
  type StudioLineSegment,
} from "../render/studio-radial-line-geometry";

import { addSkip, shadowFilterDef } from "./studio-svg-export-defs";
import {
  att,
  escapeXml,
  fmt,
  nodeTransform,
  pointsAttr,
} from "./studio-svg-export-geometry";
import { nextId } from "./studio-svg-export-png";

import type {
  ExportCtx,
  SvgExportEl,
  SvgExportTheme,
  SvgFocusLinesElLike,
  SvgFrameElLike,
  SvgImageElLike,
  SvgSpeedLinesElLike,
} from "./studio-svg-export-types";

/** 프레임(패널) 테마 파라미터 — StudioPage FramePanel 분기 포트. */
export function frameThemeParams(el: SvgFrameElLike, theme: SvgExportTheme) {
  let stroke = el.stroke ?? "#16100c";
  let strokeW = el.strokeWidth ?? 3;
  let radius = 4;
  let shadow: { color: string; blur: number; offsetX: number; offsetY: number; opacity: number } | null = null;
  if (theme === "soft") {
    stroke = el.stroke ?? "#222222";
    strokeW = el.strokeWidth ?? 1.8;
    radius = 0;
  } else if (theme === "vivid") {
    stroke = el.stroke ?? "#3a3a3a";
    strokeW = el.strokeWidth ?? 1.2;
    radius = 6;
    shadow = { color: "black", blur: 5, offsetX: 1, offsetY: 2, opacity: 0.08 };
  }
  return { stroke, strokeW, radius, shadow };
}

export function serializeFrame(ctx: ExportCtx, el: SvgFrameElLike): string {
  const { stroke, strokeW, radius, shadow } = frameThemeParams(el, ctx.theme);
  const poly = el.points && el.points.length >= 6 ? el.points : null;
  const clipId = nextId(ctx, "sc");
  ctx.defs.push(
    `<clipPath id="${clipId}">${
      poly ? `<polygon points="${pointsAttr(poly)}"/>` : `<rect width="${fmt(el.width)}" height="${fmt(el.height)}"/>`
    }</clipPath>`
  );

  const parts: string[] = [];
  // 배경 채움(폴리곤이면 폴리곤 그대로).
  const bgFill = el.bgColor ?? "#ffffff";
  parts.push(
    poly
      ? `<polygon points="${pointsAttr(poly)}" fill="${escapeXml(bgFill)}"/>`
      : `<rect width="${fmt(el.width)}" height="${fmt(el.height)}" fill="${escapeXml(bgFill)}"/>`
  );
  // 배경 이미지 — cover-fit 은 preserveAspectRatio slice 로 동일 재현.
  if (el.bg) {
    if (!el.bg.startsWith("data:")) {
      addSkip(ctx, el, "approximated", "프레임 배경 이미지가 외부 주소라 SVG에 데이터로 담기지 않았어요.");
    }
    parts.push(
      `<image href="${escapeXml(el.bg)}" width="${fmt(el.width)}" height="${fmt(el.height)}" preserveAspectRatio="xMidYMid slice"/>`
    );
  }
  // 테두리 — 캔버스와 동일하게 클립 안쪽에서 절반 인셋으로 그린다.
  if (strokeW > 0) {
    const dashAttr = el.dashStyle === "dashed" ? att("stroke-dasharray", "10 5") : "";
    const filterAttr = shadow ? att("filter", shadowFilterDef(ctx, shadow)) : "";
    if (poly) {
      parts.push(
        `<polygon points="${pointsAttr(poly)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(strokeW)}"${dashAttr}${filterAttr}/>`
      );
    } else {
      const inset = strokeW / 2;
      parts.push(
        `<rect x="${fmt(inset)}" y="${fmt(inset)}" width="${fmt(Math.max(0, el.width - strokeW))}" height="${fmt(Math.max(0, el.height - strokeW))}"${Math.max(0, radius - inset) > 0 ? att("rx", Math.max(0, radius - inset)) : ""} fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(strokeW)}"${dashAttr}${filterAttr}/>`
      );
    }
  }
  const transform = nodeTransform(el.x, el.y);
  return `<g${transform ? att("transform", transform) : ""} clip-path="url(#${clipId})">${parts.join("")}</g>`;
}

export function serializeImage(ctx: ExportCtx, el: SvgImageElLike): string {
  if (!el.src.startsWith("data:")) {
    addSkip(ctx, el, "approximated", "이미지가 외부 주소라 SVG에 데이터로 담기지 않았어요(오프라인에서 안 보일 수 있음).");
  }
  if (hasActiveImageFilters(el)) {
    addSkip(ctx, el, "approximated", "픽셀 필터·색보정은 SVG에 적용되지 않아 원본 이미지로 표시돼요.");
  }
  const transform = nodeTransform(el.x, el.y, el.rotation, el);
  const opacity = el.opacity ?? 1;
  const attrs: string[] = [];
  // 둥근 모서리 — 로컬 좌표 둥근 사각형 클립.
  if ((el.cornerRadius ?? 0) > 0) {
    const clipId = nextId(ctx, "sc");
    const rx = Math.min(el.cornerRadius ?? 0, Math.min(el.width, el.height) / 2);
    ctx.defs.push(`<clipPath id="${clipId}"><rect width="${fmt(el.width)}" height="${fmt(el.height)}" rx="${fmt(rx)}"/></clipPath>`);
    attrs.push(` clip-path="url(#${clipId})"`);
  }
  if (el.shadowColor) {
    attrs.push(
      att(
        "filter",
        shadowFilterDef(ctx, {
          color: el.shadowColor,
          blur: el.shadowBlur ?? 0,
          offsetX: el.shadowOffsetX ?? 0,
          offsetY: el.shadowOffsetY ?? 0,
          opacity: el.shadowOpacity ?? 1,
        })
      )
    );
  }
  // 좌우/상하 반전 — 캔버스는 비트맵을 미리 뒤집는다. SVG 는 로컬 반전 변환으로 동일 결과.
  let flip = "";
  if (el.flipped || el.flippedY) {
    const sx = el.flipped ? -1 : 1;
    const sy = el.flippedY ? -1 : 1;
    flip = ` transform="translate(${fmt(el.flipped ? el.width : 0)} ${fmt(el.flippedY ? el.height : 0)}) scale(${sx} ${sy})"`;
  }
  const image = `<image href="${escapeXml(el.src)}" width="${fmt(el.width)}" height="${fmt(el.height)}" preserveAspectRatio="none"${flip}/>`;
  return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}${attrs.join("")}>${image}</g>`;
}

/** 요소-로컬 세그먼트 + 노드 변환 → 집중선/속도선 `<g><path/></g>` 직렬화(두 종류 공통). */
export function serializeLineSegments(
  el: SvgFocusLinesElLike | SvgSpeedLinesElLike,
  segments: readonly StudioLineSegment[],
  fallbackStroke: string,
  fallbackStrokeWidth: number,
): string {
  const segs = segments.map(
    (s) => `M ${fmt(s.x1)} ${fmt(s.y1)} L ${fmt(s.x2)} ${fmt(s.y2)}`,
  );
  const transform = nodeTransform(el.x, el.y, el.rotation ?? 0);
  const opacity = el.opacity ?? 1;
  return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}><path d="${segs.join(" ")}" fill="none" stroke="${escapeXml(el.stroke ?? fallbackStroke)}" stroke-width="${fmt(el.strokeWidth ?? fallbackStrokeWidth)}"/></g>`;
}

export function serializeFocusLines(el: SvgFocusLinesElLike): string {
  return serializeLineSegments(
    el,
    planStudioFocusLineSegments(el),
    STUDIO_FOCUS_LINE_DEFAULTS.stroke,
    STUDIO_FOCUS_LINE_DEFAULTS.strokeWidth,
  );
}

export function serializeSpeedLines(el: SvgSpeedLinesElLike): string {
  return serializeLineSegments(
    el,
    planStudioSpeedLineSegments(el),
    STUDIO_SPEED_LINE_DEFAULTS.stroke,
    STUDIO_SPEED_LINE_DEFAULTS.strokeWidth,
  );
}

// ---------------------------------------------------------------------------
// 패널 클리핑·혼합 모드 래핑 — StudioPage wrapClip 규약 포트
// ---------------------------------------------------------------------------

/** 요소 대략 bbox(StudioPage elBounds 포트) — 패널 소속 판정용. */
export function elBounds(el: SvgExportEl): { x: number; y: number; w: number; h: number } {
  if (el.type === "draw") {
    let minX = el.points[0] ?? 0;
    let minY = el.points[1] ?? 0;
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i + 1 < el.points.length; i += 2) {
      const x = el.points[i];
      const y = el.points[i + 1];
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") return { x: el.x, y: el.y, w: el.width, h: el.fontSize * 1.4 };
  if (el.type === "sticker") return { x: el.x, y: el.y, w: el.fontSize, h: el.fontSize };
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

/** 요소가 들어가야 할 패널(StudioPage containingPanel 포트) — 없으면 null. */
export function containingPanel(el: SvgExportEl, all: readonly SvgExportEl[]): SvgFrameElLike | null {
  if (el.type === "frame") return null;
  const b = elBounds(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best: SvgFrameElLike | null = null;
  let bestArea = Infinity;
  for (const f of all) {
    if (f.type !== "frame" || f.hidden) continue;
    if (cx < f.x || cx > f.x + f.width || cy < f.y || cy > f.y + f.height) continue;
    if (b.w > f.width * 1.4 || b.h > f.height * 1.4) continue;
    const area = f.width * f.height;
    if (area < bestArea) {
      bestArea = area;
      best = f;
    }
  }
  return best;
}

// CSS mix-blend-mode 로 그대로 표현 가능한 합성 모드(레이어 인스펙터 선택지 전부 포함).
export const CSS_BLEND_MODES = new Set([
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);
