import type { PlatformId } from "@/shared/lib/types";

import { PLATFORM_LIST } from "@/shared/lib/platforms";
import { cn } from "@/shared/lib/utils";

export function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((entry) => entry !== value) : [...arr, value];
}

export function facetClass(active: boolean) {
  return cn(
    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
    active
      ? "border-accent/60 bg-accent-soft text-accent"
      : "border-line bg-card text-fg-2 hover:text-fg hover:border-line-strong"
  );
}

export function tinyPill(active: boolean) {
  return cn(
    // 좁은 화면에서도 읽히고 누르기 편하도록 최소 높이(32px)·12px 본문 + 한 줄 유지(줄바꿈 방지).
    "inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-accent/55 bg-accent-soft text-accent"
      : "border-line bg-card text-fg-3 hover:text-fg hover:border-line-strong"
  );
}

export function compactNumber(value: number) {
  return value.toLocaleString();
}

export function relativeTime(value: string | undefined, t: (key: string) => string) {
  if (!value) return t("search.explorer.time.noData");
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return t("search.explorer.time.noData");
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return t("search.explorer.time.justNow");
  if (minutes < 60) return t("search.explorer.time.minutesAgo").replace("{count}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("search.explorer.time.hoursAgo").replace("{count}", String(hours));
  return t("search.explorer.time.daysAgo").replace("{count}", String(Math.floor(hours / 24)));
}

export function platformName(id: PlatformId) {
  return PLATFORM_LIST.find((platform) => platform.id === id)?.short ?? id;
}

export function platformColor(id: PlatformId) {
  return PLATFORM_LIST.find((platform) => platform.id === id)?.color ?? "oklch(0.305 0.012 64)";
}
