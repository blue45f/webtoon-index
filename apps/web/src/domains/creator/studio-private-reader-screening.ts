/**
 * Studio Private Reader Screening System — 비공개 베타 독자 시사회, NDA 동의,
 * 동적 보안 워터마크, 컷별 체류시간·이탈률 측정 및 A/B 연출 검증 코어.
 *
 * 마스터플랜 13.6 (Private Reader Screening) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 비공개 시사회 캠페인(Screening Campaign) 생성 및 NDA 동의 요구
 * - 동적 식별 워터마크 생성 (독자명·이메일·IP·타임스탬프)
 * - 컷(Panel) 단위 체류 시간(Dwell Time) 및 이탈 지점(Drop-off Point) 수집
 * - 구간별 이해도/반응 질문(Comprehension Question) 앵커링
 * - A/B 연출 브랜치 반응 비교 분석 집계(Screening Analytics Aggregation)
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_PRIVATE_SCREENING_VERSION = 1 as const;

export const STUDIO_SCREENING_LIMITS = Object.freeze({
  maxCampaigns: 1_024,
  maxQuestionsPerCampaign: 64,
  maxSessionsPerCampaign: 10_000,
  maxIdLength: 128,
  maxTextLength: 2_000,
  maxDiagnostics: 256,
});

export type ScreeningQuestionKind =
  | "multiple-choice"
  | "free-text"
  | "rating-scale";

export interface ScreeningQuestion {
  readonly id: string;
  readonly anchorPanelId: string;
  readonly questionText: string;
  readonly kind: ScreeningQuestionKind;
  readonly options?: readonly string[];
}

export interface ScreeningBranchVariant {
  readonly branchId: string;
  readonly branchName: string;
  readonly weight: number; // 0..1
}

export interface ScreeningCampaign {
  readonly id: string;
  readonly episodeId: string;
  readonly title: string;
  readonly requiresNda: boolean;
  readonly isWatermarkEnabled: boolean;
  readonly expiresAtMs: number;
  readonly watermarkTemplate: string; // e.g. "{name} | {email} | {timestamp}"
  readonly questions: readonly ScreeningQuestion[];
  readonly branchVariants?: readonly ScreeningBranchVariant[];
}

export interface ReaderScrollTrace {
  readonly panelId: string;
  readonly dwellTimeMs: number;
  readonly maxScrollVelocity: number;
}

export interface ReaderQuestionResponse {
  readonly questionId: string;
  readonly answer: string | number;
  readonly answeredAtMs: number;
}

export interface ReaderScreeningSession {
  readonly sessionId: string;
  readonly campaignId: string;
  readonly readerId: string;
  readonly readerName: string;
  readonly readerEmail: string;
  readonly assignedBranchId?: string;
  readonly ndaConsentedAtMs?: number;
  readonly traces: readonly ReaderScrollTrace[];
  readonly dropOffPanelId?: string;
  readonly responses: readonly ReaderQuestionResponse[];
  readonly startedAtMs: number;
  readonly completedAtMs?: number;
}

export interface AggregatedScreeningReport {
  readonly campaignId: string;
  readonly totalReaders: number;
  readonly ndaConsentRate: number; // 0..1
  readonly completionRate: number; // 0..1
  readonly averageDwellTimeByPanel: Readonly<Record<string, number>>; // panelId -> ms
  readonly dropOffCountsByPanel: Readonly<Record<string, number>>; // panelId -> count
  readonly responsesByQuestion: Readonly<
    Record<string, readonly (string | number)[]>
  >;
}

export function createScreeningCampaign(params: {
  id: string;
  episodeId: string;
  title: string;
  requiresNda?: boolean;
  isWatermarkEnabled?: boolean;
  expiresAtMs: number;
  watermarkTemplate?: string;
  questions?: readonly ScreeningQuestion[];
  branchVariants?: readonly ScreeningBranchVariant[];
}): ScreeningCampaign {
  return Object.freeze({
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    title: params.title.trim(),
    requiresNda: params.requiresNda ?? true,
    isWatermarkEnabled: params.isWatermarkEnabled ?? true,
    expiresAtMs: params.expiresAtMs,
    watermarkTemplate:
      params.watermarkTemplate ?? "{readerName} ({readerEmail}) — {timestamp}",
    questions: Object.freeze([...(params.questions ?? [])]),
    branchVariants: params.branchVariants
      ? Object.freeze([...params.branchVariants])
      : undefined,
  });
}

/**
 * 독자 정보와 캠페인 설정을 결합하여 화면에 오버레이할 동적 보안 워터마크 텍스트를 생성한다.
 */
export function generateScreeningWatermark(
  campaign: ScreeningCampaign,
  reader: { name: string; email: string; timestampMs: number },
): string {
  if (!campaign.isWatermarkEnabled) return "";
  const dateStr = new Date(reader.timestampMs).toISOString();
  return campaign.watermarkTemplate
    .replace("{readerName}", reader.name)
    .replace("{name}", reader.name)
    .replace("{readerEmail}", reader.email)
    .replace("{email}", reader.email)
    .replace("{timestamp}", dateStr);
}

/**
 * 다수 독자 세션의 텔레메트리 데이터를 집계하여 검수 리포트를 산출한다.
 */
export function aggregateScreeningSessions(
  campaign: ScreeningCampaign,
  sessions: readonly ReaderScreeningSession[],
): AggregatedScreeningReport {
  if (sessions.length === 0) {
    return Object.freeze({
      campaignId: campaign.id,
      totalReaders: 0,
      ndaConsentRate: 0,
      completionRate: 0,
      averageDwellTimeByPanel: Object.freeze({}),
      dropOffCountsByPanel: Object.freeze({}),
      responsesByQuestion: Object.freeze({}),
    });
  }

  let ndaConsents = 0;
  let completions = 0;
  const dwellSums: Record<string, number> = {};
  const dwellCounts: Record<string, number> = {};
  const dropOffs: Record<string, number> = {};
  const questionResponses: Record<string, (string | number)[]> = {};

  for (const s of sessions) {
    if (s.ndaConsentedAtMs !== undefined) ndaConsents += 1;
    if (s.completedAtMs !== undefined) completions += 1;
    if (s.dropOffPanelId) {
      dropOffs[s.dropOffPanelId] = (dropOffs[s.dropOffPanelId] ?? 0) + 1;
    }

    for (const t of s.traces) {
      dwellSums[t.panelId] = (dwellSums[t.panelId] ?? 0) + t.dwellTimeMs;
      dwellCounts[t.panelId] = (dwellCounts[t.panelId] ?? 0) + 1;
    }

    for (const r of s.responses) {
      if (!questionResponses[r.questionId]) questionResponses[r.questionId] = [];
      questionResponses[r.questionId].push(r.answer);
    }
  }

  const averageDwellTimeByPanel: Record<string, number> = {};
  for (const panelId of Object.keys(dwellSums)) {
    averageDwellTimeByPanel[panelId] = Math.round(
      dwellSums[panelId] / Math.max(1, dwellCounts[panelId]),
    );
  }

  return Object.freeze({
    campaignId: campaign.id,
    totalReaders: sessions.length,
    ndaConsentRate: ndaConsents / sessions.length,
    completionRate: completions / sessions.length,
    averageDwellTimeByPanel: Object.freeze(averageDwellTimeByPanel),
    dropOffCountsByPanel: Object.freeze(dropOffs),
    responsesByQuestion: Object.freeze(questionResponses),
  });
}
