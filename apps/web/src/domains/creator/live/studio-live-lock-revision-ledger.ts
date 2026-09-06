import { STUDIO_LIVE_LOCK_REVISION_VERSION } from "./studio-live-collaboration-protocol";

import type { ServerLock, StudioLiveLockRevision } from "./studio-live-socket-wire";

import { studioLiveLockResourcesConflict } from "@/shared/lib/studio-live-lock-resource";

const MAX_LOCK_REVISION_WATERMARKS = 1_024;

export type LockRevisionFamily = "acquired" | "destructive";

export interface LockRevisionWatermark {
  revision: StudioLiveLockRevision;
  family: LockRevisionFamily;
  acquiredFingerprint?: string;
  /** Latest acquire proof retained even after this exact resource is later released. */
  conflictAcquiredRevision?: StudioLiveLockRevision;
  conflictOwnerConnectionId?: string;
}

/**
 * Per-resource fence ordering for authoritative lock events. The ledger owns only the revision
 * watermarks — the lock table itself stays with the transport, so a rejected ordering ("unsafe")
 * still resolves to the transport's own rejoin policy rather than a silent local mutation.
 */
export interface StudioLiveLockRevisionLedger {
  lockRevisionVersion: 0 | typeof STUDIO_LIVE_LOCK_REVISION_VERSION;
  lockSnapshotFloor: StudioLiveLockRevision | null;
  maxCommittedLockRevision: StudioLiveLockRevision | null;
  readonly lockRevisionByResource: Map<string, LockRevisionWatermark>;
}

export function createStudioLiveLockRevisionLedger(): StudioLiveLockRevisionLedger {
  return {
    lockRevisionVersion: 0,
    lockSnapshotFloor: null,
    maxCommittedLockRevision: null,
    lockRevisionByResource: new Map<string, LockRevisionWatermark>(),
  };
}

export function studioLiveLockAcquiredFingerprint(lock: ServerLock): string {
  return JSON.stringify([
    lock.leaseId,
    lock.ownerConnectionId,
    lock.expiresAt,
    lock.revision?.toString() ?? null,
  ]);
}

export interface StudioLiveLockRevisionCandidate {
  resourceId: string;
  revision: StudioLiveLockRevision | undefined;
  family: LockRevisionFamily;
  acquiredFingerprint?: string;
  acquiredOwnerConnectionId?: string;
}

export function acceptStudioLiveLockRevision(
  ledger: StudioLiveLockRevisionLedger,
  {
    resourceId,
    revision,
    family,
    acquiredFingerprint,
    acquiredOwnerConnectionId,
  }: StudioLiveLockRevisionCandidate
): "apply" | "ignore" | "unsafe" {
  if (ledger.lockRevisionVersion !== STUDIO_LIVE_LOCK_REVISION_VERSION) return "apply";
  if (revision === undefined || ledger.lockSnapshotFloor === null) return "unsafe";
  if (revision <= ledger.lockSnapshotFloor) return "ignore";

  const current = ledger.lockRevisionByResource.get(resourceId);
  if (current) {
    if (revision < current.revision) return "ignore";
    if (revision === current.revision) {
      if (family === "destructive" && current.family === "destructive") return "apply";
      if (
        family === "acquired" &&
        current.family === "acquired" &&
        current.acquiredFingerprint === acquiredFingerprint
      ) {
        return "ignore";
      }
      return "unsafe";
    }
  }

  if (family === "acquired") {
    if (!acquiredOwnerConnectionId || !acquiredFingerprint) return "unsafe";
    for (const [otherResourceId, watermark] of ledger.lockRevisionByResource) {
      if (
        otherResourceId === resourceId ||
        !studioLiveLockResourcesConflict(resourceId, otherResourceId)
      ) {
        continue;
      }
      if (
        watermark.conflictAcquiredRevision !== undefined &&
        watermark.conflictOwnerConnectionId &&
        watermark.conflictOwnerConnectionId !== acquiredOwnerConnectionId
      ) {
        if (watermark.conflictAcquiredRevision > revision) return "ignore";
        if (watermark.conflictAcquiredRevision === revision) return "unsafe";
      }
      // A newer acquire by a different owner proves this older hierarchy member was absent. A
      // standalone destructive event does not: it may be an unseen lifecycle release or one of
      // the synthetic rotation-fence revocations. Rejoin instead of guessing whether the older
      // page/element acquire was still valid at that point.
      if (watermark.family === "destructive" && watermark.revision >= revision) {
        return "unsafe";
      }
    }
  }

  if (!current && ledger.lockRevisionByResource.size >= MAX_LOCK_REVISION_WATERMARKS) {
    // A fresh snapshot compresses every accumulated tombstone into one global floor. Arbitrary
    // eviction would allow an older acquired event for the forgotten resource to resurrect.
    return "unsafe";
  }

  ledger.lockRevisionByResource.set(resourceId, {
    revision,
    family,
    ...(current?.conflictAcquiredRevision !== undefined &&
    current.conflictOwnerConnectionId
      ? {
          conflictAcquiredRevision: current.conflictAcquiredRevision,
          conflictOwnerConnectionId: current.conflictOwnerConnectionId,
        }
      : {}),
    ...(family === "acquired" && acquiredFingerprint
      ? { acquiredFingerprint }
      : {}),
    ...(family === "acquired" && acquiredOwnerConnectionId
      ? {
          conflictAcquiredRevision: revision,
          conflictOwnerConnectionId: acquiredOwnerConnectionId,
        }
      : {}),
  });
  if (ledger.maxCommittedLockRevision === null || revision > ledger.maxCommittedLockRevision) {
    ledger.maxCommittedLockRevision = revision;
  }
  return "apply";
}

export function clearStudioLiveLockRevisionState(
  ledger: StudioLiveLockRevisionLedger
): void {
  ledger.lockRevisionVersion = 0;
  ledger.lockSnapshotFloor = null;
  ledger.lockRevisionByResource.clear();
  ledger.maxCommittedLockRevision = null;
}

/**
 * Rebases the ledger onto one authenticated join snapshot. Returns `false` when a revisioned
 * session carries no snapshot revision — the caller must then leave its lock table untouched.
 */
export function applyStudioLiveLockRevisionFloor(
  ledger: StudioLiveLockRevisionLedger,
  snapshotRevision: StudioLiveLockRevision | null
): boolean {
  if (ledger.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION) {
    if (snapshotRevision === null) return false;
    ledger.lockSnapshotFloor = snapshotRevision;
    ledger.lockRevisionByResource.clear();
    if (
      ledger.maxCommittedLockRevision === null ||
      snapshotRevision > ledger.maxCommittedLockRevision
    ) {
      ledger.maxCommittedLockRevision = snapshotRevision;
    }
  } else {
    ledger.lockSnapshotFloor = null;
    ledger.lockRevisionByResource.clear();
    ledger.maxCommittedLockRevision = null;
  }
  return true;
}

/** Minimal shape of a buffered lock delta that fence-free resync ordering has to inspect. */
export type StudioLiveLockResyncDelta =
  | { readonly kind: "acquired"; readonly lock: ServerLock }
  | { readonly kind: "release"; readonly resourceId: string; readonly leaseId: string };

export function studioLiveLockDeltasRequireResync(
  snapshotLocks: ServerLock[],
  deltas: readonly StudioLiveLockResyncDelta[]
): boolean {
  const locks = new Map(snapshotLocks.map((lock) => [lock.resourceId, lock]));
  for (const delta of deltas) {
    if (delta.kind === "acquired") {
      const current = locks.get(delta.lock.resourceId);
      // Without a server monotonic event revision, a novel acquire can be either side of the
      // snapshot barrier on a multi-node adapter. Never guess which fence is authoritative.
      if (
        !current ||
        current.leaseId !== delta.lock.leaseId ||
        current.ownerConnectionId !== delta.lock.ownerConnectionId
      ) {
        return true;
      }
      continue;
    }
    const current = locks.get(delta.resourceId);
    if (current?.leaseId === delta.leaseId) locks.delete(delta.resourceId);
  }
  return false;
}
