/**
 * Brush-family pressure profiles for the hybrid stroke engines.
 *
 * `perfect-freehand` is excellent at turning a pressure-bearing centre line into a continuous
 * outline, but it deliberately does not decide what pressure should mean for every artist tool.
 * A technical pen, graphite pencil, marker and brush pen must not all react like a G-pen. This
 * boundary resolves that semantic difference before a renderer consumes the samples:
 *
 * - real pen / pressure-capable touch samples always win;
 * - mouse and ordinary touch input get a deterministic velocity-derived pressure;
 * - the first non-pressure sample uses an explicit nominal value, so an appended future point can
 *   never alter the already-visible prefix;
 * - width, opacity and flow responses are separate, allowing pigment engines and outline engines
 *   to consume the same canonical pressure without collapsing into identical marks.
 *
 * G-pen aliases intentionally return `null`. Their persisted perfect-freehand / causal G-pen
 * contract already owns its pressure curve and must not be reinterpreted by this newer profile.
 */

import {
  resolveBrushPressureSample,
  studioBrushPressureWithMinSize,
} from "../studio-brush";

export const STUDIO_HYBRID_PRESSURE_PROFILE_VERSION = "hybrid-pressure-profile-v1" as const;

export type StudioHybridPressureProfileId =
  | "ink"
  | "technical"
  | "pencil"
  | "marker"
  | "brush-pen"
  | "ribbon"
  | "dry-media"
  | "wet-media"
  | "airbrush"
  | "particle";

export type StudioHybridPressureSource = "hardware" | "velocity" | "nominal";

export interface StudioHybridPressureResponse {
  /** Output at canonical pressure zero. */
  readonly minimum: number;
  /** Output at canonical pressure one. */
  readonly maximum: number;
  /** Above one feels firmer; below one responds earlier. */
  readonly exponent: number;
}

export interface StudioHybridPressureProfile {
  readonly version: typeof STUDIO_HYBRID_PRESSURE_PROFILE_VERSION;
  readonly id: StudioHybridPressureProfileId;
  /** Causal first-contact pressure for mouse / ordinary touch. */
  readonly nominalPressure: number;
  /** Minimum rendered diameter as a ratio of the selected brush size. */
  readonly minimumWidthRatio: number;
  /** Family curve multiplied by the artist's global pressure-curve exponent. */
  readonly pressureExponent: number;
  /** Amount by which speed can reduce simulated pressure. */
  readonly velocitySensitivity: number;
  /** CSS px/ms at which velocity pressure reaches the configured family minimum. */
  readonly maxVelocity: number;
  readonly opacity: StudioHybridPressureResponse;
  readonly flow: StudioHybridPressureResponse;
}

const profile = (
  value: Omit<StudioHybridPressureProfile, "version">
): StudioHybridPressureProfile => ({
  version: STUDIO_HYBRID_PRESSURE_PROFILE_VERSION,
  ...value,
});

/**
 * Deliberately separated physical responses at equal toolbar size and input:
 *
 * - ink: elastic line weight with a readable hairline floor;
 * - technical: almost monoline, opaque and resistant to speed;
 * - pencil: broad pressure range with strong pigment/flow response;
 * - marker: compressed nib width and comparatively stable pigment;
 * - brush pen: the widest width/flow range and the lowest light-contact floor.
 */
export const STUDIO_HYBRID_PRESSURE_PROFILES: Readonly<
  Record<StudioHybridPressureProfileId, StudioHybridPressureProfile>
> = {
  ink: profile({
    id: "ink",
    nominalPressure: 0.72,
    minimumWidthRatio: 0.16,
    pressureExponent: 0.85,
    velocitySensitivity: 0.72,
    maxVelocity: 1.7,
    opacity: { minimum: 0.72, maximum: 1, exponent: 0.76 },
    flow: { minimum: 0.56, maximum: 1, exponent: 0.82 },
  }),
  technical: profile({
    id: "technical",
    nominalPressure: 0.92,
    minimumWidthRatio: 0.76,
    pressureExponent: 0.68,
    velocitySensitivity: 0.24,
    maxVelocity: 2.2,
    opacity: { minimum: 0.96, maximum: 1, exponent: 0.5 },
    flow: { minimum: 0.9, maximum: 1, exponent: 0.5 },
  }),
  pencil: profile({
    id: "pencil",
    nominalPressure: 0.58,
    minimumWidthRatio: 0.18,
    pressureExponent: 0.74,
    velocitySensitivity: 0.58,
    maxVelocity: 1.35,
    opacity: { minimum: 0.24, maximum: 1, exponent: 0.92 },
    flow: { minimum: 0.34, maximum: 1, exponent: 0.86 },
  }),
  marker: profile({
    id: "marker",
    nominalPressure: 0.8,
    minimumWidthRatio: 0.62,
    pressureExponent: 0.6,
    velocitySensitivity: 0.38,
    maxVelocity: 2.15,
    opacity: { minimum: 0.74, maximum: 1, exponent: 0.54 },
    flow: { minimum: 0.66, maximum: 1, exponent: 0.58 },
  }),
  "brush-pen": profile({
    id: "brush-pen",
    nominalPressure: 0.5,
    minimumWidthRatio: 0.06,
    pressureExponent: 0.96,
    velocitySensitivity: 0.84,
    maxVelocity: 1.4,
    opacity: { minimum: 0.2, maximum: 1, exponent: 1.08 },
    flow: { minimum: 0.28, maximum: 1, exponent: 0.98 },
  }),
  ribbon: profile({
    id: "ribbon",
    nominalPressure: 0.65,
    minimumWidthRatio: 0.08,
    pressureExponent: 1.02,
    velocitySensitivity: 0.55,
    maxVelocity: 1.5,
    opacity: { minimum: 0.55, maximum: 1, exponent: 0.92 },
    flow: { minimum: 0.45, maximum: 1, exponent: 0.9 },
  }),
  "dry-media": profile({
    id: "dry-media",
    nominalPressure: 0.55,
    minimumWidthRatio: 0.1,
    pressureExponent: 0.85,
    velocitySensitivity: 0.45,
    maxVelocity: 1.5,
    opacity: { minimum: 0.18, maximum: 1, exponent: 1.05 },
    flow: { minimum: 0.28, maximum: 1, exponent: 0.96 },
  }),
  "wet-media": profile({
    id: "wet-media",
    nominalPressure: 0.58,
    minimumWidthRatio: 0.2,
    pressureExponent: 0.9,
    velocitySensitivity: 0.42,
    maxVelocity: 1.4,
    opacity: { minimum: 0.3, maximum: 1, exponent: 0.88 },
    flow: { minimum: 0.24, maximum: 1, exponent: 1.04 },
  }),
  airbrush: profile({
    id: "airbrush",
    nominalPressure: 0.62,
    minimumWidthRatio: 0.35,
    pressureExponent: 0.78,
    velocitySensitivity: 0.22,
    maxVelocity: 2,
    opacity: { minimum: 0.12, maximum: 1, exponent: 1.12 },
    flow: { minimum: 0.18, maximum: 1, exponent: 1.06 },
  }),
  particle: profile({
    id: "particle",
    nominalPressure: 0.7,
    minimumWidthRatio: 0.4,
    pressureExponent: 0.7,
    velocitySensitivity: 0.18,
    maxVelocity: 2.4,
    opacity: { minimum: 0.5, maximum: 1, exponent: 0.72 },
    flow: { minimum: 0.35, maximum: 1, exponent: 0.82 },
  }),
};

const PROFILE_ID_BY_BRUSH = new Map<string, StudioHybridPressureProfileId>([
  ["pen", "ink"],
  ["ballpoint", "ink"],
  ["gel-pen", "technical"],
  ["glass-pen", "ink"],
  ["ruling-pen", "ink"],
  ["perfect-ink", "brush-pen"],
  ["ink-brush", "brush-pen"],
  ["fineliner", "technical"],
  ["technical-pen", "technical"],
  ["pencil", "pencil"],
  ["erodible-pencil", "pencil"],
  ["pencil-2b", "pencil"],
  ["pencil-6b", "pencil"],
  ["soft-pencil", "pencil"],
  ["pencil-grain", "pencil"],
  ["colored-pencil", "pencil"],
  ["marker", "marker"],
  ["felt-tip", "marker"],
  ["marker-bold", "marker"],
  ["alcohol-marker", "marker"],
  ["perfect-marker", "marker"],
  ["highlighter", "marker"],
  ["chisel-highlighter", "marker"],
  ["pastel-highlighter", "marker"],
  ["calligraphy", "brush-pen"],
  ["fountain-pen", "brush-pen"],
  ["parallel-pen", "marker"],
  ["brush-pen", "brush-pen"],
  ["kneaded-eraser", "dry-media"],
  ["brush", "ribbon"],
  ["flat-brush", "ribbon"],
  ["watercolor", "wet-media"],
  ["ink-wash", "wet-media"],
  ["gouache", "wet-media"],
  ["oil", "wet-media"],
  ["acrylic", "wet-media"],
  ["paint-tube", "wet-media"],
  ["wash-brush", "wet-media"],
  ["dry-media", "dry-media"],
  ["crayon", "dry-media"],
  ["chalk", "dry-media"],
  ["charcoal", "dry-media"],
  ["pastel", "dry-media"],
  ["oil-pastel", "dry-media"],
  ["airbrush", "airbrush"],
  ["hard-airbrush", "airbrush"],
  ["airbrush-fine", "airbrush"],
  ["soft-brush", "airbrush"],
  ["spray", "airbrush"],
  ["splatter", "airbrush"],
  ["glitter", "particle"],
  ["star-dust", "particle"],
  ["sparkle-star", "particle"],
  ["ink-particle", "particle"],
  ["tangent-normal-brush", "ribbon"],
  ["neon", "marker"],
  ["glow", "marker"],
  ["soft-glow", "marker"],
]);

const EXCLUDED_G_PEN_BRUSH_IDS = new Set([
  "gpen",
  "school-pen",
  "maru-pen",
  "mapping-pen",
  "kaburapen",
  "liner",
]);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function normalizedPointerType(value: unknown): "pen" | "touch" | "mouse" | "unknown" {
  if (typeof value !== "string") return "unknown";
  const lowered = value.toLowerCase();
  return lowered === "pen" || lowered === "touch" || lowered === "mouse"
    ? lowered
    : "unknown";
}

function hasHardwarePressure(pointerType: unknown, rawPressure: unknown): boolean {
  const type = normalizedPointerType(pointerType);
  const pressure = finiteOr(rawPressure, Number.NaN);
  return (type === "pen" || type === "touch")
    && pressure >= 0
    && pressure <= 1
    // Pointer Events uses exactly 0.5 for an active pointer without a pressure sensor.
    && (type === "pen" || pressure !== 0.5);
}

function responseValue(
  pressure: number,
  response: StudioHybridPressureResponse
): number {
  const curved = Math.pow(clamp01(pressure), clamp(finiteOr(response.exponent, 1), 0.05, 8));
  return clamp01(
    clamp01(response.minimum)
      + (clamp01(response.maximum) - clamp01(response.minimum)) * curved
  );
}

/** Returns the explicit non-G-pen profile for a brush, or null for an unrelated / G-pen brush. */
export function resolveStudioHybridPressureProfile(
  brushId: unknown
): StudioHybridPressureProfile | null {
  if (typeof brushId !== "string" || brushId.length === 0) return null;
  const id = PROFILE_ID_BY_BRUSH.get(brushId);
  return id ? STUDIO_HYBRID_PRESSURE_PROFILES[id] : null;
}

/**
 * True only for G-pen brushes whose persisted perfect-freehand pressure contract must remain the
 * sole pressure authority. Keeping this distinction explicit lets downstream adapters return a
 * neutral fallback for unrelated brushes without accidentally swallowing a G-pen sample.
 */
export function isStudioHybridPressureExcludedGpenBrush(
  brushId: unknown
): boolean {
  return typeof brushId === "string" && EXCLUDED_G_PEN_BRUSH_IDS.has(brushId);
}

export interface StudioHybridPressureSampleInput {
  readonly pointerType?: unknown;
  readonly rawPressure?: unknown;
  /** Distance from the previous admitted sample in CSS pixels. */
  readonly distance?: unknown;
  /** Time since the previous admitted sample in milliseconds. */
  readonly elapsedMs?: unknown;
  /** Artist-level pressure curve; multiplied by the family exponent. */
  readonly pressureCurve?: unknown;
  /** 0 disables velocity response, 1 keeps the family default. */
  readonly velocitySensitivityScale?: unknown;
  /** False for a causal first contact or when the artist disables velocity simulation. */
  readonly simulateVelocity?: boolean;
}

export interface StudioHybridPressureSample {
  readonly profileId: StudioHybridPressureProfileId;
  readonly source: StudioHybridPressureSource;
  /** Canonical 0..1 pressure supplied to outline / dab geometry. */
  readonly pressure: number;
  /** Diameter ratio after the family-specific minimum-size floor. */
  readonly widthRatio: number;
  readonly opacityRatio: number;
  readonly flowRatio: number;
}

/**
 * Resolves one pressure sample without retaining mutable state. The caller supplies only the
 * previous-segment distance/time, making the result deterministic across live rendering, replay,
 * export and collaboration replicas.
 */
export function resolveStudioHybridPressureSample(
  brushId: unknown,
  input: StudioHybridPressureSampleInput = {}
): StudioHybridPressureSample | null {
  const pressureProfile = resolveStudioHybridPressureProfile(brushId);
  if (!pressureProfile) return null;

  const hardware = hasHardwarePressure(input.pointerType, input.rawPressure);
  const simulateVelocity = input.simulateVelocity !== false;
  const velocity = !hardware && simulateVelocity;
  const artistCurve = clamp(finiteOr(input.pressureCurve, 1), 0.05, 8);
  const sensitivityScale = clamp01(finiteOr(input.velocitySensitivityScale, 1));
  // Keep pigment pressure independent from the diameter floor. Persisting the floored width as
  // pressure made dry/wet media retain far too much opacity at a light stylus contact and caused
  // materially different brush families to collapse toward the same pale, round stamp.
  const pressure = resolveBrushPressureSample({
    pointerType: input.pointerType,
    rawPressure: input.rawPressure,
    distance: input.distance,
    elapsedMs: input.elapsedMs,
    velocityFallbackEnabled: velocity,
    velocitySensitivity: pressureProfile.velocitySensitivity * sensitivityScale,
    pressureCurve: pressureProfile.pressureExponent * artistCurve,
    minSizeRatio: 0,
    maxVelocity: pressureProfile.maxVelocity,
    fallbackPressure: pressureProfile.nominalPressure,
  });

  return {
    profileId: pressureProfile.id,
    source: hardware ? "hardware" : velocity ? "velocity" : "nominal",
    pressure,
    widthRatio: studioBrushPressureWithMinSize(
      pressure,
      pressureProfile.minimumWidthRatio
    ),
    opacityRatio: responseValue(pressure, pressureProfile.opacity),
    flowRatio: responseValue(pressure, pressureProfile.flow),
  };
}

export interface StudioHybridPressurePointerSample {
  readonly x: unknown;
  readonly y: unknown;
  readonly timeMs: unknown;
  readonly pressure?: unknown;
  readonly pointerType?: unknown;
}

export interface StudioHybridPressureSeriesInput {
  readonly brushId: unknown;
  readonly samples: readonly StudioHybridPressurePointerSample[];
  readonly pointerType?: unknown;
  readonly pressureCurve?: unknown;
  readonly velocitySensitivityScale?: unknown;
  readonly simulateVelocity?: boolean;
}

/**
 * Converts a pointer journal into a prefix-stable pressure journal.
 *
 * The first mouse/touch point deliberately uses nominal pressure instead of looking ahead to the
 * second point. Every later sample depends only on itself and its predecessor, so appending a new
 * pointer sample cannot mutate pressure already painted on the live surface.
 */
export function resolveStudioHybridPressureSeries(
  input: StudioHybridPressureSeriesInput
): StudioHybridPressureSample[] {
  const result: StudioHybridPressureSample[] = [];
  let previousX = 0;
  let previousY = 0;
  let previousTime = 0;
  let hasPrevious = false;

  for (const sample of input.samples) {
    const x = finiteOr(sample.x, hasPrevious ? previousX : 0);
    const y = finiteOr(sample.y, hasPrevious ? previousY : 0);
    const time = finiteOr(sample.timeMs, hasPrevious ? previousTime : 0);
    const elapsed = hasPrevious && time > previousTime ? time - previousTime : undefined;
    const resolved = resolveStudioHybridPressureSample(input.brushId, {
      pointerType: sample.pointerType ?? input.pointerType,
      rawPressure: sample.pressure,
      distance: hasPrevious ? Math.hypot(x - previousX, y - previousY) : 0,
      elapsedMs: elapsed,
      pressureCurve: input.pressureCurve,
      velocitySensitivityScale: input.velocitySensitivityScale,
      simulateVelocity: hasPrevious && input.simulateVelocity !== false,
    });
    if (!resolved) return [];
    result.push(resolved);
    previousX = x;
    previousY = y;
    previousTime = time;
    hasPrevious = true;
  }
  return result;
}
