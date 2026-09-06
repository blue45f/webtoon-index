export const MEMBER_ROLES = ["user", "creator", "operator", "admin"] as const;
export const MEMBER_STATUSES = ["active", "suspended", "deleted"] as const;
export const MEMBER_SORTS = [
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type MemberSort = (typeof MEMBER_SORTS)[number];

export interface MemberListFilters {
  q: string;
  role: MemberRole | "all";
  status: MemberStatus | "all";
  sort: MemberSort;
  limit: number;
  offset: number;
}

export function splitMemberSort(sort: MemberSort): {
  sort: "createdAt" | "name";
  direction: "asc" | "desc";
} {
  if (sort === "created_asc") return { sort: "createdAt", direction: "asc" };
  if (sort === "name_asc") return { sort: "name", direction: "asc" };
  if (sort === "name_desc") return { sort: "name", direction: "desc" };
  return { sort: "createdAt", direction: "desc" };
}

export function buildMemberQuery(
  filters: MemberListFilters,
  options: { includePaging?: boolean } = {},
): string {
  const params = new URLSearchParams();
  const search = filters.q.trim();
  if (search) params.set("q", search);
  if (filters.role !== "all") params.set("role", filters.role);
  if (filters.status !== "all") params.set("status", filters.status);

  const sort = splitMemberSort(filters.sort);
  params.set("sort", sort.sort);
  params.set("direction", sort.direction);

  if (options.includePaging !== false) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
    params.set("offset", String(Math.max(0, Math.floor(filters.offset))));
  }

  return params.toString();
}

export function getPageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 25;
  return Math.max(1, Math.ceil(total / size));
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const maxPage = getPageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(maxPage, Math.max(1, Math.floor(page)));
}

export function toggleMemberSelection(
  selected: ReadonlySet<string>,
  memberId: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(memberId)) next.delete(memberId);
  else next.add(memberId);
  return next;
}

export function toggleVisibleMemberSelection(
  selected: ReadonlySet<string>,
  visibleMemberIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const selectable = visibleMemberIds.filter(Boolean);
  const everySelected =
    selectable.length > 0 && selectable.every((id) => next.has(id));

  for (const id of selectable) {
    if (everySelected) next.delete(id);
    else next.add(id);
  }

  return next;
}

export interface MemberCsvRow {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  status: string;
  createdAt?: string | null;
}

function spreadsheetSafeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildMemberCsv(rows: readonly MemberCsvRow[]): string {
  const header = ["ID", "Name", "Email", "Role", "Status", "CreatedAt"]
    .map(spreadsheetSafeCsvCell)
    .join(",");
  const body = rows
    .map((row) =>
      [
        row.id,
        row.name ?? "",
        row.email ?? "",
        row.role,
        row.status,
        row.createdAt ?? "",
      ]
        .map(spreadsheetSafeCsvCell)
        .join(","),
    )
    .join("\n");
  return `\uFEFF${header}\n${body}`;
}

export function interpolateCount(template: string, count: number): string {
  return template.replace("{count}", count.toLocaleString());
}
