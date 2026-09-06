import type {
  CreatorCollaborationRole,
  CreatorCollaborationStatus,
} from "./creator-collaboration.policy";
import type { StudioLinked3dPassAssetRow } from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import type { CreatorWorkRevisionSnapshot } from "../../server/creator-work-revisions";

export type CreatorCollaborationInvitationAction = "accept" | "decline";

export type CreatorCollaborationEventAction =
  | "invite"
  | "reinvite"
  | "accept"
  | "decline"
  | "role_change"
  | "remove";

export interface CreatorCollaborationEventState {
  role: CreatorCollaborationRole;
  status: CreatorCollaborationStatus;
}

export interface CreatorSharedWorksCursorKey {
  sortAt: Date;
  workId: string;
}

export interface CreatorCollaborationWorkRecord {
  id: string;
  ownerUserId: string;
  title: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  status?: string;
  hidden?: boolean;
  /**
   * Present only when the work is backed by the lazy save-before-collaboration marker.
   * Older/in-memory persistence adapters may omit both fields and are treated as ordinary saved
   * works; the production Drizzle adapter always projects explicit nulls for that case.
   */
  draftCollaborationStatus?: string | null;
  draftCollaborationExpiresAt?: Date | null;
  draftCollaborationOwnerUserId?: string | null;
}

export interface CreatorSharedWorkRecord {
  workId: string;
  ownerUserId: string;
  ownerName: string | null;
  ownerStatus: string;
  title: string;
  format: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  membershipRole: string | null;
  membershipStatus: string | null;
}

export interface CreatorSharedDocumentRecord extends CreatorSharedWorkRecord {
  revision: number;
  titleId: string | null;
  description: string;
  cover: string;
  tags: unknown;
  format: string;
  pages: unknown;
  doc: unknown;
  status: string;
  seriesId: string | null;
  episodeNo: number | null;
  challengeId: string | null;
  remixFromId: string | null;
}

export interface CreatorSharedDocumentMetaRecord {
  workId: string;
  ownerUserId: string;
  ownerStatus: string;
  revision: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  membershipRole: string | null;
  membershipStatus: string | null;
}

export type CreatorSharedDocumentMutationRecord = Omit<
  CreatorSharedDocumentRecord,
  "ownerName" | "ownerStatus" | "membershipRole" | "membershipStatus"
>;

export interface CreatorSharedDocumentPatch {
  title?: string;
  description?: string;
  cover?: string;
  tags?: string[];
  titleId?: string | null;
  pages?: string[];
  doc?: Record<string, unknown>;
  status?: "draft" | "published";
}

export interface CreatorCollaborationUserRecord {
  userId: string;
  name: string | null;
  status: string;
}

export interface CreatorCollaborationMembershipRecord {
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

export interface CreatorCollaborationMembershipWithUserRecord
  extends CreatorCollaborationMembershipRecord {
  name: string | null;
}

export interface CreatorCollaborationInvitationRecord {
  workId: string;
  workTitle: string;
  ownerName: string | null;
  ownerStatus: string;
  role: string;
  status: string;
  invitationId: string;
  updatedAt: Date;
}

export interface CreatorCollaborationEventRecord {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  actorStatus: string | null;
  targetUserId: string | null;
  targetName: string | null;
  targetStatus: string | null;
  beforeState: unknown;
  afterState: unknown;
  createdAt: Date;
}

export interface CreatorCollaborationRemovalRecord {
  workId: string;
  targetUserId: string;
  createdAt: Date;
}

export interface CreatorCollaborationAuthorizedEventsRecord {
  authorized: true;
  events: CreatorCollaborationEventRecord[];
}

export interface AppendCreatorCollaborationEventInput {
  id: string;
  workId: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: CreatorCollaborationEventAction;
  beforeState: CreatorCollaborationEventState | null;
  afterState: CreatorCollaborationEventState | null;
  createdAt: Date;
}

export interface CreateCreatorCollaborationMembershipInput {
  workId: string;
  userId: string;
  role: CreatorCollaborationRole;
  invitedBy: string;
  invitationId: string;
  now: Date;
}

export interface UpdateCreatorCollaborationMembershipInput {
  role?: CreatorCollaborationRole;
  status?: CreatorCollaborationStatus;
  invitedBy?: string;
  invitationId?: string;
  updatedAt: Date;
  respondedAt?: Date | null;
}

export interface CreatorCollaborationUnitOfWork {
  /** Must be the first lock acquired by a shared-document save transaction. */
  acquireStudioCrdtWorkAdvisoryLock(workId: string): Promise<void>;
  getStudioCrdtServerSequence(workId: string): Promise<bigint>;
  findWork(workId: string, lock?: boolean): Promise<CreatorCollaborationWorkRecord | null>;
  findUser(userId: string, lock?: boolean): Promise<CreatorCollaborationUserRecord | null>;
  findMembership(
    workId: string,
    userId: string
  ): Promise<CreatorCollaborationMembershipRecord | null>;
  listMemberships(workId: string): Promise<CreatorCollaborationMembershipWithUserRecord[]>;
  countNonDeclinedMemberships(workId: string): Promise<number>;
  createMembership(input: CreateCreatorCollaborationMembershipInput): Promise<void>;
  updateMembership(
    workId: string,
    userId: string,
    input: UpdateCreatorCollaborationMembershipInput,
    expectedInvitationId?: string
  ): Promise<boolean>;
  deleteMembership(workId: string, userId: string): Promise<boolean>;
  listPendingInvitations(
    userId: string,
    limit: number
  ): Promise<CreatorCollaborationInvitationRecord[]>;
  appendEvent(input: AppendCreatorCollaborationEventInput): Promise<void>;
  findLatestRemovalEvent(
    workId: string,
    targetUserId: string
  ): Promise<CreatorCollaborationRemovalRecord | null>;
  listAuthorizedEvents(
    actorUserId: string,
    workId: string,
    limit: number
  ): Promise<CreatorCollaborationAuthorizedEventsRecord | null>;
  listAccessibleWorks(
    actorUserId: string,
    limit: number,
    cursor: CreatorSharedWorksCursorKey | null
  ): Promise<CreatorSharedWorkRecord[]>;
  findAccessibleDocument(
    actorUserId: string,
    workId: string
  ): Promise<CreatorSharedDocumentRecord | null>;
  findAccessibleDocumentMeta(
    actorUserId: string,
    workId: string
  ): Promise<CreatorSharedDocumentMetaRecord | null>;
  /** Called only after the transaction has acquired the creator_work row lock. */
  findStudioLinked3dPassAssets(
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioLinked3dPassAssetRow[]>;
  updateAccessibleDocument(
    actorUserId: string,
    workId: string,
    baseRevision: number,
    patch: CreatorSharedDocumentPatch,
    updatedAt: Date
  ): Promise<CreatorSharedDocumentMutationRecord | null>;
  appendWorkRevision(
    workId: string,
    revision: number,
    snapshot: CreatorWorkRevisionSnapshot,
    createdAt: Date
  ): Promise<void>;
  deleteWorkRevisionsThrough(workId: string, revision: number): Promise<void>;
}

export interface CreatorCollaborationPersistence {
  read<T>(run: (unit: CreatorCollaborationUnitOfWork) => Promise<T>): Promise<T>;
  transaction<T>(run: (unit: CreatorCollaborationUnitOfWork) => Promise<T>): Promise<T>;
}
