/** Implementation helpers for `StudioLiveSocketTransport`; not a public entry. */
import {
  STUDIO_LIVE_LOCK_PROTOCOL_VERSION,
  STUDIO_LIVE_LOCK_REVISION_VERSION,
} from "./studio-live-collaboration-protocol";
import {
  acceptStudioLiveLockRevision,
  studioLiveLockAcquiredFingerprint,
} from "./studio-live-lock-revision-ledger";
import {
  ABANDONED_LOCK_ACQUISITION_TTL_MS,
  MAX_ABANDONED_LOCK_ACQUISITIONS,
  type AbandonedLockAcquisition,
  type DeferredSelfLock,
  type PendingLockAcquisition,
  type PendingLockRelease,
} from "./studio-live-socket-transport-types";
import {
  isRecord,
  parseFailure,
  parseLock,
  parseLockRevision,
  publicParticipant,
  safeIdentifier,
  type ServerLock,
} from "./studio-live-socket-wire";

import type { StudioLiveSocketTransportHost } from "./studio-live-socket-transport-host";

export function completePendingLockAcquisition(this: StudioLiveSocketTransportHost,
      pending: PendingLockAcquisition,
    value: unknown): void {
  if (this.pendingLockAcquisitions.get(pending.request.requestId) !== pending) {
    const lateLock = this.parseLockAcquisitionSuccess(pending, value);
    if (lateLock) {
      const abandoned = this.abandonedLockAcquisitions.get(pending.request.requestId);
      if (abandoned?.resource === pending.request.resource) {
        const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
          resourceId: lateLock.resourceId,
          revision: lateLock.revision ?? undefined,
          family: "acquired",
          acquiredFingerprint: studioLiveLockAcquiredFingerprint(lateLock),
          acquiredOwnerConnectionId: lateLock.ownerConnectionId,
        });
        if (ordering === "unsafe") {
          this.rollbackAbandonedLock(abandoned, lateLock);
          this.restartJoinAfterUnsafeSnapshot();
          return;
        }
        if (ordering === "ignore") {
          this.rollbackAbandonedLock(abandoned, lateLock);
          return;
        }
        // Route the late ACK through the same authoritative path as a broadcast. Legacy stable
        // renewals can refresh an already accepted fence, while v2 or released lifecycles are
        // still rolled back by the abandonment checks in applyAuthoritativeLock().
        this.applyAuthoritativeLock(lateLock, pending.request.requestId);
      }
    } else if (
      this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION &&
      isRecord(value) &&
      value.ok === true
    ) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }
  this.removePendingLockAcquisition(pending);

  if (
    this.closed ||
    !this.ready ||
    pending.joinGeneration !== this.joinGeneration ||
    pending.selfConnectionId !== this.selfConnectionId
  ) {
    pending.resolve({
      status: "revoked",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code: "connection_changed",
      message: "팀 연결이 변경되어 편집 잠금 요청이 취소되었습니다.",
    });
    return;
  }

  const echoedRequestId = this.lockAckRequestId(value);
  if (
    (this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION &&
      echoedRequestId !== pending.request.requestId) ||
    (echoedRequestId !== null && echoedRequestId !== pending.request.requestId)
  ) {
    const abandoned = this.rememberAbandonedLockAcquisition(pending);
    const uncorrelatedLock = this.parseLockAcquisitionSuccess(pending, value, true);
    if (uncorrelatedLock) {
      const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
        resourceId: uncorrelatedLock.resourceId,
        revision: uncorrelatedLock.revision ?? undefined,
        family: "acquired",
        acquiredFingerprint: studioLiveLockAcquiredFingerprint(uncorrelatedLock),
        acquiredOwnerConnectionId: uncorrelatedLock.ownerConnectionId,
      });
      this.rollbackAbandonedLock(abandoned, uncorrelatedLock);
      if (ordering === "unsafe") this.restartJoinAfterUnsafeSnapshot();
    } else {
      const deferred = this.deferredSelfLocks.get(pending.request.resource);
      if (deferred) this.rollbackDeferredSelfLock(deferred, abandoned);
      if (
        this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION &&
        isRecord(value) &&
        value.ok === true
      ) {
        this.restartJoinAfterUnsafeSnapshot();
      }
    }
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code: "response_mismatch",
      message: "팀 서버의 편집 잠금 응답 식별자가 요청과 일치하지 않습니다.",
    });
    return;
  }
  const failure = parseFailure(value);
  if (failure) {
    const revoked =
      (isRecord(value) && value.decision === "revoked") ||
      failure.code === "unauthenticated" ||
      failure.code === "access_revoked";
    const hasConflictLock = isRecord(value) && value.lock !== undefined;
    const conflictLock = isRecord(value)
      ? parseLock(value.lock, {
          requireRevision:
            this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION,
        })
      : null;
    const conflictOwner = conflictLock
      ? this.participants.get(conflictLock.ownerConnectionId)
      : null;
    let conflictOrdering: "apply" | "ignore" | "unsafe" = "ignore";
    if (conflictLock && conflictOwner) {
      conflictOrdering = acceptStudioLiveLockRevision(this.lockRevisions, {
        resourceId: conflictLock.resourceId,
        revision: conflictLock.revision ?? undefined,
        family: "acquired",
        acquiredFingerprint: studioLiveLockAcquiredFingerprint(conflictLock),
        acquiredOwnerConnectionId: conflictLock.ownerConnectionId,
      });
      if (conflictOrdering === "apply") {
        this.applyAuthoritativeLock(conflictLock);
      }
    } else if (
      this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION &&
      hasConflictLock
    ) {
      conflictOrdering = "unsafe";
    }
    const publicConflict = conflictLock && conflictOwner
      ? {
          resource: conflictLock.resourceId,
          claimId: conflictLock.leaseId,
          owner: publicParticipant(conflictOwner),
          leaseUntil: Date.parse(conflictLock.expiresAt),
        }
      : undefined;
    pending.resolve(
      revoked
        ? {
            status: "revoked",
            resource: pending.request.resource,
            requestId: pending.request.requestId,
            code: failure.code,
            message: failure.message,
          }
        : {
            status: "denied",
            resource: pending.request.resource,
            requestId: pending.request.requestId,
            code: failure.code,
            message: failure.message,
            ...(publicConflict ? { lock: publicConflict } : {}),
          }
    );
    this.settleDeferredSelfLock(pending.request.resource);
    this.handleFailure(failure, "operation");
    if (conflictOrdering === "unsafe" && !this.accessRevoked) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }

  const lock = this.parseLockAcquisitionSuccess(pending, value);
  if (!lock) {
    const abandoned = this.rememberAbandonedLockAcquisition(pending);
    const revisionlessLock =
      this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION
        ? this.parseLockAcquisitionSuccess(pending, value, false, false)
        : null;
    if (revisionlessLock) {
      this.rollbackAbandonedLock(abandoned, revisionlessLock);
    } else {
      const deferred = this.deferredSelfLocks.get(pending.request.resource);
      if (deferred) this.rollbackDeferredSelfLock(deferred, abandoned);
    }
    const message = "팀 서버의 편집 잠금 응답 형식이 올바르지 않습니다.";
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code: "invalid_response",
      message,
    });
    this.emitStatus({ state: "error", message, recoverable: true });
    if (this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }
  const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
    resourceId: lock.resourceId,
    revision: lock.revision ?? undefined,
    family: "acquired",
    acquiredFingerprint: studioLiveLockAcquiredFingerprint(lock),
    acquiredOwnerConnectionId: lock.ownerConnectionId,
  });
  if (ordering === "unsafe") {
    const abandoned = this.rememberAbandonedLockAcquisition(pending);
    this.rollbackAbandonedLock(abandoned, lock);
    const message = "편집 잠금 순서를 확인할 수 없어 최신 팀 상태를 다시 불러옵니다.";
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code: "invalid_response",
      message,
    });
    this.restartJoinAfterUnsafeSnapshot();
    return;
  }
  if (ordering === "ignore") {
    const current = this.locksByResource.get(lock.resourceId);
    const duplicateAcceptedFence =
      current?.leaseId === lock.leaseId &&
      current.ownerConnectionId === lock.ownerConnectionId &&
      current.expiresAt === lock.expiresAt &&
      current.revision === lock.revision;
    if (!duplicateAcceptedFence) {
      this.settleDeferredSelfLock(pending.request.resource);
      pending.resolve({
        status: "revoked",
        resource: pending.request.resource,
        requestId: pending.request.requestId,
        code: "lock_stale",
        message: "더 최신 편집 잠금 상태가 확인되어 이전 응답을 적용하지 않았습니다.",
      });
      return;
    }
  }
  this.forgetAbandonedLockAcquisition(pending.request.requestId);
  this.settleDeferredSelfLock(pending.request.resource, lock);
  const leaseUntil = Date.parse(lock.expiresAt);
  if (ordering === "apply") {
    this.applyAuthoritativeLock(lock, pending.request.requestId, true);
  }
  pending.resolve({
    status: "acquired",
    resource: pending.request.resource,
    requestId: pending.request.requestId,
    lock: {
      resource: lock.resourceId,
      claimId: lock.leaseId,
      owner: this.context.participant,
      leaseUntil,
    },
  });
}

export function parseLockAcquisitionSuccess(this: StudioLiveSocketTransportHost,
      pending: PendingLockAcquisition,
    value: unknown,
    ignoreRequestId = false,
    requireRevision =
      this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION): ServerLock | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  if (value.data.decision !== undefined && value.data.decision !== "acquired") return null;
  if (
    !ignoreRequestId &&
    value.data.requestId !== undefined &&
    value.data.requestId !== pending.request.requestId
  ) return null;
  const lock = parseLock(value.data.lock, { requireRevision });
  if (
    !lock ||
    lock.resourceId !== pending.request.resource ||
    lock.ownerConnectionId !== pending.selfConnectionId ||
    Date.parse(lock.expiresAt) <= this.now()
  ) return null;
  return lock;
}

export function lockAckRequestId(this: StudioLiveSocketTransportHost, value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (safeIdentifier(value.requestId, 160)) return value.requestId;
  if (isRecord(value.data) && safeIdentifier(value.data.requestId, 160)) {
    return value.data.requestId;
  }
  return null;
}

export function removePendingLockAcquisition(this: StudioLiveSocketTransportHost, pending: PendingLockAcquisition): boolean {
  if (this.pendingLockAcquisitions.get(pending.request.requestId) !== pending) return false;
  this.pendingLockAcquisitions.delete(pending.request.requestId);
  if (this.pendingLockRequestByResource.get(pending.request.resource) === pending.request.requestId) {
    this.pendingLockRequestByResource.delete(pending.request.resource);
  }
  if (pending.timeout !== null) this.cancelTimeout(pending.timeout);
  pending.timeout = null;
  return true;
}

export function rememberAbandonedLockAcquisition(this: StudioLiveSocketTransportHost,
      pending: PendingLockAcquisition): AbandonedLockAcquisition {
  this.pruneAbandonedLockAcquisitions();
  const abandoned: AbandonedLockAcquisition = {
    requestId: pending.request.requestId,
    resource: pending.request.resource,
    joinGeneration: pending.joinGeneration,
    selfConnectionId: pending.selfConnectionId,
    discardAt: this.now() + ABANDONED_LOCK_ACQUISITION_TTL_MS,
  };
  this.abandonedLockAcquisitions.set(abandoned.requestId, abandoned);
  const requestIds = this.abandonedLockRequestIdsByResource.get(abandoned.resource) ?? new Set();
  requestIds.add(abandoned.requestId);
  this.abandonedLockRequestIdsByResource.set(abandoned.resource, requestIds);
  while (this.abandonedLockAcquisitions.size > MAX_ABANDONED_LOCK_ACQUISITIONS) {
    const oldestRequestId = this.abandonedLockAcquisitions.keys().next().value as
      | string
      | undefined;
    if (!oldestRequestId) break;
    this.forgetAbandonedLockAcquisition(oldestRequestId);
  }
  return abandoned;
}

export function forgetAbandonedLockAcquisition(this: StudioLiveSocketTransportHost, requestId: string): void {
  const abandoned = this.abandonedLockAcquisitions.get(requestId);
  if (!abandoned) return;
  this.abandonedLockAcquisitions.delete(requestId);
  const requestIds = this.abandonedLockRequestIdsByResource.get(abandoned.resource);
  requestIds?.delete(requestId);
  if (requestIds?.size === 0) {
    this.abandonedLockRequestIdsByResource.delete(abandoned.resource);
  }
}

export function pruneAbandonedLockAcquisitions(this: StudioLiveSocketTransportHost): void {
  const now = this.now();
  for (const abandoned of Array.from(this.abandonedLockAcquisitions.values())) {
    if (abandoned.discardAt > now) continue;
    this.forgetAbandonedLockAcquisition(abandoned.requestId);
  }
}

export function findAbandonedLockAcquisition(this: StudioLiveSocketTransportHost,
      resource: string,
    requestId: string | undefined,
    matchesKnownLease: boolean): AbandonedLockAcquisition | null {
  this.pruneAbandonedLockAcquisitions();
  if (requestId) {
    const exact = this.abandonedLockAcquisitions.get(requestId);
    return exact?.resource === resource ? exact : null;
  }
  // An uncorrelated snapshot that repeats the already accepted lease is legitimate. An unknown
  // self lease while an abandoned lifecycle remains is fail-closed and must be rolled back.
  if (matchesKnownLease) return null;
  const requestIds = this.abandonedLockRequestIdsByResource.get(resource);
  if (!requestIds) return null;
  const newest = Array.from(requestIds).at(-1);
  return newest ? this.abandonedLockAcquisitions.get(newest) ?? null : null;
}

export function abandonPendingLockAcquisitionForRelease(this: StudioLiveSocketTransportHost, resource: string): void {
  const requestId = this.pendingLockRequestByResource.get(resource);
  if (!requestId) return;
  const pending = this.pendingLockAcquisitions.get(requestId);
  if (!pending || !this.removePendingLockAcquisition(pending)) return;
  const abandoned = this.rememberAbandonedLockAcquisition(pending);
  const deferred = this.deferredSelfLocks.get(resource);
  if (deferred) this.rollbackDeferredSelfLock(deferred, abandoned);
  pending.resolve({
    status: "revoked",
    resource,
    requestId: pending.request.requestId,
    code: "release_pending",
    message: "사용자가 편집 잠금 해제를 요청해 진행 중인 갱신을 취소했습니다.",
  });
}

export function completePendingLockRelease(this: StudioLiveSocketTransportHost, pending: PendingLockRelease, value: unknown): void {
  if (this.pendingLockReleases.get(pending.request.resource) !== pending) return;
  this.removePendingLockRelease(pending);
  const settleLocalFence = () => {
    this.applyAuthoritativeRelease(pending.request.resource, pending.request.claimId);
  };

  if (
    this.closed ||
    !this.ready ||
    pending.joinGeneration !== this.joinGeneration ||
    pending.selfConnectionId !== this.selfConnectionId
  ) {
    settleLocalFence();
    pending.resolve({
      status: "revoked",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      code: "connection_changed",
      message: "팀 연결이 변경되어 편집 잠금 해제 확인을 중단했습니다.",
    });
    return;
  }

  const echoedRequestId = this.lockAckRequestId(value);
  if (
    this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION &&
    echoedRequestId !== pending.request.requestId
  ) {
    settleLocalFence();
    const message = "팀 서버의 편집 잠금 해제 응답 식별자가 요청과 일치하지 않습니다.";
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      code: "response_mismatch",
      message,
    });
    this.emitStatus({ state: "error", message, recoverable: true });
    if (this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }

  const failure = parseFailure(value);
  if (failure) {
    settleLocalFence();
    const revoked = failure.code === "unauthenticated" || failure.code === "access_revoked";
    pending.resolve(
      revoked
        ? {
            status: "revoked",
            resource: pending.request.resource,
            requestId: pending.request.requestId,
            claimId: pending.request.claimId,
            code: failure.code,
            message: failure.message,
          }
        : {
            status: "denied",
            resource: pending.request.resource,
            requestId: pending.request.requestId,
            claimId: pending.request.claimId,
            code: failure.code,
            message: failure.message,
          }
    );
    this.handleFailure(failure, "operation");
    return;
  }

  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    settleLocalFence();
    const message = "팀 서버의 편집 잠금 해제 응답 형식이 올바르지 않습니다.";
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      code: "invalid_response",
      message,
    });
    this.emitStatus({ state: "error", message, recoverable: true });
    if (this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }
  const data = value.data;
  const v2ResponseMatches =
    data.requestId === pending.request.requestId &&
    data.resourceId === pending.request.resource &&
    data.leaseId === pending.request.claimId;
  const releaseRevision = data.revision === undefined
    ? null
    : parseLockRevision(data.revision);
  const revisionResponseValid =
    (data.revision === undefined || releaseRevision !== null) &&
    (this.lockRevisions.lockRevisionVersion !== STUDIO_LIVE_LOCK_REVISION_VERSION ||
      data.released !== true ||
      releaseRevision !== null);
  if (
    typeof data.released !== "boolean" ||
    (this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION && !v2ResponseMatches) ||
    !revisionResponseValid
  ) {
    settleLocalFence();
    const message = "팀 서버의 편집 잠금 해제 응답 범위가 요청과 일치하지 않습니다.";
    pending.resolve({
      status: "denied",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      code: "invalid_response",
      message,
    });
    this.emitStatus({ state: "error", message, recoverable: true });
    if (this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION) {
      this.restartJoinAfterUnsafeSnapshot();
    }
    return;
  }
  if (
    data.released &&
    this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION
  ) {
    const ordering = acceptStudioLiveLockRevision(this.lockRevisions, {
      resourceId: pending.request.resource,
      revision: releaseRevision ?? undefined,
      family: "destructive",
    });
    if (ordering === "unsafe") {
      settleLocalFence();
      const message = "편집 잠금 해제 순서를 확인할 수 없어 최신 팀 상태를 다시 불러옵니다.";
      pending.resolve({
        status: "denied",
        resource: pending.request.resource,
        requestId: pending.request.requestId,
        claimId: pending.request.claimId,
        code: "invalid_response",
        message,
      });
      this.restartJoinAfterUnsafeSnapshot();
      return;
    }
  }
  settleLocalFence();
  pending.resolve({
    status: "released",
    resource: pending.request.resource,
    requestId: pending.request.requestId,
    claimId: pending.request.claimId,
    released: data.released,
  });
}

export function removePendingLockRelease(this: StudioLiveSocketTransportHost, pending: PendingLockRelease): boolean {
  if (this.pendingLockReleases.get(pending.request.resource) !== pending) return false;
  this.pendingLockReleases.delete(pending.request.resource);
  if (this.pendingLockReleaseByRequestId.get(pending.request.requestId) === pending) {
    this.pendingLockReleaseByRequestId.delete(pending.request.requestId);
  }
  if (pending.timeout !== null) this.cancelTimeout(pending.timeout);
  pending.timeout = null;
  return true;
}

export function revokePendingLockReleases(this: StudioLiveSocketTransportHost, code: string, message: string): void {
  for (const pending of Array.from(this.pendingLockReleases.values())) {
    if (!this.removePendingLockRelease(pending)) continue;
    this.applyAuthoritativeRelease(pending.request.resource, pending.request.claimId);
    pending.resolve({
      status: "revoked",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      claimId: pending.request.claimId,
      code,
      message,
    });
  }
}

export function revokePendingLockAcquisitions(this: StudioLiveSocketTransportHost, code: string, message: string): void {
  for (const pending of Array.from(this.pendingLockAcquisitions.values())) {
    if (!this.removePendingLockAcquisition(pending)) continue;
    pending.resolve({
      status: "revoked",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code,
      message,
    });
  }
  this.deferredSelfLocks.clear();
  this.abandonedLockAcquisitions.clear();
  this.abandonedLockRequestIdsByResource.clear();
}

export function abandonPendingLockAcquisitionsForResync(this: StudioLiveSocketTransportHost): void {
  for (const pending of Array.from(this.pendingLockAcquisitions.values())) {
    if (!this.removePendingLockAcquisition(pending)) continue;
    const abandoned = this.rememberAbandonedLockAcquisition(pending);
    const deferred = this.deferredSelfLocks.get(pending.request.resource);
    if (deferred) this.rollbackDeferredSelfLock(deferred, abandoned);
    pending.resolve({
      status: "revoked",
      resource: pending.request.resource,
      requestId: pending.request.requestId,
      code: "lock_resync",
      message: "편집 잠금 순서를 다시 확인해야 해 진행 중인 요청을 취소했습니다.",
    });
  }
}

export function rollbackAbandonedLock(this: StudioLiveSocketTransportHost,
      abandoned: AbandonedLockAcquisition,
    lock: ServerLock): void {
  const canChaseAcrossRevisionResync =
    this.lockRevisions.lockRevisionVersion === STUDIO_LIVE_LOCK_REVISION_VERSION &&
    this.socket.connected &&
    abandoned.selfConnectionId === this.selfConnectionId;
  if (
    this.pendingLockRequestByResource.has(lock.resourceId) ||
    abandoned.selfConnectionId !== this.selfConnectionId ||
    (!canChaseAcrossRevisionResync &&
      (abandoned.joinGeneration !== this.joinGeneration || !this.ready))
  ) {
    this.deferredSelfLocks.set(lock.resourceId, {
      lock,
      abandonedRequestId: abandoned.requestId,
    });
    return;
  }
  this.forgetAbandonedLockAcquisition(abandoned.requestId);
  this.deferredSelfLocks.delete(lock.resourceId);
  this.releaseLockFenceBestEffort(lock, abandoned.requestId);
}

export function rollbackDeferredSelfLock(this: StudioLiveSocketTransportHost,
      deferred: DeferredSelfLock,
    fallback: AbandonedLockAcquisition | null = null): void {
  const exact = deferred.abandonedRequestId
    ? this.abandonedLockAcquisitions.get(deferred.abandonedRequestId) ?? null
    : null;
  const abandoned = exact ?? fallback;
  if (abandoned?.resource === deferred.lock.resourceId) {
    this.rollbackAbandonedLock(abandoned, deferred.lock);
    return;
  }
  this.deferredSelfLocks.delete(deferred.lock.resourceId);
}

export function settleDeferredSelfLock(this: StudioLiveSocketTransportHost, resource: string, acceptedLock: ServerLock | null = null): void {
  const deferred = this.deferredSelfLocks.get(resource);
  if (!deferred) return;
  if (
    acceptedLock &&
    deferred.lock.leaseId === acceptedLock.leaseId &&
    deferred.lock.ownerConnectionId === acceptedLock.ownerConnectionId
  ) {
    if (deferred.abandonedRequestId) {
      this.forgetAbandonedLockAcquisition(deferred.abandonedRequestId);
    }
    this.deferredSelfLocks.delete(resource);
    return;
  }
  this.rollbackDeferredSelfLock(deferred);
}

export function releaseLockFenceBestEffort(this: StudioLiveSocketTransportHost, lock: ServerLock, requestId: string): void {
  this.emitWithAck(
    "studio:lock:release",
    {
      workId: this.context.workId,
      resourceId: lock.resourceId,
      leaseId: lock.leaseId,
      ...(this.lockProtocolVersion >= STUDIO_LIVE_LOCK_PROTOCOL_VERSION ? { requestId } : {}),
    },
    () => this.applyAuthoritativeRelease(lock.resourceId, lock.leaseId)
  );
}
