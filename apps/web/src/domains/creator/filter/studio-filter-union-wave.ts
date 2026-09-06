/**
 * Deterministic filter-union wave.
 *
 * These effects are original, bounded CPU implementations designed around the same normalized
 * parameter envelope a fragment shader can consume later. Geometric effects use inverse mapping
 * with bilinear RGB sampling and a clamp-to-edge policy. Every effect leaves destination alpha
 * bytes untouched, rejects malformed state, and refuses work above the explicit pixel budget.
 */

// The kind list itself lives in the engine-free registry so the top menu can name these
// filters without loading these warp kernels. This module stays their public home.
import { STUDIO_FILTER_UNION_WAVE_KINDS } from "./studio-filter-pack-registry";

import type { StudioFilterUnionWaveKind } from "./studio-filter-pack-registry";
import type { StudioImageDataLike } from "../studio-filters";

export { STUDIO_FILTER_UNION_WAVE_KINDS };
export type { StudioFilterUnionWaveKind };

export type StudioFilterUnionWave = {
  kind: StudioFilterUnionWaveKind;
  /** Shared signed strength. Zero is the exact identity for every kind. */
  amount: number;
  /** Wavelength, cell size, sample count, or spatial radius depending on kind. */
  scale: number;
  /** Edge threshold, octave count, or secondary strength depending on kind. */
  detail: number;
  /** Stable integer seed. Math.random is never used. */
  seed: number;
  /** Effect origin in normalized percent coordinates. */
  centerX: number;
  centerY: number;
  /** Phase or optical rotation in degrees. */
  angle: number;
  /** Mode for polar coordinates. */
  mode?: "rectangular-to-polar" | "polar-to-rectangular";
  /** Interpolation method for coordinate mapping. */
  interpolation?: "bilinear" | "nearest";
};

export const STUDIO_FILTER_UNION_WAVE_EDGE_POLICY = "clamp-to-edge" as const;
export const STUDIO_FILTER_UNION_WAVE_MAX_PIXELS = 16_777_216;
export const STUDIO_FILTER_UNION_WAVE_MAX_WORK_UNITS = 100_000_000;

const KIND_SET: ReadonlySet<string> = new Set(STUDIO_FILTER_UNION_WAVE_KINDS);
const DEFAULT_SPATIAL = {
  scale: 24,
  detail: 50,
  seed: 1_337,
  centerX: 50,
  centerY: 50,
  angle: 0,
} as const;

const WORK_UNITS_BY_KIND: Readonly<Record<StudioFilterUnionWaveKind, number>> = {
  "wave-warp": 2,
  "ripple-warp": 2,
  fisheye: 2,
  twirl: 2,
  "pinch-bloat": 2,
  "lens-distortion": 2,
  "film-grain-pro": 2,
  "salt-pepper": 1,
  "rgb-noise": 3,
  "perlin-texture": 5,
  pointillize: 3,
  "stained-glass": 10,
  "poster-edges": 9,
  photocopy: 7,
  "normal-map": 9,
  "god-rays": 10,
  "polar-coordinates": 2,
};

type FilterThis = { attrs?: Record<string, unknown> };

export function isStudioFilterUnionWaveKind(
  value: string,
): value is StudioFilterUnionWaveKind {
  return KIND_SET.has(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function attrNumber(value: unknown): number | undefined {
  return finite(value) ? value : undefined;
}

/**
 * Persisted/external input boundary. A missing/unknown kind or malformed amount is fail-closed:
 * it returns null rather than silently turning damaged data into an active effect.
 */
export function normalizeStudioFilterUnionWave(
  value: unknown,
): StudioFilterUnionWave | null {
  const source = record(value);
  if (
    !source ||
    typeof source.kind !== "string" ||
    !KIND_SET.has(source.kind) ||
    !finite(source.amount)
  ) {
    return null;
  }
  for (const key of [
    "scale",
    "detail",
    "seed",
    "centerX",
    "centerY",
    "angle",
  ] as const) {
    if (source[key] !== undefined && !finite(source[key])) return null;
  }
  return {
    kind: source.kind as StudioFilterUnionWaveKind,
    amount: clamp(source.amount, -100, 100),
    scale: clamp(
      finite(source.scale) ? source.scale : DEFAULT_SPATIAL.scale,
      1,
      200,
    ),
    detail: clamp(
      finite(source.detail) ? source.detail : DEFAULT_SPATIAL.detail,
      0,
      255,
    ),
    seed: Math.round(
      clamp(
        finite(source.seed) ? source.seed : DEFAULT_SPATIAL.seed,
        0,
        9_999,
      ),
    ),
    centerX: clamp(
      finite(source.centerX) ? source.centerX : DEFAULT_SPATIAL.centerX,
      0,
      100,
    ),
    centerY: clamp(
      finite(source.centerY) ? source.centerY : DEFAULT_SPATIAL.centerY,
      0,
      100,
    ),
    angle: clamp(
      finite(source.angle) ? source.angle : DEFAULT_SPATIAL.angle,
      -180,
      180,
    ),
    mode: source.mode === "polar-to-rectangular" ? "polar-to-rectangular" : "rectangular-to-polar",
    interpolation: source.interpolation === "nearest" ? "nearest" : "bilinear",
  };
}

export function isIdentityStudioFilterUnionWave(
  value: StudioFilterUnionWave | null,
): boolean {
  return value === null || Math.abs(value.amount) < 0.000_001;
}

function imagePixelCount(
  image: StudioImageDataLike,
  kind: StudioFilterUnionWaveKind,
): number {
  const { width, height, data } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 0;
  }
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_FILTER_UNION_WAVE_MAX_PIXELS ||
    pixels * WORK_UNITS_BY_KIND[kind] >
      STUDIO_FILTER_UNION_WAVE_MAX_WORK_UNITS ||
    pixels * 4 > data.length
  ) {
    return 0;
  }
  return pixels;
}

function hashUnit(x: number, y: number, seed: number): number {
  let hash = Math.imul((Math.trunc(x) | 0) ^ Math.imul(Math.trunc(y) | 0, 0x27d4eb2d), 0x85ebca6b);
  hash ^= Math.imul(Math.trunc(seed) | 0, 0xc2b2ae35);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return (hash >>> 0) / 4_294_967_296;
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function sampleRgbBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  targetOffset: number,
): void {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const topLeft = (y0 * width + x0) * 4;
  const topRight = (y0 * width + x1) * 4;
  const bottomLeft = (y1 * width + x0) * 4;
  const bottomRight = (y1 * width + x1) * 4;

  for (let channel = 0; channel < 3; channel += 1) {
    const top =
      source[topLeft + channel]! * (1 - tx) +
      source[topRight + channel]! * tx;
    const bottom =
      source[bottomLeft + channel]! * (1 - tx) +
      source[bottomRight + channel]! * tx;
    target[targetOffset + channel] = top * (1 - ty) + bottom * ty;
  }
}

function sampleRgbNearest(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  targetOffset: number,
): void {
  const safeX = clamp(Math.round(x), 0, width - 1);
  const safeY = clamp(Math.round(y), 0, height - 1);
  const sourceOffset = (safeY * width + safeX) * 4;
  target[targetOffset] = source[sourceOffset]!;
  target[targetOffset + 1] = source[sourceOffset + 1]!;
  target[targetOffset + 2] = source[sourceOffset + 2]!;
}

function applyInverseWarp(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const centerX = (effect.centerX / 100) * Math.max(0, width - 1);
  const centerY = (effect.centerY / 100) * Math.max(0, height - 1);
  const halfWidth = Math.max(1, width / 2);
  const halfHeight = Math.max(1, height / 2);
  const minDimension = Math.max(1, Math.min(width, height));
  const phase = effect.angle * Math.PI / 180;
  const strength = effect.amount / 100;
  const wavelength = Math.max(2, effect.scale);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sourceX: number;
      let sourceY: number;
      const dx = x - centerX;
      const dy = y - centerY;
      const nx = dx / halfWidth;
      const ny = dy / halfHeight;
      const radius = Math.sqrt(nx * nx + ny * ny);

      switch (effect.kind) {
        case "wave-warp": {
          const amplitude = strength * minDimension * 0.16;
          sourceX = x + Math.sin((y / wavelength) * Math.PI * 2 + phase) * amplitude;
          sourceY = y + Math.cos((x / (wavelength * 1.37)) * Math.PI * 2 + phase) * amplitude * 0.28;
          break;
        }
        case "ripple-warp": {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const displacement =
            Math.sin((distance / wavelength) * Math.PI * 2 + phase) *
            strength *
            minDimension *
            0.1;
          const inverseDistance = distance > 0.000_001 ? 1 / distance : 0;
          sourceX = x + dx * inverseDistance * displacement;
          sourceY = y + dy * inverseDistance * displacement;
          break;
        }
        case "fisheye": {
          const optical = Math.tan(Math.min(1.35, radius) * Math.PI * 0.34);
          const base = Math.tan(Math.PI * 0.34);
          const curvedRadius = base > 0 ? optical / base : radius;
          const sourceRadius = radius + (curvedRadius - radius) * strength;
          const ratio = radius > 0.000_001 ? sourceRadius / radius : 1;
          sourceX = centerX + dx * ratio;
          sourceY = centerY + dy * ratio;
          break;
        }
        case "twirl": {
          const falloff = Math.max(0, 1 - Math.min(1, radius));
          const rotation = strength * Math.PI * 2 * falloff * falloff;
          const sine = Math.sin(rotation);
          const cosine = Math.cos(rotation);
          sourceX = centerX + dx * cosine - dy * sine;
          sourceY = centerY + dx * sine + dy * cosine;
          break;
        }
        case "pinch-bloat": {
          const falloff = Math.max(0, 1 - Math.min(1, radius));
          const ratio = 1 + strength * falloff * falloff * 0.85;
          sourceX = centerX + dx * ratio;
          sourceY = centerY + dy * ratio;
          break;
        }
        case "lens-distortion": {
          const radiusSquared = nx * nx + ny * ny;
          const k1 = strength * 0.55;
          const k2 = -strength * 0.12;
          const opticalScale = effect.scale / 100;
          const factor =
            (1 + k1 * radiusSquared + k2 * radiusSquared * radiusSquared) /
            Math.max(0.25, opticalScale);
          sourceX = centerX + dx * factor;
          sourceY = centerY + dy * factor;
          break;
        }
        case "polar-coordinates": {
          let targetX: number;
          let targetY: number;
          if (effect.mode === "polar-to-rectangular") {
            const theta = (x / Math.max(1, width - 1)) * Math.PI * 2 - Math.PI / 2 + phase;
            const r = (y / Math.max(1, height - 1)) * (minDimension / 2);
            targetX = centerX + r * Math.cos(theta);
            targetY = centerY + r * Math.sin(theta);
          } else {
            const r = Math.sqrt(dx * dx + dy * dy);
            let theta = Math.atan2(dy, dx) - phase + Math.PI / 2;
            while (theta < 0) theta += Math.PI * 2;
            theta = theta % (Math.PI * 2);
            targetX = (theta / (Math.PI * 2)) * Math.max(0, width - 1);
            targetY = (r / (minDimension / 2)) * Math.max(0, height - 1);
          }
          sourceX = x + (targetX - x) * strength;
          sourceY = y + (targetY - y) * strength;
          break;
        }
        default:
          return;
      }
      const offset = (y * width + x) * 4;
      if (effect.interpolation === "nearest") {
        sampleRgbNearest(source, width, height, sourceX, sourceY, data, offset);
      } else {
        sampleRgbBilinear(source, width, height, sourceX, sourceY, data, offset);
      }
    }
  }
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(
  x: number,
  y: number,
  scale: number,
  seed: number,
): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smooth(sx - x0);
  const ty = smooth(sy - y0);
  const top =
    hashUnit(x0, y0, seed) * (1 - tx) +
    hashUnit(x0 + 1, y0, seed) * tx;
  const bottom =
    hashUnit(x0, y0 + 1, seed) * (1 - tx) +
    hashUnit(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

function applyNoiseFamily(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const amount = Math.abs(effect.amount) / 100;
  const block = Math.max(1, Math.round(effect.scale));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      switch (effect.kind) {
        case "film-grain-pro": {
          const hx = Math.floor(x / block);
          const hy = Math.floor(y / block);
          const bell =
            hashUnit(hx, hy, effect.seed) +
            hashUnit(hx, hy, effect.seed + 101) +
            hashUnit(hx, hy, effect.seed + 211) -
            1.5;
          const tone = luminance(data[offset]!, data[offset + 1]!, data[offset + 2]!) / 255;
          const response = 0.5 + (1 - Math.abs(tone - 0.5) * 2) * 0.5;
          const delta = bell * amount * 92 * response;
          data[offset] = data[offset]! + delta;
          data[offset + 1] = data[offset + 1]! + delta * 0.96;
          data[offset + 2] = data[offset + 2]! + delta * 0.9;
          break;
        }
        case "salt-pepper": {
          const noise = hashUnit(x, y, effect.seed);
          const probability = amount * 0.22;
          if (noise < probability * 0.5) {
            data[offset] = 0;
            data[offset + 1] = 0;
            data[offset + 2] = 0;
          } else if (noise > 1 - probability * 0.5) {
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
          }
          break;
        }
        case "rgb-noise": {
          const hx = Math.floor(x / block);
          const hy = Math.floor(y / block);
          data[offset] =
            data[offset]! +
            (hashUnit(hx, hy, effect.seed + 17) - 0.5) * amount * 180;
          data[offset + 1] =
            data[offset + 1]! +
            (hashUnit(hx, hy, effect.seed + 53) - 0.5) * amount * 180;
          data[offset + 2] =
            data[offset + 2]! +
            (hashUnit(hx, hy, effect.seed + 97) - 0.5) * amount * 180;
          break;
        }
        case "perlin-texture": {
          const octaveCount = clamp(Math.round(effect.detail / 51), 1, 5);
          let amplitude = 1;
          let amplitudeSum = 0;
          let combined = 0;
          let octaveScale = Math.max(2, effect.scale);
          for (let octave = 0; octave < octaveCount; octave += 1) {
            combined +=
              valueNoise(x, y, octaveScale, effect.seed + octave * 131) *
              amplitude;
            amplitudeSum += amplitude;
            amplitude *= 0.5;
            octaveScale = Math.max(1, octaveScale * 0.5);
          }
          const delta = (combined / amplitudeSum - 0.5) * amount * 128;
          data[offset] = data[offset]! + delta * 0.92;
          data[offset + 1] = data[offset + 1]! + delta;
          data[offset + 2] = data[offset + 2]! + delta * 1.08;
          break;
        }
        default:
          return;
      }
    }
  }
}

function cellSeed(
  cellX: number,
  cellY: number,
  size: number,
  seed: number,
): { x: number; y: number } {
  return {
    x: (cellX + 0.15 + hashUnit(cellX, cellY, seed) * 0.7) * size,
    y: (cellY + 0.15 + hashUnit(cellX, cellY, seed + 499) * 0.7) * size,
  };
}

function applyPointillize(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const size = Math.max(2, Math.round(effect.scale));
  const strength = Math.abs(effect.amount) / 100;
  const radius = size * (0.24 + strength * 0.26);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellX = Math.floor(x / size);
      const cellY = Math.floor(y / size);
      const center = cellSeed(cellX, cellY, size, effect.seed);
      const sampleX = clamp(Math.round(center.x), 0, width - 1);
      const sampleY = clamp(Math.round(center.y), 0, height - 1);
      const sampleOffset = (sampleY * width + sampleX) * 4;
      const offset = (y * width + x) * 4;
      const inside =
        (x - center.x) * (x - center.x) +
        (y - center.y) * (y - center.y) <= radius * radius;
      for (let channel = 0; channel < 3; channel += 1) {
        const target = inside ? source[sampleOffset + channel]! : 245;
        data[offset + channel] =
          source[offset + channel]! * (1 - strength) + target * strength;
      }
    }
  }
}

function applyStainedGlass(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const size = Math.max(3, Math.round(effect.scale));
  const strength = Math.abs(effect.amount) / 100;
  const edgeWidth = 0.4 + effect.detail / 255 * 2.8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const baseCellX = Math.floor(x / size);
      const baseCellY = Math.floor(y / size);
      let nearestDistance = Number.POSITIVE_INFINITY;
      let secondDistance = Number.POSITIVE_INFINITY;
      let nearestX = x;
      let nearestY = y;
      for (let cellY = baseCellY - 1; cellY <= baseCellY + 1; cellY += 1) {
        for (let cellX = baseCellX - 1; cellX <= baseCellX + 1; cellX += 1) {
          const point = cellSeed(cellX, cellY, size, effect.seed);
          const distance =
            (x - point.x) * (x - point.x) +
            (y - point.y) * (y - point.y);
          if (distance < nearestDistance) {
            secondDistance = nearestDistance;
            nearestDistance = distance;
            nearestX = point.x;
            nearestY = point.y;
          } else if (distance < secondDistance) {
            secondDistance = distance;
          }
        }
      }
      const sampleX = clamp(Math.round(nearestX), 0, width - 1);
      const sampleY = clamp(Math.round(nearestY), 0, height - 1);
      const sampleOffset = (sampleY * width + sampleX) * 4;
      const offset = (y * width + x) * 4;
      const border =
        Math.sqrt(secondDistance) - Math.sqrt(nearestDistance) < edgeWidth;
      for (let channel = 0; channel < 3; channel += 1) {
        const cellColor = border ? 20 : source[sampleOffset + channel]!;
        data[offset + channel] =
          source[offset + channel]! * (1 - strength) + cellColor * strength;
      }
    }
  }
}

function luminanceAt(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const safeX = clamp(Math.round(x), 0, width - 1);
  const safeY = clamp(Math.round(y), 0, height - 1);
  const offset = (safeY * width + safeX) * 4;
  return luminance(
    source[offset]!,
    source[offset + 1]!,
    source[offset + 2]!,
  );
}

function sobel(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  step = 1,
): { gx: number; gy: number } {
  const topLeft = luminanceAt(source, width, height, x - step, y - step);
  const top = luminanceAt(source, width, height, x, y - step);
  const topRight = luminanceAt(source, width, height, x + step, y - step);
  const left = luminanceAt(source, width, height, x - step, y);
  const right = luminanceAt(source, width, height, x + step, y);
  const bottomLeft = luminanceAt(source, width, height, x - step, y + step);
  const bottom = luminanceAt(source, width, height, x, y + step);
  const bottomRight = luminanceAt(source, width, height, x + step, y + step);
  return {
    gx: -topLeft + topRight - left * 2 + right * 2 - bottomLeft + bottomRight,
    gy: -topLeft - top * 2 - topRight + bottomLeft + bottom * 2 + bottomRight,
  };
}

function applyPosterEdges(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const strength = Math.abs(effect.amount) / 100;
  const levels = clamp(Math.round(effect.scale), 2, 12);
  const quantizeStep = 255 / (levels - 1);
  const threshold = 20 + effect.detail * 1.2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gradient = sobel(source, width, height, x, y);
      const edge = Math.min(1, Math.sqrt(gradient.gx ** 2 + gradient.gy ** 2) / threshold);
      for (let channel = 0; channel < 3; channel += 1) {
        const quantized =
          Math.round(source[offset + channel]! / quantizeStep) * quantizeStep;
        const target = quantized * (1 - edge * 0.9);
        data[offset + channel] =
          source[offset + channel]! * (1 - strength) + target * strength;
      }
    }
  }
}

function applyPhotocopy(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const strength = Math.abs(effect.amount) / 100;
  const radius = clamp(Math.round(effect.scale), 1, 5);
  const threshold = effect.detail;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const center = luminanceAt(source, width, height, x, y);
      const localMean =
        (
          center +
          luminanceAt(source, width, height, x - radius, y) +
          luminanceAt(source, width, height, x + radius, y) +
          luminanceAt(source, width, height, x, y - radius) +
          luminanceAt(source, width, height, x, y + radius)
        ) / 5;
      const localInk = center - localMean < -8 ? 0 : center < threshold ? 24 : 255;
      const target = center * (1 - strength) + localInk * strength;
      data[offset] = target;
      data[offset + 1] = target;
      data[offset + 2] = target;
    }
  }
}

function applyNormalMap(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const strength = Math.abs(effect.amount) / 100;
  const step = clamp(Math.round(effect.scale), 1, 4);
  const depth = 0.002 + effect.detail / 255 * 0.03;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gradient = sobel(source, width, height, x, y, step);
      let nx = -gradient.gx * depth;
      let ny = -gradient.gy * depth;
      let nz = 1;
      const inverseLength = 1 / Math.max(0.000_001, Math.sqrt(nx * nx + ny * ny + nz * nz));
      nx *= inverseLength;
      ny *= inverseLength;
      nz *= inverseLength;
      const target = [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, nz * 255];
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] =
          source[offset + channel]! * (1 - strength) + target[channel]! * strength;
      }
    }
  }
}

function applyGodRays(
  image: StudioImageDataLike,
  effect: StudioFilterUnionWave,
): void {
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data.subarray(0, width * height * 4));
  const strength = Math.abs(effect.amount) / 100;
  const samples = clamp(Math.round(effect.scale), 2, 10);
  const threshold = effect.detail;
  const lightX = (effect.centerX / 100) * Math.max(0, width - 1);
  const lightY = (effect.centerY / 100) * Math.max(0, height - 1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let bloom = 0;
      for (let sample = 1; sample <= samples; sample += 1) {
        const t = sample / samples;
        const sampleX = x + (lightX - x) * t;
        const sampleY = y + (lightY - y) * t;
        bloom += Math.max(
          0,
          luminanceAt(source, width, height, sampleX, sampleY) - threshold,
        );
      }
      bloom = bloom / samples * strength * 0.9;
      const offset = (y * width + x) * 4;
      data[offset] = source[offset]! + bloom;
      data[offset + 1] = source[offset + 1]! + bloom * 0.92;
      data[offset + 2] = source[offset + 2]! + bloom * 0.72;
    }
  }
}

/**
 * Applies one normalized effect in-place. Returns false for identity, malformed dimensions, or an
 * over-budget image and guarantees the input remains untouched in all three cases.
 */
export function applyStudioFilterUnionWave(
  image: StudioImageDataLike,
  value: StudioFilterUnionWave | null,
): boolean {
  if (isIdentityStudioFilterUnionWave(value)) return false;
  const effect = value!;
  if (imagePixelCount(image, effect.kind) === 0) return false;

  switch (effect.kind) {
    case "wave-warp":
    case "ripple-warp":
    case "fisheye":
    case "twirl":
    case "pinch-bloat":
    case "lens-distortion":
    case "polar-coordinates":
      applyInverseWarp(image, effect);
      break;
    case "film-grain-pro":
    case "salt-pepper":
    case "rgb-noise":
    case "perlin-texture":
      applyNoiseFamily(image, effect);
      break;
    case "pointillize":
      applyPointillize(image, effect);
      break;
    case "stained-glass":
      applyStainedGlass(image, effect);
      break;
    case "poster-edges":
      applyPosterEdges(image, effect);
      break;
    case "photocopy":
      applyPhotocopy(image, effect);
      break;
    case "normal-map":
      applyNormalMap(image, effect);
      break;
    case "god-rays":
      applyGodRays(image, effect);
      break;
  }
  return true;
}

/** Konva adapter; flat attrs keep the document/cache boundary serializable. */
export function studioFilterUnionWaveKonvaFilter(
  this: FilterThis,
  imageData: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const effect = normalizeStudioFilterUnionWave({
    kind: attrs.filterUnionKind,
    amount: attrNumber(attrs.filterUnionAmount),
    scale: attrNumber(attrs.filterUnionScale),
    detail: attrNumber(attrs.filterUnionDetail),
    seed: attrNumber(attrs.filterUnionSeed),
    centerX: attrNumber(attrs.filterUnionCenterX),
    centerY: attrNumber(attrs.filterUnionCenterY),
    angle: attrNumber(attrs.filterUnionAngle),
    mode: attrs.filterUnionMode,
    interpolation: attrs.filterUnionInterpolation,
  });
  applyStudioFilterUnionWave(imageData, effect);
}
