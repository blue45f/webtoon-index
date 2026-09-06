/**
 * Escape + outside-pointer dismissal for Studio's *non-modal* floating surfaces.
 *
 * `useStudioModalSheet` already owns focus trapping, background inertness and Escape for the
 * modal mobile sheets. Surfaces that must keep the canvas and the mobile dock usable while they
 * are open (creative modes, brush settings) cannot take that contract, yet they still have to
 * honour the rule that a dismissible surface has a working dismissal on every viewport: an X
 * button alone fails the moment the surface is taller than the viewport.
 *
 * Pure DOM, no React, so the contract is unit-testable without rendering the Studio monolith.
 */

export interface StudioDismissableSurfaceOptions {
  /** Nodes that must not count as "outside" (the launcher that toggles the surface, portals…). */
  readonly ignore?: readonly (Element | null | undefined)[];
  readonly onDismiss: () => void;
  readonly surface: Element;
}

function containsTarget(root: Element | null | undefined, target: EventTarget | null): boolean {
  if (!root || !target) return false;
  return root === target || (target instanceof Node && root.contains(target));
}

/**
 * Attaches Escape (capture) and outside-pointerdown (capture) dismissal to `surface`.
 * Returns the detach function; calling it twice is safe.
 */
export function attachStudioDismissableSurface({
  ignore = [],
  onDismiss,
  surface,
}: StudioDismissableSurfaceOptions): () => void {
  const ownerDocument = surface.ownerDocument;
  if (!ownerDocument) return () => undefined;

  const isInside = (target: EventTarget | null): boolean =>
    containsTarget(surface, target)
    || ignore.some((node) => containsTarget(node ?? null, target));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // A nested modal (confirm dialog, brush manager…) owns its own Escape first.
    if (
      event.target instanceof Element
      && event.target.closest("[aria-modal='true']") !== null
      && !containsTarget(surface, event.target)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  };

  const onPointerDown = (event: Event) => {
    if (isInside(event.target)) return;
    onDismiss();
  };

  ownerDocument.addEventListener("keydown", onKeyDown, true);
  ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
  };
}
