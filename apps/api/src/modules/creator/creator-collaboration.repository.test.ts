import { describe, expect, it } from "vitest";

import {
  StudioLinked3dPassAssetFenceError,
  type StudioLinked3dPassAssetRow,
} from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import { db } from "../../db";
import { CreatorDraftCollaborationStatusLockedError } from "../../server/creator-provisional-work-status";

import {
  buildCreatorCollaborationWorkQuery,
  buildCreatorCrdtServerSequenceQuery,
  buildCreatorSharedDocumentMetaQuery,
  buildCreatorSharedDocumentUpdateQuery,
  buildCreatorSharedWorksListQuery,
} from "./creator-collaboration.drizzle-persistence";
import {
  CreatorCollaborationCrdtSequenceConflictError,
  CreatorCollaborationConflictError,
  CreatorCollaborationForbiddenError,
  CreatorCollaborationInvalidTargetError,
  CreatorCollaborationNotFoundError,
  CreatorCollaborationRepository,
  CreatorCollaborationRevisionConflictError,
  decodeCreatorSharedWorksCursor,
  encodeCreatorSharedWorksCursor,
} from "./creator-collaboration.repository";

import type {
  CreatorCollaborationPersistence,
  CreatorCollaborationUnitOfWork,
  CreatorSharedDocumentPatch,
  CreatorSharedWorksCursorKey,
} from "./creator-collaboration.repository";

interface MemoryWork {
  id: string;
  ownerUserId: string;
  title: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  hidden?: boolean;
  titleId?: string | null;
  description?: string;
  cover?: string;
  tags?: string[];
  format?: "cuttoon" | "upload";
  pages?: string[];
  doc?: Record<string, unknown>;
  status?: "draft" | "published";
  seriesId?: string | null;
  episodeNo?: number | null;
  challengeId?: string | null;
  remixFromId?: string | null;
  revision?: number;
  draftCollaborationStatus?: string | null;
  draftCollaborationExpiresAt?: Date | null;
  draftCollaborationOwnerUserId?: string | null;
}

interface MemoryUser {
  userId: string;
  name: string | null;
  image: string | null;
  status: string;
}

interface MemoryMembership {
  workId: string;
  userId: string;
  role: string;
  status: string;
  invitationId: string;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  respondedAt: Date | null;
}

interface MemoryEvent {
  id: string;
  workId: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  beforeState: unknown;
  afterState: unknown;
  sequence: number;
  createdAt: Date;
}

type CreateMembershipInput = Parameters<CreatorCollaborationUnitOfWork["createMembership"]>[0];
type UpdateMembershipInput = Parameters<CreatorCollaborationUnitOfWork["updateMembership"]>[2];
type AppendEventInput = Parameters<CreatorCollaborationUnitOfWork["appendEvent"]>[0];

function membershipKey(workId: string, userId: string): string {
  return `${workId}\u0000${userId}`;
}

function cloneMemberships(source: Map<string, MemoryMembership>): Map<string, MemoryMembership> {
  return new Map(
    [...source].map(([key, membership]) => [key, { ...membership }])
  );
}

function cloneEvents(source: MemoryEvent[]): MemoryEvent[] {
  return source.map((event) => ({
    ...event,
    beforeState:
      event.beforeState && typeof event.beforeState === "object"
        ? { ...event.beforeState }
        : event.beforeState,
    afterState:
      event.afterState && typeof event.afterState === "object"
        ? { ...event.afterState }
        : event.afterState,
  }));
}

function memoryEventState(value: unknown): { role: string; status: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !["admin", "editor", "commenter", "viewer"].includes(String(record.role)) ||
    !["pending", "active", "declined"].includes(String(record.status))
  ) {
    return null;
  }
  return { role: String(record.role), status: String(record.status) };
}

function isMemoryEventValid(event: MemoryEvent): boolean {
  const before = event.beforeState === null ? null : memoryEventState(event.beforeState);
  const after = event.afterState === null ? null : memoryEventState(event.afterState);
  if ((event.beforeState !== null && !before) || (event.afterState !== null && !after)) {
    return false;
  }
  switch (event.action) {
    case "invite":
      return before === null && after?.status === "pending";
    case "reinvite":
      return before?.status === "declined" && after?.status === "pending";
    case "accept":
      return before?.status === "pending" && after?.status === "active" && before.role === after.role;
    case "decline":
      return before?.status === "pending" && after?.status === "declined" && before.role === after.role;
    case "role_change":
      return Boolean(
        before &&
          after &&
          ["pending", "active"].includes(before.status) &&
          before.status === after.status &&
          before.role !== after.role
      );
    case "remove":
      return Boolean(before && ["pending", "active"].includes(before.status) && after === null);
    default:
      return false;
  }
}

class MemoryCollaborationStore
  implements CreatorCollaborationPersistence, CreatorCollaborationUnitOfWork
{
  readonly works = new Map<string, MemoryWork>();
  readonly users = new Map<string, MemoryUser>();
  memberships = new Map<string, MemoryMembership>();
  events: MemoryEvent[] = [];
  workRevisions: Array<{ workId: string; revision: number; snapshot: unknown; createdAt: Date }> = [];
  nextEventSequence = 1;
  failNextEvent = false;
  failNextWorkRevision = false;
  documentUpdateCount = 0;
  workRevisionAppendCount = 0;
  transactionCount = 0;
  readonly crdtServerSequences = new Map<string, bigint>();
  readonly linkedPassAssets = new Map<string, StudioLinked3dPassAssetRow>();
  readonly saveLockOrder: string[] = [];
  lockedWorkIds: string[] = [];
  lockedUserIds: string[] = [];
  workReadIds: string[] = [];
  userReadIds: string[] = [];
  membershipReadKeys: string[] = [];
  membershipListWorkIds: string[] = [];
  authorizedEventReads: Array<{ actorUserId: string; workId: string; limit: number }> = [];
  authorizedEventRowsMaterialized = 0;
  beforeAuthorizedEventRead: (() => void) | null = null;

  async read<T>(run: (unit: CreatorCollaborationUnitOfWork) => Promise<T>): Promise<T> {
    return run(this);
  }

  async transaction<T>(run: (unit: CreatorCollaborationUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const before = cloneMemberships(this.memberships);
    const beforeEvents = cloneEvents(this.events);
    const beforeWorks = new Map(
      [...this.works].map(([key, work]) => [key, { ...work }])
    );
    const beforeWorkRevisions = this.workRevisions.map((revision) => ({ ...revision }));
    try {
      return await run(this);
    } catch (error) {
      this.memberships = before;
      this.events = beforeEvents;
      this.works.clear();
      for (const [key, work] of beforeWorks) this.works.set(key, work);
      this.workRevisions = beforeWorkRevisions;
      throw error;
    }
  }

  async acquireStudioCrdtWorkAdvisoryLock(workId: string): Promise<void> {
    this.saveLockOrder.push(`crdt-advisory:${workId}`);
  }

  async getStudioCrdtServerSequence(workId: string): Promise<bigint> {
    this.saveLockOrder.push(`crdt-sequence:${workId}`);
    return this.crdtServerSequences.get(workId) ?? BigInt(0);
  }

  async findWork(workId: string, lock = false): Promise<MemoryWork | null> {
    this.workReadIds.push(workId);
    if (lock) {
      this.lockedWorkIds.push(workId);
      this.saveLockOrder.push(`work-row:${workId}`);
    }
    return this.works.get(workId) ?? null;
  }

  async findUser(userId: string, lock = false): Promise<MemoryUser | null> {
    this.userReadIds.push(userId);
    if (lock) this.lockedUserIds.push(userId);
    return this.users.get(userId) ?? null;
  }

  async findMembership(workId: string, userId: string): Promise<MemoryMembership | null> {
    this.membershipReadKeys.push(membershipKey(workId, userId));
    return this.memberships.get(membershipKey(workId, userId)) ?? null;
  }

  async listMemberships(workId: string) {
    this.membershipListWorkIds.push(workId);
    return [...this.memberships.values()]
      .filter((membership) => membership.workId === workId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.userId.localeCompare(right.userId)
      )
      .map((membership) => ({
        ...membership,
        name: this.users.get(membership.userId)?.name ?? null,
      }));
  }

  async countNonDeclinedMemberships(workId: string): Promise<number> {
    return [...this.memberships.values()].filter(
      (membership) => membership.workId === workId && membership.status !== "declined"
    ).length;
  }

  async createMembership(input: CreateMembershipInput): Promise<void> {
    const key = membershipKey(input.workId, input.userId);
    if (this.memberships.has(key)) throw new Error("duplicate membership");
    this.memberships.set(key, {
      workId: input.workId,
      userId: input.userId,
      role: input.role,
      status: "pending",
      invitationId: input.invitationId,
      invitedBy: input.invitedBy,
      createdAt: input.now,
      updatedAt: input.now,
      respondedAt: null,
    });
  }

  async updateMembership(
    workId: string,
    userId: string,
    input: UpdateMembershipInput,
    expectedInvitationId?: string
  ): Promise<boolean> {
    const key = membershipKey(workId, userId);
    const membership = this.memberships.get(key);
    if (!membership) return false;
    if (
      expectedInvitationId !== undefined &&
      (membership.invitationId !== expectedInvitationId || membership.status !== "pending")
    ) {
      return false;
    }
    this.memberships.set(key, { ...membership, ...input });
    return true;
  }

  async deleteMembership(workId: string, userId: string): Promise<boolean> {
    return this.memberships.delete(membershipKey(workId, userId));
  }

  async listPendingInvitations(userId: string, limit: number) {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId && membership.status === "pending")
      .map((membership) => {
        const work = this.works.get(membership.workId);
        if (!work) return null;
        const owner = this.users.get(work.ownerUserId);
        if (!owner || owner.status !== "active") return null;
        return {
          workId: work.id,
          workTitle: work.title,
          ownerName: owner.name,
          ownerStatus: owner.status,
          role: membership.role,
          status: membership.status,
          invitationId: membership.invitationId,
          updatedAt: membership.updatedAt,
        };
      })
      .filter((record): record is NonNullable<typeof record> => record !== null)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.workId.localeCompare(left.workId)
      )
      .slice(0, limit);
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    if (this.failNextEvent) {
      this.failNextEvent = false;
      throw new Error("event insert failed");
    }
    this.events.push({ ...input, sequence: this.nextEventSequence++ });
  }

  async findLatestRemovalEvent(workId: string, targetUserId: string) {
    const event = this.events
      .filter(
        (candidate) =>
          candidate.workId === workId &&
          candidate.targetUserId === targetUserId &&
          candidate.action === "remove" &&
          isMemoryEventValid(candidate),
      )
      .sort((left, right) => right.sequence - left.sequence)[0];
    return event
      ? {
          workId,
          targetUserId,
          createdAt: event.createdAt,
        }
      : null;
  }

  async listAuthorizedEvents(actorUserId: string, workId: string, limit: number) {
    this.authorizedEventReads.push({ actorUserId, workId, limit });
    const beforeRead = this.beforeAuthorizedEventRead;
    this.beforeAuthorizedEventRead = null;
    beforeRead?.();

    const work = this.works.get(workId);
    if (!work) return null;
    const membership = this.memberships.get(membershipKey(workId, actorUserId));
    if (
      actorUserId !== work.ownerUserId &&
      !(membership?.role === "admin" && membership.status === "active")
    ) {
      return null;
    }

    const events = this.events
      .filter((event) => event.workId === workId)
      .filter(isMemoryEventValid)
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, limit)
      .map(({ workId: _workId, sequence: _sequence, ...event }) => {
        const actor = event.actorUserId ? this.users.get(event.actorUserId) : null;
        const target = event.targetUserId ? this.users.get(event.targetUserId) : null;
        return {
          ...event,
          actorUserId: actor ? event.actorUserId : null,
          actorName: actor?.name ?? null,
          actorStatus: actor?.status ?? null,
          targetUserId: target ? event.targetUserId : null,
          targetName: target?.name ?? null,
          targetStatus: target?.status ?? null,
        };
      });
    this.authorizedEventRowsMaterialized += events.length;
    return { authorized: true as const, events };
  }

  private sharedDocumentRecord(actorUserId: string, workId: string) {
    const work = this.works.get(workId);
    if (!work) return null;
    const owner = this.users.get(work.ownerUserId);
    if (!owner) return null;
    const membership = this.memberships.get(membershipKey(workId, actorUserId));
    if (
      actorUserId !== work.ownerUserId &&
      !(owner.status === "active" && membership?.status === "active")
    ) {
      return null;
    }
    return {
      workId: work.id,
      ownerUserId: work.ownerUserId,
      ownerName: owner.name,
      ownerStatus: owner.status,
      titleId: work.titleId ?? null,
      title: work.title,
      description: work.description ?? "",
      cover: work.cover ?? "",
      tags: work.tags ?? [],
      format: work.format ?? "cuttoon",
      pages: work.pages ?? [],
      doc: work.doc ?? {},
      status: work.status ?? "draft",
      seriesId: work.seriesId ?? null,
      episodeNo: work.episodeNo ?? null,
      challengeId: work.challengeId ?? null,
      remixFromId: work.remixFromId ?? null,
      revision: work.revision ?? 1,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      membershipRole: membership?.role ?? null,
      membershipStatus: membership?.status ?? null,
    };
  }

  async listAccessibleWorks(
    actorUserId: string,
    limit: number,
    cursor: CreatorSharedWorksCursorKey | null
  ) {
    return [...this.works.values()]
      .map((work) => this.sharedDocumentRecord(actorUserId, work.id))
      .filter((work): work is NonNullable<typeof work> => work !== null)
      .sort(
        (left, right) =>
          (right.updatedAt ?? right.createdAt ?? new Date(0)).getTime() -
            (left.updatedAt ?? left.createdAt ?? new Date(0)).getTime() ||
          right.workId.localeCompare(left.workId)
      )
      .filter((work) => {
        if (!cursor) return true;
        const sortAt = work.updatedAt ?? work.createdAt ?? new Date(0);
        return (
          sortAt.getTime() < cursor.sortAt.getTime() ||
          (sortAt.getTime() === cursor.sortAt.getTime() && work.workId < cursor.workId)
        );
      })
      .slice(0, limit)
      .map((work) => ({
        workId: work.workId,
        ownerUserId: work.ownerUserId,
        ownerName: work.ownerName,
        ownerStatus: work.ownerStatus,
        title: work.title,
        format: work.format,
        createdAt: work.createdAt,
        updatedAt: work.updatedAt,
        membershipRole: work.membershipRole,
        membershipStatus: work.membershipStatus,
      }));
  }

  async findAccessibleDocument(actorUserId: string, workId: string) {
    return this.sharedDocumentRecord(actorUserId, workId);
  }

  async findAccessibleDocumentMeta(actorUserId: string, workId: string) {
    const record = this.sharedDocumentRecord(actorUserId, workId);
    if (!record) return null;
    return {
      workId: record.workId,
      ownerUserId: record.ownerUserId,
      ownerStatus: record.ownerStatus,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      membershipRole: record.membershipRole,
      membershipStatus: record.membershipStatus,
    };
  }

  async findStudioLinked3dPassAssets(workId: string, assetIds: readonly string[]) {
    this.saveLockOrder.push(`linked-pass-assets:${workId}`);
    return assetIds.flatMap((assetId) => {
      const row = this.linkedPassAssets.get(`${workId}\u0000${assetId}`);
      return row ? [row] : [];
    });
  }

  async updateAccessibleDocument(
    actorUserId: string,
    workId: string,
    baseRevision: number,
    patch: Parameters<CreatorCollaborationUnitOfWork["updateAccessibleDocument"]>[3],
    updatedAt: Date
  ) {
    const work = this.works.get(workId);
    if (!work || (work.revision ?? 1) !== baseRevision) return null;
    const owner = this.users.get(work.ownerUserId);
    const membership = this.memberships.get(membershipKey(workId, actorUserId));
    const canEdit =
      actorUserId === work.ownerUserId ||
      (owner?.status === "active" &&
        membership?.status === "active" &&
        (membership.role === "admin" || membership.role === "editor"));
    if (!canEdit) return null;
    this.documentUpdateCount += 1;
    Object.assign(work, patch, { revision: baseRevision + 1, updatedAt });
    const record = this.sharedDocumentRecord(actorUserId, workId);
    if (!record) return null;
    const {
      ownerName: _ownerName,
      ownerStatus: _ownerStatus,
      membershipRole: _membershipRole,
      membershipStatus: _membershipStatus,
      ...mutation
    } = record;
    return mutation;
  }

  async appendWorkRevision(
    workId: string,
    revision: number,
    snapshot: Parameters<CreatorCollaborationUnitOfWork["appendWorkRevision"]>[2],
    createdAt: Date
  ): Promise<void> {
    this.workRevisionAppendCount += 1;
    if (this.failNextWorkRevision) {
      this.failNextWorkRevision = false;
      throw new Error("work revision insert failed");
    }
    this.workRevisions.push({ workId, revision, snapshot, createdAt });
  }

  async deleteWorkRevisionsThrough(workId: string, revision: number): Promise<void> {
    this.workRevisions = this.workRevisions.filter(
      (entry) => entry.workId !== workId || entry.revision > revision
    );
  }
}

const BASE_DATE = new Date("2026-07-12T00:00:00.000Z");
const DEFAULT_NOW = new Date("2026-07-14T00:06:00.000Z");
const PENDING_INVITATION_ID = "00000000-0000-4000-8000-000000000003";
const DECLINED_INVITATION_ID = "00000000-0000-4000-8000-000000000004";
const LINKED_PASS_HASH = "a".repeat(64);
const LINKED_PASS_SOURCE_HASH = `sha256:${"b".repeat(64)}`;
const LINKED_PASS_ASSET_ID = `linked3d-pass-sha256-${LINKED_PASS_HASH}`;
const LINKED_PASS_LOCATOR = `studio-opfs-cas:sha256:${LINKED_PASS_HASH}`;

function linkedPassDocument(linkCount = 1): Record<string, unknown> {
  const elements = Array.from({ length: linkCount }, (_, index) => ({
    id: `line-linked-${index}`,
    type: "image",
    src: LINKED_PASS_LOCATOR,
  }));
  const links = Array.from({ length: linkCount }, (_, index) => ({
    bundleId: `bundle-linked-${index}`,
    shotId: `shot-linked-${index}`,
    sourceShotId: null,
    stageSourceHash: LINKED_PASS_SOURCE_HASH,
    layers: [{ elementId: `line-linked-${index}`, role: "main-line" }],
    passRevision: {
      revision: 1,
      sourceHash: LINKED_PASS_SOURCE_HASH,
      sceneHash: LINKED_PASS_SOURCE_HASH,
      cameraHash: LINKED_PASS_SOURCE_HASH,
      baseGeometryHash: LINKED_PASS_SOURCE_HASH,
      topologyHash: LINKED_PASS_SOURCE_HASH,
      objectIdentityHash: LINKED_PASS_SOURCE_HASH,
      objectStableIds: ["obj/room"],
      passRootHash: LINKED_PASS_SOURCE_HASH,
      artifact: {
        pass: "line",
        role: "main-line",
        contentHash: `sha256:${LINKED_PASS_HASH}`,
        byteSize: 68,
        mime: "image/png",
        width: 64,
        height: 32,
        locator: LINKED_PASS_LOCATOR,
      },
    },
    corrections: [],
  }));
  return {
    pagesList: [{
      id: "page-linked",
      elements,
      linked3dRender: {
        kind: "toonspectrum.studio-linked-3d-render",
        version: 2,
        authority: "studio-project-linked-3d-pass-index",
        links,
      },
    }],
  };
}

function linkedPassAssetRow(
  patch: Partial<StudioLinked3dPassAssetRow> = {}
): StudioLinked3dPassAssetRow {
  return {
    workId: "work-1",
    assetId: LINKED_PASS_ASSET_ID,
    elementType: "image",
    mimeType: "image/png",
    descriptor: {
      version: 1,
      element: {
        id: LINKED_PASS_ASSET_ID,
        type: "image",
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        rotation: 0,
      },
    },
    byteSize: 68,
    sha256: LINKED_PASS_HASH,
    intrinsicWidth: 64,
    intrinsicHeight: 32,
    decodedRgbaBytes: 64 * 32 * 4,
    ...patch,
  };
}

function createFixture(now = DEFAULT_NOW) {
  const store = new MemoryCollaborationStore();
  let generatedInvitationSequence = 100;
  let generatedEventSequence = 1;
  store.works.set("work-1", {
    id: "work-1",
    ownerUserId: "owner",
    title: "비밀 프로젝트 1화",
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
  });
  store.users.set("owner", {
    userId: "owner",
    name: "작가",
    image: "owner.png",
    status: "active",
  });
  store.users.set("admin", {
    userId: "admin",
    name: "어시스트",
    image: "admin.png",
    status: "active",
  });
  store.users.set("editor", {
    userId: "editor",
    name: "편집자",
    image: null,
    status: "active",
  });
  store.users.set("pending", {
    userId: "pending",
    name: "초대 대상",
    image: null,
    status: "active",
  });
  store.users.set("declined", {
    userId: "declined",
    name: "재초대 대상",
    image: null,
    status: "active",
  });
  store.users.set("suspended", {
    userId: "suspended",
    name: "정지 회원",
    image: null,
    status: "suspended",
  });
  store.memberships.set(membershipKey("work-1", "admin"), {
    workId: "work-1",
    userId: "admin",
    role: "admin",
    status: "active",
    invitationId: "00000000-0000-4000-8000-000000000001",
    invitedBy: "owner",
    createdAt: new Date("2026-07-12T00:01:00.000Z"),
    updatedAt: new Date("2026-07-12T00:01:00.000Z"),
    respondedAt: new Date("2026-07-12T00:01:00.000Z"),
  });
  store.memberships.set(membershipKey("work-1", "editor"), {
    workId: "work-1",
    userId: "editor",
    role: "editor",
    status: "active",
    invitationId: "00000000-0000-4000-8000-000000000002",
    invitedBy: "owner",
    createdAt: new Date("2026-07-12T00:02:00.000Z"),
    updatedAt: new Date("2026-07-12T00:02:00.000Z"),
    respondedAt: new Date("2026-07-12T00:02:00.000Z"),
  });
  store.memberships.set(membershipKey("work-1", "pending"), {
    workId: "work-1",
    userId: "pending",
    role: "commenter",
    status: "pending",
    invitationId: PENDING_INVITATION_ID,
    invitedBy: "owner",
    createdAt: new Date("2026-07-12T00:03:00.000Z"),
    updatedAt: new Date("2026-07-12T00:03:00.000Z"),
    respondedAt: null,
  });
  store.memberships.set(membershipKey("work-1", "declined"), {
    workId: "work-1",
    userId: "declined",
    role: "viewer",
    status: "declined",
    invitationId: DECLINED_INVITATION_ID,
    invitedBy: "owner",
    createdAt: new Date("2026-07-12T00:04:00.000Z"),
    updatedAt: new Date("2026-07-12T00:04:00.000Z"),
    respondedAt: new Date("2026-07-12T00:05:00.000Z"),
  });
  return {
    store,
    repository: new CreatorCollaborationRepository(store, {
      now: () => new Date(now.getTime()),
      createInvitationId: () =>
        `00000000-0000-4000-8000-${String(generatedInvitationSequence++).padStart(12, "0")}`,
      createEventId: () =>
        `event-${String(generatedEventSequence++).padStart(6, "0")}`,
    }),
  };
}

describe("CreatorCollaborationRepository", () => {
  it("Studio work probe는 optional marker를 left join하고 작품 행만 잠근다", () => {
    const query = buildCreatorCollaborationWorkQuery(db, "work-1", true).toSQL();

    expect(query.sql).toContain('left join "creator_draft_collaboration_room"');
    expect(query.sql).toContain('for update of "creator_work"');
    expect(query.sql).not.toContain('for update of "creator_draft_collaboration_room"');
    expect(query.params).toEqual(["work-1", 1]);
  });

  it("공동 문서 primitive는 raw format 전환을 SQL 생성 전에 거부한다", () => {
    const rawPatch = { format: "upload" } as unknown as CreatorSharedDocumentPatch;
    expect(() =>
      buildCreatorSharedDocumentUpdateQuery(
        db,
        "owner",
        "work-1",
        1,
        rawPatch,
        DEFAULT_NOW
      )
    ).toThrow("shared document format is immutable");
  });

  it("공동 저장 UPDATE는 실제 원본 테이블 alias를 가진 correlated ACL SQL을 생성한다", () => {
    const query = buildCreatorSharedDocumentUpdateQuery(
      db,
      "editor",
      "work-1",
      7,
      { title: "수정" },
      DEFAULT_NOW
    ).toSQL();

    expect(query.sql).toContain('from "user" "creator_shared_document_owner"');
    expect(query.sql).toContain(
      'from "creator_work_collaborator" "creator_shared_document_editor_membership"'
    );
    expect(query.sql).toContain('"creator_work"."revision" + 1');
    expect(query.sql).not.toContain('from "creator_shared_document_owner" where');
    expect(query.sql).not.toContain(
      'from "creator_shared_document_editor_membership" where'
    );
  });

  it("게시 상태·연결 작품 UPDATE SQL은 owner predicate만 허용하고 editor ACL을 제거한다", () => {
    for (const patch of [{ status: "published" as const }, { titleId: "catalog-work" }]) {
      const query = buildCreatorSharedDocumentUpdateQuery(
        db,
        "editor",
        "work-1",
        7,
        patch,
        DEFAULT_NOW
      ).toSQL();

      expect(query.sql).toContain('"creator_work"."userId" =');
      expect(query.sql).not.toContain("creator_shared_document_editor_membership");
      expect(query.sql).not.toContain("creator_shared_document_owner");
      expect(query.params).toContain("editor");
    }
  });

  it("공유 작품 keyset SQL은 정렬·경계 비교를 동일한 millisecond 정밀도로 고정한다", () => {
    const query = buildCreatorSharedWorksListQuery(db, "editor", 21, {
      sortAt: new Date("2026-07-12T00:00:00.123Z"),
      workId: "work-20",
    }).toSQL();

    expect(query.sql.match(/date_trunc\('milliseconds'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(query.sql).toContain('"creator_work"."id" <');
    expect(query.sql).toContain('order by date_trunc(\'milliseconds\'');
    expect(query.params).toContain("editor");
    expect(query.params).toContain("work-20");
    expect(query.sql).toContain('"creator_work"."format"');
    expect(query.sql).not.toContain('"creator_work"."revision"');
    expect(query.sql).not.toContain('"creator_work"."cover"');
    expect(query.sql).not.toContain('"creator_work"."pages"');
    expect(query.sql).not.toContain('"creator_work"."doc"');
  });

  it("document meta SQL은 ACL·revision 시각만 조회하고 원고 대용량 열을 선택하지 않는다", () => {
    const query = buildCreatorSharedDocumentMetaQuery(db, "viewer", "work-1").toSQL();

    expect(query.sql).toContain('"creator_work"."revision"');
    expect(query.sql).toContain('"creator_work"."updatedAt"');
    expect(query.sql).toContain('"creator_shared_document_meta_viewer_membership"."role"');
    expect(query.sql).not.toContain('"creator_work"."cover"');
    expect(query.sql).not.toContain('"creator_work"."pages"');
    expect(query.sql).not.toContain('"creator_work"."doc"');
    expect(query.sql).not.toContain('"creator_work"."title"');
    expect(query.sql).not.toContain('"creator_shared_document_meta_owner"."name"');
    expect(query.sql).not.toContain("invitationId");
    expect(query.params).toContain("viewer");
    expect(query.params).toContain("work-1");
  });

  it("CRDT 저장 fence는 snapshot과 latest update의 최댓값을 한 statement로 조회한다", () => {
    const query = buildCreatorCrdtServerSequenceQuery(db, "work-1").toSQL();

    expect(query.sql).toContain('from "creator_work_crdt_snapshot"');
    expect(query.sql).toContain('from "creator_work_crdt_update"');
    expect(query.sql).toContain("greatest(");
    expect(query.sql).toContain("max(");
    expect(query.sql).toContain("0::bigint");
    expect(query.params.filter((value) => value === "work-1")).toHaveLength(2);
  });

  it("소유자에게 owner-first 활성·대기 팀 snapshot과 전체 관리 권한을 반환한다", async () => {
    const { repository, store } = createFixture();

    const snapshot = await repository.getTeam("owner", "work-1");

    expect(snapshot.workId).toBe("work-1");
    expect(snapshot.viewer).toEqual({
      userId: "owner",
      role: "owner",
      status: "active",
      capabilities: {
        view: true,
        comment: true,
        edit: true,
        manageMembers: true,
        respondInvite: false,
      },
    });
    expect(snapshot.members.map(({ userId }) => userId)).toEqual([
      "owner",
      "admin",
      "editor",
      "pending",
    ]);
    expect(snapshot.members[0]).toMatchObject({
      userId: "owner",
      name: "작가",
      role: "owner",
      status: "active",
      isOwner: true,
      createdAt: BASE_DATE.toISOString(),
    });
    expect(JSON.stringify(snapshot)).not.toContain("owner.png");
    expect(JSON.stringify(snapshot)).not.toContain("admin.png");
    expect(snapshot.members[0]).not.toHaveProperty("image");
    expect(store.transactionCount).toBe(1);
    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(snapshot.members.find(({ userId }) => userId === "pending")).not.toHaveProperty(
      "invitationId"
    );
  });

  it("active admin은 전체 목록을 보고 editor는 owner와 본인 정보만 본다", async () => {
    const { repository } = createFixture();

    await expect(repository.getTeam("admin", "work-1")).resolves.toMatchObject({
      viewer: { role: "admin", status: "active", capabilities: { manageMembers: true } },
    });
    const editorSnapshot = await repository.getTeam("editor", "work-1");
    expect(editorSnapshot.viewer).toMatchObject({
      role: "editor",
      status: "active",
      capabilities: { view: true, edit: true, manageMembers: false },
    });
    expect(editorSnapshot.members.map(({ userId }) => userId)).toEqual(["owner", "editor"]);
  });

  it("Studio 권한 probe는 작품 잠금 뒤 owner 한 행만 constant-cost로 반환한다", async () => {
    const { repository, store } = createFixture();

    await expect(repository.getAuthorization("owner", "work-1")).resolves.toEqual({
      workId: "work-1",
      authorizationEpoch: DEFAULT_NOW.toISOString(),
      viewer: {
        userId: "owner",
        role: "owner",
        status: "active",
        capabilities: {
          view: true,
          comment: true,
          edit: true,
          manageMembers: true,
          respondInvite: false,
        },
      },
    });

    expect(store.transactionCount).toBe(1);
    expect(store.workReadIds).toEqual(["work-1"]);
    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(store.membershipReadKeys).toEqual([]);
    expect(store.userReadIds).toEqual([]);
    expect(store.membershipListWorkIds).toEqual([]);
  });

  it("Studio 권한 probe는 collaborator 복합키 한 행만 읽고 팀을 materialize하지 않는다", async () => {
    const { repository, store } = createFixture();

    await expect(repository.getAuthorization("editor", "work-1")).resolves.toMatchObject({
      workId: "work-1",
      viewer: {
        userId: "editor",
        role: "editor",
        status: "active",
        capabilities: { view: true, edit: true, manageMembers: false },
      },
    });

    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(store.membershipReadKeys).toEqual([membershipKey("work-1", "editor")]);
    expect(store.userReadIds).toEqual([]);
    expect(store.membershipListWorkIds).toEqual([]);
  });

  it("active 임시 room은 join·hot-path authorization에 동일한 유한 lease를 투영한다", async () => {
    const { repository, store } = createFixture();
    const expiresAt = new Date(DEFAULT_NOW.getTime() + 60_000);
    Object.assign(store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: expiresAt,
      draftCollaborationOwnerUserId: "owner",
    });

    await expect(repository.getTeam("owner", "work-1")).resolves.toMatchObject({
      workId: "work-1",
      authorizationExpiresAt: expiresAt.toISOString(),
      viewer: { userId: "owner", status: "active" },
    });
    await expect(repository.getAuthorization("editor", "work-1")).resolves.toMatchObject({
      workId: "work-1",
      authorizationExpiresAt: expiresAt.toISOString(),
      viewer: { userId: "editor", status: "active", capabilities: { edit: true } },
    });
  });

  it("active 임시 room은 owner와 active member 모두 expiresAt 경계부터 fail-closed한다", async () => {
    const ownerFixture = createFixture();
    Object.assign(ownerFixture.store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW),
      draftCollaborationOwnerUserId: "owner",
    });
    const memberFixture = createFixture();
    Object.assign(memberFixture.store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() - 1),
      draftCollaborationOwnerUserId: "owner",
    });

    await expect(
      ownerFixture.repository.getTeam("owner", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
    await expect(
      memberFixture.repository.getAuthorization("editor", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
    expect(ownerFixture.store.lockedWorkIds).toEqual(["work-1"]);
    expect(memberFixture.store.lockedWorkIds).toEqual(["work-1"]);
    expect(memberFixture.store.membershipReadKeys).toEqual([]);
  });

  it("promoted 동일 workId는 과거 임시 expiry를 무시하고 일반 saved-work ACL로 전환한다", async () => {
    const { repository, store } = createFixture();
    Object.assign(store.works.get("work-1")!, {
      draftCollaborationStatus: "promoted",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() - 60_000),
      draftCollaborationOwnerUserId: "owner",
    });

    const authorization = await repository.getAuthorization("editor", "work-1");

    expect(authorization).toMatchObject({
      workId: "work-1",
      viewer: { userId: "editor", status: "active", capabilities: { edit: true } },
    });
    expect(authorization).not.toHaveProperty("authorizationExpiresAt");
  });

  it("알 수 없는 marker 상태와 손상된 active expiry는 saved work로 우회하지 않는다", async () => {
    const corruptStatus = createFixture();
    Object.assign(corruptStatus.store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "unknown",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() + 60_000),
      draftCollaborationOwnerUserId: "owner",
    });
    const missingExpiry = createFixture();
    Object.assign(missingExpiry.store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: null,
      draftCollaborationOwnerUserId: "owner",
    });
    const wrongOwner = createFixture();
    Object.assign(wrongOwner.store.works.get("work-1")!, {
      status: "draft",
      hidden: true,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() + 60_000),
      draftCollaborationOwnerUserId: "other-owner",
    });
    const visibleProvisional = createFixture();
    Object.assign(visibleProvisional.store.works.get("work-1")!, {
      status: "draft",
      hidden: false,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() + 60_000),
      draftCollaborationOwnerUserId: "owner",
    });

    await expect(
      corruptStatus.repository.getAuthorization("owner", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
    await expect(
      missingExpiry.repository.getAuthorization("owner", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
    await expect(
      wrongOwner.repository.getAuthorization("owner", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
    await expect(
      visibleProvisional.repository.getAuthorization("owner", "work-1")
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("team_access_denied"));
  });

  it("Studio 권한 probe는 대기·거절 상태를 fail-closed projection하고 없는 멤버는 거절한다", async () => {
    const { repository } = createFixture();

    await expect(repository.getAuthorization("pending", "work-1")).resolves.toMatchObject({
      viewer: {
        role: "commenter",
        status: "pending",
        capabilities: { view: false, respondInvite: true },
        invitationId: PENDING_INVITATION_ID,
      },
    });
    await expect(repository.getAuthorization("declined", "work-1")).resolves.toMatchObject({
      viewer: {
        role: "viewer",
        status: "declined",
        capabilities: { view: false, respondInvite: false },
      },
    });
    await expect(repository.getAuthorization("outsider", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("team_access_denied")
    );
  });

  it("대기 중인 초대자는 owner와 본인만 보고 본인 초대 응답 권한만 받는다", async () => {
    const { repository } = createFixture();

    const snapshot = await repository.getTeam("pending", "work-1");

    expect(snapshot.viewer).toEqual({
      userId: "pending",
      role: "commenter",
      status: "pending",
      capabilities: {
        view: false,
        comment: false,
        edit: false,
        manageMembers: false,
        respondInvite: true,
      },
      invitationId: PENDING_INVITATION_ID,
    });
    expect(snapshot.members.map(({ userId }) => userId)).toEqual(["owner", "pending"]);
    expect(snapshot.members.at(-1)).toMatchObject({ invitationId: PENDING_INVITATION_ID });
  });

  it("거절한 초대자는 권한 없이 owner와 본인 상태 snapshot을 다시 열 수 있다", async () => {
    const { repository } = createFixture();

    const snapshot = await repository.getTeam("declined", "work-1");

    expect(snapshot.viewer).toMatchObject({
      role: "viewer",
      status: "declined",
      capabilities: {
        view: false,
        comment: false,
        edit: false,
        manageMembers: false,
        respondInvite: false,
      },
    });
    expect(snapshot.viewer).not.toHaveProperty("invitationId");
    expect(snapshot.members.map(({ userId }) => userId)).toEqual(["owner", "declined"]);
  });

  it("관리자가 활성 회원을 초대하고 작품 행 잠금 안의 transaction에서 최신 snapshot을 받는다", async () => {
    const { repository, store } = createFixture();
    store.users.set("new-artist", {
      userId: "new-artist",
      name: "새 어시스트",
      image: "",
      status: "active",
    });

    const snapshot = await repository.invite("admin", "work-1", "new-artist", "editor");

    expect(store.transactionCount).toBe(1);
    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(store.memberships.get(membershipKey("work-1", "new-artist"))).toMatchObject({
      role: "editor",
      status: "pending",
      invitationId: "00000000-0000-4000-8000-000000000100",
      invitedBy: "admin",
      respondedAt: null,
    });
    expect(snapshot.members.at(-1)).toMatchObject({
      userId: "new-artist",
      role: "editor",
      status: "pending",
    });
  });

  it("거절 기록은 재초대 시 pending으로 되돌리고 시간·초대자·역할을 갱신한다", async () => {
    const { repository, store } = createFixture();
    const before = store.memberships.get(membershipKey("work-1", "declined"));

    await repository.invite("owner", "work-1", "declined", "admin");

    const reinvited = store.memberships.get(membershipKey("work-1", "declined"));
    expect(reinvited).toMatchObject({
      role: "admin",
      status: "pending",
      invitationId: "00000000-0000-4000-8000-000000000100",
      invitedBy: "owner",
      respondedAt: null,
    });
    expect(reinvited?.createdAt).toEqual(before?.createdAt);
    expect(reinvited?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
    expect(reinvited?.invitationId).not.toBe(before?.invitationId);
  });

  it("거절 후 24시간 동안은 재초대를 일반화된 typed conflict로 제한한다", async () => {
    const { repository, store } = createFixture(new Date("2026-07-12T12:05:00.000Z"));

    await expect(repository.invite("owner", "work-1", "declined", "viewer")).rejects.toEqual(
      new CreatorCollaborationConflictError("reinvite_cooldown")
    );
    expect(store.memberships.get(membershipKey("work-1", "declined"))).toMatchObject({
      status: "declined",
      invitationId: DECLINED_INVITATION_ID,
    });
  });

  it("작품 행 잠금 아래 non-declined 팀원 100명 상한을 원자적으로 지킨다", async () => {
    const { repository, store } = createFixture();
    store.users.set("overflow", {
      userId: "overflow",
      name: "정원 초과",
      image: null,
      status: "active",
    });
    for (let index = 0; index < 97; index += 1) {
      const userId = `member-${index}`;
      store.memberships.set(membershipKey("work-1", userId), {
        workId: "work-1",
        userId,
        role: "viewer",
        status: "active",
        invitationId: "00000000-0000-4000-8000-000000000999",
        invitedBy: "owner",
        createdAt: BASE_DATE,
        updatedAt: BASE_DATE,
        respondedAt: BASE_DATE,
      });
    }

    await expect(repository.invite("owner", "work-1", "overflow", "viewer")).rejects.toEqual(
      new CreatorCollaborationConflictError("member_limit_reached")
    );
    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(store.memberships.has(membershipKey("work-1", "overflow"))).toBe(false);
  });

  it("소유자·본인·비활성 회원 초대와 active/pending 중복 초대를 구분해 거부한다", async () => {
    const { repository } = createFixture();

    await expect(repository.invite("owner", "work-1", "owner", "viewer")).rejects.toEqual(
      new CreatorCollaborationInvalidTargetError("owner_or_self_target")
    );
    await expect(repository.invite("admin", "work-1", "admin", "viewer")).rejects.toEqual(
      new CreatorCollaborationInvalidTargetError("owner_or_self_target")
    );
    await expect(repository.invite("owner", "work-1", "suspended", "viewer")).rejects.toEqual(
      new CreatorCollaborationInvalidTargetError("target_user_unavailable")
    );
    await expect(repository.invite("owner", "work-1", "editor", "viewer")).rejects.toEqual(
      new CreatorCollaborationConflictError("member_already_active")
    );
    await expect(repository.invite("owner", "work-1", "pending", "viewer")).rejects.toEqual(
      new CreatorCollaborationConflictError("invitation_already_pending")
    );
  });

  it("초대자는 자신의 pending 초대만 수락·거절하며 최소 응답만 받는다", async () => {
    const accepted = createFixture();

    const acceptedSnapshot = await accepted.repository.respondToInvitation(
      "pending",
      "work-1",
      "accept",
      PENDING_INVITATION_ID
    );

    expect(accepted.store.memberships.get(membershipKey("work-1", "pending"))).toMatchObject({
      status: "active",
    });
    expect(acceptedSnapshot).toEqual({
      workId: "work-1",
      role: "commenter",
      status: "active",
    });
    expect(acceptedSnapshot).not.toHaveProperty("members");
    expect(acceptedSnapshot).not.toHaveProperty("viewer");
    expect(accepted.store.lockedUserIds).toEqual(["owner"]);
    await expect(
      accepted.repository.respondToInvitation(
        "pending",
        "work-1",
        "accept",
        PENDING_INVITATION_ID
      )
    ).rejects.toEqual(new CreatorCollaborationConflictError("invitation_not_pending"));

    const declined = createFixture();
    const declinedSnapshot = await declined.repository.respondToInvitation(
      "pending",
      "work-1",
      "decline",
      PENDING_INVITATION_ID
    );
    expect(declinedSnapshot).toEqual({
      workId: "work-1",
      role: "commenter",
      status: "declined",
    });
  });

  it("pending 역할 변경은 동의 토큰을 회전해 이전 역할의 응답을 거부한다", async () => {
    const { repository, store } = createFixture();

    await repository.updateMemberRole("owner", "work-1", "pending", "admin");
    const rotatedInvitationId = store.memberships.get(
      membershipKey("work-1", "pending")
    )?.invitationId;

    expect(rotatedInvitationId).toBe("00000000-0000-4000-8000-000000000100");
    await expect(
      repository.respondToInvitation(
        "pending",
        "work-1",
        "accept",
        PENDING_INVITATION_ID
      )
    ).rejects.toEqual(new CreatorCollaborationConflictError("invitation_changed"));
    await expect(
      repository.respondToInvitation(
        "pending",
        "work-1",
        "accept",
        rotatedInvitationId ?? ""
      )
    ).resolves.toEqual({ workId: "work-1", role: "admin", status: "active" });
  });

  it("삭제 후 재초대도 새 동의 토큰만 허용해 삭제 전 응답을 무효화한다", async () => {
    const { repository, store } = createFixture();

    await repository.removeMember("owner", "work-1", "pending");
    await repository.invite("owner", "work-1", "pending", "viewer");
    const reinvitedId = store.memberships.get(membershipKey("work-1", "pending"))?.invitationId;

    expect(reinvitedId).toBe("00000000-0000-4000-8000-000000000100");
    await expect(
      repository.respondToInvitation(
        "pending",
        "work-1",
        "decline",
        PENDING_INVITATION_ID
      )
    ).rejects.toEqual(new CreatorCollaborationConflictError("invitation_changed"));
    await expect(
      repository.respondToInvitation(
        "pending",
        "work-1",
        "decline",
        reinvitedId ?? ""
      )
    ).resolves.toEqual({ workId: "work-1", role: "viewer", status: "declined" });
  });

  it("관리자는 역할을 바꾸고 팀원을 제거하지만 owner 행은 수정·삭제할 수 없다", async () => {
    const { repository, store } = createFixture();

    await repository.updateMemberRole("admin", "work-1", "editor", "viewer");
    expect(store.memberships.get(membershipKey("work-1", "editor"))?.role).toBe("viewer");
    const snapshot = await repository.removeMember("admin", "work-1", "editor");
    expect(store.memberships.has(membershipKey("work-1", "editor"))).toBe(false);
    expect(snapshot.members.some(({ userId }) => userId === "editor")).toBe(false);

    await expect(repository.updateMemberRole("admin", "work-1", "owner", "viewer")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    await expect(repository.removeMember("admin", "work-1", "owner")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    await expect(repository.updateMemberRole("admin", "work-1", "admin", "viewer")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    await expect(repository.removeMember("admin", "work-1", "admin")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
  });

  it("replays the durable removal epoch when edge revocation delivery is retried", async () => {
    const { repository } = createFixture();

    const first = await repository.removeMemberWithRevocation(
      "owner",
      "work-1",
      "editor",
    );
    const retry = await repository.removeMemberWithRevocation(
      "owner",
      "work-1",
      "editor",
    );

    expect(retry.authorizationEpochMs).toBe(first.authorizationEpochMs);
    expect(retry.snapshot).toEqual(first.snapshot);
  });

  it("초대함은 로그인 사용자 자신의 pending 초대만 최신순·limit 안에서 최소 정보로 투영한다", async () => {
    const { repository, store } = createFixture();
    store.users.set("owner-2", {
      userId: "owner-2",
      name: "두 번째 작가",
      image: "owner-2.png",
      status: "active",
    });
    store.works.set("work-2", {
      id: "work-2",
      ownerUserId: "owner-2",
      title: "공동 작업 2화",
      createdAt: BASE_DATE,
      updatedAt: DEFAULT_NOW,
    });
    store.memberships.set(membershipKey("work-2", "pending"), {
      workId: "work-2",
      userId: "pending",
      role: "editor",
      status: "pending",
      invitationId: "00000000-0000-4000-8000-000000000202",
      invitedBy: "owner-2",
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      updatedAt: new Date("2026-07-14T00:00:00.000Z"),
      respondedAt: null,
    });
    store.memberships.set(membershipKey("work-2", "editor"), {
      workId: "work-2",
      userId: "editor",
      role: "viewer",
      status: "pending",
      invitationId: "00000000-0000-4000-8000-000000000203",
      invitedBy: "owner-2",
      createdAt: new Date("2026-07-14T00:01:00.000Z"),
      updatedAt: new Date("2026-07-14T00:01:00.000Z"),
      respondedAt: null,
    });

    await expect(repository.listInvitations("pending", 1)).resolves.toEqual([
      {
        workId: "work-2",
        workTitle: "공동 작업 2화",
        owner: {
          name: "두 번째 작가",
        },
        role: "editor",
        invitationId: "00000000-0000-4000-8000-000000000202",
        invitedAt: "2026-07-14T00:00:00.000Z",
      },
    ]);
    await expect(repository.listInvitations("owner", 20)).resolves.toEqual([]);
    const editorInbox = await repository.listInvitations("editor", 20);
    expect(editorInbox).toHaveLength(1);
    expect(editorInbox[0]?.workId).toBe("work-2");
    expect(editorInbox[0]).not.toHaveProperty("status");
    expect(editorInbox[0]).not.toHaveProperty("members");
    expect(editorInbox[0]?.owner).not.toHaveProperty("userId");
    expect(editorInbox[0]?.owner).not.toHaveProperty("image");
    expect(JSON.stringify(editorInbox)).not.toContain("owner-2.png");

    store.users.get("owner-2")!.name = "   ";
    const genericOwnerInbox = await repository.listInvitations("pending", 20);
    expect(genericOwnerInbox[0]?.owner).toEqual({ name: "작품 소유자" });
  });

  it("비활성 소유자 작품은 초대함에서 숨기고 응답도 소유자 행 잠금 아래 fail-closed 한다", async () => {
    const { repository, store } = createFixture();
    store.users.get("owner")!.status = "suspended";

    await expect(repository.listInvitations("pending", 20)).resolves.toEqual([]);
    await expect(
      repository.respondToInvitation(
        "pending",
        "work-1",
        "accept",
        PENDING_INVITATION_ID
      )
    ).rejects.toEqual(new CreatorCollaborationConflictError("invitation_not_pending"));

    expect(store.lockedWorkIds).toEqual(["work-1"]);
    expect(store.lockedUserIds).toEqual(["owner"]);
    expect(store.memberships.get(membershipKey("work-1", "pending"))).toMatchObject({
      status: "pending",
      respondedAt: null,
    });
    expect(store.events).toEqual([]);
  });

  it("감사 이벤트 저장이 실패하면 같은 transaction의 멤버십 변경도 롤백한다", async () => {
    const { repository, store } = createFixture();
    store.failNextEvent = true;

    await expect(
      repository.updateMemberRole("owner", "work-1", "editor", "viewer")
    ).rejects.toThrow("event insert failed");

    expect(store.memberships.get(membershipKey("work-1", "editor"))).toMatchObject({
      role: "editor",
      status: "active",
    });
    expect(store.events).toEqual([]);
  });

  it("모든 팀 변경은 역할·상태 전후값만 기록하고 이름·동의 토큰은 저장하지 않는다", async () => {
    const accepted = createFixture();
    accepted.store.users.set("new-artist", {
      userId: "new-artist",
      name: "새 작가",
      image: null,
      status: "active",
    });

    await accepted.repository.updateMemberRole("owner", "work-1", "editor", "viewer");
    await accepted.repository.removeMember("owner", "work-1", "editor");
    await accepted.repository.respondToInvitation(
      "pending",
      "work-1",
      "accept",
      PENDING_INVITATION_ID
    );
    await accepted.repository.invite("owner", "work-1", "new-artist", "editor");
    await accepted.repository.invite("owner", "work-1", "declined", "admin");

    expect(accepted.store.events.map(({ action }) => action)).toEqual([
      "role_change",
      "remove",
      "accept",
      "invite",
      "reinvite",
    ]);
    expect(accepted.store.events[0]).toMatchObject({
      actorUserId: "owner",
      targetUserId: "editor",
      beforeState: { role: "editor", status: "active" },
      afterState: { role: "viewer", status: "active" },
      sequence: 1,
    });
    expect(accepted.store.events[0]).not.toHaveProperty("actorName");
    expect(accepted.store.events[0]).not.toHaveProperty("targetName");
    expect(accepted.store.events[0]).not.toHaveProperty("invitationId");
    expect(JSON.stringify(accepted.store.events)).not.toContain("작가");
    expect(JSON.stringify(accepted.store.events)).not.toContain("편집자");
    expect(JSON.stringify(accepted.store.events)).not.toContain(PENDING_INVITATION_ID);
    expect(accepted.store.events.at(-1)).toMatchObject({
      beforeState: { role: "viewer", status: "declined" },
      afterState: { role: "admin", status: "pending" },
    });

    const declined = createFixture();
    await declined.repository.respondToInvitation(
      "pending",
      "work-1",
      "decline",
      PENDING_INVITATION_ID
    );
    expect(declined.store.events[0]).toMatchObject({
      action: "decline",
      beforeState: { role: "commenter", status: "pending" },
      afterState: { role: "commenter", status: "declined" },
    });
    expect(JSON.stringify(declined.store.events[0])).not.toContain(PENDING_INVITATION_ID);
  });

  it("소유자와 active admin은 이벤트가 없어도 단일 권한 조회의 빈 목록을 받는다", async () => {
    const { repository, store } = createFixture();
    const workReadsBefore = store.workReadIds.length;
    const membershipReadsBefore = store.membershipReadKeys.length;

    await expect(repository.getActivity("owner", "work-1", 20)).resolves.toEqual([]);
    await expect(repository.getActivity("admin", "work-1", 20)).resolves.toEqual([]);

    expect(store.authorizedEventReads).toEqual([
      { actorUserId: "owner", workId: "work-1", limit: 20 },
      { actorUserId: "admin", workId: "work-1", limit: 20 },
    ]);
    expect(store.workReadIds).toHaveLength(workReadsBefore);
    expect(store.membershipReadKeys).toHaveLength(membershipReadsBefore);
    expect(store.lockedWorkIds).toEqual([]);
  });

  it("활동은 DB 삽입 sequence 최신순으로 조회해 동일 시각·무작위 UUID에도 안정적이다", async () => {
    const { repository, store } = createFixture();
    store.users.set("new-artist", {
      userId: "new-artist",
      name: "새 작가",
      image: null,
      status: "active",
    });
    await repository.updateMemberRole("owner", "work-1", "editor", "viewer");
    await repository.removeMember("owner", "work-1", "editor");
    await repository.invite("owner", "work-1", "new-artist", "editor");
    store.events[0]!.id = "zzzz-public-id";
    store.events[1]!.id = "mmmm-public-id";
    store.events[2]!.id = "aaaa-public-id";

    expect(new Set(store.events.map(({ createdAt }) => createdAt.toISOString())).size).toBe(1);
    expect(store.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    const lockedWorkCountBeforeActivity = store.lockedWorkIds.length;

    const ownerActivity = await repository.getActivity("owner", "work-1", 2);
    expect(ownerActivity.map(({ action }) => action)).toEqual(["invite", "remove"]);
    expect(ownerActivity[0]).toEqual({
      id: "aaaa-public-id",
      action: "invite",
      actor: { userId: "owner", name: "작가" },
      target: { userId: "new-artist", name: "새 작가" },
      before: null,
      after: { role: "editor", status: "pending" },
      createdAt: DEFAULT_NOW.toISOString(),
    });
    expect(JSON.stringify(ownerActivity)).not.toContain("invitationId");
    expect(JSON.stringify(ownerActivity)).not.toContain(
      "00000000-0000-4000-8000-000000000100"
    );
    await expect(repository.getActivity("admin", "work-1", 20)).resolves.toHaveLength(3);
    await expect(repository.getActivity("pending", "work-1", 20)).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    await expect(repository.getActivity("editor", "work-1", 20)).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    expect(store.lockedWorkIds).toHaveLength(lockedWorkCountBeforeActivity);
    expect(store.authorizedEventRowsMaterialized).toBe(5);
  });

  it("활동 권한과 이벤트를 atomic하게 평가해 editor와 조회 직전 회수된 admin에게 행을 만들지 않는다", async () => {
    const { repository, store } = createFixture();
    await repository.updateMemberRole("owner", "work-1", "editor", "viewer");
    const workReadsBefore = store.workReadIds.length;
    const membershipReadsBefore = store.membershipReadKeys.length;
    const lockedWorkCountBefore = store.lockedWorkIds.length;
    const materializedBefore = store.authorizedEventRowsMaterialized;

    store.beforeAuthorizedEventRead = () => {
      store.memberships.delete(membershipKey("work-1", "admin"));
    };

    await expect(repository.getActivity("admin", "work-1", 20)).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );
    await expect(repository.getActivity("editor", "work-1", 20)).rejects.toEqual(
      new CreatorCollaborationForbiddenError("member_management_denied")
    );

    expect(store.authorizedEventReads.slice(-2)).toEqual([
      { actorUserId: "admin", workId: "work-1", limit: 20 },
      { actorUserId: "editor", workId: "work-1", limit: 20 },
    ]);
    expect(store.authorizedEventRowsMaterialized).toBe(materializedBefore);
    expect(store.membershipReadKeys).toHaveLength(membershipReadsBefore);
    expect(store.workReadIds).toHaveLength(workReadsBefore + 2);
    expect(store.lockedWorkIds).toHaveLength(lockedWorkCountBefore);
  });

  it("활동 이름은 현재 사용자만 조인하고 soft/hard delete를 비식별화한다", async () => {
    const { repository, store } = createFixture();
    await repository.updateMemberRole("admin", "work-1", "editor", "viewer");

    expect(store.events[0]).not.toHaveProperty("actorName");
    expect(store.events[0]).not.toHaveProperty("targetName");
    expect(JSON.stringify(store.events[0])).not.toContain("어시스트");
    expect(JSON.stringify(store.events[0])).not.toContain("편집자");

    store.users.get("admin")!.name = "현재 어시스트";
    store.users.get("editor")!.status = "deleted";
    store.users.get("editor")!.name = "삭제 전 이름이 남아 있어도 노출 금지";
    const softDeletedActivity = await repository.getActivity("owner", "work-1", 20);
    expect(softDeletedActivity[0]).toMatchObject({
      actor: { userId: "admin", name: "현재 어시스트" },
      target: { userId: null, name: "탈퇴한 사용자" },
    });

    store.users.delete("admin");
    store.users.delete("editor");
    const hardDeletedActivity = await repository.getActivity("owner", "work-1", 20);
    expect(hardDeletedActivity[0]).toMatchObject({
      actor: { userId: null, name: "알 수 없는 사용자" },
      target: { userId: null, name: "알 수 없는 사용자" },
    });
  });

  it("손상된 최신 이벤트는 limit 전에 필터하고 손상된 초대도 fail-closed 투영한다", async () => {
    const { repository, store } = createFixture();
    await repository.updateMemberRole("owner", "work-1", "editor", "viewer");
    store.events.push({
      id: "corrupt-event",
      workId: "work-1",
      actorUserId: null,
      targetUserId: null,
      action: "role_change",
      beforeState: { role: "owner", status: "active" },
      afterState: { role: "viewer", status: "active" },
      sequence: store.nextEventSequence++,
      createdAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    store.memberships.get(membershipKey("work-1", "pending"))!.role = "owner";

    const materializedBefore = store.authorizedEventRowsMaterialized;
    const activity = await repository.getActivity("owner", "work-1", 1);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ id: "event-000001", action: "role_change" });
    expect(store.authorizedEventRowsMaterialized - materializedBefore).toBe(1);
    await expect(repository.listInvitations("pending", 20)).resolves.toEqual([]);
  });

  it("공유 작품 목록은 소유 작품과 active 멤버 작품만 최신순으로 최소 투영한다", async () => {
    const { repository, store } = createFixture();
    store.works.set("work-owned", {
      id: "work-owned",
      ownerUserId: "editor",
      title: "내 공동 작업",
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      updatedAt: null,
      revision: 4,
    });
    store.works.set("work-legacy", {
      id: "work-legacy",
      ownerUserId: "editor",
      title: "시각 정보 없는 레거시 작품",
      createdAt: null,
      updatedAt: null,
      revision: 1,
    });
    store.users.set("viewer", {
      userId: "viewer",
      name: "열람자",
      image: null,
      status: "active",
    });
    store.memberships.set(membershipKey("work-1", "viewer"), {
      workId: "work-1",
      userId: "viewer",
      role: "viewer",
      status: "active",
      invitationId: "00000000-0000-4000-8000-000000000305",
      invitedBy: "owner",
      createdAt: BASE_DATE,
      updatedAt: BASE_DATE,
      respondedAt: BASE_DATE,
    });

    const editorPage = await repository.listSharedWorks("editor", 20);
    const editorWorks = editorPage.items;
    expect(editorWorks.map(({ workId }) => workId)).toEqual([
      "work-owned",
      "work-1",
      "work-legacy",
    ]);
    expect(editorPage.nextCursor).toBeNull();
    expect(editorWorks[0]).toEqual({
      workId: "work-owned",
      title: "내 공동 작업",
      format: "cuttoon",
      role: "owner",
      status: "active",
      capabilities: { view: true, comment: true, edit: true, manageMembers: true },
      owner: { name: "편집자" },
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    expect(editorWorks[1]).toMatchObject({
      role: "editor",
      capabilities: { view: true, comment: true, edit: true, manageMembers: false },
    });
    expect(editorWorks[1]).not.toHaveProperty("revision");
    expect(editorWorks[1]).not.toHaveProperty("cover");
    expect(editorWorks[2]?.updatedAt).toBe("1970-01-01T00:00:00.000Z");

    await expect(repository.listSharedWorks("pending", 20)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    const viewerWorks = (await repository.listSharedWorks("viewer", 20)).items;
    expect(viewerWorks[0]).toMatchObject({
      workId: "work-1",
      role: "viewer",
      capabilities: { view: true, comment: false, edit: false, manageMembers: false },
    });
  });

  it("공유 작품 cursor는 전체 정렬키로 50개 초과 작품을 중복·누락 없이 순회한다", async () => {
    const { repository, store } = createFixture();
    const tiedTimestamp = new Date("2026-07-15T00:00:00.000Z");
    for (let index = 0; index < 55; index += 1) {
      const id = `owned-${String(index).padStart(3, "0")}`;
      store.works.set(id, {
        id,
        ownerUserId: "editor",
        title: `소유 작품 ${index}`,
        createdAt: BASE_DATE,
        updatedAt: tiedTimestamp,
        revision: 1,
      });
    }

    const first = await repository.listSharedWorks("editor", 20);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.workId).toBe("owned-054");
    expect(first.items.at(-1)?.workId).toBe("owned-035");
    expect(first.nextCursor).not.toBeNull();
    expect(decodeCreatorSharedWorksCursor(first.nextCursor!)).toEqual({
      sortAt: tiedTimestamp,
      workId: "owned-035",
    });

    const allItems = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await repository.listSharedWorks("editor", 20, cursor);
      allItems.push(...page.items);
      cursor = page.nextCursor;
    }

    expect(allItems).toHaveLength(56);
    expect(new Set(allItems.map(({ workId }) => workId)).size).toBe(56);
    expect(allItems.at(-1)?.workId).toBe("work-1");

    const validAlternatePosition = encodeCreatorSharedWorksCursor({
      sortAt: tiedTimestamp,
      workId: "owned-045",
    });
    const afterAlternatePosition = await repository.listSharedWorks(
      "editor",
      5,
      validAlternatePosition
    );
    expect(afterAlternatePosition.items.map(({ workId }) => workId)).toEqual([
      "owned-044",
      "owned-043",
      "owned-042",
      "owned-041",
      "owned-040",
    ]);

    await expect(repository.listSharedWorks("editor", 20, "forged")).rejects.toEqual(
      new CreatorCollaborationInvalidTargetError("invalid_cursor")
    );
    await expect(
      repository.listSharedWorks("editor", 20, `${first.nextCursor}=`)
    ).rejects.toEqual(new CreatorCollaborationInvalidTargetError("invalid_cursor"));
    const reorderedCursor = Buffer.from(
      JSON.stringify({ workId: "owned-035", sortAt: tiedTimestamp.toISOString(), v: 1 })
    ).toString("base64url");
    const whitespaceCursor = Buffer.from(
      JSON.stringify(
        { v: 1, sortAt: tiedTimestamp.toISOString(), workId: "owned-035" },
        null,
        2
      )
    ).toString("base64url");
    await expect(
      repository.listSharedWorks("editor", 20, reorderedCursor)
    ).rejects.toEqual(new CreatorCollaborationInvalidTargetError("invalid_cursor"));
    await expect(
      repository.listSharedWorks("editor", 20, whitespaceCursor)
    ).rejects.toEqual(new CreatorCollaborationInvalidTargetError("invalid_cursor"));
  });

  it("active 모든 역할은 원본을 읽고 owner/admin/editor만 revision 저장한다", async () => {
    const { repository, store } = createFixture();
    store.works.get("work-1")!.revision = 1;
    store.works.get("work-1")!.doc = { pagesList: [{ id: "page-1" }] };
    for (const [userId, role] of [
      ["commenter", "commenter"],
      ["viewer", "viewer"],
    ] as const) {
      store.users.set(userId, {
        userId,
        name: userId,
        image: null,
        status: "active",
      });
      store.memberships.set(membershipKey("work-1", userId), {
        workId: "work-1",
        userId,
        role,
        status: "active",
        invitationId: `00000000-0000-4000-8000-00000000030${role === "commenter" ? "6" : "7"}`,
        invitedBy: "owner",
        createdAt: BASE_DATE,
        updatedAt: BASE_DATE,
        respondedAt: BASE_DATE,
      });
    }

    await expect(repository.getSharedDocument("owner", "work-1")).resolves.toMatchObject({
      role: "owner",
      revision: 1,
      capabilities: { view: true, edit: true },
      document: { doc: { pagesList: [{ id: "page-1" }] } },
    });
    await expect(repository.getSharedDocument("admin", "work-1")).resolves.toMatchObject({
      role: "admin",
      capabilities: { view: true, edit: true },
    });
    await expect(repository.getSharedDocument("commenter", "work-1")).resolves.toMatchObject({
      role: "commenter",
      capabilities: { view: true, edit: false },
    });
    await expect(repository.getSharedDocument("viewer", "work-1")).resolves.toMatchObject({
      role: "viewer",
      capabilities: { view: true, edit: false },
    });

    for (const [userId, role, edit] of [
      ["owner", "owner", true],
      ["admin", "admin", true],
      ["editor", "editor", true],
      ["commenter", "commenter", false],
      ["viewer", "viewer", false],
    ] as const) {
      await expect(repository.getSharedDocumentMeta(userId, "work-1")).resolves.toEqual({
        workId: "work-1",
        role,
        status: "active",
        capabilities: { view: true, edit },
        revision: 1,
        crdtServerSequence: "0",
        updatedAt: BASE_DATE.toISOString(),
      });
    }
    await expect(repository.getSharedDocument("pending", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    await expect(repository.getSharedDocument("declined", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    await expect(repository.getSharedDocumentMeta("pending", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    await expect(repository.getSharedDocumentMeta("declined", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );

    store.saveLockOrder.length = 0;
    const saved = await repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
      title: "팀 수정본",
      doc: { pagesList: [{ id: "page-2" }] },
    });
    expect(saved).toEqual({
      workId: "work-1",
      revision: 2,
      updatedAt: DEFAULT_NOW.toISOString(),
    });
    expect(store.works.get("work-1")).toMatchObject({
      title: "팀 수정본",
      revision: 2,
      doc: { pagesList: [{ id: "page-2" }] },
    });
    expect(store.workRevisions).toHaveLength(1);
    expect(store.workRevisions[0]).toMatchObject({
      workId: "work-1",
      revision: 2,
      snapshot: { title: "팀 수정본", doc: { pagesList: [{ id: "page-2" }] } },
    });
    await expect(repository.getSharedDocumentMeta("editor", "work-1")).resolves.toMatchObject({
      revision: 2,
      updatedAt: DEFAULT_NOW.toISOString(),
      capabilities: { view: true, edit: true },
    });
    expect(store.lockedWorkIds).toContain("work-1");
    expect(store.lockedUserIds).toContain("owner");
    expect(store.saveLockOrder.slice(0, 3)).toEqual([
      "crdt-advisory:work-1",
      "work-row:work-1",
      "crdt-sequence:work-1",
    ]);

    await expect(
      repository.saveSharedDocument("editor", "work-1", 2, BigInt(0), { status: "published" })
    ).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_owner_fields_denied")
    );
    await expect(
      repository.saveSharedDocument("admin", "work-1", 2, BigInt(0), { titleId: "catalog-title" })
    ).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_owner_fields_denied")
    );
    await expect(
      repository.saveSharedDocument("commenter", "work-1", 2, BigInt(0), { description: "불가" })
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("document_edit_denied"));
    await expect(
      repository.saveSharedDocument("viewer", "work-1", 2, BigInt(0), { description: "불가" })
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("document_edit_denied"));
    await expect(
      repository.saveSharedDocument(
        "owner",
        "work-1",
        2,
        BigInt(0),
        { format: "upload" } as unknown as CreatorSharedDocumentPatch
      )
    ).rejects.toThrow("invalid creator shared document mutation");
    expect(store.documentUpdateCount).toBe(1);
    expect(store.workRevisionAppendCount).toBe(1);
  });

  it("active hidden provisional work의 owner도 shared PATCH로 게시할 수 없다", async () => {
    const { repository, store } = createFixture();
    const work = store.works.get("work-1");
    if (!work) throw new Error("missing test work");
    Object.assign(work, {
      status: "draft",
      hidden: true,
      revision: 1,
      draftCollaborationStatus: "active",
      draftCollaborationExpiresAt: new Date(DEFAULT_NOW.getTime() + 60_000),
      draftCollaborationOwnerUserId: "owner",
    });

    await expect(
      repository.saveSharedDocument("owner", "work-1", 1, BigInt(0), {
        status: "published",
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationStatusLockedError);
    expect(store.lockedWorkIds).toContain("work-1");
    expect(store.documentUpdateCount).toBe(0);
    expect(store.workRevisionAppendCount).toBe(0);
    expect(store.works.get("work-1")).toMatchObject({
      status: "draft",
      hidden: true,
      revision: 1,
    });

    await expect(
      repository.saveSharedDocument("owner", "work-1", 1, BigInt(0), {
        status: "draft",
      })
    ).resolves.toMatchObject({ workId: "work-1", revision: 2 });
  });

  it("공유 저장은 work lock 안에서 exact linked-pass asset을 확인한 뒤 revision을 쓴다", async () => {
    const { repository, store } = createFixture();
    store.linkedPassAssets.set(
      `work-1\u0000${LINKED_PASS_ASSET_ID}`,
      linkedPassAssetRow()
    );

    await expect(repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
      title: "linked pass saved",
      doc: linkedPassDocument(),
    })).resolves.toMatchObject({ workId: "work-1", revision: 2 });

    const workLockIndex = store.saveLockOrder.indexOf("work-row:work-1");
    const assetReadIndex = store.saveLockOrder.indexOf("linked-pass-assets:work-1");
    expect(workLockIndex).toBeGreaterThanOrEqual(0);
    expect(assetReadIndex).toBeGreaterThan(workLockIndex);
    expect(store.documentUpdateCount).toBe(1);
    expect(store.workRevisionAppendCount).toBe(1);
    expect(store.works.get("work-1")?.doc).toEqual(linkedPassDocument());
  });

  it("공유 PATCH는 byte budget 안의 65 linked passes를 손실 없이 저장한다", async () => {
    const { repository, store } = createFixture();
    const doc = linkedPassDocument(65);
    store.linkedPassAssets.set(
      `work-1\u0000${LINKED_PASS_ASSET_ID}`,
      linkedPassAssetRow(),
    );

    await expect(repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
      doc,
    })).resolves.toMatchObject({ workId: "work-1", revision: 2 });
    expect(store.works.get("work-1")?.doc).toEqual(doc);
  });

  it.each([
    ["missing row", null],
    ["mismatched intrinsic receipt", linkedPassAssetRow({ intrinsicWidth: 63 })],
  ])("공유 저장은 %s이면 문서와 revision을 함께 rollback한다", async (_name, row) => {
    const { repository, store } = createFixture();
    if (row) store.linkedPassAssets.set(`work-1\u0000${LINKED_PASS_ASSET_ID}`, row);

    const error = await repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
      doc: linkedPassDocument(),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StudioLinked3dPassAssetFenceError);
    expect((error as StudioLinked3dPassAssetFenceError).code).toBe(
      row ? "asset-mismatch" : "asset-missing"
    );
    expect(store.works.get("work-1")?.revision ?? 1).toBe(1);
    expect(store.works.get("work-1")?.doc).toBeUndefined();
    expect(store.documentUpdateCount).toBe(0);
    expect(store.workRevisionAppendCount).toBe(0);
  });

  it("공유 저장은 locator를 receipt 바깥에 숨긴 문서를 asset 조회 전에 거부한다", async () => {
    const { repository, store } = createFixture();
    const doc = linkedPassDocument();
    const page = (doc.pagesList as Array<{ elements: Array<Record<string, unknown>> }>)[0]!;
    page.elements[0]!.maskSrc = LINKED_PASS_LOCATOR;
    store.linkedPassAssets.set(
      `work-1\u0000${LINKED_PASS_ASSET_ID}`,
      linkedPassAssetRow()
    );

    await expect(repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
      doc,
    })).rejects.toMatchObject({ code: "invalid-reserved-locator" });
    expect(store.saveLockOrder).not.toContain("linked-pass-assets:work-1");
    expect(store.documentUpdateCount).toBe(0);
  });

  it("stale CRDT sequence는 advisory lock 안에서 전용 conflict로 저장을 중단한다", async () => {
    const { repository, store } = createFixture();
    store.crdtServerSequences.set("work-1", BigInt(42));

    await expect(
      repository.saveSharedDocument("editor", "work-1", 1, BigInt(41), { title: "stale CRDT" })
    ).rejects.toEqual(
      new CreatorCollaborationCrdtSequenceConflictError(BigInt(41), BigInt(42))
    );

    expect(store.works.get("work-1")?.title).toBe("비밀 프로젝트 1화");
    expect(store.works.get("work-1")?.revision ?? 1).toBe(1);
    expect(store.documentUpdateCount).toBe(0);
    expect(store.workRevisionAppendCount).toBe(0);
    expect(store.saveLockOrder.slice(0, 3)).toEqual([
      "crdt-advisory:work-1",
      "work-row:work-1",
      "crdt-sequence:work-1",
    ]);

    await expect(
      repository.saveSharedDocument("editor", "work-1", 1, BigInt(42), { title: "fenced CRDT" })
    ).resolves.toMatchObject({ revision: 2 });
  });

  it("게시 상태와 연결 작품은 소유자만 공동 문서 endpoint에서 변경한다", async () => {
    const { repository, store } = createFixture();

    await expect(
      repository.saveSharedDocument("owner", "work-1", 1, BigInt(0), {
        status: "published",
        titleId: "catalog-title",
      })
    ).resolves.toMatchObject({ workId: "work-1", revision: 2 });

    expect(store.works.get("work-1")).toMatchObject({
      status: "published",
      titleId: "catalog-title",
      revision: 2,
    });
    expect(store.documentUpdateCount).toBe(1);
    expect(store.workRevisionAppendCount).toBe(1);
  });

  it("stale revision은 현재 번호만 반환하고 같은 transaction의 snapshot 이력을 보존한다", async () => {
    const { repository, store } = createFixture();
    store.works.get("work-1")!.revision = 20;
    for (let revision = 1; revision <= 20; revision += 1) {
      store.workRevisions.push({
        workId: "work-1",
        revision,
        snapshot: { title: `r${revision}` },
        createdAt: BASE_DATE,
      });
    }

    await expect(
      repository.saveSharedDocument("admin", "work-1", 19, BigInt(0), { title: "stale" })
    ).rejects.toEqual(new CreatorCollaborationRevisionConflictError(20));
    expect(store.works.get("work-1")?.title).toBe("비밀 프로젝트 1화");
    expect(store.workRevisions).toHaveLength(20);
    expect(store.documentUpdateCount).toBe(0);
    expect(store.workRevisionAppendCount).toBe(0);

    await repository.saveSharedDocument("admin", "work-1", 20, BigInt(0), { title: "r21" });
    expect(store.workRevisions).toHaveLength(20);
    expect(store.workRevisions.map(({ revision }) => revision)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    );
    expect(store.workRevisions.at(-1)).toMatchObject({ revision: 21, snapshot: { title: "r21" } });
  });

  it("revision snapshot 저장 실패는 문서 본문·revision·updatedAt까지 원자적으로 롤백한다", async () => {
    const { repository, store } = createFixture();
    const before = { ...store.works.get("work-1")! };
    store.failNextWorkRevision = true;

    await expect(
      repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), {
        title: "롤백되어야 하는 제목",
        doc: { pagesList: [{ id: "rollback" }] },
      })
    ).rejects.toThrow("work revision insert failed");

    expect(store.works.get("work-1")).toEqual(before);
    expect(store.workRevisions).toEqual([]);
    expect(store.documentUpdateCount).toBe(1);
    expect(store.workRevisionAppendCount).toBe(1);
  });

  it("비활성 소유자의 공유 접근·저장을 차단하되 소유자 본인의 접근은 유지한다", async () => {
    const { repository, store } = createFixture();
    store.users.get("owner")!.status = "suspended";

    await expect(repository.listSharedWorks("editor", 20)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(repository.getSharedDocument("editor", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    await expect(repository.getSharedDocumentMeta("editor", "work-1")).rejects.toEqual(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    await expect(
      repository.saveSharedDocument("editor", "work-1", 1, BigInt(0), { title: "차단" })
    ).rejects.toEqual(new CreatorCollaborationForbiddenError("document_edit_denied"));
    expect(store.lockedUserIds).toContain("owner");
    expect(store.workRevisions).toEqual([]);
    expect(store.documentUpdateCount).toBe(0);
    expect(store.workRevisionAppendCount).toBe(0);

    await expect(repository.listSharedWorks("owner", 20)).resolves.toMatchObject({
      items: [{ workId: "work-1" }],
      nextCursor: null,
    });
    await expect(repository.getSharedDocument("owner", "work-1")).resolves.toMatchObject({
      role: "owner",
    });
    await expect(repository.getSharedDocumentMeta("owner", "work-1")).resolves.toMatchObject({
      role: "owner",
      capabilities: { view: true, edit: true },
    });
    await expect(
      repository.saveSharedDocument("owner", "work-1", 1, BigInt(0), { title: "소유자 수정" })
    ).resolves.toMatchObject({ revision: 2 });
  });

  it("없는 작품·멤버·초대는 권한 상승 없이 typed not-found로 끝난다", async () => {
    const { repository } = createFixture();

    await expect(repository.getTeam("owner", "missing")).rejects.toEqual(
      new CreatorCollaborationNotFoundError("work_not_found")
    );
    await expect(repository.getActivity("owner", "missing", 20)).rejects.toEqual(
      new CreatorCollaborationNotFoundError("work_not_found")
    );
    await expect(repository.getSharedDocumentMeta("owner", "missing")).rejects.toEqual(
      new CreatorCollaborationNotFoundError("work_not_found")
    );
    await expect(repository.removeMember("owner", "work-1", "missing")).rejects.toEqual(
      new CreatorCollaborationNotFoundError("member_not_found")
    );
    await expect(
      repository.respondToInvitation(
        "unknown",
        "work-1",
        "accept",
        "00000000-0000-4000-8000-000000000777"
      )
    ).rejects.toEqual(new CreatorCollaborationNotFoundError("invitation_not_found"));
  });
});
