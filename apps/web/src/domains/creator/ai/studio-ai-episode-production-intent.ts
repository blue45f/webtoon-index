/**
 * Cross-surface intent for opening the AI episode production director.
 *
 * The launcher lives in the AI assist hub, but the dialog's lifetime is owned by a gateway
 * that may mount after the request (lazy popover body, StrictMode replay). Mirror the
 * super-suite intent: dispatch an event for a mounted gateway and keep a one-shot pending
 * bit for a later-mounted one, so no request is lost and none is delivered twice.
 */
export const STUDIO_AI_EPISODE_PRODUCTION_OPEN_EVENT =
  "toonspectrum:studio-ai-episode-production-open";

export interface StudioAiEpisodeProductionIntentTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

let pendingOpenRequest = false;

function browserTarget(): StudioAiEpisodeProductionIntentTarget | null {
  return typeof window === "undefined" ? null : window;
}

/** Opens immediately when a listener exists, or leaves a one-shot request for the next mount. */
export function requestStudioAiEpisodeProductionOpen(
  target: StudioAiEpisodeProductionIntentTarget | null = browserTarget()
): void {
  pendingOpenRequest = true;
  if (!target || typeof Event === "undefined") return;
  target.dispatchEvent(new Event(STUDIO_AI_EPISODE_PRODUCTION_OPEN_EVENT));
}

/** Consumes a request that happened before the gateway was mounted. */
export function consumeStudioAiEpisodeProductionOpenRequest(): boolean {
  const requested = pendingOpenRequest;
  pendingOpenRequest = false;
  return requested;
}

/** Subscribes an already-mounted gateway. Delivery also consumes the pending request. */
export function subscribeStudioAiEpisodeProductionOpenRequest(
  listener: () => void,
  target: StudioAiEpisodeProductionIntentTarget | null = browserTarget()
): () => void {
  if (!target) return () => {};
  const handleOpen: EventListener = () => {
    pendingOpenRequest = false;
    listener();
  };
  target.addEventListener(STUDIO_AI_EPISODE_PRODUCTION_OPEN_EVENT, handleOpen);
  // Close the render→effect race: a request may arrive before this listener is attached.
  // Deliver that request exactly once now.
  if (pendingOpenRequest) {
    pendingOpenRequest = false;
    listener();
  }
  return () => target.removeEventListener(STUDIO_AI_EPISODE_PRODUCTION_OPEN_EVENT, handleOpen);
}
