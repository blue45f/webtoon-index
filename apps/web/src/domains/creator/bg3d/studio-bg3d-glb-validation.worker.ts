/// <reference lib="webworker" />

import { validateStudioBg3dGlb } from "./studio-bg3d-glb-validation";
import {
  STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
  isStudioBg3dGlbWorkerRequest,
  type StudioBg3dGlbWorkerResponse,
  type StudioBg3dGlbWorkerValidateRequest,
} from "./studio-bg3d-glb-validation-worker-protocol";
import { loadPinnedStudioBg3dKtx2TranscoderAssets } from "./studio-bg3d-ktx2-transcoder-assets";
import {
  createStudioBg3dKtx2TranscoderRuntime,
  type StudioBg3dKtx2TranscoderRuntime,
} from "./studio-bg3d-ktx2-transcoder-runtime";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const activeRequests = new Map<number, AbortController>();
let requestQueue: Promise<void> = Promise.resolve();
let runtimePromise: Promise<StudioBg3dKtx2TranscoderRuntime> | null = null;
let runtimeGeneration = 0;

function finishRequest(requestId: number): boolean {
  const controller = activeRequests.get(requestId);
  activeRequests.delete(requestId);
  return controller?.signal.aborted ?? true;
}

async function getBasisRuntime(signal: AbortSignal): Promise<StudioBg3dKtx2TranscoderRuntime> {
  if (!runtimePromise) {
    runtimeGeneration += 1;
    const generation = runtimeGeneration;
    const pending = createStudioBg3dKtx2TranscoderRuntime({
      generation,
      signal,
      loadAssets: loadPinnedStudioBg3dKtx2TranscoderAssets,
    });
    runtimePromise = pending;
    void pending.catch(() => {
      if (runtimePromise === pending) runtimePromise = null;
    });
  }
  return runtimePromise;
}

async function executeValidation(request: StudioBg3dGlbWorkerValidateRequest): Promise<void> {
  const controller = activeRequests.get(request.requestId);
  if (!controller || controller.signal.aborted) {
    finishRequest(request.requestId);
    return;
  }

  try {
    // TypeScript deliberately does not assume the async provider callback executes before the
    // validator returns. Keep callback-owned state in a mutable holder so the postflight poison
    // check remains typed without a non-null assertion or an unsafe cast.
    const runtimeState: { current: StudioBg3dKtx2TranscoderRuntime | null } = { current: null };
    const result = await validateStudioBg3dGlb(request.bytes, {
      ...request.options,
      basisRuntimeProvider: async () => {
        const attestedRuntime = await getBasisRuntime(controller.signal);
        runtimeState.current = attestedRuntime;
        return {
          capability: attestedRuntime.capability,
          preflight: async (bytes) => {
            const textureBudget = request.options.budgets[request.options.profile].textures;
            await attestedRuntime.pretranscode(bytes, {
              signal: controller.signal,
              // Apply the stricter profile allocation gate before creating a WASM output buffer.
              maxSourceBytes: textureBudget.maxTotalBytes,
              maxDecodedBytes: textureBudget.maxTotalBytes,
            });
            return true;
          },
        };
      },
    });
    if (
      !result.ok && result.code === "basis-transcode-failed" &&
      runtimeState.current?.metrics.disposed
    ) {
      // A failed Embind cleanup poisons the heap. Make the client terminate this Worker and lazily
      // self-attest a fresh realm instead of accepting more jobs into a potentially leaking module.
      throw new Error("basis-runtime-poisoned");
    }
    if (finishRequest(request.requestId)) return;
    const response: StudioBg3dGlbWorkerResponse = {
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      result,
    };
    if (result.ok) {
      scope.postMessage(response, [result.verifiedBytes.buffer]);
    } else {
      scope.postMessage(response);
    }
  } catch {
    if (finishRequest(request.requestId)) return;
    const response: StudioBg3dGlbWorkerResponse = {
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
    };
    scope.postMessage(response);
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isStudioBg3dGlbWorkerRequest(request)) return;
  if (request.kind === "cancel") {
    activeRequests.get(request.requestId)?.abort();
    return;
  }
  if (activeRequests.has(request.requestId)) return;
  activeRequests.set(request.requestId, new AbortController());
  const execute = () => executeValidation(request);
  requestQueue = requestQueue.then(execute, execute);
});

export {};
