/**
 * 신뢰성 상태 스토어와 파괴적 명령 원장의 React 바인딩.
 *
 * 스토어 모듈을 순수하게(React 없이) 유지하고, 컴포넌트 파일이 컴포넌트만 내보내
 * fast-refresh 경계를 지키기 위해 훅만 따로 둔다(use-studio-scroll-viewport 와 동일 패턴).
 */

import { useSyncExternalStore } from "react";

import {
  getStudioDestructiveActionRecord,
  subscribeStudioDestructiveActionLedger,
} from "./studio-destructive-action-preview";
import {
  getStudioRejectedStrokeRecords,
  subscribeStudioRejectedStrokeRecovery,
} from "./studio-rejected-stroke-recovery";
import {
  getStudioReliabilityStatusSnapshot,
  subscribeStudioReliabilityStatus,
} from "./studio-reliability-status-store";

import type { StudioDestructiveActionRecord } from "./studio-destructive-action-preview";
import type { StudioRejectedStrokeRecord } from "./studio-rejected-stroke-recovery";
import type { StudioReliabilityStatusSnapshot } from "./studio-reliability-status-store";

export function useStudioRejectedStrokeRecords(): readonly StudioRejectedStrokeRecord[] {
  return useSyncExternalStore(
    subscribeStudioRejectedStrokeRecovery,
    getStudioRejectedStrokeRecords,
    getStudioRejectedStrokeRecords,
  );
}

export function useStudioReliabilityStatus(): StudioReliabilityStatusSnapshot {
  return useSyncExternalStore(
    subscribeStudioReliabilityStatus,
    getStudioReliabilityStatusSnapshot,
    getStudioReliabilityStatusSnapshot,
  );
}

export function useStudioDestructiveActionRecord(): StudioDestructiveActionRecord | null {
  return useSyncExternalStore(
    subscribeStudioDestructiveActionLedger,
    getStudioDestructiveActionRecord,
    getStudioDestructiveActionRecord,
  );
}
