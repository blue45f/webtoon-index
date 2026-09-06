import { describe, expect, it } from "vitest";

import {
  STUDIO_DRAFT_COLLABORATION_POLICY,
  consumeStudioDraftCollaborationProvisionAttempt,
  createStudioDraftCollaborationIdentityRepository,
  createStudioDraftCollaborationPromotionRequest,
  createStudioDraftCollaborationProvisionRequest,
  loadOrCreateStudioDraftCollaborationIdentity,
  retireStudioDraftCollaborationIdentity,
  type StudioDraftCollaborationIdentity,
  type StudioDraftCollaborationIdentityRepository,
  type StudioDraftCollaborationTemporaryRoom,
} from "./studio-draft-collaboration";

const NOW = Date.parse("2026-07-26T00:00:00.000Z");
const UUIDS = {
  draftA: "11111111-1111-4111-8111-111111111111",
  draftB: "22222222-2222-4222-8222-222222222222",
  mutation: "33333333-3333-4333-8333-333333333333",
  room: "44444444-4444-4444-8444-444444444444",
} as const;

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async set(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}

function identityRepositoryFactory(
  store: ReturnType<typeof memoryStore>,
): () => Promise<StudioDraftCollaborationIdentityRepository> {
  const repository = createStudioDraftCollaborationIdentityRepository(store);
  return async () => repository;
}

function identity(
  overrides: Partial<StudioDraftCollaborationIdentity> = {}
): StudioDraftCollaborationIdentity {
  return {
    version: 1,
    draftDocumentId: `draft_${UUIDS.draftA}`,
    documentScopeKey: "autosave:new-work",
    ownerScopeKey: "account-a",
    createdAt: new Date(NOW).toISOString(),
    lastOpenedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(
      NOW + STUDIO_DRAFT_COLLABORATION_POLICY.localIdentityIdleTtlMs
    ).toISOString(),
    persistence: "persistent",
    ...overrides,
  };
}

function room(
  overrides: Partial<StudioDraftCollaborationTemporaryRoom> = {}
): StudioDraftCollaborationTemporaryRoom {
  return {
    version: 1,
    roomId: `draft-room_${UUIDS.room}`,
    provisionalWorkId: "saved-work-1",
    draftDocumentId: `draft_${UUIDS.draftA}`,
    ownerScopeKey: "account-a",
    graphRevision: 7,
    provisionedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(
      NOW + STUDIO_DRAFT_COLLABORATION_POLICY.temporaryRoomIdleTtlMs
    ).toISOString(),
    ...overrides,
  };
}

describe("local Studio draft collaboration SQLite identity", () => {
  it("keeps one stable persisted identity for the same document and owner", async () => {
    const store = memoryStore();
    const acquireRepository = identityRepositoryFactory(store);
    const first = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, acquireRepository);
    const second = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW + 60_000,
      createUuid: () => {
        throw new Error("stable identity must not rotate");
      },
    }, acquireRepository);

    expect(second.draftDocumentId).toBe(first.draftDocumentId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastOpenedAt).toBe(new Date(NOW + 60_000).toISOString());
    expect(second.persistence).toBe("persistent");
    expect(store.values.size).toBe(1);
    expect([...store.values.values()][0]).toContain(first.draftDocumentId);
  });

  it("isolates identities by owner-scoped SQLite rows", async () => {
    const store = memoryStore();
    const acquireRepository = identityRepositoryFactory(store);
    const first = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, acquireRepository);
    const second = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-b",
      now: NOW,
      createUuid: () => UUIDS.draftB,
    }, acquireRepository);

    expect(second.draftDocumentId).not.toBe(first.draftDocumentId);
    expect(store.values.size).toBe(2);
  });

  it("rotates an expired SQLite identity", async () => {
    const store = memoryStore();
    const acquireRepository = identityRepositoryFactory(store);
    await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, acquireRepository);
    const rotated = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW + STUDIO_DRAFT_COLLABORATION_POLICY.localIdentityIdleTtlMs,
      createUuid: () => UUIDS.draftB,
    }, acquireRepository);

    expect(rotated.draftDocumentId).toBe(`draft_${UUIDS.draftB}`);
  });

  it("serializes exact retirement, rotates the same scope, and preserves a newer identity", async () => {
    const store = memoryStore();
    const repository = createStudioDraftCollaborationIdentityRepository(store);
    const acquireRepository = async () => repository;
    const first = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, acquireRepository);

    // Invocation order is the authority: both calls share the same SQLite write queue even when
    // their promises are awaited together.
    const retirement = repository.retireExact(first);
    const replacement = repository.loadOrCreate({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW + 1,
      createUuid: () => UUIDS.draftB,
    });
    await expect(retirement).resolves.toBe(true);
    await expect(replacement).resolves.toMatchObject({
      draftDocumentId: `draft_${UUIDS.draftB}`,
      persistence: "persistent",
    });

    await expect(
      retireStudioDraftCollaborationIdentity(first, acquireRepository)
    ).resolves.toBe(false);
    const stableReplacement = await repository.loadOrCreate({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW + 2,
      createUuid: () => {
        throw new Error("stale retirement must not rotate the replacement");
      },
    });
    expect(stableReplacement.draftDocumentId).toBe(`draft_${UUIDS.draftB}`);
    expect([...store.values.values()][0]).toContain(`draft_${UUIDS.draftB}`);
    expect([...store.values.values()][0]).not.toContain(`draft_${UUIDS.draftA}`);
  });

  it("returns an explicit memory-only identity when SQLite/OPFS is blocked", async () => {
    const result = await loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, async () => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(result.persistence).toBe("memory-only");
    expect(result.draftDocumentId).toBe(`draft_${UUIDS.draftA}`);
  });

  it("treats a memory-only identity as already retired without opening SQLite", async () => {
    await expect(retireStudioDraftCollaborationIdentity(
      identity({ persistence: "memory-only" }),
      async () => {
        throw new Error("memory-only retirement must not open SQLite");
      },
    )).resolves.toBe(true);
  });

  it("rejects whitespace-rewritten scope keys and invalid UUID generators", async () => {
    await expect(loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: " autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => UUIDS.draftA,
    }, async () => {
      throw new Error("must not open SQLite");
    })).rejects.toThrow("문서 또는 소유자 범위");

    await expect(loadOrCreateStudioDraftCollaborationIdentity({
      documentScopeKey: "autosave:new-work",
      ownerScopeKey: "account-a",
      now: NOW,
      createUuid: () => "predictable",
    }, async () => {
      throw new Error("blocked");
    })).rejects.toThrow("올바른 UUID");
  });
});


describe("lazy draft collaboration provision and promotion contract", () => {
  it("builds an idempotent provision request for an explicit cloud-save intent", () => {
    const request = createStudioDraftCollaborationProvisionRequest({
      identity: identity(),
      actorAuthScopeKey: "account-a",
      intent: "cloud-save",
      initialSnapshotByteLength: 1_024,
      now: NOW + 1,
      createUuid: () => UUIDS.mutation,
    });

    expect(request).toEqual({
      version: 1,
      draftDocumentId: `draft_${UUIDS.draftA}`,
      ownerScopeKey: "account-a",
      intent: "cloud-save",
      clientMutationId: UUIDS.mutation,
      initialSnapshotByteLength: 1_024,
      requestedAt: new Date(NOW + 1).toISOString(),
    });
  });

  it("fails closed for the wrong owner, expired identity, or oversized snapshot", () => {
    expect(() =>
      createStudioDraftCollaborationProvisionRequest({
        identity: identity(),
        actorAuthScopeKey: "account-b",
        intent: "share-link",
        initialSnapshotByteLength: 0,
        now: NOW,
      })
    ).toThrow("소유하지 않습니다");
    expect(() =>
      createStudioDraftCollaborationProvisionRequest({
        identity: identity({ expiresAt: new Date(NOW).toISOString() }),
        actorAuthScopeKey: "account-a",
        intent: "share-link",
        initialSnapshotByteLength: 0,
        now: NOW,
      })
    ).toThrow("만료");
    expect(() =>
      createStudioDraftCollaborationProvisionRequest({
        identity: identity(),
        actorAuthScopeKey: "account-a",
        intent: "share-link",
        initialSnapshotByteLength:
          STUDIO_DRAFT_COLLABORATION_POLICY.maxInitialSnapshotBytes + 1,
        now: NOW,
      })
    ).toThrow("허용 크기");
  });

  it("locally limits repeated provision clicks per owner and draft window", () => {
    let gate = null;
    for (
      let attempt = 0;
      attempt < STUDIO_DRAFT_COLLABORATION_POLICY.provisionAttemptsPerWindow;
      attempt += 1
    ) {
      const result = consumeStudioDraftCollaborationProvisionAttempt(gate, {
        identity: identity(),
        now: NOW + attempt,
      });
      expect(result.allowed).toBe(true);
      gate = result.next;
    }
    const limited = consumeStudioDraftCollaborationProvisionAttempt(gate, {
      identity: identity(),
      now: NOW + 10,
    });
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);

    const reset = consumeStudioDraftCollaborationProvisionAttempt(limited.next, {
      identity: identity(),
      now: NOW + STUDIO_DRAFT_COLLABORATION_POLICY.provisionRateWindowMs,
    });
    expect(reset.allowed).toBe(true);
    expect(reset.next.attempts).toBe(1);
  });

  it("binds promotion to the same owner, draft, room and graph revision", () => {
    const request = createStudioDraftCollaborationPromotionRequest({
      identity: identity(),
      room: room(),
      actorAuthScopeKey: "account-a",
      targetWorkId: "saved-work-1",
      expectedWorkRevision: 9,
      finalStatus: "published",
      now: NOW + 1,
      createUuid: () => UUIDS.mutation,
    });

    expect(request).toMatchObject({
      draftDocumentId: `draft_${UUIDS.draftA}`,
      roomId: `draft-room_${UUIDS.room}`,
      ownerScopeKey: "account-a",
      targetWorkId: "saved-work-1",
      expectedGraphRevision: 7,
      expectedWorkRevision: 9,
      finalStatus: "published",
      clientMutationId: UUIDS.mutation,
    });
    expect(() =>
      createStudioDraftCollaborationPromotionRequest({
        identity: identity(),
        room: room({ draftDocumentId: `draft_${UUIDS.draftB}` }),
        actorAuthScopeKey: "account-a",
        targetWorkId: "saved-work-1",
        expectedWorkRevision: 9,
        finalStatus: "published",
        now: NOW + 1,
      })
    ).toThrow("승격할 수 없습니다");
    expect(() =>
      createStudioDraftCollaborationPromotionRequest({
        identity: identity(),
        room: room(),
        actorAuthScopeKey: "account-a",
        targetWorkId: "saved-work-1",
        expectedWorkRevision: 0,
        finalStatus: "published",
        now: NOW + 1,
      })
    ).toThrow("승격할 수 없습니다");
    expect(() =>
      createStudioDraftCollaborationPromotionRequest({
        identity: identity(),
        room: room(),
        actorAuthScopeKey: "account-a",
        targetWorkId: "saved-work-1",
        expectedWorkRevision: 9,
        finalStatus: "hidden" as never,
        now: NOW + 1,
      })
    ).toThrow("승격할 수 없습니다");
    expect(() =>
      createStudioDraftCollaborationPromotionRequest({
        identity: identity(),
        room: room(),
        actorAuthScopeKey: "account-a",
        targetWorkId: "different-work",
        expectedWorkRevision: 9,
        finalStatus: "published",
        now: NOW + 1,
      })
    ).toThrow("승격할 수 없습니다");
  });
});
