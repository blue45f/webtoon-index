/// <reference lib="webworker" />

import studioMediaPipeVisionModuleLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import studioMediaPipeVisionModuleWasmUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";

import {
  loadStudioMediaPipeVisionModule,
  runStudioMediaPipeVisionTaskCreation,
} from "../studio-mediapipe-vision-init-arbiter";
import { createSha256Portable, sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_VRM_AVATAR_REFERENCE_LIMITS,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_FETCH_TIMEOUT_MS,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  StudioVrmAvatarReferenceError,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceEmbedding,
} from "./studio-vrm-avatar-reference-recommendation";
import {
  isStudioVrmAvatarReferenceWorkerRequest,
  type StudioVrmAvatarReferenceWorkerErrorResponse,
  type StudioVrmAvatarReferenceWorkerRecommendRequest,
  type StudioVrmAvatarReferenceWorkerResponse,
} from "./studio-vrm-avatar-reference-worker-protocol";

import type { ImageEmbedder as MediaPipeImageEmbedder } from "@mediapipe/tasks-vision";

const scope = self as unknown as DedicatedWorkerGlobalScope;

const STUDIO_VRM_AVATAR_REFERENCE_BLOCKED_EGRESS_GLOBALS = Object.freeze([
  "Cache",
  "CacheStorage",
  "EventSource",
  "FontFace",
  "RTCPeerConnection",
  "ServiceWorker",
  "ServiceWorkerContainer",
  "SharedWorker",
  "WebSocket",
  "WebSocketStream",
  "WebTransport",
  "Worker",
  "XMLHttpRequest",
  "caches",
  "fonts",
] as const);

function resolveSameOriginMediaPipeAssetUrl(value: string, label: string): string {
  const workerUrl = new URL(scope.location.href);
  const assetUrl = new URL(value, workerUrl);
  if (
    assetUrl.origin !== workerUrl.origin
    || (assetUrl.protocol !== "http:" && assetUrl.protocol !== "https:")
  ) {
    throw new TypeError(`${label} must resolve to an exact same-origin HTTP asset.`);
  }
  return assetUrl.href;
}

const STUDIO_VRM_AVATAR_REFERENCE_MODULE_FILESET = Object.freeze({
  wasmLoaderPath: resolveSameOriginMediaPipeAssetUrl(
    studioMediaPipeVisionModuleLoaderUrl,
    "MediaPipe module loader",
  ),
  wasmBinaryPath: resolveSameOriginMediaPipeAssetUrl(
    studioMediaPipeVisionModuleWasmUrl,
    "MediaPipe module WASM",
  ),
});

function blockedEgressError(): TypeError {
  return new TypeError("Avatar reference inference blocked an undeclared network channel.");
}

function propertyOwner(target: object, name: PropertyKey): object | null {
  let current: object | null = target;
  while (current) {
    if (Object.prototype.hasOwnProperty.call(current, name)) return current;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return null;
}

function lockEgressProperty(target: object, name: PropertyKey, value: unknown): void {
  const owner = propertyOwner(target, name) ?? target;
  const descriptor = Reflect.getOwnPropertyDescriptor(owner, name);
  if (descriptor && !descriptor.configurable) {
    if ("value" in descriptor && descriptor.value === value && descriptor.writable === false) return;
    throw blockedEgressError();
  }
  if (!Reflect.defineProperty(owner, name, {
    configurable: false,
    enumerable: descriptor?.enumerable ?? false,
    value,
    writable: false,
  })) throw blockedEgressError();
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof Request === "function" && input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof init?.method === "string") return init.method.toUpperCase();
  if (typeof Request === "function" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof Request === "function" && input instanceof Request) return input.signal;
  return undefined;
}

/**
 * Locks the short-lived inference Worker to the three declared network resources it needs:
 * the pinned model and Vite's exact same-origin module-loader/WASM asset URLs. Image pixels never
 * enter a request body. Other browser egress primitives are locked before tasks-vision loads.
 */
function installStudioVrmAvatarReferenceEgressPolicy(): void {
  if (typeof scope.fetch !== "function") throw blockedEgressError();
  const nativeFetch = scope.fetch.bind(scope);
  const modelUrl = new URL(STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL).href;
  const allowedFetchUrls = new Set([
    modelUrl,
    STUDIO_VRM_AVATAR_REFERENCE_MODULE_FILESET.wasmLoaderPath,
    STUDIO_VRM_AVATAR_REFERENCE_MODULE_FILESET.wasmBinaryPath,
  ]);
  const guardedFetch: typeof fetch = async (input, init) => {
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(requestUrl(input), scope.location.href).href;
    } catch {
      throw blockedEgressError();
    }
    if (requestMethod(input, init) !== "GET" || !allowedFetchUrls.has(normalizedUrl)) {
      throw blockedEgressError();
    }
    // Never forward caller-controlled headers, bodies, credentials or referrers. Even a request
    // to an allowed URL is reconstructed from the exact constant and the cancellation signal.
    const response = await nativeFetch(normalizedUrl, {
      cache: normalizedUrl === modelUrl ? "force-cache" : "no-cache",
      credentials: "omit",
      method: "GET",
      mode: normalizedUrl === modelUrl ? "cors" : "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: requestSignal(input, init),
    });
    if (response.redirected || !allowedFetchUrls.has(new URL(response.url).href)) {
      try {
        await response.body?.cancel();
      } catch {
        // The undeclared response is rejected independently of best-effort stream cleanup.
      }
      throw blockedEgressError();
    }
    return response;
  };
  // Patch the actual prototype owner, not only `self`: otherwise third-party code could recover
  // WorkerGlobalScope.prototype.fetch/importScripts and bypass an own-property shadow.
  lockEgressProperty(scope, "fetch", guardedFetch);

  for (const name of STUDIO_VRM_AVATAR_REFERENCE_BLOCKED_EGRESS_GLOBALS) {
    lockEgressProperty(scope, name, undefined);
  }

  const rejectImportScripts = (): never => {
    throw new TypeError("Avatar reference inference requires the pinned module loader.");
  };
  lockEgressProperty(scope, "importScripts", rejectImportScripts);

  const navigatorRecord = scope.navigator as unknown as object;
  if (
    "sendBeacon" in navigatorRecord
  ) lockEgressProperty(navigatorRecord, "sendBeacon", undefined);
  if ("serviceWorker" in navigatorRecord) {
    lockEgressProperty(navigatorRecord, "serviceWorker", undefined);
  }
}

installStudioVrmAvatarReferenceEgressPolicy();

const active = new Map<number, AbortController>();

function postProgress(
  request: StudioVrmAvatarReferenceWorkerRecommendRequest,
  stage: "model" | "embedding" | "ranking",
  progress: number,
): void {
  if (!active.has(request.requestId)) return;
  const response: StudioVrmAvatarReferenceWorkerResponse = {
    version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
    kind: "progress",
    requestId: request.requestId,
    generationId: request.generationId,
    stage,
    progress,
  };
  scope.postMessage(response);
}

function ensureActive(request: StudioVrmAvatarReferenceWorkerRecommendRequest): void {
  if (active.get(request.requestId)?.signal.aborted) {
    throw new StudioVrmAvatarReferenceError("aborted");
  }
}

async function fetchBoundedModel(signal: AbortSignal): Promise<Uint8Array> {
  const requestController = new AbortController();
  let timedOut = false;
  const handleAbort = () => requestController.abort(signal.reason);
  if (signal.aborted) handleAbort();
  else signal.addEventListener("abort", handleAbort, { once: true });
  const timeout = scope.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, STUDIO_VRM_AVATAR_REFERENCE_MODEL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL, {
      cache: "force-cache",
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: requestController.signal,
    });
    if (!response.ok || timedOut) throw new StudioVrmAvatarReferenceError("model-unavailable");
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const declaredLength = Number(contentLengthHeader);
      if (
        !Number.isSafeInteger(declaredLength)
        || declaredLength !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH
        || declaredLength > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxModelBytes
      ) throw new StudioVrmAvatarReferenceError("model-unavailable");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.byteLength !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH
        || bytes.byteLength > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxModelBytes
        || sha256HexPortable(bytes) !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256
      ) throw new StudioVrmAvatarReferenceError("model-unavailable");
      return bytes;
    }
    const chunks: Uint8Array[] = [];
    const hasher = createSha256Portable();
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          throw new StudioVrmAvatarReferenceError("model-unavailable");
        }
        total += chunk.value.byteLength;
        if (
          total > STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH
          || total > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxModelBytes
        ) {
          await reader.cancel();
          throw new StudioVrmAvatarReferenceError("model-unavailable");
        }
        hasher.update(chunk.value);
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (
      total !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH
      || hasher.finalizeHex() !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256
    ) throw new StudioVrmAvatarReferenceError("model-unavailable");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (cause) {
    if (cause instanceof StudioVrmAvatarReferenceError) throw cause;
    if (signal.aborted) throw new StudioVrmAvatarReferenceError("aborted", { cause });
    throw new StudioVrmAvatarReferenceError("model-unavailable", { cause });
  } finally {
    scope.clearTimeout(timeout);
    signal.removeEventListener("abort", handleAbort);
  }
}

async function createImageEmbedder(
  signal: AbortSignal,
): Promise<{
  readonly embedder: MediaPipeImageEmbedder;
  readonly cosineSimilarity: typeof import("@mediapipe/tasks-vision").ImageEmbedder.cosineSimilarity;
}> {
  try {
    const { ImageEmbedder } = await loadStudioMediaPipeVisionModule();
    // The official module loader writes ModuleFactory onto globalThis before its default export
    // settles. tasks-vision reaches it through the module-worker TypeError -> dynamic-import path.
    const modelAssetBuffer = await fetchBoundedModel(signal);
    if (signal.aborted) throw new StudioVrmAvatarReferenceError("aborted");
    const embedder = await runStudioMediaPipeVisionTaskCreation({
      owner: "vrm-avatar-reference-image",
      signal,
      create: () => ImageEmbedder.createFromOptions(
        STUDIO_VRM_AVATAR_REFERENCE_MODULE_FILESET,
        {
          baseOptions: {
            delegate: "CPU",
            modelAssetBuffer,
          },
          runningMode: "IMAGE",
          l2Normalize: false,
          quantize: false,
        },
      ),
    });
    return { embedder, cosineSimilarity: ImageEmbedder.cosineSimilarity };
  } catch (cause) {
    if (cause instanceof StudioVrmAvatarReferenceError) throw cause;
    if (signal.aborted) throw new StudioVrmAvatarReferenceError("aborted", { cause });
    throw new StudioVrmAvatarReferenceError("model-unavailable", { cause });
  }
}

function normalizeQueryEmbedding(value: unknown): StudioVrmAvatarReferenceEmbedding {
  if (typeof value !== "object" || value === null) {
    throw new StudioVrmAvatarReferenceError("protocol");
  }
  const embedding = value as {
    readonly headIndex?: unknown;
    readonly headName?: unknown;
    readonly floatEmbedding?: unknown;
  };
  if (
    typeof embedding.headIndex !== "number"
    || !Number.isSafeInteger(embedding.headIndex)
    || embedding.headIndex < 0
    || typeof embedding.headName !== "string"
    || !Array.isArray(embedding.floatEmbedding)
    || embedding.floatEmbedding.length < 1
    || embedding.floatEmbedding.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxEmbeddingDimensions
    || !embedding.floatEmbedding.every(
      (component) => typeof component === "number" && Number.isFinite(component),
    )
  ) throw new StudioVrmAvatarReferenceError("protocol");
  return {
    headIndex: embedding.headIndex,
    headName: embedding.headName,
    floatEmbedding: embedding.floatEmbedding,
  };
}

function sha256Embedding(embedding: StudioVrmAvatarReferenceEmbedding): string {
  const bytes = new Uint8Array(embedding.floatEmbedding.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  embedding.floatEmbedding.forEach((component, index) => {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, component, true);
  });
  return sha256HexPortable(bytes);
}

function workerErrorCode(error: unknown): StudioVrmAvatarReferenceWorkerErrorResponse["code"] {
  if (error instanceof StudioVrmAvatarReferenceError) {
    if (
      error.code === "model-unavailable"
      || error.code === "protocol"
      || error.code === "unsupported-browser"
    ) return error.code;
  }
  return "inference-failed";
}

async function recommend(request: StudioVrmAvatarReferenceWorkerRecommendRequest): Promise<void> {
  const controller = new AbortController();
  active.set(request.requestId, controller);
  let embedder: MediaPipeImageEmbedder | null = null;
  try {
    postProgress(request, "model", 0.18);
    const runtime = await createImageEmbedder(controller.signal);
    embedder = runtime.embedder;
    ensureActive(request);
    postProgress(request, "embedding", 0.62);
    // MediaPipe's image embedder is synchronous. It runs only in this dedicated Worker so the
    // editor/UI thread remains responsive while the official engine computes the feature vector.
    const query = normalizeQueryEmbedding(embedder.embed(request.bitmap).embeddings[0]);
    ensureActive(request);
    const queryEmbeddingSha256 = sha256Embedding(query);
    ensureActive(request);
    postProgress(request, "ranking", 0.9);
    const receipt = rankStudioVrmAvatarReferenceRecommendations({
      catalogue: request.catalogue,
      queryEmbedding: query,
      queryEmbeddingSha256,
      topK: request.topK,
      cosineSimilarity: runtime.cosineSimilarity,
    });
    ensureActive(request);
    const response: StudioVrmAvatarReferenceWorkerResponse = {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      receipt,
    };
    scope.postMessage(response);
  } catch (error) {
    if (controller.signal.aborted) return;
    const response: StudioVrmAvatarReferenceWorkerResponse = {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: workerErrorCode(error),
    };
    scope.postMessage(response);
  } finally {
    active.delete(request.requestId);
    try {
      embedder?.close();
    } catch {
      // The short-lived Worker is terminated by the client after settlement.
    }
    request.bitmap.close();
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isStudioVrmAvatarReferenceWorkerRequest(request)) return;
  if (request.kind === "cancel") {
    active.get(request.requestId)?.abort();
    return;
  }
  if (active.has(request.requestId)) return;
  void recommend(request);
});

export {};
