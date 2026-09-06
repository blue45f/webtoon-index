import { describe, it, expect } from "vitest";

import {
  SFX_CATEGORIES,
  SFX_LIBRARY,
  createSfxTextConfig,
  searchSfx,
  sfxByCategory,
} from "./studio-sfx-presets";

describe("SFX_LIBRARY 데이터", () => {
  it("프리셋이 44개 이상이고 id가 유일하다", () => {
    expect(SFX_LIBRARY.length).toBeGreaterThanOrEqual(44);
    const ids = SFX_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^sfx-[a-z0-9-]+$/.test(id))).toBe(true);
  });

  it("모든 프리셋은 실제 카테고리를 참조하고 텍스트가 비어 있지 않다", () => {
    const cats = new Set(SFX_CATEGORIES.map((c) => c.id));
    for (const s of SFX_LIBRARY) {
      expect(cats.has(s.category)).toBe(true);
      expect(s.text.length).toBeGreaterThan(0);
      expect(s.style.fill).toMatch(/^#/);
    }
  });

  it("모든 카테고리에 최소 1개 프리셋이 있다", () => {
    for (const c of SFX_CATEGORIES) {
      expect(sfxByCategory(c.id).length).toBeGreaterThan(0);
    }
  });
});

describe("createSfxTextConfig", () => {
  it("위치·기본 크기·스타일을 펼침-가능 객체로 돌려준다", () => {
    const preset = SFX_LIBRARY[0];
    const cfg = createSfxTextConfig(preset, 100, 200);
    expect(cfg.text).toBe(preset.text);
    expect(cfg.x).toBe(100);
    expect(cfg.y).toBe(200);
    expect(Number.isFinite(cfg.fontSize)).toBe(true);
    expect(cfg.fontSize).toBeGreaterThan(0);
    expect(Number.isFinite(cfg.width)).toBe(true);
    expect(Number.isFinite(cfg.rotation)).toBe(true);
    expect(cfg.fill).toBe(preset.style.fill);
  });

  it("rotation 미지정 스타일은 0으로 채운다", () => {
    const flat = SFX_LIBRARY.find((s) => s.style.rotation === undefined);
    if (flat) {
      expect(createSfxTextConfig(flat, 0, 0).rotation).toBe(0);
    }
    // 회전이 있는 프리셋은 그대로 전달
    const rotated = SFX_LIBRARY.find((s) => typeof s.style.rotation === "number");
    if (rotated) {
      expect(createSfxTextConfig(rotated, 0, 0).rotation).toBe(rotated.style.rotation);
    }
  });
});

describe("searchSfx", () => {
  it("빈 검색어는 전체를 돌려준다", () => {
    expect(searchSfx("")).toHaveLength(SFX_LIBRARY.length);
    expect(searchSfx("   ")).toHaveLength(SFX_LIBRARY.length);
  });

  it("라벨로 검색된다", () => {
    const r = searchSfx("두근");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.label.includes("두근") || s.text.includes("두근"))).toBe(true);
  });

  it("공백을 무시하고 매칭한다", () => {
    expect(searchSfx(" 쾅 ").some((s) => s.text.includes("쾅"))).toBe(true);
  });

  it("한글·영문 용도 키워드와 다중 조건으로 검색한다", () => {
    expect(searchSfx("glass 유리").map((s) => s.id)).toEqual(["sfx-jjaeng"]);
    expect(searchSfx("digital 기계").map((s) => s.id)).toEqual(["sfx-beep"]);
    expect(searchSfx("laugh 웃음").map((s) => s.id)).toEqual(["sfx-hehe"]);
  });

  it("없는 단어는 빈 배열", () => {
    expect(searchSfx("존재하지않는효과음xyz")).toEqual([]);
  });
});
