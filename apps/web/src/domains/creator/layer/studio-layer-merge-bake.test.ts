import { describe, expect, it } from "vitest";

import { planStudioLayerMergeDown } from "./studio-layer-merge";
import {
  applyStudioMergeBakeToElements,
  bakeStudioMergeCompositeSync,
  planStudioMergeBakeMode,
  studioMergeSourcesAreRasterizable,
  type StudioMergeBakeCanvas,
  type StudioMergeBakeImageSource,
} from "./studio-layer-merge-bake";

function fakeCanvas(width: number, height: number): StudioMergeBakeCanvas {
  return {
    width,
    height,
    getContext() {
      return {
        clearRect() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        scale() {},
        globalAlpha: 1,
        drawImage() {},
      };
    },
    toDataURL() {
      return `data:image/png;base64,${width}x${height}`;
    },
  };
}

describe("studio layer merge bake", () => {
  const sources: StudioMergeBakeImageSource[] = [
    { id: "a", type: "image", src: "data:a", x: 0, y: 0, width: 10, height: 10 },
    { id: "b", type: "image", src: "data:b", x: 5, y: 5, width: 10, height: 10 },
  ];

  it("detects rasterizable image-only sources", () => {
    expect(studioMergeSourcesAreRasterizable(sources)).toBe(true);
    expect(planStudioMergeBakeMode(sources)).toEqual({ mode: "raster" });
    expect(
      planStudioMergeBakeMode([
        ...sources,
        { id: "c", type: "draw", x: 0, y: 0, width: 1, height: 1 },
      ]).mode
    ).toBe("group");
  });

  it("bakes a deterministic composite through injected canvas", () => {
    const items = sources.map((source) => ({ id: source.id }));
    const plan = planStudioLayerMergeDown({
      items: [
        { id: "a" },
        { id: "b" },
      ],
      selectedId: "b",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const imagesById = new Map<string, CanvasImageSource>([
      ["a", {} as CanvasImageSource],
      ["b", {} as CanvasImageSource],
    ]);
    const baked = bakeStudioMergeCompositeSync({
      plan: plan.plan,
      sources,
      imagesById,
      newId: "merged",
      createCanvas: fakeCanvas,
    });
    expect(baked.ok).toBe(true);
    if (!baked.ok || baked.mode !== "raster") return;
    expect(baked.composite.src).toContain("data:image/png");
    expect(baked.composite.width).toBe(15);
    expect(baked.composite.height).toBe(15);
    expect(baked.composite.x).toBe(0);
    expect(baked.composite.y).toBe(0);

    const next = applyStudioMergeBakeToElements(items, plan.plan, baked.composite);
    expect(next.map((item) => item.id)).toEqual(["merged"]);
  });
});
