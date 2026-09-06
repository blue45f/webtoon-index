/** Conservative pose-aware regions for inspecting clothing, shoes and contact points. */
import type { StudioVrmPortraitBounds, StudioVrmPortraitLandmarks } from "./studio-vrm-portrait-framing";

type Vec3 = readonly [number, number, number];
export interface StudioVrmInspectionLandmarks extends StudioVrmPortraitLandmarks {
  readonly hips?: Vec3;
  readonly spine?: Vec3;
  readonly leftHand?: Vec3;
  readonly rightHand?: Vec3;
  readonly leftMiddleProximal?: Vec3;
  readonly rightMiddleProximal?: Vec3;
  readonly leftLowerLeg?: Vec3;
  readonly rightLowerLeg?: Vec3;
  readonly leftFoot?: Vec3;
  readonly rightFoot?: Vec3;
  readonly leftToes?: Vec3;
  readonly rightToes?: Vec3;
}
export const STUDIO_VRM_INSPECTION_VIEWS = [
  { id: "profile", label: "측면" },
  { id: "profileReverse", label: "반대 측면" },
  { id: "back", label: "후면" },
  { id: "inspectTorso", label: "상의·허리 확대" },
  { id: "inspectTorsoBack", label: "등·착장 확대" },
  { id: "inspectLowerBody", label: "하의 확대" },
  { id: "inspectFeet", label: "신발·접지 확대" },
  { id: "inspectLeftHand", label: "왼손·그립 확대" },
  { id: "inspectRightHand", label: "오른손·그립 확대" },
] as const;
const finite = (value: Vec3 | undefined): value is Vec3 => (
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
);
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function resolveStudioVrmInspectionBounds(
  presetId: string,
  body: StudioVrmPortraitBounds,
  landmarks: StudioVrmInspectionLandmarks,
): StudioVrmPortraitBounds | null {
  if (!presetId.startsWith("inspect") || !finite(body.min) || !finite(body.max)) return null;
  const dimensions = body.max.map((value, axis) => value - body.min[axis]);
  const size = Math.max(...dimensions);
  if (dimensions.some((value) => value < 0) || size < 0.05 || size > 100) return null;
  const valid = (point: Vec3 | undefined): point is Vec3 => finite(point) && point.every((value, axis) => (
    value >= body.min[axis] - size * 0.05 && value <= body.max[axis] + size * 0.05
  ));
  const points: Vec3[] = [];
  const collect = (...keys: (keyof StudioVrmInspectionLandmarks)[]) => {
    for (const key of keys) {
      const point = landmarks[key];
      if (valid(point)) points.push(point);
    }
  };
  let padding = size * 0.045;
  switch (presetId) {
    case "inspectTorso":
    case "inspectTorsoBack":
      if (!valid(landmarks.hips) || !valid(landmarks.leftUpperArm) || !valid(landmarks.rightUpperArm)) return null;
      collect("hips", "spine", "chest", "neck", "leftUpperArm", "rightUpperArm");
      padding = Math.max(padding, distance(landmarks.leftUpperArm, landmarks.rightUpperArm) * 0.17);
      break;
    case "inspectLowerBody":
      if (!valid(landmarks.hips) || !valid(landmarks.leftFoot) || !valid(landmarks.rightFoot)) return null;
      collect("hips", "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot", "leftToes", "rightToes");
      padding = size * 0.07;
      break;
    case "inspectFeet":
      if (!valid(landmarks.leftFoot) || !valid(landmarks.rightFoot)) return null;
      collect("leftFoot", "rightFoot", "leftToes", "rightToes");
      padding = size * 0.055;
      break;
    case "inspectLeftHand":
    case "inspectRightHand": {
      const hand = presetId === "inspectLeftHand" ? landmarks.leftHand : landmarks.rightHand;
      const finger = presetId === "inspectLeftHand" ? landmarks.leftMiddleProximal : landmarks.rightMiddleProximal;
      if (!valid(hand)) return null;
      points.push(hand);
      if (valid(finger) && distance(hand, finger) < size * 0.12) points.push(finger);
      padding = size * 0.045;
      break;
    }
    default: return null;
  }
  if (points.length === 0) return null;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])) - padding) as [number, number, number],
    max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])) + padding) as [number, number, number],
  };
}
