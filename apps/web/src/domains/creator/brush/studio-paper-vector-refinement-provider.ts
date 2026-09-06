/**
 * Settled-only Paper.js vector-refinement coordinator.
 *
 * Geometry execution is deliberately delegated to
 * `StudioEngineVectorGeometryProvider`. That lower boundary owns the dynamic
 * `paper` import, an isolated PaperScope, one ephemeral non-inserting Project
 * per command, path/curve/work budgets and vendor-object cleanup. This
 * coordinator adds request epochs, fail-fast backpressure, cancellation and
 * deterministic receipts without becoming a second geometry, scene, history
 * or persistence authority.
 */

import {
  createStudioEngineVectorGeometryProvider,
  type StudioEngineVectorGeometryArtifact,
  type StudioEngineVectorGeometryFailureReason,
  type StudioEngineVectorGeometryProvider,
  type StudioEngineVectorGeometryProviderLimits,
  type StudioEngineVectorGeometryResult,
  type StudioEngineVectorGeometrySmoothingType,
} from "../render/studio-engine-vector-geometry-provider";
import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION = 1 as const;

export const STUDIO_PAPER_VECTOR_REFINEMENT_CAPABILITIES = Object.freeze([
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
] as const);

export type StudioPaperVectorRefinementCapability =
  (typeof STUDIO_PAPER_VECTOR_REFINEMENT_CAPABILITIES)[number];

export type StudioPaperVectorBooleanOperator =
  | "unite"
  | "subtract"
  | "intersect"
  | "exclude";

export interface StudioPaperVectorSimplifyCommand {
  readonly kind: "simplify";
  readonly pathData: string;
  readonly tolerance: number;
}

export interface StudioPaperVectorSmoothCommand {
  readonly kind: "smooth";
  readonly pathData: string;
  readonly smoothing?: Readonly<{
    readonly type?: StudioEngineVectorGeometrySmoothingType;
    readonly factor?: number;
  }>;
}

export interface StudioPaperVectorBooleanCommand {
  readonly kind: "boolean";
  readonly operator: StudioPaperVectorBooleanOperator;
  readonly leftPathData: string;
  readonly rightPathData: string;
}

export type StudioPaperVectorRefinementCommand =
  | StudioPaperVectorSimplifyCommand
  | StudioPaperVectorSmoothCommand
  | StudioPaperVectorBooleanCommand;

export interface StudioPaperVectorRefinementRequest {
  readonly kind: "studio-paper-vector-refinement/request";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly stage: "settled";
  readonly command: StudioPaperVectorRefinementCommand;
  readonly signal?: AbortSignal;
}

export interface StudioPaperVectorRefinementReceipt {
  readonly kind: "studio-paper-vector-refinement/receipt";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly command:
    | "simplify"
    | "smooth"
    | StudioPaperVectorBooleanOperator;
  readonly inputFingerprint: `sha256:${string}`;
  readonly outputFingerprint: `sha256:${string}`;
  readonly replayFingerprint: `sha256:${string}`;
  readonly package: Readonly<{
    readonly name: "paper";
    readonly version: string;
  }>;
  readonly execution: Readonly<{
    readonly stage: "settled";
    readonly geometryBoundary: "studio-engine-vector-geometry-provider";
    readonly project: "ephemeral-isolated";
    readonly dynamicImport: true;
  }>;
  readonly budget: Readonly<{
    readonly inputPathDataCodeUnits: number;
    readonly outputPathDataCodeUnits: number;
    readonly outputCurveCount: number;
    readonly outputSubpathCount: number;
    readonly outputFlattenedPointCount: number;
    readonly delegatedPathNumberCurveAndWorkBudgets: true;
  }>;
  readonly authority: Readonly<{
    readonly mainScene: false;
    readonly document: false;
    readonly history: false;
    readonly persistence: false;
    readonly output: "settled-vector-refinement-suggestion";
  }>;
  readonly capabilitiesUsed: readonly StudioPaperVectorRefinementCapability[];
  readonly complete: true;
}

export interface StudioPaperVectorRefinementArtifact {
  readonly kind: "studio-paper-vector-refinement/artifact";
  readonly version: typeof STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION;
  /** Canonical, rounded SVG path-data containing no Paper.js objects. */
  readonly pathData: string;
  readonly bounds: Readonly<{
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly empty: boolean;
  readonly curveCount: number;
  readonly subpathCount: number;
  readonly contours: readonly Readonly<{
    readonly points: readonly number[];
    readonly closed: boolean;
  }>[];
  readonly receipt: StudioPaperVectorRefinementReceipt;
}

export type StudioPaperVectorRefinementFailureReason =
  | "invalid-request"
  | "unsupported-command"
  | "live-stage-forbidden"
  | "epoch-mismatch"
  | "backpressure"
  | "budget-exceeded"
  | "aborted"
  | "disposed"
  | "geometry-unavailable"
  | "geometry-failed";

export type StudioPaperVectorRefinementResult =
  | Readonly<{
      readonly status: "completed";
      readonly consumed: false;
      readonly artifact: StudioPaperVectorRefinementArtifact;
    }>
  | Readonly<{
      readonly status: "rejected";
      readonly consumed: false;
      readonly reason: StudioPaperVectorRefinementFailureReason;
      readonly detail: string;
    }>;

export interface StudioPaperVectorRefinementProviderOptions {
  readonly engineEpoch: number;
  /**
   * Enforced by the delegated geometry boundary before and after Paper.js work.
   *
   * `maxInputNumbersPerPath` / `maxInputCurvesPerPath` are the point/curve
   * admission budget. Path-data and output limits bound serialized and retained
   * memory. Boolean curve-pair work is bounded independently.
   */
  readonly limits?: StudioEngineVectorGeometryProviderLimits;
}

export type StudioPaperVectorRefinementProviderCreationResult =
  | Readonly<{
      readonly status: "ready";
      readonly provider: StudioPaperVectorRefinementProvider;
    }>
  | Readonly<{
      readonly status: "rejected";
      readonly reason: "invalid-options";
      readonly path: "options";
    }>;

interface NormalizedRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly command: StudioPaperVectorRefinementCommand;
  readonly signal?: AbortSignal;
}

interface LinkedAbortController {
  readonly controller: AbortController;
  removeCallerListener(): void;
}

const REQUEST_REQUIRED_KEYS = Object.freeze([
  "kind",
  "version",
  "requestSequence",
  "engineEpoch",
  "stage",
  "command",
] as const);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key))
    && keys.length >= required.length
    && keys.length <= required.length + optional.length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function reject(
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

function normalizeCommand(
  candidate: unknown,
):
  | StudioPaperVectorRefinementCommand
  | StudioPaperVectorRefinementResult {
  if (!isPlainRecord(candidate) || typeof candidate.kind !== "string") {
    return reject("invalid-request", "Command must be a plain object.");
  }
  if (candidate.kind === "simplify") {
    if (!hasExactKeys(candidate, ["kind", "pathData", "tolerance"])) {
      return reject(
        "invalid-request",
        "Simplify command contains missing or unknown fields.",
      );
    }
    return Object.freeze({
      kind: "simplify",
      pathData: candidate.pathData,
      tolerance: candidate.tolerance,
    }) as StudioPaperVectorSimplifyCommand;
  }
  if (candidate.kind === "smooth") {
    if (!hasExactKeys(candidate, ["kind", "pathData"], ["smoothing"])) {
      return reject(
        "invalid-request",
        "Smooth command contains missing or unknown fields.",
      );
    }
    const smoothing = candidate.smoothing;
    return Object.freeze({
      kind: "smooth",
      pathData: candidate.pathData,
      ...(smoothing === undefined
        ? {}
        : {
            smoothing: isPlainRecord(smoothing)
              ? Object.freeze({
                  ...(Object.hasOwn(smoothing, "type")
                    ? { type: smoothing.type }
                    : {}),
                  ...(Object.hasOwn(smoothing, "factor")
                    ? { factor: smoothing.factor }
                    : {}),
                })
              : smoothing,
          }),
    }) as StudioPaperVectorSmoothCommand;
  }
  if (candidate.kind === "boolean") {
    if (
      !hasExactKeys(candidate, [
        "kind",
        "operator",
        "leftPathData",
        "rightPathData",
      ])
    ) {
      return reject(
        "invalid-request",
        "Boolean command contains missing or unknown fields.",
      );
    }
    return Object.freeze({
      kind: "boolean",
      operator: candidate.operator,
      leftPathData: candidate.leftPathData,
      rightPathData: candidate.rightPathData,
    }) as StudioPaperVectorBooleanCommand;
  }
  return reject(
    "unsupported-command",
    "Only simplify, smooth and bounded boolean commands are supported.",
  );
}

function normalizeRequest(
  candidate: unknown,
):
  | NormalizedRequest
  | StudioPaperVectorRefinementResult {
  if (!isPlainRecord(candidate)) {
    return reject("invalid-request", "Request must be a plain object.");
  }
  if (candidate.stage === "live") {
    return reject(
      "live-stage-forbidden",
      "Paper vector refinement may run on settled geometry only.",
    );
  }
  if (
    !hasExactKeys(candidate, REQUEST_REQUIRED_KEYS, ["signal"])
    || candidate.kind !== "studio-paper-vector-refinement/request"
    || candidate.version !== STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION
    || !isPositiveSafeInteger(candidate.requestSequence)
    || !isNonNegativeSafeInteger(candidate.engineEpoch)
    || candidate.stage !== "settled"
    || (
      candidate.signal !== undefined
      && !(
        typeof AbortSignal !== "undefined"
        && candidate.signal instanceof AbortSignal
      )
    )
  ) {
    return reject("invalid-request", "Request envelope failed validation.");
  }
  const command = normalizeCommand(candidate.command);
  if ("status" in command) return command;
  return Object.freeze({
    requestSequence: candidate.requestSequence,
    engineEpoch: candidate.engineEpoch,
    command,
    signal: candidate.signal as AbortSignal | undefined,
  });
}

function hashJson(value: unknown): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(JSON.stringify(value)),
  )}`;
}

function canonicalCommand(
  command: StudioPaperVectorRefinementCommand,
): unknown {
  if (command.kind === "simplify") {
    return {
      kind: command.kind,
      pathData: command.pathData,
      tolerance: command.tolerance,
    };
  }
  if (command.kind === "smooth") {
    return {
      kind: command.kind,
      pathData: command.pathData,
      smoothing: {
        type: command.smoothing?.type ?? "continuous",
        factor: command.smoothing?.factor ?? null,
      },
    };
  }
  return {
    kind: command.kind,
    operator: command.operator,
    leftPathData: command.leftPathData,
    rightPathData: command.rightPathData,
  };
}

function commandOperation(
  command: StudioPaperVectorRefinementCommand,
): StudioPaperVectorRefinementReceipt["command"] {
  return command.kind === "boolean" ? command.operator : command.kind;
}

function commandCapabilities(
  command: StudioPaperVectorRefinementCommand,
): readonly StudioPaperVectorRefinementCapability[] {
  const capability: StudioPaperVectorRefinementCapability =
    command.kind === "boolean"
      ? `boolean:${command.operator}`
      : `refine:${command.kind}`;
  return Object.freeze([
    capability,
    "execution:settled-only",
    "project:ephemeral-isolated",
    "output:serializable-svg-path-data",
    "output:frozen-flattened-contours",
    "authority:none",
  ]);
}

function inputPathDataCodeUnits(
  command: StudioPaperVectorRefinementCommand,
): number {
  return command.kind === "boolean"
    ? command.leftPathData.length + command.rightPathData.length
    : command.pathData.length;
}

function geometryRequest(
  command: StudioPaperVectorRefinementCommand,
): unknown {
  if (command.kind === "simplify") {
    return {
      operation: "simplify",
      pathData: command.pathData,
      tolerance: command.tolerance,
    };
  }
  if (command.kind === "smooth") {
    return command.smoothing === undefined
      ? {
          operation: "smooth",
          pathData: command.pathData,
        }
      : {
          operation: "smooth",
          pathData: command.pathData,
          smoothing: command.smoothing,
        };
  }
  return {
    operation: "boolean",
    operator: command.operator,
    leftPathData: command.leftPathData,
    rightPathData: command.rightPathData,
  };
}

function mapGeometryFailure(
  reason: StudioEngineVectorGeometryFailureReason,
): StudioPaperVectorRefinementFailureReason {
  switch (reason) {
    case "invalid-input":
      return "invalid-request";
    case "budget-exceeded":
      return "budget-exceeded";
    case "cancelled":
      return "aborted";
    case "disposed":
      return "disposed";
    case "provider-unavailable":
      return "geometry-unavailable";
    case "provider-failure":
    case "invalid-provider-output":
      return "geometry-failed";
  }
}

function outputFingerprintPayload(
  artifact: StudioEngineVectorGeometryArtifact,
): unknown {
  return {
    operation: artifact.operation,
    pathData: artifact.pathData,
    bounds: {
      minX: artifact.bounds.minX,
      minY: artifact.bounds.minY,
      maxX: artifact.bounds.maxX,
      maxY: artifact.bounds.maxY,
      width: artifact.bounds.width,
      height: artifact.bounds.height,
    },
    empty: artifact.empty,
    curveCount: artifact.curveCount,
    subpathCount: artifact.subpathCount,
    contours: artifact.contours.map((contour) => ({
      points: [...contour.points],
      closed: contour.closed,
    })),
    flattenedPointCount: artifact.flattenedPointCount,
    packageName: artifact.provider.packageName,
    packageVersion: artifact.provider.packageVersion,
  };
}

function createLinkedAbortController(
  callerSignal: AbortSignal | undefined,
): LinkedAbortController {
  const controller = new AbortController();
  const abort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  return Object.freeze({
    controller,
    removeCallerListener: () => callerSignal?.removeEventListener("abort", abort),
  });
}

function createArtifact(
  request: NormalizedRequest,
  geometryArtifact: StudioEngineVectorGeometryArtifact,
): StudioPaperVectorRefinementArtifact {
  const inputFingerprint = hashJson(canonicalCommand(request.command));
  const outputFingerprint = hashJson(
    outputFingerprintPayload(geometryArtifact),
  );
  const replayFingerprint = hashJson({
    inputFingerprint,
    outputFingerprint,
    packageName: geometryArtifact.provider.packageName,
    packageVersion: geometryArtifact.provider.packageVersion,
    boundary: "studio-engine-vector-geometry-provider",
  });
  const contours = Object.freeze(
    geometryArtifact.contours.map((contour) => Object.freeze({
      points: Object.freeze([...contour.points]),
      closed: contour.closed,
    })),
  );
  const receipt: StudioPaperVectorRefinementReceipt = Object.freeze({
    kind: "studio-paper-vector-refinement/receipt",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION,
    requestSequence: request.requestSequence,
    engineEpoch: request.engineEpoch,
    command: commandOperation(request.command),
    inputFingerprint,
    outputFingerprint,
    replayFingerprint,
    package: Object.freeze({
      name: "paper",
      version: geometryArtifact.provider.packageVersion,
    }),
    execution: Object.freeze({
      stage: "settled",
      geometryBoundary: "studio-engine-vector-geometry-provider",
      project: "ephemeral-isolated",
      dynamicImport: true,
    }),
    budget: Object.freeze({
      inputPathDataCodeUnits: inputPathDataCodeUnits(request.command),
      outputPathDataCodeUnits: geometryArtifact.pathData.length,
      outputCurveCount: geometryArtifact.curveCount,
      outputSubpathCount: geometryArtifact.subpathCount,
      outputFlattenedPointCount: geometryArtifact.flattenedPointCount,
      delegatedPathNumberCurveAndWorkBudgets: true,
    }),
    authority: Object.freeze({
      mainScene: false,
      document: false,
      history: false,
      persistence: false,
      output: "settled-vector-refinement-suggestion",
    }),
    capabilitiesUsed: commandCapabilities(request.command),
    complete: true,
  });
  return Object.freeze({
    kind: "studio-paper-vector-refinement/artifact",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_PROVIDER_VERSION,
    pathData: geometryArtifact.pathData,
    bounds: Object.freeze({
      minX: geometryArtifact.bounds.minX,
      minY: geometryArtifact.bounds.minY,
      maxX: geometryArtifact.bounds.maxX,
      maxY: geometryArtifact.bounds.maxY,
      width: geometryArtifact.bounds.width,
      height: geometryArtifact.bounds.height,
    }),
    empty: geometryArtifact.empty,
    curveCount: geometryArtifact.curveCount,
    subpathCount: geometryArtifact.subpathCount,
    contours,
    receipt,
  });
}

export class StudioPaperVectorRefinementProvider {
  readonly #geometryProvider: StudioEngineVectorGeometryProvider;
  #engineEpoch: number;
  #phase: "cold" | "ready" | "disposed" = "cold";
  #activeController: AbortController | null = null;
  #completed = 0;
  #rejected = 0;

  constructor(options: StudioPaperVectorRefinementProviderOptions) {
    if (
      !isPlainRecord(options)
      || !hasExactKeys(options, ["engineEpoch"], ["limits"])
      || !isNonNegativeSafeInteger(options.engineEpoch)
    ) {
      throw new TypeError("Invalid Paper vector refinement provider options.");
    }
    this.#engineEpoch = options.engineEpoch;
    this.#geometryProvider = createStudioEngineVectorGeometryProvider({
      limits: options.limits,
    });
  }

  #isDisposed(): boolean {
    return this.#phase === "disposed";
  }

  async refine(
    candidate: unknown,
  ): Promise<StudioPaperVectorRefinementResult> {
    if (this.#isDisposed()) {
      this.#rejected += 1;
      return reject("disposed", "Paper vector refinement provider is disposed.");
    }
    let request:
      | NormalizedRequest
      | StudioPaperVectorRefinementResult;
    try {
      request = normalizeRequest(candidate);
    } catch {
      this.#rejected += 1;
      return reject("invalid-request", "Request validation failed closed.");
    }
    if ("status" in request) {
      this.#rejected += 1;
      return request;
    }
    if (request.engineEpoch !== this.#engineEpoch) {
      this.#rejected += 1;
      return reject("epoch-mismatch", "Request engine epoch is stale.");
    }
    if (this.#activeController !== null) {
      this.#rejected += 1;
      return reject(
        "backpressure",
        "Only one Paper vector refinement command may run at once.",
      );
    }

    const linkedAbort = createLinkedAbortController(request.signal);
    this.#activeController = linkedAbort.controller;
    try {
      if (linkedAbort.controller.signal.aborted) {
        this.#rejected += 1;
        return reject("aborted", "Refinement was aborted before execution.");
      }
      let geometryResult: StudioEngineVectorGeometryResult;
      try {
        geometryResult = await this.#geometryProvider.execute(
          geometryRequest(request.command),
          { signal: linkedAbort.controller.signal },
        );
      } catch {
        this.#rejected += 1;
        return reject(
          "geometry-failed",
          "Delegated Paper geometry execution failed closed.",
        );
      }

      if (this.#isDisposed()) {
        this.#rejected += 1;
        return reject("disposed", "Provider was disposed during refinement.");
      }
      if (request.engineEpoch !== this.#engineEpoch) {
        this.#rejected += 1;
        return reject(
          "epoch-mismatch",
          "Provider epoch advanced during refinement.",
        );
      }
      if (linkedAbort.controller.signal.aborted) {
        this.#rejected += 1;
        return reject("aborted", "Refinement was aborted.");
      }
      if (!geometryResult.ok) {
        this.#rejected += 1;
        return reject(
          mapGeometryFailure(geometryResult.reason),
          geometryResult.detail,
        );
      }

      const artifact = createArtifact(request, geometryResult.artifact);
      this.#phase = "ready";
      this.#completed += 1;
      return Object.freeze({
        status: "completed",
        consumed: false,
        artifact,
      });
    } finally {
      linkedAbort.removeCallerListener();
      if (this.#activeController === linkedAbort.controller) {
        this.#activeController = null;
      }
    }
  }

  advanceEngineEpoch(): number {
    if (this.#phase === "disposed") return this.#engineEpoch;
    this.#activeController?.abort("engine-epoch-advanced");
    this.#engineEpoch += 1;
    return this.#engineEpoch;
  }

  snapshot(): Readonly<{
    readonly phase: "cold" | "ready" | "disposed";
    readonly engineEpoch: number;
    readonly active: boolean;
    readonly paperLoaded: boolean;
    readonly activeProjectCount: number;
    readonly completed: number;
    readonly rejected: number;
    readonly authority: "none";
    readonly execution: "settled-only";
  }> {
    const geometry = this.#geometryProvider.getDiagnostics();
    return Object.freeze({
      phase: this.#phase,
      engineEpoch: this.#engineEpoch,
      active: this.#activeController !== null,
      paperLoaded: geometry.paperLoaded,
      activeProjectCount: geometry.activeProjectCount,
      completed: this.#completed,
      rejected: this.#rejected,
      authority: "none",
      execution: "settled-only",
    });
  }

  dispose(): void {
    if (this.#phase === "disposed") return;
    this.#phase = "disposed";
    this.#activeController?.abort("provider-disposed");
    this.#geometryProvider.dispose();
  }
}

export function createStudioPaperVectorRefinementProvider(
  candidate: unknown,
): StudioPaperVectorRefinementProviderCreationResult {
  if (
    !isPlainRecord(candidate)
    || !hasExactKeys(candidate, ["engineEpoch"], ["limits"])
    || !isNonNegativeSafeInteger(candidate.engineEpoch)
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  }
  try {
    return Object.freeze({
      status: "ready",
      provider: new StudioPaperVectorRefinementProvider({
        engineEpoch: candidate.engineEpoch,
        limits:
          candidate.limits as StudioEngineVectorGeometryProviderLimits | undefined,
      }),
    });
  } catch {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  }
}
