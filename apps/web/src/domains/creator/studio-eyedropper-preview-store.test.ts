import { describe, expect, it, vi } from "vitest";

import { createStudioEyedropperPreviewStore } from "./studio-eyedropper-preview-store";

const capture = {
  imageData: { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 },
  sampleX: 0,
  sampleY: 0,
  averageRadius: 0,
  plan: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    sampleX: 0,
    sampleY: 0,
    averageRadius: 0,
    loupeRadius: 0,
    pixelCount: 1,
  },
};

const sample = {
  hex: "#010203",
  rgba: [1, 2, 3, 255] as const,
  sampleCount: 1,
  candidateCount: 1,
  averageRadius: 0,
};

function preview(clientX: number) {
  return {
    pointer: { clientX, clientY: 20, pointerType: "pen" },
    capture,
    sample,
    target: "primary" as const,
    currentTargetColor: "#112233",
    referenceLabel: "표시색",
  };
}

describe("createStudioEyedropperPreviewStore", () => {
  it("coalesces pointer-rate publishes to the latest animation-frame snapshot", () => {
    let scheduled: FrameRequestCallback | null = null;
    const cancel = vi.fn();
    const store = createStudioEyedropperPreviewStore({
      request: (callback) => {
        scheduled = callback;
        return 7;
      },
      cancel,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish(preview(10));
    store.publish(preview(40));
    expect(store.getSnapshot()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    (scheduled as FrameRequestCallback | null)?.(16);

    expect(store.getSnapshot()?.pointer.clientX).toBe(40);
    expect(listener).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("hides immediately and cancels a queued stale pointer frame", () => {
    const cancel = vi.fn();
    const store = createStudioEyedropperPreviewStore({ request: () => 9, cancel });
    store.publish(preview(10));
    store.hide();
    expect(cancel).toHaveBeenCalledWith(9);
    expect(store.getSnapshot()).toBeNull();
  });

  it("stops accepting frames and subscriptions after destroy", () => {
    const cancel = vi.fn();
    const store = createStudioEyedropperPreviewStore({ request: () => 2, cancel });
    store.publish(preview(10));
    store.destroy();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.publish(preview(20));
    unsubscribe();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});
