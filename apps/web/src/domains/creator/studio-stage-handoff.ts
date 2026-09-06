/**
 * Studio Stage Handoff Package Coordinator — 웹툰 스튜디오 공정 인계
 * (콘티 → 3D → 선화 → 채색 → 식자 → 검수 → 출고) 패키지 및 워크플로 코어.
 *
 * 마스터플랜 11.4 (Stage Handoff) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 공정 파이프라인 단계 정의 (script, storyboard, 3d-layout, lineart, color, lettering, review, preflight, publish)
 * - 인계 패키지(대상 컷, 필수 레이어, 잠금 범위, 지시사항, 승인 디자인, 금지 변경 사항, 마감일)
 * - 인계 수신 확인(Acknowledge), 완료 제출(Submit), 자동 검증, 승인/반려(Approve/Reject)
 * - 공정별 리드타임(Lead Time) 및 병목 측정
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_STAGE_HANDOFF_VERSION = 1 as const;

export const STAGE_HANDOFF_PIPELINE = [
  "script",
  "storyboard",
  "3d-layout",
  "lineart",
  "color",
  "lettering",
  "review",
  "preflight",
  "publish",
] as const;
export type StageHandoffPipelineStage = (typeof STAGE_HANDOFF_PIPELINE)[number];

export const STAGE_HANDOFF_STATUSES = [
  "created",
  "acknowledged",
  "in-progress",
  "submitted",
  "approved",
  "rejected",
] as const;
export type StageHandoffStatus = (typeof STAGE_HANDOFF_STATUSES)[number];

export interface HandoffChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly completed: boolean;
}

export interface StageHandoffPackage {
  readonly id: string;
  readonly episodeId: string;
  readonly sourceStage: StageHandoffPipelineStage;
  readonly targetStage: StageHandoffPipelineStage;
  readonly authorUserId: string;
  readonly assigneeUserId: string;
  readonly targetPanelIds: readonly string[];
  readonly requiredLayerIds?: readonly string[];
  readonly instructions: string;
  readonly approvedAssetRefs?: readonly string[];
  readonly forbiddenModifications?: readonly string[];
  readonly checklist: readonly HandoffChecklistItem[];
  readonly deadlineMs?: number;
  readonly status: StageHandoffStatus;
  readonly reviewNote?: string;
  readonly timestamps: {
    readonly createdMs: number;
    readonly acknowledgedMs?: number;
    readonly submittedMs?: number;
    readonly approvedMs?: number;
    readonly rejectedMs?: number;
  };
}

export interface HandoffLeadTimeMetrics {
  readonly ackLatencyMinutes?: number; // 시간부터 확인까지
  readonly workDurationMinutes?: number; // 확인부터 제출까지
  readonly reviewDurationMinutes?: number; // 제출부터 승인까지
  readonly totalLeadTimeMinutes: number; // 생성부터 최종 승인까지
}

export function createStageHandoffPackage(params: {
  id: string;
  episodeId: string;
  sourceStage: StageHandoffPipelineStage;
  targetStage: StageHandoffPipelineStage;
  authorUserId: string;
  assigneeUserId: string;
  targetPanelIds: readonly string[];
  requiredLayerIds?: readonly string[];
  instructions: string;
  approvedAssetRefs?: readonly string[];
  forbiddenModifications?: readonly string[];
  checklist?: readonly string[];
  deadlineMs?: number;
  nowMs: number;
}): StageHandoffPackage {
  const checklistItems: HandoffChecklistItem[] = (params.checklist ?? []).map(
    (item, index) =>
      Object.freeze({
        id: `item_${index + 1}`,
        label: item.trim(),
        completed: false,
      }),
  );

  return Object.freeze({
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    sourceStage: params.sourceStage,
    targetStage: params.targetStage,
    authorUserId: params.authorUserId.trim(),
    assigneeUserId: params.assigneeUserId.trim(),
    targetPanelIds: Object.freeze([...params.targetPanelIds]),
    requiredLayerIds: params.requiredLayerIds
      ? Object.freeze([...params.requiredLayerIds])
      : undefined,
    instructions: params.instructions.trim(),
    approvedAssetRefs: params.approvedAssetRefs
      ? Object.freeze([...params.approvedAssetRefs])
      : undefined,
    forbiddenModifications: params.forbiddenModifications
      ? Object.freeze([...params.forbiddenModifications])
      : undefined,
    checklist: Object.freeze(checklistItems),
    deadlineMs: params.deadlineMs,
    status: "created",
    timestamps: Object.freeze({
      createdMs: params.nowMs,
    }),
  });
}

export function acknowledgeHandoff(
  pkg: StageHandoffPackage,
  assigneeUserId: string,
  nowMs: number,
): StageHandoffPackage {
  if (pkg.status !== "created") {
    throw new Error(`Cannot acknowledge package in status ${pkg.status}`);
  }
  if (pkg.assigneeUserId !== assigneeUserId) {
    throw new Error(
      `User ${assigneeUserId} is not the assigned recipient (${pkg.assigneeUserId})`,
    );
  }
  return {
    ...pkg,
    status: "in-progress",
    timestamps: {
      ...pkg.timestamps,
      acknowledgedMs: nowMs,
    },
  };
}

export function submitHandoffForReview(
  pkg: StageHandoffPackage,
  completedChecklistIds: readonly string[],
  nowMs: number,
): StageHandoffPackage {
  if (pkg.status !== "in-progress" && pkg.status !== "rejected") {
    throw new Error(`Cannot submit package in status ${pkg.status}`);
  }
  const completedSet = new Set(completedChecklistIds);
  const updatedChecklist = pkg.checklist.map((item) => ({
    ...item,
    completed: completedSet.has(item.id),
  }));

  const allCompleted = updatedChecklist.every((i) => i.completed);
  if (!allCompleted && updatedChecklist.length > 0) {
    throw new Error("모든 필수 체크리스트 항목을 완료해야 제출할 수 있습니다.");
  }

  return {
    ...pkg,
    status: "submitted",
    checklist: Object.freeze(updatedChecklist),
    timestamps: {
      ...pkg.timestamps,
      submittedMs: nowMs,
    },
  };
}

export function approveHandoff(
  pkg: StageHandoffPackage,
  reviewerUserId: string,
  nowMs: number,
  reviewNote?: string,
): StageHandoffPackage {
  if (pkg.status !== "submitted") {
    throw new Error(`Cannot approve package in status ${pkg.status}`);
  }
  return {
    ...pkg,
    status: "approved",
    reviewNote: reviewNote?.trim(),
    timestamps: {
      ...pkg.timestamps,
      approvedMs: nowMs,
    },
  };
}

export function rejectHandoff(
  pkg: StageHandoffPackage,
  reviewerUserId: string,
  rejectionReason: string,
  nowMs: number,
): StageHandoffPackage {
  if (pkg.status !== "submitted") {
    throw new Error(`Cannot reject package in status ${pkg.status}`);
  }
  if (!rejectionReason.trim()) {
    throw new Error("반려 사유(rejectionReason)를 반드시 입력해야 합니다.");
  }
  return {
    ...pkg,
    status: "rejected",
    reviewNote: rejectionReason.trim(),
    timestamps: {
      ...pkg.timestamps,
      rejectedMs: nowMs,
    },
  };
}

export function calculateHandoffLeadTime(
  pkg: StageHandoffPackage,
  currentNowMs?: number,
): HandoffLeadTimeMetrics {
  const ts = pkg.timestamps;
  const now = currentNowMs ?? Date.now();
  const endMs = ts.approvedMs ?? now;

  const ackLatencyMinutes = ts.acknowledgedMs
    ? (ts.acknowledgedMs - ts.createdMs) / 60_000
    : undefined;

  const workDurationMinutes =
    ts.submittedMs && ts.acknowledgedMs
      ? (ts.submittedMs - ts.acknowledgedMs) / 60_000
      : undefined;

  const reviewDurationMinutes =
    ts.approvedMs && ts.submittedMs
      ? (ts.approvedMs - ts.submittedMs) / 60_000
      : undefined;

  const totalLeadTimeMinutes = Math.max(0, (endMs - ts.createdMs) / 60_000);

  return {
    ackLatencyMinutes,
    workDurationMinutes,
    reviewDurationMinutes,
    totalLeadTimeMinutes,
  };
}
