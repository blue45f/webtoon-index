import { Fragment, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";

import type { StudioBg3dDirectionalShadowFit } from "./studio-bg3d-shadow-frustum";

/**
 * Applies the fitted directional-light camera as one isolated R3F leaf. Keeping the imperative
 * Three.js shadow-camera synchronization here prevents the already-large BG3D editor closure from
 * recompiling when only the light implementation changes.
 */
export function StudioBg3dDirectionalShadowLight({
  fit,
  castShadow,
  color,
  intensity,
  radius,
}: {
  fit: StudioBg3dDirectionalShadowFit;
  castShadow: boolean;
  color: string;
  intensity: number;
  radius: number;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [target] = useState(() => {
    const object = new THREE.Object3D();
    object.name = "ToonSpectrumDirectionalShadowTarget";
    return object;
  });

  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.position.set(...fit.position);
    target.position.set(...fit.target);
    target.updateMatrixWorld(true);
    light.target = target;
    light.updateMatrixWorld(true);
    const shadowCamera = light.shadow.camera;
    shadowCamera.left = fit.left;
    shadowCamera.right = fit.right;
    shadowCamera.top = fit.top;
    shadowCamera.bottom = fit.bottom;
    shadowCamera.near = fit.near;
    shadowCamera.far = fit.far;
    shadowCamera.up.set(...fit.cameraUp);
    shadowCamera.updateProjectionMatrix();
    light.shadow.bias = fit.bias;
    light.shadow.normalBias = fit.normalBias;
    light.shadow.radius = radius;
    light.shadow.mapSize.set(fit.mapSize, fit.mapSize);
    light.shadow.needsUpdate = true;
  }, [fit, radius, target]);

  return (
    <Fragment>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        castShadow={castShadow}
        color={color}
        intensity={intensity}
        position={fit.position}
        target={target}
        shadow-bias={fit.bias}
        shadow-camera-bottom={fit.bottom}
        shadow-camera-far={fit.far}
        shadow-camera-left={fit.left}
        shadow-camera-near={fit.near}
        shadow-camera-right={fit.right}
        shadow-camera-top={fit.top}
        shadow-normalBias={fit.normalBias}
        shadow-radius={radius}
        shadow-mapSize-height={fit.mapSize}
        shadow-mapSize-width={fit.mapSize}
      />
    </Fragment>
  );
}
