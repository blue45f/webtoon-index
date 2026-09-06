import { describe, it, expect } from "vitest";

import {
  SCENE_TEMPLATES,
  SCENE_TEMPLATE_CATEGORIES,
  listSceneTemplates,
  type SceneSeed,
} from "./studio-scene-templates";

const ALLOWED_TYPES = new Set(["frame", "bubble", "text", "focusLines", "speedLines"]);
const CANVAS_W = 720;

// 기존 6종 — 다른 모듈 테스트(comipo-*)가 id로 참조하므로 절대 빠지면 안 된다.
const LEGACY_IDS = [
  "confession",
  "action-impact",
  "daily-talk",
  "flashback",
  "tense-closeup",
  "title-cut",
];

// 2026-07 카탈로그 확충 14종 (학원/로맨스/액션/판타지/일상).
const NEW_IDS = [
  "school-classroom",
  "school-hallway",
  "school-rooftop",
  "romance-cafe",
  "romance-rain",
  "romance-fireworks",
  "action-chase",
  "action-standoff",
  "action-awakening",
  "fantasy-throne",
  "fantasy-summon",
  "fantasy-dungeon",
  "daily-morning-rush",
  "daily-overtime",
];

function seedX(seed: SceneSeed): number {
  return seed.x;
}

describe("SCENE_TEMPLATES 데이터", () => {
  it("템플릿이 20개 이상이고 id가 유일하다", () => {
    expect(SCENE_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    const ids = SCENE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("기존 6종 + 신규 14종 id가 전부 존재한다", () => {
    const ids = new Set(SCENE_TEMPLATES.map((t) => t.id));
    for (const id of [...LEGACY_IDS, ...NEW_IDS]) {
      expect(ids.has(id), `missing template id: ${id}`).toBe(true);
    }
  });

  it("comipo 통합 계약: confession이 첫 템플릿으로 유지된다", () => {
    // studio-comipo-assembly.test 등이 SCENE_TEMPLATES[0]을 참조한다.
    expect(SCENE_TEMPLATES[0].id).toBe("confession");
  });

  it("모든 템플릿의 카테고리는 실제 카테고리 목록에 있다", () => {
    const cats = new Set(SCENE_TEMPLATE_CATEGORIES.map((c) => c.id));
    for (const t of SCENE_TEMPLATES) {
      expect(cats.has(t.category), `${t.id}: unknown category ${t.category}`).toBe(true);
    }
  });

  it("모든 카테고리에 템플릿이 1개 이상 있다(빈 UI 섹션 방지)", () => {
    for (const cat of SCENE_TEMPLATE_CATEGORIES) {
      const count = SCENE_TEMPLATES.filter((t) => t.category === cat.id).length;
      expect(count, `empty category: ${cat.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("신규 장르(학원·판타지) 카테고리가 노출 목록에 있다", () => {
    const cats = new Map(SCENE_TEMPLATE_CATEGORIES.map((c) => [c.id, c.label]));
    expect(cats.get("school")).toBe("학원");
    expect(cats.get("fantasy")).toBe("판타지");
  });

  it("label/description은 비어 있지 않다", () => {
    for (const t of SCENE_TEMPLATES) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("build(0,0)은 2개 이상의 시드를 돌려준다", () => {
    for (const t of SCENE_TEMPLATES) {
      expect(t.build(0, 0).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("모든 시드 type은 허용된 종류이고 좌표가 유한·캔버스 폭 안에 있다", () => {
    for (const t of SCENE_TEMPLATES) {
      for (const seed of t.build(0, 0)) {
        expect(ALLOWED_TYPES.has(seed.type)).toBe(true);
        expect(Number.isFinite(seed.x)).toBe(true);
        expect(Number.isFinite(seed.y)).toBe(true);
        expect(seedX(seed)).toBeGreaterThanOrEqual(0);
        expect(seedX(seed)).toBeLessThanOrEqual(CANVAS_W);
      }
    }
  });

  it("가로로 삐져나가지 않는다: 모든 시드의 x+width ≤ 캔버스 폭", () => {
    for (const t of SCENE_TEMPLATES) {
      for (const seed of t.build(0, 0)) {
        expect(seed.width).toBeGreaterThan(0);
        expect(seed.x + seed.width, `${t.id}: ${seed.type} overflows`).toBeLessThanOrEqual(
          CANVAS_W
        );
      }
    }
  });

  it("필수 필드: 말풍선은 variant/fill/textFill, 효과선은 lineCount를 갖는다", () => {
    for (const t of SCENE_TEMPLATES) {
      for (const seed of t.build(0, 0)) {
        if (seed.type === "bubble") {
          expect(typeof seed.variant).toBe("string");
          expect(seed.fill).toMatch(/^#/);
          expect(seed.textFill).toMatch(/^#/);
          expect(typeof seed.rotation).toBe("number");
          expect(seed.text.trim().length).toBeGreaterThan(0);
          expect(seed.height).toBeGreaterThan(0);
        }
        if (seed.type === "focusLines" || seed.type === "speedLines") {
          expect(seed.lineCount).toBeGreaterThan(0);
          expect(seed.strokeWidth).toBeGreaterThan(0);
        }
        if (seed.type === "text") {
          expect(seed.fontSize).toBeGreaterThan(0);
          expect(seed.fill).toMatch(/^#/);
          expect(seed.text.trim().length).toBeGreaterThan(0);
        }
        if (seed.type === "frame") {
          expect(seed.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("origin을 옮기면 모든 템플릿 좌표가 그만큼 평행이동한다(결정성)", () => {
    for (const t of SCENE_TEMPLATES) {
      const base = t.build(0, 0);
      const moved = t.build(100, 50);
      expect(moved.length).toBe(base.length);
      for (let i = 0; i < base.length; i++) {
        expect(moved[i].x).toBe(base[i].x + 100);
        expect(moved[i].y).toBe(base[i].y + 50);
      }
    }
  });
});

describe("listSceneTemplates", () => {
  it("미지정이면 전체", () => {
    expect(listSceneTemplates()).toHaveLength(SCENE_TEMPLATES.length);
  });

  it("카테고리로 거른다", () => {
    const action = listSceneTemplates("action");
    expect(action.length).toBeGreaterThan(0);
    expect(action.every((t) => t.category === "action")).toBe(true);
  });

  it("학원·판타지의 기존 구성과 새 상황별 구성을 모두 반환한다", () => {
    expect(listSceneTemplates("school").map((t) => t.id)).toEqual([
      "school-classroom",
      "school-hallway",
      "school-rooftop",
      "school-exam-silence",
      "school-locker-note",
    ]);
    expect(listSceneTemplates("fantasy").map((t) => t.id)).toEqual([
      "fantasy-throne",
      "fantasy-summon",
      "fantasy-dungeon",
      "fantasy-royal-letter",
      "fantasy-portal-choice",
    ]);
  });

  it("없는 카테고리는 빈 배열", () => {
    expect(listSceneTemplates("nope")).toEqual([]);
  });
});
