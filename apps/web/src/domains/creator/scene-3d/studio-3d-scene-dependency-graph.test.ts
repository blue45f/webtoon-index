import { describe, it, expect } from "vitest";

import { Studio3DCharacterRigGraph } from "./studio-3d-character-rig-graph";
import { Studio3DContinuityChecker } from "./studio-3d-continuity-checker";
import { Studio3DMaterialSystem } from "./studio-3d-material-system";
import { Studio3DSceneDependencyGraph } from "./studio-3d-scene-dependency-graph";

describe("Studio3DSceneDependencyGraph", () => {
  it("propagates dirty state downstream", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("mesh-1", "geometry", "배경 건물");
    graph.addNode("mat-1", "material", "벽 재질");
    graph.addNode("shot-1", "shot", "정면 컷");
    graph.addNode("pass-1", "toon-pass", "선화 패스");

    graph.addDependency("mesh-1", "shot-1");
    graph.addDependency("mat-1", "shot-1");
    graph.addDependency("shot-1", "pass-1");

    // mesh 변경 → shot, pass가 dirty
    const dirty = graph.markDirty("mesh-1");
    expect(dirty).toContain("mesh-1");
    expect(dirty).toContain("shot-1");
    expect(dirty).toContain("pass-1");
    expect(graph.getNode("mat-1")?.dirty).toBe(false);
  });

  it("prevents circular dependencies", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("a", "geometry", "A");
    graph.addNode("b", "geometry", "B");
    graph.addNode("c", "geometry", "C");

    expect(graph.addDependency("a", "b")).toBe(true);
    expect(graph.addDependency("b", "c")).toBe(true);
    expect(graph.addDependency("c", "a")).toBe(false); // cycle!
  });

  it("returns upstream and downstream nodes", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("src", "geometry", "Source");
    graph.addNode("mid", "modifier", "Modifier");
    graph.addNode("dst", "render-cache", "Cache");

    graph.addDependency("src", "mid");
    graph.addDependency("mid", "dst");

    expect(graph.getUpstream("dst")).toContain("mid");
    expect(graph.getUpstream("dst")).toContain("src");
    expect(graph.getDownstream("src")).toContain("mid");
    expect(graph.getDownstream("src")).toContain("dst");
  });

  it("filters dirty nodes by type", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("g1", "geometry", "Mesh A");
    graph.addNode("s1", "shot", "Shot 1");
    graph.addDependency("g1", "s1");

    graph.markDirty("g1");
    expect(graph.getDirtyNodesByType("shot").length).toBe(1);
    expect(graph.getDirtyNodesByType("material").length).toBe(0);
  });

  it("rejects duplicate node IDs without corrupting existing edges", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("source", "geometry", "Source");
    graph.addNode("target", "shot", "Target");
    graph.addDependency("source", "target");

    expect(() => graph.addNode("source", "material", "Duplicate")).toThrow(/\uc911\ubcf5/);
    expect(graph.getDownstream("source")).toEqual(["target"]);
    expect(graph.removeDependency("source", "target")).toBe(true);
    expect(graph.removeDependency("source", "target")).toBe(false);
  });

  it("does not expose mutable dependency sets", () => {
    const graph = new Studio3DSceneDependencyGraph();
    graph.addNode("source", "geometry", "Source");
    graph.addNode("target", "shot", "Target");
    graph.addDependency("source", "target");

    graph.getNode("source")?.dependents.clear();

    expect(graph.getDownstream("source")).toEqual(["target"]);
  });
});

describe("Studio 3D supporting domain kernels", () => {
  it("finds missing and changed continuity properties in both directions", () => {
    const checker = new Studio3DContinuityChecker();
    checker.registerSnapshot({
      shotId: "shot-a",
      shotName: "A",
      properties: [
        { nodeId: "hero", nodeName: "Hero", category: "costume", key: "color", value: { b: 2, a: 1 } },
      ],
    });
    checker.registerSnapshot({
      shotId: "shot-b",
      shotName: "B",
      properties: [
        { nodeId: "hero", nodeName: "Hero", category: "costume", key: "color", value: { a: 1, b: 2 } },
        { nodeId: "door", nodeName: "Door", category: "door-state", key: "open", value: true },
      ],
    });

    const issues = checker.compareShots("shot-a", "shot-b");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ nodeId: "door", valueA: undefined, valueB: true });
  });

  it("normalizes rig rotations and isolates pose snapshots", () => {
    const rig = new Studio3DCharacterRigGraph();
    rig.mapBone("head", "Head");

    expect(rig.setBoneRotation("head", [0, 0, 0, 2])).toBe(true);
    const pose = rig.savePose("Look", "portrait");
    pose.boneRotations.head![3] = 0;

    expect(rig.getBoneMapping("head")?.rotation).toEqual([0, 0, 0, 1]);
    expect(rig.getPoseLibrary()[0]?.boneRotations.head).toEqual([0, 0, 0, 1]);
  });

  it("resolves bounded shot material overrides without mutating the base", () => {
    const materials = new Studio3DMaterialSystem();
    const material = materials.createMaterial("Hero", "toon-flat");

    expect(materials.addOverride({
      materialId: material.id,
      shotId: "shot-1",
      patches: { baseColor: [2, -1, 0.5, 1], outlineWidth: -10, shadowBands: 99 },
    })).toBe(true);

    expect(materials.resolveMaterialForShot(material.id, "shot-1")?.toonFlat).toMatchObject({
      baseColor: [1, 0, 0.5, 1],
      outlineWidth: 0,
      shadowBands: 8,
    });
    expect(materials.getMaterial(material.id)?.toonFlat?.baseColor).toEqual([1, 1, 1, 1]);
    expect(materials.createMaterial("Guide", "unlit").unlit).toBeDefined();
  });
});
