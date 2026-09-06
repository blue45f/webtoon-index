import { api, getApiErrorMessage } from "@/src/infrastructure/api";

export interface StudioServerRevisionSummary {
  readonly revision: number;
  readonly restoredFromRevision: number | null;
  readonly createdAt: string;
}

interface CreatorWorkRevisionHead {
  readonly revision?: number;
  readonly isOwner?: boolean;
}

interface CreatorWorkMutationRevision {
  readonly revision: number;
}

export interface StudioServerRevisionState {
  readonly workId: string;
  readonly currentRevision: number;
  readonly revisions: readonly StudioServerRevisionSummary[];
}

const MAX_REVISION = 2_147_483_647;

export function serverRevisionWorkId(scopeKey: string): string | null {
  if (!scopeKey.startsWith("work:")) return null;
  const workId = scopeKey.slice(5).trim();
  return workId.length > 0 && workId.length <= 160 ? workId : null;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_REVISION;
}

function parseRevisionRows(value: unknown): StudioServerRevisionSummary[] {
  if (!Array.isArray(value)) throw new Error("서버 버전 목록 형식이 올바르지 않습니다.");
  return value.map((row) => {
    if (!row || typeof row !== "object") throw new Error("서버 버전 항목 형식이 올바르지 않습니다.");
    const candidate = row as Partial<StudioServerRevisionSummary>;
    if (
      !validRevision(candidate.revision)
      || (candidate.restoredFromRevision !== null && !validRevision(candidate.restoredFromRevision))
      || typeof candidate.createdAt !== "string"
      || Number.isNaN(Date.parse(candidate.createdAt))
    ) {
      throw new Error("서버 버전 항목 형식이 올바르지 않습니다.");
    }
    return {
      revision: candidate.revision,
      restoredFromRevision: candidate.restoredFromRevision,
      createdAt: candidate.createdAt,
    };
  });
}

export async function loadStudioServerRevisions(scopeKey: string): Promise<StudioServerRevisionState | null> {
  const workId = serverRevisionWorkId(scopeKey);
  if (!workId) return null;
  const encoded = encodeURIComponent(workId);
  try {
    const [head, rows] = await Promise.all([
      api.get<CreatorWorkRevisionHead>(`/creator/works/${encoded}`),
      api.get<unknown>(`/creator/works/${encoded}/revisions`, { params: { limit: 50 } }),
    ]);
    if (head.isOwner !== true || !validRevision(head.revision)) {
      throw new Error("현재 원고의 서버 revision을 확인할 수 없습니다.");
    }
    return { workId, currentRevision: head.revision, revisions: parseRevisionRows(rows) };
  } catch (error) {
    throw new Error(await getApiErrorMessage(error, "서버 원고 버전을 불러오지 못했습니다."), { cause: error });
  }
}

export async function restoreStudioServerRevision(
  state: StudioServerRevisionState,
  targetRevision: number,
): Promise<number> {
  if (!validRevision(targetRevision)) throw new Error("복원할 서버 revision이 올바르지 않습니다.");
  const encoded = encodeURIComponent(state.workId);
  try {
    const result = await api.post<CreatorWorkMutationRevision>(
      `/creator/works/${encoded}/revisions/${targetRevision}/restore`,
      { baseRevision: state.currentRevision },
    );
    if (!validRevision(result.revision)) throw new Error("복원 응답의 revision이 올바르지 않습니다.");
    return result.revision;
  } catch (error) {
    throw new Error(await getApiErrorMessage(error, "서버 원고 버전을 복원하지 못했습니다."), { cause: error });
  }
}
