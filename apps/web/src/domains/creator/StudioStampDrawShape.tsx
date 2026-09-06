import { Shape } from "react-konva/lib/ReactKonvaCore";

import { resolveStudioStampBrushStyle } from "./brush/studio-brush-stamp-engine";
import { drawStudioStampStrokeWithSymmetry } from "./brush/studio-stamp-symmetry-rendering";
import {
  resampleStrokePressures,
  resolveStudioFreehandRenderPath,
} from "./studio-brush";

import type { StudioStampBrushKind } from "./brush/studio-brush-stamp-engine";
import type { DrawEl } from "./studio-element-model";

interface StudioStampDrawShapeProps {
  readonly composite: GlobalCompositeOperation;
  readonly el: DrawEl;
  readonly opacity: number;
  readonly renderSampleDistance: number;
  readonly stampKind: StudioStampBrushKind;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/**
 * Optional high-fidelity stamp renderer. It is split from the initial Studio graph because only
 * four specialized brush presets use this planner, while ordinary pen/vector editing stays eager.
 */
export function StudioStampDrawShape({
  composite,
  el,
  opacity,
  renderSampleDistance,
  stampKind,
  stroke,
  strokeWidth,
}: StudioStampDrawShapeProps) {
  const stampStyle = resolveStudioStampBrushStyle(
    stampKind,
    { color: stroke, size: Math.max(1, strokeWidth), opacity },
    el.stamp,
    el.brush,
  );
  // v2 stores the already accepted/stabilized point stream as its rendering contract.
  // Re-smoothing a growing prefix would move or delete dabs that were already visible.
  const causalStamp = el.stampPipeline === "causal-walker-v2";
  const stampPoints = causalStamp
    ? el.points
    : resolveStudioFreehandRenderPath(el.points, {
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
        legacyTension: 0,
      }).points;
  // A finite sampleSpacing marks an already accepted new-stroke stream even when an imported
  // document predates the explicit stampPipeline tag. Keep its point/pressure indices paired.
  const sourceAligned = causalStamp || stampPoints === el.points;
  const stampPressures = sourceAligned
    ? el.pressures
    : resampleStrokePressures(
        el.pressures ?? [],
        Math.floor(stampPoints.length / 2),
        0.5
      );

  return (
    <Shape
      sceneFunc={(context) => {
        context.save();
        drawStudioStampStrokeWithSymmetry(
          context as unknown as CanvasRenderingContext2D,
          stampStyle,
          stampPoints,
          stampPressures,
          el.symmetry
        );
        context.restore();
      }}
      globalCompositeOperation={composite}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
