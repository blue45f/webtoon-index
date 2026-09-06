/**
 * Studio SFX Lettering — 효과음 글리프를 어떤 표면 위에서도 읽히게 만드는 인라인 스타일.
 *
 * SFX 데이터의 `recommendedColor` 는 레터링 데이터지 UI 색이 아니다(토큰으로 치환하면 안 된다).
 * 문제는 그 값이 `#ffffff` 인 항목이 실제로 존재한다는 것 — `퍽`, `슈욱` 은 흰 글자에 각각
 * `#dc2626` / `#0284c7` 외곽선을 두르는 전제로 만들어졌다. 외곽선 없이 `bg-card` 위에 칠하면
 * 라이트 테마에서 글자가 그대로 사라진다.
 *
 * 그래서 색과 외곽선은 항상 함께 간다. 이 헬퍼가 그 쌍을 한 곳에 묶어 둔다.
 * (컴패니언 사본과 `StudioWebtoonAssistantModal` 이 같은 식을 각자 들고 있었다. 모달 쪽은
 *  파일 소유자가 다음 회차에 이 헬퍼로 갈아끼우면 된다.)
 */
import type { CSSProperties } from "react";

/** `SfxLexiconItem` 중 레터링에 필요한 두 필드만. 엔진 타입에 결합하지 않는다. */
export interface StudioSfxLetteringSource {
  readonly recommendedColor: string;
  readonly strokeColor: string;
}

/**
 * 글리프 색 + 1px 외곽선. `text-stroke` 는 사파리/파이어폭스 지원이 갈려서
 * 모달이 이미 쓰고 있는 `textShadow` 4방향 근사를 그대로 유지한다.
 */
export function studioSfxLetteringStyle(item: StudioSfxLetteringSource): CSSProperties {
  return {
    color: item.recommendedColor,
    textShadow: `0 0 1px ${item.strokeColor}, 1px 1px 0 ${item.strokeColor}`,
  };
}
