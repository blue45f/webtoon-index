import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  FileStack,
  LockKeyhole,
  MessageCircle,
  Quote,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { StudioProjectHealthSummary } from "./StudioProjectHealthSummary";

import type {
  StudioProductionInsights,
  StudioProductionIssueSeverity,
  StudioProductionLimitedArea,
  StudioProductionReviewStatus,
} from "./studio-production-insights";

export interface StudioProductionInsightsPanelProps {
  open: boolean;
  onClose: () => void;
  insights: StudioProductionInsights;
}

const numberFormatter = new Intl.NumberFormat("ko-KR");
const decimalFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});

const REVIEW_STATUS_ROWS: ReadonlyArray<{
  status: StudioProductionReviewStatus | "untracked";
  label: string;
  dotClassName: string;
  barClassName: string;
}> = [
  {
    status: "draft",
    label: "초안",
    dotClassName: "bg-fg-3",
    barClassName: "bg-fg-3",
  },
  {
    status: "needs-review",
    label: "검토 대기",
    dotClassName: "bg-cool",
    barClassName: "bg-cool",
  },
  {
    status: "changes-requested",
    label: "수정 요청",
    dotClassName: "bg-warn",
    barClassName: "bg-warn",
  },
  {
    status: "approved",
    label: "승인",
    dotClassName: "bg-good",
    barClassName: "bg-good",
  },
  {
    status: "untracked",
    label: "미추적",
    dotClassName: "bg-line-strong",
    barClassName: "bg-line-strong",
  },
];

const ISSUE_SEVERITY_ROWS: ReadonlyArray<{
  severity: StudioProductionIssueSeverity;
  label: string;
  className: string;
}> = [
  { severity: "error", label: "오류", className: "text-bad" },
  { severity: "warning", label: "경고", className: "text-warn" },
  { severity: "info", label: "정보", className: "text-cool" },
];

const LIMITED_AREA_LABELS: Record<StudioProductionLimitedArea, string> = {
  pages: "페이지",
  frames: "컷",
  text: "텍스트",
  assets: "에셋",
  issues: "이슈",
};

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function formatPercent(value: number): string {
  return `${decimalFormatter.format(value)}%`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatReadingTime(insights: StudioProductionInsights): string {
  const { estimatedSeconds, roundedUpMinutes } = insights.readingTime;
  if (estimatedSeconds <= 0) return "0초";
  if (estimatedSeconds < 60) return `${formatCount(estimatedSeconds)}초`;
  return `약 ${formatCount(roundedUpMinutes)}분`;
}

interface CoverageRowProps {
  label: string;
  value: number;
  detail: string;
  barClassName: string;
}

function CoverageRow({ label, value, detail, barClassName }: CoverageRowProps) {
  const boundedValue = clampPercent(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-fg-2">{label}</span>
        <span className="font-display tabular-nums text-fg">{formatPercent(value)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={boundedValue}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <span
          className={`block h-full rounded-full ${barClassName}`}
          style={{ width: `${boundedValue}%` }}
        />
      </div>
      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">{detail}</p>
    </div>
  );
}

export function StudioProductionInsightsPanel({
  open,
  onClose,
  insights,
}: StudioProductionInsightsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("hidden"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const hasDocumentStructure =
    insights.pages.totalCount > 0 ||
    insights.frames.totalCount > 0 ||
    insights.text.total.textCount > 0 ||
    insights.assets.totalCount > 0;
  const reviewTrackedCount =
    insights.pages.totalCount - insights.review.statusCounts.untracked;
  const unresolvedIssueCount =
    insights.issues.actionableCount + insights.issues.suppressedCount;
  const hasNormalizationWarnings =
    insights.normalization.malformedEntryCount > 0 || insights.normalization.limitsApplied;

  const modal = (
    <div className="fixed inset-0 z-[80] p-2 text-fg sm:p-4">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.84)] backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-production-insights-title"
        aria-describedby="studio-production-insights-description"
        tabIndex={-1}
        className="relative mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)] outline-none"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <BarChart3 size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="studio-production-insights-title"
                className="text-base font-bold tracking-tight text-fg"
              >
                프로덕션 인사이트
              </h2>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold text-fg-3">
                로컬 계산
              </span>
            </div>
            <p
              id="studio-production-insights-description"
              className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3"
            >
              현재 에피소드의 문서 구조를 읽어 제작량, 검토 흐름, AI 에셋과 해결할 이슈를 한눈에 정리합니다.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="프로덕션 인사이트 닫기"
            title="닫기 (Esc)"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          {!hasDocumentStructure && (
            <section
              aria-labelledby="production-insights-empty-title"
              className="grid min-h-52 place-items-center rounded-xl border border-dashed border-line bg-card/30 px-5 py-10 text-center"
            >
              <div className="max-w-md">
                <FileStack size={28} className="mx-auto text-fg-3" aria-hidden />
                <h3 id="production-insights-empty-title" className="mt-3 text-sm font-bold text-fg">
                  아직 분석할 제작 구조가 없어요
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-3">
                  페이지에 컷, 대사, 내레이션이나 에셋을 추가하면 제작량과 검토 커버리지가 여기에 자동으로 나타납니다.
                </p>
                <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">
                  읽기 시간은 독자 추적값이 아니라 공백 제외 300자/분과 컷당 2초를 더한 편집용 추정치입니다.
                </p>
              </div>
            </section>
          )}

          {!hasDocumentStructure && <div className="my-5 border-t border-line" />}

          <StudioProjectHealthSummary insights={insights} />

          {hasDocumentStructure && (
            <>
              <div className="my-5 border-t border-line" />

              <section aria-labelledby="production-volume-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="production-volume-title" className="text-sm font-bold text-fg">
                      제작량
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">페이지부터 읽기 흐름까지, 현재 저장 구조의 스냅샷입니다.</p>
                  </div>
                  <span className="text-[0.68rem] text-fg-3">공백 제외 텍스트 기준</span>
                </div>

                <dl className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/40 sm:grid sm:grid-cols-5 sm:divide-x sm:divide-y-0">
                  <div className="flex items-center gap-3 px-3 py-3 sm:block sm:px-3.5 sm:py-3.5">
                    <FileStack size={16} className="shrink-0 text-accent sm:mb-3" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[0.68rem] font-semibold text-fg-3">페이지</dt>
                      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-fg">
                        {formatCount(insights.pages.totalCount)}
                      </dd>
                      <dd className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                        내용 있음 {formatCount(insights.pages.withFramesCount)} · 빈 페이지 {formatCount(insights.pages.emptyCount)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-3 sm:block sm:px-3.5 sm:py-3.5">
                    <BarChart3 size={16} className="shrink-0 text-cool sm:mb-3" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[0.68rem] font-semibold text-fg-3">컷</dt>
                      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-fg">
                        {formatCount(insights.frames.totalCount)}
                      </dd>
                      <dd className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                        페이지당 평균 {decimalFormatter.format(insights.frames.averagePerPage)}컷
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-3 sm:block sm:px-3.5 sm:py-3.5">
                    <MessageCircle size={16} className="shrink-0 text-good sm:mb-3" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[0.68rem] font-semibold text-fg-3">대사</dt>
                      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-fg">
                        {formatCount(insights.text.dialogue.textCount)}
                      </dd>
                      <dd className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                        {formatCount(insights.text.dialogue.characterCount)}자
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-3 sm:block sm:px-3.5 sm:py-3.5">
                    <Quote size={16} className="shrink-0 text-warn sm:mb-3" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[0.68rem] font-semibold text-fg-3">내레이션</dt>
                      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-fg">
                        {formatCount(insights.text.narration.textCount)}
                      </dd>
                      <dd className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                        {formatCount(insights.text.narration.characterCount)}자
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-3 sm:block sm:px-3.5 sm:py-3.5">
                    <Clock3 size={16} className="shrink-0 text-accent sm:mb-3" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[0.68rem] font-semibold text-fg-3">읽기 시간 추정</dt>
                      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-fg">
                        {formatReadingTime(insights)}
                      </dd>
                      <dd className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                        편집용 휴리스틱 · 행동 분석 아님
                      </dd>
                    </div>
                  </div>
                </dl>
                <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">
                  읽기 시간 계산: 공백 제외 {formatCount(insights.text.total.characterCount)}자 ÷ {formatCount(insights.readingTime.visibleCharactersPerMinute)}자/분 + {formatCount(insights.frames.totalCount)}컷 × {formatCount(insights.readingTime.secondsPerFrame)}초.
                </p>
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="review-pipeline-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="review-pipeline-title" className="text-sm font-bold text-fg">
                      검토 파이프라인
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">상태 추적과 편집 잠금이 전체 페이지에 얼마나 적용됐는지 보여줍니다.</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-1 text-[0.68rem] font-semibold text-fg-2">
                    <LockKeyhole size={11} aria-hidden /> 잠금 {formatCount(insights.review.lockedPageCount)}
                  </span>
                </div>

                <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
                  <div className="min-w-0 rounded-xl border border-line bg-card/35 p-3.5">
                    <div
                      className="flex h-2 overflow-hidden rounded-full bg-raised"
                      aria-hidden="true"
                    >
                      {REVIEW_STATUS_ROWS.map((row) => {
                        const count = insights.review.statusCounts[row.status];
                        const width = insights.pages.totalCount > 0
                          ? (count / insights.pages.totalCount) * 100
                          : 0;
                        return (
                          <span
                            key={row.status}
                            className={row.barClassName}
                            style={{ width: `${clampPercent(width)}%` }}
                          />
                        );
                      })}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                      {REVIEW_STATUS_ROWS.map((row) => (
                        <div key={row.status} className="flex items-center justify-between gap-2 text-xs">
                          <dt className="flex min-w-0 items-center gap-1.5 text-fg-3">
                            <span className={`size-1.5 shrink-0 rounded-full ${row.dotClassName}`} aria-hidden />
                            <span className="truncate">{row.label}</span>
                          </dt>
                          <dd className="font-display tabular-nums text-fg">
                            {formatCount(insights.review.statusCounts[row.status])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-3 border-t border-line pt-2 text-[0.68rem] leading-relaxed text-fg-3">
                      상태 추적 {formatCount(reviewTrackedCount)}/{formatCount(insights.pages.totalCount)} · 승인 후 잠금 {formatCount(insights.review.approvedAndLockedPageCount)} · 승인됐지만 잠금 해제 {formatCount(insights.review.approvedUnlockedPageCount)}
                    </p>
                    {insights.review.approvedUnlockedPageCount > 0 && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.68rem] leading-relaxed text-warn">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                        승인된 페이지 {formatCount(insights.review.approvedUnlockedPageCount)}개가 잠겨 있지 않습니다. 실수 편집 위험을 확인하세요.
                      </p>
                    )}
                  </div>

                  <div className="space-y-3.5">
                    <CoverageRow
                      label="상태 추적 커버리지"
                      value={insights.review.coverage.trackedPercent}
                      detail={`${formatCount(reviewTrackedCount)}개 페이지에 검토 상태가 있습니다.`}
                      barClassName="bg-cool"
                    />
                    <CoverageRow
                      label="승인 커버리지"
                      value={insights.review.coverage.approvedPercent}
                      detail={`${formatCount(insights.review.statusCounts.approved)}개 페이지가 승인됐습니다.`}
                      barClassName="bg-good"
                    />
                    <CoverageRow
                      label="잠금 커버리지"
                      value={insights.review.coverage.lockedPercent}
                      detail={`${formatCount(insights.review.lockedPageCount)}개 페이지가 로컬 편집 잠금 상태입니다.`}
                      barClassName="bg-accent"
                    />
                    <CoverageRow
                      label="수정 요청 비율"
                      value={insights.review.coverage.changesRequestedPercent}
                      detail={`${formatCount(insights.review.statusCounts["changes-requested"])}개 페이지에 수정 요청이 있습니다.`}
                      barClassName="bg-warn"
                    />
                  </div>
                </div>
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="ai-provenance-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="ai-provenance-title" className="flex items-center gap-1.5 text-sm font-bold text-fg">
                      <Bot size={15} className="text-accent" aria-hidden /> AI 에셋 출처
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">문서에 명시적으로 기록된 생성·편집 표지만 집계합니다.</p>
                  </div>
                  <span className="font-display text-sm font-bold tabular-nums text-fg">
                    {formatCount(insights.assets.aiAffectedCount)}/{formatCount(insights.assets.totalCount)} 영향
                  </span>
                </div>

                {insights.assets.totalCount === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-line bg-card/25 px-3 py-5 text-center text-xs leading-relaxed text-fg-3">
                    집계할 이미지·소재 에셋이 없습니다. 에셋을 추가하고 AI 생성 또는 편집 표지를 남기면 출처 현황이 표시됩니다.
                  </p>
                ) : (
                  <div className="mt-3 rounded-xl border border-line bg-card/35 p-3.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-fg-2">AI 영향 에셋 비율</span>
                      <span className="font-display tabular-nums text-fg">{formatPercent(insights.assets.aiAffectedPercent)}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="AI 영향 에셋 비율"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={clampPercent(insights.assets.aiAffectedPercent)}
                      className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${clampPercent(insights.assets.aiAffectedPercent)}%` }}
                      />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4">
                      <div className="flex items-center justify-between gap-2 border-b border-line/70 pb-2 sm:border-b-0 sm:pb-0">
                        <dt className="text-fg-3">전체</dt>
                        <dd className="font-display tabular-nums text-fg">{formatCount(insights.assets.totalCount)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-line/70 pb-2 sm:border-b-0 sm:pb-0">
                        <dt className="text-fg-3">AI 생성</dt>
                        <dd className="font-display tabular-nums text-fg">{formatCount(insights.assets.aiGeneratedCount)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-fg-3">AI 편집</dt>
                        <dd className="font-display tabular-nums text-fg">{formatCount(insights.assets.aiEditedCount)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-fg-3">생성+편집</dt>
                        <dd className="font-display tabular-nums text-fg">{formatCount(insights.assets.aiGeneratedAndEditedCount)}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-[0.68rem] leading-relaxed text-fg-3">
                      생성과 편집 수치는 서로 겹칠 수 있습니다. 표지가 없는 에셋을 AI 미사용으로 추정하지 않으며, 전달된 명시값만 반영합니다.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}

          {(hasDocumentStructure || insights.issues.totalCount > 0) && (
            <>
              <div className="my-5 border-t border-line" />

              <section aria-labelledby="issue-status-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="issue-status-title" className="text-sm font-bold text-fg">
                      이슈 상태
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">해결·제외 상태를 구분해 지금 조치할 항목만 드러냅니다.</p>
                  </div>
                  {insights.issues.blockingCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-bad/40 bg-bad/10 px-2 py-1 text-[0.68rem] font-semibold text-bad">
                      <AlertTriangle size={11} aria-hidden /> 차단 {formatCount(insights.issues.blockingCount)}
                    </span>
                  ) : insights.issues.actionableCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-1 text-[0.68rem] font-semibold text-warn">
                      <AlertTriangle size={11} aria-hidden /> 조치 필요 {formatCount(insights.issues.actionableCount)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-good/40 bg-good/10 px-2 py-1 text-[0.68rem] font-semibold text-good">
                      <CheckCircle2 size={11} aria-hidden /> 열린 조치 없음
                    </span>
                  )}
                </div>

                <dl className="mt-3 flex flex-wrap divide-x divide-line rounded-xl border border-line bg-card/35 px-1 py-3">
                  {[
                    ["전체", insights.issues.totalCount],
                    ["조치 필요", insights.issues.actionableCount],
                    ["게시 차단", insights.issues.blockingCount],
                    ["해결", insights.issues.resolvedCount],
                    ["제외", insights.issues.suppressedCount],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-[6.5rem] flex-1 px-3 py-1">
                      <dt className="text-[0.68rem] text-fg-3">{label}</dt>
                      <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-fg">
                        {formatCount(value as number)}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 overflow-hidden rounded-xl border border-line">
                  <table className="w-full table-fixed text-left text-xs">
                    <caption className="sr-only">심각도별 전체, 조치 필요, 해결, 제외 이슈 수</caption>
                    <thead className="bg-raised/70 text-[0.68rem] text-fg-3">
                      <tr>
                        <th scope="col" className="w-[28%] px-3 py-2 font-semibold">심각도</th>
                        <th scope="col" className="px-1 py-2 text-right font-semibold">전체</th>
                        <th scope="col" className="px-1 py-2 text-right font-semibold">조치</th>
                        <th scope="col" className="px-1 py-2 text-right font-semibold">해결</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">제외</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-card/30">
                      {ISSUE_SEVERITY_ROWS.map((row) => {
                        const summary = insights.issues.bySeverity[row.severity];
                        return (
                          <tr key={row.severity}>
                            <th scope="row" className={`px-3 py-2.5 font-semibold ${row.className}`}>{row.label}</th>
                            <td className="px-1 py-2.5 text-right font-display tabular-nums text-fg-2">{formatCount(summary.totalCount)}</td>
                            <td className="px-1 py-2.5 text-right font-display tabular-nums text-fg">{formatCount(summary.actionableCount)}</td>
                            <td className="px-1 py-2.5 text-right font-display tabular-nums text-fg-2">{formatCount(summary.resolvedCount)}</td>
                            <td className="px-3 py-2.5 text-right font-display tabular-nums text-fg-2">{formatCount(summary.suppressedCount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {(insights.issues.unclassifiedCount > 0 || unresolvedIssueCount > insights.issues.actionableCount) && (
                  <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">
                    분류되지 않은 이슈 {formatCount(insights.issues.unclassifiedCount)}개 · 조치 대상에서 명시적으로 제외된 열린 이슈 {formatCount(insights.issues.suppressedCount)}개. 분류되지 않은 이슈는 자동으로 차단 처리하지 않습니다.
                  </p>
                )}
              </section>
            </>
          )}

          <div className="my-5 border-t border-line" />

          <section aria-labelledby="normalization-status-title">
            <h3 id="normalization-status-title" className="text-sm font-bold text-fg">
              데이터 정규화
            </h3>
            {hasNormalizationWarnings ? (
              <div className="mt-2.5 rounded-xl border border-warn/35 bg-warn/10 px-3 py-3 text-warn" role="status">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">일부 입력을 안전하게 정리해 계산했습니다</p>
                    <ul className="mt-1.5 space-y-1 text-[0.68rem] leading-relaxed">
                      {insights.normalization.malformedEntryCount > 0 && (
                        <li>형식이 맞지 않는 항목 {formatCount(insights.normalization.malformedEntryCount)}개를 무시했습니다.</li>
                      )}
                      {insights.normalization.limitsApplied && (
                        <li>과도한 입력을 제한해 실제 문서보다 합계가 작을 수 있습니다.</li>
                      )}
                    </ul>
                    {insights.normalization.limitedAreas.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1" aria-label="입력 제한이 적용된 영역">
                        {insights.normalization.limitedAreas.map((area) => (
                          <span key={area} className="rounded-full border border-warn/35 bg-panel/50 px-2 py-0.5 text-[0.65rem] font-semibold">
                            {LIMITED_AREA_LABELS[area]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2.5 flex items-start gap-2 rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-xs leading-relaxed text-good" role="status">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
                잘못된 항목이나 입력 한도 적용 없이 전달된 문서 구조 전체를 계산했습니다.
              </p>
            )}
          </section>
        </div>

        <aside className="shrink-0 border-t border-line bg-card/45 px-4 py-3 sm:px-5" aria-label="데이터 범위 안내">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cool" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-fg-2">로컬 문서 구조만 사용합니다</p>
              <p className="mt-0.5 max-w-[75ch] text-[0.68rem] leading-relaxed text-fg-3">
                이 화면은 전달된 페이지·컷·텍스트·에셋·검토·이슈 구조를 집계한 편집 보조 정보입니다. 독자 행동, 조회·완독 성과, 원격 분석 또는 텔레메트리 데이터는 수집하거나 표시하지 않습니다.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
