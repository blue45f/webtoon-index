import { describe, expect, it } from "vitest";

import { planStudioDrawObjectTransform } from "./brush/studio-draw-object-transform";
import { planStudioGroupUniformResize } from "./studio-group-uniform-resize";
import {
  STUDIO_SELECTION_RESIZE_REFUSED_MESSAGE,
  STUDIO_SELECTION_ROTATE_REFUSED_MESSAGE,
  describeStudioSelectionTransform,
  planStudioSelectionTransformCommit,
} from "./studio-selection-transform-commit";

import type { El } from "./studio-element-model";

const SOURCE = { x: 10, y: 20, width: 100, height: 50 };
const DOUBLE = { x: 30, y: 40, width: 200, height: 100 };

function draw(id = "draw", overrides: Partial<Extract<El, { type: "draw" }>> = {}): Extract<El, { type: "draw" }> {
  return {
    id,
    type: "draw",
    points: [10, 20, 20, 25, 30, 30],
    stroke: "#111111",
    strokeWidth: 4,
    ...overrides,
  };
}

function image(id = "image"): El {
  return {
    id,
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 20,
    y: 25,
    width: 30,
    height: 20,
    rotation: 17,
  };
}

const unlocked = (element: El) => element.locked === true;

describe("planStudioSelectionTransformCommit", () => {
  it("hands a sole unlocked stroke to the single-stroke planner and narrates the resize", () => {
    const stroke = draw();
    const bystander = image();
    const plan = planStudioSelectionTransformCommit({
      elements: [bystander, stroke],
      selectedIds: [stroke.id],
      sourceBounds: SOURCE,
      targetBounds: DOUBLE,
      rotationDeg: 0,
      isLocked: unlocked,
    });
    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.next[0]).toBe(bystander);
    expect(plan.next[1]).toEqual(
      planStudioDrawObjectTransform({ el: stroke, sourceBounds: SOURCE, targetBounds: DOUBLE })
    );
    expect(plan.announcement).toBe("레이어 크기 조절 · 200%");
  });

  it("refuses a sole stroke's angle when the single planner would silently drop it", () => {
    // A rect is rebuilt axis-aligned from its point bounds; the single planner would keep the
    // resize and drop the turn, which the editor must report as a refusal, not a silent resize.
    const rect = draw("rect", { kind: "rect" } as Partial<Extract<El, { type: "draw" }>>);
    const plan = planStudioSelectionTransformCommit({
      elements: [rect],
      selectedIds: [rect.id],
      sourceBounds: SOURCE,
      targetBounds: DOUBLE,
      rotationDeg: 30,
      isLocked: unlocked,
    });
    expect(plan).toEqual({ kind: "unchanged", refusal: STUDIO_SELECTION_ROTATE_REFUSED_MESSAGE });
  });

  it("narrates a rotate-only gesture as a turn, not a resize to its own size", () => {
    const stroke = draw();
    const plan = planStudioSelectionTransformCommit({
      elements: [stroke],
      selectedIds: [stroke.id],
      sourceBounds: SOURCE,
      targetBounds: SOURCE,
      rotationDeg: 25,
      isLocked: unlocked,
    });
    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.announcement).toBe("레이어 회전 · 25°");
  });

  it("routes a multi-selection through the group planner with the angle", () => {
    const items = [draw("a"), draw("b", { points: [40, 20, 60, 30, 80, 60] })];
    const plan = planStudioSelectionTransformCommit({
      elements: items,
      selectedIds: ["a", "b"],
      sourceBounds: SOURCE,
      targetBounds: DOUBLE,
      rotationDeg: 25,
      isLocked: unlocked,
    });
    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(plan.next).toEqual(
      planStudioGroupUniformResize({
        items,
        selectedIds: ["a", "b"],
        sourceBounds: SOURCE,
        targetBounds: DOUBLE,
        rotationDeg: 25,
        isLocked: unlocked,
      })
    );
    expect(plan.announcement).toBe("그룹 크기 조절 · 200% · 회전 25°");
  });

  it("names the refused operation from the angle, not from the box Konva moved", () => {
    // Konva's rotater pivots about the centre, so a refused rotation still arrives with a moved
    // box; the toast must still say "rotate". Without an angle, a moved box means "resize".
    const panel = {
      id: "frame",
      type: "frame",
      x: 15,
      y: 25,
      width: 40,
      height: 30,
    } as unknown as El;
    const items = [image(), panel];
    const rotated = planStudioSelectionTransformCommit({
      elements: items,
      selectedIds: ["image", "frame"],
      sourceBounds: SOURCE,
      targetBounds: { ...SOURCE, x: 12, y: 18 },
      rotationDeg: 30,
      isLocked: unlocked,
    });
    expect(rotated).toEqual({ kind: "unchanged", refusal: STUDIO_SELECTION_ROTATE_REFUSED_MESSAGE });

    const locked = [image(), { ...draw(), locked: true } as El];
    const resized = planStudioSelectionTransformCommit({
      elements: locked,
      selectedIds: ["image", "draw"],
      sourceBounds: SOURCE,
      targetBounds: DOUBLE,
      rotationDeg: 0,
      isLocked: unlocked,
    });
    expect(resized).toEqual({ kind: "unchanged", refusal: STUDIO_SELECTION_RESIZE_REFUSED_MESSAGE });

    const idle = planStudioSelectionTransformCommit({
      elements: locked,
      selectedIds: ["image", "draw"],
      sourceBounds: SOURCE,
      targetBounds: SOURCE,
      rotationDeg: 0,
      isLocked: unlocked,
    });
    expect(idle).toEqual({ kind: "unchanged", refusal: null });
  });

  it("sends a locked sole stroke to the group planner, which refuses it", () => {
    const stroke = { ...draw(), locked: true } as El;
    const plan = planStudioSelectionTransformCommit({
      elements: [stroke],
      selectedIds: [stroke.id],
      sourceBounds: SOURCE,
      targetBounds: DOUBLE,
      rotationDeg: 0,
      isLocked: unlocked,
    });
    expect(plan).toEqual({ kind: "unchanged", refusal: STUDIO_SELECTION_RESIZE_REFUSED_MESSAGE });
  });
});

describe("describeStudioSelectionTransform", () => {
  it("picks the wording from what the gesture actually changed", () => {
    expect(describeStudioSelectionTransform(1, SOURCE, DOUBLE, 0)).toBe("레이어 크기 조절 · 200%");
    expect(describeStudioSelectionTransform(3, SOURCE, SOURCE, -30)).toBe("그룹 회전 · -30°");
    expect(describeStudioSelectionTransform(3, SOURCE, { ...SOURCE, width: 50 }, 12.4)).toBe(
      "그룹 크기 조절 · 50% · 회전 12°"
    );
    // A sub-degree angle rounds to zero and reads as the resize it visually is.
    expect(describeStudioSelectionTransform(2, SOURCE, DOUBLE, 0.2)).toBe("그룹 크기 조절 · 200%");
    // A vanishing width never announces 0%.
    expect(describeStudioSelectionTransform(1, SOURCE, { ...SOURCE, width: 0.1 }, 0)).toBe(
      "레이어 크기 조절 · 1%"
    );
  });
});
