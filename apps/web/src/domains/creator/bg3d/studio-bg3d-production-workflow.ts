import type {
  StudioBg3dSceneDocument,
  StudioBg3dToneMode,
} from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_PRODUCTION_WORKFLOW_STAGE_IDS = Object.freeze([
  "scene",
  "subject",
  "shot",
  "look",
  "output",
] as const);

export type StudioBg3dProductionWorkflowStageId =
  (typeof STUDIO_BG3D_PRODUCTION_WORKFLOW_STAGE_IDS)[number];

export type StudioBg3dProductionWorkflowStageStatus =
  | "ready"
  | "attention"
  | "blocked"
  | "working"
  | "optional";

export type StudioBg3dProductionWorkflowActionKind =
  | "capture-shot"
  | "select-all-shots"
  | "apply-manuscript-preset"
  | "enable-line-preview"
  | "start-export"
  | "none";

export interface StudioBg3dProductionSceneSummary {
  readonly nodeCount: number;
  readonly visibleNodeCount: number;
  readonly lockedNodeCount: number;
  readonly primitiveNodeCount: number;
  readonly modelNodeCount: number;
  readonly attachmentCount: number;
  readonly selectedNodeCount: number;
  readonly posedModelCount: number;
  readonly animatedModelCount: number;
  readonly constrainedModelCount: number;
  readonly activeShotId: string | null;
  readonly lineOutputEnabled: boolean;
  readonly lineArtPreview: boolean;
  readonly toneMode: StudioBg3dToneMode;
  readonly transparentBackground: boolean;
}

export interface StudioBg3dProductionWorkflowBatchSnapshot {
  readonly selectedShotCount: number;
  readonly availablePassCount: number;
  readonly selectedPassCount: number;
  readonly recoveryReady: boolean;
  readonly blockedReason: string | null;
  readonly isRendering: boolean;
}

export interface StudioBg3dProductionWorkflowInput {
  readonly sceneSummary?: StudioBg3dProductionSceneSummary;
  readonly shotCount: number;
  readonly batch?: StudioBg3dProductionWorkflowBatchSnapshot;
  readonly canToggleLineArtPreview?: boolean;
}

export interface StudioBg3dProductionWorkflowStage {
  readonly id: StudioBg3dProductionWorkflowStageId;
  readonly label: string;
  readonly status: StudioBg3dProductionWorkflowStageStatus;
  readonly summary: string;
  readonly detail: string;
}

export interface StudioBg3dProductionWorkflowAction {
  readonly kind: StudioBg3dProductionWorkflowActionKind;
  readonly label: string;
  readonly description: string;
}

export interface StudioBg3dProductionWorkflowPlan {
  readonly stages: readonly StudioBg3dProductionWorkflowStage[];
  readonly readyStageCount: number;
  readonly progressPercent: number;
  readonly attentionCount: number;
  readonly exportReady: boolean;
  readonly blockingReason: string | null;
  readonly nextAction: StudioBg3dProductionWorkflowAction;
}

export interface SummarizeStudioBg3dProductionSceneInput {
  readonly document: StudioBg3dSceneDocument;
  readonly selectedNodeCount: number;
  readonly lineArtPreview: boolean;
  readonly transparentBackground: boolean;
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/**
 * Projects the canonical scene document into the small read model required by workflow UI.
 * Runtime handles and attachment bytes never cross this boundary.
 */
export function summarizeStudioBg3dProductionScene(
  input: SummarizeStudioBg3dProductionSceneInput,
): StudioBg3dProductionSceneSummary {
  let visibleNodeCount = 0;
  let lockedNodeCount = 0;
  let primitiveNodeCount = 0;
  let modelNodeCount = 0;
  let posedModelCount = 0;
  let animatedModelCount = 0;
  let constrainedModelCount = 0;

  for (const node of input.document.nodes) {
    if (node.visible) visibleNodeCount += 1;
    if (node.locked) lockedNodeCount += 1;
    if (node.kind === "primitive") {
      primitiveNodeCount += 1;
      continue;
    }

    modelNodeCount += 1;
    if (node.pose?.enabled !== false && (node.pose?.joints.length ?? 0) > 0) {
      posedModelCount += 1;
    }
    if (node.animation !== undefined) animatedModelCount += 1;
    if (
      node.constraints?.enabled !== false &&
      ((node.constraints?.aims.length ?? 0) > 0 ||
        (node.constraints?.twoBoneIks.length ?? 0) > 0)
    ) {
      constrainedModelCount += 1;
    }
  }

  return Object.freeze({
    nodeCount: input.document.nodes.length,
    visibleNodeCount,
    lockedNodeCount,
    primitiveNodeCount,
    modelNodeCount,
    attachmentCount: input.document.attachments.length,
    selectedNodeCount: boundedInteger(input.selectedNodeCount, input.document.nodes.length),
    posedModelCount,
    animatedModelCount,
    constrainedModelCount,
    activeShotId: input.document.activeShotId ?? null,
    lineOutputEnabled: input.document.output.line.enabled,
    lineArtPreview: input.lineArtPreview,
    toneMode: input.document.output.tone.mode,
    transparentBackground: input.transparentBackground,
  });
}

function freezeStage(
  stage: StudioBg3dProductionWorkflowStage,
): StudioBg3dProductionWorkflowStage {
  return Object.freeze(stage);
}

function stageScore(status: StudioBg3dProductionWorkflowStageStatus): number {
  switch (status) {
    case "ready":
    case "optional":
      return 1;
    case "working":
      return 0.8;
    case "attention":
      return 0.5;
    case "blocked":
      return 0;
  }
}

function resolveNextAction(
  input: StudioBg3dProductionWorkflowInput,
  sceneReady: boolean,
  lookReady: boolean,
): StudioBg3dProductionWorkflowAction {
  const scene = input.sceneSummary;
  const batch = input.batch;

  if (!scene) {
    return Object.freeze({
      kind: "none",
      label: "장면 상태 확인 중",
      description: "3D 편집기에서 실제 장면 상태가 연결되면 다음 작업을 안내합니다.",
    });
  }
  if (!sceneReady) {
    return Object.freeze({
      kind: "none",
      label: "장면 또는 에셋을 먼저 추가",
      description: "프리미티브나 GLB 에셋을 배치한 뒤 제작 흐름을 시작하세요.",
    });
  }
  if (batch?.isRendering) {
    return Object.freeze({
      kind: "none",
      label: "배치 출력 진행 중",
      description: "현재 컷과 패스를 순차 처리하고 있습니다. 진행 상태는 아래에 유지됩니다.",
    });
  }
  if (input.shotCount === 0) {
    return Object.freeze({
      kind: "capture-shot",
      label: "현재 장면을 첫 컷으로 저장",
      description: "카메라·조명·가시성·LT 설정을 실제 SceneDocument 컷으로 기록합니다.",
    });
  }
  if (!batch) {
    return Object.freeze({
      kind: "none",
      label: "출력 런타임 연결 대기",
      description: "저장 컷은 준비됐지만 멀티패스 복구 런타임이 아직 연결되지 않았습니다.",
    });
  }
  if (!batch.recoveryReady || batch.blockedReason) {
    return Object.freeze({
      kind: "none",
      label: "출력 복구 상태 확인",
      description: batch.blockedReason ?? "현재 문서의 복구 권한을 준비하지 못했습니다.",
    });
  }
  if (batch.selectedShotCount === 0) {
    return Object.freeze({
      kind: "select-all-shots",
      label: "저장된 컷 전체 선택",
      description: "컷 덱의 모든 실제 컷을 배치 출력 대상으로 연결합니다.",
    });
  }
  if (batch.selectedPassCount === 0) {
    return Object.freeze({
      kind: "apply-manuscript-preset",
      label: "웹툰 원고 패스 자동 선택",
      description: "LT 합성·컬러·톤·질감선·주선을 검증된 원고 프리셋으로 선택합니다.",
    });
  }
  if (!lookReady && input.canToggleLineArtPreview) {
    return Object.freeze({
      kind: "enable-line-preview",
      label: "선화 미리보기로 최종 점검",
      description: "출력 전에 주선과 실루엣 가독성을 현재 뷰포트에서 확인합니다.",
    });
  }

  return Object.freeze({
    kind: "start-export",
    label: `${batch.selectedShotCount}컷 · ${batch.selectedPassCount}패스 출력 시작`,
    description: "복구 가능한 순차 렌더·PSD·콘택트 시트·ZIP 무결성 경로를 실행합니다.",
  });
}

/**
 * Deterministic, side-effect-free workflow planner shared by the director and export surfaces.
 * It never claims renderer support that is not already exposed by the canonical batch runtime.
 */
export function planStudioBg3dProductionWorkflow(
  input: StudioBg3dProductionWorkflowInput,
): StudioBg3dProductionWorkflowPlan {
  const scene = input.sceneSummary;
  const batch = input.batch;
  const sceneReady = (scene?.nodeCount ?? 0) > 0;
  const subjectFeatureCount =
    (scene?.posedModelCount ?? 0) +
    (scene?.animatedModelCount ?? 0) +
    (scene?.constrainedModelCount ?? 0);
  const lookReady = Boolean(
    scene &&
      (scene.lineOutputEnabled || scene.lineArtPreview || scene.toneMode !== "none"),
  );

  const sceneStage = freezeStage(
    !scene
      ? {
          id: "scene",
          label: "장면",
          status: "attention",
          summary: "상태 연결 대기",
          detail: "3D 편집기 런타임에서 장면 요약을 불러오고 있습니다.",
        }
      : sceneReady
        ? {
            id: "scene",
            label: "장면",
            status: "ready",
            summary: `${scene.nodeCount}개 노드 · ${scene.attachmentCount}개 에셋`,
            detail: `${scene.visibleNodeCount}개 표시 · ${scene.selectedNodeCount}개 선택 · ${scene.lockedNodeCount}개 잠금`,
          }
        : {
            id: "scene",
            label: "장면",
            status: "blocked",
            summary: "비어 있음",
            detail: "프리미티브나 GLB 에셋을 하나 이상 배치하세요.",
          },
  );

  const subjectStage = freezeStage(
    !scene || scene.modelNodeCount === 0
      ? {
          id: "subject",
          label: "캐릭터·포즈",
          status: "optional",
          summary: scene ? "배경 전용 장면" : "상태 연결 대기",
          detail: scene
            ? "모델 캐릭터가 없는 장면이므로 이 단계는 선택 사항입니다."
            : "장면 모델 상태를 불러오고 있습니다.",
        }
      : subjectFeatureCount > 0
        ? {
            id: "subject",
            label: "캐릭터·포즈",
            status: "ready",
            summary: `${scene.modelNodeCount}개 모델 연동`,
            detail: `포즈 ${scene.posedModelCount} · 애니메이션 ${scene.animatedModelCount} · 제약 ${scene.constrainedModelCount}`,
          }
        : {
            id: "subject",
            label: "캐릭터·포즈",
            status: "attention",
            summary: `${scene.modelNodeCount}개 모델 기본 상태`,
            detail: "필요하면 포즈·표정·IK·애니메이션을 적용한 뒤 컷을 저장하세요.",
          },
  );

  const shotStage = freezeStage(
    !sceneReady
      ? {
          id: "shot",
          label: "카메라·컷",
          status: "blocked",
          summary: "장면 필요",
          detail: "장면을 구성해야 카메라 컷을 기록할 수 있습니다.",
        }
      : input.shotCount > 0
        ? {
            id: "shot",
            label: "카메라·컷",
            status: "ready",
            summary: `${input.shotCount}개 컷 저장`,
            detail: scene?.activeShotId
              ? "저장 컷이 현재 장면에 적용되어 있습니다."
              : "컷 덱을 순서대로 검수하고 필요하면 현재 카메라를 추가 저장하세요.",
          }
        : {
            id: "shot",
            label: "카메라·컷",
            status: "attention",
            summary: "저장 컷 없음",
            detail: "현재 카메라·조명·가시성을 첫 컷으로 기록하세요.",
          },
  );

  const lookStage = freezeStage(
    !scene
      ? {
          id: "look",
          label: "룩·선화",
          status: "attention",
          summary: "상태 연결 대기",
          detail: "LT·톤·투명 배경 상태를 불러오고 있습니다.",
        }
      : lookReady
        ? {
            id: "look",
            label: "룩·선화",
            status: "ready",
            summary: scene.lineArtPreview
              ? "선화 미리보기 켜짐"
              : scene.toneMode !== "none"
                ? `${scene.toneMode} 톤`
                : "선화 출력 켜짐",
            detail: scene.transparentBackground
              ? "투명 배경으로 2D 합성을 준비합니다."
              : "장면 배경을 포함해 출력합니다.",
          }
        : {
            id: "look",
            label: "룩·선화",
            status: "attention",
            summary: "기본 렌더 상태",
            detail: "선화 미리보기나 톤을 켜 최종 원고 가독성을 점검하세요.",
          },
  );

  const outputStage = freezeStage(
    !batch
      ? {
          id: "output",
          label: "출력·전달",
          status: "attention",
          summary: "런타임 연결 대기",
          detail: "멀티패스 배치 런타임을 준비하고 있습니다.",
        }
      : batch.isRendering
        ? {
            id: "output",
            label: "출력·전달",
            status: "working",
            summary: "배치 출력 진행 중",
            detail: `${batch.selectedShotCount}컷 · ${batch.selectedPassCount}패스를 복구 가능한 경로로 처리합니다.`,
          }
        : batch.blockedReason
          ? {
              id: "output",
              label: "출력·전달",
              status: "blocked",
              summary: "출력 차단",
              detail: batch.blockedReason,
            }
          : !batch.recoveryReady
            ? {
                id: "output",
                label: "출력·전달",
                status: "blocked",
                summary: "복구 저장소 필요",
                detail: "현재 문서의 복구 권한을 준비하지 못했습니다.",
              }
            : batch.selectedShotCount === 0 || batch.selectedPassCount === 0
              ? {
                  id: "output",
                  label: "출력·전달",
                  status: "attention",
                  summary: `${batch.selectedShotCount}컷 · ${batch.selectedPassCount}패스`,
                  detail: batch.selectedShotCount === 0
                    ? "출력할 컷을 하나 이상 선택하세요."
                    : "실제 PNG 패스를 하나 이상 선택하세요.",
                }
              : {
                  id: "output",
                  label: "출력·전달",
                  status: "ready",
                  summary: `${batch.selectedShotCount}컷 · ${batch.selectedPassCount}패스`,
                  detail: `${batch.availablePassCount}개 검증 패스 중 선택 완료 · 복구 경로 준비됨`,
                },
  );

  const stages = Object.freeze([
    sceneStage,
    subjectStage,
    shotStage,
    lookStage,
    outputStage,
  ]);
  const readyStageCount = stages.filter(
    (stage) => stage.status === "ready" || stage.status === "optional",
  ).length;
  const progressPercent = Math.round(
    (stages.reduce((total, stage) => total + stageScore(stage.status), 0) / stages.length) * 100,
  );
  const attentionCount = stages.filter(
    (stage) => stage.status === "attention" || stage.status === "blocked",
  ).length;
  const blockingReason = stages.find((stage) => stage.status === "blocked")?.detail ?? null;

  return Object.freeze({
    stages,
    readyStageCount,
    progressPercent,
    attentionCount,
    exportReady: outputStage.status === "ready",
    blockingReason,
    nextAction: resolveNextAction(input, sceneReady, lookReady),
  });
}
