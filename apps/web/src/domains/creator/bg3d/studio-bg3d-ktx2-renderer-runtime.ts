import * as THREE from "three";

import { loadPinnedStudioBg3dKtx2TranscoderAssets } from "./studio-bg3d-ktx2-transcoder-assets";
import {
  STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST,
  attestStudioBg3dKtx2TranscoderAssets,
} from "./studio-bg3d-ktx2-transcoder-contract";

import type { StudioBg3dKtx2TranscoderAssets } from "./studio-bg3d-ktx2-transcoder-contract";
import type { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const TRANSCODER_RUNTIME_PATH = "toonspectrum-verified-basis/";
const TRANSCODER_JAVASCRIPT_URL =
  `${TRANSCODER_RUNTIME_PATH}${STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.fileName}`;
const TRANSCODER_WASM_URL =
  `${TRANSCODER_RUNTIME_PATH}${STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.fileName}`;

export type StudioBg3dKtx2RendererRuntimeErrorCode =
  | "aborted"
  | "asset-integrity"
  | "environment-unavailable"
  | "renderer-unavailable"
  | "runtime-init";

export class StudioBg3dKtx2RendererRuntimeError extends Error {
  constructor(readonly code: StudioBg3dKtx2RendererRuntimeErrorCode) {
    super(`studio-bg3d-ktx2-renderer:${code}`);
    this.name = "StudioBg3dKtx2RendererRuntimeError";
  }
}

export interface StudioBg3dKtx2RendererRuntimeSignals {
  readonly blobAvailable: boolean;
  readonly cryptoDigestAvailable: boolean;
  readonly fetchAvailable: boolean;
  readonly hardwareConcurrency?: number;
  readonly objectUrlAvailable: boolean;
  readonly wasmAvailable: boolean;
  readonly workerAvailable: boolean;
}

/**
 * Either interactive renderer can drive the transcoder. `KTX2Loader.detectSupport()` branches on
 * `isWebGPURenderer` and reads GPU feature names instead of WebGL extensions, so admitting a WebGPU
 * renderer here is what lets compressed-texture models keep working on the next-generation engine
 * rather than failing the import.
 */
export type StudioBg3dKtx2Renderer =
  | THREE.WebGLRenderer
  | (Pick<THREE.WebGLRenderer, "domElement"> & {
    readonly isWebGPURenderer?: boolean;
    hasFeature(name: string): boolean;
  });

export interface CreateStudioBg3dKtx2RendererRuntimeOptions {
  readonly renderer: StudioBg3dKtx2Renderer;
  readonly signal?: AbortSignal;
  /** Integrity remains mandatory; this seam only replaces transport in deterministic tests. */
  readonly loadAssets?: (
    signal?: AbortSignal,
  ) => Promise<StudioBg3dKtx2TranscoderAssets>;
  readonly signals?: StudioBg3dKtx2RendererRuntimeSignals;
}

export interface StudioBg3dKtx2RendererRuntime {
  readonly loader: KTX2Loader;
  readonly transcoderId: typeof STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.id;
  readonly workerLimit: 1 | 2;
  /** GLTFLoader swallows texture errors, so the product boundary must query this after parsing. */
  hasDecodeFailure(): boolean;
  /** Idempotently terminates decoder workers and revokes KTX2Loader's private worker source. */
  dispose(): void;
}

export function collectStudioBg3dKtx2RendererRuntimeSignals(): StudioBg3dKtx2RendererRuntimeSignals {
  return Object.freeze({
    blobAvailable: typeof Blob === "function",
    cryptoDigestAvailable: typeof globalThis.crypto?.subtle?.digest === "function",
    fetchAvailable: typeof fetch === "function",
    hardwareConcurrency: typeof navigator === "object" ? navigator.hardwareConcurrency : undefined,
    objectUrlAvailable: typeof URL === "function"
      && typeof URL.createObjectURL === "function"
      && typeof URL.revokeObjectURL === "function",
    wasmAvailable: typeof WebAssembly === "object",
    workerAvailable: typeof Worker === "function",
  });
}

export function resolveStudioBg3dKtx2RendererWorkerLimit(
  signals: StudioBg3dKtx2RendererRuntimeSignals,
): 0 | 1 | 2 {
  if (
    !signals.blobAvailable || !signals.cryptoDigestAvailable || !signals.fetchAvailable
    || !signals.objectUrlAvailable || !signals.wasmAvailable || !signals.workerAvailable
  ) return 0;
  const concurrency = signals.hardwareConcurrency;
  return typeof concurrency === "number" && Number.isFinite(concurrency) && concurrency >= 8
    ? 2
    : 1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StudioBg3dKtx2RendererRuntimeError("aborted");
}

/**
 * Admits exactly one initialized Three renderer, checked through the API that backend actually
 * exposes: a live WebGL context with an extension registry, or a WebGPU renderer that can answer
 * feature queries. Anything else — including a renderer claiming both brands — is refused so the
 * transcoder never selects a GPU format the active device cannot sample.
 */
function assertRendererAvailable(renderer: StudioBg3dKtx2Renderer): void {
  const webgl = renderer as THREE.WebGLRenderer & { readonly isWebGLRenderer?: unknown };
  const webgpu = renderer as Extract<StudioBg3dKtx2Renderer, { hasFeature(name: string): boolean }>;
  const isWebgl = webgl?.isWebGLRenderer === true;
  const isWebgpu = webgpu?.isWebGPURenderer === true;
  if (isWebgl === isWebgpu) throw new StudioBg3dKtx2RendererRuntimeError("renderer-unavailable");
  try {
    if (isWebgpu) {
      if (typeof webgpu.hasFeature !== "function") {
        throw new StudioBg3dKtx2RendererRuntimeError("renderer-unavailable");
      }
      // Probe once: an uninitialized WebGPU renderer throws rather than reporting false.
      webgpu.hasFeature("texture-compression-bc");
      return;
    }
    if (typeof webgl.extensions?.has !== "function" || webgl.getContext().isContextLost()) {
      throw new StudioBg3dKtx2RendererRuntimeError("renderer-unavailable");
    }
  } catch (error) {
    if (error instanceof StudioBg3dKtx2RendererRuntimeError) throw error;
    throw new StudioBg3dKtx2RendererRuntimeError("renderer-unavailable");
  }
}

function createAssetObjectUrls(assets: StudioBg3dKtx2TranscoderAssets): {
  readonly javascript: string;
  readonly wasm: string;
  revoke(): void;
} {
  let javascript = "";
  let wasm = "";
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    if (javascript) URL.revokeObjectURL(javascript);
    if (wasm) URL.revokeObjectURL(wasm);
  };
  const ownedBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  };
  try {
    javascript = URL.createObjectURL(new Blob([ownedBuffer(assets.javascript)], {
      type: "text/javascript;charset=utf-8",
    }));
    wasm = URL.createObjectURL(new Blob([ownedBuffer(assets.wasm)], { type: "application/wasm" }));
    return { javascript, wasm, revoke };
  } catch {
    revoke();
    throw new StudioBg3dKtx2RendererRuntimeError("runtime-init");
  }
}

/**
 * Creates a renderer-specific KTX2Loader only after the exact executable assets are attested in
 * this window realm. Validation pretranscode remains in its dedicated Worker; this runtime performs
 * the distinct GPU-format transcode selected from the active renderer's own supported formats.
 */
export async function createStudioBg3dKtx2RendererRuntime(
  options: CreateStudioBg3dKtx2RendererRuntimeOptions,
): Promise<StudioBg3dKtx2RendererRuntime> {
  throwIfAborted(options.signal);
  assertRendererAvailable(options.renderer);
  const signals = options.signals ?? collectStudioBg3dKtx2RendererRuntimeSignals();
  const workerLimit = resolveStudioBg3dKtx2RendererWorkerLimit(signals);
  if (workerLimit === 0) {
    throw new StudioBg3dKtx2RendererRuntimeError("environment-unavailable");
  }

  let Ktx2LoaderConstructor: typeof KTX2Loader;
  try {
    ({ KTX2Loader: Ktx2LoaderConstructor } = await import("three/examples/jsm/loaders/KTX2Loader.js"
    ));
  } catch {
    throw new StudioBg3dKtx2RendererRuntimeError("runtime-init");
  }
  throwIfAborted(options.signal);

  const manager = new THREE.LoadingManager();
  const loader = new Ktx2LoaderConstructor(manager);
  try {
    loader.detectSupport(options.renderer as THREE.WebGLRenderer);
  } catch {
    throw new StudioBg3dKtx2RendererRuntimeError("renderer-unavailable");
  }

  let assets: StudioBg3dKtx2TranscoderAssets;
  try {
    assets = await (options.loadAssets ?? loadPinnedStudioBg3dKtx2TranscoderAssets)(options.signal);
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof StudioBg3dKtx2RendererRuntimeError) throw error;
    throw new StudioBg3dKtx2RendererRuntimeError("runtime-init");
  }
  throwIfAborted(options.signal);
  const capability = await attestStudioBg3dKtx2TranscoderAssets(assets);
  throwIfAborted(options.signal);
  if (!capability) throw new StudioBg3dKtx2RendererRuntimeError("asset-integrity");

  const verifiedAssets = capability.copyVerifiedAssets();
  const urls = createAssetObjectUrls(verifiedAssets);
  let initAttempted = false;
  try {
    manager.setURLModifier((url) => {
      if (url === TRANSCODER_JAVASCRIPT_URL) return urls.javascript;
      if (url === TRANSCODER_WASM_URL) return urls.wasm;
      // Verified GLB images are embedded bufferViews. GLTFLoader exposes each to KTX2Loader as a
      // short-lived blob URL; any network/data/file URL is outside this renderer boundary.
      if (url.startsWith("blob:")) return url;
      throw new StudioBg3dKtx2RendererRuntimeError("runtime-init");
    });
    loader.setTranscoderPath(TRANSCODER_RUNTIME_PATH).setWorkerLimit(workerLimit);
    initAttempted = true;
    await loader.init();
    throwIfAborted(options.signal);
  } catch (error) {
    if (initAttempted) {
      try { loader.dispose(); } catch { /* Preserve the setup failure. */ }
    }
    if (error instanceof StudioBg3dKtx2RendererRuntimeError) throw error;
    throw new StudioBg3dKtx2RendererRuntimeError("runtime-init");
  } finally {
    // KTX2Loader has copied both assets into its private worker source/binary snapshots by now.
    urls.revoke();
  }

  let decodeFailed = false;
  const originalLoad = loader.load.bind(loader);
  loader.load = (
    url: string,
    onLoad: (texture: THREE.CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void => {
    const handleError = (error: unknown) => {
      decodeFailed = true;
      onError?.(error);
    };
    try {
      originalLoad(url, onLoad, onProgress, handleError);
    } catch (error) {
      decodeFailed = true;
      throw error;
    }
  };

  let disposed = false;
  return Object.freeze({
    loader,
    transcoderId: capability.transcoderId,
    workerLimit,
    hasDecodeFailure: () => decodeFailed,
    dispose() {
      if (disposed) return;
      disposed = true;
      loader.dispose();
    },
  });
}
