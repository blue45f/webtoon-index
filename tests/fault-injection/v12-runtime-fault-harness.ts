import { createHash } from "node:crypto";

import {
  CommandBus,
  FaultInjectingJournalStore,
  InjectedStorageFault,
  createEmptyScene,
  listNodeIds,
  polylineToPath,
  projectDigest,
  recoverProject,
  solidPaint,
} from "@toonspectrum/studio-project-model";

import { StudioCrdtDocument } from "../../apps/web/src/domains/creator/live/studio-crdt-document";
import {
  SerializedStudioCrdtOutbox,
  SqliteStudioCrdtOutbox,
} from "../../apps/web/src/domains/creator/live/studio-crdt-outbox";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  decodeStudioCrdtStateVector,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
  type StudioCrdtSyncRequest,
  type StudioCrdtSyncResponse,
  type StudioCrdtTransportMessage,
  type StudioCrdtUpdateAck,
  type StudioCrdtUpdateRequest,
} from "../../apps/web/src/domains/creator/live/studio-crdt-protocol";
import {
  PersistentStudioCrdtRecoveryVault,
  createStudioCrdtRecoverySqlitePersistence,
} from "../../apps/web/src/domains/creator/live/studio-crdt-recovery-vault";
import { StudioCrdtRoomBinding } from "../../apps/web/src/domains/creator/live/studio-crdt-room-binding";
import { StudioLiveRoom } from "../../apps/web/src/domains/creator/live/studio-live-collaboration-room";
import {
  createStudioEngineWorkerSession,
  type StudioEngineWorkerLike,
} from "../../apps/web/src/domains/creator/render/studio-engine-worker-client";
import {
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_WORKER_BUDGETS,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  type StudioEngineCapabilitySnapshot,
  type StudioEngineHelloAckMessage,
} from "../../apps/web/src/domains/creator/render/studio-engine-worker-protocol";
import {
  acquireStudioGpuDevice,
  activeStudioGpuDeviceLeaseCount,
  disposeStudioGpuFabric,
  onStudioGpuDeviceLost,
} from "../../apps/web/src/domains/creator/render/studio-gpu-fabric";
import {
  createDeviceLossRecovery,
  type StudioDeviceLossClock,
  type StudioDeviceLossTournamentPort,
  type StudioGpuDeviceLike,
} from "../../apps/web/src/domains/creator/studio-device-loss-recovery";
import {
  requireStudioCrdtOutboxDatabase,
  openStudioLocalDatabase,
  type StudioLocalDatabase,
} from "../../apps/web/src/domains/creator/studio-local-database";
import {
  createStudioOpfsAssetStore,
  STUDIO_OPFS_QUOTA_RESERVE_BYTES,
} from "../../apps/web/src/domains/creator/studio-opfs-asset-store";
import {
  createStudioOpfsMemoryFileSystem,
  StudioOpfsError,
} from "../../apps/web/src/domains/creator/studio-opfs-filesystem";
import { createSqliteJournalStore } from "../../apps/web/src/domains/creator/studio-sqlite-journal-store";
import {
  createStudioVrmTexturePaintGpuUploadPlan,
  executeStudioVrmTexturePaintGpuUpload,
  type StudioVrmTexturePaintGpuUploadExecutionResult,
} from "../../apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-gpu-upload";

import type { StudioCrdtDrawStrokePayload } from "../../apps/web/src/domains/creator/live/studio-crdt-document";
import type {
  StudioLiveTransport,
  StudioLiveTransportControlEvent,
} from "../../apps/web/src/domains/creator/live/studio-live-collaboration-transport";
import type {
  CommandIR,
  SceneNodeIR,
} from "@toonspectrum/studio-project-model";

export const V12_FAULT_MATRIX_TARGETS = Object.freeze({
  deviceLossCycles: 100,
  workerKillCycles: 1_000,
  queueCompletionFlights: 64,
  journalCrashReopens: 64,
} as const);

export interface V12RuntimeFaultMeasurements {
  readonly deviceLoss: {
    readonly fabricCycles: number;
    readonly fabricNotifications: number;
    readonly isolatedThrowingListenerCalls: number;
    readonly detachedListenerCalls: number;
    readonly uniqueDeviceEpochs: number;
    readonly recoveryCycles: number;
    readonly recoveryDiscards: number;
    readonly tournamentKills: number;
    readonly tournamentRevives: number;
    readonly permanentDemotions: number;
    readonly stagedCommands: number;
    readonly replayedCommands: number;
    readonly duplicateReplays: number;
    readonly lostCommands: number;
    readonly staleLossSignalsAccepted: number;
    readonly pendingTimers: number;
    readonly activeLeasesAfterLoss: number;
    readonly pendingLossPromises: number;
  };
  readonly workerTermination: {
    readonly cycles: number;
    readonly failedClosed: number;
    readonly terminateCalls: number;
    readonly acceptedPrefixesPreserved: number;
    readonly staleMessagesAttempted: number;
    readonly staleMessagesApplied: number;
    readonly duplicateAcceptedCommits: number;
    readonly pendingListeners: number;
    readonly pendingTimers: number;
    readonly openPointerRings: number;
    readonly pendingReadyPromises: number;
  };
  readonly queueCompletionInversion: {
    readonly flights: number;
    readonly queueWrites: number;
    readonly reverseCompletions: number;
    readonly uploadedCurrentGeneration: number;
    readonly rejectedStaleGenerations: number;
    readonly staleResultsApplied: number;
    readonly completionOrderViolations: number;
    readonly pendingFlightPromises: number;
  };
  readonly journalRecovery: {
    readonly crashReopens: number;
    readonly acceptedEdits: number;
    readonly recoveredEdits: number;
    readonly lostAcceptedEdits: number;
    readonly duplicateJournalSequences: number;
    readonly recoveryIssues: number;
    readonly snapshotCheckpoints: number;
    readonly listenerNotifications: number;
    readonly digestMatches: number;
  };
  readonly storageFaults: {
    readonly rejectedWrites: number;
    readonly rejectedWriteStateAdvances: number;
    readonly successfulSameSequenceRetries: number;
    readonly tornWrites: number;
    readonly crcCorruptionsDetected: number;
    readonly corruptSnapshotsRejected: number;
    readonly duplicateJournalSequences: number;
    readonly quotaRejections: number;
    readonly filesWrittenAfterQuotaReject: number;
    readonly atomicWriteRejections: number;
    readonly filesWrittenAfterWriteReject: number;
    readonly corruptBlobsDetected: number;
    readonly corruptBlobBytesApplied: number;
  };
  readonly collaboration: {
    readonly offlineEdits: number;
    readonly durableOutboxRowsBeforeReconnect: number;
    readonly publicationsWhileOffline: number;
    readonly publicationAttempts: number;
    readonly retryMetadataRows: number;
    readonly stableUpdateIdsAcrossRetry: number;
    readonly stablePayloadsAcrossRetry: number;
    readonly authoritativeServerApplies: number;
    readonly durableOutboxRowsAfterAck: number;
    readonly convergedStateVectors: number;
    readonly lostAcceptedEdits: number;
    readonly duplicateServerCommits: number;
    readonly pendingTimersAfterClose: number;
    readonly pendingIntervalsAfterClose: number;
    readonly transportListenersAfterClose: number;
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(cause?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  rounds = 400,
): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    if (await predicate()) return;
    await flushMicrotasks(2);
  }
  throw new Error(`V12 fault harness timed out waiting for ${label}`);
}

function countDuplicates(values: readonly (number | string)[]): number {
  return values.length - new Set(values).size;
}

/* -------------------------------------------------------------------------- */
/* GPU fabric + device epoch recovery                                         */
/* -------------------------------------------------------------------------- */

interface ControlledLostDevice extends StudioGpuDeviceLike {
  readonly gpuDevice: GPUDevice;
  lose(reason?: string): void;
  settled(): boolean;
}

function controlledLostDevice(): ControlledLostDevice {
  const loss = deferred<{ reason?: unknown; message?: unknown } | undefined>();
  let settled = false;
  const gpuDevice = {
    lost: loss.promise,
    destroy() {},
    limits: {
      maxTextureDimension2D: 16_384,
      maxBufferSize: 256 * 1_024 * 1_024,
      maxStorageBufferBindingSize: 128 * 1_024 * 1_024,
      maxComputeWorkgroupsPerDimension: 65_535,
      maxComputeInvocationsPerWorkgroup: 256,
    },
    features: new Set<string>(),
  } as unknown as GPUDevice;
  return {
    lost: loss.promise,
    gpuDevice,
    lose(reason = "destroyed") {
      if (settled) return;
      settled = true;
      loss.resolve({ reason, message: "V12 deterministic fault injection" });
    },
    settled: () => settled,
  };
}

class DeviceRecoveryClock implements StudioDeviceLossClock {
  private nextHandle = 1;
  private timeMs = 0;
  private readonly tasks = new Map<number, { callback: () => void; delayMs: number }>();

  now(): number {
    return this.timeMs;
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.tasks.set(handle, { callback, delayMs });
    return handle;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  fireNext(): void {
    const entry = this.tasks.entries().next();
    if (entry.done) throw new Error("device recovery clock has no pending task");
    const [handle, task] = entry.value;
    this.tasks.delete(handle);
    this.timeMs += task.delayMs;
    task.callback();
  }

  pending(): number {
    return this.tasks.size;
  }
}

export async function runDeviceLossMatrix(): Promise<V12RuntimeFaultMeasurements["deviceLoss"]> {
  disposeStudioGpuFabric();
  const fabricDevices: ControlledLostDevice[] = [];
  let adapterRequests = 0;
  const gpu = {
    async requestAdapter() {
      adapterRequests += 1;
      const harness = controlledLostDevice();
      fabricDevices.push(harness);
      return { requestDevice: async () => harness.gpuDevice };
    },
  } as unknown as GPU;
  const fabricEpochs: number[] = [];
  let throwingListenerCalls = 0;
  let detachableListenerCalls = 0;
  const unsubscribeAudit = onStudioGpuDeviceLost((event) => {
    fabricEpochs.push(event.epoch);
  });
  const unsubscribeThrowing = onStudioGpuDeviceLost(() => {
    throwingListenerCalls += 1;
    throw new Error("listener isolation probe");
  });
  const unsubscribeDetachable = onStudioGpuDeviceLost(() => {
    detachableListenerCalls += 1;
  });

  let activeLeasesAfterLoss = 0;
  try {
    for (let index = 0; index < V12_FAULT_MATRIX_TARGETS.deviceLossCycles; index += 1) {
      const lease = await acquireStudioGpuDevice({ gpu });
      if (!lease) throw new Error(`fabric acquisition ${index + 1} unexpectedly failed`);
      if (index === V12_FAULT_MATRIX_TARGETS.deviceLossCycles / 2) {
        unsubscribeDetachable();
      }
      fabricDevices[index]?.lose(`destroyed-${index + 1}`);
      await flushMicrotasks();
      if (!lease.lost) throw new Error(`fabric lease ${index + 1} did not observe loss`);
      lease.release();
      activeLeasesAfterLoss += activeStudioGpuDeviceLeaseCount();
    }
  } finally {
    unsubscribeAudit();
    unsubscribeThrowing();
    unsubscribeDetachable();
    disposeStudioGpuFabric();
  }
  if (adapterRequests !== V12_FAULT_MATRIX_TARGETS.deviceLossCycles) {
    throw new Error(`fabric acquired ${adapterRequests} devices instead of the target count`);
  }

  const clock = new DeviceRecoveryClock();
  const replacements: ControlledLostDevice[] = [];
  const recoveryDevices: ControlledLostDevice[] = [];
  const replayedCommands: string[] = [];
  const expectedCommands: string[] = [];
  const invalidatedEpochs: number[] = [];
  let tournamentKills = 0;
  let tournamentRevives = 0;
  let permanentDemotions = 0;
  const tournament: StudioDeviceLossTournamentPort = {
    killGpuProviders() {
      tournamentKills += 1;
    },
    reviveGpuProviders() {
      tournamentRevives += 1;
    },
    permanentlyDemoteGpuProviders() {
      permanentDemotions += 1;
    },
  };
  const recovery = createDeviceLossRecovery<string, ControlledLostDevice>({
    clock,
    tournament,
    backoff: { initialDelayMs: 1, factor: 1, maxDelayMs: 1, maxAttempts: 1 },
    permanentDemotionThreshold: V12_FAULT_MATRIX_TARGETS.deviceLossCycles + 1,
    requestDevice: async () => replacements.shift() ?? null,
    onDiscardInFlight: ({ invalidatedEpoch }) => {
      invalidatedEpochs.push(invalidatedEpoch);
    },
    onDemote() {},
    onRecover: ({ stagedCommands }) => {
      replayedCommands.push(...stagedCommands);
    },
  });

  let current = controlledLostDevice();
  recoveryDevices.push(current);
  recovery.observe(current);
  for (let index = 0; index < V12_FAULT_MATRIX_TARGETS.deviceLossCycles; index += 1) {
    current.lose(`recovery-${index + 1}`);
    await flushMicrotasks();
    const command = `accepted-command-${index + 1}`;
    expectedCommands.push(command);
    if (!recovery.stageCommand(command)) {
      throw new Error(`device-loss command ${index + 1} was not staged`);
    }
    const replacement = controlledLostDevice();
    recoveryDevices.push(replacement);
    replacements.push(replacement);
    clock.fireNext();
    await flushMicrotasks();
    current = replacement;
  }

  const lossesBeforeStaleProbe = recovery.lossCount();
  const staleDevice = current;
  const replacementBeforeDispose = controlledLostDevice();
  recoveryDevices.push(replacementBeforeDispose);
  recovery.observe(replacementBeforeDispose);
  staleDevice.lose("stale-replaced-device");
  await flushMicrotasks();
  const staleLossSignalsAccepted = recovery.lossCount() - lossesBeforeStaleProbe;
  const callbacksBeforeDispose = invalidatedEpochs.length + replayedCommands.length;
  const disposedCommands = recovery.dispose();
  replacementBeforeDispose.lose("late-after-dispose");
  await flushMicrotasks();
  const callbacksAfterDispose = invalidatedEpochs.length + replayedCommands.length;
  if (disposedCommands.length > 0 || callbacksAfterDispose !== callbacksBeforeDispose) {
    throw new Error("device recovery leaked staged work or callbacks after dispose");
  }

  const lostCommands = expectedCommands.filter(
    (command) => !replayedCommands.includes(command),
  ).length;

  return {
    fabricCycles: fabricDevices.length,
    fabricNotifications: fabricEpochs.length,
    isolatedThrowingListenerCalls: throwingListenerCalls,
    detachedListenerCalls: detachableListenerCalls,
    uniqueDeviceEpochs: new Set(fabricEpochs).size,
    recoveryCycles: recovery.lossCount(),
    recoveryDiscards: invalidatedEpochs.length,
    tournamentKills,
    tournamentRevives,
    permanentDemotions,
    stagedCommands: expectedCommands.length,
    replayedCommands: replayedCommands.length,
    duplicateReplays: countDuplicates(replayedCommands),
    lostCommands,
    staleLossSignalsAccepted,
    pendingTimers: clock.pending(),
    activeLeasesAfterLoss,
    pendingLossPromises: [...fabricDevices, ...recoveryDevices].filter(
      (device) => !device.settled(),
    ).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Provider Engine Worker termination                                         */
/* -------------------------------------------------------------------------- */

type EngineWorkerEventType = "message" | "error" | "messageerror";
type EngineWorkerListener = Parameters<StudioEngineWorkerLike["addEventListener"]>[1];

class ControlledEngineWorker implements StudioEngineWorkerLike {
  readonly posted: unknown[] = [];
  terminateCalls = 0;
  private readonly listeners: Record<EngineWorkerEventType, Set<EngineWorkerListener>> = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  };

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(type: EngineWorkerEventType, listener: EngineWorkerListener): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: EngineWorkerEventType, listener: EngineWorkerListener): void {
    this.listeners[type].delete(listener);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of [...this.listeners.message]) {
      (listener as (event: { data: unknown }) => void)({ data });
    }
  }

  emitError(): void {
    for (const listener of [...this.listeners.error]) {
      (listener as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
    }
  }

  captureMessageListeners(): Array<(event: { data: unknown }) => void> {
    return [...this.listeners.message] as Array<(event: { data: unknown }) => void>;
  }

  listenerCount(): number {
    return Object.values(this.listeners).reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

class ManualTimerRegistry {
  private nextHandle = 1;
  private readonly timers = new Map<number, () => void>();

  readonly setTimeout = (callback: () => void): unknown => {
    const handle = this.nextHandle++;
    this.timers.set(handle, callback);
    return handle;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  count(): number {
    return this.timers.size;
  }
}

const ENGINE_CAPABILITIES: StudioEngineCapabilitySnapshot = Object.freeze({
  offscreenCanvas: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webGpu: true,
  wasmSimd: true,
  memory64: true,
  hardwareConcurrency: 8,
  maxTextureDimension2D: 16_384,
});

const POINTER_RING_ENVIRONMENT = Object.freeze({
  crossOriginIsolated: true,
  SharedArrayBuffer,
  Atomics,
});

function engineHelloAck(sessionEpoch: number): StudioEngineHelloAckMessage {
  return {
    type: "studio-engine/hello-ack",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch,
    executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
    engineBuild: "v12-fault-matrix",
    limits: {
      maxInFlightCommands: STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands,
      maxPointerBatchSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples,
      maxPointerRingSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerRingSamples,
      maxDocumentPatchBytes: STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes,
    },
  };
}

export async function runWorkerTerminationMatrix(): Promise<
  V12RuntimeFaultMeasurements["workerTermination"]
> {
  const timers = new ManualTimerRegistry();
  let failedClosed = 0;
  let terminateCalls = 0;
  let acceptedPrefixesPreserved = 0;
  let staleMessagesAttempted = 0;
  let staleMessagesApplied = 0;
  let duplicateAcceptedCommits = 0;
  let pendingListeners = 0;
  let openPointerRings = 0;
  let readyPromisesSettled = 0;

  for (let index = 0; index < V12_FAULT_MATRIX_TARGETS.workerKillCycles; index += 1) {
    const worker = new ControlledEngineWorker();
    const appliedMessages: unknown[] = [];
    const failures: string[] = [];
    const sessionEpoch = index + 1;
    const session = createStudioEngineWorkerSession({
      capabilities: ENGINE_CAPABILITIES,
      clientBuild: "v12-fault-matrix",
      sessionEpoch,
      pointerRingCapacity: 8,
      pointerRingEnvironment: POINTER_RING_ENVIRONMENT,
      workerFactory: () => worker,
      setTimeoutImpl: timers.setTimeout,
      clearTimeoutImpl: timers.clearTimeout,
      onMessage: (message) => appliedMessages.push(message),
      onFailure: (failure) => failures.push(failure.code),
    });
    worker.emitMessage(engineHelloAck(sessionEpoch));
    await session.ready;
    readyPromisesSettled += 1;
    const patchSequence = await session.sendCommand({
      kind: "apply-document-patch",
      documentId: `document-${index + 1}`,
      baseRevision: index,
      documentRevision: index + 1,
      operationCount: 1,
      encoding: "json-utf8",
      bytes: Uint8Array.from([index & 0xff]),
    });
    worker.emitMessage({
      type: "studio-engine/accepted-prefix",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch,
      acceptedThroughCommandSequence: patchSequence,
      queuedCommands: 0,
      queuedPointerSamples: 0,
      pressure: "none",
    });
    const beforeKill = session.snapshot();
    const callbacks = worker.captureMessageListeners();
    worker.emitError();
    const afterKill = session.snapshot();
    if (
      afterKill.phase === "failed"
      && afterKill.failure?.code === "worker-failed"
      && failures.length === 1
    ) {
      failedClosed += 1;
    }
    if (afterKill.lastAcceptedCommandSequence === patchSequence) {
      acceptedPrefixesPreserved += 1;
    }
    const appliedBeforeLate = appliedMessages.length;
    staleMessagesAttempted += callbacks.length;
    for (const callback of callbacks) {
      callback({
        data: {
          type: "studio-engine/accepted-prefix",
          protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
          sessionEpoch,
          acceptedThroughCommandSequence: patchSequence,
          queuedCommands: 0,
          queuedPointerSamples: 0,
          pressure: "none",
        },
      });
    }
    staleMessagesApplied += appliedMessages.length - appliedBeforeLate;
    if (session.snapshot().lastAcceptedCommandSequence !== beforeKill.lastAcceptedCommandSequence) {
      duplicateAcceptedCommits += 1;
    }
    terminateCalls += worker.terminateCalls;
    pendingListeners += worker.listenerCount();
    if (session.pointerProducer?.diagnostics().closed !== true) openPointerRings += 1;
    session.dispose();
    if (worker.terminateCalls !== 1) {
      throw new Error(`worker ${index + 1} did not terminate exactly once`);
    }
  }

  return {
    cycles: V12_FAULT_MATRIX_TARGETS.workerKillCycles,
    failedClosed,
    terminateCalls,
    acceptedPrefixesPreserved,
    staleMessagesAttempted,
    staleMessagesApplied,
    duplicateAcceptedCommits,
    pendingListeners,
    pendingTimers: timers.count(),
    openPointerRings,
    pendingReadyPromises:
      V12_FAULT_MATRIX_TARGETS.workerKillCycles - readyPromisesSettled,
  };
}

/* -------------------------------------------------------------------------- */
/* Queue completion inversion                                                 */
/* -------------------------------------------------------------------------- */

function rgbaFixture(): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(16 * 16 * 4);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 17 + 3) % 251;
  }
  return pixels;
}

export async function runQueueCompletionInversionMatrix(): Promise<
  V12RuntimeFaultMeasurements["queueCompletionInversion"]
> {
  const completions: Deferred<void>[] = [];
  const results: Array<Promise<StudioVrmTexturePaintGpuUploadExecutionResult>> = [];
  const completionOrder: number[] = [];
  let settledFlights = 0;
  let queueWrites = 0;
  let currentGeneration = 0;
  const queue = {
    writeTexture() {
      queueWrites += 1;
    },
    onSubmittedWorkDone() {
      const completion = deferred<void>();
      completions.push(completion);
      return completion.promise;
    },
  };

  for (let generation = 1; generation <= V12_FAULT_MATRIX_TARGETS.queueCompletionFlights; generation += 1) {
    currentGeneration = generation;
    const plan = createStudioVrmTexturePaintGpuUploadPlan({
      rgba: rgbaFixture(),
      textureWidth: 16,
      textureHeight: 16,
      dirtyRect: { x: 4, y: 5, width: 3, height: 2 },
      generation,
    });
    const pending = executeStudioVrmTexturePaintGpuUpload(plan, {
      device: { queue },
      texture: { label: `generation-${generation}` },
      getCurrentGeneration: () => currentGeneration,
    }).then((result) => {
      completionOrder.push(generation);
      settledFlights += 1;
      return result;
    });
    results.push(pending);
    await waitUntil(
      () => completions.length === generation,
      `queue completion registration ${generation}`,
    );
  }

  for (let index = completions.length - 1; index >= 0; index -= 1) {
    completions[index]?.resolve();
    await flushMicrotasks();
  }
  const settled = await Promise.all(results);
  const uploaded = settled.filter((result) => result.status === "uploaded");
  const rejectedStale = settled.filter(
    (result) => result.status === "rejected" && result.reason === "stale-generation",
  );
  const expectedOrder = Array.from(
    { length: V12_FAULT_MATRIX_TARGETS.queueCompletionFlights },
    (_, index) => V12_FAULT_MATRIX_TARGETS.queueCompletionFlights - index,
  );
  const completionOrderViolations = completionOrder.reduce(
    (violations, generation, index) =>
      violations + (generation === expectedOrder[index] ? 0 : 1),
    0,
  );

  return {
    flights: results.length,
    queueWrites,
    reverseCompletions: completionOrder.length,
    uploadedCurrentGeneration: uploaded.length,
    rejectedStaleGenerations: rejectedStale.length,
    staleResultsApplied: uploaded.filter(
      (result) => result.status === "uploaded" && result.generation !== currentGeneration,
    ).length,
    completionOrderViolations,
    pendingFlightPromises: results.length - settledFlights,
  };
}

/* -------------------------------------------------------------------------- */
/* SQLite journal crash/reopen + injected write/CRC faults                    */
/* -------------------------------------------------------------------------- */

function fillNode(id: string, offset = 0): SceneNodeIR {
  return {
    id,
    kind: "fill-path",
    path: polylineToPath(
      [
        [offset, 0],
        [offset + 8, 0],
        [offset + 8, 8],
      ],
      true,
    ),
    paint: solidPaint((offset % 17) / 17, 0.4, 0.8),
    fillRule: "nonzero",
    opacity: 1,
    blend: "src-over",
  };
}

function addNodeCommand(id: string, offset = 0): CommandIR {
  return { type: "scene/add-node", node: fillNode(id, offset) };
}

export async function runJournalCrashRecoveryMatrix(
  database: StudioLocalDatabase,
): Promise<V12RuntimeFaultMeasurements["journalRecovery"]> {
  const store = createSqliteJournalStore(database, "v12-fault-crash-reopen");
  let { bus, recovery } = await CommandBus.open(store, {
    snapshotEvery: Number.MAX_SAFE_INTEGER,
  });
  let recoveryIssues = recovery.issues.length;
  await bus.dispatch({ type: "scene/init", scene: createEmptyScene(128, 128) });
  const acceptedIds: string[] = [];
  let listenerNotifications = 0;
  let snapshotCheckpoints = 0;
  let expectedDigest = projectDigest(bus.getProject()!);

  for (let index = 0; index < V12_FAULT_MATRIX_TARGETS.journalCrashReopens; index += 1) {
    ({ bus, recovery } = await CommandBus.open(store, {
      snapshotEvery: Number.MAX_SAFE_INTEGER,
    }));
    recoveryIssues += recovery.issues.length;
    const id = `crash-edit-${String(index + 1).padStart(3, "0")}`;
    const unsubscribe = bus.subscribe(() => {
      listenerNotifications += 1;
    });
    await bus.dispatch(addNodeCommand(id, index));
    unsubscribe();
    acceptedIds.push(id);
    expectedDigest = projectDigest(bus.getProject()!);
    if ((index + 1) % 8 === 0) {
      await bus.writeSnapshot();
      snapshotCheckpoints += 1;
    }
    // Dropping this CommandBus without a shutdown call is the deterministic tab/crash seam.
  }

  const reopened = await CommandBus.open(store, {
    snapshotEvery: Number.MAX_SAFE_INTEGER,
  });
  recoveryIssues += reopened.recovery.issues.length;
  const recoveredIds = listNodeIds(reopened.bus.getScene() ?? createEmptyScene(1, 1));
  const rows = await database.listJournalEntries("v12-fault-crash-reopen");
  const recoveredSet = new Set(recoveredIds);
  const lostAcceptedEdits = acceptedIds.filter((id) => !recoveredSet.has(id)).length;

  return {
    crashReopens: V12_FAULT_MATRIX_TARGETS.journalCrashReopens,
    acceptedEdits: acceptedIds.length,
    recoveredEdits: recoveredIds.filter((id) => acceptedIds.includes(id)).length,
    lostAcceptedEdits,
    duplicateJournalSequences: countDuplicates(rows.map((row) => row.seq)),
    recoveryIssues,
    snapshotCheckpoints,
    listenerNotifications,
    digestMatches: projectDigest(reopened.bus.getProject()!) === expectedDigest ? 1 : 0,
  };
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

export async function runSqliteJournalFaultMatrix(
  database: StudioLocalDatabase,
): Promise<Pick<
  V12RuntimeFaultMeasurements["storageFaults"],
  | "rejectedWrites"
  | "rejectedWriteStateAdvances"
  | "successfulSameSequenceRetries"
  | "tornWrites"
  | "crcCorruptionsDetected"
  | "corruptSnapshotsRejected"
  | "duplicateJournalSequences"
>> {
  const rejectedProject = "v12-fault-write-rejection";
  const rejectedInner = createSqliteJournalStore(database, rejectedProject);
  const rejectedStore = new FaultInjectingJournalStore(rejectedInner, {
    rejectAppendAtSeq: 3,
  });
  const rejectedBus = (await CommandBus.open(rejectedStore)).bus;
  await rejectedBus.dispatch({ type: "scene/init", scene: createEmptyScene(32, 32) });
  await rejectedBus.dispatch(addNodeCommand("durable-before-reject"));
  const rejectedError = await captureError(() =>
    rejectedBus.dispatch(addNodeCommand("must-not-apply")),
  );
  const rejectedWriteStateAdvances = rejectedBus.getSeq() === 2 ? 0 : 1;
  await rejectedBus.dispatch(addNodeCommand("same-sequence-retry"));
  const rejectedRows = await database.listJournalEntries(rejectedProject);

  const tornProject = "v12-fault-torn-crc";
  const tornInner = createSqliteJournalStore(database, tornProject);
  const tornStore = new FaultInjectingJournalStore(tornInner, { tearAppendAtSeq: 3 });
  const tornBus = (await CommandBus.open(tornStore)).bus;
  await tornBus.dispatch({ type: "scene/init", scene: createEmptyScene(32, 32) });
  await tornBus.dispatch(addNodeCommand("durable-before-torn"));
  const tornError = await captureError(() => tornBus.dispatch(addNodeCommand("torn")));
  const tornRecovery = await recoverProject(tornInner);
  const reopenedTorn = (await CommandBus.open(tornStore)).bus;
  await reopenedTorn.dispatch(addNodeCommand("same-sequence-after-torn"));
  const tornRows = await database.listJournalEntries(tornProject);

  const snapshotProject = "v12-fault-corrupt-snapshot";
  const snapshotInner = createSqliteJournalStore(database, snapshotProject);
  const snapshotStore = new FaultInjectingJournalStore(snapshotInner, {
    corruptSnapshotSlot: "B",
  });
  const snapshotBus = (await CommandBus.open(snapshotStore)).bus;
  await snapshotBus.dispatch({ type: "scene/init", scene: createEmptyScene(32, 32) });
  await snapshotBus.dispatch(addNodeCommand("snapshot-a"));
  await snapshotBus.writeSnapshot();
  await snapshotBus.dispatch(addNodeCommand("snapshot-b-corrupt"));
  await snapshotBus.writeSnapshot();
  const snapshotRecovery = await recoverProject(snapshotInner);

  return {
    rejectedWrites: rejectedError instanceof InjectedStorageFault ? 1 : 0,
    rejectedWriteStateAdvances,
    successfulSameSequenceRetries:
      rejectedRows.some((row) => row.seq === 3)
      && tornRows.some((row) => row.seq === 3)
        ? 2
        : 0,
    tornWrites: tornError instanceof InjectedStorageFault ? 1 : 0,
    crcCorruptionsDetected:
      tornRecovery.report.truncatedFromSeq === 3
      && tornRecovery.report.droppedEntries === 1
        ? 1
        : 0,
    corruptSnapshotsRejected:
      snapshotRecovery.report.snapshotSlotUsed === "A"
      && snapshotRecovery.report.issues.some((issue) => issue.includes("slot B"))
        ? 1
        : 0,
    duplicateJournalSequences:
      countDuplicates(rejectedRows.map((row) => row.seq))
      + countDuplicates(tornRows.map((row) => row.seq)),
  };
}

/* -------------------------------------------------------------------------- */
/* OPFS quota/write rejection and content-address integrity                   */
/* -------------------------------------------------------------------------- */

async function sha256(bytes: Uint8Array): Promise<ArrayBuffer> {
  const digest = createHash("sha256").update(bytes).digest();
  return digest.buffer.slice(
    digest.byteOffset,
    digest.byteOffset + digest.byteLength,
  ) as ArrayBuffer;
}

function errorCode(error: unknown): string | null {
  return error instanceof StudioOpfsError ? error.code : null;
}

export async function runOpfsFaultMatrix(): Promise<Pick<
  V12RuntimeFaultMeasurements["storageFaults"],
  | "quotaRejections"
  | "filesWrittenAfterQuotaReject"
  | "atomicWriteRejections"
  | "filesWrittenAfterWriteReject"
  | "corruptBlobsDetected"
  | "corruptBlobBytesApplied"
>> {
  const payload = new TextEncoder().encode("V12 quota probe".repeat(128));
  const quotaFs = createStudioOpfsMemoryFileSystem();
  const quotaStore = createStudioOpfsAssetStore({
    fs: quotaFs,
    digest: sha256,
    estimator: {
      estimate: async () => ({
        usage: 0,
        quota: STUDIO_OPFS_QUOTA_RESERVE_BYTES + payload.byteLength - 1,
      }),
    },
  });
  const quotaError = await captureError(() =>
    quotaStore.put(payload, { codec: "identity", mime: "application/octet-stream" }),
  );
  const filesWrittenAfterQuotaReject = (await quotaFs.list()).length;

  const writeRejectFs = createStudioOpfsMemoryFileSystem({ failWriteAfter: 1 });
  const writeRejectStore = createStudioOpfsAssetStore({
    fs: writeRejectFs,
    digest: sha256,
  });
  const writeError = await captureError(() =>
    writeRejectStore.put(payload, { codec: "identity", mime: "application/octet-stream" }),
  );
  writeRejectFs.restart();
  const filesWrittenAfterWriteReject = (await writeRejectFs.list()).length;

  const integrityFs = createStudioOpfsMemoryFileSystem();
  const integrityStore = createStudioOpfsAssetStore({
    fs: integrityFs,
    digest: sha256,
  });
  const original = new TextEncoder().encode("A".repeat(128));
  const stored = await integrityStore.put(original, {
    codec: "identity",
    mime: "application/octet-stream",
  });
  await integrityFs.write(stored.entry.path, new TextEncoder().encode("B".repeat(128)));
  const unchecked = await integrityStore.get(stored.ref.hash);
  const integrityError = await captureError(() =>
    integrityStore.get(stored.ref.hash, { verify: true }),
  );

  return {
    quotaRejections: errorCode(quotaError) === "QUOTA_EXCEEDED" ? 1 : 0,
    filesWrittenAfterQuotaReject,
    atomicWriteRejections: errorCode(writeError) === "WRITE_FAILED" ? 1 : 0,
    filesWrittenAfterWriteReject,
    corruptBlobsDetected: errorCode(integrityError) === "INTEGRITY_FAILED" ? 1 : 0,
    corruptBlobBytesApplied:
      unchecked !== null && unchecked.every((byte) => byte === "B".charCodeAt(0)) ? 0 : 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Controlled network boundary + production Room/Binding/SQLite outbox        */
/* -------------------------------------------------------------------------- */

interface ScheduledEntry {
  readonly handle: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

class CollaborationScheduler {
  private time = 1_800_000_000_000;
  private nextHandle = 1;
  private readonly timeouts = new Map<number, ScheduledEntry>();
  private readonly intervals = new Map<number, ScheduledEntry>();

  readonly now = (): number => this.time;

  readonly setTimeout = (callback: () => void, delay: number): unknown => {
    const handle = this.nextHandle++;
    this.timeouts.set(handle, { handle, dueAt: this.time + delay, callback });
    return handle;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.timeouts.delete(handle as number);
  };

  readonly setInterval = (callback: () => void, delay: number): unknown => {
    const handle = this.nextHandle++;
    this.intervals.set(handle, { handle, dueAt: this.time + delay, callback });
    return handle;
  };

  readonly clearInterval = (handle: unknown): void => {
    this.intervals.delete(handle as number);
  };

  runNextTimeout(): number {
    const next = [...this.timeouts.values()].sort(
      (left, right) => left.dueAt - right.dueAt || left.handle - right.handle,
    )[0];
    if (!next) throw new Error("collaboration scheduler has no timeout to run");
    this.timeouts.delete(next.handle);
    this.time = next.dueAt;
    next.callback();
    return next.dueAt;
  }

  timeoutCount(): number {
    return this.timeouts.size;
  }

  intervalCount(): number {
    return this.intervals.size;
  }
}

function deterministicUuid(index: number): string {
  return `12345678-1234-4234-8234-${String(index).padStart(12, "0")}`;
}

class ControlledServerTransport implements StudioLiveTransport {
  readonly mode = "server" as const;
  readonly publications: StudioCrdtUpdateRequest[] = [];
  readonly appliedUpdateIds: string[] = [];
  failuresRemaining = 0;
  private connected = false;
  private closed = false;
  private serverSequence = 0;
  private readonly listeners = new Set<(value: unknown) => void>();
  private readonly controlListeners = new Set<
    (event: StudioLiveTransportControlEvent) => void
  >();
  private readonly crdtListeners = new Set<
    (event: StudioCrdtTransportMessage) => void
  >();

  constructor(
    private readonly workId: string,
    readonly server: StudioCrdtDocument,
  ) {}

  get ready(): boolean {
    return this.connected && !this.closed;
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  send(): boolean {
    return this.ready;
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeControl(listener: (event: StudioLiveTransportControlEvent) => void): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeCrdt(listener: (event: StudioCrdtTransportMessage) => void): () => void {
    this.crdtListeners.add(listener);
    return () => this.crdtListeners.delete(listener);
  }

  async requestCrdtSync(request: StudioCrdtSyncRequest): Promise<StudioCrdtSyncResponse> {
    if (!this.ready) throw new Error("network-offline");
    const diff = this.server.encodeStateAsUpdate(
      decodeStudioCrdtStateVector(request.stateVector),
    );
    const chunks = encodeStudioCrdtSyncChunks(diff);
    return {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.workId,
      requestId: request.requestId,
      transferId: deterministicUuid(900_000 + this.serverSequence),
      chunks,
      chunkCount: chunks.length,
      totalBytes: diff.byteLength,
      serverStateVector: encodeStudioCrdtStateVector(this.server.encodeStateVector()),
      serverSequence: String(this.serverSequence),
    };
  }

  async publishCrdtUpdate(request: StudioCrdtUpdateRequest): Promise<StudioCrdtUpdateAck> {
    this.publications.push(structuredClone(request));
    if (!this.ready) throw new Error("network-offline");
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("temporary-network-partition");
    }
    const duplicate = this.appliedUpdateIds.includes(request.updateId);
    if (!duplicate) {
      this.server.applyUpdate(decodeStudioCrdtUpdate(request.update));
      this.appliedUpdateIds.push(request.updateId);
      this.serverSequence += 1;
    }
    return {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: this.workId,
      updateId: request.updateId,
      serverSequence: String(this.serverSequence),
      serverStateVector: encodeStudioCrdtStateVector(this.server.encodeStateVector()),
      duplicate,
    };
  }

  setOffline(): void {
    this.connected = false;
    this.emitControl({
      type: "status",
      status: {
        state: "disconnected",
        message: "deterministic offline partition",
        recoverable: true,
      },
    });
  }

  setOnline(): void {
    this.connected = true;
    this.emitControl({
      type: "status",
      status: {
        state: "ready",
        message: "deterministic reconnect",
        recoverable: true,
      },
    });
  }

  listenerCount(): number {
    return this.listeners.size + this.controlListeners.size + this.crdtListeners.size;
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    this.listeners.clear();
    this.controlListeners.clear();
    this.crdtListeners.clear();
  }

  private emitControl(event: StudioLiveTransportControlEvent): void {
    for (const listener of [...this.controlListeners]) listener(structuredClone(event));
  }
}

function collaborationStrokePayload(x: number): StudioCrdtDrawStrokePayload {
  return {
    version: 1,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [x, x, x + 1, x + 1],
    pressures: [0.4, 0.8],
    stroke: "#123456",
    strokeWidth: 6,
  };
}

export async function runCollaborationFaultMatrix(
  database: StudioLocalDatabase,
): Promise<V12RuntimeFaultMeasurements["collaboration"]> {
  const scheduler = new CollaborationScheduler();
  const workId = "v12-fault-collaboration";
  const outboxScope = "v12-fault-user";
  const local = new StudioCrdtDocument();
  const server = new StudioCrdtDocument();
  const transport = new ControlledServerTransport(workId, server);
  let roomUuid = 1;
  const room = new StudioLiveRoom({
    workId,
    participant: {
      sessionId: "v12-fault-session",
      displayName: "V12 Fault Gate",
      role: "editor",
    },
    dependencies: {
      transportFactory: () => transport,
      now: scheduler.now,
      randomId: () => deterministicUuid(roomUuid++),
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    },
  });
  const outbox = new SerializedStudioCrdtOutbox(
    new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
      now: scheduler.now,
    }),
    {
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
    },
  );
  let bindingUuid = 100;
  const bindingStatuses: string[] = [];
  const recoveryVault = new PersistentStudioCrdtRecoveryVault(
    createStudioCrdtRecoverySqlitePersistence(() => Promise.resolve(database)),
    scheduler.now,
    () => deterministicUuid(bindingUuid++),
  );
  const binding = new StudioCrdtRoomBinding({
    document: local,
    room,
    outboxScope,
    outbox,
    recoveryVault,
    randomId: () => deterministicUuid(bindingUuid++),
    onStatus: (status) => {
      bindingStatuses.push(`${status.state}:${status.pendingCount}:${status.message}`);
    },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });

  try {
    await room.start();
    await binding.start();
    transport.setOffline();
    local.addStroke({
      id: "offline-stroke",
      pageId: "page-a",
      layerId: "page-root",
      payload: collaborationStrokePayload(12),
    });
    binding.flush();
    try {
      await waitUntil(
        async () => (await outbox.list(outboxScope, workId)).length === 1,
        "durable offline CRDT row",
      );
    } catch (error) {
      const candidates = await requireStudioCrdtOutboxDatabase(
        database,
      ).listCrdtOutboxCandidates(outboxScope, workId);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; `
        + `statuses=${JSON.stringify(bindingStatuses)}; candidates=${JSON.stringify(candidates)}`,
        { cause: error },
      );
    }
    const durableBeforeReconnect = await outbox.list(outboxScope, workId);
    const publicationsWhileOffline = transport.publications.length;

    transport.failuresRemaining = 1;
    transport.setOnline();
    const sql = requireStudioCrdtOutboxDatabase(database);
    await waitUntil(async () => {
      if (transport.publications.length !== 1) return false;
      const candidates = await sql.listCrdtOutboxCandidates(outboxScope, workId);
      return candidates.some((candidate) => candidate.attemptCount === 1);
    }, "first failed publication and SQLite retry metadata");
    const retryCandidates = await sql.listCrdtOutboxCandidates(outboxScope, workId);
    const retryMetadataRows = retryCandidates.filter(
      (candidate) => candidate.attemptCount === 1,
    ).length;

    // The retry row is committed before runDrain's finally clears its single-flight promise.
    // Let that authoritative drain settle before firing the scheduled retry, otherwise the
    // callback would correctly join the old flight and no second publication would start.
    await flushMicrotasks();
    scheduler.runNextTimeout();
    await waitUntil(
      async () =>
        transport.publications.length === 2
        && server.getStrokes().some((stroke) => stroke.id === "offline-stroke")
        && (await outbox.list(outboxScope, workId)).length === 0,
      "authoritative retry ACK and outbox removal",
    );
    const durableAfterAck = await outbox.list(outboxScope, workId);
    const [firstAttempt, secondAttempt] = transport.publications;
    const localVector = encodeStudioCrdtStateVector(local.encodeStateVector());
    const serverVector = encodeStudioCrdtStateVector(server.encodeStateVector());
    const localStrokeIds = local.getStrokes().map((stroke) => stroke.id);
    const serverStrokeIds = server.getStrokes().map((stroke) => stroke.id);

    binding.close();
    room.close();
    await flushMicrotasks();

    return {
      offlineEdits: localStrokeIds.includes("offline-stroke") ? 1 : 0,
      durableOutboxRowsBeforeReconnect: durableBeforeReconnect.length,
      publicationsWhileOffline,
      publicationAttempts: transport.publications.length,
      retryMetadataRows,
      stableUpdateIdsAcrossRetry:
        firstAttempt?.updateId === secondAttempt?.updateId ? 1 : 0,
      stablePayloadsAcrossRetry: firstAttempt?.update === secondAttempt?.update ? 1 : 0,
      authoritativeServerApplies: transport.appliedUpdateIds.length,
      durableOutboxRowsAfterAck: durableAfterAck.length,
      convergedStateVectors: localVector === serverVector ? 1 : 0,
      lostAcceptedEdits: serverStrokeIds.includes("offline-stroke") ? 0 : 1,
      duplicateServerCommits: countDuplicates(transport.appliedUpdateIds),
      pendingTimersAfterClose: scheduler.timeoutCount(),
      pendingIntervalsAfterClose: scheduler.intervalCount(),
      transportListenersAfterClose: transport.listenerCount(),
    };
  } finally {
    binding.close();
    room.close();
    local.destroy();
    server.destroy();
  }
}

export async function runV12RuntimeFaultMatrix(): Promise<V12RuntimeFaultMeasurements> {
  const [deviceLoss, workerTermination, queueCompletionInversion] = await Promise.all([
    runDeviceLossMatrix(),
    runWorkerTerminationMatrix(),
    runQueueCompletionInversionMatrix(),
  ]);
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  try {
    const journalRecovery = await runJournalCrashRecoveryMatrix(database);
    const journalFaults = await runSqliteJournalFaultMatrix(database);
    const opfsFaults = await runOpfsFaultMatrix();
    const collaboration = await runCollaborationFaultMatrix(database);
    return {
      deviceLoss,
      workerTermination,
      queueCompletionInversion,
      journalRecovery,
      storageFaults: { ...journalFaults, ...opfsFaults },
      collaboration,
    };
  } finally {
    await database.close();
  }
}
