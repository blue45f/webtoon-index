import { describe, expect, it } from "vitest";

import {
  admitStudioLiveTransformDrawCompilation,
  compileStudioLiveTransformDrawSnapshot,
} from "./studio-live-transform-draw-compiler";
import { captureStudioOutlineStrokeContractV1 } from "./studio-outline-stroke-contract";

import type { DrawEl } from "./studio-element-model";

function draw(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    points: [0, 0, 30, 40],
    stroke: "#111827",
    strokeWidth: 4,
    ...overrides,
  } as DrawEl;
}

describe("compileStudioLiveTransformDrawSnapshot", () => {
  it("rejects an unbounded stroke by array length without touching a sample", () => {
    const points = new Proxy(new Array<number>(200_000), {
      get: (target, property, receiver) => {
        if (property !== "length") throw new Error(`sample access: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const element = draw({ brush: "pen", sampleSpacing: 2, points });

    expect(admitStudioLiveTransformDrawCompilation(element, 10)).toEqual({
      admitted: false,
      reason: "sample-budget",
    });
  });

  it("captures an immutable point/clip snapshot and the renderer's scale-sensitive route", () => {
    const element = draw({ noClip: true, pressures: [0.25, 0.75] });
    const snapshot = compileStudioLiveTransformDrawSnapshot(element);

    expect(snapshot).toMatchObject({
      elementId: "stroke-1",
      noClip: true,
      points: [0, 0, 30, 40],
      renderRoute: {
        strokeWidth: 4,
        strokeDistance: 50,
        pointCount: 2,
        retainedAffinePolicy: "route-checked",
        drawsArrowHead: false,
        isPerfectFamily: false,
        isPerfectInk: false,
      },
      exactDraftComplexity: {
        sampleCount: 2,
        pathLength: 50,
      },
    });
    expect(snapshot.points).not.toBe(element.points);
    expect(snapshot.element).not.toBe(element);
    expect(snapshot.element.points).toBe(snapshot.points);
    expect(snapshot.element.pressures).not.toBe(element.pressures);
    element.points[0] = 999;
    element.pressures![0] = 1;
    expect(snapshot.points[0]).toBe(0);
    expect(snapshot.element.pressures?.[0]).toBe(0.25);
  });

  it("keeps arrow and perfect-outline renderer facts behind the compiler boundary", () => {
    const lineWithArrow = compileStudioLiveTransformDrawSnapshot(draw({
      kind: "line",
      strokeStyle: {
        dash: "solid",
        lineCap: "round",
        arrowStart: "none",
        arrowEnd: "arrow",
      },
    }));
    const perfectInk = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "perfect-ink",
    }));
    const gpen = compileStudioLiveTransformDrawSnapshot(draw({ brush: "gpen" }));

    expect(lineWithArrow.renderRoute.drawsArrowHead).toBe(true);
    expect(perfectInk.renderRoute).toMatchObject({
      isPerfectFamily: true,
      isPerfectInk: true,
    });
    expect(gpen.renderRoute).toMatchObject({
      isPerfectFamily: true,
      isPerfectInk: false,
    });
  });

  it("routes renderer clamps that are not affine-equivalent through the exact model draft", () => {
    const legacyCausal = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "pen",
      sampleSpacing: 2,
    }));
    const versionedCausal = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "pen",
      pressureModel: "linear-full-v1",
      sampleSpacing: 2,
    }));
    const calligraphy = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "calligraphy",
      sampleSpacing: 2,
    }));
    const legacyPerfect = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "perfect-ink",
      sampleSpacing: 2,
    }));
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    });
    expect(outlineStroke).not.toBeNull();
    const contractedOutline = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "gpen",
      outlineStroke: outlineStroke!,
      sampleSpacing: 2,
    }));

    expect(legacyCausal.renderRoute.retainedAffinePolicy).toBe("model-draft-only");
    expect(versionedCausal.renderRoute.retainedAffinePolicy).toBe("model-draft-only");
    expect(legacyCausal.exactDraftComplexity.causalMaxDabRadius).toBeCloseTo(3.4, 12);
    expect(versionedCausal.exactDraftComplexity.causalMaxDabRadius).toBe(2);
    expect(calligraphy.renderRoute.retainedAffinePolicy).toBe("model-draft-only");
    expect(calligraphy.exactDraftComplexity).toMatchObject({
      rendererEngine: "calligraphy-segments",
      rendererExpandedScalarWork: 206,
      rendererPathCommandUpperBound: 110,
      rendererMaxPaintRadius: 2.5,
    });
    expect(legacyPerfect.renderRoute.retainedAffinePolicy).toBe("model-draft-only");
    expect(legacyPerfect.exactDraftComplexity).toMatchObject({
      rendererEngine: "perfect-outline",
      rendererExpandedScalarWork: 730,
      rendererPathCommandUpperBound: 184,
      rendererMaxPaintRadius: 4,
    });
    expect(contractedOutline.renderRoute.retainedAffinePolicy).toBe("model-draft-only");
  });

  it("compiles the adversarial 256-sample calligraphy expansion once at gesture begin", () => {
    const pointCount = 256;
    const calligraphy = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "calligraphy",
      strokeWidth: 512,
      points: Array.from({ length: pointCount }, (_, index) => [
        index * 2,
        index % 2 === 0 ? 0 : 100,
      ]).flat(),
      pressures: Array.from({ length: pointCount }, () => 1),
      brushTip: { tiltEnabled: false, angleDeg: 0, roundness: 0.08 },
    }));

    expect(calligraphy.exactDraftComplexity).toMatchObject({
      sampleCount: 256,
      rendererExpandedScalarWork: 53_038,
      rendererPathCommandUpperBound: 27_542,
      rendererMaxPaintRadius: 320,
    });
  });

  it("compiles calligraphy tap pressure and perfect compact-dot radius floors", () => {
    const calligraphyTap = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "brush-pen",
      strokeWidth: 4,
      points: [0, 0],
      pressures: [1],
    }));
    const perfectTap = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "perfect-ink",
      strokeWidth: 1,
      points: [0, 0],
      pressures: [0],
    }));

    // brush-pen maps the 4px selection to a 5px diameter and pressure=1 to 1.3, so its retained
    // generic-dot Ellipse can reach 5 * (0.3 + 1.3 * 1.4) / 2 = 5.3px.
    expect(calligraphyTap.exactDraftComplexity).toMatchObject({
      rendererEngine: "calligraphy-segments",
      rendererExpandedScalarWork: 0,
      rendererPathCommandUpperBound: 3,
    });
    expect(calligraphyTap.exactDraftComplexity.rendererMaxPaintRadius).toBeCloseTo(5.3, 12);
    expect(perfectTap.exactDraftComplexity).toMatchObject({
      rendererEngine: "perfect-outline",
      rendererMaxPaintRadius: 3,
    });
  });

  it("captures alias-scaled causal coverage instead of trusting raw strokeWidth", () => {
    const boldMarker = compileStudioLiveTransformDrawSnapshot(draw({
      brush: "marker-bold",
      strokeWidth: 100,
      sampleSpacing: 2,
    }));

    // marker-bold maps 100px to a 150px effective diameter; legacy pressure can reach 1.7x.
    expect(boldMarker.exactDraftComplexity).toMatchObject({
      rendererEngine: "causal-ink",
      strokeWidth: 100,
      causalMaxDabRadius: 127.5,
    });
  });
});
