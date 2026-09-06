/**
 * Studio AI Change Set & Semantic Production Graph — AI 보조 생성 결과물을
 * 비파괴적 제안(Proposal), 레이어별 선택적 승인(Selective Apply), 롤백 및
 * 계통(Lineage) 원장으로 관리하는 코어.
 *
 * 마스터플랜 12.2 (Semantic Production Graph), 12.3 (AI Change Set) & 997개 기능 갭:
 * - AI 모델/버전/프롬프트/시드/구조조건/입력 에셋 레퍼런스 기록
 * - 생성된 레이어/마스크의 시각적 Diff 및 전후 비교
 * - Apply / Apply Selected / Reject / Rollback 상태 수명주기
 * - 생성 비용(Compute Tokens/Credits) 산출 및 계통(Lineage) 추적
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_AI_CHANGE_SET_VERSION = 1 as const;

export type AiChangeSetStatus =
  | "proposed"
  | "applied"
  | "partially-applied"
  | "rejected"
  | "rolled-back";

export interface AiModelConfig {
  readonly modelName: string;
  readonly version: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly seed: number;
  readonly guidanceScale?: number;
  readonly controlNetRef?: string;
  readonly loraRefs?: readonly string[];
}

export interface AiProposedLayer {
  readonly layerId: string;
  readonly layerName: string;
  readonly assetUri: string;
  readonly blendMode: string;
  readonly opacity: number;
  readonly isSelectedForApply: boolean;
}

export interface AiInputReference {
  readonly assetId: string;
  readonly assetName: string;
  readonly role: "character-ip" | "pose-skeleton" | "depth-map" | "style-transfer" | "lineart";
}

export interface StudioAiChangeSet {
  readonly version: typeof STUDIO_AI_CHANGE_SET_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly panelId: string;
  readonly authorUserId: string;
  readonly modelConfig: AiModelConfig;
  readonly inputReferences: readonly AiInputReference[];
  readonly proposedLayers: readonly AiProposedLayer[];
  readonly status: AiChangeSetStatus;
  readonly computeTokensUsed: number;
  readonly reviewNote?: string;
  readonly createdAtMs: number;
  readonly resolvedAtMs?: number;
}

export function createAiChangeSet(params: {
  id: string;
  episodeId: string;
  panelId: string;
  authorUserId: string;
  modelConfig: AiModelConfig;
  inputReferences?: readonly AiInputReference[];
  proposedLayers: readonly Omit<AiProposedLayer, "isSelectedForApply">[];
  computeTokensUsed?: number;
  nowMs: number;
}): StudioAiChangeSet {
  const layers: AiProposedLayer[] = params.proposedLayers.map((l) =>
    Object.freeze({
      ...l,
      isSelectedForApply: true,
    }),
  );

  return Object.freeze({
    version: STUDIO_AI_CHANGE_SET_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    panelId: params.panelId.trim(),
    authorUserId: params.authorUserId.trim(),
    modelConfig: Object.freeze({ ...params.modelConfig }),
    inputReferences: Object.freeze([...(params.inputReferences ?? [])]),
    proposedLayers: Object.freeze(layers),
    status: "proposed",
    computeTokensUsed: params.computeTokensUsed ?? 100,
    createdAtMs: params.nowMs,
  });
}

/**
 * 변경 제안 세트에서 특정 레이어들만 선택적으로 승인/적용(Apply Selected)한다.
 */
export function applyAiChangeSet(
  changeSet: StudioAiChangeSet,
  selectedLayerIds: readonly string[],
  nowMs: number,
  reviewNote?: string,
): StudioAiChangeSet {
  if (changeSet.status !== "proposed") {
    throw new Error(`Cannot apply change set in status ${changeSet.status}`);
  }
  const selectedSet = new Set(selectedLayerIds);
  const updatedLayers = changeSet.proposedLayers.map((l) =>
    Object.freeze({
      ...l,
      isSelectedForApply: selectedSet.has(l.layerId),
    }),
  );

  const appliedCount = updatedLayers.filter((l) => l.isSelectedForApply).length;
  const isPartial = appliedCount > 0 && appliedCount < updatedLayers.length;

  return {
    ...changeSet,
    status: isPartial ? "partially-applied" : "applied",
    proposedLayers: Object.freeze(updatedLayers),
    reviewNote: reviewNote?.trim(),
    resolvedAtMs: nowMs,
  };
}

export function rejectAiChangeSet(
  changeSet: StudioAiChangeSet,
  rejectionReason: string,
  nowMs: number,
): StudioAiChangeSet {
  if (changeSet.status !== "proposed") {
    throw new Error(`Cannot reject change set in status ${changeSet.status}`);
  }
  return {
    ...changeSet,
    status: "rejected",
    reviewNote: rejectionReason.trim(),
    resolvedAtMs: nowMs,
  };
}

export function rollbackAiChangeSet(
  changeSet: StudioAiChangeSet,
  nowMs: number,
): StudioAiChangeSet {
  if (changeSet.status !== "applied" && changeSet.status !== "partially-applied") {
    throw new Error(`Cannot rollback change set in status ${changeSet.status}`);
  }
  return {
    ...changeSet,
    status: "rolled-back",
    resolvedAtMs: nowMs,
  };
}
