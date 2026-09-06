import { afterEach, describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import { planStudioOilRibbonCarrier } from "./studio-oil-ribbon-carrier";
import {
  paintStudioOilRibbonCarrierIncremental,
  resetStudioOilRibbonIncrementalPaintForTests,
  studioOilRibbonIncrementalCacheSizeForTests,
} from "./studio-oil-ribbon-incremental-paint";

const BLUE_CANVAS = [18, 62, 190, 255] as const;

function makeImageData(
  width: number,
  height: number,
  pixel: () => readonly number[],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(pixel(), offset);
  }
  return data;
}

function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
}

function paintContext(native: {
  canvas: { width: number; height: number };
  getImageData: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => { data: Uint8ClampedArray; width: number; height: number };
  putImageData: (
    image: { data: Uint8ClampedArray; width: number; height: number },
    x: number,
    y: number,
  ) => void;
  getTransform: () => { a: number; b: number; c: number; d: number; e: number; f: number };
}) {
  return {
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineCap: "butt" as const,
    lineJoin: "miter" as const,
    lineWidth: 1,
    _context: native,
  };
}

afterEach(() => {
  resetStudioOilRibbonIncrementalPaintForTests();
});

describe("paintStudioOilRibbonCarrierIncremental", () => {
  it("mixes a growing suffix into the retained paper snapshot instead of rereading the whole bbox", () => {
    const width = 96;
    const height = 28;
    const paper = makeImageData(width, height, () => BLUE_CANVAS);
    const destination = paper.slice();
    const reads: Array<readonly [number, number, number, number]> = [];
    const native = {
      canvas: { width, height },
      getImageData: (x: number, y: number, w: number, h: number) => {
        reads.push([x, y, w, h]);
        const slice = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row += 1) {
          for (let column = 0; column < w; column += 1) {
            const source = ((y + row) * width + (x + column)) * 4;
            slice.set(destination.subarray(source, source + 4), (row * w + column) * 4);
          }
        }
        return { data: slice, width: w, height: h };
      },
      putImageData: (
        image: { data: Uint8ClampedArray; width: number; height: number },
        x: number,
        y: number,
      ) => {
        for (let row = 0; row < image.height; row += 1) {
          for (let column = 0; column < image.width; column += 1) {
            destination.set(
              image.data.subarray((row * image.width + column) * 4, (row * image.width + column) * 4 + 4),
              ((y + row) * width + (x + column)) * 4,
            );
          }
        }
      },
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    const prefixDabs = planOilBrushDabs({
      points: [12, 14, 36, 14],
      pressures: [0.7, 0.7],
      baseWidth: 12,
      seed: 9,
    });
    const grownDabs = planOilBrushDabs({
      points: [12, 14, 36, 14, 70, 14],
      pressures: [0.7, 0.7, 0.7],
      baseWidth: 12,
      seed: 9,
    });
    const prefixCarrier = planStudioOilRibbonCarrier(prefixDabs);
    const grownCarrier = planStudioOilRibbonCarrier(grownDabs);
    const context = paintContext(native);

    paintStudioOilRibbonCarrierIncremental(context, {
      carrier: prefixCarrier,
      stroke: "#fcd300",
      opacity: 1,
      points: prefixDabs.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 8,
      incrementalKey: "oil-live",
    });
    const firstReads = reads.length;
    expect(firstReads).toBe(1);
    expect(studioOilRibbonIncrementalCacheSizeForTests()).toBe(1);

    paintStudioOilRibbonCarrierIncremental(context, {
      carrier: grownCarrier,
      stroke: "#fcd300",
      opacity: 1,
      points: grownDabs.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 8,
      incrementalKey: "oil-live",
    });

    expect(reads.length).toBeGreaterThan(firstReads);
    const secondRead = reads[firstReads]!;
    expect(secondRead[2]! * secondRead[3]!).toBeLessThan(width * height);
    const [r, g, b] = pixelAt(destination, width, 24, 14);
    expect(r).not.toBe(BLUE_CANVAS[0]);
    expect(g).toBeGreaterThan(BLUE_CANVAS[1]);
    expect(b).not.toBe(BLUE_CANVAS[2]);
  });

  it("falls back to a full mix when the live prefix is not reused", () => {
    const width = 48;
    const height = 20;
    const destination = makeImageData(width, height, () => BLUE_CANVAS);
    let getCount = 0;
    const native = {
      canvas: { width, height },
      getImageData: (x: number, y: number, w: number, h: number) => {
        getCount += 1;
        const slice = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row += 1) {
          slice.set(
            destination.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4),
            row * w * 4,
          );
        }
        return { data: slice, width: w, height: h };
      },
      putImageData: (
        image: { data: Uint8ClampedArray; width: number; height: number },
        x: number,
        y: number,
      ) => {
        for (let row = 0; row < image.height; row += 1) {
          destination.set(
            image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
            ((y + row) * width + x) * 4,
          );
        }
      },
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    const first = planOilBrushDabs({
      points: [8, 10, 20, 10],
      pressures: [0.6, 0.6],
      baseWidth: 8,
      seed: 2,
    });
    const other = planOilBrushDabs({
      points: [30, 10, 40, 10],
      pressures: [0.6, 0.6],
      baseWidth: 8,
      seed: 2,
    });
    paintStudioOilRibbonCarrierIncremental(paintContext(native), {
      carrier: planStudioOilRibbonCarrier(first),
      stroke: "#fcd300",
      opacity: 1,
      points: first.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 6,
      incrementalKey: "oil-reset",
    });
    paintStudioOilRibbonCarrierIncremental(paintContext(native), {
      carrier: planStudioOilRibbonCarrier(other),
      stroke: "#fcd300",
      opacity: 1,
      points: other.map((dab) => ({ x: dab.x, y: dab.y })),
      radiusPx: 6,
      incrementalKey: "oil-reset",
    });
    expect(getCount).toBe(2);
  });
});
