/**
 * Clean-room competitive web-drawing kit.
 *
 * Techniques distilled from *public* behaviour of browser drawing toys and tools
 * (Bomomo-class multi-agent trails, hand-drawn “rough” ink, gravity drips, soft
 * cloud spray, N-fold kaleidoscope). No proprietary bytecode or assets are
 * copied — only geometric intents that artists expect from those genres.
 *
 * All functions are pure, deterministic, and bounded for live pointer frames.
 */

export const STUDIO_WEB_DRAWING_COMPETITIVE_KIT_VERSION =
  "web-drawing-competitive-v2" as const;

/**
 * Competitive web-drawing brush ids (clean-room genre kit).
 *
 * Wave-1: Bomomo swarm, comic rough ink, drip, soft cloud.
 * Wave-2: calligraphy ribbon, dash/stitch, scatter stamps, rainbow flow, lazy-mouse ink
 * (inspired by public behaviours of Kleki, Aggie, Infinite Painter fun tools, rough.js/sketchy
 * ink, atrament-style lag smoothing — no proprietary source copied).
 */
export const STUDIO_WEB_COMPETITIVE_BRUSH_IDS = Object.freeze([
  "web-multi-agent",
  "web-rough-ink",
  "web-gravity-drip",
  "web-soft-cloud",
  "web-calligraphy-ribbon",
  "web-dash-stitch",
  "web-scatter-stamp",
  "web-rainbow-flow",
  "web-lazy-ink",
] as const);

export type StudioWebCompetitiveBrushId =
  (typeof STUDIO_WEB_COMPETITIVE_BRUSH_IDS)[number];

export function isStudioWebCompetitiveBrushId(
  value: unknown,
): value is StudioWebCompetitiveBrushId {
  return typeof value === "string"
    && (STUDIO_WEB_COMPETITIVE_BRUSH_IDS as readonly string[]).includes(value);
}

export interface StudioWebPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly t?: number;
}

export interface StudioWebCompetitiveSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly size: number;
  readonly opacity: number;
  readonly agent: number;
  readonly index: number;
  /** Optional chisel angle (radians) for flat-tip calligraphy. */
  readonly angleRadians?: number;
  /** Optional hue offset in degrees for rainbow/fun strokes. */
  readonly hueShift?: number;
}

// ---------------------------------------------------------------------------
// Limits (live-frame safe)
// ---------------------------------------------------------------------------

export const STUDIO_WEB_MULTI_AGENT_MAX = 12;
export const STUDIO_WEB_DRIP_MAX = 48;
export const STUDIO_WEB_CLOUD_PARTICLE_MAX = 64;
export const STUDIO_WEB_KALEIDO_FOLDS_MAX = 16;
export const STUDIO_WEB_ROUGH_PASSES_MAX = 5;

const COORD_LIMIT = 1_000_000;
const POINT_EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hash01(x: number, y: number, z: number, seed: number): number {
  let value = (
    Math.imul(x | 0, 0x45d9_f3b)
    ^ Math.imul(y | 0, 0x27d4_eb2d)
    ^ Math.imul(z | 0, 0x1656_67b1)
    ^ (seed >>> 0)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x85eb_ca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2_ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function sanitizePoints(points: readonly StudioWebPoint[]): StudioWebPoint[] {
  const out: StudioWebPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (Math.abs(point.x) > COORD_LIMIT || Math.abs(point.y) > COORD_LIMIT) continue;
    const pressure = clamp(finite(point.pressure, 0.55), 0.02, 1);
    out.push({
      x: point.x,
      y: point.y,
      pressure,
      ...(point.t !== undefined && Number.isFinite(point.t) ? { t: point.t } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bomomo-class multi-agent trails
// ---------------------------------------------------------------------------

export interface StudioWebMultiAgentSpec {
  readonly agentCount: number;
  /** Max lateral offset in document units. */
  readonly orbitRadius: number;
  /** How quickly agents chase the pointer (0..1). */
  readonly chase: number;
  /** Angular drift per sample (radians). */
  readonly spin: number;
  readonly seed: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC: StudioWebMultiAgentSpec = Object.freeze({
  agentCount: 6,
  orbitRadius: 28,
  chase: 0.38,
  spin: 0.17,
  seed: 0xb0_00_0001,
  baseSize: 10,
});

/**
 * Each agent orbits the pointer with lagged pursuit — produces the “swarm of pens”
 * look without nondeterministic physics.
 */
export function planStudioWebMultiAgentSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebMultiAgentSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const agentCount = clampInt(
    spec.agentCount ?? DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.agentCount,
    1,
    STUDIO_WEB_MULTI_AGENT_MAX,
    DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.agentCount,
  );
  const orbitRadius = clamp(
    finite(spec.orbitRadius, DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.orbitRadius),
    2,
    240,
  );
  const chase = clamp(
    finite(spec.chase, DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.chase),
    0.05,
    0.95,
  );
  const spin = clamp(
    finite(spec.spin, DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.spin),
    0,
    1.2,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.seed,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_MULTI_AGENT_SPEC.baseSize),
    1,
    120,
  );

  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const agents = Array.from({ length: agentCount }, (_, agent) => {
    const angle0 = (Math.PI * 2 * agent) / agentCount
      + hash01(agent, 1, 0, seed) * 0.4;
    return {
      x: path[0]!.x + Math.cos(angle0) * orbitRadius * 0.35,
      y: path[0]!.y + Math.sin(angle0) * orbitRadius * 0.35,
      angle: angle0,
    };
  });

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const t = finite(p.t, i / Math.max(1, path.length - 1));
    for (let agent = 0; agent < agentCount; agent++) {
      const state = agents[agent]!;
      const jitterR = orbitRadius * (0.55 + hash01(agent, i, 2, seed) * 0.7);
      state.angle += spin * (0.6 + hash01(agent, i, 3, seed) * 0.8);
      const targetX = p.x + Math.cos(state.angle) * jitterR;
      const targetY = p.y + Math.sin(state.angle) * jitterR;
      const agentChase = chase * (0.75 + hash01(agent, 0, 4, seed) * 0.5);
      state.x += (targetX - state.x) * agentChase;
      state.y += (targetY - state.y) * agentChase;
      const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
      const size = baseSize * (0.45 + pressure * 0.7)
        * (0.7 + hash01(agent, i, 5, seed) * 0.55);
      const opacity = 0.35 + pressure * 0.55
        * (0.65 + hash01(agent, i, 6, seed) * 0.35);
      samples.push(Object.freeze({
        x: state.x,
        y: state.y,
        pressure,
        size,
        opacity: clamp(opacity, 0.08, 1),
        agent,
        index: index++,
      }));
    }
    void t;
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Rough / sketchy ink (comic hand-drawn)
// ---------------------------------------------------------------------------

export interface StudioWebRoughInkSpec {
  readonly passes: number;
  readonly jitter: number;
  readonly seed: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC: StudioWebRoughInkSpec = Object.freeze({
  passes: 3,
  jitter: 1.8,
  seed: 0x20_f0_0001,
  baseSize: 6,
});

/** Multiple slightly offset passes of the path for a hand-inked comic line. */
export function planStudioWebRoughInkSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebRoughInkSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const passes = clampInt(
    spec.passes ?? DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.passes,
    1,
    STUDIO_WEB_ROUGH_PASSES_MAX,
    DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.passes,
  );
  const jitter = clamp(
    finite(spec.jitter, DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.jitter),
    0,
    12,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.seed,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_ROUGH_INK_SPEC.baseSize),
    0.5,
    80,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const jx = (hash01(pass, i, 1, seed) - 0.5) * 2 * jitter;
      const jy = (hash01(pass, i, 2, seed) - 0.5) * 2 * jitter;
      const pressure = clamp(finite(p.pressure, 0.6), 0.05, 1);
      const size = baseSize * (0.85 + pressure * 0.35)
        * (0.88 + hash01(pass, i, 3, seed) * 0.22);
      samples.push(Object.freeze({
        x: p.x + jx,
        y: p.y + jy,
        pressure,
        size,
        opacity: clamp(0.55 + pressure * 0.4 - pass * 0.08, 0.15, 1),
        agent: pass,
        index: index++,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Gravity drip (Sumo-class drip / ink run)
// ---------------------------------------------------------------------------

export interface StudioWebGravityDripSpec {
  readonly gravity: number;
  readonly dripChance: number;
  readonly maxDrips: number;
  readonly seed: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC: StudioWebGravityDripSpec =
  Object.freeze({
    gravity: 14,
    dripChance: 0.22,
    maxDrips: 32,
    seed: 0xd2_10_0001,
    baseSize: 8,
  });

/**
 * From path samples, emit downward drip beads when pressure is high and a
 * deterministic chance fires — classic web “paint drip” toy behaviour.
 */
export function planStudioWebGravityDripSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebGravityDripSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const gravity = clamp(
    finite(spec.gravity, DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.gravity),
    2,
    80,
  );
  const dripChance = clamp(
    finite(spec.dripChance, DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.dripChance),
    0,
    1,
  );
  const maxDrips = clampInt(
    spec.maxDrips ?? DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.maxDrips,
    0,
    STUDIO_WEB_DRIP_MAX,
    DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.maxDrips,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.seed,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_GRAVITY_DRIP_SPEC.baseSize),
    1,
    100,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  let drips = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    // Always deposit the stroke head.
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.55 + pressure * 0.7),
      opacity: clamp(0.5 + pressure * 0.45, 0.12, 1),
      agent: 0,
      index: index++,
    }));
    if (drips >= maxDrips) continue;
    if (pressure < 0.45) continue;
    if (hash01(i, 0, 1, seed) > dripChance * pressure) continue;
    const length = gravity * (0.4 + hash01(i, 1, 2, seed) * 1.4) * pressure;
    const beads = 2 + Math.floor(hash01(i, 2, 3, seed) * 4);
    for (let b = 1; b <= beads; b++) {
      const u = b / beads;
      samples.push(Object.freeze({
        x: p.x + (hash01(i, b, 4, seed) - 0.5) * baseSize * 0.35,
        y: p.y + length * u * u,
        pressure: pressure * (1 - u * 0.55),
        size: baseSize * (0.7 - u * 0.35) * (0.7 + pressure * 0.4),
        opacity: clamp((1 - u) * (0.45 + pressure * 0.4), 0.08, 0.9),
        agent: 1,
        index: index++,
      }));
    }
    drips += 1;
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Soft cloud spray (Kleki / soft-airbrush class particle cloud)
// ---------------------------------------------------------------------------

export interface StudioWebSoftCloudSpec {
  readonly particlesPerStation: number;
  readonly cloudRadius: number;
  readonly seed: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC: StudioWebSoftCloudSpec = Object.freeze({
  particlesPerStation: 7,
  cloudRadius: 22,
  seed: 0xc1_0d_0001,
  baseSize: 14,
});

export function planStudioWebSoftCloudSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebSoftCloudSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const particlesPerStation = clampInt(
    spec.particlesPerStation ?? DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.particlesPerStation,
    1,
    16,
    DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.particlesPerStation,
  );
  const cloudRadius = clamp(
    finite(spec.cloudRadius, DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.cloudRadius),
    2,
    160,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.seed,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_SOFT_CLOUD_SPEC.baseSize),
    2,
    120,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  // Thin path stations to keep live frames under budget.
  const stride = Math.max(1, Math.floor(path.length / 64));
  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  let particleBudget = STUDIO_WEB_CLOUD_PARTICLE_MAX * 8;
  for (let i = 0; i < path.length && particleBudget > 0; i += stride) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.5), 0.05, 1);
    for (let k = 0; k < particlesPerStation && particleBudget > 0; k++) {
      const ang = hash01(i, k, 1, seed) * Math.PI * 2;
      const rad = cloudRadius * Math.sqrt(hash01(i, k, 2, seed)) * (0.55 + pressure * 0.55);
      const size = baseSize * (0.35 + hash01(i, k, 3, seed) * 0.75)
        * (0.5 + pressure * 0.6);
      samples.push(Object.freeze({
        x: p.x + Math.cos(ang) * rad,
        y: p.y + Math.sin(ang) * rad,
        pressure,
        size,
        opacity: clamp(0.08 + (1 - rad / Math.max(POINT_EPS, cloudRadius)) * 0.28 * pressure, 0.04, 0.55),
        agent: k,
        index: index++,
      }));
      particleBudget -= 1;
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// N-fold kaleidoscope (beyond simple mirror)
// ---------------------------------------------------------------------------

export interface StudioWebKaleidoscopeSpec {
  readonly folds: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly mirror: boolean;
}

export const DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC: StudioWebKaleidoscopeSpec =
  Object.freeze({
    folds: 8,
    centerX: 400,
    centerY: 600,
    mirror: true,
  });

export function planStudioWebKaleidoscopeSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebKaleidoscopeSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const folds = clampInt(
    spec.folds ?? DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC.folds,
    2,
    STUDIO_WEB_KALEIDO_FOLDS_MAX,
    DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC.folds,
  );
  const centerX = finite(spec.centerX, DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC.centerX);
  const centerY = finite(spec.centerY, DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC.centerY);
  const mirror = spec.mirror ?? DEFAULT_STUDIO_WEB_KALEIDOSCOPE_SPEC.mirror;
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    const r = Math.hypot(dx, dy);
    const a0 = Math.atan2(dy, dx);
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let f = 0; f < folds; f++) {
      const a = a0 + (Math.PI * 2 * f) / folds;
      const x = centerX + Math.cos(a) * r;
      const y = centerY + Math.sin(a) * r;
      samples.push(Object.freeze({
        x,
        y,
        pressure,
        size: 8 * (0.6 + pressure * 0.6),
        opacity: clamp(0.5 + pressure * 0.4, 0.1, 1),
        agent: f,
        index: index++,
      }));
      if (mirror) {
        const am = -a0 + (Math.PI * 2 * f) / folds;
        samples.push(Object.freeze({
          x: centerX + Math.cos(am) * r,
          y: centerY + Math.sin(am) * r,
          pressure,
          size: 8 * (0.6 + pressure * 0.6),
          opacity: clamp(0.45 + pressure * 0.4, 0.1, 1),
          agent: f + folds,
          index: index++,
        }));
      }
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Calligraphy ribbon (flat chisel tip, Infinite Painter / CSP chisel genre)
// ---------------------------------------------------------------------------

export interface StudioWebCalligraphySpec {
  readonly baseSize: number;
  readonly minRoundness: number;
  readonly maxRoundness: number;
}

export const DEFAULT_STUDIO_WEB_CALLIGRAPHY_SPEC: StudioWebCalligraphySpec =
  Object.freeze({
    baseSize: 16,
    minRoundness: 0.18,
    maxRoundness: 0.55,
  });

export function planStudioWebCalligraphyRibbonSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebCalligraphySpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_CALLIGRAPHY_SPEC.baseSize),
    2,
    120,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const angle = Math.atan2(dy, dx);
    const speed = Math.hypot(dx, dy);
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    // Flat ribbon: size grows with pressure; angle follows stroke tangent.
    const size = baseSize * (0.55 + pressure * 0.85) * (1 + Math.min(0.35, speed * 0.02));
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size,
      opacity: clamp(0.7 + pressure * 0.28, 0.2, 1),
      agent: 0,
      index: index++,
      angleRadians: angle + Math.PI / 2,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Dash / stitch pattern (design tools, embroidery-like web pens)
// ---------------------------------------------------------------------------

export interface StudioWebDashStitchSpec {
  readonly dashLength: number;
  readonly gapLength: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_DASH_STITCH_SPEC: StudioWebDashStitchSpec =
  Object.freeze({
    dashLength: 10,
    gapLength: 7,
    baseSize: 5,
  });

export function planStudioWebDashStitchSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebDashStitchSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const dashLength = clamp(
    finite(spec.dashLength, DEFAULT_STUDIO_WEB_DASH_STITCH_SPEC.dashLength),
    2,
    80,
  );
  const gapLength = clamp(
    finite(spec.gapLength, DEFAULT_STUDIO_WEB_DASH_STITCH_SPEC.gapLength),
    1,
    80,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_DASH_STITCH_SPEC.baseSize),
    0.5,
    60,
  );
  const path = sanitizePoints(points);
  if (path.length < 2) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  let inDash = true;
  let segmentAcc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < POINT_EPS) continue;
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s < steps; s++) {
      const u = (s + 0.5) / steps;
      const stepLen = len / steps;
      segmentAcc += stepLen;
      const limit = inDash ? dashLength : gapLength;
      if (segmentAcc >= limit) {
        segmentAcc = 0;
        inDash = !inDash;
      }
      if (!inDash) continue;
      const pressure = clamp(
        finite(a.pressure, 0.55) * (1 - u) + finite(b.pressure, 0.55) * u,
        0.05,
        1,
      );
      samples.push(Object.freeze({
        x: a.x + dx * u,
        y: a.y + dy * u,
        pressure,
        size: baseSize * (0.75 + pressure * 0.4),
        opacity: clamp(0.75 + pressure * 0.2, 0.2, 1),
        agent: 0,
        index: index++,
        angleRadians: Math.atan2(dy, dx),
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Scatter stamp fun brush (Ibis/Pixlr-class decorative stamps)
// ---------------------------------------------------------------------------

export interface StudioWebScatterStampSpec {
  readonly stampsPerStation: number;
  readonly radius: number;
  readonly seed: number;
  readonly baseSize: number;
}

/** How much of a scattered stamp's opacity the throw distance costs it, at the disc edge. */
const SCATTER_DISTANCE_FALLOFF = 0.28;

export const DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC: StudioWebScatterStampSpec =
  Object.freeze({
    stampsPerStation: 5,
    radius: 18,
    seed: 0x57_a7_0001,
    baseSize: 12,
  });

export function planStudioWebScatterStampSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebScatterStampSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const stampsPerStation = clampInt(
    spec.stampsPerStation ?? DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.stampsPerStation,
    1,
    12,
    DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.stampsPerStation,
  );
  const radius = clamp(
    finite(spec.radius, DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.radius),
    2,
    120,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.seed,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_SCATTER_STAMP_SPEC.baseSize),
    2,
    100,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const stride = Math.max(1, Math.floor(path.length / 48));
  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i += stride) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let k = 0; k < stampsPerStation; k++) {
      const ang = hash01(i, k, 1, seed) * Math.PI * 2;
      const rad = radius * Math.sqrt(hash01(i, k, 2, seed)) * (0.4 + pressure * 0.7);
      samples.push(Object.freeze({
        x: p.x + Math.cos(ang) * rad,
        y: p.y + Math.sin(ang) * rad,
        pressure,
        size: baseSize * (0.45 + hash01(i, k, 3, seed) * 0.85) * (0.55 + pressure * 0.55),
        // 각도·거리·크기·회전·색조는 전부 입자별 해시를 쓰는데 농도만 스테이션 필압의 순수
        // 함수였다. 그래서 한 스테이션이 뿌린 다섯 개가 크기는 달라도 농도는 정확히 같았고,
        // 흩뿌려진 물질이 아니라 한 톤으로 칠해진 얼룩으로 읽혔다. 멀리 튄 입자가 옅어지는
        // 것까지 함께 넣는다 — 잉크를 더 쓰고 날아간 입자다.
        opacity: clamp(
          (0.35 + pressure * 0.5)
            * (0.72 + hash01(i, k, 6, seed) * 0.42)
            * (1 - Math.sqrt(hash01(i, k, 2, seed)) * SCATTER_DISTANCE_FALLOFF),
          0.1,
          0.95,
        ),
        agent: k,
        index: index++,
        angleRadians: hash01(i, k, 4, seed) * Math.PI * 2,
        hueShift: hash01(i, k, 5, seed) * 360,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Rainbow / hue-flow stroke (fun browser paint toys)
// ---------------------------------------------------------------------------

export interface StudioWebRainbowFlowSpec {
  readonly hueSpeed: number;
  readonly baseSize: number;
  readonly seed: number;
}

export const DEFAULT_STUDIO_WEB_RAINBOW_FLOW_SPEC: StudioWebRainbowFlowSpec =
  Object.freeze({
    hueSpeed: 48,
    baseSize: 14,
    seed: 0x2a_10_0001,
  });

export function planStudioWebRainbowFlowSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebRainbowFlowSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const hueSpeed = clamp(
    finite(spec.hueSpeed, DEFAULT_STUDIO_WEB_RAINBOW_FLOW_SPEC.hueSpeed),
    1,
    180,
  );
  // Fix seed default if I used invalid hex again
  const seed = clampInt(
    spec.seed ?? 0x2a_10_0001,
    0,
    0xffffff,
    0x2a_10_0001,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_RAINBOW_FLOW_SPEC.baseSize),
    2,
    100,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  let dist = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (i > 0) {
      dist += Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y);
    }
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    const hueShift = (dist * hueSpeed * 0.15 + hash01(i, 0, 1, seed) * 12) % 360;
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.55 + pressure * 0.7),
      opacity: clamp(0.55 + pressure * 0.4, 0.15, 1),
      agent: 0,
      index: index++,
      hueShift,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Lazy-mouse / lag stabilizer ink (Atrament / Lazy Nezumi genre)
// ---------------------------------------------------------------------------

export interface StudioWebLazyInkSpec {
  /** 0..1 — higher = smoother, more lag. */
  readonly smoothness: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_LAZY_INK_SPEC: StudioWebLazyInkSpec = Object.freeze({
  smoothness: 0.72,
  baseSize: 8,
});

/**
 * Exponential lag of the tip toward the pointer — classic “lazy mouse” smoothing
 * that produces elegant calligraphy curves without nondeterministic physics.
 */
export function planStudioWebLazyInkSamples(
  points: readonly StudioWebPoint[],
  spec: Partial<StudioWebLazyInkSpec> = {},
): readonly StudioWebCompetitiveSample[] {
  const smoothness = clamp(
    finite(spec.smoothness, DEFAULT_STUDIO_WEB_LAZY_INK_SPEC.smoothness),
    0.05,
    0.95,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_LAZY_INK_SPEC.baseSize),
    1,
    80,
  );
  const path = sanitizePoints(points);
  if (path.length === 0) return Object.freeze([]);

  let cx = path[0]!.x;
  let cy = path[0]!.y;
  const alpha = 1 - smoothness;
  const samples: StudioWebCompetitiveSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    cx += (p.x - cx) * alpha;
    cy += (p.y - cy) * alpha;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    // Pull distance softens size slightly for elegant taper on sharp turns.
    const pull = Math.hypot(p.x - cx, p.y - cy);
    const size = baseSize * (0.5 + pressure * 0.7) * (1 / (1 + pull * 0.04));
    samples.push(Object.freeze({
      x: cx,
      y: cy,
      pressure,
      size,
      opacity: clamp(0.65 + pressure * 0.32, 0.15, 1),
      agent: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Plan competitive samples for a registered brush id (product / test entrypoint). */
export function planStudioWebCompetitiveSamplesForBrush(
  brushId: unknown,
  points: readonly StudioWebPoint[],
  options: {
    readonly seed?: number;
    readonly baseSize?: number;
    readonly centerX?: number;
    readonly centerY?: number;
  } = {},
): readonly StudioWebCompetitiveSample[] {
  if (!isStudioWebCompetitiveBrushId(brushId)) return Object.freeze([]);
  const seed = options.seed ?? 41;
  const baseSize = options.baseSize;
  switch (brushId) {
    case "web-multi-agent":
      return planStudioWebMultiAgentSamples(points, { seed, baseSize });
    case "web-rough-ink":
      return planStudioWebRoughInkSamples(points, { seed, baseSize });
    case "web-gravity-drip":
      return planStudioWebGravityDripSamples(points, { seed, baseSize });
    case "web-soft-cloud":
      return planStudioWebSoftCloudSamples(points, { seed, baseSize });
    case "web-calligraphy-ribbon":
      return planStudioWebCalligraphyRibbonSamples(points, { baseSize });
    case "web-dash-stitch":
      return planStudioWebDashStitchSamples(points, { baseSize });
    case "web-scatter-stamp":
      return planStudioWebScatterStampSamples(points, { seed, baseSize });
    case "web-rainbow-flow":
      return planStudioWebRainbowFlowSamples(points, { seed, baseSize });
    case "web-lazy-ink":
      return planStudioWebLazyInkSamples(points, { baseSize });
    default:
      return Object.freeze([]);
  }
}

/** Symmetry hint for product wiring. */
export function resolveStudioWebCompetitiveBrushSymmetryHint(
  brushId: unknown,
): "none" | "vertical" | "kaleidoscope" {
  if (!isStudioWebCompetitiveBrushId(brushId)) return "none";
  return "none";
}
