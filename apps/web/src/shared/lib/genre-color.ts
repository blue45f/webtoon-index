// 장르 스펙트럼 — 18개 장르를 색상환에 매핑. 단일 출처.
// 칩 틴트 / 스펙트럼 바 / 데이터 그래프에서 일관 사용.
// L/C는 대체로 고정(0.72 / 0.15), hue만 변주. 일부 장르는 가독·구분 위해 미세 조정.

interface GenreHue {
  h: number; // hue
  c?: number; // chroma override
}

const GENRE_HUE: Record<string, GenreHue> = {
  로맨스: { h: 5, c: 0.16 }, // rose
  로판: { h: 340, c: 0.16 }, // magenta-pink
  BL: { h: 315, c: 0.15 }, // orchid
  판타지: { h: 290, c: 0.16 }, // violet
  현판: { h: 268, c: 0.15 }, // indigo
  SF: { h: 245, c: 0.15 }, // blue
  게임판타지: { h: 222, c: 0.14 }, // azure
  미스터리: { h: 205, c: 0.13 }, // steel-cyan
  스릴러: { h: 195, c: 0.12 }, // cold teal
  공포: { h: 150, c: 0.11 }, // eerie green
  일상: { h: 162, c: 0.12 }, // mint
  스포츠: { h: 138, c: 0.16 }, // green-lime
  코미디: { h: 100, c: 0.16 }, // chartreuse
  학원: { h: 78, c: 0.15 }, // warm yellow
  역사: { h: 62, c: 0.13 }, // amber
  드라마: { h: 35, c: 0.13 }, // clay
  무협: { h: 22, c: 0.17 }, // red-orange
  액션: { h: 12, c: 0.18 }, // red
};

const FALLBACK: GenreHue = { h: 70, c: 0.04 };

// 칩/뱃지 텍스트용 (밝고 채도 있는)
export function genreColor(genre: string, l = 0.78): string {
  const g = GENRE_HUE[genre] ?? FALLBACK;
  return `oklch(${l} ${g.c ?? 0.15} ${g.h})`;
}

/**
 * 장르 칩/라벨 텍스트용 적응 색상. 장르 hue는 유지하되 주간 모드에서는 명도를 낮춰
 * warm-white 표면에서 WCAG AA를 확보하고, 야간 모드에서는 기존의 밝은 스펙트럼을 유지한다.
 * `light-dark()`는 루트 color-scheme을 따르므로 웹 앱의 주간·야간 테마가 같은 함수를 쓴다.
 */
export function genreTextColor(genre: string, darkLightness = 0.82, lightLightness = 0.44): string {
  const g = GENRE_HUE[genre] ?? FALLBACK;
  const chroma = g.c ?? 0.15;
  return `light-dark(oklch(${lightLightness} ${chroma} ${g.h}), oklch(${darkLightness} ${chroma} ${g.h}))`;
}

// 칩 배경 틴트 (저명도/저채도 + 알파)
export function genreTint(genre: string, alpha = 0.16): string {
  const g = GENRE_HUE[genre] ?? FALLBACK;
  return `oklch(0.72 ${g.c ?? 0.15} ${g.h} / ${alpha})`;
}

// 보더 틴트
export function genreBorder(genre: string, alpha = 0.35): string {
  const g = GENRE_HUE[genre] ?? FALLBACK;
  return `oklch(0.72 ${g.c ?? 0.15} ${g.h} / ${alpha})`;
}

// 스펙트럼 바: 여러 장르 → 가로 그라디언트 (CSS linear-gradient 문자열)
export function spectrumGradient(genres: readonly string[], angle = 90): string {
  const list = genres.length ? genres : ["로맨스", "판타지", "액션"];
  if (list.length === 1) {
    const c = genreColor(list[0], 0.7);
    return `linear-gradient(${angle}deg, ${c}, ${genreColor(list[0], 0.82)})`;
  }
  const stops = list.map((g, i) => {
    const pct = Math.round((i / (list.length - 1)) * 100);
    return `${genreColor(g, 0.72)} ${pct}%`;
  });
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}
