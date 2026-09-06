/// <reference lib="webworker" />
/**
 * ToonSpectrum Service Worker runtime.
 *
 * Compiled to `dist/sw.js` by the `toonspectrum-service-worker` plugin in
 * `vite.config.ts`, which injects `__STUDIO_SERVICE_WORKER_MANIFEST__`. Every
 * routing / versioning decision lives in `studio-service-worker-policy.ts` as a
 * pure function; this file only turns those decisions into Cache API calls.
 *
 * Two safety properties this file must never lose:
 *
 *  - **It never takes control mid-session.** `skipWaiting()` is called only in
 *    response to an explicit `apply-update` message from a page, which the
 *    registration module sends only after the artist clicks. A new deploy can
 *    therefore never swap code (or purge caches) out from under a stroke.
 *  - **It never participates in a write.** Only `GET` is routed; every mutation
 *    goes straight to the network, untouched and unqueued.
 */
import {
  STUDIO_SERVICE_WORKER_MESSAGE,
  STUDIO_SERVICE_WORKER_RUNTIME_LIMITS,
  classifyStudioServiceWorkerRequest,
  isStudioServiceWorkerCachedResponseUsable,
  isStudioServiceWorkerMessage,
  isStudioServiceWorkerResponseCacheable,
  legacyStudioServiceWorkerCacheNames,
  planStudioServiceWorkerCacheTrim,
  staleStudioServiceWorkerCacheNames,
  studioServiceWorkerCacheBucket,
  studioServiceWorkerCacheNames,
  studioServiceWorkerOfflineShellUrl,
  studioServiceWorkerStrategy,
  type StudioServiceWorkerCacheBucket,
  type StudioServiceWorkerRouteClass,
} from "./studio-service-worker-policy";

import type { StudioServiceWorkerManifest } from "./studio-service-worker-precache-plan";

declare const __STUDIO_SERVICE_WORKER_MANIFEST__: StudioServiceWorkerManifest;

const scope = self as unknown as ServiceWorkerGlobalScope;
const manifest = __STUDIO_SERVICE_WORKER_MANIFEST__;
const cacheNames = studioServiceWorkerCacheNames(manifest.buildId);

const RUNTIME_LIMIT_BY_BUCKET: Record<StudioServiceWorkerCacheBucket, number> = {
  // The precache is a fixed, build-sized list; it is replaced wholesale, never trimmed.
  precache: Number.POSITIVE_INFINITY,
  immutable: STUDIO_SERVICE_WORKER_RUNTIME_LIMITS.immutable,
  media: STUDIO_SERVICE_WORKER_RUNTIME_LIMITS.media,
  data: STUDIO_SERVICE_WORKER_RUNTIME_LIMITS.data,
  cover: STUDIO_SERVICE_WORKER_RUNTIME_LIMITS.cover,
};

/** Counting puts keeps `cache.keys()` — an O(entries) call — off the hot path. */
const putsSinceTrim = new Map<StudioServiceWorkerCacheBucket, number>();
const TRIM_INTERVAL = 25;

function cacheNameFor(bucket: StudioServiceWorkerCacheBucket): string {
  return cacheNames[bucket];
}

async function trimBucket(
  cache: Cache,
  bucket: StudioServiceWorkerCacheBucket,
): Promise<void> {
  const limit = RUNTIME_LIMIT_BY_BUCKET[bucket];
  if (!Number.isFinite(limit)) return;
  const pending = (putsSinceTrim.get(bucket) ?? 0) + 1;
  if (pending < TRIM_INTERVAL) {
    putsSinceTrim.set(bucket, pending);
    return;
  }
  putsSinceTrim.set(bucket, 0);
  const keys = await cache.keys();
  const doomed = planStudioServiceWorkerCacheTrim(keys, limit);
  await Promise.all(doomed.map((key) => cache.delete(key)));
}

async function persist(
  bucket: StudioServiceWorkerCacheBucket,
  request: Request,
  response: Response,
): Promise<void> {
  if (!isStudioServiceWorkerResponseCacheable(response)) return;
  try {
    const cache = await caches.open(cacheNameFor(bucket));
    await cache.put(request, response.clone());
    await trimBucket(cache, bucket);
  } catch {
    // A full quota or an evicted bucket must degrade to "no caching", never to
    // a failed response for the page.
  }
}

async function readCached(
  bucket: StudioServiceWorkerCacheBucket,
  request: Request,
  routeClass: StudioServiceWorkerRouteClass,
): Promise<Response | undefined> {
  const cache = await caches.open(cacheNameFor(bucket));
  const cached = await cache.match(request, { ignoreVary: true });
  if (!cached) return undefined;
  const usable = isStudioServiceWorkerCachedResponseUsable({
    routeClass,
    destination: request.destination,
    url: request.url,
    status: cached.status,
    crossOriginResourcePolicy: cached.headers.get(
      "cross-origin-resource-policy",
    ),
  });
  if (usable) return cached;
  // Self-heal: an entry stored under an older response contract is dropped so
  // the next request repopulates it correctly, with no version bump required.
  await cache.delete(request);
  return undefined;
}

async function handleCacheFirst(
  request: Request,
  bucket: StudioServiceWorkerCacheBucket,
  routeClass: StudioServiceWorkerRouteClass,
): Promise<Response> {
  const cached = await readCached(bucket, request, routeClass);
  if (cached) return cached;
  const response = await fetch(request);
  await persist(bucket, request, response);
  return response;
}

async function handleStaleWhileRevalidate(
  event: FetchEvent,
  request: Request,
  bucket: StudioServiceWorkerCacheBucket,
  routeClass: StudioServiceWorkerRouteClass,
): Promise<Response> {
  const cached = await readCached(bucket, request, routeClass);
  const refresh = fetch(request)
    .then(async (response) => {
      await persist(bucket, request, response);
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  throw new Error(`offline and uncached: ${request.url}`);
}

/**
 * Deferred warm-up of the Studio payload.
 *
 * Runs at most once per worker instance, only after a Studio navigation has
 * been observed, and always inside `waitUntil` so it cannot delay the document.
 * A visitor who only browses the catalog never downloads any of it.
 */
let warmUpStarted = false;

async function warmStudioPayload(): Promise<void> {
  if (warmUpStarted) return;
  warmUpStarted = true;
  const queue = [...manifest.warmUrls];
  const worker = async (): Promise<void> => {
    for (;;) {
      const url = queue.shift();
      if (url === undefined) return;
      const request = new Request(url, { credentials: "same-origin" });
      const routeClass = classifyStudioServiceWorkerRequest({
        url: request.url,
        origin: scope.location.origin,
        method: "GET",
        destination: request.destination,
      });
      const bucket = studioServiceWorkerCacheBucket(routeClass);
      if (!bucket || bucket === "precache") continue;
      try {
        if (await readCached(bucket, request, routeClass)) continue;
        await persist(bucket, request, await fetch(request));
      } catch {
        // Best effort by design: a warm-up miss costs a network fetch later,
        // never a failure the artist can see.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function shellRequest(url: string): Request {
  // The origin only attaches COOP/COEP to a request it recognises as an HTML
  // navigation (`isStudioCrossOriginIsolationDocumentRequest`). Without this
  // header the precached `/studio` document would replay un-isolated and the
  // editor would lose `crossOriginIsolated` precisely while offline.
  return new Request(url, {
    credentials: "same-origin",
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
}

async function handleNavigation(
  event: FetchEvent,
  routeClass: StudioServiceWorkerRouteClass,
): Promise<Response> {
  const { request } = event;
  if (routeClass === "studio-navigation") event.waitUntil(warmStudioPayload());

  try {
    const preloaded = (await event.preloadResponse) as Response | undefined;
    const response = preloaded ?? (await fetch(request));
    // Only the two shell URLs are refreshed. Caching every visited deep link
    // would grow the precache without bound and could shadow the isolated
    // `/studio` document with a non-isolated one.
    const pathname = new URL(request.url).pathname;
    if ((manifest.shellUrls as readonly string[]).includes(pathname)) {
      await persist("precache", shellRequest(pathname), response);
    }
    return response;
  } catch {
    const pathname = new URL(request.url).pathname;
    const shellUrl = studioServiceWorkerOfflineShellUrl(pathname);
    const cache = await caches.open(cacheNames.precache);
    const cached =
      (await cache.match(shellUrl, { ignoreVary: true }))
      ?? (await cache.match(shellRequest(shellUrl), { ignoreVary: true }));
    if (cached) return cached;
    throw new Error(`offline with no cached shell for ${pathname}`);
  }
}

scope.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheNames.precache);
      // `addAll` is atomic on purpose: if one critical URL is missing, install
      // rejects, this worker never activates, and the previously installed one
      // keeps serving. A broken deploy cannot replace a working cache.
      await cache.addAll(manifest.criticalUrls.map((url) => new Request(url)));
      await Promise.all(
        manifest.shellUrls.map((url) => cache.add(shellRequest(url))),
      );
    })(),
    // Deliberately no `skipWaiting()` here. See the module docblock.
  );
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await scope.registration.navigationPreload?.enable();
      } catch {
        // Not supported everywhere; network-first still works without it.
      }
      const existing = await caches.keys();
      const doomed = [
        ...staleStudioServiceWorkerCacheNames(existing, manifest.buildId),
        ...legacyStudioServiceWorkerCacheNames(existing),
      ];
      await Promise.all(doomed.map((name) => caches.delete(name)));
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener("fetch", (event) => {
  const { request } = event;
  const routeClass = classifyStudioServiceWorkerRequest({
    url: request.url,
    origin: scope.location.origin,
    method: request.method,
    mode: request.mode,
    destination: request.destination,
    rangeHeader: request.headers.get("range"),
  });
  const strategy = studioServiceWorkerStrategy(routeClass);
  if (strategy === "network-only") return;

  const bucket = studioServiceWorkerCacheBucket(routeClass);
  if (!bucket) return;

  if (strategy === "network-first") {
    event.respondWith(handleNavigation(event, routeClass));
    return;
  }
  if (strategy === "cache-first") {
    event.respondWith(handleCacheFirst(request, bucket, routeClass));
    return;
  }
  event.respondWith(
    handleStaleWhileRevalidate(event, request, bucket, routeClass),
  );
});

/**
 * Kill switch. Purges every cache this app owns and unregisters the worker, so
 * the next navigation is a plain, uncontrolled network load. This is the
 * documented field-recovery path for a bad worker; see
 * `docs/studio-service-worker.md`.
 */
async function killStudioServiceWorker(): Promise<void> {
  const existing = await caches.keys();
  const doomed = [
    ...staleStudioServiceWorkerCacheNames(existing, "__none__"),
    ...legacyStudioServiceWorkerCacheNames(existing),
    ...Object.values(cacheNames),
  ];
  await Promise.all([...new Set(doomed)].map((name) => caches.delete(name)));
  await scope.registration.unregister();
}

async function describeStudioServiceWorker(): Promise<Record<string, unknown>> {
  const entries: Record<string, number> = {};
  for (const [bucket, name] of Object.entries(cacheNames)) {
    try {
      const cache = await caches.open(name);
      entries[bucket] = (await cache.keys()).length;
    } catch {
      entries[bucket] = -1;
    }
  }
  return {
    buildId: manifest.buildId,
    cacheNames,
    entries,
    criticalUrls: manifest.criticalUrls.length,
    warmUrls: manifest.warmUrls.length,
    warmUpStarted,
  };
}

scope.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (!isStudioServiceWorkerMessage(data)) return;
  const reply = (payload: unknown): void => {
    const port = event.ports[0];
    if (port) port.postMessage(payload);
  };

  switch (data.type) {
    case STUDIO_SERVICE_WORKER_MESSAGE.applyUpdate:
      // Only ever reached because an artist clicked "reload" in the update
      // prompt, at which point the page is about to be reloaded anyway.
      void scope.skipWaiting();
      break;
    case STUDIO_SERVICE_WORKER_MESSAGE.kill:
      event.waitUntil(
        killStudioServiceWorker().then(
          () => reply({ ok: true }),
          (error: unknown) => reply({ ok: false, error: String(error) }),
        ),
      );
      break;
    case STUDIO_SERVICE_WORKER_MESSAGE.inspect:
      event.waitUntil(describeStudioServiceWorker().then(reply));
      break;
  }
});
