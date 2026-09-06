import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import {
  planStudioWebGlLiveInkGeometry,
  resolveStudioWebGlLiveInkSurface,
  STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS,
} from "./studio-webgl-live-ink";

import type { StudioGpuStroke } from "./studio-webgpu-stroke";

function surface(overrides: Parameters<typeof resolveStudioWebGlLiveInkSurface>[0] = {
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  documentScale: 1,
  documentWidth: 100,
  flipX: false,
  devicePixelRatio: 1,
}) {
  const plan = resolveStudioWebGlLiveInkSurface(overrides);
  if (!plan.ok) throw new Error(plan.reason);
  return plan.surface;
}

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "stroke-1",
    points: [10, 50, 50, 50, 90, 50],
    pressures: [0.2, 0.5, 1],
    color: "#ff3366",
    size: 10,
    pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    opacity: 0.8,
    ...overrides,
  };
}

describe("resolveStudioWebGlLiveInkSurface", () => {
  it("retains native density under the transient pixel ceiling", () => {
    const result = resolveStudioWebGlLiveInkSurface({
      left: 0,
      top: 0,
      width: 1_920,
      height: 1_080,
      documentScale: 1,
      documentWidth: 1_920,
      flipX: false,
      devicePixelRatio: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      surface: {
        dpr: 2,
        backingWidth: 3_840,
        backingHeight: 2_160,
        backingPixels: 8_294_400,
      },
    });
  });

  it("down-quantizes DPR without exceeding a tighter caller budget", () => {
    const result = resolveStudioWebGlLiveInkSurface({
      left: 0,
      top: 0,
      width: 2_000,
      height: 1_000,
      documentScale: 1,
      documentWidth: 2_000,
      flipX: false,
      devicePixelRatio: 3,
      maximumBackingPixels: 4_500_000,
    });

    expect(result).toMatchObject({
      ok: true,
      surface: {
        dpr: 1.5,
        backingWidth: 3_000,
        backingHeight: 1_500,
        backingPixels: 4_500_000,
      },
    });
  });

  it("fails closed when even DPR 1 cannot fit the hard pixel budget", () => {
    expect(resolveStudioWebGlLiveInkSurface({
      left: 0,
      top: 0,
      width: STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS,
      height: 2,
      documentScale: 1,
      documentWidth: STUDIO_WEBGL_LIVE_INK_MAX_BACKING_PIXELS,
      flipX: false,
      devicePixelRatio: 1,
    })).toEqual({ ok: false, reason: "surface-budget-exceeded" });
  });

  it("honors the runtime WebGL viewport dimension limit", () => {
    expect(resolveStudioWebGlLiveInkSurface({
      left: 0,
      top: 0,
      width: 2_048,
      height: 1_024,
      documentScale: 1,
      documentWidth: 2_048,
      flipX: false,
      devicePixelRatio: 2,
    }, 2_048)).toEqual({ ok: false, reason: "surface-dimension-exceeded" });
  });
});

describe("planStudioWebGlLiveInkGeometry", () => {
  it("builds one bounded triangle strip with pressure-varying width", () => {
    const result = planStudioWebGlLiveInkGeometry(stroke(), surface(), 64);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.geometry.vertexCount).toBe(6);
    expect(result.geometry.vertices).toHaveLength(12);
    expect(Array.from(result.geometry.vertices).every(Number.isFinite)).toBe(true);
    expect(result.geometry.color).toEqual([1, 0.2, 0.4, 0.8]);
    const firstWidth = Math.abs(
      result.geometry.vertices[1]! - result.geometry.vertices[3]!
    );
    const lastWidth = Math.abs(
      result.geometry.vertices[9]! - result.geometry.vertices[11]!
    );
    expect(lastWidth).toBeGreaterThan(firstWidth * 4);
  });

  it("builds a four-vertex tap and collapses consecutive duplicate samples", () => {
    const tap = planStudioWebGlLiveInkGeometry(stroke({
      points: [25, 25, 25, 25],
      pressures: [0.2, 1],
    }), surface(), 8);

    expect(tap.ok).toBe(true);
    if (!tap.ok) return;
    expect(tap.geometry.vertexCount).toBe(4);
    expect(new Set(tap.geometry.vertices)).not.toEqual(new Set([0]));
  });

  it("rejects malformed points and unsupported overlay erasing", () => {
    expect(planStudioWebGlLiveInkGeometry(stroke({
      points: [10, 10, Number.NaN, 20],
    }), surface(), 64)).toEqual({ ok: false, reason: "invalid-stroke" });
    expect(planStudioWebGlLiveInkGeometry(stroke({ composite: "erase" }), surface(), 64))
      .toEqual({ ok: false, reason: "unsupported-composite" });
  });

  it("rejects oversized input before allocating geometry", () => {
    expect(planStudioWebGlLiveInkGeometry(stroke(), surface(), 4))
      .toEqual({ ok: false, reason: "vertex-budget-exceeded" });
  });

  it("rejects finite document coordinates that overflow Float32 clip space", () => {
    expect(planStudioWebGlLiveInkGeometry(stroke({
      points: [Number.MAX_VALUE, 10, Number.MAX_VALUE / 2, 20],
      pressures: [1, 1],
    }), surface(), 64)).toEqual({ ok: false, reason: "numeric-overflow" });
  });
});
