import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import {
  planStudioDraftPreviewCompositeRuns,
  resolveStudioDraftPreviewCompositeMode,
} from "./brush/studio-draw-rendering";
import { planStudioFxBrushPressurePath } from "./studio-fx-brush";
import {
  planStudioHighlighterWashRibbon,
  studioHighlighterWashPlanPathData,
} from "./studio-highlighter-wash-ribbon";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

import type { DrawEl } from "./studio-element-model";

const RASTER_WIDTH = 72;
const RASTER_HEIGHT = 64;
let resvgModule: typeof import("@resvg/resvg-wasm");

beforeAll(async () => {
  resvgModule = await import("@resvg/resvg-wasm");
  const require = createRequire(import.meta.url);
  await resvgModule.initWasm(
    await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  );
});

function drawElement(
  id: string,
  overrides: Partial<DrawEl>,
): DrawEl {
  return {
    id,
    brush: "highlighter",
    mode: "pen",
    opacity: 0.48,
    points: [8, 12, 64, 52],
    pressures: [0.55, 0.55],
    sampleSpacing: 1,
    stroke: "#ffd84d",
    strokeWidth: 12,
    type: "draw",
    ...overrides,
  };
}

function renderSvgFragment(fragment: string): Uint8ClampedArray {
  const renderer = new resvgModule.Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_WIDTH}" height="${RASTER_HEIGHT}">${fragment}</svg>`,
    { shapeRendering: 2, font: { loadSystemFonts: false } },
  );
  const rendered = renderer.render();
  try {
    return new Uint8ClampedArray(rendered.pixels);
  } finally {
    rendered.free();
    renderer.free();
  }
}

function elementRaster(element: DrawEl): Uint8ClampedArray {
  if (resolveStudioDraftPreviewCompositeMode(element) === "backdrop-multiply") {
    const pressurePath = planStudioFxBrushPressurePath({
      brushId: element.brush === "chisel-highlighter" || element.brush === "pastel-highlighter"
        ? element.brush
        : "highlighter",
      points: element.points,
      pressures: element.pressures,
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      tension: 0.35,
    });
    const wash = planStudioHighlighterWashRibbon({
      brushId: element.brush === "chisel-highlighter" || element.brush === "pastel-highlighter"
        ? element.brush
        : "highlighter",
      pressurePath,
      baseWidth: element.strokeWidth,
    });
    return renderSvgFragment(
      `<path d="${studioHighlighterWashPlanPathData(wash)}" fill="${element.stroke}" fill-rule="nonzero" opacity="${(element.opacity ?? 1) * wash.opacityScale}"/>`,
    );
  }
  const path = element.points.reduce((value, coordinate, index) => {
    if (index % 2 === 1) return `${value}${coordinate}`;
    return `${value}${index === 0 ? "M" : " L"}${coordinate},`;
  }, "");
  return renderSvgFragment(
    `<path d="${path}" fill="none" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${element.opacity ?? 1}"/>`,
  );
}

function compositePixels(
  backdrop: Uint8ClampedArray,
  source: Uint8ClampedArray,
  mode: "source-over" | "backdrop-multiply",
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(backdrop.length);
  for (let index = 0; index < output.length; index += 4) {
    const backdropAlpha = (backdrop[index + 3] ?? 0) / 255;
    const sourceAlpha = (source[index + 3] ?? 0) / 255;
    const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const backdropChannel = (backdrop[index + channel] ?? 0) / 255;
      const sourceChannel = (source[index + channel] ?? 0) / 255;
      const blendedSource = mode === "backdrop-multiply"
        ? (1 - backdropAlpha) * sourceChannel
          + backdropAlpha * backdropChannel * sourceChannel
        : sourceChannel;
      const premultiplied = sourceAlpha * blendedSource
        + backdropAlpha * (1 - sourceAlpha) * backdropChannel;
      output[index + channel] = outputAlpha > 0
        ? Math.round((premultiplied / outputAlpha) * 255)
        : 0;
    }
    output[index + 3] = Math.round(outputAlpha * 255);
  }
  return output;
}

function committedPixels(
  backdrop: Uint8ClampedArray,
  elements: readonly DrawEl[],
): Uint8ClampedArray {
  return elements.reduce(
    (pixels, element) => compositePixels(
      pixels,
      elementRaster(element),
      resolveStudioDraftPreviewCompositeMode(element),
    ),
    backdrop,
  );
}

function previewPixels(
  backdrop: Uint8ClampedArray,
  settled: readonly DrawEl[],
  active: DrawEl | null,
): Uint8ClampedArray {
  let pixels = backdrop;
  for (const run of planStudioDraftPreviewCompositeRuns(settled)) {
    let runPixels: Uint8ClampedArray = new Uint8ClampedArray(backdrop.length);
    for (const element of run.elements) {
      runPixels = compositePixels(
        runPixels,
        elementRaster(element),
        resolveStudioDraftPreviewCompositeMode(element),
      );
    }
    pixels = compositePixels(pixels, runPixels, run.mode);
  }
  if (active) {
    const activeSurface = compositePixels(
      new Uint8ClampedArray(backdrop.length),
      elementRaster(active),
      resolveStudioDraftPreviewCompositeMode(active),
    );
    pixels = compositePixels(
      pixels,
      activeSurface,
      resolveStudioDraftPreviewCompositeMode(active),
    );
  }
  return pixels;
}

function maximumChannelDifference(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
): number {
  let maximum = 0;
  for (let index = 0; index < first.length; index += 1) {
    maximum = Math.max(maximum, Math.abs((first[index] ?? 0) - (second[index] ?? 0)));
  }
  return maximum;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number): readonly number[] {
  const offset = (y * RASTER_WIDTH + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

describe("Studio highlighter one-wash raster coverage", () => {
  it("fills crossings, exact retraces and U-turns once without winding cancellation", async () => {
    const render = (points: readonly number[]) => {
      const pressurePath = planStudioFxBrushPressurePath({
        brushId: "highlighter",
        points,
        pressures: Array.from(
          { length: Math.floor(points.length / 2) },
          () => 0.5,
        ),
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        tension: 0,
      });
      const wash = planStudioHighlighterWashRibbon({
        brushId: "highlighter",
        pressurePath,
        baseWidth: 10,
      });
      const renderer = new resvgModule.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="64">',
          `<path d="${studioHighlighterWashPlanPathData(wash)}" fill="#000" fill-rule="nonzero" opacity="0.5"/>`,
          "</svg>",
        ].join(""),
        {
          shapeRendering: 2,
          font: { loadSystemFonts: false },
        },
      );
      const rendered = renderer.render();
      return {
        alphaAt: (x: number, y: number) => (
          rendered.pixels[(y * rendered.width + x) * 4 + 3] ?? 0
        ),
        free: () => {
          rendered.free();
          renderer.free();
        },
      };
    };

    const cases = [
      {
        label: "figure-eight crossing",
        points: [10, 10, 50, 50, 10, 50, 50, 10],
        samples: [[20, 20], [30, 30]] as const,
      },
      {
        // Production P1: the old self-intersecting outline produced alpha=0 around x=40.
        label: "exact out-back retrace",
        points: [20, 30, 50, 30, 20, 30],
        samples: [[30, 30], [40, 30], [49, 30]] as const,
      },
      {
        label: "tight U-turn",
        points: [15, 22, 50, 22, 50, 30, 15, 30],
        samples: [[30, 22], [48, 26], [30, 30]] as const,
      },
      {
        label: "repeated reversal",
        points: [15, 44, 52, 44, 15, 44, 52, 44, 15, 44],
        samples: [[25, 44], [38, 44], [50, 44]] as const,
      },
    ];

    for (const testCase of cases) {
      const rendered = render(testCase.points);
      try {
        const alphas = testCase.samples.map(([x, y]) => rendered.alphaAt(x, y));
        expect(
          Math.min(...alphas),
          `${testCase.label} must not contain a winding hole`,
        ).toBeGreaterThanOrEqual(120);
        expect(
          Math.max(...alphas) - Math.min(...alphas),
          `${testCase.label} must receive one same-stroke wash`,
        ).toBeLessThanOrEqual(2);
        expect(
          Math.max(...alphas),
          `${testCase.label} must not alpha-stack compound subpaths`,
        ).toBeLessThanOrEqual(130);
      } finally {
        rendered.free();
      }
    }
  });

  it.each([
    ["black", "#000000"],
    ["coloured", "#4b79b9"],
  ] as const)(
    "matches committed multiply pixels on a %s committed backdrop",
    (_label, color) => {
      const backdrop = renderSvgFragment(
        `<rect width="${RASTER_WIDTH}" height="${RASTER_HEIGHT}" fill="${color}"/>`,
      );
      const settled = drawElement("settled", {
        points: [4, 42, 68, 18],
        stroke: "#ffd84d",
      });
      const active = drawElement("active", {
        points: [6, 12, 66, 50],
        stroke: "#77e5ff",
      });
      const committed = committedPixels(backdrop, [settled, active]);
      const preview = previewPixels(backdrop, [settled], active);

      expect(maximumChannelDifference(preview, committed)).toBeLessThanOrEqual(1);
    },
  );

  it("keeps a live self-crossing wash single-deposit and pixel-identical to commit", () => {
    const backdrop = renderSvgFragment(
      `<rect width="${RASTER_WIDTH}" height="${RASTER_HEIGHT}" fill="#6d84a6"/>`,
    );
    const active = drawElement("figure-eight", {
      points: [10, 10, 50, 50, 10, 50, 50, 10],
      pressures: [0.6, 0.6, 0.6, 0.6],
      stroke: "#ffdc62",
    });
    const committed = committedPixels(backdrop, [active]);
    const preview = previewPixels(backdrop, [], active);

    expect(maximumChannelDifference(preview, committed)).toBeLessThanOrEqual(1);
    const crossing = pixelAt(preview, 30, 30);
    const arm = pixelAt(preview, 20, 20);
    expect(crossing.slice(0, 3)).toEqual(arm.slice(0, 3));
  });

  it("preserves prior-main, settled-wash and later normal-draft paint order", () => {
    const page = renderSvgFragment(
      `<rect width="${RASTER_WIDTH}" height="${RASTER_HEIGHT}" fill="#f6efe3"/>`,
    );
    const priorMain = drawElement("prior-main", {
      brush: "pen",
      opacity: 1,
      points: [6, 32, 66, 32],
      stroke: "#25456f",
      strokeWidth: 18,
    });
    const backdrop = committedPixels(page, [priorMain]);
    const settled = drawElement("settled-wash", {
      points: [10, 8, 60, 54],
      stroke: "#ffcf4a",
    });
    const normalAfter = drawElement("normal-after", {
      brush: "pen",
      opacity: 0.8,
      points: [8, 50, 64, 14],
      stroke: "#ee4b68",
      strokeWidth: 7,
    });
    const committed = committedPixels(backdrop, [settled, normalAfter]);
    const preview = previewPixels(backdrop, [settled, normalAfter], null);

    expect(planStudioDraftPreviewCompositeRuns([settled, normalAfter])).toHaveLength(2);
    expect(maximumChannelDifference(preview, committed)).toBeLessThanOrEqual(1);
  });

  it("has a bounded zero-visible live-to-commit diff across adjacent settled washes", () => {
    const backdrop = renderSvgFragment(
      `<rect width="${RASTER_WIDTH}" height="${RASTER_HEIGHT}" fill="#d4e0cc"/>`,
    );
    const settledA = drawElement("settled-a", {
      points: [6, 18, 64, 40],
      stroke: "#ff8fb3",
    });
    const settledB = drawElement("settled-b", {
      brush: "chisel-highlighter",
      points: [8, 48, 62, 12],
      stroke: "#61d7ff",
    });
    const active = drawElement("live", {
      brush: "pastel-highlighter",
      points: [8, 10, 62, 52],
      stroke: "#ffe65c",
    });
    const committed = committedPixels(backdrop, [settledA, settledB, active]);
    const preview = previewPixels(backdrop, [settledA, settledB], active);

    expect(planStudioDraftPreviewCompositeRuns([settledA, settledB])).toHaveLength(1);
    expect(maximumChannelDifference(preview, committed)).toBeLessThanOrEqual(1);
  });
});
