import {
  getStudioBg3dEnvironmentAsset,
  type StudioBg3dEnvironmentAsset,
} from "./studio-bg3d-environment-catalog";

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;

export type StudioBg3dBundledEnvironmentLoadFailureCode =
  | "unknown-asset"
  | "fetch-unavailable"
  | "request-failed"
  | "unexpected-response"
  | "byte-size-mismatch"
  | "invalid-glb"
  | "aborted";

export class StudioBg3dBundledEnvironmentLoadError extends Error {
  readonly code: StudioBg3dBundledEnvironmentLoadFailureCode;

  constructor(code: StudioBg3dBundledEnvironmentLoadFailureCode) {
    super(`Studio BG3D bundled environment load failed: ${code}.`);
    this.name = "StudioBg3dBundledEnvironmentLoadError";
    this.code = code;
  }
}

export interface StudioBg3dBundledEnvironmentSource {
  readonly asset: StudioBg3dEnvironmentAsset;
  readonly bytes: Uint8Array;
  readonly mimeType: "model/gltf-binary";
}

type EnvironmentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "arrayBuffer">>;

const DEFAULT_MIME = "model/gltf-binary" as const;
const sourcePromiseByAssetId = new Map<string, Promise<StudioBg3dBundledEnvironmentSource>>();

/** Releases deployment bytes after downstream SHA/structure validation succeeds or fails. */
export function releaseStudioBg3dBundledEnvironmentSource(assetId: string): void {
  sourcePromiseByAssetId.delete(assetId);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new StudioBg3dBundledEnvironmentLoadError("aborted");
}

function inspectGlbHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < GLB_HEADER_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC
    && view.getUint32(4, true) === GLB_VERSION
    && view.getUint32(8, true) === bytes.byteLength;
}

async function fetchEnvironmentSource(
  asset: StudioBg3dEnvironmentAsset,
  fetcher: EnvironmentFetch,
): Promise<StudioBg3dBundledEnvironmentSource> {
  let response: Awaited<ReturnType<EnvironmentFetch>>;
  try {
    response = await fetcher(asset.url, {
      cache: "force-cache",
      credentials: "same-origin",
    });
  } catch {
    throw new StudioBg3dBundledEnvironmentLoadError("request-failed");
  }
  if (!response.ok) throw new StudioBg3dBundledEnvironmentLoadError("request-failed");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html") || contentType.includes("application/json")) {
    throw new StudioBg3dBundledEnvironmentLoadError("unexpected-response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength !== asset.byteSize) {
      throw new StudioBg3dBundledEnvironmentLoadError("byte-size-mismatch");
    }
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    throw new StudioBg3dBundledEnvironmentLoadError("request-failed");
  }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== asset.byteSize) {
    throw new StudioBg3dBundledEnvironmentLoadError("byte-size-mismatch");
  }
  const bytes = new Uint8Array(buffer.slice(0));
  if (!inspectGlbHeader(bytes)) {
    throw new StudioBg3dBundledEnvironmentLoadError("invalid-glb");
  }
  return Object.freeze({ asset, bytes, mimeType: DEFAULT_MIME });
}

/**
 * Fetches only deployment bytes. SHA-256, structure, budget, and renderer admission remain owned
 * by the existing BG3D model-library/GLTF runtime. Default requests are coalesced and retryable;
 * every consumer receives a defensive byte copy so it cannot mutate the cached authority.
 */
export async function loadStudioBg3dBundledEnvironmentSource(
  assetId: string,
  options: {
    readonly signal?: AbortSignal;
    readonly fetcher?: EnvironmentFetch;
  } = {},
): Promise<StudioBg3dBundledEnvironmentSource> {
  throwIfAborted(options.signal);
  const asset = getStudioBg3dEnvironmentAsset(assetId);
  if (!asset) throw new StudioBg3dBundledEnvironmentLoadError("unknown-asset");
  const injectedFetcher = options.fetcher;
  const defaultFetch = globalThis.fetch;
  if (!injectedFetcher && typeof defaultFetch !== "function") {
    throw new StudioBg3dBundledEnvironmentLoadError("fetch-unavailable");
  }
  const fetcher: EnvironmentFetch = injectedFetcher
    ?? ((input, init) => defaultFetch.call(globalThis, input, init));
  let pending: Promise<StudioBg3dBundledEnvironmentSource>;
  if (injectedFetcher) {
    pending = fetchEnvironmentSource(asset, fetcher);
  } else {
    const existing = sourcePromiseByAssetId.get(asset.id);
    if (existing) pending = existing;
    else {
      pending = fetchEnvironmentSource(asset, fetcher);
      sourcePromiseByAssetId.set(asset.id, pending);
      void pending.catch(() => {
        if (sourcePromiseByAssetId.get(asset.id) === pending) {
          sourcePromiseByAssetId.delete(asset.id);
        }
      });
    }
  }
  const source = await pending;
  throwIfAborted(options.signal);
  return Object.freeze({
    asset: source.asset,
    bytes: Uint8Array.from(source.bytes),
    mimeType: DEFAULT_MIME,
  });
}
