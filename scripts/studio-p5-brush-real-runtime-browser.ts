import {
  probeStudioProceduralArtisticBrushWorker,
  renderStudioProceduralArtisticBrushInWorker,
} from "../apps/web/src/domains/creator/studio-procedural-artistic-brush-worker-client";

import {
  studioP5BrushRealRuntimeCaseEvidence,
  studioP5BrushRealRuntimeRequest,
} from "./studio-p5-brush-real-runtime-fixture";
import {
  STUDIO_P5_BRUSH_REAL_RUNTIME_CASE_IDS,
  type StudioP5BrushContextAffinityStressResult,
  type StudioP5BrushRealBrowserResult,
  type StudioP5BrushRealRuntimeCaseEvidence,
  type StudioP5BrushRealRuntimeResult,
  type StudioP5BrushSecurityPolicyViolation,
} from "./studio-p5-brush-real-runtime-protocol";

const RESULT_TIMEOUT_MS = 90_000;

declare global {
  interface Window {
    __studioP5BrushRealRuntimeResult?: StudioP5BrushRealBrowserResult;
  }
}

const securityPolicyViolations: StudioP5BrushSecurityPolicyViolation[] = [];
window.addEventListener("securitypolicyviolation", (event) => {
  securityPolicyViolations.push(Object.freeze({
    blockedUri: event.blockedURI,
    effectiveDirective: event.effectiveDirective,
    violatedDirective: event.violatedDirective,
    disposition: event.disposition,
  }));
});

function publish(
  result: StudioP5BrushRealRuntimeResult,
  contextAffinityStress: StudioP5BrushContextAffinityStressResult | null,
): void {
  window.__studioP5BrushRealRuntimeResult = Object.freeze({
    result,
    contextAffinityStress,
    mainThread: Object.freeze({
      worker: typeof Worker === "function",
      userAgent: navigator.userAgent,
    }),
    securityPolicyViolations: Object.freeze([...securityPolicyViolations]),
  });
}

function serializedError(error: unknown): Readonly<{
  message: string;
  stack: string | null;
}> {
  return error instanceof Error
    ? Object.freeze({ message: error.message, stack: error.stack ?? null })
    : Object.freeze({ message: String(error), stack: null });
}

function errorResult(error: unknown): StudioP5BrushRealRuntimeResult {
  const serialized = serializedError(error);
  return Object.freeze({
    status: "error",
    message: serialized.message,
    stack: serialized.stack,
    probe: Object.freeze({
      dedicatedWorkerScope: false,
      offscreenCanvas: typeof OffscreenCanvas === "function",
      webgl2ContextAttempted: false,
    }),
  });
}

async function runProductOneShotGate(): Promise<StudioP5BrushRealRuntimeResult> {
  const capability = await probeStudioProceduralArtisticBrushWorker({
    startupTimeoutMilliseconds: RESULT_TIMEOUT_MS,
  });
  if (!capability.available) {
    return Object.freeze({
      status: "unsupported",
      reason: capability.reason,
      message: capability.detail,
      probe: Object.freeze({
        dedicatedWorkerScope:
          capability.reason !== "dedicated-worker-unavailable",
        offscreenCanvas:
          capability.reason !== "dedicated-worker-unavailable"
          && capability.reason !== "offscreen-canvas-unavailable",
        webgl2ContextAttempted: capability.reason === "webgl2-unavailable",
      }),
    });
  }

  const cases: StudioP5BrushRealRuntimeCaseEvidence[] = [];
  let requestSequence = 1;
  let adapterVersion: string | null = null;
  for (const technique of STUDIO_P5_BRUSH_REAL_RUNTIME_CASE_IDS) {
    // Do not overlap Worker/WebGL2 lifetimes. Every call creates the exact
    // production module Worker, renders once, transfers owned RGBA, and exits.
    const first = await renderStudioProceduralArtisticBrushInWorker(
      studioP5BrushRealRuntimeRequest(technique, requestSequence),
      {
        startupTimeoutMilliseconds: RESULT_TIMEOUT_MS,
        operationTimeoutMilliseconds: RESULT_TIMEOUT_MS,
      },
    );
    requestSequence += 1;
    const replay = await renderStudioProceduralArtisticBrushInWorker(
      studioP5BrushRealRuntimeRequest(technique, requestSequence),
      {
        startupTimeoutMilliseconds: RESULT_TIMEOUT_MS,
        operationTimeoutMilliseconds: RESULT_TIMEOUT_MS,
      },
    );
    requestSequence += 1;
    if (first.receipt.adapter.version !== replay.receipt.adapter.version) {
      throw new Error(`${technique} replay changed the production adapter.`);
    }
    if (
      adapterVersion !== null
      && adapterVersion !== first.receipt.adapter.version
    ) {
      throw new Error(`${technique} changed the production adapter version.`);
    }
    adapterVersion = first.receipt.adapter.version;
    cases.push(studioP5BrushRealRuntimeCaseEvidence(
      technique,
      first,
      replay,
    ));
  }
  if (adapterVersion === null) {
    throw new Error("The product one-shot gate rendered no techniques.");
  }
  return Object.freeze({
    status: "ok",
    backend: "p5.brush/standalone-offscreen-webgl2",
    topology: "production-one-shot-worker-per-render",
    adapterVersion,
    capabilities: Object.freeze({
      worker: true,
      dedicatedWorkerScope: true,
      workerScopeConstructor: capability.probe.workerScope,
      offscreenCanvas: true,
      webgl2: true,
      privateSurface: capability.probe.privateSurface,
      mainThreadFallback: capability.probe.mainThreadFallback,
      webglVersion: capability.probe.webglVersion,
    }),
    cases: Object.freeze(cases),
    probeWorkerCount: 1,
    renderWorkerCount: cases.length * 2,
    surfaceCount: cases.length * 2,
  });
}

function runContextAffinityStress(): Promise<
  StudioP5BrushContextAffinityStressResult
> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./studio-p5-brush-real-runtime-worker.ts", import.meta.url),
      {
        name: "studio-p5-brush-context-affinity-stress",
        type: "module",
      },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve(Object.freeze({
        status: "error",
        message: `Context-affinity stress exceeded ${RESULT_TIMEOUT_MS}ms.`,
        stack: null,
      }));
    }, RESULT_TIMEOUT_MS);
    worker.addEventListener("message", (
      event: MessageEvent<StudioP5BrushContextAffinityStressResult>,
    ) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    }, { once: true });
    worker.addEventListener("error", (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(Object.freeze({
        status: "error",
        message: event.message || "Context-affinity stress Worker failed.",
        stack: null,
      }));
    }, { once: true });
    worker.postMessage({ type: "studio-p5-brush-context-affinity/start" });
  });
}

async function run(): Promise<void> {
  if (typeof Worker !== "function") {
    publish(errorResult("Chromium does not expose the Worker constructor."), null);
    return;
  }
  try {
    const result = await runProductOneShotGate();
    if (result.status !== "ok") {
      publish(result, null);
      return;
    }
    const contextAffinityStress = await runContextAffinityStress();
    publish(result, contextAffinityStress);
  } catch (error: unknown) {
    publish(errorResult(error), null);
  }
}

void run();
