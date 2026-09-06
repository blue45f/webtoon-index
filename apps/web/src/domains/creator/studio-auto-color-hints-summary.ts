/**
 * Presentation helpers for auto-color hint plans.
 *
 * Pure, deterministic Korean copy for the thin product panel. Never mutates pixels —
 * summarises an already-computed `StudioAutoColorHintPlan` only.
 */

import {
  planStudioAutoColorHints,
  type StudioAutoColorHintImageDataLike,
  type StudioAutoColorHintPlan,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintRequest,
  type StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";

const WHITE: StudioAutoColorHintRgba = [255, 255, 255, 255];
const BLACK: StudioAutoColorHintRgba = [0, 0, 0, 255];
const RED: StudioAutoColorHintRgba = [240, 40, 30, 255];

export interface StudioAutoColorHintPlanSummary {
  readonly status: StudioAutoColorHintPlan["status"];
  readonly statusLabel: string;
  readonly regionCount: number;
  readonly conflictCount: number;
  readonly operationCount: number;
  readonly recommendationCount: number;
  readonly rejectedCount: number;
  readonly deduplicatedCount: number;
  readonly boundaryPixelCount: number;
  readonly headline: string;
  readonly detailLines: readonly string[];
  readonly copyText: string;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.floor(value).toLocaleString("ko-KR");
}

function formatRgba(color: StudioAutoColorHintRgba): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;
}

function imageFromRows(
  rows: readonly string[],
  palette: Readonly<Record<string, StudioAutoColorHintRgba>>,
): StudioAutoColorHintImageDataLike {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new RangeError("demo fixture rows must share one width.");
    }
    [...row].forEach((key, x) => {
      const color = palette[key];
      if (!color) throw new Error(`Missing demo palette color ${key}`);
      data.set(color, (y * width + x) * 4);
    });
  });
  return { data, width, height };
}

/**
 * Small deterministic line-art fixture used when the parent has not supplied pixels yet.
 * Two fillable regions separated by ink, plus one seed so the plan shows an operation
 * and at least one recommendation for the unhinted side.
 */
export function createStudioAutoColorHintsDemoRequest(): StudioAutoColorHintRequest {
  const image = imageFromRows(["WWBWW", "WWBWW", "WWBWW"], {
    W: WHITE,
    B: BLACK,
  });
  const seeds: readonly StudioAutoColorHintSeed[] = [
    { id: "demo-left", x: 0, y: 1, color: RED },
  ];
  return {
    image,
    seeds,
    options: {
      recommendations: {
        minimumArea: 1,
        minimumBackgroundArea: 1,
        minimumTransparentArea: 1,
        maximumRecommendations: 8,
      },
    },
  };
}

/** Run the pure planner on the demo fixture (sync, no worker). */
export function planStudioAutoColorHintsDemo(): StudioAutoColorHintPlan {
  return planStudioAutoColorHints(createStudioAutoColorHintsDemoRequest());
}

export function summarizeStudioAutoColorHintPlan(
  plan: StudioAutoColorHintPlan,
): StudioAutoColorHintPlanSummary {
  const regionCount = plan.diagnostics.componentCount;
  const conflictCount = plan.diagnostics.conflictCount;
  const operationCount = plan.diagnostics.operationCount;
  const recommendationCount = plan.recommendations.length;
  const rejectedCount = plan.diagnostics.rejectedHintCount;
  const deduplicatedCount = plan.diagnostics.deduplicatedHintCount;
  const boundaryPixelCount = plan.diagnostics.boundaryPixelCount;

  const statusLabel = plan.status === "ready" ? "적용 가능(계획)" : "차단됨";
  const headline =
    plan.status === "ready"
      ? `힌트 계획 준비됨 · 영역 ${formatCount(regionCount)} · 제안 연산 ${formatCount(operationCount)}`
      : `힌트 계획 차단 · 충돌 ${formatCount(conflictCount)} · 거절 ${formatCount(rejectedCount)}`;

  const detailLines: string[] = [
    `상태: ${statusLabel} (픽셀을 자동으로 덮어쓰지 않습니다)`,
    `영역(연결 성분): ${formatCount(regionCount)}`,
    `경계 잉크 픽셀: ${formatCount(boundaryPixelCount)}`,
    `제안 연산: ${formatCount(operationCount)} · 충돌: ${formatCount(conflictCount)} · 거절: ${formatCount(rejectedCount)}`,
    `권장 시드 후보: ${formatCount(recommendationCount)} · 중복 병합: ${formatCount(deduplicatedCount)}`,
  ];

  if (plan.operations.length > 0) {
    detailLines.push("— 제안 연산 —");
    for (const op of plan.operations.slice(0, 8)) {
      detailLines.push(
        `영역 #${op.componentLabel}: ${formatRgba(op.color)} · ${formatCount(op.area)}px · 힌트 ${op.sourceHintId}`,
      );
    }
    if (plan.operations.length > 8) {
      detailLines.push(`…외 ${formatCount(plan.operations.length - 8)}개 연산`);
    }
  }

  if (plan.conflicts.length > 0) {
    detailLines.push("— 충돌 —");
    for (const conflict of plan.conflicts.slice(0, 6)) {
      const choiceText = conflict.choices
        .map((choice) => `${formatRgba(choice.color)}×${choice.hintIds.length}`)
        .join(" / ");
      detailLines.push(
        `영역 #${conflict.componentLabel}: ${formatCount(conflict.area)}px · ${choiceText}`,
      );
    }
  }

  if (plan.rejectedHints.length > 0) {
    detailLines.push("— 거절된 힌트 —");
    for (const rejected of plan.rejectedHints.slice(0, 6)) {
      const reason =
        rejected.reason === "boundary" ? "경계 잉크 위" : "팔레트 잠금 밖";
      detailLines.push(`#${rejected.hintId}: ${reason}`);
    }
  }

  if (plan.recommendations.length > 0) {
    detailLines.push("— 권장 시드 후보(미힌트 영역) —");
    for (const rec of plan.recommendations.slice(0, 8)) {
      detailLines.push(
        `영역 #${rec.componentLabel}: ${formatCount(rec.area)}px @ (${rec.seed.x}, ${rec.seed.y})${
          rec.touchesCanvasEdge ? " · 가장자리" : ""
        }${rec.fullyTransparent ? " · 투명" : ""}`,
      );
    }
  }

  const copyText = [
    "ToonSpectrum 자동 채색 힌트 계획",
    headline,
    ...detailLines,
    "",
    "참고: 이 텍스트는 계획 요약입니다. 픽셀 적용은 고급 채우기(Advanced Fill) 등 명시 적용 경로에서만 합니다.",
  ].join("\n");

  return {
    status: plan.status,
    statusLabel,
    regionCount,
    conflictCount,
    operationCount,
    recommendationCount,
    rejectedCount,
    deduplicatedCount,
    boundaryPixelCount,
    headline,
    detailLines,
    copyText,
  };
}
