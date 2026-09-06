/**
 * Exact raster-source receipt for the visible Konva layer.
 *
 * The optional window probe remains the browser-verification surface. Product capture additionally
 * installs short-lived, in-memory fences for strict OPFS/CAS locators, and StudioKonvaImageNode
 * closes those fences only after the exact source has completed a real layer draw.
 */

export const STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION = 1 as const;

export interface StudioRasterImagePresentationIdentity {
  readonly elementId: string;
  readonly src: string;
}

export interface StudioRasterImagePresentationExpectation
  extends StudioRasterImagePresentationIdentity {
  readonly epoch: number;
}

export interface StudioRasterImagePresentationReceipt
  extends StudioRasterImagePresentationIdentity {
  readonly expectationEpoch: number;
  readonly presentedAt: number;
  readonly presentedWallClockMs: number;
  readonly receiptEpoch: number;
  readonly renderCounters: Readonly<Record<string, number>>;
}

export interface StudioRasterImagePresentationProbe {
  readonly version: typeof STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION;
  expectationEpoch: number;
  expected: StudioRasterImagePresentationExpectation | null;
  receiptEpoch: number;
  receipt: StudioRasterImagePresentationReceipt | null;
}

interface StudioRasterImagePresentationWaiter {
  readonly remaining: Set<string>;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

const studioRasterImagePresentationWaiters = new Set<StudioRasterImagePresentationWaiter>();
const studioMountedRasterImagePresentations = new Map<
  string,
  { readonly identity: StudioRasterImagePresentationIdentity; count: number }
>();

function presentationIdentityKey(identity: StudioRasterImagePresentationIdentity): string {
  return JSON.stringify([identity.elementId, identity.src]);
}

function releasePresentationWaiter(waiter: StudioRasterImagePresentationWaiter): void {
  studioRasterImagePresentationWaiters.delete(waiter);
  waiter.signal?.removeEventListener("abort", waiter.onAbort);
}

/** Registers only a canonical, render-eligible image-node mount; hidden/preview copies opt out. */
export function registerStudioMountedRasterImagePresentation(
  identity: StudioRasterImagePresentationIdentity,
): () => void {
  const key = presentationIdentityKey(identity);
  const current = studioMountedRasterImagePresentations.get(key);
  if (current) current.count += 1;
  else studioMountedRasterImagePresentations.set(key, { identity: { ...identity }, count: 1 });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const mounted = studioMountedRasterImagePresentations.get(key);
    if (!mounted || mounted.count <= 1) studioMountedRasterImagePresentations.delete(key);
    else mounted.count -= 1;
  };
}

/** Snapshot taken after the target page commit; therefore hidden and non-canonical copies vanish. */
export function snapshotStudioMountedRasterImagePresentations(): readonly StudioRasterImagePresentationIdentity[] {
  return Object.freeze(
    [...studioMountedRasterImagePresentations.values()]
      .map(({ identity }) => Object.freeze({ ...identity }))
      .toSorted((left, right) => presentationIdentityKey(left).localeCompare(presentationIdentityKey(right))),
  );
}

/**
 * Arms an exact presentation fence before requesting a Konva draw. No historical receipt is
 * accepted: every requested identity must be acknowledged by a draw caused after this call.
 */
export function waitForStudioRasterImagePresentations(
  identities: readonly StudioRasterImagePresentationIdentity[],
  requestDraw: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = new Set(identities.map(presentationIdentityKey));
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  if (remaining.size === 0) {
    requestDraw();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      releasePresentationWaiter(waiter);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const waiter: StudioRasterImagePresentationWaiter = {
      remaining,
      signal,
      onAbort,
      resolve,
      reject,
    };
    studioRasterImagePresentationWaiters.add(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      requestDraw();
    } catch (error) {
      releasePresentationWaiter(waiter);
      reject(error);
    }
  });
}

/** Called only from the concrete Konva image node after drawScene completed for this identity. */
export function acknowledgeStudioRasterImagePresentationDraw(
  identity: StudioRasterImagePresentationIdentity,
): void {
  const key = presentationIdentityKey(identity);
  for (const waiter of [...studioRasterImagePresentationWaiters]) {
    if (!waiter.remaining.delete(key) || waiter.remaining.size > 0) continue;
    releasePresentationWaiter(waiter);
    waiter.resolve();
  }
}

declare global {
  interface Window {
    __studioRasterImagePresentationProbe?: StudioRasterImagePresentationProbe;
    __studioHotPathRenderCounters?: Record<string, number>;
  }
}

function activeProbe(): StudioRasterImagePresentationProbe | null {
  if (typeof window === "undefined") return null;
  const probe = window.__studioRasterImagePresentationProbe;
  return probe?.version === STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION ? probe : null;
}

export function expectStudioRasterImagePresentation(
  identity: StudioRasterImagePresentationIdentity,
): StudioRasterImagePresentationExpectation | null {
  const probe = activeProbe();
  if (!probe) return null;
  const expected = {
    elementId: identity.elementId,
    epoch: probe.expectationEpoch + 1,
    src: identity.src,
  } satisfies StudioRasterImagePresentationExpectation;
  probe.expectationEpoch = expected.epoch;
  probe.expected = expected;
  return expected;
}

export function expectedStudioRasterImagePresentation(
  identity: StudioRasterImagePresentationIdentity,
): StudioRasterImagePresentationExpectation | null {
  const expected = activeProbe()?.expected;
  return expected
    && expected.elementId === identity.elementId
    && expected.src === identity.src
    ? expected
    : null;
}

export function acknowledgeStudioRasterImagePresentation(
  expected: StudioRasterImagePresentationExpectation,
): StudioRasterImagePresentationReceipt | null {
  const probe = activeProbe();
  if (
    !probe
    || probe.expected?.epoch !== expected.epoch
    || probe.expected.elementId !== expected.elementId
    || probe.expected.src !== expected.src
  ) {
    return null;
  }
  if (probe.receipt?.expectationEpoch === expected.epoch) return probe.receipt;
  const receipt = {
    elementId: expected.elementId,
    expectationEpoch: expected.epoch,
    presentedAt: performance.now(),
    presentedWallClockMs: Date.now(),
    receiptEpoch: probe.receiptEpoch + 1,
    renderCounters: { ...(window.__studioHotPathRenderCounters ?? {}) },
    src: expected.src,
  } satisfies StudioRasterImagePresentationReceipt;
  probe.receiptEpoch = receipt.receiptEpoch;
  probe.receipt = receipt;
  return receipt;
}
