import { describe, expect, it, vi } from "vitest";

import {
  createStudioStagePointerFrameMapperCache,
  shouldSynchronizeStudioStagePointerPosition,
  snapshotStudioStagePointerBatchMapper,
} from "./studio-stage-pointer-coordinate";

function fakeStage(options: {
  rect?: Partial<DOMRect>;
  clientWidth?: number;
  clientHeight?: number;
  point?: (point: { x: number; y: number }) => { x: number; y: number };
} = {}) {
  const getBoundingClientRect = vi.fn(() => ({
    left: 100,
    top: 40,
    width: 800,
    height: 400,
    ...options.rect,
  }) as DOMRect);
  const point = vi.fn(options.point ?? ((value) => value));
  const invert = vi.fn(() => ({ point }));
  const copy = vi.fn(() => ({ invert }));
  const stage = {
    getContent: () => ({
      clientWidth: options.clientWidth ?? 400,
      clientHeight: options.clientHeight ?? 200,
      getBoundingClientRect,
    }),
    getAbsoluteTransform: () => ({ copy }),
  };
  return { copy, getBoundingClientRect, invert, point, stage };
}

describe("snapshotStudioStagePointerBatchMapper", () => {
  it("reuses one layout and inverse-transform snapshot for every coalesced sample", () => {
    const fixture = fakeStage({
      point: ({ x, y }) => ({ x: x - 12, y: 300 - y }),
    });
    const mapper = snapshotStudioStagePointerBatchMapper(fixture.stage as never);

    expect(mapper.pointFor({ clientX: 300, clientY: 140 })).toEqual({ x: 88, y: 250 });
    expect(mapper.pointFor({ clientX: 500, clientY: 240 })).toEqual({ x: 188, y: 200 });
    expect(mapper.pointFor({ clientX: 700, clientY: 340 })).toEqual({ x: 288, y: 150 });
    expect(fixture.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(fixture.copy).toHaveBeenCalledTimes(1);
    expect(fixture.invert).toHaveBeenCalledTimes(1);
    expect(fixture.point).toHaveBeenCalledTimes(3);
  });

  it("falls back to unit CSS scale when layout dimensions are unavailable", () => {
    const fixture = fakeStage({
      clientWidth: 0,
      clientHeight: 0,
      rect: { left: 10, top: 20, width: 0, height: 0 },
    });
    const mapper = snapshotStudioStagePointerBatchMapper(fixture.stage as never);

    expect(mapper.pointFor({ clientX: 35, clientY: 55 })).toEqual({ x: 25, y: 35 });
  });

  it("fails closed for malformed browser or transform coordinates", () => {
    const fixture = fakeStage({ point: () => ({ x: Number.NaN, y: 1 }) });
    const mapper = snapshotStudioStagePointerBatchMapper(fixture.stage as never);

    expect(mapper.pointFor({ clientX: Number.POSITIVE_INFINITY, clientY: 10 })).toBeNull();
    expect(mapper.pointFor({ clientX: 10, clientY: 10 })).toBeNull();
  });
});

describe("shouldSynchronizeStudioStagePointerPosition", () => {
  it("lets Konva own normal content-routed events without a duplicate layout read", () => {
    const child = {} as Node;
    const content = {
      contains: vi.fn((candidate: Node | null) => candidate === child),
    } as Pick<HTMLElement, "contains">;

    expect(
      shouldSynchronizeStudioStagePointerPosition(
        content,
        content as unknown as EventTarget
      )
    ).toBe(false);
    expect(
      shouldSynchronizeStudioStagePointerPosition(
        content,
        child as unknown as EventTarget
      )
    ).toBe(false);
    expect(content.contains).toHaveBeenCalledTimes(1);
  });

  it("keeps manual synchronization when pointer capture did not route through the Stage", () => {
    const outside = {} as EventTarget;
    const content = {
      contains: vi.fn(() => false),
    } as Pick<HTMLElement, "contains">;

    expect(shouldSynchronizeStudioStagePointerPosition(content, outside)).toBe(true);
    expect(shouldSynchronizeStudioStagePointerPosition(null, outside)).toBe(true);
    expect(shouldSynchronizeStudioStagePointerPosition(content, null)).toBe(true);
  });

  it("fails safe when a detached host throws while checking the event route", () => {
    const content = {
      contains: vi.fn(() => {
        throw new Error("detached");
      }),
    } as Pick<HTMLElement, "contains">;

    expect(
      shouldSynchronizeStudioStagePointerPosition(content, {} as EventTarget)
    ).toBe(true);
  });
});

function fakeFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => {
    callbacks.delete(handle);
  });
  const flush = () => {
    const pending = [...callbacks.entries()];
    callbacks.clear();
    for (const [, callback] of pending) callback(16.67);
  };
  return { callbacks, cancelFrame, flush, requestFrame };
}

describe("createStudioStagePointerFrameMapperCache", () => {
  it("shares one layout and inverse snapshot across raw and processed deliveries in a frame", () => {
    const scheduler = fakeFrameScheduler();
    const fixture = fakeStage();
    const cache = createStudioStagePointerFrameMapperCache(scheduler);

    const rawMapper = cache.mapperFor(fixture.stage as never);
    const processedMapper = cache.mapperFor(fixture.stage as never);

    expect(processedMapper).toBe(rawMapper);
    expect(fixture.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(fixture.copy).toHaveBeenCalledTimes(1);
    expect(fixture.invert).toHaveBeenCalledTimes(1);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
  });

  it("takes a fresh snapshot after the next paint frame", () => {
    const scheduler = fakeFrameScheduler();
    const fixture = fakeStage();
    const cache = createStudioStagePointerFrameMapperCache(scheduler);

    const first = cache.mapperFor(fixture.stage as never);
    scheduler.flush();
    const second = cache.mapperFor(fixture.stage as never);

    expect(second).not.toBe(first);
    expect(fixture.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(fixture.copy).toHaveBeenCalledTimes(2);
    expect(fixture.invert).toHaveBeenCalledTimes(2);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);
  });

  it("resnapshots immediately when the Stage identity changes", () => {
    const scheduler = fakeFrameScheduler();
    const first = fakeStage();
    const second = fakeStage({ rect: { left: 20 } });
    const cache = createStudioStagePointerFrameMapperCache(scheduler);

    cache.mapperFor(first.stage as never);
    cache.mapperFor(second.stage as never);

    expect(first.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(second.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
  });

  it("invalidates pointer-session snapshots and cancels their pending frame", () => {
    const scheduler = fakeFrameScheduler();
    const fixture = fakeStage();
    const cache = createStudioStagePointerFrameMapperCache(scheduler);

    cache.mapperFor(fixture.stage as never);
    cache.invalidate();
    cache.mapperFor(fixture.stage as never);

    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1);
    expect(fixture.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);
  });

  it("disposes idempotently and rejects late pointer deliveries", () => {
    const scheduler = fakeFrameScheduler();
    const fixture = fakeStage();
    const cache = createStudioStagePointerFrameMapperCache(scheduler);

    cache.mapperFor(fixture.stage as never);
    cache.dispose();
    cache.dispose();

    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1);
    expect(scheduler.callbacks.size).toBe(0);
    expect(() => cache.mapperFor(fixture.stage as never)).toThrow(/disposed/i);
  });
});
