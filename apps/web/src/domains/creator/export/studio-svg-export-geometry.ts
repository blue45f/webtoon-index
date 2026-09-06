import {
  studioBrushSymmetryTransforms,
  transformStudioBrushSymmetryPoint,
} from "../brush/studio-brush-symmetry";
import { skewDegToKonva, type SkewFields } from "../studio-skew";

import type { StudioFxLuminousRibbonPassPlan } from "../studio-fx-brush";
import type { SvgDrawElLike } from "./studio-svg-export-types";

/** 좌표/치수 포맷 — 소수 둘째 자리 반올림, 꼬리 0 제거, -0/비유한수는 0. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100 + 0;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * 누적형 dab 투명도 포맷 — 좌표보다 높은 6자리 정밀도로 아주 옅은 에어브러시도 보존한다.
 * SVG opacity 유효 범위로 제한하고, 0보다 큰 값이 반올림만으로 완전 투명해지지 않게 한다.
 */
export function fmtDabOpacity(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const bounded = Math.min(1, Math.max(0, n));
  const rounded = Math.round(bounded * 1_000_000) / 1_000_000;
  const visible = bounded > 0 && rounded === 0 ? 0.000001 : rounded;
  return visible.toFixed(6).replace(/\.?0+$/, "");
}

/** XML 텍스트/속성 이스케이프 — & < > " ' 전부 치환(속성·본문 공용). */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 속성 문자열 조각 — 값이 undefined/null 이면 빈 문자열(속성 생략). */
export function att(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return ` ${name}="${typeof value === "number" ? fmt(value) : escapeXml(value)}"`;
}

/**
 * Konva 노드 변환과 동일한 transform 문자열 — translate → rotate → skew 순.
 * Konva skewX/skewY 는 tangent 계수라 SVG matrix(1, tanY, tanX, 1, 0, 0) 로 표현한다.
 * 항등 성분은 생략하고, 전부 항등이면 undefined(속성 생략).
 */
export function nodeTransform(x: number, y: number, rotation?: number, skew?: SkewFields): string | undefined {
  const parts: string[] = [];
  if (x !== 0 || y !== 0) parts.push(`translate(${fmt(x)} ${fmt(y)})`);
  if (rotation && rotation !== 0) parts.push(`rotate(${fmt(rotation)})`);
  const tanX = skewDegToKonva(skew?.skewX ?? 0);
  const tanY = skewDegToKonva(skew?.skewY ?? 0);
  if (tanX !== 0 || tanY !== 0) parts.push(`matrix(1 ${fmt(tanY)} ${fmt(tanX)} 1 0 0)`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** 평탄 포인트 → path d("M x0 y0 L x1 y1 ...") — closed 면 "Z" 로 닫는다. */
export function pointsToPathD(points: readonly number[], closed = false): string {
  if (points.length < 2) return "";
  const parts = [`M ${fmt(points[0])} ${fmt(points[1])}`];
  for (let i = 2; i + 1 < points.length; i += 2) parts.push(`L ${fmt(points[i])} ${fmt(points[i + 1])}`);
  if (closed) parts.push("Z");
  return parts.join(" ");
}

/**
 * Round dabs as one painted SVG geometry.
 */
export function circularDabsToCompoundPathD(
  dabs: readonly { readonly x: number; readonly y: number; readonly radius: number }[]
): string {
  return dabs.map((dab) => {
    const x = Number.isFinite(dab.x) ? dab.x : 0;
    const y = Number.isFinite(dab.y) ? dab.y : 0;
    const radius = Number.isFinite(dab.radius) ? Math.max(0, dab.radius) : 0;
    if (radius === 0) return `M ${fmt(x)} ${fmt(y)} Z`;
    const left = x - radius;
    const right = x + radius;
    return [
      `M ${fmt(left)} ${fmt(y)}`,
      `A ${fmt(radius)} ${fmt(radius)} 0 1 0 ${fmt(right)} ${fmt(y)}`,
      `A ${fmt(radius)} ${fmt(radius)} 0 1 0 ${fmt(left)} ${fmt(y)}`,
      "Z",
    ].join(" ");
  }).join(" ");
}

/** 평탄 포인트 → polygon points 속성("x,y x,y ..."). */
export function pointsAttr(points: readonly number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push(`${fmt(points[i])},${fmt(points[i + 1])}`);
  return pairs.join(" ");
}

/** StudioPage drawBounds 포트 — 도형 드래그 박스(첫 두 점 기준). */
export function drawBounds(points: readonly number[]): { x: number; y: number; width: number; height: number } {
  const x1 = points[0] ?? 0;
  const y1 = points[1] ?? 0;
  const x2 = points[2] ?? x1;
  const y2 = points[3] ?? y1;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** StudioPage getSymmetricPoints 포트 — 대칭 드로잉 변형 좌표열. */
export function getSymmetricPoints(points: number[], symmetry: SvgDrawElLike["symmetry"]): number[][] {
  if (points.length === 0) return [points];
  return studioBrushSymmetryTransforms(symmetry).map((transform) => {
    const transformed: number[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      transformed.push(...transformStudioBrushSymmetryPoint(
        points[index]!,
        points[index + 1]!,
        transform
      ));
    }
    return transformed;
  });
}

/**
 * Konva Line(tension) 곡선 포트 — 카디널 스플라인 제어점을 그대로 재현해 Q/C 커맨드 path 로 만든다.
 */
export function tensionPathD(points: readonly number[], tension: number): string {
  if (points.length < 6 || tension === 0) return pointsToPathD(points);
  const tp: number[] = [];
  for (let n = 2; n < points.length - 2; n += 2) {
    const x0 = points[n - 2];
    const y0 = points[n - 1];
    const x1 = points[n];
    const y1 = points[n + 1];
    const x2 = points[n + 2];
    const y2 = points[n + 3];
    const d01 = Math.hypot(x1 - x0, y1 - y0);
    const d12 = Math.hypot(x2 - x1, y2 - y1);
    const fa = (tension * d01) / (d01 + d12);
    const fb = (tension * d12) / (d01 + d12);
    if (Number.isNaN(fa)) continue;
    tp.push(x1 - fa * (x2 - x0), y1 - fa * (y2 - y0), x1, y1, x1 + fb * (x2 - x0), y1 + fb * (y2 - y0));
  }
  if (tp.length < 4) return pointsToPathD(points);
  const parts = [`M ${fmt(points[0])} ${fmt(points[1])}`, `Q ${fmt(tp[0])} ${fmt(tp[1])} ${fmt(tp[2])} ${fmt(tp[3])}`];
  let n = 4;
  while (n < tp.length - 2) {
    parts.push(`C ${fmt(tp[n])} ${fmt(tp[n + 1])} ${fmt(tp[n + 2])} ${fmt(tp[n + 3])} ${fmt(tp[n + 4])} ${fmt(tp[n + 5])}`);
    n += 6;
  }
  parts.push(
    `Q ${fmt(tp[tp.length - 2])} ${fmt(tp[tp.length - 1])} ${fmt(points[points.length - 2])} ${fmt(points[points.length - 1])}`
  );
  return parts.join(" ");
}

export function studioFxLuminousRibbonPathD(
  plan: StudioFxLuminousRibbonPassPlan,
): string {
  return plan.polygons
    .map((polygon) => pointsToPathD(polygon.points, true))
    .join(" ");
}

export function fmtCoverageNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1_000_000) / 1_000_000 + 0;
  return rounded.toFixed(6).replace(/\.?0+$/u, "");
}
