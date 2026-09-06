/**
 * Character Shaper — local reference-palette extraction.
 *
 * The reference drawer proposes hair / iris / garment colours from an image the creator dropped in.
 * That has to stay **on the device**: no upload, no service, no model download. So the palette is a
 * bounded median cut over a ≤ 96×96 nearest-neighbour sample of the image — deterministic (the same
 * pixels always give the same hex list), allocation-bounded (≤ 9,216 samples regardless of source
 * size), and cheap enough to run on every dropped file without a spinner.
 *
 * Two details make it behave on the references webtoon artists actually paste. The cut runs over a
 * 5-bit-per-channel **histogram** rather than the raw pixels, and each box is split at the
 * population-weighted median instead of the middle index — so a flat cel-shaded drawing with four
 * large colour fields returns those four colours instead of four blends of them. Transparent pixels
 * are ignored, so a cut-out PNG proposes the character's own colours rather than the checkerboard
 * behind it.
 *
 * Skin / hair / accent are heuristics over the extracted swatches, and each is `null` when nothing
 * in the image plausibly fits — the drawer says so instead of proposing a colour to undo.
 */

import { rgbToHex, rgbToHsl } from "../vrm/studio-vrm-costume";

/** `ImageData` satisfies this; tests and workers pass a plain object. */
export interface CharacterReferenceImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface CharacterReferencePaletteOptions {
  /** How many swatches to return, 1–8. Defaults to 6. */
  readonly swatches?: number;
}

export interface CharacterReferencePalette {
  /** Deduplicated `#rrggbb`, most populous first. */
  readonly swatches: readonly string[];
  readonly skin: string | null;
  readonly hair: string | null;
  readonly accent: string | null;
}

/** Longest edge of the working sample. 96² keeps the cut under 10k points. */
const SAMPLE_EDGE = 96;
const DEFAULT_SWATCHES = 6;
const MAX_SWATCHES = 8;
/** Alpha below this is treated as "not part of the reference". */
const OPAQUE_ALPHA = 128;
/** Histogram bucket width: 5 bits per channel merges sensor noise, keeps flat fills distinct. */
const HISTOGRAM_SHIFT = 3;
/** Two swatches within this distance on every channel are the same colour to the eye. */
const DEDUPE_DISTANCE = 14;
/** Below this lightness a swatch reads as hair / ink rather than fabric. */
const HAIR_LIGHTNESS = 0.46;
/** Below this saturation nothing in the image is an accent colour. */
const ACCENT_SATURATION = 0.12;

const EMPTY_PALETTE: CharacterReferencePalette = Object.freeze({
  swatches: Object.freeze([]) as readonly string[],
  skin: null,
  hair: null,
  accent: null,
});

interface PaletteCandidate {
  readonly hex: string;
  readonly population: number;
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

/** Distinct colours of the sample: parallel arrays, one entry per histogram bucket. */
interface ColorHistogram {
  readonly mean: Uint8Array;
  readonly sum: Float64Array;
  readonly count: Float64Array;
  readonly buckets: number;
  readonly pixels: number;
}

interface MedianCutBox {
  readonly start: number;
  readonly end: number;
}

function boundedSwatchCount(requested: number | undefined): number {
  if (!Number.isFinite(requested)) return DEFAULT_SWATCHES;
  const value = Math.floor(requested as number);
  if (value < 1) return 1;
  if (value > MAX_SWATCHES) return MAX_SWATCHES;
  return value;
}

/**
 * Nearest-neighbour decimation with an integer step (no interpolation, so it is reproducible),
 * accumulated straight into the histogram. Each bucket keeps exact channel sums, so the reported
 * hex of a flat colour field is that colour, not its quantised approximation.
 */
function buildHistogram(image: CharacterReferenceImage): ColorHistogram {
  const empty: ColorHistogram = {
    mean: new Uint8Array(0),
    sum: new Float64Array(0),
    count: new Float64Array(0),
    buckets: 0,
    pixels: 0,
  };
  const { data, width, height } = image;
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1 ||
    !data || data.length < width * height * 4
  ) {
    return empty;
  }

  const step = Math.max(1, Math.ceil(Math.max(width, height) / SAMPLE_EDGE));
  const capacity = Math.ceil(width / step) * Math.ceil(height / step);
  const sum = new Float64Array(capacity * 3);
  const count = new Float64Array(capacity);
  const slots = new Map<number, number>();
  let buckets = 0;
  let pixels = 0;

  for (let y = 0; y < height; y += step) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += step) {
      const i = (rowOffset + x) * 4;
      if (data[i + 3] < OPAQUE_ALPHA) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> HISTOGRAM_SHIFT) << 10) | ((g >> HISTOGRAM_SHIFT) << 5) |
        (b >> HISTOGRAM_SHIFT);
      let slot = slots.get(key);
      if (slot === undefined) {
        slot = buckets;
        buckets += 1;
        slots.set(key, slot);
      }
      const at = slot * 3;
      sum[at] += r;
      sum[at + 1] += g;
      sum[at + 2] += b;
      count[slot] += 1;
      pixels += 1;
    }
  }
  if (buckets === 0) return empty;

  const mean = new Uint8Array(buckets * 3);
  for (let slot = 0; slot < buckets; slot += 1) {
    const at = slot * 3;
    const total = count[slot];
    mean[at] = Math.round(sum[at] / total);
    mean[at + 1] = Math.round(sum[at + 1] / total);
    mean[at + 2] = Math.round(sum[at + 2] / total);
  }
  return { mean, sum, count, buckets, pixels };
}

function channelSpread(
  histogram: ColorHistogram,
  order: Int32Array,
  box: MedianCutBox,
  channel: number,
): number {
  let min = 255;
  let max = 0;
  for (let i = box.start; i < box.end; i += 1) {
    const value = histogram.mean[order[i] * 3 + channel];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function boxPopulation(
  histogram: ColorHistogram,
  order: Int32Array,
  box: MedianCutBox,
): number {
  let total = 0;
  for (let i = box.start; i < box.end; i += 1) total += histogram.count[order[i]];
  return total;
}

/**
 * Split the box with the largest `colour spread × population` until the requested number of boxes
 * exists or nothing can be split further. Ties break on the lower box index, and the sort inside a
 * split falls back to the remaining channels and then the bucket index — so the result never
 * depends on sort stability.
 */
function medianCutBoxes(
  histogram: ColorHistogram,
  targetBoxes: number,
): { boxes: readonly MedianCutBox[]; order: Int32Array } {
  const order = new Int32Array(histogram.buckets);
  for (let i = 0; i < histogram.buckets; i += 1) order[i] = i;
  const boxes: MedianCutBox[] = [{ start: 0, end: histogram.buckets }];

  while (boxes.length < targetBoxes) {
    let bestIndex = -1;
    let bestScore = 0;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b += 1) {
      const box = boxes[b];
      if (box.end - box.start < 2) continue;
      let widest = 0;
      let widestChannel = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const spread = channelSpread(histogram, order, box, channel);
        if (spread > widest) {
          widest = spread;
          widestChannel = channel;
        }
      }
      if (widest === 0) continue;
      const score = widest * boxPopulation(histogram, order, box);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = b;
        bestChannel = widestChannel;
      }
    }
    if (bestIndex < 0) break;

    const box = boxes[bestIndex];
    const secondary = (bestChannel + 1) % 3;
    const tertiary = (bestChannel + 2) % 3;
    const { mean } = histogram;
    const slice = Array.from(order.subarray(box.start, box.end));
    slice.sort((left, right) =>
      mean[left * 3 + bestChannel] - mean[right * 3 + bestChannel] ||
      mean[left * 3 + secondary] - mean[right * 3 + secondary] ||
      mean[left * 3 + tertiary] - mean[right * 3 + tertiary] ||
      left - right);
    order.set(slice, box.start);

    // Weighted median: the flat colour field that owns half the pixels becomes its own box. The
    // bounds keep both halves non-empty even when one bucket holds more than half the sample.
    const half = boxPopulation(histogram, order, box) / 2;
    let accumulated = histogram.count[order[box.start]];
    let split = box.start + 1;
    while (split < box.end - 1 && accumulated < half) {
      accumulated += histogram.count[order[split]];
      split += 1;
    }
    boxes.splice(bestIndex, 1, { start: box.start, end: split }, { start: split, end: box.end });
  }

  return { boxes, order };
}

function candidateFor(
  histogram: ColorHistogram,
  order: Int32Array,
  box: MedianCutBox,
): PaletteCandidate | null {
  let population = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = box.start; i < box.end; i += 1) {
    const bucket = order[i];
    const at = bucket * 3;
    population += histogram.count[bucket];
    r += histogram.sum[at];
    g += histogram.sum[at + 1];
    b += histogram.sum[at + 2];
  }
  if (population <= 0) return null;

  const mean = { r: r / population / 255, g: g / population / 255, b: b / population / 255 };
  const hsl = rgbToHsl(mean);
  return {
    hex: rgbToHex(mean),
    population,
    hue: hsl.h,
    saturation: hsl.s,
    lightness: hsl.l,
  };
}

function hexChannels(hex: string): readonly [number, number, number] {
  const int = Number.parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function tooClose(a: string, b: string): boolean {
  const [ar, ag, ab] = hexChannels(a);
  const [br, bg, bb] = hexChannels(b);
  return Math.abs(ar - br) <= DEDUPE_DISTANCE &&
    Math.abs(ag - bg) <= DEDUPE_DISTANCE &&
    Math.abs(ab - bb) <= DEDUPE_DISTANCE;
}

/** Warm mid-tones with real but not neon saturation — the range human skin actually occupies. */
function looksLikeSkin(candidate: PaletteCandidate): boolean {
  return candidate.hue >= 5 && candidate.hue <= 55 &&
    candidate.saturation >= 0.12 && candidate.saturation <= 0.78 &&
    candidate.lightness >= 0.34 && candidate.lightness <= 0.92;
}

function comparePopulation(a: PaletteCandidate, b: PaletteCandidate): number {
  if (b.population !== a.population) return b.population - a.population;
  if (a.hex === b.hex) return 0;
  return a.hex < b.hex ? -1 : 1;
}

function compareSaturation(a: PaletteCandidate, b: PaletteCandidate): number {
  if (b.saturation !== a.saturation) return b.saturation - a.saturation;
  return comparePopulation(a, b);
}

function compareLightness(a: PaletteCandidate, b: PaletteCandidate): number {
  if (a.lightness !== b.lightness) return a.lightness - b.lightness;
  return comparePopulation(a, b);
}

/**
 * Bounded, deterministic palette for a dropped reference image.
 *
 * `skin` is the most populous warm mid-tone, `hair` the most populous remaining dark tone (or the
 * darkest remaining one when nothing is dark), and `accent` the most saturated colour that is
 * neither — `null` whenever nothing in the image qualifies.
 */
export function extractCharacterReferencePalette(
  image: CharacterReferenceImage,
  options: CharacterReferencePaletteOptions = {},
): CharacterReferencePalette {
  const wanted = boundedSwatchCount(options.swatches);
  const histogram = buildHistogram(image);
  if (histogram.pixels === 0) return EMPTY_PALETTE;

  const { boxes, order } = medianCutBoxes(histogram, wanted);
  const candidates: PaletteCandidate[] = [];
  for (const box of boxes) {
    const candidate = candidateFor(histogram, order, box);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort(comparePopulation);

  const kept: PaletteCandidate[] = [];
  for (const candidate of candidates) {
    if (kept.some((existing) => tooClose(existing.hex, candidate.hex))) continue;
    kept.push(candidate);
    if (kept.length >= wanted) break;
  }
  if (kept.length === 0) return EMPTY_PALETTE;

  const skin = kept.filter(looksLikeSkin).sort(comparePopulation)[0] ?? null;
  const withoutSkin = kept.filter((candidate) => candidate !== skin);
  const dark = withoutSkin.filter((candidate) => candidate.lightness <= HAIR_LIGHTNESS);
  const hair = (dark.length > 0
    ? [...dark].sort(comparePopulation)[0]
    : [...withoutSkin].sort(compareLightness)[0]) ?? null;
  const rest = withoutSkin.filter((candidate) => candidate !== hair);
  const brightest = [...rest].sort(compareSaturation)[0] ?? null;
  const accent = brightest && brightest.saturation >= ACCENT_SATURATION ? brightest : null;

  return {
    swatches: kept.map((candidate) => candidate.hex),
    skin: skin?.hex ?? null,
    hair: hair?.hex ?? null,
    accent: accent?.hex ?? null,
  };
}
