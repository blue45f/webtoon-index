import { describe, expect, it } from "vitest";

import {
  applyStudioFillAffine,
  collectOverlappingStudioFillReferenceLayers,
  collectStudioFillReferenceLayers,
  composeStudioFillReferenceImage,
  encodeStudioFillReferenceCanvas,
  multiplyStudioFillAffine,
  studioFillAffineIsPixelAligned,
  studioFillLayerToPageMatrix,
  studioFillLayerPageBounds,
  studioFillLayerToTargetMatrix,
  studioFillPageBoundsIntersect,
  studioFillPageToLayerMatrix,
  withStudioFillPageReferenceLayers,
  type StudioFillReferenceLayer,
} from "./studio-fill-reference";

function layer(patch: Partial<StudioFillReferenceLayer> = {}): StudioFillReferenceLayer {
  return {
    id: patch.id ?? "layer",
    name: patch.name ?? "Layer",
    src: patch.src ?? "data:image/png;base64,x",
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    width: patch.width ?? 100,
    height: patch.height ?? 50,
    rotation: patch.rotation,
    flipped: patch.flipped,
    flippedY: patch.flippedY,
    opacity: patch.opacity,
    hidden: patch.hidden,
    fillReference: patch.fillReference,
  };
}

describe("studio fill affine geometry", () => {
  it("multiplies Canvas2D matrices in application order", () => {
    const translate = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
    const scale = { a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 };
    const matrix = multiplyStudioFillAffine(translate, scale);
    expect(applyStudioFillAffine(matrix, { x: 4, y: 5 })).toEqual({ x: 18, y: 35 });
  });

  it("maps natural pixels through display scale and page translation", () => {
    const matrix = studioFillLayerToPageMatrix(
      layer({ x: 30, y: 40, width: 200, height: 100 }),
      { width: 100, height: 50 },
    );
    expect(applyStudioFillAffine(matrix, { x: 10, y: 20 })).toEqual({ x: 50, y: 80 });
  });

  it("page-to-layer is the inverse for translation, scale, rotation, and flips", () => {
    const subject = layer({
      x: 37,
      y: -12,
      width: 240,
      height: 90,
      rotation: 31,
      flipped: true,
      flippedY: true,
    });
    const natural = { width: 480, height: 180 };
    const toPage = studioFillLayerToPageMatrix(subject, natural);
    const fromPage = studioFillPageToLayerMatrix(subject, natural);
    const source = { x: 123.25, y: 61.5 };
    const roundTrip = applyStudioFillAffine(fromPage, applyStudioFillAffine(toPage, source));
    expect(roundTrip.x).toBeCloseTo(source.x, 8);
    expect(roundTrip.y).toBeCloseTo(source.y, 8);
  });

  it("maps a source into an identical target as identity even when both are transformed", () => {
    const subject = layer({ x: 22, y: 48, width: 80, height: 160, rotation: -45, flipped: true });
    const natural = { width: 400, height: 800 };
    const matrix = studioFillLayerToTargetMatrix(subject, natural, subject, natural);
    const point = applyStudioFillAffine(matrix, { x: 77, y: 311 });
    expect(point.x).toBeCloseTo(77, 8);
    expect(point.y).toBeCloseTo(311, 8);
  });

  it("aligns differently sized page layers in target pixels", () => {
    const target = layer({ id: "target", x: 100, y: 200, width: 200, height: 100 });
    const source = layer({ id: "line", x: 200, y: 225, width: 100, height: 50 });
    const matrix = studioFillLayerToTargetMatrix(
      source,
      { width: 1000, height: 500 },
      target,
      { width: 400, height: 200 },
    );
    expect(applyStudioFillAffine(matrix, { x: 0, y: 0 })).toEqual({ x: 200, y: 50 });
    expect(applyStudioFillAffine(matrix, { x: 1000, y: 500 })).toEqual({ x: 400, y: 150 });
  });

  it("computes rotated page bounds and conservative intersection", () => {
    const bounds = studioFillLayerPageBounds(layer({ x: 100, y: 50, width: 20, height: 10, rotation: 90 }));
    expect(bounds.x).toBeCloseTo(90);
    expect(bounds.y).toBeCloseTo(50);
    expect(bounds.width).toBeCloseTo(10);
    expect(bounds.height).toBeCloseTo(20);
    expect(studioFillPageBoundsIntersect(bounds, { x: 95, y: 60, width: 20, height: 20 })).toBe(true);
    expect(studioFillPageBoundsIntersect(bounds, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });

  it("recognizes only integer axis-aligned matrices as pixel aligned", () => {
    expect(studioFillAffineIsPixelAligned({ a: 2, b: 0, c: 0, d: -1, e: 12, f: 4 })).toBe(true);
    expect(studioFillAffineIsPixelAligned({ a: 1.5, b: 0, c: 0, d: 1, e: 12, f: 4 })).toBe(false);
    expect(studioFillAffineIsPixelAligned({ a: 1, b: 0.1, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
  });
});

describe("collectStudioFillReferenceLayers", () => {
  const layers = [
    layer({ id: "target", name: "채색" }),
    layer({ id: "hidden", hidden: true, fillReference: true }),
    layer({ id: "line", fillReference: true }),
    layer({ id: "tone" }),
  ];

  it("uses only the target for current-layer scope", () => {
    expect(collectStudioFillReferenceLayers(layers, "target", "current").map((item) => item.id)).toEqual([
      "target",
    ]);
  });

  it("keeps visible explicit reference layers and excludes hidden ones", () => {
    expect(collectStudioFillReferenceLayers(layers, "target", "reference").map((item) => item.id)).toEqual([
      "line",
    ]);
  });

  it("keeps z-order for all visible raster layers", () => {
    expect(collectStudioFillReferenceLayers(layers, "target", "all-visible").map((item) => item.id)).toEqual([
      "line",
      "tone",
    ]);
  });

  it("returns an empty list when the target does not exist", () => {
    expect(collectStudioFillReferenceLayers(layers, "missing", "current")).toEqual([]);
    expect(collectStudioFillReferenceLayers(layers, "missing", "reference")).toEqual([]);
    expect(collectStudioFillReferenceLayers(layers, "missing", "all-visible")).toEqual([]);
  });

  it("excludes visible references whose page bounds do not overlap the target", () => {
    const target = layer({ id: "target", x: 0, y: 0, width: 100, height: 100 });
    const near = layer({ id: "near", x: 80, y: 80, width: 40, height: 40, fillReference: true });
    const far = layer({ id: "far", x: 500, y: 500, width: 40, height: 40, fillReference: true });
    expect(
      collectOverlappingStudioFillReferenceLayers([target, near, far], "target", "reference").map(
        (item) => item.id,
      ),
    ).toEqual(["near"]);
  });

  it("adds a page-space vector raster as a boundary in both non-current scopes", () => {
    const layers = withStudioFillPageReferenceLayers(
      [
        layer({
          id: "target",
          x: 100,
          y: 200,
          width: 200,
          height: 100,
        }),
        layer({ id: "raster-line", fillReference: true }),
      ],
      [{
        id: "visible-vector-lines",
        name: "표시 벡터 선화",
        src: "data:image/png;base64,vector",
        pageWidth: 800,
        pageHeight: 1_200,
        fillReference: true,
      }],
    );

    expect(
      collectOverlappingStudioFillReferenceLayers(layers, "target", "all-visible")
        .map((item) => item.id),
    ).toContain("visible-vector-lines");
    expect(
      collectOverlappingStudioFillReferenceLayers(layers, "target", "reference")
        .map((item) => item.id),
    ).toContain("visible-vector-lines");
    expect(
      collectOverlappingStudioFillReferenceLayers(layers, "target", "current")
        .map((item) => item.id),
    ).toEqual(["target"]);

    const vectorLayer = layers.find((item) => item.id === "visible-vector-lines");
    expect(vectorLayer).toMatchObject({
      x: 0,
      y: 0,
      width: 800,
      height: 1_200,
    });
  });
});

describe("reference composition cancellation and encoding", () => {
  it("uses the synchronous data URL fallback only when toBlob is unavailable", async () => {
    let calls = 0;
    const dataUrl = await encodeStudioFillReferenceCanvas({
      width: 2,
      height: 2,
      getContext: () => null,
      toDataURL: () => {
        calls++;
        return "data:image/png;base64,ok";
      },
    });

    expect(dataUrl).toBe("data:image/png;base64,ok");
    expect(calls).toBe(1);
  });

  it("rejects an in-flight toBlob encode immediately when cancelled", async () => {
    let callback: ((blob: Blob | null) => void) | null = null;
    const controller = new AbortController();
    const pending = encodeStudioFillReferenceCanvas({
      width: 2,
      height: 2,
      getContext: () => null,
      toDataURL: () => "unused",
      toBlob: (next) => {
        callback = next;
      },
    }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(callback).toBeTypeOf("function");
  });

  it("stops before image decoding or canvas allocation when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let canvasCalls = 0;

    await expect(
      composeStudioFillReferenceImage(
        [
          layer({ id: "target" }),
          layer({ id: "line", fillReference: true }),
        ],
        "target",
        "reference",
        () => {
          canvasCalls++;
          return null;
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(canvasCalls).toBe(0);
  });
});
