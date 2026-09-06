import { describe, expect, it } from "vitest";

import {
  planStudioInspectorMultiSelectionLayoutPatch,
  resolveStudioInspectorSelectionLayoutMetrics,
} from "./studio-inspector-multi-selection";

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
    strokeWidth: 6,
    ...partial,
  } as DrawEl;
}

function frame(id = "frame"): El {
  return {
    id,
    type: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
  } as El;
}

describe("Inspector multi-selection bridge", () => {
  it("promotes exact group W/H and relative rotation only in the production Inspector metrics", () => {
    const metrics = resolveStudioInspectorSelectionLayoutMetrics([
      image({ id: "a", x: 0, y: 0, width: 40, height: 20 }),
      image({ id: "b", x: 80, y: 20, width: 20, height: 20 }),
    ]);

    expect(metrics).toMatchObject({
      elementCount: 2,
      hasFixedSize: true,
      supportsWidth: true,
      supportsHeight: true,
      supportsRotation: true,
      rotationIsRelative: true,
      rotation: 0,
      widthDisabledReason: null,
      heightDisabledReason: null,
      rotationDisabledReason: null,
    });
  });

  it("keeps relative rotation visibly unavailable when one member cannot carry the angle", () => {
    const metrics = resolveStudioInspectorSelectionLayoutMetrics([
      frame(),
      image({ id: "image", x: 240, y: 0, width: 40, height: 40 }),
    ]);

    expect(metrics).toMatchObject({
      supportsWidth: true,
      supportsHeight: true,
      supportsRotation: false,
      rotationIsRelative: true,
    });
    expect(metrics?.rotationDisabledReason).toContain("회전할 수 없는 요소");
  });

  it("uniformly resizes every member from a typed total width in one plan", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 20, height: 10 });
    const b = image({ id: "b", x: 80, y: 20, width: 20, height: 20 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { width: 200 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    const nextA = plan.next.find((element) => element.id === "a") as ImageEl;
    const nextB = plan.next.find((element) => element.id === "b") as ImageEl;
    expect(nextA.x).toBeCloseTo(0, 6);
    expect(nextA.y).toBeCloseTo(0, 6);
    expect(nextA.width).toBeCloseTo(40, 6);
    expect(nextA.height).toBeCloseTo(20, 6);
    expect(nextB.x).toBeCloseTo(160, 6);
    expect(nextB.y).toBeCloseTo(40, 6);
    expect(nextB.width).toBeCloseTo(40, 6);
    expect(nextB.height).toBeCloseTo(40, 6);
    expect(plan.announcement).toContain("크기 200%");
  });

  it("rotates the whole selection around its centre and composes member angles", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 20, height: 10 });
    const b = image({ id: "b", x: 80, y: 0, width: 20, height: 10 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { rotation: 90 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    const nextA = plan.next.find((element) => element.id === "a") as ImageEl;
    const nextB = plan.next.find((element) => element.id === "b") as ImageEl;
    expect(nextA.x).toBeCloseTo(55, 6);
    expect(nextA.y).toBeCloseTo(-45, 6);
    expect(nextB.x).toBeCloseTo(55, 6);
    expect(nextB.y).toBeCloseTo(35, 6);
    expect(nextA.rotation).toBe(90);
    expect(nextB.rotation).toBe(90);
    expect(plan.announcement).toContain("회전 90°");
  });

  it("preserves authored draw stroke weight exactly like the canvas multi-resize path", () => {
    const stroke = draw({ id: "stroke", points: [0, 0, 20, 0], strokeWidth: 4 });
    const picture = image({ id: "image", x: 80, y: 0, width: 20, height: 20 });
    const metrics = resolveStudioInspectorSelectionLayoutMetrics([stroke, picture])!;
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [stroke, picture],
      ["stroke", "image"],
      { width: metrics.width * 2 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    const nextStroke = plan.next.find((element) => element.id === "stroke") as DrawEl;
    const nextPicture = plan.next.find((element) => element.id === "image") as ImageEl;
    expect(nextStroke.points).not.toEqual(stroke.points);
    expect(nextStroke.strokeWidth).toBe(stroke.strokeWidth);
    expect(nextPicture.width).toBeCloseTo(40, 6);
  });

  it("moves and normalises mixed opacity in the same durable document snapshot", () => {
    const a = image({ id: "a", x: 10, y: 20, width: 40, height: 30, opacity: 0.25 });
    const b = image({ id: "b", x: 80, y: 60, width: 20, height: 20, opacity: 0.75 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { x: 40, y: 50, opacity: 0.6 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    const nextA = plan.next.find((element) => element.id === "a") as ImageEl;
    const nextB = plan.next.find((element) => element.id === "b") as ImageEl;
    expect(nextA).toMatchObject({ x: 40, y: 50, opacity: 0.6 });
    expect(nextB.x - nextA.x).toBe(70);
    expect(nextB.y - nextA.y).toBe(40);
    expect(nextB.opacity).toBe(0.6);
    expect(plan.announcement).toContain("위치");
    expect(plan.announcement).toContain("불투명도");
  });

  it("refuses a non-uniform two-axis request instead of tearing mixed models", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const b = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { width: 200, height: 80 },
    );

    expect(plan).toMatchObject({ kind: "unchanged" });
    if (plan.kind === "unchanged") expect(plan.refusal).toContain("비율을 유지");
  });

  it("fails the whole operation when a selected member is locked", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const b = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { width: 200 },
      { isLocked: (element) => element.id === "b" },
    );

    expect(plan).toMatchObject({ kind: "unchanged" });
    if (plan.kind === "unchanged") expect(plan.refusal).toContain("잠긴 레이어");
  });

  it("returns the planner's all-or-nothing rotation refusal without mutating references", () => {
    const panel = frame();
    const picture = image({ id: "image", x: 240, y: 0, width: 40, height: 40 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [panel, picture],
      [panel.id, picture.id],
      { rotation: 15 },
    );

    expect(plan).toMatchObject({ kind: "unchanged" });
    if (plan.kind === "unchanged") expect(plan.refusal).toContain("회전할 수 없는 요소");
    expect("rotation" in panel).toBe(false);
    expect(picture.rotation).toBe(0);
  });
});
