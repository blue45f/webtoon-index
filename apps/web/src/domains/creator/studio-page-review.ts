export const PAGE_REVIEW_STATUSES = ["draft", "needs-review", "changes-requested", "approved"] as const;

export type PageReviewStatus = (typeof PAGE_REVIEW_STATUSES)[number];

export const PAGE_REVIEW_STATUS_LABELS: Record<PageReviewStatus, string> = {
  draft: "작업 중",
  "needs-review": "검토 요청",
  "changes-requested": "수정 요청",
  approved: "승인",
};

export interface PageReviewState {
  status: PageReviewStatus;
  locked: boolean;
  assignee?: string;
  note?: string;
  updatedAt?: string;
}

export const DEFAULT_PAGE_REVIEW_STATE: PageReviewState = { status: "draft", locked: false };

export function normalizePageReviewState(value: unknown): PageReviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PAGE_REVIEW_STATE };
  const record = value as Record<string, unknown>;
  const status = PAGE_REVIEW_STATUSES.includes(record.status as PageReviewStatus)
    ? (record.status as PageReviewStatus)
    : "draft";
  const assignee = typeof record.assignee === "string" ? record.assignee.trim().slice(0, 80) : "";
  const note = typeof record.note === "string" ? record.note.trim().slice(0, 2_000) : "";
  const updatedAt =
    typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt))
      ? record.updatedAt
      : undefined;
  return {
    status,
    locked: record.locked === true,
    ...(assignee ? { assignee } : {}),
    ...(note ? { note } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function patchPageReviewState(
  value: unknown,
  patch: Partial<Omit<PageReviewState, "updatedAt">>,
  now = new Date()
): PageReviewState {
  return normalizePageReviewState({
    ...normalizePageReviewState(value),
    ...patch,
    updatedAt: now.toISOString(),
  });
}

export function isPageReviewLocked(value: unknown): boolean {
  return normalizePageReviewState(value).locked;
}

/**
 * Finds the first locked page whose object was replaced or removed by a proposed page-list
 * transition. Studio page commands preserve the object identity of untouched pages, so this
 * catches content/meta deletion and replacement while still allowing harmless list reordering
 * and insertion beside a locked page.
 */
export function findChangedLockedPageId<T extends { id: string; review?: unknown }>(
  currentPages: readonly T[],
  nextPages: readonly T[]
): string | null {
  const nextById = new Map(nextPages.map((page) => [page.id, page]));
  return currentPages.find(
    (page) => isPageReviewLocked(page.review) && nextById.get(page.id) !== page
  )?.id ?? null;
}
