import {
  resolveStudioInkPressure,
  studioInkPressureRadius,
} from "../brush/studio-ink-pressure-model";
import { resolveStudioLiveSurfaceDevicePixelRatio } from "../studio-low-latency-canvas";

import { parseStudioGpuColor, type StudioGpuRgba } from "./studio-webgpu-color";
import { isValidStudioGpuStroke } from "./studio-webgpu-dab-planner";
import {
  isStudioGpuFiniteScalar,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";

/** Hard ceiling for a transient WebGL drawing buffer; document/export pixels are unaffected. */
export const STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS = 16_777_216;
export const STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_DIMENSION = 8_192;
export const STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_BUFFER_BYTES = 1_048_576;
export const STUDIO_WEBGL_LIVE_INK_HARD_MAX_BUFFER_BYTES = 8_388_608;
export const STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS = 2;
export const STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES =
  STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface StudioWebGlLiveInkSurfaceInput {
  /** CSS placement of the viewport inside the scaled document, matching StudioLiveInkSurface. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly documentScale: number;
  readonly documentWidth: number;
  readonly flipX: boolean;
  /** Explicit input keeps tests and worker-hosted callers independent from global devicePixelRatio. */
  readonly devicePixelRatio: number;
  readonly maximumBackingPixels?: number;
}

export interface ResolvedStudioWebGlLiveInkSurface {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly documentScale: number;
  readonly documentWidth: number;
  readonly flipX: boolean;
  readonly dpr: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly backingPixels: number;
  readonly maximumBackingPixels: number;
}

export type StudioWebGlLiveInkSurfaceFailureReason =
  | "invalid-surface"
  | "surface-budget-exceeded"
  | "surface-dimension-exceeded";

export type StudioWebGlLiveInkSurfacePlan =
  | {
      readonly ok: true;
      readonly surface: ResolvedStudioWebGlLiveInkSurface;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWebGlLiveInkSurfaceFailureReason;
    };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolves the transient backing size before touching a canvas. A caller-provided budget may make
 * the surface smaller, but can never raise the renderer's 16M-pixel hard ceiling.
 */
export function resolveStudioWebGlLiveInkSurface(
  input: StudioWebGlLiveInkSurfaceInput,
  maximumDimension = STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_DIMENSION
): StudioWebGlLiveInkSurfacePlan {
  if (
    !Number.isFinite(input.left)
    || !Number.isFinite(input.top)
    || !finitePositive(input.width)
    || !finitePositive(input.height)
    || !finitePositive(input.documentScale)
    || !finitePositive(input.documentWidth)
    || !finitePositive(input.devicePixelRatio)
    || !finitePositive(maximumDimension)
    || (
      input.maximumBackingPixels !== undefined
      && !finitePositive(input.maximumBackingPixels)
    )
  ) {
    return { ok: false, reason: "invalid-surface" };
  }

  const maximumBackingPixels = Math.min(
    STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS,
    input.maximumBackingPixels ?? STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS
  );
  if (
    !Number.isSafeInteger(Math.floor(maximumBackingPixels))
    || input.width * input.height > maximumBackingPixels
  ) {
    return { ok: false, reason: "surface-budget-exceeded" };
  }

  let dpr = resolveStudioLiveSurfaceDevicePixelRatio({
    cssWidth: input.width,
    cssHeight: input.height,
    devicePixelRatio: input.devicePixelRatio,
    maximumBackingPixels,
  });
  let backingWidth = Math.max(1, Math.round(input.width * dpr));
  let backingHeight = Math.max(1, Math.round(input.height * dpr));
  // Rounding can cross a tight caller budget by a handful of pixels. Keep the same quarter-DPR
  // quantization as the shared live-surface resolver rather than silently exceeding the budget.
  while (dpr > 1 && backingWidth * backingHeight > maximumBackingPixels) {
    dpr = Math.max(1, dpr - 0.25);
    backingWidth = Math.max(1, Math.round(input.width * dpr));
    backingHeight = Math.max(1, Math.round(input.height * dpr));
  }

  const backingPixels = backingWidth * backingHeight;
  if (!Number.isSafeInteger(backingPixels) || backingPixels > maximumBackingPixels) {
    return { ok: false, reason: "surface-budget-exceeded" };
  }
  const dimensionLimit = Math.max(1, Math.floor(maximumDimension));
  if (backingWidth > dimensionLimit || backingHeight > dimensionLimit) {
    return { ok: false, reason: "surface-dimension-exceeded" };
  }

  return {
    ok: true,
    surface: {
      left: input.left,
      top: input.top,
      width: input.width,
      height: input.height,
      documentScale: input.documentScale,
      documentWidth: input.documentWidth,
      flipX: input.flipX,
      dpr,
      backingWidth,
      backingHeight,
      backingPixels,
      maximumBackingPixels,
    },
  };
}

export interface StudioWebGlLiveInkGeometry {
  /** Interleaved clip-space x/y pairs, ready for one TRIANGLE_STRIP draw. */
  readonly vertices: Float32Array;
  readonly vertexCount: number;
  readonly color: StudioGpuRgba;
}

export type StudioWebGlLiveInkGeometryFailureReason =
  | "invalid-stroke"
  | "unsupported-composite"
  | "vertex-budget-exceeded"
  | "numeric-overflow";

export type StudioWebGlLiveInkGeometryPlan =
  | {
      readonly ok: true;
      readonly geometry: StudioWebGlLiveInkGeometry;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWebGlLiveInkGeometryFailureReason;
    };

interface ProjectedInkPoint {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

function normalizeVector(x: number, y: number): readonly [number, number] | null {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 1e-6) return null;
  return [x / length, y / length];
}

function clipCoordinate(
  x: number,
  y: number,
  surface: ResolvedStudioWebGlLiveInkSurface
): readonly [number, number] | null {
  const clipX = (x / surface.backingWidth) * 2 - 1;
  const clipY = 1 - (y / surface.backingHeight) * 2;
  const x32 = Math.fround(clipX);
  const y32 = Math.fround(clipY);
  return Number.isFinite(x32) && Number.isFinite(y32) ? [x32, y32] : null;
}

function emptyGeometry(color: StudioGpuRgba): StudioWebGlLiveInkGeometryPlan {
  return {
    ok: true,
    geometry: {
      vertices: new Float32Array(0),
      vertexCount: 0,
      color,
    },
  };
}

/**
 * Builds a bounded variable-width strip for transient display only. It deliberately does not
 * replace the canonical round-dab planner used by document persistence and export.
 */
export function planStudioWebGlLiveInkGeometry(
  stroke: StudioGpuStroke,
  surface: ResolvedStudioWebGlLiveInkSurface,
  maximumVertices: number
): StudioWebGlLiveInkGeometryPlan {
  if (
    Array.isArray(stroke.points)
    && stroke.points.length >= 2
    && stroke.points.length % 2 === 0
    && stroke.points.every(Number.isFinite)
    && !stroke.points.every(isStudioGpuFiniteScalar)
  ) {
    return { ok: false, reason: "numeric-overflow" };
  }
  if (!isValidStudioGpuStroke(stroke)) {
    return { ok: false, reason: "invalid-stroke" };
  }
  if (stroke.composite === "erase") {
    // destination-out cannot erase a committed canvas through a separate transparent overlay.
    return { ok: false, reason: "unsupported-composite" };
  }
  if (!Number.isSafeInteger(maximumVertices) || maximumVertices < 4) {
    return { ok: false, reason: "vertex-budget-exceeded" };
  }

  const sourcePointCount = stroke.points.length / 2;
  // Bound input traversal as well as GPU allocation. A duplicate-heavy adversarial array cannot
  // consume unbounded CPU merely because it would later collapse to a short strip.
  if (sourcePointCount > Math.floor(maximumVertices / 2)) {
    return { ok: false, reason: "vertex-budget-exceeded" };
  }

  const parsedColor = parseStudioGpuColor(stroke.color);
  if (!parsedColor) return { ok: false, reason: "invalid-stroke" };
  const opacity = stroke.opacity ?? 1;
  const color = [
    parsedColor[0],
    parsedColor[1],
    parsedColor[2],
    parsedColor[3] * opacity,
  ] as const;
  if (color[3] <= 0) return emptyGeometry(color);

  const projected: ProjectedInkPoint[] = [];
  const scale = surface.documentScale * surface.dpr;
  for (let index = 0; index < sourcePointCount; index += 1) {
    const sourceX = stroke.points[index * 2]!;
    const sourceY = stroke.points[index * 2 + 1]!;
    const xCss = surface.flipX
      ? (surface.documentWidth - sourceX) * surface.documentScale - surface.left
      : sourceX * surface.documentScale - surface.left;
    const yCss = sourceY * surface.documentScale - surface.top;
    const x = xCss * surface.dpr;
    const y = yCss * surface.dpr;
    const radius = studioInkPressureRadius(
      stroke.size,
      resolveStudioInkPressure(stroke.pressures?.[index], stroke.pressureModel),
      stroke.pressureModel
    ) * scale;
    if (![x, y, radius].every(Number.isFinite)) {
      return { ok: false, reason: "numeric-overflow" };
    }
    const previous = projected.at(-1);
    if (previous && previous.x === x && previous.y === y) {
      projected[projected.length - 1] = { x, y, radius };
    } else {
      projected.push({ x, y, radius });
    }
  }

  if (projected.length === 0 || projected.every((point) => point.radius <= 0)) {
    return emptyGeometry(color);
  }
  const vertexCount = projected.length === 1 ? 4 : projected.length * 2;
  if (vertexCount > maximumVertices) {
    return { ok: false, reason: "vertex-budget-exceeded" };
  }
  const vertices = new Float32Array(vertexCount * STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS);
  let cursor = 0;
  const pushVertex = (x: number, y: number): boolean => {
    const clip = clipCoordinate(x, y, surface);
    if (!clip) return false;
    vertices[cursor] = clip[0];
    vertices[cursor + 1] = clip[1];
    cursor += STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS;
    return true;
  };

  if (projected.length === 1) {
    const point = projected[0]!;
    const radius = point.radius;
    if (
      !pushVertex(point.x - radius, point.y - radius)
      || !pushVertex(point.x + radius, point.y - radius)
      || !pushVertex(point.x - radius, point.y + radius)
      || !pushVertex(point.x + radius, point.y + radius)
    ) {
      return { ok: false, reason: "numeric-overflow" };
    }
  } else {
    for (let index = 0; index < projected.length; index += 1) {
      const current = projected[index]!;
      const previous = projected[Math.max(0, index - 1)]!;
      const next = projected[Math.min(projected.length - 1, index + 1)]!;
      const incoming = normalizeVector(current.x - previous.x, current.y - previous.y);
      const outgoing = normalizeVector(next.x - current.x, next.y - current.y);
      const fallbackTangent = outgoing ?? incoming;
      if (!fallbackTangent) return { ok: false, reason: "numeric-overflow" };

      let normalX = -fallbackTangent[1];
      let normalY = fallbackTangent[0];
      let offsetLength = current.radius;
      if (incoming && outgoing && index > 0 && index < projected.length - 1) {
        const incomingNormalX = -incoming[1];
        const incomingNormalY = incoming[0];
        const outgoingNormalX = -outgoing[1];
        const outgoingNormalY = outgoing[0];
        const miter = normalizeVector(
          incomingNormalX + outgoingNormalX,
          incomingNormalY + outgoingNormalY
        );
        if (miter) {
          const denominator = miter[0] * outgoingNormalX + miter[1] * outgoingNormalY;
          if (Number.isFinite(denominator) && denominator > 0.1) {
            normalX = miter[0];
            normalY = miter[1];
            // A two-radius miter limit prevents near-reversals from creating giant preview spikes.
            offsetLength = Math.min(current.radius / denominator, current.radius * 2);
          }
        }
      }

      let centerX = current.x;
      let centerY = current.y;
      if (index === 0) {
        centerX -= fallbackTangent[0] * current.radius;
        centerY -= fallbackTangent[1] * current.radius;
      } else if (index === projected.length - 1) {
        centerX += fallbackTangent[0] * current.radius;
        centerY += fallbackTangent[1] * current.radius;
      }
      if (
        !pushVertex(centerX + normalX * offsetLength, centerY + normalY * offsetLength)
        || !pushVertex(centerX - normalX * offsetLength, centerY - normalY * offsetLength)
      ) {
        return { ok: false, reason: "numeric-overflow" };
      }
    }
  }

  return {
    ok: true,
    geometry: { vertices, vertexCount, color },
  };
}
