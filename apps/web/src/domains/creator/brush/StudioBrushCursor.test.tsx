// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioBrushCursor } from "./StudioBrushCursor";

import type { ReactNode } from "react";

const capture = vi.hoisted(() => ({
  circles: [] as Record<string, unknown>[],
  ellipses: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  layers: [] as Record<string, unknown>[],
  lines: [] as Record<string, unknown>[],
  rects: [] as Record<string, unknown>[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement, forwardRef } = await import("react");
  const container = (target: Record<string, unknown>[]) => {
    const Component = forwardRef<
      unknown,
      Record<string, unknown> & { children?: ReactNode }
    >((props, ref) => {
      target.push({ ...props, ref });
      return createElement(Fragment, null, props.children as ReactNode);
    });
    return Component;
  };
  const primitive = (target: Record<string, unknown>[]) => {
    const Component = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
      target.push({ ...props, ref });
      return null;
    });
    return Component;
  };
  return {
    Circle: primitive(capture.circles),
    Ellipse: primitive(capture.ellipses),
    Group: container(capture.groups),
    Layer: container(capture.layers),
    Line: primitive(capture.lines),
    Rect: primitive(capture.rects),
  };
});

beforeEach(() => {
  for (const values of Object.values(capture)) values.length = 0;
});

afterEach(cleanup);

describe("StudioBrushCursor", () => {
  it("keeps the stroke guide available without synthesizing a hidden-style cursor", () => {
    render(
      <StudioBrushCursor
        cursorRef={{ current: null }}
        guideRef={{ current: null }}
        brushId="g-pen"
        diameter={2}
        effectiveScale={2}
        mode="pen"
        style="none"
        tipAngleDeg={-30}
        tipRoundness={0.3}
      />,
    );

    expect(capture.layers).toHaveLength(1);
    expect(capture.layers[0]).toMatchObject({
      listening: false,
      name: "studio-brush-cursor-layer",
    });
    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0]).toMatchObject({
      dash: [4, 3],
      listening: false,
      name: "studio-stroke-guide",
      perfectDrawEnabled: false,
      points: [0, 0, 0, 0],
      visible: false,
    });
    expect(capture.groups).toHaveLength(1);
    expect(capture.groups[0]).toMatchObject({
      listening: false,
      visible: false,
    });
    expect(capture.circles).toHaveLength(0);
    expect(capture.ellipses).toHaveLength(0);
    expect(capture.rects).toHaveLength(0);
  });

  it("does not mount the guide primitive when no guide ref is supplied", () => {
    render(
      <StudioBrushCursor
        cursorRef={{ current: null }}
        brushId="g-pen"
        diameter={20}
        effectiveScale={1}
        mode="pen"
        style="outline"
        tipAngleDeg={-30}
        tipRoundness={0.3}
      />,
    );

    expect(capture.lines).toHaveLength(0);
    expect(capture.ellipses.length + capture.rects.length).toBeGreaterThan(0);
  });
});
