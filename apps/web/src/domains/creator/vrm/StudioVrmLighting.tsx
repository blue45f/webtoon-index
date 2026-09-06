import {
  computeLightingUniforms,
  type EnvVariant,
  type LightingParams,
} from "./studio-vrm-poser-utils";

import type { StudioVrmLightingTone } from "./studio-vrm-scene-document";
import type * as THREE from "three";


export type LightingTone = StudioVrmLightingTone;

export function VrmLighting({
  tone,
  lighting,
  env,
  envRootRef,
}: {
  tone: LightingTone;
  lighting?: LightingParams;
  env?: EnvVariant;
  /** Capture lease hides this group so subject-only inserts exclude floor/wall env. */
  envRootRef?: { current: THREE.Group | null };
}) {
  const li = lighting ? computeLightingUniforms(lighting) : null;
  const iMul = li ? li.intensity : 1;
  const col = li ? li.color : null;
  const dirPos = li ? [li.dir.x * 3.5, li.dir.y * 4, li.dir.z * 3.5] as const : [2.8, 4.2, 3.6] as const;

  const base = tone === "sunset" ? { amb: [0.52, "#ffe8d6"], d1: [1.5, "#ffa07a"], d2: [0.6, "#ffb732"], d3: [0.3, "#ff6b8b"] } :
               tone === "night" ? { amb: [0.34, "#1b1c30"], d1: [0.92, "#7fa3ff"], d2: [0.4, "#483d8b"], d3: [0.5, "#8a2be2"] } :
               tone === "studio" ? { amb: [0.92, "#ffffff"], d1: [1.5, "#ffffff"], d2: [0.8, "#ffffff"], d3: [0.8, "#ffffff"] } :
               { amb: [0.68, "#ffffff"], d1: [1.32, "#ffffff"], d2: [0.54, "#f7d8c4"], d3: [0.42, "#cfdcff"] };

  const ambI = (base.amb[0] as number) * (iMul * 0.9);
  const d1I = (base.d1[0] as number) * iMul;
  const d2I = (base.d2[0] as number) * iMul * 0.9;
  const d3I = (base.d3[0] as number) * iMul * 0.8;

  const c1 = col ? `rgb(${Math.round(col[0]*255)},${Math.round(col[1]*255)},${Math.round(col[2]*255)})` : (base.d1[1] as string);
  const c2 = col ? `rgb(${Math.round(col[0]*255*0.85)},${Math.round(col[1]*255*0.85)},${Math.round(col[2]*255*0.9)})` : (base.d2[1] as string);

  return (
    <>
      <ambientLight intensity={ambI} color={base.amb[1] as string} />
      <directionalLight intensity={d1I} position={dirPos as [number,number,number]} color={c1} />
      <directionalLight intensity={d2I} position={[-3.2, 2.6, 2.1]} color={c2} />
      <directionalLight intensity={d3I} position={[-1.6, 3.4, -3.2]} color={base.d3[1] as string} />

      {/* Env variants (floor / wall / room / outdoor) — excluded from subject-only capture. */}
      <group ref={envRootRef}>
        {(env === "floor" || env === "room" || env === "outdoor") && (
          <mesh position={[0, -0.01, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow>
            <planeGeometry args={[8, 8]} />
            <meshLambertMaterial color={env === "outdoor" ? "#3a5f3a" : "#3a3a3f"} />
          </mesh>
        )}
        {(env === "wall" || env === "room") && (
          <>
            <mesh position={[0, 2.5, -2.8]}><planeGeometry args={[6, 5]} /><meshLambertMaterial color="#2b2b32" /></mesh>
            <mesh position={[0, 2.5, 2.8]} rotation={[0, Math.PI, 0]}><planeGeometry args={[6, 5]} /><meshLambertMaterial color="#2b2b32" /></mesh>
          </>
        )}
        {env === "room" && (
          <>
            <mesh position={[-3.2, 2.5, 0]} rotation={[0, Math.PI/2, 0]}><planeGeometry args={[6, 5]} /><meshLambertMaterial color="#2b2b32" /></mesh>
            <mesh position={[3.2, 2.5, 0]} rotation={[0, -Math.PI/2, 0]}><planeGeometry args={[6, 5]} /><meshLambertMaterial color="#2b2b32" /></mesh>
          </>
        )}
      </group>
    </>
  );
}
