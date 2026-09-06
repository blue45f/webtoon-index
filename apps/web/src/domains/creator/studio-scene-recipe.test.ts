import { describe, expect, it } from "vitest";

import {
  diagnoseStudioSceneRecipe,
  normalizeStudioSceneRecipe,
  resolveStudioSceneShot,
  resolveStudioSceneRecipeShots,
  STUDIO_SCENE_RECIPE_VERSION,
  type StudioSceneRecipe,
} from "./studio-scene-recipe";

function makeRecipe(): StudioSceneRecipe {
  return {
    version: STUDIO_SCENE_RECIPE_VERSION,
    id: "recipe-1",
    name: "옥상 추격전",
    setRef: "set-rooftop",
    cast: [
      { id: "hero", characterRef: "char-hero", expressionRef: "expr-angry", poseRef: "pose-run" },
      { id: "rival", characterRef: "char-rival" },
    ],
    defaultCamera: { angle: "three-quarter", zoom: 1 },
    defaultLighting: "golden-hour",
    shots: [
      { id: "shot-1" },
      {
        id: "shot-2",
        label: "난간 앞 대치",
        characterSlotOverrides: {
          hero: { expressionRef: "expr-shock", poseRef: "pose-skid" },
        },
        camera: { angle: "low", zoom: 1.5 },
        lighting: "night",
        effects: [{ id: "fx-1", effectRef: "fx-speedlines", intensity: 0.8 }],
        beatRefs: ["beat-line", "beat-turn"],
      },
      {
        id: "shot-3",
        characterSlotOverrides: {
          ghost: { poseRef: "pose-float" },
        },
        effects: [{ id: "fx-2", effectRef: "fx-glow", intensity: 1.5 }],
      },
    ],
  };
}

describe("normalizeStudioSceneRecipe", () => {
  it("누락된 컷 필드를 기본형으로 정규화하고 원본을 보존한다", () => {
    const recipe = makeRecipe();
    const normalized = normalizeStudioSceneRecipe(recipe);
    expect(normalized.version).toBe(STUDIO_SCENE_RECIPE_VERSION);
    expect(normalized.shots[0]).toBeDefined();
    expect(normalized.shots[0]!.effects).toEqual([]);
    expect(normalized.shots[0]!.beatRefs).toEqual([]);
    expect(normalized.defaultCamera.zoom).toBe(1);
    // 비파괴 — 원본 shot에는 effects 배열이 없다.
    expect(recipe.shots[0]!.effects).toBeUndefined();
  });

  it("카메라 줌과 효과 강도를 범위로 고정한다", () => {
    const recipe = normalizeStudioSceneRecipe({
      ...makeRecipe(),
      defaultCamera: { angle: "front", zoom: 99 },
    });
    expect(recipe.defaultCamera.zoom).toBe(4);
    const shot = recipe.shots[2]!;
    expect(shot.effects?.[0]?.intensity).toBe(1);
  });

  it("슬롯·컷 상한을 잘라낸다", () => {
    const cast = Array.from({ length: 30 }, (_, i) => ({ id: `slot-${i}` }));
    const shots = Array.from({ length: 700 }, (_, i) => ({ id: `shot-${i}` }));
    const normalized = normalizeStudioSceneRecipe({
      ...makeRecipe(),
      cast,
      shots,
    });
    expect(normalized.cast.length).toBe(12);
    expect(normalized.shots.length).toBe(512);
  });
});

describe("resolveStudioSceneShot", () => {
  it("오버라이드 없는 컷은 레시피 기본값으로 확정된다", () => {
    const recipe = makeRecipe();
    const resolved = resolveStudioSceneShot(recipe, recipe.shots[0]!);
    expect(resolved.cast.map((slot) => slot.id)).toEqual(["hero", "rival"]);
    expect(resolved.camera).toEqual({ angle: "three-quarter", zoom: 1 });
    expect(resolved.lighting).toBe("golden-hour");
  });

  it("슬롯 오버라이드는 해당 슬롯만 부분 병합한다", () => {
    const recipe = makeRecipe();
    const resolved = resolveStudioSceneShot(recipe, recipe.shots[1]!);
    const hero = resolved.cast.find((slot) => slot.id === "hero");
    const rival = resolved.cast.find((slot) => slot.id === "rival");
    expect(hero?.expressionRef).toBe("expr-shock");
    expect(hero?.characterRef).toBe("char-hero");
    expect(rival?.expressionRef).toBeUndefined();
    expect(resolved.camera).toEqual({ angle: "low", zoom: 1.5 });
    expect(resolved.lighting).toBe("night");
    expect(resolved.beatRefs).toEqual(["beat-line", "beat-turn"]);
  });

  it("레시피 전체를 컷 배열로 확정한다", () => {
    const resolved = resolveStudioSceneRecipeShots(makeRecipe());
    expect(resolved.length).toBe(3);
    expect(resolved.every((shot) => Number.isFinite(shot.camera.zoom))).toBe(true);
  });
});

describe("diagnoseStudioSceneRecipe", () => {
  it("카탈로그가 없으면 느슨한 레퍼런스는 오탐하지 않는다", () => {
    const diagnostics = diagnoseStudioSceneRecipe(makeRecipe());
    // 구조 진단(중복·범위·미지 슬롯)은 카탈로그와 무관하게 유지된다.
    expect(diagnostics.map((d) => d.code).filter((code) => code.startsWith("dangling-")))
      .toEqual([]);
  });

  it("컷 오버라이드의 존재하지 않는 슬롯과 범위 밖 강도를 진단한다", () => {
    const diagnostics = diagnoseStudioSceneRecipe(makeRecipe());
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("unknown-slot-override");
    expect(codes).toContain("invalid-number");
    const unknown = diagnostics.find((d) => d.code === "unknown-slot-override");
    expect(unknown?.shotId).toBe("shot-3");
    expect(unknown?.slotId).toBe("ghost");
  });

  it("주입된 카탈로그로 dangling 레퍼런스를 찾는다", () => {
    const diagnostics = diagnoseStudioSceneRecipe(makeRecipe(), {
      characters: new Set(["char-hero"]),
      sets: new Set(["set-rooftop"]),
      beats: new Set(["beat-line"]),
    });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("dangling-character-ref"); // char-rival
    expect(codes).toContain("dangling-beat-ref"); // beat-turn
    expect(codes).not.toContain("dangling-set-ref");
  });

  it("중복 슬롯·컷 id를 진단한다", () => {
    const recipe: StudioSceneRecipe = {
      ...makeRecipe(),
      cast: [{ id: "dup" }, { id: "dup" }],
      shots: [{ id: "s" }, { id: "s" }],
    };
    const codes = diagnoseStudioSceneRecipe(recipe).map((d) => d.code);
    expect(codes.filter((code) => code === "duplicate-id").length).toBe(2);
  });

  it("진단 상한을 지킨다", () => {
    const shots = Array.from({ length: 600 }, (_, i) => ({
      id: `shot-${i}`,
      characterSlotOverrides: { ghost: {} },
    }));
    const diagnostics = diagnoseStudioSceneRecipe({ ...makeRecipe(), shots });
    expect(diagnostics.length).toBeLessThanOrEqual(256);
  });
});
