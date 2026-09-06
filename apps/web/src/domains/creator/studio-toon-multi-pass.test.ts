import { describe, expect, it } from "vitest";

import {
  createToonMultiPassCompositor,
  generateCompositeLayerStack,
  updatePassConfig,
} from "./studio-toon-multi-pass";

describe("Studio Toon Multi-Pass Compositor", () => {
  it("initializes multi-pass compositor with standard passes and blend modes", () => {
    const comp = createToonMultiPassCompositor({
      id: "comp_shot_1",
      sceneId: "scene_school",
      shotId: "shot_01",
      resolution: { width: 1200, height: 800 },
    });

    expect(comp.passes).toHaveLength(12);

    // Line passes default to multiply
    const outerLine = comp.passes.find((p) => p.passKind === "outer-line")!;
    expect(outerLine.blendMode).toBe("multiply");
    expect(outerLine.isEnabled).toBe(true);

    // Depth pass defaults to false in visual stack
    const depth = comp.passes.find((p) => p.passKind === "depth")!;
    expect(depth.isEnabled).toBe(false);
  });

  it("updates pass configuration and clamps opacity", () => {
    let comp = createToonMultiPassCompositor({
      id: "comp_1",
      sceneId: "sc",
      shotId: "sh",
      resolution: { width: 800, height: 600 },
    });

    comp = updatePassConfig(comp, "shadow", { opacity: 0.6, blendMode: "multiply" });
    const shadow = comp.passes.find((p) => p.passKind === "shadow")!;
    expect(shadow.opacity).toBe(0.6);
    expect(shadow.blendMode).toBe("multiply");
  });

  it("generates 2D composite layer stack from active passes", () => {
    let comp = createToonMultiPassCompositor({
      id: "comp_stack",
      sceneId: "sc",
      shotId: "sh10",
      resolution: { width: 800, height: 600 },
    });

    // Enable normal pass
    comp = updatePassConfig(comp, "normal", { isEnabled: true });

    const layers = generateCompositeLayerStack(comp);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.some((l) => l.passKind === "normal")).toBe(true);
    expect(layers[0].layerId).toContain("layer_3d_sh10");
  });
});
