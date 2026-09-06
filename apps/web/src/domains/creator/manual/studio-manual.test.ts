import { describe, expect, it } from "vitest";

import { MANUAL_ARTICLES, MANUAL_CATEGORIES, MANUAL_SHORTCUTS } from "./studio-manual-data";
import { findManualArticle, MANUAL_QUERY_LIMIT, manualArticleHref, normalizeManualSearch, searchManual } from "./studio-manual-search";

const ids = MANUAL_ARTICLES.map((article) => article.id);

describe("Studio user manual content", () => {
  it("has unique, stable article IDs and six populated categories", () => {
    expect(MANUAL_ARTICLES).toHaveLength(14);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MANUAL_CATEGORIES).toHaveLength(6);
    for (const article of MANUAL_ARTICLES) {
      expect(article.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(MANUAL_CATEGORIES.some((category) => category.id === article.category)).toBe(true);
      expect(article.summary.length).toBeGreaterThan(20);
      expect(article.sections.length).toBeGreaterThanOrEqual(3);
      expect(new Set(article.sections.map((section) => section.id)).size).toBe(article.sections.length);
      for (const section of article.sections) {
        expect(section.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
        expect(section.paragraphs.length + (section.steps?.length ?? 0)).toBeGreaterThan(0);
      }
    }
    for (const category of MANUAL_CATEGORIES) {
      expect(MANUAL_ARTICLES.some((article) => article.category === category.id)).toBe(true);
    }
  });

  it("contains no dangling or self-referencing related links", () => {
    for (const article of MANUAL_ARTICLES) {
      for (const related of article.related) {
        expect(ids).toContain(related);
        expect(related).not.toBe(article.id);
      }
    }
  });

  it("links only to existing Studio workspace paths", () => {
    const paths = ["/studio", "/studio/brushes", "/studio/comic", "/studio/character", "/studio/bg3d", "/studio/publish"];
    for (const article of MANUAL_ARTICLES) expect(paths).toContain(article.workspace);
  });

  it("includes backup limits and does not promise automatic recovery", () => {
    const recovery = findManualArticle("save-recovery");
    expect(JSON.stringify(recovery)).toContain("이미지 파일만으로는");
    expect(JSON.stringify(recovery)).toContain("사이트 데이터 삭제");
    expect(JSON.stringify(findManualArticle("troubleshooting"))).toContain("자동으로 실행하지 않습니다");
  });

  it("documents shortcut defaults without claiming to read a live user keymap", () => {
    expect(MANUAL_SHORTCUTS).toHaveLength(14);
    expect(JSON.stringify(findManualArticle("shortcuts"))).toContain("사용자 지정 키맵을 읽거나 변경하지 않습니다");
  });
});

describe("Studio manual search and URLs", () => {
  it("returns all documents for an empty or whitespace query", () => {
    expect(searchManual("")).toEqual(MANUAL_ARTICLES);
    expect(searchManual("   \n\t ")).toEqual(MANUAL_ARTICLES);
  });
  it("ranks Korean and familiar product aliases above incidental body mentions", () => {
    expect(searchManual("스머지")[0]?.id).toBe("brushes");
    expect(searchManual("스머지").map((article) => article.id)).toContain("shortcuts");
    expect(searchManual("bucket")[0]?.id).toBe("selection-fill");
    expect(searchManual("BACKUP")[0]?.id).toBe("save-recovery");
  });
  it("normalizes full-width and decomposed characters", () => {
    expect(searchManual("ＰＮＧ")[0]?.id).toBe("export");
    expect(normalizeManualSearch("  브러시  ".normalize("NFD"))).toBe("브러시");
  });
  it("matches all tokens and respects category filters", () => {
    expect(searchManual("브러시 지우개")[0]?.id).toBe("brushes");
    expect(searchManual("", "three").map((article) => article.id)).toEqual(["character-3d", "background-3d"]);
    expect(searchManual("스머지", "three")).toEqual([]);
    expect(searchManual("", "unknown-category")).toEqual([]);
  });
  it("treats regex and markup as literal text", () => {
    expect(searchManual("(a+)+$")).toEqual([]);
    expect(searchManual("<script>alert(1)</script>")).toEqual([]);
    expect(() => searchManual("[")).not.toThrow();
  });
  it("bounds the input and returns a deterministic order", () => {
    expect(searchManual(" ".repeat(MANUAL_QUERY_LIMIT) + "not-in-the-manual")).toEqual(MANUAL_ARTICLES);
    expect(searchManual("3D")).toEqual(searchManual("3D"));
  });
  it("encodes segments and safely rejects unknown documents", () => {
    expect(manualArticleHref("save-recovery")).toBe("/studio/manual/save-recovery");
    expect(manualArticleHref("../x?y#z")).toBe("/studio/manual/..%2Fx%3Fy%23z");
    expect(findManualArticle(undefined)).toBeUndefined();
    expect(findManualArticle("not-a-document")).toBeUndefined();
  });
});
