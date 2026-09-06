import { describe, expect, it } from "vitest";

import {
  planStudioMultiSelectionLayoutPatch,
  planStudioSelectionLayoutPatch,
  resolveStudioFigmaSelectionLayoutMetrics,
  unionStudioSelectionBounds,
} from "./studio-selection-transform-advanced";

import type { DrawEl, El, ImageEl } from "./studio-element-model";

function image(
  partial: Partial<ImageEl> & Pick<ImageEl, "id" | "x" | "y" | "width" | "height">,
): ImageEl {
  return {
    type: "image",
    src: "data:image/png;base64,AA==",
    rotation: 0,
    ...partial,
  } as ImageEl;
}

function draw(partial: Partial<DrawEl> & Pick<DrawEl, "id" | "points">): DrawEl {
  return {
    type: "draw",
    mode: "pen",
    brush: "pen",
    stroke: "#111",
    strokeWidth: 4,
    ...partial,
  } as DrawEl;
}

describe("precision selection transform", () => {
  it("advertises atomic W/H and relative rotation for a compatible multi-selection", () => {
    const metrics = resolveStudioFigmaSelectionLayoutMetrics([
      image({ id: "a", x: 0, y: 0, width: 40, height: 20 }),
      image({ id: "b", x: 60, y: 20, width: 20, height: 20 }),
    ]);
    expect(metrics).toMatchObject({
      precisionControls: true,
      supportsWidth: true,
      supportsHeight: true,
      supportsRotation: true,
      rotationIsRelative: true,
      rotation: 0,
      aspectLocked: true,
      elementCount: 2,
    });
  });

  it("avoids duplicating the type-specific image ratio control while exposing it for draw", () => {
    expect(
      resolveStudioFigmaSelectionLayoutMetrics([
        image({ id: "a", x: 0, y: 0, width: 40, height: 20 }),
      ]),
    ).toMatchObject({
      supportsAspectLock: true,
      showAspectLockControl: false,
    });
    expect(
      resolveStudioFigmaSelectionLayoutMetrics([
        draw({ id: "s", points: [0, 0, 40, 20] }),
      ]),
    ).toMatchObject({
      supportsAspectLock: true,
      showAspectLockControl: true,
    });
  });

  it("keeps a chosen single-element anchor fixed while locking the ratio", () => {
    const element = image({ id: "a", x: 0, y: 0, width: 100, height: 50 });
    const patch = planStudioSelectionLayoutPatch(element, {
      width: 200,
      lockAspect: true,
      resizeAnchor: "center",
    });
    expect(patch).toMatchObject({
      x: -50,
      y: -25,
      width: 200,
      height: 100,
      lockAspect: true,
    });
  });

  it("normalizes stored absolute angles and drops full-turn no-ops", () => {
    const element = image({ id: "a", x: 0, y: 0, width: 100, height: 50 });
    expect(planStudioSelectionLayoutPatch(element, { rotation: 360 })).toBeNull();
    expect(planStudioSelectionLayoutPatch(element, { rotation: 190 })).toEqual({
      rotation: -170,
    });
  });

  it("uniformly resizes a group around its centre without collapsing spacing", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 40, height: 20 });
    const b = image({ id: "b", x: 60, y: 20, width: 20, height: 20 });
    const before = unionStudioSelectionBounds([a, b])!;
    const next = planStudioMultiSelectionLayoutPatch([a, b], ["a", "b"], {
      width: before.w * 2,
      resizeAnchor: "center",
    });
    expect(next).not.toBeNull();
    expect(next![0]).toMatchObject({ x: -40, y: -20, width: 80, height: 40 });
    expect(next![1]).toMatchObject({ x: 80, y: 20, width: 40, height: 40 });
    const after = unionStudioSelectionBounds(next!)!;
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2, 6);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2, 6);
  });

  it("rotates every compatible member around the shared centre as one transaction", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 40, height: 20 });
    const b = image({ id: "b", x: 60, y: 20, width: 20, height: 20 });
    const next = planStudioMultiSelectionLayoutPatch([a, b], ["a", "b"], {
      rotation: 90,
    });
    expect(next).not.toBeNull();
    expect(next![0]).toMatchObject({ x: 60, y: -20, rotation: 90 });
    // Rotating about a shared centre goes through cos/sin, so x lands at
    // 40.00000000000001 rather than exactly 40; compare within float tolerance.
    expect(next![1]).toMatchObject({ x: expect.closeTo(40, 6), y: 40, rotation: 90 });
  });

  it("refuses a torn group rotation and conflicting non-uniform numeric scales", () => {
    const picture = image({ id: "a", x: 0, y: 0, width: 40, height: 20 });
    const frame = {
      id: "f",
      type: "frame",
      x: 60,
      y: 0,
      width: 40,
      height: 40,
    } as unknown as El;
    expect(resolveStudioFigmaSelectionLayoutMetrics([picture, frame])?.supportsRotation).toBe(false);
    expect(
      planStudioMultiSelectionLayoutPatch([picture, frame], ["a", "f"], { rotation: 30 }),
    ).toBeNull();
    expect(
      planStudioMultiSelectionLayoutPatch([picture, frame], ["a", "f"], {
        width: 200,
        height: 60,
      }),
    ).toBeNull();
  });

  it("refines preserved-stroke groups until the typed visual width and anchor land exactly", () => {
    const stroke = draw({ id: "s", points: [0, 0, 40, 20], strokeWidth: 4 });
    const picture = image({ id: "i", x: 80, y: 0, width: 20, height: 20 });
    const before = unionStudioSelectionBounds([stroke, picture])!;
    const next = planStudioMultiSelectionLayoutPatch(
      [stroke, picture],
      ["s", "i"],
      { width: before.w * 2, resizeAnchor: "center" },
    );
    const after = unionStudioSelectionBounds(next!)!;
    expect(after.w).toBeCloseTo(before.w * 2, 3);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2, 3);
  });

  it("keeps line weight by default and scales it only after the explicit opt-in", () => {
    const stroke = draw({ id: "s", points: [0, 0, 20, 0], strokeWidth: 4 });
    const picture = image({ id: "i", x: 40, y: 0, width: 10, height: 10 });
    const bounds = unionStudioSelectionBounds([stroke, picture])!;
    const preserved = planStudioMultiSelectionLayoutPatch(
      [stroke, picture],
      ["s", "i"],
      { width: bounds.w * 2 },
    )!;
    const scaled = planStudioMultiSelectionLayoutPatch(
      [stroke, picture],
      ["s", "i"],
      { width: bounds.w * 2, strokeWidthPolicy: "scale" },
    )!;
    expect((preserved[0] as DrawEl).strokeWidth).toBe(4);
    expect((scaled[0] as DrawEl).strokeWidth).toBe(8);
  });

  it("does not leak opacity through when a frame makes the shared edit unsupported", () => {
    const picture = image({ id: "a", x: 0, y: 0, width: 40, height: 20 });
    const frame = {
      id: "f",
      type: "frame",
      x: 60,
      y: 0,
      width: 40,
      height: 40,
    } as unknown as El;
    expect(
      planStudioMultiSelectionLayoutPatch([picture, frame], ["a", "f"], { opacity: 0.5 }),
    ).toBeNull();
  });
});
