import { describe, expect, it } from "vitest";

import { assembleComipoPage } from "./studio-comipo-assembly";
import {
  boundsOverlap,
  seedBounds,
  seedCenterInFrame,
  seedsFitInsideFrame,
} from "./studio-comipo-compose";
import { PANEL_LAYOUTS } from "./studio-panel-layouts";
import { SCENE_TEMPLATES } from "./studio-scene-templates";

describe("assembleComipoPage", () => {
  const talkLayout = PANEL_LAYOUTS.find((item) => item.id === "layout_talk_2_bubbles")!;

  it("scene without dialogue composes into top frame with zero decor collisions", () => {
    const result = assembleComipoPage({
      layoutId: talkLayout.id,
      sceneTemplateId: "confession",
    });
    expect(result).not.toBeNull();
    expect(result!.composable).toBe(true);

    const top = talkLayout.frames[0]!;
    const decor = result!.seeds.filter((s) => s.type !== "frame");
    const topDecor = decor.filter((s) => seedCenterInFrame(s, top));
    expect(topDecor.length).toBeGreaterThan(0);

    for (let i = 0; i < topDecor.length; i++) {
      for (let j = i + 1; j < topDecor.length; j++) {
        expect(boundsOverlap(seedBounds(topDecor[i]!), seedBounds(topDecor[j]!))).toBe(false);
      }
    }
    expect(seedsFitInsideFrame(topDecor, top)).toBe(true);
  });

  it("materializes frames and bubble seeds from a panel layout", () => {
    const result = assembleComipoPage({ layoutId: talkLayout.id });
    expect(result).not.toBeNull();
    expect(result!.frameCount).toBe(talkLayout.frames.length);
    expect(result!.bubbleCount).toBe((talkLayout.bubbles ?? []).length);
    expect(result!.canvasH).toBe(talkLayout.canvasH);
    expect(result!.composable).toBe(true);
  });

  it("composes scene into first frame and dialogue into each frame without overlap", () => {
    const result = assembleComipoPage({
      layoutId: talkLayout.id,
      sceneTemplateId: "confession",
      dialogueScript: "민수: 스튜디오에 오신 걸 환영해요!\n지영: 3D 캐릭터·말풍선을 써 보세요.",
    });
    expect(result).not.toBeNull();
    expect(result!.composable).toBe(true);
    expect(result!.frameCount).toBe(2);

    const frames = result!.seeds.filter((s) => s.type === "frame");
    const decor = result!.seeds.filter((s) => s.type !== "frame");
    expect(frames).toHaveLength(2);

    const top = talkLayout.frames[0]!;
    const bottom = talkLayout.frames[1]!;
    const dialogueBubbles = decor.filter((s) => s.type === "bubble");
    // 장면 placeholder 말풍선은 대사로 대체되어 2개만 남는다.
    expect(dialogueBubbles).toHaveLength(2);
    expect(seedsFitInsideFrame([dialogueBubbles[0]!], top)).toBe(true);
    expect(seedsFitInsideFrame([dialogueBubbles[1]!], bottom)).toBe(true);
    expect(boundsOverlap(seedBounds(dialogueBubbles[0]!), seedBounds(dialogueBubbles[1]!))).toBe(false);

    // 패널 프레임끼리 겹치지 않음
    expect(
      boundsOverlap(
        { x: top.x, y: top.y, w: top.width, h: top.height },
        { x: bottom.x, y: bottom.y, w: bottom.width, h: bottom.height }
      )
    ).toBe(false);

    // 장면 장식(고백 템플릿)은 첫 프레임 안
    const sceneDecor = decor.filter((s) => s.type !== "bubble");
    if (sceneDecor.length > 0) {
      expect(seedsFitInsideFrame(sceneDecor, top)).toBe(true);
    }
  });

  it("integrated composable state for layout_two_rows + scene + dialogue", () => {
    const layoutId = "layout_two_rows";
    const sceneId = SCENE_TEMPLATES[0]!.id;
    const result = assembleComipoPage({
      layoutId,
      sceneTemplateId: sceneId,
      dialogueScript: "민수: 안녕\n지영: 반가워",
    });
    expect(result).not.toBeNull();
    expect(result!.composable).toBe(true);
    expect(result!.frameCount).toBeGreaterThanOrEqual(2);
  });

  it("returns null for unknown layout id", () => {
    expect(assembleComipoPage({ layoutId: "missing-layout" })).toBeNull();
  });
});