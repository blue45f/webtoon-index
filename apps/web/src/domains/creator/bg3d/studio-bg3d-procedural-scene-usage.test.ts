import { describe, expect, it, vi } from "vitest";

import { calculateStudioBg3dProceduralSceneUsage } from "./studio-bg3d-procedural-scene-usage";

const MODEL_METRICS = Object.freeze({
  nodes: 3,
  triangles: 120,
  drawCalls: 2,
  materials: 2,
  textures: 1,
});

describe("calculateStudioBg3dProceduralSceneUsage", () => {
  it("counts primitive overlays and every placed model instance", () => {
    const resolve = vi.fn(() => MODEL_METRICS);

    expect(
      calculateStudioBg3dProceduralSceneUsage(
        [{ kind: "box" }, { kind: "plane" }],
        [{ modelId: "desk" }, { modelId: "desk" }],
        resolve,
      ),
    ).toEqual({
      nodes: 8,
      triangles: 254,
      drawCalls: 8,
      materials: 8,
      textures: 2,
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("counts a zero-node imported metric as one placed scene root", () => {
    expect(
      calculateStudioBg3dProceduralSceneUsage([], [{ modelId: "empty" }], () => ({
        ...MODEL_METRICS,
        nodes: 0,
      })),
    ).toMatchObject({ nodes: 1 });
  });

  it("fails closed when an imported model has no metrics", () => {
    expect(
      calculateStudioBg3dProceduralSceneUsage([], [{ modelId: "missing" }], () => null),
    ).toBeNull();
  });

  it.each([
    ["negative", { ...MODEL_METRICS, triangles: -1 }],
    ["fractional", { ...MODEL_METRICS, drawCalls: 1.5 }],
    ["non-finite", { ...MODEL_METRICS, materials: Number.NaN }],
  ])("fails closed for %s model metrics", (_label, metrics) => {
    expect(
      calculateStudioBg3dProceduralSceneUsage([], [{ modelId: "bad" }], () => metrics),
    ).toBeNull();
  });
});
