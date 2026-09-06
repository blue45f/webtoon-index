import { api, toApiError } from "@/src/infrastructure/api";

export const STUDIO_TEAM_ROLES = ["owner", "admin", "editor", "commenter", "viewer"] as const;
export const STUDIO_TEAM_ASSIGNABLE_ROLES = ["admin", "editor", "commenter", "viewer"] as const;
export const STUDIO_TEAM_STATUSES = ["active", "pending", "declined"] as const;
export const STUDIO_TEAM_ACTIVITY_ACTIONS = [
  "invite",
  "reinvite",
  "accept",
  "decline",
  "role_change",
  "remove",
] as const;

export type StudioTeamRole = (typeof STUDIO_TEAM_ROLES)[number];
export type StudioTeamAssignableRole = (typeof STUDIO_TEAM_ASSIGNABLE_ROLES)[number];
export type StudioTeamStatus = (typeof STUDIO_TEAM_STATUSES)[number];
export type StudioTeamActivityAction = (typeof STUDIO_TEAM_ACTIVITY_ACTIONS)[number];

export interface StudioTeamCapabilities {
  view: boolean;
  comment: boolean;
  edit: boolean;
  manageMembers: boolean;
  respondInvite: boolean;
}

export interface StudioTeamViewer {
  userId: string;
  role: StudioTeamRole;
  status: StudioTeamStatus;
  capabilities: StudioTeamCapabilities;
  invitationId?: string;
}

export interface StudioTeamMember {
  userId: string;
  name: string;
  image: string;
  role: StudioTeamRole;
  status: StudioTeamStatus;
  isOwner: boolean;
  invitationId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudioTeamSnapshot {
  workId: string;
  viewer: StudioTeamViewer;
  members: StudioTeamMember[];
}

export interface InviteStudioTeamMemberInput {
  userId: string;
  role: StudioTeamAssignableRole;
}

export type StudioTeamInvitationAction = "accept" | "decline";

export interface StudioTeamInvitationSummary {
  workId: string;
  workTitle: string;
  owner: {
    name: string;
  };
  role: StudioTeamAssignableRole;
  /** 응답 요청에만 쓰는 일회성 서버 초대 식별자. 영속 저장하지 않는다. */
  invitationId: string;
  invitedAt: string;
}

export interface StudioTeamInvitationAcknowledgement {
  workId: string;
  role: StudioTeamAssignableRole;
  status: "active" | "declined";
}

export interface StudioTeamRequestScope {
  authScopeKey: string;
  workId: string | null;
}

export interface StudioTeamActivityRequestDecision {
  open: boolean;
  loggedIn: boolean;
  authScopeKey: string | null;
  workId: string | null;
  canManageMembers: boolean;
  loadedScope: StudioTeamRequestScope | null;
  requestScope: StudioTeamRequestScope | null;
}

export type StudioTeamInboxFocusTarget =
  | { kind: "invitation"; workId: string }
  | { kind: "refresh" }
  | null;

export interface StudioTeamActivityParty {
  userId: string | null;
  name: string;
}

export interface StudioTeamActivityState {
  role: StudioTeamAssignableRole;
  status: StudioTeamStatus;
}

export interface StudioTeamActivityItem {
  id: string;
  action: StudioTeamActivityAction;
  actor: StudioTeamActivityParty;
  target: StudioTeamActivityParty;
  before: StudioTeamActivityState | null;
  after: StudioTeamActivityState | null;
  createdAt: string;
}

const TEAM_BASE = "/creator/works";
const DEFAULT_COLLECTION_LIMIT = 20;
const MAX_COLLECTION_LIMIT = 50;
const MAX_RESPONSE_SCAN = 200;
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 120;
const MAX_TITLE_LENGTH = 240;

export class StudioTeamResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioTeamResponseContractError";
  }
}

export function isStudioTeamResponseContractError(
  error: unknown
): error is StudioTeamResponseContractError {
  return error instanceof StudioTeamResponseContractError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTeamRole(value: unknown): value is StudioTeamRole {
  return typeof value === "string" && (STUDIO_TEAM_ROLES as readonly string[]).includes(value);
}

function isTeamStatus(value: unknown): value is StudioTeamStatus {
  return typeof value === "string" && (STUDIO_TEAM_STATUSES as readonly string[]).includes(value);
}

function isAssignableTeamRole(value: unknown): value is StudioTeamAssignableRole {
  return (
    typeof value === "string" &&
    (STUDIO_TEAM_ASSIGNABLE_ROLES as readonly string[]).includes(value)
  );
}

function isActivityAction(value: unknown): value is StudioTeamActivityAction {
  return (
    typeof value === "string" &&
    (STUDIO_TEAM_ACTIVITY_ACTIONS as readonly string[]).includes(value)
  );
}

/** 식별자는 검증만 하고 trim/재작성하지 않아 서버가 준 정확한 값을 보존한다. */
function exactId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) return null;
  return value.trim().length > 0 ? value : null;
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function safeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function collectionLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_COLLECTION_LIMIT;
  return Math.min(MAX_COLLECTION_LIMIT, Math.max(1, Math.trunc(value ?? DEFAULT_COLLECTION_LIMIT)));
}

function normalizeCapabilities(value: unknown): StudioTeamCapabilities {
  if (!isRecord(value)) {
    return { view: false, comment: false, edit: false, manageMembers: false, respondInvite: false };
  }
  return {
    view: value.view === true,
    comment: value.comment === true,
    edit: value.edit === true,
    manageMembers: value.manageMembers === true,
    respondInvite: value.respondInvite === true,
  };
}

function noStudioTeamCapabilities(): StudioTeamCapabilities {
  return { view: false, comment: false, edit: false, manageMembers: false, respondInvite: false };
}

function normalizeViewer(value: unknown): StudioTeamViewer {
  const userId = isRecord(value) ? exactId(value.userId) : null;
  if (!isRecord(value) || !userId) {
    throw new Error("팀 작업 공간의 사용자 권한 정보를 확인하지 못했습니다.");
  }

  const normalizedRole = isTeamRole(value.role) ? value.role : null;
  const normalizedStatus = isTeamStatus(value.status) ? value.status : null;
  const validRole = normalizedRole !== null;
  const validStatus = normalizedStatus !== null;
  const role: StudioTeamRole = normalizedRole ?? "viewer";
  const status: StudioTeamStatus = normalizedStatus ?? "declined";
  const receivedCapabilities = normalizeCapabilities(value.capabilities);
  let capabilities = noStudioTeamCapabilities();
  if (validRole && validStatus && status === "pending") {
    capabilities = { ...capabilities, respondInvite: receivedCapabilities.respondInvite };
  } else if (validRole && validStatus && status === "active") {
    capabilities = {
      ...receivedCapabilities,
      manageMembers:
        (role === "owner" || role === "admin") && receivedCapabilities.manageMembers,
      respondInvite: false,
    };
  }

  const viewer: StudioTeamViewer = {
    userId,
    // 알 수 없는 서버 값은 절대 높은 권한으로 올리지 않는다.
    role,
    status,
    capabilities,
  };
  const invitationId = normalizeInvitationId(value.invitationId);
  if (status === "pending" && capabilities.respondInvite && invitationId) {
    viewer.invitationId = invitationId;
  }
  return viewer;
}

function normalizeInvitationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // 멤버십 UPDATE가 text exact equality를 사용하므로 opaque 동의 식별자는 재작성하지 않는다.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function optionalDate(value: unknown): string | undefined {
  return safeIsoDate(value) ?? undefined;
}

function normalizeMember(value: unknown): StudioTeamMember | null {
  if (!isRecord(value)) return null;
  const userId = exactId(value.userId);
  if (!userId) return null;

  const isOwner = value.isOwner === true || value.role === "owner";
  const member: StudioTeamMember = {
    userId,
    name: safeText(value.name, userId, MAX_NAME_LENGTH),
    // 협업 API는 프로필 이미지를 전송하지 않는다. 구버전 서버가 값을 덧붙여도 보존하지 않는다.
    image: "",
    role: isOwner ? "owner" : isTeamRole(value.role) ? value.role : "viewer",
    status: isOwner ? "active" : isTeamStatus(value.status) ? value.status : "declined",
    isOwner,
  };
  const invitationId = normalizeInvitationId(value.invitationId);
  if (!isOwner && member.status === "pending" && invitationId) member.invitationId = invitationId;
  const createdAt = optionalDate(value.createdAt);
  const updatedAt = optionalDate(value.updatedAt);
  if (createdAt) member.createdAt = createdAt;
  if (updatedAt) member.updatedAt = updatedAt;
  return member;
}

/** 서버가 확장 필드를 추가해도 필요한 계약만 안전하게 추려 UI에 전달한다. */
export function normalizeStudioTeamSnapshot(
  value: unknown,
  expectedWorkId: string
): StudioTeamSnapshot {
  if (!isRecord(value)) throw new Error("팀 작업 공간 응답 형식이 올바르지 않습니다.");
  if (value.workId !== expectedWorkId) {
    throw new Error("다른 작품의 팀 권한 응답을 받았습니다. 다시 시도해 주세요.");
  }

  const membersByUserId = new Map<string, StudioTeamMember>();
  if (Array.isArray(value.members)) {
    for (const candidate of value.members.slice(0, MAX_RESPONSE_SCAN)) {
      const member = normalizeMember(candidate);
      if (member && !membersByUserId.has(member.userId)) membersByUserId.set(member.userId, member);
    }
  }

  return {
    workId: expectedWorkId,
    viewer: normalizeViewer(value.viewer),
    members: [...membersByUserId.values()],
  };
}

function normalizeInvitationSummary(value: unknown): StudioTeamInvitationSummary | null {
  if (!isRecord(value)) return null;
  const workId = exactId(value.workId);
  const invitationId = normalizeInvitationId(value.invitationId);
  const invitedAt = safeIsoDate(value.invitedAt);
  if (!workId || !invitationId || !invitedAt || !isAssignableTeamRole(value.role)) return null;
  if (!isRecord(value.owner)) return null;
  if (typeof value.owner.name !== "string" || !value.owner.name.trim()) return null;

  return {
    workId,
    workTitle: safeText(value.workTitle, "제목 없는 작품", MAX_TITLE_LENGTH),
    owner: {
      name: safeText(value.owner.name, "이름 없는 작가", MAX_NAME_LENGTH),
    },
    role: value.role,
    invitationId,
    invitedAt,
  };
}

/** 초대 목록을 최대 limit개로 제한하고 잘못되거나 중복된 항목을 버린다. */
export function normalizeStudioTeamInvitations(
  value: unknown,
  limit = DEFAULT_COLLECTION_LIMIT
): StudioTeamInvitationSummary[] {
  if (!Array.isArray(value)) {
    throw new StudioTeamResponseContractError("받은 팀 초대 응답 형식이 올바르지 않습니다.");
  }
  const boundedLimit = collectionLimit(limit);
  const result: StudioTeamInvitationSummary[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_RESPONSE_SCAN)) {
    const invitation = normalizeInvitationSummary(candidate);
    if (!invitation) continue;
    // 작품별 활성 초대는 하나이므로 최신순 응답에서 첫 항목만 유지한다.
    const key = invitation.workId;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(invitation);
    if (result.length >= boundedLimit) break;
  }
  if (value.length > 0 && result.length === 0) {
    throw new StudioTeamResponseContractError("받은 팀 초대 응답에 사용할 수 있는 항목이 없습니다.");
  }
  return result;
}

function normalizeActivityParty(value: unknown): StudioTeamActivityParty | null {
  if (!isRecord(value)) return null;
  const userId = value.userId === null ? null : exactId(value.userId);
  if (value.userId !== null && !userId) return null;
  return {
    userId,
    name: safeText(value.name, "알 수 없는 사용자", MAX_NAME_LENGTH),
  };
}

function normalizeActivityState(
  value: unknown
): StudioTeamActivityState | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isAssignableTeamRole(value.role) || !isTeamStatus(value.status)) {
    return undefined;
  }
  return { role: value.role, status: value.status };
}

function normalizeActivityItem(value: unknown): StudioTeamActivityItem | null {
  if (!isRecord(value)) return null;
  const id = exactId(value.id);
  const actor = normalizeActivityParty(value.actor);
  const target = normalizeActivityParty(value.target);
  const before = normalizeActivityState(value.before);
  const after = normalizeActivityState(value.after);
  const createdAt = safeIsoDate(value.createdAt);
  if (
    !id ||
    !actor ||
    !target ||
    before === undefined ||
    after === undefined ||
    !createdAt ||
    !isActivityAction(value.action)
  ) {
    return null;
  }

  // 서버가 invitationId 같은 필드를 덧붙여도 명시된 감사 필드만 반환한다.
  return { id, action: value.action, actor, target, before, after, createdAt };
}

/** 감사 목록은 알려진 동작·역할·상태만 통과시키며 초대 식별자를 구조적으로 제거한다. */
export function normalizeStudioTeamActivity(
  value: unknown,
  limit = DEFAULT_COLLECTION_LIMIT
): StudioTeamActivityItem[] {
  if (!Array.isArray(value)) {
    throw new StudioTeamResponseContractError("팀 변경 기록 응답 형식이 올바르지 않습니다.");
  }
  const boundedLimit = collectionLimit(limit);
  const result: StudioTeamActivityItem[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_RESPONSE_SCAN)) {
    const item = normalizeActivityItem(candidate);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= boundedLimit) break;
  }
  if (value.length > 0 && result.length === 0) {
    throw new StudioTeamResponseContractError("팀 변경 기록 응답에 사용할 수 있는 항목이 없습니다.");
  }
  return result;
}

export function normalizeStudioTeamInvitationAcknowledgement(
  value: unknown,
  expectedWorkId: string,
  action: StudioTeamInvitationAction
): StudioTeamInvitationAcknowledgement {
  if (!isRecord(value) || value.workId !== expectedWorkId || !isAssignableTeamRole(value.role)) {
    throw new StudioTeamResponseContractError("팀 초대 응답 확인 형식이 올바르지 않습니다.");
  }
  const expectedStatus = action === "accept" ? "active" : "declined";
  if (value.status !== expectedStatus) {
    throw new StudioTeamResponseContractError("팀 초대 처리 상태가 요청과 일치하지 않습니다.");
  }
  return { workId: expectedWorkId, role: value.role, status: expectedStatus };
}

function teamPath(workId: string): string {
  return `${TEAM_BASE}/${encodeURIComponent(workId)}/team`;
}

async function requestSnapshot(
  workId: string,
  run: () => Promise<unknown>,
  fallback: string
): Promise<StudioTeamSnapshot> {
  let payload: unknown;
  try {
    payload = await run();
  } catch (error) {
    throw await toApiError(error, fallback);
  }
  if (payload == null) throw new Error(fallback);
  return normalizeStudioTeamSnapshot(payload, workId);
}

function responseStatus(error: unknown): number | null {
  if (!isRecord(error) || !isRecord(error.response)) return null;
  return typeof error.response.status === "number" ? error.response.status : null;
}

export class StudioTeamInvitationStaleError extends Error {
  constructor() {
    super("초대가 이미 갱신되었습니다. 최신 초대 목록을 다시 불러옵니다.");
    this.name = "StudioTeamInvitationStaleError";
  }
}

export function isStudioTeamInvitationStaleError(
  error: unknown
): error is StudioTeamInvitationStaleError {
  return error instanceof StudioTeamInvitationStaleError;
}

export function isStudioTeamRequestScopeCurrent(
  requestScope: StudioTeamRequestScope,
  currentScope: { authScopeKey: string | null; workId: string | null }
): boolean {
  return (
    currentScope.authScopeKey !== null &&
    requestScope.authScopeKey === currentScope.authScopeKey &&
    requestScope.workId === currentScope.workId
  );
}

export function isSameStudioTeamRequestScope(
  left: StudioTeamRequestScope | null,
  right: StudioTeamRequestScope
): boolean {
  return Boolean(
    left && left.authScopeKey === right.authScopeKey && left.workId === right.workId
  );
}

export function shouldRequestStudioTeamActivity({
  open,
  loggedIn,
  authScopeKey,
  workId,
  canManageMembers,
  loadedScope,
  requestScope,
}: StudioTeamActivityRequestDecision): boolean {
  if (!open || !loggedIn || !authScopeKey || !workId || !canManageMembers) return false;
  const nextScope: StudioTeamRequestScope = { authScopeKey, workId };
  return (
    !isSameStudioTeamRequestScope(loadedScope, nextScope) &&
    !isSameStudioTeamRequestScope(requestScope, nextScope)
  );
}

export function shouldReloadStudioTeamInvitation(
  error: unknown
): error is StudioTeamInvitationStaleError {
  return isStudioTeamInvitationStaleError(error);
}

export function removeAcknowledgedStudioTeamInvitation(
  invitations: StudioTeamInvitationSummary[],
  target: Pick<StudioTeamInvitationSummary, "workId" | "invitationId">
): StudioTeamInvitationSummary[] {
  return invitations.filter(
    (invitation) =>
      invitation.workId !== target.workId || invitation.invitationId !== target.invitationId
  );
}

export function nextStudioTeamInboxFocusTarget(
  invitations: StudioTeamInvitationSummary[],
  target: Pick<StudioTeamInvitationSummary, "workId" | "invitationId">
): StudioTeamInboxFocusTarget {
  const removedIndex = invitations.findIndex(
    (invitation) =>
      invitation.workId === target.workId && invitation.invitationId === target.invitationId
  );
  const nextInvitation = removedIndex >= 0 ? invitations[removedIndex + 1] : undefined;
  return nextInvitation
    ? { kind: "invitation", workId: nextInvitation.workId }
    : { kind: "refresh" };
}

async function requestCollection<T>(
  run: () => Promise<unknown>,
  normalize: (value: unknown) => T,
  fallback: string
): Promise<T> {
  try {
    return normalize(await run());
  } catch (error) {
    if (isStudioTeamResponseContractError(error) || isStudioTeamInvitationStaleError(error)) throw error;
    throw await toApiError(error, fallback);
  }
}

export function getStudioTeam(workId: string, signal?: AbortSignal): Promise<StudioTeamSnapshot> {
  return requestSnapshot(
    workId,
    () => api.get<unknown>(teamPath(workId), { signal }),
    "팀 작업 공간을 불러오지 못했습니다."
  );
}

export function getStudioTeamInvitations(
  limit = DEFAULT_COLLECTION_LIMIT,
  signal?: AbortSignal
): Promise<StudioTeamInvitationSummary[]> {
  const boundedLimit = collectionLimit(limit);
  return requestCollection(
    () =>
      api.get<unknown>("/creator/team/invitations", {
        params: { limit: boundedLimit },
        signal,
      }),
    (value) => normalizeStudioTeamInvitations(value, boundedLimit),
    "받은 팀 초대를 불러오지 못했습니다."
  );
}

export function getStudioTeamActivity(
  workId: string,
  limit = DEFAULT_COLLECTION_LIMIT,
  signal?: AbortSignal
): Promise<StudioTeamActivityItem[]> {
  const boundedLimit = collectionLimit(limit);
  return requestCollection(
    () =>
      api.get<unknown>(`${teamPath(workId)}/activity`, {
        params: { limit: boundedLimit },
        signal,
      }),
    (value) => normalizeStudioTeamActivity(value, boundedLimit),
    "팀 변경 기록을 불러오지 못했습니다."
  );
}

export function inviteStudioTeamMember(
  workId: string,
  input: InviteStudioTeamMemberInput
): Promise<StudioTeamSnapshot> {
  return requestSnapshot(
    workId,
    () => api.post<unknown>(teamPath(workId), input),
    "팀원을 초대하지 못했습니다."
  );
}

export function updateStudioTeamMemberRole(
  workId: string,
  userId: string,
  role: StudioTeamAssignableRole
): Promise<StudioTeamSnapshot> {
  return requestSnapshot(
    workId,
    () => api.patch<unknown>(`${teamPath(workId)}/members/${encodeURIComponent(userId)}`, { role }),
    "팀원 역할을 변경하지 못했습니다."
  );
}

export function removeStudioTeamMember(
  workId: string,
  userId: string
): Promise<StudioTeamSnapshot> {
  return requestSnapshot(
    workId,
    () => api.delete<unknown>(`${teamPath(workId)}/members/${encodeURIComponent(userId)}`),
    "팀원을 내보내지 못했습니다."
  );
}

export function respondToStudioTeamInvitation(
  workId: string,
  action: StudioTeamInvitationAction,
  invitationId: string
): Promise<StudioTeamInvitationAcknowledgement> {
  const fallback = action === "accept" ? "초대를 수락하지 못했습니다." : "초대를 거절하지 못했습니다.";
  return requestCollection(
    async () => {
      try {
        return await api.post<unknown>(`${teamPath(workId)}/invitations/respond`, { action, invitationId });
      } catch (error) {
        if (responseStatus(error) === 409) throw new StudioTeamInvitationStaleError();
        throw error;
      }
    },
    (value) => normalizeStudioTeamInvitationAcknowledgement(value, workId, action),
    fallback
  );
}
