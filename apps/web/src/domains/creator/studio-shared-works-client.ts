import {
  STUDIO_TEAM_ROLES,
  STUDIO_TEAM_STATUSES,
  type StudioTeamCapabilities,
  type StudioTeamRole,
  type StudioTeamStatus,
} from "./studio-team-client";

import { api, toApiError } from "@/src/infrastructure/api";


export const STUDIO_SHARED_WORKS_PATH = "/creator/team/works";
export const STUDIO_SHARED_WORKS_PAGE_SIZE = 50;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = STUDIO_SHARED_WORKS_PAGE_SIZE;
const MAX_RESPONSE_SCAN = 200;
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 240;
const MAX_NAME_LENGTH = 120;
const MAX_CURSOR_LENGTH = 512;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

export type StudioSharedWorkAccess = "edit" | "comment" | "view";
export type StudioSharedWorkFormat = "cuttoon" | "upload";

export interface StudioSharedWork {
  workId: string;
  title: string;
  format: StudioSharedWorkFormat;
  owner: {
    name: string;
  };
  role: StudioTeamRole;
  status: StudioTeamStatus;
  capabilities: StudioTeamCapabilities;
  access: StudioSharedWorkAccess;
  updatedAt: string;
}

export interface StudioSharedWorksPage {
  items: StudioSharedWork[];
  nextCursor: string | null;
}

export interface GetStudioSharedWorksOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface StudioSharedWorksRequestScope {
  authScopeKey: string;
}

export class StudioSharedWorksResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioSharedWorksResponseContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactOwnKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

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

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value ?? DEFAULT_LIMIT)));
}

function isRole(value: unknown): value is StudioTeamRole {
  return typeof value === "string" && (STUDIO_TEAM_ROLES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is StudioTeamStatus {
  return typeof value === "string" && (STUDIO_TEAM_STATUSES as readonly string[]).includes(value);
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
    // 공유 작품 목록에는 초대 동의 식별자가 없으므로 응답 권한을 전달하지 않는다.
    respondInvite: false,
  };
}

/**
 * 서버 capability와 역할을 함께 확인한다. 한쪽만 잘못 넓어져도 편집 권한으로 승격하지 않는다.
 */
export function sharedWorkAccess(
  role: StudioTeamRole,
  status: StudioTeamStatus,
  capabilities: StudioTeamCapabilities
): StudioSharedWorkAccess | null {
  if (status !== "active" || !capabilities.view) return null;
  if (
    capabilities.edit &&
    (role === "owner" || role === "admin" || role === "editor")
  ) {
    return "edit";
  }
  if (capabilities.comment && role === "commenter") return "comment";
  return "view";
}

export function canSaveStudioSharedWork(work: StudioSharedWork): boolean {
  return work.access === "edit";
}

function normalizeSharedWork(value: unknown): StudioSharedWork | null {
  if (
    !hasExactOwnKeys(value, [
      "workId",
      "title",
      "format",
      "owner",
      "role",
      "status",
      "capabilities",
      "updatedAt",
    ]) ||
    !hasExactOwnKeys(value.owner, ["name"]) ||
    !hasExactOwnKeys(value.capabilities, ["view", "comment", "edit", "manageMembers"])
  ) {
    return null;
  }
  const workId = exactId(value.workId);
  const updatedAt = safeIsoDate(value.updatedAt);
  if (
    !workId ||
    !updatedAt ||
    typeof value.title !== "string" ||
    (value.format !== "cuttoon" && value.format !== "upload") ||
    !isRole(value.role) ||
    !isStatus(value.status) ||
    typeof value.capabilities.view !== "boolean" ||
    typeof value.capabilities.comment !== "boolean" ||
    typeof value.capabilities.edit !== "boolean" ||
    typeof value.capabilities.manageMembers !== "boolean" ||
    typeof value.owner.name !== "string" ||
    !value.owner.name.trim()
  ) {
    return null;
  }

  const capabilities = normalizeCapabilities(value.capabilities);
  const access = sharedWorkAccess(value.role, value.status, capabilities);
  if (!access) return null;

  return {
    workId,
    title: safeText(value.title, "제목 없는 작품", MAX_TITLE_LENGTH),
    format: value.format,
    owner: { name: safeText(value.owner.name, "이름 없는 작가", MAX_NAME_LENGTH) },
    role: value.role,
    status: value.status,
    capabilities,
    access,
    updatedAt,
  };
}

/**
 * 최신순 서버 응답을 보존하면서 중복·비활성·열람 불가 항목을 제거한다.
 * 비어 있지 않은 응답이 전부 손상됐을 때는 오해를 부르는 빈 상태 대신 계약 오류를 표시한다.
 */
export function normalizeStudioSharedWorks(
  value: unknown,
  limit = DEFAULT_LIMIT
): StudioSharedWork[] {
  if (!Array.isArray(value)) {
    throw new StudioSharedWorksResponseContractError("공유 작품 응답 형식이 올바르지 않습니다.");
  }

  const result: StudioSharedWork[] = [];
  const seen = new Set<string>();
  const limitValue = boundedLimit(limit);
  for (const candidate of value.slice(0, MAX_RESPONSE_SCAN)) {
    const work = normalizeSharedWork(candidate);
    if (!work || seen.has(work.workId)) continue;
    seen.add(work.workId);
    result.push(work);
    if (result.length >= limitValue) break;
  }
  if (value.length > 0 && result.length === 0) {
    throw new StudioSharedWorksResponseContractError(
      "공유 작품 응답에 열 수 있는 항목이 없습니다."
    );
  }
  return result;
}

function normalizeCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !CURSOR_PATTERN.test(value)
  ) {
    return undefined;
  }
  // Cursor는 서버가 발급한 opaque 값이다. trim/decode/re-encode하지 않고 정확히 보존한다.
  return value;
}

export function normalizeStudioSharedWorksPage(
  value: unknown,
  limit = DEFAULT_LIMIT,
  requestedCursor?: string
): StudioSharedWorksPage {
  if (!hasExactOwnKeys(value, ["items", "nextCursor"]) || !Array.isArray(value.items)) {
    throw new StudioSharedWorksResponseContractError("공유 작품 페이지 응답 형식이 올바르지 않습니다.");
  }
  const nextCursor = normalizeCursor(value.nextCursor);
  if (nextCursor === undefined) {
    throw new StudioSharedWorksResponseContractError("공유 작품의 다음 페이지 정보를 확인하지 못했습니다.");
  }
  if (requestedCursor !== undefined && nextCursor === requestedCursor) {
    throw new StudioSharedWorksResponseContractError("공유 작품 페이지가 같은 위치를 반복했습니다.");
  }
  return {
    items: normalizeStudioSharedWorks(value.items, limit),
    nextCursor,
  };
}

/** 기존 항목 순서를 유지하고 다음 페이지의 새 작품만 덧붙인다. */
export function mergeStudioSharedWorks(
  current: StudioSharedWork[],
  incoming: StudioSharedWork[]
): StudioSharedWork[] {
  const seen = new Set(current.map(({ workId }) => workId));
  const merged = [...current];
  for (const work of incoming) {
    if (seen.has(work.workId)) continue;
    seen.add(work.workId);
    merged.push(work);
  }
  return merged;
}

export function isStudioSharedWorksScopeCurrent(
  requestScope: StudioSharedWorksRequestScope,
  currentScope: { authScopeKey: string | null }
): boolean {
  return currentScope.authScopeKey !== null && requestScope.authScopeKey === currentScope.authScopeKey;
}

export async function getStudioSharedWorks({
  limit = DEFAULT_LIMIT,
  cursor,
  signal,
}: GetStudioSharedWorksOptions = {}): Promise<StudioSharedWorksPage> {
  const limitValue = boundedLimit(limit);
  const cleanCursor = cursor && cursor.trim() ? cursor.trim() : undefined;
  try {
    const payload = await api.get<unknown>(STUDIO_SHARED_WORKS_PATH, {
      params: cleanCursor ? { limit: limitValue, cursor: cleanCursor } : { limit: limitValue },
      signal,
    });
    return normalizeStudioSharedWorksPage(payload, limitValue, cleanCursor);
  } catch (error) {
    if (error instanceof StudioSharedWorksResponseContractError) throw error;
    throw await toApiError(error, "공유 작품을 불러오지 못했습니다.");
  }
}
