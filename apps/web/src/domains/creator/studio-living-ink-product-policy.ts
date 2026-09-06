import type { StudioLivingInkExecutionConfig } from "./studio-living-ink-execution-protocol";
import type { StudioLivingInkMaterialControls } from "./studio-living-ink-gpu-protocol";

export const STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR = Object.freeze({
  maximumDisplayDimension: 4_096,
  maximumFieldDimension: 1_024,
  minimumDisplayShortEdge: 512,
  minimumFieldShortEdge: 128,
} as const);

export type StudioLivingInkExecutionConfigPlan =
  | Readonly<{ ok: true; config: StudioLivingInkExecutionConfig }>
  | Readonly<{
      ok: false;
      reason: "display-resolution-below-floor" | "field-resolution-below-floor";
      message: string;
    }>;

export function planStudioLivingInkProductExecutionConfig(input: Readonly<{
  documentWidth: number;
  documentHeight: number;
  material: StudioLivingInkMaterialControls;
  seed: number;
}>): StudioLivingInkExecutionConfigPlan {
  const { documentWidth, documentHeight } = input;
  const displayScale = Math.min(
    1,
    STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.maximumDisplayDimension
      / Math.max(documentWidth, documentHeight),
  );
  const fieldScale = Math.min(
    1,
    STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.maximumFieldDimension
      / Math.max(documentWidth, documentHeight),
  );
  const displayWidth = Math.max(1, Math.round(documentWidth * displayScale));
  const displayHeight = Math.max(1, Math.round(documentHeight * displayScale));
  const fieldWidth = Math.max(1, Math.round(documentWidth * fieldScale));
  const fieldHeight = Math.max(1, Math.round(documentHeight * fieldScale));
  if (
    Math.min(displayWidth, displayHeight)
    < STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.minimumDisplayShortEdge
  ) {
    return Object.freeze({
      ok: false,
      reason: "display-resolution-below-floor",
      message:
        "현재 초장편 캔버스는 Living Ink 최종 PNG의 짧은 변이 512px 아래로 내려가므로 원본 벡터·수채 리본 경로를 사용합니다.",
    });
  }
  if (
    Math.min(fieldWidth, fieldHeight)
    < STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.minimumFieldShortEdge
  ) {
    return Object.freeze({
      ok: false,
      reason: "field-resolution-below-floor",
      message:
        "현재 초장편 캔버스는 물리 필드의 짧은 변이 128셀 아래로 내려가므로 저해상도 결과를 저장하지 않습니다.",
    });
  }
  return Object.freeze({
    ok: true,
    config: Object.freeze({
      displayWidth,
      displayHeight,
      fieldWidth,
      fieldHeight,
      coarseBase: 128,
      seed: input.seed,
      material: Object.freeze(structuredClone(input.material)),
      displayMode: "composite",
    }),
  });
}

export function studioLivingInkConfigMeetsProductQualityFloor(
  config: StudioLivingInkExecutionConfig,
): boolean {
  return Math.min(config.displayWidth, config.displayHeight)
      >= STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.minimumDisplayShortEdge
    && Math.min(config.fieldWidth, config.fieldHeight)
      >= STUDIO_LIVING_INK_PRODUCT_QUALITY_FLOOR.minimumFieldShortEdge;
}
