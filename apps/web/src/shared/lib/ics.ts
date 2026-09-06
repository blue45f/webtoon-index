// RFC 5545 호환 ICS(iCalendar) 빌더 — 무의존성.
//
// 연재 캘린더의 요일별 스케줄을 캘린더 앱(Apple Calendar, Google Calendar, Outlook 등)이
// 구독/가져오기 할 수 있는 VCALENDAR + 다건 VEVENT 텍스트로 변환한다.
//
// 연재 일정은 "요일"만 확정이고 공개 시각은 플랫폼·작품마다 달라 단정할 수 없으므로
// (데이터 정직성), 시각을 지어내지 않고 종일(VALUE=DATE) + 주간 반복(RRULE BYDAY)으로
// 표현한다. DATE 타입은 타임존이 없어 UTC DTSTART에서 생기는 KST 자정↔UTC 전날 요일
// 어긋남(BYDAY 불일치) 문제도 피한다.

import { PLATFORMS } from "./platforms";
import { WEEK_DAYS } from "./taxonomy";

import type { Title } from "./types";

// 주간 반복 일정 1건 (작품 1편 = VEVENT 1건, 다요일 연재는 BYDAY 다중으로 합침)
export interface WeeklyIcsEvent {
  /** VEVENT UID — 같은 작품을 다시 가져와도 중복되지 않게 결정적으로 만든다. */
  uid: string;
  summary: string;
  /** 연재 요일 라벨(WEEK_DAYS의 "월"~"일"). 매핑 불가 라벨은 무시된다. */
  days: readonly string[];
  description?: string;
  url?: string;
}

const PRODID = "-//ToonSpectrum//Release Calendar//KO";
const CRLF = "\r\n";
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SITE_BASE = "https://www.toonstudio.cloud"; // 정규 호스트 — ranking JSON-LD와 동일 기준

// WEEK_DAYS 인덱스(0=월…6=일) → RFC 5545 BYDAY 코드
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
// getUTCDay()(0=일…6=토) → WEEK_DAYS 인덱스(0=월…6=일). lib/server/calendar.ts와 동일 매핑.
const DAY_IDX_FROM_GETDAY = [6, 0, 1, 2, 3, 4, 5];

// Date를 RFC 5545의 `YYYYMMDDTHHMMSSZ` (UTC) 포맷으로 변환 — DTSTAMP용.
function toUtcStamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date passed to buildWeeklyIcs: ${String(date)}`);
  }
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

// UTC 필드가 KST 달력 날짜를 나타내는 시프트된 Date의 `YYYYMMDD` — VALUE=DATE용.
function toDateStamp(shifted: Date): string {
  const y = shifted.getUTCFullYear().toString().padStart(4, "0");
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = shifted.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

// RFC 5545 §3.3.11 TEXT escape — 백슬래시, 개행, 세미콜론, 콤마.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// RFC 5545 §3.1 content line folding — 75옥텟 초과 시 CRLF+공백으로 접는다.
// 한글 같은 멀티바이트 문자가 잘리지 않도록 UTF-8 바이트 길이 기준으로 분할.
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = start === 0 ? 75 : 74; // 후속 라인은 선행 공백이 1옥텟 차지
    let end = Math.min(start + limit, bytes.length);
    // UTF-8 연속 바이트(10xxxxxx) 한가운데서 자르지 않도록 경계 보정
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks.join(`${CRLF} `);
}

// "월"~"일" 라벨 → WEEK_DAYS 인덱스 목록(중복 제거, 요일 순 정렬). 미지 라벨은 버린다.
function toDayIndexes(days: readonly string[]): number[] {
  const idxs = new Set<number>();
  for (const day of days) {
    const idx = (WEEK_DAYS as readonly string[]).indexOf(day);
    if (idx >= 0) idxs.add(idx);
  }
  return [...idxs].sort((a, b) => a - b);
}

// 연재 요일 중 가장 가까운 KST 도래일(오늘 포함)을, UTC 필드가 KST 날짜를 나타내는
// 시프트된 Date로 반환. lib/utils.ts kstDayOfWeek()와 같은 +9h 시프트 기법.
function nextKstOccurrence(dayIdxs: readonly number[], now: Date): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const todayIdx = DAY_IDX_FROM_GETDAY[shifted.getUTCDay()];
  const ahead = Math.min(...dayIdxs.map((idx) => (idx - todayIdx + 7) % 7));
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + ahead)
  );
}

// 작품 → 주간 반복 이벤트. days를 넘기면(예: 필터된 캘린더 보드의 버킷 요일) 그 요일만 쓰고,
// 생략하면 작품의 updateDays를 그대로 쓴다.
export function titleToWeeklyIcsEvent(title: Title, days?: readonly string[]): WeeklyIcsEvent {
  const updateDays = days ?? title.updateDays ?? [];
  const platformNames = [...new Set(title.availability.map((entry) => entry.platformId))].map(
    (id) => PLATFORMS[id]?.short ?? id
  );
  return {
    uid: `${title.slug}@toonspectrum`,
    summary: `${title.title} 새 회차`,
    days: updateDays,
    description: `매주 ${updateDays.join("·")} 연재${
      platformNames.length ? ` · ${platformNames.join(", ")}` : ""
    } — 툰스펙트럼 연재 캘린더`,
    url: `${SITE_BASE}/title/${encodeURIComponent(title.slug)}`,
  };
}

// 주간 반복 이벤트 목록을 RFC 5545 ICS 텍스트로 변환한다.
//
// - VCALENDAR(VERSION/PRODID/CALSCALE/METHOD:PUBLISH) + 이벤트별 VEVENT
// - DTSTART/DTEND는 종일(VALUE=DATE), DTSTART는 연재 요일의 다음 KST 도래일(오늘 포함)
// - RRULE:FREQ=WEEKLY;BYDAY=… 로 매주 반복
// - 요일 라벨이 하나도 매핑되지 않는 이벤트는 건너뛴다(추정 일정을 만들지 않음)
// - 모든 content line은 75옥텟 기준 folding, CRLF 줄 끝
export function buildWeeklyIcs(
  events: readonly WeeklyIcsEvent[],
  options: { calendarName?: string; now?: Date } = {}
): string {
  const now = options.now ?? new Date();
  const dtstamp = toUtcStamp(now);

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:${PRODID}`);
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  if (options.calendarName) {
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
  }

  for (const event of events) {
    const dayIdxs = toDayIndexes(event.days);
    if (dayIdxs.length === 0) continue;
    const start = nextKstOccurrence(dayIdxs, now);
    const end = new Date(start.getTime() + DAY_MS); // 종일 이벤트의 DTEND는 비포함(다음 날)
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${toDateStamp(start)}`);
    lines.push(`DTEND;VALUE=DATE:${toDateStamp(end)}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${dayIdxs.map((idx) => BYDAY[idx]).join(",")}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// ICS 텍스트를 브라우저 다운로드로 트리거 (Blob URL + a.download).
export function downloadIcs(ics: string, filename: string): void {
  if (typeof document === "undefined") return;

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 브라우저가 다운로드를 시작할 시간을 준 뒤 Blob URL 해제
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
