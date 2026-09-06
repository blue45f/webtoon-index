import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_CROSS_ORIGIN_ISOLATION_HEADERS,
  STUDIO_CROSS_ORIGIN_ISOLATION_WORKER_HEADERS,
  STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY,
  STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY,
  diagnoseStudioCrossOriginIsolation,
  isStudioCrossOriginIsolationDocumentRequest,
  isStudioCrossOriginIsolationPath,
  isStudioCrossOriginIsolationWorkerRequest,
  publishStudioCrossOriginIsolationDiagnostic,
  requestStudioCrossOriginIsolationReload,
} from "./studio-cross-origin-isolation";

function sessionStorageFixture() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("Studio cross-origin isolation headers", () => {
  it("uses the isolated document contract without weakening the public-site popup policy", () => {
    expect(STUDIO_CROSS_ORIGIN_ISOLATION_HEADERS).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Permissions-Policy":
        "camera=(self), microphone=(), geolocation=(), cross-origin-isolated=(self)",
    });
    expect(STUDIO_CROSS_ORIGIN_ISOLATION_WORKER_HEADERS).toEqual({
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
  });

  it.each(["/studio", "/studio/", "/studio/tools-companion", "/studio/work/episode-1"])(
    "admits the Studio path %s",
    (pathname) => {
      expect(isStudioCrossOriginIsolationPath(pathname)).toBe(true);
    },
  );

  it.each(["/", "/create", "/studio-guide", "/studios"])(
    "does not isolate the public path %s",
    (pathname) => {
      expect(isStudioCrossOriginIsolationPath(pathname)).toBe(false);
    },
  );

  it("applies headers only to Studio document navigations", () => {
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio?room=abc",
      method: "GET",
      accept: "text/html,application/xhtml+xml",
      secFetchDest: "document",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio/tools-companion",
      method: "HEAD",
      accept: "*/*",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio/tools-companion",
      method: "GET",
      accept: "text/html,application/xhtml+xml",
      secFetchDest: "empty",
    })).toBe(true);

    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio",
      method: "POST",
      accept: "text/html",
    })).toBe(false);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio/thumbnail.png",
      method: "GET",
      accept: "image/png",
      secFetchDest: "image",
    })).toBe(false);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio/chunk.js",
      method: "GET",
      accept: "*/*",
      secFetchDest: "script",
    })).toBe(false);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/studio-live/socket",
      method: "GET",
      accept: "*/*",
    })).toBe(false);
    expect(isStudioCrossOriginIsolationDocumentRequest({
      url: "/create",
      method: "GET",
      accept: "text/html",
    })).toBe(false);
  });

  it("opts dedicated Worker responses into COEP without classifying scripts as workers", () => {
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/src/domains/creator/studio-procedural-artistic-brush.worker.ts",
      method: "GET",
      accept: "*/*",
      secFetchDest: "worker",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/src/domains/creator/brush/studio-paper-vector-refinement.worker.ts",
      method: "GET",
      accept: "*/*",
      secFetchDest: "empty",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/src/domains/creator/brush/studio-paper-vector-refinement.worker.ts",
      method: "GET",
      accept: "*/*",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/studio-procedural-artistic-brush.worker-abc.js",
      method: "HEAD",
      accept: "*/*",
      secFetchDest: "worker",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/studio-paper-vector-refinement.worker-Pqo-P6hQ.js",
      method: "GET",
      accept: "*/*",
      secFetchDest: "empty",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/studio-paper-vector-refinement.worker-Pqo-P6hQ.js",
      method: "GET",
      accept: "*/*",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/studio-paper-vector-refinement.worker-Pqo-P6hQ.js?cache=immutable",
      method: "HEAD",
      accept: "text/javascript,*/*;q=0.8",
      secFetchDest: "script",
    })).toBe(true);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/StudioPage.js",
      method: "GET",
      accept: "*/*",
      secFetchDest: "script",
    })).toBe(false);
    expect(isStudioCrossOriginIsolationWorkerRequest({
      url: "/assets/studio.worker.js",
      method: "POST",
      accept: "*/*",
      secFetchDest: "worker",
    })).toBe(false);
  });

  it.each(["document", "iframe"])(
    "keeps a direct hashed Worker asset %s navigation outside Worker policy",
    (secFetchDest) => {
      expect(isStudioCrossOriginIsolationWorkerRequest({
        url: "/assets/studio-paper-vector-refinement.worker-Pqo-P6hQ.js",
        method: "GET",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        secFetchDest,
      })).toBe(false);
    },
  );
});

describe("Studio SPA isolation entry guard", () => {
  it("enables high-performance mode only when the document is actually isolated", () => {
    expect(diagnoseStudioCrossOriginIsolation("/studio", true, null)).toEqual({
      status: "enabled",
      highPerformanceMode: true,
      crossOriginIsolated: true,
      reloadAttempted: false,
    });
    expect(diagnoseStudioCrossOriginIsolation("/", true, null)).toEqual({
      status: "public-reload-required",
      highPerformanceMode: false,
      crossOriginIsolated: true,
      reloadAttempted: false,
    });
  });

  it("requests one reload, preserves router history state, and reuses the marker", () => {
    const reload = vi.fn();
    const sessionStorage = sessionStorageFixture();
    const history = {
      state: { usr: { from: "/create" }, key: "route-key", idx: 2 },
      replaceState(next: unknown) {
        this.state = next as typeof this.state;
      },
    };

    const first = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/studio", reload },
      sessionStorage,
    });
    expect(first).toEqual({
      diagnostic: {
        status: "reload-requested",
        highPerformanceMode: false,
        crossOriginIsolated: false,
        reloadAttempted: true,
      },
      reloadRequested: true,
    });
    expect(history.state).toMatchObject({
      usr: { from: "/create" },
      key: "route-key",
      idx: 2,
      [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "studio-entry",
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY))
      .toBe("studio-entry");

    // BrowserRouter can replace unknown history.state keys during startup. The
    // tab-scoped session marker remains authoritative and prevents a loop.
    history.state = { usr: { from: "/create" }, key: "replacement", idx: 0 };
    const second = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/studio", reload },
      sessionStorage,
    });
    expect(second.diagnostic.status).toBe("unavailable-after-reload");
    expect(second.diagnostic.highPerformanceMode).toBe(false);
    expect(second.reloadRequested).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when the durable loop guard cannot be installed", () => {
    const reload = vi.fn();
    const result = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history: {
        state: null,
        replaceState() {
          throw new Error("history is blocked");
        },
      },
      location: { href: "https://example.test/studio", reload },
      sessionStorage: sessionStorageFixture(),
    });
    expect(result.diagnostic.status).toBe("reload-guard-unavailable");
    expect(result.diagnostic.highPerformanceMode).toBe(false);
    expect(result.reloadRequested).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("fails open with a false diagnostic when reload itself throws", () => {
    const sessionStorage = sessionStorageFixture();
    const history = {
      state: null as unknown,
      replaceState(next: unknown) {
        this.state = next;
      },
    };
    const result = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: {
        href: "https://example.test/studio",
        reload() {
          throw new Error("reload blocked");
        },
      },
      sessionStorage,
    });
    expect(result.diagnostic.status).toBe("reload-failed");
    expect(result.diagnostic.highPerformanceMode).toBe(false);
    expect(result.reloadRequested).toBe(false);
    expect(history.state).toMatchObject({
      [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "studio-entry",
    });
    expect(sessionStorage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY))
      .toBe("studio-entry");
  });

  it("skips reload when sessionStorage cannot provide a durable loop guard", () => {
    const reload = vi.fn();
    const result = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history: {
        state: null,
        replaceState: vi.fn(),
      },
      location: { href: "https://example.test/studio", reload },
      sessionStorage: {
        getItem() {
          return null;
        },
        setItem() {
          throw new Error("blocked");
        },
        removeItem() {},
      },
    });
    expect(result.diagnostic.status).toBe("reload-guard-unavailable");
    expect(result.reloadRequested).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears a stale tab guard after isolation succeeds or the user leaves Studio", () => {
    const storage = sessionStorageFixture();
    storage.setItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY, "studio-entry");
    const globals = {
      crossOriginIsolated: true,
      history: { state: null, replaceState() {} },
      location: { href: "https://example.test/studio", reload() {} },
      sessionStorage: storage,
    };

    expect(requestStudioCrossOriginIsolationReload("/studio", globals).diagnostic.status)
      .toBe("enabled");
    expect(storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY)).toBeNull();

    storage.setItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY, "public-exit");
    expect(requestStudioCrossOriginIsolationReload("/", {
      ...globals,
      crossOriginIsolated: false,
    }).diagnostic.status).toBe("not-studio");
    expect(storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY)).toBeNull();
  });

  it("reloads once when an isolated SPA leaves Studio so public OAuth keeps normal opener behavior", () => {
    const storage = sessionStorageFixture();
    const reload = vi.fn();
    const history = {
      state: { usr: null, key: "public-route", idx: 4 } as unknown,
      replaceState(next: unknown) {
        this.state = next;
      },
    };
    const first = requestStudioCrossOriginIsolationReload("/create", {
      crossOriginIsolated: true,
      history,
      location: { href: "https://example.test/create", reload },
      sessionStorage: storage,
    });
    expect(first.diagnostic.status).toBe("public-reload-requested");
    expect(first.reloadRequested).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY))
      .toBe("public-exit");

    // If a host accidentally keeps public documents isolated, the session guard
    // fails open instead of looping.
    history.state = { idx: 0 };
    const second = requestStudioCrossOriginIsolationReload("/create", {
      crossOriginIsolated: true,
      history,
      location: { href: "https://example.test/create", reload },
      sessionStorage: storage,
    });
    expect(second.diagnostic.status).toBe("public-still-isolated");
    expect(second.reloadRequested).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads a COOP-only Studio document once when an SPA transition leaves Studio", () => {
    const storage = sessionStorageFixture();
    storage.setItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY, "studio-entry");
    const reload = vi.fn();
    const history = {
      state: {
        usr: null,
        key: "coop-only-studio",
        idx: 3,
        [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "studio-entry",
      } as unknown,
      replaceState(next: unknown) {
        this.state = next;
      },
    };
    const context = { documentWasStudio: true };

    const first = requestStudioCrossOriginIsolationReload("/create", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/create", reload },
      sessionStorage: storage,
    }, context);
    expect(first).toEqual({
      diagnostic: {
        status: "public-reload-requested",
        highPerformanceMode: false,
        crossOriginIsolated: false,
        reloadAttempted: true,
      },
      reloadRequested: true,
    });
    expect(history.state).toMatchObject({
      usr: null,
      key: "coop-only-studio",
      idx: 3,
      [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "public-exit",
    });
    expect(storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY))
      .toBe("public-exit");

    const replay = requestStudioCrossOriginIsolationReload("/create", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/create", reload },
      sessionStorage: storage,
    }, context);
    expect(replay.diagnostic.status).toBe("public-reload-attempted");
    expect(replay.diagnostic.reloadAttempted).toBe(true);
    expect(replay.reloadRequested).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps Studio entry reloads working after a completed public-exit reload", () => {
    const storage = sessionStorageFixture();
    storage.setItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY, "public-exit");
    const reload = vi.fn();
    const history = {
      state: {
        [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "public-exit",
      } as unknown,
      replaceState(next: unknown) {
        this.state = next;
      },
    };
    const publicDocument = { documentWasStudio: false };

    const entry = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/studio", reload },
      sessionStorage: storage,
    }, publicDocument);
    expect(entry.diagnostic.status).toBe("reload-requested");
    expect(entry.reloadRequested).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(history.state).toMatchObject({
      [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: "studio-entry",
    });
    expect(storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY))
      .toBe("studio-entry");

    // An effect replay in the same public document does not request a second
    // reload while the first navigation is committing.
    const replay = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/studio", reload },
      sessionStorage: storage,
    }, publicDocument);
    expect(replay.diagnostic.status).toBe("reload-requested");
    expect(replay.reloadRequested).toBe(false);
    expect(reload).toHaveBeenCalledOnce();

    // If the reloaded Studio document still cannot become isolated, the
    // pre-existing one-reload fallback remains terminal.
    const studioDocument = requestStudioCrossOriginIsolationReload("/studio", {
      crossOriginIsolated: false,
      history,
      location: { href: "https://example.test/studio", reload },
      sessionStorage: storage,
    }, { documentWasStudio: true });
    expect(studioDocument.diagnostic.status).toBe("unavailable-after-reload");
    expect(studioDocument.reloadRequested).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("Studio isolation runtime diagnostic", () => {
  it("publishes a non-sensitive high-performance status and clears it outside Studio", () => {
    const attributes = new Map<string, string>();
    const element = {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      removeAttribute(name: string) {
        attributes.delete(name);
      },
    };

    publishStudioCrossOriginIsolationDiagnostic(
      diagnoseStudioCrossOriginIsolation("/studio", false, {
        [STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY]: true,
      }),
      element,
    );
    expect(Object.fromEntries(attributes)).toEqual({
      "data-studio-cross-origin-isolation": "unavailable-after-reload",
      "data-studio-high-performance": "false",
      "data-studio-isolation-reload-attempted": "true",
    });

    publishStudioCrossOriginIsolationDiagnostic(
      diagnoseStudioCrossOriginIsolation("/", false, null),
      element,
    );
    expect(attributes.size).toBe(0);
  });
});
