import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";

import {
  STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS,
  STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROFILE,
  STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
  sameStudioEngineVNextBrushWorkerEpochs,
  studioEngineVNextBrushWorkerSubmitIdentity,
  validateStudioEngineVNextBrushWorkerInbound,
} from "./studio-engine-vnext-brush-worker-protocol";

import type {
  StudioEngineDurableBrushControllerOptions,
  StudioEngineDurableBrushReceipt,
  StudioEngineDurableBrushSubmissionResult,
} from "./studio-engine-durable-brush-controller";
import type {
  StudioEngineFutureBrushCancelResult,
} from "./studio-engine-future-brush-controller";
import type {
  StudioEngineVNextBrushWorkerCancelMessage,
  StudioEngineVNextBrushWorkerEpochs,
  StudioEngineVNextBrushWorkerFailureCode,
  StudioEngineVNextBrushWorkerFailureMessage,
  StudioEngineVNextBrushWorkerOutboundMessage,
  StudioEngineVNextBrushWorkerResultMessage,
  StudioEngineVNextBrushWorkerSubmitMessage,
} from "./studio-engine-vnext-brush-worker-protocol";

export interface StudioEngineVNextBrushWorkerDurableController {
  submit(input: unknown):
    | Promise<StudioEngineDurableBrushSubmissionResult>
    | StudioEngineDurableBrushSubmissionResult;
  cancel(commandSequence: number): StudioEngineFutureBrushCancelResult;
  dispose(): Promise<void> | void;
}

export interface StudioEngineVNextBrushWorkerFactoryContext
extends StudioEngineVNextBrushWorkerEpochs {
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
}

export type StudioEngineVNextBrushWorkerControllerFactory = (
  context: StudioEngineVNextBrushWorkerFactoryContext,
) =>
  | Promise<StudioEngineVNextBrushWorkerDurableController>
  | StudioEngineVNextBrushWorkerDurableController;

export interface StudioEngineVNextBrushWorkerPort {
  postMessage(message: StudioEngineVNextBrushWorkerOutboundMessage): void;
}

export interface StudioEngineVNextBrushWorkerRuntimeOptions {
  readonly port: StudioEngineVNextBrushWorkerPort;
  readonly controllerFactory: StudioEngineVNextBrushWorkerControllerFactory;
  readonly engineBuild?: string;
  readonly maxQueuedRequests?: number;
  readonly maxQueuedCanonicalSamples?: number;
}

export interface StudioEngineVNextBrushWorkerRuntimeSnapshot {
  readonly state:
    | "awaiting-hello"
    | "initializing"
    | "ready"
    | "disposing"
    | "disposed"
    | "fatal";
  readonly epochs: StudioEngineVNextBrushWorkerEpochs | null;
  readonly acceptedThroughRequestSequence: number;
  readonly durableThroughCommandSequence: number;
  readonly queuedRequests: number;
  readonly queuedCanonicalSamples: number;
  readonly activeRequestSequence: number | null;
  readonly retryRequired: boolean;
  readonly controllerFactoryCalls: number;
}

export interface StudioEngineVNextBrushWorkerRuntime {
  handleMessage(input: unknown): void;
  snapshot(): StudioEngineVNextBrushWorkerRuntimeSnapshot;
  dispose(): Promise<void>;
}

interface QueuedSubmission {
  readonly message: StudioEngineVNextBrushWorkerSubmitMessage;
  readonly identity: string;
  readonly sampleCount: number;
  cancelled: boolean;
}

interface SettledRequest {
  readonly identity: string;
  readonly response:
    | StudioEngineVNextBrushWorkerResultMessage
    | StudioEngineVNextBrushWorkerFailureMessage
    | Readonly<{
        type: "studio-engine-vnext-brush/cancelled";
        protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
        sessionEpoch: number;
        commandEpoch: number;
        deviceEpoch: number;
        resizeEpoch: number;
        requestEpoch: number;
        requestSequence: number;
        commandSequence: number;
        requestToken: string;
      }>;
}

interface RetryBarrier {
  readonly identity: string;
  readonly requestSequence: number;
  readonly commandSequence: number;
}

interface ProjectedSuccess {
  readonly status: "committed" | "duplicate";
  readonly receipt: StudioEngineDurableBrushReceipt;
}

type RuntimeState = StudioEngineVNextBrushWorkerRuntimeSnapshot["state"];

const SAFE_TEXT = /^[\u0020-\u007e]+$/u;
const DEFAULT_ENGINE_BUILD = "studio-engine-vnext-brush-worker-v1";

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedString(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && SAFE_TEXT.test(value);
}

function inspect(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = [...required, ...optional];
    if (
      keys.some((key) => typeof key !== "string" || !allowed.includes(key))
      || !required.every((field) => Object.prototype.hasOwnProperty.call(descriptors, field))
    ) return null;
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function denseArray(input: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(input) || input.length > maximum) return null;
    const result: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(input, index)) return null;
      result.push(input[index]);
    }
    if (
      Reflect.ownKeys(input).some((key) => (
        key !== "length"
        && (
          typeof key !== "string"
          || !/^(0|[1-9]\d*)$/u.test(key)
          || Number(key) >= input.length
        )
      ))
    ) return null;
    return result;
  } catch {
    return null;
  }
}

function projectTileRevisions(input: unknown): StudioEngineDurableBrushReceipt[
"authority"
]["tileRevisions"] | null {
  const raw = denseArray(input, STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxDirtyRects);
  if (!raw) return null;
  const output: Array<StudioEngineDurableBrushReceipt[
  "authority"
  ]["tileRevisions"][number]> = [];
  for (const candidate of raw) {
    const tile = inspect(candidate, [
      "tileId",
      "layerId",
      "column",
      "row",
      "baseTileRevision",
      "tileRevision",
      "contentDigest",
    ]);
    if (
      !tile
      || !boundedString(tile.tileId, 160)
      || !boundedString(tile.layerId, 160)
      || !nonNegativeSafeInteger(tile.column)
      || !nonNegativeSafeInteger(tile.row)
      || !nonNegativeSafeInteger(tile.baseTileRevision)
      || !positiveSafeInteger(tile.tileRevision)
      || !boundedString(tile.contentDigest, 256)
    ) return null;
    output.push(Object.freeze({
      tileId: tile.tileId,
      layerId: tile.layerId,
      column: tile.column,
      row: tile.row,
      baseTileRevision: tile.baseTileRevision,
      tileRevision: tile.tileRevision,
      contentDigest: tile.contentDigest,
    }));
  }
  return Object.freeze(output);
}

/**
 * Projects a possibly hostile injected-controller result into the exact portable receipt schema.
 * No object supplied by the controller is posted directly.
 */
function projectSuccess(
  input: unknown,
  request: StudioEngineVNextBrushWorkerSubmitMessage,
): ProjectedSuccess | null {
  const canonical = parseStudioCanonicalBrushPlan(request.submission.brushPlan, {
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.commandEpoch,
    lastAcceptedCommandSequence: request.commandSequence - 1,
  });
  if (!canonical.ok) return null;
  const expectedPlanHash = hashStudioCanonicalBrushPlan(canonical.value.plan);
  const result = inspect(input, ["status", "receipt"]);
  if (
    !result
    || (result.status !== "committed" && result.status !== "duplicate")
  ) return null;
  const receipt = inspect(result.receipt, [
    "kind",
    "version",
    "canonicalPlanHash",
    "commandSequence",
    "strokeId",
    "sessionEpoch",
    "strokeEpoch",
    "gpu",
    "authority",
    "storage",
    "storageDurability",
  ]);
  if (
    !receipt
    || receipt.kind !== "studio-engine-durable-brush-receipt"
    || receipt.version !== 1
    || receipt.canonicalPlanHash !== expectedPlanHash
    || receipt.commandSequence !== request.commandSequence
    || receipt.strokeId !== canonical.value.plan.strokeId
    || receipt.sessionEpoch !== request.sessionEpoch
    || receipt.strokeEpoch !== request.commandEpoch
    || receipt.storageDurability !== "opfs-v2-durable"
  ) return null;
  const gpu = inspect(receipt.gpu, [
    "state",
    "requestSequence",
    "resizeEpoch",
    "deviceEpoch",
    "planFingerprint",
    "mode",
    "loweringVersion",
    "dabCount",
    "batchCount",
  ]);
  if (
    !gpu
    || gpu.state !== "submitted"
    || !positiveSafeInteger(gpu.requestSequence)
    || gpu.resizeEpoch !== request.resizeEpoch
    || gpu.deviceEpoch !== request.deviceEpoch
    || !boundedString(gpu.planFingerprint, 256)
    || gpu.mode !== request.submission.mode
    || !positiveSafeInteger(gpu.loweringVersion)
    || !nonNegativeSafeInteger(gpu.dabCount)
    || !nonNegativeSafeInteger(gpu.batchCount)
  ) return null;
  const authority = inspect(receipt.authority, [
    "state",
    "authorityVersion",
    "encoding",
    "documentId",
    "commandIdentity",
    "commandSequence",
    "baseDocumentRevision",
    "documentRevision",
    "layerId",
    "baseLayerRevision",
    "layerRevision",
    "tileRevisions",
    "journalSequence",
    "journalDigest",
    "journalByteLength",
    "journalLogicalByteOffset",
  ]);
  const tileRevisions = authority
    ? projectTileRevisions(authority.tileRevisions)
    : null;
  if (
    !authority
    || authority.state !== "tile-authority-committed"
    || authority.authorityVersion !== 1
    || authority.encoding !== "linear-rgba16float-le-v1"
    || !boundedString(authority.documentId, 192)
    || !boundedString(authority.commandIdentity, 512)
    || authority.commandSequence !== request.commandSequence
    || authority.baseDocumentRevision !== request.submission.baseDocumentRevision
    || !positiveSafeInteger(authority.documentRevision)
    || authority.layerId !== request.submission.layerId
    || authority.baseLayerRevision !== request.submission.baseLayerRevision
    || !positiveSafeInteger(authority.layerRevision)
    || !tileRevisions
    || !positiveSafeInteger(authority.journalSequence)
    || !boundedString(authority.journalDigest, 256)
    || !positiveSafeInteger(authority.journalByteLength)
    || typeof authority.journalLogicalByteOffset !== "bigint"
    || authority.journalLogicalByteOffset < BigInt(0)
  ) return null;
  const storage = inspect(receipt.storage, [
    "state",
    "protocolVersion",
    "disposition",
    "requestSequence",
    "sessionEpoch",
    "transactionSequence",
    "transactionIdentity",
    "durableRevision",
    "documentId",
    "commandIdentity",
    "commandSequence",
    "documentRevision",
    "journalLogicalByteOffset",
    "journalByteLength",
    "journalPayloadChecksum",
    "tileCount",
    "totalPayloadBytes",
  ]);
  if (
    !storage
    || storage.state !== "opfs-v2-atomic-commit-acknowledged"
    || storage.protocolVersion !== 2
    || (
      storage.disposition !== "committed"
      && storage.disposition !== "idempotent-replay"
    )
    || !positiveSafeInteger(storage.requestSequence)
    || storage.sessionEpoch !== request.sessionEpoch
    || storage.transactionSequence !== authority.journalSequence
    || !boundedString(storage.transactionIdentity, 512)
    || !positiveSafeInteger(storage.durableRevision)
    || storage.documentId !== authority.documentId
    || storage.commandIdentity !== authority.commandIdentity
    || storage.commandSequence !== request.commandSequence
    || storage.documentRevision !== authority.documentRevision
    || storage.journalLogicalByteOffset !== authority.journalLogicalByteOffset
    || storage.journalByteLength !== authority.journalByteLength
    || !boundedString(storage.journalPayloadChecksum, 256)
    || storage.tileCount !== tileRevisions.length
    || typeof storage.totalPayloadBytes !== "bigint"
    || storage.totalPayloadBytes < BigInt(authority.journalByteLength)
  ) return null;

  const portableReceipt: StudioEngineDurableBrushReceipt = Object.freeze({
    kind: "studio-engine-durable-brush-receipt",
    version: 1,
    canonicalPlanHash: receipt.canonicalPlanHash,
    commandSequence: receipt.commandSequence,
    strokeId: receipt.strokeId,
    sessionEpoch: receipt.sessionEpoch,
    strokeEpoch: receipt.strokeEpoch,
    gpu: Object.freeze<StudioEngineDurableBrushReceipt["gpu"]>({
      state: "submitted",
      requestSequence: gpu.requestSequence,
      resizeEpoch: gpu.resizeEpoch,
      deviceEpoch: gpu.deviceEpoch,
      planFingerprint: gpu.planFingerprint,
      mode: request.submission.mode,
      loweringVersion: gpu.loweringVersion,
      dabCount: gpu.dabCount,
      batchCount: gpu.batchCount,
    }),
    authority: Object.freeze<StudioEngineDurableBrushReceipt["authority"]>({
      state: "tile-authority-committed",
      authorityVersion: 1,
      encoding: "linear-rgba16float-le-v1",
      documentId: authority.documentId,
      commandIdentity: authority.commandIdentity,
      commandSequence: authority.commandSequence,
      baseDocumentRevision: authority.baseDocumentRevision,
      documentRevision: authority.documentRevision,
      layerId: authority.layerId,
      baseLayerRevision: authority.baseLayerRevision,
      layerRevision: authority.layerRevision,
      tileRevisions,
      journalSequence: authority.journalSequence,
      journalDigest: authority.journalDigest,
      journalByteLength: authority.journalByteLength,
      journalLogicalByteOffset: authority.journalLogicalByteOffset,
    }),
    storage: Object.freeze<StudioEngineDurableBrushReceipt["storage"]>({
      state: "opfs-v2-atomic-commit-acknowledged",
      protocolVersion: 2,
      disposition: storage.disposition,
      requestSequence: storage.requestSequence,
      sessionEpoch: storage.sessionEpoch,
      transactionSequence: storage.transactionSequence,
      transactionIdentity: storage.transactionIdentity,
      durableRevision: storage.durableRevision,
      documentId: storage.documentId,
      commandIdentity: storage.commandIdentity,
      commandSequence: storage.commandSequence,
      documentRevision: storage.documentRevision,
      journalLogicalByteOffset: storage.journalLogicalByteOffset,
      journalByteLength: storage.journalByteLength,
      journalPayloadChecksum: storage.journalPayloadChecksum,
      tileCount: storage.tileCount,
      totalPayloadBytes: storage.totalPayloadBytes,
    }),
    storageDurability: "opfs-v2-durable",
  });
  return Object.freeze({
    status: result.status,
    receipt: portableReceipt,
  });
}

function sampleCount(message: StudioEngineVNextBrushWorkerSubmitMessage): number {
  try {
    const plan = message.submission.brushPlan as {
      readonly source?: { readonly samples?: readonly unknown[] };
    };
    return Array.isArray(plan.source?.samples) ? plan.source.samples.length : 0;
  } catch {
    return 0;
  }
}

function controllerRejection(input: unknown): {
  readonly reason: string;
  readonly storageCode?: string;
} | null {
  const result = inspect(
    input,
    ["status", "reason"],
    ["futureReason", "storageCode"],
  );
  if (
    !result
    || result.status !== "rejected"
    || !boundedString(result.reason, 96)
    || (
      result.storageCode !== undefined
      && !boundedString(result.storageCode, 96)
    )
  ) return null;
  return {
    reason: result.reason,
    ...(typeof result.storageCode === "string"
      ? { storageCode: result.storageCode }
      : {}),
  };
}

export function createStudioEngineVNextBrushWorkerRuntime(
  options: StudioEngineVNextBrushWorkerRuntimeOptions,
): StudioEngineVNextBrushWorkerRuntime {
  const maxQueuedRequests = Math.min(
    STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxQueuedRequests,
    Math.max(1, Math.floor(
      options.maxQueuedRequests
      ?? STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxQueuedRequests,
    )),
  );
  const maxQueuedCanonicalSamples = Math.min(
    STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxQueuedCanonicalSamples,
    Math.max(1, Math.floor(
      options.maxQueuedCanonicalSamples
      ?? STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxQueuedCanonicalSamples,
    )),
  );
  const engineBuild = (
    options.engineBuild
    && boundedString(
      options.engineBuild,
      STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxBuildIdentifierCharacters,
    )
  ) ? options.engineBuild : DEFAULT_ENGINE_BUILD;

  let state: RuntimeState = "awaiting-hello";
  let epochs: StudioEngineVNextBrushWorkerEpochs | null = null;
  let controller: StudioEngineVNextBrushWorkerDurableController | null = null;
  let controllerFactoryCalls = 0;
  let acceptedThroughRequestSequence = 0;
  let durableThroughCommandSequence = 0;
  let highestAdmittedCommandSequence = 0;
  let queuedCanonicalSamples = 0;
  let active: QueuedSubmission | null = null;
  let draining = false;
  let retryBarrier: RetryBarrier | null = null;
  let disposePromise: Promise<void> | null = null;
  const queue: QueuedSubmission[] = [];
  const admitted = new Map<number, QueuedSubmission>();
  const settled = new Map<number, SettledRequest>();

  const post = (message: StudioEngineVNextBrushWorkerOutboundMessage): void => {
    options.port.postMessage(message);
  };

  const failure = (
    code: StudioEngineVNextBrushWorkerFailureCode,
    message: string,
    identity?: Partial<{
      sessionEpoch: number;
      commandEpoch: number;
      deviceEpoch: number;
      resizeEpoch: number;
      requestEpoch: number;
      requestSequence: number;
      commandSequence: number;
      requestToken: string;
    }>,
    details: Partial<StudioEngineVNextBrushWorkerFailureMessage["error"]> = {},
  ): StudioEngineVNextBrushWorkerFailureMessage => ({
    type: "studio-engine-vnext-brush/failure",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    sessionEpoch: identity?.sessionEpoch ?? epochs?.sessionEpoch ?? null,
    commandEpoch: identity?.commandEpoch ?? epochs?.commandEpoch ?? null,
    deviceEpoch: identity?.deviceEpoch ?? epochs?.deviceEpoch ?? null,
    resizeEpoch: identity?.resizeEpoch ?? epochs?.resizeEpoch ?? null,
    requestEpoch: identity?.requestEpoch ?? epochs?.requestEpoch ?? null,
    requestSequence: identity?.requestSequence ?? null,
    commandSequence: identity?.commandSequence ?? null,
    requestToken: identity?.requestToken ?? null,
    error: {
      code,
      message: message.slice(
        0,
        STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxErrorMessageCharacters,
      ),
      retryRequired: details.retryRequired === true,
      ...(details.controllerReason
        ? { controllerReason: details.controllerReason }
        : {}),
      ...(details.storageCode
        ? { storageCode: details.storageCode }
        : {}),
    },
  });

  const messageIdentity = (
    message: StudioEngineVNextBrushWorkerSubmitMessage
      | StudioEngineVNextBrushWorkerCancelMessage,
  ) => ({
    sessionEpoch: message.sessionEpoch,
    commandEpoch: message.commandEpoch,
    deviceEpoch: message.deviceEpoch,
    resizeEpoch: message.resizeEpoch,
    requestEpoch: message.requestEpoch,
    requestSequence: message.requestSequence,
    commandSequence: message.commandSequence,
    requestToken: message.requestToken,
  });

  const epochsMatch = (message: StudioEngineVNextBrushWorkerEpochs): boolean => (
    epochs !== null && sameStudioEngineVNextBrushWorkerEpochs(epochs, message)
  );

  const settle = (
    task: QueuedSubmission,
    response: SettledRequest["response"],
  ): void => {
    settled.set(task.message.requestSequence, {
      identity: task.identity,
      response,
    });
    post(response);
  };

  const cancelResponse = (task: QueuedSubmission): SettledRequest["response"] => ({
    type: "studio-engine-vnext-brush/cancelled",
    protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
    sessionEpoch: task.message.sessionEpoch,
    commandEpoch: task.message.commandEpoch,
    deviceEpoch: task.message.deviceEpoch,
    resizeEpoch: task.message.resizeEpoch,
    requestEpoch: task.message.requestEpoch,
    requestSequence: task.message.requestSequence,
    commandSequence: task.message.commandSequence,
    requestToken: task.message.requestToken,
  });

  const drain = async (): Promise<void> => {
    if (draining || state !== "ready" || !controller) return;
    draining = true;
    try {
      while (state === "ready" && controller) {
        const task = queue.shift();
        if (!task) break;
        queuedCanonicalSamples -= task.sampleCount;
        if (task.cancelled) {
          admitted.delete(task.message.requestSequence);
          settle(task, cancelResponse(task));
          continue;
        }
        active = task;
        if (
          retryBarrier
          && (
            retryBarrier.identity !== task.identity
            || retryBarrier.requestSequence !== task.message.requestSequence
            || retryBarrier.commandSequence !== task.message.commandSequence
          )
        ) {
          const response = failure(
            "retry-required",
            "An ambiguous durable transaction must be replayed exactly first.",
            messageIdentity(task.message),
            { retryRequired: true },
          );
          admitted.delete(task.message.requestSequence);
          active = null;
          settle(task, response);
          continue;
        }
        if (
          !retryBarrier
          && task.message.commandSequence !== durableThroughCommandSequence + 1
        ) {
          const response = failure(
            task.message.commandSequence <= durableThroughCommandSequence
              ? "command-sequence-conflict"
              : "command-sequence-gap",
            "Durable command sequence is not contiguous.",
            messageIdentity(task.message),
          );
          admitted.delete(task.message.requestSequence);
          active = null;
          settle(task, response);
          continue;
        }

        let result: unknown;
        try {
          result = await controller.submit(task.message.submission);
        } catch {
          result = null;
        }
        admitted.delete(task.message.requestSequence);
        active = null;
        if (state !== "ready") continue;
        if (task.cancelled) {
          settle(task, cancelResponse(task));
          continue;
        }
        const projected = projectSuccess(result, task.message);
        if (projected) {
          durableThroughCommandSequence = task.message.commandSequence;
          retryBarrier = null;
          const response: StudioEngineVNextBrushWorkerResultMessage = Object.freeze({
            type: "studio-engine-vnext-brush/result",
            protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
            sessionEpoch: task.message.sessionEpoch,
            commandEpoch: task.message.commandEpoch,
            deviceEpoch: task.message.deviceEpoch,
            resizeEpoch: task.message.resizeEpoch,
            requestEpoch: task.message.requestEpoch,
            requestSequence: task.message.requestSequence,
            commandSequence: task.message.commandSequence,
            requestToken: task.message.requestToken,
            disposition: projected.status,
            receipt: projected.receipt,
          });
          settle(task, response);
          continue;
        }
        const rejected = controllerRejection(result);
        if (!rejected) {
          retryBarrier = {
            identity: task.identity,
            requestSequence: task.message.requestSequence,
            commandSequence: task.message.commandSequence,
          };
          post(failure(
            "durable-result-invalid",
            "Durable controller returned a non-portable or mismatched result.",
            messageIdentity(task.message),
            { retryRequired: true },
          ));
          continue;
        }
        if (
          rejected.reason === "storage-rejected"
          || rejected.reason === "durable-receipt-mismatch"
        ) {
          retryBarrier = {
            identity: task.identity,
            requestSequence: task.message.requestSequence,
            commandSequence: task.message.commandSequence,
          };
          post(failure(
            "retry-required",
            "Durability outcome is ambiguous; replay this exact request.",
            messageIdentity(task.message),
            {
              retryRequired: true,
              controllerReason: rejected.reason,
              ...(rejected.storageCode
                ? { storageCode: rejected.storageCode as "unknown" }
                : {}),
            },
          ));
          continue;
        }
        if (rejected.reason === "canceled") {
          settle(task, cancelResponse(task));
          continue;
        }
        const code: StudioEngineVNextBrushWorkerFailureCode = (
          rejected.reason === "command-sequence-conflict"
            ? "command-sequence-conflict"
            : rejected.reason === "command-sequence-gap"
              ? "command-sequence-gap"
              : rejected.reason === "disposed"
                ? "disposed"
                : "controller-rejected"
        );
        settle(task, failure(
          code,
          "Durable brush controller rejected the request.",
          messageIdentity(task.message),
          { controllerReason: rejected.reason },
        ));
      }
    } finally {
      active = null;
      draining = false;
      if (queue.length === 0) {
        highestAdmittedCommandSequence = durableThroughCommandSequence;
      }
    }
  };

  const handleHello = (
    message: Extract<
    ReturnType<typeof validateStudioEngineVNextBrushWorkerInbound>,
    { ok: true }
    >["message"] & { readonly type: "studio-engine-vnext-brush/hello" },
  ): void => {
    if (state !== "awaiting-hello") {
      post(failure("not-ready", "The vNext brush Worker is already initialized."));
      return;
    }
    epochs = Object.freeze({
      sessionEpoch: message.sessionEpoch,
      commandEpoch: message.commandEpoch,
      deviceEpoch: message.deviceEpoch,
      resizeEpoch: message.resizeEpoch,
      requestEpoch: message.requestEpoch,
    });
    state = "initializing";
    controllerFactoryCalls += 1;
    const context: StudioEngineVNextBrushWorkerFactoryContext = Object.freeze({
      protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
      ...epochs,
    });
    void Promise.resolve().then(
      () => options.controllerFactory(context),
    ).then((created) => {
      if (state !== "initializing") {
        void created?.dispose?.();
        return;
      }
      if (
        !created
        || typeof created.submit !== "function"
        || typeof created.cancel !== "function"
        || typeof created.dispose !== "function"
      ) throw new TypeError("Invalid durable controller boundary.");
      controller = created;
      state = "ready";
      post({
        type: "studio-engine-vnext-brush/ready",
        protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
        executionProfile: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROFILE,
        engineBuild,
        ...epochs!,
        limits: {
          maxQueuedRequests,
          maxQueuedCanonicalSamples,
          maxDirtyRects: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxDirtyRects,
        },
      });
      void drain();
    }).catch(() => {
      if (state === "disposed" || state === "disposing") return;
      state = "fatal";
      post(failure(
        "factory-failed",
        "The durable vNext brush controller failed to initialize.",
      ));
    });
  };

  const handleSubmit = (
    message: StudioEngineVNextBrushWorkerSubmitMessage,
  ): void => {
    if (state !== "ready" || !controller || !epochs) {
      post(failure(
        state === "disposed" || state === "disposing" ? "disposed" : "not-ready",
        "The vNext brush Worker is not ready.",
        messageIdentity(message),
      ));
      return;
    }
    if (!epochsMatch(message)) {
      post(failure("epoch-mismatch", "The vNext brush request epoch is stale.", messageIdentity(message)));
      return;
    }
    const identity = studioEngineVNextBrushWorkerSubmitIdentity(message);
    const prior = settled.get(message.requestSequence);
    if (prior) {
      if (prior.identity === identity) post(prior.response);
      else post(failure(
        "request-sequence-conflict",
        "A settled request sequence was replayed with different content.",
        messageIdentity(message),
      ));
      return;
    }
    const inFlight = admitted.get(message.requestSequence);
    if (inFlight) {
      post(failure(
        "request-sequence-conflict",
        inFlight.identity === identity
          ? "The exact request is already in flight."
          : "An in-flight request sequence has different content.",
        messageIdentity(message),
      ));
      return;
    }
    const exactRetry = retryBarrier?.identity === identity
      && retryBarrier.requestSequence === message.requestSequence
      && retryBarrier.commandSequence === message.commandSequence;
    if (retryBarrier && !exactRetry) {
      post(failure(
        "retry-required",
        "An ambiguous durable transaction must be replayed exactly first.",
        messageIdentity(message),
        { retryRequired: true },
      ));
      return;
    }
    if (!exactRetry) {
      if (message.requestSequence <= acceptedThroughRequestSequence) {
        post(failure(
          "stale-request-sequence",
          "The external request sequence is stale.",
          messageIdentity(message),
        ));
        return;
      }
      if (message.requestSequence !== acceptedThroughRequestSequence + 1) {
        post(failure(
          "request-sequence-gap",
          "The external request sequence is not contiguous.",
          messageIdentity(message),
        ));
        return;
      }
      if (message.commandSequence !== highestAdmittedCommandSequence + 1) {
        post(failure(
          message.commandSequence <= highestAdmittedCommandSequence
            ? "command-sequence-conflict"
            : "command-sequence-gap",
          "The admitted command sequence is not contiguous.",
          messageIdentity(message),
        ));
        return;
      }
    }
    const samples = sampleCount(message);
    if (
      samples <= 0
      || admitted.size >= maxQueuedRequests
      || queuedCanonicalSamples + samples > maxQueuedCanonicalSamples
    ) {
      post(failure(
        "queue-full",
        "The vNext brush Worker hard queue budget is exhausted.",
        messageIdentity(message),
      ));
      return;
    }
    const task: QueuedSubmission = {
      message,
      identity,
      sampleCount: samples,
      cancelled: false,
    };
    admitted.set(message.requestSequence, task);
    queue.push(task);
    queuedCanonicalSamples += samples;
    if (!exactRetry) {
      acceptedThroughRequestSequence = message.requestSequence;
      highestAdmittedCommandSequence = message.commandSequence;
    }
    void drain();
  };

  const handleCancel = (
    message: StudioEngineVNextBrushWorkerCancelMessage,
  ): void => {
    if (state !== "ready" || !controller || !epochs) {
      post(failure(
        state === "disposed" || state === "disposing" ? "disposed" : "not-ready",
        "The vNext brush Worker is not ready.",
        messageIdentity(message),
      ));
      return;
    }
    if (!epochsMatch(message)) {
      post(failure("epoch-mismatch", "The cancel epoch is stale.", messageIdentity(message)));
      return;
    }
    const task = admitted.get(message.requestSequence);
    if (
      !task
      || task.message.commandSequence !== message.commandSequence
      || task.message.requestToken !== message.requestToken
    ) {
      post(failure(
        settled.has(message.requestSequence) ? "cancel-too-late" : "controller-rejected",
        "No matching cancellable request exists.",
        messageIdentity(message),
      ));
      return;
    }
    if (task !== active) {
      task.cancelled = true;
      const index = queue.indexOf(task);
      if (index >= 0) {
        queue.splice(index, 1);
        queuedCanonicalSamples -= task.sampleCount;
      }
      admitted.delete(message.requestSequence);
      settle(task, cancelResponse(task));
      return;
    }
    const result = controller.cancel(message.commandSequence);
    if (result.status === "canceled") {
      task.cancelled = true;
      return;
    }
    post(failure(
      result.status === "too-late" || result.status === "already-committed"
        ? "cancel-too-late"
        : result.status === "disposed"
          ? "disposed"
          : "controller-rejected",
      "The durable transaction can no longer be cancelled.",
      messageIdentity(message),
    ));
  };

  const disposeRuntime = async (): Promise<void> => {
    if (disposePromise) return disposePromise;
    state = state === "disposed" ? "disposed" : "disposing";
    for (const task of queue.splice(0)) {
      task.cancelled = true;
      admitted.delete(task.message.requestSequence);
      settle(task, cancelResponse(task));
    }
    queuedCanonicalSamples = 0;
    const owned = controller;
    disposePromise = Promise.resolve().then(() => owned?.dispose()).then(
      () => undefined,
      () => undefined,
    ).then(() => {
      controller = null;
      state = "disposed";
      if (epochs) {
        post({
          type: "studio-engine-vnext-brush/disposed",
          protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
          ...epochs,
          acceptedThroughRequestSequence,
          durableThroughCommandSequence,
        });
      }
    });
    return disposePromise;
  };

  return {
    handleMessage(input: unknown): void {
      const parsed = validateStudioEngineVNextBrushWorkerInbound(input);
      if (!parsed.ok) {
        post(failure(
          parsed.code,
          parsed.message,
        ));
        return;
      }
      const message = parsed.message;
      if (message.type === "studio-engine-vnext-brush/hello") {
        handleHello(message);
        return;
      }
      if (message.type === "studio-engine-vnext-brush/submit") {
        handleSubmit(message);
        return;
      }
      if (message.type === "studio-engine-vnext-brush/cancel") {
        handleCancel(message);
        return;
      }
      if (!epochs || !epochsMatch(message)) {
        post(failure("epoch-mismatch", "The dispose epoch is stale."));
        return;
      }
      void disposeRuntime();
    },
    snapshot(): StudioEngineVNextBrushWorkerRuntimeSnapshot {
      return Object.freeze({
        state,
        epochs,
        acceptedThroughRequestSequence,
        durableThroughCommandSequence,
        queuedRequests: queue.length + (active ? 1 : 0),
        queuedCanonicalSamples: queuedCanonicalSamples + (
          active?.sampleCount ?? 0
        ),
        activeRequestSequence: active?.message.requestSequence ?? null,
        retryRequired: retryBarrier !== null,
        controllerFactoryCalls,
      });
    },
    dispose: disposeRuntime,
  };
}

export type StudioEngineVNextBrushWorkerDurableControllerOptions =
  StudioEngineDurableBrushControllerOptions;
