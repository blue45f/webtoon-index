import { describe, expect, it } from "vitest";

import { PANEL_LAYOUTS } from "../studio-panel-layouts";
import { NATURAL_IDLE_POSES } from "../studio-pose-presets";
import { SCENE_TEMPLATES } from "../studio-scene-templates";

import {
  clampQuickComicStep,
  createQuickComicDraft,
  createQuickComicInput,
  createQuickComicPreview,
  createQuickComicSceneRecipe,
  diagnoseQuickComicSceneRecipe,
  QUICK_COMIC_STEPS,
  quickComicRecipeReferenceCatalog,
} from "./studio-quick-comic-plan";

describe("studio quick comic plan", () => {
  it("starts with a valid, useful layout and no pretend character or scene", () => {
    const draft = createQuickComicDraft();

    expect(PANEL_LAYOUTS.some((layout) => layout.id === draft.layoutId)).toBe(true);
    expect(draft.sceneTemplateId).toBeNull();
    expect(draft.dialogueScript).toBe("");
  });

  it("normalizes optional fields and clamps the scene target to a real frame", () => {
    const layout = PANEL_LAYOUTS.find((candidate) => candidate.frames.length >= 2)!;
    const scene = SCENE_TEMPLATES[0]!;
    const input = createQuickComicInput({
      layoutId: layout.id,
      sceneTemplateId: scene.id,
      sceneFrameIndex: 999,
      dialogueScript: "  하나: 안녕\n둘: 반가워  ",
    });

    expect(input).toEqual({
      layoutId: layout.id,
      sceneTemplateId: scene.id,
      sceneFrameIndex: layout.frames.length - 1,
      dialogueScript: "하나: 안녕\n둘: 반가워",
    });
  });

  it("omits empty optional fields and rejects unknown catalog ids", () => {
    const draft = createQuickComicDraft();

    expect(createQuickComicInput(draft)).toEqual({ layoutId: draft.layoutId });
    expect(createQuickComicInput({ ...draft, layoutId: "missing-layout" })).toBeNull();
    expect(createQuickComicInput({ ...draft, sceneTemplateId: "missing-scene" })).toBeNull();
  });

  it("previews through the shipped assembler and reports the composed result", () => {
    const draft = createQuickComicDraft();
    const preview = createQuickComicPreview({
      ...draft,
      sceneTemplateId: SCENE_TEMPLATES[0]!.id,
      dialogueScript: "민수: 안녕\n\n[잠시 후]\n지영: 반가워",
    });

    expect(preview).not.toBeNull();
    expect(preview!.assembly.frameCount).toBe(preview!.layout.frames.length);
    expect(preview!.assembly.seeds.length).toBeGreaterThan(preview!.assembly.frameCount);
    expect(preview!.dialogueCount).toBe(3);
    expect(preview!.input).toMatchObject({
      layoutId: draft.layoutId,
      sceneTemplateId: SCENE_TEMPLATES[0]!.id,
    });
  });

  it("keeps step movement inside the four-step contract", () => {
    expect(QUICK_COMIC_STEPS.map((step) => step.id)).toEqual([
      "layout",
      "scene",
      "dialogue",
      "review",
    ]);
    expect(clampQuickComicStep(-3)).toBe(0);
    expect(clampQuickComicStep(2.8)).toBe(2);
    expect(clampQuickComicStep(99)).toBe(3);
  });

  it("레이아웃 프레임 1개를 Scene Recipe 컷 1개로 사상한다", () => {
    const layout = PANEL_LAYOUTS.find((candidate) => candidate.frames.length >= 3)!;
    const recipe = createQuickComicSceneRecipe({
      ...createQuickComicDraft(),
      layoutId: layout.id,
      sceneTemplateId: SCENE_TEMPLATES[0]!.id,
      cast: [{ id: "hero", expressionRef: "xf_joy", poseRef: NATURAL_IDLE_POSES[0]!.id }],
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.shots.length).toBe(layout.frames.length);
    expect(recipe!.shots[0]!.id).toBe(`${layout.id}-frame-1`);
    expect(recipe!.setRef).toBe(SCENE_TEMPLATES[0]!.id);
    expect(recipe!.cast[0]!.expressionRef).toBe("xf_joy");
  });

  it("유효하지 않은 레이아웃이면 레시피를 만들지 않는다", () => {
    expect(createQuickComicSceneRecipe({
      ...createQuickComicDraft(),
      layoutId: "no-such-layout",
    })).toBeNull();
  });

  it("실제 프리셋 카탈로그로 dangling 레퍼런스를 진단한다", () => {
    const catalog = quickComicRecipeReferenceCatalog();
    expect(catalog.expressions?.has("xf_joy")).toBe(true);
    const diagnostics = diagnoseQuickComicSceneRecipe({
      ...createQuickComicDraft(),
      cast: [
        { id: "hero", expressionRef: "xf_joy" },
        { id: "rival", poseRef: "pose-no-such" },
      ],
    });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("dangling-pose-ref");
    expect(codes).not.toContain("dangling-expression-ref");
  });
});
