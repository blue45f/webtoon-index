/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  STUDIO_LIVE_LOCK_PROTOCOL_VERSION,
  STUDIO_LIVE_LOCK_REVISION_VERSION,
} from "./studio-live-collaboration-protocol";
import {
  acceptStudioLiveLockRevision,
  applyStudioLiveLockRevisionFloor,
  studioLiveLockAcquiredFingerprint,
} from "./studio-live-lock-revision-ledger";
import {
  isRecord,
  parseLock,
  parseLockRevision,
  publicParticipant,
  safeIdentifier,
  safeString,
  type ServerLock,
  type StudioLiveLockRevision,
} from "./studio-live-socket-wire";

import type {
  StudioLiveAuthoritativeLockEvent,
} from "./studio-live-collaboration-transport";
import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";
import type {
  PendingLockDelta,
} from "./studio-live-socket-transport-types";

import { studioLiveLockResourcesConflict } from "@/shared/lib/studio-live-lock-resource";

export function onLockUpdate(this: StudioLiveSocketTransportHost, value: unknown) {
  if (!isRecord(value)) return;
  const revisionAware =
    this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION;
  let delta: PendingLockDelta | null = null;
  if (value.action === "acquired") {
    const lock = parseLock(value.lock, { requireRevision: revisionAware });
    const requestId = safeIdentifier(value.requestId, 160) ? value.requestId : undefined;
    const revision = value.revision === undefined
      ? null
      : parseLockRevision(value.revision);
    if (
      lock &&
      (value.revision === undefined || revision !== null) &&
      (!revisionAware || revision !== null) &&
      (revision === null || lock.revision === revision)
    ) {
      delta = {
        kind: "acquired",
        lock,
        ...(requestId ? { requestId } : {}),
        ...(revision !== null ? { revision } : {}),
      };
    }
  } else if (
    (value.action === "released" || value.action === "expired" || value.action === "revoked") &&
    safeString(value.resourceId, 200) &&
    safeString(value.leaseId, 80)
  ) {
    const releaseRequestId = safeIdentifier(value.releaseRequestId, 160)
      ? value.releaseRequestId
      : null;
    const revision = value.revision === undefined
      ? null
      : parseLockRevision(value.revision);
    if (
      (value.revision === undefined || revision !== null) &&
      (!revisionAware || revision !== null)
    ) {
      delta = {
        kind: "release",
        action: value.action,
        resourceId: value.resourceId,
        leaseId: value.leaseId,
        releaseRequestId,
        ...(revision !== null ? { revision } : {}),
      };
    }
  }
  if (!delta) {
    if (revisionAware) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }
  if (!this.ready || this.pendingInitialSnapshot) {
    this.bufferLockDelta(delta);
    return;
  }
  if (!this.applyLockDelta(delta)) this.restartJoinAfterUnsafeSnapshot();
}

export function applyLockDelta(this: StudioLiveSocketTransportHost, delta: PendingLockDelta): boolean {
  if (delta.kind === "acquired") {
    const pending = delta.requestId
      ? this.pendingLockAcquisitions.get(delta.requestId)
      : null;
    if (pending && pending.request.resource === delta.lock.resourceId) {
      this.completePendingLockAcquisition(pending, {
        ok: true,
        data: {
          decision: "acquired",
          requestId: delta.requestId,
          lock: {
            resourceId: delta.lock.resourceId,
            leaseId: delta.lock.leaseId,
            ownerConnectionId: delta.lock.ownerConnectionId,
            ownerName: delta.lock.ownerName,
            expiresAt: delta.lock.expiresAt,
            ...(delta.lock.revision !== null
              ? { revision: delta.lock.revision.toString() }
              : {}),
          },
        },
      });
    } else {
      if (!this.participants.has(delta.lock.ownerConnectionId)) return false;
      const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
        resourceId: delta.lock.resourceId,
        revision: delta.revision,
        family: "acquired",
        acquiredFingerprint: studioLiveLockAcquiredFingerprint(delta.lock),
        acquiredOwnerConnectionId: delta.lock.ownerConnectionId,
      });
      if (ordering === "unsafe") return false;
      if (ordering === "ignore") return true;
      this.applyAuthoritativeLock(delta.lock, delta.requestId);
    }
    return true;
  }
  const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
    resourceId: delta.resourceId,
    revision: delta.revision,
    family: "destructive",
  });
  if (ordering === "unsafe") return false;
  if (ordering === "ignore") return true;
  this.applyAuthoritativeRelease(delta.resourceId, delta.leaseId);
  const pending = this.pendingLockReleases.get(delta.resourceId);
  if (
    delta.action === "released" &&
    delta.releaseRequestId &&
    pending?.request.requestId === delta.releaseRequestId &&
    pending.request.claimId === delta.leaseId &&
    this.removePendingLockRelease(pending)
  ) {
    pending.resolve({
      status: "released",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      released: true,
    });
  }
  return true;
}

export function applyLockSnapshot(this: StudioLiveSocketTransportHost,
      locks: ServerLock[],
    snapshotRevision: StudioLiveLockRevision | null): void {
  if (!applyStudioLiveLockRevisionFloor(this.lockRevisions, snapshotRevision)) return;
  const nextKeys = new Set(locks.map((lock) => JSON.stringify([lock.resourceId, lock.leaseId])));
  for (const current of this.locksByResource.values()) {
    if (!nextKeys.has(JSON.stringify([current.resourceId, current.leaseId]))) {
      this.applyAuthoritativeRelease(current.resourceId, current.leaseId);
    }
  }
  // The join snapshot is an authenticated, server-authoritative baseline. In particular, it may
  // restore a self-owned fence after reconnect without carrying per-request broadcast metadata.
  for (const lock of locks) this.applyAuthoritativeLock(lock, undefined, true);
}

export function applyAuthoritativeLock(this: StudioLiveSocketTransportHost,
      lock: ServerLock,
    requestId?: string,
    allowNewSelfFence = false): void {
  const owner = this.participants.get(lock.ownerConnectionId);
  if (!owner) return;
  const leaseUntil = Date.parse(lock.expiresAt);
  if (!Number.isFinite(leaseUntil) || leaseUntil <= this.now()) return;
  const previous = this.locksByResource.get(lock.resourceId);
  if (owner.connectionId === this.selfConnectionId) {
    const pendingRequestId = this.pendingLockRequestByResource.get(lock.resourceId);
    const pendingRelease = this.pendingLockReleases.get(lock.resourceId);
    const matchesAcceptedFence =
      previous?.leaseId === lock.leaseId &&
      previous.ownerConnectionId === lock.ownerConnectionId;
    // A v1 gateway deliberately renews a lease without rotating its fence. A correlated reply
    // can therefore arrive after the local heartbeat timeout while the exact same accepted lock
    // is still active. That late reply refreshes the lease; it is not an abandoned fresh grant.
    // An explicit release remains stronger and must continue to chase-release the fence.
    const acceptedLegacyRenewal =
      this.lockProtocolVersion < STUDIO_LIVE_LOCK_PROTOCOL_VERSION &&
      !pendingRelease &&
      matchesAcceptedFence;
    if (acceptedLegacyRenewal && requestId) {
      const exact = this.abandonedLockAcquisitions.get(requestId);
      if (exact?.resource === lock.resourceId) {
        this.forgetAbandonedLockAcquisition(exact.requestId);
      }
    }
    const abandoned = acceptedLegacyRenewal
      ? null
      : this.findAbandonedLockAcquisition(
          lock.resourceId,
          requestId,
          matchesAcceptedFence
        );
    if (abandoned) {
      this.rollbackAbandonedLock(abandoned, lock);
      return;
    }
    if (
      !allowNewSelfFence &&
      !requestId &&
      !pendingRequestId &&
      !matchesAcceptedFence
    ) {
      // A broadcast in any rolling protocol cannot mint a new self-owned capability without
      // request correlation. Join snapshots and correlated ACKs opt in explicitly; exact
      // repeats (including legacy stable-lease renewal) remain harmless.
      return;
    }
    if (
      !allowNewSelfFence &&
      requestId &&
      requestId !== pendingRequestId &&
      (previous?.leaseId !== lock.leaseId ||
        previous.ownerConnectionId !== lock.ownerConnectionId)
    ) {
      // A listener survives Socket.IO reconnects, so an acquired update from an older join can
      // arrive while the replacement generation is ready. Only a current request, an abandoned
      // lifecycle handled above, or an already accepted identical fence may authorize it.
      return;
    }
    if (pendingRelease) {
      // A renewal may have committed just before release fenced its older lease. Suppress the
      // transient self lock and chase the exact newer fence without letting Room heartbeat it.
      this.releaseLockFenceBestEffort(lock, pendingRelease.request.requestId);
      return;
    }
    if (
      !acceptedLegacyRenewal &&
      pendingRequestId &&
      (!requestId || requestId !== pendingRequestId)
    ) {
      this.deferredSelfLocks.set(lock.resourceId, {
        lock,
        abandonedRequestId: null,
      });
      return;
    }
  }
  for (const conflicting of Array.from(this.locksByResource.values())) {
    if (
      conflicting.ownerConnectionId === lock.ownerConnectionId ||
      !studioLiveLockResourcesConflict(conflicting.resourceId, lock.resourceId)
    ) {
      continue;
    }
    // A newer accepted acquire can only commit after every overlapping lease owned by another
    // connection has disappeared. Run this after self-correlation/abandonment guards so a
    // rejected legacy or stale self event cannot erase a valid remote hierarchy lock.
    this.applyAuthoritativeRelease(conflicting.resourceId, conflicting.leaseId);
  }
  this.locksByResource.set(lock.resourceId, lock);
  if (
    previous?.leaseId === lock.leaseId &&
    previous.ownerConnectionId === lock.ownerConnectionId &&
    previous.expiresAt === lock.expiresAt
  ) {
    return;
  }
  const participant =
    owner.connectionId === this.selfConnectionId
      ? this.context.participant
      : publicParticipant(owner);
  const authoritative: StudioLiveAuthoritativeLockEvent = {
    action: "acquired",
    resource: lock.resourceId,
    claimId: lock.leaseId,
    ...(requestId ? { requestId } : {}),
    owner: participant,
    leaseUntil,
  };
  this.emitControl({ type: "lock", lock: authoritative });
}

export function applyAuthoritativeRelease(this: StudioLiveSocketTransportHost, resource: string, claimId: string): void {
  const current = this.locksByResource.get(resource);
  if (!current || current.leaseId !== claimId) return;
  this.locksByResource.delete(resource);
  this.emitControl({
    type: "lock",
    lock: { action: "released", resource, claimId },
  });
}
