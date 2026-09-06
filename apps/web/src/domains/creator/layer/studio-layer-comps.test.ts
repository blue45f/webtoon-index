import { describe, expect, it } from "vitest";

import {
  applyLayerComp,
  captureLayerComp,
  planLayerCompsBatchExport,
  updateLayerCompWithCurrentLayers,
  type StudioLayerLikeItem,
} from "./studio-layer-comps";

describe("studio-layer-comps", () => {
  const sampleLayers: readonly StudioLayerLikeItem[] = [
    { id: "layer-line", visible: true, opacity: 1.0 },
    { id: "layer-color", visible: true, opacity: 0.9 },
    { id: "layer-bubbles", visible: true, opacity: 1.0 },
  ];

  describe("Capture and Apply Layer Comps", () => {
    it("captures current layer states into a comp", () => {
      const comp = captureLayerComp("완성본", sampleLayers, "comp-full");
      expect(comp.id).toBe("comp-full");
      expect(comp.name).toBe("완성본");
      expect(comp.layerStates["layer-line"].visible).toBe(true);
      expect(comp.layerStates["layer-color"].visible).toBe(true);
      expect(comp.layerStates["layer-bubbles"].visible).toBe(true);
    });

    it("applies a saved comp to switch layer visibility states", () => {
      // Create a "clean no bubbles" comp where layer-bubbles is hidden
      const cleanLayers = sampleLayers.map((l) =>
        l.id === "layer-bubbles" ? { ...l, visible: false } : l,
      );
      const cleanComp = captureLayerComp("대사 제거본", cleanLayers, "comp-clean");

      // Current layers have bubbles visible
      const applied = applyLayerComp(sampleLayers, cleanComp);
      expect(applied.find((l) => l.id === "layer-line")?.visible).toBe(true);
      expect(applied.find((l) => l.id === "layer-color")?.visible).toBe(true);
      expect(applied.find((l) => l.id === "layer-bubbles")?.visible).toBe(false); // Hidden!
    });

    it("updates an existing comp with current layer changes", () => {
      const comp = captureLayerComp("초기 콤프", sampleLayers);
      const modifiedLayers = sampleLayers.map((l) => ({ ...l, opacity: 0.5 }));

      const updatedComp = updateLayerCompWithCurrentLayers(comp, modifiedLayers);
      expect(updatedComp.layerStates["layer-line"].opacity).toBe(0.5);
    });
  });

  describe("Batch Export Planning", () => {
    it("generates structured file export list for all comps", () => {
      const comp1 = captureLayerComp("선화_초안", sampleLayers);
      const comp2 = captureLayerComp("완성본", sampleLayers);

      const plan = planLayerCompsBatchExport([comp1, comp2], "episode_01", "png");
      expect(plan).toHaveLength(2);
      expect(plan[0].fileName).toBe("episode_01_선화_초안.png");
      expect(plan[1].fileName).toBe("episode_01_완성본.png");
    });
  });
});
