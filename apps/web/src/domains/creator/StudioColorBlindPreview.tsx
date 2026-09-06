import {
  STUDIO_CVD_GRAYSCALE_SATURATION,
  STUDIO_CVD_MATRIX,
  studioColorVisionFilterStyle,
  type CvdMode,
} from "./studio-color-vision-model";

import type { CSSProperties } from "react";

// 색맹 시뮬레이션 미리보기 — 캔버스(Stage)에 CSS filter(SVG feColorMatrix)로 적록/청황 색각이상을
// 실시간 근사 시뮬레이션한다. 서버·비동기 처리 없는 순수 뷰 필터라 el 데이터를 건드리지 않는다.
//
// 행렬 출처: Colorblindly(oftheheadland/Colorblindly) filters/{protanopia,deuteranopia,tritanopia}.js —
// Viénot, Brettel & Mollon 1999 단일행렬 dichromat 근사(DaltonLens 재확인). colorjack.com 계열의
// "sRGB-direct" 행렬은 원작자가 부정확하다고 공개 철회한 것이라 의도적으로 배제했다.
//
// 반드시 linearRGB 색공간에서 곱해야 정확하다(감마 보정 없이 sRGB에 바로 곱하면 색이 심하게 왜곡된다) —
// 그래서 각 <filter>에 color-interpolation-filters="linearRGB" 를 명시한다(브라우저가 sRGB↔linear 변환을
// 자동으로 앞뒤에 끼워준다). 이 속성을 빠뜨리는 게 가장 흔한 구현 실수다.
//
// 청색맹(tritanopia)은 이 빠른 단일 행렬 경로에 구조적 한계가 있다. Brettel 1997의 2-행렬+픽셀별
// 부호 판정 SVG 파이프라인으로 더 정밀하게 확장할 수 있으므로, 현재 단계에서는 셋 중 신뢰도가 가장 낮음을
// 리치 힌트에 "근사치"로 명시한다.
//
// "grayscale"은 색각이상 시뮬레이션이 아니라 명암/값(value)만 확인하려는 일반 그리기 워크플로용이다 —
// 원본 요소는 전혀 건드리지 않고 같은 Stage CSS filter 합성 자리에 끼워 넣는 것만으로 충분해 이 모듈의
// 기존 "비파괴 뷰 시뮬레이션" 인프라(상태 하나, 토글 버튼 그룹, style.filter 합성)를 그대로 재사용한다.
// 지금까지는 그레이스케일이 Look 프리셋(요소에 커밋되는 방식)으로만 존재했다.
export type { CvdMode } from "./studio-color-vision-model";

// 숨김 SVG defs — filter id 는 문서 전역 네임스페이스라 어디에 마운트하든 위치는 상관없다(clipPath/gradient와
// 동일한 참조 방식). width/height=0 + position:absolute 로 화면에는 아무 흔적도 남기지 않는다. 비용이 거의
// 없으므로(정적 SVG 4개) 조건 없이 항상 마운트해도 안전하다.
export function StudioColorBlindFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <filter id="cvd-grayscale" colorInterpolationFilters="linearRGB">
          <feColorMatrix type="saturate" values={STUDIO_CVD_GRAYSCALE_SATURATION} />
        </filter>
        <filter id="cvd-protanopia" colorInterpolationFilters="linearRGB">
          <feColorMatrix type="matrix" values={STUDIO_CVD_MATRIX.protanopia} />
        </filter>
        <filter id="cvd-deuteranopia" colorInterpolationFilters="linearRGB">
          <feColorMatrix type="matrix" values={STUDIO_CVD_MATRIX.deuteranopia} />
        </filter>
        <filter id="cvd-tritanopia" colorInterpolationFilters="linearRGB">
          <feColorMatrix type="matrix" values={STUDIO_CVD_MATRIX.tritanopia} />
        </filter>
      </defs>
    </svg>
  );
}

// 순수 헬퍼 — "none" 이면 빈 객체, 아니면 url() filter 하나짜리 스타일 객체를 돌려준다.
// 호출부가 기존 filter(예: 페이지 색보정 pageGradeCss)와 문자열로 합성해 같은 style.filter 키에 쓴다.
// 컴포넌트와 강결합된 순수 헬퍼라 한 파일에 둔다(이 파일 편집 시 fast-refresh 대신 풀 리로드 — 의도적).
// eslint-disable-next-line react-refresh/only-export-components
export function colorBlindFilterStyle(mode: CvdMode): CSSProperties {
  return studioColorVisionFilterStyle(mode);
}
