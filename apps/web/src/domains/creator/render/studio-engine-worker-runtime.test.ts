import { describe, expect, it } from "vitest";

import {
  STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
  STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
  createStudioSharedPointerRingBuffer,
} from "../studio-shared-pointer-ring-buffer";

import {
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_WORKER_BUDGETS,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  type StudioEngineCapabilitySnapshot,
  type StudioEngineCommand,
  type StudioEngineCommandMessage,
} from "./studio-engine-worker-protocol";
import {
  STUDIO_ENGINE_POINTER_FLAG_BEGIN,
  STUDIO_ENGINE_POINTER_FLAG_CANCEL,
  STUDIO_ENGINE_POINTER_FLAG_END,
  createStudioEngineWorkerRuntime,
  type StudioEngineOffscreenSurface,
  type StudioEngineRuntimeOutboundMessage,
  type StudioEngineTransientContext2d,
} from "./studio-engine-worker-runtime";

const CAPABILITIES: StudioEngineCapabilitySnapshot = {
  offscreenCanvas: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webGpu: true,
  wasmSimd: true,
  memory64: true,
  hardwareConcurrency: 8,
  maxTextureDimension2D: 16_384,
};

class RecordingContext implements StudioEngineTransientContext2d {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  lineCap: CanvasLineCap = "round";
  lineJoin: CanvasLineJoin = "round";
  lineWidth = 1;
  strokeStyle = "#000";
  readonly calls: string[] = [];

  beginPath(): void {
    this.calls.push("begin");
  }
  clearRect(): void {
    this.calls.push("clear");
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`line:${x}:${y}`);
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`move:${x}:${y}`);
  }
  stroke(): void {
    this.calls.push(`stroke:${this.globalAlpha}:${this.globalCompositeOperation}`);
  }
}

class RecordingSurface implements StudioEngineOffscreenSurface {
  width = 1;
  height = 1;
  readonly context = new RecordingContext();
  returnNullContext = false;

  getContext(): StudioEngineTransientContext2d | null {
    return this.returnNullContext ? null : this.context;
  }
}

function createHarness() {
  const outbound: StudioEngineRuntimeOutboundMessage[] = [];
  const scheduled: Array<() => void> = [];
  const polls: Array<() => void> = [];
  let clock = 10;
  const runtime = createStudioEngineWorkerRuntime({
    postMessage: (message) => outbound.push(message),
    now: () => {
      clock += 0.25;
      return clock;
    },
    schedule: (callback) => scheduled.push(callback),
    schedulePoll: (callback) => {
      polls.push(callback);
      return callback;
    },
    cancelPoll: () => undefined,
  });
  return {
    runtime,
    outbound,
    scheduled,
    polls,
    flush() {
      while (scheduled.length > 0) scheduled.shift()?.();
    },
  };
}

function hello(
  sessionEpoch = 7,
  executionProfile: string = STUDIO_ENGINE_EXECUTION_PROFILE,
  capabilities: StudioEngineCapabilitySnapshot = CAPABILITIES,
) {
  return {
    type: "studio-engine/hello",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch,
    executionProfile,
    clientBuild: "test-client",
    capabilities,
  } as const;
}

function command(
  commandSequence: number,
  payload: StudioEngineCommand,
  sessionEpoch = 7,
): StudioEngineCommandMessage {
  return {
    type: "studio-engine/command",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch,
    commandSequence,
    command: payload,
  };
}

function createRing(capacity = 8) {
  const created = createStudioSharedPointerRingBuffer({
    capacity,
    environment: {
      crossOriginIsolated: true,
      SharedArrayBuffer,
      Atomics,
    },
  });
  if (!created.ok) throw new Error(created.reason);
  return created;
}

function sample(
  sequence: number,
  role: 0 | 1,
  flags: number,
) {
  return {
    x: sequence * 2,
    y: sequence * 3,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    time: sequence,
    pointerId: 3,
    sequence,
    role,
    channel: 1,
    flags,
  } as const;
}

describe("Studio Engine Worker runtime handshake and serial actor", () => {
  it("negotiates Ultra and accepts an exact one-time OffscreenCanvas slot", () => {
    const harness = createHarness();
    const surface = new RecordingSurface();
    harness.runtime.handleMessage(hello());
    expect(harness.outbound[0]).toMatchObject({
      type: "studio-engine/hello-ack",
      executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
    });

    const attach = command(1, {
      kind: "attach-surface",
      surfaceId: "transient",
      width: 800,
      height: 600,
      devicePixelRatio: 2,
      colorSpace: "srgb",
      alphaMode: "premultiplied",
      runtimeTransfer: { kind: "offscreen-canvas", slot: 0 },
    });
    harness.runtime.handleMessage({
      type: "studio-engine/runtime-command",
      message: attach,
      runtimeTransfers: [{ kind: "offscreen-canvas", slot: 0, surface }],
    });
    expect(harness.runtime.snapshot().acceptedThroughCommandSequence).toBe(0);
    harness.flush();

    expect(surface).toMatchObject({ width: 800, height: 600 });
    expect(harness.runtime.snapshot()).toMatchObject({
      phase: "ready",
      acceptedThroughCommandSequence: 1,
    });
    expect(harness.outbound.at(-1)).toMatchObject({
      type: "studio-engine/accepted-prefix",
      acceptedThroughCommandSequence: 1,
    });
  });

  it("rejects retired profiles and missing future capabilities instead of silently demoting", () => {
    const lowerRequest = createHarness();
    lowerRequest.runtime.handleMessage(hello(7, "webgl2-compatibility"));
    expect(lowerRequest.runtime.snapshot()).toMatchObject({
      phase: "failed",
      acceptedThroughCommandSequence: 0,
    });
    expect(lowerRequest.outbound).toEqual([]);

    const incompleteCapabilities: StudioEngineCapabilitySnapshot = {
      ...CAPABILITIES,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      wasmSimd: false,
      memory64: false,
    };
    const unsupportedUltra = createHarness();
    unsupportedUltra.runtime.handleMessage(
      hello(8, STUDIO_ENGINE_EXECUTION_PROFILE, incompleteCapabilities),
    );
    expect(unsupportedUltra.runtime.snapshot()).toMatchObject({
      phase: "failed",
      sessionEpoch: 8,
    });
    expect(unsupportedUltra.outbound).toEqual([]);
  });

  it("rejects a missing/mismatched surface transfer and never acknowledges it", () => {
    const harness = createHarness();
    harness.runtime.handleMessage(hello());
    harness.runtime.handleMessage(command(1, {
      kind: "attach-surface",
      surfaceId: "transient",
      width: 64,
      height: 64,
      devicePixelRatio: 1,
      colorSpace: "srgb",
      alphaMode: "premultiplied",
      runtimeTransfer: { kind: "offscreen-canvas", slot: 0 },
    }));
    harness.flush();

    expect(harness.runtime.snapshot()).toMatchObject({
      phase: "failed",
      acceptedThroughCommandSequence: 0,
    });
    expect(harness.outbound.at(-1)).toMatchObject({
      type: "studio-engine/signal",
      signal: { kind: "fatal", code: "surface-transfer" },
    });
  });

  it("fails closed on a duplicate command sequence and hostile envelope", () => {
    const first = createHarness();
    first.runtime.handleMessage(hello());
    first.runtime.handleMessage(command(1, {
      kind: "set-tool",
      toolRevision: 2,
      toolId: "g-pen",
      brushSize: 8,
      opacity: 1,
      flow: 1,
      hardness: 1,
      spacing: 0.1,
      colorRgba: [0, 0, 0, 1],
      blendMode: "source-over",
      stabilizer: 0.2,
    }));
    first.flush();
    first.runtime.handleMessage(command(1, {
      kind: "set-viewport",
      viewportRevision: 1,
      cssWidth: 100,
      cssHeight: 100,
      devicePixelRatio: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      rotationRadians: 0,
    }));
    first.flush();
    expect(first.runtime.snapshot().phase).toBe("failed");

    const second = createHarness();
    second.runtime.handleMessage(hello());
    second.runtime.handleMessage({ type: "studio-engine/command-ish" });
    expect(second.runtime.snapshot().phase).toBe("failed");
  });
});

describe("Studio Engine Worker runtime pointer authority boundaries", () => {
  it("keeps predicted samples presentation-only and accepts only authoritative prefixes", () => {
    const harness = createHarness();
    const ring = createRing();
    const surface = new RecordingSurface();
    harness.runtime.handleMessage(hello());
    harness.runtime.handleMessage({
      type: "studio-engine/runtime-command",
      message: command(1, {
        kind: "attach-surface",
        surfaceId: "transient",
        width: 100,
        height: 100,
        devicePixelRatio: 1,
        colorSpace: "srgb",
        alphaMode: "premultiplied",
        runtimeTransfer: { kind: "offscreen-canvas", slot: 0 },
      }),
      runtimeTransfers: [{ kind: "offscreen-canvas", slot: 0, surface }],
    });
    harness.runtime.handleMessage(command(2, {
      kind: "configure-pointer-ring",
      descriptor: ring.descriptor,
    }));
    harness.flush();

    expect(
      ring.producer.write(sample(
        1,
        STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
        STUDIO_ENGINE_POINTER_FLAG_BEGIN,
      )),
    ).toBe("written");
    expect(
      ring.producer.write(sample(
        2,
        STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
        0,
      )),
    ).toBe("written");
    harness.runtime.pollPointerRing();
    expect(harness.runtime.snapshot()).toMatchObject({
      acceptedAuthoritativeSampleSequence: 1,
      lastObservedSampleSequence: 2,
      activeStroke: true,
      authoritativeSamplesInActiveStroke: 1,
      predictedSamplesPresented: 1,
    });
    expect(surface.context.calls).toContain("stroke:0.35:source-over");

    expect(
      ring.producer.write(sample(
        3,
        STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
        STUDIO_ENGINE_POINTER_FLAG_END,
      )),
    ).toBe("written");
    harness.runtime.pollPointerRing();
    expect(harness.runtime.snapshot()).toMatchObject({
      acceptedAuthoritativeSampleSequence: 3,
      lastObservedSampleSequence: 3,
      activeStroke: false,
      authoritativeSamplesInActiveStroke: 0,
      predictedSamplesPresented: 0,
      frames: 2,
    });
    expect(
      harness.outbound.filter((entry) => entry.type === "studio-engine/frame"),
    ).toHaveLength(2);
  });

  it("fails closed when the ring reports overflow instead of accepting a partial stroke", () => {
    const harness = createHarness();
    const ring = createRing(2);
    harness.runtime.handleMessage(hello());
    harness.runtime.handleMessage(command(1, {
      kind: "configure-pointer-ring",
      descriptor: ring.descriptor,
    }));
    harness.flush();

    expect(ring.producer.write(sample(1, 0, STUDIO_ENGINE_POINTER_FLAG_BEGIN))).toBe("written");
    expect(ring.producer.write(sample(2, 0, 0))).toBe("written");
    expect(ring.producer.write(sample(3, 0, STUDIO_ENGINE_POINTER_FLAG_END))).toBe("full");
    harness.runtime.pollPointerRing();

    expect(harness.runtime.snapshot()).toMatchObject({
      phase: "failed",
      acceptedAuthoritativeSampleSequence: null,
    });
    expect(harness.outbound).toContainEqual(expect.objectContaining({
      type: "studio-engine/signal",
      signal: expect.objectContaining({
        kind: "overflow",
        source: "pointer-ring",
      }),
    }));
  });

  it("rejects predicted begin/end boundaries and device loss", () => {
    const predicted = createHarness();
    const ring = createRing();
    predicted.runtime.handleMessage(hello());
    predicted.runtime.handleMessage(command(1, {
      kind: "configure-pointer-ring",
      descriptor: ring.descriptor,
    }));
    predicted.flush();
    ring.producer.write(sample(1, 1, STUDIO_ENGINE_POINTER_FLAG_BEGIN));
    predicted.runtime.pollPointerRing();
    expect(predicted.runtime.snapshot().phase).toBe("failed");

    const device = createHarness();
    device.runtime.handleMessage(hello());
    device.runtime.failDevice("webgpu", "device destroyed", true);
    expect(device.runtime.snapshot().phase).toBe("failed");
    expect(device.outbound).toContainEqual(expect.objectContaining({
      type: "studio-engine/signal",
      signal: expect.objectContaining({ kind: "device-lost" }),
    }));
  });

  it("clears a cancelled stroke and renders destination-out as transient erase", () => {
    const harness = createHarness();
    const ring = createRing();
    const surface = new RecordingSurface();
    harness.runtime.handleMessage(hello());
    harness.runtime.handleMessage({
      type: "studio-engine/runtime-command",
      message: command(1, {
        kind: "attach-surface",
        surfaceId: "transient",
        width: 100,
        height: 100,
        devicePixelRatio: 1,
        colorSpace: "srgb",
        alphaMode: "premultiplied",
        runtimeTransfer: { kind: "offscreen-canvas", slot: 0 },
      }),
      runtimeTransfers: [{ kind: "offscreen-canvas", slot: 0, surface }],
    });
    harness.runtime.handleMessage(command(2, {
      kind: "set-tool",
      toolRevision: 2,
      toolId: "eraser",
      brushSize: 12,
      opacity: 1,
      flow: 1,
      hardness: 1,
      spacing: 0.1,
      colorRgba: [0, 0, 0, 1],
      blendMode: "destination-out",
      stabilizer: 0,
    }));
    harness.runtime.handleMessage(command(3, {
      kind: "configure-pointer-ring",
      descriptor: ring.descriptor,
    }));
    harness.flush();

    ring.producer.write(sample(1, 0, STUDIO_ENGINE_POINTER_FLAG_BEGIN));
    ring.producer.write(sample(2, 0, 0));
    harness.runtime.pollPointerRing();
    expect(surface.context.calls).toContain("stroke:1:destination-out");

    ring.producer.write(sample(3, 0, STUDIO_ENGINE_POINTER_FLAG_CANCEL));
    harness.runtime.pollPointerRing();
    expect(harness.runtime.snapshot()).toMatchObject({
      phase: "ready",
      activeStroke: false,
      acceptedAuthoritativeSampleSequence: 3,
      authoritativeSamplesInActiveStroke: 0,
    });
    expect(surface.context.calls.at(-1)).toBe("clear");
  });

  it("bounds negotiated and runtime queue limits", () => {
    expect(STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands).toBeLessThanOrEqual(1_024);
    expect(STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples).toBeLessThanOrEqual(4_096);
  });
});
