/**
 * Product-facing, read-only moiré analysis contract.
 *
 * This adapter never returns an image-edit patch and cannot enter the destructive/non-destructive
 * filter stack. Its heatmap is diagnostic output only.
 */
import {
  analyzeStudioMoireRisk,
  normalizeStudioMoireRiskOptions,
  type StudioMoireOrientation,
  type StudioMoireRiskOptions,
  type StudioToneArtifactRgbaImage,
  type StudioToneArtifactWorkReceipt,
} from "./studio-tone-artifact-filter-kernels";

export type StudioMoireAnalysisSeverity = "낮음" | "주의" | "높음";

export type StudioMoireAnalysisReport =
  | {
      readonly status: "complete";
      readonly destructive: false;
      readonly severity: StudioMoireAnalysisSeverity;
      readonly scorePercent: number;
      readonly hotAreaPercent: number;
      readonly dominantOrientation: StudioMoireOrientation | null;
      readonly dominantPeriodPx: 2 | null;
      readonly heatmap: StudioToneArtifactRgbaImage;
      readonly work: StudioToneArtifactWorkReceipt;
    }
  | {
      readonly status: "unavailable";
      readonly destructive: false;
      readonly reason: "invalid-image" | "invalid-budget" | "budget-exceeded";
      readonly message: string;
      readonly work?: StudioToneArtifactWorkReceipt;
    };

export function analyzeStudioMoireForProduct(
  source: StudioToneArtifactRgbaImage,
  options?: Partial<StudioMoireRiskOptions> | null,
): StudioMoireAnalysisReport {
  const result = analyzeStudioMoireRisk(
    source,
    normalizeStudioMoireRiskOptions(options),
  );
  if (result.status === "refused") {
    return result.work
      ? {
          status: "unavailable",
          destructive: false,
          reason: result.reason,
          message: result.detail,
          work: result.work,
        }
      : {
          status: "unavailable",
          destructive: false,
          reason: result.reason,
          message: result.detail,
        };
  }
  return {
    status: "complete",
    destructive: false,
    severity: result.level === "high"
      ? "높음"
      : result.level === "medium"
        ? "주의"
        : "낮음",
    scorePercent: Math.round(result.riskScore * 10_000) / 100,
    hotAreaPercent: Math.round(result.hotPixelRatio * 10_000) / 100,
    dominantOrientation: result.dominantOrientation,
    dominantPeriodPx: result.dominantPeriodPx,
    heatmap: result.heatmap,
    work: result.work,
  };
}
