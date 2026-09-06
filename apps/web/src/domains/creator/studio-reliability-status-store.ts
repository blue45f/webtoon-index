/**
 * Studio 신뢰성 상태 스토어 — 저장·동기화·GPU 상태의 단일 진실 원천.
 *
 * V5 §15 "진행 공개"는 저장·동기화·GPU·변환 상태를 상시 보이되 방해하지 않을 것을,
 * 그리고 **숨은 실패 금지**를 요구한다. 감사(ux-audit-v5 §2.10/§2.11)는 메인 캔버스
 * GPU 강등과 자동저장 실패가 `console.error`만 남기고 사용자에게 무음이라고 판정했다.
 * 이 스토어가 그 무음 경로들의 종착지다 — 실패를 보고하면 상태 레일이 즉시 읽는다.
 *
 * 설계 규율:
 *  - 순수 모듈. React·DOM·타이머·I/O 없음(React 바인딩은 use-studio-reliability-status).
 *  - 스냅샷은 동결·캐시된다. 같은 상태에서 반복 호출은 항상 같은 참조를 돌려주므로
 *    useSyncExternalStore 가 무한 렌더로 빠지지 않는다.
 *  - 채널당 최신 신호 1개만 유지한다(누적 토스트가 아니라 상태 표시기다).
 *  - Safe Mode 는 "문서 의미 손실 없이 품질만 낮춤" 계약이다. 이 스토어는 어떤 문서
 *    상태도 만지지 않고, 품질 저하 플래그만 발행한다.
 */

/** 상시 표시되는 상태 채널. */
export type StudioReliabilityChannel = "gpu" | "save" | "storage";

export const STUDIO_RELIABILITY_CHANNELS: readonly StudioReliabilityChannel[] =
  Object.freeze(["gpu", "save", "storage"]);

/**
 * `ok` 는 "정상 동작 중이며 알릴 것이 없음"이 아니라 "직전에 실패했다가 회복됨"이다.
 * 알릴 것이 없으면 신호 자체가 null 이다 — 방해하지 않기 위해서다.
 */
export type StudioReliabilityLevel = "ok" | "degraded" | "failed";

export interface StudioReliabilitySignal {
  readonly channel: StudioReliabilityChannel;
  readonly level: StudioReliabilityLevel;
  /** 상태 레일에 그대로 노출되는 한국어 한 줄. */
  readonly title: string;
  /** 무엇이 어떻게 저하됐는지 — 선택적 보조 설명. */
  readonly detail?: string;
  /** 보고 시각(ms). 주입 가능한 clock 이 없으므로 호출부가 넘긴다. */
  readonly at: number;
}

export type StudioSafeModeReason =
  | "gpu-device-lost"
  | "gpu-permanently-demoted"
  | "storage-pressure"
  | "manual";

/**
 * Safe Mode 가 낮추는 품질 축. **문서 의미는 어떤 축으로도 바뀌지 않는다** — GPU 레인을
 * 끄면 CPU/Konva 레인이 같은 문서를 그리고, 라이브 잉크를 멈추면 수채 번짐 프리뷰 대신
 * 보통 획으로 그려질 뿐 획 자체는 남는다.
 *
 * 축은 **실제 강제 지점이 있는 것만** 둔다. 강제되지 않는 품질 플래그는 이 웨이브가
 * 없애려는 dead code 와 같은 것이기 때문이다.
 *  - `gpuLanesDisabled` → device-loss 상태기계의 토너먼트 kill list(GPU 계열 provider).
 *  - `livingInkSuspended` → StudioPage 의 `beginStudioLivingInkStroke` 진입 가드.
 */
export interface StudioSafeModeQuality {
  /** GPU 레인(필터 gpu-chain·스트로크 gpu/living-ink) 비활성. */
  readonly gpuLanesDisabled: boolean;
  /** 라이브 잉크(수채 번짐 실시간 필드) 중단 — 보통 획으로 계속 그릴 수 있다. */
  readonly livingInkSuspended: boolean;
}

export const STUDIO_SAFE_MODE_FULL_QUALITY: StudioSafeModeQuality = Object.freeze({
  gpuLanesDisabled: false,
  livingInkSuspended: false,
});

export interface StudioSafeModeState {
  readonly active: boolean;
  /** 진입 사유들 — 여러 사유가 겹치면 마지막 사유가 해소돼야 빠져나온다. */
  readonly reasons: readonly StudioSafeModeReason[];
  /** 진입 시각(ms). 비활성이면 null. */
  readonly enteredAt: number | null;
  readonly quality: StudioSafeModeQuality;
  /**
   * 사용자가 수동으로 해제했는지. 해제 후에도 **새로운** 실패는 다시 진입시킨다 —
   * 한 번의 수동 해제가 이후의 모든 실패를 무음으로 만들면 그 자체가 숨은 실패다.
   */
  readonly manuallyDismissed: boolean;
}

export interface StudioReliabilityStatusSnapshot {
  readonly gpu: StudioReliabilitySignal | null;
  readonly save: StudioReliabilitySignal | null;
  readonly storage: StudioReliabilitySignal | null;
  readonly safeMode: StudioSafeModeState;
}

const IDLE_SAFE_MODE: StudioSafeModeState = Object.freeze({
  active: false,
  reasons: Object.freeze([]) as readonly StudioSafeModeReason[],
  enteredAt: null,
  quality: STUDIO_SAFE_MODE_FULL_QUALITY,
  manuallyDismissed: false,
});

const IDLE_SNAPSHOT: StudioReliabilityStatusSnapshot = Object.freeze({
  gpu: null,
  save: null,
  storage: null,
  safeMode: IDLE_SAFE_MODE,
});

/**
 * 사유별 품질 저하 축. 여러 사유가 겹치면 **가장 낮은 품질**로 합성한다(OR/최솟값) —
 * 어떤 사유도 다른 사유의 저하를 되돌리지 못한다.
 */
function qualityForReason(reason: StudioSafeModeReason): StudioSafeModeQuality {
  switch (reason) {
    case "gpu-device-lost":
    case "gpu-permanently-demoted":
    case "manual":
      return { gpuLanesDisabled: true, livingInkSuspended: true };
    case "storage-pressure":
      // 라이브 잉크는 획마다 canonical PNG 를 남긴다 — 저장소가 눌릴 때 가장 먼저 멈춘다.
      return { gpuLanesDisabled: false, livingInkSuspended: true };
  }
}

export function composeStudioSafeModeQuality(
  reasons: readonly StudioSafeModeReason[],
): StudioSafeModeQuality {
  if (reasons.length === 0) return STUDIO_SAFE_MODE_FULL_QUALITY;
  let gpuLanesDisabled = false;
  let livingInkSuspended = false;
  for (const reason of reasons) {
    const quality = qualityForReason(reason);
    gpuLanesDisabled ||= quality.gpuLanesDisabled;
    livingInkSuspended ||= quality.livingInkSuspended;
  }
  return Object.freeze({ gpuLanesDisabled, livingInkSuspended });
}

/** 사용자에게 보여줄 Safe Mode 사유 문구. */
export function describeStudioSafeModeReason(reason: StudioSafeModeReason): string {
  switch (reason) {
    case "gpu-device-lost":
      return "GPU 연결이 끊겨 선택한 GPU 기능을 사용할 수 없습니다";
    case "gpu-permanently-demoted":
      return "GPU가 반복해서 끊겨 이번 세션의 GPU 기능을 중단했습니다";
    case "storage-pressure":
      return "저장 공간이 부족해 임시 렌더 품질을 낮췄습니다";
    case "manual":
      return "직접 켠 안전 모드입니다";
  }
}

interface MutableState {
  gpu: StudioReliabilitySignal | null;
  save: StudioReliabilitySignal | null;
  storage: StudioReliabilitySignal | null;
  safeMode: StudioSafeModeState;
}

const state: MutableState = {
  gpu: null,
  save: null,
  storage: null,
  safeMode: IDLE_SAFE_MODE,
};

let snapshot: StudioReliabilityStatusSnapshot = IDLE_SNAPSHOT;
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = Object.freeze({
    gpu: state.gpu,
    save: state.save,
    storage: state.storage,
    safeMode: state.safeMode,
  });
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 리스너 격리 — 한 구독자의 예외가 다른 구독자의 고지를 막지 않는다.
    }
  }
}

export function subscribeStudioReliabilityStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStudioReliabilityStatusSnapshot(): StudioReliabilityStatusSnapshot {
  return snapshot;
}

function signalsEqual(
  a: StudioReliabilitySignal | null,
  b: StudioReliabilitySignal | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.channel === b.channel
    && a.level === b.level
    && a.title === b.title
    && a.detail === b.detail
    && a.at === b.at;
}

/**
 * 실패/강등/회복 보고. 같은 내용의 반복 보고는 스냅샷 참조를 바꾸지 않는다(렌더 0).
 */
export function reportStudioReliabilitySignal(signal: StudioReliabilitySignal): void {
  const frozen = Object.freeze({ ...signal });
  if (signalsEqual(state[signal.channel], frozen)) return;
  state[signal.channel] = frozen;
  publish();
}

/** 채널 정상화 — 표시할 것이 없어졌으므로 신호를 내린다. */
export function clearStudioReliabilityChannel(channel: StudioReliabilityChannel): void {
  if (state[channel] === null) return;
  state[channel] = null;
  publish();
}

function withSafeMode(next: StudioSafeModeState): void {
  state.safeMode = Object.freeze(next);
  publish();
}

/**
 * Safe Mode 진입. 이미 활성이면 사유를 누적한다(중복 사유는 무시).
 * 수동 해제 이후의 **새 사유**는 다시 진입시킨다 — 숨은 실패 금지.
 */
export function enterStudioSafeMode(reason: StudioSafeModeReason, at: number): void {
  const current = state.safeMode;
  if (current.active && current.reasons.includes(reason)) return;
  const reasons = current.active
    ? Object.freeze([...current.reasons, reason])
    : Object.freeze([reason]);
  withSafeMode({
    active: true,
    reasons,
    enteredAt: current.active ? current.enteredAt : at,
    quality: composeStudioSafeModeQuality(reasons),
    manuallyDismissed: false,
  });
}

/**
 * 사유 하나가 해소됐을 때. 남은 사유가 없으면 Safe Mode 를 빠져나온다.
 * 해소되지 않은 사유가 남아 있으면 품질만 재합성한다.
 */
export function resolveStudioSafeModeReason(reason: StudioSafeModeReason): void {
  const current = state.safeMode;
  if (!current.active || !current.reasons.includes(reason)) return;
  const reasons = Object.freeze(current.reasons.filter((entry) => entry !== reason));
  if (reasons.length === 0) {
    withSafeMode(IDLE_SAFE_MODE);
    return;
  }
  withSafeMode({
    active: true,
    reasons,
    enteredAt: current.enteredAt,
    quality: composeStudioSafeModeQuality(reasons),
    manuallyDismissed: current.manuallyDismissed,
  });
}

/**
 * 사용자의 수동 해제. 원인이 사라졌다고 주장하지 않는다 — 품질을 전체 복귀시키되
 * `manuallyDismissed` 로 기록하고, 이후 새 실패가 오면 다시 진입한다.
 */
export function exitStudioSafeModeManually(): void {
  if (!state.safeMode.active) return;
  withSafeMode({
    active: false,
    reasons: Object.freeze([]) as readonly StudioSafeModeReason[],
    enteredAt: null,
    quality: STUDIO_SAFE_MODE_FULL_QUALITY,
    manuallyDismissed: true,
  });
}

/** 현재 Safe Mode 품질(비활성이면 전체 품질) — 렌더 경로의 조회 지점. */
export function studioSafeModeQuality(): StudioSafeModeQuality {
  return state.safeMode.quality;
}

export function isStudioSafeModeActive(): boolean {
  return state.safeMode.active;
}

/** 테스트 격리용 전체 초기화. 제품 경로에서는 호출하지 않는다. */
export function resetStudioReliabilityStatus(): void {
  state.gpu = null;
  state.save = null;
  state.storage = null;
  state.safeMode = IDLE_SAFE_MODE;
  snapshot = IDLE_SNAPSHOT;
  listeners.clear();
}
