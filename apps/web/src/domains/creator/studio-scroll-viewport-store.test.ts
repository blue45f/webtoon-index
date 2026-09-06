import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_SCROLL_VIEWPORT_ORIGIN,
  createStudioScrollViewportStore,
  planStudioScrollViewportCommit,
  studioScrollViewportsEqual,
  type StudioScrollViewport,
} from "./studio-scroll-viewport-store";

const box: StudioScrollViewport = {
  left: 0,
  top: 0,
  width: 900,
  height: 1000,
  scrollWidth: 900,
  scrollHeight: 1400,
};

describe("studio scroll viewport store", () => {
  it("keeps snapshot identity stable so useSyncExternalStore does not loop", () => {
    const store = createStudioScrollViewportStore(box);
    const first = store.getSnapshot();
    expect(store.publish({ ...box })).toBe(false);
    expect(store.getSnapshot()).toBe(first);
  });

  it("notifies subscribers only when the viewport actually moved", () => {
    const store = createStudioScrollViewportStore(box);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.publish({ ...box })).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(store.publish({ ...box, top: 40 })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().top).toBe(40);

    unsubscribe();
    store.publish({ ...box, top: 80 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("starts from a zeroed origin that compares equal to itself", () => {
    const store = createStudioScrollViewportStore();
    expect(studioScrollViewportsEqual(store.getSnapshot(), STUDIO_SCROLL_VIEWPORT_ORIGIN)).toBe(true);
  });
});

describe("planStudioScrollViewportCommit", () => {
  it("does nothing when the viewport is unchanged", () => {
    expect(planStudioScrollViewportCommit(box, { ...box })).toBe("none");
  });

  it("keeps a pan frame off React — scroll-offset-only changes stay live", () => {
    // This is the contract the measured pan regression violated: 40 pointer
    // moves must not produce 40 StudioPage commits.
    expect(planStudioScrollViewportCommit(box, { ...box, left: 12 })).toBe("live");
    expect(planStudioScrollViewportCommit(box, { ...box, top: 12 })).toBe("live");
    expect(planStudioScrollViewportCommit(box, { ...box, left: 12, top: 9 })).toBe("live");
  });

  it("commits immediately when the viewport box itself changes", () => {
    // Resize, panel toggle, zoom relayout and rotation all move page layout that
    // is derived from these fields, so they must not wait for a settle timer.
    expect(planStudioScrollViewportCommit(box, { ...box, width: 700 })).toBe("immediate");
    expect(planStudioScrollViewportCommit(box, { ...box, height: 700 })).toBe("immediate");
    expect(planStudioScrollViewportCommit(box, { ...box, scrollWidth: 4620 })).toBe("immediate");
    expect(planStudioScrollViewportCommit(box, { ...box, scrollHeight: 6930 })).toBe("immediate");
  });

  it("commits immediately when a box change arrives together with a scroll move", () => {
    expect(
      planStudioScrollViewportCommit(box, { ...box, left: 40, scrollWidth: 4620 }),
    ).toBe("immediate");
  });

  it("commits the first real measurement taken from the zeroed origin", () => {
    expect(planStudioScrollViewportCommit(STUDIO_SCROLL_VIEWPORT_ORIGIN, box)).toBe("immediate");
  });
});
