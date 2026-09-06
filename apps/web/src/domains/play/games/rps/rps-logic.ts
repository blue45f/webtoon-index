// 웹툰 가위바위보 — 손가락 컬 분류부(MediaPipe FingerEulerMap 종속, 웹 전용).
// 라운드 판정·점수·결정적 AI·묵찌빠 전이 등 순수 엔진은 @toonspectrum/play-core 로
// 이동했고, 여기서는 그것을 그대로 재-export 해 기존 import 경로를 유지한다.

import type { FingerEulerMap } from "@/src/domains/creator/vrm/studio-vrm-hand-solver";
import type { Hand } from "@toonspectrum/play-core";

export {
  HAND_EMOJI,
  HAND_LABEL,
  MUK_LABEL,
  EMPTY_SCORE,
  beats,
  resolveRound,
  pickAiHand,
  scoreReducer,
  matchOver,
  mukjjippaStep,
  type Hand,
  type Outcome,
  type Score,
  type Initiative,
  type MukStep,
} from "@toonspectrum/play-core";

// 손가락 3마디 컬 합(rad) 임계 — 펴짐/접힘 판정.
const EXTENDED_MAX = 1.2; // 합 < 이 값이면 편 손가락
const CURLED_MIN = 2.0; // 합 > 이 값이면 접은 손가락
const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;

/** 한 손가락의 컬 합(Z축 회전 크기 합). */
export function fingerCurl(curls: FingerEulerMap, side: "left" | "right", finger: string): number {
  let sum = 0;
  for (const seg of SEGMENTS) {
    const v = curls[`${side}${finger}${seg}`];
    if (v) sum += Math.abs(v[2]);
  }
  return sum;
}

/**
 * 손가락 컬 맵 → 가위/바위/보. 애매하면 null(미인식 → 캡처 잠금 안 함).
 *  - 보(paper)   : 검지·중지·약지·소지 모두 폄
 *  - 바위(rock)  : 네 손가락 모두 접음
 *  - 가위(scissors): 검지·중지 폄 + 약지·소지 접음
 */
export function classifyGesture(curls: FingerEulerMap, side: "left" | "right"): Hand | null {
  const [index, middle, ring, little] = FINGERS.map((f) => fingerCurl(curls, side, f));
  const ext = (v: number) => v < EXTENDED_MAX;
  const curl = (v: number) => v > CURLED_MIN;

  if (ext(index) && ext(middle) && ext(ring) && ext(little)) return "paper";
  if (curl(index) && curl(middle) && curl(ring) && curl(little)) return "rock";
  if (ext(index) && ext(middle) && curl(ring) && curl(little)) return "scissors";
  return null;
}

/**
 * 디바운스 — 최근 N프레임 동안 동일 손이 유지될 때만 그 손을 확정(흔들림 방지).
 * 샘플이 부족하거나 불안정하면 null.
 */
export function stabilizeGesture(samples: (Hand | null)[], minStable = 5): Hand | null {
  if (samples.length < minStable) return null;
  const recent = samples.slice(-minStable);
  const first = recent[0];
  if (!first) return null;
  return recent.every((s) => s === first) ? first : null;
}
