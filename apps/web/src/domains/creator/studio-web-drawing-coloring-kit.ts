/**
 * Clean-room web-drawing coloring & enhancement kit.
 *
 * Distills public colouring workflows from browser tools (Kleki flat fills,
 * Magma/Aggie lasso-silhouette habits, comic hatch/cel colouring, soft wash
 * blends). Pure, deterministic, bounded — no proprietary assets or bytecode.
 *
 * Product paths may:
 *  - paint hatch/cel stamps as brush dynamics
 *  - bake gradient / hatch fills into selection masks
 *  - apply comic-cel / watercolor-wash pixel grades
 */

export const STUDIO_WEB_DRAWING_COLORING_KIT_VERSION =
  "web-drawing-coloring-v1" as const;

export const STUDIO_WEB_COLORING_BRUSH_IDS = Object.freeze([
  "web-hatch-color",
  "web-cel-flat",
  "web-blend-softener",
  "web-dot-tone",
] as const);

export type StudioWebColoringBrushId =
  (typeof STUDIO_WEB_COLORING_BRUSH_IDS)[number];

export function isStudioWebColoringBrushId(
  value: unknown,
): value is StudioWebColoringBrushId {
  return typeof value === "string"
    && (STUDIO_WEB_COLORING_BRUSH_IDS as readonly string[]).includes(value);
}

export interface StudioWebColorPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface StudioWebColorSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly size: number;
  readonly opacity: number;
  readonly angleRadians: number;
  readonly index: number;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

const COORD_LIMIT = 1_000_000;

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

function sanitize(points: readonly StudioWebColorPoint[]): StudioWebColorPoint[] {
  const out: StudioWebColorPoint[] = [];
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
// Gradient fill plans (selection / region colouring)
// ---------------------------------------------------------------------------

export type StudioWebGradientKind = "linear" | "radial";

export interface StudioWebGradientStop {
  readonly t: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface StudioWebGradientFillPlan {
  readonly kind: StudioWebGradientKind;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly StudioWebGradientStop[];
}

export function planStudioWebLinearGradientFill(input: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly StudioWebGradientStop[];
}): StudioWebGradientFillPlan | null {
  if (
    !Number.isFinite(input.x0) || !Number.isFinite(input.y0)
    || !Number.isFinite(input.x1) || !Number.isFinite(input.y1)
  ) {
    return null;
  }
  if (input.stops.length < 2) return null;
  const stops = [...input.stops]
    .map((s) => ({
      t: clamp(finite(s.t, 0), 0, 1),
      r: clamp(finite(s.r, 0), 0, 255),
      g: clamp(finite(s.g, 0), 0, 255),
      b: clamp(finite(s.b, 0), 0, 255),
      a: clamp(finite(s.a, 255), 0, 255),
    }))
    .sort((a, b) => a.t - b.t);
  return Object.freeze({
    kind: "linear",
    x0: input.x0,
    y0: input.y0,
    x1: input.x1,
    y1: input.y1,
    stops: Object.freeze(stops),
  });
}

export function planStudioWebRadialGradientFill(input: {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly stops: readonly StudioWebGradientStop[];
}): StudioWebGradientFillPlan | null {
  if (
    !Number.isFinite(input.cx) || !Number.isFinite(input.cy)
    || !Number.isFinite(input.radius) || input.radius <= 0
  ) {
    return null;
  }
  const linear = planStudioWebLinearGradientFill({
    x0: input.cx,
    y0: input.cy,
    x1: input.cx + input.radius,
    y1: input.cy,
    stops: input.stops,
  });
  if (!linear) return null;
  return Object.freeze({ ...linear, kind: "radial" });
}

/** Sample a gradient plan at document pixel (x,y). Returns RGBA 0..255. */
export function sampleStudioWebGradientFill(
  plan: StudioWebGradientFillPlan,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  let t = 0;
  if (plan.kind === "linear") {
    const dx = plan.x1 - plan.x0;
    const dy = plan.y1 - plan.y0;
    const len2 = dx * dx + dy * dy;
    if (len2 >= 1e-8) {
      t = clamp(((x - plan.x0) * dx + (y - plan.y0) * dy) / len2, 0, 1);
    }
  } else {
    const dx = x - plan.x0;
    const dy = y - plan.y0;
    const r = Math.hypot(plan.x1 - plan.x0, plan.y1 - plan.y0);
    t = r < 1e-8 ? 0 : clamp(Math.hypot(dx, dy) / r, 0, 1);
  }
  const stops = plan.stops;
  if (t <= stops[0]!.t) {
    const s = stops[0]!;
    return [s.r, s.g, s.b, s.a];
  }
  const last = stops[stops.length - 1]!;
  if (t >= last.t) return [last.r, last.g, last.b, last.a];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (t > b.t) continue;
    const u = (t - a.t) / Math.max(1e-8, b.t - a.t);
    return [
      a.r + (b.r - a.r) * u,
      a.g + (b.g - a.g) * u,
      a.b + (b.b - a.b) * u,
      a.a + (b.a - a.a) * u,
    ];
  }
  return [last.r, last.g, last.b, last.a];
}

// ---------------------------------------------------------------------------
// Hatch colouring pen (comic secondary colouring)
// ---------------------------------------------------------------------------

export interface StudioWebHatchColorSpec {
  readonly spacing: number;
  readonly angleDegrees: number;
  readonly baseSize: number;
}

export const DEFAULT_STUDIO_WEB_HATCH_COLOR_SPEC: StudioWebHatchColorSpec =
  Object.freeze({
    spacing: 7,
    angleDegrees: 45,
    baseSize: 3.5,
  });

/**
 * Projects the path onto a hatch lattice so colouring strokes read as parallel
 * ink-tone lines (web comic / Magma-speed design colouring habit).
 */
export function planStudioWebHatchColorSamples(
  points: readonly StudioWebColorPoint[],
  spec: Partial<StudioWebHatchColorSpec> = {},
): readonly StudioWebColorSample[] {
  const spacing = clamp(
    finite(spec.spacing, DEFAULT_STUDIO_WEB_HATCH_COLOR_SPEC.spacing),
    2,
    40,
  );
  const angle = (finite(
    spec.angleDegrees,
    DEFAULT_STUDIO_WEB_HATCH_COLOR_SPEC.angleDegrees,
  ) * Math.PI) / 180;
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_HATCH_COLOR_SPEC.baseSize),
    0.5,
    24,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const samples: StudioWebColorSample[] = [];
  let index = 0;
  let lastAlong = -1e9;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    // Distance along hatch direction — only emit when lattice advances.
    const along = p.x * cos + p.y * sin;
    if (along - lastAlong < spacing * 0.55 && i > 0) continue;
    lastAlong = along;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.7 + pressure * 0.5),
      opacity: clamp(0.45 + pressure * 0.45, 0.15, 0.95),
      angleRadians: angle,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Cel flat colouring pen (hard flat marker for cell-shading)
// ---------------------------------------------------------------------------

export interface StudioWebCelFlatSpec {
  readonly baseSize: number;
  readonly hardness: number;
}

export const DEFAULT_STUDIO_WEB_CEL_FLAT_SPEC: StudioWebCelFlatSpec = Object.freeze({
  baseSize: 22,
  hardness: 0.92,
});

export function planStudioWebCelFlatSamples(
  points: readonly StudioWebColorPoint[],
  spec: Partial<StudioWebCelFlatSpec> = {},
): readonly StudioWebColorSample[] {
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_CEL_FLAT_SPEC.baseSize),
    2,
    120,
  );
  const hardness = clamp(
    finite(spec.hardness, DEFAULT_STUDIO_WEB_CEL_FLAT_SPEC.hardness),
    0.5,
    1,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  // Sparse stations keep flat colour blocks clean (less muddy overpaint).
  const stride = Math.max(1, Math.floor(path.length / 96));
  const samples: StudioWebColorSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i += stride) {
    const p = path[i]!;
    const pressure = clamp(finite(p.pressure, 0.6), 0.05, 1);
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.75 + pressure * 0.35),
      opacity: clamp(0.75 + hardness * 0.2, 0.5, 1),
      angleRadians: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Soft blend / softener (Magma Blend Tool genre)
// ---------------------------------------------------------------------------

export interface StudioWebBlendSoftenerSpec {
  readonly baseSize: number;
  readonly softness: number;
}

export const DEFAULT_STUDIO_WEB_BLEND_SOFTENER_SPEC: StudioWebBlendSoftenerSpec =
  Object.freeze({
    baseSize: 28,
    softness: 0.85,
  });

/** Wide soft low-opacity deposits — product maps these to smudge/blend opacity. */
export function planStudioWebBlendSoftenerSamples(
  points: readonly StudioWebColorPoint[],
  spec: Partial<StudioWebBlendSoftenerSpec> = {},
): readonly StudioWebColorSample[] {
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_BLEND_SOFTENER_SPEC.baseSize),
    4,
    160,
  );
  const softness = clamp(
    finite(spec.softness, DEFAULT_STUDIO_WEB_BLEND_SOFTENER_SPEC.softness),
    0.4,
    1,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebColorSample[] = [];
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const prev = path[Math.max(0, i - 1)]!;
    const angle = Math.atan2(p.y - prev.y, p.x - prev.x);
    const pressure = clamp(finite(p.pressure, 0.45), 0.05, 1);
    samples.push(Object.freeze({
      x: p.x,
      y: p.y,
      pressure,
      size: baseSize * (0.7 + pressure * 0.5) * (0.85 + softness * 0.2),
      opacity: clamp(0.08 + pressure * 0.18 * (1.2 - softness * 0.4), 0.04, 0.35),
      angleRadians: angle,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Dot tone / screentone pen (manga secondary colouring)
// ---------------------------------------------------------------------------

export interface StudioWebDotToneSpec {
  readonly pitch: number;
  readonly baseSize: number;
  readonly seed: number;
}

/**
 * Per-dot spread on ink deposit. Small on purpose: a dot tone is still a tone, so the dots must
 * stay recognisably one family — this only stops them being byte-identical stamps.
 */
const DOT_TONE_SIZE_VARIATION = 0.12;
const DOT_TONE_OPACITY_VARIATION = 0.15;

export const DEFAULT_STUDIO_WEB_DOT_TONE_SPEC: StudioWebDotToneSpec = Object.freeze({
  pitch: 8,
  baseSize: 3.2,
  seed: 0xd07_0001,
});

function hash01(x: number, y: number, z: number, seed: number): number {
  let h = (
    Math.imul(x | 0, 0x45d9_f3b)
    ^ Math.imul(y | 0, 0x27d4_eb2d)
    ^ Math.imul(z | 0, 0x1656_67b1)
    ^ (seed >>> 0)
  ) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function planStudioWebDotToneSamples(
  points: readonly StudioWebColorPoint[],
  spec: Partial<StudioWebDotToneSpec> = {},
): readonly StudioWebColorSample[] {
  const pitch = clamp(
    finite(spec.pitch, DEFAULT_STUDIO_WEB_DOT_TONE_SPEC.pitch),
    3,
    32,
  );
  const baseSize = clamp(
    finite(spec.baseSize, DEFAULT_STUDIO_WEB_DOT_TONE_SPEC.baseSize),
    0.5,
    16,
  );
  const seed = clampInt(
    spec.seed ?? DEFAULT_STUDIO_WEB_DOT_TONE_SPEC.seed,
    0,
    0xffffff,
    DEFAULT_STUDIO_WEB_DOT_TONE_SPEC.seed,
  );
  const path = sanitize(points);
  if (path.length === 0) return Object.freeze([]);

  const samples: StudioWebColorSample[] = [];
  let index = 0;
  const seen = new Set<string>();

  for (const p of path) {
    const gx = Math.round(p.x / pitch);
    const gy = Math.round(p.y / pitch);
    const key = `${gx},${gy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Jitter within cell so tone doesn't look like a perfect machine grid.
    const jx = (hash01(gx, gy, 1, seed) - 0.5) * pitch * 0.35;
    const jy = (hash01(gx, gy, 2, seed) - 0.5) * pitch * 0.35;
    const pressure = clamp(finite(p.pressure, 0.55), 0.05, 1);
    samples.push(Object.freeze({
      x: gx * pitch + jx,
      y: gy * pitch + jy,
      pressure,
      // 위치는 이미 셀 안에서 흔들리는데(바로 위 주석: "완벽한 기계 격자로 보이지 않도록")
      // 크기와 농도에는 해시 항이 아예 없었다. 필압이 일정한 구간에서는 모든 점이 완전히 같은
      // 크기·같은 농도로 찍히고, 그러면 위치만 흔들린 스티커가 된다. 잉크가 실제로 앉는 양은
      // 점마다 다르므로 같은 해시로 둘 다 흔든다.
      size: baseSize * (0.65 + pressure * 0.55)
        * (1 + (hash01(gx, gy, 3, seed) - 0.5) * 2 * DOT_TONE_SIZE_VARIATION),
      opacity: clamp(
        (0.35 + pressure * 0.55)
          * (1 + (hash01(gx, gy, 4, seed) - 0.5) * 2 * DOT_TONE_OPACITY_VARIATION),
        0.12,
        0.95,
      ),
      angleRadians: 0,
      index: index++,
    }));
  }
  return Object.freeze(samples);
}

// ---------------------------------------------------------------------------
// Pixel colour grades (filter-ready pure ops)
// ---------------------------------------------------------------------------

export interface StudioImageRgbaLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Comic cel: quantize colours + darken edges (web cel-shade look). */
export function applyStudioWebComicCelGrade(
  image: StudioImageRgbaLike,
  options: { readonly levels?: number; readonly edgeStrength?: number } = {},
): number {
  const levels = clampInt(options.levels ?? 5, 2, 12, 5);
  const edgeStrength = clamp(finite(options.edgeStrength, 0.55), 0, 1);
  const { data, width, height } = image;
  if (width < 2 || height < 2) return 0;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const step = 255 / (levels - 1);
  let changed = 0;

  const luma = (o: number) =>
    0.299 * source[o]! + 0.587 * source[o + 1]! + 0.114 * source[o + 2]!;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(width - 1, x + 1);
      const yt = Math.max(0, y - 1);
      const yb = Math.min(height - 1, y + 1);
      const gx = luma((y * width + xr) * 4) - luma((y * width + xl) * 4);
      const gy = luma((yb * width + x) * 4) - luma((yt * width + x) * 4);
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 48);
      for (let c = 0; c < 3; c++) {
        const q = Math.round(source[o + c]! / step) * step;
        const target = q * (1 - edge * edgeStrength * 0.85);
        const next = Math.round(target);
        if (data[o + c] !== next) {
          data[o + c] = next;
          changed += 1;
        }
      }
    }
  }
  return changed;
}

/**
 * Watercolor wash grade: mild desat + soft lift in midtones (paper-friendly wash).
 * Strength 0..1.
 */
export function applyStudioWebWatercolorWashGrade(
  image: StudioImageRgbaLike,
  options: { readonly strength?: number } = {},
): number {
  const strength = clamp(finite(options.strength, 0.45), 0, 1);
  if (strength <= 0) return 0;
  const { data, width, height } = image;
  let changed = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    // Soft lift midtones, slight desaturation — classic web wash preview.
    const mid = 1 - Math.abs(y - 128) / 128;
    const lift = 1 + mid * 0.12 * strength;
    const desat = strength * 0.35;
    const nr = Math.round(clamp((r * (1 - desat) + y * desat) * lift, 0, 255));
    const ng = Math.round(clamp((g * (1 - desat) + y * desat) * lift, 0, 255));
    const nb = Math.round(clamp((b * (1 - desat) + y * desat) * lift, 0, 255));
    if (nr !== r || ng !== g || nb !== b) {
      data[o] = nr;
      data[o + 1] = ng;
      data[o + 2] = nb;
      changed += 1;
    }
  }
  return changed;
}

/** Soft half-tone dots over luminance (comic screen assist, not a full filter pack). */
export function applyStudioWebHalftoneGrade(
  image: StudioImageRgbaLike,
  options: { readonly pitch?: number; readonly strength?: number } = {},
): number {
  const pitch = clampInt(options.pitch ?? 6, 3, 24, 6);
  const strength = clamp(finite(options.strength, 0.55), 0, 1);
  if (strength <= 0) return 0;
  const { data, width, height } = image;
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const a = data[o + 3]!;
      if (a === 0) continue;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const cx = ((x % pitch) + 0.5) / pitch - 0.5;
      const cy = ((y % pitch) + 0.5) / pitch - 0.5;
      const d = Math.hypot(cx, cy);
      // Darker luma → larger black dots.
      const radius = (1 - luma) * 0.55 * strength;
      const ink = d < radius ? 0 : 1;
      const nr = Math.round(r * ink + (1 - ink) * (r * (1 - strength * 0.85)));
      const ng = Math.round(g * ink + (1 - ink) * (g * (1 - strength * 0.85)));
      const nb = Math.round(b * ink + (1 - ink) * (b * (1 - strength * 0.85)));
      // When inside dot, force dark ink.
      const tr = d < radius ? Math.round(r * (1 - strength)) : nr;
      const tg = d < radius ? Math.round(g * (1 - strength)) : ng;
      const tb = d < radius ? Math.round(b * (1 - strength)) : nb;
      if (tr !== r || tg !== g || tb !== b) {
        data[o] = tr;
        data[o + 1] = tg;
        data[o + 2] = tb;
        changed += 1;
      }
    }
  }
  return changed;
}

/** Emphasize ink edges for scan-to-webtoon finishing. */
export function applyStudioWebInkEdgeBoostGrade(
  image: StudioImageRgbaLike,
  options: { readonly strength?: number } = {},
): number {
  const strength = clamp(finite(options.strength, 0.45), 0, 1);
  if (strength <= 0) return 0;
  const { data, width, height } = image;
  if (width < 2 || height < 2) return 0;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  let changed = 0;
  const luma = (o: number) =>
    0.299 * source[o]! + 0.587 * source[o + 1]! + 0.114 * source[o + 2]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(width - 1, x + 1);
      const yt = Math.max(0, y - 1);
      const yb = Math.min(height - 1, y + 1);
      const gx = luma((y * width + xr) * 4) - luma((y * width + xl) * 4);
      const gy = luma((yb * width + x) * 4) - luma((yt * width + x) * 4);
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 40);
      const darken = 1 - edge * strength * 0.75;
      for (let c = 0; c < 3; c++) {
        const next = Math.round(source[o + c]! * darken);
        if (data[o + c] !== next) {
          data[o + c] = next;
          changed += 1;
        }
      }
    }
  }
  return changed;
}

/** Soft colour grade boost (saturation + mild contrast) for finishing. */
export function applyStudioWebSoftColorBoostGrade(
  image: StudioImageRgbaLike,
  options: { readonly strength?: number } = {},
): number {
  const strength = clamp(finite(options.strength, 0.35), 0, 1);
  if (strength <= 0) return 0;
  const { data, width, height } = image;
  let changed = 0;
  const contrast = 1 + strength * 0.22;
  const sat = 1 + strength * 0.28;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    let r = data[o]!;
    let g = data[o + 1]!;
    let b = data[o + 2]!;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat;
    g = y + (g - y) * sat;
    b = y + (b - y) * sat;
    const nr = Math.round(clamp(r, 0, 255));
    const ng = Math.round(clamp(g, 0, 255));
    const nb = Math.round(clamp(b, 0, 255));
    if (nr !== data[o] || ng !== data[o + 1] || nb !== data[o + 2]) {
      data[o] = nr;
      data[o + 1] = ng;
      data[o + 2] = nb;
      changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function planStudioWebColoringSamplesForBrush(
  brushId: unknown,
  points: readonly StudioWebColorPoint[],
  options: { readonly baseSize?: number; readonly seed?: number } = {},
): readonly StudioWebColorSample[] {
  if (!isStudioWebColoringBrushId(brushId)) return Object.freeze([]);
  switch (brushId) {
    case "web-hatch-color":
      return planStudioWebHatchColorSamples(points, { baseSize: options.baseSize });
    case "web-cel-flat":
      return planStudioWebCelFlatSamples(points, { baseSize: options.baseSize });
    case "web-blend-softener":
      return planStudioWebBlendSoftenerSamples(points, { baseSize: options.baseSize });
    case "web-dot-tone":
      return planStudioWebDotToneSamples(points, {
        baseSize: options.baseSize,
        seed: options.seed,
      });
    default:
      return Object.freeze([]);
  }
}
