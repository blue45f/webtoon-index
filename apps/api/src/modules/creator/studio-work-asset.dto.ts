import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import { StudioWorkAssetTypeSchema } from "../../../../web/src/shared/lib/studio-work-asset-contract";

const ExactAssetIdSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim().length > 0, "에셋 식별자가 비어 있습니다.")
  .refine(
    (value) => ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    }),
    "에셋 식별자에 제어 문자를 사용할 수 없습니다."
  );

const GeneratedObjectPurposeSchema = z.enum(["derived", "export"]);
const StorageObjectDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const ShortSignedReadLifetimeSchema = z.preprocess(
  (value) => (
    typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value
  ),
  z.number().int().min(30).max(300),
).default(120);

export const StudioWorkAssetParamsSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    assetId: ExactAssetIdSchema,
  })
  .strict();

export const StudioWorkAssetWorkParamsSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
  })
  .strict();

export const StudioWorkAssetTypeQuerySchema = z
  .object({ elementType: StudioWorkAssetTypeSchema })
  .strict();

export const StudioWorkAssetGeneratedParamsSchema = StudioWorkAssetParamsSchema
  .extend({
    purpose: GeneratedObjectPurposeSchema,
    referenceId: ExactAssetIdSchema,
  })
  .strict();

export const StudioWorkAssetSignedReadQuerySchema = z
  .object({
    expiresInSeconds: ShortSignedReadLifetimeSchema,
  })
  .strict();

export const StudioWorkAssetSourceSignedReadQuerySchema = StudioWorkAssetTypeQuerySchema
  .extend({
    expiresInSeconds: ShortSignedReadLifetimeSchema,
  })
  .strict();

export const UploadStudioWorkAssetGeneratedObjectSchema = z
  .object({ elementType: StudioWorkAssetTypeSchema })
  .strict();

export const DeleteStudioWorkAssetGeneratedObjectQuerySchema = z
  .object({ expectedDigest: StorageObjectDigestSchema })
  .strict();

export const DeleteStudioWorkAssetQuerySchema = StudioWorkAssetTypeQuerySchema
  .extend({ expectedSha256: z.string().regex(/^[0-9a-f]{64}$/u) })
  .strict();

export const UploadStudioWorkAssetSchema = z
  .object({
    elementType: StudioWorkAssetTypeSchema,
    descriptor: z.string().min(2).max(4_096),
  })
  .strict();

export class StudioWorkAssetParamsDto extends createZodDto(StudioWorkAssetParamsSchema) {}
export class StudioWorkAssetWorkParamsDto extends createZodDto(StudioWorkAssetWorkParamsSchema) {}
export class StudioWorkAssetTypeQueryDto extends createZodDto(StudioWorkAssetTypeQuerySchema) {}
export class StudioWorkAssetGeneratedParamsDto extends createZodDto(
  StudioWorkAssetGeneratedParamsSchema
) {}
export class StudioWorkAssetSignedReadQueryDto extends createZodDto(
  StudioWorkAssetSignedReadQuerySchema
) {}
export class StudioWorkAssetSourceSignedReadQueryDto extends createZodDto(
  StudioWorkAssetSourceSignedReadQuerySchema
) {}
export class UploadStudioWorkAssetGeneratedObjectDto extends createZodDto(
  UploadStudioWorkAssetGeneratedObjectSchema
) {}
export class DeleteStudioWorkAssetGeneratedObjectQueryDto extends createZodDto(
  DeleteStudioWorkAssetGeneratedObjectQuerySchema
) {}
export class DeleteStudioWorkAssetQueryDto extends createZodDto(DeleteStudioWorkAssetQuerySchema) {}
export class UploadStudioWorkAssetDto extends createZodDto(UploadStudioWorkAssetSchema) {}

export const UploadStudioWorkAssetLayerLiftBatchSchema = z
  .object({
    metadata: z.string().min(2).max(12_288),
  })
  .strict();

export class UploadStudioWorkAssetLayerLiftBatchDto extends createZodDto(
  UploadStudioWorkAssetLayerLiftBatchSchema
) {}
