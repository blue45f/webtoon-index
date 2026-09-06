import type { StudioReleaseSchedule } from "./studio-release-schedule";

export interface StudioReleaseScheduleRuntime {
  normalizeStudioReleaseSchedule: (value: unknown) => StudioReleaseSchedule;
}

let runtimePromise: Promise<StudioReleaseScheduleRuntime> | null = null;

/**
 * Keeps the full release planner (schema, time-zone validation, iCalendar helpers) out of the
 * Studio route's initial graph. Project hydration and the publication workspace share one
 * retryable request once schedule data is actually needed.
 */
export function loadStudioReleaseScheduleRuntime(): Promise<StudioReleaseScheduleRuntime> {
  if (runtimePromise) return runtimePromise;

  const request = import("./studio-release-schedule")
    .then(({ normalizeStudioReleaseSchedule }) => ({ normalizeStudioReleaseSchedule }))
    .catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  runtimePromise = request;
  return request;
}

export function preloadStudioReleaseScheduleRuntime(): void {
  void loadStudioReleaseScheduleRuntime();
}

/** A fresh, schema-valid blank value without loading the optional planning engine. */
export function createEmptyStudioReleaseScheduleSnapshot(): StudioReleaseSchedule {
  return { version: 1, items: [] };
}
