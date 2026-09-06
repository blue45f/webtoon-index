/**
 * Studio Semantic Lock Manager — 웹툰 제작 공정(콘티·3D·선화·채색·식자·검수)에 따른
 * 의미 객체(에피소드, 씬, 컷, 레이어, 샷, 대사) 단위의 잠금 관리 코어.
 *
 * 마스터플랜 11.3 (Semantic Lock) & 41개 경쟁제품 기능 갭 전수 비교:
 * - Hard Lock / Soft Lock / Lease Lock (TTL 자동 만료) / Role-based Lock / Approved Version Lock
 * - 작업자, 역할, 잠금 사유, 획득 시각, 만료 시각 관리
 * - 권한 검사 (특정 대상 편집 가능 여부, 제안 모드 강제 여부)
 * - 관리자(Admin/PD) 강제 회수(Force Revoke) 및 임대 연장(Lease Renew)
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_SEMANTIC_LOCK_VERSION = 1 as const;

export const STUDIO_SEMANTIC_LOCK_LIMITS = Object.freeze({
  maxLocks: 10_000,
  maxLeaseDurationSeconds: 86_400, // 24 hours
  defaultLeaseDurationSeconds: 1_800, // 30 mins
  maxIdLength: 128,
  maxReasonLength: 320,
  maxDiagnostics: 256,
});

export const SEMANTIC_LOCK_KINDS = [
  "hard",
  "soft",
  "lease",
  "reservation",
  "role-based",
  "approved-version",
] as const;
export type SemanticLockKind = (typeof SEMANTIC_LOCK_KINDS)[number];

export const PRODUCTION_ROLES = [
  "owner",
  "admin",
  "pd",
  "storyboard",
  "3d-layout",
  "lineart",
  "colorist",
  "letterer",
  "reviewer",
  "guest",
] as const;
export type ProductionRole = (typeof PRODUCTION_ROLES)[number];

export const LOCK_TARGET_KINDS = [
  "episode",
  "scene",
  "panel",
  "layer",
  "shot",
  "component",
  "dialogue",
] as const;
export type LockTargetKind = (typeof LOCK_TARGET_KINDS)[number];

export interface SemanticLockEntry {
  readonly id: string;
  readonly targetId: string;
  readonly targetKind: LockTargetKind;
  readonly kind: SemanticLockKind;
  readonly holderUserId: string;
  readonly holderRole: ProductionRole;
  readonly reason?: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs?: number; // For lease locks
  readonly allowedRoles?: readonly ProductionRole[]; // For role-based locks
}

export interface StudioSemanticLockTable {
  readonly version: typeof STUDIO_SEMANTIC_LOCK_VERSION;
  readonly id: string;
  readonly locks: readonly SemanticLockEntry[];
}

export interface LockPermissionCheckResult {
  readonly allowed: boolean;
  readonly activeLock?: SemanticLockEntry;
  readonly reason: string;
  readonly suggestionOnly: boolean;
}

export function createStudioSemanticLockTable(params: {
  id: string;
  locks?: readonly SemanticLockEntry[];
}): StudioSemanticLockTable {
  return Object.freeze({
    version: STUDIO_SEMANTIC_LOCK_VERSION,
    id: params.id.trim(),
    locks: Object.freeze([...(params.locks ?? [])]),
  });
}

export function isLockExpired(lock: SemanticLockEntry, nowMs: number): boolean {
  if (lock.kind !== "lease" || lock.expiresAtMs === undefined) return false;
  return nowMs >= lock.expiresAtMs;
}

export function purgeExpiredLeases(
  table: StudioSemanticLockTable,
  nowMs: number,
): StudioSemanticLockTable {
  const active = table.locks.filter((l) => !isLockExpired(l, nowMs));
  if (active.length === table.locks.length) return table;
  return { ...table, locks: Object.freeze(active) };
}

export function acquireSemanticLock(
  table: StudioSemanticLockTable,
  request: {
    id: string;
    targetId: string;
    targetKind: LockTargetKind;
    kind: SemanticLockKind;
    holderUserId: string;
    holderRole: ProductionRole;
    reason?: string;
    durationSeconds?: number;
    allowedRoles?: readonly ProductionRole[];
    nowMs: number;
  },
): { readonly table: StudioSemanticLockTable; readonly lock: SemanticLockEntry } {
  const cleaned = purgeExpiredLeases(table, request.nowMs);
  const existing = cleaned.locks.find(
    (l) => l.targetId === request.targetId && !isLockExpired(l, request.nowMs),
  );

  if (existing) {
    if (existing.holderUserId === request.holderUserId) {
      // Same user: update/renew lock
      const duration = request.durationSeconds ?? STUDIO_SEMANTIC_LOCK_LIMITS.defaultLeaseDurationSeconds;
      const updated: SemanticLockEntry = {
        ...existing,
        kind: request.kind,
        reason: request.reason ?? existing.reason,
        expiresAtMs:
          request.kind === "lease" ? request.nowMs + duration * 1000 : undefined,
      };
      const nextLocks = cleaned.locks.map((l) => (l.id === existing.id ? updated : l));
      return { table: { ...cleaned, locks: Object.freeze(nextLocks) }, lock: updated };
    }
    // Conflict
    if (existing.kind === "hard" || existing.kind === "approved-version" || existing.kind === "lease") {
      throw new Error(
        `Target ${request.targetId} is already locked by user ${existing.holderUserId} (${existing.kind})`,
      );
    }
  }

  const duration = request.durationSeconds ?? STUDIO_SEMANTIC_LOCK_LIMITS.defaultLeaseDurationSeconds;
  const newLock: SemanticLockEntry = Object.freeze({
    id: request.id.trim(),
    targetId: request.targetId.trim(),
    targetKind: request.targetKind,
    kind: request.kind,
    holderUserId: request.holderUserId.trim(),
    holderRole: request.holderRole,
    reason: request.reason?.trim(),
    acquiredAtMs: request.nowMs,
    expiresAtMs:
      request.kind === "lease" ? request.nowMs + duration * 1000 : undefined,
    allowedRoles: request.allowedRoles ? Object.freeze([...request.allowedRoles]) : undefined,
  });

  return {
    table: { ...cleaned, locks: Object.freeze([...cleaned.locks, newLock]) },
    lock: newLock,
  };
}

export function releaseSemanticLock(
  table: StudioSemanticLockTable,
  lockId: string,
  userId: string,
): StudioSemanticLockTable {
  const lock = table.locks.find((l) => l.id === lockId);
  if (!lock) return table;
  if (lock.holderUserId !== userId) {
    throw new Error(`User ${userId} is not the holder of lock ${lockId}`);
  }
  const nextLocks = table.locks.filter((l) => l.id !== lockId);
  return { ...table, locks: Object.freeze(nextLocks) };
}

export function forceRevokeSemanticLock(
  table: StudioSemanticLockTable,
  lockId: string,
  adminUserId: string,
  adminRole: ProductionRole,
): StudioSemanticLockTable {
  if (adminRole !== "owner" && adminRole !== "admin" && adminRole !== "pd") {
    throw new Error(`Role ${adminRole} is not authorized to force revoke locks`);
  }
  const nextLocks = table.locks.filter((l) => l.id !== lockId);
  return { ...table, locks: Object.freeze(nextLocks) };
}

export function renewSemanticLease(
  table: StudioSemanticLockTable,
  lockId: string,
  userId: string,
  extraSeconds: number,
  nowMs: number,
): StudioSemanticLockTable {
  const index = table.locks.findIndex((l) => l.id === lockId);
  if (index === -1) {
    throw new Error(`Lock ${lockId} not found`);
  }
  const lock = table.locks[index];
  if (lock.holderUserId !== userId) {
    throw new Error(`User ${userId} cannot renew lock held by ${lock.holderUserId}`);
  }
  if (lock.kind !== "lease") {
    throw new Error(`Lock ${lockId} is not a lease lock`);
  }

  const newExpiry = (lock.expiresAtMs ?? nowMs) + extraSeconds * 1000;
  const updated: SemanticLockEntry = { ...lock, expiresAtMs: newExpiry };
  const nextLocks = [...table.locks];
  nextLocks[index] = Object.freeze(updated);
  return { ...table, locks: Object.freeze(nextLocks) };
}

/**
 * 특정 사용자가 특정 의미 객체를 편집할 수 있는지 권한을 확인한다.
 */
export function checkSemanticLockPermission(
  table: StudioSemanticLockTable,
  targetId: string,
  userId: string,
  userRole: ProductionRole,
  nowMs: number,
): LockPermissionCheckResult {
  const activeLock = table.locks.find(
    (l) => l.targetId === targetId && !isLockExpired(l, nowMs),
  );

  if (!activeLock) {
    return {
      allowed: true,
      reason: "잠금 없음 (편집 가능)",
      suggestionOnly: false,
    };
  }

  // 1. 잠금 소유자 본인
  if (activeLock.holderUserId === userId) {
    return {
      allowed: true,
      activeLock,
      reason: "본인이 획득한 잠금",
      suggestionOnly: false,
    };
  }

  // 2. 승인 완료 동결 잠금
  if (activeLock.kind === "approved-version") {
    return {
      allowed: false,
      activeLock,
      reason: "승인 완료된 버전으로 동결됨 (PD/Admin 승인 취소 필요)",
      suggestionOnly: true,
    };
  }

  // 3. Hard / Lease Lock
  if (activeLock.kind === "hard" || activeLock.kind === "lease") {
    return {
      allowed: false,
      activeLock,
      reason: `작업자(${activeLock.holderUserId})가 전용 편집 중`,
      suggestionOnly: true,
    };
  }

  // 4. Role-based Lock
  if (activeLock.kind === "role-based") {
    const isRoleAllowed = activeLock.allowedRoles?.includes(userRole) ?? false;
    if (isRoleAllowed) {
      return {
        allowed: true,
        activeLock,
        reason: `역할(${userRole})에 허용된 잠금`,
        suggestionOnly: false,
      };
    }
    return {
      allowed: false,
      activeLock,
      reason: `지정된 역할만 편집 가능 (필요 역할: ${activeLock.allowedRoles?.join(", ")})`,
      suggestionOnly: true,
    };
  }

  // 5. Soft Lock (권고 잠금: 알림 표시 후 편집 허용)
  return {
    allowed: true,
    activeLock,
    reason: `작업자(${activeLock.holderUserId})가 작업 중 (소프트 잠금)`,
    suggestionOnly: false,
  };
}
