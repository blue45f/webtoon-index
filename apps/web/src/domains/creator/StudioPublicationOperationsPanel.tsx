import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  HardDrive,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  computeStudioPublicationAnalytics,
  createEmptyStudioPublicationAnalyticsDocument,
  importStudioPublicationAnalyticsCsv,
  importStudioPublicationAnalyticsManual,
  mergeStudioPublicationAnalyticsRecords,
  normalizeStudioPublicationAnalyticsDocument,
  STUDIO_PUBLICATION_ANALYTICS_LIMITS,
  type StudioPublicationAnalyticsDelta,
  type StudioPublicationAnalyticsDestination,
  type StudioPublicationAnalyticsDocument,
  type StudioPublicationAnalyticsImportResult,
  type StudioPublicationAnalyticsMergeResult,
} from "./studio-publication-analytics";
import {
  addStudioReleaseScheduleItem,
  exportStudioReleaseScheduleIcalendar,
  removeStudioReleaseScheduleItem,
  STUDIO_RELEASE_DESTINATIONS,
  STUDIO_RELEASE_ITEM_KINDS,
  STUDIO_RELEASE_LOCAL_ONLY_NOTICE,
  STUDIO_RELEASE_SCHEDULE_MAX_ITEMS,
  STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH,
  STUDIO_RELEASE_SCHEDULE_MAX_TIME_ZONE_LENGTH,
  STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH,
  STUDIO_RELEASE_STATUSES,
  updateStudioReleaseScheduleItem,
  validateStudioReleaseSchedule,
  type StudioReleaseDestination,
  type StudioReleaseItemKind,
  type StudioReleaseSchedule,
  type StudioReleaseScheduleItemPatch,
  type StudioReleaseStatus,
} from "./studio-release-schedule";

export interface StudioPublicationOperationsPanelProps {
  open: boolean;
  onClose: () => void;
  schedule: StudioReleaseSchedule;
  onScheduleChange: (schedule: StudioReleaseSchedule) => void;
  analyticsDocument: StudioPublicationAnalyticsDocument;
  onAnalyticsDocumentChange: (document: StudioPublicationAnalyticsDocument) => void;
}

type OperationsTab = "schedule" | "analytics";
type NoticeTone = "success" | "warning" | "error";

interface Notice {
  tone: NoticeTone;
  text: string;
}

interface ManualDraft {
  destination: StudioPublicationAnalyticsDestination;
  sourceLabel: string;
  date: string;
  episode: string;
  title: string;
  views: string;
  likes: string;
  comments: string;
  subscribersGained: string;
  revenue: string;
  currency: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-card px-2.5 py-2 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[invalid=true]:border-bad disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const LABEL_CLASS = "mb-1 block text-[0.68rem] font-semibold text-fg-2";

const KIND_LABELS: Record<StudioReleaseItemKind, string> = {
  episode: "회차",
  milestone: "마일스톤",
};
const RELEASE_DESTINATION_LABELS: Record<StudioReleaseDestination, string> = {
  generic: "일반",
  webtoon: "WEBTOON CANVAS",
  tapas: "Tapas",
};
const STATUS_LABELS: Record<StudioReleaseStatus, string> = {
  draft: "초안",
  review: "검토 중",
  ready: "게시 준비",
  scheduled: "예약 기록",
  published: "게시 완료 기록",
};
const ANALYTICS_DESTINATION_LABELS: Record<StudioPublicationAnalyticsDestination, string> = {
  webtoon: "WEBTOON",
  tapas: "Tapas",
  other: "기타",
};
const COMMON_TIME_ZONES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "UTC",
] as const;
const RECORDS_PER_PAGE = 25;
const TIMELINE_DISPLAY_LIMIT = 60;
const numberFormatter = new Intl.NumberFormat("ko-KR");
const decimalFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 });

function localDateString(daysAhead = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
  } catch {
    return "Asia/Seoul";
  }
}

function createReleaseId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `release_${globalThis.crypto.randomUUID()}`;
  }
  return `release_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function formatRate(value: number): string {
  return `${decimalFormatter.format(value)}%`;
}

function formatRevenue(currency: string, total: number): string {
  return `${currency} ${decimalFormatter.format(total)}`;
}

function formatDelta(delta: StudioPublicationAnalyticsDelta): string {
  if (delta.direction === "flat") return "변화 없음";
  const absolute = `${delta.absolute > 0 ? "+" : ""}${decimalFormatter.format(delta.absolute)}`;
  if (delta.percentChange === null) return `${absolute} · 새 기준`;
  const percent = `${delta.percentChange > 0 ? "+" : ""}${decimalFormatter.format(delta.percentChange)}%`;
  return `${absolute} · ${percent}`;
}

function noticeClassName(tone: NoticeTone): string {
  if (tone === "success") return "border-good/35 bg-good/10 text-good";
  if (tone === "warning") return "border-warn/35 bg-warn/10 text-warn";
  return "border-bad/35 bg-bad/10 text-bad";
}

interface CommittingTextFieldProps {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  maxLength: number;
  describedBy?: string;
  invalid?: boolean;
  multiline?: boolean;
  placeholder?: string;
  list?: string;
}

function CommittingTextField({
  value,
  onCommit,
  label,
  maxLength,
  describedBy,
  invalid = false,
  multiline = false,
  placeholder,
  list,
}: CommittingTextFieldProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const shared = {
    "aria-label": label,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    className: FIELD_CLASS,
    maxLength,
    onBlur: () => onCommit(draft),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    placeholder,
    value: draft,
  };

  return multiline ? <textarea {...shared} rows={2} /> : <input {...shared} list={list} />;
}

function DiagnosticLedger({
  result,
  merge,
}: {
  result: StudioPublicationAnalyticsImportResult | null;
  merge: StudioPublicationAnalyticsMergeResult | null;
}) {
  if (!result && !merge) return null;
  const diagnostics = [...(result?.diagnostics ?? []), ...(merge?.diagnostics ?? [])];
  return (
    <div className="mt-3 rounded-xl border border-line bg-card/35 px-3 py-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-fg">가져오기 결과</p>
        <div className="flex flex-wrap gap-1.5 text-[0.68rem] font-semibold">
          {result && (
            <>
              <span className="rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-good">
                검증 통과 {formatCount(result.acceptedCount)}
              </span>
              <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-fg-3">
                제외 {formatCount(result.rejectedCount)}
              </span>
            </>
          )}
          {merge && (
            <span className="rounded-full border border-cool/30 bg-cool/10 px-2 py-0.5 text-cool">
              저장 추가 {formatCount(merge.addedCount)} · 중복 {formatCount(merge.duplicateCount)}
            </span>
          )}
        </div>
      </div>
      {result && (
        <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">
          입력 {formatCount(result.inputRowCount)}행 · 수식 중립화 {formatCount(result.formulaNeutralizedCount)}건
          {result.limitsApplied ? " · 입력 한도 적용" : ""}
        </p>
      )}
      {diagnostics.length > 0 ? (
        <details className="mt-2" open={diagnostics.some(({ severity }) => severity === "error")}>
          <summary className="cursor-pointer text-[0.68rem] font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            진단 {formatCount(diagnostics.length)}건 보기
          </summary>
          <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {diagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${diagnostic.row ?? "global"}-${index}`}
                className={`rounded-lg border px-2.5 py-2 text-[0.68rem] leading-relaxed ${
                  diagnostic.severity === "error"
                    ? "border-bad/30 bg-bad/10 text-bad"
                    : "border-warn/30 bg-warn/10 text-warn"
                }`}
              >
                <span className="font-semibold">{diagnostic.code}</span>
                {diagnostic.row ? ` · ${diagnostic.row}행` : ""}
                {diagnostic.field ? ` · ${diagnostic.field}` : ""} — {diagnostic.message}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[0.68rem] text-good">
          <CheckCircle2 size={13} aria-hidden /> 추가 진단이 없습니다.
        </p>
      )}
    </div>
  );
}

export function StudioPublicationOperationsPanel({
  open,
  onClose,
  schedule,
  onScheduleChange,
  analyticsDocument,
  onAnalyticsDocumentChange,
}: StudioPublicationOperationsPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const scheduleTabId = useId();
  const analyticsTabId = useId();
  const schedulePanelId = useId();
  const analyticsPanelId = useId();
  const timeZoneListId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scheduleTabRef = useRef<HTMLButtonElement>(null);
  const analyticsTabRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<OperationsTab>("schedule");
  const [scheduleNotice, setScheduleNotice] = useState<Notice | null>(null);
  const [calendarIncludeNotes, setCalendarIncludeNotes] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvDestination, setCsvDestination] =
    useState<StudioPublicationAnalyticsDestination>("webtoon");
  const [csvSourceLabel, setCsvSourceLabel] = useState("로컬 CSV");
  const [csvCurrency, setCsvCurrency] = useState("");
  const [csvFileNotice, setCsvFileNotice] = useState<Notice | null>(null);
  const [csvImportResult, setCsvImportResult] =
    useState<StudioPublicationAnalyticsImportResult | null>(null);
  const [csvMergeResult, setCsvMergeResult] =
    useState<StudioPublicationAnalyticsMergeResult | null>(null);
  const [manualImportResult, setManualImportResult] =
    useState<StudioPublicationAnalyticsImportResult | null>(null);
  const [manualMergeResult, setManualMergeResult] =
    useState<StudioPublicationAnalyticsMergeResult | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualDraft>({
    destination: "webtoon",
    sourceLabel: "수동 입력",
    date: localDateString(),
    episode: "",
    title: "",
    views: "0",
    likes: "0",
    comments: "0",
    subscribersGained: "0",
    revenue: "",
    currency: "",
  });
  const [recordsPage, setRecordsPage] = useState(0);
  const [clearAllArmed, setClearAllArmed] = useState(false);

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const previousFocus = globalThis.document.activeElement;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    const animationFrame = globalThis.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.tabIndex !== -1 && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.document.addEventListener("keydown", onKeyDown, true);
    return () => {
      globalThis.cancelAnimationFrame(animationFrame);
      globalThis.document.removeEventListener("keydown", onKeyDown, true);
      globalThis.document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open, onClose]);

  if (!open || typeof globalThis.document === "undefined") return null;

  const validation = validateStudioReleaseSchedule(schedule);
  const issuesByItem = new Map<string, typeof validation.issues>();
  for (const issue of validation.issues) {
    if (!issue.itemId) continue;
    const current = issuesByItem.get(issue.itemId) ?? [];
    current.push(issue);
    issuesByItem.set(issue.itemId, current);
  }
  const normalizedAnalytics = normalizeStudioPublicationAnalyticsDocument(analyticsDocument);
  const insights = computeStudioPublicationAnalytics(normalizedAnalytics);
  const recordPageCount = Math.max(1, Math.ceil(normalizedAnalytics.records.length / RECORDS_PER_PAGE));
  const safeRecordsPage = Math.min(recordsPage, recordPageCount - 1);
  const visibleRecords = normalizedAnalytics.records.slice(
    safeRecordsPage * RECORDS_PER_PAGE,
    (safeRecordsPage + 1) * RECORDS_PER_PAGE
  );
  const visibleTimeline = insights.timeline.slice(-TIMELINE_DISPLAY_LIMIT);

  function updateScheduleItem(itemId: string, patch: StudioReleaseScheduleItemPatch) {
    try {
      onScheduleChange(updateStudioReleaseScheduleItem(schedule, itemId, patch));
      setScheduleNotice(null);
    } catch (error) {
      setScheduleNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "일정을 수정하지 못했어요.",
      });
    }
  }

  function handleAddScheduleItem() {
    try {
      const next = addStudioReleaseScheduleItem(schedule, {
        id: createReleaseId(),
        kind: "episode",
        title: "새 회차",
        destination: "generic",
        localDate: localDateString(1),
        localTime: "20:00",
        timeZone: browserTimeZone(),
        status: "draft",
      });
      onScheduleChange(next);
      setScheduleNotice({ tone: "success", text: "새 로컬 릴리스 일정을 추가했어요." });
    } catch (error) {
      setScheduleNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "일정을 추가하지 못했어요.",
      });
    }
  }

  function handleExportCalendar() {
    try {
      const exported = exportStudioReleaseScheduleIcalendar(schedule, {
        calendarName: "ToonSpectrum 릴리스 일정",
        generatedAt: new Date(),
        includeNotes: calendarIncludeNotes,
      });
      if (exported.eventCount === 0) {
        setScheduleNotice({
          tone: "warning",
          text: "내보낼 수 있는 일정이 없어요. 제목·날짜·시간·IANA 시간대를 확인해 주세요.",
        });
        return;
      }
      const blob = new Blob([exported.content], { type: exported.mimeType });
      const objectUrl = globalThis.URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = exported.filename;
      anchor.click();
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 0);
      setScheduleNotice({
        tone: exported.skippedItemIds.length > 0 ? "warning" : "success",
        text: `캘린더 ${formatCount(exported.eventCount)}건을 로컬 파일로 만들었어요.${
          exported.skippedItemIds.length > 0
            ? ` 유효하지 않은 ${formatCount(exported.skippedItemIds.length)}건은 제외했습니다.`
            : ""
        }`,
      });
    } catch (error) {
      setScheduleNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "캘린더 파일을 만들지 못했어요.",
      });
    }
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tab: OperationsTab) {
    const nextTab =
      event.key === "Home"
        ? "schedule"
        : event.key === "End"
          ? "analytics"
          : event.key === "ArrowLeft" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowDown"
            ? tab === "schedule"
              ? "analytics"
              : "schedule"
            : null;
    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    (nextTab === "schedule" ? scheduleTabRef : analyticsTabRef).current?.focus();
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits * 4) {
      setCsvFileNotice({ tone: "error", text: "파일이 로컬 CSV 읽기 한도를 넘었어요." });
      return;
    }
    try {
      const text = await file.text();
      if (text.length > STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits) {
        setCsvFileNotice({ tone: "error", text: "CSV 텍스트가 허용 길이를 넘었어요. 파일을 나눠 주세요." });
        return;
      }
      setCsvText(text);
      setCsvSourceLabel(file.name.slice(0, STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxSourceLabelCodeUnits));
      setCsvFileNotice({ tone: "success", text: `${file.name}을 로컬에서 읽었어요. 아직 저장하지 않았습니다.` });
      setCsvImportResult(null);
      setCsvMergeResult(null);
    } catch {
      setCsvFileNotice({ tone: "error", text: "브라우저에서 CSV 파일을 읽지 못했어요." });
    }
  }

  function handleCsvImport() {
    const imported = importStudioPublicationAnalyticsCsv(csvText, {
      destination: csvDestination,
      sourceLabel: csvSourceLabel,
      defaultCurrency: csvCurrency || undefined,
    });
    const merged = mergeStudioPublicationAnalyticsRecords(analyticsDocument, imported.records);
    setCsvImportResult(imported);
    setCsvMergeResult(merged);
    if (merged.addedCount > 0) onAnalyticsDocumentChange(merged.document);
  }

  function updateManualDraft<Key extends keyof ManualDraft>(key: Key, value: ManualDraft[Key]) {
    setManualDraft((current) => ({ ...current, [key]: value }));
  }

  function handleManualImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const imported = importStudioPublicationAnalyticsManual(
      {
        date: manualDraft.date,
        episode: manualDraft.episode,
        title: manualDraft.title,
        views: manualDraft.views,
        likes: manualDraft.likes,
        comments: manualDraft.comments,
        subscribersGained: manualDraft.subscribersGained,
        revenue: manualDraft.revenue,
        currency: manualDraft.currency,
      },
      {
        destination: manualDraft.destination,
        sourceLabel: manualDraft.sourceLabel,
        defaultCurrency: manualDraft.currency || undefined,
      }
    );
    const merged = mergeStudioPublicationAnalyticsRecords(analyticsDocument, imported.records);
    setManualImportResult(imported);
    setManualMergeResult(merged);
    if (merged.addedCount > 0) {
      onAnalyticsDocumentChange(merged.document);
      setManualDraft((current) => ({
        ...current,
        episode: "",
        title: "",
        views: "0",
        likes: "0",
        comments: "0",
        subscribersGained: "0",
        revenue: "",
      }));
    }
  }

  function removeAnalyticsRecord(recordId: string) {
    onAnalyticsDocumentChange({
      ...normalizedAnalytics,
      records: normalizedAnalytics.records.filter(({ id }) => id !== recordId),
    });
    setClearAllArmed(false);
  }

  function handleClearAllRecords() {
    if (!clearAllArmed) {
      setClearAllArmed(true);
      return;
    }
    onAnalyticsDocumentChange(createEmptyStudioPublicationAnalyticsDocument());
    setRecordsPage(0);
    setClearAllArmed(false);
  }

  const modal = (
    <div className="fixed inset-0 z-[80] p-2 text-fg sm:p-4">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.86)] backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.6)] outline-none"
      >
        <header className="shrink-0 border-b border-line">
          <div className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-4">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <CalendarClock size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-base font-bold tracking-tight text-fg">
                  게시 운영 대장
                </h2>
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold text-fg-3">
                  로컬 전용
                </span>
              </div>
              <p id={descriptionId} className="mt-0.5 max-w-[72ch] text-xs leading-relaxed text-fg-3">
                릴리스 시각을 점검하고, 직접 가져온 성과 기록을 비교합니다. 외부 플랫폼 계정과 연결하거나 자동 게시하지 않습니다.
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="게시 운영 대장 닫기"
              title="닫기 (Esc)"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div role="tablist" aria-label="게시 운영 보기" className="flex gap-1 px-4 sm:px-5">
            <button
              ref={scheduleTabRef}
              id={scheduleTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === "schedule"}
              aria-controls={schedulePanelId}
              tabIndex={activeTab === "schedule" ? 0 : -1}
              onClick={() => setActiveTab("schedule")}
              onKeyDown={(event) => handleTabKeyDown(event, "schedule")}
              className={`relative inline-flex min-h-10 items-center gap-1.5 px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                activeTab === "schedule" ? "text-accent" : "text-fg-3 hover:text-fg"
              }`}
            >
              <CalendarClock size={14} aria-hidden /> 릴리스 일정
              {activeTab === "schedule" && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
            <button
              ref={analyticsTabRef}
              id={analyticsTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === "analytics"}
              aria-controls={analyticsPanelId}
              tabIndex={activeTab === "analytics" ? 0 : -1}
              onClick={() => setActiveTab("analytics")}
              onKeyDown={(event) => handleTabKeyDown(event, "analytics")}
              className={`relative inline-flex min-h-10 items-center gap-1.5 px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                activeTab === "analytics" ? "text-accent" : "text-fg-3 hover:text-fg"
              }`}
            >
              <BarChart3 size={14} aria-hidden /> 성과 분석
              {activeTab === "analytics" && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {activeTab === "schedule" && (
            <div
              id={schedulePanelId}
              role="tabpanel"
              aria-labelledby={scheduleTabId}
              className="px-4 py-4 sm:px-5 sm:py-5"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-fg">릴리스 일정</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{STUDIO_RELEASE_LOCAL_ONLY_NOTICE}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2">
                    <input
                      type="checkbox"
                      checked={calendarIncludeNotes}
                      onChange={(event) => setCalendarIncludeNotes(event.target.checked)}
                      className="size-3.5 accent-accent"
                    />
                    개인 메모 포함
                  </label>
                  <button type="button" onClick={handleExportCalendar} disabled={schedule.items.length === 0} className={BUTTON_CLASS}>
                    <Download size={14} aria-hidden /> .ics 내보내기
                  </button>
                  <button type="button" onClick={handleAddScheduleItem} disabled={schedule.items.length >= STUDIO_RELEASE_SCHEDULE_MAX_ITEMS} className={PRIMARY_BUTTON_CLASS}>
                    <Plus size={14} aria-hidden /> 일정 추가
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.68rem]" aria-live="polite">
                <span className="rounded-full border border-line bg-card px-2 py-1 font-semibold text-fg-2">
                  {formatCount(schedule.items.length)}/{formatCount(STUDIO_RELEASE_SCHEDULE_MAX_ITEMS)}건
                </span>
                <span className={`rounded-full border px-2 py-1 font-semibold ${validation.errorCount > 0 ? "border-bad/35 bg-bad/10 text-bad" : "border-good/35 bg-good/10 text-good"}`}>
                  오류 {formatCount(validation.errorCount)}
                </span>
                <span className="rounded-full border border-warn/35 bg-warn/10 px-2 py-1 font-semibold text-warn">
                  경고 {formatCount(validation.warningCount)}
                </span>
              </div>
              {scheduleNotice && (
                <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${noticeClassName(scheduleNotice.tone)}`}>
                  {scheduleNotice.text}
                </p>
              )}

              {schedule.items.length === 0 ? (
                <div className="mt-4 grid min-h-52 place-items-center rounded-xl border border-dashed border-line bg-card/25 px-5 py-9 text-center">
                  <div className="max-w-md">
                    <CalendarClock size={28} className="mx-auto text-fg-3" aria-hidden />
                    <h4 className="mt-3 text-sm font-bold text-fg">첫 릴리스 시각을 기록해 보세요</h4>
                    <p className="mt-1.5 text-xs leading-relaxed text-fg-3">현지 날짜·시간과 IANA 시간대를 함께 보관해 DST 오류와 겹치는 슬롯을 미리 찾습니다.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card/20">
                  <div className="divide-y divide-line">
                    {schedule.items.map((item, index) => {
                      const itemIssues = issuesByItem.get(item.id) ?? [];
                      const issueFields = new Set(itemIssues.map(({ field }) => field));
                      const issueId = `release-issues-${item.id.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
                      return (
                        <article key={item.id} className="px-3 py-3.5 sm:px-4">
                          <div className="mb-2.5 flex items-center justify-between gap-3">
                            <p className="font-display text-xs font-bold tabular-nums text-fg-3">{String(index + 1).padStart(2, "0")}</p>
                            <button
                              type="button"
                              onClick={() => onScheduleChange(removeStudioReleaseScheduleItem(schedule, item.id))}
                              aria-label={`${item.title || `${index + 1}번 일정`} 삭제`}
                              className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </div>
                          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
                            <label className="lg:col-span-2">
                              <span className={LABEL_CLASS}>종류</span>
                              <select className={FIELD_CLASS} value={item.kind} onChange={(event) => updateScheduleItem(item.id, { kind: event.target.value as StudioReleaseItemKind })}>
                                {STUDIO_RELEASE_ITEM_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                              </select>
                            </label>
                            <div className="sm:col-span-1 lg:col-span-4">
                              <span className={LABEL_CLASS}>제목</span>
                              <CommittingTextField value={item.title} onCommit={(title) => updateScheduleItem(item.id, { title })} label="릴리스 제목" maxLength={STUDIO_RELEASE_SCHEDULE_MAX_TITLE_LENGTH} invalid={issueFields.has("title")} describedBy={itemIssues.length > 0 ? issueId : undefined} placeholder="회차 또는 마일스톤 제목" />
                            </div>
                            <label className="lg:col-span-3">
                              <span className={LABEL_CLASS}>게시처</span>
                              <select className={FIELD_CLASS} value={item.destination} onChange={(event) => updateScheduleItem(item.id, { destination: event.target.value as StudioReleaseDestination })}>
                                {STUDIO_RELEASE_DESTINATIONS.map((destination) => <option key={destination} value={destination}>{RELEASE_DESTINATION_LABELS[destination]}</option>)}
                              </select>
                            </label>
                            <label className="lg:col-span-3">
                              <span className={LABEL_CLASS}>상태</span>
                              <select className={FIELD_CLASS} value={item.status} aria-invalid={issueFields.has("status")} onChange={(event) => updateScheduleItem(item.id, { status: event.target.value as StudioReleaseStatus })}>
                                {STUDIO_RELEASE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                              </select>
                            </label>
                            <label className="lg:col-span-3">
                              <span className={LABEL_CLASS}>현지 날짜</span>
                              <input type="date" className={FIELD_CLASS} value={item.localDate} aria-invalid={issueFields.has("localDate")} onChange={(event) => updateScheduleItem(item.id, { localDate: event.target.value })} />
                            </label>
                            <label className="lg:col-span-2">
                              <span className={LABEL_CLASS}>현지 시간</span>
                              <input type="time" className={FIELD_CLASS} value={item.localTime} aria-invalid={issueFields.has("localTime")} onChange={(event) => updateScheduleItem(item.id, { localTime: event.target.value })} />
                            </label>
                            <div className="lg:col-span-3">
                              <span className={LABEL_CLASS}>IANA 시간대</span>
                              <CommittingTextField value={item.timeZone} onCommit={(timeZone) => updateScheduleItem(item.id, { timeZone })} label="IANA 시간대" maxLength={STUDIO_RELEASE_SCHEDULE_MAX_TIME_ZONE_LENGTH} invalid={issueFields.has("timeZone")} describedBy={itemIssues.length > 0 ? issueId : undefined} list={timeZoneListId} placeholder="Asia/Seoul" />
                            </div>
                            <div className="sm:col-span-2 lg:col-span-4">
                              <span className={LABEL_CLASS}>메모</span>
                              <CommittingTextField value={item.notes ?? ""} onCommit={(notes) => updateScheduleItem(item.id, { notes })} label="릴리스 메모" maxLength={STUDIO_RELEASE_SCHEDULE_MAX_NOTES_LENGTH} multiline placeholder="체크할 사항 (선택)" />
                            </div>
                          </div>
                          {itemIssues.length > 0 && (
                            <ul id={issueId} className="mt-2.5 space-y-1">
                              {itemIssues.map((issue, issueIndex) => (
                                <li key={`${issue.code}-${issueIndex}`} className={`flex items-start gap-1.5 text-[0.68rem] leading-relaxed ${issue.severity === "error" ? "text-bad" : "text-warn"}`}>
                                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {issue.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
              <datalist id={timeZoneListId}>{COMMON_TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>

              <aside className="mt-4 flex items-start gap-2.5 rounded-xl border border-cool/25 bg-cool/10 px-3 py-3 text-cool">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-xs font-semibold">캘린더는 개인 일정 보조 파일입니다</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed">.ics 내보내기는 유효한 필드만 로컬 파일에 담습니다. WEBTOON·Tapas의 예약 게시를 생성하거나 게시 완료 여부를 확인하지 않습니다.</p>
                </div>
              </aside>
            </div>
          )}

          {activeTab === "analytics" && (
            <div id={analyticsPanelId} role="tabpanel" aria-labelledby={analyticsTabId} className="px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-start gap-2.5 rounded-xl border border-cool/25 bg-cool/10 px-3 py-3 text-cool">
                <HardDrive size={16} className="mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-xs font-semibold">사용자가 제공한 로컬 데이터만 계산합니다</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed">CSV와 수동 기록은 이 브라우저에서 정규화합니다. ToonSpectrum은 외부 분석 API를 호출하거나 원격 텔레메트리를 수집하지 않습니다.</p>
                </div>
              </div>

              <section aria-labelledby="analytics-import-title" className="mt-5">
                <h3 id="analytics-import-title" className="text-sm font-bold text-fg">CSV 가져오기</h3>
                <p className="mt-0.5 text-xs text-fg-3">필수 헤더: 날짜, 회차 또는 제목, 조회수, 좋아요, 댓글, 구독자 증가. 한글 헤더도 지원합니다.</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div>
                    <textarea
                      value={csvText}
                      onChange={(event) => {
                        setCsvText(event.target.value);
                        setCsvImportResult(null);
                        setCsvMergeResult(null);
                      }}
                      maxLength={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits}
                      rows={8}
                      className={`${FIELD_CLASS} min-h-44 font-mono text-[0.72rem]`}
                      aria-label="분석 CSV 텍스트"
                      placeholder={'date,episode,views,likes,comments,subscribers_gained\n2026-07-10,1,1200,80,12,24'}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[0.68rem] tabular-nums text-fg-3">{formatCount(csvText.length)}/{formatCount(STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCsvCodeUnits)}자</span>
                      <label className={BUTTON_CLASS}>
                        <Upload size={14} aria-hidden /> 파일 선택
                        <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(event) => void handleCsvFile(event)} />
                      </label>
                    </div>
                    {csvFileNotice && <p role="status" className={`mt-2 rounded-lg border px-3 py-2 text-[0.68rem] leading-relaxed ${noticeClassName(csvFileNotice.tone)}`}>{csvFileNotice.text}</p>}
                  </div>
                  <div className="space-y-2.5">
                    <label><span className={LABEL_CLASS}>헤더가 없을 때 게시처</span><select className={FIELD_CLASS} value={csvDestination} onChange={(event) => setCsvDestination(event.target.value as StudioPublicationAnalyticsDestination)}>{(["webtoon", "tapas", "other"] as const).map((destination) => <option key={destination} value={destination}>{ANALYTICS_DESTINATION_LABELS[destination]}</option>)}</select></label>
                    <label><span className={LABEL_CLASS}>출처 라벨</span><input className={FIELD_CLASS} value={csvSourceLabel} maxLength={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxSourceLabelCodeUnits} onChange={(event) => setCsvSourceLabel(event.target.value)} placeholder="export-2026-07.csv" /></label>
                    <label><span className={LABEL_CLASS}>기본 통화 (선택)</span><input className={FIELD_CLASS} value={csvCurrency} maxLength={3} onChange={(event) => setCsvCurrency(event.target.value.toUpperCase())} placeholder="USD" pattern="[A-Za-z]{3}" /></label>
                    <button type="button" onClick={handleCsvImport} disabled={!csvText.trim()} className={`${PRIMARY_BUTTON_CLASS} w-full`}><FileSpreadsheet size={14} aria-hidden /> 검증 후 기록 병합</button>
                    <p className="text-[0.68rem] leading-relaxed text-fg-3">중복 기준은 게시처·날짜·회차·제목입니다. 원문 CSV는 저장 문서에 포함하지 않습니다.</p>
                  </div>
                </div>
                <DiagnosticLedger result={csvImportResult} merge={csvMergeResult} />
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="manual-record-title">
                <h3 id="manual-record-title" className="text-sm font-bold text-fg">수동 기록 추가</h3>
                <form onSubmit={handleManualImport} className="mt-3">
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <label><span className={LABEL_CLASS}>게시처</span><select className={FIELD_CLASS} value={manualDraft.destination} onChange={(event) => updateManualDraft("destination", event.target.value as StudioPublicationAnalyticsDestination)}>{(["webtoon", "tapas", "other"] as const).map((destination) => <option key={destination} value={destination}>{ANALYTICS_DESTINATION_LABELS[destination]}</option>)}</select></label>
                    <label><span className={LABEL_CLASS}>날짜</span><input required type="date" className={FIELD_CLASS} value={manualDraft.date} onChange={(event) => updateManualDraft("date", event.target.value)} /></label>
                    <label><span className={LABEL_CLASS}>회차</span><input className={FIELD_CLASS} maxLength={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxIdentityCodeUnits} value={manualDraft.episode} onChange={(event) => updateManualDraft("episode", event.target.value)} placeholder="12화" /></label>
                    <label><span className={LABEL_CLASS}>제목</span><input className={FIELD_CLASS} maxLength={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxIdentityCodeUnits} value={manualDraft.title} onChange={(event) => updateManualDraft("title", event.target.value)} placeholder="회차 제목" /></label>
                    {([ ["views", "조회수"], ["likes", "좋아요"], ["comments", "댓글"], ["subscribersGained", "구독자 증가"] ] as const).map(([field, label]) => (
                      <label key={field}><span className={LABEL_CLASS}>{label}</span><input required type="number" min={0} max={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxCountMetric} step={1} inputMode="numeric" className={FIELD_CLASS} value={manualDraft[field]} onChange={(event) => updateManualDraft(field, event.target.value)} /></label>
                    ))}
                    <label><span className={LABEL_CLASS}>수익 (선택)</span><input type="number" min={0} max={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxRevenue} step="0.000001" inputMode="decimal" className={FIELD_CLASS} value={manualDraft.revenue} onChange={(event) => updateManualDraft("revenue", event.target.value)} placeholder="0.00" /></label>
                    <label><span className={LABEL_CLASS}>통화 (수익 입력 시)</span><input className={FIELD_CLASS} maxLength={3} pattern="[A-Za-z]{3}" value={manualDraft.currency} onChange={(event) => updateManualDraft("currency", event.target.value.toUpperCase())} placeholder="USD" /></label>
                    <label className="sm:col-span-2"><span className={LABEL_CLASS}>출처 라벨</span><input className={FIELD_CLASS} maxLength={STUDIO_PUBLICATION_ANALYTICS_LIMITS.maxSourceLabelCodeUnits} value={manualDraft.sourceLabel} onChange={(event) => updateManualDraft("sourceLabel", event.target.value)} placeholder="플랫폼 화면 수동 기록" /></label>
                  </div>
                  <div className="mt-3 flex justify-end"><button type="submit" className={PRIMARY_BUTTON_CLASS}><Plus size={14} aria-hidden /> 기록 추가</button></div>
                </form>
                <DiagnosticLedger result={manualImportResult} merge={manualMergeResult} />
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="analytics-summary-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div><h3 id="analytics-summary-title" className="text-sm font-bold text-fg">성과 요약</h3><p className="mt-0.5 text-xs text-fg-3">각 행을 사용자가 보고한 한 번의 관측값으로 합산합니다.</p></div>
                  <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.68rem] font-semibold text-fg-2">{insights.summary.dateRange ? `${insights.summary.dateRange.from} — ${insights.summary.dateRange.to}` : "기록 없음"}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/30 sm:grid-cols-3 lg:grid-cols-6">
                  {([ ["기록", insights.summary.recordCount], ["회차", insights.summary.episodeCount], ["조회", insights.summary.totals.views], ["좋아요", insights.summary.totals.likes], ["댓글", insights.summary.totals.comments], ["구독 증가", insights.summary.totals.subscribersGained] ] as const).map(([label, value]) => (
                    <div key={label} className="min-w-0 px-3 py-3"><dt className="text-[0.68rem] text-fg-3">{label}</dt><dd className="mt-1 font-display text-lg font-bold tabular-nums text-fg">{formatCount(value)}</dd></div>
                  ))}
                </dl>
                <dl className="mt-3 flex flex-wrap divide-x divide-line rounded-xl border border-line bg-card/20 py-2.5 text-xs">
                  <div className="min-w-[9rem] flex-1 px-3"><dt className="text-fg-3">좋아요율</dt><dd className="mt-0.5 font-display font-bold tabular-nums text-fg">{formatRate(insights.summary.rates.likeRatePercent)}</dd></div>
                  <div className="min-w-[9rem] flex-1 px-3"><dt className="text-fg-3">댓글률</dt><dd className="mt-0.5 font-display font-bold tabular-nums text-fg">{formatRate(insights.summary.rates.commentRatePercent)}</dd></div>
                  <div className="min-w-[9rem] flex-1 px-3"><dt className="text-fg-3">상호작용률</dt><dd className="mt-0.5 font-display font-bold tabular-nums text-fg">{formatRate(insights.summary.rates.interactionRatePercent)}</dd></div>
                  <div className="min-w-[9rem] flex-1 px-3"><dt className="text-fg-3">조회 1천당 구독</dt><dd className="mt-0.5 font-display font-bold tabular-nums text-fg">{decimalFormatter.format(insights.summary.rates.subscribersPerThousandViews)}</dd></div>
                </dl>
                {insights.summary.revenue.length > 0 && <p className="mt-2 text-xs text-fg-2">통화별 수익 · {insights.summary.revenue.map(({ currency, total }) => formatRevenue(currency, total)).join(" · ")}</p>}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="destination-summary-title">
                <h3 id="destination-summary-title" className="text-sm font-bold text-fg">게시처 비교</h3>
                {insights.byDestination.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-line bg-card/20 px-3 py-6 text-center text-xs text-fg-3">기록을 가져오면 게시처별 합계가 표시됩니다.</p> : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-line"><table className="min-w-[46rem] w-full text-left text-xs"><caption className="sr-only">게시처별 성과 합계와 반응률</caption><thead className="bg-raised/70 text-[0.68rem] text-fg-3"><tr><th className="px-3 py-2 font-semibold">게시처</th><th className="px-3 py-2 text-right font-semibold">기록</th><th className="px-3 py-2 text-right font-semibold">조회</th><th className="px-3 py-2 text-right font-semibold">좋아요</th><th className="px-3 py-2 text-right font-semibold">댓글</th><th className="px-3 py-2 text-right font-semibold">구독 증가</th><th className="px-3 py-2 text-right font-semibold">상호작용률</th><th className="px-3 py-2 font-semibold">수익</th></tr></thead><tbody className="divide-y divide-line bg-card/25">{insights.byDestination.map((summary) => <tr key={summary.destination}><th className="px-3 py-2.5 font-semibold text-fg">{ANALYTICS_DESTINATION_LABELS[summary.destination]}</th><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(summary.recordCount)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg">{formatCount(summary.totals.views)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(summary.totals.likes)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(summary.totals.comments)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(summary.totals.subscribersGained)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg">{formatRate(summary.rates.interactionRatePercent)}</td><td className="px-3 py-2.5 text-fg-2">{summary.revenue.map(({ currency, total }) => formatRevenue(currency, total)).join(" · ") || "—"}</td></tr>)}</tbody></table></div>
                )}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="analytics-trend-title">
                <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 id="analytics-trend-title" className="text-sm font-bold text-fg">날짜별 흐름</h3><p className="mt-0.5 text-xs text-fg-3">첫 관측일과 마지막 관측일의 단순 차이이며 원인이나 성장률을 추론하지 않습니다.</p></div>{insights.timeline.length > TIMELINE_DISPLAY_LIMIT && <span className="text-[0.68rem] text-fg-3">최근 {TIMELINE_DISPLAY_LIMIT}/{formatCount(insights.timeline.length)}일 표시</span>}</div>
                {insights.trend && <dl className="mt-3 grid gap-2 rounded-xl border border-line bg-card/25 p-3 sm:grid-cols-2 lg:grid-cols-4">{([ ["조회", insights.trend.metrics.views], ["좋아요", insights.trend.metrics.likes], ["댓글", insights.trend.metrics.comments], ["구독 증가", insights.trend.metrics.subscribersGained] ] as const).map(([label, delta]) => <div key={label}><dt className="text-[0.68rem] text-fg-3">{label} · {insights.trend?.fromDate} → {insights.trend?.toDate}</dt><dd className={`mt-0.5 text-xs font-semibold ${delta.direction === "down" ? "text-bad" : delta.direction === "flat" ? "text-fg-2" : "text-good"}`}>{formatDelta(delta)}</dd></div>)}</dl>}
                {visibleTimeline.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-line bg-card/20 px-3 py-6 text-center text-xs text-fg-3">두 날짜 이상의 기록이 쌓이면 변화도 함께 표시됩니다.</p> : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-line"><table className="min-w-[42rem] w-full text-left text-xs"><caption className="sr-only">날짜별 분석 지표 합계</caption><thead className="bg-raised/70 text-[0.68rem] text-fg-3"><tr><th className="px-3 py-2 font-semibold">날짜</th><th className="px-3 py-2 text-right font-semibold">기록</th><th className="px-3 py-2 text-right font-semibold">조회</th><th className="px-3 py-2 text-right font-semibold">좋아요</th><th className="px-3 py-2 text-right font-semibold">댓글</th><th className="px-3 py-2 text-right font-semibold">구독 증가</th><th className="px-3 py-2 font-semibold">수익</th></tr></thead><tbody className="divide-y divide-line bg-card/25">{visibleTimeline.map((point) => <tr key={point.date}><th className="px-3 py-2.5 font-display font-semibold tabular-nums text-fg">{point.date}</th><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(point.recordCount)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg">{formatCount(point.totals.views)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(point.totals.likes)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(point.totals.comments)}</td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(point.totals.subscribersGained)}</td><td className="px-3 py-2.5 text-fg-2">{point.revenue.map(({ currency, total }) => formatRevenue(currency, total)).join(" · ") || "—"}</td></tr>)}</tbody></table></div>
                )}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="saved-records-title">
                <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 id="saved-records-title" className="text-sm font-bold text-fg">저장된 로컬 기록</h3><p className="mt-0.5 text-xs text-fg-3">원본 CSV 대신 정규화된 지표와 출처 라벨만 보관합니다.</p></div><button type="button" onClick={handleClearAllRecords} disabled={normalizedAnalytics.records.length === 0} className={`${BUTTON_CLASS} ${clearAllArmed ? "border-bad/40 bg-bad/10 text-bad" : ""}`}><Trash2 size={14} aria-hidden /> {clearAllArmed ? "다시 눌러 모두 삭제" : "모두 삭제"}</button></div>
                {visibleRecords.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-line bg-card/20 px-3 py-6 text-center text-xs text-fg-3">저장된 기록이 없습니다.</p> : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-line"><table className="min-w-[54rem] w-full text-left text-xs"><caption className="sr-only">삭제할 수 있는 저장된 분석 기록</caption><thead className="bg-raised/70 text-[0.68rem] text-fg-3"><tr><th className="px-3 py-2 font-semibold">날짜</th><th className="px-3 py-2 font-semibold">게시처</th><th className="px-3 py-2 font-semibold">회차·제목</th><th className="px-3 py-2 font-semibold">출처</th><th className="px-3 py-2 text-right font-semibold">조회 / 반응 / 구독</th><th className="w-12 px-2 py-2"><span className="sr-only">삭제</span></th></tr></thead><tbody className="divide-y divide-line bg-card/25">{visibleRecords.map((record) => <tr key={record.id}><td className="px-3 py-2.5 font-display tabular-nums text-fg">{record.date}</td><td className="px-3 py-2.5 text-fg-2">{ANALYTICS_DESTINATION_LABELS[record.destination]}</td><td className="max-w-64 px-3 py-2.5"><p className="truncate font-semibold text-fg">{[record.episode, record.title].filter(Boolean).join(" · ")}</p></td><td className="max-w-48 px-3 py-2.5"><p className="truncate text-fg-3">{record.source.label} · {record.source.kind === "csv" ? "CSV" : "수동"}</p></td><td className="px-3 py-2.5 text-right tabular-nums text-fg-2">{formatCount(record.views)} / {formatCount(record.likes + record.comments)} / {formatCount(record.subscribersGained)}</td><td className="px-2 py-1.5"><button type="button" onClick={() => removeAnalyticsRecord(record.id)} aria-label={`${record.date} ${record.episode || record.title} 기록 삭제`} className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Trash2 size={14} aria-hidden /></button></td></tr>)}</tbody></table></div>
                )}
                {recordPageCount > 1 && <nav aria-label="저장 기록 페이지" className="mt-3 flex items-center justify-end gap-2"><button type="button" className={BUTTON_CLASS} disabled={safeRecordsPage === 0} onClick={() => setRecordsPage(Math.max(0, safeRecordsPage - 1))}><ChevronLeft size={14} aria-hidden /> 이전</button><span className="text-[0.68rem] tabular-nums text-fg-3">{safeRecordsPage + 1} / {recordPageCount}</span><button type="button" className={BUTTON_CLASS} disabled={safeRecordsPage >= recordPageCount - 1} onClick={() => setRecordsPage(Math.min(recordPageCount - 1, safeRecordsPage + 1))}>다음 <ChevronRight size={14} aria-hidden /></button></nav>}
              </section>
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-card/45 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-2 text-[0.68rem] leading-relaxed text-fg-3"><ShieldCheck size={14} className="shrink-0 text-cool" aria-hidden /> 외부 게시·분석 연동 없음 · 로컬 문서와 사용자가 선택한 파일만 처리</div>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, globalThis.document.body);
}
