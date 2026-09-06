import { describe, expect, it } from "vitest";

import { SFX_LEXICON_DATABASE } from "./assistant/webtoon-sfx-lexicon";
import { studioSfxLetteringStyle } from "./studio-sfx-lettering";

describe("studioSfxLetteringStyle", () => {
  it("글리프 색과 외곽선을 한 쌍으로 돌려준다", () => {
    expect(studioSfxLetteringStyle({ recommendedColor: "#ffffff", strokeColor: "#dc2626" })).toEqual(
      {
        color: "#ffffff",
        textShadow: "0 0 1px #dc2626, 1px 1px 0 #dc2626",
      }
    );
  });

  it("카탈로그의 흰색 글리프도 반드시 외곽선을 얻는다", () => {
    // 외곽선 없이 흰 글자를 칠하면 라이트 테마의 bg-card 위에서 그대로 사라진다.
    const whiteGlyphs = SFX_LEXICON_DATABASE.filter(
      (item) => item.recommendedColor.toLowerCase() === "#ffffff"
    );
    expect(whiteGlyphs.length).toBeGreaterThan(0);

    for (const item of whiteGlyphs) {
      const style = studioSfxLetteringStyle(item);
      expect(style.textShadow).toContain(item.strokeColor);
      expect(item.strokeColor.toLowerCase()).not.toBe("#ffffff");
    }
  });
});
