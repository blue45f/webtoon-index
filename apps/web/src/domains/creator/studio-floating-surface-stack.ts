const STUDIO_FLOATING_SURFACE_Z_BASE = 50;
const STUDIO_FLOATING_SURFACE_Z_MAX = 69;
const STUDIO_FLOATING_SURFACE_STACK_CAPACITY =
  STUDIO_FLOATING_SURFACE_Z_MAX - STUDIO_FLOATING_SURFACE_Z_BASE + 1;

const order: string[] = [];
const registrations = new Map<string, number>();
const listeners = new Set<() => void>();
let revision = 0;

function normalizeSurfaceId(surfaceId: string): string {
  const normalized = surfaceId.trim();
  return normalized.length > 0 && normalized.length <= 160
    ? normalized
    : "studio-floating-surface";
}

function publish(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * Registers one visible floating surface and returns an idempotent cleanup.
 *
 * The registry tracks duplicate mounts by reference count so a Strict Mode cleanup cannot remove
 * a concurrently mounted surface that intentionally shares the same stable id.
 */
export function registerStudioFloatingSurface(surfaceId: string): () => void {
  const id = normalizeSurfaceId(surfaceId);
  const count = registrations.get(id) ?? 0;
  registrations.set(id, count + 1);
  if (count === 0) {
    order.push(id);
    publish();
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const current = registrations.get(id) ?? 0;
    if (current > 1) {
      registrations.set(id, current - 1);
      return;
    }
    registrations.delete(id);
    const index = order.indexOf(id);
    if (index >= 0) order.splice(index, 1);
    publish();
  };
}

/** Brings a registered surface above peers but below transient popovers at z=70. */
export function bringStudioFloatingSurfaceToFront(surfaceId: string): void {
  const id = normalizeSurfaceId(surfaceId);
  const index = order.indexOf(id);
  if (index === order.length - 1) return;
  if (index >= 0) order.splice(index, 1);
  else registrations.set(id, Math.max(1, registrations.get(id) ?? 0));
  order.push(id);
  publish();
}

/**
 * Returns a bounded z-index. If more than twenty surfaces are ever visible, older windows share
 * the floor while the most recently focused twenty retain a strict ordering.
 */
export function studioFloatingSurfaceZIndex(surfaceId: string): number {
  const id = normalizeSurfaceId(surfaceId);
  const index = order.indexOf(id);
  if (index < 0) return STUDIO_FLOATING_SURFACE_Z_BASE;
  const visibleRank = Math.max(
    0,
    STUDIO_FLOATING_SURFACE_STACK_CAPACITY - (order.length - index),
  );
  return Math.min(
    STUDIO_FLOATING_SURFACE_Z_MAX,
    STUDIO_FLOATING_SURFACE_Z_BASE + visibleRank,
  );
}

export function subscribeStudioFloatingSurfaceStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function studioFloatingSurfaceStackSnapshot(): number {
  return revision;
}

const resetListeners = new Set<() => void>();

/**
 * Asks every mounted floating surface to return to its default layout.
 *
 * This is the recovery path for a window dragged past the viewport or shrunk to a sliver: its own
 * header — and therefore its own reset — is no longer reachable, so the action cannot live on the
 * surface alone. The request only carries the ask; each surface still performs its own reset, so a
 * surface keeps ownership of what "default" means for it.
 */
export function requestStudioFloatingSurfaceLayoutReset(): void {
  // Copy first: a listener that unmounts its surface would otherwise mutate the set mid-iteration.
  for (const listener of [...resetListeners]) listener();
}

export function subscribeStudioFloatingSurfaceLayoutReset(
  listener: () => void,
): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/** Test-only reset; product code never needs to globally erase the visible window stack. */
export function resetStudioFloatingSurfaceStackForTest(): void {
  order.length = 0;
  registrations.clear();
  resetListeners.clear();
  publish();
}
