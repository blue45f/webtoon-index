import type { ReactElement } from "react";

export interface StudioBg3dRetainedElementProps {
  readonly open: boolean;
  readonly onWebXrCleanupPendingChange?: (pending: boolean) => void;
}

export type StudioBg3dRetainedElement = ReactElement<StudioBg3dRetainedElementProps>;

/**
 * Route-independent owner for the one BG3D editor element.
 *
 * WebXR's Three attachment is a browser/renderer promise and cannot be cancelled. A Studio route
 * can disappear while that promise is pending, so the React subtree that owns its Canvas must live
 * one level above the route. This store transports the already-created React element opaquely: it
 * never inspects or serializes its props and never contains an XRSession, renderer, or device
 * handle.
 */

export interface StudioBg3dRetainedOwnerLease {
  readonly kind: "toonspectrum.studio-bg3d-retained-owner-lease";
  readonly version: 1;
  readonly generation: number;
  readonly element: StudioBg3dRetainedElement | null;
  readonly logicalOpen: boolean;
  readonly cleanupPending: boolean;
  readonly routeAttached: boolean;
}

export interface StudioBg3dRetainedOwnerSource {
  readonly getSnapshot: () => StudioBg3dRetainedOwnerLease;
  readonly subscribe: (listener: () => void) => () => void;
}

let snapshot: StudioBg3dRetainedOwnerLease = Object.freeze({
  kind: "toonspectrum.studio-bg3d-retained-owner-lease",
  version: 1,
  generation: 0,
  element: null,
  logicalOpen: false,
  cleanupPending: false,
  routeAttached: false,
});
const listeners = new Set<() => void>();

function publish(next: Omit<StudioBg3dRetainedOwnerLease, "kind" | "version">): void {
  snapshot = Object.freeze({
    kind: "toonspectrum.studio-bg3d-retained-owner-lease",
    version: 1,
    ...next,
  });
  for (const listener of listeners) listener();
}

export const studioBg3dRetainedOwnerSource: StudioBg3dRetainedOwnerSource = Object.freeze({
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});

/** Publish the current route's one BG3D element into the AppShell-owned host. */
export function publishStudioBg3dRetainedOwnerLease(input: {
  readonly element: StudioBg3dRetainedElement | null;
  readonly logicalOpen: boolean;
}): number | null {
  // A newly mounted Studio route must not replace the hidden Canvas whose non-cancellable attach
  // receipt still owns renderer teardown. It will retry after the retained host publishes release.
  if (snapshot.routeAttached || snapshot.element !== null) return null;
  const generation = snapshot.generation + 1;
  publish({
    generation,
    element: input.element,
    logicalOpen: input.logicalOpen,
    cleanupPending: false,
    routeAttached: true,
  });
  return generation;
}

/** Update the exact live route. A close first retains the element with open=false for cleanup. */
export function updateStudioBg3dRetainedOwnerLease(
  generation: number,
  input: {
    readonly element: StudioBg3dRetainedElement | null;
    readonly logicalOpen: boolean;
  },
): boolean {
  if (snapshot.generation !== generation || !snapshot.routeAttached) return false;
  const closingExistingElement = snapshot.element !== null && !input.logicalOpen;
  publish({
    generation,
    element: input.element ?? (closingExistingElement ? snapshot.element : null),
    logicalOpen: input.logicalOpen,
    cleanupPending: closingExistingElement,
    routeAttached: true,
  });
  return true;
}

/**
 * Detach only the exact route generation. The AppShell host first asks the element to close
 * logically; that element releases itself after its controller cleanup receipt settles.
 */
export function detachStudioBg3dRetainedOwnerRoute(generation: number): boolean {
  if (snapshot.generation !== generation || !snapshot.routeAttached) return false;
  publish({
    generation,
    element: snapshot.element,
    logicalOpen: false,
    cleanupPending: snapshot.element !== null,
    routeAttached: false,
  });
  return true;
}

/** Direct callback owned by the AppShell host; it remains valid after the route disappears. */
export function reportStudioBg3dRetainedOwnerCleanup(
  generation: number,
  pending: boolean,
): boolean {
  if (snapshot.generation !== generation) return false;
  const shouldRelease = !pending && !snapshot.logicalOpen;
  if (
    pending === snapshot.cleanupPending
    && (!shouldRelease || snapshot.element === null)
  ) return true;
  publish({
    generation,
    element: shouldRelease ? null : snapshot.element,
    logicalOpen: snapshot.logicalOpen,
    cleanupPending: shouldRelease ? false : pending,
    routeAttached: snapshot.routeAttached,
  });
  return true;
}

/** Release only the exact hidden cleanup generation; stale receipts cannot remove a reopen. */
export function releaseStudioBg3dRetainedOwnerLease(generation: number): boolean {
  if (snapshot.generation !== generation || snapshot.routeAttached) return false;
  publish({
    generation,
    element: null,
    logicalOpen: false,
    cleanupPending: false,
    routeAttached: false,
  });
  return true;
}

/** Test isolation only; product lifecycle must use generation-fenced detach/release. */
export function resetStudioBg3dRetainedOwnerForTests(): void {
  publish({
    generation: snapshot.generation + 1,
    element: null,
    logicalOpen: false,
    cleanupPending: false,
    routeAttached: false,
  });
}
