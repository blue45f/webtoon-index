/**
 * React binding for the inspector deep-link bus (`studio-inspector-focus.ts`).
 *
 * Kept apart from the store so the store stays a plain module the node-env
 * tests can drive without React.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  consumeStudioInspectorFocusRequest,
  studioInspectorFocusTokenFor,
  subscribeStudioInspectorFocus,
  type StudioInspectorFocusTarget,
} from "./studio-inspector-focus";

import type { RefObject } from "react";

/**
 * Runs `onFocus` whenever a menu row asks for `target`, including repeats.
 * `null` opts a component out (most inspector sections are not link targets)
 * while keeping the hook call unconditional.
 * Returns the honoured token so a caller can key other effects off it.
 */
export function useStudioInspectorFocusRequest(
  target: StudioInspectorFocusTarget | null,
  onFocus: () => void,
): number {
  const token = useSyncExternalStore(
    subscribeStudioInspectorFocus,
    () => (target === null ? 0 : studioInspectorFocusTokenFor(target)),
    () => 0,
  );
  const handledRef = useRef(0);
  const handlerRef = useRef(onFocus);
  handlerRef.current = onFocus;

  useEffect(() => {
    if (target === null || token === 0 || token === handledRef.current) return;
    handledRef.current = token;
    handlerRef.current();
    consumeStudioInspectorFocusRequest(target, token);
  }, [target, token]);

  return token;
}

/**
 * Scrolls `element` into the inspector's viewport once a focus request lands.
 * Deferred a frame so a section that opens in the same commit is measured
 * after its content mounts.
 */
export function scrollStudioInspectorTargetIntoView(
  element: HTMLElement | null | undefined,
): void {
  if (!element) return;
  const reveal = () => {
    if (!element.isConnected) return;
    element.scrollIntoView({ block: "nearest", behavior: "auto" });
  };
  if (globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame(reveal);
    return;
  }
  reveal();
}

/** Convenience binding for a plain container that only needs revealing. */
export function useStudioInspectorFocusScroll(
  target: StudioInspectorFocusTarget,
  ref: RefObject<HTMLElement | null>,
): void {
  useStudioInspectorFocusRequest(target, () => {
    scrollStudioInspectorTargetIntoView(ref.current);
  });
}
