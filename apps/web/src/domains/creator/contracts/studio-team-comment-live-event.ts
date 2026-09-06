import { z } from "zod";

export const STUDIO_TEAM_COMMENT_LIVE_EVENT_VERSION = 1 as const;

const BoundedIdSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), "식별자 앞뒤에 공백을 사용할 수 없습니다.")
  .refine(
    (value) => !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    }),
    "식별자에 제어 문자를 사용할 수 없습니다."
  );

const ACTIVITY_SEQUENCE_PATTERN = /^[1-9]\d{0,18}$/u;

const ActivitySequenceSchema = z
  .string()
  .regex(ACTIVITY_SEQUENCE_PATTERN)
  .refine((value) => (
    ACTIVITY_SEQUENCE_PATTERN.test(value)
    && BigInt(value) <= BigInt("9223372036854775807")
  ));

export const StudioTeamCommentLiveEventSchema = z.object({
  version: z.literal(STUDIO_TEAM_COMMENT_LIVE_EVENT_VERSION),
  workId: BoundedIdSchema,
  threadId: BoundedIdSchema,
  activitySequence: ActivitySequenceSchema,
  kind: z.enum(["created", "replied", "resolved", "reopened", "reanchored"]),
}).strict();

export type StudioTeamCommentLiveEvent = z.infer<typeof StudioTeamCommentLiveEventSchema>;

/** Parses a tiny invalidation event only for the currently joined Studio work room. */
export function parseStudioTeamCommentLiveEvent(
  value: unknown,
  expectedWorkId: string
): StudioTeamCommentLiveEvent | null {
  const parsed = StudioTeamCommentLiveEventSchema.safeParse(value);
  if (!parsed.success || parsed.data.workId !== expectedWorkId) return null;
  return parsed.data;
}

/** Monotonic activity sequences make duplicate and reordered socket delivery harmless. */
export function isNewerStudioTeamCommentLiveEvent(
  event: StudioTeamCommentLiveEvent,
  knownActivitySequence: string | null | undefined
): boolean {
  if (!knownActivitySequence || !ActivitySequenceSchema.safeParse(knownActivitySequence).success) {
    return true;
  }
  return BigInt(event.activitySequence) > BigInt(knownActivitySequence);
}
