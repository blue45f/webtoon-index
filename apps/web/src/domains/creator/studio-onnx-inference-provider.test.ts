import { describe, expect, it, vi } from "vitest";

import {
  createStudioOnnxInferenceProvider,
  resolveStudioOnnxModelUrl,
  studioOnnxLogitsToUint8Mask,
  type StudioOnnxRuntime,
} from "./studio-onnx-inference-provider";
import {
  createStudioOnnxModelRegistry,
  type StudioOnnxModelDescriptor,
} from "./studio-onnx-model-registry";
import { sha256HexPortable } from "./studio-sha256";

const MODEL_BYTES = Uint8Array.of(1, 3, 3, 7);

function descriptor(
  id = "selection-mask",
  bytes = MODEL_BYTES,
  byteBudget = 1_024,
): StudioOnnxModelDescriptor {
  return {
    id,
    version: "1.0.0",
    sha256: `sha256:${sha256HexPortable(bytes)}`,
    byteBudget,
    inputs: [
      {
        name: "pixels",
        elementType: "float32",
        shape: [1, 2],
      },
    ],
    outputs: [
      {
        name: "mask",
        elementType: "float32",
        shape: [1, 2],
      },
    ],
  };
}

class FakeTensor {
  readonly location = "cpu";
  readonly dispose = vi.fn();
  readonly getData = vi.fn(async () => this.data);

  constructor(
    readonly type: string,
    readonly data:
      | Float32Array
      | Float64Array
      | Int8Array
      | Uint8Array
      | Int16Array
      | Uint16Array
      | Int32Array
      | Uint32Array,
    readonly dims: readonly number[],
  ) {}
}

class FakeSession {
  readonly inputNames: readonly string[] = ["pixels"];
  readonly outputNames: readonly string[] = ["mask"];
  readonly inputMetadata: readonly unknown[] = [];
  readonly outputMetadata: readonly unknown[] = [];
  readonly release = vi.fn(async () => undefined);
  readonly startProfiling = vi.fn();
  readonly endProfiling = vi.fn();
  readonly run = vi.fn();
}

function fakeRuntime(
  create: (...args: readonly unknown[]) => Promise<FakeSession>,
) {
  const createSpy = vi.fn(create);
  const constructedTensors: FakeTensor[] = [];

  class RuntimeTensor extends FakeTensor {
    constructor(
      type: string,
      data: FakeTensor["data"],
      dims: readonly number[],
    ) {
      super(type, data, dims);
      constructedTensors.push(this);
    }
  }

  return {
    createSpy,
    constructedTensors,
    runtime: {
      InferenceSession: { create: createSpy },
      Tensor: RuntimeTensor,
    } as unknown as StudioOnnxRuntime,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const EPOCH = Object.freeze({ request: 1, stroke: 2, document: 3 });

function inferenceInputs() {
  return [
    {
      name: "pixels",
      elementType: "float32" as const,
      dims: [1, 2],
      data: new Float32Array([0.25, 0.75]),
    },
  ];
}

describe("Studio ONNX model registry", () => {
  it("deep-freezes and deterministically sorts validated plain-data descriptors", () => {
    const beta = descriptor("beta");
    const alpha = descriptor("alpha");
    const registry = createStudioOnnxModelRegistry([beta, alpha]);

    expect(registry.models.map(({ id }) => id)).toEqual(["alpha", "beta"]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.models)).toBe(true);
    expect(Object.isFrozen(registry.models[0].inputs[0].shape)).toBe(true);
  });

  it("rejects duplicate identities and malformed integrity metadata", () => {
    expect(() =>
      createStudioOnnxModelRegistry([descriptor(), descriptor()]),
    ).toThrow(/Duplicate ONNX model/u);
    expect(() =>
      createStudioOnnxModelRegistry([
        {
          ...descriptor(),
          sha256: "sha256:not-a-digest",
        },
      ]),
    ).toThrow(/lowercase sha256/u);
  });
});

describe("Studio ONNX inference provider", () => {
  it("rejects accessor-backed input slots without invoking them", async () => {
    const getter = vi.fn(() => inferenceInputs()[0]);
    const inputs: unknown[] = [];
    Object.defineProperty(inputs, "0", {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    inputs.length = 1;
    const fixture = fakeRuntime(async () => new FakeSession());
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => fixture.runtime,
      initialEpoch: EPOCH,
    });
    await expect(provider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      epoch: EPOCH,
      inputs: inputs as never,
    })).rejects.toMatchObject({ code: "invalid-input" });
    expect(getter).not.toHaveBeenCalled();
    expect(fixture.createSpy).not.toHaveBeenCalled();
  });

  it("uses a cached WebGPU session, copies output buffers, and disposes owned tensors", async () => {
    const session = new FakeSession();
    const runtimeOutputData = new Float32Array([0.1, 0.9]);
    const runtimeOutputs: FakeTensor[] = [];
    session.run.mockImplementation(async () => {
      const output = new FakeTensor("float32", runtimeOutputData, [1, 2]);
      runtimeOutputs.push(output);
      return { mask: output };
    });
    const fixture = fakeRuntime(async () => session);
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => fixture.runtime,
      webGpuApiAvailable: () => true,
      initialEpoch: EPOCH,
    });

    const mutableInputs = inferenceInputs();
    const firstPending = provider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      epoch: EPOCH,
      inputs: mutableInputs,
    });
    mutableInputs[0]!.data.fill(99);
    const first = await firstPending;
    expect(first.receipt).toEqual({
      providerId: "onnxruntime-web",
      runtimeVersion: "1.27.0",
      model: {
        id: "selection-mask",
        version: "1.0.0",
        sha256: `sha256:${sha256HexPortable(MODEL_BYTES)}`,
        byteLength: MODEL_BYTES.byteLength,
      },
      selectedExecutionProvider: "webgpu",
      attemptedExecutionProviders: ["webgpu"],
      activeExecutionProvider: "webgpu",
      attemptCount: 1,
      failureIsolation: "fail-closed",
    });
    expect(fixture.createSpy).toHaveBeenCalledTimes(1);
    expect(fixture.createSpy.mock.calls[0][1]).toMatchObject({
      executionProviders: [{ name: "webgpu", validationMode: "basic" }],
      graphOptimizationLevel: "all",
      executionMode: "sequential",
    });
    const copied = first.outputs.mask.data as Float32Array;
    expect(copied).toEqual(runtimeOutputData);
    expect(copied).not.toBe(runtimeOutputData);
    copied[0] = 99;
    expect(runtimeOutputData[0]).toBeCloseTo(0.1);
    expect(runtimeOutputs[0].dispose).toHaveBeenCalledTimes(1);
    expect(fixture.constructedTensors[0].dispose).toHaveBeenCalledTimes(1);
    expect(fixture.constructedTensors[0].data).toEqual(
      new Float32Array([0.25, 0.75]),
    );

    await provider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      epoch: EPOCH,
      inputs: inferenceInputs(),
    });
    expect(fixture.createSpy).toHaveBeenCalledTimes(1);
    expect(session.run).toHaveBeenCalledTimes(2);

    await provider.dispose();
    await provider.dispose();
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("fails closed after one selected WebGPU session attempt", async () => {
    const fixture = fakeRuntime(async () => {
      throw new Error("adapter unavailable");
    });
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => fixture.runtime,
      webGpuApiAvailable: () => true,
    });
    await expect(provider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    })).rejects.toMatchObject({ code: "session-create-failed" });
    expect(fixture.createSpy).toHaveBeenCalledTimes(1);

    const noGpuFixture = fakeRuntime(async () => new FakeSession());
    const noGpuProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => noGpuFixture.runtime,
      webGpuApiAvailable: () => false,
    });
    await expect(noGpuProvider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    })).rejects.toMatchObject({ code: "session-create-failed" });
    expect(noGpuFixture.createSpy).not.toHaveBeenCalled();
  });

  it("uses WASM only when it was selected before model loading", async () => {
    const wasmSession = new FakeSession();
    const fixture = fakeRuntime(async () => wasmSession);
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      executionProvider: "wasm",
      loadRuntime: async () => fixture.runtime,
      webGpuApiAvailable: () => false,
    });
    const receipt = await provider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    });
    expect(receipt).toMatchObject({
      selectedExecutionProvider: "wasm",
      attemptedExecutionProviders: ["wasm"],
      activeExecutionProvider: "wasm",
      attemptCount: 1,
      failureIsolation: "fail-closed",
    });
    expect(fixture.createSpy).toHaveBeenCalledTimes(1);
    expect(fixture.createSpy.mock.calls[0][1]).toMatchObject({
      executionProviders: ["wasm"],
    });
  });

  it("fails closed and disposes late output when any request, stroke, or document epoch becomes stale", async () => {
    const session = new FakeSession();
    const pendingRun = deferred<Record<string, FakeTensor>>();
    session.run.mockReturnValue(pendingRun.promise);
    const fixture = fakeRuntime(async () => session);
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => fixture.runtime,
      webGpuApiAvailable: () => true,
      initialEpoch: EPOCH,
    });

    const pending = provider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      epoch: EPOCH,
      inputs: inferenceInputs(),
    });
    await vi.waitFor(() => expect(session.run).toHaveBeenCalledTimes(1));
    provider.setEpoch({ ...EPOCH, stroke: EPOCH.stroke + 1 });
    const lateOutput = new FakeTensor(
      "float32",
      new Float32Array([0.2, 0.8]),
      [1, 2],
    );
    pendingRun.resolve({ mask: lateOutput });

    await expect(pending).rejects.toMatchObject({ code: "stale-result" });
    expect(lateOutput.dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels URL byte loading without network and cleans a session that resolves after cancellation", async () => {
    const bytesLoad = deferred<Uint8Array>();
    const loader = vi.fn(() => bytesLoad.promise);
    const fixture = fakeRuntime(async () => new FakeSession());
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      urlPolicy: { baseUrl: "https://studio.example/app" },
      loadModelBytes: loader,
      loadRuntime: async () => fixture.runtime,
    });
    const controller = new AbortController();
    const pending = provider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "url", url: "/models/selection.onnx" },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(fixture.createSpy).not.toHaveBeenCalled();
    bytesLoad.resolve(MODEL_BYTES);

    const lateSession = new FakeSession();
    const sessionCreation = deferred<FakeSession>();
    const sessionFixture = fakeRuntime(() => sessionCreation.promise);
    const sessionProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => sessionFixture.runtime,
      webGpuApiAvailable: () => true,
    });
    const sessionController = new AbortController();
    const pendingSession = sessionProvider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      signal: sessionController.signal,
    });
    await vi.waitFor(() =>
      expect(sessionFixture.createSpy).toHaveBeenCalledTimes(1),
    );
    sessionController.abort();
    await expect(pendingSession).rejects.toMatchObject({ code: "aborted" });
    sessionCreation.resolve(lateSession);
    await vi.waitFor(() =>
      expect(lateSession.release).toHaveBeenCalledTimes(1),
    );
  });

  it("rejects malformed outputs and input/model budget violations before publication", async () => {
    const malformedSession = new FakeSession();
    const malformed = new FakeTensor(
      "float32",
      new Float32Array([0.2, 0.8]),
      [2, 1],
    );
    malformedSession.run.mockResolvedValue({ mask: malformed });
    const malformedFixture = fakeRuntime(async () => malformedSession);
    const malformedProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      executionProvider: "wasm",
      loadRuntime: async () => malformedFixture.runtime,
      initialEpoch: EPOCH,
    });
    await expect(
      malformedProvider.infer({
        modelId: "selection-mask",
        version: "1.0.0",
        source: { kind: "bytes", bytes: MODEL_BYTES },
        epoch: EPOCH,
        inputs: inferenceInputs(),
      }),
    ).rejects.toMatchObject({ code: "malformed-output" });
    expect(malformed.dispose).toHaveBeenCalledTimes(1);

    const oversizedBytes = Uint8Array.of(1, 2, 3, 4, 5);
    const budgetFixture = fakeRuntime(async () => new FakeSession());
    const budgetProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([
        descriptor("budgeted", oversizedBytes, 4),
      ]),
      loadRuntime: async () => budgetFixture.runtime,
    });
    await expect(
      budgetProvider.loadModel({
        modelId: "budgeted",
        version: "1.0.0",
        source: { kind: "bytes", bytes: oversizedBytes },
      }),
    ).rejects.toMatchObject({ code: "model-byte-budget-exceeded" });
    expect(budgetFixture.createSpy).not.toHaveBeenCalled();

    const invalidInputProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      loadRuntime: async () => budgetFixture.runtime,
      initialEpoch: EPOCH,
    });
    await expect(
      invalidInputProvider.infer({
        modelId: "selection-mask",
        version: "1.0.0",
        source: { kind: "bytes", bytes: MODEL_BYTES },
        epoch: EPOCH,
        inputs: [
          {
            name: "pixels",
            elementType: "float32",
            dims: [1, 2],
            data: new Float32Array([1]),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "tensor-budget-exceeded" });
  });

  it("releases individual and remaining cached sessions exactly once", async () => {
    const firstSession = new FakeSession();
    const secondSession = new FakeSession();
    const fixture = fakeRuntime(async () =>
      fixture.createSpy.mock.calls.length === 1 ? firstSession : secondSession,
    );
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([
        descriptor("first"),
        descriptor("second"),
      ]),
      executionProvider: "wasm",
      loadRuntime: async () => fixture.runtime,
    });
    await provider.loadModel({
      modelId: "first",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    });
    await provider.loadModel({
      modelId: "second",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    });

    expect(await provider.disposeModel("first", "1.0.0")).toBe(true);
    expect(await provider.disposeModel("first", "1.0.0")).toBe(false);
    await provider.dispose();
    await provider.dispose();
    expect(firstSession.release).toHaveBeenCalledTimes(1);
    expect(secondSession.release).toHaveBeenCalledTimes(1);
  });

  it("leases a cached session before yielding so disposeModel waits for inference", async () => {
    const session = new FakeSession();
    const outputGate = deferred<Record<string, FakeTensor>>();
    session.run.mockReturnValue(outputGate.promise);
    const fixture = fakeRuntime(async () => session);
    const provider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      executionProvider: "wasm",
      loadRuntime: async () => fixture.runtime,
      initialEpoch: EPOCH,
    });
    await provider.loadModel({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
    });
    const inference = provider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      epoch: EPOCH,
      inputs: inferenceInputs(),
    });
    const disposal = provider.disposeModel("selection-mask", "1.0.0");
    await vi.waitFor(() => expect(session.run).toHaveBeenCalledTimes(1));
    expect(session.release).not.toHaveBeenCalled();
    outputGate.resolve({
      mask: new FakeTensor("float32", new Float32Array([0.25, 0.75]), [1, 2]),
    });
    await inference;
    await disposal;
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("preflights output schemas before dispatch and disposes partial input construction", async () => {
    const outputSession = new FakeSession();
    const outputFixture = fakeRuntime(async () => outputSession);
    const outputProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([descriptor()]),
      executionProvider: "wasm",
      loadRuntime: async () => outputFixture.runtime,
      budgets: { maxResultBytes: 4 },
      initialEpoch: EPOCH,
    });
    await expect(outputProvider.infer({
      modelId: "selection-mask",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      epoch: EPOCH,
      inputs: inferenceInputs(),
    })).rejects.toMatchObject({ code: "tensor-budget-exceeded" });
    expect(outputSession.run).not.toHaveBeenCalled();

    const twoInputDescriptor: StudioOnnxModelDescriptor = {
      ...descriptor("two-input"),
      inputs: [
        { name: "first", elementType: "float32", shape: [1] },
        { name: "second", elementType: "float32", shape: [1] },
      ],
    };
    const partialSession = new FakeSession();
    Object.defineProperty(partialSession, "inputNames", {
      value: ["first", "second"],
    });
    const constructed: FakeTensor[] = [];
    let tensorCount = 0;
    class ThrowingTensor extends FakeTensor {
      constructor(type: string, data: Float32Array, dims: readonly number[]) {
        super(type, data, dims);
        tensorCount += 1;
        if (tensorCount === 2) throw new Error("second tensor failed");
        constructed.push(this);
      }
    }
    const runtime = {
      InferenceSession: { create: vi.fn(async () => partialSession) },
      Tensor: ThrowingTensor,
    } as unknown as StudioOnnxRuntime;
    const partialProvider = createStudioOnnxInferenceProvider({
      registry: createStudioOnnxModelRegistry([twoInputDescriptor]),
      executionProvider: "wasm",
      loadRuntime: async () => runtime,
      initialEpoch: EPOCH,
    });
    await expect(partialProvider.infer({
      modelId: "two-input",
      version: "1.0.0",
      source: { kind: "bytes", bytes: MODEL_BYTES },
      epoch: EPOCH,
      inputs: [
        { name: "first", elementType: "float32", dims: [1], data: new Float32Array([1]) },
        { name: "second", elementType: "float32", dims: [1], data: new Float32Array([2]) },
      ],
    })).rejects.toThrow("second tensor failed");
    expect(constructed[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("enforces same-origin HTTPS or explicit localhost URL policy", () => {
    expect(
      resolveStudioOnnxModelUrl("/models/mask.onnx", {
        baseUrl: "https://studio.example/app",
      }),
    ).toBe("https://studio.example/models/mask.onnx");
    expect(() =>
      resolveStudioOnnxModelUrl("https://remote.example/mask.onnx", {
        baseUrl: "https://studio.example/app",
      }),
    ).toThrow(/origin is not allowed/u);
    expect(() =>
      resolveStudioOnnxModelUrl("data:model/onnx;base64,AAAA", {
        baseUrl: "https://studio.example/app",
      }),
    ).toThrow(/HTTP\(S\)/u);
    expect(
      resolveStudioOnnxModelUrl("http://localhost:5173/model.onnx", {
        baseUrl: "http://localhost:5173/studio",
        allowHttpLocalhost: true,
      }),
    ).toBe("http://localhost:5173/model.onnx");
  });
});

describe("studioOnnxLogitsToUint8Mask", () => {
  it("converts padded threshold logits and NHWC/NCHW softmax logits exactly", () => {
    expect(
      studioOnnxLogitsToUint8Mask({
        mode: "threshold",
        data: new Float32Array([-0.1, 0.2, 99, 0.5, -2, 99]),
        width: 2,
        height: 2,
        rowStride: 3,
        threshold: 0,
      }),
    ).toEqual(new Uint8Array([0, 255, 255, 0]));

    const logarithmOfThree = Math.log(3);
    expect(
      studioOnnxLogitsToUint8Mask({
        mode: "softmax",
        data: new Float64Array([0, logarithmOfThree, logarithmOfThree, 0]),
        width: 2,
        height: 1,
        classCount: 2,
        targetClass: 1,
        probabilityThreshold: 0.7,
      }),
    ).toEqual(new Uint8Array([255, 0]));
    expect(
      studioOnnxLogitsToUint8Mask({
        mode: "softmax",
        data: new Float64Array([0, logarithmOfThree, logarithmOfThree, 0]),
        width: 2,
        height: 1,
        classCount: 2,
        targetClass: 1,
        rowStride: 2,
        pixelStride: 1,
        classStride: 2,
        probabilityThreshold: 0.7,
      }),
    ).toEqual(new Uint8Array([255, 0]));
  });

  it("fails closed for inconsistent dimensions, strides, classes, and non-finite logits", () => {
    expect(() =>
      studioOnnxLogitsToUint8Mask({
        mode: "threshold",
        data: new Float32Array([1]),
        width: 2,
        height: 1,
      }),
    ).toThrow(/exceed its data/u);
    expect(() =>
      studioOnnxLogitsToUint8Mask({
        mode: "softmax",
        data: new Float32Array([0, 1]),
        width: 1,
        height: 1,
        classCount: 2,
        targetClass: 2,
      }),
    ).toThrow(/smaller than classCount/u);
    expect(() =>
      studioOnnxLogitsToUint8Mask({
        mode: "threshold",
        data: new Float32Array([Number.NaN]),
        width: 1,
        height: 1,
      }),
    ).toThrow(/must be finite/u);
  });
});
