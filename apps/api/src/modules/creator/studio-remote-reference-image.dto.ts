import { createZodDto } from "nestjs-zod";

import {
  StudioRemoteReferenceImageRequestSchema,
  StudioRemoteReferenceImageResponseSchema,
} from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

export class StudioRemoteReferenceImageRequestDto extends createZodDto(
  StudioRemoteReferenceImageRequestSchema
) {}

export class StudioRemoteReferenceImageResponseDto extends createZodDto(
  StudioRemoteReferenceImageResponseSchema
) {}
