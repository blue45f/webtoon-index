/**
 * `--font-serif`(Nanum Myeongjo) 온디맨드 주입 — 웹 크롬 전용.
 *
 * 이 폰트는 랜딩 히어로·탐색·운세·리뷰·디자인 시스템의 본문 타이포(`font-serif`)에 쓰이지만
 * `/studio` 부팅 화면에는 `font-serif` 를 쓰는 DOM 이 한 곳도 없다. 그런데 Google Fonts CSS2 는
 * 한글을 유니코드 범위별 `@font-face` 로 쪼개 내려주기 때문에(용량 절약을 위한 구글 표준 관례)
 * 이 폰트 하나의 스타일시트가 184블록 25,604 B(gzip 실측)다 — index.html 렌더 차단 <link> 전체
 * 25,974 B 의 98.6 %. 그래서 임계 경로에서 빼고 실제로 쓰는 경로에서만 주입한다.
 *
 * 스튜디오 쪽 소비자(브랜드킷 "명조" = BRAND_KIT_FONTS 의 `'Nanum Myeongjo', serif`)는 이 모듈이
 * 아니라 StudioPage.tsx 의 `STUDIO_FONTS_CSS2_URL` idle 프리로드가 담당한다. Konva 캔버스 텍스트는
 * DOM 과 달리 폰트 스왑을 스스로 감지하지 못해 수동 재도색이 필요한데, 그 재도색 훅
 * (`document.fonts` "loadingdone")이 이미 그 레인에 붙어 있기 때문이다 — 나머지 BRAND_KIT_FONTS
 * 8종과 같은 <link> 에 둬야 프리로드 타이밍과 재도색 보정이 한 벌로 맞는다.
 */
import { isImmersiveMobileRoute } from "./routes/immersive-mobile-route";

export const SERIF_WEBFONT_LINK_ID = "app-serif-webfont";
export const SERIF_WEBFONT_CSS2_URL =
  "https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap";

/** 멱등 주입 — 이미 있으면 아무 것도 하지 않는다(StudioPage.tsx STUDIO_FONTS_LINK_ID 와 동일한
 *  id-가드 패턴). `display=swap` 은 URL 에 이미 들어 있어 도착 전에는 폴백 세리프로 그려진다. */
export function ensureSerifWebFont(doc: Document): void {
  if (doc.getElementById(SERIF_WEBFONT_LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = SERIF_WEBFONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = SERIF_WEBFONT_CSS2_URL;
  doc.head.appendChild(link);
}

/**
 * 경로 규칙을 한 곳에 모은 진입점. 스튜디오 경로면 주입하지 않는다(그쪽은 자체 idle 프리로드가
 * 담당). 호출처는 둘이다 — 최초 진입은 main.tsx 가 `createRoot().render()` 직전에 부르고(렌더
 * 시작 전에 요청이 출발하므로 랜딩의 FOUT 창이 넓어지지 않는다), 이후 SPA 라우팅은 App.tsx 의
 * 브리지가 부른다(`/studio` → `/` 이동도 덮인다). 멱등이라 두 번 불려도 안전하다.
 */
export function ensureSerifWebFontForRoute(pathname: string, doc: Document = document): void {
  if (isImmersiveMobileRoute(pathname)) return;
  ensureSerifWebFont(doc);
}
