import { describe, expect, it, vi } from "vitest";

import { createStudioLiveTransformDraftStore } from "./studio-live-transform-draft-store";

import type { DrawEl } from "./studio-element-model";

const SCOPE = "page:page-1";

function draw(id = "stroke", points: number[] = [0, 0, 10, 10]): DrawEl {
  return {
    id,
    type: "draw",
    kind: "line",
    points,
    stroke: "#000",
    strokeWidth: 4,
    opacity: 1,
  } as DrawEl;
}

describe("createStudioLiveTransformDraftStore", () => {
  it("reports visible presentation only for the generation that currently owns it", () => {
    const store = createStudioLiveTransformDraftStore();
    const first = store.claim(SCOPE, ["stroke"]);
    expect(first?.hasPresentation()).toBe(false);

    first?.present([{ element: draw(), clip: null }]);
    expect(first?.hasPresentation()).toBe(true);
    expect(first?.clear()).toBe(true);
    expect(first?.hasPresentation()).toBe(false);
    expect(first?.isReleased()).toBe(false);

    first?.present([{ element: draw(), clip: null }]);
    expect(first?.release()).toBe(true);
    expect(first?.hasPresentation()).toBe(false);
    expect(first?.isReleased()).toBe(true);
    const second = store.claim(SCOPE, ["stroke"]);
    second?.present([{ element: draw(), clip: null }]);
    expect(second?.hasPresentation()).toBe(true);
    expect(first?.hasPresentation()).toBe(false);
  });

  it("publishes only the latest immutable snapshot identity to isolated subscribers", () => {
    const store = createStudioLiveTransformDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const claim = store.claim(SCOPE, ["stroke"]);
    expect(claim).not.toBeNull();
    expect(claim?.isReleased()).toBe(false);
    const first = draw("stroke", [0, 0, 20, 20]);
    const second = draw("stroke", [0, 0, 30, 30]);

    claim?.present([{ element: first, clip: null }]);
    claim?.present([{
      element: second,
      clip: { x: 1, y: 2, width: 30, height: 40 },
    }]);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toMatchObject({
      entries: [{ element: second, clip: { x: 1, y: 2, width: 30, height: 40 } }],
      phase: "active",
    });
  });

  it("keeps a terminal draft until the exact authoritative element is acknowledged", () => {
    const store = createStudioLiveTransformDraftStore();
    const release = vi.fn();
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);

    expect(claim?.handoff([terminal], release)).toBe(true);
    expect(store.getSnapshot()?.phase).toBe("handoff");
    expect(store.acknowledgeAuthoritative(SCOPE, [draw("stroke")])).toBe(false);
    expect(release).not.toHaveBeenCalled();

    expect(store.acknowledgeAuthoritative(SCOPE, [terminal])).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(claim?.isReleased()).toBe(true);
  });

  it("retains the handoff callback, snapshot, owner, and timer until source recovery succeeds", () => {
    const timerHandle = 41 as unknown as ReturnType<typeof setTimeout>;
    const scheduleTimeout = vi.fn(() => timerHandle);
    const cancelTimeout = vi.fn();
    const store = createStudioLiveTransformDraftStore({ scheduleTimeout, cancelTimeout });
    const terminal = draw("stroke", [5, 5, 25, 25]);
    let releaseAttempts = 0;
    const release = vi.fn(() => {
      expect(store.getSnapshot()).toMatchObject({
        entries: [{ element: terminal }],
        phase: "handoff",
      });
      releaseAttempts += 1;
      if (releaseAttempts === 1) throw new Error("source raster receipt failed");
    });
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    expect(claim?.handoff([terminal], release)).toBe(true);
    const retained = store.getSnapshot();

    expect(store.acknowledgeAuthoritative(SCOPE, [terminal])).toBe(false);
    expect(store.getSnapshot()).toBe(retained);
    expect(claim?.generation).toBe(1);
    expect(cancelTimeout).not.toHaveBeenCalled();

    expect(store.acknowledgeAuthoritative(SCOPE, [terminal])).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(2);
    expect(cancelTimeout).toHaveBeenCalledExactlyOnceWith(timerHandle);
  });

  it("keeps a persistently failing source recovery retryable and fail-visible", () => {
    const cancelTimeout = vi.fn();
    const store = createStudioLiveTransformDraftStore({
      scheduleTimeout: () => 42 as unknown as ReturnType<typeof setTimeout>,
      cancelTimeout,
    });
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const release = vi.fn(() => {
      throw new Error("source remains unavailable");
    });
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    expect(claim?.handoff([terminal], release)).toBe(true);
    const retained = store.getSnapshot();

    expect(claim?.clear()).toBe(false);
    expect(claim?.release()).toBe(false);
    expect(store.releaseScope(SCOPE)).toBe(false);
    expect(store.acknowledgeAuthoritative(SCOPE, [terminal])).toBe(false);
    expect(store.getSnapshot()).toBe(retained);
    expect(release).toHaveBeenCalledTimes(4);
    expect(cancelTimeout).not.toHaveBeenCalled();
  });

  it("accepts a semantically identical CRDT element with reordered object keys", () => {
    const store = createStudioLiveTransformDraftStore();
    const release = vi.fn();
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const reordered = {
      opacity: terminal.opacity,
      strokeWidth: terminal.strokeWidth,
      stroke: terminal.stroke,
      points: terminal.points,
      kind: terminal.kind,
      type: terminal.type,
      id: terminal.id,
    } as DrawEl;
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    expect(claim?.handoff([terminal], release)).toBe(true);

    expect(store.acknowledgeAuthoritative(SCOPE, [reordered])).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("can acknowledge when the authoritative render precedes the handoff phase", () => {
    const store = createStudioLiveTransformDraftStore();
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const release = vi.fn();
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    // This models a synchronous React/CRDT render that lands before settle().
    expect(store.acknowledgeAuthoritative(SCOPE, [terminal])).toBe(false);
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot()?.phase === "handoff") {
        store.acknowledgeAuthoritative(SCOPE, [terminal]);
      }
    });

    expect(claim?.handoff([terminal], release)).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("releases immediately on rollback, mismatch, or handoff timeout", () => {
    vi.useFakeTimers();
    try {
      const store = createStudioLiveTransformDraftStore({ handoffTimeoutMs: 25 });
      const release = vi.fn();
      const terminal = draw("stroke", [5, 5, 25, 25]);
      const claim = store.claim(SCOPE, ["stroke"]);
      claim?.present([{ element: terminal, clip: null }]);
      expect(claim?.handoff([draw("other")], release)).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);

      const timeoutRelease = vi.fn();
      expect(claim?.handoff([terminal], timeoutRelease)).toBe(true);
      vi.advanceTimersByTime(25);
      expect(store.getSnapshot()).toBeNull();
      expect(timeoutRelease).toHaveBeenCalledTimes(1);

      const clearRelease = vi.fn();
      const nextClaim = store.claim(SCOPE, ["stroke"]);
      nextClaim?.present([{ element: terminal, clip: null }]);
      nextClaim?.handoff([terminal], clearRelease);
      nextClaim?.release();
      nextClaim?.release();
      expect(clearRelease).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back when arming the handoff timer fails", () => {
    const store = createStudioLiveTransformDraftStore({
      scheduleTimeout: () => {
        throw new Error("timer unavailable");
      },
    });
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const release = vi.fn();
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);

    expect(claim?.handoff([terminal], release)).toBe(false);
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("restores ownership even when the host timer canceller throws", () => {
    const store = createStudioLiveTransformDraftStore({
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancelTimeout: () => {
        throw new Error("cancel unavailable");
      },
    });
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const release = vi.fn();
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    expect(claim?.handoff([terminal], release)).toBe(true);

    claim?.release();
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.claim(SCOPE, ["stroke"])).not.toBeNull();
  });

  it("ignores a stale generation after a retained handoff is superseded", () => {
    const store = createStudioLiveTransformDraftStore();
    const first = store.claim(SCOPE, ["stroke"]);
    const firstTerminal = draw("stroke", [1, 1, 11, 11]);
    first?.present([{ element: firstTerminal, clip: null }]);
    first?.handoff([firstTerminal], vi.fn());

    const second = store.claim(SCOPE, ["stroke"]);
    const secondFrame = draw("stroke", [2, 2, 22, 22]);
    second?.present([{ element: secondFrame, clip: null }]);
    first?.release();

    expect(store.getSnapshot()?.entries[0]?.element).toBe(secondFrame);
    expect(first?.isReleased()).toBe(true);
    expect(second?.isReleased()).toBe(false);
    second?.release();
    expect(store.getSnapshot()).toBeNull();
    expect(second?.isReleased()).toBe(true);
  });

  it("refuses supersession until old-source recovery succeeds and fences its stale timer", () => {
    const timerCallbacks: Array<() => void> = [];
    const cancelTimeout = vi.fn();
    const store = createStudioLiveTransformDraftStore({
      scheduleTimeout: (callback) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      // Deliberately leave the callback runnable to model an already-dispatched host timer.
      cancelTimeout,
    });
    const firstTerminal = draw("stroke", [1, 1, 11, 11]);
    let canRestoreFirstSource = false;
    const releaseFirst = vi.fn(() => {
      if (!canRestoreFirstSource) throw new Error("first source receipt failed");
    });
    const first = store.claim(SCOPE, ["stroke"]);
    first?.present([{ element: firstTerminal, clip: null }]);
    expect(first?.handoff([firstTerminal], releaseFirst)).toBe(true);

    const nextScope = "page:page-2";
    expect(store.releaseScope(nextScope)).toBe(false);
    expect(releaseFirst).not.toHaveBeenCalled();
    expect(store.claim(nextScope, ["next-stroke"])).toBeNull();
    expect(store.getSnapshot()).toMatchObject({
      scope: SCOPE,
      entries: [{ element: firstTerminal }],
      phase: "handoff",
    });

    canRestoreFirstSource = true;
    const second = store.claim(nextScope, ["next-stroke"]);
    expect(second?.generation).toBeGreaterThan(first?.generation ?? 0);
    const secondFrame = draw("next-stroke", [2, 2, 22, 22]);
    second?.present([{ element: secondFrame, clip: null }]);

    expect(first?.release()).toBe(false);
    timerCallbacks[0]?.();
    expect(store.getSnapshot()).toMatchObject({
      scope: nextScope,
      entries: [{ element: secondFrame }],
      phase: "active",
    });
    expect(store.releaseScope(SCOPE)).toBe(false);
    expect(store.releaseScope(nextScope)).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(cancelTimeout).toHaveBeenCalledTimes(1);
  });

  it("keeps the terminal draft owned when its timeout recovery throws", () => {
    vi.useFakeTimers();
    try {
      const store = createStudioLiveTransformDraftStore({ handoffTimeoutMs: 25 });
      const terminal = draw("stroke", [5, 5, 25, 25]);
      const release = vi.fn(() => {
        throw new Error("timeout source receipt failed");
      });
      const claim = store.claim(SCOPE, ["stroke"]);
      claim?.present([{ element: terminal, clip: null }]);
      expect(claim?.handoff([terminal], release)).toBe(true);
      const retained = store.getSnapshot();

      vi.advanceTimersByTime(25);

      expect(release).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot()).toBe(retained);
      expect(store.getSnapshot()?.phase).toBe("handoff");
      expect(store.claim("page:page-2", ["next-stroke"])).toBeNull();
      expect(store.getSnapshot()).toBe(retained);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a claim whose set is empty, duplicated, or not a list of ids", () => {
    // `present` and `handoff` both key on the claimed sequence, so a set that cannot be matched
    // positionally has no coherent contract. A bare string is called out because it spreads into
    // characters and would otherwise be accepted or rejected for accidental reasons.
    const store = createStudioLiveTransformDraftStore();
    expect(store.claim(SCOPE, [])).toBeNull();
    expect(store.claim(SCOPE, ["a", "a"])).toBeNull();
    expect(store.claim(SCOPE, [""])).toBeNull();
    expect(store.claim(SCOPE, "stroke" as unknown as string[])).toBeNull();
    // A well-formed set still claims.
    expect(store.claim(SCOPE, ["a", "b"])).not.toBeNull();
  });

  it("releases a terminal handoff only from its owning page/master scope", () => {
    const store = createStudioLiveTransformDraftStore();
    const release = vi.fn();
    const terminal = draw("stroke", [5, 5, 25, 25]);
    const claim = store.claim(SCOPE, ["stroke"]);
    claim?.present([{ element: terminal, clip: null }]);
    expect(claim?.handoff([terminal], release)).toBe(true);

    expect(store.acknowledgeAuthoritative("page:page-2", [terminal])).toBe(false);
    expect(store.releaseScope("page:page-2")).toBe(false);
    expect(store.getSnapshot()?.scope).toBe(SCOPE);
    expect(release).not.toHaveBeenCalled();

    expect(store.releaseScope(SCOPE)).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
