import type { Camera, Object3D } from "three";

export interface StudioBg3dFrameQueueRenderer {
  readonly isWebGPURenderer?: boolean;
  readonly backend?: {
    readonly isWebGPUBackend?: boolean;
    readonly device?: { readonly queue?: { onSubmittedWorkDone(): Promise<void> } };
  };
  getRenderTarget(): unknown;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: Object3D, camera: Camera): void;
}

interface FrameQueueOwner {
  acquire(requestFrame: () => void): () => void;
}
const owners = new WeakMap<StudioBg3dFrameQueueRenderer, FrameQueueOwner>();

/**
 * Bound live WebGPU work to one submitted frame, not one frame per pointer event. R3F's demand
 * loop coalesces CPU invalidations but cannot observe the asynchronous GPU queue: a slow adapter
 * can still be drawing an old pose long after all 24 drag events have been dispatched.
 *
 * Clear and every synchronous Drei View render form ONE batch. Gating render alone would leave
 * a queue of blank clears; gating each View separately would starve the other three views. The
 * microtask closes the synchronous batch after all Views have submitted, without awaiting inside
 * R3F. While it is in flight, live requests become one dirty flag. Completion invalidates once,
 * rendering the latest scene, never a saved/replayed pose. Offscreen captures are never skipped.
 *
 * This owns no renderer/device and changes no resolution, frame clock, image or capture oracle.
 * Shared leases cover re-entrant mounting; late completions cannot wake a disposed/new owner.
 */
export function installStudioBg3dFrameBackpressure(
  renderer: StudioBg3dFrameQueueRenderer,
  requestFrame: () => void,
): () => void {
  const existing = owners.get(renderer);
  if (existing) return existing.acquire(requestFrame);
  const queue = renderer.backend?.device?.queue;
  if (renderer.isWebGPURenderer !== true || renderer.backend?.isWebGPUBackend !== true
    || !queue || typeof queue.onSubmittedWorkDone !== "function") return () => undefined;

  const originalClear = renderer.clear;
  const originalRender = renderer.render;
  const leases = new Set<{ requestFrame: () => void }>();
  let disposed = false;
  let failed = false;
  let inFlight = false;
  let batchOpen = false;
  let batchAllowed = false;
  let submitted = false;
  let dirty = false;

  const fail = (error: unknown) => {
    if (disposed || failed) return;
    failed = true;
    dirty = false;
    // A lost/rejected queue is not a stable frame. Device-loss handling remains with the engine;
    // also surface this error so browser verification cannot turn a frozen canvas into a pass.
    console.error("BG3D WebGPU frame queue failed", error);
  };
  const complete = () => {
    if (disposed || failed) return;
    inFlight = false;
    if (!dirty) return;
    dirty = false;
    for (const lease of leases) {
      try { lease.requestFrame(); } catch (error) { fail(error); }
    }
  };
  const finishBatch = () => {
    batchOpen = false;
    if (disposed || failed || !submitted) return;
    submitted = false;
    inFlight = true;
    try {
      void Promise.resolve(queue.onSubmittedWorkDone()).then(complete, fail);
    } catch (error) {
      fail(error);
    }
  };
  const admit = () => {
    if (disposed) return false;
    // The editor's artifact, thumbnail and export adapters retain their synchronous submission
    // contract and restore their render target themselves. They must never lose a capture pass.
    if (renderer.getRenderTarget() !== null) return true;
    if (failed) return false;
    if (!batchOpen) {
      batchOpen = true;
      batchAllowed = !inFlight;
      queueMicrotask(finishBatch);
    }
    if (!batchAllowed) {
      dirty = true;
      return false;
    }
    submitted = true;
    return true;
  };
  const clear: StudioBg3dFrameQueueRenderer["clear"] = (...args) => {
    if (admit()) originalClear.apply(renderer, args);
  };
  const render: StudioBg3dFrameQueueRenderer["render"] = (scene, camera) => {
    if (admit()) originalRender.call(renderer, scene, camera);
  };
  renderer.clear = clear;
  renderer.render = render;
  const owner: FrameQueueOwner = {
    acquire(nextRequestFrame) {
      const lease = { requestFrame: nextRequestFrame };
      leases.add(lease);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        if (leases.size !== 0) return;
        disposed = true;
        dirty = false;
        if (renderer.clear === clear) renderer.clear = originalClear;
        if (renderer.render === render) renderer.render = originalRender;
        if (owners.get(renderer) === owner) owners.delete(renderer);
      };
    },
  };
  owners.set(renderer, owner);
  return owner.acquire(requestFrame);
}
