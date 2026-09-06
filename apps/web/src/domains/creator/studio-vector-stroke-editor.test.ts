import { describe, expect, it } from "vitest";

import {
  applyStrokeTaper,
  eraseUpToIntersection,
  exportStrokeToSvgPath,
  simplifyVectorStroke,
  type VectorStroke,
} from "./studio-vector-stroke-editor";

describe("Studio Vector Line & Stroke Editor Engine", () => {
  function makeStroke(id: string, coords: [number, number][], width: number = 4): VectorStroke {
    return {
      id,
      layerId: "layer_vector_1",
      colorHex: "#000000",
      opacity: 1.0,
      isClosed: false,
      points: coords.map(([x, y]) => ({ x, y, pressure: 1.0, widthPx: width })),
    };
  }

  it("simplifies collinear points on a straight vector line", () => {
    // 5 points in a straight line: (0,0) -> (25,0) -> (50,0) -> (75,0) -> (100,0)
    const stroke = makeStroke("s_straight", [
      [0, 0],
      [25, 0],
      [50, 0],
      [75, 0],
      [100, 0],
    ]);

    const simplified = simplifyVectorStroke(stroke, 1.0);
    // Should reduce to 2 end points
    expect(simplified.points).toHaveLength(2);
    expect(simplified.points[0].x).toBe(0);
    expect(simplified.points[1].x).toBe(100);
  });

  it("applies natural pressure taper at start and end of stroke", () => {
    const stroke = makeStroke("s_taper", [
      [0, 0],
      [20, 20],
      [40, 40],
      [60, 60],
      [80, 80],
      [100, 100],
    ]);

    const tapered = applyStrokeTaper(stroke, 0.3);
    expect(tapered.points[0].widthPx).toBeLessThan(stroke.points[0].widthPx);
    expect(tapered.points[tapered.points.length - 1].widthPx).toBeLessThan(4);
    // Middle point should stay full width
    expect(tapered.points[2].widthPx).toBe(4);
  });

  it("erases stroke up to intersection with another stroke", () => {
    // Horizontal stroke from (0, 50) to (100, 50)
    const horizStroke = makeStroke("s_h", [
      [0, 50],
      [50, 50],
      [100, 50],
    ]);

    // Vertical crossing stroke from (50, 0) to (50, 100) (intersects at (50, 50))
    const vertStroke = makeStroke("s_v", [
      [50, 0],
      [50, 100],
    ]);

    // Erase tail after intersection (near end) -> keeps (0, 50) to (50, 50)
    const trimmed = eraseUpToIntersection(horizStroke, vertStroke, false);
    expect(trimmed.points[trimmed.points.length - 1].x).toBe(50);
    expect(trimmed.points[trimmed.points.length - 1].y).toBe(50);
  });

  it("exports vector stroke to SVG Path string", () => {
    const stroke = makeStroke("s_svg", [
      [10, 20],
      [30, 40],
      [50, 60],
    ]);

    const svg = exportStrokeToSvgPath(stroke);
    expect(svg).toBe("M 10.0 20.0 L 30.0 40.0 L 50.0 60.0");
  });
});
