import { isStudioInkPressureModel } from "../brush/studio-ink-pressure-model";
import { isStudioStrokePaintModelCompatible } from "../brush/studio-stroke-paint-model";

import { isStudioGpuColorSupported } from "./studio-webgpu-color";

/**
 * Fail-closed selection for the first committed WebGPU drawing slice.
 *
 * The WebGPU surface currently sits above the authoritative Konva stage. It may therefore take
 * ownership only of a contiguous suffix of the *visible* scene order (array index 0 is back,
 * `length - 1` is front). Hidden elements do not produce pixels and are skipped, while the first
 * visible unsupported element is a hard z-order barrier.
 *
 * This module deliberately knows nothing about StudioPage's large `El` union. Callers must adapt
 * effective group visibility and automatic panel clipping into `hidden` and `panelClip` before
 * asking for a plan. Requiring an explicit panel-clip state prevents a future caller from silently
 * treating an uncomputed clip as safe.
 */

export type StudioWebGpuPanelClipState = "none" | "clipped" | "unknown";

export interface StudioWebGpuCommittedElementInput {
  readonly id: string;
  readonly type: unknown;
  /** Effective visibility, including a hidden parent layer group. */
  readonly hidden?: boolean;
  readonly kind?: unknown;
  readonly mode?: unknown;
  readonly points?: unknown;
  readonly pressures?: unknown;
  readonly stroke?: unknown;
  readonly strokeWidth?: unknown;
  readonly pressureModel?: unknown;
  readonly sampleSpacing?: unknown;
  readonly paintModel?: unknown;
  readonly opacity?: unknown;
  readonly brush?: unknown;
  readonly blendMode?: unknown;
  readonly symmetry?: unknown;
  readonly panelClip: StudioWebGpuPanelClipState;
  readonly clipBelow?: unknown;
  readonly maskSrc?: unknown;
  readonly maskEnabled?: unknown;
  readonly alphaLocked?: unknown;
  readonly fill?: unknown;
  readonly gradient?: unknown;
  readonly pattern?: unknown;
  readonly brushDynamics?: unknown;
  readonly brushTip?: unknown;
  readonly stampPipeline?: unknown;
  readonly watercolorPipeline?: unknown;
}

export interface StudioWebGpuCommittedPlanGates {
  readonly exportActive?: boolean;
  readonly masterEditActive?: boolean;
  readonly editActive?: boolean;
  readonly specialDraftActive?: boolean;
  readonly postProcessingActive?: boolean;
}

export type StudioWebGpuCommittedGateReason =
  | "export"
  | "master-edit"
  | "edit"
  | "special-draft"
  | "post-processing";

export type StudioWebGpuCommittedBarrierReason =
  | "non-draw"
  | "non-freehand"
  | "non-pen-mode"
  | "unsupported-brush"
  | "unsupported-pressure-model"
  | "paint-model"
  | "invalid-geometry"
  | "opacity"
  | "blend-mode"
  | "panel-clip"
  | "mask"
  | "symmetry"
  | "unsupported-style";

export interface StudioWebGpuCommittedBarrier {
  readonly elementId: string;
  readonly reason: StudioWebGpuCommittedBarrierReason;
}

export interface StudioWebGpuCommittedPlan<T extends StudioWebGpuCommittedElementInput> {
  readonly status: "ready" | "empty" | "gated";
  /** Selected elements in their original back-to-front scene order. */
  readonly elements: readonly T[];
  readonly elementIds: readonly string[];
  readonly gateReason: StudioWebGpuCommittedGateReason | null;
  /** Unsupported frontmost visible element that prevented any handoff. */
  readonly frontBarrier: StudioWebGpuCommittedBarrier | null;
  /** First unsupported visible element immediately behind a successfully selected suffix. */
  readonly lowerBarrier: StudioWebGpuCommittedBarrier | null;
}

export interface StudioWebGpuCommittedPlanInput<T extends StudioWebGpuCommittedElementInput> {
  /** Scene order: index 0 is back, the final index is front. */
  readonly elements: readonly T[];
  readonly gates?: StudioWebGpuCommittedPlanGates;
  readonly barrierOptions?: StudioWebGpuCommittedBarrierOptions;
}

const SUPPORTED_BRUSHES = new Set(["pen", "fineliner"]);

const EMPTY_ELEMENTS: readonly never[] = Object.freeze([]);
const EMPTY_IDS: readonly string[] = Object.freeze([]);

function activeGate(gates: StudioWebGpuCommittedPlanGates | undefined): StudioWebGpuCommittedGateReason | null {
  if (gates?.exportActive === true) return "export";
  if (gates?.masterEditActive === true) return "master-edit";
  if (gates?.editActive === true) return "edit";
  if (gates?.specialDraftActive === true) return "special-draft";
  if (gates?.postProcessingActive === true) return "post-processing";
  return null;
}

function finitePointArray(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    // Single-point Konva strokes use a circle-specific minimum-radius contract. Keep them on the
    // authoritative renderer until that exact point primitive exists in the GPU compositor.
    && value.length >= 4
    && value.length % 2 === 0
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function finitePressureArray(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((pressure) => (
      typeof pressure === "number"
      && Number.isFinite(pressure)
      && pressure >= 0
      && pressure <= 1
    ));
}

function hasUnsupportedMask(element: StudioWebGpuCommittedElementInput): boolean {
  if (element.clipBelow !== undefined && element.clipBelow !== false) return true;
  if (element.maskEnabled !== undefined && element.maskEnabled !== false) return true;
  if (element.maskSrc !== undefined && element.maskSrc !== null && element.maskSrc !== "") return true;
  if (element.alphaLocked !== undefined && element.alphaLocked !== false) return true;
  return false;
}

function hasUnsupportedStyle(element: StudioWebGpuCommittedElementInput): boolean {
  return element.fill !== undefined
    || element.gradient !== undefined
    || element.pattern !== undefined
    || element.brushDynamics !== undefined
    || element.brushTip !== undefined
    || element.stampPipeline !== undefined
    || element.watercolorPipeline !== undefined;
}

export interface StudioWebGpuCommittedBarrierOptions {
  /**
   * Konva renders causal (dab-sampled) and legacy (endpoint-width segment) geometry through two
   * genuinely different code paths. Callers that rasterize via dabs — the retained GPU render and
   * the raster-CRDT promotion path alike — must opt in here instead of admitting legacy strokes
   * into a renderer that never mirrors their segment geometry.
   */
  readonly requireCausalGeometry?: boolean;
}

/** Returns the first fail-closed reason, or `null` when the element is safe for this slice. */
export function studioWebGpuCommittedBarrierReason(
  element: StudioWebGpuCommittedElementInput,
  options?: StudioWebGpuCommittedBarrierOptions
): StudioWebGpuCommittedBarrierReason | null {
  if (element.type !== "draw") return "non-draw";
  if ((element.kind ?? "freehand") !== "freehand") return "non-freehand";
  if ((element.mode ?? "pen") !== "pen") return "non-pen-mode";

  // The retained WebGPU compositor still paints every dab directly into the destination. A valid
  // layered-flow stroke therefore cannot be delegated until the GPU owns a stroke-local coverage
  // surface and composites element opacity exactly once. Unknown/cross-field-invalid contracts
  // remain a generic unsupported style instead of being mistaken for this understood version.
  if (isStudioStrokePaintModelCompatible(element)) return "paint-model";
  if (element.paintModel !== undefined) return "unsupported-style";

  // An omitted brush is the legacy/default pen contract. Unknown aliases must not inherit the
  // renderer's generic pen fallback, because that would opt future brush families into GPU output.
  const brush = element.brush === undefined ? "pen" : element.brush;
  if (typeof brush !== "string" || !SUPPORTED_BRUSHES.has(brush)) return "unsupported-brush";
  if (
    element.pressureModel !== undefined
    && !isStudioInkPressureModel(element.pressureModel)
  ) {
    return "unsupported-pressure-model";
  }

  if (options?.requireCausalGeometry === true) {
    const hasFiniteSampleSpacing =
      typeof element.sampleSpacing === "number"
      && Number.isFinite(element.sampleSpacing);
    if (!hasFiniteSampleSpacing && element.pressureModel === undefined) return "invalid-geometry";
  }

  if (!finitePointArray(element.points)) return "invalid-geometry";
  const pointCount = element.points.length / 2;
  const pressureSamplesValid = element.pressureModel === undefined
    ? finitePressureArray(element.pressures) && element.pressures.length === pointCount
    : (element.pressures === undefined || (
        Array.isArray(element.pressures)
        && element.pressures.length <= pointCount
        && element.pressures.every((pressure) => (
          typeof pressure === "number"
          && Number.isFinite(pressure)
          && pressure >= 0
          && pressure <= 1
        ))
      ));
  if (
    !pressureSamplesValid
    || !isStudioGpuColorSupported(element.stroke)
    || typeof element.strokeWidth !== "number"
    || !Number.isFinite(element.strokeWidth)
    || element.strokeWidth <= 0
  ) {
    return "invalid-geometry";
  }

  const opacity = element.opacity === undefined ? 1 : element.opacity;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity !== 1) return "opacity";
  if (element.blendMode !== undefined && element.blendMode !== "source-over") return "blend-mode";
  if (element.panelClip !== "none") return "panel-clip";
  if (hasUnsupportedMask(element)) return "mask";

  if (element.symmetry !== undefined) {
    if (
      element.symmetry === null
      || typeof element.symmetry !== "object"
      || Array.isArray(element.symmetry)
      || (element.symmetry as { type?: unknown }).type !== "none"
    ) {
      return "symmetry";
    }
  }

  if (hasUnsupportedStyle(element)) return "unsupported-style";
  return null;
}

function emptyPlan<T extends StudioWebGpuCommittedElementInput>(
  values: Pick<StudioWebGpuCommittedPlan<T>, "status" | "gateReason" | "frontBarrier">
): StudioWebGpuCommittedPlan<T> {
  return {
    ...values,
    elements: EMPTY_ELEMENTS,
    elementIds: EMPTY_IDS,
    lowerBarrier: null,
  };
}

/**
 * Selects the frontmost contiguous suffix that the transparent WebGPU overlay may own safely.
 * The returned element objects are the original references; this planner never mutates scene data.
 */
export function planStudioWebGpuCommittedSuffix<T extends StudioWebGpuCommittedElementInput>(
  input: StudioWebGpuCommittedPlanInput<T>
): StudioWebGpuCommittedPlan<T> {
  const gateReason = activeGate(input.gates);
  if (gateReason) {
    return emptyPlan({ status: "gated", gateReason, frontBarrier: null });
  }

  const selectedFrontToBack: T[] = [];
  let lowerBarrier: StudioWebGpuCommittedBarrier | null = null;

  for (let index = input.elements.length - 1; index >= 0; index -= 1) {
    const element = input.elements[index]!;
    if (element.hidden === true) continue;

    const reason = studioWebGpuCommittedBarrierReason(element, input.barrierOptions);
    if (reason === null) {
      selectedFrontToBack.push(element);
      continue;
    }

    const barrier = { elementId: element.id, reason } as const;
    if (selectedFrontToBack.length === 0) {
      return emptyPlan({ status: "empty", gateReason: null, frontBarrier: barrier });
    }
    lowerBarrier = barrier;
    break;
  }

  if (selectedFrontToBack.length === 0) {
    return emptyPlan({ status: "empty", gateReason: null, frontBarrier: null });
  }

  const elements = selectedFrontToBack.reverse();
  return {
    status: "ready",
    elements,
    elementIds: elements.map((element) => element.id),
    gateReason: null,
    frontBarrier: null,
    lowerBarrier,
  };
}
