import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createPrimitive,
  duplicatePrimitive,
  encodeBg3dSceneHash,
  makeGeometry,
  parseBg3dSceneFromDataUrl,
  parseStudio3dTool,
  PRIMITIVE_DEFS,
  type BgPrimitiveKind,
} from "./studio-background-3d-primitives";

const ALL_KINDS = Object.keys(PRIMITIVE_DEFS) as BgPrimitiveKind[];

describe("studio-background-3d-primitives", () => {
  it("makeGeometry returns a valid, non-degenerate BufferGeometry for every kind", () => {
    for (const kind of ALL_KINDS) {
      const geometry = makeGeometry(kind);
      expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
      expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      geometry.dispose();
    }
  });

  it("createPrimitive spawns every kind with a def-matching color and finite transform", () => {
    for (const kind of ALL_KINDS) {
      const prim = createPrimitive(kind, 0);
      expect(prim.kind).toBe(kind);
      expect(prim.color).toBe(PRIMITIVE_DEFS[kind].color);
      expect(prim.position.every(Number.isFinite)).toBe(true);
      expect(prim.rotation.every(Number.isFinite)).toBe(true);
      expect(prim.scale.every(Number.isFinite)).toBe(true);
    }
  });

  it("duplicatePrimitive keeps kind and offsets position for every kind", () => {
    for (const kind of ALL_KINDS) {
      const original = createPrimitive(kind, 0);
      const copy = duplicatePrimitive(original);
      expect(copy.kind).toBe(kind);
      expect(copy.id).not.toBe(original.id);
      expect(copy.position[0]).toBeCloseTo(original.position[0] + 0.4);
    }
  });

  it("round-trips every kind through the scene hash", () => {
    const primitives = ALL_KINDS.map((kind, i) => createPrimitive(kind, i));
    const hash = encodeBg3dSceneHash(primitives);
    const restored = parseBg3dSceneFromDataUrl(`data:image/png;base64,xyz#${hash}`);
    expect(restored?.map((p) => p.kind)).toEqual(primitives.map((p) => p.kind));
    expect(parseStudio3dTool(`data:image/png;base64,xyz#${hash}`)).toBe("bg3d");
  });
});
