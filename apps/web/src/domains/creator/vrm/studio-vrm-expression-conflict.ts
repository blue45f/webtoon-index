/**
 * VRM 표정 **충돌 해소** — 동시에 켜진 표정들이 같은 모프를 서로 반대로 끌어당기지 않게 한다.
 *
 * 왜 필요한가. 블렌드셰이프 채널에서 감정을 유도하면 한 프레임에 여러 감정이 동시에 켜진다.
 * 웃으면서 입을 벌리고 눈썹을 올린 평범한 한 프레임이 실제로
 * `happy 0.80 · surprised 0.69 · sad 0.42 · angry 0.38 · aa 0.70` 을 낸다. VRM 프리셋 표정은
 * 서로 겹치는 모프를 건드리므로(입꼬리·눈꺼풀·눈썹), 이걸 그대로 적용하면 표정이 상쇄되거나
 * 정점이 과하게 밀려 얼굴이 무너진다. 특히 입 계열 합계가 1을 크게 넘으면 눈에 띄게 망가진다.
 *
 * 설계
 *  - **순수 함수**다. 프레임 카운터나 모듈 전역 상태를 두지 않는다. 시간축 안정화는 이미
 *    상류에 있다 — One-Euro 필터(studio-vrm-one-euro)와 블링크 히스테리시스
 *    (studio-vrm-blink-stabilizer)가 채터링을 걸러 낸 값이 여기로 온다. 여기에 상태를 또
 *    두면 아바타가 둘 이상일 때 서로의 상태를 덮어쓴다.
 *  - **끄고 켜는 억제가 아니라 감쇠**다. 임계값을 넘나들 때 표정이 튀지 않는다.
 *  - 그룹 밖 표정(blink·look·brow 계열)은 손대지 않는다. 시선·깜빡임은 감정과 독립이다.
 */

/** 서로 배타적으로 읽혀야 하는 감정 표정. 선언 순서가 동점 시 우선순위다. */
export const STUDIO_VRM_EXPRESSION_EMOTIONS = Object.freeze([
  "surprised",
  "angry",
  "sad",
  "happy",
  "relaxed",
] as const);

/**
 * 입 모양을 함께 움직여 가중치가 누적되는 표정. 합계에 상한을 건다.
 *
 * 감정 다섯 개가 **전부** 들어 있다. 놀람·분노는 눈·눈썹이 주도하지만 입도 함께 움직이므로
 * (생성 캐릭터의 `surprised` 는 입을 2.4배로 벌리고 `angry` 는 입꼬리를 내린다), 상한에서
 * 빼 두면 `surprised 1 + aa 1` 같은 조합이 입 가중치 2.0 으로 그대로 통과해 이 해소기가
 * 막으려던 가산 변형이 다시 생긴다.
 */
export const STUDIO_VRM_EXPRESSION_MOUTH_GROUP = Object.freeze([
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "happy",
  "sad",
  "relaxed",
  "surprised",
  "angry",
] as const);

export type StudioVrmExpressionEmotion = (typeof STUDIO_VRM_EXPRESSION_EMOTIONS)[number];

/**
 * 감정별 우세 판정 가중치. **누가 지배적인지만** 정하고, 감쇠 세기는 지배 표정의 실제
 * 가중치가 정한다. 놀람과 분노를 웃음보다 높게 둔 것은 두 표정이 더 뚜렷한 신호
 * (눈 크게 뜸·눈썹 내림)에서 나와 오검출이 적기 때문이다.
 */
export const STUDIO_VRM_EXPRESSION_PRIORITY: Readonly<Record<StudioVrmExpressionEmotion, number>> =
  Object.freeze({
    surprised: 1.35,
    angry: 1.2,
    sad: 1.1,
    happy: 1,
    relaxed: 0.9,
  });

/** 0 = 억제 없음(원본 유지), 1 = 지배 표정이 최대일 때 나머지를 완전히 끈다. */
export const STUDIO_VRM_EXPRESSION_DEFAULT_EXCLUSIVITY = 0.85;
/** 입 계열 가중치 합의 상한. 1 을 조금 넘겨 표정이 섞일 여지는 남긴다. */
export const STUDIO_VRM_EXPRESSION_DEFAULT_MOUTH_CEILING = 1.25;

export type StudioVrmExpressionConflictOptions = {
  readonly exclusivity?: number;
  readonly mouthCeiling?: number;
  readonly priority?: Readonly<Partial<Record<string, number>>>;
  /**
   * 실제로 적용할 수 있는 표정 이름. 주면 그 밖의 표정은 지배 판정과 입 예산에서 제외한다.
   *
   * VRM 마다 선택 프리셋(surprised/angry/sad …)이 없을 수 있고, 적용 단계는 모델에 없는
   * 이름을 그냥 버린다. 그 이름이 지배 표정으로 뽑히면 **지원되는 표정만 깎이고** 정작
   * 그 표정은 화면에 나타나지 않는다 — 눈을 크게 뜬 미소가 미소만 잃는 식이다.
   */
  readonly available?: Iterable<string>;
};

export type StudioVrmExpressionConflictResult = {
  readonly weights: Readonly<Record<string, number>>;
  /** 이 프레임에서 우세한 감정. 감정이 전부 0 이면 null. */
  readonly dominantEmotion: StudioVrmExpressionEmotion | null;
  /** 감쇠가 실제로 적용된 감정들. */
  readonly attenuated: readonly StudioVrmExpressionEmotion[];
  /** 입 계열에 적용된 축소 배율(상한을 넘지 않았으면 1). */
  readonly mouthScale: number;
};

function clamp01(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampUnit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * 표정 가중치 한 벌의 충돌을 해소한다.
 *
 *  1. 감정 그룹에서 `가중치 × 우선순위` 가 가장 큰 하나를 지배 표정으로 고른다.
 *  2. 나머지 감정을 `1 − exclusivity × 지배가중치` 로 감쇠한다. 지배 표정이 약하면 거의
 *     건드리지 않고, 뚜렷하면 나머지를 확실히 눌러 하나의 표정으로 읽히게 한다.
 *  3. 입 계열 합계가 상한을 넘으면 그 그룹 전체를 같은 배율로 줄인다. 비율을 유지하므로
 *     입 모양의 성격은 그대로 두고 크기만 낮춘다.
 */
export function resolveStudioVrmExpressionConflicts(
  weights: Readonly<Record<string, number>>,
  options: StudioVrmExpressionConflictOptions = {},
): StudioVrmExpressionConflictResult {
  const exclusivity = clampUnit(options.exclusivity, STUDIO_VRM_EXPRESSION_DEFAULT_EXCLUSIVITY);
  // Infinity 는 "상한 없음"이라는 유효한 요청이다 — isFinite 로 거르면 조용히 기본값이 돼
  // 호출부가 끈 줄 알았던 축소가 그대로 걸린다. NaN 과 비숫자만 되돌린다.
  const mouthCeiling =
    typeof options.mouthCeiling === "number" && !Number.isNaN(options.mouthCeiling)
      ? Math.max(0, options.mouthCeiling)
      : STUDIO_VRM_EXPRESSION_DEFAULT_MOUTH_CEILING;

  const resolved: Record<string, number> = {};
  for (const [name, value] of Object.entries(weights)) resolved[name] = clamp01(value);

  const available = options.available === undefined ? null : new Set(options.available);
  const applicable = (name: string): boolean => available === null || available.has(name);

  // 1. 지배 감정 — 동점이면 선언 순서(= 신뢰도 순)가 이긴다.
  let dominant: StudioVrmExpressionEmotion | null = null;
  let dominantScore = 0;
  for (const emotion of STUDIO_VRM_EXPRESSION_EMOTIONS) {
    const weight = resolved[emotion] ?? 0;
    if (weight <= 0 || !applicable(emotion)) continue;
    const priority = options.priority?.[emotion] ?? STUDIO_VRM_EXPRESSION_PRIORITY[emotion];
    const score = weight * (Number.isFinite(priority) ? priority : 1);
    if (score > dominantScore) {
      dominantScore = score;
      dominant = emotion;
    }
  }

  // 2. 나머지 감정 감쇠.
  const attenuated: StudioVrmExpressionEmotion[] = [];
  if (dominant !== null && exclusivity > 0) {
    const gain = 1 - exclusivity * (resolved[dominant] ?? 0);
    for (const emotion of STUDIO_VRM_EXPRESSION_EMOTIONS) {
      if (emotion === dominant || !applicable(emotion)) continue;
      const weight = resolved[emotion] ?? 0;
      if (weight <= 0) continue;
      resolved[emotion] = weight * gain;
      attenuated.push(emotion);
    }
  }

  // 3. 입 계열 누적 상한 — 적용되지 않을 표정은 예산에서도 빼고 줄이지도 않는다.
  let mouthTotal = 0;
  for (const name of STUDIO_VRM_EXPRESSION_MOUTH_GROUP) {
    if (applicable(name)) mouthTotal += resolved[name] ?? 0;
  }
  let mouthScale = 1;
  if (mouthTotal > mouthCeiling && mouthTotal > 0) {
    mouthScale = mouthCeiling / mouthTotal;
    for (const name of STUDIO_VRM_EXPRESSION_MOUTH_GROUP) {
      if (resolved[name] === undefined || !applicable(name)) continue;
      resolved[name] *= mouthScale;
    }
  }

  return { weights: resolved, dominantEmotion: dominant, attenuated, mouthScale };
}
