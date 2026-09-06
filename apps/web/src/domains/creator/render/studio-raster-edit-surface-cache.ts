/**
 * A tiny, bounded bridge between destructive raster strokes and Konva image presentation.
 *
 * The document remains authoritative through its immutable PNG `src`. The cached canvas is only
 * accepted for that exact string, so undo/redo, collaboration, page changes, and stale mutations
 * fail closed without introducing a second document model. Keeping the just-encoded surface lets
 * the next stroke skip PNG decode and lets Konva present the exact pixels while its canonical
 * `Image` continues decoding in the background.
 */

const STUDIO_RASTER_SURFACE_CACHE_MAX_ENTRIES = 2;
const STUDIO_RASTER_SURFACE_CACHE_MAX_PIXELS = 24 * 1024 * 1024;
const STUDIO_RASTER_SURFACE_CACHE_IDLE_MS = 45_000;

interface StudioRasterEditSurfaceEntry {
  readonly pixels: number;
  readonly surface: HTMLCanvasElement;
}

const entries = new Map<string, StudioRasterEditSurfaceEntry>();
const listeners = new Set<() => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function notifyStudioRasterEditSurfaceListeners(): void {
  for (const listener of listeners) listener();
}

function cancelStudioRasterEditSurfaceIdleTimer(): void {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleStudioRasterEditSurfaceIdleClear(): void {
  cancelStudioRasterEditSurfaceIdleTimer();
  if (entries.size === 0) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (entries.size === 0) return;
    entries.clear();
    notifyStudioRasterEditSurfaceListeners();
  }, STUDIO_RASTER_SURFACE_CACHE_IDLE_MS);
}

function touchStudioRasterEditSurfaceEntry(
  src: string,
  entry: StudioRasterEditSurfaceEntry,
): void {
  entries.delete(src);
  entries.set(src, entry);
  scheduleStudioRasterEditSurfaceIdleClear();
}

function trimStudioRasterEditSurfaceCache(): void {
  let pixels = 0;
  for (const entry of entries.values()) pixels += entry.pixels;
  while (
    entries.size > STUDIO_RASTER_SURFACE_CACHE_MAX_ENTRIES
    || pixels > STUDIO_RASTER_SURFACE_CACHE_MAX_PIXELS
  ) {
    const oldest = entries.entries().next().value as
      | [string, StudioRasterEditSurfaceEntry]
      | undefined;
    if (!oldest) break;
    entries.delete(oldest[0]);
    pixels -= oldest[1].pixels;
  }
}

/** Pure snapshot used by `useSyncExternalStore`; it deliberately does not mutate LRU order. */
export function getStudioRasterEditSurfaceSnapshot(src: string): HTMLCanvasElement | null {
  return entries.get(src)?.surface ?? null;
}

/** Operation-time lookup. A hit refreshes the short idle lease and LRU order. */
export function takeStudioRasterEditSurface(src: string): HTMLCanvasElement | null {
  const entry = entries.get(src);
  if (!entry) return null;
  touchStudioRasterEditSurfaceEntry(src, entry);
  return entry.surface;
}

/**
 * Publishes an immutable, fully rendered canvas for its exact encoded PNG authority string.
 * Callers must not mutate the canvas after registering it.
 */
export function rememberStudioRasterEditSurface(
  src: string,
  surface: HTMLCanvasElement,
): void {
  const width = Number(surface.width);
  const height = Number(surface.height);
  const pixels = width * height;
  if (
    !src
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || !Number.isSafeInteger(pixels)
    || pixels > STUDIO_RASTER_SURFACE_CACHE_MAX_PIXELS
  ) return;

  const current = entries.get(src);
  if (current?.surface === surface) {
    touchStudioRasterEditSurfaceEntry(src, current);
    return;
  }
  entries.delete(src);
  entries.set(src, { pixels, surface });
  trimStudioRasterEditSurfaceCache();
  scheduleStudioRasterEditSurfaceIdleClear();
  notifyStudioRasterEditSurfaceListeners();
}

export function subscribeStudioRasterEditSurfaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearStudioRasterEditSurfaces(): void {
  cancelStudioRasterEditSurfaceIdleTimer();
  if (entries.size === 0) return;
  entries.clear();
  notifyStudioRasterEditSurfaceListeners();
}

/** Deterministic diagnostics for unit tests and the browser performance verifier. */
export function studioRasterEditSurfaceCacheStats(): {
  readonly entries: number;
  readonly pixels: number;
} {
  let pixels = 0;
  for (const entry of entries.values()) pixels += entry.pixels;
  return { entries: entries.size, pixels };
}

if (import.meta.hot) {
  import.meta.hot.dispose(clearStudioRasterEditSurfaces);
}
