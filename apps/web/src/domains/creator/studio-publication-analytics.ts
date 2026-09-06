/**
 * Local-only publication analytics import and comparison helpers.
 *
 * WEBTOON and Tapas are represented as destinations because creators commonly compare those
 * channels. This module does not call, scrape, or imply access to either platform's analytics API.
 * Every value comes from a CSV string or manual record supplied by the caller, and no telemetry is
 * emitted. Aggregates treat each accepted row as one reported observation; they do not infer
 * platform-specific metric semantics or causation.
 */

export const STUDIO_PUBLICATION_ANALYTICS_VERSION = 1 as const;

export const STUDIO_PUBLICATION_ANALYTICS_LIMITS = {
  maxCsvCodeUnits: 2_000_000,
  maxRecords: 10_000,
  maxCsvRows: 10_001,
  maxCsvColumns: 64,
  maxCsvFieldCodeUnits: 4_000,
  maxIdentityCodeUnits: 300,
  maxSourceLabelCodeUnits: 160,
  maxDiagnostics: 500,
  maxCountMetric: 1_000_000_000,
  maxRevenue: 1_000_000_000,
} as const;

export type StudioPublicationAnalyticsDestination = "webtoon" | "tapas" | "other";
export type StudioPublicationAnalyticsSourceKind = "csv" | "manual";
export type StudioPublicationAnalyticsDiagnosticSeverity = "error" | "warning";
export type StudioPublicationAnalyticsMetricField =
  | "views"
  | "likes"
  | "comments"
  | "subscribersGained";

export type StudioPublicationAnalyticsDiagnosticCode =
  | "CSV_EMPTY"
  | "CSV_TOO_LARGE"
  | "CSV_TOO_MANY_ROWS"
  | "CSV_TOO_MANY_COLUMNS"
  | "CSV_FIELD_TOO_LONG"
  | "CSV_MALFORMED_QUOTE"
  | "CSV_UNCLOSED_QUOTE"
  | "CSV_COLUMN_COUNT_MISMATCH"
  | "EMPTY_HEADER"
  | "UNKNOWN_HEADER"
  | "DUPLICATE_HEADER"
  | "MISSING_REQUIRED_HEADER"
  | "MISSING_IDENTITY_HEADER"
  | "INVALID_ROW"
  | "MISSING_REQUIRED_VALUE"
  | "INVALID_DESTINATION"
  | "INVALID_DATE"
  | "INVALID_NUMBER"
  | "NEGATIVE_NUMBER"
  | "NUMBER_TOO_LARGE"
  | "INVALID_CURRENCY"
  | "REVENUE_CURRENCY_REQUIRED"
  | "CURRENCY_WITHOUT_REVENUE"
  | "DUPLICATE_ROW"
  | "FORMULA_NEUTRALIZED"
  | "TEXT_TRUNCATED"
  | "RECORD_LIMIT_REACHED";

export type StudioPublicationAnalyticsField =
  | "destination"
  | "source"
  | "date"
  | "episode"
  | "title"
  | StudioPublicationAnalyticsMetricField
  | "revenue"
  | "currency";

export interface StudioPublicationAnalyticsDiagnostic {
  severity: StudioPublicationAnalyticsDiagnosticSeverity;
  code: StudioPublicationAnalyticsDiagnosticCode;
  message: string;
  /** One-based logical CSV record/manual entry number. CSV header is row 1. */
  row?: number;
  /** Canonical field name; raw imported values are intentionally never echoed. */
  field?: StudioPublicationAnalyticsField;
}

export interface StudioPublicationAnalyticsSource {
  kind: StudioPublicationAnalyticsSourceKind;
  label: string;
}

export interface StudioPublicationAnalyticsRecord {
  /** Deterministic ID derived from destination, date, episode, and title. */
  id: string;
  destination: StudioPublicationAnalyticsDestination;
  source: StudioPublicationAnalyticsSource;
  /** Strict calendar date in YYYY-MM-DD form. */
  date: string;
  /** At least one of episode and title is non-empty. */
  episode: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  subscribersGained: number;
  /** Revenue is never combined across currencies. */
  revenue: number | null;
  currency: string | null;
}

export interface StudioPublicationAnalyticsDocument {
  version: typeof STUDIO_PUBLICATION_ANALYTICS_VERSION;
  records: StudioPublicationAnalyticsRecord[];
}

export interface StudioPublicationAnalyticsCsvImportOptions {
  /** Used only when a destination column is absent or blank. */
  destination?: StudioPublicationAnalyticsDestination;
  /** Local provenance label such as an export filename; never transmitted by this module. */
  sourceLabel?: string;
  /** Used only for non-empty revenue rows whose currency column is absent or blank. */
  defaultCurrency?: string;
}

export interface StudioPublicationAnalyticsManualImportOptions {
  destination?: StudioPublicationAnalyticsDestination;
  sourceLabel?: string;
  defaultCurrency?: string;
}

export interface StudioPublicationAnalyticsImportResult {
  basis: "user-supplied-local-data";
  remoteTelemetryUsed: false;
  records: readonly StudioPublicationAnalyticsRecord[];
  diagnostics: readonly StudioPublicationAnalyticsDiagnostic[];
  inputRowCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  formulaNeutralizedCount: number;
  limitsApplied: boolean;
  diagnosticsTruncated: boolean;
}

export interface StudioPublicationAnalyticsMergeResult {
  document: StudioPublicationAnalyticsDocument;
  diagnostics: readonly StudioPublicationAnalyticsDiagnostic[];
  addedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  limitsApplied: boolean;
  diagnosticsTruncated: boolean;
}

export interface StudioPublicationAnalyticsTotals {
  views: number;
  likes: number;
  comments: number;
  subscribersGained: number;
}

export interface StudioPublicationAnalyticsRevenueTotal {
  currency: string;
  total: number;
  recordCount: number;
}

export interface StudioPublicationAnalyticsRates {
  likeRatePercent: number;
  commentRatePercent: number;
  interactionRatePercent: number;
  subscribersPerThousandViews: number;
}

export interface StudioPublicationAnalyticsSummary {
  recordCount: number;
  episodeCount: number;
  dateRange: { from: string; to: string } | null;
  totals: StudioPublicationAnalyticsTotals;
  rates: StudioPublicationAnalyticsRates;
  revenue: readonly StudioPublicationAnalyticsRevenueTotal[];
}

export interface StudioPublicationAnalyticsTimelinePoint {
  date: string;
  recordCount: number;
  totals: StudioPublicationAnalyticsTotals;
  revenue: readonly StudioPublicationAnalyticsRevenueTotal[];
}

export type StudioPublicationAnalyticsDeltaDirection = "up" | "down" | "flat" | "new";

export interface StudioPublicationAnalyticsDelta {
  baseline: number;
  current: number;
  absolute: number;
  /** Null means a percentage is undefined because the baseline is zero. */
  percentChange: number | null;
  direction: StudioPublicationAnalyticsDeltaDirection;
}

export type StudioPublicationAnalyticsMetricDeltas = Record<
  StudioPublicationAnalyticsMetricField,
  StudioPublicationAnalyticsDelta
>;

export interface StudioPublicationAnalyticsRevenueDelta
  extends StudioPublicationAnalyticsDelta {
  currency: string;
}

export interface StudioPublicationAnalyticsTrend {
  fromDate: string;
  toDate: string;
  metrics: StudioPublicationAnalyticsMetricDeltas;
  revenue: readonly StudioPublicationAnalyticsRevenueDelta[];
}

export interface StudioPublicationAnalyticsDestinationSummary
  extends StudioPublicationAnalyticsSummary {
  destination: StudioPublicationAnalyticsDestination;
}

export interface StudioPublicationAnalyticsInsights {
  basis: "user-supplied-local-data";
  remoteTelemetryUsed: false;
  summary: StudioPublicationAnalyticsSummary;
  timeline: readonly StudioPublicationAnalyticsTimelinePoint[];
  byDestination: readonly StudioPublicationAnalyticsDestinationSummary[];
  /** Null until observations cover at least two distinct dates. */
  trend: StudioPublicationAnalyticsTrend | null;
}

export interface StudioPublicationAnalyticsRateDeltas {
  likeRatePercentagePoints: number;
  commentRatePercentagePoints: number;
  interactionRatePercentagePoints: number;
  subscribersPerThousandViews: number;
}

export interface StudioPublicationAnalyticsDestinationComparison {
  destination: StudioPublicationAnalyticsDestination;
  recordCount: StudioPublicationAnalyticsDelta;
  metrics: StudioPublicationAnalyticsMetricDeltas;
  rates: StudioPublicationAnalyticsRateDeltas;
  revenue: readonly StudioPublicationAnalyticsRevenueDelta[];
}

export interface StudioPublicationAnalyticsComparison {
  basis: "user-supplied-local-data";
  remoteTelemetryUsed: false;
  baseline: StudioPublicationAnalyticsSummary;
  current: StudioPublicationAnalyticsSummary;
  recordCount: StudioPublicationAnalyticsDelta;
  metrics: StudioPublicationAnalyticsMetricDeltas;
  rates: StudioPublicationAnalyticsRateDeltas;
  revenue: readonly StudioPublicationAnalyticsRevenueDelta[];
  byDestination: readonly StudioPublicationAnalyticsDestinationComparison[];
}

type CsvCanonicalHeader = StudioPublicationAnalyticsField;

/**
 * Deliberately small, generic aliases. They are conveniences for user-supplied exports, not a
 * promise that any current WEBTOON or Tapas export schema uses these exact headers.
 */
export const STUDIO_PUBLICATION_ANALYTICS_CSV_HEADER_ALIASES: Readonly<
  Record<CsvCanonicalHeader, readonly string[]>
> = {
  destination: ["destination", "platform", "게시처", "플랫폼"],
  source: ["source", "data_source", "출처", "데이터_출처"],
  date: ["date", "publish_date", "published_date", "날짜", "게시일"],
  episode: ["episode", "episode_number", "episode_no", "회차", "에피소드"],
  title: ["title", "episode_title", "episode_name", "제목", "에피소드_제목"],
  views: ["views", "view_count", "조회수"],
  likes: ["likes", "like_count", "좋아요"],
  comments: ["comments", "comment_count", "댓글", "댓글수"],
  subscribersGained: [
    "subscribers_gained",
    "subscriber_gain",
    "new_subscribers",
    "구독자_증가",
    "신규_구독자",
  ],
  revenue: ["revenue", "earnings", "수익"],
  currency: ["currency", "currency_code", "통화", "통화_코드"],
};

const DESTINATION_ORDER: readonly StudioPublicationAnalyticsDestination[] = [
  "webtoon",
  "tapas",
  "other",
];
const REQUIRED_CSV_HEADERS: readonly CsvCanonicalHeader[] = [
  "date",
  "views",
  "likes",
  "comments",
  "subscribersGained",
];

interface DiagnosticState {
  diagnostics: StudioPublicationAnalyticsDiagnostic[];
  totalDiagnosticCount: number;
  errorCount: number;
  formulaNeutralizedCount: number;
  limitsApplied: boolean;
}

interface ParsedCsvRow {
  fields: string[];
  logicalRow: number;
  columnCount: number;
  invalid: boolean;
}

interface ParsedCsv {
  rows: ParsedCsvRow[];
  fatal: boolean;
}

interface RecordDefaults {
  destination?: unknown;
  sourceLabel?: unknown;
  defaultCurrency?: unknown;
  forcedSourceKind?: StudioPublicationAnalyticsSourceKind;
  fallbackSourceKind: StudioPublicationAnalyticsSourceKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDiagnosticState(): DiagnosticState {
  return {
    diagnostics: [],
    totalDiagnosticCount: 0,
    errorCount: 0,
    formulaNeutralizedCount: 0,
    limitsApplied: false,
  };
}

function addDiagnostic(
  state: DiagnosticState,
  severity: StudioPublicationAnalyticsDiagnosticSeverity,
  code: StudioPublicationAnalyticsDiagnosticCode,
  message: string,
  row?: number,
  field?: StudioPublicationAnalyticsField
): void {
  state.totalDiagnosticCount += 1;
  if (severity === "error") state.errorCount += 1;
  if (code === "FORMULA_NEUTRALIZED") state.formulaNeutralizedCount += 1;
  if (state.diagnostics.length >= STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxDiagnostics) return;
  const diagnostic: StudioPublicationAnalyticsDiagnostic = { severity, code, message };
  if (row !== undefined) diagnostic.row = row;
  if (field !== undefined) diagnostic.field = field;
  state.diagnostics.push(diagnostic);
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
}

const HEADER_LOOKUP = new Map<string, CsvCanonicalHeader>();
for (const [field, aliases] of Object.entries(
  STUDIO_PUBLICATION_ANALYTICS_CSV_HEADER_ALIASES
) as Array<[CsvCanonicalHeader, readonly string[]]>) {
  for (const alias of aliases) HEADER_LOOKUP.set(normalizeHeader(alias), field);
}

function appendBoundedCsvCharacter(
  character: string,
  current: { value: string; truncated: boolean },
  state: DiagnosticState,
  row: number
): void {
  if (current.value.length < STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvFieldCodeUnits) {
    current.value += character;
    return;
  }
  if (current.truncated) return;
  current.truncated = true;
  state.limitsApplied = true;
  addDiagnostic(
    state,
    "error",
    "CSV_FIELD_TOO_LONG",
    "CSV 필드가 허용 길이를 넘어 해당 행을 제외했어요.",
    row
  );
}

function parseCsv(csv: string, state: DiagnosticState): ParsedCsv {
  if (csv.length > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits) {
    state.limitsApplied = true;
    addDiagnostic(
      state,
      "error",
      "CSV_TOO_LARGE",
      "CSV가 로컬 가져오기 허용 크기를 넘었어요. 파일을 나눠서 가져오세요."
    );
    return { rows: [], fatal: true };
  }
  if (!csv.trim()) {
    addDiagnostic(state, "error", "CSV_EMPTY", "CSV에 가져올 내용이 없어요.");
    return { rows: [], fatal: true };
  }

  const rows: ParsedCsvRow[] = [];
  let rowFields: string[] = [];
  let columnCount = 0;
  let rowInvalid = false;
  let tooManyColumnsReported = false;
  let field = { value: "", truncated: false };
  let inQuotes = false;
  let justClosedQuote = false;
  let stoppedForRowLimit = false;

  const currentLogicalRow = () => rows.length + 1;
  const finishField = () => {
    columnCount += 1;
    if (columnCount <= STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvColumns) {
      rowFields.push(field.value);
    } else {
      rowInvalid = true;
      if (!tooManyColumnsReported) {
        tooManyColumnsReported = true;
        state.limitsApplied = true;
        addDiagnostic(
          state,
          "error",
          "CSV_TOO_MANY_COLUMNS",
          "CSV 행의 열 수가 허용 한도를 넘었어요.",
          currentLogicalRow()
        );
      }
    }
    if (field.truncated) rowInvalid = true;
    field = { value: "", truncated: false };
    justClosedQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (rows.length >= STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvRows) {
      if (!stoppedForRowLimit) {
        stoppedForRowLimit = true;
        state.limitsApplied = true;
        addDiagnostic(
          state,
          "error",
          "CSV_TOO_MANY_ROWS",
          "CSV 행 수가 허용 한도를 넘어 나머지 행을 처리하지 않았어요."
        );
      }
      return false;
    }
    rows.push({
      fields: rowFields,
      logicalRow: rows.length + 1,
      columnCount,
      invalid: rowInvalid,
    });
    rowFields = [];
    columnCount = 0;
    rowInvalid = false;
    tooManyColumnsReported = false;
    return true;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] ?? "";
    const next = csv[index + 1];

    if (inQuotes) {
      if (character === '"') {
        if (next === '"') {
          appendBoundedCsvCharacter('"', field, state, currentLogicalRow());
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else if (character === "\r" || character === "\n") {
        appendBoundedCsvCharacter("\n", field, state, currentLogicalRow());
        if (character === "\r" && next === "\n") index += 1;
      } else {
        appendBoundedCsvCharacter(character, field, state, currentLogicalRow());
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === ",") {
        finishField();
        continue;
      }
      if (character === "\r" || character === "\n") {
        if (!finishRow()) break;
        if (character === "\r" && next === "\n") index += 1;
        continue;
      }
      if (character === " " || character === "\t") continue;
      rowInvalid = true;
      addDiagnostic(
        state,
        "error",
        "CSV_MALFORMED_QUOTE",
        "닫는 따옴표 뒤에 구분자 없이 문자가 이어져 해당 행을 제외했어요.",
        currentLogicalRow()
      );
      justClosedQuote = false;
      appendBoundedCsvCharacter(character, field, state, currentLogicalRow());
      continue;
    }

    if (character === '"') {
      if (field.value.length === 0) {
        inQuotes = true;
      } else {
        rowInvalid = true;
        addDiagnostic(
          state,
          "error",
          "CSV_MALFORMED_QUOTE",
          "따옴표가 필드 중간에 있어 해당 행을 제외했어요.",
          currentLogicalRow()
        );
        appendBoundedCsvCharacter(character, field, state, currentLogicalRow());
      }
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (!finishRow()) break;
      if (character === "\r" && next === "\n") index += 1;
    } else {
      appendBoundedCsvCharacter(character, field, state, currentLogicalRow());
    }
  }

  if (inQuotes) {
    rowInvalid = true;
    addDiagnostic(
      state,
      "error",
      "CSV_UNCLOSED_QUOTE",
      "닫히지 않은 따옴표가 있어 마지막 행을 제외했어요.",
      currentLogicalRow()
    );
  }

  const hasPendingRow =
    rowFields.length > 0 || field.value.length > 0 || field.truncated || justClosedQuote || inQuotes;
  if (!stoppedForRowLimit && hasPendingRow) finishRow();
  return { rows, fatal: rows.length === 0 };
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return record[key];
  }
  return undefined;
}

function replaceUnsafeControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const unsafe =
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127;
    result += unsafe ? " " : character;
  }
  return result;
}

function normalizeSafeText(
  value: unknown,
  maxLength: number,
  state: DiagnosticState,
  row: number,
  field: "episode" | "title" | "source",
  acceptNumber = false
): string {
  let text = typeof value === "string" ? value : "";
  if (acceptNumber && typeof value === "number" && Number.isFinite(value)) text = String(value);
  text = replaceUnsafeControlCharacters(text.normalize("NFKC")).trim().replace(/\s+/gu, " ");
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
    state.limitsApplied = true;
    addDiagnostic(
      state,
      "warning",
      "TEXT_TRUNCATED",
      "텍스트가 허용 길이를 넘어 안전하게 잘랐어요.",
      row,
      field
    );
  }
  if (/^[=+\-@]/u.test(text)) {
    text = `'${text.slice(0, Math.max(0, maxLength - 1))}`;
    addDiagnostic(
      state,
      "warning",
      "FORMULA_NEUTRALIZED",
      "스프레드시트 수식으로 해석될 수 있는 텍스트를 리터럴로 보관했어요.",
      row,
      field
    );
  }
  return text;
}

function normalizeDestination(value: unknown): StudioPublicationAnalyticsDestination | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (["webtoon", "webtoon canvas", "웹툰", "네이버 웹툰"].includes(normalized)) {
    return "webtoon";
  }
  if (["tapas", "타파스"].includes(normalized)) return "tapas";
  if (["other", "기타"].includes(normalized)) return "other";
  return null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysByMonth[month - 1] ?? 0) ? normalized : null;
}

function normalizedNumericString(value: string, allowDecimal: boolean): string | null {
  const trimmed = value.trim();
  const integerPattern = /^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/u;
  const decimalPattern = /^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,12})?$/u;
  if (!(allowDecimal ? decimalPattern : integerPattern).test(trimmed)) return null;
  return trimmed.replace(/,/gu, "");
}

function normalizeNumber(
  value: unknown,
  field: StudioPublicationAnalyticsMetricField | "revenue",
  state: DiagnosticState,
  row: number,
  optional: boolean
): number | null {
  const missing = value === null || value === undefined || (typeof value === "string" && !value.trim());
  if (missing) {
    if (!optional) {
      addDiagnostic(
        state,
        "error",
        "MISSING_REQUIRED_VALUE",
        "필수 지표 값이 비어 있어 해당 행을 제외했어요.",
        row,
        field
      );
    }
    return null;
  }

  let numberValue: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    numberValue = value;
  } else if (typeof value === "string") {
    const parsed = normalizedNumericString(value, field === "revenue");
    if (parsed !== null) numberValue = Number(parsed);
  }
  if (numberValue === null || !Number.isFinite(numberValue)) {
    addDiagnostic(
      state,
      "error",
      "INVALID_NUMBER",
      "숫자 형식이 아니어서 해당 행을 제외했어요. 수식과 지수 표기는 허용하지 않아요.",
      row,
      field
    );
    return null;
  }
  if (numberValue < 0) {
    addDiagnostic(
      state,
      "error",
      "NEGATIVE_NUMBER",
      "음수 지표는 허용하지 않아 해당 행을 제외했어요.",
      row,
      field
    );
    return null;
  }
  if (field !== "revenue" && !Number.isInteger(numberValue)) {
    addDiagnostic(
      state,
      "error",
      "INVALID_NUMBER",
      "조회·반응·구독자 지표는 정수여야 해요.",
      row,
      field
    );
    return null;
  }
  const maximum = field === "revenue"
    ? STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRevenue
    : STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCountMetric;
  if (numberValue > maximum) {
    state.limitsApplied = true;
    addDiagnostic(
      state,
      "error",
      "NUMBER_TOO_LARGE",
      "지표가 허용 범위를 넘어 해당 행을 제외했어요.",
      row,
      field
    );
    return null;
  }
  return field === "revenue" ? round(numberValue, 6) : numberValue;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(normalized) ? normalized : null;
}

function sourceKindFromValue(
  value: unknown,
  fallback: StudioPublicationAnalyticsSourceKind
): StudioPublicationAnalyticsSourceKind {
  if (value === "csv" || value === "manual") return value;
  return fallback;
}

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(36);
}

function recordIdentityKey(record: Pick<
  StudioPublicationAnalyticsRecord,
  "destination" | "date" | "episode" | "title"
>): string {
  return [record.destination, record.date, record.episode.toLowerCase(), record.title.toLowerCase()]
    .join("\u0000");
}

function deterministicRecordId(identityKey: string): string {
  return `publication-${stableHash(identityKey, 2_166_136_261)}-${stableHash(
    identityKey,
    3_747_613_931
  )}`;
}

function normalizeRecord(
  value: unknown,
  defaults: RecordDefaults,
  state: DiagnosticState,
  row: number
): StudioPublicationAnalyticsRecord | null {
  const errorsBefore = state.errorCount;
  if (!isRecord(value)) {
    addDiagnostic(state, "error", "INVALID_ROW", "객체가 아닌 행을 제외했어요.", row);
    return null;
  }

  const sourceRecord = isRecord(value.source) ? value.source : null;
  const destinationRaw = firstDefined(value, ["destination", "platform"]);
  const destinationValue =
    destinationRaw === null ||
    destinationRaw === undefined ||
    (typeof destinationRaw === "string" && !destinationRaw.trim())
      ? defaults.destination
      : destinationRaw;
  const destination = normalizeDestination(destinationValue);
  if (!destination) {
    addDiagnostic(
      state,
      "error",
      "INVALID_DESTINATION",
      "게시처는 WEBTOON, Tapas 또는 기타 중 하나여야 해요.",
      row,
      "destination"
    );
  }

  const date = normalizeDate(
    firstDefined(value, ["date", "publishDate", "publishedDate", "publishedAt"])
  );
  if (!date) {
    addDiagnostic(
      state,
      "error",
      "INVALID_DATE",
      "날짜는 실제 달력의 YYYY-MM-DD 형식이어야 해요.",
      row,
      "date"
    );
  }

  const episode = normalizeSafeText(
    firstDefined(value, ["episode", "episodeNumber", "episodeNo"]),
    STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxIdentityCodeUnits,
    state,
    row,
    "episode",
    true
  );
  const title = normalizeSafeText(
    firstDefined(value, ["title", "episodeTitle", "episodeName"]),
    STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxIdentityCodeUnits,
    state,
    row,
    "title"
  );
  if (!episode && !title) {
    addDiagnostic(
      state,
      "error",
      "MISSING_REQUIRED_VALUE",
      "회차 또는 제목 중 하나는 필요해요.",
      row,
      "episode"
    );
  }

  const views = normalizeNumber(
    firstDefined(value, ["views", "viewCount"]),
    "views",
    state,
    row,
    false
  );
  const likes = normalizeNumber(
    firstDefined(value, ["likes", "likeCount"]),
    "likes",
    state,
    row,
    false
  );
  const comments = normalizeNumber(
    firstDefined(value, ["comments", "commentCount"]),
    "comments",
    state,
    row,
    false
  );
  const subscribersGained = normalizeNumber(
    firstDefined(value, ["subscribersGained", "subscriberGain", "newSubscribers"]),
    "subscribersGained",
    state,
    row,
    false
  );
  const revenueRaw = firstDefined(value, ["revenue", "earnings"]);
  const revenue = normalizeNumber(revenueRaw, "revenue", state, row, true);
  const currencyRaw = firstDefined(value, ["currency", "currencyCode"]);
  const hasCurrencyRaw =
    currencyRaw !== null &&
    currencyRaw !== undefined &&
    !(typeof currencyRaw === "string" && !currencyRaw.trim());
  const currencyValue = hasCurrencyRaw ? currencyRaw : defaults.defaultCurrency;
  const currency = normalizeCurrency(currencyValue);
  if (hasCurrencyRaw && !normalizeCurrency(currencyRaw)) {
    addDiagnostic(
      state,
      "error",
      "INVALID_CURRENCY",
      "통화 코드는 USD·KRW처럼 영문 3자리여야 해요.",
      row,
      "currency"
    );
  }
  if (revenue !== null && !currency) {
    addDiagnostic(
      state,
      "error",
      "REVENUE_CURRENCY_REQUIRED",
      "수익 값이 있으면 통화 코드가 필요해요.",
      row,
      "currency"
    );
  }
  if (revenue === null && currency && state.errorCount === errorsBefore) {
    addDiagnostic(
      state,
      "warning",
      "CURRENCY_WITHOUT_REVENUE",
      "수익 값이 없어 통화 코드만 있는 값은 보관하지 않았어요.",
      row,
      "currency"
    );
  }

  const sourceKindValue = sourceRecord?.kind ?? (typeof value.source === "string" ? value.source : null);
  const sourceKind = defaults.forcedSourceKind ?? sourceKindFromValue(
    sourceKindValue,
    defaults.fallbackSourceKind
  );
  const rawSourceLabel =
    firstDefined(value, ["sourceLabel", "dataSource"]) ??
    sourceRecord?.label ??
    (typeof value.source === "string" && value.source !== "csv" && value.source !== "manual"
      ? value.source
      : defaults.sourceLabel);
  const sourceLabel = normalizeSafeText(
    rawSourceLabel ?? (sourceKind === "csv" ? "로컬 CSV" : "수동 입력"),
    STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxSourceLabelCodeUnits,
    state,
    row,
    "source"
  ) || (sourceKind === "csv" ? "로컬 CSV" : "수동 입력");

  if (
    state.errorCount > errorsBefore ||
    !destination ||
    !date ||
    views === null ||
    likes === null ||
    comments === null ||
    subscribersGained === null
  ) {
    return null;
  }

  const identity = { destination, date, episode, title };
  const identityKey = recordIdentityKey(identity);
  return {
    id: deterministicRecordId(identityKey),
    ...identity,
    source: { kind: sourceKind, label: sourceLabel },
    views,
    likes,
    comments,
    subscribersGained,
    revenue,
    currency: revenue === null ? null : currency,
  };
}

function isBlankCsvRow(row: ParsedCsvRow): boolean {
  return row.fields.every((field) => !field.trim());
}

function makeImportResult(
  records: readonly StudioPublicationAnalyticsRecord[],
  state: DiagnosticState,
  inputRowCount: number,
  duplicateCount: number
): StudioPublicationAnalyticsImportResult {
  return {
    basis: "user-supplied-local-data",
    remoteTelemetryUsed: false,
    records,
    diagnostics: state.diagnostics,
    inputRowCount,
    acceptedCount: records.length,
    rejectedCount: Math.max(0, inputRowCount - records.length),
    duplicateCount,
    formulaNeutralizedCount: state.formulaNeutralizedCount,
    limitsApplied: state.limitsApplied,
    diagnosticsTruncated:
      state.totalDiagnosticCount > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxDiagnostics,
  };
}

/** Parses a comma-delimited CSV locally. Quoted commas, escaped quotes, CRLF, and quoted newlines work. */
export function importStudioPublicationAnalyticsCsv(
  csv: string,
  options: StudioPublicationAnalyticsCsvImportOptions = {}
): StudioPublicationAnalyticsImportResult {
  const state = createDiagnosticState();
  if (typeof csv !== "string") {
    addDiagnostic(state, "error", "CSV_EMPTY", "CSV 텍스트가 필요해요.");
    return makeImportResult([], state, 0, 0);
  }
  const parsed = parseCsv(csv, state);
  if (parsed.fatal || parsed.rows.length === 0) return makeImportResult([], state, 0, 0);

  const header = parsed.rows[0];
  if (!header || header.invalid || isBlankCsvRow(header)) {
    if (header && isBlankCsvRow(header)) {
      addDiagnostic(state, "error", "CSV_EMPTY", "CSV 헤더가 비어 있어요.", 1);
    }
    return makeImportResult([], state, Math.max(0, parsed.rows.length - 1), 0);
  }

  const headerIndexes = new Map<CsvCanonicalHeader, number>();
  let headerFatal = false;
  for (let index = 0; index < header.fields.length; index += 1) {
    const normalized = normalizeHeader(header.fields[index] ?? "");
    if (!normalized) {
      addDiagnostic(state, "warning", "EMPTY_HEADER", "이름이 빈 열을 무시했어요.", 1);
      continue;
    }
    const canonical = HEADER_LOOKUP.get(normalized);
    if (!canonical) {
      addDiagnostic(
        state,
        "warning",
        "UNKNOWN_HEADER",
        "지원 목록에 없는 열을 무시했어요.",
        1
      );
      continue;
    }
    if (headerIndexes.has(canonical)) {
      headerFatal = true;
      addDiagnostic(
        state,
        "error",
        "DUPLICATE_HEADER",
        "같은 지표로 해석되는 헤더가 중복되어 가져오기를 중단했어요.",
        1,
        canonical
      );
      continue;
    }
    headerIndexes.set(canonical, index);
  }

  for (const required of REQUIRED_CSV_HEADERS) {
    if (headerIndexes.has(required)) continue;
    headerFatal = true;
    addDiagnostic(
      state,
      "error",
      "MISSING_REQUIRED_HEADER",
      "필수 분석 지표 헤더가 없어요.",
      1,
      required
    );
  }
  if (!headerIndexes.has("episode") && !headerIndexes.has("title")) {
    headerFatal = true;
    addDiagnostic(
      state,
      "error",
      "MISSING_IDENTITY_HEADER",
      "회차 또는 제목 헤더 중 하나가 필요해요.",
      1,
      "episode"
    );
  }
  if (!headerIndexes.has("destination") && !normalizeDestination(options.destination)) {
    headerFatal = true;
    addDiagnostic(
      state,
      "error",
      "MISSING_REQUIRED_HEADER",
      "게시처 헤더가 없으면 가져오기 옵션에서 게시처를 선택해야 해요.",
      1,
      "destination"
    );
  }

  const dataRows = parsed.rows.slice(1).filter((row) => !isBlankCsvRow(row));
  if (headerFatal) return makeImportResult([], state, dataRows.length, 0);

  const records: StudioPublicationAnalyticsRecord[] = [];
  const identities = new Set<string>();
  let duplicateCount = 0;
  for (const row of dataRows) {
    if (row.invalid || row.columnCount !== header.columnCount) {
      if (row.columnCount !== header.columnCount) {
        addDiagnostic(
          state,
          "error",
          "CSV_COLUMN_COUNT_MISMATCH",
          "헤더와 열 수가 다른 행을 제외했어요.",
          row.logicalRow
        );
      }
      continue;
    }
    const candidate: Record<string, unknown> = {};
    for (const [canonical, index] of headerIndexes) candidate[canonical] = row.fields[index] ?? "";
    const normalized = normalizeRecord(
      candidate,
      {
        destination: options.destination,
        sourceLabel: options.sourceLabel,
        defaultCurrency: options.defaultCurrency,
        forcedSourceKind: "csv",
        fallbackSourceKind: "csv",
      },
      state,
      row.logicalRow
    );
    if (!normalized) continue;
    const identityKey = recordIdentityKey(normalized);
    if (identities.has(identityKey)) {
      duplicateCount += 1;
      addDiagnostic(
        state,
        "warning",
        "DUPLICATE_ROW",
        "같은 게시처·날짜·회차·제목의 중복 행을 제외했어요.",
        row.logicalRow
      );
      continue;
    }
    identities.add(identityKey);
    records.push(normalized);
  }
  return makeImportResult(records, state, dataRows.length, duplicateCount);
}

/** Normalizes one manual record or an array of records without reading browser or network state. */
export function importStudioPublicationAnalyticsManual(
  input: unknown,
  options: StudioPublicationAnalyticsManualImportOptions = {}
): StudioPublicationAnalyticsImportResult {
  const state = createDiagnosticState();
  const candidates = Array.isArray(input) ? input : [input];
  const inputRowCount = candidates.length;
  const processCount = Math.min(
    candidates.length,
    STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords
  );
  if (candidates.length > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords) {
    state.limitsApplied = true;
    addDiagnostic(
      state,
      "error",
      "RECORD_LIMIT_REACHED",
      "수동 기록 한도를 넘어 나머지 항목을 처리하지 않았어요."
    );
  }

  const records: StudioPublicationAnalyticsRecord[] = [];
  const identities = new Set<string>();
  let duplicateCount = 0;
  for (let index = 0; index < processCount; index += 1) {
    const normalized = normalizeRecord(
      candidates[index],
      {
        destination: options.destination,
        sourceLabel: options.sourceLabel,
        defaultCurrency: options.defaultCurrency,
        forcedSourceKind: "manual",
        fallbackSourceKind: "manual",
      },
      state,
      index + 1
    );
    if (!normalized) continue;
    const identityKey = recordIdentityKey(normalized);
    if (identities.has(identityKey)) {
      duplicateCount += 1;
      addDiagnostic(
        state,
        "warning",
        "DUPLICATE_ROW",
        "같은 게시처·날짜·회차·제목의 중복 기록을 제외했어요.",
        index + 1
      );
      continue;
    }
    identities.add(identityKey);
    records.push(normalized);
  }
  return makeImportResult(records, state, inputRowCount, duplicateCount);
}

function sortRecords(
  records: readonly StudioPublicationAnalyticsRecord[]
): StudioPublicationAnalyticsRecord[] {
  return records.slice().sort((left, right) =>
    left.date.localeCompare(right.date) ||
    DESTINATION_ORDER.indexOf(left.destination) - DESTINATION_ORDER.indexOf(right.destination) ||
    left.episode.localeCompare(right.episode) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function extractDocumentCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["records", "entries", "data", "rows"] as const) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export function createEmptyStudioPublicationAnalyticsDocument(): StudioPublicationAnalyticsDocument {
  return { version: STUDIO_PUBLICATION_ANALYTICS_VERSION, records: [] };
}

/**
 * Migrates v1, unversioned arrays, and legacy records/entries/data/rows containers. Invalid and
 * duplicate records are dropped, unknown fields are not serialized, and all costly work is capped.
 */
export function normalizeStudioPublicationAnalyticsDocument(
  value: unknown
): StudioPublicationAnalyticsDocument {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioPublicationAnalyticsDocument();
    }
  }
  const candidates = extractDocumentCandidates(decoded).slice(
    0,
    STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords
  );
  const state = createDiagnosticState();
  const identities = new Set<string>();
  const records: StudioPublicationAnalyticsRecord[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeRecord(
      candidates[index],
      { fallbackSourceKind: "manual" },
      state,
      index + 1
    );
    if (!normalized) continue;
    const identityKey = recordIdentityKey(normalized);
    if (identities.has(identityKey)) continue;
    identities.add(identityKey);
    records.push(normalized);
  }
  return { version: STUDIO_PUBLICATION_ANALYTICS_VERSION, records: sortRecords(records) };
}

/** Serializes only the canonical, sorted v1 local document. */
export function serializeStudioPublicationAnalyticsDocument(value: unknown): string {
  return JSON.stringify(normalizeStudioPublicationAnalyticsDocument(value));
}

/** Adds a previously imported record list while rejecting duplicates against the saved document. */
export function mergeStudioPublicationAnalyticsRecords(
  documentValue: unknown,
  incoming: readonly unknown[]
): StudioPublicationAnalyticsMergeResult {
  const document = normalizeStudioPublicationAnalyticsDocument(documentValue);
  const state = createDiagnosticState();
  const records = document.records.slice();
  const identities = new Set(records.map(recordIdentityKey));
  let duplicateCount = 0;
  let rejectedCount = 0;
  let addedCount = 0;

  for (let index = 0; index < incoming.length; index += 1) {
    if (records.length >= STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRecords) {
      const remaining = incoming.length - index;
      rejectedCount += remaining;
      state.limitsApplied = true;
      addDiagnostic(
        state,
        "error",
        "RECORD_LIMIT_REACHED",
        "저장 가능한 분석 기록 한도에 도달해 나머지 항목을 추가하지 않았어요."
      );
      break;
    }
    const errorsBefore = state.errorCount;
    const normalized = normalizeRecord(
      incoming[index],
      { fallbackSourceKind: "manual" },
      state,
      index + 1
    );
    if (!normalized) {
      rejectedCount += 1;
      if (state.errorCount === errorsBefore) {
        addDiagnostic(state, "error", "INVALID_ROW", "유효하지 않은 기록을 제외했어요.", index + 1);
      }
      continue;
    }
    const identityKey = recordIdentityKey(normalized);
    if (identities.has(identityKey)) {
      duplicateCount += 1;
      rejectedCount += 1;
      addDiagnostic(
        state,
        "warning",
        "DUPLICATE_ROW",
        "이미 저장된 게시처·날짜·회차·제목의 기록을 제외했어요.",
        index + 1
      );
      continue;
    }
    identities.add(identityKey);
    records.push(normalized);
    addedCount += 1;
  }

  return {
    document: { version: STUDIO_PUBLICATION_ANALYTICS_VERSION, records: sortRecords(records) },
    diagnostics: state.diagnostics,
    addedCount,
    rejectedCount,
    duplicateCount,
    limitsApplied: state.limitsApplied,
    diagnosticsTruncated:
      state.totalDiagnosticCount > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxDiagnostics,
  };
}

function emptyTotals(): StudioPublicationAnalyticsTotals {
  return { views: 0, likes: 0, comments: 0, subscribersGained: 0 };
}

function addTotals(
  target: StudioPublicationAnalyticsTotals,
  record: Pick<StudioPublicationAnalyticsRecord, StudioPublicationAnalyticsMetricField>
): void {
  target.views += record.views;
  target.likes += record.likes;
  target.comments += record.comments;
  target.subscribersGained += record.subscribersGained;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function calculateRates(totals: StudioPublicationAnalyticsTotals): StudioPublicationAnalyticsRates {
  if (totals.views === 0) {
    return {
      likeRatePercent: 0,
      commentRatePercent: 0,
      interactionRatePercent: 0,
      subscribersPerThousandViews: 0,
    };
  }
  return {
    likeRatePercent: round((totals.likes / totals.views) * 100, 2),
    commentRatePercent: round((totals.comments / totals.views) * 100, 2),
    interactionRatePercent: round(((totals.likes + totals.comments) / totals.views) * 100, 2),
    subscribersPerThousandViews: round(
      (totals.subscribersGained / totals.views) * 1_000,
      2
    ),
  };
}

function revenueTotals(
  records: readonly StudioPublicationAnalyticsRecord[]
): StudioPublicationAnalyticsRevenueTotal[] {
  const values = new Map<string, { total: number; recordCount: number }>();
  for (const record of records) {
    if (record.revenue === null || record.currency === null) continue;
    const current = values.get(record.currency) ?? { total: 0, recordCount: 0 };
    current.total = round(current.total + record.revenue, 6);
    current.recordCount += 1;
    values.set(record.currency, current);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => ({ currency, ...value }));
}

function summarizeRecords(
  records: readonly StudioPublicationAnalyticsRecord[]
): StudioPublicationAnalyticsSummary {
  const totals = emptyTotals();
  const episodes = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;
  for (const record of records) {
    addTotals(totals, record);
    episodes.add([record.destination, record.episode, record.title].join("\u0000"));
    if (from === null || record.date < from) from = record.date;
    if (to === null || record.date > to) to = record.date;
  }
  return {
    recordCount: records.length,
    episodeCount: episodes.size,
    dateRange: from && to ? { from, to } : null,
    totals,
    rates: calculateRates(totals),
    revenue: revenueTotals(records),
  };
}

function makeDelta(current: number, baseline: number): StudioPublicationAnalyticsDelta {
  const absolute = round(current - baseline, 6);
  let direction: StudioPublicationAnalyticsDeltaDirection = "flat";
  if (current > baseline) direction = baseline === 0 ? "new" : "up";
  else if (current < baseline) direction = "down";
  return {
    baseline,
    current,
    absolute,
    percentChange: baseline === 0 ? null : round((absolute / baseline) * 100, 2),
    direction,
  };
}

function metricDeltas(
  current: StudioPublicationAnalyticsTotals,
  baseline: StudioPublicationAnalyticsTotals
): StudioPublicationAnalyticsMetricDeltas {
  return {
    views: makeDelta(current.views, baseline.views),
    likes: makeDelta(current.likes, baseline.likes),
    comments: makeDelta(current.comments, baseline.comments),
    subscribersGained: makeDelta(current.subscribersGained, baseline.subscribersGained),
  };
}

function revenueDeltas(
  current: readonly StudioPublicationAnalyticsRevenueTotal[],
  baseline: readonly StudioPublicationAnalyticsRevenueTotal[]
): StudioPublicationAnalyticsRevenueDelta[] {
  const currentMap = new Map(current.map((item) => [item.currency, item.total]));
  const baselineMap = new Map(baseline.map((item) => [item.currency, item.total]));
  const currencies = new Set([...currentMap.keys(), ...baselineMap.keys()]);
  return [...currencies]
    .sort((left, right) => left.localeCompare(right))
    .map((currency) => ({
      currency,
      ...makeDelta(currentMap.get(currency) ?? 0, baselineMap.get(currency) ?? 0),
    }));
}

function rateDeltas(
  current: StudioPublicationAnalyticsRates,
  baseline: StudioPublicationAnalyticsRates
): StudioPublicationAnalyticsRateDeltas {
  return {
    likeRatePercentagePoints: round(current.likeRatePercent - baseline.likeRatePercent, 2),
    commentRatePercentagePoints: round(
      current.commentRatePercent - baseline.commentRatePercent,
      2
    ),
    interactionRatePercentagePoints: round(
      current.interactionRatePercent - baseline.interactionRatePercent,
      2
    ),
    subscribersPerThousandViews: round(
      current.subscribersPerThousandViews - baseline.subscribersPerThousandViews,
      2
    ),
  };
}

function timelineFromRecords(
  records: readonly StudioPublicationAnalyticsRecord[]
): StudioPublicationAnalyticsTimelinePoint[] {
  const byDate = new Map<string, StudioPublicationAnalyticsRecord[]>();
  for (const record of records) {
    const day = byDate.get(record.date) ?? [];
    day.push(record);
    byDate.set(record.date, day);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayRecords]) => {
      const summary = summarizeRecords(dayRecords);
      return {
        date,
        recordCount: summary.recordCount,
        totals: summary.totals,
        revenue: summary.revenue,
      };
    });
}

/** Computes deterministic totals, rates, per-date points, and first-to-last trend deltas. */
export function computeStudioPublicationAnalytics(
  value: unknown
): StudioPublicationAnalyticsInsights {
  const document = normalizeStudioPublicationAnalyticsDocument(value);
  const timeline = timelineFromRecords(document.records);
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const trend = first && last && first.date !== last.date
    ? {
        fromDate: first.date,
        toDate: last.date,
        metrics: metricDeltas(last.totals, first.totals),
        revenue: revenueDeltas(last.revenue, first.revenue),
      }
    : null;
  const byDestination = DESTINATION_ORDER.flatMap((destination) => {
    const records = document.records.filter((record) => record.destination === destination);
    return records.length > 0 ? [{ destination, ...summarizeRecords(records) }] : [];
  });
  return {
    basis: "user-supplied-local-data",
    remoteTelemetryUsed: false,
    summary: summarizeRecords(document.records),
    timeline,
    byDestination,
    trend,
  };
}

/** Compares two local documents or record arrays; percentage deltas never divide by zero. */
export function compareStudioPublicationAnalytics(
  currentValue: unknown,
  baselineValue: unknown
): StudioPublicationAnalyticsComparison {
  const currentDocument = normalizeStudioPublicationAnalyticsDocument(currentValue);
  const baselineDocument = normalizeStudioPublicationAnalyticsDocument(baselineValue);
  const current = summarizeRecords(currentDocument.records);
  const baseline = summarizeRecords(baselineDocument.records);
  const byDestination = DESTINATION_ORDER.flatMap((destination) => {
    const currentSummary = summarizeRecords(
      currentDocument.records.filter((record) => record.destination === destination)
    );
    const baselineSummary = summarizeRecords(
      baselineDocument.records.filter((record) => record.destination === destination)
    );
    if (currentSummary.recordCount === 0 && baselineSummary.recordCount === 0) return [];
    return [{
      destination,
      recordCount: makeDelta(currentSummary.recordCount, baselineSummary.recordCount),
      metrics: metricDeltas(currentSummary.totals, baselineSummary.totals),
      rates: rateDeltas(currentSummary.rates, baselineSummary.rates),
      revenue: revenueDeltas(currentSummary.revenue, baselineSummary.revenue),
    }];
  });
  return {
    basis: "user-supplied-local-data",
    remoteTelemetryUsed: false,
    baseline,
    current,
    recordCount: makeDelta(current.recordCount, baseline.recordCount),
    metrics: metricDeltas(current.totals, baseline.totals),
    rates: rateDeltas(current.rates, baseline.rates),
    revenue: revenueDeltas(current.revenue, baseline.revenue),
    byDestination,
  };
}
