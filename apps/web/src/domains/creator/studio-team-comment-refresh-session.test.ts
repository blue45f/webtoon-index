import { describe, expect, it, vi } from "vitest";

import {
  createStudioTeamCommentRefreshSession,
  type StudioTeamCommentRefreshReason,
} from "./studio-team-comment-refresh-session";

class VisibilityTarget extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Studio team-comment refresh session", () => {
  it("loads once initially and never creates a background polling timer", async () => {
    const visibilityTarget = new VisibilityTarget();
    const onlineTarget = new EventTarget();
    const load = vi.fn(async (
      _signal: AbortSignal,
      _reason: StudioTeamCommentRefreshReason
    ) => undefined);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const session = createStudioTeamCommentRefreshSession({
      load,
      visibilityTarget,
      onlineTarget,
      isOnline: () => true,
    });

    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toBe("initial");
    expect(setIntervalSpy).not.toHaveBeenCalled();
    session.dispose();
    setIntervalSpy.mockRestore();
  });

  it("deduplicates panel, manual, visibility, and online triggers while a load is active", async () => {
    const visibilityTarget = new VisibilityTarget();
    const onlineTarget = new EventTarget();
    const active = deferred();
    const load = vi.fn(() => active.promise);
    const session = createStudioTeamCommentRefreshSession({
      load,
      visibilityTarget,
      onlineTarget,
      isOnline: () => true,
      resumeFreshnessMs: 0,
    });

    expect(session.request("panel-open")).toBe(false);
    expect(session.request("manual")).toBe(false);
    visibilityTarget.visibilityState = "hidden";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    visibilityTarget.visibilityState = "visible";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    onlineTarget.dispatchEvent(new Event("online"));
    expect(load).toHaveBeenCalledTimes(1);

    active.resolve();
    await flushPromises();
    expect(session.request("manual")).toBe(true);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it("defers hidden/offline starts and refreshes once when the scope becomes eligible", async () => {
    const visibilityTarget = new VisibilityTarget();
    visibilityTarget.visibilityState = "hidden";
    const onlineTarget = new EventTarget();
    let online = false;
    const load = vi.fn(async (
      _signal: AbortSignal,
      _reason: StudioTeamCommentRefreshReason
    ) => undefined);
    const session = createStudioTeamCommentRefreshSession({
      load,
      visibilityTarget,
      onlineTarget,
      isOnline: () => online,
      resumeFreshnessMs: 0,
    });
    await flushPromises();
    expect(load).not.toHaveBeenCalled();
    expect(session.request("manual")).toBe(false);

    visibilityTarget.visibilityState = "visible";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    expect(load).not.toHaveBeenCalled();
    online = true;
    onlineTarget.dispatchEvent(new Event("online"));
    onlineTarget.dispatchEvent(new Event("online"));
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toBe("resume");
    session.dispose();
  });

  it("throttles quick resume checks, aborts the scope on dispose, and removes listeners", async () => {
    const visibilityTarget = new VisibilityTarget();
    const onlineTarget = new EventTarget();
    let clock = 100;
    const capturedSignals: AbortSignal[] = [];
    const load = vi.fn(async (signal: AbortSignal) => {
      capturedSignals.push(signal);
    });
    const session = createStudioTeamCommentRefreshSession({
      load,
      visibilityTarget,
      onlineTarget,
      isOnline: () => true,
      now: () => clock,
      resumeFreshnessMs: 15_000,
    });
    await flushPromises();

    visibilityTarget.visibilityState = "hidden";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    clock += 5_000;
    visibilityTarget.visibilityState = "visible";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);

    visibilityTarget.visibilityState = "hidden";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    clock += 15_000;
    visibilityTarget.visibilityState = "visible";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);

    session.dispose();
    expect(capturedSignals.at(-1)?.aborted).toBe(true);
    visibilityTarget.visibilityState = "hidden";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    visibilityTarget.visibilityState = "visible";
    visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    expect(session.request("manual")).toBe(false);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
