import { describe, expect, it } from "vitest";

import {
  EMERES_CATEGORIES,
  EMERES_DEFAULT_OPACITY,
  EMERES_TEMPLATES,
  emeresSections,
} from "./studio-emeres-templates";

describe("이메레스 스케치 템플릿 스키마", () => {
  it("provides at least 20 templates with unique ids", () => {
    expect(EMERES_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    const ids = EMERES_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every template self-contained (procedural inline SVG, 외부 URL 금지)", () => {
    for (const t of EMERES_TEMPLATES) {
      expect(t.svg.startsWith("<svg")).toBe(true);
      expect(t.svg.endsWith("</svg>")).toBe(true);
      expect(t.svg.length).toBeGreaterThan(120);
      expect(t.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      // 외부 참조/래스터/스크립트 금지(xmlns 네임스페이스 선언 제외)
      const withoutXmlns = t.svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
      expect(withoutXmlns).not.toMatch(/https?:\/\//);
      expect(withoutXmlns).not.toMatch(/<image|<script|url\(|href/i);
    }
  });

  it("declares width/height matching the SVG viewBox", () => {
    for (const t of EMERES_TEMPLATES) {
      const match = t.svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      expect(match, `${t.id} viewBox`).not.toBeNull();
      expect(Number(match![1])).toBe(t.width);
      expect(Number(match![2])).toBe(t.height);
    }
  });

  it("labels every template with a category, Korean label and usage tip", () => {
    for (const t of EMERES_TEMPLATES) {
      expect(EMERES_CATEGORIES).toContain(t.category);
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.tip.trim().length).toBeGreaterThan(5);
    }
  });

  it("covers all four categories with multiple templates each", () => {
    const sections = emeresSections();
    expect(sections.map((s) => s.category)).toEqual([...EMERES_CATEGORIES]);
    for (const section of sections) {
      expect(section.templates.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps sketch geometry inside the viewBox (수치 좌표 검증)", () => {
    for (const t of EMERES_TEMPLATES) {
      // 모든 좌표 속성 값이 캔버스 크기를 과도하게 벗어나지 않는지 샘플 검사
      const coords = [...t.svg.matchAll(/(?:cx|cy|x1|x2|y1|y2|x|y)="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
      expect(coords.length).toBeGreaterThan(0);
      const maxAllowed = Math.max(t.width, t.height) * 1.05;
      for (const value of coords) {
        expect(value).toBeGreaterThanOrEqual(-40);
        expect(value).toBeLessThanOrEqual(maxAllowed);
      }
    }
  });

  it("exposes a translucent default opacity for underlay insertion", () => {
    expect(EMERES_DEFAULT_OPACITY).toBeGreaterThan(0.1);
    expect(EMERES_DEFAULT_OPACITY).toBeLessThan(0.8);
  });

  it("filters sections by provided template subset", () => {
    const onlyAction = emeresSections(EMERES_TEMPLATES.filter((t) => t.category === "액션"));
    expect(onlyAction).toHaveLength(1);
    expect(onlyAction[0]!.category).toBe("액션");
  });
});
