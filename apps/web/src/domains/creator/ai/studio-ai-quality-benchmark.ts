/**
 * Model-independent webtoon AI quality gate.
 *
 * Scores are intentionally provider-agnostic and measure the production result rather than a
 * model's marketing label. A run can be human-rated, machine-assisted, or hybrid as long as every
 * case records the same dimensions.
 */

export const STUDIO_AI_QUALITY_DIMENSIONS = [
  "characterIdentity",
  "styleConsistency",
  "anatomyAndFaces",
  "compositionReadability",
  "letteringAccuracy",
  "backgroundContinuity",
  "editability",
  "workflowEfficiency",
  "rightsAndProvenance",
  "reliability",
] as const;

export type StudioAiQualityDimension =
  (typeof STUDIO_AI_QUALITY_DIMENSIONS)[number];

export const STUDIO_AI_QUALITY_WEIGHTS: Readonly<
  Record<StudioAiQualityDimension, number>
> = Object.freeze({
  characterIdentity: 0.2,
  styleConsistency: 0.12,
  anatomyAndFaces: 0.1,
  compositionReadability: 0.1,
  letteringAccuracy: 0.08,
  backgroundContinuity: 0.08,
  editability: 0.1,
  workflowEfficiency: 0.08,
  rightsAndProvenance: 0.08,
  reliability: 0.06,
});

export type StudioAiQualityScores = Record<
  StudioAiQualityDimension,
  number
>;

export interface StudioAiQualityCase {
  readonly id: string;
  readonly title: string;
  readonly genre?: string;
  readonly completed: boolean;
  readonly latencyMs?: number;
  readonly scores: StudioAiQualityScores;
  readonly hardFailures?: readonly string[];
  readonly notes?: string;
}

export interface StudioAiQualityRun {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly candidateLabel: string;
  readonly provider?: string;
  readonly model?: string;
  readonly cases: readonly StudioAiQualityCase[];
}

export interface StudioAiQualityThresholds {
  readonly minimumOverall: number;
  readonly minimumWorstCase: number;
  readonly minimumCompletionRate: number;
  readonly maximumP95LatencyMs: number;
  readonly dimensionMinimums: Readonly<
    Partial<Record<StudioAiQualityDimension, number>>
  >;
  readonly maximumHardFailures: number;
}

export const DEFAULT_STUDIO_AI_QUALITY_THRESHOLDS: StudioAiQualityThresholds =
  Object.freeze({
    minimumOverall: 82,
    minimumWorstCase: 68,
    minimumCompletionRate: 0.95,
    maximumP95LatencyMs: 45_000,
    dimensionMinimums: Object.freeze({
      characterIdentity: 85,
      editability: 80,
      rightsAndProvenance: 90,
      reliability: 80,
    }),
    maximumHardFailures: 0,
  });

export interface StudioAiQualityGateFinding {
  readonly id: string;
  readonly severity: "blocker" | "warning";
  readonly message: string;
}

export interface StudioAiQualityEvaluation {
  readonly passed: boolean;
  readonly overallScore: number;
  readonly worstCaseScore: number;
  readonly completionRate: number;
  readonly p95LatencyMs: number | null;
  readonly hardFailureCount: number;
  readonly dimensionScores: StudioAiQualityScores;
  readonly caseScores: Readonly<Record<string, number>>;
  readonly findings: readonly StudioAiQualityGateFinding[];
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scoreStudioAiQualityCase(
  qualityCase: StudioAiQualityCase
): number {
  return round(
    STUDIO_AI_QUALITY_DIMENSIONS.reduce(
      (total, dimension) =>
        total +
        clampScore(qualityCase.scores[dimension]) *
          STUDIO_AI_QUALITY_WEIGHTS[dimension],
      0
    )
  );
}

function percentile95(values: readonly number[]): number | null {
  const valid = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (valid.length === 0) return null;
  const index = Math.max(0, Math.ceil(valid.length * 0.95) - 1);
  return valid[index] ?? null;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function evaluateStudioAiQualityRun(
  run: StudioAiQualityRun,
  thresholds: StudioAiQualityThresholds =
    DEFAULT_STUDIO_AI_QUALITY_THRESHOLDS
): StudioAiQualityEvaluation {
  const cases = run.cases;
  const caseScores: Record<string, number> = {};
  for (const qualityCase of cases) {
    caseScores[qualityCase.id] = scoreStudioAiQualityCase(qualityCase);
  }

  const completed = cases.filter((qualityCase) => qualityCase.completed);
  const completionRate = cases.length === 0 ? 0 : completed.length / cases.length;
  const overallScore = round(mean(completed.map((item) => caseScores[item.id] ?? 0)));
  const worstCaseScore =
    completed.length === 0
      ? 0
      : round(Math.min(...completed.map((item) => caseScores[item.id] ?? 0)));
  const p95LatencyMs = percentile95(
    completed.flatMap((item) =>
      typeof item.latencyMs === "number" ? [item.latencyMs] : []
    )
  );
  const hardFailureCount = cases.reduce(
    (total, item) => total + (item.hardFailures?.length ?? 0),
    0
  );

  const dimensionScores = Object.fromEntries(
    STUDIO_AI_QUALITY_DIMENSIONS.map((dimension) => [
      dimension,
      round(mean(completed.map((item) => clampScore(item.scores[dimension])))),
    ])
  ) as unknown as StudioAiQualityScores;

  const findings: StudioAiQualityGateFinding[] = [];
  const blocker = (id: string, message: string) =>
    findings.push({ id, severity: "blocker", message });

  if (cases.length === 0) blocker("no-cases", "평가 케이스가 없습니다.");
  if (overallScore < thresholds.minimumOverall) {
    blocker(
      "overall",
      `종합 점수 ${overallScore}가 기준 ${thresholds.minimumOverall}보다 낮습니다.`
    );
  }
  if (worstCaseScore < thresholds.minimumWorstCase) {
    blocker(
      "worst-case",
      `최저 케이스 점수 ${worstCaseScore}가 기준 ${thresholds.minimumWorstCase}보다 낮습니다.`
    );
  }
  if (completionRate < thresholds.minimumCompletionRate) {
    blocker(
      "completion",
      `완료율 ${round(completionRate * 100)}%가 기준 ${round(
        thresholds.minimumCompletionRate * 100
      )}%보다 낮습니다.`
    );
  }
  if (
    p95LatencyMs !== null &&
    p95LatencyMs > thresholds.maximumP95LatencyMs
  ) {
    blocker(
      "latency",
      `p95 지연 ${p95LatencyMs}ms가 기준 ${thresholds.maximumP95LatencyMs}ms를 초과합니다.`
    );
  }
  if (hardFailureCount > thresholds.maximumHardFailures) {
    blocker(
      "hard-failure",
      `중대 실패 ${hardFailureCount}건이 허용치 ${thresholds.maximumHardFailures}건을 초과합니다.`
    );
  }

  for (const [dimension, minimum] of Object.entries(
    thresholds.dimensionMinimums
  ) as [StudioAiQualityDimension, number][]) {
    if (dimensionScores[dimension] < minimum) {
      blocker(
        `dimension:${dimension}`,
        `${dimension} 점수 ${dimensionScores[dimension]}가 기준 ${minimum}보다 낮습니다.`
      );
    }
  }

  return {
    passed: findings.every((finding) => finding.severity !== "blocker"),
    overallScore,
    worstCaseScore,
    completionRate: round(completionRate, 4),
    p95LatencyMs,
    hardFailureCount,
    dimensionScores,
    caseScores,
    findings,
  };
}

export interface StudioAiQualityComparison {
  readonly overallDelta: number;
  readonly dimensionDeltas: StudioAiQualityScores;
  readonly regressions: readonly StudioAiQualityDimension[];
}

/** Compares two evaluated runs and flags any dimension regression larger than the tolerance. */
export function compareStudioAiQualityEvaluations(
  baseline: StudioAiQualityEvaluation,
  candidate: StudioAiQualityEvaluation,
  regressionTolerance = 2
): StudioAiQualityComparison {
  const dimensionDeltas = Object.fromEntries(
    STUDIO_AI_QUALITY_DIMENSIONS.map((dimension) => [
      dimension,
      round(candidate.dimensionScores[dimension] - baseline.dimensionScores[dimension]),
    ])
  ) as unknown as StudioAiQualityScores;

  return {
    overallDelta: round(candidate.overallScore - baseline.overallScore),
    dimensionDeltas,
    regressions: STUDIO_AI_QUALITY_DIMENSIONS.filter(
      (dimension) => dimensionDeltas[dimension] < -Math.abs(regressionTolerance)
    ),
  };
}

export function formatStudioAiQualityEvaluationMarkdown(
  run: StudioAiQualityRun,
  evaluation: StudioAiQualityEvaluation
): string {
  const status = evaluation.passed ? "PASS" : "FAIL";
  const rows = STUDIO_AI_QUALITY_DIMENSIONS.map(
    (dimension) => `| ${dimension} | ${evaluation.dimensionScores[dimension]} |`
  ).join("\n");
  const findings =
    evaluation.findings.length === 0
      ? "- 차단 항목 없음"
      : evaluation.findings
          .map(
            (finding) =>
              `- ${finding.severity === "blocker" ? "BLOCKER" : "WARN"} · ${finding.message}`
          )
          .join("\n");

  return [
    `# Studio AI Quality Gate — ${run.candidateLabel}`,
    "",
    `- 상태: **${status}**`,
    `- 종합 점수: **${evaluation.overallScore}**`,
    `- 최저 케이스: **${evaluation.worstCaseScore}**`,
    `- 완료율: **${round(evaluation.completionRate * 100)}%**`,
    `- p95 지연: **${evaluation.p95LatencyMs ?? "측정 없음"}${
      evaluation.p95LatencyMs === null ? "" : "ms"
    }**`,
    `- 중대 실패: **${evaluation.hardFailureCount}건**`,
    "",
    "| 평가 축 | 점수 |",
    "|---|---:|",
    rows,
    "",
    "## 판정",
    findings,
    "",
  ].join("\n");
}
