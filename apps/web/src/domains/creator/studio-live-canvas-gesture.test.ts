import { describe, expect, it, vi } from "vitest";

import { beginStudioLiveCanvasGesture } from "./studio-live-canvas-gesture";

type Frame = { readonly x: number };

function harness(overrides: {
  acquire?: () => boolean;
  offer?: (frame: Frame) => void;
  close?: () => void;
  commit?: (frame: Frame) => boolean;
  settle?: (committed: boolean) => void | boolean;
} = {}) {
  const events: string[] = [];
  const recoveryQueue: Array<() => void> = [];
  const recoveryDelays: number[] = [];
  const acquire = vi.fn(overrides.acquire ?? (() => {
    events.push("acquire");
    return true;
  }));
  const offer = vi.fn(overrides.offer ?? ((frame: Frame) => {
    events.push(`offer:${frame.x}`);
  }));
  const close = vi.fn(overrides.close ?? (() => {
    events.push("close");
  }));
  const commit = vi.fn(overrides.commit ?? ((frame: Frame) => {
    events.push(`commit:${frame.x}`);
    return true;
  }));
  const settle = vi.fn(overrides.settle ?? ((committed: boolean) => {
    events.push(`settle:${committed}`);
  }));
  const cancel = vi.fn((reason: string) => {
    events.push(`cancel:${reason}`);
  });
  const release = vi.fn(() => {
    events.push("release");
  });
  const onError = vi.fn();
  const result = beginStudioLiveCanvasGesture<Frame>({
    commitPort: { acquire, commit, release, cancel },
    createTransient: () => ({
      offer,
      close,
      settle: ({ committed }) => settle(committed),
    }),
    onError,
    scheduleRecovery: (callback, delayMs) => {
      recoveryQueue.push(callback);
      recoveryDelays.push(delayMs);
    },
  });
  return {
    result,
    events,
    acquire,
    offer,
    close,
    commit,
    settle,
    release,
    cancel,
    onError,
    recoveryQueue,
    recoveryDelays,
    runNextRecovery: () => recoveryQueue.shift()?.(),
  };
}

describe("beginStudioLiveCanvasGesture", () => {
  it("keeps update transient and resolves through close then one durable commit", () => {
    const run = harness();
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    run.result.session.offer({ x: 1 });
    run.result.session.offer({ x: 2 });
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.cancel).not.toHaveBeenCalled();

    expect(run.result.session.finish({ x: 3 })).toBe(true);
    expect(run.result.session.finish({ x: 4 })).toBe(false);
    expect(run.result.session.cancel("escape")).toBe(false);

    expect(run.events).toEqual([
      "acquire",
      "offer:1",
      "offer:2",
      "close",
      "commit:3",
      "settle:true",
      "release",
    ]);
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.cancel).not.toHaveBeenCalled();
    expect(run.release).toHaveBeenCalledTimes(1);
    expect(run.settle).toHaveBeenCalledWith(true);
    expect(run.result.session.isActive()).toBe(false);
  });

  it.each([
    "escape",
    "pointer-cancel",
    "window-blur",
    "document-hidden",
    "selection-changed",
    "source-changed",
    "disabled",
    "unmount",
    "invalid-terminal-frame",
  ] as const)("rolls back %s without a durable commit", (reason) => {
    const run = harness();
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.cancel(reason)).toBe(true);
    expect(run.result.session.cancel(reason)).toBe(false);
    expect(run.close).toHaveBeenCalledWith({ kind: "cancel", reason });
    expect(run.cancel).toHaveBeenCalledWith(reason);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.settle).not.toHaveBeenCalled();
  });

  it("does not claim renderer resources when acquire rejects or throws", () => {
    const rejectedFactory = vi.fn();
    const rejected = beginStudioLiveCanvasGesture<Frame>({
      commitPort: {
        acquire: () => false,
        commit: vi.fn(),
        release: vi.fn(),
        cancel: vi.fn(),
      },
      createTransient: rejectedFactory,
    });
    expect(rejected).toEqual({ ok: false, reason: "rejected" });
    expect(rejectedFactory).not.toHaveBeenCalled();

    const error = new Error("lease failed");
    const onError = vi.fn();
    const throwingFactory = vi.fn();
    const throwing = beginStudioLiveCanvasGesture<Frame>({
      commitPort: {
        acquire: () => {
          throw error;
        },
        commit: vi.fn(),
        release: vi.fn(),
        cancel: vi.fn(),
      },
      createTransient: throwingFactory,
      onError,
    });
    expect(throwing).toEqual({ ok: false, reason: "rejected" });
    expect(throwingFactory).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("releases an acquired lease when renderer claim setup fails", () => {
    const setupError = new Error("claim failed");
    const cancel = vi.fn();
    const onError = vi.fn();
    const result = beginStudioLiveCanvasGesture<Frame>({
      commitPort: { acquire: () => true, commit: vi.fn(), release: vi.fn(), cancel },
      createTransient: () => {
        throw setupError;
      },
      onError,
    });

    expect(result).toEqual({ ok: false, reason: "preview-setup-error" });
    expect(cancel).toHaveBeenCalledWith("preview-error");
    expect(onError).toHaveBeenCalledWith(setupError);
  });

  it("fails closed and retains the adapter until transient cleanup proves rollback", () => {
    const closeError = new Error("rollback failed");
    let shouldFail = true;
    const run = harness({
      close: () => {
        if (shouldFail) {
          shouldFail = false;
          throw closeError;
        }
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(false);
    expect(run.commit).not.toHaveBeenCalled();
    // The durable lease is also the exclusion lock for this renderer claim. It must remain held
    // while close is retryable, otherwise another gesture can race the old recovery.
    expect(run.cancel).not.toHaveBeenCalled();
    expect(run.settle).not.toHaveBeenCalled();
    expect(run.onError).toHaveBeenCalledWith(closeError);
    expect(run.recoveryQueue).toHaveLength(1);

    run.runNextRecovery();
    expect(run.close).toHaveBeenCalledTimes(2);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(run.cancel).toHaveBeenCalledWith("preview-error");
    expect(run.settle).toHaveBeenCalledWith(false);
    expect(run.events.slice(-2)).toEqual(["settle:false", "cancel:preview-error"]);
    expect(run.recoveryQueue).toHaveLength(0);
  });

  it("retains a cancelled renderer claim until its retryable close succeeds", () => {
    let closeAttempt = 0;
    const run = harness({
      close: () => {
        closeAttempt += 1;
        if (closeAttempt <= 2) throw new Error("cancel close failed");
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.cancel("escape")).toBe(true);
    expect(run.cancel).not.toHaveBeenCalled();
    expect(run.recoveryQueue).toHaveLength(1);
    expect(run.recoveryDelays).toEqual([16]);
    run.runNextRecovery();
    expect(run.recoveryQueue).toHaveLength(1);
    expect(run.recoveryDelays).toEqual([16, 32]);
    expect(run.cancel).not.toHaveBeenCalled();
    run.runNextRecovery();
    expect(run.close).toHaveBeenCalledTimes(3);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(run.cancel).toHaveBeenCalledWith("escape");
    expect(run.recoveryQueue).toHaveLength(0);
  });

  it("keeps cancellation lease through settlement after a recovered commit-close", () => {
    let closeAttempt = 0;
    let settleAttempt = 0;
    const run = harness({
      close: () => {
        closeAttempt += 1;
        if (closeAttempt === 1) throw new Error("commit close failed");
      },
      settle: () => {
        settleAttempt += 1;
        if (settleAttempt === 1) throw new Error("rollback settlement failed");
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(false);
    expect(run.cancel).not.toHaveBeenCalled();

    // First recovery closes renderer ownership, but failed settlement still owns the terminal
    // draft/source handoff. The page lease must remain held across that second recovery queue.
    run.runNextRecovery();
    expect(run.close).toHaveBeenCalledTimes(2);
    expect(run.settle).toHaveBeenCalledTimes(1);
    expect(run.cancel).not.toHaveBeenCalled();
    expect(run.recoveryQueue).toHaveLength(1);

    run.runNextRecovery();
    expect(run.settle).toHaveBeenCalledTimes(2);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(run.cancel).toHaveBeenCalledWith("preview-error");
    expect(run.recoveryQueue).toHaveLength(0);
  });

  it("retains and retries a failed settlement after the durable commit", () => {
    let settleAttempt = 0;
    const settlementError = new Error("handoff failed");
    const run = harness({
      settle: () => {
        settleAttempt += 1;
        if (settleAttempt === 1) throw settlementError;
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(true);
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.release).not.toHaveBeenCalled();
    expect(run.onError).toHaveBeenCalledWith(settlementError);
    expect(run.recoveryQueue).toHaveLength(1);
    run.runNextRecovery();
    expect(run.settle).toHaveBeenCalledTimes(2);
    expect(run.release).toHaveBeenCalledTimes(1);
    expect(run.recoveryQueue).toHaveLength(0);
  });

  it("treats a false settlement receipt as pending and retains writer exclusion", () => {
    let authoritativeReceipt = false;
    const run = harness({
      settle: () => authoritativeReceipt,
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(true);
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.release).not.toHaveBeenCalled();
    expect(run.recoveryQueue).toHaveLength(1);

    // Retrying before the authoritative receipt may poll, but must not release the writer lease.
    run.runNextRecovery();
    expect(run.release).not.toHaveBeenCalled();
    expect(run.recoveryQueue).toHaveLength(1);

    authoritativeReceipt = true;
    run.runNextRecovery();
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.release).toHaveBeenCalledTimes(1);
    expect(run.recoveryQueue).toHaveLength(0);
  });

  it("cancels immediately if a transient update throws", () => {
    const offerError = new Error("renderer failed");
    const run = harness({
      offer: () => {
        throw offerError;
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    run.result.session.offer({ x: 1 });

    expect(run.result.session.isActive()).toBe(false);
    expect(run.close).toHaveBeenCalledWith({
      kind: "cancel",
      reason: "preview-error",
    });
    expect(run.cancel).toHaveBeenCalledWith("preview-error");
    expect(run.commit).not.toHaveBeenCalled();
    expect(run.onError).toHaveBeenCalledWith(offerError);
  });

  it("reports a non-throwing commit rejection without a second durable attempt", () => {
    const run = harness({ commit: () => false });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(false);
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.cancel).not.toHaveBeenCalled();
    expect(run.release).toHaveBeenCalledTimes(1);
    expect(run.settle).toHaveBeenCalledWith(false);
    expect(run.result.session.finish({ x: 4 })).toBe(false);
  });

  it("best-effort releases the acquired port when commit throws", () => {
    const commitError = new Error("commit failed before release");
    const run = harness({
      commit: () => {
        throw commitError;
      },
    });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;

    expect(run.result.session.finish({ x: 3 })).toBe(false);
    expect(run.commit).toHaveBeenCalledTimes(1);
    expect(run.cancel).toHaveBeenCalledWith("commit-error");
    expect(run.release).not.toHaveBeenCalled();
    expect(run.settle).toHaveBeenCalledWith(false);
    expect(run.onError).toHaveBeenCalledWith(commitError);
  });
});
