import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_SHAPE_PARAMS } from "./brush/studio-stroke-shapes";
import {
  buildStudioRoughShapeRenderPlan,
  loadStudioRoughGenerator,
  studioRoughSeedFromElementId,
  type StudioRoughGeneratorHandle,
  type StudioRoughShapeInput,
} from "./studio-rough-shape";
import {
  buildStudioRoughSvgParityPlan,
  studioRoughCanvasSvgVariationSeed,
} from "./studio-rough-svg-parity";

describe("Studio Rough Canvas/SVG parity bridge", () => {
  let canvasGenerator: StudioRoughGeneratorHandle;

  beforeAll(async () => {
    canvasGenerator = await loadStudioRoughGenerator();
  });

  const baseInput = {
    points: [12, 18, 172, 118],
    strokeWidth: 6,
    hasFill: true,
    shapeParams: DEFAULT_SHAPE_PARAMS,
    style: {
      enabled: true,
      roughness: 2.1,
      bowing: 2.5,
      fillStyle: "cross-hatch",
    },
  } as const;

  it.each([
    "line",
    "arrow",
    "rect",
    "ellipse",
    "star",
    "triangle",
    "polygon",
  ] as const)(
    "%s가 retained Canvas와 같은 seed·rough op geometry를 만든다",
    (kind) => {
      const elementId = `rough-parity-${kind}`;
      const variationIndex = 3;
      const svgPlan = buildStudioRoughSvgParityPlan({
        ...baseInput,
        elementId,
        variationIndex,
        kind,
      });
      const canvasInput: StudioRoughShapeInput = {
        ...baseInput,
        kind,
        seed: studioRoughSeedFromElementId(elementId) + variationIndex,
      };
      const canvasPlan = buildStudioRoughShapeRenderPlan(
        canvasGenerator,
        canvasInput,
      );

      expect(svgPlan.seed).toBe(canvasInput.seed);
      expect(svgPlan.paths).toEqual(canvasPlan);
      expect(svgPlan.paths.length).toBeGreaterThan(0);
    },
  );

  it("대칭 variation index가 달라지면 둘 다 같은 새 seed·geometry로 이동한다", () => {
    const first = buildStudioRoughSvgParityPlan({
      ...baseInput,
      elementId: "rough-symmetry-seed",
      variationIndex: 0,
      kind: "rect",
    });
    const second = buildStudioRoughSvgParityPlan({
      ...baseInput,
      elementId: "rough-symmetry-seed",
      variationIndex: 1,
      kind: "rect",
    });

    expect(second.seed).toBe(first.seed + 1);
    expect(second.paths).not.toEqual(first.paths);
  });

  it("비정상 variation index는 Canvas 원본 variation seed로 fail-closed 한다", () => {
    const baseSeed = studioRoughSeedFromElementId("rough-invalid-index");

    expect(studioRoughCanvasSvgVariationSeed("rough-invalid-index", -1))
      .toBe(baseSeed);
    expect(studioRoughCanvasSvgVariationSeed("rough-invalid-index", 0.5))
      .toBe(baseSeed);
    expect(studioRoughCanvasSvgVariationSeed("rough-invalid-index", 2))
      .toBe(baseSeed + 2);
  });
});
