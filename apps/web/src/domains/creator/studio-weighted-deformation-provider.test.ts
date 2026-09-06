import { describe, expect, it } from "vitest";

import {
  applyStudioWeightedDeformation,
  type StudioWeightedDeformationRequest,
} from "./studio-weighted-deformation-provider";

function request(
  overrides: Partial<StudioWeightedDeformationRequest> = {},
): StudioWeightedDeformationRequest {
  return {
    requestEpoch: 1,
    currentEpoch: 1,
    mesh: {
      dimension: 2,
      positions: new Float32Array([
        0, 0,
        5, 0,
        20, 0,
      ]),
      textureCoordinates: new Float32Array([
        0, 0,
        0.5, 0,
        1, 0,
      ]),
    },
    sources: [
      {
        id: "curve-a",
        dimension: 2,
        restPoints: new Float32Array([0, -1, 0, 1]),
        deformedPoints: new Float32Array([3, -1, 3, 1]),
        closed: false,
        radius: 10,
        falloff: 1,
        strength: 1,
      },
    ],
    ...overrides,
  };
}

function completed(value: ReturnType<typeof applyStudioWeightedDeformation>) {
  expect(value.status).toBe("completed");
  if (value.status === "rejected") throw new Error(value.reason);
  if (value.status === "cancelled") throw new Error("deformation cancelled");
  return value.artifact;
}

describe("Studio weighted deformation provider", () => {
  it("deforms nearby vertices from a corresponding control curve", () => {
    const artifact = completed(applyStudioWeightedDeformation(request()));
    expect(Array.from(artifact.positions)).toEqual([
      3, 0,
      6.5, 0,
      20, 0,
    ]);
    expect(artifact.receipt).toMatchObject({
      algorithm: "normalized-compact-distance-polyline-v1",
      influencedVertices: 2,
      untouchedVertices: 1,
      maximumDisplacement: 3,
      complete: true,
    });
  });

  it("fades to the unchanged mesh at the influence edge and honors source strength", () => {
    const fixture = request({
      mesh: {
        dimension: 2,
        positions: new Float32Array([0, 0, 5, 0, 9, 0]),
      },
      sources: [
        {
          ...request().sources[0],
          strength: 0.5,
        },
      ],
    });
    const artifact = completed(applyStudioWeightedDeformation(fixture));
    expect(artifact.positions[0]).toBeCloseTo(1.5, 6);
    expect(artifact.positions[2]).toBeCloseTo(5.75, 6);
    expect(artifact.positions[4]).toBeGreaterThan(9);
    expect(artifact.positions[4]).toBeLessThan(9.1);
  });

  it("normalizes overlapping sources and interpolates matching segments", () => {
    const fixture = request({
      mesh: {
        dimension: 2,
        positions: new Float32Array([5, 0]),
      },
      sources: [
        {
          id: "up",
          dimension: 2,
          restPoints: new Float32Array([0, 0, 10, 0]),
          deformedPoints: new Float32Array([0, 2, 10, 2]),
          closed: false,
          radius: 5,
          falloff: 1,
          strength: 1,
        },
        {
          id: "down",
          dimension: 2,
          restPoints: new Float32Array([0, 0, 10, 0]),
          deformedPoints: new Float32Array([0, -1, 10, -1]),
          closed: false,
          radius: 5,
          falloff: 1,
          strength: 1,
        },
      ],
    });
    const artifact = completed(applyStudioWeightedDeformation(fixture));
    expect(Array.from(artifact.positions)).toEqual([5, 0.5]);
  });

  it("supports 3D pegs and copies texture coordinates without aliasing", () => {
    const uv = new Float32Array([0.25, 0.75]);
    const fixture = request({
      mesh: {
        dimension: 3,
        positions: new Float32Array([1, 2, 3]),
        textureCoordinates: uv,
      },
      sources: [
        {
          id: "peg",
          dimension: 3,
          restPoints: new Float32Array([1, 2, 3]),
          deformedPoints: new Float32Array([2, 4, 6]),
          closed: false,
          radius: 4,
          falloff: 1,
          strength: 1,
        },
      ],
    });
    const artifact = completed(applyStudioWeightedDeformation(fixture));
    expect(Array.from(artifact.positions)).toEqual([2, 4, 6]);
    expect(Array.from(artifact.textureCoordinates ?? [])).toEqual([0.25, 0.75]);
    expect(artifact.textureCoordinates).not.toBe(uv);
    uv[0] = 1;
    expect(artifact.textureCoordinates?.[0]).toBe(0.25);
  });

  it("does not mutate inputs and produces a deterministic little-endian digest", () => {
    const fixture = request();
    const sourcePositions = new Float32Array(fixture.mesh.positions);
    const first = completed(applyStudioWeightedDeformation(fixture));
    const second = completed(applyStudioWeightedDeformation(fixture));
    expect(fixture.mesh.positions).toEqual(sourcePositions);
    expect(first.positions).not.toBe(fixture.mesh.positions);
    expect(first.receipt.positionsSha256).toBe(second.receipt.positionsSha256);
    expect(first.receipt.positionsSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fails closed on stale epochs, cancellation and work budgets", () => {
    expect(
      applyStudioWeightedDeformation(request({ requestEpoch: 2 })),
    ).toEqual({ status: "rejected", reason: "stale-epoch" });
    const controller = new AbortController();
    controller.abort();
    expect(
      applyStudioWeightedDeformation(request({ signal: controller.signal })),
    ).toEqual({ status: "cancelled" });
    expect(
      applyStudioWeightedDeformation(request({ maximumWorkUnits: 1 })),
    ).toEqual({ status: "rejected", reason: "budget-exceeded" });
  });

  it("rejects malformed dimensions, duplicate sources and invalid closed envelopes", () => {
    expect(
      applyStudioWeightedDeformation(
        request({
          mesh: { dimension: 2, positions: new Float32Array([0, 0, 1]) },
        }),
      ),
    ).toEqual({ status: "rejected", reason: "invalid-request" });

    const oneSource = request().sources[0];
    expect(
      applyStudioWeightedDeformation(
        request({ sources: [oneSource, { ...oneSource }] }),
      ),
    ).toEqual({ status: "rejected", reason: "invalid-request" });

    expect(
      applyStudioWeightedDeformation(
        request({
          sources: [
            {
              ...oneSource,
              closed: true,
            },
          ],
        }),
      ),
    ).toEqual({ status: "rejected", reason: "budget-exceeded" });
  });
});
