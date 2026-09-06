import type {
  StudioProductionInsights,
  StudioProductionLimitedArea,
} from "./studio-production-insights";

export const STUDIO_PROJECT_HEALTH_RULESET_VERSION = 1 as const;

export type StudioProjectHealthStatus =
  | "healthy"
  | "needs-attention"
  | "blocked";

export type StudioProjectHealthSeverity = "blocking" | "warning" | "notice";

export type StudioProjectHealthCategory =
  | "structure"
  | "review"
  | "workflow"
  | "integrity";

export type StudioProjectHealthIssueCode =
  | "PROJECT_EMPTY"
  | "PAGE_WITHOUT_FRAME"
  | "REVIEW_UNTRACKED"
  | "REVIEW_CHANGES_REQUESTED"
  | "APPROVED_PAGE_UNLOCKED"
  | "LINKED_BLOCKING_ISSUES"
  | "LINKED_ACTIONABLE_ISSUES"
  | "SUPPRESSED_OPEN_ISSUES"
  | "MALFORMED_DOCUMENT_INPUT"
  | "ANALYSIS_LIMIT_APPLIED";

export interface StudioProjectHealthIssue {
  readonly code: StudioProjectHealthIssueCode;
  readonly severity: StudioProjectHealthSeverity;
  readonly category: StudioProjectHealthCategory;
  readonly count: number;
  readonly title: string;
  readonly message: string;
  readonly action: string;
}

export interface StudioProjectHealthResult {
  readonly basis: "studio-production-insights";
  readonly rulesetVersion: typeof STUDIO_PROJECT_HEALTH_RULESET_VERSION;
  readonly status: StudioProjectHealthStatus;
  readonly checkedRuleCount: number;
  readonly passedRuleCount: number;
  readonly counts: Readonly<Record<StudioProjectHealthSeverity, number>>;
  readonly issues: readonly StudioProjectHealthIssue[];
}

interface StudioProjectHealthRule {
  readonly code: StudioProjectHealthIssueCode;
  readonly evaluate: (
    insights: StudioProductionInsights,
  ) => StudioProjectHealthIssue | null;
}

const LIMITED_AREA_LABELS: Record<StudioProductionLimitedArea, string> = {
  pages: "페이지",
  frames: "컷",
  text: "텍스트",
  assets: "에셋",
  issues: "이슈",
};

const SEVERITY_ORDER: Record<StudioProjectHealthSeverity, number> = {
  blocking: 0,
  warning: 1,
  notice: 2,
};

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function healthIssue(
  code: StudioProjectHealthIssueCode,
  severity: StudioProjectHealthSeverity,
  category: StudioProjectHealthCategory,
  count: number,
  title: string,
  message: string,
  action: string,
): StudioProjectHealthIssue {
  return Object.freeze({
    code,
    severity,
    category,
    count: safeCount(count),
    title,
    message,
    action,
  });
}

const STUDIO_PROJECT_HEALTH_RULES: readonly StudioProjectHealthRule[] = [
  {
    code: "PROJECT_EMPTY",
    evaluate: (insights) =>
      insights.pages.totalCount === 0
        ? healthIssue(
            "PROJECT_EMPTY",
            "warning",
            "structure",
            1,
            "진단할 페이지가 없습니다",
            "현재 프로젝트에는 제작 구조로 집계할 페이지가 없습니다.",
            "첫 페이지를 추가한 뒤 다시 진단하세요.",
          )
        : null,
  },
  {
    code: "PAGE_WITHOUT_FRAME",
    evaluate: (insights) => {
      const count = safeCount(insights.pages.emptyCount);
      if (count === 0) return null;
      const allPages = count === safeCount(insights.pages.totalCount);
      return healthIssue(
        "PAGE_WITHOUT_FRAME",
        allPages ? "warning" : "notice",
        "structure",
        count,
        `컷 구조가 없는 페이지 ${count}개`,
        allPages
          ? "모든 페이지가 컷 프레임 없이 구성되어 제작 순서와 검토 범위를 추적하기 어렵습니다."
          : "일부 페이지에 컷 프레임이 없어 컷 단위 검토와 출고 점검에서 제외될 수 있습니다.",
        "풀블리드 연출이라면 유지하고, 일반 페이지라면 컷 프레임을 추가하세요.",
      );
    },
  },
  {
    code: "REVIEW_UNTRACKED",
    evaluate: (insights) => {
      const count = safeCount(insights.review.statusCounts.untracked);
      return count > 0
        ? healthIssue(
            "REVIEW_UNTRACKED",
            "warning",
            "review",
            count,
            `검토 상태가 없는 페이지 ${count}개`,
            "담당자와 승인 여부를 알 수 없어 역할 인계와 출고 판단이 불명확합니다.",
            "페이지 검토 상태를 초안·검토 대기·수정 요청·승인 중 하나로 지정하세요.",
          )
        : null;
    },
  },
  {
    code: "REVIEW_CHANGES_REQUESTED",
    evaluate: (insights) => {
      const count = safeCount(
        insights.review.statusCounts["changes-requested"],
      );
      return count > 0
        ? healthIssue(
            "REVIEW_CHANGES_REQUESTED",
            "blocking",
            "review",
            count,
            `수정 요청 페이지 ${count}개`,
            "검토자가 반영을 요청한 페이지가 남아 있어 현재 버전을 완료본으로 취급할 수 없습니다.",
            "수정 요청을 반영하거나 검토자와 합의해 상태를 갱신하세요.",
          )
        : null;
    },
  },
  {
    code: "APPROVED_PAGE_UNLOCKED",
    evaluate: (insights) => {
      const count = safeCount(insights.review.approvedUnlockedPageCount);
      return count > 0
        ? healthIssue(
            "APPROVED_PAGE_UNLOCKED",
            "warning",
            "review",
            count,
            `승인 후 잠금이 풀린 페이지 ${count}개`,
            "승인된 결과가 실수로 변경되어 검토 기준과 실제 원고가 달라질 수 있습니다.",
            "추가 수정이 필요하지 않다면 승인 페이지를 잠그세요.",
          )
        : null;
    },
  },
  {
    code: "LINKED_BLOCKING_ISSUES",
    evaluate: (insights) => {
      const count = safeCount(insights.issues.blockingCount);
      return count > 0
        ? healthIssue(
            "LINKED_BLOCKING_ISSUES",
            "blocking",
            "workflow",
            count,
            `연결된 검사에서 차단 이슈 ${count}개`,
            "연속성·출고·권리·댓글 검사에서 해결 전 차단하도록 표시한 항목이 있습니다.",
            "아래 이슈 상태와 Publish 사전검사를 열어 원인을 해결하세요.",
          )
        : null;
    },
  },
  {
    code: "LINKED_ACTIONABLE_ISSUES",
    evaluate: (insights) => {
      const count = Math.max(
        0,
        safeCount(insights.issues.actionableCount) -
          safeCount(insights.issues.blockingCount),
      );
      return count > 0
        ? healthIssue(
            "LINKED_ACTIONABLE_ISSUES",
            "warning",
            "workflow",
            count,
            `차단 외 조치 항목 ${count}개`,
            "게시를 즉시 막지는 않지만 확인하거나 정리해야 할 열린 항목이 있습니다.",
            "이슈 상태에서 경고와 정보 항목을 확인하고 해결 또는 제외 사유를 남기세요.",
          )
        : null;
    },
  },
  {
    code: "SUPPRESSED_OPEN_ISSUES",
    evaluate: (insights) => {
      const count = safeCount(insights.issues.suppressedCount);
      return count > 0
        ? healthIssue(
            "SUPPRESSED_OPEN_ISSUES",
            "notice",
            "workflow",
            count,
            `조치 대상에서 제외된 열린 이슈 ${count}개`,
            "제외된 항목은 자동 차단되지 않지만 해결된 것으로 간주하지 않습니다.",
            "제외 사유가 여전히 유효한지 출고 전에 한 번 더 확인하세요.",
          )
        : null;
    },
  },
  {
    code: "MALFORMED_DOCUMENT_INPUT",
    evaluate: (insights) => {
      const count = safeCount(insights.normalization.malformedEntryCount);
      return count > 0
        ? healthIssue(
            "MALFORMED_DOCUMENT_INPUT",
            "blocking",
            "integrity",
            count,
            `형식이 맞지 않는 문서 항목 ${count}개`,
            "안전한 계산을 위해 일부 항목을 무시했으므로 실제 제작 상태가 누락됐을 수 있습니다.",
            "원본을 덮어쓰지 말고 복제본에서 다시 열거나 프로젝트 복구·내보내기를 확인하세요.",
          )
        : null;
    },
  },
  {
    code: "ANALYSIS_LIMIT_APPLIED",
    evaluate: (insights) => {
      if (!insights.normalization.limitsApplied) return null;
      const areas = insights.normalization.limitedAreas
        .map((area) => LIMITED_AREA_LABELS[area])
        .join("·");
      return healthIssue(
        "ANALYSIS_LIMIT_APPLIED",
        "warning",
        "integrity",
        insights.normalization.limitedAreas.length || 1,
        "일부 영역에 진단 한도가 적용됐습니다",
        areas
          ? `${areas} 입력이 안전 한도를 넘어 전체 항목을 검사하지 못했습니다.`
          : "입력이 안전 한도를 넘어 전체 항목을 검사하지 못했습니다.",
        "프로젝트를 회차 단위로 나누거나 불필요한 중복을 정리한 뒤 다시 진단하세요.",
      );
    },
  },
] as const;

export function lintStudioProjectHealth(
  insights: StudioProductionInsights,
): StudioProjectHealthResult {
  const issues = STUDIO_PROJECT_HEALTH_RULES.flatMap((rule) => {
    const result = rule.evaluate(insights);
    return result ? [result] : [];
  }).sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.code.localeCompare(right.code),
  );
  const counts = Object.freeze({
    blocking: issues.filter((issue) => issue.severity === "blocking").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    notice: issues.filter((issue) => issue.severity === "notice").length,
  });
  const status: StudioProjectHealthStatus =
    counts.blocking > 0
      ? "blocked"
      : counts.warning > 0
        ? "needs-attention"
        : "healthy";

  return Object.freeze({
    basis: "studio-production-insights",
    rulesetVersion: STUDIO_PROJECT_HEALTH_RULESET_VERSION,
    status,
    checkedRuleCount: STUDIO_PROJECT_HEALTH_RULES.length,
    passedRuleCount: STUDIO_PROJECT_HEALTH_RULES.length - issues.length,
    counts,
    issues: Object.freeze(issues),
  });
}
