import { describe, expect, it } from "vitest";

import {
  buildPuppetLatticeMesh,
  computeDeformedPosition,
  createPuppetPin,
  deformPuppetMesh,
  movePuppetPin,
  resetPuppetPins,
} from "./studio-puppet-warp";

describe("studio-puppet-warp", () => {
  describe("Pin creation and manipulation", () => {
    it("creates a puppet pin with rest position equal to initial coordinate", () => {
      const pin = createPuppetPin(150, 200, "deform", "arm-pin");
      expect(pin.id).toBe("arm-pin");
      expect(pin.kind).toBe("deform");
      expect(pin.x).toBe(150);
      expect(pin.y).toBe(200);
      expect(pin.restX).toBe(150);
      expect(pin.restY).toBe(200);
    });

    it("moves pin to a new coordinate", () => {
      const pins = [createPuppetPin(100, 100, "deform", "p1")];
      const moved = movePuppetPin(pins, "p1", 130, 140);
      expect(moved[0].x).toBe(130);
      expect(moved[0].y).toBe(140);
      expect(moved[0].restX).toBe(100); // Rest position remains preserved!
    });

    it("resets pins back to rest position", () => {
      const pins = [createPuppetPin(100, 100, "deform", "p1")];
      const moved = movePuppetPin(pins, "p1", 180, 220);
      const reset = resetPuppetPins(moved);
      expect(reset[0].x).toBe(100);
      expect(reset[0].y).toBe(100);
    });
  });

  describe("Mesh Generation and Deformation", () => {
    it("builds a regular triangular lattice mesh", () => {
      const mesh = buildPuppetLatticeMesh(200, 200, 4, 4);
      expect(mesh.width).toBe(200);
      expect(mesh.height).toBe(200);
      expect(mesh.vertices).toHaveLength(25); // (4+1) * (4+1)
      expect(mesh.triangles).toHaveLength(32); // 4 * 4 * 2
    });

    it("smoothly deforms vertices near moved pins while keeping anchor pins stationary", () => {
      const pDeform = createPuppetPin(100, 100, "deform", "deform-pin");
      const pAnchor = createPuppetPin(0, 0, "anchor", "anchor-pin");

      // Move the deform pin by +40px X and +20px Y
      const movedPins = movePuppetPin([pDeform, pAnchor], "deform-pin", 140, 120);

      // Point near the deform pin (at 100, 100) should move significantly
      const [nearX, nearY] = computeDeformedPosition(100, 100, movedPins, 100);
      expect(nearX).toBeGreaterThan(125);
      expect(nearY).toBeGreaterThan(110);

      // Point near the anchor (at 0, 0) should remain close to original
      const [anchorX, anchorY] = computeDeformedPosition(0, 0, movedPins, 100);
      expect(Math.abs(anchorX - 0)).toBeLessThan(10);
      expect(Math.abs(anchorY - 0)).toBeLessThan(10);
    });

    it("updates all mesh vertices upon deformPuppetMesh", () => {
      const mesh = buildPuppetLatticeMesh(100, 100, 2, 2);
      const pins = movePuppetPin([createPuppetPin(50, 50, "deform", "center")], "center", 80, 80);

      const deformed = deformPuppetMesh(mesh, pins, 100);
      const centerVertex = deformed.vertices.find((v) => v.restX === 50 && v.restY === 50);
      expect(centerVertex?.currX).toBeGreaterThan(50);
      expect(centerVertex?.currY).toBeGreaterThan(50);
    });
  });
});
