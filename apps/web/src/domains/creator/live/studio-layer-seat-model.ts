/**
 * V18 §11/§12 layer seat model: the vocabulary + pure reducer layer for treating a layer as an
 * assignable seat.
 *
 * Two split halves:
 * - Persistent `StudioLayerAssignment` — who owns/reviews a layer and its workflow status.
 *   Lives in the document in a follow-up slice (CRDT wiring is intentionally absent here).
 * - Ephemeral `StudioLayerSeatLease` — a live session actually occupying the seat, keyed by the
 *   first-class lock resource `layer:<pageId>:<layerId>` from `studio-live-mutation-guard`.
 *
 * Everything is pure and fail-closed: invalid input, unknown status/mode, missing capability, or
 * an unparseable resource always denies — never silently permits. No transport, team-client, or
 * persistence imports; role power arrives as an explicit capabilities parameter.
 */

import { parseStudioLiveLayerLockResource } from "./studio-live-mutation-guard";

export const STUDIO_LAYER_SEAT_MODEL_VERSION = "layer-seat-model-v1" as const;

export type StudioLayerAssignmentStatus =
  | "unassigned"
  | "assigned"
  | "in-progress"
  | "review"
  | "approved";

export type StudioLayerAssignmentMode =
  | "exclusive"
  | "shared-strokes"
  | "shared-elements"
  | "review-only";

/** Persistent half: durable per-layer assignment (document-backed in a follow-up). */
export interface StudioLayerAssignment {
  readonly layerId: string;
  readonly assignedUserIds: readonly string[];
  readonly reviewerUserIds: readonly string[];
  readonly status: StudioLayerAssignmentStatus;
  readonly mode: StudioLayerAssignmentMode;
}

export type StudioLayerSeatIntent =
  | "paint"
  | "erase"
  | "transform"
  | "text"
  | "filter"
  | "merge";

/** Ephemeral half: one live session occupying the layer seat. */
export interface StudioLayerSeatLease {
  /** First-class lock resource `layer:<pageId>:<layerId>` (studio-live-mutation-guard grammar). */
  readonly resource: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly leaseId: string;
  readonly intent: StudioLayerSeatIntent;
  readonly acquiredAt: number;
  readonly leaseUntil: number;
}

/** Pending petition for a seat, resolved by handoff/takeover (or assignment edits upstream). */
export interface StudioLayerSeatRequest {
  readonly userId: string;
  readonly intent: StudioLayerSeatIntent;
  readonly requestedAt: number;
}

export interface StudioLayerSeatState {
  readonly assignment: StudioLayerAssignment;
  readonly leases: readonly StudioLayerSeatLease[];
  readonly pendingRequests: readonly StudioLayerSeatRequest[];
}

/**
 * Role power injected by the caller (team client stays un-imported). Anything other than a
 * literal `moderate: true` fails the takeover gate.
 */
export interface StudioLayerSeatActorCapabilities {
  readonly moderate: boolean;
}

export type StudioLayerSeatDenialCode =
  | "invalid-input"
  | "layer-mismatch"
  | "not-assigned"
  | "not-reviewer"
  | "wrong-status"
  | "mode-denies-intent"
  | "seat-occupied"
  | "lease-not-found"
  | "not-lease-owner"
  | "already-eligible"
  | "duplicate-request"
  | "missing-capability";

export type StudioLayerSeatTransitionResult =
  | {
      readonly ok: true;
      readonly state: StudioLayerSeatState;
      readonly lease?: StudioLayerSeatLease;
    }
  | {
      readonly ok: false;
      readonly code: StudioLayerSeatDenialCode;
      readonly reason: string;
    };

const ASSIGNMENT_STATUSES: readonly StudioLayerAssignmentStatus[] = [
  "unassigned",
  "assigned",
  "in-progress",
  "review",
  "approved",
];

const ASSIGNMENT_MODES: readonly StudioLayerAssignmentMode[] = [
  "exclusive",
  "shared-strokes",
  "shared-elements",
  "review-only",
];

const SEAT_INTENTS: readonly StudioLayerSeatIntent[] = [
  "paint",
  "erase",
  "transform",
  "text",
  "filter",
  "merge",
];

/**
 * Mode → intent gate.
 * - exclusive: every intent, single-session occupancy.
 * - shared-strokes: concurrent stroke work only (paint/erase).
 * - shared-elements: concurrent element work only (transform/text).
 * - review-only: the layer is frozen for review; every mutating seat intent is denied
 *   (annotation/commenting flows live outside the seat model).
 * filter/merge are layer-wide structural intents and therefore exclusive-only.
 */
export function studioLayerSeatModeAllowsIntent(
  mode: StudioLayerAssignmentMode,
  intent: StudioLayerSeatIntent
): boolean {
  switch (mode) {
    case "exclusive":
      return true;
    case "shared-strokes":
      return intent === "paint" || intent === "erase";
    case "shared-elements":
      return intent === "transform" || intent === "text";
    case "review-only":
      return false;
    default:
      return false;
  }
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = cleanId(raw);
    if (!id) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isFiniteAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function freezeAssignment(assignment: StudioLayerAssignment): StudioLayerAssignment {
  return Object.freeze({
    ...assignment,
    assignedUserIds: Object.freeze([...assignment.assignedUserIds]),
    reviewerUserIds: Object.freeze([...assignment.reviewerUserIds]),
  });
}

function freezeState(state: StudioLayerSeatState): StudioLayerSeatState {
  return Object.freeze({
    assignment: freezeAssignment(state.assignment),
    leases: Object.freeze(state.leases.map((lease) => Object.freeze({ ...lease }))),
    pendingRequests: Object.freeze(
      state.pendingRequests.map((request) => Object.freeze({ ...request }))
    ),
  });
}

/** Fail-closed structural validation; returns a normalized frozen assignment or null. */
export function validateStudioLayerAssignment(value: unknown): StudioLayerAssignment | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StudioLayerAssignment>;
  const layerId = cleanId(candidate.layerId);
  if (!layerId) return null;
  if (!ASSIGNMENT_STATUSES.includes(candidate.status as StudioLayerAssignmentStatus)) return null;
  if (!ASSIGNMENT_MODES.includes(candidate.mode as StudioLayerAssignmentMode)) return null;
  const assignedUserIds = uniqueIds(candidate.assignedUserIds);
  const reviewerUserIds = uniqueIds(candidate.reviewerUserIds);
  if (!assignedUserIds || !reviewerUserIds) return null;
  return freezeAssignment({
    layerId,
    assignedUserIds,
    reviewerUserIds,
    status: candidate.status as StudioLayerAssignmentStatus,
    mode: candidate.mode as StudioLayerAssignmentMode,
  });
}

/** Fail-closed lease validation: grammar, ids, intent, and a coherent time window. */
export function validateStudioLayerSeatLease(value: unknown): StudioLayerSeatLease | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StudioLayerSeatLease>;
  const resource = cleanId(candidate.resource);
  if (!resource || !parseStudioLiveLayerLockResource(resource)) return null;
  const userId = cleanId(candidate.userId);
  const sessionId = cleanId(candidate.sessionId);
  const leaseId = cleanId(candidate.leaseId);
  if (!userId || !sessionId || !leaseId) return null;
  if (!SEAT_INTENTS.includes(candidate.intent as StudioLayerSeatIntent)) return null;
  if (!isFiniteAt(candidate.acquiredAt) || !isFiniteAt(candidate.leaseUntil)) return null;
  if (candidate.leaseUntil <= candidate.acquiredAt) return null;
  return Object.freeze({
    resource,
    userId,
    sessionId,
    leaseId,
    intent: candidate.intent as StudioLayerSeatIntent,
    acquiredAt: candidate.acquiredAt,
    leaseUntil: candidate.leaseUntil,
  });
}

/** Pure lease-expiry check; non-finite `leaseUntil` counts as expired (fail closed). */
export function isStudioLayerSeatLeaseActive(
  lease: Pick<StudioLayerSeatLease, "leaseUntil">,
  now: number
): boolean {
  return Number.isFinite(lease.leaseUntil) && lease.leaseUntil > now;
}

export function pruneExpiredStudioLayerSeatLeases(
  leases: readonly StudioLayerSeatLease[],
  now: number
): readonly StudioLayerSeatLease[] {
  return leases.filter((lease) => isStudioLayerSeatLeaseActive(lease, now));
}

/** Empty seat state around a validated assignment. */
export function createStudioLayerSeatState(
  assignment: StudioLayerAssignment
): StudioLayerSeatState | null {
  const validated = validateStudioLayerAssignment(assignment);
  if (!validated) return null;
  return freezeState({ assignment: validated, leases: [], pendingRequests: [] });
}

function denied(
  code: StudioLayerSeatDenialCode,
  reason: string
): StudioLayerSeatTransitionResult {
  return Object.freeze({ ok: false as const, code, reason });
}

/**
 * Who may occupy the seat, by workflow status:
 * - unassigned → nobody (assign first).
 * - assigned / in-progress → assigned users.
 * - review → reviewers only.
 * - approved → nobody (sealed; reopening is a takeover/assignment edit).
 */
function claimEligibility(
  assignment: StudioLayerAssignment,
  userId: string
): StudioLayerSeatTransitionResult | null {
  switch (assignment.status) {
    case "unassigned":
      return denied("not-assigned", "레이어에 담당자가 지정되지 않았습니다.");
    case "assigned":
    case "in-progress":
      if (!assignment.assignedUserIds.includes(userId)) {
        return denied("not-assigned", "이 레이어의 담당자만 좌석을 점유할 수 있습니다.");
      }
      return null;
    case "review":
      if (!assignment.reviewerUserIds.includes(userId)) {
        return denied("not-reviewer", "검토 중인 레이어는 리뷰어만 점유할 수 있습니다.");
      }
      return null;
    case "approved":
      return denied("wrong-status", "승인 완료된 레이어는 좌석을 점유할 수 없습니다.");
    default:
      return denied("wrong-status", "알 수 없는 레이어 상태입니다.");
  }
}

/**
 * Claim (or renew) the seat for one session. A session holds at most one lease per layer —
 * re-claiming replaces the session's previous lease. Exclusive/review-gated occupancy denies
 * when another session holds an active lease. Claiming while `assigned` promotes the layer to
 * `in-progress`.
 */
export function claimStudioLayerSeat(input: {
  state: StudioLayerSeatState;
  resource: string;
  userId: string;
  sessionId: string;
  leaseId: string;
  intent: StudioLayerSeatIntent;
  now: number;
  leaseDurationMs: number;
}): StudioLayerSeatTransitionResult {
  const assignment = validateStudioLayerAssignment(input.state.assignment);
  if (!assignment) return denied("invalid-input", "유효하지 않은 레이어 배정 상태입니다.");
  const resource = cleanId(input.resource);
  const userId = cleanId(input.userId);
  const sessionId = cleanId(input.sessionId);
  const leaseId = cleanId(input.leaseId);
  if (!resource || !userId || !sessionId || !leaseId) {
    return denied("invalid-input", "좌석 점유 요청 필드가 비어 있습니다.");
  }
  if (!isFiniteAt(input.now) || !isFiniteAt(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    return denied("invalid-input", "유효하지 않은 좌석 임대 시간입니다.");
  }
  if (!SEAT_INTENTS.includes(input.intent)) {
    return denied("invalid-input", "알 수 없는 좌석 작업 의도입니다.");
  }
  const scope = parseStudioLiveLayerLockResource(resource);
  if (!scope || scope.layerId !== assignment.layerId) {
    return denied("layer-mismatch", "좌석 리소스가 이 레이어의 잠금 문법과 일치하지 않습니다.");
  }

  const eligibilityDenial = claimEligibility(assignment, userId);
  if (eligibilityDenial) return eligibilityDenial;

  if (!studioLayerSeatModeAllowsIntent(assignment.mode, input.intent)) {
    return denied("mode-denies-intent", "레이어 공유 모드가 이 작업 의도를 허용하지 않습니다.");
  }

  const active = pruneExpiredStudioLayerSeatLeases(input.state.leases, input.now);
  const others = active.filter((lease) => lease.sessionId !== sessionId);
  if (others.some((lease) => lease.leaseId === leaseId)) {
    return denied("invalid-input", "다른 세션이 이미 같은 임대 ID를 사용 중입니다.");
  }
  // Structural intents (filter/merge) and exclusive mode both require sole occupancy.
  const requiresSoleOccupancy =
    assignment.mode === "exclusive" || input.intent === "filter" || input.intent === "merge";
  if (requiresSoleOccupancy && others.length > 0) {
    return denied("seat-occupied", "다른 세션이 이 레이어 좌석을 점유 중입니다.");
  }

  const lease: StudioLayerSeatLease = Object.freeze({
    resource,
    userId,
    sessionId,
    leaseId,
    intent: input.intent,
    acquiredAt: input.now,
    leaseUntil: input.now + input.leaseDurationMs,
  });
  const status: StudioLayerAssignmentStatus =
    assignment.status === "assigned" ? "in-progress" : assignment.status;
  return Object.freeze({
    ok: true as const,
    lease,
    state: freezeState({
      assignment: { ...assignment, status },
      leases: [...others, lease],
      // A seated user no longer waits: consume any stale petition of theirs.
      pendingRequests: input.state.pendingRequests.filter(
        (request) => request.userId !== userId
      ),
    }),
  });
}

/** Release one lease; only the owning session may leave its own seat. Status is untouched. */
export function leaveStudioLayerSeat(input: {
  state: StudioLayerSeatState;
  leaseId: string;
  sessionId: string;
  now: number;
}): StudioLayerSeatTransitionResult {
  const leaseId = cleanId(input.leaseId);
  const sessionId = cleanId(input.sessionId);
  if (!leaseId || !sessionId || !isFiniteAt(input.now)) {
    return denied("invalid-input", "좌석 반납 요청 필드가 비어 있습니다.");
  }
  const lease = input.state.leases.find((candidate) => candidate.leaseId === leaseId);
  if (!lease) return denied("lease-not-found", "반납할 좌석 임대를 찾을 수 없습니다.");
  if (lease.sessionId !== sessionId) {
    return denied("not-lease-owner", "자신의 좌석 임대만 반납할 수 있습니다.");
  }
  const remaining = pruneExpiredStudioLayerSeatLeases(
    input.state.leases.filter((candidate) => candidate.leaseId !== leaseId),
    input.now
  );
  return Object.freeze({
    ok: true as const,
    state: freezeState({
      assignment: input.state.assignment,
      leases: [...remaining],
      pendingRequests: input.state.pendingRequests,
    }),
  });
}

/** Petition for a seat. Users who could already claim do not queue (fail closed on noise). */
export function requestStudioLayerSeat(input: {
  state: StudioLayerSeatState;
  userId: string;
  intent: StudioLayerSeatIntent;
  now: number;
}): StudioLayerSeatTransitionResult {
  const assignment = validateStudioLayerAssignment(input.state.assignment);
  if (!assignment) return denied("invalid-input", "유효하지 않은 레이어 배정 상태입니다.");
  const userId = cleanId(input.userId);
  if (!userId || !isFiniteAt(input.now)) {
    return denied("invalid-input", "좌석 요청 필드가 비어 있습니다.");
  }
  if (!SEAT_INTENTS.includes(input.intent)) {
    return denied("invalid-input", "알 수 없는 좌석 작업 의도입니다.");
  }
  if (!claimEligibility(assignment, userId)) {
    return denied("already-eligible", "이미 좌석을 점유할 수 있는 사용자입니다.");
  }
  if (input.state.pendingRequests.some((request) => request.userId === userId)) {
    return denied("duplicate-request", "이미 대기 중인 좌석 요청이 있습니다.");
  }
  const request: StudioLayerSeatRequest = Object.freeze({
    userId,
    intent: input.intent,
    requestedAt: input.now,
  });
  return Object.freeze({
    ok: true as const,
    state: freezeState({
      assignment,
      leases: input.state.leases,
      pendingRequests: [...input.state.pendingRequests, request],
    }),
  });
}

/**
 * Voluntary handoff: an assigned user cedes their assignment to another user. The departing
 * user's leases are revoked; the receiver's pending request (if any) is consumed. Workflow
 * status is preserved.
 */
export function handoffStudioLayerSeat(input: {
  state: StudioLayerSeatState;
  fromUserId: string;
  toUserId: string;
  now: number;
}): StudioLayerSeatTransitionResult {
  const assignment = validateStudioLayerAssignment(input.state.assignment);
  if (!assignment) return denied("invalid-input", "유효하지 않은 레이어 배정 상태입니다.");
  const fromUserId = cleanId(input.fromUserId);
  const toUserId = cleanId(input.toUserId);
  if (!fromUserId || !toUserId || fromUserId === toUserId || !isFiniteAt(input.now)) {
    return denied("invalid-input", "좌석 인계 요청 필드가 유효하지 않습니다.");
  }
  if (!assignment.assignedUserIds.includes(fromUserId)) {
    return denied("not-assigned", "담당자만 자신의 좌석을 인계할 수 있습니다.");
  }
  const assignedUserIds = assignment.assignedUserIds
    .filter((id) => id !== fromUserId && id !== toUserId)
    .concat(toUserId);
  const leases = pruneExpiredStudioLayerSeatLeases(
    input.state.leases.filter((lease) => lease.userId !== fromUserId),
    input.now
  );
  return Object.freeze({
    ok: true as const,
    state: freezeState({
      assignment: { ...assignment, assignedUserIds },
      leases: [...leases],
      pendingRequests: input.state.pendingRequests.filter(
        (request) => request.userId !== toUserId
      ),
    }),
  });
}

/**
 * Forced takeover — requires the `moderate` capability (explicit parameter; anything but a
 * literal `true` denies). Seizes the assignment for the taker, revokes every lease, consumes
 * the taker's pending request, and reopens the layer as `in-progress`.
 */
export function takeoverStudioLayerSeat(input: {
  state: StudioLayerSeatState;
  byUserId: string;
  capabilities: StudioLayerSeatActorCapabilities;
  now: number;
}): StudioLayerSeatTransitionResult {
  const assignment = validateStudioLayerAssignment(input.state.assignment);
  if (!assignment) return denied("invalid-input", "유효하지 않은 레이어 배정 상태입니다.");
  const byUserId = cleanId(input.byUserId);
  if (!byUserId || !isFiniteAt(input.now)) {
    return denied("invalid-input", "좌석 인수 요청 필드가 비어 있습니다.");
  }
  if (input.capabilities?.moderate !== true) {
    return denied("missing-capability", "좌석 강제 인수에는 모더레이터 권한이 필요합니다.");
  }
  return Object.freeze({
    ok: true as const,
    state: freezeState({
      assignment: {
        ...assignment,
        assignedUserIds: [byUserId],
        status: "in-progress",
      },
      leases: [],
      pendingRequests: input.state.pendingRequests.filter(
        (request) => request.userId !== byUserId
      ),
    }),
  });
}
