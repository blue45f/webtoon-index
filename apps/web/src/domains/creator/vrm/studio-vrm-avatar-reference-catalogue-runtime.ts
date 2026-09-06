import { createSha256Portable } from "../studio-sha256";

import {
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH,
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES,
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
  admitStudioVrmAvatarReferenceCatalogueEnvelope,
  type StudioVrmAvatarReferenceCatalogueEnvelope,
} from "./studio-vrm-avatar-reference-product";

import type { StudioVrmAvatarReferenceCatalogue } from "./studio-vrm-avatar-reference-recommendation";

export const STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_FETCH_TIMEOUT_MS = 15_000;

export type StudioVrmAvatarReferenceCatalogueLoadStatus = "ready" | "unavailable";

export type StudioVrmAvatarReferenceCatalogueDiagnosticCode =
  | "ready"
  | "aborted"
  | "fetch-unavailable"
  | "network"
  | "http"
  | "redirect"
  | "too-large"
  | "byte-length"
  | "digest"
  | "utf8"
  | "json"
  | "admission"
  | "timeout";

export interface StudioVrmAvatarReferenceCatalogueDiagnostic {
  readonly code: StudioVrmAvatarReferenceCatalogueDiagnosticCode;
  readonly url: typeof STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly httpStatus?: number;
}

export interface StudioVrmAvatarReferenceCatalogueReadyResult {
  readonly status: "ready";
  readonly envelope: StudioVrmAvatarReferenceCatalogueEnvelope;
  readonly catalogue: StudioVrmAvatarReferenceCatalogue;
  readonly catalogueRevision: string;
  readonly diagnostic: StudioVrmAvatarReferenceCatalogueDiagnostic & { readonly code: "ready" };
}

export interface StudioVrmAvatarReferenceCatalogueUnavailableResult {
  readonly status: "unavailable";
  readonly envelope: null;
  readonly catalogue: null;
  readonly catalogueRevision: null;
  readonly diagnostic: StudioVrmAvatarReferenceCatalogueDiagnostic & {
    readonly code: Exclude<StudioVrmAvatarReferenceCatalogueDiagnosticCode, "ready">;
  };
}

export type StudioVrmAvatarReferenceCatalogueLoadResult =
  | StudioVrmAvatarReferenceCatalogueReadyResult
  | StudioVrmAvatarReferenceCatalogueUnavailableResult;

export interface StudioVrmAvatarReferenceCatalogueLoadOptions {
  readonly signal?: AbortSignal;
  /** Host/test seam. Product callers use the browser Fetch API. */
  readonly fetchImpl?: typeof fetch;
  /** Host/test seam, clamped to a bounded production-safe interval. */
  readonly timeoutMs?: number;
}

interface SharedLoad {
  readonly generation: number;
  readonly promise: Promise<StudioVrmAvatarReferenceCatalogueLoadResult>;
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SAFE_SAME_ORIGIN_PATH = /^\/(?!\/)[^?#]*$/u;

let cacheGeneration = 0;
let sharedLoad: SharedLoad | null = null;
let readyCache: StudioVrmAvatarReferenceCatalogueReadyResult | null = null;

function diagnostic(
  code: StudioVrmAvatarReferenceCatalogueDiagnosticCode,
  httpStatus?: number,
): StudioVrmAvatarReferenceCatalogueDiagnostic {
  return Object.freeze({
    code,
    url: STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
    expectedByteLength: STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH,
    expectedSha256: STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
}

function unavailable(
  code: Exclude<StudioVrmAvatarReferenceCatalogueDiagnosticCode, "ready">,
  httpStatus?: number,
): StudioVrmAvatarReferenceCatalogueUnavailableResult {
  return Object.freeze({
    status: "unavailable",
    envelope: null,
    catalogue: null,
    catalogueRevision: null,
    diagnostic: diagnostic(code, httpStatus) as StudioVrmAvatarReferenceCatalogueUnavailableResult["diagnostic"],
  });
}

function ready(
  envelope: StudioVrmAvatarReferenceCatalogueEnvelope,
): StudioVrmAvatarReferenceCatalogueReadyResult {
  return Object.freeze({
    status: "ready",
    envelope,
    catalogue: envelope.catalogue,
    catalogueRevision: envelope.catalogue.catalogueRevision,
    diagnostic: diagnostic("ready") as StudioVrmAvatarReferenceCatalogueReadyResult["diagnostic"],
  });
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_FETCH_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(60_000, Math.floor(timeoutMs)));
}

function responseMatchesRequestedAsset(response: Response): boolean {
  if (response.redirected) return false;
  if (!response.url || typeof globalThis.location === "undefined") return true;
  try {
    const requested = new URL(
      STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
      globalThis.location.href,
    );
    const received = new URL(response.url, globalThis.location.href);
    return received.origin === requested.origin
      && received.pathname === requested.pathname
      && received.search === requested.search
      && received.hash === "";
  } catch {
    return false;
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The result has already failed closed; stream cancellation is best-effort cleanup.
  }
}

async function loadCore(
  options: StudioVrmAvatarReferenceCatalogueLoadOptions,
): Promise<StudioVrmAvatarReferenceCatalogueLoadResult> {
  const expectedByteLength = STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH;
  const expectedSha256 = STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256;
  if (
    expectedByteLength < 1
    || expectedByteLength > STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES
    || !/^[0-9a-f]{64}$/u.test(expectedSha256)
    || !SAFE_SAME_ORIGIN_PATH.test(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL)
  ) return unavailable("admission");

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return unavailable("fetch-unavailable");

  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeout(options.timeoutMs));

  try {
    let response: Response;
    try {
      response = await fetchImpl(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL, {
        cache: "no-cache",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch {
      return unavailable(timedOut ? "timeout" : "network");
    }

    if (!responseMatchesRequestedAsset(response)) return unavailable("redirect");
    if (!response.ok) return unavailable("http", response.status);

    const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!contentEncoding || contentEncoding === "identity")) {
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
        return unavailable("byte-length");
      }
      if (declaredLength > STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES) {
        return unavailable("too-large");
      }
      if (declaredLength !== expectedByteLength) return unavailable("byte-length");
    }

    const reader = response.body?.getReader();
    if (!reader) return unavailable("network");
    const chunks: Uint8Array[] = [];
    const hasher = createSha256Portable();
    let total = 0;
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          return unavailable(timedOut ? "timeout" : "network");
        }
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          await cancelReader(reader);
          return unavailable("network");
        }
        const nextTotal = total + chunk.value.byteLength;
        if (!Number.isSafeInteger(nextTotal) || nextTotal > STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_MAX_BYTES) {
          await cancelReader(reader);
          return unavailable("too-large");
        }
        if (nextTotal > expectedByteLength) {
          await cancelReader(reader);
          return unavailable("byte-length");
        }
        total = nextTotal;
        hasher.update(chunk.value);
        chunks.push(chunk.value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A cancelled or failed reader can already have released its lock.
      }
    }

    if (timedOut) return unavailable("timeout");
    if (total !== expectedByteLength) return unavailable("byte-length");
    if (hasher.finalizeHex() !== expectedSha256) return unavailable("digest");

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let source: string;
    try {
      source = UTF8_DECODER.decode(bytes);
    } catch {
      return unavailable("utf8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return unavailable("json");
    }
    let envelope: StudioVrmAvatarReferenceCatalogueEnvelope | null;
    try {
      envelope = admitStudioVrmAvatarReferenceCatalogueEnvelope(parsed);
    } catch {
      return unavailable("admission");
    }
    return envelope ? ready(envelope) : unavailable("admission");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function sharedCore(
  options: StudioVrmAvatarReferenceCatalogueLoadOptions,
): Promise<StudioVrmAvatarReferenceCatalogueLoadResult> {
  if (readyCache) return Promise.resolve(readyCache);
  if (sharedLoad) return sharedLoad.promise;

  const generation = cacheGeneration;
  const promise = loadCore(options).then((result) => {
    if (generation === cacheGeneration && result.status === "ready") readyCache = result;
    return result;
  }).catch(() => unavailable("network")).finally(() => {
    if (sharedLoad?.generation === generation) sharedLoad = null;
  });
  sharedLoad = { generation, promise };
  return promise;
}

function isolateCallerAbort(
  core: Promise<StudioVrmAvatarReferenceCatalogueLoadResult>,
  signal: AbortSignal | undefined,
): Promise<StudioVrmAvatarReferenceCatalogueLoadResult> {
  if (!signal) return core;
  if (signal.aborted) return Promise.resolve(unavailable("aborted"));
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: StudioVrmAvatarReferenceCatalogueLoadResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => settle(unavailable("aborted"));
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    void core.then(settle);
  });
}

/**
 * Lazily loads the immutable same-origin reference catalogue.
 *
 * Concurrent callers share one integrity-checked core request. A caller's AbortSignal races only
 * that caller's result and never aborts or invalidates the shared request. Successful admission is
 * cached; unavailable results are not, so calling this function again is a safe product retry.
 */
export function loadStudioVrmAvatarReferenceCatalogue(
  options: StudioVrmAvatarReferenceCatalogueLoadOptions = {},
): Promise<StudioVrmAvatarReferenceCatalogueLoadResult> {
  if (options.signal?.aborted) return Promise.resolve(unavailable("aborted"));
  return isolateCallerAbort(sharedCore(options), options.signal);
}

/** Test-only cache seam. An already running request is fenced by a new generation. */
export function resetStudioVrmAvatarReferenceCatalogueCacheForTests(): void {
  cacheGeneration += 1;
  sharedLoad = null;
  readyCache = null;
}
