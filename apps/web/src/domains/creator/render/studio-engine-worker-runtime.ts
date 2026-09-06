import {
  STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
  attachStudioSharedPointerRingConsumer,
  type StudioPointerSampleRole,
  type StudioSharedPointerRingConsumer,
} from "../studio-shared-pointer-ring-buffer";

import {
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_WORKER_BUDGETS,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  missingStudioEngineFutureCapabilities,
  parseStudioEngineCommand,
  parseStudioEngineHello,
  validateStudioEngineSurfaceAgainstRuntime,
  type StudioEngineAttachSurfaceCommand,
  type StudioEngineCommandMessage,
  type StudioEngineCommandValidationState,
  type StudioEngineFrameReceipt,
  type StudioEngineHelloAckMessage,
  type StudioEngineSignal,
  type StudioEngineSignalMessage,
  type StudioEngineToolCommand,
  type StudioEngineWorkerMessage,
} from "./studio-engine-worker-protocol";

export const STUDIO_ENGINE_POINTER_FLAG_BEGIN = 1;
export const STUDIO_ENGINE_POINTER_FLAG_END = 1 << 1;
export const STUDIO_ENGINE_POINTER_FLAG_CANCEL = 1 << 2;
export const STUDIO_ENGINE_POINTER_BOUNDARY_MASK =
  STUDIO_ENGINE_POINTER_FLAG_BEGIN
  | STUDIO_ENGINE_POINTER_FLAG_END
  | STUDIO_ENGINE_POINTER_FLAG_CANCEL;

const MAX_TRANSIENT_AUTHORITATIVE_SAMPLES = 16_384;
const DEFAULT_RING_DRAIN_BUDGET = 4_096;

export interface StudioEngineTransientContext2d {
  globalAlpha: number;
  globalCompositeOperation: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  strokeStyle: string;
  beginPath(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  lineTo(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  stroke(): void;
}

export interface StudioEngineOffscreenSurface {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: { alpha?: boolean; colorSpace?: PredefinedColorSpace },
  ): StudioEngineTransientContext2d | null;
}

export interface StudioEngineRuntimeSurfaceTransfer {
  readonly kind: "offscreen-canvas";
  readonly slot: number;
  readonly surface: StudioEngineOffscreenSurface;
}

export interface StudioEngineRuntimeCommandEnvelope {
  readonly type: "studio-engine/runtime-command";
  readonly message: StudioEngineCommandMessage;
  readonly runtimeTransfers: readonly StudioEngineRuntimeSurfaceTransfer[];
}

export type StudioEngineRuntimeOutboundMessage =
  | StudioEngineHelloAckMessage
  | StudioEngineWorkerMessage;

export interface StudioEngineWorkerRuntimeOptions {
  readonly postMessage: (message: StudioEngineRuntimeOutboundMessage) => void;
  readonly engineBuild?: string;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void) => void;
  readonly schedulePoll?: (callback: () => void, milliseconds: number) => unknown;
  readonly cancelPoll?: (handle: unknown) => void;
  readonly ringDrainBudget?: number;
  readonly ringPollMilliseconds?: number;
}

export interface StudioEngineWorkerRuntimeSnapshot {
  readonly phase: "awaiting-hello" | "ready" | "failed" | "disposed";
  readonly sessionEpoch: number | null;
  readonly acceptedThroughCommandSequence: number;
  readonly acceptedAuthoritativeSampleSequence: number | null;
  readonly lastObservedSampleSequence: number | null;
  readonly activeStroke: boolean;
  readonly authoritativeSamplesInActiveStroke: number;
  readonly predictedSamplesPresented: number;
  readonly frames: number;
}

export interface StudioEngineWorkerRuntime {
  handleMessage(input: unknown): void;
  pollPointerRing(): void;
  failDevice(
    backend: "webgpu",
    reason: string,
    recoverable?: boolean,
  ): void;
  snapshot(): StudioEngineWorkerRuntimeSnapshot;
  dispose(): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

interface QueuedCommand {
  readonly message: StudioEngineCommandMessage;
  readonly runtimeTransfers: readonly StudioEngineRuntimeSurfaceTransfer[];
}

const DEFAULT_TOOL: StudioEngineToolCommand = Object.freeze({
  kind: "set-tool",
  toolRevision: 1,
  toolId: "engine-transient-pen",
  brushSize: 4,
  opacity: 1,
  flow: 1,
  hardness: 1,
  spacing: 0.1,
  colorRgba: Object.freeze([0, 0, 0, 1] as const),
  blendMode: "source-over",
  stabilizer: 0,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRuntimeSurface(value: unknown): value is StudioEngineOffscreenSurface {
  return (
    typeof value === "object"
    && value !== null
    && "getContext" in value
    && typeof (value as { getContext?: unknown }).getContext === "function"
    && "width" in value
    && "height" in value
  );
}

function parseRuntimeEnvelope(
  input: unknown,
): {
  readonly message: unknown;
  readonly runtimeTransfers: readonly StudioEngineRuntimeSurfaceTransfer[];
} | null {
  if (
    !isRecord(input)
    || input.type !== "studio-engine/runtime-command"
    || !Object.keys(input).every((key) =>
      key === "type" || key === "message" || key === "runtimeTransfers")
    || !Array.isArray(input.runtimeTransfers)
    || input.runtimeTransfers.length > 1
  ) {
    return null;
  }
  const transfers: StudioEngineRuntimeSurfaceTransfer[] = [];
  for (const transfer of input.runtimeTransfers) {
    if (
      !isRecord(transfer)
      || !Object.keys(transfer).every((key) =>
        key === "kind" || key === "slot" || key === "surface")
      || transfer.kind !== "offscreen-canvas"
      || !Number.isSafeInteger(transfer.slot)
      || (transfer.slot as number) < 0
      || (transfer.slot as number) > 15
      || !isRuntimeSurface(transfer.surface)
    ) {
      return null;
    }
    transfers.push(transfer as unknown as StudioEngineRuntimeSurfaceTransfer);
  }
  return { message: input.message, runtimeTransfers: transfers };
}

function colorToCss(
  color: readonly [number, number, number, number],
): string {
  const [red, green, blue, alpha] = color;
  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}

function pressureLevel(
  queuedCommands: number,
  queuedPointerSamples: number,
): "none" | "soft" | "hard" {
  if (
    queuedCommands >= STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands
    || queuedPointerSamples >= STUDIO_ENGINE_WORKER_BUDGETS.maxQueuedPointerSamples
  ) {
    return "hard";
  }
  if (
    queuedCommands >= STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands * 0.75
    || queuedPointerSamples >= STUDIO_ENGINE_WORKER_BUDGETS.maxQueuedPointerSamples * 0.75
  ) {
    return "soft";
  }
  return "none";
}

export function createStudioEngineWorkerRuntime(
  options: StudioEngineWorkerRuntimeOptions,
): StudioEngineWorkerRuntime {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? queueMicrotask;
  const schedulePoll = options.schedulePoll ?? ((callback, milliseconds) =>
    setTimeout(callback, milliseconds));
  const cancelPoll = options.cancelPoll ?? ((handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>));
  const ringDrainBudget = Math.min(
    STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples,
    Math.max(1, Math.floor(options.ringDrainBudget ?? DEFAULT_RING_DRAIN_BUDGET)),
  );
  const ringPollMilliseconds = Math.max(
    1,
    Math.floor(options.ringPollMilliseconds ?? 8),
  );

  let phase: StudioEngineWorkerRuntimeSnapshot["phase"] = "awaiting-hello";
  let sessionEpoch: number | null = null;
  let commandState: StudioEngineCommandValidationState | null = null;
  let commandQueue: QueuedCommand[] = [];
  let flushScheduled = false;
  let pointerConsumer: StudioSharedPointerRingConsumer | null = null;
  let pointerPollHandle: unknown = null;
  let lastDroppedCount = 0;
  let surface: StudioEngineOffscreenSurface | null = null;
  let context: StudioEngineTransientContext2d | null = null;
  let surfaceId = "";
  let tool = DEFAULT_TOOL;
  let documentRevision = 0;
  let frameSequence = 0;
  let signalSequence = 0;
  let lastObservedSampleSequence: number | null = null;
  let acceptedAuthoritativeSampleSequence: number | null = null;
  let activePointerId: number | null = null;
  let activeChannel: number | null = null;
  let authoritativePoints: Point[] = [];
  let predictedPoints: Point[] = [];

  const post = (message: StudioEngineRuntimeOutboundMessage): boolean => {
    if (phase === "disposed") return false;
    try {
      options.postMessage(message);
      return true;
    } catch {
      phase = "failed";
      stopPolling();
      return false;
    }
  };

  const stopPolling = (): void => {
    if (pointerPollHandle !== null) {
      cancelPoll(pointerPollHandle);
      pointerPollHandle = null;
    }
  };

  const emitSignal = (signal: StudioEngineSignal): void => {
    if (sessionEpoch === null || phase === "disposed") return;
    signalSequence += 1;
    const message: StudioEngineSignalMessage = {
      type: "studio-engine/signal",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch,
      signalSequence,
      signal,
    };
    post(message);
  };

  const fail = (
    code: string,
    message: string,
    relatedCommandSequence: number | null,
  ): void => {
    if (phase === "failed" || phase === "disposed") return;
    phase = "failed";
    stopPolling();
    commandQueue = [];
    clearTransient();
    emitSignal({
      kind: "fatal",
      code,
      message,
      relatedCommandSequence,
    });
  };

  const clearTransient = (): void => {
    if (context && surface) {
      try {
        context.clearRect(0, 0, surface.width, surface.height);
      } catch {
        // The caller that notices a drawing failure transitions to failed.
      }
    }
    authoritativePoints = [];
    predictedPoints = [];
    activePointerId = null;
    activeChannel = null;
  };

  const configurePaint = (predicted: boolean): void => {
    if (!context) return;
    context.globalCompositeOperation =
      tool.blendMode === "destination-out" ? "destination-out" : "source-over";
    context.globalAlpha =
      tool.opacity * tool.flow * (predicted ? 0.35 : 1);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = tool.brushSize;
    context.strokeStyle = colorToCss(tool.colorRgba);
  };

  const strokePoints = (
    points: readonly Point[],
    predicted: boolean,
  ): void => {
    if (!context || points.length === 0) return;
    configurePaint(predicted);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      context.lineTo(points[0].x + 0.001, points[0].y + 0.001);
    } else {
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
    }
    context.stroke();
  };

  const repaintTransient = (): void => {
    if (!context || !surface) return;
    context.clearRect(0, 0, surface.width, surface.height);
    strokePoints(authoritativePoints, false);
    if (predictedPoints.length > 0) {
      const tail = authoritativePoints.at(-1);
      strokePoints(tail ? [tail, ...predictedPoints] : predictedPoints, true);
    }
  };

  const emitFrame = (pointerSamplesRendered: number, startedAt: number): void => {
    if (
      sessionEpoch === null
      || !commandState
      || !surface
      || !surfaceId
      || pointerSamplesRendered === 0
    ) {
      return;
    }
    frameSequence += 1;
    const presentedAt = now();
    const receipt: StudioEngineFrameReceipt = {
      type: "studio-engine/frame",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch,
      frameSequence,
      acceptedThroughCommandSequence:
        commandState.lastAcceptedCommandSequence,
      surfaceId,
      documentRevision,
      presentedAt,
      cpuMilliseconds: Math.max(0, presentedAt - startedAt),
      gpuMilliseconds: null,
      pointerSamplesRendered,
      droppedFrames: 0,
    };
    post(receipt);
  };

  const acceptSample = (
    x: number,
    y: number,
    pressure: number,
    pointerId: number,
    sequence: number,
    role: StudioPointerSampleRole,
    channel: number,
    flags: number,
  ): void => {
    if (phase !== "ready") return;
    if (
      lastObservedSampleSequence !== null
      && sequence <= lastObservedSampleSequence
    ) {
      fail("pointer-sequence", "Pointer sample sequence is stale or duplicated.", null);
      return;
    }
    lastObservedSampleSequence = sequence;
    const boundary = flags & STUDIO_ENGINE_POINTER_BOUNDARY_MASK;
    if (
      (flags & ~STUDIO_ENGINE_POINTER_BOUNDARY_MASK) !== 0
      || (boundary & STUDIO_ENGINE_POINTER_FLAG_CANCEL) !== 0
        && boundary !== STUDIO_ENGINE_POINTER_FLAG_CANCEL
      || (boundary & STUDIO_ENGINE_POINTER_FLAG_BEGIN) !== 0
        && (boundary & STUDIO_ENGINE_POINTER_FLAG_END) !== 0
    ) {
      fail("pointer-boundary", "Pointer sample contains an invalid boundary combination.", null);
      return;
    }

    if (role === STUDIO_POINTER_SAMPLE_ROLE_PREDICTED) {
      if (
        boundary !== 0
        || activePointerId !== pointerId
        || activeChannel !== channel
      ) {
        fail("predicted-boundary", "Predicted samples cannot create or close a stroke.", null);
        return;
      }
      predictedPoints.push({ x, y, pressure });
      if (predictedPoints.length > ringDrainBudget) {
        predictedPoints = predictedPoints.slice(-ringDrainBudget);
      }
      repaintTransient();
      return;
    }

    predictedPoints = [];
    if (boundary === STUDIO_ENGINE_POINTER_FLAG_CANCEL) {
      if (activePointerId !== pointerId || activeChannel !== channel) {
        fail("pointer-cancel", "Pointer cancel does not match the active stroke.", null);
        return;
      }
      acceptedAuthoritativeSampleSequence = sequence;
      clearTransient();
      return;
    }
    if ((boundary & STUDIO_ENGINE_POINTER_FLAG_BEGIN) !== 0) {
      if (activePointerId !== null) {
        fail("pointer-overlap", "Only one transient stroke may be active in this migration slice.", null);
        return;
      }
      clearTransient();
      activePointerId = pointerId;
      activeChannel = channel;
    } else if (activePointerId !== pointerId || activeChannel !== channel) {
      fail("pointer-orphan", "Pointer sample arrived outside an active stroke.", null);
      return;
    }

    authoritativePoints.push({ x, y, pressure });
    if (authoritativePoints.length > MAX_TRANSIENT_AUTHORITATIVE_SAMPLES) {
      fail("transient-budget", "Transient authoritative stroke exceeded its bounded sample budget.", null);
      return;
    }
    acceptedAuthoritativeSampleSequence = sequence;
    repaintTransient();
    if ((boundary & STUDIO_ENGINE_POINTER_FLAG_END) !== 0) {
      activePointerId = null;
      activeChannel = null;
      authoritativePoints = [];
      predictedPoints = [];
    }
  };

  const drainPointerRing = (): void => {
    if (phase !== "ready" || !pointerConsumer) return;
    const before = pointerConsumer.diagnostics();
    if (before.dropped > lastDroppedCount || before.corruptStates > 0) {
      const droppedCount = Math.max(1, before.dropped - lastDroppedCount);
      emitSignal({
        kind: "overflow",
        source: "pointer-ring",
        droppedCount,
        acceptedThroughCommandSequence:
          commandState?.lastAcceptedCommandSequence ?? 0,
      });
      fail("pointer-ring-overflow", "Pointer ring overflowed or became corrupt.", null);
      return;
    }
    const startedAt = now();
    const result = pointerConsumer.drain(
      (
        x,
        y,
        pressure,
        _tiltX,
        _tiltY,
        _twist,
        _time,
        pointerId,
        sequence,
        role,
        channel,
        flags,
      ) => {
        acceptSample(
          x,
          y,
          pressure,
          pointerId,
          sequence,
          role,
          channel,
          flags,
        );
      },
      Math.min(ringDrainBudget, before.available),
    );
    if (phase !== "ready") return;
    const after = pointerConsumer.diagnostics();
    if (
      result.state === "corrupt-state"
      || after.corruptStates > 0
      || after.dropped > before.dropped
    ) {
      const droppedCount = Math.max(1, after.dropped - lastDroppedCount);
      emitSignal({
        kind: "overflow",
        source: "pointer-ring",
        droppedCount,
        acceptedThroughCommandSequence:
          commandState?.lastAcceptedCommandSequence ?? 0,
      });
      fail("pointer-ring-overflow", "Pointer ring overflowed while draining.", null);
      return;
    }
    lastDroppedCount = after.dropped;
    emitFrame(result.read, startedAt);
  };

  const schedulePointerPoll = (): void => {
    if (phase !== "ready" || !pointerConsumer || pointerPollHandle !== null) {
      return;
    }
    pointerPollHandle = schedulePoll(() => {
      pointerPollHandle = null;
      drainPointerRing();
      schedulePointerPoll();
    }, ringPollMilliseconds);
  };

  const attachSurface = (
    command: StudioEngineAttachSurfaceCommand,
    transfers: readonly StudioEngineRuntimeSurfaceTransfer[],
    relatedCommandSequence: number,
  ): boolean => {
    if (surface || context || transfers.length !== 1) {
      fail("surface-transfer", "Surface transfer must be attached exactly once.", relatedCommandSequence);
      return false;
    }
    const transfer = transfers[0];
    if (
      transfer.kind !== command.runtimeTransfer.kind
      || transfer.slot !== command.runtimeTransfer.slot
    ) {
      fail("surface-transfer", "Surface transfer slot does not match the command.", relatedCommandSequence);
      return false;
    }
    const runtimeBudget = validateStudioEngineSurfaceAgainstRuntime(command, {
      negotiatedMaxTextureDimension2D:
        STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
      runtimeMaxTextureDimension2D:
        STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
      runtimeMaxSurfaceBytes: STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceBytes,
    });
    if (!runtimeBudget.ok) {
      fail("surface-budget", "Surface exceeds the runtime allocation budget.", relatedCommandSequence);
      return false;
    }
    try {
      transfer.surface.width = command.width;
      transfer.surface.height = command.height;
      const nextContext = transfer.surface.getContext("2d", {
        alpha: command.alphaMode !== "opaque",
        colorSpace: command.colorSpace,
      });
      if (!nextContext) {
        fail("surface-context", "OffscreenCanvas 2D context is unavailable.", relatedCommandSequence);
        return false;
      }
      surface = transfer.surface;
      context = nextContext;
      surfaceId = command.surfaceId;
      return true;
    } catch {
      fail("surface-context", "OffscreenCanvas surface initialization failed.", relatedCommandSequence);
      return false;
    }
  };

  const acceptCommand = (queued: QueuedCommand): void => {
    if (phase !== "ready" || !commandState || sessionEpoch === null) return;
    const parsed = parseStudioEngineCommand(queued.message, commandState);
    if (!parsed.ok) {
      fail(
        "command-protocol",
        `Engine command rejected: ${parsed.reason} at ${parsed.path}.`,
        typeof queued.message.commandSequence === "number"
          ? queued.message.commandSequence
          : null,
      );
      return;
    }
    const { message, nextState } = parsed.value;
    if (
      message.command.kind !== "attach-surface"
      && queued.runtimeTransfers.length > 0
    ) {
      fail("unexpected-transfer", "Only attach-surface may carry a runtime transfer.", message.commandSequence);
      return;
    }
    switch (message.command.kind) {
      case "attach-surface":
        if (!attachSurface(
          message.command,
          queued.runtimeTransfers,
          message.commandSequence,
        )) {
          return;
        }
        break;
      case "configure-pointer-ring": {
        if (pointerConsumer) {
          fail("pointer-ring-reconfigure", "Pointer ring is immutable for this engine epoch.", message.commandSequence);
          return;
        }
        const attached = attachStudioSharedPointerRingConsumer(
          message.command.descriptor,
        );
        if (!attached.ok) {
          fail(
            "pointer-ring-attach",
            `Pointer ring attach failed: ${attached.reason}.`,
            message.commandSequence,
          );
          return;
        }
        pointerConsumer = attached.consumer;
        lastDroppedCount = pointerConsumer.diagnostics().dropped;
        schedulePointerPoll();
        break;
      }
      case "pointer-batch": {
        const startedAt = now();
        const batch = message.command.batch;
        for (let index = 0; index < batch.sampleCount; index += 1) {
          const offset = index * 12;
          acceptSample(
            batch.samples[offset],
            batch.samples[offset + 1],
            batch.samples[offset + 2],
            batch.samples[offset + 7],
            batch.samples[offset + 8],
            batch.samples[offset + 9] as StudioPointerSampleRole,
            batch.samples[offset + 10],
            batch.samples[offset + 11],
          );
          if (phase !== "ready") return;
        }
        emitFrame(batch.sampleCount, startedAt);
        break;
      }
      case "set-tool":
        tool = message.command;
        break;
      case "apply-document-patch":
        documentRevision = message.command.documentRevision;
        break;
      case "set-viewport":
        break;
    }
    commandState = nextState;
    const diagnostics = pointerConsumer?.diagnostics();
    const queuedPointerSamples = diagnostics?.available ?? 0;
    post({
      type: "studio-engine/accepted-prefix",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch,
      acceptedThroughCommandSequence:
        commandState.lastAcceptedCommandSequence,
      queuedCommands: commandQueue.length,
      queuedPointerSamples,
      pressure: pressureLevel(commandQueue.length, queuedPointerSamples),
    });
    if (message.command.kind === "configure-pointer-ring") {
      drainPointerRing();
    }
  };

  const flushCommands = (): void => {
    flushScheduled = false;
    while (phase === "ready" && commandQueue.length > 0) {
      const next = commandQueue.shift();
      if (next) acceptCommand(next);
    }
  };

  const enqueueCommand = (
    message: StudioEngineCommandMessage,
    runtimeTransfers: readonly StudioEngineRuntimeSurfaceTransfer[],
  ): void => {
    if (phase !== "ready") {
      fail("command-before-ready", "Engine command arrived before a valid hello.", null);
      return;
    }
    if (commandQueue.length >= STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands) {
      emitSignal({
        kind: "overflow",
        source: "command-queue",
        droppedCount: 1,
        acceptedThroughCommandSequence:
          commandState?.lastAcceptedCommandSequence ?? 0,
      });
      fail("command-queue-overflow", "Engine command queue overflowed.", message.commandSequence);
      return;
    }
    commandQueue.push({ message, runtimeTransfers });
    if (!flushScheduled) {
      flushScheduled = true;
      schedule(flushCommands);
    }
  };

  return {
    handleMessage(input) {
      if (phase === "disposed") return;
      if (phase === "awaiting-hello") {
        const hello = parseStudioEngineHello(input);
        if (!hello.ok) {
          phase = "failed";
          return;
        }
        sessionEpoch = hello.value.sessionEpoch;
        commandState = {
          sessionEpoch,
          lastAcceptedCommandSequence: 0,
        };
        const missingCapabilities = missingStudioEngineFutureCapabilities(
          hello.value.capabilities,
        );
        if (missingCapabilities.length > 0) {
          phase = "failed";
          return;
        }
        phase = "ready";
        post({
          type: "studio-engine/hello-ack",
          protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
          sessionEpoch,
          executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
          engineBuild: options.engineBuild ?? "engine-worker-vnext",
          limits: {
            maxInFlightCommands: STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands,
            maxPointerBatchSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples,
            maxPointerRingSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerRingSamples,
            maxDocumentPatchBytes: STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes,
          },
        });
        return;
      }
      if (phase !== "ready") return;
      const envelope = parseRuntimeEnvelope(input);
      if (envelope) {
        enqueueCommand(
          envelope.message as StudioEngineCommandMessage,
          envelope.runtimeTransfers,
        );
        return;
      }
      if (
        isRecord(input)
        && input.type === "studio-engine/command"
      ) {
        enqueueCommand(input as unknown as StudioEngineCommandMessage, []);
        return;
      }
      fail("hostile-message", "Engine Worker received an unknown message envelope.", null);
    },
    pollPointerRing: drainPointerRing,
    failDevice(backend, reason, recoverable = false) {
      if (phase !== "ready") return;
      emitSignal({ kind: "device-lost", backend, reason, recoverable });
      fail("device-lost", `Rendering backend failed: ${reason}`, null);
    },
    snapshot() {
      return Object.freeze({
        phase,
        sessionEpoch,
        acceptedThroughCommandSequence:
          commandState?.lastAcceptedCommandSequence ?? 0,
        acceptedAuthoritativeSampleSequence,
        lastObservedSampleSequence,
        activeStroke: activePointerId !== null,
        authoritativeSamplesInActiveStroke: authoritativePoints.length,
        predictedSamplesPresented: predictedPoints.length,
        frames: frameSequence,
      });
    },
    dispose() {
      if (phase === "disposed") return;
      stopPolling();
      commandQueue = [];
      clearTransient();
      pointerConsumer = null;
      context = null;
      surface = null;
      phase = "disposed";
    },
  };
}
