/**
 * Cross-surface intent for opening the AI webtoon super suite.
 *
 * The main menu can be rendered before the AI tool popover body is mounted. A plain DOM event
 * would therefore be lossy. This module keeps a one-shot pending bit in addition to dispatching
 * an event, so a later-mounted popover can consume the request deterministically.
 */
export const STUDIO_AI_SUPER_SUITE_OPEN_EVENT =
  "toonspectrum:studio-ai-super-suite-open";

export interface StudioAiSuperSuiteIntentTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

let pendingOpenRequest = false;

function browserTarget(): StudioAiSuperSuiteIntentTarget | null {
  return typeof window === "undefined" ? null : window;
}

/** Opens immediately when a listener exists, or leaves a one-shot request for the next mount. */
export function requestStudioAiSuperSuiteOpen(
  target: StudioAiSuperSuiteIntentTarget | null = browserTarget()
): void {
  pendingOpenRequest = true;
  if (!target || typeof Event === "undefined") return;
  target.dispatchEvent(new Event(STUDIO_AI_SUPER_SUITE_OPEN_EVENT));
}

/** Consumes a request that happened before the AI popover was mounted. */
export function consumeStudioAiSuperSuiteOpenRequest(): boolean {
  const requested = pendingOpenRequest;
  pendingOpenRequest = false;
  return requested;
}

/** Subscribes an already-mounted surface. Delivery also consumes the pending request. */
export function subscribeStudioAiSuperSuiteOpenRequest(
  listener: () => void,
  target: StudioAiSuperSuiteIntentTarget | null = browserTarget()
): () => void {
  if (!target) return () => {};
  const handleOpen: EventListener = () => {
    pendingOpenRequest = false;
    listener();
  };
  target.addEventListener(STUDIO_AI_SUPER_SUITE_OPEN_EVENT, handleOpen);
  // Close the render→effect race: a request may arrive after the component consumed the initial
  // pending bit but before this listener was attached. Deliver that request exactly once now.
  if (pendingOpenRequest) {
    pendingOpenRequest = false;
    listener();
  }
  return () => target.removeEventListener(STUDIO_AI_SUPER_SUITE_OPEN_EVENT, handleOpen);
}
