import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  Filter,
  Image,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  normalizeStudioAiProvenanceDocument,
  projectStudioAiProvenanceForPublish,
  STUDIO_AI_OPERATION_STATUSES,
  STUDIO_AI_OPERATION_TASKS,
  STUDIO_AI_OPERATION_TRANSPORTS,
  STUDIO_AI_PROVENANCE_LIMITS,
  type StudioAiOperation,
  type StudioAiOperationErrorCategory,
  type StudioAiOperationKind,
  type StudioAiOperationStatus,
  type StudioAiOperationTask,
  type StudioAiOperationTransport,
  type StudioAiProvenanceDocument,
  type StudioAiPublishProvenanceProjection,
} from "./studio-ai-provenance";

export interface StudioAiProvenancePanelProps {
  open: boolean;
  onClose: () => void;
  document: StudioAiProvenanceDocument;
  onExportPublicSummary: (
    summary: StudioAiPublishProvenanceProjection
  ) => void | Promise<void>;
  onClearHistory: () => void | Promise<void>;
}

type StatusFilter = "all" | StudioAiOperationStatus;
type KindFilter = "all" | StudioAiOperationKind;
type TaskFilter = "all" | StudioAiOperationTask;
type TransportFilter = "all" | StudioAiOperationTransport;

const DISPLAY_BATCH_SIZE = 50;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const ICON_BUTTON_CLASS =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const SELECT_CLASS =
  "min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg outline-none transition-colors hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const TASK_LABELS: Record<StudioAiOperationTask, string> = {
  composition: "구도 제안",
  scenario: "시나리오",
  translation: "번역",
  dialogue: "대사",
  palette: "팔레트",
  "text-other": "기타 텍스트",
  "background-image": "배경 이미지",
  "character-image": "캐릭터 이미지",
  "image-edit": "이미지 편집",
  colorize: "채색",
  "line-cleanup": "선화 정리",
  "image-other": "기타 이미지",
};

const STATUS_LABELS: Record<StudioAiOperationStatus, string> = {
  pending: "진행 중",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

const TRANSPORT_LABELS: Record<StudioAiOperationTransport, string> = {
  server: "서버 보호 경로",
  byok: "브라우저 직접 연결",
  local: "로컬 처리",
  other: "기타 경로",
};

const ERROR_CATEGORY_LABELS: Record<StudioAiOperationErrorCategory, string> = {
  configuration: "설정",
  network: "네트워크",
  provider: "AI 제공자",
  policy: "안전·정책",
  cancelled: "사용자 취소",
  unknown: "분류되지 않음",
};

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormatter = new Intl.NumberFormat("ko-KR");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("hidden") && element.offsetParent !== null
  );
}

function formatDateTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? dateTimeFormatter.format(time) : "시간 정보 없음";
}

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function statusTone(status: StudioAiOperationStatus): string {
  if (status === "succeeded") return "border-good/35 bg-good/10 text-good";
  if (status === "failed") return "border-bad/35 bg-bad/10 text-bad";
  if (status === "cancelled") return "border-warn/35 bg-warn/10 text-warn";
  return "border-cool/35 bg-cool/10 text-cool";
}

function StatusIcon({ status }: { status: StudioAiOperationStatus }) {
  if (status === "succeeded") return <CheckCircle2 size={13} aria-hidden />;
  if (status === "failed") return <AlertTriangle size={13} aria-hidden />;
  if (status === "cancelled") return <Ban size={13} aria-hidden />;
  return <Clock3 size={13} aria-hidden />;
}

function OperationKindIcon({ kind }: { kind: StudioAiOperationKind }) {
  return kind === "image" ? <Image size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />;
}

function UsageSummary({ operation }: { operation: StudioAiOperation }) {
  if (!operation.usage) {
    return <span className="text-[0.68rem] text-fg-3">토큰 집계 없음</span>;
  }

  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] tabular-nums">
      {operation.usage.promptTokens !== undefined && (
        <div className="flex gap-1">
          <dt className="text-fg-3">입력</dt>
          <dd className="font-semibold text-fg-2">{formatCount(operation.usage.promptTokens)}</dd>
        </div>
      )}
      {operation.usage.completionTokens !== undefined && (
        <div className="flex gap-1">
          <dt className="text-fg-3">출력</dt>
          <dd className="font-semibold text-fg-2">{formatCount(operation.usage.completionTokens)}</dd>
        </div>
      )}
      {operation.usage.totalTokens !== undefined && (
        <div className="flex gap-1">
          <dt className="text-fg-3">합계</dt>
          <dd className="font-semibold text-fg">{formatCount(operation.usage.totalTokens)}</dd>
        </div>
      )}
    </dl>
  );
}

function SafeTechnicalDetails({ operation }: { operation: StudioAiOperation }) {
  const targetScopes = [
    operation.target ? "페이지" : null,
    operation.target?.frameId ? "컷" : null,
    operation.target?.elementId ? "요소" : null,
  ].filter((scope): scope is string => Boolean(scope));

  return (
    <details className="mt-3 rounded-lg border border-line bg-panel/75">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-fg-2 marker:hidden hover:bg-raised/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        안전한 기술 세부 정보
        <ChevronDown size={14} className="shrink-0 text-fg-3" aria-hidden />
      </summary>
      <div className="border-t border-line px-3 py-3">
        <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[0.68rem] leading-relaxed">
          <dt className="text-fg-3">프롬프트 형식</dt>
          <dd className="font-semibold tabular-nums text-fg-2">버전 {formatCount(operation.promptVersion)}</dd>
          {operation.revisedPrompt && (
            <>
              <dt className="text-fg-3">수정 프롬프트</dt>
              <dd className="break-words text-fg-2">{operation.revisedPrompt.summary}</dd>
            </>
          )}
          {operation.requestedSize && (
            <>
              <dt className="text-fg-3">요청 크기</dt>
              <dd className="font-semibold tabular-nums text-fg-2">
                {formatCount(operation.requestedSize.width)} × {formatCount(operation.requestedSize.height)} px
              </dd>
            </>
          )}
          <dt className="text-fg-3">참조 자료</dt>
          <dd className="font-semibold tabular-nums text-fg-2">
            {formatCount(operation.references.length)}개
          </dd>
          {targetScopes.length > 0 && (
            <>
              <dt className="text-fg-3">적용 범위</dt>
              <dd className="font-semibold text-fg-2">{targetScopes.join(" · ")}</dd>
            </>
          )}
          {operation.error && (
            <>
              <dt className="text-fg-3">오류 범주</dt>
              <dd className="font-semibold text-fg-2">
                {ERROR_CATEGORY_LABELS[operation.error.category]}
                {operation.error.retriable ? " · 다시 시도 가능" : " · 자동 재시도 안 함"}
              </dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-[0.65rem] leading-relaxed text-fg-3">
          요청 식별자, 문서·에셋 식별자, 시드, 프롬프트 해시는 기술 세부 정보에도 표시하지 않습니다.
        </p>
      </div>
    </details>
  );
}

function OperationRow({ operation }: { operation: StudioAiOperation }) {
  return (
    <article className="px-3 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-raised text-fg-2">
          <OperationKindIcon kind={operation.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-fg">{TASK_LABELS[operation.task]}</h3>
            <span
              className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-[0.65rem] font-semibold ${statusTone(operation.status)}`}
            >
              <StatusIcon status={operation.status} />
              {STATUS_LABELS[operation.status]}
            </span>
          </div>
          <p className="mt-1 break-words text-xs leading-relaxed text-fg-2">
            <strong className="font-semibold text-fg">{operation.provider}</strong>
            <span aria-hidden> · </span>
            {operation.model}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-fg-3">
            <time dateTime={operation.createdAt}>{formatDateTime(operation.createdAt)}</time>
            <span>{TRANSPORT_LABELS[operation.transport]}</span>
            <span>{operation.kind === "image" ? "이미지 AI" : "텍스트 AI"}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-card/55 px-3 py-2.5">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good" aria-hidden />
          <span>{operation.prompt.summary}</span>
        </p>
        <div className="mt-2 border-t border-line/70 pt-2">
          <UsageSummary operation={operation} />
        </div>
      </div>

      <SafeTechnicalDetails operation={operation} />
    </article>
  );
}

export function StudioAiProvenancePanel({
  open,
  onClose,
  document,
  onExportPublicSummary,
  onClearHistory,
}: StudioAiProvenancePanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [transportFilter, setTransportFilter] = useState<TransportFilter>("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(DISPLAY_BATCH_SIZE);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeDocument = normalizeStudioAiProvenanceDocument(document);
  const statusCounts = STUDIO_AI_OPERATION_STATUSES.reduce<Record<StudioAiOperationStatus, number>>(
    (counts, status) => {
      counts[status] = safeDocument.operations.filter((operation) => operation.status === status).length;
      return counts;
    },
    { pending: 0, succeeded: 0, failed: 0, cancelled: 0 }
  );
  const providers = [...new Set(safeDocument.operations.map((operation) => operation.provider))].sort(
    (left, right) => left.localeCompare(right)
  );
  const effectiveProviderFilter = providers.includes(providerFilter) ? providerFilter : "all";
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredOperations = safeDocument.operations.filter((operation) => {
    if (statusFilter !== "all" && operation.status !== statusFilter) return false;
    if (kindFilter !== "all" && operation.kind !== kindFilter) return false;
    if (taskFilter !== "all" && operation.task !== taskFilter) return false;
    if (transportFilter !== "all" && operation.transport !== transportFilter) return false;
    if (effectiveProviderFilter !== "all" && operation.provider !== effectiveProviderFilter) return false;
    if (!normalizedQuery) return true;
    return `${operation.provider}\n${operation.model}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
  });
  const visibleOperations = filteredOperations.slice(0, visibleLimit);
  const hasActiveFilters =
    statusFilter !== "all"
    || kindFilter !== "all"
    || taskFilter !== "all"
    || transportFilter !== "all"
    || effectiveProviderFilter !== "all"
    || Boolean(query.trim());

  useEffect(() => {
    setVisibleLimit(DISPLAY_BATCH_SIZE);
  }, [statusFilter, kindFilter, taskFilter, transportFilter, providerFilter, query]);

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const body = globalThis.document.body;
    const previousOverflow = body.style.overflow;
    const previousFocus = globalThis.document.activeElement as HTMLElement | null;
    body.style.overflow = "hidden";
    const frame = globalThis.requestAnimationFrame(() => dialogRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const activeElement = globalThis.document.activeElement;
      if (!first || !last) return;
      if (event.shiftKey && (activeElement === first || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    setConfirmClear(false);
    setNotice(null);
    setError(null);
  }, [open]);

  if (!open || typeof globalThis.document === "undefined") return null;

  const resetFilters = () => {
    setStatusFilter("all");
    setKindFilter("all");
    setTaskFilter("all");
    setTransportFilter("all");
    setProviderFilter("all");
    setQuery("");
  };

  const exportPublicSummary = async () => {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      await onExportPublicSummary(projectStudioAiProvenanceForPublish(safeDocument));
      setNotice("개인 식별 정보를 제외한 공개용 AI 사용 요약을 전달했습니다.");
    } catch {
      setError("공개용 요약을 내보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setExporting(false);
    }
  };

  const clearHistory = async () => {
    if (!confirmClear || clearing) return;
    setClearing(true);
    setNotice(null);
    setError(null);
    try {
      await onClearHistory();
      setConfirmClear(false);
      setNotice("AI 작업 이력을 비웠습니다.");
    } catch {
      setError("AI 작업 이력을 비우지 못했어요. 문서 저장 상태를 확인해 주세요.");
    } finally {
      setClearing(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center text-fg sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="AI 작업 이력 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.9)]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-ai-provenance-title"
        aria-describedby="studio-ai-provenance-description studio-ai-provenance-trust-boundary"
        tabIndex={-1}
        className="relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-panel shadow-2xl outline-none sm:h-[min(92dvh,58rem)] sm:rounded-2xl sm:border sm:border-line"
      >
        <header
          className="shrink-0 border-b border-line bg-panel px-3 pb-3 sm:px-5"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <ShieldCheck size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="studio-ai-provenance-title" className="text-base font-bold tracking-tight text-fg">
                  비공개 AI 작업 이력
                </h2>
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] tabular-nums text-fg-3">
                  {formatCount(safeDocument.operations.length)} / {formatCount(STUDIO_AI_PROVENANCE_LIMITS.maxOperations)}
                </span>
              </div>
              <p
                id="studio-ai-provenance-description"
                className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3"
              >
                이 문서에서 실행한 AI 작업을 확인합니다. 최신 작업부터 최대 {formatCount(STUDIO_AI_PROVENANCE_LIMITS.maxOperations)}건만 보관합니다.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="AI 작업 이력 닫기" className={ICON_BUTTON_CLASS}>
              <X size={16} aria-hidden />
            </button>
          </div>
        </header>

        <section className="shrink-0 border-b border-line bg-good/5 px-3 py-3 sm:px-5" aria-label="개인정보 보호 안내">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-good" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-fg">내용을 보여주지 않는 작업 기록</h3>
              <p className="mt-1 max-w-[75ch] text-[0.68rem] leading-relaxed text-fg-2">
                프롬프트 원문·해시, 제공자 요청 ID, 문서·컷·에셋 내부 ID, 시드는 이 화면에 표시하지 않습니다. 공개용 요약도 작업 종류·상태·제공자·모델·토큰 같은 비식별 정보만 전달합니다.
              </p>
              <p
                id="studio-ai-provenance-trust-boundary"
                className="mt-2 flex max-w-[75ch] items-start gap-1.5 border-t border-line/70 pt-2 text-[0.68rem] leading-relaxed text-warn"
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">검증 범위</strong> · 이 기록은 이 브라우저와 프로젝트에서 편집 가능한 로컬 작업 이력입니다. 제공자 서명·C2PA 콘텐츠 자격 증명·서버 검증 증명이 아닙니다.
                </span>
              </p>
            </div>
          </div>
        </section>

        <section className="shrink-0 border-b border-line bg-card/30" aria-label="AI 작업 필터">
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max gap-1.5 px-3 py-2 sm:px-5" role="group" aria-label="상태별 필터">
              <button
                type="button"
                aria-pressed={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
                className={`${BUTTON_CLASS} ${statusFilter === "all" ? "border-accent/50 bg-accent-soft text-accent" : ""}`}
              >
                전체 {formatCount(safeDocument.operations.length)}
              </button>
              {STUDIO_AI_OPERATION_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                  className={`${BUTTON_CLASS} ${statusFilter === status ? statusTone(status) : ""}`}
                >
                  <StatusIcon status={status} />
                  {STATUS_LABELS[status]} {formatCount(statusCounts[status])}
                </button>
              ))}
            </div>
          </div>

          <details className="border-t border-line/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-fg-2 marker:hidden hover:bg-raised/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-5 [&::-webkit-details-marker]:hidden">
              <Filter size={14} aria-hidden />
              세부 필터
              {hasActiveFilters && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.62rem] text-accent">적용 중</span>
              )}
              <ChevronDown size={14} className="ml-auto text-fg-3" aria-hidden />
            </summary>
            <div className="grid gap-3 border-t border-line/70 px-3 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">
              <label className="text-[0.68rem] font-semibold text-fg-2 lg:col-span-2">
                제공자 또는 모델 찾기
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value.slice(0, 180))}
                  maxLength={180}
                  placeholder="예: Z.ai, GLM"
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-xs text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-2">
                미디어
                <select
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.currentTarget.value as KindFilter)}
                  className={`mt-1 ${SELECT_CLASS}`}
                >
                  <option value="all">모두</option>
                  <option value="text">텍스트</option>
                  <option value="image">이미지</option>
                </select>
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-2">
                작업
                <select
                  value={taskFilter}
                  onChange={(event) => setTaskFilter(event.currentTarget.value as TaskFilter)}
                  className={`mt-1 ${SELECT_CLASS}`}
                >
                  <option value="all">모두</option>
                  {STUDIO_AI_OPERATION_TASKS.map((task) => (
                    <option key={task} value={task}>{TASK_LABELS[task]}</option>
                  ))}
                </select>
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-2">
                연결 경로
                <select
                  value={transportFilter}
                  onChange={(event) => setTransportFilter(event.currentTarget.value as TransportFilter)}
                  className={`mt-1 ${SELECT_CLASS}`}
                >
                  <option value="all">모두</option>
                  {STUDIO_AI_OPERATION_TRANSPORTS.map((transport) => (
                    <option key={transport} value={transport}>{TRANSPORT_LABELS[transport]}</option>
                  ))}
                </select>
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-2 lg:col-span-2">
                제공자
                <select
                  value={effectiveProviderFilter}
                  onChange={(event) => setProviderFilter(event.currentTarget.value)}
                  className={`mt-1 ${SELECT_CLASS}`}
                >
                  <option value="all">모두</option>
                  {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </label>
              <div className="flex items-end lg:col-span-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className={`${BUTTON_CLASS} w-full sm:w-auto`}
                >
                  <RotateCcw size={14} aria-hidden /> 필터 초기화
                </button>
              </div>
            </div>
          </details>
        </section>

        {(notice || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`shrink-0 border-b px-3 py-2 text-xs leading-relaxed sm:px-5 ${
              error ? "border-bad/35 bg-bad/10 text-bad" : "border-good/35 bg-good/10 text-good"
            }`}
          >
            {error || notice}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 text-[0.68rem] text-fg-3 sm:px-5">
            <span className="tabular-nums">
              표시 {formatCount(Math.min(visibleOperations.length, filteredOperations.length))} / {formatCount(filteredOperations.length)}건
            </span>
            <span>최신순</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {safeDocument.operations.length === 0 ? (
              <div className="grid min-h-full place-items-center px-6 py-12 text-center">
                <div className="max-w-sm">
                  <ShieldCheck size={28} className="mx-auto text-fg-3" aria-hidden />
                  <h3 className="mt-3 text-sm font-bold text-fg-2">아직 기록된 AI 작업이 없습니다</h3>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">
                    이 문서에서 AI 기능을 실행하면 제공자와 모델, 작업 상태, 토큰 사용량을 내용 없이 확인할 수 있어요.
                  </p>
                </div>
              </div>
            ) : filteredOperations.length === 0 ? (
              <div className="grid min-h-full place-items-center px-6 py-12 text-center">
                <div className="max-w-sm">
                  <Filter size={26} className="mx-auto text-fg-3" aria-hidden />
                  <h3 className="mt-3 text-sm font-bold text-fg-2">조건에 맞는 작업이 없습니다</h3>
                  <p className="mt-1 text-xs text-fg-3">상태나 세부 필터를 조정해 보세요.</p>
                  <button type="button" onClick={resetFilters} className={`${BUTTON_CLASS} mt-4`}>
                    <RotateCcw size={14} aria-hidden /> 모든 작업 보기
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ol className="divide-y divide-line" aria-label="AI 작업 감사 기록">
                  {visibleOperations.map((operation) => (
                    <li key={operation.id}>
                      <OperationRow operation={operation} />
                    </li>
                  ))}
                </ol>
                {visibleOperations.length < filteredOperations.length && (
                  <div className="border-t border-line px-3 py-4 text-center sm:px-5">
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((current) => current + DISPLAY_BATCH_SIZE)}
                      className={BUTTON_CLASS}
                    >
                      다음 {formatCount(Math.min(DISPLAY_BATCH_SIZE, filteredOperations.length - visibleOperations.length))}건 더 보기
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <footer
          className="shrink-0 border-t border-line bg-panel px-3 pt-2 sm:px-5"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {confirmClear && (
            <div role="alert" aria-labelledby="studio-ai-clear-title" className="mb-2 rounded-xl border border-bad/35 bg-bad/10 px-3 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h3 id="studio-ai-clear-title" className="text-xs font-bold text-fg">이 문서의 AI 작업 이력을 비울까요?</h3>
                  <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-2">
                    {formatCount(safeDocument.operations.length)}건의 감사 기록이 삭제됩니다. 이 작업은 패널에서 되돌릴 수 없습니다.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <button type="button" onClick={() => setConfirmClear(false)} disabled={clearing} className={BUTTON_CLASS}>
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void clearHistory()}
                  disabled={clearing || safeDocument.operations.length === 0}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-bad/45 bg-bad/15 px-3 text-xs font-bold text-bad transition-colors hover:bg-bad/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad disabled:cursor-wait disabled:opacity-45"
                >
                  {clearing ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 size={14} aria-hidden />}
                  {clearing ? "비우는 중…" : "확인하고 비우기"}
                </button>
              </div>
            </div>
          )}
          <p
            id="studio-ai-public-summary-trust-note"
            className="mb-2 max-w-[75ch] text-[0.65rem] leading-relaxed text-fg-3"
          >
            공개용 요약은 이 편집 가능한 로컬 기록을 비식별 형태로 변환한 파일입니다. 제공자 서명·C2PA·서버 검증 증명을 포함하지 않습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportPublicSummary()}
              disabled={exporting}
              aria-describedby="studio-ai-public-summary-trust-note"
              className={`${BUTTON_CLASS} min-w-0 flex-1 sm:flex-none`}
            >
              {exporting ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Download size={14} aria-hidden />}
              {exporting ? "내보내는 중…" : "공개용 요약 내보내기"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClear(true);
                setNotice(null);
                setError(null);
              }}
              disabled={safeDocument.operations.length === 0 || clearing}
              className={`${BUTTON_CLASS} min-w-0 flex-1 hover:border-bad/45 hover:bg-bad/10 hover:text-bad sm:flex-none`}
            >
              <Trash2 size={14} aria-hidden /> 기록 비우기
            </button>
            <button type="button" onClick={onClose} className={`${BUTTON_CLASS} w-full sm:ml-auto sm:w-auto`}>
              닫기
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, globalThis.document.body);
}
