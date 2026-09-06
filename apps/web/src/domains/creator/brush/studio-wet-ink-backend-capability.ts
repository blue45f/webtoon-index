/**
 * Interactive wet-ink backend rollout boundary.
 *
 * The deterministic physical planner remains available to tests, exports and a future
 * Worker/WebGPU provider. It is intentionally not executed synchronously from React/Konva:
 * even a short 4× field currently performs millions of sparse-field neighbour lookups and the
 * independent 64-cell uploads can expose downsampled tile seams. The product Living Ink route now
 * owns this work in a dedicated Worker/WebGL2 provider, but the legacy retained host must still
 * receive an accepted per-device capability receipt before it can bypass the bounded wet-ribbon
 * carrier. Persisted legacy watercolor remains on its exact historical representation.
 */

import { STUDIO_LIVING_INK_FIELD_VERSION } from "../studio-living-ink-field";
import { STUDIO_LIVING_INK_GPU_PROTOCOL_VERSION } from "../studio-living-ink-gpu-protocol";

import { isStudioInkwashFluidBrush } from "./studio-inkwash-fluid-brushes";
import {
  planStudioWetInkBrushReplay,
  studioWetInkBrushRuntimeSupportsElement,
  type StudioWetInkBrushReplayOptions,
  type StudioWetInkBrushReplayPlanResult,
} from "./studio-wet-ink-brush-runtime";

import type { DrawEl } from "../studio-element-model";

export const STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY_VERSION =
  "wet-ink-interactive-backend-capability-v1" as const;

export interface StudioWetInkInteractiveBackendCapability {
  readonly version: typeof STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY_VERSION;
  readonly backendId: "worker-webgl2-living-ink-v1";
  readonly availability: "available" | "probe-required" | "unavailable";
  readonly mainThreadPhysicalField: false;
  readonly fallbackRenderer: "wet-ribbon-carrier-v2";
  readonly reason:
    | "runtime-capability-receipt-accepted"
    | "runtime-capability-receipt-rejected"
    | "runtime-capability-receipt-required";
}

export const STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY:
  StudioWetInkInteractiveBackendCapability = Object.freeze({
    version: STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY_VERSION,
    backendId: "worker-webgl2-living-ink-v1",
    availability: "probe-required",
    mainThreadPhysicalField: false,
    fallbackRenderer: "wet-ribbon-carrier-v2",
    reason: "runtime-capability-receipt-required",
  });

export function resolveStudioWetInkInteractiveBackendCapability(input: Readonly<{
  providerState: "failed" | "loading" | "ready" | "unavailable";
  capabilityReceiptAccepted: boolean;
  backend: "webgl2-offscreen-half-float" | null;
}>): StudioWetInkInteractiveBackendCapability {
  const available = input.providerState === "ready"
    && input.capabilityReceiptAccepted
    && input.backend === "webgl2-offscreen-half-float";
  return Object.freeze({
    ...STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY,
    availability: available ? "available" : input.providerState === "loading" ? "probe-required" : "unavailable",
    reason: available
      ? "runtime-capability-receipt-accepted"
      : input.providerState === "loading"
        ? "runtime-capability-receipt-required"
        : "runtime-capability-receipt-rejected",
  });
}

/**
 * Versioned seam implemented by the product async provider. Keeping it separate preserves the
 * legacy wet-ribbon fallback while preventing any host from wiring only a visual post-process and
 * silently omitting physical save/undo state or the runtime capability receipt.
 */
export const STUDIO_LIVING_INK_INTERACTIVE_PROVIDER_FOUNDATION = Object.freeze({
  fieldVersion: STUDIO_LIVING_INK_FIELD_VERSION,
  gpuProtocolVersion: STUDIO_LIVING_INK_GPU_PROTOCOL_VERSION,
  operationAdapter: "coalesced-wet-replay-samples-v1",
  workerBoundary: "dedicated-worker-offscreen",
  canonicalAuthority: "worker-webgl2-rgba8-plus-operation-journal",
  rollout: "per-device-runtime-capability-receipt",
} as const);

export function studioWetInkInteractiveBackendSupportsElement(
  element: DrawEl,
  capability: StudioWetInkInteractiveBackendCapability = STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY,
): boolean {
  return capability.availability
    === "available"
    && studioWetInkBrushRuntimeSupportsElement(element);
}

/**
 * Returns `null` before reading point/pressure arrays unless the caller supplies an accepted
 * per-device capability. This ordering is the release safety property: ordinary legacy drawing
 * cannot accidentally invoke the synchronous physical planner as brush length grows.
 */
export function planStudioInteractiveWetInkBrushReplay(
  element: DrawEl,
  options: StudioWetInkBrushReplayOptions,
): StudioWetInkBrushReplayPlanResult | null {
  if (
    isStudioInkwashFluidBrush(element.brush)
    && studioWetInkBrushRuntimeSupportsElement(element)
  ) {
    return planStudioWetInkBrushReplay(element, options);
  }
  if (!studioWetInkInteractiveBackendSupportsElement(element)) return null;
  return planStudioWetInkBrushReplay(element, options);
}
