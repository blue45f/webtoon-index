import { randomUUID } from "node:crypto";

import {
  assertStudioLinked3dPassAssetRows,
  extractStudioLinked3dPassAssetRequirements,
} from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import { assertCreatorDraftCollaborationStatusMutationAllowed } from "../../server/creator-provisional-work-status";
import {
  CREATOR_WORK_REVISION_MAX,
  createCreatorWorkRevisionSnapshot,
  creatorWorkRevisionRetentionCutoff,
} from "../../server/creator-work-revisions";

import { createDefaultCreatorCollaborationPersistence } from "./creator-collaboration.drizzle-persistence";
import {
  canManageCreatorCollaborationMember,
  normalizeCreatorCollaborationRole,
  normalizeCreatorCollaborationStatus,
  resolveCreatorCollaborationAccess,
} from "./creator-collaboration.policy";

import type {
  AppendCreatorCollaborationEventInput,
  CreatorCollaborationEventAction,
  CreatorCollaborationEventRecord,
  CreatorCollaborationEventState,
  CreatorCollaborationInvitationAction,
  CreatorCollaborationInvitationRecord,
  CreatorCollaborationMembershipRecord,
  CreatorCollaborationMembershipWithUserRecord,
  CreatorCollaborationPersistence,
  CreatorCollaborationUnitOfWork,
  CreatorCollaborationUserRecord,
  CreatorCollaborationWorkRecord,
  CreatorSharedDocumentMetaRecord,
  CreatorSharedDocumentPatch,
  CreatorSharedDocumentRecord,
  CreatorSharedWorkRecord,
  CreatorSharedWorksCursorKey,
  UpdateCreatorCollaborationMembershipInput,
} from "./creator-collaboration.persistence-contract";
import type {
  CreatorCollaborationAccess,
  CreatorCollaborationRole,
  CreatorCollaborationStatus,
  CreatorCollaborationViewerRole,
} from "./creator-collaboration.policy";
import type { CreatorWorkRevisionSnapshot } from "../../server/creator-work-revisions";

export {
  buildCreatorCollaborationWorkQuery,
  buildCreatorCrdtServerSequenceQuery,
  buildCreatorSharedDocumentMetaQuery,
  buildCreatorSharedDocumentUpdateQuery,
  buildCreatorSharedWorksListQuery,
} from "./creator-collaboration.drizzle-persistence";
export type {
  CreatorCollaborationPersistence,
  CreatorCollaborationUnitOfWork,
  CreatorSharedDocumentPatch,
  CreatorSharedWorksCursorKey,
} from "./creator-collaboration.persistence-contract";

export const CREATOR_COLLABORATION_MAX_MEMBERS = 100;
export const CREATOR_COLLABORATION_REINVITE_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const CREATOR_SHARED_WORKS_CURSOR_VERSION = 1;
const CREATOR_SHARED_WORKS_CURSOR_MAX_LENGTH = 512;
const CREATOR_SHARED_WORKS_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface CreatorCollaborationRepositoryOptions {
  now?: () => Date;
  createInvitationId?: () => string;
  createEventId?: () => string;
}

export interface CreatorCollaborationTeamMember {
  userId: string;
  name: string;
  role: CreatorCollaborationViewerRole;
  status: CreatorCollaborationStatus;
  isOwner: boolean;
  invitationId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatorCollaborationTeamSnapshot {
  workId: string;
  viewer: {
    userId: string;
    role: CreatorCollaborationViewerRole;
    status: CreatorCollaborationStatus;
    capabilities: CreatorCollaborationAccess;
    invitationId?: string;
  };
  members: CreatorCollaborationTeamMember[];
  /**
   * Only active save-before-collaboration rooms carry a finite authorization lease. Ordinary
   * saved works and promoted rooms omit it and continue through the established ACL path.
   */
  authorizationExpiresAt?: string;
}

/**
 * Constant-cardinality authorization projection for Studio live hot paths.
 *
 * Unlike a team snapshot, this never loads the owner profile or materializes the
 * collaborator list. The repository still serializes it through the work-row
 * lock so a completed role change/removal is visible before authorization.
 */
export interface CreatorCollaborationAuthorizationSnapshot
  extends Pick<CreatorCollaborationTeamSnapshot, "workId" | "viewer"> {
  /**
   * Transactionally fenced ACL observation time. Realtime tickets preserve
   * this epoch so a later member-removal event closes only credentials issued
   * from this or an older ACL snapshot.
   */
  authorizationEpoch: string;
  authorizationExpiresAt?: string;
}

export interface CreatorCollaborationMemberRemovalResult {
  readonly snapshot: CreatorCollaborationTeamSnapshot;
  readonly authorizationEpochMs: number;
}

export interface CreatorCollaborationInvitation {
  workId: string;
  workTitle: string;
  owner: {
    name: string;
  };
  role: CreatorCollaborationRole;
  invitationId: string;
  invitedAt: string;
}

export interface CreatorCollaborationInvitationResponse {
  workId: string;
  role: CreatorCollaborationRole;
  status: "active" | "declined";
}

export interface CreatorCollaborationActivity {
  id: string;
  action: CreatorCollaborationEventAction;
  actor: {
    userId: string | null;
    name: string;
  };
  target: {
    userId: string | null;
    name: string;
  };
  before: CreatorCollaborationEventState | null;
  after: CreatorCollaborationEventState | null;
  createdAt: string;
}

export interface CreatorSharedWork {
  workId: string;
  title: string;
  format: "cuttoon" | "upload";
  role: CreatorCollaborationViewerRole;
  status: "active";
  capabilities: Pick<CreatorCollaborationAccess, "view" | "comment" | "edit" | "manageMembers">;
  owner: { name: string };
  updatedAt: string;
}

export interface CreatorSharedWorksPage {
  items: CreatorSharedWork[];
  nextCursor: string | null;
}

export interface CreatorSharedDocument {
  workId: string;
  role: CreatorCollaborationViewerRole;
  status: "active";
  capabilities: { view: true; edit: boolean };
  revision: number;
  crdtServerSequence: string;
  updatedAt: string;
  document: CreatorWorkRevisionSnapshot;
}

export type CreatorSharedDocumentMeta = Omit<CreatorSharedDocument, "document">;

export interface CreatorSharedDocumentSaveResponse {
  workId: string;
  revision: number;
  updatedAt: string;
}

export type CreatorCollaborationNotFoundCode =
  | "work_not_found"
  | "member_not_found"
  | "invitation_not_found";

export class CreatorCollaborationNotFoundError extends Error {
  constructor(readonly code: CreatorCollaborationNotFoundCode) {
    super(code);
    this.name = "CreatorCollaborationNotFoundError";
  }
}

export type CreatorCollaborationForbiddenCode =
  | "team_access_denied"
  | "member_management_denied"
  | "document_access_denied"
  | "document_edit_denied"
  | "document_owner_fields_denied";

export class CreatorCollaborationForbiddenError extends Error {
  constructor(readonly code: CreatorCollaborationForbiddenCode) {
    super(code);
    this.name = "CreatorCollaborationForbiddenError";
  }
}

export type CreatorCollaborationConflictCode =
  | "member_already_active"
  | "invitation_already_pending"
  | "invitation_not_pending"
  | "invitation_changed"
  | "member_limit_reached"
  | "reinvite_cooldown";

export class CreatorCollaborationConflictError extends Error {
  constructor(readonly code: CreatorCollaborationConflictCode) {
    super(code);
    this.name = "CreatorCollaborationConflictError";
  }
}

export type CreatorCollaborationInvalidTargetCode =
  | "invalid_role"
  | "invalid_action"
  | "invalid_cursor"
  | "owner_or_self_target"
  | "target_user_unavailable";

export class CreatorCollaborationInvalidTargetError extends Error {
  constructor(readonly code: CreatorCollaborationInvalidTargetCode) {
    super(code);
    this.name = "CreatorCollaborationInvalidTargetError";
  }
}

export class CreatorCollaborationRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("creator_work_revision_conflict");
    this.name = "CreatorCollaborationRevisionConflictError";
  }
}

export class CreatorCollaborationCrdtSequenceConflictError extends Error {
  constructor(
    readonly requestedServerSequence: bigint,
    readonly currentServerSequence: bigint
  ) {
    super("creator_crdt_sequence_conflict");
    this.name = "CreatorCollaborationCrdtSequenceConflictError";
  }
}

interface CreatorCollaborationContext {
  work: CreatorCollaborationWorkRecord;
  membership: CreatorCollaborationMembershipRecord | null;
  access: CreatorCollaborationAccess;
  authorizationExpiresAt?: string;
}

function optionalIsoString(value: Date | null): string | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

function ownerMember(
  work: CreatorCollaborationWorkRecord,
  owner: CreatorCollaborationUserRecord | null
): CreatorCollaborationTeamMember {
  const member: CreatorCollaborationTeamMember = {
    userId: work.ownerUserId,
    name: owner?.name?.trim() || work.ownerUserId,
    role: "owner",
    status: "active",
    isOwner: true,
  };
  const createdAt = optionalIsoString(work.createdAt);
  const updatedAt = optionalIsoString(work.updatedAt);
  if (createdAt) member.createdAt = createdAt;
  if (updatedAt) member.updatedAt = updatedAt;
  return member;
}

function collaborationMember(
  membership: CreatorCollaborationMembershipWithUserRecord,
  viewerUserId: string
): CreatorCollaborationTeamMember | null {
  const role = normalizeCreatorCollaborationRole(membership.role);
  const status = normalizeCreatorCollaborationStatus(membership.status);
  if (!role || !status) return null;

  const member: CreatorCollaborationTeamMember = {
    userId: membership.userId,
    name: membership.name?.trim() || membership.userId,
    role,
    status,
    isOwner: false,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
  if (membership.userId === viewerUserId && status === "pending") {
    member.invitationId = membership.invitationId;
  }
  return member;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEventAction(value: unknown): CreatorCollaborationEventAction | null {
  switch (value) {
    case "invite":
    case "reinvite":
    case "accept":
    case "decline":
    case "role_change":
    case "remove":
      return value;
    default:
      return null;
  }
}

function normalizeEventState(value: unknown): CreatorCollaborationEventState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, "role") ||
    !Object.hasOwn(value, "status")
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = normalizeCreatorCollaborationRole(record.role);
  const status = normalizeCreatorCollaborationStatus(record.status);
  return role && status ? { role, status } : null;
}

function membershipEventState(
  membership: Pick<CreatorCollaborationMembershipRecord, "role" | "status">
): CreatorCollaborationEventState {
  const state = normalizeEventState({ role: membership.role, status: membership.status });
  if (!state) throw new Error("invalid creator collaboration membership state");
  return state;
}

function eventStatesMatchAction(
  action: CreatorCollaborationEventAction,
  before: CreatorCollaborationEventState | null,
  after: CreatorCollaborationEventState | null
): boolean {
  switch (action) {
    case "invite":
      return before === null && after?.status === "pending";
    case "reinvite":
      return before?.status === "declined" && after?.status === "pending";
    case "accept":
      return (
        before?.status === "pending" &&
        after?.status === "active" &&
        before.role === after.role
      );
    case "decline":
      return (
        before?.status === "pending" &&
        after?.status === "declined" &&
        before.role === after.role
      );
    case "role_change":
      return (
        before !== null &&
        after !== null &&
        (before.status === "pending" || before.status === "active") &&
        before.status === after.status &&
        before.role !== after.role
      );
    case "remove":
      return (
        before !== null &&
        (before.status === "pending" || before.status === "active") &&
        after === null
      );
  }
}

function invitationProjection(
  record: CreatorCollaborationInvitationRecord
): CreatorCollaborationInvitation | null {
  const role = normalizeCreatorCollaborationRole(record.role);
  const status = normalizeCreatorCollaborationStatus(record.status);
  if (
    !role ||
    status !== "pending" ||
    typeof record.workId !== "string" ||
    record.workId.length === 0 ||
    typeof record.workTitle !== "string" ||
    record.ownerStatus !== "active" ||
    typeof record.invitationId !== "string" ||
    !UUID_PATTERN.test(record.invitationId) ||
    !(record.updatedAt instanceof Date) ||
    !Number.isFinite(record.updatedAt.getTime())
  ) {
    return null;
  }
  return {
    workId: record.workId,
    workTitle: record.workTitle,
    owner: {
      name: record.ownerName?.trim() || "작품 소유자",
    },
    role,
    invitationId: record.invitationId,
    invitedAt: record.updatedAt.toISOString(),
  };
}

const UNKNOWN_ACTIVITY_USER_NAME = "알 수 없는 사용자";
const DELETED_ACTIVITY_USER_NAME = "탈퇴한 사용자";

function activityUserProjection(
  userId: unknown,
  name: unknown,
  status: unknown
): CreatorCollaborationActivity["actor"] | null {
  if (userId !== null && (typeof userId !== "string" || userId.length === 0)) return null;
  if (status === null || userId === null) {
    return { userId: null, name: UNKNOWN_ACTIVITY_USER_NAME };
  }
  if (status === "deleted") {
    return { userId: null, name: DELETED_ACTIVITY_USER_NAME };
  }
  if (status !== "active" && status !== "suspended") return null;
  const currentName = typeof name === "string" ? name.trim() : "";
  return { userId, name: currentName || UNKNOWN_ACTIVITY_USER_NAME };
}

function activityProjection(
  record: CreatorCollaborationEventRecord
): CreatorCollaborationActivity | null {
  const action = normalizeEventAction(record.action);
  const before = record.beforeState === null ? null : normalizeEventState(record.beforeState);
  const after = record.afterState === null ? null : normalizeEventState(record.afterState);
  const actor = activityUserProjection(
    record.actorUserId,
    record.actorName,
    record.actorStatus
  );
  const target = activityUserProjection(
    record.targetUserId,
    record.targetName,
    record.targetStatus
  );
  if (
    !action ||
    (record.beforeState !== null && !before) ||
    (record.afterState !== null && !after) ||
    !eventStatesMatchAction(action, before, after) ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    !actor ||
    !target ||
    !(record.createdAt instanceof Date) ||
    !Number.isFinite(record.createdAt.getTime())
  ) {
    return null;
  }
  return {
    id: record.id,
    action,
    actor,
    target,
    before,
    after,
    createdAt: record.createdAt.toISOString(),
  };
}

interface CreatorSharedWorksCursorPayload {
  v: typeof CREATOR_SHARED_WORKS_CURSOR_VERSION;
  sortAt: string;
  workId: string;
}

function creatorSharedWorkSortDate(
  record: Pick<CreatorSharedWorkRecord, "createdAt" | "updatedAt">
): Date {
  if (record.updatedAt instanceof Date && Number.isFinite(record.updatedAt.getTime())) {
    return record.updatedAt;
  }
  if (record.createdAt instanceof Date && Number.isFinite(record.createdAt.getTime())) {
    return record.createdAt;
  }
  return new Date(0);
}

export function encodeCreatorSharedWorksCursor(key: CreatorSharedWorksCursorKey): string {
  const payload: CreatorSharedWorksCursorPayload = {
    v: CREATOR_SHARED_WORKS_CURSOR_VERSION,
    sortAt: key.sortAt.toISOString(),
    workId: key.workId,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCreatorSharedWorksCursor(
  cursor: string
): CreatorSharedWorksCursorKey | null {
  if (
    cursor.length === 0 ||
    cursor.length > CREATOR_SHARED_WORKS_CURSOR_MAX_LENGTH ||
    !CREATOR_SHARED_WORKS_CURSOR_PATTERN.test(cursor)
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, "base64url");
    // Buffer's decoder is intentionally lenient; a canonical round trip rejects aliases/truncation.
    if (decoded.length === 0 || decoded.toString("base64url") !== cursor) return null;
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 3 ||
      record.v !== CREATOR_SHARED_WORKS_CURSOR_VERSION ||
      typeof record.sortAt !== "string" ||
      typeof record.workId !== "string" ||
      record.workId.length === 0 ||
      record.workId.length > 160 ||
      record.workId.trim().length === 0
    ) {
      return null;
    }
    const sortAt = new Date(record.sortAt);
    if (!Number.isFinite(sortAt.getTime()) || sortAt.toISOString() !== record.sortAt) return null;
    const key = { sortAt, workId: record.workId };
    return encodeCreatorSharedWorksCursor(key) === cursor ? key : null;
  } catch {
    return null;
  }
}

function boundedCollaborationListLimit(value: number): number {
  return Number.isInteger(value) && value >= 1 ? Math.min(value, 50) : 20;
}

function sharedRecordAccess(
  record: Pick<
    CreatorSharedWorkRecord,
    "ownerUserId" | "ownerStatus" | "membershipRole" | "membershipStatus"
  >,
  actorUserId: string
): { role: CreatorCollaborationViewerRole; access: CreatorCollaborationAccess } | null {
  if (record.ownerUserId === actorUserId) {
    return {
      role: "owner",
      access: resolveCreatorCollaborationAccess({
        actorUserId,
        ownerUserId: record.ownerUserId,
      }),
    };
  }
  const role = normalizeCreatorCollaborationRole(record.membershipRole);
  const status = normalizeCreatorCollaborationStatus(record.membershipStatus);
  if (record.ownerStatus !== "active" || !role || status !== "active") return null;
  const access = resolveCreatorCollaborationAccess({
    actorUserId,
    ownerUserId: record.ownerUserId,
    membership: { userId: actorUserId, role, status },
  });
  return access.view ? { role, access } : null;
}

function requiredIsoString(value: Date | null): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function creatorWorkIsoTimestamp(record: Pick<CreatorSharedWorkRecord, "createdAt" | "updatedAt">): string {
  return creatorSharedWorkSortDate(record).toISOString();
}

function sharedWorkProjection(
  record: CreatorSharedWorkRecord,
  actorUserId: string
): CreatorSharedWork | null {
  const context = sharedRecordAccess(record, actorUserId);
  const updatedAt = creatorWorkIsoTimestamp(record);
  if (
    !context ||
    typeof record.workId !== "string" ||
    record.workId.length === 0 ||
    typeof record.title !== "string" ||
    (record.format !== "cuttoon" && record.format !== "upload")
  ) {
    return null;
  }
  return {
    workId: record.workId,
    title: record.title,
    format: record.format,
    role: context.role,
    status: "active",
    capabilities: {
      view: context.access.view,
      comment: context.access.comment,
      edit: context.access.edit,
      manageMembers: context.access.manageMembers,
    },
    owner: { name: record.ownerName?.trim() || "작품 소유자" },
    updatedAt,
  };
}

function sharedDocumentProjection(
  record: CreatorSharedDocumentRecord,
  actorUserId: string,
  crdtServerSequence: bigint
): CreatorSharedDocument | null {
  const context = sharedRecordAccess(record, actorUserId);
  const updatedAt = creatorWorkIsoTimestamp(record);
  if (
    !context ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    record.revision > CREATOR_WORK_REVISION_MAX
  ) {
    return null;
  }
  return {
    workId: record.workId,
    role: context.role,
    status: "active",
    capabilities: { view: true, edit: context.access.edit },
    revision: record.revision,
    crdtServerSequence: crdtServerSequence.toString(),
    updatedAt,
    document: createCreatorWorkRevisionSnapshot(record),
  };
}

function sharedDocumentMetaProjection(
  record: CreatorSharedDocumentMetaRecord,
  actorUserId: string,
  crdtServerSequence: bigint
): CreatorSharedDocumentMeta | null {
  const context = sharedRecordAccess(record, actorUserId);
  if (
    !context ||
    typeof record.workId !== "string" ||
    record.workId.length === 0 ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    record.revision > CREATOR_WORK_REVISION_MAX
  ) {
    return null;
  }
  return {
    workId: record.workId,
    role: context.role,
    status: "active",
    capabilities: { view: true, edit: context.access.edit },
    revision: record.revision,
    crdtServerSequence: crdtServerSequence.toString(),
    updatedAt: creatorWorkIsoTimestamp(record),
  };
}

export class CreatorCollaborationRepository {
  private readonly now: () => Date;
  private readonly createInvitationId: () => string;
  private readonly createEventId: () => string;

  constructor(
    private readonly persistence: CreatorCollaborationPersistence =
      createDefaultCreatorCollaborationPersistence(),
    options: CreatorCollaborationRepositoryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createInvitationId = options.createInvitationId ?? randomUUID;
    this.createEventId = options.createEventId ?? randomUUID;
  }

  async listSharedWorks(
    actorUserId: string,
    limit: number,
    cursor?: string
  ): Promise<CreatorSharedWorksPage> {
    const decodedCursor = cursor === undefined ? null : decodeCreatorSharedWorksCursor(cursor);
    if (cursor !== undefined && decodedCursor === null) {
      throw new CreatorCollaborationInvalidTargetError("invalid_cursor");
    }
    const pageLimit = boundedCollaborationListLimit(limit);
    return this.persistence.read(async (unit) => {
      const records = await unit.listAccessibleWorks(
        actorUserId,
        pageLimit + 1,
        decodedCursor
      );
      const pageRecords = records.slice(0, pageLimit);
      const items: CreatorSharedWork[] = [];
      for (const record of pageRecords) {
        const item = sharedWorkProjection(record, actorUserId);
        if (!item) throw new Error("invalid creator shared work record");
        items.push(item);
      }
      const lastRecord = pageRecords.at(-1);
      const nextCursor =
        records.length > pageLimit && lastRecord
          ? encodeCreatorSharedWorksCursor({
              sortAt: creatorSharedWorkSortDate(lastRecord),
              workId: lastRecord.workId,
            })
          : null;
      return { items, nextCursor };
    });
  }

  async getSharedDocument(
    actorUserId: string,
    workId: string
  ): Promise<CreatorSharedDocument> {
    return this.persistence.read(async (unit) => {
      const record = await unit.findAccessibleDocument(actorUserId, workId);
      if (!record) {
        const work = await unit.findWork(workId);
        if (!work) throw new CreatorCollaborationNotFoundError("work_not_found");
        throw new CreatorCollaborationForbiddenError("document_access_denied");
      }
      const crdtServerSequence = await unit.getStudioCrdtServerSequence(workId);
      const document = sharedDocumentProjection(record, actorUserId, crdtServerSequence);
      if (!document) throw new Error("invalid creator shared document record");
      return document;
    });
  }

  async getSharedDocumentMeta(
    actorUserId: string,
    workId: string
  ): Promise<CreatorSharedDocumentMeta> {
    return this.persistence.read(async (unit) => {
      const record = await unit.findAccessibleDocumentMeta(actorUserId, workId);
      if (!record) {
        const work = await unit.findWork(workId);
        if (!work) throw new CreatorCollaborationNotFoundError("work_not_found");
        throw new CreatorCollaborationForbiddenError("document_access_denied");
      }
      const crdtServerSequence = await unit.getStudioCrdtServerSequence(workId);
      const meta = sharedDocumentMetaProjection(record, actorUserId, crdtServerSequence);
      if (!meta) throw new Error("invalid creator shared document meta record");
      return meta;
    });
  }

  async saveSharedDocument(
    actorUserId: string,
    workId: string,
    baseRevision: number,
    crdtServerSequence: bigint,
    patch: CreatorSharedDocumentPatch
  ): Promise<CreatorSharedDocumentSaveResponse> {
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 1 ||
      baseRevision > CREATOR_WORK_REVISION_MAX ||
      typeof crdtServerSequence !== "bigint" ||
      crdtServerSequence < BigInt(0) ||
      crdtServerSequence > BigInt("9223372036854775807") ||
      Object.keys(patch).length === 0 ||
      Object.hasOwn(patch, "format")
    ) {
      throw new Error("invalid creator shared document mutation");
    }
    return this.persistence.transaction(async (unit) => {
      // CRDT append/compaction uses this same transaction-scoped per-work lock. It must be the
      // first lock in this transaction so no CRDT commit can slip between the client's final sync
      // fence and the REST document commit. The lock remains held through revision snapshot write.
      await unit.acquireStudioCrdtWorkAdvisoryLock(workId);
      // 모든 멤버 변경도 작품 행을 먼저 잠그므로, advisory lock 다음에 같은 행을
      // 잠그면 ACL 확인·revision 비교·저장이 역할 회수와 직렬화된다.
      const context = await this.loadContext(unit, actorUserId, workId, true);
      if (actorUserId !== context.work.ownerUserId) {
        const owner = await unit.findUser(context.work.ownerUserId, true);
        if (!owner || owner.status !== "active") {
          throw new CreatorCollaborationForbiddenError("document_edit_denied");
        }
      }
      if (!context.access.edit) {
        throw new CreatorCollaborationForbiddenError("document_edit_denied");
      }
      const currentCrdtServerSequence = await unit.getStudioCrdtServerSequence(workId);
      if (currentCrdtServerSequence !== crdtServerSequence) {
        throw new CreatorCollaborationCrdtSequenceConflictError(
          crdtServerSequence,
          currentCrdtServerSequence
        );
      }
      // 편집 역할은 원고 콘텐츠를 저장할 수 있지만 작품의 공개 상태와 카탈로그 연결은
      // 소유권 영역이다. DTO는 owner도 같은 endpoint를 쓰므로 필드를 허용하되 여기서 actor와
      // 함께 판정해 admin/editor가 작품을 게시·비공개 전환하거나 연결 작품을 바꾸지 못하게 한다.
      if (
        actorUserId !== context.work.ownerUserId &&
        (Object.hasOwn(patch, "status") || Object.hasOwn(patch, "titleId"))
      ) {
        throw new CreatorCollaborationForbiddenError("document_owner_fields_denied");
      }
      assertCreatorDraftCollaborationStatusMutationAllowed({
        hidden: context.work.hidden === true,
        draftCollaborationStatus: context.work.draftCollaborationStatus,
        requestedStatus: patch.status,
      });
      const current = await unit.findAccessibleDocument(actorUserId, workId);
      if (!current) {
        throw new CreatorCollaborationForbiddenError("document_edit_denied");
      }
      if (current.revision !== baseRevision) {
        throw new CreatorCollaborationRevisionConflictError(current.revision);
      }
      if (current.revision >= CREATOR_WORK_REVISION_MAX) {
        throw new Error("creator work revision limit reached");
      }
      const linkedPassRequirements = extractStudioLinked3dPassAssetRequirements({
        cover: Object.hasOwn(patch, "cover") ? patch.cover : current.cover,
        pages: Object.hasOwn(patch, "pages") ? patch.pages : current.pages,
        doc: Object.hasOwn(patch, "doc") ? patch.doc : current.doc,
      });
      if (linkedPassRequirements.length > 0) {
        const rows = await unit.findStudioLinked3dPassAssets(
          workId,
          linkedPassRequirements.map(({ assetId }) => assetId)
        );
        assertStudioLinked3dPassAssetRows({
          workId,
          requirements: linkedPassRequirements,
          rows,
        });
      }

      const now = this.now();
      const updated = await unit.updateAccessibleDocument(
        actorUserId,
        workId,
        baseRevision,
        patch,
        now
      );
      if (!updated) {
        const latest = await unit.findAccessibleDocument(actorUserId, workId);
        if (latest && latest.revision !== baseRevision) {
          throw new CreatorCollaborationRevisionConflictError(latest.revision);
        }
        throw new CreatorCollaborationForbiddenError("document_edit_denied");
      }

      await unit.appendWorkRevision(
        workId,
        updated.revision,
        createCreatorWorkRevisionSnapshot(updated),
        now
      );
      const cutoff = creatorWorkRevisionRetentionCutoff(updated.revision);
      if (cutoff !== null) {
        await unit.deleteWorkRevisionsThrough(workId, cutoff);
      }
      const updatedAt = requiredIsoString(updated.updatedAt);
      if (!updatedAt) throw new Error("invalid creator shared document update timestamp");
      return { workId, revision: updated.revision, updatedAt };
    });
  }

  async getTeam(actorUserId: string, workId: string): Promise<CreatorCollaborationTeamSnapshot> {
    return this.persistence.transaction(async (unit) => {
      const context = await this.loadContext(unit, actorUserId, workId, true);
      if (context.access.manageMembers) {
        const snapshot = await this.buildSnapshot(unit, actorUserId, context, "all");
        return context.authorizationExpiresAt
          ? { ...snapshot, authorizationExpiresAt: context.authorizationExpiresAt }
          : snapshot;
      }
      const membershipRole = normalizeCreatorCollaborationRole(context.membership?.role);
      const membershipStatus = normalizeCreatorCollaborationStatus(context.membership?.status);
      if (membershipRole && membershipStatus) {
        const snapshot = await this.buildSnapshot(unit, actorUserId, context, "self");
        return context.authorizationExpiresAt
          ? { ...snapshot, authorizationExpiresAt: context.authorizationExpiresAt }
          : snapshot;
      }
      throw new CreatorCollaborationForbiddenError("team_access_denied");
    });
  }

  async getAuthorization(
    actorUserId: string,
    workId: string
  ): Promise<CreatorCollaborationAuthorizationSnapshot> {
    return this.persistence.transaction(async (unit) => {
      // Keep the same first lock as every member mutation. Reading membership only after this
      // lock wait prevents an in-flight downgrade from being authorized from an older snapshot.
      const context = await this.loadContext(unit, actorUserId, workId, true);
      if (actorUserId !== context.work.ownerUserId) {
        const membershipRole = normalizeCreatorCollaborationRole(context.membership?.role);
        const membershipStatus = normalizeCreatorCollaborationStatus(context.membership?.status);
        if (!membershipRole || !membershipStatus) {
          throw new CreatorCollaborationForbiddenError("team_access_denied");
        }
      }
      const snapshot: CreatorCollaborationAuthorizationSnapshot = {
        workId: context.work.id,
        viewer: this.viewerProjection(actorUserId, context),
        authorizationEpoch: this.now().toISOString(),
      };
      if (context.authorizationExpiresAt) {
        snapshot.authorizationExpiresAt = context.authorizationExpiresAt;
      }
      return snapshot;
    });
  }

  async listInvitations(
    actorUserId: string,
    limit: number
  ): Promise<CreatorCollaborationInvitation[]> {
    return this.persistence.read(async (unit) => {
      const records = await unit.listPendingInvitations(
        actorUserId,
        boundedCollaborationListLimit(limit)
      );
      return records
        .map(invitationProjection)
        .filter(
          (invitation): invitation is CreatorCollaborationInvitation => invitation !== null
        );
    });
  }

  async getActivity(
    actorUserId: string,
    workId: string,
    limit: number
  ): Promise<CreatorCollaborationActivity[]> {
    return this.persistence.read(async (unit) => {
      const authorizedRead = await unit.listAuthorizedEvents(
        actorUserId,
        workId,
        boundedCollaborationListLimit(limit)
      );
      if (!authorizedRead) {
        const work = await unit.findWork(workId);
        if (!work) throw new CreatorCollaborationNotFoundError("work_not_found");
        throw new CreatorCollaborationForbiddenError("member_management_denied");
      }
      return authorizedRead.events
        .map(activityProjection)
        .filter((activity): activity is CreatorCollaborationActivity => activity !== null);
    });
  }

  async invite(
    actorUserId: string,
    workId: string,
    targetUserId: string,
    requestedRole: CreatorCollaborationRole
  ): Promise<CreatorCollaborationTeamSnapshot> {
    return this.persistence.transaction(async (unit) => {
      const context = await this.loadContext(unit, actorUserId, workId, true);
      this.requireManageAccess(context.access);

      const role = normalizeCreatorCollaborationRole(requestedRole);
      if (!role) throw new CreatorCollaborationInvalidTargetError("invalid_role");
      if (targetUserId === context.work.ownerUserId || targetUserId === actorUserId) {
        throw new CreatorCollaborationInvalidTargetError("owner_or_self_target");
      }

      const target = await unit.findUser(targetUserId);
      if (!target || target.status !== "active") {
        throw new CreatorCollaborationInvalidTargetError("target_user_unavailable");
      }

      const existing = await unit.findMembership(workId, targetUserId);
      const existingStatus = normalizeCreatorCollaborationStatus(existing?.status);
      const now = this.now();
      if (existingStatus === "active") {
        throw new CreatorCollaborationConflictError("member_already_active");
      }
      if (existingStatus === "pending") {
        throw new CreatorCollaborationConflictError("invitation_already_pending");
      }
      if (existingStatus === "declined") {
        const respondedAt = existing?.respondedAt;
        const elapsed = respondedAt ? now.getTime() - respondedAt.getTime() : Number.NEGATIVE_INFINITY;
        if (!Number.isFinite(elapsed) || elapsed < CREATOR_COLLABORATION_REINVITE_COOLDOWN_MS) {
          throw new CreatorCollaborationConflictError("reinvite_cooldown");
        }
      }
      if (
        (!existing || existingStatus === "declined") &&
        (await unit.countNonDeclinedMemberships(workId)) >= CREATOR_COLLABORATION_MAX_MEMBERS
      ) {
        throw new CreatorCollaborationConflictError("member_limit_reached");
      }

      const invitationId = this.createInvitationId();
      const beforeState = existing ? membershipEventState(existing) : null;
      if (existing) {
        const updated = await unit.updateMembership(workId, targetUserId, {
          role,
          status: "pending",
          invitationId,
          invitedBy: actorUserId,
          updatedAt: now,
          respondedAt: null,
        });
        if (!updated) throw new CreatorCollaborationNotFoundError("member_not_found");
      } else {
        await unit.createMembership({
          workId,
          userId: targetUserId,
          role,
          invitedBy: actorUserId,
          invitationId,
          now,
        });
      }
      await this.appendAuditEvent(unit, {
        workId,
        actorUserId,
        targetUserId,
        action: existing ? "reinvite" : "invite",
        beforeState,
        afterState: { role, status: "pending" },
        createdAt: now,
      });

      return this.buildMutationSnapshot(unit, actorUserId, context.work);
    });
  }

  async updateMemberRole(
    actorUserId: string,
    workId: string,
    targetUserId: string,
    requestedRole: CreatorCollaborationRole
  ): Promise<CreatorCollaborationTeamSnapshot> {
    return this.persistence.transaction(async (unit) => {
      const context = await this.loadContext(unit, actorUserId, workId, true);
      this.requireManageMember(context, actorUserId, targetUserId);
      const role = normalizeCreatorCollaborationRole(requestedRole);
      if (!role) throw new CreatorCollaborationInvalidTargetError("invalid_role");

      const targetMembership = await unit.findMembership(workId, targetUserId);
      const targetStatus = normalizeCreatorCollaborationStatus(targetMembership?.status);
      if (!targetMembership || targetStatus === "declined") {
        throw new CreatorCollaborationNotFoundError("member_not_found");
      }
      if (!targetStatus) throw new Error("invalid creator collaboration membership status");
      const beforeState = membershipEventState(targetMembership);
      if (beforeState.role === role) {
        return this.buildMutationSnapshot(unit, actorUserId, context.work);
      }
      const now = this.now();
      const update: UpdateCreatorCollaborationMembershipInput = {
        role,
        updatedAt: now,
      };
      if (targetStatus === "pending") {
        update.invitationId = this.createInvitationId();
      }
      const updated = await unit.updateMembership(workId, targetUserId, update);
      if (!updated) throw new CreatorCollaborationNotFoundError("member_not_found");
      await this.appendAuditEvent(unit, {
        workId,
        actorUserId,
        targetUserId,
        action: "role_change",
        beforeState,
        afterState: { role, status: targetStatus },
        createdAt: now,
      });

      return this.buildMutationSnapshot(unit, actorUserId, context.work);
    });
  }

  async removeMember(
    actorUserId: string,
    workId: string,
    targetUserId: string
  ): Promise<CreatorCollaborationTeamSnapshot> {
    return (
      await this.removeMemberWithRevocation(
        actorUserId,
        workId,
        targetUserId,
      )
    ).snapshot;
  }

  async removeMemberWithRevocation(
    actorUserId: string,
    workId: string,
    targetUserId: string,
  ): Promise<CreatorCollaborationMemberRemovalResult> {
    return this.persistence.transaction(async (unit) => {
      const context = await this.loadContext(unit, actorUserId, workId, true);
      this.requireManageMember(context, actorUserId, targetUserId);
      const targetMembership = await unit.findMembership(workId, targetUserId);
      if (!targetMembership) {
        // A synchronous edge-control delivery may fail after this transaction
        // committed. Preserve idempotency by replaying the durable removal
        // audit epoch instead of turning the retry into member_not_found.
        // The work-row lock serializes this branch against a re-invite, so an
        // old removal epoch cannot revoke a later authorization grant.
        const previousRemoval = await unit.findLatestRemovalEvent(
          workId,
          targetUserId,
        );
        if (previousRemoval !== null) {
          return {
            snapshot: await this.buildMutationSnapshot(
              unit,
              actorUserId,
              context.work,
            ),
            authorizationEpochMs: previousRemoval.createdAt.getTime(),
          };
        }
        throw new CreatorCollaborationNotFoundError("member_not_found");
      }
      if (normalizeCreatorCollaborationStatus(targetMembership.status) === "declined") {
        throw new CreatorCollaborationNotFoundError("member_not_found");
      }
      const beforeState = membershipEventState(targetMembership);
      if (beforeState.status !== "pending" && beforeState.status !== "active") {
        throw new CreatorCollaborationNotFoundError("member_not_found");
      }
      if (!(await unit.deleteMembership(workId, targetUserId))) {
        throw new CreatorCollaborationNotFoundError("member_not_found");
      }
      const now = this.now();
      await this.appendAuditEvent(unit, {
        workId,
        actorUserId,
        targetUserId,
        action: "remove",
        beforeState,
        afterState: null,
        createdAt: now,
      });

      return {
        snapshot: await this.buildMutationSnapshot(
          unit,
          actorUserId,
          context.work,
        ),
        authorizationEpochMs: now.getTime(),
      };
    });
  }

  async respondToInvitation(
    actorUserId: string,
    workId: string,
    requestedAction: CreatorCollaborationInvitationAction,
    invitationId: string
  ): Promise<CreatorCollaborationInvitationResponse> {
    return this.persistence.transaction(async (unit) => {
      const context = await this.loadContext(unit, actorUserId, workId, true);
      // 작품 행과 소유자 행을 같은 transaction에서 잠근다. 소유자 status UPDATE는 이 응답이
      // 끝날 때까지 대기하므로 active 검증과 멤버십 변경 사이의 정지/탈퇴 race를 닫는다.
      const owner = await unit.findUser(context.work.ownerUserId, true);
      if (!owner || owner.status !== "active") {
        throw new CreatorCollaborationConflictError("invitation_not_pending");
      }
      if (!context.membership) {
        throw new CreatorCollaborationNotFoundError("invitation_not_found");
      }
      if (requestedAction !== "accept" && requestedAction !== "decline") {
        throw new CreatorCollaborationInvalidTargetError("invalid_action");
      }
      if (context.membership.invitationId !== invitationId) {
        throw new CreatorCollaborationConflictError("invitation_changed");
      }
      if (!context.access.respondInvite) {
        throw new CreatorCollaborationConflictError("invitation_not_pending");
      }

      const now = this.now();
      const beforeState = membershipEventState(context.membership);
      const afterStatus = requestedAction === "accept" ? "active" : "declined";
      const updated = await unit.updateMembership(workId, actorUserId, {
        status: afterStatus,
        updatedAt: now,
        respondedAt: now,
      }, invitationId);
      if (!updated) throw new CreatorCollaborationConflictError("invitation_changed");
      await this.appendAuditEvent(unit, {
        workId,
        actorUserId,
        targetUserId: actorUserId,
        action: requestedAction,
        beforeState,
        afterState: { role: beforeState.role, status: afterStatus },
        createdAt: now,
      });

      return { workId, role: beforeState.role, status: afterStatus };
    });
  }

  private async appendAuditEvent(
    unit: CreatorCollaborationUnitOfWork,
    input: Omit<AppendCreatorCollaborationEventInput, "id"> & {
      actorUserId: string;
    }
  ): Promise<void> {
    const before = input.beforeState === null ? null : normalizeEventState(input.beforeState);
    const after = input.afterState === null ? null : normalizeEventState(input.afterState);
    if (
      (input.beforeState !== null && !before) ||
      (input.afterState !== null && !after) ||
      !eventStatesMatchAction(input.action, before, after)
    ) {
      throw new Error("invalid creator collaboration event transition");
    }
    await unit.appendEvent({
      ...input,
      id: this.createEventId(),
    });
  }

  private async loadContext(
    unit: CreatorCollaborationUnitOfWork,
    actorUserId: string,
    workId: string,
    lock = false
  ): Promise<CreatorCollaborationContext> {
    const work = await unit.findWork(workId, lock);
    if (!work) throw new CreatorCollaborationNotFoundError("work_not_found");
    const authorizationExpiresAt = this.activeDraftAuthorizationExpiresAt(work);
    const membership =
      actorUserId === work.ownerUserId ? null : await unit.findMembership(workId, actorUserId);
    return {
      work,
      membership,
      access: resolveCreatorCollaborationAccess({
        actorUserId,
        ownerUserId: work.ownerUserId,
        membership,
      }),
      ...(authorizationExpiresAt ? { authorizationExpiresAt } : {}),
    };
  }

  /**
   * Validate the provisional room in the same locked work read used by live ACL admission.
   * A missing marker (ordinary saved work) and a promoted marker both use the normal durable ACL.
   * Unknown/corrupt marker states and active leases at or before `now` fail closed.
   */
  private activeDraftAuthorizationExpiresAt(
    work: CreatorCollaborationWorkRecord
  ): string | undefined {
    const status = work.draftCollaborationStatus;
    if (status === undefined || status === null) return undefined;
    if (work.draftCollaborationOwnerUserId !== work.ownerUserId) {
      throw new CreatorCollaborationForbiddenError("team_access_denied");
    }
    if (status === "promoted") return undefined;
    const expiresAt = work.draftCollaborationExpiresAt;
    if (
      status !== "active" ||
      work.status !== "draft" ||
      work.hidden !== true ||
      !(expiresAt instanceof Date) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new CreatorCollaborationForbiddenError("team_access_denied");
    }
    return expiresAt.toISOString();
  }

  private requireManageAccess(access: CreatorCollaborationAccess): void {
    if (!access.manageMembers) {
      throw new CreatorCollaborationForbiddenError("member_management_denied");
    }
  }

  private requireManageMember(
    context: CreatorCollaborationContext,
    actorUserId: string,
    targetUserId: string
  ): void {
    if (
      !canManageCreatorCollaborationMember(
        context.access,
        actorUserId,
        targetUserId,
        context.work.ownerUserId
      )
    ) {
      throw new CreatorCollaborationForbiddenError("member_management_denied");
    }
  }

  private async buildMutationSnapshot(
    unit: CreatorCollaborationUnitOfWork,
    actorUserId: string,
    work: CreatorCollaborationWorkRecord
  ): Promise<CreatorCollaborationTeamSnapshot> {
    const membership =
      actorUserId === work.ownerUserId ? null : await unit.findMembership(work.id, actorUserId);
    const context: CreatorCollaborationContext = {
      work,
      membership,
      access: resolveCreatorCollaborationAccess({
        actorUserId,
        ownerUserId: work.ownerUserId,
        membership,
      }),
    };
    return this.buildSnapshot(
      unit,
      actorUserId,
      context,
      context.access.manageMembers ? "all" : "self"
    );
  }

  private async buildSnapshot(
    unit: CreatorCollaborationUnitOfWork,
    actorUserId: string,
    context: CreatorCollaborationContext,
    scope: "all" | "self"
  ): Promise<CreatorCollaborationTeamSnapshot> {
    const owner = await unit.findUser(context.work.ownerUserId);
    let memberships: CreatorCollaborationMembershipWithUserRecord[];
    if (scope === "all") {
      memberships = await unit.listMemberships(context.work.id);
    } else if (context.membership) {
      const memberUser = await unit.findUser(context.membership.userId);
      memberships = [
        {
          ...context.membership,
          name: memberUser?.name ?? null,
        },
      ];
    } else {
      memberships = [];
    }
    const normalizedMembers = memberships
      .filter(
        (membership) =>
          membership.userId !== context.work.ownerUserId &&
          (scope === "self" || normalizeCreatorCollaborationStatus(membership.status) !== "declined")
      )
      .map((membership) => collaborationMember(membership, actorUserId))
      .filter((member): member is CreatorCollaborationTeamMember => member !== null);
    return {
      workId: context.work.id,
      viewer: this.viewerProjection(actorUserId, context),
      members: [ownerMember(context.work, owner), ...normalizedMembers],
    };
  }

  private viewerProjection(
    actorUserId: string,
    context: CreatorCollaborationContext
  ): CreatorCollaborationTeamSnapshot["viewer"] {
    const role =
      actorUserId === context.work.ownerUserId
        ? "owner"
        : (normalizeCreatorCollaborationRole(context.membership?.role) ?? "viewer");
    const status =
      actorUserId === context.work.ownerUserId
        ? "active"
        : (normalizeCreatorCollaborationStatus(context.membership?.status) ?? "declined");
    const viewer: CreatorCollaborationTeamSnapshot["viewer"] = {
      userId: actorUserId,
      role,
      status,
      capabilities: context.access,
    };
    if (status === "pending" && context.membership?.userId === actorUserId) {
      viewer.invitationId = context.membership.invitationId;
    }
    return viewer;
  }
}

export const creatorCollaborationRepositoryProvider = {
  provide: CreatorCollaborationRepository,
  useFactory: () => new CreatorCollaborationRepository(),
};
