// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { BRAND_KIT_FONTS } from "./studio-brand-kit";
import {
  buildStudioPresetFontsCss2Url,
  collectStudioPresetFontsInUse,
  ensureStudioDocumentPresetFontsLoaded,
  ensureStudioPresetFontsLoaded,
  findStudioPresetFont,
  firstCssFontFamilyName,
  STUDIO_DOCUMENT_FONTS_LINK_ID,
  STUDIO_PRESET_FONT_SPECS,
  STUDIO_PRESET_FONTS_LINK_ID,
} from "./studio-preset-font-loading";

/** 이 결함이 재발했는지 보는 단일 지표 — head 에 붙은 구글폰트 스타일시트. */
function injectedGoogleFontHrefs(): string[] {
  return [...document.head.querySelectorAll("link[rel='stylesheet']")]
    .map((link) => (link as HTMLLinkElement).href)
    .filter((href) => href.includes("fonts.googleapis.com"));
}

beforeEach(() => {
  document.getElementById(STUDIO_DOCUMENT_FONTS_LINK_ID)?.remove();
  document.getElementById(STUDIO_PRESET_FONTS_LINK_ID)?.remove();
});

describe("firstCssFontFamilyName", () => {
  it("strips quotes and fallbacks from an El.font value", () => {
    expect(firstCssFontFamilyName("'Nanum Myeongjo', serif")).toBe("Nanum Myeongjo");
    expect(firstCssFontFamilyName("Pretendard, sans-serif")).toBe("Pretendard");
    expect(firstCssFontFamilyName('"Black Han Sans", sans-serif')).toBe("Black Han Sans");
  });

  it("treats missing fonts as no family", () => {
    expect(firstCssFontFamilyName(undefined)).toBe("");
    expect(firstCssFontFamilyName(null)).toBe("");
    expect(firstCssFontFamilyName("")).toBe("");
  });
});

describe("preset table", () => {
  it("covers every BRAND_KIT_FONTS entry except the locally hosted Pretendard", () => {
    // 프리셋 목록 버튼이 그리는 글꼴과 이 표가 어긋나면, 목록을 열어도 안 받아지는 글꼴이 생긴다.
    const missing = BRAND_KIT_FONTS.map((font) => firstCssFontFamilyName(font.value))
      .filter((family) => family !== "Pretendard")
      .filter((family) => !findStudioPresetFont(family));
    expect(missing).toEqual([]);
  });

  it("keeps the eight Google families the studio used to preload unconditionally", () => {
    expect(STUDIO_PRESET_FONT_SPECS.map((spec) => spec.family)).toEqual([
      "Black Han Sans",
      "East Sea Dokdo",
      "Gaegu",
      "Gamja Flower",
      "Jua",
      "Nanum Myeongjo",
      "Nanum Pen Script",
      "Yeon Sung",
    ]);
  });

  it("rebuilds the exact css2 URL the old single constant used", () => {
    expect(buildStudioPresetFontsCss2Url(STUDIO_PRESET_FONT_SPECS)).toBe(
      "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=East+Sea+Dokdo&family=Gaegu:wght@400;700&family=Gamja+Flower&family=Jua&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Yeon+Sung&display=swap",
    );
  });

  it("returns no URL for an empty family set", () => {
    expect(buildStudioPresetFontsCss2Url([])).toBeNull();
  });
});

describe("collectStudioPresetFontsInUse", () => {
  it("finds only the preset families the document actually uses", () => {
    expect(
      collectStudioPresetFontsInUse([
        { type: "text", font: "'Jua', sans-serif" },
        { type: "bubble", font: "'Nanum Myeongjo', serif" },
        { type: "draw" },
      ]).map((spec) => spec.family),
    ).toEqual(["Jua", "Nanum Myeongjo"]);
  });

  it("ignores Pretendard, custom uploads and unknown families", () => {
    expect(
      collectStudioPresetFontsInUse([
        { type: "text", font: "Pretendard, sans-serif" },
        { type: "text", font: "'My Uploaded Font', sans-serif" },
        { type: "text" },
      ]),
    ).toEqual([]);
  });

  it("de-duplicates and keeps the table order so the URL stays stable", () => {
    const first = collectStudioPresetFontsInUse([
      { type: "text", font: "'Yeon Sung', cursive" },
      { type: "text", font: "'Jua', sans-serif" },
      { type: "text", font: "'Jua', sans-serif" },
    ]);
    const reordered = collectStudioPresetFontsInUse([
      { type: "text", font: "'Jua', sans-serif" },
      { type: "text", font: "'Yeon Sung', cursive" },
    ]);
    expect(first.map((spec) => spec.family)).toEqual(["Jua", "Yeon Sung"]);
    expect(buildStudioPresetFontsCss2Url(first)).toBe(buildStudioPresetFontsCss2Url(reordered));
  });
});

describe("load timing", () => {
  it("requests nothing for a cold, empty document", () => {
    // 결함 D-폰트의 회귀 지표: 글꼴을 안 쓰는 문서를 열었을 뿐인데 8종을 받아 오던 자리다.
    expect(ensureStudioDocumentPresetFontsLoaded([])).toBe(false);
    expect(injectedGoogleFontHrefs()).toEqual([]);
  });

  it("requests only the families a document with text actually uses", () => {
    expect(
      ensureStudioDocumentPresetFontsLoaded([
        { type: "text", font: "'Gaegu', cursive" },
        { type: "draw" },
      ]),
    ).toBe(true);
    const hrefs = injectedGoogleFontHrefs();
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain("family=Gaegu:wght@400;700");
    expect(hrefs[0]).not.toContain("Black+Han+Sans");
    expect(hrefs[0]).not.toContain("Yeon+Sung");
  });

  it("loads all eight only when the preset list is opened", () => {
    expect(ensureStudioPresetFontsLoaded()).toBe(true);
    const hrefs = injectedGoogleFontHrefs();
    expect(hrefs).toHaveLength(1);
    for (const spec of STUDIO_PRESET_FONT_SPECS) {
      expect(hrefs[0]).toContain(spec.family.replace(/ /gu, "+"));
    }
  });

  it("is idempotent — opening the list twice does not add a second stylesheet", () => {
    expect(ensureStudioPresetFontsLoaded()).toBe(true);
    expect(ensureStudioPresetFontsLoaded()).toBe(false);
    expect(injectedGoogleFontHrefs()).toHaveLength(1);
  });

  it("widens the document link in place when a later page needs more families", () => {
    ensureStudioDocumentPresetFontsLoaded([{ type: "text", font: "'Jua', sans-serif" }]);
    ensureStudioDocumentPresetFontsLoaded([
      { type: "text", font: "'Jua', sans-serif" },
      { type: "bubble", font: "'Yeon Sung', cursive" },
    ]);
    const hrefs = injectedGoogleFontHrefs();
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain("family=Jua");
    expect(hrefs[0]).toContain("family=Yeon+Sung");
  });

  it("keeps the document and preset links separate so neither clobbers the other", () => {
    ensureStudioDocumentPresetFontsLoaded([{ type: "text", font: "'Jua', sans-serif" }]);
    ensureStudioPresetFontsLoaded();
    expect(injectedGoogleFontHrefs()).toHaveLength(2);
    expect(document.getElementById(STUDIO_DOCUMENT_FONTS_LINK_ID)).not.toBeNull();
    expect(document.getElementById(STUDIO_PRESET_FONTS_LINK_ID)).not.toBeNull();
  });
});
