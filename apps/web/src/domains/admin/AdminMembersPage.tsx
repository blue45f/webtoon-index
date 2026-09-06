import {
  ArrowLeft,
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";


import { getAdminAdvancedCopy } from "./admin-advanced-copy";
import { loadAdminI18nLocale } from "./admin-i18n-loader";
import {
  buildMemberCsv,
  buildMemberQuery,
  getPageCount,
  interpolateCount,
  toggleMemberSelection,
  toggleVisibleMemberSelection,
  type MemberRole,
  type MemberSort,
  type MemberStatus,
} from "./admin-members-model";
import { AdminRequestScope, canManageAdminMembers } from "./admin-request-scope";
import {
  adminFetch,
  downloadAdminFile,
  formatNum,
  formatWon,
} from "./components/admin-client";
import { AdminGateFallback } from "./components/admin-gate";
import { useAdminGate } from "./components/admin-gate-state";
import { adminButtonClass } from "./components/admin-ui-utils";
import { AdminDialog } from "./components/AdminDialog";
import { AdminToastProvider } from "./components/AdminToast";
import { useAdminToast } from "./components/use-admin-toast";

import { Container } from "@/shared/components/section";
import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";

interface MemberRow {
  id: string;
  name: string | null;
  email: string | null;
  role: MemberRole;
  status: MemberStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deletedAt: string | null;
  createdAt: string | null;
  postCount: number;
  reviewCount: number;
}

interface MemberListResponse {
  items: MemberRow[];
  meta: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    generatedAt: string;
  };
}

interface MemberDetails {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: MemberRole;
    status: MemberStatus;
    suspendedAt: string | null;
    suspensionReason: string | null;
    deletedAt: string | null;
    createdAt: string | null;
    bio: string | null;
  };
  activity: {
    reviewsCount: number;
    fanPostsCount: number;
    ratingsCount: number;
    totalPaidCents: number;
  };
}

type PendingAction =
  | { kind: "role"; member: MemberRow; role: MemberRole }
  | {
      kind: "status";
      member: MemberRow;
      status: "active" | "suspended";
    }
  | { kind: "delete"; member: MemberRow }
  | {
      kind: "bulk";
      memberIds: string[];
      status: "active" | "suspended";
    };

const ROLE_TONE: Record<MemberRole, string> = {
  admin: "bg-accent/15 text-accent",
  operator: "bg-good/15 text-good",
  creator: "bg-warn/15 text-warn",
  user: "bg-raised/70 text-fg-3",
};

const STATUS_TONE: Record<MemberStatus, string> = {
  active: "bg-good/15 text-good",
  suspended: "bg-warn/15 text-warn",
  deleted: "bg-bad/15 text-bad",
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

export function AdminMembersPage() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  useDocumentTitle(t("admin.members.title"));
  const { gate, uid } = useAdminGate();

  useEffect(() => {
    void loadAdminI18nLocale(lang);
  }, [lang]);

  return (
    <AdminToastProvider>
      <Container size="wide" className="py-10">
        <header className="mb-8">
          <p className="eyebrow flex items-center gap-1.5 text-accent">
            <UsersRound size={13} /> {t("admin.members.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {t("admin.members.title")}
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-3">
            {t("admin.members.desc")}
          </p>
          <Link
            href="/admin"
            className="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-medium text-accent"
          >
            <ArrowLeft size={13} />
            {t("admin.members.backToConsole")}
          </Link>
        </header>

        <AdminGateFallback gate={gate} />
        {gate.kind === "admin" && uid ? (
          <MemberBoard
            key={`${uid}:${gate.me.role}`}
            uid={uid}
            selfId={gate.me.id}
            canManageMembers={canManageAdminMembers(gate.me.role)}
          />
        ) : null}
      </Container>
    </AdminToastProvider>
  );
}

function MemberBoard({ uid, selfId, canManageMembers }: {
  uid: string;
  selfId: string;
  canManageMembers: boolean;
}) {
  const [listRequests] = useState(() => new AdminRequestScope());
  const [detailRequests] = useState(() => new AdminRequestScope());
  const [refreshRevision, setRefreshRevision] = useState(0);
  const actionLock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listRequests.cancel();
      detailRequests.cancel();
    };
  }, [listRequests, detailRequests]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [meta, setMeta] = useState<MemberListResponse["meta"]>({
    limit: 25,
    offset: 0,
    total: 0,
    hasMore: false,
    generatedAt: "",
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRole | "all">("all");
  const [statusFilter, setStatusFilter] =
    useState<MemberStatus | "all">("all");
  const [sort, setSort] = useState<MemberSort>("created_desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] =
    useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [detailMember, setDetailMember] = useState<MemberRow | null>(null);
  const [detail, setDetail] = useState<MemberDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const copy = getAdminAdvancedCopy(lang);
  const { showToast } = useAdminToast();

  const roles: Array<{ value: MemberRole; label: string }> = [
    { value: "user", label: t("admin.members.roleUser") },
    { value: "creator", label: t("admin.members.roleCreator") },
    { value: "operator", label: t("admin.members.roleOperator") },
    { value: "admin", label: t("admin.members.roleAdmin") },
  ];

  const statusLabels: Record<MemberStatus, string> = {
    active: t("admin.members.statusActive"),
    suspended: t("admin.members.statusSuspended"),
    deleted: t("admin.members.statusDeleted"),
  };

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setQueryText(searchText.trim());
      setPage(1);
    }, 250);
    return () => globalThis.clearTimeout(timer);
  }, [searchText]);

  const filters = useMemo(
    () => ({
      q: queryText,
      role: roleFilter,
      status: statusFilter,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [page, pageSize, queryText, roleFilter, sort, statusFilter],
  );

  const loadMembers = useCallback(
    async (background = false) => {
      const request = listRequests.begin();
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const query = buildMemberQuery(filters);
        const response = await adminFetch<MemberListResponse>(
          `/users?${query}`,
          uid,
          { signal: request.signal },
        );
        if (!request.isCurrent()) return;
        const totalPages = getPageCount(response.meta.total, pageSize);
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        const items = response.items ?? [];
        setMembers(items);
        setMeta(response.meta);
        const visibleIds = new Set(items.filter(
          (member) => canManageMembers && member.id !== selfId && member.status !== "deleted",
        ).map((member) => member.id));
        setSelectedIds((current) => new Set(
          [...current].filter((id) => canManageMembers && visibleIds.has(id)),
        ));
      } catch (requestError) {
        if (!request.isCurrent()) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("admin.members.empty"),
        );
      } finally {
        if (request.isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [canManageMembers, filters, listRequests, page, pageSize, selfId, t, uid],
  );

  useEffect(() => {
    void loadMembers(false);
    return () => listRequests.cancel();
  }, [listRequests, loadMembers, refreshRevision]);

  // Selection belongs to the visible query, never to a hidden previous page.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters, canManageMembers]);

  const selectableIds = useMemo(
    () =>
      members
        .filter(
          (member) => canManageMembers && member.id !== selfId && member.status !== "deleted",
        )
        .map((member) => member.id),
    [canManageMembers, members, selfId],
  );
  const allVisibleSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const pageCount = getPageCount(meta.total, pageSize);

  const resetFilters = () => {
    setSearchText("");
    setQueryText("");
    setRoleFilter("all");
    setStatusFilter("all");
    setSort("created_desc");
    setPage(1);
    setSelectedIds(new Set());
  };

  const openAction = (action: PendingAction) => {
    if (!canManageMembers || actionLock.current || loading || refreshing) return;
    if (action.kind !== "bulk" && (
      action.member.id === selfId || action.member.status === "deleted"
    )) return;
    if (action.kind === "bulk" && (
      action.memberIds.length === 0 || action.memberIds.length > 200 ||
      action.memberIds.some((id) => !selectableIds.includes(id))
    )) return;
    setActionReason(
      action.kind === "status" && action.status === "suspended"
        ? action.member.suspensionReason ?? ""
        : "",
    );
    setPendingAction(action);
  };

  const closeAction = () => {
    if (actionLock.current) return;
    setPendingAction(null);
    setActionReason("");
  };

  const performAction = async () => {
    if (!pendingAction || !canManageMembers || actionLock.current) return;
    // State updates are batched. The ref closes the same-render double-click gap.
    actionLock.current = true;
    setActionBusy(true);
    try {
      if (pendingAction.kind === "role") {
        await adminFetch(
          `/users/${encodeURIComponent(pendingAction.member.id)}/role`,
          uid,
          {
            method: "POST",
            body: JSON.stringify({ role: pendingAction.role }),
          },
        );
        if (!mounted.current) return;
        showToast(copy.members.updateSuccess);
      } else if (pendingAction.kind === "status") {
        await adminFetch(
          `/users/${encodeURIComponent(pendingAction.member.id)}/status`,
          uid,
          {
            method: "POST",
            body: JSON.stringify({
              status: pendingAction.status,
              reason: actionReason,
            }),
          },
        );
        if (!mounted.current) return;
        showToast(copy.members.updateSuccess);
      } else if (pendingAction.kind === "delete") {
        await adminFetch(
          `/users/${encodeURIComponent(pendingAction.member.id)}`,
          uid,
          {
            method: "DELETE",
            body: JSON.stringify({ reason: actionReason }),
          },
        );
        if (!mounted.current) return;
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(pendingAction.member.id);
          return next;
        });
        showToast(copy.members.updateSuccess);
      } else {
        const response = await adminFetch<{ count: number }>(
          "/users/bulk-status",
          uid,
          {
            method: "POST",
            body: JSON.stringify({
              userIds: pendingAction.memberIds,
              status: pendingAction.status,
              reason: actionReason,
            }),
          },
        );
        if (!mounted.current) return;
        setSelectedIds(new Set());
        showToast(
          interpolateCount(copy.members.bulkSuccess, response.count),
        );
      }

      if (!mounted.current) return;
      setPendingAction(null);
      setActionReason("");
      // Use the current render's filters, not the mutation's stale closure.
      setRefreshRevision((value) => value + 1);
    } catch (requestError) {
      if (!mounted.current) return;
      showToast(
        t("admin.members.title"),
        requestError instanceof Error
          ? requestError.message
          : copy.members.destructiveWarning,
        "error",
      );
    } finally {
      actionLock.current = false;
      if (mounted.current) setActionBusy(false);
    }
  };

  const closeDetails = () => {
    detailRequests.cancel();
    setDetailMember(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const openDetails = async (member: MemberRow) => {
    const request = detailRequests.begin();
    setDetailMember(member);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await adminFetch<MemberDetails>(
        `/users/${encodeURIComponent(member.id)}/details`,
        uid,
        { signal: request.signal },
      );
      if (request.isCurrent()) setDetail(response);
    } catch (requestError) {
      if (!request.isCurrent()) return;
      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : copy.members.emptyDetail,
      );
    } finally {
      if (request.isCurrent()) setDetailLoading(false);
    }
  };

  const exportCsv = () => {
    if (loading || refreshing || error) return;
    try {
      const csv = buildMemberCsv(members);
      downloadAdminFile(
        `members-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
      showToast(copy.members.exportSuccess);
    } catch (requestError) {
      showToast(
        copy.members.exportError,
        requestError instanceof Error ? requestError.message : undefined,
        "error",
      );
    }
  };

  const actionTitle = (() => {
    if (!pendingAction) return "";
    if (pendingAction.kind === "role") return copy.members.roleChangeTitle;
    if (pendingAction.kind === "delete") return copy.members.deleteTitle;
    if (pendingAction.kind === "bulk") {
      return pendingAction.status === "suspended"
        ? copy.members.bulkSuspendTitle
        : copy.members.bulkRestoreTitle;
    }
    return pendingAction.status === "suspended"
      ? copy.members.suspendTitle
      : copy.members.restoreTitle;
  })();

  const actionSubject = (() => {
    if (!pendingAction) return "";
    if (pendingAction.kind === "bulk") {
      return interpolateCount(
        copy.members.selectedCount,
        pendingAction.memberIds.length,
      );
    }
    return (
      pendingAction.member.name ??
      pendingAction.member.email ??
      pendingAction.member.id
    );
  })();

  return (
    <div className="flex flex-col gap-4" aria-busy={loading || refreshing}>
      {!canManageMembers ? (
        <p role="status" className="rounded-xl border border-line bg-card/70 p-3 text-sm text-fg-2">
          {lang === "ko"
            ? "읽기 전용: 회원 조회와 내보내기는 가능하며, 역할·상태·삭제 변경은 관리자만 할 수 있어요."
            : "Read only: you can view and export members. Only administrators can change roles, account status, or delete members."}
        </p>
      ) : null}
      <section className="rounded-2xl border border-line bg-card/70 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-2">
              <Filter size={13} />
              {copy.members.filtersTitle}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="relative">
                <span className="sr-only">
                  {t("admin.members.searchPlaceholder")}
                </span>
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  maxLength={80}
                  placeholder={t("admin.members.searchPlaceholder")}
                  className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm outline-none focus:border-accent/60"
                />
              </label>

              <label>
                <span className="sr-only">{t("admin.members.colRole")}</span>
                <select
                  value={roleFilter}
                  onChange={(event) => {
                    setRoleFilter(
                      event.target.value as MemberRole | "all",
                    );
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent/60"
                >
                  <option value="all">{copy.members.roleAll}</option>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="sr-only">{t("admin.members.colStatus")}</span>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(
                      event.target.value as MemberStatus | "all",
                    );
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent/60"
                >
                  <option value="all">{copy.members.statusAll}</option>
                  {(Object.keys(statusLabels) as MemberStatus[]).map(
                    (status) => (
                      <option key={status} value={status}>
                        {statusLabels[status]}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                <span className="sr-only">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as MemberSort);
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none focus:border-accent/60"
                >
                  <option value="created_desc">
                    {copy.members.sortNewest}
                  </option>
                  <option value="created_asc">
                    {copy.members.sortOldest}
                  </option>
                  <option value="name_asc">
                    {copy.members.sortNameAsc}
                  </option>
                  <option value="name_desc">
                    {copy.members.sortNameDesc}
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className={adminButtonClass("ghost")}
            >
              <RotateCcw size={14} />
              {copy.members.resetFilters}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || refreshing || !!error || members.length === 0}
              className={adminButtonClass("ghost")}
            >
              <Download size={14} />
              {copy.members.exportFiltered}
            </button>
            <button
              type="button"
              onClick={() => void loadMembers(true)}
              disabled={refreshing}
              className={adminButtonClass("ghost")}
            >
              <RefreshCw
                size={14}
                className={cn(refreshing && "animate-spin")}
              />
              {t("admin.members.refresh")}
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card/50 px-3 py-2 sm:flex-row sm:items-center">
        <label className="inline-flex min-h-10 items-center gap-2 text-xs text-fg-2">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={() =>
              setSelectedIds((current) =>
                toggleVisibleMemberSelection(current, selectableIds),
              )
            }
            disabled={!canManageMembers || actionBusy || loading || refreshing || selectableIds.length === 0}
            className="size-4 rounded border-line accent-accent"
          />
          {copy.members.selectPage}
        </label>

        <span className="text-xs text-fg-3">
          {interpolateCount(copy.members.totalCount, meta.total)}
          {selectedIds.size > 0
            ? ` · ${interpolateCount(
                copy.members.selectedCount,
                selectedIds.size,
              )}`
            : ""}
        </span>

        {canManageMembers && selectedIds.size > 0 ? (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              className={adminButtonClass("ghost")}
              disabled={actionBusy || loading || refreshing}
              onClick={() =>
                openAction({
                  kind: "bulk",
                  memberIds: [...selectedIds],
                  status: "active",
                })
              }
            >
              <RotateCcw size={13} />
              {copy.members.bulkRestore}
            </button>
            <button
              type="button"
              className={adminButtonClass("danger")}
              disabled={actionBusy || loading || refreshing}
              onClick={() =>
                openAction({
                  kind: "bulk",
                  memberIds: [...selectedIds],
                  status: "suspended",
                })
              }
            >
              <Ban size={13} />
              {copy.members.bulkSuspend}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2.5" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center text-sm text-fg-3">
          {t("admin.members.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card/60">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <caption className="sr-only">{t("admin.members.title")}</caption>
            <thead>
              <tr className="border-b border-line text-[0.7rem] uppercase tracking-wide text-fg-3">
                <th scope="col" className="w-12 px-4 py-3 font-medium">
                  <span className="sr-only">{copy.members.selectPage}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colMember")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colStatus")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colRole")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colActivity")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colJoined")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("admin.members.colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.id === selfId;
                const selectable = canManageMembers && !actionBusy && !refreshing && !isSelf && member.status !== "deleted";
                return (
                  <tr
                    key={member.id}
                    className={cn(
                      "border-b border-line/60 last:border-b-0",
                      selectedIds.has(member.id) && "bg-accent/5",
                    )}
                  >
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(member.id)}
                        onChange={() =>
                          setSelectedIds((current) =>
                            toggleMemberSelection(current, member.id),
                          )
                        }
                        disabled={!selectable}
                        aria-label={member.name ?? member.email ?? member.id}
                        className="mt-1 size-4 rounded border-line accent-accent"
                      />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-fg">
                        {member.name ?? "—"}
                        {isSelf ? (
                          <span className="ml-1.5 text-[0.65rem] text-fg-3">
                            {t("admin.members.selfTag")}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 max-w-xs truncate text-[0.7rem] text-fg-3">
                        {member.email ?? member.id}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[0.68rem] font-medium",
                          STATUS_TONE[member.status],
                        )}
                      >
                        {statusLabels[member.status]}
                      </span>
                      {member.suspensionReason &&
                      member.status === "suspended" ? (
                        <p
                          className="mt-1 max-w-[12rem] truncate text-[0.65rem] text-fg-3"
                          title={member.suspensionReason}
                        >
                          {member.suspensionReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[0.68rem] font-medium",
                          ROLE_TONE[member.role],
                        )}
                      >
                        {roles.find((item) => item.value === member.role)
                          ?.label ?? member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-fg-2">
                      {formatNum(member.postCount)} / {" "}
                      {formatNum(member.reviewCount)}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-fg-3">
                      {formatDate(member.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openDetails(member)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 text-[0.68rem] text-fg-2 transition-colors hover:border-accent/45 hover:text-accent"
                        >
                          <Eye size={11} />
                          {copy.members.details}
                        </button>

                        <label className="sr-only" htmlFor={`role-${member.id}`}>
                          {t("admin.members.colRole")}
                        </label>
                        <select
                          id={`role-${member.id}`}
                          value={member.role}
                          disabled={!canManageMembers || actionBusy || refreshing || isSelf || member.status === "deleted"}
                          onChange={(event) =>
                            openAction({
                              kind: "role",
                              member,
                              role: event.target.value as MemberRole,
                            })
                          }
                          className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.68rem] text-fg outline-none focus:border-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {roles.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>

                        {member.status === "suspended" ? (
                          <button
                            type="button"
                            onClick={() =>
                              openAction({
                                kind: "status",
                                member,
                                status: "active",
                              })
                            }
                            disabled={!canManageMembers || actionBusy || refreshing || isSelf}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 text-[0.68rem] text-fg-2 transition-colors hover:border-good/45 hover:text-good disabled:opacity-45"
                          >
                            <RotateCcw size={11} />
                            {t("admin.members.restore")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              openAction({
                                kind: "status",
                                member,
                                status: "suspended",
                              })
                            }
                            disabled={!canManageMembers || actionBusy || refreshing || isSelf || member.status === "deleted"}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 text-[0.68rem] text-fg-2 transition-colors hover:border-warn/45 hover:text-warn disabled:opacity-45"
                          >
                            <Ban size={11} />
                            {t("admin.members.suspend")}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openAction({ kind: "delete", member })}
                          disabled={!canManageMembers || actionBusy || refreshing || isSelf || member.status === "deleted"}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-bad/30 px-2 text-[0.68rem] text-bad transition-colors hover:bg-bad/10 disabled:opacity-45"
                        >
                          <Trash2 size={11} />
                          {t("admin.members.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-card/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-2 text-xs text-fg-3">
          {copy.members.pageSize}
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="h-9 rounded-lg border border-line bg-canvas px-2 text-xs text-fg"
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="min-w-24 text-center text-xs text-fg-3">
            {copy.members.pageOf
              .replace("{page}", formatNum(page))
              .replace("{pages}", formatNum(pageCount))}
          </span>
          <button
            type="button"
            className={adminButtonClass("ghost")}
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft size={14} />
            {copy.common.previous}
          </button>
          <button
            type="button"
            className={adminButtonClass("ghost")}
            disabled={page >= pageCount || loading}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            {copy.common.next}
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <AdminDialog
        open={pendingAction != null}
        onClose={closeAction}
        title={actionTitle}
        description={`${actionSubject} · ${copy.members.destructiveWarning}`}
        busy={actionBusy}
        closeLabel={copy.common.close}
        footer={
          <>
            <button
              type="button"
              className={adminButtonClass("ghost")}
              onClick={closeAction}
              disabled={actionBusy}
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              className={adminButtonClass(
                pendingAction?.kind === "delete" ||
                  (pendingAction?.kind !== "role" &&
                    pendingAction?.status === "suspended")
                  ? "danger"
                  : "accent",
              )}
              onClick={() => void performAction()}
              disabled={!canManageMembers || actionBusy}
            >
              {actionBusy ? copy.common.saving : copy.common.confirm}
            </button>
          </>
        }
      >
        {pendingAction?.kind === "role" ? (
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-sm text-fg-2">
            {roles.find((role) => role.value === pendingAction.member.role)
              ?.label ?? pendingAction.member.role}
            {" → "}
            <strong className="text-fg">
              {roles.find((role) => role.value === pendingAction.role)
                ?.label ?? pendingAction.role}
            </strong>
          </div>
        ) : (
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium text-fg-2">
              {copy.members.actionReason}
            </span>
            <textarea
              value={actionReason}
              disabled={actionBusy}
              onChange={(event) => setActionReason(event.target.value)}
              maxLength={300}
              rows={4}
              placeholder={copy.members.actionReasonOptional}
              className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent/60"
            />
            <span className="text-right text-[0.68rem] text-fg-3">
              {actionReason.length}/300
            </span>
          </label>
        )}
      </AdminDialog>

      <AdminDialog
        open={detailMember != null}
        onClose={closeDetails}
        title={copy.members.detailsTitle}
        description={
          detailMember
            ? detailMember.name ?? detailMember.email ?? detailMember.id
            : undefined
        }
        size="lg"
        closeLabel={copy.common.close}
        footer={
          <button
            type="button"
            className={adminButtonClass("ghost")}
            onClick={closeDetails}
          >
            {copy.common.close}
          </button>
        }
      >
        {detailLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-24 rounded-xl" />
          </div>
        ) : detailError || !detail ? (
          <p className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
            {detailError ?? copy.members.emptyDetail}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-xl border border-line bg-panel/50 p-4 md:col-span-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                {copy.members.accountSection}
              </h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-fg-3">ID</dt>
                  <dd className="mt-1 break-all text-fg">{detail.user.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">
                    {t("admin.members.colRole")}
                  </dt>
                  <dd className="mt-1 text-fg">{detail.user.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">Email</dt>
                  <dd className="mt-1 break-all text-fg">
                    {detail.user.email ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">
                    {t("admin.members.colStatus")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {statusLabels[detail.user.status]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">
                    {t("admin.members.colJoined")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {formatDate(detail.user.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">Bio</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-fg">
                    {detail.user.bio ?? "—"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-line bg-panel/50 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                {copy.members.activitySection}
              </h3>
              <dl className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-fg-3">{copy.members.posts}</dt>
                  <dd className="numeral text-lg text-fg">
                    {formatNum(detail.activity.fanPostsCount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-fg-3">{copy.members.reviews}</dt>
                  <dd className="numeral text-lg text-fg">
                    {formatNum(detail.activity.reviewsCount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs text-fg-3">{copy.members.ratings}</dt>
                  <dd className="numeral text-lg text-fg">
                    {formatNum(detail.activity.ratingsCount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <dt className="text-xs text-fg-3">{copy.members.paid}</dt>
                  <dd className="numeral text-lg text-fg">
                    {formatWon(detail.activity.totalPaidCents)}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </AdminDialog>
    </div>
  );
}
