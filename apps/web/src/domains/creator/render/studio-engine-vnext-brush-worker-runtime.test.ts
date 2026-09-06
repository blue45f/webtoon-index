import { describe, expect, it, vi } from "vitest";

import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";

import {
  STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
  type StudioEngineVNextBrushWorkerHelloMessage,
  type StudioEngineVNextBrushWorkerOutboundMessage,
  type StudioEngineVNextBrushWorkerSubmitMessage,
} from "./studio-engine-vnext-brush-worker-protocol";
import {
  createStudioEngineVNextBrushWorkerRuntime,
  type StudioEngineVNextBrushWorkerDurableController,
} from "./studio-engine-vnext-brush-worker-runtime";

import type {
  StudioEngineDurableBrushSubmissionResult,
} from "./studio-engine-durable-brush-controller";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(commandSequence = 1): Record<string, unknown> {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `runtime-stroke-${commandSequence}`,
    seed: commandSequence,
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
      components: [0.1, 0.2, 0.3, 1],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "runtime-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 4,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          role: "authoritative",
          sequence: 1,
          x: 1,
          y: 1,
          pressure: 0.5,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          role: "authoritative",
          sequence: 2,
          x: 4,
          y: 3,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
}

const epochs = {
  sessionEpoch: 7,
  commandEpoch: 11,
  deviceEpoch: 5,
  resizeEpoch: 3,
  requestEpoch: 13,
} as const;

function hello(): StudioEngineVNextBrushWorkerHelloMessage {
  return {
    type: "studio-engine-vnext-brush/hello",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
    clientBuild: "runtime-client-1",
  };
}

function submit(
  requestSequence = 1,
  commandSequence = requestSequence,
): StudioEngineVNextBrushWorkerSubmitMessage {
  return {
    type: "studio-engine-vnext-brush/submit",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    ...epochs,
    requestSequence,
    commandSequence,
    requestToken: `token-${requestSequence}`,
    submission: {
      mode: "rebuild",
      resizeEpoch: epochs.resizeEpoch,
      deviceEpoch: epochs.deviceEpoch,
      rasterRect: { x: 0, y: 0, width: 8, height: 8 },
      layerId: "ink",
      baseDocumentRevision: commandSequence - 1,
      baseLayerRevision: commandSequence - 1,
      dirtyRects: [{ x: 0, y: 0, width: 4, height: 2 }],
      brushPlan: brushPlan(commandSequence),
    },
  };
}

function durableResult(
  submission: StudioEngineVNextBrushWorkerSubmitMessage["submission"],
  status: "committed" | "duplicate" = "committed",
  gpuRequestSequence = 1,
): StudioEngineDurableBrushSubmissionResult {
  const candidate = submission.brushPlan as { commandSequence: number };
  const commandSequence = candidate.commandSequence;
  const parsed = parseStudioCanonicalBrushPlan(submission.brushPlan, {
    sessionEpoch: 7,
    strokeEpoch: 11,
    lastAcceptedCommandSequence: commandSequence - 1,
  });
  if (!parsed.ok) throw new Error("test brush plan is invalid");
  const plan = parsed.value.plan;
  const baseDocumentRevision = submission.baseDocumentRevision;
  const documentRevision = baseDocumentRevision + 1;
  const journalByteLength = 128;
  const tileByteLength = 32;
  return {
    status,
    receipt: {
      kind: "studio-engine-durable-brush-receipt",
      version: 1,
      canonicalPlanHash: hashStudioCanonicalBrushPlan(plan),
      commandSequence,
      strokeId: plan.strokeId,
      sessionEpoch: 7,
      strokeEpoch: 11,
      gpu: {
        state: "submitted",
        requestSequence: gpuRequestSequence,
        resizeEpoch: 3,
        deviceEpoch: 5,
        planFingerprint: `fingerprint-${gpuRequestSequence}`,
        mode: submission.mode,
        loweringVersion: 1,
        dabCount: 2,
        batchCount: 1,
      },
      authority: {
        state: "tile-authority-committed",
        authorityVersion: 1,
        encoding: "linear-rgba16float-le-v1",
        documentId: "runtime-doc",
        commandIdentity: `command:${commandSequence}`,
        commandSequence,
        baseDocumentRevision,
        documentRevision,
        layerId: submission.layerId,
        baseLayerRevision: submission.baseLayerRevision,
        layerRevision: submission.baseLayerRevision + 1,
        tileRevisions: [{
          tileId: "0:0",
          layerId: submission.layerId,
          column: 0,
          row: 0,
          baseTileRevision: commandSequence - 1,
          tileRevision: commandSequence,
          contentDigest: `rgba16f-v1:tile-${commandSequence}`,
        }],
        journalSequence: commandSequence,
        journalDigest: `journal-${commandSequence}`,
        journalByteLength,
        journalLogicalByteOffset: BigInt((commandSequence - 1) * journalByteLength),
      },
      storage: {
        state: "opfs-v2-atomic-commit-acknowledged",
        protocolVersion: 2,
        disposition: status === "duplicate" ? "idempotent-replay" : "committed",
        requestSequence: commandSequence,
        sessionEpoch: 7,
        transactionSequence: commandSequence,
        transactionIdentity: `transaction:${commandSequence}`,
        durableRevision: commandSequence,
        documentId: "runtime-doc",
        commandIdentity: `command:${commandSequence}`,
        commandSequence,
        documentRevision,
        journalLogicalByteOffset: BigInt((commandSequence - 1) * journalByteLength),
        journalByteLength,
        journalPayloadChecksum: `checksum-${commandSequence}`,
        tileCount: 1,
        totalPayloadBytes: BigInt(journalByteLength + tileByteLength),
      },
      storageDurability: "opfs-v2-durable",
    },
  };
}

function fakeController(
  submitImplementation: StudioEngineVNextBrushWorkerDurableController["submit"] = (
    value,
  ) => durableResult(value as StudioEngineVNextBrushWorkerSubmitMessage["submission"]),
): StudioEngineVNextBrushWorkerDurableController & {
  submit: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    submit: vi.fn(submitImplementation),
    cancel: vi.fn((commandSequence: number) => ({
      status: "canceled" as const,
      commandSequence,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

function harness(
  controller: StudioEngineVNextBrushWorkerDurableController = fakeController(),
  options: {
    readonly maxQueuedRequests?: number;
    readonly maxQueuedCanonicalSamples?: number;
  } = {},
) {
  const messages: StudioEngineVNextBrushWorkerOutboundMessage[] = [];
  const factory = vi.fn(async () => controller);
  const runtime = createStudioEngineVNextBrushWorkerRuntime({
    port: { postMessage: (message) => messages.push(structuredClone(message)) },
    controllerFactory: factory,
    ...options,
  });
  return { runtime, messages, factory, controller };
}

async function initialize(
  fixture: ReturnType<typeof harness>,
): Promise<void> {
  fixture.runtime.handleMessage(structuredClone(hello()));
  await vi.waitFor(() => expect(fixture.messages.some((message) => (
    message.type === "studio-engine-vnext-brush/ready"
  ))).toBe(true));
}

function messagesOfType<
  Kind extends StudioEngineVNextBrushWorkerOutboundMessage["type"],
>(
  messages: readonly StudioEngineVNextBrushWorkerOutboundMessage[],
  type: Kind,
): Array<Extract<StudioEngineVNextBrushWorkerOutboundMessage, { type: Kind }>> {
  return messages.filter(
    (message): message is Extract<
    StudioEngineVNextBrushWorkerOutboundMessage,
    { type: Kind }
    > => message.type === type,
  );
}

describe("StudioEngineVNextBrushWorkerRuntime", () => {
  it("constructs the durable controller after hello and emits success only after durable ACK", async () => {
    const pending = deferred<StudioEngineDurableBrushSubmissionResult>();
    const controller = fakeController(() => pending.promise);
    const fixture = harness(controller);
    await initialize(fixture);
    const request = submit();

    fixture.runtime.handleMessage(structuredClone(request));
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));
    expect(messagesOfType(fixture.messages, "studio-engine-vnext-brush/result")).toHaveLength(0);
    pending.resolve(durableResult(request.submission));
    await vi.waitFor(() => expect(
      messagesOfType(fixture.messages, "studio-engine-vnext-brush/result"),
    ).toHaveLength(1));

    const result = messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    )[0]!;
    expect(result).toMatchObject({
      requestSequence: 1,
      commandSequence: 1,
      disposition: "committed",
      receipt: {
        storageDurability: "opfs-v2-durable",
        authority: {
          commandSequence: 1,
          documentRevision: 1,
        },
        storage: {
          state: "opfs-v2-atomic-commit-acknowledged",
          durableRevision: 1,
        },
      },
    });
    expect(() => structuredClone(result)).not.toThrow();
    expect(JSON.stringify(result, (_key, value) => (
      typeof value === "bigint" ? value.toString() : value
    ))).not.toMatch(/GPUDevice|OPFSHandle|provider/u);
  });

  it("returns the cached exact result for exact replay and rejects changed same-sequence content", async () => {
    const controller = fakeController();
    const fixture = harness(controller);
    await initialize(fixture);
    const request = submit();
    fixture.runtime.handleMessage(request);
    await vi.waitFor(() => expect(
      messagesOfType(fixture.messages, "studio-engine-vnext-brush/result"),
    ).toHaveLength(1));

    fixture.runtime.handleMessage(structuredClone(request));
    fixture.runtime.handleMessage({
      ...request,
      requestToken: "changed-token",
    });

    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    )).toHaveLength(2);
    expect(controller.submit).toHaveBeenCalledTimes(1);
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/failure",
    ).at(-1)).toMatchObject({
      error: { code: "request-sequence-conflict" },
    });
  });

  it("serializes concurrent commands before delegating the next command", async () => {
    const first = deferred<StudioEngineDurableBrushSubmissionResult>();
    const controller = fakeController((value) => {
      const input = value as StudioEngineVNextBrushWorkerSubmitMessage["submission"];
      return (input.brushPlan as { commandSequence: number }).commandSequence === 1
        ? first.promise
        : durableResult(input, "committed", 2);
    });
    const fixture = harness(controller, { maxQueuedRequests: 3 });
    await initialize(fixture);
    const one = submit(1, 1);
    const two = submit(2, 2);

    fixture.runtime.handleMessage(one);
    fixture.runtime.handleMessage(two);
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));
    first.resolve(durableResult(one.submission));
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(
      messagesOfType(fixture.messages, "studio-engine-vnext-brush/result"),
    ).toHaveLength(2));

    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    ).map((message) => message.commandSequence)).toEqual([1, 2]);
  });

  it("enforces hard backpressure, external sequence continuity, and epoch freshness", async () => {
    const pending = deferred<StudioEngineDurableBrushSubmissionResult>();
    const controller = fakeController(() => pending.promise);
    const fixture = harness(controller, { maxQueuedRequests: 1 });
    await initialize(fixture);
    const one = submit();
    fixture.runtime.handleMessage(one);
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));

    fixture.runtime.handleMessage(submit(2, 2));
    fixture.runtime.handleMessage({
      ...submit(2, 2),
      deviceEpoch: 6,
      submission: {
        ...submit(2, 2).submission,
        deviceEpoch: 6,
      },
    });
    const failures = messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/failure",
    );
    expect(failures.map((message) => message.error.code)).toEqual([
      "queue-full",
      "epoch-mismatch",
    ]);
    pending.resolve(durableResult(one.submission));

    const fresh = harness(fakeController());
    await initialize(fresh);
    fresh.runtime.handleMessage(submit(2, 2));
    expect(messagesOfType(
      fresh.messages,
      "studio-engine-vnext-brush/failure",
    ).at(-1)).toMatchObject({
      error: { code: "request-sequence-gap" },
    });
  });

  it("blocks later work after storage ambiguity and admits only the exact replay", async () => {
    let attempts = 0;
    const controller = fakeController((value) => {
      attempts += 1;
      const input = value as StudioEngineVNextBrushWorkerSubmitMessage["submission"];
      return attempts === 1
        ? {
            status: "rejected",
            reason: "storage-rejected",
            futureReason: "tile-authority-rejected",
            storageCode: "transport-failed",
          }
        : durableResult(input, "duplicate", 2);
    });
    const fixture = harness(controller);
    await initialize(fixture);
    const one = submit();

    fixture.runtime.handleMessage(one);
    await vi.waitFor(() => expect(fixture.runtime.snapshot().retryRequired).toBe(true));
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/failure",
    ).at(-1)).toMatchObject({
      requestSequence: 1,
      error: {
        code: "retry-required",
        retryRequired: true,
        controllerReason: "storage-rejected",
        storageCode: "transport-failed",
      },
    });

    fixture.runtime.handleMessage(submit(2, 2));
    expect(controller.submit).toHaveBeenCalledTimes(1);
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/failure",
    ).at(-1)).toMatchObject({
      requestSequence: 2,
      error: { code: "retry-required" },
    });

    fixture.runtime.handleMessage(structuredClone(one));
    await vi.waitFor(() => expect(
      messagesOfType(fixture.messages, "studio-engine-vnext-brush/result"),
    ).toHaveLength(1));
    expect(controller.submit).toHaveBeenCalledTimes(2);
    expect(fixture.runtime.snapshot()).toMatchObject({
      retryRequired: false,
      durableThroughCommandSequence: 1,
    });
  });

  it("cancels queued and active requests without publishing a durable receipt", async () => {
    const first = deferred<StudioEngineDurableBrushSubmissionResult>();
    const controller = fakeController(() => first.promise);
    const fixture = harness(controller, { maxQueuedRequests: 3 });
    await initialize(fixture);
    const one = submit(1, 1);
    const two = submit(2, 2);
    fixture.runtime.handleMessage(one);
    fixture.runtime.handleMessage(two);
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));

    fixture.runtime.handleMessage({
      type: "studio-engine-vnext-brush/cancel",
      protocolRevision: 1,
      ...epochs,
      requestSequence: 2,
      commandSequence: 2,
      requestToken: "token-2",
    });
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/cancelled",
    ).map((message) => message.requestSequence)).toEqual([2]);
    expect(controller.cancel).not.toHaveBeenCalled();

    fixture.runtime.handleMessage({
      type: "studio-engine-vnext-brush/cancel",
      protocolRevision: 1,
      ...epochs,
      requestSequence: 1,
      commandSequence: 1,
      requestToken: "token-1",
    });
    expect(controller.cancel).toHaveBeenCalledWith(1);
    first.resolve(durableResult(one.submission));
    await vi.waitFor(() => expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/cancelled",
    ).map((message) => message.requestSequence)).toEqual([2, 1]));
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    )).toHaveLength(0);
  });

  it("rejects hostile controller results and never projects provider objects", async () => {
    const request = submit();
    const valid = durableResult(request.submission);
    if (valid.status === "rejected") throw new Error("invalid test receipt");
    const controller = fakeController(() => ({
      ...valid,
      receipt: {
        ...valid.receipt,
        gpuDevice: { secret: "GPUDevice" },
      },
    }) as unknown as StudioEngineDurableBrushSubmissionResult);
    const fixture = harness(controller);
    await initialize(fixture);

    fixture.runtime.handleMessage(request);
    await vi.waitFor(() => expect(fixture.runtime.snapshot().retryRequired).toBe(true));

    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    )).toHaveLength(0);
    const failure = messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/failure",
    ).at(-1)!;
    expect(failure).toMatchObject({
      error: {
        code: "durable-result-invalid",
        retryRequired: true,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("GPUDevice");
  });

  it("disposes the injected controller and suppresses late durable success", async () => {
    const pending = deferred<StudioEngineDurableBrushSubmissionResult>();
    const controller = fakeController(() => pending.promise);
    const fixture = harness(controller);
    await initialize(fixture);
    const request = submit();
    fixture.runtime.handleMessage(request);
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));

    fixture.runtime.handleMessage({
      type: "studio-engine-vnext-brush/dispose",
      protocolRevision: 1,
      ...epochs,
    });
    await vi.waitFor(() => expect(
      messagesOfType(fixture.messages, "studio-engine-vnext-brush/disposed"),
    ).toHaveLength(1));
    pending.resolve(durableResult(request.submission));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.snapshot().state).toBe("disposed");
    expect(messagesOfType(
      fixture.messages,
      "studio-engine-vnext-brush/result",
    )).toHaveLength(0);
  });

  it("fails closed when controller construction fails", async () => {
    const messages: StudioEngineVNextBrushWorkerOutboundMessage[] = [];
    const runtime = createStudioEngineVNextBrushWorkerRuntime({
      port: { postMessage: (message) => messages.push(message) },
      controllerFactory: async () => {
        throw new Error("factory failed");
      },
    });

    runtime.handleMessage(hello());
    await vi.waitFor(() => expect(messagesOfType(
      messages,
      "studio-engine-vnext-brush/failure",
    )).toHaveLength(1));

    expect(messagesOfType(
      messages,
      "studio-engine-vnext-brush/failure",
    )[0]).toMatchObject({
      error: { code: "factory-failed" },
    });
    expect(runtime.snapshot()).toMatchObject({
      state: "fatal",
      controllerFactoryCalls: 1,
    });
  });
});
