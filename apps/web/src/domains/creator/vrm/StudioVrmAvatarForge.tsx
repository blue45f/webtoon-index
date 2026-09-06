import { createPortal } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import {
  createStudioVrmAuthoredHairGeometry,
  createStudioVrmAuthoredHairGradientTexture,
  mergeStudioVrmAuthoredHairGeometry,
  type StudioVrmAuthoredHairInstance,
} from "./studio-vrm-authored-hair-geometry";
import {
  buildAvatarForgeHairParts,
  sanitizeAvatarForgeState,
  type AvatarForgeFaceAccent,
  type AvatarForgeHairPart,
  type AvatarForgeHairParams,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { classifyMeshName } from "./studio-vrm-costume";
import { applyStudioVrmSemanticFaceMorphs } from "./studio-vrm-semantic-face-morph";

import type { StudioVrmAvatarForgeFaceController } from "./studio-vrm-avatar-forge-face-controller";
import type { VRM } from "@pixiv/three-vrm";

const AVATAR_FORGE_MARKER = "toonSpectrumAvatarForge";
const AVATAR_FORGE_OWNED_TEXTURES = "toonSpectrumAvatarForgeOwnedTextures";
const HAIR_VISIBILITY_LEASES = new WeakMap<THREE.Object3D, { count: number; visible: boolean }>();

type HeadFit = {
  center: THREE.Vector3;
  eyeCenter: THREE.Vector3;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  frontSign: 1 | -1;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function materialNames(mesh: THREE.Mesh): string[] {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.map((material) => material?.name?.trim()).filter((name): name is string => Boolean(name));
}

function isGeneratedForgeObject(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData[AVATAR_FORGE_MARKER] === true) return true;
    current = current.parent;
  }
  return false;
}

/**
 * 보수적으로 "독립 교체 가능한" 헤어 메시만 찾는다.
 * Body/Face 하나에 skin+hair material이 함께 구워진 VRoid 메시 등은 절대 숨기지 않는다.
 */
function detectReplaceableHairMeshes(vrm: VRM | null): THREE.Mesh[] {
  if (!vrm) return [];
  const detected: THREE.Mesh[] = [];

  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || isGeneratedForgeObject(mesh)) return;

    const names = materialNames(mesh);
    const meshClass = classifyMeshName(mesh.name);
    const materialClasses = names.map((name) => classifyMeshName(name));
    const hasContraryMaterial = materialClasses.some(
      (classification) =>
        (classification.protected !== null && classification.protected !== "hair") || classification.slot !== null
    );

    // 이름 자체가 얼굴/피부/눈/몸통이면 결합 메시로 간주한다. Hair 재질이 섞여 있어도 안전 우선.
    if (meshClass.protected !== null && meshClass.protected !== "hair") return;
    if (meshClass.slot !== null || hasContraryMaterial) return;

    if (meshClass.protected === "hair") {
      detected.push(mesh);
      return;
    }

    // 일반 노드명(Node_001 등)은 모든 명시적 재질이 헤어일 때만 허용한다.
    if (names.length > 0 && materialClasses.every((classification) => classification.protected === "hair")) {
      detected.push(mesh);
    }
  });

  return detected;
}

/** UI에서 "교체 가능한 원본 헤어 N개"를 안내할 때 쓰는 비파괴 탐지 헬퍼. */
// 이 파일에서 component와 함께 export해 인티그레이션 측의 추가 순회 import를 피한다.
// eslint-disable-next-line react-refresh/only-export-components
export function countDetectedVrmHairMeshes(vrm: VRM | null): number {
  return detectReplaceableHairMeshes(vrm).length;
}

/**
 * `replaceOriginal` 은 "모델이 가진 헤어를 감춘다"는 작가의 명시적 의사다. 스타일과 무관하게
 * 그대로 지킨다 — `style: "none"` 과의 조합이 바로 민머리를 만드는 방법이고(모자 착용, 표면에
 * 직접 그릴 헤어), 원본을 되돌리는 조작은 스타일 선택이 아니라 이 토글을 끄는 것이다. 예전에는
 * "none" 을 예외로 두어 헤어를 감추지 않았는데, 그러면 "원본 헤어를 숨깁니다" 라고 적힌 카드가
 * 적용된 것처럼 보이면서 화면은 그대로인 상태가 된다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldHideAuthoredVrmHair(hair: Pick<AvatarForgeHairParams, "replaceOriginal">): boolean {
  return hair.replaceOriginal === true;
}

/**
 * 헤어 메시 가시성 "리스"를 획득한다(참조 카운팅 + 원복).
 *
 * 계약:
 *  1) 첫 획득 시에만 원래 visible 값을 기억한다.
 *  2) 중첩 획득은 카운트만 올린다(같은 메시를 여러 이펙트가 숨겨도 안전).
 *  3) 마지막 반납에서만 원래 값으로 되돌린다 → 다른 시스템이 `mesh.visible = true`로
 *     덮어쓰는 사고를 막는다.
 *
 * 워드로브(studio-vrm-wardrobe-catalogue.ts)도 같은 규약을 쓰되 **대상 집합이 서로소**다.
 * 여기서는 `classifyMeshName().protected === "hair"`인 메시만, 워드로브는 `slot !== null`인
 * 메시만 잡는다. 그래서 두 시스템이 같은 메시의 visible을 두고 다투는 상황 자체가 없다.
 */
function acquireHiddenHair(meshes: readonly THREE.Mesh[]) {
  for (const mesh of meshes) {
    const lease = HAIR_VISIBILITY_LEASES.get(mesh);
    if (lease) {
      lease.count += 1;
    } else {
      HAIR_VISIBILITY_LEASES.set(mesh, { count: 1, visible: mesh.visible });
    }
    mesh.visible = false;
  }

  return () => {
    for (const mesh of meshes) {
      const lease = HAIR_VISIBILITY_LEASES.get(mesh);
      if (!lease) continue;
      lease.count -= 1;
      if (lease.count > 0) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = lease.visible;
      HAIR_VISIBILITY_LEASES.delete(mesh);
    }
  };
}

function localPosition(head: THREE.Object3D, bone: THREE.Object3D | null) {
  if (!bone) return null;
  return head.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
}

function measureHeadFit(vrm: VRM, head: THREE.Object3D): HeadFit {
  vrm.scene.updateMatrixWorld(true);
  head.updateWorldMatrix(true, true);

  const leftEye = localPosition(head, vrm.humanoid?.getNormalizedBoneNode("leftEye") ?? null);
  const rightEye = localPosition(head, vrm.humanoid?.getNormalizedBoneNode("rightEye") ?? null);
  const hasEyePair = Boolean(leftEye && rightEye && leftEye.distanceTo(rightEye) > 1e-4);
  const eyeCenter = hasEyePair
    ? leftEye!.clone().add(rightEye!).multiplyScalar(0.5)
    : new THREE.Vector3(0, 0.061, 0.018);

  const explicitFront = vrm.lookAt?.faceFront?.z;
  const inferredFront = Math.abs(eyeCenter.z) > 0.002 ? Math.sign(eyeCenter.z) : 1;
  const frontSign: 1 | -1 = (Math.abs(explicitFront ?? 0) > 0.5 ? Math.sign(explicitFront!) : inferredFront) < 0 ? -1 : 1;

  const sceneSize = new THREE.Box3().setFromObject(vrm.scene).getSize(new THREE.Vector3());
  const worldScale = head.getWorldScale(new THREE.Vector3());
  const localHeight = clamp(sceneSize.y / Math.max(0.001, Math.abs(worldScale.y)), 0.75, 3.5);
  const eyeDistance = hasEyePair ? leftEye!.distanceTo(rightEye!) : 0;
  const radiusX = hasEyePair
    ? clamp(eyeDistance * 2.15, localHeight * 0.035, localHeight * 0.07)
    : localHeight * 0.044;
  const radiusY = radiusX * 1.18;
  const radiusZ = radiusX * 0.95;
  const center = new THREE.Vector3(
    eyeCenter.x,
    eyeCenter.y + radiusY * 0.18,
    eyeCenter.z - frontSign * radiusZ * 0.56
  );

  return { center, eyeCenter, radiusX, radiusY, radiusZ, frontSign };
}

/** The shipped runtime and tests share the same authored clump generator. */
// eslint-disable-next-line react-refresh/only-export-components
export function createAvatarForgeHairGeometry(part: AvatarForgeHairPart) {
  return createStudioVrmAuthoredHairGeometry(part);
}

function transformHairPart(part: AvatarForgeHairPart, fit: HeadFit) {
  const scaleX = fit.radiusX / 0.56;
  const scaleY = fit.radiusY / 0.46;
  const scaleZ = fit.radiusZ / 0.54;
  const position = new THREE.Vector3(
    fit.center.x + part.position[0] * scaleX,
    fit.center.y + (part.position[1] - 0.18) * scaleY,
    fit.center.z + (part.position[2] - 0.015) * scaleZ * fit.frontSign
  );
  const rotation = new THREE.Euler(
    part.rotation[0] * fit.frontSign,
    part.rotation[1],
    part.rotation[2],
    "XYZ"
  );
  const scale = new THREE.Vector3(
    part.scale[0] * scaleX,
    part.scale[1] * scaleY,
    part.scale[2] * scaleZ
  );
  return { position, rotation, scale };
}

function authoredHairInstance(
  part: AvatarForgeHairPart,
  fit: HeadFit,
): StudioVrmAuthoredHairInstance {
  const transform = transformHairPart(part, fit);
  const matrix = new THREE.Matrix4().compose(
    transform.position,
    new THREE.Quaternion().setFromEuler(transform.rotation),
    transform.scale,
  );
  return Object.freeze({ part, matrix });
}

function createExpandedOutlineGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const outline = source.clone();
  const position = outline.getAttribute("position");
  const normal = outline.getAttribute("normal");
  if (!position || !normal) return outline;
  outline.computeBoundingSphere();
  const thickness = Math.max(0.00045, (outline.boundingSphere?.radius ?? 0.08) * 0.0085);
  const values = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    values[index * 3] = position.getX(index) + normal.getX(index) * thickness;
    values[index * 3 + 1] = position.getY(index) + normal.getY(index) * thickness;
    values[index * 3 + 2] = position.getZ(index) + normal.getZ(index) * thickness;
  }
  outline.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  outline.computeBoundingBox();
  outline.computeBoundingSphere();
  return outline;
}

function createHairMaterial(state: AvatarForgeState, gradientMap: THREE.DataTexture) {
  const material = new THREE.MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap,
    side: THREE.DoubleSide,
  });
  material.emissive.set(state.hair.baseColor);
  material.emissiveIntensity = clamp(0.012 + state.hair.shine * 0.045, 0.012, 0.057);
  return material;
}

function createHairOutlineMaterial(state: AvatarForgeState) {
  const outline = new THREE.Color(state.hair.shadowColor ?? state.hair.baseColor)
    .lerp(new THREE.Color("#090708"), 0.62);
  return new THREE.MeshBasicMaterial({
    color: outline,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
}

function addHairParts(group: THREE.Group, state: AvatarForgeState, fit: HeadFit) {
  const parts = buildAvatarForgeHairParts(state);
  const merged = mergeStudioVrmAuthoredHairGeometry(
    parts.map((part) => authoredHairInstance(part, fit)),
  );
  if (!merged) return;

  const gradientMap = createStudioVrmAuthoredHairGradientTexture();
  const mesh = new THREE.Mesh(merged, createHairMaterial(state, gradientMap));
  const outline = new THREE.Mesh(
    createExpandedOutlineGeometry(merged),
    createHairOutlineMaterial(state),
  );
  mesh.name = "ToonSpectrumAvatarForgeHair_AuthoredMerged";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 6;
  mesh.userData.partCount = parts.length;
  outline.name = "ToonSpectrumAvatarForgeHairOutline_AuthoredMerged";
  outline.renderOrder = 5;
  outline.userData.partCount = parts.length;
  group.userData[AVATAR_FORGE_OWNED_TEXTURES] = [gradientMap];
  group.add(outline, mesh);
}

function faceSurfaceZ(fit: HeadFit, x: number, y: number, outset: number) {
  const normalizedX = (x - fit.center.x) / Math.max(1e-5, fit.radiusX);
  const normalizedY = (y - fit.center.y) / Math.max(1e-5, fit.radiusY);
  const surface = Math.sqrt(Math.max(0.06, 1 - normalizedX * normalizedX - normalizedY * normalizedY));
  return fit.center.z + fit.frontSign * (fit.radiusZ * surface + outset);
}

function createAccentMaterial(accent: AvatarForgeFaceAccent, opacityMultiplier = 1) {
  return new THREE.MeshBasicMaterial({
    color: accent.color,
    transparent: true,
    opacity: clamp(accent.intensity * opacityMultiplier, 0.04, 0.82),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function addFaceDisc(
  group: THREE.Group,
  fit: HeadFit,
  accent: AvatarForgeFaceAccent,
  id: string,
  x: number,
  y: number,
  radius: number,
  scaleX = 1,
  opacityMultiplier = 1
) {
  const geometry = new THREE.CircleGeometry(radius, 18);
  const material = createAccentMaterial(accent, opacityMultiplier);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `ToonSpectrumAvatarForgeFaceAccent_${id}`;
  mesh.position.set(x, y, faceSurfaceZ(fit, x, y, radius * 0.06));
  mesh.scale.x = scaleX;
  if (fit.frontSign < 0) mesh.rotation.y = Math.PI;
  mesh.renderOrder = 12;
  group.add(mesh);
}

function addFaceAccents(group: THREE.Group, state: AvatarForgeState, fit: HeadFit) {
  for (const accent of state.faceAccents ?? []) {
    if (!accent.enabled || accent.intensity <= 0) continue;

    if (accent.id === "blush") {
      const cheekY = fit.eyeCenter.y - fit.radiusY * (0.22 + state.face.chinLength * 0.03);
      const cheekX = fit.radiusX * (0.52 + state.face.cheekVolume * 0.07);
      const radius = fit.radiusY * (0.105 + state.face.cheekVolume * 0.035);
      addFaceDisc(group, fit, accent, "blush-left", fit.center.x - cheekX, cheekY, radius, 1.75, 0.52);
      addFaceDisc(group, fit, accent, "blush-right", fit.center.x + cheekX, cheekY, radius, 1.75, 0.52);
      continue;
    }

    if (accent.id === "freckles") {
      const points = [
        [-0.38, -0.11], [-0.25, -0.16], [-0.11, -0.13],
        [0.12, -0.12], [0.26, -0.17], [0.39, -0.1],
      ] as const;
      points.forEach(([x, y], index) => {
        addFaceDisc(
          group,
          fit,
          accent,
          `freckle-${index}`,
          fit.center.x + fit.radiusX * x,
          fit.eyeCenter.y + fit.radiusY * y,
          fit.radiusX * (index % 2 === 0 ? 0.018 : 0.014),
          1,
          0.8
        );
      });
      continue;
    }

    if (accent.id === "beauty-mark") {
      addFaceDisc(
        group,
        fit,
        accent,
        "beauty-mark",
        fit.center.x + fit.radiusX * 0.34,
        fit.eyeCenter.y - fit.radiusY * 0.28,
        fit.radiusX * 0.026,
        1,
        0.9
      );
    }
  }
}

function buildAvatarForgeObject(state: AvatarForgeState, fit: HeadFit) {
  const group = new THREE.Group();
  group.name = "ToonSpectrumAvatarForge";
  group.userData[AVATAR_FORGE_MARKER] = true;
  addHairParts(group, state, fit);
  addFaceAccents(group, state, fit);
  return group;
}

function disposeAvatarForgeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const childMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    childMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const textures = object.userData[AVATAR_FORGE_OWNED_TEXTURES];
  if (Array.isArray(textures)) {
    for (const texture of textures) {
      if (texture instanceof THREE.Texture) texture.dispose();
    }
  }
}

export type StudioVrmAvatarForgeProps = {
  vrm: VRM;
  state: AvatarForgeState;
  rigRevision: number;
  faceController: StudioVrmAvatarForgeFaceController;
};

/**
 * rigged VRM을 유지한 채 normalized head에 절차형 헤어/페이스 디테일을 포털 부착한다.
 * 기본 얼굴형은 raw+normalized head scale로, 모델이 명시적으로 제공한 상세 shape key는
 * exact semantic binding으로 적용한다. 원본 geometry와 표정 expression 채널은 변경하지 않는다.
 */
export function StudioVrmAvatarForge({
  vrm,
  state,
  rigRevision,
  faceController,
}: StudioVrmAvatarForgeProps) {
  const safeState = useMemo(() => sanitizeAvatarForgeState(state), [state]);
  const normalizedHead = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
  const rawHead = vrm.humanoid?.getRawBoneNode("head") ?? null;
  const fit = useMemo(
    () => {
      void rigRevision;
      return normalizedHead ? measureHeadFit(vrm, normalizedHead) : null;
    },
    [normalizedHead, rigRevision, vrm]
  );
  const object = useMemo(
    () => (fit ? buildAvatarForgeObject(safeState, fit) : null),
    [fit, safeState]
  );

  useEffect(() => {
    if (!object) return;
    return () => disposeAvatarForgeObject(object);
  }, [object]);

  useLayoutEffect(() => {
    faceController.replace({
      normalizedHead,
      rawHead,
      rigRevision,
      face: safeState.face,
    });
    return () => {
      faceController.release();
    };
  }, [faceController, normalizedHead, rawHead, rigRevision, safeState.face]);

  useLayoutEffect(
    () => applyStudioVrmSemanticFaceMorphs(vrm, safeState.semanticFaceMorphs),
    [safeState.semanticFaceMorphs, vrm],
  );

  const hideAuthoredHair = shouldHideAuthoredVrmHair(safeState.hair);
  useEffect(() => {
    if (!hideAuthoredHair) return;
    return acquireHiddenHair(detectReplaceableHairMeshes(vrm));
  }, [hideAuthoredHair, vrm]);

  if (!normalizedHead || !object) return null;
  return createPortal(<primitive object={object} />, normalizedHead);
}
