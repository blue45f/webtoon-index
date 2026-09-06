import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioLiveCursorQuality,
  getStudioLiveCursorQualitySnapshot,
  presentStudioLiveCursorQuality,
  publishStudioLiveCursorQuality,
  resetStudioLiveCursorQualityForTests,
  resolveStudioLiveCursorCadence,
  subscribeStudioLiveCursorQuality,
} from "./studio-live-cursor-quality";

afterEach(() => {
  resetStudioLiveCursorQualityForTests();
});

describe("resolveStudioLiveCursorCadence", () => {
  it("keeps active drawing near a frame cadence in a small room", () => {
    expect(resolveStudioLiveCursorCadence({
      drawing: true,
      peerCount: 3,
      visibility: "visible",
      network: { saveData: false, effectiveType: "4g" },
    })).toEqual({
      cadenceMs: 16,
      compactPoints: false,
      tier: "live",
      reason: "drawing",
    });
  });

  it("bounds fan-out and compacts disposable trails for large rooms", () => {
    expect(resolveStudioLiveCursorCadence({
      drawing: false,
      peerCount: 80,
      visibility: "visible",
      network: { saveData: false, effectiveType: "4g" },
    })).toEqual({
      cadenceMs: 72,
      compactPoints: true,
      tier: "balanced",
      reason: "large-room",
    });
  });

  it("prioritizes save-data and background constraints", () => {
    expect(resolveStudioLiveCursorCadence({
      drawing: true,
      peerCount: 2,
      visibility: "visible",
      network: { saveData: true, effectiveType: "4g" },
    })).toMatchObject({ cadenceMs: 96, compactPoints: true, tier: "constrained" });

    expect(resolveStudioLiveCursorCadence({
      drawing: false,
      peerCount: 2,
      visibility: "hidden",
      network: { saveData: false, effectiveType: null },
    })).toMatchObject({ cadenceMs: 250, reason: "background" });
  });
});

describe("studio live cursor quality store", () => {
  it("notifies only the scoped work and clears its lifecycle snapshot", () => {
    const workOneListener = vi.fn();
    const workTwoListener = vi.fn();
    const unsubscribeOne = subscribeStudioLiveCursorQuality("work-1", workOneListener);
    const unsubscribeTwo = subscribeStudioLiveCursorQuality("work-2", workTwoListener);
    const snapshot = {
      workId: "work-1",
      cadenceMs: 64,
      compactPoints: true,
      tier: "balanced" as const,
      reason: "slow-network" as const,
      peerCount: 4,
      pending: false,
      acceptedCount: 5,
      sentCount: 3,
      coalescedCount: 2,
      compactedCount: 1,
      failedCount: 0,
      updatedAt: 1_000,
    };

    publishStudioLiveCursorQuality(snapshot);
    expect(getStudioLiveCursorQualitySnapshot("work-1")).toEqual(snapshot);
    expect(workOneListener).toHaveBeenCalledTimes(1);
    expect(workTwoListener).not.toHaveBeenCalled();
    expect(presentStudioLiveCursorQuality(snapshot)).toMatchObject({
      shortLabel: "커서 균형",
      tone: "cool",
    });

    clearStudioLiveCursorQuality("work-1");
    expect(getStudioLiveCursorQualitySnapshot("work-1")).toBeNull();
    expect(workOneListener).toHaveBeenCalledTimes(2);
    unsubscribeOne();
    unsubscribeTwo();
  });
});
