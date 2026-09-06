import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioShared3dSceneSession,
} from "../studio-shared-3d-scene-bridge";
import {
  DEFAULT_VRM_PROP_RIG_METRICS,
  type VrmPropMetricBone,
  type VrmPropRigMetrics,
} from "../vrm/studio-vrm-prop-rig";
import { createPropInstance, serializeVrmProps } from "../vrm/studio-vrm-props";
import { createStudioVrmSceneDocument, normalizeStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

const loadStudioVrmAsset = vi.fn();
const getStoredVrmModelByHash = vi.fn();
const selectableSampleVrmUrl = vi.fn();
const applyPoseToVrm = vi.fn(() => true);
const applyFingerRotations = vi.fn();
const applyBodyScale = vi.fn();
const applyExpressionWeightsToVrm = vi.fn();
const applyVrmCustomColors = vi.fn();
const applyVrmMaterialFx = vi.fn();

vi.mock("../vrm/studio-vrm-asset-runtime", () => ({
  STUDIO_VRM_BASE_ROTATION_Y_KEY: "studioVrmBaseRotationY",
  disposeStudioVrmAsset: vi.fn(),
  loadStudioVrmAsset,
}));
// Stubbed because the real entry statically pulls Three's whole WebGPU build; what matters here
// is that the WebGPU path reaches for the node material and the WebGL path never does.
const MToonNodeMaterial = class {};
vi.mock("./studio-bg3d-three-webgpu-entry", () => ({ MToonNodeMaterial }));
vi.mock("../vrm/vrm-library", () => ({
  getStoredVrmModelByHash,
  selectableSampleVrmUrl,
}));
vi.mock("../vrm/studio-vrm-poser-utils", () => ({
  applyBodyScale,
  applyExpressionWeightsToVrm,
  applyFingerRotations,
  applyPoseToVrm,
  applyVrmCustomColors,
  applyVrmMaterialFx,
}));

const {
  applyStudioBg3dLinkedCharacterState,
  loadStudioBg3dLinkedVrm,
} = await import("./studio-bg3d-shared-vrm-runtime");
const {
  measureStudioBg3dSharedCharacterGroundAnchors,
  raycastStudioBg3dSharedCharacterGroundSurface,
  selectStudioBg3dSharedCharacterSupportPoint,
} = await import("./StudioBg3dSharedVrmCharacter");

function groundPlane(
  entityId: string,
  y: number,
  material: THREE.Material | THREE.Material[],
  materialIndex = 0,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2, 2);
  if (Array.isArray(material)) {
    geometry.clearGroups();
    geometry.addGroup(0, geometry.index?.count ?? 0, materialIndex);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = entityId;
  mesh.position.y = y;
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.studioBg3dEntityId = entityId;
  return mesh;
}

function completeRightHandMetrics(): VrmPropRigMetrics {
  const boneWorldPositions: Partial<Record<VrmPropMetricBone, readonly [number, number, number]>> = {
    rightLowerArm: [-0.2, 1.1, 0],
    rightHand: [0, 1.1, 0],
  };
  const fingers = ["Index", "Middle", "Ring", "Little"] as const;
  for (const [fingerIndex, finger] of fingers.entries()) {
    const y = 1.08 - fingerIndex * 0.012;
    boneWorldPositions[`right${finger}Proximal`] = [0.015, y, 0];
    boneWorldPositions[`right${finger}Intermediate`] = [0.045, y, 0];
    boneWorldPositions[`right${finger}Distal`] = [0.07, y, 0];
  }
  boneWorldPositions.rightThumbMetacarpal = [0.005, 1.075, 0.005];
  boneWorldPositions.rightThumbProximal = [0.03, 1.055, 0.01];
  boneWorldPositions.rightThumbDistal = [0.055, 1.04, 0.012];
  return {
    ...DEFAULT_VRM_PROP_RIG_METRICS,
    handSockets: {
      ...DEFAULT_VRM_PROP_RIG_METRICS.handSockets,
      rightHand: {
        ...DEFAULT_VRM_PROP_RIG_METRICS.handSockets.rightHand,
        source: "measured",
      },
    },
    boneWorldPositions,
    missingBones: [],
  };
}

function createShoeGroundingVrm({
  leftFootY,
  rightFootY,
}: {
  leftFootY: number;
  rightFootY: number;
}) {
  const root = new THREE.Group();
  const leftFoot = new THREE.Bone();
  const rightFoot = new THREE.Bone();
  leftFoot.name = "leftFoot";
  rightFoot.name = "rightFoot";
  leftFoot.position.set(-0.4, leftFootY, 0.1);
  rightFoot.position.set(0.45, rightFootY, -0.1);
  root.add(leftFoot, rightFoot);

  const addSole = (
    foot: THREE.Bone,
    side: "left" | "right",
    position: readonly [number, number, number],
  ) => {
    const group = new THREE.Group();
    group.name = `wardrobe:shoes:heels:${side}Foot`;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.1, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.set(...position);
    group.add(mesh);
    foot.add(group);
  };
  addSole(leftFoot, "left", [0.05, -0.2, 0.15]);
  addSole(rightFoot, "right", [-0.03, -0.25, -0.12]);

  // Boot shafts use lower-leg roots. Even a pathological shaft bound must never become a sole.
  const leftShaft = new THREE.Group();
  leftShaft.name = "wardrobe:shoes:heels:leftLowerLeg";
  const shaftMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 4, 0.4),
    new THREE.MeshBasicMaterial(),
  );
  shaftMesh.position.y = -4;
  leftShaft.add(shaftMesh);
  root.add(leftShaft);

  return {
    scene: root,
    humanoid: {
      getRawBoneNode: (name: string) => {
        if (name === "leftFoot") return leftFoot;
        if (name === "rightFoot") return rightFoot;
        return null;
      },
    },
  } as never;
}

describe("Studio BG3D linked VRM runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectableSampleVrmUrl.mockReturnValue("/vrm/sample.vrm");
  });

  it("resolves a rights-admitted bundled model through the shared VRM runtime", async () => {
    const vrm = { scene: new THREE.Group() };
    loadStudioVrmAsset.mockResolvedValue(vrm);

    await expect(loadStudioBg3dLinkedVrm(createStudioVrmSceneDocument())).resolves.toBe(vrm);
    expect(selectableSampleVrmUrl).toHaveBeenCalledWith("sample-vrm");
    // No MToon class is injected on the WebGL path, so nothing here reaches the WebGPU entry.
    expect(loadStudioVrmAsset).toHaveBeenCalledWith("/vrm/sample.vrm", {
      mtoonMaterialType: undefined,
    });
    expect(getStoredVrmModelByHash).not.toHaveBeenCalled();
  });

  it("loads the MToon node material only when a WebGPU renderer will draw the character", async () => {
    // MToon compiles to one backend or the other, so the wrong build leaves the character out of
    // an otherwise healthy frame without raising anything. The wiring is the whole guarantee.
    const vrm = { scene: new THREE.Group() };
    loadStudioVrmAsset.mockResolvedValue(vrm);

    await expect(
      loadStudioBg3dLinkedVrm(createStudioVrmSceneDocument(), { materialVariant: "webgpu-node" }),
    ).resolves.toBe(vrm);
    expect(loadStudioVrmAsset).toHaveBeenCalledWith("/vrm/sample.vrm", {
      mtoonMaterialType: MToonNodeMaterial,
    });
  });

  it("resolves an uploaded character by content hash and revokes its temporary URL", async () => {
    const hash = `sha256:${"b".repeat(64)}`;
    const scene = createStudioVrmSceneDocument({
      source: "attachment",
      hash,
      byteSize: 4,
      mime: "model/vrm",
      name: "업로드 캐릭터",
    });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "model/vrm" });
    const vrm = { scene: new THREE.Group() };
    getStoredVrmModelByHash.mockResolvedValue({ blob });
    loadStudioVrmAsset.mockResolvedValue(vrm);
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    await expect(loadStudioBg3dLinkedVrm(scene)).resolves.toBe(vrm);
    expect(getStoredVrmModelByHash).toHaveBeenCalledWith(hash);
    const runtimeUrl = loadStudioVrmAsset.mock.calls[0]?.[0] as string;
    expect(runtimeUrl).toMatch(/^blob:/u);
    expect(revoke).toHaveBeenCalledWith(runtimeUrl);
    revoke.mockRestore();
  });

  it("applies the canonical subset while internal meshes stay pass-through for the root proxy", () => {
    const scene = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      pose: {
        ...createStudioVrmSceneDocument().pose,
        bodyRotationY: 0.4,
        yOffset: 0.2,
      },
      expressions: { happy: 0.8 },
      appearance: {
        ...createStudioVrmSceneDocument().appearance,
        customColors: { hair: "#112233" },
      },
    });
    const source = createStudioShared3dSceneSession([
      { elementId: "character-a", scene },
    ]).characters[0]!;
    const root = new THREE.Group();
    root.userData.studioVrmBaseRotationY = 0.1;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);
    const vrm = {
      scene: root,
      update: vi.fn(),
    } as never;

    expect(applyStudioBg3dLinkedCharacterState(vrm, source)).toBe(true);
    expect(applyPoseToVrm).toHaveBeenCalledWith(
      vrm,
      scene.pose.bones,
      0.2,
      scene.pose.translations,
    );
    expect(applyFingerRotations).toHaveBeenCalledWith(vrm, scene.pose.fingerOverrides);
    expect(applyExpressionWeightsToVrm).toHaveBeenCalledWith(vrm, { happy: 0.8 });
    expect(applyVrmCustomColors).toHaveBeenCalledWith(vrm, { hair: "#112233" });
    expect(root.rotation.y).toBeCloseTo(0.5, 10);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    const intersects: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), intersects);
    expect(intersects).toHaveLength(0);
    expect(mesh.raycast).not.toBe(THREE.Mesh.prototype.raycast);
  });

  it("applies Stage placement last while retaining source pose, expression and model state", () => {
    const scene = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      pose: {
        ...createStudioVrmSceneDocument().pose,
        bodyRotationY: 0.25,
        yOffset: 0.1,
        translations: {
          ...createStudioVrmSceneDocument().pose.translations,
          root: [1, 0, -2],
        },
        bones: { head: { rotation: [0.1, 0.2, 0.3] } },
      },
      expressions: { happy: 0.7 },
    });
    const source = createStudioShared3dSceneSession([{
      elementId: "character-a",
      scene,
      stageId: "stage-a",
      stageTransform: { position: [-4, 1.25, 3], rotationY: -0.75 },
    }]).characters[0]!;
    const root = new THREE.Group();
    root.userData.studioVrmBaseRotationY = 0.1;
    const vrm = { scene: root, update: vi.fn() } as never;

    expect(applyStudioBg3dLinkedCharacterState(vrm, source)).toBe(true);
    expect(applyPoseToVrm).toHaveBeenLastCalledWith(
      vrm,
      scene.pose.bones,
      1.25,
      {
        ...scene.pose.translations,
        root: [-4, 0, 3],
      },
    );
    expect(applyExpressionWeightsToVrm).toHaveBeenLastCalledWith(vrm, { happy: 0.7 });
    expect(root.rotation.y).toBeCloseTo(-0.65, 10);
    expect(scene.pose.translations.root).toEqual([1, 0, -2]);
    expect(scene.pose.yOffset).toBe(0.1);
    expect(scene.pose.bodyRotationY).toBe(0.25);
  });

  it("gives a measured automatic grip final authority while preserving the opposite authored hand", () => {
    const base = createStudioVrmSceneDocument();
    const mug = createPropInstance("mug", "shared-auto-grip")!;
    const scene = normalizeStudioVrmSceneDocument({
      ...base,
      pose: {
        ...base.pose,
        fingerOverrides: {
          leftIndexProximal: [0.11, 0.22, 0.33],
          rightIndexProximal: [0, 0, 0],
        },
      },
      props: serializeVrmProps([mug]),
    });
    const source = createStudioShared3dSceneSession([{
      elementId: "character-grip",
      scene,
    }]).characters[0]!;
    const vrm = { scene: new THREE.Group(), update: vi.fn() } as never;

    expect(applyStudioBg3dLinkedCharacterState(vrm, source, {
      propRigMetrics: completeRightHandMetrics(),
    })).toBe(true);
    const appliedFingers = applyFingerRotations.mock.calls.at(-1)?.[1] as Record<
      string,
      readonly [number, number, number]
    >;
    expect(appliedFingers.leftIndexProximal).toEqual([0.11, 0.22, 0.33]);
    expect(appliedFingers.rightIndexProximal).not.toEqual([0, 0, 0]);
    expect(Object.keys(appliedFingers).filter((bone) => bone.startsWith("right"))).toHaveLength(15);
  });

  it("fails closed instead of showing an enabled automatic grip on an incomplete hand rig", () => {
    const base = createStudioVrmSceneDocument();
    const scene = normalizeStudioVrmSceneDocument({
      ...base,
      props: serializeVrmProps([createPropInstance("mug", "missing-grip-rig")!]),
    });
    const source = createStudioShared3dSceneSession([{
      elementId: "character-incomplete-grip",
      scene,
    }]).characters[0]!;
    const vrm = { scene: new THREE.Group(), update: vi.fn() } as never;
    applyFingerRotations.mockClear();

    expect(applyStudioBg3dLinkedCharacterState(vrm, source, {
      propRigMetrics: DEFAULT_VRM_PROP_RIG_METRICS,
    })).toBe(false);
    expect(applyFingerRotations).not.toHaveBeenCalled();
  });
});

describe("Studio BG3D shared character shoe grounding", () => {
  it("keeps each projected shoe sole's Y and XZ bound to its own foot", () => {
    const vrm = createShoeGroundingVrm({ leftFootY: 0.5, rightFootY: 0.9 });
    const anchors = measureStudioBg3dSharedCharacterGroundAnchors(vrm, true);
    const left = anchors.find(({ kind }) => kind === "left-foot");
    const right = anchors.find(({ kind }) => kind === "right-foot");

    expect(left?.point[0]).toBeCloseTo(-0.35, 7);
    expect(left?.point[1]).toBeCloseTo(0.25, 7);
    expect(left?.point[2]).toBeCloseTo(0.25, 7);
    expect(right?.point[0]).toBeCloseTo(0.42, 7);
    expect(right?.point[1]).toBeCloseTo(0.6, 7);
    expect(right?.point[2]).toBeCloseTo(-0.22, 7);
  });

  it("selects the actually lower shoe instead of manufacturing a left-foot tie", () => {
    const vrm = createShoeGroundingVrm({ leftFootY: 0.8, rightFootY: 0.35 });
    const anchors = measureStudioBg3dSharedCharacterGroundAnchors(vrm, true);
    const right = anchors.find(({ kind }) => kind === "right-foot");

    expect(right).toBeDefined();
    expect(selectStudioBg3dSharedCharacterSupportPoint(anchors)).toEqual(right?.point);
  });
});

describe("Studio BG3D shared character surface raycast", () => {
  it("skips a hidden single material and selects the next visible surface", () => {
    const scene = new THREE.Scene();
    scene.add(
      groundPlane("hidden-top", 0.1, new THREE.MeshBasicMaterial({ visible: false })),
      groundPlane("visible-floor", -0.05, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "visible-floor",
      point: [0, -0.05, 0],
    });
  });

  it("skips a fully transparent single material and selects the next visible surface", () => {
    const scene = new THREE.Scene();
    scene.add(
      groundPlane(
        "transparent-top",
        0.1,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      ),
      groundPlane("visible-floor", -0.08, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "visible-floor",
      point: [0, -0.08, 0],
    });
  });

  it("uses face.materialIndex for material arrays before accepting a hit", () => {
    const scene = new THREE.Scene();
    scene.add(
      groundPlane(
        "hidden-array-slot",
        0.1,
        [
          new THREE.MeshBasicMaterial(),
          new THREE.MeshBasicMaterial({ visible: false }),
        ],
        1,
      ),
      groundPlane("visible-floor", -0.1, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "visible-floor",
      point: [0, -0.1, 0],
    });
  });

  it("accepts the visible indexed slot even when another array material is hidden", () => {
    const scene = new THREE.Scene();
    scene.add(
      groundPlane(
        "visible-array-slot",
        0.1,
        [
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
          new THREE.MeshBasicMaterial(),
        ],
        1,
      ),
      groundPlane("lower-floor", -0.1, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "visible-array-slot",
      point: [0, 0.1, 0],
    });
  });

  it("continues to reject a surface hidden by an ancestor", () => {
    const scene = new THREE.Scene();
    const hiddenLayer = new THREE.Group();
    hiddenLayer.visible = false;
    hiddenLayer.add(groundPlane("hidden-by-parent", 0.1, new THREE.MeshBasicMaterial()));
    scene.add(
      hiddenLayer,
      groundPlane("visible-floor", -0.06, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "visible-floor",
    });
  });

  it("never lets renderer-only contact overlays become a grounding surface", () => {
    const scene = new THREE.Scene();
    const overlay = groundPlane("contact-overlay", 0.1, new THREE.MeshBasicMaterial());
    overlay.userData.studioBg3dRendererOverlay = true;
    scene.add(
      overlay,
      groundPlane("authored-floor", -0.04, new THREE.MeshBasicMaterial()),
    );

    expect(
      raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]),
    ).toMatchObject({
      source: "background-surface",
      targetEntityId: "authored-floor",
      point: [0, -0.04, 0],
    });
  });

  it("preserves instanced surface identity resolution", () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    const surface = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial(),
      1,
    );
    surface.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.1, 0));
    surface.userData.studioBg3dResolveInstanceId = (instanceId: number) =>
      `instance-${instanceId}`;
    scene.add(surface);

    const hit = raycastStudioBg3dSharedCharacterGroundSurface(scene, [0, 0, 0]);
    expect(hit).toMatchObject({
      source: "background-surface",
      targetEntityId: "instance-0",
    });
    expect(hit.point[1]).toBeCloseTo(0.1, 7);
  });
});
