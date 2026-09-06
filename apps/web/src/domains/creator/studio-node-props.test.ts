/**
 * Soft-lock interaction guards on shared Konva node props.
 * Exercises the real attach path used by image/frame/text nodes.
 */
import { describe, expect, it, vi } from "vitest";

import { resizableNodeProps, textNodeProps } from "./studio-node-props";

function fakeTarget(overrides: Record<string, unknown> = {}) {
  return {
    x: () => 10,
    y: () => 20,
    width: () => 100,
    height: () => 80,
    scaleX: () => 1,
    scaleY: () => 1,
    rotation: () => 0,
    stopDrag: vi.fn(),
    ...overrides,
  };
}

describe("studio-node-props soft-lock guards", () => {
  it("resizableNodeProps stops drag when onInteractionBegin denies", () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const onInteractionBegin = vi.fn(() => false);
    const onInteractionEnd = vi.fn();
    const props = resizableNodeProps({
      draggable: true,
      onSelect,
      onChange,
      onInteractionBegin,
      onInteractionEnd,
    }) as {
      onDragStart: (e: { target: ReturnType<typeof fakeTarget> }) => void;
      onDragEnd: (e: { target: ReturnType<typeof fakeTarget> }) => void;
    };
    const target = fakeTarget();
    props.onDragStart({ target });
    expect(onInteractionBegin).toHaveBeenCalledTimes(1);
    expect(target.stopDrag).toHaveBeenCalledTimes(1);

    props.onDragEnd({ target });
    expect(onChange).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("resizableNodeProps allows drag when begin succeeds and ends release", () => {
    const onChange = vi.fn();
    const onInteractionBegin = vi.fn(() => true);
    const onInteractionEnd = vi.fn();
    const props = resizableNodeProps({
      draggable: true,
      onSelect: vi.fn(),
      onChange,
      onInteractionBegin,
      onInteractionEnd,
    }) as {
      onDragStart: (e: { target: ReturnType<typeof fakeTarget> }) => void;
      onDragEnd: (e: { target: ReturnType<typeof fakeTarget> }) => void;
      onTransformEnd: (e: { target: ReturnType<typeof fakeTarget> }) => void;
    };
    const target = fakeTarget({
      scaleX: () => 2,
      scaleY: () => 2,
      width: () => 50,
      height: () => 40,
      rotation: () => 15,
    });
    props.onDragStart({ target });
    expect(target.stopDrag).not.toHaveBeenCalled();
    props.onTransformEnd({ target });
    expect(onChange).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      rotation: 15,
    });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("textNodeProps denies drag start and still releases on drag end", () => {
    const onPatch = vi.fn();
    const onEdit = vi.fn();
    const onInteractionBegin = vi.fn(() => false);
    const onInteractionEnd = vi.fn();
    const props = textNodeProps({
      id: "t1",
      draggable: true,
      onSelect: vi.fn(),
      onEdit,
      onPatch,
      onInteractionBegin,
      onInteractionEnd,
    }) as {
      onDragStart: (e: { target: ReturnType<typeof fakeTarget> }) => void;
      onDragEnd: (e: { target: ReturnType<typeof fakeTarget> }) => void;
      onDblClick: () => void;
    };
    const target = fakeTarget();
    props.onDragStart({ target });
    expect(target.stopDrag).toHaveBeenCalled();
    props.onDragEnd({ target });
    expect(onPatch).toHaveBeenCalledWith("t1", { x: 10, y: 20 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
    props.onDblClick();
    expect(onEdit).toHaveBeenCalledWith("t1");
  });
});
