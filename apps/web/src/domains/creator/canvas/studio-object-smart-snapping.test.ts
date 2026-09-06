import { describe, expect, it } from "vitest";

import {
  computeSmartSnapping,
  type BoundingBox2D,
} from "./studio-object-smart-snapping";

describe("studio-object-smart-snapping", () => {
  const refBox1: BoundingBox2D = { id: "box-1", x: 100, y: 100, width: 80, height: 80 };
  const refBox2: BoundingBox2D = { id: "box-2", x: 220, y: 100, width: 80, height: 80 };

  describe("Edge and Center Snapping", () => {
    it("snaps to matching horizontal edge when within threshold", () => {
      // Active box is close to refBox1 left edge (x=103 -> diff 3px <= 8px threshold)
      const active: BoundingBox2D = { id: "active", x: 103, y: 300, width: 50, height: 50 };
      const result = computeSmartSnapping(active, [refBox1]);

      expect(result.snappedX).toBe(100);
      expect(result.deltaX).toBe(-3);
      expect(result.guides.length).toBeGreaterThan(0);
      expect(result.guides[0].position).toBe(100);
    });

    it("snaps to matching vertical center", () => {
      // refBox1 center Y = 100 + 40 = 140
      // Active center Y = 142 (y=117, height=50 => center 142 -> diff 2px)
      const active: BoundingBox2D = { id: "active", x: 500, y: 117, width: 50, height: 50 };
      const result = computeSmartSnapping(active, [refBox1]);

      expect(result.snappedY).toBe(115); // 115 + 25 = 140
      expect(result.deltaY).toBe(-2);
    });
  });

  describe("Equal Spacing Snapping", () => {
    it("detects and snaps to equal interval between adjacent boxes", () => {
      // refBox1: [100..180], refBox2: [220..300], gap = 40px
      // Placing active after refBox2 with ~40px gap: target x = 300 + 40 = 340
      const active: BoundingBox2D = { id: "active", x: 343, y: 100, width: 80, height: 80 };
      const result = computeSmartSnapping(active, [refBox1, refBox2], { enableEqualSpacing: true });

      expect(result.snappedX).toBe(340);
      expect(result.guides.some((g) => g.kind === "spacing" && g.gapSize === 40)).toBe(true);
    });
  });
});
