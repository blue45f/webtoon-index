import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_FLAG,
  loadChunkWithReloadRecovery,
} from "./chunk-load-recovery";
import { consumeStudioProgrammaticReloadAllowance } from "./programmatic-reload";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

afterEach(() => {
  consumeStudioProgrammaticReloadAllowance();
  vi.unstubAllGlobals();
});

describe("loadChunkWithReloadRecovery", () => {
  it("returns a loaded module and clears a stale guard", async () => {
    const storage = createStorage({ "chunk-reload:market-network": "1" });
    vi.stubGlobal("sessionStorage", storage);

    await expect(
      loadChunkWithReloadRecovery(
        async () => ({ ready: true }),
        "market-network"
      )
    ).resolves.toEqual({ ready: true });
    expect(storage.removeItem).toHaveBeenCalledWith(
      "chunk-reload:market-network"
    );
  });

  it("arms one guard and reloads when the first chunk load fails", async () => {
    const storage = createStorage();
    const reload = vi.fn();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("location", { reload });

    void loadChunkWithReloadRecovery(
      async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      },
      "market-network"
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(storage.setItem).toHaveBeenCalledWith(
      "chunk-reload:market-network",
      "1"
    );
    expect(storage.setItem).toHaveBeenCalledWith(CHUNK_RELOAD_FLAG, "1");
    expect(consumeStudioProgrammaticReloadAllowance()).toBe(false);
  });

  it("preserves the import error instead of reloading twice", async () => {
    const storage = createStorage({ "chunk-reload:market-network": "1" });
    const reload = vi.fn();
    const error = new TypeError("stale deployment chunk");
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("location", { reload });

    await expect(
      loadChunkWithReloadRecovery(
        async () => {
          throw error;
        },
        "market-network"
      )
    ).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });

  it("coordinates with the route ErrorBoundary global reload guard", async () => {
    const storage = createStorage({ [CHUNK_RELOAD_FLAG]: "1" });
    const reload = vi.fn();
    const error = new TypeError("stale deployment chunk");
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("location", { reload });

    await expect(
      loadChunkWithReloadRecovery(
        async () => {
          throw error;
        },
        "another-chunk"
      )
    ).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("fails closed without reload when the guard store is unavailable", async () => {
    const reload = vi.fn();
    const error = new TypeError("chunk unavailable");
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("storage blocked");
      },
    });
    vi.stubGlobal("location", { reload });

    await expect(
      loadChunkWithReloadRecovery(
        async () => {
          throw error;
        },
        "market-network"
      )
    ).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });
});
