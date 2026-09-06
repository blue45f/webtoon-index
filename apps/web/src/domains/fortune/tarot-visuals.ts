// 메이저 아르카나 22장 각각의 고유 비주얼 — 이미지 자산 없이 카드별 색상환 hue +
// 모티프 글리프로 22종을 시각적으로 구분한다. 카드 페이스는 content-art 맥락이라
// 따뜻한 잉크 중립축을 벗어나 풍부한 색을 쓰되, OKLCH로만 표현한다.

export interface TarotVisual {
  glyph: string; // 중앙 모티프
  hue: number; // OKLCH hue (카드별 고유 색)
  roman: string; // 로마 숫자 표기
}

export const TAROT_VISUALS: Record<number, TarotVisual> = {
  0: { glyph: "🎒", hue: 82, roman: "0" }, // 광대 — 모험의 시작
  1: { glyph: "🪄", hue: 300, roman: "I" }, // 마법사 — 창조
  2: { glyph: "🌙", hue: 255, roman: "II" }, // 여사제 — 직관
  3: { glyph: "🌷", hue: 150, roman: "III" }, // 여황제 — 풍요
  4: { glyph: "👑", hue: 32, roman: "IV" }, // 황제 — 권위
  5: { glyph: "🗝️", hue: 64, roman: "V" }, // 교황 — 전통
  6: { glyph: "💞", hue: 350, roman: "VI" }, // 연인 — 사랑
  7: { glyph: "🏇", hue: 238, roman: "VII" }, // 전차 — 돌진
  8: { glyph: "🦁", hue: 44, roman: "VIII" }, // 힘 — 용기
  9: { glyph: "🏮", hue: 72, roman: "IX" }, // 은둔자 — 성찰
  10: { glyph: "🎡", hue: 128, roman: "X" }, // 운명의 수레바퀴
  11: { glyph: "⚖️", hue: 205, roman: "XI" }, // 정의 — 균형
  12: { glyph: "🙃", hue: 192, roman: "XII" }, // 매달린 사람 — 전환
  13: { glyph: "🦋", hue: 322, roman: "XIII" }, // 죽음 — 재생
  14: { glyph: "🍶", hue: 172, roman: "XIV" }, // 절제 — 정화
  15: { glyph: "😈", hue: 18, roman: "XV" }, // 악마 — 유혹
  16: { glyph: "⚡", hue: 8, roman: "XVI" }, // 탑 — 붕괴
  17: { glyph: "⭐", hue: 228, roman: "XVII" }, // 별 — 희망
  18: { glyph: "🌕", hue: 272, roman: "XVIII" }, // 달 — 무의식
  19: { glyph: "☀️", hue: 88, roman: "XIX" }, // 태양 — 성공
  20: { glyph: "🎺", hue: 52, roman: "XX" }, // 심판 — 부활
  21: { glyph: "🌍", hue: 142, roman: "XXI" }, // 세계 — 완성
};

export function getTarotVisual(id: number): TarotVisual {
  return TAROT_VISUALS[id] ?? { glyph: "✦", hue: 42, roman: String(id) };
}

// 카드 페이스 그라디언트(어두운 카드 바탕)
export function tarotFaceGradient(hue: number): string {
  return `linear-gradient(160deg, oklch(0.42 0.13 ${hue}) 0%, oklch(0.26 0.08 ${hue}) 52%, oklch(0.17 0.04 ${hue}) 100%)`;
}

// 카드 글로/테두리·글리프 강조색
export function tarotAccent(hue: number): string {
  return `oklch(0.82 0.13 ${hue})`;
}
