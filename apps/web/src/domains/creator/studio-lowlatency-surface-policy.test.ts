import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_LOW_LATENCY_SURFACE_ROLES,
  isStudioContradictoryCanvasAttributes,
  probeStudioLowLatencySurface,
  resolveStudioLowLatencySurfacePolicy,
  studioLowLatencyContextAttributes,
  type StudioLowLatencySurfaceRole,
} from "./studio-lowlatency-surface-policy";

type ProbeCanvas = { getContext: (contextId: string, attributes?: unknown) => unknown };

function probeCanvas(
  implementation: (contextId: string, attributes?: unknown) => unknown
): ProbeCanvas & { getContext: ReturnType<typeof vi.fn<(contextId: string, attributes?: unknown) => unknown>> } {
  return { getContext: vi.fn(implementation) };
}

function canvasReturning(context: unknown) {
  return probeCanvas(() => context);
}

describe("studio low latency surface policy", () => {
  it("desynchronizes exactly the transient write-only drawing surfaces", () => {
    const desynchronized = STUDIO_LOW_LATENCY_SURFACE_ROLES
      .filter((role) => resolveStudioLowLatencySurfacePolicy(role).desynchronized);

    expect(desynchronized).toEqual([
      "live-ink-overlay",
      "live-stamp-overlay",
      "live-prediction-overlay",
      "webgl-live-ink",
    ]);
  });

  it("never desynchronizes a surface that is read back or composited with the page", () => {
    for (const role of ["committed-document-layer", "hit-test", "readback-scratch", "export-composite"] as const) {
      expect(resolveStudioLowLatencySurfacePolicy(role).desynchronized, role).toBe(false);
    }
    expect(resolveStudioLowLatencySurfacePolicy("committed-document-layer").reason)
      .toBe("tears-against-page");
    expect(resolveStudioLowLatencySurfacePolicy("readback-scratch").reason).toBe("readback-owner");
  });

  it("marks WebGPU and worker surfaces as unable to express the request", () => {
    expect(resolveStudioLowLatencySurfacePolicy("webgpu-live-ink")).toMatchObject({
      desynchronized: false,
      reason: "not-expressible",
    });
    expect(resolveStudioLowLatencySurfacePolicy("offscreen-worker")).toMatchObject({
      desynchronized: false,
      reason: "not-composited",
    });
  });

  it("never emits the contradictory desynchronized + willReadFrequently pair", () => {
    for (const role of STUDIO_LOW_LATENCY_SURFACE_ROLES) {
      const decision = resolveStudioLowLatencySurfacePolicy(role);
      expect(decision.desynchronized && decision.willReadFrequently, role).toBe(false);
      expect(isStudioContradictoryCanvasAttributes(studioLowLatencyContextAttributes(role)), role)
        .toBe(false);
    }
    expect(isStudioContradictoryCanvasAttributes({ desynchronized: true, willReadFrequently: true }))
      .toBe(true);
    expect(isStudioContradictoryCanvasAttributes(null)).toBe(false);
  });

  it("fails closed to a synchronized surface for an unknown role", () => {
    expect(resolveStudioLowLatencySurfacePolicy("brand-new-surface")).toMatchObject({
      desynchronized: false,
      willReadFrequently: false,
    });
  });

  it("builds the exact attribute bag each call site should pass", () => {
    expect(studioLowLatencyContextAttributes("live-ink-overlay"))
      .toEqual({ alpha: true, desynchronized: true });
    expect(studioLowLatencyContextAttributes("live-ink-overlay", { alpha: false }))
      .toEqual({ alpha: false, desynchronized: true });
    expect(studioLowLatencyContextAttributes("readback-scratch"))
      .toEqual({ alpha: true, willReadFrequently: true });
    expect(studioLowLatencyContextAttributes("committed-document-layer")).toEqual({ alpha: true });
  });
});

describe("studio low latency surface probe", () => {
  it("reports granted only when the context reflects the attribute back", () => {
    const context = { getContextAttributes: () => ({ alpha: true, desynchronized: true }) };
    const canvas = canvasReturning(context);

    const result = probeStudioLowLatencySurface(canvas, "live-ink-overlay");

    expect(canvas.getContext).toHaveBeenCalledWith("2d", { alpha: true, desynchronized: true });
    expect(result.context).toBe(context);
    expect(result.probe).toEqual({ status: "granted", desynchronized: true, usedFallback: false });
  });

  it("reports denied when the browser silently refuses the attribute", () => {
    const context = { getContextAttributes: () => ({ alpha: true, desynchronized: false }) };

    const result = probeStudioLowLatencySurface(canvasReturning(context), "live-ink-overlay");

    expect(result.context).toBe(context);
    expect(result.probe).toEqual({ status: "denied", desynchronized: false, usedFallback: false });
  });

  it("reports unverifiable rather than assuming success when no reflector exists", () => {
    const result = probeStudioLowLatencySurface(canvasReturning({}), "live-ink-overlay");

    expect(result.probe.status).toBe("unverifiable");
    expect(result.probe.desynchronized).toBe(false);
  });

  it("treats a throwing reflector as no evidence instead of propagating the failure", () => {
    const context = {
      getContextAttributes: () => {
        throw new TypeError("detached");
      },
    };

    const result = probeStudioLowLatencySurface(canvasReturning(context), "live-ink-overlay");

    expect(result.context).toBe(context);
    expect(result.probe.status).toBe("unverifiable");
  });

  it("retries bare when the attribute bag makes getContext throw", () => {
    const fallbackContext = { id: "bare" };
    const canvas = probeCanvas(() => null);
    const { getContext } = canvas;
    getContext
      .mockImplementationOnce(() => {
        throw new TypeError("unknown context option");
      })
      .mockReturnValueOnce(fallbackContext);

    const result = probeStudioLowLatencySurface(canvas, "live-ink-overlay");

    expect(getContext).toHaveBeenNthCalledWith(1, "2d", { alpha: true, desynchronized: true });
    expect(getContext).toHaveBeenNthCalledWith(2, "2d");
    expect(result.context).toBe(fallbackContext);
    expect(result.probe).toEqual({ status: "rejected", desynchronized: false, usedFallback: true });
  });

  it("retries bare when the attribute bag makes getContext return null", () => {
    const fallbackContext = { id: "bare" };
    const canvas = probeCanvas(() => null);
    const { getContext } = canvas;
    getContext.mockReturnValueOnce(null).mockReturnValueOnce(fallbackContext);

    const result = probeStudioLowLatencySurface(canvas, "webgl-live-ink", "webgl2");

    expect(getContext).toHaveBeenNthCalledWith(1, "webgl2", { alpha: true, desynchronized: true });
    expect(getContext).toHaveBeenNthCalledWith(2, "webgl2");
    expect(result.context).toBe(fallbackContext);
    expect(result.probe.status).toBe("rejected");
  });

  it("reports unsupported when no context can be created at all", () => {
    const result = probeStudioLowLatencySurface(probeCanvas(() => null), "live-ink-overlay");

    expect(result.context).toBeNull();
    expect(result.probe).toEqual({
      status: "unsupported",
      desynchronized: false,
      usedFallback: true,
    });
  });

  it("reports unsupported for a missing or malformed canvas", () => {
    expect(probeStudioLowLatencySurface(null, "live-ink-overlay").probe.status).toBe("unsupported");
    expect(probeStudioLowLatencySurface(
      { getContext: undefined } as never,
      "live-ink-overlay"
    ).probe.status).toBe("unsupported");
  });

  it("never asks for the flag on a role that cannot express it", () => {
    const canvas = canvasReturning({});

    const result = probeStudioLowLatencySurface(canvas, "webgpu-live-ink");

    expect(canvas.getContext).toHaveBeenCalledWith("2d", { alpha: true });
    expect(result.probe.status).toBe("not-applicable");
    expect(result.probe.desynchronized).toBe(false);
  });

  it("still returns a context for a synchronized readback role", () => {
    const context = { id: "readback" };
    const canvas = canvasReturning(context);

    const result = probeStudioLowLatencySurface(canvas, "readback-scratch");

    expect(canvas.getContext).toHaveBeenCalledWith("2d", { alpha: true, willReadFrequently: true });
    expect(result.context).toBe(context);
    expect(result.probe.desynchronized).toBe(false);
  });

  it("covers every declared role without throwing", () => {
    for (const role of STUDIO_LOW_LATENCY_SURFACE_ROLES as readonly StudioLowLatencySurfaceRole[]) {
      const result = probeStudioLowLatencySurface(canvasReturning({}), role);
      expect(typeof result.probe.status, role).toBe("string");
    }
  });
});
