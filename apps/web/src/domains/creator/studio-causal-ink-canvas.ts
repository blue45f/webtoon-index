import {
  isStudioStrokePaintModel,
  type StudioStrokePaintModel,
} from "./brush/studio-stroke-paint-model";

import type { StudioCausalInkDab } from "./studio-causal-ink";
import type { StudioCausalInkNib } from "./studio-marker-nib-profile";

/** Small structural surface shared by Konva.Context and native CanvasRenderingContext2D. */
export interface StudioCausalInkFillContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  /**
   * Chisel-nib footprint. Both Konva's Context and CanvasRenderingContext2D implement it; it is
   * optional here only so structural test doubles built for the round engine keep type-checking.
   * A nib is never requested for a brush without one, and a context that cannot stamp a wedge
   * falls back to the round dab it would have drawn anyway.
   */
  ellipse?(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
}

/**
 * Paints an already planned causal round-dab sequence without changing its geometry.
 *
 * Legacy strokes intentionally issue one fill per dab, preserving historical source-over alpha.
 * `layered-flow-v1` (currently authored with flow=1) builds one compound circle union and fills it
 * once. A caller-supplied node/stroke opacity is therefore applied once to the completed stroke,
 * and appending a suffix cannot darken pixels that were already covered by the same stroke.
 */
export function fillStudioCausalInkDabs(
  context: StudioCausalInkFillContext,
  dabs: readonly StudioCausalInkDab[],
  color: string,
  paintModel?: StudioStrokePaintModel,
  nib?: StudioCausalInkNib,
): void {
  if (dabs.length === 0) return;
  context.fillStyle = color;
  const stampNib = nib && typeof context.ellipse === "function" ? nib : null;
  const traceFootprint = (dab: StudioCausalInkDab): void => {
    if (!stampNib) {
      context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
      return;
    }
    // Same planned centre and same major radius: a chisel changes the footprint the engine stamps,
    // never where or how big the engine decided to stamp it.
    context.ellipse!(
      dab.x,
      dab.y,
      dab.radius,
      dab.radius * stampNib.aspect,
      stampNib.angleRad,
      0,
      Math.PI * 2,
    );
  };

  if (isStudioStrokePaintModel(paintModel)) {
    context.beginPath();
    for (const dab of dabs) {
      // moveTo begins a separate subpath, avoiding accidental straight connectors between arcs.
      context.moveTo(dab.x + dab.radius, dab.y);
      traceFootprint(dab);
    }
    context.fill();
    return;
  }

  for (const dab of dabs) {
    context.beginPath();
    traceFootprint(dab);
    context.fill();
  }
}
