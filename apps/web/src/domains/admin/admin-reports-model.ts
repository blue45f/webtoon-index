export type ReportStatus = "pending" | "resolved" | "dismissed";

export interface ReportFilterableItem {
  id: string;
  reporterId: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolutionNote?: string | null;
}

export interface ReportFilters {
  status: ReportStatus | "all";
  targetType: string;
  query: string;
}

export function filterReports<T extends ReportFilterableItem>(
  items: readonly T[],
  filters: ReportFilters,
): T[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status !== "all" && item.status !== filters.status) {
      return false;
    }
    if (filters.targetType !== "all" && item.targetType !== filters.targetType) {
      return false;
    }
    if (!query) return true;

    return [
      item.id,
      item.reporterId,
      item.reporterName,
      item.reporterEmail,
      item.targetType,
      item.targetId,
      item.reason,
      item.resolutionNote,
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

export function countReportsByStatus(
  items: readonly ReportFilterableItem[],
): Record<ReportStatus, number> {
  return items.reduce<Record<ReportStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { pending: 0, resolved: 0, dismissed: 0 },
  );
}

export function toggleReportSelection(
  selected: ReadonlySet<string>,
  reportId: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(reportId)) next.delete(reportId);
  else next.add(reportId);
  return next;
}

export function toggleVisibleReportSelection(
  selected: ReadonlySet<string>,
  visiblePendingIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const ids = visiblePendingIds.filter(Boolean);
  const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

export async function runWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<void>,
): Promise<Array<{ value: T; ok: boolean; error?: unknown }>> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results: Array<{ value: T; ok: boolean; error?: unknown }> =
    new Array(values.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      try {
        await worker(value, index);
        results[index] = { value, ok: true };
      } catch (error) {
        results[index] = { value, ok: false, error };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(normalizedLimit, values.length) }, run),
  );
  return results;
}
