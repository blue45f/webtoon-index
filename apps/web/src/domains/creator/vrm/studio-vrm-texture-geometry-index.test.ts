import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  getCachedStudioVrmTextureGeometryIndex,
  getStudioVrmTextureGeometryIndex,
  inspectStudioVrmTextureGeometryAdmission,
  invalidateStudioVrmTextureGeometryIndex,
  precomputeStudioVrmTextureGeometryIndex,
} from "./studio-vrm-texture-geometry-index";
import {
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
  computeStudioVrmTextureGeometryWorkerTopology,
  type StudioVrmTextureGeometryWorkerRequest,
  type StudioVrmTextureGeometryWorkerResponse,
} from "./studio-vrm-texture-geometry-worker-protocol";

import type {
  StudioVrmTextureGeometryWorkerLike,
} from "./studio-vrm-texture-geometry-worker-client";

const TEXTURE_SIZE = { width: 1024, height: 1024 } as const;

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

class TopologyWorker implements StudioVrmTextureGeometryWorkerLike {
  readonly messages = new Set<(event: WorkerMessageEventLike) => void>();
  readonly errors = new Set<(event: WorkerErrorEventLike) => void>();
  readonly messageErrors = new Set<(event: WorkerErrorEventLike) => void>();
  request: StudioVrmTextureGeometryWorkerRequest | null = null;
  terminateCalls = 0;

  constructor(readonly automatic = true) {}

  postMessage(
    message: StudioVrmTextureGeometryWorkerRequest,
    transfer: Transferable[],
  ): void {
    this.request = structuredClone(message, { transfer }) as StudioVrmTextureGeometryWorkerRequest;
    if (this.automatic) queueMicrotask(() => this.respond());
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: WorkerMessageEventLike) => void)
      | ((event: WorkerErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.add(listener as (event: WorkerMessageEventLike) => void);
    else if (type === "error") this.errors.add(listener as (event: WorkerErrorEventLike) => void);
    else this.messageErrors.add(listener as (event: WorkerErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: WorkerMessageEventLike) => void)
      | ((event: WorkerErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.delete(listener as (event: WorkerMessageEventLike) => void);
    else if (type === "error") this.errors.delete(listener as (event: WorkerErrorEventLike) => void);
    else this.messageErrors.delete(listener as (event: WorkerErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  respond(): void {
    const request = this.request;
    if (!request) throw new Error("Worker request missing");
    const response: StudioVrmTextureGeometryWorkerResponse = {
      version: STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      topology: computeStudioVrmTextureGeometryWorkerTopology(request),
    };
    for (const listener of [...this.messages]) listener({ data: response });
  }
}

function indexedGeometry(
  positions: readonly number[],
  uvs: readonly number[],
  indices: readonly number[],
  uvAttribute = "uv",
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(uvAttribute, new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(Array.from(indices));
  return geometry;
}

function unitQuad(): THREE.BufferGeometry {
  return indexedGeometry(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 2, 0, 2, 3],
  );
}

describe("studio-vrm-texture-geometry-index islands", () => {
  it("classifies edge-connected indexed triangles as one stable island", () => {
    const index = getStudioVrmTextureGeometryIndex(unitQuad());
    expect(index?.triangleCount).toBe(2);
    expect(index?.islandCount).toBe(1);
    expect(index?.getIsland(0)).toEqual({ id: 0, key: "uv:0", anchorFaceIndex: 0 });
    expect(index?.getIsland(1)).toEqual({ id: 0, key: "uv:0", anchorFaceIndex: 0 });
  });

  it("keeps a UV seam separate even when the two sides share the same 3D edge", () => {
    const geometry = indexedGeometry(
      [
        // 왼쪽 삼각형.
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        // 오른쪽 삼각형은 x=1 모서리 위치를 복제하지만 UV는 다른 아틀라스 영역이다.
        1, 0, 0, 2, 0, 0, 1, 1, 0,
      ],
      [0, 0, 0.4, 0, 0.4, 1, 0.6, 0, 1, 0, 0.6, 1],
      [0, 1, 2, 3, 4, 5],
    );
    const index = getStudioVrmTextureGeometryIndex(geometry);
    expect(index?.islandCount).toBe(2);
    expect(index?.getIsland(0)?.key).toBe("uv:0");
    expect(index?.getIsland(1)?.key).toBe("uv:1");
  });

  it("reconnects hard-edge duplicate vertices when both position and UV agree", () => {
    const geometry = indexedGeometry(
      [
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        // 별도 index이지만 첫 삼각형의 대각선 끝점과 position/UV가 같다.
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ],
      [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
      [0, 1, 2, 3, 4, 5],
    );
    const index = getStudioVrmTextureGeometryIndex(geometry);
    expect(index?.islandCount).toBe(1);
    expect(index?.getIsland(1)?.key).toBe("uv:0");
  });

  it("does not join triangles that only touch at one vertex", () => {
    const geometry = indexedGeometry(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0],
      [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 0, 0.5, 0.5, 0],
      [0, 1, 2, 3, 4, 5],
    );
    expect(getStudioVrmTextureGeometryIndex(geometry)?.islandCount).toBe(2);
  });

  it("supports non-indexed geometry and alternate glTF UV channels", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
        3,
      ),
    );
    geometry.setAttribute(
      "uv1",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
    );
    const index = getStudioVrmTextureGeometryIndex(geometry, { uvAttribute: "uv1" });
    expect(index?.uvAttribute).toBe("uv1");
    expect(index?.triangleCount).toBe(2);
    expect(index?.getIsland(1)?.key).toBe("uv1:0");
  });
});

describe("studio-vrm-texture-geometry-index density", () => {
  it("reports texels per world unit without traversing geometry after construction", () => {
    const geometry = unitQuad();
    const index = getStudioVrmTextureGeometryIndex(geometry);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    position.getX = () => {
      throw new Error("lookup must not reread positions");
    };
    uv.getX = () => {
      throw new Error("lookup must not reread UVs");
    };

    expect(index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE)).toBeCloseTo(1024, 8);
    expect(index?.resolvePaintClassification(1, TEXTURE_SIZE)).toEqual({
      faceIndex: 1,
      island: { id: 0, key: "uv:0", anchorFaceIndex: 0 },
      texelsPerWorldUnit: 1024,
    });
  });

  it("accounts exactly for non-uniform world scaling", () => {
    const index = getStudioVrmTextureGeometryIndex(unitQuad());
    const matrixWorld = new THREE.Matrix4().makeScale(2, 8, 3);
    // 면은 XY 평면이므로 월드 면적은 16배, 선형 텍셀 밀도는 1/4.
    expect(index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE, { matrixWorld })).toBeCloseTo(
      256,
      8,
    );
  });

  it("accepts a texture UV area scale without rebuilding topology", () => {
    const index = getStudioVrmTextureGeometryIndex(unitQuad());
    const base = index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE);
    const repeated = index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE, { uvAreaScale: 4 });
    expect(base).toBe(1024);
    expect(repeated).toBe(2048);
  });

  it("returns null for invalid faces, sizes, transforms and degenerate triangles", () => {
    const degenerate = indexedGeometry(
      [0, 0, 0, 1, 0, 0, 2, 0, 0],
      [0, 0, 0.5, 0, 1, 0],
      [0, 1, 2],
    );
    const index = getStudioVrmTextureGeometryIndex(degenerate);
    expect(index?.getIsland(0)).not.toBeNull();
    expect(index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE)).toBeNull();
    expect(index?.getTexelsPerWorldUnit(-1, TEXTURE_SIZE)).toBeNull();
    expect(index?.getTexelsPerWorldUnit(0, { width: 0, height: 0 })).toBeNull();
    expect(
      index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE, {
        matrixWorld: { elements: [Number.NaN] },
      }),
    ).toBeNull();
    expect(index?.getTexelsPerWorldUnit(0, TEXTURE_SIZE, { uvAreaScale: 0 })).toBeNull();
  });
});

describe("studio-vrm-texture-geometry-index cache and guards", () => {
  it("reads only a signature-current cache entry without scanning geometry on a miss", () => {
    const geometry = unitQuad();
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const positionRead = vi.spyOn(position, "getX");
    const uvRead = vi.spyOn(uv, "getX");

    expect(getCachedStudioVrmTextureGeometryIndex(geometry)).toBeNull();
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();

    const built = getStudioVrmTextureGeometryIndex(geometry);
    expect(built).not.toBeNull();
    positionRead.mockClear();
    uvRead.mockClear();
    expect(getCachedStudioVrmTextureGeometryIndex(geometry)).toBe(built);
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();

    uv.needsUpdate = true;
    expect(getCachedStudioVrmTextureGeometryIndex(geometry)).toBeNull();
    expect(positionRead).not.toHaveBeenCalled();
    expect(uvRead).not.toHaveBeenCalled();
  });

  it("reuses an unchanged geometry and rebuilds after an attribute version change", () => {
    const geometry = unitQuad();
    const first = getStudioVrmTextureGeometryIndex(geometry);
    const second = getStudioVrmTextureGeometryIndex(geometry);
    expect(second).toBe(first);

    const uv = geometry.getAttribute("uv");
    uv.setXY(2, 0.75, 1);
    uv.needsUpdate = true;
    const afterVersionChange = getStudioVrmTextureGeometryIndex(geometry);
    expect(afterVersionChange).not.toBe(first);
    expect(afterVersionChange).toBe(getStudioVrmTextureGeometryIndex(geometry));

    invalidateStudioVrmTextureGeometryIndex(geometry);
    expect(getStudioVrmTextureGeometryIndex(geometry)).not.toBe(afterVersionChange);
  });

  it("fails closed for malformed geometry and a caller triangle budget", () => {
    const missingUv = new THREE.BufferGeometry();
    missingUv.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    expect(getStudioVrmTextureGeometryIndex(missingUv)).toBeNull();
    // 실패 결과도 signature가 같으면 캐시되고, 호출은 예외 없이 계속 null이다.
    expect(getStudioVrmTextureGeometryIndex(missingUv)).toBeNull();
    expect(getStudioVrmTextureGeometryIndex(unitQuad(), { maxTriangles: 1 })).toBeNull();
    expect(getStudioVrmTextureGeometryIndex(unitQuad(), { uvAttribute: "" })).toBeNull();
  });

  it("admits the exact triangle-budget boundary and rejects one triangle over it", () => {
    const geometry = unitQuad();
    expect(inspectStudioVrmTextureGeometryAdmission(geometry, { maxTriangles: 2 })).toEqual({
      triangleCount: 2,
      maxTriangles: 2,
      admitted: true,
    });
    expect(getStudioVrmTextureGeometryIndex(geometry, { maxTriangles: 2 })).not.toBeNull();

    expect(inspectStudioVrmTextureGeometryAdmission(geometry, { maxTriangles: 1 })).toEqual({
      triangleCount: 2,
      maxTriangles: 1,
      admitted: false,
    });
    expect(getStudioVrmTextureGeometryIndex(geometry, { maxTriangles: 1 })).toBeNull();
  });
});

describe("studio-vrm-texture-geometry-index Worker precompute", () => {
  it("matches synchronous island, density, transform, and classification semantics exactly", async () => {
    const geometry = unitQuad();
    const synchronous = getStudioVrmTextureGeometryIndex(geometry);
    expect(synchronous).not.toBeNull();
    const expected = {
      islands: [synchronous?.getIsland(0), synchronous?.getIsland(1)],
      localDensity: synchronous?.getTexelsPerWorldUnit(0, TEXTURE_SIZE),
      scaledDensity: synchronous?.getTexelsPerWorldUnit(0, TEXTURE_SIZE, {
        matrixWorld: new THREE.Matrix4().makeScale(2, 8, 3),
      }),
      repeatedDensity: synchronous?.getTexelsPerWorldUnit(1, TEXTURE_SIZE, {
        uvAreaScale: 4,
      }),
      classification: synchronous?.resolvePaintClassification(1, TEXTURE_SIZE),
    };
    invalidateStudioVrmTextureGeometryIndex(geometry);
    const worker = new TopologyWorker();

    const precomputed = await precomputeStudioVrmTextureGeometryIndex(geometry, {
      workerFactory: () => worker,
    });

    expect(precomputed.triangleCount).toBe(synchronous?.triangleCount);
    expect(precomputed.islandCount).toBe(synchronous?.islandCount);
    expect([precomputed.getIsland(0), precomputed.getIsland(1)]).toEqual(expected.islands);
    expect(precomputed.getTexelsPerWorldUnit(0, TEXTURE_SIZE)).toBe(expected.localDensity);
    expect(precomputed.getTexelsPerWorldUnit(0, TEXTURE_SIZE, {
      matrixWorld: new THREE.Matrix4().makeScale(2, 8, 3),
    })).toBe(expected.scaledDensity);
    expect(precomputed.getTexelsPerWorldUnit(1, TEXTURE_SIZE, {
      uvAreaScale: 4,
    })).toBe(expected.repeatedDensity);
    expect(precomputed.resolvePaintClassification(1, TEXTURE_SIZE)).toEqual(
      expected.classification,
    );
    expect(getStudioVrmTextureGeometryIndex(geometry)).toBe(precomputed);
    expect(worker.terminateCalls).toBe(1);
  });

  it("preserves UV seam and non-indexed alternate-channel island parity", async () => {
    const seam = indexedGeometry(
      [
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        1, 0, 0, 2, 0, 0, 1, 1, 0,
      ],
      [0, 0, 0.4, 0, 0.4, 1, 0.6, 0, 1, 0, 0.6, 1],
      [0, 1, 2, 3, 4, 5],
    );
    const seamSync = getStudioVrmTextureGeometryIndex(seam);
    invalidateStudioVrmTextureGeometryIndex(seam);
    const seamAsync = await precomputeStudioVrmTextureGeometryIndex(seam, {
      workerFactory: () => new TopologyWorker(),
    });
    expect(seamAsync.islandCount).toBe(seamSync?.islandCount);
    expect([seamAsync.getIsland(0), seamAsync.getIsland(1)]).toEqual([
      seamSync?.getIsland(0),
      seamSync?.getIsland(1),
    ]);

    const nonIndexed = new THREE.BufferGeometry();
    nonIndexed.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
        3,
      ),
    );
    nonIndexed.setAttribute(
      "uv1",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
    );
    const nonIndexedSync = getStudioVrmTextureGeometryIndex(
      nonIndexed,
      { uvAttribute: "uv1" },
    );
    invalidateStudioVrmTextureGeometryIndex(nonIndexed);
    const nonIndexedAsync = await precomputeStudioVrmTextureGeometryIndex(nonIndexed, {
      uvAttribute: "uv1",
      workerFactory: () => new TopologyWorker(),
    });
    expect(nonIndexedAsync.uvAttribute).toBe("uv1");
    expect(nonIndexedAsync.getIsland(1)).toEqual(nonIndexedSync?.getIsland(1));
    expect(nonIndexedAsync.getTexelsPerWorldUnit(1, TEXTURE_SIZE)).toBe(
      nonIndexedSync?.getTexelsPerWorldUnit(1, TEXTURE_SIZE),
    );
  });

  it("rejects a stale Worker completion and does not cache it", async () => {
    const geometry = unitQuad();
    const worker = new TopologyWorker(false);
    const pending = precomputeStudioVrmTextureGeometryIndex(geometry, {
      workerFactory: () => worker,
    });
    expect(worker.request).not.toBeNull();
    const uv = geometry.getAttribute("uv");
    uv.setXY(2, 0.75, 1);
    uv.needsUpdate = true;
    worker.respond();

    await expect(pending).rejects.toMatchObject({ code: "geometry-stale" });
    const rebuilt = getStudioVrmTextureGeometryIndex(geometry);
    expect(rebuilt).not.toBeNull();
    expect(worker.terminateCalls).toBe(1);
  });

  it("quarantines direct buffer mutation when explicit invalidation changes no versions", async () => {
    const geometry = unitQuad();
    const worker = new TopologyWorker(false);
    const pending = precomputeStudioVrmTextureGeometryIndex(geometry, {
      workerFactory: () => worker,
    });
    const uv = geometry.getAttribute("uv");
    const values = uv.array as Float32Array;
    values[4] = 0.25;
    // This special path intentionally does not set needsUpdate; invalidation epoch owns the race.
    invalidateStudioVrmTextureGeometryIndex(geometry);
    worker.respond();

    await expect(pending).rejects.toMatchObject({ code: "geometry-stale" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("propagates abort and Worker budget errors without installing partial cache entries", async () => {
    const geometry = unitQuad();
    const worker = new TopologyWorker(false);
    const controller = new AbortController();
    const pendingAbort = precomputeStudioVrmTextureGeometryIndex(geometry, {
      signal: controller.signal,
      workerFactory: () => worker,
    });
    controller.abort();
    await expect(pendingAbort).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(worker.terminateCalls).toBe(1);

    invalidateStudioVrmTextureGeometryIndex(geometry);
    const budgetWorker = new TopologyWorker(false);
    const pendingBudget = precomputeStudioVrmTextureGeometryIndex(geometry, {
      workerFactory: () => budgetWorker,
    });
    const request = budgetWorker.request;
    if (!request) throw new Error("Worker request missing");
    const response: StudioVrmTextureGeometryWorkerResponse = {
      version: 1,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: "working-memory-budget-exceeded",
    };
    for (const listener of [...budgetWorker.messages]) listener({ data: response });
    await expect(pendingBudget).rejects.toMatchObject({
      code: "working-memory-budget-exceeded",
    });
    expect(budgetWorker.terminateCalls).toBe(1);
  });

  it("uses bounded direct only when selected and keeps Worker default fail-closed", async () => {
    const geometry = unitQuad();
    await expect(precomputeStudioVrmTextureGeometryIndex(geometry, {
      workerFactory: null,
    })).rejects.toMatchObject({ code: "worker-unavailable" });

    const direct = await precomputeStudioVrmTextureGeometryIndex(geometry, {
      executionBackend: "direct",
      workerFactory: null,
    });
    expect(direct.getIsland(1)).toEqual({
      id: 0,
      key: "uv:0",
      anchorFaceIndex: 0,
    });
    expect(getStudioVrmTextureGeometryIndex(geometry)).toBe(direct);

    invalidateStudioVrmTextureGeometryIndex(geometry);
    await expect(precomputeStudioVrmTextureGeometryIndex(geometry, {
      maxTriangles: 1,
      workerFactory: null,
    })).rejects.toMatchObject({ code: "triangle-budget-exceeded" });
    expect(getStudioVrmTextureGeometryIndex(geometry, { maxTriangles: 1 })).toBeNull();

    const missingUv = new THREE.BufferGeometry();
    missingUv.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    await expect(precomputeStudioVrmTextureGeometryIndex(missingUv, {
      workerFactory: null,
    })).rejects.toMatchObject({ code: "geometry-invalid" });
    expect(getStudioVrmTextureGeometryIndex(missingUv)).toBeNull();
  });
});
