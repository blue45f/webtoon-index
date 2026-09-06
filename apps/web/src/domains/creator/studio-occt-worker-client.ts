import { studioOcctTopologyReceiptMatchesMesh } from "./studio-occt-wasm-facade";

import type { StudioEditableMesh } from "./studio-editable-half-edge-mesh";
import type {
  StudioOcctBodyKind,
  StudioOcctMassProperties,
  StudioOcctSolidResult,
  StudioOcctTopologyReceipt,
} from "./studio-occt-wasm-facade";
import type {
  StudioOcctWorkerOperation,
  StudioOcctWorkerRequest,
  StudioOcctWorkerResponse,
} from "./studio-occt-worker-protocol";

type PendingOperation = {
  readonly id: number;
  readonly operation: StudioOcctWorkerOperation;
  readonly resolve: (result: StudioOcctSolidResult) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
  readonly detachAbort: () => void;
  state: "queued" | "active";
};

let nextRequestId = 1;
let nextWorkerGenerationId = 1;
type SharedWorkerGeneration = {
  readonly id: number;
  readonly worker: Worker;
};
let workerGeneration: SharedWorkerGeneration | null = null;
let activeRequestId: number | null = null;
const pending = new Map<number, PendingOperation>();
const queuedRequestIds: number[] = [];
const isolatedTerminators = new Set<(error: Error) => void>();

/**
 * opencascade.js@1.1.1 wrappers whose `.delete()` corrupts the Embind table.
 * They are safe only when the entire WASM instance is discarded with its Worker.
 */
const REALM_ISOLATED_OPERATION_KINDS = new Set<StudioOcctWorkerOperation["kind"]>([
  "thick-shell-box",
  "fillet2d-extrude",
  "step-roundtrip-box",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteVec3(value: unknown): boolean {
  return isRecord(value)
    && typeof value.x === "number"
    && Number.isFinite(value.x)
    && typeof value.y === "number"
    && Number.isFinite(value.y)
    && typeof value.z === "number"
    && Number.isFinite(value.z);
}

function isStudioOcctTopologyReceipt(
  value: unknown,
): value is StudioOcctTopologyReceipt {
  return isRecord(value)
    && value.source === "tessellated-triangle-mesh"
    && isNonNegativeInteger(value.boundaryEdgeCount)
    && isNonNegativeInteger(value.nonManifoldEdgeCount)
    && isNonNegativeInteger(value.orientationConflictEdgeCount)
    && isNonNegativeInteger(value.degenerateTriangleCount)
    && typeof value.consistentOrientation === "boolean"
    && typeof value.watertight === "boolean"
    && typeof value.closedSolid === "boolean"
    && typeof value.signedVolume === "number"
    && Number.isFinite(value.signedVolume);
}

function isStudioOcctMassProperties(
  value: unknown,
): value is StudioOcctMassProperties {
  if (!isRecord(value)) return false;
  const inertia = value.inertia;
  const validInertia = inertia === null || (
    isRecord(inertia)
    && ["xx", "yy", "zz", "xy", "xz", "yz"].every((key) => (
      typeof inertia[key] === "number" && Number.isFinite(inertia[key])
    ))
  );
  return (value.source === "occt-brep" || value.source === "mixed-fallback")
    && value.density === 1
    && value.densityUnit === "mass/model-unit^3"
    && isFiniteNonNegative(value.mass)
    && isFiniteNonNegative(value.volume)
    && ["occt-brep", "analytic-fallback", "tessellated-mesh"].includes(
      String(value.volumeSource),
    )
    && isFiniteNonNegative(value.surfaceArea)
    && ["occt-brep", "tessellated-mesh"].includes(String(value.surfaceAreaSource))
    && (value.centroid === null || isFiniteVec3(value.centroid))
    && ["occt-brep", "tessellated-mesh", "unavailable"].includes(
      String(value.centroidSource),
    )
    && validInertia
    && ["occt-brep", "unavailable"].includes(String(value.inertiaSource))
    && typeof value.approximate === "boolean";
}

function expectedBodyKind(
  operation: StudioOcctWorkerOperation,
): StudioOcctBodyKind {
  return operation.kind === "section-box" ? "surface" : "solid";
}

function isStudioOcctWorkerResponse(
  value: unknown,
  expectedLoadPath: "browser" | "node",
  expectedKind?: StudioOcctBodyKind,
): value is StudioOcctWorkerResponse {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1) {
    return false;
  }
  const result = value.result;
  if (!isRecord(result) || typeof result.ok !== "boolean") return false;
  if (!result.ok) {
    return typeof result.code === "string"
      && result.code.length > 0
      && typeof result.detail === "string";
  }
  const mesh = result.mesh;
  const topology = result.topology;
  const massProperties = result.massProperties;
  const validTopology = isStudioOcctTopologyReceipt(topology);
  const validMassProperties = isStudioOcctMassProperties(massProperties);
  const validBodyKind = result.bodyKind === "solid" || result.bodyKind === "surface";
  const validMeshShape = isRecord(mesh)
    && mesh.revision === 1
    && Array.isArray(mesh.vertices)
    && Array.isArray(mesh.halfEdges)
    && Array.isArray(mesh.faces)
    && isNonNegativeInteger(mesh.nextVertexId)
    && isNonNegativeInteger(mesh.nextHalfEdgeId)
    && isNonNegativeInteger(mesh.nextFaceId);
  const canonicalTopologyMatches = validMeshShape && validTopology
    ? studioOcctTopologyReceiptMatchesMesh(
        mesh as unknown as StudioEditableMesh,
        topology,
      )
    : false;
  const validBodySemantics = validTopology && validMassProperties && validBodyKind && (
    result.bodyKind === "solid"
      ? topology.watertight
        && topology.closedSolid
        && massProperties.volume > 1e-12
      : !topology.closedSolid
        && massProperties.surfaceArea > 1e-12
        && massProperties.volume <= 1e-12
  );
  return result.backend === "opencascade-wasm"
    && result.loadPath === expectedLoadPath
    && validBodyKind
    && (expectedKind === undefined || result.bodyKind === expectedKind)
    && typeof result.operation === "string"
    && result.operation.length > 0
    && isNonNegativeInteger(result.faceCount)
    && isNonNegativeInteger(result.triangleCount)
    && isNonNegativeInteger(result.vertexCount)
    && typeof result.volumeApprox === "number"
    && Number.isFinite(result.volumeApprox)
    && validBodySemantics
    && validMeshShape
    && result.vertexCount === (mesh.vertices as unknown[]).length
    && canonicalTopologyMatches;
}

function isNodeEnvironment(): boolean {
  if (typeof window !== "undefined") return false;
  try {
    const processValue = (globalThis as {
      readonly process?: { readonly versions?: { readonly node?: unknown } };
    }).process;
    return typeof processValue?.versions?.node === "string"
      && processValue.versions.node.length > 0;
  } catch {
    return false;
  }
}

function workerTransportError(prefix: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${prefix}: ${detail}`);
}

function detachPending(operation: PendingOperation): void {
  pending.delete(operation.id);
  clearTimeout(operation.timeoutId);
  operation.detachAbort();
}

function scheduleSharedWorkerPump(): void {
  queueMicrotask(pumpSharedWorker);
}

function terminateGeneration(generation: SharedWorkerGeneration): void {
  generation.worker.terminate();
  if (workerGeneration === generation) workerGeneration = null;
}

function failActiveGeneration(
  generation: SharedWorkerGeneration,
  error: Error,
): void {
  if (workerGeneration !== generation) return;
  terminateGeneration(generation);
  const operation = activeRequestId === null
    ? undefined
    : pending.get(activeRequestId);
  activeRequestId = null;
  if (operation) {
    detachPending(operation);
    operation.reject(error);
  }
  scheduleSharedWorkerPump();
}

function ensureWorkerGeneration(): SharedWorkerGeneration {
  if (workerGeneration) return workerGeneration;
  const next = new Worker(new URL("./studio-occt.worker.ts", import.meta.url), {
    name: "toonspectrum-occt",
    type: "module",
  });
  const generation: SharedWorkerGeneration = {
    id: nextWorkerGenerationId,
    worker: next,
  };
  nextWorkerGenerationId += 1;
  next.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (workerGeneration !== generation) return;
    const operation = activeRequestId === null
      ? undefined
      : pending.get(activeRequestId);
    if (
      !operation
      || !isStudioOcctWorkerResponse(
        event.data,
        "browser",
        expectedBodyKind(operation.operation),
      )
      || event.data.id !== operation.id
    ) {
      failActiveGeneration(
        generation,
        new Error("OCCT Worker returned an invalid response payload"),
      );
      return;
    }
    const response = event.data;
    activeRequestId = null;
    detachPending(operation);
    if (!response.result.ok) {
      operation.reject(new Error(`${response.result.code}: ${response.result.detail}`));
    } else {
      operation.resolve(response.result);
    }
    scheduleSharedWorkerPump();
  });
  next.addEventListener("error", (event) => {
    failActiveGeneration(
      generation,
      new Error(event.message || "OCCT Worker crashed"),
    );
  });
  next.addEventListener("messageerror", () => {
    failActiveGeneration(
      generation,
      new Error("OCCT Worker returned an unreadable result"),
    );
  });
  workerGeneration = generation;
  return generation;
}

function pumpSharedWorker(): void {
  if (activeRequestId !== null) return;
  let operation: PendingOperation | undefined;
  while (queuedRequestIds.length > 0 && !operation) {
    const id = queuedRequestIds.shift();
    if (id !== undefined) operation = pending.get(id);
  }
  if (!operation) return;

  let generation: SharedWorkerGeneration;
  try {
    generation = ensureWorkerGeneration();
  } catch (error) {
    detachPending(operation);
    operation.reject(workerTransportError("OCCT Worker construction failed", error));
    scheduleSharedWorkerPump();
    return;
  }

  operation.state = "active";
  activeRequestId = operation.id;
  const request: StudioOcctWorkerRequest = {
    id: operation.id,
    operation: operation.operation,
  };
  try {
    generation.worker.postMessage(request);
  } catch (error) {
    failActiveGeneration(
      generation,
      workerTransportError("OCCT Worker postMessage failed", error),
    );
  }
}

function cancelSharedOperation(id: number, error: Error): void {
  const operation = pending.get(id);
  if (!operation) return;
  if (operation.state === "active") {
    const generation = workerGeneration;
    activeRequestId = null;
    if (generation) terminateGeneration(generation);
  }
  detachPending(operation);
  operation.reject(error);
  scheduleSharedWorkerPump();
}

function runInOneShotBrowserWorker(
  id: number,
  operation: StudioOcctWorkerOperation,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
  },
): Promise<StudioOcctSolidResult> {
  const isolatedWorker = new Worker(new URL("./studio-occt.worker.ts", import.meta.url), {
    name: `toonspectrum-occt-isolated-${id}`,
    type: "module",
  });
  return new Promise<StudioOcctSolidResult>((resolve, reject) => {
    let settled = false;
    const settle = (
      next: { readonly ok: true; readonly result: StudioOcctSolidResult }
        | { readonly ok: false; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      isolatedTerminators.delete(terminateWithError);
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
      isolatedWorker.terminate();
      if (next.ok) resolve(next.result);
      else reject(next.error);
    };
    const abort = () => settle({
      ok: false,
      error: new DOMException("OCCT operation aborted", "AbortError"),
    });
    const terminateWithError = (error: Error) => settle({ ok: false, error });
    const timeoutId = setTimeout(() => settle({
      ok: false,
      error: new Error(`OCCT Worker timed out after ${options.timeoutMs}ms`),
    }), options.timeoutMs);
    isolatedTerminators.add(terminateWithError);
    options.signal?.addEventListener("abort", abort, { once: true });
    isolatedWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        !isStudioOcctWorkerResponse(
          event.data,
          "browser",
          expectedBodyKind(operation),
        )
        || event.data.id !== id
      ) {
        settle({
          ok: false,
          error: new Error("OCCT Worker returned an invalid response payload"),
        });
        return;
      }
      if (!event.data.result.ok) {
        settle({
          ok: false,
          error: new Error(`${event.data.result.code}: ${event.data.result.detail}`),
        });
        return;
      }
      settle({ ok: true, result: event.data.result });
    });
    isolatedWorker.addEventListener("error", (event) => settle({
      ok: false,
      error: new Error(event.message || "OCCT Worker crashed"),
    }));
    isolatedWorker.addEventListener("messageerror", () => settle({
      ok: false,
      error: new Error("OCCT Worker returned an unreadable result"),
    }));

    try {
      const request: StudioOcctWorkerRequest = { id, operation };
      isolatedWorker.postMessage(request);
    } catch (error) {
      settle({
        ok: false,
        error: workerTransportError("OCCT Worker postMessage failed", error),
      });
    }
  });
}

async function runOnNode(
  operation: StudioOcctWorkerOperation,
): Promise<StudioOcctSolidResult> {
  const facadeModuleId = "./studio-occt-wasm-facade";
  const facade = await import(
    /* @vite-ignore */ facadeModuleId
  ) as typeof import("./studio-occt-wasm-facade");
  const result = await (async () => {
    switch (operation.kind) {
      case "box":
        return facade.occtMakeBoxSolid(...operation.size);
      case "sphere":
        return facade.occtMakeSphereSolid(operation.radius);
      case "torus":
        return facade.occtMakeTorusSolid(operation.majorRadius, operation.minorRadius);
      case "pipe":
        return facade.occtMakePipeSolid(operation.length, operation.radius);
      case "mirror-box":
        return facade.occtMirrorBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
        );
      case "thick-shell-box":
        return facade.occtMakeThickShellBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.thickness,
        );
      case "wedge":
        return facade.occtMakeWedgeSolid(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.ltx,
        );
      case "offset-shape-box":
        return facade.occtOffsetShapeBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.offset,
        );
      case "fillet2d-extrude":
        return facade.occtFillet2dExtrudeSolid(
          operation.width,
          operation.height,
          operation.depth,
          operation.filletRadius,
        );
      case "pipe-shell":
        return facade.occtMakePipeShellSolid(operation.length, operation.radius);
      case "section-box":
        return facade.occtSectionBoxByPlane(
          operation.size[0],
          operation.size[1],
          operation.size[2],
        );
      case "draft-prism":
        return facade.occtDraftPrismOnBox(
          operation.baseSize,
          operation.profileInset,
          operation.height,
          operation.angle,
        );
      case "linear-pattern-box":
        return facade.occtLinearPatternBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.offsetX,
          operation.count,
        );
      case "circular-pattern-box":
        return facade.occtCircularPatternBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.radius,
          operation.count,
        );
      case "step-roundtrip-box": {
        const step = await facade.occtStepRoundTripBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
        );
        if (!step.ok) {
          return { ok: false as const, code: step.code, detail: step.detail };
        }
        return {
          ok: true as const,
          bodyKind: step.bodyKind,
          mesh: step.mesh,
          faceCount: step.faceCount,
          triangleCount: step.triangleCount,
          vertexCount: step.vertexCount,
          volumeApprox: step.volumeApprox,
          topology: step.topology,
          massProperties: step.massProperties,
          backend: "opencascade-wasm" as const,
          operation: step.operation,
          loadPath: step.loadPath,
        };
      }
      case "revolve":
        return facade.occtRevolveCylinderLike(operation.radius, operation.height);
      case "fillet-box":
        return facade.occtFilletBox(
          operation.size[0],
          operation.size[1],
          operation.size[2],
          operation.radius,
        );
      case "loft":
        return facade.occtLoftedTower(operation.levels);
      case "cut-boxes":
        return facade.occtBooleanCutBoxes(operation.a, operation.b);
      default: {
        const _exhaustive: never = operation;
        return {
          ok: false as const,
          code: "unknown-op",
          detail: String(_exhaustive),
        };
      }
    }
  })();
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result;
}

const NODE_ISOLATED_CHILD_FLAG = "TOONSPECTRUM_OCCT_NODE_ISOLATED_CHILD";
const NODE_ISOLATED_OPERATION = "TOONSPECTRUM_OCCT_NODE_OPERATION";
const NODE_ISOLATED_REQUEST_ID = "TOONSPECTRUM_OCCT_NODE_REQUEST_ID";
const NODE_ISOLATED_MODULE_URL = "TOONSPECTRUM_OCCT_NODE_MODULE_URL";

function isNodeIsolatedChild(): boolean {
  return process.env[NODE_ISOLATED_CHILD_FLAG] === "1";
}

const NODE_ISOLATED_CHILD_SOURCE = String.raw`
const sendAndExit = (payload, fallbackCode = 1) => {
  if (typeof process.send !== "function") process.exit(fallbackCode);
  process.send(payload, (error) => process.exit(error ? fallbackCode : 0));
};
void (async () => {
  const id = Number(process.env.TOONSPECTRUM_OCCT_NODE_REQUEST_ID);
  try {
    const operation = JSON.parse(
      Buffer.from(process.env.TOONSPECTRUM_OCCT_NODE_OPERATION || "", "base64url")
        .toString("utf8"),
    );
    const moduleUrl = process.env.TOONSPECTRUM_OCCT_NODE_MODULE_URL;
    if (!moduleUrl) throw new Error("isolated OCCT module URL is missing");
    const client = await import(moduleUrl);
    const result = await client.runStudioOcctOperation(operation);
    sendAndExit({ id, result });
  } catch (error) {
    sendAndExit({
      id,
      result: {
        ok: false,
        code: "occt-node-isolated-failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
})();
`;

async function runInOneShotNodeProcess(
  id: number,
  operation: StudioOcctWorkerOperation,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
  },
): Promise<StudioOcctSolidResult> {
  const startedAt = Date.now();
  const childProcessModuleId = "node:child_process";
  const moduleModuleId = "node:module";
  const [{ spawn }, { createRequire }] = await Promise.all([
    import(/* @vite-ignore */ childProcessModuleId) as Promise<
      typeof import("node:child_process")
    >,
    import(/* @vite-ignore */ moduleModuleId) as Promise<typeof import("node:module")>,
  ]);
  if (options.signal?.aborted) {
    throw new DOMException("OCCT operation aborted", "AbortError");
  }

  const sourceModule = import.meta.url.endsWith(".ts");
  // The child imports the exact module that owns this operation. Building a templated sibling
  // URL here makes Vite expand every matching `studio-occt-worker-client.*` file, which can ship
  // test sources as production assets. `import.meta.url` is already the correct `.ts` URL under
  // the tsx test/runtime path and the emitted chunk URL in a production build.
  const moduleUrl = import.meta.url;
  const commandArguments = sourceModule
    ? [createRequire(import.meta.url).resolve("tsx/cli"), "--eval", NODE_ISOLATED_CHILD_SOURCE]
    : ["--eval", NODE_ISOLATED_CHILD_SOURCE];
  const child = spawn(process.execPath, commandArguments, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [NODE_ISOLATED_CHILD_FLAG]: "1",
      [NODE_ISOLATED_OPERATION]: Buffer.from(
        JSON.stringify(operation),
        "utf8",
      ).toString("base64url"),
      [NODE_ISOLATED_REQUEST_ID]: String(id),
      [NODE_ISOLATED_MODULE_URL]: moduleUrl,
    },
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });

  return new Promise<StudioOcctSolidResult>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const settle = (
      next: { readonly ok: true; readonly result: StudioOcctSolidResult }
        | { readonly ok: false; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      isolatedTerminators.delete(terminateWithError);
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abort);
      child.kill("SIGKILL");
      if (next.ok) resolve(next.result);
      else reject(next.error);
    };
    const abort = () => settle({
      ok: false,
      error: new DOMException("OCCT operation aborted", "AbortError"),
    });
    const terminateWithError = (error: Error) => settle({ ok: false, error });
    const remainingMs = Math.max(1, options.timeoutMs - (Date.now() - startedAt));
    const timeoutId = setTimeout(() => settle({
      ok: false,
      error: new Error(`OCCT Node realm timed out after ${options.timeoutMs}ms`),
    }), remainingMs);
    isolatedTerminators.add(terminateWithError);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length >= 16_384) return;
      stderr = `${stderr}${String(chunk)}`.slice(0, 16_384);
    });
    child.on("message", (message: unknown) => {
      if (
        !isStudioOcctWorkerResponse(
          message,
          "node",
          expectedBodyKind(operation),
        )
        || message.id !== id
      ) {
        settle({
          ok: false,
          error: new Error("OCCT Node realm returned an invalid response payload"),
        });
        return;
      }
      if (!message.result.ok) {
        settle({
          ok: false,
          error: new Error(`${message.result.code}: ${message.result.detail}`),
        });
        return;
      }
      settle({ ok: true, result: message.result });
    });
    child.on("error", (error) => settle({
      ok: false,
      error: workerTransportError("OCCT Node realm failed", error),
    }));
    child.on("exit", (code, signal) => {
      if (settled) return;
      const detail = stderr.trim();
      settle({
        ok: false,
        error: new Error(
          `OCCT Node realm exited before a result (code=${code ?? "null"}, signal=${signal ?? "none"})${
            detail ? `: ${detail}` : ""
          }`,
        ),
      });
    });
    if (options.signal?.aborted) abort();
  });
}

export async function runStudioOcctOperation(
  operation: StudioOcctWorkerOperation,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): Promise<StudioOcctSolidResult> {
  if (options.signal?.aborted) {
    throw new DOMException("OCCT operation aborted", "AbortError");
  }
  const id = nextRequestId;
  nextRequestId += 1;
  const timeoutMs = Math.max(1_000, Math.min(300_000, options.timeoutMs ?? 120_000));
  if (isNodeEnvironment()) {
    if (
      REALM_ISOLATED_OPERATION_KINDS.has(operation.kind)
      && !isNodeIsolatedChild()
    ) {
      return runInOneShotNodeProcess(id, operation, {
        signal: options.signal,
        timeoutMs,
      });
    }
    return runOnNode(operation);
  }
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("OCCT Worker is unavailable in this browser");
  }

  if (REALM_ISOLATED_OPERATION_KINDS.has(operation.kind)) {
    return runInOneShotBrowserWorker(id, operation, {
      signal: options.signal,
      timeoutMs,
    });
  }
  return new Promise<StudioOcctSolidResult>((resolve, reject) => {
    const abort = () => cancelSharedOperation(
      id,
      new DOMException("OCCT operation aborted", "AbortError"),
    );
    const detachAbort = () => options.signal?.removeEventListener("abort", abort);
    const timeoutId = setTimeout(() => cancelSharedOperation(
      id,
      new Error(`OCCT Worker timed out after ${timeoutMs}ms`),
    ), timeoutMs);
    pending.set(id, {
      id,
      operation,
      resolve,
      reject,
      timeoutId,
      detachAbort,
      state: "queued",
    });
    queuedRequestIds.push(id);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    pumpSharedWorker();
  });
}

export function disposeStudioOcctWorker(): void {
  const generation = workerGeneration;
  if (generation) terminateGeneration(generation);
  activeRequestId = null;
  queuedRequestIds.length = 0;
  const error = new Error("OCCT Worker disposed");
  for (const operation of pending.values()) {
    clearTimeout(operation.timeoutId);
    operation.detachAbort();
    operation.reject(error);
  }
  pending.clear();
  for (const terminate of [...isolatedTerminators]) {
    terminate(error);
  }
}
