// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BgAdaptiveDprController } from "./StudioBg3dSceneNodes";

import type { RootState } from "@react-three/fiber";

type FrameCallback = (state: RootState, delta: number) => void;
const frame = vi.hoisted(() => ({ callback: null as FrameCallback | null }));
vi.mock("@react-three/fiber", async (importOriginal) => ({
  ...await importOriginal<typeof import("@react-three/fiber")>(),
  useFrame: (callback: FrameCallback) => { frame.callback = callback; },
}));

afterEach(() => {
  cleanup();
  frame.callback = null;
});

function advance(mode: "always" | "demand" | "never", start: number, count = 120) {
  act(() => {
    for (let i = 1; i <= count; i += 1) {
      frame.callback?.({
        frameloop: mode, clock: { elapsedTime: (start + i) * 0.08 },
      } as unknown as RootState, 0.08);
    }
  });
}

describe("BG3D event-driven frame quality sampling", () => {
  it.each(["demand", "never"] as const)("does not treat %s event gaps as slow GPU frames", (mode) => {
    const scale = vi.fn();
    const report = vi.fn();
    render(<BgAdaptiveDprController targetFps={60} paused={false}
      onScaleChange={scale} onFrameTimeChange={report} />);
    advance(mode, 0, 300);
    expect(scale).toHaveBeenCalledExactlyOnceWith(1);
    expect(report.mock.calls.every(([value]) => value === null)).toBe(true);
  });

  it("continues adapting resolution when a real continuous animation is overloaded", () => {
    const scale = vi.fn();
    const report = vi.fn();
    render(<BgAdaptiveDprController targetFps={60} paused={false}
      onScaleChange={scale} onFrameTimeChange={report} />);
    advance("always", 0);
    expect(scale).toHaveBeenCalledWith(0.85);
    expect(report.mock.calls.some(([value]) => typeof value === "number" && value > 16)).toBe(true);
  });

  it("keeps resolution fixed during a paused gesture even if animation requires continuous frames", () => {
    const scale = vi.fn();
    render(<BgAdaptiveDprController targetFps={60} paused
      onScaleChange={scale} />);
    advance("always", 0, 300);
    expect(scale).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("clears a previously reported frame time when rendering becomes event-driven", () => {
    const report = vi.fn();
    render(<BgAdaptiveDprController targetFps={60} paused={false}
      onScaleChange={vi.fn()} onFrameTimeChange={report} />);
    advance("always", 0);
    expect(report.mock.calls.some(([value]) => typeof value === "number")).toBe(true);
    advance("demand", 120, 15);
    expect(report).toHaveBeenLastCalledWith(null);
  });

  it("wires the viewport's transform lock and rejects the removed experiment", () => {
    // Resolve a source file through Node, not Vite's browser-asset new-URL transform.
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("./StudioBg3dEditorViewport.tsx"), "utf8");
    expect(source).toContain("paused={isTransforming || isCapturing || immersiveSceneActive || !open}");
    expect(source).not.toContain("EXPERIMENT: no isTransforming");
  });

  it("uses the shipped Drei change-event invalidation contract rather than assuming a 60fps loop", () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("@react-three/drei/core/TransformControls.js"), "utf8");
    expect(source).toContain("state.invalidate");
    expect(source).toMatch(/invalidate\(\)/u);
    expect(source).toMatch(/addEventListener\(['"]change['"],\s*onChange\)/u);
  });
});
