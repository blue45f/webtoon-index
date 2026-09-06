import { describe, expect, it } from "vitest";

import { STUDIO_LIVE_AUTH_TICKET_TTL_MS } from "../../../../web/src/shared/lib/studio-live-auth-ticket";
import { verifyStudioLiveAdmissionTicket } from "../../server/session";

import { StudioLiveAuthTicketService } from "./studio-live-auth-ticket.service";

describe("StudioLiveAuthTicketService", () => {
  it("issues a strict short-lived admission ticket for the verified cookie principal", () => {
    const now = 1_700_000_000_000;
    const principal = {
      userId: "creator-1",
      sessionVersion: 3,
      expiresAt: now + 30 * 60_000,
    };
    const response = new StudioLiveAuthTicketService().issue(
      principal,
      { version: 1 },
      now,
    );

    expect(response.version).toBe(1);
    expect(Date.parse(response.expiresAt) - Date.parse(response.issuedAt))
      .toBe(STUDIO_LIVE_AUTH_TICKET_TTL_MS);
    expect(verifyStudioLiveAdmissionTicket(response.ticket, now)).toEqual(principal);
  });
});
