// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { StudioCanvasRulerBars } from "./StudioCanvasRulerBars";

const canvasContext = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  rotate: vi.fn(),
  save: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  fillStyle: "",
  font: "",
  lineWidth: 1,
  strokeStyle: "",
  textBaseline: "alphabetic" as CanvasTextBaseline,
};

let resizeObserverCallback: ResizeObserverCallback | null = null;
let originalCanvasGetContext: PropertyDescriptor | undefined;
let originalDevicePixelRatio: PropertyDescriptor | undefined;

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function mockCanvasRect(
  canvas: HTMLCanvasElement,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  }
): void {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right,
    bottom,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

function setCanvasClientSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
}

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  input: {
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly button?: number;
    readonly isPrimary?: boolean;
  }
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: input.pointerId },
    clientX: { value: input.clientX },
    clientY: { value: input.clientY },
    button: { value: input.button ?? 0 },
    isPrimary: { value: input.isPrimary ?? true },
  });
  fireEvent(target, event);
}

beforeEach(() => {
  resizeObserverCallback = null;
  vi.clearAllMocks();
  originalCanvasGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext"
  );
  originalDevicePixelRatio = Object.getOwnPropertyDescriptor(
    window,
    "devicePixelRatio"
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => canvasContext),
  });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalCanvasGetContext) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalCanvasGetContext
    );
  }
  if (originalDevicePixelRatio) {
    Object.defineProperty(
      window,
      "devicePixelRatio",
      originalDevicePixelRatio
    );
  }
});

describe("StudioCanvasRulerBars responsive chrome", () => {
  it("exposes a token-based, exact 22px canvas inset contract", () => {
    const onAddGuide = vi.fn();
    const { container } = render(
      <StudioCanvasRulerBars
        visible
        scale={1}
        scrollLeft={0}
        scrollTop={0}
        canvasWidth={720}
        canvasHeight={1080}
        onAddGuide={onAddGuide}
      />
    );

    const root = container.querySelector<HTMLElement>(
      '[data-studio-canvas-rulers="true"]'
    );
    const corner = container.querySelector<HTMLElement>(
      "[data-studio-ruler-corner]"
    );
    const topRuler = screen.getByLabelText(/상단 눈금자/u);
    const leftRuler = screen.getByLabelText(/왼쪽 눈금자/u);

    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-studio-ruler-state")).toBe("on");
    expect(root?.getAttribute("data-studio-ruler-layout-contract")).toBe(
      "inset-top-left"
    );
    expect(root?.getAttribute("data-studio-ruler-thickness")).toBe("22");
    expect(root?.getAttribute("data-studio-ruler-hit-contract")).toBe(
      "desktop-fine-pointer-22px"
    );
    expect(root?.style.getPropertyValue("--studio-ruler-thickness")).toBe(
      "22px"
    );
    expect(root?.classList.contains("hidden")).toBe(true);
    expect(root?.classList.contains("lg:block")).toBe(true);
    expect(root?.classList.contains("pointer-events-none")).toBe(true);
    expect(corner?.classList.contains("bg-panel")).toBe(true);
    expect(corner?.classList.contains("border-line")).toBe(true);
    expect(corner?.classList.contains("text-fg-3")).toBe(true);
    expect(topRuler.classList.contains("bg-panel")).toBe(true);
    expect(topRuler.classList.contains("border-line")).toBe(true);
    expect(topRuler.classList.contains("text-fg-3")).toBe(true);
    expect(topRuler.classList.contains("cursor-ns-resize")).toBe(true);
    expect(leftRuler.classList.contains("cursor-ew-resize")).toBe(true);
    expect(topRuler.getAttribute("data-studio-ruler-guide-gesture")).toBe(
      "drag-to-canvas"
    );
    expect(topRuler.getAttribute("title")).toMatch(/드래그/u);
    expect(leftRuler.getAttribute("title")).toMatch(/드래그/u);
    expect(container.innerHTML).not.toMatch(/rgba|neutral|border-white/u);
  });

  it("renders nothing when rulers are disabled", () => {
    const { container } = render(
      <StudioCanvasRulerBars
        visible={false}
        scale={1}
        scrollLeft={0}
        scrollTop={0}
        canvasWidth={720}
        canvasHeight={1080}
      />
    );

    expect(container.innerHTML).toBe("");
  });

  it("marks non-interactive rulers as disabled without enlarging them over the canvas", () => {
    render(
      <StudioCanvasRulerBars
        visible
        scale={1}
        scrollLeft={0}
        scrollTop={0}
        canvasWidth={720}
        canvasHeight={1080}
      />
    );

    const topRuler = screen.getByLabelText(/상단 눈금자/u);
    expect(topRuler.getAttribute("aria-disabled")).toBe("true");
    expect(topRuler.classList.contains("cursor-default")).toBe(true);
  });

  it("creates guides only after a ruler drag crosses into the canvas", () => {
    const onAddGuide = vi.fn();
    render(
      <StudioCanvasRulerBars
        visible
        scale={2}
        scrollLeft={20}
        scrollTop={40}
        canvasWidth={720}
        canvasHeight={1080}
        onAddGuide={onAddGuide}
      />
    );
    const topRuler = screen.getByLabelText<HTMLCanvasElement>(/상단 눈금자/u);
    const leftRuler = screen.getByLabelText<HTMLCanvasElement>(/왼쪽 눈금자/u);
    mockCanvasRect(topRuler, { left: 22, top: 0, width: 300, height: 22 });
    mockCanvasRect(leftRuler, { left: 0, top: 22, width: 22, height: 300 });

    dispatchPointer(topRuler, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 10,
    });
    dispatchPointer(topRuler, "pointerup", {
      pointerId: 1,
      clientX: 100,
      clientY: 10,
    });
    expect(onAddGuide).not.toHaveBeenCalled();

    dispatchPointer(topRuler, "pointerdown", {
      pointerId: 2,
      clientX: 100,
      clientY: 10,
    });
    dispatchPointer(topRuler, "pointermove", {
      pointerId: 2,
      clientX: 100,
      clientY: 25,
    });
    expect(onAddGuide).not.toHaveBeenCalled();
    dispatchPointer(topRuler, "pointermove", {
      pointerId: 2,
      clientX: 100,
      clientY: 26,
    });
    expect(onAddGuide).toHaveBeenLastCalledWith("v", 49);

    dispatchPointer(leftRuler, "pointerdown", {
      pointerId: 3,
      clientX: 10,
      clientY: 100,
    });
    dispatchPointer(leftRuler, "pointermove", {
      pointerId: 3,
      clientX: 26,
      clientY: 10_000,
    });
    expect(onAddGuide).toHaveBeenLastCalledWith("h", 1080);
    expect(onAddGuide).toHaveBeenCalledTimes(2);
  });

  it("ignores guide gestures when the scale is invalid", () => {
    const onAddGuide = vi.fn();
    render(
      <StudioCanvasRulerBars
        visible
        scale={0}
        scrollLeft={0}
        scrollTop={0}
        canvasWidth={720}
        canvasHeight={1080}
        onAddGuide={onAddGuide}
      />
    );
    const topRuler = screen.getByLabelText<HTMLCanvasElement>(/상단 눈금자/u);
    mockCanvasRect(topRuler, { left: 22, top: 0, width: 300, height: 22 });

    dispatchPointer(topRuler, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 10,
    });
    dispatchPointer(topRuler, "pointermove", {
      pointerId: 1,
      clientX: 100,
      clientY: 30,
    });

    expect(onAddGuide).not.toHaveBeenCalled();
  });

  it("redraws resized rulers with crisp high-DPI backing stores", () => {
    render(
      <StudioCanvasRulerBars
        visible
        scale={1}
        scrollLeft={0}
        scrollTop={0}
        canvasWidth={720}
        canvasHeight={1080}
      />
    );
    const topRuler = screen.getByLabelText<HTMLCanvasElement>(/상단 눈금자/u);
    const leftRuler = screen.getByLabelText<HTMLCanvasElement>(/왼쪽 눈금자/u);
    setCanvasClientSize(topRuler, 300, 22);
    setCanvasClientSize(leftRuler, 22, 400);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
    });

    expect(topRuler.width).toBe(600);
    expect(topRuler.height).toBe(44);
    expect(leftRuler.width).toBe(44);
    expect(leftRuler.height).toBe(800);
    expect(canvasContext.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(canvasContext.lineWidth).toBe(0.5);
    expect(canvasContext.stroke).toHaveBeenCalled();
  });
});
