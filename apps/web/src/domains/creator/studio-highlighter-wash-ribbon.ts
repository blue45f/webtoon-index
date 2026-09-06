/**
 * One-wash highlighter geometry shared by active Canvas, retained Canvas and SVG export.
 *
 * A translucent marker must not be painted as a chain of independently alpha-blended capsules:
 * every joint and self-intersection then receives pigment more than once. A single outline is not
 * sufficient either: a retrace or tight U-turn can make its two sides cross/cancel under the
 * non-zero winding rule. This planner instead emits same-winding segment bodies, joins and caps as
 * one compound path. The renderer still submits exactly one fill operation, so every point in one
 * gesture receives at most one wash while separate DrawEls retain normal multiply glazing.
 */

import type {
  StudioFxPressurePathPlan,
  StudioFxPressurePathSegment,
} from "./studio-fx-brush";

export const STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION =
  "highlighter-wash-ribbon-v2" as const;

export type StudioHighlighterWashBrushId =
  | "highlighter"
  | "chisel-highlighter"
  | "pastel-highlighter";

export type StudioHighlighterCapProfile =
  | "round-superellipse"
  | "soft-flat"
  | "pastel-natural";

export function resolveStudioHighlighterWashBrushId(
  value: unknown,
): StudioHighlighterWashBrushId {
  return value === "chisel-highlighter" || value === "pastel-highlighter"
    ? value
    : "highlighter";
}

export interface StudioHighlighterWashRun {
  /** One same-winding closed coverage polygon inside the gesture's compound fill. */
  readonly outlinePoints: readonly number[];
  readonly flattenedSegmentCount: number;
  readonly role: "body" | "join" | "start-cap" | "end-cap" | "tap";
}

/**
 * Second wash: where a felt marker actually leaves more pigment than its own average.
 *
 * A highlighter is not a rectangle of uniform dye. Solvent migrates to the wet boundary and dries
 * there, so the rim of a stroke is visibly darker than its middle — "edge pooling" — and the felt
 * chisel's fibre bundles drag streaks of extra ink along the travel direction. Without them the
 * measured stroke printed exactly ONE alpha value over its whole area: a flat translucent bar.
 *
 * These runs form their own compound path and are filled ONCE, exactly like the base wash, so the
 * module's central invariant survives: any point of one gesture receives at most one base wash and
 * at most one detail wash, no matter how the gesture crosses itself.
 */
export interface StudioHighlighterWashDetailRun {
  readonly outlinePoints: readonly number[];
  readonly role: "edge-pool" | "fibre";
}

export interface StudioHighlighterWashPlan {
  readonly version: typeof STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION;
  readonly brushId: StudioHighlighterWashBrushId;
  readonly capProfile: StudioHighlighterCapProfile;
  readonly gesture: "stroke" | "tap";
  readonly sourceSegmentCount: number;
  readonly flattenedSegmentCount: number;
  readonly capped: boolean;
  /**
   * Whole-gesture pigment response. Width remains local, but alpha is intentionally one wash
   * value so self-crossings cannot build up inside a single DrawEl.
   */
  readonly opacityScale: number;
  readonly runs: readonly StudioHighlighterWashRun[];
  /** Rim pooling and fibre streaks, filled as one additional pass over the base wash. */
  readonly detailRuns: readonly StudioHighlighterWashDetailRun[];
  /** Alpha of that second pass, relative to the gesture's own wash. */
  readonly detailOpacityScale: number;
}

export interface StudioHighlighterWashPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface FlatSection {
  readonly from: Point;
  readonly to: Point;
  readonly halfWidth: number;
  readonly opacityScale: number;
}

interface Direction {
  readonly x: number;
  readonly y: number;
}

interface CapSettings {
  readonly extensionScale: number;
  readonly exponent: number;
  readonly roughness: number;
}

const COORDINATE_LIMIT = 1_000_000_000;
const WIDTH_LIMIT = 4_096;
const POINT_EPSILON = 1e-6;
const CONTINUITY_EPSILON = 1e-4;
const MAX_FLATTENED_SEGMENTS = 262_144;
const MAX_SUBDIVISIONS_PER_SEGMENT = 16;
const CAP_STEPS = 18;
const JOIN_STEPS = 12;
const TAP_STEPS = 28;
const QUANTIZE_SCALE = 10_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number): number {
  const result = Math.round(value * QUANTIZE_SCALE) / QUANTIZE_SCALE;
  return Object.is(result, -0) ? 0 : result;
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, -COORDINATE_LIMIT, COORDINATE_LIMIT)
    : null;
}

function finiteWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clamp(value, 0.5, WIDTH_LIMIT)
    : null;
}

function normalizedDirection(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= POINT_EPSILON) return null;
  return Object.freeze({ x: dx / length, y: dy / length });
}

function samePoint(left: Point, right: Point): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= CONTINUITY_EPSILON;
}

function highlighterCapProfile(
  brushId: StudioHighlighterWashBrushId,
): StudioHighlighterCapProfile {
  if (brushId === "chisel-highlighter") return "soft-flat";
  if (brushId === "pastel-highlighter") return "pastel-natural";
  return "round-superellipse";
}

function capSettings(profile: StudioHighlighterCapProfile): CapSettings {
  switch (profile) {
    case "soft-flat":
      return Object.freeze({
        // A compact outward bulge keeps the broad nib readable without a hard rectangular seam.
        extensionScale: 0.2,
        exponent: 3.6,
        roughness: 0,
      });
    case "pastel-natural":
      return Object.freeze({
        extensionScale: 0.68,
        exponent: 1.9,
        roughness: 0.055,
      });
    case "round-superellipse":
      return Object.freeze({
        // Slightly flatter than a circle, like a compressed felt nib rather than a UI capsule.
        extensionScale: 0.76,
        exponent: 2.25,
        roughness: 0,
      });
  }
}

function signedUnitNoise(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 17, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1;
}

function roughScale(
  profile: StudioHighlighterCapProfile,
  index: number,
  salt: number,
): number {
  const amount = capSettings(profile).roughness;
  return amount === 0 ? 1 : 1 + signedUnitNoise(index, salt) * amount;
}

function pointAt(
  segment: StudioFxPressurePathSegment,
  progress: number,
): Point {
  const t = clamp(progress, 0, 1);
  const inverse = 1 - t;
  if (segment.command === "cubic") {
    return Object.freeze({
      x: inverse ** 3 * segment.moveX
        + 3 * inverse * inverse * t * segment.control1X
        + 3 * inverse * t * t * segment.control2X
        + t ** 3 * segment.endX,
      y: inverse ** 3 * segment.moveY
        + 3 * inverse * inverse * t * segment.control1Y
        + 3 * inverse * t * t * segment.control2Y
        + t ** 3 * segment.endY,
    });
  }
  if (segment.command === "quadratic") {
    return Object.freeze({
      x: inverse * inverse * segment.moveX
        + 2 * inverse * t * segment.controlX
        + t * t * segment.endX,
      y: inverse * inverse * segment.moveY
        + 2 * inverse * t * segment.controlY
        + t * t * segment.endY,
    });
  }
  return Object.freeze({
    x: segment.moveX + (segment.endX - segment.moveX) * t,
    y: segment.moveY + (segment.endY - segment.moveY) * t,
  });
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= POINT_EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(
    dy * point.x
    - dx * point.y
    + end.x * start.y
    - end.y * start.x,
  ) / length;
}

function flattenSubdivisionCount(
  segment: StudioFxPressurePathSegment,
  baseWidth: number,
): number {
  if (segment.command === "line") return 1;
  const start = { x: segment.moveX, y: segment.moveY };
  const end = { x: segment.endX, y: segment.endY };
  const flatness = segment.command === "cubic"
    ? Math.max(
        pointLineDistance(
          { x: segment.control1X, y: segment.control1Y },
          start,
          end,
        ),
        pointLineDistance(
          { x: segment.control2X, y: segment.control2Y },
          start,
          end,
        ),
      )
    : pointLineDistance(
        { x: segment.controlX, y: segment.controlY },
        start,
        end,
      );
  const tolerance = clamp(baseWidth * 0.025, 0.1, 0.55);
  if (!Number.isFinite(flatness) || flatness <= tolerance) return 1;
  return clamp(
    2 ** Math.ceil(Math.log2(Math.sqrt(flatness / tolerance))),
    1,
    MAX_SUBDIVISIONS_PER_SEGMENT,
  );
}

function flattenPressurePath(
  pressurePath: StudioFxPressurePathPlan,
  baseWidth: number,
): { sections: readonly FlatSection[]; capped: boolean } {
  const sections: FlatSection[] = [];
  let capped = false;
  for (const segment of pressurePath.segments) {
    const widthScale = Number.isFinite(segment.widthScale)
      ? clamp(segment.widthScale, 0.025, WIDTH_LIMIT / baseWidth)
      : 1;
    const opacityScale = Number.isFinite(segment.opacityScale)
      ? clamp(segment.opacityScale, 0, 1)
      : 1;
    const subdivisions = flattenSubdivisionCount(segment, baseWidth);
    let from = pointAt(segment, 0);
    for (let index = 1; index <= subdivisions; index += 1) {
      if (sections.length >= MAX_FLATTENED_SEGMENTS) {
        capped = true;
        return { sections: Object.freeze(sections), capped };
      }
      const to = pointAt(segment, index / subdivisions);
      if (normalizedDirection(from, to)) {
        sections.push(Object.freeze({
          from,
          to,
          halfWidth: clamp(baseWidth * widthScale / 2, 0.25, WIDTH_LIMIT / 2),
          opacityScale,
        }));
      }
      from = to;
    }
  }
  return { sections: Object.freeze(sections), capped };
}

function splitContinuousRuns(
  sections: readonly FlatSection[],
): readonly (readonly FlatSection[])[] {
  const runs: FlatSection[][] = [];
  let active: FlatSection[] = [];
  for (const section of sections) {
    const previous = active.at(-1);
    if (previous && !samePoint(previous.to, section.from)) {
      runs.push(active);
      active = [];
    }
    active.push(section);
  }
  if (active.length > 0) runs.push(active);
  return Object.freeze(runs.map((run) => Object.freeze(run)));
}

function signedPower(value: number, exponent: number): number {
  if (value === 0) return 0;
  return Math.sign(value) * Math.abs(value) ** exponent;
}

function polygonSignedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    area += points[index]! * points[nextIndex + 1]!
      - points[nextIndex]! * points[index + 1]!;
  }
  return area / 2;
}

/**
 * Non-zero compound paths behave as a geometric union only when every overlapping subpath has
 * the same winding. Normalise here because reversed input segments otherwise cancel an exact
 * retrace even though the renderer performs only one fill.
 */
function sameWinding(points: readonly number[]): readonly number[] {
  if (polygonSignedArea(points) >= 0) return Object.freeze([...points]);
  const reversed: number[] = [];
  for (let index = points.length - 2; index >= 0; index -= 2) {
    reversed.push(points[index]!, points[index + 1]!);
  }
  return Object.freeze(reversed);
}

function footprintOutline(
  center: Point,
  direction: Direction,
  radius: number,
  profile: StudioHighlighterCapProfile,
  salt: number,
  steps: number,
  extensionScale = capSettings(profile).extensionScale,
): readonly number[] {
  const settings = capSettings(profile);
  const normal = { x: -direction.y, y: direction.x };
  const points: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = Math.PI * 2 * (step / steps);
    const shapeExponent = 2 / settings.exponent;
    const along = signedPower(Math.cos(angle), shapeExponent)
      * radius
      * extensionScale;
    const across = signedPower(Math.sin(angle), shapeExponent) * radius;
    const rough = roughScale(profile, step, salt);
    points.push(
      quantize(center.x + (direction.x * along + normal.x * across) * rough),
      quantize(center.y + (direction.y * along + normal.y * across) * rough),
    );
  }
  return sameWinding(points);
}

function bodyOutline(section: FlatSection): readonly number[] {
  const direction = normalizedDirection(section.from, section.to)!;
  const normal = { x: -direction.y, y: direction.x };
  const offsetX = normal.x * section.halfWidth;
  const offsetY = normal.y * section.halfWidth;
  return sameWinding([
    quantize(section.from.x + offsetX),
    quantize(section.from.y + offsetY),
    quantize(section.to.x + offsetX),
    quantize(section.to.y + offsetY),
    quantize(section.to.x - offsetX),
    quantize(section.to.y - offsetY),
    quantize(section.from.x - offsetX),
    quantize(section.from.y - offsetY),
  ]);
}

function joinDirection(previous: Direction, next: Direction): Direction {
  const x = previous.x + next.x;
  const y = previous.y + next.y;
  const length = Math.hypot(x, y);
  // An exact reversal has no stable bisector. The following segment is deterministic and the
  // join is circular, so its orientation does not affect coverage.
  return length <= POINT_EPSILON
    ? next
    : Object.freeze({ x: x / length, y: y / length });
}

function compoundCoverage(
  sections: readonly FlatSection[],
  profile: StudioHighlighterCapProfile,
  runIndex: number,
): readonly StudioHighlighterWashRun[] {
  const directions = sections.map((section) => normalizedDirection(section.from, section.to)!);
  const coverage: StudioHighlighterWashRun[] = sections.map((section) => (
    Object.freeze({
      outlinePoints: bodyOutline(section),
      flattenedSegmentCount: 1,
      role: "body" as const,
    })
  ));

  for (let sectionIndex = 1; sectionIndex < sections.length; sectionIndex += 1) {
    const previous = sections[sectionIndex - 1]!;
    const next = sections[sectionIndex]!;
    coverage.push(Object.freeze({
      // A circular join is deliberately profile-neutral. It covers the entire shared cross
      // section at sharp corners/reversals without adding a second alpha pass.
      outlinePoints: footprintOutline(
        previous.to,
        joinDirection(directions[sectionIndex - 1]!, directions[sectionIndex]!),
        Math.max(previous.halfWidth, next.halfWidth),
        "round-superellipse",
        runIndex * 4099 + sectionIndex,
        JOIN_STEPS,
        1,
      ),
      flattenedSegmentCount: 0,
      role: "join",
    }));
  }

  const first = sections[0]!;
  const last = sections.at(-1)!;
  coverage.push(
    Object.freeze({
      outlinePoints: footprintOutline(
        first.from,
        directions[0]!,
        first.halfWidth,
        profile,
        runIndex * 2 + 401,
        CAP_STEPS * 2,
      ),
      flattenedSegmentCount: 0,
      role: "start-cap",
    }),
    Object.freeze({
      outlinePoints: footprintOutline(
        last.to,
        directions.at(-1)!,
        last.halfWidth,
        profile,
        runIndex * 2 + 307,
        CAP_STEPS * 2,
      ),
      flattenedSegmentCount: 0,
      role: "end-cap",
    }),
  );
  return Object.freeze(coverage);
}

/**
 * Detail-wash character per marker.
 *
 * `poolRatio` is the rim band as a fraction of the half width; `fibreCount` is how many streaks the
 * chisel drags; `fibreDuty` is the fraction of the travel a streak actually deposits on (a felt
 * fibre skips); `opacityScale` is the second wash's strength relative to the first.
 */
const HIGHLIGHTER_DETAIL_PROFILES: Readonly<Record<
  StudioHighlighterWashBrushId,
  { poolRatio: number; fibreCount: number; fibreDuty: number; opacityScale: number }
>> = {
  // Chisel felt: strong rim, few broad fibre bundles.
  highlighter: { poolRatio: 0.2, fibreCount: 3, fibreDuty: 0.55, opacityScale: 0.34 },
  // A wider flat chisel spreads the same dye over more area: thinner rim, more bundles.
  "chisel-highlighter": { poolRatio: 0.16, fibreCount: 4, fibreDuty: 0.6, opacityScale: 0.3 },
  // Pastel ink is already granular from its own cap roughness; keep the second wash gentle.
  "pastel-highlighter": { poolRatio: 0.18, fibreCount: 3, fibreDuty: 0.5, opacityScale: 0.24 },
};

/**
 * Steps a felt fibre keeps its state for, on average.
 *
 * The gate below used to draw an INDEPENDENT sample per step, and a step is 1.6 nib widths, so a
 * fibre could only ever deposit for one step at a time: at duty 0.55 the streaks came out as a
 * scatter of short bars, roughly one nib-and-a-half long, with the same chance of stopping at
 * every boundary. That reads as debris on a flat bar, not as a felt tip dragging.
 *
 * A fibre skips over a scale set by the tip, not by the sampler. Five steps is about eight nib
 * widths of travel — long enough that a streak is unmistakably a drag, short enough that a
 * highlighter stroke still breaks up several times across a word.
 */
const HIGHLIGHTER_FIBRE_RUN_STEPS = 5;

function fibreHash(knot: number, fibreIndex: number): number {
  const hash = Math.sin((knot + 1) * 12.9898 + (fibreIndex + 1) * 78.233) * 43_758.545_3;
  return hash - Math.floor(hash);
}

/**
 * Deterministic per-(section, fibre) duty gate — no RNG so replay and export stay identical.
 *
 * Value noise over the step index rather than an independent draw: the gate holds its state for a
 * stretch of travel and then changes, so a fibre deposits in runs and lifts in runs. The duty is
 * unchanged on average, and the same (section, fibre) still yields the same answer, so both
 * surfaces and every replay agree exactly as before.
 */
function fibreDeposits(sectionIndex: number, fibreIndex: number, duty: number): boolean {
  const t = sectionIndex / HIGHLIGHTER_FIBRE_RUN_STEPS;
  const knot = Math.floor(t);
  const fraction = t - knot;
  const start = fibreHash(knot, fibreIndex);
  const end = fibreHash(knot + 1, fibreIndex);
  // Smoothstep so the gate has no corner where it crosses the duty threshold.
  const eased = fraction * fraction * (3 - 2 * fraction);
  return start + (end - start) * eased < duty;
}

function bandOutline(
  section: FlatSection,
  innerRatio: number,
  outerRatio: number,
): readonly number[] {
  const direction = normalizedDirection(section.from, section.to);
  if (!direction) return Object.freeze([]);
  const normal = { x: -direction.y, y: direction.x };
  const inner = section.halfWidth * innerRatio;
  const outer = section.halfWidth * outerRatio;
  return sameWinding([
    quantize(section.from.x + normal.x * inner),
    quantize(section.from.y + normal.y * inner),
    quantize(section.to.x + normal.x * inner),
    quantize(section.to.y + normal.y * inner),
    quantize(section.to.x + normal.x * outer),
    quantize(section.to.y + normal.y * outer),
    quantize(section.from.x + normal.x * outer),
    quantize(section.from.y + normal.y * outer),
  ]);
}

/**
 * Cut the flattened path into equal arc-length steps.
 *
 * The detail wash cannot be keyed to sections: a straight, constant-pressure gesture flattens into
 * a handful of very long sections, so per-section modulation would hold one value for the whole
 * stroke — which is exactly the flat bar being fixed. Stepping by a multiple of the nib width makes
 * the rim swell and the fibres skip on the scale of the nib, independent of how the input happened
 * to be sampled.
 */
function stepSections(sections: readonly FlatSection[]): readonly FlatSection[] {
  const stepped: FlatSection[] = [];
  for (const section of sections) {
    const length = Math.hypot(
      section.to.x - section.from.x,
      section.to.y - section.from.y,
    );
    const step = Math.max(POINT_EPSILON, section.halfWidth * 1.6);
    const count = Math.min(4_096, Math.max(1, Math.ceil(length / step)));
    for (let index = 0; index < count; index += 1) {
      const t0 = index / count;
      const t1 = (index + 1) / count;
      stepped.push(Object.freeze({
        from: Object.freeze({
          x: section.from.x + (section.to.x - section.from.x) * t0,
          y: section.from.y + (section.to.y - section.from.y) * t0,
        }),
        to: Object.freeze({
          x: section.from.x + (section.to.x - section.from.x) * t1,
          y: section.from.y + (section.to.y - section.from.y) * t1,
        }),
        halfWidth: section.halfWidth,
        opacityScale: section.opacityScale,
      }));
    }
  }
  return Object.freeze(stepped);
}

function planDetailRuns(
  flatSections: readonly FlatSection[],
  brushId: StudioHighlighterWashBrushId,
): readonly StudioHighlighterWashDetailRun[] {
  const profile = HIGHLIGHTER_DETAIL_PROFILES[brushId];
  const sections = stepSections(flatSections);
  const runs: StudioHighlighterWashDetailRun[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    for (const [sideIndex, side] of ([1, -1] as const).entries()) {
      // Pooling is uneven: the wet edge dries where it happens to stall, so the rim thickens,
      // thins and breaks as the marker travels. An unbroken rim of constant thickness is just a
      // second flat bar — the outermost row would carry one alpha for the whole stroke.
      if (!fibreDeposits(sectionIndex, 11 + sideIndex, 0.72)) continue;
      const swell = 0.55
        + (fibreDeposits(sectionIndex, 23 + sideIndex, 0.5) ? 0.85 : 0.2);
      const outline = bandOutline(
        section,
        side * (1 - profile.poolRatio * swell),
        side * 1,
      );
      if (outline.length > 0) {
        runs.push(Object.freeze({ outlinePoints: outline, role: "edge-pool" as const }));
      }
    }
    for (let fibreIndex = 0; fibreIndex < profile.fibreCount; fibreIndex += 1) {
      if (!fibreDeposits(sectionIndex, fibreIndex, profile.fibreDuty)) continue;
      // Fibres sit inside the rim so they read as bundle streaks, not as a second rim.
      const centre = -0.62 + (1.24 * (fibreIndex + 0.5)) / profile.fibreCount;
      const halfBand = 0.62 / profile.fibreCount / 2;
      const outline = bandOutline(section, centre - halfBand, centre + halfBand);
      if (outline.length > 0) {
        runs.push(Object.freeze({ outlinePoints: outline, role: "fibre" as const }));
      }
    }
  }
  return Object.freeze(runs);
}

function weightedOpacity(sections: readonly FlatSection[]): number {
  let weighted = 0;
  let distance = 0;
  for (const section of sections) {
    const length = Math.hypot(
      section.to.x - section.from.x,
      section.to.y - section.from.y,
    );
    weighted += section.opacityScale * length;
    distance += length;
  }
  if (distance <= POINT_EPSILON) return 1;
  return clamp(weighted / distance, 0, 1);
}

export function planStudioHighlighterWashRibbon(input: {
  readonly brushId: StudioHighlighterWashBrushId;
  readonly pressurePath: StudioFxPressurePathPlan;
  readonly baseWidth: unknown;
}): StudioHighlighterWashPlan {
  const baseWidth = finiteWidth(input.baseWidth);
  const profile = highlighterCapProfile(input.brushId);
  if (baseWidth === null) {
    return Object.freeze({
      version: STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION,
      brushId: input.brushId,
      capProfile: profile,
      gesture: "stroke",
      sourceSegmentCount: input.pressurePath.segments.length,
      flattenedSegmentCount: 0,
      capped: false,
      opacityScale: 1,
      runs: Object.freeze([]),
      detailRuns: Object.freeze([]),
      detailOpacityScale: 0,
    });
  }
  const flattened = flattenPressurePath(input.pressurePath, baseWidth);
  const split = splitContinuousRuns(flattened.sections);
  const runs = split.flatMap(
    (sections, runIndex) => compoundCoverage(sections, profile, runIndex),
  );
  return Object.freeze({
    version: STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION,
    brushId: input.brushId,
    capProfile: profile,
    gesture: "stroke",
    sourceSegmentCount: input.pressurePath.segments.length,
    flattenedSegmentCount: flattened.sections.length,
    capped: flattened.capped,
    opacityScale: weightedOpacity(flattened.sections),
    runs: Object.freeze(runs),
    detailRuns: planDetailRuns(flattened.sections, input.brushId),
    detailOpacityScale: HIGHLIGHTER_DETAIL_PROFILES[input.brushId].opacityScale,
  });
}

export interface StudioIncrementalHighlighterWashRibbonBuilder {
  /**
   * 배치 `planStudioHighlighterWashRibbon`과 값이 정확히 같은 플랜을 돌려주되, 압력 경로의
   * 안정 prefix 구간에서 평탄화 섹션·본체/조인 커버리지·디테일 워시를 호출 사이에 유지한다.
   *
   * `stableSegmentCount`는 상류 증분 압력 경로 빌더가 보증하는 append 전용 세그먼트 prefix
   * 길이이고, `sourceGeneration`은 그 보증이 깨질 때 증가하는 세대 카운터다. 캡(끝막) 두 개와
   * 휘발 꼬리는 매 호출 다시 만들고, 최종 `runs`/`detailRuns` 배열 조립은 참조 밀어넣기라
   * 기하 연산은 새 섹션 수에만 비례한다. 반환 배열은 다음 `plan()` 호출까지만 유효하다.
   */
  plan(
    input: {
      readonly brushId: StudioHighlighterWashBrushId;
      readonly pressurePath: StudioFxPressurePathPlan;
      readonly baseWidth: unknown;
    },
    stableSegmentCount: number,
    sourceGeneration: number,
  ): StudioHighlighterWashPlan;
}

/**
 * 증분 하이라이터 워시 빌더.
 *
 * 배치 플래너의 단계는 모두 앞으로만 흐른다: 평탄화는 세그먼트별 순수 사상, 연속 런 분할은
 * 직전 섹션과의 연속성만 보고, 커버리지의 본체/조인은 이웃 섹션 쌍의 국소 함수이며, 디테일
 * 워시 게이트는 전역 스텝 인덱스의 결정적 함수다. 런 하나의 커버리지가 [본체들, 조인들,
 * 캡 2개] 순서로 묶여 있어 활성 런은 블록별로 따로 유지하고 호출마다 순서대로 이어 붙인다 —
 * 참조 복사일 뿐 기하 재계산이 아니므로 이동당 기하 비용은 새 섹션 수에 비례한다.
 */
export function createStudioIncrementalHighlighterWashRibbonBuilder(): StudioIncrementalHighlighterWashRibbonBuilder {
  let generation: number | null = null;
  let configBrushId: StudioHighlighterWashBrushId | null = null;
  let configBaseWidth = 0;

  /** 평탄화 섹션(안정 prefix + 이번 호출의 휘발 꼬리 — 꼬리는 다음 호출에서 걷어낸다). */
  const sections: FlatSection[] = [];
  let stableSectionCount = 0;
  let consumedSegments = 0;
  /** 배치 평탄화가 캡에서 함수 전체를 반환하는 지점 — 이후 세그먼트는 영원히 무시된다. */
  let stableStopped = false;
  let stableCapped = false;
  let stableWeighted = 0;
  let stableDistance = 0;

  /** 닫힌 런들의 커버리지(순서대로) — 활성 런 앞부분. */
  const closedCoverage: StudioHighlighterWashRun[] = [];
  /** 활성 런의 안정 블록: 본체 / 조인. 캡은 매 호출 다시 만든다. */
  const activeBodies: StudioHighlighterWashRun[] = [];
  const activeJoins: StudioHighlighterWashRun[] = [];
  let activeRunIndex = 0;
  let activeSectionCount = 0;
  let activeFirstSection: FlatSection | null = null;
  let activeFirstDirection: Direction | null = null;
  let activeLastSection: FlatSection | null = null;
  let activeLastDirection: Direction | null = null;

  /** 디테일 워시(안정 prefix + 휘발 꼬리) + 전역 스텝 인덱스. */
  const detailRuns: StudioHighlighterWashDetailRun[] = [];
  let stableDetailCount = 0;
  let stableSteppedCount = 0;

  const reset = (): void => {
    sections.length = 0;
    stableSectionCount = 0;
    consumedSegments = 0;
    stableStopped = false;
    stableCapped = false;
    stableWeighted = 0;
    stableDistance = 0;
    closedCoverage.length = 0;
    activeBodies.length = 0;
    activeJoins.length = 0;
    activeRunIndex = 0;
    activeSectionCount = 0;
    activeFirstSection = null;
    activeFirstDirection = null;
    activeLastSection = null;
    activeLastDirection = null;
    detailRuns.length = 0;
    stableDetailCount = 0;
    stableSteppedCount = 0;
  };

  const bodyRun = (section: FlatSection): StudioHighlighterWashRun => Object.freeze({
    outlinePoints: bodyOutline(section),
    flattenedSegmentCount: 1,
    role: "body" as const,
  });

  const joinRun = (
    previous: FlatSection,
    previousDirection: Direction,
    next: FlatSection,
    nextDirection: Direction,
    runIndex: number,
    sectionIndexInRun: number,
  ): StudioHighlighterWashRun => Object.freeze({
    outlinePoints: footprintOutline(
      previous.to,
      joinDirection(previousDirection, nextDirection),
      Math.max(previous.halfWidth, next.halfWidth),
      "round-superellipse",
      runIndex * 4099 + sectionIndexInRun,
      JOIN_STEPS,
      1,
    ),
    flattenedSegmentCount: 0,
    role: "join" as const,
  });

  const startCapRun = (
    profile: StudioHighlighterCapProfile,
    first: FlatSection,
    firstDirection: Direction,
    runIndex: number,
  ): StudioHighlighterWashRun => Object.freeze({
    outlinePoints: footprintOutline(
      first.from,
      firstDirection,
      first.halfWidth,
      profile,
      runIndex * 2 + 401,
      CAP_STEPS * 2,
    ),
    flattenedSegmentCount: 0,
    role: "start-cap" as const,
  });

  const endCapRun = (
    profile: StudioHighlighterCapProfile,
    last: FlatSection,
    lastDirection: Direction,
    runIndex: number,
  ): StudioHighlighterWashRun => Object.freeze({
    outlinePoints: footprintOutline(
      last.to,
      lastDirection,
      last.halfWidth,
      profile,
      runIndex * 2 + 307,
      CAP_STEPS * 2,
    ),
    flattenedSegmentCount: 0,
    role: "end-cap" as const,
  });

  /** `planDetailRuns` 한 평탄화 섹션 분 — 전역 스텝 인덱스를 이어가며 target 에 밀어넣는다. */
  const emitDetailForSection = (
    section: FlatSection,
    brushId: StudioHighlighterWashBrushId,
    steppedIndexStart: number,
    target: StudioHighlighterWashDetailRun[],
  ): number => {
    const profile = HIGHLIGHTER_DETAIL_PROFILES[brushId];
    const length = Math.hypot(
      section.to.x - section.from.x,
      section.to.y - section.from.y,
    );
    const step = Math.max(POINT_EPSILON, section.halfWidth * 1.6);
    const count = Math.min(4_096, Math.max(1, Math.ceil(length / step)));
    let sectionIndex = steppedIndexStart;
    for (let index = 0; index < count; index += 1) {
      const t0 = index / count;
      const t1 = (index + 1) / count;
      const stepped: FlatSection = Object.freeze({
        from: Object.freeze({
          x: section.from.x + (section.to.x - section.from.x) * t0,
          y: section.from.y + (section.to.y - section.from.y) * t0,
        }),
        to: Object.freeze({
          x: section.from.x + (section.to.x - section.from.x) * t1,
          y: section.from.y + (section.to.y - section.from.y) * t1,
        }),
        halfWidth: section.halfWidth,
        opacityScale: section.opacityScale,
      });
      for (const [sideIndex, side] of ([1, -1] as const).entries()) {
        if (!fibreDeposits(sectionIndex, 11 + sideIndex, 0.72)) continue;
        const swell = 0.55
          + (fibreDeposits(sectionIndex, 23 + sideIndex, 0.5) ? 0.85 : 0.2);
        const outline = bandOutline(
          stepped,
          side * (1 - profile.poolRatio * swell),
          side * 1,
        );
        if (outline.length > 0) {
          target.push(Object.freeze({ outlinePoints: outline, role: "edge-pool" as const }));
        }
      }
      for (let fibreIndex = 0; fibreIndex < profile.fibreCount; fibreIndex += 1) {
        if (!fibreDeposits(sectionIndex, fibreIndex, profile.fibreDuty)) continue;
        const centre = -0.62 + (1.24 * (fibreIndex + 0.5)) / profile.fibreCount;
        const halfBand = 0.62 / profile.fibreCount / 2;
        const outline = bandOutline(stepped, centre - halfBand, centre + halfBand);
        if (outline.length > 0) {
          target.push(Object.freeze({ outlinePoints: outline, role: "fibre" as const }));
        }
      }
      sectionIndex += 1;
    }
    return sectionIndex;
  };

  return {
    plan(input, stableSegmentCount, sourceGeneration) {
      const baseWidth = finiteWidth(input.baseWidth);
      const profile = highlighterCapProfile(input.brushId);
      if (baseWidth === null) {
        // 배치의 무효 폭 분기 그대로 — 상태는 비워 다음 유효 입력부터 다시 쌓는다.
        reset();
        generation = null;
        return {
          version: STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION,
          brushId: input.brushId,
          capProfile: profile,
          gesture: "stroke",
          sourceSegmentCount: input.pressurePath.segments.length,
          flattenedSegmentCount: 0,
          capped: false,
          opacityScale: 1,
          runs: [],
          detailRuns: [],
          detailOpacityScale: 0,
        };
      }
      const segments = input.pressurePath.segments;
      const stableSegments = Math.max(0, Math.min(stableSegmentCount, segments.length));
      if (
        generation !== sourceGeneration
        || configBrushId !== input.brushId
        || configBaseWidth !== baseWidth
        || stableSegments < consumedSegments
      ) {
        reset();
        generation = sourceGeneration;
        configBrushId = input.brushId;
        configBaseWidth = baseWidth;
      }

      // 1. 휘발 꼬리 걷어내기.
      sections.length = stableSectionCount;
      detailRuns.length = stableDetailCount;

      // 배치 평탄화 루프 본문 한 세그먼트 분. `true` = 평탄화 캡 도달(배치의 조기 반환).
      const flattenSegmentInto = (
        segment: StudioFxPressurePathSegment,
      ): boolean => {
        const widthScale = Number.isFinite(segment.widthScale)
          ? clamp(segment.widthScale, 0.025, WIDTH_LIMIT / baseWidth)
          : 1;
        const opacityScale = Number.isFinite(segment.opacityScale)
          ? clamp(segment.opacityScale, 0, 1)
          : 1;
        const subdivisions = flattenSubdivisionCount(segment, baseWidth);
        let from = pointAt(segment, 0);
        for (let index = 1; index <= subdivisions; index += 1) {
          if (sections.length >= MAX_FLATTENED_SEGMENTS) return true;
          const to = pointAt(segment, index / subdivisions);
          if (normalizedDirection(from, to)) {
            sections.push(Object.freeze({
              from,
              to,
              halfWidth: clamp(baseWidth * widthScale / 2, 0.25, WIDTH_LIMIT / 2),
              opacityScale,
            }));
          }
          from = to;
        }
        return false;
      };

      // 2. 새 안정 세그먼트 소비: 섹션 → 활성 런 본체/조인 → 닫힌 런 커버리지 → 디테일.
      if (!stableStopped) {
        for (
          let segmentIndex = consumedSegments;
          segmentIndex < stableSegments;
          segmentIndex += 1
        ) {
          const before = sections.length;
          const capReached = flattenSegmentInto(segments[segmentIndex]!);
          for (let sectionIndex = before; sectionIndex < sections.length; sectionIndex += 1) {
            const section = sections[sectionIndex]!;
            const direction = normalizedDirection(section.from, section.to)!;
            const previous = sectionIndex > 0 ? sections[sectionIndex - 1]! : null;
            if (previous && !samePoint(previous.to, section.from)) {
              // 불연속: 활성 런을 닫는다 — 본체들, 조인들, 캡 두 개 순서로.
              closedCoverage.push(...activeBodies, ...activeJoins);
              closedCoverage.push(
                startCapRun(profile, activeFirstSection!, activeFirstDirection!, activeRunIndex),
                endCapRun(profile, activeLastSection!, activeLastDirection!, activeRunIndex),
              );
              activeBodies.length = 0;
              activeJoins.length = 0;
              activeRunIndex += 1;
              activeSectionCount = 0;
            }
            if (activeSectionCount === 0) {
              activeFirstSection = section;
              activeFirstDirection = direction;
            } else {
              activeJoins.push(joinRun(
                activeLastSection!,
                activeLastDirection!,
                section,
                direction,
                activeRunIndex,
                activeSectionCount,
              ));
            }
            activeBodies.push(bodyRun(section));
            activeSectionCount += 1;
            activeLastSection = section;
            activeLastDirection = direction;
            const length = Math.hypot(
              section.to.x - section.from.x,
              section.to.y - section.from.y,
            );
            stableWeighted += section.opacityScale * length;
            stableDistance += length;
            stableSteppedCount = emitDetailForSection(
              section,
              input.brushId,
              stableSteppedCount,
              detailRuns,
            );
          }
          consumedSegments = segmentIndex + 1;
          if (capReached) {
            stableStopped = true;
            stableCapped = true;
            break;
          }
        }
      }
      consumedSegments = stableSegments;
      stableSectionCount = sections.length;
      stableDetailCount = detailRuns.length;

      // 3. 휘발 꼬리 재구축: 남은 세그먼트를 임시 상태로 걷는다(유지 상태는 건드리지 않는다).
      let volatileCapped = false;
      // 배치 weightedOpacity 는 전 섹션을 순서대로 한 번에 접는다 — 부동소수 덧셈은 결합
      // 법칙이 없으므로 안정 부분합에서 그대로 이어 더해야 비트 동일하다.
      let runningWeighted = stableWeighted;
      let runningDistance = stableDistance;
      const volatileActiveBodies: StudioHighlighterWashRun[] = [];
      const volatileActiveJoins: StudioHighlighterWashRun[] = [];
      /** 활성 런이 휘발 구간에서 닫혔다면 그 캡, 그리고 이후 완전-휘발 런들의 커버리지. */
      let activeClosedCaps: readonly [StudioHighlighterWashRun, StudioHighlighterWashRun] | null = null;
      const volatileTailCoverage: StudioHighlighterWashRun[] = [];
      let localRunIndex = activeRunIndex;
      let localSectionCount = activeSectionCount;
      let localFirstSection = activeFirstSection;
      let localFirstDirection = activeFirstDirection;
      let localLastSection = activeLastSection;
      let localLastDirection = activeLastDirection;
      let localSteppedCount = stableSteppedCount;
      /** 아직 원래 활성 런을 잇는 중인가(참조 유지 블록으로 들어가는가)? */
      let extendsActiveRun = true;
      let volatileRunBodies: StudioHighlighterWashRun[] = [];
      let volatileRunJoins: StudioHighlighterWashRun[] = [];

      if (!stableStopped) {
        for (
          let segmentIndex = stableSegments;
          segmentIndex < segments.length;
          segmentIndex += 1
        ) {
          const before = sections.length;
          const capReached = flattenSegmentInto(segments[segmentIndex]!);
          for (let sectionIndex = before; sectionIndex < sections.length; sectionIndex += 1) {
            const section = sections[sectionIndex]!;
            const direction = normalizedDirection(section.from, section.to)!;
            const previous = sectionIndex > 0 ? sections[sectionIndex - 1]! : null;
            if (previous && localSectionCount > 0 && !samePoint(previous.to, section.from)) {
              const caps: [StudioHighlighterWashRun, StudioHighlighterWashRun] = [
                startCapRun(profile, localFirstSection!, localFirstDirection!, localRunIndex),
                endCapRun(profile, localLastSection!, localLastDirection!, localRunIndex),
              ];
              if (extendsActiveRun) {
                activeClosedCaps = caps;
                extendsActiveRun = false;
              } else {
                volatileTailCoverage.push(...volatileRunBodies, ...volatileRunJoins, ...caps);
                volatileRunBodies = [];
                volatileRunJoins = [];
              }
              localRunIndex += 1;
              localSectionCount = 0;
            }
            if (localSectionCount === 0) {
              localFirstSection = section;
              localFirstDirection = direction;
            } else {
              const join = joinRun(
                localLastSection!,
                localLastDirection!,
                section,
                direction,
                localRunIndex,
                localSectionCount,
              );
              if (extendsActiveRun) volatileActiveJoins.push(join);
              else volatileRunJoins.push(join);
            }
            const body = bodyRun(section);
            if (extendsActiveRun) volatileActiveBodies.push(body);
            else volatileRunBodies.push(body);
            localSectionCount += 1;
            localLastSection = section;
            localLastDirection = direction;
            const length = Math.hypot(
              section.to.x - section.from.x,
              section.to.y - section.from.y,
            );
            runningWeighted += section.opacityScale * length;
            runningDistance += length;
            localSteppedCount = emitDetailForSection(
              section,
              input.brushId,
              localSteppedCount,
              detailRuns,
            );
          }
          if (capReached) {
            volatileCapped = true;
            break;
          }
        }
      }

      // 4. 조립: 닫힌 런들 → 활성 런(안정 본체+휘발 본체, 안정 조인+휘발 조인, 캡) → 휘발 런들.
      //    참조 밀어넣기만 있고 기하 재계산이 없다.
      const runs: StudioHighlighterWashRun[] = [];
      runs.push(...closedCoverage);
      if (activeSectionCount > 0 || volatileActiveBodies.length > 0) {
        runs.push(...activeBodies, ...volatileActiveBodies);
        runs.push(...activeJoins, ...volatileActiveJoins);
        if (activeClosedCaps) {
          runs.push(...activeClosedCaps);
        } else {
          runs.push(
            startCapRun(
              profile,
              (activeSectionCount > 0 ? activeFirstSection : localFirstSection)!,
              (activeSectionCount > 0 ? activeFirstDirection : localFirstDirection)!,
              activeRunIndex,
            ),
            endCapRun(profile, localLastSection!, localLastDirection!, activeRunIndex),
          );
        }
      }
      runs.push(...volatileTailCoverage);
      if (!extendsActiveRun && localSectionCount > 0) {
        runs.push(...volatileRunBodies, ...volatileRunJoins);
        runs.push(
          startCapRun(profile, localFirstSection!, localFirstDirection!, localRunIndex),
          endCapRun(profile, localLastSection!, localLastDirection!, localRunIndex),
        );
      }

      return {
        version: STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION,
        brushId: input.brushId,
        capProfile: profile,
        gesture: "stroke",
        sourceSegmentCount: segments.length,
        flattenedSegmentCount: sections.length,
        capped: stableCapped || volatileCapped,
        opacityScale: runningDistance <= POINT_EPSILON
          ? 1
          : clamp(runningWeighted / runningDistance, 0, 1),
        runs,
        detailRuns,
        detailOpacityScale: HIGHLIGHTER_DETAIL_PROFILES[input.brushId].opacityScale,
      };
    },
  };
}

function tapOutline(
  brushId: StudioHighlighterWashBrushId,
  center: Point,
  radius: number,
): readonly number[] {
  const profile = highlighterCapProfile(brushId);
  return footprintOutline(
    center,
    { x: 1, y: 0 },
    radius,
    profile,
    577,
    TAP_STEPS,
    profile === "soft-flat" ? 0.72 : 1,
  );
}

export function planStudioHighlighterWashTap(input: {
  readonly brushId: StudioHighlighterWashBrushId;
  readonly x: unknown;
  readonly y: unknown;
  readonly width: unknown;
  readonly opacityScale?: unknown;
}): StudioHighlighterWashPlan {
  const x = finiteCoordinate(input.x);
  const y = finiteCoordinate(input.y);
  const width = finiteWidth(input.width);
  const profile = highlighterCapProfile(input.brushId);
  const opacityScale = typeof input.opacityScale === "number"
    && Number.isFinite(input.opacityScale)
    ? clamp(input.opacityScale, 0, 1)
    : 1;
  const run = x === null || y === null || width === null
    ? null
    : Object.freeze({
        outlinePoints: tapOutline(input.brushId, { x, y }, width / 2),
        flattenedSegmentCount: 0,
        role: "tap" as const,
      });
  return Object.freeze({
    version: STUDIO_HIGHLIGHTER_WASH_RIBBON_VERSION,
    brushId: input.brushId,
    capProfile: profile,
    gesture: "tap",
    sourceSegmentCount: 0,
    flattenedSegmentCount: 0,
    capped: false,
    opacityScale,
    runs: Object.freeze(run ? [run] : []),
    // A tap has no travel direction, so it has no fibre drag and no wet-edge migration to speak of.
    detailRuns: Object.freeze([]),
    detailOpacityScale: 0,
  });
}

export function traceStudioHighlighterWashPlan(
  sink: StudioHighlighterWashPathSink,
  plan: StudioHighlighterWashPlan,
): void {
  for (const run of plan.runs) {
    const [firstX, firstY, ...remaining] = run.outlinePoints;
    if (firstX === undefined || firstY === undefined) continue;
    sink.moveTo(firstX, firstY);
    for (let index = 0; index < remaining.length; index += 2) {
      const x = remaining[index];
      const y = remaining[index + 1];
      if (x === undefined || y === undefined) break;
      sink.lineTo(x, y);
    }
    sink.closePath();
  }
}

function formatPathNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

/** Rim/fibre pass geometry; empty when the gesture has no detail wash. */
export function traceStudioHighlighterWashDetail(
  sink: StudioHighlighterWashPathSink,
  plan: StudioHighlighterWashPlan,
): void {
  for (const run of plan.detailRuns) {
    const [firstX, firstY, ...remaining] = run.outlinePoints;
    if (firstX === undefined || firstY === undefined) continue;
    sink.moveTo(firstX, firstY);
    for (let index = 0; index < remaining.length; index += 2) {
      const x = remaining[index];
      const y = remaining[index + 1];
      if (x === undefined || y === undefined) break;
      sink.lineTo(x, y);
    }
    sink.closePath();
  }
}

function outlinePathData(outlinePoints: readonly number[]): string {
  const [firstX, firstY, ...remaining] = outlinePoints;
  if (firstX === undefined || firstY === undefined) return "";
  let path = `M${formatPathNumber(firstX)} ${formatPathNumber(firstY)}`;
  for (let index = 0; index < remaining.length; index += 2) {
    const x = remaining[index];
    const y = remaining[index + 1];
    if (x === undefined || y === undefined) break;
    path += `L${formatPathNumber(x)} ${formatPathNumber(y)}`;
  }
  return `${path}Z`;
}

export function studioHighlighterWashDetailPathData(
  plan: StudioHighlighterWashPlan,
): string {
  return plan.detailRuns.map((run) => outlinePathData(run.outlinePoints)).join("");
}

export function studioHighlighterWashPlanPathData(
  plan: StudioHighlighterWashPlan,
): string {
  return plan.runs.map((run) => {
    const [firstX, firstY, ...remaining] = run.outlinePoints;
    if (firstX === undefined || firstY === undefined) return "";
    let path = `M${formatPathNumber(firstX)} ${formatPathNumber(firstY)}`;
    for (let index = 0; index < remaining.length; index += 2) {
      const x = remaining[index];
      const y = remaining[index + 1];
      if (x === undefined || y === undefined) break;
      path += `L${formatPathNumber(x)} ${formatPathNumber(y)}`;
    }
    return `${path}Z`;
  }).join("");
}
