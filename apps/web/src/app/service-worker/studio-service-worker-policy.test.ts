import { describe, expect, it } from "vitest";

import { isStudioCrossOriginIsolationPath } from "../studio-cross-origin-isolation";

import {
  STUDIO_SERVICE_WORKER_CACHE_PREFIX,
  STUDIO_SERVICE_WORKER_MESSAGE,
  classifyStudioServiceWorkerRequest,
  isStudioServiceWorkerCachedResponseUsable,
  isStudioServiceWorkerMessage,
  isStudioServiceWorkerResponseCacheable,
  isStudioServiceWorkerWorkerAssetUrl,
  isStudioServiceWorkerIsolatedPath,
  legacyStudioServiceWorkerCacheNames,
  planStudioServiceWorkerCacheTrim,
  staleStudioServiceWorkerCacheNames,
  studioServiceWorkerCacheBucket,
  studioServiceWorkerCacheNames,
  studioServiceWorkerOfflineShellUrl,
  studioServiceWorkerStrategy,
  type StudioServiceWorkerRequestFacts,
} from "./studio-service-worker-policy";

const ORIGIN = "https://www.toonstudio.cloud";

function facts(
  url: string,
  overrides: Partial<StudioServiceWorkerRequestFacts> = {},
): StudioServiceWorkerRequestFacts {
  return {
    url: url.startsWith("http") ? url : `${ORIGIN}${url}`,
    origin: ORIGIN,
    method: "GET",
    ...overrides,
  };
}

describe("isolated path parity", () => {
  it("matches the app's cross-origin-isolation predicate exactly", () => {
    // The worker re-declares this rather than importing the app module (which
    // drags in the unload guard). This test is what keeps the copy honest.
    const paths = [
      "/",
      "/studio",
      "/studio/",
      "/studio/abc",
      "/studiox",
      "/studios",
      "/create/studio",
      "/about",
    ];
    for (const pathname of paths) {
      expect(isStudioServiceWorkerIsolatedPath(pathname)).toBe(
        isStudioCrossOriginIsolationPath(pathname),
      );
    }
  });
});

describe("classifyStudioServiceWorkerRequest", () => {
  it("never routes a mutation", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(classifyStudioServiceWorkerRequest(facts("/assets/a.js", { method })))
        .toBe("passthrough");
    }
  });

  it("never routes a range request", () => {
    expect(
      classifyStudioServiceWorkerRequest(
        facts("/audio/theme.mp3", { rangeHeader: "bytes=0-1023" }),
      ),
    ).toBe("passthrough");
  });

  it("ignores cross-origin traffic", () => {
    expect(
      classifyStudioServiceWorkerRequest(facts("https://fonts.gstatic.com/x.woff2")),
    ).toBe("passthrough");
  });

  it("separates studio navigations from public ones", () => {
    expect(
      classifyStudioServiceWorkerRequest(facts("/studio/work/1", { mode: "navigate" })),
    ).toBe("studio-navigation");
    expect(
      classifyStudioServiceWorkerRequest(facts("/ranking", { mode: "navigate" })),
    ).toBe("navigation");
  });

  it("classifies each asset family", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["/assets/index-abc123.js", "immutable-asset"],
      ["/assets/canvaskit-DB1zH3nD.wasm", "immutable-asset"],
      ["/assets/index-r07BZoLj.css", "immutable-asset"],
      ["/vrm/Vivi.vrm", "static-media"],
      ["/audio/theme.mp3", "static-media"],
      ["/images/hero.png", "static-media"],
      ["/data/catalog.json", "catalog-data"],
      ["/i18n/studio/mainMenu/ko.json", "catalog-data"],
      ["/catalog/avatars-v1.json", "catalog-data"],
      ["/api/cover", "cover-image"],
      ["/api/search", "api"],
      ["/sw.js", "sw-runtime"],
      ["/manifest.webmanifest", "sw-runtime"],
      ["/bootstrap-theme.js", "sw-runtime"],
      ["/robots.txt", "passthrough"],
    ];
    for (const [pathname, expected] of cases) {
      expect(classifyStudioServiceWorkerRequest(facts(pathname))).toBe(expected);
    }
  });

  it("keeps the worker script itself off the cache path", () => {
    // A cached `/sw.js` is the classic way to make a bad worker unrecoverable.
    expect(studioServiceWorkerStrategy("sw-runtime")).toBe("network-only");
    expect(studioServiceWorkerCacheBucket("sw-runtime")).toBeNull();
  });
});

describe("strategy per asset class", () => {
  it("assigns a distinct, defensible strategy to each class", () => {
    expect(studioServiceWorkerStrategy("immutable-asset")).toBe("cache-first");
    expect(studioServiceWorkerStrategy("static-media")).toBe("cache-first");
    expect(studioServiceWorkerStrategy("cover-image")).toBe("cache-first");
    expect(studioServiceWorkerStrategy("catalog-data")).toBe("stale-while-revalidate");
    expect(studioServiceWorkerStrategy("navigation")).toBe("network-first");
    expect(studioServiceWorkerStrategy("studio-navigation")).toBe("network-first");
    expect(studioServiceWorkerStrategy("api")).toBe("network-only");
    expect(studioServiceWorkerStrategy("passthrough")).toBe("network-only");
  });

  it("sends every cacheable class to its own bucket", () => {
    expect(studioServiceWorkerCacheBucket("immutable-asset")).toBe("immutable");
    expect(studioServiceWorkerCacheBucket("static-media")).toBe("media");
    expect(studioServiceWorkerCacheBucket("catalog-data")).toBe("data");
    expect(studioServiceWorkerCacheBucket("cover-image")).toBe("cover");
    expect(studioServiceWorkerCacheBucket("navigation")).toBe("precache");
    expect(studioServiceWorkerCacheBucket("api")).toBeNull();
  });
});

describe("cache naming and invalidation", () => {
  it("scopes the precache to the build and runtime buckets to the contract", () => {
    const a = studioServiceWorkerCacheNames("aaaaaaaaaaaa");
    const b = studioServiceWorkerCacheNames("bbbbbbbbbbbb");
    expect(a.precache).not.toBe(b.precache);
    // Content-hashed URLs are self-invalidating, so a deploy must not throw
    // away still-valid immutable bytes.
    expect(a.immutable).toBe(b.immutable);
    expect(a.media).toBe(b.media);
    for (const name of Object.values(a)) {
      expect(name.startsWith(STUDIO_SERVICE_WORKER_CACHE_PREFIX)).toBe(true);
    }
  });

  it("drops only this app's out-of-date caches", () => {
    const current = studioServiceWorkerCacheNames("aaaaaaaaaaaa");
    const existing = [
      ...Object.values(current),
      `${STUDIO_SERVICE_WORKER_CACHE_PREFIX}precache-v5-oldbuild0000`,
      `${STUDIO_SERVICE_WORKER_CACHE_PREFIX}immutable-v1`,
      "some-other-app-cache",
      "workbox-precache-v2",
    ];
    const stale = staleStudioServiceWorkerCacheNames(existing, "aaaaaaaaaaaa");
    expect(stale).toEqual([
      `${STUDIO_SERVICE_WORKER_CACHE_PREFIX}precache-v5-oldbuild0000`,
      `${STUDIO_SERVICE_WORKER_CACHE_PREFIX}immutable-v1`,
    ]);
    expect(stale).not.toContain("some-other-app-cache");
    expect(stale).not.toContain("workbox-precache-v2");
  });

  it("clears the previous hand-written worker's caches exactly once", () => {
    expect(
      legacyStudioServiceWorkerCacheNames([
        "toonspectrum-pwa-v4",
        "toonspectrum-covers-v1",
        `${STUDIO_SERVICE_WORKER_CACHE_PREFIX}immutable-v5`,
        "unrelated",
      ]),
    ).toEqual(["toonspectrum-pwa-v4", "toonspectrum-covers-v1"]);
  });
});

describe("planStudioServiceWorkerCacheTrim", () => {
  it("evicts the oldest entries only when over the limit", () => {
    expect(planStudioServiceWorkerCacheTrim([1, 2, 3], 5)).toEqual([]);
    expect(planStudioServiceWorkerCacheTrim([1, 2, 3, 4, 5], 5)).toEqual([]);
    expect(planStudioServiceWorkerCacheTrim([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([1, 2]);
  });
});

describe("cached response usability (self-healing CORP guard)", () => {
  const workerUrl = `${ORIGIN}/assets/studio-engine.worker-Ab3_x9.js`;

  it("recognises Vite's studio worker asset naming", () => {
    expect(isStudioServiceWorkerWorkerAssetUrl(workerUrl)).toBe(true);
    expect(
      isStudioServiceWorkerWorkerAssetUrl(`${ORIGIN}/assets/index-abc123.js`),
    ).toBe(false);
  });

  it("treats a worker script cached without CORP as a miss", () => {
    // This is precisely the failure that forced the previous worker's v3 -> v4
    // bump; here it repairs itself instead of needing a constant bumped.
    expect(
      isStudioServiceWorkerCachedResponseUsable({
        routeClass: "immutable-asset",
        url: workerUrl,
        status: 200,
        crossOriginResourcePolicy: null,
      }),
    ).toBe(false);
    expect(
      isStudioServiceWorkerCachedResponseUsable({
        routeClass: "immutable-asset",
        url: workerUrl,
        status: 200,
        crossOriginResourcePolicy: "same-origin",
      }),
    ).toBe(true);
  });

  it("does not demand CORP from ordinary scripts", () => {
    // `vite preview` only attaches CORP to worker-shaped requests, so a broad
    // check here would disable caching outright in the verifier environment.
    expect(
      isStudioServiceWorkerCachedResponseUsable({
        routeClass: "immutable-asset",
        destination: "script",
        url: `${ORIGIN}/assets/index-abc123.js`,
        status: 200,
        crossOriginResourcePolicy: null,
      }),
    ).toBe(true);
  });

  it("rejects an error response that somehow got stored", () => {
    expect(
      isStudioServiceWorkerCachedResponseUsable({
        routeClass: "catalog-data",
        url: `${ORIGIN}/data/home.json`,
        status: 404,
      }),
    ).toBe(false);
  });
});

describe("isStudioServiceWorkerResponseCacheable", () => {
  it("stores only non-opaque successes", () => {
    expect(isStudioServiceWorkerResponseCacheable({ ok: true, status: 200, type: "basic" })).toBe(true);
    expect(isStudioServiceWorkerResponseCacheable({ ok: false, status: 500 })).toBe(false);
    expect(isStudioServiceWorkerResponseCacheable({ ok: true, status: 206 })).toBe(false);
    expect(isStudioServiceWorkerResponseCacheable({ ok: true, status: 200, type: "opaque" })).toBe(false);
  });
});

describe("offline shell selection", () => {
  it("gives studio paths the isolated shell", () => {
    // Falling back to `/` here would hand Studio a document without COOP/COEP,
    // dropping crossOriginIsolated exactly when it cannot reload to recover.
    expect(studioServiceWorkerOfflineShellUrl("/studio")).toBe("/studio");
    expect(studioServiceWorkerOfflineShellUrl("/studio/work/42")).toBe("/studio");
    expect(studioServiceWorkerOfflineShellUrl("/ranking")).toBe("/");
  });
});

describe("message protocol", () => {
  it("accepts only known message types", () => {
    expect(isStudioServiceWorkerMessage({ type: STUDIO_SERVICE_WORKER_MESSAGE.kill })).toBe(true);
    expect(isStudioServiceWorkerMessage({ type: "SKIP_WAITING" })).toBe(false);
    expect(isStudioServiceWorkerMessage(null)).toBe(false);
    expect(isStudioServiceWorkerMessage("kill")).toBe(false);
  });
});
