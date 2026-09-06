import { describe, expect, it, vi } from "vitest";

import {
  createStudioThreeMeshBvhProvider,
  STUDIO_THREE_MESH_BVH_BUDGETS,
  StudioThreeMeshBvhProviderError,
  type StudioThreeMeshBvhLocalShape,
  type StudioThreeMeshBvhRuntime,
} from "./studio-three-mesh-bvh-provider";

function fakeRuntime(
  overrides: Partial<StudioThreeMeshBvhRuntime> = {},
) {
  const events: string[] = [];
  const tree = { kind: "fake-bounds-tree" };
  const runtime: StudioThreeMeshBvhRuntime = {
    version: "fake-three-mesh-bvh-0.9.13",
    inspectGeometry: vi.fn(() => ({
      vertexCount: 8,
      triangleCount: 12,
      indexed: true,
      finitePositions: true,
    })),
    build: vi.fn(() => {
      events.push("build");
      return tree;
    }),
    raycastFirst: vi.fn(() => ({
      point: [1, 0, 0] as const,
      normal: [0, 0, 1] as const,
      distance: 1,
      faceIndex: 1,
    })),
    closestPoint: vi.fn(() => ({
      point: [1, 0, 0] as const,
      normal: null,
      distance: 1,
      faceIndex: 2,
    })),
    shapeCandidates: vi.fn(() => ({
      triangleIndices: [1, 3],
      triangleTests: 4,
      truncated: false,
    })),
    lassoCandidates: vi.fn(() => ({
      triangleIndices: [2, 4],
      triangleTests: 7,
      truncated: false,
    })),
    refit: vi.fn(() => {
      events.push("refit");
    }),
    disposeBoundsTree: vi.fn(() => {
      events.push("dispose:tree");
    }),
    disposeGeometry: vi.fn(() => {
      events.push("dispose:geometry");
    }),
    destroy: vi.fn(() => {
      events.push("destroy:runtime");
    }),
    ...overrides,
  };
  return { runtime, tree, events };
}

const LOCAL_TO_WORLD = [
  2, 0, 0, 0,
  0, 3, 0, 0,
  0, 0, 4, 0,
  10, 20, 30, 1,
] as const;

describe("Studio Three mesh BVH provider", () => {
  it("loads lazily, builds an indirect bounded tree, and emits a plain receipt", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const geometry = { kind: "borrowed-geometry" };
    const provider = createStudioThreeMeshBvhProvider({
      geometry,
      runtimeLoader: load,
      geometryEpoch: 7,
      strategy: "sah",
      maxDepth: 32,
      targetLeafSize: 8,
      localToWorld: LOCAL_TO_WORLD,
    });

    expect(load).not.toHaveBeenCalled();
    expect(provider.snapshot()).toMatchObject({
      state: "ready",
      built: false,
      runtimeLoaded: false,
      geometryEpoch: 7,
    });

    const receipt = await provider.build();
    expect(load).toHaveBeenCalledTimes(1);
    expect(fake.runtime.inspectGeometry).toHaveBeenCalledWith(geometry);
    expect(fake.runtime.build).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({
        strategy: "sah",
        maxDepth: 32,
        targetLeafSize: 8,
        indirect: true,
        attachToGeometry: false,
      }),
    );
    expect(receipt).toMatchObject({
      kind: "studio-three-mesh-bvh-build-receipt",
      providerId: "three-mesh-bvh",
      runtimeVersion: "fake-three-mesh-bvh-0.9.13",
      geometryEpoch: 7,
      geometry: {
        vertexCount: 8,
        triangleCount: 12,
        indexed: true,
      },
      ownership: {
        geometry: "borrowed",
        boundsTree: "private",
      },
      coordinates: {
        inputSpace: "world",
        accelerationSpace: "geometry-local",
        outputSpaces: ["geometry-local", "world"],
        matrixEncoding: "column-major-f64",
      },
    });
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(structuredClone(receipt)).toEqual(receipt);
    expect(await provider.build()).toBe(receipt);
    expect(fake.runtime.build).toHaveBeenCalledTimes(1);
  });

  it("transforms world rays into local space and returns explicit local/world hits", async () => {
    const fake = fakeRuntime();
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      geometryEpoch: 2,
      localToWorld: LOCAL_TO_WORLD,
    });

    const receipt = await provider.raycastFirst({
      originWorld: [10, 20, 30],
      directionWorld: [1, 0, 0],
      nearWorld: 0,
      farWorld: 5,
      expectedGeometryEpoch: 2,
    });

    expect(fake.runtime.raycastFirst).toHaveBeenCalledWith(
      fake.tree,
      expect.objectContaining({
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        near: 0,
        far: 2.5,
      }),
    );
    expect(receipt).toMatchObject({
      query: "raycast-first",
      geometryEpoch: 2,
      result: {
        faceIndex: 1,
        localPoint: [1, 0, 0],
        worldPoint: [12, 20, 30],
        localNormal: [0, 0, 1],
        worldNormal: [0, 0, 1],
        localDistance: 1,
        worldDistance: 2,
        geometryEpoch: 2,
      },
    });
    expect(receipt.queryHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(structuredClone(receipt)).toEqual(receipt);
  });

  it("inverts rotated affine transforms without transposing the linear basis", async () => {
    const fake = fakeRuntime();
    const rotatedLocalToWorld = [
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,
    ] as const;
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      localToWorld: rotatedLocalToWorld,
    });

    const receipt = await provider.raycastFirst({
      originWorld: [10, 20, 30],
      directionWorld: [0, 1, 0],
      farWorld: 5,
    });

    expect(fake.runtime.raycastFirst).toHaveBeenCalledWith(
      fake.tree,
      expect.objectContaining({
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        far: 5,
      }),
    );
    expect(receipt.result?.worldPoint).toEqual([10, 21, 30]);
  });

  it("filters transformed ray and closest hits against their world-space bounds", async () => {
    const fake = fakeRuntime();
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      localToWorld: LOCAL_TO_WORLD,
    });

    await expect(provider.raycastFirst({
      originWorld: [10, 20, 30],
      directionWorld: [1, 0, 0],
      nearWorld: 3,
      farWorld: 5,
    })).resolves.toMatchObject({ result: null });

    const closest = await provider.closestSurface({
      pointWorld: [14, 20, 30],
      maxDistanceWorld: 3,
    });
    expect(fake.runtime.closestPoint).toHaveBeenCalledWith(
      fake.tree,
      [2, 0, 0],
      expect.any(Number),
    );
    expect(closest.result).toMatchObject({
      faceIndex: 2,
      localPoint: [1, 0, 0],
      worldPoint: [12, 20, 30],
      worldDistance: 2,
    });

    await expect(provider.closestSurface({
      pointWorld: [14, 20, 30],
      maxDistanceWorld: 1,
    })).resolves.toMatchObject({ result: null });
  });

  it("conservatively maps sphere and box queries to local candidate searches", async () => {
    const shapes: StudioThreeMeshBvhLocalShape[] = [];
    const fake = fakeRuntime();
    vi.mocked(fake.runtime.shapeCandidates).mockImplementation(
      (_tree, shape) => {
        shapes.push(shape);
        return {
          triangleIndices: [1, 3],
          triangleTests: 4,
          truncated: false,
        };
      },
    );
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      localToWorld: LOCAL_TO_WORLD,
    });

    const sphere = await provider.shapeCandidates({
      kind: "sphere",
      centerWorld: [12, 20, 30],
      radiusWorld: 2,
    });
    const box = await provider.shapeCandidates({
      kind: "box",
      minWorld: [10, 20, 30],
      maxWorld: [12, 23, 34],
    });

    expect(shapes[0]).toMatchObject({
      kind: "sphere",
      center: [1, 0, 0],
    });
    expect(shapes[0]?.kind === "sphere" && shapes[0].radius)
      .toBeCloseTo(Math.hypot(0.5, 1 / 3, 0.25) * 2);
    expect(shapes[1]).toEqual({
      kind: "box",
      min: [0, 0, 0],
      max: [1, 1, 1],
    });
    expect(sphere).toMatchObject({
      query: "sphere-candidates",
      result: {
        triangleIndices: [1, 3],
        triangleTests: 4,
        truncated: false,
        containment: "conservative-world-shape",
      },
    });
    expect(box.query).toBe("box-candidates");
    expect(sphere.queryHash).not.toBe(box.queryHash);
  });

  it("passes bounded NDC lassos with explicit matrices and returns projected candidates", async () => {
    const fake = fakeRuntime();
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      localToWorld: LOCAL_TO_WORLD,
    });
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as const;
    const receipt = await provider.lassoCandidates({
      polygonNdc: [[-1, -1], [1, -1], [0, 1]],
      worldToClip: identity,
      selection: "centroid",
    });

    expect(fake.runtime.lassoCandidates).toHaveBeenCalledWith(
      fake.tree,
      expect.objectContaining({
        localToWorld: LOCAL_TO_WORLD,
        worldToClip: identity,
        polygonNdc: [[-1, -1], [1, -1], [0, 1]],
        selection: "centroid",
        maxTriangleTests:
          STUDIO_THREE_MESH_BVH_BUDGETS.maxTriangleTestsPerQuery,
        maxCandidates:
          STUDIO_THREE_MESH_BVH_BUDGETS.maxCandidatesPerQuery,
      }),
    );
    expect(receipt).toMatchObject({
      query: "lasso-candidates",
      result: {
        triangleIndices: [2, 4],
        containment: "projected-ndc",
      },
    });
  });

  it("refits only when enabled and advances a monotonic geometry epoch", async () => {
    const fake = fakeRuntime();
    const provider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => fake.runtime,
      geometryEpoch: 4,
      allowRefit: true,
    });

    await expect(provider.refit({
      expectedGeometryEpoch: 3,
      nextGeometryEpoch: 5,
    })).rejects.toMatchObject({ code: "epoch-mismatch" });
    await expect(provider.refit({
      expectedGeometryEpoch: 4,
      nextGeometryEpoch: 5,
    })).resolves.toEqual({
      kind: "studio-three-mesh-bvh-refit-receipt",
      revision: 1,
      providerId: "three-mesh-bvh",
      previousGeometryEpoch: 4,
      geometryEpoch: 5,
    });
    expect(fake.runtime.refit).toHaveBeenCalledWith(fake.tree, undefined);
    expect(provider.snapshot().geometryEpoch).toBe(5);
    await expect(provider.build()).resolves.toMatchObject({
      geometryEpoch: 5,
    });
    await expect(provider.raycastFirst({
      originWorld: [0, 0, 0],
      directionWorld: [1, 0, 0],
      expectedGeometryEpoch: 4,
    })).rejects.toMatchObject({ code: "epoch-mismatch" });
  });

  it("rejects invalid geometry and runtime candidates without leaking handles", async () => {
    const oversized = fakeRuntime({
      inspectGeometry: vi.fn(() => ({
        vertexCount: STUDIO_THREE_MESH_BVH_BUDGETS.maxVertices + 1,
        triangleCount: 1,
        indexed: false,
        finitePositions: true,
      })),
    });
    const oversizedProvider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => oversized.runtime,
    });
    await expect(oversizedProvider.build()).rejects.toMatchObject({
      code: "budget-exceeded",
    });
    expect(oversized.runtime.build).not.toHaveBeenCalled();

    const malformed = fakeRuntime({
      shapeCandidates: vi.fn(() => ({
        triangleIndices: [12],
        triangleTests: 1,
        truncated: false,
      })),
    });
    const malformedProvider = createStudioThreeMeshBvhProvider({
      geometry: {},
      runtimeLoader: () => malformed.runtime,
    });
    await expect(malformedProvider.shapeCandidates({
      kind: "sphere",
      centerWorld: [0, 0, 0],
      radiusWorld: 1,
    })).rejects.toMatchObject({ code: "invalid-runtime-output" });
  });

  it("detaches the tree, releases owned geometry, and destroys in reverse order", async () => {
    const fake = fakeRuntime();
    const geometry = {};
    const provider = createStudioThreeMeshBvhProvider({
      geometry,
      runtimeLoader: () => fake.runtime,
      geometryOwnership: "provider-owned",
      boundsTreeOwnership: "geometry-attached",
    });
    await provider.build();
    await Promise.all([provider.destroy(), provider.destroy()]);

    expect(fake.runtime.disposeBoundsTree).toHaveBeenCalledWith(
      fake.tree,
      geometry,
      true,
    );
    expect(fake.runtime.disposeGeometry).toHaveBeenCalledWith(geometry);
    expect(fake.events).toEqual([
      "build",
      "dispose:tree",
      "dispose:geometry",
      "destroy:runtime",
    ]);
    expect(provider.snapshot()).toMatchObject({
      state: "destroyed",
      built: false,
      runtimeLoaded: false,
    });
    await expect(provider.build()).rejects.toBeInstanceOf(
      StudioThreeMeshBvhProviderError,
    );
  });

  it("works against the installed Three and three-mesh-bvh adapters", async () => {
    const three = await import("three");
    const geometry = new three.BoxGeometry(2, 2, 2);
    const provider = createStudioThreeMeshBvhProvider({
      geometry,
      three,
      geometryOwnership: "provider-owned",
    });

    const build = await provider.build();
    const hit = await provider.raycastFirst({
      originWorld: [0, 0, 5],
      directionWorld: [0, 0, -1],
      farWorld: 10,
    });
    const candidates = await provider.shapeCandidates({
      kind: "sphere",
      centerWorld: [0, 0, 0],
      radiusWorld: 2,
    });

    expect(build.geometry.triangleCount).toBe(12);
    expect(hit.result?.worldPoint[2]).toBeCloseTo(1);
    expect(candidates.result.triangleIndices.length).toBeGreaterThan(0);
    expect(structuredClone(hit)).toEqual(hit);
    await provider.destroy();
  });
});
