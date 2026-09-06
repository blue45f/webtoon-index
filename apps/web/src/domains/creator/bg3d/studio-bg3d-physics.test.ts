import { describe, expect, it } from "vitest";

import {
  applyStudioBg3dPhysicsTransforms,
  createStudioBg3dPhysicsWorld,
  normalizeStudioBg3dPhysicsWorld,
} from "./studio-bg3d-physics";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  normalizeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

const DOCUMENT = normalizeStudioBg3dSceneDocument({
  ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  nodes: [
    {
      id: "root-box",
      parentId: null,
      name: "Root",
      kind: "primitive" as const,
      primitiveKind: "box" as const,
      color: "#ffffff",
      transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [2, 4, 6] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
    {
      id: "parent-box",
      parentId: null,
      name: "Parent",
      kind: "primitive" as const,
      primitiveKind: "box" as const,
      color: "#ffffff",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
    {
      id: "child",
      parentId: "parent-box",
      name: "Child",
      kind: "primitive" as const,
      primitiveKind: "sphere" as const,
      color: "#ffffff",
      transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
  ],
});

const TWO_DYNAMIC_DOCUMENT = normalizeStudioBg3dSceneDocument({
  ...DOCUMENT,
  nodes: [
    ...DOCUMENT.nodes,
    {
      ...DOCUMENT.nodes[0]!,
      id: "second-root-box",
      name: "Second Root",
      transform: { position: [6, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
  ],
});

describe("Studio BG3D physics boundary", () => {
  it("creates bounded colliders and refuses dynamic parented nodes", () => {
    const world = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]));
    expect(world).toMatchObject({ solverSubsteps: 2, allowSleep: true });
    expect(world?.bodies.find((body) => body.nodeId === "root-box")).toMatchObject({
      motion: "dynamic",
      mass: 1,
      collider: { kind: "box", halfExtents: [1, 2, 3] },
    });
    expect(world?.bodies.find((body) => body.nodeId === "child")).toMatchObject({
      motion: "static",
      mass: 0,
      collider: { kind: "sphere", radius: 0.5 },
    });
    expect(createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["child"]))).toBeNull();
    expect(createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["parent-box"]))).toBeNull();
  });

  it("rejects dynamic triangle meshes and unsafe solver/body values", () => {
    const base = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    expect(normalizeStudioBg3dPhysicsWorld({
      ...base,
      bodies: [{ ...base.bodies[0]!, collider: { kind: "triangle-mesh", triangleCount: 1 } }],
    }, DOCUMENT)).toBeNull();
    expect(normalizeStudioBg3dPhysicsWorld({ ...base, solverSubsteps: 100 }, DOCUMENT)).toBeNull();
  });

  it("copies and freezes sanitized bodies without retaining untrusted fields", () => {
    const base = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    const rawBody = { ...base.bodies[0]!, injected: "must-not-cross" };
    const result = normalizeStudioBg3dPhysicsWorld({
      bodies: [rawBody],
      solverSubsteps: 1,
      allowSleep: false,
    }, DOCUMENT);

    expect(result?.bodies[0]).not.toHaveProperty("injected");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.bodies)).toBe(true);
    expect(Object.isFrozen(result?.bodies[0])).toBe(true);
    expect(normalizeStudioBg3dPhysicsWorld({
      bodies: [null],
      solverSubsteps: 1,
      allowSleep: true,
    })).toBeNull();
  });

  it("canonicalizes body order and enforces mesh collider complexity budgets", () => {
    const base = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    const reordered = normalizeStudioBg3dPhysicsWorld({
      ...base,
      bodies: [...base.bodies].reverse(),
    }, DOCUMENT);
    expect(reordered?.bodies.map((body) => body.nodeId)).toEqual(
      DOCUMENT.nodes.map((node) => node.id),
    );
    const staticBody = { ...base.bodies[0]!, motion: "static" as const, mass: 0 };
    expect(normalizeStudioBg3dPhysicsWorld({
      bodies: [{ ...staticBody, collider: { kind: "convex-hull" } }],
      solverSubsteps: 1,
      allowSleep: true,
    }, DOCUMENT)).toBeNull();
    expect(normalizeStudioBg3dPhysicsWorld({
      bodies: [{ ...staticBody, collider: { kind: "convex-hull", vertexCount: 4_097 } }],
      solverSubsteps: 1,
      allowSleep: true,
    }, DOCUMENT)).toBeNull();
    expect(normalizeStudioBg3dPhysicsWorld({
      bodies: [{ ...staticBody, collider: { kind: "triangle-mesh", triangleCount: 50_001 } }],
      solverSubsteps: 1,
      allowSleep: true,
    }, DOCUMENT)).toBeNull();
  });

  it("uses thin colliders for flat geometry and refuses locked dynamic nodes", () => {
    const planeDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: [{
        ...DOCUMENT.nodes[0],
        id: "flat-plane",
        primitiveKind: "plane",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [4, 6, 8] },
      }],
    });
    expect(createStudioBg3dPhysicsWorld(planeDocument, new Set())?.bodies[0]?.collider)
      .toEqual({ kind: "box", halfExtents: [2, 3, 0.001] });
    const lockedDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: [{ ...DOCUMENT.nodes[0], locked: true }],
    });
    expect(createStudioBg3dPhysicsWorld(lockedDocument, new Set(["root-box"]))).toBeNull();
  });

  it("omits hidden colliders, including visible descendants of a hidden ancestor", () => {
    const hiddenDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: [
        DOCUMENT.nodes[0],
        { ...DOCUMENT.nodes[1], visible: false },
        DOCUMENT.nodes[2],
      ],
    });
    const world = createStudioBg3dPhysicsWorld(hiddenDocument, new Set(["root-box"]));
    expect(world?.bodies.map((body) => body.nodeId)).toEqual(["root-box"]);
    expect(createStudioBg3dPhysicsWorld(hiddenDocument, new Set(["parent-box"]))).toBeNull();

    const visibleWorld = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    expect(normalizeStudioBg3dPhysicsWorld({
      ...visibleWorld,
      bodies: visibleWorld.bodies.filter((body) => body.nodeId !== "parent-box"),
    }, hiddenDocument)).toBeNull();

    const hiddenSelectionDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: [{ ...DOCUMENT.nodes[0], visible: false }],
    });
    expect(createStudioBg3dPhysicsWorld(hiddenSelectionDocument, new Set(["root-box"]))).toBeNull();
  });

  it("normalizes quaternion bake results into a new root-local SceneDocument", () => {
    const world = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    const result = applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      nodeId: "root-box",
      position: [3, 4, 5],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    }], world);
    expect(result?.nodes[0]?.transform.position).toEqual([3, 4, 5]);
    expect(result?.nodes[0]?.transform.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(DOCUMENT.nodes[0]?.transform.position).toEqual([0, 1, 0]);
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      nodeId: "child",
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    }], world)).toBeNull();
  });

  it("requires every dynamic body exactly once while leaving static bodies unsampled", () => {
    const world = createStudioBg3dPhysicsWorld(
      TWO_DYNAMIC_DOCUMENT,
      new Set(["root-box", "second-root-box"]),
    )!;
    const first = {
      nodeId: "root-box",
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    };
    const second = {
      nodeId: "second-root-box",
      position: [7, 8, 9],
      rotation: [0, 0, 0, 1],
    };

    // Worker delivery order is not part of the contract; identity is nodeId-based.
    const result = applyStudioBg3dPhysicsTransforms(
      TWO_DYNAMIC_DOCUMENT,
      [second, first],
      world,
    );
    expect(result?.nodes.find((node) => node.id === "root-box")?.transform.position)
      .toEqual([1, 2, 3]);
    expect(result?.nodes.find((node) => node.id === "second-root-box")?.transform.position)
      .toEqual([7, 8, 9]);
    expect(result?.nodes.find((node) => node.id === "parent-box")?.transform.position)
      .toEqual([0, 0, 0]);

    expect(applyStudioBg3dPhysicsTransforms(TWO_DYNAMIC_DOCUMENT, [], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(TWO_DYNAMIC_DOCUMENT, [first], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(TWO_DYNAMIC_DOCUMENT, [first, first], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(TWO_DYNAMIC_DOCUMENT, [first, {
      ...second,
      nodeId: "unknown-node",
    }], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(TWO_DYNAMIC_DOCUMENT, [first, {
      ...second,
      nodeId: "parent-box",
    }], world)).toBeNull();

    const staticWorld = createStudioBg3dPhysicsWorld(DOCUMENT, new Set())!;
    const staticOnlyResult = applyStudioBg3dPhysicsTransforms(DOCUMENT, [], staticWorld);
    expect(staticOnlyResult?.nodes.map((node) => node.transform)).toEqual(
      DOCUMENT.nodes.map((node) => node.transform),
    );
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...first,
      nodeId: "root-box",
    }], staticWorld)).toBeNull();
  });

  it("rejects non-finite, oversized, and zero-quaternion bake samples", () => {
    const world = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["root-box"]))!;
    const valid = {
      nodeId: "root-box",
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    };
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...valid,
      position: [10_001, 0, 0],
    }], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...valid,
      position: [Number.NaN, 0, 0],
    }], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...valid,
      rotation: [0, 0, 0, 0],
    }], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...valid,
      rotation: [0, Number.NaN, 0, 1],
    }], world)).toBeNull();
    expect(applyStudioBg3dPhysicsTransforms(DOCUMENT, [{
      ...valid,
      rotation: [0, 1_000_001, 0, 1],
    }], world)).toBeNull();
  });
});
