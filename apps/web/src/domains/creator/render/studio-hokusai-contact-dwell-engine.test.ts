import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HokusaiBrush,
  HokusaiCanvas,
  initSync,
} from "../../../../../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js";

import {
  planStudioHokusaiContactDwell,
} from "./studio-hokusai-contact-dwell";
import {
  studioHokusaiNaturalMediaPresetJson,
} from "./studio-hokusai-natural-media-presets";


/**
 * Engine-level proof that a deliberate tap lands a natural-media mark.
 *
 * The plan module can only be unit tested against its own arithmetic; whether the carrier actually
 * deposits a dab is a property of the Hokusai WASM build. This drives the real engine exactly the
 * way `studio-hokusai-live-brush.worker.ts` drives it — one contact sample, `finishStroke`, then
 * the planned dwell — so the regression this closes cannot silently return.
 */
initSync({
  module: new WebAssembly.Module(readFileSync(new URL("../../../../../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm_bg.wasm",
    import.meta.url,
  ))),
});

const SURFACE = 512;
const CONTACT = { x: 256, y: 256 } as const;

interface TapOutcome {
  readonly carrierPaintedTap: boolean;
  readonly dwellPaintedTap: boolean;
  readonly visiblePixels: number;
  readonly markWidth: number;
  readonly markHeight: number;
}

function tapWithDwell(
  presetId: "charcoal" | "oil" | "pencil",
  radiusPixels: number,
  pressure: number,
): TapOutcome {
  const brush = new HokusaiBrush(studioHokusaiNaturalMediaPresetJson(presetId));
  brush.setColorHsv(0.72, 0.63, 0.98);
  brush.setRadiusLog(Math.log2(Math.max(0.1, radiusPixels)));
  const canvas = new HokusaiCanvas(SURFACE, SURFACE, 0x5eed_1234);
  try {
    // 1. The gesture exactly as the live worker forwards it: one contact sample, then finish.
    canvas.beginStroke(brush, 0x5eed_1234);
    canvas.addSample(brush, CONTACT.x, CONTACT.y, pressure, 0, 0, 0);
    canvas.finishStroke(brush);
    const carrierPaintedTap = Array.from(canvas.dirtyBounds()).length === 4;

    // 2. The recovery the worker runs when the carrier composed nothing.
    const dwell = planStudioHokusaiContactDwell({
      samples: [{
        x: CONTACT.x,
        y: CONTACT.y,
        pressure,
        tiltX: 0,
        tiltY: 0,
        timeMilliseconds: 0,
      }],
      radiusPixels,
      surfaceWidth: SURFACE,
      surfaceHeight: SURFACE,
    });
    expect(dwell).not.toBeNull();
    canvas.beginStroke(brush, 0x5eed_1234);
    for (const sample of dwell ?? []) {
      canvas.addSample(
        brush,
        sample.x,
        sample.y,
        sample.pressure,
        sample.tiltX,
        sample.tiltY,
        sample.timeMilliseconds,
      );
    }
    canvas.finishStroke(brush);
    const bounds = Array.from(canvas.dirtyBounds());
    if (bounds.length !== 4) {
      return {
        carrierPaintedTap,
        dwellPaintedTap: false,
        visiblePixels: 0,
        markWidth: 0,
        markHeight: 0,
      };
    }
    const [, , width, height] = bounds as [number, number, number, number];
    const pixels = canvas.dirtyFrame();
    let visiblePixels = 0;
    let minimumX = width;
    let minimumY = height;
    let maximumX = -1;
    let maximumY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3]! === 0) continue;
        visiblePixels += 1;
        if (x < minimumX) minimumX = x;
        if (y < minimumY) minimumY = y;
        if (x > maximumX) maximumX = x;
        if (y > maximumY) maximumY = y;
      }
    }
    return {
      carrierPaintedTap,
      dwellPaintedTap: visiblePixels > 0,
      visiblePixels,
      markWidth: maximumX - minimumX + 1,
      markHeight: maximumY - minimumY + 1,
    };
  } finally {
    canvas.dispose();
    brush.free();
  }
}

describe("Hokusai contact dwell against the real natural-media engine", () => {
  // Studio's own defaults for the three auto-routed families, plus the pressureless contact a
  // mouse tap produces after the plan substitutes its canonical weight.
  const cases = [
    { presetId: "pencil", radiusPixels: 1.25, pressure: 0.5 },
    { presetId: "pencil", radiusPixels: 20, pressure: 0.85 },
    { presetId: "charcoal", radiusPixels: 6, pressure: 0.5 },
    { presetId: "oil", radiusPixels: 12, pressure: 0.5 },
  ] as const;

  it.each(cases)(
    "$presetId at r=$radiusPixels composes nothing from the bare tap and a visible mark after the dwell",
    ({ presetId, radiusPixels, pressure }) => {
      const outcome = tapWithDwell(presetId, radiusPixels, pressure);
      // The defect: a zero-travel gesture never reaches one dab of carrier travel.
      expect(outcome.carrierPaintedTap).toBe(false);
      // The fix: the same gesture now lands a mark instead of failing the whole stroke.
      expect(outcome.dwellPaintedTap).toBe(true);
      expect(outcome.visiblePixels).toBeGreaterThan(0);
      // The mark stays a point. A dab of radius r spans 2r; the orbit may widen it by at most
      // one more dab radius, and the tile-aligned dirty region is never the measurement.
      expect(outcome.markWidth).toBeLessThanOrEqual(Math.ceil(radiusPixels * 3) + 4);
      expect(outcome.markHeight).toBeLessThanOrEqual(Math.ceil(radiusPixels * 3) + 4);
    },
  );

  it("keeps a real travelling stroke on the carrier so the dwell never runs for it", () => {
    const brush = new HokusaiBrush(studioHokusaiNaturalMediaPresetJson("pencil"));
    brush.setColorHsv(0.72, 0.63, 0.98);
    brush.setRadiusLog(Math.log2(1.25));
    const canvas = new HokusaiCanvas(SURFACE, SURFACE, 0x5eed_1234);
    try {
      canvas.beginStroke(brush, 0x5eed_1234);
      for (let index = 0; index <= 24; index += 1) {
        canvas.addSample(brush, 120 + index * 6, 200, 0.6, 0, 0, index * 8);
      }
      canvas.finishStroke(brush);
      expect(Array.from(canvas.dirtyBounds())).toHaveLength(4);
    } finally {
      canvas.dispose();
      brush.free();
    }
  });
});
