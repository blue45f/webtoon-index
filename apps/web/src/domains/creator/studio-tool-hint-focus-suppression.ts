const suppressedFocusReturnTargets = new WeakSet<HTMLElement>();

/**
 * Keeps an intentional modal focus return accessible without immediately
 * reopening the coach that launched it. Keyboard focus remains unchanged for
 * every other route (including Escape and explicit close).
 */
export function suppressNextStudioToolHintFocus(target: HTMLElement | null): void {
  if (target) suppressedFocusReturnTargets.add(target);
}

/** Consumes only the next focus event for the exact launcher element. */
export function consumeStudioToolHintFocusSuppression(
  target: EventTarget | null
): boolean {
  if (!(target instanceof HTMLElement) || !suppressedFocusReturnTargets.has(target)) {
    return false;
  }
  suppressedFocusReturnTargets.delete(target);
  return true;
}
