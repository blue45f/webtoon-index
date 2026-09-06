/**
 * High-resolution analytic soft-tip mask cache and exact-colour tint scratch.
 *
 * Soft/airbrush marks share a radial alpha equation but may resolve a distinct colour for every
 * dab. Caching coloured stamps would therefore thrash under colour dynamics, while quantizing to
 * whichever colours entered a global cache first would make replay history-dependent.
 *
 * Instead this module caches one immutable colourless alpha mask per exponent/quality profile.
 * A bounded set of repeated exact colours is promoted to immutable tinted stamps; high-cardinality
 * colour jitter uses one reusable mutable scratch per factory/quality. Both tint paths apply the
 * exact canonical colour with `source-in`, then the renderer performs one transformed destination
 * `drawImage`. No ImageData or surface is allocated per dab, and cache history cannot change
 * output pixels.
 */

/**
 * A 256-class odd grid has a real centre texel. An even 256 grid's closest sample sits at
 * r=√2/256 and makes a 3.6 exponent airbrush about 2% too faint at its peak.
 */
export const STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION = 257;
export const STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS = 1;
/**
 * Versioned linear-accumulation tone for analytic soft-falloff masks.
 *
 * Canvas `source-over` multiplies gamma-encoded transmittance per dab, so the historical
 * `(1 - r) ^ exponent` coverage ramp reads as a dark fringe where soft skirts overlap. Marks
 * carrying this tone rasterize their mask through
 * `linearizeStudioBrushSoftFalloffCoverageAlpha`, whose encoded transmittances multiply the way
 * linear light does. An absent tone keeps the historical ramp byte-identically; anything else
 * fails closed — a mask is never silently substituted.
 */
export const STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE =
  "linear-accumulation-v1" as const;
export type StudioBrushSoftFalloffStampTone =
  typeof STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE;
export const STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_BYTE_BUDGET =
  40 * 1024 * 1024;
export const STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_ENTRY_LIMIT = 64;
export const STUDIO_BRUSH_SOFT_FALLOFF_TINTED_CACHE_ENTRY_LIMIT = 64;
export const STUDIO_BRUSH_SOFT_FALLOFF_TINTED_COLORS_PER_PROFILE = 8;
export const STUDIO_BRUSH_SOFT_FALLOFF_TINT_SCRATCH_ENTRY_LIMIT = 4;

export interface StudioBrushSoftFalloffStampSurfaceContext {
  createImageData(width: number, height: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
  globalAlpha?: number;
  globalCompositeOperation?: GlobalCompositeOperation;
  fillStyle?: string | CanvasGradient | CanvasPattern;
  drawImage?(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void;
  fillRect?(x: number, y: number, width: number, height: number): void;
}

export type StudioBrushSoftFalloffStampSurface = CanvasImageSource & {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): StudioBrushSoftFalloffStampSurfaceContext | null;
};

export type StudioBrushSoftFalloffStampSurfaceFactory = (
  width: number,
  height: number,
) => StudioBrushSoftFalloffStampSurface | null;

export interface StudioBrushSoftFalloffStampRaster {
  readonly pixels: Uint8ClampedArray;
  readonly resolution: number;
  readonly gutterPixels: number;
  readonly surfaceSize: number;
}

interface SoftFalloffMaskCacheEntry {
  readonly cacheKey: string;
  readonly factory: StudioBrushSoftFalloffStampSurfaceFactory;
  readonly surface: StudioBrushSoftFalloffStampSurface;
  readonly bytes: number;
  lastUsed: number;
}

interface SoftFalloffTintScratchEntry {
  readonly resolution: number;
  readonly factory: StudioBrushSoftFalloffStampSurfaceFactory;
  readonly surface: StudioBrushSoftFalloffStampSurface;
  readonly context: StudioBrushSoftFalloffStampSurfaceContext;
  readonly bytes: number;
  lastUsed: number;
}

interface SoftFalloffTintedCacheEntry {
  readonly cacheKey: string;
  readonly profileKey: string;
  readonly factory: StudioBrushSoftFalloffStampSurfaceFactory;
  readonly surface: StudioBrushSoftFalloffStampSurface;
  readonly bytes: number;
  lastUsed: number;
}

const softFalloffMaskCache: SoftFalloffMaskCacheEntry[] = [];
const softFalloffMaskCacheByFactory = new WeakMap<
  StudioBrushSoftFalloffStampSurfaceFactory,
  Map<string, SoftFalloffMaskCacheEntry>
>();
const softFalloffTintedCache: SoftFalloffTintedCacheEntry[] = [];
const softFalloffTintedCacheByFactory = new WeakMap<
  StudioBrushSoftFalloffStampSurfaceFactory,
  Map<string, SoftFalloffTintedCacheEntry>
>();
const softFalloffTintedProfilesByFactory = new WeakMap<
  StudioBrushSoftFalloffStampSurfaceFactory,
  Map<string, SoftFalloffTintedCacheEntry[]>
>();
const softFalloffTintScratchCache: SoftFalloffTintScratchEntry[] = [];
const softFalloffTintScratchByFactory = new WeakMap<
  StudioBrushSoftFalloffStampSurfaceFactory,
  Map<number, SoftFalloffTintScratchEntry>
>();
let softFalloffStampCacheBytes = 0;
let softFalloffStampCacheClock = 0;
let softFalloffStampSurfaceAllocations = 0;
let softFalloffStampCacheHits = 0;
let softFalloffStampCacheMisses = 0;
let softFalloffTintedCacheHits = 0;
let softFalloffTintPasses = 0;

function clampByte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function canonicalHexColor(value: string): string | null {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu.exec(value.trim());
  if (!match) return null;
  const source = match[1]!.toLowerCase();
  const expanded = source.length <= 4
    ? [...source].map((channel) => `${channel}${channel}`).join("")
    : source;
  return `#${expanded}`;
}

function canonicalHexColorChannels(
  value: string,
): readonly [red: number, green: number, blue: number, alpha: number] | null {
  const canonical = canonicalHexColor(value);
  if (!canonical) return null;
  const source = canonical.slice(1);
  return [
    Number.parseInt(source.slice(0, 2), 16),
    Number.parseInt(source.slice(2, 4), 16),
    Number.parseInt(source.slice(4, 6), 16),
    source.length === 8 ? Number.parseInt(source.slice(6, 8), 16) : 255,
  ];
}

function validFalloffExponent(exponent: number): boolean {
  return Number.isFinite(exponent) && exponent > 0 && exponent <= 32;
}

function validFalloffTone(tone: unknown): tone is StudioBrushSoftFalloffStampTone | undefined {
  return tone === undefined
    || tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE;
}

/** Exact sRGB electro-optical encode of one linear-light unit value. */
function srgbEncodeUnitValue(linear: number): number {
  if (linear <= 0) return 0;
  if (linear >= 1) return 1;
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/**
 * `linear-accumulation-v1` coverage transfer: `alpha' = 1 - srgbEncode(1 - alpha)`.
 *
 * `source-over` scales the destination by the encoded transmittance `1 - alpha'` per dab, so the
 * display transmittance of N stacked dabs is `∏ srgbEncode(tᵢ)` — and because the sRGB curve is a
 * near-pure power law, that product tracks `srgbEncode(∏ tᵢ)`, the exact linear-light composite.
 * Mid alphas encode lower than the historical ramp, which is precisely the dark fringe the sRGB
 * path added; the fully covered centre and the transparent skirt edge are fixed points.
 */
export function linearizeStudioBrushSoftFalloffCoverageAlpha(
  alpha: number,
): number {
  if (!Number.isFinite(alpha) || alpha <= 0) return 0;
  if (alpha >= 1) return 1;
  return 1 - srgbEncodeUnitValue(1 - alpha);
}

function validStampResolution(resolution: number): boolean {
  return Number.isSafeInteger(resolution)
    && resolution >= 32
    && resolution <= 512;
}

function surfaceSizeForResolution(resolution: number): number {
  return resolution + STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS * 2;
}

function softFalloffMaskCacheKey(
  exponent: number,
  resolution: number,
  tone?: StudioBrushSoftFalloffStampTone,
): string {
  return JSON.stringify([
    // The absent-tone key stays byte-identical to the historical key so already-warm legacy
    // caches keep hitting; the pinned tone claims a disjoint versioned namespace.
    tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
      ? "analytic-radial-mask-linear-accumulation-v1"
      : "analytic-radial-mask-v1",
    exponent.toString(),
    resolution,
    STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS,
  ]);
}

function softFalloffTintedCacheKey(
  profileKey: string,
  color: string,
): string {
  return JSON.stringify(["exact-color-v1", profileKey, color]);
}

/**
 * Evaluates the exact analytic alpha at each texel centre. This is not a colour-stop
 * approximation: every sample is `(1 - r) ^ exponent` inside the unit disk and zero outside.
 * RGB stays white even at alpha zero so browser premultiplication/filtering cannot add a dark edge.
 */
export function rasterizeStudioBrushSoftFalloffMaskRgba(
  exponent: number,
  resolution = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  tone?: StudioBrushSoftFalloffStampTone,
): StudioBrushSoftFalloffStampRaster | null {
  if (
    !validFalloffExponent(exponent)
    || !validStampResolution(resolution)
    || !validFalloffTone(tone)
  ) {
    return null;
  }

  const linearAccumulation =
    tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE;
  const gutterPixels = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS;
  const surfaceSize = surfaceSizeForResolution(resolution);
  const centre = surfaceSize / 2;
  const unitRadius = resolution / 2;
  const pixels = new Uint8ClampedArray(surfaceSize * surfaceSize * 4);

  for (let y = 0; y < surfaceSize; y += 1) {
    const normalizedY = (y + 0.5 - centre) / unitRadius;
    for (let x = 0; x < surfaceSize; x += 1) {
      const normalizedX = (x + 0.5 - centre) / unitRadius;
      const radius = Math.hypot(normalizedX, normalizedY);
      const coverage = radius < 1
        ? Math.pow(1 - radius, exponent)
        : 0;
      const offset = (y * surfaceSize + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = clampByte(
        (linearAccumulation
          ? linearizeStudioBrushSoftFalloffCoverageAlpha(coverage)
          : coverage) * 255,
      );
    }
  }

  return {
    pixels,
    resolution,
    gutterPixels,
    surfaceSize,
  };
}

/**
 * Renderer-neutral exact-colour raster retained for SVG/export encoders. The interactive Canvas
 * path intentionally uses the colourless cached mask plus reusable tint scratch instead.
 */
export function rasterizeStudioBrushSoftFalloffStampRgba(
  exponent: number,
  color: string,
  resolution = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  tone?: StudioBrushSoftFalloffStampTone,
): StudioBrushSoftFalloffStampRaster | null {
  const mask = rasterizeStudioBrushSoftFalloffMaskRgba(
    exponent,
    resolution,
    tone,
  );
  const channels = canonicalHexColorChannels(color);
  if (!mask || !channels) return null;
  const [red, green, blue, sourceAlpha] = channels;
  const pixels = new Uint8ClampedArray(mask.pixels.length);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = clampByte(
      mask.pixels[offset + 3]! * sourceAlpha / 255,
    );
  }
  return { ...mask, pixels };
}

function releaseSoftFalloffMaskEntry(entry: SoftFalloffMaskCacheEntry): void {
  const index = softFalloffMaskCache.indexOf(entry);
  if (index >= 0) softFalloffMaskCache.splice(index, 1);
  softFalloffMaskCacheByFactory.get(entry.factory)?.delete(entry.cacheKey);
  softFalloffStampCacheBytes = Math.max(
    0,
    softFalloffStampCacheBytes - entry.bytes,
  );
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function releaseSoftFalloffTintScratchEntry(
  entry: SoftFalloffTintScratchEntry,
): void {
  const index = softFalloffTintScratchCache.indexOf(entry);
  if (index >= 0) softFalloffTintScratchCache.splice(index, 1);
  softFalloffTintScratchByFactory
    .get(entry.factory)
    ?.delete(entry.resolution);
  softFalloffStampCacheBytes = Math.max(
    0,
    softFalloffStampCacheBytes - entry.bytes,
  );
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function releaseSoftFalloffTintedEntry(
  entry: SoftFalloffTintedCacheEntry,
): void {
  const index = softFalloffTintedCache.indexOf(entry);
  if (index >= 0) softFalloffTintedCache.splice(index, 1);
  softFalloffTintedCacheByFactory.get(entry.factory)?.delete(entry.cacheKey);
  const profileEntries = softFalloffTintedProfilesByFactory
    .get(entry.factory)
    ?.get(entry.profileKey);
  if (profileEntries) {
    const profileIndex = profileEntries.indexOf(entry);
    if (profileIndex >= 0) profileEntries.splice(profileIndex, 1);
    if (profileEntries.length === 0) {
      softFalloffTintedProfilesByFactory
        .get(entry.factory)
        ?.delete(entry.profileKey);
    }
  }
  softFalloffStampCacheBytes = Math.max(
    0,
    softFalloffStampCacheBytes - entry.bytes,
  );
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function oldestMaskEntry(): SoftFalloffMaskCacheEntry | undefined {
  let oldest = softFalloffMaskCache[0];
  for (const entry of softFalloffMaskCache) {
    if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
  }
  return oldest;
}

function oldestScratchEntry(): SoftFalloffTintScratchEntry | undefined {
  let oldest = softFalloffTintScratchCache[0];
  for (const entry of softFalloffTintScratchCache) {
    if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
  }
  return oldest;
}

function oldestTintedEntry(): SoftFalloffTintedCacheEntry | undefined {
  let oldest = softFalloffTintedCache[0];
  for (const entry of softFalloffTintedCache) {
    if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
  }
  return oldest;
}

function evictSoftFalloffStampCache(): void {
  while (
    softFalloffMaskCache.length
      > STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_ENTRY_LIMIT
  ) {
    const oldest = oldestMaskEntry();
    if (!oldest) break;
    releaseSoftFalloffMaskEntry(oldest);
  }
  while (
    softFalloffTintedCache.length
      > STUDIO_BRUSH_SOFT_FALLOFF_TINTED_CACHE_ENTRY_LIMIT
  ) {
    const oldest = oldestTintedEntry();
    if (!oldest) break;
    releaseSoftFalloffTintedEntry(oldest);
  }
  while (
    softFalloffTintScratchCache.length
      > STUDIO_BRUSH_SOFT_FALLOFF_TINT_SCRATCH_ENTRY_LIMIT
  ) {
    const oldest = oldestScratchEntry();
    if (!oldest) break;
    releaseSoftFalloffTintScratchEntry(oldest);
  }
  while (
    softFalloffStampCacheBytes
      > STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_BYTE_BUDGET
  ) {
    const oldestMask = oldestMaskEntry();
    const oldestTinted = oldestTintedEntry();
    const oldestScratch = oldestScratchEntry();
    const oldestUsed = Math.min(
      oldestMask?.lastUsed ?? Number.POSITIVE_INFINITY,
      oldestTinted?.lastUsed ?? Number.POSITIVE_INFINITY,
      oldestScratch?.lastUsed ?? Number.POSITIVE_INFINITY,
    );
    if (oldestMask?.lastUsed === oldestUsed) {
      releaseSoftFalloffMaskEntry(oldestMask);
    } else if (oldestTinted?.lastUsed === oldestUsed) {
      releaseSoftFalloffTintedEntry(oldestTinted);
    } else if (oldestScratch) {
      releaseSoftFalloffTintScratchEntry(oldestScratch);
    } else {
      softFalloffStampCacheBytes = 0;
      break;
    }
  }
}

function tintSoftFalloffSurface(
  context: StudioBrushSoftFalloffStampSurfaceContext,
  mask: StudioBrushSoftFalloffStampSurface,
  color: string,
  surfaceSize: number,
): boolean {
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.drawImage!(
      mask,
      0,
      0,
      surfaceSize,
      surfaceSize,
      0,
      0,
      surfaceSize,
      surfaceSize,
    );
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect!(0, 0, surfaceSize, surfaceSize);
    context.globalCompositeOperation = "source-over";
    softFalloffTintPasses += 1;
    return true;
  } catch {
    return false;
  }
}

function createTintCapableSurface(
  factory: StudioBrushSoftFalloffStampSurfaceFactory,
  resolution: number,
): Readonly<{
  surface: StudioBrushSoftFalloffStampSurface;
  context: StudioBrushSoftFalloffStampSurfaceContext;
  bytes: number;
}> | null {
  const surfaceSize = surfaceSizeForResolution(resolution);
  const bytes = surfaceSize * surfaceSize * 4;
  if (bytes > STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_BYTE_BUDGET) return null;
  let surface: StudioBrushSoftFalloffStampSurface | null = null;
  try {
    surface = factory(surfaceSize, surfaceSize);
    const context = surface?.getContext("2d", { alpha: true });
    if (
      !surface
      || !context
      || typeof context.drawImage !== "function"
      || typeof context.fillRect !== "function"
      || !("globalCompositeOperation" in context)
      || !("globalAlpha" in context)
      || !("fillStyle" in context)
    ) {
      if (surface) {
        surface.width = 1;
        surface.height = 1;
      }
      return null;
    }
    return { surface, context, bytes };
  } catch {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
    return null;
  }
}

function acquireSoftFalloffMaskSurface(
  exponent: number,
  factory: StudioBrushSoftFalloffStampSurfaceFactory,
  resolution: number,
  tone?: StudioBrushSoftFalloffStampTone,
): StudioBrushSoftFalloffStampSurface | null {
  if (
    !validFalloffExponent(exponent)
    || !validStampResolution(resolution)
    || !validFalloffTone(tone)
  ) {
    return null;
  }
  const cacheKey = softFalloffMaskCacheKey(exponent, resolution, tone);
  const cached = softFalloffMaskCacheByFactory.get(factory)?.get(cacheKey);
  if (cached) {
    cached.lastUsed = ++softFalloffStampCacheClock;
    softFalloffStampCacheHits += 1;
    return cached.surface;
  }

  softFalloffStampCacheMisses += 1;
  const raster = rasterizeStudioBrushSoftFalloffMaskRgba(
    exponent,
    resolution,
    tone,
  );
  if (!raster) return null;
  const bytes = raster.pixels.byteLength;
  if (bytes > STUDIO_BRUSH_SOFT_FALLOFF_STAMP_CACHE_BYTE_BUDGET) return null;

  let surface: StudioBrushSoftFalloffStampSurface | null = null;
  try {
    surface = factory(raster.surfaceSize, raster.surfaceSize);
    const context = surface?.getContext("2d", { alpha: true });
    if (!surface || !context) return null;
    const imageData = context.createImageData(
      raster.surfaceSize,
      raster.surfaceSize,
    );
    if (
      imageData.width !== raster.surfaceSize
      || imageData.height !== raster.surfaceSize
      || imageData.data.length !== raster.pixels.length
    ) {
      surface.width = 1;
      surface.height = 1;
      return null;
    }
    imageData.data.set(raster.pixels);
    context.putImageData(imageData, 0, 0);
  } catch {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
    return null;
  }

  const entry: SoftFalloffMaskCacheEntry = {
    cacheKey,
    factory,
    surface,
    bytes,
    lastUsed: ++softFalloffStampCacheClock,
  };
  softFalloffStampSurfaceAllocations += 1;
  softFalloffMaskCache.push(entry);
  const factoryCache = softFalloffMaskCacheByFactory.get(factory) ?? new Map();
  factoryCache.set(cacheKey, entry);
  softFalloffMaskCacheByFactory.set(factory, factoryCache);
  softFalloffStampCacheBytes += bytes;
  evictSoftFalloffStampCache();
  return softFalloffMaskCache.includes(entry) ? surface : null;
}

function acquireSoftFalloffTintScratch(
  factory: StudioBrushSoftFalloffStampSurfaceFactory,
  resolution: number,
): SoftFalloffTintScratchEntry | null {
  const cached = softFalloffTintScratchByFactory
    .get(factory)
    ?.get(resolution);
  if (cached) {
    cached.lastUsed = ++softFalloffStampCacheClock;
    return cached;
  }

  const target = createTintCapableSurface(factory, resolution);
  if (!target) return null;
  try {
    const entry: SoftFalloffTintScratchEntry = {
      resolution,
      factory,
      surface: target.surface,
      context: target.context,
      bytes: target.bytes,
      lastUsed: ++softFalloffStampCacheClock,
    };
    softFalloffStampSurfaceAllocations += 1;
    softFalloffTintScratchCache.push(entry);
    const factoryCache = softFalloffTintScratchByFactory.get(factory)
      ?? new Map();
    factoryCache.set(resolution, entry);
    softFalloffTintScratchByFactory.set(factory, factoryCache);
    softFalloffStampCacheBytes += target.bytes;
    evictSoftFalloffStampCache();
    return softFalloffTintScratchCache.includes(entry) ? entry : null;
  } catch {
    target.surface.width = 1;
    target.surface.height = 1;
    return null;
  }
}

function createPromotedTintedSurface(
  profileKey: string,
  color: string,
  mask: StudioBrushSoftFalloffStampSurface,
  factory: StudioBrushSoftFalloffStampSurfaceFactory,
  resolution: number,
): StudioBrushSoftFalloffStampSurface | null {
  const target = createTintCapableSurface(factory, resolution);
  if (!target) return null;
  const surfaceSize = surfaceSizeForResolution(resolution);
  if (!tintSoftFalloffSurface(
    target.context,
    mask,
    color,
    surfaceSize,
  )) {
    target.surface.width = 1;
    target.surface.height = 1;
    return null;
  }
  const cacheKey = softFalloffTintedCacheKey(profileKey, color);
  const entry: SoftFalloffTintedCacheEntry = {
    cacheKey,
    profileKey,
    factory,
    surface: target.surface,
    bytes: target.bytes,
    lastUsed: ++softFalloffStampCacheClock,
  };
  softFalloffStampSurfaceAllocations += 1;
  softFalloffTintedCache.push(entry);
  const factoryCache = softFalloffTintedCacheByFactory.get(factory) ?? new Map();
  factoryCache.set(cacheKey, entry);
  softFalloffTintedCacheByFactory.set(factory, factoryCache);
  const factoryProfiles = softFalloffTintedProfilesByFactory.get(factory)
    ?? new Map();
  const profileEntries = factoryProfiles.get(profileKey) ?? [];
  profileEntries.push(entry);
  factoryProfiles.set(profileKey, profileEntries);
  softFalloffTintedProfilesByFactory.set(factory, factoryProfiles);
  softFalloffStampCacheBytes += target.bytes;
  evictSoftFalloffStampCache();
  return softFalloffTintedCache.includes(entry) ? target.surface : null;
}

/**
 * Produces an exact-colour stamp. Repeated colours return immutable promoted surfaces; uncommon
 * high-cardinality colours return a reused mutable scratch and must be drawn synchronously before
 * preparing another colour through the same factory/resolution.
 */
export function prepareStudioBrushSoftFalloffTintedStampSurface(
  exponent: number,
  color: string,
  factory: StudioBrushSoftFalloffStampSurfaceFactory,
  resolution = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  tone?: StudioBrushSoftFalloffStampTone,
): StudioBrushSoftFalloffStampSurface | null {
  const resolvedColor = canonicalHexColor(color);
  if (
    !resolvedColor
    || !validFalloffExponent(exponent)
    || !validStampResolution(resolution)
    || !validFalloffTone(tone)
  ) {
    return null;
  }
  // The tone participates in the profile key, so tinted promotions and their per-profile colour
  // budget version together with the mask — a pinned stroke can never reuse a legacy-ramp stamp.
  const profileKey = softFalloffMaskCacheKey(exponent, resolution, tone);
  const tintedCacheKey = softFalloffTintedCacheKey(
    profileKey,
    resolvedColor,
  );
  const cachedTinted = softFalloffTintedCacheByFactory
    .get(factory)
    ?.get(tintedCacheKey);
  if (cachedTinted) {
    cachedTinted.lastUsed = ++softFalloffStampCacheClock;
    softFalloffTintedCacheHits += 1;
    return cachedTinted.surface;
  }
  const mask = acquireSoftFalloffMaskSurface(
    exponent,
    factory,
    resolution,
    tone,
  );
  if (!mask) return null;
  const profileEntries = softFalloffTintedProfilesByFactory
    .get(factory)
    ?.get(profileKey) ?? [];
  if (
    profileEntries.length
      < STUDIO_BRUSH_SOFT_FALLOFF_TINTED_COLORS_PER_PROFILE
  ) {
    return createPromotedTintedSurface(
      profileKey,
      resolvedColor,
      mask,
      factory,
      resolution,
    );
  }
  const scratch = acquireSoftFalloffTintScratch(factory, resolution);
  if (!scratch) return null;

  const surfaceSize = surfaceSizeForResolution(resolution);
  if (tintSoftFalloffSurface(
    scratch.context,
    mask,
    resolvedColor,
    surfaceSize,
  )) {
    scratch.lastUsed = ++softFalloffStampCacheClock;
    return scratch.surface;
  }
  releaseSoftFalloffTintScratchEntry(scratch);
  return null;
}

export function clearStudioBrushSoftFalloffStampCache(): void {
  for (const entry of [...softFalloffMaskCache]) {
    releaseSoftFalloffMaskEntry(entry);
  }
  for (const entry of [...softFalloffTintedCache]) {
    releaseSoftFalloffTintedEntry(entry);
  }
  for (const entry of [...softFalloffTintScratchCache]) {
    releaseSoftFalloffTintScratchEntry(entry);
  }
  softFalloffStampCacheClock = 0;
  softFalloffStampSurfaceAllocations = 0;
  softFalloffStampCacheHits = 0;
  softFalloffStampCacheMisses = 0;
  softFalloffTintedCacheHits = 0;
  softFalloffTintPasses = 0;
}

export function studioBrushSoftFalloffStampCacheStats(): Readonly<{
  entries: number;
  tintedEntries: number;
  scratchSurfaces: number;
  bytes: number;
  surfaceAllocations: number;
  hits: number;
  misses: number;
  tintedHits: number;
  tintPasses: number;
}> {
  return Object.freeze({
    entries: softFalloffMaskCache.length,
    tintedEntries: softFalloffTintedCache.length,
    scratchSurfaces: softFalloffTintScratchCache.length,
    bytes: softFalloffStampCacheBytes,
    surfaceAllocations: softFalloffStampSurfaceAllocations,
    hits: softFalloffStampCacheHits,
    misses: softFalloffStampCacheMisses,
    tintedHits: softFalloffTintedCacheHits,
    tintPasses: softFalloffTintPasses,
  });
}
