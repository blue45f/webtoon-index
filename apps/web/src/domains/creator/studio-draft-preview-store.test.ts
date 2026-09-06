import { describe, expect, it, vi } from "vitest";

import { StudioDraftPreviewStore } from "./studio-draft-preview-store";

import type { DrawEl } from "./studio-element-model";

function draw(id: string, overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id,
    mode: "pen",
    points: [0, 0, 10, 10],
    stroke: "#111111",
    strokeWidth: 4,
    type: "draw",
    ...overrides,
  };
}

describe("StudioDraftPreviewStore", () => {
  it("keeps snapshot identity stable for no-ops and emits only for actual active changes", () => {
    const store = new StudioDraftPreviewStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const empty = store.getSnapshot();

    store.setActive(null);
    expect(store.getSnapshot()).toBe(empty);
    expect(listener).not.toHaveBeenCalled();

    const active = draw("active");
    store.setActive(active);
    const changed = store.getSnapshot();
    expect(changed).not.toBe(empty);
    expect(changed).toEqual({ active, settled: [] });
    expect(store.active).toBe(active);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setActive(active);
    expect(store.getSnapshot()).toBe(changed);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("settles in FIFO order and releases only a normalized committed prefix", () => {
    const store = new StudioDraftPreviewStore();
    const first = draw("first");
    const second = draw("second");
    const third = draw("third");

    store.setActive(draw("pending"));
    store.settle(first);
    store.settle(second);
    store.settle(third);
    expect(store.getSnapshot()).toEqual({ active: null, settled: [first, second, third] });
    expect(store.hasSettled).toBe(true);
    expect(store.settledCount).toBe(3);
    expect(store.visibleSettled).toEqual([first, second, third]);

    expect(store.suppressSettledPrefix(2)).toBe(2);
    expect(store.getSnapshot().settled).toEqual([first, second, third]);
    expect(store.visibleSettled).toEqual([third]);

    expect(store.releaseSettledPrefix(Number.NaN)).toBe(0);
    expect(store.releaseSettledPrefix(-1)).toBe(0);
    expect(store.releaseSettledPrefix(1.9)).toBe(1);
    expect(store.getSnapshot().settled).toEqual([second, third]);
    expect(store.visibleSettled).toEqual([third]);

    expect(store.releaseSettledPrefix(99)).toBe(2);
    expect(store.getSnapshot().settled).toEqual([]);
    expect(store.visibleSettled).toEqual([]);
    expect(store.hasSettled).toBe(false);
  });

  it("clears settled drafts or the complete snapshot and removes unsubscribed listeners", () => {
    const store = new StudioDraftPreviewStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.settle(draw("settled"));
    store.setActive(draw("active"));
    store.clearSettled();
    expect(store.getSnapshot()).toEqual({ active: draw("active"), settled: [] });

    store.clear();
    expect(store.getSnapshot()).toEqual({ active: null, settled: [] });
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    store.setActive(draw("after-unsubscribe"));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("replaces a settled authority queue atomically without dropping the active draft", () => {
    const store = new StudioDraftPreviewStore();
    const active = draw("active");
    const first = draw("first");
    const second = draw("second");
    const listener = vi.fn();
    store.subscribe(listener);
    store.setActive(active);

    store.replaceSettled([first, second]);
    expect(store.getSnapshot()).toEqual({ active, settled: [first, second] });
    expect(listener).toHaveBeenCalledTimes(2);

    const snapshot = store.getSnapshot();
    store.replaceSettled(snapshot.settled);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
