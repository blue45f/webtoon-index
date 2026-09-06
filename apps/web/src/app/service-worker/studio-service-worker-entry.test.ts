/**
 * Runs the real worker module against in-memory ServiceWorker globals.
 *
 * Replaces `lib/__tests__/sw-runtime-cache.test.ts`, which drove the previous
 * hand-written `public/sw.js` the same way. The pure routing decisions are
 * covered in `studio-service-worker-policy.test.ts` and the end-to-end
 * behaviour in `scripts/verify-studio-service-worker.mts`; what is left for
 * this file is the *wiring* — the handful of properties where a one-line
 * mistake silently breaks every client in the field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://toonspectrum.test";
const BUILD_ID = "testbuild001";

const MANIFEST = {
  buildId: BUILD_ID,
  shellUrls: ["/", "/studio"],
  criticalUrls: ["/assets/index-abc.js", "/assets/index-abc.css"],
  warmUrls: ["/i18n/studio/mainMenu/ko.json"],
};

interface Listener {
  (event: Record<string, unknown>): void;
}

function createCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (target: Request | string): string =>
    new URL(typeof target === "string" ? target : target.url, ORIGIN).href;

  const storeOf = (name: string): Map<string, Response> => {
    const existing = stores.get(name);
    if (existing) return existing;
    const created = new Map<string, Response>();
    stores.set(name, created);
    return created;
  };

  const openCache = (name: string) => {
    const store = storeOf(name);
    return {
      put: async (target: Request | string, response: Response) => {
        store.set(keyOf(target), response);
      },
      add: async (target: Request | string) => {
        const response = await (globalThis.fetch as unknown as (
          input: Request | string,
        ) => Promise<Response>)(target);
        if (!response.ok) throw new Error(`cache.add failed: ${response.status}`);
        store.set(keyOf(target), response);
      },
      addAll: async (targets: Array<Request | string>) => {
        // Real `addAll` is atomic: one rejection discards the whole batch.
        const staged = new Map<string, Response>();
        for (const target of targets) {
          const response = await (globalThis.fetch as unknown as (
            input: Request | string,
          ) => Promise<Response>)(target);
          if (!response.ok) throw new Error(`addAll failed: ${response.status}`);
          staged.set(keyOf(target), response);
        }
        for (const [key, value] of staged) store.set(key, value);
      },
      match: async (target: Request | string) => store.get(keyOf(target))?.clone(),
      keys: async () => [...store.keys()],
      delete: async (target: Request | string) => store.delete(keyOf(target)),
    };
  };

  return {
    api: {
      open: async (name: string) => openCache(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    stores,
    seed(name: string, url: string, response: Response) {
      storeOf(name).set(keyOf(url), response);
    },
    entries(name: string) {
      return [...(stores.get(name)?.keys() ?? [])];
    },
  };
}

function createHarness() {
  const listeners = new Map<string, Listener>();
  const counters = { claim: 0, skipWaiting: 0, unregister: 0, preload: 0 };
  const caches = createCacheStorage();
  const fetchCalls: string[] = [];
  let network: (url: string) => Promise<Response> = async () =>
    new Response("ok", { status: 200 });

  const workerFetch = vi.fn(async (target: Request | string) => {
    const url = typeof target === "string" ? new URL(target, ORIGIN).href : target.url;
    fetchCalls.push(url);
    return network(url);
  });

  const scope = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {
      counters.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        counters.claim += 1;
      },
    },
    registration: {
      unregister: async () => {
        counters.unregister += 1;
        return true;
      },
      navigationPreload: {
        enable: async () => {
          counters.preload += 1;
        },
      },
    },
    location: { origin: ORIGIN },
  };

  // In a real worker a relative URL resolves against the registration scope;
  // Node's `Request` throws on one. Resolve against ORIGIN so the worker code
  // under test can stay written the way it actually ships.
  const ScopedRequest = class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(
        typeof input === "string" ? new URL(input, ORIGIN).href : input,
        init,
      );
    }
  };

  vi.stubGlobal("self", scope);
  vi.stubGlobal("caches", caches.api);
  vi.stubGlobal("fetch", workerFetch);
  vi.stubGlobal("Request", ScopedRequest);
  vi.stubGlobal("__STUDIO_SERVICE_WORKER_MANIFEST__", MANIFEST);

  return {
    listeners,
    counters,
    caches,
    fetchCalls,
    setNetwork(impl: (url: string) => Promise<Response>) {
      network = impl;
    },
    async dispatch(type: string, event: Record<string, unknown> = {}) {
      let waited: Promise<unknown> = Promise.resolve();
      let responded: Promise<Response> | Response | undefined;
      listeners.get(type)?.({
        ...event,
        waitUntil: (value: Promise<unknown>) => {
          waited = value;
        },
        respondWith: (value: Promise<Response> | Response) => {
          responded = value;
        },
      });
      await waited.catch(() => undefined);
      return { response: await Promise.resolve(responded).catch(() => undefined), waited };
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

let harness: Harness;

async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import("./studio-service-worker-entry");
}

/**
 * `mode: "navigate"` cannot be constructed via `new Request()`, so a document
 * request is modelled as the plain shape the worker actually reads.
 */
function navigationEvent(path: string) {
  return {
    request: {
      url: new URL(path, ORIGIN).href,
      method: "GET",
      mode: "navigate",
      destination: "document",
      headers: { get: () => null },
    },
    preloadResponse: Promise.resolve(undefined),
  };
}

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("install", () => {
  it("precaches the critical set plus both shells and never skips waiting", async () => {
    harness.setNetwork(async () => new Response("body", { status: 200 }));
    await loadWorker();
    await harness.dispatch("install");

    const precache = harness.caches.entries(
      `toonspectrum-sw-precache-v5-${BUILD_ID}`,
    );
    expect(precache).toHaveLength(4);
    expect(precache).toContain(`${ORIGIN}/studio`);
    // The single most important line in the file: taking control here would
    // swap code out from under a live editing session.
    expect(harness.counters.skipWaiting).toBe(0);
  });

  it("fails install atomically when a critical URL is missing", async () => {
    harness.setNetwork(async (url) =>
      url.endsWith("index-abc.css")
        ? new Response("gone", { status: 404 })
        : new Response("body", { status: 200 }),
    );
    await loadWorker();

    let rejected = false;
    let captured: Promise<unknown> = Promise.resolve();
    harness.listeners.get("install")?.({
      waitUntil: (value: Promise<unknown>) => {
        captured = value;
      },
    } as never);
    await captured.catch(() => {
      rejected = true;
    });

    // A rejected install means this worker never activates and the previously
    // installed one keeps serving — a broken deploy cannot replace a good cache.
    expect(rejected).toBe(true);
    expect(harness.counters.skipWaiting).toBe(0);
  });
});

describe("activate", () => {
  it("purges stale and legacy caches, keeps foreign ones, and claims clients", async () => {
    harness.caches.seed("toonspectrum-sw-precache-v5-oldbuild0000", "/", new Response("old"));
    harness.caches.seed("toonspectrum-sw-immutable-v5", "/assets/keep.js", new Response("keep"));
    harness.caches.seed("toonspectrum-pwa-v4", "/assets/legacy.js", new Response("legacy"));
    harness.caches.seed("toonspectrum-covers-v1", "/api/cover", new Response("cover"));
    harness.caches.seed("some-other-app", "/x", new Response("theirs"));
    await loadWorker();

    await harness.dispatch("activate");

    const remaining = [...harness.caches.stores.keys()].sort();
    expect(remaining).toEqual(["some-other-app", "toonspectrum-sw-immutable-v5"]);
    expect(harness.counters.claim).toBe(1);
    expect(harness.counters.preload).toBe(1);
  });
});

describe("fetch routing", () => {
  it("leaves mutations and other /api/ routes entirely alone", async () => {
    await loadWorker();
    const post = await harness.dispatch("fetch", {
      request: new Request(`${ORIGIN}/api/works`, { method: "POST" }),
    });
    const search = await harness.dispatch("fetch", {
      request: new Request(`${ORIGIN}/api/search?q=x`),
    });
    expect(post.response).toBeUndefined();
    expect(search.response).toBeUndefined();
    expect(harness.fetchCalls).toEqual([]);
  });

  it("serves hashed assets cache-first without touching the network", async () => {
    harness.caches.seed(
      "toonspectrum-sw-immutable-v5",
      "/assets/index-abc.js",
      new Response("cached bundle"),
    );
    await loadWorker();

    const { response } = await harness.dispatch("fetch", {
      request: new Request(`${ORIGIN}/assets/index-abc.js`),
    });
    expect(await response?.text()).toBe("cached bundle");
    expect(harness.fetchCalls).toEqual([]);
  });

  it("re-fetches a worker asset cached without CORP instead of replaying it", async () => {
    // The self-healing path for the failure that forced the old worker's v4 bump.
    harness.caches.seed(
      "toonspectrum-sw-immutable-v5",
      "/assets/studio-engine.worker-abc123.js",
      new Response("stale worker without CORP"),
    );
    harness.setNetwork(async () =>
      new Response("repaired", {
        status: 200,
        headers: { "cross-origin-resource-policy": "same-origin" },
      }),
    );
    await loadWorker();

    const { response } = await harness.dispatch("fetch", {
      request: new Request(`${ORIGIN}/assets/studio-engine.worker-abc123.js`),
    });
    expect(await response?.text()).toBe("repaired");
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it("falls back to the isolated shell for an offline studio navigation", async () => {
    harness.caches.seed(
      `toonspectrum-sw-precache-v5-${BUILD_ID}`,
      "/studio",
      new Response("<html>isolated studio shell</html>"),
    );
    harness.caches.seed(
      `toonspectrum-sw-precache-v5-${BUILD_ID}`,
      "/",
      new Response("<html>public shell</html>"),
    );
    harness.setNetwork(async () => {
      throw new Error("offline");
    });
    await loadWorker();

    const { response } = await harness.dispatch(
      "fetch",
      navigationEvent("/studio/work/42"),
    );
    // Serving `/` here would hand Studio a document with no COOP/COEP.
    expect(await response?.text()).toBe("<html>isolated studio shell</html>");
  });

  it("falls back to the public shell for a non-studio navigation", async () => {
    harness.caches.seed(
      `toonspectrum-sw-precache-v5-${BUILD_ID}`,
      "/",
      new Response("<html>public shell</html>"),
    );
    harness.setNetwork(async () => {
      throw new Error("offline");
    });
    await loadWorker();

    const { response } = await harness.dispatch("fetch", navigationEvent("/ranking"));
    expect(await response?.text()).toBe("<html>public shell</html>");
  });
});

describe("messages", () => {
  it("skips waiting only on an explicit apply-update", async () => {
    await loadWorker();
    await harness.dispatch("message", { data: { type: "SKIP_WAITING" }, ports: [] });
    expect(harness.counters.skipWaiting).toBe(0);

    await harness.dispatch("message", {
      data: { type: "toonspectrum-sw:apply-update" },
      ports: [],
    });
    expect(harness.counters.skipWaiting).toBe(1);
  });

  it("kill switch purges every owned cache and unregisters", async () => {
    harness.caches.seed("toonspectrum-sw-immutable-v5", "/assets/a.js", new Response("a"));
    harness.caches.seed("toonspectrum-pwa-v4", "/", new Response("legacy"));
    harness.caches.seed("some-other-app", "/x", new Response("theirs"));
    await loadWorker();

    const replies: unknown[] = [];
    await harness.dispatch("message", {
      data: { type: "toonspectrum-sw:kill" },
      ports: [{ postMessage: (value: unknown) => replies.push(value) }],
    });

    expect([...harness.caches.stores.keys()]).toEqual(["some-other-app"]);
    expect(harness.counters.unregister).toBe(1);
    expect(replies).toEqual([{ ok: true }]);
  });
});
