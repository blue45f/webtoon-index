// 창작 게시판(/api/creator) 전용 타입 + ky 헬퍼.
// 인증은 공유 클라이언트의 HttpOnly 세션 쿠키만 사용하므로 호출부는
// x-user-id나 브라우저 저장 토큰을 별도로 전달하지 않는다.
// 새 저장 키를 만들지 않고 auth-session의 getAuthUserId()로 현재 사용자 id를 읽는다.
import type {
  CreatorAssetCatalogSort,
  CreatorAssetLicenseId,
  CreatorAssetModerationStatus,
  CreatorAssetReportReason,
} from "@/shared/lib/creator-asset-contract";

import {
  CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
  CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES,
  assertCreatorAssetListResponseBudget,
} from "@/shared/lib/creator-asset-contract";
import { ensureArray } from "@/shared/lib/http-safe";
import { projectRevisionComparisonValue } from "@/shared/lib/revision-comparison-projection";
import { getAuthUserId } from "@/src/compat/auth-session-store";
import { api, isHttpError, toApiError } from "@/src/infrastructure/api";
import {
  validateSharedAssetCatalogItem,
  validateSharedAssetContentResponse,
} from "@/src/infrastructure/creator-asset-response-validation";


export type WorkFormat = "cuttoon" | "upload";

export interface WorkAuthor {
  id: string;
  name: string;
  avatar: string;
}

export interface WorkSummary {
  id: string;
  title: string;
  description: string;
  cover: string;
  tags: string[];
  format: WorkFormat;
  titleId: string | null;
  status: string;
  author: WorkAuthor;
  likes: number;
  comments: number;
  views: number;
  liked: boolean;
  createdAt: string;
  // 연재 시리즈/챌린지 연결 — 구버전 서버 응답엔 없을 수 있어 optional(하위호환).
  seriesId?: string | null;
  episodeNo?: number | null;
  seriesTitle?: string | null;
  challengeId?: string | null;
  challengeTitle?: string | null;
  remixFromId?: string | null;
  // Owner-only detail/create/update responses include this optimistic concurrency token.
  revision?: number;
}

// 작품 상세의 이전화/다음화 내비게이션 항목.
export interface EpisodeRef {
  id: string;
  title: string;
  episodeNo: number | null;
}

export interface WorkDetail extends WorkSummary {
  pages: string[];
  doc: Record<string, unknown>;
  isOwner: boolean;
  series?: { id: string; title: string; status: SeriesStatus } | null;
  prevEpisode?: EpisodeRef | null;
  nextEpisode?: EpisodeRef | null;
  challenge?: { id: string; slug: string; title: string; endsAt: string | null } | null;
  remixFromTitle?: string | null;
  remixedChildren?: {
    id: string;
    title: string;
    cover: string;
    author: WorkAuthor;
  }[];
}

export interface WorkComment {
  id: string;
  author: WorkAuthor;
  text: string;
  createdAt: string;
}

export type WorkSort = "recent" | "likes" | "views";

export interface WorkListParams {
  titleId?: string;
  userId?: string;
  sort?: WorkSort;
  tag?: string;
  seriesId?: string;
  challengeId?: string;
}

export interface CreateWorkInput {
  title: string;
  description: string;
  tags: string[];
  format: WorkFormat;
  titleId?: string | null;
  cover: string;
  pages: string[];
  doc: Record<string, unknown>;
  status: string;
  // 선택: 연재 시리즈 회차로 게시(서버가 episodeNo 자동 부여) / 챌린지 참여작으로 게시.
  seriesId?: string | null;
  challengeId?: string | null;
  remixFromId?: string | null;
}

export type UpdateWorkInput = Partial<CreateWorkInput> & { baseRevision?: number };

export interface WorkRevisionSummary {
  revision: number;
  restoredFromRevision: number | null;
  createdAt: string;
}

export interface WorkRevisionDetail extends WorkRevisionSummary {
  snapshot: Record<string, unknown>;
}

export interface WorkRevisionComparisonSnapshot extends Record<string, unknown> {
  titleId: string | null;
  title: string;
  description: string;
  tags: string[];
  format: WorkFormat;
  doc: Record<string, unknown>;
  status: "draft" | "published";
  seriesId: string | null;
  episodeNo: number | null;
  challengeId: string | null;
  remixFromId: string | null;
}

export interface WorkRevisionComparisonDetail extends WorkRevisionSummary {
  snapshot: WorkRevisionComparisonSnapshot;
}

export class WorkRevisionResponseContractError extends Error {
  constructor() {
    // Do not retain the response, a cause, or field values here. Revision snapshots are private
    // owner data and a malformed response must not make that payload observable through logs/UI.
    super("작품 버전 응답 형식이 올바르지 않습니다.");
    this.name = "WorkRevisionResponseContractError";
  }
}

export class WorkRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("다른 기기나 창에서 먼저 저장했습니다. 작품을 다시 불러온 뒤 변경 내용을 확인해 주세요.");
    this.name = "WorkRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

const MAX_WORK_REVISION = 2_147_483_647;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function workRevision(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_WORK_REVISION
    ? value
    : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizedIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_TIME_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function normalizeWorkRevisionSummary(value: unknown): WorkRevisionSummary | null {
  if (!isPlainRecord(value)) return null;
  const revision = workRevision(value.revision);
  const rawRestoredFromRevision = value.restoredFromRevision;
  const restoredFromRevision = rawRestoredFromRevision === null
    ? null
    : workRevision(rawRestoredFromRevision);
  const createdAt = normalizedIsoDate(value.createdAt);
  const restoredFromRevisionIsValid =
    rawRestoredFromRevision === null || restoredFromRevision !== null;
  if (!revision || !restoredFromRevisionIsValid || !createdAt) {
    return null;
  }
  return { revision, restoredFromRevision, createdAt };
}

function normalizeWorkRevisionList(value: unknown): WorkRevisionSummary[] {
  if (!Array.isArray(value)) throw new WorkRevisionResponseContractError();
  const revisions: WorkRevisionSummary[] = [];
  for (const item of value) {
    const revision = normalizeWorkRevisionSummary(item);
    if (!revision) throw new WorkRevisionResponseContractError();
    revisions.push(revision);
  }
  return revisions;
}

function normalizeWorkRevisionDetail(value: unknown): WorkRevisionDetail {
  const summary = normalizeWorkRevisionSummary(value);
  if (!summary || !isPlainRecord(value) || !isPlainRecord(value.snapshot)) {
    throw new WorkRevisionResponseContractError();
  }
  // Return a fresh ordinary object so a null-prototype JSON-compatible record cannot leak its
  // unusual prototype into editor code. Nested document data is validated at the Studio parser.
  return { ...summary, snapshot: { ...value.snapshot } };
}

const WORK_REVISION_COMPARISON_RESPONSE_KEYS = [
  "revision",
  "restoredFromRevision",
  "createdAt",
  "snapshot",
] as const;
const WORK_REVISION_COMPARISON_SNAPSHOT_KEYS = [
  "titleId",
  "title",
  "description",
  "tags",
  "format",
  "doc",
  "status",
  "seriesId",
  "episodeNo",
  "challengeId",
  "remixFromId",
] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && descriptor.enumerable);
  });
}

function isWorkRevisionTags(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 8 || Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== value.length) return false;
  return keys.every((key, index) => {
    if (key !== String(index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor &&
      "value" in descriptor &&
      typeof descriptor.value === "string" &&
      descriptor.value.length <= 24
    );
  });
}

function nullableReferenceId(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 160 &&
      value.trim() === value);
}

async function normalizeWorkRevisionComparisonDetail(
  value: unknown
): Promise<WorkRevisionComparisonDetail> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, WORK_REVISION_COMPARISON_RESPONSE_KEYS)
  ) {
    throw new WorkRevisionResponseContractError();
  }
  const summary = normalizeWorkRevisionSummary(value);
  if (!summary || !isPlainRecord(value.snapshot)) {
    throw new WorkRevisionResponseContractError();
  }
  const snapshot = value.snapshot;
  if (!hasExactKeys(snapshot, WORK_REVISION_COMPARISON_SNAPSHOT_KEYS)) {
    throw new WorkRevisionResponseContractError();
  }
  const tags = snapshot.tags;
  const episodeNo = snapshot.episodeNo;
  if (
    typeof snapshot.title !== "string" ||
    snapshot.title.length > 120 ||
    typeof snapshot.description !== "string" ||
    snapshot.description.length > 2_000 ||
    !isWorkRevisionTags(tags) ||
    (snapshot.format !== "cuttoon" && snapshot.format !== "upload") ||
    !isPlainRecord(snapshot.doc) ||
    (snapshot.status !== "draft" && snapshot.status !== "published") ||
    !nullableReferenceId(snapshot.titleId) ||
    !nullableReferenceId(snapshot.seriesId) ||
    !nullableReferenceId(snapshot.challengeId) ||
    !nullableReferenceId(snapshot.remixFromId) ||
    !(
      episodeNo === null ||
      (typeof episodeNo === "number" &&
        Number.isInteger(episodeNo) &&
        episodeNo >= 1 &&
        episodeNo <= MAX_WORK_REVISION)
    )
  ) {
    throw new WorkRevisionResponseContractError();
  }

  let projectedDoc: unknown;
  try {
    // Defense in depth: downstream editor code never receives a raw resource URL even if an older
    // server accidentally violates the new projection contract.
    projectedDoc = await projectRevisionComparisonValue(snapshot.doc);
  } catch {
    throw new WorkRevisionResponseContractError();
  }
  if (!isPlainRecord(projectedDoc)) throw new WorkRevisionResponseContractError();

  return {
    ...summary,
    snapshot: {
      titleId: snapshot.titleId,
      title: snapshot.title,
      description: snapshot.description,
      tags: [...tags],
      format: snapshot.format,
      doc: projectedDoc,
      status: snapshot.status,
      seriesId: snapshot.seriesId,
      episodeNo,
      challengeId: snapshot.challengeId,
      remixFromId: snapshot.remixFromId,
    },
  };
}

function revisionConflictFrom(error: unknown): WorkRevisionConflictError | null {
  if (!isHttpError(error) || error.response.status !== 409) return null;
  const payload = error.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.code !== "creator_work_revision_conflict") return null;
  const currentRevision = workRevision(record.currentRevision);
  if (!currentRevision) return null;
  return new WorkRevisionConflictError(currentRevision);
}

async function mutateWorkOrThrow(
  run: () => Promise<WorkSummary>,
  fallback: string
): Promise<WorkSummary> {
  try {
    const work = await run();
    if (work == null) throw new Error(fallback);
    return work;
  } catch (error) {
    const conflict = revisionConflictFrom(error);
    if (conflict) throw conflict;
    throw await toApiError(error, fallback);
  }
}

// api 래퍼는 "/api" 이후 경로를 받는다(내부에서 apiPath 가 "/api" 를 붙임).
const BASE = "/creator";

// 현재 로그인 사용자 id(없으면 null). 세션 훅/유틸을 재사용한다 — 새 storage key 금지.
export function getCurrentUserId(): string | null {
  return getAuthUserId();
}

// ky HTTPError 를 fallback 메시지로 감싸 throw 한다(기존 readOrThrow 의 에러 텍스트 유지).
// data == null(빈 본문)이면 fallback 으로 throw — 기존 동작과 동일.
async function callOrThrow<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  let data: T;
  try {
    data = await run();
  } catch (err) {
    throw await toApiError(err, fallback);
  }
  if (data == null) throw new Error(fallback);
  return data;
}

// 목록 응답은 { works } 또는 배열 둘 다 방어적으로 처리한다.
function unwrapWorks(payload: unknown): WorkSummary[] {
  if (Array.isArray(payload)) return payload as WorkSummary[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { works?: unknown }).works)) {
    return (payload as { works: WorkSummary[] }).works;
  }
  return ensureArray<WorkSummary>(payload);
}

export async function listWorks(
  params: WorkListParams = {},
  signal?: AbortSignal
): Promise<WorkSummary[]> {
  // x-user-id 전송(공유 클라이언트 훅) → 본인 목록일 때 초안·비공개도 표시.
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/works`, { params: { ...params }, signal }),
    "창작물 목록을 불러오지 못했습니다."
  );
  return unwrapWorks(data);
}

export async function getWork(id: string, signal?: AbortSignal): Promise<WorkDetail> {
  return callOrThrow(
    () => api.get<WorkDetail>(`${BASE}/works/${encodeURIComponent(id)}`, { signal }),
    "창작물을 불러오지 못했습니다."
  );
}

export async function createWork(input: CreateWorkInput, signal?: AbortSignal): Promise<WorkSummary> {
  return callOrThrow(
    () => signal
      ? api.post<WorkSummary>(`${BASE}/works`, input, { signal })
      : api.post<WorkSummary>(`${BASE}/works`, input),
    "창작물을 등록하지 못했습니다."
  );
}

export async function updateWork(
  id: string,
  input: UpdateWorkInput,
  signal?: AbortSignal
): Promise<WorkSummary> {
  return mutateWorkOrThrow(
    () => signal
      ? api.patch<WorkSummary>(`${BASE}/works/${encodeURIComponent(id)}`, input, { signal })
      : api.patch<WorkSummary>(`${BASE}/works/${encodeURIComponent(id)}`, input),
    "창작물을 수정하지 못했습니다."
  );
}

export async function listWorkRevisions(
  id: string,
  limit = 20,
  signal?: AbortSignal
): Promise<WorkRevisionSummary[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/works/${encodeURIComponent(id)}/revisions`, { params: { limit }, signal }),
    "작품 버전 목록을 불러오지 못했습니다."
  );
  return normalizeWorkRevisionList(data);
}

export async function getWorkRevision(
  id: string,
  revision: number,
  signal?: AbortSignal
): Promise<WorkRevisionDetail> {
  const data = await callOrThrow(
    () => api.get<unknown>(
      `${BASE}/works/${encodeURIComponent(id)}/revisions/${revision}`,
      { signal }
    ),
    "작품 버전을 불러오지 못했습니다."
  );
  return normalizeWorkRevisionDetail(data);
}

export async function getWorkRevisionComparison(
  id: string,
  revision: number,
  signal?: AbortSignal
): Promise<WorkRevisionComparisonDetail> {
  const data = await callOrThrow(
    () => api.get<unknown>(
      `${BASE}/works/${encodeURIComponent(id)}/revisions/${revision}/comparison`,
      { signal }
    ),
    "작품 버전 비교 정보를 불러오지 못했습니다."
  );
  return normalizeWorkRevisionComparisonDetail(data);
}

export async function restoreWorkRevision(
  id: string,
  revision: number,
  baseRevision: number,
  signal?: AbortSignal
): Promise<WorkSummary> {
  return mutateWorkOrThrow(
    () => signal
      ? api.post<WorkSummary>(
          `${BASE}/works/${encodeURIComponent(id)}/revisions/${revision}/restore`,
          { baseRevision },
          { signal }
        )
      : api.post<WorkSummary>(
          `${BASE}/works/${encodeURIComponent(id)}/revisions/${revision}/restore`,
          { baseRevision }
        ),
    "작품 버전을 복원하지 못했습니다."
  );
}

export async function deleteWork(id: string): Promise<void> {
  try {
    await api.delete(`${BASE}/works/${encodeURIComponent(id)}`);
  } catch (err) {
    throw await toApiError(err, "창작물을 삭제하지 못했습니다.");
  }
}

export async function toggleWorkLike(id: string): Promise<{ liked: boolean; likes: number }> {
  return callOrThrow(
    () => api.post<{ liked: boolean; likes: number }>(`${BASE}/works/${encodeURIComponent(id)}/like`),
    "좋아요를 처리하지 못했습니다."
  );
}

export async function listComments(id: string, signal?: AbortSignal): Promise<WorkComment[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/works/${encodeURIComponent(id)}/comments`, { signal }),
    "댓글을 불러오지 못했습니다."
  );
  return ensureArray<WorkComment>(data);
}

export async function postComment(id: string, text: string): Promise<WorkComment> {
  return callOrThrow(
    () => api.post<WorkComment>(`${BASE}/works/${encodeURIComponent(id)}/comments`, { text }),
    "댓글을 등록하지 못했습니다."
  );
}

// ── 공유 에셋(회원이 올려 모두가 재사용) ──────────────────────────────
export interface SharedAssetSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  width: number;
  height: number;
  kind: string;
  license?: CreatorAssetLicenseId;
  licenseLabel?: string;
  licenseUrl?: string | null;
  attributionRequired?: boolean;
  commercialUse?: boolean;
  attributionText?: string;
  containsAi?: boolean;
  moderationStatus?: CreatorAssetModerationStatus;
  reportCount?: number;
  downloads: number;
  author: WorkAuthor;
  isOwner: boolean;
  createdAt: string;
}

/** Full-content legacy projection used by the shared VRM pose library. */
export interface SharedAsset extends SharedAssetSummary {
  dataUrl: string;
}

/** Catalog projection. Original bytes are fetched only when the user inserts this asset. */
export interface SharedAssetCatalogItem extends SharedAssetSummary {
  previewDataUrl: string;
  previewWidth: number;
  previewHeight: number;
  previewAvailable: boolean;
}

export interface SharedAssetContent {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  kind: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  contentHash: string;
}

export interface PublishAssetInput {
  name: string;
  description?: string;
  tags?: string[];
  dataUrl: string;
  width: number;
  height: number;
  kind?: string;
  license: CreatorAssetLicenseId;
  attributionText?: string;
  containsAi?: boolean;
  rightsConfirmed: true;
}

export interface SharedAssetCatalogPage {
  items: SharedAssetCatalogItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface SharedAssetModerationQueueItem {
  reportId: string;
  reason: CreatorAssetReportReason;
  details: string;
  reportStatus: "open" | "resolved" | "dismissed";
  reportedAt: string;
  reporter: WorkAuthor;
  asset: SharedAssetCatalogItem;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSharedAssetCatalogPage(value: unknown): SharedAssetCatalogPage {
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).length > CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES) {
      throw new Error("공유 에셋 카탈로그 응답이 너무 큽니다.");
    }
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.limit !== "number" ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE ||
    typeof value.offset !== "number" ||
    !Number.isInteger(value.offset) ||
    value.offset < 0 ||
    typeof value.hasMore !== "boolean" ||
    (value.nextOffset !== null && (
      typeof value.nextOffset !== "number" ||
      !Number.isInteger(value.nextOffset) ||
      value.nextOffset < 0
    ))
  ) {
    throw new Error("공유 에셋 카탈로그 응답이 올바르지 않습니다.");
  }
  const items = value.items.flatMap((item): SharedAssetCatalogItem[] => {
    if (!isRecord(item) || !validateSharedAssetCatalogItem(item)) return [];
    return [item as unknown as SharedAssetCatalogItem];
  });
  const page: SharedAssetCatalogPage = {
    items,
    limit: value.limit,
    offset: value.offset,
    hasMore: value.hasMore,
    nextOffset: value.nextOffset,
  };
  if (new TextEncoder().encode(JSON.stringify(page)).length > CREATOR_ASSET_LIST_RESPONSE_MAX_BYTES) {
    throw new Error("공유 에셋 카탈로그 응답이 너무 큽니다.");
  }
  assertCreatorAssetListResponseBudget(page);
  return page;
}

export type GeneratedAssetSize = "1024x1024" | "1536x1024" | "1024x1536";
export type GeneratedAssetQuality = "low" | "medium" | "high" | "auto";

export interface GenerateAssetInput {
  prompt: string;
  name?: string;
  size?: GeneratedAssetSize;
  quality?: GeneratedAssetQuality;
}

export interface GeneratedAsset {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  model: "gpt-image-2";
  size: GeneratedAssetSize;
  quality: GeneratedAssetQuality;
}

export async function listSharedAssets(
  params: {
    mine?: boolean;
    limit?: number;
    offset?: number;
    search?: string;
    tag?: string;
    license?: CreatorAssetLicenseId;
    kind?: "image" | "sticker" | "vrm_pose";
    sort?: CreatorAssetCatalogSort;
  } = {},
  signal?: AbortSignal
): Promise<SharedAsset[]> {
  // x-user-id 전송(공유 클라이언트 훅) → isOwner 판정/내 공유 필터. mine 은 서버 호환을 위해 "1" 로 보낸다.
  const data = await callOrThrow(
    () =>
      api.get<unknown>(`${BASE}/assets`, {
        params: {
          mine: params.mine ? "1" : undefined,
          limit: params.limit,
          offset: params.offset,
          search: params.search,
          tag: params.tag,
          license: params.license,
          kind: params.kind,
          sort: params.sort,
        },
        signal,
      }),
    "공유 에셋을 불러오지 못했습니다."
  );
  return ensureArray<SharedAsset>(data);
}

export async function listSharedAssetCatalog(
  params: {
    mine?: boolean;
    limit?: number;
    offset?: number;
    search?: string;
    tag?: string;
    license?: CreatorAssetLicenseId;
    kind?: "image" | "sticker" | "vrm_pose";
    sort?: CreatorAssetCatalogSort;
  } = {},
  signal?: AbortSignal
): Promise<SharedAssetCatalogPage> {
  const value = await callOrThrow(
    () =>
      api.get<unknown>(`${BASE}/assets/catalog`, {
        params: {
          mine: params.mine ? "1" : undefined,
          limit: params.limit,
          offset: params.offset,
          search: params.search,
          tag: params.tag,
          license: params.license,
          kind: params.kind,
          sort: params.sort,
        },
        signal,
      }),
    "공유 에셋 카탈로그를 불러오지 못했습니다."
  );
  return parseSharedAssetCatalogPage(value);
}

export async function publishAsset(input: PublishAssetInput, signal?: AbortSignal): Promise<SharedAsset> {
  const { createStudioSharedAssetPreview } = await import("@/src/domains/creator/studio-shared-asset-preview"
  );
  const preview = await createStudioSharedAssetPreview(input.dataUrl);
  return callOrThrow(
    () => api.post<SharedAsset>(`${BASE}/assets`, { ...input, ...preview }, { signal }),
    "에셋을 공유하지 못했습니다."
  );
}

export async function getSharedAssetContent(id: string, signal?: AbortSignal): Promise<SharedAssetContent> {
  const value = await callOrThrow(
    () => api.get<unknown>(`${BASE}/assets/${encodeURIComponent(id)}/content`, { signal }),
    "공유 에셋 원본을 불러오지 못했습니다."
  );
  return validateSharedAssetContentResponse(value, id);
}

export async function generateAsset(input: GenerateAssetInput): Promise<GeneratedAsset> {
  return callOrThrow(
    () => api.post<GeneratedAsset>(`${BASE}/assets/generate`, input),
    "이미지를 생성하지 못했습니다."
  );
}

export async function deleteSharedAsset(id: string): Promise<void> {
  try {
    await api.delete(`${BASE}/assets/${encodeURIComponent(id)}`);
  } catch (err) {
    throw await toApiError(err, "에셋을 삭제하지 못했습니다.");
  }
}

export async function reportSharedAsset(
  id: string,
  input: { reason: CreatorAssetReportReason; details?: string }
): Promise<{ reported: true; reportCount: number }> {
  return callOrThrow(
    () => api.post(`${BASE}/assets/${encodeURIComponent(id)}/report`, input),
    "에셋을 신고하지 못했습니다."
  );
}

export async function listSharedAssetModerationQueue(
  params: { status?: "open" | "resolved" | "dismissed"; limit?: number; offset?: number } = {}
): Promise<SharedAssetModerationQueueItem[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/assets/moderation`, { params }),
    "에셋 검수 대기열을 불러오지 못했습니다."
  );
  const queue = ensureArray<unknown>(data).flatMap((item): SharedAssetModerationQueueItem[] => {
    if (!isRecord(item) || !isRecord(item.asset) || !validateSharedAssetCatalogItem(item.asset)) return [];
    return [item as unknown as SharedAssetModerationQueueItem];
  });
  assertCreatorAssetListResponseBudget(queue);
  return queue;
}

export async function moderateSharedAsset(
  id: string,
  input: { status: CreatorAssetModerationStatus; note?: string }
): Promise<{ updated: true; status: CreatorAssetModerationStatus }> {
  return callOrThrow(
    () => api.patch(`${BASE}/assets/${encodeURIComponent(id)}/moderation`, input),
    "에셋 검수 상태를 변경하지 못했습니다."
  );
}

// 원본 검증과 로컬 캔버스 삽입이 모두 성공한 뒤에만 호출한다. 서버가 사용자·에셋별 중복을 제한한다.
export async function markSharedAssetUsed(id: string): Promise<void> {
  try {
    await api.post(`${BASE}/assets/${encodeURIComponent(id)}/use`);
  } catch {
    // ignore
  }
}

// ── 연재 시리즈(코미코 베스트도전 스타일) ──────────────────────────────
export type SeriesStatus = "ongoing" | "completed";
export type SeriesSort = "recent" | "likes" | "views";

export interface SeriesSummary {
  id: string;
  title: string;
  description: string;
  cover: string;
  tags: string[];
  status: SeriesStatus;
  author: WorkAuthor;
  episodes: number;
  views: number;
  likes: number;
  latestEpisodeAt: string | null;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesDetail extends SeriesSummary {
  episodeList: WorkSummary[];
}

export interface SeriesInput {
  title: string;
  description?: string;
  cover?: string;
  tags?: string[];
  status?: SeriesStatus;
}

export async function listSeries(
  params: { userId?: string; sort?: SeriesSort } = {},
  signal?: AbortSignal
): Promise<SeriesSummary[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/series`, { params: { ...params }, signal }),
    "시리즈 목록을 불러오지 못했습니다."
  );
  return ensureArray<SeriesSummary>(data);
}

export async function getSeries(id: string, signal?: AbortSignal): Promise<SeriesDetail> {
  return callOrThrow(
    () => api.get<SeriesDetail>(`${BASE}/series/${encodeURIComponent(id)}`, { signal }),
    "시리즈를 불러오지 못했습니다."
  );
}

export async function createSeries(input: SeriesInput): Promise<SeriesSummary> {
  return callOrThrow(() => api.post<SeriesSummary>(`${BASE}/series`, input), "시리즈를 만들지 못했습니다.");
}

export async function updateSeries(id: string, input: Partial<SeriesInput>): Promise<SeriesSummary> {
  return callOrThrow(
    () => api.patch<SeriesSummary>(`${BASE}/series/${encodeURIComponent(id)}`, input),
    "시리즈를 수정하지 못했습니다."
  );
}

export async function deleteSeries(id: string): Promise<void> {
  try {
    await api.delete(`${BASE}/series/${encodeURIComponent(id)}`);
  } catch (err) {
    throw await toApiError(err, "시리즈를 삭제하지 못했습니다.");
  }
}

// ── 창작 챌린지(주간 주제 이벤트) ──────────────────────────────────────
export type ChallengeState = "upcoming" | "ongoing" | "ended";

export interface ChallengeSummary {
  id: string;
  slug: string;
  title: string;
  theme: string;
  startsAt: string | null;
  endsAt: string | null;
  state: ChallengeState;
  entries: number;
  createdAt: string;
}

export interface ChallengeDetail extends ChallengeSummary {
  works: WorkSummary[];
}

export async function listChallenges(signal?: AbortSignal): Promise<ChallengeSummary[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/challenges`, { signal }),
    "챌린지 목록을 불러오지 못했습니다."
  );
  return ensureArray<ChallengeSummary>(data);
}

export async function getChallenge(key: string, signal?: AbortSignal): Promise<ChallengeDetail> {
  return callOrThrow(
    () => api.get<ChallengeDetail>(`${BASE}/challenges/${encodeURIComponent(key)}`, { signal }),
    "챌린지를 불러오지 못했습니다."
  );
}

// 마감 D-day — 음수면 마감 지남, null이면 상시. (UI 표기용 순수 헬퍼)
export function challengeDday(endsAt: string | null, now: Date = new Date()): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - now.getTime()) / 86_400_000);
}

// ── 창작자 팔로우/공개 프로필 ──────────────────────────────────────────
export interface CreatorProfile {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  createdAt: string | null;
  followers: number;
  following: number;
  isFollowing: boolean;
  works: number;
  series: number;
}

export async function getCreatorProfile(userId: string, signal?: AbortSignal): Promise<CreatorProfile> {
  return callOrThrow(
    () => api.get<CreatorProfile>(`${BASE}/users/${encodeURIComponent(userId)}/profile`, { signal }),
    "프로필을 불러오지 못했습니다."
  );
}

export async function toggleFollow(creatorId: string): Promise<{ following: boolean; followers: number }> {
  return callOrThrow(
    () =>
      api.post<{ following: boolean; followers: number }>(
        `${BASE}/users/${encodeURIComponent(creatorId)}/follow`
      ),
    "팔로우를 처리하지 못했습니다."
  );
}

// 팔로잉 피드 — 팔로우한 창작자의 최신 작품(로그인 필요).
export async function listFollowingFeed(signal?: AbortSignal): Promise<WorkSummary[]> {
  const data = await callOrThrow(
    () => api.get<unknown>(`${BASE}/feed/following`, { signal }),
    "팔로잉 피드를 불러오지 못했습니다."
  );
  return unwrapWorks(data);
}
