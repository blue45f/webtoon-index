export type StudioToolHintRevealIntent = "focus" | "hover" | "touch";

export const STUDIO_TOOL_HINT_HOVER_COOLDOWN_MS = 90_000;
export const STUDIO_TOOL_HINT_ACTIVATION_COOLDOWN_MS = 5 * 60_000;
export const STUDIO_TOOL_HINT_MAX_AUTOMATIC_REVEALS = 2;

const MAX_TRACKED_HINTS = 256;

type StudioToolHintExposure = Readonly<{
  automaticRevealCount: number;
  lastAutomaticRevealAt: number | null;
  lastActivationAt: number | null;
}>;

export type StudioToolHintExposureManager = {
  canReveal: (hintId: string, intent: StudioToolHintRevealIntent, now?: number) => boolean;
  markRevealed: (hintId: string, intent: StudioToolHintRevealIntent, now?: number) => void;
  markActivated: (hintId: string, now?: number) => void;
};

const EMPTY_EXPOSURE: StudioToolHintExposure = {
  automaticRevealCount: 0,
  lastAutomaticRevealAt: null,
  lastActivationAt: null,
};

/**
 * Keeps automatic coaching useful without turning it into hover noise.
 *
 * The memory is deliberately scoped to one Studio provider session. Keyboard
 * focus and touch long-press are explicit help requests, so they always remain
 * available. Passive hover is cooled down, capped, and paused longer after the
 * user activates that semantic tool — including when its button remounts.
 */
export function createStudioToolHintExposureManager(): StudioToolHintExposureManager {
  const exposures = new Map<string, StudioToolHintExposure>();

  function read(hintId: string): StudioToolHintExposure {
    return exposures.get(hintId) ?? EMPTY_EXPOSURE;
  }

  function write(hintId: string, exposure: StudioToolHintExposure) {
    if (exposures.has(hintId)) exposures.delete(hintId);
    exposures.set(hintId, exposure);
    while (exposures.size > MAX_TRACKED_HINTS) {
      const oldestHintId = exposures.keys().next().value;
      if (typeof oldestHintId !== "string") break;
      exposures.delete(oldestHintId);
    }
  }

  return {
    canReveal(hintId, intent, now = Date.now()) {
      if (intent !== "hover") return true;
      const exposure = read(hintId);
      if (exposure.automaticRevealCount >= STUDIO_TOOL_HINT_MAX_AUTOMATIC_REVEALS) {
        return false;
      }
      if (
        exposure.lastActivationAt !== null &&
        now - exposure.lastActivationAt < STUDIO_TOOL_HINT_ACTIVATION_COOLDOWN_MS
      ) {
        return false;
      }
      if (
        exposure.lastAutomaticRevealAt !== null &&
        now - exposure.lastAutomaticRevealAt < STUDIO_TOOL_HINT_HOVER_COOLDOWN_MS
      ) {
        return false;
      }
      return true;
    },
    markRevealed(hintId, intent, now = Date.now()) {
      if (intent !== "hover") return;
      const exposure = read(hintId);
      write(hintId, {
        ...exposure,
        automaticRevealCount: exposure.automaticRevealCount + 1,
        lastAutomaticRevealAt: now,
      });
    },
    markActivated(hintId, now = Date.now()) {
      write(hintId, {
        ...read(hintId),
        lastActivationAt: now,
      });
    },
  };
}
