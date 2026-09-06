import path from "node:path";

import initializeCanvasKit, { type CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { createStudioCanvasKitQualityEngine } from "./studio-canvaskit-quality-engine";

let canvasKit: CanvasKit;

beforeAll(async () => {
  canvasKit = await initializeCanvasKit({
    locateFile(file) {
      return path.resolve("node_modules/canvaskit-wasm/bin", file);
    },
  });
});

describe("Studio CanvasKit quality provider", () => {
  it("advertises only the capabilities it really owns", () => {
    const engine = createStudioCanvasKitQualityEngine(canvasKit);
    expect(engine.id).toBe("canvaskit");
    expect(engine.capabilities).toEqual({
      textShaping: false,
      pathBoolean: true,
      strokeToPath: true,
      fontSubsetting: false,
    });
    expect(() =>
      engine.shapeText({
        text: "한글",
        fontFamily: "sans-serif",
        fontSizePx: 20,
      }),
    ).toThrowError(expect.objectContaining({
      name: "StudioEngineUnavailableError",
      providerId: "canvaskit",
      stage: "capability",
    }));
  });

  it.each([
    ["union", "M0 0H10V10H0Z", "M5 0H15V10H5Z"],
    ["intersect", "M0 0H10V10H0Z", "M5 0H15V10H5Z"],
    ["difference", "M0 0H10V10H0Z", "M5 0H15V10H5Z"],
    ["xor", "M0 0H10V10H0Z", "M5 0H15V10H5Z"],
  ] as const)("runs real Skia %s PathOps and returns portable SVG", (op, a, b) => {
    const result = createStudioCanvasKitQualityEngine(canvasKit).pathOp(a, b, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pathData).toMatch(/^M/u);
    expect(result.geometry).toMatchObject({
      kind: "studio-portable-path-geometry",
      version: 1,
      fillRule: "nonzero",
    });
    expect(result.geometry?.contours.length).toBeGreaterThan(0);
    expect(result.geometry?.contours.every((contour) => contour.closed)).toBe(
      true,
    );
    expect(canvasKit.Path.MakeFromSVGString(result.pathData)).not.toBeNull();
    canvasKit.Path.MakeFromSVGString(result.pathData)?.delete();
  });

  it("preserves cubic curves through a real Skia boolean operation", () => {
    const engine = createStudioCanvasKitQualityEngine(canvasKit);
    const result = engine.pathOp(
      "M0 10C0 4.477 4.477 0 10 0C15.523 0 20 4.477 20 10C20 15.523 15.523 20 10 20C4.477 20 0 15.523 0 10Z",
      "M10 0H30V20H10Z",
      "union",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pathData).toMatch(/[CQ]/u);
  });

  it("serializes XOR as portable nonzero-winding contours instead of losing its hole", () => {
    const result = createStudioCanvasKitQualityEngine(canvasKit).pathOp(
      "M0 0H80V60H0Z",
      "M40 20H120V90H40Z",
      "xor",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const portable = canvasKit.Path.MakeFromSVGString(result.pathData);
    expect(portable).not.toBeNull();
    expect([
      portable?.contains(20, 30),
      portable?.contains(50, 30),
      portable?.contains(100, 70),
      portable?.contains(140, 30),
    ]).toEqual([true, false, true, false]);
    portable?.delete();
  });

  it("preserves a fully nested XOR hole after portable winding normalization", () => {
    const result = createStudioCanvasKitQualityEngine(canvasKit).pathOp(
      "M0 0H100V100H0Z",
      "M25 25H75V75H25Z",
      "xor",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const portable = canvasKit.Path.MakeFromSVGString(result.pathData);
    expect(portable).not.toBeNull();
    expect(portable?.contains(10, 10)).toBe(true);
    expect(portable?.contains(50, 50)).toBe(false);
    portable?.delete();
  });

  it("expands round strokes into a filled Skia outline", () => {
    const result = createStudioCanvasKitQualityEngine(canvasKit).strokeToPath(
      "M0 0L20 0",
      {
        widthPx: 6,
        cap: "round",
        join: "round",
        miterLimit: 4,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pathData).toContain("Z");
    const pathValue = canvasKit.Path.MakeFromSVGString(result.pathData);
    expect(pathValue).not.toBeNull();
    const bounds = pathValue?.getBounds();
    expect(bounds?.[0]).toBeLessThanOrEqual(-2.9);
    expect(bounds?.[2]).toBeGreaterThanOrEqual(22.9);
    pathValue?.delete();
  });

  it("expands a supported dash pair before stroke conversion", () => {
    const result = createStudioCanvasKitQualityEngine(canvasKit).strokeToPath(
      "M0 0L100 0",
      {
        widthPx: 4,
        cap: "butt",
        join: "miter",
        miterLimit: 4,
        dash: { pattern: [10, 5], phase: 0 },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.pathData.match(/M/gu) ?? []).length).toBeGreaterThan(1);
  });

  it("fails closed for malformed paths, invalid widths, and unsupported complex dashes", () => {
    const engine = createStudioCanvasKitQualityEngine(canvasKit);
    expect(engine.pathOp("not-a-path", "M0 0L1 1", "union").ok).toBe(false);
    expect(
      engine.strokeToPath("M0 0L1 1", {
        widthPx: 0,
        cap: "round",
        join: "round",
        miterLimit: 4,
      }).ok,
    ).toBe(false);
    expect(
      engine.strokeToPath("M0 0L100 0", {
        widthPx: 4,
        cap: "round",
        join: "round",
        miterLimit: 4,
        dash: { pattern: [10, 5, 2, 5], phase: 0 },
      }).ok,
    ).toBe(false);
  });
});
