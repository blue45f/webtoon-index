const STUDIO_EDITOR_SELECTOR = "[data-studio-editor='true']";
const STUDIO_QUICK_START_SELECTOR = "[data-studio-creative-starter='true']";

function hasClosest(target: EventTarget | null): target is Element {
  return Boolean(
    target
    && typeof (target as Element).closest === "function"
  );
}

/**
 * The first-use coach is lazy and preference hydration is asynchronous. If the artist starts
 * operating Studio before that work finishes, mounting a modal coach later would interrupt the
 * action and steal focus. Treat that early trusted interaction as the same dismissal intent the
 * mounted coach already records for an outside interaction.
 *
 * Once the coach is actually mounted it owns its established outside-click/Escape dismissal
 * contract, so this guard deliberately leaves those events alone.
 */
export function shouldSuppressStudioQuickStartAutoOpen({
  isTrusted,
  ownerDocument,
  target,
}: {
  readonly isTrusted: boolean;
  readonly ownerDocument: Document;
  readonly target: EventTarget | null;
}): boolean {
  if (!isTrusted || !hasClosest(target)) return false;
  if (!target.closest(STUDIO_EDITOR_SELECTOR)) return false;
  return ownerDocument.querySelector(STUDIO_QUICK_START_SELECTOR) === null;
}
