import { describe, expect, it } from "vitest";

import {
  emptyTutorialProgress,
  groupStudioFeatureTutorials,
  isTutorialCompleted,
  markTutorialCompleted,
  STUDIO_FEATURE_TUTORIALS,
  STUDIO_FEATURE_TUTORIAL_BY_ID,
  tutorialCompletionRatio,
} from "./studio-feature-tutorials";

describe("studio-feature-tutorials catalog", () => {
  it("튜토리얼 id 가 유일하다", () => {
    const ids = STUDIO_FEATURE_TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 튜토리얼에 단계·요약이 있다", () => {
    for (const t of STUDIO_FEATURE_TUTORIALS) {
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.summary.trim().length).toBeGreaterThan(0);
      expect(t.steps.length).toBeGreaterThanOrEqual(2);
      for (const s of t.steps) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("맵과 그룹핑이 카탈로그와 일치한다", () => {
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.size).toBe(STUDIO_FEATURE_TUTORIALS.length);
    const groups = groupStudioFeatureTutorials();
    const flat = groups.flatMap((g) => g.items);
    expect(flat).toHaveLength(STUDIO_FEATURE_TUTORIALS.length);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("smart-shape·bubble 등 핵심 기능이 포함된다", () => {
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.has("smart-shape")).toBe(true);
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.has("bubble")).toBe(true);
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.has("pen")).toBe(true);
  });

  it("신규 도구 웨이브(보정·선택 등) 튜토리얼이 포함된다", () => {
    const newIds = [
      "smudge",
      "wet-mix",
      "dual-brush",
      "sketch-shape",
      "special-rulers",
      "dodge-burn",
      "liquify",
      "quick-mask",
      "color-range",
      "path-boolean",
      "mannequin",
      "room-builder",
      "gif-export",
    ];
    for (const id of newIds) {
      expect(STUDIO_FEATURE_TUTORIAL_BY_ID.has(id), `missing tutorial: ${id}`).toBe(true);
    }
    expect(STUDIO_FEATURE_TUTORIALS.length).toBe(33);
  });

  it("자주 막히는 기본 작업 8종을 행동 중심 3단계로 안내하고 가짜 실행 버튼을 만들지 않는다", () => {
    const workflowIds = [
      "canvas-view",
      "select-move-group",
      "eraser",
      "fill",
      "filters",
      "asset-drop",
      "comment-collaboration",
      "save-recovery",
    ] as const;

    for (const id of workflowIds) {
      const tutorial = STUDIO_FEATURE_TUTORIAL_BY_ID.get(id);
      expect(tutorial, `missing workflow tutorial: ${id}`).toBeDefined();
      expect(tutorial?.steps).toHaveLength(3);
      expect(tutorial?.tryAction, `unwired tutorial must stay explanatory: ${id}`).toBeUndefined();
    }

    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("canvas-view")?.steps[2]?.body).toContain("배율 잠금");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("select-move-group")?.steps[2]?.body).toContain("그룹 잠금");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("fill")?.steps[0]?.body).toContain("편집용 이미지 복사본");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("filters")?.steps[0]?.body).toContain("편집용 이미지 복사본");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("save-recovery")?.steps[1]?.body).toContain("revision");
  });

  it("래스터 리터치 4종은 쉬운 행동 이름·자동 편집 복사본·3단계 실행취소를 안내한다", () => {
    for (const id of ["smudge", "wet-mix", "dodge-burn", "liquify"]) {
      const tutorial = STUDIO_FEATURE_TUTORIAL_BY_ID.get(id);
      expect(tutorial, `missing retouch tutorial: ${id}`).toBeDefined();
      expect(tutorial?.steps).toHaveLength(3);
      expect(tutorial?.steps[0]?.body).toContain("직접 그린 벡터 선·도형");
      expect(tutorial?.steps[0]?.body).toContain("편집용 이미지 복사본을 자동");
      expect(tutorial?.steps[2]?.body).toContain("⌘Z");
    }

    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("smudge")?.title).toContain("색 밀어 섞기");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("wet-mix")?.title).toContain("물감 섞어 칠하기");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("dodge-burn")?.title).toContain("밝기·채도 붓");
    expect(STUDIO_FEATURE_TUTORIAL_BY_ID.get("liquify")?.title).toContain("형태 밀어 변형");
  });

  it("배지는 1~2자, tryAction 은 StudioPage 가 배선한 키만 쓴다", () => {
    // StudioPage.handleTutorialTry 의 switch 분기와 일치해야 하는 키 집합.
    // 새 키를 추가하려면 StudioPage 분기를 먼저 배선한 뒤 이 목록을 갱신한다.
    const wiredTryActions = new Set([
      "pen",
      "smart-shape",
      "bubble",
      "brush",
      "template",
      "layers",
      "character",
      "character-shaper",
      "bg3d",
      "ai-assist",
      "dialogue",
      "export",
      "wet-mix",
      "dodge-burn",
      "quick-mask",
      "mannequin",
      "frame-anim",
    ]);
    for (const t of STUDIO_FEATURE_TUTORIALS) {
      expect(t.badge.length, `badge too long: ${t.id}`).toBeLessThanOrEqual(2);
      if (t.tryAction !== undefined) {
        expect(wiredTryActions.has(t.tryAction), `unwired tryAction on ${t.id}: ${t.tryAction}`).toBe(true);
      }
    }
  });
});

describe("tutorial progress", () => {
  it("완료 표시가 멱등하다", () => {
    let p = emptyTutorialProgress();
    p = markTutorialCompleted(p, "pen");
    p = markTutorialCompleted(p, "pen");
    expect(p.completed).toEqual(["pen"]);
    expect(isTutorialCompleted(p, "pen")).toBe(true);
    expect(isTutorialCompleted(p, "bubble")).toBe(false);
  });

  it("완료 비율을 센다", () => {
    let p = emptyTutorialProgress();
    expect(tutorialCompletionRatio(p)).toEqual({ done: 0, total: STUDIO_FEATURE_TUTORIALS.length });
    p = markTutorialCompleted(p, "pen");
    p = markTutorialCompleted(p, "bubble");
    expect(tutorialCompletionRatio(p).done).toBe(2);
  });
});
