/**
 * Clean-room web drawing *assist* kit.
 *
 * Distills public behaviours of browser drawing / whiteboard toys (radial
 * kaleidoscope pens, fur/strand offsets, double-contour outlines, radial
 * bursts, axis-mirror ink, grid-snap freehand, path straighten helpers).
 * Pure, deterministic, bounded — no proprietary assets or bytecode.
 */

export const STUDIO_WEB_DRAWING_ASSIST_KIT_VERSION =
  "web-drawing-assist-v1" as const;

export const STUDIO_WEB_ASSIST_BRUSH_IDS = Object.freeze([
  "web-kaleido-ink",
  "web-fur-strand",
  "web-contour-double",
  "web-radial-burst",
  "web-mirror-ink",
  "web-grid-ink",
  // Wave-3: more public web-drawing / whiteboard assist genres
  "web-spiro-orbit",
  "web-zigzag-edge",
  "web-neon-tube",
  "web-pressure-flat",
  "web-smudge-trail",
  "web-cross-hatch-pen",
] as const);

export type StudioWebAssistBrushId =
  (typeof STUDIO_WEB_ASSIST_BRUSH_IDS)[number];

export function isStudioWebAssistBrushId(
  value: unknown,
): value is StudioWebAssistBrushId {
  return typeof value === "string"
    && (STUDIO_WEB_ASSIST_BRUSH_IDS as readonly string[]).includes(value);
}

export interface StudioWebAssistPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface StudioWebAssistSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly size: number;
  readonly opacity: number;
  readonly angleRadians: number;
  readonly agent: number;
  readonly index: number;
}

const COORD_LIMIT = 1_000_000;
const POINT_EPS = 1e-6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finite(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function sanitize(points: readonly StudioWebAssistPoint[]): StudioWebAssistPoint[] {
  const out: StudioWebAssistPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (Math.abs(p.x) > COORD_LIMIT || Math.abs(p.y) > COORD_LIMIT) continue;
    out.push({
      x: p.x,
      y: p.y,
      pressure: clamp(finite(p.pressure, 0.55), 0.02, 1),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kaleidoscope ink (N-fold radial pens — Bomomo/Kleki fun tools class)
// ---------------------------------------------------------------------------

export interface StudioWebKaleidoInkSpec {
  readonly folds: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly baseSize: number;
  readonly mirror: boolean;
}

export const DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC: StudioWebKaleidoInkSpec =
  Object.freeze({
    folds: 6,
    centerX: 0,
    centerY: 0,
    baseSize: 8,
    mirror: true,
  });

export function planStudioWebKaleidoInkSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebKaleidoInkSpec> = {},
): readonly StudioWebAssistSample[] {
  const folds = clampInt(
    spec.folds ?? DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC.folds,
    2,
    16,
    6,
  );
  const cx = finite(spec.centerX, DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC.centerX);
  const cy = finite(spec.centerY, DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC.centerY);
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC.baseSize),
    0.5,
    80,
  );
  const mirror = spec.mirror ?? DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC.mirror;
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  const step = (Math.PI * 2) / folds;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const r = Math.hypot(dx, dy);
    const a0 = Math.atan2(dy, dx);
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let f = 0; f < folds; f++) {
      const a = a0 + step * f;
      samples.push(Object.freeze({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        pressure,
        size: baseSize * (0.7 + pressure * 0.45),
        opacity: clamp(0.55 + pressure * 0.4, 0.15, 1),
        angleRadians: a + Math.PI / 2,
        agent: f,
        index: index++,
      }));
      if (mirror) {
        const am = -a0 + step * f;
        samples.push(Object.freeze({
          x: cx + Math.cos(am) * r,
          y: cy + Math.sin(am) * r,
          pressure,
          size: baseSize * (0.7 + pressure * 0.45),
          opacity: clamp(0.55 + pressure * 0.4, 0.15, 1),
          angleRadians: am + Math.PI / 2,
          agent: folds + f,
          index: index++,
        }));
      }
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Fur / strand stroke (parallel offset filaments — web "fur brush" toys)
// ---------------------------------------------------------------------------

export interface StudioWebFurStrandSpec {
  readonly strands: number;
  readonly spread: number;
  readonly baseSize: number;
  readonly seed: number;
}

export const DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC: StudioWebFurStrandSpec =
  Object.freeze({
    strands: 5,
    spread: 10,
    baseSize: 3.5,
    seed: 0xf00_0001,
  });

function hash01(a: number, b: number, c: number, seed: number): number {
  let h = (
    Math.imul(a | 0, 0x45d9_f3b)
    ^ Math.imul(b | 0, 0x27d4_eb2d)
    ^ Math.imul(c | 0, 0x1656_67b1)
    ^ (seed >>> 0)
  ) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function planStudioWebFurStrandSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebFurStrandSpec> = {},
): readonly StudioWebAssistSample[] {
  const strands = clampInt(
    spec.strands ?? DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC.strands,
    2,
    12,
    5,
  );
  const spread = clamp(
    finite(spec.spread, DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC.spread),
    1,
    48,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC.baseSize),
    0.4,
    24,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_FUR_STRAND_SPEC.seed,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    const nx = len > POINT_EPS ? -dy / len : 0;
    const ny = len > POINT_EPS ? dx / len : 1;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let s = 0; s < strands; s++) {
      const t = strands === 1 ? 0 : (s / (strands - 1)) * 2 - 1;
      const jitter = (hash01(i, s, 1, seed) - 0.5) * spread * 0.35;
      const off = t * spread * 0.5 + jitter;
      samples.push(Object.freeze({
        x: p.x + nx * off,
        y: p.y + ny * off,
        pressure,
        size: baseSize * (0.55 + pressure * 0.55) * (0.75 + hash01(i, s, 2, seed) * 0.4),
        opacity: clamp(0.35 + pressure * 0.5, 0.12, 0.95),
        angleRadians: Math.atan2(dy, dx),
        agent: s,
        index: index++,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Contour double stroke (comic outline / double-line pens)
// ---------------------------------------------------------------------------

export interface StudioWebContourDoubleSpec {
  readonly separation: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_CONTOUR_DOUBLE_SPEC: StudioWebContourDoubleSpec =
  Object.freeze({
    separation: 6,
    baseSize: 5,
  });

export function planStudioWebContourDoubleSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebContourDoubleSpec> = {},
): readonly StudioWebAssistSample[] {
  const separation = clamp(
    finite(spec.separation, DEFAULT_STUDIO_WEB_CONTOUR_DOUBLE_SPEC.separation),
    1,
    40,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_CONTOUR_DOUBLE_SPEC.baseSize),
    0.5,
    40,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    const nx = len > POINT_EPS ? -dy / len : 0;
    const ny = len > POINT_EPS ? dx / len : 1;
    const pressure = clamp(finite(p.pressure, 0.6), 0.05, 1);
    const half = separation * 0.5 * (0.7 + pressure * 0.4);
    for (const side of [-1, 1] as const) {
      samples.push(Object.freeze({
        x: p.x + nx * half * side,
        y: p.y + ny * half * side,
        pressure,
        size: baseSize * (0.75 + pressure * 0.4),
        opacity: clamp(0.7 + pressure * 0.28, 0.35, 1),
        angleRadians: Math.atan2(dy, dx),
        agent: side < 0 ? 0 : 1,
        index: index++,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Radial burst (sunburst / speed-line stations along path)
// ---------------------------------------------------------------------------

export interface StudioWebRadialBurstSpec {
  readonly rays: number;
  readonly length: number;
  readonly baseSize: number;
  readonly seed: number;
}

export const DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC: StudioWebRadialBurstSpec =
  Object.freeze({
    rays: 8,
    length: 22,
    baseSize: 2.5,
    seed: 0xb05_0001,
  });

export function planStudioWebRadialBurstSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebRadialBurstSpec> = {},
): readonly StudioWebAssistSample[] {
  const rays = clampInt(
    spec.rays ?? DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC.rays,
    3,
    24,
    8,
  );
  const length = clamp(
    finite(spec.length, DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC.length),
    4,
    120,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC.baseSize),
    0.4,
    20,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_RADIAL_BURST_SPEC.seed,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  // Sparse stations keep burst readable (manga speed lines class).
  const stride = Math.max(1, Math.floor(path.length / 24));
  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i += stride) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let r = 0; r < rays; r++) {
      const ang = (r / rays) * Math.PI * 2
        + (hash01(i, r, 1, seed) - 0.5) * 0.35;
      const len = length * (0.45 + hash01(i, r, 2, seed) * 0.7) * (0.55 + pressure * 0.6);
      const steps = 3;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        samples.push(Object.freeze({
          x: p.x + Math.cos(ang) * len * t,
          y: p.y + Math.sin(ang) * len * t,
          pressure,
          size: baseSize * (1.1 - t * 0.55) * (0.6 + pressure * 0.5),
          opacity: clamp((0.55 + pressure * 0.4) * (1.05 - t * 0.65), 0.08, 0.95),
          angleRadians: ang,
          agent: r,
          index: index++,
        }));
      }
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Axis mirror ink (H/V/both — sketchpad-class mirror without canvas UI)
// ---------------------------------------------------------------------------

export type StudioWebMirrorMode = "horizontal" | "vertical" | "both";

export interface StudioWebMirrorInkSpec {
  readonly mode: StudioWebMirrorMode;
  readonly axisX: number;
  readonly axisY: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_MIRROR_INK_SPEC: StudioWebMirrorInkSpec =
  Object.freeze({
    mode: "vertical",
    axisX: 0,
    axisY: 0,
    baseSize: 8,
  });

export function planStudioWebMirrorInkSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebMirrorInkSpec> = {},
): readonly StudioWebAssistSample[] {
  const mode = spec.mode ?? DEFAULT_STUDIO_WEB_MIRROR_INK_SPEC.mode;
  const axisX = finite(spec.axisX, DEFAULT_STUDIO_WEB_MIRROR_INK_SPEC.axisX);
  const axisY = finite(spec.axisY, DEFAULT_STUDIO_WEB_MIRROR_INK_SPEC.axisY);
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_MIRROR_INK_SPEC.baseSize),
    0.5,
    80,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    const angle = Math.atan2(p.y - prev.y, p.x - prev.x);
    const push = (x: number, y: number, agent: number, ang: number) => {
      samples.push(Object.freeze({
        x,
        y,
        pressure,
        size: baseSize * (0.7 + pressure * 0.5),
        opacity: clamp(0.75 + pressure * 0.22, 0.3, 1),
        angleRadians: ang,
        agent,
        index: index++,
      }));
    };
    push(p.x, p.y, 0, angle);
    if (mode === "vertical" || mode === "both") {
      push(axisX * 2 - p.x, p.y, 1, Math.PI - angle);
    }
    if (mode === "horizontal" || mode === "both") {
      push(p.x, axisY * 2 - p.y, 2, -angle);
    }
    if (mode === "both") {
      push(axisX * 2 - p.x, axisY * 2 - p.y, 3, angle + Math.PI);
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Grid-snap freehand (pixel-adjacent assist without pure pixel engine)
// ---------------------------------------------------------------------------

export interface StudioWebGridInkSpec {
  readonly cell: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_GRID_INK_SPEC: StudioWebGridInkSpec =
  Object.freeze({
    cell: 8,
    baseSize: 6,
  });

export function planStudioWebGridInkSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebGridInkSpec> = {},
): readonly StudioWebAssistSample[] {
  const cell = clamp(
    finite(spec.cell, DEFAULT_STUDIO_WEB_GRID_INK_SPEC.cell),
    2,
    64,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_GRID_INK_SPEC.baseSize),
    0.5,
    40,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  let lastKey = "";
  for (const p of path) {
    const gx = Math.round(p.x / cell) * cell;
    const gy = Math.round(p.y / cell) * cell;
    const key = `${gx},${gy}`;
    if (key === lastKey) continue;
    lastKey = key;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    samples.push(Object.freeze({
      x: gx,
      y: gy,
      pressure,
      size: baseSize * (0.75 + pressure * 0.4),
      opacity: clamp(0.8 + pressure * 0.18, 0.4, 1),
      angleRadians: 0,
      agent: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Spiro / orbital pen (generative canvas-sketch / spirograph toys)
// ---------------------------------------------------------------------------

export interface StudioWebSpiroOrbitSpec {
  readonly orbits: number;
  readonly radius: number;
  readonly baseSize: number;
  readonly seed: number;
}

export const DEFAULT_STUDIO_WEB_SPIRO_ORBIT_SPEC: StudioWebSpiroOrbitSpec =
  Object.freeze({
    orbits: 3,
    radius: 14,
    baseSize: 5,
    seed: 0x51_00_0001,
  });

export function planStudioWebSpiroOrbitSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebSpiroOrbitSpec> = {},
): readonly StudioWebAssistSample[] {
  const orbits = clampInt(
    spec.orbits ?? DEFAULT_STUDIO_WEB_SPIRO_ORBIT_SPEC.orbits,
    1,
    8,
    3,
  );
  const radius = clamp(
    finite(spec.radius, DEFAULT_STUDIO_WEB_SPIRO_ORBIT_SPEC.radius),
    2,
    80,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_SPIRO_ORBIT_SPEC.baseSize),
    0.5,
    40,
  );
  const seed = clampInt(
    spec.seed ?? 0x51_00_0001,
    0,
    0xffffff,
    0x51_00_0001,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  let traveled = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    traveled += Math.hypot(p.x - prev.x, p.y - prev.y);
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    for (let o = 0; o < orbits; o++) {
      const phase = traveled * (0.18 + o * 0.07)
        + hash01(o, 1, 1, seed) * Math.PI * 2;
      const rad = radius * (0.45 + o * 0.22) * (0.7 + pressure * 0.4);
      samples.push(Object.freeze({
        x: p.x + Math.cos(phase) * rad,
        y: p.y + Math.sin(phase) * rad,
        pressure,
        size: baseSize * (0.65 + pressure * 0.5) * (1 - o * 0.08),
        opacity: clamp(0.5 + pressure * 0.4, 0.15, 0.95),
        angleRadians: phase + Math.PI / 2,
        agent: o,
        index: index++,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Zigzag edge decoration (hand-drawn banner / rough outline toys)
// ---------------------------------------------------------------------------

export interface StudioWebZigzagEdgeSpec {
  readonly amplitude: number;
  readonly wavelength: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_ZIGZAG_EDGE_SPEC: StudioWebZigzagEdgeSpec =
  Object.freeze({
    amplitude: 5,
    wavelength: 10,
    baseSize: 4,
  });

export function planStudioWebZigzagEdgeSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebZigzagEdgeSpec> = {},
): readonly StudioWebAssistSample[] {
  const amplitude = clamp(
    finite(spec.amplitude, DEFAULT_STUDIO_WEB_ZIGZAG_EDGE_SPEC.amplitude),
    0.5,
    40,
  );
  const wavelength = clamp(
    finite(spec.wavelength, DEFAULT_STUDIO_WEB_ZIGZAG_EDGE_SPEC.wavelength),
    2,
    80,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_ZIGZAG_EDGE_SPEC.baseSize),
    0.5,
    40,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  let traveled = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    traveled += len;
    const nx = len > POINT_EPS ? -dy / len : 0;
    const ny = len > POINT_EPS ? dx / len : 1;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    const zig = Math.sin((traveled / wavelength) * Math.PI * 2);
    const off = zig * amplitude * (0.55 + pressure * 0.55);
    samples.push(Object.freeze({
      x: p.x + nx * off,
      y: p.y + ny * off,
      pressure,
      size: baseSize * (0.7 + pressure * 0.45),
      opacity: clamp(0.75 + pressure * 0.22, 0.3, 1),
      angleRadians: Math.atan2(dy, dx),
      agent: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Neon tube (core + soft halo stations — browser neon pen toys)
// ---------------------------------------------------------------------------

export interface StudioWebNeonTubeSpec {
  readonly baseSize: number;
  readonly haloScale: number;
}

export const DEFAULT_STUDIO_WEB_NEON_TUBE_SPEC: StudioWebNeonTubeSpec =
  Object.freeze({
    baseSize: 10,
    haloScale: 2.4,
  });

export function planStudioWebNeonTubeSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebNeonTubeSpec> = {},
): readonly StudioWebAssistSample[] {
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_NEON_TUBE_SPEC.baseSize),
    1,
    80,
  );
  const haloScale = clamp(
    finite(spec.haloScale, DEFAULT_STUDIO_WEB_NEON_TUBE_SPEC.haloScale),
    1.2,
    4,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const angle = Math.atan2(p.y - prev.y, p.x - prev.x);
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    // Halo first (under), then bright core.
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * haloScale * (0.7 + pressure * 0.4),
      opacity: clamp(0.18 + pressure * 0.12, 0.08, 0.35),
      angleRadians: angle,
      agent: 0,
      index: index++,
    }));
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.55 + pressure * 0.45),
      opacity: clamp(0.85 + pressure * 0.15, 0.5, 1),
      angleRadians: angle,
      agent: 1,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Pressure-flat comic ink (equalized pressure hard pen)
// ---------------------------------------------------------------------------

export interface StudioWebPressureFlatSpec {
  readonly baseSize: number;
  readonly targetPressure: number;
}

export const DEFAULT_STUDIO_WEB_PRESSURE_FLAT_SPEC: StudioWebPressureFlatSpec =
  Object.freeze({
    baseSize: 7,
    targetPressure: 0.72,
  });

export function planStudioWebPressureFlatSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebPressureFlatSpec> = {},
): readonly StudioWebAssistSample[] {
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_PRESSURE_FLAT_SPEC.baseSize),
    0.5,
    60,
  );
  const target = clamp(
    finite(spec.targetPressure, DEFAULT_STUDIO_WEB_PRESSURE_FLAT_SPEC.targetPressure),
    0.2,
    1,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure: target,
      size: baseSize,
      opacity: 0.96,
      angleRadians: Math.atan2(p.y - prev.y, p.x - prev.x),
      agent: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Smudge trail (lag ghost copies behind tip — soft blender trail genre)
// ---------------------------------------------------------------------------

export interface StudioWebSmudgeTrailSpec {
  readonly ghosts: number;
  readonly lag: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_SMUDGE_TRAIL_SPEC: StudioWebSmudgeTrailSpec =
  Object.freeze({
    ghosts: 4,
    lag: 0.55,
    baseSize: 18,
  });

export function planStudioWebSmudgeTrailSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebSmudgeTrailSpec> = {},
): readonly StudioWebAssistSample[] {
  const ghosts = clampInt(
    spec.ghosts ?? DEFAULT_STUDIO_WEB_SMUDGE_TRAIL_SPEC.ghosts,
    1,
    10,
    4,
  );
  const lag = clamp(
    finite(spec.lag, DEFAULT_STUDIO_WEB_SMUDGE_TRAIL_SPEC.lag),
    0.1,
    0.95,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_SMUDGE_TRAIL_SPEC.baseSize),
    2,
    120,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  let gx = path[0]!.x;
  let gy = path[0]!.y;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.45), 0.05, 1);
    // Cascade ghost tips that lag progressively.
    let cx = gx;
    let cy = gy;
    for (let g = 0; g < ghosts; g++) {
      const t = lag * (0.55 + g * 0.08);
      cx = cx * (1 - t) + p.x * t;
      cy = cy * (1 - t) + p.y * t;
      samples.push(Object.freeze({
        x: cx,
        y: cy,
        pressure,
        size: baseSize * (1.15 - g * 0.12) * (0.7 + pressure * 0.45),
        opacity: clamp((0.22 - g * 0.03) * (0.7 + pressure * 0.5), 0.04, 0.4),
        angleRadians: Math.atan2(p.y - gy, p.x - gx),
        agent: g,
        index: index++,
      }));
    }
    gx = gx * (1 - lag) + p.x * lag;
    gy = gy * (1 - lag) + p.y * lag;
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Live cross-hatch pen (two-angle lattice while drawing)
// ---------------------------------------------------------------------------

export interface StudioWebCrossHatchPenSpec {
  readonly spacing: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_CROSS_HATCH_PEN_SPEC: StudioWebCrossHatchPenSpec =
  Object.freeze({
    spacing: 7,
    baseSize: 2.8,
  });

export function planStudioWebCrossHatchPenSamples(
  points: readonly StudioWebAssistPoint[],
  spec: Partial<StudioWebCrossHatchPenSpec> = {},
): readonly StudioWebAssistSample[] {
  const spacing = clamp(
    finite(spec.spacing, DEFAULT_STUDIO_WEB_CROSS_HATCH_PEN_SPEC.spacing),
    2,
    32,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_CROSS_HATCH_PEN_SPEC.baseSize),
    0.4,
    20,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const angles = [Math.PI / 4, -Math.PI / 4];
  const samples: StudioWebAssistSample[] = [];
  let index = 0;
  for (let a = 0; a < angles.length; a++) {
    const angle = angles[a]!;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let lastAlong = -1e9;
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const along = p.x * cos + p.y * sin;
      if (along - lastAlong < spacing * 0.55 && i > 0) continue;
      lastAlong = along;
      const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
      samples.push(Object.freeze({
        x: p.x,
        y: p.y,
        pressure,
        size: baseSize * (0.7 + pressure * 0.5),
        opacity: clamp(0.4 + pressure * 0.45, 0.12, 0.95),
        angleRadians: angle,
        agent: a,
        index: index++,
      }));
    }
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Path assist helpers (product may pre-process freehand before paint)
// ---------------------------------------------------------------------------

/** Pull freehand toward straight segments (quickshape / straighten assist). */
export function planStudioWebStraightenPath(
  points: readonly StudioWebAssistPoint[],
  strength = 0.65,
): readonly StudioWebAssistPoint[] {
  const path = sanitize(points);
  if (path.length < 2) return Object.freeze(path);
  const s = clamp(finite(strength, 0.65), 0, 1);
  if (s <= 0) return Object.freeze(path);
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const out: StudioWebAssistPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const t = path.length === 1 ? 0 : i / (path.length - 1);
    const lx = a.x + (b.x - a.x) * t;
    const ly = a.y + (b.y - a.y) * t;
    out.push({
      x: p.x * (1 - s) + lx * s,
      y: p.y * (1 - s) + ly * s,
      pressure: p.pressure,
    });
  }
  return Object.freeze(out);
}

/** Equalize pressure along path (flat comic line assist). */
export function planStudioWebEqualizePressurePath(
  points: readonly StudioWebAssistPoint[],
  target = 0.7,
): readonly StudioWebAssistPoint[] {
  const path = sanitize(points);
  const t = clamp(finite(target, 0.7), 0.05, 1);
  return Object.freeze(path.map((p) => ({ x: p.x, y: p.y, pressure: t })));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function planStudioWebAssistSamplesForBrush(
  brushId: unknown,
  points: readonly StudioWebAssistPoint[],
  options: {
    readonly baseSize?: number;
    readonly seed?: number;
    readonly centerX?: number;
    readonly centerY?: number;
  } = {},
): readonly StudioWebAssistSample[] {
  if (!isStudioWebAssistBrushId(brushId)) return Object.freeze([]);
  switch (brushId) {
    case "web-kaleido-ink":
      return planStudioWebKaleidoInkSamples(points, {
        baseSize: options.baseSize,
        centerX: options.centerX,
        centerY: options.centerY,
      });
    case "web-fur-strand":
      return planStudioWebFurStrandSamples(points, {
        baseSize: options.baseSize,
        seed: options.seed,
      });
    case "web-contour-double":
      return planStudioWebContourDoubleSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-radial-burst":
      return planStudioWebRadialBurstSamples(points, {
        baseSize: options.baseSize,
        seed: options.seed,
      });
    case "web-mirror-ink":
      return planStudioWebMirrorInkSamples(points, {
        baseSize: options.baseSize,
        axisX: options.centerX,
        axisY: options.centerY,
      });
    case "web-grid-ink":
      return planStudioWebGridInkSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-spiro-orbit":
      return planStudioWebSpiroOrbitSamples(points, {
        baseSize: options.baseSize,
        seed: options.seed,
      });
    case "web-zigzag-edge":
      return planStudioWebZigzagEdgeSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-neon-tube":
      return planStudioWebNeonTubeSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-pressure-flat":
      return planStudioWebPressureFlatSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-smudge-trail":
      return planStudioWebSmudgeTrailSamples(points, {
        baseSize: options.baseSize,
      });
    case "web-cross-hatch-pen":
      return planStudioWebCrossHatchPenSamples(points, {
        baseSize: options.baseSize,
      });
    default:
      return Object.freeze([]);
  }
}
