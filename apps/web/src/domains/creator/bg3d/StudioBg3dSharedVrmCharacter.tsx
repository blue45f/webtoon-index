import { useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";

import { studioShared3dCharacterWorldTransform } from "../studio-shared-3d-scene-bridge";
import { disposeStudioVrmAsset } from "../vrm/studio-vrm-asset-runtime";
import {
  collectStudioVrmCostumeMeshes,
  type StudioVrmCostumeMeshEntry,
} from "../vrm/studio-vrm-costume-runtime";

import { registerStudioBg3dCaptureExcludedObject } from "./studio-bg3d-capture-exclusion";
import {
  resolveStudioBg3dSharedCharacterGrounding,
  type StudioBg3dSharedCharacterGroundAnchor,
  type StudioBg3dSharedCharacterGroundingResult,
  type StudioBg3dSharedCharacterSurfaceHit,
} from "./studio-bg3d-shared-character-grounding";
import {
  createStudioBg3dLinkedVrmRuntimeOwner,
  loadStudioBg3dLinkedVrm,
  type StudioBg3dLinkedVrmRuntimeOwner,
} from "./studio-bg3d-shared-vrm-runtime";
import { StudioBg3dSharedVrmAppearanceRuntime } from "./StudioBg3dSharedVrmAppearanceRuntime";

import type {
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterSource,
} from "../studio-shared-3d-scene-bridge";
import type { VRM } from "@pixiv/three-vrm";

export interface StudioBg3dSharedVrmCharacterProps {
  readonly source: StudioShared3dCharacterSource;
  /** Changes whenever a background transform, visibility, loaded model, or physics pose changes. */
  readonly surfaceRevision: string;
  readonly onStatus: (
    runtimeKey: string,
    status: StudioShared3dCharacterRuntimeStatus,
  ) => void;
  readonly selected?: boolean;
  readonly onSelect?: (elementId: string) => void;
  readonly onGrounding?: (
    runtimeKey: string,
    result: StudioBg3dSharedCharacterGroundingResult | null,
  ) => void;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const SURFACE_NORMAL = new THREE.Vector3();
const SURFACE_NORMAL_MATRIX = new THREE.Matrix3();
const SURFACE_INSTANCE_MATRIX = new THREE.Matrix4();
const SURFACE_WORLD_MATRIX = new THREE.Matrix4();
const WORLD_POINT = new THREE.Vector3();
const MAX_SURFACE_ABOVE_SUPPORT_METERS = 0.15;
const GROUND_RAY_DISTANCE_METERS = 1.4;

interface StudioBg3dSharedVrmAsset {
  readonly vrm: VRM;
  readonly runtimeOwner: StudioBg3dLinkedVrmRuntimeOwner;
  readonly costumeMeshes: StudioVrmCostumeMeshEntry[];
}

function finiteVector(point: THREE.Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function measuredWardrobeSolePoint(
  vrm: VRM,
  side: "left" | "right",
): THREE.Vector3 | null {
  const bounds = new THREE.Box3();
  const candidateBounds = new THREE.Box3();
  let found = false;
  vrm.scene.traverse((object) => {
    if (!object.name.startsWith("wardrobe:shoes:")) return;
    if (object.parent?.name.startsWith("wardrobe:shoes:")) return;
    // Every rigid shoe catalog item owns one sole-bearing root per foot. Boot shafts live on the
    // lower-leg roots and must not influence the sole center or mix the two feet together.
    if (!object.name.endsWith(`:${side}Foot`)) return;
    candidateBounds.setFromObject(object, true);
    if (
      candidateBounds.isEmpty()
      || !finiteVector(candidateBounds.min)
      || !finiteVector(candidateBounds.max)
    ) return;
    if (!found) bounds.copy(candidateBounds);
    else bounds.union(candidateBounds);
    found = true;
  });
  if (!found || !Number.isFinite(bounds.min.y)) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  center.y = bounds.min.y;
  return finiteVector(center) ? center : null;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure grounding geometry shares the runtime's exact shoe-root contract with tests.
export function measureStudioBg3dSharedCharacterGroundAnchors(
  vrm: VRM,
  includeProjectedShoes: boolean,
): StudioBg3dSharedCharacterGroundAnchor[] {
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene, true);
  const boundsValid = !bounds.isEmpty() && finiteVector(bounds.min) && finiteVector(bounds.max);
  const characterHeight = boundsValid ? Math.max(0.1, bounds.max.y - bounds.min.y) : 1.7;
  const anchors: StudioBg3dSharedCharacterGroundAnchor[] = [];

  const addFoot = (side: "left" | "right") => {
    const foot = vrm.humanoid?.getRawBoneNode(`${side}Foot`);
    if (!foot) return;
    const footPoint = foot.getWorldPosition(new THREE.Vector3());
    const toes = vrm.humanoid?.getRawBoneNode(`${side}Toes`);
    const toesPoint = toes?.getWorldPosition(new THREE.Vector3()) ?? null;
    const supportPoint = toesPoint && finiteVector(toesPoint) && toesPoint.y < footPoint.y
      ? toesPoint
      : footPoint;
    if (!finiteVector(supportPoint)) return;
    // VRM foot nodes normally sit slightly above the visible sole. Toes need only a small offset;
    // ankle-only rigs need a larger, height-relative estimate. Both stay bounded and deterministic.
    const soleOffset = toesPoint
      ? THREE.MathUtils.clamp(characterHeight * 0.008, 0.006, 0.025)
      : THREE.MathUtils.clamp(characterHeight * 0.028, 0.02, 0.065);
    const wardrobeSolePoint = includeProjectedShoes
      ? measuredWardrobeSolePoint(vrm, side)
      : null;
    anchors.push({
      kind: `${side}-foot`,
      point: wardrobeSolePoint
        ? [wardrobeSolePoint.x, wardrobeSolePoint.y, wardrobeSolePoint.z]
        : [supportPoint.x, supportPoint.y - soleOffset, supportPoint.z],
    });
  };

  addFoot("left");
  addFoot("right");
  if (boundsValid && anchors.length < 3) {
    anchors.push({
      kind: "lower-bound",
      point: [
        (bounds.min.x + bounds.max.x) / 2,
        bounds.min.y,
        (bounds.min.z + bounds.max.z) / 2,
      ],
    });
  }
  if (anchors.length === 0) {
    const rootPoint = vrm.scene.getWorldPosition(new THREE.Vector3());
    anchors.push({ kind: "lower-bound", point: [rootPoint.x, rootPoint.y, rootPoint.z] });
  }
  return anchors;
}

// eslint-disable-next-line react-refresh/only-export-components -- deterministic support selection is part of the capture grounding contract.
export function selectStudioBg3dSharedCharacterSupportPoint(
  anchors: readonly StudioBg3dSharedCharacterGroundAnchor[],
): StudioBg3dSharedCharacterGroundAnchor["point"] {
  const feet = anchors.filter(({ kind }) => kind !== "lower-bound");
  const candidates = feet.length > 0 ? feet : anchors;
  return [...candidates].sort((left, right) => (
    left.point[1] - right.point[1]
      || (left.kind === "left-foot" ? -1 : right.kind === "left-foot" ? 1 : 0)
  ))[0]!.point;
}

function surfaceIdentity(object: THREE.Object3D, instanceId?: number):
  | { source: "background-surface"; targetEntityId: string }
  | { source: "stage-plane" }
  | null {
  let current: THREE.Object3D | null = object;
  let identity:
    | { source: "background-surface"; targetEntityId: string }
    | { source: "stage-plane" }
    | null = null;
  while (current) {
    // THREE.Raycaster also reports objects hidden by an ancestor. Hidden background layers must
    // never become an invisible floor for a shared character.
    if (!current.visible) return null;
    if (
      current.userData.studioBg3dSharedCharacterSelection === true
      || current.userData.studioBg3dRendererOverlay === true
    ) return null;
    if (!identity) {
      const resolveInstanceId = current.userData.studioBg3dResolveInstanceId;
      if (typeof resolveInstanceId === "function" && Number.isSafeInteger(instanceId)) {
        try {
          const resolvedId: unknown = resolveInstanceId(instanceId);
          if (typeof resolvedId === "string" && resolvedId.length > 0) {
            identity = { source: "background-surface", targetEntityId: resolvedId };
          }
        } catch {
          return null;
        }
      }
      const entityId = current.userData.studioBg3dEntityId;
      if (!identity && typeof entityId === "string" && entityId.length > 0) {
        identity = { source: "background-surface", targetEntityId: entityId };
      }
      if (!identity && current.userData.studioBg3dGroundSurfaceId === "stage-plane") {
        identity = { source: "stage-plane" };
      }
    }
    current = current.parent;
  }
  return identity;
}

function intersectionUsesVisibleSurfaceMaterial(intersection: THREE.Intersection): boolean {
  const mesh = intersection.object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const materials = mesh.material;
  const material = Array.isArray(materials)
    ? materials[intersection.face?.materialIndex ?? -1]
    : materials;
  if (!material || material.visible === false) return false;
  return !(material.transparent === true && material.opacity <= 0);
}

// eslint-disable-next-line react-refresh/only-export-components -- 순수 surface 판정은 R3F 컴포넌트와 동일한 raycast 경계의 회귀 테스트 계약이다.
export function raycastStudioBg3dSharedCharacterGroundSurface(
  scene: THREE.Scene,
  supportPoint: StudioBg3dSharedCharacterGroundAnchor["point"],
): StudioBg3dSharedCharacterSurfaceHit {
  // R3F commits transforms before layout effects, but raw Raycaster does not refresh matrices.
  // Force the exact committed background transforms into matrixWorld before measuring a surface.
  scene.updateMatrixWorld(true);
  const origin = new THREE.Vector3(
    supportPoint[0],
    supportPoint[1] + MAX_SURFACE_ABOVE_SUPPORT_METERS,
    supportPoint[2],
  );
  const raycaster = new THREE.Raycaster(origin, DOWN, 0, GROUND_RAY_DISTANCE_METERS);
  const intersections = raycaster.intersectObjects(scene.children, true);
  for (const intersection of intersections) {
    const identity = surfaceIdentity(intersection.object, intersection.instanceId);
    if (!identity || !intersection.face || !intersectionUsesVisibleSurfaceMaterial(intersection)) {
      continue;
    }
    const instanced = intersection.object as THREE.InstancedMesh;
    let normalWorldMatrix = intersection.object.matrixWorld;
    if (intersection.instanceId !== undefined && instanced.isInstancedMesh) {
      instanced.getMatrixAt(intersection.instanceId, SURFACE_INSTANCE_MATRIX);
      normalWorldMatrix = SURFACE_WORLD_MATRIX.multiplyMatrices(
        instanced.matrixWorld,
        SURFACE_INSTANCE_MATRIX,
      );
    }
    SURFACE_NORMAL
      .copy(intersection.face.normal)
      .applyNormalMatrix(SURFACE_NORMAL_MATRIX.getNormalMatrix(normalWorldMatrix));
    if (!finiteVector(SURFACE_NORMAL) || SURFACE_NORMAL.y < 0.25) continue;
    WORLD_POINT.copy(intersection.point);
    if (!finiteVector(WORLD_POINT)) continue;
    if (WORLD_POINT.y > supportPoint[1] + MAX_SURFACE_ABOVE_SUPPORT_METERS) continue;
    const point = [WORLD_POINT.x, WORLD_POINT.y, WORLD_POINT.z] as const;
    const normal = [SURFACE_NORMAL.x, SURFACE_NORMAL.y, SURFACE_NORMAL.z] as const;
    return identity.source === "background-surface"
      ? { source: identity.source, targetEntityId: identity.targetEntityId, point, normal }
      : { source: identity.source, point, normal };
  }
  return {
    source: "stage-plane",
    point: [supportPoint[0], 0, supportPoint[2]],
    normal: [0, 1, 0],
  };
}

function resolveCurrentAppearanceGrounding(
  currentAsset: StudioBg3dSharedVrmAsset,
  source: StudioShared3dCharacterSource,
  threeScene: THREE.Scene,
): StudioBg3dSharedCharacterGroundingResult {
  const wardrobe = source.compatibility.appearanceProjection.wardrobe;
  const includesProjectedShoes = wardrobe.status === "supported"
    && wardrobe.slots.some((slot) => slot.slot === "shoes");
  const anchors = measureStudioBg3dSharedCharacterGroundAnchors(
    currentAsset.vrm,
    includesProjectedShoes,
  );
  return resolveStudioBg3dSharedCharacterGrounding({
    identity: {
      ...(source.stageId ? { stageId: source.stageId } : {}),
      elementId: source.elementId,
      modelRuntimeKey: source.modelRuntimeKey,
      placementHash: source.placementHash,
    },
    placementY: source.stageTransform.position[1],
    anchors,
    surfaceHit: raycastStudioBg3dSharedCharacterGroundSurface(
      threeScene,
      selectStudioBg3dSharedCharacterSupportPoint(anchors),
    ),
    options: { soleClearanceMeters: 0.006 },
  });
}

/**
 * Runtime projection of one canonical VRM source into the BG3D R3F scene. The component owns only
 * its loaded runtime clone. Stage placement is an override owned by the page Stage while model,
 * pose and appearance remain source-owned; Three object state never becomes authority.
 */
export default function StudioBg3dSharedVrmCharacter({
  source,
  surfaceRevision,
  onStatus,
  selected = false,
  onSelect,
  onGrounding,
}: StudioBg3dSharedVrmCharacterProps) {
  const threeScene = useThree((state) => state.scene);
  // MToon compiles to one backend or the other, never both, so the renderer that will draw this
  // character decides which build gets loaded. Reading it from the R3F store keeps the decision at
  // the only place that actually knows — an engine fallback remounts the Canvas, which remounts
  // this component, which reloads the character against the renderer that replaced it.
  const materialVariant = useThree((state) =>
    (state.gl as { readonly isWebGPURenderer?: boolean }).isWebGPURenderer === true
      ? ("webgpu-node" as const)
      : ("webgl-shader" as const));
  const [asset, setAsset] = useState<StudioBg3dSharedVrmAsset | null>(null);
  const appearanceReadyIdentityRef = useRef<string | null>(null);
  const reportCurrentStatus = useEffectEvent(
    (status: StudioShared3dCharacterRuntimeStatus) =>
      onStatus(source.runtimeKey, status),
  );
  const loadCurrentModel = useEffectEvent(() =>
    loadStudioBg3dLinkedVrm(source.scene, { materialVariant }));
  const reportCurrentGrounding = useEffectEvent(
    (result: StudioBg3dSharedCharacterGroundingResult | null) =>
      onGrounding?.(source.runtimeKey, result),
  );

  useEffect(() => {
    let cancelled = false;
    let ownedVrm: VRM | null = null;
    let ownedRuntime: StudioBg3dLinkedVrmRuntimeOwner | null = null;
    setAsset(null);
    appearanceReadyIdentityRef.current = null;
    reportCurrentStatus("loading");
    reportCurrentGrounding(null);

    void loadCurrentModel().then((loaded) => {
      ownedVrm = loaded;
      if (cancelled) {
        disposeStudioVrmAsset(loaded);
        ownedVrm = null;
        return;
      }
      // Capture the model-owned rest hierarchy before any pose, root transform, legacy bodyScale,
      // material state, or procedural attachment becomes externally addressable.
      const runtimeResult = createStudioBg3dLinkedVrmRuntimeOwner(
        loaded,
        source.modelRuntimeKey,
      );
      if (!runtimeResult.ok) {
        disposeStudioVrmAsset(loaded);
        ownedVrm = null;
        reportCurrentStatus("unavailable");
        return;
      }
      ownedRuntime = runtimeResult.owner;
      const costumeMeshes = collectStudioVrmCostumeMeshes(loaded);
      setAsset({ vrm: loaded, runtimeOwner: runtimeResult.owner, costumeMeshes });
    }).catch(() => {
      if (!cancelled) {
        if (ownedRuntime) {
          ownedRuntime.dispose();
          ownedRuntime = null;
        }
        if (ownedVrm) disposeStudioVrmAsset(ownedVrm);
        ownedVrm = null;
        reportCurrentStatus("unavailable");
      }
    });

    return () => {
      cancelled = true;
      setAsset(null);
      appearanceReadyIdentityRef.current = null;
      if (ownedRuntime) {
        // Dispose restores the cached neutral rig while this exact generation is still current.
        // The owner invalidates its generation immediately afterwards, before the VRM is released.
        ownedRuntime.dispose();
        ownedRuntime = null;
      }
      if (ownedVrm) {
        disposeStudioVrmAsset(ownedVrm);
        ownedVrm = null;
      }
      reportCurrentGrounding(null);
    };
  }, [source.elementId, source.modelRuntimeKey]);

  const appearanceIdentityKey = JSON.stringify([
    source.runtimeKey,
    source.placementHash,
    source.compatibility.appearanceProjection.signature,
  ]);

  function handleAppearanceStatus(
    identityKey: string,
    status: StudioShared3dCharacterRuntimeStatus,
  ) {
    if (identityKey !== appearanceIdentityKey) return;
    if (status !== "ready") {
      appearanceReadyIdentityRef.current = null;
      onGrounding?.(source.runtimeKey, null);
      onStatus(source.runtimeKey, status);
      return;
    }
    if (!asset) return;
    appearanceReadyIdentityRef.current = identityKey;
    onGrounding?.(
      source.runtimeKey,
      resolveCurrentAppearanceGrounding(asset, source, threeScene),
    );
    onStatus(source.runtimeKey, "ready");
  }

  // Background transforms may change without restarting the exact appearance generation. Only
  // grounding is recomputed; attachment receipts are generation-bound and never replayed.
  useLayoutEffect(() => {
    if (!asset || appearanceReadyIdentityRef.current !== appearanceIdentityKey) return;
    reportCurrentGrounding(resolveCurrentAppearanceGrounding(asset, source, threeScene));
  }, [appearanceIdentityKey, asset, source, surfaceRevision, threeScene]);

  if (!asset) return null;
  const { vrm } = asset;
  const transform = studioShared3dCharacterWorldTransform(
    source.scene,
    source.stageTransform,
  );
  const helperPosition = [
    transform.position[0],
    transform.position[1] + 1.135 * transform.scale[1],
    transform.position[2],
  ] as const;
  const helperScale = [
    1.44 * transform.scale[0],
    2.43 * transform.scale[1],
    0.96 * transform.scale[2],
  ] as const;

  return (
    <group>
      <primitive object={vrm.scene} dispose={null} />
      <StudioBg3dSharedVrmAppearanceRuntime
        key={JSON.stringify([
          source.runtimeKey,
          source.placementHash,
          source.compatibility.appearanceProjection.signature,
        ])}
        vrm={vrm}
        source={source}
        runtimeOwner={asset.runtimeOwner}
        costumeMeshes={asset.costumeMeshes}
        onStatus={handleAppearanceStatus}
      />
      {onSelect ? (
        <mesh
          ref={registerStudioBg3dCaptureExcludedObject}
          userData={{ studioBg3dSharedCharacterSelection: true }}
          position={helperPosition}
          rotation={[0, transform.rotation[1], 0]}
          scale={helperScale}
          renderOrder={selected ? 10 : 0}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(source.elementId);
          }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#8b5cf6"
            depthTest={!selected}
            depthWrite={false}
            opacity={selected ? 0.72 : 0.002}
            transparent
            wireframe
          />
        </mesh>
      ) : null}
    </group>
  );
}
