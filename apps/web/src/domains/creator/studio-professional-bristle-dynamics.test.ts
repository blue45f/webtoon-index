import { describe, expect, it, vi } from "vitest";

import {
  parseStudioProfessionalBristleDynamicsPlan,
  resolveStudioProfessionalBristleDynamics,
} from "./studio-professional-bristle-dynamics";

function dynamics(overrides: Record<string, unknown> = {}) {
  return {
    kind: "studio-professional-bristle-dynamics",
    version: 1,
    brushId: "clean-room-rake",
    seed: 0xffff_ffff,
    bristleCount: 9,
    bristleRadiusRatio: 0.035,
    featureReferenceDiameter: 10,
    spacingRatio: 0.2,
    spread: 0.8,
    fanning: 0.4,
    rigidity: 0.65,
    friction: 0.25,
    contactAngleRadians: Math.PI,
    turnAmount: 1,
    softenEdge: 0.6,
    pressureSpread: 0.4,
    tiltSpread: 0.6,
    lengthVariation: 0.3,
    colorVariation: 0.2,
    orientation: "stroke-direction",
    scaleFeatureWithBrushSize: true,
    ...overrides,
  };
}

function sample(
  sequence: number,
  x: number,
  y: number,
  pressure = 0.5,
  overrides: Record<string, unknown> = {},
) {
  return {
    role: "authoritative",
    sequence,
    x,
    y,
    pressure,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timeMilliseconds: sequence * 8,
    pointerId: 1,
    flags: 0,
    ...overrides,
  };
}

function canonical(
  samples = [
    sample(0, 10, 10, 0.5),
    sample(1, 30, 10, 0.5),
    sample(2, 30, 30, 0.5),
  ],
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: "bristle-stroke",
    seed: 123,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.2, 0.3, 0.4, 1],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 0.8,
    },
    recipe: {
      version: 1,
      brushId: "rake-base",
      engine: "dab-v1",
      material: "pigment",
      tip: {
        kind: "analytic",
        shape: "round",
        edgeSoftness: 0.25,
      },
      size: 10,
      flow: 1,
      hardness: 0.7,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: { minimum: 0.5, maximum: 1, exponent: 1 },
        opacity: { minimum: 0.5, maximum: 1, exponent: 1 },
        flow: { minimum: 1, maximum: 1, exponent: 1 },
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: samples.at(0)?.sequence ?? 0,
      lastSequence: samples.at(-1)?.sequence ?? 0,
      samples,
    },
    ...overrides,
  };
}

describe("professional bristle dynamics", () => {
  it("resolves deterministic, stable bristle paths across a curved stroke", () => {
    const first = resolveStudioProfessionalBristleDynamics(canonical(), dynamics());
    const second = resolveStudioProfessionalBristleDynamics(canonical(), dynamics());

    expect(first).toEqual(second);
    expect(first.status).toBe("resolved");
    if (first.status !== "resolved") return;
    expect(first.stations.length).toBeGreaterThan(3);
    expect(first.depositions.length).toBe(first.stations.length * 9);
    expect(first.stations.at(0)?.headingRadians).toBeCloseTo(0);
    expect(first.stations.at(-1)?.headingRadians).toBeGreaterThan(0);
    expect(
      first.depositions.some((deposition) => Math.abs(deposition.longitudinalOffset) > 0.01),
    ).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.depositions)).toBe(true);
  });

  it("uses contact angle to reduce the contacting bristles without changing their identities", () => {
    const full = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0), sample(1, 10, 0)]),
      dynamics({ contactAngleRadians: Math.PI }),
    );
    const partial = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0), sample(1, 10, 0)]),
      dynamics({ contactAngleRadians: Math.PI * 0.2 }),
    );
    expect(full.status).toBe("resolved");
    expect(partial.status).toBe("resolved");
    if (full.status !== "resolved" || partial.status !== "resolved") return;
    expect(partial.stations[0]?.activeBristles).toBeLessThan(full.stations[0]!.activeBristles);
    const fullIds = new Set(full.depositions.map((deposition) => deposition.bristleIndex));
    expect(partial.depositions.every((deposition) => fullIds.has(deposition.bristleIndex))).toBe(
      true,
    );
  });

  it("fans the head with pressure and tilt while preserving the centre line", () => {
    const flat = resolveStudioProfessionalBristleDynamics(
      canonical([
        sample(0, 0, 0, 0),
        sample(1, 20, 0, 0),
      ]),
      dynamics(),
    );
    const spread = resolveStudioProfessionalBristleDynamics(
      canonical([
        sample(0, 0, 0, 1, { tiltX: 80 }),
        sample(1, 20, 0, 1, { tiltX: 80 }),
      ]),
      dynamics(),
    );
    expect(flat.status).toBe("resolved");
    expect(spread.status).toBe("resolved");
    if (flat.status !== "resolved" || spread.status !== "resolved") return;
    const maxFlat = Math.max(...flat.depositions.map((item) => Math.abs(item.lateralOffset)));
    const maxSpread = Math.max(...spread.depositions.map((item) => Math.abs(item.lateralOffset)));
    expect(maxSpread).toBeGreaterThan(maxFlat * 2);
    expect(
      spread.depositions.some((item) => Math.abs(item.lateralOffset) < 0.5),
    ).toBe(true);
  });

  it("honours the canonical affine transform and wrapped stylus rotation", () => {
    const input = canonical(
      [
        sample(0, 0, 0, 0.5, { twist: 359 }),
        sample(1, 10, 0, 0.5, { twist: 1 }),
      ],
      {
        transform: {
          encoding: "affine-f64-v1",
          m11: 2,
          m12: 0,
          m21: 0,
          m22: 3,
          translateX: 100,
          translateY: 200,
        },
      },
    );
    const result = resolveStudioProfessionalBristleDynamics(
      input,
      dynamics({ orientation: "stylus-rotation", bristleCount: 1 }),
    );
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.stations[0]).toMatchObject({ x: 100, y: 200 });
    expect(result.stations.at(-1)).toMatchObject({ x: 120, y: 200 });
    expect(result.stations[0]?.diameter).toBeCloseTo(22.5);
    expect(result.depositions[0]?.localToDocument[0]).toBeCloseTo(
      result.depositions[0]!.radius * Math.sqrt(2 / 3),
    );
    expect(result.depositions[0]?.localToDocument[3]).toBeCloseTo(
      result.depositions[0]!.radius * Math.sqrt(3 / 2),
    );
    expect(Math.abs(result.stations.at(-1)!.headingRadians)).toBeLessThan(0.05);
  });

  it("keeps fixed bristle features stable when brush-size feature scaling is disabled", () => {
    const lowPressure = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0, 0), sample(1, 20, 0, 0)]),
      dynamics({ scaleFeatureWithBrushSize: false, featureReferenceDiameter: 12 }),
    );
    const highPressure = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0, 1), sample(1, 20, 0, 1)]),
      dynamics({
        scaleFeatureWithBrushSize: false,
        featureReferenceDiameter: 12,
        pressureSpread: 0,
      }),
    );
    expect(lowPressure.status).toBe("resolved");
    expect(highPressure.status).toBe("resolved");
    if (lowPressure.status !== "resolved" || highPressure.status !== "resolved") return;
    expect(lowPressure.depositions[0]?.radius).toBeCloseTo(highPressure.depositions[0]!.radius);
  });

  it("applies canonical flow once and preserves affine reflection in each bristle footprint", () => {
    const fullFlow = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0), sample(1, 10, 0)]),
      dynamics({ bristleCount: 1 }),
    );
    const reflectedInput = canonical(
      [sample(0, 0, 0), sample(1, 10, 0)],
      {
        transform: {
          encoding: "affine-f64-v1",
          m11: -1,
          m12: 0,
          m21: 0,
          m22: 1,
          translateX: 0,
          translateY: 0,
        },
        recipe: {
          ...canonical().recipe,
          flow: 0.5,
        },
      },
    );
    const halfFlow = resolveStudioProfessionalBristleDynamics(
      reflectedInput,
      dynamics({ bristleCount: 1 }),
    );
    expect(fullFlow.status).toBe("resolved");
    expect(halfFlow.status).toBe("resolved");
    if (fullFlow.status !== "resolved" || halfFlow.status !== "resolved") return;
    expect(halfFlow.depositions[0]?.opacity).toBeCloseTo(
      fullFlow.depositions[0]!.opacity * 0.5,
    );
    const [xx, xy, yx, yy] = halfFlow.depositions[0]!.localToDocument;
    expect(xx * yy - xy * yx).toBeLessThan(0);
  });

  it("keeps at least one contacting hair for a zero-angle even bristle bundle", () => {
    const result = resolveStudioProfessionalBristleDynamics(
      canonical([sample(0, 0, 0), sample(1, 10, 0)]),
      dynamics({ bristleCount: 8, contactAngleRadians: 0 }),
    );
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.stations.every((station) => station.activeBristles >= 1)).toBe(true);
  });

  it("rejects accessors and unknown fields without invoking hostile getters", () => {
    const getter = vi.fn(() => "stroke-direction");
    const hostile = dynamics();
    Object.defineProperty(hostile, "orientation", {
      enumerable: true,
      get: getter,
    });
    expect(parseStudioProfessionalBristleDynamicsPlan(hostile)).toEqual({
      ok: false,
      path: "$",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(parseStudioProfessionalBristleDynamicsPlan({
      ...dynamics(),
      vendorPrivateState: true,
    })).toEqual({ ok: false, path: "$" });

    const optionGetter = vi.fn(() => 2);
    const hostileOptions = {};
    Object.defineProperty(hostileOptions, "maximumStations", {
      enumerable: true,
      get: optionGetter,
    });
    expect(resolveStudioProfessionalBristleDynamics(
      canonical(),
      dynamics(),
      hostileOptions,
    )).toMatchObject({ status: "rejected", reason: "invalid-options" });
    expect(optionGetter).not.toHaveBeenCalled();
  });

  it("fails closed on station/deposition budgets and supports cooperative cancellation", () => {
    const input = canonical([
      sample(0, 0, 0),
      sample(1, 100, 0),
    ]);
    expect(resolveStudioProfessionalBristleDynamics(
      input,
      dynamics({ spacingRatio: 0.01 }),
      { maximumStations: 2 },
    )).toMatchObject({ status: "rejected", reason: "station-limit-exceeded" });
    expect(resolveStudioProfessionalBristleDynamics(
      input,
      dynamics({ bristleCount: 32 }),
      { maximumDepositions: 2 },
    )).toMatchObject({ status: "rejected", reason: "deposition-limit-exceeded" });

    const cancel = vi.fn(({ processedStations }: { processedStations: number }) => (
      processedStations >= 2
    ));
    const cancelled = resolveStudioProfessionalBristleDynamics(
      input,
      dynamics(),
      { shouldCancel: cancel },
    );
    expect(cancelled).toMatchObject({
      status: "cancelled",
      processedStations: 2,
    });
  });
});
