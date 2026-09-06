import { describe, it, expect } from "vitest";

import {
  WEBTOON_WIDTH_STANDARDS,
  episodeLengthLabel,
  safeAreaMargin,
  webtoonWidthGuides,
} from "./studio-webtoon-guides";

describe("webtoonWidthGuides", () => {
  it("표준폭보다 좁은 캔버스는 가이드 없음", () => {
    const minWidth = Math.min(...WEBTOON_WIDTH_STANDARDS.map((s) => s.width));
    expect(webtoonWidthGuides(minWidth - 1)).toEqual([]);
  });

  it("0/음수 캔버스폭은 []", () => {
    expect(webtoonWidthGuides(0)).toEqual([]);
    expect(webtoonWidthGuides(-100)).toEqual([]);
  });

  it("표준폭과 정확히 같으면 좌(0)·우(width) 가이드", () => {
    const guides = webtoonWidthGuides(690); // 네이버 690만 들어맞음
    const positions = guides.map((g) => g.pos).sort((a, b) => a - b);
    expect(positions).toContain(0);
    expect(positions).toContain(690);
  });

  it("캔버스 720에서 690/720 두 표준폭의 가이드를 만든다", () => {
    const guides = webtoonWidthGuides(720);
    // 720 표준(카카오)은 좌0/우720, 690(네이버)은 좌15/우705
    const positions = guides.map((g) => g.pos);
    expect(positions).toContain(0);
    expect(positions).toContain(720);
    expect(positions).toContain(15);
    expect(positions).toContain(705);
    // 모든 가이드는 x축
    expect(guides.every((g) => g.axis === "x")).toBe(true);
    // 라벨에 폭이 들어간다
    expect(guides.some((g) => g.label.includes("690"))).toBe(true);
  });

  it("같은 pos는 중복 제거된다", () => {
    const guides = webtoonWidthGuides(800);
    const positions = guides.map((g) => g.pos);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe("safeAreaMargin", () => {
  it("약 6%, 좌우 대칭", () => {
    const m = safeAreaMargin(1000);
    expect(m.left).toBe(60);
    expect(m.right).toBe(60);
  });

  it("좁은 캔버스는 최소 24px로 클램프", () => {
    const m = safeAreaMargin(200); // 6% = 12 < 24
    expect(m.left).toBe(24);
    expect(m.right).toBe(24);
  });

  it("0/음수는 0 여백", () => {
    expect(safeAreaMargin(0)).toEqual({ left: 0, right: 0 });
    expect(safeAreaMargin(-5)).toEqual({ left: 0, right: 0 });
  });
});

describe("episodeLengthLabel", () => {
  it("빈 작업(0/음수)은 비어 있음·짧음", () => {
    expect(episodeLengthLabel(0)).toEqual({ screens: 0, label: "비어 있음", tier: "짧음" });
    expect(episodeLengthLabel(-100)).toEqual({ screens: 0, label: "비어 있음", tier: "짧음" });
  });

  it("스크롤 수는 올림", () => {
    expect(episodeLengthLabel(1300, 1280).screens).toBe(2);
    expect(episodeLengthLabel(1280, 1280).screens).toBe(1);
  });

  it("등급 경계: 3 짧음, 4 보통, 8 보통, 9 넉넉, 16 넉넉, 17 긺", () => {
    expect(episodeLengthLabel(3 * 1280, 1280).tier).toBe("짧음");
    expect(episodeLengthLabel(4 * 1280, 1280).tier).toBe("보통");
    expect(episodeLengthLabel(8 * 1280, 1280).tier).toBe("보통");
    expect(episodeLengthLabel(9 * 1280, 1280).tier).toBe("넉넉");
    expect(episodeLengthLabel(16 * 1280, 1280).tier).toBe("넉넉");
    expect(episodeLengthLabel(17 * 1280, 1280).tier).toBe("긺");
  });

  it("라벨 형식 '약 N스크롤 분량'", () => {
    expect(episodeLengthLabel(2560, 1280).label).toBe("약 2스크롤 분량");
  });

  it("뷰포트 0/음수는 기본 1280으로 간주", () => {
    expect(episodeLengthLabel(2560, 0).screens).toBe(2);
    expect(episodeLengthLabel(2560, -10).screens).toBe(2);
  });
});
