import {
  drawStudioStampBrushDabs,
  planStudioStampBrushDabs,
  STUDIO_STAMP_BRUSH_MAX_DABS,
} from "./studio-brush-stamp-engine";
import {
  studioBrushSymmetryTransforms,
  transformStudioBrushSymmetryPoint,
} from "./studio-brush-symmetry";
import {
  planStudioStampInkRibbon,
  studioStampInkRibbonOptions,
  traceStudioStampInkRibbon,
} from "./studio-stamp-ink-ribbon";

import type {
  StudioStampBrushDab,
  StudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import type {
  StudioBrushSymmetrySpec,
  StudioBrushSymmetryTransform,
} from "./studio-brush-symmetry";

/** Total logical-dab budget after symmetry expansion, not a per-copy allowance. */
export const STUDIO_STAMP_SYMMETRY_MAX_OUTPUT_DABS = STUDIO_STAMP_BRUSH_MAX_DABS;

export interface StudioStampSymmetryRenderPlan {
  /** Source-variation plan (identity copy) — also the ink-ribbon input. */
  readonly dabs: readonly StudioStampBrushDab[];
  /** One document-space plan per symmetry copy, index-aligned with `transforms`. */
  readonly dabVariations: ReadonlyArray<readonly StudioStampBrushDab[]>;
  readonly transforms: readonly StudioBrushSymmetryTransform[];
  readonly sourcePointCount: number;
  readonly totalDabCount: number;
}

const STAMP_SYMMETRY_COORDINATE_QUANTUM = 1e-6;

function canonicalStampSymmetryCoordinate(value: number): string {
  if (Math.abs(value) < STAMP_SYMMETRY_COORDINATE_QUANTUM / 2) return "0";
  const scaled = value / STAMP_SYMMETRY_COORDINATE_QUANTUM;
  return Number.isSafeInteger(Math.round(scaled))
    ? String(Math.round(scaled))
    : value.toPrecision(12);
}

function stampSymmetryFingerprint(
  points: readonly number[],
  transform: StudioBrushSymmetryTransform
): string {
  // Two inexpensive independent integer streams make accidental buckets vanishingly rare. A
  // bucket hit is still verified coordinate-by-coordinate below, so hashes never decide pixels.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < points.length; index += 2) {
    const [x, y] = transformStudioBrushSymmetryPoint(
      points[index]!,
      points[index + 1]!,
      transform
    );
    for (const token of [canonicalStampSymmetryCoordinate(x), canonicalStampSymmetryCoordinate(y)]) {
      for (let charIndex = 0; charIndex < token.length; charIndex += 1) {
        const code = token.charCodeAt(charIndex);
        first = Math.imul(first ^ code, 0x01000193) >>> 0;
        second = Math.imul(second + code + 0x7ed55d16, 0x85ebca6b) >>> 0;
      }
      first = Math.imul(first ^ 0xff, 0x01000193) >>> 0;
      second = Math.imul(second ^ 0xa5, 0xc2b2ae35) >>> 0;
    }
  }
  return `${points.length}:${first}:${second}`;
}

function sameStampSymmetryCoordinates(
  points: readonly number[],
  left: StudioBrushSymmetryTransform,
  right: StudioBrushSymmetryTransform
): boolean {
  for (let index = 0; index < points.length; index += 2) {
    const leftPoint = transformStudioBrushSymmetryPoint(
      points[index]!,
      points[index + 1]!,
      left
    );
    const rightPoint = transformStudioBrushSymmetryPoint(
      points[index]!,
      points[index + 1]!,
      right
    );
    if (
      canonicalStampSymmetryCoordinate(leftPoint[0])
        !== canonicalStampSymmetryCoordinate(rightPoint[0])
      || canonicalStampSymmetryCoordinate(leftPoint[1])
        !== canonicalStampSymmetryCoordinate(rightPoint[1])
    ) return false;
  }
  return true;
}

function finiteStampPointPrefix(points: readonly number[]): number[] {
  const prefix: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    prefix.push(x!, y!);
  }
  return prefix;
}

function uniqueStampSymmetryTransforms(
  points: readonly number[],
  symmetry: StudioBrushSymmetrySpec | undefined
): StudioBrushSymmetryTransform[] {
  const buckets = new Map<string, StudioBrushSymmetryTransform[]>();
  const unique: StudioBrushSymmetryTransform[] = [];
  for (const transform of studioBrushSymmetryTransforms(symmetry)) {
    const fingerprint = stampSymmetryFingerprint(points, transform);
    const candidates = buckets.get(fingerprint);
    if (candidates?.some((candidate) =>
      sameStampSymmetryCoordinates(points, candidate, transform)
    )) continue;
    unique.push(transform);
    if (candidates) candidates.push(transform);
    else buckets.set(fingerprint, [transform]);
  }
  return unique;
}

function isIdentityStampSymmetryTransform(
  transform: StudioBrushSymmetryTransform
): boolean {
  return transform.a === 1 && transform.b === 0 && transform.c === 0
    && transform.d === 1 && transform.e === 0 && transform.f === 0;
}

/** Identity returns the source array itself so symmetry-off planning stays byte-identical. */
function transformStampSymmetryPoints(
  points: readonly number[],
  transform: StudioBrushSymmetryTransform
): readonly number[] {
  if (isIdentityStampSymmetryTransform(transform)) return points;
  const transformed: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const [x, y] = transformStudioBrushSymmetryPoint(
      points[index]!,
      points[index + 1]!,
      transform
    );
    transformed.push(x, y);
  }
  return transformed;
}

/**
 * Plans one prefix-stable v2 stamp stream per symmetry copy. Each copy is planned in document
 * space on its transformed source points — the exact procedure the SVG export uses — so a
 * position-dependent dab alpha (W7 paper peak-catch) samples the true document position of every
 * copy instead of reading the source position through an affine context replay. The symmetry
 * transforms are isometries, so position-independent lanes keep their radii/alphas/jitter indices
 * per copy, and the identity copy plans on the untouched source array.
 */
export function planStudioStampSymmetryRender(
  style: StudioStampBrushStyle,
  points: readonly number[],
  pressures: readonly number[] | undefined,
  symmetry: StudioBrushSymmetrySpec | undefined,
  maximumOutputDabs = STUDIO_STAMP_SYMMETRY_MAX_OUTPUT_DABS
): StudioStampSymmetryRenderPlan {
  const finitePoints = finiteStampPointPrefix(points);
  if (finitePoints.length === 0) {
    return {
      dabs: [],
      dabVariations: [],
      transforms: [],
      sourcePointCount: 0,
      totalDabCount: 0,
    };
  }
  const requestedBudget = Number.isFinite(maximumOutputDabs)
    ? Math.floor(maximumOutputDabs)
    : STUDIO_STAMP_SYMMETRY_MAX_OUTPUT_DABS;
  const outputBudget = Math.min(
    STUDIO_STAMP_SYMMETRY_MAX_OUTPUT_DABS,
    Math.max(1, requestedBudget)
  );
  const uniqueTransforms = uniqueStampSymmetryTransforms(finitePoints, symmetry);
  // With the production budget every legal symmetry copy is retained. Slicing only matters for a
  // deliberately smaller caller/test budget and still preserves source-first ordering.
  const transforms = uniqueTransforms.slice(0, outputBudget);
  // The budget stays a fan-wide total, split evenly across copies — not a per-copy allowance.
  const maximumBaseDabs = Math.max(1, Math.floor(outputBudget / transforms.length));
  const dabVariations = transforms.map((transform) => planStudioStampBrushDabs(
    style,
    transformStampSymmetryPoints(finitePoints, transform),
    pressures,
    maximumBaseDabs
  ));
  return {
    dabs: dabVariations[0] ?? [],
    dabVariations,
    transforms,
    sourcePointCount: finitePoints.length / 2,
    totalDabCount: dabVariations.reduce(
      (total, variation) => total + variation.length,
      0
    ),
  };
}

/** Canvas2D/Konva compatibility renderer for an exact, bounded v2 stamp symmetry plan. */
export function drawStudioStampStrokeWithSymmetry(
  context: CanvasRenderingContext2D,
  style: StudioStampBrushStyle,
  points: readonly number[],
  pressures: readonly number[] | undefined,
  symmetry: StudioBrushSymmetrySpec | undefined
): StudioStampSymmetryRenderPlan {
  const plan = planStudioStampSymmetryRender(style, points, pressures, symmetry);
  if (style.kind === "ink") {
    // Ink keeps the affine-replay ribbon: its dab alpha is position-independent and one shared
    // ribbon guarantees every copy carries the exact same union silhouette.
    const inkRibbon = planStudioStampInkRibbon(
      plan.dabs,
      studioStampInkRibbonOptions(style),
    );
    for (const transform of plan.transforms) {
      context.save();
      context.transform(
        transform.a,
        transform.b,
        transform.c,
        transform.d,
        transform.e,
        transform.f
      );
      context.globalAlpha = inkRibbon.opacity;
      context.fillStyle = style.color;
      context.beginPath();
      traceStudioStampInkRibbon(context, inkRibbon);
      context.fill();
      // Knife edge relief, in the SVG serializer's paint order and with its colours: plain alpha,
      // no composite operation, so the artboard and the exported file cannot disagree.
      // Butt, not round: a bead of paint ends where the blade left it, and a dome cap put a
      // visible white dot past the end of every short band.
      context.lineCap = "butt";
      context.lineJoin = "round";
      for (const band of inkRibbon.reliefBands ?? []) {
        context.globalAlpha = band.opacity;
        context.strokeStyle = band.kind === "highlight" ? "#ffffff" : style.color;
        context.lineWidth = band.lineWidth;
        for (const run of band.runs) {
          if (run.length < 4) continue;
          context.beginPath();
          context.moveTo(run[0]!, run[1]!);
          for (let index = 2; index + 1 < run.length; index += 2) {
            context.lineTo(run[index]!, run[index + 1]!);
          }
          context.stroke();
        }
      }
      context.restore();
    }
    return plan;
  }
  for (const dabs of plan.dabVariations) {
    // Copies are planned in document space, so they draw without a context transform and
    // paper-pinned lanes deposit at each copy's true position (SVG per-variation parity).
    context.save();
    drawStudioStampBrushDabs(context, style, dabs);
    context.restore();
  }
  return plan;
}
