import { describe, expect, it } from "vitest";

import {
  calculateLineAngleDeg,
  checkStylusDwellHold,
  recognizeSmartShapeFromStroke,
  snapAngleDeg,
} from "./studio-smart-shape-interactive";

describe("studio-smart-shape-interactive", () => {
  describe("Angles and snapping", () => {
    it("calculates line angles correctly in degrees", () => {
      expect(calculateLineAngleDeg(0, 0, 10, 0)).toBe(0); // East
      expect(calculateLineAngleDeg(0, 0, 0, 10)).toBe(90); // South
      expect(calculateLineAngleDeg(0, 0, -10, 0)).toBe(180); // West
      expect(calculateLineAngleDeg(0, 0, 0, -10)).toBe(270); // North
    });

    it("snaps angles to nearest 15/45 degree increments within tolerance", () => {
      expect(snapAngleDeg(44, 15, 5)).toBe(45);
      expect(snapAngleDeg(1, 15, 5)).toBe(0);
      expect(snapAngleDeg(88, 15, 5)).toBe(90);
      // Beyond tolerance -> keep original
      expect(snapAngleDeg(22, 15, 3)).toBe(22);
    });
  });

  describe("Stroke recognition", () => {
    it("recognizes straight line stroke and adds endpoints", () => {
      const stroke: (readonly [number, number])[] = [
        [10, 10],
        [30, 11],
        [50, 9],
        [80, 10],
        [100, 10],
      ];
      const shape = recognizeSmartShapeFromStroke(stroke);
      expect(shape).not.toBeNull();
      expect(shape?.kind).toBe("line");
      expect(shape?.isClosed).toBe(false);
      expect(shape?.controlPoints).toHaveLength(2);
      expect(shape?.controlPoints[0].role).toBe("vertex");
      expect(shape?.controlPoints[1].role).toBe("vertex");
    });

    it("recognizes roughly circular closed stroke as circle/ellipse", () => {
      const circlePoints: (readonly [number, number])[] = [];
      const cx = 100, cy = 100, r = 40;
      for (let i = 0; i <= 20; i++) {
        const theta = (i / 20) * Math.PI * 2;
        // slight jitter
        const jitter = (i % 2 === 0 ? 1 : -1) * 1.5;
        circlePoints.push([cx + (r + jitter) * Math.cos(theta), cy + (r + jitter) * Math.sin(theta)]);
      }
      const shape = recognizeSmartShapeFromStroke(circlePoints);
      expect(shape).not.toBeNull();
      expect(["circle", "ellipse"]).toContain(shape?.kind);
      expect(shape?.isClosed).toBe(true);
      expect(shape?.controlPoints.some((cp) => cp.role === "center")).toBe(true);
      expect(shape?.controlPoints.some((cp) => cp.role === "radius")).toBe(true);
    });

    it("recognizes closed box stroke as rectangle", () => {
      const rectPoints: (readonly [number, number])[] = [
        [20, 20], [60, 22], [100, 20], // top
        [101, 50], [99, 80],           // right
        [70, 81], [20, 79],            // bottom
        [21, 50], [20, 20],            // left / close
      ];
      const shape = recognizeSmartShapeFromStroke(rectPoints);
      expect(shape).not.toBeNull();
      expect(["rect", "circle", "ellipse"]).toContain(shape?.kind);
      expect(shape?.isClosed).toBe(true);
    });

    it("recognizes speech bubble when requested", () => {
      const bubblePoints: (readonly [number, number])[] = [];
      const cx = 120, cy = 80, rx = 50, ry = 30;
      for (let i = 0; i <= 20; i++) {
        const theta = (i / 20) * Math.PI * 2;
        bubblePoints.push([cx + rx * Math.cos(theta), cy + ry * Math.sin(theta)]);
      }
      const shape = recognizeSmartShapeFromStroke(bubblePoints, { preferBubble: true });
      expect(shape).not.toBeNull();
      expect(shape?.kind).toBe("bubble");
      expect(shape?.controlPoints.some((cp) => cp.role === "tail")).toBe(true);
    });
  });

  describe("Stylus Dwell Detection", () => {
    it("detects motionless hold past threshold", () => {
      expect(checkStylusDwellHold([100, 100], [102, 101], 450, 400)).toBe(true);
      expect(checkStylusDwellHold([100, 100], [102, 101], 200, 400)).toBe(false); // not enough time
      expect(checkStylusDwellHold([100, 100], [130, 100], 500, 400)).toBe(false); // moved too far
    });
  });
});
