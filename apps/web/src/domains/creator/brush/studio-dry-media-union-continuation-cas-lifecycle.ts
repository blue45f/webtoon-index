import type { StudioFreehandInputCasBlobKind } from "../studio-freehand-input-binary-spool-opfs-store";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_REFERENCES = 65_536;
const MAX_SHARED_ROOTS_PER_BLOB = 8_192;
const DEFAULT_RECONCILE_STEPS = 64;

export interface StudioDryMediaUnionCasBlobReference {
  readonly kind: StudioFreehandInputCasBlobKind;
  readonly digest: string;
  readonly byteLength: number;
}

export interface StudioDryMediaUnionCasLifecycleTransaction {
  readonly contract: "studio-dry-media-union-cas-lifecycle-transaction-v1";
  readonly version: 1;
  readonly phase:
    | "pending"
    | "publishing"
    | "rollback"
    | "preparing-release"
    | "releasing";
  readonly rootDigest: string | null;
  readonly cursor: number;
}

export interface StudioDryMediaUnionCasLifecyclePublication {
  readonly contract: "studio-dry-media-union-cas-lifecycle-publication-v1";
  readonly version: 1;
  readonly rootDigest: string;
  readonly references: readonly StudioDryMediaUnionCasBlobReference[];
}

export interface StudioDryMediaUnionCasLifecycleReconcileReceipt {
  readonly phase: StudioDryMediaUnionCasLifecycleTransaction["phase"] | "idle";
  readonly processedReferenceCount: number;
  readonly remainingReferenceCount: number;
  readonly complete: boolean;
}

export interface StudioDryMediaUnionCasLifecyclePersistence {
  loadTransaction(): Promise<StudioDryMediaUnionCasLifecycleTransaction | null>;
  saveTransaction(transaction: StudioDryMediaUnionCasLifecycleTransaction): Promise<void>;
  deleteTransaction(): Promise<void>;
  appendPendingReference(reference: StudioDryMediaUnionCasBlobReference): Promise<void>;
  readPendingReferences(): Promise<readonly StudioDryMediaUnionCasBlobReference[]>;
  clearPendingReferences(): Promise<void>;
  loadPublication(
    rootDigest: string,
  ): Promise<StudioDryMediaUnionCasLifecyclePublication | null>;
  savePublication(publication: StudioDryMediaUnionCasLifecyclePublication): Promise<void>;
  deletePublication(rootDigest: string): Promise<void>;
  loadMembership(reference: StudioDryMediaUnionCasBlobReference): Promise<readonly string[]>;
  saveMembership(
    reference: StudioDryMediaUnionCasBlobReference,
    rootDigests: readonly string[],
  ): Promise<void>;
  deleteMembership(reference: StudioDryMediaUnionCasBlobReference): Promise<void>;
  deleteBlob(reference: StudioDryMediaUnionCasBlobReference): Promise<void>;
}

export interface StudioDryMediaUnionCasLifecycle {
  stageBlob(reference: StudioDryMediaUnionCasBlobReference): Promise<void>;
  publishRoot(rootDigest: string): Promise<void>;
  isRootPublished(rootDigest: string): Promise<boolean>;
  cancelPending(): Promise<void>;
  releaseRoot(rootDigest: string): Promise<boolean>;
  reconcile(
    maximumReferenceSteps?: number,
  ): Promise<StudioDryMediaUnionCasLifecycleReconcileReceipt>;
}

export interface StudioDryMediaUnionLifecycleManagedCas {
  readonly dryMediaUnionLifecycle: StudioDryMediaUnionCasLifecycle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function snapshotReference(value: unknown): StudioDryMediaUnionCasBlobReference | null {
  if (!isRecord(value) || !exactKeys(value, ["kind", "digest", "byteLength"])) return null;
  if (
    (value.kind !== "page"
      && value.kind !== "index"
      && value.kind !== "metadata"
      && value.kind !== "root")
    || typeof value.digest !== "string"
    || !SHA256_HEX.test(value.digest)
    || !validSafeInteger(value.byteLength, 1)
  ) return null;
  return Object.freeze({
    kind: value.kind,
    digest: value.digest,
    byteLength: value.byteLength,
  });
}

function snapshotTransaction(
  value: unknown,
): StudioDryMediaUnionCasLifecycleTransaction | null {
  if (
    !isRecord(value)
    || !exactKeys(value, ["contract", "version", "phase", "rootDigest", "cursor"])
    || value.contract !== "studio-dry-media-union-cas-lifecycle-transaction-v1"
    || value.version !== 1
    || (value.phase !== "pending"
      && value.phase !== "publishing"
      && value.phase !== "rollback"
      && value.phase !== "preparing-release"
      && value.phase !== "releasing")
    || !validSafeInteger(value.cursor)
    || (value.rootDigest !== null
      && (typeof value.rootDigest !== "string" || !SHA256_HEX.test(value.rootDigest)))
    || (value.phase === "pending" && (value.rootDigest !== null || value.cursor !== 0))
    || (value.phase !== "pending" && value.rootDigest === null && value.phase !== "rollback")
  ) return null;
  return Object.freeze({
    contract: value.contract,
    version: value.version,
    phase: value.phase,
    rootDigest: value.rootDigest,
    cursor: value.cursor,
  });
}

function snapshotPublication(
  value: unknown,
): StudioDryMediaUnionCasLifecyclePublication | null {
  if (
    !isRecord(value)
    || !exactKeys(value, ["contract", "version", "rootDigest", "references"])
    || value.contract !== "studio-dry-media-union-cas-lifecycle-publication-v1"
    || value.version !== 1
    || typeof value.rootDigest !== "string"
    || !SHA256_HEX.test(value.rootDigest)
    || !Array.isArray(value.references)
    || value.references.length === 0
    || value.references.length > MAX_REFERENCES
  ) return null;
  const references: StudioDryMediaUnionCasBlobReference[] = [];
  const keys = new Set<string>();
  for (const candidate of value.references) {
    const reference = snapshotReference(candidate);
    const key = reference ? referenceKey(reference) : "";
    if (!reference || keys.has(key)) return null;
    keys.add(key);
    references.push(reference);
  }
  if (!references.some((reference) => (
    reference.kind === "root" && reference.digest === value.rootDigest
  ))) return null;
  return Object.freeze({
    contract: value.contract,
    version: value.version,
    rootDigest: value.rootDigest,
    references: Object.freeze(references),
  });
}

function snapshotMembership(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHARED_ROOTS_PER_BLOB) return null;
  const roots: string[] = [];
  let previous = "";
  for (const entry of value) {
    if (
      typeof entry !== "string"
      || !SHA256_HEX.test(entry)
      || (previous !== "" && entry <= previous)
    ) return null;
    roots.push(entry);
    previous = entry;
  }
  return Object.freeze(roots);
}

function referenceKey(reference: StudioDryMediaUnionCasBlobReference): string {
  return `${reference.kind}:${reference.digest}`;
}

function transaction(
  phase: StudioDryMediaUnionCasLifecycleTransaction["phase"],
  rootDigest: string | null,
  cursor: number,
): StudioDryMediaUnionCasLifecycleTransaction {
  return Object.freeze({
    contract: "studio-dry-media-union-cas-lifecycle-transaction-v1",
    version: 1,
    phase,
    rootDigest,
    cursor,
  });
}

function publication(
  rootDigest: string,
  references: readonly StudioDryMediaUnionCasBlobReference[],
): StudioDryMediaUnionCasLifecyclePublication {
  return Object.freeze({
    contract: "studio-dry-media-union-cas-lifecycle-publication-v1",
    version: 1,
    rootDigest,
    references: Object.freeze([...references]),
  });
}

function validateStepBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_REFERENCES) {
    throw new RangeError("Dry-media CAS lifecycle reconcile budget is invalid.");
  }
  return value;
}

export function isStudioDryMediaUnionLifecycleManagedCas(
  value: unknown,
): value is StudioDryMediaUnionLifecycleManagedCas {
  if (!isRecord(value)) return false;
  const lifecycle = value.dryMediaUnionLifecycle;
  return isRecord(lifecycle)
    && typeof lifecycle.stageBlob === "function"
    && typeof lifecycle.publishRoot === "function"
    && typeof lifecycle.isRootPublished === "function"
    && typeof lifecycle.cancelPending === "function"
    && typeof lifecycle.releaseRoot === "function"
    && typeof lifecycle.reconcile === "function";
}

export function createStudioDryMediaUnionCasLifecycle(
  persistence: StudioDryMediaUnionCasLifecyclePersistence,
): StudioDryMediaUnionCasLifecycle {
  let tail = Promise.resolve();
  let initialized = false;
  let pendingKeys = new Set<string>();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const loadTransaction = async (): Promise<StudioDryMediaUnionCasLifecycleTransaction | null> => {
    const raw = await persistence.loadTransaction();
    if (raw === null) return null;
    const value = snapshotTransaction(raw);
    if (!value) throw new Error("studio-dry-media-union-cas-lifecycle-corrupt-transaction");
    return value;
  };

  const readPendingReferences = async (): Promise<readonly StudioDryMediaUnionCasBlobReference[]> => {
    const raw = await persistence.readPendingReferences();
    if (!Array.isArray(raw) || raw.length > MAX_REFERENCES) {
      throw new Error("studio-dry-media-union-cas-lifecycle-corrupt-reference-journal");
    }
    const unique: StudioDryMediaUnionCasBlobReference[] = [];
    const seen = new Map<string, number>();
    for (const candidate of raw) {
      const reference = snapshotReference(candidate);
      if (!reference) {
        throw new Error("studio-dry-media-union-cas-lifecycle-corrupt-reference-journal");
      }
      const key = referenceKey(reference);
      const previousLength = seen.get(key);
      if (previousLength !== undefined && previousLength !== reference.byteLength) {
        throw new Error("studio-dry-media-union-cas-lifecycle-digest-size-conflict");
      }
      if (previousLength === undefined) {
        seen.set(key, reference.byteLength);
        unique.push(reference);
      }
    }
    return Object.freeze(unique);
  };

  const loadPublication = async (
    rootDigest: string,
  ): Promise<StudioDryMediaUnionCasLifecyclePublication | null> => {
    const raw = await persistence.loadPublication(rootDigest);
    if (raw === null) return null;
    const value = snapshotPublication(raw);
    if (!value || value.rootDigest !== rootDigest) {
      throw new Error("studio-dry-media-union-cas-lifecycle-corrupt-publication");
    }
    return value;
  };

  const loadMembership = async (
    reference: StudioDryMediaUnionCasBlobReference,
  ): Promise<readonly string[]> => {
    const roots = snapshotMembership(await persistence.loadMembership(reference));
    if (!roots) throw new Error("studio-dry-media-union-cas-lifecycle-corrupt-membership");
    return roots;
  };

  const reconcileInternal = async (
    maximumReferenceSteps: number,
    initialize: boolean,
  ): Promise<StudioDryMediaUnionCasLifecycleReconcileReceipt> => {
    const maximum = validateStepBudget(maximumReferenceSteps);
    let current = await loadTransaction();
    if (!current) {
      initialized = true;
      pendingKeys = new Set();
      return Object.freeze({
        phase: "idle",
        processedReferenceCount: 0,
        remainingReferenceCount: 0,
        complete: true,
      });
    }
    if (!initialized && current.phase === "pending") {
      current = transaction("rollback", null, 0);
      await persistence.saveTransaction(current);
    }
    initialized = true;
    if (current.phase === "pending" && !initialize) {
      const references = await readPendingReferences();
      pendingKeys = new Set(references.map(referenceKey));
      return Object.freeze({
        phase: "pending",
        processedReferenceCount: 0,
        remainingReferenceCount: references.length,
        complete: false,
      });
    }

    const rootDigest = current.rootDigest;
    if (current.phase === "preparing-release") {
      if (!rootDigest) {
        throw new Error("studio-dry-media-union-cas-lifecycle-missing-root");
      }
      const marker = await loadPublication(rootDigest);
      if (!marker) {
        throw new Error("studio-dry-media-union-cas-lifecycle-missing-release-publication");
      }
      const journal = await readPendingReferences();
      if (
        current.cursor !== journal.length
        || current.cursor > marker.references.length
        || journal.some((reference, index) => (
          referenceKey(reference) !== referenceKey(marker.references[index]!)
          || reference.byteLength !== marker.references[index]!.byteLength
        ))
      ) {
        throw new Error("studio-dry-media-union-cas-lifecycle-release-journal-mismatch");
      }
      let cursor = current.cursor;
      let processed = 0;
      while (cursor < marker.references.length && processed < maximum) {
        await persistence.appendPendingReference(marker.references[cursor]!);
        cursor += 1;
        processed += 1;
        current = transaction("preparing-release", rootDigest, cursor);
        await persistence.saveTransaction(current);
      }
      if (cursor < marker.references.length) {
        return Object.freeze({
          phase: "preparing-release",
          processedReferenceCount: processed,
          remainingReferenceCount: marker.references.length - cursor,
          complete: false,
        });
      }
      await persistence.saveTransaction(transaction("releasing", rootDigest, 0));
      await persistence.deletePublication(rootDigest);
      return Object.freeze({
        phase: "releasing",
        processedReferenceCount: processed,
        remainingReferenceCount: marker.references.length,
        complete: false,
      });
    }
    const references = await readPendingReferences();
    if (current.phase === "releasing" && rootDigest) {
      await persistence.deletePublication(rootDigest);
      if (await loadPublication(rootDigest)) {
        throw new Error("studio-dry-media-union-cas-lifecycle-release-marker-retained");
      }
    }
    if (!references) {
      throw new Error("studio-dry-media-union-cas-lifecycle-missing-release-publication");
    }
    if (current.cursor > references.length) {
      throw new Error("studio-dry-media-union-cas-lifecycle-cursor-overflow");
    }
    let cursor = current.cursor;
    let processed = 0;
    while (cursor < references.length && processed < maximum) {
      const reference = references[cursor]!;
      const roots = await loadMembership(reference);
      if (current.phase === "publishing") {
        if (!rootDigest) throw new Error("studio-dry-media-union-cas-lifecycle-missing-root");
        if (!roots.includes(rootDigest)) {
          if (roots.length >= MAX_SHARED_ROOTS_PER_BLOB) {
            throw new Error("studio-dry-media-union-cas-lifecycle-membership-capacity");
          }
          await persistence.saveMembership(
            reference,
            Object.freeze([...roots, rootDigest].sort()),
          );
        }
      } else {
        const retained = rootDigest
          ? roots.filter((candidate) => candidate !== rootDigest)
          : roots;
        if (retained.length === 0) {
          await persistence.saveMembership(reference, Object.freeze([]));
          await persistence.deleteBlob(reference);
          await persistence.deleteMembership(reference);
        } else if (retained.length !== roots.length) {
          await persistence.saveMembership(reference, Object.freeze(retained));
        }
      }
      cursor += 1;
      processed += 1;
      current = transaction(current.phase, rootDigest, cursor);
      await persistence.saveTransaction(current);
    }

    if (cursor < references.length) {
      return Object.freeze({
        phase: current.phase,
        processedReferenceCount: processed,
        remainingReferenceCount: references.length - cursor,
        complete: false,
      });
    }

    if (current.phase === "publishing") {
      if (!rootDigest) throw new Error("studio-dry-media-union-cas-lifecycle-missing-root");
      const marker = publication(rootDigest, references);
      try {
        await persistence.savePublication(marker);
      } catch (error) {
        const durable = await loadPublication(rootDigest).catch(() => null);
        if (!durable) throw error;
      }
    }
    await persistence.deleteTransaction();
    try {
      await persistence.clearPendingReferences();
    } catch {
      // The authoritative transaction is already gone. The next transaction
      // clears this bounded, non-authoritative journal before it can append.
    }
    pendingKeys = new Set();
    return Object.freeze({
      phase: "idle",
      processedReferenceCount: processed,
      remainingReferenceCount: 0,
      complete: true,
    });
  };

  const ensureInitialized = async (): Promise<void> => {
    if (initialized) return;
    await reconcileInternal(DEFAULT_RECONCILE_STEPS, true);
  };

  return Object.freeze({
    stageBlob(referenceCandidate: unknown) {
      return enqueue(async () => {
        await ensureInitialized();
        const reference = snapshotReference(referenceCandidate);
        if (!reference) throw new TypeError("Invalid dry-media CAS lifecycle reference.");
        let current = await loadTransaction();
        if (!current) {
          await persistence.clearPendingReferences();
          current = transaction("pending", null, 0);
          await persistence.saveTransaction(current);
          pendingKeys = new Set();
        }
        if (current.phase !== "pending") {
          throw new Error("studio-dry-media-union-cas-lifecycle-busy");
        }
        const key = referenceKey(reference);
        if (pendingKeys.has(key)) return;
        if (pendingKeys.size >= MAX_REFERENCES) {
          throw new Error("studio-dry-media-union-cas-lifecycle-reference-capacity");
        }
        await persistence.appendPendingReference(reference);
        pendingKeys.add(key);
      });
    },
    publishRoot(rootDigest: string) {
      return enqueue(async () => {
        await ensureInitialized();
        if (!SHA256_HEX.test(rootDigest)) {
          throw new TypeError("Invalid dry-media CAS lifecycle root digest.");
        }
        const current = await loadTransaction();
        if (!current || current.phase !== "pending") {
          throw new Error("studio-dry-media-union-cas-lifecycle-not-pending");
        }
        const references = await readPendingReferences();
        if (!references.some((reference) => (
          reference.kind === "root" && reference.digest === rootDigest
        ))) {
          throw new Error("studio-dry-media-union-cas-lifecycle-root-not-staged");
        }
        await persistence.saveTransaction(transaction("publishing", rootDigest, 0));
        let receipt: StudioDryMediaUnionCasLifecycleReconcileReceipt;
        do {
          receipt = await reconcileInternal(DEFAULT_RECONCILE_STEPS, false);
        } while (!receipt.complete);
      });
    },
    isRootPublished(rootDigest: string) {
      return enqueue(async () => {
        await ensureInitialized();
        if (!SHA256_HEX.test(rootDigest)) return false;
        return (await loadPublication(rootDigest)) !== null;
      });
    },
    cancelPending() {
      return enqueue(async () => {
        await ensureInitialized();
        const current = await loadTransaction();
        if (!current || current.phase === "rollback") return;
        if (current.phase !== "pending") {
          throw new Error("studio-dry-media-union-cas-lifecycle-busy");
        }
        await persistence.saveTransaction(transaction("rollback", null, 0));
      });
    },
    releaseRoot(rootDigest: string) {
      return enqueue(async () => {
        await ensureInitialized();
        if (!SHA256_HEX.test(rootDigest)) return false;
        if (await loadTransaction()) {
          throw new Error("studio-dry-media-union-cas-lifecycle-busy");
        }
        const marker = await loadPublication(rootDigest);
        if (!marker) return false;
        await persistence.clearPendingReferences();
        await persistence.saveTransaction(transaction("preparing-release", rootDigest, 0));
        let receipt: StudioDryMediaUnionCasLifecycleReconcileReceipt;
        do {
          receipt = await reconcileInternal(DEFAULT_RECONCILE_STEPS, false);
        } while (!receipt.complete);
        return true;
      });
    },
    reconcile(maximumReferenceSteps = DEFAULT_RECONCILE_STEPS) {
      return enqueue(() => reconcileInternal(maximumReferenceSteps, !initialized));
    },
  });
}
