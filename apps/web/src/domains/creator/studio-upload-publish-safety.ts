export type StudioUploadHydrationStatus = "ready" | "loading" | "error";

export interface StudioUploadPublishScope {
  authUserId: string;
  workId: string | null;
}

export interface StudioUploadCurrentScope {
  authUserId: string | null;
  workId: string | null;
}

export interface StudioUploadSavedWorkIdentity {
  id: string;
  author: { id: string };
  revision?: number;
}

export type StudioUploadSharedRole = "owner" | "admin" | "editor" | "commenter" | "viewer";
export type StudioUploadSharedAccess = "edit" | "comment" | "view";

export interface StudioUploadSharedDocumentIdentity {
  workId: string;
  role: StudioUploadSharedRole;
  status: "active";
  capabilities: { view: true; edit: boolean };
  access: StudioUploadSharedAccess;
  revision: number;
  crdtServerSequence: string;
  document: { format: string };
}

export interface StudioUploadSharedMetaIdentity {
  workId: string;
  role: StudioUploadSharedRole;
  status: "active";
  capabilities: { view: true; edit: boolean };
  access: StudioUploadSharedAccess;
  revision: number;
  crdtServerSequence: string;
}

export interface StudioUploadSharedSaveIdentity {
  workId: string;
  revision: number;
  updatedAt: string;
}

const MAX_REVISION = 2_147_483_647;
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
export const STUDIO_UPLOAD_MAX_JSON_BYTES = 15 * 1024 * 1024;
const STUDIO_UPLOAD_EDIT_ROLES = new Set<StudioUploadSharedRole>([
  "owner",
  "admin",
  "editor",
]);

export class StudioUploadPublishSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioUploadPublishSafetyError";
  }
}

export class StudioUploadPublishScopeInvalidatedError extends Error {
  constructor() {
    super("업로드 게시 범위가 변경되었습니다.");
    this.name = "StudioUploadPublishScopeInvalidatedError";
  }
}

export class StudioUploadSharedAccessChangedError extends Error {
  constructor(message = "공동 문서 권한 또는 버전이 변경되었습니다. 다시 불러와 주세요.") {
    super(message);
    this.name = "StudioUploadSharedAccessChangedError";
  }
}

export function isStudioUploadSharedAccessChangedError(
  error: unknown
): error is StudioUploadSharedAccessChangedError {
  return error instanceof StudioUploadSharedAccessChangedError;
}

export function isStudioUploadPublishScopeInvalidatedError(
  error: unknown
): error is StudioUploadPublishScopeInvalidatedError {
  return error instanceof StudioUploadPublishScopeInvalidatedError;
}

export function captureStudioUploadPublishScope(
  authUserId: string | null | undefined,
  workId: string | null
): StudioUploadPublishScope {
  if (!authUserId) {
    throw new StudioUploadPublishSafetyError("로그인 후 게시할 수 있어요.");
  }
  return { authUserId, workId };
}

export function isStudioUploadPublishScopeCurrent(
  captured: StudioUploadPublishScope,
  current: StudioUploadCurrentScope,
  mounted: boolean
): boolean {
  return (
    mounted &&
    captured.authUserId === current.authUserId &&
    captured.workId === current.workId
  );
}

export function isStudioUploadHydrationScopeCurrent(
  hydrated: StudioUploadPublishScope | null,
  current: StudioUploadCurrentScope
): boolean {
  return (
    hydrated !== null &&
    hydrated.authUserId === current.authUserId &&
    hydrated.workId === current.workId
  );
}

export function assertStudioUploadPublishScope(
  captured: StudioUploadPublishScope,
  current: StudioUploadCurrentScope,
  mounted: boolean,
  signal: AbortSignal
): void {
  if (signal.aborted || !isStudioUploadPublishScopeCurrent(captured, current, mounted)) {
    throw new StudioUploadPublishScopeInvalidatedError();
  }
}

export function validateStudioUploadHydratedSharedDocument(
  work: StudioUploadSharedDocumentIdentity,
  scope: StudioUploadPublishScope
): number {
  if (scope.workId === null || work.workId !== scope.workId || work.status !== "active") {
    throw new StudioUploadPublishSafetyError("현재 범위의 공동 문서 응답을 확인하지 못했어요.");
  }
  if (work.document.format !== "upload") {
    throw new StudioUploadPublishSafetyError("이 작품은 컷툰 스튜디오에서 수정해야 해요.");
  }
  if (
    !Number.isInteger(work.revision) ||
    work.revision < 1 ||
    work.revision > MAX_REVISION
  ) {
    throw new StudioUploadPublishSafetyError(
      "작품의 저장 버전을 확인하지 못했습니다. 다시 불러와 주세요."
    );
  }
  resolveStudioUploadSharedCrdtSaveFence(work);
  const expectedAccess: StudioUploadSharedAccess = STUDIO_UPLOAD_EDIT_ROLES.has(work.role)
    ? "edit"
    : work.role === "commenter"
      ? "comment"
      : "view";
  if (
    work.access !== expectedAccess ||
    work.capabilities.view !== true ||
    work.capabilities.edit !== (expectedAccess === "edit")
  ) {
    throw new StudioUploadPublishSafetyError("공동 문서 역할과 편집 권한이 일치하지 않습니다.");
  }
  return work.revision;
}

export function canEditStudioUploadSharedDocument(
  meta: StudioUploadSharedMetaIdentity | null
): boolean {
  return Boolean(
    meta &&
      meta.status === "active" &&
      STUDIO_UPLOAD_EDIT_ROLES.has(meta.role) &&
      meta.access === "edit" &&
      meta.capabilities.view &&
      meta.capabilities.edit
  );
}

export function canPublishStudioUploadSharedDocument(
  meta: StudioUploadSharedMetaIdentity | null
): boolean {
  return Boolean(meta?.role === "owner" && canEditStudioUploadSharedDocument(meta));
}

/**
 * Upload mode has no live CRDT binding, so it uses the fresh meta response as a server-attested
 * optimistic fence. The PATCH transaction re-checks this value under the CRDT advisory lock.
 */
export function resolveStudioUploadSharedCrdtSaveFence(
  meta: Pick<StudioUploadSharedMetaIdentity, "crdtServerSequence">
): string {
  const sequence = meta.crdtServerSequence;
  if (
    !/^(?:0|[1-9]\d{0,18})$/.test(sequence) ||
    BigInt(sequence) > POSTGRES_BIGINT_MAX
  ) {
    throw new StudioUploadPublishSafetyError(
      "공동 문서 CRDT 저장 순번을 확인하지 못했습니다."
    );
  }
  return sequence;
}

export function resolveStudioUploadActionLocks({
  workId,
  workspaceLocked,
  meta,
}: {
  workId: string | null;
  workspaceLocked: boolean;
  meta: StudioUploadSharedMetaIdentity | null;
}): {
  sharedCanEdit: boolean;
  sharedCanPublish: boolean;
  mutationLocked: boolean;
  publishLocked: boolean;
} {
  const sharedCanEdit = workId === null || canEditStudioUploadSharedDocument(meta);
  const sharedCanPublish = workId === null || canPublishStudioUploadSharedDocument(meta);
  return {
    sharedCanEdit,
    sharedCanPublish,
    mutationLocked: workspaceLocked || !sharedCanEdit,
    publishLocked: workspaceLocked || !sharedCanPublish,
  };
}

export function assertStudioUploadSharedMetaUnchanged(
  expected: StudioUploadSharedMetaIdentity,
  fresh: StudioUploadSharedMetaIdentity
): void {
  if (
    expected.workId !== fresh.workId ||
    expected.status !== fresh.status ||
    expected.role !== fresh.role ||
    expected.access !== fresh.access ||
    expected.capabilities.view !== fresh.capabilities.view ||
    expected.capabilities.edit !== fresh.capabilities.edit ||
    expected.revision !== fresh.revision
  ) {
    throw new StudioUploadSharedAccessChangedError();
  }
}

export function advanceStudioUploadSharedMetaAfterSave<
  Meta extends StudioUploadSharedMetaIdentity & { updatedAt: string },
>(expected: Meta, saved: StudioUploadSharedSaveIdentity): Meta {
  const timestamp = Date.parse(saved.updatedAt);
  if (
    saved.workId !== expected.workId ||
    saved.revision !== expected.revision + 1 ||
    !Number.isFinite(timestamp)
  ) {
    throw new StudioUploadPublishSafetyError("공동 문서 저장 메타를 안전하게 갱신하지 못했습니다.");
  }
  return { ...expected, revision: saved.revision, updatedAt: new Date(timestamp).toISOString() };
}

export function shouldResetStudioUploadDraft(
  previous: StudioUploadCurrentScope,
  current: StudioUploadCurrentScope
): boolean {
  if (previous.workId !== current.workId) return true;
  if (
    previous.workId === null &&
    current.workId === null &&
    previous.authUserId === null &&
    current.authUserId !== null
  ) {
    return false;
  }
  return previous.authUserId !== current.authUserId;
}

export function studioUploadJsonByteLength(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StudioUploadPublishSafetyError("저장 데이터를 JSON으로 직렬화하지 못했습니다.");
  }
  if (serialized === undefined) {
    throw new StudioUploadPublishSafetyError("저장할 JSON 데이터가 올바르지 않습니다.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertStudioUploadJsonPayloadSize(
  value: unknown,
  maximumBytes = STUDIO_UPLOAD_MAX_JSON_BYTES
): number {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new StudioUploadPublishSafetyError("저장 데이터 용량 제한이 올바르지 않습니다.");
  }
  const bytes = studioUploadJsonByteLength(value);
  if (bytes > maximumBytes) {
    throw new StudioUploadPublishSafetyError(
      "저장 데이터가 안전 한도 15MB를 초과합니다. 이미지를 더 작게 줄이거나 여러 작품·에피소드로 나눠 주세요."
    );
  }
  return bytes;
}

export function resolveStudioUploadUpdateRevision(
  scope: StudioUploadPublishScope,
  hydratedScope: StudioUploadPublishScope | null,
  hydrationStatus: StudioUploadHydrationStatus,
  revision: number | undefined
): number | undefined {
  if (!scope.workId) return undefined;
  if (
    hydrationStatus !== "ready" ||
    !isStudioUploadHydrationScopeCurrent(hydratedScope, scope) ||
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > MAX_REVISION
  ) {
    throw new StudioUploadPublishSafetyError(
      "기존 작품을 안전하게 불러온 뒤 다시 저장해 주세요."
    );
  }
  return revision;
}

export function validateStudioUploadSavedWork(
  work: StudioUploadSavedWorkIdentity,
  scope: StudioUploadPublishScope,
  baseRevision: number | undefined
): number | undefined {
  if (
    !work.id ||
    work.author.id !== scope.authUserId ||
    (scope.workId !== null && work.id !== scope.workId)
  ) {
    throw new StudioUploadPublishSafetyError("현재 게시 범위와 다른 작품 응답을 받았습니다.");
  }
  if (scope.workId !== null) {
    if (
      baseRevision === undefined ||
      typeof work.revision !== "number" ||
      !Number.isInteger(work.revision) ||
      work.revision <= baseRevision ||
      work.revision > MAX_REVISION
    ) {
      throw new StudioUploadPublishSafetyError("수정된 작품의 저장 버전을 확인하지 못했어요.");
    }
    return work.revision;
  }
  if (work.revision === undefined) return undefined;
  if (
    typeof work.revision !== "number" ||
    !Number.isInteger(work.revision) ||
    work.revision < 1 ||
    work.revision > MAX_REVISION
  ) {
    throw new StudioUploadPublishSafetyError("게시된 작품의 저장 버전을 확인하지 못했어요.");
  }
  return work.revision;
}

export function isStudioUploadWorkspaceLocked({
  workId,
  currentScope,
  hydratedScope,
  hydrationStatus,
  saving,
  loadingFiles,
}: {
  workId: string | null;
  currentScope: StudioUploadCurrentScope;
  hydratedScope: StudioUploadPublishScope | null;
  hydrationStatus: StudioUploadHydrationStatus;
  saving: boolean;
  loadingFiles: boolean;
}): boolean {
  return (
    saving ||
    loadingFiles ||
    Boolean(
      workId &&
        (hydrationStatus !== "ready" ||
          !isStudioUploadHydrationScopeCurrent(hydratedScope, currentScope))
    )
  );
}

export async function runStudioUploadPublishStages<Client, Result>({
  scope,
  currentScope,
  mounted,
  signal,
  downscale,
  loadClient,
  mutate,
}: {
  scope: StudioUploadPublishScope;
  currentScope: () => StudioUploadCurrentScope;
  mounted: () => boolean;
  signal: AbortSignal;
  downscale: () => Promise<string>;
  loadClient: () => Promise<Client>;
  mutate: (client: Client, cover: string, signal: AbortSignal) => Promise<Result>;
}): Promise<Result> {
  const assertCurrent = () =>
    assertStudioUploadPublishScope(scope, currentScope(), mounted(), signal);

  assertCurrent();
  const cover = await downscale();
  assertCurrent();
  const client = await loadClient();
  assertCurrent();
  const result = await mutate(client, cover, signal);
  assertCurrent();
  return result;
}
