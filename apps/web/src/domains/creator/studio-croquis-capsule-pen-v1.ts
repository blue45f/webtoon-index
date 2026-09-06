/**
 * Croquis capsule pen v1 — exact circumscribed-tangent capsule inking geometry.
 *
 * Provenance (verified external kernel, clean re-typed):
 * - croquis.js (disjukr/croquis.js, package `@disjukr/croquis-js` 0.0.3) — dual-licensed
 *   "(MIT OR Apache-2.0)" per package.json `license` and README §license ("croquis.js is
 *   dual-licensed under Apache 2.0 and MIT terms"). Author: JongChan Choi <jong@chan.moe>.
 *   ToonSpectrum elects the MIT option; the permission notice is checked in at
 *   `third_party/croquis-js/LICENSE-MIT` and embedded into
 *   `dist/legal/THIRD_PARTY_NOTICES.generated.md` (upstream ships no license text file).
 * - `src/brush/simple.ts` — outer-bitangent capsule fill (drawCapsule case1/case2, swallow
 *   guard `big.r > small.r + d`, radius rule `r = pressure * size * 0.5`).
 * - `src/stabilizer/pulled-string.ts` — pulled-string input smoothing
 *   (`stringLength` default 50, follower moves by `t = min((d - L) / L, 1)`).
 *
 * Why this engine: the shipped variable-width inking rides perfect-freehand outlines, whose
 * smoothed offset outline can overshoot ("bulge") past the pressure-mapped radius on sharp
 * pressure spikes. The croquis construction is the exact convex hull of consecutive pressure
 * circles — tangent lines touch each circle analytically, so the stroke silhouette can never
 * exceed the local pressure diameter (웹툰 펜선의 벌지 없는 가변 굵기).
 *
 * Rendering model (polygon-union avoidance, by design): no self-made union/boolean step. Each
 * consecutive circle pair emits one convex closed hull loop (arc + tangent line + arc + tangent
 * line); all loops share one winding direction and are serialized into a single multi-subpath
 * SVG path filled with the default nonzero rule. Overlapping positively-wound loops render the
 * exact union in both Konva `<Path data>` and SVG export — the same `pathData` consumption path
 * as perfect-freehand outlines, so Canvas/SVG parity is automatic.
 *
 * Determinism: every export is a pure function of its inputs — no randomness, no clocks. The
 * fail-closed rule mirrors the outline contract discipline: invalid input or an unknown program
 * id yields empty geometry / `null`, never a silently different renderer.
 */

export const STUDIO_CROQUIS_CAPSULE_PEN_V1_VERSION = 1 as const;
export const STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM =
  "croquis.js@0.0.3:brush/simple.ts drawCapsule outer-bitangent" as const;
export const STUDIO_CROQUIS_PULLED_STRING_ALGORITHM =
  "croquis.js@0.0.3:stabilizer/pulled-string.ts" as const;

/** croquis.js `defaultPulledStringConfig.stringLength`. */
export const STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX = 50;

const MIN_PULLED_STRING_LENGTH_PX = 1;
const MAX_PULLED_STRING_LENGTH_PX = 512;
/** Matches the outline-contract diameter clamp so radii can never exceed plan bounds. */
const MAX_STROKE_DIAMETER = 8_192;
const DEFAULT_ARC_TOLERANCE_PX = 0.1;
const MIN_ARC_TOLERANCE_PX = 0.01;
const MAX_ARC_TOLERANCE_PX = 4;
/** Hard per-arc vertex cap — bounds worst-case geometry for huge brush radii. */
const MAX_ARC_SEGMENTS = 192;
const MIN_ARC_STEP_RADIANS = Math.PI / 96;

// ---------------------------------------------------------------------------
// Program pins — explicit opt-in, mirroring the wetEdgeBloomProgramId discipline
// ---------------------------------------------------------------------------

export type StudioCroquisCapsulePenProgramId =
  | "croquis-capsule-v1"
  | "croquis-capsule-pulled-string-v1";

export interface StudioCroquisCapsulePenProgram {
  readonly id: StudioCroquisCapsulePenProgramId;
  readonly algorithm: typeof STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM;
  /** Max chord sagitta for arc discretization, px (smaller = rounder caps/joins). */
  readonly arcTolerancePx: number;
  /**
   * `null` disables input smoothing. A number enables the croquis pulled-string prefilter with
   * this string length in px (croquis ships 50).
   */
  readonly pulledStringLengthPx: number | null;
}

/**
 * A brush id gains this engine only through an explicit catalog program pin. Absent pin means
 * the brush keeps its current renderer byte-identically; unknown/removed ids resolve to `null`
 * and the caller must fail visibly (hide the brush), never substitute another texture.
 */
export const STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS: Readonly<
  Record<StudioCroquisCapsulePenProgramId, StudioCroquisCapsulePenProgram>
> = Object.freeze({
  "croquis-capsule-v1": Object.freeze({
    id: "croquis-capsule-v1",
    algorithm: STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM,
    arcTolerancePx: DEFAULT_ARC_TOLERANCE_PX,
    pulledStringLengthPx: null,
  }),
  "croquis-capsule-pulled-string-v1": Object.freeze({
    id: "croquis-capsule-pulled-string-v1",
    algorithm: STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM,
    arcTolerancePx: DEFAULT_ARC_TOLERANCE_PX,
    pulledStringLengthPx: STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX,
  }),
} satisfies Record<StudioCroquisCapsulePenProgramId, StudioCroquisCapsulePenProgram>);

/** Fail-closed resolver: unknown ids return `null` — they must never reach another renderer. */
export function resolveStudioCroquisCapsulePenProgram(
  value: unknown,
): StudioCroquisCapsulePenProgram | null {
  if (typeof value !== "string" || !value) return null;
  const program =
    STUDIO_CROQUIS_CAPSULE_PEN_PROGRAMS[value as StudioCroquisCapsulePenProgramId];
  return program ?? null;
}

// ---------------------------------------------------------------------------
// Pulled-string stabilizer — pure positional prefilter (croquis stabilizer port)
// ---------------------------------------------------------------------------

export interface StudioCroquisPulledStringOptions {
  /** String length L in px; the follower only moves while the pointer is taut (d > L). */
  readonly stringLengthPx?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeStringLength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX;
  }
  return clamp(value, MIN_PULLED_STRING_LENGTH_PX, MAX_PULLED_STRING_LENGTH_PX);
}

/**
 * croquis.js pulled-string as a pure prefilter over a flat [x0,y0,x1,y1,...] polyline.
 *
 * Semantics match the stroke-protocol proxy: the follower starts at pointer-down and each
 * subsequent sample drags it only while the string is taut (`d > L`, step `t = min((d-L)/L, 1)`).
 * The final sample maps to the raw pointer-up position (croquis forwards `up(curr)` unfiltered),
 * so both endpoints are preserved exactly. Output length equals input length, therefore any
 * per-point pressure array stays index-aligned without resampling. Non-finite samples leave the
 * follower parked (emitted as the current follower position) instead of poisoning later points.
 */
export function applyStudioCroquisPulledStringPrefilter(
  points: readonly number[],
  options?: StudioCroquisPulledStringOptions,
): number[] {
  if (!Array.isArray(points) || points.length % 2 !== 0) return [];
  const pointCount = points.length / 2;
  if (pointCount === 0) return [];
  const stringLength = safeStringLength(options?.stringLengthPx);

  const firstX = points[0]!;
  const firstY = points[1]!;
  if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) return [...points];

  const output = new Array<number>(points.length);
  output[0] = firstX;
  output[1] = firstY;
  let followerX = firstX;
  let followerY = firstY;

  for (let index = 1; index < pointCount; index += 1) {
    const rawX = points[index * 2]!;
    const rawY = points[index * 2 + 1]!;
    if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
      const deltaX = rawX - followerX;
      const deltaY = rawY - followerY;
      // Verbatim croquis distance form so replays reproduce the library bit-for-bit.
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance > stringLength) {
        const t = Math.min((distance - stringLength) / stringLength, 1);
        followerX += deltaX * t;
        followerY += deltaY * t;
      }
    }
    output[index * 2] = followerX;
    output[index * 2 + 1] = followerY;
  }

  // croquis passes the raw pointer-up state to the target brush — preserve the endpoint.
  const lastX = points[points.length - 2]!;
  const lastY = points[points.length - 1]!;
  if (pointCount > 1 && Number.isFinite(lastX) && Number.isFinite(lastY)) {
    output[points.length - 2] = lastX;
    output[points.length - 1] = lastY;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Exact outer-bitangent capsule solve (croquis brush/simple.ts drawCapsule)
// ---------------------------------------------------------------------------

export interface StudioCroquisCapsuleCircle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface StudioCroquisCapsuleTangency {
  readonly kind: "capsule";
  /** Circle with the larger radius (ties keep input order: first circle wins). */
  readonly big: StudioCroquisCapsuleCircle;
  readonly small: StudioCroquisCapsuleCircle;
  /** Unit outward normals from each center toward its tangent point (shared by both circles). */
  readonly unitPlus: readonly [number, number];
  readonly unitMinus: readonly [number, number];
  /** Exact tangent points — each lies on its circle and the tangent line is ⟂ to its unit. */
  readonly bigPlus: readonly [number, number];
  readonly bigMinus: readonly [number, number];
  readonly smallPlus: readonly [number, number];
  readonly smallMinus: readonly [number, number];
}

export type StudioCroquisCapsuleSolution =
  | StudioCroquisCapsuleTangency
  | { readonly kind: "circle"; readonly circle: StudioCroquisCapsuleCircle }
  | { readonly kind: "empty" };

const EMPTY_SOLUTION: StudioCroquisCapsuleSolution = Object.freeze({ kind: "empty" });

/**
 * Solves the outer bitangent of two pressure circles.
 *
 * Equivalent to croquis `drawCapsule`: if the big circle swallows the small one
 * (`big.r >= small.r + d`, croquis case `big.r > small.r + d` plus the tangent-degenerate
 * boundary) only the big circle is drawn. Otherwise the two exact outer tangent lines are
 * returned in vector form: with D = small − big, r = big.r − small.r, s = √(d² − r²),
 * `u± = (r·D ± s·perp(D)) / d²` is a unit normal and the tangent points are
 * `big + big.r·u±` / `small + small.r·u±`. This is the same tangency croquis computes with its
 * coordinate-expanded case2 formula, without the `x || 1e-9` vertical-segment hack.
 */
export function solveStudioCroquisCapsule(
  c1: StudioCroquisCapsuleCircle,
  c2: StudioCroquisCapsuleCircle,
): StudioCroquisCapsuleSolution {
  if (
    !Number.isFinite(c1.x) || !Number.isFinite(c1.y) || !Number.isFinite(c1.r)
    || !Number.isFinite(c2.x) || !Number.isFinite(c2.y) || !Number.isFinite(c2.r)
  ) {
    return EMPTY_SOLUTION;
  }
  const r1 = Math.max(0, c1.r);
  const r2 = Math.max(0, c2.r);
  const c1IsBig = r1 >= r2;
  const big = c1IsBig ? { x: c1.x, y: c1.y, r: r1 } : { x: c2.x, y: c2.y, r: r2 };
  const small = c1IsBig ? { x: c2.x, y: c2.y, r: r2 } : { x: c1.x, y: c1.y, r: r1 };

  // croquis draws nothing at zero pressure (`if (curr.pressure <= 0) return`).
  if (big.r <= 0) return EMPTY_SOLUTION;
  const deltaX = small.x - big.x;
  const deltaY = small.y - big.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= 0 || big.r >= small.r + distance) {
    return Object.freeze({ kind: "circle", circle: Object.freeze(big) });
  }

  const radiusGap = big.r - small.r;
  const distanceSq = distance * distance;
  const side = Math.sqrt(Math.max(0, distanceSq - radiusGap * radiusGap));
  // Numerically internal-tangent (φ ≈ 0): the small circle pokes out by a sub-femtopixel
  // amount. Treat as swallowed so every emitted ring stays simple.
  if (side <= distance * 1e-12) {
    return Object.freeze({ kind: "circle", circle: Object.freeze(big) });
  }
  const unitPlusX = (radiusGap * deltaX - side * deltaY) / distanceSq;
  const unitPlusY = (radiusGap * deltaY + side * deltaX) / distanceSq;
  const unitMinusX = (radiusGap * deltaX + side * deltaY) / distanceSq;
  const unitMinusY = (radiusGap * deltaY - side * deltaX) / distanceSq;

  return Object.freeze({
    kind: "capsule",
    big: Object.freeze(big),
    small: Object.freeze(small),
    unitPlus: Object.freeze([unitPlusX, unitPlusY] as const),
    unitMinus: Object.freeze([unitMinusX, unitMinusY] as const),
    bigPlus: Object.freeze([big.x + big.r * unitPlusX, big.y + big.r * unitPlusY] as const),
    bigMinus: Object.freeze([big.x + big.r * unitMinusX, big.y + big.r * unitMinusY] as const),
    smallPlus: Object.freeze(
      [small.x + small.r * unitPlusX, small.y + small.r * unitPlusY] as const,
    ),
    smallMinus: Object.freeze(
      [small.x + small.r * unitMinusX, small.y + small.r * unitMinusY] as const,
    ),
  });
}

// ---------------------------------------------------------------------------
// Loop emission — convex hull ring per circle pair, consistent winding
// ---------------------------------------------------------------------------

function safeArcTolerance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ARC_TOLERANCE_PX;
  return clamp(value, MIN_ARC_TOLERANCE_PX, MAX_ARC_TOLERANCE_PX);
}

/** Segment count so each chord's sagitta stays within tolerance, hard-capped for huge radii. */
function arcSegmentCount(sweepRadians: number, radius: number, tolerancePx: number): number {
  if (sweepRadians <= 0 || radius <= 0) return 1;
  if (radius <= tolerancePx) {
    return Math.max(1, Math.ceil(sweepRadians / (Math.PI / 2)));
  }
  const step = Math.max(
    MIN_ARC_STEP_RADIANS,
    2 * Math.acos(clamp(1 - tolerancePx / radius, -1, 1)),
  );
  return Math.min(MAX_ARC_SEGMENTS, Math.max(1, Math.ceil(sweepRadians / step)));
}

function pushArcVertices(
  loop: number[][],
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  sweepRadians: number,
  tolerancePx: number,
  exactStart: readonly [number, number],
  exactEnd: readonly [number, number],
): void {
  if (radius <= 0) {
    loop.push([centerX, centerY]);
    return;
  }
  const segments = arcSegmentCount(sweepRadians, radius, tolerancePx);
  loop.push([exactStart[0], exactStart[1]]);
  for (let step = 1; step < segments; step += 1) {
    const angle = startAngle + (sweepRadians * step) / segments;
    loop.push([centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)]);
  }
  loop.push([exactEnd[0], exactEnd[1]]);
}

/** Full-circle ring, counter-clockwise in math orientation for winding consistency. */
function circleLoop(circle: StudioCroquisCapsuleCircle, tolerancePx: number): number[][] {
  const segments = Math.max(
    3,
    arcSegmentCount(Math.PI * 2, circle.r, tolerancePx),
  );
  const loop: number[][] = [];
  for (let step = 0; step < segments; step += 1) {
    const angle = (Math.PI * 2 * step) / segments;
    loop.push([
      circle.x + circle.r * Math.cos(angle),
      circle.y + circle.r * Math.sin(angle),
    ]);
  }
  return loop;
}

/**
 * Closed convex hull ring of one capsule solution. All rings produced by this function share
 * the same winding direction (arcs always sweep counter-clockwise), which the nonzero fill rule
 * requires for overlapping rings to render as their exact union.
 */
export function studioCroquisCapsuleLoop(
  solution: StudioCroquisCapsuleSolution,
  arcTolerancePx?: number,
): number[][] {
  const tolerance = safeArcTolerance(arcTolerancePx);
  if (solution.kind === "empty") return [];
  if (solution.kind === "circle") return circleLoop(solution.circle, tolerance);

  const { big, small, unitPlus, unitMinus } = solution;
  const anglePlus = Math.atan2(unitPlus[1], unitPlus[0]);
  const angleMinus = Math.atan2(unitMinus[1], unitMinus[0]);
  // u± sit at ±φ around the center axis (φ ∈ (0, π/2]); the big arc is the far side.
  let bigSweep = angleMinus - anglePlus;
  while (bigSweep <= 0) bigSweep += Math.PI * 2;
  let smallSweep = anglePlus - angleMinus;
  while (smallSweep <= 0) smallSweep += Math.PI * 2;

  const loop: number[][] = [];
  pushArcVertices(
    loop,
    big.x,
    big.y,
    big.r,
    anglePlus,
    bigSweep,
    tolerance,
    solution.bigPlus,
    solution.bigMinus,
  );
  pushArcVertices(
    loop,
    small.x,
    small.y,
    small.r,
    angleMinus,
    smallSweep,
    tolerance,
    solution.smallMinus,
    solution.smallPlus,
  );
  return loop;
}

// ---------------------------------------------------------------------------
// Stroke build — flat points + per-point radii → hull rings → nonzero pathData
// ---------------------------------------------------------------------------

export interface StudioCroquisCapsuleStrokeInput {
  /** Flat [x0,y0,x1,y1,...] — DrawEl.points shape, matching the outline contract input. */
  readonly points: readonly number[];
  /** Per-point stroke radius in px; length must equal the point count. */
  readonly radii: readonly number[];
  /** Arc discretization tolerance, px (default 0.1). */
  readonly arcTolerancePx?: number;
}

/**
 * croquis `stylusStateToCircle` for one sample: r = pressure × size × 0.5 (size = brush
 * diameter). Shared by the batch array map below and the incremental outline planner so both
 * produce the identical float per sample.
 */
export function studioCroquisCapsuleRadiusFromPressure(
  pressure: unknown,
  strokeWidth: number,
): number {
  const diameter = clamp(
    Number.isFinite(strokeWidth) ? strokeWidth : 0,
    0,
    MAX_STROKE_DIAMETER,
  );
  return typeof pressure === "number" && Number.isFinite(pressure)
    ? clamp(pressure, 0, 1) * diameter * 0.5
    : 0;
}

/** croquis `stylusStateToCircle`: r = pressure × size × 0.5 (size = brush diameter). */
export function studioCroquisCapsuleRadiiFromPressures(
  pressures: readonly number[],
  strokeWidth: number,
): number[] {
  const radii = new Array<number>(pressures.length);
  for (let index = 0; index < pressures.length; index += 1) {
    radii[index] = studioCroquisCapsuleRadiusFromPressure(pressures[index], strokeWidth);
  }
  return radii;
}

interface NormalizedStroke {
  readonly xs: number[];
  readonly ys: number[];
  readonly rs: number[];
}

/**
 * Validates and collapses consecutive duplicate positions (keeping the max radius — the union
 * of concentric circles is the larger circle, so this is exact). Returns `null` for malformed
 * input; the caller must surface that as invalid geometry, never as another brush texture.
 */
function normalizeStroke(input: StudioCroquisCapsuleStrokeInput): NormalizedStroke | null {
  const { points, radii } = input;
  if (!Array.isArray(points) || points.length % 2 !== 0) return null;
  const pointCount = points.length / 2;
  if (!Array.isArray(radii) || radii.length !== pointCount) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    const radius = radii[index];
    if (
      typeof x !== "number" || !Number.isFinite(x)
      || typeof y !== "number" || !Number.isFinite(y)
      || typeof radius !== "number" || !Number.isFinite(radius)
    ) {
      return null;
    }
    const safeRadius = clamp(radius, 0, MAX_STROKE_DIAMETER / 2);
    const lastIndex = xs.length - 1;
    if (lastIndex >= 0 && xs[lastIndex] === x && ys[lastIndex] === y) {
      rs[lastIndex] = Math.max(rs[lastIndex]!, safeRadius);
      continue;
    }
    xs.push(x);
    ys.push(y);
    rs.push(safeRadius);
  }
  return { xs, ys, rs };
}

/**
 * Builds the per-segment hull rings for a whole stroke. Each ring is a closed polygon in the
 * same `number[][]` vertex shape as a perfect-freehand outline (first vertex not repeated).
 * A single surviving point emits croquis's pointer-down dot circle. Malformed input → `[]`.
 */
export function buildStudioCroquisCapsuleStrokeLoops(
  input: StudioCroquisCapsuleStrokeInput,
): number[][][] {
  const stroke = normalizeStroke(input);
  if (!stroke) return [];
  const { xs, ys, rs } = stroke;
  const tolerance = safeArcTolerance(input.arcTolerancePx);
  const loops: number[][][] = [];

  if (xs.length === 1) {
    const radius = rs[0]!;
    if (radius > 0) {
      loops.push(circleLoop({ x: xs[0]!, y: ys[0]!, r: radius }, tolerance));
    }
    return loops;
  }

  for (let index = 1; index < xs.length; index += 1) {
    const solution = solveStudioCroquisCapsule(
      { x: xs[index - 1]!, y: ys[index - 1]!, r: rs[index - 1]! },
      { x: xs[index]!, y: ys[index]!, r: rs[index]! },
    );
    const loop = studioCroquisCapsuleLoop(solution, tolerance);
    if (loop.length > 0) loops.push(loop);
  }
  return loops;
}

/** Two-decimal rounding — the same deterministic serialization grid as the freehand adapter. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Serializes ONE hull ring into its `M … L … Z` subpath, or `null` when the ring is invisible at
 * serialization precision (fewer than 3 distinct 0.01px-grid vertices) or malformed. Extracted so
 * the incremental outline planner appends the identical bytes per stable ring that the batch
 * serializer below produces — single authority for the grid/dedupe/closing rules.
 */
export function studioCroquisCapsuleLoopToPathPart(
  loop: readonly (readonly number[])[],
): string | null {
  if (loop.length < 3) return null;
  const commands: string[] = [];
  let previousX = Number.NaN;
  let previousY = Number.NaN;
  for (const vertex of loop) {
    const rawX = vertex[0];
    const rawY = vertex[1];
    if (
      vertex.length < 2
      || typeof rawX !== "number" || !Number.isFinite(rawX)
      || typeof rawY !== "number" || !Number.isFinite(rawY)
    ) {
      return null;
    }
    const x = round2(rawX);
    const y = round2(rawY);
    if (x === previousX && y === previousY) continue;
    commands.push(commands.length === 0 ? `M${x} ${y}` : `L${x} ${y}`);
    previousX = x;
    previousY = y;
  }
  if (commands.length < 3) return null;
  // Drop a closing vertex that landed back on the start of the ring.
  const first = commands[0]!;
  if (`M${previousX} ${previousY}` === first) commands.pop();
  if (commands.length < 3) return null;
  commands.push("Z");
  return commands.join(" ");
}

/**
 * Serializes hull rings into one multi-subpath `d` string (`M … L … Z` per ring). Konva Path
 * and SVG `<path>` both fill with the nonzero rule by default, so the overlapping same-winding
 * rings render as their exact union on both surfaces. Consecutive vertices that collapse on the
 * 0.01px grid are dropped; rings with fewer than 3 distinct grid vertices are invisible at
 * serialization precision and are skipped.
 */
export function studioCroquisCapsuleLoopsToPathData(
  loops: readonly (readonly (readonly number[])[])[],
): string {
  const parts: string[] = [];
  for (const loop of loops) {
    const part = studioCroquisCapsuleLoopToPathPart(loop);
    if (part !== null) parts.push(part);
  }
  return parts.join(" ");
}

/** Stroke → nonzero multi-subpath `d` string in one call (empty string on invalid geometry). */
export function buildStudioCroquisCapsuleStrokePathData(
  input: StudioCroquisCapsuleStrokeInput,
): string {
  return studioCroquisCapsuleLoopsToPathData(buildStudioCroquisCapsuleStrokeLoops(input));
}
