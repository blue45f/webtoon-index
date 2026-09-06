/**
 * Structured-clone-only protocol for the future-only durable brush Worker.
 *
 * Runtime providers, GPUDevice instances, OPFS handles, AbortSignals and class instances are
 * deliberately absent. Every accepted value is rebuilt from accessor-safe, exact-key plain data
 * before it reaches the Worker actor.
 */

import {
  parseStudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";

import type {
  StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import type {
  StudioEngineDurableBrushReceipt,
} from "./studio-engine-durable-brush-controller";
import type {
  StudioEngineFutureBrushSubmission,
} from "./studio-engine-future-brush-controller";
import type {
  StudioEngineTileStorageBridgeErrorCode,
} from "./studio-engine-tile-storage-bridge";

export const STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION = 1 as const;
export const STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROFILE =
  "toonspectrum-webgpu-rgba16f-opfs-v2" as const;

export const STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS = Object.freeze({
  maxQueuedRequests: 16,
  maxQueuedCanonicalSamples: 131_072,
  maxDirtyRects: 8_192,
  maxIdentifierCharacters: 160,
  maxRequestTokenCharacters: 128,
  maxBuildIdentifierCharacters: 96,
  maxErrorMessageCharacters: 2_048,
  maxCoordinateAbsolute: 1_000_000,
  maxRectExtent: 1_000_000,
} as const);

export interface StudioEngineVNextBrushWorkerEpochs {
  readonly sessionEpoch: number;
  readonly commandEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly requestEpoch: number;
}

export interface StudioEngineVNextBrushWorkerHelloMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/hello";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly clientBuild: string;
}

export interface StudioEngineVNextBrushWorkerSubmitMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/submit";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly requestToken: string;
  readonly submission: StudioEngineFutureBrushSubmission;
}

export interface StudioEngineVNextBrushWorkerCancelMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/cancel";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly requestToken: string;
}

export interface StudioEngineVNextBrushWorkerDisposeMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/dispose";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
}

export type StudioEngineVNextBrushWorkerInboundMessage =
  | StudioEngineVNextBrushWorkerHelloMessage
  | StudioEngineVNextBrushWorkerSubmitMessage
  | StudioEngineVNextBrushWorkerCancelMessage
  | StudioEngineVNextBrushWorkerDisposeMessage;

export interface StudioEngineVNextBrushWorkerLimits {
  readonly maxQueuedRequests: number;
  readonly maxQueuedCanonicalSamples: number;
  readonly maxDirtyRects: number;
}

export interface StudioEngineVNextBrushWorkerReadyMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/ready";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly executionProfile: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROFILE;
  readonly engineBuild: string;
  readonly limits: StudioEngineVNextBrushWorkerLimits;
}

export interface StudioEngineVNextBrushWorkerResultMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/result";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly requestToken: string;
  readonly disposition: "committed" | "duplicate";
  readonly receipt: StudioEngineDurableBrushReceipt;
}

export interface StudioEngineVNextBrushWorkerCancelledMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/cancelled";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly requestToken: string;
}

export type StudioEngineVNextBrushWorkerFailureCode =
  | "cancel-too-late"
  | "command-sequence-conflict"
  | "command-sequence-gap"
  | "controller-rejected"
  | "disposed"
  | "durable-result-invalid"
  | "epoch-mismatch"
  | "factory-failed"
  | "invalid-message"
  | "not-ready"
  | "queue-full"
  | "request-sequence-conflict"
  | "request-sequence-gap"
  | "retry-required"
  | "stale-request-sequence"
  | "unsupported-protocol";

export interface StudioEngineVNextBrushWorkerFailureMessage {
  readonly type: "studio-engine-vnext-brush/failure";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number | null;
  readonly commandEpoch: number | null;
  readonly deviceEpoch: number | null;
  readonly resizeEpoch: number | null;
  readonly requestEpoch: number | null;
  readonly requestSequence: number | null;
  readonly commandSequence: number | null;
  readonly requestToken: string | null;
  readonly error: Readonly<{
    code: StudioEngineVNextBrushWorkerFailureCode;
    message: string;
    retryRequired: boolean;
    controllerReason?: string;
    storageCode?: StudioEngineTileStorageBridgeErrorCode | "unknown";
  }>;
}

export interface StudioEngineVNextBrushWorkerDisposedMessage
extends StudioEngineVNextBrushWorkerEpochs {
  readonly type: "studio-engine-vnext-brush/disposed";
  readonly protocolRevision: typeof STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION;
  readonly acceptedThroughRequestSequence: number;
  readonly durableThroughCommandSequence: number;
}

export type StudioEngineVNextBrushWorkerOutboundMessage =
  | StudioEngineVNextBrushWorkerReadyMessage
  | StudioEngineVNextBrushWorkerResultMessage
  | StudioEngineVNextBrushWorkerCancelledMessage
  | StudioEngineVNextBrushWorkerFailureMessage
  | StudioEngineVNextBrushWorkerDisposedMessage;

export type StudioEngineVNextBrushWorkerInboundValidation =
  | Readonly<{
      ok: true;
      message: StudioEngineVNextBrushWorkerInboundMessage;
    }>
  | Readonly<{
      ok: false;
      code: "invalid-message" | "unsupported-protocol";
      path: string;
      message: string;
    }>;

interface InspectedRecord {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}

interface InvalidRecord {
  readonly ok: false;
  readonly path: string;
}

type RecordInspection = InspectedRecord | InvalidRecord;

function isInvalidRecord(value: unknown): value is InvalidRecord {
  return typeof value === "object"
    && value !== null
    && Object.getOwnPropertyDescriptor(value, "ok")?.value === false
    && typeof Object.getOwnPropertyDescriptor(value, "path")?.value === "string";
}

function inspectExactRecord(
  input: unknown,
  fields: readonly string[],
  path: string,
): RecordInspection {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, path };
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, path };
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== fields.length
      || keys.some((key) => typeof key !== "string" || !fields.includes(key))
    ) return { ok: false, path };
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (
        !descriptor
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
        || descriptor.enumerable !== true
      ) return { ok: false, path: `${path}.${field}` };
      values[field] = descriptor.value;
    }
    return { ok: true, value: values };
  } catch {
    return { ok: false, path };
  }
}

function inspectDenseArray(
  input: unknown,
  maximumLength: number,
  path: string,
): readonly unknown[] | InvalidRecord {
  try {
    if (!Array.isArray(input) || input.length > maximumLength) {
      return { ok: false, path };
    }
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(input, index)) {
        return { ok: false, path: `${path}[${index}]` };
      }
      values.push(input[index]);
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
    ) return { ok: false, path };
    return values;
  } catch {
    return { ok: false, path };
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteBounded(value: unknown, absoluteMaximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= absoluteMaximum;
}

function boundedString(
  value: unknown,
  maximum: number,
  pattern?: RegExp,
): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && (pattern ? pattern.test(value) : true);
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@+~-]*$/u;

const EPOCH_FIELDS = Object.freeze([
  "sessionEpoch",
  "commandEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "requestEpoch",
] as const);

function epochsFrom(
  values: Record<string, unknown>,
): StudioEngineVNextBrushWorkerEpochs | null {
  if (!EPOCH_FIELDS.every((field) => positiveSafeInteger(values[field]))) return null;
  return Object.freeze({
    sessionEpoch: values.sessionEpoch as number,
    commandEpoch: values.commandEpoch as number,
    deviceEpoch: values.deviceEpoch as number,
    resizeEpoch: values.resizeEpoch as number,
    requestEpoch: values.requestEpoch as number,
  });
}

function parseRect(
  input: unknown,
  path: string,
): Readonly<{ x: number; y: number; width: number; height: number }> | InvalidRecord {
  const inspected = inspectExactRecord(input, ["x", "y", "width", "height"], path);
  if (!inspected.ok) return inspected;
  const value = inspected.value;
  if (
    !finiteBounded(value.x, STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxCoordinateAbsolute)
    || !finiteBounded(value.y, STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxCoordinateAbsolute)
    || !finiteBounded(value.width, STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxRectExtent)
    || !finiteBounded(value.height, STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxRectExtent)
    || (value.width as number) <= 0
    || (value.height as number) <= 0
  ) return { ok: false, path };
  return Object.freeze({
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
  });
}

function authorityCandidate(plan: StudioCanonicalBrushPlan): Record<string, unknown> {
  return {
    kind: plan.kind,
    version: plan.version,
    sessionEpoch: plan.sessionEpoch,
    strokeEpoch: plan.strokeEpoch,
    commandSequence: plan.commandSequence,
    strokeId: plan.strokeId,
    seed: plan.seed,
    coordinateSpace: plan.coordinateSpace,
    transform: { ...plan.transform },
    color: {
      ...plan.color,
      components: [...plan.color.components],
    },
    composite: { ...plan.composite },
    recipe: {
      ...plan.recipe,
      tip: { ...plan.recipe.tip },
      scatter: { ...plan.recipe.scatter },
      pressure: {
        size: { ...plan.recipe.pressure.size },
        opacity: { ...plan.recipe.pressure.opacity },
        flow: { ...plan.recipe.pressure.flow },
      },
      grain: plan.recipe.grain ? { ...plan.recipe.grain } : null,
      wetMedia: plan.recipe.wetMedia ? { ...plan.recipe.wetMedia } : null,
    },
    source: {
      ...plan.source,
      samples: plan.source.samples.map((sample) => ({
        role: "authoritative",
        ...sample,
      })),
    },
  };
}

function parseSubmission(
  input: unknown,
  envelope: {
    readonly sessionEpoch: number;
    readonly commandEpoch: number;
    readonly deviceEpoch: number;
    readonly resizeEpoch: number;
    readonly commandSequence: number;
  },
): StudioEngineFutureBrushSubmission | InvalidRecord {
  const inspected = inspectExactRecord(input, [
    "mode",
    "resizeEpoch",
    "deviceEpoch",
    "rasterRect",
    "layerId",
    "baseDocumentRevision",
    "baseLayerRevision",
    "dirtyRects",
    "brushPlan",
  ], "$.submission");
  if (!inspected.ok) return inspected;
  const value = inspected.value;
  if (
    (value.mode !== "append" && value.mode !== "rebuild")
    || value.resizeEpoch !== envelope.resizeEpoch
    || value.deviceEpoch !== envelope.deviceEpoch
    || !boundedString(
      value.layerId,
      STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxIdentifierCharacters,
      SAFE_IDENTIFIER,
    )
    || !nonNegativeSafeInteger(value.baseDocumentRevision)
    || !nonNegativeSafeInteger(value.baseLayerRevision)
  ) return { ok: false, path: "$.submission" };
  const rasterRect = parseRect(value.rasterRect, "$.submission.rasterRect");
  if (isInvalidRecord(rasterRect)) return rasterRect;
  const rawDirty = inspectDenseArray(
    value.dirtyRects,
    STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxDirtyRects,
    "$.submission.dirtyRects",
  );
  if (!Array.isArray(rawDirty) || rawDirty.length === 0) {
    return "path" in rawDirty
      ? rawDirty
      : { ok: false, path: "$.submission.dirtyRects" };
  }
  const dirtyRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let index = 0; index < rawDirty.length; index += 1) {
    const rect = parseRect(rawDirty[index], `$.submission.dirtyRects[${index}]`);
    if (isInvalidRecord(rect)) return rect;
    dirtyRects.push(rect);
  }
  const parsed = parseStudioCanonicalBrushPlan(value.brushPlan, {
    sessionEpoch: envelope.sessionEpoch,
    strokeEpoch: envelope.commandEpoch,
    lastAcceptedCommandSequence: envelope.commandSequence - 1,
  });
  if (!parsed.ok || parsed.value.plan.commandSequence !== envelope.commandSequence) {
    return { ok: false, path: parsed.ok ? "$.submission.brushPlan" : parsed.path };
  }
  return Object.freeze({
    mode: value.mode,
    resizeEpoch: envelope.resizeEpoch,
    deviceEpoch: envelope.deviceEpoch,
    rasterRect,
    layerId: value.layerId,
    baseDocumentRevision: value.baseDocumentRevision,
    baseLayerRevision: value.baseLayerRevision,
    dirtyRects: Object.freeze(dirtyRects),
    brushPlan: authorityCandidate(parsed.value.plan),
  } as StudioEngineFutureBrushSubmission);
}

function invalid(path: string): StudioEngineVNextBrushWorkerInboundValidation {
  return Object.freeze({
    ok: false,
    code: "invalid-message",
    path,
    message: `Invalid vNext brush Worker message at ${path}.`,
  });
}

export function validateStudioEngineVNextBrushWorkerInbound(
  input: unknown,
): StudioEngineVNextBrushWorkerInboundValidation {
  const header = inspectExactRecord(
    input,
    [
      "type",
      "protocolRevision",
      ...EPOCH_FIELDS,
      ...(
        typeof input === "object"
        && input !== null
        && Object.getOwnPropertyDescriptor(input, "type")?.value
          === "studio-engine-vnext-brush/hello"
          ? ["clientBuild"]
          : typeof input === "object"
            && input !== null
            && Object.getOwnPropertyDescriptor(input, "type")?.value
              === "studio-engine-vnext-brush/submit"
            ? ["requestSequence", "commandSequence", "requestToken", "submission"]
            : typeof input === "object"
              && input !== null
              && Object.getOwnPropertyDescriptor(input, "type")?.value
                === "studio-engine-vnext-brush/cancel"
              ? ["requestSequence", "commandSequence", "requestToken"]
              : []
      ),
    ],
    "$",
  );
  if (!header.ok) return invalid(header.path);
  const value = header.value;
  if (value.protocolRevision !== STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION) {
    return Object.freeze({
      ok: false,
      code: "unsupported-protocol",
      path: "$.protocolRevision",
      message: "Unsupported vNext brush Worker protocol revision.",
    });
  }
  const epochs = epochsFrom(value);
  if (!epochs) return invalid("$");

  if (value.type === "studio-engine-vnext-brush/hello") {
    if (!boundedString(
      value.clientBuild,
      STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxBuildIdentifierCharacters,
      SAFE_IDENTIFIER,
    )) return invalid("$.clientBuild");
    return Object.freeze({
      ok: true,
      message: Object.freeze({
        type: value.type,
        protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
        ...epochs,
        clientBuild: value.clientBuild,
      }),
    });
  }
  if (value.type === "studio-engine-vnext-brush/dispose") {
    return Object.freeze({
      ok: true,
      message: Object.freeze({
        type: value.type,
        protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
        ...epochs,
      }),
    });
  }
  if (
    !positiveSafeInteger(value.requestSequence)
    || !positiveSafeInteger(value.commandSequence)
    || !boundedString(
      value.requestToken,
      STUDIO_ENGINE_VNEXT_BRUSH_WORKER_BUDGETS.maxRequestTokenCharacters,
      SAFE_TOKEN,
    )
  ) return invalid("$");

  if (value.type === "studio-engine-vnext-brush/cancel") {
    return Object.freeze({
      ok: true,
      message: Object.freeze({
        type: value.type,
        protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
        ...epochs,
        requestSequence: value.requestSequence,
        commandSequence: value.commandSequence,
        requestToken: value.requestToken,
      }),
    });
  }
  if (value.type !== "studio-engine-vnext-brush/submit") return invalid("$.type");
  const submission = parseSubmission(value.submission, {
    ...epochs,
    commandSequence: value.commandSequence,
  });
  if (isInvalidRecord(submission)) return invalid(submission.path);
  return Object.freeze({
    ok: true,
    message: Object.freeze({
      type: value.type,
      protocolRevision: STUDIO_ENGINE_VNEXT_BRUSH_WORKER_PROTOCOL_REVISION,
      ...epochs,
      requestSequence: value.requestSequence,
      commandSequence: value.commandSequence,
      requestToken: value.requestToken,
      submission,
    }),
  });
}

export function sameStudioEngineVNextBrushWorkerEpochs(
  left: StudioEngineVNextBrushWorkerEpochs,
  right: StudioEngineVNextBrushWorkerEpochs,
): boolean {
  return left.sessionEpoch === right.sessionEpoch
    && left.commandEpoch === right.commandEpoch
    && left.deviceEpoch === right.deviceEpoch
    && left.resizeEpoch === right.resizeEpoch
    && left.requestEpoch === right.requestEpoch;
}

/**
 * Exact replay identity. The parser has already rebuilt every nested value with deterministic key
 * order, so this JSON contains no accessors, provider handles, undefined values or non-finite data.
 */
export function studioEngineVNextBrushWorkerSubmitIdentity(
  message: StudioEngineVNextBrushWorkerSubmitMessage,
): string {
  return JSON.stringify({
    protocolRevision: message.protocolRevision,
    sessionEpoch: message.sessionEpoch,
    commandEpoch: message.commandEpoch,
    deviceEpoch: message.deviceEpoch,
    resizeEpoch: message.resizeEpoch,
    requestEpoch: message.requestEpoch,
    requestSequence: message.requestSequence,
    commandSequence: message.commandSequence,
    requestToken: message.requestToken,
    submission: message.submission,
  });
}
