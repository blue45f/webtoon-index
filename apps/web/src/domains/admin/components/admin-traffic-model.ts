export const TRAFFIC_PULSE_REFRESH_MS = 15_000;
export const TRAFFIC_OVERVIEW_REFRESH_MS = 5 * 60_000;
export const TRAFFIC_RANGE_DAYS = [1, 7, 30, 90] as const;

export type TrafficRangeDays = (typeof TRAFFIC_RANGE_DAYS)[number];

/**
 * Range label keys, written out rather than built as `admin.traffic.range${days}`.
 *
 * The i18n coverage gate extracts `t()` arguments statically, so an interpolated key reaches it as
 * the literal "admin.traffic.range${range}" — a key no dictionary can ever hold, while the four
 * real ones look unused. Spelling them out keeps the gate honest in both directions.
 */
export const TRAFFIC_RANGE_LABEL_KEYS = {
  1: "admin.traffic.range1",
  7: "admin.traffic.range7",
  30: "admin.traffic.range30",
  90: "admin.traffic.range90",
} as const satisfies Record<TrafficRangeDays, string>;

export type TrafficSeriesPoint = {
  bucket: string;
  pageViews: number;
  visitors: number;
  sessions?: number;
};

export type TrafficPulse = {
  generatedAt: string;
  windowMinutes: number;
  activeVisitors: number;
  activeSessions: number;
  pageViews5m: number;
  pageViews30m: number;
  latestAt: string | null;
  series: TrafficSeriesPoint[];
};

export type TrafficBreakdown = {
  label: string;
  pageViews: number;
  visitors: number;
};

export type TrafficSource = {
  source: string;
  medium: string;
  pageViews: number;
  visitors: number;
};

export type TrafficPage = {
  path: string;
  title: string | null;
  pageViews: number;
  visitors: number;
  sessions: number;
  averageLoadTimeMs: number | null;
};

export type TrafficRecent = {
  occurredAt: string;
  path: string;
  source: string;
  medium: string;
  countryCode: string | null;
  deviceType: string;
  browser: string;
};

export type TrafficOverview = {
  generatedAt: string;
  rangeDays: number;
  bucketSeconds: number;
  status: "live" | "empty";
  storageMode: string;
  retentionDays: number;
  privacy: {
    storesRawIp: boolean;
    storesQueryString: boolean;
    honorsBrowserPrivacySignals: boolean;
    adminPathsExcluded: boolean;
  };
  realtime: {
    windowMinutes: number;
    activeVisitors: number;
    activeSessions: number;
    pageViews5m: number;
    pageViews30m: number;
    latestAt: string | null;
  };
  totals: {
    pageViews: number;
    uniqueVisitors: number;
    sessions: number;
    returningVisitors: number;
    coverageStartAt: string | null;
    latestAt: string | null;
    averageLoadTimeMs: number | null;
  };
  engagement: {
    engagedSessions: number;
    bounceRate: number;
    averageEngagedSeconds: number;
    pageViewsPerSession: number;
  };
  series: TrafficSeriesPoint[];
  realtimeSeries: TrafficSeriesPoint[];
  topPages: TrafficPage[];
  sources: TrafficSource[];
  devices: TrafficBreakdown[];
  browsers: TrafficBreakdown[];
  countries: TrafficBreakdown[];
  recent: TrafficRecent[];
};

export type AdminTrafficTranslator = (key: string) => string;

export function formatTrafficDuration(seconds: number): string {
  const normalized = Math.max(0, Math.round(seconds));
  if (normalized < 60) return `${normalized}s`;
  const minutes = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function formatTrafficMilliseconds(
  value: number | null | undefined,
): string {
  if (!value) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(1)}s`;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTrafficDateTime(
  value: string | null | undefined,
  locale: string,
): string {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatTrafficRelativeTime(
  value: string | null | undefined,
  locale: string,
): string {
  const date = safeDate(value);
  if (!date) return "—";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  return formatter.format(Math.round(minutes / 60), "hour");
}

function escapeCsv(value: unknown): string {
  const normalized = String(value ?? "");
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function downloadTrafficOverviewCsv(data: TrafficOverview): void {
  const rows: string[][] = [
    ["section", "label", "pageViews", "visitors", "sessions", "extra"],
    ...data.topPages.map((item) => [
      "page",
      item.path,
      String(item.pageViews),
      String(item.visitors),
      String(item.sessions),
      item.title ?? "",
    ]),
    ...data.sources.map((item) => [
      "source",
      `${item.source} / ${item.medium}`,
      String(item.pageViews),
      String(item.visitors),
      "",
      "",
    ]),
    ...data.devices.map((item) => [
      "device",
      item.label,
      String(item.pageViews),
      String(item.visitors),
      "",
      "",
    ]),
    ...data.browsers.map((item) => [
      "browser",
      item.label,
      String(item.pageViews),
      String(item.visitors),
      "",
      "",
    ]),
    ...data.countries.map((item) => [
      "country",
      item.label,
      String(item.pageViews),
      String(item.visitors),
      "",
      "",
    ]),
  ];
  const csv = `\uFEFF${rows
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `toonspectrum-traffic-${data.rangeDays}d-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
