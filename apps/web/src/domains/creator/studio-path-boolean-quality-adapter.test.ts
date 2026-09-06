import { describe, expect, it, vi } from "vitest";

import {
  combineStudioShapesWithCanvasKit,
  type StudioCanvasKitPathBooleanClient,
} from "./render/studio-canvaskit-path-boolean-document-adapter";
import {
  studioPathBooleanOutputFromPortableContours,
  studioPathBooleanShapeToSvgPathData,
} from "./studio-path-boolean";

import type { StudioPortablePathGeometry } from "./render/studio-canvaskit-adapter";

function geometry(
  contours: StudioPortablePathGeometry["contours"],
): StudioPortablePathGeometry {
  const coordinates = contours.flatMap((contour) => contour.points);
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    kind: "studio-portable-path-geometry",
    version: 1,
    fillRule: "nonzero",
    flatnessPx: 0.25,
    contours,
    flattenedPointCount: coordinates.length / 2,
    sourceCommandValueCount: 16,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

describe("Studio CanvasKit path boolean document adapter", () => {
  it("keeps ellipse and rounded-rectangle inputs as cubic paths", () => {
    const ellipse = studioPathBooleanShapeToSvgPathData({
      kind: "ellipse",
      points: [0, 0, 100, 60],
    });
    const rounded = studioPathBooleanShapeToSvgPathData({
      kind: "rect",
      points: [10, 20, 110, 100],
      shapeParams: { cornerRadius: 18 },
    });
    expect(ellipse.ok).toBe(true);
    expect(rounded.ok).toBe(true);
    if (!ellipse.ok || !rounded.ok) return;
    expect((ellipse.pathData.match(/C/gu) ?? [])).toHaveLength(4);
    expect((rounded.pathData.match(/C/gu) ?? [])).toHaveLength(4);
    expect(ellipse.pathData).not.toContain("NaN");
    expect(rounded.pathData).not.toContain("NaN");
  });

  it("reconstructs outer, hole and nested-island hierarchy from portable contours", () => {
    const result = studioPathBooleanOutputFromPortableContours([
      {
        points: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0],
        closed: true,
      },
      {
        points: [20, 20, 80, 20, 80, 80, 20, 80, 20, 20],
        closed: true,
      },
      {
        points: [40, 40, 60, 40, 60, 60, 40, 60, 40, 40],
        closed: true,
      },
    ], "exclude");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(2);
    expect(result.output.pieces.map((piece) => piece.holeCount).sort())
      .toEqual([0, 1]);
  });

  it("maps subtract to CanvasKit difference and returns a correlated provider receipt", async () => {
    const portable = geometry([
      {
        points: [0, 0, 50, 0, 50, 40, 0, 40, 0, 0],
        closed: true,
      },
    ]);
    const pathBoolean = vi.fn<
      StudioCanvasKitPathBooleanClient["pathBoolean"]
    >(async () => ({
      execution: "quality-worker" as const,
      providerId: "canvaskit" as const,
      workerEpoch: 7,
      requestId: 11,
      requestToken: "q:7:11:path-boolean",
      operationKind: "path-boolean" as const,
      result: {
        ok: true as const,
        pathData: "M0 0H50V40H0Z",
        geometry: portable,
      },
    }));
    const result = await combineStudioShapesWithCanvasKit(
      { pathBoolean },
      { kind: "rect", points: [0, 0, 100, 100] },
      { kind: "ellipse", points: [50, 10, 110, 90] },
      "subtract",
    );
    expect(pathBoolean).toHaveBeenCalledTimes(1);
    expect(pathBoolean.mock.calls[0]?.[2]).toBe("difference");
    expect(pathBoolean.mock.calls[0]?.[0]).toMatch(/^M/u);
    expect(pathBoolean.mock.calls[0]?.[1]).toContain("C");
    expect(result).toMatchObject({
      ok: true,
      provider: {
        id: "canvaskit",
        adapterVersion: 1,
        workerEpoch: 7,
        requestId: 11,
      },
    });
  });

  it("rejects a successful-looking Worker response without portable geometry", async () => {
    const result = await combineStudioShapesWithCanvasKit(
      {
        async pathBoolean() {
          return {
            execution: "quality-worker",
            providerId: "canvaskit",
            workerEpoch: 1,
            requestId: 1,
            requestToken: "q:1:1:path-boolean",
            operationKind: "path-boolean",
            result: { ok: true, pathData: "M0 0H1V1Z" },
          };
        },
      },
      { kind: "rect", points: [0, 0, 10, 10] },
      { kind: "rect", points: [5, 0, 15, 10] },
      "union",
    );
    expect(result).toEqual({
      ok: false,
      reason: "CanvasKit Worker 결과에 안전한 contour 영수증이 없습니다.",
    });
  });
});
