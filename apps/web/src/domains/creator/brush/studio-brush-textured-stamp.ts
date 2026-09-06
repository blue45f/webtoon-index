/**
 * Full-resolution alpha-tip raster cache for the Canvas dynamic-brush authority.
 *
 * Immutable alpha masks are cached by map revision. Colours seen repeatedly are promoted into an
 * exact-colour surface cache, while high-cardinality colour dynamics use one mutable tint scratch.
 * The destination hot path therefore stays at one affine `drawImage` call per textured tip layer;
 * it never expands an alpha map into a grid of circular dabs and never allocates pixels per dab.
 */

import {
  STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE,
  type StudioBrushTipAlphaMap,
} from "./studio-brush-tip-stamp";

export const STUDIO_BRUSH_TEXTURE_STAMP_CACHE_BYTE_BUDGET = 8 * 1024 * 1024;
export const STUDIO_BRUSH_TEXTURE_STAMP_CACHE_ENTRY_LIMIT = 512;
export const STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT = 128;
export const STUDIO_BRUSH_TEXTURE_STAMP_SCRATCH_ENTRY_LIMIT = 16;
const STUDIO_BRUSH_TEXTURE_STAMP_TINT_PROMOTION_HITS = 2;
const STUDIO_BRUSH_TEXTURE_STAMP_TINT_CANDIDATE_LIMIT = 1_024;

export interface StudioBrushTextureStampSurfaceContext {
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

export type StudioBrushTextureStampSurface = CanvasImageSource & {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): StudioBrushTextureStampSurfaceContext | null;
};

export type StudioBrushTextureStampSurfaceFactory = (
  width: number,
  height: number,
) => StudioBrushTextureStampSurface | null;

interface StudioBrushTextureMaskCacheEntry {
  readonly cacheKey: string;
  readonly factory: StudioBrushTextureStampSurfaceFactory;
  readonly surface: StudioBrushTextureStampSurface;
  readonly bytes: number;
  lastUsed: number;
}

interface StudioBrushTextureTintCacheEntry {
  readonly cacheKey: string;
  readonly factory: StudioBrushTextureStampSurfaceFactory;
  readonly surface: StudioBrushTextureStampSurface;
  readonly bytes: number;
  lastUsed: number;
}

interface StudioBrushTextureTintScratchEntry {
  readonly size: number;
  readonly factory: StudioBrushTextureStampSurfaceFactory;
  readonly surface: StudioBrushTextureStampSurface;
  readonly context: StudioBrushTextureStampSurfaceContext;
  readonly bytes: number;
  lastUsed: number;
}

interface StudioBrushTextureTintCandidateState {
  generation: number;
  readonly candidates: Map<string, { hits: number; lastUsed: number }>;
}

const textureMaskCache: StudioBrushTextureMaskCacheEntry[] = [];
const textureMaskCacheByFactory = new WeakMap<
  StudioBrushTextureStampSurfaceFactory,
  Map<string, StudioBrushTextureMaskCacheEntry>
>();
const textureTintCache: StudioBrushTextureTintCacheEntry[] = [];
const textureTintCacheByFactory = new WeakMap<
  StudioBrushTextureStampSurfaceFactory,
  Map<string, StudioBrushTextureTintCacheEntry>
>();
const textureTintScratchCache: StudioBrushTextureTintScratchEntry[] = [];
const textureTintScratchByFactory = new WeakMap<
  StudioBrushTextureStampSurfaceFactory,
  Map<number, StudioBrushTextureTintScratchEntry>
>();
const textureTintCandidatesByFactory = new WeakMap<
  StudioBrushTextureStampSurfaceFactory,
  StudioBrushTextureTintCandidateState
>();
let textureStampCacheBytes = 0;
let textureStampCacheClock = 0;
let textureStampCacheGeneration = 0;
let textureStampSurfaceAllocations = 0;
let textureStampMaskHits = 0;
let textureStampMaskMisses = 0;
let textureStampTintHits = 0;
let textureStampTintPasses = 0;

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

function parseHexColor(
  value: string,
): readonly [red: number, green: number, blue: number, alpha: number] | null {
  const canonical = canonicalHexColor(value);
  if (!canonical) return null;
  const expanded = canonical.slice(1);
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
    expanded.length === 8
      ? Number.parseInt(expanded.slice(6, 8), 16)
      : 255,
  ];
}

export function studioBrushTextureAlphaMapIsValid(
  map: StudioBrushTipAlphaMap,
): boolean {
  return Number.isSafeInteger(map.size)
    && map.size > 0
    && map.size <= STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.max
    && map.alphas instanceof Float32Array
    && map.alphas.length === map.size * map.size;
}

/**
 * Pure R8-alpha → white RGBA expansion used only on immutable-mask cache misses.
 * RGB remains white at alpha zero to avoid dark bilinear fringes after browser premultiplication.
 */
export function rasterizeStudioBrushTextureMaskRgba(
  map: StudioBrushTipAlphaMap,
): Uint8ClampedArray | null {
  if (!studioBrushTextureAlphaMapIsValid(map)) return null;
  const pixels = new Uint8ClampedArray(map.size * map.size * 4);
  for (let index = 0; index < map.alphas.length; index += 1) {
    const alpha = map.alphas[index]!;
    if (!Number.isFinite(alpha)) return null;
    const offset = index * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = clampByte(Math.min(1, Math.max(0, alpha)) * 255);
  }
  return pixels;
}

/**
 * Renderer-neutral exact-colour raster retained for SVG/export encoders and pixel tests. The
 * interactive Canvas path uses the mask cache plus compositing instead of allocating this per dab.
 */
export function rasterizeStudioBrushTextureStampRgba(
  map: StudioBrushTipAlphaMap,
  color: string,
): Uint8ClampedArray | null {
  const mask = rasterizeStudioBrushTextureMaskRgba(map);
  const rgba = parseHexColor(color);
  if (!mask || !rgba) return null;
  const [red, green, blue, sourceAlpha] = rgba;
  const pixels = new Uint8ClampedArray(mask.length);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = clampByte(mask[offset + 3]! * sourceAlpha / 255);
  }
  return pixels;
}

function textureMaskCacheKey(map: StudioBrushTipAlphaMap): string | null {
  // Renderer-produced maps carry an immutable content revision. External editable maps omit it
  // and are never reusable, so in-place edits cannot read stale pixels.
  return map.revision === undefined
    ? null
    : JSON.stringify([
      "full-alpha-mask-v2",
      typeof map.revision,
      map.revision,
      map.size,
    ]);
}

function releaseTextureMaskEntry(entry: StudioBrushTextureMaskCacheEntry): void {
  const index = textureMaskCache.indexOf(entry);
  if (index >= 0) textureMaskCache.splice(index, 1);
  textureMaskCacheByFactory.get(entry.factory)?.delete(entry.cacheKey);
  textureStampCacheBytes = Math.max(0, textureStampCacheBytes - entry.bytes);
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function releaseTextureTintEntry(entry: StudioBrushTextureTintCacheEntry): void {
  const index = textureTintCache.indexOf(entry);
  if (index >= 0) textureTintCache.splice(index, 1);
  textureTintCacheByFactory.get(entry.factory)?.delete(entry.cacheKey);
  textureStampCacheBytes = Math.max(0, textureStampCacheBytes - entry.bytes);
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function releaseTextureTintScratchEntry(
  entry: StudioBrushTextureTintScratchEntry,
): void {
  const index = textureTintScratchCache.indexOf(entry);
  if (index >= 0) textureTintScratchCache.splice(index, 1);
  textureTintScratchByFactory.get(entry.factory)?.delete(entry.size);
  textureStampCacheBytes = Math.max(0, textureStampCacheBytes - entry.bytes);
  entry.surface.width = 1;
  entry.surface.height = 1;
}

function oldestEntry<T extends { lastUsed: number }>(
  entries: readonly T[],
): T | undefined {
  let oldest = entries[0];
  for (const entry of entries) {
    if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
  }
  return oldest;
}

function evictTextureStampCache(): void {
  while (
    textureMaskCache.length > STUDIO_BRUSH_TEXTURE_STAMP_CACHE_ENTRY_LIMIT
  ) {
    const oldest = oldestEntry(textureMaskCache);
    if (!oldest) break;
    releaseTextureMaskEntry(oldest);
  }
  while (
    textureTintCache.length > STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT
  ) {
    const oldest = oldestEntry(textureTintCache);
    if (!oldest) break;
    releaseTextureTintEntry(oldest);
  }
  while (
    textureTintScratchCache.length
      > STUDIO_BRUSH_TEXTURE_STAMP_SCRATCH_ENTRY_LIMIT
  ) {
    const oldest = oldestEntry(textureTintScratchCache);
    if (!oldest) break;
    releaseTextureTintScratchEntry(oldest);
  }
  while (
    textureStampCacheBytes > STUDIO_BRUSH_TEXTURE_STAMP_CACHE_BYTE_BUDGET
  ) {
    const oldestMask = oldestEntry(textureMaskCache);
    const oldestTint = oldestEntry(textureTintCache);
    const oldestScratch = oldestEntry(textureTintScratchCache);
    const oldestTime = Math.min(
      oldestMask?.lastUsed ?? Number.POSITIVE_INFINITY,
      oldestTint?.lastUsed ?? Number.POSITIVE_INFINITY,
      oldestScratch?.lastUsed ?? Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(oldestTime)) {
      textureStampCacheBytes = 0;
      break;
    }
    if (oldestMask?.lastUsed === oldestTime) {
      releaseTextureMaskEntry(oldestMask);
    } else if (oldestTint?.lastUsed === oldestTime) {
      releaseTextureTintEntry(oldestTint);
    } else if (oldestScratch) {
      releaseTextureTintScratchEntry(oldestScratch);
    }
  }
}

function allocateTextureMaskSurface(
  map: StudioBrushTipAlphaMap,
  factory: StudioBrushTextureStampSurfaceFactory,
): Readonly<{
  surface: StudioBrushTextureStampSurface;
  bytes: number;
}> | null {
  const pixels = rasterizeStudioBrushTextureMaskRgba(map);
  if (!pixels) return null;
  const bytes = pixels.byteLength;
  if (bytes > STUDIO_BRUSH_TEXTURE_STAMP_CACHE_BYTE_BUDGET) return null;

  let surface: StudioBrushTextureStampSurface | null = null;
  try {
    surface = factory(map.size, map.size);
    const context = surface?.getContext("2d", { alpha: true });
    if (!surface || !context) return null;
    const imageData = context.createImageData(map.size, map.size);
    if (
      imageData.width !== map.size
      || imageData.height !== map.size
      || imageData.data.length !== pixels.length
    ) {
      surface.width = 1;
      surface.height = 1;
      return null;
    }
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);
  } catch {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
    return null;
  }
  textureStampSurfaceAllocations += 1;
  return { surface, bytes };
}

function acquireTextureMaskSurface(
  map: StudioBrushTipAlphaMap,
  factory: StudioBrushTextureStampSurfaceFactory,
): Readonly<{
  surface: StudioBrushTextureStampSurface;
  transient: boolean;
}> | null {
  const cacheKey = textureMaskCacheKey(map);
  const cached = cacheKey === null
    ? undefined
    : textureMaskCacheByFactory.get(factory)?.get(cacheKey);
  if (cached) {
    cached.lastUsed = ++textureStampCacheClock;
    textureStampMaskHits += 1;
    return { surface: cached.surface, transient: false };
  }

  textureStampMaskMisses += 1;
  const allocated = allocateTextureMaskSurface(map, factory);
  if (!allocated) return null;
  if (cacheKey === null) {
    return { surface: allocated.surface, transient: true };
  }

  const entry: StudioBrushTextureMaskCacheEntry = {
    cacheKey,
    factory,
    surface: allocated.surface,
    bytes: allocated.bytes,
    lastUsed: ++textureStampCacheClock,
  };
  textureMaskCache.push(entry);
  const factoryCache = textureMaskCacheByFactory.get(factory) ?? new Map();
  factoryCache.set(cacheKey, entry);
  textureMaskCacheByFactory.set(factory, factoryCache);
  textureStampCacheBytes += allocated.bytes;
  evictTextureStampCache();
  return textureMaskCache.includes(entry)
    ? { surface: allocated.surface, transient: false }
    : null;
}

function contextCanTint(
  context: StudioBrushTextureStampSurfaceContext,
): boolean {
  return typeof context.drawImage === "function"
    && typeof context.fillRect === "function"
    && "globalAlpha" in context
    && "globalCompositeOperation" in context
    && "fillStyle" in context;
}

function tintTextureSurface(
  mask: StudioBrushTextureStampSurface,
  target: StudioBrushTextureTintScratchEntry,
  color: string,
): boolean {
  try {
    target.context.globalAlpha = 1;
    target.context.globalCompositeOperation = "copy";
    target.context.drawImage!(
      mask,
      0,
      0,
      target.size,
      target.size,
      0,
      0,
      target.size,
      target.size,
    );
    target.context.globalCompositeOperation = "source-in";
    target.context.fillStyle = color;
    target.context.fillRect!(0, 0, target.size, target.size);
    target.context.globalCompositeOperation = "source-over";
    target.lastUsed = ++textureStampCacheClock;
    textureStampTintPasses += 1;
    return true;
  } catch {
    return false;
  }
}

function allocateTextureTintTarget(
  size: number,
  factory: StudioBrushTextureStampSurfaceFactory,
): StudioBrushTextureTintScratchEntry | null {
  const bytes = size * size * 4;
  if (bytes > STUDIO_BRUSH_TEXTURE_STAMP_CACHE_BYTE_BUDGET) return null;
  let surface: StudioBrushTextureStampSurface | null = null;
  try {
    surface = factory(size, size);
    const context = surface?.getContext("2d", { alpha: true });
    if (!surface || !context || !contextCanTint(context)) {
      if (surface) {
        surface.width = 1;
        surface.height = 1;
      }
      return null;
    }
    textureStampSurfaceAllocations += 1;
    return {
      size,
      factory,
      surface,
      context,
      bytes,
      lastUsed: ++textureStampCacheClock,
    };
  } catch {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
    return null;
  }
}

function acquireTextureTintScratch(
  size: number,
  factory: StudioBrushTextureStampSurfaceFactory,
): StudioBrushTextureTintScratchEntry | null {
  const cached = textureTintScratchByFactory.get(factory)?.get(size);
  if (cached) {
    cached.lastUsed = ++textureStampCacheClock;
    return cached;
  }
  const allocated = allocateTextureTintTarget(size, factory);
  if (!allocated) return null;
  textureTintScratchCache.push(allocated);
  const factoryCache = textureTintScratchByFactory.get(factory) ?? new Map();
  factoryCache.set(size, allocated);
  textureTintScratchByFactory.set(factory, factoryCache);
  textureStampCacheBytes += allocated.bytes;
  evictTextureStampCache();
  return textureTintScratchCache.includes(allocated) ? allocated : null;
}

function noteTextureTintCandidate(
  factory: StudioBrushTextureStampSurfaceFactory,
  cacheKey: string,
): boolean {
  let state = textureTintCandidatesByFactory.get(factory);
  if (!state || state.generation !== textureStampCacheGeneration) {
    state = {
      generation: textureStampCacheGeneration,
      candidates: new Map(),
    };
    textureTintCandidatesByFactory.set(factory, state);
  }
  const existing = state.candidates.get(cacheKey);
  if (existing) {
    existing.hits += 1;
    existing.lastUsed = ++textureStampCacheClock;
    return existing.hits >= STUDIO_BRUSH_TEXTURE_STAMP_TINT_PROMOTION_HITS;
  }
  if (
    state.candidates.size
      >= STUDIO_BRUSH_TEXTURE_STAMP_TINT_CANDIDATE_LIMIT
  ) {
    let oldestKey: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, candidate] of state.candidates) {
      if (candidate.lastUsed < oldestTime) {
        oldestKey = key;
        oldestTime = candidate.lastUsed;
      }
    }
    if (oldestKey !== undefined) state.candidates.delete(oldestKey);
  }
  state.candidates.set(cacheKey, {
    hits: 1,
    lastUsed: ++textureStampCacheClock,
  });
  return false;
}

function promoteTextureTintSurface(
  cacheKey: string,
  mask: StudioBrushTextureStampSurface,
  color: string,
  size: number,
  factory: StudioBrushTextureStampSurfaceFactory,
): StudioBrushTextureStampSurface | null {
  const target = allocateTextureTintTarget(size, factory);
  if (!target) return null;
  if (!tintTextureSurface(mask, target, color)) {
    target.surface.width = 1;
    target.surface.height = 1;
    return null;
  }
  const entry: StudioBrushTextureTintCacheEntry = {
    cacheKey,
    factory,
    surface: target.surface,
    bytes: target.bytes,
    lastUsed: target.lastUsed,
  };
  textureTintCache.push(entry);
  const factoryCache = textureTintCacheByFactory.get(factory) ?? new Map();
  factoryCache.set(cacheKey, entry);
  textureTintCacheByFactory.set(factory, factoryCache);
  textureStampCacheBytes += target.bytes;
  evictTextureStampCache();
  return textureTintCache.includes(entry) ? target.surface : null;
}

/**
 * Returns an exact-colour full-tip surface. Repeated colours are immutable cached surfaces;
 * first-seen/high-cardinality colours share one mutable scratch and must be drawn synchronously.
 * The factory is part of cache identity because OffscreenCanvas, DOM canvas and host test surfaces
 * cannot safely be interchanged.
 */
export function acquireStudioBrushTextureStampSurface(
  map: StudioBrushTipAlphaMap,
  color: string,
  factory: StudioBrushTextureStampSurfaceFactory,
): StudioBrushTextureStampSurface | null {
  if (!studioBrushTextureAlphaMapIsValid(map)) return null;
  const resolvedColor = canonicalHexColor(color);
  if (!resolvedColor) return null;
  const maskCacheKey = textureMaskCacheKey(map);
  const tintCacheKey = maskCacheKey === null
    ? null
    : JSON.stringify([maskCacheKey, resolvedColor]);
  const cachedTint = tintCacheKey === null
    ? undefined
    : textureTintCacheByFactory.get(factory)?.get(tintCacheKey);
  if (cachedTint) {
    cachedTint.lastUsed = ++textureStampCacheClock;
    textureStampTintHits += 1;
    return cachedTint.surface;
  }

  const mask = acquireTextureMaskSurface(map, factory);
  if (!mask) return null;
  let result: StudioBrushTextureStampSurface | null = null;
  if (
    tintCacheKey !== null
    && noteTextureTintCandidate(factory, tintCacheKey)
  ) {
    result = promoteTextureTintSurface(
      tintCacheKey,
      mask.surface,
      resolvedColor,
      map.size,
      factory,
    );
  }
  if (!result) {
    const scratch = acquireTextureTintScratch(map.size, factory);
    if (
      scratch
      && tintTextureSurface(mask.surface, scratch, resolvedColor)
    ) {
      result = scratch.surface;
    } else if (scratch) {
      releaseTextureTintScratchEntry(scratch);
    }
  }
  if (mask.transient) {
    mask.surface.width = 1;
    mask.surface.height = 1;
  }
  return result;
}

export function clearStudioBrushTextureStampCache(): void {
  for (const entry of [...textureMaskCache]) releaseTextureMaskEntry(entry);
  for (const entry of [...textureTintCache]) releaseTextureTintEntry(entry);
  for (const entry of [...textureTintScratchCache]) {
    releaseTextureTintScratchEntry(entry);
  }
  textureStampCacheClock = 0;
  textureStampCacheGeneration += 1;
  textureStampSurfaceAllocations = 0;
  textureStampMaskHits = 0;
  textureStampMaskMisses = 0;
  textureStampTintHits = 0;
  textureStampTintPasses = 0;
}

export function studioBrushTextureStampCacheStats(): Readonly<{
  entries: number;
  maskEntries: number;
  tintEntries: number;
  scratchSurfaces: number;
  bytes: number;
  surfaceAllocations: number;
  maskHits: number;
  maskMisses: number;
  tintHits: number;
  tintPasses: number;
}> {
  return Object.freeze({
    entries: textureMaskCache.length + textureTintCache.length,
    maskEntries: textureMaskCache.length,
    tintEntries: textureTintCache.length,
    scratchSurfaces: textureTintScratchCache.length,
    bytes: textureStampCacheBytes,
    surfaceAllocations: textureStampSurfaceAllocations,
    maskHits: textureStampMaskHits,
    maskMisses: textureStampMaskMisses,
    tintHits: textureStampTintHits,
    tintPasses: textureStampTintPasses,
  });
}
