// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioIsometricGridOverlay } from "./StudioIsometricGridOverlay";

type CapturedCircleProps = {
  name?: string;
  x?: number;
  y?: number;
  radius?: number;
  hitStrokeWidth?: number;
  draggable?: boolean;
  listening?: boolean;
  onDragMove?: (event: DragEventStub) => void;
  onDragEnd?: (event: DragEventStub) => void;
  onPointerCancel?: () => void;
  onPointerDown?: (event: PointerEventStub) => void;
};

type CapturedLineProps = {
  points?: number[];
};

type DragEventStub = {
  target: {
    x: () => number;
    y: () => number;
  };
  evt: { type: string };
};

type PointerEventStub = { cancelBubble: boolean };

const konvaCapture = vi.hoisted(() => ({
  circles: [] as CapturedCircleProps[],
  lines: [] as CapturedLineProps[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement } = await import("react");
  return {
    Circle: (props: Record<string, unknown>) => {
      konvaCapture.circles.push(props as CapturedCircleProps);
      return null;
    },
    Group: ({ children }: { children?: import("react").ReactNode }) => createElement(Fragment, null, children),
    Line: (props: Record<string, unknown>) => {
      konvaCapture.lines.push(props as CapturedLineProps);
      return null;
    },
  };
});

function dragEvent(x: number, y: number, type = "mousemove"): DragEventStub {
  return {
    target: { x: () => x, y: () => y },
    evt: { type },
  };
}

function latestHandle(): CapturedCircleProps {
  const handle = konvaCapture.circles.findLast((circle) => circle.name === "isometric-origin-handle");
  if (!handle) throw new Error("Isometric origin handle was not rendered");
  return handle;
}

beforeEach(() => {
  konvaCapture.circles.length = 0;
  konvaCapture.lines.length = 0;
});

afterEach(cleanup);

describe("StudioIsometricGridOverlay drag transaction", () => {
  it("previews the grid locally and commits only the drag-end origin once", () => {
    const onPreviewOrigin = vi.fn();
    const onCommitOrigin = vi.fn();

    render(
      <StudioIsometricGridOverlay
        config={{ angleDeg: 30, cellSize: 40, originX: 100, originY: 80 }}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onPreviewOrigin={onPreviewOrigin}
        onCommitOrigin={onCommitOrigin}
      />
    );

    expect(latestHandle()).toMatchObject({ x: 100, y: 80 });

    let handle = latestHandle();
    konvaCapture.circles.length = 0;
    konvaCapture.lines.length = 0;
    act(() => handle.onDragMove?.(dragEvent(140, -15)));

    expect(onPreviewOrigin).toHaveBeenLastCalledWith(140, -15);
    expect(onCommitOrigin).not.toHaveBeenCalled();
    expect(latestHandle()).toMatchObject({ x: 140, y: -15 });
    // 각 축의 k=0 기준선은 원점을 중심으로 뻗으므로 새 원점을 중점으로 갖는 선이 있다.
    expect(konvaCapture.lines.some(({ points }) => (
      points !== undefined
      && Math.abs((points[0]! + points[2]!) / 2 - 140) < 1e-8
      && Math.abs((points[1]! + points[3]!) / 2 + 15) < 1e-8
    ))).toBe(true);

    handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(155, -25)));
    expect(onPreviewOrigin).toHaveBeenCalledTimes(2);
    expect(onCommitOrigin).not.toHaveBeenCalled();

    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(158, -27, "mouseup")));
    expect(onCommitOrigin).toHaveBeenCalledTimes(1);
    expect(onCommitOrigin).toHaveBeenCalledWith(158, -27);
  });

  it("treats Konva's touchcancel-flavoured dragend as rollback", () => {
    const onCancelOrigin = vi.fn();
    const onCommitOrigin = vi.fn();

    render(
      <StudioIsometricGridOverlay
        config={{ angleDeg: 30, cellSize: 40, originX: 100, originY: 80 }}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onCommitOrigin={onCommitOrigin}
        onCancelOrigin={onCancelOrigin}
      />
    );

    let handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(140, 120)));
    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(140, 120, "touchcancel")));

    expect(onCancelOrigin).toHaveBeenCalledTimes(1);
    expect(onCommitOrigin).not.toHaveBeenCalled();
    expect(latestHandle()).toMatchObject({ x: 100, y: 80 });
  });

  it("rolls a direct pointer cancellation back without a later commit", () => {
    const onCancelOrigin = vi.fn();
    const onCommitOrigin = vi.fn();
    render(
      <StudioIsometricGridOverlay
        config={{ angleDeg: 30, cellSize: 40, originX: 100, originY: 80 }}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onCommitOrigin={onCommitOrigin}
        onCancelOrigin={onCancelOrigin}
      />
    );

    let handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(140, 120)));
    handle = latestHandle();
    act(() => handle.onPointerCancel?.());
    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(140, 120, "pointerup")));

    expect(onCancelOrigin).toHaveBeenCalledOnce();
    expect(onCommitOrigin).not.toHaveBeenCalled();
    expect(latestHandle()).toMatchObject({ x: 100, y: 80 });
  });

  it("uses a zoom-invariant 44px hit target and consumes pointerdown before Stage drawing", () => {
    render(
      <StudioIsometricGridOverlay
        config={{ angleDeg: 30, cellSize: 40, originX: 100, originY: 80 }}
        canvasWidth={300}
        canvasHeight={200}
        effScale={2}
        onCommitOrigin={vi.fn()}
      />
    );
    const handle = latestHandle();
    const event: PointerEventStub = { cancelBubble: false };
    handle.onPointerDown?.(event);

    expect(event.cancelBubble).toBe(true);
    expect(((handle.radius ?? 0) * 2 + (handle.hitStrokeWidth ?? 0)) * 2).toBe(44);
    expect(handle.draggable).toBe(true);
    expect(handle.listening).toBe(true);
  });

  it("makes a disabled handle non-listening and refuses preview or commit callbacks", () => {
    const onPreviewOrigin = vi.fn();
    const onCommitOrigin = vi.fn();
    render(
      <StudioIsometricGridOverlay
        config={{ angleDeg: 30, cellSize: 40, originX: 100, originY: 80 }}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        disabled
        onPreviewOrigin={onPreviewOrigin}
        onCommitOrigin={onCommitOrigin}
      />
    );
    const handle = latestHandle();

    expect(handle.draggable).toBe(false);
    expect(handle.listening).toBe(false);
    act(() => handle.onDragMove?.(dragEvent(140, 120)));
    act(() => handle.onDragEnd?.(dragEvent(140, 120, "mouseup")));
    expect(onPreviewOrigin).not.toHaveBeenCalled();
    expect(onCommitOrigin).not.toHaveBeenCalled();
  });
});
