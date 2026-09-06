import { describe, expect, it } from "vitest";

import {
  createEmptyStudioWriterRoomDocument,
  normalizeStudioWriterRoomDocument,
} from "../studio-writer-room";
import { projectStudioWriterRoomToCanvasPlan } from "../studio-writer-room-canvas-projection";

import { buildStudioWriterRoomCanvasPages } from "./buildStudioWriterRoomCanvasPages";

function readyWriterRoomDocument() {
  const empty = createEmptyStudioWriterRoomDocument();
  return normalizeStudioWriterRoomDocument({
    ...empty,
    stages: {
      ...empty.stages,
      "episode-outline": {
        ...empty.stages["episode-outline"],
        title: "비 오는 날",
      },
      beats: {
        items: [{
          id: "beat-1",
          order: 1,
          title: "만남",
          summary: "두 인물이 교문에서 마주친다.",
          characterIds: [],
        }],
      },
      scenes: {
        items: [{
          id: "scene-1",
          order: 1,
          beatIds: ["beat-1"],
          heading: "학교 앞",
          summary: "한 인물이 우산을 건넨다.",
          location: "교문",
          time: "방과 후",
          characterIds: [],
        }],
      },
      "panel-plan": {
        items: [{
          id: "panel-1",
          order: 1,
          sceneId: "scene-1",
          shot: "미디엄 숏",
          action: "우산을 내민다.",
          characterIds: [],
        }],
      },
      "dialogue-sfx": {
        dialogue: [{
          id: "dialogue-1",
          order: 1,
          panelId: "panel-1",
          characterId: null,
          text: "같이 갈래?",
        }],
        sfx: [{
          id: "sfx-1",
          order: 1,
          panelId: "panel-1",
          presetId: null,
          customText: "주룩",
          style: { emphasis: "quiet", scale: "small" },
        }],
      },
    },
  });
}

describe("buildStudioWriterRoomCanvasPages", () => {
  it("materializes a ready projection into deterministic editable pages", () => {
    const writerRoom = readyWriterRoomDocument();
    const plan = projectStudioWriterRoomToCanvasPlan(writerRoom);
    let sequence = 0;

    const pages = buildStudioWriterRoomCanvasPages({
      createId: () => `generated-${++sequence}`,
      plan,
      writerRoom,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      bg: "#ffffff",
      bgGrad: null,
      name: "비 오는 날 · 콘티 1",
      note: "Writer Room 컷 플랜에서 생성한 편집 가능한 콘티 초안",
    });
    expect(pages[0]?.canvasH).toBeGreaterThanOrEqual(1080);
    expect(pages[0]?.elements[0]).toMatchObject({
      id: "generated-1",
      type: "frame",
      name: "1컷 · 미디엄 숏",
      storyBeat: {
        summary: "우산을 내민다.",
      },
    });
    expect(pages[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "bubble", text: "같이 갈래?" }),
        expect.objectContaining({
          type: "text",
          text: "주룩",
          opacity: 0.62,
        }),
      ]),
    );
    expect(pages[0]?.id).toBe(`generated-${sequence}`);
  });

  it("rejects a projection that is not ready to apply", () => {
    const writerRoom = createEmptyStudioWriterRoomDocument();
    const plan = projectStudioWriterRoomToCanvasPlan(writerRoom);

    expect(() => buildStudioWriterRoomCanvasPages({ plan, writerRoom })).toThrow(
      "WRITER_ROOM_PLAN_NOT_READY",
    );
  });
});
