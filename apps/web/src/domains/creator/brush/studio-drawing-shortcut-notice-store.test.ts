import { describe, expect, it, vi } from "vitest";

import { createStudioDrawingShortcutNoticeStore } from "./studio-drawing-shortcut-notice-store";

describe("studio drawing shortcut notice store", () => {
  it("keeps snapshots stable and does not extend a duplicate active notice", () => {
    const store = createStudioDrawingShortcutNoticeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot()).toBeNull();
    const first = store.publish("혼합(스머지) · 이미지 위를 드래그하세요");

    expect(first).toEqual({
      id: 1,
      message: "혼합(스머지) · 이미지 위를 드래그하세요",
    });
    expect(store.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.publish(first!.message)).toBeNull();
    expect(store.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("uses notice ids to keep stale dismissals from clearing a newer message", () => {
    const store = createStudioDrawingShortcutNoticeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const first = store.publish("첫 알림");
    const second = store.publish("둘째 알림");

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
    expect(store.clear(first!.id)).toBe(false);
    expect(store.getSnapshot()).toBe(second);
    expect(listener).toHaveBeenCalledTimes(2);

    expect(store.clear(second!.id)).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    const repeatedAfterDismissal = store.publish("둘째 알림");
    expect(repeatedAfterDismissal?.id).toBe(3);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    expect(store.clear(repeatedAfterDismissal!.id)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
