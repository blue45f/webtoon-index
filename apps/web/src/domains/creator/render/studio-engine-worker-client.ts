import {
  createStudioSharedPointerRingBuffer,
  type StudioSharedPointerRingEnvironment,
  type StudioSharedPointerRingProducer,
  type StudioSharedPointerSample,
  type StudioSharedPointerWriteResult,
} from "../studio-shared-pointer-ring-buffer";

import {
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  describeStudioEngineCommandTransport,
  missingStudioEngineFutureCapabilities,
  parseStudioEngineHelloAck,
  parseStudioEngineWorkerMessage,
  type StudioEngineAttachSurfaceCommand,
  type StudioEngineCapabilitySnapshot,
  type StudioEngineCommand,
  type StudioEngineCommandMessage,
  type StudioEngineHelloAckMessage,
  type StudioEngineToolCommand,
  type StudioEngineWorkerMessage,
  type StudioEngineWorkerValidationState,
} from "./studio-engine-worker-protocol";

import type {
  StudioEngineOffscreenSurface,
  StudioEngineRuntimeCommandEnvelope,
} from "./studio-engine-worker-runtime";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

export interface StudioEngineWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void;
  terminate(): void;
}

export type StudioEngineWorkerClientFailureCode =
  | "disposed"
  | "handshake-timeout"
  | "protocol"
  | "future-capabilities-required"
  | "pointer-ring-unavailable"
  | "surface-already-transferred"
  | "transport"
  | "worker-failed"
  | "worker-unavailable";

export interface StudioEngineWorkerClientFailure {
  readonly code: StudioEngineWorkerClientFailureCode;
  readonly message: string;
}

export interface StudioEngineWorkerSessionOptions {
  readonly capabilities: StudioEngineCapabilitySnapshot;
  readonly clientBuild: string;
  readonly sessionEpoch?: number;
  readonly pointerRingCapacity?: number;
  readonly pointerRingEnvironment?: StudioSharedPointerRingEnvironment;
  readonly workerFactory?: (() => StudioEngineWorkerLike | null) | null;
  readonly handshakeTimeoutMilliseconds?: number;
  readonly setTimeoutImpl?: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeoutImpl?: (handle: unknown) => void;
  readonly onMessage?: (message: StudioEngineWorkerMessage) => void;
  readonly onFailure?: (failure: StudioEngineWorkerClientFailure) => void;
}

export interface StudioEngineAttachSurfaceInput {
  readonly surface: StudioEngineOffscreenSurface;
  readonly surfaceId: string;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly colorSpace?: "srgb" | "display-p3";
  readonly alphaMode?: "premultiplied" | "opaque";
}

export interface StudioEngineWorkerClientSnapshot {
  readonly phase: "handshaking" | "ready" | "failed" | "disposed";
  readonly sessionEpoch: number;
  readonly lastSentCommandSequence: number;
  readonly lastAcceptedCommandSequence: number;
  readonly lastFrameSequence: number;
  readonly lastSignalSequence: number;
  readonly surfaceTransferred: boolean;
  readonly failure: StudioEngineWorkerClientFailure | null;
}

export interface StudioEngineWorkerSession {
  readonly ready: Promise<StudioEngineHelloAckMessage>;
  readonly pointerProducer: StudioSharedPointerRingProducer | null;
  attachSurface(
    input: StudioEngineAttachSurfaceInput,
  ): Promise<number>;
  setTool(command: StudioEngineToolCommand): Promise<number>;
  sendCommand(command: StudioEngineCommand): Promise<number>;
  writePointer(
    sample: StudioSharedPointerSample,
  ): StudioSharedPointerWriteResult | "unavailable";
  snapshot(): StudioEngineWorkerClientSnapshot;
  dispose(): void;
}

function defaultWorkerFactory(): StudioEngineWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("../studio-engine.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-studio-engine",
  });
}

function safeEpoch(): number {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1_000);
  return timestamp * 1_000 + random;
}

function normalizeFailure(
  code: StudioEngineWorkerClientFailureCode,
  message: string,
): StudioEngineWorkerClientFailure {
  return Object.freeze({ code, message });
}

export function createStudioEngineWorkerSession(
  options: StudioEngineWorkerSessionOptions,
): StudioEngineWorkerSession {
  const sessionEpoch = options.sessionEpoch ?? safeEpoch();
  const setTimer =
    options.setTimeoutImpl
    ?? ((callback: () => void, milliseconds: number) =>
      setTimeout(callback, milliseconds));
  const clearTimer =
    options.clearTimeoutImpl
    ?? ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  const handshakeTimeoutMilliseconds = Math.max(
    100,
    options.handshakeTimeoutMilliseconds ?? 5_000,
  );
  const ring = createStudioSharedPointerRingBuffer({
    capacity: options.pointerRingCapacity ?? 4_096,
    environment: options.pointerRingEnvironment,
  });
  const pointerProducer = ring.ok ? ring.producer : null;

  let phase: StudioEngineWorkerClientSnapshot["phase"] = "handshaking";
  let failure: StudioEngineWorkerClientFailure | null = null;
  let worker: StudioEngineWorkerLike | null = null;
  let handshakeTimer: unknown = null;
  let surfaceTransferred = false;
  let commandSequence = 0;
  let negotiatedMaxInFlightCommands = 0;
  let validationState: StudioEngineWorkerValidationState = {
    sessionEpoch,
    lastSentCommandSequence: 0,
    lastAcceptedCommandSequence: 0,
    lastFrameSequence: 0,
    lastSignalSequence: 0,
  };

  let resolveReady:
    ((acknowledgement: StudioEngineHelloAckMessage) => void) | null = null;
  let rejectReady: ((failure: StudioEngineWorkerClientFailure) => void) | null =
    null;
  const ready = new Promise<StudioEngineHelloAckMessage>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A failed capability probe may happen before the consumer awaits `ready`.
  // Attach a rejection observer without changing the promise returned to callers.
  void ready.catch(() => undefined);

  const closeWorker = (): void => {
    if (handshakeTimer !== null) {
      clearTimer(handshakeTimer);
      handshakeTimer = null;
    }
    if (worker) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      worker.terminate();
      worker = null;
    }
  };

  const fail = (
    code: StudioEngineWorkerClientFailureCode,
    message: string,
  ): StudioEngineWorkerClientFailure => {
    if (phase === "failed" || phase === "disposed") {
      return failure ?? normalizeFailure(code, message);
    }
    failure = normalizeFailure(code, message);
    phase = "failed";
    pointerProducer?.close();
    closeWorker();
    rejectReady?.(failure);
    resolveReady = null;
    rejectReady = null;
    options.onFailure?.(failure);
    return failure;
  };

  const post = (message: unknown, transfers: Transferable[]): void => {
    if (!worker || phase === "failed" || phase === "disposed") {
      throw fail("worker-failed", "Engine Worker is not available.");
    }
    try {
      worker.postMessage(message, transfers);
    } catch (error) {
      throw fail(
        "transport",
        error instanceof Error
          ? error.message
          : "Engine Worker message transfer failed.",
      );
    }
  };

  const sendCommandNow = (
    command: StudioEngineCommand,
    runtimeSurface?: StudioEngineOffscreenSurface,
  ): number => {
    if (phase !== "ready") {
      throw fail("protocol", "Engine command was sent before handshake completion.");
    }
    if (
      negotiatedMaxInFlightCommands <= 0
      || commandSequence - validationState.lastAcceptedCommandSequence
        >= negotiatedMaxInFlightCommands
    ) {
      throw fail(
        "protocol",
        "Engine command window exceeded the negotiated in-flight budget.",
      );
    }
    commandSequence += 1;
    const message: StudioEngineCommandMessage = {
      type: "studio-engine/command",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch,
      commandSequence,
      command,
    };
    const plan = describeStudioEngineCommandTransport(message);
    const transfers: Transferable[] = [...plan.transferableArrayBuffers];
    let outbound: unknown = message;
    if (command.kind === "attach-surface") {
      if (!runtimeSurface) {
        throw fail("protocol", "attach-surface is missing its runtime transfer.");
      }
      const envelope: StudioEngineRuntimeCommandEnvelope = {
        type: "studio-engine/runtime-command",
        message,
        runtimeTransfers: [{
          kind: "offscreen-canvas",
          slot: command.runtimeTransfer.slot,
          surface: runtimeSurface,
        }],
      };
      outbound = envelope;
      transfers.push(runtimeSurface as unknown as Transferable);
    }
    post(outbound, transfers);
    validationState = {
      ...validationState,
      lastSentCommandSequence: commandSequence,
    };
    return commandSequence;
  };

  async function configureRing(): Promise<void> {
    if (!ring.ok) {
      throw fail(
        "pointer-ring-unavailable",
        `Shared pointer ring is unavailable: ${ring.reason}.`,
      );
    }
    sendCommandNow({
      kind: "configure-pointer-ring",
      descriptor: ring.descriptor,
    });
  }

  function onMessage(event: MessageEventLike): void {
    if (phase === "failed" || phase === "disposed") return;
    if (phase === "handshaking") {
      const parsed = parseStudioEngineHelloAck(event.data, sessionEpoch);
      if (!parsed.ok) {
        fail(
          "protocol",
          `Invalid Engine Worker handshake: ${parsed.reason} at ${parsed.path}.`,
        );
        return;
      }
      if (
        !ring.ok
        || ring.descriptor.capacity
          > parsed.value.limits.maxPointerRingSamples
      ) {
        fail(
          "protocol",
          "Engine Worker negotiated a pointer ring limit below the active descriptor.",
        );
        return;
      }
      if (handshakeTimer !== null) {
        clearTimer(handshakeTimer);
        handshakeTimer = null;
      }
      phase = "ready";
      negotiatedMaxInFlightCommands =
        parsed.value.limits.maxInFlightCommands;
      resolveReady?.(parsed.value);
      resolveReady = null;
      rejectReady = null;
      void configureRing().catch(() => undefined);
      return;
    }
    if (
      isAcceptedPrefix(event.data)
      && event.data.acceptedThroughCommandSequence
        <= validationState.lastAcceptedCommandSequence
    ) {
      fail("protocol", "Duplicate or stale accepted-prefix receipt.");
      return;
    }
    const parsed = parseStudioEngineWorkerMessage(
      event.data,
      validationState,
    );
    if (!parsed.ok) {
      fail(
        "protocol",
        `Invalid Engine Worker message: ${parsed.reason} at ${parsed.path}.`,
      );
      return;
    }
    validationState = parsed.value.nextState;
    options.onMessage?.(parsed.value.message);
    if (
      parsed.value.message.type === "studio-engine/signal"
      && (
        parsed.value.message.signal.kind === "fatal"
        || parsed.value.message.signal.kind === "overflow"
        || parsed.value.message.signal.kind === "device-lost"
      )
    ) {
      fail(
        "worker-failed",
        `Engine Worker failed closed: ${parsed.value.message.signal.kind}.`,
      );
    }
  }

  function onWorkerError(event: ErrorEventLike): void {
    event.preventDefault?.();
    fail("worker-failed", "Engine Worker execution failed.");
  }

  const factory =
    options.workerFactory === undefined
      ? defaultWorkerFactory
      : options.workerFactory;
  const missingFutureCapabilities = missingStudioEngineFutureCapabilities(
    options.capabilities,
  );
  if (missingFutureCapabilities.length > 0) {
    fail(
      "future-capabilities-required",
      `Studio Engine vNext requires: ${missingFutureCapabilities.join(", ")}.`,
    );
  } else if (!ring.ok) {
    fail(
      "pointer-ring-unavailable",
      `Shared pointer ring is unavailable: ${ring.reason}.`,
    );
  } else if (factory === null) {
    fail("worker-unavailable", "Engine Worker is unsupported in this environment.");
  } else {
    try {
      worker = factory();
    } catch (error) {
      fail(
        "worker-failed",
        error instanceof Error
          ? error.message
          : "Engine Worker construction failed.",
      );
    }
    if (!worker) {
      fail("worker-unavailable", "Engine Worker could not be constructed.");
    } else {
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);
      try {
        post({
          type: "studio-engine/hello",
          protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
          sessionEpoch,
          executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
          clientBuild: options.clientBuild,
          capabilities: options.capabilities,
        }, []);
        handshakeTimer = setTimer(() => {
          handshakeTimer = null;
          fail("handshake-timeout", "Engine Worker handshake timed out.");
        }, handshakeTimeoutMilliseconds);
      } catch {
        // post() already moved the session to its terminal failure state.
      }
    }
  }

  return {
    ready,
    pointerProducer,
    async attachSurface(input) {
      await ready;
      if (surfaceTransferred) {
        throw normalizeFailure(
          "surface-already-transferred",
          "The OffscreenCanvas surface has already transferred ownership.",
        );
      }
      surfaceTransferred = true;
      const command: StudioEngineAttachSurfaceCommand = {
        kind: "attach-surface",
        surfaceId: input.surfaceId,
        width: input.width,
        height: input.height,
        devicePixelRatio: input.devicePixelRatio,
        colorSpace: input.colorSpace ?? "srgb",
        alphaMode: input.alphaMode ?? "premultiplied",
        runtimeTransfer: {
          kind: "offscreen-canvas",
          slot: 0,
        },
      };
      return sendCommandNow(command, input.surface);
    },
    async setTool(command) {
      await ready;
      return sendCommandNow(command);
    },
    async sendCommand(command) {
      await ready;
      if (command.kind === "attach-surface") {
        throw normalizeFailure(
          "protocol",
          "Use attachSurface() so transfer ownership is explicit.",
        );
      }
      return sendCommandNow(command);
    },
    writePointer(sample) {
      if (phase !== "ready" || !pointerProducer) return "unavailable";
      const result = pointerProducer.write(sample);
      if (result === "full" || result === "corrupt-state") {
        fail(
          "worker-failed",
          `Pointer ring failed closed after ${result}.`,
        );
      }
      return result;
    },
    snapshot() {
      return Object.freeze({
        phase,
        sessionEpoch,
        lastSentCommandSequence: validationState.lastSentCommandSequence,
        lastAcceptedCommandSequence:
          validationState.lastAcceptedCommandSequence,
        lastFrameSequence: validationState.lastFrameSequence,
        lastSignalSequence: validationState.lastSignalSequence,
        surfaceTransferred,
        failure,
      });
    },
    dispose() {
      if (phase === "disposed") return;
      const wasHandshaking = phase === "handshaking";
      phase = "disposed";
      pointerProducer?.close();
      closeWorker();
      if (wasHandshaking) {
        const disposedFailure = normalizeFailure(
          "disposed",
          "Engine Worker session was disposed before it became ready.",
        );
        rejectReady?.(disposedFailure);
      }
      resolveReady = null;
      rejectReady = null;
    },
  };
}

function isAcceptedPrefix(
  value: unknown,
): value is {
  readonly type: "studio-engine/accepted-prefix";
  readonly acceptedThroughCommandSequence: number;
} {
  return (
    typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "studio-engine/accepted-prefix"
    && typeof (
      value as { acceptedThroughCommandSequence?: unknown }
    ).acceptedThroughCommandSequence === "number"
  );
}
