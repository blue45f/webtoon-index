// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioLiveTransformDraftStore } from "./studio-live-transform-draft-store";
import { StudioLiveTransformDraftNode } from "./StudioLiveTransformDraftNode";

import type { DrawEl } from "./studio-element-model";

const harness = vi.hoisted(() => ({
  drawProps: null as Record<string, unknown> | null,
  drawnEls: [] as Record<string, unknown>[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const React = await import("react");
  return {
    Group: ({
      children,
      name,
      clipX,
      clipY,
      clipWidth,
      clipHeight,
    }: {
      children?: React.ReactNode;
      name?: string;
      clipX?: number;
      clipY?: number;
      clipWidth?: number;
      clipHeight?: number;
    }) =>
      React.createElement(
        "div",
        {
          "data-testid": name ?? "group",
          "data-clip": clipWidth === undefined
            ? "none"
            : `${clipX},${clipY},${clipWidth},${clipHeight}`,
        },
        children,
      ),
  };
});

vi.mock("./brush/StudioDrawNode", async () => {
  const React = await import("react");
  return {
    StudioDrawNode: (props: Record<string, unknown>) => {
      harness.drawProps = props;
      harness.drawnEls.push(props);
      return React.createElement("div", {
        "data-testid": "transform-draft-draw",
        "data-element-id": (props.el as { id?: string } | undefined)?.id ?? "",
      });
    },
  };
});

afterEach(() => {
  cleanup();
  harness.drawProps = null;
  harness.drawnEls = [];
});

describe("StudioLiveTransformDraftNode", () => {
  it("keeps a pixel-empty root mounted and renders candidates with settled, identity-free semantics", () => {
    const store = createStudioLiveTransformDraftStore();
    const scope = "page:page-1";
    render(<StudioLiveTransformDraftNode store={store} scope={scope} />);
    expect(screen.getByTestId("studio-live-transform-draft-root")).not.toBeNull();
    expect(screen.queryByTestId("transform-draft-draw")).toBeNull();

    const element = {
      id: "stroke",
      type: "draw",
      kind: "line",
      points: [0, 0, 20, 10],
      stroke: "#000",
      strokeWidth: 4,
    } as DrawEl;
    const claim = store.claim(scope, [element.id]);
    act(() => {
      claim?.present([{
        element,
        clip: { x: 1, y: 2, width: 30, height: 40 },
      }]);
    });

    expect(screen.getByTestId("transform-draft-draw")).not.toBeNull();
    expect(harness.drawProps).toMatchObject({
      el: element,
      exposeSceneIdentity: false,
      renderPurpose: "transform-draft",
    });

    act(() => claim?.release());
    expect(screen.getByTestId("studio-live-transform-draft-root")).not.toBeNull();
    expect(screen.queryByTestId("transform-draft-draw")).toBeNull();
  });

  it("draws every claimed member and clips each inside the panel that owns it", () => {
    // A multi-selection can straddle panels. One clip on the shared root would let the stroke from
    // the left panel paint over the right one for the whole gesture and snap back at release.
    const store = createStudioLiveTransformDraftStore();
    const scope = "page:page-1";
    render(<StudioLiveTransformDraftNode store={store} scope={scope} />);
    const first = {
      id: "stroke-a",
      type: "draw",
      points: [0, 0, 20, 10],
      stroke: "#000",
      strokeWidth: 4,
    } as DrawEl;
    const second = { ...first, id: "stroke-b", points: [400, 0, 420, 10] } as DrawEl;
    const claim = store.claim(scope, [first.id, second.id]);
    act(() => {
      claim?.present([
        { element: first, clip: { x: 0, y: 0, width: 300, height: 400 } },
        { element: second, clip: { x: 360, y: 0, width: 300, height: 400 } },
      ]);
    });

    const drawn = screen.getAllByTestId("transform-draft-draw");
    expect(drawn.map((node) => node.getAttribute("data-element-id")))
      .toEqual(["stroke-a", "stroke-b"]);
    expect(drawn.map((node) => node.parentElement?.getAttribute("data-clip")))
      .toEqual(["0,0,300,400", "360,0,300,400"]);
    // A partial publication is refused by the store, so the node can never show half a selection.
    act(() => {
      claim?.present([{ element: first, clip: null }]);
    });
    expect(screen.getAllByTestId("transform-draft-draw")).toHaveLength(2);
  });

  it("renders no stale draft when the page/master scope changes", () => {
    const store = createStudioLiveTransformDraftStore();
    const firstScope = "page:page-1";
    const element = {
      id: "stroke",
      type: "draw",
      kind: "line",
      points: [0, 0, 20, 10],
      stroke: "#000",
      strokeWidth: 4,
    } as DrawEl;
    const view = render(<StudioLiveTransformDraftNode store={store} scope={firstScope} />);
    const claim = store.claim(firstScope, [element.id]);
    act(() => claim?.present([{ element, clip: null }]));
    expect(screen.queryByTestId("transform-draft-draw")).not.toBeNull();

    view.rerender(<StudioLiveTransformDraftNode store={store} scope="page:page-2" />);
    expect(screen.queryByTestId("transform-draft-draw")).toBeNull();
  });
});
