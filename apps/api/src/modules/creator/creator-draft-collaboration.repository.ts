import { randomUUID } from "node:crypto";

import { and, count, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import {
  assertStudioLinked3dPassAssetRows,
  extractStudioLinked3dPassAssetRequirements,
  type StudioLinked3dPassAssetRow,
} from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import {
  creatorDraftCollaborationRooms,
  creatorWorkAssets,
  creatorWorkRevisions,
  creatorWorks,
  db,
} from "../../db";
import { createCreatorWorkRevisionSnapshot } from "../../server/creator-work-revisions";

import {
  isCreatorDraftCollaborationFinalStatus,
  isCreatorDraftCollaborationProvisionIntent,
  type CreatorDraftCollaborationFinalStatus,
  type CreatorDraftCollaborationProvisionIntent,
} from "./creator-draft-collaboration.contract";

export const CREATOR_DRAFT_COLLABORATION_REPOSITORY = Symbol(
  "CREATOR_DRAFT_COLLABORATION_REPOSITORY"
);

export const CREATOR_DRAFT_COLLABORATION_INITIAL_SNAPSHOT_MAX_BYTES =
  16 * 1_024 * 1_024;
export const CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS =
  7 * 24 * 60 * 60 * 1_000;
export const CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS = 10 * 60 * 1_000;
export const CREATOR_DRAFT_COLLABORATION_PROVISION_LIMIT = 5;
export const CREATOR_DRAFT_COLLABORATION_ACTIVE_ROOM_LIMIT = 16;
export const CREATOR_DRAFT_COLLABORATION_CLEANUP_BATCH = 32;

const CREATOR_DRAFT_COLLABORATION_OWNER_LOCK_NAMESPACE =
  "toonspectrum:creator-draft-collaboration-owner:v1:";

export type CreatorDraftCollaborationRoomStatus = "active" | "promoted";

export interface CreatorDraftCollaborationRoomRecord {
  readonly roomId: string;
  readonly draftDocumentId: string;
  readonly ownerUserId: string;
  readonly workId: string;
  readonly status: CreatorDraftCollaborationRoomStatus;
  readonly graphRevision: number;
  readonly initialSnapshotByteLength: number;
  readonly provisionIntent: CreatorDraftCollaborationProvisionIntent;
  readonly provisionMutationId: string;
  readonly promotionMutationId: string | null;
  readonly promotionExpectedWorkRevision: number | null;
  readonly promotionFinalStatus: CreatorDraftCollaborationFinalStatus | null;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly expiresAt: Date;
  readonly promotedAt: Date | null;
  readonly updatedAt: Date;
}

export interface CreatorDraftCollaborationRoom {
  readonly version: 1;
  readonly roomId: string;
  readonly draftDocumentId: string;
  readonly provisionalWorkId: string;
  readonly ownerScopeKey: string;
  readonly status: CreatorDraftCollaborationRoomStatus;
  readonly graphRevision: number;
  readonly initialSnapshotByteLength: number;
  readonly provisionIntent: CreatorDraftCollaborationProvisionIntent;
  readonly provisionedAt: string;
  readonly expiresAt: string;
  readonly promotedAt: string | null;
}

export interface ProvisionCreatorDraftCollaborationInput {
  readonly ownerUserId: string;
  readonly ownerScopeKey: string;
  readonly draftDocumentId: string;
  readonly intent: CreatorDraftCollaborationProvisionIntent;
  readonly clientMutationId: string;
  readonly initialSnapshotByteLength: number;
}

export interface PromoteCreatorDraftCollaborationInput {
  readonly ownerUserId: string;
  readonly ownerScopeKey: string;
  readonly roomId: string;
  readonly draftDocumentId: string;
  readonly targetWorkId: string;
  readonly expectedGraphRevision: number;
  readonly expectedWorkRevision: number;
  readonly finalStatus: CreatorDraftCollaborationFinalStatus;
  readonly clientMutationId: string;
}

export interface CreateCreatorDraftCollaborationRoomInput {
  readonly roomId: string;
  readonly draftDocumentId: string;
  readonly ownerUserId: string;
  readonly workId: string;
  readonly initialSnapshotByteLength: number;
  readonly provisionIntent: CreatorDraftCollaborationProvisionIntent;
  readonly provisionMutationId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface PromoteCreatorDraftCollaborationRoomMutation {
  readonly ownerUserId: string;
  readonly roomId: string;
  readonly workId: string;
  readonly expectedGraphRevision: number;
  readonly expectedWorkRevision: number;
  readonly finalStatus: CreatorDraftCollaborationFinalStatus;
  readonly promotionMutationId: string;
  readonly promotedAt: Date;
}

export interface CreatorDraftCollaborationProvisionalWorkRecord {
  readonly workId: string;
  readonly ownerUserId: string;
  readonly status: CreatorDraftCollaborationFinalStatus;
  readonly hidden: boolean;
  readonly revision: number;
  readonly cover: unknown;
  readonly pages: unknown;
  readonly doc: unknown;
}

export interface CreatorDraftCollaborationUnitOfWork {
  acquireOwnerProvisionLock(ownerUserId: string): Promise<void>;
  deleteExpiredProvisionalWorks(
    ownerUserId: string,
    now: Date,
    limit: number
  ): Promise<number>;
  findRoomByOwnerDraft(
    ownerUserId: string,
    draftDocumentId: string,
    lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  findRoomByOwnerProvisionMutation(
    ownerUserId: string,
    mutationId: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  findRoomByOwnerPromotionMutation(
    ownerUserId: string,
    mutationId: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  findRoomByOwnerRoomId(
    ownerUserId: string,
    roomId: string,
    lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  lockProvisionalWorkForPromotion(
    ownerUserId: string,
    workId: string
  ): Promise<CreatorDraftCollaborationProvisionalWorkRecord | null>;
  findLinked3dPassAssetRows(
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioLinked3dPassAssetRow[]>;
  countOwnerRoomsCreatedSince(ownerUserId: string, since: Date): Promise<number>;
  countOwnerActiveRooms(ownerUserId: string, now: Date): Promise<number>;
  createProvisionalRoom(
    input: CreateCreatorDraftCollaborationRoomInput
  ): Promise<CreatorDraftCollaborationRoomRecord>;
  renewActiveRoom(
    ownerUserId: string,
    roomId: string,
    graphRevision: number,
    now: Date,
    expiresAt: Date
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  promoteRoom(
    input: PromoteCreatorDraftCollaborationRoomMutation
  ): Promise<CreatorDraftCollaborationRoomRecord | null>;
  deleteProvisionalWork(
    ownerUserId: string,
    workId: string
  ): Promise<boolean>;
}

export interface CreatorDraftCollaborationPersistence {
  transaction<T>(
    run: (unit: CreatorDraftCollaborationUnitOfWork) => Promise<T>
  ): Promise<T>;
}

export class CreatorDraftCollaborationRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("creator_draft_collaboration_rate_limited");
    this.name = "CreatorDraftCollaborationRateLimitError";
  }
}

export class CreatorDraftCollaborationRoomLimitError extends Error {
  constructor() {
    super("creator_draft_collaboration_room_limit");
    this.name = "CreatorDraftCollaborationRoomLimitError";
  }
}

export class CreatorDraftCollaborationMutationReuseError extends Error {
  constructor() {
    super("creator_draft_collaboration_mutation_reused");
    this.name = "CreatorDraftCollaborationMutationReuseError";
  }
}

export class CreatorDraftCollaborationRoomNotFoundError extends Error {
  constructor() {
    super("creator_draft_collaboration_room_not_found");
    this.name = "CreatorDraftCollaborationRoomNotFoundError";
  }
}

export class CreatorDraftCollaborationRoomExpiredError extends Error {
  constructor() {
    super("creator_draft_collaboration_room_expired");
    this.name = "CreatorDraftCollaborationRoomExpiredError";
  }
}

export class CreatorDraftCollaborationTargetMismatchError extends Error {
  constructor() {
    super("creator_draft_collaboration_target_mismatch");
    this.name = "CreatorDraftCollaborationTargetMismatchError";
  }
}

export class CreatorDraftCollaborationGraphConflictError extends Error {
  constructor(readonly currentGraphRevision: number) {
    super("creator_draft_collaboration_graph_conflict");
    this.name = "CreatorDraftCollaborationGraphConflictError";
  }
}

export class CreatorDraftCollaborationWorkRevisionConflictError extends Error {
  constructor(readonly currentWorkRevision: number) {
    super("creator_draft_collaboration_work_revision_conflict");
    this.name = "CreatorDraftCollaborationWorkRevisionConflictError";
  }
}

export class CreatorDraftCollaborationAlreadyPromotedError extends Error {
  constructor(readonly currentGraphRevision: number) {
    super("creator_draft_collaboration_already_promoted");
    this.name = "CreatorDraftCollaborationAlreadyPromotedError";
  }
}

type DrizzleCreatorDraftCollaborationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const roomSelection = {
  roomId: creatorDraftCollaborationRooms.roomId,
  draftDocumentId: creatorDraftCollaborationRooms.draftDocumentId,
  ownerUserId: creatorDraftCollaborationRooms.ownerUserId,
  workId: creatorDraftCollaborationRooms.workId,
  status: creatorDraftCollaborationRooms.status,
  graphRevision: creatorDraftCollaborationRooms.graphRevision,
  initialSnapshotByteLength:
    creatorDraftCollaborationRooms.initialSnapshotByteLength,
  provisionIntent: creatorDraftCollaborationRooms.provisionIntent,
  provisionMutationId: creatorDraftCollaborationRooms.provisionMutationId,
  promotionMutationId: creatorDraftCollaborationRooms.promotionMutationId,
  promotionExpectedWorkRevision:
    creatorDraftCollaborationRooms.promotionExpectedWorkRevision,
  promotionFinalStatus: creatorDraftCollaborationRooms.promotionFinalStatus,
  createdAt: creatorDraftCollaborationRooms.createdAt,
  lastActivityAt: creatorDraftCollaborationRooms.lastActivityAt,
  expiresAt: creatorDraftCollaborationRooms.expiresAt,
  promotedAt: creatorDraftCollaborationRooms.promotedAt,
  updatedAt: creatorDraftCollaborationRooms.updatedAt,
};

function normalizeRoomRecord(
  value: typeof creatorDraftCollaborationRooms.$inferSelect | undefined
): CreatorDraftCollaborationRoomRecord | null {
  if (!value || (value.status !== "active" && value.status !== "promoted")) return null;
  if (!isCreatorDraftCollaborationProvisionIntent(value.provisionIntent)) {
    return null;
  }
  if (
    (value.promotionExpectedWorkRevision !== null &&
      (!Number.isSafeInteger(value.promotionExpectedWorkRevision) ||
        value.promotionExpectedWorkRevision < 1)) ||
    (value.promotionFinalStatus !== null &&
      !isCreatorDraftCollaborationFinalStatus(value.promotionFinalStatus)) ||
    ((value.promotionExpectedWorkRevision === null) !==
      (value.promotionFinalStatus === null)) ||
    (value.status === "active" &&
      (value.promotionExpectedWorkRevision !== null ||
        value.promotionFinalStatus !== null))
  ) {
    return null;
  }
  return {
    ...value,
    status: value.status,
    provisionIntent: value.provisionIntent,
    promotionFinalStatus: value.promotionFinalStatus,
  };
}

class DrizzleCreatorDraftCollaborationUnitOfWork
  implements CreatorDraftCollaborationUnitOfWork
{
  constructor(private readonly transaction: DrizzleCreatorDraftCollaborationTransaction) {}

  async acquireOwnerProvisionLock(ownerUserId: string): Promise<void> {
    await this.transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${CREATOR_DRAFT_COLLABORATION_OWNER_LOCK_NAMESPACE}${ownerUserId}`}, 0))`
    );
  }

  async deleteExpiredProvisionalWorks(
    ownerUserId: string,
    now: Date,
    limit: number
  ): Promise<number> {
    const expired = await this.transaction
      .select({
        roomId: creatorDraftCollaborationRooms.roomId,
        workId: creatorDraftCollaborationRooms.workId,
      })
      .from(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(creatorDraftCollaborationRooms.status, "active"),
          lte(creatorDraftCollaborationRooms.expiresAt, now)
        )
      )
      .orderBy(
        creatorDraftCollaborationRooms.expiresAt,
        creatorDraftCollaborationRooms.roomId
      )
      .limit(limit)
      .for("update");
    const workIds = expired.map(({ workId }) => workId);
    if (workIds.length === 0) return 0;
    // An active marker is the authority that the hidden work is provisional. Delete hidden legacy
    // poison even if an older route changed its status away from draft. If the work is no longer
    // hidden (or otherwise nondeletable), remove only the expired marker so it cannot occupy every
    // future bounded cleanup batch; the saved work itself is preserved.
    await this.transaction
      .delete(creatorWorks)
      .where(
        and(
          eq(creatorWorks.userId, ownerUserId),
          eq(creatorWorks.hidden, true),
          inArray(creatorWorks.id, workIds)
        )
      )
      .returning({ id: creatorWorks.id });
    await this.transaction
      .delete(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(creatorDraftCollaborationRooms.status, "active"),
          lte(creatorDraftCollaborationRooms.expiresAt, now),
          inArray(
            creatorDraftCollaborationRooms.roomId,
            expired.map(({ roomId }) => roomId)
          )
        )
      );
    return expired.length;
  }

  async findRoomByOwnerDraft(
    ownerUserId: string,
    draftDocumentId: string,
    lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const selectRoom = () =>
      this.transaction
        .select(roomSelection)
        .from(creatorDraftCollaborationRooms)
        .where(
          and(
            eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
            eq(
              creatorDraftCollaborationRooms.draftDocumentId,
              draftDocumentId
            )
          )
        )
        .limit(1);
    const rows = lock ? await selectRoom().for("update") : await selectRoom();
    return normalizeRoomRecord(rows[0]);
  }

  async findRoomByOwnerProvisionMutation(
    ownerUserId: string,
    mutationId: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const rows = await this.transaction
      .select(roomSelection)
      .from(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(
            creatorDraftCollaborationRooms.provisionMutationId,
            mutationId
          )
        )
      )
      .limit(1);
    return normalizeRoomRecord(rows[0]);
  }

  async findRoomByOwnerPromotionMutation(
    ownerUserId: string,
    mutationId: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const rows = await this.transaction
      .select(roomSelection)
      .from(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(
            creatorDraftCollaborationRooms.promotionMutationId,
            mutationId
          )
        )
      )
      .limit(1);
    return normalizeRoomRecord(rows[0]);
  }

  async findRoomByOwnerRoomId(
    ownerUserId: string,
    roomId: string,
    lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const selectRoom = () =>
      this.transaction
        .select(roomSelection)
        .from(creatorDraftCollaborationRooms)
        .where(
          and(
            eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
            eq(creatorDraftCollaborationRooms.roomId, roomId)
          )
        )
        .limit(1);
    const rows = lock ? await selectRoom().for("update") : await selectRoom();
    return normalizeRoomRecord(rows[0]);
  }

  async lockProvisionalWorkForPromotion(
    ownerUserId: string,
    workId: string
  ): Promise<CreatorDraftCollaborationProvisionalWorkRecord | null> {
    const [work] = await this.transaction
      .select({
        workId: creatorWorks.id,
        ownerUserId: creatorWorks.userId,
        status: creatorWorks.status,
        hidden: creatorWorks.hidden,
        revision: creatorWorks.revision,
        cover: creatorWorks.cover,
        pages: creatorWorks.pages,
        doc: creatorWorks.doc,
      })
      .from(creatorWorks)
      .where(
        and(
          eq(creatorWorks.id, workId),
          eq(creatorWorks.userId, ownerUserId)
        )
      )
      .limit(1)
      .for("update");
    if (
      !work ||
      !isCreatorDraftCollaborationFinalStatus(work.status) ||
      !Number.isSafeInteger(work.revision) ||
      work.revision < 1
    ) {
      return null;
    }
    return {
      ...work,
      status: work.status,
    };
  }

  async findLinked3dPassAssetRows(
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioLinked3dPassAssetRow[]> {
    if (assetIds.length === 0) return [];
    return this.transaction
      .select({
        workId: creatorWorkAssets.workId,
        assetId: creatorWorkAssets.assetId,
        elementType: creatorWorkAssets.elementType,
        mimeType: creatorWorkAssets.mimeType,
        descriptor: creatorWorkAssets.descriptor,
        byteSize: creatorWorkAssets.byteSize,
        sha256: creatorWorkAssets.sha256,
        intrinsicWidth: creatorWorkAssets.intrinsicWidth,
        intrinsicHeight: creatorWorkAssets.intrinsicHeight,
        decodedRgbaBytes: creatorWorkAssets.decodedRgbaBytes,
      })
      .from(creatorWorkAssets)
      .where(
        and(
          eq(creatorWorkAssets.workId, workId),
          inArray(creatorWorkAssets.assetId, [...new Set(assetIds)])
        )
      )
      .orderBy(creatorWorkAssets.assetId);
  }

  async countOwnerRoomsCreatedSince(
    ownerUserId: string,
    since: Date
  ): Promise<number> {
    const [row] = await this.transaction
      .select({ value: count() })
      .from(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          gte(creatorDraftCollaborationRooms.createdAt, since)
        )
      );
    return Number(row?.value ?? 0);
  }

  async countOwnerActiveRooms(ownerUserId: string, now: Date): Promise<number> {
    const [row] = await this.transaction
      .select({ value: count() })
      .from(creatorDraftCollaborationRooms)
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(creatorDraftCollaborationRooms.status, "active"),
          gt(creatorDraftCollaborationRooms.expiresAt, now)
        )
      );
    return Number(row?.value ?? 0);
  }

  async createProvisionalRoom(
    input: CreateCreatorDraftCollaborationRoomInput
  ): Promise<CreatorDraftCollaborationRoomRecord> {
    const workValues: typeof creatorWorks.$inferInsert = {
      id: input.workId,
      userId: input.ownerUserId,
      title: "저장 전 공동 작업",
      description: "",
      cover: "",
      tags: [],
      format: "cuttoon",
      pages: [],
      doc: {},
      status: "draft",
      hidden: true,
      revision: 1,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    await this.transaction.insert(creatorWorks).values(workValues);
    await this.transaction.insert(creatorWorkRevisions).values({
      workId: input.workId,
      revision: 1,
      snapshot: createCreatorWorkRevisionSnapshot(workValues),
      createdAt: input.createdAt,
    });
    const [created] = await this.transaction
      .insert(creatorDraftCollaborationRooms)
      .values({
        roomId: input.roomId,
        draftDocumentId: input.draftDocumentId,
        ownerUserId: input.ownerUserId,
        workId: input.workId,
        status: "active",
        graphRevision: 0,
        initialSnapshotByteLength: input.initialSnapshotByteLength,
        provisionIntent: input.provisionIntent,
        provisionMutationId: input.provisionMutationId,
        promotionMutationId: null,
        promotionExpectedWorkRevision: null,
        promotionFinalStatus: null,
        createdAt: input.createdAt,
        lastActivityAt: input.createdAt,
        expiresAt: input.expiresAt,
        promotedAt: null,
        updatedAt: input.createdAt,
      })
      .returning();
    const normalized = normalizeRoomRecord(created);
    if (!normalized) throw new Error("invalid creator draft collaboration insert");
    return normalized;
  }

  async renewActiveRoom(
    ownerUserId: string,
    roomId: string,
    graphRevision: number,
    now: Date,
    expiresAt: Date
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const [updated] = await this.transaction
      .update(creatorDraftCollaborationRooms)
      .set({
        lastActivityAt: now,
        expiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
          eq(creatorDraftCollaborationRooms.roomId, roomId),
          eq(creatorDraftCollaborationRooms.status, "active"),
          eq(creatorDraftCollaborationRooms.graphRevision, graphRevision)
        )
      )
      .returning();
    return normalizeRoomRecord(updated);
  }

  async promoteRoom(
    input: PromoteCreatorDraftCollaborationRoomMutation
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const [promoted] = await this.transaction
      .update(creatorDraftCollaborationRooms)
      .set({
        status: "promoted",
        graphRevision: sql`${creatorDraftCollaborationRooms.graphRevision} + 1`,
        promotionMutationId: input.promotionMutationId,
        promotionExpectedWorkRevision: input.expectedWorkRevision,
        promotionFinalStatus: input.finalStatus,
        promotedAt: input.promotedAt,
        lastActivityAt: input.promotedAt,
        updatedAt: input.promotedAt,
      })
      .where(
        and(
          eq(creatorDraftCollaborationRooms.ownerUserId, input.ownerUserId),
          eq(creatorDraftCollaborationRooms.roomId, input.roomId),
          eq(creatorDraftCollaborationRooms.workId, input.workId),
          eq(creatorDraftCollaborationRooms.status, "active"),
          eq(
            creatorDraftCollaborationRooms.graphRevision,
            input.expectedGraphRevision
          ),
          gt(creatorDraftCollaborationRooms.expiresAt, input.promotedAt)
        )
      )
      .returning();
    const normalized = normalizeRoomRecord(promoted);
    if (!normalized) return null;
    const unhidden = await this.transaction
      .update(creatorWorks)
      .set({
        hidden: false,
        status: input.finalStatus,
        updatedAt: input.promotedAt,
      })
      .where(
        and(
          eq(creatorWorks.id, input.workId),
          eq(creatorWorks.userId, input.ownerUserId),
          eq(creatorWorks.hidden, true),
          eq(creatorWorks.revision, input.expectedWorkRevision)
        )
      )
      .returning({ id: creatorWorks.id });
    if (unhidden.length !== 1) {
      throw new Error("invalid creator draft collaboration provisional work");
    }
    // Staging writes revision rN while the work is intentionally still draft. Promotion keeps rN
    // as the public revision, so its retained restore authority must receive the same final status
    // in this transaction; otherwise restoring rN would silently unpublish a published work.
    const revisionSnapshots = await this.transaction
      .update(creatorWorkRevisions)
      .set({
        snapshot: sql`jsonb_set(
          ${creatorWorkRevisions.snapshot},
          '{status}',
          to_jsonb(${input.finalStatus}::text),
          true
        )`,
      })
      .where(
        and(
          eq(creatorWorkRevisions.workId, input.workId),
          eq(creatorWorkRevisions.revision, input.expectedWorkRevision)
        )
      )
      .returning({
        workId: creatorWorkRevisions.workId,
        revision: creatorWorkRevisions.revision,
      });
    if (revisionSnapshots.length !== 1) {
      throw new Error("invalid creator draft collaboration revision snapshot");
    }
    return normalized;
  }

  async deleteProvisionalWork(
    ownerUserId: string,
    workId: string
  ): Promise<boolean> {
    const deleted = await this.transaction
      .delete(creatorWorks)
      .where(
        and(
          eq(creatorWorks.id, workId),
          eq(creatorWorks.userId, ownerUserId),
          eq(creatorWorks.hidden, true)
        )
      )
      .returning({ id: creatorWorks.id });
    if (deleted.length === 0) {
      await this.transaction
        .delete(creatorDraftCollaborationRooms)
        .where(
          and(
            eq(creatorDraftCollaborationRooms.workId, workId),
            eq(creatorDraftCollaborationRooms.ownerUserId, ownerUserId),
            eq(creatorDraftCollaborationRooms.status, "active")
          )
        );
    }
    return deleted.length === 1;
  }
}

export class DrizzleCreatorDraftCollaborationPersistence
  implements CreatorDraftCollaborationPersistence
{
  async transaction<T>(
    run: (unit: CreatorDraftCollaborationUnitOfWork) => Promise<T>
  ): Promise<T> {
    return db.transaction((transaction) =>
      run(new DrizzleCreatorDraftCollaborationUnitOfWork(transaction))
    );
  }
}

interface CreatorDraftCollaborationRepositoryOptions {
  readonly now?: () => Date;
  readonly createUuid?: () => string;
}

type ProvisionOutcome =
  | { readonly kind: "room"; readonly room: CreatorDraftCollaborationRoomRecord }
  | { readonly kind: "rate-limit" }
  | { readonly kind: "room-limit" }
  | { readonly kind: "mutation-reused" };

type PromotionOutcome =
  | { readonly kind: "room"; readonly room: CreatorDraftCollaborationRoomRecord }
  | { readonly kind: "not-found" }
  | { readonly kind: "expired" }
  | { readonly kind: "target-mismatch" }
  | { readonly kind: "graph-conflict"; readonly currentGraphRevision: number }
  | { readonly kind: "work-revision-conflict"; readonly currentWorkRevision: number }
  | { readonly kind: "already-promoted"; readonly currentGraphRevision: number }
  | { readonly kind: "mutation-reused" };

function roomProjection(
  room: CreatorDraftCollaborationRoomRecord
): CreatorDraftCollaborationRoom {
  return {
    version: 1,
    roomId: room.roomId,
    draftDocumentId: room.draftDocumentId,
    provisionalWorkId: room.workId,
    ownerScopeKey: room.ownerUserId,
    status: room.status,
    graphRevision: room.graphRevision,
    initialSnapshotByteLength: room.initialSnapshotByteLength,
    provisionIntent: room.provisionIntent,
    provisionedAt: room.createdAt.toISOString(),
    expiresAt: room.expiresAt.toISOString(),
    promotedAt: room.promotedAt?.toISOString() ?? null,
  };
}

export class CreatorDraftCollaborationRepository {
  private readonly now: () => Date;
  private readonly createUuid: () => string;

  constructor(
    private readonly persistence: CreatorDraftCollaborationPersistence =
      new DrizzleCreatorDraftCollaborationPersistence(),
    options: CreatorDraftCollaborationRepositoryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createUuid = options.createUuid ?? randomUUID;
  }

  async provision(
    input: ProvisionCreatorDraftCollaborationInput
  ): Promise<CreatorDraftCollaborationRoom> {
    if (
      input.ownerUserId !== input.ownerScopeKey ||
      !isCreatorDraftCollaborationProvisionIntent(input.intent) ||
      !Number.isSafeInteger(input.initialSnapshotByteLength) ||
      input.initialSnapshotByteLength < 0 ||
      input.initialSnapshotByteLength >
        CREATOR_DRAFT_COLLABORATION_INITIAL_SNAPSHOT_MAX_BYTES
    ) {
      throw new CreatorDraftCollaborationTargetMismatchError();
    }
    const now = this.now();
    const expiresAt = new Date(
      now.getTime() + CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS
    );
    const since = new Date(
      now.getTime() - CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS
    );
    const outcome = await this.persistence.transaction<ProvisionOutcome>(
      async (unit) => {
        await unit.acquireOwnerProvisionLock(input.ownerUserId);
        await unit.deleteExpiredProvisionalWorks(
          input.ownerUserId,
          now,
          CREATOR_DRAFT_COLLABORATION_CLEANUP_BATCH
        );

        const existing = await unit.findRoomByOwnerDraft(
          input.ownerUserId,
          input.draftDocumentId,
          true
        );
        if (existing) {
          if (
            existing.provisionMutationId === input.clientMutationId &&
            (existing.provisionIntent !== input.intent ||
              existing.initialSnapshotByteLength !==
                input.initialSnapshotByteLength)
          ) {
            return { kind: "mutation-reused" };
          }
          if (existing.status === "promoted") return { kind: "room", room: existing };
          const renewed = await unit.renewActiveRoom(
            input.ownerUserId,
            existing.roomId,
            existing.graphRevision,
            now,
            expiresAt
          );
          if (!renewed) {
            throw new Error("creator draft collaboration lease renewal lost");
          }
          return { kind: "room", room: renewed };
        }

        const mutationRoom = await unit.findRoomByOwnerProvisionMutation(
          input.ownerUserId,
          input.clientMutationId
        );
        if (mutationRoom) return { kind: "mutation-reused" };
        if (
          (await unit.countOwnerRoomsCreatedSince(input.ownerUserId, since)) >=
          CREATOR_DRAFT_COLLABORATION_PROVISION_LIMIT
        ) {
          return { kind: "rate-limit" };
        }
        if (
          (await unit.countOwnerActiveRooms(input.ownerUserId, now)) >=
          CREATOR_DRAFT_COLLABORATION_ACTIVE_ROOM_LIMIT
        ) {
          return { kind: "room-limit" };
        }

        const room = await unit.createProvisionalRoom({
          roomId: `draft-room_${this.createUuid()}`,
          draftDocumentId: input.draftDocumentId,
          ownerUserId: input.ownerUserId,
          workId: this.createUuid(),
          initialSnapshotByteLength: input.initialSnapshotByteLength,
          provisionIntent: input.intent,
          provisionMutationId: input.clientMutationId,
          createdAt: now,
          expiresAt,
        });
        return { kind: "room", room };
      }
    );
    switch (outcome.kind) {
      case "room":
        return roomProjection(outcome.room);
      case "rate-limit":
        throw new CreatorDraftCollaborationRateLimitError(
          CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS
        );
      case "room-limit":
        throw new CreatorDraftCollaborationRoomLimitError();
      case "mutation-reused":
        throw new CreatorDraftCollaborationMutationReuseError();
    }
  }

  async promote(
    input: PromoteCreatorDraftCollaborationInput
  ): Promise<CreatorDraftCollaborationRoom> {
    if (input.ownerUserId !== input.ownerScopeKey) {
      throw new CreatorDraftCollaborationRoomNotFoundError();
    }
    if (
      !Number.isSafeInteger(input.expectedWorkRevision) ||
      input.expectedWorkRevision < 1 ||
      input.expectedWorkRevision > 2_147_483_647 ||
      !isCreatorDraftCollaborationFinalStatus(input.finalStatus)
    ) {
      throw new CreatorDraftCollaborationTargetMismatchError();
    }
    const now = this.now();
    const outcome = await this.persistence.transaction<PromotionOutcome>(
      async (unit) => {
        await unit.acquireOwnerProvisionLock(input.ownerUserId);
        const room = await unit.findRoomByOwnerRoomId(
          input.ownerUserId,
          input.roomId,
          true
        );
        if (!room || room.draftDocumentId !== input.draftDocumentId) {
          return { kind: "not-found" };
        }
        if (room.workId !== input.targetWorkId) {
          return { kind: "target-mismatch" };
        }
        if (room.status === "promoted") {
          return room.promotionMutationId === input.clientMutationId &&
            room.promotionExpectedWorkRevision === input.expectedWorkRevision &&
            room.promotionFinalStatus === input.finalStatus &&
            room.graphRevision === input.expectedGraphRevision + 1
            ? { kind: "room", room }
            : {
                kind: "already-promoted",
                currentGraphRevision: room.graphRevision,
              };
        }
        if (room.expiresAt.getTime() <= now.getTime()) {
          await unit.deleteProvisionalWork(input.ownerUserId, room.workId);
          return { kind: "expired" };
        }
        if (room.graphRevision !== input.expectedGraphRevision) {
          return {
            kind: "graph-conflict",
            currentGraphRevision: room.graphRevision,
          };
        }
        const mutationRoom = await unit.findRoomByOwnerPromotionMutation(
          input.ownerUserId,
          input.clientMutationId
        );
        if (mutationRoom && mutationRoom.roomId !== room.roomId) {
          return { kind: "mutation-reused" };
        }
        const work = await unit.lockProvisionalWorkForPromotion(
          input.ownerUserId,
          room.workId
        );
        if (!work || !work.hidden) {
          return { kind: "target-mismatch" };
        }
        if (work.revision !== input.expectedWorkRevision) {
          return {
            kind: "work-revision-conflict",
            currentWorkRevision: work.revision,
          };
        }
        const requirements = extractStudioLinked3dPassAssetRequirements({
          cover: work.cover,
          pages: work.pages,
          doc: work.doc,
        });
        const assetRows = await unit.findLinked3dPassAssetRows(
          room.workId,
          requirements.map(({ assetId }) => assetId)
        );
        assertStudioLinked3dPassAssetRows({
          workId: room.workId,
          requirements,
          rows: assetRows,
        });
        const promoted = await unit.promoteRoom({
          ownerUserId: input.ownerUserId,
          roomId: room.roomId,
          workId: room.workId,
          expectedGraphRevision: room.graphRevision,
          expectedWorkRevision: input.expectedWorkRevision,
          finalStatus: input.finalStatus,
          promotionMutationId: input.clientMutationId,
          promotedAt: now,
        });
        if (!promoted) {
          return {
            kind: "graph-conflict",
            currentGraphRevision: room.graphRevision,
          };
        }
        return { kind: "room", room: promoted };
      }
    );
    switch (outcome.kind) {
      case "room":
        return roomProjection(outcome.room);
      case "not-found":
        throw new CreatorDraftCollaborationRoomNotFoundError();
      case "expired":
        throw new CreatorDraftCollaborationRoomExpiredError();
      case "target-mismatch":
        throw new CreatorDraftCollaborationTargetMismatchError();
      case "graph-conflict":
        throw new CreatorDraftCollaborationGraphConflictError(
          outcome.currentGraphRevision
        );
      case "work-revision-conflict":
        throw new CreatorDraftCollaborationWorkRevisionConflictError(
          outcome.currentWorkRevision
        );
      case "already-promoted":
        throw new CreatorDraftCollaborationAlreadyPromotedError(
          outcome.currentGraphRevision
        );
      case "mutation-reused":
        throw new CreatorDraftCollaborationMutationReuseError();
    }
  }
}

export const creatorDraftCollaborationRepositoryProvider = {
  provide: CREATOR_DRAFT_COLLABORATION_REPOSITORY,
  useFactory: (): CreatorDraftCollaborationRepository =>
    new CreatorDraftCollaborationRepository(),
};
