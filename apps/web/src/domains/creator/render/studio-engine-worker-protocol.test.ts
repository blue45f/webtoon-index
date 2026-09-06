import { describe, expect, it } from "vitest";

import {
  createStudioSharedPointerRingBuffer,
  STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
  STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
  STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
  STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
  STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
} from "../studio-shared-pointer-ring-buffer";

import {
  describeStudioEngineCommandTransport,
  missingStudioEngineFutureCapabilities,
  parseStudioEngineCommand,
  parseStudioEngineHello,
  parseStudioEngineHelloAck,
  parseStudioEngineWorkerMessage,
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S,
  STUDIO_ENGINE_WORKER_BUDGETS,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  STUDIO_ENGINE_SURFACE_TRANSFER_CONTRACT,
  validateStudioEngineSurfaceAgainstRuntime,
  type StudioEngineCapabilitySnapshot,
  type StudioEngineCommand,
  type StudioEngineCommandMessage,
  type StudioEngineWorkerValidationState,
} from "./studio-engine-worker-protocol";

const ULTRA_CAPABILITIES: StudioEngineCapabilitySnapshot = {
  offscreenCanvas: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webGpu: true,
  wasmSimd: true,
  memory64: true,
  hardwareConcurrency: 12,
  maxTextureDimension2D: 16_384,
};

function hello(overrides: Record<string, unknown> = {}) {
  return {
    type: "studio-engine/hello",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch: 41,
    executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
    clientBuild: "studio-2026.07.27",
    capabilities: ULTRA_CAPABILITIES,
    ...overrides,
  };
}

function commandMessage(
  command: StudioEngineCommand,
  commandSequence = 1,
  sessionEpoch = 41,
): StudioEngineCommandMessage {
  return {
    type: "studio-engine/command",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch,
    commandSequence,
    command,
  };
}

function pointerBatch(sampleCount = 3) {
  const samples = new Float64Array(
    sampleCount * STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S,
  );
  let authoritativeCount = 0;
  let predictedCount = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S;
    const role =
      index % 2 === 0
        ? STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
        : STUDIO_POINTER_SAMPLE_ROLE_PREDICTED;
    samples[offset] = index + 0.5;
    samples[offset + 1] = index * -2;
    samples[offset + 2] = 0.5;
    samples[offset + 3] = -12;
    samples[offset + 4] = 17;
    samples[offset + 5] = 180;
    samples[offset + 6] = 1_000 + index;
    samples[offset + 7] = 9;
    samples[offset + 8] = 100 + index;
    samples[offset + 9] = role;
    samples[offset + 10] = 2;
    samples[offset + 11] = 1;
    if (role === STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE) {
      authoritativeCount += 1;
    } else {
      predictedCount += 1;
    }
  }
  return {
    encoding: "float64-v1" as const,
    samples,
    sampleCount,
    firstSampleSequence: 100,
    lastSampleSequence: 99 + sampleCount,
    authoritativeCount,
    predictedCount,
  };
}

const INITIAL_COMMAND_STATE = {
  sessionEpoch: 41,
  lastAcceptedCommandSequence: 0,
};

const INITIAL_WORKER_STATE: StudioEngineWorkerValidationState = {
  sessionEpoch: 41,
  lastSentCommandSequence: 8,
  lastAcceptedCommandSequence: 2,
  lastFrameSequence: 4,
  lastSignalSequence: 3,
};

describe("studio engine capability handshake", () => {
  it("reports every missing future-only capability without selecting a fallback", () => {
    expect(missingStudioEngineFutureCapabilities(ULTRA_CAPABILITIES)).toEqual([]);
    expect(
      missingStudioEngineFutureCapabilities({
        ...ULTRA_CAPABILITIES,
        sharedArrayBuffer: false,
        crossOriginIsolated: false,
        memory64: false,
      }),
    ).toEqual(["sharedArrayBuffer", "crossOriginIsolated", "memory64"]);
  });

  it("accepts a structured-cloned hello and rejects future revisions", () => {
    expect(parseStudioEngineHello(structuredClone(hello()))).toMatchObject({
      ok: true,
      value: {
        sessionEpoch: 41,
        executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
      },
    });
    expect(
      parseStudioEngineHello(hello({ protocolRevision: 3 })),
    ).toEqual({
      ok: false,
      reason: "future-protocol-revision",
      path: "protocolRevision",
    });
    expect(
      parseStudioEngineHello(hello({ unexpectedCapability: true })),
    ).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$",
    });
  });

  it("fails closed on malformed capabilities and stale hello acknowledgements", () => {
    expect(
      parseStudioEngineHello(
        hello({
          capabilities: {
            ...ULTRA_CAPABILITIES,
            hardwareConcurrency: Number.NaN,
          },
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "capabilities",
    });
    const ack = {
      type: "studio-engine/hello-ack",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 40,
      executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
      engineBuild: "engine-1.0.0",
      limits: {
        maxInFlightCommands: 256,
        maxPointerBatchSamples: 2_048,
        maxPointerRingSamples: 16_384,
        maxDocumentPatchBytes: 4 * 1024 * 1024,
      },
    };
    expect(parseStudioEngineHelloAck(ack, 41)).toEqual({
      ok: false,
      reason: "stale-session-epoch",
      path: "sessionEpoch",
    });
    expect(
      parseStudioEngineHelloAck({ ...ack, sessionEpoch: 41 }, 41),
    ).toMatchObject({
      ok: true,
      value: { executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE },
    });
  });

  it("rejects retired compatibility profile fields at the protocol boundary", () => {
    expect(parseStudioEngineHello(hello({
      executionProfile: "webgl2-compatibility",
    }))).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "executionProfile",
    });
    expect(parseStudioEngineHelloAck({
      type: "studio-engine/hello-ack",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 41,
      executionProfile: "webgl2-compatibility",
      engineBuild: "retired-engine",
      limits: {
        maxInFlightCommands: 1,
        maxPointerBatchSamples: 1,
        maxPointerRingSamples: 2,
        maxDocumentPatchBytes: 1,
      },
    }, 41)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "executionProfile",
    });
  });

  it("rejects negotiated limits beyond the protocol budget", () => {
    const ack = {
      type: "studio-engine/hello-ack",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 41,
      executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
      engineBuild: "engine-1.0.0",
      limits: {
        maxInFlightCommands:
          STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands + 1,
        maxPointerBatchSamples: 1,
        maxPointerRingSamples: 2,
        maxDocumentPatchBytes: 1,
      },
    };
    expect(parseStudioEngineHelloAck(ack, 41)).toEqual({
      ok: false,
      reason: "budget-exceeded",
      path: "limits",
    });
  });
});

describe("studio engine command prefix validation", () => {
  const surfaceCommand: StudioEngineCommand = {
    kind: "attach-surface",
    surfaceId: "main-canvas",
    width: 3_840,
    height: 2_160,
    devicePixelRatio: 2,
    colorSpace: "display-p3",
    alphaMode: "premultiplied",
    runtimeTransfer: {
      kind: "offscreen-canvas",
      slot: 0,
    },
  };

  it("keeps the surface payload separate from runtime transfer objects", () => {
    const message = commandMessage(surfaceCommand);
    const parsed = parseStudioEngineCommand(
      structuredClone(message),
      INITIAL_COMMAND_STATE,
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        nextState: { lastAcceptedCommandSequence: 1 },
      },
    });
    expect(describeStudioEngineCommandTransport(message)).toEqual({
      runtimeTransferSlots: [
        { kind: "offscreen-canvas", slot: 0 },
      ],
      transferableArrayBuffers: [],
      sharedArrayBuffers: [],
    });
    expect(STUDIO_ENGINE_SURFACE_TRANSFER_CONTRACT).toContain(
      "runtime slot",
    );
    expect(
      validateStudioEngineSurfaceAgainstRuntime(surfaceCommand, {
        negotiatedMaxTextureDimension2D: 16_384,
        runtimeMaxTextureDimension2D: 16_384,
        runtimeMaxSurfaceBytes: 256 * 1024 * 1024,
      }),
    ).toEqual({
      ok: true,
      pixelCount: 8_294_400,
      budgetedBytes: 33_177_600,
    });
  });

  it("rejects impossible surface products and device-limit mismatches", () => {
    expect(
      parseStudioEngineCommand(
        commandMessage({
          ...surfaceCommand,
          width: STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
          height: STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
        }),
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "budget-exceeded",
      path: "command.surface",
    });
    expect(
      validateStudioEngineSurfaceAgainstRuntime(
        {
          ...surfaceCommand,
          width: 9_000,
          height: 4_000,
        },
        {
          negotiatedMaxTextureDimension2D: 8_192,
          runtimeMaxTextureDimension2D: 16_384,
          runtimeMaxSurfaceBytes: 512 * 1024 * 1024,
        },
      ),
    ).toEqual({
      ok: false,
      reason: "runtime-budget-exceeded",
    });
  });

  it("rejects stale epochs, duplicates, reordering, and command gaps", () => {
    expect(
      parseStudioEngineCommand(
        commandMessage(surfaceCommand, 1, 40),
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "stale-session-epoch",
      path: "sessionEpoch",
    });
    expect(
      parseStudioEngineCommand(commandMessage(surfaceCommand, 2), {
        sessionEpoch: 41,
        lastAcceptedCommandSequence: 2,
      }),
    ).toEqual({
      ok: false,
      reason: "stale-command-sequence",
      path: "commandSequence",
    });
    expect(
      parseStudioEngineCommand(
        commandMessage(surfaceCommand, 3),
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "command-sequence-gap",
      path: "commandSequence",
    });
  });

  it("accepts pointer ring descriptors without marking SAB transferable", () => {
    const ring = createStudioSharedPointerRingBuffer({
      capacity: 1_024,
      environment: {
        crossOriginIsolated: true,
        SharedArrayBuffer,
        Atomics,
      },
    });
    expect(ring.ok).toBe(true);
    if (!ring.ok) return;
    const message = commandMessage({
      kind: "configure-pointer-ring",
      descriptor: structuredClone(ring.descriptor),
    });
    expect(
      parseStudioEngineCommand(message, INITIAL_COMMAND_STATE),
    ).toMatchObject({ ok: true });
    const transport = describeStudioEngineCommandTransport(message);
    expect(transport.transferableArrayBuffers).toEqual([]);
    expect(transport.sharedArrayBuffers).toHaveLength(1);
    expect(transport.sharedArrayBuffers[0]).toBeInstanceOf(
      SharedArrayBuffer,
    );

    expect(
      parseStudioEngineCommand(
        commandMessage({
          kind: "configure-pointer-ring",
          descriptor: {
            ...ring.descriptor,
            byteLength: ring.descriptor.byteLength + 8,
          },
        }),
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "malformed-pointer-ring",
      path: "command.descriptor",
    });
    expect(
      parseStudioEngineCommand(
        commandMessage({
          kind: "configure-pointer-ring",
          descriptor: {
            ...ring.descriptor,
            capacity: 1,
            byteLength:
              STUDIO_SHARED_POINTER_RING_HEADER_BYTES
              + STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
            buffer: new SharedArrayBuffer(
              STUDIO_SHARED_POINTER_RING_HEADER_BYTES
              + STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
            ),
          },
        }),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({
      ok: false,
      reason: "malformed-pointer-ring",
    });
  });

  it("validates and exposes an exact transferable pointer batch", () => {
    const batch = pointerBatch();
    expect(STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S).toBe(12);
    expect(STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S).toBe(17);
    expect(batch.samples).toHaveLength(
      batch.sampleCount * STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S,
    );
    const message = commandMessage({
      kind: "pointer-batch",
      batch,
    });
    expect(
      parseStudioEngineCommand(
        structuredClone(message),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({ ok: true });
    expect(describeStudioEngineCommandTransport(message)).toMatchObject({
      runtimeTransferSlots: [],
      transferableArrayBuffers: [batch.samples.buffer],
      sharedArrayBuffers: [],
    });
  });

  it("accepts sample sequence zero consistently with the SPSC ring", () => {
    const batch = pointerBatch(1);
    batch.samples[8] = 0;
    batch.firstSampleSequence = 0;
    batch.lastSampleSequence = 0;
    expect(
      parseStudioEngineCommand(
        commandMessage({ kind: "pointer-batch", batch }),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects corrupt sample sequences, role counts, and non-finite payloads", () => {
    const badSequence = pointerBatch();
    badSequence.samples[8] = 101;
    expect(
      parseStudioEngineCommand(
        commandMessage({ kind: "pointer-batch", batch: badSequence }),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({
      ok: false,
      reason: "malformed-pointer-batch",
      path: "command.batch.samples[0]",
    });

    const badCounts = pointerBatch();
    expect(
      parseStudioEngineCommand(
        commandMessage({
          kind: "pointer-batch",
          batch: { ...badCounts, authoritativeCount: 0 },
        }),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({
      ok: false,
      reason: "malformed-pointer-batch",
    });

    const nonFinite = pointerBatch();
    nonFinite.samples[0] = Number.NaN;
    expect(
      parseStudioEngineCommand(
        commandMessage({ kind: "pointer-batch", batch: nonFinite }),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({
      ok: false,
      reason: "malformed-pointer-batch",
    });
  });

  it("accepts bounded viewport, tool, and document commands", () => {
    const viewport: StudioEngineCommand = {
      kind: "set-viewport",
      viewportRevision: 2,
      cssWidth: 1_920,
      cssHeight: 1_080,
      devicePixelRatio: 2,
      zoom: 1.25,
      panX: -40,
      panY: 80,
      rotationRadians: Math.PI / 4,
    };
    const tool: StudioEngineCommand = {
      kind: "set-tool",
      toolRevision: 5,
      toolId: "brush.g-pen",
      brushSize: 12.5,
      opacity: 1,
      flow: 0.9,
      hardness: 0.8,
      spacing: 0.1,
      colorRgba: [0.1, 0.2, 0.3, 1],
      blendMode: "multiply",
      stabilizer: 0.4,
    };
    const document: StudioEngineCommand = {
      kind: "apply-document-patch",
      documentId: "episode-1",
      baseRevision: 8,
      documentRevision: 9,
      operationCount: 2,
      encoding: "binary-v1",
      bytes: new Uint8Array([1, 2, 3, 4]),
    };

    expect(
      parseStudioEngineCommand(
        commandMessage(viewport),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseStudioEngineCommand(
        commandMessage(tool),
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({ ok: true });
    const documentMessage = commandMessage(document);
    expect(
      parseStudioEngineCommand(
        documentMessage,
        INITIAL_COMMAND_STATE,
      ),
    ).toMatchObject({ ok: true });
    expect(
      describeStudioEngineCommandTransport(documentMessage)
        .transferableArrayBuffers,
    ).toEqual([document.bytes.buffer]);
  });

  it("enforces document byte and operation budgets", () => {
    const oversized = new Uint8Array(
      STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes + 1,
    );
    expect(
      parseStudioEngineCommand(
        commandMessage({
          kind: "apply-document-patch",
          documentId: "episode-1",
          baseRevision: 0,
          documentRevision: 1,
          operationCount: 1,
          encoding: "binary-v1",
          bytes: oversized,
        }),
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "budget-exceeded",
      path: "command.bytes",
    });
  });

  it("rejects future command revisions and unknown commands", () => {
    expect(
      parseStudioEngineCommand(
        {
          ...commandMessage(surfaceCommand),
          protocolRevision: 3,
        },
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "future-protocol-revision",
      path: "protocolRevision",
    });
    expect(
      parseStudioEngineCommand(
        {
          ...commandMessage(surfaceCommand),
          command: { kind: "run-arbitrary-script" },
        },
        INITIAL_COMMAND_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "command.kind",
    });
  });
});

describe("studio engine worker receipts and failure signals", () => {
  it("advances an accepted command prefix and rejects stale/ahead receipts", () => {
    const receipt = {
      type: "studio-engine/accepted-prefix",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 41,
      acceptedThroughCommandSequence: 5,
      queuedCommands: 3,
      queuedPointerSamples: 120,
      pressure: "soft",
    };
    expect(
      parseStudioEngineWorkerMessage(receipt, INITIAL_WORKER_STATE),
    ).toMatchObject({
      ok: true,
      value: {
        nextState: { lastAcceptedCommandSequence: 5 },
      },
    });
    expect(
      parseStudioEngineWorkerMessage(
        { ...receipt, acceptedThroughCommandSequence: 1 },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "stale-accepted-prefix",
      path: "acceptedThroughCommandSequence",
    });
    expect(
      parseStudioEngineWorkerMessage(
        { ...receipt, acceptedThroughCommandSequence: 9 },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "receipt-ahead-of-sent-prefix",
      path: "acceptedThroughCommandSequence",
    });
  });

  it("validates monotonically increasing frame receipts", () => {
    const frame = {
      type: "studio-engine/frame",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 41,
      frameSequence: 5,
      acceptedThroughCommandSequence: 6,
      surfaceId: "main-canvas",
      documentRevision: 17,
      presentedAt: 8_000,
      cpuMilliseconds: 2.2,
      gpuMilliseconds: 1.1,
      pointerSamplesRendered: 120,
      droppedFrames: 0,
    };
    expect(
      parseStudioEngineWorkerMessage(frame, INITIAL_WORKER_STATE),
    ).toMatchObject({
      ok: true,
      value: {
        nextState: {
          lastAcceptedCommandSequence: 6,
          lastFrameSequence: 5,
        },
      },
    });
    expect(
      parseStudioEngineWorkerMessage(
        { ...frame, frameSequence: 4 },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "stale-frame-sequence",
      path: "frameSequence",
    });
    expect(
      parseStudioEngineWorkerMessage(
        { ...frame, sessionEpoch: 40 },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "stale-session-epoch",
      path: "sessionEpoch",
    });
  });

  it.each([
    {
      kind: "backpressure",
      level: "hard",
      queuedCommands: 1_024,
      queuedPointerSamples: 4_096,
      retryAfterMilliseconds: 16,
    },
    {
      kind: "overflow",
      source: "pointer-ring",
      droppedCount: 12,
      acceptedThroughCommandSequence: 5,
    },
    {
      kind: "device-lost",
      backend: "webgpu",
      reason: "GPU process reset",
      recoverable: true,
    },
    {
      kind: "fatal",
      code: "engine.protocol-corrupt",
      message: "The accepted document prefix cannot be reconstructed.",
      relatedCommandSequence: 6,
    },
  ])("accepts bounded $kind signals", (signal) => {
    expect(
      parseStudioEngineWorkerMessage(
        {
          type: "studio-engine/signal",
          protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
          sessionEpoch: 41,
          signalSequence: 4,
          signal,
        },
        INITIAL_WORKER_STATE,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        nextState: { lastSignalSequence: 4 },
      },
    });
  });

  it("rejects stale, oversized, and corrupt signals", () => {
    const base = {
      type: "studio-engine/signal",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 41,
      signalSequence: 3,
      signal: {
        kind: "fatal",
        code: "engine.failed",
        message: "failed",
        relatedCommandSequence: null,
      },
    };
    expect(
      parseStudioEngineWorkerMessage(base, INITIAL_WORKER_STATE),
    ).toEqual({
      ok: false,
      reason: "stale-signal-sequence",
      path: "signalSequence",
    });
    expect(
      parseStudioEngineWorkerMessage(
        {
          ...base,
          signalSequence: 4,
          signal: {
            ...base.signal,
            message: "x".repeat(
              STUDIO_ENGINE_WORKER_BUDGETS.maxErrorMessageCharacters + 1,
            ),
          },
        },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "signal",
    });
    expect(
      parseStudioEngineWorkerMessage(
        {
          ...base,
          signalSequence: 4,
          signal: {
            kind: "device-lost",
            backend: "webgl2",
            reason: "retired compatibility backend",
            recoverable: false,
          },
        },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "signal",
    });
    expect(
      parseStudioEngineWorkerMessage(
        {
          ...base,
          signalSequence: 4,
          signal: {
            kind: "overflow",
            source: "pointer-ring",
            droppedCount: 1,
            acceptedThroughCommandSequence: 1,
          },
        },
        INITIAL_WORKER_STATE,
      ),
    ).toEqual({
      ok: false,
      reason: "stale-accepted-prefix",
      path: "signal.acceptedThroughCommandSequence",
    });
  });
});
