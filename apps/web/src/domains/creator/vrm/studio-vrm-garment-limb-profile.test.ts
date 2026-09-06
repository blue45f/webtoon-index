import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildStudioVrmGarmentGeometry } from "./studio-vrm-skinned-garment";
import { buildGarmentParts, FALLBACK_WARDROBE_METRICS, type GarmentPart } from "./studio-vrm-wardrobe";

/** Read the actual mesh ends along the authored parent-to-child axis, not cylinder parameter names. */
function endRadii(part: GarmentPart): { proximal: number; distal: number } {
  if (part.shape.kind !== "cylinder" || !part.align) throw new Error("expected an aligned limb sleeve");
  const axis = new THREE.Vector3(...part.align).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const geometry = buildStudioVrmGarmentGeometry(part.shape);
  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();
  let proximal = 0;
  let distal = 0;
  for (let i = 0; i < positions.count; i += 1) {
    point.fromBufferAttribute(positions, i).applyQuaternion(rotation);
    const along = point.dot(axis);
    const radius = Math.sqrt(Math.max(0, point.lengthSq() - along * along));
    if (Math.abs(along + part.shape.h / 2) < 1e-6) proximal = Math.max(proximal, radius);
    if (Math.abs(along - part.shape.h / 2) < 1e-6) distal = Math.max(distal, radius);
  }
  geometry.dispose();
  return { proximal, distal };
}

describe("garment limb profile orientation", () => {
  for (const fit of [0.8, 1, 1.3]) {
    it.each(["left", "right"] as const)(`flares the robe toward the %s wrist, not the elbow (fit=${fit})`, (side) => {
      const sleeve = buildGarmentParts("robe", FALLBACK_WARDROBE_METRICS, fit)
        .find((part) => part.bone === `${side}LowerArm` && part.shape.kind === "cylinder");
      expect(sleeve).toBeDefined();
      const ends = endRadii(sleeve!);
      expect(ends.distal / ends.proximal).toBeCloseTo(1.7, 5);
    });
    it.each(["left", "right"] as const)(`widens the trouser hem toward the %s ankle, not the knee (fit=${fit})`, (side) => {
      const sleeve = buildGarmentParts("wide", FALLBACK_WARDROBE_METRICS, fit)
        .find((part) => part.bone === `${side}LowerLeg` && part.shape.kind === "cylinder");
      expect(sleeve).toBeDefined();
      const ends = endRadii(sleeve!);
      expect(ends.distal / ends.proximal).toBeCloseTo(1.55, 5);
    });
  }
});
