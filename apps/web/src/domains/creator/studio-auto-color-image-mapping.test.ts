import { describe, expect, it } from "vitest";

import {
  STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE,
  STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_ROTATION,
  STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_SCALE,
  STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_SOURCE_DIMENSION,
  STUDIO_AUTO_COLOR_IMAGE_MAPPING_MIN_ABS_SCALE,
  mapStudioAutoColorCanvasPointToSource,
  type StudioAutoColorImageMappingInput,
  type StudioAutoColorImageTransform,
} from "./studio-auto-color-image-mapping";

const IMAGE = Object.freeze({
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  sourceWidth: 40,
  sourceHeight: 20,
}) satisfies StudioAutoColorImageTransform;

function forwardKonvaPoint(
  image: StudioAutoColorImageTransform,
  normalizedX: number,
  normalizedY: number,
): Readonly<{ x: number; y: number }> {
  const rotation = ((image.rotation ?? 0) % 360) * Math.PI / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = normalizedX * image.width;
  const localY = normalizedY * image.height;
  const scaledX = localX * (image.scaleX ?? 1);
  const scaledY = localY * (image.scaleY ?? 1);
  return Object.freeze({
    x: image.x + scaledX * cos - scaledY * sin,
    y: image.y + scaledX * sin + scaledY * cos,
  });
}

function mapNormalized(
  image: StudioAutoColorImageTransform,
  normalizedX: number,
  normalizedY: number,
) {
  const point = forwardKonvaPoint(image, normalizedX, normalizedY);
  return mapStudioAutoColorCanvasPointToSource({
    canvasX: point.x,
    canvasY: point.y,
    image,
  });
}

describe("studio auto-color image affine inverse mapping", () => {
  it("preserves the existing unrotated proportional and addressable-edge semantics", () => {
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 100,
        canvasY: 50,
        image: IMAGE,
      }),
    ).toEqual({ inside: true, sourceX: 0, sourceY: 0 });

    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 200,
        canvasY: 100,
        image: IMAGE,
      }),
    ).toEqual({ inside: true, sourceX: 20, sourceY: 10 });

    const bottomRight = mapStudioAutoColorCanvasPointToSource({
      canvasX: 300,
      canvasY: 150,
      image: IMAGE,
    });
    expect(bottomRight).not.toBeNull();
    expect(bottomRight?.inside).toBe(true);
    if (!bottomRight?.inside) throw new Error("Expected an inside edge hit");
    expect(bottomRight.sourceX).toBeCloseTo(40 - 1e-6, 9);
    expect(bottomRight.sourceY).toBeCloseTo(20 - 1e-6, 9);

    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 300.001,
        canvasY: 150,
        image: IMAGE,
      }),
    ).toEqual({ inside: false, sourceX: null, sourceY: null });
  });

  it.each([90, 180, 270, -90, 450])(
    "inverts the exact Konva transform at %s degrees",
    (rotation) => {
      const image = { ...IMAGE, rotation };
      const result = mapNormalized(image, 0.25, 0.75);
      expect(result).not.toBeNull();
      expect(result?.inside).toBe(true);
      if (!result?.inside) throw new Error("Expected rotated point inside");
      expect(result.sourceX).toBeCloseTo(10, 10);
      expect(result.sourceY).toBeCloseTo(15, 10);
    },
  );

  it.each([33.3, -126.75, 359.125])(
    "round-trips free rotation %s without quadrant assumptions",
    (rotation) => {
      const image = {
        ...IMAGE,
        x: -345.25,
        y: 712.75,
        rotation,
        scaleX: 1.75,
        scaleY: 0.625,
        sourceWidth: 4096,
        sourceHeight: 2048,
      };
      const result = mapNormalized(image, 0.314159, 0.271828);
      expect(result).not.toBeNull();
      expect(result?.inside).toBe(true);
      if (!result?.inside) throw new Error("Expected free-rotated point inside");
      expect(result.sourceX).toBeCloseTo(0.314159 * 4096, 8);
      expect(result.sourceY).toBeCloseTo(0.271828 * 2048, 8);
    },
  );

  it.each([
    { scaleX: -1, scaleY: 1, rotation: 0 },
    { scaleX: 1, scaleY: -1, rotation: 0 },
    { scaleX: -2, scaleY: -0.5, rotation: 90 },
    { scaleX: -1.25, scaleY: 2.5, rotation: 37.5 },
  ])("inverts negative-scale flips around the Konva node origin: %o", (transform) => {
    const image = { ...IMAGE, ...transform };
    const point = forwardKonvaPoint(image, 0.2, 0.8);
    const result = mapStudioAutoColorCanvasPointToSource({
      canvasX: point.x,
      canvasY: point.y,
      image,
    });
    expect(result?.inside).toBe(true);
    if (!result?.inside) throw new Error("Expected flipped point inside");
    expect(result.sourceX).toBeCloseTo(8, 9);
    expect(result.sourceY).toBeCloseTo(16, 9);
  });

  it("uses Konva's origin-based negative scale and supports a translation-compensated legacy flip", () => {
    const originFlip = { ...IMAGE, scaleX: -1 };
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 50,
        canvasY: 100,
        image: originFlip,
      }),
    ).toEqual({ inside: true, sourceX: 10, sourceY: 10 });
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 150,
        canvasY: 100,
        image: originFlip,
      }),
    ).toEqual({ inside: false, sourceX: null, sourceY: null });

    // Moving the Konva origin to the old right edge keeps the visual frame at x=100..300 while
    // preserving the old center-flip lookup: visual left maps to the source's right edge.
    const boundsPreservingFlip = { ...IMAGE, x: 300, scaleX: -1 };
    const visualLeft = mapStudioAutoColorCanvasPointToSource({
      canvasX: 100,
      canvasY: 100,
      image: boundsPreservingFlip,
    });
    expect(visualLeft?.inside).toBe(true);
    if (!visualLeft?.inside) throw new Error("Expected translated flip inside");
    expect(visualLeft.sourceX).toBeCloseTo(40 - 1e-6, 9);
    expect(visualLeft.sourceY).toBe(10);
  });

  it("classifies rotated edges with a narrow floating-point tolerance but rejects real misses", () => {
    const image = {
      ...IMAGE,
      x: 1_234_567.25,
      y: -2_345_678.5,
      rotation: 71.125,
      scaleX: 1.125,
      scaleY: -0.875,
    };
    for (const [normalizedX, normalizedY] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      expect(mapNormalized(image, normalizedX, normalizedY)?.inside).toBe(true);
    }

    const miss = forwardKonvaPoint(image, 1 + 1e-5, 0.5);
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: miss.x,
        canvasY: miss.y,
        image,
      }),
    ).toEqual({ inside: false, sourceX: null, sourceY: null });
  });

  it("is deterministic, pure, and returns frozen non-usable outside results", () => {
    const input: StudioAutoColorImageMappingInput = {
      canvasX: 200,
      canvasY: 100,
      image: { ...IMAGE },
    };
    const before = structuredClone(input);
    const first = mapStudioAutoColorCanvasPointToSource(input);
    const second = mapStudioAutoColorCanvasPointToSource(input);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(Object.isFrozen(first)).toBe(true);

    const outside = mapStudioAutoColorCanvasPointToSource({
      ...input,
      canvasX: 99,
    });
    expect(outside).toEqual({ inside: false, sourceX: null, sourceY: null });
    expect(Object.isFrozen(outside)).toBe(true);
  });
});

describe("studio auto-color image mapping fail-closed admission", () => {
  it.each([
    { field: "x", value: Number.NaN },
    { field: "y", value: Number.POSITIVE_INFINITY },
    { field: "width", value: 0 },
    { field: "width", value: -1 },
    { field: "height", value: 0 },
    { field: "scaleX", value: 0 },
    { field: "scaleX", value: -0 },
    { field: "scaleY", value: Number.NaN },
    { field: "scaleX", value: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MIN_ABS_SCALE / 2 },
    { field: "scaleY", value: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_SCALE * 2 },
    { field: "rotation", value: Number.NaN },
    { field: "rotation", value: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_ROTATION + 1 },
    { field: "sourceWidth", value: 0 },
    { field: "sourceWidth", value: 1.5 },
    { field: "sourceHeight", value: Number.NaN },
    {
      field: "sourceHeight",
      value: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_SOURCE_DIMENSION + 1,
    },
  ])("rejects invalid image field $field=$value", ({ field, value }) => {
    const image = { ...IMAGE, [field]: value };
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 100,
        canvasY: 50,
        image,
      }),
    ).toBeNull();
  });

  it("rejects invalid and extreme canvas coordinates and transformed corner overflow", () => {
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: Number.NaN,
        canvasY: 50,
        image: IMAGE,
      }),
    ).toBeNull();
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE + 1,
        canvasY: 50,
        image: IMAGE,
      }),
    ).toBeNull();
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE - 1,
        canvasY: 0,
        image: {
          ...IMAGE,
          x: STUDIO_AUTO_COLOR_IMAGE_MAPPING_MAX_ABS_COORDINATE - 1,
          y: 0,
          width: 2,
          height: 1,
          sourceWidth: 2,
          sourceHeight: 1,
        },
      }),
    ).toBeNull();
  });

  it("rejects numerically ill-conditioned tiny displays at extreme translations", () => {
    expect(
      mapStudioAutoColorCanvasPointToSource({
        canvasX: 9_000_000,
        canvasY: 9_000_000,
        image: {
          x: 9_000_000,
          y: 9_000_000,
          width: 1,
          height: 1,
          scaleX: 1e-8,
          scaleY: 1e-8,
          rotation: 33,
          sourceWidth: 1,
          sourceHeight: 1,
        },
      }),
    ).toBeNull();
  });

  it("does not invoke hostile accessors and contains proxy failures", () => {
    let getterCalls = 0;
    const hostileInput = {
      canvasY: 50,
      image: IMAGE,
    } as Record<string, unknown>;
    Object.defineProperty(hostileInput, "canvasX", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 100;
      },
    });
    expect(
      mapStudioAutoColorCanvasPointToSource(
        hostileInput as unknown as StudioAutoColorImageMappingInput,
      ),
    ).toBeNull();
    expect(getterCalls).toBe(0);

    const proxy = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("hostile proxy");
      },
    });
    expect(
      mapStudioAutoColorCanvasPointToSource(
        proxy as StudioAutoColorImageMappingInput,
      ),
    ).toBeNull();
  });
});
