/**
 * Inspector deep-link bus — "open the inspector *at* this control".
 *
 * The §15.3 Brush group needs menu rows that land on surfaces living deep
 * inside the right inspector (Brush Studio, the saved-brush library, the
 * natural-media engines section). Opening the inspector is not enough: those
 * surfaces sit behind collapsed `StudioInspectorSection` disclosures, so a menu
 * item that only switches the route drops the artist on a wall of headers.
 *
 * Threading a `focusedSection` prop from StudioPage through StudioInspectorAside
 * would put a new render-triggering prop on the inspector's hot path. This is a
 * module-level store instead: only the target section subscribes, one request
 * mutates one component, and nothing above it re-renders. Same pattern the live
 * pressure HUD store uses in StudioPage.
 *
 * A request carries a monotonic token so re-requesting the *same* target still
 * reopens and re-scrolls it.
 */

/** Targets a menu row can point at. Extend deliberately — each needs a mount. */
export const STUDIO_INSPECTOR_FOCUS_TARGETS = [
  "element.text-fill",
  "element.typography",
  "element.text-align",
  "element.layout",
  "element.order-align",
  "selection.geometry",
  "palette.sub-tools",
  "palette.tool-properties",
  "tool.brush-studio",
  "tool.brush-engines",
  "brush.saved-library",
  "canvas.surface",
  "canvas.resize",
  "canvas.guide-lines",
  "canvas.style",
] as const;

export type StudioInspectorFocusTarget =
  (typeof STUDIO_INSPECTOR_FOCUS_TARGETS)[number];

export interface StudioInspectorFocusRequest {
  readonly target: StudioInspectorFocusTarget;
  /** Increments on every request so repeats are distinguishable. */
  readonly token: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let current: StudioInspectorFocusRequest | null = null;
let nextToken = 0;

export function isStudioInspectorFocusTarget(
  value: unknown,
): value is StudioInspectorFocusTarget {
  return (
    typeof value === "string" &&
    (STUDIO_INSPECTOR_FOCUS_TARGETS as readonly string[]).includes(value)
  );
}

/** Asks the inspector to reveal `target`. No-op for unknown ids. */
export function requestStudioInspectorFocus(target: StudioInspectorFocusTarget): void {
  if (!isStudioInspectorFocusTarget(target)) return;
  nextToken += 1;
  current = { target, token: nextToken };
  for (const listener of [...listeners]) listener();
}

export function subscribeStudioInspectorFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function studioInspectorFocusSnapshot(): StudioInspectorFocusRequest | null {
  return current;
}

/**
 * Token for `target`, or 0 when the outstanding request points elsewhere.
 * Components compare it against the last token they honoured; a plain "is it
 * me?" boolean would make a repeat request invisible.
 */
export function studioInspectorFocusTokenFor(
  target: StudioInspectorFocusTarget,
): number {
  return current?.target === target ? current.token : 0;
}

/**
 * Clears one request after its target has honoured it.
 *
 * Both target and token must still match: a focus handler may synchronously
 * publish a newer request, and acknowledging the older one must never erase
 * that newer intent. Requests remain pending when no matching target is
 * mounted because only the target binding calls this function.
 */
export function consumeStudioInspectorFocusRequest(
  target: StudioInspectorFocusTarget,
  token: number,
): void {
  if (current?.target !== target || current.token !== token) return;
  current = null;
  for (const listener of [...listeners]) listener();
}

/** Test seam — resets the bus between cases. */
export function resetStudioInspectorFocusForTest(): void {
  current = null;
  nextToken = 0;
  listeners.clear();
}
