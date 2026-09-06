// 블링크 안정화 — blendshape 기반 히스테리시스 + 윙크/머리회전 보정.
//
// MediaPipe eyeBlink 점수는 임계 부근(0.35~0.5)에서 채터링이 심하고,
// 머리를 크게 돌리면 카메라에서 먼 눈의 점수가 붕괴돼 "반쯤 감은 눈"이 생긴다.
// 여기서(Kalidokit stabilizeBlink 수식을 자체 구현):
//  1) 좌우 차가 작으면 양안을 동조(플러터 제거), 크면 윙크로 인정해 독립 유지.
//  2) yaw 가 크면 먼 눈을 가까운 눈에 lerp 동기화.
//  3) 눈별 히스테리시스 상태기계(연속 프레임 게이트)로 채터링을 차단.
//
// 입력은 One-Euro 통과 후 "카메라 좌표계"(미러 전) 0..1 값. 미러 좌우 스왑은
// convertChannelsToVrmData 한 곳에서만 수행한다(이중 반전 금지).
// DOM/MediaPipe 의존 없는 순수 모듈 — CI에서 결정적으로 단위 테스트.

/** 닫힘 판정 임계(이상). */
export const BLINK_CLOSE_THRESHOLD = 0.5;
/** 열림 복귀 임계(미만) — 히스테리시스 하단. */
export const BLINK_OPEN_THRESHOLD = 0.35;
/** 상태 전환 최소 연속 프레임(~66ms@30fps). */
export const BLINK_MIN_FRAMES = 2;
/** 좌우차가 이 이상일 때만 윙크로 인정(미만이면 양안 동조). */
export const WINK_DIFF_THRESHOLD = 0.8;
/** rad — 초과 시 카메라에서 먼 눈을 가까운 눈에 동기화. */
export const EYE_SYNC_MAX_YAW = 0.5;
/** 가까운 눈 가중치(먼 눈은 1-이 값으로 lerp). */
export const EYE_SYNC_NEAR_WEIGHT = 0.95;

export interface StabilizedBlink {
  left: number;
  right: number;
}

type EyeState = "open" | "closed";

interface EyeMachine {
  state: EyeState;
  /** 반대 상태 조건이 연속 관측된 프레임 수. */
  pendingFrames: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 눈별 히스테리시스 상태기계 한 스텝.
 *  - raw >= CLOSE 가 MIN_FRAMES 연속 → closed
 *  - raw < OPEN 이 MIN_FRAMES 연속 → open
 *  - 경계(OPEN~CLOSE) 사이에서는 상태 유지(pending 리셋)
 */
function stepEye(machine: EyeMachine, raw: number): void {
  if (machine.state === "open") {
    if (raw >= BLINK_CLOSE_THRESHOLD) {
      machine.pendingFrames += 1;
      if (machine.pendingFrames >= BLINK_MIN_FRAMES) {
        machine.state = "closed";
        machine.pendingFrames = 0;
      }
    } else {
      machine.pendingFrames = 0;
    }
  } else if (raw < BLINK_OPEN_THRESHOLD) {
    machine.pendingFrames += 1;
    if (machine.pendingFrames >= BLINK_MIN_FRAMES) {
      machine.state = "open";
      machine.pendingFrames = 0;
    }
  } else {
    machine.pendingFrames = 0;
  }
}

/** 상태별 출력 리맵: open → [0, 0.5) 램프, closed → 1.0. */
function eyeOutput(machine: EyeMachine, raw: number): number {
  if (machine.state === "closed") return 1;
  return clamp01(raw / BLINK_OPEN_THRESHOLD) * 0.5;
}

/**
 * 블링크 안정화기 — 프레임 간 상태를 보관한다(useRef 에 두고 세션 시작 시 reset).
 * 출력은 연속값(램프)이라 VRM 표정 가중치로 바로 사용 가능하다.
 */
export class BlinkStabilizer {
  private readonly leftEye: EyeMachine = { state: "open", pendingFrames: 0 };
  private readonly rightEye: EyeMachine = { state: "open", pendingFrames: 0 };

  /**
   * @param blinkL/blinkR One-Euro 통과 후 0..1 (카메라 좌표계, 미러 전)
   * @param headYawRad 카메라 좌표계 head yaw (rad)
   */
  process(blinkL: number, blinkR: number, headYawRad: number): StabilizedBlink {
    let l = clamp01(blinkL);
    let r = clamp01(blinkR);

    // 1) 좌우차가 작으면 양안을 max 로 동조(플러터 제거). 크면 윙크 — 독립 유지.
    if (Math.abs(l - r) < WINK_DIFF_THRESHOLD) {
      const synced = Math.max(l, r);
      l = synced;
      r = synced;
    }

    // 2) 머리를 크게 돌리면 먼 눈 점수가 붕괴 — 가까운 눈에 lerp 동기화.
    //    yaw > 0 (카메라 기준 오른쪽 봄) → 먼 눈 = 왼눈.
    if (Math.abs(headYawRad) > EYE_SYNC_MAX_YAW) {
      const farWeight = 1 - EYE_SYNC_NEAR_WEIGHT;
      if (headYawRad > 0) {
        l = r * EYE_SYNC_NEAR_WEIGHT + l * farWeight;
      } else {
        r = l * EYE_SYNC_NEAR_WEIGHT + r * farWeight;
      }
    }

    // 3) 눈별 히스테리시스 상태기계.
    stepEye(this.leftEye, l);
    stepEye(this.rightEye, r);

    return {
      left: eyeOutput(this.leftEye, l),
      right: eyeOutput(this.rightEye, r),
    };
  }

  reset(): void {
    this.leftEye.state = "open";
    this.leftEye.pendingFrames = 0;
    this.rightEye.state = "open";
    this.rightEye.pendingFrames = 0;
  }
}
