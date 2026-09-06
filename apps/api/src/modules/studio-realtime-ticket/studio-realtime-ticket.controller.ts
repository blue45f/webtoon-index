import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ZodSerializerDto } from "nestjs-zod";

import { STUDIO_LIVE_GUEST_CREDENTIAL_TTL_MS } from "../../../../web/src/shared/lib/studio-live-auth-ticket";
import {
  isStudioLiveJamScope,
  studioRealtimeJamGuestActorId,
} from "../../../../web/src/shared/lib/studio-live-jam-scope";
import {
  getSessionAuthenticationPrincipal,
  getSessionAuthenticationSource,
} from "../../session-middleware";

import {
  IssueStudioRealtimeTicketDto,
  StudioRealtimeTicketResponseDto,
} from "./studio-realtime-ticket.dto";
import { StudioRealtimeTicketService } from "./studio-realtime-ticket.service";

import type { Request } from "express";

@Controller("studio-realtime")
export class StudioRealtimeTicketController {
  constructor(
    @Inject(StudioRealtimeTicketService)
    private readonly service: StudioRealtimeTicketService,
  ) {}

  @Post("tickets")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("Referrer-Policy", "no-referrer")
  @Header("Vary", "Origin")
  @ZodSerializerDto(StudioRealtimeTicketResponseDto)
  issue(
    @Req() request: Request,
    @Headers("origin") origin: string | undefined,
    @Body() body: IssueStudioRealtimeTicketDto,
  ): Promise<StudioRealtimeTicketResponseDto> {
    const source = getSessionAuthenticationSource(request);
    const principal = getSessionAuthenticationPrincipal(request);
    if (source === "cookie" && principal) {
      return this.service.issue(principal, origin, body);
    }
    if (source !== "header" && isStudioLiveJamScope(body.scope)) {
      return this.service.issue(
        {
          userId: studioRealtimeJamGuestActorId(body.sessionId),
          sessionVersion: 1,
          expiresAt: Date.now() + STUDIO_LIVE_GUEST_CREDENTIAL_TTL_MS,
        },
        origin,
        body,
      );
    }
    throw new UnauthorizedException("로그인이 필요해요.");
  }
}
