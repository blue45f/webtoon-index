import { describe, expect, it } from "vitest";

import {
  STUDIO_REALTIME_CAPABILITIES,
  STUDIO_REALTIME_PROVIDER_LIMITS,
  StudioRealtimeConnectionRequestSchema,
  StudioRealtimeInboundEventSchema,
  StudioRealtimeOutboundEventSchema,
  StudioRealtimeProviderHelloSchema,
  StudioRealtimeTicketSchema,
  negotiateStudioRealtimeProvider,
  parseStudioRealtimeInboundEvent,
} from "./studio-realtime-provider-protocol";

const UUIDS = {
  client: "00000000-0000-4000-8000-000000000001",
  event: "00000000-0000-4000-8000-000000000002",
  idempotency: "00000000-0000-4000-8000-000000000003",
  resumeEvent: "00000000-0000-4000-8000-000000000004",
} as const;

const scope = Object.freeze({ workId: "work-1", roomId: "room-1" });
const workloads = ["presence", "comments", "screen-signaling"] as const;

function connectionRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    version: 1,
    clientInstanceId: UUIDS.client,
    sessionId: "session-1",
    scope,
    requiredWorkloads: [...workloads],
    requiredCapabilities: [...STUDIO_REALTIME_CAPABILITIES],
    resume: [],
    ...overrides,
  };
}

function hello(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    version: 1,
    providerId: "supabase-seoul",
    providerSessionId: "provider-session-1",
    scope,
    acceptedWorkloads: [...workloads],
    capabilities: [...STUDIO_REALTIME_CAPABILITIES],
    resume: [
      { workload: "presence", status: "fresh", serverSequence: "0" },
      { workload: "comments", status: "fresh", serverSequence: "0" },
      { workload: "screen-signaling", status: "fresh", serverSequence: "0" },
    ],
    limits: { maxEventBytes: 64 * 1024, heartbeatMs: 20_000 },
    ...overrides,
  };
}

function inboundEvent(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    version: 1,
    scope,
    workload: "comments",
    kind: "comments.changed",
    eventId: UUIDS.event,
    idempotencyKey: UUIDS.idempotency,
    serverSequence: "1",
    sentAt: "2026-07-31T00:00:00.000Z",
    senderSessionId: "session-2",
    targetSessionId: null,
    payload: {
      threadId: "thread-1",
      activitySequence: "7",
      change: "replied",
    },
    ...overrides,
  };
}

describe("studio realtime provider protocol", () => {
  it("accepts only an exact versioned room/work request", () => {
    expect(StudioRealtimeConnectionRequestSchema.safeParse(connectionRequest()).success)
      .toBe(true);
    expect(
      StudioRealtimeConnectionRequestSchema.safeParse(
        connectionRequest({ unexpected: true }),
      ).success,
    ).toBe(false);
    expect(
      StudioRealtimeConnectionRequestSchema.safeParse(
        connectionRequest({
          requiredWorkloads: ["comments"],
          requiredCapabilities: ["presence.members-v1"],
        }),
      ).success,
    ).toBe(false);
    expect(
      StudioRealtimeConnectionRequestSchema.safeParse(
        connectionRequest({
          resume: [
            {
              workload: "comments",
              serverSequence: "01",
              eventId: UUIDS.resumeEvent,
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("enforces short-lived, scope-bound tickets without placing tokens in protocol events", () => {
    const ticket = {
      version: 1,
      providerId: "supabase-seoul",
      scope,
      workloads: [...workloads],
      capabilities: [...STUDIO_REALTIME_CAPABILITIES],
      issuedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: "2026-07-31T00:04:00.000Z",
      ticket: "server-minted-ticket-value-1234567890",
    };
    expect(StudioRealtimeTicketSchema.safeParse(ticket).success).toBe(true);
    expect(
      StudioRealtimeTicketSchema.safeParse({
        ...ticket,
        expiresAt: "2026-07-31T00:06:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      StudioRealtimeTicketSchema.safeParse({
        ...ticket,
        ticket: "server-ticket with-whitespace-1234567890",
      }).success,
    ).toBe(false);
    expect(JSON.stringify(inboundEvent())).not.toContain(ticket.ticket);
  });

  it("rejects every silent workload, capability, scope, or resume downgrade", () => {
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello(),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: true });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({ acceptedWorkloads: ["presence", "comments"] }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "invalid-hello" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({
          capabilities: STUDIO_REALTIME_CAPABILITIES.filter(
            (capability) => capability !== "comments.invalidation-v1",
          ),
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({
      ok: false,
      code: "capability-missing",
      missingCapabilities: ["comments.invalidation-v1"],
    });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({ scope: { workId: "other-work", roomId: "room-1" } }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "scope-mismatch" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({
          limits: { maxEventBytes: 8 * 1024, heartbeatMs: 20_000 },
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "payload-limit-insufficient" });

    const resume = [
      {
        workload: "comments",
        serverSequence: "7",
        eventId: UUIDS.resumeEvent,
      },
    ];
    const resumeHello = hello({
      resume: [
        { workload: "presence", status: "fresh", serverSequence: "0" },
        { workload: "comments", status: "unavailable", serverSequence: "0" },
        { workload: "screen-signaling", status: "fresh", serverSequence: "0" },
      ],
    });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest({ resume }),
        resumeHello,
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "resume-unavailable" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest({ resume }),
        hello({
          resume: [
            { workload: "presence", status: "fresh", serverSequence: "0" },
            { workload: "comments", status: "resumed", serverSequence: "8" },
            {
              workload: "screen-signaling",
              status: "fresh",
              serverSequence: "0",
            },
          ],
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "resume-mismatch" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({
          acceptedWorkloads: [
            ...workloads,
            "presence",
          ],
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "invalid-hello" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({
          capabilities: [
            ...STUDIO_REALTIME_CAPABILITIES,
            "presence.members-v1",
          ],
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "invalid-hello" });
    expect(
      negotiateStudioRealtimeProvider(
        connectionRequest(),
        hello({
          resume: [
            {
              workload: "presence",
              status: "unavailable",
              serverSequence: "0",
            },
            { workload: "comments", status: "fresh", serverSequence: "0" },
            {
              workload: "screen-signaling",
              status: "fresh",
              serverSequence: "0",
            },
          ],
        }),
        "supabase-seoul",
      ),
    ).toMatchObject({ ok: false, code: "resume-unavailable" });
  });

  it("uses exact workload-specific event variants and byte bounds", () => {
    expect(StudioRealtimeInboundEventSchema.safeParse(inboundEvent()).success).toBe(true);
    expect(
      StudioRealtimeInboundEventSchema.safeParse(
        inboundEvent({ extraProviderField: "not allowed" }),
      ).success,
    ).toBe(false);
    expect(
      StudioRealtimeInboundEventSchema.safeParse(
        inboundEvent({
          workload: "presence",
        }),
      ).success,
    ).toBe(false);
    expect(
      StudioRealtimeInboundEventSchema.safeParse(
        inboundEvent({ serverSequence: "00" }),
      ).success,
    ).toBe(false);
    expect(
      parseStudioRealtimeInboundEvent(inboundEvent(), {
        workId: "other-work",
        roomId: "room-1",
      }),
    ).toBeNull();

    const oversizedSdp = {
      ...inboundEvent(),
      workload: "screen-signaling",
      kind: "screen.description",
      payload: {
        shareId: "share-1",
        type: "offer",
        sdp: "x".repeat(
          Math.max(
            STUDIO_REALTIME_PROVIDER_LIMITS.maxSdpCodeUnits + 1,
            STUDIO_REALTIME_PROVIDER_LIMITS.maxEventBytes,
          ),
        ),
      },
    };
    expect(StudioRealtimeInboundEventSchema.safeParse(oversizedSdp).success).toBe(
      false,
    );

    const cursor = {
      ...inboundEvent(),
      workload: "presence",
      kind: "presence.cursor",
      payload: {
        x: 0.25,
        y: 0.75,
        pageId: "page-1",
        tool: "g-pen",
        drawing: true,
        strokeColor: "#123456",
        strokeWidth: 8,
        strokeOpacity: 0.9,
        points: [10, 20, 30, 40],
      },
    };
    expect(StudioRealtimeInboundEventSchema.safeParse(cursor).success).toBe(
      true,
    );
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...cursor,
        payload: { ...cursor.payload, x: 1.001 },
      }).success,
    ).toBe(false);

    const screenRequest = {
      ...inboundEvent(),
      workload: "screen-signaling",
      kind: "screen.request",
      targetSessionId: "session-3",
      payload: { shareId: "share-1" },
    };
    expect(
      StudioRealtimeInboundEventSchema.safeParse(screenRequest).success,
    ).toBe(true);
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...screenRequest,
        targetSessionId: null,
      }).success,
    ).toBe(false);
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...cursor,
        targetSessionId: "session-3",
      }).success,
    ).toBe(false);
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...cursor,
        payload: {
          ...cursor.payload,
          tool: "t".repeat(64),
        },
      }).success,
    ).toBe(true);
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...cursor,
        payload: {
          ...cursor.payload,
          tool: "t".repeat(65),
        },
      }).success,
    ).toBe(false);

    const endOfCandidates = {
      ...inboundEvent(),
      workload: "screen-signaling",
      kind: "screen.ice",
      targetSessionId: "session-3",
      payload: {
        shareId: "share-1",
        candidate: "",
        sdpMid: "m".repeat(256),
        sdpMLineIndex: null,
        usernameFragment: null,
      },
    };
    expect(
      StudioRealtimeInboundEventSchema.safeParse(endOfCandidates).success,
    ).toBe(true);

    const presenceUpsert = {
      ...inboundEvent(),
      workload: "presence",
      kind: "presence.upsert",
      senderSessionId: "session-2",
      payload: {
        participant: {
          sessionId: "session-spoofed",
          displayName: "다른 사용자",
          role: "editor",
          state: "active",
          pageId: "page-1",
          tool: "pen",
          updatedAt: "2026-07-31T00:00:00.000Z",
        },
      },
    };
    expect(
      StudioRealtimeInboundEventSchema.safeParse(presenceUpsert).success,
    ).toBe(false);
    expect(
      StudioRealtimeInboundEventSchema.safeParse({
        ...presenceUpsert,
        kind: "presence.remove",
        payload: { sessionId: "session-spoofed", reason: "left" },
      }).success,
    ).toBe(false);
  });

  it("separates client and server sequences for idempotent publishing and resume", () => {
    const outbound = {
      ...inboundEvent(),
      clientSequence: "1",
    };
    delete (outbound as Record<string, unknown>).serverSequence;
    expect(StudioRealtimeOutboundEventSchema.safeParse(outbound).success).toBe(
      true,
    );
    expect(
      StudioRealtimeOutboundEventSchema.safeParse({
        ...outbound,
        serverSequence: "1",
      }).success,
    ).toBe(false);
    expect(
      StudioRealtimeProviderHelloSchema.safeParse(
        hello({
          resume: [
            { workload: "presence", status: "fresh", serverSequence: "1" },
            { workload: "comments", status: "fresh", serverSequence: "0" },
            {
              workload: "screen-signaling",
              status: "fresh",
              serverSequence: "0",
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });
});
