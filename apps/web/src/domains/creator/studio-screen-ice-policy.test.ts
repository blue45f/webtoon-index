import { describe, expect, it, vi } from "vitest";

import {
  acquireStudioScreenIcePolicyLease,
  StudioScreenIcePolicySession,
} from "./studio-screen-ice-policy";

import type { StudioScreenIcePolicyLease } from "./studio-screen-ice-policy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeLease(mode: "direct" | "stun" | "turn" = "turn") {
  const listeners = new Set<() => void>();
  return {
    lease: {
      mode,
      createPeerConnection: vi.fn(
        () => ({ connectionState: "new" }) as unknown as RTCPeerConnection
      ),
      subscribeConfigurationChange: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      close: vi.fn(),
    } satisfies StudioScreenIcePolicyLease,
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

describe("studio screen ICE policy", () => {
  it("injects authenticated TURN configuration into screen-share peer connections", async () => {
    const createPeerConnection = vi.fn(
      () => ({ connectionState: "new" }) as unknown as RTCPeerConnection
    );
    const lease = await acquireStudioScreenIcePolicyLease("screen-work-a", {
      loadPolicy: async () => ({
        version: 1,
        mode: "turn",
        iceServers: [{
          urls: ["turn:screen.example.com?transport=udp"],
          username: "expires:opaque-user",
          credential: "temporary-credential",
          credentialType: "password",
        }],
        issuedAt: "2026-07-20T00:00:00.000Z",
        expiresAt: "2026-07-20T00:15:00.000Z",
        ttlSeconds: 900,
      }),
      createPeerConnection,
      now: () => 1_000,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: vi.fn(),
    });

    expect(lease.mode).toBe("turn");
    lease.createPeerConnection();
    expect(createPeerConnection).toHaveBeenCalledWith({
      iceServers: [{
        urls: ["turn:screen.example.com?transport=udp"],
        username: "expires:opaque-user",
        credential: "temporary-credential",
        credentialType: "password",
      }],
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
    });
    lease.close();
  });

  it("keeps the injectable loader seam for cancellation and boundary tests", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const loadPolicy = vi.fn();

    await expect(acquireStudioScreenIcePolicyLease("screen-work-b", {
      signal: abortController.signal,
      loadPolicy,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadPolicy).not.toHaveBeenCalled();
  });

  it("does no policy I/O until the first explicit screen action", () => {
    const acquireLease = vi.fn();
    const session = new StudioScreenIcePolicySession("screen-work-lazy", { acquireLease });

    expect(acquireLease).not.toHaveBeenCalled();
    expect(session.mode).toBeNull();
    session.close();
  });

  it("coalesces concurrent activation and releases the refresh lease when idle", async () => {
    const pending = deferred<StudioScreenIcePolicyLease>();
    const acquireLease = vi.fn(() => pending.promise);
    const current = fakeLease("turn");
    const session = new StudioScreenIcePolicySession("screen-work-shared", { acquireLease });

    const first = session.ensureActive();
    const second = session.ensureActive();
    const third = session.ensureActive();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(acquireLease).toHaveBeenCalledTimes(1);
    pending.resolve(current.lease);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(session.mode).toBe("turn");
    session.createPeerConnection();
    expect(current.lease.createPeerConnection).toHaveBeenCalledOnce();

    session.release();
    expect(current.lease.close).toHaveBeenCalledOnce();
    expect(session.mode).toBeNull();
    session.close();
  });

  it("closes a late lease after release and permits a clean retry", async () => {
    const firstPending = deferred<StudioScreenIcePolicyLease>();
    const firstLease = fakeLease("turn");
    const secondLease = fakeLease("stun");
    const acquireLease = vi
      .fn<() => Promise<StudioScreenIcePolicyLease>>()
      .mockReturnValueOnce(firstPending.promise)
      .mockResolvedValueOnce(secondLease.lease);
    const session = new StudioScreenIcePolicySession("screen-work-generation", { acquireLease });

    const staleActivation = session.ensureActive();
    session.release();
    firstPending.resolve(firstLease.lease);
    await expect(staleActivation).rejects.toMatchObject({ name: "AbortError" });
    expect(firstLease.lease.close).toHaveBeenCalledOnce();

    await expect(session.ensureActive()).resolves.toBeUndefined();
    expect(acquireLease).toHaveBeenCalledTimes(2);
    expect(session.mode).toBe("stun");
    session.close();
  });

  it("does not cache a failed activation and forwards active configuration changes", async () => {
    const current = fakeLease("turn");
    const acquireLease = vi
      .fn<() => Promise<StudioScreenIcePolicyLease>>()
      .mockRejectedValueOnce(new Error("temporary unavailable"))
      .mockResolvedValueOnce(current.lease);
    const session = new StudioScreenIcePolicySession("screen-work-retry", { acquireLease });
    const listener = vi.fn();
    session.subscribeConfigurationChange(listener);

    await expect(session.ensureActive()).rejects.toThrow("temporary unavailable");
    await expect(session.ensureActive()).resolves.toBeUndefined();
    current.notify();

    expect(acquireLease).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledOnce();
    session.close();
  });
});
