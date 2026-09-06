/**
 * @fileoverview R3F helper components extracted from StudioVrmPoser.tsx.
 * Contains ViewportController, CameraDirector, StudioVrmMannequinMaterial,
 * StudioVrmTexturePaintInvalidateBridge, and StudioVrmViewportReadyFrame.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";


import {
  applyVrmCustomColors,
  applyVrmMaterialFx,
  scrubVrmMannequinColorCaches,
  type VrmMaterialFx,
} from "./studio-vrm-poser-utils";
import {
  restorePerspectiveCamera,
  type OrbitLike,
  type CaptureState,
  type ViewportApi,
} from "./StudioVrmPoserTypes";

import type { StudioVrmCameraSettings } from "./studio-vrm-scene-document";
import type { VRM } from "@pixiv/three-vrm";

export { CameraDirector } from "./StudioVrmCameraDirector";

// ── ViewportController ──────────────────────────────────────────────

// Canvas 내부에서 OrbitControls/카메라를 잡아 줌 등 명령형 동작을 패널 오버레이로 노출.
export function ViewportController({ onReady }: { onReady: (api: ViewportApi | null) => void }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitLike;
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    onReady({
      zoomBy: (factor: number) => {
        const target = controls?.target ?? new THREE.Vector3(0, 1, 0);
        const offset = camera.position.clone().sub(target);
        const min = controls?.minDistance ?? 1.3;
        const max = controls?.maxDistance ?? 5.2;
        const dist = THREE.MathUtils.clamp(offset.length() * factor, min, max);
        offset.setLength(dist);
        camera.position.copy(target).add(offset);
        camera.updateMatrixWorld();
        controls?.update?.();
        invalidate();
      },
      readCamera: () => {
        if (!(camera instanceof THREE.PerspectiveCamera)) return null;
        const target = controls?.target?.clone()
          ?? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()));
        return {
          projection: "perspective",
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [target.x, target.y, target.z],
          up: [camera.up.x, camera.up.y, camera.up.z],
          fovDegrees: camera.fov,
          near: camera.near,
          far: camera.far,
        };
      },
      restoreCamera: (settings: StudioVrmCameraSettings) => {
        restorePerspectiveCamera(camera, controls, settings, invalidate);
      },
    });
    return () => {
      onReady(null);
    };
  }, [camera, controls, invalidate, onReady]);

  return null;
}

// ── MannequinMaterial types ─────────────────────────────────────────

type MannequinMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  metalness?: number;
  roughness?: number;
};

type MannequinMaterialSnapshot = {
  material: MannequinMaterial;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  emissiveIntensity: number | undefined;
  map: THREE.Texture | null | undefined;
  metalness: number | undefined;
  roughness: number | undefined;
};

// ── StudioVrmMannequinMaterial ──────────────────────────────────────

export function StudioVrmMannequinMaterial({
  vrm,
  enabled,
  customColors,
  materialFx,
}: {
  vrm: VRM;
  enabled: boolean;
  customColors: Record<string, string>;
  materialFx: VrmMaterialFx;
}) {
  const snapshotsRef = useRef<MannequinMaterialSnapshot[]>([]);
  const invalidate = useThree((state) => state.invalidate);

  const enforce = () => {
    for (const { material } of snapshotsRef.current) {
      material.userData.__vrmMannequinActive = true;
      material.color?.set("#b7b2a8");
      material.emissive?.set("#000000");
      if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0;
      if (material.map !== undefined) material.map = null;
      if (material.metalness !== undefined) material.metalness = 0;
      if (material.roughness !== undefined) material.roughness = 0.82;
    }
  };

  useEffect(() => {
    const restore = () => {
      for (const snapshot of snapshotsRef.current) {
        snapshot.material.userData.__vrmMannequinActive = false;
        if (snapshot.color && snapshot.material.color) snapshot.material.color.copy(snapshot.color);
        if (snapshot.emissive && snapshot.material.emissive) snapshot.material.emissive.copy(snapshot.emissive);
        if (snapshot.emissiveIntensity !== undefined) snapshot.material.emissiveIntensity = snapshot.emissiveIntensity;
        if (snapshot.map !== undefined) snapshot.material.map = snapshot.map;
        if (snapshot.metalness !== undefined) snapshot.material.metalness = snapshot.metalness;
        if (snapshot.roughness !== undefined) snapshot.material.roughness = snapshot.roughness;
        snapshot.material.needsUpdate = true;
      }
      snapshotsRef.current = [];
      // Drop any custom-color originals that accidentally captured clay/near-black during paint.
      scrubVrmMannequinColorCaches(vrm);
    };

    restore();
    if (!enabled) {
      applyVrmCustomColors(vrm, customColors);
      applyVrmMaterialFx(vrm, materialFx);
      // The static poser uses frameloop="demand". Restoring materials mutates Three objects
      // imperatively, so React has no host prop change from which to schedule the color frame.
      invalidate();
      return;
    }
    const seen = new Set<THREE.Material>();
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const rawMaterial of materials) {
        if (!rawMaterial || seen.has(rawMaterial)) continue;
        seen.add(rawMaterial);
        const material = rawMaterial as MannequinMaterial;
        snapshotsRef.current.push({
          material,
          color: material.color?.clone() ?? null,
          emissive: material.emissive?.clone() ?? null,
          emissiveIntensity: material.emissiveIntensity,
          map: material.map,
          metalness: material.metalness,
          roughness: material.roughness,
        });
        material.userData.__vrmMannequinActive = true;
        material.needsUpdate = true;
      }
    });
    // Schedule the first clay frame even while the poser is otherwise static.
    invalidate();
    return () => {
      restore();
      applyVrmCustomColors(vrm, customColors);
      applyVrmMaterialFx(vrm, materialFx);
      // Without this frame the Canvas keeps presenting the last gray framebuffer until the
      // camera or another animation happens to invalidate it.
      invalidate();
    };
  }, [customColors, enabled, invalidate, materialFx, vrm]);

  useFrame(() => {
    if (enabled) enforce();
  });

  return null;
}

// ── StudioVrmTexturePaintInvalidateBridge ────────────────────────────

export function StudioVrmTexturePaintInvalidateBridge({
  onReady,
}: {
  readonly onReady: (invalidate: (() => void) | null) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const requestFrame = () => invalidate();
    onReady(requestFrame);
    return () => onReady(null);
  }, [invalidate, onReady]);

  return null;
}

// ── StudioVrmViewportReadyFrame ─────────────────────────────────────

export function StudioVrmViewportReadyFrame({
  revision,
}: {
  readonly revision: string;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    invalidate();
    let settledFrame: number | null = null;
    const layoutFrame = requestAnimationFrame(() => {
      invalidate();
      settledFrame = requestAnimationFrame(() => invalidate());
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      if (settledFrame !== null) cancelAnimationFrame(settledFrame);
    };
  }, [invalidate, revision]);

  return null;
}

// ── CaptureBridge ───────────────────────────────────────────────

export function CaptureBridge({
  onCaptureUpdate,
}: {
  onCaptureUpdate: (state: CaptureState, cleanupGl?: THREE.WebGLRenderer | null) => void;
}) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    onCaptureUpdate({ camera, gl, scene });
    return () => {
      onCaptureUpdate({ camera: null, gl: null, scene: null }, gl);
    };
  }, [camera, gl, scene, onCaptureUpdate]);

  return null;
}
