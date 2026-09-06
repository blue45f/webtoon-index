import { describe, it, expect } from "vitest";

import { Studio3DProceduralCityscape } from "./studio-3d-procedural-cityscape";

describe("Studio3DProceduralCityscape", () => {
  it("initializes and generates building lots on both sides of the street", () => {
    const cityscape = new Studio3DProceduralCityscape({
      roadLength: 50,
      buildingsPerSide: 4,
      seed: 777,
    });

    const buildings = cityscape.getBuildings();
    expect(buildings.length).toBe(8); // 4 on north, 4 on south

    const northBuildings = buildings.filter((b) => b.id.includes("north"));
    const southBuildings = buildings.filter((b) => b.id.includes("south"));

    expect(northBuildings.length).toBe(4);
    expect(southBuildings.length).toBe(4);

    for (const b of buildings) {
      expect(b.floors).toBeGreaterThanOrEqual(3);
      expect(b.width).toBeGreaterThan(5);
      expect(b.floorHeight).toBe(3.2);
    }
  });

  it("produces watertight geometry mesh with valid vertex and index counts", () => {
    const cityscape = new Studio3DProceduralCityscape({
      roadLength: 40,
      buildingsPerSide: 3,
    });

    const mesh = cityscape.generateMesh();

    expect(mesh.vertexCount).toBeGreaterThan(100);
    expect(mesh.triangleCount).toBeGreaterThan(50);
    expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
    expect(mesh.normals.length).toBe(mesh.vertexCount * 3);
    expect(mesh.uvs.length).toBe(mesh.vertexCount * 2);
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
    expect(mesh.buildingCount).toBe(6);
  });

  it("updates layout deterministically on seed change", () => {
    const cityscape = new Studio3DProceduralCityscape({ seed: 100 });
    const b1 = cityscape.getBuildings()[0].width;

    cityscape.setConfig({ seed: 200 });
    const b2 = cityscape.getBuildings()[0].width;

    expect(b1).not.toBe(b2);
  });
});
