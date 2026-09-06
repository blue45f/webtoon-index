import { and, count, eq, inArray, sql } from "drizzle-orm";
import * as Y from "yjs";

import { readStudioCrdtRasterDocument } from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_ASSET_CONTRACT_VERSION,
  STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";
import {
  creatorWorkCollaborators,
  creatorWorks,
  db,
} from "../../db";
import { creatorWorkRasterAssets } from "../../db/studio-raster-asset.schema";

import { resolveCreatorCollaborationAccess } from "./creator-collaboration.policy";
import {
  loadStudioCrdtDocumentInTransaction,
  withStudioCrdtWorkMutationLock,
} from "./studio-crdt.repository";

import type {
  CreatorCollaborationAccess,
  CreatorCollaborationMembershipLike,
} from "./creator-collaboration.policy";
import type {
  DrizzleStudioCrdtTransaction,
  StudioCrdtHydrationState,
} from "./studio-crdt.repository";
import type {
  StudioRasterAssetManifest,
  StudioRasterStorageMediaType,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";

export const STUDIO_RASTER_ASSET_REPOSITORY = Symbol("STUDIO_RASTER_ASSET_REPOSITORY");

type DrizzleStudioRasterAssetTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class StudioRasterAssetNotFoundError extends Error {
  constructor() {
    super("studio_raster_asset_not_found");
    this.name = "StudioRasterAssetNotFoundError";
  }
}

export class StudioRasterAssetForbiddenError extends Error {
  constructor(readonly operation: "view" | "edit") {
    super(`studio_raster_asset_${operation}_forbidden`);
    this.name = "StudioRasterAssetForbiddenError";
  }
}

export class StudioRasterAssetImmutableConflictError extends Error {
  constructor() {
    super("studio_raster_asset_immutable_conflict");
    this.name = "StudioRasterAssetImmutableConflictError";
  }
}

export class StudioRasterAssetQuotaError extends Error {
  constructor(readonly quota: "count" | "bytes") {
    super(`studio_raster_asset_${quota}_quota`);
    this.name = "StudioRasterAssetQuotaError";
  }
}

export class StudioRasterAssetCleanupOwnershipError extends Error {
  constructor() {
    super("studio_raster_asset_cleanup_ownership");
    this.name = "StudioRasterAssetCleanupOwnershipError";
  }
}

export class StudioRasterAssetReferencedError extends Error {
  constructor() {
    super("studio_raster_asset_referenced");
    this.name = "StudioRasterAssetReferencedError";
  }
}

export interface StudioRasterAssetWrite {
  workId: string;
  assetId: string;
  sha256: string;
  mediaType: StudioRasterStorageMediaType;
  width: number;
  height: number;
  payload: Uint8Array;
}

export interface StudioRasterAssetContent {
  manifest: StudioRasterAssetManifest;
  payload: Uint8Array;
}

export interface StudioRasterAssetRepository {
  put(actorUserId: string, input: StudioRasterAssetWrite): Promise<StudioRasterAssetManifest>;
  getManifest(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetManifest>;
  getManifests(
    actorUserId: string,
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioRasterAssetManifest[]>;
  getManifestsInTransaction(
    transaction: DrizzleStudioCrdtTransaction,
    actorUserId: string,
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioRasterAssetManifest[]>;
  getContent(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetContent>;
  deleteUnreferencedUpload(
    actorUserId: string,
    input: StudioRasterAssetCleanupReceipt
  ): Promise<boolean>;
}

export type StudioRasterAssetCleanupReceipt = Pick<
  StudioRasterAssetWrite,
  "workId" | "assetId" | "sha256" | "mediaType" | "width" | "height"
> & { byteLength: number };

export interface StudioRasterAssetCleanupCandidate {
  assetId: string;
  sha256: string;
  mediaType: StudioRasterStorageMediaType;
  width: number;
  height: number;
  byteLength: number;
  uploadedBy: string | null;
}

type ImmutableRasterMetadata = Pick<
  StudioRasterAssetWrite,
  "assetId" | "sha256" | "mediaType" | "width" | "height"
> & { byteLength: number };

export function isStudioRasterAssetIdempotentReplay(
  existing: ImmutableRasterMetadata,
  incoming: ImmutableRasterMetadata
): boolean {
  return (
    existing.assetId === incoming.assetId &&
    existing.sha256 === incoming.sha256 &&
    existing.mediaType === incoming.mediaType &&
    existing.width === incoming.width &&
    existing.height === incoming.height &&
    existing.byteLength === incoming.byteLength
  );
}

/**
 * Receipt-bound upload compensation only. Identity mismatches are idempotent no-ops, while a
 * different uploader or an identity that reached the durable raster frontier fails closed.
 */
export function planStudioRasterAssetOrphanCleanup(input: {
  existing: StudioRasterAssetCleanupCandidate | null;
  actorUserId: string;
  receipt: Omit<StudioRasterAssetCleanupReceipt, "workId">;
  durablyReferenced: boolean;
}): boolean {
  const existing = input.existing;
  if (!existing || !isStudioRasterAssetIdempotentReplay(existing, input.receipt)) return false;
  if (existing.uploadedBy !== input.actorUserId) {
    throw new StudioRasterAssetCleanupOwnershipError();
  }
  if (input.durablyReferenced) throw new StudioRasterAssetReferencedError();
  return true;
}

/** Replays the exact retained frontier; malformed storage throws so cleanup cannot guess. */
export function studioCrdtHydrationReferencesRasterAsset(
  state: StudioCrdtHydrationState,
  assetId: string
): boolean {
  const document = new Y.Doc({ gc: false });
  try {
    if (state.snapshot) {
      Y.applyUpdate(document, state.snapshot.snapshot, "raster-asset-cleanup-snapshot");
    }
    for (const update of state.updates) {
      Y.applyUpdate(document, update.payload, "raster-asset-cleanup-update");
    }
    return readStudioCrdtRasterDocument(document).assets.has(assetId);
  } finally {
    document.destroy();
  }
}

export function assertStudioRasterAssetQuota(input: {
  assetCount: number;
  totalBytes: number;
  incomingBytes: number;
}): void {
  if (
    !Number.isSafeInteger(input.assetCount) ||
    input.assetCount < 0 ||
    input.assetCount >= STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK
  ) {
    throw new StudioRasterAssetQuotaError("count");
  }
  const nextTotalBytes = input.totalBytes + input.incomingBytes;
  if (
    !Number.isSafeInteger(input.totalBytes) ||
    input.totalBytes < 0 ||
    !Number.isSafeInteger(input.incomingBytes) ||
    input.incomingBytes < 1 ||
    !Number.isSafeInteger(nextTotalBytes) ||
    nextTotalBytes > STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK
  ) {
    throw new StudioRasterAssetQuotaError("bytes");
  }
}

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function manifestFrom(
  row: typeof creatorWorkRasterAssets.$inferSelect
): StudioRasterAssetManifest {
  return {
    version: STUDIO_RASTER_ASSET_CONTRACT_VERSION,
    scope: "work",
    assetId: row.assetId,
    sha256: row.sha256,
    byteLength: row.byteLength,
    mediaType: row.mediaType as StudioRasterStorageMediaType,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  };
}

export function resolveStudioRasterAssetAccess(input: {
  actorUserId: string;
  ownerUserId: string;
  membership?: CreatorCollaborationMembershipLike | null;
}): Pick<CreatorCollaborationAccess, "view" | "edit"> {
  const access = resolveCreatorCollaborationAccess(input);
  return { view: access.view, edit: access.edit };
}

async function workAccess(
  transaction: DrizzleStudioRasterAssetTransaction,
  actorUserId: string,
  workId: string,
  lock: boolean
): Promise<Pick<CreatorCollaborationAccess, "view" | "edit">> {
  let workQuery = transaction
    .select({ ownerUserId: creatorWorks.userId })
    .from(creatorWorks)
    .where(eq(creatorWorks.id, workId))
    .limit(1);
  if (lock) workQuery = workQuery.for("update") as typeof workQuery;
  const [work] = await workQuery;
  if (!work) throw new StudioRasterAssetNotFoundError();

  const [membership] = actorUserId === work.ownerUserId
    ? []
    : await transaction
        .select({
          userId: creatorWorkCollaborators.userId,
          role: creatorWorkCollaborators.role,
          status: creatorWorkCollaborators.status,
        })
        .from(creatorWorkCollaborators)
        .where(
          and(
            eq(creatorWorkCollaborators.workId, workId),
            eq(creatorWorkCollaborators.userId, actorUserId)
          )
        )
        .limit(1);
  return resolveStudioRasterAssetAccess({
    actorUserId,
    ownerUserId: work.ownerUserId,
    membership: membership ?? null,
  });
}

async function requireAccess(
  transaction: DrizzleStudioRasterAssetTransaction,
  actorUserId: string,
  workId: string,
  operation: "view" | "edit",
  lock: boolean
): Promise<void> {
  const access = await workAccess(transaction, actorUserId, workId, lock);
  if (!access[operation]) throw new StudioRasterAssetForbiddenError(operation);
}

async function readAsset(
  transaction: DrizzleStudioRasterAssetTransaction,
  actorUserId: string,
  workId: string,
  assetId: string
): Promise<typeof creatorWorkRasterAssets.$inferSelect> {
  await requireAccess(transaction, actorUserId, workId, "view", false);
  const [row] = await transaction
    .select()
    .from(creatorWorkRasterAssets)
    .where(
      and(
        eq(creatorWorkRasterAssets.workId, workId),
        eq(creatorWorkRasterAssets.assetId, assetId)
      )
    )
    .limit(1);
  if (!row) throw new StudioRasterAssetNotFoundError();
  return row;
}

/**
 * The work row is the authorization fence shared with collaboration role mutations. Content
 * addresses never update; the sole deletion path is the CRDT-locked upload compensation below.
 */
export class DrizzleStudioRasterAssetRepository implements StudioRasterAssetRepository {
  async put(
    actorUserId: string,
    input: StudioRasterAssetWrite
  ): Promise<StudioRasterAssetManifest> {
    return db.transaction(async (transaction) => {
      await requireAccess(transaction, actorUserId, input.workId, "edit", true);
      const [existing] = await transaction
        .select()
        .from(creatorWorkRasterAssets)
        .where(
          and(
            eq(creatorWorkRasterAssets.workId, input.workId),
            eq(creatorWorkRasterAssets.assetId, input.assetId)
          )
        )
        .limit(1);
      if (existing) {
        if (!isStudioRasterAssetIdempotentReplay({
          assetId: existing.assetId,
          sha256: existing.sha256,
          mediaType: existing.mediaType as StudioRasterStorageMediaType,
          width: existing.width,
          height: existing.height,
          byteLength: existing.byteLength,
        }, {
          ...input,
          byteLength: input.payload.byteLength,
        })) {
          throw new StudioRasterAssetImmutableConflictError();
        }
        return manifestFrom(existing);
      }

      const [usage] = await transaction
        .select({
          assetCount: count(),
          totalBytes: sql<string>`coalesce(sum(${creatorWorkRasterAssets.byteLength}), 0)`,
        })
        .from(creatorWorkRasterAssets)
        .where(eq(creatorWorkRasterAssets.workId, input.workId));
      assertStudioRasterAssetQuota({
        assetCount: Number(usage?.assetCount ?? 0),
        totalBytes: Number(usage?.totalBytes ?? 0),
        incomingBytes: input.payload.byteLength,
      });

      const [stored] = await transaction
        .insert(creatorWorkRasterAssets)
        .values({
          workId: input.workId,
          assetId: input.assetId,
          sha256: input.sha256,
          mediaType: input.mediaType,
          width: input.width,
          height: input.height,
          payload: copyBytes(input.payload),
          byteLength: input.payload.byteLength,
          uploadedBy: actorUserId,
        })
        .returning();
      if (!stored) throw new Error("studio raster asset insert returned no row");
      return manifestFrom(stored);
    });
  }

  async getManifest(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetManifest> {
    return db.transaction(
      async (transaction) => manifestFrom(
        await readAsset(transaction, actorUserId, workId, assetId)
      ),
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  }

  async getManifests(
    actorUserId: string,
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioRasterAssetManifest[]> {
    if (assetIds.length === 0) return [];
    return db.transaction(
      (transaction) => this.getManifestsInTransaction(
        transaction,
        actorUserId,
        workId,
        assetIds
      ),
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  }

  async getManifestsInTransaction(
    transaction: DrizzleStudioCrdtTransaction,
    actorUserId: string,
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioRasterAssetManifest[]> {
    if (assetIds.length === 0) return [];
    await requireAccess(transaction, actorUserId, workId, "view", false);
    const rows = await transaction
      .select()
      .from(creatorWorkRasterAssets)
      .where(
        and(
          eq(creatorWorkRasterAssets.workId, workId),
          inArray(creatorWorkRasterAssets.assetId, [...new Set(assetIds)])
        )
      );
    return rows.map(manifestFrom);
  }

  async getContent(
    actorUserId: string,
    workId: string,
    assetId: string
  ): Promise<StudioRasterAssetContent> {
    return db.transaction(
      async (transaction) => {
        const row = await readAsset(transaction, actorUserId, workId, assetId);
        return { manifest: manifestFrom(row), payload: copyBytes(row.payload) };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  }

  async deleteUnreferencedUpload(
    actorUserId: string,
    input: StudioRasterAssetCleanupReceipt
  ): Promise<boolean> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        // CRDT append/compaction and compensation share this per-work fence. No durable reference
        // can be admitted between the replay proof and the physical delete.
        await requireAccess(transaction, actorUserId, input.workId, "edit", true);
        const [row] = await transaction
          .select({
            assetId: creatorWorkRasterAssets.assetId,
            sha256: creatorWorkRasterAssets.sha256,
            mediaType: creatorWorkRasterAssets.mediaType,
            width: creatorWorkRasterAssets.width,
            height: creatorWorkRasterAssets.height,
            byteLength: creatorWorkRasterAssets.byteLength,
            uploadedBy: creatorWorkRasterAssets.uploadedBy,
          })
          .from(creatorWorkRasterAssets)
          .where(
            and(
              eq(creatorWorkRasterAssets.workId, input.workId),
              eq(creatorWorkRasterAssets.assetId, input.assetId)
            )
          )
          .limit(1);
        const existing = row
          ? { ...row, mediaType: row.mediaType as StudioRasterStorageMediaType }
          : null;
        const durable = await loadStudioCrdtDocumentInTransaction(transaction, input.workId);
        if (!planStudioRasterAssetOrphanCleanup({
          existing,
          actorUserId,
          receipt: input,
          durablyReferenced: studioCrdtHydrationReferencesRasterAsset(durable, input.assetId),
        })) return false;

        const deleted = await transaction
          .delete(creatorWorkRasterAssets)
          .where(
            and(
              eq(creatorWorkRasterAssets.workId, input.workId),
              eq(creatorWorkRasterAssets.assetId, input.assetId),
              eq(creatorWorkRasterAssets.sha256, input.sha256),
              eq(creatorWorkRasterAssets.mediaType, input.mediaType),
              eq(creatorWorkRasterAssets.width, input.width),
              eq(creatorWorkRasterAssets.height, input.height),
              eq(creatorWorkRasterAssets.byteLength, input.byteLength),
              eq(creatorWorkRasterAssets.uploadedBy, actorUserId)
            )
          )
          .returning({ assetId: creatorWorkRasterAssets.assetId });
        return deleted.length > 0;
      })
    );
  }
}

export const studioRasterAssetRepositoryProvider = {
  provide: STUDIO_RASTER_ASSET_REPOSITORY,
  useFactory: (): StudioRasterAssetRepository => new DrizzleStudioRasterAssetRepository(),
};
