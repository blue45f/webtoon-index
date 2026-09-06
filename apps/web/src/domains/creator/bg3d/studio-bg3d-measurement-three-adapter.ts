/**
 * Narrow Three/R3F event adapter for the renderer-independent measurement core.
 * No Three object crosses the returned boundary.
 */

import {
  measureStudioBg3dWorldPoints,
  type StudioBg3dMeasurementVec3,
} from "./studio-bg3d-measurement";

import type { ThreeEvent } from "@react-three/fiber";

export type StudioBg3dMeasurementPointerEvent =
  | ThreeEvent<MouseEvent>
  | ThreeEvent<PointerEvent>;

export function readStudioBg3dMeasurementPointFromThreeEvent(
  event: Pick<StudioBg3dMeasurementPointerEvent, "point">,
): StudioBg3dMeasurementVec3 | null {
  const point = event.point.toArray();
  const admitted = measureStudioBg3dWorldPoints([0, 0, 0], point);
  return admitted.ok ? admitted.measurement.endWorld : null;
}
