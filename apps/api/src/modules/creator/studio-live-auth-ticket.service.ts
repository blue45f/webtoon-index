import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import {
  STUDIO_LIVE_AUTH_TICKET_VERSION,
  StudioLiveAuthTicketRequestSchema,
  StudioLiveAuthTicketResponseSchema,
  type StudioLiveAuthTicketRequest,
  type StudioLiveAuthTicketResponse,
} from "../../../../web/src/shared/lib/studio-live-auth-ticket";
import {
  signStudioLiveAdmissionTicket,
  type VerifiedSessionToken,
} from "../../server/session";

const TICKET_UNAVAILABLE_MESSAGE = "실시간 팀 연결 정보를 발급할 수 없습니다.";

@Injectable()
export class StudioLiveAuthTicketService {
  issue(
    principal: VerifiedSessionToken,
    unsafeRequest: StudioLiveAuthTicketRequest,
    now: number = Date.now(),
  ): StudioLiveAuthTicketResponse {
    const request = StudioLiveAuthTicketRequestSchema.parse(unsafeRequest);
    if (request.version !== STUDIO_LIVE_AUTH_TICKET_VERSION) {
      throw new ServiceUnavailableException(TICKET_UNAVAILABLE_MESSAGE);
    }
    try {
      const signed = signStudioLiveAdmissionTicket(principal, now);
      return StudioLiveAuthTicketResponseSchema.parse({
        version: STUDIO_LIVE_AUTH_TICKET_VERSION,
        ticket: signed.ticket,
        issuedAt: new Date(signed.issuedAt).toISOString(),
        expiresAt: new Date(signed.expiresAt).toISOString(),
      });
    } catch {
      throw new ServiceUnavailableException(TICKET_UNAVAILABLE_MESSAGE);
    }
  }
}
