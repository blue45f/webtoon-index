import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createStudioXAtlasUvProvider,
  type StudioXAtlasUvRequest,
  type StudioXAtlasUvRuntime,
  type StudioXAtlasUvRuntimeAssets,
  type StudioXAtlasUvRuntimeAtlas,
  type StudioXAtlasUvRuntimeGeometry,
  type StudioXAtlasUvRuntimeMeshInput,
  type StudioXAtlasUvRuntimePackOptions,
} from "./studio-xatlas-uv-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface FakeRuntimeOptions {
  readonly initialize?: (
    assets: StudioXAtlasUvRuntimeAssets | null,
    progress: (mode: unknown, value: unknown) => void,
  ) => void | Promise<void>;
  readonly pack?: (
    geometries: readonly FakeGeometry[],
    options: StudioXAtlasUvRuntimePackOptions,
    progress: (mode: unknown, value: unknown) => void,
  ) => StudioXAtlasUvRuntimeAtlas | Promise<StudioXAtlasUvRuntimeAtlas>;
  readonly cleanup?: () => boolean | Promise<boolean>;
}

class FakeGeometry implements StudioXAtlasUvRuntimeGeometry {
  private released = false;

  constructor(
    readonly id: string,
    readonly input: StudioXAtlasUvRuntimeMeshInput,
    private readonly events: string[],
  ) {}

  release(): void {
    if (this.released) return;
    this.released = true;
    this.events.push(`release:${this.id}`);
  }
}

class FakeRuntime implements StudioXAtlasUvRuntime {
  readonly packageVersion = "0.2.0-fake";
  readonly events: string[] = [];
  readonly inputs: StudioXAtlasUvRuntimeMeshInput[] = [];
  lastOptions: StudioXAtlasUvRuntimePackOptions | null = null;
  lastAtlas: StudioXAtlasUvRuntimeAtlas | null = null;
  disposed = false;

  constructor(private readonly options: FakeRuntimeOptions = {}) {}

  async initialize(
    assets: StudioXAtlasUvRuntimeAssets | null,
    progress: (mode: unknown, value: unknown) => void,
  ): Promise<void> {
    this.events.push("initialize");
    progress("load", 25);
    await this.options.initialize?.(assets, progress);
  }

  createGeometry(mesh: StudioXAtlasUvRuntimeMeshInput): StudioXAtlasUvRuntimeGeometry {
    this.events.push(`create:${mesh.id}`);
    this.inputs.push(mesh);
    return new FakeGeometry(mesh.id, mesh, this.events);
  }

  async pack(
    geometries: readonly StudioXAtlasUvRuntimeGeometry[],
    options: StudioXAtlasUvRuntimePackOptions,
    progress: (mode: unknown, value: unknown) => void,
  ): Promise<StudioXAtlasUvRuntimeAtlas> {
    this.events.push("pack");
    this.lastOptions = options;
    const fakeGeometries = geometries.map((geometry) => {
      if (!(geometry instanceof FakeGeometry)) throw new TypeError("foreign fake geometry");
      return geometry;
    });
    progress("generate", 1);
    const atlas = await this.options.pack?.(fakeGeometries, options, progress)
      ?? defaultAtlas(fakeGeometries, options);
    this.lastAtlas = atlas;
    return atlas;
  }

  async cleanupAtlas(): Promise<boolean> {
    this.events.push("cleanup-atlas");
    return await this.options.cleanup?.() ?? true;
  }

  dispose(): void {
    this.disposed = true;
    this.events.push("dispose");
  }
}

function defaultAtlas(
  geometries: readonly FakeGeometry[],
  options: StudioXAtlasUvRuntimePackOptions,
): StudioXAtlasUvRuntimeAtlas {
  return {
    width: 128,
    height: 64,
    atlasCount: 1,
    meshCount: geometries.length,
    texelsPerUnit: options.pack.texelsPerUnit ?? 16,
    meshes: geometries.map((geometry) => {
      const vertexCount = geometry.input.positions.length / 3;
      const uv = new Float32Array(vertexCount * 2);
      for (let index = 0; index < vertexCount; index += 1) {
        uv[index * 2] = index / Math.max(1, vertexCount - 1);
        uv[index * 2 + 1] = index % 2;
      }
      return {
        id: geometry.id,
        positions: new Float32Array(geometry.input.positions),
        uv,
        indices: new Uint32Array(geometry.input.indices),
        atlasSegments: [{
          index: 0,
          count: geometry.input.indices.length,
          atlasIndex: 0,
        }],
      };
    }),
  };
}

function triangle(
  id = "mesh-a",
  offset = 0,
): StudioXAtlasUvRequest["meshes"][number] {
  return {
    id,
    positions: new Float32Array([
      offset, 0, 0,
      offset + 1, 0, 0,
      offset, 1, 0,
    ]),
    indices: new Uint16Array([0, 1, 2]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
  };
}

function request(
  meshes: readonly StudioXAtlasUvRequest["meshes"][number][] = [triangle()],
): StudioXAtlasUvRequest {
  return {
    operation: "unwrap-atlas",
    requestEpoch: 1,
    documentEpoch: 7,
    meshes,
    options: {
      resolution: 512,
      padding: 4,
      rotateCharts: false,
      texelsPerUnit: 32,
      useNormals: true,
      chart: {
        fixWinding: true,
        maxIterations: 8,
        straightnessWeight: 3,
        useInputMeshUvs: true,
      },
    },
  };
}

function providerWith(
  runtime: FakeRuntime,
  overrides: Partial<Parameters<typeof createStudioXAtlasUvProvider>[0]> = {},
) {
  return createStudioXAtlasUvProvider({
    requestEpoch: 1,
    documentEpoch: 7,
    runtimeLoader: () => runtime,
    ...overrides,
  });
}

describe("StudioXAtlasUvProvider", () => {
  it("returns a frozen, aggregated multi-mesh atlas while preserving caller arrays", async () => {
    const runtime = new FakeRuntime();
    const meshA = triangle("mesh-a");
    const meshB = triangle("mesh-b", 10);
    const originalA = new Float32Array(meshA.positions);
    const progress = vi.fn();
    const provider = providerWith(runtime);

    const result = await provider.execute(request([meshA, meshB]), { onProgress: progress });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.positions).toHaveLength(18);
    expect([...result.artifact.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.artifact.meshes).toEqual([
      expect.objectContaining({
        id: "mesh-a",
        sourceVertexCount: 3,
        vertexOffset: 0,
        vertexCount: 3,
        indexOffset: 0,
        indexCount: 3,
      }),
      expect.objectContaining({
        id: "mesh-b",
        sourceVertexCount: 3,
        vertexOffset: 3,
        vertexCount: 3,
        indexOffset: 3,
        indexCount: 3,
      }),
    ]);
    expect(result.artifact.meshes[1]?.atlasSegments).toEqual([{
      indexOffset: 3,
      indexCount: 3,
      atlasIndex: 0,
    }]);
    expect(result.artifact.atlas).toEqual({
      width: 128,
      height: 64,
      count: 1,
      texelsPerUnit: 32,
    });
    expect(result.artifact.receipt).toMatchObject({
      packageName: "xatlasjs",
      runtimeSource: "injected",
      intendedHost: "dedicated-worker",
      executionTopology: "single-dedicated-worker",
      originalInputPreserved: true,
      nativeHandlesReturned: false,
      mainThreadFallback: false,
    });
    expect(Object.isFrozen(result.artifact)).toBe(true);
    expect(Object.isFrozen(result.artifact.meshes)).toBe(true);
    expect(Object.isFrozen(result.artifact.atlas)).toBe(true);
    expect(Object.isFrozen(result.artifact.receipt)).toBe(true);
    expect(progress.mock.calls).toEqual([
      [{ sequence: 1, mode: "load", progress: 0.25 }],
      [{ sequence: 2, mode: "generate", progress: 1 }],
    ]);
    expect(runtime.inputs[0]?.positions).not.toBe(meshA.positions);
    expect(runtime.inputs[0]?.indices).not.toBe(meshA.indices);
    expect(meshA.positions).toEqual(originalA);
    expect(runtime.lastOptions).toEqual({
      pack: {
        resolution: 512,
        padding: 4,
        rotateCharts: false,
        texelsPerUnit: 32,
        createImage: false,
        bruteForce: false,
      },
      chart: {
        fixWinding: true,
        maxIterations: 8,
        straightnessWeight: 3,
        useInputMeshUvs: true,
      },
      useNormals: true,
    });
    const runtimePosition = runtime.lastAtlas?.meshes[0]?.positions;
    if (runtimePosition instanceof Float32Array) runtimePosition[0] = 999;
    expect(result.artifact.positions[0]).toBe(0);
    expect(runtime.events).toEqual([
      "initialize",
      "create:mesh-a",
      "create:mesh-b",
      "pack",
      "cleanup-atlas",
      "release:mesh-b",
      "release:mesh-a",
    ]);
  });

  it("rejects malformed and over-budget inputs before loading xatlas", async () => {
    const runtime = new FakeRuntime();
    const loader = vi.fn(() => runtime);
    const provider = createStudioXAtlasUvProvider({
      requestEpoch: 1,
      documentEpoch: 7,
      runtimeLoader: loader,
      limits: {
        maxMeshes: 1,
        maxVerticesPerMesh: 3,
        maxVertices: 3,
        maxTriangles: 1,
        maxInputBytes: 128,
      },
    });

    await expect(provider.execute({
      ...request(),
      options: { bruteForce: true },
    })).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    await expect(provider.execute(request([triangle("a"), triangle("b")])))
      .resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    await expect(provider.execute(request([{
      ...triangle(),
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0,
      ]),
      indices: new Uint16Array([0, 1, 2, 1, 3, 2]),
      normals: undefined,
      uv: undefined,
    }]))).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });
    await expect(provider.execute(request([{
      ...triangle(),
      indices: new Uint16Array([0, 1, 9]),
    }]))).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("retries lazy runtime initialization after a transient loader failure", async () => {
    const runtime = new FakeRuntime();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(runtime);
    const provider = createStudioXAtlasUvProvider({
      requestEpoch: 1,
      documentEpoch: 7,
      runtimeLoader: loader,
    });

    await expect(provider.execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "provider-unavailable",
    });
    await expect(provider.execute(request())).resolves.toMatchObject({
      ok: true,
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("disposes a partially initialized runtime and waits for active packing before disposal", async () => {
    const partial = new FakeRuntime({
      initialize: async () => {
        throw new Error("initialize failed");
      },
    });
    const recovered = new FakeRuntime();
    const loader = vi.fn()
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(recovered);
    const provider = createStudioXAtlasUvProvider({
      requestEpoch: 1,
      documentEpoch: 7,
      runtimeLoader: loader,
    });
    await expect(provider.execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "provider-unavailable",
    });
    expect(partial.disposed).toBe(true);
    await expect(provider.execute(request())).resolves.toMatchObject({ ok: true });

    const packGate = deferred<StudioXAtlasUvRuntimeAtlas>();
    const activeRuntime = new FakeRuntime({
      pack: async () => packGate.promise,
    });
    const activeProvider = providerWith(activeRuntime);
    const execution = activeProvider.execute(request());
    await vi.waitFor(() => expect(activeRuntime.events).toContain("pack"));
    const disposal = activeProvider.dispose();
    await Promise.resolve();
    expect(activeRuntime.disposed).toBe(false);
    packGate.resolve(defaultAtlas(
      activeRuntime.inputs.map(
        (input) => new FakeGeometry(input.id, input, activeRuntime.events),
      ),
      {
        pack: {
          resolution: 512,
          padding: 4,
          rotateCharts: false,
          texelsPerUnit: 32,
          createImage: false,
          bruteForce: false,
        },
        chart: {},
        useNormals: true,
      },
    ));
    await execution;
    await disposal;
    expect(activeRuntime.disposed).toBe(true);
    expect(activeRuntime.events.indexOf("dispose"))
      .toBeGreaterThan(activeRuntime.events.indexOf("cleanup-atlas"));
  });

  it("validates runtime output shape, indices, atlas metadata, and output budgets", async () => {
    const cases: Array<{
      mutate: (atlas: StudioXAtlasUvRuntimeAtlas) => StudioXAtlasUvRuntimeAtlas;
      reason: string;
    }> = [
      {
        mutate: (atlas) => ({
          ...atlas,
          meshes: [{ ...atlas.meshes[0]!, uv: new Float32Array([0, 0]) }],
        }),
        reason: "invalid-provider-output",
      },
      {
        mutate: (atlas) => ({
          ...atlas,
          meshes: [{ ...atlas.meshes[0]!, indices: new Uint32Array([0, 1, 99]) }],
        }),
        reason: "invalid-provider-output",
      },
      {
        mutate: (atlas) => ({ ...atlas, width: 99_999 }),
        reason: "invalid-provider-output",
      },
    ];
    for (const testCase of cases) {
      const runtime = new FakeRuntime({
        pack: (geometries, options) => testCase.mutate(defaultAtlas(geometries, options)),
      });
      await expect(providerWith(runtime).execute(request())).resolves.toMatchObject({
        ok: false,
        reason: testCase.reason,
      });
      expect(runtime.events.slice(-2)).toEqual(["cleanup-atlas", "release:mesh-a"]);
    }

    const outputBudgetRuntime = new FakeRuntime();
    await expect(providerWith(outputBudgetRuntime, {
      limits: { maxOutputBytes: 1 },
    }).execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
  });

  it("releases all geometry handles in reverse order after runtime and cleanup failures", async () => {
    const operationFailure = new FakeRuntime({
      pack: async () => {
        throw new Error("native failure");
      },
    });
    await expect(providerWith(operationFailure).execute(
      request([triangle("a"), triangle("b")]),
    )).resolves.toMatchObject({ ok: false, reason: "provider-failure" });
    expect(operationFailure.events.slice(-3)).toEqual([
      "cleanup-atlas",
      "release:b",
      "release:a",
    ]);

    const cleanupFailure = new FakeRuntime({ cleanup: () => false });
    await expect(providerWith(cleanupFailure).execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "cleanup-failure",
    });
    expect(cleanupFailure.events.at(-1)).toBe("release:mesh-a");
  });

  it("enforces cancellation, request/document epochs, backpressure, and stale completion", async () => {
    let resolveAtlas!: (atlas: StudioXAtlasUvRuntimeAtlas) => void;
    let deferredGeometries: readonly FakeGeometry[] = [];
    let deferredOptions: StudioXAtlasUvRuntimePackOptions | null = null;
    const runtime = new FakeRuntime({
      pack: (geometries, options) => {
        deferredGeometries = geometries;
        deferredOptions = options;
        return new Promise((resolve) => {
          resolveAtlas = resolve;
        });
      },
    });
    const provider = providerWith(runtime);
    const first = provider.execute(request());
    await vi.waitFor(() => expect(runtime.events).toContain("pack"));
    await expect(provider.execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "backpressure",
    });
    expect(provider.advanceEpochs(2, 7)).toBe(true);
    resolveAtlas(defaultAtlas(deferredGeometries, deferredOptions!));
    await expect(first).resolves.toMatchObject({
      ok: false,
      reason: "stale-request-epoch",
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.execute({
      ...request(),
      requestEpoch: 2,
    }, { signal: aborted.signal })).resolves.toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    await expect(provider.execute({
      ...request(),
      requestEpoch: 2,
      documentEpoch: 6,
    })).resolves.toMatchObject({
      ok: false,
      reason: "stale-document-epoch",
    });
  });

  it("fails closed on progress and elapsed-time budgets", async () => {
    const progressRuntime = new FakeRuntime({
      pack: (geometries, options, progress) => {
        progress("chart", 0.2);
        progress("pack", 0.8);
        return defaultAtlas(geometries, options);
      },
    });
    await expect(providerWith(progressRuntime, {
      limits: { maxProgressEvents: 2 },
    }).execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "progress-budget-exceeded",
    });

    const clock = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValue(100);
    await expect(providerWith(new FakeRuntime(), {
      limits: { maxExecutionMs: 10 },
      now: clock,
    }).execute(request())).resolves.toMatchObject({
      ok: false,
      reason: "time-budget-exceeded",
    });
  });

  it("keeps source boundaries dynamic, local-only, renderer-neutral, and no-fallback", () => {
    const providerSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider.ts", import.meta.url)),
      "utf8",
    );
    const runtimeSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider-runtime.ts", import.meta.url)),
      "utf8",
    );
    const clientSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider-worker-client.ts", import.meta.url)),
      "utf8",
    );
    expect(providerSource).toContain(
      'import("./studio-xatlas-uv-provider-runtime")',
    );
    expect(runtimeSource).toContain("await import(/* @vite-ignore */ moduleUrl)");
    expect(runtimeSource).toContain('"xatlasjs/dist/xatlas.wasm?url"');
    expect(runtimeSource).toContain('"xatlasjs/dist/xatlas.js?url"');
    expect(runtimeSource).not.toMatch(/cdn|jsdelivr|unpkg/i);
    expect(runtimeSource).toContain("destroyAtlas");
    expect(runtimeSource).toContain("No nested Worker exists");
    expect(runtimeSource).not.toMatch(/\bnew Worker\s*\(/);
    expect(clientSource).toContain(
      'new Worker(new URL("./studio-xatlas-uv-provider.worker.ts"',
    );
    expect(clientSource).not.toMatch(/import\(["'](?:xatlas-three|xatlasjs|three)["']\)/);
    expect(clientSource).toContain("mainThreadFallback: false");
    expect(providerSource).not.toMatch(/\bKonva\b|react-konva|WebGLRenderer|WebGPURenderer/);
  });

  it("smokes the direct xatlasjs adapter plus local WASM and explicit destroyAtlas lifecycle", async () => {
    const productionAdapter = await import("./studio-xatlas-uv-provider-runtime");
    const productionRuntime = productionAdapter.createStudioXAtlasUvProductionRuntime();
    expect(productionRuntime.packageVersion).toBe("0.2.0");
    await productionRuntime.dispose();

    const apiSpecifier = "xatlasjs/dist/node/api.mjs";
    const moduleSpecifier = "xatlasjs/dist/node/xatlas.js";
    const apiModule = await import(apiSpecifier) as unknown;
    const xatlasModule = await import(moduleSpecifier) as unknown;
    if (typeof apiModule !== "object" || apiModule === null) {
      throw new TypeError("xatlasjs node API module is unavailable");
    }
    const apiFactory = Reflect.get(apiModule, "Api") as unknown;
    if (typeof apiFactory !== "function") {
      throw new TypeError("xatlasjs node API factory is unavailable");
    }
    const moduleFactory = (
      typeof xatlasModule === "object"
      && xatlasModule !== null
      && "default" in xatlasModule
    ) ? xatlasModule.default : xatlasModule;
    if (typeof moduleFactory !== "function") {
      throw new TypeError("xatlasjs WASM module factory is unavailable");
    }
    const apiConstructor = Reflect.apply(apiFactory, undefined, [moduleFactory]) as unknown;
    if (typeof apiConstructor !== "function") {
      throw new TypeError("xatlasjs API constructor is unavailable");
    }
    const wasmPath = fileURLToPath(
      new URL("../../../node_modules/xatlasjs/dist/node/xatlas.wasm", import.meta.url),
    );
    const api = await new Promise<object>((resolve, reject) => {
      const holder: { instance: object | null } = { instance: null };
      const timer = setTimeout(() => reject(new Error("xatlasjs smoke timed out")), 10_000);
      const onLoad = (): void => {
        clearTimeout(timer);
        if (holder.instance === null) {
          reject(new Error("xatlasjs loaded before its API object was constructed"));
          return;
        }
        resolve(holder.instance);
      };
      holder.instance = Reflect.construct(apiConstructor, [
        onLoad,
        () => wasmPath,
        () => undefined,
      ]) as object;
    });
    const invoke = (name: string, args: readonly unknown[] = []): unknown => {
      const method = Reflect.get(api, name) as unknown;
      if (typeof method !== "function") throw new TypeError(`xatlasjs ${name} is unavailable`);
      return Reflect.apply(method, api, args);
    };
    invoke("createAtlas");
    try {
      const added = invoke("addMesh", [
        new Uint16Array([0, 1, 2]),
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        null,
        null,
        "triangle",
        false,
        false,
        1,
      ]);
      expect(added).not.toBeNull();
      const atlas = invoke("generateAtlas", [
        {},
        {
          resolution: 64,
          padding: 1,
          createImage: false,
          bruteForce: false,
          rotateCharts: true,
        },
        true,
      ]);
      expect(atlas).toMatchObject({
        atlasCount: 1,
        meshCount: 1,
      });
    } finally {
      invoke("destroyAtlas");
    }
  }, 20_000);
});
