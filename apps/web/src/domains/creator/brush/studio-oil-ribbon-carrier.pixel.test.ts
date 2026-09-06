import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  STUDIO_OIL_BRISTLE_WIDTH_GAUGES,
  studioOilRibbonPathData,
} from "./studio-oil-ribbon-carrier";

function luminance(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): number {
  const offset = (y * width + x) * 4;
  const red = pixels[offset] ?? 255;
  const green = pixels[offset + 1] ?? 255;
  const blue = pixels[offset + 2] ?? 255;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function meanLuminance(
  pixels: Uint8Array,
  width: number,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      sum += luminance(pixels, width, x, y);
      count += 1;
    }
  }
  return sum / Math.max(1, count);
}

/**
 * Darkest 5×5 patch anywhere on the two arms, excluding the crossing neighbourhood.
 *
 * A fixed probe point cannot be used any more. The ribbon now carries real bristle relief, so one
 * 5×5 patch lands on a ridge or in a furrow by luck and its luminance varies by tens of units for
 * reasons that have nothing to do with the crossing. The darkest ordinary patch is the right
 * reference: it IS the stroke's own heaviest ink, so comparing the crossing against it asks
 * exactly the knot question — "is the crossing worse than the worst normal spot?".
 */
function darkestArmPatch(
  pixels: Uint8Array,
  width: number,
  radius: number,
): number {
  let darkest = Number.POSITIVE_INFINITY;
  for (const [ax, ay, bx, by] of [[14, 14, 86, 86], [14, 86, 86, 14]] as const) {
    for (let step = 12; step <= 88; step += 1) {
      const t = step / 100;
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      if (Math.hypot(x - 50, y - 50) < 14) continue;
      if (x < radius || y < radius || x >= 100 - radius || y >= 100 - radius) continue;
      darkest = Math.min(darkest, meanLuminance(pixels, width, x, y, radius));
    }
  }
  return darkest;
}

describe("Studio oil/acrylic ribbon raster crossing quality", () => {
  it("deposits each bristle load band exactly once so a crossing cannot stack it", () => {
    const carrier = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [14, 14, 86, 86, 14, 86, 86, 14],
      pressures: [0.58, 0.58, 0.58, 0.58],
      baseWidth: 18,
      seed: 41,
    }));

    // Every run of a lane is a subpath of ONE paint operation, so where the figure-eight crosses
    // itself the lane's coverage is rasterised before compositing and the ridge is laid down once.
    // This is the structural guarantee the luminance probe below can only sample.
    //
    // A lane count is NOT that guarantee, which is why the old `<= 3` bound is gone. What bounds a
    // crossing is how many lanes can fold on ONE pixel, and the lanes are cumulative shells: within
    // a width gauge, lane k carries every run of load band >= k, so the runs are nested and a
    // crossing of bands i and m is covered by shells 0..max(i, m) - the fold telescopes to the
    // heavier arm's own deposit no matter how many bands exist. Only the gauges fold against each
    // other, so the two assertions below are the real bound: gauges are few, and each gauge's
    // lanes nest.
    expect(carrier.bristleLanes.length).toBeGreaterThan(0);
    const gauges = new Map<number, typeof carrier.bristleLanes[number][]>();
    for (const lane of carrier.bristleLanes) {
      gauges.set(lane.lineWidth, [...(gauges.get(lane.lineWidth) ?? []), lane]);
    }
    expect(gauges.size).toBeLessThanOrEqual(STUDIO_OIL_BRISTLE_WIDTH_GAUGES);
    for (const [lineWidth, lanes] of gauges) {
      // Nesting, and with it the telescoping fold, only holds if the shells repaint IDENTICAL
      // geometry — hence one lineWidth per gauge, asserted by the grouping key itself.
      expect(lineWidth, "gauge stroke width").toBeGreaterThan(0);
      for (let index = 1; index < lanes.length; index += 1) {
        const outer = new Set(lanes[index - 1]!.runs.map((run) => run.points.join(",")));
        const inner = lanes[index]!.runs.map((run) => run.points.join(","));
        expect(inner.length, `shell ${index} must shrink`).toBeLessThan(outer.size);
        for (const run of inner) expect(outer.has(run), `shell ${index} run escaped`).toBe(true);
        expect(lanes[index]!.loadBand).toBeGreaterThan(lanes[index - 1]!.loadBand);
      }
    }
    for (const lane of carrier.bristleLanes) {
      // A lane must deposit something, but it is NOT required to be fragmented. The old
      // `> 1` bound encoded the white-noise load model, where a hair flipped loaded/dry every
      // station and therefore always split across several runs. Load now varies smoothly along
      // travel (studio-fx-brush bristleLoadAlongTravel), so a hair that stays loaded across this
      // short figure-eight legitimately merges into ONE contiguous run - that continuity is the
      // fix, not a regression. The once-per-band guarantee this test exists for is the loadBand
      // uniqueness assertion above plus the luminance knot probe below, neither of which cares
      // how many subpaths a band is drawn from.
      expect(lane.runs.length).toBeGreaterThan(0);
      expect(lane.opacity).toBeGreaterThan(0);
    }
  });

  it("does not turn a sharp figure-eight self-crossing into an opaque bristle knot", async () => {
    const module = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await module.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );
    for (const baseWidth of [10, 18, 30]) {
      for (const strokeOpacity of [0.25, 0.55, 1]) {
        for (const seed of [5, 41, 97]) {
          const carrier = planStudioOilRibbonCarrier(planOilBrushDabs({
            points: [14, 14, 86, 86, 14, 86, 86, 14],
            pressures: [0.58, 0.58, 0.58, 0.58],
            baseWidth,
            seed,
          }));
          expect(carrier.body).not.toBeNull();

          const body = `<path d="${studioOilRibbonPathData(carrier.body!, true)}" fill="#bd6d32" fill-rule="nonzero" opacity="${carrier.bodyOpacity * strokeOpacity}"/>`;
          const bristles = carrier.bristleLanes.map((lane) => (
            `<path d="${lane.runs.map((run) => studioOilRibbonPathData(run)).join("")}" fill="none" stroke="#874116" stroke-width="${lane.lineWidth}" stroke-linecap="butt" stroke-linejoin="round" opacity="${lane.opacity * strokeOpacity}"/>`
          )).join("");
          const renderer = new module.Resvg(
            [
              '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">',
              '<rect width="100" height="100" fill="#fff"/>',
              body,
              `<g style="mix-blend-mode:multiply">${bristles}</g>`,
              "</svg>",
            ].join(""),
            {
              shapeRendering: 2,
              font: { loadSystemFonts: false },
            },
          );
          const rendered = renderer.render();
          try {
            const arm = darkestArmPatch(rendered.pixels, rendered.width, 2);
            const crossing = meanLuminance(
              rendered.pixels,
              rendered.width,
              50,
              50,
              2,
            );

            // Bounded against the stroke's OWN ink depth rather than an absolute luminance step.
            // A crossing genuinely carries paint from two passes, so it is legitimately a little
            // heavier than the heaviest single-pass spot; a knot is when it runs away toward
            // opaque. Measured worst case across this grid is 19 % — 25 % leaves margin while
            // still failing an order of magnitude before "opaque".
            expect(
              (arm - crossing) / (255 - arm),
              `width=${baseWidth}, opacity=${strokeOpacity}, seed=${seed}`,
            ).toBeLessThanOrEqual(0.25);
          } finally {
            rendered.free();
            renderer.free();
          }
        }
      }
    }
  });
});
