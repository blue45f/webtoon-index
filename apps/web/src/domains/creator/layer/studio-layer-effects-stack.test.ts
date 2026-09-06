import { describe, expect, it } from "vitest";

import {
  addLayerEffect,
  applyReliefLighting,
  computeEffectsBBoxPadding,
  createDefaultLayerEffect,
  EMPTY_LAYER_EFFECTS_STACK,
  parseColorToRgba,
  removeLayerEffect,
  reorderLayerEffect,
  toggleLayerEffect,
  updateLayerEffect,
  type StudioReliefEffect,
} from "./studio-layer-effects-stack";

describe("studio-layer-effects-stack", () => {
  describe("Stack CRUD Operations", () => {
    it("creates default layer effect items with valid parameters", () => {
      const glow = createDefaultLayerEffect("glow", "test-glow");
      expect(glow.kind).toBe("glow");
      expect(glow.id).toBe("test-glow");
      expect(glow.enabled).toBe(true);

      const shadow = createDefaultLayerEffect("drop-shadow");
      expect(shadow.kind).toBe("drop-shadow");

      const relief = createDefaultLayerEffect("relief");
      expect(relief.kind).toBe("relief");

      const border = createDefaultLayerEffect("border");
      expect(border.kind).toBe("border");
    });

    it("adds, updates, toggles, and removes effects on the stack immutably", () => {
      let stack = EMPTY_LAYER_EFFECTS_STACK;
      expect(stack.effects).toHaveLength(0);

      const glow = createDefaultLayerEffect("glow", "fx-glow");
      const shadow = createDefaultLayerEffect("drop-shadow", "fx-shadow");

      stack = addLayerEffect(stack, glow);
      stack = addLayerEffect(stack, shadow);
      expect(stack.effects).toHaveLength(2);

      // Toggle
      stack = toggleLayerEffect(stack, "fx-glow", false);
      expect(stack.effects.find((e) => e.id === "fx-glow")?.enabled).toBe(false);

      // Update
      stack = updateLayerEffect(stack, "fx-shadow", { blur: 25 });
      expect((stack.effects.find((e) => e.id === "fx-shadow") as { blur: number }).blur).toBe(25);

      // Reorder
      stack = reorderLayerEffect(stack, 0, 1);
      expect(stack.effects[0].id).toBe("fx-shadow");
      expect(stack.effects[1].id).toBe("fx-glow");

      // Remove
      stack = removeLayerEffect(stack, "fx-shadow");
      expect(stack.effects).toHaveLength(1);
      expect(stack.effects[0].id).toBe("fx-glow");
    });
  });

  describe("computeEffectsBBoxPadding", () => {
    it("returns 0 padding for empty or disabled effects", () => {
      const glow = createDefaultLayerEffect("glow");
      const disabledGlow = { ...glow, enabled: false };
      const padding = computeEffectsBBoxPadding({ effects: [disabledGlow] });
      expect(padding.totalMargin).toBe(0);
    });

    it("calculates sufficient bounding box padding for glow and drop-shadow", () => {
      const glow = createDefaultLayerEffect("glow"); // blur: 16
      const shadow = createDefaultLayerEffect("drop-shadow"); // blur: 10, offsetX: 4, offsetY: 6
      const padding = computeEffectsBBoxPadding({ effects: [glow, shadow] });
      expect(padding.totalMargin).toBeGreaterThanOrEqual(24);
      expect(padding.bottom).toBeGreaterThanOrEqual(21); // offsetY + blur * 1.5
    });
  });

  describe("applyReliefLighting", () => {
    it("applies relief shading based on alpha gradient", () => {
      const width = 10;
      const height = 10;
      const pixels = new Uint8ClampedArray(width * height * 4);

      // Fill a 4x4 square in the center with 255 red and 255 alpha
      for (let y = 3; y < 7; y++) {
        for (let x = 3; x < 7; x++) {
          const idx = (y * width + x) * 4;
          pixels[idx] = 200; // R
          pixels[idx + 1] = 100; // G
          pixels[idx + 2] = 50; // B
          pixels[idx + 3] = 255; // A
        }
      }

      const relief: StudioReliefEffect = {
        id: "r1",
        kind: "relief",
        elevationDeg: 45,
        azimuthDeg: 315,
        depth: 6,
        smoothness: 1,
        lightIntensity: 1.5,
        ambient: 0.3,
        invert: false,
        enabled: true,
      };

      const shaded = applyReliefLighting(pixels, width, height, relief);
      expect(shaded.length).toBe(pixels.length);
      // Center pixel (x=4, y=4) has alpha silhouette gradients
      const idxCenter = (4 * width + 4) * 4;
      expect(shaded[idxCenter]).toBeGreaterThan(0);
    });
  });

  describe("parseColorToRgba", () => {
    it("parses 3, 6, and 8 digit hex codes", () => {
      expect(parseColorToRgba("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
      expect(parseColorToRgba("#ff8000")).toEqual({ r: 255, g: 128, b: 0, a: 255 });
      expect(parseColorToRgba("#0000ff80")).toEqual({ r: 0, g: 0, b: 255, a: 128 });
    });
  });
});
