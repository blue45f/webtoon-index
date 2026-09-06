/**
 * Owns the one browser API the reference-rebuild presets need: constructing the
 * prebuilt module worker that generates GLB meshes in the browser. Components
 * stay free of `new Worker(` (studio-host-architecture-ratchet) and can be
 * rendered where `Worker` does not exist.
 */
export const STUDIO_REFERENCE_REBUILD_WORKER_URL = "/assets/reference-rebuild/worker.mjs";

/** `null` when the runtime has no `Worker` or refuses to start one (CSP, file: origin). */
export function createStudioReferenceRebuildWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(STUDIO_REFERENCE_REBUILD_WORKER_URL, { type: "module" });
  } catch {
    return null;
  }
}
