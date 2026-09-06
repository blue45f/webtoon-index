import { describe, expect, it } from "vitest";

import {
  cascadeCanvasPlacementAnchor,
  createCanvasImageElement,
} from "./studio-image-placement";

describe("createCanvasImageElement", () => {
  it("centers and scales a wide render inside the studio canvas", () => {
    const element = createCanvasImageElement({
      id: "asset-1",
      src: "data:image/png;base64,asset",
      canvasWidth: 720,
      canvasHeight: 1080,
      sourceWidth: 1200,
      sourceHeight: 900,
      horizontalInset: 120,
    });

    expect(element).toEqual({
      id: "asset-1",
      type: "image",
      src: "data:image/png;base64,asset",
      x: 60,
      y: 315,
      width: 600,
      height: 450,
      rotation: 0,
    });
  });

  it("keeps smaller renders at native size and clamps top placement", () => {
    const element = createCanvasImageElement({
      id: "asset-2",
      src: "data:image/png;base64,tall",
      canvasWidth: 720,
      canvasHeight: 520,
      sourceWidth: 240,
      sourceHeight: 900,
      horizontalInset: 120,
      minY: 40,
    });

    expect(element.width).toBe(240);
    expect(element.height).toBe(900);
    expect(element.x).toBe(240);
    expect(element.y).toBe(40);
  });

  it("anchors an asset at the active work area instead of the document center", () => {
    const element = createCanvasImageElement({
      id: "asset-visible",
      src: "data:image/png;base64,visible",
      canvasWidth: 720,
      canvasHeight: 4000,
      sourceWidth: 240,
      sourceHeight: 160,
      placement: {
        anchor: { x: 360, y: 2860 },
        bounds: { x: 0, y: 0, width: 720, height: 4000 },
        inset: 40,
      },
    });

    expect(element).toMatchObject({
      x: 240,
      y: 2780,
      width: 240,
      height: 160,
    });
  });

  it("fits oversized and tall assets inside the selected frame on both axes", () => {
    const element = createCanvasImageElement({
      id: "asset-frame",
      src: "data:image/png;base64,frame",
      canvasWidth: 720,
      canvasHeight: 2000,
      sourceWidth: 600,
      sourceHeight: 1800,
      placement: {
        anchor: { x: 360, y: 600 },
        bounds: { x: 80, y: 200, width: 560, height: 800 },
        inset: 20,
      },
    });

    expect(element.width).toBe(253);
    expect(element.height).toBe(760);
    expect(element.x).toBe(234);
    expect(element.y).toBe(220);
  });

  it("clamps a pointer-anchored drop so the whole asset remains on canvas", () => {
    const element = createCanvasImageElement({
      id: "asset-edge",
      src: "data:image/png;base64,edge",
      canvasWidth: 720,
      canvasHeight: 1080,
      sourceWidth: 200,
      sourceHeight: 120,
      placement: {
        anchor: { x: 710, y: 1070 },
        bounds: { x: 0, y: 0, width: 720, height: 1080 },
        inset: 40,
      },
    });

    expect(element.x).toBe(480);
    expect(element.y).toBe(920);
  });

  it("fits a large asset inside the currently visible document intersection", () => {
    const element = createCanvasImageElement({
      id: "asset-visible-fit",
      src: "data:image/png;base64,visible-fit",
      canvasWidth: 720,
      canvasHeight: 4_000,
      sourceWidth: 720,
      sourceHeight: 4_000,
      placement: {
        anchor: { x: 360, y: 1_800 },
        bounds: { x: 0, y: 1_400, width: 720, height: 800 },
        inset: 40,
      },
    });

    expect(element).toMatchObject({ x: 295, y: 1_440, width: 130, height: 720 });
  });

  it("intersects partially off-document bounds without shifting their full size inward", () => {
    const element = createCanvasImageElement({
      id: "asset-clipped-target",
      src: "data:image/png;base64,clipped-target",
      canvasWidth: 720,
      canvasHeight: 1_080,
      sourceWidth: 500,
      sourceHeight: 500,
      placement: {
        anchor: { x: 50, y: 250 },
        bounds: { x: -100, y: 0, width: 500, height: 500 },
      },
    });

    expect(element).toMatchObject({ x: 0, y: 50, width: 400, height: 400 });
  });

  it("falls back to a safe whole-canvas target when requested bounds are fully outside", () => {
    const element = createCanvasImageElement({
      id: "asset-invalid-target",
      src: "data:image/png;base64,invalid-target",
      canvasWidth: 720,
      canvasHeight: 1_080,
      sourceWidth: 200,
      sourceHeight: 120,
      placement: {
        anchor: { x: 900, y: 1_300 },
        bounds: { x: 800, y: 1_200, width: 100, height: 100 },
        inset: 40,
      },
    });

    expect(element).toMatchObject({ x: 480, y: 920, width: 200, height: 120 });
  });
});

describe("cascadeCanvasPlacementAnchor", () => {
  it("keeps the first insert exact and offsets repeated inserts predictably", () => {
    const anchor = { x: 320, y: 480 };

    expect(cascadeCanvasPlacementAnchor(anchor, 0)).toEqual(anchor);
    expect(cascadeCanvasPlacementAnchor(anchor, 1)).toEqual({ x: 338, y: 498 });
    expect(cascadeCanvasPlacementAnchor(anchor, 2)).toEqual({ x: 356, y: 516 });
    expect(cascadeCanvasPlacementAnchor(anchor, 9)).toEqual({ x: 410, y: 570 });
  });
});
