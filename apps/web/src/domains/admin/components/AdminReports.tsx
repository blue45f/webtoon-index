import {
  CheckCircle,
  ExternalLink,
  Flag,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getAdminAdvancedCopy } from "../admin-advanced-copy";
import {
  countReportsByStatus,
  filterReports,
  runWithConcurrency,
  toggleReportSelection,
  toggleVisibleReportSelection,
  type ReportStatus,
} from "../admin-reports-model";

import { adminFetch, formatDate } from "./admin-client";
import { adminButtonClass } from "./admin-ui-utils";
import { AdminDialog } from "./AdminDialog";
import { useAdminToast } from "./use-admin-toast";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export interface ContentReportItem {
  id: string;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: string;
}

interface AdminReportsProps {
  userId: string;
}

interface PendingReportAction {
  ids: string[];
  action: "resolve" | "dismiss";
}

const STATUS_TONE: Record<ReportStatus, string> = {
  pending: "border-warn/35 bg-warn/10 text-warn",
  resolved: "border-good/35 bg-good/10 text-good",
  dismissed: "border-line bg-panel text-fg-3",
};

export function AdminReports({ userId }: AdminReportsProps) {
  const [reports, setReports] = useState<ContentReportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">(
    "pending",
  );
  const [targetFilter, setTargetFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingReportAction | null>(null);
  const [note, setNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const copy = getAdminAdvancedCopy(lang);
  const { showToast } = useAdminToast();

  const loadData = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await adminFetch<{ items: ContentReportItem[] }>(
          "/reports?status=all&limit=200",
          userId,
        );
        setReports(response.items ?? []);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("admin.reports.loadError"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t, userId],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const statusLabels: Record<ReportStatus, string> = {
    pending: t("admin.reports.statusPending"),
    resolved: t("admin.reports.statusResolved"),
    dismissed: t("admin.reports.statusDismissed"),
  };

  const counts = useMemo(() => countReportsByStatus(reports), [reports]);
  const targetTypes = useMemo(
    () =>
      Array.from(new Set(reports.map((item) => item.targetType)))
        .filter(Boolean)
        .sort(),
    [reports],
  );
  const visibleReports = useMemo(
    () =>
      filterReports(reports, {
        status: statusFilter,
        targetType: targetFilter,
        query,
      }),
    [query, reports, statusFilter, targetFilter],
  );
  const visiblePendingIds = useMemo(
    () =>
      visibleReports
        .filter((item) => item.status === "pending")
        .map((item) => item.id),
    [visibleReports],
  );
  const allVisibleSelected =
    visiblePendingIds.length > 0 &&
    visiblePendingIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    const pendingIds = new Set(
      reports
        .filter((item) => item.status === "pending")
        .map((item) => item.id),
    );
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => pendingIds.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
  }, [reports]);

  const openAction = (
    ids: string[],
    action: PendingReportAction["action"],
  ) => {
    if (!ids.length) return;
    setNote("");
    setProcessedCount(0);
    setPendingAction({ ids, action });
  };

  const closeAction = () => {
    if (processing) return;
    setPendingAction(null);
    setNote("");
    setProcessedCount(0);
  };

  const processReports = async () => {
    if (!pendingAction) return;
    setProcessing(true);
    setProcessedCount(0);

    const results = await runWithConcurrency(
      pendingAction.ids,
      5,
      async (id) => {
        await adminFetch(
          `/reports/${encodeURIComponent(id)}/resolve`,
          userId,
          {
            method: "POST",
            body: JSON.stringify({
              action: pendingAction.action,
              note: note.trim(),
            }),
          },
        );
        setProcessedCount((current) => current + 1);
      },
    );

    const succeededIds = new Set(
      results.filter((item) => item.ok).map((item) => item.value),
    );
    const failed = results.length - succeededIds.size;
    const nextStatus: ReportStatus =
      pendingAction.action === "resolve" ? "resolved" : "dismissed";

    setReports((current) =>
      current.map((item) =>
        succeededIds.has(item.id)
          ? {
              ...item,
              status: nextStatus,
              resolutionNote: note.trim() || null,
            }
          : item,
      ),
    );
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of succeededIds) next.delete(id);
      return next;
    });

    showToast(
      copy.reports.processSuccess.replace(
        "{count}",
        succeededIds.size.toLocaleString(),
      ),
      failed > 0
        ? copy.reports.partialFailure.replace(
            "{failed}",
            failed.toLocaleString(),
          )
        : undefined,
      failed > 0 ? "warning" : "success",
    );

    setProcessing(false);
    setPendingAction(null);
    setNote("");
    setProcessedCount(0);
  };

  const statusFilters: Array<{
    value: ReportStatus | "all";
    label: string;
    count: number;
  }> = [
    {
      value: "pending",
      label: statusLabels.pending,
      count: counts.pending,
    },
    {
      value: "resolved",
      label: statusLabels.resolved,
      count: counts.resolved,
    },
    {
      value: "dismissed",
      label: statusLabels.dismissed,
      count: counts.dismissed,
    },
    {
      value: "all",
      label: t("admin.revenue.filterAll"),
      count: reports.length,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Flag className="size-5 text-amber-400" />
              {t("admin.reports.title")}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {t("admin.reports.desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className={adminButtonClass("ghost")}
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : undefined}
            />
            {copy.reports.refresh}
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px]">
          <label className="relative">
            <span className="sr-only">{copy.reports.searchPlaceholder}</span>
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={120}
              placeholder={copy.reports.searchPlaceholder}
              className="h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-3 text-sm text-fg outline-none focus:border-accent/60"
            />
          </label>

          <label>
            <span className="sr-only">{copy.reports.targetAll}</span>
            <select
              value={targetFilter}
              onChange={(event) => setTargetFilter(event.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-fg outline-none focus:border-accent/60"
            >
              <option value="all">{copy.reports.targetAll}</option>
              {targetTypes.map((targetType) => (
                <option key={targetType} value={targetType}>
                  {targetType}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors",
                statusFilter === filter.value
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line bg-panel/40 text-fg-3 hover:text-fg",
              )}
            >
              {filter.label}
              <span className="numeral rounded-full bg-black/20 px-1.5 py-0.5 text-[0.65rem]">
                {filter.count}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/50 px-3 py-2 sm:flex-row sm:items-center">
        <label className="inline-flex min-h-10 items-center gap-2 text-xs text-fg-2">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={() =>
              setSelectedIds((current) =>
                toggleVisibleReportSelection(current, visiblePendingIds),
              )
            }
            disabled={visiblePendingIds.length === 0}
            className="size-4 rounded border-line accent-accent"
          />
          {copy.reports.selectPage}
        </label>
        <span className="text-xs text-fg-3">
          {copy.reports.selectedCount.replace(
            "{count}",
            selectedIds.size.toLocaleString(),
          )}
        </span>
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              className={adminButtonClass("ghost")}
              onClick={() => openAction([...selectedIds], "dismiss")}
            >
              <XCircle size={13} />
              {copy.reports.bulkDismiss}
            </button>
            <button
              type="button"
              className={adminButtonClass("accent")}
              onClick={() => openAction([...selectedIds], "resolve")}
            >
              <CheckCircle size={13} />
              {copy.reports.bulkResolve}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="skeleton h-40 rounded-2xl" />
          ))}
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400">
          {t("admin.reports.empty")}
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleReports.map((item) => {
            const selectable = item.status === "pending";
            return (
              <article
                key={item.id}
                className={cn(
                  "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-xl",
                  selectedIds.has(item.id) &&
                    "border-accent/40 bg-accent/5",
                )}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() =>
                        setSelectedIds((current) =>
                          toggleReportSelection(current, item.id),
                        )
                      }
                      disabled={!selectable}
                      aria-label={`${item.targetType} ${item.targetId}`}
                      className="mt-1 size-4 shrink-0 rounded border-line accent-accent"
                    />

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_TONE[item.status],
                          )}
                        >
                          {statusLabels[item.status]}
                        </span>
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-xs text-slate-300">
                          {item.targetType}
                        </span>
                        <span className="max-w-sm truncate text-xs text-slate-500">
                          ID: {item.targetId}
                        </span>
                      </div>

                      <p className="text-sm font-medium text-white">
                        {item.reporterName ||
                          item.reporterEmail ||
                          item.reporterId}
                      </p>
                      <p className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-sm text-slate-300">
                        <span className="font-semibold text-amber-400">
                          {t("admin.reports.reasonPrefix")}
                        </span>{" "}
                        {item.reason}
                      </p>

                      {item.resolutionNote ? (
                        <p className="text-xs italic text-slate-400">
                          {t("admin.reports.notePrefix")} {item.resolutionNote}
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-500">
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link
                      href={`/admin/community?q=${encodeURIComponent(
                        item.targetId,
                      )}`}
                      className={adminButtonClass("ghost")}
                    >
                      <ExternalLink size={13} />
                      {copy.reports.viewTarget}
                    </Link>
                    {item.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openAction([item.id], "dismiss")}
                          className={adminButtonClass("ghost")}
                        >
                          <XCircle size={13} />
                          {t("admin.reports.actionDismiss")}
                        </button>
                        <button
                          type="button"
                          onClick={() => openAction([item.id], "resolve")}
                          className={adminButtonClass("accent")}
                        >
                          <CheckCircle size={13} />
                          {t("admin.reports.actionResolve")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminDialog
        open={pendingAction != null}
        onClose={closeAction}
        title={
          pendingAction?.ids.length && pendingAction.ids.length > 1
            ? copy.reports.bulkTitle
            : pendingAction?.action === "dismiss"
              ? copy.reports.dismissTitle
              : copy.reports.resolveTitle
        }
        description={
          pendingAction
            ? copy.reports.selectedCount.replace(
                "{count}",
                pendingAction.ids.length.toLocaleString(),
              )
            : undefined
        }
        busy={processing}
        closeLabel={copy.common.close}
        footer={
          <>
            <button
              type="button"
              className={adminButtonClass("ghost")}
              onClick={closeAction}
              disabled={processing}
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              className={adminButtonClass(
                pendingAction?.action === "dismiss" ? "ghost" : "accent",
              )}
              onClick={() => void processReports()}
              disabled={processing}
            >
              {processing
                ? `${processedCount}/${pendingAction?.ids.length ?? 0}`
                : copy.common.confirm}
            </button>
          </>
        }
      >
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-2">
            {copy.reports.note}
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={5}
            placeholder={copy.reports.notePlaceholder}
            className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-accent/60"
          />
          <span className="text-right text-[0.68rem] text-fg-3">
            {note.length}/500
          </span>
        </label>
      </AdminDialog>
    </div>
  );
}
