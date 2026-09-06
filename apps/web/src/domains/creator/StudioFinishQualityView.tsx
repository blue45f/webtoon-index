import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  STUDIO_FINISH_QUALITY_CATEGORIES,
  STUDIO_FINISH_QUALITY_SEVERITIES,
} from "./studio-finish-quality";

import type {
  StudioFinishQualityCategory,
  StudioFinishQualityIssue,
  StudioFinishQualityResult,
  StudioFinishQualitySeverity,
} from "./studio-finish-quality";

const SEVERITY_META: Readonly<
  Record<
    StudioFinishQualitySeverity,
    {
      label: string;
      icon: typeof ShieldAlert;
      className: string;
      badgeClassName: string;
    }
  >
> = {
  blocker: {
    label: "차단",
    icon: ShieldAlert,
    className: "border-bad/40 bg-bad/10",
    badgeClassName: "border-bad/40 bg-bad/10 text-bad",
  },
  error: {
    label: "오류",
    icon: XCircle,
    className: "border-bad/30 bg-bad/5",
    badgeClassName: "border-bad/35 bg-bad/10 text-bad",
  },
  warning: {
    label: "경고",
    icon: AlertTriangle,
    className: "border-warning/35 bg-warning-soft/15",
    badgeClassName: "border-warning/35 bg-warning-soft/20 text-warning",
  },
  info: {
    label: "확인",
    icon: Info,
    className: "border-line bg-card/45",
    badgeClassName: "border-line bg-panel text-fg-2",
  },
};

const CATEGORY_LABELS: Readonly<Record<StudioFinishQualityCategory, string>> = {
  document: "문서",
  page: "페이지",
  review: "승인",
  layer: "레이어",
  dialogue: "대사·말풍선",
  image: "이미지",
  animation: "애니메이션",
  stroke: "획 데이터",
  comments: "댓글",
};

const STATUS_COPY: Readonly<
  Record<
    StudioFinishQualityResult["status"],
    { title: string; description: string; className: string; icon: typeof ShieldAlert }
  >
> = {
  blocked: {
    title: "출고를 차단해야 하는 원고 손상이 있습니다",
    description: "차단 항목을 먼저 해결한 뒤 다시 검사하세요.",
    className: "border-bad/40 bg-bad/10",
    icon: ShieldAlert,
  },
  "needs-work": {
    title: "수정이 필요한 마감 항목이 있습니다",
    description: "오류 위치로 이동해 원고와 검토 상태를 정리하세요.",
    className: "border-bad/30 bg-bad/5",
    icon: XCircle,
  },
  review: {
    title: "자동 검사는 통과했고 사람의 최종 확인이 필요합니다",
    description: "경고는 연출 의도와 실제 독자 화면을 기준으로 판단하세요.",
    className: "border-warning/35 bg-warning-soft/15",
    icon: AlertTriangle,
  },
  ready: {
    title: "현재 자동 마감 검사를 통과했습니다",
    description: "최종 독자 미리보기와 담당자 승인을 이어서 진행하세요.",
    className: "border-good/35 bg-good/10",
    icon: CheckCircle2,
  },
};

type SeverityFilter = "all" | StudioFinishQualitySeverity;
type CategoryFilter = "all" | StudioFinishQualityCategory;

export interface StudioFinishQualityViewProps {
  result: StudioFinishQualityResult;
  onSelectIssue?: (issue: StudioFinishQualityIssue) => void;
  onDownloadReport?: () => void;
}

function locationText(issue: StudioFinishQualityIssue): string {
  const parts: string[] = [];
  if (issue.pageIndex !== undefined) parts.push(`${issue.pageIndex + 1}페이지`);
  if (issue.elementId) parts.push(`요소 ${issue.elementId}`);
  return parts.join(" · ") || "문서 전체";
}

function IssueRow({
  issue,
  onSelect,
}: {
  issue: StudioFinishQualityIssue;
  onSelect?: (issue: StudioFinishQualityIssue) => void;
}) {
  const meta = SEVERITY_META[issue.severity];
  const Icon = meta.icon;
  const content = (
    <>
      <Icon
        size={16}
        aria-hidden
        className={issue.severity === "warning" ? "text-warning" : issue.severity === "info" ? "text-fg-2" : "text-bad"}
      />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-bold ${meta.badgeClassName}`}>
            {meta.label}
          </span>
          <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[0.64rem] font-semibold text-fg-2">
            {CATEGORY_LABELS[issue.category]}
          </span>
          <span className="text-[0.65rem] text-fg-3">{locationText(issue)}</span>
        </span>
        <span className="mt-1.5 block text-xs font-bold leading-relaxed text-fg">
          {issue.title}
        </span>
        <span className="mt-0.5 block text-[0.72rem] leading-relaxed text-fg-2">
          {issue.message}
        </span>
      </span>
    </>
  );

  if (!onSelect || (!issue.pageId && !issue.elementId)) {
    return <li className={`flex items-start gap-2.5 px-3 py-3 ${meta.className}`}>{content}</li>;
  }
  return (
    <li className={meta.className}>
      <button
        type="button"
        onClick={() => onSelect(issue)}
        aria-label={`${issue.title}, ${locationText(issue)}로 이동`}
        className="flex w-full items-start gap-2.5 px-3 py-3 transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/65"
      >
        {content}
      </button>
    </li>
  );
}

export function StudioFinishQualityView({
  result,
  onSelectIssue,
  onDownloadReport,
}: StudioFinishQualityViewProps) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const status = STATUS_COPY[result.status];
  const StatusIcon = status.icon;

  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
    return result.issues.filter((issue) => {
      if (severity !== "all" && issue.severity !== severity) return false;
      if (category !== "all" && issue.category !== category) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        issue.title,
        issue.message,
        issue.code,
        issue.pageId ?? "",
        issue.elementId ?? "",
        CATEGORY_LABELS[issue.category],
      ]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [category, query, result.issues, severity]);

  return (
    <section
      aria-labelledby="studio-finish-quality-title"
      data-studio-finish-quality-view="true"
      className="rounded-2xl border border-line bg-card/30 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="studio-finish-quality-title" className="text-sm font-bold text-fg">
            마감 품질 검사
          </h3>
          <p className="mt-0.5 text-[0.72rem] leading-relaxed text-fg-2">
            원고 구조·대사·말풍선·레이어·이미지·획·애니메이션·승인·댓글을 현재 문서에서 결정적으로 검사합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="grid min-w-16 place-items-center rounded-xl border border-line bg-panel px-3 py-2"
            aria-label={`마감 품질 점수 ${result.score}점`}
          >
            <strong className="text-lg font-black tabular-nums text-fg">{result.score}</strong>
            <span className="text-[0.6rem] font-semibold text-fg-3">/ 100</span>
          </span>
          {onDownloadReport ? (
            <button
              type="button"
              onClick={onDownloadReport}
              aria-label="마감 품질 검사 JSON 보고서 다운로드"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/65"
            >
              <Download size={14} aria-hidden /> 보고서
            </button>
          ) : null}
        </div>
      </div>

      <div className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3 ${status.className}`} role="status">
        <StatusIcon size={17} aria-hidden className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-fg">{status.title}</p>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-2">{status.description}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="마감 품질 검사 개수">
        {STUDIO_FINISH_QUALITY_SEVERITIES.map((value) => {
          const meta = SEVERITY_META[value];
          return (
            <div key={value} className="rounded-xl border border-line bg-panel px-3 py-2">
              <dt className="text-[0.65rem] font-semibold text-fg-3">{meta.label}</dt>
              <dd className="mt-0.5 text-base font-black tabular-nums text-fg">{result.counts[value]}</dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem]">
        <label className="relative block">
          <span className="sr-only">검사 결과 검색</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="문제·코드·페이지 검색"
            className="min-h-10 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent"
          />
        </label>
        <label>
          <span className="sr-only">심각도 필터</span>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as SeverityFilter)}
            className="min-h-10 w-full rounded-xl border border-line bg-panel px-3 text-xs text-fg outline-none focus:border-accent"
          >
            <option value="all">모든 심각도</option>
            {STUDIO_FINISH_QUALITY_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {SEVERITY_META[value].label} {result.counts[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">검사 영역 필터</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CategoryFilter)}
            className="min-h-10 w-full rounded-xl border border-line bg-panel px-3 text-xs text-fg outline-none focus:border-accent"
          >
            <option value="all">모든 검사 영역</option>
            {STUDIO_FINISH_QUALITY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.66rem] text-fg-3">
        <span>페이지 {result.checkedPageCount}</span>
        <span>요소 {result.checkedElementCount}</span>
        <span>대사 {result.checkedDialogueCount}</span>
        <span>이미지 {result.checkedImageCount}</span>
        <span>획 {result.checkedStrokeCount}</span>
        <span>열린 댓글 {result.openCommentCount}</span>
        <span className="ml-auto font-semibold text-fg-2">
          표시 {filteredIssues.length} / 전체 {result.counts.total}
        </span>
      </div>

      {result.truncated ? (
        <p className="mt-3 rounded-lg border border-warning/35 bg-warning-soft/15 px-3 py-2 text-[0.7rem] leading-relaxed text-warning">
          문제 수가 안전 상한을 넘어 일부 결과만 표시합니다. 심각한 구조 문제부터 줄인 뒤 다시 검사하세요.
        </p>
      ) : null}

      {filteredIssues.length === 0 ? (
        <div className="mt-3 grid min-h-28 place-items-center rounded-xl border border-dashed border-line bg-panel/60 px-4 text-center">
          <div>
            <CheckCircle2 size={22} aria-hidden className="mx-auto text-good" />
            <p className="mt-2 text-xs font-bold text-fg">
              {result.issues.length === 0 ? "자동 검사에서 문제를 찾지 못했습니다" : "현재 필터에 맞는 문제가 없습니다"}
            </p>
          </div>
        </div>
      ) : (
        <ol className="mt-3 max-h-[28rem] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {filteredIssues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onSelect={onSelectIssue} />
          ))}
        </ol>
      )}

      <p className="mt-3 text-[0.66rem] leading-relaxed text-fg-3">
        자동 검사는 확정 가능한 구조와 기계적 위험만 판단합니다. 연출·표현·문맥과 플랫폼 최신 정책은 작가와 검수자가 최종 결정합니다.
      </p>
    </section>
  );
}
