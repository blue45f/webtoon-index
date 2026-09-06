import { describe, expect, it } from "vitest";

import {
  buildParametricRoom,
  evaluateAutoCutawayWalls,
  WEBTOON_ROOM_ARCHETYPES,
} from "./studio-3d-room-builder-v2";

describe("Studio 3D Parametric Room Builder 2.0 & Auto Cutaway Engine", () => {
  it("provides 6 rich webtoon room archetypes with dimensions and key props", () => {
    expect(WEBTOON_ROOM_ARCHETYPES.length).toBe(6);
    const rooftop = WEBTOON_ROOM_ARCHETYPES.find((r) => r.id === "archetype-rooftop");
    expect(rooftop).toBeDefined();
    expect(rooftop?.keyProps).toContain("green-waterproof-floor");

    const classroom = WEBTOON_ROOM_ARCHETYPES.find((r) => r.id === "archetype-classroom");
    expect(classroom?.dimensions.width).toBe(9.0);
  });

  it("builds parametric room with 4 walls and openings", () => {
    const room = buildParametricRoom({
      width: 6,
      depth: 5,
      height: 3,
      wallThickness: 0.15,
      hasCeiling: true,
      hasFloor: true,
      openings: [
        {
          wall: "south",
          opening: {
            id: "door-1",
            type: "door",
            offsetAlongWall: 2.0,
            width: 0.9,
            height: 2.1,
            elevation: 0,
          },
        },
      ],
    });

    expect(room.walls.length).toBe(4);
    expect(room.floor.size).toEqual([6, 5]);
    expect(room.ceiling?.size).toEqual([6, 5]);

    const southWall = room.walls.find((w) => w.id === "south");
    expect(southWall?.openings.length).toBe(1);
    expect(southWall?.openings[0].type).toBe("door");
  });

  it("evaluates auto-cutaway walls when camera is outside viewing interior", () => {
    // Camera at South (+Z) looking towards center [0, 0, 0]
    const cutaway = evaluateAutoCutawayWalls({
      cameraPosition: [0, 2, 8],
      focusPoint: [0, 1, 0],
      roomWidth: 6,
      roomDepth: 5, // halfD = 2.5, camZ = 8 > 2.5
    });

    expect(cutaway.cutawayWallIds.has("south")).toBe(true);
    expect(cutaway.cutawayWallIds.has("north")).toBe(false);
  });
});
