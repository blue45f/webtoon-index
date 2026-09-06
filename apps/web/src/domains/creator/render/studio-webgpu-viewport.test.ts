import { describe, expect, it } from "vitest";

import { planStudioWebGpuViewportSurface } from "./studio-webgpu-viewport";

function mapDocumentPointToSurface(
  point: { x: number; y: number },
  document: { width: number; height: number },
  plan: NonNullable<ReturnType<typeof planStudioWebGpuViewportSurface>>
) {
  const transformedX = (
    plan.transform.flipX ? document.width - point.x : point.x
  ) * plan.transform.scaleX + plan.transform.offsetX;
  const transformedY = point.y * plan.transform.scaleY + plan.transform.offsetY;
  return {
    x: transformedX / document.width * plan.surface.width,
    y: transformedY / document.height * plan.surface.height,
  };
}

describe("planStudioWebGpuViewportSurface", () => {
  it("bounds a tall document to the current scroll viewport without changing pixel scale", () => {
    const plan = planStudioWebGpuViewportSurface({
      documentWidth: 800,
      documentHeight: 12_000,
      documentScale: 1.5,
      scrollLeft: 100,
      scrollTop: 4_800,
      viewportWidth: 640,
      viewportHeight: 720,
    });

    expect(plan).not.toBeNull();
    expect(plan!.surface).toEqual({ left: 100, top: 4_800, width: 640, height: 720 });
    expect(plan!.transform).toEqual({
      scaleX: 1.875,
      scaleY: 25,
      offsetX: -125,
      offsetY: -80_000,
      flipX: false,
    });

    const topLeft = mapDocumentPointToSurface(
      { x: 100 / 1.5, y: 4_800 / 1.5 },
      { width: 800, height: 12_000 },
      plan!
    );
    const bottomRight = mapDocumentPointToSurface(
      { x: (100 + 640) / 1.5, y: (4_800 + 720) / 1.5 },
      { width: 800, height: 12_000 },
      plan!
    );
    expect(topLeft.x).toBeCloseTo(0, 10);
    expect(topLeft.y).toBeCloseTo(0, 10);
    expect(bottomRight.x).toBeCloseTo(640, 10);
    expect(bottomRight.y).toBeCloseTo(720, 10);
  });

  it("maps the visible document interval correctly when the editor is flipped horizontally", () => {
    const plan = planStudioWebGpuViewportSurface({
      documentWidth: 800,
      documentHeight: 8_000,
      documentScale: 2,
      scrollLeft: 240,
      scrollTop: 1_000,
      viewportWidth: 600,
      viewportHeight: 500,
      flipX: true,
    });

    expect(plan).not.toBeNull();
    expect(plan!.transform.flipX).toBe(true);
    const topLeft = mapDocumentPointToSurface(
      { x: 800 - 240 / 2, y: 1_000 / 2 },
      { width: 800, height: 8_000 },
      plan!
    );
    const bottomRight = mapDocumentPointToSurface(
      { x: 800 - (240 + 600) / 2, y: (1_000 + 500) / 2 },
      { width: 800, height: 8_000 },
      plan!
    );
    expect(topLeft.x).toBeCloseTo(0, 10);
    expect(topLeft.y).toBeCloseTo(0, 10);
    expect(bottomRight.x).toBeCloseTo(600, 10);
    expect(bottomRight.y).toBeCloseTo(500, 10);
  });

  it("clips the surface to the document intersection when the viewport is larger", () => {
    const plan = planStudioWebGpuViewportSurface({
      documentWidth: 800,
      documentHeight: 600,
      documentScale: 0.5,
      scrollLeft: -20,
      scrollTop: Number.NaN,
      viewportWidth: 1_000,
      viewportHeight: 900,
    });

    expect(plan).toEqual({
      surface: { left: 0, top: 0, width: 400, height: 300 },
      transform: {
        scaleX: 1,
        scaleY: 1,
        offsetX: -0,
        offsetY: -0,
        flipX: false,
      },
    });
  });

  it("fails closed for unavailable or non-finite viewport geometry", () => {
    const base = {
      documentWidth: 800,
      documentHeight: 8_000,
      documentScale: 1,
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 600,
      viewportHeight: 700,
    };

    expect(planStudioWebGpuViewportSurface({ ...base, viewportHeight: 0 })).toBeNull();
    expect(planStudioWebGpuViewportSurface({ ...base, documentScale: Number.POSITIVE_INFINITY })).toBeNull();
    expect(planStudioWebGpuViewportSurface({ ...base, scrollTop: 9_000 })).toBeNull();
  });
});
