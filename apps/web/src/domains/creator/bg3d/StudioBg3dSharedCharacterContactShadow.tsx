import { useEffect, useState } from "react";
import * as THREE from "three";

import { registerStudioBg3dDepthExcludedObject } from "./studio-bg3d-capture-exclusion";
import { createStudioBg3dContactShadowAlphaTexture } from "./studio-bg3d-contact-shadow-texture";
import { planStudioBg3dSharedCharacterContactShadows } from "./studio-bg3d-shared-character-contact-shadow";

import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type { StudioShared3dCharacterSource } from "../studio-shared-3d-scene-bridge";

const EMPTY_GROUNDING_RESULTS = Object.freeze({}) as Readonly<
  Record<string, StudioBg3dSharedCharacterGroundingResult>
>;
const pendingTextureDisposals = new WeakMap<THREE.Texture, object>();
const ignoreContactShadowRaycast: THREE.Mesh["raycast"] = () => undefined;

function cancelScheduledTextureDisposal(texture: THREE.Texture): void {
  pendingTextureDisposals.delete(texture);
}

function scheduleTextureDisposal(texture: THREE.Texture): void {
  const token = {};
  pendingTextureDisposals.set(texture, token);
  queueMicrotask(() => {
    if (pendingTextureDisposals.get(texture) !== token) return;
    pendingTextureDisposals.delete(texture);
    texture.dispose();
  });
}

/** Beauty-only grounded occlusion that follows the same capture authority as its VRM wrapper. */
export default function StudioBg3dSharedCharacterContactShadow({
  grounding,
  source,
}: {
  readonly grounding?: StudioBg3dSharedCharacterGroundingResult;
  readonly source: StudioShared3dCharacterSource;
}) {
  const [alphaMap] = useState(createStudioBg3dContactShadowAlphaTexture);
  useEffect(() => {
    cancelScheduledTextureDisposal(alphaMap);
    return () => scheduleTextureDisposal(alphaMap);
  }, [alphaMap]);

  // The parent per-character wrapper owns preview/capture inclusion. Supplying this exact source
  // as capturable lets the pure planner retain its fail-closed authority contract while preview-
  // only characters still receive the same grounded cue and are hidden with their wrapper later.
  const plan = planStudioBg3dSharedCharacterContactShadows({
    characters: [source],
    groundingResults: grounding
      ? { [source.runtimeKey]: grounding }
      : EMPTY_GROUNDING_RESULTS,
    capturableElementIds: [source.elementId],
    includeInCapture: true,
  })[0];
  if (!plan) return null;

  return (
    <group
      key={plan.key}
      name={plan.key}
      userData={{ studioBg3dRendererOverlay: true }}
    >
      {plan.lobes.map((lobe) => (
        <mesh
          key={lobe.kind}
          ref={registerStudioBg3dDepthExcludedObject}
          name={`${plan.key}:${lobe.kind}`}
          position={lobe.center}
          quaternion={plan.quaternion}
          scale={[lobe.radii[0] * 2, lobe.radii[1] * 2, 1]}
          castShadow={false}
          receiveShadow={false}
          frustumCulled={false}
          raycast={ignoreContactShadowRaycast}
          renderOrder={lobe.kind === "core" ? 31 : 30}
          userData={{ studioBg3dRendererOverlay: true, contactShadowLobe: lobe.kind }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            alphaMap={alphaMap}
            blending={THREE.NormalBlending}
            color="#171310"
            depthTest
            depthWrite={false}
            opacity={lobe.opacity}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            side={THREE.FrontSide}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
}
