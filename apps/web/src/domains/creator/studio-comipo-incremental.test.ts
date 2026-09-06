import { describe, expect, it } from "vitest";

import { composeSceneIntoFrame, composeDialogueIntoFrames  } from "./studio-comipo-compose";
import {
  collectStudioDecorRefs,
  dialogueIncomingRefs,
  frameDecorHasNoPairwiseOverlap,
  incrementalPlaceInFrame,
  sceneIncomingRefs,
  studioElToDecorRef,
} from "./studio-comipo-incremental";
import { materializePanelLayout, PANEL_LAYOUTS } from "./studio-panel-layouts";
import { SCENE_TEMPLATES } from "./studio-scene-templates";

describe("studio-comipo-incremental", () => {
  const talkLayout = PANEL_LAYOUTS.find((l) => l.id === "layout_talk_2_bubbles")!;
  const top = talkLayout.frames[0]!;
  const confession = SCENE_TEMPLATES.find((t) => t.id === "confession")!;

  it("addSceneTemplate path: existing layout bubble + scene → layout dropped, no overlap", () => {
    const { seeds } = materializePanelLayout(talkLayout);
    const layoutBubble = seeds.find(
      (s): s is Extract<typeof s, { type: "bubble" }> =>
        s.type === "bubble" && s.y < top.y + top.height
    )!;
    expect(layoutBubble.type).toBe("bubble");

    const existing = [
      studioElToDecorRef(
        {
          id: "layout-bubble-1",
          type: "bubble",
          variant: layoutBubble.variant,
          text: layoutBubble.text,
          x: layoutBubble.x,
          y: layoutBubble.y,
          width: layoutBubble.width,
          height: layoutBubble.height,
          fill: layoutBubble.fill,
          textFill: layoutBubble.textFill,
          rotation: layoutBubble.rotation,
        },
        top
      )!,
    ];

    const incoming = sceneIncomingRefs(composeSceneIntoFrame(confession.build(0, 0), top));
    const result = incrementalPlaceInFrame(top, existing, incoming);

    expect(result.composable).toBe(true);
    expect(result.removedIds).toContain("layout-bubble-1");
    expect(result.addedSeeds.length).toBeGreaterThan(0);
    expect(frameDecorHasNoPairwiseOverlap(top, result.refs.map((r) => r.seed))).toBe(true);
  });

  it("addDialogueBubbles path: existing scene decor + dialogue → composable, no overlap", () => {
    const sceneRefs = sceneIncomingRefs(composeSceneIntoFrame(confession.build(0, 0), top)).map(
      (r, i) => ({ ...r, id: `scene-${i}` })
    );
    const dialogue = composeDialogueIntoFrames("민수: 안녕하세요", [top]);
    const incoming = dialogueIncomingRefs(dialogue);
    const result = incrementalPlaceInFrame(top, sceneRefs, incoming);

    expect(result.composable).toBe(true);
    const finalSeeds = result.refs.map((r) => r.seed);
    expect(frameDecorHasNoPairwiseOverlap(top, finalSeeds)).toBe(true);
    expect(finalSeeds.some((s) => s.type === "bubble" && s.text.includes("안녕"))).toBe(true);
  });

  it("blocks commit when overcrowded frame cannot resolve collisions", () => {
    const bigBubble = {
      type: "bubble" as const,
      variant: "speech" as const,
      text: "긴 대사 A",
      x: top.x + 40,
      y: top.y + 24,
      width: 280,
      height: 400,
      fill: "#fff",
      textFill: "#000",
      rotation: 0,
      tail: "left" as const,
      tailDirection: "bottom" as const,
    };
    const existing = [{ id: "big-1", source: "dialogue" as const, seed: bigBubble }];
    const incoming = dialogueIncomingRefs([
      {
        ...bigBubble,
        text: "긴 대사 B",
        y: top.y + 120,
      },
    ]);
    const result = incrementalPlaceInFrame(top, existing, incoming);
    expect(result.composable).toBe(false);
    expect(result.refs).toHaveLength(0);
  });

  it("collectStudioDecorRefs only returns elements centered in frame", () => {
    const refs = collectStudioDecorRefs(top, [
      {
        id: "in",
        type: "bubble",
        variant: "speech",
        text: "대사를 입력",
        x: top.x + 60,
        y: top.y + 60,
        width: 200,
        height: 90,
        fill: "#fff",
        textFill: "#000",
        rotation: 0,
      },
      {
        id: "out",
        type: "bubble",
        variant: "speech",
        text: "밖",
        x: -300,
        y: -300,
        width: 100,
        height: 80,
        fill: "#fff",
        textFill: "#000",
        rotation: 0,
      },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.id).toBe("in");
  });
});