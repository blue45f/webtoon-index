import {
  STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS,
  studioBrushSymmetryTransforms,
  type StudioBrushSymmetrySpec,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";

import { isStudioGpuColorSupported } from "./studio-webgpu-color";
import {
  buildStudioGpuLiveStroke,
  isStudioGpuFiniteScalar,
  STUDIO_GPU_MAX_BRUSH_SIZE,
  type StudioGpuComposite,
  type StudioGpuLiveStrokeInput,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";

import type { StudioStrokePaintModel } from "../brush/studio-stroke-paint-model";

/** Bounded imported symmetry fan; malformed presets cannot exhaust the live GPU dab budget. */
export const STUDIO_GPU_MAX_LIVE_SYMMETRY_DIRECTIONS =
  STUDIO_BRUSH_MAX_RADIAL_SYMMETRY_DIRECTIONS;

export interface StudioGpuLiveStrokePlanInput extends StudioGpuLiveStrokeInput {
  readonly orderKey?: string;
  readonly symmetry?: StudioBrushSymmetrySpec;
  readonly correctedPoints?: readonly number[];
  readonly correctedPressures?: readonly number[];
  readonly destination?: "transparent-overlay" | "retained-layer";
  /**
   * Stroke-local paint models require a coverage surface before element opacity is composited.
   * The current round-dab GPU pipeline applies opacity per dab, so it must fail closed until it
   * can reproduce that persisted compositing contract exactly.
   */
  readonly paintModel?: StudioStrokePaintModel;
}

export interface StudioGpuLiveStrokePreparation {
  readonly composite: StudioGpuComposite;
  readonly opacity: number;
  readonly symmetry: "identity" | "expanded";
  readonly geometry: "source" | "post-corrected";
  readonly destination: "transparent-overlay" | "retained-layer";
}

export interface StudioGpuLiveStrokePlan {
  readonly strokes: readonly StudioGpuStroke[];
  readonly preparation: StudioGpuLiveStrokePreparation;
  readonly sourcePointCount: number;
  readonly renderedPointCount: number;
  readonly variationCount: number;
}

export type StudioGpuLiveStrokePlanner = (
  input: StudioGpuLiveStrokePlanInput
) => StudioGpuLiveStrokePlan | null;

function validStyle(input: StudioGpuLiveStrokeInput): boolean {
  return !!input.id
    && isStudioGpuColorSupported(input.color)
    && isStudioGpuFiniteScalar(input.size)
    && input.size > 0
    && input.size <= STUDIO_GPU_MAX_BRUSH_SIZE
    && (input.opacity === undefined
      || (isStudioGpuFiniteScalar(input.opacity) && input.opacity >= 0 && input.opacity <= 1))
    && (input.composite === undefined || input.composite === "normal" || input.composite === "erase");
}

function normalizeSymmetry(input?: StudioBrushSymmetrySpec): StudioBrushSymmetrySpec | null {
  if (!input || input.type === "none") return { type: "none", centerX: 0, centerY: 0 };
  if (
    !["vertical", "horizontal", "radial", "kaleidoscope"].includes(input.type)
    || !isStudioGpuFiniteScalar(input.centerX)
    || !isStudioGpuFiniteScalar(input.centerY)
  ) return null;
  if (input.type === "vertical" || input.type === "horizontal") return input;
  const radialCount = Math.round(input.radialCount ?? 4);
  if (!Number.isFinite(radialCount) || radialCount < 1 || radialCount > STUDIO_GPU_MAX_LIVE_SYMMETRY_DIRECTIONS) {
    return null;
  }
  return { ...input, radialCount };
}

function transformPoints(
  points: readonly number[],
  transform: StudioBrushSymmetryTransform
): readonly number[] | null {
  if (
    transform.a === 1 && transform.b === 0 && transform.c === 0
    && transform.d === 1 && transform.e === 0 && transform.f === 0
  ) return points;
  const transformed = new Array<number>(points.length);
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    const transformedX = transform.a * x + transform.c * y + transform.e;
    const transformedY = transform.b * x + transform.d * y + transform.f;
    if (!isStudioGpuFiniteScalar(transformedX) || !isStudioGpuFiniteScalar(transformedY)) {
      return null;
    }
    transformed[index] = transformedX;
    transformed[index + 1] = transformedY;
  }
  return Object.freeze(transformed);
}

/** Builds the exact ordered live operation group after the WebGPU capability boundary is warm. */
export const planStudioGpuLiveStroke: StudioGpuLiveStrokePlanner = (input) => {
  if (
    input.paintModel !== undefined
    || !validStyle(input)
    || (input.correctedPressures !== undefined && input.correctedPoints === undefined)
  ) {
    return null;
  }
  const renderedPoints = input.correctedPoints ?? input.points;
  if (
    renderedPoints.length < 2
    || renderedPoints.length % 2 !== 0
    || !renderedPoints.every(isStudioGpuFiniteScalar)
    || (input.correctedPressures !== undefined
      && (input.correctedPressures.length !== renderedPoints.length / 2
        || !input.correctedPressures.every(isStudioGpuFiniteScalar)))
    || (input.correctedPoints !== undefined && input.correctedPressures === undefined
      && input.pressures !== undefined && input.pressures.length !== renderedPoints.length / 2)
  ) return null;
  const symmetry = normalizeSymmetry(input.symmetry);
  if (!symmetry) return null;
  const corrected = input.correctedPoints !== undefined;
  const base = buildStudioGpuLiveStroke({
    ...input,
    points: renderedPoints,
    pressures: corrected ? input.correctedPressures ?? input.pressures : input.pressures,
    opacity: input.opacity ?? 1,
    composite: input.composite ?? "normal",
  });
  if (!base) return null;
  const strokes: StudioGpuStroke[] = [];
  const transforms = studioBrushSymmetryTransforms(symmetry);
  for (let index = 0; index < transforms.length; index += 1) {
    const transformedPoints = transformPoints(base.points, transforms[index]!);
    if (!transformedPoints) return null;
    strokes.push({
      ...base,
      id: index === 0 ? base.id : `${base.id}:gpu-symmetry:${index}`,
      points: transformedPoints,
      pressures: base.pressures,
      orderKey: input.orderKey,
    });
  }
  return Object.freeze({
    strokes: Object.freeze(strokes),
    preparation: Object.freeze({
      composite: base.composite ?? "normal",
      opacity: base.opacity ?? 1,
      symmetry: symmetry.type === "none" ? "identity" : "expanded",
      geometry: corrected ? "post-corrected" : "source",
      destination: input.destination === "retained-layer" ? "retained-layer" : "transparent-overlay",
    }),
    sourcePointCount: Math.floor(input.points.length / 2),
    renderedPointCount: base.points.length / 2,
    variationCount: strokes.length,
  });
};
