import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const ENTRY_MODULE = "./studio-dry-media-union-continuation.worker";
const OPFS_MODULE = "./studio-dry-media-union-continuation-opfs-store";
const STORE_MODULE = "./studio-dry-media-union-continuation-store";
const RUNTIME_MODULE = "./studio-dry-media-union-continuation-worker-runtime";

interface EntryMocks {
  readonly cas: Readonly<{ close: ReturnType<typeof vi.fn> }>;
  readonly store: Readonly<Record<string, never>>;
  readonly runtime: Readonly<{ close: ReturnType<typeof vi.fn> }>;
  readonly createOpfs: ReturnType<typeof vi.fn>;
  readonly createStore: ReturnType<typeof vi.fn>;
  readonly constructRuntime: ReturnType<typeof vi.fn>;
  readonly installRuntime: ReturnType<typeof vi.fn>;
}

function installEntryMocks(
  options: Readonly<{
    opfsFailure?: Error;
    storeFailure?: Error;
    installFailure?: Error;
  }> = {},
): EntryMocks {
  vi.resetModules();
  const cas = Object.freeze({ close: vi.fn(async () => undefined) });
  const store = Object.freeze({});
  const runtime = Object.freeze({ close: vi.fn(async () => undefined) });
  const createOpfs = options.opfsFailure
    ? vi.fn(async () => { throw options.opfsFailure; })
    : vi.fn(async () => cas);
  const createStore = options.storeFailure
    ? vi.fn(() => { throw options.storeFailure; })
    : vi.fn(() => store);
  const constructRuntime = vi.fn();
  const installRuntime = options.installFailure
    ? vi.fn(() => { throw options.installFailure; })
    : vi.fn();

  vi.doMock(OPFS_MODULE, () => ({
    createStudioDryMediaUnionContinuationOpfsCasStore: createOpfs,
  }));
  vi.doMock(STORE_MODULE, () => ({
    createStudioDryMediaUnionContinuationStore: createStore,
  }));
  vi.doMock(RUNTIME_MODULE, () => ({
    StudioDryMediaUnionContinuationWorkerRuntime: class {
      public constructor(optionsValue: unknown) {
        constructRuntime(optionsValue);
        return runtime;
      }
    },
    installStudioDryMediaUnionContinuationWorkerRuntime: installRuntime,
  }));
  return {
    cas,
    store,
    runtime,
    createOpfs,
    createStore,
    constructRuntime,
    installRuntime,
  };
}

afterEach(() => {
  vi.doUnmock(OPFS_MODULE);
  vi.doUnmock(STORE_MODULE);
  vi.doUnmock(RUNTIME_MODULE);
  vi.resetModules();
});

describe("studio dry-media continuation Worker entry", () => {
  it("is referenced by the client through a statically discoverable Vite module Worker URL", () => {
    const clientSource = readFileSync(
      new URL("./studio-dry-media-union-continuation-worker-client.ts", import.meta.url),
      "utf8",
    );

    expect(clientSource).toContain(
      'new URL("./studio-dry-media-union-continuation.worker.ts", import.meta.url)',
    );
    expect(clientSource).toContain('{ type: "module", name: "studio-dry-media-union-continuation" }');
  });

  it("constructs the OPFS-backed store and installs exactly one runtime in the Worker scope", async () => {
    const mocks = installEntryMocks();

    await import(ENTRY_MODULE);

    expect(mocks.createOpfs).toHaveBeenCalledOnce();
    expect(mocks.createOpfs).toHaveBeenCalledWith(globalThis);
    expect(mocks.createStore).toHaveBeenCalledOnce();
    expect(mocks.createStore).toHaveBeenCalledWith(mocks.cas);
    expect(mocks.constructRuntime).toHaveBeenCalledOnce();
    expect(mocks.constructRuntime).toHaveBeenCalledWith({ store: mocks.store });
    expect(mocks.installRuntime).toHaveBeenCalledOnce();
    expect(mocks.installRuntime).toHaveBeenCalledWith(globalThis, mocks.runtime);
    expect(mocks.cas.close).not.toHaveBeenCalled();
    expect(mocks.runtime.close).not.toHaveBeenCalled();
  });

  it("fails Worker module startup without creating a memory or DOM fallback when OPFS is unavailable", async () => {
    const opfsFailure = new Error("opfs-unavailable");
    const mocks = installEntryMocks({ opfsFailure });

    await expect(import(ENTRY_MODULE)).rejects.toBe(opfsFailure);

    expect(mocks.createStore).not.toHaveBeenCalled();
    expect(mocks.constructRuntime).not.toHaveBeenCalled();
    expect(mocks.installRuntime).not.toHaveBeenCalled();
    expect(mocks.cas.close).not.toHaveBeenCalled();
  });

  it("closes the opened OPFS CAS and keeps the original failure when store construction fails", async () => {
    const storeFailure = new Error("store-construction-failed");
    const mocks = installEntryMocks({ storeFailure });

    await expect(import(ENTRY_MODULE)).rejects.toBe(storeFailure);

    expect(mocks.cas.close).toHaveBeenCalledOnce();
    expect(mocks.constructRuntime).not.toHaveBeenCalled();
    expect(mocks.installRuntime).not.toHaveBeenCalled();
  });

  it("closes the constructed runtime and preserves an installer failure", async () => {
    const installFailure = new Error("runtime-install-failed");
    const mocks = installEntryMocks({ installFailure });

    await expect(import(ENTRY_MODULE)).rejects.toBe(installFailure);

    expect(mocks.installRuntime).toHaveBeenCalledOnce();
    expect(mocks.runtime.close).toHaveBeenCalledOnce();
    expect(mocks.cas.close).not.toHaveBeenCalled();
  });

  it("does not contain a main-thread, in-memory, or eager raster allocation path", () => {
    const entrySource = readFileSync(
      new URL("./studio-dry-media-union-continuation.worker.ts", import.meta.url),
      "utf8",
    );

    expect(entrySource).not.toMatch(/\bdocument\b|\bwindow\b|\blocalStorage\b/u);
    expect(entrySource).not.toMatch(/\bnew\s+(?:Worker|OffscreenCanvas|WebAssembly\.Memory)\b/u);
    expect(entrySource).not.toContain("memory-sync");
    expect(entrySource).not.toContain("fallback");
  });
});
