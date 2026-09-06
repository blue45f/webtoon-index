import * as THREE from "three";

import type { VrmPropFaceSocket } from "./studio-vrm-prop-rig";
import type { PropAttachBone, Vec3 } from "./studio-vrm-props";
import type { VRM } from "@pixiv/three-vrm";

export interface StudioVrmHeadSurface {
  head: number;
  eyeDistance: number;
  eyeDistanceSource: "measured" | "derived";
  faceSocket: VrmPropFaceSocket;
}

const SAMPLE_BUDGET = 24_000;
const MIN_SAMPLES = 80;

function quantile(values: number[], fraction: number): number {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * fraction)]!;
}

/** Bounded, pose-aware surface measurement. Bone pivots are not skull dimensions. */
export function measureStudioVrmHeadSurface(vrm: VRM): StudioVrmHeadSurface | null {
  const head = vrm.humanoid?.getNormalizedBoneNode("head");
  const rawHead = vrm.humanoid?.getRawBoneNode?.("head");
  if (!head || !rawHead || !vrm.scene?.traverse) return null;
  vrm.scene.updateMatrixWorld(true);
  head.updateWorldMatrix(true, false);
  const facing = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), vrm.meta?.metaVersion === "0" ? Math.PI : 0,
  );
  const inverseFacing = facing.clone().invert();
  const inverseHead = head.matrixWorld.clone().invert();
  const headDescendants = new Set<THREE.Object3D>();
  rawHead.traverse((object) => { headDescendants.add(object); });
  const meshes: THREE.SkinnedMesh[] = [];
  let vertexCount = 0;
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const geometry = mesh.geometry;
    if (!geometry.getAttribute("position") || !geometry.getAttribute("skinIndex") || !geometry.getAttribute("skinWeight")) return;
    meshes.push(mesh);
    vertexCount += geometry.getAttribute("position").count;
  });
  const stride = Math.max(1, Math.ceil(vertexCount / SAMPLE_BUDGET));
  const points: THREE.Vector3[] = [];
  let visited = 0;
  for (const mesh of meshes) {
    if (visited >= SAMPLE_BUDGET) break;
    mesh.skeleton.update();
    const eligible = mesh.skeleton.bones.map((bone) => headDescendants.has(bone));
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const indices = geometry.getAttribute("skinIndex");
    const weights = geometry.getAttribute("skinWeight");
    const toHead = inverseHead.clone().multiply(mesh.matrixWorld);
    for (let index = 0; index < position.count && visited < SAMPLE_BUDGET; index += stride) {
      visited++;
      let influence = 0;
      for (let component = 0; component < 4; component++) {
        if (eligible[indices.getComponent(index, component)]) influence += weights.getComponent(index, component);
      }
      if (influence < 0.5) continue;
      const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(toHead).applyQuaternion(inverseFacing);
      if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
      // Discard neck, hanging hair and remote head-weighted decorations.
      if (point.y <= 0.004 || point.y > 0.48 || Math.abs(point.x) > 0.30 || Math.abs(point.z) > 0.30) continue;
      points.push(point);
    }
  }
  if (points.length < MIN_SAMPLES) return null;
  const top = quantile(points.map((point) => point.y), 0.98);
  const width = quantile(points.map((point) => point.x), 0.975) - quantile(points.map((point) => point.x), 0.025);
  if (top < 0.06 || top > 0.45 || width < 0.07 || width > 0.42) return null;
  let eyeY = top * 0.56;
  let eyeDistance = width * 0.35;
  let eyeDistanceSource: "measured" | "derived" = "derived";
  const eyes = ["leftEye", "rightEye"] as const;
  const eyeNodes = eyes.map((name) => vrm.humanoid.getNormalizedBoneNode(name));
  if (eyeNodes[0] && eyeNodes[1]) {
    const positions = eyeNodes.map((node) => node!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseHead).applyQuaternion(inverseFacing));
    const pivotY = (positions[0]!.y + positions[1]!.y) / 2;
    const span = Math.abs(positions[0]!.x - positions[1]!.x);
    // Some imported eye pivots are deep inside the skull; reject that as a fitting landmark.
    if (pivotY >= top * 0.20 && pivotY <= top * 0.80) eyeY = pivotY;
    if (span >= width * 0.25 && span <= width * 0.60) {
      eyeDistance = span;
      eyeDistanceSource = "measured";
    }
  }
  const faceBand = points.filter((point) => Math.abs(point.y - eyeY) < top * 0.16 && Math.abs(point.x) < width * 0.28);
  if (faceBand.length < 16) return null;
  const front = quantile(faceBand.map((point) => point.z), 0.96) + 0.004;
  if (front < 0.01 || front > 0.25) return null;
  const worldScale = head.getWorldScale(new THREE.Vector3());
  const local = new THREE.Vector3(0, eyeY, front).applyQuaternion(facing);
  return {
    head: width * Math.abs(worldScale.x),
    eyeDistance: eyeDistance * Math.abs(worldScale.x),
    eyeDistanceSource,
    faceSocket: {
      position: local.toArray() as Vec3,
      rotationQuaternion: [facing.x, facing.y, facing.z, facing.w],
      rotationDeg: [0, vrm.meta?.metaVersion === "0" ? 180 : 0, 0],
      source: "measured",
      surfaceMeasured: true,
      surfaceCrownHeight: top,
      ...(points.some((point) => point.y > top + 0.015) ? { hairClearanceRequired: true } : {}),
    },
  };
}

/** Only the reviewed v5 headwear uses these authored contact profiles. */
export function studioVrmHeadwearSurfaceSocket(
  id: string, bone: PropAttachBone, socket: VrmPropFaceSocket,
): VrmPropFaceSocket | null {
  if (bone !== "head" || !socket.surfaceMeasured || !Number.isFinite(socket.surfaceCrownHeight)) return null;
  const crown = socket.surfaceCrownHeight!;
  const facing = new THREE.Quaternion(...socket.rotationQuaternion);
  const face = new THREE.Vector3(...socket.position).applyQuaternion(facing.clone().invert());
  let position: Vec3;
  switch (id) {
    case "cap": position = [0, crown * 0.437, 0]; break;
    case "beret": position = [0, crown * 0.84, 0]; break;
    case "beanie": position = [0, crown * 0.70, 0]; break;
    case "blender_wizard_hat": position = [0, crown * 0.784, 0]; break;
    case "headphones": position = [0, face.y + 0.012, 0]; break;
    case "ribbon": position = [-face.z * 1.2, crown * 0.812, 0]; break;
    default: return null;
  }
  const point = new THREE.Vector3(...position).applyQuaternion(facing);
  return { ...socket, position: point.toArray() as Vec3 };
}
