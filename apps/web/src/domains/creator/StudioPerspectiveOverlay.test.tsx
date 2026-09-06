// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioPerspectiveOverlay } from "./StudioPerspectiveOverlay";

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
  const handle = konvaCapture.circles.findLast((circle) => circle.name === "vp-handle");
  if (!handle) throw new Error("Perspective handle was not rendered");
  return handle;
}

beforeEach(() => {
  konvaCapture.circles.length = 0;
  konvaCapture.lines.length = 0;
});

afterEach(cleanup);

describe("StudioPerspectiveOverlay drag transaction", () => {
  it("previews every drag position locally and commits only the drag-end coordinate once", () => {
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();

    render(
      <StudioPerspectiveOverlay
        points={[{ id: "vp-1", x: 40, y: 50 }]}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onPreviewPoint={onPreviewPoint}
        onCommitPoint={onCommitPoint}
      />
    );

    expect(latestHandle()).toMatchObject({ x: 40, y: 50 });

    let handle = latestHandle();
    konvaCapture.circles.length = 0;
    konvaCapture.lines.length = 0;
    act(() => handle.onDragMove?.(dragEvent(75, -20)));

    expect(onPreviewPoint).toHaveBeenLastCalledWith("vp-1", 75, -20);
    expect(onCommitPoint).not.toHaveBeenCalled();
    expect(latestHandle()).toMatchObject({ x: 75, y: -20 });
    // 모든 fan ray는 소실점을 중심으로 양방향 대칭이므로 중점이 미리보기 좌표다.
    const previewRay = konvaCapture.lines.at(-1)?.points;
    expect(previewRay).toBeDefined();
    expect(((previewRay?.[0] ?? 0) + (previewRay?.[2] ?? 0)) / 2).toBeCloseTo(75);
    expect(((previewRay?.[1] ?? 0) + (previewRay?.[3] ?? 0)) / 2).toBeCloseTo(-20);

    handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(90, -35)));
    expect(onPreviewPoint).toHaveBeenCalledTimes(2);
    expect(onCommitPoint).not.toHaveBeenCalled();

    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(92, -36, "mouseup")));
    expect(onCommitPoint).toHaveBeenCalledTimes(1);
    expect(onCommitPoint).toHaveBeenCalledWith("vp-1", 92, -36);
  });

  it("rolls back a pointer-cancelled preview without committing", () => {
    const onCancelPoint = vi.fn();
    const onCommitPoint = vi.fn();

    render(
      <StudioPerspectiveOverlay
        points={[{ id: "vp-1", x: 40, y: 50 }]}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onCommitPoint={onCommitPoint}
        onCancelPoint={onCancelPoint}
      />
    );

    let handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(80, 90)));
    handle = latestHandle();
    act(() => handle.onPointerCancel?.());
    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(80, 90, "pointerup")));

    expect(onCancelPoint).toHaveBeenCalledTimes(1);
    expect(onCancelPoint).toHaveBeenCalledWith("vp-1");
    expect(onCommitPoint).not.toHaveBeenCalled();
    expect(latestHandle()).toMatchObject({ x: 40, y: 50 });
  });

  it("keeps the legacy move callback working until the StudioPage migration is complete", () => {
    const onMovePoint = vi.fn();

    render(
      <StudioPerspectiveOverlay
        points={[{ id: "vp-1", x: 40, y: 50 }]}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        onMovePoint={onMovePoint}
      />
    );

    let handle = latestHandle();
    act(() => handle.onDragMove?.(dragEvent(60, 70)));
    handle = latestHandle();
    act(() => handle.onDragEnd?.(dragEvent(60, 70, "mouseup")));

    expect(onMovePoint).toHaveBeenCalledTimes(1);
    expect(onMovePoint).toHaveBeenCalledWith("vp-1", 60, 70);
  });

  it("uses a zoom-invariant 44px hit target and consumes pointerdown before Stage drawing", () => {
    render(
      <StudioPerspectiveOverlay
        points={[{ id: "vp-1", x: 40, y: 50 }]}
        canvasWidth={300}
        canvasHeight={200}
        effScale={2}
        onCommitPoint={vi.fn()}
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
    const onPreviewPoint = vi.fn();
    const onCommitPoint = vi.fn();
    render(
      <StudioPerspectiveOverlay
        points={[{ id: "vp-1", x: 40, y: 50 }]}
        canvasWidth={300}
        canvasHeight={200}
        effScale={1}
        disabled
        onPreviewPoint={onPreviewPoint}
        onCommitPoint={onCommitPoint}
      />
    );
    const handle = latestHandle();

    expect(handle.draggable).toBe(false);
    expect(handle.listening).toBe(false);
    act(() => handle.onDragMove?.(dragEvent(80, 90)));
    act(() => handle.onDragEnd?.(dragEvent(80, 90, "mouseup")));
    expect(onPreviewPoint).not.toHaveBeenCalled();
    expect(onCommitPoint).not.toHaveBeenCalled();
  });
});
