import { describe, expect, it } from "vitest";

import { buildStudioDocumentPresentScene } from "./studio-document-scene-present";

import type { El } from "../studio-element-model";

describe("buildStudioDocumentPresentScene", () => {
  it("puts document paths into viewport backing space and keeps owned ids", () => {
    const presented = buildStudioDocumentPresentScene({
      elements: [{
        id: "clean-rect",
        type: "draw",
        kind: "line",
        mode: "pen",
        points: [10, 10, 50, 30],
        stroke: "#ff0000",
        strokeWidth: 4,
      } as El],
      documentWidth: 100,
      documentHeight: 80,
      viewportWidth: 200,
      viewportHeight: 160,
      dpr: 2,
      documentTransform: {
        scaleX: 2,
        scaleY: 2,
        offsetX: 5,
        offsetY: 7,
        rotation: 0,
      },
    });
    expect(presented.ownedDocumentIds).toEqual(["clean-rect"]);
    expect(presented.scene.width).toBe(400);
    expect(presented.scene.height).toBe(320);
    const stroke = presented.scene.nodes.find((node) => node.kind === "stroke-path");
    expect(stroke?.kind).toBe("stroke-path");
    if (stroke?.kind !== "stroke-path") return;
    const move = stroke.path.verbs[0];
    expect(move).toMatchObject({ v: "M" });
    if (move && move.v === "M") {
      expect(move.x).toBeCloseTo((5 + 10 * 2) * 2);
      expect(move.y).toBeCloseTo((7 + 10 * 2) * 2);
    }
  });

  it("does not take brush strokes away from Konva on a mixed page", () => {
    const presented = buildStudioDocumentPresentScene({
      elements: [
        {
          id: "panel",
          type: "frame",
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          stroke: "#111",
          strokeWidth: 1,
        },
        {
          id: "wash",
          type: "draw",
          points: [0, 0, 20, 8],
          stroke: "#3344aa",
          strokeWidth: 18,
          brush: "watercolor",
        },
      ] as El[],
      documentWidth: 100,
      documentHeight: 80,
      viewportWidth: 200,
      viewportHeight: 160,
      dpr: 1,
    });
    expect(presented.ownedDocumentIds).toEqual([]);
    expect(presented.scene.nodes).toEqual([]);
  });

  it("makes a clean geometric DrawEl page Vello pixel-authoritative", () => {
    const presented = buildStudioDocumentPresentScene({
      elements: [
        {
          id: "clean-ellipse",
          type: "draw",
          kind: "ellipse",
          mode: "pen",
          points: [12, 8, 72, 48],
          stroke: "#102030",
          strokeWidth: 4,
          fill: "#f0a030",
          opacity: 0.75,
        },
        {
          id: "clean-arrow",
          type: "draw",
          kind: "arrow",
          mode: "pen",
          points: [16, 60, 84, 24],
          stroke: "#0055ff",
          strokeWidth: 3,
        },
      ] as El[],
      documentWidth: 100,
      documentHeight: 80,
      viewportWidth: 200,
      viewportHeight: 160,
      dpr: 2,
    });
    expect(presented.ownedDocumentIds).toEqual(["clean-ellipse", "clean-arrow"]);
    expect(presented.scene.nodes.length).toBeGreaterThan(2);
    expect(presented.scene.nodes.every((node) => (
      node.kind === "fill-path" || node.kind === "stroke-path"
    ))).toBe(true);
  });

  it("keeps a dashed geometric DrawEl on the explicit legacy boundary", () => {
    const presented = buildStudioDocumentPresentScene({
      elements: [{
        id: "dashed-line",
        type: "draw",
        kind: "line",
        mode: "pen",
        points: [8, 8, 72, 48],
        stroke: "#000000",
        strokeWidth: 2,
        strokeStyle: {
          dash: "dash",
          lineCap: "round",
          arrowStart: "none",
          arrowEnd: "none",
        },
      }] as El[],
      documentWidth: 100,
      documentHeight: 80,
      viewportWidth: 200,
      viewportHeight: 160,
      dpr: 1,
    });
    expect(presented.ownedDocumentIds).toEqual([]);
    expect(presented.scene.nodes).toEqual([]);
  });

  it("does not upload Konva selection chrome to WebGPU on a mixed page", () => {
    const presented = buildStudioDocumentPresentScene({
      elements: [{
        id: "lettering",
        type: "text",
        x: 8,
        y: 8,
        width: 40,
        height: 16,
        text: "대사",
        fontSize: 14,
        fill: "#000000",
        rotation: 0,
      } as El],
      documentWidth: 100,
      documentHeight: 80,
      viewportWidth: 200,
      viewportHeight: 160,
      dpr: 2,
      overlayNodes: [{
        id: "selection-box",
        kind: "fill-path",
        path: { verbs: [{ v: "M", x: 0, y: 0 }, { v: "L", x: 10, y: 0 }, { v: "Z" }] },
        paint: { kind: "solid", color: { r: 1, g: 0, b: 0, a: 1 } },
        fillRule: "nonzero",
        opacity: 1,
        blend: "src-over",
      }],
    });
    expect(presented.ownedDocumentIds).toEqual([]);
    expect(presented.scene.nodes).toEqual([]);
  });
});
