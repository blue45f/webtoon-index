// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_POINTER_DISTANCE_BUDGETS_PX } from "../studio-oncanvas-command-surfaces";

import { StudioBrushHud, type StudioBrushHudHandlers } from "./StudioBrushHud";

function handlers(overrides: Partial<StudioBrushHudHandlers> = {}): StudioBrushHudHandlers {
  return {
    onStrokeWidthChange: vi.fn(),
    onOpacityChange: vi.fn(),
    onOpenColorWheel: vi.fn(),
    onToggleEraser: vi.fn(),
    ...overrides,
  };
}

function mountHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.getBoundingClientRect = () =>
    ({ left: 224, top: 44, width: 900, height: 800, right: 1124, bottom: 844, x: 224, y: 44 }) as DOMRect;
  document.body.append(host);
  return host;
}

function renderHud(
  props: Partial<Parameters<typeof StudioBrushHud>[0]> = {},
  bag: StudioBrushHudHandlers = handlers()
) {
  const host = mountHost();
  const ref = createRef<HTMLDivElement>();
  (ref as { current: HTMLDivElement | null }).current = host;
  const result = render(
    <StudioBrushHud
      visible
      strokeWidth={12}
      brushOpacity={0.8}
      color="#7c5cfc"
      eraserActive={false}
      handedness="right"
      canvasHostRef={ref}
      stableHandlers={bag}
      {...props}
    />
  );
  return { ...result, host, bag };
}

/** The HUD is a pointer affordance: it stays out of the a11y tree until the
 * pointer is actually over the canvas. Tests that assert on its controls have to
 * bring it on screen first. */
function revealHud(host: HTMLElement) {
  fireEvent.pointerMove(host, { clientX: 600, clientY: 400 });
  flushFrames();
  return host;
}

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Visibility is written imperatively, so state assertions read the node directly. */
function hudNode(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-studio-brush-hud="true"]');
  if (!node) throw new Error("brush HUD not mounted");
  return node;
}

function flushFrames() {
  const queued = rafQueue;
  rafQueue = [];
  for (const callback of queued) callback(0);
}

describe("StudioBrushHud", () => {
  it("renders 크기·불투명도·색·펜/지우개 as one reachable toolbar", () => {
    const { host } = renderHud();
    revealHud(host);
    const hud = screen.getByRole("toolbar", { name: "브러시 HUD" });
    expect(hud.dataset.studioShortcutBoundary).toBe("true");
    expect(screen.getByRole("slider", { name: "브러시 크기" })).toHaveProperty(
      "ariaValueText",
      "12px"
    );
    expect(screen.getByRole("slider", { name: "브러시 불투명도" })).toHaveProperty(
      "ariaValueText",
      "80%"
    );
    expect(screen.getByRole("button", { name: /색 선택/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: "지우개로 전환" })).toBeTruthy();
  });

  it("keeps the whole cluster inside the 80px budget", () => {
    const { host } = renderHud();
    revealHud(host);
    const hud = screen.getByRole("toolbar", { name: "브러시 HUD" });
    const extent = Number.parseFloat(hud.style.width);
    // A 2×2 cluster placed at radius r: the far cell centre is
    // hypot(cellOffset, r + cellOffset). The DOM only carries the extent, so the
    // budget check is the cluster's own half-diagonal plus the tether radius.
    expect(Math.hypot(extent / 2, extent / 2)).toBeLessThan(
      STUDIO_POINTER_DISTANCE_BUDGETS_PX.brushHud
    );
  });

  it("hides for the duration of a stroke and comes back on lift", () => {
    const { host } = renderHud();
    const hud = hudNode();

    revealHud(host);
    expect(hud.style.visibility).toBe("visible");

    fireEvent.pointerDown(host, { clientX: 600, clientY: 400 });
    flushFrames();
    expect(hud.style.visibility).toBe("hidden");

    fireEvent.pointerMove(host, { clientX: 640, clientY: 440 });
    flushFrames();
    expect(hud.style.visibility).toBe("hidden");

    fireEvent.pointerUp(host, { clientX: 640, clientY: 440 });
    flushFrames();
    expect(hud.style.visibility).toBe("visible");
  });

  it("hides once the pointer leaves the canvas", () => {
    const { host } = renderHud();
    const hud = hudNode();
    revealHud(host);
    expect(hud.style.visibility).toBe("visible");
    // A panel floating over the canvas host is not the canvas.
    fireEvent.pointerMove(document.body, { clientX: 20, clientY: 20 });
    flushFrames();
    expect(hud.style.visibility).toBe("hidden");
  });

  it("routes value edits to the shared setters", () => {
    const bag = handlers();
    const { host } = renderHud({}, bag);
    revealHud(host);
    fireEvent.keyDown(screen.getByRole("slider", { name: "브러시 크기" }), {
      key: "ArrowRight",
    });
    expect(bag.onStrokeWidthChange).toHaveBeenCalledWith(13);

    fireEvent.keyDown(screen.getByRole("slider", { name: "브러시 불투명도" }), {
      key: "ArrowLeft",
    });
    expect(bag.onOpacityChange).toHaveBeenCalledWith(0.79);

    fireEvent.click(screen.getByRole("button", { name: "지우개로 전환" }));
    expect(bag.onToggleEraser).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /색 선택/u }));
    expect(bag.onOpenColorWheel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while no drawing tool is active", () => {
    renderHud({ visible: false });
    expect(document.querySelector('[data-studio-brush-hud="true"]')).toBeNull();
  });
});
