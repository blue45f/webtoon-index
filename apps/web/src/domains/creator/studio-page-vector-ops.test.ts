import { CenterlineRefitError } from "@toonspectrum/studio-brush-platform";
import { describe, expect, it, vi } from "vitest";

import { refitSettledStudioStrokeCenterline } from "./studio-page-vector-ops";

import type { DrawEl } from "./studio-element-model";
import type { CenterlineFitEngine } from "@toonspectrum/studio-brush-platform";

/**
 * Settled-stroke centerline refit seam (studio-page-vector-ops):
 * default-OFF no-op contract (byte-identical element, engine never invoked),
 * eligibility gates, delegation to the package enhancer, and fail-closed
 * propagation of the package's centerline-only guard.
 */

function drawStroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    points: [0, 0, 4, 1, 8, 0, 12, 2, 16, 1],
    stroke: "#111111",
    strokeWidth: 4,
    ...overrides,
  };
}

/** Faithful fake fitter: echoes the polyline back as an open M/L path. */
function identityFitEngine(): CenterlineFitEngine {
  return {
    fitPolyline(points) {
      return {
        verbs: points.map(([x, y], index) =>
          index === 0
            ? ({ v: "M", x, y } as const)
            : ({ v: "L", x, y } as const),
        ),
      };
    },
  };
}

describe("refitSettledStudioStrokeCenterline — default OFF", () => {
  it("is a pure no-op with the option absent: element byte-identical", () => {
    const element = drawStroke();
    const before = JSON.stringify(element);
    const pointsRef = element.points;
    const outcome = refitSettledStudioStrokeCenterline(element);
    expect(outcome).toEqual({ kind: "disabled" });
    expect(JSON.stringify(element)).toBe(before);
    expect(element.points).toBe(pointsRef);
  });

  it("never touches the engine when enabled is false", () => {
    const fitPolyline = vi.fn();
    const outcome = refitSettledStudioStrokeCenterline(drawStroke(), {
      enabled: false,
      fitEngine: { fitPolyline },
    });
    expect(outcome).toEqual({ kind: "disabled" });
    expect(fitPolyline).not.toHaveBeenCalled();
  });
});

describe("refitSettledStudioStrokeCenterline — enabled", () => {
  it("refits the freehand centerline with exact endpoints", () => {
    const element = drawStroke();
    const engine = identityFitEngine();
    const spy = vi.spyOn(engine, "fitPolyline");
    const outcome = refitSettledStudioStrokeCenterline(element, {
      enabled: true,
      fitEngine: engine,
      accuracy: 0.35,
    });
    expect(outcome.kind).toBe("refit");
    if (outcome.kind !== "refit") return;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      [
        [0, 0],
        [4, 1],
        [8, 0],
        [12, 2],
        [16, 1],
      ],
      { closed: false, accuracy: 0.35 },
    );
    expect(outcome.refit.path.verbs[0]).toEqual({ v: "M", x: 0, y: 0 });
    const lastVerb =
      outcome.refit.path.verbs[outcome.refit.path.verbs.length - 1]!;
    expect(lastVerb).toEqual({ v: "L", x: 16, y: 1 });
    expect(outcome.refit.measuredDeviationPx).toBeLessThanOrEqual(1e-9);
    // The seam proposes; it never mutates the document element.
    expect(element.points).toEqual([0, 0, 4, 1, 8, 0, 12, 2, 16, 1]);
  });

  it.each([
    ["shape-stroke", drawStroke({ kind: "rect" })],
    ["eraser-stroke", drawStroke({ mode: "eraser" })],
    ["insufficient-points", drawStroke({ points: [0, 0] })],
    ["insufficient-points", drawStroke({ points: [0, 0, 1, 1, 2] })],
  ])("returns ineligible (%s) without calling the engine", (reason, element) => {
    const fitPolyline = vi.fn();
    const outcome = refitSettledStudioStrokeCenterline(element, {
      enabled: true,
      fitEngine: { fitPolyline },
    });
    expect(outcome).toEqual({ kind: "ineligible", reason });
    expect(fitPolyline).not.toHaveBeenCalled();
  });

  it("fails closed on outline-ring input via the package centerline guard", () => {
    const fitPolyline = vi.fn();
    const ringElement = drawStroke({
      // A closed ring is the outline-polygon signature the fitter must never
      // receive (measured kurbo non-termination on sliver outlines).
      points: [0, 0, 12, 0, 12, 8, 0, 8, 0, 0],
    });
    try {
      refitSettledStudioStrokeCenterline(ringElement, {
        enabled: true,
        fitEngine: { fitPolyline },
      });
      expect.unreachable("outline ring must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(CenterlineRefitError);
      expect((error as CenterlineRefitError).reason).toBe("outline-input");
    }
    expect(fitPolyline).not.toHaveBeenCalled();
  });
});
