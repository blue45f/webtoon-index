import { describe, it, expect } from "vitest";

import {
  Studio3DModifierDAG,
  type RawMeshData,
} from "./studio-3d-modifier-dag";

function createTestTriangleMesh(): RawMeshData {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

describe("Studio3DModifierDAG", () => {
  it("adds, reorders, and removes modifiers from the stack", () => {
    const dag = new Studio3DModifierDAG();
    const mirror = dag.addModifier("mirror");
    const array = dag.addModifier("array");
    const bevel = dag.addModifier("bevel");

    expect(dag.getStack().length).toBe(3);
    expect(dag.getStack()[0].id).toBe(mirror.id);
    expect(array.type).toBe("array");

    // reorder: move bevel to index 0
    dag.moveModifier(bevel.id, 0);
    expect(dag.getStack()[0].id).toBe(bevel.id);

    // remove mirror
    dag.removeModifier(mirror.id);
    expect(dag.getStack().length).toBe(2);
  });

  it("toggles modifier enabled state and updates parameters", () => {
    const dag = new Studio3DModifierDAG();
    const mod = dag.addModifier("solidify");

    expect(mod.enabled).toBe(true);
    dag.toggleModifier(mod.id, false);
    expect(dag.getModifier(mod.id)?.enabled).toBe(false);
    expect(dag.getActiveModifiers().length).toBe(0);

    dag.updateModifierParams(mod.id, { thickness: 0.1 });
    expect((dag.getModifier(mod.id)?.params as { thickness?: number })?.thickness).toBe(0.1);
  });

  it("duplicates a modifier preserving params", () => {
    const dag = new Studio3DModifierDAG();
    const orig = dag.addModifier("subdivision");
    const dup = dag.duplicateModifier(orig.id);

    expect(dup).toBeDefined();
    expect(dup!.id).not.toBe(orig.id);
    expect(dup!.type).toBe("subdivision");
    expect(dag.getStack().length).toBe(2);
  });

  it("serializes and deserializes the modifier stack", () => {
    const dag = new Studio3DModifierDAG();
    dag.addModifier("mirror");
    dag.addModifier("boolean", "불리언 빼기", { operation: "subtract", targetMeshId: "mesh-42" });

    const json = dag.serializeToJSON();
    const dag2 = new Studio3DModifierDAG();
    dag2.loadFromJSON(json);

    expect(dag2.getStack().length).toBe(2);
    expect(dag2.getStack()[1].name).toBe("불리언 빼기");
  });

  it("provides default Korean names for all modifier types", () => {
    const dag = new Studio3DModifierDAG();
    const types = [
      "mirror", "array", "boolean", "bevel", "solidify",
      "subdivision", "decimate", "weld", "weighted-normal",
      "curve-deform", "lattice", "shrinkwrap", "simple-deform",
      "displace", "smooth", "wireframe",
    ] as const;

    for (const t of types) {
      const mod = dag.addModifier(t);
      expect(mod.name.length).toBeGreaterThan(0);
    }
    expect(dag.getStack().length).toBe(types.length);
  });

  describe("Geometry Modifier Execution", () => {
    it("evaluates Mirror modifier duplicating geometry across axis", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("mirror", undefined, { axis: ["x"] });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.positions.length).toBe(baseMesh.positions.length * 2);
      expect(evaluated.indices.length).toBe(baseMesh.indices.length * 2);
    });

    it("evaluates Array modifier creating linear instances", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("array", undefined, { count: 3, offset: [2, 0, 0] });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.positions.length).toBe(baseMesh.positions.length * 3);
      expect(evaluated.indices.length).toBe(baseMesh.indices.length * 3);
    });

    it("evaluates Solidify modifier creating shell geometry", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("solidify", undefined, { thickness: 0.1, offset: 1 });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.positions.length).toBe(baseMesh.positions.length * 2);
      expect(evaluated.indices.length).toBe(baseMesh.indices.length * 2);
    });

    it("evaluates SimpleDeform modifier (Twist / Bend / Taper / Stretch)", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("simple-deform", undefined, { mode: "twist", angle: 45, factor: 1 });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.positions.length).toBe(baseMesh.positions.length);
    });

    it("evaluates Subdivision modifier splitting faces", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("subdivision", undefined, { level: 1 });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      // 1 triangle splits into 4 triangles -> 12 indices
      expect(evaluated.indices.length).toBe(12);
    });

    it("evaluates Smooth and Displace modifiers", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("displace", undefined, { strength: 0.2 });
      dag.addModifier("smooth", undefined, { factor: 0.5, iterations: 2 });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.positions.length).toBe(baseMesh.positions.length);
    });

    it("evaluates Wireframe modifier generating strut quads", () => {
      const dag = new Studio3DModifierDAG();
      dag.addModifier("wireframe", undefined, { thickness: 0.05 });
      const baseMesh = createTestTriangleMesh();

      const evaluated = dag.evaluateMesh(baseMesh);
      expect(evaluated.indices.length).toBeGreaterThan(0);
    });
  });
});
