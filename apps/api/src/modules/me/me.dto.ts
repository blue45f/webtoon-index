import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import {
  MAX_COLLECTION_ID_LENGTH,
  normalizeCollectionEmoji,
  normalizeCollectionName,
} from "../../../../web/src/shared/lib/collection-contract";

export {
  MAX_COLLECTION_EMOJI_LENGTH,
  MAX_COLLECTION_ID_LENGTH,
  MAX_COLLECTION_NAME_LENGTH,
} from "../../../../web/src/shared/lib/collection-contract";

const CollectionOpaqueIdSchema = z
  .string()
  .trim()
  .min(1, "컬렉션 id가 필요합니다.")
  .max(MAX_COLLECTION_ID_LENGTH, "컬렉션 id가 너무 깁니다.")
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      }),
    "컬렉션 id에 제어 문자를 사용할 수 없습니다."
  );

const CollectionClientIdSchema = z
  .uuidv4("컬렉션 id가 올바른 UUID v4가 아닙니다.")
  .transform((value) => value.toLowerCase());
const CollectionNameSchema = z
  .string()
  .transform(normalizeCollectionName)
  .pipe(z.string().min(1, "컬렉션 이름이 필요합니다."));
const CollectionEmojiSchema = z
  .string()
  .optional()
  .transform(normalizeCollectionEmoji);
const CollectionTitleIdSchema = z
  .string()
  .trim()
  .min(1, "titleId가 필요합니다.")
  .max(MAX_COLLECTION_ID_LENGTH, "titleId가 너무 깁니다.");

const CreateCollectionSchema = z
  .object({
    action: z.literal("create"),
    // Optional for rolling compatibility with cached clients. New clients generate one UUID and
    // use it as the optimistic and persisted identity, so follow-up commands never need remapping.
    id: CollectionClientIdSchema.optional(),
    name: CollectionNameSchema,
    emoji: CollectionEmojiSchema,
  })
  .strict();

const RenameCollectionSchema = z
  .object({
    action: z.literal("rename"),
    id: CollectionOpaqueIdSchema,
    name: CollectionNameSchema,
  })
  .strict();

const DeleteCollectionSchema = z
  .object({
    action: z.literal("delete"),
    id: CollectionOpaqueIdSchema,
  })
  .strict();

const SetCollectionItemSchema = z
  .object({
    action: z.literal("set-item"),
    id: CollectionOpaqueIdSchema,
    titleId: CollectionTitleIdSchema,
    included: z.boolean(),
  })
  .strict();

const LegacyToggleCollectionItemSchema = z
  .object({
    action: z.literal("toggle"),
    id: CollectionOpaqueIdSchema,
    titleId: CollectionTitleIdSchema,
  })
  .strict();

export const CollectionMutationSchema = z.discriminatedUnion("action", [
  CreateCollectionSchema,
  RenameCollectionSchema,
  DeleteCollectionSchema,
  SetCollectionItemSchema,
  LegacyToggleCollectionItemSchema,
]);

export type CollectionMutation = z.output<typeof CollectionMutationSchema>;

// createZodDto classes must have one statically-known object shape. The strict envelope delegates
// its cross-field/action contract to the discriminated union, and the controller performs the
// canonical second parse so transformed names/emoji reach the service.
const CollectionMutationEnvelopeSchema = z
  .object({
    action: z.enum(["create", "rename", "delete", "set-item", "toggle"]),
    id: z.string().optional(),
    titleId: z.string().optional(),
    name: z.string().optional(),
    emoji: z.string().optional(),
    included: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = CollectionMutationSchema.safeParse(value);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });

export class CollectionMutationDto extends createZodDto(CollectionMutationEnvelopeSchema) {}
