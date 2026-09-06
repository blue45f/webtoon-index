import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  StudioTeamCommentLiveEventSchema,
  type StudioTeamCommentLiveEvent,
} from "../../../../web/src/shared/lib/studio-team-comment-live-event";

import { StudioLiveGateway } from "./studio-live.gateway";

export type StudioTeamCommentLivePublishResult =
  | { published: true; event: StudioTeamCommentLiveEvent }
  | {
      published: false;
      reason: "invalid_event" | "gateway_unavailable";
    };

/**
 * Best-effort bridge from committed HTTP comment mutations to the Studio room.
 *
 * The database response remains authoritative: Socket.IO fan-out is only a tiny invalidation
 * hint, so validation, adapter outages, or an API node still starting must never turn a committed
 * comment into a failed HTTP response.
 */
@Injectable()
export class StudioTeamCommentLivePublisher {
  private readonly logger = new Logger(StudioTeamCommentLivePublisher.name);

  constructor(
    @Inject(StudioLiveGateway)
    private readonly gateway: StudioLiveGateway
  ) {}

  publish(value: unknown): StudioTeamCommentLivePublishResult {
    const parsed = StudioTeamCommentLiveEventSchema.safeParse(value);
    if (!parsed.success) {
      this.warn("invalid_event");
      return { published: false, reason: "invalid_event" };
    }

    try {
      if (!this.gateway.publishTeamCommentChanged(parsed.data)) {
        this.warn("gateway_unavailable");
        return { published: false, reason: "gateway_unavailable" };
      }
      return { published: true, event: parsed.data };
    } catch {
      this.warn("gateway_unavailable");
      return { published: false, reason: "gateway_unavailable" };
    }
  }

  private warn(reason: "invalid_event" | "gateway_unavailable"): void {
    try {
      this.logger.warn(
        { reason },
        "studio team comment live invalidation was not published"
      );
    } catch {
      // Logging is diagnostic only and must not affect the committed HTTP mutation.
    }
  }
}
