/**
 * Quality-preserving incremental oil paint for live drafts.
 *
 * The shipped wet-into-wet path reads the growing stroke bbox every Konva sceneFunc. That
 * readback is a 50–150ms main-thread stall. Stations are prefix-stable under the ordinary
 * (sub-cap) sampler, so mixing only the new suffix into a retained paper snapshot is the same
 * algorithm as remixing the whole stroke from paper each frame.
 */

import { parseStudioGpuColor } from "../render/studio-webgpu-color";

import {
  paintStudioOilRibbonCarrier,
  paintStudioOilRibbonCarrierOverlay,
  studioOilRibbonPaintIsHitPass,
  type StudioOilRibbonPaintContext,
  type StudioOilRibbonPaintInput,
  type StudioOilRibbonPaintReceipt,
} from "./studio-oil-ribbon-carrier";
import { applyStudioOilWetIntoWetStroke } from "./studio-oil-wet-into-wet";

const MAX_CACHES = 4;
const POINT_EPSILON = 1e-4;

export interface StudioOilRibbonIncrementalPaintInput extends StudioOilRibbonPaintInput {
  readonly incrementalKey: string;
}

interface AffineTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface OilIncrementalCache {
  readonly key: string;
  transform: AffineTransform;
  rect: DeviceRect;
  data: Uint8ClampedArray;
  points: readonly { readonly x: number; readonly y: number }[];
}

const caches = new Map<string, OilIncrementalCache>();

export function resetStudioOilRibbonIncrementalPaintForTests(): void {
  caches.clear();
}

export function studioOilRibbonIncrementalCacheSizeForTests(): number {
  return caches.size;
}

function identityTransform(): AffineTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function readTransform(
  native: NonNullable<StudioOilRibbonPaintContext["_context"]>,
): AffineTransform {
  const transform = native.getTransform?.() ?? identityTransform();
  return {
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    e: transform.e,
    f: transform.f,
  };
}

function sameTransform(left: AffineTransform, right: AffineTransform): boolean {
  return left.a === right.a
    && left.b === right.b
    && left.c === right.c
    && left.d === right.d
    && left.e === right.e
    && left.f === right.f;
}

function mapPoint(
  transform: AffineTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

function deviceRectForPoints(
  points: readonly { readonly x: number; readonly y: number }[],
  radiusPx: number,
  transform: AffineTransform,
  canvasWidth: number,
  canvasHeight: number,
): DeviceRect | null {
  if (points.length === 0) return null;
  const pad = Math.ceil(radiusPx + 2);
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const corners = [
    mapPoint(transform, minX - pad, minY - pad),
    mapPoint(transform, maxX + pad, minY - pad),
    mapPoint(transform, minX - pad, maxY + pad),
    mapPoint(transform, maxX + pad, maxY + pad),
  ];
  const x = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.x))));
  const y = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.y))));
  const maxDeviceX = Math.min(
    canvasWidth,
    Math.ceil(Math.max(...corners.map((corner) => corner.x))),
  );
  const maxDeviceY = Math.min(
    canvasHeight,
    Math.ceil(Math.max(...corners.map((corner) => corner.y))),
  );
  const width = maxDeviceX - x;
  const height = maxDeviceY - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function isPointPrefix(
  previous: readonly { readonly x: number; readonly y: number }[],
  next: readonly { readonly x: number; readonly y: number }[],
): boolean {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (
      Math.abs(previous[index]!.x - next[index]!.x) > POINT_EPSILON
      || Math.abs(previous[index]!.y - next[index]!.y) > POINT_EPSILON
    ) {
      return false;
    }
  }
  return true;
}

function copyRect(
  source: Uint8ClampedArray,
  sourceWidth: number,
  destination: Uint8ClampedArray,
  destinationWidth: number,
  width: number,
  height: number,
  sourceX: number,
  sourceY: number,
  destinationX: number,
  destinationY: number,
): void {
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((sourceY + row) * sourceWidth + sourceX) * 4;
    const destinationOffset = ((destinationY + row) * destinationWidth + destinationX) * 4;
    destination.set(
      source.subarray(sourceOffset, sourceOffset + width * 4),
      destinationOffset,
    );
  }
}

type DeviceStrip = DeviceRect;

function newDestinationStrips(previous: DeviceRect, union: DeviceRect): DeviceStrip[] {
  const strips: DeviceStrip[] = [];
  if (union.x < previous.x) {
    const width = Math.min(union.x + union.width, previous.x) - union.x;
    if (width > 0) {
      strips.push({ x: union.x, y: union.y, width, height: union.height });
    }
  }
  if (union.x + union.width > previous.x + previous.width) {
    const x = Math.max(union.x, previous.x + previous.width);
    const width = union.x + union.width - x;
    if (width > 0) {
      strips.push({ x, y: union.y, width, height: union.height });
    }
  }
  const innerLeft = Math.max(union.x, previous.x);
  const innerRight = Math.min(union.x + union.width, previous.x + previous.width);
  const innerWidth = innerRight - innerLeft;
  if (innerWidth > 0 && union.y < previous.y) {
    const height = Math.min(union.y + union.height, previous.y) - union.y;
    if (height > 0) {
      strips.push({ x: innerLeft, y: union.y, width: innerWidth, height });
    }
  }
  if (innerWidth > 0 && union.y + union.height > previous.y + previous.height) {
    const y = Math.max(union.y, previous.y + previous.height);
    const height = union.y + union.height - y;
    if (height > 0) {
      strips.push({ x: innerLeft, y, width: innerWidth, height });
    }
  }
  return strips;
}

function remember(cache: OilIncrementalCache): void {
  caches.delete(cache.key);
  caches.set(cache.key, cache);
  while (caches.size > MAX_CACHES) {
    const oldest = caches.keys().next().value;
    if (oldest === undefined) break;
    caches.delete(oldest);
  }
}

function wetSettings(
  radiusPx: number,
  stroke: string,
  mixModel?: "spectral-wgm" | "ryb",
): Parameters<typeof applyStudioOilWetIntoWetStroke>[4] {
  const parsed = parseStudioGpuColor(stroke);
  return {
    radiusPx: Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 8,
    hardness: 0.55,
    strength: 0.88,
    wetness: 0.65,
    pickup: 0.55,
    paintColor: parsed
      ? {
          r: Math.round(parsed[0] * 255),
          g: Math.round(parsed[1] * 255),
          b: Math.round(parsed[2] * 255),
        }
      : { r: 0, g: 0, b: 0 },
    mixModel: mixModel ?? "spectral-wgm",
  };
}

/**
 * Live Konva oil: mix only the unseen suffix against a retained paper snapshot, then paint the
 * same bristle overlay the one-shot path uses.
 */
export function paintStudioOilRibbonCarrierIncremental(
  context: StudioOilRibbonPaintContext,
  input: StudioOilRibbonIncrementalPaintInput,
): StudioOilRibbonPaintReceipt {
  if (studioOilRibbonPaintIsHitPass(context, input.hitPass === true)) {
    return paintStudioOilRibbonCarrier(context, input);
  }
  const native = context._context;
  const canvas = native?.canvas;
  if (
    !native
    || !canvas
    || typeof native.getImageData !== "function"
    || typeof native.putImageData !== "function"
    || input.points.length === 0
    || canvas.width <= 0
    || canvas.height <= 0
  ) {
    return paintStudioOilRibbonCarrier(context, input);
  }

  const transform = readTransform(native);
  const radiusPx = Number.isFinite(input.radiusPx) && input.radiusPx > 0
    ? input.radiusPx
    : 8;
  const rect = deviceRectForPoints(
    input.points,
    radiusPx,
    transform,
    canvas.width,
    canvas.height,
  );
  if (!rect) return paintStudioOilRibbonCarrier(context, input);

  const settings = wetSettings(radiusPx, input.stroke, input.mixModel);
  const previous = caches.get(input.incrementalKey);

  try {
    let mixed: Uint8ClampedArray;
    let mixedRect = rect;
    if (
      previous
      && sameTransform(previous.transform, transform)
      && isPointPrefix(previous.points, input.points)
    ) {
      const union = {
        x: Math.min(previous.rect.x, rect.x),
        y: Math.min(previous.rect.y, rect.y),
        width: Math.max(previous.rect.x + previous.rect.width, rect.x + rect.width)
          - Math.min(previous.rect.x, rect.x),
        height: Math.max(previous.rect.y + previous.rect.height, rect.y + rect.height)
          - Math.min(previous.rect.y, rect.y),
      };
      mixedRect = union;
      mixed = new Uint8ClampedArray(union.width * union.height * 4);
      copyRect(
        previous.data,
        previous.rect.width,
        mixed,
        union.width,
        previous.rect.width,
        previous.rect.height,
        0,
        0,
        previous.rect.x - union.x,
        previous.rect.y - union.y,
      );
      for (const strip of newDestinationStrips(previous.rect, union)) {
        const grown = native.getImageData(strip.x, strip.y, strip.width, strip.height);
        copyRect(
          grown.data,
          strip.width,
          mixed,
          union.width,
          strip.width,
          strip.height,
          0,
          0,
          strip.x - union.x,
          strip.y - union.y,
        );
      }
      const suffix = input.points.slice(previous.points.length);
      if (suffix.length > 0) {
        applyStudioOilWetIntoWetStroke(
          mixed,
          union.width,
          union.height,
          suffix.map((point) => {
            const mapped = mapPoint(transform, point.x, point.y);
            return { x: mapped.x - union.x, y: mapped.y - union.y };
          }),
          settings,
        );
      }
    } else {
      const image = native.getImageData(rect.x, rect.y, rect.width, rect.height);
      mixed = image.data;
      applyStudioOilWetIntoWetStroke(
        mixed,
        rect.width,
        rect.height,
        input.points.map((point) => {
          const mapped = mapPoint(transform, point.x, point.y);
          return { x: mapped.x - rect.x, y: mapped.y - rect.y };
        }),
        settings,
      );
    }

    const image = typeof ImageData === "function"
      ? new ImageData(mixed as unknown as ImageDataArray, mixedRect.width, mixedRect.height)
      : { data: mixed, width: mixedRect.width, height: mixedRect.height };
    native.putImageData(image, mixedRect.x, mixedRect.y);
    remember({
      key: input.incrementalKey,
      transform,
      rect: mixedRect,
      data: mixed,
      points: input.points.map((point) => ({ x: point.x, y: point.y })),
    });
    paintStudioOilRibbonCarrierOverlay(context, input, true);
    return { wetIntoWetApplied: true, usedLiveDestination: true, hitPass: false };
  } catch {
    caches.delete(input.incrementalKey);
    return paintStudioOilRibbonCarrier(context, input);
  }
}
