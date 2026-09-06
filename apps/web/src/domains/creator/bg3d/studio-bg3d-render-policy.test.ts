import { describe, expect, it } from "vitest";

import {
  resolveStudioBg3dFrameLoop,
  type StudioBg3dRenderActivity,
} from "./studio-bg3d-render-policy";

const STATIC_ACTIVITY: StudioBg3dRenderActivity = Object.freeze({
  modelAnimationPlaying: false,
  physicsPlaying: false,
  transforming: false,
  capturing: false,
  batchRendering: false,
});

const TIME_VARYING_FLAGS = [
  "modelAnimationPlaying", "physicsPlaying", "capturing", "batchRendering",
] as const;

describe("Studio BG3D render policy", () => {
  it("uses event-driven frames for a static scene and a stationary held gizmo", () => {
    expect(resolveStudioBg3dFrameLoop(STATIC_ACTIVITY)).toBe("demand");
    expect(resolveStudioBg3dFrameLoop({ ...STATIC_ACTIVITY, transforming: true })).toBe("demand");
  });

  it.each(TIME_VARYING_FLAGS)("keeps continuous frames for %s during and outside a gesture", (flag) => {
    expect(resolveStudioBg3dFrameLoop({ ...STATIC_ACTIVITY, [flag]: true })).toBe("always");
    expect(resolveStudioBg3dFrameLoop({
      ...STATIC_ACTIVITY, [flag]: true, transforming: true,
    })).toBe("always");
  });

  it.each(Array.from({ length: 32 }, (_, mask) => mask))(
    "does not let transform state suppress or fabricate an animation clock (flags %i)",
    (mask) => {
      const activity: StudioBg3dRenderActivity = Object.freeze({
        modelAnimationPlaying: Boolean(mask & 1), physicsPlaying: Boolean(mask & 2),
        capturing: Boolean(mask & 4), batchRendering: Boolean(mask & 8),
        transforming: Boolean(mask & 16),
      });
      expect(resolveStudioBg3dFrameLoop(activity)).toBe(mask & 15 ? "always" : "demand");
    },
  );
});
