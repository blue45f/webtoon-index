import { describe, expect, it } from "vitest";

import {
  applyColorRangeMaskToSelection,
  buildColorRangeMask,
  flipColorRangeMask,
} from "./studio-color-range";
import { executeStudioColorRangeWorkerRequest } from "./studio-color-range-worker-runtime";
import { rectSelectionPolygon } from "./studio-selection-tools";

import type { StudioColorRangeWorkerRunRequest } from "./studio-color-range-worker-protocol";

function rgbaGrid(rows: readonly string[]): Uint8ClampedArray {
  const colors = {
    R: [220, 40, 40, 255],
    B: [40, 60, 220, 255],
    G: [60, 190, 90, 255],
    T: [220, 40, 40, 96],
    ".": [0, 0, 0, 0],
  } as const;
  const data = new Uint8ClampedArray(rows.length * rows[0]!.length * 4);
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y]!.length; x += 1) {
      const pixel = colors[rows[y]![x] as keyof typeof colors];
      data.set(pixel, (y * rows[y]!.length + x) * 4);
    }
  }
  return data;
}

function request(
  overrides: Partial<StudioColorRangeWorkerRunRequest> = {},
): StudioColorRangeWorkerRunRequest {
  const rows = [
    "RR..BB",
    "RT..BB",
    "..GG..",
    "..GG..",
  ] as const;
  return {
    data: rgbaGrid(rows),
    width: rows[0].length,
    height: rows.length,
    samples: [{ r: 220, g: 40, b: 40 }],
    fuzziness: 48,
    antiAlias: true,
    selection: null,
    combineMode: "add",
    aspect: rows.length / rows[0].length,
    ...overrides,
  };
}

function legacyResult(input: StudioColorRangeWorkerRunRequest) {
  const mask = buildColorRangeMask(
    input.data,
    input.width,
    input.height,
    input.samples,
    input.fuzziness,
    { antiAlias: input.antiAlias },
  );
  return applyColorRangeMaskToSelection(
    input.selection,
    flipColorRangeMask(mask, input.flipX ?? false, input.flipY ?? false),
    input.combineMode,
    { aspect: input.aspect },
  );
}

describe("executeStudioColorRangeWorkerRequest", () => {
  it.each([
    { combineMode: "add", flipX: false, flipY: false },
    { combineMode: "subtract", flipX: true, flipY: false },
    { combineMode: "intersect", flipX: false, flipY: true },
    { combineMode: "add", flipX: true, flipY: true },
  ] as const)(
    "preserves the existing scan/flip/$combineMode selection semantics",
    ({ combineMode, flipX, flipY }) => {
      const existing = {
        subpaths: [{
          mode: "add" as const,
          points: rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.72, y: 1 }),
        }],
        featherPx: 3,
        invert: false,
      };
      const input = request({
        combineMode,
        flipX,
        flipY,
        selection: existing,
      });

      expect(executeStudioColorRangeWorkerRequest(input)).toEqual(legacyResult(input));
    },
  );

  it("keeps empty-sample and antiAlias:false behavior identical to the original core", () => {
    for (const input of [
      request({ samples: [] }),
      request({ antiAlias: false, fuzziness: 0 }),
      request({
        samples: [{ r: 40, g: 60, b: 220 }, { r: 60, g: 190, b: 90 }],
        fuzziness: 72,
      }),
    ]) {
      expect(executeStudioColorRangeWorkerRequest(input)).toEqual(legacyResult(input));
    }
  });
});
