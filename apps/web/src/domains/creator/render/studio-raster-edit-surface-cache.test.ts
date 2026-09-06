import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioRasterEditSurfaces,
  getStudioRasterEditSurfaceSnapshot,
  rememberStudioRasterEditSurface,
  studioRasterEditSurfaceCacheStats,
  subscribeStudioRasterEditSurfaces,
  takeStudioRasterEditSurface,
} from "./studio-raster-edit-surface-cache";

function surface(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearStudioRasterEditSurfaces();
});

afterEach(() => {
  clearStudioRasterEditSurfaces();
  vi.useRealTimers();
});

describe("Studio raster edit surface cache", () => {
  it("only returns a surface for its exact immutable PNG authority", () => {
    const canvas = surface(720, 1_080);
    rememberStudioRasterEditSurface("data:image/png;base64,current", canvas);

    expect(getStudioRasterEditSurfaceSnapshot("data:image/png;base64,current")).toBe(canvas);
    expect(takeStudioRasterEditSurface("data:image/png;base64,current")).toBe(canvas);
    expect(getStudioRasterEditSurfaceSnapshot("data:image/png;base64,undo")).toBeNull();
    expect(studioRasterEditSurfaceCacheStats()).toEqual({ entries: 1, pixels: 777_600 });
  });

  it("keeps only the two most recent surfaces within the aggregate pixel budget", () => {
    const first = surface(1_000, 1_000);
    const second = surface(1_000, 1_000);
    const third = surface(1_000, 1_000);
    rememberStudioRasterEditSurface("first", first);
    rememberStudioRasterEditSurface("second", second);
    expect(takeStudioRasterEditSurface("first")).toBe(first);
    rememberStudioRasterEditSurface("third", third);

    expect(getStudioRasterEditSurfaceSnapshot("first")).toBe(first);
    expect(getStudioRasterEditSurfaceSnapshot("second")).toBeNull();
    expect(getStudioRasterEditSurfaceSnapshot("third")).toBe(third);
    expect(studioRasterEditSurfaceCacheStats()).toEqual({ entries: 2, pixels: 2_000_000 });
  });

  it("releases leased surfaces after inactivity and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStudioRasterEditSurfaces(listener);
    rememberStudioRasterEditSurface("leased", surface(32, 24));
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(44_999);
    expect(getStudioRasterEditSurfaceSnapshot("leased")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getStudioRasterEditSurfaceSnapshot("leased")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
