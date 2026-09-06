// 얼굴 채널 One-Euro 필터 — 스칼라 1D 필터 + TrackingChannels 전용 필터 뱅크.
//
// 기존 고정 α EMA(smoothRawChannels)는 프레임레이트 종속이고 지터/랙 트레이드오프가
// 고정돼 있었다. One-Euro(Casiez 2012)는 신호 속도에 따라 컷오프를 적응시켜
// "정지 시 지터 제거 + 빠른 동작 시 랙 최소화"를 동시에 얻는다.
//
// 설계 원칙:
//  - DOM/MediaPipe 의존 없음(순수 모듈) — 웹캠 없는 CI에서 결정적으로 단위 테스트.
//  - 타임스탬프는 반드시 "초 단위 실제 시간"(performance.now()/1000).
//    프레임 인덱스를 넣으면 가변 fps에서 컷오프가 왜곡된다.
//  - 채널 그룹(head/shape/gaze)별 프리셋 — MediaPipe 내부값(beta=80)은 좌표 스케일이
//    달라 복사 금지. 아래 값은 rad·0..1 스케일 기준 시작값.

import type { TrackingChannels } from "./studio-vrm-webcam-tracking";

export interface OneEuroOptions {
  /** 최소 컷오프(Hz) — 낮을수록 정지 시 부드러움(지터↓ 랙↑). */
  minCutoff: number;
  /** 속도 계수 — 높을수록 고속 동작에서 랙↓. */
  beta: number;
  /** 파생 신호(속도) 컷오프(Hz). 기본 1.0. */
  dCutoff: number;
}

/** EMA 보간 계수: alpha = 1 / (1 + tau/dt), tau = 1/(2π·cutoff). */
function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Casiez One-Euro 1D 필터.
 * 첫 호출은 입력 스냅, dt <= 0(같은/역행 타임스탬프)이면 이전 출력을 그대로 반환한다.
 */
export class OneEuroFilter1D {
  private minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private prevT: number | null = null;
  private prevValue = 0;
  private prevDx = 0;

  constructor(opts: OneEuroOptions) {
    this.minCutoff = opts.minCutoff;
    this.beta = opts.beta;
    this.dCutoff = opts.dCutoff;
  }

  /** 런타임 컷오프 조정(사용자 smoothing 슬라이더 연동용). 상태는 유지된다. */
  setMinCutoff(minCutoff: number): void {
    this.minCutoff = Math.max(minCutoff, 1e-3);
  }

  /** @param tSec 초 단위 실제 시간(performance.now()/1000). 단조 증가여야 한다. */
  filter(value: number, tSec: number): number {
    if (this.prevT === null) {
      // 첫 호출 — 입력 스냅.
      this.prevT = tSec;
      this.prevValue = value;
      this.prevDx = 0;
      return value;
    }

    const dt = tSec - this.prevT;
    if (dt <= 0) return this.prevValue; // 단조성 방어 — 이전 출력 유지.

    // 속도(파생 신호)를 dCutoff 로 필터링한 뒤, 컷오프를 속도에 비례해 상승시킨다.
    const dx = (value - this.prevValue) / dt;
    const alphaD = smoothingAlpha(this.dCutoff, dt);
    const dxSmoothed = this.prevDx + (dx - this.prevDx) * alphaD;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmoothed);
    const alpha = smoothingAlpha(cutoff, dt);
    const next = this.prevValue + (value - this.prevValue) * alpha;

    this.prevT = tSec;
    this.prevValue = next;
    this.prevDx = dxSmoothed;
    return next;
  }

  reset(): void {
    this.prevT = null;
    this.prevValue = 0;
    this.prevDx = 0;
  }
}

/** 채널 그룹별 One-Euro 프리셋 — smoothing 슬라이더 기본값(0.35)에서의 원값. */
export const CHANNEL_FILTER_PRESETS = {
  /** 라디안 — headPitch/Yaw/Roll. */
  head: { minCutoff: 1.5, beta: 0.3, dCutoff: 1.0 },
  /** 0..1 blendshape — blink/mouth/brow/emotion 채널. */
  shape: { minCutoff: 1.2, beta: 0.05, dCutoff: 1.0 },
  /** -1..1 iris — 지터가 최악이라 가장 강하게 억제. */
  gaze: { minCutoff: 0.8, beta: 0.01, dCutoff: 1.0 },
} as const satisfies Record<string, OneEuroOptions>;

/** 기존 EMA 기본값(0.35)과의 하위호환 앵커 — 이 값에서 프리셋 원값으로 동작한다. */
export const SMOOTHING_BASELINE = 0.35;

type ChannelGroup = keyof typeof CHANNEL_FILTER_PRESETS;

const CHANNEL_GROUPS: Record<keyof TrackingChannels, ChannelGroup> = {
  headPitch: "head",
  headYaw: "head",
  headRoll: "head",
  blinkLeft: "shape",
  blinkRight: "shape",
  gazeX: "gaze",
  gazeY: "gaze",
  mouthOpen: "shape",
  mouthSmile: "shape",
  browInnerUp: "shape",
  browOuterUpLeft: "shape",
  browOuterUpRight: "shape",
  browDown: "shape",
  mouthFrown: "shape",
  eyeWide: "shape",
};

const CHANNEL_KEYS = Object.keys(CHANNEL_GROUPS) as (keyof TrackingChannels)[];

/**
 * TrackingChannels 15채널 각각에 독립 One-Euro 필터 인스턴스를 유지하는 뱅크.
 * 사용자 smoothing 슬라이더(0.05~1)는 minCutoff 스케일러로 반영된다:
 *   effectiveMinCutoff = preset.minCutoff * (smoothing / SMOOTHING_BASELINE)
 */
export class TrackingChannelFilterBank {
  private readonly filters = new Map<keyof TrackingChannels, OneEuroFilter1D>();

  filter(channels: TrackingChannels, tSec: number, smoothing: number): TrackingChannels {
    const scale = Math.max(smoothing, 0.01) / SMOOTHING_BASELINE;
    const out = {} as TrackingChannels;
    for (const key of CHANNEL_KEYS) {
      const preset = CHANNEL_FILTER_PRESETS[CHANNEL_GROUPS[key]];
      let f = this.filters.get(key);
      if (!f) {
        f = new OneEuroFilter1D(preset);
        this.filters.set(key, f);
      }
      f.setMinCutoff(preset.minCutoff * scale);
      out[key] = f.filter(channels[key], tSec);
    }
    return out;
  }

  reset(): void {
    for (const f of this.filters.values()) f.reset();
  }
}
