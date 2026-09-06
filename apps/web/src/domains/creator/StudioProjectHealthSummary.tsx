import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  ShieldCheck,
} from "lucide-react";

import {
  lintStudioProjectHealth,
  type StudioProjectHealthCategory,
  type StudioProjectHealthSeverity,
  type StudioProjectHealthStatus,
} from "./studio-project-health-linter";

import type { StudioProductionInsights } from "./studio-production-insights";

export interface StudioProjectHealthSummaryProps {
  insights: StudioProductionInsights;
}

const STATUS_PRESENTATION: Record<
  StudioProjectHealthStatus,
  {
    label: string;
    className: string;
    icon: typeof CheckCircle2;
  }
> = {
  blocked: {
    label: "완료 전 차단",
    className: "border-bad/40 bg-bad/10 text-bad",
    icon: CircleAlert,
  },
  "needs-attention": {
    label: "확인 필요",
    className: "border-warn/40 bg-warn/10 text-warn",
    icon: AlertTriangle,
  },
  healthy: {
    label: "주요 문제 없음",
    className: "border-good/40 bg-good/10 text-good",
    icon: CheckCircle2,
  },
};

const SEVERITY_PRESENTATION: Record<
  StudioProjectHealthSeverity,
  {
    label: string;
    className: string;
    icon: typeof CheckCircle2;
  }
> = {
  blocking: {
    label: "차단",
    className: "text-bad",
    icon: CircleAlert,
  },
  warning: {
    label: "경고",
    className: "text-warn",
    icon: AlertTriangle,
  },
  notice: {
    label: "참고",
    className: "text-cool",
    icon: Info,
  },
};

const CATEGORY_LABELS: Record<StudioProjectHealthCategory, string> = {
  structure: "구조",
  review: "검토",
  workflow: "워크플로",
  integrity: "무결성",
};

export function StudioProjectHealthSummary({
  insights,
}: StudioProjectHealthSummaryProps) {
  const result = lintStudioProjectHealth(insights);
  const status = STATUS_PRESENTATION[result.status];
  const StatusIcon = status.icon;
  const passedPercent =
    result.checkedRuleCount > 0
      ? Math.round((result.passedRuleCount / result.checkedRuleCount) * 100)
      : 100;
  const issueSummary = [
    {
      label: "차단",
      count: result.counts.blocking,
      className: "text-bad",
    },
    {
      label: "경고",
      count: result.counts.warning,
      className: "text-warn",
    },
    {
      label: "참고",
      count: result.counts.notice,
      className: "text-cool",
    },
  ] as const;

  return (
    <section aria-labelledby="studio-project-health-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id="studio-project-health-title"
              className="flex items-center gap-1.5 text-sm font-bold text-fg"
            >
              <ShieldCheck size={15} className="text-accent" aria-hidden />
              프로젝트 건강 진단
            </h3>
            <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold text-fg-3">
              로컬 규칙 v{result.rulesetVersion}
            </span>
          </div>
          <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3">
            문서 구조·검토 상태·연결된 사전검사만 결정론적으로 확인합니다. 원고는 업로드하지 않아요.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.68rem] font-semibold ${status.className}`}
        >
          <StatusIcon size={11} aria-hidden />
          {status.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-40 flex-1">
          <div className="flex items-center justify-between gap-3 text-[0.68rem]">
            <span className="font-semibold text-fg-2">
              {result.passedRuleCount}/{result.checkedRuleCount} 규칙 통과
            </span>
            <span className="font-display tabular-nums text-fg-3">
              {passedPercent}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="프로젝트 건강 규칙 통과율"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={passedPercent}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"
          >
            <span
              className={`block h-full rounded-full ${
                result.status === "blocked"
                  ? "bg-bad"
                  : result.status === "needs-attention"
                    ? "bg-warn"
                    : "bg-good"
              }`}
              style={{ width: `${passedPercent}%` }}
            />
          </div>
        </div>
        <div
          className="flex divide-x divide-line rounded-lg border border-line bg-card/35"
          aria-label="프로젝트 건강 이슈 요약"
        >
          {issueSummary.map(({ label, count, className }) => (
            <span
              key={label}
              className="inline-flex min-w-16 items-center justify-center gap-1 px-2 py-1.5 text-[0.65rem] text-fg-3"
            >
              {label}
              <strong className={`font-display tabular-nums ${className}`}>
                {count}
              </strong>
            </span>
          ))}
        </div>
      </div>

      {result.issues.length === 0 ? (
        <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-xs leading-relaxed text-good">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
          현재 로컬 진단 범위에서 즉시 조치할 문제를 찾지 못했습니다.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {result.issues.map((issue) => {
            const severity = SEVERITY_PRESENTATION[issue.severity];
            const SeverityIcon = severity.icon;
            return (
              <li key={issue.code} className="flex items-start gap-2.5 py-3">
                <SeverityIcon
                  size={15}
                  className={`mt-0.5 shrink-0 ${severity.className}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-semibold text-fg">
                      {issue.title}
                    </p>
                    <span className="rounded-full bg-raised px-1.5 py-0.5 text-[0.62rem] font-semibold text-fg-3">
                      {CATEGORY_LABELS[issue.category]}
                    </span>
                    <span className={`sr-only`}>{severity.label}</span>
                  </div>
                  <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                    {issue.message}
                  </p>
                  <p className="mt-1 text-[0.68rem] font-medium leading-relaxed text-fg-2">
                    다음 조치 · {issue.action}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {result.issues.length > 1 && (
        <p className="mt-2 text-[0.65rem] leading-relaxed text-fg-3">
          규칙은 서로 다른 위험 관점을 보여주므로 같은 페이지가 여러 항목에 포함될 수 있습니다.
        </p>
      )}
    </section>
  );
}
