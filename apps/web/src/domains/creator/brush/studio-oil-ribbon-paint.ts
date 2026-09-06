import { parseStudioGpuColor } from "../render/studio-webgpu-color";

import { STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR } from "./studio-oil-ribbon-impasto-relief";
import { applyStudioOilWetIntoWetStroke } from "./studio-oil-wet-into-wet";

import type {
  StudioOilRibbonCarrierPlan,
  StudioOilRibbonNativeReadback,
  StudioOilRibbonNativeSurface,
  StudioOilRibbonPaintContext,
  StudioOilRibbonPaintInput,
  StudioOilRibbonPaintReceipt,
  StudioOilRibbonPath,
  StudioOilRibbonPathSink,
} from "./studio-oil-ribbon-carrier-types";

export type {
  StudioOilRibbonCarrierPlan,
  StudioOilRibbonNativeReadback,
  StudioOilRibbonNativeSurface,
  StudioOilRibbonPaintContext,
  StudioOilRibbonPaintInput,
  StudioOilRibbonPaintReceipt,
  StudioOilRibbonPath,
  StudioOilRibbonPathSink,
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function strokePaintColor(stroke: string): { r: number; g: number; b: number } {
  const parsed = parseStudioGpuColor(stroke);
  if (!parsed) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(parsed[0] * 255),
    g: Math.round(parsed[1] * 255),
    b: Math.round(parsed[2] * 255),
  };
}

function oilWetIntoWetSettings(
  radiusPx: number,
  paintColor: { r: number; g: number; b: number },
  mixModel?: "spectral-wgm" | "ryb"
) {
  return {
    radiusPx: Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 8,
    hardness: 0.55,
    strength: 0.88,
    wetness: 0.65,
    pickup: 0.55,
    paintColor,
    loadDepletion: 0,
    mixModel: mixModel ?? "spectral-wgm",
  };
}

export function traceStudioOilRibbonPath(
  sink: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath?(): void },
  path: StudioOilRibbonPath,
  closed = false
): void {
  const points = path.points;
  if (points.length < 4) return;
  sink.moveTo(points[0]!, points[1]!);
  for (let index = 2; index < points.length; index += 2) {
    sink.lineTo(points[index]!, points[index + 1]!);
  }
  if (closed) sink.closePath?.();
}

/**
 * Konva `drawHit` reuses `sceneFunc` when `hitFunc` is missing. HitContext
 * still has `_context` (the hit canvas). Mixing RGB into that canvas punches
 * the color-key map — skip live readback and keep a path-only fill.
 */
export function studioOilRibbonPaintIsHitPass(
  context: StudioOilRibbonPaintContext,
  hitPass = false
): boolean {
  if (hitPass) return true;
  const contextName = context.constructor?.name;
  if (contextName === "HitContext") return true;
  const canvas = context.canvas;
  if (canvas?.hitCanvas === true) return true;
  if (canvas?.constructor?.name === "HitCanvas") return true;
  return false;
}

/**
 * Production oil paint: wet-into-wet mix on the destination, then the ribbon's
 * bristle / impasto overlay. StudioDrawNode and tests share this entry.
 */
export function paintStudioOilRibbonCarrier(
  context: StudioOilRibbonPaintContext,
  input: StudioOilRibbonPaintInput
): StudioOilRibbonPaintReceipt {
  const paintColor = strokePaintColor(input.stroke);
  const radiusPx =
    Number.isFinite(input.radiusPx) && input.radiusPx > 0
      ? input.radiusPx
      : 8;
  const settings = oilWetIntoWetSettings(radiusPx, paintColor, input.mixModel);
  const hitPass = studioOilRibbonPaintIsHitPass(context, input.hitPass === true);
  let usedLiveDestination = false;

  if (hitPass) {
    // Path-only: never read or write the hit canvas. Body fill below stamps
    // the ribbon silhouette so selection/hit tests keep a closed shape.
  } else if (input.skipDestinationReadback === true) {
    // Live/committed scene paints stay on the ribbon paths. Pixel wet-into-wet
    // is reserved for an explicit destination buffer.
  } else if (input.destination) {
    const originX = input.destination.originX ?? 0;
    const originY = input.destination.originY ?? 0;
    applyStudioOilWetIntoWetStroke(
      input.destination.data,
      input.destination.width,
      input.destination.height,
      input.points.map((point) => ({
        x: point.x - originX,
        y: point.y - originY,
      })),
      settings
    );
    usedLiveDestination = true;
  } else {
    const native = context._context;
    const canvas = native?.canvas;
    if (
      native &&
      canvas &&
      typeof native.getImageData === "function" &&
      typeof native.putImageData === "function" &&
      input.points.length > 0 &&
      canvas.width > 0 &&
      canvas.height > 0
    ) {
      try {
        const pad = Math.ceil(radiusPx + 2);
        let minX = input.points[0]!.x;
        let minY = input.points[0]!.y;
        let maxX = minX;
        let maxY = minY;
        for (const point of input.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        const transform = native.getTransform?.() ?? {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: 0,
          f: 0,
        };
        const map = (x: number, y: number) => ({
          x: transform.a * x + transform.c * y + transform.e,
          y: transform.b * x + transform.d * y + transform.f,
        });
        const corners = [
          map(minX - pad, minY - pad),
          map(maxX + pad, minY - pad),
          map(minX - pad, maxY + pad),
          map(maxX + pad, maxY + pad),
        ];
        const devMinX = Math.max(
          0,
          Math.floor(Math.min(...corners.map((c) => c.x)))
        );
        const devMinY = Math.max(
          0,
          Math.floor(Math.min(...corners.map((c) => c.y)))
        );
        const devMaxX = Math.min(
          canvas.width,
          Math.ceil(Math.max(...corners.map((c) => c.x)))
        );
        const devMaxY = Math.min(
          canvas.height,
          Math.ceil(Math.max(...corners.map((c) => c.y)))
        );
        const width = devMaxX - devMinX;
        const height = devMaxY - devMinY;
        if (width > 0 && height > 0) {
          const image = native.getImageData(devMinX, devMinY, width, height);
          applyStudioOilWetIntoWetStroke(
            image.data,
            width,
            height,
            input.points.map((point) => {
              const mapped = map(point.x, point.y);
              return { x: mapped.x - devMinX, y: mapped.y - devMinY };
            }),
            settings
          );
          native.putImageData(image, devMinX, devMinY);
          usedLiveDestination = true;
        }
      } catch {
        usedLiveDestination = false;
      }
    }
  }

  if (
    !usedLiveDestination &&
    !hitPass &&
    input.skipDestinationReadback !== true
  ) {
    const scratch = new Uint8ClampedArray(16 * 16 * 4);
    applyStudioOilWetIntoWetStroke(
      scratch,
      16,
      16,
      [{ x: 8, y: 8 }],
      { ...settings, radiusPx: Math.min(settings.radiusPx, 6) }
    );
  }

  return paintStudioOilRibbonCarrierOverlay(
    context,
    input,
    usedLiveDestination,
    hitPass
  );
}

/**
 * Body fill + bristle/impasto overlay after wet-into-wet. Shared by the one-shot painter and the
 * live incremental suffix so both surfaces keep identical ridges.
 */
export function paintStudioOilRibbonCarrierOverlay(
  context: StudioOilRibbonPaintContext,
  input: Pick<StudioOilRibbonPaintInput, "carrier" | "stroke" | "opacity"> & {
    readonly includeBristleOverlay?: boolean;
  },
  usedLiveDestination: boolean,
  hitPass = false
): StudioOilRibbonPaintReceipt {
  if (!input.carrier.body) {
    return { wetIntoWetApplied: true, usedLiveDestination, hitPass };
  }

  context.save();
  if (hitPass || !usedLiveDestination) {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = clampUnit(input.carrier.bodyOpacity * input.opacity);
    context.beginPath();
    traceStudioOilRibbonPath(context, input.carrier.body, true);
    context.fillStyle = input.stroke;
    context.fill();
  }

  if (hitPass) {
    context.restore();
    return { wetIntoWetApplied: true, usedLiveDestination: false, hitPass };
  }

  if (input.includeBristleOverlay === false) {
    context.restore();
    return { wetIntoWetApplied: true, usedLiveDestination, hitPass };
  }

  context.globalCompositeOperation = "multiply";
  context.strokeStyle = input.stroke;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const lane of input.carrier.bristleLanes) {
    context.globalAlpha = clampUnit(lane.opacity * input.opacity);
    context.lineWidth = Math.max(0.12, lane.lineWidth);
    context.beginPath();
    for (const run of lane.runs) {
      traceStudioOilRibbonPath(context, run);
    }
    context.stroke();
  }
  if (input.carrier.impastoReliefLanes) {
    context.lineCap = "round";
    for (const lane of input.carrier.impastoReliefLanes) {
      const highlight = lane.kind === "highlight";
      context.globalCompositeOperation = highlight ? "screen" : "multiply";
      context.strokeStyle = highlight
        ? STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR
        : input.stroke;
      context.globalAlpha = clampUnit(lane.opacity * input.opacity);
      context.lineWidth = Math.max(0.12, lane.lineWidth);
      context.beginPath();
      for (const run of lane.runs) {
        traceStudioOilRibbonPath(context, run);
      }
      context.stroke();
    }
  }
  context.restore();
  return { wetIntoWetApplied: true, usedLiveDestination, hitPass };
}

/**
 * Path-only hit silhouette. Konva `fillStrokeShape` stamps the node's colorKey
 * so this must not mix RGB or multiply overlays onto the hit canvas.
 */
export function paintStudioOilRibbonHit<TShape = never>(
  context: {
    beginPath(): void;
    fillStrokeShape?(shape: TShape): void;
    fill?(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath?(): void;
  },
  carrier: StudioOilRibbonCarrierPlan,
  shape?: TShape
): void {
  if (!carrier.body) return;
  context.beginPath();
  traceStudioOilRibbonPath(context, carrier.body, true);
  if (typeof context.fillStrokeShape === "function") {
    context.fillStrokeShape(shape as TShape);
    return;
  }
  context.fill?.();
}
