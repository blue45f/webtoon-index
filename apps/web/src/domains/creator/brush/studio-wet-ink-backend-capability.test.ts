import { describe, expect, it } from "vitest";

import {
  planStudioInteractiveWetInkBrushReplay,
  resolveStudioWetInkInteractiveBackendCapability,
  STUDIO_LIVING_INK_INTERACTIVE_PROVIDER_FOUNDATION,
  STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY,
  STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY_VERSION,
  studioWetInkInteractiveBackendSupportsElement,
} from "./studio-wet-ink-backend-capability";

import type { DrawEl } from "../studio-element-model";

function wetStroke(id: string): DrawEl {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0],
    pressures: [0.55],
    stroke: "#315f9b",
    strokeWidth: 28,
    opacity: 0.55,
    brush: "watercolor",
    watercolorPipeline: "causal-walker-v2",
  };
}

describe("interactive wet-ink backend capability", () => {
  it("keeps physical wet ink fail-closed until a device probe receipt is accepted", () => {
    expect(STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY).toEqual({
      version: STUDIO_WET_INK_INTERACTIVE_BACKEND_CAPABILITY_VERSION,
      backendId: "worker-webgl2-living-ink-v1",
      availability: "probe-required",
      mainThreadPhysicalField: false,
      fallbackRenderer: "wet-ribbon-carrier-v2",
      reason: "runtime-capability-receipt-required",
    });
    expect(studioWetInkInteractiveBackendSupportsElement(
      wetStroke("watercolor-gate"),
    )).toBe(false);
    expect(studioWetInkInteractiveBackendSupportsElement({
      ...wetStroke("ink-wash-gate"),
      brush: "ink-wash",
    })).toBe(false);
    expect(STUDIO_LIVING_INK_INTERACTIVE_PROVIDER_FOUNDATION).toEqual({
      fieldVersion: 1,
      gpuProtocolVersion: 1,
      operationAdapter: "coalesced-wet-replay-samples-v1",
      workerBoundary: "dedicated-worker-offscreen",
      canonicalAuthority: "worker-webgl2-rgba8-plus-operation-journal",
      rollout: "per-device-runtime-capability-receipt",
    });
  });

  it("opens only after the exact Worker WebGL2 capability receipt is accepted", () => {
    const accepted = resolveStudioWetInkInteractiveBackendCapability({
      providerState: "ready",
      capabilityReceiptAccepted: true,
      backend: "webgl2-offscreen-half-float",
    });
    expect(accepted.availability).toBe("available");
    expect(accepted.reason).toBe("runtime-capability-receipt-accepted");
    expect(studioWetInkInteractiveBackendSupportsElement(
      wetStroke("accepted-watercolor"),
      accepted,
    )).toBe(true);

    for (const rejected of [
      resolveStudioWetInkInteractiveBackendCapability({
        providerState: "ready",
        capabilityReceiptAccepted: false,
        backend: "webgl2-offscreen-half-float",
      }),
      resolveStudioWetInkInteractiveBackendCapability({
        providerState: "failed",
        capabilityReceiptAccepted: true,
        backend: "webgl2-offscreen-half-float",
      }),
      resolveStudioWetInkInteractiveBackendCapability({
        providerState: "unavailable",
        capabilityReceiptAccepted: false,
        backend: null,
      }),
    ]) {
      expect(rejected.availability).toBe("unavailable");
      expect(rejected.reason).toBe("runtime-capability-receipt-rejected");
      expect(studioWetInkInteractiveBackendSupportsElement(
        wetStroke("rejected-watercolor"),
        rejected,
      )).toBe(false);
    }

    const loading = resolveStudioWetInkInteractiveBackendCapability({
      providerState: "loading",
      capabilityReceiptAccepted: false,
      backend: null,
    });
    expect(loading.availability).toBe("probe-required");
    expect(loading.reason).toBe("runtime-capability-receipt-required");
  });

  it("does not read or plan 50/100/200-sample physical fields on the interactive main thread", () => {
    for (const sampleCount of [50, 100, 200]) {
      const element = wetStroke(`blocked-${sampleCount}`);
      let geometryReads = 0;
      Object.defineProperty(element, "points", {
        configurable: true,
        enumerable: true,
        get() {
          geometryReads += 1;
          throw new Error("physical wet-ink planner must not read interactive geometry");
        },
      });
      Object.defineProperty(element, "pressures", {
        configurable: true,
        enumerable: true,
        get() {
          geometryReads += 1;
          throw new Error("physical wet-ink planner must not read interactive pressure");
        },
      });

      expect(planStudioInteractiveWetInkBrushReplay(
        element,
        { phase: "committed" },
      )).toBeNull();
      expect(geometryReads, `${sampleCount}-sample planner access`).toBe(0);
      expect(element.brush).toBe("watercolor");
      expect(element.watercolorPipeline).toBe("causal-walker-v2");
    }
  });
});
