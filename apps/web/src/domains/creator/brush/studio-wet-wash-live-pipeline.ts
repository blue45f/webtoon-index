/**
 * 라이브 causal watercolor 워시의 증분 파이프라인 (장획 게이트 `wet-dabs`).
 *
 * `StudioDrawNode`의 활성 초안 렌더는 매 포인터 이동마다 플래너 → 재질 스케일 → 습식 리본
 * 캐리어를 전부 다시 계산했다(이동당 O(n)). 세 단계 모두 prefix 안정이므로, 획(요소 id)별로
 * 증분 플래너·스케일 미러·증분 캐리어를 함께 보관하면 이동당 비용이 새 표본 수에만 비례한다.
 *
 * 결과는 배치 체인(`planCausalWatercolorBrushDabs` →
 * `applyStudioBrushAliasWatercolorMaterial` → `planStudioWetRibbonCarrier`)과 값으로 완전히
 * 같다 — 각 단계가 배치와 같은 함수를 같은 순서로 호출한다. wet-edge-bloom / living-ink bake
 * 프로그램이 핀된 레인은 전획 물리 단계가 있어 여기서 다루지 않고 `null` 을 돌려주며, 호출부가
 * 기존 배치 체인으로 그대로 내려간다(fail-closed). 커밋 렌더 역시 배치 체인을 유지해 후처리
 * 워커의 전면 치환 같은 내부 점 재작성에도 항상 정본을 그린다.
 *
 * 반환 배열(`dabs`, 캐리어 플랜의 `footprints`/각 batch `polygons`)은 내부 보관 배열이므로
 * 수정하면 안 되고 다음 호출까지만 유효하다.
 */
import {
  createStudioIncrementalCausalWatercolorPlanner,
} from "../studio-causal-watercolor-brush";

import {
  resolveStudioBrushAliasWatercolorMaterialStage,
  scaleStudioBrushAliasWatercolorMaterialDab,
} from "./studio-brush-alias-profile";
import { createStudioIncrementalWetRibbonCarrier } from "./studio-wet-ribbon-carrier";

import type {
  StudioCausalWatercolorPlanInput,
  StudioIncrementalCausalWatercolorPlanner,
} from "../studio-causal-watercolor-brush";
import type {
  StudioBrushAliasWatercolorDab,
  StudioBrushAliasWatercolorMaterial,
} from "./studio-brush-alias-profile";
import type { StudioBrushEngineProgramSet } from "./studio-brush-engine-program-set";
import type {
  StudioIncrementalWetRibbonCarrier,
  StudioWetRibbonCarrierPlan,
} from "./studio-wet-ribbon-carrier";

export interface StudioWetWashLivePipelineParams {
  readonly brushId: unknown;
  readonly enginePrograms?: StudioBrushEngineProgramSet | null;
  /** `previewEndpoint: true` 를 포함한, 렌더가 배치 플래너에 주던 것과 같은 입력. */
  readonly input: Partial<StudioCausalWatercolorPlanInput> | null | undefined;
  readonly carrierSeed?: number;
}

export interface StudioWetWashLivePipelinePlan {
  /** 재질 스케일이 끝난 dab 배열 — 배치 `applyStudioBrushAliasWatercolorMaterial` 결과와 동일. */
  readonly dabs: readonly StudioBrushAliasWatercolorDab[];
  /** 배치 `planStudioWetRibbonCarrier(dabs, { seed })` 결과와 동일한 캐리어 플랜. */
  readonly carrierPlan: StudioWetRibbonCarrierPlan;
}

interface PipelineEntry {
  readonly planner: StudioIncrementalCausalWatercolorPlanner;
  readonly carrier: StudioIncrementalWetRibbonCarrier;
  material: StudioBrushAliasWatercolorMaterial | null;
  materialInitialized: boolean;
  plannerGeneration: number;
  /** 플래너 재구축·재질 변경마다 증가 — 캐리어의 prefix 신뢰 무효화 신호. */
  sourceGeneration: number;
  /** 안정 prefix 의 재질 스케일 미러(append 전용) + 이번 호출의 휘발 꼬리. */
  readonly scaledDabs: StudioBrushAliasWatercolorDab[];
  scaledStableCount: number;
}

const PIPELINE_CACHE = new Map<string, PipelineEntry>();
/** 활성 획은 하나지만 draft/commit 리렌더가 겹치는 짧은 창을 위해 소수의 최근 획을 유지한다. */
const PIPELINE_CACHE_LIMIT = 8;

function obtainPipelineEntry(strokeKey: string): PipelineEntry {
  let entry = PIPELINE_CACHE.get(strokeKey);
  if (entry) {
    // LRU 갱신: 재삽입으로 삽입 순서를 최근 사용 순서로 유지한다.
    PIPELINE_CACHE.delete(strokeKey);
  } else {
    entry = {
      planner: createStudioIncrementalCausalWatercolorPlanner(),
      carrier: createStudioIncrementalWetRibbonCarrier(),
      material: null,
      materialInitialized: false,
      plannerGeneration: -1,
      sourceGeneration: 0,
      scaledDabs: [],
      scaledStableCount: 0,
    };
  }
  PIPELINE_CACHE.set(strokeKey, entry);
  while (PIPELINE_CACHE.size > PIPELINE_CACHE_LIMIT) {
    const oldest = PIPELINE_CACHE.keys().next().value;
    if (oldest === undefined) break;
    PIPELINE_CACHE.delete(oldest);
  }
  return entry;
}

/**
 * 획 키(요소 id)로 보관된 증분 파이프라인 한 번 실행.
 *
 * 웻 텍스처 프로그램이 핀된 브러시는 `null` — 호출부는 배치 체인으로 내려가야 한다.
 * 활성 초안 전용이므로 항상 `finalized: false` 로 걷는다(봉인은 커밋 배치 렌더의 몫).
 */
export function planStudioWetWashLivePipeline(
  strokeKey: string,
  params: StudioWetWashLivePipelineParams,
): StudioWetWashLivePipelinePlan | null {
  const stage = resolveStudioBrushAliasWatercolorMaterialStage(
    params.brushId,
    params.enginePrograms,
  );
  if (stage.wetEdgeBloomProgramId || stage.livingInkBakeProgramId) return null;

  const entry = obtainPipelineEntry(strokeKey);
  const plannedDabs = entry.planner.plan(params.input, false);
  const stableDabCount = entry.planner.stableDabCount();
  const plannerGeneration = entry.planner.generation();
  if (
    !entry.materialInitialized
    || entry.material !== stage.material
    || entry.plannerGeneration !== plannerGeneration
  ) {
    entry.material = stage.material;
    entry.materialInitialized = true;
    entry.plannerGeneration = plannerGeneration;
    entry.sourceGeneration += 1;
    entry.scaledDabs.length = 0;
    entry.scaledStableCount = 0;
  }

  // 재질 단계: 배치의 `dabs.map(scale)` 을 안정 prefix 미러 + 휘발 꼬리 재스케일로 나눈다.
  // 재질 행이 없는 브러시는 배치가 입력 배열을 그대로 돌려주므로 여기서도 플래너 배열을 그대로
  // 흘린다(identity).
  const material = entry.material;
  let stagedDabs: readonly StudioBrushAliasWatercolorDab[];
  if (material) {
    const scaled = entry.scaledDabs;
    scaled.length = entry.scaledStableCount;
    for (let index = entry.scaledStableCount; index < stableDabCount; index += 1) {
      scaled.push(scaleStudioBrushAliasWatercolorMaterialDab(material, plannedDabs[index]!));
    }
    entry.scaledStableCount = stableDabCount;
    for (let index = stableDabCount; index < plannedDabs.length; index += 1) {
      scaled.push(scaleStudioBrushAliasWatercolorMaterialDab(material, plannedDabs[index]!));
    }
    stagedDabs = scaled;
  } else {
    stagedDabs = plannedDabs;
  }

  const carrierPlan = entry.carrier.plan(
    stagedDabs,
    stableDabCount,
    entry.sourceGeneration,
    { seed: params.carrierSeed },
  );
  return { dabs: stagedDabs, carrierPlan };
}

/** 테스트 전용 — 모듈 캐시를 비워 획 키 재사용 간섭을 막는다. */
export function resetStudioWetWashLivePipelineCacheForTests(): void {
  PIPELINE_CACHE.clear();
}
