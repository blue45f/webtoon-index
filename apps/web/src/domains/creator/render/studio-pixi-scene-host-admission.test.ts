import { describe, expect, it } from "vitest";

import {
  buildStudioPixiSelectableOverlayFromElement,
  buildStudioPixiSelectableOverlaysForSelection,
  planStudioPixiOverlaySync,
  studioPixiSceneHostIsAlwaysOn,
} from "./studio-pixi-scene-host-admission";

describe("studio-pixi-scene-host-admission", () => {
  it("declares always-on product host policy", () => {
    expect(studioPixiSceneHostIsAlwaysOn()).toBe(true);
  });

  it("builds a rect overlay from element bounds", () => {
    const overlay = buildStudioPixiSelectableOverlayFromElement(
      { id: "a", type: "image", x: 10, y: 20, width: 100, height: 50 },
      2,
    );
    expect(overlay).toMatchObject({
      documentId: "a",
      zIndex: 2,
      shape: {
        kind: "rect",
        bounds: { x: 10, y: 20, width: 100, height: 50 },
      },
    });
  });

  it("skips hidden or zero-size elements", () => {
    expect(
      buildStudioPixiSelectableOverlayFromElement(
        { id: "h", type: "image", x: 0, y: 0, width: 10, height: 10, hidden: true },
        0,
      ),
    ).toBeNull();
    expect(
      buildStudioPixiSelectableOverlayFromElement(
        { id: "z", type: "image", x: 0, y: 0, width: 0, height: 10 },
        0,
      ),
    ).toBeNull();
  });

  it("syncs selection order and remove plan", () => {
    const elements = [
      { id: "a", type: "image" as const, x: 0, y: 0, width: 10, height: 10 },
      { id: "b", type: "image" as const, x: 20, y: 0, width: 10, height: 10 },
    ];
    const overlays = buildStudioPixiSelectableOverlaysForSelection(elements, ["b", "a"]);
    expect(overlays.map((o) => o.documentId)).toEqual(["b", "a"]);
    expect(overlays[0]?.zIndex).toBe(0);
    expect(overlays[1]?.zIndex).toBe(1);

    const plan = planStudioPixiOverlaySync(["a", "c"], overlays);
    expect(plan.removeIds).toEqual(["c"]);
    expect(plan.upsert.map((o) => o.documentId)).toEqual(["b", "a"]);
  });
});
