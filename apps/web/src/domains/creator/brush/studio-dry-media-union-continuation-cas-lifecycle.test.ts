import { describe, expect, it } from "vitest";

import {
  createStudioDryMediaUnionCasLifecycle,
  type StudioDryMediaUnionCasBlobReference,
  type StudioDryMediaUnionCasLifecyclePersistence,
  type StudioDryMediaUnionCasLifecyclePublication,
  type StudioDryMediaUnionCasLifecycleTransaction,
} from "./studio-dry-media-union-continuation-cas-lifecycle";

function digest(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function reference(
  index: number,
  kind: StudioDryMediaUnionCasBlobReference["kind"] = "page",
): StudioDryMediaUnionCasBlobReference {
  return Object.freeze({ kind, digest: digest(index), byteLength: index + 1 });
}

class MemoryLifecyclePersistence implements StudioDryMediaUnionCasLifecyclePersistence {
  transaction: StudioDryMediaUnionCasLifecycleTransaction | null = null;
  readonly pending: StudioDryMediaUnionCasBlobReference[] = [];
  readonly publications = new Map<string, StudioDryMediaUnionCasLifecyclePublication>();
  readonly memberships = new Map<string, readonly string[]>();
  readonly blobs = new Set<string>();
  readonly events: string[] = [];
  failNext: string | null = null;

  key(referenceValue: StudioDryMediaUnionCasBlobReference): string {
    return `${referenceValue.kind}:${referenceValue.digest}`;
  }

  fail(operation: string): void {
    if (this.failNext !== operation) return;
    this.failNext = null;
    throw new Error(`injected-${operation}`);
  }

  async loadTransaction() {
    this.fail("load-transaction");
    return this.transaction ? structuredClone(this.transaction) : null;
  }

  async saveTransaction(value: StudioDryMediaUnionCasLifecycleTransaction) {
    this.fail("save-transaction");
    this.transaction = structuredClone(value);
    this.events.push(`transaction:${value.phase}:${value.cursor}`);
  }

  async deleteTransaction() {
    this.fail("delete-transaction");
    this.transaction = null;
    this.events.push("transaction:delete");
  }

  async appendPendingReference(value: StudioDryMediaUnionCasBlobReference) {
    this.fail("append-reference");
    this.pending.push(structuredClone(value));
  }

  async readPendingReferences() {
    this.fail("read-references");
    return structuredClone(this.pending);
  }

  async clearPendingReferences() {
    this.fail("clear-references");
    this.pending.splice(0);
    this.events.push("references:clear");
  }

  async loadPublication(rootDigest: string) {
    this.fail("load-publication");
    const value = this.publications.get(rootDigest);
    return value ? structuredClone(value) : null;
  }

  async savePublication(value: StudioDryMediaUnionCasLifecyclePublication) {
    this.fail("save-publication");
    this.publications.set(value.rootDigest, structuredClone(value));
    this.events.push(`publication:save:${value.rootDigest}`);
  }

  async deletePublication(rootDigest: string) {
    this.fail("delete-publication");
    this.publications.delete(rootDigest);
    this.events.push(`publication:delete:${rootDigest}`);
  }

  async loadMembership(value: StudioDryMediaUnionCasBlobReference) {
    this.fail("load-membership");
    return [...(this.memberships.get(this.key(value)) ?? [])];
  }

  async saveMembership(
    value: StudioDryMediaUnionCasBlobReference,
    roots: readonly string[],
  ) {
    this.fail("save-membership");
    this.memberships.set(this.key(value), [...roots]);
    this.events.push(`membership:save:${this.key(value)}:${roots.length}`);
  }

  async deleteMembership(value: StudioDryMediaUnionCasBlobReference) {
    this.fail("delete-membership");
    this.memberships.delete(this.key(value));
  }

  async deleteBlob(value: StudioDryMediaUnionCasBlobReference) {
    this.fail("delete-blob");
    this.blobs.delete(this.key(value));
    this.events.push(`blob:delete:${this.key(value)}`);
  }
}

async function stageRoot(
  lifecycle: ReturnType<typeof createStudioDryMediaUnionCasLifecycle>,
  persistence: MemoryLifecyclePersistence,
  references: readonly StudioDryMediaUnionCasBlobReference[],
): Promise<void> {
  for (const value of references) {
    await lifecycle.stageBlob(value);
    persistence.blobs.add(persistence.key(value));
  }
}

describe("dry-media continuation CAS lifecycle", () => {
  it("publishes the root marker last and never exposes a partial publication", async () => {
    const persistence = new MemoryLifecyclePersistence();
    const lifecycle = createStudioDryMediaUnionCasLifecycle(persistence);
    const page = reference(1);
    const root = reference(2, "root");
    await stageRoot(lifecycle, persistence, [page, root]);
    persistence.failNext = "save-publication";

    await expect(lifecycle.publishRoot(root.digest)).rejects.toThrow(
      "injected-save-publication",
    );
    await expect(lifecycle.isRootPublished(root.digest)).resolves.toBe(false);
    expect(persistence.transaction?.phase).toBe("publishing");
    expect(persistence.memberships.get(persistence.key(page))).toEqual([root.digest]);

    const recovered = createStudioDryMediaUnionCasLifecycle(persistence);
    await expect(recovered.reconcile(64)).resolves.toMatchObject({ complete: true });
    await expect(recovered.isRootPublished(root.digest)).resolves.toBe(true);
    const markerIndex = persistence.events.findIndex((event) => (
      event === `publication:save:${root.digest}`
    ));
    const lastMembershipIndex = persistence.events.reduce(
      (last, event, index) => event.startsWith("membership:save:") ? index : last,
      -1,
    );
    expect(markerIndex).toBeGreaterThan(lastMembershipIndex);
  });

  it("retains shared blobs until the final published root is released", async () => {
    const persistence = new MemoryLifecyclePersistence();
    const lifecycle = createStudioDryMediaUnionCasLifecycle(persistence);
    const shared = reference(10);
    const firstRoot = reference(11, "root");
    const secondRoot = reference(12, "root");
    await stageRoot(lifecycle, persistence, [shared, firstRoot]);
    await lifecycle.publishRoot(firstRoot.digest);
    await stageRoot(lifecycle, persistence, [shared, secondRoot]);
    await lifecycle.publishRoot(secondRoot.digest);
    expect(persistence.memberships.get(persistence.key(shared))).toEqual([
      firstRoot.digest,
      secondRoot.digest,
    ]);

    await expect(lifecycle.releaseRoot(firstRoot.digest)).resolves.toBe(true);
    expect(persistence.blobs.has(persistence.key(shared))).toBe(true);
    expect(persistence.memberships.get(persistence.key(shared))).toEqual([
      secondRoot.digest,
    ]);
    expect(persistence.publications.has(firstRoot.digest)).toBe(false);

    await expect(lifecycle.releaseRoot(secondRoot.digest)).resolves.toBe(true);
    expect(persistence.blobs.has(persistence.key(shared))).toBe(false);
    expect(persistence.memberships.has(persistence.key(shared))).toBe(false);
    expect(persistence.publications.has(secondRoot.digest)).toBe(false);
  });

  it("bounds startup rollback work and keeps one durable lane across repeated failure", async () => {
    const persistence = new MemoryLifecyclePersistence();
    const abandoned = createStudioDryMediaUnionCasLifecycle(persistence);
    const references = Array.from({ length: 130 }, (_, index) => reference(100 + index));
    await stageRoot(abandoned, persistence, references);
    expect(persistence.blobs.size).toBe(130);

    const firstRestart = createStudioDryMediaUnionCasLifecycle(persistence);
    await expect(firstRestart.reconcile(64)).resolves.toEqual({
      phase: "rollback",
      processedReferenceCount: 64,
      remainingReferenceCount: 66,
      complete: false,
    });
    expect(persistence.transaction).toMatchObject({ phase: "rollback", cursor: 64 });
    await expect(firstRestart.stageBlob(reference(999))).rejects.toThrow(
      "studio-dry-media-union-cas-lifecycle-busy",
    );
    expect(persistence.pending).toHaveLength(130);

    const secondRestart = createStudioDryMediaUnionCasLifecycle(persistence);
    await expect(secondRestart.reconcile(64)).resolves.toMatchObject({
      phase: "rollback",
      processedReferenceCount: 64,
      remainingReferenceCount: 2,
      complete: false,
    });
    await expect(secondRestart.reconcile(64)).resolves.toMatchObject({
      phase: "idle",
      processedReferenceCount: 2,
      complete: true,
    });
    expect(persistence.blobs.size).toBe(0);
    expect(persistence.transaction).toBeNull();
    expect(persistence.pending).toHaveLength(0);
  });

  it("deletes the release marker before any blob and resumes every failed stage", async () => {
    const persistence = new MemoryLifecyclePersistence();
    const lifecycle = createStudioDryMediaUnionCasLifecycle(persistence);
    const page = reference(300);
    const root = reference(301, "root");
    await stageRoot(lifecycle, persistence, [page, root]);
    await lifecycle.publishRoot(root.digest);
    persistence.failNext = "delete-blob";

    await expect(lifecycle.releaseRoot(root.digest)).rejects.toThrow("injected-delete-blob");
    expect(persistence.publications.has(root.digest)).toBe(false);
    expect(persistence.blobs.has(persistence.key(page))).toBe(true);
    const deleteMarkerIndex = persistence.events.findIndex((event) => (
      event === `publication:delete:${root.digest}`
    ));

    const recovered = createStudioDryMediaUnionCasLifecycle(persistence);
    await expect(recovered.reconcile(64)).resolves.toMatchObject({ complete: true });
    const firstBlobDelete = persistence.events.findIndex((event) => (
      event.startsWith("blob:delete:")
    ));
    expect(firstBlobDelete).toBeGreaterThan(deleteMarkerIndex);
    expect(persistence.blobs.size).toBe(0);
    expect(persistence.memberships.size).toBe(0);
  });
});
