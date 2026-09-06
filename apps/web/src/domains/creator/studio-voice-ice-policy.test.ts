import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioVoiceIcePolicyLease,
  type StudioVoiceIcePolicyLeaseDependencies,
} from "./studio-voice-ice-policy";

import type { StudioVoiceIcePolicyResponse } from "@/shared/lib/studio-voice-ice-policy-contract";

function directPolicy(): StudioVoiceIcePolicyResponse {
  return {
    version: 1,
    mode: "direct",
    iceServers: [],
    issuedAt: "2026-07-18T00:00:00.000Z",
    expiresAt: null,
    ttlSeconds: 0,
  };
}

function turnPolicy(expiresAt: number): StudioVoiceIcePolicyResponse {
  return {
    version: 1,
    mode: "turn",
    iceServers: [
      { urls: ["stun:voice.example.com"] },
      {
        urls: [
          "turn:voice.example.com?transport=udp",
          "turns:voice.example.com:5349?transport=tcp",
        ],
        username: `${Math.floor(expiresAt / 1_000)}:opaque-user`,
        credential: "short-lived-credential",
        credentialType: "password",
      },
    ],
    issuedAt: new Date(expiresAt - 300_000).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    ttlSeconds: 300,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio voice ICE policy lease", () => {
  it("creates peers from a validated direct policy without contacting public servers", async () => {
    const createPeerConnection = vi.fn(
      (configuration: RTCConfiguration) => ({ configuration }) as unknown as RTCPeerConnection
    );
    const lease = await acquireStudioVoiceIcePolicyLease("work-direct", {
      loadPolicy: vi.fn().mockResolvedValue(directPolicy()),
      createPeerConnection,
    });

    expect(lease.mode).toBe("direct");
    expect(lease.createPeerConnection()).toBeDefined();
    expect(createPeerConnection).toHaveBeenCalledWith({
      iceServers: [],
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
    });
    lease.close();
    expect(() => lease.createPeerConnection()).toThrow(/이미 종료/u);
  });

  it("passes only the in-memory short-lived TURN policy to new peer connections", async () => {
    const now = Date.parse("2026-07-18T09:00:00.000Z");
    const policy = turnPolicy(now + 300_000);
    const createPeerConnection = vi.fn(
      (configuration: RTCConfiguration) => ({ configuration }) as unknown as RTCPeerConnection
    );
    const lease = await acquireStudioVoiceIcePolicyLease("work-turn", {
      loadPolicy: vi.fn().mockResolvedValue(policy),
      createPeerConnection,
      now: () => now,
    });

    lease.createPeerConnection();
    expect(createPeerConnection).toHaveBeenCalledWith({
      iceServers: policy.iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
    });
    lease.close();
  });

  it("refreshes credentials before expiry and uses the replacement for later peers", async () => {
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-07-18T10:00:00.000Z");
    vi.setSystemTime(startedAt);
    const first = turnPolicy(startedAt + 300_000);
    const second = {
      ...turnPolicy(startedAt + 600_000),
      iceServers: [
        {
          urls: ["turns:voice.example.com:5349?transport=tcp"],
          username: `${Math.floor((startedAt + 600_000) / 1_000)}:rotated-user`,
          credential: "rotated-credential",
          credentialType: "password" as const,
        },
      ],
    } satisfies StudioVoiceIcePolicyResponse;
    const loadPolicy = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const existingConnection = {
      connectionState: "connected",
      setConfiguration: vi.fn(),
    } as unknown as RTCPeerConnection;
    const createPeerConnection = vi.fn()
      .mockReturnValueOnce(existingConnection)
      .mockImplementation(
        (configuration: RTCConfiguration) =>
          ({ configuration }) as unknown as RTCPeerConnection
      );
    const lease = await acquireStudioVoiceIcePolicyLease("work-refresh", {
      loadPolicy,
      createPeerConnection,
    });
    const configurationChanged = vi.fn();
    lease.createPeerConnection();
    lease.subscribeConfigurationChange(configurationChanged);

    await vi.advanceTimersByTimeAsync(240_000);
    expect(loadPolicy).toHaveBeenCalledTimes(2);
    expect(existingConnection.setConfiguration).toHaveBeenCalledWith({
      iceServers: second.iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
    });
    expect(configurationChanged).toHaveBeenCalledTimes(1);
    lease.createPeerConnection();
    expect(createPeerConnection).toHaveBeenLastCalledWith({
      iceServers: second.iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
    });
    lease.close();
  });

  it("anchors a validated TURN lifetime to receipt time instead of the browser wall clock", async () => {
    const serverNow = Date.parse("2026-07-18T12:00:00.000Z");
    const skewedBrowserNow = Date.parse("2036-07-18T12:00:00.000Z");
    const createPeerConnection = vi.fn(
      () => ({}) as RTCPeerConnection
    );
    const lease = await acquireStudioVoiceIcePolicyLease("work-clock-skew", {
      loadPolicy: vi.fn().mockResolvedValue(turnPolicy(serverNow + 300_000)),
      createPeerConnection,
      now: () => skewedBrowserNow,
    });

    expect(() => lease.createPeerConnection()).not.toThrow();
    expect(createPeerConnection).toHaveBeenCalledTimes(1);
    lease.close();
  });

  it("fails closed after credential expiry and retries refresh without reusing stale secrets", async () => {
    let now = Date.parse("2026-07-18T11:00:00.000Z");
    const expiresAt = now + 300_000;
    const loadPolicy = vi.fn()
      .mockResolvedValueOnce(turnPolicy(expiresAt))
      .mockRejectedValue(new Error("policy endpoint unavailable"));
    const onRefreshError = vi.fn();
    const scheduled: Array<() => void> = [];
    const dependencies: StudioVoiceIcePolicyLeaseDependencies = {
      loadPolicy,
      createPeerConnection: vi.fn(() => ({}) as RTCPeerConnection),
      now: () => now,
      setTimer: (callback) => {
        scheduled.push(callback);
        return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
      },
      clearTimer: vi.fn(),
      onRefreshError,
    };
    const lease = await acquireStudioVoiceIcePolicyLease("work-expired", dependencies);

    now = expiresAt + 1;
    expect(() => lease.createPeerConnection()).toThrow(/자격 증명이 만료/u);
    await vi.waitFor(() => expect(onRefreshError).toHaveBeenCalledWith(expect.any(Error), true));
    lease.close();
  });

  it("honors lifecycle cancellation before or during initial policy acquisition", async () => {
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    const loadPolicy = vi.fn();
    await expect(acquireStudioVoiceIcePolicyLease("work-cancelled", {
      signal: alreadyCancelled.signal,
      loadPolicy,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadPolicy).not.toHaveBeenCalled();

    const pendingController = new AbortController();
    let resolvePolicy!: (value: StudioVoiceIcePolicyResponse) => void;
    const pending = acquireStudioVoiceIcePolicyLease("work-pending", {
      signal: pendingController.signal,
      loadPolicy: () => new Promise((resolve) => {
        resolvePolicy = resolve;
      }),
    });
    pendingController.abort();
    resolvePolicy(directPolicy());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects malformed server policies before constructing a peer", async () => {
    await expect(acquireStudioVoiceIcePolicyLease("work-invalid", {
      loadPolicy: vi.fn().mockResolvedValue({
        version: 1,
        mode: "turn",
        iceServers: [{ urls: ["https://attacker.example.com"] }],
        issuedAt: "2026-07-18T00:00:00.000Z",
        expiresAt: null,
        ttlSeconds: 0,
      }),
    })).rejects.toThrow(/안전한 음성 연결 설정/u);
  });
});
