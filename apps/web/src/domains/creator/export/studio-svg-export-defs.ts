import {
  linearGradientPoints,
  normalizeGradientSpec,
  radialGradientGeometry,
  type GradientBBox,
  type StudioGradientSpec,
} from "../studio-gradient-engine";
import { getPatternDef, normalizePatternSpec, type StudioPatternSpec } from "../studio-pattern-fill";

import { escapeXml, fmt } from "./studio-svg-export-geometry";
import { nextId } from "./studio-svg-export-png";

import type { ExportCtx, SvgDrawElLike, SvgExportSkip } from "./studio-svg-export-types";

export function addSkip(ctx: ExportCtx, el: { id: string; type: string }, mode: SvgExportSkip["mode"], label: string): void {
  ctx.skips.push({ id: el.id, type: el.type, mode, label });
}

/** 그라데이션 defs — userSpaceOnUse 좌표(노드 로컬 bbox + 로컬 원점 오프셋). */
export function gradientDef(ctx: ExportCtx, spec: StudioGradientSpec, bbox: GradientBBox, origin: { x: number; y: number }): string {
  const safe = normalizeGradientSpec(spec);
  const id = nextId(ctx, "sg");
  const stops = safe.stops.map((s) => `<stop offset="${fmt(s.offset * 100)}%" stop-color="${s.color}"/>`).join("");
  if (safe.type === "radial") {
    const geo = radialGradientGeometry(bbox);
    ctx.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(origin.x + geo.center.x)}" cy="${fmt(origin.y + geo.center.y)}" r="${fmt(geo.endRadius)}">${stops}</radialGradient>`
    );
  } else {
    const { start, end } = linearGradientPoints(safe, bbox);
    ctx.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(origin.x + start.x)}" y1="${fmt(origin.y + start.y)}" x2="${fmt(origin.x + end.x)}" y2="${fmt(origin.y + end.y)}">${stops}</linearGradient>`
    );
  }
  return `url(#${id})`;
}

/** 패턴 defs — 타일 마크업(studio-pattern-fill)을 노드 로컬 원점에 정렬해 반복. */
export function patternDefFill(ctx: ExportCtx, spec: StudioPatternSpec, origin: { x: number; y: number }): string {
  const safe = normalizePatternSpec(spec);
  const def = getPatternDef(safe.patternId);
  const id = nextId(ctx, "sp");
  const size = def.tile * safe.scale;
  const bgRect = safe.bg ? `<rect width="${fmt(def.tile)}" height="${fmt(def.tile)}" fill="${safe.bg}"/>` : "";
  ctx.defs.push(
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${fmt(size)}" height="${fmt(size)}" patternTransform="translate(${fmt(origin.x)} ${fmt(origin.y)})"><g transform="scale(${fmt(safe.scale)})">${bgRect}${def.inner(safe.fg)}</g></pattern>`
  );
  return `url(#${id})`;
}

/** 그림자 필터 defs — canvas shadow* 를 feDropShadow 로 근사(σ ≈ blur/2). */
export function shadowFilterDef(
  ctx: ExportCtx,
  shadow: { color: string; blur: number; offsetX: number; offsetY: number; opacity: number }
): string {
  const id = nextId(ctx, "sf");
  ctx.defs.push(
    `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="${fmt(shadow.offsetX)}" dy="${fmt(shadow.offsetY)}" stdDeviation="${fmt(shadow.blur / 2)}" flood-color="${escapeXml(shadow.color)}" flood-opacity="${fmt(shadow.opacity)}"/></filter>`
  );
  return `url(#${id})`;
}

/** 도형/선 채우기 값 — 우선순위 패턴 > 그라데이션 > 단색 > 없음(none). */
export function resolveDrawFill(
  ctx: ExportCtx,
  el: SvgDrawElLike,
  origin: { x: number; y: number },
  gradientBBox: GradientBBox | null
): string {
  if (el.pattern) return patternDefFill(ctx, el.pattern, origin);
  if (el.gradient && gradientBBox) return gradientDef(ctx, el.gradient, gradientBBox, origin);
  return el.fill ?? "none";
}
