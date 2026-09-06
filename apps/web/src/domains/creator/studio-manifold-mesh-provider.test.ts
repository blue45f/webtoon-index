import { describe, expect, it, vi } from "vitest";

import {
  createStudioManifoldMeshProvider,
  createStudioManifoldRuntime,
  StudioManifoldMeshProviderError,
  type StudioManifoldRuntime,
  type StudioManifoldTriangleMeshInput,
} from "./studio-manifold-mesh-provider";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const TETRA_POSITIONS = new Float32Array([
  1, 1, 1,
  -1, -1, 1,
  -1, 1, -1,
  1, -1, -1,
]);
const TETRA_INDICES = new Uint32Array([
  0, 2, 1,
  0, 1, 3,
  0, 3, 2,
  1, 2, 3,
]);

function tetraInput(
  positions: ArrayBufferView | readonly number[] = TETRA_POSITIONS,
  triangleIndices: ArrayBufferView | readonly number[] = TETRA_INDICES,
): StudioManifoldTriangleMeshInput {
  return { positions, triangleIndices };
}

function fakeRuntime(overrides: Partial<StudioManifoldRuntime> = {}) {
  const events: string[] = [];
  const left = { kind: "left" };
  const right = { kind: "right" };
  const result = { kind: "result" };
  const meshes: {
    positions: number[];
    triangleIndices: number[];
  }[] = [];
  let createIndex = 0;
  const runtime: StudioManifoldRuntime = {
    version: "fake-manifold-3d-3.5.1",
    createManifold: vi.fn((mesh) => {
      const handle = createIndex === 0 ? left : right;
      createIndex += 1;
      events.push(`create:${handle.kind}`);
      meshes.push({
        positions: [...mesh.positions],
        triangleIndices: [...mesh.triangleIndices],
      });
      return handle;
    }),
    status: vi.fn(() => "NoError"),
    boolean: vi.fn((_left, _right, operation) => {
      events.push(`boolean:${operation}`);
      return result;
    }),
    getMesh: vi.fn(() => ({
      numProp: 3,
      vertProperties: new Float32Array(TETRA_POSITIONS),
      triangleIndices: new Uint32Array(TETRA_INDICES),
    })),
    inspectManifold: vi.fn(() => ({
      status: "NoError" as const,
      empty: false,
      physicalVertexCount: 4,
      triangleCount: 4,
      genus: 0,
      surfaceArea: 13.856406460551018,
      volume: 8 / 3,
      boundingBox: {
        min: [-1, -1, -1] as const,
        max: [1, 1, 1] as const,
      },
    })),
    deleteManifold: vi.fn((handle) => {
      events.push(`delete:${(handle as { kind: string }).kind}`);
    }),
    destroy: vi.fn(() => {
      events.push("destroy:runtime");
    }),
    ...overrides,
  };
  return { runtime, left, right, result, meshes, events };
}

describe("Studio Manifold mesh provider", () => {
  it("loads lazily, detaches both meshes, returns plain output, and deletes in reverse order", async () => {
    const fake = fakeRuntime();
    const gate = deferred<StudioManifoldRuntime>();
    const load = vi.fn(() => gate.promise);
    const provider = createStudioManifoldMeshProvider({
      epoch: 9,
      runtimeLoader: load,
    });
    const leftPositions = new Float32Array(TETRA_POSITIONS);
    const rightIndices = new Uint32Array(TETRA_INDICES);
    const expectedPositions = [...leftPositions];
    const expectedIndices = [...rightIndices];

    expect(load).not.toHaveBeenCalled();
    const pending = provider.boolean({
      left: tetraInput(leftPositions),
      right: tetraInput(TETRA_POSITIONS, rightIndices),
      operation: "union",
      epoch: 9,
    });
    leftPositions.fill(100);
    rightIndices.fill(0);
    gate.resolve(fake.runtime);
    const receipt = await pending;

    expect(fake.meshes[0]?.positions).toEqual(expectedPositions);
    expect(fake.meshes[1]?.triangleIndices).toEqual(expectedIndices);
    expect(receipt).toMatchObject({
      kind: "studio-manifold-mesh-receipt",
      revision: 1,
      providerId: "manifold-3d",
      runtimeVersion: "fake-manifold-3d-3.5.1",
      epoch: 9,
      sequence: 1,
      operation: "union",
      workUnits: 16,
      inputs: {
        left: { vertexCount: 4, triangleCount: 4 },
        right: { vertexCount: 4, triangleCount: 4 },
      },
      output: {
        mesh: { vertexCount: 4, triangleCount: 4 },
        topology: {
          status: "NoError",
          empty: false,
          genus: 0,
        },
      },
    });
    expect(receipt.inputs.left.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.output.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.output.mesh.positions).not.toBe(TETRA_POSITIONS);
    expect(structuredClone(receipt)).toEqual(receipt);
    expect(Object.values(receipt).includes(fake.result)).toBe(false);
    expect(fake.events).toEqual([
      "create:left",
      "create:right",
      "boolean:union",
      "delete:result",
      "delete:right",
      "delete:left",
    ]);
  });

  it.each(["union", "difference", "intersection"] as const)(
    "routes the %s operation through the injected adapter",
    async (operation) => {
      const fake = fakeRuntime();
      const provider = createStudioManifoldMeshProvider({
        runtimeLoader: () => fake.runtime,
      });
      const receipt = await provider.boolean({
        left: tetraInput(),
        right: tetraInput(),
        operation,
        epoch: 0,
      });
      expect(fake.runtime.boolean).toHaveBeenCalledWith(
        fake.left,
        fake.right,
        operation,
      );
      expect(receipt.operation).toBe(operation);
    },
  );

  it("rejects malformed geometry, epochs, and pre-aborted work before loading WASM", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const provider = createStudioManifoldMeshProvider({
      epoch: 3,
      runtimeLoader: load,
    });
    await expect(provider.boolean({
      left: tetraInput(
        [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0],
        TETRA_INDICES,
      ),
      right: tetraInput(),
      operation: "union",
      epoch: 3,
    })).rejects.toMatchObject({ code: "invalid-input-mesh" });
    await expect(provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "union",
      epoch: 2,
    })).rejects.toMatchObject({ code: "epoch-mismatch" });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "union",
      epoch: 3,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(load).not.toHaveBeenCalled();
  });

  it("fails closed on runtime status and deletes every created handle", async () => {
    const fake = fakeRuntime();
    vi.mocked(fake.runtime.status)
      .mockReturnValueOnce("NoError")
      .mockReturnValueOnce("NotManifold");
    const provider = createStudioManifoldMeshProvider({
      runtimeLoader: () => fake.runtime,
    });

    await expect(provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "difference",
      epoch: 0,
    })).rejects.toMatchObject({ code: "invalid-input-mesh" });
    expect(fake.runtime.boolean).not.toHaveBeenCalled();
    expect(fake.events).toEqual([
      "create:left",
      "create:right",
      "delete:right",
      "delete:left",
    ]);
  });

  it("rejects mismatched or malformed output while still deleting the result", async () => {
    const fake = fakeRuntime({
      getMesh: vi.fn(() => ({
        numProp: 3,
        vertProperties: new Float32Array(TETRA_POSITIONS),
        triangleIndices: Uint32Array.of(0, 1, 99),
      })),
    });
    const provider = createStudioManifoldMeshProvider({
      runtimeLoader: () => fake.runtime,
    });
    await expect(provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "intersection",
      epoch: 0,
    })).rejects.toMatchObject({ code: "invalid-runtime-output" });
    expect(fake.events.slice(-3)).toEqual([
      "delete:result",
      "delete:right",
      "delete:left",
    ]);
  });

  it("destroys the runtime once and rejects use after destroy", async () => {
    const fake = fakeRuntime();
    const provider = createStudioManifoldMeshProvider({
      runtimeLoader: () => fake.runtime,
    });
    await provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "union",
      epoch: 0,
    });
    await Promise.all([provider.destroy(), provider.destroy()]);
    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(provider.snapshot()).toMatchObject({
      state: "destroyed",
      runtimeLoaded: false,
      sequence: 1,
    });
    await expect(provider.boolean({
      left: tetraInput(),
      right: tetraInput(),
      operation: "union",
      epoch: 0,
    })).rejects.toBeInstanceOf(StudioManifoldMeshProviderError);
  });

  it("executes a real Manifold WASM union without exposing vendor handles", async () => {
    const factory = await import("manifold-3d");
    const wasmPath = new URL("../../../node_modules/manifold-3d/manifold.wasm",
      import.meta.url,
    ).pathname;
    const module = await factory.default({ locateFile: () => wasmPath });
    module.setup();
    const seed = module.Manifold.tetrahedron();
    const seedMesh = seed.getMesh();
    const input = tetraInput(
      new Float32Array(seedMesh.vertProperties),
      new Uint32Array(seedMesh.triVerts),
    );
    seed.delete();
    const provider = createStudioManifoldMeshProvider({
      runtimeLoader: () => createStudioManifoldRuntime(module),
    });

    const receipt = await provider.boolean({
      left: input,
      right: input,
      operation: "union",
      epoch: 0,
    });

    expect(receipt.output.topology.status).toBe("NoError");
    expect(receipt.output.mesh.vertexCount).toBeGreaterThanOrEqual(4);
    expect(receipt.output.mesh.triangleCount).toBeGreaterThanOrEqual(4);
    expect(structuredClone(receipt)).toEqual(receipt);
    await provider.destroy();
  });
});
