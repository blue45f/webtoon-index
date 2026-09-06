import { useFx, type SfxName } from "@toonspectrum/core/fx";

import { reducedMotion } from "@/src/hooks/use-in-view";

export type CelebrateHaptic = "tickWeak" | "confetti" | "success" | "error";

const HAPTIC_PATTERN: Record<CelebrateHaptic, number | number[]> = {
  tickWeak: 10,
  confetti: [12, 24, 18],
  success: [16, 28, 16],
  error: [32, 24, 32],
};

function vibrate(type: CelebrateHaptic): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(HAPTIC_PATTERN[type]);
}

// 성공 순간(글 등록·리뷰 저장·서재 담기) 축하 피드백 옵션 — 미지정 시 "큰 축하" 기본값.
export interface CelebrateOptions {
  /** 파티클 이모지 셋(미지정 시 브랜드 기본 셋). */
  chars?: readonly string[];
  /** 파티클 수(기본 18). */
  count?: number;
  /** 퍼짐 반경 배수(기본 1.05). */
  spread?: number;
  /** 효과음(기본 'success'). */
  sfx?: SfxName;
  /** 햅틱 종류(기본 'confetti'). 지원 브라우저에서만 진동하고, 그 외에는 조용히 생략합니다. */
  haptic?: CelebrateHaptic;
}

/**
 * 성공 순간의 축하 피드백(파티클 버스트 + SFX + 햅틱)을 한 번에 발화하는 훅.
 *
 * 전역 클릭 이펙트는 제거됨. celebrate 는 명시적 호출(구독/북마크 등)에만 쓴다:
 * prefers-reduced-motion 사용자는 시각 모션(파티클)만 생략하고, 사용자가 명시적으로
 * opt-in 한 오디오 피드백과 햅틱(비시각 촉각)은 유지한다.
 */
export function useCelebrate(): (
  el: Element | null | undefined,
  options?: CelebrateOptions,
) => void {
  const fx = useFx();
  return (el, options) => {
    const { chars, count = 18, spread = 1.05, sfx = "success", haptic = "confetti" } = options ?? {};
    fx.sfx(sfx);
    vibrate(haptic);
    if (reducedMotion()) return; // 모션 최소화 — 파티클만 생략(오디오·햅틱 유지)
    fx.burstAt(el, { count, spread, ...(chars ? { chars } : {}) });
  };
}
