import { describe, expect, it, vi } from "vitest";

import {
  createStudioGltfTransformProvider,
  STUDIO_GLTF_TRANSFORM_BUDGETS,
  StudioGltfTransformProviderError,
  type StudioGltfTransformRuntime,
  type StudioGltfTransformStats,
} from "./studio-gltf-transform-provider";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function glb(json: Record<string, unknown> = {
  asset: { version: "2.0" },
}): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20);
  output.set(encoded, 20);
  return output;
}

const EMPTY_STATS: StudioGltfTransformStats = {
  scenes: 1,
  nodes: 0,
  meshes: 0,
  primitives: 0,
  materials: 0,
  textures: 0,
  animations: 0,
  accessors: 0,
  accessorElements: 0,
  textureBytes: 0,
  buffers: 0,
  skins: 0,
  cameras: 0,
};

function fakeRuntime(
  overrides: Partial<StudioGltfTransformRuntime> = {},
) {
  const events: string[] = [];
  const document = { kind: "fake-document" };
  const output = glb({ asset: { version: "2.0", generator: "fake" } });
  const inputs: number[][] = [];
  const runtime: StudioGltfTransformRuntime = {
    version: "fake-gltf-transform-4.4.2",
    readBinary: vi.fn(async (bytes) => {
      events.push("read");
      inputs.push([...bytes]);
      return document;
    }),
    inspectDocument: vi.fn(() => EMPTY_STATS),
    transform: vi.fn(async (_document, operation) => {
      events.push(`transform:${operation.kind}`);
    }),
    writeBinary: vi.fn(async () => {
      events.push("write");
      return output;
    }),
    destroyDocument: vi.fn(() => events.push("destroy:document")),
    destroy: vi.fn(() => {
      events.push("destroy:runtime");
    }),
    ...overrides,
  };
  return { runtime, document, output, inputs, events };
}

describe("Studio glTF Transform provider", () => {
  it("rejects accessor-backed request fields without invoking them or loading runtime", async () => {
    const getter = vi.fn(() => {
      throw new Error("must not run");
    });
    const load = vi.fn(() => fakeRuntime().runtime);
    const provider = createStudioGltfTransformProvider({ runtimeLoader: load });
    const request = { epoch: 0 } as Record<string, unknown>;
    Object.defineProperty(request, "glb", { enumerable: true, get: getter });

    await expect(provider.transform(request as never)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed operation slots and nested fields without invoking them", async () => {
    const slotGetter = vi.fn(() => ({ kind: "dedup" }));
    const fieldGetter = vi.fn(() => "dedup");
    const operations: unknown[] = [];
    Object.defineProperty(operations, "0", {
      enumerable: true,
      configurable: true,
      get: slotGetter,
    });
    operations.length = 1;
    const load = vi.fn(() => fakeRuntime().runtime);
    const provider = createStudioGltfTransformProvider({ runtimeLoader: load });
    await expect(provider.transform({
      glb: glb(),
      epoch: 0,
      operations: operations as never,
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(slotGetter).not.toHaveBeenCalled();

    const operation = {} as Record<string, unknown>;
    Object.defineProperty(operation, "kind", {
      enumerable: true,
      get: fieldGetter,
    });
    await expect(provider.transform({
      glb: glb(),
      epoch: 0,
      operations: [operation] as never,
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(fieldGetter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads lazily, detaches GLB input, runs the bounded subset, and emits plain copied output", async () => {
    const fake = fakeRuntime();
    const gate = deferred<StudioGltfTransformRuntime>();
    const load = vi.fn(() => gate.promise);
    const provider = createStudioGltfTransformProvider({
      epoch: 7,
      runtimeLoader: load,
    });
    const source = glb();
    const expectedInput = [...source];

    expect(load).not.toHaveBeenCalled();
    const pending = provider.transform({
      glb: source,
      epoch: 7,
      operations: [
        { kind: "dedup", keepUniqueNames: true },
        { kind: "prune", keepExtras: true },
        { kind: "flatten", cleanup: false },
        { kind: "center", pivot: [1, 2, 3] },
      ],
    });
    source.fill(0);
    gate.resolve(fake.runtime);
    const receipt = await pending;

    expect(fake.inputs[0]).toEqual(expectedInput);
    expect(fake.runtime.transform).toHaveBeenNthCalledWith(
      1,
      fake.document,
      { kind: "dedup", keepUniqueNames: true },
    );
    expect(fake.runtime.transform).toHaveBeenNthCalledWith(
      2,
      fake.document,
      {
        kind: "prune",
        keepLeaves: false,
        keepAttributes: false,
        keepSolidTextures: false,
        keepExtras: true,
      },
    );
    expect(fake.runtime.transform).toHaveBeenNthCalledWith(
      3,
      fake.document,
      { kind: "flatten", cleanup: false },
    );
    expect(fake.runtime.transform).toHaveBeenNthCalledWith(
      4,
      fake.document,
      { kind: "center", pivot: [1, 2, 3] },
    );
    expect(receipt).toMatchObject({
      kind: "studio-gltf-transform-receipt",
      revision: 1,
      providerId: "gltf-transform",
      runtimeVersion: "fake-gltf-transform-4.4.2",
      epoch: 7,
      sequence: 1,
      input: { byteLength: expectedInput.length },
      output: { byteLength: fake.output.byteLength },
      before: EMPTY_STATS,
      after: EMPTY_STATS,
    });
    expect(receipt.input.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.output.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.output.glb).not.toBe(fake.output);
    const outputSnapshot = [...receipt.output.glb];
    fake.output.fill(0);
    expect([...receipt.output.glb]).toEqual(outputSnapshot);
    expect(structuredClone(receipt)).toEqual(receipt);
    expect(fake.events).toEqual([
      "read",
      "transform:dedup",
      "transform:prune",
      "transform:flatten",
      "transform:center",
      "write",
      "destroy:document",
    ]);
  });

  it("rejects malformed GLB, duplicate transforms, epoch mismatch, and abort before loading", async () => {
    const fake = fakeRuntime();
    const load = vi.fn(() => fake.runtime);
    const provider = createStudioGltfTransformProvider({
      epoch: 4,
      runtimeLoader: load,
    });
    const malformed = glb();
    new DataView(malformed.buffer).setUint32(8, malformed.byteLength + 4, true);

    await expect(provider.transform({
      glb: malformed,
      epoch: 4,
    })).rejects.toMatchObject({ code: "invalid-glb" });
    await expect(provider.transform({
      glb: glb(),
      epoch: 4,
      operations: [{ kind: "dedup" }, { kind: "dedup" }],
    })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(provider.transform({
      glb: glb(),
      epoch: 3,
    })).rejects.toMatchObject({ code: "epoch-mismatch" });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.transform({
      glb: glb(),
      epoch: 4,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(load).not.toHaveBeenCalled();
  });

  it("enforces document budgets before transforms and cleans the parsed document", async () => {
    const fake = fakeRuntime({
      inspectDocument: vi.fn(() => ({
        ...EMPTY_STATS,
        nodes: STUDIO_GLTF_TRANSFORM_BUDGETS.maxNodes + 1,
      })),
    });
    const provider = createStudioGltfTransformProvider({
      runtimeLoader: () => fake.runtime,
    });

    await expect(provider.transform({
      glb: glb(),
      epoch: 0,
      operations: [{ kind: "prune" }],
    })).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(fake.runtime.transform).not.toHaveBeenCalled();
    expect(fake.runtime.destroyDocument).toHaveBeenCalledWith(fake.document);
  });

  it("cleans the Document on transform/write failures and rejects malformed runtime output", async () => {
    const transformFailure = fakeRuntime({
      transform: vi.fn(async () => {
        throw new Error("fake transform failure");
      }),
    });
    const transformProvider = createStudioGltfTransformProvider({
      runtimeLoader: () => transformFailure.runtime,
    });
    await expect(transformProvider.transform({
      glb: glb(),
      epoch: 0,
      operations: [{ kind: "dedup" }],
    })).rejects.toMatchObject({ code: "runtime-failed" });
    expect(transformFailure.runtime.destroyDocument).toHaveBeenCalledWith(
      transformFailure.document,
    );

    const malformedOutput = fakeRuntime({
      writeBinary: vi.fn(async () => Uint8Array.of(1, 2, 3)),
    });
    const malformedProvider = createStudioGltfTransformProvider({
      runtimeLoader: () => malformedOutput.runtime,
    });
    await expect(malformedProvider.transform({
      glb: glb(),
      epoch: 0,
    })).rejects.toMatchObject({ code: "invalid-glb" });
    expect(malformedOutput.runtime.destroyDocument).toHaveBeenCalledWith(
      malformedOutput.document,
    );
  });

  it("applies single-operation backpressure while a read is pending", async () => {
    const readGate = deferred<unknown>();
    const fake = fakeRuntime({
      readBinary: vi.fn(() => readGate.promise),
    });
    const provider = createStudioGltfTransformProvider({
      runtimeLoader: () => fake.runtime,
    });
    const first = provider.transform({ glb: glb(), epoch: 0 });
    await vi.waitFor(() => {
      expect(fake.runtime.readBinary).toHaveBeenCalledTimes(1);
    });
    await expect(provider.transform({
      glb: glb(),
      epoch: 0,
    })).rejects.toMatchObject({ code: "backpressure" });
    readGate.resolve(fake.document);
    await expect(first).resolves.toMatchObject({ sequence: 1 });
  });

  it("destroys once after admitted work and rejects subsequent requests", async () => {
    const fake = fakeRuntime();
    const provider = createStudioGltfTransformProvider({
      runtimeLoader: () => fake.runtime,
    });
    await provider.transform({ glb: glb(), epoch: 0 });
    await Promise.all([provider.destroy(), provider.destroy()]);

    expect(fake.runtime.destroy).toHaveBeenCalledTimes(1);
    expect(provider.snapshot()).toMatchObject({
      state: "destroyed",
      runtimeLoaded: false,
      sequence: 1,
    });
    await expect(provider.transform({
      glb: glb(),
      epoch: 0,
    })).rejects.toBeInstanceOf(StudioGltfTransformProviderError);
  });

  it("round-trips an installed WebIO GLB through dedup and prune", async () => {
    const core = await import("@gltf-transform/core");
    const sourceDocument = new core.Document();
    sourceDocument.createScene("Scene");
    const io = new core.WebIO();
    const source = await io.writeBinary(sourceDocument);
    const provider = createStudioGltfTransformProvider();

    const receipt = await provider.transform({
      glb: source,
      epoch: 0,
      operations: [{ kind: "dedup" }, { kind: "prune" }],
    });

    expect(receipt.before.scenes).toBe(1);
    expect(receipt.after.scenes).toBe(1);
    expect(receipt.output.glb.byteLength).toBeGreaterThanOrEqual(20);
    expect(structuredClone(receipt)).toEqual(receipt);
    await expect(io.readBinary(receipt.output.glb)).resolves.toBeDefined();
    await provider.destroy();
  });
});
