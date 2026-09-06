/**
 * Studio Time Travel Studio & Decision Log — 웹툰 제작 과정의 모든 이벤트
 * (스트로크·레이어·3D·대사·검수)를 타임라인으로 기록하고, 특정 시점 분기 및 의사결정 로그를 추적하는 코어.
 *
 * 마스터플랜 11.8 (Time Travel Studio) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 제작 이벤트 스트림 (stroke-draw, layer-transform, 3d-pose, dialogue, merge, publish 등)
 * - 특정 시점(Event Sequence Index / Timestamp) 상태 재생 및 새 Branch 생성
 * - 왜 수정했는지 의사결정 사유(Decision Log) 보존
 * - 메이킹(Making-of) / 타임랩스 키프레임 추출
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_TIME_TRAVEL_VERSION = 1 as const;

export const STUDIO_TIME_TRAVEL_LIMITS = Object.freeze({
  maxEvents: 50_000,
  maxBranches: 256,
  maxIdLength: 128,
  maxReasonLength: 512,
  maxDiagnostics: 256,
});

export const PRODUCTION_EVENT_TYPES = [
  "stroke-draw",
  "layer-create",
  "layer-transform",
  "layer-delete",
  "3d-camera-change",
  "3d-pose-change",
  "dialogue-edit",
  "balloon-layout",
  "annotation",
  "merge-commit",
  "publish-snapshot",
] as const;
export type ProductionEventType = (typeof PRODUCTION_EVENT_TYPES)[number];

export const CHECKPOINT_MARKER_KINDS = [
  "approved",
  "merge",
  "publish",
  "milestone",
] as const;
export type CheckpointMarkerKind = (typeof CHECKPOINT_MARKER_KINDS)[number];

export interface ProductionEvent {
  readonly id: string;
  readonly sequenceIndex: number;
  readonly type: ProductionEventType;
  readonly userId: string;
  readonly userRole: string;
  readonly targetId: string;
  readonly summary: string;
  readonly decisionLog?: string; // 왜 수정했는지 rationale
  readonly marker?: CheckpointMarkerKind;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly timestampMs: number;
}

export interface TimeTravelBranch {
  readonly branchName: string;
  readonly createdFromSequenceIndex: number;
  readonly authorUserId: string;
  readonly createdAtMs: number;
}

export interface StudioTimeTravelLedger {
  readonly version: typeof STUDIO_TIME_TRAVEL_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly events: readonly ProductionEvent[];
  readonly branches: readonly TimeTravelBranch[];
}

export function createStudioTimeTravelLedger(params: {
  id: string;
  episodeId: string;
  events?: readonly ProductionEvent[];
  branches?: readonly TimeTravelBranch[];
}): StudioTimeTravelLedger {
  const sortedEvents = [...(params.events ?? [])].sort(
    (a, b) => a.sequenceIndex - b.sequenceIndex,
  );
  return Object.freeze({
    version: STUDIO_TIME_TRAVEL_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    events: Object.freeze(sortedEvents),
    branches: Object.freeze([...(params.branches ?? [])]),
  });
}

export function recordProductionEvent(
  ledger: StudioTimeTravelLedger,
  event: Omit<ProductionEvent, "sequenceIndex">,
): StudioTimeTravelLedger {
  const nextSeq = ledger.events.length;
  const newEvent: ProductionEvent = Object.freeze({
    ...event,
    sequenceIndex: nextSeq,
    id: event.id.trim(),
    summary: event.summary.trim(),
    decisionLog: event.decisionLog?.trim(),
  });

  return {
    ...ledger,
    events: Object.freeze([...ledger.events, newEvent]),
  };
}

export function branchAtEvent(
  ledger: StudioTimeTravelLedger,
  targetSequenceIndex: number,
  newBranchName: string,
  authorUserId: string,
  nowMs: number,
): StudioTimeTravelLedger {
  if (targetSequenceIndex < 0 || targetSequenceIndex >= ledger.events.length) {
    throw new Error(`Invalid sequence index ${targetSequenceIndex}`);
  }
  const cleanName = newBranchName.trim();
  if (ledger.branches.some((b) => b.branchName === cleanName)) {
    throw new Error(`Branch ${cleanName} already exists`);
  }

  const newBranch: TimeTravelBranch = Object.freeze({
    branchName: cleanName,
    createdFromSequenceIndex: targetSequenceIndex,
    authorUserId: authorUserId.trim(),
    createdAtMs: nowMs,
  });

  return {
    ...ledger,
    branches: Object.freeze([...ledger.branches, newBranch]),
  };
}

export function filterEvents(
  ledger: StudioTimeTravelLedger,
  options: {
    userId?: string;
    type?: ProductionEventType;
    markerOnly?: boolean;
    fromIndex?: number;
    toIndex?: number;
  },
): readonly ProductionEvent[] {
  return Object.freeze(
    ledger.events.filter((e) => {
      if (options.userId && e.userId !== options.userId) return false;
      if (options.type && e.type !== options.type) return false;
      if (options.markerOnly && !e.marker) return false;
      if (options.fromIndex !== undefined && e.sequenceIndex < options.fromIndex) return false;
      if (options.toIndex !== undefined && e.sequenceIndex > options.toIndex) return false;
      return true;
    }),
  );
}

export interface MakingOfKeyframe {
  readonly sequenceIndex: number;
  readonly timestampMs: number;
  readonly summary: string;
  readonly type: ProductionEventType;
  readonly isMarker: boolean;
}

/**
 * 타임랩스/메이킹 제작을 위한 주요 이벤트 키프레임을 추출한다.
 */
export function extractMakingOfKeyframes(
  ledger: StudioTimeTravelLedger,
  sampleIntervalMs: number = 30_000,
): readonly MakingOfKeyframe[] {
  if (ledger.events.length === 0) return Object.freeze([]);

  const keyframes: MakingOfKeyframe[] = [];
  let lastSampleTime = -Infinity;

  for (const e of ledger.events) {
    const isMarker = e.marker !== undefined;
    const timeSinceLast = e.timestampMs - lastSampleTime;

    if (isMarker || timeSinceLast >= sampleIntervalMs || keyframes.length === 0) {
      keyframes.push(
        Object.freeze({
          sequenceIndex: e.sequenceIndex,
          timestampMs: e.timestampMs,
          summary: e.summary,
          type: e.type,
          isMarker,
        }),
      );
      lastSampleTime = e.timestampMs;
    }
  }

  return Object.freeze(keyframes);
}
