// 창작 스튜디오 캐릭터 에셋 "계약"(contract) — 코미포(ComiPo)식 "캐릭터+표정 골라 끼우기".
// 실제 아트(벡터 캐릭터 라이브러리)는 ./studio-character-library 에서 생성(Codex 담당).
// 이 파일은 타입 + 어댑터만 고정 — 라이브러리 파일이 이 형태를 구조적으로 만족하면 된다.

export interface CharacterExpression {
  id: string; // "happy" | "sad" | ...
  label: string; // "기쁨"
  svg: string; // 독립 실행 가능한 <svg ...>...</svg> 마크업(외부 참조 없음)
  imgSrc?: string; // (선택사항) 웹툰 일러스트 이미지 경로
}

export interface CharacterAsset {
  id: string;
  label: string;
  emoji: string; // 피커 아이콘용
  width: number; // 기본 배치 크기
  height: number;
  expressions: CharacterExpression[];
}

// SVG 문자열 → data URL (Konva Image/내보내기/직렬화에 그대로 사용).
// 크로스 브라우저 호환성(특히 Safari/Firefox/Chrome 최신버전) 및 보안 제약을 해결하기 위해 Base64로 인코딩하여 반환합니다.
export function svgToDataUrl(svg: string): string {
  try {
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

// 2D 캐릭터 비활성화 (3D VRM 전용 스튜디오로 전환)
export const CHARACTERS: CharacterAsset[] = [];
