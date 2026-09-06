// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useStudioLiveTransportAuth,
  type StudioLiveTransportAuthDependencies,
  type StudioLiveTransportAuthInput,
} from "./use-studio-live-transport-auth";

import type { StudioLiveTransportFactory } from "./studio-live-collaboration-transport";
import type { createStudioServerLiveTransportFactory } from "./studio-live-socket-transport";
import type { StudioLiveAuthTicketResponse } from "../../../shared/lib/studio-live-auth-ticket";

// The Socket.IO transport is deliberately not part of the eager Studio graph. This mock stands in
// for the chunk the hook fetches on demand; it is only reached by the tests that leave
// `createServerFactory` out of the injected dependencies.
const deferredTransport = vi.hoisted(() => ({
  importCount: 0,
  credentials: [] as string[],
}));

vi.mock("./studio-live-socket-transport", () => {
  deferredTransport.importCount += 1;
  return {
    createStudioServerLiveTransportFactory: (credential: string) => {
      deferredTransport.credentials.push(credential);
      return (() => {
        throw new Error("The deferred transport must not open a real socket in tests.");
      }) as unknown as StudioLiveTransportFactory;
    },
  };
});

function ticket(sequence: number): StudioLiveAuthTicketResponse {
  const issuedAt = new Date(1_800_000_000_000 + sequence * 60_000);
  return {
    version: 1,
    ticket: `header-${sequence}.payload-${sequence}.signature-${sequence}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
  };
}

function harness() {
  const factories: StudioLiveTransportFactory[] = [];
  const refreshers: Array<() => Promise<string>> = [];
  const requestTicket = vi.fn<
    StudioLiveTransportAuthDependencies["requestTicket"] & NonNullable<unknown>
  >();
  const createServerFactory = vi.fn((
    _credential: string,
    dependencies?: Parameters<typeof createStudioServerLiveTransportFactory>[1],
  ) => {
    const factory = vi.fn() as unknown as StudioLiveTransportFactory;
    factories.push(factory);
    if (dependencies?.refreshSocketCredential) {
      refreshers.push(dependencies.refreshSocketCredential);
    }
    return factory;
  }) as typeof createStudioServerLiveTransportFactory;
  const createGuestCredential = vi.fn(() =>
    "guest:v1:7a75f75a-4abc-4def-8abc-04c9e58a52f1"
  );
  const dependencies: StudioLiveTransportAuthDependencies = {
    requestTicket,
    createServerFactory,
    createGuestCredential,
  };
  return {
    createGuestCredential,
    createServerFactory,
    dependencies,
    factories,
    refreshers,
    requestTicket,
  };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useStudioLiveTransportAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not create a guest identity until server authentication is authoritative", async () => {
    const live = harness();
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, live.dependencies),
      { initialProps: { authReady: false, userId: null } },
    );

    expect(hook.result.current).toBeUndefined();
    expect(live.createGuestCredential).not.toHaveBeenCalled();

    hook.rerender({ authReady: true, userId: null });
    await flushPromises();

    expect(hook.result.current).toBe(live.factories[0]);
    expect(live.createGuestCredential).toHaveBeenCalledOnce();
    expect(live.requestTicket).not.toHaveBeenCalled();
  });

  it("keeps the same room transport factory after the 60-second seed ticket expires", async () => {
    const live = harness();
    live.requestTicket.mockResolvedValue(ticket(1));
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, live.dependencies),
      { initialProps: { authReady: true, userId: "artist-1" } },
    );

    await flushPromises();
    const initialFactory = hook.result.current;
    expect(initialFactory).toBe(live.factories[0]);
    expect(live.requestTicket).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    hook.rerender({ authReady: true, userId: "artist-1" });
    await flushPromises();

    expect(hook.result.current).toBe(initialFactory);
    expect(live.createServerFactory).toHaveBeenCalledOnce();
    expect(live.requestTicket).toHaveBeenCalledOnce();
  });

  it("recovers an initial ticket failure with bounded automatic retry", async () => {
    const live = harness();
    live.requestTicket
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ticket(2));
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, live.dependencies),
      { initialProps: { authReady: true, userId: "artist-2" } },
    );

    await flushPromises();
    expect(hook.result.current).toBeUndefined();
    expect(live.requestTicket).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await flushPromises();
    expect(hook.result.current).toBe(live.factories[0]);
    expect(live.requestTicket).toHaveBeenCalledTimes(2);
  });

  it.each(["online", "focus"])(
    "restarts a bounded issuance sequence on %s recovery",
    async (eventName) => {
      const live = harness();
      live.requestTicket
        .mockRejectedValueOnce(new TypeError("offline-1"))
        .mockRejectedValueOnce(new TypeError("offline-2"))
        .mockRejectedValueOnce(new TypeError("offline-3"))
        .mockRejectedValueOnce(new TypeError("offline-4"))
        .mockRejectedValueOnce(new TypeError("offline-5"))
        .mockResolvedValueOnce(ticket(3));
      const hook = renderHook(
        (input: StudioLiveTransportAuthInput) =>
          useStudioLiveTransportAuth(input, live.dependencies),
        { initialProps: { authReady: true, userId: "artist-3" } },
      );

      await flushPromises();
      for (const delay of [500, 1_000, 2_000, 4_000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }
      expect(live.requestTicket).toHaveBeenCalledTimes(5);
      expect(hook.result.current).toBeUndefined();

      globalThis.dispatchEvent(new Event(eventName));
      await flushPromises();

      expect(live.requestTicket).toHaveBeenCalledTimes(6);
      expect(hook.result.current).toBe(live.factories[0]);
    },
  );

  it("refreshes reconnect credentials in memory without rotating the factory", async () => {
    const live = harness();
    live.requestTicket
      .mockResolvedValueOnce(ticket(4))
      .mockResolvedValueOnce(ticket(5));
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, live.dependencies),
      { initialProps: { authReady: true, userId: "artist-4" } },
    );
    await flushPromises();
    const initialFactory = hook.result.current;

    await expect(live.refreshers[0]?.()).resolves.toBe(ticket(5).ticket);
    hook.rerender({ authReady: true, userId: "artist-4" });

    expect(hook.result.current).toBe(initialFactory);
    expect(live.createServerFactory).toHaveBeenCalledOnce();
  });

  it("returns the same guest credential on socket refresh instead of minting another", async () => {
    const live = harness();
    live.createGuestCredential
      .mockReturnValueOnce("guest:v1:seed-credential")
      .mockReturnValueOnce("guest:v1:rotated-credential");
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, live.dependencies),
      { initialProps: { authReady: true, userId: null } },
    );

    expect(hook.result.current).toBe(live.factories[0]);
    expect(live.createServerFactory).toHaveBeenCalledOnce();
    await expect(live.refreshers[0]?.()).resolves.toBe("guest:v1:seed-credential");
    expect(live.createGuestCredential).toHaveBeenCalledOnce();
    expect(hook.result.current).toBe(live.factories[0]);
  });

  it("fetches the socket transport on demand and still mints one stable guest factory", async () => {
    const live = harness();
    deferredTransport.credentials.length = 0;
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, {
          requestTicket: live.requestTicket,
          createGuestCredential: live.createGuestCredential,
        }),
      { initialProps: { authReady: true, userId: null } },
    );

    // Nothing exists on the first render: the transport chunk has not landed yet, and the canvas
    // never waits on it.
    expect(hook.result.current).toBeUndefined();

    await flushPromises();

    expect(deferredTransport.importCount).toBeGreaterThan(0);
    expect(deferredTransport.credentials).toEqual([
      "guest:v1:7a75f75a-4abc-4def-8abc-04c9e58a52f1",
    ]);
    const factory = hook.result.current;
    expect(factory).toBeDefined();

    hook.rerender({ authReady: true, userId: null });
    expect(hook.result.current).toBe(factory);
    expect(live.createGuestCredential).toHaveBeenCalledOnce();
  });

  it("fetches the socket transport on demand for an authenticated admission ticket", async () => {
    const live = harness();
    deferredTransport.credentials.length = 0;
    live.requestTicket.mockResolvedValue(ticket(9));
    const hook = renderHook(
      (input: StudioLiveTransportAuthInput) =>
        useStudioLiveTransportAuth(input, { requestTicket: live.requestTicket }),
      { initialProps: { authReady: true, userId: "artist-9" } },
    );

    expect(hook.result.current).toBeUndefined();

    await flushPromises();

    expect(deferredTransport.credentials).toEqual([ticket(9).ticket]);
    expect(hook.result.current).toBeDefined();
  });
});
