import { describe, expect, it } from "vitest";

import {
  computeCreativeWorkStatistics,
  createCreativeWorkTimeTracker,
  evaluateTrackerIdleStatus,
  formatWorkTimeDuration,
  recordCreativeActivity,
} from "./studio-creative-work-time-tracker";

describe("studio-creative-work-time-tracker", () => {
  describe("Tracking active work time", () => {
    it("accumulates active time when user interacts within idle threshold", () => {
      let tracker = createCreativeWorkTimeTracker("project-alpha", 0, 0, 1000);
      expect(tracker.totalWorkTimeSeconds).toBe(0);

      // Activity 10 seconds later
      tracker = recordCreativeActivity(tracker, true, 11000);
      expect(tracker.totalWorkTimeSeconds).toBe(10);
      expect(tracker.sessionWorkTimeSeconds).toBe(10);
      expect(tracker.strokeCount).toBe(1);

      // Activity 5 seconds later
      tracker = recordCreativeActivity(tracker, true, 16000);
      expect(tracker.totalWorkTimeSeconds).toBe(15);
      expect(tracker.strokeCount).toBe(2);
    });

    it("pauses time accumulation when user goes idle for more than threshold", () => {
      let tracker = createCreativeWorkTimeTracker("project-beta", 100, 5, 0, 60); // 60s threshold

      // User draws for 20 seconds
      tracker = recordCreativeActivity(tracker, true, 20000);
      expect(tracker.totalWorkTimeSeconds).toBe(120);

      // User goes away for 300 seconds (5 minutes)
      tracker = evaluateTrackerIdleStatus(tracker, 320000);
      expect(tracker.isIdle).toBe(true);

      // User returns at 320000 ms. The idle 300s should NOT be added!
      tracker = recordCreativeActivity(tracker, true, 320000);
      expect(tracker.totalWorkTimeSeconds).toBe(120); // Not inflated!
      expect(tracker.isIdle).toBe(false);
    });
  });

  describe("Formatting and Statistics", () => {
    it("formats duration into Korean hours/minutes/seconds", () => {
      expect(formatWorkTimeDuration(45)).toBe("45초");
      expect(formatWorkTimeDuration(125)).toBe("2분 5초");
      expect(formatWorkTimeDuration(3665)).toBe("1시간 1분");
      expect(formatWorkTimeDuration(7320)).toBe("2시간 2분");
    });

    it("computes strokes per minute productivity pace", () => {
      let tracker = createCreativeWorkTimeTracker("p1", 0, 0, 0);
      tracker = recordCreativeActivity(tracker, true, 30000); // 30s, 1 stroke
      tracker = recordCreativeActivity(tracker, true, 60000); // 60s, 2 strokes (2 strokes / 1 min = 2 SPM)

      const stats = computeCreativeWorkStatistics(tracker);
      expect(stats.totalDurationFormatted).toBe("1분 0초");
      expect(stats.strokeCount).toBe(2);
      expect(stats.strokesPerMinute).toBeCloseTo(2.0, 0);
    });
  });
});
