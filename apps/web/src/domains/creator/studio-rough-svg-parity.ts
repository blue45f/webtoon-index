/**
 * Rough shape SVG parity bridge.
 *
 * `exportPageToSvg()` is deliberately synchronous (it also runs inside the SVG
 * export worker), while the interactive Canvas renderer lazy-loads rough.js.
 * The SVG export module itself is already a lazy document-export chunk, so this
 * bridge may own a synchronous generator without pulling rough.js into the
 * Studio interaction bundle.
 *
 * Both renderers still share the authoritative geometry implementation:
 * `buildStudioRoughShapeRenderPlan()`.  This bridge only supplies the same
 * element-id/variation seed contract that `StudioDrawNode` uses and keeps the
 * resulting seed next to the paths for exact parity assertions.
 */
import { RoughGenerator } from "roughjs/bin/generator";

import {
  buildStudioRoughShapeRenderPlan,
  studioRoughSeedFromElementId,
  type StudioRoughRenderPath,
  type StudioRoughShapeInput,
} from "./studio-rough-shape";

const svgRoughGenerator = new RoughGenerator();

export interface StudioRoughSvgParityInput
  extends Omit<StudioRoughShapeInput, "seed"> {
  readonly elementId: string;
  readonly variationIndex: number;
}

export interface StudioRoughSvgParityPlan {
  readonly seed: number;
  readonly paths: readonly StudioRoughRenderPath[];
}

/**
 * Canvas contract:
 * `studioRoughSeedFromElementId(element.id) + symmetricVariationIndex`.
 *
 * Callers only provide indexes from `Array#entries`, but fail closed to the
 * original variation when this helper is used independently with invalid data.
 */
export function studioRoughCanvasSvgVariationSeed(
  elementId: string,
  variationIndex: number,
): number {
  const safeVariationIndex =
    Number.isSafeInteger(variationIndex) && variationIndex >= 0
      ? variationIndex
      : 0;
  return studioRoughSeedFromElementId(elementId) + safeVariationIndex;
}

/** Build the exact Rough path plan consumed by the retained Canvas renderer. */
export function buildStudioRoughSvgParityPlan(
  input: StudioRoughSvgParityInput,
): StudioRoughSvgParityPlan {
  const seed = studioRoughCanvasSvgVariationSeed(
    input.elementId,
    input.variationIndex,
  );
  return {
    seed,
    paths: buildStudioRoughShapeRenderPlan(svgRoughGenerator, {
      kind: input.kind,
      points: input.points,
      strokeWidth: input.strokeWidth,
      hasFill: input.hasFill,
      shapeParams: input.shapeParams,
      style: input.style,
      seed,
    }),
  };
}
