import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createStudioBottomSheetGestureController,
  type StudioBottomSheetClickEvent,
  type StudioBottomSheetGestureHandle,
  type StudioBottomSheetPointerEvent,
} from "./useStudioBottomSheetGesture";

class SheetStyle {
  transform = "";
  transition = "";
  willChange = "";
}

function fixture(
  reducedMotion = false,
  interactions: {
    onActivate?: () => void;
    onCollapse?: () => void;
    onExpand?: () => void;
  } = {},
) {
  const style = new SheetStyle();
  const sheet = {
    ownerDocument: {
      defaultView: {
        matchMedia: vi.fn(() => ({ matches: reducedMotion })),
      },
    },
    style,
  } as unknown as HTMLElement;
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  const handle: StudioBottomSheetGestureHandle = {
    releasePointerCapture,
    setPointerCapture,
  };
  const onDismiss = vi.fn();
  const controller = createStudioBottomSheetGestureController({
    ...interactions,
    onDismiss,
    sheet,
  });
  return {
    controller,
    handle,
    onDismiss,
    releasePointerCapture,
    setPointerCapture,
    style,
  };
}

function pointerEvent(
  handle: StudioBottomSheetGestureHandle,
  overrides: Partial<
    Omit<StudioBottomSheetPointerEvent, "currentTarget" | "preventDefault">
  > = {},
): StudioBottomSheetPointerEvent & { preventDefault: Mock<() => void> } {
  return {
    button: 0,
    clientY: 100,
    currentTarget: handle,
    isPrimary: true,
    pointerId: 7,
    preventDefault: vi.fn<() => void>(),
    timeStamp: 100,
    ...overrides,
  };
}

function clickEvent(): StudioBottomSheetClickEvent & {
  preventDefault: Mock<() => void>;
  stopPropagation: Mock<() => void>;
} {
  return {
    preventDefault: vi.fn<() => void>(),
    stopPropagation: vi.fn<() => void>(),
  };
}

describe("createStudioBottomSheetGestureController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures a primary pointer and writes only a clamped compositor transform while moving", () => {
    const { controller, handle, setPointerCapture, style } = fixture();
    const down = pointerEvent(handle);

    controller.handlePointerDown(down);
    controller.handlePointerMove(pointerEvent(handle, { clientY: 147, timeStamp: 140 }));

    expect(setPointerCapture).toHaveBeenCalledOnce();
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(style.transition).toBe("none");
    expect(style.willChange).toBe("transform");
    expect(style.transform).toBe("translate3d(0, 47.00px, 0)");

    controller.handlePointerMove(pointerEvent(handle, { clientY: 72, timeStamp: 160 }));
    expect(style.transform).toBe("translate3d(0, 0.00px, 0)");
  });

  it("ignores non-primary, secondary-button, mismatched, and uncapturable pointers", () => {
    const { controller, handle, onDismiss, setPointerCapture, style } = fixture();
    controller.handlePointerDown(pointerEvent(handle, { isPrimary: false }));
    controller.handlePointerDown(pointerEvent(handle, { button: 2 }));
    expect(setPointerCapture).not.toHaveBeenCalled();

    setPointerCapture.mockImplementationOnce(() => {
      throw new Error("capture unavailable");
    });
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerMove(pointerEvent(handle, { clientY: 220 }));
    controller.handlePointerUp(pointerEvent(handle, { clientY: 220 }));
    expect(style.transform).toBe("");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses exactly once after the distance threshold and consumes the synthesized click", () => {
    const { controller, handle, onDismiss, releasePointerCapture } = fixture();
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerMove(pointerEvent(handle, { clientY: 192, timeStamp: 240 }));
    controller.handlePointerUp(pointerEvent(handle, { clientY: 192, timeStamp: 260 }));
    const click = clickEvent();
    controller.handleClick(click);

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
  });

  it("also dismisses a short fast downward flick above drag slop", () => {
    const { controller, handle, onDismiss } = fixture();
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerMove(pointerEvent(handle, { clientY: 122, timeStamp: 120 }));
    controller.handlePointerUp(pointerEvent(handle, { clientY: 122, timeStamp: 125 }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("steps one snap upward or downward without treating resize as dismissal", () => {
    const onExpand = vi.fn();
    const upward = fixture(false, { onExpand });
    upward.controller.handlePointerDown(pointerEvent(upward.handle));
    upward.controller.handlePointerMove(
      pointerEvent(upward.handle, { clientY: 8, timeStamp: 220 }),
    );
    expect(upward.style.transform).toBe("translate3d(0, -92.00px, 0)");
    upward.controller.handlePointerUp(
      pointerEvent(upward.handle, { clientY: 8, timeStamp: 240 }),
    );
    expect(onExpand).toHaveBeenCalledOnce();
    expect(upward.onDismiss).not.toHaveBeenCalled();

    const onCollapse = vi.fn();
    const downward = fixture(false, { onCollapse });
    downward.controller.handlePointerDown(pointerEvent(downward.handle));
    downward.controller.handlePointerMove(
      pointerEvent(downward.handle, { clientY: 192, timeStamp: 220 }),
    );
    downward.controller.handlePointerUp(
      pointerEvent(downward.handle, { clientY: 192, timeStamp: 240 }),
    );
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(downward.onDismiss).not.toHaveBeenCalled();
  });

  it("routes semantic handle activation to resize when a snap contract is present", () => {
    const onActivate = vi.fn();
    const { controller, onDismiss } = fixture(false, { onActivate });
    controller.handleClick(clickEvent());
    controller.handleClick(clickEvent());
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("restores a sub-threshold drag and suppresses only its next synthesized click", () => {
    const { controller, handle, onDismiss, style } = fixture();
    style.transform = "scale(0.99)";
    style.transition = "opacity 80ms linear";
    style.willChange = "opacity";
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerMove(pointerEvent(handle, { clientY: 125, timeStamp: 260 }));
    controller.handlePointerUp(pointerEvent(handle, { clientY: 125, timeStamp: 500 }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(style.transform).toBe("scale(0.99)");
    expect(style.transition).toContain("transform 180ms");
    const synthesizedClick = clickEvent();
    controller.handleClick(synthesizedClick);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(synthesizedClick.preventDefault).toHaveBeenCalledOnce();

    vi.runAllTimers();
    expect(style.transform).toBe("scale(0.99)");
    expect(style.transition).toBe("opacity 80ms linear");
    expect(style.willChange).toBe("opacity");

    controller.handleClick(clickEvent());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("lets an undragged semantic-button tap dismiss the sheet", () => {
    const { controller, handle, onDismiss } = fixture();
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerUp(pointerEvent(handle, { clientY: 103, timeStamp: 180 }));
    controller.handleClick(clickEvent());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("snaps upward and cancelled drags back without dismissing", () => {
    const { controller, handle, onDismiss, style } = fixture(true);
    controller.handlePointerDown(pointerEvent(handle));
    controller.handlePointerMove(pointerEvent(handle, { clientY: 40, timeStamp: 150 }));
    expect(style.transform).toBe("translate3d(0, 0.00px, 0)");
    controller.handlePointerCancel(pointerEvent(handle, { clientY: 40, timeStamp: 160 }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(style.transform).toBe("");
    expect(style.transition).toBe("");
    expect(style.willChange).toBe("");

    controller.handleClick(clickEvent());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("restores exact inline styles when capture is lost or the controller is disposed", () => {
    const first = fixture(true);
    first.style.transform = "rotate(1deg)";
    first.style.transition = "opacity 20ms linear";
    first.style.willChange = "opacity";
    first.controller.handlePointerDown(pointerEvent(first.handle));
    first.controller.handlePointerMove(pointerEvent(first.handle, { clientY: 130 }));
    first.controller.handleLostPointerCapture({ pointerId: 7 });
    expect(first.style).toMatchObject({
      transform: "rotate(1deg)",
      transition: "opacity 20ms linear",
      willChange: "opacity",
    });
    first.controller.handleClick(clickEvent());
    expect(first.onDismiss).toHaveBeenCalledOnce();

    const second = fixture();
    second.controller.handlePointerDown(pointerEvent(second.handle));
    second.controller.handlePointerMove(pointerEvent(second.handle, { clientY: 145 }));
    second.controller.dispose();
    expect(second.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(second.style).toMatchObject({ transform: "", transition: "", willChange: "" });
    second.controller.handlePointerUp(pointerEvent(second.handle, { clientY: 240 }));
    second.controller.handleClick(clickEvent());
    expect(second.onDismiss).not.toHaveBeenCalled();
  });
});
