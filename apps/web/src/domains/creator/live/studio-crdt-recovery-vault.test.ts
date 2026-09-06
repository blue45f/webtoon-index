import { describe, expect, it } from "vitest";

import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  encodeStudioCrdtUpdate,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  PersistentStudioCrdtRecoveryVault,
  createStudioCrdtRecoveryBundle,
  selectStudioCrdtRecoveryEntriesForDownload,
  studioCrdtRecoveryBundleFileName,
  type StudioCrdtRecoveryVaultPersistence,
} from "./studio-crdt-recovery-vault";

class MemoryPersistence implements StudioCrdtRecoveryVaultPersistence {
  readonly rows = new Map<string, unknown>();

  async list(scope: string, workId: string): Promise<unknown[]> {
    return [...this.rows.values()].filter((value) => {
      if (!value || typeof value !== "object") return false;
      const row = value as { scope?: unknown; workId?: unknown };
      return row.scope === scope && row.workId === workId;
    });
  }

  async get(_scope: string, _workId: string, key: string): Promise<unknown | null> {
    return this.rows.get(key) ?? null;
  }

  async put(entry: { key: string }): Promise<void> {
    this.rows.set(entry.key, structuredClone(entry));
  }
}

function request(updateId: string, workId = "work-a"): StudioCrdtUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId,
    updateId,
    clientSequence: 1,
    update: encodeStudioCrdtUpdate(new Uint8Array([1, 2, 3, 4])),
  };
}

describe("Studio CRDT recovery vault", () => {
  it("durably separates a rejected frontier and deduplicates the rejected update id", async () => {
    const persistence = new MemoryPersistence();
    const vault = new PersistentStudioCrdtRecoveryVault(
      persistence,
      () => 1_000,
      () => "vault-a"
    );
    const input = {
      scope: "user-a",
      workId: "work-a",
      failureCode: "invalid_payload",
      failureMessage: "server rejected update",
      rejectedUpdateId: "11111111-1111-4111-8111-111111111111",
      updates: [request("11111111-1111-4111-8111-111111111111")],
    } as const;

    const first = await vault.preserve(input);
    const duplicate = await vault.preserve(input);

    expect(duplicate.vaultId).toBe(first.vaultId);
    expect(persistence.rows.size).toBe(2);
    expect(await vault.list("user-a", "work-a")).toEqual([
      expect.objectContaining({
        vaultId: "vault-a",
        status: "pending-export",
        failureCode: "invalid_payload",
        exportedAt: null,
      }),
    ]);
  });

  it("keeps exported frontiers in the vault as a non-retrying recovery source", async () => {
    let now = 2_000;
    const vault = new PersistentStudioCrdtRecoveryVault(
      new MemoryPersistence(),
      () => now,
      () => "vault-b"
    );
    await vault.preserve({
      scope: "user-b",
      workId: "work-b",
      failureCode: "forbidden",
      failureMessage: "role changed",
      rejectedUpdateId: "22222222-2222-4222-8222-222222222222",
      updates: [request("22222222-2222-4222-8222-222222222222", "work-b")],
    });
    now = 3_000;

    await vault.markExported("user-b", "work-b", "vault-b");

    expect(await vault.list("user-b", "work-b")).toEqual([
      expect.objectContaining({
        status: "exported",
        exportedAt: 3_000,
        updates: [expect.objectContaining({ workId: "work-b" })],
      }),
    ]);
  });

  it("keeps an already exported recovery archive downloadable", async () => {
    const vault = new PersistentStudioCrdtRecoveryVault(
      new MemoryPersistence(),
      () => 3_250,
      () => "vault-redownload"
    );
    await vault.preserve({
      scope: "user-redownload",
      workId: "work-redownload",
      failureCode: "forbidden",
      failureMessage: "role changed",
      rejectedUpdateId: "99999999-9999-4999-8999-999999999999",
      updates: [request(
        "99999999-9999-4999-8999-999999999999",
        "work-redownload"
      )],
    });
    await vault.markExported("user-redownload", "work-redownload", "vault-redownload");

    const selected = selectStudioCrdtRecoveryEntriesForDownload(
      await vault.list("user-redownload", "work-redownload")
    );

    expect(selected).toEqual([
      expect.objectContaining({
        vaultId: "vault-redownload",
        status: "exported",
      }),
    ]);
  });

  it("includes exported and pending frontiers together after a partial export-status failure", () => {
    const exported = {
      vaultId: "vault-exported",
      scope: "user-partial",
      workId: "work-partial",
      status: "exported" as const,
      failureCode: "invalid_payload",
      failureMessage: "first",
      rejectedUpdateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      updates: [request("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "work-partial")],
      createdAt: 1,
      exportedAt: 2,
    };
    const pending = {
      ...exported,
      vaultId: "vault-pending",
      status: "pending-export" as const,
      failureMessage: "second",
      rejectedUpdateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      updates: [request("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "work-partial")],
      createdAt: 3,
      exportedAt: null,
    };

    expect(
      selectStudioCrdtRecoveryEntriesForDownload([exported, pending]).map(
        ({ vaultId }) => vaultId
      )
    ).toEqual(["vault-exported", "vault-pending"]);
  });

  it("fails closed instead of silently forgetting a corrupted scoped recovery boundary", async () => {
    const persistence = new MemoryPersistence();
    persistence.rows.set("corrupt", {
      key: "corrupt",
      scope: "user-corrupt",
      workId: "work-corrupt",
      status: "pending-export",
      updates: [],
    });
    const vault = new PersistentStudioCrdtRecoveryVault(persistence);

    await expect(vault.list("user-corrupt", "work-corrupt")).rejects.toThrow(
      "손상된 frontier"
    );
  });

  it("preserves a frontier larger than 4096 updates as bounded chunks behind a manifest", async () => {
    const persistence = new MemoryPersistence();
    const vault = new PersistentStudioCrdtRecoveryVault(
      persistence,
      () => 3_500,
      () => "vault-large"
    );
    const updates = Array.from({ length: 4_097 }, (_, index) => request(
      `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
      "work-large"
    ));

    const preserved = await vault.preserve({
      scope: "user-large",
      workId: "work-large",
      failureCode: "invalid_payload",
      failureMessage: "large rejected frontier",
      rejectedUpdateId: updates[0]!.updateId,
      updates,
    });

    expect(preserved.updates).toHaveLength(4_097);
    expect(persistence.rows.size).toBeGreaterThan(2);
    await expect(vault.list("user-large", "work-large")).resolves.toEqual([
      expect.objectContaining({
        vaultId: "vault-large",
        updates: expect.arrayContaining([
          expect.objectContaining({ updateId: updates.at(-1)!.updateId }),
        ]),
      }),
    ]);
    expect((await vault.list("user-large", "work-large"))[0]?.updates).toHaveLength(4_097);
  });

  it("keeps a durable rejection marker when the larger frontier transaction fails", async () => {
    class MarkerOnlyPersistence extends MemoryPersistence {
      override async put(entry: { key: string; kind?: string }): Promise<void> {
        if (entry.kind === "frontier-chunk") throw new Error("frontier quota exceeded");
        await super.put(entry);
      }
    }
    const persistence = new MarkerOnlyPersistence();
    const vault = new PersistentStudioCrdtRecoveryVault(
      persistence,
      () => 3_750,
      () => "vault-marker-only"
    );
    const rejected = request("88888888-8888-4888-8888-888888888888", "work-marker");

    await vault.preserveRejectionMarker({
      scope: "user-marker",
      workId: "work-marker",
      failureCode: "invalid_payload",
      failureMessage: "rejected",
      rejectedUpdateId: rejected.updateId,
      recoveryUpdateCount: 1,
    });
    await expect(vault.preserve({
      scope: "user-marker",
      workId: "work-marker",
      failureCode: "invalid_payload",
      failureMessage: "rejected",
      rejectedUpdateId: rejected.updateId,
      updates: [rejected],
    })).rejects.toThrow("frontier quota exceeded");

    await expect(vault.listRejectionMarkers("user-marker", "work-marker")).resolves.toEqual([
      expect.objectContaining({
        rejectedUpdateId: rejected.updateId,
        recoveryUpdateCount: 1,
      }),
    ]);
  });

  it("builds a portable bundle without leaking the authenticated outbox scope", async () => {
    const vault = new PersistentStudioCrdtRecoveryVault(
      new MemoryPersistence(),
      () => 4_000,
      () => "vault-c"
    );
    await vault.preserve({
      scope: "private-user-id",
      workId: "work-c",
      failureCode: "invalid_payload",
      failureMessage: "payload rejected",
      rejectedUpdateId: "33333333-3333-4333-8333-333333333333",
      updates: [request("33333333-3333-4333-8333-333333333333", "work-c")],
    });
    const entries = await vault.list("private-user-id", "work-c");

    const bundle = createStudioCrdtRecoveryBundle(entries, 5_000);
    const serialized = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      format: "toonspectrum-crdt-recovery",
      version: 1,
      workId: "work-c",
      frontiers: [{ vaultId: "vault-c" }],
    });
    expect(serialized).not.toContain("private-user-id");
    expect(studioCrdtRecoveryBundleFileName("work/c", 5_000)).toMatch(
      /^toonspectrum-work-c-crdt-recovery-/
    );
  });
});
