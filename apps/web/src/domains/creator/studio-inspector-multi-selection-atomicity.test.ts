import { describe, expect, it } from "vitest";

import { planStudioInspectorMultiSelectionLayoutPatch } from "./studio-inspector-multi-selection";

import type { FrameEl, ImageEl } from "./studio-element-model";

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

function frame(id = "frame"): FrameEl {
  return {
    id,
    type: "frame",
    x: 0,
    y: 0,
    width: 120,
    height: 80,
  };
}

describe("Inspector multi-selection atomic boundaries", () => {
  it("refuses shared opacity when a frame would make the patch partial", () => {
    const panel = frame();
    const picture = image({ id: "image", x: 160, y: 0, width: 40, height: 40, opacity: 0.8 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [panel, picture],
      [panel.id, picture.id],
      { x: 40, opacity: 0.5 },
    );

    expect(plan).toEqual({
      kind: "unchanged",
      refusal: "프레임이 포함된 선택에는 불투명도를 함께 적용할 수 없어요.",
    });
    expect(panel.x).toBe(0);
    expect(picture).toMatchObject({ x: 160, opacity: 0.8 });
  });

  it("refuses a stale selection snapshot rather than editing only the remaining ids", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [first, second],
      ["a", "b", "removed"],
      { width: 200 },
    );

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.refusal).toContain("선택 정보가 바뀌었어요");
  });

  it("fails closed for non-finite numeric input", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [first, second],
      ["a", "b"],
      { rotation: Number.NaN },
    );

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.refusal).toContain("유효한 각도");
  });

  it("keeps unselected object references when a valid patch succeeds", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const outside = image({ id: "outside", x: 400, y: 400, width: 40, height: 40 });
    const plan = planStudioInspectorMultiSelectionLayoutPatch(
      [first, second, outside],
      ["a", "b"],
      { x: 20 },
    );

    expect(plan.kind).toBe("changed");
    if (plan.kind === "changed") {
      expect(plan.next.find((element) => element.id === "outside")).toBe(outside);
    }
  });
});
