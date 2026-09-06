import { describe, expect, it } from "vitest";

import {
  StudioRealtimeTicketRequestSchema as ClientTicketRequestSchema,
  StudioRealtimeTicketSchema as ClientTicketResponseSchema,
} from "../../../../web/src/domains/creator/studio-realtime-provider-protocol";

import {
  IssueStudioRealtimeTicketSchema,
  StudioRealtimeTicketResponseSchema,
} from "./studio-realtime-ticket.dto";

const REQUEST = {
  version: 1,
  providerId: "cloudflare-realtime-seoul",
  sessionId: "session-1",
  scope: { workId: "work-1", roomId: "room-1" },
  workloads: ["comments"],
  capabilities: [
    "comments.invalidation-v1",
    "comments.resume-v1",
  ],
} as const;

describe("studio realtime ticket HTTP contract", () => {
  it("is exact-compatible with the frontend ticket request and response envelope", () => {
    const clientRequest = ClientTicketRequestSchema.parse(REQUEST);
    expect(IssueStudioRealtimeTicketSchema.parse(clientRequest)).toEqual(
      clientRequest,
    );

    const response = StudioRealtimeTicketResponseSchema.parse({
      version: 1,
      providerId: REQUEST.providerId,
      scope: REQUEST.scope,
      workloads: REQUEST.workloads,
      capabilities: REQUEST.capabilities,
      issuedAt: "2026-07-31T01:00:00.000Z",
      expiresAt: "2026-07-31T01:02:00.000Z",
      ticket: `${"a".repeat(80)}.${"b".repeat(43)}`,
    });
    expect(ClientTicketResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects provider substitution, unknown fields, and cross-workload capabilities", () => {
    expect(
      IssueStudioRealtimeTicketSchema.safeParse({
        ...REQUEST,
        provider: "client-controlled-host",
      }).success,
    ).toBe(false);
    expect(
      IssueStudioRealtimeTicketSchema.safeParse({
        ...REQUEST,
        capabilities: ["presence.snapshot-v1"],
      }).success,
    ).toBe(false);
    expect(
      IssueStudioRealtimeTicketSchema.safeParse({
        ...REQUEST,
        workloads: ["comments", "comments"],
      }).success,
    ).toBe(false);
  });

  it("uses a stricter two-minute response lifetime than the frontend ceiling", () => {
    const response = {
      version: 1,
      providerId: REQUEST.providerId,
      scope: REQUEST.scope,
      workloads: REQUEST.workloads,
      capabilities: REQUEST.capabilities,
      issuedAt: "2026-07-31T01:00:00.000Z",
      expiresAt: "2026-07-31T01:02:01.000Z",
      ticket: `${"a".repeat(80)}.${"b".repeat(43)}`,
    } as const;

    expect(ClientTicketResponseSchema.safeParse(response).success).toBe(true);
    expect(StudioRealtimeTicketResponseSchema.safeParse(response).success)
      .toBe(false);
  });
});
