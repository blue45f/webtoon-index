import { z } from "zod";

export const STUDIO_RELEASE_SCHEDULE_VERSION = 1 as const;
export const STUDIO_RELEASE_SCHEDULE_MAX_ITEMS = 500;
export const STUDIO_RELEASE_SCHEDULE_MAX_IMPORT_CANDIDATES = 2_000;
export const STUDIO_RELEASE_SCHEDULE_MAX_ID_LENGTH = 120;
export const STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH = 160;
export const STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH = 2_000;
export const STUDIO_RELEASE_SCHEDULE_MAX_TIME_ZONE_LENGTH = 100;
export const STUDIO_RELEASE_SCHEDULE_MAX_SERIALIZED_BYTES = 1_500_000;
export const STUDIO_RELEASE_SCHEDULE_MAX_ICALENDAR_BYTES = 2_000_000;
export const STUDIO_RELEASE_LOCAL_ONLY_NOTICE =
  "ToonSpectrum의 로컬 일정 기록이며 외부 플랫폼에 자동 게시하지 않습니다.";

export const STUDIO_RELEASE_ITEM_KINDS = ["episode", "milestone"] as const;
export const STUDIO_RELEASE_DESTINATIONS = ["generic", "webtoon", "tapas"] as const;
export const STUDIO_RELEASE_STATUSES = [
  "draft",
  "review",
  "ready",
  "scheduled",
  "published",
] as const;

export type StudioReleaseItemKind = (typeof STUDIO_RELEASE_ITEM_KINDS)[number];
export type StudioReleaseDestination = (typeof STUDIO_RELEASE_DESTINATIONS)[number];
export type StudioReleaseStatus = (typeof STUDIO_RELEASE_STATUSES)[number];

const IdSchema = z.string().trim().min(1).max(STUDIO_RELEASE_SCHEDULE_MAX_ID_LENGTH);

export const StudioReleaseScheduleItemSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(STUDIO_RELEASE_ITEM_KINDS),
    title: z.string().max(STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH),
    destination: z.enum(STUDIO_RELEASE_DESTINATIONS),
    localDate: z.string().max(10),
    localTime: z.string().max(5),
    timeZone: z.string().max(STUDIO_RELEASE_SCHEDULE_MAX_TIME_ZONE_LENGTH),
    status: z.enum(STUDIO_RELEASE_STATUSES),
    notes: z.string().max(STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH).optional(),
  })
  .strict();

export const StudioReleaseScheduleSchema = z
  .object({
    version: z.literal(STUDIO_RELEASE_SCHEDULE_VERSION),
    items: z.array(StudioReleaseScheduleItemSchema).max(STUDIO_RELEASE_SCHEDULE_MAX_ITEMS),
  })
  .strict();

export type StudioReleaseScheduleItem = z.infer<typeof StudioReleaseScheduleItemSchema>;
export type StudioReleaseSchedule = z.infer<typeof StudioReleaseScheduleSchema>;
export type StudioReleaseScheduleItemInput = { id: string } & Partial<
  Omit<StudioReleaseScheduleItem, "id">
>;
export type StudioReleaseScheduleItemPatch = Partial<Omit<StudioReleaseScheduleItem, "id">>;

export const STUDIO_RELEASE_VALIDATION_CODES = [
  "missing-title",
  "missing-local-date",
  "invalid-local-date",
  "missing-local-time",
  "invalid-local-time",
  "missing-time-zone",
  "invalid-time-zone",
  "nonexistent-local-time",
  "ambiguous-local-time",
  "duplicate-slot",
  "scheduled-in-past",
  "published-in-future",
  "unfinished-in-past",
  "destination-policy-review",
] as const;

export type StudioReleaseValidationCode = (typeof STUDIO_RELEASE_VALIDATION_CODES)[number];
export type StudioReleaseValidationSeverity = "error" | "warning";

export interface StudioReleaseValidationIssue {
  code: StudioReleaseValidationCode;
  severity: StudioReleaseValidationSeverity;
  message: string;
  itemId?: string;
  relatedItemId?: string;
  field?: "title" | "localDate" | "localTime" | "timeZone" | "status" | "destination";
  destination?: Exclude<StudioReleaseDestination, "generic">;
}

export interface StudioReleaseValidationResult {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: StudioReleaseValidationIssue[];
}

export type StudioReleaseUtcFailureReason =
  | "invalid-local-date"
  | "invalid-local-time"
  | "invalid-time-zone"
  | "nonexistent-local-time"
  | "ambiguous-local-time";

export type StudioReleaseUtcResolution =
  | {
      ok: true;
      utcMs: number;
      utcIso: string;
      ambiguous: boolean;
      candidateUtcIso: string[];
      canonicalTimeZone: string;
    }
  | { ok: false; reason: StudioReleaseUtcFailureReason };

export interface ResolveStudioReleaseUtcOptions {
  disambiguation?: "earlier" | "later" | "reject";
}

export interface ValidateStudioReleaseScheduleOptions {
  now?: Date;
}

export interface StudioReleaseIcalendarOptions {
  calendarName?: string;
  generatedAt?: Date;
  includeNotes?: boolean;
  statuses?: readonly StudioReleaseStatus[];
  disambiguation?: ResolveStudioReleaseUtcOptions["disambiguation"];
}

export interface StudioReleaseIcalendarExport {
  content: string;
  filename: "toonspectrum-release-schedule.ics";
  mimeType: "text/calendar;charset=utf-8";
  eventCount: number;
  exportedItemIds: string[];
  skippedItemIds: string[];
  validation: StudioReleaseValidationResult;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalTimeParts {
  hour: number;
  minute: number;
}

interface ZonedParts extends LocalDateParts, LocalTimeParts {}

const PATCH_FIELDS = new Set<string>([
  "kind",
  "title",
  "destination",
  "localDate",
  "localTime",
  "timeZone",
  "status",
  "notes",
]);
const TEXT_ENCODER = new TextEncoder();
const POLICY_DESTINATIONS = ["webtoon", "tapas"] as const;
const TEMPORAL_FAILURE_CODES = new Set<StudioReleaseValidationCode>([
  "missing-local-date",
  "missing-local-time",
  "missing-time-zone",
  "invalid-local-date",
  "invalid-local-time",
  "invalid-time-zone",
  "nonexistent-local-time",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUnsafeControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      continue;
    }
    result += character;
  }
  return result;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return stripUnsafeControlCharacters(value).trim().slice(0, maxLength);
}

function normalizeKind(value: unknown): StudioReleaseItemKind {
  return value === "milestone" ? "milestone" : "episode";
}

function normalizeDestination(value: unknown): StudioReleaseDestination {
  if (value === "webtoon" || value === "webtoon-canvas" || value === "canvas") return "webtoon";
  if (value === "tapas") return "tapas";
  return "generic";
}

function normalizeStatus(value: unknown): StudioReleaseStatus {
  if (STUDIO_RELEASE_STATUSES.includes(value as StudioReleaseStatus)) {
    return value as StudioReleaseStatus;
  }
  if (value === "in-review" || value === "needs-review") return "review";
  if (value === "planned") return "draft";
  if (value === "complete" || value === "completed") return "published";
  return "draft";
}

function canonicalizeTimeZone(value: string): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function normalizeItem(value: unknown): StudioReleaseScheduleItem | null {
  if (!isRecord(value)) return null;
  const idResult = IdSchema.safeParse(value.id ?? value.releaseId ?? value.episodeId);
  if (!idResult.success) return null;

  const rawTimeZone = normalizeText(
    value.timeZone ?? value.timezone ?? value.tz,
    STUDIO_RELEASE_SCHEDULE_MAX_TIME_ZONE_LENGTH
  );
  const timeZone = canonicalizeTimeZone(rawTimeZone) ?? rawTimeZone;
  const notes = normalizeText(
    value.notes ?? value.note ?? value.description,
    STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH
  );
  const item: StudioReleaseScheduleItem = {
    id: idResult.data,
    kind: normalizeKind(value.kind ?? value.type),
    title: normalizeText(
      value.title ?? value.name ?? value.episodeTitle,
      STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH
    ),
    destination: normalizeDestination(value.destination ?? value.platform),
    localDate: normalizeText(value.localDate ?? value.date ?? value.releaseDate, 10),
    localTime: normalizeText(value.localTime ?? value.time ?? value.releaseTime, 5),
    timeZone,
    status: normalizeStatus(value.status),
    ...(notes ? { notes } : {}),
  };
  return StudioReleaseScheduleItemSchema.parse(item);
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (
    typeof value.version === "number" &&
    value.version > STUDIO_RELEASE_SCHEDULE_VERSION
  ) {
    return [];
  }
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.releases)) return value.releases;
  if (Array.isArray(value.episodes)) return value.episodes;
  return [];
}

function parseLocalDate(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const verifier = new Date(Date.UTC(year, month - 1, day));
  if (
    verifier.getUTCFullYear() !== year ||
    verifier.getUTCMonth() !== month - 1 ||
    verifier.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseLocalTime(value: string): LocalTimeParts | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
}

function createZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function zonedParts(formatter: Intl.DateTimeFormat, utcMs: number): ZonedParts | null {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) values[part.type] = part.value;
  const result: ZonedParts = {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function sameZonedParts(left: ZonedParts, right: ZonedParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/**
 * Resolves an IANA-zone wall-clock value without relying on the host machine's local timezone.
 * During a DST overlap the earlier UTC instant is the deterministic default; callers may choose
 * the later instant or reject ambiguity. A DST gap is never shifted silently.
 */
export function resolveStudioReleaseUtc(
  input: Pick<StudioReleaseScheduleItem, "localDate" | "localTime" | "timeZone">,
  options: ResolveStudioReleaseUtcOptions = {}
): StudioReleaseUtcResolution {
  const date = parseLocalDate(input.localDate);
  if (!date) return { ok: false, reason: "invalid-local-date" };
  const time = parseLocalTime(input.localTime);
  if (!time) return { ok: false, reason: "invalid-local-time" };
  const canonicalTimeZone = canonicalizeTimeZone(input.timeZone);
  if (!canonicalTimeZone) return { ok: false, reason: "invalid-time-zone" };

  const target: ZonedParts = { ...date, ...time };
  const wallClockAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const formatter = createZonedFormatter(canonicalTimeZone);
  const offsets = new Set<number>();
  for (const sampleHours of [-48, -24, -12, 0, 12, 24, 48]) {
    const sampleUtc = wallClockAsUtc + sampleHours * 60 * 60 * 1_000;
    const sampleParts = zonedParts(formatter, sampleUtc);
    if (!sampleParts) continue;
    offsets.add(
      Date.UTC(
        sampleParts.year,
        sampleParts.month - 1,
        sampleParts.day,
        sampleParts.hour,
        sampleParts.minute
      ) - sampleUtc
    );
  }

  const candidateUtcMs = [...offsets]
    .map((offset) => wallClockAsUtc - offset)
    .filter((utcMs) => {
      const parts = zonedParts(formatter, utcMs);
      return parts ? sameZonedParts(parts, target) : false;
    })
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);

  if (candidateUtcMs.length === 0) return { ok: false, reason: "nonexistent-local-time" };
  if (candidateUtcMs.length > 1 && options.disambiguation === "reject") {
    return { ok: false, reason: "ambiguous-local-time" };
  }
  const utcMs = options.disambiguation === "later"
    ? candidateUtcMs[candidateUtcMs.length - 1]
    : candidateUtcMs[0];
  return {
    ok: true,
    utcMs,
    utcIso: new Date(utcMs).toISOString(),
    ambiguous: candidateUtcMs.length > 1,
    candidateUtcIso: candidateUtcMs.map((candidate) => new Date(candidate).toISOString()),
    canonicalTimeZone,
  };
}

export function createEmptyStudioReleaseSchedule(): StudioReleaseSchedule {
  return { version: STUDIO_RELEASE_SCHEDULE_VERSION, items: [] };
}

/**
 * Accepts the v1 container plus early array/items/entries/releases/episodes shapes. Invalid rows,
 * missing client IDs, and duplicate IDs are dropped. Future versions are not guessed or downgraded.
 */
export function normalizeStudioReleaseSchedule(value: unknown): StudioReleaseSchedule {
  let decoded = value;
  if (typeof value === "string") {
    if (TEXT_ENCODER.encode(value).length > STUDIO_RELEASE_SCHEDULE_MAX_SERIALIZED_BYTES) {
      return createEmptyStudioReleaseSchedule();
    }
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioReleaseSchedule();
    }
  }

  const ids = new Set<string>();
  const items: StudioReleaseScheduleItem[] = [];
  for (const candidate of extractItems(decoded).slice(0, STUDIO_RELEASE_SCHEDULE_MAX_IMPORT_CANDIDATES)) {
    const item = normalizeItem(candidate);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push(item);
    if (items.length >= STUDIO_RELEASE_SCHEDULE_MAX_ITEMS) break;
  }
  return { version: STUDIO_RELEASE_SCHEDULE_VERSION, items };
}

export function serializeStudioReleaseSchedule(value: StudioReleaseSchedule): string {
  const canonical = StudioReleaseScheduleSchema.parse(value);
  const serialized = JSON.stringify(canonical);
  if (TEXT_ENCODER.encode(serialized).length > STUDIO_RELEASE_SCHEDULE_MAX_SERIALIZED_BYTES) {
    throw new Error("릴리스 일정 데이터가 저장 가능한 크기를 초과했어요.");
  }
  return serialized;
}

export function addStudioReleaseScheduleItem(
  schedule: StudioReleaseSchedule,
  input: StudioReleaseScheduleItemInput
): StudioReleaseSchedule {
  if (schedule.items.length >= STUDIO_RELEASE_SCHEDULE_MAX_ITEMS) {
    throw new Error(`릴리스 일정은 최대 ${STUDIO_RELEASE_SCHEDULE_MAX_ITEMS}개까지 저장할 수 있어요.`);
  }
  const item = normalizeItem(input);
  if (!item) throw new Error("일정 ID는 클라이언트에서 발급한 유효한 문자열이어야 해요.");
  if (schedule.items.some(({ id }) => id === item.id)) {
    throw new Error("이미 사용 중인 일정 ID예요.");
  }
  return { ...schedule, items: [...schedule.items, item] };
}

export function updateStudioReleaseScheduleItem(
  schedule: StudioReleaseSchedule,
  itemId: string,
  patch: StudioReleaseScheduleItemPatch
): StudioReleaseSchedule {
  const index = schedule.items.findIndex(({ id }) => id === itemId);
  if (index < 0) return schedule;
  if (!isRecord(patch)) throw new Error("올바르지 않은 일정 수정 내용이에요.");
  for (const key of Object.keys(patch)) {
    if (!PATCH_FIELDS.has(key)) throw new Error(`수정할 수 없는 일정 필드예요: ${key}`);
  }
  const item = normalizeItem({ ...schedule.items[index], ...patch });
  if (!item) throw new Error("일정 수정 내용을 정규화하지 못했어요.");
  const items = schedule.items.slice();
  items[index] = item;
  return { ...schedule, items };
}

export function removeStudioReleaseScheduleItem(
  schedule: StudioReleaseSchedule,
  itemId: string
): StudioReleaseSchedule {
  const items = schedule.items.filter(({ id }) => id !== itemId);
  return items.length === schedule.items.length ? schedule : { ...schedule, items };
}

export function reorderStudioReleaseScheduleItem(
  schedule: StudioReleaseSchedule,
  itemId: string,
  toIndex: number
): StudioReleaseSchedule {
  const fromIndex = schedule.items.findIndex(({ id }) => id === itemId);
  if (fromIndex < 0 || !Number.isFinite(toIndex) || schedule.items.length < 2) return schedule;
  const targetIndex = Math.max(0, Math.min(schedule.items.length - 1, Math.trunc(toIndex)));
  if (fromIndex === targetIndex) return schedule;
  const items = schedule.items.slice();
  const [item] = items.splice(fromIndex, 1);
  items.splice(targetIndex, 0, item);
  return { ...schedule, items };
}

function missingOrInvalidIssues(
  item: StudioReleaseScheduleItem,
  resolution: StudioReleaseUtcResolution
): StudioReleaseValidationIssue[] {
  const missing: StudioReleaseValidationIssue[] = [];
  if (!item.localDate) {
    missing.push({
      code: "missing-local-date",
      severity: "error",
      message: "릴리스 날짜를 입력해 주세요.",
      itemId: item.id,
      field: "localDate",
    });
  }
  if (!item.localTime) {
    missing.push({
      code: "missing-local-time",
      severity: "error",
      message: "릴리스 시간을 입력해 주세요.",
      itemId: item.id,
      field: "localTime",
    });
  }
  if (!item.timeZone) {
    missing.push({
      code: "missing-time-zone",
      severity: "error",
      message: "IANA 시간대를 선택해 주세요.",
      itemId: item.id,
      field: "timeZone",
    });
  }
  if (missing.length > 0 || resolution.ok) return missing;
  const messages: Record<StudioReleaseUtcFailureReason, string> = {
    "invalid-local-date": "릴리스 날짜가 YYYY-MM-DD 형식의 실제 날짜가 아니에요.",
    "invalid-local-time": "릴리스 시간이 HH:mm 형식의 실제 시간이 아니에요.",
    "invalid-time-zone": "유효한 IANA 시간대를 선택해 주세요.",
    "nonexistent-local-time": "일광 절약 시간 전환으로 이 지역에 존재하지 않는 시각이에요.",
    "ambiguous-local-time": "일광 절약 시간 전환으로 두 번 존재하는 시각이에요.",
  };
  return [{
    code: resolution.reason,
    severity: "error",
    message: messages[resolution.reason],
    itemId: item.id,
    field: resolution.reason === "invalid-local-date"
      ? "localDate"
      : resolution.reason === "invalid-local-time" || resolution.reason === "nonexistent-local-time"
        ? "localTime"
        : "timeZone",
  }];
}

/**
 * Validates this local plan only. A `published` status is treated as the creator's own record; no
 * result from this function confirms or performs publication on WEBTOON, Tapas, or another service.
 */
export function validateStudioReleaseSchedule(
  value: unknown,
  options: ValidateStudioReleaseScheduleOptions = {}
): StudioReleaseValidationResult {
  const schedule = normalizeStudioReleaseSchedule(value);
  const nowMs = options.now?.getTime() ?? Date.now();
  const comparableNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const issues: StudioReleaseValidationIssue[] = [];
  const occupiedSlots = new Map<string, string>();

  for (const item of schedule.items) {
    if (!item.title) {
      issues.push({
        code: "missing-title",
        severity: "error",
        message: "회차 또는 마일스톤 제목을 입력해 주세요.",
        itemId: item.id,
        field: "title",
      });
    }

    const resolution = resolveStudioReleaseUtc(item);
    const temporalIssues = missingOrInvalidIssues(item, resolution);
    if (temporalIssues.length > 0) {
      issues.push(...temporalIssues);
      continue;
    }
    if (!resolution.ok) continue;

    if (resolution.ambiguous) {
      issues.push({
        code: "ambiguous-local-time",
        severity: "warning",
        message: "두 번 존재하는 현지 시각이라 앞선 UTC 시각을 사용해요. 시간대를 다시 확인해 주세요.",
        itemId: item.id,
        field: "timeZone",
      });
    }

    const slotKey = `${item.destination}:${resolution.utcMs}`;
    const occupiedBy = occupiedSlots.get(slotKey);
    if (occupiedBy) {
      issues.push({
        code: "duplicate-slot",
        severity: "error",
        message: "같은 목적지와 UTC 시각에 다른 일정이 이미 있어요.",
        itemId: item.id,
        relatedItemId: occupiedBy,
      });
    } else {
      occupiedSlots.set(slotKey, item.id);
    }

    if (item.status === "scheduled" && resolution.utcMs <= comparableNowMs) {
      issues.push({
        code: "scheduled-in-past",
        severity: "error",
        message: "예약 상태의 일정은 현재보다 미래 시각이어야 해요.",
        itemId: item.id,
        field: "status",
      });
    } else if (item.status === "published" && resolution.utcMs > comparableNowMs) {
      issues.push({
        code: "published-in-future",
        severity: "error",
        message: "미래 일정은 로컬 기록에서 게시 완료 상태로 표시할 수 없어요.",
        itemId: item.id,
        field: "status",
      });
    } else if (
      (item.status === "draft" || item.status === "review" || item.status === "ready") &&
      resolution.utcMs <= comparableNowMs
    ) {
      issues.push({
        code: "unfinished-in-past",
        severity: "warning",
        message: "예정 시각이 지났지만 아직 게시 완료 또는 예약 상태가 아니에요.",
        itemId: item.id,
        field: "status",
      });
    }
  }

  for (const destination of POLICY_DESTINATIONS) {
    const relevantItem = schedule.items.find(
      (item) =>
        item.destination === destination &&
        (item.status === "ready" || item.status === "scheduled")
    );
    if (!relevantItem) continue;
    const label = destination === "webtoon" ? "WEBTOON CANVAS" : "Tapas";
    issues.push({
      code: "destination-policy-review",
      severity: "warning",
      message: `${label} 정책은 변경될 수 있어요. 외부 게시 전에 공식 최신 정책을 직접 확인해 주세요.`,
      itemId: relevantItem.id,
      field: "destination",
      destination,
    });
  }

  const errorCount = issues.filter(({ severity }) => severity === "error").length;
  const warningCount = issues.length - errorCount;
  return { valid: errorCount === 0, errorCount, warningCount, issues };
}

function formatIcalendarUtc(utcMs: number): string {
  return new Date(utcMs).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function escapeIcalendarText(value: string): string {
  return stripUnsafeControlCharacters(value.replace(/\r\n?|\n/gu, "\n"))
    .replace(/\\/gu, "\\\\")
    .replace(/\n/gu, "\\n")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,");
}

function foldIcalendarLine(line: string): string[] {
  const folded: string[] = [];
  let current = "";
  for (const character of line) {
    if (TEXT_ENCODER.encode(current + character).length <= 75) {
      current += character;
      continue;
    }
    folded.push(current);
    current = ` ${character}`;
  }
  folded.push(current);
  return folded;
}

function opaqueStableItemId(item: StudioReleaseScheduleItem): string {
  const input = [item.id, item.destination, item.localDate, item.localTime, item.timeZone].join("\u001f");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function calendarStatus(status: StudioReleaseStatus): "TENTATIVE" | "CONFIRMED" {
  return status === "draft" || status === "review" ? "TENTATIVE" : "CONFIRMED";
}

/**
 * Builds an RFC 5545 calendar from an explicit allowlist of local scheduling fields. Invalid rows
 * are reported in `skippedItemIds`; notes are excluded unless the caller opts in. No network call,
 * credential, raw client ID, external publication URL, or hidden document field is exported.
 */
export function exportStudioReleaseScheduleIcalendar(
  value: unknown,
  options: StudioReleaseIcalendarOptions = {}
): StudioReleaseIcalendarExport {
  const schedule = normalizeStudioReleaseSchedule(value);
  const generatedAtMs = options.generatedAt?.getTime() ?? 0;
  if (!Number.isFinite(generatedAtMs)) throw new Error("캘린더 생성 시각이 올바르지 않아요.");
  const selectedStatuses = options.statuses
    ? new Set(options.statuses.filter((status) => STUDIO_RELEASE_STATUSES.includes(status)))
    : null;
  const calendarName = normalizeText(options.calendarName, 120) || "ToonSpectrum 릴리스 일정";
  const exportedItemIds: string[] = [];
  const skippedItemIds: string[] = [];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ToonSpectrum//Studio Release Schedule 1.0//KO",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcalendarText(calendarName)}`,
  ];

  for (const item of schedule.items) {
    if (selectedStatuses && !selectedStatuses.has(item.status)) continue;
    const resolution = resolveStudioReleaseUtc(item, { disambiguation: options.disambiguation });
    if (!item.title || !resolution.ok) {
      skippedItemIds.push(item.id);
      continue;
    }
    const description = [
      STUDIO_RELEASE_LOCAL_ONLY_NOTICE,
      `종류: ${item.kind}`,
      `목적지: ${item.destination}`,
      `로컬 상태: ${item.status}`,
      ...(options.includeNotes && item.notes ? [`메모: ${item.notes}`] : []),
    ].join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:ts-${opaqueStableItemId(item)}@local.toonspectrum`,
      `DTSTAMP:${formatIcalendarUtc(generatedAtMs)}`,
      `DTSTART:${formatIcalendarUtc(resolution.utcMs)}`,
      "DURATION:PT30M",
      `SUMMARY:${escapeIcalendarText(item.title)}`,
      `DESCRIPTION:${escapeIcalendarText(description)}`,
      `CATEGORIES:${item.kind.toUpperCase()},${item.destination.toUpperCase()}`,
      `STATUS:${calendarStatus(item.status)}`,
      "CLASS:PRIVATE",
      "TRANSP:TRANSPARENT",
      `X-TOONSPECTRUM-DESTINATION:${item.destination.toUpperCase()}`,
      `X-TOONSPECTRUM-LOCAL-STATUS:${item.status.toUpperCase()}`,
      "END:VEVENT"
    );
    exportedItemIds.push(item.id);
  }
  lines.push("END:VCALENDAR");

  const content = `${lines.flatMap(foldIcalendarLine).join("\r\n")}\r\n`;
  if (TEXT_ENCODER.encode(content).length > STUDIO_RELEASE_SCHEDULE_MAX_ICALENDAR_BYTES) {
    throw new Error("iCalendar 파일이 내보낼 수 있는 크기를 초과했어요.");
  }
  return {
    content,
    filename: "toonspectrum-release-schedule.ics",
    mimeType: "text/calendar;charset=utf-8",
    eventCount: exportedItemIds.length,
    exportedItemIds,
    skippedItemIds,
    validation: validateStudioReleaseSchedule(schedule, { now: options.generatedAt }),
  };
}

/** Codes that make an item's wall-clock value unsafe to export without user correction. */
export function isStudioReleaseTemporalError(issue: StudioReleaseValidationIssue): boolean {
  return issue.severity === "error" && TEMPORAL_FAILURE_CODES.has(issue.code);
}
