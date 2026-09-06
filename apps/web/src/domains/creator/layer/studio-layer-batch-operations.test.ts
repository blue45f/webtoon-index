import { describe, expect, it } from "vitest";

import {
  applyTonalCorrectionToMultipleLayers,
  batchHideAllDraftLayers,
  batchRestoreAllDraftLayers,
  setLayerDraftStatus,
  shouldIncludeLayerInExport,
  type StudioLayerModelItem,
} from "./studio-layer-batch-operations";

describe("studio-layer-batch-operations", () => {
  const initialLayers: readonly StudioLayerModelItem[] = [
    { id: "layer-sketch", name: "러프 콘티", visible: true, isDraft: true },
    { id: "layer-penciling", name: "데생 밑그림", visible: true, isDraft: true },
    { id: "layer-ink", name: "선화 (메인 펜)", visible: true, isDraft: false },
    { id: "layer-flat-color", name: "채색 밑색", visible: false, isDraft: false },
  ];

  describe("Draft Layers Batch Hide and Restore", () => {
    it("marks and unmarks draft layer status safely", () => {
      const ink = initialLayers[2];
      const asDraft = setLayerDraftStatus(ink, true);
      expect(asDraft.isDraft).toBe(true);

      const unDraft = setLayerDraftStatus(asDraft, false);
      expect(unDraft.isDraft).toBe(false);
    });

    it("batch hides all draft layers and captures visibility snapshot", () => {
      const { updatedLayers, snapshot, affectedCount } = batchHideAllDraftLayers(initialLayers);

      expect(affectedCount).toBe(2);
      expect(updatedLayers.find((l) => l.id === "layer-sketch")?.visible).toBe(false);
      expect(updatedLayers.find((l) => l.id === "layer-penciling")?.visible).toBe(false);
      // Non-draft layer remains visible
      expect(updatedLayers.find((l) => l.id === "layer-ink")?.visible).toBe(true);

      expect(snapshot.visibilityMap["layer-sketch"]).toBe(true);
      expect(snapshot.visibilityMap["layer-penciling"]).toBe(true);
    });

    it("restores draft layers back to their prior visibility states from snapshot", () => {
      const { updatedLayers: hiddenLayers, snapshot } = batchHideAllDraftLayers(initialLayers);
      const restored = batchRestoreAllDraftLayers(hiddenLayers, snapshot);

      expect(restored.find((l) => l.id === "layer-sketch")?.visible).toBe(true);
      expect(restored.find((l) => l.id === "layer-penciling")?.visible).toBe(true);
      expect(restored.find((l) => l.id === "layer-ink")?.visible).toBe(true);
      expect(restored.find((l) => l.id === "layer-flat-color")?.visible).toBe(false); // remained false
    });

    it("excludes draft layers from export unless explicitly included", () => {
      const sketch = initialLayers[0]; // isDraft = true, visible = true
      const ink = initialLayers[2];    // isDraft = false, visible = true

      expect(shouldIncludeLayerInExport(sketch, false)).toBe(false);
      expect(shouldIncludeLayerInExport(sketch, true)).toBe(true);
      expect(shouldIncludeLayerInExport(ink, false)).toBe(true);
    });
  });

  describe("Multi-Layer Simultaneous Tonal Correction", () => {
    it("applies brightness/contrast across multiple selected layers", () => {
      const { updatedLayers, affectedCount } = applyTonalCorrectionToMultipleLayers(
        initialLayers,
        ["layer-ink", "layer-flat-color"],
        { kind: "brightnessContrast", brightness: 15, contrast: -10 },
      );

      expect(affectedCount).toBe(2);
      const ink = updatedLayers.find((l) => l.id === "layer-ink");
      const color = updatedLayers.find((l) => l.id === "layer-flat-color");
      const sketch = updatedLayers.find((l) => l.id === "layer-sketch");

      expect(ink?.brightness).toBe(15);
      expect(ink?.contrast).toBe(-10);
      expect(color?.brightness).toBe(15);
      expect(sketch?.brightness).toBeUndefined(); // Unaffected
    });

    it("applies levels correction across selected layers", () => {
      const { updatedLayers, affectedCount } = applyTonalCorrectionToMultipleLayers(
        initialLayers,
        ["layer-ink"],
        { kind: "levels", blackPoint: 12, whitePoint: 245, gamma: 1.2 },
      );

      expect(affectedCount).toBe(1);
      const ink = updatedLayers.find((l) => l.id === "layer-ink");
      expect(ink?.levels?.blackPoint).toBe(12);
      expect(ink?.levels?.whitePoint).toBe(245);
      expect(ink?.levels?.gamma).toBe(1.2);
    });
  });
});
