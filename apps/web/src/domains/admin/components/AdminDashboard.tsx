import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Coins,
  Flag,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Users,
  MessagesSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getAdminAdvancedCopy } from "../admin-advanced-copy";
import {
  countActiveCriticalAnnouncements,
  type AdminTabKey,
} from "../admin-console-model";

import {
  adminFetch,
  formatNum,
  formatWon,
} from "./admin-client";
import { AdminNotice, AdminSpinner, Stat, StatGroup } from "./admin-ui";
import { adminButtonClass } from "./admin-ui-utils";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

interface Dashboard {
  updatedAt: string;
  users: {
    total: number;
    activeLast7d: number;
    activeLast30d: number;
    admins: number;
    creators: number;
  };
  community: {
    fanPosts: number;
    fanReplies: number;
    reviewReplies: number;
    reviews: number;
    userActivity: number;
  };
  monetization: {
    planCount: number;
    activePlanCount: number;
    campaignCount: number;
    revenuePendingCents: number;
    revenuePaidCents: number;
    pendingEvents: number;
    periodDays: number;
  };
}

interface ReportItem {
  id: string;
}

interface AnnouncementItem {
  id: string;
  level: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

interface SystemHealth {
  status: string;
  database?: { status?: string; latencyMs?: number };
  maintenance?: { enabled?: boolean; message?: string | null };
}

interface DashboardSnapshot {
  dashboard: Dashboard;
  reports: ReportItem[];
  announcements: AnnouncementItem[];
  health: SystemHealth | null;
  missingSources: string[];
  receivedAt: string;
}

const PERIOD_OPTIONS = [7, 30, 90, 365] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

interface AdminDashboardProps {
  uid: string;
  onNavigate?: (tab: AdminTabKey) => void;
}

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  value: string;
  tone: "warn" | "bad" | "good" | "accent";
  actionLabel: string;
  onClick?: () => void;
}

const TONE_CLASS: Record<ActionCardProps["tone"], string> = {
  warn: "border-warn/35 bg-warn/5 text-warn",
  bad: "border-bad/35 bg-bad/5 text-bad",
  good: "border-good/35 bg-good/5 text-good",
  accent: "border-accent/35 bg-accent/5 text-accent",
};

function ActionCard({
  icon,
  title,
  description,
  value,
  tone,
  actionLabel,
  onClick,
}: ActionCardProps) {
  return (
    <article className="flex min-h-44 flex-col rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <span
          className={cn(
            "inline-flex size-10 items-center justify-center rounded-xl border",
            TONE_CLASS[tone],
          )}
        >
          {icon}
        </span>
        <span className="numeral text-2xl font-semibold text-fg">{value}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-fg-3">
        {description}
      </p>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-4 inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg px-1 text-xs font-semibold text-accent transition-colors hover:text-fg"
        >
          {actionLabel} <ArrowRight size={13} />
        </button>
      ) : null}
    </article>
  );
}

export function AdminDashboard({
  uid,
  onNavigate,
}: AdminDashboardProps) {
  const [days, setDays] = useState<PeriodDays>(30);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const copy = getAdminAdvancedCopy(lang);

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const [dashboardResult, reportsResult, announcementsResult, healthResult] =
        await Promise.allSettled([
          adminFetch<Dashboard>(`/dashboard?days=${days}`, uid),
          adminFetch<{ items: ReportItem[] }>(
            "/reports?status=pending&limit=200",
            uid,
          ),
          adminFetch<{ items: AnnouncementItem[] }>("/announcements", uid),
          adminFetch<SystemHealth>("/system/health", uid),
        ]);

      if (dashboardResult.status === "rejected") {
        const message =
          dashboardResult.reason instanceof Error
            ? dashboardResult.reason.message
            : t("admin.dashboard.loadError");
        setError(message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const missingSources: string[] = [];
      if (reportsResult.status === "rejected") missingSources.push("reports");
      if (announcementsResult.status === "rejected") {
        missingSources.push("announcements");
      }
      if (healthResult.status === "rejected") missingSources.push("health");

      setSnapshot((current) => ({
        dashboard: dashboardResult.value,
        reports:
          reportsResult.status === "fulfilled"
            ? reportsResult.value.items ?? []
            : current?.reports ?? [],
        announcements:
          announcementsResult.status === "fulfilled"
            ? announcementsResult.value.items ?? []
            : current?.announcements ?? [],
        health:
          healthResult.status === "fulfilled"
            ? healthResult.value
            : current?.health ?? null,
        missingSources,
        receivedAt: new Date().toISOString(),
      }));
      setLoading(false);
      setRefreshing(false);
    },
    [days, t, uid],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = globalThis.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      globalThis.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const criticalAnnouncementCount = useMemo(
    () =>
      countActiveCriticalAnnouncements(snapshot?.announcements ?? []),
    [snapshot?.announcements],
  );

  if (loading && !snapshot) return <AdminSpinner />;

  if (!snapshot) {
    return (
      <div className="space-y-3">
        <AdminNotice
          title={t("admin.dashboard.loadError")}
          body={error ?? t("admin.dashboard.loadError")}
        />
        <button
          type="button"
          className={adminButtonClass("accent")}
          onClick={() => void load(false)}
        >
          <RefreshCw size={14} /> {copy.common.refresh}
        </button>
      </div>
    );
  }

  const data = snapshot.dashboard;
  const maintenanceEnabled = Boolean(snapshot.health?.maintenance?.enabled);
  const degraded =
    snapshot.health != null && snapshot.health.status !== "healthy";
  const hasUrgentItems =
    snapshot.reports.length > 0 ||
    data.monetization.pendingEvents > 0 ||
    criticalAnnouncementCount > 0 ||
    maintenanceEnabled ||
    degraded;

  const periodText = t("admin.dashboard.period")
    .replace("{days}", String(data.monetization.periodDays))
    .replace("{date}", new Date(data.updatedAt).toLocaleString());

  return (
    <div className="flex flex-col gap-8">
      <section className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-fg">
              {copy.dashboard.actionCenterTitle}
            </h2>
            <p className="mt-1 text-sm text-fg-3">
              {copy.dashboard.actionCenterDesc}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-fg-3">
              <span>{copy.dashboard.periodLabel}</span>
              <select
                value={days}
                onChange={(event) =>
                  setDays(Number(event.target.value) as PeriodDays)
                }
                className="h-10 rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none focus:border-accent/60"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}d
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={adminButtonClass("ghost")}
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : undefined}
              />
              {refreshing
                ? copy.dashboard.refreshing
                : copy.common.refresh}
            </button>
          </div>
        </div>

        {snapshot.missingSources.length > 0 ? (
          <div
            className="flex items-start gap-2 border-b border-warn/25 bg-warn/5 px-5 py-3 text-xs text-warn"
            role="status"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {copy.dashboard.partialWarning} ({snapshot.missingSources.join(", ")})
            </span>
          </div>
        ) : null}

        {error ? (
          <div
            className="flex items-start gap-2 border-b border-bad/25 bg-bad/5 px-5 py-3 text-xs text-bad"
            role="alert"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <ActionCard
            icon={<Flag size={18} />}
            title={copy.dashboard.pendingReports}
            description={copy.dashboard.pendingReportsDesc}
            value={formatNum(snapshot.reports.length)}
            tone={snapshot.reports.length > 0 ? "warn" : "good"}
            actionLabel={copy.dashboard.open}
            onClick={onNavigate ? () => onNavigate("reports") : undefined}
          />
          <ActionCard
            icon={<Coins size={18} />}
            title={copy.dashboard.pendingSettlements}
            description={`${copy.dashboard.pendingSettlementsDesc} ${formatWon(
              data.monetization.revenuePendingCents,
            )}`}
            value={formatNum(data.monetization.pendingEvents)}
            tone={data.monetization.pendingEvents > 0 ? "warn" : "good"}
            actionLabel={copy.dashboard.open}
            onClick={onNavigate ? () => onNavigate("revenue") : undefined}
          />
          <ActionCard
            icon={<Megaphone size={18} />}
            title={copy.dashboard.criticalAnnouncements}
            description={copy.dashboard.criticalAnnouncementsDesc}
            value={formatNum(criticalAnnouncementCount)}
            tone={criticalAnnouncementCount > 0 ? "bad" : "good"}
            actionLabel={copy.dashboard.open}
            onClick={
              onNavigate ? () => onNavigate("announcements") : undefined
            }
          />
          <ActionCard
            icon={
              degraded || maintenanceEnabled ? (
                <AlertTriangle size={18} />
              ) : (
                <ShieldCheck size={18} />
              )
            }
            title={copy.dashboard.systemStatus}
            description={
              maintenanceEnabled
                ? copy.dashboard.maintenance
                : degraded
                  ? copy.dashboard.degraded
                  : copy.dashboard.healthy
            }
            value={
              maintenanceEnabled ? "MAINT" : degraded ? "WARN" : "OK"
            }
            tone={maintenanceEnabled || degraded ? "bad" : "good"}
            actionLabel={copy.dashboard.open}
            onClick={onNavigate ? () => onNavigate("ops") : undefined}
          />
        </div>

        {!hasUrgentItems ? (
          <div className="flex items-center gap-2 border-t border-good/20 bg-good/5 px-5 py-3 text-xs text-good">
            <Activity size={14} />
            {copy.dashboard.allClear}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-1 text-xs text-fg-3 sm:flex-row sm:items-center sm:justify-between">
        <p>{periodText}</p>
        <p>
          {copy.dashboard.lastUpdated}: {" "}
          {new Date(snapshot.receivedAt).toLocaleString()}
        </p>
      </div>

      <StatGroup icon={<Users size={15} />} label={t("admin.dashboard.groupUsers")}>
        <Stat
          label={t("admin.dashboard.userTotal")}
          value={formatNum(data.users.total)}
        />
        <Stat
          label={t("admin.dashboard.userActive7d")}
          value={formatNum(data.users.activeLast7d)}
        />
        <Stat
          label={t("admin.dashboard.userActive30d")}
          value={formatNum(data.users.activeLast30d)}
        />
        <Stat
          label={t("admin.dashboard.userAdmins")}
          value={formatNum(data.users.admins)}
        />
        <Stat
          label={t("admin.dashboard.userCreators")}
          value={formatNum(data.users.creators)}
        />
      </StatGroup>

      <StatGroup
        icon={<MessagesSquare size={15} />}
        label={t("admin.dashboard.groupCommunity")}
      >
        <Stat
          label={t("admin.dashboard.communityPosts")}
          value={formatNum(data.community.fanPosts)}
        />
        <Stat
          label={t("admin.dashboard.communityReplies")}
          value={formatNum(data.community.fanReplies)}
        />
        <Stat
          label={t("admin.dashboard.communityReviews")}
          value={formatNum(data.community.reviews)}
        />
        <Stat
          label={t("admin.dashboard.communityReviewReplies")}
          value={formatNum(data.community.reviewReplies)}
        />
        <Stat
          label={t("admin.dashboard.communityActiveUsers")}
          value={formatNum(data.community.userActivity)}
        />
      </StatGroup>

      <StatGroup
        icon={<Coins size={15} />}
        label={t("admin.dashboard.groupMonetization")}
      >
        <Stat
          label={t("admin.dashboard.planRatio")}
          value={`${formatNum(data.monetization.activePlanCount)}/${formatNum(
            data.monetization.planCount,
          )}`}
        />
        <Stat
          label={t("admin.dashboard.campaigns")}
          value={formatNum(data.monetization.campaignCount)}
        />
        <Stat
          label={t("admin.dashboard.pendingSettlements")}
          value={formatNum(data.monetization.pendingEvents)}
        />
        <Stat
          label={t("admin.dashboard.paidAmount")}
          value={formatWon(data.monetization.revenuePaidCents)}
        />
        <Stat
          label={t("admin.dashboard.pendingAmount")}
          value={formatWon(data.monetization.revenuePendingCents)}
        />
      </StatGroup>
    </div>
  );
}
