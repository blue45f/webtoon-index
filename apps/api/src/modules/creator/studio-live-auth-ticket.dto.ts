import { createZodDto } from "nestjs-zod";

import {
  StudioLiveAuthTicketRequestSchema,
  StudioLiveAuthTicketResponseSchema,
} from "../../../../web/src/shared/lib/studio-live-auth-ticket";

export class StudioLiveAuthTicketRequestDto extends createZodDto(
  StudioLiveAuthTicketRequestSchema,
) {}

export class StudioLiveAuthTicketResponseDto extends createZodDto(
  StudioLiveAuthTicketResponseSchema,
) {}
