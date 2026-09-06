/**
 * Per-stroke cache for object-snap target bboxes.
 *
 * Shape/line placement can sample pointermove dozens of times per second. Re-walking every
 * document element and calling Konva `getClientRect` on each frame is O(elements) × rate.
 * Targets are frozen for the contact: other layers do not move while the active stroke owns
 * the pointer, so one collection per strokeId is correct and much cheaper on dense pages.
 */

import type { GuideBox } from "../studio-smart-guides";

export interface StudioStrokeObjectSnapCache {
  readonly strokeId: string;
  readonly targets: readonly GuideBox[];
}

/**
 * Returns cached targets when the active stroke id matches; otherwise runs `collect` once and
 * stores the result under that stroke id.
 */
export function resolveStudioStrokeObjectSnapTargets(input: {
  readonly cache: StudioStrokeObjectSnapCache | null;
  readonly strokeId: string;
  readonly collect: () => readonly GuideBox[];
}): {
  readonly targets: readonly GuideBox[];
  readonly cache: StudioStrokeObjectSnapCache;
  readonly collected: boolean;
} {
  if (input.cache && input.cache.strokeId === input.strokeId) {
    return {
      targets: input.cache.targets,
      cache: input.cache,
      collected: false,
    };
  }
  const targets = input.collect();
  const cache: StudioStrokeObjectSnapCache = {
    strokeId: input.strokeId,
    targets,
  };
  return { targets, cache, collected: true };
}
