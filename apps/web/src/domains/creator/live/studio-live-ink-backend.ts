import type { StudioGpuBackend } from "../render/studio-webgpu-frame-contract";
import type { StudioGpuLiveStrokePreparation } from "../render/studio-webgpu-live-stroke-plan";

/**
 * Engine selection is explicit. Missing and legacy `auto` configuration normalize to WebGPU;
 * they never authorize a runtime switch to Canvas2D. Canvas2D remains available only as an
 * independently selected compatibility/reference engine.
 */
export type StudioLiveInkBackendPreference = "webgpu" | "canvas2d";

export type StudioLiveInkBackendDecisionReason =
  | "webgpu-ready"
  | "canvas2d-explicit"
  | "selection-disabled"
  | "backend-unavailable"
  | "unsupported-draft"
  | "post-correction"
  | "eraser"
  | "fill"
  | "opacity"
  | "symmetry"
  | "invalid-preparation";

export interface StudioLiveInkBackendDecisionInput {
  readonly preference: StudioLiveInkBackendPreference;
  /** False when rollout/kill policy disables this exact selection; it never selects another one. */
  readonly selectionEnabled?: boolean;
  readonly resolvedBackend: StudioGpuBackend | null;
  readonly direct: boolean;
  readonly postCorrectionActive: boolean;
  readonly mode: unknown;
  readonly fill: unknown;
  readonly opacity: unknown;
  readonly symmetryType: unknown;
  /**
   * Proof that the caller has converted the document draft into the renderer-neutral stroke
   * contract consumed by the GPU engine. This is required for styles that the historical direct
   * overlay could not represent; omitting or forging one of its fields keeps that feature on the
   * authoritative Canvas2D path instead of rendering a visually different approximation.
   */
  readonly preparedStroke?: StudioGpuLiveStrokePreparation | null;
}

export type StudioLiveInkBackendDecision =
  | Readonly<{
      readonly status: "ready";
      readonly backend: StudioGpuBackend;
      readonly selectedBackend: StudioGpuBackend;
      readonly reason: "webgpu-ready" | "canvas2d-explicit";
    }>
  | Readonly<{
      readonly status: "unavailable";
      readonly backend: null;
      readonly selectedBackend: "webgpu";
      readonly reason: Exclude<
        StudioLiveInkBackendDecisionReason,
        "webgpu-ready" | "canvas2d-explicit"
      >;
    }>;

/**
 * Missing, legacy `auto`, and malformed values select WebGPU. A deployment typo therefore cannot
 * silently re-enable the retired automatic Canvas2D fallback. Only exact `canvas2d` is manual.
 */
export function resolveStudioLiveInkBackendPreference(
  value: unknown
): StudioLiveInkBackendPreference {
  return value === "canvas2d" ? "canvas2d" : "webgpu";
}

function unavailable(
  reason: Exclude<StudioLiveInkBackendDecisionReason, "webgpu-ready" | "canvas2d-explicit">,
): StudioLiveInkBackendDecision {
  return Object.freeze({
    status: "unavailable",
    backend: null,
    selectedBackend: "webgpu",
    reason,
  });
}

/**
 * Stroke-scoped renderer selection. Callers run this once at pointer down and retain the result
 * until pointer up, so a late device initialization can never switch rasterizers mid-stroke.
 */
export function decideStudioLiveInkBackend(
  input: StudioLiveInkBackendDecisionInput
): StudioLiveInkBackendDecision {
  if (input.selectionEnabled === false) return unavailable("selection-disabled");
  if (input.preference === "canvas2d") {
    return Object.freeze({
      status: "ready",
      backend: "canvas2d",
      selectedBackend: "canvas2d",
      reason: "canvas2d-explicit",
    });
  }
  if (input.fill !== undefined && input.fill !== null && input.fill !== false && input.fill !== "") {
    return unavailable("fill");
  }

  const opacity = input.opacity;
  if (
    typeof opacity !== "number"
    || !Number.isFinite(opacity)
    || opacity < 0
    || opacity > 1
  ) {
    return unavailable("opacity");
  }
  const composite = input.mode === "eraser" ? "erase" : "normal";
  const symmetryRequested = input.symmetryType !== "none";
  const prepared = input.preparedStroke;
  if (prepared !== undefined && prepared !== null) {
    if (
      (prepared.composite !== "normal" && prepared.composite !== "erase")
      || (prepared.symmetry !== "identity" && prepared.symmetry !== "expanded")
      || (prepared.geometry !== "source" && prepared.geometry !== "post-corrected")
      || (prepared.destination !== "transparent-overlay"
        && prepared.destination !== "retained-layer")
    ) {
      return unavailable("invalid-preparation");
    }
    if (prepared.composite !== composite) {
      return unavailable(composite === "erase" ? "eraser" : "invalid-preparation");
    }
    if (composite === "erase" && prepared.destination !== "retained-layer") {
      // destination-out on a transparent live overlay cannot erase the committed canvas below it.
      return unavailable("eraser");
    }
    if (!Object.is(prepared.opacity, opacity)) {
      return unavailable("opacity");
    }
    if (symmetryRequested !== (prepared.symmetry === "expanded")) {
      return unavailable("symmetry");
    }
    if (input.postCorrectionActive !== (prepared.geometry === "post-corrected")) {
      return unavailable("post-correction");
    }
  } else {
    // The old direct-overlay contract is still a valid fast path for an opaque, ordinary pen.
    // Every richer style requires an explicit preparation proof so callers cannot enable WebGPU
    // while still passing the unexpanded/uncomposited source draft.
    if (input.postCorrectionActive) {
      return unavailable("post-correction");
    }
    if (composite === "erase") return unavailable("eraser");
    if (opacity < 0.999) return unavailable("opacity");
    if (symmetryRequested) return unavailable("symmetry");
  }
  if (!input.direct && !prepared) {
    return unavailable("unsupported-draft");
  }
  if (input.resolvedBackend !== "webgpu") {
    return unavailable("backend-unavailable");
  }
  return Object.freeze({
    status: "ready",
    backend: "webgpu",
    selectedBackend: "webgpu",
    reason: "webgpu-ready",
  });
}
