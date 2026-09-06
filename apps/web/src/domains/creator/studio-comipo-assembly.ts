/**
 * 코미포·툰스푼식 원클릭 조립 — 패널 레이아웃 + 장면 템플릿 + 대사 스크립트를
 * 프레임별 placeDecorInFrame 으로 공간 배치한다.
 */

import {
  composeDialogueIntoFrames,
  composeSceneIntoFrame,
  framesOverlap,
  placeDecorInFrame,
  seedCenterInFrame,
  type DecorSeed,
  type TaggedDecorSeed,
} from "./studio-comipo-compose";
import { materializePanelLayout, PANEL_LAYOUTS, type PanelLayoutElementSeed } from "./studio-panel-layouts";
import { SCENE_TEMPLATES } from "./studio-scene-templates";

export type ComipoAssemblySeed = PanelLayoutElementSeed | DecorSeed;

export interface ComipoAssemblyInput {
  layoutId: string;
  sceneTemplateId?: string;
  /** 장면을 넣을 패널 프레임 인덱스(기본 0 = 첫 컷). */
  sceneFrameIndex?: number;
  dialogueScript?: string;
}

export interface ComipoAssemblyResult {
  canvasH: number;
  frameCount: number;
  bubbleCount: number;
  composable: boolean;
  seeds: ComipoAssemblySeed[];
}

function findLayout(id: string) {
  return PANEL_LAYOUTS.find((layout) => layout.id === id) ?? null;
}

function findSceneTemplate(id: string) {
  return SCENE_TEMPLATES.find((template) => template.id === id) ?? null;
}

function layoutBubbleToTagged(
  bubble: Extract<PanelLayoutElementSeed, { type: "bubble" }>
): TaggedDecorSeed {
  return { source: "layout", seed: bubble };
}

/** 패널·장면·대사를 결합한 원클릭 조립 결과. layoutId 가 없으면 null. */
export function assembleComipoPage(input: ComipoAssemblyInput): ComipoAssemblyResult | null {
  const layout = findLayout(input.layoutId);
  if (!layout) return null;

  const { canvasH, seeds: panelSeeds } = materializePanelLayout(layout);
  const frameSeeds = panelSeeds.filter((s) => s.type === "frame");
  const layoutBubbles = panelSeeds.filter((s) => s.type === "bubble");
  const hasDialogue = Boolean(input.dialogueScript?.trim());

  const scene = input.sceneTemplateId ? findSceneTemplate(input.sceneTemplateId) : null;
  const sceneFrameIndex = scene
    ? Math.min(Math.max(0, input.sceneFrameIndex ?? 0), layout.frames.length - 1)
    : -1;

  const dialogueBubbles = hasDialogue
    ? composeDialogueIntoFrames(input.dialogueScript!, layout.frames)
    : [];

  const decor: DecorSeed[] = [];
  let composable = !framesOverlap(layout.frames);

  for (let i = 0; i < layout.frames.length; i++) {
    const frame = layout.frames[i]!;
    const tagged: TaggedDecorSeed[] = [];

    for (const bubble of layoutBubbles) {
      if (seedCenterInFrame(bubble, frame)) {
        tagged.push(layoutBubbleToTagged(bubble));
      }
    }

    if (scene && i === sceneFrameIndex) {
      const rawScene = scene.build(0, 0);
      const sceneForCompose = hasDialogue
        ? rawScene.filter((s) => s.type !== "frame" && s.type !== "bubble")
        : rawScene.filter((s) => s.type !== "frame");
      for (const seed of composeSceneIntoFrame(sceneForCompose, frame)) {
        tagged.push({ source: "scene", seed });
      }
    }

    for (let lineIdx = 0; lineIdx < dialogueBubbles.length; lineIdx++) {
      if (lineIdx % layout.frames.length !== i) continue;
      const bubble = dialogueBubbles[lineIdx]!;
      tagged.push({ source: "dialogue", seed: bubble });
    }

    const placed = placeDecorInFrame(frame, tagged);
    composable = composable && placed.composable;
    decor.push(...placed.placed);
  }

  const seeds: ComipoAssemblySeed[] = [...frameSeeds, ...decor];
  const frameCount = frameSeeds.length;
  const bubbleCount = seeds.filter((s) => "type" in s && s.type === "bubble").length;

  return { canvasH, frameCount, bubbleCount, composable, seeds };
}