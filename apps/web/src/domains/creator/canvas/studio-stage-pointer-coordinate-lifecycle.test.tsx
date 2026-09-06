// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioStagePointerFrameMapperCache,
  type StudioStagePointerFrameMapperCacheLease,
  type StudioStagePointerFrameMapperCacheRef,
} from "./studio-stage-pointer-coordinate";

afterEach(cleanup);

function scheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    callbacks,
    requestFrame: vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancelFrame: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
  };
}

function stage() {
  return {
    getContent: () => ({
      clientWidth: 100,
      clientHeight: 100,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      }),
    }),
    getAbsoluteTransform: () => ({
      copy: () => ({
        invert: () => ({ point: (value: { x: number; y: number }) => value }),
      }),
    }),
  };
}

describe("Studio stage pointer mapper React lifecycle", () => {
  it("reacquires after StrictMode effect replay and permanently rejects both released leases", () => {
    const frameScheduler = scheduler();
    const leases: StudioStagePointerFrameMapperCacheLease[] = [];
    const ownedCacheRef: StudioStagePointerFrameMapperCacheRef = { current: null };

    function Harness() {
      useLayoutEffect(() => {
        const lease = acquireStudioStagePointerFrameMapperCache(
          ownedCacheRef,
          frameScheduler
        );
        leases.push(lease);
        return () => lease.release();
      }, []);
      return null;
    }

    const view = render(<StrictMode><Harness /></StrictMode>);

    expect(leases).toHaveLength(2);
    expect(ownedCacheRef.current).toBe(leases[1]?.cache);
    expect(() => leases[0]?.cache.mapperFor(stage() as never)).toThrow(/disposed/i);
    expect(() => leases[1]?.cache.mapperFor(stage() as never)).not.toThrow();

    view.unmount();

    expect(ownedCacheRef.current).toBeNull();
    expect(frameScheduler.callbacks.size).toBe(0);
    expect(() => leases[1]?.cache.mapperFor(stage() as never)).toThrow(/disposed/i);
  });

  it("keeps StudioPage cache acquisition in effect setup instead of render", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx"),
      "utf8"
    );

    expect(source).toContain("const mapperCacheLease = acquireStudioStagePointerFrameMapperCache(");
    expect(source).toContain("mapperCacheLease.release();");
    expect(source).not.toMatch(/stagePointerFrameMapperCacheRef\.current\s*\?\?=/u);
    expect(source).not.toContain("stagePointerFrameMapperCacheRef.current?.dispose()");
  });
});
