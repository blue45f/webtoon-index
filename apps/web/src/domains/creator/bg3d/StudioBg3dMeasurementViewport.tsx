/**
 * Three/R3F adapter for the renderer-independent BG3D measurement core.
 *
 * The persistent document and all measurement math stay in studio-bg3d-measurement.ts. This
 * component owns only Three world-point admission plus capture-excluded viewport presentation.
 */

import { Html } from "@react-three/drei/web/Html.js";
import { useEffect, useLayoutEffect, useState } from "react";
import * as THREE from "three";

import { registerStudioBg3dCaptureExcludedObject } from "./studio-bg3d-capture-exclusion";
import {
  formatStudioBg3dMeasurementLength,
  resolveStudioBg3dMeasurementGuide,
  type StudioBg3dMeasurementDocument,
  type StudioBg3dMeasurementVec3,
  type StudioBg3dWorldMeasurement,
} from "./studio-bg3d-measurement";
import { readStudioBg3dMeasurementPointFromThreeEvent } from "./studio-bg3d-measurement-three-adapter";

function MeasurementLine({
  id,
  label,
  startWorld,
  endWorld,
  midpointWorld,
  draft,
}: {
  readonly id: string;
  readonly label: string;
  readonly startWorld: StudioBg3dMeasurementVec3;
  readonly endWorld: StudioBg3dMeasurementVec3;
  readonly midpointWorld: StudioBg3dMeasurementVec3;
  readonly draft: boolean;
}) {
  const [geometry] = useState(() => new THREE.BufferGeometry());
  useLayoutEffect(() => {
    geometry.setFromPoints([
      new THREE.Vector3(...startWorld),
      new THREE.Vector3(...endWorld),
    ]);
    geometry.computeBoundingSphere();
  }, [endWorld, geometry, startWorld]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const color = draft ? "#2563eb" : "#f97316";

  return (
    <group>
      <lineSegments geometry={geometry} raycast={() => null} renderOrder={45}>
        <lineBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={draft ? 0.9 : 0.78}
          transparent
        />
      </lineSegments>
      {[startWorld, endWorld].map((point, index) => (
        <mesh
          key={`${id}:endpoint:${index}`}
          position={[...point]}
          raycast={() => null}
          renderOrder={46}
        >
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      <Html
        center
        position={[...midpointWorld]}
        pointerEvents="none"
        zIndexRange={[70, 20]}
      >
        <span
          data-testid={`bg3d-measurement-guide-${id}`}
          className="block whitespace-nowrap rounded-full border border-accent/45 bg-panel/95 px-2 py-1 text-[0.62rem] font-bold tabular-nums text-fg shadow-md backdrop-blur"
        >
          {label}
        </span>
      </Html>
    </group>
  );
}

function MeasurementGuideOverlay({
  document,
  draftMeasurement,
  startWorld,
}: {
  readonly document: StudioBg3dMeasurementDocument;
  readonly draftMeasurement: StudioBg3dWorldMeasurement | null;
  readonly startWorld: StudioBg3dMeasurementVec3 | null;
}) {
  const resolvedGuides = document.guides.flatMap((guide) => {
    if (!guide.visible) return [];
    const resolved = resolveStudioBg3dMeasurementGuide(guide, document.unit);
    return resolved.ok ? [resolved.resolved] : [];
  });
  const draftLabel = draftMeasurement
    ? formatStudioBg3dMeasurementLength(draftMeasurement.distanceMeters, document.unit)
    : null;

  return (
    <group ref={registerStudioBg3dCaptureExcludedObject}>
      {resolvedGuides.map(({ guide, measurement, label }) => (
        <MeasurementLine
          key={guide.id}
          id={guide.id}
          label={label}
          startWorld={measurement.startWorld}
          endWorld={measurement.endWorld}
          midpointWorld={measurement.midpointWorld}
          draft={false}
        />
      ))}
      {draftMeasurement && draftLabel ? (
        <MeasurementLine
          id="draft"
          label={draftLabel}
          startWorld={draftMeasurement.startWorld}
          endWorld={draftMeasurement.endWorld}
          midpointWorld={draftMeasurement.midpointWorld}
          draft
        />
      ) : null}
      {startWorld && !draftMeasurement ? (
        <group position={[...startWorld]}>
          <mesh raycast={() => null} renderOrder={46}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshBasicMaterial color="#2563eb" depthTest={false} depthWrite={false} />
          </mesh>
          <Html
            center
            position={[0, 0.12, 0]}
            pointerEvents="none"
            zIndexRange={[70, 20]}
          >
            <span className="block whitespace-nowrap rounded-full border border-cool/50 bg-panel/95 px-2 py-1 text-[0.62rem] font-bold text-fg shadow-md backdrop-blur">
              시작점
            </span>
          </Html>
        </group>
      ) : null}
    </group>
  );
}

export interface StudioBg3dMeasurementViewportProps {
  readonly active: boolean;
  readonly capturing: boolean;
  readonly document: StudioBg3dMeasurementDocument;
  readonly draftMeasurement: StudioBg3dWorldMeasurement | null;
  readonly startWorld: StudioBg3dMeasurementVec3 | null;
  readonly onPointPick: (point: StudioBg3dMeasurementVec3) => void;
  readonly onPointPreview: (point: StudioBg3dMeasurementVec3) => void;
}

export function StudioBg3dMeasurementViewport({
  active,
  capturing,
  document,
  draftMeasurement,
  startWorld,
  onPointPick,
  onPointPreview,
}: StudioBg3dMeasurementViewportProps) {
  if (capturing) return null;
  return (
    <>
      {active ? (
        <mesh
          rotation-x={-Math.PI / 2}
          position={[0, -0.0005, 0]}
          onClick={(event) => {
            event.stopPropagation();
            const point = readStudioBg3dMeasurementPointFromThreeEvent(event);
            if (point) onPointPick(point);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            const point = readStudioBg3dMeasurementPointFromThreeEvent(event);
            if (point) onPointPreview(point);
          }}
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial
            colorWrite={false}
            depthWrite={false}
            opacity={0}
            transparent
          />
        </mesh>
      ) : null}
      {document.guides.length > 0 || draftMeasurement || startWorld ? (
        <MeasurementGuideOverlay
          document={document}
          draftMeasurement={draftMeasurement}
          startWorld={startWorld}
        />
      ) : null}
    </>
  );
}
