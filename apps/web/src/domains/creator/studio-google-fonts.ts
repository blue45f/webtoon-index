/**
 * Studio Google Fonts — 브랜드 킷(studio-brand-kit.ts)의 글꼴 선택지를 확장하는 정적 큐레이션
 * 카탈로그. 기존 BRAND_KIT_FONTS(9종 고정) 자체는 건드리지 않는다 — 이 모듈은 그 옆에 놓이는
 * "추가 선택지" 목록이다(교체가 아니라 확장).
 *
 * Google Fonts CSS2 엔드포인트(`fonts.googleapis.com/css2`)는 API 키가 전혀 필요 없고(완전
 * 공개 엔드포인트), 모든 항목이 OFL/Apache 라이선스로 상업적 임베딩이 자유롭다 — 그래서 이
 * 모듈은 매 요청마다 Google 서버에 목록을 조회하는 대신, 검증된 family 이름을 정적으로
 * 하드코딩한다(카탈로그 API 자체가 키를 요구해 조회할 수 없기도 하고, 그럴 필요도 없다).
 *
 * 아래 19종은 전부 2026-07 기준 `fonts.googleapis.com/css2?family=<Family>:wght@<weights>`
 * 요청으로 (a) family 이름이 실제로 존재하고(오타 없이 200 응답), (b) 완성형 한글 음절
 * (U+AC00–D7A3) 유니코드 범위를 포함하는 @font-face 블록이 실제로 내려오고, (c) 나열된
 * weights 값이 전부 유효하다는 것을 curl로 직접 확인한 뒤 골랐다 — "존재할 것 같은" 이름을
 * 추측해 넣지 않았다. 기존 9종과 이름이 겹치는 항목(Black Han Sans·Jua·Gaegu·Nanum Pen
 * Script·Gamja Flower·Yeon Sung·East Sea Dokdo·Nanum Myeongjo)은 의도적으로 제외했다 —
 * 이미 studio-brand-kit.ts BRAND_KIT_FONTS 쪽에서 로드되므로 이 카탈로그에도 넣으면 두
 * 섹션에 같은 폰트가 중복 노출된다(studio-google-fonts.test.ts가 이 무교차를 회귀 검증한다).
 */

export type StudioGoogleFontCategory = "sans" | "serif" | "display" | "handwriting";

export interface StudioGoogleFont {
  /** Google Fonts 카탈로그의 정확한 family 이름 — CSS2 API `family=` 파라미터·
   *  `document.fonts.load()`·`font-family` 선언에 그대로 쓰인다(오타 시 전부 조용히 깨진다). */
  family: string;
  category: StudioGoogleFontCategory;
  /** 오름차순 유니크 정수, 최소 1개. 전부 실제 Google Fonts 응답으로 검증된 값(§ 모듈 설명). */
  weights: number[];
}

/** category → CSS font-family 제네릭 폴백. BRAND_KIT_FONTS의 기존 관례(둥근만화류 display는
 *  sans-serif로, 손글씨류는 cursive로)와 동일하게 맞춘다 — 두 목록의 값 shape이 갈리면 안 된다. */
const CATEGORY_FALLBACK: Record<StudioGoogleFontCategory, string> = {
  sans: "sans-serif",
  serif: "serif",
  display: "sans-serif",
  handwriting: "cursive",
};

export const STUDIO_GOOGLE_FONTS: StudioGoogleFont[] = [
  // sans
  { family: "Noto Sans KR", category: "sans", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { family: "Nanum Gothic", category: "sans", weights: [400, 700, 800] },
  { family: "IBM Plex Sans KR", category: "sans", weights: [100, 200, 300, 400, 500, 600, 700] },
  { family: "Gowun Dodum", category: "sans", weights: [400] },
  { family: "Stylish", category: "sans", weights: [400] },
  { family: "Sunflower", category: "sans", weights: [300, 500, 700] },
  // serif
  { family: "Noto Serif KR", category: "serif", weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { family: "Gowun Batang", category: "serif", weights: [400, 700] },
  { family: "Song Myung", category: "serif", weights: [400] },
  // display
  { family: "Do Hyeon", category: "display", weights: [400] },
  { family: "Gugi", category: "display", weights: [400] },
  { family: "Kirang Haerang", category: "display", weights: [400] },
  { family: "Black And White Picture", category: "display", weights: [400] },
  // handwriting
  { family: "Poor Story", category: "handwriting", weights: [400] },
  { family: "Hi Melody", category: "handwriting", weights: [400] },
  { family: "Cute Font", category: "handwriting", weights: [400] },
  { family: "Single Day", category: "handwriting", weights: [400] },
  { family: "Dokdo", category: "handwriting", weights: [400] },
  { family: "Nanum Brush Script", category: "handwriting", weights: [400] },
];

/** family(대소문자·앞뒤 공백 무시) → 카탈로그 항목. 없으면 undefined. */
export function findStudioGoogleFont(family: string): StudioGoogleFont | undefined {
  const normalized = family.trim().toLowerCase();
  return STUDIO_GOOGLE_FONTS.find((f) => f.family.toLowerCase() === normalized);
}

/** CSS font-family 값(예: `"'Noto Sans KR', sans-serif"` 또는 `"Pretendard, sans-serif"`)에서
 *  첫 번째 폰트 이름만 뽑아낸다(따옴표·콤마 뒤 폴백·공백 제거). El.font·
 *  BrandKit.headingFont/bodyFont가 저장하는 형식과 호환된다. */
export function firstFontFamilyName(cssValue: string): string {
  const first = cssValue.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").trim();
}

/** CSS font-family 값이 이 큐레이션 카탈로그의 Google Font를 가리키는지 해석한다. 가리키지
 *  않으면(BRAND_KIT_FONTS 기존 9종 중 하나이거나 임의 문자열이면) undefined —
 *  "이미 다른 경로로 로드된 폰트라 새로 주입할 필요 없음"을 뜻한다. */
export function resolveStudioGoogleFontFromCssValue(cssValue: string): StudioGoogleFont | undefined {
  return findStudioGoogleFont(firstFontFamilyName(cssValue));
}

/** BRAND_KIT_FONTS의 `value`와 동일 shape의 CSS font-family 문자열을 만든다
 *  (예: `"'Noto Sans KR', sans-serif"`). */
export function studioGoogleFontCssValue(font: StudioGoogleFont): string {
  return `'${font.family}', ${CATEGORY_FALLBACK[font.category]}`;
}

export interface StudioGoogleFontFilter {
  category?: StudioGoogleFontCategory | "all";
  query?: string;
}

/** 카테고리·검색어로 필터링(대소문자 무시 부분일치). 둘 다 생략하면 fonts 그대로 반환. */
export function filterStudioGoogleFonts(
  fonts: readonly StudioGoogleFont[],
  filter: StudioGoogleFontFilter = {}
): StudioGoogleFont[] {
  const { category = "all", query = "" } = filter;
  const normalizedQuery = query.trim().toLowerCase();
  return fonts.filter((f) => {
    if (category !== "all" && f.category !== category) return false;
    if (normalizedQuery && !f.family.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });
}

/**
 * Google Fonts CSS2 stylesheet URL을 만든다. 한 번의 요청으로 필요한 굵기를 전부 받도록
 * weights를 `:wght@100;400;700` 형태로 합친다(폰트당 1개 <link>만 주입하기 위함 — 굵기별로
 * 따로 요청하지 않는다). weights가 비어 있으면 굵기 축 없이(기본 400) 요청한다.
 */
export function buildGoogleFontCss2Url(family: string, weights: readonly number[]): string {
  const encodedFamily = family.trim().replace(/\s+/g, "+");
  const sortedWeights = [...new Set(weights)].filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  const weightParam = sortedWeights.length > 0 ? `:wght@${sortedWeights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${encodedFamily}${weightParam}&display=swap`;
}

/** family → DOM `<link id>` 슬러그(영숫자만 남기고 소문자·하이픈화). 같은 family는 항상 같은
 *  id를 내어 중복 <link> 주입을 막는 가드에 쓰인다(StudioPage.tsx STUDIO_FONTS_LINK_ID와
 *  동일한 id-가드 패턴, 이 카탈로그는 폰트마다 별도 id가 필요하다는 점만 다르다). */
export function googleFontLinkId(family: string): string {
  const slug = family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `studio-google-font-${slug || "unknown"}`;
}
