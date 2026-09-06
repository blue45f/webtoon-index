import type { StudioWorkspaceDeviceSignals } from "./studio-workspaces";

/**
 * The ambient facts `readStudioWorkspaceDeviceSignals` needs, named so tests can supply them.
 *
 * Everything is optional because each source is missing on some real runtime: `matchMedia` is absent
 * in jsdom, `maxTouchPoints` is absent on older Safari, and a session that has never seen a pointer
 * has no pointer type at all.
 */
export interface StudioWorkspaceDeviceEnvironment {
  readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | null;
  readonly maxTouchPoints?: number | null;
  readonly innerWidth?: number | null;
  /** `PointerEvent.pointerType` of the most recent press, or null before the first one. */
  readonly lastPointerType?: string | null;
  /** True while the artist is driving the session from the keyboard rather than a pointer. */
  readonly keyboardDriven?: boolean;
}

function coarsePointerOf(
  matchMedia: StudioWorkspaceDeviceEnvironment["matchMedia"]
): boolean | undefined {
  if (typeof matchMedia !== "function") return undefined;
  try {
    return matchMedia("(pointer: coarse)").matches;
  } catch {
    // Safari throws on media features it cannot parse. An unanswerable probe is not a "no" — leaving
    // it undefined lets the classifier fall back to touch points instead of asserting a fine pointer.
    return undefined;
  }
}

function pointerTypeOf(
  value: string | null | undefined
): StudioWorkspaceDeviceSignals["pointerType"] {
  if (value === "pen" || value === "touch" || value === "mouse") return value;
  return value ? "unknown" : null;
}

/**
 * Collect the runtime signals that classify which input surface the studio is being drawn on.
 *
 * Read this at the moment a workspace is applied rather than continuously: docks that re-arrange
 * because the artist happened to reach for the keyboard mid-drawing would be worse than docks that
 * stay where the profile put them.
 */
export function readStudioWorkspaceDeviceSignals(
  environment: StudioWorkspaceDeviceEnvironment = {}
): StudioWorkspaceDeviceSignals {
  const signals: {
    -readonly [Key in keyof StudioWorkspaceDeviceSignals]: StudioWorkspaceDeviceSignals[Key];
  } = {};
  const pointerType = pointerTypeOf(environment.lastPointerType);
  if (pointerType !== null) signals.pointerType = pointerType;
  const coarsePointer = coarsePointerOf(environment.matchMedia);
  if (coarsePointer !== undefined) signals.coarsePointer = coarsePointer;
  if (typeof environment.maxTouchPoints === "number" && Number.isFinite(environment.maxTouchPoints)) {
    signals.maxTouchPoints = environment.maxTouchPoints;
  }
  if (typeof environment.innerWidth === "number" && Number.isFinite(environment.innerWidth)) {
    signals.viewportWidth = environment.innerWidth;
  }
  if (environment.keyboardDriven === true) signals.keyboardDriven = true;
  return signals;
}

/** Reads the same signals from the ambient browser globals, for the studio's own call sites. */
export function readStudioWorkspaceDeviceSignalsFromGlobals(
  lastPointerType: string | null,
  keyboardDriven = false
): StudioWorkspaceDeviceSignals {
  return readStudioWorkspaceDeviceSignals({
    matchMedia: typeof globalThis.matchMedia === "function"
      ? (query: string) => globalThis.matchMedia(query)
      : null,
    maxTouchPoints: globalThis.navigator?.maxTouchPoints ?? null,
    innerWidth: typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : null,
    lastPointerType,
    keyboardDriven,
  });
}
