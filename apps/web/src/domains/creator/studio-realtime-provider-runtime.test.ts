import { describe, expect, it, vi, type Mock } from "vitest";

import {
  STUDIO_REALTIME_CAPABILITIES,
  type StudioRealtimeConnectionRequest,
  type StudioRealtimeOutboundEvent,
  type StudioRealtimeProviderHello,
  type StudioRealtimeTicketRequest,
} from "./studio-realtime-provider-protocol";
import {
  STUDIO_REALTIME_PROVIDER_SECURITY_BOUNDARY,
  StudioRealtimeProviderContractError,
  StudioRealtimeProviderFallbackRequiredError,
  StudioRealtimeProviderSession,
  StudioRealtimeTicketDeniedError,
  type StudioRealtimeAdapterDisconnect,
  type StudioRealtimeProviderAdapter,
  type StudioRealtimeProviderAdapterFactory,
  type StudioRealtimeProviderAdapterHandlers,
  type StudioRealtimeProviderKind,
} from "./studio-realtime-provider-runtime";

const UUIDS = {
  client: "00000000-0000-4000-8000-000000000001",
  event1: "00000000-0000-4000-8000-000000000002",
  idem1: "00000000-0000-4000-8000-000000000003",
  event2: "00000000-0000-4000-8000-000000000004",
  idem2: "00000000-0000-4000-8000-000000000005",
  event3: "00000000-0000-4000-8000-000000000006",
  idem3: "00000000-0000-4000-8000-000000000007",
} as const;

const scope = Object.freeze({ workId: "work-1", roomId: "room-1" });
const workloads = ["presence", "comments", "screen-signaling"] as const;

function hello(
  providerId: string,
  request: StudioRealtimeConnectionRequest,
  overrides: Readonly<Partial<StudioRealtimeProviderHello>> = {},
): StudioRealtimeProviderHello {
  return {
    version: 1,
    providerId,
    providerSessionId: `${providerId}-session`,
    scope,
    acceptedWorkloads: [...workloads],
    capabilities: [...STUDIO_REALTIME_CAPABILITIES],
    resume: workloads.map((workload) => {
      const cursor = request.resume.find((value) => value.workload === workload);
      return cursor
        ? {
            workload,
            status: "resumed" as const,
            serverSequence: cursor.serverSequence,
          }
        : { workload, status: "fresh" as const, serverSequence: "0" };
    }),
    limits: { maxEventBytes: 64 * 1024, heartbeatMs: 20_000 },
    ...overrides,
  };
}

interface TestAdapter extends StudioRealtimeProviderAdapter {
  readonly requests: StudioRealtimeConnectionRequest[];
  readonly tickets: string[];
  readonly published: StudioRealtimeOutboundEvent[];
  readonly close: Mock<() => void>;
  disconnect(reason?: StudioRealtimeAdapterDisconnect): void;
  event(value: unknown): void;
}

function factory(
  providerId: string,
  kind: StudioRealtimeProviderKind,
  connectResult?: (
    request: StudioRealtimeConnectionRequest,
  ) => unknown | Promise<unknown>,
): {
  factory: StudioRealtimeProviderAdapterFactory;
  adapters: TestAdapter[];
} {
  const adapters: TestAdapter[] = [];
  const descriptor = { providerId, kind, protocolVersion: 1 as const };
  return {
    adapters,
    factory: {
      descriptor,
      create: () => {
        let handlers: StudioRealtimeProviderAdapterHandlers | null = null;
        const requests: StudioRealtimeConnectionRequest[] = [];
        const tickets: string[] = [];
        const published: StudioRealtimeOutboundEvent[] = [];
        const adapter: TestAdapter = {
          descriptor,
          requests,
          tickets,
          published,
          connect: async (request, ticket, nextHandlers) => {
            requests.push(request);
            tickets.push(ticket);
            handlers = nextHandlers;
            return connectResult
              ? connectResult(request)
              : hello(providerId, request);
          },
          publish: async (event) => {
            published.push(event);
            return {
              version: 1,
              providerId,
              providerSessionId: `${providerId}-session`,
              scope,
              workload: event.workload,
              eventId: event.eventId,
              idempotencyKey: event.idempotencyKey,
              clientSequence: event.clientSequence,
              serverSequence: event.clientSequence,
              duplicate: false,
            };
          },
          close: vi.fn(),
          disconnect: (reason = { code: "network-lost", recoverable: true }) => {
            handlers?.onDisconnect(reason);
          },
          event: (value) => handlers?.onEvent(value),
        };
        adapters.push(adapter);
        return adapter;
      },
    },
  };
}

function ticket(request: StudioRealtimeTicketRequest) {
  return {
    version: 1,
    providerId: request.providerId,
    scope: request.scope,
    workloads: request.workloads,
    capabilities: request.capabilities,
    issuedAt: "2026-07-31T00:00:00.000Z",
    expiresAt: "2026-07-31T00:04:00.000Z",
    ticket: `server-ticket-${request.providerId}-12345678901234567890`,
  };
}

function options(
  providers: readonly StudioRealtimeProviderAdapterFactory[],
  issue = vi.fn(async (request: StudioRealtimeTicketRequest) => ticket(request)),
) {
  return {
    scope,
    clientInstanceId: UUIDS.client,
    sessionId: "session-1",
    requiredWorkloads: [...workloads],
    requiredCapabilities: [...STUDIO_REALTIME_CAPABILITIES],
    providers,
    ticketIssuer: { issue },
    now: () => Date.parse("2026-07-31T00:00:30.000Z"),
    reconnect: {
      initialDelayMs: 100,
      maximumDelayMs: 1_000,
      multiplier: 2,
      jitter: 0,
    },
  } as const;
}

function commentOutbound(
  clientSequence: string,
  eventId: string = UUIDS.event1,
  idempotencyKey: string = UUIDS.idem1,
): Record<string, unknown> {
  return {
    version: 1,
    scope,
    workload: "comments",
    kind: "comments.changed",
    eventId,
    idempotencyKey,
    clientSequence,
    sentAt: "2026-07-31T00:00:31.000Z",
    senderSessionId: "session-1",
    targetSessionId: null,
    payload: {
      threadId: "thread-1",
      activitySequence: "7",
      change: "replied",
    },
  };
}

function commentInbound(
  serverSequence: string,
  eventId: string = UUIDS.event1,
  idempotencyKey: string = UUIDS.idem1,
): Record<string, unknown> {
  const event = commentOutbound("1", eventId, idempotencyKey);
  delete event.clientSequence;
  return { ...event, serverSequence, senderSessionId: "session-2" };
}

describe("StudioRealtimeProviderSession", () => {
  it("tries a feature-incomplete Supabase host then selects an exact Socket.IO fallback", async () => {
    const supabase = factory("supabase-seoul", "supabase-realtime", (request) =>
      hello("supabase-seoul", request, {
        capabilities: STUDIO_REALTIME_CAPABILITIES.filter(
          (capability) => capability !== "screen-signaling.webrtc-v1",
        ),
      }),
    );
    const socket = factory("socket-primary", "socket-io");
    const issue = vi.fn(async (request: StudioRealtimeTicketRequest) =>
      ticket(request),
    );
    const session = new StudioRealtimeProviderSession(
      options([supabase.factory, socket.factory], issue),
    );

    await expect(session.connect()).resolves.toMatchObject({
      providerId: "socket-primary",
    });
    expect(session.providerId).toBe("socket-primary");
    expect(supabase.adapters[0]?.close).toHaveBeenCalledTimes(1);
    expect(issue.mock.calls.map(([request]) => request.providerId)).toEqual([
      "supabase-seoul",
      "socket-primary",
    ]);
    expect(
      JSON.stringify([
        session.currentStatus,
        STUDIO_REALTIME_PROVIDER_SECURITY_BOUNDARY,
      ]),
    ).not.toContain("server-ticket");
    await session.dispose();
  });

  it("deduplicates delivery, detects sequence gaps, and resumes exactly after backoff", async () => {
    vi.useFakeTimers();
    try {
      const provider = factory("supabase-seoul", "supabase-realtime");
      const session = new StudioRealtimeProviderSession(
        options([provider.factory]),
      );
      const events: unknown[] = [];
      session.subscribe((event) => events.push(event));
      await session.connect();

      const first = provider.adapters[0]!;
      first.event(commentInbound("1"));
      first.event(commentInbound("1"));
      expect(events).toHaveLength(1);

      first.event(commentInbound("3", UUIDS.event3, UUIDS.idem3));
      expect(session.currentStatus).toMatchObject({
        state: "waiting",
        retryInMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(provider.adapters).toHaveLength(2));

      const resumed = provider.adapters[1]!;
      expect(resumed.requests[0]?.resume).toEqual([
        {
          workload: "comments",
          serverSequence: "1",
          eventId: UUIDS.event1,
        },
      ]);
      resumed.event(commentInbound("2", UUIDS.event2, UUIDS.idem2));
      expect(events).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({ serverSequence: "2" });
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the fallback session retrying when every provider is initially unavailable", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const provider = factory(
        "cloudflare-realtime",
        "custom",
        (request) => {
          attempts += 1;
          if (attempts === 1) throw new Error("cold start");
          return hello("cloudflare-realtime", request);
        },
      );
      const session = new StudioRealtimeProviderSession(
        options([provider.factory]),
      );

      await expect(session.connect()).rejects.toThrow();
      expect(session.currentStatus).toMatchObject({
        state: "waiting",
        retryInMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() =>
        expect(session.currentStatus).toMatchObject({
          state: "ready",
          providerId: "cloudflare-realtime",
        }),
      );
      expect(provider.adapters).toHaveLength(2);
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays on primary fallback when provider history cannot reconstruct state", async () => {
    vi.useFakeTimers();
    try {
      const provider = factory(
        "cloudflare-realtime",
        "custom",
        () => {
          throw new StudioRealtimeProviderFallbackRequiredError(
            "cloudflare-realtime",
          );
        },
      );
      const session = new StudioRealtimeProviderSession(
        options([provider.factory]),
      );

      await expect(session.connect()).rejects.toBeInstanceOf(
        StudioRealtimeProviderFallbackRequiredError,
      );
      expect(session.currentStatus).toMatchObject({
        state: "revoked",
        providerId: "cloudflare-realtime",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(provider.adapters).toHaveLength(1);
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates throwing event and status observers from provider lifecycle state", async () => {
    const provider = factory("cloudflare-realtime", "custom");
    const session = new StudioRealtimeProviderSession(
      options([provider.factory]),
    );
    const events: unknown[] = [];
    session.subscribeStatus(() => {
      throw new Error("broken status surface");
    });
    session.subscribe(() => {
      throw new Error("broken event surface");
    });
    session.subscribe((event) => events.push(event));

    await expect(session.connect()).resolves.toMatchObject({
      providerId: "cloudflare-realtime",
    });
    expect(() =>
      provider.adapters[0]!.event(commentInbound("1")),
    ).not.toThrow();
    expect(events).toHaveLength(1);
    expect(session.currentStatus).toMatchObject({ state: "ready" });
    await session.dispose();
  });

  it("keeps an idempotent client sequence retryable until an exact ACK succeeds", async () => {
    const provider = factory("socket-primary", "socket-io");
    const session = new StudioRealtimeProviderSession(
      options([provider.factory]),
    );
    await session.connect();
    const adapter = provider.adapters[0]!;
    const originalPublish = adapter.publish.bind(adapter);
    adapter.publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider included a secret here"))
      .mockImplementation(originalPublish);
    const event = commentOutbound("1");

    await expect(session.publish(event)).rejects.toThrow();
    await expect(session.publish(event)).resolves.toMatchObject({
      clientSequence: "1",
      eventId: UUIDS.event1,
    });
    await expect(session.publish(event)).rejects.toBeInstanceOf(
      StudioRealtimeProviderContractError,
    );
    await expect(
      session.publish(commentOutbound("2", UUIDS.event2, UUIDS.idem2)),
    ).resolves.toMatchObject({ clientSequence: "2" });
    await session.dispose();
  });

  it("stops reconnecting when ticket issuance is permanently denied", async () => {
    vi.useFakeTimers();
    try {
      const provider = factory("cloudflare-realtime", "custom");
      const issue = vi.fn(async () => {
        throw new StudioRealtimeTicketDeniedError();
      });
      const session = new StudioRealtimeProviderSession(
        options([provider.factory], issue),
      );

      await expect(session.connect()).rejects.toBeInstanceOf(
        StudioRealtimeTicketDeniedError,
      );
      expect(session.currentStatus).toMatchObject({
        state: "revoked",
        providerId: null,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(provider.adapters).toHaveLength(1);
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reconnecting on ACL revocation and aborts cleanly on dispose", async () => {
    vi.useFakeTimers();
    try {
      const provider = factory("supabase-seoul", "supabase-realtime");
      const session = new StudioRealtimeProviderSession(
        options([provider.factory]),
      );
      await session.connect();
      provider.adapters[0]!.disconnect({
        code: "access-revoked",
        recoverable: false,
      });
      expect(session.currentStatus).toMatchObject({ state: "revoked" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(provider.adapters).toHaveLength(1);
      await session.dispose();
      expect(session.currentStatus).toMatchObject({ state: "disposed" });
      await expect(session.connect()).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
