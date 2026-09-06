import { describe, it, expect } from "vitest";

import {
  Studio3DRoomBuildingKit,
  createLShapeRoom,
  createWebtoonRoomPreset,
} from "./studio-3d-room-building-kit";

describe("Studio3DRoomBuildingKit", () => {
  it("creates simple rectangular room with walls and openings", () => {
    const kit = new Studio3DRoomBuildingKit();
    const config = kit.getRoomConfig();

    expect(config.walls.length).toBe(4);
    expect(config.openings.length).toBe(2);
    expect(kit.computeTotalFloorArea()).toBe(20); // 5m * 4m = 20sqm
  });

  it("supports adding stairs and configuring ceiling transparency", () => {
    const kit = new Studio3DRoomBuildingKit();
    kit.addStair({
      id: "stair-main",
      startPoint: [0, 0, 0],
      directionAngleDeg: 0,
      width: 1.0,
      height: 2.8,
      depth: 3.0,
      stepsCount: 14,
      style: "straight",
      hasRailing: true,
      railingHeight: 0.9,
    });

    kit.setCeilingVisible(false);
    kit.setCameraWallTransparency(true);
    kit.setFlooringPattern("tatami-mats");

    const config = kit.getRoomConfig();
    expect(config.stairs.length).toBe(1);
    expect(config.ceiling.visible).toBe(false);
    expect(config.cameraWallTransparency).toBe(true);
    expect(config.flooring.pattern).toBe("tatami-mats");
  });

  it("builds L-shaped multi-segment room", () => {
    const lRoom = createLShapeRoom("l-1", "L자형 거실", 6, 4, 3, 3);
    const kit = new Studio3DRoomBuildingKit(lRoom);
    expect(kit.getRoomConfig().walls.length).toBe(6);
    expect(kit.getRoomConfig().layoutShape).toBe("l-shape");
  });

  it("creates various webtoon presets with specialized layouts", () => {
    const classroom = createWebtoonRoomPreset("classroom");
    expect(classroom.name).toContain("학교 교실");
    expect(classroom.openings.length).toBeGreaterThanOrEqual(3);

    const hospital = createWebtoonRoomPreset("hospital-ward");
    expect(hospital.name).toContain("병원 병실");

    const throne = createWebtoonRoomPreset("fantasy-throne");
    expect(throne.name).toContain("판타지 왕실");
    expect(throne.stairs.length).toBeGreaterThan(0);

    const scifi = createWebtoonRoomPreset("scifi-bridge");
    expect(scifi.name).toContain("SF 함교");
  });

  it("evaluates camera wall cutaway for occluding walls", () => {
    const kit = new Studio3DRoomBuildingKit();
    // Camera outside south wall looking at center (0, 1.2, 0)
    const cameraPos: [number, number, number] = [0, 1.5, -5];
    const cutaway = kit.evaluateCameraWallCutaway(cameraPos, [0, 1.2, 0]);

    expect(cutaway.length).toBe(4);
    const southWallCutaway = cutaway.find((c) => c.wallId === "wall-south");
    expect(southWallCutaway?.occluded).toBe(true);
    expect(southWallCutaway?.cutawayOpacity).toBe(0.0);
  });

  it("generates watertight 3D mesh buffers for rendering", () => {
    const kit = new Studio3DRoomBuildingKit();
    const mesh = kit.generateMeshBuffer();

    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
    expect(mesh.normals.length).toBe(mesh.vertexCount * 3);
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
  });
});
