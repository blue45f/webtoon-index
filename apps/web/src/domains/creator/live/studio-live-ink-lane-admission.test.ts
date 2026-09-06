import { describe, expect, it, vi } from "vitest";

import {
  commitPendingStrokeBatchForAdmission,
  studioLiveInkLaneAdmitsStyle,
  studioLiveInkLaneSelectsGpu,
} from "./studio-live-ink-lane-admission";

import type { DrawEl } from "../studio-element-model";

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "s1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 10, 10],
    stroke: "#101014",
    strokeWidth: 6,
    opacity: 1,
    brush: "pen",
    ...overrides,
  } as unknown as DrawEl;
}

describe("studioLiveInkLaneAdmitsStyle", () => {
  it("admits an ordinary opaque stroke", () => {
    expect(studioLiveInkLaneAdmitsStyle(stroke())).toBe(true);
    expect(studioLiveInkLaneAdmitsStyle(stroke({ opacity: undefined }))).toBe(true);
  });

  it("refuses the styles the lane cannot render, which used to delete the stroke", () => {
    // 마커(0.6)는 GPU 브라우저에서 0px 를 그렸다.
    expect(studioLiveInkLaneAdmitsStyle(stroke({ opacity: 0.6 }))).toBe(false);
    // 지우개는 아예 지워지지 않았다 — 이 레인의 준비는 항상 투명 오버레이다.
    expect(studioLiveInkLaneAdmitsStyle(stroke({ mode: "eraser" }))).toBe(false);
    expect(studioLiveInkLaneAdmitsStyle(stroke({ fill: "#ff0000" } as Partial<DrawEl>))).toBe(false);
    expect(studioLiveInkLaneAdmitsStyle(
      stroke({ symmetry: { type: "vertical" } } as unknown as Partial<DrawEl>),
    )).toBe(false);
  });

  it("keeps a hair under full opacity admissible so float noise cannot flip the lane", () => {
    expect(studioLiveInkLaneAdmitsStyle(stroke({ opacity: 0.999 }))).toBe(true);
    expect(studioLiveInkLaneAdmitsStyle(stroke({ opacity: 0.998 }))).toBe(false);
  });
});

describe("studioLiveInkLaneSelectsGpu", () => {
  const base = {
    element: stroke(),
    explicitBackend: undefined,
    hardwareReady: true,
    rolloutPrefersGpu: true,
  };

  it("keeps automatic rollout on the incumbent until brush-specific evidence exists", () => {
    expect(studioLiveInkLaneSelectsGpu(base)).toBe(false);
    expect(studioLiveInkLaneSelectsGpu({ ...base, hardwareReady: false })).toBe(false);
    expect(studioLiveInkLaneSelectsGpu({ ...base, rolloutPrefersGpu: false })).toBe(false);
  });

  it("honours an explicit backend in both directions", () => {
    expect(studioLiveInkLaneSelectsGpu({ ...base, explicitBackend: "canvas2d" })).toBe(false);
    expect(studioLiveInkLaneSelectsGpu({
      ...base,
      explicitBackend: "webgpu",
      hardwareReady: false,
      rolloutPrefersGpu: false,
    })).toBe(true);
  });

  it("never selects the lane for a style it would refuse, even when explicitly asked", () => {
    for (const element of [
      stroke({ opacity: 0.6 }),
      stroke({ mode: "eraser" }),
    ]) {
      expect(studioLiveInkLaneSelectsGpu({ ...base, element })).toBe(false);
      expect(studioLiveInkLaneSelectsGpu({ ...base, element, explicitBackend: "webgpu" }))
        .toBe(false);
    }
  });
});

describe("commitPendingStrokeBatchForAdmission", () => {
  it("does nothing when no WebGPU authority is queued", () => {
    const flush = vi.fn();
    const ref = { current: false };
    commitPendingStrokeBatchForAdmission(false, ref, flush);
    expect(flush).not.toHaveBeenCalled();
    expect(ref.current).toBe(false);
  });

  it("raises the bypass only for the duration of the flush", () => {
    const seen: boolean[] = [];
    const ref = { current: false };
    commitPendingStrokeBatchForAdmission(true, ref, () => seen.push(ref.current));
    expect(seen).toEqual([true]);
    expect(ref.current).toBe(false);
  });

  it("lowers the bypass again when the flush throws", () => {
    const ref = { current: false };
    expect(() => commitPendingStrokeBatchForAdmission(true, ref, () => {
      throw new Error("commit rejected");
    })).toThrow("commit rejected");
    expect(ref.current).toBe(false);
  });
});
