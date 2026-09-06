import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "../bg3d/studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "../bg3d/studio-bg3d-shot-batch-limits";

import {
  planStudio3dInsertCaptureSize,
  STUDIO_3D_INSERT_CAPTURE_MAX_SCALE,
  STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE,
} from "./studio-3d-insert-capture-plan";

describe("studio 3D insert capture plan", () => {
  it("captures a typical HiDPI insert at devicePixelRatio × supersample density", () => {
    const plan = planStudio3dInsertCaptureSize({
      displayWidth: 360,
      displayHeight: 520,
      devicePixelRatio: 2,
    });

    expect(plan).toEqual({
      width: 1_440,
      height: 2_080,
      scale: 4,
      wasReduced: false,
    });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("supersamples 1x displays so scale-ups on canvas stay crisp", () => {
    expect(planStudio3dInsertCaptureSize({
      displayWidth: 360,
      displayHeight: 520,
      devicePixelRatio: 1,
    })).toMatchObject({
      width: 720,
      height: 1_040,
      scale: STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE,
      wasReduced: false,
    });
  });

  it.each([
    // 3x phones would ideally be 6x — the hard density ceiling wins.
    [3, STUDIO_3D_INSERT_CAPTURE_MAX_SCALE],
    // Absurd or broken devicePixelRatio values clamp instead of failing the insert.
    [64, STUDIO_3D_INSERT_CAPTURE_MAX_SCALE],
    [Number.NaN, STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE],
    [-2, STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE],
    [0.5, STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE],
  ])("clamps devicePixelRatio %s to an achieved scale of %s", (devicePixelRatio, scale) => {
    expect(planStudio3dInsertCaptureSize({
      displayWidth: 100,
      displayHeight: 200,
      devicePixelRatio,
    })).toMatchObject({ width: 100 * scale, height: 200 * scale, scale, wasReduced: false });
  });

  it("reduces deterministically to the pixel budget while preserving aspect ratio", () => {
    const plan = planStudio3dInsertCaptureSize({
      displayWidth: 2_000,
      displayHeight: 3_000,
      devicePixelRatio: 2,
    });

    expect(plan).not.toBeNull();
    expect(plan!.wasReduced).toBe(true);
    expect(plan!.width * plan!.height).toBeLessThanOrEqual(STUDIO_BG3D_LT_RENDER_MAX_PIXELS);
    expect(plan!.width).toBeLessThanOrEqual(STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION);
    expect(plan!.height).toBeLessThanOrEqual(STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION);
    // Budget-limited plans should land just under the budget, not collapse below it.
    expect(plan!.width * plan!.height).toBeGreaterThan(STUDIO_BG3D_LT_RENDER_MAX_PIXELS * 0.98);
    expect(plan!.width / plan!.height).toBeCloseTo(2_000 / 3_000, 2);
  });

  it("respects the edge budget for wide displays even below display density", () => {
    const plan = planStudio3dInsertCaptureSize({
      displayWidth: 9_000,
      displayHeight: 450,
      devicePixelRatio: 2,
    });

    expect(plan).not.toBeNull();
    expect(plan!.width).toBeLessThanOrEqual(STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION);
    expect(plan!.wasReduced).toBe(true);
    expect(plan!.scale).toBeLessThan(1);
  });

  it("honors caller-provided budgets no larger than the house budgets", () => {
    expect(planStudio3dInsertCaptureSize({
      displayWidth: 360,
      displayHeight: 520,
      devicePixelRatio: 2,
      maxPixels: 360 * 520,
      maxEdge: 1_024,
    })).toMatchObject({ width: 360, height: 520, scale: 1, wasReduced: true });
  });

  it.each([
    { displayWidth: 0, displayHeight: 100 },
    { displayWidth: 100, displayHeight: 0 },
    { displayWidth: -1, displayHeight: 100 },
    { displayWidth: Number.NaN, displayHeight: 100 },
    { displayWidth: 100, displayHeight: Number.POSITIVE_INFINITY },
    { displayWidth: 100, displayHeight: 100, maxPixels: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1 },
    { displayWidth: 100, displayHeight: 100, maxPixels: 0 },
    { displayWidth: 100, displayHeight: 100, maxPixels: 1.5 },
    { displayWidth: 100, displayHeight: 100, maxEdge: STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION + 1 },
    { displayWidth: 100, displayHeight: 100, maxEdge: 0 },
  ])("fails hostile geometry and budget widening closed: %j", (input) => {
    expect(planStudio3dInsertCaptureSize({ devicePixelRatio: 2, ...input })).toBeNull();
  });
});
