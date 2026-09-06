import {
  Activity,
  DollarSign,
  Flag,
  Radio,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "./admin-client";

import { useT } from "@/shared/lib/i18n";

interface SystemHealthRes {
  status: string;
  database: { latencyMs: number };
  counts: {
    users: number;
    reviews: number;
    fanPosts: number;
    revenueEvents: number;
  };
  maintenance: { enabled: boolean };
}

interface TrafficPulseRes {
  generatedAt: string;
  activeVisitors: number;
  activeSessions: number;
  pageViews5m: number;
  pageViews30m: number;
}

interface AdminHeaderStatsProps {
  userId: string;
}

export function AdminHeaderStats({ userId }: AdminHeaderStatsProps) {
  const [health, setHealth] = useState<SystemHealthRes | null>(null);
  const [traffic, setTraffic] = useState<TrafficPulseRes | null>(null);
  const t = useT();

  useEffect(() => {
    let unmounted = false;
    const fetchPulse = async () => {
      const [healthResult, trafficResult] = await Promise.allSettled([
        adminFetch<SystemHealthRes>("/system/health", userId),
        adminFetch<TrafficPulseRes>("/traffic/pulse", userId),
      ]);
      if (unmounted) return;
      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
      }
      if (trafficResult.status === "fulfilled") {
        setTraffic(trafficResult.value);
      }
    };
    void fetchPulse();
    const interval = globalThis.setInterval(() => void fetchPulse(), 15_000);
    return () => {
      unmounted = true;
      globalThis.clearInterval(interval);
    };
  }, [userId]);

  if (!health) return null;

  return (
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 backdrop-blur-xl sm:grid-cols-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
          <Activity className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {t("admin.stats.health")}
          </p>
          <p className="flex items-center gap-1.5 pt-0.5 text-xs font-bold text-white">
            <span
              className={`size-2 rounded-full ${
                health.status === "healthy"
                  ? "animate-pulse bg-emerald-400"
                  : "bg-rose-400"
              }`}
            />
            {health.status === "healthy"
              ? t("admin.stats.healthy")
              : t("admin.stats.degraded")}
            <span className="font-mono text-[10px] text-slate-500">
              ({health.database.latencyMs}ms)
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2.5 text-cyan-400">
          <Radio className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {t("admin.stats.activeVisitors")}
          </p>
          <p className="pt-0.5 text-xs font-bold text-white">
            {traffic ? traffic.activeVisitors.toLocaleString() : "—"}
            <span className="ml-1 font-normal text-slate-500">
              / {traffic ? traffic.pageViews5m.toLocaleString() : "—"} pv
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5 text-indigo-400">
          <DollarSign className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {t("admin.stats.revenueEvents")}
          </p>
          <p className="pt-0.5 text-xs font-bold text-white">
            {health.counts.revenueEvents.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2.5 text-cyan-400">
          <Flag className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {t("admin.stats.usersCommunity")}
          </p>
          <p className="pt-0.5 text-xs font-bold text-white">
            {health.counts.users.toLocaleString()} /{" "}
            {health.counts.fanPosts.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-400">
          <ShieldAlert className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400">
            {t("admin.stats.maintenance")}
          </p>
          <p className="pt-0.5 text-xs font-bold text-white">
            {health.maintenance.enabled ? (
              <span className="font-bold text-rose-400">
                {t("admin.stats.maintenanceOn")}
              </span>
            ) : (
              <span className="text-slate-300">
                {t("admin.stats.maintenanceOff")}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
