import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";

import { getAdminAdvancedCopy } from "./admin-advanced-copy";
import {
  ADMIN_TAB_KEYS,
  buildAdminTabHref,
  parseAdminTab,
  type AdminTabKey,
} from "./admin-console-model";
import { loadAdminI18nLocale } from "./admin-i18n-loader";
import { AdminGateFallback } from "./components/admin-gate";
import { useAdminGate } from "./components/admin-gate-state";
import { AdminAnnouncements } from "./components/AdminAnnouncements";
import { AdminAuditLogs } from "./components/AdminAuditLogs";
import { AdminCampaigns } from "./components/AdminCampaigns";
import { AdminDashboard } from "./components/AdminDashboard";
import { AdminHeaderStats } from "./components/AdminHeaderStats";
import { AdminOps } from "./components/AdminOps";
import { AdminPlans } from "./components/AdminPlans";
import { AdminPromos } from "./components/AdminPromos";
import { AdminQuickPalette } from "./components/AdminQuickPalette";
import { AdminReports } from "./components/AdminReports";
import { AdminRevenue } from "./components/AdminRevenue";
import { AdminSecurity } from "./components/AdminSecurity";
import { AdminToastProvider } from "./components/AdminToast";
import { AdminTraffic } from "./components/AdminTraffic";

import { Container } from "@/shared/components/section";
import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "@/src/compat/navigation";
import Link from "@/src/compat/router-link";

export function AdminPage() {
  const { gate, uid } = useAdminGate();
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const copy = getAdminAdvancedCopy(lang);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = parseAdminTab(searchParams.get("tab"));

  useEffect(() => {
    void loadAdminI18nLocale(lang);
  }, [lang]);

  const tabLabels: Record<AdminTabKey, string> = {
    dashboard: t("admin.tabs.dashboard"),
    traffic: t("admin.tabs.traffic"),
    plans: t("admin.tabs.plans"),
    revenue: t("admin.tabs.revenue"),
    promos: t("admin.tabs.promos"),
    announcements: t("admin.tabs.announcements"),
    reports: t("admin.tabs.reports"),
    security: t("admin.tabs.security"),
    audit: t("admin.tabs.audit"),
    campaigns: t("admin.tabs.campaigns"),
    ops: t("admin.tabs.ops"),
  };

  const splitRoutes = [
    { href: "/admin/community", label: t("admin.splitRoutes.community") },
    { href: "/admin/members", label: t("admin.splitRoutes.members") },
  ];

  const selectTab = (nextTab: AdminTabKey, focusTab = false) => {
    if (nextTab !== tab) {
      router.replace(
        buildAdminTabHref(pathname, searchParams, nextTab),
        { scroll: false },
      );
    }
    if (focusTab) {
      globalThis.requestAnimationFrame(() => {
        document.getElementById(`admin-tab-${nextTab}`)?.focus();
      });
    }
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: AdminTabKey,
  ) => {
    const currentIndex = ADMIN_TAB_KEYS.indexOf(currentTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % ADMIN_TAB_KEYS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + ADMIN_TAB_KEYS.length) % ADMIN_TAB_KEYS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ADMIN_TAB_KEYS.length - 1;
    }

    if (nextIndex == null) return;
    event.preventDefault();
    selectTab(ADMIN_TAB_KEYS[nextIndex], true);
  };

  return (
    <AdminToastProvider>
      <Container size="wide" className="space-y-6 py-10">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <ShieldCheck size={13} /> {t("admin.console")}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {t("admin.title")}
            </h1>
            <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-3">
              {t("admin.desc")}
            </p>
          </div>

          {gate.kind === "admin" && uid ? (
            <AdminQuickPalette
              userId={uid}
              onSelectTab={(key) => selectTab(parseAdminTab(key))}
            />
          ) : null}
        </header>

        <AdminGateFallback gate={gate} />

        {gate.kind === "admin" && uid ? (
          <div className="flex flex-col gap-6">
            <AdminHeaderStats userId={uid} />

            <div className="text-xs text-fg-3">
              {gate.me.name ?? gate.me.email} · {t("admin.role")} {" "}
              <span className="font-semibold text-accent">{gate.me.role}</span>
            </div>

            <div className="sticky top-2 z-30 -mx-2 flex items-center gap-2 overflow-x-auto rounded-2xl border border-line bg-card/95 p-2 shadow-xl shadow-black/10 backdrop-blur-xl [scrollbar-width:thin]">
              <div
                className="inline-flex shrink-0 items-center gap-1"
                aria-label={copy.console.navLabel}
                role="tablist"
              >
                {ADMIN_TAB_KEYS.map((tabKey) => (
                  <button
                    key={tabKey}
                    id={`admin-tab-${tabKey}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === tabKey}
                    aria-controls={`admin-panel-${tabKey}`}
                    tabIndex={tab === tabKey ? 0 : -1}
                    onClick={() => selectTab(tabKey)}
                    onKeyDown={(event) => handleTabKeyDown(event, tabKey)}
                    className={cn(
                      "min-h-10 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all",
                      tab === tabKey
                        ? "bg-accent font-semibold text-on-accent shadow-md shadow-accent/20"
                        : "text-fg-2 hover:bg-slate-800/40 hover:text-fg",
                    )}
                  >
                    {tabLabels[tabKey]}
                  </button>
                ))}
              </div>

              <span className="h-7 w-px shrink-0 bg-line" aria-hidden />

              <nav
                className="inline-flex shrink-0 items-center gap-1"
                aria-label={t("admin.splitRoutes.members")}
              >
                {splitRoutes.map((route) => (
                  <Link
                    key={route.href}
                    href={route.href}
                    className="inline-flex min-h-10 items-center whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-fg-2 transition-colors hover:bg-slate-800/40 hover:text-fg"
                  >
                    {route.label}
                  </Link>
                ))}
              </nav>
            </div>

            <main
              id={`admin-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`admin-tab-${tab}`}
              aria-label={copy.console.tabPanelLabel}
              className="min-h-[500px] focus:outline-none"
              tabIndex={-1}
            >
              {tab === "dashboard" ? (
                <AdminDashboard uid={uid} onNavigate={selectTab} />
              ) : null}
              {tab === "traffic" ? <AdminTraffic uid={uid} /> : null}
              {tab === "plans" ? <AdminPlans uid={uid} /> : null}
              {tab === "revenue" ? <AdminRevenue uid={uid} /> : null}
              {tab === "promos" ? <AdminPromos userId={uid} /> : null}
              {tab === "announcements" ? (
                <AdminAnnouncements userId={uid} />
              ) : null}
              {tab === "reports" ? <AdminReports userId={uid} /> : null}
              {tab === "security" ? <AdminSecurity userId={uid} /> : null}
              {tab === "audit" ? <AdminAuditLogs userId={uid} /> : null}
              {tab === "campaigns" ? <AdminCampaigns uid={uid} /> : null}
              {tab === "ops" ? <AdminOps uid={uid} /> : null}
            </main>
          </div>
        ) : null}
      </Container>
    </AdminToastProvider>
  );
}
