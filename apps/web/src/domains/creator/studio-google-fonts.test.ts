import { describe, it, expect } from "vitest";

import { BRAND_KIT_FONTS } from "./studio-brand-kit";
import {
  buildGoogleFontCss2Url,
  filterStudioGoogleFonts,
  findStudioGoogleFont,
  firstFontFamilyName,
  googleFontLinkId,
  resolveStudioGoogleFontFromCssValue,
  STUDIO_GOOGLE_FONTS,
  studioGoogleFontCssValue,
  type StudioGoogleFont,
} from "./studio-google-fonts";

describe("STUDIO_GOOGLE_FONTS 카탈로그 불변식", () => {
  it("적어도 몇 종 이상의 큐레이션 폰트를 담고 있다", () => {
    expect(STUDIO_GOOGLE_FONTS.length).toBeGreaterThanOrEqual(15);
  });

  it("모든 항목이 family/category/weights 형식을 지킨다", () => {
    for (const f of STUDIO_GOOGLE_FONTS) {
      expect(f.family.trim().length).toBeGreaterThan(0);
      expect(["sans", "serif", "display", "handwriting"]).toContain(f.category);
      expect(f.weights.length).toBeGreaterThan(0);
      for (const w of f.weights) {
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThan(0);
      }
      // 오름차순 유니크
      const sorted = [...new Set(f.weights)].sort((a, b) => a - b);
      expect(f.weights).toEqual(sorted);
    }
  });

  it("family 이름이 카탈로그 내에서 중복되지 않는다(대소문자 무시)", () => {
    const seen = new Set<string>();
    for (const f of STUDIO_GOOGLE_FONTS) {
      const key = f.family.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("기존 브랜드 킷 9종 글꼴과 중복되지 않는다(확장이지 교체가 아님)", () => {
    const existingFamilies = new Set(BRAND_KIT_FONTS.map((f) => firstFontFamilyName(f.value).toLowerCase()));
    for (const font of STUDIO_GOOGLE_FONTS) {
      expect(existingFamilies.has(font.family.toLowerCase())).toBe(false);
    }
  });
});

describe("findStudioGoogleFont", () => {
  it("정확한 이름으로 찾는다", () => {
    expect(findStudioGoogleFont("Noto Sans KR")?.family).toBe("Noto Sans KR");
  });

  it("대소문자를 무시한다", () => {
    expect(findStudioGoogleFont("noto sans kr")?.family).toBe("Noto Sans KR");
    expect(findStudioGoogleFont("GOWUN BATANG")?.family).toBe("Gowun Batang");
  });

  it("앞뒤 공백을 무시한다", () => {
    expect(findStudioGoogleFont("  Gugi  ")?.family).toBe("Gugi");
  });

  it("없는 이름은 undefined", () => {
    expect(findStudioGoogleFont("Not A Real Font")).toBeUndefined();
    expect(findStudioGoogleFont("")).toBeUndefined();
  });
});

describe("firstFontFamilyName", () => {
  it("따옴표로 감싼 첫 폰트 이름을 뽑는다", () => {
    expect(firstFontFamilyName("'Noto Sans KR', sans-serif")).toBe("Noto Sans KR");
  });

  it("따옴표 없는 값도 처리한다", () => {
    expect(firstFontFamilyName("Pretendard, sans-serif")).toBe("Pretendard");
  });

  it("콤마·폴백이 없는 단일 값도 처리한다", () => {
    expect(firstFontFamilyName("Arial")).toBe("Arial");
  });

  it("여분의 공백을 정리한다", () => {
    expect(firstFontFamilyName("  'Gaegu' , cursive")).toBe("Gaegu");
  });

  it("큰따옴표도 처리한다", () => {
    expect(firstFontFamilyName('"Jua", sans-serif')).toBe("Jua");
  });
});

describe("resolveStudioGoogleFontFromCssValue", () => {
  it("카탈로그의 Google Font를 가리키는 값이면 해당 항목을 반환한다", () => {
    expect(resolveStudioGoogleFontFromCssValue("'Noto Sans KR', sans-serif")?.family).toBe("Noto Sans KR");
  });

  it("기존 9종(예: Jua) 값이면 undefined — 이미 다른 경로로 로드됨", () => {
    expect(resolveStudioGoogleFontFromCssValue("'Jua', sans-serif")).toBeUndefined();
  });

  it("임의 문자열이면 undefined", () => {
    expect(resolveStudioGoogleFontFromCssValue("Comic Sans MS, cursive")).toBeUndefined();
  });
});

describe("studioGoogleFontCssValue", () => {
  const font = (category: StudioGoogleFont["category"], family = "Test Font"): StudioGoogleFont => ({
    family,
    category,
    weights: [400],
  });

  it("sans는 sans-serif로 폴백한다", () => {
    expect(studioGoogleFontCssValue(font("sans"))).toBe("'Test Font', sans-serif");
  });

  it("serif는 serif로 폴백한다", () => {
    expect(studioGoogleFontCssValue(font("serif"))).toBe("'Test Font', serif");
  });

  it("display는 sans-serif로 폴백한다(기존 9종 display류 관례와 동일)", () => {
    expect(studioGoogleFontCssValue(font("display"))).toBe("'Test Font', sans-serif");
  });

  it("handwriting은 cursive로 폴백한다(기존 9종 손글씨류 관례와 동일)", () => {
    expect(studioGoogleFontCssValue(font("handwriting"))).toBe("'Test Font', cursive");
  });

  it("카탈로그 실제 항목에도 동일하게 적용된다", () => {
    const noto = findStudioGoogleFont("Noto Sans KR")!;
    expect(studioGoogleFontCssValue(noto)).toBe("'Noto Sans KR', sans-serif");
  });
});

describe("filterStudioGoogleFonts", () => {
  it("옵션 없이 호출하면 전체를 반환한다", () => {
    expect(filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS)).toEqual(STUDIO_GOOGLE_FONTS);
  });

  it("category로 좁힌다", () => {
    const result = filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { category: "handwriting" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((f) => f.category === "handwriting")).toBe(true);
  });

  it('category "all"은 전체를 반환한다', () => {
    expect(filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { category: "all" })).toEqual(STUDIO_GOOGLE_FONTS);
  });

  it("query로 부분일치·대소문자 무시 검색한다", () => {
    const result = filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { query: "noto" });
    expect(result.map((f) => f.family).sort()).toEqual(["Noto Sans KR", "Noto Serif KR"]);
  });

  it("category와 query를 함께 적용한다", () => {
    const result = filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { category: "serif", query: "noto" });
    expect(result.map((f) => f.family)).toEqual(["Noto Serif KR"]);
  });

  it("일치하는 게 없으면 빈 배열", () => {
    expect(filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { query: "존재하지않는폰트이름xyz" })).toEqual([]);
  });
});

describe("buildGoogleFontCss2Url", () => {
  it("단일 굵기 URL을 만든다", () => {
    expect(buildGoogleFontCss2Url("Jua", [400])).toBe(
      "https://fonts.googleapis.com/css2?family=Jua:wght@400&display=swap"
    );
  });

  it("여러 굵기를 세미콜론으로 합친다", () => {
    expect(buildGoogleFontCss2Url("Noto Sans KR", [400, 700, 900])).toBe(
      "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap"
    );
  });

  it("굵기가 비어 있으면 wght 축 없이 요청한다", () => {
    expect(buildGoogleFontCss2Url("Gugi", [])).toBe("https://fonts.googleapis.com/css2?family=Gugi&display=swap");
  });

  it("공백이 있는 family 이름은 +로 이어붙인다", () => {
    expect(buildGoogleFontCss2Url("Black And White Picture", [400])).toBe(
      "https://fonts.googleapis.com/css2?family=Black+And+White+Picture:wght@400&display=swap"
    );
  });

  it("정렬 안 된/중복된 굵기를 정규화한다", () => {
    expect(buildGoogleFontCss2Url("Noto Serif KR", [700, 400, 700, 200])).toBe(
      "https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@200;400;700&display=swap"
    );
  });

  it("0 이하·NaN 굵기는 걸러낸다", () => {
    expect(buildGoogleFontCss2Url("Gugi", [400, 0, -1, Number.NaN])).toBe(
      "https://fonts.googleapis.com/css2?family=Gugi:wght@400&display=swap"
    );
  });
});

describe("googleFontLinkId", () => {
  it("소문자·하이픈 슬러그를 만든다", () => {
    expect(googleFontLinkId("Noto Sans KR")).toBe("studio-google-font-noto-sans-kr");
  });

  it("영숫자가 아닌 문자를 하이픈으로 정리한다", () => {
    expect(googleFontLinkId("Black And White Picture")).toBe("studio-google-font-black-and-white-picture");
  });

  it("같은 입력은 항상 같은 id(멱등)", () => {
    expect(googleFontLinkId("Gugi")).toBe(googleFontLinkId("Gugi"));
  });

  it("다른 family는 다른 id를 만든다", () => {
    expect(googleFontLinkId("Dokdo")).not.toBe(googleFontLinkId("East Sea Dokdo"));
  });

  it("카탈로그 전체 id가 서로 유니크하다", () => {
    const ids = STUDIO_GOOGLE_FONTS.map((f) => googleFontLinkId(f.family));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
