import {
  Activity,
  BarChart3,
  Compass,
} from "lucide-react";

import { formatNum } from "./admin-client";
import {
  formatTrafficDateTime,
  formatTrafficMilliseconds,
  formatTrafficRelativeTime,
  type AdminTrafficTranslator,
  type TrafficBreakdown,
  type TrafficPage,
  type TrafficRecent,
  type TrafficSource,
} from "./admin-traffic-model";

import type { ReactNode } from "react";

export function TrafficMetricCard({
  icon,
  label,
  value,
  detail,
  live = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  live?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl border border-line bg-canvas p-2 text-accent">
          {icon}
        </div>
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-good/30 px-2 py-0.5 text-[0.65rem] font-semibold text-good">
            <span className="size-1.5 animate-pulse rounded-full bg-good" />
            LIVE
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-xs font-medium text-fg-3">{label}</p>
      <p className="numeral mt-1 text-2xl font-semibold tracking-tight text-fg">
        {value}
      </p>
      {detail ? <p className="mt-1 text-[0.7rem] text-fg-3">{detail}</p> : null}
    </article>
  );
}

export function TrafficBreakdownList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: TrafficBreakdown[];
}) {
  const maximum = Math.max(1, ...items.map((item) => item.pageViews));
  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-fg-2">
                  {item.label}
                </span>
                <span className="numeral shrink-0 text-fg">
                  {formatNum(item.pageViews)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-accent/80"
                  style={{ width: `${(item.pageViews / maximum) * 100}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-xs text-fg-3">—</p>
        )}
      </div>
    </section>
  );
}

export function TrafficTopPages({
  pages,
  t,
}: {
  pages: TrafficPage[];
  t: AdminTrafficTranslator;
}) {
  const maximum = Math.max(1, ...pages.map((page) => page.pageViews));
  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">
          {t("admin.traffic.topPages")}
        </h3>
      </div>
      <div className="mt-4 space-y-3">
        {pages.length ? (
          pages.map((page, index) => (
            <div
              key={page.path}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3"
            >
              <span className="numeral text-xs text-fg-3">{index + 1}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-medium text-fg">
                    {page.path}
                  </p>
                  {page.averageLoadTimeMs ? (
                    <span className="shrink-0 text-[0.65rem] text-fg-3">
                      {formatTrafficMilliseconds(page.averageLoadTimeMs)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${(page.pageViews / maximum) * 100}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="numeral text-xs font-semibold text-fg">
                  {formatNum(page.pageViews)}
                </p>
                <p className="text-[0.65rem] text-fg-3">
                  {formatNum(page.visitors)} {t("admin.traffic.visitors")}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-xs text-fg-3">—</p>
        )}
      </div>
    </section>
  );
}

export function TrafficSourceList({
  sources,
  t,
}: {
  sources: TrafficSource[];
  t: AdminTrafficTranslator;
}) {
  const maximum = Math.max(1, ...sources.map((source) => source.pageViews));
  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Compass className="size-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">
          {t("admin.traffic.sources")}
        </h3>
      </div>
      <div className="mt-4 space-y-3">
        {sources.length ? (
          sources.map((source) => (
            <div key={`${source.source}-${source.medium}`}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg-2">
                    {source.source}
                  </p>
                  <p className="text-[0.65rem] text-fg-3">{source.medium}</p>
                </div>
                <div className="text-right">
                  <p className="numeral text-fg">
                    {formatNum(source.pageViews)}
                  </p>
                  <p className="text-[0.65rem] text-fg-3">
                    {formatNum(source.visitors)} {t("admin.traffic.visitors")}
                  </p>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-accent/80"
                  style={{ width: `${(source.pageViews / maximum) * 100}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-xs text-fg-3">—</p>
        )}
      </div>
    </section>
  );
}

export function TrafficRecentStream({
  items,
  locale,
  t,
}: {
  items: TrafficRecent[];
  locale: string;
  t: AdminTrafficTranslator;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-good" />
        <h3 className="text-sm font-semibold text-fg">
          {t("admin.traffic.recent")}
        </h3>
      </div>
      <div className="mt-4 max-h-[29rem] space-y-1 overflow-auto pr-1">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={`${item.occurredAt}-${item.path}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl px-3 py-2.5 hover:bg-canvas"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-fg">
                  {item.path}
                </p>
                <p className="mt-0.5 truncate text-[0.68rem] text-fg-3">
                  {item.source} · {item.deviceType} · {item.browser}
                  {item.countryCode ? ` · ${item.countryCode}` : ""}
                </p>
              </div>
              <time
                dateTime={item.occurredAt}
                title={formatTrafficDateTime(item.occurredAt, locale)}
                className="shrink-0 text-[0.68rem] text-fg-3"
              >
                {formatTrafficRelativeTime(item.occurredAt, locale)}
              </time>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-xs text-fg-3">—</p>
        )}
      </div>
    </section>
  );
}
