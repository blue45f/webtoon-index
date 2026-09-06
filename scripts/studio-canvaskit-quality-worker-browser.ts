/**
 * Real Chromium module-Worker/WASM boundary harness for the CanvasKit quality provider.
 *
 * The application shell is intentionally absent. Every successful geometry operation travels
 * through StudioQualityWorkerClient -> a real module Worker -> CanvasKit WASM -> a structured-clone
 * response. A second real Worker epoch proves malformed protocol messages fail closed.
 */

import {
  StudioQualityWorkerClient,
  StudioQualityWorkerClientError,
  createStudioQualityModuleWorker,
  type StudioQualityWorkerLike,
} from "../apps/web/src/domains/creator/studio-quality-worker-client";
import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  type StudioQualityWorkerInboundMessage,
} from "../apps/web/src/domains/creator/studio-quality-worker-protocol";

import type {
  StudioQualityPathOp,
  StudioStrokeToPathStyle,
} from "../apps/web/src/domains/creator/render/studio-canvaskit-adapter";

const MAIN_WORKER_EPOCH = 7_001;
const INVALID_WORKER_EPOCH = 7_002;
const WORKER_MESSAGE_TIMEOUT_MS = 30_000;
const CLIENT_TIMEOUT_MS = 30_000;

const PATH_A = "M0 0L80 0L80 60L0 60Z";
const PATH_B = "M40 20L120 20L120 90L40 90Z";
const STROKE_PATH = "M10 20L110 20";
const STROKE_STYLE: StudioStrokeToPathStyle = {
  widthPx: 12,
  cap: "round",
  join: "round",
  miterLimit: 4,
};

const EXPECTED_BOOLEAN_SAMPLES = {
  union: [true, true, true, false],
  intersect: [false, true, false, false],
  difference: [true, false, false, false],
  xor: [true, false, true, false],
} as const;
const BOOLEAN_SAMPLE_POINTS = [
  [10, 10],
  [50, 30],
  [100, 50],
  [130, 100],
] as const;
const EXPECTED_STROKE_SAMPLES = [true, true, true, false] as const;
const STROKE_SAMPLE_POINTS = [
  [10, 20],
  [5, 20],
  [50, 25],
  [50, 30],
] as const;

type WorkerMessageRecord = Readonly<Record<string, unknown>>;

interface SerializableError {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
}

interface PortableAudit {
  readonly checkedValues: number;
  readonly passed: boolean;
  readonly violations: readonly string[];
  readonly forbiddenKeys: readonly string[];
  readonly jsonRoundTrips: number;
  readonly structuredCloneRoundTrips: number;
}

interface WorkerObservation {
  readonly label: string;
  readonly createdBy: "createStudioQualityModuleWorker";
  readonly outboundTypes: readonly string[];
  readonly inboundTypes: readonly string[];
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly errorEvents: readonly string[];
  readonly messageErrorEvents: readonly string[];
  readonly cloneFailures: readonly string[];
  readonly terminated: boolean;
}

interface BooleanOperationEvidence {
  readonly op: StudioQualityPathOp;
  readonly requestId: number;
  readonly requestToken: string;
  readonly execution: "quality-worker";
  readonly providerId: "canvaskit";
  readonly pathData: string;
  readonly pathDataCodeUnits: number;
  readonly samples: readonly boolean[];
  readonly expectedSamples: readonly boolean[];
}

interface StrokeEvidence {
  readonly requestId: number;
  readonly requestToken: string;
  readonly execution: "quality-worker";
  readonly providerId: "canvaskit";
  readonly pathData: string;
  readonly pathDataCodeUnits: number;
  readonly samples: readonly boolean[];
  readonly expectedSamples: readonly boolean[];
}

interface SecurityPolicyViolationEvidence {
  readonly blockedUri: string;
  readonly effectiveDirective: string;
  readonly violatedDirective: string;
  readonly disposition: string;
  readonly sourceFile: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

interface BrowserCapabilities {
  readonly worker: boolean;
  readonly webAssembly: boolean;
  readonly structuredClone: boolean;
  readonly path2d: boolean;
  readonly userAgent: string;
}

type BrowserQualityWorkerResult =
  | {
    readonly status: "ok";
    readonly backend: "canvaskit-wasm-module-worker";
    readonly capabilities: BrowserCapabilities;
    readonly provider: {
      readonly id: "canvaskit";
      readonly profile: "canvaskit-pathops-stroke-v1";
      readonly workerEpoch: number;
      readonly capabilities: {
        readonly pathBoolean: true;
        readonly strokeToPath: true;
      };
      readonly limits: Readonly<Record<string, number>>;
    };
    readonly booleanOperations: readonly BooleanOperationEvidence[];
    readonly strokeToFill: StrokeEvidence;
    readonly determinism: {
      readonly booleanSameInputExactPathData: boolean;
      readonly strokeSameInputExactPathData: boolean;
      readonly booleanFirstCodeUnits: number;
      readonly strokeFirstCodeUnits: number;
    };
    readonly structuredCloneBoundary: PortableAudit;
    readonly budgetFailClosed: {
      readonly limitCodeUnits: number;
      readonly testedCodeUnits: number;
      readonly error: SerializableError;
      readonly workerPostDelta: number;
      readonly pendingCountAfterFailure: number;
      readonly recoveryProviderId: "canvaskit";
      readonly recoveryOk: boolean;
    };
    readonly cancellationFailClosed: {
      readonly preAbortedError: SerializableError;
      readonly preAbortedWorkerPostDelta: number;
      readonly inFlightError: SerializableError;
      readonly cancelMessagePosted: boolean;
      readonly cancelledRequestId: number;
      readonly lateWorkerOutcomeTypes: readonly string[];
      readonly resultDeliveredToCaller: false;
      readonly pendingCountAfterAbort: number;
      readonly recoveryProviderId: "canvaskit";
      readonly recoveryOk: boolean;
    };
    readonly malformedPayloadFailClosed: {
      readonly initializedRealProvider: boolean;
      readonly fatalType: "studio-quality/fatal";
      readonly fatalStage: string;
      readonly fatalCode: string;
      readonly fatalWorkerEpoch: number | null;
      readonly requestId: number | null;
    };
    readonly workerObservations: readonly WorkerObservation[];
    readonly securityPolicyViolations: readonly SecurityPolicyViolationEvidence[];
  }
  | {
    readonly status: "unsupported";
    readonly reason:
      | "worker-unavailable"
      | "webassembly-unavailable"
      | "structured-clone-unavailable"
      | "path2d-unavailable";
    readonly message: string;
    readonly capabilities: BrowserCapabilities;
  }
  | {
    readonly status: "error";
    readonly message: string;
    readonly stack: string | null;
    readonly capabilities: BrowserCapabilities;
    readonly securityPolicyViolations: readonly SecurityPolicyViolationEvidence[];
  };

declare global {
  interface Window {
    __studioCanvasKitQualityWorkerResult?: BrowserQualityWorkerResult;
  }
}

function capabilities(): BrowserCapabilities {
  return {
    worker: typeof Worker === "function",
    webAssembly: typeof WebAssembly === "object",
    structuredClone: typeof structuredClone === "function",
    path2d: typeof Path2D === "function",
    userAgent: navigator.userAgent,
  };
}

function isRecord(value: unknown): value is WorkerMessageRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageType(value: unknown): string {
  return isRecord(value) && typeof value.type === "string"
    ? value.type
    : "<unknown>";
}

function errorEvidence(error: unknown): SerializableError {
  if (error instanceof StudioQualityWorkerClientError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      code: null,
      message: error.message,
    };
  }
  return {
    name: "UnknownError",
    code: null,
    message: String(error),
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function cloneForObservation(
  value: unknown,
  cloneFailures: string[],
  direction: "inbound" | "outbound",
): unknown {
  try {
    return structuredClone(value);
  } catch (error) {
    cloneFailures.push(`${direction}: ${errorEvidence(error).message}`);
    throw error;
  }
}

class ObservedQualityWorker implements StudioQualityWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: StudioQualityWorkerLike["onerror"] = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;

  readonly outbound: unknown[] = [];
  readonly inbound: unknown[] = [];
  readonly errorEvents: string[] = [];
  readonly messageErrorEvents: string[] = [];
  readonly cloneFailures: string[] = [];
  readonly label: string;

  #inner: Worker;
  #terminated = false;

  constructor(label: string) {
    this.label = label;
    const created = createStudioQualityModuleWorker();
    if (!created) {
      throw new Error("createStudioQualityModuleWorker returned null.");
    }
    this.#inner = created as unknown as Worker;
    this.#inner.addEventListener("message", (event) => {
      const snapshot = cloneForObservation(event.data, this.cloneFailures, "inbound");
      this.inbound.push(snapshot);
      this.onmessage?.(new MessageEvent("message", { data: snapshot }));
    });
    this.#inner.addEventListener("error", (event) => {
      this.errorEvents.push(event.message || "unknown Worker error");
      this.onerror?.(event);
    });
    this.#inner.addEventListener("messageerror", (event) => {
      this.messageErrorEvents.push("Worker response could not be structured-cloned.");
      this.onmessageerror?.(event);
    });
  }

  postMessage(message: StudioQualityWorkerInboundMessage): void {
    this.postRaw(message);
  }

  postRaw(message: unknown): void {
    const snapshot = cloneForObservation(message, this.cloneFailures, "outbound");
    this.outbound.push(snapshot);
    this.#inner.postMessage(snapshot);
  }

  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#inner.terminate();
  }

  async waitForOutbound(
    predicate: (message: unknown) => boolean,
    timeoutMs = WORKER_MESSAGE_TIMEOUT_MS,
  ): Promise<unknown> {
    return this.waitForCollection(this.outbound, predicate, "outbound", timeoutMs);
  }

  async waitForInbound(
    predicate: (message: unknown) => boolean,
    timeoutMs = WORKER_MESSAGE_TIMEOUT_MS,
  ): Promise<unknown> {
    return this.waitForCollection(this.inbound, predicate, "inbound", timeoutMs);
  }

  observation(): WorkerObservation {
    return {
      label: this.label,
      createdBy: "createStudioQualityModuleWorker",
      outboundTypes: this.outbound.map(messageType),
      inboundTypes: this.inbound.map(messageType),
      outboundCount: this.outbound.length,
      inboundCount: this.inbound.length,
      errorEvents: [...this.errorEvents],
      messageErrorEvents: [...this.messageErrorEvents],
      cloneFailures: [...this.cloneFailures],
      terminated: this.#terminated,
    };
  }

  private async waitForCollection(
    collection: readonly unknown[],
    predicate: (message: unknown) => boolean,
    direction: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const found = collection.find(predicate);
      if (found !== undefined) return found;
      await wait(5);
    }
    throw new Error(`Timed out waiting for ${this.label} ${direction} Worker message.`);
  }
}

function samplePath(
  pathData: string,
  points: readonly (readonly [number, number])[],
): readonly boolean[] {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable for the SVG geometry oracle.");
  const path = new Path2D(pathData);
  return points.map(([x, y]) => context.isPointInPath(path, x, y, "nonzero"));
}

function portableAudit(values: readonly unknown[]): PortableAudit {
  const violations: string[] = [];
  const forbiddenKeys = new Set<string>();
  let jsonRoundTrips = 0;
  let structuredCloneRoundTrips = 0;

  const inspect = (
    value: unknown,
    path: string,
    ancestors: WeakSet<object>,
  ): void => {
    if (
      value === null
      || typeof value === "string"
      || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))
    ) {
      return;
    }
    if (Array.isArray(value)) {
      if (ancestors.has(value)) {
        violations.push(`${path}: cyclic array`);
        return;
      }
      ancestors.add(value);
      value.forEach((entry, index) => inspect(entry, `${path}[${index}]`, ancestors));
      ancestors.delete(value);
      return;
    }
    if (typeof value !== "object" || value === undefined) {
      violations.push(`${path}: non-portable ${typeof value}`);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      violations.push(`${path}: non-plain prototype ${prototype?.constructor?.name ?? "null"}`);
      return;
    }
    if (ancestors.has(value)) {
      violations.push(`${path}: cyclic object`);
      return;
    }
    ancestors.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (/(?:embind|pointer|wasmheap|skiaobject|canvaskitobject|delete)/iu.test(key)) {
        forbiddenKeys.add(key);
      }
      inspect(entry, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
  };

  for (const [index, value] of values.entries()) {
    inspect(value, `$[${index}]`, new WeakSet());
    try {
      const cloned = structuredClone(value);
      structuredCloneRoundTrips += 1;
      if (JSON.stringify(cloned) !== JSON.stringify(value)) {
        violations.push(`$[${index}]: structured-clone content drift`);
      }
    } catch (error) {
      violations.push(`$[${index}]: structured-clone failed: ${errorEvidence(error).message}`);
    }
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined || JSON.stringify(JSON.parse(encoded)) !== encoded) {
        violations.push(`$[${index}]: JSON content drift`);
      } else {
        jsonRoundTrips += 1;
      }
    } catch (error) {
      violations.push(`$[${index}]: JSON round-trip failed: ${errorEvidence(error).message}`);
    }
  }

  return {
    checkedValues: values.length,
    passed: violations.length === 0 && forbiddenKeys.size === 0,
    violations,
    forbiddenKeys: [...forbiddenKeys],
    jsonRoundTrips,
    structuredCloneRoundTrips,
  };
}

function successfulPathData(
  result: Awaited<ReturnType<StudioQualityWorkerClient["pathBoolean"]>>,
  label: string,
): string {
  if (!result.result.ok) {
    throw new Error(`${label} failed in CanvasKit: ${result.result.reason}`);
  }
  return result.result.pathData;
}

function sameRequest(
  value: unknown,
  request: unknown,
): boolean {
  if (!isRecord(value) || !isRecord(request)) return false;
  return (
    value.requestId === request.requestId
    && value.requestToken === request.requestToken
  );
}

function securityViolation(
  event: SecurityPolicyViolationEvent,
): SecurityPolicyViolationEvidence {
  return {
    blockedUri: event.blockedURI,
    effectiveDirective: event.effectiveDirective,
    violatedDirective: event.violatedDirective,
    disposition: event.disposition,
    sourceFile: event.sourceFile,
    lineNumber: event.lineNumber,
    columnNumber: event.columnNumber,
  };
}

const securityPolicyViolations: SecurityPolicyViolationEvidence[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  securityPolicyViolations.push(securityViolation(event));
});

async function run(): Promise<BrowserQualityWorkerResult> {
  const browserCapabilities = capabilities();
  if (!browserCapabilities.worker) {
    return {
      status: "unsupported",
      reason: "worker-unavailable",
      message: "This Chromium environment has no Worker constructor.",
      capabilities: browserCapabilities,
    };
  }
  if (!browserCapabilities.webAssembly) {
    return {
      status: "unsupported",
      reason: "webassembly-unavailable",
      message: "This Chromium environment has no WebAssembly runtime.",
      capabilities: browserCapabilities,
    };
  }
  if (!browserCapabilities.structuredClone) {
    return {
      status: "unsupported",
      reason: "structured-clone-unavailable",
      message: "This Chromium environment has no structuredClone implementation.",
      capabilities: browserCapabilities,
    };
  }
  if (!browserCapabilities.path2d) {
    return {
      status: "unsupported",
      reason: "path2d-unavailable",
      message: "This Chromium environment has no Path2D SVG oracle.",
      capabilities: browserCapabilities,
    };
  }

  let mainWorker: ObservedQualityWorker | null = null;
  const client = new StudioQualityWorkerClient({
    workerEpoch: MAIN_WORKER_EPOCH,
    clientBuild: "browser-canvaskit-worker-verifier",
    initTimeoutMs: CLIENT_TIMEOUT_MS,
    runTimeoutMs: CLIENT_TIMEOUT_MS,
    workerFactory() {
      mainWorker = new ObservedQualityWorker("client-main");
      return mainWorker;
    },
  });

  const operationResults = await Promise.all(
    (["union", "intersect", "difference", "xor"] as const).map(async (op) => {
      const result = await client.pathBoolean(PATH_A, PATH_B, op);
      const pathData = successfulPathData(result, op);
      return {
        op,
        requestId: result.requestId,
        requestToken: result.requestToken,
        execution: result.execution,
        providerId: result.providerId,
        pathData,
        pathDataCodeUnits: pathData.length,
        samples: samplePath(pathData, BOOLEAN_SAMPLE_POINTS),
        expectedSamples: EXPECTED_BOOLEAN_SAMPLES[op],
      } satisfies BooleanOperationEvidence;
    }),
  );
  if (!mainWorker) throw new Error("The client did not create its module Worker.");

  const repeatedUnion = await client.pathBoolean(PATH_A, PATH_B, "union");
  const repeatedUnionPath = successfulPathData(repeatedUnion, "repeated union");

  const stroke = await client.strokeToFill(STROKE_PATH, STROKE_STYLE);
  const strokePathData = successfulPathData(stroke, "stroke-to-fill");
  const strokeEvidence: StrokeEvidence = {
    requestId: stroke.requestId,
    requestToken: stroke.requestToken,
    execution: stroke.execution,
    providerId: stroke.providerId,
    pathData: strokePathData,
    pathDataCodeUnits: strokePathData.length,
    samples: samplePath(strokePathData, STROKE_SAMPLE_POINTS),
    expectedSamples: EXPECTED_STROKE_SAMPLES,
  };
  const repeatedStroke = await client.strokeToFill(STROKE_PATH, STROKE_STYLE);
  const repeatedStrokePath = successfulPathData(repeatedStroke, "repeated stroke-to-fill");

  const readyMessage = await mainWorker.waitForInbound(
    (message) => messageType(message) === "studio-quality/ready",
  );
  if (!isRecord(readyMessage) || !isRecord(readyMessage.capabilities)) {
    throw new Error("The real CanvasKit Worker did not return a portable ready receipt.");
  }

  const budgetPostsBefore = mainWorker.outbound.length;
  const oversizedPath =
    `M0 0${" ".repeat(STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits)}`;
  let budgetError: unknown = null;
  try {
    await client.pathBoolean(oversizedPath, PATH_B, "union");
  } catch (error) {
    budgetError = error;
  }
  const budgetPostsAfter = mainWorker.outbound.length;
  const budgetRecovery = await client.pathBoolean(PATH_A, PATH_B, "intersect");

  const preAbortedPostsBefore = mainWorker.outbound.length;
  const preAbortedController = new AbortController();
  preAbortedController.abort();
  let preAbortedError: unknown = null;
  try {
    await client.pathBoolean(PATH_A, PATH_B, "union", {
      signal: preAbortedController.signal,
    });
  } catch (error) {
    preAbortedError = error;
  }
  const preAbortedPostsAfter = mainWorker.outbound.length;

  const cancellationController = new AbortController();
  const cancellationOutboundStart = mainWorker.outbound.length;
  const cancellationPromise = client.pathBoolean(PATH_A, PATH_B, "xor", {
    signal: cancellationController.signal,
  });
  // The already-ready client posts in its next promise microtask. Abort in the following page
  // microtask so `pending.posted` is authoritative but the Worker result cannot win a later task.
  await Promise.resolve();
  const cancellationRequest = mainWorker.outbound
    .slice(cancellationOutboundStart)
    .find(
      (message) =>
        isRecord(message)
        && message.type === "studio-quality/request",
    );
  if (!isRecord(cancellationRequest) || typeof cancellationRequest.requestId !== "number") {
    throw new Error("The in-flight cancellation request was not posted.");
  }
  cancellationController.abort();
  let inFlightCancellationError: unknown = null;
  try {
    await cancellationPromise;
  } catch (error) {
    inFlightCancellationError = error;
  }
  await mainWorker.waitForOutbound(
    (message) =>
      isRecord(message)
      && message.type === "studio-quality/cancel"
      && sameRequest(message, cancellationRequest),
  );
  await mainWorker.waitForInbound(
    (message) =>
      sameRequest(message, cancellationRequest)
      && (
        messageType(message) === "studio-quality/result"
        || messageType(message) === "studio-quality/cancelled"
        || messageType(message) === "studio-quality/failure"
      ),
  );
  await wait(20);
  const lateWorkerOutcomeTypes = mainWorker.inbound
    .filter((message) => sameRequest(message, cancellationRequest))
    .map(messageType);
  const cancellationRecovery = await client.pathBoolean(PATH_A, PATH_B, "union");

  const malformedWorker = new ObservedQualityWorker("malformed-payload");
  malformedWorker.postRaw({
    type: "studio-quality/initialize",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: INVALID_WORKER_EPOCH,
    clientBuild: "browser-invalid-payload-verifier",
  });
  const malformedReady = await malformedWorker.waitForInbound(
    (message) =>
      isRecord(message)
      && message.type === "studio-quality/ready"
      && message.workerEpoch === INVALID_WORKER_EPOCH,
  );
  malformedWorker.postRaw({
    type: "studio-quality/request",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: INVALID_WORKER_EPOCH,
    requestId: 1,
    requestToken: `q:${INVALID_WORKER_EPOCH}:1:path-boolean`,
    operation: {
      kind: "path-boolean",
      a: PATH_A,
      b: PATH_B,
      op: "union",
    },
    unexpectedField: "must-fail-closed",
  });
  const malformedFatal = await malformedWorker.waitForInbound(
    (message) => isRecord(message) && message.type === "studio-quality/fatal",
  );
  if (
    !isRecord(malformedReady)
    || !isRecord(malformedFatal)
    || !isRecord(malformedFatal.error)
  ) {
    throw new Error("Malformed payload Worker did not return a structured fatal receipt.");
  }

  const recoveryPathData = successfulPathData(cancellationRecovery, "cancellation recovery");
  const budgetRecoveryPathData = successfulPathData(budgetRecovery, "budget recovery");
  const allBoundaryValues = [
    ...mainWorker.outbound,
    ...mainWorker.inbound,
    ...malformedWorker.outbound,
    ...malformedWorker.inbound,
    ...operationResults,
    strokeEvidence,
  ];
  const boundaryAudit = portableAudit(allBoundaryValues);

  const mainObservationBeforeDispose = mainWorker.observation();
  const malformedObservationBeforeTerminate = malformedWorker.observation();
  client.dispose();
  malformedWorker.terminate();

  return {
    status: "ok",
    backend: "canvaskit-wasm-module-worker",
    capabilities: browserCapabilities,
    provider: {
      id: "canvaskit",
      profile: readyMessage.providerProfile as "canvaskit-pathops-stroke-v1",
      workerEpoch: readyMessage.workerEpoch as number,
      capabilities: {
        pathBoolean: true,
        strokeToPath: true,
      },
      limits: readyMessage.limits as Readonly<Record<string, number>>,
    },
    booleanOperations: operationResults,
    strokeToFill: strokeEvidence,
    determinism: {
      booleanSameInputExactPathData:
        operationResults[0]?.pathData === repeatedUnionPath,
      strokeSameInputExactPathData: strokePathData === repeatedStrokePath,
      booleanFirstCodeUnits: operationResults[0]?.pathData.length ?? 0,
      strokeFirstCodeUnits: strokePathData.length,
    },
    structuredCloneBoundary: boundaryAudit,
    budgetFailClosed: {
      limitCodeUnits: STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits,
      testedCodeUnits: oversizedPath.length,
      error: errorEvidence(budgetError),
      workerPostDelta: budgetPostsAfter - budgetPostsBefore,
      pendingCountAfterFailure: client.pendingCount,
      recoveryProviderId: budgetRecovery.providerId,
      recoveryOk: budgetRecovery.result.ok && budgetRecoveryPathData.length > 0,
    },
    cancellationFailClosed: {
      preAbortedError: errorEvidence(preAbortedError),
      preAbortedWorkerPostDelta:
        preAbortedPostsAfter - preAbortedPostsBefore,
      inFlightError: errorEvidence(inFlightCancellationError),
      cancelMessagePosted: mainWorker.outbound.some(
        (message) =>
          isRecord(message)
          && message.type === "studio-quality/cancel"
          && sameRequest(message, cancellationRequest),
      ),
      cancelledRequestId: cancellationRequest.requestId,
      lateWorkerOutcomeTypes,
      resultDeliveredToCaller: false,
      pendingCountAfterAbort: client.pendingCount,
      recoveryProviderId: cancellationRecovery.providerId,
      recoveryOk: cancellationRecovery.result.ok && recoveryPathData.length > 0,
    },
    malformedPayloadFailClosed: {
      initializedRealProvider:
        malformedReady.providerId === "canvaskit"
        && malformedReady.providerProfile === "canvaskit-pathops-stroke-v1",
      fatalType: "studio-quality/fatal",
      fatalStage:
        typeof malformedFatal.stage === "string" ? malformedFatal.stage : "",
      fatalCode:
        typeof malformedFatal.error.code === "string"
          ? malformedFatal.error.code
          : "",
      fatalWorkerEpoch:
        typeof malformedFatal.workerEpoch === "number"
          ? malformedFatal.workerEpoch
          : null,
      requestId:
        typeof malformedFatal.requestId === "number"
          ? malformedFatal.requestId
          : null,
    },
    workerObservations: [
      {
        ...mainObservationBeforeDispose,
        terminated: true,
      },
      {
        ...malformedObservationBeforeTerminate,
        terminated: true,
      },
    ],
    securityPolicyViolations,
  };
}

void run().then(
  (result) => {
    window.__studioCanvasKitQualityWorkerResult = result;
  },
  (error) => {
    window.__studioCanvasKitQualityWorkerResult = {
      status: "error",
      message: errorEvidence(error).message,
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
      securityPolicyViolations,
    };
  },
);
