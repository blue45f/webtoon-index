/**
 * Deterministic vertical-webtoon pacing analysis.
 *
 * The analyzer deliberately consumes the same lightweight page/element shape as the Studio
 * thumbnail pipeline. It never reads pixels, DOM state, network data, or React state, so preview,
 * export preflight, a future Worker, and tests can share one bounded result.
 */

export const STUDIO_SCROLL_RHYTHM_LIMITS = Object.freeze({
  maxPages: 2_000,
  maxElementsPerPage: 20_000,
  maxInsights: 120,
  maxTextCodeUnits: 200_000,
});

export interface StudioScrollRhythmElementLike {
  readonly id?: string;
  readonly type: string;
  readonly hidden?: boolean;
  readonly opacity?: number;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly points?: readonly number[];
  readonly text?: string;
}

export interface StudioScrollRhythmPageLike {
  readonly id: string;
  readonly canvasH: number;
  readonly elements: readonly StudioScrollRhythmElementLike[];
}

export type StudioScrollRhythmInsightSeverity = "info" | "warning" | "critical";

export type StudioScrollRhythmInsightCode =
  | "DENSE_PAGE"
  | "DIALOGUE_LOAD"
  | "NO_BREATHING_ROOM"
  | "LONG_EMPTY_RUN"
  | "FLAT_BEAT_INTERVALS"
  | "TIGHT_ENDING"
  | "EMPTY_ENDING"
  | "NO_VISIBLE_CONTENT"
  | "ANALYSIS_TRUNCATED";

export interface StudioScrollRhythmInsight {
  readonly code: StudioScrollRhythmInsightCode;
  readonly severity: StudioScrollRhythmInsightSeverity;
  readonly pageId: string | null;
  readonly title: string;
  readonly detail: string;
  readonly suggestion: string;
}

export interface StudioScrollRhythmPageMetric {
  readonly pageId: string;
  readonly canvasHeight: number;
  readonly screenCount: number;
  readonly visibleElementCount: number;
  readonly panelCount: number;
  readonly dialogueCount: number;
  readonly dialogueCharacters: number;
  readonly beatCount: number;
  readonly densityPerScreen: number;
  readonly dialogueCharactersPerScreen: number;
  readonly occupiedRatio: number;
  readonly breathingRoomRatio: number;
  readonly longestGapPx: number;
  readonly longestGapScreens: number;
  readonly beatIntervalVariation: number | null;
  readonly score: number;
}

export type StudioScrollEndingMode = "none" | "tight" | "balanced" | "reveal" | "empty";

export interface StudioScrollEndingAnalysis {
  readonly mode: StudioScrollEndingMode;
  readonly label: string;
  readonly trailingWhitespacePx: number;
  readonly trailingWhitespaceScreens: number;
}

export interface StudioScrollRhythmAnalysis {
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D";
  readonly pages: readonly StudioScrollRhythmPageMetric[];
  readonly totalHeightPx: number;
  readonly totalScreenCount: number;
  readonly densePageCount: number;
  readonly breathingPageCount: number;
  readonly flatRhythmPageCount: number;
  readonly ending: StudioScrollEndingAnalysis;
  readonly insights: readonly StudioScrollRhythmInsight[];
  readonly truncated: boolean;
}

export interface AnalyzeStudioScrollRhythmOptions {
  readonly viewportHeightPx?: number;
  readonly pageGapPx?: number;
}

export interface StudioAutoScrollStepInput {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly viewportHeight: number;
  readonly speedPxPerSecond: number;
  readonly elapsedMs: number;
}

export interface StudioAutoScrollStep {
  readonly nextScrollTop: number;
  readonly maxScrollTop: number;
  readonly reachedEnd: boolean;
}

interface VerticalSpan {
  readonly start: number;
  readonly end: number;
}

const DEFAULT_VIEWPORT_HEIGHT = 1_280;
const DEFAULT_PAGE_GAP = 24;
const PANEL_TYPES = new Set(["frame", "panel"]);
const DIALOGUE_TYPES = new Set(["bubble", "dialogue", "caption", "text"]);
const BEAT_TYPES = new Set([
  "frame",
  "panel",
  "bubble",
  "dialogue",
  "caption",
  "text",
  "image",
  "sticker",
  "bg3d",
  "vrm",
]);

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function round(value: number, precision = 2): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One bounded requestAnimationFrame step for the reader-speed simulator.
 * Long background-tab gaps are capped at 100ms so returning to the tab never skips several pages.
 */
export function planStudioAutoScrollStep(
  input: StudioAutoScrollStepInput
): StudioAutoScrollStep {
  const scrollHeight = Math.max(0, finiteOr(input.scrollHeight, 0));
  const viewportHeight = Math.max(0, finiteOr(input.viewportHeight, 0));
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
  const current = clamp(finiteOr(input.scrollTop, 0), 0, maxScrollTop);
  const speed = clamp(finiteOr(input.speedPxPerSecond, 0), 0, 2_000);
  const elapsedSeconds = clamp(finiteOr(input.elapsedMs, 0), 0, 100) / 1_000;
  const nextScrollTop = clamp(current + speed * elapsedSeconds, 0, maxScrollTop);

  return {
    nextScrollTop: round(nextScrollTop),
    maxScrollTop: round(maxScrollTop),
    reachedEnd: nextScrollTop >= maxScrollTop - 1,
  };
}

function elementVerticalSpan(
  element: StudioScrollRhythmElementLike,
  canvasHeight: number
): VerticalSpan | null {
  const y = finiteOr(element.y, Number.NaN);
  const height = finiteOr(element.height, Number.NaN);
  if (Number.isFinite(y) && Number.isFinite(height) && height > 0) {
    const start = clamp(y, 0, canvasHeight);
    const end = clamp(y + height, 0, canvasHeight);
    return end > start ? { start, end } : null;
  }

  const points = element.points;
  if (!points || points.length < 2) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < points.length; index += 2) {
    const pointY = points[index];
    if (!Number.isFinite(pointY)) continue;
    minY = Math.min(minY, pointY as number);
    maxY = Math.max(maxY, pointY as number);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  const start = clamp(minY, 0, canvasHeight);
  const end = clamp(Math.max(maxY, minY + 1), 0, canvasHeight);
  return end > start ? { start, end } : null;
}

function mergeSpans(spans: readonly VerticalSpan[]): VerticalSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: VerticalSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) {
      merged.push({ ...span });
      continue;
    }
    merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
  }
  return merged;
}

function spanGaps(spans: readonly VerticalSpan[], canvasHeight: number): VerticalSpan[] {
  if (spans.length === 0) return [{ start: 0, end: canvasHeight }];
  const gaps: VerticalSpan[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < canvasHeight) gaps.push({ start: cursor, end: canvasHeight });
  return gaps;
}

function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function gradeForScore(score: number): StudioScrollRhythmAnalysis["grade"] {
  if (score >= 88) return "A";
  if (score >= 74) return "B";
  if (score >= 58) return "C";
  return "D";
}

function endingAnalysis(
  pages: readonly StudioScrollRhythmPageLike[],
  metrics: readonly StudioScrollRhythmPageMetric[],
  viewportHeight: number
): StudioScrollEndingAnalysis {
  const lastPage = pages[pages.length - 1];
  const lastMetric = metrics[metrics.length - 1];
  if (!lastPage || !lastMetric || lastMetric.visibleElementCount === 0) {
    return {
      mode: "none",
      label: "엔딩 비트 없음",
      trailingWhitespacePx: lastMetric?.canvasHeight ?? 0,
      trailingWhitespaceScreens: lastMetric
        ? round(lastMetric.canvasHeight / viewportHeight)
        : 0,
    };
  }

  const visibleSpans = lastPage.elements
    .filter((element) => !element.hidden && finiteOr(element.opacity, 1) > 0)
    .map((element) => elementVerticalSpan(element, lastMetric.canvasHeight))
    .filter((span): span is VerticalSpan => span !== null);
  const lastEnd = visibleSpans.reduce((max, span) => Math.max(max, span.end), 0);
  const trailingWhitespacePx = Math.max(0, lastMetric.canvasHeight - lastEnd);
  const screens = trailingWhitespacePx / viewportHeight;

  if (screens < 0.12) {
    return {
      mode: "tight",
      label: "엔딩이 촘촘함",
      trailingWhitespacePx: round(trailingWhitespacePx),
      trailingWhitespaceScreens: round(screens),
    };
  }
  if (screens <= 0.4) {
    return {
      mode: "balanced",
      label: "균형 잡힌 엔딩",
      trailingWhitespacePx: round(trailingWhitespacePx),
      trailingWhitespaceScreens: round(screens),
    };
  }
  if (screens <= 1.35) {
    return {
      mode: "reveal",
      label: "클리프행어 호흡",
      trailingWhitespacePx: round(trailingWhitespacePx),
      trailingWhitespaceScreens: round(screens),
    };
  }
  return {
    mode: "empty",
    label: "엔딩 여백이 김",
    trailingWhitespacePx: round(trailingWhitespacePx),
    trailingWhitespaceScreens: round(screens),
  };
}

function pushInsight(
  insights: StudioScrollRhythmInsight[],
  insight: StudioScrollRhythmInsight
): void {
  if (insights.length < STUDIO_SCROLL_RHYTHM_LIMITS.maxInsights) insights.push(insight);
}

export function analyzeStudioScrollRhythm(
  sourcePages: readonly StudioScrollRhythmPageLike[],
  options: AnalyzeStudioScrollRhythmOptions = {}
): StudioScrollRhythmAnalysis {
  const viewportHeight = Math.max(
    1,
    finiteOr(options.viewportHeightPx, DEFAULT_VIEWPORT_HEIGHT)
  );
  const pageGap = Math.max(0, finiteOr(options.pageGapPx, DEFAULT_PAGE_GAP));
  const pages = sourcePages.slice(0, STUDIO_SCROLL_RHYTHM_LIMITS.maxPages);
  let truncated = pages.length !== sourcePages.length;
  const insights: StudioScrollRhythmInsight[] = [];
  const metrics: StudioScrollRhythmPageMetric[] = [];

  for (const page of pages) {
    const canvasHeight = Math.max(1, finiteOr(page.canvasH, 1_080));
    const sourceElements = page.elements.slice(
      0,
      STUDIO_SCROLL_RHYTHM_LIMITS.maxElementsPerPage
    );
    if (sourceElements.length !== page.elements.length) truncated = true;
    const visible = sourceElements.filter(
      (element) => !element.hidden && finiteOr(element.opacity, 1) > 0
    );
    const spans: VerticalSpan[] = [];
    const beatCenters: number[] = [];
    let panelCount = 0;
    let dialogueCount = 0;
    let dialogueCharacters = 0;
    let weightedLoad = 0;

    for (const element of visible) {
      const type = element.type.trim().toLowerCase();
      const span = elementVerticalSpan(element, canvasHeight);
      if (span) spans.push(span);
      if (PANEL_TYPES.has(type)) panelCount += 1;
      if (DIALOGUE_TYPES.has(type)) {
        dialogueCount += 1;
        dialogueCharacters += (element.text ?? "").slice(
          0,
          STUDIO_SCROLL_RHYTHM_LIMITS.maxTextCodeUnits
        ).length;
      }
      if (span && BEAT_TYPES.has(type)) {
        beatCenters.push((span.start + span.end) / 2);
      }

      if (PANEL_TYPES.has(type)) weightedLoad += 1;
      else if (DIALOGUE_TYPES.has(type)) weightedLoad += 0.9;
      else if (type === "image" || type === "bg3d" || type === "vrm") weightedLoad += 0.75;
      else weightedLoad += 0.35;
    }

    beatCenters.sort((a, b) => a - b);
    const beatIntervals: number[] = [];
    for (let index = 1; index < beatCenters.length; index += 1) {
      beatIntervals.push((beatCenters[index] as number) - (beatCenters[index - 1] as number));
    }
    const beatIntervalVariation = coefficientOfVariation(beatIntervals);
    const merged = mergeSpans(spans);
    const gaps = spanGaps(merged, canvasHeight);
    const occupied = merged.reduce((sum, span) => sum + (span.end - span.start), 0);
    const whitespace = Math.max(0, canvasHeight - occupied);
    const longestGapPx = gaps.reduce(
      (longest, gap) => Math.max(longest, gap.end - gap.start),
      0
    );
    const screenCount = canvasHeight / viewportHeight;
    const densityPerScreen = weightedLoad / Math.max(screenCount, 0.25);
    const dialogueCharactersPerScreen =
      dialogueCharacters / Math.max(screenCount, 0.25);
    const breathingRoomRatio = whitespace / canvasHeight;

    let score = 100;
    if (visible.length === 0) score -= 35;
    if (densityPerScreen > 8) score -= Math.min(24, (densityPerScreen - 8) * 3);
    if (dialogueCharactersPerScreen > 260) {
      score -= Math.min(18, (dialogueCharactersPerScreen - 260) / 24);
    }
    if (breathingRoomRatio < 0.06 && visible.length > 0) score -= 16;
    if (longestGapPx / viewportHeight > 1.4 && visible.length > 0) score -= 8;
    if (beatIntervalVariation !== null && beatIntervalVariation < 0.12) score -= 10;

    const metric: StudioScrollRhythmPageMetric = {
      pageId: page.id,
      canvasHeight: round(canvasHeight),
      screenCount: round(screenCount),
      visibleElementCount: visible.length,
      panelCount,
      dialogueCount,
      dialogueCharacters,
      beatCount: beatCenters.length,
      densityPerScreen: round(densityPerScreen),
      dialogueCharactersPerScreen: round(dialogueCharactersPerScreen),
      occupiedRatio: round(occupied / canvasHeight),
      breathingRoomRatio: round(breathingRoomRatio),
      longestGapPx: round(longestGapPx),
      longestGapScreens: round(longestGapPx / viewportHeight),
      beatIntervalVariation:
        beatIntervalVariation === null ? null : round(beatIntervalVariation, 3),
      score: Math.round(clamp(score, 0, 100)),
    };
    metrics.push(metric);

    if (visible.length === 0) {
      pushInsight(insights, {
        code: "NO_VISIBLE_CONTENT",
        severity: "warning",
        pageId: page.id,
        title: "빈 페이지",
        detail: "독자가 머무를 시각 비트가 없습니다.",
        suggestion: "의도된 여백이 아니라면 컷, 대사 또는 전환 비트를 추가하세요.",
      });
    }
    if (densityPerScreen > 8) {
      pushInsight(insights, {
        code: "DENSE_PAGE",
        severity: densityPerScreen > 12 ? "critical" : "warning",
        pageId: page.id,
        title: "정보 밀도가 높음",
        detail: `한 화면당 가중 요소가 약 ${round(densityPerScreen, 1)}개입니다.`,
        suggestion: "컷을 분리하거나 컷 사이 여백을 늘려 시선 이동을 단순화하세요.",
      });
    }
    if (dialogueCharactersPerScreen > 260) {
      pushInsight(insights, {
        code: "DIALOGUE_LOAD",
        severity: dialogueCharactersPerScreen > 400 ? "critical" : "warning",
        pageId: page.id,
        title: "대사 호흡이 김",
        detail: `한 화면당 약 ${Math.round(dialogueCharactersPerScreen)}자의 대사가 배치됐습니다.`,
        suggestion: "말풍선을 나누거나 행동 컷 사이에 대사를 분산하세요.",
      });
    }
    if (breathingRoomRatio < 0.06 && visible.length > 0) {
      pushInsight(insights, {
        code: "NO_BREATHING_ROOM",
        severity: "warning",
        pageId: page.id,
        title: "호흡 여백 부족",
        detail: `비어 있는 세로 구간이 전체의 ${Math.round(breathingRoomRatio * 100)}%입니다.`,
        suggestion: "감정 전환이나 장면 전환 앞뒤에 짧은 무음 여백을 확보하세요.",
      });
    }
    if (longestGapPx / viewportHeight > 1.4 && visible.length > 0) {
      pushInsight(insights, {
        code: "LONG_EMPTY_RUN",
        severity: "info",
        pageId: page.id,
        title: "긴 무음 구간",
        detail: `가장 긴 여백이 약 ${round(longestGapPx / viewportHeight, 1)}화면입니다.`,
        suggestion: "의도된 서스펜스인지 확인하고, 아니라면 다음 비트를 조금 당기세요.",
      });
    }
    if (beatIntervalVariation !== null && beatIntervalVariation < 0.12) {
      pushInsight(insights, {
        code: "FLAT_BEAT_INTERVALS",
        severity: "info",
        pageId: page.id,
        title: "컷 간격이 단조로움",
        detail: "주요 비트의 세로 간격이 거의 동일해 리듬 변화가 작습니다.",
        suggestion: "강조 컷 전후 간격을 대비시켜 속도감과 긴장도를 조절하세요.",
      });
    }
  }

  const totalHeightPx =
    metrics.reduce((sum, metric) => sum + metric.canvasHeight, 0) +
    Math.max(0, metrics.length - 1) * pageGap;
  const ending = endingAnalysis(pages, metrics, viewportHeight);
  if (ending.mode === "tight") {
    pushInsight(insights, {
      code: "TIGHT_ENDING",
      severity: "info",
      pageId: metrics.at(-1)?.pageId ?? null,
      title: "엔딩 비트가 화면 끝에 붙음",
      detail: "마지막 요소 뒤의 여백이 0.12화면보다 짧습니다.",
      suggestion: "다음 화 유도나 감정 잔상을 원한다면 짧은 여백을 추가하세요.",
    });
  } else if (ending.mode === "empty") {
    pushInsight(insights, {
      code: "EMPTY_ENDING",
      severity: "warning",
      pageId: metrics.at(-1)?.pageId ?? null,
      title: "엔딩 이후 여백이 김",
      detail: `마지막 비트 뒤에 약 ${ending.trailingWhitespaceScreens}화면이 비어 있습니다.`,
      suggestion: "의도된 클리프행어가 아니라면 캔버스 높이를 줄이거나 마지막 비트를 내리세요.",
    });
  }

  if (truncated) {
    if (insights.length >= STUDIO_SCROLL_RHYTHM_LIMITS.maxInsights) {
      // Keep the budget contract itself visible even when page-level findings filled the list.
      insights.pop();
    }
    pushInsight(insights, {
      code: "ANALYSIS_TRUNCATED",
      severity: "warning",
      pageId: null,
      title: "분석 예산 적용",
      detail: "대형 원고의 일부만 안전 예산 안에서 분석했습니다.",
      suggestion: "페이지 구간을 나눠 다시 분석하면 더 세밀한 결과를 얻을 수 있습니다.",
    });
  }

  const averageScore =
    metrics.length > 0
      ? metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length
      : 0;
  const endingPenalty = ending.mode === "empty" ? 8 : ending.mode === "tight" ? 3 : 0;
  const score = Math.round(clamp(averageScore - endingPenalty, 0, 100));

  return {
    score,
    grade: gradeForScore(score),
    pages: metrics,
    totalHeightPx: round(totalHeightPx),
    totalScreenCount: round(totalHeightPx / viewportHeight),
    densePageCount: metrics.filter((metric) => metric.densityPerScreen > 8).length,
    breathingPageCount: metrics.filter((metric) => metric.breathingRoomRatio >= 0.12).length,
    flatRhythmPageCount: metrics.filter(
      (metric) =>
        metric.beatIntervalVariation !== null && metric.beatIntervalVariation < 0.12
    ).length,
    ending,
    insights,
    truncated,
  };
}
