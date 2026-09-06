import { describe, expect, it } from "vitest";

import {
  STUDIO_FISHEYE_MAX_COORDINATE,
  STUDIO_FISHEYE_MAX_FOV_DEG,
  STUDIO_FISHEYE_MIN_RADIUS,
  STUDIO_FISHEYE_MIN_STRENGTH,
  beginStudioFisheyeSnapSession,
  canonicalizeStudioFisheyeRuler,
  createStudioFisheyeGuideCurves,
  evaluateStudioFisheyeGuideCurve,
  mirrorStudioFisheyeRulerHorizontally,
  projectPointOntoStudioFisheyeGuide,
  sampleStudioFisheyeGuideCurve,
  selectStudioFisheyeGuideCurve,
  snapStudioFisheyePoint,
  studioFisheyeDirectionToPoint,
  studioFisheyePointToDirection,
  type StudioFisheyeGuideCurve,
  type StudioFisheyeRuler,
} from "./studio-fisheye-ruler";

const ruler = (overrides: Partial<StudioFisheyeRuler> = {}): StudioFisheyeRuler => ({
  id: "fish-a",
  centerX: 100,
  centerY: 80,
  radius: 70,
  rotationDeg: 0,
  fovDeg: 180,
  strength: 1,
  outsidePolicy: "clamp",
  ...overrides,
});

function radialGuide(value: StudioFisheyeRuler = ruler()): StudioFisheyeGuideCurve {
  return createStudioFisheyeGuideCurves(value).find((guide) => guide.family === "radial")!;
}

function sphericalGuide(value: StudioFisheyeRuler = ruler()): StudioFisheyeGuideCurve {
  return createStudioFisheyeGuideCurves(value).find((guide) => guide.family === "spherical")!;
}

describe("studio fisheye ruler canonicalization and lens projection", () => {
  it("canonicalizes center, radius, rotation, FOV, strength and outside policy", () => {
    const canonical = canonicalizeStudioFisheyeRuler({
      id: "",
      centerX: Number.NaN,
      centerY: STUDIO_FISHEYE_MAX_COORDINATE * 2,
      radius: -99,
      rotationDeg: -30,
      fovDeg: 999,
      strength: 0,
      outsidePolicy: "future",
    });
    expect(canonical).toEqual({
      id: "fisheye-ruler",
      centerX: 0,
      centerY: STUDIO_FISHEYE_MAX_COORDINATE,
      radius: STUDIO_FISHEYE_MIN_RADIUS,
      rotationDeg: 330,
      fovDeg: STUDIO_FISHEYE_MAX_FOV_DEG,
      strength: STUDIO_FISHEYE_MIN_STRENGTH,
      outsidePolicy: "clamp",
    });
    expect(Object.isFrozen(canonical)).toBe(true);
  });

  it("does not invoke accessor-backed untrusted fields", () => {
    let getterCalls = 0;
    const canonical = canonicalizeStudioFisheyeRuler({
      get centerX() {
        getterCalls += 1;
        return 999;
      },
      centerY: 30,
      radius: 100,
    });
    expect(getterCalls).toBe(0);
    expect(canonical.centerX).toBe(0);
    expect(canonical.centerY).toBe(30);
  });

  it("round-trips rotated, non-unit-strength lens points", () => {
    const configured = ruler({ rotationDeg: 37, strength: 1.7, fovDeg: 200 });
    const source = { x: 128, y: 42 };
    const direction = studioFisheyePointToDirection(configured, source);
    const roundTrip = studioFisheyeDirectionToPoint(configured, direction!);
    expect(roundTrip?.x).toBeCloseTo(source.x, 8);
    expect(roundTrip?.y).toBeCloseTo(source.y, 8);
    expect(Math.hypot(direction!.x, direction!.y, direction!.z)).toBeCloseTo(1, 10);
  });

  it("keeps the optical center and exact lens edge finite", () => {
    const configured = ruler();
    expect(studioFisheyePointToDirection(configured, { x: 100, y: 80 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    const edgeDirection = studioFisheyePointToDirection(configured, { x: 170, y: 80 });
    expect(edgeDirection).not.toBeNull();
    expect([edgeDirection!.x, edgeDirection!.y, edgeDirection!.z].every(Number.isFinite)).toBe(true);
    const edgePoint = studioFisheyeDirectionToPoint(configured, edgeDirection!);
    expect(edgePoint?.x).toBeCloseTo(170, 8);
    expect(edgePoint?.y).toBeCloseTo(80, 8);
  });

  it("rejects non-finite directions and directions outside the configured FOV", () => {
    expect(studioFisheyeDirectionToPoint(ruler(), { x: NaN, y: 0, z: 1 })).toBeNull();
    expect(studioFisheyeDirectionToPoint(ruler({ fovDeg: 90 }), { x: 0, y: 0, z: -1 })).toBeNull();
  });
});

describe("studio fisheye radial and spherical guide families", () => {
  it("builds frozen radial diameters and two spherical offset stacks", () => {
    const guides = createStudioFisheyeGuideCurves(ruler());
    expect(guides.filter((guide) => guide.family === "radial")).toHaveLength(8);
    expect(guides.filter((guide) => guide.family === "spherical")).toHaveLength(12);
    expect(Object.isFrozen(guides)).toBe(true);
    expect(Object.isFrozen(guides[0]?.planeNormal)).toBe(true);
  });

  it("evaluates and samples visible finite guide arcs", () => {
    const configured = ruler();
    const radial = radialGuide(configured);
    const spherical = sphericalGuide(configured);
    const radialSamples = sampleStudioFisheyeGuideCurve(configured, radial, 64);
    const sphericalSamples = sampleStudioFisheyeGuideCurve(configured, spherical, 64);
    expect(radialSamples.length).toBeGreaterThan(0);
    expect(sphericalSamples.length).toBeGreaterThan(0);
    expect([...radialSamples, ...sphericalSamples].every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(evaluateStudioFisheyeGuideCurve(configured, radial, Number.NaN)).toBeNull();
  });

  it("projects onto a radial diameter using sampled minima and Newton refinement", () => {
    const configured = ruler();
    const projection = projectPointOntoStudioFisheyeGuide(
      configured,
      radialGuide(configured),
      { x: 135, y: 103 },
      { samples: 48, newtonIterations: 12 }
    );
    expect(projection?.status).toBe("snapped");
    // First radial guide is the local x diameter at rotation 0.
    expect(projection?.point.y).toBeCloseTo(80, 6);
    expect(projection?.point.x).toBeCloseTo(135, 5);
    expect(projection?.tangent).not.toBeNull();
  });

  it("projects onto a spherical great circle and satisfies its plane equation", () => {
    const configured = ruler({ rotationDeg: 21, strength: 1.4 });
    const guide = sphericalGuide(configured);
    const projection = projectPointOntoStudioFisheyeGuide(configured, guide, { x: 127, y: 102 });
    expect(projection?.status).toBe("snapped");
    const direction = studioFisheyePointToDirection(configured, projection!.point)!;
    const planeError = direction.x * guide.planeNormal.x
      + direction.y * guide.planeNormal.y
      + direction.z * guide.planeNormal.z;
    expect(Math.abs(planeError)).toBeLessThan(1e-6);
  });

  it("selects a forced family and automatically favors a direction-compatible guide", () => {
    const configured = ruler();
    expect(selectStudioFisheyeGuideCurve(
      configured,
      { x: 140, y: 82 },
      { x: 165, y: 82 },
      { family: "radial" }
    )?.guide.family).toBe("radial");
    expect(selectStudioFisheyeGuideCurve(
      configured,
      { x: 140, y: 82 },
      { x: 140, y: 112 },
      { family: "spherical" }
    )?.guide.family).toBe("spherical");
    expect(selectStudioFisheyeGuideCurve(
      configured,
      { x: 140, y: 80 },
      { x: 165, y: 80 }
    )?.guide.family).toBe("radial");
  });
});

describe("studio fisheye outside policies and immutable sessions", () => {
  it("rejects, clamps, or passes through points outside the lens explicitly", () => {
    const outside = { x: 240, y: 100 };
    const guide = radialGuide(ruler());
    expect(projectPointOntoStudioFisheyeGuide(
      ruler({ outsidePolicy: "reject" }),
      guide,
      outside
    )).toBeNull();

    const clamped = projectPointOntoStudioFisheyeGuide(
      ruler({ outsidePolicy: "clamp" }),
      guide,
      outside
    );
    expect(clamped?.status).toBe("snapped");
    expect(clamped?.inputWasOutside).toBe(true);
    expect(Math.hypot(clamped!.point.x - 100, clamped!.point.y - 80)).toBeLessThanOrEqual(70 + 1e-6);
    expect([clamped!.point.x, clamped!.point.y, clamped!.tangent!.x, clamped!.tangent!.y]
      .every(Number.isFinite)).toBe(true);

    const passthrough = projectPointOntoStudioFisheyeGuide(
      ruler({ outsidePolicy: "passthrough" }),
      guide,
      outside
    );
    expect(passthrough).toMatchObject({
      status: "passthrough",
      point: outside,
      parameter: null,
      distance: 0,
      inputWasOutside: true,
    });
  });

  it("keeps central and rim projections finite", () => {
    const configured = ruler();
    const guide = radialGuide(configured);
    const center = projectPointOntoStudioFisheyeGuide(configured, guide, { x: 100, y: 80 });
    const edge = projectPointOntoStudioFisheyeGuide(configured, guide, { x: 170, y: 80 });
    expect(center?.point).toEqual({ x: 100, y: 80 });
    expect(edge?.point.x).toBeCloseTo(170, 6);
    expect([center!.tangent!.x, center!.tangent!.y, edge!.tangent!.x, edge!.tangent!.y]
      .every(Number.isFinite)).toBe(true);
  });

  it("captures frozen settings at pointer-down and returns persistent session transitions", () => {
    const mutable = ruler();
    const session = beginStudioFisheyeSnapSession(
      mutable,
      { x: 125, y: 82 },
      { x: 150, y: 82 },
      { family: "radial" }
    );
    expect(session).not.toBeNull();
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session!.ruler)).toBe(true);
    expect(Object.isFrozen(session!.guide.planeNormal)).toBe(true);

    (mutable as { centerX: number }).centerX = 9_999;
    const transition = snapStudioFisheyePoint(session!, { x: 145, y: 100 });
    expect(transition).not.toBeNull();
    expect(transition!.session).not.toBe(session);
    expect(session!.ruler.centerX).toBe(100);
    expect(transition!.point.y).toBeCloseTo(80, 5);
  });

  it("keeps the last guide parameter while passing an outside sample through", () => {
    const session = beginStudioFisheyeSnapSession(
      ruler({ outsidePolicy: "passthrough" }),
      { x: 125, y: 80 },
      { x: 150, y: 80 },
      { family: "radial" }
    );
    const transition = snapStudioFisheyePoint(session!, { x: 300, y: 80 });
    expect(transition?.projection.status).toBe("passthrough");
    expect(transition?.point).toEqual({ x: 300, y: 80 });
    expect(transition?.session.lastParameter).toBe(session?.lastParameter);
  });

  it("fails non-finite session samples closed", () => {
    const session = beginStudioFisheyeSnapSession(
      ruler(),
      { x: 125, y: 80 },
      { x: 150, y: 80 },
      { family: "radial" }
    );
    expect(snapStudioFisheyePoint(session!, { x: Infinity, y: 0 })).toBeNull();
  });
});

describe("studio fisheye horizontal mirroring", () => {
  it("mirrors center and orientation and round-trips canonical settings", () => {
    const source = ruler({ centerX: 35, centerY: 90, rotationDeg: 25, strength: 1.3 });
    const mirrored = mirrorStudioFisheyeRulerHorizontally(source, 240);
    expect(mirrored).toEqual({
      ...source,
      centerX: 205,
      rotationDeg: 155,
    });
    expect(mirrorStudioFisheyeRulerHorizontally(mirrored, 240)).toEqual(source);
    expect(mirrorStudioFisheyeRulerHorizontally(source, Number.NaN)).toBeNull();
  });

  it("mirrors a principal radial guide's rendered points", () => {
    const source = ruler({ centerX: 80, centerY: 70, rotationDeg: 20 });
    const mirrored = mirrorStudioFisheyeRulerHorizontally(source, 240)!;
    const guide = radialGuide(source);
    const sourceSamples = sampleStudioFisheyeGuideCurve(source, guide, 96);
    const mirroredSamples = sampleStudioFisheyeGuideCurve(mirrored, guide, 96);
    expect(sourceSamples.length).toBe(mirroredSamples.length);
    for (const point of sourceSamples.slice(0, 8)) {
      const expected = { x: 240 - point.x, y: point.y };
      const nearest = mirroredSamples.reduce((best, candidate) => {
        const candidateDistance = Math.hypot(candidate.x - expected.x, candidate.y - expected.y);
        const bestDistance = Math.hypot(best.x - expected.x, best.y - expected.y);
        return candidateDistance < bestDistance ? candidate : best;
      });
      expect(nearest.x).toBeCloseTo(expected.x, 5);
      expect(nearest.y).toBeCloseTo(expected.y, 5);
    }
  });
});
