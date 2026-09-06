/**
 * Service Worker routing / versioning policy.
 *
 * Everything in this module is a pure function over plain data so the cache
 * decisions can be unit tested without a browser, a Cache API, or a running
 * Service Worker. `studio-service-worker-entry.ts` is the only consumer that
 * turns these decisions into real `caches` calls.
 *
 * Design constraints that shaped this file:
 *
 * 1. `/studio` is cross-origin isolated (COOP `same-origin` + COEP
 *    `credentialless`). A cached response is replayed with its stored headers,
 *    so the offline shell for a Studio path must be a response that was
 *    fetched *as an HTML navigation* — otherwise the replayed document is not
 *    isolated and Studio downgrades (or reload-loops) while offline.
 * 2. A stale cache must never be able to serve a broken app. Two independent
 *    mechanisms guard this: a contract version baked into every cache name,
 *    and a per-response usability check that treats a header-incompatible
 *    cached entry as a miss.
 * 3. Nothing here may cost an artist their work, so no policy in this file
 *    ever participates in writes. Only `GET` is cacheable and every mutation
 *    verb is network-only.
 */

/** Shared prefix so the kill-switch can find *every* cache this app owns. */
export const STUDIO_SERVICE_WORKER_CACHE_PREFIX = "toonspectrum-sw-";

/**
 * Bump ONLY when the shape of a cached *response* stops being replayable —
 * for example when the origin starts attaching a header the runtime requires.
 * This is deliberately independent of the build id: content-hashed assets are
 * self-invalidating, so a deploy must not throw away megabytes of still-valid
 * bytes. History: v4 (in the previous hand-written worker) invalidated
 * `/assets/` entries cached before Studio Worker responses carried COEP/CORP.
 */
export const STUDIO_SERVICE_WORKER_CONTRACT_VERSION = 5;

/** Cap per runtime bucket. Cache keys enumerate oldest-first, so trimming the
 * head approximates LRU without storing timestamps alongside every entry. */
export const STUDIO_SERVICE_WORKER_RUNTIME_LIMITS = Object.freeze({
  immutable: 600,
  media: 120,
  data: 80,
  cover: 300,
} as const);

export type StudioServiceWorkerRouteClass =
  /** HTML navigation for a cross-origin-isolated Studio document. */
  | "studio-navigation"
  /** HTML navigation for any other route. */
  | "navigation"
  /** Content-hashed build output under `/assets/` — immutable forever. */
  | "immutable-asset"
  /** Long-lived binaries served from `public/` (VRM models, audio, images). */
  | "static-media"
  /** Snapshot JSON that should be fast but eventually fresh. */
  | "catalog-data"
  /** The capped cover-image proxy. */
  | "cover-image"
  /** Every other API route — freshness beats availability. */
  | "api"
  /** The worker script, manifest and bootstrap shims: never intercept. */
  | "sw-runtime"
  /** Not ours, or not cacheable (non-GET, range request, cross-origin). */
  | "passthrough";

export type StudioServiceWorkerStrategy =
  | "cache-first"
  | "stale-while-revalidate"
  | "network-first"
  | "network-only";

export type StudioServiceWorkerCacheBucket =
  | "precache"
  | "immutable"
  | "media"
  | "data"
  | "cover";

export interface StudioServiceWorkerRequestFacts {
  readonly url: string;
  /** The Service Worker's own origin, used to reject cross-origin traffic. */
  readonly origin: string;
  readonly method: string;
  /** `RequestMode`; only `navigate` is treated as a document request. */
  readonly mode?: string;
  /** `RequestDestination` (`script`, `worker`, `image`, …). */
  readonly destination?: string;
  /** Present on media range requests, which must never be cached. */
  readonly rangeHeader?: string | null;
}

/**
 * Mirrors `isStudioCrossOriginIsolationPath` from
 * `src/app/studio-cross-origin-isolation.ts`. It is re-declared here (and
 * pinned by a parity test) so the Service Worker bundle does not have to pull
 * in that module's Studio unload-guard dependency.
 */
export function isStudioServiceWorkerIsolatedPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

const SW_RUNTIME_PATHS = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/bootstrap-compat.js",
  "/bootstrap-theme.js",
]);

const STATIC_MEDIA_PREFIXES = ["/vrm/", "/audio/", "/images/", "/assets/media/"];
const CATALOG_DATA_PREFIXES = ["/data/", "/i18n/", "/catalog/"];

function parsePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function classifyStudioServiceWorkerRequest(
  facts: StudioServiceWorkerRequestFacts,
): StudioServiceWorkerRouteClass {
  if (facts.method.toUpperCase() !== "GET") return "passthrough";
  // A partial response is only valid for the byte range that was asked for, so
  // storing one would let a later full request be answered with a fragment.
  if (facts.rangeHeader) return "passthrough";

  let parsed: URL;
  try {
    parsed = new URL(facts.url);
  } catch {
    return "passthrough";
  }
  if (parsed.origin !== facts.origin) return "passthrough";

  const { pathname } = parsed;
  if (SW_RUNTIME_PATHS.has(pathname)) return "sw-runtime";

  if (facts.mode === "navigate") {
    return isStudioServiceWorkerIsolatedPath(pathname)
      ? "studio-navigation"
      : "navigation";
  }

  if (pathname.startsWith("/assets/")) return "immutable-asset";
  if (pathname === "/api/cover") return "cover-image";
  if (pathname.startsWith("/api/")) return "api";
  if (STATIC_MEDIA_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return "static-media";
  }
  if (CATALOG_DATA_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return "catalog-data";
  }
  return "passthrough";
}

export function studioServiceWorkerStrategy(
  routeClass: StudioServiceWorkerRouteClass,
): StudioServiceWorkerStrategy {
  switch (routeClass) {
    case "immutable-asset":
    case "static-media":
    case "cover-image":
      // Content-hashed or explicitly `immutable` upstream: the URL *is* the
      // version, so a hit can never be wrong and never needs revalidation.
      return "cache-first";
    case "catalog-data":
      return "stale-while-revalidate";
    case "studio-navigation":
    case "navigation":
      // Network-first is the primary field-recovery mechanism: a fixed deploy
      // reaches a user on their next online navigation without any manual
      // cache surgery.
      return "network-first";
    case "api":
    case "sw-runtime":
    case "passthrough":
      return "network-only";
  }
}

export function studioServiceWorkerCacheBucket(
  routeClass: StudioServiceWorkerRouteClass,
): StudioServiceWorkerCacheBucket | null {
  switch (routeClass) {
    case "studio-navigation":
    case "navigation":
      return "precache";
    case "immutable-asset":
      return "immutable";
    case "static-media":
      return "media";
    case "catalog-data":
      return "data";
    case "cover-image":
      return "cover";
    case "api":
    case "sw-runtime":
    case "passthrough":
      return null;
  }
}

export interface StudioServiceWorkerCacheNames {
  readonly precache: string;
  readonly immutable: string;
  readonly media: string;
  readonly data: string;
  readonly cover: string;
}

/**
 * `precache` is build-scoped so each deploy installs into a fresh bucket and
 * the previous shell stays intact until the new worker actually activates.
 * Runtime buckets are contract-scoped so content-hashed bytes survive deploys.
 */
export function studioServiceWorkerCacheNames(
  buildId: string,
): StudioServiceWorkerCacheNames {
  const version = STUDIO_SERVICE_WORKER_CONTRACT_VERSION;
  const prefix = STUDIO_SERVICE_WORKER_CACHE_PREFIX;
  return {
    precache: `${prefix}precache-v${version}-${buildId}`,
    immutable: `${prefix}immutable-v${version}`,
    media: `${prefix}media-v${version}`,
    data: `${prefix}data-v${version}`,
    cover: `${prefix}cover-v${version}`,
  };
}

/**
 * Every cache this app owns that is not part of the current contract/build.
 * Caches belonging to *other* applications on the same origin are never
 * touched — the prefix check is what makes this safe to run on activate.
 */
export function staleStudioServiceWorkerCacheNames(
  existingCacheNames: readonly string[],
  buildId: string,
): string[] {
  const current = new Set<string>(
    Object.values(studioServiceWorkerCacheNames(buildId)),
  );
  return existingCacheNames.filter(
    (name) =>
      name.startsWith(STUDIO_SERVICE_WORKER_CACHE_PREFIX) && !current.has(name),
  );
}

/**
 * Legacy caches from the previous hand-written worker (`toonspectrum-pwa-v*`,
 * `toonspectrum-covers-v*`). Cleared once on activate so an upgrading client
 * does not carry forward entries stored under the old, unversioned contract.
 */
export function legacyStudioServiceWorkerCacheNames(
  existingCacheNames: readonly string[],
): string[] {
  return existingCacheNames.filter(
    (name) =>
      !name.startsWith(STUDIO_SERVICE_WORKER_CACHE_PREFIX)
      && (name.startsWith("toonspectrum-pwa-")
        || name.startsWith("toonspectrum-covers-")),
  );
}

/** Cache keys enumerate in insertion order, so the excess head is the oldest. */
export function planStudioServiceWorkerCacheTrim<Key>(
  keys: readonly Key[],
  limit: number,
): Key[] {
  const excess = keys.length - limit;
  return excess > 0 ? keys.slice(0, excess) : [];
}

export interface StudioServiceWorkerCachedResponseFacts {
  readonly routeClass: StudioServiceWorkerRouteClass;
  readonly destination?: string;
  readonly url: string;
  readonly status: number;
  readonly crossOriginResourcePolicy?: string | null;
}

/**
 * Vite emits Studio's module Workers as `assets/studio-*.worker-<hash>.js`.
 * Recognising that naming contract lets the usability check below cover a
 * cached worker script even when the replayed request lost its
 * `Sec-Fetch-Dest: worker` metadata.
 */
export function isStudioServiceWorkerWorkerAssetUrl(url: string): boolean {
  const pathname = parsePathname(url);
  if (pathname === null) return false;
  return /(?:^|\/)assets\/studio-[^/]+\.worker-[A-Za-z0-9_-]+\.js$/.test(
    pathname,
  );
}

/**
 * Self-healing guard against the exact failure that forced the previous
 * worker's v3 → v4 bump: a Studio module Worker cached *before* the origin
 * started attaching `Cross-Origin-Resource-Policy` cannot be loaded by a
 * cross-origin-isolated document, and replaying it would hard-fail the editor
 * before its first statement runs. Treating such an entry as a miss repairs
 * the cache in place instead of requiring a human to bump a constant.
 *
 * The check is intentionally narrow. Applying it to every script would defeat
 * caching under `vite preview`, whose middleware only attaches CORP to
 * worker-shaped requests.
 */
export function isStudioServiceWorkerCachedResponseUsable(
  facts: StudioServiceWorkerCachedResponseFacts,
): boolean {
  if (facts.status < 200 || facts.status >= 400) return false;
  const isWorkerScript =
    facts.destination === "worker"
    || facts.destination === "sharedworker"
    || isStudioServiceWorkerWorkerAssetUrl(facts.url);
  if (!isWorkerScript) return true;
  return Boolean(facts.crossOriginResourcePolicy);
}

/** Only a real, non-opaque success is worth persisting. */
export function isStudioServiceWorkerResponseCacheable(response: {
  readonly ok: boolean;
  readonly status: number;
  readonly type?: string;
}): boolean {
  if (!response.ok) return false;
  // 206 never reaches here (range requests are `passthrough`), but an origin
  // that answers 206 to a plain GET must still not poison the cache.
  if (response.status === 206) return false;
  return response.type !== "opaque" && response.type !== "opaqueredirect";
}

/**
 * Which precached shell answers an offline navigation. Studio paths must get
 * the isolated document or the editor loses `crossOriginIsolated` (and with it
 * SharedArrayBuffer) exactly when it cannot reload to recover.
 */
export const STUDIO_SERVICE_WORKER_SHELL_URLS = Object.freeze({
  public: "/",
  studio: "/studio",
} as const);

export function studioServiceWorkerOfflineShellUrl(pathname: string): string {
  return isStudioServiceWorkerIsolatedPath(pathname)
    ? STUDIO_SERVICE_WORKER_SHELL_URLS.studio
    : STUDIO_SERVICE_WORKER_SHELL_URLS.public;
}

export const STUDIO_SERVICE_WORKER_MESSAGE = Object.freeze({
  /** Page → waiting worker: the artist accepted the update. */
  applyUpdate: "toonspectrum-sw:apply-update",
  /** Page → active worker: purge everything and stand down. */
  kill: "toonspectrum-sw:kill",
  /** Page → active worker: report what is installed (verifier + DevTools). */
  inspect: "toonspectrum-sw:inspect",
} as const);

export type StudioServiceWorkerMessageType =
  (typeof STUDIO_SERVICE_WORKER_MESSAGE)[keyof typeof STUDIO_SERVICE_WORKER_MESSAGE];

export function isStudioServiceWorkerMessage(
  value: unknown,
): value is { readonly type: StudioServiceWorkerMessageType } {
  if (value === null || typeof value !== "object") return false;
  const { type } = value as { type?: unknown };
  return (
    typeof type === "string"
    && (Object.values(STUDIO_SERVICE_WORKER_MESSAGE) as string[]).includes(type)
  );
}
