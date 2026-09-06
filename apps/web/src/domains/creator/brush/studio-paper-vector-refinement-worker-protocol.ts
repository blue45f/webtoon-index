import type {
  StudioPaperVectorBooleanOperator,
  StudioPaperVectorRefinementArtifact,
  StudioPaperVectorRefinementCapability,
  StudioPaperVectorRefinementFailureReason,
  StudioPaperVectorRefinementProviderOptions,
  StudioPaperVectorRefinementReceipt,
  StudioPaperVectorRefinementRequest,
  StudioPaperVectorRefinementResult,
} from "./studio-paper-vector-refinement-provider";

export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH = 1 as const;

export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS = Object.freeze({
  maxPathDataCodeUnits: 1_048_576,
  maxTotalPathDataCodeUnits: 2_097_152,
  maxInputCommandsPerPath: 32_768,
  maxInputNumbersPerPath: 262_144,
  maxInputCurvesPerPath: 32_768,
  maxOutputCurves: 65_536,
  maxOutputPathDataCodeUnits: 2_097_152,
  maxBooleanCurvePairWorkUnits: 4_000_000,
  maxCoordinateAbsolute: 1_000_000,
  maxSimplifyTolerance: 10_000,
  maxOutputFlattenedPoints: 262_144,
} as const);

export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES =
  Object.freeze([
    "refine:simplify",
    "refine:smooth",
    "boolean:unite",
    "boolean:subtract",
    "boolean:intersect",
    "boolean:exclude",
    "execution:settled-only",
    "project:ephemeral-isolated",
    "output:serializable-svg-path-data",
    "output:frozen-flattened-contours",
    "authority:none",
  ] as const satisfies readonly StudioPaperVectorRefinementCapability[]);

export type StudioPaperVectorRefinementWorkerLimits =
  NonNullable<StudioPaperVectorRefinementProviderOptions["limits"]>;

export interface StudioPaperVectorRefinementWorkerReadyMessage {
  readonly type: "studio-paper-vector-refinement/ready";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly runtimeEpoch: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH;
  readonly executionLocality: "dedicated-worker";
  readonly mainThreadFallback: false;
  readonly capabilities:
    typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES;
  readonly hardLimits:
    typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS;
}

export interface StudioPaperVectorRefinementWorkerConfigureMessage {
  readonly type: "studio-paper-vector-refinement/configure";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  readonly engineEpoch: number;
  readonly limits: StudioPaperVectorRefinementWorkerLimits | null;
}

export interface StudioPaperVectorRefinementWorkerConfiguredMessage {
  readonly type: "studio-paper-vector-refinement/configured";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  readonly engineEpoch: number;
}

interface StudioPaperVectorRefinementWorkerPathBytes {
  readonly pathDataUtf8: Uint8Array<ArrayBuffer>;
  readonly pathDataByteLength: number;
}

export interface StudioPaperVectorRefinementWorkerSimplifyCommand
  extends StudioPaperVectorRefinementWorkerPathBytes {
  readonly kind: "simplify";
  readonly tolerance: number;
}

export interface StudioPaperVectorRefinementWorkerSmoothCommand
  extends StudioPaperVectorRefinementWorkerPathBytes {
  readonly kind: "smooth";
  readonly smoothing: Readonly<{
    readonly type:
      | "continuous"
      | "asymmetric"
      | "catmull-rom"
      | "geometric";
    readonly factor: number | null;
  }>;
}

export interface StudioPaperVectorRefinementWorkerBooleanCommand {
  readonly kind: "boolean";
  readonly operator: StudioPaperVectorBooleanOperator;
  readonly leftPathDataUtf8: Uint8Array<ArrayBuffer>;
  readonly leftPathDataByteLength: number;
  readonly rightPathDataUtf8: Uint8Array<ArrayBuffer>;
  readonly rightPathDataByteLength: number;
}

export type StudioPaperVectorRefinementWorkerCommand =
  | StudioPaperVectorRefinementWorkerSimplifyCommand
  | StudioPaperVectorRefinementWorkerSmoothCommand
  | StudioPaperVectorRefinementWorkerBooleanCommand;

export interface StudioPaperVectorRefinementWorkerExecuteMessage {
  readonly type: "studio-paper-vector-refinement/execute";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly stage: "settled";
  readonly command: StudioPaperVectorRefinementWorkerCommand;
}

export type StudioPaperVectorRefinementWorkerInboundMessage =
  | StudioPaperVectorRefinementWorkerConfigureMessage
  | StudioPaperVectorRefinementWorkerExecuteMessage;

export interface StudioPaperVectorRefinementWorkerContour {
  readonly points: Float64Array<ArrayBuffer>;
  readonly closed: boolean;
}

export interface StudioPaperVectorRefinementWorkerArtifact {
  readonly kind: "studio-paper-vector-refinement/worker-artifact";
  readonly version: 1;
  readonly pathDataUtf8: Uint8Array<ArrayBuffer>;
  readonly pathDataByteLength: number;
  readonly contours: readonly StudioPaperVectorRefinementWorkerContour[];
  readonly bounds: StudioPaperVectorRefinementArtifact["bounds"];
  readonly empty: boolean;
  readonly curveCount: number;
  readonly subpathCount: number;
  readonly receipt: StudioPaperVectorRefinementReceipt;
}

export interface StudioPaperVectorRefinementWorkerResultMessage {
  readonly type: "studio-paper-vector-refinement/result";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly artifact: StudioPaperVectorRefinementWorkerArtifact;
}

export interface StudioPaperVectorRefinementWorkerRejectedMessage {
  readonly type: "studio-paper-vector-refinement/rejected";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly reason: StudioPaperVectorRefinementFailureReason;
  readonly detail: string;
}

export type StudioPaperVectorRefinementWorkerFailureReason =
  | "invalid-message"
  | "invalid-configuration"
  | "not-configured"
  | "backpressure"
  | "provider-creation-failed"
  | "execution-failed"
  | "data-clone-failed";

export interface StudioPaperVectorRefinementWorkerFailureMessage {
  readonly type: "studio-paper-vector-refinement/failure";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
  readonly generation: number | null;
  readonly requestId: number | null;
  readonly reason: StudioPaperVectorRefinementWorkerFailureReason;
  readonly detail: string;
}

export type StudioPaperVectorRefinementWorkerOutboundMessage =
  | StudioPaperVectorRefinementWorkerReadyMessage
  | StudioPaperVectorRefinementWorkerConfiguredMessage
  | StudioPaperVectorRefinementWorkerResultMessage
  | StudioPaperVectorRefinementWorkerRejectedMessage
  | StudioPaperVectorRefinementWorkerFailureMessage;

const LIMIT_KEYS = Object.freeze([
  "maxPathDataCodeUnits",
  "maxTotalPathDataCodeUnits",
  "maxInputCommandsPerPath",
  "maxInputNumbersPerPath",
  "maxInputCurvesPerPath",
  "maxOutputCurves",
  "maxOutputPathDataCodeUnits",
  "maxBooleanCurvePairWorkUnits",
  "maxCoordinateAbsolute",
  "maxSimplifyTolerance",
  "maxOutputFlattenedPoints",
] as const);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_FAILURE_REASONS =
  new Set<StudioPaperVectorRefinementFailureReason>([
    "invalid-request",
    "unsupported-command",
    "live-stage-forbidden",
    "epoch-mismatch",
    "backpressure",
    "budget-exceeded",
    "aborted",
    "disposed",
    "geometry-unavailable",
    "geometry-failed",
  ]);
const WORKER_FAILURE_REASONS =
  new Set<StudioPaperVectorRefinementWorkerFailureReason>([
    "invalid-message",
    "invalid-configuration",
    "not-configured",
    "backpressure",
    "provider-creation-failed",
    "execution-failed",
    "data-clone-failed",
  ]);
const BOOLEAN_OPERATORS = new Set<StudioPaperVectorBooleanOperator>([
  "unite",
  "subtract",
  "intersect",
  "exclude",
]);
const SMOOTHING_TYPES = new Set([
  "continuous",
  "asymmetric",
  "catmull-rom",
  "geometric",
] as const);
const CAPABILITIES =
  new Set<StudioPaperVectorRefinementCapability>(
    STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
  );

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length >= required.length
    && keys.length <= required.length + optional.length
    && required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasMinimumContourGeometry(
  points: ArrayLike<number>,
  closed: boolean,
): boolean {
  const pointCount = points.length / 2;
  if (!closed) return pointCount >= 2;
  if (pointCount < 3) return false;

  const distinctPoints: Array<readonly [number, number]> = [];
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (
      distinctPoints.some(
        ([candidateX, candidateY]) =>
          candidateX === x && candidateY === y,
      )
    ) {
      continue;
    }
    distinctPoints.push([x, y]);
    if (distinctPoints.length >= 3) return true;
  }
  return false;
}

function boundedDetail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512;
}

function fullOwnedView<T extends Uint8Array<ArrayBuffer> | Float64Array<ArrayBuffer>>(
  value: unknown,
  ctor: { new(buffer: ArrayBuffer): T },
): value is T {
  if (!(value instanceof ctor)) return false;
  const buffer = value.buffer;
  if (!(buffer instanceof ArrayBuffer)) return false;
  if (value.byteOffset !== 0 || value.byteLength !== buffer.byteLength) {
    return false;
  }
  const resizable = Reflect.get(buffer, "resizable");
  return resizable !== true;
}

function snapshotLimits(
  value: unknown,
): StudioPaperVectorRefinementWorkerLimits | null | false {
  if (value === null) return null;
  if (!exactKeys(value, [], LIMIT_KEYS)) return false;
  const out: Record<string, number> = {};
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const candidate = value[key];
    const hardMaximum = STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS[key];
    if (
      !finite(candidate)
      || candidate <= 0
      || candidate > hardMaximum
      || (
        key !== "maxCoordinateAbsolute"
        && key !== "maxSimplifyTolerance"
        && !Number.isSafeInteger(candidate)
      )
    ) {
      return false;
    }
    out[key] = candidate;
  }
  const pathMaximum =
    out.maxPathDataCodeUnits
    ?? STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxPathDataCodeUnits;
  const totalMaximum =
    out.maxTotalPathDataCodeUnits
    ?? STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxTotalPathDataCodeUnits;
  if (totalMaximum < pathMaximum) return false;
  return Object.freeze(out) as StudioPaperVectorRefinementWorkerLimits;
}

function encodePath(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length
      > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxPathDataCodeUnits
  ) {
    return null;
  }
  const encoded = new TextEncoder().encode(value);
  if (
    encoded.byteLength === 0
    || encoded.byteLength
      > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxPathDataCodeUnits
  ) {
    return null;
  }
  return encoded;
}

function decodePath(
  value: unknown,
  declaredByteLength: unknown,
  allowEmpty: boolean,
): string | null {
  if (
    !fullOwnedView(value, Uint8Array)
    || !nonNegativeSafeInteger(declaredByteLength)
    || value.byteLength !== declaredByteLength
    || (
      !allowEmpty
      && (
        value.byteLength === 0
        || value.byteLength
          > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxPathDataCodeUnits
      )
    )
    || (
      allowEmpty
      && value.byteLength
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxOutputPathDataCodeUnits
    )
  ) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
}

function snapshotSmoothing(
  value: unknown,
): StudioPaperVectorRefinementWorkerSmoothCommand["smoothing"] | null {
  if (!exactKeys(value, ["type", "factor"])) return null;
  if (
    typeof value.type !== "string"
    || !SMOOTHING_TYPES.has(
      value.type as StudioPaperVectorRefinementWorkerSmoothCommand[
        "smoothing"
      ]["type"],
    )
    || (
      value.factor !== null
      && (
        !finite(value.factor)
        || value.factor < 0
        || value.factor > 1
      )
    )
  ) {
    return null;
  }
  return Object.freeze({
    type: value.type,
    factor: value.factor,
  }) as StudioPaperVectorRefinementWorkerSmoothCommand["smoothing"];
}

function encodeCommand(
  value: unknown,
): StudioPaperVectorRefinementWorkerCommand | null {
  if (!plainRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "simplify") {
    if (!exactKeys(value, ["kind", "pathData", "tolerance"])) return null;
    const pathDataUtf8 = encodePath(value.pathData);
    if (
      pathDataUtf8 === null
      || !finite(value.tolerance)
      || value.tolerance <= 0
      || value.tolerance
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxSimplifyTolerance
    ) {
      return null;
    }
    return Object.freeze({
      kind: "simplify",
      pathDataUtf8,
      pathDataByteLength: pathDataUtf8.byteLength,
      tolerance: value.tolerance,
    });
  }
  if (value.kind === "smooth") {
    if (!exactKeys(value, ["kind", "pathData"], ["smoothing"])) return null;
    const pathDataUtf8 = encodePath(value.pathData);
    if (pathDataUtf8 === null) return null;
    const rawSmoothing = value.smoothing;
    const smoothing = rawSmoothing === undefined
      ? Object.freeze({ type: "continuous" as const, factor: null })
      : snapshotSmoothing({
          type: plainRecord(rawSmoothing)
            ? rawSmoothing.type ?? "continuous"
            : undefined,
          factor: plainRecord(rawSmoothing)
            ? rawSmoothing.factor ?? null
            : undefined,
        });
    if (smoothing === null) return null;
    return Object.freeze({
      kind: "smooth",
      pathDataUtf8,
      pathDataByteLength: pathDataUtf8.byteLength,
      smoothing,
    });
  }
  if (value.kind === "boolean") {
    if (
      !exactKeys(value, [
        "kind",
        "operator",
        "leftPathData",
        "rightPathData",
      ])
      || typeof value.operator !== "string"
      || !BOOLEAN_OPERATORS.has(
        value.operator as StudioPaperVectorBooleanOperator,
      )
    ) {
      return null;
    }
    const leftPathDataUtf8 = encodePath(value.leftPathData);
    const rightPathDataUtf8 = encodePath(value.rightPathData);
    if (
      leftPathDataUtf8 === null
      || rightPathDataUtf8 === null
      || leftPathDataUtf8.byteLength + rightPathDataUtf8.byteLength
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
          .maxTotalPathDataCodeUnits
    ) {
      return null;
    }
    return Object.freeze({
      kind: "boolean",
      operator: value.operator as StudioPaperVectorBooleanOperator,
      leftPathDataUtf8,
      leftPathDataByteLength: leftPathDataUtf8.byteLength,
      rightPathDataUtf8,
      rightPathDataByteLength: rightPathDataUtf8.byteLength,
    });
  }
  return null;
}

function snapshotBinaryCommand(
  value: unknown,
): StudioPaperVectorRefinementWorkerCommand | null {
  if (!plainRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "simplify") {
    if (
      !exactKeys(value, [
        "kind",
        "pathDataUtf8",
        "pathDataByteLength",
        "tolerance",
      ])
      || decodePath(
        value.pathDataUtf8,
        value.pathDataByteLength,
        false,
      ) === null
      || !finite(value.tolerance)
      || value.tolerance <= 0
      || value.tolerance
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxSimplifyTolerance
    ) {
      return null;
    }
    return Object.freeze({
      kind: "simplify",
      pathDataUtf8: value.pathDataUtf8 as Uint8Array<ArrayBuffer>,
      pathDataByteLength: value.pathDataByteLength as number,
      tolerance: value.tolerance,
    });
  }
  if (value.kind === "smooth") {
    if (
      !exactKeys(value, [
        "kind",
        "pathDataUtf8",
        "pathDataByteLength",
        "smoothing",
      ])
      || decodePath(
        value.pathDataUtf8,
        value.pathDataByteLength,
        false,
      ) === null
    ) {
      return null;
    }
    const smoothing = snapshotSmoothing(value.smoothing);
    if (smoothing === null) return null;
    return Object.freeze({
      kind: "smooth",
      pathDataUtf8: value.pathDataUtf8 as Uint8Array<ArrayBuffer>,
      pathDataByteLength: value.pathDataByteLength as number,
      smoothing,
    });
  }
  if (value.kind === "boolean") {
    if (
      !exactKeys(value, [
        "kind",
        "operator",
        "leftPathDataUtf8",
        "leftPathDataByteLength",
        "rightPathDataUtf8",
        "rightPathDataByteLength",
      ])
      || typeof value.operator !== "string"
      || !BOOLEAN_OPERATORS.has(
        value.operator as StudioPaperVectorBooleanOperator,
      )
      || decodePath(
        value.leftPathDataUtf8,
        value.leftPathDataByteLength,
        false,
      ) === null
      || decodePath(
        value.rightPathDataUtf8,
        value.rightPathDataByteLength,
        false,
      ) === null
      || (value.leftPathDataByteLength as number)
          + (value.rightPathDataByteLength as number)
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
          .maxTotalPathDataCodeUnits
    ) {
      return null;
    }
    return Object.freeze({
      kind: "boolean",
      operator: value.operator as StudioPaperVectorBooleanOperator,
      leftPathDataUtf8:
        value.leftPathDataUtf8 as Uint8Array<ArrayBuffer>,
      leftPathDataByteLength: value.leftPathDataByteLength as number,
      rightPathDataUtf8:
        value.rightPathDataUtf8 as Uint8Array<ArrayBuffer>,
      rightPathDataByteLength: value.rightPathDataByteLength as number,
    });
  }
  return null;
}

export function createStudioPaperVectorRefinementWorkerConfigureMessage(
  generation: number,
  engineEpoch: number,
  limits: StudioPaperVectorRefinementWorkerLimits | undefined,
): StudioPaperVectorRefinementWorkerConfigureMessage | null {
  if (!positiveSafeInteger(generation) || !nonNegativeSafeInteger(engineEpoch)) {
    return null;
  }
  const normalizedLimits = snapshotLimits(limits ?? null);
  if (normalizedLimits === false) return null;
  return Object.freeze({
    type: "studio-paper-vector-refinement/configure",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
    generation,
    engineEpoch,
    limits: normalizedLimits,
  });
}

export function createStudioPaperVectorRefinementWorkerExecuteMessage(
  generation: number,
  requestId: number,
  candidate: unknown,
): StudioPaperVectorRefinementWorkerExecuteMessage | null {
  if (
    !positiveSafeInteger(generation)
    || !positiveSafeInteger(requestId)
    || !exactKeys(candidate, [
      "kind",
      "version",
      "requestSequence",
      "engineEpoch",
      "stage",
      "command",
    ])
    || candidate.kind !== "studio-paper-vector-refinement/request"
    || candidate.version !== 1
    || !positiveSafeInteger(candidate.requestSequence)
    || !nonNegativeSafeInteger(candidate.engineEpoch)
    || candidate.stage !== "settled"
  ) {
    return null;
  }
  const command = encodeCommand(candidate.command);
  if (command === null) return null;
  return Object.freeze({
    type: "studio-paper-vector-refinement/execute",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
    generation,
    requestId,
    requestSequence: candidate.requestSequence,
    engineEpoch: candidate.engineEpoch,
    stage: "settled",
    command,
  });
}

export function snapshotStudioPaperVectorRefinementWorkerInboundMessage(
  candidate: unknown,
): StudioPaperVectorRefinementWorkerInboundMessage | null {
  try {
    if (!plainRecord(candidate) || typeof candidate.type !== "string") {
      return null;
    }
    if (candidate.type === "studio-paper-vector-refinement/configure") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "engineEpoch",
          "limits",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || !positiveSafeInteger(candidate.generation)
        || !nonNegativeSafeInteger(candidate.engineEpoch)
      ) {
        return null;
      }
      const limits = snapshotLimits(candidate.limits);
      return limits === false
        ? null
        : Object.freeze({
            type: candidate.type,
            version: candidate.version,
            generation: candidate.generation,
            engineEpoch: candidate.engineEpoch,
            limits,
          });
    }
    if (candidate.type === "studio-paper-vector-refinement/execute") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "requestId",
          "requestSequence",
          "engineEpoch",
          "stage",
          "command",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || !positiveSafeInteger(candidate.generation)
        || !positiveSafeInteger(candidate.requestId)
        || !positiveSafeInteger(candidate.requestSequence)
        || !nonNegativeSafeInteger(candidate.engineEpoch)
        || candidate.stage !== "settled"
      ) {
        return null;
      }
      const command = snapshotBinaryCommand(candidate.command);
      return command === null
        ? null
        : Object.freeze({
            type: candidate.type,
            version: candidate.version,
            generation: candidate.generation,
            requestId: candidate.requestId,
            requestSequence: candidate.requestSequence,
            engineEpoch: candidate.engineEpoch,
            stage: "settled",
            command,
          });
    }
  } catch {
    return null;
  }
  return null;
}

export function studioPaperVectorRefinementWorkerExecuteTransfers(
  message: StudioPaperVectorRefinementWorkerExecuteMessage,
): Transferable[] {
  return message.command.kind === "boolean"
    ? [
        message.command.leftPathDataUtf8.buffer,
        message.command.rightPathDataUtf8.buffer,
      ]
    : [message.command.pathDataUtf8.buffer];
}

export function decodeStudioPaperVectorRefinementWorkerRequest(
  message: StudioPaperVectorRefinementWorkerExecuteMessage,
): StudioPaperVectorRefinementRequest | null {
  const command = message.command;
  if (command.kind === "boolean") {
    const leftPathData = decodePath(
      command.leftPathDataUtf8,
      command.leftPathDataByteLength,
      false,
    );
    const rightPathData = decodePath(
      command.rightPathDataUtf8,
      command.rightPathDataByteLength,
      false,
    );
    if (leftPathData === null || rightPathData === null) return null;
    return Object.freeze({
      kind: "studio-paper-vector-refinement/request",
      version: 1,
      requestSequence: message.requestSequence,
      engineEpoch: message.engineEpoch,
      stage: "settled",
      command: Object.freeze({
        kind: "boolean",
        operator: command.operator,
        leftPathData,
        rightPathData,
      }),
    });
  }
  const pathData = decodePath(
    command.pathDataUtf8,
    command.pathDataByteLength,
    false,
  );
  if (pathData === null) return null;
  return Object.freeze({
    kind: "studio-paper-vector-refinement/request",
    version: 1,
    requestSequence: message.requestSequence,
    engineEpoch: message.engineEpoch,
    stage: "settled",
    command: command.kind === "simplify"
      ? Object.freeze({
          kind: "simplify",
          pathData,
          tolerance: command.tolerance,
        })
      : Object.freeze({
          kind: "smooth",
          pathData,
          smoothing: Object.freeze({
            type: command.smoothing.type,
            ...(command.smoothing.factor === null
              ? {}
              : { factor: command.smoothing.factor }),
          }),
        }),
  });
}

type ArtifactWithContours = StudioPaperVectorRefinementArtifact & Readonly<{
  contours: readonly Readonly<{
    points: readonly number[];
    closed: boolean;
  }>[];
}>;

interface EncodedContoursSnapshot {
  readonly contours: readonly StudioPaperVectorRefinementWorkerContour[];
  readonly pointCount: number;
}

function encodeContours(
  artifact: ArtifactWithContours,
): EncodedContoursSnapshot | null {
  if (!Array.isArray(artifact.contours)) return null;
  let pointCount = 0;
  const contours: StudioPaperVectorRefinementWorkerContour[] = [];
  for (const contour of artifact.contours) {
    if (
      !plainRecord(contour)
      || !Array.isArray(contour.points)
      || contour.points.length % 2 !== 0
      || typeof contour.closed !== "boolean"
    ) {
      return null;
    }
    const points = new Float64Array(contour.points.length);
    for (let index = 0; index < contour.points.length; index += 1) {
      const coordinate = contour.points[index];
      if (
        !finite(coordinate)
        || Math.abs(coordinate)
          > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
            .maxCoordinateAbsolute
      ) {
        return null;
      }
      points[index] = coordinate;
    }
    if (!hasMinimumContourGeometry(points, contour.closed)) {
      return null;
    }
    pointCount += points.length / 2;
    if (
      pointCount
      > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
        .maxOutputFlattenedPoints
    ) {
      return null;
    }
    contours.push(Object.freeze({ points, closed: contour.closed }));
  }
  if (
    artifact.contours.length !== artifact.subpathCount
    || (
      artifact.empty
      && (
        artifact.contours.length !== 0
        || pointCount !== 0
        || artifact.pathData !== ""
      )
    )
  ) {
    return null;
  }
  return Object.freeze({
    contours: Object.freeze(contours),
    pointCount,
  });
}

export function encodeStudioPaperVectorRefinementWorkerArtifact(
  candidate: StudioPaperVectorRefinementArtifact,
): StudioPaperVectorRefinementWorkerArtifact | null {
  try {
    if (
      !exactKeys(candidate, [
        "kind",
        "version",
        "pathData",
        "bounds",
        "empty",
        "curveCount",
        "subpathCount",
        "contours",
        "receipt",
      ])
      || candidate.kind !== "studio-paper-vector-refinement/artifact"
      || candidate.version !== 1
      || typeof candidate.pathData !== "string"
      || typeof candidate.empty !== "boolean"
      || !nonNegativeSafeInteger(candidate.curveCount)
      || candidate.curveCount
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxOutputCurves
      || !nonNegativeSafeInteger(candidate.subpathCount)
      || !validBounds(candidate.bounds)
    ) {
      return null;
    }
    const artifact = candidate as ArtifactWithContours;
    const pathDataUtf8 = new TextEncoder().encode(artifact.pathData);
    if (
      pathDataUtf8.byteLength
        > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
          .maxOutputPathDataCodeUnits
    ) {
      return null;
    }
    const encodedContours = encodeContours(artifact);
    if (
      encodedContours === null
      || (
        !artifact.empty
        && (artifact.pathData.length === 0 || encodedContours.contours.length === 0)
      )
      || !plainRecord(artifact.receipt)
      || !positiveSafeInteger(artifact.receipt.requestSequence)
      || !nonNegativeSafeInteger(artifact.receipt.engineEpoch)
    ) {
      return null;
    }
    const receipt = snapshotReceipt(
      artifact.receipt,
      artifact.receipt.requestSequence,
      artifact.receipt.engineEpoch,
      artifact.curveCount,
      artifact.subpathCount,
      artifact.pathData.length,
      encodedContours.pointCount,
    );
    if (receipt === null) return null;
    return Object.freeze({
      kind: "studio-paper-vector-refinement/worker-artifact",
      version: 1,
      pathDataUtf8,
      pathDataByteLength: pathDataUtf8.byteLength,
      contours: encodedContours.contours,
      bounds: Object.freeze({ ...artifact.bounds }),
      empty: artifact.empty,
      curveCount: artifact.curveCount,
      subpathCount: artifact.subpathCount,
      receipt,
    });
  } catch {
    return null;
  }
}

export function studioPaperVectorRefinementWorkerArtifactTransfers(
  artifact: StudioPaperVectorRefinementWorkerArtifact,
): Transferable[] {
  return [
    artifact.pathDataUtf8.buffer,
    ...artifact.contours.map((contour) => contour.points.buffer),
  ];
}

function validBounds(value: unknown): value is StudioPaperVectorRefinementArtifact[
  "bounds"
] {
  if (
    !exactKeys(value, ["minX", "minY", "maxX", "maxY", "width", "height"])
  ) {
    return false;
  }
  return finite(value.minX)
    && finite(value.minY)
    && finite(value.maxX)
    && finite(value.maxY)
    && finite(value.width)
    && finite(value.height)
    && value.maxX >= value.minX
    && value.maxY >= value.minY
    && value.width >= 0
    && value.height >= 0;
}

function snapshotReceipt(
  value: unknown,
  requestSequence: number,
  engineEpoch: number,
  curveCount: number,
  subpathCount: number,
  outputCodeUnits: number,
  flattenedPointCount: number,
): StudioPaperVectorRefinementReceipt | null {
  const commandCapability =
    value !== null
    && typeof value === "object"
    && "command" in value
    && typeof value.command === "string"
      ? value.command === "simplify" || value.command === "smooth"
        ? `refine:${value.command}`
        : `boolean:${value.command}`
      : null;
  const expectedCapabilities = commandCapability === null
    ? null
    : [
        commandCapability,
        "execution:settled-only",
        "project:ephemeral-isolated",
        "output:serializable-svg-path-data",
        "output:frozen-flattened-contours",
        "authority:none",
      ];
  if (
    !exactKeys(value, [
      "kind",
      "version",
      "requestSequence",
      "engineEpoch",
      "command",
      "inputFingerprint",
      "outputFingerprint",
      "replayFingerprint",
      "package",
      "execution",
      "budget",
      "authority",
      "capabilitiesUsed",
      "complete",
    ])
    || value.kind !== "studio-paper-vector-refinement/receipt"
    || value.version !== 1
    || value.requestSequence !== requestSequence
    || value.engineEpoch !== engineEpoch
    || (
      value.command !== "simplify"
      && value.command !== "smooth"
      && !BOOLEAN_OPERATORS.has(
        value.command as StudioPaperVectorBooleanOperator,
      )
    )
    || typeof value.inputFingerprint !== "string"
    || !HASH_PATTERN.test(value.inputFingerprint)
    || typeof value.outputFingerprint !== "string"
    || !HASH_PATTERN.test(value.outputFingerprint)
    || typeof value.replayFingerprint !== "string"
    || !HASH_PATTERN.test(value.replayFingerprint)
    || !exactKeys(value.package, ["name", "version"])
    || value.package.name !== "paper"
    || typeof value.package.version !== "string"
    || value.package.version.length === 0
    || !exactKeys(value.execution, [
      "stage",
      "geometryBoundary",
      "project",
      "dynamicImport",
    ])
    || value.execution.stage !== "settled"
    || value.execution.geometryBoundary
      !== "studio-engine-vector-geometry-provider"
    || value.execution.project !== "ephemeral-isolated"
    || value.execution.dynamicImport !== true
    || !exactKeys(value.budget, [
      "inputPathDataCodeUnits",
      "outputPathDataCodeUnits",
      "outputCurveCount",
      "outputSubpathCount",
      "outputFlattenedPointCount",
      "delegatedPathNumberCurveAndWorkBudgets",
    ])
    || !nonNegativeSafeInteger(value.budget.inputPathDataCodeUnits)
    || value.budget.outputPathDataCodeUnits !== outputCodeUnits
    || value.budget.outputCurveCount !== curveCount
    || value.budget.outputSubpathCount !== subpathCount
    || value.budget.outputFlattenedPointCount !== flattenedPointCount
    || value.budget.delegatedPathNumberCurveAndWorkBudgets !== true
    || !exactKeys(value.authority, [
      "mainScene",
      "document",
      "history",
      "persistence",
      "output",
    ])
    || value.authority.mainScene !== false
    || value.authority.document !== false
    || value.authority.history !== false
    || value.authority.persistence !== false
    || value.authority.output
      !== "settled-vector-refinement-suggestion"
    || !Array.isArray(value.capabilitiesUsed)
    || expectedCapabilities === null
    || value.capabilitiesUsed.length !== expectedCapabilities.length
    || value.capabilitiesUsed.some(
      (capability, index) =>
        typeof capability !== "string"
        || !CAPABILITIES.has(
          capability as StudioPaperVectorRefinementCapability,
        )
        || capability !== expectedCapabilities[index],
    )
    || value.complete !== true
  ) {
    return null;
  }
  return Object.freeze({
    kind: "studio-paper-vector-refinement/receipt",
    version: 1,
    requestSequence,
    engineEpoch,
    command: value.command as StudioPaperVectorRefinementReceipt["command"],
    inputFingerprint:
      value.inputFingerprint as StudioPaperVectorRefinementReceipt[
        "inputFingerprint"
      ],
    outputFingerprint:
      value.outputFingerprint as StudioPaperVectorRefinementReceipt[
        "outputFingerprint"
      ],
    replayFingerprint:
      value.replayFingerprint as StudioPaperVectorRefinementReceipt[
        "replayFingerprint"
      ],
    package: Object.freeze({
      name: "paper",
      version: value.package.version as string,
    }),
    execution: Object.freeze({
      stage: "settled",
      geometryBoundary: "studio-engine-vector-geometry-provider",
      project: "ephemeral-isolated",
      dynamicImport: true,
    }),
    budget: Object.freeze({
      inputPathDataCodeUnits:
        value.budget.inputPathDataCodeUnits as number,
      outputPathDataCodeUnits: outputCodeUnits,
      outputCurveCount: curveCount,
      outputSubpathCount: subpathCount,
      outputFlattenedPointCount: flattenedPointCount,
      delegatedPathNumberCurveAndWorkBudgets: true,
    }),
    authority: Object.freeze({
      mainScene: false,
      document: false,
      history: false,
      persistence: false,
      output: "settled-vector-refinement-suggestion",
    }),
    capabilitiesUsed: Object.freeze(
      [...expectedCapabilities],
    ) as readonly StudioPaperVectorRefinementCapability[],
    complete: true,
  });
}

function snapshotWireArtifact(
  value: unknown,
  requestSequence: number,
  engineEpoch: number,
): StudioPaperVectorRefinementWorkerArtifact | null {
  if (
    !exactKeys(value, [
      "kind",
      "version",
      "pathDataUtf8",
      "pathDataByteLength",
      "contours",
      "bounds",
      "empty",
      "curveCount",
      "subpathCount",
      "receipt",
    ])
    || value.kind !== "studio-paper-vector-refinement/worker-artifact"
    || value.version !== 1
    || typeof value.empty !== "boolean"
    || !nonNegativeSafeInteger(value.curveCount)
    || value.curveCount
      > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS.maxOutputCurves
    || !nonNegativeSafeInteger(value.subpathCount)
    || !validBounds(value.bounds)
    || !Array.isArray(value.contours)
  ) {
    return null;
  }
  const pathData = decodePath(
    value.pathDataUtf8,
    value.pathDataByteLength,
    true,
  );
  if (pathData === null) return null;
  let pointCount = 0;
  const contours: StudioPaperVectorRefinementWorkerContour[] = [];
  for (const candidate of value.contours) {
    if (
      !exactKeys(candidate, ["points", "closed"])
      || !fullOwnedView(candidate.points, Float64Array)
      || candidate.points.length % 2 !== 0
      || typeof candidate.closed !== "boolean"
    ) {
      return null;
    }
    for (const coordinate of candidate.points) {
      if (
        !finite(coordinate)
        || Math.abs(coordinate)
          > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
            .maxCoordinateAbsolute
      ) {
        return null;
      }
    }
    if (!hasMinimumContourGeometry(candidate.points, candidate.closed)) {
      return null;
    }
    pointCount += candidate.points.length / 2;
    if (
      pointCount
      > STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS
        .maxOutputFlattenedPoints
    ) {
      return null;
    }
    contours.push(Object.freeze({
      points: candidate.points,
      closed: candidate.closed,
    }));
  }
  const receipt = snapshotReceipt(
    value.receipt,
    requestSequence,
    engineEpoch,
    value.curveCount,
    value.subpathCount,
    pathData.length,
    pointCount,
  );
  if (
    contours.length !== value.subpathCount
    || (
      value.empty
      && (
        pathData !== ""
        || contours.length !== 0
        || pointCount !== 0
        || value.curveCount !== 0
        || value.subpathCount !== 0
      )
    )
    || (
      !value.empty
      && (pathData.length === 0 || contours.length === 0)
    )
    || receipt === null
  ) {
    return null;
  }
  return Object.freeze({
    kind: value.kind,
    version: value.version,
    pathDataUtf8: value.pathDataUtf8 as Uint8Array<ArrayBuffer>,
    pathDataByteLength: value.pathDataByteLength as number,
    contours: Object.freeze(contours),
    bounds: Object.freeze({ ...value.bounds }),
    empty: value.empty,
    curveCount: value.curveCount,
    subpathCount: value.subpathCount,
    receipt,
  });
}

export function snapshotStudioPaperVectorRefinementWorkerOutboundMessage(
  candidate: unknown,
): StudioPaperVectorRefinementWorkerOutboundMessage | null {
  try {
    if (!plainRecord(candidate) || typeof candidate.type !== "string") {
      return null;
    }
    if (candidate.type === "studio-paper-vector-refinement/ready") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "runtimeEpoch",
          "executionLocality",
          "mainThreadFallback",
          "capabilities",
          "hardLimits",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || candidate.runtimeEpoch
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH
        || candidate.executionLocality !== "dedicated-worker"
        || candidate.mainThreadFallback !== false
        || !Array.isArray(candidate.capabilities)
        || candidate.capabilities.length
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES.length
        || candidate.capabilities.some(
          (value, index) =>
            value
            !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES[index],
        )
        || !exactKeys(
          candidate.hardLimits,
          Object.keys(STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS),
        )
        || Object.entries(
          STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
        ).some(
          ([key, value]) =>
            (candidate.hardLimits as Record<string, unknown>)[key] !== value,
        )
      ) {
        return null;
      }
      return Object.freeze({
        type: candidate.type,
        version: candidate.version,
        runtimeEpoch: candidate.runtimeEpoch,
        executionLocality: candidate.executionLocality,
        mainThreadFallback: candidate.mainThreadFallback,
        capabilities:
          STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
        hardLimits: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
      });
    }
    if (candidate.type === "studio-paper-vector-refinement/configured") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "engineEpoch",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || !positiveSafeInteger(candidate.generation)
        || !nonNegativeSafeInteger(candidate.engineEpoch)
      ) {
        return null;
      }
      return Object.freeze({
        type: candidate.type,
        version: candidate.version,
        generation: candidate.generation,
        engineEpoch: candidate.engineEpoch,
      });
    }
    if (candidate.type === "studio-paper-vector-refinement/result") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "requestId",
          "requestSequence",
          "engineEpoch",
          "artifact",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || !positiveSafeInteger(candidate.generation)
        || !positiveSafeInteger(candidate.requestId)
        || !positiveSafeInteger(candidate.requestSequence)
        || !nonNegativeSafeInteger(candidate.engineEpoch)
      ) {
        return null;
      }
      const artifact = snapshotWireArtifact(
        candidate.artifact,
        candidate.requestSequence,
        candidate.engineEpoch,
      );
      return artifact === null
        ? null
        : Object.freeze({
            type: candidate.type,
            version: candidate.version,
            generation: candidate.generation,
            requestId: candidate.requestId,
            requestSequence: candidate.requestSequence,
            engineEpoch: candidate.engineEpoch,
            artifact,
          });
    }
    if (candidate.type === "studio-paper-vector-refinement/rejected") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "requestId",
          "requestSequence",
          "engineEpoch",
          "reason",
          "detail",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || !positiveSafeInteger(candidate.generation)
        || !positiveSafeInteger(candidate.requestId)
        || !positiveSafeInteger(candidate.requestSequence)
        || !nonNegativeSafeInteger(candidate.engineEpoch)
        || typeof candidate.reason !== "string"
        || !PROVIDER_FAILURE_REASONS.has(
          candidate.reason as StudioPaperVectorRefinementFailureReason,
        )
        || !boundedDetail(candidate.detail)
      ) {
        return null;
      }
      return Object.freeze({
        type: candidate.type,
        version: candidate.version,
        generation: candidate.generation,
        requestId: candidate.requestId,
        requestSequence: candidate.requestSequence,
        engineEpoch: candidate.engineEpoch,
        reason:
          candidate.reason as StudioPaperVectorRefinementFailureReason,
        detail: candidate.detail,
      });
    }
    if (candidate.type === "studio-paper-vector-refinement/failure") {
      if (
        !exactKeys(candidate, [
          "type",
          "version",
          "generation",
          "requestId",
          "reason",
          "detail",
        ])
        || candidate.version
          !== STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION
        || (
          candidate.generation !== null
          && !positiveSafeInteger(candidate.generation)
        )
        || (
          candidate.requestId !== null
          && !positiveSafeInteger(candidate.requestId)
        )
        || typeof candidate.reason !== "string"
        || !WORKER_FAILURE_REASONS.has(
          candidate.reason as StudioPaperVectorRefinementWorkerFailureReason,
        )
        || !boundedDetail(candidate.detail)
      ) {
        return null;
      }
      return Object.freeze({
        type: candidate.type,
        version: candidate.version,
        generation: candidate.generation as number | null,
        requestId: candidate.requestId as number | null,
        reason:
          candidate.reason as StudioPaperVectorRefinementWorkerFailureReason,
        detail: candidate.detail,
      });
    }
  } catch {
    return null;
  }
  return null;
}

export function decodeStudioPaperVectorRefinementWorkerArtifact(
  candidate: unknown,
): StudioPaperVectorRefinementArtifact | null {
  try {
    if (
      !plainRecord(candidate)
      || !plainRecord(candidate.receipt)
      || !positiveSafeInteger(candidate.receipt.requestSequence)
      || !nonNegativeSafeInteger(candidate.receipt.engineEpoch)
    ) {
      return null;
    }
    const artifact = snapshotWireArtifact(
      candidate,
      candidate.receipt.requestSequence,
      candidate.receipt.engineEpoch,
    );
    if (artifact === null) return null;
    const pathData = decodePath(
      artifact.pathDataUtf8,
      artifact.pathDataByteLength,
      true,
    );
    if (pathData === null) return null;
    const contours = Object.freeze(
      artifact.contours.map((contour) =>
        Object.freeze({
          points: Object.freeze(Array.from(contour.points)),
          closed: contour.closed,
        })
      ),
    );
    return Object.freeze({
      kind: "studio-paper-vector-refinement/artifact",
      version: 1,
      pathData,
      contours,
      bounds: Object.freeze({ ...artifact.bounds }),
      empty: artifact.empty,
      curveCount: artifact.curveCount,
      subpathCount: artifact.subpathCount,
      receipt: artifact.receipt,
    }) as StudioPaperVectorRefinementArtifact;
  } catch {
    return null;
  }
}

export function studioPaperVectorRefinementWorkerResult(
  artifact: StudioPaperVectorRefinementArtifact,
): StudioPaperVectorRefinementResult {
  return Object.freeze({
    status: "completed",
    consumed: false,
    artifact,
  });
}

export function studioPaperVectorRefinementWorkerRejection(
  reason: StudioPaperVectorRefinementFailureReason,
  detail: string,
): StudioPaperVectorRefinementResult {
  return Object.freeze({
    status: "rejected",
    consumed: false,
    reason,
    detail: detail.slice(0, 512),
  });
}
