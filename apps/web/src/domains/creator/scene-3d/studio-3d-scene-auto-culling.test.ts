import { describe, it, expect } from "vitest";

import { Studio3DSceneAutoCulling } from "./studio-3d-scene-auto-culling";

describe("Studio3DSceneAutoCulling", () => {
  it("evaluates atmosphere lighting parameters for Golden Hour vs Cyberpunk Night", () => {
    const culling = new Studio3DSceneAutoCulling();
    const goldenHour = culling.evaluateAtmosphereLighting("golden-hour-sunset");
    expect(goldenHour.sunAltitudeDeg).toBe(14);
    expect(goldenHour.sunColorHex).toBe("#ff7a00");

    const cyberpunk = culling.evaluateAtmosphereLighting("cyberpunk-neon-night");
    expect(cyberpunk.sunAltitudeDeg).toBeLessThan(0);
    expect(cyberpunk.ambientColorHex).toContain("#4c0519");
  });

  it("automatically culls obstructing ceiling when camera looks from above", () => {
    const culling = new Studio3DSceneAutoCulling();
    culling.registerElement({
      id: "ceiling-1",
      role: "ceiling",
      boundingBox: {
        min: [-5, 2.8, -5],
        max: [5, 3.0, 5],
      },
      normal: [0, -1, 0],
    });

    // Camera at Y=4.5 looking down at character inside at Y=1.0
    const visibility = culling.evaluateComponentVisibility([0, 4.5, 5], [0, 1.0, 0]);
    expect(visibility.get("ceiling-1")?.isVisible).toBe(false);
  });

  it("retains visibility of floor and back walls", () => {
    const culling = new Studio3DSceneAutoCulling();
    culling.registerElement({
      id: "floor-1",
      role: "floor",
      boundingBox: {
        min: [-5, 0, -5],
        max: [5, 0.1, 5],
      },
      normal: [0, 1, 0],
    });

    const visibility = culling.evaluateComponentVisibility([0, 2, 5], [0, 1.0, 0]);
    expect(visibility.get("floor-1")?.isVisible).toBe(true);
  });
});
