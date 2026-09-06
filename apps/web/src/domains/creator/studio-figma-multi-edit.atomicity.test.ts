import { describe, expect, it } from "vitest";

import { planStudioFigmaMultiEdit } from "./studio-figma-multi-edit";

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
  } as FrameEl;
}

const unlocked = () => false;

describe("studio figma multi-edit atomic boundaries", () => {
  it("refuses shared opacity before an otherwise valid geometry move can become partial", () => {
    const panel = frame();
    const picture = image({
      id: "image",
      x: 160,
      y: 0,
      width: 40,
      height: 40,
      opacity: 0.8,
    });
    const plan = planStudioFigmaMultiEdit({
      elements: [panel, picture],
      selectedIds: [panel.id, picture.id],
      patch: { x: 40, opacity: 0.5 },
      isLocked: unlocked,
    });

    expect(plan).toEqual({
      kind: "unchanged",
      reason: "프레임이 포함된 선택에는 불투명도를 함께 적용할 수 없어요.",
    });
    expect(panel.x).toBe(0);
    expect(picture).toMatchObject({ x: 160, opacity: 0.8 });
  });

  it("refuses a stale selection snapshot rather than editing only the remaining ids", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b", "removed"],
      patch: { width: 200 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.reason).toContain("선택 정보가 바뀌었어요");
  });

  it("fails closed for non-finite numeric input", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { rotation: Number.NaN },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.reason).toContain("유효한 각도");
  });

  it("fails closed when the selected union has no usable extent", () => {
    const first = image({ id: "a", x: 20, y: 20, width: 0, height: 0 });
    const second = image({ id: "b", x: 20, y: 20, width: 0, height: 0 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { x: 40 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("unchanged");
    if (plan.kind === "unchanged") expect(plan.reason).toContain("크기를 계산할 수 없어요");
  });
});
