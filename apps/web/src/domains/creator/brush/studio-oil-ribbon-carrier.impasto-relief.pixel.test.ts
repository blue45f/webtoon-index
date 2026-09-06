import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
  studioOilRibbonPathData,
} from "./studio-oil-ribbon-carrier";

const WIDTH = 300;
const HEIGHT = 120;
const CENTER_Y = 60;
const STROKE_COLOR = "#bd6d32";

const HORIZONTAL_STROKE = {
  points: [15, CENTER_Y, 90, CENTER_Y, 180, CENTER_Y, 265, CENTER_Y],
  pressures: [0.62, 0.7, 0.66, 0.6],
  baseWidth: 26,
  seed: 41,
} as const;

/** The production oil serialization shape: body fill + one multiply path per band (+ overlay). */
function oilLaneSvg(
  carrier: ReturnType<typeof planStudioOilRibbonCarrier>,
  overlay: boolean,
): string {
  const body = `<path d="${studioOilRibbonPathData(carrier.body!, true)}" fill="${STROKE_COLOR}" fill-rule="nonzero" opacity="${carrier.bodyOpacity}"/>`;
  const bristles = carrier.bristleLanes.map((lane) => (
    `<path d="${lane.runs.map((run) => studioOilRibbonPathData(run)).join("")}" fill="none" stroke="${STROKE_COLOR}" stroke-width="${lane.lineWidth}" stroke-linecap="butt" stroke-linejoin="round" opacity="${lane.opacity}"/>`
  )).join("");
  const relief = overlay
    ? (carrier.impastoReliefLanes ?? []).map((lane) => (
      `<path d="${lane.runs.map((run) => studioOilRibbonPathData(run)).join("")}" fill="none" stroke="${lane.kind === "highlight" ? STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR : STROKE_COLOR}" stroke-width="${lane.lineWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${lane.opacity}" style="mix-blend-mode:${lane.kind === "highlight" ? "screen" : "multiply"}"/>`
    )).join("")
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>`,
    body,
    `<g style="mix-blend-mode:multiply">${bristles}</g>`,
    relief === "" ? "" : `<g>${relief}</g>`,
    "</svg>",
  ].join("");
}

function luminanceAt(pixels: Uint8Array, x: number, y: number): number {
  const offset = (y * WIDTH + x) * 4;
  return pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722;
}

describe("studio impasto relief overlay raster behaviour (resvg)", () => {
  it("lights the ribbon like dli's (0, −1, 1) lamp and never leaks outside the paint", async () => {
    const module = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await module.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );

    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const control = planStudioOilRibbonCarrier(dabs);
    const impasto = planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: true } });
    expect(impasto.impastoReliefLanes!.length).toBeGreaterThan(0);

    const render = (svg: string): Uint8Array => {
      const renderer = new module.Resvg(svg, {
        shapeRendering: 2,
        font: { loadSystemFonts: false },
      });
      const rendered = renderer.render();
      try {
        expect(rendered.width).toBe(WIDTH);
        return rendered.pixels.slice();
      } finally {
        rendered.free();
        renderer.free();
      }
    };

    const controlPixels = render(oilLaneSvg(control, false));
    const impastoPixels = render(oilLaneSvg(impasto, true));
    // Body-only silhouette mask: the overlay is clamped inside the body, so every raster change
    // must stay under this ink (bristle lanes are byte-identical between the two renders).
    const maskPixels = render([
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`,
      `<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>`,
      `<path d="${studioOilRibbonPathData(impasto.body!, true)}" fill="#000" fill-rule="nonzero"/>`,
      "</svg>",
    ].join(""));

    // 1) The pinned lane's durable bytes actually change.
    let changedPixels = 0;
    for (let index = 0; index < impastoPixels.length; index += 1) {
      if (impastoPixels[index] !== controlPixels[index]) changedPixels += 1;
    }
    expect(changedPixels).toBeGreaterThan(200);

    // 2) Ridge orientation follows the light: the strongest brightening row sits above the
    //    centreline (lit rim/flanks), the strongest darkening row below it (shaded ones).
    const rowDelta = (y: number): number => {
      let sum = 0;
      let count = 0;
      for (let x = 40; x <= 260; x += 1) {
        sum += luminanceAt(impastoPixels, x, y) - luminanceAt(controlPixels, x, y);
        count += 1;
      }
      return sum / count;
    };
    let brightestRow = -1;
    let brightestDelta = Number.NEGATIVE_INFINITY;
    let darkestRow = -1;
    let darkestDelta = Number.POSITIVE_INFINITY;
    for (let y = CENTER_Y - 18; y <= CENTER_Y + 18; y += 1) {
      const delta = rowDelta(y);
      if (delta > brightestDelta) {
        brightestDelta = delta;
        brightestRow = y;
      }
      if (delta < darkestDelta) {
        darkestDelta = delta;
        darkestRow = y;
      }
    }
    expect(brightestDelta).toBeGreaterThan(1);
    expect(darkestDelta).toBeLessThan(-1);
    expect(brightestRow).toBeLessThan(CENTER_Y);
    expect(darkestRow).toBeGreaterThan(CENTER_Y);

    // 3) No halo: outside the (1px-eroded) body silhouette the two renders are byte-identical —
    //    a screen-blended white glint on bare canvas would light up empty pixels instantly.
    const strictlyOutside = (x: number, y: number): boolean => {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nx = x + offsetX;
          const ny = y + offsetY;
          if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue;
          if (luminanceAt(maskPixels, nx, ny) < 250) return false;
        }
      }
      return true;
    };
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        if (!strictlyOutside(x, y)) continue;
        const offset = (y * WIDTH + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          if (impastoPixels[offset + channel] !== controlPixels[offset + channel]) {
            expect.fail(
              `relief changed a pixel outside the body at (${x}, ${y}) channel ${channel}`,
            );
          }
        }
      }
    }
  });
});
