import { describe, expect, it } from "vitest";

import {
  createStudioVrmTextureGeometryWorkerRequest,
} from "./studio-vrm-texture-geometry-worker-client";
import {
  computeStudioVrmTextureGeometryWorkerTopology,
  hasValidStudioVrmTextureGeometryWorkerTopologyNumbers,
  isStudioVrmTextureGeometryWorkerRequest,
  isStudioVrmTextureGeometryWorkerResponse,
  isStudioVrmTextureGeometryWorkerTopology,
  studioVrmTextureGeometryWorkerRequestTransfers,
  studioVrmTextureGeometryWorkerResponseTransfers,
} from "./studio-vrm-texture-geometry-worker-protocol";

function indexedSquare() {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]),
    uvs: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

function resultResponse(
  request: ReturnType<typeof createStudioVrmTextureGeometryWorkerRequest>,
) {
  return {
    version: 1 as const,
    kind: "result" as const,
    requestId: request.requestId,
    generationId: request.generationId,
    topology: computeStudioVrmTextureGeometryWorkerTopology(request),
  };
}

describe("studio-vrm-texture-geometry-worker-protocol", () => {
  it("builds one deterministic island for an indexed square", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest(
      indexedSquare(),
      { requestId: 7, generationId: 11 },
    );
    const topology = computeStudioVrmTextureGeometryWorkerTopology(request);

    expect(topology.triangleCount).toBe(2);
    expect(topology.islandCount).toBe(1);
    expect([...topology.triangleIslandIds]).toEqual([0, 0]);
    expect([...topology.islandAnchors]).toEqual([0]);
    expect([...topology.uvDoubleAreas]).toEqual([1, 1]);
    expect([...topology.localEdges]).toEqual([
      1, 0, 0, 1, 1, 0,
      1, 1, 0, 0, 1, 0,
    ]);
    expect(isStudioVrmTextureGeometryWorkerTopology(topology)).toBe(true);
    expect(hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(topology)).toBe(true);
  });

  it("recovers shared topology for non-indexed duplicate vertices", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest({
      positions: new Float64Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ]),
      uvs: new Float64Array([
        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,
      ]),
    });
    const topology = computeStudioVrmTextureGeometryWorkerTopology(request);

    expect([...topology.triangleIslandIds]).toEqual([0, 0]);
    expect([...topology.islandAnchors]).toEqual([0]);
  });

  it("keeps physically adjacent triangles apart across a UV seam", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest({
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ]),
      uvs: new Float32Array([
        0, 0, 1, 0, 1, 1,
        0.2, 0, 0.8, 1, 0, 1,
      ]),
    });
    const topology = computeStudioVrmTextureGeometryWorkerTopology(request);

    expect(topology.islandCount).toBe(2);
    expect([...topology.triangleIslandIds]).toEqual([0, 1]);
    expect([...topology.islandAnchors]).toEqual([0, 1]);
  });

  it("marks only triangles with non-finite or out-of-range vertex data invalid", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest({
      positions: new Float64Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        Number.NaN, 0, 0,
      ]),
      uvs: new Float64Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const topology = computeStudioVrmTextureGeometryWorkerTopology(request);

    expect([...topology.triangleIslandIds]).toEqual([0, -1]);
    expect([...topology.islandAnchors]).toEqual([0]);
    expect(topology.uvDoubleAreas[1]).toBe(0);
    expect([...topology.localEdges.slice(6)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("returns byte-for-byte deterministic arrays and island numbering", () => {
    const firstRequest = createStudioVrmTextureGeometryWorkerRequest(indexedSquare());
    const secondRequest = createStudioVrmTextureGeometryWorkerRequest(indexedSquare());
    const first = computeStudioVrmTextureGeometryWorkerTopology(firstRequest);
    const second = computeStudioVrmTextureGeometryWorkerTopology(secondRequest);

    expect(new Uint8Array(first.triangleIslandIds.buffer)).toEqual(
      new Uint8Array(second.triangleIslandIds.buffer),
    );
    expect(new Uint8Array(first.islandAnchors.buffer)).toEqual(
      new Uint8Array(second.islandAnchors.buffer),
    );
    expect(new Uint8Array(first.uvDoubleAreas.buffer)).toEqual(
      new Uint8Array(second.uvDoubleAreas.buffer),
    );
    expect(new Uint8Array(first.localEdges.buffer)).toEqual(
      new Uint8Array(second.localEdges.buffer),
    );
  });

  it("uses standalone transferable snapshots without detaching source geometry arrays", () => {
    const source = indexedSquare();
    const request = createStudioVrmTextureGeometryWorkerRequest(source);
    const transfers = studioVrmTextureGeometryWorkerRequestTransfers(request);

    expect(transfers).toEqual([
      request.positions.buffer,
      request.uvs.buffer,
      request.indices?.buffer,
    ]);
    expect(request.positions.buffer).not.toBe(source.positions.buffer);
    expect(request.uvs.buffer).not.toBe(source.uvs.buffer);
    expect(request.indices?.buffer).not.toBe(source.indices.buffer);
    expect(source.positions.byteLength).toBeGreaterThan(0);
    expect(source.uvs.byteLength).toBeGreaterThan(0);
    expect(source.indices.byteLength).toBeGreaterThan(0);
  });

  it("rejects hostile request receipts, subviews, and malformed response arrays", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest(indexedSquare());
    expect(isStudioVrmTextureGeometryWorkerRequest(request)).toBe(true);
    expect(isStudioVrmTextureGeometryWorkerRequest({
      ...request,
      inputByteLength: request.inputByteLength + 1,
    })).toBe(false);

    const padded = new Float32Array(request.positions.length + 1);
    padded.set(request.positions, 1);
    expect(isStudioVrmTextureGeometryWorkerRequest({
      ...request,
      positions: padded.subarray(1),
    })).toBe(false);

    const response = resultResponse(request);
    expect(isStudioVrmTextureGeometryWorkerResponse(response)).toBe(true);
    response.topology.triangleIslandIds[0] = 99;
    expect(isStudioVrmTextureGeometryWorkerResponse(response)).toBe(true);
    expect(hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(response.topology)).toBe(false);
  });

  it("transfers each result buffer exactly once", () => {
    const request = createStudioVrmTextureGeometryWorkerRequest(indexedSquare());
    const response = resultResponse(request);
    expect(studioVrmTextureGeometryWorkerResponseTransfers(response)).toEqual([
      response.topology.triangleIslandIds.buffer,
      response.topology.islandAnchors.buffer,
      response.topology.uvDoubleAreas.buffer,
      response.topology.localEdges.buffer,
    ]);
  });

  it("fails before allocation when triangle budgets are exceeded", () => {
    expect(() => createStudioVrmTextureGeometryWorkerRequest({
      ...indexedSquare(),
      maxTriangles: 1,
    })).toThrow(expect.objectContaining({ code: "triangle-budget-exceeded" }));
  });
});
