// 적응형 트래킹 품질 컨트롤러 — 추론 시간 슬라이딩 윈도우 중앙값으로
// 티어를 강등(즉시)/승격(히스테리시스)한다.
//
// 티어별 스케줄:
//  - full:    face + pose + hands 매 프레임
//  - reduced: face·pose 매 프레임, hands 격프레임(2프레임당 1회)
//  - minimal: face 매 프레임(One-Euro 필터가 보간 겸함), pose 격프레임, hands 끔
//
// 초기 티어 판정(hardwareConcurrency/deviceMemory)은 호출부(StudioVrmPoser)에서
// 주입한다 — 이 모듈은 DOM/navigator 의존 없는 순수 모듈로 유지해 CI에서
// 결정적으로 단위 테스트한다(nowMs 도 전부 파라미터 주입).

export type QualityTier = "full" | "reduced" | "minimal";

/** 슬라이딩 윈도우 크기(최근 프레임 수). */
export const QUALITY_WINDOW = 30;
/** 윈도우 중앙값이 이 값(ms)을 넘으면(≒30fps 미달) 즉시 1단계 강등. */
export const DEGRADE_MS = 34;
/** 승격 조건 — 윈도우 중앙값이 이 값(ms) 미만. */
export const PROMOTE_MS = 20;
/** 승격 유지 시간(ms) — 여유가 이만큼 연속돼야 1단계 승격(플리커 방지). */
export const PROMOTE_HOLD_MS = 4000;

const TIER_ORDER: readonly QualityTier[] = ["full", "reduced", "minimal"];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export class AdaptiveQualityController {
  private readonly initialTier: QualityTier;
  private currentTier: QualityTier;
  private window: number[] = [];
  /** 승격 조건(중앙값 < PROMOTE_MS)이 시작된 시각. 조건 이탈 시 null. */
  private promoteSince: number | null = null;

  constructor(initialTier: QualityTier = "full") {
    this.initialTier = initialTier;
    this.currentTier = initialTier;
  }

  get tier(): QualityTier {
    return this.currentTier;
  }

  /**
   * 매 추론 프레임 종료 시 호출.
   * @param inferenceMs 이번 프레임 추론 소요(ms)
   * @param nowMs performance.now() 주입(테스트 결정성)
   */
  recordFrame(inferenceMs: number, nowMs: number): void {
    this.window.push(inferenceMs);
    if (this.window.length > QUALITY_WINDOW) this.window.shift();
    if (this.window.length < QUALITY_WINDOW) return; // 판정은 윈도우가 찼을 때만.

    const med = median(this.window);

    // 강등: 중앙값 기준 즉시 1단계. 윈도우를 비워 새 티어에서 새 증거를 모은다.
    if (med > DEGRADE_MS) {
      const idx = TIER_ORDER.indexOf(this.currentTier);
      if (idx < TIER_ORDER.length - 1) {
        this.currentTier = TIER_ORDER[idx + 1];
        this.window = [];
      }
      this.promoteSince = null;
      return;
    }

    // 승격: PROMOTE_MS 미만이 PROMOTE_HOLD_MS 연속일 때 1단계씩.
    if (med < PROMOTE_MS) {
      this.promoteSince ??= nowMs;
      if (nowMs - this.promoteSince >= PROMOTE_HOLD_MS) {
        const idx = TIER_ORDER.indexOf(this.currentTier);
        if (idx > 0) {
          this.currentTier = TIER_ORDER[idx - 1];
          this.window = [];
        }
        this.promoteSince = null; // 다음 승격은 다시 4초 유지 필요.
      }
    } else {
      this.promoteSince = null;
    }
  }

  /** frameIndex 기반 pose 추론 스킵 스케줄. */
  shouldRunPose(frameIndex: number): boolean {
    if (this.currentTier === "minimal") return frameIndex % 2 === 0;
    return true;
  }

  /** frameIndex 기반 hands 추론 스킵 스케줄. */
  shouldRunHands(frameIndex: number, fingerTrackingEnabled: boolean): boolean {
    if (!fingerTrackingEnabled) return false;
    if (this.currentTier === "full") return true;
    if (this.currentTier === "reduced") return frameIndex % 2 === 0;
    return false; // minimal — hands 끔.
  }

  reset(): void {
    this.currentTier = this.initialTier;
    this.window = [];
    this.promoteSince = null;
  }
}
