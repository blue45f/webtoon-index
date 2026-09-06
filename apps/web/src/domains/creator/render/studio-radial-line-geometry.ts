/**
 * Renderer-neutral geometry for the two comic-effect vector elements —
 * focus lines (집중선) and speed lines (속도선).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Four lanes used to draw these elements and three of them disagreed:
 *
 *   - Konva `StudioKonvaPrimitiveNodes` — the canonical artwork the artist sees.
 *   - SVG export `studio-svg-export` — a faithful hand port.
 *   - Page thumbnails `studio-page-thumbs` — dropped focus-line `noise` entirely.
 *   - Vello/WebGPU lowering `studio-document-scene-lower` — a different jitter
 *     formula, no seeded randomness, no radius clamps, evenly-spaced speed
 *     lines, and rotation folded into the ray angles about the box centre
 *     instead of the node origin.
 *
 * On an exclusive-vector page the WebGPU surface becomes the document authority
 * and Konva is hidden, so those divergences were user-visible: the artist saw
 * artwork they had not authored. A pixel oracle can never catch that — both
 * Vello lanes agree perfectly while rendering the same wrong picture. The fix
 * is upstream of the oracle: one planner, consumed by every lane.
 *
 * The planners below are lifted verbatim from the Konva `sceneFunc` bodies, so
 * Konva's output is unchanged by construction and every other lane converges
 * onto it. Segments are in ELEMENT-LOCAL coordinates; `placeStudioLineSegment`
 * writes down the placement rule the lanes disagreed about.
 */

/** A single straight line in element-local coordinates. */
export interface StudioLineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Konva-compatible defensive defaults. These are the `??` fallbacks the shipping
 * `StudioFocusLinesNode` applies, hoisted so a saved document that predates a
 * field renders identically everywhere instead of producing `NaN` geometry.
 */
export const STUDIO_FOCUS_LINE_DEFAULTS = {
  lineCount: 80,
  innerRadius: 120,
  outerRadius: 600,
  noise: 24,
  centerXRatio: 0.5,
  centerYRatio: 0.5,
  stroke: "#000000",
  strokeWidth: 2.5,
} as const;

/** Konva-compatible defensive defaults for `StudioSpeedLinesNode`. */
export const STUDIO_SPEED_LINE_DEFAULTS = {
  lineCount: 60,
  direction: "horizontal",
  stroke: "#000000",
  strokeWidth: 2.5,
} as const;

/**
 * Deterministic pseudo-random sequence seeded by the element id.
 *
 * Every lane must use this exact sequence — the artwork's identity is the draw
 * ORDER of `rand()` calls, not just the algorithm. Three byte-identical copies
 * of this function used to live in `StudioKonvaPrimitiveNodes.tsx`,
 * `studio-svg-export.ts`, and `studio-page-thumbs.ts`.
 */
export function studioSeededRandom(seedStr: string): () => number {
  let hash = 0;
  for (let index = 0; index < seedStr.length; index += 1) {
    hash = seedStr.charCodeAt(index) + ((hash << 5) - hash);
  }
  return () => {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };
}

/**
 * Structural input for the focus-line planner. Every field beyond `id` is
 * optional so `FocusLinesEl`, `SvgFocusLinesElLike`, and `ThumbElement` all
 * satisfy it without a cast.
 */
export interface StudioFocusLineGeometryInput {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly lineCount?: number;
  readonly innerRadius?: number;
  readonly outerRadius?: number;
  readonly noise?: number;
  readonly centerXRatio?: number;
  readonly centerYRatio?: number;
}

/** Structural input for the speed-line planner. */
export interface StudioSpeedLineGeometryInput {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly lineCount?: number;
  /** Widened to `string` so `ThumbElement.direction` fits; anything but `"horizontal"` is vertical. */
  readonly direction?: string;
}

export interface StudioLinePlanOptions {
  /**
   * Cap on emitted segments — thumbnails trade fidelity for cost.
   *
   * The cap lowers the effective `lineCount`, it does not slice a full plan.
   * For SPEED lines that makes the capped plan a strict prefix of the full one
   * (line positions do not depend on the count). For FOCUS lines the rays stay
   * evenly distributed around the full circle at the reduced count, which is
   * what a thumbnail wants — slicing instead would leave a lone wedge.
   */
  readonly maxSegments?: number;
}

function resolveCount(raw: number | undefined, fallback: number, options?: StudioLinePlanOptions): number {
  const count = raw ?? fallback;
  const safe = Number.isFinite(count) ? Math.floor(count) : fallback;
  const capped = options?.maxSegments === undefined ? safe : Math.min(safe, options.maxSegments);
  return Math.max(0, capped);
}

/**
 * Plan focus-line segments in element-local coordinates.
 *
 * Verbatim from `StudioFocusLinesNode`'s `sceneFunc`: two `rand()` draws per
 * ray (start then end), `rStart` floored at 1, and `rEnd` floored at
 * `rStart + 10` so a noisy inner radius can never overtake the outer one.
 */
export function planStudioFocusLineSegments(
  element: StudioFocusLineGeometryInput,
  options?: StudioLinePlanOptions,
): StudioLineSegment[] {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const count = resolveCount(element.lineCount, STUDIO_FOCUS_LINE_DEFAULTS.lineCount, options);
  const innerR = element.innerRadius ?? STUDIO_FOCUS_LINE_DEFAULTS.innerRadius;
  const outerR = element.outerRadius ?? STUDIO_FOCUS_LINE_DEFAULTS.outerRadius;
  const noise = element.noise ?? STUDIO_FOCUS_LINE_DEFAULTS.noise;
  const cx = width * (element.centerXRatio ?? STUDIO_FOCUS_LINE_DEFAULTS.centerXRatio);
  const cy = height * (element.centerYRatio ?? STUDIO_FOCUS_LINE_DEFAULTS.centerYRatio);
  const rand = studioSeededRandom(element.id);
  const segments: StudioLineSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index * 2 * Math.PI) / count;
    const nStart = (rand() - 0.5) * noise;
    const nEnd = (rand() - 0.5) * noise;
    const rStart = Math.max(1, innerR + nStart);
    const rEnd = Math.max(rStart + 10, outerR + nEnd);
    segments.push({
      x1: cx + rStart * Math.cos(angle),
      y1: cy + rStart * Math.sin(angle),
      x2: cx + rEnd * Math.cos(angle),
      y2: cy + rEnd * Math.sin(angle),
    });
  }
  return segments;
}

/**
 * Plan speed-line segments in element-local coordinates.
 *
 * Verbatim from `StudioSpeedLinesNode`'s `sceneFunc`: three `rand()` draws per
 * line (cross-axis position, length fraction, which edge it starts from).
 */
export function planStudioSpeedLineSegments(
  element: StudioSpeedLineGeometryInput,
  options?: StudioLinePlanOptions,
): StudioLineSegment[] {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const count = resolveCount(element.lineCount, STUDIO_SPEED_LINE_DEFAULTS.lineCount, options);
  const horizontal = (element.direction ?? STUDIO_SPEED_LINE_DEFAULTS.direction) === "horizontal";
  const rand = studioSeededRandom(element.id);
  const segments: StudioLineSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    if (horizontal) {
      const y = rand() * height;
      const len = width * (0.2 + rand() * 0.8);
      const xStart = rand() > 0.5 ? 0 : width - len;
      segments.push({ x1: xStart, y1: y, x2: xStart + len, y2: y });
    } else {
      const x = rand() * width;
      const len = height * (0.2 + rand() * 0.8);
      const yStart = rand() > 0.5 ? 0 : height - len;
      segments.push({ x1: x, y1: yStart, x2: x, y2: yStart + len });
    }
  }
  return segments;
}

/** Element placement — the node origin and its rotation in degrees. */
export interface StudioLinePlacement {
  readonly x?: number;
  readonly y?: number;
  readonly rotationDeg?: number;
}

/**
 * Element-local → document coordinates.
 *
 * This is the rule the four lanes disagreed about. A Konva `Node` transform is
 * `translate(x, y) · rotate(rotation)`, so the pivot is the node ORIGIN — the
 * box's top-left — not the focus-line pattern centre. Rotating rays about their
 * own centre happens to produce the same ray field, which is why the bug was
 * invisible at the common `rotation: 0` and why the lowering shipped wrong.
 *
 * SVG export and thumbnails do not call this: they emit local coordinates under
 * a `translate(...) rotate(...)` transform attribute, which is the same rule
 * expressed by the host format.
 */
export function placeStudioLineSegment(
  segment: StudioLineSegment,
  placement: StudioLinePlacement,
): StudioLineSegment {
  const originX = placement.x ?? 0;
  const originY = placement.y ?? 0;
  const rotationDeg = placement.rotationDeg ?? 0;
  if (!rotationDeg || !Number.isFinite(rotationDeg)) {
    return {
      x1: originX + segment.x1,
      y1: originY + segment.y1,
      x2: originX + segment.x2,
      y2: originY + segment.y2,
    };
  }
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x1: originX + segment.x1 * cos - segment.y1 * sin,
    y1: originY + segment.x1 * sin + segment.y1 * cos,
    x2: originX + segment.x2 * cos - segment.y2 * sin,
    y2: originY + segment.x2 * sin + segment.y2 * cos,
  };
}
