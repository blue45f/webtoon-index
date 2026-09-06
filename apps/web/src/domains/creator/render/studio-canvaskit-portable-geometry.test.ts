import { describe, expect, it } from "vitest";

import {
  flattenStudioCanvasKitPathCommands,
  snapshotStudioPortablePathGeometry,
} from "./studio-canvaskit-portable-geometry";

const VERBS = {
  move: 0,
  line: 1,
  quad: 2,
  conic: 3,
  cubic: 4,
  close: 5,
} as const;

describe("CanvasKit portable path geometry", () => {
  it("extracts frozen closed contours and exact bounds from a verb stream", () => {
    const result = flattenStudioCanvasKitPathCommands(
      new Float32Array([
        VERBS.move, 0, 0,
        VERBS.line, 20, 0,
        VERBS.line, 20, 10,
        VERBS.line, 0, 10,
        VERBS.close,
      ]),
      VERBS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.geometry).toMatchObject({
      kind: "studio-portable-path-geometry",
      version: 1,
      fillRule: "nonzero",
      flatnessPx: 0.25,
      flattenedPointCount: 5,
      sourceCommandValueCount: 13,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 20,
        maxY: 10,
        width: 20,
        height: 10,
      },
    });
    expect(result.geometry.contours).toEqual([
      {
        points: [0, 0, 20, 0, 20, 10, 0, 10, 0, 0],
        closed: true,
      },
    ]);
    expect(Object.isFrozen(result.geometry)).toBe(true);
    expect(Object.isFrozen(result.geometry.contours)).toBe(true);
    expect(Object.isFrozen(result.geometry.contours[0]?.points)).toBe(true);
  });

  it("adaptively flattens quadratic, conic and cubic curves without exposing dab-like gaps", () => {
    const result = flattenStudioCanvasKitPathCommands(
      new Float32Array([
        VERBS.move, 0, 0,
        VERBS.quad, 10, 20, 20, 0,
        VERBS.conic, 30, -20, 40, 0, Math.SQRT1_2,
        VERBS.cubic, 50, 20, 60, -20, 70, 0,
        VERBS.close,
      ]),
      VERBS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = result.geometry.contours[0]?.points ?? [];
    expect(points.length / 2).toBeGreaterThan(20);
    expect(points.slice(0, 2)).toEqual([0, 0]);
    expect(points.slice(-2)).toEqual([0, 0]);
    expect(result.geometry.bounds.minY).toBeLessThan(0);
    expect(result.geometry.bounds.maxY).toBeGreaterThan(0);
    expect(points.every(Number.isFinite)).toBe(true);
  });

  it("fails closed for truncated, unknown and non-finite commands", () => {
    expect(
      flattenStudioCanvasKitPathCommands(
        [VERBS.move, 0],
        VERBS,
      ).ok,
    ).toBe(false);
    expect(
      flattenStudioCanvasKitPathCommands(
        [VERBS.move, 0, 0, 99],
        VERBS,
      ).ok,
    ).toBe(false);
    expect(
      flattenStudioCanvasKitPathCommands(
        [VERBS.move, Number.NaN, 0],
        VERBS,
      ).ok,
    ).toBe(false);
  });

  it("revalidates Worker data, recomputes bounds and rejects extra or forged fields", () => {
    const result = flattenStudioCanvasKitPathCommands(
      [
        VERBS.move, 1, 2,
        VERBS.line, 4, 2,
        VERBS.line, 4, 7,
        VERBS.close,
      ],
      VERBS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clone = JSON.parse(JSON.stringify(result.geometry)) as Record<string, unknown>;
    expect(snapshotStudioPortablePathGeometry(clone)).toEqual(result.geometry);
    expect(snapshotStudioPortablePathGeometry({ ...clone, embind: {} })).toBeNull();
    expect(snapshotStudioPortablePathGeometry({
      ...clone,
      bounds: {
        ...(clone.bounds as Record<string, unknown>),
        maxX: 999,
      },
    })).toBeNull();
  });
});
