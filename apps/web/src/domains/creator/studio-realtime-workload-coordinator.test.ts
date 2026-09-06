import { describe, expect, it, vi } from "vitest";

import {
  StudioRealtimeWorkloadCoordinator,
  type StudioRealtimeWorkloadRoute,
} from "./studio-realtime-workload-coordinator";

import type {
  StudioRealtimeConnectionRequest,
  StudioRealtimeOutboundEvent,
  StudioRealtimeTicketRequest,
  StudioRealtimeWorkload,
} from "./studio-realtime-provider-protocol";
import type {
  StudioRealtimeProviderAdapter,
  StudioRealtimeProviderAdapterFactory,
} from "./studio-realtime-provider-runtime";

const scope = { workId: "work-1", roomId: "room-1" } as const;
const clientId = "00000000-0000-4000-8000-000000000001";

function factory(
  providerId: string,
  connectFails = false,
): {
  factory: StudioRealtimeProviderAdapterFactory;
  published: StudioRealtimeOutboundEvent[];
} {
  const published: StudioRealtimeOutboundEvent[] = [];
  const descriptor = {
    providerId,
    kind: "custom" as const,
    protocolVersion: 1 as const,
  };
  return {
    published,
    factory: {
      descriptor,
      create: (): StudioRealtimeProviderAdapter => {
        let providerSessionId = `${providerId}-connection`;
        return {
          descriptor,
          connect: async (
            request: StudioRealtimeConnectionRequest,
            _ticket: string,
            _handlers,
          ) => {
            if (connectFails) throw new Error("offline");
            providerSessionId = `${providerId}-connection`;
            return {
              version: 1,
              providerId,
              providerSessionId,
              scope,
              acceptedWorkloads: request.requiredWorkloads,
              capabilities: request.requiredCapabilities,
              resume: request.requiredWorkloads.map((workload) => {
                const cursor = request.resume.find(
                  (candidate) => candidate.workload === workload,
                );
                return cursor
                  ? {
                      workload,
                      status: "resumed",
                      serverSequence: cursor.serverSequence,
                    }
                  : { workload, status: "fresh", serverSequence: "0" };
              }),
              limits: { maxEventBytes: 64 * 1024, heartbeatMs: 20_000 },
            };
          },
          publish: async (event) => {
            published.push(event);
            return {
              version: 1,
              providerId,
              providerSessionId,
              scope,
              workload: event.workload,
              eventId: event.eventId,
              idempotencyKey: event.idempotencyKey,
              clientSequence: event.clientSequence,
              serverSequence: event.clientSequence,
              duplicate: false,
            };
          },
          close: () => undefined,
        };
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
    expiresAt: "2026-07-31T00:02:00.000Z",
    ticket: `ticket-${request.providerId}-123456789012345678901234567890`,
  };
}

function event(
  workload: StudioRealtimeWorkload,
  sequence: string,
): StudioRealtimeOutboundEvent {
  const common = {
    version: 1 as const,
    scope,
    eventId: `00000000-0000-4000-8000-00000000000${sequence}`,
    idempotencyKey: `10000000-0000-4000-8000-00000000000${sequence}`,
    clientSequence: sequence,
    sentAt: "2026-07-31T00:00:01.000Z",
    senderSessionId: "session-1",
    targetSessionId: null,
  };
  if (workload === "comments") {
    return {
      ...common,
      workload,
      kind: "comments.changed",
      payload: {
        threadId: "thread-1",
        activitySequence: "4",
        change: "replied",
      },
    };
  }
  if (workload === "presence") {
    return {
      ...common,
      workload,
      kind: "presence.remove",
      payload: { sessionId: "session-1", reason: "left" },
    };
  }
  return {
    ...common,
    workload,
    kind: "screen.stop",
    payload: { shareId: "share-1" },
  };
}

describe("StudioRealtimeWorkloadCoordinator", () => {
  it("owns independent workload routes and issues one ticket per provider group", async () => {
    const presence = factory("presence-provider");
    const review = factory("review-provider");
    const issue = vi.fn(async (request: StudioRealtimeTicketRequest) =>
      ticket(request),
    );
    const routes: StudioRealtimeWorkloadRoute[] = [
      {
        routeId: "presence",
        workloads: ["presence"],
        capabilities: [
          "presence.snapshot-v1",
          "presence.members-v1",
          "presence.cursor-v1",
          "presence.resume-v1",
        ],
        providers: [presence.factory],
      },
      {
        routeId: "review",
        workloads: ["comments", "screen-signaling"],
        capabilities: [
          "comments.invalidation-v1",
          "comments.resume-v1",
          "screen-signaling.session-v1",
          "screen-signaling.webrtc-v1",
          "screen-signaling.resume-v1",
        ],
        providers: [review.factory],
      },
    ];
    const coordinator = new StudioRealtimeWorkloadCoordinator({
      scope,
      clientInstanceId: clientId,
      sessionId: "session-1",
      routes,
      ticketIssuer: { issue },
      now: () => Date.parse("2026-07-31T00:00:30.000Z"),
    });

    await coordinator.connect();
    expect(coordinator.isReady("presence")).toBe(true);
    expect(coordinator.isReady("comments")).toBe(true);
    expect(coordinator.isReady("screen-signaling")).toBe(true);
    expect(issue).toHaveBeenCalledTimes(2);

    await coordinator.publish(event("presence", "1"));
    await coordinator.publish(event("comments", "1"));
    expect(presence.published.map((value) => value.workload)).toEqual([
      "presence",
    ]);
    expect(review.published.map((value) => value.workload)).toEqual([
      "comments",
    ]);
    await coordinator.dispose();
  });

  it("keeps a healthy purpose route available when another provider group is offline", async () => {
    const presence = factory("presence-provider");
    const comments = factory("comments-provider", true);
    const coordinator = new StudioRealtimeWorkloadCoordinator({
      scope,
      clientInstanceId: clientId,
      sessionId: "session-1",
      routes: [
        {
          routeId: "presence",
          workloads: ["presence"],
          capabilities: [
            "presence.snapshot-v1",
            "presence.members-v1",
            "presence.cursor-v1",
            "presence.resume-v1",
          ],
          providers: [presence.factory],
        },
        {
          routeId: "comments",
          workloads: ["comments"],
          capabilities: [
            "comments.invalidation-v1",
            "comments.resume-v1",
          ],
          providers: [comments.factory],
        },
      ],
      ticketIssuer: {
        issue: async (request) => ticket(request),
      },
      now: () => Date.parse("2026-07-31T00:00:30.000Z"),
    });

    const results = await coordinator.connect();
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(coordinator.isReady("presence")).toBe(true);
    expect(coordinator.isReady("comments")).toBe(false);
    await coordinator.dispose();
  });

  it("rejects overlapping operational owners", () => {
    const provider = factory("provider");
    expect(
      () =>
        new StudioRealtimeWorkloadCoordinator({
          scope,
          clientInstanceId: clientId,
          sessionId: "session-1",
          routes: [
            {
              routeId: "a",
              workloads: ["presence"],
              capabilities: ["presence.snapshot-v1"],
              providers: [provider.factory],
            },
            {
              routeId: "b",
              workloads: ["presence"],
              capabilities: ["presence.cursor-v1"],
              providers: [provider.factory],
            },
          ],
          ticketIssuer: { issue: async (request) => ticket(request) },
        }),
    ).toThrow("중복");
  });
});
