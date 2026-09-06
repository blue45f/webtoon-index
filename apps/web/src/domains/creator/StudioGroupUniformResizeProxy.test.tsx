// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioGroupUniformResizeProxy } from "./StudioGroupUniformResizeProxy";

import type { DrawEl, El } from "./studio-element-model";
import type Konva from "konva";

type CapturedProps = Record<string, unknown>;

const konvaHarness = vi.hoisted(() => ({
  rectNode: null as Record<string, unknown> | null,
  rectProps: null as CapturedProps | null,
  transformerNode: null as Record<string, unknown> | null,
  transformerProps: null as CapturedProps | null,
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");

  const Rect = forwardRef<unknown, CapturedProps>((props, ref) => {
    // eslint-disable-next-line react-compiler/react-compiler -- Test-only render probe.
    konvaHarness.rectProps = props;
    useImperativeHandle(ref, () => konvaHarness.rectNode);
    return null;
  });
  const Transformer = forwardRef<unknown, CapturedProps>((props, ref) => {
    // eslint-disable-next-line react-compiler/react-compiler -- Test-only render probe.
    konvaHarness.transformerProps = props;
    useImperativeHandle(ref, () => konvaHarness.transformerNode);
    return null;
  });
  Rect.displayName = "TestGroupResizeRect";
  Transformer.displayName = "TestGroupResizeTransformer";

  return { Rect, Transformer };
});

// Proxy tests exercise React/event/lifecycle wiring; the real isolated-Layer ownership state
// machine has its own Konva integration suite. Give eligible fixtures a successful lift token so
// these tests cannot accidentally fall back to release-only merely because their tiny node doubles
// do not implement Konva.Container.moveTo/zIndex/absolutePosition.
vi.mock("./studio-single-object-drag-layer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-single-object-drag-layer")>();
  const successfulLift = (options: {
    elementId: string;
    wrapper: Konva.Node;
    transformer: Konva.Transformer;
    dragLayer: Konva.Layer | null;
  }) => {
    if (!options.dragLayer) return null;
    return {
      elementId: options.elementId,
      mainLayer: options.wrapper.getLayer(),
      dragLayer: options.dragLayer,
      target: options.wrapper,
      transformer: options.transformer,
      lifted: [],
      presentationMode: "synchronous-authority" as const,
      restored: false,
    };
  };
  return {
    ...actual,
    beginStudioSingleDrawTransformChromeLayer: vi.fn(successfulLift),
    beginStudioSingleDrawTransformLayer: vi.fn(successfulLift),
    beginStudioSingleDrawTransformSourceLayer: vi.fn(successfulLift),
    restoreStudioSingleObjectDragLayer: vi.fn((session) => {
      if (!session) return false;
      session.restored = true;
      return true;
    }),
  };
});

type FakeRectNode = {
  getLayer: () => { batchDraw: () => void };
  getStage: () => FakeStage | null;
  height: (value?: number) => number;
  position: (value?: { x: number; y: number }) => {
    x: number;
    y: number;
  };
  rotation: (value?: number) => number;
  scaleX: (value?: number) => number;
  scaleY: (value?: number) => number;
  width: (value?: number) => number;
  x: () => number;
  y: () => number;
};

type FakeStage = {
  find: (selector: unknown) => unknown[];
  scaleX: () => number;
  scaleY: () => number;
};

type FakeWrapperNode = ReturnType<typeof createWrapperNode>;

type FakeIndicatorNode = ReturnType<typeof createIndicatorNode>;

/** Draw wrapper double covering the finder (getAttr/getParent), eligibility, and attr surface. */
function createWrapperNode(
  elementId: string,
  options: { cached?: boolean; dragging?: boolean; parent?: unknown } = {},
) {
  const state = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  };
  let visible = true;
  const layer = {
    batchDraw: vi.fn(),
    drawScene: vi.fn(),
    getNativeCanvasElement: vi.fn(() => ({
      // Native canvas dimensions are physical backing pixels, not CSS/logical dimensions.
      width: 1_920,
      height: 1_080,
    })),
    getCanvas: vi.fn(() => ({
      getPixelRatio: vi.fn(() => 1),
    })),
  };
  return {
    state,
    layer,
    getAttr: vi.fn((name: string) =>
      name === "studioElementId" ? elementId : undefined
    ),
    setAttr: vi.fn(),
    getParent: vi.fn(() => options.parent ?? null),
    isCached: vi.fn(() => options.cached === true),
    isDragging: vi.fn(() => options.dragging === true),
    getLayer: vi.fn(() => layer),
    x: vi.fn(() => state.x),
    y: vi.fn(() => state.y),
    on: vi.fn(),
    off: vi.fn(),
    visible: vi.fn((value?: boolean) => {
      if (value !== undefined) visible = value;
      return visible;
    }),
    position: vi.fn((value?: { x: number; y: number }) => {
      if (value) {
        state.x = value.x;
        state.y = value.y;
      }
      return { x: state.x, y: state.y };
    }),
    rotation: vi.fn((value?: number) => {
      if (value !== undefined) state.rotation = value;
      return state.rotation;
    }),
    scale: vi.fn((value?: { x: number; y: number }) => {
      if (value) {
        state.scaleX = value.x;
        state.scaleY = value.y;
      }
      return { x: state.scaleX, y: state.scaleY };
    }),
    offset: vi.fn((value?: { x: number; y: number }) => {
      if (value) {
        state.offsetX = value.x;
        state.offsetY = value.y;
      }
      return { x: state.offsetX, y: state.offsetY };
    }),
  };
}

/**
 * The per-element clip `Group` the document layer renders around a panel member.
 *
 * Real attr storage, not a spy: the clip tracker READS the host back to decide whether a frame
 * changed anything and whether its own write still stands, so a node that forgets what was written
 * to it would pass every assertion here while failing in the product.
 */
function createClipGroupNode(clip: { x: number; y: number; width: number; height: number }) {
  const attrs: Record<string, unknown> = {
    clipX: clip.x,
    clipY: clip.y,
    clipWidth: clip.width,
    clipHeight: clip.height,
  };
  return {
    attrs,
    getAttr: vi.fn((name: string) => attrs[name]),
    setAttr: vi.fn((name: string, value: unknown) => {
      attrs[name] = value;
    }),
    getParent: vi.fn(() => null),
    // The preview eligibility walk climbs ancestors too, so the host answers its probes.
    isCached: vi.fn(() => false),
    getClipWidth: vi.fn(() => (attrs.clipWidth as number | undefined) ?? 0),
    getClipHeight: vi.fn(() => (attrs.clipHeight as number | undefined) ?? 0),
    clipFunc: vi.fn(),
  };
}

function createIndicatorNode() {
  const state = { visible: true };
  return {
    state,
    visible: vi.fn((value?: boolean) => {
      if (value !== undefined) state.visible = value;
      return state.visible;
    }),
  };
}

/** Answers the wrapper finder's predicate find and the indicator-name string find. */
function createStage(
  wrapper: FakeWrapperNode,
  indicators: readonly FakeIndicatorNode[]
): FakeStage {
  return {
    scaleX: vi.fn(() => 1),
    scaleY: vi.fn(() => 1),
    find: vi.fn((selector: unknown) => {
      if (typeof selector === "function") {
        return [wrapper].filter((node) =>
          (selector as (node: FakeWrapperNode) => boolean)(node)
        );
      }
      if (selector === ".studio-draw-selection-indicator") return [...indicators];
      return [];
    }),
  };
}

type FakeTransformerNode = {
  forceUpdate: () => void;
  getLayer: () => { batchDraw: () => void };
  nodes: {
    (): unknown[];
    (next: unknown[]): FakeTransformerNode;
  };
  stopTransform: () => void;
};

function createRectNode(stage: FakeStage | null = null): FakeRectNode {
  const state = {
    height: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 0,
    x: 0,
    y: 0,
  };
  const layer = { batchDraw: vi.fn() };
  const node = {
    getLayer: vi.fn(() => layer),
    getStage: vi.fn(() => stage),
    height: vi.fn((value?: number) => {
      if (value !== undefined) state.height = value;
      return state.height;
    }),
    position: vi.fn((value?: { x: number; y: number }) => {
      if (value) {
        state.x = value.x;
        state.y = value.y;
      }
      return { x: state.x, y: state.y };
    }),
    rotation: vi.fn((value?: number) => {
      if (value !== undefined) state.rotation = value;
      return state.rotation;
    }),
    scaleX: vi.fn((value?: number) => {
      if (value !== undefined) state.scaleX = value;
      return state.scaleX;
    }),
    scaleY: vi.fn((value?: number) => {
      if (value !== undefined) state.scaleY = value;
      return state.scaleY;
    }),
    width: vi.fn((value?: number) => {
      if (value !== undefined) state.width = value;
      return state.width;
    }),
    x: vi.fn(() => state.x),
    y: vi.fn(() => state.y),
  };
  return node;
}

function createTransformerNode(): FakeTransformerNode {
  const state = { nodes: [] as unknown[] };
  const layer = { batchDraw: vi.fn() };
  const node = {
    forceUpdate: vi.fn(),
    getLayer: vi.fn(() => layer),
    nodes: vi.fn((next?: unknown[]) => {
      if (next) {
        state.nodes = [...next];
        return node;
      }
      return state.nodes;
    }),
    stopTransform: vi.fn(),
  };
  return node as unknown as FakeTransformerNode;
}

function rectProps(): {
  onTransform: (event: { target: FakeRectNode }) => void;
  onTransformEnd: (event: { target: FakeRectNode }) => void;
  onTransformStart: () => void;
} & CapturedProps {
  if (!konvaHarness.rectProps) throw new Error("Missing captured Rect props");
  return konvaHarness.rectProps as {
    onTransform: (event: { target: FakeRectNode }) => void;
    onTransformEnd: (event: { target: FakeRectNode }) => void;
    onTransformStart: () => void;
  } & CapturedProps;
}

function transformerProps(): {
  anchorStyleFunc: (anchor: Record<string, ReturnType<typeof vi.fn>>) => void;
  boundBoxFunc: (
    oldBox: Record<string, number>,
    newBox: Record<string, number>
  ) => Record<string, number>;
} & CapturedProps {
  if (!konvaHarness.transformerProps) {
    throw new Error("Missing captured Transformer props");
  }
  return konvaHarness.transformerProps as {
    anchorStyleFunc: (anchor: Record<string, ReturnType<typeof vi.fn>>) => void;
    boundBoxFunc: (
      oldBox: Record<string, number>,
      newBox: Record<string, number>
    ) => Record<string, number>;
  } & CapturedProps;
}

const bounds = { x: 10, y: 20, width: 100, height: 50 };

const LIVE_DRAW = {
  id: "stroke-1",
  type: "draw",
  kind: "freehand",
  points: [10, 20, 110, 70],
  stroke: "#16100c",
  strokeWidth: 4,
} as unknown as DrawEl;

let nextAnimationFrameHandle = 1;
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

function flushPreviewFrames(): void {
  act(() => {
    const callbacks = [...animationFrameCallbacks.values()];
    animationFrameCallbacks.clear();
    for (const callback of callbacks) callback(performance.now());
  });
}

function commonProps() {
  const onBegin = vi.fn(() => true);
  const onCancel = vi.fn();
  const onCommit = vi.fn();
  const onRelease = vi.fn();
  return {
    bounds,
    coarse: false,
    effScale: 1,
    enabled: true,
    mobile: false,
    gestureBinding: {
      acquire: onBegin,
      cancel: (reason: string) => onCancel(reason),
      release: onRelease,
      commit: ({ targetBounds, rotationDeg }: {
        targetBounds: typeof bounds;
        rotationDeg: number;
      }) => onCommit(targetBounds, rotationDeg),
    },
    // Expose the underlying spies to keep behavior assertions independent of prop nesting.
    onBegin,
    onCancel,
    onCommit,
    onRelease,
  };
}

beforeEach(() => {
  nextAnimationFrameHandle = 1;
  animationFrameCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const handle = nextAnimationFrameHandle++;
    animationFrameCallbacks.set(handle, callback);
    return handle;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
    animationFrameCallbacks.delete(handle);
  }));
  konvaHarness.rectNode = createRectNode() as unknown as Record<string, unknown>;
  konvaHarness.transformerNode =
    createTransformerNode() as unknown as Record<string, unknown>;
  konvaHarness.rectProps = null;
  konvaHarness.transformerProps = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudioGroupUniformResizeProxy", () => {
  it("자식 대신 투명 proxy 하나에 전용 corner-only Transformer를 연결한다", () => {
    const props = commonProps();
    const { rerender } = render(<StudioGroupUniformResizeProxy {...props} />);
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    const desktop = transformerProps();

    expect(transformer.nodes()).toEqual([rect]);
    expect(desktop.enabledAnchors).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
    expect(desktop.keepRatio).toBe(true);
    expect(desktop.rotateEnabled).toBe(false);
    expect(desktop.flipEnabled).toBe(false);
    expect(desktop.anchorSize).toBe(13);
    expect(desktop.anchorStroke).toBe("#c2410c");
    expect(desktop.borderStroke).toBe("#c2410c");

    rerender(
      <StudioGroupUniformResizeProxy
        {...props}
        coarse
        effScale={2}
      />
    );
    const coarse = transformerProps();
    const anchor = {
      hitStrokeWidth: vi.fn(),
      shadowBlur: vi.fn(),
      shadowColor: vi.fn(),
      shadowOffsetY: vi.fn(),
      shadowOpacity: vi.fn(),
    };
    coarse.anchorStyleFunc(anchor);
    expect(coarse.anchorSize).toBe(7);
    expect(anchor.hitStrokeWidth).toHaveBeenCalledWith(22);

    const oldBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    const tooSmall = { x: 0, y: 0, width: 11, height: 30, rotation: 0 };
    const valid = { x: 0, y: 0, width: 12, height: 12, rotation: 0 };
    expect(coarse.boundBoxFunc(oldBox, tooSmall)).toBe(oldBox);
    expect(coarse.boundBoxFunc(oldBox, valid)).toBe(valid);
  });

  it("승인된 gesture는 proxy를 먼저 원복한 뒤 유한 양수 target을 정확히 한 번 커밋한다", () => {
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    props.onCommit.mockImplementation(() => {
      expect(rect.x()).toBe(bounds.x);
      expect(rect.y()).toBe(bounds.y);
      expect(rect.width()).toBe(bounds.width);
      expect(rect.height()).toBe(bounds.height);
      expect(rect.scaleX()).toBe(1);
      expect(rect.scaleY()).toBe(1);
      expect(rect.rotation()).toBe(0);
    });
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => rectProps().onTransformStart());
    expect(props.onBegin).toHaveBeenCalledWith(bounds);

    act(() => {
      rect.position({ x: 30, y: 40 });
      rect.scaleX(2);
      rect.scaleY(2);
      rectProps().onTransformEnd({ target: rect });
    });

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    // Rotation is reported alongside the box and is 0 for the default uniform proxy.
    expect(props.onCommit).toHaveBeenCalledWith(
      {
        x: 30,
        y: 40,
        width: 200,
        height: 100,
      },
      0,
    );
    expect(props.onCancel).not.toHaveBeenCalled();

    act(() => rectProps().onTransformEnd({ target: rect }));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it("중복 transformstart는 기존 generation을 유지하고 lease를 다시 획득하지 않는다", () => {
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => {
      rectProps().onTransformStart();
      rectProps().onTransformStart();
    });
    expect(props.onBegin).toHaveBeenCalledTimes(1);
    expect(transformer.stopTransform).not.toHaveBeenCalled();

    act(() => {
      rect.scaleX(2);
      rect.scaleY(2);
      rectProps().onTransformEnd({ target: rect });
    });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("freeTransform+rotatable은 회전 핸들과 8방향 앵커를 열고 비균등 스케일을 허용한다", () => {
    const props = { ...commonProps(), freeTransform: true, rotatable: true };
    render(<StudioGroupUniformResizeProxy {...props} />);
    const transformer = transformerProps();

    expect(transformer.rotateEnabled).toBe(true);
    expect(transformer.keepRatio).toBe(false);
    expect(transformer.enabledAnchors).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "middle-left",
      "middle-right",
      "top-center",
      "bottom-center",
    ]);
    expect(transformer.rotationSnaps).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it("rotatable 커밋은 회전각을 박스와 함께 넘기고 proxy를 원복한다", () => {
    const props = { ...commonProps(), freeTransform: true, rotatable: true };
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => rectProps().onTransformStart());
    act(() => {
      rect.position({ x: 30, y: 40 });
      rect.scaleX(2);
      rect.scaleY(3);
      rect.rotation(45);
      rectProps().onTransformEnd({ target: rect });
    });

    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith(
      { x: 30, y: 40, width: 200, height: 150 },
      45,
    );
    // The gesture proxy always returns to its source box; the document owns the result.
    expect(rect.rotation()).toBe(0);
    expect(rect.scaleX()).toBe(1);
    expect(rect.scaleY()).toBe(1);
  });

  it("회전이 비유한 값이면 커밋 대신 취소한다", () => {
    const props = { ...commonProps(), freeTransform: true, rotatable: true };
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => rectProps().onTransformStart());
    act(() => {
      rect.position({ x: 30, y: 40 });
      rect.rotation(Number.NaN);
      rectProps().onTransformEnd({ target: rect });
    });

    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("기본(그룹) 모드는 회전 핸들 없이 균등 코너 리사이즈만 유지한다", () => {
    const props = commonProps();
    render(<StudioGroupUniformResizeProxy {...props} />);
    const transformer = transformerProps();

    expect(transformer.rotateEnabled).toBe(false);
    expect(transformer.keepRatio).toBe(true);
    expect(transformer.rotationSnaps).toEqual([]);
  });

  it("onBegin 거부 시 즉시 stopTransform하고 원복하며 commit/cancel을 만들지 않는다", () => {
    const props = commonProps();
    props.onBegin.mockReturnValue(false);
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => {
      rect.position({ x: 999, y: 888 });
      rect.scaleX(3);
      rect.scaleY(3);
      rectProps().onTransformStart();
    });

    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    expect(rect.position()).toEqual({ x: 10, y: 20 });
    expect(rect.scaleX()).toBe(1);
    expect(rect.scaleY()).toBe(1);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("비유한 target은 cancel하고, 활성 gesture 중 disabled 전환도 한 번만 취소한다", () => {
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    const view = render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => {
      rectProps().onTransformStart();
      rect.scaleX(Number.NaN);
      rectProps().onTransformEnd({ target: rect });
    });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();

    act(() => rectProps().onTransformStart());
    view.rerender(<StudioGroupUniformResizeProxy {...props} enabled={false} />);
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(transformer.nodes()).toEqual([]);
  });

  it("활성 gesture 중 unmount되면 commit 없이 onCancel을 한 번 호출한다", () => {
    const props = commonProps();
    const view = render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => rectProps().onTransformStart());
    view.unmount();

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("활성 gesture 중 window blur가 나면 source bounds로 원복하고 정확히 한 번 취소한다", () => {
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    const view = render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => window.dispatchEvent(new Event("blur")));
    expect(transformer.stopTransform).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();

    act(() => {
      rectProps().onTransformStart();
      rect.position({ x: 310, y: 420 });
      rect.width(150);
      rect.height(90);
      rect.scaleX(2);
      rect.scaleY(3);
      rect.rotation(12);
    });
    view.rerender(
      <StudioGroupUniformResizeProxy
        {...props}
        bounds={{ x: 400, y: 500, width: 210, height: 160 }}
      />,
    );
    // Konva may synchronously deliver transformend from stopTransform(). The latest props now carry
    // a different box, so this proves cancellation's final projection is the captured source box.
    vi.mocked(transformer.stopTransform).mockImplementation(() => {
      rectProps().onTransformEnd({ target: rect });
    });
    props.onCancel.mockImplementation(() => {
      expect(rect.position()).toEqual({ x: bounds.x, y: bounds.y });
      expect(rect.width()).toBe(bounds.width);
      expect(rect.height()).toBe(bounds.height);
      expect(rect.scaleX()).toBe(1);
      expect(rect.scaleY()).toBe(1);
      expect(rect.rotation()).toBe(0);
      expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    });
    act(() => window.dispatchEvent(new Event("blur")));

    expect(rect.position()).toEqual({ x: bounds.x, y: bounds.y });
    expect(rect.width()).toBe(bounds.width);
    expect(rect.height()).toBe(bounds.height);
    expect(rect.scaleX()).toBe(1);
    expect(rect.scaleY()).toBe(1);
    expect(rect.rotation()).toBe(0);
    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("blur"));
      rectProps().onTransformEnd({ target: rect });
    });
    view.unmount();
    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("Konva stopTransform이 던져도 renderer claim과 문서 lease를 취소한다", () => {
    const props = commonProps();
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => rectProps().onTransformStart());
    vi.mocked(transformer.stopTransform).mockImplementation(() => {
      throw new Error("Konva teardown failed");
    });

    act(() => window.dispatchEvent(new Event("blur")));

    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  /** A panel comfortably containing the source bounds, so the stroke starts clipped by it. */
  const CLIP_PANEL = {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 400,
  } as unknown as El;

  describe("live transform preview (PPT-style real-time ink)", () => {
    function setupLivePreview(
      options: { cached?: boolean; dragging?: boolean; parent?: unknown } = {},
    ) {
      const wrapper = createWrapperNode("stroke-1", options);
      const indicator = createIndicatorNode();
      const stage = createStage(wrapper, [indicator]);
      konvaHarness.rectNode = createRectNode(stage) as unknown as Record<
        string,
        unknown
      >;
      const props = {
        ...commonProps(),
        freeTransform: true,
        rotatable: true,
        livePreview: {
          mode: "single" as const,
          scope: "page:page-1",
          element: LIVE_DRAW,
          elements: [LIVE_DRAW],
          transformLiftLayerRef: {
            current: {
              batchDraw: vi.fn(),
              drawScene: vi.fn(),
              getNativeCanvasElement: vi.fn(() => ({
                width: 1_920,
                height: 1_080,
              })),
              getCanvas: vi.fn(() => ({
                getPixelRatio: vi.fn(() => 1),
              })),
            } as unknown as Konva.Layer,
          },
        },
      };
      return { wrapper, indicator, props };
    }

    it("이미 드래그 중인 획에는 변형 세션을 시작하지 않는다", () => {
      // 드래그와 변형은 둘 다 래퍼 transform에 쓴다. 한 손가락이 획을 끄는 중에 다른 손가락이
      // 앵커를 잡으면 두 writer가 한 노드를 놓고 경쟁해, 이벤트 순서에 따라 엉뚱한 위치가 남는다.
      const { wrapper, indicator, props } = setupLivePreview({ dragging: true });
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());

      expect(props.onBegin).not.toHaveBeenCalled();
      expect(wrapper.setAttr).not.toHaveBeenCalled();
      expect(indicator.state.visible).toBe(true);
    });

    it("변형 프레임마다 커밋 플래너와 동일한 affine attrs를 래퍼에 명령형으로 투영한다", () => {
      const { wrapper, indicator, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      // The dashed indicator is parked for the gesture — the Transformer frame is the affordance.
      expect(indicator.state.visible).toBe(false);

      act(() => {
        rect.position({ x: 30, y: 40 });
        // Uniform on purpose: the projection only runs for uniform frames, because the commit
        // applies sqrt(scaleX * scaleY) to one strokeWidth and an anisotropic frame could not be
        // shown faithfully. The anisotropic case is asserted separately below.
        rect.scaleX(2);
        rect.scaleY(2);
        rect.rotation(45);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();

      expect(wrapper.state).toEqual({
        x: 30,
        y: 40,
        rotation: 45,
        scaleX: 2,
        scaleY: 2,
        offsetX: bounds.x,
        offsetY: bounds.y,
      });
    });

    it("비균일 프레임은 투영하지 않고 래퍼를 중립으로 둔다", () => {
      // 커밋은 sqrt(scaleX * scaleY)를 단일 strokeWidth에 적용하고 둥근 캡으로 다시 계획하는데,
      // 래퍼를 비균일하게 스케일하면 캡이 타원이 되고 두께가 방향에 따라 달라진다. 즉 프리뷰가
      // 커밋이 만들 그림을 보여줄 수 없으므로, 그런 프레임에서는 잉크를 움직이지 않고 오늘의
      // 커밋-시점 동작으로 떨어진다. 커밋 자체는 transformend가 따로 판단하므로 영향받지 않는다.
      const { wrapper, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      act(() => {
        rect.position({ x: 30, y: 40 });
        rect.scaleX(2);
        rect.scaleY(3);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();

      expect(wrapper.state).toEqual({
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      });
    });

    it("균일 프레임 뒤 비균일로 바뀌면 직전 포즈를 유지하지 않고 중립으로 되돌린다", () => {
      // 회귀 방지: 비균일 프레임을 단순히 "투영 없음"으로 처리하면 직전 균일 포즈가 그대로 남아,
      // 핸들은 계속 움직이는데 잉크만 얼어붙었다가 릴리즈 때 튄다. 프리뷰를 아예 안 하는 것보다
      // 나쁘므로, 유효하지만 표현 불가능한 프레임에서는 중립으로 되돌려 문서 위치에 머물게 한다.
      const { wrapper, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      act(() => {
        rect.position({ x: 30, y: 40 });
        rect.scaleX(2);
        rect.scaleY(2);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();
      expect(wrapper.state.scaleX).toBe(2);

      act(() => {
        rect.scaleY(3);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();

      expect(wrapper.state).toEqual({
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      });
    });

    it("표현 불가 프레임으로 프리뷰를 접을 때 패널 클립도 함께 되돌린다", () => {
      // 회귀 방지: 앞선 균일 프레임이 이미 클립을 옮겨놨는데, 뒤이어 비균일 프레임이 오면
      // 잉크만 문서 위치로 돌아가고 클립은 옮겨진 채 남았다. 패널 소속 획이 패널 밖으로 새거나,
      // 자유 획이 있지도 않은 패널에 잘린 채로 제스처가 끝날 때까지 남는다.
      const clipGroup = createClipGroupNode({ x: 0, y: 0, width: 400, height: 400 });
      const { props } = setupLivePreview({ parent: clipGroup });
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(
        <StudioGroupUniformResizeProxy
          {...props}
          livePreview={{
            ...props.livePreview,
            elements: [CLIP_PANEL, LIVE_DRAW],
          }}
        />,
      );

      act(() => rectProps().onTransformStart());

      // 균일 프레임: 획을 패널 밖으로 끌고 나가므로 커밋 판정은 "클립 없음"이다.
      act(() => {
        rect.position({ x: 900, y: 900 });
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();
      expect(clipGroup.getClipWidth()).toBe(0);

      // 비균일 프레임: 프리뷰를 접으면서 클립도 제스처 시작 시점 값으로 돌아와야 한다.
      act(() => {
        rect.scaleY(3);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();

      expect(clipGroup.attrs).toMatchObject({
        clipX: 0,
        clipY: 0,
        clipWidth: 400,
        clipHeight: 400,
      });
    });

    it("transformend는 래퍼를 중립화한 뒤에야 정확히 한 번 커밋하고 인디케이터를 복구한다", () => {
      const { wrapper, indicator, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      props.onCommit.mockImplementation(() => {
        // The neutral projection must precede the commit so the baked points repaint atomically.
        expect(wrapper.state).toEqual({
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
        });
        expect(indicator.state.visible).toBe(true);
      });
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      act(() => {
        rect.position({ x: 30, y: 40 });
        rect.scaleX(2);
        rect.scaleY(2);
        rect.rotation(30);
        rectProps().onTransform({ target: rect });
        rectProps().onTransformEnd({ target: rect });
      });

      expect(props.onCommit).toHaveBeenCalledTimes(1);
      expect(props.onCommit).toHaveBeenCalledWith(
        { x: 30, y: 40, width: 200, height: 100 },
        30,
      );
    });

    it("blur 취소는 프리뷰 투영을 중립으로 되돌리고 커밋을 만들지 않는다", () => {
      const { wrapper, indicator, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => {
        rectProps().onTransformStart();
        rect.position({ x: 50, y: 70 });
        rect.scaleX(1.5);
        rect.scaleY(1.5);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();
      expect(wrapper.state.scaleX).toBe(1.5);

      act(() => window.dispatchEvent(new Event("blur")));

      expect(wrapper.state).toEqual({
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      });
      expect(indicator.state.visible).toBe(true);
      expect(props.onCancel).toHaveBeenCalledTimes(1);
      expect(props.onCommit).not.toHaveBeenCalled();
    });

    it("취소 경로의 정리 단계가 던져도 래퍼 중립화는 반드시 끝난다", () => {
      // 회귀 방지: 프리뷰가 끝날 때 붙은 늦은-마운트 크롬 정리는 `stage`를 읽는데, 그 읽기가
      // 중립화보다 먼저 실행되면서 `getStage`가 없는 노드에서 던졌다. 그러면 취소가 프리뷰
      // 변환을 그대로 든 채 중단된다 — 취소의 정반대다. 중립화가 안전성의 핵심이고 크롬 정리는
      // 부수적이므로, 정리가 어떤 이유로 실패해도 중립화·언파킹·onCancel은 완료되어야 한다.
      const { wrapper, indicator, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      (wrapper as unknown as { getStage?: () => unknown }).getStage = () => {
        throw new Error("stage lookup exploded");
      };
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => {
        rectProps().onTransformStart();
        rect.position({ x: 50, y: 70 });
        rect.scaleX(1.5);
        rect.scaleY(1.5);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();
      expect(wrapper.state.scaleX).toBe(1.5);

      act(() => window.dispatchEvent(new Event("blur")));

      expect(wrapper.state).toEqual({
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      });
      expect(indicator.state.visible).toBe(true);
      expect(props.onCancel).toHaveBeenCalledTimes(1);
      expect(props.onCommit).not.toHaveBeenCalled();
    });

    it("캐시된 조상 아래 스트로크는 프리뷰 없이 커밋-지연 동작으로 폴백한다", () => {
      const { wrapper, indicator, props } = setupLivePreview({ cached: true });
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      act(() => {
        rect.position({ x: 30, y: 40 });
        rect.scaleX(2);
        rectProps().onTransform({ target: rect });
        rectProps().onTransformEnd({ target: rect });
      });

      expect(wrapper.position).not.toHaveBeenCalled();
      expect(wrapper.rotation).not.toHaveBeenCalled();
      expect(indicator.state.visible).toBe(true);
      expect(props.onCommit).toHaveBeenCalledTimes(1);
    });

    it("비유한 중간 프레임은 마지막 유효 투영을 유지한다", () => {
      const { wrapper, props } = setupLivePreview();
      const rect = konvaHarness.rectNode as unknown as FakeRectNode;
      render(<StudioGroupUniformResizeProxy {...props} />);

      act(() => rectProps().onTransformStart());
      act(() => {
        rect.position({ x: 30, y: 40 });
        rect.scaleX(2);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();
      const lastValid = { ...wrapper.state };

      act(() => {
        rect.scaleX(Number.NaN);
        rectProps().onTransform({ target: rect });
      });
      flushPreviewFrames();

      expect(wrapper.state).toEqual(lastValid);
    });
  });

  it("외부 취소 신호(Escape·포인터 취소)는 진행 중인 gesture를 즉시 중단시킨다", () => {
    // 페이지가 Escape로 세션을 지우고 lease를 반납해도 proxy의 Konva 제스처는 계속 돌았다 —
    // 라이브 프리뷰가 붙은 뒤로는 "취소했습니다" 안내 후에도 잉크가 핸들을 따라다녔다.
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const view = render(
      <StudioGroupUniformResizeProxy
        {...props}
        gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 0 }}
      />,
    );

    act(() => rectProps().onTransformStart());
    act(() => {
      rect.position({ x: 80, y: 90 });
      rect.scaleX(2);
    });

    view.rerender(
      <StudioGroupUniformResizeProxy
        {...props}
        gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 1 }}
      />,
    );

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
    // 취소는 캡처된 source box로 원복한다.
    expect(rect.position()).toEqual({ x: bounds.x, y: bounds.y });
    expect(rect.scaleX()).toBe(1);

    // 같은 값 재렌더는 아무 것도 하지 않는다(마운트 값은 기준선일 뿐 취소가 아니다).
    view.rerender(
      <StudioGroupUniformResizeProxy
        {...props}
        gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 1 }}
      />,
    );
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    // 활성 gesture가 없을 때의 신호 변화도 조용히 무시된다(왕복 루프 방지).
    view.rerender(
      <StudioGroupUniformResizeProxy
        {...props}
        gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 2 }}
      />,
    );
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("외부 취소는 renderer close 복구가 끝날 때까지 page lease finalizer를 지연한다", () => {
    vi.useFakeTimers();
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const view = render(
      <StudioGroupUniformResizeProxy
        {...props}
        gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 0 }}
      />,
    );

    try {
      act(() => rectProps().onTransformStart());
      // The first external-cancel close cannot restore the proxy. The common lifecycle must keep
      // the commit-port lease and retry the same renderer claim from its host timer.
      vi.mocked(rect.position).mockImplementationOnce(() => {
        throw new Error("proxy restore failed");
      });
      view.rerender(
        <StudioGroupUniformResizeProxy
          {...props}
          gestureBinding={{ ...props.gestureBinding, externalCancelSignal: 1 }}
        />,
      );

      expect(props.onCancel).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(16));
      expect(props.onCancel).toHaveBeenCalledTimes(1);
      expect(props.onCommit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hidden visibility 전환만 활성 gesture를 취소하고 listener를 정리한다", () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState,
    );
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const props = commonProps();
    const rect = konvaHarness.rectNode as unknown as FakeRectNode;
    const transformer =
      konvaHarness.transformerNode as unknown as FakeTransformerNode;
    const view = render(<StudioGroupUniformResizeProxy {...props} />);

    act(() => {
      rectProps().onTransformStart();
      rect.position({ x: 50, y: 70 });
      rect.scaleX(1.5);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(transformer.stopTransform).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();

    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(rect.position()).toEqual({ x: bounds.x, y: bounds.y });
    expect(rect.width()).toBe(bounds.width);
    expect(rect.height()).toBe(bounds.height);
    expect(rect.scaleX()).toBe(1);
    expect(rect.scaleY()).toBe(1);
    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    view.unmount();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(removeWindowListener).toHaveBeenCalledWith(
      "blur",
      expect.any(Function),
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
