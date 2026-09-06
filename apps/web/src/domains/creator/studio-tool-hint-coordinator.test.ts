import { describe, expect, it, vi } from "vitest";

import { createStudioToolHintCoordinator } from "./studio-tool-hint-coordinator";

describe("Studio tool hint coordinator", () => {
  it("atomically transfers the single active lease to the latest target", () => {
    const coordinator = createStudioToolHintCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    expect(coordinator.claim("pen")).toBeNull();
    expect(coordinator.getActiveHintId()).toBe("pen");
    expect(coordinator.claim("eraser")).toBe("pen");
    expect(coordinator.getActiveHintId()).toBe("eraser");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale delayed release from the previous target", () => {
    const coordinator = createStudioToolHintCoordinator();
    coordinator.claim("pen");
    coordinator.claim("eraser");

    expect(coordinator.release("pen")).toBe(false);
    expect(coordinator.getActiveHintId()).toBe("eraser");
    expect(coordinator.release("eraser")).toBe(true);
    expect(coordinator.getActiveHintId()).toBeNull();
  });

  it("does not notify again when the current target refreshes its lease", () => {
    const coordinator = createStudioToolHintCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    coordinator.claim("pen");
    expect(coordinator.claim("pen")).toBe("pen");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("increments the dismissal epoch without an open hint when pending intent must be cancelled", () => {
    const coordinator = createStudioToolHintCoordinator();
    coordinator.markPending("pen");

    expect(coordinator.dismissAll()).toBe(1);
    expect(coordinator.getActiveHintId()).toBeNull();
    expect(coordinator.getDismissEpoch()).toBe(1);
    expect(coordinator.dismissAll()).toBe(1);
    expect(coordinator.getDismissEpoch()).toBe(1);
  });

  it("invalidates every older pending intent when a newer target claims the lane", () => {
    const coordinator = createStudioToolHintCoordinator();
    coordinator.markPending("hovered-pen");

    coordinator.claim("focused-eraser");

    expect(coordinator.getActiveHintId()).toBe("focused-eraser");
    expect(coordinator.clearPending("hovered-pen")).toBe(false);
  });
});
