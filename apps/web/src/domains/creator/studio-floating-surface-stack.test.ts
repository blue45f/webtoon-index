import { afterEach, describe, expect, it } from "vitest";

import {
  bringStudioFloatingSurfaceToFront,
  registerStudioFloatingSurface,
  resetStudioFloatingSurfaceStackForTest,
  studioFloatingSurfaceZIndex,
  studioFloatingSurfaceStackSnapshot,
  subscribeStudioFloatingSurfaceStack,
  requestStudioFloatingSurfaceLayoutReset,
  subscribeStudioFloatingSurfaceLayoutReset,
} from "./studio-floating-surface-stack";

afterEach(resetStudioFloatingSurfaceStackForTest);

describe("studio floating surface stack", () => {
  it("orders newly mounted and explicitly focused surfaces below transient popover z-index 70", () => {
    const releaseA = registerStudioFloatingSurface("surface-a");
    const releaseB = registerStudioFloatingSurface("surface-b");

    expect(studioFloatingSurfaceZIndex("surface-b"))
      .toBeGreaterThan(studioFloatingSurfaceZIndex("surface-a"));
    expect(studioFloatingSurfaceZIndex("surface-b")).toBeLessThan(70);

    bringStudioFloatingSurfaceToFront("surface-a");
    expect(studioFloatingSurfaceZIndex("surface-a"))
      .toBeGreaterThan(studioFloatingSurfaceZIndex("surface-b"));

    releaseA();
    releaseB();
  });

  it("reference-counts duplicate stable ids and publishes only visible-order changes", () => {
    let notifications = 0;
    const unsubscribe = subscribeStudioFloatingSurfaceStack(() => {
      notifications += 1;
    });
    const before = studioFloatingSurfaceStackSnapshot();
    const releaseFirst = registerStudioFloatingSurface("shared");
    const afterFirst = studioFloatingSurfaceStackSnapshot();
    const releaseSecond = registerStudioFloatingSurface("shared");

    expect(afterFirst).toBeGreaterThan(before);
    expect(studioFloatingSurfaceStackSnapshot()).toBe(afterFirst);
    releaseFirst();
    expect(studioFloatingSurfaceStackSnapshot()).toBe(afterFirst);
    releaseSecond();
    expect(studioFloatingSurfaceStackSnapshot()).toBeGreaterThan(afterFirst);
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it("keeps the newest twenty surfaces strictly ordered and bounds older windows to the floor", () => {
    const releases = Array.from({ length: 36 }, (_, index) =>
      registerStudioFloatingSurface(`surface-${index}`),
    );

    expect(studioFloatingSurfaceZIndex("surface-35")).toBe(69);
    expect(studioFloatingSurfaceZIndex("surface-34")).toBe(68);
    expect(studioFloatingSurfaceZIndex("surface-0")).toBe(50);
    expect(studioFloatingSurfaceZIndex("surface-5")).toBe(50);

    for (const release of releases) release();
  });
});

describe("global layout reset broadcast", () => {
  it("asks every subscriber once and survives one unsubscribing mid-broadcast", () => {
    const calls: string[] = [];
    const unsubscribeA = subscribeStudioFloatingSurfaceLayoutReset(() => {
      calls.push("a");
      // A surface may unmount as a direct result of resetting; the broadcast must survive it.
      unsubscribeA();
    });
    const unsubscribeB = subscribeStudioFloatingSurfaceLayoutReset(() => calls.push("b"));

    requestStudioFloatingSurfaceLayoutReset();
    expect(calls).toEqual(["a", "b"]);

    requestStudioFloatingSurfaceLayoutReset();
    expect(calls).toEqual(["a", "b", "b"]);
    unsubscribeB();
  });

  it("stops calling a listener once it unsubscribes", () => {
    let seen = 0;
    const unsubscribe = subscribeStudioFloatingSurfaceLayoutReset(() => { seen += 1; });
    requestStudioFloatingSurfaceLayoutReset();
    unsubscribe();
    requestStudioFloatingSurfaceLayoutReset();
    expect(seen).toBe(1);
  });
});
