import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createStudioVrmAuthoredHairClumpGeometry,
  createStudioVrmAuthoredHairGeometry,
  mergeStudioVrmAuthoredHairGeometry,
} from "./studio-vrm-authored-hair-geometry";

import type { AvatarForgeHairPart } from "./studio-vrm-avatar-forge";

const CLUMP: AvatarForgeHairPart = {
  id: "test-clump",
  role: "bang",
  primitive: "tapered-capsule",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  baseColor: "#25171b",
  shadowColor: "#0d080a",
  tipColor: "#e09bad",
  taper: 0.72,
  curl: 0.35,
  shine: 0.65,
  wave: 0.4,
  waveFrequency: 2.4,
};

function bounds(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("missing bounds");
  return box.getSize(new THREE.Vector3());
}

describe("studio-vrm-authored-hair-geometry", () => {
  it("builds a closed faceted clump instead of a radial capsule", () => {
    const geometry = createStudioVrmAuthoredHairClumpGeometry(CLUMP);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const color = geometry.getAttribute("color");
    const uv = geometry.getAttribute("uv");

    expect(position.count).toBe((18 + 1) * (6 + 1) * 2);
    expect(normal.count).toBe(position.count);
    expect(color.count).toBe(position.count);
    expect(uv.count).toBe(position.count);
    const size = bounds(geometry);
    expect(size.x).toBeGreaterThan(size.z * 3);
    expect(size.y).toBeGreaterThan(size.x * 0.8);
    geometry.dispose();
  });

  it("tapers to a narrow tip and carries shadow-to-highlight vertex colour variation", () => {
    const geometry = createStudioVrmAuthoredHairClumpGeometry(CLUMP);
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    const columns = 7;
    const rows = 19;

    const rowWidth = (row: number) => {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        minimum = Math.min(minimum, position.getX(index));
        maximum = Math.max(maximum, position.getX(index));
      }
      return maximum - minimum;
    };
    expect(rowWidth(rows - 1)).toBeLessThan(rowWidth(0) * 0.08);

    const edge = new THREE.Color(color.getX(0), color.getY(0), color.getZ(0));
    const ridgeIndex = Math.floor(columns / 2);
    const ridge = new THREE.Color(
      color.getX(ridgeIndex),
      color.getY(ridgeIndex),
      color.getZ(ridgeIndex),
    );
    expect(ridge.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
      edge.getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    geometry.dispose();
  });

  it("preserves shell and bun parts while applying authored palette colours", () => {
    const cap = createStudioVrmAuthoredHairGeometry({
      ...CLUMP,
      id: "cap",
      role: "cap",
      primitive: "ellipsoid",
    });
    const bun = createStudioVrmAuthoredHairGeometry({
      ...CLUMP,
      id: "bun",
      role: "bun",
      primitive: "sphere",
    });
    expect(cap.getAttribute("color").count).toBe(cap.getAttribute("position").count);
    expect(bun.getAttribute("color").count).toBe(bun.getAttribute("position").count);
    cap.dispose();
    bun.dispose();
  });

  it("merges many authored parts into one renderable buffer", () => {
    const merged = mergeStudioVrmAuthoredHairGeometry([
      { part: CLUMP, matrix: new THREE.Matrix4().makeTranslation(-0.2, 0, 0) },
      {
        part: { ...CLUMP, id: "right" },
        matrix: new THREE.Matrix4().makeTranslation(0.2, 0, 0),
      },
      {
        part: { ...CLUMP, id: "cap", role: "cap", primitive: "ellipsoid" },
        matrix: new THREE.Matrix4(),
      },
    ]);
    expect(merged).not.toBeNull();
    expect(merged?.getAttribute("position").count).toBeGreaterThan(500);
    expect(merged?.getAttribute("color").count).toBe(merged?.getAttribute("position").count);
    merged?.dispose();
  });
});
