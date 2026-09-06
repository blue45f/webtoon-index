import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import {
  mountStudioBg3dProceduralPanorama,
  type StudioBg3dProceduralPanoramaBinding,
} from "./studio-bg3d-procedural-panorama";

import type { StudioBg3dSkyPresetId } from "./studio-bg3d-scene-document";

export interface StudioBg3dScenePanoramaProps {
  readonly presetId: StudioBg3dSkyPresetId;
  readonly rotationDegrees: number;
}

/** Canvas bridge that owns the procedural panorama without recreating it while rotation changes. */
export function StudioBg3dScenePanorama({
  presetId,
  rotationDegrees,
}: StudioBg3dScenePanoramaProps) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const bindingRef = useRef<StudioBg3dProceduralPanoramaBinding | null>(null);

  useEffect(() => {
    // Rotation is applied by the lightweight effect below so slider movement never rebuilds pixels.
    const binding = mountStudioBg3dProceduralPanorama(scene, presetId, 0);
    bindingRef.current = binding;
    invalidate();
    return () => {
      binding.dispose();
      if (bindingRef.current === binding) bindingRef.current = null;
      invalidate();
    };
  }, [invalidate, presetId, scene]);

  useEffect(() => {
    bindingRef.current?.setRotation(rotationDegrees);
    invalidate();
  }, [invalidate, presetId, rotationDegrees]);

  return null;
}
