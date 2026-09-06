import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createStudioBg3dPhysicsWorld } from "./studio-bg3d-physics";
import {
  createStudioBg3dPhysicsInitialPoses,
  createStudioBg3dPhysicsThreeJob,
  measureStudioBg3dPhysicsModelLocalBounds,
  projectStudioBg3dPhysicsSamples,
  STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY,
} from "./studio-bg3d-physics-three";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_GLB_MIME,
  normalizeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

const DOCUMENT = normalizeStudioBg3dSceneDocument({
  ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  nodes: [
    {
      id: "dynamic",
      parentId: null,
      name: "Dynamic",
      kind: "primitive",
      primitiveKind: "box",
      color: "#ffffff",
      transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
    {
      id: "parent",
      parentId: null,
      name: "Parent",
      kind: "primitive",
      primitiveKind: "box",
      color: "#ffffff",
      transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
    {
      id: "child",
      parentId: "parent",
      name: "Child",
      kind: "primitive",
      primitiveKind: "sphere",
      color: "#ffffff",
      transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    },
  ],
});

const MODEL_DOCUMENT = normalizeStudioBg3dSceneDocument({
  ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  attachments: [{
    id: "model-attachment",
    name: "Prop.glb",
    mime: STUDIO_BG3D_GLB_MIME,
    byteSize: 1_024,
    hash: `sha256:${"1".padStart(64, "0")}`,
    rights: {
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
    },
    source: "upload",
  }],
  nodes: [{
    id: "model-node",
    parentId: null,
    name: "Model",
    kind: "model",
    attachmentId: "model-attachment",
    transform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 2, 0.5] },
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
  }],
});

describe("Studio BG3D physics Three projection", () => {
  it("resolves parent-local document transforms into body-ordered world poses", () => {
    const world = createStudioBg3dPhysicsWorld(DOCUMENT, new Set(["dynamic"]))!;
    const poses = createStudioBg3dPhysicsInitialPoses(DOCUMENT, world);
    expect(poses?.map((pose) => [pose.nodeId, pose.position])).toEqual([
      ["dynamic", [0, 3, 0]],
      ["parent", [2, 0, 0]],
      ["child", [2, 2, 0]],
    ]);
    expect(Object.isFrozen(poses)).toBe(true);
    expect(Object.isFrozen(poses?.[0])).toBe(true);
  });

  it("keeps nested non-uniform world scale and body pose in the same projection", () => {
    const scaledDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: [
        DOCUMENT.nodes[0],
        {
          ...DOCUMENT.nodes[1],
          id: "ancestor",
          name: "Ancestor",
          transform: {
            position: [10, 0, -5],
            rotation: [0, Math.PI / 2, 0],
            scale: [5, 0.5, 2],
          },
        },
        {
          ...DOCUMENT.nodes[1],
          parentId: "ancestor",
          transform: {
            position: [2, 0, 0],
            rotation: [0, 0, 0],
            scale: [2, 3, 4],
          },
        },
        {
          ...DOCUMENT.nodes[2],
          parentId: "parent",
          primitiveKind: "box",
          transform: {
            position: [0, 2, 0],
            rotation: [0, 0, 0],
            scale: [0.5, 2, 3],
          },
        },
      ],
    });
    const localWorld = createStudioBg3dPhysicsWorld(scaledDocument, new Set(["dynamic"]))!;
    const job = createStudioBg3dPhysicsThreeJob(scaledDocument, localWorld);

    expect(job?.world.bodies.find((body) => body.nodeId === "ancestor")?.collider)
      .toEqual({ kind: "box", halfExtents: [2.5, 0.25, 1] });
    expect(job?.world.bodies.find((body) => body.nodeId === "parent")?.collider)
      .toEqual({ kind: "box", halfExtents: [5, 0.75, 4] });
    expect(job?.world.bodies.find((body) => body.nodeId === "child")?.collider)
      .toEqual({ kind: "box", halfExtents: [2.5, 1.5, 12] });
    const childPose = job?.initialPoses.find((pose) => pose.nodeId === "child");
    expect(childPose?.position[0]).toBeCloseTo(10);
    expect(childPose?.position[1]).toBeCloseTo(3);
    expect(childPose?.position[2]).toBeCloseTo(-15);
    expect(childPose?.rotation[0]).toBeCloseTo(0);
    expect(childPose?.rotation[1]).toBeCloseTo(Math.SQRT1_2);
    expect(childPose?.rotation[2]).toBeCloseTo(0);
    expect(childPose?.rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });

  it("fails closed when non-uniform ancestor scale and child rotation create shear", () => {
    const shearedDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: DOCUMENT.nodes.map((node) => {
        if (node.id === "parent") {
          return { ...node, transform: { ...node.transform, scale: [2, 1, 1] } };
        }
        if (node.id === "child") {
          return {
            ...node,
            primitiveKind: "box",
            transform: { ...node.transform, rotation: [0, 0, Math.PI / 4] },
          };
        }
        return node;
      }),
    });
    const localWorld = createStudioBg3dPhysicsWorld(shearedDocument, new Set(["dynamic"]))!;

    expect(createStudioBg3dPhysicsThreeJob(shearedDocument, localWorld)).toBeNull();
    expect(createStudioBg3dPhysicsInitialPoses(shearedDocument, localWorld)).toBeNull();
  });

  it("fails closed when inherited scale exceeds the collider dimension budget", () => {
    const oversizedDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: DOCUMENT.nodes.map((node) => {
        if (node.id === "parent" || node.id === "child") {
          return { ...node, transform: { ...node.transform, scale: [1_000, 1_000, 1_000] } };
        }
        return node;
      }),
    });
    const localWorld = createStudioBg3dPhysicsWorld(oversizedDocument, new Set(["dynamic"]))!;

    expect(createStudioBg3dPhysicsThreeJob(oversizedDocument, localWorld)).toBeNull();
  });

  it("matches an auto-fitted model root AABB, including its local center offset", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(0.25, 0.5, -0.25);
    root.add(mesh);
    // The viewport cache applies this auto-fit transform before cloning the root into the node.
    root.scale.setScalar(2);
    const bounds = measureStudioBg3dPhysicsModelLocalBounds(root);
    expect(bounds).toEqual({ center: [0.5, 1, -0.5], halfExtents: [1, 1, 1] });

    const localWorld = createStudioBg3dPhysicsWorld(MODEL_DOCUMENT, new Set(["model-node"]))!;
    const job = createStudioBg3dPhysicsThreeJob(
      MODEL_DOCUMENT,
      localWorld,
      new Map([["model-node", bounds!]]),
    );
    expect(job?.world.bodies[0]?.collider).toEqual({
      kind: "box",
      halfExtents: [1, 2, 0.5],
      center: [0.5, 2, -0.25],
    });
  });

  it("fails closed when a model bound is unavailable or exceeds the Worker collider budget", () => {
    const localWorld = createStudioBg3dPhysicsWorld(MODEL_DOCUMENT, new Set(["model-node"]))!;
    expect(createStudioBg3dPhysicsThreeJob(MODEL_DOCUMENT, localWorld)).toBeNull();
    expect(createStudioBg3dPhysicsThreeJob(
      MODEL_DOCUMENT,
      localWorld,
      new Map([["model-node", {
        center: [10_001, 0, 0],
        halfExtents: [1, 1, 1],
      }]]),
    )).toBeNull();
  });

  it("validates the complete batch before projecting root transforms", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    const objects = new Map([["dynamic", root]]);
    expect(projectStudioBg3dPhysicsSamples([{
      nodeId: "dynamic",
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    }], objects)).toBe(true);
    expect(root.position.toArray()).toEqual([1, 2, 3]);

    expect(projectStudioBg3dPhysicsSamples([{
      nodeId: "dynamic",
      position: [Number.NaN, 0, 0],
      rotation: [0, 0, 0, 1],
    }], objects)).toBe(false);
    expect(root.position.toArray()).toEqual([1, 2, 3]);
  });

  it("projects through the marked retained presentation root and rejects arbitrary groups", () => {
    const scene = new THREE.Scene();
    const stageRoot = new THREE.Group();
    const presentationRoot = new THREE.Group();
    presentationRoot.userData[STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY] = true;
    const dynamic = new THREE.Group();
    scene.add(stageRoot);
    stageRoot.add(presentationRoot);
    presentationRoot.add(dynamic);
    const objects = new Map([["dynamic", dynamic]]);

    expect(projectStudioBg3dPhysicsSamples([{
      nodeId: "dynamic",
      position: [4, 5, 6],
      rotation: [0, 0, 0, 1],
    }], objects)).toBe(true);
    expect(dynamic.position.toArray()).toEqual([4, 5, 6]);

    const arbitraryParent = new THREE.Group();
    scene.add(arbitraryParent);
    arbitraryParent.add(dynamic);
    expect(projectStudioBg3dPhysicsSamples([{
      nodeId: "dynamic",
      position: [7, 8, 9],
      rotation: [0, 0, 0, 1],
    }], objects)).toBe(false);
    expect(dynamic.position.toArray()).toEqual([4, 5, 6]);
  });
});
