/** Versioned, dependency-free contracts shared by the API, browser and regression tests. */
export type ResourceProvider = "met" | "kakao" | "bizinfo";
export type ResourceStatus = "ready" | "partial" | "not_configured" | "unavailable";
export interface CreatorResource {
  id: string;
  provider: ResourceProvider;
  title: string;
  creator: string;
  description: string;
  sourceUrl: string;
  license: "CC0" | "metadata-only";
  licenseUrl: string;
  credit: string;
  fetchedAt: string;
  imageUrl?: string;
  dateLabel?: string;
  deadline?: string;
  eligibility?: string;
  isbn?: string;
}
export interface ResourceSearchResult {
  provider: ResourceProvider;
  status: ResourceStatus;
  items: CreatorResource[];
  page: number;
  hasMore: boolean;
  fetchedAt: string | null;
  message: string;
}
export const RESOURCE_LABELS: Record<ResourceProvider, string> = {
  met: "The Met · 공개 미술 자료", kakao: "카카오 · 도서 검색", bizinfo: "기업마당 · 지원사업",
};
export function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function textOf(value: unknown, max = 500): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}
export function httpsUrl(value: unknown, hosts?: readonly string[]): string {
  if (typeof value !== "string" || value.length > 2048 || /[\r\n\t]/u.test(value)) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
    if (hosts && !hosts.includes(url.hostname)) return "";
    return url.href;
  } catch { return ""; }
}
const SOURCE_HOSTS: Record<ResourceProvider, readonly string[]> = {
  met: ["www.metmuseum.org", "metmuseum.org"],
  kakao: ["search.daum.net", "book.daum.net", "m.search.daum.net"],
  bizinfo: ["www.bizinfo.go.kr", "bizinfo.go.kr"],
};
export function isProvider(value: unknown): value is ResourceProvider {
  return value === "met" || value === "kakao" || value === "bizinfo";
}
export function dateOnly(value: unknown): string | undefined {
  const raw = textOf(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : undefined;
}
/** Ambiguous/open-ended periods remain unknown, never fabricated as an active deadline. */
export function parseDeadline(period: unknown): string | undefined {
  const match = textOf(period, 100).match(/^\s*(\d{4})-?(\d{2})-?(\d{2})\s*~\s*(\d{4})-?(\d{2})-?(\d{2})\s*$/u);
  if (!match) return undefined;
  const start = dateOnly(`${match[1]}-${match[2]}-${match[3]}`);
  const end = dateOnly(`${match[4]}-${match[5]}-${match[6]}`);
  return start && end && start <= end ? end : undefined;
}
export function deadlineLabel(deadline: string | undefined, now = new Date()): string {
  const day = dateOnly(deadline);
  if (!day) return "마감일 원문 확인";
  const todayKst = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayKst}T00:00:00Z`)) / 86400000);
  return days < 0 ? "마감일 경과" : days === 0 ? "오늘 마감 · 시간 확인" : `D-${days}`;
}
export function parseResource(value: unknown): CreatorResource | null {
  const v = recordOf(value);
  if (!isProvider(v.provider)) return null;
  const provider = v.provider;
  const id = textOf(v.id, 180);
  const title = textOf(v.title, 300);
  const sourceUrl = httpsUrl(v.sourceUrl, SOURCE_HOSTS[provider]);
  const fetchedAt = textOf(v.fetchedAt, 40);
  if (!id.startsWith(`${provider}:`) || id.length <= provider.length + 1 || !title || !sourceUrl || !Number.isFinite(Date.parse(fetchedAt))) return null;
  const license = provider === "met" && v.license === "CC0" ? "CC0" : "metadata-only";
  const imageUrl = license === "CC0" ? httpsUrl(v.imageUrl, ["images.metmuseum.org"]) : "";
  return {
    id, provider, title, sourceUrl, fetchedAt, license,
    creator: textOf(v.creator, 300), description: textOf(v.description, 1200), credit: textOf(v.credit, 500),
    licenseUrl: license === "CC0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "",
    ...(imageUrl ? { imageUrl } : {}),
    dateLabel: textOf(v.dateLabel, 100), deadline: dateOnly(v.deadline),
    eligibility: textOf(v.eligibility, 300), isbn: textOf(v.isbn, 100),
  };
}
export function parseSearchResult(value: unknown): ResourceSearchResult | null {
  const v = recordOf(value);
  if (!isProvider(v.provider) || !["ready", "partial", "not_configured", "unavailable"].includes(String(v.status)) || !Array.isArray(v.items) || v.items.length > 100) return null;
  const items = v.items.map(parseResource).filter((item): item is CreatorResource => item !== null && item.provider === v.provider);
  if (items.length !== v.items.length || new Set(items.map((item) => item.id)).size !== items.length) return null;
  if ((v.status === "not_configured" || v.status === "unavailable") && items.length > 0) return null;
  if (v.status === "not_configured" && v.hasMore === true) return null;
  return {
    provider: v.provider, status: v.status as ResourceStatus, items,
    page: typeof v.page === "number" && Number.isInteger(v.page) && v.page > 0 ? v.page : 1,
    hasMore: v.hasMore === true, fetchedAt: typeof v.fetchedAt === "string" ? v.fetchedAt : null,
    message: textOf(v.message, 500),
  };
}
export interface CreatorWorkspace {
  version: 1;
  saved: CreatorResource[];
  story: Record<string, string>;
  checks: string[];
}
export const STORY_FIELDS = ["title", "protagonist", "desire", "obstacle", "stakes", "world", "turn", "ending"] as const;
export type StoryField = typeof STORY_FIELDS[number];
export const STORY_LABELS: Record<StoryField, string> = {
  title: "작품 가제", protagonist: "주인공은 누구인가요?", desire: "주인공이 원하는 것", obstacle: "가로막는 인물·상황",
  stakes: "실패하면 잃는 것", world: "세계관의 규칙", turn: "첫 화의 전환점", ending: "마지막에 달라지는 것",
};
export function emptyWorkspace(): CreatorWorkspace { return { version: 1, saved: [], story: {}, checks: [] }; }
export function parseWorkspace(raw: string | null): CreatorWorkspace {
  if (!raw) return emptyWorkspace();
  if (new TextEncoder().encode(raw).length > 1000000) throw new Error("저장 파일이 너무 큽니다. 1 MB 이하 파일을 사용하세요.");
  const v = recordOf(JSON.parse(raw));
  if (v.version !== 1 || !Array.isArray(v.saved) || v.saved.length > 200 || !Array.isArray(v.checks) || v.checks.length > 200) throw new Error("지원하지 않는 창작 보드 형식입니다.");
  const saved = v.saved.map(parseResource);
  if (saved.some((item) => !item)) throw new Error("출처 또는 이용조건이 유효하지 않은 항목이 있습니다.");
  const story: Record<string, string> = {};
  const incomingStory = recordOf(v.story);
  for (const field of STORY_FIELDS) story[field] = typeof incomingStory[field] === "string" ? incomingStory[field].slice(0, 2000) : "";
  return { version: 1, saved: [...new Map((saved as CreatorResource[]).map((item) => [item.id, item])).values()], story,
    checks: [...new Set(v.checks.filter((item): item is string => typeof item === "string" && /^[\w-]{1,100}$/u.test(item)))],
  };
}
const markdownText = (value: string) => value.replaceAll("\\", "\\\\").replace(/[[\]<>`*_]/gu, "\\$&");
export function attributionMarkdown(items: readonly CreatorResource[]): string {
  return "# 창작 자료 출처 기록\n\n검색·열람 권한은 이미지 재배포 허가와 다릅니다. 제작에 사용하기 전 원문 조건을 다시 확인하세요.\n\n" + items.map((item) =>
    `## ${markdownText(item.title)}\n- 제공처: ${RESOURCE_LABELS[item.provider]}\n- 저작자: ${markdownText(item.creator || "원문 확인")}\n- 원문: ${item.sourceUrl}\n- 이용조건: ${item.license}\n- 크레딧: ${markdownText(item.credit)}\n- 조회일: ${item.fetchedAt}\n`,
  ).join("\n");
}
export function storyMarkdown(story: Record<string, string>): string {
  return "# 웹툰 기획 워크시트\n\n직접 작성하는 기획 도구입니다. AI 생성 결과가 아닙니다.\n\n" + STORY_FIELDS.map((field) =>
    `## ${STORY_LABELS[field]}\n${markdownText(story[field] || "아직 작성하지 않음")}\n`,
  ).join("\n");
}
function icsText(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/gu, "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}
function foldIcs(line: string): string {
  const encoder = new TextEncoder();
  let output = ""; let width = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (width + bytes > 75) { output += "\r\n "; width = 1; }
    output += char; width += bytes;
  }
  return output;
}
export function deadlineCalendar(item: CreatorResource, now = new Date()): string {
  const day = dateOnly(item.deadline);
  if (item.provider !== "bizinfo" || !day) throw new Error("확인된 마감일이 없습니다.");
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ToonStudio//Creator Resources//KO", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${encodeURIComponent(item.id)}@toonstudio.cloud`, `DTSTAMP:${now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "")}`,
    `DTSTART;VALUE=DATE:${day.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${nextDay.replaceAll("-", "")}`,
    `SUMMARY:${icsText(item.title)} 마감일 확인`, `DESCRIPTION:${icsText(`한국 시간 기준 마감일 참고 일정입니다. 정확한 접수 시간과 변경 여부는 원문에서 확인하세요.\n${item.sourceUrl}`)}`,
    `URL:${item.sourceUrl}`, "END:VEVENT", "END:VCALENDAR", ""].map(foldIcs).join("\r\n");
}
