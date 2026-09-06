import {
  CalendarClock,
  Copy,
  Edit3,
  Megaphone,
  Plus,
  RefreshCw,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { getAdminAdvancedCopy } from "../admin-advanced-copy";
import {
  getAnnouncementOperationalStatus,
  type AnnouncementOperationalStatus,
} from "../admin-console-model";

import { adminFetch, formatDate } from "./admin-client";
import { adminButtonClass } from "./admin-ui-utils";
import { AdminDialog } from "./AdminDialog";
import { useAdminToast } from "./use-admin-toast";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  level: "info" | "warning" | "critical";
  placement: "top_banner" | "popup_modal" | "community_top";
  targetRole: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

interface AnnouncementDraft {
  id?: string;
  title: string;
  content: string;
  level: AnnouncementItem["level"];
  placement: AnnouncementItem["placement"];
  targetRole: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

interface AdminAnnouncementsProps {
  userId: string;
}

const EMPTY_DRAFT: AnnouncementDraft = {
  title: "",
  content: "",
  level: "info",
  placement: "top_banner",
  targetRole: "all",
  isActive: true,
  startsAt: "",
  endsAt: "",
};

const LEVEL_TONE: Record<AnnouncementItem["level"], string> = {
  critical: "border-bad/35 bg-bad/10 text-bad",
  warning: "border-warn/35 bg-warn/10 text-warn",
  info: "border-accent/35 bg-accent/10 text-accent",
};

const STATUS_TONE: Record<AnnouncementOperationalStatus, string> = {
  active: "border-good/35 bg-good/10 text-good",
  scheduled: "border-accent/35 bg-accent/10 text-accent",
  expired: "border-line bg-panel text-fg-3",
  inactive: "border-line bg-panel text-fg-3",
};

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createDraft(item?: AnnouncementItem): AnnouncementDraft {
  if (!item) return { ...EMPTY_DRAFT };
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    level: item.level,
    placement: item.placement,
    targetRole: item.targetRole,
    isActive: item.isActive,
    startsAt: toDateTimeLocal(item.startsAt),
    endsAt: toDateTimeLocal(item.endsAt),
  };
}

export function AdminAnnouncements({ userId }: AdminAnnouncementsProps) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    AnnouncementOperationalStatus | "all"
  >("all");
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AnnouncementItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
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
        const response = await adminFetch<{ items: AnnouncementItem[] }>(
          "/announcements",
          userId,
        );
        setItems(response.items ?? []);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("admin.announcements.loadError"),
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

  const statusLabels: Record<AnnouncementOperationalStatus, string> = {
    active: copy.announcements.statusActive,
    scheduled: copy.announcements.statusScheduled,
    expired: copy.announcements.statusExpired,
    inactive: copy.announcements.statusInactive,
  };

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (statusFilter === "all") return true;
        return getAnnouncementOperationalStatus(item) === statusFilter;
      }),
    [items, statusFilter],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<AnnouncementOperationalStatus, number> = {
      active: 0,
      scheduled: 0,
      expired: 0,
      inactive: 0,
    };
    for (const item of items) {
      counts[getAnnouncementOperationalStatus(item)] += 1;
    }
    return counts;
  }, [items]);

  const openCreate = () => {
    setScheduleError(null);
    setDraft(createDraft());
  };

  const openEdit = (item: AnnouncementItem) => {
    setScheduleError(null);
    setDraft(createDraft(item));
  };

  const duplicate = (item: AnnouncementItem) => {
    setScheduleError(null);
    setDraft({
      ...createDraft(item),
      id: undefined,
      title: `${item.title} (copy)`,
      isActive: false,
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setDraft(null);
    setScheduleError(null);
  };

  const saveAnnouncement = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.title.trim()) return;

    const startsAt = toIsoDate(draft.startsAt);
    const endsAt = toIsoDate(draft.endsAt);
    if (
      startsAt &&
      endsAt &&
      new Date(endsAt).getTime() <= new Date(startsAt).getTime()
    ) {
      setScheduleError(copy.announcements.scheduleError);
      return;
    }

    setSaving(true);
    setScheduleError(null);
    try {
      await adminFetch("/announcements", userId, {
        method: "POST",
        body: JSON.stringify({
          id: draft.id,
          title: draft.title.trim(),
          content: draft.content.trim(),
          level: draft.level,
          placement: draft.placement,
          targetRole: draft.targetRole,
          isActive: draft.isActive,
          startsAt,
          endsAt,
        }),
      });
      setDraft(null);
      showToast(copy.announcements.saveSuccess);
      await loadData(true);
    } catch (requestError) {
      showToast(
        t("admin.announcements.title"),
        requestError instanceof Error ? requestError.message : "Error",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleAnnouncement = async (item: AnnouncementItem) => {
    try {
      const response = await adminFetch<{ isActive?: boolean }>(
        `/announcements/${encodeURIComponent(item.id)}/toggle`,
        userId,
        { method: "POST" },
      );
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                isActive: response.isActive ?? !entry.isActive,
              }
            : entry,
        ),
      );
      showToast(copy.announcements.toggleSuccess);
    } catch (requestError) {
      showToast(
        t("admin.announcements.title"),
        requestError instanceof Error ? requestError.message : "Error",
        "error",
      );
    }
  };

  const deleteAnnouncement = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await adminFetch(
        `/announcements/${encodeURIComponent(deleting.id)}`,
        userId,
        { method: "DELETE" },
      );
      setItems((current) =>
        current.filter((item) => item.id !== deleting.id),
      );
      setDeleting(null);
      showToast(copy.announcements.deleteSuccess);
    } catch (requestError) {
      showToast(
        copy.announcements.deleteConfirmTitle,
        requestError instanceof Error ? requestError.message : "Error",
        "error",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const statusFilters: Array<{
    value: AnnouncementOperationalStatus | "all";
    label: string;
    count: number;
  }> = [
    { value: "all", label: copy.announcements.statusAll, count: items.length },
    {
      value: "active",
      label: copy.announcements.statusActive,
      count: statusCounts.active,
    },
    {
      value: "scheduled",
      label: copy.announcements.statusScheduled,
      count: statusCounts.scheduled,
    },
    {
      value: "expired",
      label: copy.announcements.statusExpired,
      count: statusCounts.expired,
    },
    {
      value: "inactive",
      label: copy.announcements.statusInactive,
      count: statusCounts.inactive,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Megaphone className="size-5 text-indigo-400" />
              {t("admin.announcements.title")}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {t("admin.announcements.desc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
              {copy.common.refresh}
            </button>
            <button
              type="button"
              onClick={openCreate}
              className={adminButtonClass("accent")}
            >
              <Plus size={14} />
              {copy.announcements.create}
            </button>
          </div>
        </div>

        <div
          className="mt-5 flex gap-2 overflow-x-auto pb-1"
          aria-label={copy.announcements.filters}
        >
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors",
                statusFilter === filter.value
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line bg-panel/50 text-fg-3 hover:text-fg",
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
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-36 rounded-2xl" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400">
          {items.length === 0
            ? t("admin.announcements.empty")
            : copy.announcements.emptyFiltered}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredItems.map((item) => {
            const status = getAnnouncementOperationalStatus(item);
            return (
              <article
                key={item.id}
                className={cn(
                  "rounded-2xl border p-5 transition-all",
                  status === "active"
                    ? "border-slate-700/80 bg-slate-900/80 shadow-md"
                    : "border-slate-800/60 bg-slate-950/40",
                )}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider",
                          LEVEL_TONE[item.level],
                        )}
                      >
                        {item.level}
                      </span>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[0.65rem] font-semibold",
                          STATUS_TONE[status],
                        )}
                      >
                        {statusLabels[status]}
                      </span>
                      <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[0.65rem] text-slate-300">
                        {item.placement}
                      </span>
                      <span className="text-xs text-slate-500">
                        {copy.announcements.targetPrefix}: {item.targetRole}
                      </span>
                    </div>

                    <h3 className="pt-1 text-base font-bold text-white">
                      {item.title}
                    </h3>
                    {item.content ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                        {item.content}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[0.7rem] text-slate-500">
                      <span>
                        {copy.announcements.createdPrefix}: {formatDate(item.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock size={12} />
                        {item.startsAt
                          ? new Date(item.startsAt).toLocaleString()
                          : copy.announcements.noStart}
                        {" → "}
                        {item.endsAt
                          ? new Date(item.endsAt).toLocaleString()
                          : copy.announcements.noEnd}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className={adminButtonClass("ghost")}
                    >
                      <Edit3 size={13} />
                      {copy.announcements.editAction}
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicate(item)}
                      className={adminButtonClass("ghost")}
                    >
                      <Copy size={13} />
                      {copy.announcements.duplicateAction}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleAnnouncement(item)}
                      className={adminButtonClass("ghost")}
                      aria-label={copy.announcements.activeToggle}
                      aria-pressed={item.isActive}
                    >
                      {item.isActive ? (
                        <ToggleRight size={18} className="text-good" />
                      ) : (
                        <ToggleLeft size={18} className="text-fg-3" />
                      )}
                      {item.isActive
                        ? copy.announcements.statusActive
                        : copy.announcements.statusInactive}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(item)}
                      className={adminButtonClass("danger")}
                    >
                      <Trash2 size={13} />
                      {copy.common.delete}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminDialog
        open={draft != null}
        onClose={closeEditor}
        title={
          draft?.id
            ? copy.announcements.edit
            : copy.announcements.create
        }
        description={copy.announcements.activeDesc}
        size="xl"
        busy={saving}
        closeLabel={copy.common.close}
      >
        {draft ? (
          <form
            id="admin-announcement-form"
            onSubmit={(event) => void saveAnnouncement(event)}
            className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]"
          >
            <div className="space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-3">
                  {t("admin.announcements.inputTitle")}
                </span>
                <input
                  required
                  maxLength={160}
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                  className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-fg outline-none focus:border-accent/60"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-3">
                  {t("admin.announcements.inputContent")}
                </span>
                <textarea
                  rows={6}
                  maxLength={5_000}
                  value={draft.content}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, content: event.target.value }
                        : current,
                    )
                  }
                  className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-accent/60"
                />
                <span className="text-right text-[0.68rem] text-fg-3">
                  {draft.content.length}/5000
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg-3">
                    {t("admin.announcements.inputLevel")}
                  </span>
                  <select
                    value={draft.level}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              level: event.target
                                .value as AnnouncementItem["level"],
                            }
                          : current,
                      )
                    }
                    className="h-10 rounded-xl border border-line bg-canvas px-2 text-sm text-fg"
                  >
                    <option value="info">
                      {t("admin.announcements.levelInfo")}
                    </option>
                    <option value="warning">
                      {t("admin.announcements.levelWarning")}
                    </option>
                    <option value="critical">
                      {t("admin.announcements.levelCritical")}
                    </option>
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg-3">
                    {t("admin.announcements.inputPlacement")}
                  </span>
                  <select
                    value={draft.placement}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              placement: event.target
                                .value as AnnouncementItem["placement"],
                            }
                          : current,
                      )
                    }
                    className="h-10 rounded-xl border border-line bg-canvas px-2 text-sm text-fg"
                  >
                    <option value="top_banner">
                      {t("admin.announcements.placementBanner")}
                    </option>
                    <option value="popup_modal">
                      {t("admin.announcements.placementModal")}
                    </option>
                    <option value="community_top">
                      {t("admin.announcements.placementCommunity")}
                    </option>
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg-3">
                    {t("admin.announcements.inputTarget")}
                  </span>
                  <select
                    value={draft.targetRole}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, targetRole: event.target.value }
                          : current,
                      )
                    }
                    className="h-10 rounded-xl border border-line bg-canvas px-2 text-sm text-fg"
                  >
                    <option value="all">
                      {t("admin.announcements.targetAll")}
                    </option>
                    <option value="user">
                      {t("admin.announcements.targetUser")}
                    </option>
                    <option value="creator">
                      {t("admin.announcements.targetCreator")}
                    </option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>

              <fieldset className="rounded-xl border border-line bg-panel/40 p-4">
                <legend className="px-1 text-xs font-semibold text-fg-2">
                  {copy.announcements.schedule}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-fg-3">
                      {copy.announcements.startsAt}
                    </span>
                    <input
                      type="datetime-local"
                      value={draft.startsAt}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? { ...current, startsAt: event.target.value }
                            : current,
                        )
                      }
                      className="h-10 rounded-xl border border-line bg-canvas px-3 text-sm text-fg [color-scheme:dark]"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-fg-3">
                      {copy.announcements.endsAt}
                    </span>
                    <input
                      type="datetime-local"
                      value={draft.endsAt}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? { ...current, endsAt: event.target.value }
                            : current,
                        )
                      }
                      className="h-10 rounded-xl border border-line bg-canvas px-3 text-sm text-fg [color-scheme:dark]"
                    />
                  </label>
                </div>
                {scheduleError ? (
                  <p className="mt-2 text-xs text-bad" role="alert">
                    {scheduleError}
                  </p>
                ) : null}
              </fieldset>

              <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line bg-panel/40 p-3">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, isActive: event.target.checked }
                        : current,
                    )
                  }
                  className="mt-0.5 size-4 rounded border-line accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-fg">
                    {copy.announcements.activeToggle}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-3">
                    {copy.announcements.activeDesc}
                  </span>
                </span>
              </label>
            </div>

            <aside className="rounded-2xl border border-line bg-panel/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                {copy.announcements.preview}
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
                <div
                  className={cn(
                    "border-b px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wider",
                    LEVEL_TONE[draft.level],
                  )}
                >
                  {draft.level} · {draft.placement}
                </div>
                <div className="p-4">
                  <h3 className="text-base font-semibold text-fg">
                    {draft.title || t("admin.announcements.inputTitle")}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-3">
                    {draft.content || t("admin.announcements.inputContent")}
                  </p>
                  <p className="mt-4 text-[0.68rem] text-fg-3">
                    {copy.announcements.targetPrefix}: {draft.targetRole}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className={adminButtonClass("ghost")}
                  onClick={closeEditor}
                  disabled={saving}
                >
                  {copy.common.cancel}
                </button>
                <button
                  type="submit"
                  form="admin-announcement-form"
                  className={adminButtonClass("accent")}
                  disabled={saving || !draft.title.trim()}
                >
                  {saving ? copy.common.saving : copy.common.save}
                </button>
              </div>
            </aside>
          </form>
        ) : null}
      </AdminDialog>

      <AdminDialog
        open={deleting != null}
        onClose={() => {
          if (!deleteBusy) setDeleting(null);
        }}
        title={copy.announcements.deleteConfirmTitle}
        description={copy.announcements.deleteConfirmDesc}
        busy={deleteBusy}
        closeLabel={copy.common.close}
        footer={
          <>
            <button
              type="button"
              className={adminButtonClass("ghost")}
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              className={adminButtonClass("danger")}
              onClick={() => void deleteAnnouncement()}
              disabled={deleteBusy}
            >
              {deleteBusy ? copy.common.saving : copy.common.delete}
            </button>
          </>
        }
      >
        <p className="rounded-xl border border-line bg-panel/50 p-4 text-sm text-fg-2">
          {deleting?.title}
        </p>
      </AdminDialog>
    </div>
  );
}
