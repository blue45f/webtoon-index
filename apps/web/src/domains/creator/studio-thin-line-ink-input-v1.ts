/**
 * Prefix-stable tremor filter for thin causal-ink aliases.
 *
 * Fineliner / technical pens take the immediate quantized input path when the
 * UI stabilizer is 0, so every coalesced pointer wiggle becomes a dab centre.
 * Broad brushes hide that; a 2–5px monoline does not. This filter is applied
 * only to those aliases and only before a sample is accepted.
 */

import {
  createStudioStrokeOneEuroV1State,
  filterStudioStrokeOneEuroV1,
  flushStudioStrokeOneEuroV1Endpoint,
  type StudioStrokeOneEuroV1Options,
  type StudioStrokeOneEuroV1State,
} from "./brush/studio-stroke-one-euro-v1";

export const STUDIO_THIN_LINE_INK_INPUT_V1 = "studio-thin-line-ink-input-v1" as const;

export const STUDIO_THIN_LINE_INK_BRUSH_IDS = Object.freeze([
  "fineliner",
  "technical-pen",
  "liner",
  "gel-pen",
  "ballpoint",
  "mapping-pen",
  "glass-pen",
  "dip-pen",
  "g-pen",
] as const);

const THIN_LINE_INK_BRUSH_ID_SET = new Set<string>(STUDIO_THIN_LINE_INK_BRUSH_IDS);

export const STUDIO_THIN_LINE_INK_ONE_EURO_OPTIONS = Object.freeze({
  minCutoffHz: 0.95,
  beta: 0.02,
  derivativeCutoffHz: 1,
}) satisfies Omit<StudioStrokeOneEuroV1Options, "coordinateScale">;

export function isStudioThinLineInkBrush(brushId: unknown): boolean {
  return typeof brushId === "string" && THIN_LINE_INK_BRUSH_ID_SET.has(brushId);
}

export function shouldFilterStudioThinLineInkInput(input: {
  readonly brushId: unknown;
  readonly immediateCausalInput: boolean;
}): boolean {
  return input.immediateCausalInput && isStudioThinLineInkBrush(input.brushId);
}

export function createStudioThinLineInkInputState(
  sample: { readonly x: number; readonly y: number; readonly timeStamp?: number },
): StudioStrokeOneEuroV1State {
  return createStudioStrokeOneEuroV1State(sample);
}

export function filterStudioThinLineInkInput(
  state: StudioStrokeOneEuroV1State,
  sample: { readonly x: number; readonly y: number; readonly timeStamp?: number },
  coordinateScale = 1,
): { readonly x: number; readonly y: number; readonly state: StudioStrokeOneEuroV1State } {
  const result = filterStudioStrokeOneEuroV1(state, sample, {
    ...STUDIO_THIN_LINE_INK_ONE_EURO_OPTIONS,
    coordinateScale,
  });
  return {
    x: result.point[0],
    y: result.point[1],
    state: result.state,
  };
}

export function flushStudioThinLineInkInput(
  state: StudioStrokeOneEuroV1State,
): { readonly x: number; readonly y: number; readonly state: StudioStrokeOneEuroV1State } {
  const result = flushStudioStrokeOneEuroV1Endpoint(state);
  return {
    x: result.point[0],
    y: result.point[1],
    state: result.state,
  };
}
