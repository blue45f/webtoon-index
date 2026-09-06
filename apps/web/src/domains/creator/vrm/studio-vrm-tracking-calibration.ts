// 중립 포즈 캘리브레이션 — 사용자가 정면·무표정일 때 채널 오프셋을 샘플링해
// 이후 프레임에서 제거한다.
//
// 효과:
//  - 머리 각 오프셋 감산은 "얼굴이 화면 중앙에 없을 때 변환행렬에 생기는
//    원근 yaw/pitch 편향"(MediaPipe #4759)을 사용자 위치 기준으로 상쇄한다.
//  - blink/mouthOpen 은 개인별 눈 크기·무표정 잔여치를 기준으로 리스케일해
//    "항상 반쯤 감긴 눈" 같은 개인차를 보정한다.
//
// DOM/MediaPipe 의존 없는 순수 모듈 — CI에서 결정적으로 단위 테스트.

import type { TrackingChannels } from "./studio-vrm-webcam-tracking";

export interface TrackingCalibration {
  /** 중립 머리 각(rad) — 프레임 값에서 감산. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 중립 시선 — 감산 후 [-1,1] 클램프. */
  gazeX: number;
  gazeY: number;
  /** "눈 뜬 상태"의 blink 잔여치 — 리스케일 기준. */
  blinkOpenL: number;
  blinkOpenR: number;
  /** 무표정 jawOpen 잔여치 — 리스케일 기준. */
  mouthOpenBase: number;
}

/** 샘플링 프레임 수(~0.7s@30fps). */
export const CALIBRATION_SAMPLE_FRAMES = 20;

const CALIBRATION_VERSION = 1;

const CALIBRATION_FIELDS = [
  "headPitch",
  "headYaw",
  "headRoll",
  "gazeX",
  "gazeY",
  "blinkOpenL",
  "blinkOpenR",
  "mouthOpenBase",
] as const satisfies readonly (keyof TrackingCalibration)[];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** 프레임을 모아 평균으로 캘리브레이션을 만든다. */
export class CalibrationSampler {
  private readonly frames: number;
  private count = 0;
  private readonly sums: Record<keyof TrackingCalibration, number> = {
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    gazeX: 0,
    gazeY: 0,
    blinkOpenL: 0,
    blinkOpenR: 0,
    mouthOpenBase: 0,
  };

  constructor(frames: number = CALIBRATION_SAMPLE_FRAMES) {
    this.frames = Math.max(1, Math.floor(frames));
  }

  /** 캘리브레이션 "이전"(raw) 채널을 공급해야 한다. done 이후 호출은 무시. */
  add(channels: TrackingChannels): void {
    if (this.done) return;
    this.count += 1;
    this.sums.headPitch += channels.headPitch;
    this.sums.headYaw += channels.headYaw;
    this.sums.headRoll += channels.headRoll;
    this.sums.gazeX += channels.gazeX;
    this.sums.gazeY += channels.gazeY;
    this.sums.blinkOpenL += channels.blinkLeft;
    this.sums.blinkOpenR += channels.blinkRight;
    this.sums.mouthOpenBase += channels.mouthOpen;
  }

  /** 0..1 — UI 진행 표시용. */
  get progress(): number {
    return Math.min(1, this.count / this.frames);
  }

  get done(): boolean {
    return this.count >= this.frames;
  }

  /** 샘플 부족 시 null. */
  build(): TrackingCalibration | null {
    if (!this.done) return null;
    const avg = (sum: number) => sum / this.count;
    return {
      headPitch: avg(this.sums.headPitch),
      headYaw: avg(this.sums.headYaw),
      headRoll: avg(this.sums.headRoll),
      gazeX: avg(this.sums.gazeX),
      gazeY: avg(this.sums.gazeY),
      blinkOpenL: avg(this.sums.blinkOpenL),
      blinkOpenR: avg(this.sums.blinkOpenR),
      mouthOpenBase: avg(this.sums.mouthOpenBase),
    };
  }
}

/** 개인 기준치 대비 리스케일: clamp01((raw - base) / max(1 - base, 0.2)). */
function remapFromBase(raw: number, base: number): number {
  return clamp01((raw - base) / Math.max(1 - base, 0.2));
}

/**
 * 캘리브레이션 적용 — head/gaze 는 감산(gaze 는 [-1,1] 클램프),
 * blink/mouthOpen 은 개인 기준치 리스케일, 나머지 채널은 통과.
 * cal 이 null 이면 입력을 그대로 반환한다.
 */
export function applyCalibration(
  channels: TrackingChannels,
  cal: TrackingCalibration | null,
): TrackingChannels {
  if (!cal) return channels;
  return {
    ...channels,
    headPitch: channels.headPitch - cal.headPitch,
    headYaw: channels.headYaw - cal.headYaw,
    headRoll: channels.headRoll - cal.headRoll,
    gazeX: clampSigned(channels.gazeX - cal.gazeX),
    gazeY: clampSigned(channels.gazeY - cal.gazeY),
    blinkLeft: remapFromBase(channels.blinkLeft, cal.blinkOpenL),
    blinkRight: remapFromBase(channels.blinkRight, cal.blinkOpenR),
    mouthOpen: remapFromBase(channels.mouthOpen, cal.mouthOpenBase),
  };
}

/** SQLite/파일 경계용 정규 직렬화(버전 필드 포함). */
export function serializeCalibration(cal: TrackingCalibration): string {
  return JSON.stringify({ v: CALIBRATION_VERSION, ...cal });
}

/** 역직렬화 — 버전 불일치/손상 JSON/필드 누락 시 null. */
export function deserializeCalibration(raw: string | null): TrackingCalibration | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== CALIBRATION_VERSION) return null;
    const cal = {} as TrackingCalibration;
    for (const field of CALIBRATION_FIELDS) {
      const value = record[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      cal[field] = value;
    }
    return cal;
  } catch {
    return null;
  }
}
