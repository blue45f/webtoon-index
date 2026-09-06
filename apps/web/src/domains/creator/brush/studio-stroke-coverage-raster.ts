/**
 * Paints a nib mark's tonal bands onto a private surface, one fill per polygon.
 *
 * The plan carries the same tone twice. SVG composites cumulative `shells` because a file has no
 * private surface to work on. This module exists so the canvas does not have to: shell `k` repaints
 * every polygon at or above `k`, which measures 183ms for one long stroke against 8.6ms for the
 * same geometry filled once (`tests/benchmarks/harness/nib-shell-raster-cost.ts`, n=900). Per frame
 * — and the live brush stroke IS re-planned and re-filled every frame — that is unaffordable, and
 * the only way to afford it by cutting bands is to give back the tone the plan exists to restore.
 *
 * Three ways to paint the disjoint bands were measured against the shells, in a browser, on the
 * real emitted geometry:
 *
 * - `destination-over`, darkest first — 7.0ms, but wrong: it lays later bands BEHIND rather than
 *   discarding them, so a lighter band overlapping a darker one still darkens it.
 * - `destination-out` then `source-over` per band — 11.5ms and lands on the exact band target, but
 *   clearing and refilling a partially covered pixel composites the two contributions
 *   multiplicatively instead of adding them, leaving a visible light seam (47–59/255) across the
 *   mark at every band boundary.
 * - **`lighter` (additive) onto a cleared surface — 7.0ms, seamless, and exact.** Only a
 *   `source-over` onto an EMPTY destination yields `coverage × alpha`, so summing band
 *   contributions is what makes two abutting bands blend linearly across their shared edge. Each
 *   band is still ONE compound nonzero fill, so it never adds to itself.
 *
 * What additive costs is where two bands genuinely OVERLAP — the thin crescent on the inside of a
 * bend, where the last polygon of one band and the first of the next overlap. There the two alphas
 * sum past the mark's own peak. That is handled by normalising the raster to the peak and letting
 * the caller carry it; see `opacity` below.
 *
 * Worth recording because it is the reverse of what the cost suggests: the cheap form is the
 * accurate one. Folding 32 cumulative shells through an 8-bit destination loses tone at every
 * composite — measured, the shells reach 206/255 where the plan asks for 217. The bands deposit
 * each target once and hit it.
 *
 * The scratch is module-scoped and grow-only. Canvas painting is synchronous, so one scratch serves
 * every mark on the page; allocating per mark would trade the overdraw for GC pressure, and caching
 * a raster per mark would trade it for either staleness at a new zoom or an unbounded texture
 * budget. At 7.0ms for the longest stroke measured — cheaper than the single flat fill this
 * replaces — neither is worth buying yet.
 */

import type { StudioStrokeLocalCoverageBand } from "./studio-stroke-local-coverage";

/** Beyond this the scratch is refused rather than allocated — an 8k×8k RGBA buffer is 256MB. */
const MAX_SCRATCH_EDGE_DEVICE_PX = 8_192;
/** Device pixels of slack around the mark so an antialiased edge is never clipped by the scratch. */
const SCRATCH_MARGIN_DEVICE_PX = 2;

export interface StudioCoverageBandRaster {
  readonly source: CanvasImageSource;
  /**
   * Alpha the CALLER must paint the blit at — the darkest band's target, which the planner
   * guarantees is the element's own opacity.
   *
   * The raster is normalised to it rather than carrying it, because that is what turns the one
   * flaw of additive compositing into the behaviour the cumulative shells have. Where two bands
   * genuinely overlap their alphas sum and would exceed the element's opacity — measured, 804 of
   * 155,049 covered pixels reached full opacity on an 85% stroke, i.e. visible specks of solid
   * paint on a translucent mark. Normalised, the darkest band is 1.0, so the surface clamps the
   * sum at 1.0 and the overlap lands on the deepest band instead of the sum. That is exactly
   * `max(band)`, which is what a shell stack does at a self-crossing.
   */
  readonly opacity: number;
  /**
   * Source rectangle in device pixels. The scratch is grow-only and therefore usually LARGER than
   * this mark, so the blit must be the nine-argument form — drawing the whole scratch would
   * squeeze a previous, bigger mark's pixels into this one's box.
   */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Destination rectangle in the painter's own user space. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchContext: CanvasRenderingContext2D | null = null;

function scratchFor(
  widthDevicePx: number,
  heightDevicePx: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  if (widthDevicePx > MAX_SCRATCH_EDGE_DEVICE_PX || heightDevicePx > MAX_SCRATCH_EDGE_DEVICE_PX) {
    return null;
  }
  const canvas = scratchCanvas ?? document.createElement("canvas");
  scratchCanvas = canvas;
  // Grow-only: assigning width/height reallocates AND clears, so shrinking would buy nothing and
  // cost a reallocation on the next larger mark.
  if (canvas.width < widthDevicePx || canvas.height < heightDevicePx) {
    canvas.width = Math.max(canvas.width, widthDevicePx);
    canvas.height = Math.max(canvas.height, heightDevicePx);
    scratchContext = null;
  }
  const context = scratchContext ?? canvas.getContext("2d");
  if (!context) return null;
  scratchContext = context;
  return { canvas, context };
}

function traceBandPath(
  context: CanvasRenderingContext2D,
  band: StudioStrokeLocalCoverageBand,
): boolean {
  context.beginPath();
  let traced = false;
  for (const polygon of band.polygons) {
    const points = polygon.points;
    if (points.length < 6) continue;
    context.moveTo(points[0]!, points[1]!);
    for (let index = 2; index < points.length; index += 2) {
      context.lineTo(points[index]!, points[index + 1]!);
    }
    context.closePath();
    traced = true;
  }
  return traced;
}

/**
 * Rasterises the mark's bands into the shared scratch and returns where to blit it.
 *
 * `devicePixelsPerUnit` must be the FULL scale from the painter's user space to device pixels —
 * canvas pixel ratio times the node's absolute scale — or the blit is resampled and the mark goes
 * soft the moment the artboard is zoomed. Returns null when there is nothing to paint or the mark
 * is too large to scratch, and the caller is expected to fall back to painting the plan directly.
 *
 * The returned source is reused by the next call, so it must be drawn before anything else
 * rasterises. That is the price of not allocating per mark, and it holds trivially inside a single
 * synchronous scene function.
 */
export function rasterizeStudioCoverageBands(
  bands: readonly StudioStrokeLocalCoverageBand[],
  color: string,
  devicePixelsPerUnit: number,
): StudioCoverageBandRaster | null {
  if (bands.length === 0) return null;
  const scale = Number.isFinite(devicePixelsPerUnit) && devicePixelsPerUnit > 0
    ? devicePixelsPerUnit
    : 1;
  // Bands run darkest first, so the head is the peak. Read it defensively anyway: a peak of zero
  // would divide the whole mark away.
  let peak = 0;
  for (const band of bands) peak = Math.max(peak, band.opacity);
  if (!(peak > 0)) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const band of bands) {
    for (const polygon of band.polygons) {
      const points = polygon.points;
      for (let index = 0; index + 1 < points.length; index += 2) {
        const x = points[index]!;
        const y = points[index + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) return null;

  const margin = SCRATCH_MARGIN_DEVICE_PX / scale;
  const originX = minX - margin;
  const originY = minY - margin;
  const widthDevicePx = Math.ceil((maxX - minX + margin * 2) * scale);
  const heightDevicePx = Math.ceil((maxY - minY + margin * 2) * scale);
  if (widthDevicePx < 1 || heightDevicePx < 1) return null;

  const scratch = scratchFor(widthDevicePx, heightDevicePx);
  if (!scratch) return null;
  const { canvas, context } = scratch;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.clearRect(0, 0, widthDevicePx, heightDevicePx);
  // Additive, onto the cleared region. See the module comment: this is what makes two abutting
  // bands blend linearly across their shared edge instead of leaving a seam.
  context.globalCompositeOperation = "lighter";
  context.fillStyle = color;
  context.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale);
  for (const band of bands) {
    context.globalAlpha = Math.min(1, Math.max(0, band.opacity / peak));
    if (traceBandPath(context, band)) context.fill("nonzero");
  }
  context.restore();

  return {
    source: canvas,
    opacity: Math.min(1, Math.max(0, peak)),
    sourceWidth: widthDevicePx,
    sourceHeight: heightDevicePx,
    x: originX,
    y: originY,
    width: widthDevicePx / scale,
    height: heightDevicePx / scale,
  };
}

/** Test seam: drops the shared scratch so a suite can assert allocation behaviour in isolation. */
export function resetStudioCoverageBandScratchForTest(): void {
  scratchCanvas = null;
  scratchContext = null;
}
