// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  SERIF_WEBFONT_CSS2_URL,
  SERIF_WEBFONT_LINK_ID,
  ensureSerifWebFontForRoute,
} from "./serif-webfont";

function injectedHrefs(): string[] {
  return [...document.head.querySelectorAll(`link#${SERIF_WEBFONT_LINK_ID}`)].map(
    (link) => (link as HTMLLinkElement).getAttribute("href") ?? "",
  );
}

describe("ensureSerifWebFontForRoute", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it.each(["/studio", "/studio/", "/studio/tools-companion"])(
    "%s 에서는 주입하지 않는다 — 스튜디오는 자체 idle 프리로드가 명조를 담당한다",
    (pathname) => {
      ensureSerifWebFontForRoute(pathname, document);
      expect(injectedHrefs()).toEqual([]);
    },
  );

  it.each(["/", "/explore", "/fortune", "/reviews", "/design"])(
    "%s 에서는 명조 스타일시트를 주입한다",
    (pathname) => {
      ensureSerifWebFontForRoute(pathname, document);
      expect(injectedHrefs()).toEqual([SERIF_WEBFONT_CSS2_URL]);
    },
  );

  it("반복 호출해도 <link> 는 하나만 남는다(멱등)", () => {
    ensureSerifWebFontForRoute("/", document);
    ensureSerifWebFontForRoute("/explore", document);
    ensureSerifWebFontForRoute("/", document);
    expect(injectedHrefs()).toHaveLength(1);
  });

  it("스튜디오 전용 글꼴은 이 스타일시트에 섞이지 않는다", () => {
    // 명조만 담아야 index.html 에서 뺀 만큼이 그대로 지연 로드로 옮겨진다.
    expect(SERIF_WEBFONT_CSS2_URL).toContain("family=Nanum+Myeongjo:wght@400;700");
    expect(SERIF_WEBFONT_CSS2_URL).toContain("display=swap");
    for (const studioOnly of ["Black+Han+Sans", "Jua", "Gaegu", "Space+Grotesk"]) {
      expect(SERIF_WEBFONT_CSS2_URL).not.toContain(studioOnly);
    }
  });
});
