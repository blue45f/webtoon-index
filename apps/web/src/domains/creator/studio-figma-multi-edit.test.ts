import { describe, expect, it } from "vitest";

import { planStudioFigmaMultiEdit } from "./studio-figma-multi-edit";

import type { El, ImageEl } from "./studio-element-model";

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

function elementById(elements: readonly El[], id: string): El {
  const element = elements.find((candidate) => candidate.id === id);
  if (!element) throw new Error(`Missing element ${id}`);
  return element;
}

const unlocked = () => false;

describe("studio figma multi-edit", () => {
  it("moves a selection union without collapsing the spacing between members", () => {
    const first = image({ id: "a", x: 0, y: 10, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 30, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { x: 40, y: 50 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(elementById(plan.next, "a")).toMatchObject({ x: 40, y: 50 });
    expect(elementById(plan.next, "b")).toMatchObject({ x: 120, y: 70 });
    expect(plan.announcement).toContain("이동");
  });

  it("uses a typed width as one uniform group scale", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const untouched = image({ id: "outside", x: 500, y: 500, width: 10, height: 10 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second, untouched],
      selectedIds: ["a", "b"],
      patch: { width: 200 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(elementById(plan.next, "a")).toMatchObject({ x: 0, y: 0, width: 40, height: 40 });
    expect(elementById(plan.next, "b")).toMatchObject({ x: 160, y: 0, width: 40, height: 40 });
    expect(elementById(plan.next, "outside")).toBe(untouched);
    expect(plan.announcement).toContain("크기 200%");
  });

  it("uses a typed height as one uniform group scale", () => {
    const first = image({ id: "a", x: 10, y: 20, width: 30, height: 20 });
    const second = image({ id: "b", x: 70, y: 20, width: 30, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { height: 40 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(elementById(plan.next, "a")).toMatchObject({ x: 10, y: 20, width: 60, height: 40 });
    expect(elementById(plan.next, "b")).toMatchObject({ x: 130, y: 20, width: 60, height: 40 });
  });

  it("turns the selection as one rigid body around its centre", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { rotation: 180 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    // Box elements store their rotated top-left origin. Their visual boxes exchange places.
    const turnedFirst = elementById(plan.next, "a") as ImageEl;
    const turnedSecond = elementById(plan.next, "b") as ImageEl;
    expect(turnedFirst.x).toBeCloseTo(100, 9);
    expect(turnedFirst.y).toBeCloseTo(20, 9);
    expect(turnedFirst.rotation).toBeCloseTo(180, 9);
    expect(turnedSecond.x).toBeCloseTo(20, 9);
    expect(turnedSecond.y).toBeCloseTo(20, 9);
    expect(turnedSecond.rotation).toBeCloseTo(180, 9);
    expect(plan.announcement).toContain("회전 180°");
  });

  it("keeps geometry and a shared opacity in the same atomic result", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20, opacity: 0.25 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20, opacity: 0.75 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { width: 200, opacity: 0.6 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("changed");
    if (plan.kind !== "changed") return;
    expect(elementById(plan.next, "a")).toMatchObject({ width: 40, opacity: 0.6 });
    expect(elementById(plan.next, "b")).toMatchObject({ x: 160, width: 40, opacity: 0.6 });
    expect(plan.announcement).toContain("불투명도 60%");
  });

  it("refuses width and height that would tear the selection ratio", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { width: 200, height: 30 },
      isLocked: unlocked,
    });

    expect(plan).toEqual({
      kind: "unchanged",
      reason: "여러 요소의 너비와 높이는 비율을 유지해야 해요. 한쪽 값만 입력해 주세요.",
    });
  });

  it("refuses the whole edit when a selected member is locked", () => {
    const first = image({ id: "a", x: 0, y: 0, width: 20, height: 20 });
    const second = image({ id: "b", x: 80, y: 0, width: 20, height: 20 });
    const plan = planStudioFigmaMultiEdit({
      elements: [first, second],
      selectedIds: ["a", "b"],
      patch: { x: 40, opacity: 0.5 },
      isLocked: (element) => element.id === "b",
    });

    expect(plan.kind).toBe("unchanged");
    if (plan.kind !== "unchanged") return;
    expect(plan.reason).toContain("잠긴 레이어");
  });

  it("refuses group rotation when one member cannot carry an angle", () => {
    const imageElement = image({ id: "image", x: 0, y: 0, width: 20, height: 20 });
    const frame = {
      id: "frame",
      type: "frame",
      x: 40,
      y: 0,
      width: 20,
      height: 20,
    } as unknown as El;
    const plan = planStudioFigmaMultiEdit({
      elements: [imageElement, frame],
      selectedIds: ["image", "frame"],
      patch: { rotation: 15, opacity: 0.5 },
      isLocked: unlocked,
    });

    expect(plan.kind).toBe("unchanged");
    if (plan.kind !== "unchanged") return;
    // The transform refusal is atomic: the otherwise valid image opacity is not returned either.
    expect(plan.reason).toContain("회전할 수 없는 요소");
  });

  it("refuses shared opacity when the selection contains a frame", () => {
    const imageElement = image({ id: "image", x: 0, y: 0, width: 20, height: 20 });
    const frame = {
      id: "frame",
      type: "frame",
      x: 40,
      y: 0,
      width: 20,
      height: 20,
    } as unknown as El;
    const plan = planStudioFigmaMultiEdit({
      elements: [imageElement, frame],
      selectedIds: ["image", "frame"],
      patch: { opacity: 0.5 },
      isLocked: unlocked,
    });

    expect(plan).toEqual({
      kind: "unchanged",
      reason: "프레임이 포함된 선택에는 불투명도를 함께 적용할 수 없어요.",
    });
  });
});
