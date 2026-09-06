/**
 * Shared fixtures for the living-ink settled-bake suites.
 *
 * Outside a `.test.ts` file so that more than one suite can use them, which is what lets the
 * PROCESS-COLD enqueue measurement live in its own module process. `resetStudioLivingInkSettledBakeCacheForTests`
 * clears the memo and the scheduler latch, but it cannot clear module-level or JIT
 * initialisation, so a minimum over repeated probes is a steady-state statistic however many
 * times the cache is reset. Vitest isolates modules per file; a separate file is the enforcement.
 */
import { STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS } from "./studio-living-ink-settled-bake-v1";

import type { WatercolorBrushDab } from "./brush/studio-watercolor-brush";

export const PLANNER_DAB_CAP = 8_192;

export const SETTLED_SUMI = {
  ...STUDIO_LIVING_INK_SETTLED_BAKE_PROGRAMS["sumi-flow-bake"],
  seed: 4242,
  phase: "settled",
} as const;

export function makePlan(stations: number): WatercolorBrushDab[] {
  const dabs: WatercolorBrushDab[] = [];
  for (let index = 0; index < stations; index += 1) {
    const t = index / Math.max(1, stations - 1);
    const x = 40 + t * 900 + Math.sin(t * 19) * 30;
    const y = 300 + Math.sin(t * 6.2) * 140;
    const radius = 6 + Math.sin(t * 12) * 2.5;
    dabs.push({ x, y, radius, opacity: 0.42, role: "core" });
    dabs.push({
      x: x + 1.5,
      y: y - 1,
      radius: radius * 1.7,
      opacity: 0.18,
      role: "diffuse",
    });
  }
  return dabs;
}

export type TimeoutLike = typeof globalThis.setTimeout;

export function captureScheduledSlices(): {
  runNextSlice: () => number | null;
  restore: () => void;
} {
  const queue: Array<() => void> = [];
  const original = globalThis.setTimeout;
  const capture = ((handler: () => void) => {
    queue.push(handler);
    return 0 as unknown as ReturnType<TimeoutLike>;
  }) as unknown as TimeoutLike;
  globalThis.setTimeout = capture;
  return {
    runNextSlice: () => {
      const slice = queue.shift();
      if (!slice) return null;
      const startedAt = performance.now();
      slice();
      return performance.now() - startedAt;
    },
    restore: () => {
      globalThis.setTimeout = original;
    },
  };
}
