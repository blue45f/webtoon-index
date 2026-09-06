/**
 * 스튜디오 프리셋 글꼴(구글폰트 8종)의 로드 시점 계획.
 *
 * 무엇이 문제였나
 * ---------------
 * `StudioPage.tsx` 는 스튜디오가 마운트되면 `requestIdleCallback` 으로 8종 전부를 담은 css2
 * `<link>` 를 **무조건** 주입했다. 의도는 정당했다 — Konva 캔버스 텍스트는 DOM 과 달리 폰트
 * 스왑을 스스로 감지하지 못해서, 첫 사용 시점에 로드하면 폴백으로 그려졌다가 다시 그려지는
 * 깜빡임이 난다. 그래서 "미리 받아 두자" 였다.
 *
 * 대가는 글꼴을 한 번도 안 쓰는 사용자까지 치렀다. 그 링크가 붙는 순간 8패밀리의 @font-face 가
 * 등록되고, 글꼴 프리셋 목록(인스펙터 타이포그래피·브랜드킷)이 열려 미리보기 라벨이 각자 자기
 * 글꼴로 렌더되면 그 자리에서 8종의 한글 서브셋이 통째로 내려온다.
 *
 * 무엇으로 바꿨나
 * ---------------
 * 시점을 **필요에 묶는다**. 두 갈래뿐이다.
 *
 *  1. **문서가 이미 쓰는 글꼴** — 문서 로드 시 즉시. 캔버스에 이미 그 글자가 있으므로 늦게 받으면
 *     리플로가 아니라 잘못 그려진 캔버스를 보게 된다. 그래서 여기서는 미루지 않는다.
 *     다만 8종 전부가 아니라 **실제로 쓰인 패밀리만** 받는다.
 *  2. **프리셋 목록을 처음 열 때** — 나머지 전부. 목록 안 미리보기가 잠깐 시스템 글꼴로 그려졌다
 *     스왑되는 것은 허용된다(캔버스 FOUT 과 다르다 — 목록은 DOM 이라 브라우저가 알아서 다시 그린다).
 *
 * 두 갈래 모두 `<link id>` 가드로 멱등이다. 브라우저가 css2 응답을 캐시하므로 두 번째 요청은
 * 네트워크로 나가지 않는다.
 */

import { useEffect } from "react";

/** 프리셋 한 종. `family` 는 구글폰트 css2 의 패밀리명, `weights` 는 그 URL 이 요청하던 무게. */
export interface StudioPresetFontSpec {
  readonly family: string;
  readonly weights?: readonly number[];
}

/**
 * 스튜디오 프리셋 8종. 목록과 무게는 예전 `STUDIO_FONTS_CSS2_URL` 한 줄과 **정확히 같아야** 한다
 * — 이 표가 그 URL 을 대체하기 때문이다. `BRAND_KIT_FONTS` 의 9개 중 Pretendard 는 구글폰트가
 * 아니라 jsDelivr 이고 index.html 이 이미 받으므로 여기 없다.
 */
export const STUDIO_PRESET_FONT_SPECS: readonly StudioPresetFontSpec[] = [
  { family: "Black Han Sans" },
  { family: "East Sea Dokdo" },
  { family: "Gaegu", weights: [400, 700] },
  { family: "Gamja Flower" },
  { family: "Jua" },
  { family: "Nanum Myeongjo", weights: [400, 700] },
  { family: "Nanum Pen Script" },
  { family: "Yeon Sung" },
];

/**
 * `El.font` 같은 CSS font-family 문자열에서 첫 패밀리 이름만 꺼낸다.
 * `"'Nanum Myeongjo', serif"` → `Nanum Myeongjo`.
 */
export function firstCssFontFamilyName(cssValue: string | null | undefined): string {
  if (!cssValue) return "";
  const first = cssValue.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/gu, "").trim();
}

/** 프리셋 표에서 패밀리 이름으로 찾는다(대소문자 무시). */
export function findStudioPresetFont(family: string): StudioPresetFontSpec | undefined {
  const needle = family.trim().toLowerCase();
  if (!needle) return undefined;
  return STUDIO_PRESET_FONT_SPECS.find((spec) => spec.family.toLowerCase() === needle);
}

/** 글꼴을 가질 수 있는 요소의 최소 형태 — 문서 모델 전체를 끌어오지 않기 위한 구조적 타입. */
export interface StudioFontBearingElementLike {
  readonly type: string;
  readonly font?: string | null;
}

/**
 * 문서(또는 한 페이지)의 요소들이 실제로 쓰는 **프리셋** 글꼴을 모은다.
 * 프리셋이 아닌 값(Pretendard·사용자 업로드 글꼴·19종 확장 카탈로그)은 각자 다른 경로가 담당하므로
 * 여기서는 조용히 무시한다.
 */
export function collectStudioPresetFontsInUse(
  elements: Iterable<StudioFontBearingElementLike>,
): StudioPresetFontSpec[] {
  const found = new Map<string, StudioPresetFontSpec>();
  for (const element of elements) {
    const spec = findStudioPresetFont(firstCssFontFamilyName(element.font));
    if (spec) found.set(spec.family, spec);
  }
  // 표 순서를 따라 돌려준다 — 같은 집합이면 같은 URL 이 나와야 링크 id 가드가 먹는다.
  return STUDIO_PRESET_FONT_SPECS.filter((spec) => found.has(spec.family));
}

/** 구글폰트 css2 URL. 패밀리 순서는 호출부가 정렬해 넘긴다(표 순서 유지 = 안정적인 URL). */
export function buildStudioPresetFontsCss2Url(
  specs: readonly StudioPresetFontSpec[],
): string | null {
  if (specs.length === 0) return null;
  const families = specs.map((spec) => {
    const name = spec.family.replace(/ /gu, "+");
    return spec.weights && spec.weights.length > 0
      ? `family=${name}:wght@${[...spec.weights].sort((a, b) => a - b).join(";")}`
      : `family=${name}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/** 주입한 `<link>` 를 알아보는 id. 문서용/프리셋용을 나눠 서로를 덮어쓰지 않게 한다. */
export const STUDIO_DOCUMENT_FONTS_LINK_ID = "studio-document-google-fonts";
export const STUDIO_PRESET_FONTS_LINK_ID = "studio-preset-google-fonts";

function injectStylesheet(id: string, href: string): boolean {
  if (typeof document === "undefined") return false;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  if (existing) {
    // 문서용 링크는 페이지를 옮기면 필요한 패밀리 집합이 늘 수 있다 — href 가 바뀌면 갱신한다.
    if (existing.href !== href) existing.href = href;
    return false;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  return true;
}

/**
 * 이미 계산해 둔 문서용 URL 로 로드한다.
 *
 * 호출부(StudioPage)가 이 URL 을 effect 의 **유일한 의존성**으로 쓰기 때문에 URL 을 받는 형태가
 * 따로 있다 — 요소 배열을 effect 안에서 다시 읽으면 의존성 배열이 매 렌더 바뀌어, exhaustive-deps
 * 를 끄지 않고는 다룰 수 없다. 그 억제 주석 하나가 React Compiler 로 하여금 그 컴포넌트 전체의
 * 최적화를 포기하게 만든다(`react-compiler/react-compiler`). URL 만 넘기면 그럴 일이 없다.
 */
export function ensureStudioDocumentFontStylesheet(href: string | null): boolean {
  if (!href) return false;
  return injectStylesheet(STUDIO_DOCUMENT_FONTS_LINK_ID, href);
}

/**
 * 문서가 이미 쓰는 프리셋 글꼴만 즉시 로드한다. 쓰는 글꼴이 없으면 아무 요청도 하지 않는다.
 * 반환값은 "이번 호출이 새 링크를 붙였는가" — 붙였을 때만 캔버스 재도색을 예약하면 된다.
 */
export function ensureStudioDocumentPresetFontsLoaded(
  elements: Iterable<StudioFontBearingElementLike>,
): boolean {
  return ensureStudioDocumentFontStylesheet(
    buildStudioPresetFontsCss2Url(collectStudioPresetFontsInUse(elements)),
  );
}

/**
 * 프리셋 목록(글꼴 고르기 UI)이 처음 열릴 때 8종 전부를 로드한다.
 * 목록이 마운트되는 순간이 곧 "사용자가 글꼴을 고르려 한다" 는 신호라, 여기가 가장 늦으면서도
 * 충분히 이른 시점이다.
 */
export function ensureStudioPresetFontsLoaded(): boolean {
  const href = buildStudioPresetFontsCss2Url(STUDIO_PRESET_FONT_SPECS);
  if (!href) return false;
  return injectStylesheet(STUDIO_PRESET_FONTS_LINK_ID, href);
}

/**
 * 글꼴 프리셋 목록이 **처음 화면에 붙는 순간**을 잡는 렌더 없는 컴포넌트.
 *
 * 인스펙터의 글꼴 그리드는 4천 줄짜리 컴포넌트 안 인라인 JSX 라 조건부로 훅을 걸 수 없다.
 * 그 자리에 이 컴포넌트를 한 줄 놓으면, 그리드가 마운트될 때(= 텍스트/말풍선이 선택되고
 * 타이포그래피 섹션이 펼쳐졌을 때)만 효과가 돈다. 반환값이 `null` 이라 JSX 없이 쓸 수 있어
 * 이 모듈(.ts)에 함께 둔다 — 로드 시점을 정하는 규칙이 한 파일에 모여 있는 편이 낫다.
 */
export function StudioPresetFontPreload(): null {
  useEffect(() => {
    ensureStudioPresetFontsLoaded();
  }, []);
  return null;
}
