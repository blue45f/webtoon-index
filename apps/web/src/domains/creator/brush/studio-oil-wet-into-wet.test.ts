import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  paintStudioOilRibbonCarrier,
  paintStudioOilRibbonHit,
  planStudioOilRibbonCarrier,
  studioOilRibbonPaintIsHitPass,
  type StudioOilRibbonPaintContext,
} from "./studio-oil-ribbon-carrier";
import {
  applyStudioOilWetIntoWetStroke,
  planStudioOilWetIntoWetLoadSeries,
  STUDIO_OIL_WET_INTO_WET_DEFAULT_LOAD_DEPLETION,
} from "./studio-oil-wet-into-wet";
import { wetMixStroke, type WetMixSettings } from "./studio-wet-mix";

function makeImageData(
  w: number,
  h: number,
  colorAt: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = colorAt(x, y);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function pixelAt(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const idx = (y * w + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!];
}

const YELLOW = { r: 252, g: 211, b: 0 };
const BLUE_CANVAS = [0, 33, 133, 255] as const;

function oilSettings(overrides: Partial<WetMixSettings> = {}): WetMixSettings {
  return {
    radiusPx: 4,
    hardness: 1,
    strength: 1,
    wetness: 0.7,
    pickup: 0.85,
    paintColor: YELLOW,
    loadDepletion: 0.12,
    initialLoad: 1,
    mixModel: "spectral-wgm",
    ...overrides,
  };
}

describe("oil wet-into-wet feel", () => {
  it("picks up existing wet paint so the deposit is not the raw brush colour", () => {
    const data = makeImageData(64, 24, () => BLUE_CANVAS);
    applyStudioOilWetIntoWetStroke(
      data,
      64,
      24,
      [{ x: 8, y: 12 }, { x: 52, y: 12 }],
      oilSettings(),
    );
    const [r, g, b] = pixelAt(data, 64, 28, 12);
    expect(r).not.toBe(YELLOW.r);
    expect(g).not.toBe(YELLOW.g);
    expect(b).not.toBe(YELLOW.b);
    expect(r).not.toBe(BLUE_CANVAS[0]);
    expect(g).toBeGreaterThan(BLUE_CANVAS[1]);
    expect(g).toBeGreaterThan(r);
  });

  it("depletes load so the tail deposits less fresh paint than the head", () => {
    const data = makeImageData(80, 20, () => [255, 255, 255, 255]);
    applyStudioOilWetIntoWetStroke(
      data,
      80,
      20,
      [{ x: 6, y: 10 }, { x: 74, y: 10 }],
      oilSettings({
        wetness: 0,
        pickup: 0,
        paintColor: { r: 0, g: 0, b: 0 },
        loadDepletion: 0.045,
        strength: 1,
      }),
    );
    const head = pixelAt(data, 80, 8, 10);
    const tail = pixelAt(data, 80, 70, 10);
    expect(head[0]).toBeLessThan(40);
    expect(tail[0]).toBeGreaterThan(head[0] + 15);
    expect(tail[0]).toBeLessThan(250);
  });

  it("drops film strength along the same bristle-load series the ribbon uses", () => {
    const series = planStudioOilWetIntoWetLoadSeries({
      stationCount: 360,
      seed: 11,
      pressures: Array.from({ length: 360 }, () => 0.7),
      speeds: Array.from({ length: 360 }, () => 0.55),
      depletionRate: 6,
    });
    expect(series[40]!).toBeGreaterThan(series[359]!);
    expect(STUDIO_OIL_WET_INTO_WET_DEFAULT_LOAD_DEPLETION).toBeGreaterThan(0);
  });

  it("is deterministic across two identical oil strokes", () => {
    const base = makeImageData(48, 20, (x) => (x < 20 ? BLUE_CANVAS : [255, 255, 255, 255]));
    const a = base.slice();
    const b = base.slice();
    const stroke = [{ x: 4, y: 10 }, { x: 44, y: 10 }];
    const settings = oilSettings();
    applyStudioOilWetIntoWetStroke(a, 48, 20, stroke, settings);
    applyStudioOilWetIntoWetStroke(b, 48, 20, stroke, settings);
    expect(Array.from(a)).toEqual(Array.from(b));

    const again = wetMixStroke(base.slice(), 48, 20, stroke, {
      ...settings,
      loadDepletion: settings.loadDepletion,
      mixModel: "spectral-wgm",
    });
    expect(Array.from(again)).toEqual(Array.from(a));
  });

  it("paints the oil-ribbon production entry with pickup on an existing wet mark", () => {
    const width = 80;
    const height = 28;
    const destination = makeImageData(width, height, (x) => (
      x < 36 ? BLUE_CANVAS : [255, 255, 255, 255]
    ));
    const dabs = planOilBrushDabs({
      points: [8, 14, 72, 14],
      pressures: [0.75, 0.75],
      baseWidth: 16,
      seed: 11,
    });
    const carrier = planStudioOilRibbonCarrier(dabs);
    const context: StudioOilRibbonPaintContext = {
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      lineCap: "butt",
      lineJoin: "miter",
      lineWidth: 1,
      save() {},
      restore() {},
      beginPath() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
    };
    const receipt = paintStudioOilRibbonCarrier(context, {
      carrier,
      stroke: "#fcd300",
      opacity: 1,
      points: dabs.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 8,
      destination: { data: destination, width, height },
    });
    expect(receipt.wetIntoWetApplied).toBe(true);
    expect(receipt.usedLiveDestination).toBe(true);
    const [r, g, b] = pixelAt(destination, width, 24, 14);
    expect(r).not.toBe(YELLOW.r);
    expect(g).not.toBe(YELLOW.g);
    expect(b).not.toBe(YELLOW.b);
    expect(r).not.toBe(BLUE_CANVAS[0]);
    expect(g).toBeGreaterThan(BLUE_CANVAS[1]);
  });

  it("does not mix RGB into a Konva hit canvas and still fills the ribbon body", () => {
    class HitCanvas {
      hitCanvas = true as const;
      width = 80;
      height = 28;
    }
    class HitContext {
      fillStyle: string | CanvasGradient | CanvasPattern = "";
      strokeStyle: string | CanvasGradient | CanvasPattern = "";
      globalAlpha = 1;
      globalCompositeOperation = "source-over";
      lineCap: CanvasLineCap = "butt";
      lineJoin: CanvasLineJoin = "miter";
      lineWidth = 1;
      readonly fills: string[] = [];
      readonly canvas = new HitCanvas();
      constructor(readonly _context: {
        canvas: HitCanvas;
        putCount: number;
        getImageData: () => { data: Uint8ClampedArray; width: number; height: number };
        putImageData: () => void;
        getTransform: () => { a: number; b: number; c: number; d: number; e: number; f: number };
      }) {}
      save(): void {}
      restore(): void {}
      beginPath(): void {}
      fill(): void {
        this.fills.push(String(this.fillStyle));
      }
      stroke(): void {}
      moveTo(): void {}
      lineTo(): void {}
    }

    const width = 80;
    const height = 28;
    const destination = makeImageData(width, height, () => BLUE_CANVAS);
    const before = destination.slice();
    const native = {
      canvas: new HitCanvas(),
      putCount: 0,
      getImageData: () => ({ data: destination, width, height }),
      putImageData: () => {
        native.putCount += 1;
      },
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    const dabs = planOilBrushDabs({
      points: [8, 14, 72, 14],
      pressures: [0.75, 0.75],
      baseWidth: 16,
      seed: 11,
    });
    const carrier = planStudioOilRibbonCarrier(dabs);
    const context = new HitContext(native);
    expect(studioOilRibbonPaintIsHitPass(context)).toBe(true);
    const receipt = paintStudioOilRibbonCarrier(context, {
      carrier,
      stroke: "#fcd300",
      opacity: 1,
      points: dabs.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 8,
    });
    expect(receipt.hitPass).toBe(true);
    expect(receipt.usedLiveDestination).toBe(false);
    expect(native.putCount).toBe(0);
    expect(Array.from(destination)).toEqual(Array.from(before));
    expect(context.fills.length).toBeGreaterThan(0);
    expect(context.fills[0]).toBe("#fcd300");

    const hit = { beginPathCount: 0, fillStroke: 0, beginPath() { this.beginPathCount += 1; }, fillStrokeShape() { this.fillStroke += 1; }, moveTo() {}, lineTo() {}, closePath() {} };
    paintStudioOilRibbonHit(hit, carrier, { colorKey: "#000001" });
    expect(hit.beginPathCount).toBe(1);
    expect(hit.fillStroke).toBe(1);
  });

  it("skips live canvas readback when the interactive painter asks for a path-only draft", () => {
    const width = 64;
    const height = 24;
    const destination = makeImageData(width, height, () => BLUE_CANVAS);
    const before = destination.slice();
    let getCount = 0;
    const native = {
      canvas: { width, height },
      getImageData: () => {
        getCount += 1;
        return { data: destination, width, height };
      },
      putImageData: () => {
        throw new Error("live oil must not putImageData during a path-only draft");
      },
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    const dabs = planOilBrushDabs({
      points: [6, 12, 58, 12],
      pressures: [0.7, 0.7],
      baseWidth: 14,
      seed: 3,
    });
    const carrier = planStudioOilRibbonCarrier(dabs);
    const fills: string[] = [];
    const receipt = paintStudioOilRibbonCarrier({
      save() {},
      restore() {},
      beginPath() {},
      fill() {
        fills.push(String(this.fillStyle));
      },
      stroke() {},
      moveTo() {},
      lineTo() {},
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      lineCap: "butt",
      lineJoin: "miter",
      lineWidth: 1,
      _context: native,
    }, {
      carrier,
      stroke: "#fcd300",
      opacity: 1,
      points: dabs.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 8,
      skipDestinationReadback: true,
      includeBristleOverlay: false,
    });
    expect(receipt.usedLiveDestination).toBe(false);
    expect(getCount).toBe(0);
    expect(Array.from(destination)).toEqual(Array.from(before));
    expect(fills[0]).toBe("#fcd300");
  });
});
