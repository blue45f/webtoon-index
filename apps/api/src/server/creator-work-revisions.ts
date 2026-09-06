import { projectRevisionComparisonValue } from "../../../web/src/shared/lib/revision-comparison-projection";

export const CREATOR_WORK_REVISION_RETENTION = 20;
export const CREATOR_WORK_REVISION_MAX = 2_147_483_647;

export interface CreatorWorkRevisionSnapshot {
  titleId: string | null;
  title: string;
  description: string;
  cover: string;
  tags: string[];
  format: "cuttoon" | "upload";
  pages: string[];
  doc: unknown;
  status: "draft" | "published";
  seriesId: string | null;
  episodeNo: number | null;
  challengeId: string | null;
  remixFromId: string | null;
}

/**
 * Studio's semantic comparison does not need the rendered publication assets. Keeping this as a
 * separate type prevents a caller from accidentally returning cover/page data URLs through the
 * lightweight comparison API.
 */
export type CreatorWorkRevisionComparisonSnapshot = Omit<
  CreatorWorkRevisionSnapshot,
  "cover" | "pages"
>;

export interface CreatorWorkRevisionSnapshotSource {
  titleId?: unknown;
  title?: unknown;
  description?: unknown;
  cover?: unknown;
  tags?: unknown;
  format?: unknown;
  pages?: unknown;
  doc?: unknown;
  status?: unknown;
  seriesId?: unknown;
  episodeNo?: unknown;
  challengeId?: unknown;
  remixFromId?: unknown;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Snapshot에는 작성자/조회수/관리자 hidden 상태를 넣지 않는다. 복원은 창작자가 편집할 수 있는 작품
 * 콘텐츠만 되돌리고, 계정·공개 반응·관리 상태는 현재 값을 유지해야 하기 때문이다.
 */
export function createCreatorWorkRevisionSnapshot(
  source: CreatorWorkRevisionSnapshotSource
): CreatorWorkRevisionSnapshot {
  return {
    titleId: nullableText(source.titleId),
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    cover: typeof source.cover === "string" ? source.cover : "",
    tags: stringList(source.tags),
    format: source.format === "upload" ? "upload" : "cuttoon",
    pages: stringList(source.pages),
    doc: source.doc ?? {},
    status: source.status === "published" ? "published" : "draft",
    seriesId: nullableText(source.seriesId),
    episodeNo: nullableInteger(source.episodeNo),
    challengeId: nullableText(source.challengeId),
    remixFromId: nullableText(source.remixFromId),
  };
}

/** Owner-only comparison projection without rendered assets or private AI/resource payloads. */
export async function createCreatorWorkRevisionComparisonSnapshot(
  source: CreatorWorkRevisionSnapshotSource
): Promise<CreatorWorkRevisionComparisonSnapshot> {
  const { cover: _cover, pages: _pages, ...comparison } =
    createCreatorWorkRevisionSnapshot(source);
  return {
    ...comparison,
    doc: await projectRevisionComparisonValue(comparison.doc),
  };
}

export function parseCreatorWorkRevision(value: unknown, fieldName = "revision"): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > CREATOR_WORK_REVISION_MAX) {
    throw new Error(`${fieldName}은(는) 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}

/** 새 revision을 포함해 정확히 보존 상한만 남기기 위한 inclusive 삭제 경계. */
export function creatorWorkRevisionRetentionCutoff(currentRevision: number): number | null {
  const current = parseCreatorWorkRevision(currentRevision, "현재 revision");
  const cutoff = current - CREATOR_WORK_REVISION_RETENTION;
  return cutoff >= 1 ? cutoff : null;
}

export class CreatorWorkRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("다른 저장이 먼저 반영되어 현재 문서와 서버 revision이 달라졌습니다.");
    this.name = "CreatorWorkRevisionConflictError";
    this.currentRevision = parseCreatorWorkRevision(currentRevision, "현재 revision");
  }
}

/** 작품 또는 snapshot의 존재 여부와 소유자 여부를 외부에 구분해 노출하지 않는 owner-only 오류. */
export class CreatorWorkRevisionNotFoundError extends Error {
  constructor() {
    super("작품 revision을 찾을 수 없습니다.");
    this.name = "CreatorWorkRevisionNotFoundError";
  }
}
