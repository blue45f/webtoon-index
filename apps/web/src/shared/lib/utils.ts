import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// kstDayOfWeek 는 연재 캘린더 그룹화(groupByWeekday)와 한 짝이라 @toonspectrum/core 의 calendar 모듈을
// 단일 출처로 삼는다(웹 앱·API 공유). cn/keepInlineText 등 UI 의존(clsx/Tailwind) 유틸은 여기 남는다.
export { kstDayOfWeek } from "../../../../../packages/core/src/calendar";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function keepInlineText(value: string): string {
  return value.replace(/\s+/g, "\u00a0");
}

// 12345 -> "1.2만" / "12.3K", 123456789 -> "1.2억" / "123M", 980 -> "980"
export function formatCount(n: number, locale = "ko"): string {
  const normLocale = (locale || "ko").toLowerCase();
  if (normLocale.startsWith("ko")) {
    if (n >= 1e8) {
      const v = n / 1e8;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}억`;
    }
    if (n >= 1e4) {
      const v = n / 1e4;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}만`;
    }
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}천`;
    return String(n);
  }

  try {
    return new Intl.NumberFormat(normLocale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return String(n);
  }
}

export function formatFull(n: number, locale = "ko"): string {
  try {
    return n.toLocaleString(locale || "ko");
  } catch {
    return n.toLocaleString("en");
  }
}

// ISO 날짜 -> "3일 전" / "3 days ago"
export function relativeDate(
  iso: string,
  now = new Date("2025-05-29T00:00:00Z"),
  locale = "ko",
): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days < 0) return iso.slice(0, 10).replace(/-/g, ".");

  const normLocale = (locale || "ko").toLowerCase();
  if (normLocale.startsWith("ko")) {
    if (days === 0) return "오늘";
    if (days === 1) return "어제";
    if (days < 7) return `${days}일 전`;
    if (days < 30) return `${Math.floor(days / 7)}주 전`;
    if (days < 365) return `${Math.floor(days / 30)}개월 전`;
    return `${Math.floor(days / 365)}년 전`;
  }

  try {
    const rtf = new Intl.RelativeTimeFormat(normLocale, { numeric: "auto" });
    if (days === 0) return rtf.format(0, "day");
    if (days === 1) return rtf.format(-1, "day");
    if (days < 7) return rtf.format(-days, "day");
    if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
    if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
    return rtf.format(-Math.floor(days / 365), "year");
  } catch {
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

// 결정적 의사난수 (시드 기반) — 아바타/스켈레톤 등 SSR 안전한 변주에 사용
export function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
