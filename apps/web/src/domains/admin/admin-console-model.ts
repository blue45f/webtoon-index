export const ADMIN_TAB_KEYS = [
  "dashboard",
  "traffic",
  "plans",
  "revenue",
  "promos",
  "announcements",
  "reports",
  "security",
  "audit",
  "campaigns",
  "ops",
] as const;

export type AdminTabKey = (typeof ADMIN_TAB_KEYS)[number];

const ADMIN_TAB_SET = new Set<string>(ADMIN_TAB_KEYS);

export function isAdminTabKey(value: unknown): value is AdminTabKey {
  return typeof value === "string" && ADMIN_TAB_SET.has(value);
}

export function parseAdminTab(value: unknown): AdminTabKey {
  return isAdminTabKey(value) ? value : "dashboard";
}

export function buildAdminTabHref(
  pathname: string,
  currentSearch: string | URLSearchParams,
  tab: AdminTabKey,
): string {
  const params =
    typeof currentSearch === "string"
      ? new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch)
      : new URLSearchParams(currentSearch);

  if (tab === "dashboard") {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export type AnnouncementOperationalStatus =
  | "active"
  | "scheduled"
  | "expired"
  | "inactive";

export interface SchedulableAnnouncement {
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export function getAnnouncementOperationalStatus(
  item: SchedulableAnnouncement,
  nowMs = Date.now(),
): AnnouncementOperationalStatus {
  if (!item.isActive) return "inactive";

  const startsAtMs = item.startsAt ? Date.parse(item.startsAt) : Number.NaN;
  if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) return "scheduled";

  const endsAtMs = item.endsAt ? Date.parse(item.endsAt) : Number.NaN;
  if (Number.isFinite(endsAtMs) && endsAtMs <= nowMs) return "expired";

  return "active";
}

export function countActiveCriticalAnnouncements<
  T extends SchedulableAnnouncement & { level?: string | null },
>(items: readonly T[], nowMs = Date.now()): number {
  return items.filter(
    (item) =>
      String(item.level ?? "").toLowerCase() === "critical" &&
      getAnnouncementOperationalStatus(item, nowMs) === "active",
  ).length;
}
