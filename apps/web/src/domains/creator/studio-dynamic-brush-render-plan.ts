/**
 * Renderer-neutral retained/live dynamic-brush deposition plan.
 *
 * Canvas, SVG and the WebGPU textured-brush presenter must start from the same immutable dab
 * variations and the same accepted-prefix budget. Keeping this planner outside React prevents a
 * future GPU path from copying StudioDrawNode's causal-v2/v3, symmetry and work-budget policy.
 */

import {
  DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
  isStudioDynamicBrushCausalDepositPipeline,
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSeedFromKey,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
  studioDynamicBrushDepositPipelineUsesContinuation,
} from "./brush/studio-brush-dynamics";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
  type StudioDynamicBrushRenderBudgetPlan,
} from "./brush/studio-brush-render-budget";
import {
  studioBrushSymmetryTransforms,
  studioDynamicBrushDabVariationsFromTransforms,
  type StudioBrushSymmetryTransform,
} from "./brush/studio-brush-symmetry";
import {
  resolveStudioDynamicBrushMaterialIdentity,
  type StudioDynamicBrushMaterialIdentity,
} from "./brush/studio-dry-media-dynamic-bridge";
import {
  resolveStudioPaperBrushMedium,
  resolveStudioPaperBrushResponse,
} from "./brush/studio-paper-brush-response";
import {
  normalizeStudioPaperSurfaceSettings,
  resolveStudioDocumentPaperSurface,
  studioPaperGranulationIsActive,
  type StudioPaperGranulationSettings,
  type StudioPaperSurfaceSettings,
} from "./brush/studio-paper-granulation-runtime";
import {
  normalizeStudioPaperSubstrateModel,
  studioPaperUsesContactTooth,
  type StudioPaperSubstrateModel,
} from "./brush/studio-paper-substrate-model";
import {
  planStudioCausalDynamicBrushDepositSegmentsV3,
  planStudioCausalDynamicBrushDepositsV2,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
} from "./studio-causal-dynamic-brush-deposit-v2";
import {
  resolveStudioDynamicBrushCoverageBudgetContract,
  type StudioDynamicBrushSegmentedDabVariation,
} from "./studio-dynamic-brush-coverage-renderer";
import {
  studioSplatterOriginAnchorMarkCount,
} from "./studio-splatter-origin-anchor";
import {
  planStudioWebDrawingKitOwnedDabs,
} from "./studio-web-drawing-stroke-bridge";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import type { StudioPaperMediumV1 } from "./brush/studio-paper-media-profile-v1";
import type { DrawEl } from "./studio-element-model";

const dynamicsBySnapshot = new WeakMap<object, NormalizedStudioBrushDynamicsSettings>();
const defaultDynamicsByBrushId = new Map<string, NormalizedStudioBrushDynamicsSettings>();

export interface StudioDynamicBrushRenderPlan {
  readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  readonly materialIdentity: StudioDynamicBrushMaterialIdentity;
  readonly seed: number;
  readonly markBudget: number;
  readonly renderBudget: StudioDynamicBrushRenderBudgetPlan;
  readonly usesCausalDepositPlan: boolean;
  /**
   * 이 도구가 종이와 어떻게 만나는가. 도구 물성(브러시 id → 정책 표)과 문서가 깔아 둔 종이를
   * 여기서 한 번 합쳐 두면 Canvas·라이브 오버레이·SVG 세 소비자가 같은 결을 본다.
   * 종이를 타지 않는 도구(잉크·기술펜)에서는 undefined라 커버리지 플랜이 정확한 항등을 탄다.
   */
  readonly paper?: Readonly<{
    readonly response: StudioPaperGranulationSettings;
    readonly surface: StudioPaperSurfaceSettings;
    /** 획이 태어날 때 얼린 substrate 세대. 생략 = 레거시 valley-multiply. */
    readonly model?: StudioPaperSubstrateModel;
    /** 극성 taxonomy상의 상호작용 매체. `model`이 있을 때만 채워진다. */
    readonly medium?: StudioPaperMediumV1;
  }>;
  readonly dabVariations: readonly StudioDynamicBrushSegmentedDabVariation[]
    | readonly (readonly StudioDynamicBrushDab[])[];
}

export type StudioDynamicBrushRenderPlanResult =
  | Readonly<{ status: "ready"; plan: StudioDynamicBrushRenderPlan }>
  | Readonly<{ status: "rejected"; reason: "deposit-plan" }>;

function settingsFor(
  element: DrawEl,
  dynamicBrushId: string,
): NormalizedStudioBrushDynamicsSettings {
  const source = element.brushDynamics;
  if (typeof source === "object" && source !== null) {
    const cached = dynamicsBySnapshot.get(source);
    if (cached) return cached;
    const normalized = normalizeStudioBrushDynamicsSettings(source);
    dynamicsBySnapshot.set(source, normalized);
    return normalized;
  }
  if (source !== undefined && source !== null) {
    return normalizeStudioBrushDynamicsSettings(source);
  }

  const brushId = typeof element.brush === "string" && element.brush
    ? element.brush
    : dynamicBrushId;
  const cached = defaultDynamicsByBrushId.get(brushId);
  if (cached) return cached;
  // Replay fail-safe, shared with the SVG exporter so the two surfaces cannot diverge: the
  // id-derived path never hands out the dry-media kernel pin, only an element's own snapshot can.
  const normalized = studioReplaySafeBrushDynamicsSettingsForBrushId(brushId)
    ?? studioReplaySafeBrushDynamicsSettingsForBrushId(dynamicBrushId)
    ?? normalizeStudioBrushDynamicsSettings();
  defaultDynamicsByBrushId.set(brushId, normalized);
  return normalized;
}

function segmentedDabCount(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
): number {
  return segments.reduce((count, segment) => count + segment.length, 0);
}

function segmentedDabPrefix(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  maximumDabs: number,
): readonly (readonly StudioDynamicBrushDab[])[] {
  const accepted: Array<readonly StudioDynamicBrushDab[]> = [];
  let remaining = Math.max(0, Math.floor(maximumDabs));
  for (const segment of segments) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      accepted.push(segment);
      remaining -= segment.length;
      continue;
    }
    accepted.push(segment.slice(0, remaining));
    remaining = 0;
  }
  return accepted;
}

function segmentedDabVariations(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  transforms: readonly StudioBrushSymmetryTransform[],
): readonly StudioDynamicBrushSegmentedDabVariation[] {
  const variationSegments = transforms.map(
    () => [] as Array<readonly StudioDynamicBrushDab[]>,
  );
  for (const segment of segments) {
    const transformed = studioDynamicBrushDabVariationsFromTransforms(
      segment,
      transforms,
    );
    for (let index = 0; index < transformed.length; index += 1) {
      variationSegments[index]!.push(transformed[index]!);
    }
  }
  return variationSegments.map((segmentsForVariation) => ({
    kind: "studio-dynamic-brush-segmented-dab-variation",
    segments: segmentsForVariation,
  }));
}

/**
 * Produces the exact deposition/budget input formerly embedded in StudioDrawNode.
 *
 * A causal plan is append-only and therefore truncates to its explicit accepted-prefix receipt.
 * A legacy plan may redistribute its bounded station count across the whole path, preserving both
 * endpoints. Callers must not interchange these two overflow policies.
 */
export function planStudioDynamicBrushRender(
  element: DrawEl,
  dynamicBrushId: string,
  activeDraft: boolean,
  paperSurface?: StudioPaperSurfaceSettings,
): StudioDynamicBrushRenderPlanResult {
  const sourceDynamics = settingsFor(element, dynamicBrushId);
  const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
    typeof element.brush === "string" && element.brush
      ? element.brush
      : dynamicBrushId,
    element.brushCatalogId,
  ) ?? resolveStudioDynamicBrushMaterialIdentity(dynamicBrushId)!;
  const seed = studioBrushDynamicsSeedFromKey(
    `${element.id}:${sourceDynamics.seed}`,
  );
  const baseWidth = Math.max(1, element.strokeWidth);
  // DrawEl owns the authored stroke width while brushDynamics is an immutable catalog/custom
  // snapshot. The direct live overlay has always detached this exact per-stroke identity before
  // causal planning. Retained rendering must use the same seed and width too: otherwise textured
  // dry media changes scatter, station count and footprint the moment the live canvas is released.
  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...sourceDynamics,
    seed,
    width: { ...sourceDynamics.width, base: baseWidth },
  });
  const dabPlanInput = {
    points: element.points,
    pressures: element.pressures,
    tangentialPressures: element.tangentialPressures,
    speeds: element.speeds,
    tiltXs: element.tiltXs,
    tiltYs: element.tiltYs,
    twists: element.twists,
    baseWidth,
    baseOpacity: dynamics.opacity.base,
    seed,
  };
  const kitPlanInput = {
    brushId: typeof element.brush === "string" && element.brush
      ? element.brush
      : dynamicBrushId,
    points: dabPlanInput.points,
    pressures: dabPlanInput.pressures,
    baseWidth: dabPlanInput.baseWidth,
    baseOpacity: dabPlanInput.baseOpacity,
    seed: dabPlanInput.seed,
    centerX: element.symmetry?.centerX,
    centerY: element.symmetry?.centerY,
  };
  const webKitDabs = planStudioWebDrawingKitOwnedDabs(
    { ...kitPlanInput, maxDabs: DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS },
    dynamics,
  );
  let usesCausalDepositPlan = false;
  let causalDabSegments:
    | readonly (readonly StudioDynamicBrushDab[])[]
    | null = null;
  let baseDabs = webKitDabs ?? ([] as readonly StudioDynamicBrushDab[]);
  if (webKitDabs === null) {
    const causalDepositPlan = isStudioDynamicBrushCausalDepositPipeline(
      dynamics.depositPipeline,
    )
      ? studioDynamicBrushDepositPipelineUsesContinuation(dynamics.depositPipeline)
        ? planStudioCausalDynamicBrushDepositSegmentsV3({
            points: element.points,
            pressures: element.pressures,
            tangentialPressures: element.tangentialPressures,
            speeds: element.speeds,
            tiltXs: element.tiltXs,
            tiltYs: element.tiltYs,
            twists: element.twists,
            settings: dynamics,
          })
        : planStudioCausalDynamicBrushDepositsV2({
            points: element.points,
            pressures: element.pressures,
            tangentialPressures: element.tangentialPressures,
            speeds: element.speeds,
            tiltXs: element.tiltXs,
            tiltYs: element.tiltYs,
            twists: element.twists,
            settings: dynamics,
            maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
          })
      : null;
    if (causalDepositPlan && !causalDepositPlan.ok) {
      return Object.freeze({ status: "rejected", reason: "deposit-plan" });
    }

    usesCausalDepositPlan = causalDepositPlan?.ok === true;
    causalDabSegments = causalDepositPlan?.ok === true && "segments" in causalDepositPlan
      ? causalDepositPlan.segments.map((segment) => segment.dabs)
      : null;
    baseDabs = causalDabSegments
      ? [] as readonly StudioDynamicBrushDab[]
      : causalDepositPlan?.ok === true && "dabs" in causalDepositPlan
        ? causalDepositPlan.dabs
        : planNormalizedStudioDynamicBrushDabs(
            { ...dabPlanInput, maxDabs: DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS },
            dynamics,
          );
  }
  const baseDabCount = causalDabSegments
    ? segmentedDabCount(causalDabSegments)
    : baseDabs.length;
  const symmetryTransforms = studioBrushSymmetryTransforms(element.symmetry);
  const markBudget = usesCausalDepositPlan
    ? studioDynamicBrushDepositPipelineUsesContinuation(dynamics.depositPipeline)
      ? STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET
      : STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET
    : activeDraft
      ? STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET
      : STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET;
  const coverageBudget = resolveStudioDynamicBrushCoverageBudgetContract(
    materialIdentity,
    dynamics,
  );
  const renderBudget = planStudioDynamicBrushRenderBudget({
    settings: coverageBudget.settings,
    dabCount: baseDabCount,
    symmetryCount: symmetryTransforms.length,
    fixedMarksPerVariation: studioSplatterOriginAnchorMarkCount(
      materialIdentity,
      baseDabCount > 0,
    ),
    materialMarkMultiplier: coverageBudget.materialMarkMultiplier,
    markBudget,
  });

  if (usesCausalDepositPlan && renderBudget.maxDabsPerVariation < baseDabCount) {
    if (causalDabSegments) {
      causalDabSegments = segmentedDabPrefix(
        causalDabSegments,
        renderBudget.maxDabsPerVariation,
      );
    } else {
      baseDabs = baseDabs.slice(0, renderBudget.maxDabsPerVariation);
    }
  }
  if (!usesCausalDepositPlan && renderBudget.maxDabsPerVariation < baseDabCount) {
    if (webKitDabs !== null) {
      baseDabs = planStudioWebDrawingKitOwnedDabs(
        { ...kitPlanInput, maxDabs: renderBudget.maxDabsPerVariation },
        dynamics,
      ) ?? webKitDabs.slice(0, renderBudget.maxDabsPerVariation);
    } else {
      baseDabs = planNormalizedStudioDynamicBrushDabs(
        { ...dabPlanInput, maxDabs: renderBudget.maxDabsPerVariation },
        dynamics,
      );
    }
  }

  const paperBrushId = typeof element.brush === "string" && element.brush
    ? element.brush
    : dynamicBrushId;
  /**
   * 이 획이 태어날 때 얼린 substrate 세대. 획이 스스로 들고 있는 키만 읽는다 —
   * 페이지나 카탈로그가 새 모델을 알게 되었다고 해서 기존 획을 재해석하지 않는다.
   */
  const paperModel = normalizeStudioPaperSubstrateModel(element.paperModel);
  const paperMedium = studioPaperUsesContactTooth(paperModel)
    ? resolveStudioPaperBrushMedium(paperBrushId)
    : null;
  const paperResponse = resolveStudioPaperBrushResponse(
    paperBrushId,
    undefined,
    // 키 없는 획은 3번째 인자가 undefined라 반환값이 예전과 비트 단위로 같다.
    paperModel === undefined ? undefined : { model: paperModel, medium: paperMedium },
  );
  const paper = studioPaperGranulationIsActive(paperResponse)
    ? Object.freeze({
        response: paperResponse,
        surface: paperSurface === undefined
          ? resolveStudioDocumentPaperSurface()
          : normalizeStudioPaperSurfaceSettings(paperSurface),
        ...(paperModel ? { model: paperModel } : {}),
        ...(paperMedium ? { medium: paperMedium } : {}),
      })
    : undefined;

  return Object.freeze({
    status: "ready",
    plan: Object.freeze({
      dynamics,
      materialIdentity,
      seed,
      ...(paper ? { paper } : {}),
      markBudget,
      renderBudget,
      usesCausalDepositPlan,
      dabVariations: causalDabSegments
        ? segmentedDabVariations(causalDabSegments, symmetryTransforms)
        : studioDynamicBrushDabVariationsFromTransforms(
            baseDabs,
            symmetryTransforms,
          ),
    }),
  });
}
