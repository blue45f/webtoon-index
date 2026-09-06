import { describe, expect, it } from "vitest";

import { StudioLiveTransientTip } from "./studio-live-transient-tip";

interface TestSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  bytes(): Uint8Array;
  children: TestSurface[];
  stack: unknown[];
}

/** A tiny byte surface checks copy/restore ownership without mocking the preview controller. */
function surface(width = 90, height = 60): TestSurface {
  let w = width;
  let h = height;
  let pixels = new Uint8Array(w * h);
  let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: { alpha: number; operation: string; matrix: typeof transform }[] = [];
  const children: TestSurface[] = [];
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    getTransform: () => ({ ...transform }),
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { transform = { a, b, c, d, e, f }; },
    save() { stack.push({ alpha: this.globalAlpha, operation: this.globalCompositeOperation, matrix: { ...transform } }); },
    restore() { const saved = stack.pop()!; this.globalAlpha = saved.alpha; this.globalCompositeOperation = saved.operation; transform = saved.matrix; },
    clearRect(x: number, y: number, rw: number, rh: number) {
      for (let py = y; py < y + rh; py++) for (let px = x; px < x + rw; px++) pixels[py * w + px] = 0;
    },
    drawImage(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      expect(sw).toBe(dw); expect(sh).toBe(dh);
      expect(transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      expect(this.globalAlpha).toBe(1);
      const src = source as unknown as { width: number; bytes(): Uint8Array };
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) pixels[(dy + y) * w + dx + x] = src.bytes()[(sy + y) * src.width + sx + x]!;
    },
  };
  const canvas = {
    get width() { return w; }, set width(value: number) { w = value; pixels = new Uint8Array(w * h); },
    get height() { return h; }, set height(value: number) { h = value; pixels = new Uint8Array(w * h); },
    bytes: () => pixels,
    getContext: () => context,
    ownerDocument: { createElement() { const child = surface(1, 1); children.push(child); return child.canvas; } },
  } as unknown as HTMLCanvasElement;
  return { canvas, context: context as unknown as CanvasRenderingContext2D, bytes: () => pixels, children, stack };
}

const bounds = { minX: 20, minY: 10, maxX: 30, maxY: 20 };

describe("transient pencil-tip pixel ownership", () => {
  it("restores patterned and transparent pixels exactly through 400 previews using one small backing", () => {
    const state = surface();
    for (let i = 0; i < state.bytes().length; i++) state.bytes()[i] = i % 251;
    const original = state.bytes().slice();
    const tip = new StudioLiveTransientTip();
    for (let i = 0; i < 400; i++) {
      const offset = i % 30;
      expect(tip.show(state.canvas, state.context, { ...bounds, minX: 20 + offset, maxX: 30 + offset }, () => {
        state.bytes()[15 * 90 + 25 + offset] = 255;
      })).toBe(true);
      expect(state.bytes()[15 * 90 + 25 + offset]).toBe(255);
      tip.restore(state.canvas, state.context);
      expect(state.bytes()).toEqual(original);
      expect(state.stack).toHaveLength(0);
      expect(tip.retainedPixelCount).toBe(14 * 14);
    }
    expect(state.children).toHaveLength(1);
    tip.discard(true);
    expect(tip.retainedPixelCount).toBe(0);
    expect(state.children[0]!.canvas.width).toBe(1);
  });

  it("restores an old preview before capturing the next, instead of baking old tip pigment", () => {
    const state = surface();
    state.bytes().fill(30);
    const tip = new StudioLiveTransientTip();
    tip.show(state.canvas, state.context, bounds, () => { state.bytes()[15 * 90 + 25] = 200; });
    tip.show(state.canvas, state.context, bounds, () => { state.bytes()[15 * 90 + 26] = 210; });
    expect(state.bytes()[15 * 90 + 25]).toBe(30);
    tip.restore(state.canvas, state.context);
    expect(state.bytes().every((value) => value === 30)).toBe(true);
  });

  it("maps flip, high-DPI and pan to backing pixels while retaining the caller's canvas state", () => {
    const state = surface();
    state.context.setTransform(-2, 0, 0, 2, 80, -10);
    state.context.globalAlpha = 0.37;
    state.context.globalCompositeOperation = "multiply";
    state.bytes().fill(27);
    const tip = new StudioLiveTransientTip();
    tip.show(state.canvas, state.context, bounds, () => { state.bytes()[15 * 90 + 25] = 201; });
    expect(tip.retainedPixelCount).toBe(24 * 24);
    tip.restore(state.canvas, state.context);
    expect(state.bytes().every((value) => value === 27)).toBe(true);
    expect(state.context.globalAlpha).toBe(0.37);
    expect(state.context.globalCompositeOperation).toBe("multiply");
    expect(state.context.getTransform()).toEqual({ a: -2, b: 0, c: 0, d: 2, e: 80, f: -10 });
    expect(state.stack).toHaveLength(0);
  });

  it("clips allocation to the live surface and rejects invalid or fully offscreen bounds", () => {
    const state = surface();
    const tip = new StudioLiveTransientTip();
    let painted = 0;
    expect(tip.show(state.canvas, state.context, { minX: -1e8, minY: -1e8, maxX: 1e8, maxY: 1e8 }, () => { painted++; })).toBe(true);
    expect(tip.retainedPixelCount).toBe(90 * 60);
    tip.restore(state.canvas, state.context);
    expect(tip.show(state.canvas, state.context, { ...bounds, minX: NaN }, () => { painted++; })).toBe(false);
    expect(tip.show(state.canvas, state.context, { ...bounds, minX: 100, maxX: 120 }, () => { painted++; })).toBe(false);
    expect(painted).toBe(1);
  });

  it("never restores a stale surface after resize or explicit replay invalidation", () => {
    const state = surface();
    const tip = new StudioLiveTransientTip();
    state.bytes().fill(80);
    tip.show(state.canvas, state.context, bounds, () => {});
    state.canvas.width = 91;
    tip.restore(state.canvas, state.context);
    expect(state.bytes().every((value) => value === 0)).toBe(true);
    tip.show(state.canvas, state.context, bounds, () => {});
    tip.discard();
    state.bytes().fill(40);
    tip.restore(state.canvas, state.context);
    expect(state.bytes().every((value) => value === 40)).toBe(true);
    tip.discard(true);
    expect(tip.retainedPixelCount).toBe(0);
  });

  it("restores the stable body and balances state even when preview painting throws", () => {
    const state = surface();
    state.bytes().fill(90);
    const tip = new StudioLiveTransientTip();
    expect(() => tip.show(state.canvas, state.context, bounds, () => {
      state.bytes()[15 * 90 + 25] = 205;
      throw new Error("injected paint failure");
    })).toThrow("injected paint failure");
    expect(state.bytes().every((value) => value === 90)).toBe(true);
    expect(state.stack).toHaveLength(0);
  });
});
