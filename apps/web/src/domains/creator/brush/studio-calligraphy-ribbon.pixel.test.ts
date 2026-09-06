import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { planStudioCalligraphyRibbon } from "./studio-calligraphy-ribbon";

import type { CalligraphySegment } from "../studio-brush";

function segment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  tipAngleRad = -Math.PI / 6,
  roundness = 0.35,
): CalligraphySegment {
  return {
    x0,
    y0,
    x1,
    y1,
    width,
    tipAngleRad,
    roundness,
  };
}

function pathData(segments: readonly CalligraphySegment[]): string {
  const plan = planStudioCalligraphyRibbon(segments);
  return plan.runs.map((run) => {
    const [firstX, firstY, ...remaining] = run.outlinePoints;
    if (firstX === undefined || firstY === undefined) return "";
    let path = `M${firstX} ${firstY}`;
    for (let index = 0; index < remaining.length; index += 2) {
      path += `L${remaining[index]} ${remaining[index + 1]}`;
    }
    return `${path}Z`;
  }).join("");
}

let resvgModule: typeof import("@resvg/resvg-wasm");

describe("Studio calligraphy ribbon raster coverage", () => {
  beforeAll(async () => {
    resvgModule = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await resvgModule.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );
  });

  it("fills exact retraces and figure-eight crossings once without winding holes", () => {
    const render = (segments: readonly CalligraphySegment[]) => {
      const renderer = new resvgModule.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="96">',
          `<path d="${pathData(segments)}" fill="#000" fill-rule="nonzero" opacity="0.5"/>`,
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
        label: "exact out-back retrace",
        segments: [
          segment(18, 28, 82, 28, 12),
          segment(82, 28, 18, 28, 12),
        ],
        samples: [[30, 28], [50, 28], [70, 28]] as const,
      },
      {
        label: "figure-eight crossing",
        segments: [
          segment(18, 48, 82, 84, 10, Math.PI / 5, 0.42),
          segment(82, 84, 18, 84, 10, Math.PI / 5, 0.42),
          segment(18, 84, 82, 48, 10, Math.PI / 5, 0.42),
        ],
        samples: [[32, 56], [50, 66], [68, 56]] as const,
      },
    ];

    for (const testCase of cases) {
      const rendered = render(testCase.segments);
      try {
        const alphas = testCase.samples.map(([x, y]) => rendered.alphaAt(x, y));
        expect(
          Math.min(...alphas),
          `${testCase.label} must not contain a winding hole`,
        ).toBeGreaterThanOrEqual(120);
        expect(
          Math.max(...alphas) - Math.min(...alphas),
          `${testCase.label} must receive one same-stroke fill`,
        ).toBeLessThanOrEqual(2);
        expect(
          Math.max(...alphas),
          `${testCase.label} must not alpha-stack overlapping segment sweeps`,
        ).toBeLessThanOrEqual(130);
      } finally {
        rendered.free();
      }
    }
  });

  it("renders the tilted nib footprint instead of a generic circular terminal cap", () => {
    const render = (tipAngleRad: number) => {
      const renderer = new resvgModule.Resvg(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="56">',
          `<path d="${pathData([
            segment(28, 28, 62, 28, 10, tipAngleRad, 0.25),
          ])}" fill="#000" fill-rule="nonzero"/>`,
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

    const aligned = render(0);
    const perpendicular = render(Math.PI / 2);
    try {
      expect(aligned.alphaAt(10, 28)).toBeGreaterThanOrEqual(250);
      expect(perpendicular.alphaAt(10, 28)).toBe(0);
      expect(perpendicular.alphaAt(27, 28)).toBeGreaterThanOrEqual(250);
    } finally {
      aligned.free();
      perpendicular.free();
    }
  });

  it.each([
    {
      label: "0°",
      tipAngleRad: 0,
      interiorOffsets: [
        [0, 0],
        [-4, 0],
        [4, 0],
        [0, -2],
        [0, 2],
      ] as const,
    },
    {
      label: "90°",
      tipAngleRad: Math.PI / 2,
      interiorOffsets: [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -4],
        [0, 4],
      ] as const,
    },
  ])(
    "keeps $label start/end terminal interiors opaque in live, committed and SVG replay",
    ({ tipAngleRad, interiorOffsets }) => {
      const liveSegments = [
        segment(36, 48, 88, 48, 18, tipAngleRad, 0.35),
      ];
      const committedSegments = [
        ...liveSegments,
        segment(88, 48, 116, 66, 18, tipAngleRad, 0.35),
      ];
      const render = (segments: readonly CalligraphySegment[]) => {
        const renderer = new resvgModule.Resvg(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="112">',
            `<path d="${pathData(segments)}" fill="#000" fill-rule="nonzero"/>`,
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
      const live = render(liveSegments);
      const committed = render(committedSegments);
      const svgReplay = render(structuredClone(committedSegments));

      try {
        for (const [offsetX, offsetY] of interiorOffsets) {
          for (const terminalX of [36, 88]) {
            const liveAlpha = live.alphaAt(terminalX + offsetX, 48 + offsetY);
            const committedAlpha = committed.alphaAt(
              terminalX + offsetX,
              48 + offsetY,
            );
            expect(liveAlpha).toBeGreaterThanOrEqual(250);
            expect(committedAlpha).toBe(liveAlpha);
            expect(svgReplay.alphaAt(
              terminalX + offsetX,
              48 + offsetY,
            )).toBe(committedAlpha);
          }
        }
      } finally {
        live.free();
        committed.free();
        svgReplay.free();
      }
    },
  );
});
