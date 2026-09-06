import { STUDIO_PROJECT_MAX_PAGES } from "./studio-project-file";
import { STUDIO_TEAM_ROLES, type StudioTeamRole } from "./studio-team-client";

import { api, isHttpError, toApiError } from "@/src/infrastructure/api";

const SHARED_DOCUMENT_BASE = "/creator/works";
const MAX_REVISION = 2_147_483_647;
const MAX_ID_LENGTH = 160;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_TAG_LENGTH = 24;
const MAX_TAGS = 8;
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

const SHARED_DOCUMENT_MUTABLE_FIELDS = [
  "title",
  "description",
  "tags",
  "titleId",
  "cover",
  "pages",
  "doc",
  "status",
] as const;

const SHARED_DOCUMENT_PATCH_FIELDS = new Set<string>([
  "baseRevision",
  "crdtServerSequence",
  ...SHARED_DOCUMENT_MUTABLE_FIELDS,
]);

const EDIT_ROLES = new Set<StudioTeamRole>(["owner", "admin", "editor"]);
const SHARED_DOCUMENT_META_FIELDS = [
  "workId",
  "role",
  "status",
  "capabilities",
  "revision",
  "crdtServerSequence",
  "updatedAt",
] as const;
const SHARED_DOCUMENT_FULL_FIELDS = [...SHARED_DOCUMENT_META_FIELDS, "document"] as const;
const SHARED_DOCUMENT_CAPABILITY_FIELDS = ["view", "edit"] as const;
const SHARED_DOCUMENT_CONTENT_FIELDS = [
  "titleId",
  "title",
  "description",
  "cover",
  "tags",
  "format",
  "pages",
  "doc",
  "status",
  "seriesId",
  "episodeNo",
  "challengeId",
  "remixFromId",
] as const;
const SHARED_DOCUMENT_SAVE_FIELDS = ["workId", "revision", "updatedAt"] as const;

export type StudioSharedDocumentFormat = "cuttoon" | "upload";
export type StudioSharedDocumentStatus = "draft" | "published";
export type StudioSharedDocumentAccess = "edit" | "comment" | "view";

export interface StudioSharedDocumentCapabilities {
  view: true;
  edit: boolean;
}

export interface StudioSharedDocumentContent {
  titleId: string | null;
  title: string;
  description: string;
  cover: string;
  tags: string[];
  format: StudioSharedDocumentFormat;
  pages: string[];
  doc: Record<string, unknown>;
  status: StudioSharedDocumentStatus;
  seriesId: string | null;
  episodeNo: number | null;
  challengeId: string | null;
  remixFromId: string | null;
}

export interface StudioSharedDocument {
  workId: string;
  role: StudioTeamRole;
  status: "active";
  capabilities: StudioSharedDocumentCapabilities;
  access: StudioSharedDocumentAccess;
  revision: number;
  crdtServerSequence: string;
  updatedAt: string;
  document: StudioSharedDocumentContent;
}

export type StudioSharedDocumentMeta = Omit<StudioSharedDocument, "document">;

export type StudioSharedDocumentMutableContent = Pick<
  StudioSharedDocumentContent,
  (typeof SHARED_DOCUMENT_MUTABLE_FIELDS)[number]
>;

export type UpdateStudioSharedDocumentInput = {
  baseRevision: number;
  crdtServerSequence: string;
} & Partial<StudioSharedDocumentMutableContent>;

export interface StudioSharedDocumentSaveResponse {
  workId: string;
  revision: number;
  updatedAt: string;
}

export interface StudioSharedDocumentRequestScope {
  authScopeKey: string;
  workId: string;
}

export class StudioSharedDocumentResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioSharedDocumentResponseContractError";
  }
}

export class StudioSharedDocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioSharedDocumentInputError";
  }
}

export class StudioSharedDocumentRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("다른 팀원이 먼저 저장했습니다. 최신 공동 문서를 다시 불러온 뒤 변경 내용을 확인해 주세요.");
    this.name = "StudioSharedDocumentRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

export class StudioSharedDocumentCrdtSequenceConflictError extends Error {
  readonly currentCrdtServerSequence: string;

  constructor(currentCrdtServerSequence: string) {
    super("동기화 확인 후 다른 팀 편집이 먼저 저장됐습니다. 최신 원고를 맞춘 뒤 다시 저장해 주세요.");
    this.name = "StudioSharedDocumentCrdtSequenceConflictError";
    this.currentCrdtServerSequence = currentCrdtServerSequence;
  }
}

export class StudioSharedDocumentAccessError extends Error {
  readonly status: 401 | 403 | 404;

  constructor(status: 401 | 403 | 404, message: string, cause: unknown) {
    super(message, { cause });
    this.name = "StudioSharedDocumentAccessError";
    this.status = status;
  }
}

export function isStudioSharedDocumentAccessError(
  error: unknown
): error is StudioSharedDocumentAccessError {
  return error instanceof StudioSharedDocumentAccessError;
}

export function isStudioSharedDocumentRevisionConflictError(
  error: unknown
): error is StudioSharedDocumentRevisionConflictError {
  return error instanceof StudioSharedDocumentRevisionConflictError;
}

export function isStudioSharedDocumentCrdtSequenceConflictError(
  error: unknown
): error is StudioSharedDocumentCrdtSequenceConflictError {
  return error instanceof StudioSharedDocumentCrdtSequenceConflictError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasExactOwnKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && keys.every((key) => hasOwn(record, key));
}

/** 식별자는 검증만 하고 재작성하지 않아 opaque 서버 식별자를 정확히 보존한다. */
function exactId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) return null;
  return value.trim().length > 0 ? value : null;
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return exactId(value) ?? undefined;
}

function revision(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_REVISION
    ? value
    : null;
}

function postgresBigintSequence(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,18})$/.test(value)
  ) {
    return null;
  }
  return BigInt(value) <= POSTGRES_BIGINT_MAX ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is StudioTeamRole {
  return typeof value === "string" && (STUDIO_TEAM_ROLES as readonly string[]).includes(value);
}

function isFormat(value: unknown): value is StudioSharedDocumentFormat {
  return value === "cuttoon" || value === "upload";
}

function isDocumentStatus(value: unknown): value is StudioSharedDocumentStatus {
  return value === "draft" || value === "published";
}

function stringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength?: number
): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  if (
    value.some(
      (item) =>
        typeof item !== "string" ||
        (maximumItemLength !== undefined && item.length > maximumItemLength)
    )
  ) {
    return null;
  }
  return [...value];
}

function documentRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  // JSON 응답의 명시 필드만 새 객체로 옮겨 호출부가 서버 객체를 직접 변이하지 않게 한다.
  return Object.fromEntries(Object.entries(value));
}

function normalizedAccess(
  role: StudioTeamRole,
  serverCanEdit: boolean
): StudioSharedDocumentAccess {
  if (serverCanEdit && EDIT_ROLES.has(role)) return "edit";
  return role === "commenter" ? "comment" : "view";
}

export function canEditStudioSharedDocument(
  document: Pick<StudioSharedDocument, "access" | "capabilities">
): boolean {
  return document.access === "edit" && document.capabilities.edit;
}

function normalizeDocumentContent(value: unknown): StudioSharedDocumentContent {
  if (!isRecord(value) || !hasExactOwnKeys(value, SHARED_DOCUMENT_CONTENT_FIELDS)) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 내용 형식이 올바르지 않습니다.");
  }

  const titleId = nullableId(value.titleId);
  const seriesId = nullableId(value.seriesId);
  const challengeId = nullableId(value.challengeId);
  const remixFromId = nullableId(value.remixFromId);
  const tags = stringArray(value.tags, MAX_TAGS, MAX_TAG_LENGTH);
  const pages = stringArray(value.pages, STUDIO_PROJECT_MAX_PAGES);
  const doc = documentRecord(value.doc);
  const episodeNo =
    value.episodeNo === null
      ? null
      : typeof value.episodeNo === "number" &&
          Number.isInteger(value.episodeNo) &&
          value.episodeNo >= 1 &&
          value.episodeNo <= MAX_REVISION
        ? value.episodeNo
        : undefined;

  if (
    titleId === undefined ||
    seriesId === undefined ||
    challengeId === undefined ||
    remixFromId === undefined ||
    typeof value.title !== "string" ||
    value.title.length > MAX_TITLE_LENGTH ||
    typeof value.description !== "string" ||
    value.description.length > MAX_DESCRIPTION_LENGTH ||
    typeof value.cover !== "string" ||
    !tags ||
    !pages ||
    !doc ||
    !isFormat(value.format) ||
    !isDocumentStatus(value.status) ||
    episodeNo === undefined
  ) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 내용에 잘못된 필드가 있습니다.");
  }

  return {
    titleId,
    title: value.title,
    description: value.description,
    cover: value.cover,
    tags,
    format: value.format,
    pages,
    doc,
    status: value.status,
    seriesId,
    episodeNo,
    challengeId,
    remixFromId,
  };
}

function normalizeSharedDocumentBase(
  value: unknown,
  expectedWorkId: string,
  metaOnly: boolean
): { meta: StudioSharedDocumentMeta; record: Record<string, unknown> } {
  if (!isRecord(value)) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 응답 형식이 올바르지 않습니다.");
  }
  const expectedFields = metaOnly ? SHARED_DOCUMENT_META_FIELDS : SHARED_DOCUMENT_FULL_FIELDS;
  if (!hasExactOwnKeys(value, expectedFields)) {
    throw new StudioSharedDocumentResponseContractError(
      metaOnly
        ? "공동 문서 메타 응답 필드가 올바르지 않습니다."
        : "공동 문서 응답 필드가 올바르지 않습니다."
    );
  }
  const workId = exactId(value.workId);
  if (!workId || workId !== expectedWorkId) {
    throw new StudioSharedDocumentResponseContractError(
      "다른 작품의 공동 문서 응답을 받았습니다. 다시 시도해 주세요."
    );
  }
  if (!isRole(value.role) || value.status !== "active") {
    throw new StudioSharedDocumentResponseContractError("공동 문서 역할 또는 참여 상태가 올바르지 않습니다.");
  }
  if (
    !isRecord(value.capabilities) ||
    !hasExactOwnKeys(value.capabilities, SHARED_DOCUMENT_CAPABILITY_FIELDS) ||
    value.capabilities.view !== true ||
    typeof value.capabilities.edit !== "boolean"
  ) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 접근 권한 형식이 올바르지 않습니다.");
  }
  const normalizedRevision = revision(value.revision);
  const crdtServerSequence = postgresBigintSequence(value.crdtServerSequence);
  const updatedAt = isoDate(value.updatedAt);
  if (!normalizedRevision || !crdtServerSequence || !updatedAt) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 버전 정보가 올바르지 않습니다.");
  }

  const access = normalizedAccess(value.role, value.capabilities.edit);
  return {
    record: value,
    meta: {
      workId,
      role: value.role,
      status: "active",
      capabilities: { view: true, edit: access === "edit" },
      access,
      revision: normalizedRevision,
      crdtServerSequence,
      updatedAt,
    },
  };
}

/**
 * 단일 공동 문서는 일부 항목만 걸러 빈 화면으로 바꿀 수 없으므로 계약 전체를 검증한다.
 * 서버가 viewer/commenter에게 edit=true를 잘못 보내도 역할 교차 검증으로 열람 전용으로 낮춘다.
 */
export function normalizeStudioSharedDocument(
  value: unknown,
  expectedWorkId: string
): StudioSharedDocument {
  const { meta, record } = normalizeSharedDocumentBase(value, expectedWorkId, false);
  return {
    ...meta,
    document: normalizeDocumentContent(record.document),
  };
}

/** 메타 조회는 전체 문서와 달리 envelope·capability의 정확한 own-key 계약만 수용한다. */
export function normalizeStudioSharedDocumentMeta(
  value: unknown,
  expectedWorkId: string
): StudioSharedDocumentMeta {
  return normalizeSharedDocumentBase(value, expectedWorkId, true).meta;
}

function inputError(message: string): never {
  throw new StudioSharedDocumentInputError(message);
}

/** 런타임 입력에서도 owner-only 관계 필드와 임의 키가 PATCH에 섞이지 않도록 allow-list한다. */
export function normalizeStudioSharedDocumentPatch(
  value: unknown
): UpdateStudioSharedDocumentInput {
  if (!isRecord(value)) inputError("공동 문서 저장 입력 형식이 올바르지 않습니다.");
  const unknownField = Object.keys(value).find((key) => !SHARED_DOCUMENT_PATCH_FIELDS.has(key));
  if (unknownField) inputError("공동 문서에서 변경할 수 없는 필드가 포함되어 있습니다.");

  const baseRevision = revision(value.baseRevision);
  if (!baseRevision) inputError("공동 문서 기준 버전이 올바르지 않습니다.");
  const crdtServerSequence = postgresBigintSequence(value.crdtServerSequence);
  if (!crdtServerSequence) inputError("공동 문서 CRDT 서버 순번이 올바르지 않습니다.");
  if (!SHARED_DOCUMENT_MUTABLE_FIELDS.some((field) => hasOwn(value, field))) {
    inputError("저장할 공동 문서 변경 사항이 없습니다.");
  }

  const result: UpdateStudioSharedDocumentInput = { baseRevision, crdtServerSequence };
  if (hasOwn(value, "title")) {
    if (typeof value.title !== "string") inputError("공동 문서 제목이 올바르지 않습니다.");
    const title = value.title.trim();
    if (!title || title.length > MAX_TITLE_LENGTH) inputError("공동 문서 제목이 올바르지 않습니다.");
    result.title = title;
  }
  if (hasOwn(value, "description")) {
    if (typeof value.description !== "string" || value.description.length > MAX_DESCRIPTION_LENGTH) {
      inputError("공동 문서 설명이 올바르지 않습니다.");
    }
    result.description = value.description;
  }
  if (hasOwn(value, "tags")) {
    const tags = stringArray(value.tags, MAX_TAGS, MAX_TAG_LENGTH);
    if (!tags) inputError("공동 문서 태그가 올바르지 않습니다.");
    result.tags = tags;
  }
  if (hasOwn(value, "titleId")) {
    const titleId = nullableId(value.titleId);
    if (titleId === undefined) inputError("공동 문서 연결 작품이 올바르지 않습니다.");
    result.titleId = titleId;
  }
  if (hasOwn(value, "cover")) {
    if (typeof value.cover !== "string") inputError("공동 문서 표지가 올바르지 않습니다.");
    result.cover = value.cover;
  }
  if (hasOwn(value, "pages")) {
    const pages = stringArray(value.pages, STUDIO_PROJECT_MAX_PAGES);
    if (!pages) inputError("공동 문서 페이지가 올바르지 않습니다.");
    result.pages = pages;
  }
  if (hasOwn(value, "doc")) {
    const doc = documentRecord(value.doc);
    if (!doc) inputError("공동 문서 편집 데이터가 올바르지 않습니다.");
    result.doc = doc;
  }
  if (hasOwn(value, "status")) {
    if (!isDocumentStatus(value.status)) inputError("공동 문서 게시 상태가 올바르지 않습니다.");
    result.status = value.status;
  }
  return result;
}

export function normalizeStudioSharedDocumentSaveResponse(
  value: unknown,
  expectedWorkId: string,
  baseRevision: number
): StudioSharedDocumentSaveResponse {
  const exactResponse = isRecord(value) && hasExactOwnKeys(value, SHARED_DOCUMENT_SAVE_FIELDS);
  const workId = exactResponse ? exactId(value.workId) : null;
  const normalizedBaseRevision = revision(baseRevision);
  if (!exactResponse || !workId || workId !== expectedWorkId || !normalizedBaseRevision) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 저장 확인 형식이 올바르지 않습니다.");
  }
  const savedRevision = revision(value.revision);
  const updatedAt = isoDate(value.updatedAt);
  if (!savedRevision || savedRevision !== normalizedBaseRevision + 1 || !updatedAt) {
    throw new StudioSharedDocumentResponseContractError("공동 문서 저장 버전이 올바르지 않습니다.");
  }
  return { workId: expectedWorkId, revision: savedRevision, updatedAt };
}

export function isStudioSharedDocumentScopeCurrent(
  requestScope: StudioSharedDocumentRequestScope,
  currentScope: { authScopeKey: string | null; workId: string | null }
): boolean {
  return (
    currentScope.authScopeKey !== null &&
    requestScope.authScopeKey === currentScope.authScopeKey &&
    requestScope.workId === currentScope.workId
  );
}

function sharedDocumentPath(workId: string): string {
  return `${SHARED_DOCUMENT_BASE}/${encodeURIComponent(workId)}/team/document`;
}

function sharedDocumentMetaPath(workId: string): string {
  return `${sharedDocumentPath(workId)}/meta`;
}

function revisionConflictFrom(error: unknown): StudioSharedDocumentRevisionConflictError | null {
  if (!isHttpError(error) || error.response.status !== 409) return null;
  const payload = error.data;
  if (!isRecord(payload) || payload.code !== "creator_work_revision_conflict") return null;
  const currentRevision = revision(payload.currentRevision);
  return currentRevision ? new StudioSharedDocumentRevisionConflictError(currentRevision) : null;
}

function crdtSequenceConflictFrom(
  error: unknown
): StudioSharedDocumentCrdtSequenceConflictError | null {
  if (!isHttpError(error) || error.response.status !== 409) return null;
  const payload = error.data;
  if (!isRecord(payload) || payload.code !== "creator_crdt_sequence_conflict") return null;
  const currentCrdtServerSequence = postgresBigintSequence(
    payload.currentCrdtServerSequence
  );
  return currentCrdtServerSequence
    ? new StudioSharedDocumentCrdtSequenceConflictError(currentCrdtServerSequence)
    : null;
}

function accessErrorFrom(
  error: unknown,
  message: string
): StudioSharedDocumentAccessError | null {
  if (!isHttpError(error)) return null;
  const status = error.response.status;
  if (status !== 401 && status !== 403 && status !== 404) return null;
  return new StudioSharedDocumentAccessError(status, message, error);
}

export async function getStudioSharedDocument(
  workId: string,
  signal?: AbortSignal
): Promise<StudioSharedDocument> {
  if (!exactId(workId)) {
    throw new StudioSharedDocumentInputError("공동 문서 작품 식별자가 올바르지 않습니다.");
  }
  let payload: unknown;
  try {
    payload = await api.get<unknown>(sharedDocumentPath(workId), { signal });
  } catch (error) {
    const accessError = accessErrorFrom(
      error,
      "공동 문서 접근 권한이 변경되었습니다. 다시 열어 주세요."
    );
    if (accessError) throw accessError;
    throw await toApiError(error, "공동 문서를 불러오지 못했습니다.");
  }
  return normalizeStudioSharedDocument(payload, workId);
}

export async function getStudioSharedDocumentMeta(
  workId: string,
  signal?: AbortSignal
): Promise<StudioSharedDocumentMeta> {
  if (!exactId(workId)) {
    throw new StudioSharedDocumentInputError("공동 문서 작품 식별자가 올바르지 않습니다.");
  }
  let payload: unknown;
  try {
    payload = await api.get<unknown>(sharedDocumentMetaPath(workId), { signal });
  } catch (error) {
    const accessError = accessErrorFrom(
      error,
      "공동 문서 접근 권한을 더 이상 확인할 수 없습니다. 다시 열어 주세요."
    );
    if (accessError) throw accessError;
    throw await toApiError(error, "공동 문서 권한 정보를 불러오지 못했습니다.");
  }
  return normalizeStudioSharedDocumentMeta(payload, workId);
}

export async function updateStudioSharedDocument(
  workId: string,
  role: StudioTeamRole,
  input: UpdateStudioSharedDocumentInput,
  signal?: AbortSignal
): Promise<StudioSharedDocumentSaveResponse> {
  if (!exactId(workId)) {
    throw new StudioSharedDocumentInputError("공동 문서 작품 식별자가 올바르지 않습니다.");
  }
  if (!isRole(role)) {
    throw new StudioSharedDocumentInputError("공동 문서 역할이 올바르지 않습니다.");
  }
  const normalizedPatch = normalizeStudioSharedDocumentPatch(input);
  const patch =
    role === "owner"
      ? normalizedPatch
      : Object.fromEntries(
          Object.entries(normalizedPatch).filter(
            ([key]) => key !== "status" && key !== "titleId"
          )
        ) as UpdateStudioSharedDocumentInput;
  if (!SHARED_DOCUMENT_MUTABLE_FIELDS.some((field) => hasOwn(patch, field))) {
    throw new StudioSharedDocumentInputError("공동 편집자가 저장할 원고 변경 사항이 없습니다.");
  }
  let payload: unknown;
  try {
    payload = await api.patch<unknown>(sharedDocumentPath(workId), patch, { signal });
  } catch (error) {
    const crdtConflict = crdtSequenceConflictFrom(error);
    if (crdtConflict) throw crdtConflict;
    const conflict = revisionConflictFrom(error);
    if (conflict) throw conflict;
    const accessError = accessErrorFrom(
      error,
      "공동 문서 저장 권한이 변경되었습니다. 원고를 다시 열어 주세요."
    );
    if (accessError) throw accessError;
    throw await toApiError(error, "공동 문서를 저장하지 못했습니다.");
  }
  return normalizeStudioSharedDocumentSaveResponse(payload, workId, patch.baseRevision);
}
