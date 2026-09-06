/**
 * Safe Mode 런타임 — dead code 였던 복구 3종을 제품 경로에 배선하는 접합점.
 *
 * 배선 대상(ux-audit-v5 §2.10 "복구 기계장치 3종이 전부 배선되지 않은 dead code"):
 *  - `studio-device-loss-recovery.ts` 의 `createDeviceLossRecovery` 상태기계
 *    (healthy → lost → retrying → recovered | permanently-demoted)
 *  - `studio-gpu-fabric.ts` 의 loss 팬아웃 `onStudioGpuDeviceLost` 와 주입형
 *    재획득 표면 `acquireStudioGpuDevice`
 *  - 사용자 고지: `studio-reliability-status-store.ts`
 *
 * 접합 방식: 디바이스 로스 상태기계는 `device.lost` 프라미스만 요구한다
 * (`StudioGpuDeviceLike`). fabric 의 loss 팬아웃은 이벤트다. 그래서 이 모듈이
 * **브리지 디바이스**(loss 이벤트에 resolve 되는 `lost` 프라미스만 가진 최소 객체)를
 * 만들어 두 표면을 잇는다. 메인 캔버스 WebGPU 서피스 로스(StudioPage 의
 * `onWebGpuDeviceLost`)도 같은 진입점 `announceStudioGpuDeviceLoss` 로 들어온다 —
 * 감사가 "무음"으로 판정한 바로 그 경로다.
 *
 * 정상 경로 무변경 규율: 이 모듈은 로스가 **실제로 announce 되기 전까지** GPU 디바이스를
 * 획득하지 않는다. 설치만으로 없던 GPUDevice 가 생기지 않는다.
 */

import { acquireStudioGpuDevice, onStudioGpuDeviceLost } from "./render/studio-gpu-fabric";
import {
  createDeviceLossRecovery,
  type StudioDeviceLossClock,
  type StudioDeviceLossRecovery,
  type StudioDeviceLossState,
  type StudioGpuDeviceLike,
} from "./studio-device-loss-recovery";
import {
  clearStudioReliabilityChannel,
  enterStudioSafeMode,
  reportStudioReliabilitySignal,
  resolveStudioSafeModeReason,
} from "./studio-reliability-status-store";

/** loss 이벤트를 `device.lost` 프라미스로 바꾸는 최소 브리지. */
interface StudioGpuLossBridge {
  readonly device: StudioGpuDeviceLike;
  /** 멱등 — 이미 resolve 된 브리지의 재호출은 무시된다. */
  announce(reason: string): void;
}

function createGpuLossBridge(): StudioGpuLossBridge {
  let settle: ((info: { reason: string }) => void) | null = null;
  const lost = new Promise<{ reason: string }>((resolve) => {
    settle = resolve;
  });
  return {
    device: { lost },
    announce(reason) {
      const resolve = settle;
      settle = null;
      resolve?.({ reason });
    },
  };
}

const wallClock: StudioDeviceLossClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface StudioSafeModeRuntimeOptions {
  /** 기본은 벽시계 + setTimeout. 테스트는 결정론적 clock 을 주입한다. */
  readonly clock?: StudioDeviceLossClock;
  /** 기본은 fabric 의 loss 팬아웃 구독. */
  readonly subscribeDeviceLoss?: (
    listener: (event: { readonly reason: string }) => void,
  ) => () => void;
  /**
   * 기본은 fabric 의 `acquireStudioGpuDevice`. 성공하면 새 브리지 디바이스를 만들어
   * 상태기계에 건넨다. null 은 재획득 실패(백오프 계속).
   */
  readonly acquireDevice?: () => Promise<unknown>;
  /** 상태기계 옵션 패스스루(테스트에서 백오프를 좁힌다). */
  readonly backoff?: Parameters<typeof createDeviceLossRecovery>[0]["backoff"];
  readonly permanentDemotionThreshold?: number;
}

export interface StudioSafeModeRuntime {
  /**
   * GPU 로스 보고 — fabric 팬아웃과 메인 캔버스 서피스 로스가 공유하는 유일한 진입점.
   * 상태기계가 아직 어떤 디바이스도 관찰하지 않았다면 이 호출이 관찰을 시작시킨다.
   */
  announceGpuLoss(reason: string): void;
  state(): StudioDeviceLossState;
  /** 진단·테스트용 — 상태기계가 센 로스 횟수. */
  lossCount(): number;
  dispose(): void;
}

let installed: StudioSafeModeRuntime | null = null;

function createRuntime(options: StudioSafeModeRuntimeOptions): StudioSafeModeRuntime {
  const clock = options.clock ?? wallClock;
  const acquireDevice = options.acquireDevice ?? (() => acquireStudioGpuDevice());
  let bridge: StudioGpuLossBridge | null = null;
  let observed = false;
  let disposed = false;

  const recovery: StudioDeviceLossRecovery<never, StudioGpuDeviceLike> =
    createDeviceLossRecovery<never, StudioGpuDeviceLike>({
      clock,
      ...(options.backoff ? { backoff: options.backoff } : {}),
      ...(options.permanentDemotionThreshold !== undefined
        ? { permanentDemotionThreshold: options.permanentDemotionThreshold }
        : {}),
      requestDevice: async () => {
        const acquired = await acquireDevice();
        if (!acquired) return null;
        // 재획득 성공 — 다음 로스를 받을 새 브리지로 교체한다.
        bridge = createGpuLossBridge();
        return bridge.device;
      },
      onDiscardInFlight: (event) => {
        reportStudioReliabilitySignal({
          channel: "gpu",
          level: "degraded",
          title: "GPU 처리 중이던 작업을 버리고 다시 계산합니다",
          detail: `사유: ${event.reason}`,
          at: clock.now(),
        });
      },
      onDemote: (event) => {
        const permanent = event.permanent;
        enterStudioSafeMode(
          permanent ? "gpu-permanently-demoted" : "gpu-device-lost",
          clock.now(),
        );
        reportStudioReliabilitySignal({
          channel: "gpu",
          level: permanent ? "failed" : "degraded",
          title: permanent
            ? "선택한 GPU 렌더러를 이번 세션에서 사용할 수 없습니다"
            : "선택한 GPU 렌더러를 현재 사용할 수 없습니다",
          detail: permanent
            ? `그림과 마지막 정상 프레임은 그대로 보존합니다. 다른 엔진은 직접 선택해야 합니다. (${event.lossCount}회 끊김)`
            : "다른 엔진으로 자동 전환하지 않고 같은 GPU 렌더러의 재연결을 시도하는 중입니다.",
          at: clock.now(),
        });
      },
      onRecover: (event) => {
        resolveStudioSafeModeReason("gpu-device-lost");
        reportStudioReliabilitySignal({
          channel: "gpu",
          level: "ok",
          title: "GPU 가속을 다시 켰습니다",
          detail: `${event.attempts}번째 시도에서 복구되었습니다.`,
          at: clock.now(),
        });
      },
    });

  const ensureObserved = (): void => {
    if (observed) return;
    bridge = createGpuLossBridge();
    recovery.observe(bridge.device);
    observed = true;
  };

  const announceGpuLoss = (reason: string): void => {
    if (disposed) return;
    ensureObserved();
    bridge?.announce(reason);
  };

  const unsubscribe = (options.subscribeDeviceLoss ?? onStudioGpuDeviceLost)(
    (event) => {
      announceGpuLoss(event.reason);
    },
  );

  return {
    announceGpuLoss,
    state: () => recovery.state(),
    lossCount: () => recovery.lossCount(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      recovery.dispose();
      clearStudioReliabilityChannel("gpu");
    },
  };
}

/**
 * 프로세스당 1회 설치. 이미 설치돼 있으면 같은 런타임을 돌려준다(고지 UI 가 여러 번
 * 마운트돼도 상태기계는 하나다).
 */
export function ensureStudioSafeModeRuntime(
  options: StudioSafeModeRuntimeOptions = {},
): StudioSafeModeRuntime {
  installed ??= createRuntime(options);
  return installed;
}

/**
 * GPU 로스 보고 — 설치 전이라도 안전하게 런타임을 세운 뒤 보고한다.
 * StudioPage 의 메인 캔버스 `onWebGpuDeviceLost` 가 이 함수 한 줄로 무음을 깬다.
 */
export function announceStudioGpuDeviceLoss(reason: string): void {
  ensureStudioSafeModeRuntime().announceGpuLoss(reason);
}

/** 테스트 격리용 — 설치된 런타임을 내리고 다음 ensure 가 새로 만들게 한다. */
export function disposeStudioSafeModeRuntime(): void {
  installed?.dispose();
  installed = null;
}
