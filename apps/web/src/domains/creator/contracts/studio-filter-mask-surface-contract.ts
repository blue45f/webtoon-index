import { z } from "zod";

import {
  STUDIO_RASTER_CRDT_VERSION,
  type StudioRasterSurfaceSpec,
} from "./studio-crdt-raster-ops";

export const STUDIO_FILTER_MASK_SURFACE_TILE_SIZE = 1_024 as const;
export const STUDIO_FILTER_MASK_SURFACE_MAX_EDGE = 4_096 as const;

const STUDIO_FILTER_MASK_SURFACE_ID_PREFIX = "filter-mask:v1:" as const;
const STUDIO_FILTER_MASK_SURFACE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Runtime validation is authoritative because IDs cross JSON/Yjs/network boundaries. Keep the TS
 * alias interoperable with those string-based APIs instead of relying on an unsound template cast.
 */
export type StudioFilterMaskSurfaceId = string;

/**
 * Immutable identity of one filter-mask raster surface.
 *
 * The prefix keeps the reference distinguishable from authored layer surfaces and the exact
 * lowercase UUID form prevents two spellings from addressing the same immutable CRDT root.
 */
export const StudioFilterMaskSurfaceIdSchema = z
  .string()
  .refine(
    (value) => (
      value.startsWith(STUDIO_FILTER_MASK_SURFACE_ID_PREFIX)
      && STUDIO_FILTER_MASK_SURFACE_UUID_PATTERN.test(
        value.slice(STUDIO_FILTER_MASK_SURFACE_ID_PREFIX.length)
      )
    ),
    "필터 마스크 surface ID가 올바르지 않습니다."
  )
  .transform((value) => value as StudioFilterMaskSurfaceId);

export const STUDIO_FILTER_MASK_REFERENCE_EDIT_KEYS = [
  "filterMaskSurfaceId",
  "filterMaskEnabled",
] as const;

export const StudioFilterMaskReferencePropsSchema = z
  .object({
    filterMaskSurfaceId: StudioFilterMaskSurfaceIdSchema,
    filterMaskEnabled: z.boolean().optional(),
  })
  .strict();

export type StudioFilterMaskReferenceProps = z.infer<
  typeof StudioFilterMaskReferencePropsSchema
>;

const StudioFilterMaskSurfaceSpecSchema = z
  .object({
    version: z.literal(STUDIO_RASTER_CRDT_VERSION),
    surfaceId: StudioFilterMaskSurfaceIdSchema,
    width: z.number().int().min(1).max(STUDIO_FILTER_MASK_SURFACE_MAX_EDGE),
    height: z.number().int().min(1).max(STUDIO_FILTER_MASK_SURFACE_MAX_EDGE),
    tileSize: z.literal(STUDIO_FILTER_MASK_SURFACE_TILE_SIZE),
  })
  .strict();

export type StudioFilterMaskSurfaceSpec = StudioRasterSurfaceSpec & {
  readonly surfaceId: StudioFilterMaskSurfaceId;
  readonly tileSize: typeof STUDIO_FILTER_MASK_SURFACE_TILE_SIZE;
};

export function isStudioFilterMaskSurfaceId(
  value: unknown
): value is StudioFilterMaskSurfaceId {
  return StudioFilterMaskSurfaceIdSchema.safeParse(value).success;
}

export function createStudioFilterMaskSurfaceId(
  uuid = globalThis.crypto.randomUUID()
): StudioFilterMaskSurfaceId {
  return StudioFilterMaskSurfaceIdSchema.parse(
    `${STUDIO_FILTER_MASK_SURFACE_ID_PREFIX}${uuid}`
  );
}

export function createStudioFilterMaskSurfaceSpec(input: {
  readonly surfaceId?: StudioFilterMaskSurfaceId;
  readonly width: number;
  readonly height: number;
}): StudioFilterMaskSurfaceSpec {
  return StudioFilterMaskSurfaceSpecSchema.parse({
    version: STUDIO_RASTER_CRDT_VERSION,
    surfaceId: input.surfaceId ?? createStudioFilterMaskSurfaceId(),
    width: input.width,
    height: input.height,
    tileSize: STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
  }) as StudioFilterMaskSurfaceSpec;
}

export function isStudioFilterMaskSurfaceSpec(
  value: unknown
): value is StudioFilterMaskSurfaceSpec {
  return StudioFilterMaskSurfaceSpecSchema.safeParse(value).success;
}

export function isStudioFilterMaskReferenceProps(
  value: unknown
): value is StudioFilterMaskReferenceProps {
  return StudioFilterMaskReferencePropsSchema.safeParse(value).success;
}
