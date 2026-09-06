import { z } from "zod";

export const STUDIO_LIVE_AUTH_TICKET_VERSION = 1 as const;
export const STUDIO_LIVE_AUTH_TICKET_TTL_MS = 60_000;
export const STUDIO_LIVE_AUTH_TICKET_MAX_CODE_UNITS = 4_096;
export const STUDIO_LIVE_GUEST_CREDENTIAL_TTL_MS = 4 * 60 * 60 * 1_000;

export const StudioLiveGuestCredentialSchema = z
  .string()
  .regex(
    /^guest:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );

export const StudioLiveAuthTicketRequestSchema = z
  .object({ version: z.literal(STUDIO_LIVE_AUTH_TICKET_VERSION) })
  .strict();

export const StudioLiveAuthTicketResponseSchema = z
  .object({
    version: z.literal(STUDIO_LIVE_AUTH_TICKET_VERSION),
    ticket: z
      .string()
      .min(80)
      .max(STUDIO_LIVE_AUTH_TICKET_MAX_CODE_UNITS)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const issuedAt = Date.parse(value.issuedAt);
    const expiresAt = Date.parse(value.expiresAt);
    if (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > STUDIO_LIVE_AUTH_TICKET_TTL_MS
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "studio live admission ticket lifetime is invalid",
      });
    }
  });

export type StudioLiveAuthTicketRequest = z.infer<
  typeof StudioLiveAuthTicketRequestSchema
>;
export type StudioLiveAuthTicketResponse = z.infer<
  typeof StudioLiveAuthTicketResponseSchema
>;
