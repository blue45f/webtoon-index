import { useEffect, useId, useRef } from "react";

function visibleFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    [
      "button:not([disabled]):not([tabindex='-1'])",
      "input:not([disabled])",
      "select:not([disabled])",
      "[tabindex='0']",
    ].join(","),
  )].filter((element) => (
    !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0
  ));
}

function isTypingTarget(target: HTMLElement): boolean {
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
    || target.isContentEditable
    || target.getAttribute("role") === "textbox";
}

function hasActiveFloatingInteraction(surface: HTMLElement | null): boolean {
  return surface?.getAttribute("data-dragging") === "true"
    || surface?.getAttribute("data-resizing") === "true";
}

/** Shared focus, modal-tab, and shortcut lifecycle for both Quick Access presentations. */
export function useStudioQuickAccessSurfaceLifecycle(
  isMobile: boolean,
  onClose: () => void,
) {
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const activeElement = document.activeElement;
    restoreFocusRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : null;
    const timer = globalThis.setTimeout(() => {
      const initialCommand = surfaceRef.current?.querySelector<HTMLElement>(
        "[data-command-available='true'] button:not([disabled])",
      );
      (initialCommand ?? surfaceRef.current)?.focus({ preventScroll: true });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected && !restoreTarget.closest("[inert]")) {
        restoreTarget.focus({ preventScroll: true });
      }
      restoreFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    function trapMobileFocus(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Tab" || !surfaceRef.current) return;
      const focusable = visibleFocusableElements(surfaceRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        surfaceRef.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", trapMobileFocus);
    return () => document.removeEventListener("keydown", trapMobileFocus);
  }, [isMobile]);

  useEffect(() => {
    function handleSurfaceShortcut(event: globalThis.KeyboardEvent): void {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || !surfaceRef.current?.contains(target)) return;
      if (
        event.code === "KeyQ"
        && event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.repeat
        && !isTypingTarget(target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // Customization and active floating-window interactions own Escape first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (hasActiveFloatingInteraction(surfaceRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", handleSurfaceShortcut);
    return () => document.removeEventListener("keydown", handleSurfaceShortcut);
  }, [onClose]);

  return { descriptionId, surfaceRef } as const;
}
