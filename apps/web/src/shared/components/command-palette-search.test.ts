import { describe, expect, it } from "vitest";

import {
  extractChosung,
  isChosungOnly,
  matchesCommandSearch,
} from "./command-palette-search";

describe("command-palette-search", () => {
  describe("extractChosung", () => {
    it("한글 문자열에서 정확히 초성을 추출한다", () => {
      expect(extractChosung("스튜디오")).toBe("ㅅㅌㄷㅇ");
      expect(extractChosung("랭킹")).toBe("ㄹㅋ");
      expect(extractChosung("추천")).toBe("ㅊㅊ");
      expect(extractChosung("비교")).toBe("ㅂㄱ");
      expect(extractChosung("효과음")).toBe("ㅎㄱㅇ");
      expect(extractChosung("로맨스판타지")).toBe("ㄹㅁㅅㅍㅌㅈ");
    });

    it("영문, 숫자, 특수문자는 그대로 보존한다", () => {
      expect(extractChosung("Studio 2D")).toBe("Studio 2D");
      expect(extractChosung("G펜 (B)")).toBe("Gㅍ (B)");
    });
  });

  describe("isChosungOnly", () => {
    it("초성만으로 구성된 검색어를 올바르게 판별한다", () => {
      expect(isChosungOnly("ㅅㅌㄷㅇ")).toBe(true);
      expect(isChosungOnly("ㄹㅋ")).toBe(true);
      expect(isChosungOnly("ㅅㅈ")).toBe(true);
      expect(isChosungOnly("스튜디오")).toBe(false);
      expect(isChosungOnly("studio")).toBe(false);
      expect(isChosungOnly("")).toBe(false);
    });
  });

  describe("matchesCommandSearch", () => {
    it("직접 부분 일치(대소문자 무관)를 검색한다", () => {
      expect(matchesCommandSearch("스튜디오", "스튜")).toBe(true);
      expect(matchesCommandSearch("Studio Page", "studio")).toBe(true);
      expect(matchesCommandSearch("효과음 토글", "효과")).toBe(true);
      expect(matchesCommandSearch("웹툰 랭킹", "소설")).toBe(false);
    });

    it("초성 검색으로 한글 대상을 매칭한다", () => {
      expect(matchesCommandSearch("스튜디오", "ㅅㅌㄷㅇ")).toBe(true);
      expect(matchesCommandSearch("다축 통합 랭킹", "ㄹㅋ")).toBe(true);
      expect(matchesCommandSearch("취향 맞춤 추천", "ㅊㅊ")).toBe(true);
      expect(matchesCommandSearch("작품 1:1 비교 분석", "ㅂㄱ")).toBe(true);
      expect(matchesCommandSearch("내 서재", "ㅅㅈ")).toBe(true);
    });

    it("부제목 및 설명(subtitle)을 검색 대상으로 고려한다", () => {
      expect(
        matchesCommandSearch("효과음", "사운드", undefined, "클릭 사운드 켜기/끄기")
      ).toBe(true);
    });

    it("키워드 및 동의어(keywords) 목록을 검색한다", () => {
      expect(
        matchesCommandSearch("효과음 토글", "sfx", ["소리", "사운드", "sfx", "audio"])
      ).toBe(true);
      expect(
        matchesCommandSearch("G펜", "brush", ["브러시", "선화", "pen", "brush"])
      ).toBe(true);
      expect(
        matchesCommandSearch("새 웹툰 캔버스", "만화", ["만화", "웹툰", "canvas"])
      ).toBe(true);
    });
  });
});
