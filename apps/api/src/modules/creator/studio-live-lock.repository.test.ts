import { readFileSync } from "node:fs";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseStudioLiveLockResourceScope,
  studioLiveLockResourcesConflict,
} from "../../../../web/src/shared/lib/studio-live-lock-resource";
import { db } from "../../db";
import {
  creatorWorkLiveLockClocks,
  creatorWorkLiveLocks,
  toonspectrumSchemaMigrations,
} from "../../db/schema";

import {
  createStudioLiveLockAcquisitionId,
  DrizzleStudioLiveLockRepository,
  STUDIO_LIVE_LOCK_ADVISORY_NAMESPACE,
  STUDIO_LIVE_LOCK_LIMIT_PER_WORK,
  STUDIO_LIVE_LOCK_REPOSITORY,
  studioLiveLockRepositoryProvider,
  studioLiveLockRequestIdFromAcquisitionId,
  studioLiveLockWorkAdvisoryQuery,
  withStudioLiveLockWorkMutation,
} from "./studio-live-lock.repository";

function names(values: readonly { name?: string; config?: { name?: string } }[]): string[] {
  return values
    .flatMap((value) => {
      const name = value.name ?? value.config?.name;
      return name ? [name] : [];
    })
    .sort();
}

interface FakeLockRow {
  workId: string;
  resourceId: string;
  leaseId: string;
  acquisitionId: string;
  ownerConnectionId: string;
  ownerName: string;
  revision: bigint;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RenderedLockCondition {
  sql: string;
  params: unknown[];
}

interface LockPersistenceHarnessState {
  row: FakeLockRow | null;
  readonly revisions: Map<string, bigint>;
  readonly updateSets: Array<Record<string, unknown>>;
  readonly updateConditions: RenderedLockCondition[];
  readonly releaseConditions: RenderedLockCondition[];
}

function renderLockCondition(value: unknown): RenderedLockCondition {
  const rendered = new PgDialect().sqlToQuery(value as never);
  return { sql: rendered.sql, params: [...rendered.params] };
}

function matchesCurrentFence(row: FakeLockRow, condition: RenderedLockCondition): boolean {
  return (condition.params.length === 4 || condition.params.length === 5) &&
    condition.params[0] === row.workId &&
    condition.params[1] === row.resourceId &&
    condition.params[2] === row.ownerConnectionId &&
    condition.params[3] === row.leaseId &&
    (condition.params.length === 4 || condition.params[4] === row.acquisitionId);
}

class FakeLockSelectQuery implements PromiseLike<FakeLockRow[]> {
  constructor(private readonly state: LockPersistenceHarnessState) {}

  from(..._arguments: unknown[]): this {
    return this;
  }

  where(..._arguments: unknown[]): this {
    return this;
  }

  orderBy(..._arguments: unknown[]): this {
    return this;
  }

  limit(..._arguments: unknown[]): this {
    return this;
  }

  then<TResult1 = FakeLockRow[], TResult2 = never>(
    onfulfilled?: ((value: FakeLockRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const rows = this.state.row ? [{ ...this.state.row }] : [];
    return Promise.resolve(rows).then(onfulfilled, onrejected);
  }
}

class FakeLockInsertQuery {
  private stored: FakeLockRow | null = null;

  constructor(private readonly state: LockPersistenceHarnessState) {}

  values(value: Record<string, unknown>): this {
    const now = new Date("2026-07-20T00:00:00.000Z");
    this.stored = {
      workId: String(value.workId),
      resourceId: String(value.resourceId),
      leaseId: String(value.leaseId),
      acquisitionId: String(value.acquisitionId),
      ownerConnectionId: String(value.ownerConnectionId),
      ownerName: String(value.ownerName),
      revision: typeof value.revision === "bigint" ? value.revision : 1n,
      expiresAt: new Date("2026-07-20T00:01:00.000Z"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.row = this.stored;
    return this;
  }

  returning(): Promise<FakeLockRow[]> {
    return Promise.resolve(this.stored ? [{ ...this.stored }] : []);
  }
}

class FakeLockClockInsertQuery {
  private workId = "";

  constructor(private readonly state: LockPersistenceHarnessState) {}

  values(value: Record<string, unknown>): this {
    this.workId = String(value.workId);
    return this;
  }

  onConflictDoUpdate(..._arguments: unknown[]): this {
    return this;
  }

  returning(..._arguments: unknown[]): Promise<Array<{ revision: bigint }>> {
    const revision = (this.state.revisions.get(this.workId) ?? 0n) + 1n;
    this.state.revisions.set(this.workId, revision);
    return Promise.resolve([{ revision }]);
  }
}

class FakeLockUpdateQuery {
  private patch: Record<string, unknown> = {};
  private condition: RenderedLockCondition | null = null;

  constructor(private readonly state: LockPersistenceHarnessState) {}

  set(value: Record<string, unknown>): this {
    this.patch = value;
    this.state.updateSets.push({ ...value });
    return this;
  }

  where(value: unknown): this {
    this.condition = renderLockCondition(value);
    this.state.updateConditions.push(this.condition);
    return this;
  }

  returning(): Promise<FakeLockRow[]> {
    const current = this.state.row;
    if (!current || !this.condition || !matchesCurrentFence(current, this.condition)) {
      return Promise.resolve([]);
    }
    const next: FakeLockRow = {
      ...current,
      ...(typeof this.patch.leaseId === "string" ? { leaseId: this.patch.leaseId } : {}),
      ...(typeof this.patch.acquisitionId === "string"
        ? { acquisitionId: this.patch.acquisitionId }
        : {}),
      ...(typeof this.patch.ownerName === "string" ? { ownerName: this.patch.ownerName } : {}),
      ...(typeof this.patch.revision === "bigint" ? { revision: this.patch.revision } : {}),
      expiresAt: new Date("2026-07-20T00:01:00.000Z"),
      updatedAt: new Date("2026-07-20T00:00:01.000Z"),
    };
    this.state.row = next;
    return Promise.resolve([{ ...next }]);
  }
}

class FakeLockDeleteQuery implements PromiseLike<unknown[]> {
  private condition: RenderedLockCondition | null = null;

  constructor(private readonly state: LockPersistenceHarnessState) {}

  where(value: unknown): this {
    this.condition = renderLockCondition(value);
    return this;
  }

  returning(): Promise<FakeLockRow[]> {
    if (!this.condition) return Promise.resolve([]);
    if (this.condition.params.length === 4 || this.condition.params.length === 5) {
      this.state.releaseConditions.push(this.condition);
    }
    const current = this.state.row;
    if (!current || !matchesCurrentFence(current, this.condition)) return Promise.resolve([]);
    this.state.row = null;
    return Promise.resolve([{ ...current }]);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    // acquire() first purges expired rows. The harness keeps its row unexpired and records only
    // explicit release predicates, which are the delete queries that call returning().
    return Promise.resolve([]).then(onfulfilled, onrejected);
  }
}

function createLockPersistenceHarness() {
  const state: LockPersistenceHarnessState = {
    row: null,
    revisions: new Map(),
    updateSets: [],
    updateConditions: [],
    releaseConditions: [],
  };
  const transaction = {
    execute: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(() => new FakeLockDeleteQuery(state)),
    select: vi.fn(() => new FakeLockSelectQuery(state)),
    insert: vi.fn((table: unknown) =>
      table === creatorWorkLiveLockClocks
        ? new FakeLockClockInsertQuery(state)
        : new FakeLockInsertQuery(state)
    ),
    update: vi.fn(() => new FakeLockUpdateQuery(state)),
  };
  return { state, transaction };
}

describe("studio live distributed lock persistence contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ships a ledger-fenced, fail-closed revision cutover migration", () => {
    const migration = readFileSync(
      new URL(
        "../../db/migrations/0017_creator_work_live_lock_revision.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "toonspectrum_schema_migration"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "creator_work_live_lock_clock"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "revision" bigint');
    expect(migration).toContain("IN ACCESS EXCLUSIVE MODE");
    expect(migration).toContain("GREATEST(");
    expect(migration).toContain('ALTER COLUMN "revision" DROP DEFAULT');
    expect(migration).toContain('ALTER COLUMN "revision" SET NOT NULL');
    expect(migration).toContain(
      "WHERE \"id\" = '0017_creator_work_live_lock_revision'"
    );
    expect(migration).toContain(
      'INSERT INTO "toonspectrum_schema_migration" ("id", "appliedAt")'
    );
    expect(migration).toContain("ToonSpectrum live-lock revision v1 cutover complete");
    expect(migration).toMatch(
      /DELETE FROM "creator_work_live_lock"\s+WHERE \(SELECT "required"/u
    );
  });

  it("keeps request correlation while fencing repeated request ids with a private nonce", () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const first = createStudioLiveLockAcquisitionId(
      requestId,
      "00000000-0000-4000-8000-000000000101"
    );
    const second = createStudioLiveLockAcquisitionId(
      requestId,
      "00000000-0000-4000-8000-000000000102"
    );

    expect(first).not.toBe(second);
    expect(first).toHaveLength(73);
    expect(studioLiveLockRequestIdFromAcquisitionId(first)).toBe(requestId);
    expect(studioLiveLockRequestIdFromAcquisitionId("legacy-acquisition-id")).toBe(
      "legacy-acquisition-id"
    );
  });

  it("parses canonical page/layer/element scopes and leaves legacy resources opaque", () => {
    expect(parseStudioLiveLockResourceScope("page:page-1")).toEqual({
      kind: "page",
      pageId: "page-1",
    });
    expect(parseStudioLiveLockResourceScope("layer:page-1:cell:shade")).toEqual({
      kind: "layer",
      pageId: "page-1",
      layerId: "cell:shade",
    });
    expect(parseStudioLiveLockResourceScope("element:page-1:panel:ink")).toEqual({
      kind: "element",
      pageId: "page-1",
      elementId: "panel:ink",
    });
    expect(parseStudioLiveLockResourceScope("element:legacy-panel")).toBeNull();
    expect(parseStudioLiveLockResourceScope("layer:page-1:")).toBeNull();
    expect(parseStudioLiveLockResourceScope("layer:legacy-cell")).toBeNull();
    expect(parseStudioLiveLockResourceScope("page:")).toBeNull();
  });

  it("conflicts page ancestors with children but permits sibling and legacy independence", () => {
    expect(studioLiveLockResourcesConflict("page:page-1", "element:page-1:panel-1")).toBe(true);
    expect(studioLiveLockResourcesConflict("element:page-1:panel-1", "page:page-1")).toBe(true);
    expect(
      studioLiveLockResourcesConflict("element:page-1:panel-1", "element:page-1:panel-2")
    ).toBe(false);
    expect(studioLiveLockResourcesConflict("page:page-1", "element:page-2:panel-1")).toBe(false);
    expect(studioLiveLockResourcesConflict("legacy:panel-1", "legacy:panel-1")).toBe(true);
    expect(studioLiveLockResourcesConflict("legacy:panel-1", "legacy:panel-2")).toBe(false);
  });

  it("enforces the client layer conflict table: page covers layers, siblings stay free", () => {
    // Page ↔ layer, both directions.
    expect(studioLiveLockResourcesConflict("page:page-1", "layer:page-1:cell-1")).toBe(true);
    expect(studioLiveLockResourcesConflict("layer:page-1:cell-1", "page:page-1")).toBe(true);
    expect(studioLiveLockResourcesConflict("layer:page-1:cell-1", "page:page-2")).toBe(false);
    // Layer ↔ layer: exact match only.
    expect(studioLiveLockResourcesConflict("layer:page-1:cell-1", "layer:page-1:cell-1")).toBe(
      true
    );
    expect(studioLiveLockResourcesConflict("layer:page-1:cell-1", "layer:page-1:cell-2")).toBe(
      false
    );
    expect(studioLiveLockResourcesConflict("layer:page-1:cell-1", "layer:page-2:cell-1")).toBe(
      false
    );
    // Layer ↔ element: never at the grammar level (element ids do not encode their layer);
    // clients that need the exclusion claim the containing layer resource alongside elements.
    expect(
      studioLiveLockResourcesConflict("layer:page-1:cell-1", "element:page-1:panel-1")
    ).toBe(false);
    expect(
      studioLiveLockResourcesConflict("element:page-1:panel-1", "layer:page-1:cell-1")
    ).toBe(false);
    // Malformed/legacy layer shapes keep exact-match semantics.
    expect(studioLiveLockResourcesConflict("layer:page-1:", "layer:page-1:")).toBe(true);
    expect(studioLiveLockResourcesConflict("page:page-1", "layer:page-1:")).toBe(false);
  });

  it("denies a cross-connection layer acquire under a page lease but admits siblings", async () => {
    const { transaction } = createLockPersistenceHarness();
    vi.spyOn(db, "transaction").mockImplementation(
      ((callback: (value: object) => Promise<unknown>) => callback(transaction)) as never
    );
    const repository = new DrizzleStudioLiveLockRepository();
    const base = {
      workId: "work-layer",
      ownerName: "서윤",
      leaseMs: 15_000,
      rotateLease: true,
    };

    await expect(repository.acquire({
      ...base,
      resourceId: "page:page-1",
      ownerConnectionId: "socket-page",
      requestedLeaseId: "lease-page",
      acquisitionId: "request-page.nonce-page",
    })).resolves.toMatchObject({ status: "acquired", created: true });
    // The authoritative server now applies the same page-over-layer coverage as the client guard.
    await expect(repository.acquire({
      ...base,
      resourceId: "layer:page-1:cell-1",
      ownerConnectionId: "socket-layer",
      requestedLeaseId: "lease-layer",
      acquisitionId: "request-layer.nonce-layer",
    })).resolves.toMatchObject({
      status: "conflict",
      lock: { resourceId: "page:page-1", ownerConnectionId: "socket-page" },
    });
    await expect(repository.release({
      workId: base.workId,
      resourceId: "page:page-1",
      ownerConnectionId: "socket-page",
      leaseId: "lease-page",
    })).resolves.toMatchObject({ resourceId: "page:page-1" });

    // Sibling layers on the same page stay independently claimable across connections.
    await expect(repository.acquire({
      ...base,
      resourceId: "layer:page-1:cell-1",
      ownerConnectionId: "socket-layer",
      requestedLeaseId: "lease-layer",
      acquisitionId: "request-layer.nonce-layer",
    })).resolves.toMatchObject({ status: "acquired", created: true });
    await expect(repository.acquire({
      ...base,
      resourceId: "layer:page-1:cell-2",
      ownerConnectionId: "socket-sibling",
      requestedLeaseId: "lease-sibling",
      acquisitionId: "request-sibling.nonce-sibling",
    })).resolves.toMatchObject({ status: "acquired", created: true });
    // A layer seat also fences a later whole-page acquire by another connection.
    await expect(repository.acquire({
      ...base,
      resourceId: "page:page-1",
      ownerConnectionId: "socket-page",
      requestedLeaseId: "lease-page-again",
      acquisitionId: "request-page-again.nonce-page-again",
    })).resolves.toMatchObject({
      status: "conflict",
      lock: { resourceId: "layer:page-1:cell-2" },
    });
  });

  it("defines one bounded lease row per work/resource with cascade cleanup", () => {
    const table = getTableConfig(creatorWorkLiveLocks);

    expect(table.name).toBe("creator_work_live_lock");
    expect(table.primaryKeys.map((key) => key.getName())).toEqual([
      "creator_work_live_lock_pkey",
    ]);
    expect(table.foreignKeys.map((key) => key.getName())).toEqual([
      "creator_work_live_lock_work_fkey",
    ]);
    expect(names(table.indexes)).toEqual(["idx_creator_work_live_lock_expiry"]);
    expect(names(table.checks)).toEqual([
      "creator_work_live_lock_acquisition_id_check",
      "creator_work_live_lock_connection_id_check",
      "creator_work_live_lock_expiry_order_check",
      "creator_work_live_lock_lease_id_check",
      "creator_work_live_lock_owner_name_check",
      "creator_work_live_lock_resource_id_check",
      "creator_work_live_lock_revision_check",
    ]);
    expect(table.columns.find((column) => column.name === "acquisitionId")?.notNull).toBe(true);
    expect(table.columns.find((column) => column.name === "revision")?.notNull).toBe(true);
    expect(STUDIO_LIVE_LOCK_LIMIT_PER_WORK).toBe(200);
  });

  it("defines a durable schema-cutover ledger instead of using comments as state", () => {
    const table = getTableConfig(toonspectrumSchemaMigrations);

    expect(table.name).toBe("toonspectrum_schema_migration");
    expect(table.columns.find((column) => column.name === "id")?.primary).toBe(true);
    expect(names(table.checks)).toEqual([
      "toonspectrum_schema_migration_id_check",
    ]);
    expect(table.columns.find((column) => column.name === "id")?.notNull).toBe(true);
    expect(table.columns.find((column) => column.name === "appliedAt")?.notNull).toBe(true);
  });

  it("uses an isolated, stable per-work PostgreSQL advisory-lock namespace", () => {
    const rendered = new PgDialect().sqlToQuery(
      studioLiveLockWorkAdvisoryQuery("work-1")
    );

    expect(rendered.sql).toBe(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))"
    );
    expect(rendered.params).toEqual([
      `${STUDIO_LIVE_LOCK_ADVISORY_NAMESPACE}work-1`,
    ]);
  });

  it("rotates a v2 fence with an old-fence update predicate and releases only the exact fence", async () => {
    const { state, transaction } = createLockPersistenceHarness();
    vi.spyOn(db, "transaction").mockImplementation(
      ((callback: (value: object) => Promise<unknown>) => callback(transaction)) as never
    );
    const repository = new DrizzleStudioLiveLockRepository();
    const base = {
      workId: "work-1",
      resourceId: "page:page-1",
      ownerConnectionId: "socket-1",
      ownerName: "서윤",
      leaseMs: 15_000,
      rotateLease: true,
    };

    await expect(repository.acquire({
      ...base,
      requestedLeaseId: "lease-1",
      acquisitionId: "request-1.nonce-1",
    })).resolves.toMatchObject({
      status: "acquired",
      created: true,
      lock: { leaseId: "lease-1" },
    });
    await expect(repository.acquire({
      ...base,
      requestedLeaseId: "lease-2",
      renewLeaseId: "lease-1",
      acquisitionId: "request-2.nonce-2",
    })).resolves.toMatchObject({
      status: "acquired",
      created: false,
      lock: { leaseId: "lease-2" },
    });

    expect(state.updateSets).toHaveLength(1);
    expect(state.updateSets[0]).toMatchObject({
      leaseId: "lease-2",
      acquisitionId: "request-2.nonce-2",
    });
    expect(state.updateConditions).toHaveLength(1);
    expect(state.updateConditions[0]?.sql).toContain('"leaseId" = $4');
    expect(state.updateConditions[0]?.params).toEqual([
      "work-1",
      "page:page-1",
      "socket-1",
      "lease-1",
    ]);

    await expect(repository.acquire({
      ...base,
      requestedLeaseId: "lease-3",
      renewLeaseId: "lease-1",
      acquisitionId: "request-3.nonce-3",
    })).resolves.toMatchObject({
      status: "stale",
      lock: { leaseId: "lease-2" },
    });
    expect(state.updateSets).toHaveLength(1);
    expect(state.row?.leaseId).toBe("lease-2");

    await expect(repository.release({
      workId: "work-1",
      resourceId: "page:page-1",
      ownerConnectionId: "socket-1",
      leaseId: "lease-1",
    })).resolves.toBeNull();
    expect(state.row?.leaseId).toBe("lease-2");

    await expect(repository.release({
      workId: "work-1",
      resourceId: "page:page-1",
      ownerConnectionId: "socket-1",
      leaseId: "lease-2",
    })).resolves.toMatchObject({ leaseId: "lease-2" });
    expect(state.row).toBeNull();
    expect(state.releaseConditions.map((condition) => condition.params)).toEqual([
      ["work-1", "page:page-1", "socket-1", "lease-1"],
      ["work-1", "page:page-1", "socket-1", "lease-2"],
    ]);
    for (const condition of state.releaseConditions) {
      expect(condition.sql).toContain('"leaseId" = $4');
    }
  });

  it("classifies a renewal against a replacement owner as stale before ordinary conflict", async () => {
    const { state, transaction } = createLockPersistenceHarness();
    vi.spyOn(db, "transaction").mockImplementation(
      ((callback: (value: object) => Promise<unknown>) => callback(transaction)) as never
    );
    const repository = new DrizzleStudioLiveLockRepository();
    const resource = {
      workId: "work-owner-change",
      resourceId: "page:owner-change",
      ownerName: "서윤",
      leaseMs: 15_000,
      rotateLease: true,
    };

    await repository.acquire({
      ...resource,
      ownerConnectionId: "socket-old",
      requestedLeaseId: "lease-old",
      acquisitionId: "request-old.nonce-old",
    });
    await repository.release({
      workId: resource.workId,
      resourceId: resource.resourceId,
      ownerConnectionId: "socket-old",
      leaseId: "lease-old",
    });
    await repository.acquire({
      ...resource,
      ownerConnectionId: "socket-new",
      requestedLeaseId: "lease-new",
      acquisitionId: "request-new.nonce-new",
    });

    await expect(repository.acquire({
      ...resource,
      ownerConnectionId: "socket-old",
      requestedLeaseId: "lease-must-not-store",
      renewLeaseId: "lease-old",
      acquisitionId: "request-late.nonce-late",
    })).resolves.toMatchObject({
      status: "stale",
      lock: {
        ownerConnectionId: "socket-new",
        leaseId: "lease-new",
      },
    });
    expect(state.row).toMatchObject({
      ownerConnectionId: "socket-new",
      leaseId: "lease-new",
      acquisitionId: "request-new.nonce-new",
    });
    expect(state.updateSets).toHaveLength(0);
  });

  it("returns stale when an expiry sweep removes the observed row before the fenced update", async () => {
    const { state, transaction } = createLockPersistenceHarness();
    vi.spyOn(db, "transaction").mockImplementation(
      ((callback: (value: object) => Promise<unknown>) => callback(transaction)) as never
    );
    const repository = new DrizzleStudioLiveLockRepository();
    const base = {
      workId: "work-expiry-race",
      resourceId: "page:expiry-race",
      ownerConnectionId: "socket-expiry-race",
      ownerName: "서윤",
      leaseMs: 15_000,
      rotateLease: true,
    };

    await repository.acquire({
      ...base,
      requestedLeaseId: "lease-before-expiry",
      acquisitionId: "request-before.nonce-before",
    });
    transaction.update.mockImplementationOnce(() => {
      state.row = null;
      return new FakeLockUpdateQuery(state);
    });

    await expect(repository.acquire({
      ...base,
      requestedLeaseId: "lease-after-expiry",
      renewLeaseId: "lease-before-expiry",
      acquisitionId: "request-after.nonce-after",
    })).resolves.toEqual({ status: "stale" });
    expect(state.row).toBeNull();
    expect(state.updateConditions[0]?.params).toEqual([
      base.workId,
      base.resourceId,
      base.ownerConnectionId,
      "lease-before-expiry",
    ]);
  });

  it("fences authorization rollback by acquisition id and rejects a release-first renewal", async () => {
    const { state, transaction } = createLockPersistenceHarness();
    vi.spyOn(db, "transaction").mockImplementation(
      ((callback: (value: object) => Promise<unknown>) => callback(transaction)) as never
    );
    const repository = new DrizzleStudioLiveLockRepository();
    const base = {
      workId: "work-rollback",
      resourceId: "page:page-rollback",
      ownerConnectionId: "socket-rollback",
      ownerName: "서윤",
      leaseMs: 15_000,
    };

    await repository.acquire({
      ...base,
      rotateLease: true,
      requestedLeaseId: "lease-stable",
      acquisitionId: "request-old.nonce-old",
    });
    await repository.acquire({
      ...base,
      rotateLease: false,
      requestedLeaseId: "unused-legacy-fence",
      renewLeaseId: "lease-stable",
      acquisitionId: "request-new.nonce-new",
    });
    expect(state.row).toMatchObject({
      leaseId: "lease-stable",
      acquisitionId: "request-new.nonce-new",
    });

    await expect(repository.rollbackAcquire({
      workId: base.workId,
      resourceId: base.resourceId,
      ownerConnectionId: base.ownerConnectionId,
      leaseId: "lease-stable",
      acquisitionId: "request-old.nonce-old",
    })).resolves.toBeNull();
    expect(state.row).toMatchObject({ acquisitionId: "request-new.nonce-new" });
    await expect(repository.rollbackAcquire({
      workId: base.workId,
      resourceId: base.resourceId,
      ownerConnectionId: base.ownerConnectionId,
      leaseId: "lease-stable",
      acquisitionId: "request-new.nonce-new",
    })).resolves.toMatchObject({ acquisitionId: "request-new.nonce-new" });
    expect(state.row).toBeNull();
    expect(state.releaseConditions.slice(-2).map((condition) => condition.params)).toEqual([
      [
        base.workId,
        base.resourceId,
        base.ownerConnectionId,
        "lease-stable",
        "request-old.nonce-old",
      ],
      [
        base.workId,
        base.resourceId,
        base.ownerConnectionId,
        "lease-stable",
        "request-new.nonce-new",
      ],
    ]);

    await repository.acquire({
      ...base,
      rotateLease: true,
      requestedLeaseId: "lease-release-first",
      acquisitionId: "request-release.nonce-release",
    });
    await repository.release({
      workId: base.workId,
      resourceId: base.resourceId,
      ownerConnectionId: base.ownerConnectionId,
      leaseId: "lease-release-first",
    });
    await expect(repository.acquire({
      ...base,
      rotateLease: true,
      requestedLeaseId: "lease-must-not-resurrect",
      renewLeaseId: "lease-release-first",
      acquisitionId: "request-late.nonce-late",
    })).resolves.toEqual({ status: "stale" });
    expect(state.row).toBeNull();
  });

  it("exposes a swappable repository provider", () => {
    expect(studioLiveLockRepositoryProvider.provide).toBe(
      STUDIO_LIVE_LOCK_REPOSITORY
    );
    expect(studioLiveLockRepositoryProvider.useFactory()).toBeInstanceOf(
      DrizzleStudioLiveLockRepository
    );
  });

  it("does not enter two same-work mutation sections concurrently", async () => {
    let releaseFirst: (() => void) | null = null;
    let secondEntered = false;
    const firstLock = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let held = false;
    const waiters: Array<() => void> = [];
    const transaction = {
      async execute() {
        if (!held) {
          held = true;
          return;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      },
    };
    const release = () => {
      const next = waiters.shift();
      if (next) next();
      else held = false;
    };

    const first = (async () => {
      try {
        await withStudioLiveLockWorkMutation(transaction as never, "work-1", async () => {
          await firstLock;
        });
      } finally {
        release();
      }
    })();
    await Promise.resolve();
    const second = (async () => {
      try {
        await withStudioLiveLockWorkMutation(transaction as never, "work-1", async () => {
          secondEntered = true;
        });
      } finally {
        release();
      }
    })();
    await Promise.resolve();

    expect(secondEntered).toBe(false);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
  });
});
