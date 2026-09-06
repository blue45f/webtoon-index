import {
  assembleComipoPage,
  type ComipoAssemblyInput,
  type ComipoAssemblyResult,
} from "../studio-comipo-assembly";
import { parseDialogueScript } from "../studio-dialogue";
import { PANEL_LAYOUTS, type PanelLayoutPreset } from "../studio-panel-layouts";
import { EXPRESSION_PRESETS, EXTRA_POSE_PRESETS, NATURAL_IDLE_POSES } from "../studio-pose-presets";
import {
  diagnoseStudioSceneRecipe,
  STUDIO_SCENE_RECIPE_VERSION,
  type StudioSceneRecipe,
  type StudioSceneRecipeDiagnostic,
  type StudioSceneRecipeReferenceCatalog,
  type StudioSceneCharacterSlot,
} from "../studio-scene-recipe";
import { SCENE_TEMPLATES, type SceneTemplate } from "../studio-scene-templates";

export const QUICK_COMIC_STEPS = [
  { id: "layout", label: "컷 레이아웃" },
  { id: "scene", label: "장면" },
  { id: "dialogue", label: "대사" },
  { id: "review", label: "미리보기" },
] as const;

export type QuickComicStepId = (typeof QUICK_COMIC_STEPS)[number]["id"];

export interface QuickComicDraft {
  layoutId: string;
  sceneTemplateId: string | null;
  sceneFrameIndex: number;
  dialogueScript: string;
  /**
   * 캐릭터 슬롯 — 기능 갭 감사의 "Quick Comic 캐릭터·표정·포즈 선택" 축.
   * 레퍼런스는 프리셋 id 문자열이며 비어 있으면 기존 동작과 동일하다.
   */
  cast?: readonly StudioSceneCharacterSlot[];
}

export interface QuickComicPreview {
  input: ComipoAssemblyInput;
  layout: PanelLayoutPreset;
  scene: SceneTemplate | null;
  dialogueCount: number;
  assembly: ComipoAssemblyResult;
}

const PREFERRED_LAYOUT_ID = "layout_two_rows";

export function createQuickComicDraft(): QuickComicDraft {
  return {
    layoutId:
      PANEL_LAYOUTS.find((layout) => layout.id === PREFERRED_LAYOUT_ID)?.id
      ?? PANEL_LAYOUTS[0]?.id
      ?? "",
    sceneTemplateId: null,
    sceneFrameIndex: 0,
    dialogueScript: "",
  };
}

export function clampQuickComicStep(step: number): number {
  return Math.min(Math.max(Math.trunc(step), 0), QUICK_COMIC_STEPS.length - 1);
}

export function createQuickComicInput(draft: QuickComicDraft): ComipoAssemblyInput | null {
  const layout = PANEL_LAYOUTS.find((candidate) => candidate.id === draft.layoutId);
  if (!layout) return null;

  const scene = draft.sceneTemplateId
    ? SCENE_TEMPLATES.find((candidate) => candidate.id === draft.sceneTemplateId)
    : null;
  if (draft.sceneTemplateId && !scene) return null;

  const dialogueScript = draft.dialogueScript.trim();
  const sceneFrameIndex = Math.min(
    Math.max(Math.trunc(draft.sceneFrameIndex), 0),
    Math.max(0, layout.frames.length - 1)
  );

  return {
    layoutId: layout.id,
    ...(scene
      ? {
          sceneTemplateId: scene.id,
          sceneFrameIndex,
        }
      : {}),
    ...(dialogueScript ? { dialogueScript } : {}),
  };
}

export function createQuickComicPreview(draft: QuickComicDraft): QuickComicPreview | null {
  const input = createQuickComicInput(draft);
  if (!input) return null;

  const layout = PANEL_LAYOUTS.find((candidate) => candidate.id === input.layoutId);
  if (!layout) return null;
  const scene = input.sceneTemplateId
    ? SCENE_TEMPLATES.find((candidate) => candidate.id === input.sceneTemplateId) ?? null
    : null;
  const assembly = assembleComipoPage(input);
  if (!assembly) return null;

  return {
    input,
    layout,
    scene,
    dialogueCount: input.dialogueScript ? parseDialogueScript(input.dialogueScript).length : 0,
    assembly,
  };
}

/** Quick Comic이 선택 가능한 레퍼런스 카탈로그 — 씬 템플릿·포즈·표정 프리셋 id. */
export function quickComicRecipeReferenceCatalog(): StudioSceneRecipeReferenceCatalog {
  return {
    sets: new Set(SCENE_TEMPLATES.map((template) => template.id)),
    poses: new Set(
      [...NATURAL_IDLE_POSES, ...EXTRA_POSE_PRESETS].map((preset) => preset.id),
    ),
    expressions: new Set(EXPRESSION_PRESETS.map((preset) => preset.id)),
  };
}

/**
 * 퀵 코믹 드래프트 → Scene Recipe. 레이아웃 프레임 1개 = 컷(shot) 1개로 사상하고
 * 캐스트·세트는 드래프트 값을 정규화해 그대로 옮긴다. 레이아웃이 유효하지 않으면
 * null — 호출부는 기존 preview 경로와 같은 실패 의미를 쓴다.
 */
export function createQuickComicSceneRecipe(
  draft: QuickComicDraft,
): StudioSceneRecipe | null {
  const layout = PANEL_LAYOUTS.find((candidate) => candidate.id === draft.layoutId);
  if (!layout) return null;
  const cast = (draft.cast ?? []).slice(0, 12);
  return {
    version: STUDIO_SCENE_RECIPE_VERSION,
    id: `quick-comic-${layout.id}`,
    name: layout.label,
    ...(draft.sceneTemplateId ? { setRef: draft.sceneTemplateId } : {}),
    cast,
    defaultCamera: { angle: "front", zoom: 1 },
    defaultLighting: "day",
    shots: layout.frames.map((frame, index) => ({
      id: `${layout.id}-frame-${index + 1}`,
      label: `컷 ${index + 1}`,
      camera: {
        angle: index % 2 === 1 ? ("three-quarter" as const) : ("front" as const),
        zoom: 1,
      },
      effects: [],
      beatRefs: [],
    })),
  };
}

/** 레시피 진단 중 Quick Comic이 즉시 고칠 수 있는 것(dangling 레퍼런스)만 돌려준다. */
export function diagnoseQuickComicSceneRecipe(
  draft: QuickComicDraft,
): readonly StudioSceneRecipeDiagnostic[] {
  const recipe = createQuickComicSceneRecipe(draft);
  if (!recipe) return [];
  return diagnoseStudioSceneRecipe(recipe, quickComicRecipeReferenceCatalog());
}
