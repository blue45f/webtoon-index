import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  StudioLinked3dPassAssetFenceError,
  type StudioLinked3dPassAssetRow,
} from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";

import {
  CREATOR_DRAFT_COLLABORATION_ACTIVE_ROOM_LIMIT,
  CREATOR_DRAFT_COLLABORATION_INITIAL_SNAPSHOT_MAX_BYTES,
  CREATOR_DRAFT_COLLABORATION_PROVISION_LIMIT,
  CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS,
  CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS,
  CreatorDraftCollaborationAlreadyPromotedError,
  CreatorDraftCollaborationGraphConflictError,
  CreatorDraftCollaborationMutationReuseError,
  CreatorDraftCollaborationRateLimitError,
  CreatorDraftCollaborationRepository,
  CreatorDraftCollaborationRoomExpiredError,
  CreatorDraftCollaborationRoomLimitError,
  CreatorDraftCollaborationRoomNotFoundError,
  CreatorDraftCollaborationTargetMismatchError,
  CreatorDraftCollaborationWorkRevisionConflictError,
  type CreateCreatorDraftCollaborationRoomInput,
  type CreatorDraftCollaborationPersistence,
  type CreatorDraftCollaborationProvisionalWorkRecord,
  type CreatorDraftCollaborationRoomRecord,
  type CreatorDraftCollaborationUnitOfWork,
  type PromoteCreatorDraftCollaborationRoomMutation,
} from "./creator-draft-collaboration.repository";

const NOW = Date.parse("2026-07-26T00:00:00.000Z");
const OWNER = "owner-a";
const LINKED_PASS_HASH = "a".repeat(64);
const LINKED_PASS_SOURCE_HASH = "b".repeat(64);
const LINKED_PASS_LOCATOR = `studio-opfs-cas:sha256:${LINKED_PASS_HASH}`;
const UUIDS = Array.from(
  { length: 80 },
  (_, index) =>
    `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`
);

function draftId(index = 0): string {
  return `draft_${UUIDS[index]}`;
}

function mutationId(index = 30): string {
  return UUIDS[index];
}

function cloneRoom(
  room: CreatorDraftCollaborationRoomRecord
): CreatorDraftCollaborationRoomRecord {
  return {
    ...room,
    createdAt: new Date(room.createdAt),
    lastActivityAt: new Date(room.lastActivityAt),
    expiresAt: new Date(room.expiresAt),
    promotedAt: room.promotedAt ? new Date(room.promotedAt) : null,
    updatedAt: new Date(room.updatedAt),
  };
}

class FakeDraftCollaborationStore
  implements CreatorDraftCollaborationPersistence, CreatorDraftCollaborationUnitOfWork
{
  rooms = new Map<string, CreatorDraftCollaborationRoomRecord>();
  works = new Map<
    string,
    {
      ownerUserId: string;
      status: "draft" | "published";
      hidden: boolean;
      revisions: number;
      revision: number;
      revisionSnapshotStatus: "draft" | "published";
      cover: unknown;
      pages: unknown;
      doc: unknown;
    }
  >();
  assetRows = new Map<string, StudioLinked3dPassAssetRow>();
  assetQueries: Array<{ workId: string; assetIds: readonly string[] }> = [];
  operations: string[] = [];
  transactionCount = 0;
  createCount = 0;
  renewCount = 0;
  promoteCount = 0;

  async transaction<T>(
    run: (unit: CreatorDraftCollaborationUnitOfWork) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    return run(this);
  }

  async acquireOwnerProvisionLock(ownerUserId: string): Promise<void> {
    this.operations.push(`lock:${ownerUserId}`);
  }

  async deleteExpiredProvisionalWorks(
    ownerUserId: string,
    now: Date,
    limit: number
  ): Promise<number> {
    this.operations.push(`cleanup:${ownerUserId}`);
    const expired = [...this.rooms.values()]
      .filter(
        (room) =>
          room.ownerUserId === ownerUserId &&
          room.status === "active" &&
          room.expiresAt.getTime() <= now.getTime()
      )
      .sort(
        (left, right) =>
          left.expiresAt.getTime() - right.expiresAt.getTime() ||
          left.roomId.localeCompare(right.roomId)
      )
      .slice(0, limit);
    for (const room of expired) {
      const work = this.works.get(room.workId);
      if (work?.ownerUserId === ownerUserId && work.hidden) {
        this.works.delete(room.workId);
      }
      this.rooms.delete(room.roomId);
    }
    return expired.length;
  }

  async findRoomByOwnerDraft(
    ownerUserId: string,
    draftDocumentId: string,
    _lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = [...this.rooms.values()].find(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.draftDocumentId === draftDocumentId
    );
    return room ? cloneRoom(room) : null;
  }

  async findRoomByOwnerProvisionMutation(
    ownerUserId: string,
    mutationIdValue: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = [...this.rooms.values()].find(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.provisionMutationId === mutationIdValue
    );
    return room ? cloneRoom(room) : null;
  }

  async findRoomByOwnerPromotionMutation(
    ownerUserId: string,
    mutationIdValue: string
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = [...this.rooms.values()].find(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.promotionMutationId === mutationIdValue
    );
    return room ? cloneRoom(room) : null;
  }

  async findRoomByOwnerRoomId(
    ownerUserId: string,
    roomId: string,
    _lock: boolean
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = this.rooms.get(roomId);
    return room?.ownerUserId === ownerUserId ? cloneRoom(room) : null;
  }

  async lockProvisionalWorkForPromotion(
    ownerUserId: string,
    workId: string
  ): Promise<CreatorDraftCollaborationProvisionalWorkRecord | null> {
    const work = this.works.get(workId);
    if (!work || work.ownerUserId !== ownerUserId) return null;
    return {
      workId,
      ownerUserId: work.ownerUserId,
      status: work.status,
      hidden: work.hidden,
      revision: work.revision,
      cover: work.cover,
      pages: work.pages,
      doc: work.doc,
    };
  }

  async findLinked3dPassAssetRows(
    workId: string,
    assetIds: readonly string[]
  ): Promise<readonly StudioLinked3dPassAssetRow[]> {
    this.assetQueries.push({ workId, assetIds: [...assetIds] });
    return assetIds.flatMap((assetId) => {
      const row = this.assetRows.get(`${workId}:${assetId}`);
      return row ? [row] : [];
    });
  }

  async countOwnerRoomsCreatedSince(
    ownerUserId: string,
    since: Date
  ): Promise<number> {
    return [...this.rooms.values()].filter(
      (room) =>
        room.ownerUserId === ownerUserId &&
        room.createdAt.getTime() >= since.getTime()
    ).length;
  }

  async countOwnerActiveRooms(ownerUserId: string, now: Date): Promise<number> {
    return [...this.rooms.values()].filter(
      (room) =>
        room.ownerUserId === ownerUserId &&
        room.status === "active" &&
        room.expiresAt.getTime() > now.getTime()
    ).length;
  }

  async createProvisionalRoom(
    input: CreateCreatorDraftCollaborationRoomInput
  ): Promise<CreatorDraftCollaborationRoomRecord> {
    this.operations.push(`create:${input.ownerUserId}`);
    this.createCount += 1;
    this.works.set(input.workId, {
      ownerUserId: input.ownerUserId,
      status: "draft",
      hidden: true,
      revisions: 1,
      revision: 1,
      revisionSnapshotStatus: "draft",
      cover: "",
      pages: [],
      doc: {},
    });
    const room: CreatorDraftCollaborationRoomRecord = {
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
      createdAt: new Date(input.createdAt),
      lastActivityAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      promotedAt: null,
      updatedAt: new Date(input.createdAt),
    };
    this.rooms.set(room.roomId, room);
    return cloneRoom(room);
  }

  async renewActiveRoom(
    ownerUserId: string,
    roomId: string,
    graphRevision: number,
    now: Date,
    expiresAt: Date
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = this.rooms.get(roomId);
    if (
      !room ||
      room.ownerUserId !== ownerUserId ||
      room.status !== "active" ||
      room.graphRevision !== graphRevision
    ) {
      return null;
    }
    this.renewCount += 1;
    const renewed = {
      ...room,
      lastActivityAt: new Date(now),
      expiresAt: new Date(expiresAt),
      updatedAt: new Date(now),
    };
    this.rooms.set(roomId, renewed);
    return cloneRoom(renewed);
  }

  async promoteRoom(
    input: PromoteCreatorDraftCollaborationRoomMutation
  ): Promise<CreatorDraftCollaborationRoomRecord | null> {
    const room = this.rooms.get(input.roomId);
    const work = this.works.get(input.workId);
    if (
      !room ||
      !work ||
      room.ownerUserId !== input.ownerUserId ||
      room.workId !== input.workId ||
      room.status !== "active" ||
      room.graphRevision !== input.expectedGraphRevision ||
      room.expiresAt.getTime() <= input.promotedAt.getTime() ||
      work.revision !== input.expectedWorkRevision ||
      !work.hidden
    ) {
      return null;
    }
    this.promoteCount += 1;
    const promoted: CreatorDraftCollaborationRoomRecord = {
      ...room,
      status: "promoted",
      graphRevision: room.graphRevision + 1,
      promotionMutationId: input.promotionMutationId,
      promotionExpectedWorkRevision: input.expectedWorkRevision,
      promotionFinalStatus: input.finalStatus,
      promotedAt: new Date(input.promotedAt),
      lastActivityAt: new Date(input.promotedAt),
      updatedAt: new Date(input.promotedAt),
    };
    this.rooms.set(room.roomId, promoted);
    this.works.set(input.workId, {
      ...work,
      hidden: false,
      status: input.finalStatus,
      revisionSnapshotStatus: input.finalStatus,
    });
    return cloneRoom(promoted);
  }

  async deleteProvisionalWork(
    ownerUserId: string,
    workId: string
  ): Promise<boolean> {
    const work = this.works.get(workId);
    if (!work || work.ownerUserId !== ownerUserId || !work.hidden) return false;
    this.works.delete(workId);
    for (const room of this.rooms.values()) {
      if (room.workId === workId) this.rooms.delete(room.roomId);
    }
    return true;
  }

  seedRoom(input: {
    index: number;
    ownerUserId?: string;
    createdAt: number;
    expiresAt: number;
    mutationIndex?: number;
    workStatus?: "draft" | "published";
    hidden?: boolean;
  }): CreatorDraftCollaborationRoomRecord {
    const workId = `work-${input.index}`;
    const room: CreatorDraftCollaborationRoomRecord = {
      roomId: `draft-room_${UUIDS[input.index]}`,
      draftDocumentId: draftId(input.index),
      ownerUserId: input.ownerUserId ?? OWNER,
      workId,
      status: "active",
      graphRevision: 0,
      initialSnapshotByteLength: 0,
      provisionIntent: "share-link",
      provisionMutationId: mutationId(input.mutationIndex ?? input.index + 30),
      promotionMutationId: null,
      promotionExpectedWorkRevision: null,
      promotionFinalStatus: null,
      createdAt: new Date(input.createdAt),
      lastActivityAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      promotedAt: null,
      updatedAt: new Date(input.createdAt),
    };
    this.rooms.set(room.roomId, room);
    this.works.set(workId, {
      ownerUserId: room.ownerUserId,
      status: input.workStatus ?? "draft",
      hidden: input.hidden ?? true,
      revisions: 1,
      revision: 1,
      revisionSnapshotStatus: input.workStatus ?? "draft",
      cover: "",
      pages: [],
      doc: {},
    });
    return room;
  }
}

function provisionInput(index = 0) {
  return {
    ownerUserId: OWNER,
    ownerScopeKey: OWNER,
    draftDocumentId: draftId(index),
    intent: "share-link" as const,
    clientMutationId: mutationId(index + 30),
    initialSnapshotByteLength: 1_024,
  };
}

function linkedPassEnvelope(linkCount = 1) {
  const elements = Array.from({ length: linkCount }, (_, index) => ({
    id: `line-${index}`,
    type: "image",
    src: LINKED_PASS_LOCATOR,
  }));
  const links = Array.from({ length: linkCount }, (_, index) => ({
    bundleId: `bundle-${index}`,
    shotId: `shot-${index}`,
    sourceShotId: null,
    stageSourceHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
    layers: [{ elementId: `line-${index}`, role: "main-line" }],
    passRevision: {
      revision: 1,
      sourceHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      sceneHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      cameraHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      baseGeometryHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      topologyHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      objectIdentityHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
      objectStableIds: ["obj/room"],
      passRootHash: `sha256:${LINKED_PASS_SOURCE_HASH}`,
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
    cover: "",
    pages: [],
    doc: {
      pagesList: [{
        id: "page-1",
        elements,
        linked3dRender: {
          kind: "toonspectrum.studio-linked-3d-render",
          version: 2,
          authority: "studio-project-linked-3d-pass-index",
          links,
        },
      }],
    },
  };
}

function linkedPassAssetRow(workId: string): StudioLinked3dPassAssetRow {
  const assetId = `linked3d-pass-sha256-${LINKED_PASS_HASH}`;
  return {
    workId,
    assetId,
    elementType: "image",
    mimeType: "image/png",
    descriptor: {
      version: 1,
      element: {
        id: assetId,
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
  };
}

function repository(
  store: FakeDraftCollaborationStore,
  options: { now?: () => Date; uuids?: string[] } = {}
): CreatorDraftCollaborationRepository {
  const queue = [...(options.uuids ?? [UUIDS[70], UUIDS[71]])];
  return new CreatorDraftCollaborationRepository(store, {
    now: options.now ?? (() => new Date(NOW)),
    createUuid: () => {
      const value = queue.shift();
      if (!value) throw new Error("test UUID queue exhausted");
      return value;
    },
  });
}

describe("CreatorDraftCollaborationRepository provision", () => {
  it("locks the owner before creating one hidden draft work, revision and marker atomically", async () => {
    const store = new FakeDraftCollaborationStore();
    const result = await repository(store).provision(provisionInput());

    expect(result).toMatchObject({
      version: 1,
      roomId: `draft-room_${UUIDS[70]}`,
      draftDocumentId: draftId(),
      provisionalWorkId: UUIDS[71],
      ownerScopeKey: OWNER,
      status: "active",
      graphRevision: 0,
      initialSnapshotByteLength: 1_024,
      provisionIntent: "share-link",
      promotedAt: null,
    });
    expect(Date.parse(result.expiresAt) - NOW).toBe(
      CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS
    );
    expect(store.works.get(result.provisionalWorkId)).toMatchObject({
      ownerUserId: OWNER,
      status: "draft",
      hidden: true,
      revisions: 1,
      revision: 1,
    });
    expect(store.operations.slice(0, 3)).toEqual([
      `lock:${OWNER}`,
      `cleanup:${OWNER}`,
      `create:${OWNER}`,
    ]);
    expect(store.transactionCount).toBe(1);
  });

  it("returns and renews the same owner+draft room without allocating another work", async () => {
    let now = NOW;
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      now: () => new Date(now),
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const first = await repo.provision(provisionInput());
    now += 60_000;
    const second = await repo.provision({
      ...provisionInput(),
      clientMutationId: mutationId(50),
      intent: "invite-member",
    });

    expect(second.roomId).toBe(first.roomId);
    expect(second.provisionalWorkId).toBe(first.provisionalWorkId);
    expect(second.provisionIntent).toBe("share-link");
    expect(Date.parse(second.expiresAt)).toBe(
      now + CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS
    );
    expect(store.createCount).toBe(1);
    expect(store.renewCount).toBe(1);
  });

  it("roundtrips cloud-save and keeps an exact mutation idempotent", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const input = {
      ...provisionInput(),
      intent: "cloud-save" as const,
    };

    const first = await repo.provision(input);
    const replay = await repo.provision(input);

    expect(first).toMatchObject({
      provisionalWorkId: UUIDS[71],
      status: "active",
      provisionIntent: "cloud-save",
    });
    expect(replay).toEqual(first);
    expect(store.createCount).toBe(1);
    expect(store.renewCount).toBe(1);
    expect(store.works.get(first.provisionalWorkId)?.hidden).toBe(true);
  });

  it("rejects a provision mutation replay whose immutable body changed", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const input = {
      ...provisionInput(),
      intent: "cloud-save" as const,
    };
    await repo.provision(input);

    await expect(
      repo.provision({ ...input, intent: "share-link" })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationMutationReuseError);
    await expect(
      repo.provision({ ...input, initialSnapshotByteLength: 2_048 })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationMutationReuseError);
    expect(store.createCount).toBe(1);
    expect(store.renewCount).toBe(0);
  });

  it("reaps an expired provisional work by cascade and creates a fresh graph for the same draft", async () => {
    let now = NOW;
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      now: () => new Date(now),
      uuids: [UUIDS[70], UUIDS[71], UUIDS[72], UUIDS[73]],
    });
    const first = await repo.provision(provisionInput());
    now += CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS + 1;
    const second = await repo.provision({
      ...provisionInput(),
      clientMutationId: mutationId(51),
    });

    expect(second.provisionalWorkId).not.toBe(first.provisionalWorkId);
    expect(store.works.has(first.provisionalWorkId)).toBe(false);
    expect(store.rooms.has(first.roomId)).toBe(false);
    expect(store.createCount).toBe(2);
  });

  it("advances a bounded cleanup batch past 32 nondeletable legacy poison rows", async () => {
    const store = new FakeDraftCollaborationStore();
    const oldCreatedAt = NOW - CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS - 1;
    for (let index = 0; index < 32; index += 1) {
      store.seedRoom({
        index,
        createdAt: oldCreatedAt,
        expiresAt: NOW - 1,
        workStatus: "published",
        hidden: false,
      });
    }
    const hiddenPoison = store.seedRoom({
      index: 32,
      createdAt: oldCreatedAt,
      expiresAt: NOW - 1,
      workStatus: "published",
      hidden: true,
    });
    const repo = repository(store, {
      uuids: [UUIDS[74], UUIDS[75], UUIDS[76], UUIDS[77]],
    });

    await repo.provision(provisionInput(40));

    expect(store.rooms.has(`draft-room_${UUIDS[0]}`)).toBe(false);
    expect(store.works.has("work-0")).toBe(true);
    expect(store.rooms.has(hiddenPoison.roomId)).toBe(true);
    expect(store.works.has(hiddenPoison.workId)).toBe(true);

    await repo.provision(provisionInput(41));

    expect(store.rooms.has(hiddenPoison.roomId)).toBe(false);
    expect(store.works.has(hiddenPoison.workId)).toBe(false);
    expect(store.createCount).toBe(2);
  });

  it("enforces owner+mutation idempotency, DB-window rate and active-room caps", async () => {
    const mutationStore = new FakeDraftCollaborationStore();
    mutationStore.seedRoom({
      index: 0,
      createdAt: NOW,
      expiresAt: NOW + CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS,
      mutationIndex: 30,
    });
    await expect(
      repository(mutationStore).provision({
        ...provisionInput(1),
        clientMutationId: mutationId(30),
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationMutationReuseError);

    const rateStore = new FakeDraftCollaborationStore();
    for (let index = 0; index < CREATOR_DRAFT_COLLABORATION_PROVISION_LIMIT; index += 1) {
      rateStore.seedRoom({
        index,
        createdAt: NOW - CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS + 1,
        expiresAt: NOW + CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS,
      });
    }
    await expect(
      repository(rateStore).provision(provisionInput(20))
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationRateLimitError);

    const capacityStore = new FakeDraftCollaborationStore();
    for (
      let index = 0;
      index < CREATOR_DRAFT_COLLABORATION_ACTIVE_ROOM_LIMIT;
      index += 1
    ) {
      capacityStore.seedRoom({
        index,
        createdAt: NOW - CREATOR_DRAFT_COLLABORATION_PROVISION_WINDOW_MS - 1,
        expiresAt: NOW + CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS,
      });
    }
    await expect(
      repository(capacityStore).provision(provisionInput(20))
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationRoomLimitError);
  });

  it("fails closed for a spoofed owner or an oversized initial snapshot", async () => {
    const store = new FakeDraftCollaborationStore();
    await expect(
      repository(store).provision({
        ...provisionInput(),
        ownerScopeKey: "owner-b",
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationTargetMismatchError);
    await expect(
      repository(store).provision({
        ...provisionInput(),
        initialSnapshotByteLength:
          CREATOR_DRAFT_COLLABORATION_INITIAL_SNAPSHOT_MAX_BYTES + 1,
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationTargetMismatchError);
    await expect(
      repository(store).provision({
        ...provisionInput(),
        intent: "implicit-save" as never,
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationTargetMismatchError);
    expect(store.transactionCount).toBe(0);
  });
});

describe("CreatorDraftCollaborationRepository promotion", () => {
  it("promotes the same workId and keeps retained rN restore status equal to the work", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const provisioned = await repo.provision(provisionInput());
    const promotionInput = {
      ownerUserId: OWNER,
      ownerScopeKey: OWNER,
      roomId: provisioned.roomId,
      draftDocumentId: provisioned.draftDocumentId,
      targetWorkId: provisioned.provisionalWorkId,
      expectedGraphRevision: 0,
      expectedWorkRevision: 1,
      finalStatus: "published" as const,
      clientMutationId: mutationId(60),
    };
    const promoted = await repo.promote(promotionInput);

    expect(promoted).toMatchObject({
      status: "promoted",
      provisionalWorkId: provisioned.provisionalWorkId,
      graphRevision: 1,
    });
    expect(store.works.get(provisioned.provisionalWorkId)).toMatchObject({
      hidden: false,
      status: "published",
      revision: 1,
      revisions: 1,
      revisionSnapshotStatus: "published",
    });
    const publishedWork = store.works.get(provisioned.provisionalWorkId);
    expect(publishedWork?.revisionSnapshotStatus).toBe(publishedWork?.status);
    expect(store.promoteCount).toBe(1);

    await expect(repo.promote(promotionInput)).resolves.toEqual(promoted);
    expect(store.promoteCount).toBe(1);
    await expect(
      repo.promote({ ...promotionInput, clientMutationId: mutationId(61) })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationAlreadyPromotedError);
    await expect(
      repo.promote({ ...promotionInput, finalStatus: "draft" })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationAlreadyPromotedError);
    await expect(
      repo.promote({ ...promotionInput, expectedWorkRevision: 2 })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationAlreadyPromotedError);
  });

  it("rejects re-keying and stale graph revisions without mutating the room", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const provisioned = await repo.provision(provisionInput());
    const base = {
      ownerUserId: OWNER,
      ownerScopeKey: OWNER,
      roomId: provisioned.roomId,
      draftDocumentId: provisioned.draftDocumentId,
      targetWorkId: provisioned.provisionalWorkId,
      expectedGraphRevision: 0,
      expectedWorkRevision: 1,
      finalStatus: "draft" as const,
      clientMutationId: mutationId(60),
    };

    await expect(
      repo.promote({ ...base, targetWorkId: "different-work" })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationTargetMismatchError);
    const room = store.rooms.get(provisioned.roomId);
    if (!room) throw new Error("missing test room");
    store.rooms.set(provisioned.roomId, { ...room, graphRevision: 2 });
    await expect(repo.promote(base)).rejects.toMatchObject(
      new CreatorDraftCollaborationGraphConflictError(2)
    );
    expect(store.works.get(provisioned.provisionalWorkId)?.hidden).toBe(true);
  });

  it("locks the staged work and rejects a stale work revision before publication", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const provisioned = await repo.provision(provisionInput());
    const work = store.works.get(provisioned.provisionalWorkId);
    if (!work) throw new Error("missing staged work");
    store.works.set(provisioned.provisionalWorkId, {
      ...work,
      revision: 2,
      revisions: 2,
    });

    await expect(repo.promote({
      ownerUserId: OWNER,
      ownerScopeKey: OWNER,
      roomId: provisioned.roomId,
      draftDocumentId: provisioned.draftDocumentId,
      targetWorkId: provisioned.provisionalWorkId,
      expectedGraphRevision: 0,
      expectedWorkRevision: 1,
      finalStatus: "published",
      clientMutationId: mutationId(60),
    })).rejects.toMatchObject(
      new CreatorDraftCollaborationWorkRevisionConflictError(2)
    );
    expect(store.promoteCount).toBe(0);
    expect(store.rooms.get(provisioned.roomId)?.status).toBe("active");
    expect(store.works.get(provisioned.provisionalWorkId)?.hidden).toBe(true);
  });

  it("fences linked pass receipts against same-work immutable asset rows before publication", async () => {
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const provisioned = await repo.provision(provisionInput());
    const work = store.works.get(provisioned.provisionalWorkId);
    if (!work) throw new Error("missing staged work");
    store.works.set(provisioned.provisionalWorkId, {
      ...work,
      ...linkedPassEnvelope(65),
      revision: 2,
      revisions: 2,
    });
    const promotion = {
      ownerUserId: OWNER,
      ownerScopeKey: OWNER,
      roomId: provisioned.roomId,
      draftDocumentId: provisioned.draftDocumentId,
      targetWorkId: provisioned.provisionalWorkId,
      expectedGraphRevision: 0,
      expectedWorkRevision: 2,
      finalStatus: "published" as const,
      clientMutationId: mutationId(60),
    };

    await expect(repo.promote(promotion)).rejects.toMatchObject({
      name: "StudioLinked3dPassAssetFenceError",
      code: "asset-missing",
    } satisfies Partial<StudioLinked3dPassAssetFenceError>);
    expect(store.promoteCount).toBe(0);
    expect(store.rooms.get(provisioned.roomId)?.status).toBe("active");
    expect(store.works.get(provisioned.provisionalWorkId)?.hidden).toBe(true);

    const row = linkedPassAssetRow(provisioned.provisionalWorkId);
    store.assetRows.set(`${row.workId}:${row.assetId}`, row);
    await expect(repo.promote(promotion)).resolves.toMatchObject({
      status: "promoted",
      graphRevision: 1,
    });
    expect(store.assetQueries).toEqual([
      { workId: provisioned.provisionalWorkId, assetIds: [row.assetId] },
      { workId: provisioned.provisionalWorkId, assetIds: [row.assetId] },
    ]);
    expect(store.works.get(provisioned.provisionalWorkId)).toMatchObject({
      hidden: false,
      status: "published",
      revision: 2,
      revisions: 2,
    });
  });

  it("deletes an expired provisional graph and hides owner mismatches as not found", async () => {
    let now = NOW;
    const store = new FakeDraftCollaborationStore();
    const repo = repository(store, {
      now: () => new Date(now),
      uuids: [UUIDS[70], UUIDS[71]],
    });
    const provisioned = await repo.provision(provisionInput());
    now += CREATOR_DRAFT_COLLABORATION_ROOM_IDLE_TTL_MS;
    await expect(
      repo.promote({
        ownerUserId: OWNER,
        ownerScopeKey: OWNER,
        roomId: provisioned.roomId,
        draftDocumentId: provisioned.draftDocumentId,
        targetWorkId: provisioned.provisionalWorkId,
        expectedGraphRevision: 0,
        expectedWorkRevision: 1,
        finalStatus: "draft",
        clientMutationId: mutationId(60),
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationRoomExpiredError);
    expect(store.works.has(provisioned.provisionalWorkId)).toBe(false);
    expect(store.rooms.has(provisioned.roomId)).toBe(false);

    await expect(
      repo.promote({
        ownerUserId: "owner-b",
        ownerScopeKey: "owner-b",
        roomId: provisioned.roomId,
        draftDocumentId: provisioned.draftDocumentId,
        targetWorkId: provisioned.provisionalWorkId,
        expectedGraphRevision: 0,
        expectedWorkRevision: 1,
        finalStatus: "draft",
        clientMutationId: mutationId(61),
      })
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationRoomNotFoundError);
  });
});

describe("creator draft collaboration SQL boundary", () => {
  it("ships an indexed FK-safe marker migration with lease, size and promotion constraints", () => {
    const migration = readFileSync(
      new URL(
        "../../db/migrations/0020_creator_draft_collaboration_room.sql",
        import.meta.url
      ),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "creator_draft_collaboration_room"');
    expect(migration).toContain('FOREIGN KEY ("workId") REFERENCES "creator_work"("id") ON DELETE CASCADE');
    expect(migration).toContain('UNIQUE ("ownerUserId", "draftDocumentId")');
    expect(migration).toContain('UNIQUE ("workId")');
    expect(migration).toContain('"initialSnapshotByteLength" BETWEEN 0 AND 16777216');
    expect(migration).toContain(`WHERE "status" = 'active'`);
    expect(migration).toContain(`"status" = 'promoted'`);
    expect(migration).not.toMatch(/ALTER TABLE\s+"creator_work_collaborator"/u);
  });

  it("widens the provision intent check through a validated forward migration", () => {
    const migration = readFileSync(
      new URL(
        "../../db/migrations/0026_creator_draft_cloud_save_intent.sql",
        import.meta.url
      ),
      "utf8"
    );
    const drop = migration.indexOf(
      'DROP CONSTRAINT IF EXISTS "creator_draft_collaboration_room_provision_intent_check"'
    );
    const add = migration.indexOf(
      'ADD CONSTRAINT "creator_draft_collaboration_room_provision_intent_check"'
    );
    const validate = migration.indexOf(
      'VALIDATE CONSTRAINT "creator_draft_collaboration_room_provision_intent_check"'
    );

    expect(drop).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(drop);
    expect(validate).toBeGreaterThan(add);
    expect(migration).toContain(
      "CHECK (\"provisionIntent\" IN ('share-link', 'invite-member', 'cloud-save'))"
    );
    expect(migration).toContain("0026_creator_draft_cloud_save_intent");
    expect(migration).toContain('INSERT INTO "toonspectrum_schema_migration"');
    expect(migration).not.toMatch(/UPDATE\s+"creator_draft_collaboration_room"/u);
  });

  it("serializes provision admission across API nodes before count or insert", () => {
    const source = readFileSync(
      new URL("./creator-draft-collaboration.repository.ts", import.meta.url),
      "utf8"
    );
    const lock = source.indexOf("await unit.acquireOwnerProvisionLock");
    const cleanup = source.indexOf("await unit.deleteExpiredProvisionalWorks", lock);
    const lookup = source.indexOf("unit.findRoomByOwnerDraft", cleanup);
    const rate = source.indexOf("unit.countOwnerRoomsCreatedSince", lookup);
    const create = source.indexOf("unit.createProvisionalRoom", rate);

    expect(source).toContain("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(0);
    expect(cleanup).toBeGreaterThan(lock);
    expect(lookup).toBeGreaterThan(cleanup);
    expect(rate).toBeGreaterThan(lookup);
    expect(create).toBeGreaterThan(rate);
  });

  it("cleanup preserves non-hidden works while removing poison markers and does not require draft status", () => {
    const source = readFileSync(
      new URL("./creator-draft-collaboration.repository.ts", import.meta.url),
      "utf8"
    );
    const start = source.indexOf("async deleteExpiredProvisionalWorks(");
    const end = source.indexOf("async findRoomByOwnerDraft(", start);
    const cleanup = source.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(cleanup).toContain("eq(creatorWorks.hidden, true)");
    expect(cleanup).not.toContain('eq(creatorWorks.status, "draft")');
    expect(cleanup).toContain(".delete(creatorDraftCollaborationRooms)");
    expect(cleanup).toContain("expired.map(({ roomId }) => roomId)");
    expect(cleanup).toContain("return expired.length");
  });

  it("locks room and staged work before the in-transaction asset fence and publication", () => {
    const source = readFileSync(
      new URL("./creator-draft-collaboration.repository.ts", import.meta.url),
      "utf8"
    );
    const promoteMethod = source.indexOf("async promote(\n    input:");
    const ownerLock = source.indexOf(
      "await unit.acquireOwnerProvisionLock",
      promoteMethod
    );
    const roomLock = source.indexOf("unit.findRoomByOwnerRoomId", ownerLock);
    const workLock = source.indexOf(
      "unit.lockProvisionalWorkForPromotion",
      roomLock
    );
    const extract = source.indexOf(
      "extractStudioLinked3dPassAssetRequirements",
      workLock
    );
    const metadataQuery = source.indexOf(
      "unit.findLinked3dPassAssetRows",
      extract
    );
    const fence = source.indexOf("assertStudioLinked3dPassAssetRows", metadataQuery);
    const publish = source.indexOf("unit.promoteRoom", fence);

    expect(promoteMethod).toBeGreaterThan(0);
    expect(ownerLock).toBeGreaterThan(promoteMethod);
    expect(roomLock).toBeGreaterThan(ownerLock);
    expect(workLock).toBeGreaterThan(roomLock);
    expect(extract).toBeGreaterThan(workLock);
    expect(metadataQuery).toBeGreaterThan(extract);
    expect(fence).toBeGreaterThan(metadataQuery);
    expect(publish).toBeGreaterThan(fence);
  });

  it("publishes creator_work and the exact retained revision snapshot in one UoW", () => {
    const source = readFileSync(
      new URL("./creator-draft-collaboration.repository.ts", import.meta.url),
      "utf8"
    );
    const promoteRoom = source.indexOf("async promoteRoom(");
    const publishWork = source.indexOf(".update(creatorWorks)", promoteRoom);
    const publishSnapshot = source.indexOf(".update(creatorWorkRevisions)", publishWork);
    const exactRevision = source.indexOf(
      "eq(creatorWorkRevisions.revision, input.expectedWorkRevision)",
      publishSnapshot
    );
    const rowCount = source.indexOf("revisionSnapshots.length !== 1", exactRevision);

    expect(promoteRoom).toBeGreaterThan(0);
    expect(publishWork).toBeGreaterThan(promoteRoom);
    expect(publishSnapshot).toBeGreaterThan(publishWork);
    expect(exactRevision).toBeGreaterThan(publishSnapshot);
    expect(rowCount).toBeGreaterThan(exactRevision);
  });
});
