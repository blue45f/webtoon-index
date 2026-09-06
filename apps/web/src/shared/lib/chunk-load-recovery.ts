const CHUNK_RELOAD_GUARD_PREFIX = "chunk-reload:";
export const CHUNK_RELOAD_FLAG = "toonspectrum:chunk-reload-attempted";

function chunkReloadGuardKey(chunkId: string): string {
  return `${CHUNK_RELOAD_GUARD_PREFIX}${chunkId}`;
}

function hasReloadGuard(key: string): boolean {
  try {
    return globalThis.sessionStorage.getItem(key) !== null;
  } catch {
    // Storage-blocked and non-browser environments must never enter a reload loop.
    return true;
  }
}

function armReloadGuard(key: string): boolean {
  try {
    globalThis.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

function clearReloadGuard(key: string): void {
  try {
    globalThis.sessionStorage.removeItem(key);
  } catch {
    // A blocked store has no durable guard to clear.
  }
}

export function hasAttemptedChunkReload(): boolean {
  try {
    return globalThis.sessionStorage.getItem(CHUNK_RELOAD_FLAG) === "1";
  } catch {
    // Without durable storage an automatic reload cannot be bounded, so fail closed.
    return true;
  }
}

export function markChunkReloadAttempted(): void {
  armReloadGuard(CHUNK_RELOAD_FLAG);
}

/**
 * Recovers a stale deployment chunk once, including chunks loaded from event handlers/effects
 * rather than React.lazy. A persistent guard prevents reload loops; storage-blocked or non-browser
 * environments fail closed and preserve the original import error.
 */
export async function loadChunkWithReloadRecovery<T>(
  load: () => Promise<T>,
  chunkId: string
): Promise<T> {
  const guardKey = chunkReloadGuardKey(chunkId);
  try {
    const module = await load();
    clearReloadGuard(guardKey);
    return module;
  } catch (error) {
    if (
      hasReloadGuard(guardKey)
      || hasAttemptedChunkReload()
      || !armReloadGuard(guardKey)
    ) {
      throw error;
    }
    if (!armReloadGuard(CHUNK_RELOAD_FLAG)) {
      clearReloadGuard(guardKey);
      throw error;
    }
    const reload = globalThis.location?.reload;
    if (typeof reload !== "function") {
      clearReloadGuard(guardKey);
      throw error;
    }
    reload.call(globalThis.location);
    return await new Promise<never>(() => {
      // Keep the current Suspense or in-panel loading state mounted until navigation replaces it.
      // In Studio, a cancelled unsaved-work prompt intentionally leaves this request pending: the
      // in-memory document is more valuable than replacing the editor with a route error screen.
    });
  }
}
